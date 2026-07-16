'use client'

/**
 * 版本导出页 — /merchant/stores/[storeId]/briefs/[briefId]/variants
 *
 * 展示 ContentBrief 生成的 3 个视频版本（促销版/氛围版/口播版），
 * 商家可查看合规状态、各平台文案预览，并导出视频。
 *
 * 功能：
 * - 3 个 VideoVariant 卡片（促销版/氛围版/口播版）
 * - 每个卡片显示：缩略图、标题、时长、合规状态（ComplianceBadge）
 * - 选择版本后显示各平台文案预览
 * - 导出按钮（调用 POST /api/video-variants/{variantId}/export）
 * - 导出成功后显示下载链接（24h 有效）
 * - 合规 BLOCKED 时禁用导出 + 显示原因
 * - 合规 HIGH 时显示确认对话框
 *
 * API 调用：
 * - GET /api/content-briefs/{briefId}/variants
 * - POST /api/video-variants/{variantId}/export
 *
 * Requirements: 7.1, 8.1, 10.1, 10.2, 10.5, 15.2, 15.4
 */

import { useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import useSWR from 'swr'
import {
  Download,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Loader2,
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
  AlertTriangle,
  BarChart3,
  ChevronRight,
  Megaphone,
  Sparkles,
  Radio,
} from 'lucide-react'
import { cn } from '@/lib/shared/utils'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { CopyCompliancePanel } from '@/components/merchant/CopyCompliancePanel'
import { GenerationControlPanel } from '@/components/merchant/GenerationControlPanel'

// ─── 平台预设（内联避免引入过多依赖）───

type PlatformId = 'douyin_local' | 'xiaohongshu' | 'wechat_video' | 'universal'

interface PlatformPreset {
  id: PlatformId
  label: string
  ratio: string
  resolution: string
  maxDurationLabel: string | null
  tips: string
}

const PLATFORM_PRESETS: PlatformPreset[] = [
  { id: 'douyin_local', label: '抖音本地生活', ratio: '9:16', resolution: '1080x1920', maxDurationLabel: '45秒', tips: 'POI 标签加权，完播率 > 30%' },
  { id: 'xiaohongshu', label: '小红书', ratio: '3:4', resolution: '1080x1440', maxDurationLabel: '60秒', tips: '真实感 > 精修感' },
  { id: 'wechat_video', label: '视频号', ratio: '9:16', resolution: '1080x1920', maxDurationLabel: '90秒', tips: '社交裂变加权' },
  { id: 'universal', label: '通用', ratio: '9:16', resolution: '1080x1920', maxDurationLabel: null, tips: '适配多平台' },
]

// ─── 类型定义 ───

interface ComplianceCheck {
  id: string
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED'
  passed: boolean
  blockedReasons: string[] | null
  acknowledgedAt: string | null
  issues: ComplianceIssue[] | null
}

interface ComplianceIssue {
  dimension: string
  riskLevel: string
  field: string
  matchedText?: string
  reason: string
}

interface VideoVariant {
  id: string
  contentBriefId: string
  type: 'PROMOTION' | 'ATMOSPHERE' | 'OWNER_TALKING'
  title: string
  description: string | null
  ossKey: string | null
  coverOssKey: string | null
  durationSec: number | null
  subtitles: Array<{ text: string; startSec: number; endSec: number }> | null
  complianceChecks: ComplianceCheck[]
  createdAt: string
  // 渲染参数（renderParams.advancedParams 标注本次实际生效的高级参数，需求 4.7）
  renderParams?: Record<string, unknown> | null
  // 上次局部重渲染的受影响范围（需求 4.5 追溯）
  regenScope?: Record<string, unknown> | null
}

interface ExportResult {
  publishJobId: string
  downloadUrl: string
  expiresIn: number
  resolution: string
  tier: string
}

interface StyleRecommendation {
  id: string
  name: string
  description: string
  proTags: string[]
  conTags: string[]
  previewHint: string
}

// ─── SWR Fetcher ───

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || '请求失败')
  }
  return res.json()
}

// ─── 版本类型中文标签 ───

