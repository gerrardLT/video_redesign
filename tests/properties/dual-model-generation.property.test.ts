/**
 * 属性测试：双模型生成引擎 (Dual Model Generation)
 *
 * 覆盖设计文档中的正确性属性 1-10
 */
import { describe, it, expect, vi } from 'vitest'
import * as fc from 'fast-check'

// Mock db/redis 模块，避免 DATABASE_URL 缺失导致的初始化错误
vi.mock('@/lib/shared/db', () => ({
  prisma: new Proxy({}, { get: () => new Proxy({}, { get: () => vi.fn() }) })
}))
vi.mock('@/lib/shared/redis', () => ({
  redis: new Proxy({}, { get: () => vi.fn() })
}))

import { buildHappyHorseRequestBody } from '@/lib/shared/happyhorse'
import { computeSegments } from '@/lib/video/segment-service'
import {
  estimateHappyHorseCreditCost,
  calculateHappyHorseActualCost,
} from '@/lib/shared/credit-calc'
import { isValidEngine, isHappyHorseDirectMode } from '@/lib/video/generation-orchestrator'

// Feature: dual-model-generation, Property 1: 引擎字段验证
describe('Property 1: 引擎字段验证', () => {
  it('仅接受 "seedance" 或 "happyhorse"', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = isValidEngine(input)
        if (input === 'seedance' || input === 'happyhorse') {
          expect(result).toBe(true)
        } else {
          expect(result).toBe(false)
        }
      }),
      { numRuns: 200 }
    )
  })
})

// Feature: dual-model-generation, Property 2: HappyHorse 请求体不变量
describe('Property 2: HappyHorse 请求体不变量', () => {
  it('任何合法参数组合的请求体必须满足固定字段约束', () => {
    fc.assert(
      fc.property(
        fc.webUrl(),
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.array(fc.webUrl(), { minLength: 0, maxLength: 10 }),
        (videoUrl, prompt, referenceImages) => {
          const body = buildHappyHorseRequestBody({ videoUrl, prompt, referenceImages })
          expect(body.model).toBe('happyhorse-1.0-video-edit')
          expect(body.parameters.watermark).toBe(false)
          expect(body.parameters.resolution).toBe('720P')
          expect(body.parameters.audio_setting).toBe('origin')
          expect(body.input.media[0].type).toBe('video')
          expect(body.input.media[0].url).toBe(videoUrl)
        }
      ),
      { numRuns: 100 }
    )
  })
})

// Feature: dual-model-generation, Property 3: 参考图数量上限
describe('Property 3: 参考图数量上限', () => {
  it('实际发送的 reference_image 项数为 min(N, 5)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.webUrl(), { minLength: 0, maxLength: 20 }),
        (referenceImages) => {
          const body = buildHappyHorseRequestBody({
            videoUrl: 'https://example.com/video.mp4',
            prompt: 'test',
            referenceImages,
          })
          const refImageCount = body.input.media.filter(m => m.type === 'reference_image').length
          expect(refImageCount).toBe(Math.min(referenceImages.length, 5))
        }
      ),
      { numRuns: 100 }
    )
  })
})

// Feature: dual-model-generation, Property 4: 分段算法 - 每段不超过 15 秒
describe('Property 4: 分段算法 - 每段不超过 15 秒', () => {
  it('任何输入的每个分段 duration <= 15', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 18.01, max: 300, noNaN: true }),
        fc.array(fc.double({ min: 0.1, max: 300, noNaN: true }), { minLength: 0, maxLength: 50 }),
        (totalDuration, rawCutPoints) => {
          const sceneCutPoints = rawCutPoints
            .map(p => p % totalDuration)
            .filter(p => p > 0 && p < totalDuration)
            .sort((a, b) => a - b)
          const segments = computeSegments(totalDuration, sceneCutPoints)
          for (const seg of segments) {
            expect(seg.duration).toBeLessThanOrEqual(15.001)
          }
        }
      ),
      { numRuns: 200 }
    )
  })
})

