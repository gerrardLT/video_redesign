'use client'

/**
 * 待发布清单 — /merchant/stores/[storeId]/publish-queue
 *
 * 发布闭环的「清单 + 提醒 + 手动标记」前端（需求 8.2, 8.4, 8.5, 8.6）。
 *
 * 本页明确不伪装为「一键自动分发」：平台开放发布 API 暂不可用，本阶段仅提供
 * 清单视图、发布引导（复制文案 / 下载视频 / 跳转平台发布入口）与手动标记已发布。
 *
 * 功能：
 * - 清单视图：展示每条已导出内容的发布状态（未发布 / 已发布到 X 平台），
 *   支持按「全部 / 未发布 / 已发布」筛选（需求 8.2）。
 * - 发布引导：选择目标平台后可复制该平台文案、下载已导出视频、跳转平台发布入口（需求 8.5）。
 * - 手动标记已发布：标记发布到某平台并记录时间，纳入后续数据回填 / 复盘范围（需求 8.4）。
 *
 * 数据来源（后端已就绪，本页纯前端）：
 * - GET  /api/stores/{storeId}/publish-queue           待发布清单（返回 PublishQueueItem[]）
 * - GET  /api/content-briefs/{briefId}                 取标题 / 视频版本 / 各平台文案
 * - POST /api/video-variants/{variantId}/export        重新生成签名下载链接（24h 有效）
 * - POST /api/publish-queue/{itemId}/mark-published    手动标记已发布
 *
 * 说明：清单项仅含 variantId/briefId，故每条卡片按 briefId 懒加载 brief 详情
 * （SWR 按 key 去重，同一 brief 的多个版本共用一次请求），用于展示标题与文案。
 *
 * Requirements: 8.2, 8.4, 8.5, 8.6
 */

import { useState } from 'react'
import { useParams } from 'next/navigation'
import useSWR from 'swr'
import {
  Megaphone,
  Copy,
  Download,
  ExternalLink,
  CheckCircle2,
  Clock,
  Loader2,
  Inbox,
  Info,
  Send,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import type { PublishPlatform, PlatformCopy } from '@/types/merchant'

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
// 平台常量
// ========================

/** 平台中文名 */
const PLATFORM_LABELS: Record<string, string> = {
  DOUYIN: '抖音',
  KUAISHOU: '快手',
  XIAOHONGSHU: '小红书',
  WECHAT_CHANNELS: '视频号',
  MANUAL_EXPORT: '手动导出',
}

/**
 * 各平台创作者发布入口（跳转引导，需求 8.5）。
 * 仅作为「跳转平台发布入口」的外链，平台需商家自行登录上传，非代替自动分发（需求 8.6）。
 */
const PLATFORM_ENTRY_URLS: Record<string, string> = {
  DOUYIN: 'https://creator.douyin.com/creator-micro/content/upload',
  XIAOHONGSHU: 'https://creator.xiaohongshu.com/publish/publish',
  WECHAT_CHANNELS: 'https://channels.weixin.qq.com/platform/post/create',
  KUAISHOU: 'https://cp.kuaishou.com/article/publish/video',
}

/** 可发布的目标平台（对应 glossary「三平台」：抖音 / 小红书 / 视频号） */
const PUBLISH_PLATFORMS: PublishPlatform[] = ['DOUYIN', 'XIAOHONGSHU', 'WECHAT_CHANNELS']

/** 视频版本类型中文标签 */
const VARIANT_TYPE_LABELS: Record<string, string> = {
  PROMOTION: '促销版',
  ATMOSPHERE: '氛围版',
  OWNER_TALKING: '口播版',
  TRUST: '信任版',
  PRODUCT: '产品版',
}

// ========================
// 类型
// ========================

/** 已发布平台条目（对应 PublishQueueItem.publishedPlatforms JSON 元素） */
interface PublishedPlatformEntry {
  platform: PublishPlatform
  publishedAt: string
}

/** 待发布清单项（对应 Prisma PublishQueueItem） */
interface PublishQueueItem {
  id: string
  storeId: string
  contentBriefId: string
  videoVariantId: string
  exportedAt: string
  remindAfterH: number
  reminded: boolean
  publishedPlatforms: PublishedPlatformEntry[]
  createdAt: string
  updatedAt: string
}

/** brief 详情中需要的视频版本字段 */
interface BriefVariant {
  id: string
  type: string
  title: string
  durationSec: number | null
  ossKey: string | null
}

/** brief 详情（仅取本页所需字段） */
interface BriefDetail {
  id: string
  title: string
  platformCopies: Record<string, PlatformCopy> | null
  videoVariants: BriefVariant[]
}

/** 清单筛选维度 */
type FilterKey = 'ALL' | 'UNPUBLISHED' | 'PUBLISHED'

// ========================
// 工具函数
// ========================

/** 判断清单项是否已发布到任意平台 */
function isPublished(item: PublishQueueItem): boolean {
  return Array.isArray(item.publishedPlatforms) && item.publishedPlatforms.length > 0
}

/** 格式化日期为「X月X日 HH:mm」 */
function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${mm}`
}

/** 将平台文案拼装为可直接粘贴的纯文本 */
function buildCopyText(copy: PlatformCopy): string {
  const parts: string[] = []
  if (copy.title) parts.push(copy.title)
  if (copy.caption) parts.push(copy.caption)
  if (copy.tags && copy.tags.length > 0) parts.push(copy.tags.map((t) => `#${t}`).join(' '))
  if (copy.cta) parts.push(copy.cta)
  return parts.join('\n\n')
}

