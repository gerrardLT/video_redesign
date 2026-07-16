/**
 * 复刻爆款接入 HappyHorse V-Edit — 纯函数单元测试
 *
 * 覆盖计划「测试计划 · 单元」中的：
 * - buildHappyHorseRequestBody：参考图截断到 5 张、media 结构、默认参数
 * - estimateHappyHorseCreditCost / calculateHappyHorseActualCost：入队冻结与结算金额
 *
 * 这些均为无 DB/无网络依赖的纯函数，直接断言，不做 mock。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { buildHappyHorseRequestBody } from '@/lib/shared/happyhorse'
import {
  estimateHappyHorseCreditCost,
  calculateHappyHorseActualCost,
} from '@/lib/shared/credit-calc'

describe('buildHappyHorseRequestBody（V-Edit 请求体构建）', () => {
  const VIDEO = 'https://oss.example.com/source.mp4?sign=abc'

  it('无参考图时 media 仅含 1 个 video', () => {
    const body = buildHappyHorseRequestBody({ videoUrl: VIDEO, prompt: '复刻这个视频' })
    expect(body.model).toBe('happyhorse-1.0-video-edit')
    expect(body.input.media).toHaveLength(1)
    expect(body.input.media[0]).toEqual({ type: 'video', url: VIDEO })
    expect(body.input.prompt).toBe('复刻这个视频')
  })

  it('参考图按顺序追加为 reference_image', () => {
    const refs = ['https://oss/1.jpg', 'https://oss/2.jpg', 'https://oss/3.jpg']
    const body = buildHappyHorseRequestBody({ videoUrl: VIDEO, prompt: 'p', referenceImages: refs })
    // 1 video + 3 reference_image
    expect(body.input.media).toHaveLength(4)
    expect(body.input.media[0].type).toBe('video')
    expect(body.input.media.slice(1).map((m) => m.url)).toEqual(refs)
    expect(body.input.media.slice(1).every((m) => m.type === 'reference_image')).toBe(true)
  })

  it('参考图超过 5 张时截断到前 5 张', () => {
    const refs = Array.from({ length: 8 }, (_, i) => `https://oss/${i}.jpg`)
    const body = buildHappyHorseRequestBody({ videoUrl: VIDEO, prompt: 'p', referenceImages: refs })
    // 1 video + 最多 5 reference_image
    expect(body.input.media).toHaveLength(6)
    const refUrls = body.input.media.slice(1).map((m) => m.url)
    expect(refUrls).toEqual(refs.slice(0, 5))
  })

  it('默认参数：720P + watermark false + audio_setting origin', () => {
    const body = buildHappyHorseRequestBody({ videoUrl: VIDEO, prompt: 'p' })
    expect(body.parameters).toEqual({
      resolution: '720P',
      watermark: false,
      audio_setting: 'origin',
    })
  })

  it('显式 audioSetting=auto 时被采用', () => {
    const body = buildHappyHorseRequestBody({ videoUrl: VIDEO, prompt: 'p', audioSetting: 'auto' })
    expect(body.parameters.audio_setting).toBe('auto')
  })
})

describe('HappyHorse 积分计算（冻结与结算）', () => {
  // 固定系数，避免依赖环境默认值，保证断言确定性
  const ORIGINAL = process.env.HAPPYHORSE_CREDIT_COEFFICIENT
  beforeEach(() => {
    process.env.HAPPYHORSE_CREDIT_COEFFICIENT = '1.5'
  })
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.HAPPYHORSE_CREDIT_COEFFICIENT
    else process.env.HAPPYHORSE_CREDIT_COEFFICIENT = ORIGINAL
  })

  it('预估：输出时长封顶 min(input, 15)，(input+output)×系数 向上取整', () => {
    // input=10 → output=10 → (10+10)*1.5 = 30
    expect(estimateHappyHorseCreditCost(10)).toBe(30)
    // input=20 → output=min(20,15)=15 → (20+15)*1.5 = 52.5 → 53
    expect(estimateHappyHorseCreditCost(20)).toBe(53)
  })

  it('预估始终为正整数', () => {
    for (const d of [1, 3, 7, 15, 30, 60]) {
      const c = estimateHappyHorseCreditCost(d)
      expect(Number.isInteger(c)).toBe(true)
      expect(c).toBeGreaterThan(0)
    }
  })

  it('结算：(actualInput+actualOutput)×系数 向上取整', () => {
    // (12+8)*1.5 = 30
    expect(calculateHappyHorseActualCost(12, 8)).toBe(30)
    // (7+5)*1.5 = 18
    expect(calculateHappyHorseActualCost(7, 5)).toBe(18)
  })
})