const VARIANT_TYPE_LABELS: Record<string, { label: string; desc: string; color: string }> = {
  PROMOTION: {
    label: '促销版',
    desc: '突出优惠价格，适合引流获客',
    color: 'bg-red-50 text-red-700 border-red-200',
  },
  ATMOSPHERE: {
    label: '氛围版',
    desc: '展示环境氛围，适合种草推荐',
    color: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  OWNER_TALKING: {
    label: '口播版',
    desc: '老板真诚推荐，适合建立信任',
    color: 'bg-purple-50 text-purple-700 border-purple-200',
  },
}

// ─── 平台中文名 ───

const PLATFORM_LABELS: Record<string, string> = {
  DOUYIN: '抖音',
  XIAOHONGSHU: '小红书',
  WECHAT_CHANNELS: '视频号',
  KUAISHOU: '快手',
}

// ─── 主页面组件 ───

export default function VariantsExportPage() {
  const params = useParams<{ storeId: string; briefId: string }>()
  const { storeId, briefId } = params

  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null)
  const [exportingId, setExportingId] = useState<string | null>(null)
  const [exportResults, setExportResults] = useState<Record<string, ExportResult>>({})
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [showHighRiskConfirm, setShowHighRiskConfirm] = useState<string | null>(null)
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformId | null>(null)

  // ─── 风格推荐状态（屏 C） ───
  const [selectedStyleId, setSelectedStyleId] = useState<string | null>(null)
  const [generateLoading, setGenerateLoading] = useState(false)

  // 获取 VideoVariants 列表
  const {
    data: variantsData,
    error: variantsError,
    isLoading: variantsLoading,
    mutate: mutateVariants,
  } = useSWR<{ variants: VideoVariant[] }>(
    `/api/content-briefs/${briefId}/variants`,
    fetcher
  )

  // 获取 ContentBrief 的文案信息
  const { data: briefData, mutate: mutateBrief } = useSWR<{ brief: { platformCopies: Record<string, PlatformCopy> | null } }>(
    `/api/content-briefs/${briefId}`,
    fetcher
  )

  const variants = variantsData?.variants ?? []
  const platformCopies = briefData?.brief?.platformCopies ?? null

  const selectedVariant = variants.find((v) => v.id === selectedVariantId) ?? null

  // 获取风格推荐（屏 C：无版本时展示）
  const { data: styleData } = useSWR<{ recommendations: StyleRecommendation[] }>(
    variants.length === 0 ? `/api/content-briefs/${briefId}/style-recommendations` : null,
    fetcher
  )
  const recommendations = styleData?.recommendations ?? []

  // ─── 生成选定风格 ───
  const handleGenerateStyle = useCallback(async (styleId: string) => {
    setGenerateLoading(true)
    setErrorMessage(null)
    try {
      const res = await fetch(`/api/content-briefs/${briefId}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedStyle: styleId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.message || '生成失败')
      // 触发 variants 刷新
      mutateVariants()
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : '未知错误')
    } finally {
      setGenerateLoading(false)
    }
  }, [briefId, mutateVariants])

  // ─── 导出视频 ───
  const handleExport = useCallback(async (variantId: string) => {
    setExportingId(variantId)
    setErrorMessage(null)

    try {
      const res = await fetch(`/api/video-variants/${variantId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedPlatform ? { platform: selectedPlatform } : {}),
      })

      const data = await res.json()

      if (!res.ok) {
        // 需要确认高风险
        if (data?.error?.code === 'COMPLIANCE_ACKNOWLEDGMENT_REQUIRED') {
          setShowHighRiskConfirm(variantId)
          setExportingId(null)
          return
        }
        setErrorMessage(data?.error?.message || '导出失败')
        setExportingId(null)
        return
      }

      setExportResults((prev) => ({ ...prev, [variantId]: data }))
    } catch {
      setErrorMessage('网络异常，请重试')
    } finally {
      setExportingId(null)
    }
  }, [])

  // ─── 确认高风险后导出 ───
  const handleConfirmHighRisk = useCallback(async (variantId: string) => {
    setShowHighRiskConfirm(null)

    // 先确认合规风险（API 接收 JSON body { complianceCheckId }）
    const variant = variants.find((v) => v.id === variantId)
    const complianceCheckId = variant?.complianceChecks?.[0]?.id
    if (complianceCheckId) {
      try {
        await fetch(`/api/content-briefs/${briefId}/compliance/acknowledge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ complianceCheckId }),
        })
      } catch {
        // 确认失败，继续尝试导出
      }
    }

    // 再次触发导出
    await handleExport(variantId)
    await mutateVariants()
  }, [variants, briefId, handleExport, mutateVariants])

  // ─── 加载 / 错误状态 ───
  if (variantsLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-white/50" />
        <p className="text-[var(--ll-text-3)] text-sm">加载中...</p>
      </div>
    )
  }

  if (variantsError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <XCircle className="h-10 w-10 text-red-400" />
        <p className="text-red-500">{variantsError.message || '加载失败'}</p>
        <Button variant="outline" onClick={() => mutateVariants()}>重试</Button>
      </div>
    )
  }

  if (variants.length === 0) {
    return (
      <div className="max-w-lg mx-auto px-4 pb-8">
        {/* 屏 C：风格推荐单选生成 */}
        <section className="py-5 border-b border-[var(--ll-hair)]">
          <p className="text-[11px] tracking-[.08em] text-[var(--ll-text-3)] font-medium uppercase">STUDIO</p>
          <h1 className="mt-1 text-xl font-semibold text-[var(--ll-text)]">选择风格生成</h1>
          <p className="text-sm text-[var(--ll-text-2)] mt-1">AI 推荐 3 种风格，选择一种开始生成</p>
        </section>

        {errorMessage && (
          <div className="mt-4 p-3 bg-red-900/20 border border-red-800/30 rounded-xl text-sm text-red-400">
            {errorMessage}
          </div>
        )}

        {/* 风格推荐卡片 */}
        <div className="mt-5 space-y-3">
          {recommendations.map((rec, idx) => (
            <button
              key={rec.id}
              className={cn(
                'w-full p-4 rounded-xl border text-left transition-all',
                selectedStyleId === rec.id
                  ? 'border-white/30 bg-white/[0.04]'
                  : 'border-white/10 bg-white/[0.01] hover:border-white/20',
              )}
              onClick={() => setSelectedStyleId(rec.id)}
            >
              <div className="flex items-center gap-3">
                {/* 单选圆圈 */}
                <div className={cn(
                  'w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all',
                  selectedStyleId === rec.id
                    ? 'border-white bg-white'
                    : 'border-white/20',
                )}>
                  {selectedStyleId === rec.id && (
                    <div className="w-2 h-2 rounded-full bg-black" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {idx === 0 && <Sparkles className="h-3.5 w-3.5 text-white/50" />}
                    <h3 className="text-sm font-bold text-[var(--ll-text)]">{rec.name}</h3>
                  </div>
                  <p className="text-xs text-[var(--ll-text-3)] mt-0.5">{rec.description}</p>
                  {/* 优缺点标签 */}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {rec.proTags.map(tag => (
                      <span key={tag} className="px-2 py-0.5 text-[10px] bg-white/5 text-white/50 rounded-full">+ {tag}</span>
                    ))}
                    {rec.conTags.map(tag => (
                      <span key={tag} className="px-2 py-0.5 text-[10px] bg-white/5 text-white/30 rounded-full">– {tag}</span>
                    ))}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* 生成按钮 */}
        {selectedStyleId && (
          <button
            className={cn(
              'w-full mt-5 py-3 rounded-xl text-sm font-bold transition-all',
              generateLoading
                ? 'bg-white/5 text-white/20 cursor-not-allowed'
                : 'bg-white text-black hover:bg-white/90 active:scale-[0.985]',
            )}
            disabled={generateLoading}
            onClick={() => handleGenerateStyle(selectedStyleId)}
          >
            {generateLoading ? (
              <span className="flex items-center justify-center gap-1.5">
                <Loader2 className="h-4 w-4 animate-spin" /> 生成中...
              </span>
            ) : (
              <>生成此版本 · 单版本积分更省</>
            )}
          </button>
        )}

        <p className="text-[11px] text-[var(--ll-text-3)] text-center mt-2">
          生成前会冻结预估积分，完成后多退少补
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto px-4 pb-8">
      {/* 编辑式标题 */}
      <section className="zen-reveal py-5 border-b border-[var(--ll-hair)]">
        <p className="text-[11px] tracking-[.08em] text-[var(--ll-text-3)] font-medium uppercase">VARIANTS</p>
        <h1 className="mt-1 text-xl font-semibold text-[var(--ll-text)]">选择版本导出</h1>
        <p className="text-sm text-[var(--ll-text-2)] mt-1">共生成 {variants.length} 个版本，选择合适的下载</p>
      </section>

      {/* 错误提示 */}
      {errorMessage && (
        <div className="mt-4 p-3 bg-red-900/20 border border-red-800/30 rounded-xl text-sm text-red-400">
          {errorMessage}
        </div>
      )}

      {/* 版本卡片列表 — 依次揭幕动画 + AI 推荐金色标记 */}
      <div className="mt-4 space-y-3">
        {variants.map((variant, idx) => (
          <div
            key={variant.id}
            style={{
              animation: `zenRevealBlur 0.7s ease-out ${idx * 400}ms both`,
            }}
          >
            <VariantCard
              variant={variant}
              isSelected={selectedVariantId === variant.id}
              isExporting={exportingId === variant.id}
              exportResult={exportResults[variant.id]}
              isRecommended={idx === 0}
              onSelect={() => setSelectedVariantId(
                selectedVariantId === variant.id ? null : variant.id
              )}
              onExport={() => handleExport(variant.id)}
            />
          </div>
        ))}
      </div>

      {/* 选中版本时：平台适配选择器 */}
      {selectedVariant && (
        <div className="mt-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-bold text-[var(--ll-text)]">导出平台</span>
            <span className="text-xs text-[var(--ll-text-3)]">选择目标平台，自动适配分辨率</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {PLATFORM_PRESETS.map((p) => (
              <button
                key={p.id}
                className={cn(
                  'p-3 rounded-xl border-2 text-left transition-all',
                  selectedPlatform === p.id
                    ? 'border-white/30 bg-white/[0.04]'
                    : 'border-white/10 hover:border-white/20',
                )}
                onClick={() => setSelectedPlatform(selectedPlatform === p.id ? null : p.id)}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-[var(--ll-text)]">{p.label}</span>
                  <span className="text-[10px] px-1.5 py-0.5 bg-white/5 rounded-full text-white/50">{p.ratio}</span>
                </div>
                <p className="text-[10px] text-[var(--ll-text-3)] mt-1">{p.resolution}{p.maxDurationLabel ? ` · ≤${p.maxDurationLabel}` : ''}</p>
                <p className="text-[10px] text-white/40 mt-0.5">{p.tips}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 选中版本时：文案就地编辑 + 合规可操作面板（任务 3.7） */}
      {selectedVariant && (
        <CopyCompliancePanel
          briefId={briefId}
          variantId={selectedVariant.id}
          compliance={selectedVariant.complianceChecks[0] ?? null}
          platformCopies={platformCopies}
          onCopiesChanged={() => { void mutateBrief() }}
          onComplianceChanged={() => { void mutateVariants() }}
        />
      )}

      {/* 选中版本时：生成可控性面板（任务 5.9）——
          重新生成此版本 / 重拍某镜头 / 高级抽屉（默认隐藏）/ 参数标注 / 承接链提示 */}
      {selectedVariant && (
        <GenerationControlPanel
          briefId={briefId}
          variant={selectedVariant}
          onVariantsChanged={() => { void mutateVariants() }}
        />
      )}

      {/* 已导出后：引导前往待发布清单完成发布（清单 + 提醒 + 手动标记，需求 8.2/8.5） */}
      {Object.keys(exportResults).length > 0 && (
        <Link
          href={`/merchant/stores/${storeId}/publish-queue`}
          className="block mt-6"
        >
          <Card className="p-4 rounded-2xl border border-white/10 bg-white/[0.02] flex items-center gap-3 hover:border-white/20 transition-all cursor-pointer">
            <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-white/5 text-white/60 flex items-center justify-center">
              <Megaphone className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-[var(--ll-text)]">去发布这条视频</h3>
              <p className="text-xs text-[var(--ll-text-3)] mt-0.5">复制文案、下载视频、跳转平台发布，发完回来标记一下</p>
            </div>
            <ChevronRight className="h-5 w-5 text-[var(--ll-text-3)] flex-shrink-0" />
          </Card>
        </Link>
      )}

      {/* 已导出后：引导发布后回填数据做复盘（接通数据复盘页） */}
      {Object.keys(exportResults).length > 0 && (
        <Link
          href={`/merchant/stores/${storeId}/briefs/${briefId}/metrics`}
          className="block mt-4"
        >
          <Card className="p-4 rounded-2xl border border-white/10 bg-white/[0.02] flex items-center gap-3 hover:border-white/20 transition-all cursor-pointer">
            <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-white/5 text-white/60 flex items-center justify-center">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-[var(--ll-text)]">发布后来回填数据</h3>
              <p className="text-xs text-[var(--ll-text-3)] mt-0.5">录入播放/转化数据，获取下一轮优化建议</p>
            </div>
            <ChevronRight className="h-5 w-5 text-[var(--ll-text-3)] flex-shrink-0" />
          </Card>
        </Link>
      )}

      {/* 高风险确认对话框 */}
      {showHighRiskConfirm && (
        <HighRiskConfirmDialog
          variantId={showHighRiskConfirm}
          variant={variants.find((v) => v.id === showHighRiskConfirm)!}
          onConfirm={handleConfirmHighRisk}
          onCancel={() => setShowHighRiskConfirm(null)}
        />
      )}
    </div>
  )
}

// ─── 版本卡片组件 ───

interface VariantCardProps {
  variant: VideoVariant
  isSelected: boolean
  isExporting: boolean
  exportResult?: ExportResult
  isRecommended?: boolean
  onSelect: () => void
  onExport: () => void
}

function VariantCard({
  variant,
  isSelected,
  isExporting,
  exportResult,
  isRecommended,
  onSelect,
  onExport,
}: VariantCardProps) {
  const typeConfig = VARIANT_TYPE_LABELS[variant.type] || {
    label: variant.type,
    desc: '',
    color: 'bg-white/5 text-[var(--ll-text)] border-white/10',
  }

  const compliance = variant.complianceChecks[0] ?? null
  const riskLevel = compliance?.riskLevel ?? null
  const isBlocked = riskLevel === 'BLOCKED'
  const blockedReasons = compliance?.blockedReasons ?? []

  return (
    <Card
      className={cn(
        'p-4 rounded-2xl border-2 transition-all cursor-pointer relative',
        isRecommended && 'border-t-[var(--ll-gold)] border-t-[3px]',
        isSelected && 'border-white/30 bg-white/[0.04] shadow-lg shadow-black/20',
        !isSelected && !isRecommended && 'border-white/10 hover:border-white/20',
        !isSelected && isRecommended && 'border-[var(--ll-gold)]/30 hover:border-[var(--ll-gold)]/60',
      )}
      onClick={onSelect}
    >
      {/* AI 推荐金色标记 */}
      {isRecommended && (
        <span className="absolute -top-3 left-4 inline-flex items-center gap-1 px-2 py-0.5 bg-[var(--ll-gold)] text-white text-[10px] font-bold rounded-full shadow-sm">
          <Sparkles className="h-3 w-3" /> AI 推荐
        </span>
      )}
      <div className="flex items-start gap-3">
        {/* 缩略图区域 */}
        <div className="flex-shrink-0 w-16 h-24 rounded-lg bg-white/5 flex items-center justify-center overflow-hidden">
          <Play className="h-6 w-6 text-white/30" />
        </div>

        {/* 信息区域 */}
        <div className="flex-1 min-w-0">
          {/* 版本标签 */}
          <span className={cn(
            'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border',
            typeConfig.color,
          )}>
            {typeConfig.label}
          </span>

          {/* 标题 */}
          <h3 className="mt-1.5 text-sm font-bold text-[var(--ll-text)] truncate">
            {variant.title}
          </h3>

          {/* 时长 + 描述 */}
          <div className="mt-1 flex items-center gap-2 text-xs text-[var(--ll-text-3)]">
            {variant.durationSec && (
              <span className="flex items-center gap-0.5">
                <Clock className="h-3 w-3" />
                {Math.round(variant.durationSec)}秒
              </span>
            )}
            <span>{typeConfig.desc}</span>
          </div>

          {/* 合规状态 */}
          <div className="mt-2">
            <ComplianceBadge riskLevel={riskLevel} />
          </div>

          {/* BLOCKED 时显示原因 */}
          {isBlocked && blockedReasons.length > 0 && (
            <div className="mt-2 space-y-1">
              {blockedReasons.map((reason, i) => (
                <p key={i} className="text-xs text-red-500 flex items-center gap-1">
                  <XCircle className="h-3 w-3 flex-shrink-0" />
                  {reason}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 展开时显示导出按钮 */}
      {isSelected && (
        <div className="mt-4 pt-3 border-t border-white/10">
          {/* 已导出 → 显示下载链接 */}
          {exportResult && (
            <div className="flex items-center gap-2 p-3 bg-green-900/20 rounded-xl">
              <CheckCircle2 className="h-5 w-5 text-green-400 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-green-400">导出完成</p>
                <p className="text-xs text-green-500 mt-0.5">
                  分辨率: {exportResult.resolution} · 24小时内有效
                </p>
              </div>
              <a
                href={exportResult.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 px-3 py-1.5 bg-green-500 text-white text-xs font-medium rounded-lg hover:bg-green-600 transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="h-3 w-3" />
                下载
              </a>
            </div>
          )}

          {/* 未导出 → 导出按钮 */}
          {!exportResult && (
            <Button
              className={cn(
                'w-full h-10 rounded-xl text-sm font-bold transition-all',
                isBlocked
                  ? 'bg-white/5 text-white/20 cursor-not-allowed'
                  : 'bg-white text-black hover:bg-white/90 shadow-md shadow-black/20',
              )}
              disabled={isBlocked || isExporting}
              onClick={(e) => {
                e.stopPropagation()
                onExport()
              }}
            >
              {isExporting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  导出中...
                </>
              ) : isBlocked ? (
                <>
                  <ShieldX className="h-4 w-4 mr-1.5" />
                  合规不通过，无法导出
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-1.5" />
                  导出视频
                </>
              )}
            </Button>
          )}
        </div>
      )}
    </Card>
  )
}

// ─── 合规状态徽章 ───

function ComplianceBadge({ riskLevel }: { riskLevel: string | null }) {
  if (!riskLevel) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-white/5 text-white/50">
        <Clock className="h-3 w-3" />
        待检查
      </span>
    )
  }

  const configs: Record<string, { icon: typeof ShieldCheck; label: string; className: string }> = {
    LOW: {
      icon: ShieldCheck,
      label: '合规通过',
      className: 'bg-green-900/30 text-green-400',
    },
    MEDIUM: {
      icon: ShieldAlert,
      label: '低风险',
      className: 'bg-yellow-900/30 text-yellow-400',
    },
    HIGH: {
      icon: ShieldAlert,
      label: '高风险',
      className: 'bg-[var(--ll-danger)]/30 text-[var(--ll-danger)]',
    },
    BLOCKED: {
      icon: ShieldX,
      label: '合规不通过',
      className: 'bg-red-900/30 text-red-400',
    },
  }

  const config = configs[riskLevel] ?? configs['LOW']
  const Icon = config.icon

  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
      config.className,
    )}>
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  )
}

// ─── 平台文案预览 ───

interface PlatformCopy {
  title: string
  coverTitle: string
  caption: string
  tags: string[]
  cta: string
}

function PlatformCopiesPreview({
  copies,
}: {
  copies: Record<string, PlatformCopy>
}) {
  const [activePlatform, setActivePlatform] = useState<string>(
    Object.keys(copies)[0] ?? 'DOUYIN'
  )

  const activeCopy = copies[activePlatform]

  if (!activeCopy) return null

  return (
    <div className="mt-6">
      <h2 className="text-sm font-bold text-[var(--ll-text)] mb-3">平台文案预览</h2>

      {/* 平台切换标签 */}
      <div className="flex gap-1.5 mb-3 overflow-x-auto">
        {Object.keys(copies).map((platform) => (
          <button
            key={platform}
            className={cn(
              'flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all',
              activePlatform === platform
                ? 'bg-white text-black'
                : 'bg-white/5 text-white/50 hover:bg-white/10',
            )}
            onClick={() => setActivePlatform(platform)}
          >
            {PLATFORM_LABELS[platform] || platform}
          </button>
        ))}
      </div>

      {/* 文案内容 */}
      <Card className="p-4 rounded-xl border border-white/10 bg-white/[0.02]">
        <div className="space-y-3">
          <div>
            <label className="text-xs text-[var(--ll-text-3)] font-medium">标题</label>
            <p className="text-sm text-[var(--ll-text)] mt-0.5">{activeCopy.title}</p>
          </div>
          <div>
            <label className="text-xs text-[var(--ll-text-3)] font-medium">封面文字</label>
            <p className="text-sm text-[var(--ll-text)] mt-0.5">{activeCopy.coverTitle}</p>
          </div>
          <div>
            <label className="text-xs text-[var(--ll-text-3)] font-medium">文案</label>
            <p className="text-sm text-[var(--ll-text-2)] mt-0.5 whitespace-pre-wrap leading-relaxed">
              {activeCopy.caption}
            </p>
          </div>
          <div>
            <label className="text-xs text-[var(--ll-text-3)] font-medium">标签</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {activeCopy.tags.map((tag, i) => (
                <span key={i} className="px-2 py-0.5 bg-white/5 text-white/50 text-xs rounded-full">
                  #{tag}
                </span>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-[var(--ll-text-3)] font-medium">引导语</label>
            <p className="text-sm text-white/60 font-medium mt-0.5">{activeCopy.cta}</p>
          </div>
        </div>
      </Card>
    </div>
  )
}

// ─── 高风险确认对话框 ───

function HighRiskConfirmDialog({
  variantId,
  variant,
  onConfirm,
  onCancel,
}: {
  variantId: string
  variant: VideoVariant
  onConfirm: (id: string) => void
  onCancel: () => void
}) {
  const compliance = variant.complianceChecks[0]
  const issues = (compliance?.issues ?? []) as ComplianceIssue[]
  const highIssues = issues.filter((i) => i.riskLevel === 'HIGH')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm bg-[var(--ll-surface)] border border-[var(--ll-hair)] rounded-2xl shadow-xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 text-[var(--ll-danger)]">
          <AlertTriangle className="h-5 w-5" />
          <h3 className="text-base font-bold">合规风险提醒</h3>
        </div>

        <p className="mt-3 text-sm text-[var(--ll-text-2)]">
          系统检测到以下高风险问题，导出后请谨慎发布：
        </p>

        <div className="mt-3 space-y-2 max-h-40 overflow-y-auto">
          {highIssues.map((issue, i) => (
            <div key={i} className="p-2 bg-[var(--ll-danger)]/20 rounded-lg text-xs text-[var(--ll-danger)]">
              <p className="font-medium">{issue.reason}</p>
              {issue.matchedText && (
                <p className="mt-0.5 text-[var(--ll-danger)]">涉及文字：「{issue.matchedText}」</p>
              )}
            </div>
          ))}
          {highIssues.length === 0 && (
            <p className="text-xs text-[var(--ll-text-3)]">存在高风险合规问题，请确认是否继续导出</p>
          )}
        </div>

        <div className="mt-5 flex gap-3">
          <Button
            variant="outline"
            className="flex-1 h-10 rounded-xl text-sm"
            onClick={onCancel}
          >
            取消
          </Button>
          <Button
            className="flex-1 h-10 rounded-xl text-sm bg-[var(--ll-green)] hover:bg-[var(--ll-green-sb)] text-black"
            onClick={() => onConfirm(variantId)}
          >
            确认导出
          </Button>
        </div>
      </div>
    </div>
  )
}
