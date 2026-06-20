/**
 * 订阅会员状态管理 — Zustand Store
 *
 * 管理订阅相关的全部前端状态：套餐列表、当前订阅、支付历史、用户特权。
 * 各 action 调用对应 API 路由，处理 loading 和错误状态。
 *
 * API 端点：
 * - GET  /api/subscriptions/plans   → 套餐列表
 * - GET  /api/subscriptions/status  → 当前订阅 + 特权
 * - GET  /api/subscriptions/history → 支付历史（分页）
 * - POST /api/subscriptions/create  → 创建订阅
 * - POST /api/subscriptions/cancel  → 取消订阅
 * - POST /api/subscriptions/renew   → 手动续费
 *
 * Requirements: 1.2, 10.1, 10.2, 10.3, 10.4, 10.5
 */

import { create } from 'zustand'

// ========================
// 类型定义
// ========================

/** 订阅套餐（与 GET /api/subscriptions/plans 返回格式对齐） */
export interface SubscriptionPlan {
  id: string
  name: string
  type: 'monthly' | 'quarterly' | 'yearly'
  price: number
  monthlyCredits: number
  bonusCredits: number
  description: string | null
  privileges: string
  sortOrder: number
}

/** 订阅记录（与 GET /api/subscriptions/status 返回格式对齐） */
export interface SubscriptionRecord {
  id: string
  userId: string
  planId: string
  status: 'ACTIVE' | 'CANCELED' | 'EXPIRED'
  renewalType: 'AUTO' | 'MANUAL' | 'CANCELED'
  contractId: string | null
  payMethod: string
  startDate: string
  endDate: string
  lastRenewalDate: string | null
  totalCreditsGranted: number
  createdAt: string
  updatedAt: string
  plan: {
    id: string
    name: string
    type: string
    price: number
    monthlyCredits: number
    bonusCredits: number
  }
}

/** 用户特权配置 */
export interface UserPrivileges {
  queuePriority: number
  allowedResolutions: string[]
  watermarkEnabled: boolean
  historyRetentionDays: number
  isActiveMember: boolean
}

/** 订阅订单（支付历史条目） */
export interface SubscriptionOrderItem {
  id: string
  type: 'FIRST_SUBSCRIBE' | 'RENEWAL' | 'MANUAL_RENEWAL'
  amount: number
  credits: number
  status: 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED'
  payMethod: string
  paidAt: string | null
  createdAt: string
  plan: { name: string; type: string }
}

/** 支付结果 */
export interface PaymentResult {
  paymentId: string
  payUrl?: string
  qrCode?: string
  expiresAt: string
}

// ========================
// Store 接口
// ========================

interface SubscriptionState {
  /** 当前订阅记录 */
  currentSubscription: SubscriptionRecord | null
  /** 套餐列表 */
  plans: SubscriptionPlan[]
  /** 支付历史 */
  paymentHistory: SubscriptionOrderItem[]
  /** 支付历史分页信息 */
  historyPagination: { total: number; page: number; pageSize: number; totalPages: number } | null
  /** 用户特权 */
  privileges: UserPrivileges | null
  /** 加载状态 */
  loading: boolean
  /** 错误信息 */
  error: string | null

  /** 获取套餐列表 */
  fetchPlans: () => Promise<void>
  /** 获取当前订阅状态与特权 */
  fetchCurrentSubscription: () => Promise<void>
  /** 获取用户特权（同 fetchCurrentSubscription，单独调用） */
  fetchPrivileges: () => Promise<void>
  /** 创建订阅 */
  createSubscription: (planId: string, payMethod: 'wechat' | 'alipay', enableAutoRenewal: boolean) => Promise<PaymentResult>
  /** 取消订阅 */
  cancelSubscription: () => Promise<void>
  /** 手动续费 */
  manualRenew: (payMethod: 'wechat' | 'alipay') => Promise<PaymentResult>
  /** 获取支付历史 */
  fetchPaymentHistory: (page?: number, pageSize?: number) => Promise<void>
}

// ========================
// Store 实现
// ========================

