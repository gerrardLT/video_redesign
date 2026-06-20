/**
 * SSE Event Serializer 属性测试
 *
 * 使用 fast-check 对 event-serializer 模块进行属性验证，
 * 覆盖 Progress_Event 结构完整性、序列化 Round-Trip、终态事件映射、Channel 路由正确性。
 */

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { serialize, buildChannel } from '@/lib/sse/event-serializer'
import type { ProgressEventPayload, TaskType } from '@/lib/sse/types'

// ─── Helpers ────────────────────────────────────────────────────────────────────

/** 从 SSE 格式字符串中提取 data 行内容 */
function extractDataLine(sseMessage: string): string | null {
  const lines = sseMessage.split('\n')
  for (const line of lines) {
    if (line.startsWith('data: ')) return line.slice(6)
  }
  return null
}

// ─── Arbitraries ────────────────────────────────────────────────────────────────

const taskTypeArb = fc.constantFrom('generation', 'parse', 'character', 'merge', 'chain') as fc.Arbitrary<TaskType>
const eventTypeArb = fc.constantFrom('state_change', 'progress_update', 'completed', 'failed', 'chain_group_failed')

const progressEventArb: fc.Arbitrary<ProgressEventPayload> = fc.record({
  taskId: fc.uuid(),
  taskType: taskTypeArb,
  eventType: eventTypeArb,
  timestamp: fc.date({ noInvalidDate: true }).map(d => d.toISOString()),
  progress: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
  estimatedRemainingSeconds: fc.option(fc.integer({ min: 0, max: 3600 }), { nil: undefined }),
  stage: fc.option(fc.constantFrom('QUEUED', 'SUBMITTED', 'GENERATING', 'SPLITTING', 'MERGING'), { nil: undefined }),
}).map(r => {
  const result: any = { taskId: r.taskId, taskType: r.taskType, eventType: r.eventType, timestamp: r.timestamp }
  if (r.progress !== undefined) result.progress = r.progress
  if (r.estimatedRemainingSeconds !== undefined) result.estimatedRemainingSeconds = r.estimatedRemainingSeconds
  if (r.stage !== undefined) result.stage = r.stage
  return result as ProgressEventPayload
})

// ─── Property 4: Progress_Event 结构完整性 ──────────────────────────────────────

describe('Feature: realtime-progress-push, Property 4: Progress_Event 结构完整性', () => {
  /**
   * **Validates: Requirements 6.1, 6.2, 6.4**
   *
   * 对任意合法 ProgressEventPayload，序列化后的 SSE 消息 data 字段：
   * - 是合法 JSON
   * - 包含所有必填字段 (taskId, taskType, eventType, timestamp)
   * - 若 progress 字段存在，值在 0-100 之间
   */
  it('序列化后的 data 字段包含所有必填字段，progress 在 0-100 范围内', () => {
    fc.assert(
      fc.property(progressEventArb, fc.nat({ max: 10000 }), (event, eventId) => {
        const sseMessage = serialize(event, eventId)
        const dataStr = extractDataLine(sseMessage)

        // data 行必须存在
        expect(dataStr).not.toBeNull()

        // 必须是合法 JSON
        const parsed = JSON.parse(dataStr!)

        // 包含所有必填字段
        expect(parsed).toHaveProperty('taskId')
        expect(parsed).toHaveProperty('taskType')
        expect(parsed).toHaveProperty('eventType')
        expect(parsed).toHaveProperty('timestamp')

        // 必填字段类型验证
        expect(typeof parsed.taskId).toBe('string')
        expect(typeof parsed.taskType).toBe('string')
        expect(typeof parsed.eventType).toBe('string')
        expect(typeof parsed.timestamp).toBe('string')

        // progress 范围验证
        if (parsed.progress !== undefined) {
          expect(parsed.progress).toBeGreaterThanOrEqual(0)
          expect(parsed.progress).toBeLessThanOrEqual(100)
        }
      }),
      { numRuns: 200 }
    )
  })
})

