import { describe, it, expect } from 'vitest'
import { resolvePeriods, periodIndexOf } from '@/lib/merchant/period-service'

/**
 * Feature: local-life-depth-enhancements
 * 内容周期口径单点服务（period-service）单元测试
 *
 * 验证：默认自然周（周一起始）、weeklyCadence 指定起始星期、resolvePeriods 升序与 count、
 * periodIndexOf 左闭右开命中与未命中、跨月/跨年边界。
 *
 * **Validates: Requirements 1.5**
 *
 * 说明：period-service 为纯本地时间计算，测试统一用 new Date(year, monthIndex, day) 构造本地 00:00，
 * 与服务内部 atLocalMidnight / addDays 的本地时区口径对齐。
 */

describe('period-service 周期口径', () => {
  describe('resolvePeriods - 默认自然周（周一起始）', () => {
    it('基准日为周三时，当前周期起始回退到本周一 00:00，结束为下周一 00:00（左闭右开）', () => {
      // 2025-01-08 为周三（2025-01-01 为周三）
      const referenceDate = new Date(2025, 0, 8)
      const periods = resolvePeriods({ weeklyCadence: undefined, referenceDate, count: 1 })

      expect(periods).toHaveLength(1)
      const current = periods[0]
      // 用 === 比较以兼容 -0（resolvePeriods 在 count=1 时 index 可能为 -0，-0 === 0 成立）
      expect(current.index === 0).toBe(true)
      // 起始为周一（2025-01-06），getDay() === 1
      expect(current.startDate.getTime()).toBe(new Date(2025, 0, 6).getTime())
      expect(current.startDate.getDay()).toBe(1)
      // 结束为右开边界下周一（2025-01-13）
      expect(current.endDate.getTime()).toBe(new Date(2025, 0, 13).getTime())
      // 周期恰好 7 天
      expect(current.endDate.getTime() - current.startDate.getTime()).toBe(7 * 24 * 60 * 60 * 1000)
      // 标签展示末日为右开边界前一天（2025-01-12）
      expect(current.label).toBe('本周(1.6-1.12)')
    })

    it.each([
      ['undefined', undefined],
      ['null', null],
      ['空数组', []],
      ['非数组', 'not-an-array'],
      ['无合法 day 字段', [{ theme: 'x' }, { day: 0 }, { day: 8 }, { day: 3.5 }]],
    ])('weeklyCadence=%s 时回退默认周一起始', (_label, weeklyCadence) => {
      const referenceDate = new Date(2025, 0, 8)
      const [current] = resolvePeriods({ weeklyCadence, referenceDate, count: 1 })
      // 周一起始
      expect(current.startDate.getDay()).toBe(1)
      expect(current.startDate.getTime()).toBe(new Date(2025, 0, 6).getTime())
    })
  })

  describe('resolvePeriods - weeklyCadence 指定起始星期', () => {
    it('取 weeklyCadence 中最早发布日（最小 day）作为内容周起始星期', () => {
      // day=4(周四) 与 day=6(周六)，取最小 4 → 周四起始
      const weeklyCadence = [
        { day: 6, theme: '探店', count: 1 },
        { day: 4, theme: '促销', count: 2 },
      ]
      const referenceDate = new Date(2025, 0, 8) // 周三
      const [current] = resolvePeriods({ weeklyCadence, referenceDate, count: 1 })

      // 距上一个周四（2025-01-02）起始
      expect(current.startDate.getDay()).toBe(4)
      expect(current.startDate.getTime()).toBe(new Date(2025, 0, 2).getTime())
      expect(current.endDate.getTime()).toBe(new Date(2025, 0, 9).getTime())
    })

    it('基准日恰为起始星期时 daysBack 为 0，当前周期从当日开始', () => {
      // 2025-01-06 为周一，周一起始
      const referenceDate = new Date(2025, 0, 6)
      const [current] = resolvePeriods({ weeklyCadence: undefined, referenceDate, count: 1 })
      expect(current.startDate.getTime()).toBe(new Date(2025, 0, 6).getTime())
    })
  })

  describe('resolvePeriods - 升序与 count', () => {
    it('返回长度等于 count，且按时间升序排列（index 从负到 0）', () => {
      const referenceDate = new Date(2025, 0, 8)
      const periods = resolvePeriods({ weeklyCadence: undefined, referenceDate, count: 3 })

      expect(periods).toHaveLength(3)
      expect(periods.map((p) => p.index)).toEqual([-2, -1, 0])

      // 时间严格升序，相邻周期间隔 7 天，且左周期 endDate === 右周期 startDate（连续无缝）
      for (let i = 0; i < periods.length - 1; i++) {
        expect(periods[i].startDate.getTime()).toBeLessThan(periods[i + 1].startDate.getTime())
        expect(periods[i].endDate.getTime()).toBe(periods[i + 1].startDate.getTime())
      }

      // 当前周期（index 0）在末尾
      expect(periods[periods.length - 1].index).toBe(0)
      expect(periods[2].startDate.getTime()).toBe(new Date(2025, 0, 6).getTime())
    })

    it.each([0, -1, 1.5, NaN])('非法 count=%s 时回退为 1 个周期', (count) => {
      const referenceDate = new Date(2025, 0, 8)
      const periods = resolvePeriods({ weeklyCadence: undefined, referenceDate, count })
      expect(periods).toHaveLength(1)
      expect(periods[0].index === 0).toBe(true)
    })
  })

  describe('periodIndexOf - 左闭右开命中与未命中', () => {
    const referenceDate = new Date(2025, 0, 8)
    const periods = resolvePeriods({ weeklyCadence: undefined, referenceDate, count: 3 })
    // periods: index -2 [Dec23-Dec30), -1 [Dec30-Jan6), 0 [Jan6-Jan13)

    it('日期等于周期 startDate（左闭）命中该周期', () => {
      expect(periodIndexOf(new Date(2025, 0, 6), periods)).toBe(0)
    })

    it('周期内任意日期命中', () => {
      expect(periodIndexOf(new Date(2025, 0, 6, 12, 30), periods)).toBe(0)
      expect(periodIndexOf(new Date(2025, 0, 12, 23, 59, 59), periods)).toBe(0)
    })

    it('日期等于周期 endDate（右开）不命中本周期', () => {
      // 2025-01-13 为 index 0 的右开边界，不属于任何给定周期（未来周期未包含）
      expect(periodIndexOf(new Date(2025, 0, 13), periods)).toBeNull()
    })

    it('早于最早周期或晚于最新周期的日期返回 null（不臆造归属）', () => {
      expect(periodIndexOf(new Date(2024, 11, 22), periods)).toBeNull() // 早于 Dec23
      expect(periodIndexOf(new Date(2025, 0, 20), periods)).toBeNull() // 晚于 Jan13
    })

    it('命中历史周期返回对应负 index', () => {
      expect(periodIndexOf(new Date(2024, 11, 23), periods)).toBe(-2)
      expect(periodIndexOf(new Date(2024, 11, 29, 23, 0), periods)).toBe(-2)
    })
  })

  describe('跨月/跨年边界', () => {
    it('count 回溯跨年：当前周期在 1 月，历史周期落在上一年 12 月', () => {
      const referenceDate = new Date(2025, 0, 8) // 2025-01-08
      const periods = resolvePeriods({ weeklyCadence: undefined, referenceDate, count: 3 })

      // index -2 起始为 2024-12-23
      expect(periods[0].startDate.getTime()).toBe(new Date(2024, 11, 23).getTime())
      expect(periods[0].startDate.getFullYear()).toBe(2024)
      // index -1 周期跨年：2024-12-30 至 2025-01-06
      expect(periods[1].startDate.getTime()).toBe(new Date(2024, 11, 30).getTime())
      expect(periods[1].endDate.getTime()).toBe(new Date(2025, 0, 6).getTime())
    })

    it('periodIndexOf 命中跨年周期：2025-01-02 落在 [2024-12-30, 2025-01-06) 周期', () => {
      const referenceDate = new Date(2025, 0, 8)
      const periods = resolvePeriods({ weeklyCadence: undefined, referenceDate, count: 3 })
      expect(periodIndexOf(new Date(2025, 0, 2), periods)).toBe(-1)
    })

    it('跨月边界：当前周期在 2 月，上一周期落在 1 月', () => {
      // 2025-02-03 为周一
      const referenceDate = new Date(2025, 1, 3)
      const periods = resolvePeriods({ weeklyCadence: undefined, referenceDate, count: 2 })

      expect(periods.map((p) => p.index)).toEqual([-1, 0])
      // 上一周期起始为 2025-01-27（周一），跨月
      expect(periods[0].startDate.getTime()).toBe(new Date(2025, 0, 27).getTime())
      expect(periods[0].startDate.getMonth()).toBe(0) // 1 月
      expect(periods[0].endDate.getTime()).toBe(new Date(2025, 1, 3).getTime())
      // 当前周期起始为 2025-02-03
      expect(periods[1].startDate.getTime()).toBe(new Date(2025, 1, 3).getTime())
      expect(periods[1].startDate.getMonth()).toBe(1) // 2 月
    })
  })
})