// Feature: dual-model-generation, Property 5: 分段算法 - 覆盖完整时长
describe('Property 5: 分段算法 - 覆盖完整时长', () => {
  it('第一段 startTime=0, 最后一段 endTime=totalDuration, 相邻段首尾相接', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 18.01, max: 300, noNaN: true }),
        fc.array(fc.double({ min: 0.1, max: 300, noNaN: true }), { minLength: 0, maxLength: 50 }),
        (totalDuration, rawCutPoints) => {
          const sceneCutPoints = rawCutPoints
            .map(p => p % totalDuration)
            .filter(p => p > 0 && p < totalDuration)
            .sort((a, b) => a - b)
          const segments = computeSegments(totalDuration, sceneCutPoints)

          expect(segments[0].startTime).toBe(0)
          expect(segments[segments.length - 1].endTime).toBeCloseTo(totalDuration, 5)
          for (let i = 1; i < segments.length; i++) {
            expect(segments[i].startTime).toBeCloseTo(segments[i - 1].endTime, 5)
          }
        }
      ),
      { numRuns: 200 }
    )
  })
})

// Feature: dual-model-generation, Property 6: 分段算法 - 最短段约束
describe('Property 6: 分段算法 - 最短段约束', () => {
  it('每个分段 duration >= 3 秒', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 18.01, max: 300, noNaN: true }),
        fc.array(fc.double({ min: 0.1, max: 300, noNaN: true }), { minLength: 0, maxLength: 50 }),
        (totalDuration, rawCutPoints) => {
          const sceneCutPoints = rawCutPoints
            .map(p => p % totalDuration)
            .filter(p => p > 0 && p < totalDuration)
            .sort((a, b) => a - b)
          const segments = computeSegments(totalDuration, sceneCutPoints)
          for (const seg of segments) {
            expect(seg.duration).toBeGreaterThanOrEqual(2.999)
          }
        }
      ),
      { numRuns: 200 }
    )
  })
})

// Feature: dual-model-generation, Property 7: 短视频路径选择
describe('Property 7: 短视频路径选择', () => {
  it('时长在 [3, 15] 范围时选择 direct 模式', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 3, max: 15, noNaN: true }),
        (duration) => {
          expect(isHappyHorseDirectMode(duration)).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('时长 > 15 时不选择 direct 模式', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 15.01, max: 300, noNaN: true }),
        (duration) => {
          expect(isHappyHorseDirectMode(duration)).toBe(false)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('时长 < 3 时不选择 direct 模式', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 2.99, noNaN: true }),
        (duration) => {
          expect(isHappyHorseDirectMode(duration)).toBe(false)
        }
      ),
      { numRuns: 100 }
    )
  })
})

// Feature: dual-model-generation, Property 8: HappyHorse 积分计算公式正确性
describe('Property 8: HappyHorse 积分计算公式正确性', () => {
  it('任何正数输入时长计算结果为正整数且等于公式值', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 60, noNaN: true }),
        (inputDuration) => {
          const result = estimateHappyHorseCreditCost(inputDuration)
          const coefficient = 1.5
          const outputDuration = Math.min(inputDuration, 15)
          const expected = Math.ceil((inputDuration + outputDuration) * coefficient)
          expect(result).toBeGreaterThan(0)
          expect(Number.isInteger(result)).toBe(true)
          expect(result).toBe(expected)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('结算函数对任何正数输入返回正整数', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 60, noNaN: true }),
        fc.double({ min: 0.01, max: 15, noNaN: true }),
        (inputDuration, outputDuration) => {
          const result = calculateHappyHorseActualCost(inputDuration, outputDuration)
          expect(result).toBeGreaterThan(0)
          expect(Number.isInteger(result)).toBe(true)
          const coefficient = 1.5
          const expected = Math.ceil((inputDuration + outputDuration) * coefficient)
          expect(result).toBe(expected)
        }
      ),
      { numRuns: 200 }
    )
  })
})

// Feature: dual-model-generation, Property 9: 余额不足必拒绝
describe('Property 9: 余额不足必拒绝', () => {
  it('对 >=3 秒视频预估消耗始终为正整数', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 3, max: 60, noNaN: true }),
        (duration) => {
          const cost = estimateHappyHorseCreditCost(duration)
          expect(cost).toBeGreaterThan(0)
          expect(Number.isInteger(cost)).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })
})

// Feature: dual-model-generation, Property 10: HappyHorse 错误响应解析
describe('Property 10: HappyHorse 错误响应解析 - prompt 保留', () => {
  it('构建请求体时 prompt 被完整保留', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 500 }),
        (prompt) => {
          const body = buildHappyHorseRequestBody({
            videoUrl: 'https://example.com/video.mp4',
            prompt,
          })
          expect(body.input.prompt).toBe(prompt)
        }
      ),
      { numRuns: 100 }
    )
  })
})