// ─── Property 5: SSE 序列化 Round-Trip ──────────────────────────────────────────

describe('Feature: realtime-progress-push, Property 5: SSE 序列化 Round-Trip', () => {
  /**
   * **Validates: Requirements 6.4**
   *
   * 对任意合法 ProgressEventPayload，序列化为 SSE 格式后，
   * 从 data 行提取 JSON 并解析，结果应与原始 payload 深度相等。
   */
  it('serialize → extractDataLine → JSON.parse 应与原始 payload 等价', () => {
    fc.assert(
      fc.property(progressEventArb, fc.nat({ max: 10000 }), (event, eventId) => {
        const sseMessage = serialize(event, eventId)
        const dataStr = extractDataLine(sseMessage)

        expect(dataStr).not.toBeNull()

        const parsed = JSON.parse(dataStr!)

        // Round-trip 验证：解析后应与原始 payload 深度相等
        expect(parsed).toEqual(event)
      }),
      { numRuns: 200 }
    )
  })
})

// ─── Property 9: 终态事件映射正确性 ─────────────────────────────────────────────

describe('Feature: realtime-progress-push, Property 9: 终态事件映射正确性', () => {
  /**
   * **Validates: Requirements 6.3**
   *
   * - eventType='completed' 代表 SUCCEEDED 状态
   * - eventType='failed' 代表 FAILED 状态
   */

  const completedEventArb: fc.Arbitrary<ProgressEventPayload> = progressEventArb.map(e => ({
    ...e,
    eventType: 'completed',
  }))

  const failedEventArb: fc.Arbitrary<ProgressEventPayload> = progressEventArb.map(e => ({
    ...e,
    eventType: 'failed',
  }))

  it('eventType=completed 的事件序列化后映射为 SUCCEEDED 状态', () => {
    fc.assert(
      fc.property(completedEventArb, fc.nat({ max: 10000 }), (event, eventId) => {
        const sseMessage = serialize(event, eventId)
        const dataStr = extractDataLine(sseMessage)
        const parsed = JSON.parse(dataStr!)

        // completed eventType 代表 SUCCEEDED 状态
        expect(parsed.eventType).toBe('completed')
      }),
      { numRuns: 200 }
    )
  })

  it('eventType=failed 的事件序列化后映射为 FAILED 状态', () => {
    fc.assert(
      fc.property(failedEventArb, fc.nat({ max: 10000 }), (event, eventId) => {
        const sseMessage = serialize(event, eventId)
        const dataStr = extractDataLine(sseMessage)
        const parsed = JSON.parse(dataStr!)

        // failed eventType 代表 FAILED 状态
        expect(parsed.eventType).toBe('failed')
      }),
      { numRuns: 200 }
    )
  })
})

// ─── Property 6: Channel 路由正确性 ─────────────────────────────────────────────

describe('Feature: realtime-progress-push, Property 6: Channel 路由正确性', () => {
  /**
   * **Validates: Requirements 1.3, 4.1, 4.3, 4.4, 4.5**
   *
   * 对任意 userId/taskType/taskId 组合：
   * - 生成的 channel 名为 `progress:{userId}:{taskType}:{taskId}`
   * - `progress:{userId}:*` 模式能匹配（使用 startsWith 检查）
   */
  it('buildChannel 生成正确格式的频道名，且 progress:{userId}:* 模式能匹配', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        taskTypeArb,
        fc.uuid(),
        (userId, taskType, taskId) => {
          const channel = buildChannel(userId, taskType, taskId)

          // 验证格式为 progress:{userId}:{taskType}:{taskId}
          expect(channel).toBe(`progress:${userId}:${taskType}:${taskId}`)

          // 验证 progress:{userId}:* 模式匹配（startsWith 检查）
          const pattern = `progress:${userId}:`
          expect(channel.startsWith(pattern)).toBe(true)
        }
      ),
      { numRuns: 200 }
    )
  })
})
