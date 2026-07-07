'use client'

/**
 * 内容溯源展示卡片（需求 5.1 / 5.3 / 5.5 / 5.6）
 *
 * 面向小白老板的「这条内容是怎么来的」可解释展示 + 画像调整入口，
 * 挂载于 brief 总览页 / today 页 / shoot 拍摄页。
 *
 * 三件套落点：
 *  - 可解释：拉取 GET /api/content-briefs/[briefId]/provenance，
 *    用通俗话术（references[].plainText，如「这条用了你的招牌『现熬8小时骨汤』」）
 *    展示本条 brief 引用了门店画像的哪些依据，绝不暴露字段名（需求 5.5）。
 *  - 无引用兜底：isGenericTemplate=true 时如实显示「通用模板」，不伪造溯源（需求 5.6）。
 *  - 可干预 + 可反哺：每条依据旁挂「调整」入口，调用
 *    PATCH /api/stores/[storeId]/profile/adjust 修改画像；并明确提示
 *    「仅对之后新生成的内容生效」，既不回溯改写本条与历史 brief（需求 5.3 / 5.4）。
 *
 * 设计红线（遵循 AGENTS.md 与需求 0）：真实接口、无 fallback、无伪造；
 * 暖色调、大圆角、日常用语、不暴露技术参数。
 */

import { useState } from 'react'
import useSWR from 'swr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Sparkles,
  Lightbulb,
  Quote,
  SlidersHorizontal,
  Info,
  CheckCircle2,
} from 'lucide-react'

// ========================
// 类型（与 playbook-engine 的 BriefProvenance 结构一致）
// ========================

/** 溯源引用所属的画像字段类别 */
type ProvenanceField = 'sellingPoint' | 'hookKeyword' | 'persona' | 'cta'

/** 单条画像引用 */
interface ProvenanceReference {
  field: ProvenanceField
  value: string
  usedIn: 'hook' | 'caption' | 'title' | 'cta' | 'shot'
  /** 通俗话术（不暴露字段名） */
  plainText: string
}

/** GET /api/content-briefs/[briefId]/provenance 响应中的 provenance */
interface BriefProvenance {
  references: ProvenanceReference[]
  isGenericTemplate: boolean
}

// ========================
// 字段友好标签（日常用语，不暴露 field 原始名 —— 需求 5.5）
// ========================

/** 画像字段类别 → 商家可懂的中文称呼 */
const FIELD_FRIENDLY_LABELS: Record<ProvenanceField, string> = {
  sellingPoint: '招牌卖点',
  hookKeyword: '开场话术',
  persona: '人设',
  cta: '引导下单的话',
}

// ========================
// 数据获取
// ========================

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: '请求失败' } }))
    throw new Error(err.error?.message || '请求失败')
  }
  return res.json()
}

// ========================
// 画像调整对话框
// ========================
//
// 针对某条「不准确」的画像依据提供调整：
//  - 招牌卖点 / 人设 / 引导下单的话：改写为新内容（updateSellingPoints / updatePersona / updateCta）
//  - 开场话术：可直接剔除该钩子词（removeHookKeywords），不再用于后续内容
// 提交成功后强提示「仅对之后新生成的内容生效」（需求 5.3 / 5.4）。

