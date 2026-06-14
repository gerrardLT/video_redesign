import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  mergeTimelineScript,
  SUPPORTED_CAMERA_MOVES,
  MAX_SCRIPT_LENGTH,
  type MergeInputShot,
} from '@/lib/script-merger'

/**
 * Feature: multi-shot-merge-generation
 * 属性测试: Property 5, Property 6, Property 7 + 单 Shot 组示例测试
 *
 * 覆盖 Script_Merger（时间轴脚本合并器）的核心不变量。
 */

// ─── 生成器 ────────────────────────────────────────────────────────────────────

/** 生成非空中文字符串（模拟 prompt） */
const chineseStringArb = (minLen: number, maxLen: number) =>
  fc
    .array(
      fc.integer({ min: 0x4e00, max: 0x9fff }).map((code) => String.fromCharCode(code)),
      { minLength: minLen, maxLength: maxLen }
    )
    .map((chars) => chars.join(''))

/** 包含运镜术语的 prompt 生成器 */
const promptWithCameraMoveArb = fc
  .tuple(
    fc.constantFrom(...SUPPORTED_CAMERA_MOVES),
    chineseStringArb(2, 30)
  )
  .map(([move, body]) => `镜头${move}，${body}`)

/** 不含运镜术语的 prompt 生成器 */
const promptWithoutCameraMoveArb = chineseStringArb(5, 50).filter(
  (s) => !SUPPORTED_CAMERA_MOVES.some((m) => s.includes(m))
)

/** 超长 prompt 生成器（500+ 中文字符） */
const longPromptArb = chineseStringArb(500, 600)

/** 混合 prompt 生成器：包含/不包含运镜术语、超长 */
const mixedPromptArb = fc.oneof(
  { weight: 3, arbitrary: promptWithCameraMoveArb },
  { weight: 2, arbitrary: promptWithoutCameraMoveArb },
  { weight: 1, arbitrary: longPromptArb }
)

/**
 * 生成非空分镜组：orderIndex 从 0 起连续递增，每个 shot startTime < endTime。
 * 覆盖边界：单分镜组、多分镜组、超长 prompt、含/不含运镜术语的 prompt。
 */
const shotGroupArb = (minShots: number, maxShots: number): fc.Arbitrary<MergeInputShot[]> =>
  fc
    .array(
      fc.tuple(
        fc.double({ min: 0.5, max: 10, noNaN: true, noDefaultInfinity: true }),
        mixedPromptArb
      ),
      { minLength: minShots, maxLength: maxShots }
    )
    .map((items) => {
      let currentTime = 0
      return items.map(([duration, prompt], idx) => {
        const startTime = currentTime
        const endTime = currentTime + duration
        currentTime = endTime
        return {
          orderIndex: idx,
          startTime,
          endTime,
          prompt,
        } satisfies MergeInputShot
      })
    })

/** 单分镜组生成器 */
const singleShotGroupArb = shotGroupArb(1, 1)

/** 多分镜组生成器（2-10 个分镜） */
const multiShotGroupArb = shotGroupArb(2, 10)

/** 任意非空分镜组生成器（1-10 个分镜） */
const anyShotGroupArb = shotGroupArb(1, 10)

/** 极端情况：大量分镜 + 超长 prompt（测试 500 字上限） */
const extremeShotGroupArb = fc
  .array(
    fc.tuple(
      fc.double({ min: 0.5, max: 5, noNaN: true, noDefaultInfinity: true }),
      longPromptArb
    ),
    { minLength: 10, maxLength: 20 }
  )
  .map((items) => {
    let currentTime = 0
    return items.map(([duration, prompt], idx) => {
      const startTime = currentTime
      const endTime = currentTime + duration
      currentTime = endTime
      return {
        orderIndex: idx,
        startTime,
        endTime,
        prompt,
      } satisfies MergeInputShot
    })
  })

// ─── Property 5: 时间轴分段从 0 起连续覆盖全组 ─────────────────────────────────

/**
 * Feature: multi-shot-merge-generation, Property 5: 时间轴分段从 0 起连续覆盖全组
 *
 * 首段 relStart=0，每段 relEnd 等于下一段 relStart（无空隙无重叠），
 * 末段 relEnd 等于组内各分镜时长之和，分段数等于组内分镜数（含单 Shot 组）。
 *
 * **Validates: Requirements 2.1, 2.2, 2.7**
 */
