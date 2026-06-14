/**
 * buildGroupReferenceData 属性化测试（asset:// 人物锚定模式，已放弃 first_frame）
 *
 * 验证按组参考数据构建的核心不变量：
 * - 输出不含 first_frame（全面放弃 first_frame，统一走多模态参考）
 * - referenceImages：人物锚定 asset:// 在前 + 无脸场景帧，≤9、去重、不含角色图
 * - 绝不把原视频真人帧塞进 referenceImages（未受信会被人脸审核拦截）
 * - avatarRefs.imageIndex 与 referenceImages 中 asset:// 的实际 1 基序号一致
 * - referenceAudioUrl 仅在 referenceImages 非空时出现
 */
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { buildGroupReferenceData, type GroupReferenceParams } from '@/lib/reference-builder'

const publicUrlArb = fc
  .integer({ min: 0, max: 100000 })
  .map((n) => `https://oss.example.com/img_${n}.jpg`)

const shotArb = fc.record({
  orderIndex: fc.integer({ min: 0, max: 50 }),
  hasFace: fc.boolean(),
  coverUrl: fc.oneof(fc.constant(null), publicUrlArb),
  shotAssets: fc.array(
    fc.record({
      url: publicUrlArb,
      isCharImage: fc.boolean(),
    }),
    { maxLength: 5 }
  ),
})

const avatarsArb = fc
  .uniqueArray(fc.integer({ min: 0, max: 500 }), { maxLength: 4 })
  .map((ids) => ids.map((id) => ({ name: `角色${id}`, assetUrl: `asset://asset-${id}` })))

const paramsArb: fc.Arbitrary<GroupReferenceParams> = fc.record({
  shots: fc.array(shotArb, { minLength: 1, maxLength: 8 }).map((arr) =>
    arr.map((s, i) => ({
      orderIndex: i,
      hasFace: s.hasFace,
      coverUrl: s.coverUrl,
      shotAssets: s.shotAssets.map((a) => ({ asset: { url: a.url, isCharImage: a.isCharImage } })),
    }))
  ),
  characterAvatars: avatarsArb,
  sceneFrameUrls: fc.array(publicUrlArb, { maxLength: 12 }),
  groupAudioUrl: fc.oneof(fc.constant(undefined), fc.constant('https://oss.example.com/audio/group_0.mp3')),
})

