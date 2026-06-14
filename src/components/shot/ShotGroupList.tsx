'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { VideoPlayer } from '@/components/video/VideoPlayer'
import { ScriptEditor } from '@/components/shot/ScriptEditor'
import { InsufficientCreditsDialog } from '@/components/project/insufficient-credits-dialog'
import { RegenerateConfirmDialog } from '@/components/shot/RegenerateConfirmDialog'

// 分镜组内分镜的精简结构（与 GET /api/projects/[id] 返回的 shotGroups[].shots 对齐)
export interface ShotGroupShot {
  id: string
  orderIndex: number
  prompt: string | null
  coverUrl: string | null
  /** 对白 JSON 字符串（格式：[{speaker,text}]），无对白时为 null */
  dialogue: string | null
}

// 分镜组结构（与 GET /api/projects/[id] 返回的 shotGroups 对齐)
export interface ShotGroupData {
  id: string
  groupIndex: number
  genStatus: string
  genVideoUrl: string | null
  /** 生成视频抽帧封面 URL（来自 genVideoUrl 的 ffmpeg 抽帧，非原始视频帧） */
  genCoverUrl: string | null
  genDuration: number
  timelineScript: string | null
  shots: ShotGroupShot[]
  // 本组选中的人物 id（默认=该组镜头出现的人物，可在卡片上增删)
  characterIds: string[]
  // 结构化取舍说明：合并脚本时发生的分镜丢弃/截断信息，非 null 时前端须可见展示（禁止静默处理）
  lossNotice?: string | null
}

// 人物素材库精简结构（供分镜组选择人物用)
export interface CharacterLibraryItem {
  id: string
  name: string
  imageUrl: string | null
  avatarStatus: 'NONE' | 'REGISTERING' | 'ACTIVE' | 'FAILED'
}

interface ShotGroupListProps {
  projectId: string
  // 初始分镜组数据（来自项目详情接口，真实后端状态)
  initialGroups: ShotGroupData[]
  // 项目画幅，作为按组生成请求的 aspectRatio 兜底
  aspectRatio: string | null
  // 组状态变化时上报「是否全部成功」给父级（用于联动合并导出按钮可用性)
  // 本组件内部轮询维护最新组状态，父级据此实时更新导出按钮，无需自行轮询
  onAllSucceededChange?: (allSucceeded: boolean) => void
  // 护栏：存在启用人物但人物形象（锚定图)未就绪时为 true，用于提示并拦截「一键生成」
  anchorMissing?: boolean
  // 人物素材库（项目全部已启用人物)，供每个分镜组选择本组需要的人物
  characterLibrary?: CharacterLibraryItem[]
}

// 组生成状态展示配置（与单分镜状态枚举保持一致；配色用电影质感变量)
const groupStatusConfig: Record<string, { label: string; className: string }> = {
  PENDING: { label: '待生成', className: 'bg-[var(--cine-surface)] text-[var(--cine-text-3)]' },
  QUEUED: { label: '排队中', className: 'bg-[var(--cine-amber-dim)] text-[var(--cine-amber)]' },
  GENERATING: { label: '生成中', className: 'bg-[var(--cine-amber-dim)] text-[var(--cine-amber)] animate-pulse' },
  SUCCEEDED: { label: '已完成', className: 'bg-[var(--cine-green-dim)] text-[var(--cine-green)]' },
  FAILED: { label: '失败', className: 'bg-[var(--cine-red-dim)] text-[var(--cine-red)]' },
  CANCELED: { label: '已取消', className: 'bg-[var(--cine-surface)] text-[var(--cine-text-3)]' },
}

// 进行中状态集合（用于触发轮询与禁用生成入口)
const IN_PROGRESS_STATUSES = ['QUEUED', 'GENERATING']