describe('Property 5: 时间轴分段从 0 起连续覆盖全组', () => {
  it('任意非空分镜组：首段 relStart=0，分段连续无空隙无重叠，末段 relEnd=总时长，分段数=分镜数', () => {
    fc.assert(
      fc.property(anyShotGroupArb, (shots) => {
        const result = mergeTimelineScript(shots)
        const { segments } = result

        // 分段数等于组内分镜数
        expect(segments).toHaveLength(shots.length)

        // 首段 relStart = 0
        expect(segments[0].relStart).toBe(0)

        // 每段 relEnd 等于下一段 relStart（无空隙无重叠）
        for (let i = 0; i < segments.length - 1; i++) {
          expect(segments[i].relEnd).toBeCloseTo(segments[i + 1].relStart, 10)
        }

        // 末段 relEnd 等于组内各分镜时长之和
        const totalDuration = shots.reduce(
          (sum, shot) => sum + (shot.endTime - shot.startTime),
          0
        )
        expect(segments[segments.length - 1].relEnd).toBeCloseTo(totalDuration, 10)
      }),
      { numRuns: 100 }
    )
  })

  it('单分镜组同样满足分段格式', () => {
    fc.assert(
      fc.property(singleShotGroupArb, (shots) => {
        const result = mergeTimelineScript(shots)
        const { segments } = result

        expect(segments).toHaveLength(1)
        expect(segments[0].relStart).toBe(0)
        expect(segments[0].relEnd).toBeCloseTo(
          shots[0].endTime - shots[0].startTime,
          10
        )
      }),
      { numRuns: 100 }
    )
  })

  it('多分镜组分段数等于分镜数', () => {
    fc.assert(
      fc.property(multiShotGroupArb, (shots) => {
        const result = mergeTimelineScript(shots)
        expect(result.segments).toHaveLength(shots.length)
      }),
      { numRuns: 100 }
    )
  })
})

// ─── Property 6: 每段运镜与动作分离且运镜术语合规 ─────────────────────────────────

/**
 * Feature: multi-shot-merge-generation, Property 6: 每段运镜与动作分离且运镜术语合规
 *
 * 每段含可区分的运镜描述与动作描述，运镜术语取自 {推,拉,摇,移,跟随,环绕,固定}。
 * 实现方式：每段 body 以"镜头{X}"开头，其中 X ∈ SUPPORTED_CAMERA_MOVES。
 *
 * **Validates: Requirements 2.3, 2.4**
 */
