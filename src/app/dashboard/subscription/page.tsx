'use client'

/**
 * 会员管理 Dashboard 页面
 *
 * 展示用户当前订阅状态：套餐名称、状态 Badge、到期日期、
 * 当月积分、累计积分、特权列表、操作按钮（取消/续费）。
 * 无有效订阅时展示套餐推荐与开通入口。
 * 底部集成支付历史列表组件。
 *
 * Requirements: 1.4, 4.1, 10.1, 10.2, 10.3, 10.4, 10.6
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useSubscriptionStore } from '@/stores/subscription-store'
import { PaymentHistory } from '@/components/subscription/payment-history'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

/** 状态 Badge 样式映射 */
const STATUS_STYLES: Record<string, { text: string; className: string }> = {
  ACTIVE: { text: '生效中', className: 'bg-green-500/20 text-green-400' },
  CANCELED: { text: '已取消续费', className: 'bg-yellow-500/20 text-yellow-400' },
  EXPIRED: { text: '已过期', className: 'bg-red-500/20 text-red-400' },
}

/** 格式化日期 */
function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/** 判断是否在到期前 7 天内 */
function isWithin7Days(endDateStr: string): boolean {
  const endDate = new Date(endDateStr)
  const now = new Date()
  const diff = endDate.getTime() - now.getTime()
  return diff > 0 && diff <= 7 * 24 * 60 * 60 * 1000
}

