'use client'

/**
 * 统一定价页面 — 会员订阅 + 积分包
 *
 * 顶部：当前会员状态卡片（已订阅显示详情，未订阅显示升级 banner）
 * Tab 1 - 会员订阅：套餐卡片、支付方式、自动续费、开通按钮
 * Tab 2 - 积分包：积分包卡片、购买流程
 *
 * 默认 Tab：已有活跃订阅 → Tab 2（积分包），否则 → Tab 1（会员订阅）
 *
 * API 端点：
 * - GET /api/subscriptions/status → 会员状态 + 特权
 * - GET /api/subscriptions/plans  → 套餐列表
 * - GET /api/packages             → 积分包列表
 * - POST /api/subscriptions/create → 创建订阅
 * - POST /api/orders              → 创建积分包订单
 */

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  useSubscriptionStore,
  type SubscriptionPlan,
  type SubscriptionRecord,
  type UserPrivileges,
} from '@/stores/subscription-store'

// ========================
// 类型
// ========================

interface CreditPackage {
  id: string
  name: string
  credits: number
  price: number
  description: string | null
  sortOrder: number
}

type TabKey = 'subscription' | 'credits'

// ========================
// 工具函数
// ========================

/** 格式化价格（分 → 元） */
function formatPrice(priceCents: number): string {
  return (priceCents / 100).toFixed(priceCents % 100 === 0 ? 0 : 1)
}

/** 计算月均价格（年卡按12月，季卡按3月） */
function monthlyPrice(plan: SubscriptionPlan): string {
  if (plan.type === 'yearly') {
    return (plan.price / 100 / 12).toFixed(1)
  }
  if (plan.type === 'quarterly') {
    return (plan.price / 100 / 3).toFixed(1)
  }
  return formatPrice(plan.price)
}

/** 格式化单位积分价格 */
function formatUnitPrice(priceCents: number, credits: number): string {
  const unit = priceCents / 100 / credits
  return `¥${unit.toFixed(2)}/积分`
}

/** 解析特权 JSON 字符串为列表 */
function parsePrivileges(privilegesJson: string): string[] {
  try {
    return JSON.parse(privilegesJson) as string[]
  } catch {
    return []
  }
}

/** 格式化日期 */
function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

// ========================
// 会员状态卡片组件
// ========================

function MembershipStatusCard({
  subscription,
  privileges,
}: {
  subscription: SubscriptionRecord | null
  privileges: UserPrivileges | null
}) {
  const isActive = subscription?.status === 'ACTIVE'

  if (isActive && subscription) {
    return (
      <div className="mb-8 rounded-xl border border-[var(--cine-gold)]/30 bg-[var(--cine-gold-dim)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {/* 金色会员图标 */}
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--cine-gold)]/20">
              <svg className="h-5 w-5 text-[var(--cine-gold)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3l3.5 4L12 3l3.5 4L19 3v13a2 2 0 01-2 2H7a2 2 0 01-2-2V3z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold text-[var(--cine-text)]">
                  {subscription.plan.name}
                </span>
                <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-400">
                  生效中
                </span>
              </div>
              <p className="mt-0.5 text-xs text-[var(--cine-text-3)]">
                到期时间：{formatDate(subscription.endDate)}
              </p>
            </div>
          </div>
          <Link
            href="/dashboard/subscription"
            className="rounded-lg border border-[var(--cine-gold)]/40 px-4 py-2 text-sm font-medium text-[var(--cine-gold)] transition-colors hover:bg-[var(--cine-gold)]/10"
          >
            管理会员
          </Link>
        </div>
      </div>
    )
  }

  // 未订阅：升级 banner
  return (
    <div className="mb-8 rounded-xl border border-[var(--cine-gold)]/20 bg-[var(--cine-surface)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--cine-gold)]/10">
            <svg className="h-5 w-5 text-[var(--cine-gold)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <p className="text-sm text-[var(--cine-text-2)]">
            开通会员每月500积分到账 + 1080p + 去水印 + 优先队列
          </p>
        </div>
      </div>
    </div>
  )
}

// ========================
// Tab 1: 会员订阅
// ========================

