/**
 * 缺陷一（Bug 1+4）合并丢失 —— 探索性测试（Property 1: Bug Condition）
 *
 * 对应 spec：.kiro/specs/video-gen-output-fixes
 * 依据 design「Bug Condition / isBugCondition_1_4」与「Correctness Properties / Property 1」。
 *
 * 缺陷条件 isBugCondition_1_4(group)：
 *   merged ← mergeTimelineScript(group.shots, options)
 *   RETURN merged.droppedSegmentCount > 0
 *       OR (任一 shot.prompt 非空 但其核心语义/台词未完整出现在 merged.text)
 *
 * 本测试编码「修复后应有的期望行为」（Property 1）：
 *   - merged.droppedSegmentCount = 0
 *   - 每个非空 shot.prompt 的核心语义/`{台词}` 完整出现在 merged.text
 *
 * !!! 重要 !!!
 * 本测试**必须在未修复代码上 FAIL** —— 失败即确认缺陷存在。
 * 失败是预期的正确结果，禁止为了让它通过而修改测试或源码。
 * 修复（任务 5）落地后，本测试将自然转为 PASS（验证 Property 1）。
 *
 * 覆盖三个子触发点（design「Examples / 缺陷一」）：
 *   1) 超预算尾段被 mergeTimelineScript 贪心循环 `break` 整段丢弃；
 *   2) 单段超长被首段 `line.slice(0, budgetForTimeline)` 段内截断；
 *   3) deduplicateAgainstStyle() 正则误删 prompt 正文。
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5
 */
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { mergeTimelineScript, type MergeInputShot } from '../lib/script-merger'

/** 把一句台词包装成 Shot.dialogue 的存储格式（JSON.stringify([{speaker,text}])） */
function dialogueJson(speaker: string, text: string): string {
  return JSON.stringify([{ speaker, text }])
}

/**
 * 含 ≥1 个角色描述的全局风格前缀。
 * 故意写得较长（compressStylePrefix 会压到 ≤50 字），以压低留给时间轴的预算，
 * 还原真实链路里「风格行 + 负面约束行」挤占预算、组内分镜易被丢弃的场景。
 */
const LONG_STYLE_PREFIX =
  '国风3D动画风格，暗色调，电影级光影，高细节质感，柔和景深氛围，胶片颗粒，写实材质渲染'

