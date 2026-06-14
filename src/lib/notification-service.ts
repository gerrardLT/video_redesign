/**
 * 通知服务
 * 提供通知创建、查询、标记已读等操作
 */
import { z } from 'zod/v4'
import { prisma } from './db'
import { ApiError } from './api-error'

// ========================
// Zod 校验 Schema
// ========================

const NotificationTypeEnum = z.enum(['ASSET_EXPIRING', 'PAYMENT_SUCCESS', 'SYSTEM'])

const CreateNotificationSchema = z.object({
  userId: z.string().min(1, '用户ID不能为空'),
  type: NotificationTypeEnum,
  title: z.string().min(1, '标题不能为空').max(100, '标题不能超过100字'),
  content: z.string().min(1, '内容不能为空').max(1000, '内容不能超过1000字'),
  meta: z.record(z.string(), z.string()).optional(),
})

const GetUserNotificationsSchema = z.object({
  userId: z.string().min(1, '用户ID不能为空'),
  page: z.number().int().min(1, '页码最小为1'),
  pageSize: z.number().int().min(1).max(100, '每页最多100条'),
  unreadOnly: z.boolean().optional().default(false),
})

export type CreateNotificationInput = z.infer<typeof CreateNotificationSchema>

// ========================
// 通知服务方法
// ========================

/**
 * 创建通知
 */
export async function create(params: {
  userId: string
  type: string
  title: string
  content: string
  meta?: Record<string, string>
}) {
  const validated = CreateNotificationSchema.parse(params)

  const notification = await prisma.notification.create({
    data: {
      userId: validated.userId,
      type: validated.type,
      title: validated.title,
      content: validated.content,
      meta: validated.meta ? JSON.stringify(validated.meta) : null,
    },
  })

  return notification
}

/**
 * 分页获取用户通知列表（按 createdAt 降序）
 */
export async function getUserNotifications(
  userId: string,
  page: number,
  pageSize: number,
  unreadOnly: boolean = false
) {
  const validated = GetUserNotificationsSchema.parse({ userId, page, pageSize, unreadOnly })

  const where = {
    userId: validated.userId,
    ...(validated.unreadOnly ? { isRead: false } : {}),
  }

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (validated.page - 1) * validated.pageSize,
      take: validated.pageSize,
    }),
    prisma.notification.count({ where }),
  ])

  return {
    data: notifications,
    total,
    page: validated.page,
    pageSize: validated.pageSize,
    totalPages: Math.ceil(total / validated.pageSize),
  }
}

/**
 * 获取未读通知数量
 */
export async function getUnreadCount(userId: string) {
  if (!userId) {
    throw new ApiError('VALIDATION_ERROR', '用户ID不能为空')
  }

  const count = await prisma.notification.count({
    where: { userId, isRead: false },
  })

  return count
}

/**
 * 标记单条通知为已读（校验所有权）
 */
export async function markAsRead(notificationId: string, userId: string) {
  if (!notificationId || !userId) {
    throw new ApiError('VALIDATION_ERROR', '参数不能为空')
  }

  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
  })

  if (!notification) {
    throw new ApiError('NOT_FOUND', '通知不存在', 404)
  }

  if (notification.userId !== userId) {
    throw new ApiError('FORBIDDEN', '无权操作该通知', 403)
  }

  await prisma.notification.update({
    where: { id: notificationId },
    data: { isRead: true },
  })
}

/**
 * 标记该用户所有通知为已读
 */
export async function markAllAsRead(userId: string) {
  if (!userId) {
    throw new ApiError('VALIDATION_ERROR', '用户ID不能为空')
  }

  await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  })
}

/**
 * 获取用户未读通知列表
 */
export async function getUnread(userId: string) {
  if (!userId) {
    throw new ApiError('VALIDATION_ERROR', '用户ID不能为空')
  }

  const notifications = await prisma.notification.findMany({
    where: { userId, isRead: false },
    orderBy: { createdAt: 'desc' },
  })

  return notifications
}

// ========================
// 模板化通知创建
// ========================

/**
 * 创建资产即将过期通知
 */
export async function createAssetExpiringNotification(
  userId: string,
  assetInfo: {
    assetId: string
    projectId: string
    projectName: string
    expiresAt: Date
    daysLeft: number
  }
) {
  const title = '资产即将过期'
  const content = `您的项目「${assetInfo.projectName}」中的视频资产将在 ${assetInfo.daysLeft} 天后过期，请及时下载保存。`
  const meta: Record<string, string> = {
    assetId: assetInfo.assetId,
    projectId: assetInfo.projectId,
    link: `/dashboard/projects/${assetInfo.projectId}`,
    expiresAt: assetInfo.expiresAt.toISOString(),
  }

  return create({
    userId,
    type: 'ASSET_EXPIRING',
    title,
    content,
    meta,
  })
}

/**
 * 创建支付成功通知
 */
export async function createPaymentSuccessNotification(
  userId: string,
  orderInfo: {
    orderId: string
    packageName: string
    credits: number
    amount: number
  }
) {
  const amountYuan = (orderInfo.amount / 100).toFixed(2)
  const title = '充值成功'
  const content = `您已成功购买「${orderInfo.packageName}」，支付 ¥${amountYuan}，${orderInfo.credits} 积分已到账。`
  const meta: Record<string, string> = {
    orderId: orderInfo.orderId,
    link: `/dashboard/orders`,
  }

  return create({
    userId,
    type: 'PAYMENT_SUCCESS',
    title,
    content,
    meta,
  })
}
