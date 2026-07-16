/**
 * 统一通知调度层（notification-dispatcher）
 *
 * 作为用户级 Notification 和门店级 StoreNotification 两套通知的统一写入入口。
 * 内部按 scope 分发：
 * - type: 'user'  → 写 Notification 表（调用 notification-service.create）
 * - type: 'store' → 写 StoreNotification 表
 *
 * 两张表保留不合并（Schema 差异大），仅在服务层和 API 层统一入口。
 */

import { prisma } from '@/lib/shared/db'
import * as notificationService from '@/lib/shared/notification-service'

// ========================
// 类型定义
// ========================

/** 通知作用域 */
export type NotificationScope =
  | { type: 'user'; userId: string }
  | { type: 'store'; storeId: string }

/** 通知载荷 */
export interface NotificationPayload {
  /** 通知类型（如 ASSET_EXPIRING / MILESTONE / PUBLISH_REMINDER 等） */
  type: string
  /** 标题 */
  title: string
  /** 正文 */
  body: string
  /** 可选跳转链接 */
  actionHref?: string
  /** 可选元数据（仅 user scope 支持） */
  meta?: Record<string, string>
}

// ========================
// 统一分发
// ========================

/**
 * 按 scope 分发通知到对应的表。
 *
 * - user scope → Notification 表（通过 notification-service.create）
 * - store scope → StoreNotification 表（直接写库）
 *
 * @param scope 通知作用域
 * @param payload 通知内容
 */
export async function dispatchNotification(
  scope: NotificationScope,
  payload: NotificationPayload
): Promise<void> {
  if (scope.type === 'user') {
    await notificationService.create({
      userId: scope.userId,
      type: payload.type,
      title: payload.title,
      content: payload.body,
      meta: payload.meta,
    })
  } else {
    await prisma.storeNotification.create({
      data: {
        storeId: scope.storeId,
        type: payload.type,
        title: payload.title,
        body: payload.body,
        actionHref: payload.actionHref ?? null,
      },
    })
  }
}
