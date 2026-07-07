/**
 * 订阅核心服务（SubscriptionService）
 *
 * 管理订阅的完整生命周期：创建订阅、支付回调处理、续费、取消、到期、
 * 自动续费扣款、重试逻辑、查询等。
 *
 * 核心设计原则：
 * - 幂等性：支付回调通过订单状态守卫保证不重复处理
 * - 原子性：关键状态变更通过 Prisma 事务保证一致性
 * - 签约代扣：通过 PaymentGateway 扩展接口对接微信/支付宝签约代扣
 * - BullMQ：续费定时任务通过队列调度，支持重试与延迟执行
 */
import { prisma } from './db'
import { dispatchSubscriptionCredits, calculateCreditsToDispatch } from './credit-dispatcher'
import { getPaymentGateway } from '@/services/payment'
import type { PaymentChannel, PaymentResult } from '@/services/payment/types'
import { notificationQueue } from './queue'

// ========================
// 类型定义
// ========================

export interface CreateSubscriptionInput {
  userId: string
  planId: string
  payMethod: 'wechat' | 'alipay'
  enableAutoRenewal: boolean
}

export interface SubscriptionCallbackData {
  /** 商户订单号（即 SubscriptionOrder.id） */
  orderNo: string
  /** 支付平台交易号 */
  transactionId: string
  /** 实际支付金额（分） */
  amount: number
  /** 支付完成时间 */
  paidAt: Date
  /** 支付渠道 */
  channel: PaymentChannel
  /** 签约协议编号（签约成功时返回） */
  contractId?: string
  /** 是否支付成功 */
  success: boolean
  /** 失败原因 */
  failReason?: string
}

export interface PaginatedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

// ========================
// 辅助纯函数
// ========================

/**
 * 计算订阅到期日期延长后的新日期（纯函数）
 *
 * @param currentEndDate 当前到期日期
 * @param planType 套餐类型：'monthly' 延长30天，'quarterly' 延长90天，'yearly' 延长365天
 * @returns 延长后的新到期日期，严格大于 currentEndDate
 */
export function extendEndDate(
  currentEndDate: Date,
  planType: 'monthly' | 'quarterly' | 'yearly'
): Date {
  const newDate = new Date(currentEndDate.getTime())
  if (planType === 'monthly') {
    newDate.setDate(newDate.getDate() + 30)
  } else if (planType === 'quarterly') {
    newDate.setDate(newDate.getDate() + 90)
  } else {
    newDate.setDate(newDate.getDate() + 365)
  }
  return newDate
}

// ========================
// 核心服务方法
// ========================

/**
 * 创建订阅订单并发起签约支付
 *
 * 流程：
 * 1. 校验套餐存在且上架
 * 2. 校验用户无活跃订阅（有则抛 409 冲突）
 * 3. 创建 SubscriptionOrder（PENDING，30分钟过期）
 * 4. 调用 PaymentGateway 发起签约+首期扣款
 *
 * @throws {Error} 409 - 用户已有活跃订阅
 * @throws {Error} 404 - 套餐不存在或已下架
 */
