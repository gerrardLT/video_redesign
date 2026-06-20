'use client'

/**
 * 支付历史列表组件
 *
 * 展示用户的订阅支付记录：金额、时间、状态 Badge、类型（首次/续费/手动续费）。
 * 支持分页加载，嵌入在会员管理 Dashboard 页面中使用。
 *
 * Requirements: 10.5
 */

import { useEffect } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useSubscriptionStore, type SubscriptionOrderItem } from '@/stores/subscription-store'

/** 订单类型标签映射 */
const ORDER_TYPE_LABELS: Record<string, string> = {
  FIRST_SUBSCRIBE: '首次开通',
  RENEWAL: '自动续费',
  MANUAL_RENEWAL: '手动续费',
}

/** 订单状态样式映射 */
const ORDER_STATUS_STYLES: Record<string, { text: string; className: string }> = {
  PENDING: { text: '待支付', className: 'bg-yellow-500/20 text-yellow-400' },
  PAID: { text: '已支付', className: 'bg-green-500/20 text-green-400' },
  FAILED: { text: '支付失败', className: 'bg-red-500/20 text-red-400' },
  EXPIRED: { text: '已过期', className: 'bg-gray-500/20 text-gray-400' },
}

/** 格式化金额（分 → 元） */
function formatAmount(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`
}

/** 格式化时间 */
function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function PaymentHistory() {
  const {
    paymentHistory,
    historyPagination,
    loading,
    fetchPaymentHistory,
  } = useSubscriptionStore()

  useEffect(() => {
    fetchPaymentHistory(1, 10)
  }, [fetchPaymentHistory])

  /** 翻页操作 */
  function handlePageChange(page: number) {
    fetchPaymentHistory(page, historyPagination?.pageSize || 10)
  }

  // 无数据
  if (!loading && paymentHistory.length === 0) {
    return (
      <div>
        <h2 className="mb-4 text-lg font-medium text-[var(--cine-text)]">支付记录</h2>
        <div className="rounded-xl border border-dashed border-[var(--cine-line-2)] py-10 text-center">
          <p className="text-sm text-[var(--cine-text-3)]">暂无支付记录</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h2 className="mb-4 text-lg font-medium text-[var(--cine-text)]">支付记录</h2>

      {/* 列表 */}
      <div className="overflow-hidden rounded-xl border border-[var(--cine-line)] bg-[var(--cine-surface)]">
        {/* 表头 */}
        <div className="hidden border-b border-[var(--cine-line)] px-4 py-3 sm:grid sm:grid-cols-5 sm:gap-4">
          <span className="text-xs font-medium text-[var(--cine-text-3)]">类型</span>
          <span className="text-xs font-medium text-[var(--cine-text-3)]">金额</span>
          <span className="text-xs font-medium text-[var(--cine-text-3)]">时间</span>
          <span className="text-xs font-medium text-[var(--cine-text-3)]">状态</span>
          <span className="text-xs font-medium text-[var(--cine-text-3)]">套餐</span>
        </div>

        {/* 加载占位 */}
        {loading && paymentHistory.length === 0 && (
          <div className="space-y-0">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 animate-pulse border-b border-[var(--cine-line)] bg-[var(--cine-bg)]" />
            ))}
          </div>
        )}

        {/* 数据行 */}
        {paymentHistory.map((order) => (
          <PaymentHistoryRow key={order.id} order={order} />
        ))}
      </div>

      {/* 分页 */}
      {historyPagination && historyPagination.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-[var(--cine-text-3)]">
            共 {historyPagination.total} 条记录
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(historyPagination.page - 1)}
              disabled={historyPagination.page <= 1 || loading}
              className="border-[var(--cine-line)] text-[var(--cine-text-2)]"
            >
              上一页
            </Button>
            <span className="text-xs text-[var(--cine-text-2)]">
              {historyPagination.page} / {historyPagination.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(historyPagination.page + 1)}
              disabled={historyPagination.page >= historyPagination.totalPages || loading}
              className="border-[var(--cine-line)] text-[var(--cine-text-2)]"
            >
              下一页
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ========================
// 单行子组件
// ========================

function PaymentHistoryRow({ order }: { order: SubscriptionOrderItem }) {
  const typeLabel = ORDER_TYPE_LABELS[order.type] || order.type
  const statusInfo = ORDER_STATUS_STYLES[order.status] || ORDER_STATUS_STYLES.EXPIRED

  return (
    <div className="grid grid-cols-2 gap-2 border-b border-[var(--cine-line)] px-4 py-3 last:border-b-0 sm:grid-cols-5 sm:gap-4">
      {/* 类型 */}
      <div className="flex items-center">
        <span className="text-sm text-[var(--cine-text)]">{typeLabel}</span>
      </div>

      {/* 金额 */}
      <div className="flex items-center justify-end sm:justify-start">
        <span className="text-sm font-medium text-[var(--cine-text)]">
          {formatAmount(order.amount)}
        </span>
      </div>

      {/* 时间 */}
      <div className="flex items-center">
        <span className="text-xs text-[var(--cine-text-3)]">
          {formatTime(order.paidAt || order.createdAt)}
        </span>
      </div>

      {/* 状态 */}
      <div className="flex items-center">
        <Badge className={statusInfo.className}>{statusInfo.text}</Badge>
      </div>

      {/* 套餐名称 */}
      <div className="flex items-center">
        <span className="text-xs text-[var(--cine-text-3)]">{order.plan.name}</span>
      </div>
    </div>
  )
}
