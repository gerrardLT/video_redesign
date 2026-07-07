/**
 * 订单服务
 * 提供订单创建、支付回调处理、订单查询、订单过期等操作
 */
import { z } from 'zod/v4'
import { prisma } from './db'
import { ApiError } from './api-error'
import { logger } from './logger'
import { getPaymentGateway } from '@/services/payment'
import type { PaymentCallbackData, PaymentChannel } from '@/services/payment/types'
import { orderExpireQueue } from './queue'
import * as CreditService from './credit-service'
import * as NotificationService from './notification-service'

// ========================
// Zod 校验 Schema
// ========================

const CreateOrderSchema = z.object({
  userId: z.string().min(1, '用户ID不能为空'),
  packageId: z.string().min(1, '套餐ID不能为空'),
  payMethod: z.enum(['wechat', 'alipay'], { message: '支付方式仅支持 wechat 或 alipay' }),
})

const GetUserOrdersSchema = z.object({
  userId: z.string().min(1, '用户ID不能为空'),
  page: z.number().int().min(1, '页码最小为1'),
  pageSize: z.number().int().min(1).max(100, '每页最多100条'),
})

const GetOrderByIdSchema = z.object({
  orderId: z.string().min(1, '订单ID不能为空'),
  userId: z.string().min(1, '用户ID不能为空'),
})

// ========================
// 辅助函数
// ========================

/**
 * 生成唯一订单号
 * 规则: ORD${yyyyMMddHHmmss}${4位随机字母数字}
 */
export function generateOrderNo(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  const seconds = String(now.getSeconds()).padStart(2, '0')

  const timestamp = `${year}${month}${day}${hours}${minutes}${seconds}`
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let random = ''
  for (let i = 0; i < 4; i++) {
    random += chars.charAt(Math.floor(Math.random() * chars.length))
  }

  return `ORD${timestamp}${random}`
}

// ========================
// 订单服务方法
// ========================

/**
 * 创建订单
 * 1. 查询套餐信息
 * 2. 生成唯一订单号，创建 PENDING 订单（expireAt = now + 30分钟）
 * 3. 调用 PaymentGateway.createPayment 获取支付链接/二维码
 * 4. 向 orderExpireQueue 添加延迟任务（30分钟后触发）
 * 5. 返回订单信息 + 支付参数
 */
