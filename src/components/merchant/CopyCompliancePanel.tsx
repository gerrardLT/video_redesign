'use client'

/**
 * CopyCompliancePanel — variants 页文案/合规可操作面板（需求 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8）
 *
 * 独立子组件，挂载于版本导出页（variants）选中某版本后的文案区，承载「文案与合规」三件套交互：
 * - 可干预：就地编辑标题/封面文字/正文/标签/CTA 并保存回 ContentBrief.platformCopies；
 *           「重新生成文案」「按平台改写」一键产出新文案。
 * - 人工修改保护：当目标文案存在人工修改标记时，重新生成/按平台改写先弹二次确认，
 *           确认后带 confirmOverwrite=true 重试，覆盖并清除人工修改标记（需求 2.3, 2.8）。
 * - 可解释 + 可反哺：合规结果为 BLOCKED/HIGH 时展示命中违禁词与 evidence（reason），
 *           并挂「一键改写规避」按钮；改写后展示重跑合规结果与剩余风险（stillBlocked）。
 *
 * 调用 API：
 * - PUT  /api/content-briefs/{briefId}/copy                  就地保存（不消耗积分）
 * - POST /api/content-briefs/{briefId}/copy/regenerate       重新生成（消耗积分，409 需确认覆盖）
 * - POST /api/content-briefs/{briefId}/copy/rewrite-platform 按平台改写（消耗积分，409 需确认覆盖）
 * - POST /api/content-briefs/{briefId}/compliance/rewrite    一键改写规避 + 自动重跑合规（消耗积分）
 *
 * 设计原则：暖色调、大圆角、日常用语、隐藏技术参数（面向不懂拍视频的小店老板）。
 *
 * Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8
 */

