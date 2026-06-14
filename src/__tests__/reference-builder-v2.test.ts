import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  buildAvatarReferenceData,
  type AvatarReferenceData,
  type BuildReferenceParamsV2,
  type ShotWithAssets,
} from '@/lib/reference-builder'

/**
 * Feature: virtual-avatar-reshaping
 *
 * 属性测试:
 * - Property 6: 场景帧过滤纯净性 (Validates: Requirements 6.1)
 * - Property 7: reference_image 数量上限 (Validates: Requirements 6.3)
 * - Property 8: Content 数组排序不变式 (Validates: Requirements 7.4, 10.1)
 * - Property 9: Prompt 素材引用一致性 (Validates: Requirements 7.1, 7.2, 7.3, 10.2)
 *
 * 单元测试:
 * - 测试 content 排序逻辑
 * - 测试数量截断（超过 9 张时优先保留角色图）
 * - 测试无场景帧降级（仅使用角色图）
 * - 测试 prompt 引用格式正确性
 */

// ========================
// 生成器
// ========================

/** 生成有效的 asset:// URL */
const assetUrlArb = fc.stringMatching(/^asset:\/\/asset-[a-zA-Z0-9]{6,12}$/)

/** 生成有效的 https:// 场景帧 URL */
const sceneUrlArb = fc.stringMatching(/^https:\/\/oss\.example\.com\/frames\/frame_[0-9]{1,4}\.(jpg|png)$/)

/** 生成角色名 */
const characterNameArb = fc.array(
  fc.constantFrom('角', '色', 'A', 'B', 'C', '虚', '拟', '人', '物'),
  { minLength: 1, maxLength: 6 }
).map(chars => chars.join(''))

/** 生成 AvatarReferenceData 数组（1-5 个角色） */
const avatarRefsArb = fc.array(
  fc.record({
    avatarAssetUrl: assetUrlArb,
    characterName: characterNameArb,
  }),
  { minLength: 1, maxLength: 5 }
)

/** 生成场景帧 URL 数组（0-15 个） */
const sceneUrlsArb = fc.array(sceneUrlArb, { minLength: 0, maxLength: 15 })

/** 生成有效的 ShotWithAssets */
function makeShotWithAssets(prompt?: string): ShotWithAssets {
  return {
    id: 'shot-test-1',
    orderIndex: 0,
    coverUrl: null,
    prompt: prompt || '角色站在街道上，缓缓向前走去',
    shotAssets: [],
  }
}

/** 构建完整参数 */
function buildParams(
  avatarRefs: AvatarReferenceData[],
  sceneFrameUrls: string[],
  prompt?: string
): BuildReferenceParamsV2 {
  return {
    shot: makeShotWithAssets(prompt),
    projectId: 'proj-test-1',
    avatarReferences: avatarRefs,
    sceneFrameUrls,
  }
}

// ========================
// Property 6: 场景帧过滤纯净性
// Feature: virtual-avatar-reshaping, Property 6: 场景帧过滤纯净性
// Validates: Requirements 6.1
// ========================