/** 复制文本到剪贴板（带降级方案与提示） */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 落入降级方案
  }
  // 降级：使用临时 textarea + execCommand（非安全上下文兜底）
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

// ========================
// 主页面
// ========================

export default function PublishQueuePage() {
  const params = useParams<{ storeId: string }>()
  const storeId = params.storeId

  const [filter, setFilter] = useState<FilterKey>('ALL')

  const { data, error, isLoading, mutate } = useSWR<{ items: PublishQueueItem[] }>(
    storeId ? `/api/stores/${storeId}/publish-queue` : null,
    fetcher,
    { revalidateOnFocus: false }
  )

  const items = data?.items ?? []

  const filteredItems = items.filter((item) => {
    if (filter === 'UNPUBLISHED') return !isPublished(item)
    if (filter === 'PUBLISHED') return isPublished(item)
    return true
  })

  const unpublishedCount = items.filter((i) => !isPublished(i)).length
  const publishedCount = items.length - unpublishedCount

  return (
    <div className="max-w-lg mx-auto space-y-4 pb-8">
      {/* 标题 */}
      <div className="flex items-center gap-2 pt-1 zen-reveal">
        <Megaphone className="h-5 w-5 text-[var(--ll-green)]" strokeWidth={1.5} />
        <h1 className="text-[var(--text-title)] font-semibold font-[var(--font-serif)] text-[var(--ll-text)]">待发布清单</h1>
      </div>

      {/* 能力边界说明（需求 8.6）：明确为清单 + 提醒 + 手动标记，不伪装自动分发 */}
      <div className="flex gap-2 rounded-[3px] border border-[var(--ll-hair)] bg-[var(--ll-green-light)]/40 p-3 text-xs text-[var(--ll-text-2)] zen-reveal">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ll-green)]" strokeWidth={1.5} />
        <p className="leading-relaxed">
          导出后系统会把视频放进这里并按时提醒你发布。目前需要你手动发布到各平台：
          点「去发布」可复制文案、下载视频、打开平台发布页，发完后回来标记一下即可。
          系统不会替你自动分发到平台。
        </p>
      </div>

      {/* 筛选条 */}
      <div className="flex gap-2">
        {(
          [
            { key: 'ALL', label: `全部 ${items.length}` },
            { key: 'UNPUBLISHED', label: `未发布 ${unpublishedCount}` },
            { key: 'PUBLISHED', label: `已发布 ${publishedCount}` },
          ] as { key: FilterKey; label: string }[]
        ).map((tab) => (
          <Button
            key={tab.key}
            type="button"
            variant={filter === tab.key ? 'default' : 'outline'}
            size="sm"
            className={filter === tab.key ? 'bg-[var(--ll-green)] hover:bg-[var(--ll-green-sb)] text-black' : ''}
            onClick={() => setFilter(tab.key)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {/* 加载 / 错误 / 空态 / 列表 */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="text-sm text-red-500">{(error as Error).message || '加载失败'}</p>
          <Button variant="outline" size="sm" onClick={() => mutate()}>
            重试
          </Button>
        </div>
      ) : filteredItems.length === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => (
            <PublishQueueCard key={item.id} item={item} onChanged={() => mutate()} />
          ))}
        </div>
      )}
    </div>
  )
}

// ========================
// 空态
// ========================

