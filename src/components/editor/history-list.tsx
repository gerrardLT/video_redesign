'use client'

/**
 * HistoryList — 历史记录列表组件
 *
 * 通过 SWR 从后端获取 HappyHorse 生成历史记录，
 * 支持点击回放、多选对比和分页加载。
 */

import { useState, useCallback } from 'react'
import useSWR from 'swr'
import { History, CheckSquare, Square, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/** 历史记录数据结构 */
export interface HistoryRecord {
  id: string
  createdAt: string
  prompt: string
  status: 'pending' | 'running' | 'succeeded' | 'failed'
  thumbnailUrl?: string
  videoUrl?: string
  creditCost?: number
}

interface HistoryListProps {
  /** 项目 ID */
  projectId: string
  /** 点击记录回调（加载视频到 ResultPreview） */
  onSelectRecord?: (record: HistoryRecord) => void
  /** 对比模式回调（选择 2 条记录） */
  onCompareRecords?: (records: [HistoryRecord, HistoryRecord]) => void
}

/** SWR fetcher */
const fetcher = (url: string) => fetch(url).then((res) => {
  if (!res.ok) throw new Error('请求失败')
  return res.json()
})

/** 状态标签配置 */
const STATUS_CONFIG = {
  pending: { label: '排队中', color: 'text-zinc-500' },
  running: { label: '生成中', color: 'text-yellow-400' },
  succeeded: { label: '成功', color: 'text-green-400' },
  failed: { label: '失败', color: 'text-red-400' },
} as const

export function HistoryList({
  projectId,
  onSelectRecord,
  onCompareRecords,
}: HistoryListProps) {
  const [cursor, setCursor] = useState<string | undefined>()
  const [allRecords, setAllRecords] = useState<HistoryRecord[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isCompareMode, setIsCompareMode] = useState(false)

  // 获取历史记录
  const { data, error, isLoading } = useSWR<{
    records: HistoryRecord[]
    nextCursor?: string
  }>(
    `/api/projects/${projectId}/happyhorse-history${cursor ? `?cursor=${cursor}` : ''}`,
    fetcher,
    {
      onSuccess: (newData) => {
        if (cursor) {
          // 加载更多：追加
          setAllRecords((prev) => [...prev, ...newData.records])
        } else {
          // 首次加载
          setAllRecords(newData.records)
        }
      },
      revalidateOnFocus: false,
    }
  )

  const hasMore = !!data?.nextCursor
  const records = cursor ? allRecords : (data?.records ?? [])

  // 加载更多
  const loadMore = useCallback(() => {
    if (data?.nextCursor) {
      setCursor(data.nextCursor)
    }
  }, [data?.nextCursor])

  // 点击记录
  const handleRecordClick = useCallback(
    (record: HistoryRecord) => {
      if (isCompareMode) {
        // 对比模式：多选
        setSelectedIds((prev) => {
          const next = new Set(prev)
          if (next.has(record.id)) {
            next.delete(record.id)
          } else if (next.size < 2) {
            next.add(record.id)
          }

          // 选满 2 条时触发对比回调
          if (next.size === 2) {
            const selected = records.filter((r) => next.has(r.id))
            if (selected.length === 2) {
              onCompareRecords?.(selected as [HistoryRecord, HistoryRecord])
            }
          }
          return next
        })
      } else {
        // 普通模式：加载视频
        onSelectRecord?.(record)
      }
    },
    [isCompareMode, records, onSelectRecord, onCompareRecords]
  )

  // 截断 Prompt 摘要
  const truncatePrompt = (prompt: string, maxLen = 50) =>
    prompt.length > maxLen ? prompt.slice(0, maxLen) + '...' : prompt

  // 格式化时间
  const formatTime = (isoString: string) => {
    const date = new Date(isoString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMin = Math.floor(diffMs / 60000)

    if (diffMin < 1) return '刚刚'
    if (diffMin < 60) return `${diffMin}分钟前`
    if (diffMin < 1440) return `${Math.floor(diffMin / 60)}小时前`
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  if (isLoading && records.length === 0) {
    return (
      <div className="flex items-center justify-center py-6 text-zinc-500 text-sm">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        加载历史记录...
      </div>
    )
  }

  if (error && records.length === 0) {
    return (
      <div className="text-center py-6 text-zinc-500 text-sm">
        历史记录加载失败
      </div>
    )
  }

  if (records.length === 0) {
    return (
      <div className="text-center py-6 text-zinc-500 text-sm">
        <History className="w-5 h-5 mx-auto mb-2 opacity-50" />
        暂无生成记录
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-300 flex items-center gap-1.5">
          <History className="w-4 h-4" />
          历史记录
        </span>
        <button
          onClick={() => {
            setIsCompareMode(!isCompareMode)
            setSelectedIds(new Set())
          }}
          className={cn(
            'text-xs px-2 py-0.5 rounded transition-colors',
            isCompareMode
              ? 'bg-green-500/10 text-green-400'
              : 'text-zinc-500 hover:text-zinc-400'
          )}
        >
          {isCompareMode ? '退出对比' : '版本对比'}
        </button>
      </div>

      {/* 记录列表 */}
      <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
        {records.map((record) => (
          <button
            key={record.id}
            onClick={() => handleRecordClick(record)}
            className={cn(
              'w-full flex items-center gap-2.5 p-2 rounded-lg text-left transition-all',
              'border border-transparent hover:bg-zinc-800/50',
              selectedIds.has(record.id) && 'border-green-500/30 bg-green-500/5'
            )}
          >
            {/* 对比模式 checkbox */}
            {isCompareMode && (
              <div className="shrink-0">
                {selectedIds.has(record.id) ? (
                  <CheckSquare className="w-4 h-4 text-green-400" />
                ) : (
                  <Square className="w-4 h-4 text-zinc-600" />
                )}
              </div>
            )}

            {/* 缩略图 */}
            <div className="w-10 h-10 shrink-0 rounded-md overflow-hidden bg-zinc-800 border border-zinc-700">
              {record.thumbnailUrl ? (
                <img src={record.thumbnailUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs">
                  🎬
                </div>
              )}
            </div>

            {/* 文本信息 */}
            <div className="flex-1 min-w-0">
              <p className="text-xs text-zinc-300 truncate">
                {truncatePrompt(record.prompt)}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] text-zinc-500">
                  {formatTime(record.createdAt)}
                </span>
                <span className={cn('text-[10px]', STATUS_CONFIG[record.status].color)}>
                  {STATUS_CONFIG[record.status].label}
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* 加载更多 */}
      {hasMore && (
        <button
          onClick={loadMore}
          disabled={isLoading}
          className="w-full py-2 text-xs text-zinc-500 hover:text-zinc-400 transition-colors"
        >
          {isLoading ? '加载中...' : '加载更多'}
        </button>
      )}
    </div>
  )
}