export default function ShotGroupList({
  projectId,
  initialGroups,
  aspectRatio,
  onAllSucceededChange,
  anchorMissing = false,
  characterLibrary = [],
}: ShotGroupListProps) {
  const [groups, setGroups] = useState<ShotGroupData[]>(initialGroups)
  // 各组生成请求的提交中状态（避免重复点击)
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({})
  // 各组生成请求失败时展示的后端错误信息（不静默吞掉)
  const [groupErrors, setGroupErrors] = useState<Record<string, string>>({})
  // 余额不足弹窗
  const [creditsDialogOpen, setCreditsDialogOpen] = useState(false)
  const [creditsInfo, setCreditsInfo] = useState({ currentBalance: 0, requiredCredits: 0 })
  // 抽卡（重新生成)二次确认弹窗：记录待确认的组 id、序号与积分消耗
  const [regenConfirm, setRegenConfirm] = useState<
    { groupId: string; groupIndex: number; cost: number } | null
  >(null)
  const isMounted = useRef(true)

  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
    }
  }, [])

  // 外部初始数据变化时同步（如父级刷新项目详情)。
  // 此处为「父级 prop 变化时重置本地 state」的合法场景：groups 还会被轮询/乐观更新改写，
  // 无法纯派生，必须以本地 state 承载并在 initialGroups 变化时重置。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGroups(initialGroups)
  }, [initialGroups])

  // 组状态变化时上报「是否全部成功」给父级（联动合并导出按钮)
  // 与导出 API 校验口径一致：非空且每组 genStatus === 'SUCCEEDED'
  useEffect(() => {
    if (!onAllSucceededChange) return
    const allSucceeded =
      groups.length > 0 && groups.every((g) => g.genStatus === 'SUCCEEDED')
    onAllSucceededChange(allSucceeded)
  }, [groups, onAllSucceededChange])

  // 是否有组处于进行中状态
  const hasInProgress = groups.some((g) => IN_PROGRESS_STATUSES.includes(g.genStatus))

  // 轮询：当存在进行中分镜组时，定期拉取项目详情刷新真实组状态
  useEffect(() => {
    if (!hasInProgress) return

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}`)
        if (!res.ok) return
        const data = await res.json()
        if (isMounted.current && Array.isArray(data.project?.shotGroups)) {
          setGroups(data.project.shotGroups)
        }
      } catch {
        // 轮询失败不影响展示，下一轮重试（真实状态以后端为准)
      }
    }, 3000)

    return () => clearInterval(interval)
  }, [hasInProgress, projectId])

  // 触发某组生成
  // 虚拟分组（id 以 virtual- 开头)调用项目级生成路由 POST /api/projects/[id]/generate
  // 真实 ShotGroup 调用原有路由 POST /api/shot-groups/[id]/generate
  const handleGenerateGroup = useCallback(
    async (groupId: string, force = false) => {
      setSubmitting((prev) => ({ ...prev, [groupId]: true }))
      setGroupErrors((prev) => {
        const next = { ...prev }
        delete next[groupId]
        return next
      })

      try {
        const isVirtual = groupId.startsWith('virtual-')
        const url = isVirtual
          ? `/api/projects/${projectId}/generate`
          : `/api/shot-groups/${groupId}/generate`

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(aspectRatio ? { aspectRatio } : {}),
            resolution: '480p',
            // force：抽卡重生成。真实 ShotGroup 路由支持；虚拟组走项目级路由不传。
            ...(force && !isVirtual ? { force: true } : {}),
          }),
        })
        const data = await res.json().catch(() => ({}))

        if (!res.ok) {
          // 积分不足：展示充值弹窗（后端返回 required / available)
          if (data?.error === '积分余额不足' || data?.error === '积分余额不足') {
            setCreditsInfo({
              currentBalance: data.available ?? data.currentBalance ?? 0,
              requiredCredits: data.required ?? data.requiredCredits ?? 0,
            })
            setCreditsDialogOpen(true)
          } else {
            // 其余错误：把后端错误信息直接展示给用户，不静默吞掉
            const detail = Array.isArray(data?.missingShotOrderIndexes)
              ? `（分镜 ${data.missingShotOrderIndexes.map((i: number) => i + 1).join('、')})`
              : ''
            setGroupErrors((prev) => ({
              ...prev,
              [groupId]: `${data?.error || '生成任务创建失败'}${detail}`,
            }))
          }
          return
        }

        // 提交成功：乐观将所有虚拟组置为 QUEUED（项目级生成一次性触发全部段)
        if (isVirtual) {
          setGroups((prev) =>
            prev.map((g) => g.id.startsWith('virtual-') ? { ...g, genStatus: 'QUEUED' } : g)
          )
        } else {
          // 单组生成：更新状态为 QUEUED，并附带后端返回的 lossNotice（合并取舍说明）
          const responseLossNotice: string | null = data?.lossNotice ?? null
          setGroups((prev) =>
            prev.map((g) => (g.id === groupId ? { ...g, genStatus: 'QUEUED', lossNotice: responseLossNotice } : g))
          )
        }
      } catch {
        setGroupErrors((prev) => ({
          ...prev,
          [groupId]: '网络错误，请重试',
        }))
      } finally {
        if (isMounted.current) {
          setSubmitting((prev) => ({ ...prev, [groupId]: false }))
        }
      }
    },
    [aspectRatio, projectId]
  )

  const anyInProgress = groups.some((g) => IN_PROGRESS_STATUSES.includes(g.genStatus))
  const allSucceeded = groups.every((g) => g.genStatus === 'SUCCEEDED')

  // 一键生成按钮状态
  const [batchSubmitting, setBatchSubmitting] = useState(false)
  const [batchError, setBatchError] = useState<string | null>(null)

  // 一键生成：调用 POST /api/projects/{id}/generate
  const handleBatchGenerate = useCallback(async () => {
    setBatchSubmitting(true)
    setBatchError(null)

    try {
      const res = await fetch(`/api/projects/${projectId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution: '480p' }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        if (data?.error === '积分余额不足') {
          setCreditsInfo({
            currentBalance: data.available ?? 0,
            requiredCredits: data.required ?? 0,
          })
          setCreditsDialogOpen(true)
        } else {
          setBatchError(data?.error || '生成任务创建失败')
        }
        return
      }

      // 成功：所有组置为 QUEUED，并将各组取舍说明（lossNotices）非静默附带到对应组
      const lossNotices: Array<{ groupId: string; lossNotice: string }> = data?.lossNotices ?? []
      setGroups((prev) => prev.map((g) => {
        const notice = lossNotices.find((n: { groupId: string; lossNotice: string }) => n.groupId === g.id)
        return { ...g, genStatus: 'QUEUED', lossNotice: notice?.lossNotice ?? null }
      }))
    } catch {
      setBatchError('网络错误，请重试')
    } finally {
      if (isMounted.current) {
        setBatchSubmitting(false)
      }
    }
  }, [projectId])

  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] p-8 text-center">
        <p className="text-sm text-[var(--cine-text-3)]">暂无分镜组数据</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* 顶部：一键生成按钮 */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-[var(--cine-text)]">分镜组（按组合并生成)</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--cine-text-3)]">共 {groups.length} 组</span>
          {!allSucceeded && (
            <Button
              size="sm"
              onClick={handleBatchGenerate}
              disabled={batchSubmitting || anyInProgress || anchorMissing}
              title={anchorMissing ? '请先为所有启用人物生成形象，再一键生成视频' : undefined}
              className="bg-[var(--cine-gold)] text-[var(--cine-ink)] hover:bg-[var(--cine-gold-2)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {batchSubmitting ? '提交中...' : anyInProgress ? '生成中...' : '一键生成视频'}
            </Button>
          )}
        </div>
      </div>

      {/* 护栏：人物形象未就绪提示（生成会退化为外貌文字，人物易不一致) */}
      {anchorMissing && (
        <div className="rounded-lg border border-[var(--cine-amber-dim)] bg-[var(--cine-amber-dim)] p-3">
          <p className="text-xs text-[var(--cine-amber)]">
            部分启用人物尚未生成「人物形象」。建议先在上方「人物信息」中为每个人物生成形象，
            否则各组生成的人物可能前后不一致。「一键生成视频」已暂时禁用；如需单组试生成，可点对应组的按钮。
          </p>
        </div>
      )}

      {/* 一键生成错误提示 */}
      {batchError && (
        <div className="rounded-lg border border-[var(--cine-red-dim)] bg-[var(--cine-red-dim)] p-3">
          <p className="text-xs text-[var(--cine-red)]">{batchError}</p>
        </div>
      )}

      {groups.map((group) => (
        <ShotGroupCard
          key={group.id}
          group={group}
          submitting={!!submitting[group.id]}
          error={groupErrors[group.id]}
          characterLibrary={characterLibrary}
          onGenerate={(force) => {
            // force=true 表示已完成组的「重新生成」（抽卡)→ 先弹二次确认，确认后才真生成
            if (force) {
              // 积分消耗与后端一致：ceil(genDuration × 倍率)，前端固定 480p（倍率 1.0)
              setRegenConfirm({
                groupId: group.id,
                groupIndex: group.groupIndex,
                cost: Math.ceil(group.genDuration),
              })
            } else {
              handleGenerateGroup(group.id, false)
            }
          }}
        />
      ))}

      {/* 余额不足弹窗 */}
      <InsufficientCreditsDialog
        open={creditsDialogOpen}
        onClose={() => setCreditsDialogOpen(false)}
        currentBalance={creditsInfo.currentBalance}
        requiredCredits={creditsInfo.requiredCredits}
      />

      {/* 抽卡（重新生成)二次确认弹窗 */}
      <RegenerateConfirmDialog
        open={regenConfirm !== null}
        onClose={() => setRegenConfirm(null)}
        groupIndex={regenConfirm?.groupIndex ?? 0}
        cost={regenConfirm?.cost ?? 0}
        submitting={regenConfirm ? !!submitting[regenConfirm.groupId] : false}
        onConfirm={() => {
          if (!regenConfirm) return
          // 确认后以 force=true 触发真生成，并关闭弹窗
          handleGenerateGroup(regenConfirm.groupId, true)
          setRegenConfirm(null)
        }}
      />
    </div>
  )
}

