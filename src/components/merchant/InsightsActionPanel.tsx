'use client'

/**
 * 复盘建议「应用到下周计划」面板（需求 1.3, 1.7 — 可反哺）
 *
 * 把 performance-learning-service 产出的「推荐下周目标 / 复用剧本 / 规避剧本」从只读展示
 * 改造为可一键应用：商家勾选后写入下一轮内容计划的生成输入（PlanGenerationInput），
 * 下一轮生成时会标注「已采纳上轮复盘建议:<摘要>」，形成可见的反馈闭环。
 *
 * 调用 POST /api/stores/{storeId}/insights/apply（纯写库，不消耗积分）。
 *
 * 小白默认体验：
 * - 推荐目标用通俗标签（引流/促销/新品…）展示，可逐项勾选；
 * - 复用/规避剧本不暴露技术 ID，聚合为「多拍这类内容 / 少拍这类内容」整体开关。
 *
 * Requirements: 1.3, 1.7
 */

import { useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Check, Sparkles, ThumbsUp, ThumbsDown } from 'lucide-react'
import { cn } from '@/lib/shared/utils'
import type { ContentGoal } from '@/types/merchant'

/** 内容目标通俗标签（与 today/calendar 页保持一致，不暴露字段名） */
const GOAL_LABELS: Record<string, string> = {
  TRAFFIC: '午餐引流',
  PROMOTION: '爆品促销',
  NEW_PRODUCT: '招牌新品',
  TRUST_BUILDING: '人设建设',
  BRAND_STORY: '品牌故事',
  CUSTOMER_TESTIMONIAL: '顾客口碑',
  WEEKEND_BOOST: '周末预热',
  REPEAT_PURCHASE: '家庭聚餐',
}

interface InsightsActionPanelProps {
  storeId: string
  /** 推荐下周目标（来自 insights.recommendedNextGoals） */
  recommendedNextGoals: ContentGoal[]
  /** 建议复用的剧本 ID（来自 insights.playbooksToReuse，不直接展示给用户） */
  playbooksToReuse: string[]
  /** 建议规避的剧本 ID（来自 insights.playbooksToAvoid，不直接展示给用户） */
  playbooksToAvoid: string[]
  /** 可选的风格 ID 列表（用于风格偏好反哺） */
  availableStyleIds?: string[]
}

