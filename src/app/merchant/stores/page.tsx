'use client'

/**
 * 门店列表页 — /merchant/stores
 *
 * 显示当前用户名下的所有门店卡片列表。
 * - useSWR('/api/stores') 获取数据
 * - 每个门店展示：名称、行业图标、画像状态、待办数量
 * - 暖色调、大圆角、shadcn/ui 风格
 * - 点击跳转 /merchant/stores/{storeId}
 *
 * Requirements: 15.1
 */

import useSWR from 'swr'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Store, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'

// ========================
// 数据获取
// ========================

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: '请求失败' } }))
    throw new Error(err.error?.message || '请求失败')
  }
  return res.json()
}

// ========================
// 行业图标映射
// ========================

const INDUSTRY_ICONS: Record<string, string> = {
  RESTAURANT: '🍜',
  DRINK: '🧋',
  BAKERY: '🍞',
  CAFE: '☕',
  HOTPOT: '🫕',
  BBQ: '🍖',
  FAST_FOOD: '🍔',
  OTHER_LOCAL: '🏪',
}

const INDUSTRY_LABELS: Record<string, string> = {
  RESTAURANT: '餐厅',
  DRINK: '饮品店',
  BAKERY: '烘焙店',
  CAFE: '咖啡馆',
  HOTPOT: '火锅店',
  BBQ: '烧烤店',
  FAST_FOOD: '快餐店',
  OTHER_LOCAL: '本地生活',
}

// ========================
// 类型
// ========================

interface StoreItem {
  id: string
  name: string
  industry: string
  status: string
  profile: {
    id: string
    status: string
    contentPositioning: string | null
  } | null
  _count: {
    offers: number
    contentBriefs: number
  }
}

// ========================
// 组件
// ========================

/** 单个门店卡片 */
function StoreCard({ store }: { store: StoreItem }) {
  const icon = INDUSTRY_ICONS[store.industry] || '🏪'
  const label = INDUSTRY_LABELS[store.industry] || '门店'
  const profileReady = store.profile?.status === 'COMPLETE'

  return (
    <Link href={`/merchant/stores/${store.id}`}>
      <Card className="border-amber-100 hover:border-orange-300 hover:shadow-md transition-all cursor-pointer rounded-2xl">
        <CardContent className="flex items-center gap-4 py-4">
          {/* 行业图标 */}
          <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-100 to-amber-100">
            <span className="text-3xl">{icon}</span>
          </div>

          {/* 门店信息 */}
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 truncate">{store.name}</h3>
            <p className="text-sm text-gray-500 mt-0.5">{label}</p>
            <div className="flex items-center gap-2 mt-1.5">
              {/* 画像状态 */}
              {profileReady ? (
                <Badge variant="secondary" className="bg-green-50 text-green-700 border-green-200 text-xs rounded-full">
                  画像就绪
                </Badge>
              ) : (
                <Badge variant="secondary" className="bg-amber-50 text-amber-700 border-amber-200 text-xs rounded-full">
                  待生成画像
                </Badge>
              )}

              {/* 待办数量 */}
              {store._count.contentBriefs > 0 && (
                <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200 text-xs rounded-full">
                  {store._count.contentBriefs} 条任务
                </Badge>
              )}
            </div>
          </div>

          {/* 右箭头 */}
          <div className="flex-shrink-0 text-gray-300">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

// ========================
// 主页面
// ========================

export default function StoresListPage() {
  const { data, error, isLoading } = useSWR('/api/stores', fetcher, {
    revalidateOnFocus: false,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Spinner size="lg" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] space-y-3">
        <Store className="h-12 w-12 text-gray-300" />
        <p className="text-gray-500">{error.message || '加载失败'}</p>
        <Link href="/merchant/onboarding">
          <Button className="bg-orange-600 hover:bg-orange-700 text-white rounded-xl">
            开始问诊
          </Button>
        </Link>
      </div>
    )
  }

  const stores: StoreItem[] = data?.stores || []

  if (stores.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-orange-100">
          <Store className="h-10 w-10 text-orange-500" />
        </div>
        <h2 className="text-lg font-semibold text-gray-800">还没有门店</h2>
        <p className="text-sm text-gray-500 text-center max-w-xs">
          完成商家问诊后，系统将自动为你创建门店并生成营销计划
        </p>
        <Link href="/merchant/onboarding">
          <Button className="bg-orange-600 hover:bg-orange-700 text-white rounded-xl">
            <Plus className="h-4 w-4 mr-1" />
            开始问诊
          </Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto space-y-4">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-amber-900">我的门店</h2>
        <span className="text-sm text-gray-400">{stores.length} 家</span>
      </div>

      {/* 门店卡片列表 */}
      <div className="space-y-3">
        {stores.map((store) => (
          <StoreCard key={store.id} store={store} />
        ))}
      </div>
    </div>
  )
}
