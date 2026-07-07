'use client'

/**
 * 会员与积分页 — /merchant/stores/[storeId]/membership
 *
 * 商家自助升级会员 / 充值积分的入口页，接通此前缺失的付费转化路径。
 * 全程对接真实接口与真实支付网关（微信 Native 二维码 / 支付宝 PC 跳转），无 mock。
 *
 * 数据 / 接口：
 * - GET  /api/merchant/subscription      当前会员等级 + 积分余额
 * - GET  /api/subscriptions/plans        会员套餐列表
 * - POST /api/subscriptions/create       创建订阅订单（返回 paymentParams）
 * - GET  /api/packages                   积分充值套餐列表
 * - POST /api/orders                     创建积分订单（返回 paymentParams）
 *
 * 支付呈现：
 * - 支付宝：paymentParams.payUrl → 直接跳转
 * - 微信：paymentParams.qrCode（code_url）→ 弹窗展示二维码，扫码支付
 *   支付成功由后端回调入账（/api/payments/{channel}/subscription-callback），
 *   前端「我已支付」后刷新余额 / 会员状态。
 *
 * Requirements: 2.3, 5.1, 5.2（计费收敛后统一 UserTier）
 */

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import useSWR from 'swr'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/shared/utils'
import { ArrowLeft, Crown, Coins, Check, X } from 'lucide-react'

// ─── 数据获取 ───

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: '请求失败' } }))
    throw new Error(err.error?.message || err.error || '请求失败')
  }
  return res.json()
}

// ─── 类型 ───

interface SubscriptionPlan {
  id: string
  name: string
  type: string
  price: number // 单位：分
  monthlyCredits: number
  bonusCredits: number
  description: string | null
  sortOrder: number
}

interface CreditPackage {
  id: string
  name: string
  credits: number
  price: number // 单位：分
  description: string | null
  sortOrder: number
}

interface PaymentParams {
  paymentId?: string
  payUrl?: string
  qrCode?: string
  expiresAt?: string
}

type PayMethod = 'wechat' | 'alipay'
type TabKey = 'membership' | 'credits'

// ─── 会员等级中文名（与首页保持一致） ───

const MEMBER_TIER_LABELS: Record<string, string> = {
  FREE: '免费版',
  MONTHLY: '月卡会员',
  YEARLY: '年卡会员',
}

// ─── 主页面 ───

