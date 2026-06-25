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
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

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
}

interface ExportResult {
  publishJobId: string
  downloadUrl: string
  expiresIn: number
  resolution: string
  tier: string
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
  const { briefId } = params

  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null)
  const [exportingId, setExportingId] = useState<string | null>(null)
  const [exportResults, setExportResults] = useState<Record<string, ExportResult>>({})
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [showHighRiskConfirm, setShowHighRiskConfirm] = useState<string | null>(null)

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
  const { data: briefData } = useSWR<{ brief: { platformCopies: Record<string, PlatformCopy> | null } }>(
    `/api/content-briefs/${briefId}`,
    fetcher
  )

  const variants = variantsData?.variants ?? []
  const platformCopies = briefData?.brief?.platformCopies ?? null

  const selectedVariant = variants.find((v) => v.id === selectedVariantId) ?? null

  // ─── 导出视频 ───
  const handleExport = useCallback(async (variantId: string) => {
    setExportingId(variantId)
    setErrorMessage(null)

    try {
      const res = await fetch(`/api/video-variants/${variantId}/export`, {
        method: 'POST',
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
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
        <p className="text-gray-500 text-sm">加载中...</p>
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
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Play className="h-10 w-10 text-gray-300" />
        <p className="text-gray-500">暂无视频版本</p>
        <p className="text-xs text-gray-400">请先完成拍摄和上传，再生成视频</p>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto px-4 pb-8">
      {/* 页面标题 */}
      <div className="py-4 border-b border-amber-100">
        <h1 className="text-lg font-bold text-gray-800">选择版本导出</h1>
        <p className="text-sm text-gray-500 mt-1">共生成 {variants.length} 个版本，选择合适的下载</p>
      </div>

      {/* 错误提示 */}
      {errorMessage && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
          {errorMessage}
        </div>
      )}

      {/* 版本卡片列表 */}
      <div className="mt-4 space-y-3">
        {variants.map((variant) => (
          <VariantCard
            key={variant.id}
            variant={variant}
            isSelected={selectedVariantId === variant.id}
            isExporting={exportingId === variant.id}
            exportResult={exportResults[variant.id]}
            onSelect={() => setSelectedVariantId(
              selectedVariantId === variant.id ? null : variant.id
            )}
            onExport={() => handleExport(variant.id)}
          />
        ))}
      </div>

      {/* 选中版本时：平台文案预览 */}
      {selectedVariant && platformCopies && (
        <PlatformCopiesPreview copies={platformCopies} />
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
  onSelect: () => void
  onExport: () => void
}

function VariantCard({
  variant,
  isSelected,
  isExporting,
  exportResult,
  onSelect,
  onExport,
}: VariantCardProps) {
  const typeConfig = VARIANT_TYPE_LABELS[variant.type] || {
    label: variant.type,
    desc: '',
    color: 'bg-gray-50 text-gray-700 border-gray-200',
  }

  const compliance = variant.complianceChecks[0] ?? null
  const riskLevel = compliance?.riskLevel ?? null
  const isBlocked = riskLevel === 'BLOCKED'
  const blockedReasons = compliance?.blockedReasons ?? []

  return (
    <Card
      className={cn(
        'p-4 rounded-2xl border-2 transition-all cursor-pointer',
        isSelected && 'border-amber-300 bg-amber-50/30 shadow-md shadow-amber-100',
        !isSelected && 'border-gray-100 hover:border-amber-200',
      )}
      onClick={onSelect}
    >
      <div className="flex items-start gap-3">
        {/* 缩略图区域 */}
        <div className="flex-shrink-0 w-16 h-24 rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden">
          <Play className="h-6 w-6 text-gray-400" />
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
          <h3 className="mt-1.5 text-sm font-bold text-gray-800 truncate">
            {variant.title}
          </h3>

          {/* 时长 + 描述 */}
          <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
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
        <div className="mt-4 pt-3 border-t border-gray-100">
          {/* 已导出 → 显示下载链接 */}
          {exportResult && (
            <div className="flex items-center gap-2 p-3 bg-green-50 rounded-xl">
              <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-green-700">导出完成</p>
                <p className="text-xs text-green-600 mt-0.5">
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
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-amber-500 hover:bg-amber-600 text-white shadow-md shadow-amber-200',
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
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
        <Clock className="h-3 w-3" />
        待检查
      </span>
    )
  }

  const configs: Record<string, { icon: typeof ShieldCheck; label: string; className: string }> = {
    LOW: {
      icon: ShieldCheck,
      label: '合规通过',
      className: 'bg-green-100 text-green-700',
    },
    MEDIUM: {
      icon: ShieldAlert,
      label: '低风险',
      className: 'bg-yellow-100 text-yellow-700',
    },
    HIGH: {
      icon: ShieldAlert,
      label: '高风险',
      className: 'bg-orange-100 text-orange-700',
    },
    BLOCKED: {
      icon: ShieldX,
      label: '合规不通过',
      className: 'bg-red-100 text-red-700',
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
      <h2 className="text-sm font-bold text-gray-800 mb-3">平台文案预览</h2>

      {/* 平台切换标签 */}
      <div className="flex gap-1.5 mb-3 overflow-x-auto">
        {Object.keys(copies).map((platform) => (
          <button
            key={platform}
            className={cn(
              'flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all',
              activePlatform === platform
                ? 'bg-amber-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
            )}
            onClick={() => setActivePlatform(platform)}
          >
            {PLATFORM_LABELS[platform] || platform}
          </button>
        ))}
      </div>

      {/* 文案内容 */}
      <Card className="p-4 rounded-xl border border-gray-100">
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-400 font-medium">标题</label>
            <p className="text-sm text-gray-800 mt-0.5">{activeCopy.title}</p>
          </div>
          <div>
            <label className="text-xs text-gray-400 font-medium">封面文字</label>
            <p className="text-sm text-gray-800 mt-0.5">{activeCopy.coverTitle}</p>
          </div>
          <div>
            <label className="text-xs text-gray-400 font-medium">文案</label>
            <p className="text-sm text-gray-700 mt-0.5 whitespace-pre-wrap leading-relaxed">
              {activeCopy.caption}
            </p>
          </div>
          <div>
            <label className="text-xs text-gray-400 font-medium">标签</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {activeCopy.tags.map((tag, i) => (
                <span key={i} className="px-2 py-0.5 bg-amber-50 text-amber-700 text-xs rounded-full">
                  #{tag}
                </span>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-400 font-medium">引导语</label>
            <p className="text-sm text-amber-600 font-medium mt-0.5">{activeCopy.cta}</p>
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
        className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 text-orange-600">
          <AlertTriangle className="h-5 w-5" />
          <h3 className="text-base font-bold">合规风险提醒</h3>
        </div>

        <p className="mt-3 text-sm text-gray-600">
          系统检测到以下高风险问题，导出后请谨慎发布：
        </p>

        <div className="mt-3 space-y-2 max-h-40 overflow-y-auto">
          {highIssues.map((issue, i) => (
            <div key={i} className="p-2 bg-orange-50 rounded-lg text-xs text-orange-700">
              <p className="font-medium">{issue.reason}</p>
              {issue.matchedText && (
                <p className="mt-0.5 text-orange-500">涉及文字：「{issue.matchedText}」</p>
              )}
            </div>
          ))}
          {highIssues.length === 0 && (
            <p className="text-xs text-gray-500">存在高风险合规问题，请确认是否继续导出</p>
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
            className="flex-1 h-10 rounded-xl text-sm bg-orange-500 hover:bg-orange-600 text-white"
            onClick={() => onConfirm(variantId)}
          >
            确认导出
          </Button>
        </div>
      </div>
    </div>
  )
}
