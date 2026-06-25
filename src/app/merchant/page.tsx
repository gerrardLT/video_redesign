/**
 * 商家首页 — /merchant
 *
 * 根据用户门店情况进行重定向：
 * - 有门店：重定向到第一个门店的首页 /merchant/stores/{storeId}
 * - 无门店：重定向到 /merchant/onboarding
 *
 * 使用 Server Component 执行服务端重定向。
 *
 * Requirements: 15.1
 */

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { prisma } from '@/lib/db'

export default async function MerchantHomePage() {
  // 从 headers 获取 userId（由 middleware 注入）
  const headersList = await headers()
  const userId = headersList.get('x-user-id')

  // 未登录 → 登录页
  if (!userId) {
    redirect('/login')
  }

  // 查询用户关联的商家及门店
  const merchant = await prisma.merchant.findUnique({
    where: { userId },
    include: {
      stores: {
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { id: true },
      },
    },
  })

  // 无商家或无门店 → 问诊页
  if (!merchant || merchant.stores.length === 0) {
    redirect('/merchant/onboarding')
  }

  // 有门店 → 第一个门店首页
  redirect(`/merchant/stores/${merchant.stores[0].id}`)
}