import { useEffect, useState, useCallback } from 'react'
import {
  Loader2,
  Save,
  Sparkles,
  Wand2,
  ShieldAlert,
  ShieldX,
  ShieldCheck,
  AlertTriangle,
  X,
  Plus,
  RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/shared/utils'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

// ─── 类型定义（与后端 PlatformCopy / ComplianceCheck 契约对齐）───

/** 单平台文案 */
export interface PlatformCopy {
  title: string
  coverTitle: string
  caption: string
  tags: string[]
  cta: string
}

/** 合规命中项（evidence：matchedText 命中词 + reason 原因）*/
export interface ComplianceIssue {
  dimension: string
  riskLevel: string
  field: string
  matchedText?: string
  reason: string
}

/** 合规检查记录 */
export interface ComplianceCheck {
  id: string
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED'
  passed: boolean
  blockedReasons: string[] | null
  acknowledgedAt: string | null
  issues: ComplianceIssue[] | null
}

interface CopyCompliancePanelProps {
  /** 内容任务 ID */
  briefId: string
  /** 当前选中版本 ID（用于一键改写规避的合规重跑入参） */
  variantId: string
  /** 当前选中版本最近一次合规检查（用于展示命中词与 evidence） */
  compliance: ComplianceCheck | null
  /** 各平台文案（来自 ContentBrief.platformCopies） */
  platformCopies: Record<string, PlatformCopy> | null
  /** 文案变化后回调（刷新 brief 文案） */
  onCopiesChanged: () => void
  /** 合规结果变化后回调（刷新版本及其合规检查） */
  onComplianceChanged: () => void
}

// ─── 平台中文名 ───

const PLATFORM_LABELS: Record<string, string> = {
  DOUYIN: '抖音',
  XIAOHONGSHU: '小红书',
  WECHAT_CHANNELS: '视频号',
  KUAISHOU: '快手',
  MANUAL_EXPORT: '通用',
}

// ─── 待覆盖确认的动作类型 ───

type OverwriteAction = {
  /** 目标接口路径片段 */
  endpoint: 'regenerate' | 'rewrite-platform'
  /** 动作中文名（用于确认提示与按钮 loading 标识） */
  label: string
}

// ─── 主面板组件 ───

export function CopyCompliancePanel({
  briefId,
  variantId,
  compliance,
  platformCopies,
  onCopiesChanged,
  onComplianceChanged,
}: CopyCompliancePanelProps) {
  const platforms = platformCopies ? Object.keys(platformCopies) : []
  const [activePlatform, setActivePlatform] = useState<string>(platforms[0] ?? 'DOUYIN')

  // 当前编辑草稿（就地编辑的本地副本）
  const [draft, setDraft] = useState<PlatformCopy | null>(null)
  const [dirty, setDirty] = useState(false)
  const [tagInput, setTagInput] = useState('')

  // 各类操作状态
  const [saving, setSaving] = useState(false)
  const [producing, setProducing] = useState<null | 'regenerate' | 'rewrite-platform'>(null)
  const [rewritingCompliance, setRewritingCompliance] = useState(false)

  // 反馈信息
  const [error, setError] = useState<string | null>(null)
  const [savedHint, setSavedHint] = useState(false)

  // 二次确认（覆盖人工修改）
  const [pendingOverwrite, setPendingOverwrite] = useState<OverwriteAction | null>(null)

  // 一键改写规避结果（rewrittenCopy + 重跑合规 + 剩余风险）
  const [complianceResult, setComplianceResult] = useState<{
    rewrittenCopy: PlatformCopy
    recheck: ComplianceCheck
    stillBlocked: boolean
  } | null>(null)

  // 切换平台或外部文案更新时，同步草稿
  const activeCopy = platformCopies?.[activePlatform] ?? null
  useEffect(() => {
    if (activeCopy) {
      setDraft({ ...activeCopy, tags: [...activeCopy.tags] })
      setDirty(false)
    } else {
      setDraft(null)
    }
    // 切换平台时清空临时反馈
    setError(null)
    setSavedHint(false)
    // 仅在平台切换或文案内容引用变化时重置草稿
     
  }, [activePlatform, activeCopy])

  // ─── 草稿字段更新 ───
  const updateField = useCallback(<K extends keyof PlatformCopy>(field: K, value: PlatformCopy[K]) => {
    setDraft((prev) => (prev ? { ...prev, [field]: value } : prev))
    setDirty(true)
    setSavedHint(false)
  }, [])

  const addTag = useCallback(() => {
    const t = tagInput.trim().replace(/^#/, '')
    if (!t) return
    setDraft((prev) => {
      if (!prev) return prev
      if (prev.tags.includes(t)) return prev
      return { ...prev, tags: [...prev.tags, t] }
    })
    setTagInput('')
    setDirty(true)
    setSavedHint(false)
  }, [tagInput])

  const removeTag = useCallback((tag: string) => {
    setDraft((prev) => (prev ? { ...prev, tags: prev.tags.filter((x) => x !== tag) } : prev))
    setDirty(true)
    setSavedHint(false)
  }, [])

  // ─── 就地保存（PUT copy，不消耗积分）───
  const handleSave = useCallback(async () => {
    if (!draft) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/content-briefs/${briefId}/copy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: activePlatform, copy: draft }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error?.message || '保存失败')
        return
      }
      setDirty(false)
      setSavedHint(true)
      onCopiesChanged()
    } catch {
      setError('网络异常，请重试')
    } finally {
      setSaving(false)
    }
  }, [draft, briefId, activePlatform, onCopiesChanged])

  // ─── 重新生成 / 按平台改写（消耗积分；409 需二次确认覆盖人工修改）───
  const runProduce = useCallback(
    async (endpoint: 'regenerate' | 'rewrite-platform', confirmOverwrite: boolean) => {
      setProducing(endpoint)
      setError(null)
      setSavedHint(false)
      try {
        const res = await fetch(`/api/content-briefs/${briefId}/copy/${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platform: activePlatform, confirmOverwrite }),
        })
        const data = await res.json().catch(() => ({}))

        if (!res.ok) {
          // 存在人工修改且未确认覆盖 → 弹二次确认
          if (data?.error?.code === 'CONFIRM_OVERWRITE_REQUIRED') {
            setPendingOverwrite({
              endpoint,
              label: endpoint === 'regenerate' ? '重新生成文案' : '按平台改写',
            })
            return
          }
          if (data?.error?.code === 'INSUFFICIENT_CREDITS') {
            setError(data?.error?.message || '积分不足')
            return
          }
          setError(data?.error?.message || '操作失败')
          return
        }

        // 成功：preview 即已落库的新文案，载入编辑器并刷新
        if (data?.preview) {
          setDraft({ ...data.preview, tags: [...(data.preview.tags ?? [])] })
          setDirty(false)
        }
        onCopiesChanged()
      } catch {
        setError('网络异常，请重试')
      } finally {
        setProducing(null)
      }
    },
    [briefId, activePlatform, onCopiesChanged]
  )

  // 确认覆盖人工修改后重试（带 confirmOverwrite=true）
  const handleConfirmOverwrite = useCallback(() => {
    const action = pendingOverwrite
    setPendingOverwrite(null)
    if (action) {
      void runProduce(action.endpoint, true)
    }
  }, [pendingOverwrite, runProduce])

  // ─── 一键改写规避 + 自动重跑合规（消耗积分）───
  const handleComplianceRewrite = useCallback(async () => {
    setRewritingCompliance(true)
    setError(null)
    setComplianceResult(null)
    try {
      const res = await fetch(`/api/content-briefs/${briefId}/compliance/rewrite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoVariantId: variantId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data?.error?.code === 'INSUFFICIENT_CREDITS') {
          setError(data?.error?.message || '积分不足')
          return
        }
        setError(data?.error?.message || '一键改写失败')
        return
      }
      setComplianceResult({
        rewrittenCopy: data.rewrittenCopy,
        recheck: data.recheck,
        stillBlocked: data.stillBlocked,
      })
      onComplianceChanged()
    } catch {
      setError('网络异常，请重试')
    } finally {
      setRewritingCompliance(false)
    }
  }, [briefId, variantId, onComplianceChanged])

  // ─── 合规展示：优先采用改写后的重跑结果 ───
  const shownCompliance: ComplianceCheck | null = complianceResult?.recheck ?? compliance
  const riskLevel = shownCompliance?.riskLevel ?? null
  const needsRewrite = riskLevel === 'HIGH' || riskLevel === 'BLOCKED'
  const riskyIssues = (shownCompliance?.issues ?? []).filter(
    (i) => i.riskLevel === 'HIGH' || i.riskLevel === 'BLOCKED'
  )

  const busy = saving || producing !== null || rewritingCompliance

  if (!platformCopies || platforms.length === 0) {
    return (
      <div className="mt-6 p-4 rounded-xl border border-dashed border-gray-200 bg-gray-50/60 text-sm text-gray-500">
        该内容暂无平台文案，生成视频后即可在此编辑与改写。
      </div>
    )
  }

  return (
    <div className="mt-6">
      <h2 className="text-sm font-bold text-gray-800 mb-3">文案编辑与合规</h2>

      {/* 平台切换标签 */}
      <div className="flex gap-1.5 mb-3 overflow-x-auto">
        {platforms.map((platform) => (
          <button
            key={platform}
            className={cn(
              'flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all',
              activePlatform === platform
                ? 'bg-amber-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            )}
            onClick={() => setActivePlatform(platform)}
          >
            {PLATFORM_LABELS[platform] || platform}
          </button>
        ))}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
          {error}
        </div>
      )}

      {/* 合规命中区（BLOCKED/HIGH 时展示命中词与原因 + 一键改写规避）*/}
      {needsRewrite && (
        <ComplianceRiskBlock
          riskLevel={riskLevel}
          issues={riskyIssues}
          rewriting={rewritingCompliance}
          onRewrite={handleComplianceRewrite}
          disabled={busy}
        />
      )}

      {/* 一键改写规避结果（重跑合规 + 剩余风险）*/}
      {complianceResult && (
        <ComplianceRewriteResult result={complianceResult} />
      )}

      {/* 就地编辑表单 */}
      {draft && (
        <Card className="p-4 rounded-xl border border-gray-100 space-y-3">
          <EditField
            label="标题"
            value={draft.title}
            onChange={(v) => updateField('title', v)}
          />
          <EditField
            label="封面文字"
            value={draft.coverTitle}
            onChange={(v) => updateField('coverTitle', v)}
          />
          <EditField
            label="文案"
            value={draft.caption}
            multiline
            onChange={(v) => updateField('caption', v)}
          />

          {/* 标签（chips + 添加）*/}
          <div>
            <label className="text-xs text-gray-400 font-medium">标签</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {draft.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 text-xs rounded-full"
                >
                  #{tag}
                  <button
                    type="button"
                    className="hover:text-amber-900"
                    onClick={() => removeTag(tag)}
                    aria-label={`删除标签 ${tag}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <input
                type="text"
                value={tagInput}
                placeholder="输入标签后回车添加"
                className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-gray-200 focus:border-amber-400 focus:outline-none"
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addTag()
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-lg text-xs"
                onClick={addTag}
              >
                <Plus className="h-3 w-3 mr-1" />
                添加
              </Button>
            </div>
          </div>

          <EditField
            label="引导语（CTA）"
            value={draft.cta}
            onChange={(v) => updateField('cta', v)}
          />

          {/* 操作按钮 */}
          <div className="pt-2 border-t border-gray-100 space-y-2">
            <Button
              className="w-full h-10 rounded-xl text-sm font-bold bg-amber-500 hover:bg-amber-600 text-white"
              disabled={!dirty || busy}
              onClick={handleSave}
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  保存中...
                </>
              ) : savedHint ? (
                <>
                  <ShieldCheck className="h-4 w-4 mr-1.5" />
                  已保存
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-1.5" />
                  保存修改
                </>
              )}
            </Button>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 h-10 rounded-xl text-sm"
                disabled={busy}
                onClick={() => runProduce('regenerate', false)}
              >
                {producing === 'regenerate' ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-1.5" />
                )}
                重新生成文案
              </Button>
              <Button
                variant="outline"
                className="flex-1 h-10 rounded-xl text-sm"
                disabled={busy}
                onClick={() => runProduce('rewrite-platform', false)}
              >
                {producing === 'rewrite-platform' ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : (
                  <Wand2 className="h-4 w-4 mr-1.5" />
                )}
                按平台改写
              </Button>
            </div>
            <p className="text-[11px] text-gray-400 text-center">
              重新生成 / 按平台改写为 AI 动作，会消耗少量积分
            </p>
          </div>
        </Card>
      )}

      {/* 二次确认对话框（覆盖人工修改）*/}
      {pendingOverwrite && (
        <OverwriteConfirmDialog
          label={pendingOverwrite.label}
          onConfirm={handleConfirmOverwrite}
          onCancel={() => setPendingOverwrite(null)}
        />
      )}
    </div>
  )
}

// ─── 可编辑字段 ───

function EditField({
  label,
  value,
  multiline,
  onChange,
}: {
  label: string
  value: string
  multiline?: boolean
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="text-xs text-gray-400 font-medium">{label}</label>
      {multiline ? (
        <textarea
          value={value}
          rows={4}
          className="mt-1 w-full px-3 py-2 text-sm text-gray-800 rounded-lg border border-gray-200 focus:border-amber-400 focus:outline-none resize-y leading-relaxed"
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          type="text"
          value={value}
          className="mt-1 w-full px-3 py-2 text-sm text-gray-800 rounded-lg border border-gray-200 focus:border-amber-400 focus:outline-none"
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  )
}

// ─── 合规风险展示 + 一键改写规避 ───

function ComplianceRiskBlock({
  riskLevel,
  issues,
  rewriting,
  onRewrite,
  disabled,
}: {
  riskLevel: string | null
  issues: ComplianceIssue[]
  rewriting: boolean
  onRewrite: () => void
  disabled: boolean
}) {
  const isBlocked = riskLevel === 'BLOCKED'
  return (
    <Card
      className={cn(
        'p-4 rounded-xl border-2 mb-3',
        isBlocked ? 'border-red-200 bg-red-50/50' : 'border-orange-200 bg-orange-50/50'
      )}
    >
      <div className={cn('flex items-center gap-2', isBlocked ? 'text-red-600' : 'text-orange-600')}>
        {isBlocked ? <ShieldX className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
        <h3 className="text-sm font-bold">
          {isBlocked ? '合规不通过，需先改写' : '存在合规风险，建议改写'}
        </h3>
      </div>

      {/* 命中违禁词 / 风险点（evidence：命中词 + 原因）*/}
      <div className="mt-3 space-y-2">
        {issues.length === 0 && (
          <p className="text-xs text-gray-500">检测到风险，请使用一键改写规避优化文案</p>
        )}
        {issues.map((issue, i) => (
          <div
            key={i}
            className={cn(
              'p-2 rounded-lg text-xs',
              isBlocked ? 'bg-white/70 text-red-700' : 'bg-white/70 text-orange-700'
            )}
          >
            <p className="font-medium">{issue.reason}</p>
            {issue.matchedText && (
              <p className="mt-0.5 opacity-80">命中表达：「{issue.matchedText}」</p>
            )}
          </div>
        ))}
      </div>

      <Button
        className={cn(
          'w-full h-10 rounded-xl text-sm font-bold mt-3 text-white',
          isBlocked ? 'bg-red-500 hover:bg-red-600' : 'bg-orange-500 hover:bg-orange-600'
        )}
        disabled={disabled}
        onClick={onRewrite}
      >
        {rewriting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
            改写中...
          </>
        ) : (
          <>
            <Wand2 className="h-4 w-4 mr-1.5" />
            一键改写规避
          </>
        )}
      </Button>
      <p className="text-[11px] text-gray-400 text-center mt-1.5">
        一键改写为 AI 动作，会消耗少量积分，改写后将自动重新检测
      </p>
    </Card>
  )
}

// ─── 一键改写规避结果（重跑合规 + 剩余风险）───

function ComplianceRewriteResult({
  result,
}: {
  result: { rewrittenCopy: PlatformCopy; recheck: ComplianceCheck; stillBlocked: boolean }
}) {
  const { rewrittenCopy, recheck, stillBlocked } = result
  const remainingIssues = (recheck.issues ?? []).filter(
    (i) => i.riskLevel === 'HIGH' || i.riskLevel === 'BLOCKED'
  )

  return (
    <Card
      className={cn(
        'p-4 rounded-xl border-2 mb-3',
        stillBlocked ? 'border-orange-200 bg-orange-50/50' : 'border-green-200 bg-green-50/50'
      )}
    >
      <div className={cn('flex items-center gap-2', stillBlocked ? 'text-orange-600' : 'text-green-600')}>
        {stillBlocked ? <ShieldAlert className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
        <h3 className="text-sm font-bold">
          {stillBlocked ? '已改写，但仍有剩余风险' : '改写完成，已通过合规检测'}
        </h3>
      </div>

      {/* 改写后的文案 */}
      <div className="mt-3 space-y-2 text-xs">
        <div>
          <span className="text-gray-400 font-medium">改写后标题：</span>
          <span className="text-gray-800">{rewrittenCopy.title}</span>
        </div>
        {rewrittenCopy.caption && (
          <div>
            <span className="text-gray-400 font-medium">改写后文案：</span>
            <p className="text-gray-700 mt-0.5 whitespace-pre-wrap leading-relaxed">
              {rewrittenCopy.caption}
            </p>
          </div>
        )}
      </div>

      {/* 剩余风险（如仍未通过，显式列出，不标记通过）*/}
      {stillBlocked && (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-medium text-orange-700 flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5" />
            剩余风险点（请继续手动调整）
          </p>
          {remainingIssues.map((issue, i) => (
            <div key={i} className="p-2 bg-white/70 rounded-lg text-xs text-orange-700">
              <p className="font-medium">{issue.reason}</p>
              {issue.matchedText && (
                <p className="mt-0.5 opacity-80">命中表达：「{issue.matchedText}」</p>
              )}
            </div>
          ))}
          {remainingIssues.length === 0 && (
            <p className="text-xs text-orange-600">仍存在风险，请进一步调整文案后重试</p>
          )}
        </div>
      )}
    </Card>
  )
}

// ─── 覆盖人工修改二次确认对话框 ───

function OverwriteConfirmDialog({
  label,
  onConfirm,
  onCancel,
}: {
  label: string
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
        <div className="flex items-center gap-2 text-orange-600">
          <AlertTriangle className="h-5 w-5" />
          <h3 className="text-base font-bold">将覆盖你的手动修改</h3>
        </div>

        <p className="mt-3 text-sm text-gray-600">
          当前文案是你手动编辑过的。「{label}」会用 AI 生成的新文案替换它，
          替换后无法恢复你的手动内容。确定要继续吗？
        </p>

        <div className="mt-5 flex gap-3">
          <Button variant="outline" className="flex-1 h-10 rounded-xl text-sm" onClick={onCancel}>
            取消
          </Button>
          <Button
            className="flex-1 h-10 rounded-xl text-sm bg-orange-500 hover:bg-orange-600 text-white"
            onClick={onConfirm}
          >
            <RefreshCw className="h-4 w-4 mr-1.5" />
            覆盖并继续
          </Button>
        </div>
      </div>
    </div>
  )
}
