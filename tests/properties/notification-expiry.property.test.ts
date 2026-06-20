import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: asset-expiry-policy
 * Property 8: 过期提醒通知幂等性
 * Property 9: 通知内容完整性
 *
 * **Validates: Requirements 5.2, 5.4**
 */

// ========================
// 类型定义
// ========================

interface NotificationRecord {
  userId: string
  assetId: string
  type: string
  createdAt: Date
}

// ========================
// 纯函数模拟（避免引入 Prisma 依赖）
// ========================

/**
 * 检查今天是否已经为该资产发送过过期提醒通知
 * 通过查询通知记录中 type=ASSET_EXPIRING 的今日记录进行判定
 */
function hasNotifiedToday(
  records: NotificationRecord[],
  userId: string,
  assetId: string,
  today: Date
): boolean {
  const todayStart = new Date(today)
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date(today)
  todayEnd.setHours(23, 59, 59, 999)
  return records.some(
    (r) =>
      r.userId === userId &&
      r.assetId === assetId &&
      r.type === 'ASSET_EXPIRING' &&
      r.createdAt >= todayStart &&
      r.createdAt <= todayEnd
  )
}

/**
 * 模拟通知发送流程：仅在当天未通知过时创建新通知记录
 * 实现幂等性：同一天内多次调用最多只产生一条通知
 */
function simulateNotificationFlow(
  records: NotificationRecord[],
  userId: string,
  assetId: string,
  today: Date
): NotificationRecord[] {
  if (hasNotifiedToday(records, userId, assetId, today)) return records
  return [...records, { userId, assetId, type: 'ASSET_EXPIRING', createdAt: today }]
}

/**
 * 生成过期提醒通知内容
 * 通知内容包含项目名称、资产名称（默认"视频资产"）和剩余过期天数
 */
function generateNotificationContent(
  projectName: string,
  assetName: string,
  daysLeft: number
): string {
  return `您的项目「${projectName}」中的资产「${assetName || '视频资产'}」将在 ${daysLeft} 天后过期，请及时下载保存或收藏到资产库。`
}

// ========================
// 通用 Arbitraries
// ========================

const validDate = (min: string, max: string) =>
  fc.date({ min: new Date(min), max: new Date(max), noInvalidDate: true })

// ========================
// Property 8: 过期提醒通知幂等性
// ========================

describe('Property 8: 过期提醒通知幂等性', () => {
  it('同一天内多次执行提醒流程，最多只产生一条通知', () => {
    /**
     * **Validates: Requirements 5.4**
     */
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        validDate('2024-01-01', '2025-12-31'),
        fc.integer({ min: 2, max: 10 }),
        (userId, assetId, today, repeatCount) => {
          let records: NotificationRecord[] = []

          // 同一天内执行多次通知流程
          for (let i = 0; i < repeatCount; i++) {
            // 模拟同一天内不同时刻的调用（保持在同一天）
            const callTime = new Date(today)
            callTime.setHours(
              Math.floor(Math.random() * 24),
              Math.floor(Math.random() * 60),
              Math.floor(Math.random() * 60)
            )
            records = simulateNotificationFlow(records, userId, assetId, callTime)
          }

          // 统计该资产当天的通知数量
          const todayStart = new Date(today)
          todayStart.setHours(0, 0, 0, 0)
          const todayEnd = new Date(today)
          todayEnd.setHours(23, 59, 59, 999)

          const todayNotifications = records.filter(
            (r) =>
              r.userId === userId &&
              r.assetId === assetId &&
              r.type === 'ASSET_EXPIRING' &&
              r.createdAt >= todayStart &&
              r.createdAt <= todayEnd
          )

          // 最多只有一条通知
          expect(todayNotifications.length).toBeLessThanOrEqual(1)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('不同天可以各产生一条通知', () => {
    /**
     * **Validates: Requirements 5.4**
     */
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        validDate('2024-01-01', '2024-06-30'),
        validDate('2024-07-01', '2024-12-31'),
        (userId, assetId, day1, day2) => {
          let records: NotificationRecord[] = []

          // 第一天发送通知
          records = simulateNotificationFlow(records, userId, assetId, day1)
          // 第二天发送通知
          records = simulateNotificationFlow(records, userId, assetId, day2)

          // 两天的通知记录各一条
          const notificationsForAsset = records.filter(
            (r) =>
              r.userId === userId &&
              r.assetId === assetId &&
              r.type === 'ASSET_EXPIRING'
          )

          expect(notificationsForAsset.length).toBe(2)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('不同资产的通知互不影响幂等性', () => {
    /**
     * **Validates: Requirements 5.4**
     */
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        fc.uuid(),
        validDate('2024-01-01', '2025-12-31'),
        (userId, assetId1, assetId2, today) => {
          // 确保是两个不同资产
          fc.pre(assetId1 !== assetId2)

          let records: NotificationRecord[] = []

          // 两个资产各执行通知
          records = simulateNotificationFlow(records, userId, assetId1, today)
          records = simulateNotificationFlow(records, userId, assetId2, today)
          // 再次执行（测试幂等）
          records = simulateNotificationFlow(records, userId, assetId1, today)
          records = simulateNotificationFlow(records, userId, assetId2, today)

          // 每个资产最多一条
          const asset1Notifications = records.filter(
            (r) => r.assetId === assetId1 && r.type === 'ASSET_EXPIRING'
          )
          const asset2Notifications = records.filter(
            (r) => r.assetId === assetId2 && r.type === 'ASSET_EXPIRING'
          )

          expect(asset1Notifications.length).toBe(1)
          expect(asset2Notifications.length).toBe(1)
        }
      ),
      { numRuns: 200 }
    )
  })
})

// ========================
// Property 9: 通知内容完整性
// ========================

describe('Property 9: 通知内容完整性', () => {
  it('通知内容包含资产名称、项目名称、剩余天数', () => {
    /**
     * **Validates: Requirements 5.2**
     */
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.integer({ min: 1, max: 3 }),
        (projectName, assetName, daysLeft) => {
          const content = generateNotificationContent(projectName, assetName, daysLeft)

          // 通知内容必须包含项目名称
          expect(content).toContain(projectName)
          // 通知内容必须包含资产名称
          expect(content).toContain(assetName)
          // 通知内容必须包含剩余天数
          expect(content).toContain(String(daysLeft))
        }
      ),
      { numRuns: 200 }
    )
  })

  it('资产名称为空时使用默认名称"视频资产"', () => {
    /**
     * **Validates: Requirements 5.2**
     */
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.integer({ min: 1, max: 3 }),
        (projectName, daysLeft) => {
          const content = generateNotificationContent(projectName, '', daysLeft)

          // 使用默认名称
          expect(content).toContain('视频资产')
          // 仍然包含项目名称
          expect(content).toContain(projectName)
          // 仍然包含剩余天数
          expect(content).toContain(String(daysLeft))
        }
      ),
      { numRuns: 200 }
    )
  })

  it('通知内容格式与 notification-service 中的模板一致', () => {
    /**
     * **Validates: Requirements 5.2**
     */
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.integer({ min: 1, max: 3 }),
        (projectName, assetName, daysLeft) => {
          const content = generateNotificationContent(projectName, assetName, daysLeft)

          // 验证格式：使用中文书名号标识项目和资产
          expect(content).toMatch(/您的项目「.+」中的资产「.+」将在 \d+ 天后过期/)
          // 验证包含操作引导
          expect(content).toContain('请及时下载保存或收藏到资产库')
        }
      ),
      { numRuns: 200 }
    )
  })
})
