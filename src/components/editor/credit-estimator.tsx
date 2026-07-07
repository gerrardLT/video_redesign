'use client'

/**
 * CreditEstimator — 积分预估模块
 *
 * 调用后端 API 获取真实积分预估值，余额不足时禁用生成按钮。
 * 后端不可用时降级使用前端纯函数做乐观预估。
 */

import { useEffect } from 'react'
import useSWR from 'swr'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/shared/utils'
import { estimateHappyHorseCreditCost } from '@/lib/shared/credit-calc'

interface CreditEstimatorProps {
  /** 项目 ID */
  projectId: string
  /** 输入视频时长（秒） */
  videoDuration: number
  /** 余额不足时回调（控制生成按钮禁用） */
  onInsufficientBalance?: (insufficient: boolean) => void
}

/** SWR fetcher */
const fetcher = (url: string) => fetch(url).then((res) => {
  if (!res.ok) throw new Error('请求失败')
  return res.json()
})

export function CreditEstimator({
  projectId,
  videoDuration,
  onInsufficientBalance,
}: CreditEstimatorProps) {
  // 获取后端积分预估
  const { data: estimateData, error: estimateError } = useSWR<{
    estimatedCredits: number
    balance: number
    sufficient: boolean
  }>(
    videoDuration > 0
      ? `/api/projects/${projectId}/estimate-happyhorse?duration=${Math.round(videoDuration)}`
      : null,
    fetcher,
    { refreshInterval: 0, revalidateOnFocus: false }
  )

  // 计算显示值
  const isApproximate = !!estimateError || !estimateData
  const estimatedCredits = estimateData?.estimatedCredits
    ?? estimateHappyHorseCreditCost(Math.round(videoDuration))
  const balance = estimateData?.balance
  const sufficient = estimateData?.sufficient ?? true

  // 通知父组件余额状态
  useEffect(() => {
    onInsufficientBalance?.(!sufficient)
  }, [sufficient, onInsufficientBalance])

  if (videoDuration <= 0) return null

  return (
    <div className={cn(
      'flex items-center gap-2 text-sm',
      !sufficient ? 'text-red-400' : 'text-zinc-400'
    )}>
      {!sufficient && <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />}
      <span>
        预估消耗 {isApproximate ? '~' : ''}{estimatedCredits} 积分
      </span>
      {balance !== undefined && (
        <span className="text-xs text-zinc-500">
          （余额: {balance}）
        </span>
      )}
      {!sufficient && (
        <span className="text-xs text-red-400">余额不足</span>
      )}
    </div>
  )
}