export async function createSubscription(input: CreateSubscriptionInput): Promise<{
  order: { id: string; status: string; expireAt: Date }
  paymentParams: PaymentResult
}> {
  const { userId, planId, payMethod, enableAutoRenewal } = input

  // 1. 校验套餐存在且上架
  const plan = await prisma.subscriptionPlan.findFirst({
    where: { id: planId, isActive: true },
  })
  if (!plan) {
    const error = new Error('套餐不存在或已下架')
    ;(error as Error & { statusCode: number }).statusCode = 404
    throw error
  }

  // 2. 校验用户无活跃订阅
  const existingActive = await prisma.subscriptionRecord.findFirst({
    where: { userId, status: 'ACTIVE' },
  })
  if (existingActive) {
    const error = new Error('用户已有活跃订阅，不可重复开通')
    ;(error as Error & { statusCode: number }).statusCode = 409
    throw error
  }

  // 3. 计算应发放积分（首月）
  const credits = calculateCreditsToDispatch(
    plan.type as 'monthly' | 'quarterly' | 'yearly',
    true
  )

  // 4. 创建订阅订单（30分钟过期）
  const expireAt = new Date(Date.now() + 30 * 60 * 1000)
  const order = await prisma.subscriptionOrder.create({
    data: {
      userId,
      planId,
      type: 'FIRST_SUBSCRIBE',
      amount: plan.price,
      credits,
      status: 'PENDING',
      payMethod,
      expireAt,
    },
  })

  // 5. 调用 PaymentGateway 发起签约支付
  const gateway = getPaymentGateway(payMethod)
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
  const notifyUrl = `${baseUrl}/api/payments/${payMethod}/subscription-callback`

  const paymentParams = await gateway.createPayment({
    orderNo: order.id,
    amount: plan.price,
    description: `订阅开通 - ${plan.name}`,
    channel: payMethod,
    notifyUrl,
  })

  return {
    order: { id: order.id, status: order.status, expireAt: order.expireAt },
    paymentParams,
  }
}

/**
 * 处理订阅首次支付成功回调
 *
 * 幂等性：仅处理 status='PENDING' 的订单，其他状态直接跳过。
 *
 * 流程：
 * 1. 查询订单，非 PENDING 则幂等跳过
 * 2. 更新 Order → PAID
 * 3. 创建 SubscriptionRecord（ACTIVE）
 * 4. 调用 CreditDispatcher 发放积分
 * 5. 注册 BullMQ 续费定时任务（到期前3天触发）
 */
export async function handleSubscriptionPaymentCallback(
  callbackData: SubscriptionCallbackData
): Promise<void> {
  const { orderNo, transactionId, paidAt, success, failReason, contractId } = callbackData

  // 查询订单
  const order = await prisma.subscriptionOrder.findUnique({
    where: { id: orderNo },
    include: { plan: true },
  })
  if (!order) {
    throw new Error(`订阅订单不存在: ${orderNo}`)
  }

  // 幂等：非 PENDING 状态跳过
  if (order.status !== 'PENDING') {
    return
  }

  // 支付失败处理
  if (!success) {
    await prisma.subscriptionOrder.update({
      where: { id: orderNo },
      data: {
        status: 'FAILED',
        failReason: failReason || '支付失败',
      },
    })
    return
  }

  // 支付成功：Order → PAID，创建 SubscriptionRecord
  const now = new Date()
  const planType = order.plan.type as 'monthly' | 'quarterly' | 'yearly'
  const endDate = extendEndDate(now, planType)

  const record = await prisma.$transaction(async (tx) => {
    // 更新订单状态
    await tx.subscriptionOrder.update({
      where: { id: orderNo },
      data: {
        status: 'PAID',
        transactionId,
        paidAt,
        contractId: contractId || null,
      },
    })

    // 创建订阅记录
    const newRecord = await tx.subscriptionRecord.create({
      data: {
        userId: order.userId,
        planId: order.planId,
        status: 'ACTIVE',
        renewalType: 'AUTO',
        contractId: contractId || null,
        payMethod: order.payMethod,
        startDate: now,
        endDate,
      },
    })

    // 更新订单关联 recordId
    await tx.subscriptionOrder.update({
      where: { id: orderNo },
      data: { recordId: newRecord.id },
    })

    return newRecord
  })

  // 发放订阅积分（事务外，自带 withCreditLock 保护）
  await dispatchSubscriptionCredits(
    order.userId,
    order.planId,
    order.id,
    true // 首月
  )

  // 注册续费定时任务（到期前3天触发）
  await scheduleRenewalTask(record.id, endDate)
}

/**
 * 处理续费扣款结果回调
 *
 * - 成功：延长有效期 + 发放积分
 * - 失败：标记 FAILED + 安排24小时后重试
 */
