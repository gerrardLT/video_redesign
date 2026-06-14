import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: virtual-avatar-reshaping
 *
 * 属性测试:
 * - Property 10: Avatar 模式 Content 类型限制 (Validates: Requirements 8.4, 8.5, 8.6)
 * - Property 11: Avatar 不可用时生成阻断 (Validates: Requirements 10.4)
 *
 * 单元测试:
 * - 测试请求构建：仅 text + image_url，无 video_url/audio_url
 * - 测试 asset:// URL 正确传入 content 数组
 * - 测试 referenceImages 数量上限截断
 */

// ========================
// Mock setup
// ========================

let mockFetch: ReturnType<typeof vi.fn>

beforeEach(() => {
  process.env.SEEDANCE_API_KEY = 'test-seedance-key'
  process.env.SEEDANCE_API_URL = 'https://ark.test.com/api/v3'

  mockFetch = vi.fn()
  vi.stubGlobal('fetch', mockFetch)
  vi.resetModules()
})

afterEach(() => {
  delete process.env.SEEDANCE_API_KEY
  delete process.env.SEEDANCE_API_URL
  vi.unstubAllGlobals()
  vi.resetModules()
})

// ========================
// Helper
// ========================

async function importSeedanceModule() {
  return await import('@/lib/seedance')
}

async function importReferenceBuilderModule() {
  return await import('@/lib/reference-builder')
}

// ========================
// 生成器
// ========================

/** 生成有效的 asset:// URL */
const assetUrlArb = fc.stringMatching(/^asset:\/\/asset-[a-zA-Z0-9]{6,12}$/)

/** 生成有效的 https:// 场景帧 URL */
const sceneUrlArb = fc.stringMatching(/^https:\/\/oss\.example\.com\/frames\/frame_[0-9]{1,4}\.(jpg|png)$/)

/** 生成 referenceImages 数组（混合 asset:// 和 https://） */
const referenceImagesArb = fc.array(
  fc.oneof(assetUrlArb, sceneUrlArb),
  { minLength: 1, maxLength: 9 }
)

/** 生成非空 prompt */
const promptArb = fc.array(
  fc.constantFrom('角', '色', '在', '场', '景', '中', '走', '动', '作'),
  { minLength: 5, maxLength: 50 }
).map(chars => chars.join(''))

// ========================
// Property 10: Avatar 模式 Content 类型限制
// Feature: virtual-avatar-reshaping, Property 10: Avatar 模式 Content 类型限制
// Validates: Requirements 8.4, 8.5, 8.6
// ========================

