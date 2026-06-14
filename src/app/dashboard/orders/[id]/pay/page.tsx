'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'

interface OrderDetail {
  id: string
  amount: number
  credits: number
  status: string
  payMethod: string
  expireAt: string
  createdAt: string
  package: {
    id: string
    name: string
  }
}

/** 计算剩余秒数 */
function getRemainingSecs(expireAt: string): number {
  const diff = new Date(expireAt).getTime() - Date.now()
  return Math.max(0, Math.floor(diff / 1000))
}

/** 格式化为 MM:SS */
function formatCountdown(totalSecs: number): string {
  const mins = Math.floor(totalSecs / 60)
  const secs = totalSecs % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

/** 金额格式化（分 → 元) */
function formatPrice(amountInCents: number): string {
  return `¥${(amountInCents / 100).toFixed(2)}`
}

export default function PaymentWaitPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const orderId = params.id as string

  // 从 URL search params 获取支付参数
  const qrCode = searchParams.get('qrCode') || ''
  const payUrl = searchParams.get('payUrl') || ''

  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [remainingSecs, setRemainingSecs] = useState(0)
  const [expired, setExpired] = useState(false)

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // 获取订单详情
  const fetchOrder = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/${orderId}`)
      if (!res.ok) {
        throw new Error('获取订单信息失败')
      }
      const data = await res.json()
      return data.order as OrderDetail
    } catch {
      return null
    }
  }, [orderId])

  // 初始化：获取订单信息
  useEffect(() => {
    async function init() {
      const orderData = await fetchOrder()
      if (!orderData) {
        setError('订单不存在或无权访问')
        setLoading(false)
        return
      }
      setOrder(orderData)
      setLoading(false)

      // 初始化倒计时
      const secs = getRemainingSecs(orderData.expireAt)
      setRemainingSecs(secs)
      if (secs <= 0) {
        setExpired(true)
      }
    }
    init()
  }, [fetchOrder])

  // 倒计时
  useEffect(() => {
    if (!order || expired) return

    countdownRef.current = setInterval(() => {
      setRemainingSecs((prev) => {
        if (prev <= 1) {
          setExpired(true)
          if (countdownRef.current) clearInterval(countdownRef.current)
          if (pollingRef.current) clearInterval(pollingRef.current)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [order, expired])

  // 轮询订单状态（每 3 秒)
  useEffect(() => {
    if (!order || expired) return

    pollingRef.current = setInterval(async () => {
      const latestOrder = await fetchOrder()
      if (!latestOrder) return

      if (latestOrder.status === 'PAID') {
        // 支付成功，跳转到订单列表
        if (pollingRef.current) clearInterval(pollingRef.current)
        if (countdownRef.current) clearInterval(countdownRef.current)
        router.push('/dashboard/orders')
        return
      }

      if (latestOrder.status === 'EXPIRED') {
        // 订单过期
        if (pollingRef.current) clearInterval(pollingRef.current)
        if (countdownRef.current) clearInterval(countdownRef.current)
        setExpired(true)
        setOrder(latestOrder)
        return
      }
    }, 3000)

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [order, expired, fetchOrder, router])

  // 清理所有定时器
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [])

  // 加载状态
  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--cine-gold)] border-t-transparent" />
      </div>
    )
  }

  // 错误状态
  if (error) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-[var(--cine-text-2)]">{error}</p>
        <button
          onClick={() => router.push('/dashboard/orders')}
          className="rounded-lg bg-[var(--cine-gold)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--cine-gold-2)]"
        >
          返回订单列表
        </button>
      </div>
    )
  }

  if (!order) return null

  // 倒计时颜色：>5min 白色，<=5min 黄色
  const countdownColor = remainingSecs > 300 ? 'text-white' : 'text-yellow-400'

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-md rounded-xl border border-[var(--cine-line)] bg-[var(--cine-surface)] p-6">
        {/* 标题 */}
        <h2 className="mb-6 text-center text-xl font-bold text-white">
          等待支付
        </h2>

        {/* 订单信息 */}
        <div className="mb-6 space-y-3 rounded-lg bg-[var(--cine-surface)] p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--cine-text-2)]">套餐</span>
            <span className="text-sm font-medium text-white">{order.package.name}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--cine-text-2)]">积分</span>
            <span className="text-sm font-medium text-white">{order.credits} 积分</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--cine-text-2)]">金额</span>
            <span className="text-sm font-medium text-[var(--cine-gold)]">
              {formatPrice(order.amount)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--cine-text-2)]">支付方式</span>
            <span className="text-sm font-medium text-white">
              {order.payMethod === 'wechat' ? '微信支付' : '支付宝'}
            </span>
          </div>
        </div>

        {/* 超时状态 */}
        {expired ? (
          <div className="text-center">
            <div className="mb-4 flex items-center justify-center gap-2">
              <svg className="h-5 w-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-red-400 font-medium">订单已超时</span>
            </div>
            <p className="mb-6 text-sm text-[var(--cine-text-3)]">
              支付时间已超过30分钟，请重新下单
            </p>
            <button
              onClick={() => router.push('/dashboard/packages')}
              className="w-full rounded-lg bg-[var(--cine-gold)] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--cine-gold-2)]"
            >
              重新下单
            </button>
          </div>
        ) : (
          <>
            {/* 倒计时 */}
            <div className="mb-6 text-center">
              <p className="mb-1 text-xs text-[var(--cine-text-3)]">支付剩余时间</p>
              <p className={`text-3xl font-mono font-bold ${countdownColor}`}>
                {formatCountdown(remainingSecs)}
              </p>
            </div>

            {/* 支付信息展示 */}
            <div className="mb-6">
              {order.payMethod === 'wechat' ? (
                // 微信支付：展示二维码
                <div className="flex flex-col items-center gap-3">
                  <div className="rounded-lg bg-white p-3">
                    {qrCode ? (
                      <img
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrCode)}`}
                        alt="微信支付二维码"
                        className="h-48 w-48"
                        width={192}
                        height={192}
                      />
                    ) : (
                      <div className="flex h-48 w-48 items-center justify-center text-sm text-gray-400">
                        二维码加载失败
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-[var(--cine-text-3)]">
                    请使用微信扫一扫完成支付
                  </p>
                </div>
              ) : (
                // 支付宝：展示跳转按钮
                <div className="flex flex-col items-center gap-3">
                  <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[#1677ff]/10">
                    <svg className="h-12 w-12 text-[#1677ff]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                    </svg>
                  </div>
                  {payUrl ? (
                    <a
                      href={payUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full rounded-lg bg-[#1677ff] px-4 py-2.5 text-center text-sm font-medium text-white transition-colors hover:bg-[#4096ff]"
                    >
                      前往支付宝支付
                    </a>
                  ) : (
                    <p className="text-sm text-[var(--cine-text-3)]">支付链接加载失败</p>
                  )}
                  <p className="text-xs text-[var(--cine-text-3)]">
                    点击按钮将跳转至支付宝完成支付
                  </p>
                </div>
              )}
            </div>

            {/* 底部提示 */}
            <div className="border-t border-[var(--cine-line)] pt-4">
              <p className="text-center text-xs text-[var(--cine-text-3)]">
                支付完成后页面将自动跳转，请勿关闭此页面
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