export const useSubscriptionStore = create<SubscriptionState>((set, get) => ({
  currentSubscription: null,
  plans: [],
  paymentHistory: [],
  historyPagination: null,
  privileges: null,
  loading: false,
  error: null,

  fetchPlans: async () => {
    set({ loading: true, error: null })
    try {
      const res = await fetch('/api/subscriptions/plans')
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `获取套餐列表失败 (${res.status})`)
      }
      const data: { plans: SubscriptionPlan[] } = await res.json()
      set({ plans: data.plans, loading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : '获取套餐列表失败'
      set({ error: message, loading: false })
    }
  },

  fetchCurrentSubscription: async () => {
    set({ loading: true, error: null })
    try {
      const res = await fetch('/api/subscriptions/status')
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `获取订阅状态失败 (${res.status})`)
      }
      const data: { subscription: SubscriptionRecord | null; privileges: UserPrivileges } = await res.json()
      set({
        currentSubscription: data.subscription,
        privileges: data.privileges,
        loading: false,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : '获取订阅状态失败'
      set({ error: message, loading: false })
    }
  },

  fetchPrivileges: async () => {
    set({ loading: true, error: null })
    try {
      const res = await fetch('/api/subscriptions/status')
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `获取特权信息失败 (${res.status})`)
      }
      const data: { subscription: SubscriptionRecord | null; privileges: UserPrivileges } = await res.json()
      set({
        currentSubscription: data.subscription,
        privileges: data.privileges,
        loading: false,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : '获取特权信息失败'
      set({ error: message, loading: false })
    }
  },

  createSubscription: async (planId, payMethod, enableAutoRenewal) => {
    set({ loading: true, error: null })
    try {
      const res = await fetch('/api/subscriptions/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, payMethod, enableAutoRenewal }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `创建订阅失败 (${res.status})`)
      }
      const data: { order: unknown; paymentParams: PaymentResult } = await res.json()
      set({ loading: false })
      return data.paymentParams
    } catch (err) {
      const message = err instanceof Error ? err.message : '创建订阅失败'
      set({ error: message, loading: false })
      throw err
    }
  },

  cancelSubscription: async () => {
    const { currentSubscription } = get()
    if (!currentSubscription) {
      throw new Error('无活跃订阅')
    }

    set({ loading: true, error: null })
    try {
      const res = await fetch('/api/subscriptions/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId: currentSubscription.id }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `取消订阅失败 (${res.status})`)
      }

      // 更新本地状态：renewalType → CANCELED
      set({
        currentSubscription: {
          ...currentSubscription,
          renewalType: 'CANCELED',
        },
        loading: false,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : '取消订阅失败'
      set({ error: message, loading: false })
      throw err
    }
  },

  manualRenew: async (payMethod) => {
    const { currentSubscription } = get()
    if (!currentSubscription) {
      throw new Error('无订阅记录')
    }

    set({ loading: true, error: null })
    try {
      const res = await fetch('/api/subscriptions/renew', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId: currentSubscription.id, payMethod }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `手动续费失败 (${res.status})`)
      }
      const data: { order: unknown; paymentParams: PaymentResult } = await res.json()
      set({ loading: false })
      return data.paymentParams
    } catch (err) {
      const message = err instanceof Error ? err.message : '手动续费失败'
      set({ error: message, loading: false })
      throw err
    }
  },

  fetchPaymentHistory: async (page = 1, pageSize = 10) => {
    set({ loading: true, error: null })
    try {
      const res = await fetch(`/api/subscriptions/history?page=${page}&pageSize=${pageSize}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `获取支付历史失败 (${res.status})`)
      }
      const data: {
        items: SubscriptionOrderItem[]
        total: number
        page: number
        pageSize: number
        totalPages: number
      } = await res.json()
      set({
        paymentHistory: data.items,
        historyPagination: {
          total: data.total,
          page: data.page,
          pageSize: data.pageSize,
          totalPages: data.totalPages,
        },
        loading: false,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : '获取支付历史失败'
      set({ error: message, loading: false })
    }
  },
}))