export async function handleRenewalCallback(
  callbackData: SubscriptionCallbackData
): Promise<void> {
  const { orderNo, transactionId, paidAt, success, failReason } = callbackData

  const order = await prisma.subscriptionOrder.findUnique({
    where: { id: orderNo },
    include: { plan: true, record: true },
  })
  if (!order) {
    throw new Error(`续费订单不存在: ${orderNo}`)
  }

  // 幂等：非 PENDING 状态跳过
  if (order.status !== 'PENDING') {
    return
  }

  if (!success) {
    // 扣款失败：标记 FAILED + 安排24小时后重试
    await prisma.subscriptionOrder.update({
      where: { id: orderNo },
      data: {
        status: 'FAILED',
        failReason: failReason || '续费扣款失败',
      },
    })

    // 安排24小时后重试（如果关联了 record）
    if (order.recordId) {
      await scheduleRetryRenewal(order.recordId, 24 * 60 * 60 * 1000)
    }
    return
  }

  // 扣款成功：更新订单 + 延长有效期 + 发放积分
  if (!order.record) {
    throw new Error(`续费订单 ${orderNo} 未关联订阅记录`)
  }

  const planType = order.plan.type as 'monthly' | 'quarterly' | 'yearly'
  const newEndDate = extendEndDate(order.record.endDate, planType)

  await prisma.$transaction(async (tx) => {
    // 更新订单状态
    await tx.subscriptionOrder.update({
      where: { id: orderNo },
      data: {
        status: 'PAID',
        transactionId,
        paidAt,
      },
    })

    // 延长订阅有效期
    await tx.subscriptionRecord.update({
      where: { id: order.recordId! },
      data: {
        endDate: newEndDate,
        lastRenewalDate: new Date(),
        // 续费成功后恢复 ACTIVE 状态（如果之前是 CANCELED 但手动续费成功）
        status: 'ACTIVE',
        renewalType: 'AUTO',
      },
    })
  })

  // 发放续费期积分（非首月）
  await dispatchSubscriptionCredits(
    order.userId,
    order.planId,
    order.id,
    false // 非首月
  )

  // 注册下次续费定时任务
  await scheduleRenewalTask(order.recordId!, newEndDate)
}

/**
 * 取消订阅（关闭自动续费）
 *
 * - 设置 renewalType=CANCELED
 * - 解除签约协议（如有 contractId）
 * - 状态保持 ACTIVE（权益保留至到期）
 *
 * @throws {Error} 404 - 订阅记录不存在
 * @throws {Error} 400 - 订阅状态不允许取消
 */
export async function cancelSubscription(
  userId: string,
  recordId: string
): Promise<void> {
  const record = await prisma.subscriptionRecord.findFirst({
    where: { id: recordId, userId },
  })

  if (!record) {
    const error = new Error('订阅记录不存在')
    ;(error as Error & { statusCode: number }).statusCode = 404
    throw error
  }

  if (record.status === 'EXPIRED') {
    const error = new Error('订阅已过期，无法取消')
    ;(error as Error & { statusCode: number }).statusCode = 400
    throw error
  }

  if (record.renewalType === 'CANCELED') {
    // 已取消，幂等返回
    return
  }

  // 更新续费类型为 CANCELED（状态保持 ACTIVE，权益保留至到期）
  await prisma.subscriptionRecord.update({
    where: { id: recordId },
    data: { renewalType: 'CANCELED' },
  })

  // 解除签约协议
  if (record.contractId) {
    try {
      const gateway = getPaymentGateway(record.payMethod as PaymentChannel)
      if ('cancelContract' in gateway) {
        await (gateway as { cancelContract: (id: string) => Promise<unknown> }).cancelContract(record.contractId)
      }
    } catch (err) {
      // 解约失败不阻断取消流程，记录日志
      console.error(`[cancelSubscription] 解除签约协议失败 contractId=${record.contractId}:`, err)
    }
  }
}

