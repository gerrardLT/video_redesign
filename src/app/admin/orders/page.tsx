'use client'

import { useEffect, useState, useCallback } from 'react'

interface OrderItem {
  id: string
  userId: string
  packageId: string
  amount: number
  credits: number
  status: string
  payMethod: string
  transactionId: string | null
  paidAt: string | null
  expireAt: string
  createdAt: string
  user: {
    email: string
    nickname: string | null
  }
  package: {
    name: string
  }
}

interface RevenueStats {
  today: number
  week: number
  month: number
  total: number
}

interface PackageSale {
  packageId: string
  packageName: string
  count: number
}

interface PackageOption {
  id: string
  name: string
}

export default function AdminOrdersPage() {
  // 统计数据
  const [revenue, setRevenue] = useState<RevenueStats>({ today: 0, week: 0, month: 0, total: 0 })
  const [packageSales, setPackageSales] = useState<PackageSale[]>([])
  const [statsLoading, setStatsLoading] = useState(true)

  // 订单列表
  const [orders, setOrders] = useState<OrderItem[]>([])
  const [ordersLoading, setOrdersLoading] = useState(true)
  const [error, setError] = useState('')

  // 分页
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)

  // 筛选
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterPackageId, setFilterPackageId] = useState('')

  // 套餐选项（用于筛选下拉)
  const [packageOptions, setPackageOptions] = useState<PackageOption[]>([])

  // 加载套餐选项
  useEffect(() => {
    fetch('/api/packages')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.packages) {
          setPackageOptions(data.packages.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })))
        }
      })
      .catch(() => {})
  }, [])

  // 加载统计数据
  useEffect(() => {
    setStatsLoading(true)
    fetch('/api/admin/orders/stats')
      .then((res) => {
        if (!res.ok) throw new Error('获取统计数据失败')
        return res.json()
      })
      .then((data) => {
        setRevenue(data.revenue)
        setPackageSales(data.packageSales)
      })
      .catch(() => {})
      .finally(() => setStatsLoading(false))
  }, [])

  // 加载订单列表
  const fetchOrders = useCallback(() => {
    setOrdersLoading(true)
    setError('')

    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', '20')
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)
    if (filterStatus) params.set('status', filterStatus)
    if (filterPackageId) params.set('packageId', filterPackageId)

    fetch(`/api/admin/orders?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error('获取订单列表失败')
        return res.json()
      })
      .then((data) => {
        setOrders(data.orders)
        setTotal(data.total)
        setTotalPages(data.totalPages)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : '未知错误'))
      .finally(() => setOrdersLoading(false))
  }, [page, startDate, endDate, filterStatus, filterPackageId])

  useEffect(() => {
    fetchOrders()
  }, [fetchOrders])

  // 筛选表单提交
  function handleFilter(e: React.FormEvent) {
    e.preventDefault()
    setPage(1)
    fetchOrders()
  }

  // 重置筛选
  function handleReset() {
    setStartDate('')
    setEndDate('')
    setFilterStatus('')
    setFilterPackageId('')
    setPage(1)
  }

  // 格式化金额（分→元)
  function formatAmount(amount: number) {
    return `¥${(amount / 100).toFixed(2)}`
  }

  // 状态标签
  function statusLabel(status: string) {
    switch (status) {
      case 'PENDING': return '待支付'
      case 'PAID': return '已支'
      case 'EXPIRED': return '已过'
      case 'REQUIRES_MANUAL_REVIEW': return '需人工处理'
      default: return status
    }
  }

  function statusColor(status: string) {
    switch (status) {
      case 'PENDING': return 'bg-yellow-500/20 text-yellow-400'
      case 'PAID': return 'bg-green-500/20 text-[var(--cine-green)]'
      case 'EXPIRED': return 'bg-[var(--cine-surface)] text-[var(--cine-text-2)]'
      case 'REQUIRES_MANUAL_REVIEW': return 'bg-red-500/20 text-red-400'
      default: return 'bg-[var(--cine-surface)] text-[var(--cine-text-2)]'
    }
  }

  // 支付方式标签
  function payMethodLabel(method: string) {
    switch (method) {
      case 'wechat': return '微信支付'
      case 'alipay': return '支付'
      default: return method
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-white">订单管理</h1>

      {/* 收入统计面板 */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="今日收入"
          value={formatAmount(revenue.today)}
          loading={statsLoading}
        />
        <StatCard
          label="本周收入"
          value={formatAmount(revenue.week)}
          loading={statsLoading}
        />
        <StatCard
          label="本月收入"
          value={formatAmount(revenue.month)}
          loading={statsLoading}
        />
        <StatCard
          label="累计收入"
          value={formatAmount(revenue.total)}
          loading={statsLoading}
          highlight
        />
      </div>

      {/* 套餐销售数量分布图表）*/}
      <div className="mb-6 rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-surface)] p-4">
        <h2 className="mb-4 text-sm font-medium text-[var(--cine-text-2)]">各套餐销售数量分布</h2>
        {statsLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--cine-gold)] border-t-transparent" />
          </div>
        ) : packageSales.length > 0 ? (
          <PackageSalesChart sales={packageSales} />
        ) : (
          <div className="py-8 text-center text-sm text-[var(--cine-text-3)]">暂无销售数量</div>
        )}
      </div>

      {/* 筛选条件?*/}
      <div className="mb-4 rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-surface)] p-4">
        <form onSubmit={handleFilter} className="flex flex-wrap items-end gap-4">
          <div className="min-w-[140px]">
            <label className="mb-1.5 block text-sm text-[var(--cine-text-2)]">开始日</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-bg)] px-3 py-2 text-sm text-[var(--cine-text)] outline-none focus:border-[var(--cine-gold)]"
            />
          </div>
          <div className="min-w-[140px]">
            <label className="mb-1.5 block text-sm text-[var(--cine-text-2)]">结束日期</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-bg)] px-3 py-2 text-sm text-[var(--cine-text)] outline-none focus:border-[var(--cine-gold)]"
            />
          </div>
          <div className="min-w-[130px]">
            <label className="mb-1.5 block text-sm text-[var(--cine-text-2)]">支付状态</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-bg)] px-3 py-2 text-sm text-[var(--cine-text)] outline-none focus:border-[var(--cine-gold)]"
            >
              <option value="">全部状态</option>
              <option value="PENDING">待支付</option>
              <option value="PAID">已支付</option>
              <option value="EXPIRED">已过期</option>
              <option value="REQUIRES_MANUAL_REVIEW">需人工处理</option>
            </select>
          </div>
          <div className="min-w-[130px]">
            <label className="mb-1.5 block text-sm text-[var(--cine-text-2)]">套餐类型</label>
            <select
              value={filterPackageId}
              onChange={(e) => setFilterPackageId(e.target.value)}
              className="w-full rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-bg)] px-3 py-2 text-sm text-[var(--cine-text)] outline-none focus:border-[var(--cine-gold)]"
            >
              <option value="">全部套餐</option>
              {packageOptions.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>{pkg.name}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-lg bg-[var(--cine-gold)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-80"
            >
              筛&apos;            </button>
            <button
              type="button"
              onClick={handleReset}
              className="rounded-lg border border-[var(--cine-line-2)] px-4 py-2 text-sm text-[var(--cine-text-2)] transition-colors hover:bg-[var(--cine-surface)] hover:text-white"
            >
              重置
            </button>
          </div>
        </form>
      </div>

      {/* 订单列表 */}
      <div className="rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-surface)]">
        <div className="flex items-center justify-between border-b border-[var(--cine-line-2)] px-4 py-3">
          <h2 className="text-lg font-semibold text-white/90">订单列表</h2>
          <span className="text-sm text-[var(--cine-text-3)]">共 {total} 条</span>
        </div>

        {error && (
          <div className="mx-4 mt-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {ordersLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--cine-gold)] border-t-transparent" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--cine-line-2)] text-left text-[var(--cine-text-2)]">
                  <th className="px-4 py-3 font-medium">订单ID</th>
                  <th className="px-4 py-3 font-medium">用户</th>
                  <th className="px-4 py-3 font-medium">套餐名称</th>
                  <th className="px-4 py-3 font-medium">金额</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3 font-medium">支付方式</th>
                  <th className="px-4 py-3 font-medium">创建时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {orders.map((order) => (
                  <tr key={order.id} className="text-[var(--cine-text)] hover:bg-[var(--cine-surface)]">
                    <td className="px-4 py-3 font-mono text-xs text-[var(--cine-text-2)]">
                      {order.id.slice(0, 12)}...
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs text-[var(--cine-text)]">
                        {order.user.nickname || order.user.email}
                      </div>
                      {order.user.nickname && (
                        <div className="text-xs text-[var(--cine-text-3)]">{order.user.email}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">{order.package.name}</td>
                    <td className="px-4 py-3 font-mono">{formatAmount(order.amount)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${statusColor(order.status)}`}>
                        {statusLabel(order.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--cine-text-2)]">
                      {payMethodLabel(order.payMethod)}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--cine-text-2)]">
                      {new Date(order.createdAt).toLocaleString('zh-CN')}
                    </td>
                  </tr>
                ))}
                {orders.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-[var(--cine-text-3)]">
                      暂无订单数据
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* 分页 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-[var(--cine-line-2)] px-4 py-3">
            <span className="text-sm text-[var(--cine-text-3)]">
              第 {page} / {totalPages} 页
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-[var(--cine-line-2)] px-3 py-1.5 text-sm text-[var(--cine-text-2)] transition-colors hover:bg-[var(--cine-surface)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                上一页
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-lg border border-[var(--cine-line-2)] px-3 py-1.5 text-sm text-[var(--cine-text-2)] transition-colors hover:bg-[var(--cine-surface)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// 统计卡片组件
function StatCard({
  label,
  value,
  loading,
  highlight,
}: {
  label: string
  value: string
  loading: boolean
  highlight?: boolean
}) {
  return (
    <div className={`rounded-lg border p-4 ${highlight ? 'border-[var(--cine-gold)]/30 bg-[var(--cine-gold)]/5' : 'border-[var(--cine-line-2)] bg-[var(--cine-surface)]'}`}>
      <div className="mb-1 text-sm text-[var(--cine-text-2)]">{label}</div>
      {loading ? (
        <div className="h-7 w-20 animate-pulse rounded bg-[var(--cine-surface)]" />
      ) : (
        <div className={`text-xl font-bold ${highlight ? 'text-[var(--cine-gold)]' : 'text-white'}`}>
          {value}
        </div>
      )}
    </div>
  )
}

// 套餐销售数量分布柱状图组件（纯 CSS 实现）
function PackageSalesChart({ sales }: { sales: PackageSale[] }) {
  const maxCount = Math.max(...sales.map((s) => s.count), 1)

  // 为每个套餐分配颜色
  const barColors = [
    'bg-[var(--cine-gold)]',   // 紫色（主色)
    'bg-[#8b5cf6]',   // 浅紫
    'bg-[#06b6d4]',   // 青色
    'bg-[#10b981]',   // 绿色
    'bg-[#f59e0b]',   // 琥珀色
    'bg-[#ef4444]',   // 红色
  ]

  return (
    <div className="space-y-3">
      {sales.map((sale, index) => {
        const percentage = (sale.count / maxCount) * 100
        const colorClass = barColors[index % barColors.length]

        return (
          <div key={sale.packageId} className="group">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm text-[var(--cine-text-2)]">{sale.packageName}</span>
              <span className="text-sm font-medium text-white/90">{sale.count} 单</span>
            </div>
            <div className="h-7 w-full overflow-hidden rounded-md bg-[var(--cine-surface)]">
              <div
                className={`flex h-full items-center rounded-md transition-all duration-500 ${colorClass}`}
                style={{ width: `${Math.max(percentage, 2)}%` }}
              >
                {percentage > 15 && (
                  <span className="pl-2 text-xs font-medium text-white/90">
                    {Math.round(percentage)}%
                  </span>
                )}
              </div>
            </div>
          </div>
        )
      })}

      {/* 图例与合计 */}
      <div className="mt-4 flex items-center justify-between border-t border-[var(--cine-line)] pt-3">
        <div className="flex flex-wrap gap-3">
          {sales.map((sale, index) => (
            <div key={sale.packageId} className="flex items-center gap-1.5">
              <div className={`h-2.5 w-2.5 rounded-sm ${barColors[index % barColors.length]}`} />
              <span className="text-xs text-[var(--cine-text-2)]">{sale.packageName}</span>
            </div>
          ))}
        </div>
        <span className="text-xs text-[var(--cine-text-3)]">
          总计 {sales.reduce((sum, s) => sum + s.count, 0)} 单
        </span>
      </div>
    </div>
  )
}
