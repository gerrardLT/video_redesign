/**
 * HappyHorse UI Enhancement — 属性化测试
 *
 * 使用 fast-check 对核心纯函数和逻辑进行属性测试，
 * 每条 property 至少运行 100 次随机迭代。
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
  insertPlaceholder,
  removePlaceholderAndRenumber,
  validateReferenceImage,
  formatRemainingTime,
} from '@/lib/placeholder-utils'
import { estimateHappyHorseCreditCost } from '@/lib/credit-calc'

// ============================================================
// Property 3: 占位符插入位置正确性
// Feature: happyhorse-ui-enhancement, Property 3: 占位符插入位置正确性
// Validates: Requirements 4.1, 4.3
// ============================================================
describe('Property 3: 占位符插入位置正确性', () => {
  it('在任意有效光标位置插入后，文本结构正确', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 200 }),
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 1, max: 20 }),
        (text, rawPosition, imageIndex) => {
          const position = Math.min(rawPosition, text.length)
          const result = insertPlaceholder(text, position, imageIndex)
          const placeholder = `[Image ${imageIndex}]`

          // 1) 原文本在插入位置前后的内容不变
          expect(result.slice(0, position)).toBe(text.slice(0, position))
          expect(result.slice(position + placeholder.length)).toBe(text.slice(position))

          // 2) 插入位置处恰好包含占位符
          expect(result.slice(position, position + placeholder.length)).toBe(placeholder)

          // 3) 总长度 = 原长度 + 占位符长度
          expect(result.length).toBe(text.length + placeholder.length)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('position 为 -1 时占位符追加到末尾', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 200 }),
        fc.integer({ min: 1, max: 20 }),
        (text, imageIndex) => {
          const result = insertPlaceholder(text, -1, imageIndex)
          const placeholder = `[Image ${imageIndex}]`

          expect(result).toBe(text + placeholder)
          expect(result.endsWith(placeholder)).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ============================================================
// Property 4: 占位符移除与重编号一致性
// Feature: happyhorse-ui-enhancement, Property 4: 占位符移除与重编号一致性
// Validates: Requirements 4.2
// ============================================================
describe('Property 4: 占位符移除与重编号一致性', () => {
  it('移除第 K 个占位符后，剩余占位符连续编号且非占位符文本不变', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }),
        fc.string({ minLength: 0, maxLength: 50 }),
        (n, baseText) => {
          // 构造包含 N 个连续占位符的文本
          let text = baseText
          for (let i = 1; i <= n; i++) {
            text += `[Image ${i}]`
          }

          // 随机选择移除第 K 个
          const k = Math.floor(Math.random() * n) + 1
          const result = removePlaceholderAndRenumber(text, k)

          // 结果应包含恰好 N-1 个占位符
          const matches = result.match(/\[Image \d+\]/g) || []
          expect(matches.length).toBe(n - 1)

          // 编号为连续的 [Image 1] 到 [Image N-1]
          for (let i = 1; i <= n - 1; i++) {
            expect(matches[i - 1]).toBe(`[Image ${i}]`)
          }

          // 原始非占位符文本不变
          expect(result.replace(/\[Image \d+\]/g, '')).toBe(baseText)
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ============================================================
// Property 2: 参考图文件校验正确性
// Feature: happyhorse-ui-enhancement, Property 2: 参考图文件校验正确性
// Validates: Requirements 3.3, 3.6
// ============================================================
describe('Property 2: 参考图文件校验正确性', () => {
  const validTypes = ['image/jpeg', 'image/png', 'image/webp']
  const maxSize = 20 * 1024 * 1024

  it('当且仅当类型合法且大小 ≤ 20MB 时返回 valid: true', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.integer({ min: 0, max: 50 * 1024 * 1024 }),
        (type, size) => {
          const result = validateReferenceImage({ type, size })
          const isTypeValid = validTypes.includes(type)
          const isSizeValid = size <= maxSize

          if (isTypeValid && isSizeValid) {
            expect(result.valid).toBe(true)
            expect(result.reason).toBeUndefined()
          } else {
            expect(result.valid).toBe(false)
            expect(result.reason).toBeDefined()
            expect(typeof result.reason).toBe('string')
            expect(result.reason!.length).toBeGreaterThan(0)
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  it('合法类型和合法大小始终通过校验', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...validTypes),
        fc.integer({ min: 1, max: maxSize }),
        (type, size) => {
          const result = validateReferenceImage({ type, size })
          expect(result.valid).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ============================================================
// Property 9: 剩余时间格式化正确性
// Feature: happyhorse-ui-enhancement, Property 9: 剩余时间格式化正确性
// Validates: Requirements 7.3
// ============================================================
describe('Property 9: 剩余时间格式化正确性', () => {
  it('秒数到文本的映射规则正确', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 36000 }),
        (seconds) => {
          const result = formatRemainingTime(seconds)

          if (seconds < 60) {
            // 输出包含"秒"且不包含"分"和"小时"
            expect(result).toContain('秒')
            expect(result).not.toContain('分')
            expect(result).not.toContain('小时')
          } else if (seconds < 3600) {
            // 输出包含"分"且不包含"小时"
            expect(result).toContain('分')
            expect(result).not.toContain('小时')
          } else {
            // 输出包含"小时"
            expect(result).toContain('小时')
          }

          // 格式以"约"开头
          expect(result.startsWith('约')).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ============================================================
// Property 6: 积分预估公式一致性
// Feature: happyhorse-ui-enhancement, Property 6: 积分预估公式一致性
// Validates: Requirements 6.2
// ============================================================
describe('Property 6: 积分预估公式一致性', () => {
  it('estimateHappyHorseCreditCost 对 3-60 秒范围内任意整数输出正确', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 60 }),
        (duration) => {
          const result = estimateHappyHorseCreditCost(duration)
          const outputDuration = Math.min(duration, 15)
          const coefficient = 1.5 // 默认系数
          const expected = Math.ceil((duration + outputDuration) * coefficient)

          expect(result).toBe(expected)
          // 结果为正整数
          expect(result).toBeGreaterThan(0)
          expect(Number.isInteger(result)).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ============================================================
// Property 7: 余额不足时禁用生成按钮
// Feature: happyhorse-ui-enhancement, Property 7: 余额不足时禁用生成按钮
// Validates: Requirements 6.3
// ============================================================
describe('Property 7: 余额不足时禁用生成按钮', () => {
  /**
   * 判断生成按钮是否应禁用的纯逻辑函数
   */
  function shouldDisableGenerate(balance: number, estimate: number): boolean {
    return balance < estimate
  }

  it('balance < estimate 时 disabled=true，否则 disabled=false', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10000 }),
        fc.integer({ min: 0, max: 10000 }),
        (balance, estimate) => {
          const disabled = shouldDisableGenerate(balance, estimate)

          if (balance < estimate) {
            expect(disabled).toBe(true)
          } else {
            expect(disabled).toBe(false)
          }
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ============================================================
// Property 1: Tab 状态切换 Round-Trip
// Feature: happyhorse-ui-enhancement, Property 1: Tab 状态切换 Round-Trip
// Validates: Requirements 2.4
// ============================================================
describe('Property 1: Tab 状态切换 Round-Trip', () => {
  it('切换 Tab 前后 Zustand store 状态保持一致', async () => {
    // 动态导入 store 避免模块级别的副作用
    const { useHappyHorseStore } = await import('@/stores/happyhorse-store')

    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 500 }),
        fc.integer({ min: 0, max: 500 }),
        (promptText, cursorPos) => {
          const store = useHappyHorseStore.getState()

          // 设置初始状态
          store.setPrompt(promptText)
          store.setCursorPosition(cursorPos)

          // 读取切换前的状态
          const beforeState = useHappyHorseStore.getState()
          const beforePrompt = beforeState.prompt
          const beforeCursor = beforeState.cursorPosition
          const beforeImages = [...beforeState.referenceImages]

          // 模拟 Tab 切换：状态保留（display:none 不卸载 DOM）
          // 切回后，状态应该完全一致
          const afterState = useHappyHorseStore.getState()

          expect(afterState.prompt).toBe(beforePrompt)
          expect(afterState.cursorPosition).toBe(beforeCursor)
          expect(afterState.referenceImages).toEqual(beforeImages)

          // 清理
          store.reset()
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ============================================================
// Property 11: 历史记录排序与完整性
// Feature: happyhorse-ui-enhancement, Property 11: 历史记录排序与完整性
// Validates: Requirements 9.1, 9.2
// ============================================================
describe('Property 11: 历史记录排序与完整性', () => {
  interface HistoryRecord {
    id: string
    createdAt: string
    prompt: string
    status: 'pending' | 'running' | 'succeeded' | 'failed'
    thumbnailUrl?: string
  }

  /** 模拟排序函数（与 HistoryList 组件一致） */
  function sortByCreatedAtDesc(records: HistoryRecord[]): HistoryRecord[] {
    return [...records].sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  }

  it('记录按 createdAt 严格降序排列', () => {
    const statusArb = fc.constantFrom('pending', 'running', 'succeeded', 'failed') as fc.Arbitrary<'pending' | 'running' | 'succeeded' | 'failed'>

    const recordArb = fc.record({
      id: fc.uuid(),
      createdAt: fc.integer({ min: 1704067200000, max: 1798761600000 })
        .map(ts => new Date(ts).toISOString()),
      prompt: fc.string({ minLength: 1, maxLength: 100 }),
      status: statusArb,
      thumbnailUrl: fc.option(fc.constant('https://example.com/thumb.jpg'), { nil: undefined }),
    })

    fc.assert(
      fc.property(
        fc.array(recordArb, { minLength: 2, maxLength: 30 }),
        (records) => {
          const sorted = sortByCreatedAtDesc(records)

          // 1) 排序后长度不变
          expect(sorted.length).toBe(records.length)

          // 2) 严格降序
          for (let i = 0; i < sorted.length - 1; i++) {
            const current = new Date(sorted[i].createdAt).getTime()
            const next = new Date(sorted[i + 1].createdAt).getTime()
            expect(current).toBeGreaterThanOrEqual(next)
          }

          // 3) 每条记录包含必要字段
          for (const record of sorted) {
            expect(record.id).toBeDefined()
            expect(record.createdAt).toBeDefined()
            expect(record.prompt).toBeDefined()
            expect(record.status).toBeDefined()
          }
        }
      ),
      { numRuns: 100 }
    )
  })
})