/**
 * 手动续费
 *
 * 创建续费订单并发起支付。适用于自动续费关闭后用户主动续费场景。
 *
 * @throws {Error} 404 - 订阅记录不存在
 */
export async function manualRenew(
  userId: string,
  recordId: string,
  payMethod: PaymentChannel
): Promise<{
  order: { id: string; status: string; expireAt: Date }
  paymentParams: PaymentResult
}> {
  const record = await prisma.subscriptionRecord.findFirst({
    where: { id: recordId, userId },
    include: { plan: true },
  })

  if (!record) {
    const error = new Error('订阅记录不存在')
    ;(error as Error & { statusCode: number }).statusCode = 404
    throw error
  }

  // 计算续费积分（非首月）
  const credits = calculateCreditsToDispatch(
    record.plan.type as 'monthly' | 'quarterly' | 'yearly',
    false
  )

  // 创建续费订单
  const expireAt = new Date(Date.now() + 30 * 60 * 1000)
  const order = await prisma.subscriptionOrder.create({
    data: {
      userId,
      planId: record.planId,
      recordId,
      type: 'MANUAL_RENEWAL',
      amount: record.plan.price,
      credits,
      status: 'PENDING',
      payMethod,
      expireAt,
    },
  })

  // 发起支付
  const gateway = getPaymentGateway(payMethod)
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
  const notifyUrl = `${baseUrl}/api/payments/${payMethod}/subscription-callback`

  const paymentParams = await gateway.createPayment({
    orderNo: order.id,
    amount: record.plan.price,
    description: `订阅续费 - ${record.plan.name}`,
    channel: payMethod,
    notifyUrl,
  })

  return {
    order: { id: order.id, status: order.status, expireAt: order.expireAt },
    paymentParams,
  }
}

/**
 * 到期处理：状态设为 EXPIRED，撤销特权
 *
 * 注意：到期时积分余额不变（Property 10），仅撤销会员特权。
 */
export async function expireSubscription(recordId: string): Promise<void> {
  const record = await prisma.subscriptionRecord.findUnique({
    where: { id: recordId },
  })

  if (!record) {
    throw new Error(`订阅记录不存在: ${recordId}`)
  }

  // 已经是 EXPIRED 则幂等跳过
  if (record.status === 'EXPIRED') {
    return
  }

  // 状态转为 EXPIRED（积分余额不变，仅撤销特权）
  await prisma.subscriptionRecord.update({
    where: { id: recordId },
    data: { status: 'EXPIRED' },
  })
}

/**
 * 发起自动续费扣款
 *
 * 通过签约协议发起代扣。仅对 renewalType=AUTO 且有 contractId 的记录执行。
 *
 * @throws {Error} 签约协议不存在
 */
export async function triggerAutoRenewal(recordId: string): Promise<void> {
  const record = await prisma.subscriptionRecord.findUnique({
    where: { id: recordId },
    include: { plan: true },
  })

  if (!record) {
    throw new Error(`订阅记录不存在: ${recordId}`)
  }

  // 仅 ACTIVE + AUTO 可触发自动续费
  if (record.status !== 'ACTIVE' || record.renewalType !== 'AUTO') {
    return
  }

  if (!record.contractId) {
    throw new Error(`订阅记录 ${recordId} 无签约协议，无法执行自动续费`)
  }

  // 计算续费积分（非首月）
  const credits = calculateCreditsToDispatch(
    record.plan.type as 'monthly' | 'quarterly' | 'yearly',
    false
  )

  // 创建续费订单
  const expireAt = new Date(Date.now() + 30 * 60 * 1000)
  const order = await prisma.subscriptionOrder.create({
    data: {
      userId: record.userId,
      planId: record.planId,
      recordId: record.id,
      type: 'RENEWAL',
      amount: record.plan.price,
      credits,
      status: 'PENDING',
      payMethod: record.payMethod,
      contractId: record.contractId,
      expireAt,
    },
  })

  // 通过签约协议发起代扣
  const gateway = getPaymentGateway(record.payMethod as PaymentChannel)
  if (!('executeContractDeduction' in gateway)) {
    throw new Error(`支付网关不支持签约代扣: ${record.payMethod}`)
  }

  try {
    await (gateway as { executeContractDeduction: (params: {
      contractId: string
      orderNo: string
      amount: number
      description: string
    }) => Promise<PaymentResult> }).executeContractDeduction({
      contractId: record.contractId,
      orderNo: order.id,
      amount: record.plan.price,
      description: `订阅自动续费 - ${record.plan.name}`,
    })
  } catch (err) {
    // 代扣发起失败，标记订单 FAILED，安排重试
    await prisma.subscriptionOrder.update({
      where: { id: order.id },
      data: {
        status: 'FAILED',
        failReason: err instanceof Error ? err.message : '代扣发起失败',
      },
    })
    // 安排24小时后重试
    await scheduleRetryRenewal(recordId, 24 * 60 * 60 * 1000)
  }
}

