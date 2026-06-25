/**
 * 商家状态管理 — Zustand Store
 *
 * 管理当前登录商家的本地状态：
 * - currentStoreId: 当前选中的门店 ID
 * - merchant: 商家基本信息
 * - stores: 商家拥有的所有门店列表
 *
 * 使用 Zustand 5 的 create 函数，不使用 devtools。
 *
 * Requirements: 15.1, 15.4
 */

import { create } from 'zustand'

/** 商家基本信息（与 Prisma Merchant 模型对应） */
export interface Merchant {
  id: string
  userId: string
  name: string
  contactName?: string | null
  phone?: string | null
  industry: string
  createdAt: string
  updatedAt: string
}

/** 门店基本信息（与 Prisma Store 模型对应） */
export interface Store {
  id: string
  merchantId: string
  name: string
  industry: string
  city?: string | null
  district?: string | null
  businessArea?: string | null
  address?: string | null
  avgTicket?: number | null
  openingHours?: string | null
  mainProducts: string[]
  mainSellingPoints: string[]
  targetCustomers?: string[] | null
  canShootKitchen: boolean
  canShootStaff: boolean
  canShootCustomers: boolean
  hasGroupBuying: boolean
  hasReservation: boolean
  status: string
  createdAt: string
  updatedAt: string
}

/** 商家状态接口 */
export interface MerchantState {
  /** 当前选中的门店 ID */
  currentStoreId: string | null
  /** 商家基本信息 */
  merchant: Merchant | null
  /** 商家拥有的所有门店 */
  stores: Store[]
  /** 设置当前门店 */
  setCurrentStore: (id: string) => void
  /** 设置商家信息 */
  setMerchant: (m: Merchant) => void
  /** 设置门店列表 */
  setStores: (s: Store[]) => void
  /** 重置状态 */
  reset: () => void
}

const initialState = {
  currentStoreId: null as string | null,
  merchant: null as Merchant | null,
  stores: [] as Store[],
}

export const useMerchantStore = create<MerchantState>((set) => ({
  ...initialState,

  setCurrentStore: (id: string) => set({ currentStoreId: id }),

  setMerchant: (m: Merchant) => set({ merchant: m }),

  setStores: (s: Store[]) => set({ stores: s }),

  reset: () => set(initialState),
}))
