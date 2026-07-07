'use client'

/**
 * GenerationControlPanel — variants 页生成可控性面板（需求 4.1, 4.2, 4.3, 4.5, 4.6, 4.7）
 *
 * 独立子组件，挂载于版本导出页（variants）选中某版本后，承载「生成可控性」三件套交互：
 * - 可干预（小白默认一键）：
 *     · 「重新生成此版本」一键重做当前版本，无需任何参数，仅重生成该版本、保留其它版本（需求 4.2）。
 *     · 「重拍某个镜头」选择一个镜头替换素材后，仅基于受影响范围重合成（需求 4.3）。
 * - 可干预（运营型用户高级抽屉，默认隐藏，需求 4.6）：
 *     · 「高级」抽屉可调风格 / 时长 / 模板；默认折叠，不影响一键路径。
 * - 可解释（需求 4.7）：
 *     · 当前版本若使用过高级参数，展示本次实际生效的参数标注（来自 VideoVariant.renderParams.advancedParams）。
 *     · 重拍触发承接链扩散时提示「将一并重算 N 个后续镜头组」，确保画面不断裂（需求 4.5）。
 *
 * 调用 API（均消耗积分，余额不足在预检阶段显式 402 拒绝）：
 * - POST /api/video-variants/{variantId}/regenerate   单版本重生成（可带 advancedParams）
 * - POST /api/content-briefs/{briefId}/reshoot          局部重拍（body: { shotTaskId }）
 *
 * 设计原则：暖色调、大圆角、日常用语、隐藏技术参数（面向不懂拍视频的小店老板），
 * 高级参数默认隐藏于折叠抽屉，仅运营型用户主动展开时可见。
 *
 * Requirements: 4.1, 4.2, 4.3, 4.5, 4.6, 4.7
 */

import { useState, useCallback } from 'react'
import useSWR from 'swr'
import {
  Loader2,
  RefreshCw,
  Sliders,
  ChevronDown,
  Film,
  Clapperboard,
  AlertTriangle,
  CheckCircle2,
  Wallet,
  Camera,
} from 'lucide-react'
import { cn } from '@/lib/shared/utils'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

// ─── 类型定义 ───

/** 镜头任务（用于重拍选择，来自 GET /api/content-briefs/{briefId}）*/
interface ShotTask {
  id: string
  order: number
  title: string
  instruction: string
  durationSec: number
  status: string
}

/** 局部重拍后写入版本 regenScope 的受影响范围（需求 4.5 追溯）*/
interface RegenScope {
  mode?: string
  reshotShotTaskId?: string
  affectedGroupIds?: string[]
  hasContinuityChain?: boolean
  rerenderedAt?: string
}

/** 当前选中版本（仅声明本面板用到的字段）*/
export interface ControlVariant {
  id: string
  type: 'PROMOTION' | 'ATMOSPHERE' | 'OWNER_TALKING'
  /** 渲染参数，advancedParams 标注本次实际生效的高级参数（需求 4.7）*/
  renderParams?: Record<string, unknown> | null
}

/** 高级抽屉参数（默认隐藏，需求 4.6）*/
interface AdvancedParams {
  style?: string
  durationSec?: number
  templateId?: string
}

interface GenerationControlPanelProps {
  /** 内容任务 ID */
  briefId: string
  /** 当前选中版本（重新生成此版本的目标）*/
  variant: ControlVariant
  /** 重生成 / 重拍成功后回调（刷新版本列表）*/
  onVariantsChanged: () => void
}

// ─── 风格 / 模板可选项（日常用语标签）───

const STYLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'PROMOTION', label: '促销风（突出优惠）' },
  { value: 'ATMOSPHERE', label: '氛围风（环境种草）' },
  { value: 'OWNER_TALKING', label: '口播风（真诚推荐）' },
]

const TEMPLATE_OPTIONS: { value: string; label: string }[] = [
  { value: 'PROMOTION', label: '促销编排' },
  { value: 'ATMOSPHERE', label: '氛围编排' },
  { value: 'OWNER_TALKING', label: '口播编排' },
]

const STYLE_LABEL_MAP: Record<string, string> = Object.fromEntries(
  STYLE_OPTIONS.map((o) => [o.value, o.label])
)
const TEMPLATE_LABEL_MAP: Record<string, string> = Object.fromEntries(
  TEMPLATE_OPTIONS.map((o) => [o.value, o.label])
)

// ─── SWR fetcher ───

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || '请求失败')
  }
  return res.json()
}

// ─── 主面板组件 ───

