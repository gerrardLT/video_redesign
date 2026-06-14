'use client'

import { useEffect, useState, useCallback } from 'react'

interface OrderPackage {
  id: string
  name: string
  credits: number
  price: number
}

interface Order {
  id: string
  amount: number
  credits: number
  status: string
  payMethod: string
  transactionId: string | null
  paidAt: string | null
  expireAt: string
  createdAt: string
  package: OrderPackage
}

interface Pagination {
  total: number
  page: number
  pageSize: number
  totalPages: number
}

const STATUS_CONFIG: Record<string, { text: string; className: string }> = {
  PENDING: { text: '待支付', className: 'bg-yellow-500/20 text-yellow-400' },
  PAID: { text: '已支付', className: 'bg-green-500/20 text-[var(--cine-green)]' },
  EXPIRED: { text: '已过期', className: 'bg-gray-500/20 text-gray-400' },
  REQUIRES_MANUAL_REVIEW: { text: '审核中', className: 'bg-red-500/20 text-red-400' },
}

const PAY_METHOD_CONFIG: Record<string, { label: string; icon: React.ReactNode }> = {
  wechat: {
    label: '微信支付',
    icon: (
      <svg className="h-4 w-4 text-[var(--cine-green)]" viewBox="0 0 24 24" fill="currentColor">
        <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.045c.134 0 .24-.11.24-.245 0-.06-.024-.12-.04-.178l-.325-1.233a.49.49 0 0 1 .177-.554C23.018 18.514 24 16.837 24 14.952c0-3.37-3.226-6.094-7.062-6.094zm-1.834 2.89c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.857 0c.536 0 .97.44.97.982a.976.976 0 0 1-.97.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982z" />
      </svg>
    ),
  },
  alipay: {
    label: '支付宝',
    icon: (
      <svg className="h-4 w-4 text-blue-400" viewBox="0 0 24 24" fill="currentColor">
        <path d="M21.422 15.358c-3.146-1.324-6.208-2.893-6.208-2.893s.832-2.17 1.103-3.79c.27-1.62-.148-2.94-1.507-3.062-1.36-.123-2.014 1.162-2.208 2.37-.193 1.207.12 2.97.12 2.97H9.726v-1.27H7.77v1.27H4.5v1.53h3.27v3.104H5.31v1.53h5.88v-1.53H8.856v-3.104h3.956s-.584 1.77-1.527 3.2c-.943 1.43-2.228 2.79-2.228 2.79s3.69 1.21 5.28-1.036c1.59-2.247 1.903-3.474 1.903-3.474s3.052 1.57 5.297 2.893c1.106.65 1.902.972 2.463.972V15.358z" />
      </svg>
    ),
  },
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}`
}

function formatAmount(amountInFen: number): string {
  return `¥${(amountInFen / 100).toFixed(2)}`
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [pagination, setPagination] = useState<Pagination>({
    total: 0,
    page: 1,
    pageSize: 10,
    totalPages: 0,
  })
  const [loading, setLoading] = useState(true)
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null)

  const fetchOrders = useCallback(async (page: number) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/orders?page=${page}&pageSize=10`)
      if (!res.ok) throw new Error('获取订单失败')
      const data = await res.json()
      setOrders(data.data || [])
      setPagination({
        total: data.total,
        page: data.page,
        pageSize: data.pageSize,
        totalPages: data.totalPages,
      })
    } catch {
      setOrders([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchOrders(1)
  }, [fetchOrders])

  function handlePageChange(newPage: number) {
    if (newPage < 1 || newPage > pagination.totalPages) return
    fetchOrders(newPage)
  }

  function toggleOrderDetail(orderId: string) {
    setExpandedOrderId((prev) => (prev === orderId ? null : orderId))
  }

  return (
    <div>
      {/* 页面标题 */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">订单记录</h1>
        <p className="mt-1 text-sm text-[var(--cine-text-2)]">查看您的充值和购买记录</p>
      </div>

      {/* 加载状态 */}
      {loading && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-[var(--cine-surface)]" />
          ))}
        </div>
      )}

      {/* 空状态 */}
      {!loading && orders.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--cine-line-2)] py-20">
          <svg
            className="mb-4 h-16 w-16 text-[var(--cine-text-3)]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <p className="mb-2 text-lg font-medium text-[var(--cine-text-2)]">暂无订单记录</p>
          <p className="text-sm text-[var(--cine-text-3)]">购买套餐后订单将展示在此处</p>
        </div>
      )}

      {/* 订单列表 */}
      {!loading && orders.length > 0 && (
        <div className="space-y-3">
          {orders.map((order) => {
            const statusInfo = STATUS_CONFIG[order.status] || {
              text: order.status,
              className: 'bg-gray-500/20 text-gray-400',
            }
            const payMethodInfo = PAY_METHOD_CONFIG[order.payMethod]
            const isExpanded = expandedOrderId === order.id

            return (
              <div
                key={order.id}
                className="overflow-hidden rounded-xl border border-[var(--cine-line)] bg-[var(--cine-surface)] transition-all hover:border-[var(--cine-line-2)]"
              >
                {/* 订单主信息行 */}
                <button
                  onClick={() => toggleOrderDetail(order.id)}
                  className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-white/[0.02]"
                  aria-expanded={isExpanded}
                  aria-controls={`order-detail-${order.id}`}
                >
                  <div className="flex items-center gap-4">
                    {/* 支付方式图标 */}
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--cine-surface)]">
                      {payMethodInfo?.icon || (
                        <svg className="h-4 w-4 text-[var(--cine-text-3)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                        </svg>
                      )}
                    </div>

                    {/* 套餐名称 & 时间 */}
                    <div>
                      <p className="text-sm font-medium text-white">
                        {order.package.name}
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--cine-text-3)]">
                        {formatDate(order.createdAt)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    {/* 金额 */}
                    <span className="text-sm font-medium text-white">
                      {formatAmount(order.amount)}
                    </span>

                    {/* 状态徽章 */}
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusInfo.className}`}>
                      {statusInfo.text}
                    </span>

                    {/* 展开箭头 */}
                    <svg
                      className={`h-4 w-4 text-[var(--cine-text-3)] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>

                {/* 展开的订单详情 */}
                {isExpanded && (
                  <div
                    id={`order-detail-${order.id}`}
                    className="border-t border-[var(--cine-line)] bg-white/[0.01] px-5 py-4"
                  >
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <DetailItem label="订单号" value={order.id} mono />
                      <DetailItem
                        label="支付方式"
                        value={payMethodInfo?.label || order.payMethod}
                      />
                      <DetailItem
                        label="支付时间"
                        value={order.paidAt ? formatDate(order.paidAt) : '--'}
                      />
                      <DetailItem
                        label="到账积分"
                        value={`${order.credits} 积分`}
                        highlight
                      />
                    </div>
                    {order.transactionId && (
                      <div className="mt-3 border-t border-[var(--cine-line)] pt-3">
                        <DetailItem label="交易流水号" value={order.transactionId} mono />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* 分页 */}
      {!loading && pagination.totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-2">
          {/* 上一页 */}
          <button
            onClick={() => handlePageChange(pagination.page - 1)}
            disabled={pagination.page <= 1}
            className="rounded-lg border border-[var(--cine-line-2)] px-3 py-2 text-sm text-[var(--cine-text-2)] transition-colors hover:bg-[var(--cine-surface)] hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[var(--cine-text-2)]"
          >
            上一页
          </button>

          {/* 页码 */}
          {generatePageNumbers(pagination.page, pagination.totalPages).map(
            (pageNum, idx) =>
              pageNum === -1 ? (
                <span key={`ellipsis-${idx}`} className="px-2 text-[var(--cine-text-3)]">
                  ...
                </span>
              ) : (
                <button
                  key={pageNum}
                  onClick={() => handlePageChange(pageNum)}
                  className={`min-w-[36px] rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    pageNum === pagination.page
                      ? 'bg-[var(--cine-gold)] text-white'
                      : 'border border-[var(--cine-line-2)] text-[var(--cine-text-2)] hover:bg-[var(--cine-surface)] hover:text-white'
                  }`}
                >
                  {pageNum}
                </button>
              )
          )}

          {/* 下一页 */}
          <button
            onClick={() => handlePageChange(pagination.page + 1)}
            disabled={pagination.page >= pagination.totalPages}
            className="rounded-lg border border-[var(--cine-line-2)] px-3 py-2 text-sm text-[var(--cine-text-2)] transition-colors hover:bg-[var(--cine-surface)] hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[var(--cine-text-2)]"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * 详情展示项组件
 */
function DetailItem({
  label,
  value,
  mono,
  highlight,
}: {
  label: string
  value: string
  mono?: boolean
  highlight?: boolean
}) {
  return (
    <div>
      <p className="text-xs text-[var(--cine-text-3)]">{label}</p>
      <p
        className={`mt-0.5 text-sm ${
          highlight
            ? 'font-medium text-[var(--cine-gold)]'
            : mono
              ? 'font-mono text-[var(--cine-text-2)]'
              : 'text-[var(--cine-text)]'
        }`}
      >
        {value}
      </p>
    </div>
  )
}

/**
 * 生成页码数组（包含省略号标记 -1）
 */
function generatePageNumbers(current: number, total: number): number[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }

  const pages: number[] = []

  // 始终显示第一页
  pages.push(1)

  if (current > 3) {
    pages.push(-1) // 省略号
  }

  // 当前页前后各1页
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)

  for (let i = start; i <= end; i++) {
    pages.push(i)
  }

  if (current < total - 2) {
    pages.push(-1) // 省略号
  }

  // 始终显示最后一页
  pages.push(total)

  return pages
}
