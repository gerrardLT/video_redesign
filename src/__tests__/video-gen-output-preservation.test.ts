/**
 * 视频生成产物修复 —— 保持（Preservation）属性测试（Property 4: Preservation）
 *
 * 对应 spec：.kiro/specs/video-gen-output-fixes
 * 依据 design「Correctness Properties / Property 4」「Preservation Requirements 3.1~3.7」与「Testing Strategy / Preservation Checking」。
 *
 * Property 4（Preservation）：
 *   FOR ALL X WHERE NOT (isBugCondition_1_4(X) OR isBugCondition_2(X) OR isBugCondition_3(X)) DO
 *     ASSERT F(X) = F'(X)
 *   即非缺陷输入下，修复后行为与修复前完全一致。
 *
 * !!! 方法论：观察优先（observe-first）!!!
 * 本文件中的「基线」常量与断言取自**未修复代码**在非缺陷输入下的真实输出
 * （由临时观察脚本运行未修复代码记录，记录后脚本即删除）。
 * 这些断言在**未修复代码上必须 PASS**（确立基线）；修复（任务 5/6/7）落地后，
 * 同一组测试将作为「不回归」护栏——若修复意外改变了非缺陷输入的输出，此处会 FAIL。
 *
 * 覆盖的非缺陷输入（Preservation Requirements 3.1~3.6）：
 *   - 3.1 合并脚本未超预算的组 → mergeTimelineScript 的 text/segments/droppedSegmentCount 不变；
 *   - 3.2 [图N] 素材引用解析、运镜词前缀补全、{台词} 大括号格式保留不变；
 *   - 3.3 hasFace=false 无脸帧 coverUrl 作 reference_image 场景参考的取值不变；
 *   - 3.6 已配 OSS、组音频为 https 公网 URL 时 referenceAudioUrl 与合并音源决策不变；
 *   - 3.4/3.5 无 audioKey / 确无原声的段走 embedded / silence 的音轨决策与音画对齐不变。
 *
 * 说明：3.4/3.5 的合并音轨决策（resolveSegmentAudioPlans）与音画对齐位于 merge-video.ts，
 * 重度依赖 prisma/ffprobe/ffmpeg I/O 且未导出。遵守用户铁律（不构造假数据/不 mock），
 * 对其**真实源码结构**断言「修复后仍须保持」的不变量（embedded/silence 分支仍在、
 * apad/atrim/44100/stereo 对齐与 trim-on-merge 仍在），且**刻意不断言**会被修复改变的优先级顺序。
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { readFileSync } from 'fs'
import path from 'path'
import {
  mergeTimelineScript,
  SUPPORTED_CAMERA_MOVES,
  type MergeInputShot,
} from '../lib/script-merger'
import { resolveReferences } from '../lib/prompt-parser'
import {
  buildGroupReferenceData,
  buildReferenceData,
  type GroupReferenceParams,
} from '../lib/reference-builder'

// ─── 公共构造 ────────────────────────────────────────────────────────────────

/** 把一句台词包装成 Shot.dialogue 的存储格式（JSON.stringify([{speaker,text}])） */
function dialogueJson(speaker: string, text: string): string {
  return JSON.stringify([{ speaker, text }])
}

/** 仓库根目录（vitest 以项目根为 cwd 运行） */
const ROOT = process.cwd()

/** 读取仓库内真实源码文件 */
function readSource(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf-8')
}

const SCENE_FRAME = 'https://oss.example.com/thumbnails/proj-1/scene_0.jpg'
const HTTPS_AUDIO = 'https://oss.example.com/audio/proj-1/group_0.mp3'

// ─── 3.1 + 3.2：合并未超预算的组（example 基线快照）────────────────────────────

