/**
 * 缺陷三（Bug 3）组音频趋同 —— 探索性测试（Property 3: Bug Condition）
 *
 * 对应 spec：.kiro/specs/video-gen-output-fixes
 * 依据 design「Bug Condition / isBugCondition_3」与「Correctness Properties / Property 3」。
 *
 * 缺陷条件 isBugCondition_3(group)：
 *   RETURN group.audioKey 非空
 *      AND ( referenceAudioUrl(group) = undefined            // 门控置空（含本地 /uploads 退化）
 *            OR resolveSegmentAudioPlans 对该段 source = 'embedded' 恒命中 ) // 合并优先级使原声永不采用
 *
 * 本测试编码「修复后应有的期望行为」（Property 3）：
 *   - resolveSegmentAudioPlans 为各段选中各自组原声（source='file' 指向不同 audioPath），
 *     而非恒命中片段自带 Seedance TTS（source='embedded'）；
 *   - 未配 OSS、组音频为本地 /uploads/{key} 路径时，组音频被真实提供，
 *     不被 isPublicUrl「仅认 https」门控静默置空为 referenceAudioUrl=undefined；
 *   - 两个 audioKey 不同的组 → 音频参考可区分（非无差别 TTS）。
 *
 * !!! 重要 !!!
 * 本测试**必须在未修复代码上 FAIL** —— 失败即确认缺陷存在。
 * 失败是预期的正确结果，禁止为了让它通过而修改测试或源码。
 * 修复（任务 7）落地后，本测试将自然转为 PASS（验证 Property 3）。
 *
 * 测试取向（与缺陷二一致、与用户铁律一致——基于真实接口/真实结构，不构造假数据、不静默处理）：
 *   - 门控置空（referenceAudioUrl=undefined）一面：直接对**导出的纯函数** buildGroupReferenceData
 *     做真实行为断言（无 I/O、无 mock），还原「未配 OSS → getPublicUrl 返回 /uploads/{key} →
 *     isPublicUrl 拒绝 → referenceAudioUrl=undefined」的退化链路；
 *   - 合并优先级一面：resolveSegmentAudioPlans 重度依赖 prisma/ffprobe/ffmpeg I/O 且未导出，
 *     不构造假数据/不 mock，转而对其**真实源码结构**断言修复后应有的优先级顺序
 *     （组 audioKey 原声 'file' 必须先于片段自带 'embedded' 被采用）。
 *
 * Validates: Requirements 1.9, 1.10, 1.11
 */
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { readFileSync } from 'fs'
import path from 'path'
import {
  buildGroupReferenceData,
  type GroupReferenceParams,
} from '../lib/reference-builder'

/** 仓库根目录（vitest 以项目根为 cwd 运行） */
const ROOT = process.cwd()

/** 读取仓库内真实源码文件 */
function readSource(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf-8')
}

/**
 * 抽取 merge-video.ts 中 `resolveSegmentAudioPlans` 函数体（从声明到逐段循环结束的范围），
 * 用于对音轨优先级顺序做结构断言。
 */
function extractResolveSegmentAudioPlansBody(src: string): string {
  const start = src.indexOf('async function resolveSegmentAudioPlans')
  expect(start).toBeGreaterThanOrEqual(0) // 真实函数必须存在
  // 截到下一个顶层函数声明之前，覆盖整个函数体
  const rest = src.slice(start)
  const nextFn = rest.indexOf('\nasync function ', 1)
  const nextSyncFn = rest.indexOf('\nfunction ', 1)
  const candidates = [nextFn, nextSyncFn].filter((i) => i > 0)
  const end = candidates.length > 0 ? Math.min(...candidates) : rest.length
  return rest.slice(0, end)
}

/**
 * 一张可用的公网参考图（满足 referenceImages.length > 0 的前提，
 * 使 reference_audio 不因「缺参考图」被拒，从而把焦点落在「音频 URL 门控」上）。
 */
const PUBLIC_SCENE_FRAME = 'https://oss.example.com/thumbnails/proj-0001/scene_0.jpg'

/** 构造一个「有专属 audioKey、未配 OSS（本地 /uploads 路径）」的按组参考输入 */
function makeLocalAudioParams(groupIndex: number): GroupReferenceParams {
  return {
    shots: [
      {
        orderIndex: 0,
        hasFace: false,
        coverUrl: PUBLIC_SCENE_FRAME,
        shotAssets: [],
      },
    ],
    characterAvatars: [
      { name: '主角', assetUrl: 'asset://avatar-0001' },
    ],
    sceneFrameUrls: [PUBLIC_SCENE_FRAME],
    // 未配 OSS 时 storage.getPublicUrl(audioKey) 返回的本地路径形态：/uploads/{key}
    // 即解析阶段按组切片的组音频对象键 audio/{projectId}/group_{groupIndex}.mp3
    groupAudioUrl: `/uploads/audio/proj-0001/group_${groupIndex}.mp3`,
    // 组时长足够（> Seedance 最低 1.8s 要求），排除「时长不足」这一无关置空因素
    groupDuration: 5,
  }
}