export default function MembershipPage() {
  const params = useParams<{ storeId: string }>()
  const router = useRouter()
  const { storeId } = params

  const [tab, setTab] = useState<TabKey>('membership')
  const [payMethod, setPayMethod] = useState<PayMethod>('wechat')
  const [submittingId, setSubmittingId] = useState<string | null>(null)
  const [qrModal, setQrModal] = useState<{ qrCode: string; title: string } | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // 当前会员 + 余额
  const { data: sub, mutate: mutateSub } = useSWR('/api/merchant/subscription', fetcher, {
    revalidateOnFocus: false,
  })
  // 会员套餐
  const { data: plansData, isLoading: plansLoading } = useSWR<{ plans: SubscriptionPlan[] }>(
    '/api/subscriptions/plans',
    fetcher,
    { revalidateOnFocus: false }
  )
  // 积分套餐
  const { data: pkgData, isLoading: pkgLoading } = useSWR<{ packages: CreditPackage[] }>(
    '/api/packages',
    fetcher,
    { revalidateOnFocus: false }
  )

  const plans = plansData?.plans ?? []
  const packages = pkgData?.packages ?? []

  // ─── 统一处理支付参数 ───
  const handlePaymentParams = (pp: PaymentParams, title: string) => {
    if (pp.payUrl) {
      // 支付宝 PC 跳转
      window.location.href = pp.payUrl
      return
    }
    if (pp.qrCode) {
      // 微信 Native 扫码
      setQrModal({ qrCode: pp.qrCode, title })
      return
    }
    setErrorMessage('未获取到支付参数，请重试')
  }

  // ─── 升级会员 ───
  const handleSubscribe = async (plan: SubscriptionPlan) => {
    setSubmittingId(plan.id)
    setErrorMessage(null)
    try {
      const res = await fetch('/api/subscriptions/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: plan.id, payMethod, enableAutoRenewal: false }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data?.error?.message || '创建订阅失败')
      }
      handlePaymentParams(data.paymentParams as PaymentParams, `${plan.name} 支付`)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : '创建订阅失败')
    } finally {
      setSubmittingId(null)
    }
  }

  // ─── 充值积分 ───
  const handleRecharge = async (pkg: CreditPackage) => {
    setSubmittingId(pkg.id)
    setErrorMessage(null)
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId: pkg.id, payMethod }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data?.error?.message || '创建订单失败')
      }
      handlePaymentParams(data.paymentParams as PaymentParams, `${pkg.name} 支付`)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : '创建订单失败')
    } finally {
      setSubmittingId(null)
    }
  }

  const currentTier = sub?.tier as string | undefined

  return (
    <div className="max-w-lg mx-auto px-4 pb-8">
      {/* 顶部导航 */}
      <div className="flex items-center gap-3 py-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/merchant/stores/${storeId}/settings`)}
          className="text-amber-700 hover:bg-amber-100 rounded-xl"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          返回
        </Button>
        <h2 className="text-[var(--text-title)] font-semibold font-[var(--font-serif)] text-[var(--ll-text)]">会员与积分</h2>
      </div>

      {/* 当前状态 — 实体会员卡样式：深绿底 + 金色热压纹理 + 圆角 */}
      <div className="relative overflow-hidden rounded-2xl bg-[var(--ll-house)] p-5">
        {/* 背景纹理 — 微妙对角线条 */}
        <div className="absolute inset-0 opacity-[0.04]" style={{
          backgroundImage: 'repeating-linear-gradient(135deg, transparent, transparent 20px, rgba(255,255,255,.3) 20px, rgba(255,255,255,.3) 21px)'
        }} />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[var(--ll-gold)]/20 flex items-center justify-center">
              <Crown className="h-5 w-5 text-[var(--ll-gold)]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">
                {currentTier ? MEMBER_TIER_LABELS[currentTier] ?? currentTier : '加载中...'}
              </p>
              <p className="text-[11px] text-white/60 mt-0.5">MEMBERSHIP CARD</p>
            </div>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-1 text-sm font-bold text-[var(--ll-gold)] font-[var(--font-num)] tabular-nums">
              <Coins className="h-4 w-4" />
              {sub?.creditBalance ?? 0}
            </div>
            <p className="text-[10px] text-white/50 mt-0.5">积分余额</p>
          </div>
        </div>
      </div>

      {/* 支付方式选择 */}
      <div className="mt-4 flex items-center gap-2">
        <span className="text-sm text-gray-500">支付方式</span>
        <button
          onClick={() => setPayMethod('wechat')}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
            payMethod === 'wechat' ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-600'
          }`}
        >
          微信支付
        </button>
        <button
          onClick={() => setPayMethod('alipay')}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
            payMethod === 'alipay' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600'
          }`}
        >
          支付宝
        </button>
      </div>

      {/* Tab 切换 */}
      <div className="mt-4 flex gap-2">
        <button
          onClick={() => setTab('membership')}
          className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all ${
            tab === 'membership' ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-600'
          }`}
        >
          会员套餐
        </button>
        <button
          onClick={() => setTab('credits')}
          className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all ${
            tab === 'credits' ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-600'
          }`}
        >
          积分充值
        </button>
      </div>

      {/* 错误提示 */}
      {errorMessage && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
          {errorMessage}
        </div>
      )}

      {/* 会员套餐列表 */}
      {tab === 'membership' && (
        <div className="mt-4 space-y-3">
          {plansLoading && <div className="flex justify-center py-6"><Spinner /></div>}
          {!plansLoading && plans.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">暂无可购买的会员套餐</p>
          )}
          {plans.map((plan, idx) => {
            const isCurrent = currentTier === plan.type
            const isRecommended = idx === plans.length - 1 && !isCurrent // 最高级套餐为推荐
            return (
              <Card key={plan.id} className={cn(
                'rounded-2xl relative',
                isRecommended ? 'border-t-[3px] border-t-[var(--ll-gold)] border-[var(--ll-gold)]/30' : 'border-amber-100'
              )}>
                {isRecommended && (
                  <span className="absolute -top-3 right-4 inline-flex items-center gap-1 px-2 py-0.5 bg-[var(--ll-gold)] text-white text-[10px] font-bold rounded-full shadow-sm">
                    推荐
                  </span>
                )}
                <CardContent className="py-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold text-gray-800">{plan.name}</h3>
                        {isCurrent && (
                          <Badge variant="outline" className="text-[10px] border-green-200 text-green-700">
                            当前等级
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        每月 {plan.monthlyCredits} 积分
                        {plan.bonusCredits > 0 && ` + 赠 ${plan.bonusCredits}`}
                      </p>
                      {plan.description && (
                        <p className="text-xs text-gray-400 mt-1">{plan.description}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-semibold font-[var(--font-num)] tabular-nums text-[var(--ll-green)]">¥{(plan.price / 100).toFixed(0)}</p>
                    </div>
                  </div>
                  <Button
                    onClick={() => handleSubscribe(plan)}
                    disabled={submittingId === plan.id || isCurrent}
                    className="w-full mt-3 h-10 rounded-xl bg-amber-500 hover:bg-amber-600 text-white disabled:bg-gray-200 disabled:text-gray-400"
                  >
                    {submittingId === plan.id ? <Spinner size="sm" /> : isCurrent ? '已是当前等级' : '立即升级'}
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* 积分充值列表 */}
      {tab === 'credits' && (
        <div className="mt-4 space-y-3">
          {pkgLoading && <div className="flex justify-center py-6"><Spinner /></div>}
          {!pkgLoading && packages.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">暂无可购买的积分套餐</p>
          )}
          {packages.map((pkg) => (
            <Card key={pkg.id} className="border-amber-100 rounded-2xl">
              <CardContent className="py-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-base font-bold text-gray-800">{pkg.name}</h3>
                    <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                      <Coins className="h-3.5 w-3.5 text-[var(--ll-gold)]" />
                      {pkg.credits} 积分
                    </p>
                    {pkg.description && (
                      <p className="text-xs text-gray-400 mt-1">{pkg.description}</p>
                    )}
                  </div>
                  <p className="text-lg font-semibold font-[var(--font-num)] tabular-nums text-[var(--ll-green)]">¥{(pkg.price / 100).toFixed(0)}</p>
                </div>
                <Button
                  onClick={() => handleRecharge(pkg)}
                  disabled={submittingId === pkg.id}
                  className="w-full mt-3 h-10 rounded-xl bg-amber-500 hover:bg-amber-600 text-white"
                >
                  {submittingId === pkg.id ? <Spinner size="sm" /> : '立即充值'}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 微信扫码支付弹窗 */}
      {qrModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => setQrModal(null)}
        >
          <div
            className="w-full max-w-xs bg-white rounded-2xl shadow-xl p-5 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold text-gray-800">{qrModal.title}</h3>
              <button onClick={() => setQrModal(null)} aria-label="关闭">
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>
            <div className="rounded-xl bg-white p-3 inline-block border border-gray-100">
              {/* 微信 code_url 转二维码图片展示，扫码后由支付回调入账 */}
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrModal.qrCode)}`}
                alt="微信支付二维码"
                className="h-48 w-48"
              />
            </div>
            <p className="text-xs text-gray-500 mt-3">请使用微信扫码完成支付</p>
            <Button
              onClick={() => {
                setQrModal(null)
                // 支付由后端回调入账，关闭后刷新会员状态与余额
                void mutateSub()
              }}
              className="w-full mt-4 h-10 rounded-xl bg-green-500 hover:bg-green-600 text-white"
            >
              <Check className="h-4 w-4 mr-1" />
              我已完成支付
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