describe('Property 4: Preservation —— 3.1/3.2 合并未超预算输出基线（mergeTimelineScript）', () => {
  // 观察优先：以下基线取自未修复代码对该非缺陷输入的真实输出
  const underBudgetShots: MergeInputShot[] = [
    {
      orderIndex: 0,
      startTime: 0,
      endTime: 3,
      prompt: '主角缓步走向窗边', // 无运镜词 → 触发前缀补全（默认「固定」）
      dialogue: dialogueJson('主角', '走吧'),
    },
    {
      orderIndex: 1,
      startTime: 3,
      endTime: 6,
      prompt: '镜头推，主角凝望远方', // 已含运镜词 → 保留
      dialogue: null,
    },
  ]

  it('3.1：未超预算组的 text/segments/droppedSegmentCount/truncated 逐字逐项与基线一致', () => {
    const merged = mergeTimelineScript(underBudgetShots, {
      genDuration: 6,
      stylePrefix: '国风3D动画风格，暗色调',
    })

    // text 逐字一致（含风格行、镜头制分段、台词大括号、负面约束行）
    expect(merged.text).toBe(
      '国风3D动画风格，暗色调\n' +
        '镜头1：固定，主角缓步走向窗边，主角说：{走吧}\n' +
        '镜头2：推，主角凝望远方\n' +
        '禁止风格漂移，禁止角色变脸，禁止光线突变，禁止出现文字水印'
    )

    // segments 逐项一致（时间码归一化 + body 完整）
    expect(merged.segments).toEqual([
      { relStart: 0, relEnd: 3, body: '镜头固定，主角缓步走向窗边，主角说：{走吧}' },
      { relStart: 3, relEnd: 6, body: '镜头推，主角凝望远方' },
    ])

    // 未超预算 → 不丢段、不截断
    expect(merged.droppedSegmentCount).toBe(0)
    expect(merged.truncated).toBe(false)
  })

  it('3.2：运镜词前缀补全（无运镜→「镜头固定」、有运镜→保留）与 {台词} 大括号格式保留', () => {
    const merged = mergeTimelineScript(underBudgetShots, {
      genDuration: 6,
      stylePrefix: '国风3D动画风格，暗色调',
    })

    // 无运镜词的首段被补全为「镜头固定」前缀
    expect(merged.segments[0].body.startsWith('镜头固定')).toBe(true)
    // 已含运镜词的次段保留原运镜
    expect(merged.segments[1].body.startsWith('镜头推')).toBe(true)
    // 台词以大括号包裹保留（Seedance 官方台词格式）
    expect(merged.text).toContain('主角说：{走吧}')
  })

  it('3.1 PBT：任意「未超预算」小组（≤3 段短 prompt/短台词）恒不丢段、分段连续、运镜前缀与台词大括号保留', () => {
    // 受控生成器：短 prompt（不含运镜词，触发默认「固定」前缀补全）+ 短台词，
    // 保证合并脚本远低于预算（非缺陷输入），从而验证 Preservation 而非 Bug Condition。
    const promptPool = ['主角走向窗边', '少年抬头望天', '人群缓缓散去', '雨点落在地面']
    const dialoguePool = ['走吧', '好的', '再见', '快看']

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 3 }),
        (shotCount) => {
          const shots: MergeInputShot[] = Array.from({ length: shotCount }, (_, i) => ({
            orderIndex: i,
            startTime: i * 3,
            endTime: i * 3 + 3,
            prompt: promptPool[i % promptPool.length],
            dialogue: i % 2 === 0 ? dialogueJson('主角', dialoguePool[i % dialoguePool.length]) : null,
          }))

          const merged = mergeTimelineScript(shots, {
            genDuration: shotCount * 3,
            stylePrefix: '国风3D动画风格，暗色调',
          })

          // 未超预算 → 保持：不丢段、不截断、分段数 = 分镜数
          expect(merged.droppedSegmentCount).toBe(0)
          expect(merged.truncated).toBe(false)
          expect(merged.segments).toHaveLength(shotCount)

          // 运镜词前缀补全保持：每段 body 以「镜头{X}」开头（X ∈ 受支持运镜术语）
          for (const seg of merged.segments) {
            expect(seg.body.startsWith('镜头')).toBe(true)
            const after = seg.body.slice(2)
            expect(SUPPORTED_CAMERA_MOVES.some((m) => after.startsWith(m))).toBe(true)
          }

          // 含台词的段：大括号格式保留
          shots.forEach((s, i) => {
            if (s.dialogue) {
              expect(merged.segments[i].body).toMatch(/说：\{[^}]+\}/)
            }
          })
        }
      ),
      { numRuns: 20 }
    )
  })
})

// ─── 3.2：[图N] 素材引用解析（example + PBT）──────────────────────────────────