export default function SubscriptionDashboardPage() {
  const {
    currentSubscription,
    privileges,
    loading,
    error,
    fetchCurrentSubscription,
    cancelSubscription,
    manualRenew,
  } = useSubscriptionStore()

  const [canceling, setCanceling] = useState(false)
  const [renewing, setRenewing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [showRenewOptions, setShowRenewOptions] = useState(false)
  const [showCancelDialog, setShowCancelDialog] = useState(false)

  useEffect(() => {
    fetchCurrentSubscription()
  }, [fetchCurrentSubscription])

  /** 取消订阅操作 */
  function handleCancel() {
    setShowCancelDialog(true)
  }

  /** 确认取消订阅 */
  async function confirmCancel() {
    setShowCancelDialog(false)
    setCanceling(true)
    setActionError(null)
    try {
      await cancelSubscription()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '取消失败')
    } finally {
      setCanceling(false)
    }
  }

  /** 手动续费操作 */
  async function handleManualRenew(payMethod: 'wechat' | 'alipay') {
    setRenewing(true)
    setActionError(null)
    try {
      const paymentResult = await manualRenew(payMethod)
      if (paymentResult.payUrl) {
        window.location.href = paymentResult.payUrl
      } else if (paymentResult.qrCode) {
        window.open(paymentResult.qrCode, '_blank')
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '续费失败')
    } finally {
      setRenewing(false)
      setShowRenewOptions(false)
    }
  }

  // 加载状态
  if (loading && !currentSubscription) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="h-64 animate-pulse rounded-xl bg-[var(--cine-surface)]" />
      </div>
    )
  }

  // 无有效订阅：展示推荐
  if (!currentSubscription) {
    return (
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-6 text-2xl font-bold text-[var(--cine-text)]">会员管理</h1>

        <Card className="border-[var(--cine-line)] bg-[var(--cine-surface)]">
          <CardContent className="flex flex-col items-center py-12">
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
                d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
              />
            </svg>
            <h2 className="mb-2 text-lg font-medium text-[var(--cine-text)]">
              还没有开通会员
            </h2>
            <p className="mb-6 max-w-md text-center text-sm text-[var(--cine-text-3)]">
              开通会员即享优先生成队列、1080p 高清输出、去水印、30天版本历史等专属权益，每月还有积分到账
            </p>
            <Link href="/dashboard/subscription/plans">
              <Button className="bg-[var(--cine-gold)] px-6 text-[var(--cine-ink)] hover:bg-[var(--cine-gold-2)]">
                查看套餐
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* 即使无订阅也展示支付历史（可能有过期订阅的记录） */}
        <div className="mt-8">
          <PaymentHistory />
        </div>
      </div>
    )
  }

  // 有订阅：展示管理面板
  const statusInfo = STATUS_STYLES[currentSubscription.status] || STATUS_STYLES.EXPIRED
  const showCancelButton =
    currentSubscription.status === 'ACTIVE' && currentSubscription.renewalType === 'AUTO'
  const showRenewButton =
    isWithin7Days(currentSubscription.endDate) && currentSubscription.renewalType !== 'AUTO'

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-6 text-2xl font-bold text-[var(--cine-text)]">会员管理</h1>

      {/* 错误提示 */}
      {(error || actionError) && (
        <div className="mb-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
          {actionError || error}
        </div>
      )}

      {/* 订阅状态卡片 */}
      <Card className="border-[var(--cine-line)] bg-[var(--cine-surface)]">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg text-[var(--cine-text)]">
              {currentSubscription.plan.name}
            </CardTitle>
            <Badge className={statusInfo.className}>{statusInfo.text}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 订阅信息 */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-[var(--cine-text-3)]">到期日期</p>
              <p className="mt-1 text-sm font-medium text-[var(--cine-text)]">
                {formatDate(currentSubscription.endDate)}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--cine-text-3)]">续费方式</p>
              <p className="mt-1 text-sm font-medium text-[var(--cine-text)]">
                {currentSubscription.renewalType === 'AUTO'
                  ? '自动续费'
                  : currentSubscription.renewalType === 'CANCELED'
                    ? '已关闭自动续费'
                    : '手动续费'}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--cine-text-3)]">每月积分</p>
              <p className="mt-1 text-sm font-medium text-[var(--cine-gold)]">
                {currentSubscription.plan.monthlyCredits}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--cine-text-3)]">累计已发放</p>
              <p className="mt-1 text-sm font-medium text-[var(--cine-text)]">
                {currentSubscription.totalCreditsGranted} 积分
              </p>
            </div>
          </div>

          {/* 特权列表 */}
          {privileges && (
            <div>
              <p className="mb-2 text-xs text-[var(--cine-text-3)]">当前会员特权</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <PrivilegeItem
                  icon="⚡"
                  label="优先生成队列"
                  active={privileges.queuePriority === 1}
                />
                <PrivilegeItem
                  icon="🎬"
                  label="1080p 高清输出"
                  active={privileges.allowedResolutions.includes('1080p')}
                />
                <PrivilegeItem
                  icon="✨"
                  label="去水印"
                  active={!privileges.watermarkEnabled}
                />
                <PrivilegeItem
                  icon="📂"
                  label={`${privileges.historyRetentionDays}天版本历史`}
                  active={privileges.historyRetentionDays >= 30}
                />
              </div>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex flex-wrap gap-3 border-t border-[var(--cine-line)] pt-4">
            {showCancelButton && (
              <Button
                variant="outline"
                onClick={handleCancel}
                disabled={canceling}
                className="border-[var(--cine-line)] text-[var(--cine-text-2)] hover:border-red-500/50 hover:text-red-400"
              >
                {canceling ? '处理中...' : '取消自动续费'}
              </Button>
            )}

            {showRenewButton && !showRenewOptions && (
              <Button
                onClick={() => setShowRenewOptions(true)}
                className="bg-[var(--cine-gold)] text-[var(--cine-ink)] hover:bg-[var(--cine-gold-2)]"
              >
                立即续费
              </Button>
            )}

            {showRenewOptions && (
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => handleManualRenew('wechat')}
                  disabled={renewing}
                  className="bg-green-600 text-white hover:bg-green-700"
                  size="sm"
                >
                  微信支付
                </Button>
                <Button
                  onClick={() => handleManualRenew('alipay')}
                  disabled={renewing}
                  className="bg-blue-600 text-white hover:bg-blue-700"
                  size="sm"
                >
                  支付宝
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setShowRenewOptions(false)}
                  size="sm"
                  className="text-[var(--cine-text-3)]"
                >
                  取消
                </Button>
              </div>
            )}

            <Link href="/dashboard/subscription/plans" className="ml-auto">
              <Button variant="ghost" className="text-[var(--cine-text-3)] hover:text-[var(--cine-text-2)]">
                查看套餐
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* 支付历史 */}
      <div className="mt-8">
        <PaymentHistory />
      </div>

      {/* 取消自动续费确认对话框 */}
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>取消自动续费</AlertDialogTitle>
            <AlertDialogDescription>
              确定取消自动续费？取消后当前周期内权益仍然有效。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowCancelDialog(false)}>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmCancel}>
              确认取消
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ========================
// 特权展示子组件
// ========================

function PrivilegeItem({
  icon,
  label,
  active,
}: {
  icon: string
  label: string
  active: boolean
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg px-3 py-2 ${
        active
          ? 'bg-[var(--cine-gold-dim)] text-[var(--cine-text)]'
          : 'bg-[var(--cine-bg)] text-[var(--cine-text-3)]'
      }`}
    >
      <span className="text-base">{icon}</span>
      <span className="text-sm">{label}</span>
      {active && (
        <svg
          className="ml-auto h-4 w-4 text-[var(--cine-gold)]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      )}
    </div>
  )
}