describe('Property 6: 每段运镜与动作分离且运镜术语合规', () => {
  it('任意非空分镜组：每段 body 以"镜头{X}"开头，X ∈ SUPPORTED_CAMERA_MOVES', () => {
    fc.assert(
      fc.property(anyShotGroupArb, (shots) => {
        const result = mergeTimelineScript(shots)

        for (const seg of result.segments) {
          // 每段 body 必须以"镜头"开头
          expect(seg.body.startsWith('镜头')).toBe(true)

          // 提取"镜头"后面的运镜术语
          const bodyAfterPrefix = seg.body.slice(2) // 去掉"镜头"
          const matchedMove = SUPPORTED_CAMERA_MOVES.find((move) =>
            bodyAfterPrefix.startsWith(move)
          )
          expect(matchedMove).toBeDefined()
        }
      }),
      { numRuns: 100 }
    )
  })

  it('含运镜术语的 prompt 产出的分段包含对应术语', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.double({ min: 1, max: 8, noNaN: true, noDefaultInfinity: true }),
            promptWithCameraMoveArb
          ),
          { minLength: 1, maxLength: 5 }
        ).map((items) => {
          let currentTime = 0
          return items.map(([duration, prompt], idx) => {
            const startTime = currentTime
            const endTime = currentTime + duration
            currentTime = endTime
            return { orderIndex: idx, startTime, endTime, prompt } satisfies MergeInputShot
          })
        }),
        (shots) => {
          const result = mergeTimelineScript(shots)

          for (const seg of result.segments) {
            // 运镜术语必须取自受支持集合
            const hasValidMove = SUPPORTED_CAMERA_MOVES.some((move) =>
              seg.body.includes(`镜头${move}`)
            )
            expect(hasValidMove).toBe(true)
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  it('不含运镜术语的 prompt 默认使用"固定"', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.double({ min: 1, max: 8, noNaN: true, noDefaultInfinity: true }),
            promptWithoutCameraMoveArb
          ),
          { minLength: 1, maxLength: 5 }
        ).map((items) => {
          let currentTime = 0
          return items.map(([duration, prompt], idx) => {
            const startTime = currentTime
            const endTime = currentTime + duration
            currentTime = endTime
            return { orderIndex: idx, startTime, endTime, prompt } satisfies MergeInputShot
          })
        }),
        (shots) => {
          const result = mergeTimelineScript(shots)

          for (const seg of result.segments) {
            // 不含运镜术语时默认为"固定"
            expect(seg.body.startsWith('镜头固定')).toBe(true)
          }
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ─── Property 7: 时间轴脚本长度上限 ────────────────────────────────────────────

/**
 * Feature: multi-shot-merge-generation, Property 7: 时间轴脚本长度上限
 *
 * 即使大量分镜（如 20 个）且每个 prompt 超长（500+中文字符），
 * text 长度不超过 MAX_SCRIPT_LENGTH（=250 中文字符）。
 *
 * **Validates: Requirements 2.6**
 */
describe('Property 7: 时间轴脚本长度上限', () => {
  it('任意分镜组：text 长度不超过 MAX_SCRIPT_LENGTH（250 中文字符）', () => {
    fc.assert(
      fc.property(anyShotGroupArb, (shots) => {
        const result = mergeTimelineScript(shots)
        expect(result.text.length).toBeLessThanOrEqual(MAX_SCRIPT_LENGTH)
      }),
      { numRuns: 100 }
    )
  })

  it('大量分镜 + 超长 prompt：text 长度仍不超过 MAX_SCRIPT_LENGTH', () => {
    fc.assert(
      fc.property(extremeShotGroupArb, (shots) => {
        const result = mergeTimelineScript(shots)
        expect(result.text.length).toBeLessThanOrEqual(MAX_SCRIPT_LENGTH)
      }),
      { numRuns: 100 }
    )
  })

  it('text 非空（至少包含一个完整分段）', () => {
    fc.assert(
      fc.property(anyShotGroupArb, (shots) => {
        const result = mergeTimelineScript(shots)
        expect(result.text.length).toBeGreaterThan(0)
      }),
      { numRuns: 100 }
    )
  })
})

// ─── 任务 3.5: 单 Shot 组分段格式示例测试 ────────────────────────────────────────

/**
 * 单 Shot 组分段格式示例测试（任务 3.5）
 *
 * 单 Shot 组输出 `0-N秒：…` 分段格式，segments 长度为 1。
 *
 * **Requirements: 2.7**
 */
describe('单 Shot 组分段格式示例测试', () => {
  it('单 Shot 组输出「镜头N：…」分段格式，segments 长度为 1', () => {
    const singleShot: MergeInputShot[] = [
      {
        orderIndex: 0,
        startTime: 0,
        endTime: 5,
        prompt: '镜头推，人物缓步走向镜头',
      },
    ]

    const result = mergeTimelineScript(singleShot)

    // segments 长度为 1
    expect(result.segments).toHaveLength(1)

    // 首段 relStart=0，relEnd=时长
    expect(result.segments[0].relStart).toBe(0)
    expect(result.segments[0].relEnd).toBe(5)

    // text 以「镜头1：」开头（镜头制，不再用精确秒数）
    expect(result.text).toMatch(/^镜头1：/)

    // body 包含运镜术语
    expect(result.segments[0].body).toContain('镜头推')
  })

  it('单 Shot 组（含非整数时长）输出镜头制分段', () => {
    const singleShot: MergeInputShot[] = [
      {
        orderIndex: 0,
        startTime: 2.5,
        endTime: 6.3,
        prompt: '镜头摇，城市天际线全景',
      },
    ]

    const result = mergeTimelineScript(singleShot)

    expect(result.segments).toHaveLength(1)
    expect(result.segments[0].relStart).toBe(0)
    expect(result.segments[0].relEnd).toBeCloseTo(3.8, 10)
    expect(result.text).toMatch(/^镜头1：/)
    expect(result.segments[0].body).toContain('镜头摇')
  })

  it('单 Shot 组（prompt 为 null）仍输出分段格式', () => {
    const singleShot: MergeInputShot[] = [
      {
        orderIndex: 0,
        startTime: 0,
        endTime: 4,
        prompt: null,
      },
    ]

    const result = mergeTimelineScript(singleShot)

    expect(result.segments).toHaveLength(1)
    expect(result.segments[0].relStart).toBe(0)
    expect(result.segments[0].relEnd).toBe(4)
    // 无 prompt 时默认使用"固定"运镜
    expect(result.segments[0].body).toContain('镜头固定')
    expect(result.text).toMatch(/^镜头1：/)
  })
})