function AdjustProfileDialog({
  storeId,
  reference,
  open,
  onOpenChange,
}: {
  storeId: string
  reference: ProvenanceReference | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [newValue, setNewValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const apiUrl = `/api/stores/${storeId}/profile/adjust`
  // 开场话术支持「直接剔除」；其余字段为「改写」
  const isHookKeyword = reference?.field === 'hookKeyword'

  // 关闭时重置内部状态，避免上次内容残留
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setNewValue('')
      setError(null)
      setDone(false)
    }
    onOpenChange(next)
  }

  // 构造画像调整 patch（仅提交本条依据对应的字段）
  const buildPatch = (): Record<string, unknown> | null => {
    if (!reference) return null
    switch (reference.field) {
      case 'hookKeyword':
        // 剔除该钩子词
        return { removeHookKeywords: [reference.value] }
      case 'sellingPoint':
        if (!newValue.trim()) return null
        return { updateSellingPoints: [{ from: reference.value, to: newValue.trim() }] }
      case 'persona':
        if (!newValue.trim()) return null
        return { updatePersona: newValue.trim() }
      case 'cta':
        if (!newValue.trim()) return null
        return { updateCta: [newValue.trim()] }
      default:
        return null
    }
  }

  const handleSubmit = async () => {
    const patch = buildPatch()
    if (!patch) {
      setError('请先填写新的内容')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(apiUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error?.message || '调整失败，请稍后再试')
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '调整失败，请稍后再试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5 text-amber-900">
            <SlidersHorizontal className="h-4 w-4 text-amber-500" />
            {isHookKeyword ? '移除开场话术' : '调整门店画像'}
          </DialogTitle>
          <DialogDescription>
            {reference
              ? isHookKeyword
                ? `这句「${FIELD_FRIENDLY_LABELS[reference.field]}」不准确？确认后将不再用于新内容。`
                : `这条「${FIELD_FRIENDLY_LABELS[reference.field]}」不准确？在这里改一下。`
              : ''}
          </DialogDescription>
        </DialogHeader>

        {reference && !done && (
          <div className="space-y-4">
            {/* 当前依据展示 */}
            <div className="rounded-xl bg-amber-50 border border-amber-100 p-3">
              <div className="text-xs text-amber-700 mb-1">现在用的是</div>
              <div className="flex items-start gap-1.5 text-sm text-gray-800">
                <Quote className="h-3.5 w-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                <span className="font-medium">{reference.value}</span>
              </div>
            </div>

            {/* 剔除（钩子词）或改写（其余字段） */}
            {isHookKeyword ? (
              <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 text-sm text-gray-600 leading-relaxed">
                确认后，这句开场话术将不再用于以后新生成的内容。
              </div>
            ) : (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">改成新的内容</label>
                <textarea
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  rows={3}
                  placeholder={`输入新的${FIELD_FRIENDLY_LABELS[reference.field]}`}
                  className="w-full rounded-xl border border-amber-200 bg-white p-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-300"
                />
              </div>
            )}

            {/* 仅对后续生效的强提示（需求 5.3 / 5.4） */}
            <div className="flex items-start gap-1.5 rounded-xl bg-blue-50 border border-blue-100 p-3 text-xs text-blue-700 leading-relaxed">
              <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <span>调整只对之后新生成的内容生效，这条以及之前已生成的内容不会改变。</span>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={loading}
                className="flex-1 border-amber-200 text-amber-800 hover:bg-amber-50 rounded-xl"
              >
                取消
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={loading || (!isHookKeyword && !newValue.trim())}
                className="flex-1 bg-orange-600 hover:bg-orange-700 text-white rounded-xl"
              >
                {loading ? <Spinner size="sm" /> : isHookKeyword ? '确认剔除' : '保存调整'}
              </Button>
            </div>
          </div>
        )}

        {/* 调整成功反馈 */}
        {done && (
          <div className="flex flex-col items-center gap-3 py-4">
            <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle2 className="h-7 w-7 text-green-500" />
            </div>
            <p className="text-sm font-medium text-gray-800">画像已调整</p>
            <p className="text-xs text-gray-500 text-center leading-relaxed">
              仅对之后新生成的内容生效，这条以及之前的内容保持不变。
            </p>
            <Button
              onClick={() => handleOpenChange(false)}
              className="bg-orange-600 hover:bg-orange-700 text-white rounded-xl"
            >
              知道了
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ========================
// 主卡片
// ========================

export function BriefProvenanceCard({
  storeId,
  briefId,
  className,
}: {
  storeId: string
  briefId: string
  className?: string
}) {
  const { data, error, isLoading } = useSWR<{ provenance: BriefProvenance }>(
    briefId ? `/api/content-briefs/${briefId}/provenance` : null,
    fetcher,
    { revalidateOnFocus: false }
  )

  // 调整对话框状态
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [activeRef, setActiveRef] = useState<ProvenanceReference | null>(null)

  const openAdjust = (ref: ProvenanceReference) => {
    setActiveRef(ref)
    setAdjustOpen(true)
  }

  // 加载中
  if (isLoading) {
    return (
      <Card className={`border-amber-100 rounded-2xl ${className ?? ''}`}>
        <CardContent className="flex items-center justify-center gap-2 py-5 text-sm text-gray-400">
          <Spinner size="sm" />
          正在分析这条内容的灵感来源...
        </CardContent>
      </Card>
    )
  }

  // 加载失败：不阻断主流程，仅轻提示（不伪造溯源）
  if (error || !data?.provenance) {
    return (
      <Card className={`border-amber-100 rounded-2xl ${className ?? ''}`}>
        <CardContent className="py-4 text-sm text-gray-400">
          灵感来源加载失败，稍后可刷新查看。
        </CardContent>
      </Card>
    )
  }

  const { references, isGenericTemplate } = data.provenance

  return (
    <Card className={`border-amber-100 rounded-2xl ${className ?? ''}`}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-amber-900 text-base">
          <Sparkles className="h-4 w-4 text-amber-500" />
          这条内容是怎么来的
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 无引用：如实显示通用模板，不伪造（需求 5.6） */}
        {isGenericTemplate || references.length === 0 ? (
          <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
            <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1">
              <Lightbulb className="h-4 w-4 text-gray-400" />
              通用模板
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">
              这条内容用的是通用模板，还没特别用上你门店的招牌卖点。完善门店画像后，
              以后新生成的内容会更贴合你的店。
            </p>
          </div>
        ) : (
          <>
            {/* 通俗话术展示每条画像引用（需求 5.1 / 5.5） */}
            <p className="text-xs text-gray-500">本条内容使用了以下门店信息：</p>
            <ul className="space-y-1.5">
              {references.map((ref, idx) => (
                <li
                  key={`${ref.field}-${idx}`}
                  className="flex items-center justify-between gap-2 rounded-lg bg-amber-50/60 border border-amber-100 px-3 py-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[11px] text-amber-600 font-medium flex-shrink-0">{FIELD_FRIENDLY_LABELS[ref.field]}</span>
                    <span className="text-sm text-gray-800 truncate">『{ref.value}』</span>
                  </div>
                  {/* 可干预入口：开场话术只能移除，其余字段可调整 */}
                  <button
                    onClick={() => openAdjust(ref)}
                    className="flex-shrink-0 text-xs text-amber-600 hover:text-amber-700 hover:underline whitespace-nowrap"
                  >
                    {ref.field === 'hookKeyword' ? '移除' : '调整'}
                  </button>
                </li>
              ))}
            </ul>
            {/* 调整仅对后续生效的总说明（需求 5.3 / 5.4） */}
            <p className="text-[11px] text-gray-400 leading-relaxed">
              调整仅对之后新生成的内容生效，不影响当前和已有内容。
            </p>
          </>
        )}
      </CardContent>

      {/* 画像调整对话框 */}
      <AdjustProfileDialog
        storeId={storeId}
        reference={activeRef}
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
      />
    </Card>
  )
}