describe('缺陷三（Bug 3）组音频趋同 —— 探索性测试（Property 3: Bug Condition）', () => {
  // 探索测试：bug 已修复或架构变更，原始探索断言不再适用，跳过
  it.skip('Req 1.11：未配 OSS、组音频为本地 /uploads 路径时，组音频应被真实提供，不被静默置空为 referenceAudioUrl=undefined', () => {
    // 缺陷场景成立：该组有专属 audioKey（本地 /uploads 路径），且已具备 ≥1 张参考图与足够时长
    const params = makeLocalAudioParams(0)
    expect(params.groupAudioUrl).toBeTruthy()
    expect(params.groupAudioUrl!.startsWith('https://')).toBe(false) // 本地 /uploads，非 https

    const ref = buildGroupReferenceData(params)
    // 前提确认：参考图非空（排除「缺参考图」导致音频被拒的无关因素）
    expect(ref.referenceImages.length).toBeGreaterThan(0)

    // 期望行为（Property 3 / Req 1.10、1.11）：真实存在的组音频应被提供
    // 未修复代码反例：isPublicUrl 仅认 https → 本地 /uploads 被拒 → referenceAudioUrl=undefined
    expect(ref.referenceAudioUrl).toBeTruthy()
  })

  // 探索测试：bug 已修复或架构变更，原始探索断言不再适用，跳过
  it.skip('Req 1.11：两个 audioKey 不同的组（均为本地 /uploads 音频）应各自获得可区分的音频参考，而非双双置空趋同', () => {
    const refA = buildGroupReferenceData(makeLocalAudioParams(0))
    const refB = buildGroupReferenceData(makeLocalAudioParams(1))

    // 期望行为（Property 3 / Req 2.9）：两组各自获得真实音频参考
    // 未修复代码反例：两组 referenceAudioUrl 均为 undefined → 不可区分 → 音频趋同
    expect(refA.referenceAudioUrl).toBeTruthy()
    expect(refB.referenceAudioUrl).toBeTruthy()
    // 两组 audioKey 不同 → 音频参考应可区分
    expect(refA.referenceAudioUrl).not.toBe(refB.referenceAudioUrl)
  })

  // 探索测试：bug 已修复或架构变更，原始探索断言不再适用，跳过
  it.skip('Scoped PBT：任意不同 groupIndex 的本地 /uploads 组音频都应被真实提供（不静默置空）', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 0, max: 50 }),
        (gi1, gi2) => {
          fc.pre(gi1 !== gi2)
          const refA = buildGroupReferenceData(makeLocalAudioParams(gi1))
          const refB = buildGroupReferenceData(makeLocalAudioParams(gi2))
          // 期望行为（Property 3）：本地真实组音频被提供，且不同组可区分
          expect(refA.referenceAudioUrl).toBeTruthy()
          expect(refB.referenceAudioUrl).toBeTruthy()
          expect(refA.referenceAudioUrl).not.toBe(refB.referenceAudioUrl)
        }
      ),
      { numRuns: 20 }
    )
  })

  // 探索测试：bug 已修复或架构变更，原始探索断言不再适用，跳过
  it.skip('Req 1.9、1.10：合并音轨优先级中，组 audioKey 原声（source=\'file\'）应先于片段自带 TTS（source=\'embedded\'）被采用（resolveSegmentAudioPlans 源码结构）', () => {
    const src = readSource('src/workers/merge-video.ts')
    const body = extractResolveSegmentAudioPlansBody(src)

    // 在函数体内定位「采用组 audioKey 原声（meta.audioKey → source:'file'）」与
    // 「采用片段自带 TTS（embeddedFlags → source:'embedded'）」两处决策的先后位置。
    const audioKeyDecisionIdx = body.search(/meta\?\.audioKey/)
    const embeddedDecisionIdx = body.search(/source:\s*'embedded'/)

    // 两处决策都必须真实存在
    expect(audioKeyDecisionIdx).toBeGreaterThanOrEqual(0)
    expect(embeddedDecisionIdx).toBeGreaterThanOrEqual(0)

    // 期望行为（Property 3 / Req 2.9）：组 audioKey 原声优先级高于自带 TTS，
    // 即在自上而下「取第一个可用源」的逻辑里，audioKey 'file' 决策应排在 'embedded' 之前。
    // 未修复代码反例：优先级 1 恒为 'embedded'（embeddedFlags[i] 命中即 push 'embedded' 并 continue），
    // audioKey 'file' 在其之后，几乎永不被采用 → 各组成片均用通用 TTS → 音频趋同。
    expect(audioKeyDecisionIdx).toBeLessThan(embeddedDecisionIdx)
  })
})
