/**
 * Property-Based Test: ShotSchema Zod 校验 Round-Trip
 * Feature: production-reliability, Property 5: Zod Schema 校验 Round-Trip
 *
 * Validates: Requirements 10.1
 */
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { ShotSchema } from '@/lib/shot-schema'

// 生成符合 ShotSchema 的有效 shot 对象的 Arbitrary
const validShotArb = fc.record({
  orderIndex: fc.nat({ max: 100 }),
  startTime: fc.double({ min: 0, max: 500, noNaN: true, noDefaultInfinity: true }),
  endTime: fc.double({ min: 0.1, max: 600, noNaN: true, noDefaultInfinity: true }),
  scene: fc.string({ minLength: 1, maxLength: 200 }),
  shotType: fc.constantFrom('特写', '近景', '中景', '全景', '远景'),
  cameraMove: fc.constantFrom('固定', '推', '拉', '摇', '移', '跟随', '环绕'),
  dialogue: fc.array(
    fc.record({
      speaker: fc.string({ minLength: 1, maxLength: 20 }),
      text: fc.string({ minLength: 1, maxLength: 100 }),
    }),
    { maxLength: 3 }
  ),
  audioDesc: fc.string({ maxLength: 100 }),
  characters: fc.array(
    fc.record({
      name: fc.string({ minLength: 1, maxLength: 20 }),
      appearance: fc.string({ minLength: 1, maxLength: 100 }),
    }),
    { maxLength: 3 }
  ),
  suggestedPrompt: fc.string({ minLength: 1, maxLength: 500 }),
  hasFace: fc.boolean(),
}).filter(shot => shot.endTime > shot.startTime)

describe('ShotSchema Zod 校验 Round-Trip 属性测试', () => {
  it('Property 5: 有效 shot 对象经过 ShotSchema.parse() 后原值通过、不丢失字段', () => {
    fc.assert(
      fc.property(validShotArb, (shot) => {
        const result = ShotSchema.safeParse(shot)
        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.orderIndex).toBe(shot.orderIndex)
          expect(result.data.startTime).toBe(shot.startTime)
          expect(result.data.endTime).toBe(shot.endTime)
          expect(result.data.scene).toBe(shot.scene)
          expect(result.data.shotType).toBe(shot.shotType)
          expect(result.data.cameraMove).toBe(shot.cameraMove)
          expect(result.data.suggestedPrompt).toBe(shot.suggestedPrompt)
          expect(result.data.hasFace).toBe(shot.hasFace)
          expect(result.data.dialogue).toEqual(shot.dialogue)
          expect(result.data.characters).toEqual(shot.characters)
        }
      }),
      { numRuns: 100 }
    )
  })
})
