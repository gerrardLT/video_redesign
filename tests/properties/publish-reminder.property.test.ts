// Feature: local-life-depth-enhancements, Property 30: 超时提醒恰一次
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: local-life-depth-enhancements
 * Property 30: 超时提醒恰一次
 *
 * 对任意「导出后时间推进」的待发布清单项（PublishQueueItem），当超过 remindAfterH 小时
 * 仍未标记发布时，notification-worker.processPublishReminder 在多次调度（时间推进）中
 * 对同一 item 必须「恰一次」产生 PUBLISH_REMINDER 通知：
 *   1) 一旦超时未发布被提醒，reminded 被置位为 true；
 *   2) 后续任意次数、任意更晚时间的再次扫描都不再命中（reminded=false 过滤），不重复提醒；
 *   3) 仅在写入 StoreNotification 成功（同事务）后才置 reminded=true；
 *   4) 已标记发布（publishedPlatforms 非空）或未到时长门槛的项不会被提醒。
 *
 * **Validates: Requirements 8.3**
 *
 * 测试手段：对 @/lib/db 的 prisma 做内存桩——publishQueueItem.findMany 返回 reminded=false 的项，
 * $transaction 执行回调，回调内 storeNotification.create 追加通知、publishQueueItem.update 置 reminded=true，
 * 直接改动内存行（同事务原子语义）。bullmq Worker / redis / logger 做空桩，避免模块加载时连接外部依赖。
 * 不依赖真实数据库、真实 Redis、真实通知通道，无 fallback、无伪造数据。
 */

// ========================
// 内存数据库状态（vi.hoisted 保证 mock 工厂可引用）
// ========================
const db = vi.hoisted(() => ({
  // PublishQueueItem 行（被测通过 reminded=true 标记“已提醒”）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  items: [] as any[],
  // 已写入的 StoreNotification（PUBLISH_REMINDER）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  notifications: [] as any[],
  notifSeq: 0,
}))

// Mock Prisma：findMany 仅实现 where.reminded 过滤（与被测查询一致），
// $transaction 执行回调并提供 storeNotification.create + publishQueueItem.update 内存桩。
vi.mock('@/lib/shared/db', () => {
  const txStoreNotificationCreate = vi.fn(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ({ data }: any) => {
      const row = { id: `sn_${db.notifSeq++}`, createdAt: new Date(), read: false, ...data }
      db.notifications.push(row)
      return { ...row }
    }
  )
  const txPublishQueueItemUpdate = vi.fn(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ({ where, data }: any) => {
      const item = db.items.find((i) => i.id === where.id)
      if (!item) throw new Error(`publishQueueItem 不存在: ${where.id}`)
      Object.assign(item, data)
      return { ...item }
    }
  )
  const tx = {
    storeNotification: { create: txStoreNotificationCreate },
    publishQueueItem: { update: txPublishQueueItemUpdate },
  }
  return {
    prisma: {
      publishQueueItem: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        findMany: vi.fn(async ({ where }: any) => {
          const wantReminded = where?.reminded
          return db.items
            .filter((i) => (wantReminded === undefined ? true : i.reminded === wantReminded))
            // 返回浅拷贝，强制被测只能通过 update 改动“数据库”内存行
            .map((i) => ({ ...i }))
        }),
      },
      storeNotification: { create: txStoreNotificationCreate },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: vi.fn(async (cb: any) => cb(tx)),
    },
  }
})

// bullmq 空桩：避免模块加载时 new Worker(...) 连接 Redis
vi.mock('bullmq', () => {
  class FakeWorker {
    on() {
      return this
    }
  }
  return { Worker: FakeWorker }
})

// redis 空桩：被测仅作为 connection 透传，不实际连接
vi.mock('@/lib/shared/redis', () => ({ redis: {} }))

