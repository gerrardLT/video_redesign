/**
 * POST /api/merchant/onboarding — 商家问诊 API
 *
 * 接收商家问诊表单，在单个数据库事务中创建 Merchant、Store、ProductOffer 记录，
 * 事务提交后异步入队门店画像生成任务。画像生成成功后由 Worker 自动触发内容计划生成（事件驱动串行）。
 *
 * 鉴权：从 x-user-id header 获取用户 ID（由 middleware 注入）
 *
 * 响应：
 * - 201: 问诊完成，{ merchantId, storeId, message }
 * - 400: 验证失败，返回具体字段错误
 * - 401: 未认证
 * - 409: 已完成问诊（同一用户不可重复提交）
 * - 500: 服务器内部错误
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { MerchantOnboardingSchema } from '@/lib/validations/merchant'
import { generateStoreProfileQueue } from '@/lib/queue'

export async function POST(request: NextRequest) {
  // 1. 鉴权：从 middleware 注入的 x-user-id header 获取 userId
  const userId = request.headers.get('x-user-id')
  if (!userId) {
    return NextResponse.json({ error: '未认证' }, { status: 401 })
  }

  // 2. 检查该 userId 是否已有 Merchant 记录（Requirement 1.6）
  const existingMerchant = await prisma.merchant.findUnique({
    where: { userId },
  })
  if (existingMerchant) {
    return NextResponse.json(
      { error: '已完成问诊，不可重复提交' },
      { status: 409 }
    )
  }

  // 3. 解析并验证请求体（Requirement 1.2, 1.3, 1.5）
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: '请求体格式错误，需要 JSON' },
      { status: 400 }
    )
  }

  const parseResult = MerchantOnboardingSchema.safeParse(body)
  if (!parseResult.success) {
    // 返回具体字段错误（Requirement 1.5）
    const fieldErrors = parseResult.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }))
    return NextResponse.json(
      { error: '验证失败', details: fieldErrors },
      { status: 400 }
    )
  }

  const data = parseResult.data

  // 4. 在 Prisma $transaction 中创建 Merchant → Store → ProductOffer[]（Requirement 1.1）
  let merchantId: string
  let storeId: string

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 创建 Merchant，industry 取自 store.industry
      const merchant = await tx.merchant.create({
        data: {
          userId,
          name: data.merchantName,
          contactName: data.contactName ?? null,
          phone: data.phone ?? null,
          industry: data.store.industry,
        },
      })

      // 创建 Store
      const store = await tx.store.create({
        data: {
          merchantId: merchant.id,
          name: data.store.name,
          industry: data.store.industry,
          city: data.store.city ?? null,
          district: data.store.district ?? null,
          businessArea: data.store.businessArea ?? null,
          address: data.store.address ?? null,
          avgTicket: data.store.avgTicket ?? null,
          openingHours: data.store.openingHours ?? null,
          mainProducts: data.store.mainProducts,
          mainSellingPoints: data.store.mainSellingPoints,
          targetCustomers: data.store.targetCustomers ?? undefined,
          canShootKitchen: data.store.canShootKitchen,
          canShootStaff: data.store.canShootStaff,
          canShootCustomers: data.store.canShootCustomers,
          hasGroupBuying: data.store.hasGroupBuying,
          hasReservation: data.store.hasReservation,
        },
      })

      // 创建 ProductOffer[]（如果有优惠活动）
      if (data.offers && data.offers.length > 0) {
        await tx.productOffer.createMany({
          data: data.offers.map((offer) => ({
            storeId: store.id,
            name: offer.name,
            description: offer.description ?? null,
            originalPrice: offer.originalPrice ?? null,
            salePrice: offer.salePrice ?? null,
            sellingPoints: offer.sellingPoints ?? undefined,
            usageRules: offer.usageRules ?? null,
          })),
        })
      }

      return { merchantId: merchant.id, storeId: store.id }
    })

    merchantId = result.merchantId
    storeId = result.storeId
  } catch (error) {
    console.error('[onboarding] 事务执行失败:', error)
    throw error
  }

  // 5. 事务提交后，通过 BullMQ 入队画像生成任务（Requirement 1.4）
  // 画像生成成功后由 Worker 自动触发内容计划生成（事件驱动串行）
  await generateStoreProfileQueue.add('generate-store-profile', {
    storeId,
    merchantId,
  })

  // 6. 返回 201 + { merchantId, storeId, message }
  return NextResponse.json(
    {
      merchantId,
      storeId,
      message: '问诊完成，正在生成门店画像和内容计划',
    },
    { status: 201 }
  )
}
