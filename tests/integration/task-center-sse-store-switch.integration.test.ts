/**
 * 集成测试 16.5：任务中心 SSE 实时刷新 与 门店切换上下文保持
 *
 * 验证：
 *  - SSE 骨干（progress-publisher → Redis Pub/Sub）真实发布→订阅可达，任务中心据此近实时刷新（需求 9.2）；
 *  - 门店切换以统一 userId/currentStoreId 作用域聚合，跨店看板逐店真实聚合、上下文一致（需求 10.2）。
 *
 * 真实接口：真实 Redis Pub/Sub + 真实 prisma 聚合。不 mock 业务流程。
 *
 * 运行前置（否则 skipped）：
 *   RUN_INTEGRATION=1、INTEGRATION_REDIS_READY=1（操作者确认 Redis 可连）
 *   DATABASE_URL、INTEGRATION_USER_ID（真实商家用户）
 */

import { describe, it, expect } from 'vitest'
import { integrationEnabled, skipReason, env } from './_integration-gate'

const REQUIRED = ['DATABASE_URL', 'INTEGRATION_USER_ID', 'INTEGRATION_REDIS_READY']
const enabled = integrationEnabled(REQUIRED)

describe.skipIf(!enabled)('集成16.5 任务中心 SSE 实时刷新 + 门店切换上下文', () => {
  if (!enabled) {
    console.info(`[integration 16.5] skipped: ${skipReason(REQUIRED)}`)
  }

  it('SSE 骨干：进度事件经 Redis Pub/Sub 真实发布→订阅可达（近实时刷新依据，需求 9.2）', async () => {
    const { redis } = await import('@/lib/redis')
    const { publishStateChange } = await import('@/lib/progress-publisher')
    const { buildChannel } = await import('@/lib/sse/event-serializer')

    const userId = env('INTEGRATION_USER_ID')
    const taskType = 'parse' as const
    const taskId = `integration-sse-${Date.now()}`
    const channel = buildChannel(userId, taskType, taskId)

    // 独立订阅连接，验证真实 pub/sub 往返
    const sub = redis.duplicate()
    try {
      const received = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('SSE 事件接收超时')), 8000)
        sub.on('message', (ch: string, msg: string) => {
          if (ch === channel) {
            clearTimeout(timer)
            resolve(msg)
          }
        })
      })
      await sub.subscribe(channel)

      // 真实发布一条状态变更事件
      await publishStateChange(userId, taskType, taskId, 'GENERATING', 42)

      const raw = await received
      const event = JSON.parse(raw)
      expect(event.taskId).toBe(taskId)
      expect(event.eventType).toBe('state_change')
      expect(event.stage).toBe('GENERATING')
      expect(event.progress).toBe(42)
    } finally {
      await sub.unsubscribe(channel).catch(() => undefined)
      sub.disconnect()
    }
  }, 30_000)

  it('门店切换上下文：getStoreSwitcher / getCrossStoreDashboard 按 userId 作用域真实聚合且一致', async () => {
    const { getStoreSwitcher, getCrossStoreDashboard } = await import('@/lib/cross-store-service')
    const userId = env('INTEGRATION_USER_ID')

    const switcher = await getStoreSwitcher({ userId })
    const dashboard = await getCrossStoreDashboard({ userId })

    expect(Array.isArray(dashboard)).toBe(true)
    // 看板每店 KPI 为真实聚合结构（非占位）
    for (const kpi of dashboard) {
      expect(typeof kpi.storeId).toBe('string')
      expect(typeof kpi.weeklyCompletion.total).toBe('number')
      expect(typeof kpi.todoCount).toBe('number')
    }

    // 上下文一致：切换器可见多店时，其门店集合应为看板门店集合的子集（同一 userId 作用域）
    if (switcher.multiStore) {
      const dashIds = new Set(dashboard.map((k) => k.storeId))
      for (const s of switcher.stores) {
        expect(dashIds.has(s.storeId)).toBe(true)
      }
    }
  }, 60_000)
})