interface ShotGroupCardProps {
  group: ShotGroupData
  submitting: boolean
  error?: string
  // 人物素材库，供本组选择人物
  characterLibrary: CharacterLibraryItem[]
  // force：抽卡重生成标志。已完成的组点「重新生成」时传 true，强制真生成
  onGenerate: (force: boolean) => void
}

// 单个分镜组卡片：组内分镜列表 + 合并视频 / 状态 / 生成入口 + 本组人物选择
function ShotGroupCard({ group, submitting, error, characterLibrary, onGenerate }: ShotGroupCardProps) {
  const statusInfo = groupStatusConfig[group.genStatus] || groupStatusConfig.PENDING
  const inProgress = IN_PROGRESS_STATUSES.includes(group.genStatus)
  const succeeded = group.genStatus === 'SUCCEEDED' && !!group.genVideoUrl
  const failed = group.genStatus === 'FAILED'
  const [showScriptEditor, setShowScriptEditor] = useState(false)
  // 本组选中人物（set 语义，切换即 PUT 保存)
  const isVirtualGroup = group.id.startsWith('virtual-')
  const [selectedCharIds, setSelectedCharIds] = useState<string[]>(group.characterIds || [])
  const [savingChars, setSavingChars] = useState(false)
  const toggleChar = useCallback(
    async (charId: string) => {
      const prev = selectedCharIds
      const next = prev.includes(charId)
        ? prev.filter((i) => i !== charId)
        : [...prev, charId]
      setSelectedCharIds(next)
      setSavingChars(true)
      try {
        const res = await fetch(`/api/shot-groups/${group.id}/characters`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ characterIds: next }),
        })
        if (!res.ok) throw new Error('save failed')
      } catch {
        // 保存失败回滚本地选择，避免与后端不一致
        setSelectedCharIds(prev)
      } finally {
        setSavingChars(false)
      }
    },
    [selectedCharIds, group.id]
  )
  // 如果 timelineScript 为空，从组内分镜 prompt 拼接一份预览
  const fallbackScript = group.shots
    .filter((s) => s.prompt && s.prompt.trim().length > 0)
    .map((s) => s.prompt)
    .join('\n')
  const [localScript, setLocalScript] = useState(group.timelineScript || fallbackScript || null)

  return (
    <div className="rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] p-4">
      {/* 组头部：组序号 + 状态 + 时长 + 生成入口 */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 items-center justify-center rounded-md bg-[var(--cine-gold-dim)] px-2 text-xs font-medium text-[var(--cine-gold)]">
            第 {group.groupIndex + 1} 组
          </span>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${statusInfo.className}`}>
            {statusInfo.label}
          </span>
          <span className="text-xs text-[var(--cine-text-2)]">
            {group.shots.length} 个分镜 · {Math.round(group.genDuration)}s
          </span>
        </div>

        {/* 生成 / 重新生成入口（进行中时禁用) */}
        <div className="shrink-0">
          {inProgress ? (
            <Button
              size="sm"
              variant="outline"
              disabled
              className="cursor-not-allowed opacity-60"
            >
              <Spinner size="sm" />
              <span className="ml-1.5">生成中...</span>
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => onGenerate(succeeded)}
              disabled={submitting}
              className="bg-[var(--cine-gold)] text-[var(--cine-ink)] hover:bg-[var(--cine-gold-2)]"
            >
              {submitting ? '提交中...' : failed || succeeded ? '重新生成' : '生成该组'}
            </Button>
          )}
        </div>
      </div>

      {/* 失败状态：展示失败提示（重新生成入口已在头部提供) */}
      {failed && (
        <div className="mt-3 rounded-lg border border-[var(--cine-red-dim)] bg-[var(--cine-red-dim)] p-3">
          <p className="text-xs text-[var(--cine-red)]">
            该组生成失败，请点击右上角「重新生成」重试。
          </p>
        </div>
      )}

      {/* 生成请求错误（如缺少提示词、网络错误等，直接展示后端信息) */}
      {error && (
        <div className="mt-3 rounded-lg border border-[var(--cine-red-dim)] bg-[var(--cine-red-dim)] p-3">
          <p className="text-xs text-[var(--cine-red)]">{error}</p>
        </div>
      )}

      {/* 脚本取舍警告：合并过程中发生了分镜丢弃/截断，非静默展示给用户（禁止仅 console.warn 后静默继续） */}
      {group.lossNotice && (
        <div className="mt-3 rounded-lg border border-[var(--cine-amber-dim)] bg-[var(--cine-amber-dim)] p-3">
          <p className="text-xs text-[var(--cine-amber)]">
            ⚠ {group.lossNotice}
          </p>
        </div>
      )}

      {/* 已生成：展示合并视频 */}
      {succeeded && (
        <div className="mt-3">
          <VideoPlayer
            src={group.genVideoUrl as string}
            // 使用生成视频封面（genCoverUrl 来自 genVideoUrl 的 ffmpeg 抽帧），
            // 确保封面与生成视频内容一致，而非原始视频帧（Bug 2 修复 — Req 2.8）
            poster={group.genCoverUrl || undefined}
            className="w-full h-[320px] border border-[var(--cine-line-2)]"
          />
        </div>
      )}

      {/* 进行中：展示进行中状态条 */}
      {inProgress && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-[var(--cine-amber-dim)] bg-[var(--cine-amber-dim)] p-3">
          <Spinner size="sm" />
          <p className="text-xs text-[var(--cine-amber)]">
            合并视频生成中，进度将自动刷新...
          </p>
        </div>
      )}

      {/* 本组人物选择：从素材库点选用于生成的角色（默认=该组镜头出现的人物) */}
      {!isVirtualGroup && characterLibrary.length > 0 && (
        <div className="mt-3 rounded-lg border border-[var(--cine-line)] bg-[var(--cine-bg-soft)] p-2">
          <p className="mb-1.5 text-[11px] text-[var(--cine-text-2)]">
            本组人物（点选用于生成的角色，仅选中的会作为参考图)
          </p>
          <div className="flex flex-wrap gap-2">
            {characterLibrary.map((c) => {
              const sel = selectedCharIds.includes(c.id)
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleChar(c.id)}
                  disabled={savingChars}
                  className={`flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] transition-colors disabled:opacity-50 ${
                    sel
                      ? 'border-[var(--cine-gold)] bg-[var(--cine-gold-dim)] text-[var(--cine-gold)]'
                      : 'border-[var(--cine-line-2)] bg-[var(--cine-surface)] text-[var(--cine-text-2)] hover:border-[var(--cine-text-3)]'
                  }`}
                >
                  {c.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.imageUrl} alt={c.name} className="h-4 w-4 rounded-full object-cover" />
                  ) : null}
                  <span>{c.name}</span>
                  <span>{sel ? '✓' : '+'}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* 组内分镜列表 */}
      <div className="mt-3 space-y-2">

        {/* 编辑脚本入口 */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowScriptEditor(true)}
            className="text-[11px] text-[var(--cine-gold)] hover:text-[var(--cine-gold-2)] transition-colors"
          >
            编辑脚本
          </button>
          {localScript && localScript.trim().length > 0 && (
            <span className="text-[10px] text-[var(--cine-text-3)]">已编辑</span>
          )}
        </div>

        {/* ScriptEditor 弹窗 */}
        <ScriptEditor
          groupId={group.id}
          groupIndex={group.groupIndex}
          initialScript={localScript}
          onSaved={(newScript) => setLocalScript(newScript)}
          open={showScriptEditor}
          onClose={() => setShowScriptEditor(false)}
        />

        {group.shots.map((shot) => (
          <div
            key={shot.id}
            className="flex gap-3 rounded-lg border border-[var(--cine-line)] bg-[var(--cine-bg-soft)] p-2"
          >
            <div className="flex flex-col items-center gap-1">
              <span className="flex h-5 w-5 items-center justify-center rounded bg-[var(--cine-line-2)] text-[10px] font-medium text-[var(--cine-text-2)]">
                {shot.orderIndex + 1}
              </span>
              <div className="h-12 w-20 overflow-hidden rounded bg-[var(--cine-surface)]">
                {shot.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={shot.coverUrl}
                    alt={`分镜 ${shot.orderIndex + 1}`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <svg className="h-5 w-5 text-[var(--cine-text-3)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </div>
                )}
              </div>
            </div>
            <p className="flex-1 text-xs text-[var(--cine-text-2)]">
              {shot.prompt || '暂无提示词'}
            </p>
            {shot.dialogue && (() => {
              try {
                const lines = JSON.parse(shot.dialogue) as Array<{ speaker: string; text: string }>
                if (lines.length === 0) return null
                return (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {lines.map((line, i) => (
                      <span key={i} className="inline-flex items-center gap-1 rounded bg-[var(--cine-surface)] px-1.5 py-0.5 text-xs text-[var(--cine-gold)]">
                        💬 {line.speaker}：「{line.text}」
                      </span>
                    ))}
                  </div>
                )
              } catch { return null }
            })()}
          </div>
        ))}
      </div>
    </div>
  )
}

// 加载动画（与编辑页 Spinner 风格一致)
function Spinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizeClass = {
    sm: 'h-4 w-4',
    md: 'h-8 w-8',
    lg: 'h-12 w-12',
  }[size]

  return (
    <svg
      className={`animate-spin text-[var(--cine-gold)] ${sizeClass}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )
}