/**
 * 重试续费扣款
 *
 * retryCount+1，重试仍失败 → 发送通知提醒用户手动续费。
 * 最多重试1次（总共2次尝试：首次 + 1次重试）。
 */
export async function retryRenewal(recordId: string): Promise<void> {
  const record = await prisma.subscriptionRecord.findUnique({
    where: { id: recordId },
    include: { plan: true },
  })

  if (!record) {
    throw new Error(`订阅记录不存在: ${recordId}`)
  }

  // 非 ACTIVE 或非 AUTO 则跳过
  if (record.status !== 'ACTIVE' || record.renewalType !== 'AUTO') {
    return
  }

  if (!record.contractId) {
    // 无签约协议，发通知让用户手动续费
    await sendRenewalFailedNotification(record.userId, record.id)
    return
  }

  // 查找最近一笔 FAILED 的续费订单
  const lastFailedOrder = await prisma.subscriptionOrder.findFirst({
    where: {
      recordId,
      status: 'FAILED',
      type: { in: ['RENEWAL', 'MANUAL_RENEWAL'] },
    },
    orderBy: { createdAt: 'desc' },
  })

  const currentRetryCount = lastFailedOrder?.retryCount ?? 0

  // 超过重试次数限制（最多重试1次），发通知
  if (currentRetryCount >= 1) {
    await sendRenewalFailedNotification(record.userId, record.id)
    return
  }

  // 计算续费积分
  const credits = calculateCreditsToDispatch(
    record.plan.type as 'monthly' | 'quarterly' | 'yearly',
    false
  )

  // 创建新的续费订单（retryCount+1）
  const expireAt = new Date(Date.now() + 30 * 60 * 1000)
  const order = await prisma.subscriptionOrder.create({
    data: {
      userId: record.userId,
      planId: record.planId,
      recordId: record.id,
      type: 'RENEWAL',
      amount: record.plan.price,
      credits,
      status: 'PENDING',
      payMethod: record.payMethod,
      contractId: record.contractId,
      expireAt,
      retryCount: currentRetryCount + 1,
    },
  })

  // 发起代扣
  const gateway = getPaymentGateway(record.payMethod as PaymentChannel)
  if (!('executeContractDeduction' in gateway)) {
    await prisma.subscriptionOrder.update({
      where: { id: order.id },
      data: { status: 'FAILED', failReason: '支付网关不支持签约代扣' },
    })
    await sendRenewalFailedNotification(record.userId, record.id)
    return
  }

  try {
    await (gateway as { executeContractDeduction: (params: {
      contractId: string
      orderNo: string
      amount: number
      description: string
    }) => Promise<PaymentResult> }).executeContractDeduction({
      contractId: record.contractId,
      orderNo: order.id,
      amount: record.plan.price,
      description: `订阅自动续费重试 - ${record.plan.name}`,
    })
  } catch (err) {
    // 重试仍失败
    await prisma.subscriptionOrder.update({
      where: { id: order.id },
      data: {
        status: 'FAILED',
        failReason: err instanceof Error ? err.message : '代扣重试失败',
      },
    })
    await sendRenewalFailedNotification(record.userId, record.id)
  }
}