export function GenerationControlPanel({
  briefId,
  variant,
  onVariantsChanged,
}: GenerationControlPanelProps) {
  // 拉取镜头列表（用于重拍选择）；与详情页同 key，SWR 自动去重
  const { data: briefData } = useSWR<{ brief: { shotTasks?: ShotTask[] } }>(
    `/api/content-briefs/${briefId}`,
    fetcher
  )
  const shotTasks = (briefData?.brief?.shotTasks ?? []).slice().sort((a, b) => a.order - b.order)

  // 重新生成状态
  const [regenerating, setRegenerating] = useState(false)
  // 高级抽屉（默认隐藏，需求 4.6）
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [advanced, setAdvanced] = useState<AdvancedParams>({})

  // 重拍状态
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null)
  const [pendingReshoot, setPendingReshoot] = useState<ShotTask | null>(null)
  const [reshooting, setReshooting] = useState(false)
  const [reshootResult, setReshootResult] = useState<{
    affectedCount: number
    followUpCount: number
    hasContinuityChain: boolean
  } | null>(null)

  // 统一反馈
  const [error, setError] = useState<string | null>(null)
  const [insufficient, setInsufficient] = useState(false)
  const [regenHint, setRegenHint] = useState(false)

  const busy = regenerating || reshooting

  // 当前版本已生效的高级参数标注（需求 4.7）
  const appliedParams =
    (variant.renderParams?.advancedParams as AdvancedParams | undefined) ?? null
  const hasAppliedParams =
    !!appliedParams &&
    (appliedParams.style != null ||
      appliedParams.durationSec != null ||
      appliedParams.templateId != null)

  // ─── 重新生成此版本（默认一键，无参数；高级抽屉展开时带 advancedParams）───
  const handleRegenerate = useCallback(async () => {
    setRegenerating(true)
    setError(null)
    setInsufficient(false)
    setRegenHint(false)
    try {
      // 仅当高级抽屉展开且确有填写时才携带参数；否则走纯一键路径（需求 4.1）
      const params: AdvancedParams = {}
      if (advancedOpen) {
        if (advanced.style) params.style = advanced.style
        if (typeof advanced.durationSec === 'number' && !Number.isNaN(advanced.durationSec)) {
          params.durationSec = advanced.durationSec
        }
        if (advanced.templateId) params.templateId = advanced.templateId
      }
      const hasParams = Object.keys(params).length > 0

      const res = await fetch(`/api/video-variants/${variant.id}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: hasParams ? JSON.stringify({ advancedParams: params }) : JSON.stringify({}),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        if (data?.error?.code === 'INSUFFICIENT_CREDITS') {
          setInsufficient(true)
          setError(data?.error?.message || '积分不足，无法重新生成')
          return
        }
        setError(data?.error?.message || '重新生成失败')
        return
      }

      setRegenHint(true)
      onVariantsChanged()
    } catch {
      setError('网络异常，请重试')
    } finally {
      setRegenerating(false)
    }
  }, [advancedOpen, advanced, variant.id, onVariantsChanged])

  // ─── 局部重拍（确认后执行，消耗积分）───
  const runReshoot = useCallback(
    async (shotTask: ShotTask) => {
      setReshooting(true)
      setError(null)
      setInsufficient(false)
      setReshootResult(null)
      try {
        const res = await fetch(`/api/content-briefs/${briefId}/reshoot`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shotTaskId: shotTask.id }),
        })
        const data = await res.json().catch(() => ({}))

        if (!res.ok) {
          if (data?.error?.code === 'INSUFFICIENT_CREDITS') {
            setInsufficient(true)
            setError(data?.error?.message || '积分不足，无法重拍')
            return
          }
          if (data?.error?.code === 'CONTINUITY_DATA_MISSING') {
            setError(data?.error?.message || '该镜头的场景承接数据缺失，暂无法判定受影响范围')
            return
          }
          setError(data?.error?.message || '重拍失败')
          return
        }

        // 从返回版本的 regenScope 读取受影响范围（需求 4.5 可解释）
        const variants = (data?.variants ?? []) as Array<{ regenScope?: RegenScope }>
        const scope = variants[0]?.regenScope
        const affectedCount = scope?.affectedGroupIds?.length ?? 1
        const hasContinuityChain = scope?.hasContinuityChain ?? false
        // 后续镜头组数 = 受影响组总数 - 被重拍组本身（承接链扩散量）
        const followUpCount = hasContinuityChain ? Math.max(affectedCount - 1, 0) : 0

        setReshootResult({ affectedCount, followUpCount, hasContinuityChain })
        setSelectedShotId(null)
        onVariantsChanged()
      } catch {
        setError('网络异常，请重试')
      } finally {
        setReshooting(false)
      }
    },
    [briefId, onVariantsChanged]
  )

  const handleConfirmReshoot = useCallback(() => {
    const task = pendingReshoot
    setPendingReshoot(null)
    if (task) void runReshoot(task)
  }, [pendingReshoot, runReshoot])

  const selectedShot = shotTasks.find((t) => t.id === selectedShotId) ?? null

  return (
    <div className="mt-6">
      <h2 className="text-sm font-bold text-gray-800 mb-3">不满意？重新生成或重拍</h2>

      {/* 积分不足显式提示（需求 4.8）*/}
      {insufficient && (
        <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700 flex items-start gap-2">
          <Wallet className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>{error || '积分不足，请充值后再试'}</span>
        </div>
      )}

      {/* 其它错误提示 */}
      {error && !insufficient && (
        <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
          {error}
        </div>
      )}

      {/* ── 重新生成此版本 ── */}
      <Card className="p-4 rounded-2xl border border-gray-100 space-y-3">
        <div className="flex items-center gap-2">
          <Film className="h-4 w-4 text-amber-500" />
          <h3 className="text-sm font-bold text-gray-800">重新生成此版本</h3>
        </div>
        <p className="text-xs text-gray-500">
          只重做当前这一版，其它版本保持不变。默认由 AI 自动决定风格与时长，无需任何设置。
        </p>

        {/* 当前版本已生效高级参数标注（需求 4.7 可解释）*/}
        {hasAppliedParams && appliedParams && (
          <div className="p-2.5 bg-amber-50/60 border border-amber-100 rounded-lg text-xs text-amber-700 space-y-0.5">
            <p className="font-medium">本版本使用了以下参数：</p>
            <div className="flex flex-wrap gap-1.5">
              {appliedParams.style && (
                <span className="px-2 py-0.5 bg-white/70 rounded-full">
                  风格：{STYLE_LABEL_MAP[appliedParams.style] ?? appliedParams.style}
                </span>
              )}
              {typeof appliedParams.durationSec === 'number' && (
                <span className="px-2 py-0.5 bg-white/70 rounded-full">
                  时长：{appliedParams.durationSec} 秒
                </span>
              )}
              {appliedParams.templateId && (
                <span className="px-2 py-0.5 bg-white/70 rounded-full">
                  模板：{TEMPLATE_LABEL_MAP[appliedParams.templateId] ?? appliedParams.templateId}
                </span>
              )}
            </div>
          </div>
        )}

        {/* 高级抽屉（默认隐藏，需求 4.6）*/}
        <div>
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-amber-600 transition-colors"
            onClick={() => setAdvancedOpen((v) => !v)}
            aria-expanded={advancedOpen}
          >
            <Sliders className="h-3.5 w-3.5" />
            高级设置（可选）
            <ChevronDown
              className={cn('h-3.5 w-3.5 transition-transform', advancedOpen && 'rotate-180')}
            />
          </button>

          {advancedOpen && (
            <div className="mt-3 p-3 rounded-xl bg-gray-50/80 border border-gray-100 space-y-3">
              <p className="text-[11px] text-gray-400">
                不填则由 AI 自动决定。以下设置仅作用于这一次重新生成。
              </p>

              {/* 风格 */}
              <div>
                <label className="text-xs text-gray-500 font-medium">风格</label>
                <select
                  value={advanced.style ?? ''}
                  className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white focus:border-amber-400 focus:outline-none"
                  onChange={(e) =>
                    setAdvanced((p) => ({ ...p, style: e.target.value || undefined }))
                  }
                >
                  <option value="">AI 自动</option>
                  {STYLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* 时长 */}
              <div>
                <label className="text-xs text-gray-500 font-medium">时长（秒）</label>
                <input
                  type="number"
                  min={1}
                  value={advanced.durationSec ?? ''}
                  placeholder="AI 自动"
                  className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white focus:border-amber-400 focus:outline-none"
                  onChange={(e) =>
                    setAdvanced((p) => ({
                      ...p,
                      durationSec: e.target.value === '' ? undefined : Number(e.target.value),
                    }))
                  }
                />
              </div>

              {/* 模板 */}
              <div>
                <label className="text-xs text-gray-500 font-medium">镜头模板</label>
                <select
                  value={advanced.templateId ?? ''}
                  className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white focus:border-amber-400 focus:outline-none"
                  onChange={(e) =>
                    setAdvanced((p) => ({ ...p, templateId: e.target.value || undefined }))
                  }
                >
                  <option value="">AI 自动</option>
                  {TEMPLATE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        <Button
          className="w-full h-10 rounded-xl text-sm font-bold bg-amber-500 hover:bg-amber-600 text-white"
          disabled={busy}
          onClick={handleRegenerate}
        >
          {regenerating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              重新生成中...
            </>
          ) : regenHint ? (
            <>
              <CheckCircle2 className="h-4 w-4 mr-1.5" />
              已重新生成
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-1.5" />
              重新生成此版本
            </>
          )}
        </Button>
        <p className="text-[11px] text-gray-400 text-center">
          重新生成为 AI 动作，会消耗少量积分
        </p>
      </Card>

      {/* ── 重拍某个镜头 ── */}
      <Card className="mt-3 p-4 rounded-2xl border border-gray-100 space-y-3">
        <div className="flex items-center gap-2">
          <Clapperboard className="h-4 w-4 text-amber-500" />
          <h3 className="text-sm font-bold text-gray-800">重拍某个镜头</h3>
        </div>
        <p className="text-xs text-gray-500">
          只重拍不满意的镜头，系统会自动重新合成受影响的片段，其它镜头无需重传。
        </p>

        {/* 重拍结果提示（含承接链扩散数量，需求 4.5 可解释）*/}
        {reshootResult && (
          <div className="p-2.5 bg-green-50 border border-green-100 rounded-lg text-xs text-green-700 flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>
              已基于受影响范围重新合成（共 {reshootResult.affectedCount} 个镜头组）。
              {reshootResult.hasContinuityChain && reshootResult.followUpCount > 0 && (
                <>
                  其中含 {reshootResult.followUpCount} 个后续镜头组（画面承接），已一并重算确保不断裂。
                </>
              )}
            </span>
          </div>
        )}

        {/* 镜头列表 */}
        {shotTasks.length === 0 ? (
          <p className="text-xs text-gray-400">暂无可重拍的镜头</p>
        ) : (
          <div className="space-y-2">
            {shotTasks.map((task) => {
              const isSelected = selectedShotId === task.id
              return (
                <button
                  key={task.id}
                  type="button"
                  disabled={busy}
                  className={cn(
                    'w-full text-left p-3 rounded-xl border transition-all',
                    isSelected
                      ? 'border-amber-300 bg-amber-50/40'
                      : 'border-gray-100 hover:border-amber-200',
                    busy && 'opacity-60 cursor-not-allowed'
                  )}
                  onClick={() => setSelectedShotId(isSelected ? null : task.id)}
                >
                  <div className="flex items-center gap-2">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center">
                      {task.order}
                    </span>
                    <span className="text-sm font-medium text-gray-800 truncate">{task.title}</span>
                    <span className="ml-auto text-xs text-gray-400 flex-shrink-0">
                      {task.durationSec}秒
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500 line-clamp-2">{task.instruction}</p>
                </button>
              )
            })}
          </div>
        )}

        {/* 重拍按钮（选中镜头后出现）*/}
        {selectedShot && (
          <Button
            className="w-full h-10 rounded-xl text-sm font-bold bg-amber-500 hover:bg-amber-600 text-white"
            disabled={busy}
            onClick={() => setPendingReshoot(selectedShot)}
          >
            {reshooting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                重拍合成中...
              </>
            ) : (
              <>
                <Camera className="h-4 w-4 mr-1.5" />
                重拍「{selectedShot.title}」
              </>
            )}
          </Button>
        )}
        <p className="text-[11px] text-gray-400 text-center">
          重拍合成为 AI 动作，会消耗少量积分
        </p>
      </Card>

      {/* 重拍二次确认（承接链提示，需求 4.5）*/}
      {pendingReshoot && (
        <ReshootConfirmDialog
          shotTitle={pendingReshoot.title}
          onConfirm={handleConfirmReshoot}
          onCancel={() => setPendingReshoot(null)}
        />
      )}
    </div>
  )
}

// ─── 重拍二次确认对话框 ───

function ReshootConfirmDialog({
  shotTitle,
  onConfirm,
  onCancel,
}: {
  shotTitle: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 text-amber-600">
          <AlertTriangle className="h-5 w-5" />
          <h3 className="text-base font-bold">确认重拍这个镜头？</h3>
        </div>

        <p className="mt-3 text-sm text-gray-600">
          系统会重新合成「{shotTitle}」所在的片段。
          若该镜头与后续镜头是同一场景且画面相互承接，会<span className="font-medium text-amber-600">一并重算后续镜头组</span>，确保画面接得上、不断裂。
        </p>
        <p className="mt-2 text-xs text-gray-400">该操作为 AI 动作，会消耗少量积分。</p>

        <div className="mt-5 flex gap-3">
          <Button variant="outline" className="flex-1 h-10 rounded-xl text-sm" onClick={onCancel}>
            取消
          </Button>
          <Button
            className="flex-1 h-10 rounded-xl text-sm bg-amber-500 hover:bg-amber-600 text-white"
            onClick={onConfirm}
          >
            <Camera className="h-4 w-4 mr-1.5" />
            确认重拍
          </Button>
        </div>
      </div>
    </div>
  )
}