describe('Property 10: Avatar 模式 Content 类型限制', () => {
  it('createAvatarVideoTask 构建的 content 中 type 字段只有 "text" 或 "image_url"', async () => {
    const mod = await importSeedanceModule()

    await fc.assert(
      fc.asyncProperty(
        promptArb,
        referenceImagesArb,
        async (prompt, images) => {
          mockFetch.mockReset()
          mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ id: 'task-test-001' }),
          })

          await mod.createAvatarVideoTask({
            prompt,
            duration: 5,
            aspectRatio: '16:9',
            resolution: '720p',
            referenceImages: images,
          })

          // 解析实际发送的请求体
          expect(mockFetch).toHaveBeenCalledTimes(1)
          const callArgs = mockFetch.mock.calls[0]
          const requestBody = JSON.parse(callArgs[1].body)

          // 验证 content 数组中每个条目的 type 只能是 "text" 或 "image_url"
          for (const item of requestBody.content) {
            expect(['text', 'image_url']).toContain(item.type)
          }

          // 验证不包含 "video_url" 或 "audio_url"
          const types = requestBody.content.map((c: { type: string }) => c.type)
          expect(types).not.toContain('video_url')
          expect(types).not.toContain('audio_url')
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ========================
// Property 11: Avatar 不可用时生成阻断
// Feature: virtual-avatar-reshaping, Property 11: Avatar 不可用时生成阻断
// Validates: Requirements 10.4
// ========================

describe('Property 11: Avatar 不可用时生成阻断', () => {
  it('avatarAssetUrl 为 null/空时 buildAvatarReferenceData 中 avatarReferences 为空时仅返回原始 prompt 不含角色引用', async () => {
    const mod = await importReferenceBuilderModule()

    fc.assert(
      fc.property(
        // 原始 prompt
        fc.array(
          fc.constantFrom('角', '色', '在', '场', '景', '中', '走'),
          { minLength: 3, maxLength: 30 }
        ).map(chars => chars.join('')),
        // 场景帧 URL
        fc.array(sceneUrlArb, { minLength: 0, maxLength: 5 }),
        (originalPrompt, sceneUrls) => {
          // avatarReferences 为空数组（模拟 avatarAssetUrl 不可用）
          const result = mod.buildAvatarReferenceData({
            shot: {
              id: 'shot-test',
              orderIndex: 0,
              coverUrl: null,
              prompt: originalPrompt,
              shotAssets: [],
            },
            projectId: 'proj-test',
            avatarReferences: [], // 空 → 无可用角色
            sceneFrameUrls: sceneUrls,
          })

          // 不包含角色引用标记
          expect(result.cleanPrompt).not.toMatch(/图片\d+中的.+（角色外观参考）/)

          // referenceImages 中不应有 asset:// URL
          const assetUrls = result.referenceImages.filter(u => u.startsWith('asset://'))
          expect(assetUrls.length).toBe(0)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('avatarAssetUrl 为无效值（null/空字符串/非 asset:// 格式）时被过滤', async () => {
    const mod = await importReferenceBuilderModule()

    fc.assert(
      fc.property(
        // 无效的 avatarAssetUrl 值
        fc.oneof(
          fc.constant(''),
          fc.constant('http://invalid.com/not-asset'),
          fc.constant('ftp://wrong-protocol'),
        ),
        (invalidUrl) => {
          const result = mod.buildAvatarReferenceData({
            shot: {
              id: 'shot-test',
              orderIndex: 0,
              coverUrl: null,
              prompt: '测试场景',
              shotAssets: [],
            },
            projectId: 'proj-test',
            avatarReferences: [
              { avatarAssetUrl: invalidUrl, characterName: '无效角色' },
            ],
            sceneFrameUrls: ['https://oss.example.com/frames/frame_1.jpg'],
          })

          // 无效的 asset:// URL 应被过滤，不出现在 referenceImages 中
          const assetUrls = result.referenceImages.filter(u => u.startsWith('asset://'))
          expect(assetUrls.length).toBe(0)
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ========================
// 单元测试: Seedance Avatar 模式
// ========================

describe('Seedance Avatar 模式单元测试', () => {
  // --- 请求构建 ---
  describe('createAvatarVideoTask - 请求构建', () => {
    it('仅构建 text + image_url，无 video_url/audio_url', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'task-build-001' }),
      })

      const mod = await importSeedanceModule()
      await mod.createAvatarVideoTask({
        prompt: '图片1中的虚拟角色站在图片2的城市街道场景中',
        duration: 10,
        aspectRatio: '16:9',
        resolution: '720p',
        referenceImages: [
          'asset://asset-hero123',
          'https://oss.example.com/frames/frame_3.jpg',
        ],
      })

      const [url, options] = mockFetch.mock.calls[0]
      expect(url).toContain('/contents/generations/tasks')
      expect(options.method).toBe('POST')

      const body = JSON.parse(options.body)

      // 验证 content 结构
      expect(body.content).toHaveLength(3) // 1 text + 2 image_url
      expect(body.content[0]).toEqual({
        type: 'text',
        text: '图片1中的虚拟角色站在图片2的城市街道场景中',
      })
      expect(body.content[1]).toEqual({
        type: 'image_url',
        image_url: { url: 'asset://asset-hero123' },
        role: 'reference_image',
      })
      expect(body.content[2]).toEqual({
        type: 'image_url',
        image_url: { url: 'https://oss.example.com/frames/frame_3.jpg' },
        role: 'reference_image',
      })

      // 验证无 video_url/audio_url
      const types = body.content.map((c: { type: string }) => c.type)
      expect(types).not.toContain('video_url')
      expect(types).not.toContain('audio_url')
    })

    it('请求体不包含 reference_video 和 reference_audio 相关字段', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'task-build-002' }),
      })

      const mod = await importSeedanceModule()
      await mod.createAvatarVideoTask({
        prompt: '测试',
        duration: 5,
        aspectRatio: '16:9',
        resolution: '720p',
        referenceImages: ['asset://asset-test'],
      })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)

      // 请求体顶层不应有 reference_video/reference_audio
      expect(body).not.toHaveProperty('reference_video')
      expect(body).not.toHaveProperty('reference_videos')
      expect(body).not.toHaveProperty('reference_audio')

      // content 中不应有 video_url/audio_url 类型
      for (const item of body.content) {
        expect(item.type).not.toBe('video_url')
        expect(item.type).not.toBe('audio_url')
      }
    })
  })

  // --- asset:// URL 正确传入 ---
  describe('createAvatarVideoTask - asset:// URL 传入', () => {
    it('asset:// URL 以 image_url 形式正确传入 content 数组', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'task-asset-001' }),
      })

      const mod = await importSeedanceModule()
      await mod.createAvatarVideoTask({
        prompt: '虚拟角色走路',
        duration: 5,
        aspectRatio: '16:9',
        resolution: '720p',
        referenceImages: [
          'asset://asset-abc123',
          'asset://asset-def456',
        ],
      })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)

      // 验证 asset:// URL 被正确包裹为 image_url 类型
      const imageItems = body.content.filter(
        (c: { type: string }) => c.type === 'image_url'
      )
      expect(imageItems).toHaveLength(2)
      expect(imageItems[0].image_url.url).toBe('asset://asset-abc123')
      expect(imageItems[0].role).toBe('reference_image')
      expect(imageItems[1].image_url.url).toBe('asset://asset-def456')
      expect(imageItems[1].role).toBe('reference_image')
    })

    it('混合 asset:// 和 https:// URL 均以 reference_image role 传入', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'task-mixed-001' }),
      })

      const mod = await importSeedanceModule()
      await mod.createAvatarVideoTask({
        prompt: '角色与场景',
        duration: 5,
        aspectRatio: '16:9',
        resolution: '720p',
        referenceImages: [
          'asset://asset-hero',
          'https://oss.example.com/frame_1.jpg',
          'https://oss.example.com/frame_2.jpg',
        ],
      })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      const imageItems = body.content.filter(
        (c: { type: string }) => c.type === 'image_url'
      )

      // 所有图片均使用 role=reference_image
      for (const item of imageItems) {
        expect(item.role).toBe('reference_image')
      }
    })
  })

  // --- referenceImages 数量上限截断 ---
  describe('createAvatarVideoTask - 数量上限截断', () => {
    it('referenceImages 超过 9 张时截断为 9 张', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'task-limit-001' }),
      })

      const images = Array.from({ length: 15 }, (_, i) =>
        `asset://asset-img${String(i).padStart(3, '0')}`
      )

      const mod = await importSeedanceModule()
      await mod.createAvatarVideoTask({
        prompt: '大量参考图测试',
        duration: 10,
        aspectRatio: '16:9',
        resolution: '720p',
        referenceImages: images,
      })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      const imageItems = body.content.filter(
        (c: { type: string }) => c.type === 'image_url'
      )

      // 最多 9 张
      expect(imageItems.length).toBeLessThanOrEqual(9)
    })

    it('referenceImages 恰好 9 张时全部传入', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'task-exact-001' }),
      })

      const images = Array.from({ length: 9 }, (_, i) =>
        `asset://asset-exact${i}`
      )

      const mod = await importSeedanceModule()
      await mod.createAvatarVideoTask({
        prompt: '恰好9张',
        duration: 5,
        aspectRatio: '16:9',
        resolution: '720p',
        referenceImages: images,
      })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      const imageItems = body.content.filter(
        (c: { type: string }) => c.type === 'image_url'
      )

      expect(imageItems).toHaveLength(9)
    })
  })

  // --- API 错误处理 ---
  describe('createAvatarVideoTask - 错误处理', () => {
    it('API_KEY 未配置时抛出错误', async () => {
      delete process.env.SEEDANCE_API_KEY
      vi.resetModules()

      const mockFetchLocal = vi.fn()
      vi.stubGlobal('fetch', mockFetchLocal)

      const mod = await importSeedanceModule()
      await expect(
        mod.createAvatarVideoTask({
          prompt: '测试',
          duration: 5,
          aspectRatio: '16:9',
          resolution: '720p',
          referenceImages: ['asset://asset-test'],
        })
      ).rejects.toThrow(/未配置/)
    })

    it('API 返回非 200 时抛出错误', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Bad Request: 请求格式错误'),
      })

      const mod = await importSeedanceModule()
      await expect(
        mod.createAvatarVideoTask({
          prompt: '失败测试',
          duration: 5,
          aspectRatio: '16:9',
          resolution: '720p',
          referenceImages: ['asset://asset-fail'],
        })
      ).rejects.toThrow(/400/)
    })
  })
})