function EmptyState({ filter }: { filter: FilterKey }) {
  const text =
    filter === 'PUBLISHED'
      ? '还没有已发布的内容'
      : filter === 'UNPUBLISHED'
        ? '没有待发布的内容，都发完啦'
        : '还没有导出的视频'
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <Inbox className="h-10 w-10 text-[var(--ll-text-3)]" />
      <p className="text-sm text-[var(--ll-text-3)]">{text}</p>
      {filter !== 'PUBLISHED' && (
        <p className="text-xs text-[var(--ll-text-3)]">完成拍摄并导出视频后，会自动出现在这里</p>
      )}
    </div>
  )
}

// ========================
// 单条清单卡片
// ========================

/**
 * 单条待发布清单卡片：按 briefId 懒加载 brief 详情用于展示标题与文案，
 * 展示发布状态（未发布 / 已发布到 X 平台），并提供「去发布」引导入口。
 */
function PublishQueueCard({
  item,
  onChanged,
}: {
  item: PublishQueueItem
  onChanged: () => void
}) {
  const [guideOpen, setGuideOpen] = useState(false)

  // 懒加载 brief 详情（SWR 按 key 去重：同一 brief 的多个版本共用一次请求）
  const { data: briefData } = useSWR<{ brief: BriefDetail }>(
    `/api/content-briefs/${item.contentBriefId}`,
    fetcher,
    { revalidateOnFocus: false }
  )

  const brief = briefData?.brief
  const variant = brief?.videoVariants.find((v) => v.id === item.videoVariantId) ?? null
  const published = isPublished(item)
  const typeLabel = variant ? VARIANT_TYPE_LABELS[variant.type] ?? variant.type : null

  return (
    <Card className="rounded-2xl border-[var(--ll-hair)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[var(--ll-text)]">
            {brief?.title ?? '加载中…'}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {typeLabel && (
              <Badge variant="secondary" className="text-[10px]">
                {typeLabel}
              </Badge>
            )}
            <span className="flex items-center gap-0.5 text-[11px] text-[var(--ll-text-3)]">
              <Clock className="h-3 w-3" />
              导出于 {formatDateTime(item.exportedAt)}
            </span>
          </div>
        </div>

        {/* 发布状态徽章 */}
        {published ? (
          <Badge className="shrink-0 bg-green-100 text-green-700 border-green-200">
            <CheckCircle2 className="mr-0.5 h-3 w-3" /> 已发布
          </Badge>
        ) : (
          <Badge variant="outline" className="shrink-0 border-[var(--ll-hair)] text-[var(--ll-text-2)]">
            未发布
          </Badge>
        )}
      </div>

      {/* 已发布平台明细（需求 8.2：已发布到 X 平台） */}
      {published && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {item.publishedPlatforms.map((p) => (
            <span
              key={`${p.platform}-${p.publishedAt}`}
              className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] text-green-700"
            >
              <CheckCircle2 className="h-3 w-3" />
              {PLATFORM_LABELS[p.platform] ?? p.platform} · {formatDateTime(p.publishedAt)}
            </span>
          ))}
        </div>
      )}

      {/* 主操作：去发布（打开发布引导） */}
      <Button
        className="mt-4 w-full bg-[var(--ll-green)] hover:bg-[var(--ll-green-sb)] text-black"
        size="sm"
        onClick={() => setGuideOpen(true)}
      >
        <Send className="mr-1.5 h-4 w-4" />
        {published ? '继续发布到其它平台' : '去发布'}
      </Button>

      <PublishGuideDialog
        open={guideOpen}
        onOpenChange={setGuideOpen}
        item={item}
        brief={brief ?? null}
        variant={variant}
        onMarked={onChanged}
      />
    </Card>
  )
}

// ========================
// 发布引导弹窗
// ========================

/**
 * 发布引导弹窗（需求 8.5）：选择目标平台后提供
 * 复制文案 / 下载视频 / 跳转平台发布入口三项引导，并支持手动标记已发布（需求 8.4）。
 */
