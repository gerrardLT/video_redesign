// Feature: local-life-depth-enhancements, Property 33: 通知作用域与已读切换
//
// 属性测试：对任意多门店通知集合——
//   1) 作用域：listNotifications(storeId) 仅返回该 store 的通知，绝不混入其它门店；
//   2) 已读切换：markNotificationRead(notificationId) 后该通知 read=true，
//      且仅影响目标通知，不波及其它通知。
//
// 被测：src/lib/task-center-service.ts 的 listNotifications / markNotificationRead
// （操作 StoreNotification 模型，映射表 store_notifications）。
// 对 prisma.storeNotification 做内存桩：
//   - findMany 按 storeId 过滤（createdAt 降序）；
//   - findUnique 按 id 命中；
//   - update 将目标行 read 置 true。
// 纯数据库读 / 写逻辑，不触发外部依赖、无 fallback、无伪造数据。
//
// **Validates: Requirements 9.3**

import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'
import type { StoreNotification } from '@/generated/prisma'

// ============================================================
// 内存数据库状态（vi.hoisted 保证 mock 工厂可引用）
// ============================================================
const db = vi.hoisted(() => ({
  // 全部门店的通知行（每次迭代由测试重置）
  notifications: [] as Record<string, unknown>[],
}))

// ============================================================
// prisma 内存桩：仅实现被测路径用到的 storeNotification 三个方法
// ============================================================
vi.mock('@/lib/db', () => {
  const storeNotification = {
    // 作用域过滤：仅返回 where.storeId 命中的通知，按 createdAt 降序（与实现一致）
    findMany: vi.fn(async (args: { where: { storeId: string }; orderBy?: unknown }) => {
      return db.notifications
        .filter((n) => n.storeId === args.where.storeId)
        .sort(
          (a, b) =>
            (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime()
        )
        .map((n) => ({ ...n }))
    }),
    // 按 id 命中（实现仅 select id）
    findUnique: vi.fn(async (args: { where: { id: string }; select?: unknown }) => {
      const row = db.notifications.find((n) => n.id === args.where.id)
      return row ? { id: row.id } : null
    }),
    // 置 read=true（实现 data: { read: true }）
    update: vi.fn(async (args: { where: { id: string }; data: { read: boolean } }) => {
      const row = db.notifications.find((n) => n.id === args.where.id)
      if (!row) throw new Error(`record not found: ${args.where.id}`)
      Object.assign(row, args.data)
      return { ...row }
    }),
  }
  return { prisma: { storeNotification } }
})

// 动态导入以确保 mock 生效
const { listNotifications, markNotificationRead } = await import('@/lib/task-center-service')

// ============================================================
// Arbitraries
// ============================================================

const NOTIFICATION_TYPES = ['EXPIRY', 'PUBLISH_REMINDER', 'CRAWL_FAILED', 'MILESTONE'] as const

// 单条通知（storeId 限定在小集合内，保证多门店间存在交叉归属）
const notificationArb = (storeIds: string[]) =>
  fc.record({
    id: fc.uuid(),
    storeId: fc.constantFrom(...storeIds),
    type: fc.constantFrom(...NOTIFICATION_TYPES),
    title: fc.string({ minLength: 1, maxLength: 20 }),
    body: fc.string({ maxLength: 40 }),
    actionHref: fc.option(fc.webUrl(), { nil: null }),
    read: fc.boolean(),
    // createdAt 用毫秒偏移构造，保证可比较
    createdAtOffset: fc.integer({ min: 0, max: 1_000_000 }),
  })

// 多门店场景：先确定 2-4 个门店 ID，再生成归属这些门店的通知集合（id 唯一）
const scenarioArb = fc
  .uniqueArray(fc.uuid(), { minLength: 2, maxLength: 4 })
  .chain((storeIds) =>
    fc.record({
      storeIds: fc.constant(storeIds),
      notifications: fc
        .uniqueArray(notificationArb(storeIds), {
          minLength: 1,
          maxLength: 20,
          selector: (n) => n.id,
        }),
    })
  )

const BASE_TIME = new Date('2026-01-01T00:00:00Z').getTime()

/** 将场景写入内存桩，返回写入的行（含真实 Date 的 createdAt） */
function seed(notifications: ReturnType<typeof notificationArb> extends fc.Arbitrary<infer T> ? T[] : never): void {
  db.notifications = notifications.map((n) => ({
    id: n.id,
    storeId: n.storeId,
    type: n.type,
    title: n.title,
    body: n.body,
    actionHref: n.actionHref,
    read: n.read,
    createdAt: new Date(BASE_TIME + n.createdAtOffset),
  }))
}

// ============================================================
// Property 33: 通知作用域与已读切换
// ============================================================

describe('Property 33: 通知作用域与已读切换', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('listNotifications 仅返回该门店通知，且不混入其它门店', async () => {
    /**
     * **Validates: Requirements 9.3**
     */
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ storeIds, notifications }) => {
        seed(notifications)

        for (const storeId of storeIds) {
          const result = (await listNotifications({ storeId })) as unknown as StoreNotification[]

          // —— 作用域：返回的每条通知都属于查询门店 ——
          for (const n of result) {
            expect(n.storeId).toBe(storeId)
          }

          // —— 完整性：恰好返回该门店的全部通知（数量一致、id 集合一致）——
          const expectedIds = notifications
            .filter((n) => n.storeId === storeId)
            .map((n) => n.id)
            .sort()
          const actualIds = result.map((n) => n.id).sort()
          expect(actualIds).toStrictEqual(expectedIds)

          // —— 降序：createdAt 单调不增 ——
          for (let i = 1; i < result.length; i++) {
            expect(result[i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(
              result[i].createdAt.getTime()
            )
          }
        }
      }),
      { numRuns: 200 }
    )
  })

  it('markNotificationRead 后该通知 read=true，且仅影响目标通知', async () => {
    /**
     * **Validates: Requirements 9.3**
     */
    await fc.assert(
      fc.asyncProperty(
        scenarioArb,
        fc.nat(),
        async ({ storeIds, notifications }, pick) => {
          seed(notifications)

          // 任取一条通知作为标记目标
          const target = db.notifications[pick % db.notifications.length]
          const targetId = target.id as string

          await markNotificationRead({ notificationId: targetId })

          // —— 目标通知 read=true ——
          const after = db.notifications.find((n) => n.id === targetId)!
          expect(after.read).toBe(true)

          // —— 通过 listNotifications 也能观察到目标已读 ——
          const list = (await listNotifications({
            storeId: target.storeId as string,
          })) as unknown as StoreNotification[]
          const found = list.find((n) => n.id === targetId)!
          expect(found.read).toBe(true)

          // —— 仅影响目标通知：其它通知 read 状态保持初始值不变 ——
          for (const original of notifications) {
            if (original.id === targetId) continue
            const current = db.notifications.find((n) => n.id === original.id)!
            expect(current.read).toBe(original.read)
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('markNotificationRead 对不存在的通知抛出 NOTIFICATION_NOT_FOUND', async () => {
    /**
     * 已读切换前置校验：目标通知不存在时显式报错，不静默处理。
     * **Validates: Requirements 9.3**
     */
    await fc.assert(
      fc.asyncProperty(scenarioArb, fc.uuid(), async ({ notifications }, missingId) => {
        seed(notifications)
        // 确保 missingId 不在集合内
        fc.pre(!db.notifications.some((n) => n.id === missingId))

        await expect(
          markNotificationRead({ notificationId: missingId })
        ).rejects.toMatchObject({ code: 'NOTIFICATION_NOT_FOUND' })
      }),
      { numRuns: 100 }
    )
  })
})
