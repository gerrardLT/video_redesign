'use client'

/**
 * 订阅套餐展示页面
 *
 * 展示月卡/年卡套餐卡片，包含价格、月积分、奖励积分、特权列表。
 * 支持选择支付方式（微信/支付宝）、自动续费开关、开通订阅按钮。
 * 使用 shadcn/ui Card 组件，cinematic dark theme。
 *
 * Requirements: 1.1, 1.2, 1.3
 */

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useSubscriptionStore, type SubscriptionPlan } from '@/stores/subscription-store'

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

export default function SubscriptionPlansPage() {
  const router = useRouter()
  const { plans, loading, error, fetchPlans, createSubscription } = useSubscriptionStore()

  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [payMethod, setPayMethod] = useState<'wechat' | 'alipay'>('wechat')
  const [autoRenewal, setAutoRenewal] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    fetchPlans()
  }, [fetchPlans])

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
      // 支付结果处理：跳转支付链接或显示二维码
      if (paymentResult.payUrl) {
        window.location.href = paymentResult.payUrl
      } else if (paymentResult.qrCode) {
        // 微信支付二维码场景：后续可扩展弹窗展示
        window.open(paymentResult.qrCode, '_blank')
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '开通失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  /** 解析特权 JSON 字符串为列表 */
  function parsePrivileges(privilegesJson: string): string[] {
    try {
      return JSON.parse(privilegesJson) as string[]
    } catch {
      return []
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      {/* 页面标题 */}
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-[var(--cine-text)]">选择会员套餐</h1>
        <p className="mt-2 text-sm text-[var(--cine-text-3)]">
          开通会员享受优先队列、1080p 高清、去水印等专属权益
        </p>
      </div>

      {/* 加载状态 */}
      {loading && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-80 animate-pulse rounded-xl bg-[var(--cine-surface)]" />
          ))}
        </div>
      )}

      {/* 错误状态 */}
      {error && (
        <div className="rounded-lg bg-red-500/10 p-4 text-center text-sm text-red-400">
          {error}
        </div>
      )}

      {/* 套餐卡片列表 */}
      {!loading && plans.length > 0 && (
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
      )}

      {/* 支付选项区 */}
      {!loading && plans.length > 0 && (
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
            开通即表示同意《会员服务协议》，{autoRenewal ? '到期将自动续费，可随时在此页面取消' : '到期后需手动续费'}
          </p>
        </div>
      )}

      {/* 返回按钮 */}
      <div className="mt-6 text-center">
        <button
          onClick={() => router.push('/dashboard/subscription')}
          className="text-sm text-[var(--cine-text-3)] transition-colors hover:text-[var(--cine-text-2)]"
        >
          ← 返回会员管理
        </button>
      </div>
    </div>
  )
}