describe('Property 4: Preservation —— 3.2 [图N] 素材引用解析（resolveReferences）', () => {
  it('example：[图N] 标记被移除、resolvedRefs 按 displayNum 升序映射 URL（与基线一致）', () => {
    const resolved = resolveReferences('主角站在[图1]前，背景是[图2]的城市', [
      { displayNum: 1, asset: { url: 'https://oss.example.com/a1.jpg' } },
      { displayNum: 2, asset: { url: 'https://oss.example.com/a2.jpg' } },
    ])

    expect(resolved.cleanPrompt).toBe('主角站在前，背景是的城市')
    expect(resolved.resolvedRefs).toEqual([
      { displayNum: 1, url: 'https://oss.example.com/a1.jpg' },
      { displayNum: 2, url: 'https://oss.example.com/a2.jpg' },
    ])
  })

  it('PBT：任意 [图N] 引用组合，cleanPrompt 不再含 [图N] 标记，resolvedRefs 升序且 URL 匹配', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 9 }), { minLength: 1, maxLength: 9 }),
        (refNums) => {
          const assets = refNums.map((n) => ({
            displayNum: n,
            asset: { url: `https://oss.example.com/a${n}.jpg` },
          }))
          const prompt = '画面：' + refNums.map((n) => `[图${n}]`).join('与') + '组合'

          const resolved = resolveReferences(prompt, assets)

          // [图N] 标记全部移除
          expect(resolved.cleanPrompt).not.toMatch(/\[图\d+\]/)
          // resolvedRefs 按 displayNum 升序
          const nums = resolved.resolvedRefs.map((r) => r.displayNum)
          expect(nums).toEqual([...nums].sort((a, b) => a - b))
          // 每个引用映射到对应 URL
          for (const r of resolved.resolvedRefs) {
            expect(r.url).toBe(`https://oss.example.com/a${r.displayNum}.jpg`)
          }
          // 引用集合与输入一致（去重后）
          expect(new Set(nums)).toEqual(new Set(refNums))
        }
      ),
      { numRuns: 20 }
    )
  })
})

// ─── 3.3 + 3.6：无脸帧场景参考 / https 组音频参考（example + PBT）────────────────

describe('Property 4: Preservation —— 3.3 无脸帧场景参考 / 3.6 已配 OSS https 组音频', () => {
  /** 构造一个「非缺陷」按组参考输入：无脸场景帧 + 人物锚定图 + 可选 https 组音频 */
  function makeGroupParams(groupAudioUrl?: string): GroupReferenceParams {
    return {
      shots: [{ orderIndex: 0, hasFace: false, coverUrl: SCENE_FRAME, shotAssets: [] }],
      characterAvatars: [{ name: '主角', assetUrl: 'asset://avatar-1' }],
      sceneFrameUrls: [SCENE_FRAME],
      groupAudioUrl,
      groupDuration: 5,
    }
  }

  it('3.3 example：hasFace=false 的 coverUrl 作 reference_image 场景参考，sceneRefIndices 指向其 1 基序号（与基线一致）', () => {
    const ref = buildGroupReferenceData(makeGroupParams())

    expect(ref.referenceImages).toEqual(['asset://avatar-1', SCENE_FRAME])
    expect(ref.avatarRefs).toEqual([{ name: '主角', imageIndex: 1 }])
    expect(ref.sceneRefIndices).toEqual([2])
    // 无 groupAudioUrl（无 audioKey，非缺陷）→ 无音频参考
    expect(ref.referenceAudioUrl).toBeUndefined()
  })

  it('3.6 example：已配 OSS、组音频为 https 公网 URL 时 referenceAudioUrl 原样采用（与基线一致）', () => {
    const ref = buildGroupReferenceData(makeGroupParams(HTTPS_AUDIO))

    // 场景参考与无音频场景完全一致（音频不影响图像构建）
    expect(ref.referenceImages).toEqual(['asset://avatar-1', SCENE_FRAME])
    expect(ref.avatarRefs).toEqual([{ name: '主角', imageIndex: 1 }])
    expect(ref.sceneRefIndices).toEqual([2])
    // https 公网组音频被原样作为 referenceAudioUrl 采用
    expect(ref.referenceAudioUrl).toBe(HTTPS_AUDIO)
  })

  it('3.6 example：buildReferenceData（单分镜路径）对 https 组音频同样原样采用，场景帧作 reference_image', () => {
    const ref = buildReferenceData({
      shot: {
        id: 'shot-1',
        orderIndex: 0,
        coverUrl: SCENE_FRAME,
        prompt: '主角站在[图1]前',
        shotAssets: [
          { displayNum: 1, asset: { url: 'https://oss.example.com/a1.jpg', isCharImage: false } },
        ],
      },
      projectId: 'proj-1',
      sceneFrameUrls: [SCENE_FRAME],
      groupAudioUrl: HTTPS_AUDIO,
    })

    expect(ref.cleanPrompt).toBe('主角站在前')
    expect(ref.referenceImages).toEqual([SCENE_FRAME, 'https://oss.example.com/a1.jpg'])
    expect(ref.referenceAudioUrl).toBe(HTTPS_AUDIO)
  })

  it('3.6 PBT：任意 https 公网组音频（满足时长）+ 非空参考图 → referenceAudioUrl 恒等于该 URL（不被门控置空）', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 99 }),
        fc.double({ min: 1.8, max: 30, noNaN: true, noDefaultInfinity: true }),
        (groupIndex, duration) => {
          const audioUrl = `https://oss.example.com/audio/proj-1/group_${groupIndex}.mp3`
          const ref = buildGroupReferenceData({
            shots: [{ orderIndex: 0, hasFace: false, coverUrl: SCENE_FRAME, shotAssets: [] }],
            characterAvatars: [{ name: '主角', assetUrl: 'asset://avatar-1' }],
            sceneFrameUrls: [SCENE_FRAME],
            groupAudioUrl: audioUrl,
            groupDuration: duration,
          })
          // 3.6 保持：https 公网音频 + 有参考图 + 满足最低时长 → 原样采用
          expect(ref.referenceAudioUrl).toBe(audioUrl)
          // 3.3 保持：无脸场景帧始终作 reference_image 场景参考
          expect(ref.referenceImages).toContain(SCENE_FRAME)
          expect(ref.sceneRefIndices.length).toBeGreaterThan(0)
        }
      ),
      { numRuns: 20 }
    )
  })

  it('3.3/3.4 PBT：无 groupAudioUrl（无 audioKey，非缺陷）→ referenceAudioUrl 恒为 undefined，场景帧仍作参考', () => {
    fc.assert(
      fc.property(fc.double({ min: 1.8, max: 30, noNaN: true, noDefaultInfinity: true }), (duration) => {
        const ref = buildGroupReferenceData({
          shots: [{ orderIndex: 0, hasFace: false, coverUrl: SCENE_FRAME, shotAssets: [] }],
          characterAvatars: [{ name: '主角', assetUrl: 'asset://avatar-1' }],
          sceneFrameUrls: [SCENE_FRAME],
          groupAudioUrl: undefined,
          groupDuration: duration,
        })
        // 无 audioKey → 生成阶段无音频参考（对应合并阶段走 embedded/silence 的前置基线）
        expect(ref.referenceAudioUrl).toBeUndefined()
        // 场景帧仍作 reference_image 场景参考
        expect(ref.referenceImages).toContain(SCENE_FRAME)
        expect(ref.sceneRefIndices.length).toBeGreaterThan(0)
      }),
      { numRuns: 20 }
    )
  })
})