/**
 * 查询用户当前有效订阅
 *
 * @returns ACTIVE 状态的订阅记录，不存在则返回 null
 */
export async function getActiveSubscription(userId: string) {
  return await prisma.subscriptionRecord.findFirst({
    where: { userId, status: 'ACTIVE' },
    include: { plan: true },
  })
}

/**
 * 查询用户订阅订单历史（分页）
 *
 * @param userId 用户 ID
 * @param page 页码（从1开始）
 * @param pageSize 每页条数
 * @returns 分页结果
 */
export async function getSubscriptionHistory(
  userId: string,
  page: number,
  pageSize: number
): Promise<PaginatedResult<{
  id: string
  type: string
  amount: number
  credits: number
  status: string
  payMethod: string
  paidAt: Date | null
  createdAt: Date
  plan: { name: string; type: string }
}>> {
  const skip = (page - 1) * pageSize

  const [items, total] = await Promise.all([
    prisma.subscriptionOrder.findMany({
      where: { userId },
      include: { plan: { select: { name: true, type: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.subscriptionOrder.count({ where: { userId } }),
  ])

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  }
}

// ========================
// 内部辅助函数
// ========================

/**
 * 获取订阅续费队列实例
 *
 * subscriptionRenewalQueue 在 task 8.1 中正式添加到 queue.ts。
 * 此处通过 getSubscriptionRenewalQueue() 安全获取：
 * 如果队列尚未定义则返回 null，不阻断业务流程。
 */
function getSubscriptionRenewalQueue() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const queueModule = require('./queue')
    return queueModule.subscriptionRenewalQueue || null
  } catch {
    return null
  }
}

/**
 * 注册续费定时任务（到期前3天触发）
 *
 * 使用 BullMQ 延迟任务，在 endDate 前3天自动触发扣款。
 */
async function scheduleRenewalTask(recordId: string, endDate: Date): Promise<void> {
  try {
    // 计算延迟：endDate 前3天触发
    const triggerTime = new Date(endDate.getTime() - 3 * 24 * 60 * 60 * 1000)
    const delay = Math.max(0, triggerTime.getTime() - Date.now())

    const queue = getSubscriptionRenewalQueue()
    if (queue) {
      await queue.add(
        `renewal-${recordId}`,
        { recordId },
        { delay, jobId: `renewal-${recordId}-${endDate.getTime()}` }
      )
    }
  } catch (err) {
    // 队列尚未定义时不阻断业务（task 8.1 完成后可用）
    console.warn(`[scheduleRenewalTask] 注册续费任务失败（队列可能尚未就绪）:`, err)
  }
}

/**
 * 安排重试续费（延迟指定毫秒后执行）
 */
async function scheduleRetryRenewal(recordId: string, delayMs: number): Promise<void> {
  try {
    const queue = getSubscriptionRenewalQueue()
    if (queue) {
      await queue.add(
        `retry-renewal-${recordId}`,
        { recordId, isRetry: true },
        { delay: delayMs, jobId: `retry-renewal-${recordId}-${Date.now()}` }
      )
    }
  } catch (err) {
    console.warn(`[scheduleRetryRenewal] 注册重试任务失败:`, err)
  }
}

/**
 * 发送续费失败通知
 */
async function sendRenewalFailedNotification(userId: string, recordId: string): Promise<void> {
  try {
    await notificationQueue.add('subscription-renewal-failed', {
      userId,
      recordId,
      type: 'SUBSCRIPTION_RENEWAL_FAILED',
      title: '订阅自动续费失败',
      content: '您的订阅自动续费失败，请手动续费以保持会员权益。',
    })
  } catch (err) {
    console.error(`[sendRenewalFailedNotification] 发送续费失败通知异常:`, err)
  }
}
