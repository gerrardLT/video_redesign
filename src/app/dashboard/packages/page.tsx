'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Package {
  id: string
  name: string
  credits: number
  price: number
  description: string | null
  sortOrder: number
}

export default function PackagesPage() {
  const router = useRouter()
  const [packages, setPackages] = useState<Package[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPkg, setSelectedPkg] = useState<Package | null>(null)
  const [showPayModal, setShowPayModal] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetch('/api/packages')
      .then((res) => res.json())
      .then((data) => setPackages(data.packages || []))
      .catch(() => setPackages([]))
      .finally(() => setLoading(false))
  }, [])

  function handleBuyClick(pkg: Package) {
    setSelectedPkg(pkg)
    setShowPayModal(true)
  }

  async function handlePayMethodSelect(method: 'wechat' | 'alipay') {
    if (!selectedPkg || submitting) return
    setSubmitting(true)

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageId: selectedPkg.id,
          payMethod: method,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        alert(data.error || '创建订单失败')
        return
      }

      const data = await res.json()
      const orderId = data.order?.id
      if (orderId) {
        router.push(`/dashboard/orders/${orderId}/pay`)
      }
    } catch {
      alert('网络错误，请重试')
    } finally {
      setSubmitting(false)
      setShowPayModal(false)
      setSelectedPkg(null)
    }
  }

  function formatPrice(priceInCents: number): string {
    return `¥${(priceInCents / 100).toFixed(priceInCents % 100 === 0 ? 0 : 1)}`
  }

  function formatUnitPrice(priceInCents: number, credits: number): string {
    const unit = priceInCents / 100 / credits
    return `¥${unit.toFixed(2)}/积分`
  }

  return (
    <div>
      {/* 页面标题 */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">积分套餐</h1>
        <p className="mt-2 text-sm text-[var(--cine-text-2)]">选择适合你的套餐，获取积分开始创作</p>
      </div>

      {/* 加载状态?*/}
      {loading && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-72 animate-pulse rounded-xl bg-[var(--cine-surface)]" />
          ))}
        </div>
      )}

      {/* 套餐卡片网格 */}
      {!loading && packages.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {packages.map((pkg) => (
            <div
              key={pkg.id}
              className="flex flex-col rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] p-6 transition-all hover:border-[var(--cine-gold)]/50"
            >
              {/* 套餐名称 */}
              <h3 className="text-lg font-semibold text-white">{pkg.name}</h3>

              {/* 价格 */}
              <div className="mt-4">
                <span className="text-3xl font-bold text-white">
                  {formatPrice(pkg.price)}
                </span>
              </div>

              {/* 积分数量 */}
              <div className="mt-2 flex items-center gap-2">
                <svg
                  className="h-4 w-4 text-[var(--cine-gold)]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1"
                  />
                </svg>
                <span className="text-sm font-medium text-[var(--cine-text)]">
                  {pkg.credits} 积分
                </span>
              </div>

              {/* 单位积分价格 */}
              <p className="mt-1 text-xs text-[var(--cine-text-3)]">
                {formatUnitPrice(pkg.price, pkg.credits)}
              </p>

              {/* 描述 */}
              {pkg.description && (
                <p className="mt-3 flex-1 text-sm text-[var(--cine-text-2)]">{pkg.description}</p>
              )}
              {!pkg.description && <div className="flex-1" />}

              {/* 购买按钮 */}
              <button
                onClick={() => handleBuyClick(pkg)}
                className="mt-6 w-full rounded-lg bg-[var(--cine-gold)] py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--cine-gold)]/90"
              >
                立即购买
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 空状态?*/}
      {!loading && packages.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--cine-line-2)] py-20">
          <p className="text-lg font-medium text-[var(--cine-text-2)]">暂无可用套餐</p>
          <p className="mt-2 text-sm text-[var(--cine-text-3)]">请稍后再来查看</p>
        </div>
      )}

      {/* 支付方式选择弹窗 */}
      {showPayModal && selectedPkg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* 遮罩 */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => {
              if (!submitting) {
                setShowPayModal(false)
                setSelectedPkg(null)
              }
            }}
          />

          {/* 弹窗内容 */}
          <div className="relative w-full max-w-sm rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] p-6">
            <h3 className="text-lg font-semibold text-white">选择支付方式</h3>
            <p className="mt-1 text-sm text-[var(--cine-text-2)]">
              {selectedPkg.name} - {formatPrice(selectedPkg.price)}
            </p>

            <div className="mt-6 space-y-3">
              {/* 微信支付 */}
              <button
                onClick={() => handlePayMethodSelect('wechat')}
                disabled={submitting}
                className="flex w-full items-center gap-3 rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-surface)] px-4 py-3 transition-colors hover:border-[var(--cine-gold)]/50 hover:bg-[var(--cine-surface)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#07C160]/20">
                  <svg className="h-5 w-5 text-[#07C160]" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.295.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.045c.136 0 .246-.11.246-.245 0-.06-.024-.12-.04-.178l-.325-1.233a.492.492 0 0 1 .178-.554C23.028 18.572 24 16.878 24 14.991c0-3.392-3.07-6.13-7.062-6.133zm-2.18 2.86c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.983.97-.983zm4.36 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.983.969-.983z" />
                  </svg>
                </div>
                <span className="text-sm font-medium text-white">微信支付</span>
              </button>

              {/* 支付中?*/}
              <button
                onClick={() => handlePayMethodSelect('alipay')}
                disabled={submitting}
                className="flex w-full items-center gap-3 rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-surface)] px-4 py-3 transition-colors hover:border-[var(--cine-gold)]/50 hover:bg-[var(--cine-surface)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1677FF]/20">
                  <svg className="h-5 w-5 text-[#1677FF]" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M21.422 15.358c-3.32-1.577-6.27-3.15-6.27-3.15s1.594-3.727 1.942-5.64c.348-1.913-.198-3.278-1.942-3.447-1.744-.17-2.634 1.078-2.982 2.79-.348 1.712.05 4.502.05 4.502s-2.286.596-4.422.596c0 0 .05 1.565 1.594 1.565 1.544 0 2.634-.248 2.634-.248s1.594 3.626 4.87 5.986c0 0-3.072.844-6.916.844C4.438 19.156 0 15.082 0 10.958 0 4.91 5.373 0 12 0s12 4.91 12 10.958c0 2.194-.645 4.24-1.744 5.936-.198-.546-.486-1.14-.834-1.536z" />
                  </svg>
                </div>
                <span className="text-sm font-medium text-white">支付中</span>
              </button>
            </div>

            {/* 取消按钮 */}
            <button
              onClick={() => {
                if (!submitting) {
                  setShowPayModal(false)
                  setSelectedPkg(null)
                }
              }}
              disabled={submitting}
              className="mt-4 w-full rounded-lg py-2 text-sm text-[var(--cine-text-2)] transition-colors hover:text-[var(--cine-text)] disabled:cursor-not-allowed"
            >
              取消
            </button>

            {/* 提交中状态?*/}
            {submitting && (
              <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-[var(--cine-surface)]/80">
                <div className="flex items-center gap-2">
                  <svg
                    className="h-5 w-5 animate-spin text-[var(--cine-gold)]"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  <span className="text-sm text-[var(--cine-text)]">正在创建订单...</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