// ─── 3.4 + 3.5：合并音轨 embedded/silence 决策与音画对齐（源码结构不变量）──────────

describe('Property 4: Preservation —— 3.4/3.5 合并音轨决策与音画对齐（merge-video.ts 结构不变量）', () => {
  const mergeSrc = readSource('src/workers/merge-video.ts')

  it('3.4：embedded（自带 TTS）与 silence（静音兜底）两条音源分支必须保持存在', () => {
    // 无 audioKey / 确无原声的段走 embedded / silence —— 修复重排优先级后这两条分支仍须存在
    expect(mergeSrc).toMatch(/source:\s*'embedded'/)
    expect(mergeSrc).toMatch(/source:\s*'silence'/)
    // 静音补齐用 anullsrc 维持时序（不丢轨、不伪造语音）
    expect(mergeSrc).toMatch(/anullsrc=channel_layout=stereo:sample_rate=44100/)
  })

  it('3.5：音画对齐（apad/atrim、统一重采样 44100/stereo、asetpts）须保持不变', () => {
    // 统一重采样为 44100 + stereo + fltp
    expect(mergeSrc).toContain('aresample=44100')
    expect(mergeSrc).toContain('aformat=sample_fmts=fltp:channel_layouts=stereo')
    // 逐段按视频时长对齐：apad 补齐 + atrim 截断 + 重置时间戳
    expect(mergeSrc).toContain('apad')
    expect(mergeSrc).toContain('atrim=0:')
    expect(mergeSrc).toContain('asetpts=N/SR/TB')
  })

  it('3.5：trim-on-merge（被 Seedance 拉伸时按 genDuration 裁切）须保持存在', () => {
    expect(mergeSrc).toMatch(/async function trimClipIfNeeded/)
    // 裁切目标为 genDuration（提交给 Seedance 的时长）
    expect(mergeSrc).toMatch(/'-t',\s*String\(genDuration\)/)
  })

  it('3.5：concat 逐段 A/V 一一对应（视频段数 = 音频段数）须保持', () => {
    // concat=n=${segments.length}:v=1:a=0 与 :v=0:a=1 两条 concat 须保持，确保逐段 A/V 对应
    expect(mergeSrc).toContain('concat=n=${segments.length}:v=1:a=0[outv]')
    expect(mergeSrc).toContain('concat=n=${segments.length}:v=0:a=1[outa]')
  })
})