// logger 空桩：抑制日志噪声
vi.mock('@/lib/shared/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// 资产过期提醒相关依赖空桩：worker 模块顶层会导入，但本测试不触发该分支
vi.mock('@/lib/shared/asset-lifecycle-service', () => ({
  getExpiringAssets: vi.fn(async () => []),
  getRemainingDays: vi.fn(() => 0),
}))
vi.mock('@/lib/shared/notification-service', () => ({
  createAssetExpiringNotification: vi.fn(async () => ({})),
}))

// 动态导入以确保 mock 生效
const { processPublishReminder } = await import('@/workers/notification-worker')

// 假 Job（被测仅读取 job.id 用于日志）
const fakeJob = { id: 'prop30-job' } as unknown as Parameters<typeof processPublishReminder>[0]

const MS_PER_HOUR = 60 * 60 * 1000

// ========================
// Arbitraries
// ========================

// 基准导出时间（固定锚点，时间推进相对此点计算）
const EXPORTED_AT = new Date('2026-06-01T00:00:00.000Z')

/** 单个待发布清单项场景 */
const itemArb = fc.record({
  id: fc.uuid(),
  storeId: fc.uuid(),
  contentBriefId: fc.uuid(),
  remindAfterH: fc.integer({ min: 1, max: 72 }),
  // 是否已标记发布（已发布的项绝不应被提醒）
  published: fc.boolean(),
})

/**
 * 多项 + 多次调度场景：
 * - items：若干清单项，初始 reminded=false；
 * - advanceHours：一组“时间推进”的小时偏移（相对 EXPORTED_AT），升序模拟多次定时调度。
 */
const scenarioArb = fc.record({
  items: fc.uniqueArray(itemArb, {
    minLength: 1,
    maxLength: 8,
    selector: (i) => i.id,
  }),
  // 多次调度的时间点（小时），至少 1 次；覆盖未超时与已超时两侧
  advanceHours: fc.array(fc.integer({ min: 0, max: 200 }), { minLength: 1, maxLength: 6 }),
})

// ========================
// Property 30: 超时提醒恰一次
// ========================

describe('Property 30: 超时提醒恰一次', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('多次调度（时间推进）下，同一超时未发布项仅产生一次 PUBLISH_REMINDER，置位后不再重复', async () => {
    /**
     * **Validates: Requirements 8.3**
     */
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ items, advanceHours }) => {
        // ── 每次迭代重置内存状态 ──
        db.items = items.map((it) => ({
          id: it.id,
          storeId: it.storeId,
          contentBriefId: it.contentBriefId,
          exportedAt: EXPORTED_AT,
          remindAfterH: it.remindAfterH,
          // 已发布则 publishedPlatforms 含一条，否则为空数组
          publishedPlatforms: it.published
            ? [{ platform: 'DOUYIN', publishedAt: EXPORTED_AT.toISOString() }]
            : [],
          reminded: false,
        }))
        db.notifications = []
        db.notifSeq = 0

        // 升序时间点，模拟定时任务多次调度、时间不断推进
        const schedule = [...advanceHours].sort((a, b) => a - b)

        for (const h of schedule) {
          const now = EXPORTED_AT.getTime() + h * MS_PER_HOUR
          await processPublishReminder(fakeJob, now)
        }

        // 最终推进到足够晚（远超任何 remindAfterH），确认不会再追加重复提醒
        const farFuture = EXPORTED_AT.getTime() + 1000 * MS_PER_HOUR
        await processPublishReminder(fakeJob, farFuture)
        await processPublishReminder(fakeJob, farFuture)

        // ── 断言 1：每个项的 PUBLISH_REMINDER 通知数为 0 或 1（恰一次，绝不重复）──
        for (const it of items) {
          const count = db.notifications.filter((n) => n.storeId === it.storeId).length
          expect(count).toBeLessThanOrEqual(1)
        }

        // ── 断言 2：已标记发布的项永远不被提醒（count=0 且 reminded 保持 false）──
        for (const it of items) {
          if (it.published) {
            const count = db.notifications.filter((n) => n.storeId === it.storeId).length
            expect(count).toBe(0)
            const row = db.items.find((r) => r.id === it.id)
            expect(row.reminded).toBe(false)
          }
        }

        // ── 断言 3：未发布的项，最终（已远超时长门槛）必恰好被提醒一次且 reminded 置位 ──
        for (const it of items) {
          if (!it.published) {
            const count = db.notifications.filter((n) => n.storeId === it.storeId).length
            expect(count).toBe(1)
            const row = db.items.find((r) => r.id === it.id)
            expect(row.reminded).toBe(true)
          }
        }

        // ── 断言 4：通知总数 = 未发布项数（每个未发布项恰一次）──
        const unpublishedCount = items.filter((i) => !i.published).length
        expect(db.notifications.length).toBe(unpublishedCount)

        // ── 断言 5：所有通知类型均为 PUBLISH_REMINDER ──
        for (const n of db.notifications) {
          expect(n.type).toBe('PUBLISH_REMINDER')
          expect(typeof n.actionHref).toBe('string')
          expect(n.actionHref.length).toBeGreaterThan(0)
        }
      }),
      { numRuns: 200 }
    )
  })

  it('reminded 置位后，即使时间继续推进也不再命中扫描（恰一次的关键不变式）', async () => {
    /**
     * **Validates: Requirements 8.3**
     *
     * 单项聚焦验证：一旦在某次调度被提醒（reminded=true），
     * 后续任意更晚时间的扫描都不再产生新的通知。
     */
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          id: fc.uuid(),
          storeId: fc.uuid(),
          contentBriefId: fc.uuid(),
          remindAfterH: fc.integer({ min: 1, max: 48 }),
          // 触发提醒后再追加的调度次数
          extraScans: fc.integer({ min: 1, max: 10 }),
        }),
        async ({ id, storeId, contentBriefId, remindAfterH, extraScans }) => {
          db.items = [
            {
              id,
              storeId,
              contentBriefId,
              exportedAt: EXPORTED_AT,
              remindAfterH,
              publishedPlatforms: [],
              reminded: false,
            },
          ]
          db.notifications = []
          db.notifSeq = 0

          // 第一次：刚好超过门槛 → 应提醒一次
          const firstNow = EXPORTED_AT.getTime() + (remindAfterH + 1) * MS_PER_HOUR
          await processPublishReminder(fakeJob, firstNow)
          expect(db.notifications.length).toBe(1)
          expect(db.items[0].reminded).toBe(true)

          // 后续多次推进：reminded=true 已不在扫描范围，通知数保持 1
          for (let k = 1; k <= extraScans; k++) {
            const laterNow = firstNow + k * remindAfterH * MS_PER_HOUR
            await processPublishReminder(fakeJob, laterNow)
          }
          expect(db.notifications.length).toBe(1)
        }
      ),
      { numRuns: 200 }
    )
  })
})