function PublishGuideDialog({
  open,
  onOpenChange,
  item,
  brief,
  variant,
  onMarked,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: PublishQueueItem
  brief: BriefDetail | null
  variant: BriefVariant | null
  onMarked: () => void
}) {
  const [platform, setPlatform] = useState<PublishPlatform>('DOUYIN')
  const [downloading, setDownloading] = useState(false)
  const [marking, setMarking] = useState(false)

  const platformCopy = brief?.platformCopies?.[platform] ?? null
  // 该平台是否已标记发布过
  const alreadyPublished = item.publishedPlatforms.some((p) => p.platform === platform)

  /** 复制当前平台文案 */
  async function handleCopy() {
    if (!platformCopy) {
      toast.error('该平台暂无文案，可在版本导出页生成或编辑')
      return
    }
    const ok = await copyToClipboard(buildCopyText(platformCopy))
    if (ok) toast.success(`已复制${PLATFORM_LABELS[platform]}文案`)
    else toast.error('复制失败，请手动选择文本复制')
  }

  /** 下载视频：重新生成签名下载链接（24h 有效）后打开 */
  async function handleDownload() {
    setDownloading(true)
    try {
      const res = await fetch(`/api/video-variants/${item.videoVariantId}/export`, {
        method: 'POST',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json?.error?.message || '生成下载链接失败')
        return
      }
      if (json.downloadUrl) {
        window.open(json.downloadUrl, '_blank', 'noopener,noreferrer')
        toast.success('已打开下载链接（24小时内有效）')
      } else {
        toast.error('未获取到下载链接')
      }
    } catch {
      toast.error('网络错误，请重试')
    } finally {
      setDownloading(false)
    }
  }

  /** 跳转平台发布入口 */
  function handleOpenPlatform() {
    const url = PLATFORM_ENTRY_URLS[platform]
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }

  /** 手动标记已发布到当前平台 */
  async function handleMarkPublished() {
    setMarking(true)
    try {
      const res = await fetch(`/api/publish-queue/${item.id}/mark-published`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json?.error?.message || '标记失败')
        return
      }
      toast.success(`已标记发布到${PLATFORM_LABELS[platform]}`)
      onMarked()
      onOpenChange(false)
    } catch {
      toast.error('网络错误，请重试')
    } finally {
      setMarking(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>发布引导</DialogTitle>
          <DialogDescription>
            {brief?.title ?? ''}
            {variant ? ` · ${VARIANT_TYPE_LABELS[variant.type] ?? variant.type}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* 平台选择 */}
          <div className="space-y-1.5">
            <span className="text-sm text-[var(--ll-text-2)]">选择要发布的平台</span>
            <Select value={platform} onValueChange={(v) => setPlatform(v as PublishPlatform)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PUBLISH_PLATFORMS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PLATFORM_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {alreadyPublished && (
              <p className="text-xs text-green-600">已标记发布到该平台，可重复标记以更新时间</p>
            )}
          </div>

          {/* 文案预览 */}
          {platformCopy ? (
            <div className="rounded-xl border border-[var(--ll-hair)] bg-[var(--ll-muted)]/60 p-3">
              <p className="text-sm font-medium text-[var(--ll-text)]">{platformCopy.title}</p>
              <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-[var(--ll-text-2)]">
                {platformCopy.caption}
              </p>
              {platformCopy.tags?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {platformCopy.tags.map((t, i) => (
                    <span key={i} className="text-[11px] text-[var(--ll-text-2)]">
                      #{t}
                    </span>
                  ))}
                </div>
              )}
              {platformCopy.cta && (
                <p className="mt-1.5 text-xs font-medium text-[var(--ll-text-2)]">{platformCopy.cta}</p>
              )}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-[var(--ll-hair)] p-3 text-center text-xs text-[var(--ll-text-3)]">
              该平台暂无文案，可前往版本导出页生成或编辑
            </p>
          )}

          {/* 三项发布引导：复制文案 / 下载视频 / 跳转平台 */}
          <div className="grid grid-cols-3 gap-2">
            <Button variant="outline" size="sm" onClick={handleCopy} disabled={!platformCopy}>
              <Copy className="mr-1 h-4 w-4" />
              复制文案
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownload} disabled={downloading}>
              {downloading ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-1 h-4 w-4" />
              )}
              下载视频
            </Button>
            <Button variant="outline" size="sm" onClick={handleOpenPlatform}>
              <ExternalLink className="mr-1 h-4 w-4" />
              打开平台
            </Button>
          </div>

          <p className="text-[11px] leading-relaxed text-[var(--ll-text-3)]">
            建议顺序：复制文案 → 下载视频 → 打开平台上传发布 → 回来标记已发布。
            标记后该内容会纳入后续数据回填与复盘。
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={marking}>
            稍后再说
          </Button>
          <Button
            className="bg-green-600 hover:bg-green-700 text-white"
            onClick={handleMarkPublished}
            disabled={marking}
          >
            {marking ? <Spinner className="h-4 w-4" /> : `标记已发布到${PLATFORM_LABELS[platform]}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