describe('Property 6: 场景帧过滤纯净性', () => {
  it('输出的 referenceImages 中不包含任何 hasFace=true 的帧 URL（asset:// URL 除外）', () => {
    /**
     * buildAvatarReferenceData 的调用方已保证传入的 sceneFrameUrls 是 hasFace=false 的帧。
     * 本属性验证：输出中的非 asset:// URL 全部来自传入的 sceneFrameUrls（即全部为 hasFace=false）。
     * 混入 hasFace=true 的帧（以 https://face. 开头模拟）不应出现在输出中。
     */
    fc.assert(
      fc.property(
        avatarRefsArb,
        sceneUrlsArb,
        // 模拟含人脸的帧 URL（不应被传入 sceneFrameUrls）
        fc.array(
          fc.stringMatching(/^https:\/\/face\.example\.com\/frame_[0-9]{1,4}\.jpg$/),
          { minLength: 0, maxLength: 5 }
        ),
        (avatarRefs, sceneUrls, faceUrls) => {
          // 只传入无人脸的场景帧，不传入含人脸帧
          const params = buildParams(avatarRefs, sceneUrls)
          const result = buildAvatarReferenceData(params)

          // 输出中的非 asset:// URL 必须全部来自 sceneUrls
          const nonAssetUrls = result.referenceImages.filter(
            url => !url.startsWith('asset://')
          )

          for (const url of nonAssetUrls) {
            // 每个非 asset URL 都应在传入的 sceneUrls 中
            expect(sceneUrls).toContain(url)
            // 不应包含任何 faceUrls
            expect(faceUrls).not.toContain(url)
          }
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ========================
// Property 7: reference_image 数量上限
// Feature: virtual-avatar-reshaping, Property 7: reference_image 数量上限
// Validates: Requirements 6.3
// ========================

describe('Property 7: reference_image 数量上限', () => {
  it('对任意数量的虚拟角色图和场景帧输入，referenceImages 长度 ≤ 9', () => {
    fc.assert(
      fc.property(
        // 角色图最多 12 个（超过上限）
        fc.array(
          fc.record({
            avatarAssetUrl: assetUrlArb,
            characterName: characterNameArb,
          }),
          { minLength: 0, maxLength: 12 }
        ),
        // 场景帧最多 20 个（超过上限）
        fc.array(sceneUrlArb, { minLength: 0, maxLength: 20 }),
        (avatarRefs, sceneUrls) => {
          const params = buildParams(avatarRefs, sceneUrls)
          const result = buildAvatarReferenceData(params)

          // 核心不变式：输出数量不超过 9
          expect(result.referenceImages.length).toBeLessThanOrEqual(9)
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ========================
// Property 8: Content 数组排序不变式
// Feature: virtual-avatar-reshaping, Property 8: Content 数组排序不变式
// Validates: Requirements 7.4, 10.1
// ========================

describe('Property 8: Content 数组排序不变式', () => {
  it('asset:// URL 索引 < https:// URL 索引', () => {
    fc.assert(
      fc.property(
        avatarRefsArb,
        // 确保有至少 1 个场景帧以验证排序
        fc.array(sceneUrlArb, { minLength: 1, maxLength: 10 }),
        (avatarRefs, sceneUrls) => {
          const params = buildParams(avatarRefs, sceneUrls)
          const result = buildAvatarReferenceData(params)

          // 找到所有 asset:// 和 https:// 的索引
          const assetIndices: number[] = []
          const httpsIndices: number[] = []

          result.referenceImages.forEach((url, idx) => {
            if (url.startsWith('asset://')) {
              assetIndices.push(idx)
            } else if (url.startsWith('https://')) {
              httpsIndices.push(idx)
            }
          })

          // 如果同时存在 asset:// 和 https:// URL
          if (assetIndices.length > 0 && httpsIndices.length > 0) {
            const maxAssetIndex = Math.max(...assetIndices)
            const minHttpsIndex = Math.min(...httpsIndices)
            // 所有 asset:// 的索引都小于所有 https:// 的索引
            expect(maxAssetIndex).toBeLessThan(minHttpsIndex)
          }
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ========================
// Property 9: Prompt 素材引用一致性
// Feature: virtual-avatar-reshaping, Property 9: Prompt 素材引用一致性
// Validates: Requirements 7.1, 7.2, 7.3, 10.2
// ========================

describe('Property 9: Prompt 素材引用一致性', () => {
  it('prompt 包含"图片1"到"图片N"引用标记，虚拟角色引用含"角色"描述，场景帧引用含"场景"描述', () => {
    fc.assert(
      fc.property(
        avatarRefsArb,
        fc.array(sceneUrlArb, { minLength: 0, maxLength: 8 }),
        (avatarRefs, sceneUrls) => {
          const params = buildParams(avatarRefs, sceneUrls)
          const result = buildAvatarReferenceData(params)

          const totalImages = result.referenceImages.length

          if (totalImages === 0) return // 无图片时跳过

          // 验证 prompt 包含 "图片1" 到 "图片N" 引用（N 为角色图数量）
          const avatarCount = result.referenceImages.filter(
            url => url.startsWith('asset://')
          ).length

          // 角色引用应包含 "图片1" ... "图片{avatarCount}"
          for (let i = 1; i <= avatarCount; i++) {
            expect(result.cleanPrompt).toContain(`图片${i}`)
          }

          // 验证虚拟角色引用含 "角色" 相关描述
          if (avatarCount > 0) {
            expect(result.cleanPrompt).toContain('角色')
          }

          // 验证场景帧引用含 "场景" 相关描述
          const sceneCount = result.referenceImages.filter(
            url => url.startsWith('https://')
          ).length
          if (sceneCount > 0) {
            expect(result.cleanPrompt).toContain('场景')
          }
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ========================
// 单元测试: Reference Builder v2
// ========================

describe('Reference Builder v2 单元测试', () => {
  // --- content 排序逻辑 ---
  describe('content 排序逻辑', () => {
    it('asset:// URL 排在 https:// URL 之前', () => {
      const params = buildParams(
        [
          { avatarAssetUrl: 'asset://asset-abc123', characterName: '角色A' },
        ],
        [
          'https://oss.example.com/frames/frame_1.jpg',
          'https://oss.example.com/frames/frame_2.jpg',
        ]
      )

      const result = buildAvatarReferenceData(params)

      expect(result.referenceImages[0]).toBe('asset://asset-abc123')
      expect(result.referenceImages[1]).toBe('https://oss.example.com/frames/frame_1.jpg')
      expect(result.referenceImages[2]).toBe('https://oss.example.com/frames/frame_2.jpg')
    })

    it('多个角色图排在多个场景帧之前', () => {
      const params = buildParams(
        [
          { avatarAssetUrl: 'asset://asset-aaa111', characterName: '角色A' },
          { avatarAssetUrl: 'asset://asset-bbb222', characterName: '角色B' },
        ],
        [
          'https://oss.example.com/frames/frame_5.jpg',
          'https://oss.example.com/frames/frame_8.jpg',
        ]
      )

      const result = buildAvatarReferenceData(params)

      // 前两个应该是 asset:// URL
      expect(result.referenceImages[0]).toMatch(/^asset:\/\//)
      expect(result.referenceImages[1]).toMatch(/^asset:\/\//)
      // 后两个应该是 https:// URL
      expect(result.referenceImages[2]).toMatch(/^https:\/\//)
      expect(result.referenceImages[3]).toMatch(/^https:\/\//)
    })
  })

  // --- 数量截断 ---
  describe('数量截断（超过 9 张时优先保留角色图）', () => {
    it('总数超过 9 张时截断至 9 张', () => {
      const avatarRefs: AvatarReferenceData[] = Array.from({ length: 5 }, (_, i) => ({
        avatarAssetUrl: `asset://asset-char${i}`,
        characterName: `角色${i}`,
      }))
      const sceneUrls = Array.from({ length: 10 }, (_, i) =>
        `https://oss.example.com/frames/frame_${i}.jpg`
      )

      const params = buildParams(avatarRefs, sceneUrls)
      const result = buildAvatarReferenceData(params)

      expect(result.referenceImages.length).toBe(9)
    })

    it('角色图优先保留：5 角色 + 10 场景帧 → 5 角色 + 4 场景帧', () => {
      const avatarRefs: AvatarReferenceData[] = Array.from({ length: 5 }, (_, i) => ({
        avatarAssetUrl: `asset://asset-char${i}`,
        characterName: `角色${i}`,
      }))
      const sceneUrls = Array.from({ length: 10 }, (_, i) =>
        `https://oss.example.com/frames/frame_${i}.jpg`
      )

      const params = buildParams(avatarRefs, sceneUrls)
      const result = buildAvatarReferenceData(params)

      const assetCount = result.referenceImages.filter(u => u.startsWith('asset://')).length
      const sceneCount = result.referenceImages.filter(u => u.startsWith('https://')).length

      expect(assetCount).toBe(5)
      expect(sceneCount).toBe(4)
      expect(assetCount + sceneCount).toBe(9)
    })

    it('角色图本身超过 9 个时也截断为 9 个', () => {
      const avatarRefs: AvatarReferenceData[] = Array.from({ length: 12 }, (_, i) => ({
        avatarAssetUrl: `asset://asset-many${i}`,
        characterName: `角色${i}`,
      }))

      const params = buildParams(avatarRefs, [
        'https://oss.example.com/frames/frame_1.jpg',
      ])
      const result = buildAvatarReferenceData(params)

      expect(result.referenceImages.length).toBe(9)
      // 全部为角色图，场景帧无空间
      expect(result.referenceImages.every(u => u.startsWith('asset://'))).toBe(true)
    })
  })

  // --- 无场景帧降级 ---
  describe('无场景帧降级', () => {
    it('无场景帧时仅使用角色图', () => {
      const params = buildParams(
        [{ avatarAssetUrl: 'asset://asset-solo123', characterName: '独角色' }],
        [] // 无场景帧
      )

      const result = buildAvatarReferenceData(params)

      expect(result.referenceImages.length).toBe(1)
      expect(result.referenceImages[0]).toBe('asset://asset-solo123')
      // prompt 中不应出现 "场景" 引用
      expect(result.cleanPrompt).not.toContain('场景')
    })

    it('场景帧全部为无效 URL 时仅使用角色图', () => {
      const params = buildParams(
        [{ avatarAssetUrl: 'asset://asset-only111', characterName: '纯角色' }],
        ['', 'http://insecure.com/frame.jpg', 'invalid-url'] // 无有效 https:// URL
      )

      const result = buildAvatarReferenceData(params)

      expect(result.referenceImages.length).toBe(1)
      expect(result.referenceImages[0]).toBe('asset://asset-only111')
    })
  })

  // --- prompt 引用格式正确性 ---
  describe('prompt 引用格式正确性', () => {
    it('1 角色 + 1 场景帧的 prompt 包含正确引用', () => {
      const params = buildParams(
        [{ avatarAssetUrl: 'asset://asset-hero001', characterName: '英雄' }],
        ['https://oss.example.com/frames/frame_1.jpg']
      )

      const result = buildAvatarReferenceData(params)

      // 应包含 "图片1" 引用角色
      expect(result.cleanPrompt).toContain('图片1')
      // 应包含 "图片2" 引用场景
      expect(result.cleanPrompt).toContain('图片2')
      // 角色相关描述
      expect(result.cleanPrompt).toContain('角色')
      // 场景相关描述
      expect(result.cleanPrompt).toContain('场景')
    })

    it('2 角色 + 2 场景帧的 prompt 包含图片1-4 引用', () => {
      const params = buildParams(
        [
          { avatarAssetUrl: 'asset://asset-charA', characterName: '角色甲' },
          { avatarAssetUrl: 'asset://asset-charB', characterName: '角色乙' },
        ],
        [
          'https://oss.example.com/frames/frame_1.jpg',
          'https://oss.example.com/frames/frame_2.jpg',
        ]
      )

      const result = buildAvatarReferenceData(params)

      expect(result.cleanPrompt).toContain('图片1')
      expect(result.cleanPrompt).toContain('图片2')
      expect(result.cleanPrompt).toContain('图片3')
      expect(result.cleanPrompt).toContain('图片4')
      expect(result.cleanPrompt).toContain('角色')
      expect(result.cleanPrompt).toContain('场景')
    })

    it('prompt 包含角色名称', () => {
      const params = buildParams(
        [{ avatarAssetUrl: 'asset://asset-named', characterName: '小明' }],
        ['https://oss.example.com/frames/frame_1.jpg']
      )

      const result = buildAvatarReferenceData(params)

      expect(result.cleanPrompt).toContain('小明')
    })

    it('无角色引用时返回原始 prompt（不含素材引用标记）', () => {
      const params = buildParams(
        [], // 空角色列表
        ['https://oss.example.com/frames/frame_1.jpg']
      )

      const result = buildAvatarReferenceData(params)

      // 无角色时原始 prompt 直接返回
      expect(result.cleanPrompt).toContain('角色站在街道上')
    })
  })
})