describe('buildGroupReferenceData 属性测试（asset:// 锚定）', () => {
  it('输出不含 first_frame 字段', () => {
    fc.assert(
      fc.property(paramsArb, (params) => {
        const result = buildGroupReferenceData(params)
        expect('firstFrameUrl' in result).toBe(false)
      }),
      { numRuns: 100 }
    )
  })

  it('referenceImages ≤9、去重、不含角色图；元素必为 asset:// 或 https 公网', () => {
    fc.assert(
      fc.property(paramsArb, (params) => {
        const result = buildGroupReferenceData(params)
        expect(result.referenceImages.length).toBeLessThanOrEqual(9)
        expect(new Set(result.referenceImages).size).toBe(result.referenceImages.length)
        for (const url of result.referenceImages) {
          expect(url.startsWith('asset://') || url.startsWith('https://')).toBe(true)
        }
        // 不含角色图素材（isCharImage=true）——但若同一 url 同时作为非角色素材/场景帧出现则其出现是合理的
        const nonCharUrls = new Set(
          params.shots
            .flatMap((s) => s.shotAssets)
            .filter((sa) => !sa.asset.isCharImage)
            .map((sa) => sa.asset.url)
        )
        const charImageUrls = params.shots
          .flatMap((s) => s.shotAssets)
          .filter((sa) => sa.asset.isCharImage)
          .map((sa) => sa.asset.url)
        for (const charUrl of charImageUrls) {
          if (!params.sceneFrameUrls.includes(charUrl) && !nonCharUrls.has(charUrl)) {
            expect(result.referenceImages).not.toContain(charUrl)
          }
        }
      }),
      { numRuns: 200 }
    )
  })

  it('绝不把原视频真人帧(coverUrl)塞进 referenceImages', () => {
    fc.assert(
      fc.property(paramsArb, (params) => {
        const result = buildGroupReferenceData(params)
        const coverUrls = params.shots
          .map((s) => s.coverUrl)
          .filter((u): u is string => !!u)
        // 合法可出现在参考图里的 url：场景帧 + 非角色素材
        const allowedUrls = new Set<string>([
          ...params.sceneFrameUrls,
          ...params.shots
            .flatMap((s) => s.shotAssets)
            .filter((sa) => !sa.asset.isCharImage)
            .map((sa) => sa.asset.url),
        ])
        for (const cover of coverUrls) {
          // 真人帧 coverUrl 绝不应被当作场景帧/素材塞入参考图（除非它本就是合法的场景帧/非角色素材 url）
          if (!allowedUrls.has(cover)) {
            expect(result.referenceImages).not.toContain(cover)
          }
        }
      }),
      { numRuns: 200 }
    )
  })

  it('人物锚定 asset:// 排在最前，avatarRefs.imageIndex 与实际序号一致', () => {
    fc.assert(
      fc.property(paramsArb, (params) => {
        const result = buildGroupReferenceData(params)
        for (const ref of result.avatarRefs) {
          // imageIndex 为 1 基，指向的就是对应角色的 asset:// 资产
          const url = result.referenceImages[ref.imageIndex - 1]
          expect(url?.startsWith('asset://')).toBe(true)
          const match = params.characterAvatars.find((a) => a.name === ref.name)
          expect(match).toBeDefined()
          expect(url).toBe(match!.assetUrl)
        }
      }),
      { numRuns: 200 }
    )
  })

  it('referenceAudioUrl 仅在 referenceImages 非空时出现', () => {
    fc.assert(
      fc.property(paramsArb, (params) => {
        const result = buildGroupReferenceData(params)
        if (result.referenceAudioUrl !== undefined) {
          expect(result.referenceImages.length).toBeGreaterThan(0)
        }
      }),
      { numRuns: 200 }
    )
  })

  it('示例：仅人物锚定资产，无场景帧 → 参考图为该 asset://，prompt 引用 图片1', () => {
    const result = buildGroupReferenceData({
      shots: [
        { orderIndex: 0, hasFace: true, coverUrl: 'https://oss.example.com/face.jpg', shotAssets: [] },
      ],
      characterAvatars: [{ name: '小明', assetUrl: 'asset://asset-1' }],
      sceneFrameUrls: [],
      groupAudioUrl: 'https://oss.example.com/audio/group_0.mp3',
      groupDuration: 5,
    })
    expect(result.referenceImages).toEqual(['asset://asset-1'])
    expect(result.avatarRefs).toEqual([{ name: '小明', imageIndex: 1 }])
    expect(result.referenceAudioUrl).toBe('https://oss.example.com/audio/group_0.mp3')
  })

  it('示例：asset:// 在前 + 无脸场景帧在后', () => {
    const result = buildGroupReferenceData({
      shots: [
        { orderIndex: 0, hasFace: false, coverUrl: 'https://oss.example.com/scene.jpg', shotAssets: [] },
      ],
      characterAvatars: [{ name: '小红', assetUrl: 'asset://asset-9' }],
      sceneFrameUrls: ['https://oss.example.com/scene.jpg'],
      groupAudioUrl: undefined,
      groupDuration: 5,
    })
    expect(result.referenceImages).toEqual(['asset://asset-9', 'https://oss.example.com/scene.jpg'])
    expect(result.avatarRefs).toEqual([{ name: '小红', imageIndex: 1 }])
  })

  it('示例：纯人脸视频、无锚定资产、无场景帧 + 组音频 → 不塞真人帧，参考图为空、音频丢弃', () => {
    const result = buildGroupReferenceData({
      shots: [
        { orderIndex: 0, hasFace: true, coverUrl: 'https://oss.example.com/face0.jpg', shotAssets: [] },
        { orderIndex: 1, hasFace: true, coverUrl: 'https://oss.example.com/face1.jpg', shotAssets: [] },
      ],
      characterAvatars: [],
      sceneFrameUrls: [],
      groupAudioUrl: 'https://oss.example.com/audio/group_0.mp3',
      groupDuration: 5,
    })
    expect(result.referenceImages).toEqual([])
    expect(result.avatarRefs).toEqual([])
    expect(result.referenceAudioUrl).toBeUndefined()
  })
})
