/**
 * GET /api/stores — 获取当前用户所有门店列表
 * POST /api/stores — 新建门店（建店）
 *
 * 鉴权：从 x-user-id header 获取用户 ID
 * GET 返回当前用户名下所有门店（通过 userId → Merchant → Store 关系链查询）
 *
 * 建店计费收敛说明（merchant-billing-unification）：
 * - 已移除本地生活自建额度体系（不再调用 checkMerchantQuota(CREATE_STORE)）。
 * - 建店不扣减任何积分（Req 3.4），门店数量改由统一会员权益
 *   getMerchantPrivileges(userId).maxStores 门控（Req 5.5）。
 * - 名下门店数已达上限 → 403 STORE_LIMIT_EXCEEDED，升级提示包含
 *   当前门店数、上限值、可解除限制的最低等级三要素。
 *
 * 响应：
 * - 200: { stores: Store[] }（GET）
 * - 201: { store: Store }（POST 建店成功）
 * - 400: 请求体校验失败（POST）
 * - 401: 未认证
 * - 403: 无商家身份 / 门店数已达上限（STORE_LIMIT_EXCEEDED）
 * - 500: 服务器内部错误
 *
 * Requirements: 15.1, 16.5, 2.3, 3.4, 5.5
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'
import { getUserIdFromRequest, getMerchantByUserId } from '@/lib/merchant/merchant-auth'
import { getMerchantPrivileges } from '@/lib/shared/privilege-engine'
import { StoreInputSchema } from '@/lib/validations/merchant'
import { MERCHANT_PRIVILEGE_MAPPING } from '@/constants/merchant'
import type { UserTier } from '@/constants/concurrency'
import { ApiError } from '@/lib/shared/api-error'
import { logger } from '@/lib/shared/logger'
/** UserTier 由低到高的等级序，用于推导可解除门店上限的最低等级 */
const TIER_ORDER: readonly UserTier[] = ['FREE', 'MONTHLY', 'YEARLY']
/** UserTier 中文展示名，用于升级提示文案 */
const TIER_LABELS: Record<UserTier, string> = {
  FREE: '免费版',
  MONTHLY: '月卡会员',
  YEARLY: '年卡会员',
}
/**
 * 推导可解除门店数量限制的最低等级：
 * 从低到高遍历 UserTier，返回首个 maxStores 严格大于当前上限的等级标签。
 * 若当前已是门店上限最高的等级，则返回 null（无更高等级可解除限制）。
 *
 * @param currentMaxStores 当前等级的门店上限
 * @returns 可解除限制的最低等级中文名，已是最高则为 null
 */
function findMinUnlockTierLabel(currentMaxStores: number): string | null {
  for (const tier of TIER_ORDER) {
    if (MERCHANT_PRIVILEGE_MAPPING[tier].maxStores > currentMaxStores) {
      return TIER_LABELS[tier]
    }
  }
  return null
}
export async function GET(request: NextRequest) {
  try {
    // 1. 鉴权
    const userId = getUserIdFromRequest(request)
    // 2. 查找商家及其门店
    const merchant = await getMerchantByUserId(userId)
    if (!merchant) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: '无商家身份，请先完成问诊' } },
        { status: 403 }
      )
    }
    // 3. 获取门店列表，包含 profile 和 offers 的基础统计
    const stores = await prisma.store.findMany({
      where: { merchantId: merchant.id },
      include: {
        profile: { select: { id: true, status: true, contentPositioning: true } },
        _count: { select: { offers: true, contentBriefs: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ stores })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    logger.error('[GET /api/stores] 未知错误:', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
export async function POST(request: NextRequest) {
  try {
    // 1. 鉴权
    const userId = getUserIdFromRequest(request)
    // 2. 校验商家身份（建店需已完成问诊）
    const merchant = await getMerchantByUserId(userId)
    if (!merchant) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: '无商家身份，请先完成问诊' } },
        { status: 403 }
      )
    }
    // 3. 解析并校验请求体
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: '请求体格式错误，需要 JSON' } },
        { status: 400 }
      )
    }
    const parseResult = StoreInputSchema.safeParse(body)
    if (!parseResult.success) {
      const fieldErrors = parseResult.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }))
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '验证失败', details: fieldErrors } },
        { status: 400 }
      )
    }
    const data = parseResult.data
    // 4. 门店数量权益门控（不扣减积分，仅按 User_Tier 权益判定）
    const privileges = await getMerchantPrivileges(userId)
    const maxStores = privileges.maxStores
    const currentStores = await prisma.store.count({
      where: { merchantId: merchant.id },
    })
    if (currentStores >= maxStores) {
      // 升级提示三要素：当前门店数、上限值、可解除限制的最低等级
      const minUnlockTierLabel = findMinUnlockTierLabel(maxStores)
      const message =
        minUnlockTierLabel === null
          ? `门店数量已达上限（当前 ${currentStores} 家，上限 ${maxStores} 家），当前已是最高会员等级，暂无更高等级可解除该限制`
          : `门店数量已达上限（当前 ${currentStores} 家，上限 ${maxStores} 家），升级到${minUnlockTierLabel}即可创建更多门店`
      return NextResponse.json(
        {
          error: {
            code: 'STORE_LIMIT_EXCEEDED',
            message,
            currentStores,
            maxStores,
            requiredTier: minUnlockTierLabel,
          },
        },
        { status: 403 }
      )
    }
    // 5. 创建门店
    const store = await prisma.store.create({
      data: {
        merchantId: merchant.id,
        name: data.name,
        industry: data.industry,
        city: data.city ?? null,
        district: data.district ?? null,
        businessArea: data.businessArea ?? null,
        address: data.address ?? null,
        avgTicket: data.avgTicket ?? null,
        openingHours: data.openingHours ?? null,
        mainProducts: data.mainProducts,
        mainSellingPoints: data.mainSellingPoints,
        targetCustomers: data.targetCustomers ?? undefined,
        canShootKitchen: data.canShootKitchen,
        canShootStaff: data.canShootStaff,
        canShootCustomers: data.canShootCustomers,
        hasGroupBuying: data.hasGroupBuying,
        hasReservation: data.hasReservation,
      },
    })
    return NextResponse.json({ store }, { status: 201 })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    logger.error('[POST /api/stores] 未知错误:', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