function SubscriptionTab({ plans }: { plans: SubscriptionPlan[] }) {
  const { createSubscription } = useSubscriptionStore()

  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [payMethod, setPayMethod] = useState<'wechat' | 'alipay'>('wechat')
  const [autoRenewal, setAutoRenewal] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // 默认选中第一个套餐
  useEffect(() => {
    if (plans.length > 0 && !selectedPlanId) {
      setSelectedPlanId(plans[0].id)
    }
  }, [plans, selectedPlanId])

  async function handleSubscribe() {
    if (!selectedPlanId) return

    setSubmitting(true)
    setSubmitError(null)
    try {
      const paymentResult = await createSubscription(selectedPlanId, payMethod, autoRenewal)
      if (paymentResult.payUrl) {
        window.location.href = paymentResult.payUrl
      } else if (paymentResult.qrCode) {
        window.open(paymentResult.qrCode, '_blank')
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '开通失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  if (plans.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--cine-line-2)] py-20">
        <p className="text-lg font-medium text-[var(--cine-text-2)]">暂无可用套餐</p>
        <p className="mt-2 text-sm text-[var(--cine-text-3)]">请稍后再来查看</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl">
      {/* 套餐卡片列表 */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan) => {
          const isSelected = selectedPlanId === plan.id
          const privileges = parsePrivileges(plan.privileges)
          const isYearly = plan.type === 'yearly'

          return (
            <Card
              key={plan.id}
              className={`relative cursor-pointer overflow-visible border transition-all ${
                isSelected
                  ? 'border-[var(--cine-gold)] bg-[var(--cine-gold-dim)]'
                  : 'border-[var(--cine-line)] bg-[var(--cine-surface)] hover:border-[var(--cine-line-2)]'
              }`}
              onClick={() => setSelectedPlanId(plan.id)}
            >
              {/* 年卡推荐标签 */}
              {isYearly && (
                <div className="absolute -top-3 left-1/2 z-10 -translate-x-1/2">
                  <span className="rounded-full bg-[var(--cine-gold)] px-3 py-1 text-xs font-medium text-[var(--cine-ink)]">
                    推荐 · 省 30%+
                  </span>
                </div>
              )}

              {/* 季卡热门标签 */}
              {plan.type === 'quarterly' && (
                <div className="absolute -top-3 left-1/2 z-10 -translate-x-1/2">
                  <span className="rounded-full bg-[var(--cine-gold)] px-3 py-1 text-xs font-medium text-[var(--cine-ink)]">
                    热门 · 省 11%
                  </span>
                </div>
              )}

              <CardHeader className="pb-2 pt-6">
                <CardTitle className="text-center text-lg text-[var(--cine-text)]">
                  {plan.name}
                </CardTitle>
              </CardHeader>

              <CardContent className="flex flex-col items-center gap-4">
                {/* 价格区 */}
                <div className="text-center">
                  <div className="flex items-baseline justify-center gap-1">
                    <span className="text-sm text-[var(--cine-text-3)]">¥</span>
                    <span className="text-4xl font-bold text-[var(--cine-text)]">
                      {formatPrice(plan.price)}
                    </span>
                    <span className="text-sm text-[var(--cine-text-3)]">
                      /{plan.type === 'yearly' ? '年' : plan.type === 'quarterly' ? '季' : '月'}
                    </span>
                  </div>
                  {(plan.type === 'yearly' || plan.type === 'quarterly') && (
                    <p className="mt-1 text-xs text-[var(--cine-gold)]">
                      约 ¥{monthlyPrice(plan)}/月
                    </p>
                  )}
                </div>

                {/* 积分信息 */}
                <div className="w-full rounded-lg bg-[var(--cine-bg)] p-3 text-center">
                  <p className="text-sm text-[var(--cine-text-2)]">
                    每月到账 <span className="font-semibold text-[var(--cine-gold)]">{plan.monthlyCredits}</span> 积分
                  </p>
                  {plan.bonusCredits > 0 && (
                    <p className="mt-1 text-xs text-[var(--cine-green,#4ade80)]">
                      + 开通即赠 {plan.bonusCredits} 奖励积分
                    </p>
                  )}
                </div>

                {/* 特权列表 */}
                <ul className="w-full space-y-2">
                  {privileges.map((privilege, idx) => (
                    <li
                      key={idx}
                      className="flex items-center gap-2 text-sm text-[var(--cine-text-2)]"
                    >
                      <svg
                        className="h-4 w-4 shrink-0 text-[var(--cine-gold)]"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                      {privilege}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* 支付选项区 */}
      <div className="mt-8 rounded-xl border border-[var(--cine-line)] bg-[var(--cine-surface)] p-6">
        {/* 支付方式选择 */}
        <div className="mb-4">
          <p className="mb-2 text-sm font-medium text-[var(--cine-text-2)]">支付方式</p>
          <div className="flex gap-3">
            <button
              onClick={() => setPayMethod('wechat')}
              className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-all ${
                payMethod === 'wechat'
                  ? 'border-[var(--cine-gold)] bg-[var(--cine-gold-dim)] text-[var(--cine-text)]'
                  : 'border-[var(--cine-line)] text-[var(--cine-text-2)] hover:border-[var(--cine-line-2)]'
              }`}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18z" />
                <path d="M23.16 14.09c0-3.218-3.104-5.828-6.912-5.828-3.847 0-6.951 2.61-6.951 5.828 0 3.218 3.104 5.828 6.951 5.828a8.26 8.26 0 0 0 2.293-.327.724.724 0 0 1 .594.08l1.544.907a.254.254 0 0 0 .135.045.237.237 0 0 0 .233-.235c0-.058-.023-.115-.039-.173l-.316-1.21a.477.477 0 0 1 .17-.533C22.142 17.702 23.16 15.989 23.16 14.09zm-9.455-1.095c-.523 0-.947-.431-.947-.963s.424-.963.947-.963.947.431.947.963-.424.963-.947.963zm5.043 0c-.523 0-.947-.431-.947-.963s.424-.963.947-.963.947.431.947.963-.424.963-.947.963z" />
              </svg>
              微信支付
            </button>
            <button
              onClick={() => setPayMethod('alipay')}
              className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-all ${
                payMethod === 'alipay'
                  ? 'border-[var(--cine-gold)] bg-[var(--cine-gold-dim)] text-[var(--cine-text)]'
                  : 'border-[var(--cine-line)] text-[var(--cine-text-2)] hover:border-[var(--cine-line-2)]'
              }`}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M21.422 14.099c-.637-.245-3.755-1.553-4.754-2.034-.291-.141-.554-.27-.554-.27s-.685 1.594-2.072 2.847c-1.02.921-2.254 1.421-3.313 1.421-.456 0-.872-.092-1.232-.297-1.627-.928-1.45-3.258-.378-5.265.72-1.349 2.136-2.994 4.074-3.868a6.74 6.74 0 0 1 2.85-.65c.502 0 .97.06 1.393.178l.01-.032c-.396-.147-2.01-.645-3.56-.645-2.091 0-4.178.78-5.615 2.5C6.757 9.695 6.255 12.072 7.01 13.99c.545 1.382 1.871 2.276 3.532 2.276 2.186 0 4.204-1.326 5.47-2.667.173.097.337.19.487.275 1.34.762 2.598 1.213 3.565 1.448A2.5 2.5 0 0 0 21.422 14.099z" />
                <path d="M21.5 2h-19A2.5 2.5 0 0 0 0 4.5v15A2.5 2.5 0 0 0 2.5 22h19a2.5 2.5 0 0 0 2.5-2.5v-15A2.5 2.5 0 0 0 21.5 2zm.923 13.322c-.967-.235-2.225-.686-3.565-1.448-.15-.085-.314-.178-.487-.275-1.266 1.341-3.284 2.667-5.47 2.667-1.661 0-2.987-.894-3.532-2.276-.755-1.918-.257-4.295 1.257-5.907 1.437-1.72 3.524-2.5 5.615-2.5 1.55 0 3.164.498 3.56.645l-.01.032a5.107 5.107 0 0 0-1.393-.178 6.74 6.74 0 0 0-2.85.65c-1.938.874-3.354 2.519-4.074 3.868-1.072 2.007-1.249 4.337.378 5.265.36.205.776.297 1.232.297 1.059 0 2.293-.5 3.313-1.421 1.387-1.253 2.072-2.847 2.072-2.847s.263.129.554.27c.999.481 4.117 1.789 4.754 2.034a2.5 2.5 0 0 1-.354 1.123z" />
              </svg>
              支付宝
            </button>
          </div>
        </div>

        {/* 自动续费开关 */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-[var(--cine-text-2)]">自动续费</p>
            <p className="text-xs text-[var(--cine-text-3)]">到期自动扣款，可随时取消</p>
          </div>
          <button
            onClick={() => setAutoRenewal(!autoRenewal)}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              autoRenewal ? 'bg-[var(--cine-gold)]' : 'bg-[var(--cine-line-2)]'
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                autoRenewal ? 'left-[22px]' : 'left-0.5'
              }`}
            />
          </button>
        </div>

        {/* 开通按钮 */}
        <Button
          onClick={handleSubscribe}
          disabled={!selectedPlanId || submitting}
          className="w-full bg-[var(--cine-gold)] py-3 text-base font-medium text-[var(--cine-ink)] hover:bg-[var(--cine-gold-2)] disabled:opacity-50"
        >
          {submitting ? '处理中...' : '立即开通'}
        </Button>

        {/* 提交错误 */}
        {submitError && (
          <p className="mt-3 text-center text-sm text-red-400">{submitError}</p>
        )}

        {/* 协议说明 */}
        <p className="mt-3 text-center text-xs text-[var(--cine-text-3)]">
          开通即表示同意《会员服务协议》，{autoRenewal ? '到期将自动续费，可随时在会员管理页面取消' : '到期后需手动续费'}
        </p>
      </div>
    </div>
  )
}

// ========================
// Tab 2: 积分包
// ========================

function CreditsTab({ packages }: { packages: CreditPackage[] }) {
  const router = useRouter()
  const [selectedPkg, setSelectedPkg] = useState<CreditPackage | null>(null)
  const [showPayModal, setShowPayModal] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  function handleBuyClick(pkg: CreditPackage) {
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

  if (packages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--cine-line-2)] py-20">
        <p className="text-lg font-medium text-[var(--cine-text-2)]">暂无可用套餐</p>
        <p className="mt-2 text-sm text-[var(--cine-text-3)]">请稍后再来查看</p>
      </div>
    )
  }

  return (
    <>
      {/* 积分包卡片网格 */}
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
                ¥{formatPrice(pkg.price)}
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
              className="mt-6 w-full rounded-lg bg-[var(--cine-gold)] py-2.5 text-sm font-medium text-[var(--cine-ink)] transition-colors hover:bg-[var(--cine-gold)]/90"
            >
              立即购买
            </button>
          </div>
        ))}
      </div>

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
              {selectedPkg.name} - ¥{formatPrice(selectedPkg.price)}
            </p>

            <div className="mt-6 space-y-3">
              {/* 微信支付 */}
              <button
                onClick={() => handlePayMethodSelect('wechat')}
                disabled={submitting}
                className="flex w-full items-center gap-3 rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-surface)] px-4 py-3 transition-colors hover:border-[var(--cine-gold)]/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#07C160]/20">
                  <svg className="h-5 w-5 text-[#07C160]" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.295.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.045c.136 0 .246-.11.246-.245 0-.06-.024-.12-.04-.178l-.325-1.233a.492.492 0 0 1 .178-.554C23.028 18.572 24 16.878 24 14.991c0-3.392-3.07-6.13-7.062-6.133zm-2.18 2.86c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.983.97-.983zm4.36 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.983.969-.983z" />
                  </svg>
                </div>
                <span className="text-sm font-medium text-white">微信支付</span>
              </button>

              {/* 支付宝 */}
              <button
                onClick={() => handlePayMethodSelect('alipay')}
                disabled={submitting}
                className="flex w-full items-center gap-3 rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-surface)] px-4 py-3 transition-colors hover:border-[var(--cine-gold)]/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1677FF]/20">
                  <svg className="h-5 w-5 text-[#1677FF]" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M21.422 15.358c-3.32-1.577-6.27-3.15-6.27-3.15s1.594-3.727 1.942-5.64c.348-1.913-.198-3.278-1.942-3.447-1.744-.17-2.634 1.078-2.982 2.79-.348 1.712.05 4.502.05 4.502s-2.286.596-4.422.596c0 0 .05 1.565 1.594 1.565 1.544 0 2.634-.248 2.634-.248s1.594 3.626 4.87 5.986c0 0-3.072.844-6.916.844C4.438 19.156 0 15.082 0 10.958 0 4.91 5.373 0 12 0s12 4.91 12 10.958c0 2.194-.645 4.24-1.744 5.936-.198-.546-.486-1.14-.834-1.536z" />
                  </svg>
                </div>
                <span className="text-sm font-medium text-white">支付宝</span>
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

            {/* 提交中状态 */}
            {submitting && (
              <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-[var(--cine-surface)]/80">
                <div className="flex items-center gap-2">
                  <svg className="h-5 w-5 animate-spin text-[var(--cine-gold)]" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span className="text-sm text-[var(--cine-text)]">正在创建订单...</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

// ========================
// 主页面组件
// ========================

export default function PackagesPage() {
  const {
    currentSubscription,
    privileges,
    plans,
    loading: storeLoading,
    fetchCurrentSubscription,
    fetchPlans,
  } = useSubscriptionStore()

  const [packages, setPackages] = useState<CreditPackage[]>([])
  const [packagesLoading, setPackagesLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabKey | null>(null)
  const [statusLoaded, setStatusLoaded] = useState(false)

  // 获取订阅状态（用于判断默认 tab 和顶部状态卡片）
  useEffect(() => {
    fetchCurrentSubscription().finally(() => setStatusLoaded(true))
  }, [fetchCurrentSubscription])

  // 获取订阅套餐列表
  useEffect(() => {
    fetchPlans()
  }, [fetchPlans])

  // 获取积分包列表
  useEffect(() => {
    fetch('/api/packages')
      .then((res) => res.json())
      .then((data) => setPackages(data.packages || []))
      .catch(() => setPackages([]))
      .finally(() => setPackagesLoading(false))
  }, [])

  // 根据订阅状态设置默认 tab
  useEffect(() => {
    if (statusLoaded && activeTab === null) {
      const isActive = currentSubscription?.status === 'ACTIVE'
      setActiveTab(isActive ? 'credits' : 'subscription')
    }
  }, [statusLoaded, currentSubscription, activeTab])

  const isLoading = !statusLoaded || storeLoading

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'subscription', label: '会员订阅' },
    { key: 'credits', label: '积分包' },
  ]

  return (
    <div>
      {/* 页面标题 */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">定价方案</h1>
        <p className="mt-2 text-sm text-[var(--cine-text-2)]">
          选择会员订阅或积分包，开始你的创作之旅
        </p>
      </div>

      {/* 会员状态卡片 */}
      {statusLoaded && (
        <MembershipStatusCard
          subscription={currentSubscription}
          privileges={privileges}
        />
      )}

      {/* Tab 切换 */}
      <div className="mb-8 border-b border-[var(--cine-line)]">
        <div className="flex gap-8">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`relative pb-3 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'text-[var(--cine-gold)]'
                  : 'text-[var(--cine-text-3)] hover:text-[var(--cine-text-2)]'
              }`}
            >
              {tab.label}
              {/* 金色下划线 */}
              {activeTab === tab.key && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-[var(--cine-gold)]" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* 加载骨架屏 */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-80 animate-pulse rounded-xl bg-[var(--cine-surface)]" />
          ))}
        </div>
      )}

      {/* Tab 内容 */}
      {!isLoading && activeTab === 'subscription' && (
        <SubscriptionTab plans={plans} />
      )}

      {!isLoading && activeTab === 'credits' && (
        packagesLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-72 animate-pulse rounded-xl bg-[var(--cine-surface)]" />
            ))}
          </div>
        ) : (
          <CreditsTab packages={packages} />
        )
      )}
    </div>
  )
}