export function InsightsActionPanel({
  storeId,
  recommendedNextGoals,
  playbooksToReuse,
  playbooksToAvoid,
  availableStyleIds,
}: InsightsActionPanelProps) {
  // 选中的下周目标
  const [selectedGoals, setSelectedGoals] = useState<Set<ContentGoal>>(new Set())
  // 是否采纳「多拍表现好的内容套路」
  const [reuseChecked, setReuseChecked] = useState(false)
  // 是否采纳「少拍表现差的内容套路」
  const [avoidChecked, setAvoidChecked] = useState(false)
  // 风格偏好：多选
  const [preferredStyles, setPreferredStyles] = useState<Set<string>>(new Set())
  const [avoidedStyles, setAvoidedStyles] = useState<Set<string>>(new Set())
  // 提交中 / 已采纳
  const [submitting, setSubmitting] = useState(false)
  const [applied, setApplied] = useState(false)

  const hasReuse = playbooksToReuse.length > 0
  const hasAvoid = playbooksToAvoid.length > 0
  const hasStyles = (availableStyleIds?.length ?? 0) > 0
  const hasAnyContent = recommendedNextGoals.length > 0 || hasReuse || hasAvoid || hasStyles

  // 无任何可应用项时不渲染面板（不展示空壳）
  if (!hasAnyContent) return null

  const nothingSelected = selectedGoals.size === 0 && !reuseChecked && !avoidChecked && preferredStyles.size === 0 && avoidedStyles.size === 0

  function toggleGoal(goal: ContentGoal) {
    setSelectedGoals((prev) => {
      const next = new Set(prev)
      if (next.has(goal)) next.delete(goal)
      else next.add(goal)
      return next
    })
    setApplied(false)
  }

  /** 组装采纳摘要（用于下一轮计划上的「已采纳上轮复盘建议」标注） */
  function buildSummaries(): string[] {
    const summaries: string[] = []
    for (const goal of selectedGoals) {
      summaries.push(`下周多做「${GOAL_LABELS[goal] ?? goal}」内容`)
    }
    if (reuseChecked) summaries.push('沿用近期表现好的内容套路')
    if (avoidChecked) summaries.push('避开近期表现差的内容套路')
    if (preferredStyles.size > 0) summaries.push(`偏好风格: ${preferredStyles.size} 种`)
    if (avoidedStyles.size > 0) summaries.push(`回避风格: ${avoidedStyles.size} 种`)
    return summaries
  }

  async function handleApply() {
    if (nothingSelected) {
      toast.warning('请先勾选要应用的建议')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/stores/${storeId}/insights/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acceptedNextGoals: Array.from(selectedGoals),
          reusePlaybookIds: reuseChecked ? playbooksToReuse : undefined,
          avoidPlaybookIds: avoidChecked ? playbooksToAvoid : undefined,
          acceptedSuggestionSummaries: buildSummaries(),
          // 风格偏好反哺
          ...(preferredStyles.size > 0 || avoidedStyles.size > 0
            ? { stylePreference: { preferredStyleIds: Array.from(preferredStyles), avoidedStyleIds: Array.from(avoidedStyles) } }
            : {}),
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: '应用失败' } }))
        throw new Error(err.error?.message || '应用失败')
      }

      setApplied(true)
      toast.success('已采纳，将在下一轮内容计划生效')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '应用失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="border-white/10 bg-white/[0.03]">
      <CardContent className="p-4 space-y-4">
        {/* 标题 */}
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-white/50" />
          <h3 className="text-base font-semibold text-[var(--ll-text)]">下周怎么做</h3>
        </div>
        <p className="text-xs text-[var(--ll-text-3)] -mt-2">
          勾选下面的建议，一键应用到下周内容计划，系统会自动据此安排选题。
        </p>

        {/* 推荐下周目标 */}
        {recommendedNextGoals.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-[var(--ll-text-2)]">推荐下周多拍的方向</div>
            <div className="flex flex-wrap gap-2">
              {recommendedNextGoals.map((goal) => {
                const selected = selectedGoals.has(goal)
                return (
                  <button
                    key={goal}
                    type="button"
                    onClick={() => toggleGoal(goal)}
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                      selected
                        ? 'bg-white text-black'
                        : 'bg-white/5 text-[var(--ll-text)] border border-white/10 hover:bg-white/10'
                    }`}
                  >
                    {selected && <Check className="h-3.5 w-3.5" />}
                    {GOAL_LABELS[goal] ?? goal}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* 复用 / 规避剧本（聚合开关，不暴露技术 ID） */}
        {(hasReuse || hasAvoid) && (
          <div className="space-y-2">
            {hasReuse && (
              <ToggleRow
                icon={<ThumbsUp className="h-4 w-4 text-green-400" />}
                title="多拍表现好的内容套路"
                desc={`系统发现 ${playbooksToReuse.length} 类内容近期表现不错，下周多安排同类`}
                checked={reuseChecked}
                onToggle={() => {
                  setReuseChecked((v) => !v)
                  setApplied(false)
                }}
              />
            )}
            {hasAvoid && (
              <ToggleRow
                icon={<ThumbsDown className="h-4 w-4 text-red-400" />}
                title="少拍表现差的内容套路"
                desc={`系统发现 ${playbooksToAvoid.length} 类内容近期表现欠佳，下周少安排同类`}
                checked={avoidChecked}
                onToggle={() => {
                  setAvoidChecked((v) => !v)
                  setApplied(false)
                }}
              />
            )}
          </div>
        )}

        {/* 风格偏好（屏 D → 屏 C 闭环） */}
        {hasStyles && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-[var(--ll-text-2)]">风格偏好（可选）</div>
            <div className="flex flex-wrap gap-2">
              {availableStyleIds!.map((sid) => {
                const isPref = preferredStyles.has(sid)
                const isAvoid = avoidedStyles.has(sid)
                return (
                  <div key={sid} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setPreferredStyles((p) => {
                          const n = new Set(p)
                          if (n.has(sid)) n.delete(sid)
                          else n.add(sid)
                          return n
                        })
                        setAvoidedStyles((a) => {
                          const n = new Set(a)
                          n.delete(sid)
                          return n
                        })
                        setApplied(false)
                      }}
                      className={cn(
                        'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                        isPref ? 'bg-white text-black' : 'bg-white/5 text-[var(--ll-text-2)] border border-white/10 hover:bg-white/10'
                      )}
                    >
                      {isPref && <Check className="inline h-3 w-3 mr-0.5" />}
                      {sid}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAvoidedStyles((a) => {
                          const n = new Set(a)
                          if (n.has(sid)) n.delete(sid)
                          else n.add(sid)
                          return n
                        })
                        setPreferredStyles((p) => {
                          const n = new Set(p)
                          n.delete(sid)
                          return n
                        })
                        setApplied(false)
                      }}
                      className={cn(
                        'rounded-full px-1.5 py-1 text-xs transition-colors',
                        isAvoid ? 'bg-red-900/40 text-red-300 border border-red-800/40' : 'text-white/30 hover:text-white/50'
                      )}
                      title="回避此风格"
                    >
                      <ThumbsDown className="h-3 w-3" />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* 应用按钮 */}
        <Button
          onClick={handleApply}
          disabled={submitting || nothingSelected}
          className="w-full bg-white text-black hover:bg-white/90"
        >
          {submitting ? (
            <>
              <Spinner size="sm" className="mr-2" />
              应用中…
            </>
          ) : applied ? (
            <>
              <Check className="mr-2 h-4 w-4" />
              已采纳（可再次调整后重新应用）
            </>
          ) : (
            '应用到下周计划'
          )}
        </Button>
      </CardContent>
    </Card>
  )
}

// ========================
// 开关行
// ========================

function ToggleRow({
  icon,
  title,
  desc,
  checked,
  onToggle,
}: {
  icon: React.ReactNode
  title: string
  desc: string
  checked: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
        checked ? 'border-white/30 bg-white/[0.08]' : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'
      }`}
    >
      <div className="mt-0.5 flex-shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[var(--ll-text)]">{title}</div>
        <div className="text-xs text-[var(--ll-text-3)] leading-relaxed">{desc}</div>
      </div>
      {/* 勾选指示 */}
      <div
        className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border ${
          checked ? 'border-white/50 bg-white/20' : 'border-white/20 bg-transparent'
        }`}
      >
        {checked && <Check className="h-3.5 w-3.5 text-white" />}
      </div>
    </button>
  )
}