describe('缺陷一（Bug 1+4）合并丢失 —— 探索性测试（Property 1: Bug Condition）', () => {
  it('子触发点 1：3 个分镜含较长 {台词}，超预算尾段不应被静默丢弃（droppedSegmentCount=0 且各段台词完整保留）', () => {
    // 3 个分镜，各含「运镜 + 核心动作 + 较长台词」，合并后超过 budgetForTimeline。
    const line1 =
      '今夜的风格外格外清冷，可我心里却燃起了前所未有的炽热火焰，再没有任何力量能够阻挡我继续前进的脚步'
    const line2 =
      '这座沉默已久的城市，终将记住我的名字和我走过的每一步，记住我曾在无边的黑暗里独自坚持到最后'
    const line3 =
      '哪怕前路布满荆棘，我也绝不会再像从前那样轻易低头认输，我要用自己的双手夺回本该属于我的一切'

    const shots: MergeInputShot[] = [
      {
        orderIndex: 0,
        startTime: 0,
        endTime: 3,
        prompt: '镜头推，主角缓步走向落地窗凝望远方',
        dialogue: dialogueJson('主角', line1),
      },
      {
        orderIndex: 1,
        startTime: 3,
        endTime: 6,
        prompt: '镜头摇，镜头扫过空旷街道上孤独的身影',
        dialogue: dialogueJson('主角', line2),
      },
      {
        orderIndex: 2,
        startTime: 6,
        endTime: 9,
        prompt: '镜头拉，主角转身坚定地迈步离开',
        dialogue: dialogueJson('主角', line3),
      },
    ]

    const merged = mergeTimelineScript(shots, {
      genDuration: 9,
      stylePrefix: LONG_STYLE_PREFIX,
    })

    // 期望行为（Property 1）：不丢任何整段分镜
    expect(merged.droppedSegmentCount).toBe(0)
    // 期望行为（Property 1）：每段台词核心语义完整出现在 merged.text
    expect(merged.text).toContain(line1)
    expect(merged.text).toContain(line2)
    expect(merged.text).toContain(line3)
  })

  it('子触发点 2：单个分镜台词极长时，不应对首段做丢台词的段内截断（台词核心语义须保留）', () => {
    // 单段超长独白，整行长度 > budgetForTimeline，未修复代码会用 line.slice 截去尾部台词。
    const longMonologue =
      '我曾以为只要默默忍耐就能等到属于自己的那一天，可是日复一日的沉默换来的只有更深的孤独，' +
      '直到今晚我才真正明白，命运从来不会怜悯任何一个不肯为自己抗争的人，' +
      '所以从这一刻开始，我决定不再等待，不再退缩，要用尽全部力气去夺回本该属于我的一切，' +
      '我会让所有曾经轻视过我的人，亲眼见证我是如何一步步登上他们遥不可及的高度'

    const shots: MergeInputShot[] = [
      {
        orderIndex: 0,
        startTime: 0,
        endTime: 6,
        prompt: '镜头固定，主角独自站在空荡的房间中央',
        dialogue: dialogueJson('主角', longMonologue),
      },
    ]

    const merged = mergeTimelineScript(shots, {
      genDuration: 6,
      stylePrefix: LONG_STYLE_PREFIX,
    })

    // 期望行为（Property 1）：台词核心语义完整保留，不被段内硬截断
    expect(merged.text).toContain(longMonologue)
    expect(merged.droppedSegmentCount).toBe(0)
  })

  it('子触发点 3：deduplicateAgainstStyle 不应误删与风格前缀仅角色名巧合的 prompt 正文', () => {
    // 风格前缀含「小明：短发白衬衫」的角色外貌描述；prompt 正文恰好也以「小明：」开头，
    // 但其内容是动作描述而非外貌重复。未修复的去重正则会把整段正文一并删除。
    const stylePrefixWithChar = '国风3D动画风格，暗色调。小明：短发白衬衫的少年'
    const promptBody = '镜头固定，小明：独自走在空荡无人的深夜街道上回忆往昔'

    const shots: MergeInputShot[] = [
      {
        orderIndex: 0,
        startTime: 0,
        endTime: 4,
        prompt: promptBody,
        dialogue: null,
      },
    ]

    const merged = mergeTimelineScript(shots, {
      genDuration: 4,
      stylePrefix: stylePrefixWithChar,
    })

    // 期望行为（Property 1 / Req 2.4）：仅删与风格前缀真实重复的角色外貌，不得误删正文动作
    expect(merged.text).toContain('独自走在空荡无人的深夜街道上回忆往昔')
    expect(merged.droppedSegmentCount).toBe(0)
  })

  it('Scoped PBT：随机化段数(3)/prompt 长度/台词长度，超预算组仍不应丢段或丢台词', () => {
    // 用固定中文字符池构造长度可控、内容真实的台词，随机化扩大覆盖。
    const charPool = '城市夜色灯光风雨前行梦想孤独坚定回忆未来希望命运抗争沉默力量'.split('')
    const genDialogueText = fc
      .array(fc.constantFrom(...charPool), { minLength: 40, maxLength: 70 })
      .map((arr) => arr.join(''))

    const genShot = (orderIndex: number) =>
      fc.record({
        prompt: fc.constantFrom(
          '镜头推，主角缓步走向落地窗凝望远方',
          '镜头摇，镜头扫过空旷街道上孤独的身影',
          '镜头拉，主角转身坚定地迈步离开'
        ),
        text: genDialogueText,
      }).map(({ prompt, text }) => ({
        shot: {
          orderIndex,
          startTime: orderIndex * 3,
          endTime: orderIndex * 3 + 3,
          prompt,
          dialogue: dialogueJson('主角', text),
        } as MergeInputShot,
        text,
      }))

    fc.assert(
      fc.property(genShot(0), genShot(1), genShot(2), (s0, s1, s2) => {
        const merged = mergeTimelineScript([s0.shot, s1.shot, s2.shot], {
          genDuration: 9,
          stylePrefix: LONG_STYLE_PREFIX,
        })
        // 期望行为（Property 1）：不丢段、各段台词完整出现在 text
        expect(merged.droppedSegmentCount).toBe(0)
        expect(merged.text).toContain(s0.text)
        expect(merged.text).toContain(s1.text)
        expect(merged.text).toContain(s2.text)
      }),
      { numRuns: 20 }
    )
  })
})