export async function createOrder(
  userId: string,
  packageId: string,
  payMethod: PaymentChannel
) {
  // 参数校验
  const validated = CreateOrderSchema.parse({ userId, packageId, payMethod })

  // 查询套餐信息
  const pkg = await prisma.package.findUnique({
    where: { id: validated.packageId },
  })

  if (!pkg) {
    throw new ApiError('NOT_FOUND', '套餐不存在', 404)
  }

  if (!pkg.isActive) {
    throw new ApiError('VALIDATION_ERROR', '该套餐已不可用')
  }

  // 生成订单号
  const orderNo = generateOrderNo()

  // 设置过期时间：当前时间 + 30分钟
  const expireAt = new Date(Date.now() + 30 * 60 * 1000)

  // 创建订单记录
  const order = await prisma.packageOrder.create({
    data: {
      userId: validated.userId,
      packageId: validated.packageId,
      amount: pkg.price,
      credits: pkg.credits,
      status: 'PENDING',
      payMethod: validated.payMethod,
      expireAt,
    },
  })

  // 调用支付网关创建支付
  const gateway = getPaymentGateway(validated.payMethod)
  const notifyUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/payments/${validated.payMethod}/callback`

  const paymentResult = await gateway.createPayment({
    orderNo: order.id,
    amount: pkg.price,
    description: `积分套餐 - ${pkg.name}`,
    channel: validated.payMethod,
    notifyUrl,
  })

  // 向 orderExpireQueue 添加延迟任务（30分钟后触发）
  try {
    await orderExpireQueue.add(
      `expire-order-${order.id}`,
      { orderId: order.id },
      { delay: 30 * 60 * 1000 } // 30分钟延迟
    )
  } catch (err) {
    // 队列添加失败不影响订单创建，定时任务兜底
    logger.warn('添加订单过期延迟任务失败', { orderId: order.id, error: String(err) })
  }

  logger.info('订单创建成功', {
    orderId: order.id,
    userId: validated.userId,
    packageName: pkg.name,
    amount: pkg.price,
    payMethod: validated.payMethod,
  })

  return {
    order: {
      ...order,
      packageName: pkg.name,
    },
    paymentParams: paymentResult,
  }
}

/**
 * 处理支付回调
 * 1. 通过 orderNo（即 orderId）查询订单
 * 2. 幂等检查：已 PAID 则直接返回
 * 3. 验证金额一致性
 * 4. 事务中：更新订单状态为 PAID，调用 CreditService.topupCredits 增加积分
 * 5. 创建支付成功通知
 */
export async function handlePaymentCallback(callbackData: PaymentCallbackData) {
  const { orderNo, transactionId, amount, paidAt } = callbackData

  // 查询订单
  const order = await prisma.packageOrder.findUnique({
    where: { id: orderNo },
    include: { package: true },
  })

  if (!order) {
    logger.warn('支付回调订单不存在', { orderNo, transactionId })
    throw new ApiError('NOT_FOUND', '订单不存在', 404)
  }

  // 幂等检查：已支付或其他终态则直接返回
  if (order.status === 'PAID') {
    logger.info('重复支付回调，幂等处理', { orderId: order.id, transactionId })
    return
  }

  // 非 PENDING 状态无法处理
  if (order.status !== 'PENDING') {
    logger.warn('订单状态不允许支付回调', { orderId: order.id, status: order.status })
    return
  }

  // 验证金额一致性
  if (amount !== order.amount) {
    logger.error('支付回调金额不一致', {
      orderId: order.id,
      expectedAmount: order.amount,
      actualAmount: amount,
    })
    // 金额不一致标记为需人工审核
    await prisma.packageOrder.update({
      where: { id: order.id },
      data: { status: 'REQUIRES_MANUAL_REVIEW', transactionId },
    })
    return
  }

  // 在事务中：更新订单状态 + 充值积分（使用幂等的 topupCredits，按 orderId 查重）
  try {
    await prisma.$transaction(async (tx) => {
      // 更新订单状态为 PAID
      await tx.packageOrder.update({
        where: { id: order.id },
        data: {
          status: 'PAID',
          transactionId,
          paidAt,
        },
      })
    })

    // 事务外调用 topupCredits（自带幂等：按 orderId 检查是否已存在 TOPUP 流水，重复回调不会双重充值）
    await CreditService.topupCredits(
      order.userId,
      order.credits,
      order.id,
      `购买${order.package.name}，充值 ${order.credits} 积分`
    )

    logger.info('支付回调处理成功，积分已到账', {
      orderId: order.id,
      userId: order.userId,
      credits: order.credits,
    })

    // 创建支付成功通知（非事务内，失败不影响主流程）
    try {
      await NotificationService.createPaymentSuccessNotification(order.userId, {
        orderId: order.id,
        packageName: order.package.name,
        credits: order.credits,
        amount: order.amount,
      })
    } catch (err) {
      logger.warn('创建支付成功通知失败', { orderId: order.id, error: String(err) })
    }
  } catch (err) {
    // 事务失败：标记为需人工审核
    logger.error('支付回调事务处理失败', {
      orderId: order.id,
      error: String(err),
    })

    await prisma.packageOrder.update({
      where: { id: order.id },
      data: { status: 'REQUIRES_MANUAL_REVIEW', transactionId },
    })

    throw err
  }
}

/**
 * 过期订单
 * 检查订单当前状态为 PENDING 才能过期，更新状态为 EXPIRED
 */
export async function expireOrder(orderId: string) {
  if (!orderId) {
    throw new ApiError('VALIDATION_ERROR', '订单ID不能为空')
  }

  const order = await prisma.packageOrder.findUnique({
    where: { id: orderId },
  })

  if (!order) {
    throw new ApiError('NOT_FOUND', '订单不存在', 404)
  }

  // 仅 PENDING 状态的订单可以过期
  if (order.status !== 'PENDING') {
    logger.info('订单不在 PENDING 状态，跳过过期处理', { orderId, status: order.status })
    return
  }

  await prisma.packageOrder.update({
    where: { id: orderId },
    data: { status: 'EXPIRED' },
  })

  logger.info('订单已过期', { orderId })
}

/**
 * 批量过期超时订单
 * 查找所有 PENDING 且 expireAt < 当前时间的订单，批量更新为 EXPIRED
 */
export async function expireTimedOutOrders(): Promise<number> {
  const now = new Date()

  const result = await prisma.packageOrder.updateMany({
    where: {
      status: 'PENDING',
      expireAt: { lt: now },
    },
    data: { status: 'EXPIRED' },
  })

  if (result.count > 0) {
    logger.info(`批量过期 ${result.count} 个超时订单`)
  }

  return result.count
}

/**
 * 获取订单详情（校验所有权）
 */
export async function getOrderById(orderId: string, userId: string) {
  const validated = GetOrderByIdSchema.parse({ orderId, userId })

  const order = await prisma.packageOrder.findUnique({
    where: { id: validated.orderId },
    include: { package: true },
  })

  if (!order) {
    throw new ApiError('NOT_FOUND', '订单不存在', 404)
  }

  if (order.userId !== validated.userId) {
    throw new ApiError('FORBIDDEN', '无权查看该订单', 403)
  }

  return order
}

/**
 * 分页获取用户订单列表（按 createdAt 倒序）
 */
export async function getUserOrders(
  userId: string,
  page: number,
  pageSize: number
) {
  const validated = GetUserOrdersSchema.parse({ userId, page, pageSize })

  const where = { userId: validated.userId }

  const [orders, total] = await Promise.all([
    prisma.packageOrder.findMany({
      where,
      include: { package: true },
      orderBy: { createdAt: 'desc' },
      skip: (validated.page - 1) * validated.pageSize,
      take: validated.pageSize,
    }),
    prisma.packageOrder.count({ where }),
  ])

  return {
    data: orders,
    total,
    page: validated.page,
    pageSize: validated.pageSize,
    totalPages: Math.ceil(total / validated.pageSize),
  }
}
