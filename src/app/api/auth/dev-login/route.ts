import { NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'
import { signToken, hashPassword } from '@/lib/shared/auth'

export const dynamic = 'force-dynamic'

/**
 * 开发模式一键登录 Admin 账号
 *
 * 仅在 NODE_ENV === 'development' 时可用。
 * 自动创建（或复用）admin 用户，设置 10000 积分 + ADMIN 角色 + 年卡会员 + 商家门店。
 *
 * 登录信息：admin@dev.local / Admin1234!
 */

const ADMIN_EMAIL = 'admin@dev.local'
const ADMIN_PASSWORD = 'Admin1234!'

export async function POST() {
  // 仅开发模式可用
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: '此接口仅在开发环境可用' }, { status: 404 })
  }

  try {
    // ─── 1. 创建或获取 admin 用户 ───
    let user = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } })

    if (!user) {
      const passwordHash = await hashPassword(ADMIN_PASSWORD)
      user = await prisma.user.create({
        data: {
          email: ADMIN_EMAIL,
          passwordHash,
          nickname: 'Admin',
          creditBalance: 10000,
          role: 'ADMIN',
        },
      })
    } else {
      // 确保积分和角色正确
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          creditBalance: 10000,
          role: 'ADMIN',
        },
      })
    }

    // ─── 2. 确保年卡会员套餐存在 ───
    let plan = await prisma.subscriptionPlan.findFirst({
      where: { type: 'yearly', isActive: true },
    })

    if (!plan) {
      plan = await prisma.subscriptionPlan.create({
        data: {
          name: '年卡会员',
          type: 'yearly',
          price: 24900, // 249元
          monthlyCredits: 500,
          bonusCredits: 1000,
          description: '年卡会员，每月500积分 + 赠送1000积分',
          privileges: JSON.stringify([
            '每月 500 积分',
            '年卡赠送 1000 积分',
            '最多 3 个并发项目',
            '优先队列',
          ]),
        },
      })
    }

    // ─── 3. 确保 admin 有活跃订阅记录 ───
    const existingSub = await prisma.subscriptionRecord.findFirst({
      where: { userId: user.id, status: 'ACTIVE' },
    })

    if (!existingSub) {
      const now = new Date()
      const endDate = new Date(now)
      endDate.setFullYear(endDate.getFullYear() + 1)

      await prisma.subscriptionRecord.create({
        data: {
          userId: user.id,
          planId: plan.id,
          status: 'ACTIVE',
          renewalType: 'MANUAL',
          payMethod: 'alipay',
          startDate: now,
          endDate,
          totalCreditsGranted: plan.monthlyCredits + plan.bonusCredits,
        },
      })
    }

    // ─── 4. 确保有商家 + 门店 ───
    let merchant = await prisma.merchant.findFirst({ where: { userId: user.id } })

    if (!merchant) {
      merchant = await prisma.merchant.create({
        data: {
          userId: user.id,
          name: 'Admin 测试门店',
          contactName: 'Admin',
          phone: '13800000000',
          industry: 'RESTAURANT',
        },
      })
    }

    const existingStore = await prisma.store.findFirst({ where: { merchantId: merchant.id } })

    if (!existingStore) {
      await prisma.store.create({
        data: {
          merchantId: merchant.id,
          name: 'Admin 测试餐厅',
          industry: 'RESTAURANT',
          city: '上海',
          district: '静安区',
          address: '南京西路1000号',
          phone: '13800000000',
          mainProducts: ['招牌牛肉面', '特色小笼包', '手工水饺'],
          mainSellingPoints: ['30年老字号', '手工现做', '食材新鲜'],
          targetCustomers: ['白领午餐', '家庭聚餐'],
          brandTone: '传统中式，温馨家常',
          canShootKitchen: true,
          canShootStaff: true,
          canShootCustomers: true,
          hasGroupBuying: true,
          hasReservation: true,
          status: 'ACTIVE',
        },
      })
    }

    // ─── 5. 签发 JWT + 设置 Cookie ───
    const token = signToken({ userId: user.id, role: user.role })

    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        nickname: user.nickname,
        creditBalance: user.creditBalance,
        role: user.role,
      },
    })

    response.cookies.set('token', token, {
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 7 天
    })

    return response
  } catch (error) {
    console.error('[dev-login] 失败:', error)
    return NextResponse.json(
      { error: 'Dev 登录失败: ' + (error instanceof Error ? error.message : String(error)) },
      { status: 500 },
    )
  }
}
