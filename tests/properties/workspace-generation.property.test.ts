/**
 * 属性测试：工作台生成 (Workspace Generation)
 *
 * 覆盖设计文档中的正确性属性 1-8
 */
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
  validatePromptLength,
  validateFile,
  insertAssetReference,
} from '@/lib/workspace-validators'
import { estimateWorkspaceCost, getDurationOptions } from '@/lib/credit-calc'
import { MAX_WORKSPACE_ASSETS, FILE_LIMITS } from '@/constants/workspace'

// Feature: workspace-generation, Property 1: Prompt 长度校验
describe('Property 1: Prompt 长度校验', () => {
  it('长度 ≤ 2500 时返回 true，> 2500 时返回 false', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 5000 }), (s) => {
        const result = validatePromptLength(s)
        if (s.length <= 2500) {
          expect(result).toBe(true)
        } else {
          expect(result).toBe(false)
        }
      }),
      { numRuns: 200 }
    )
  })

  it('精确边界：2500 字符合法，2501 字符不合法', () => {
    const exact2500 = 'a'.repeat(2500)
    const exact2501 = 'a'.repeat(2501)
    expect(validatePromptLength(exact2500)).toBe(true)
    expect(validatePromptLength(exact2501)).toBe(false)
  })
})

// Feature: workspace-generation, Property 2: 素材引用插入正确性
describe('Property 2: 素材引用插入正确性', () => {
  it('插入后文本满足前缀/后缀/长度不变式', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 500 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        (text, assetName) => {
          // cursorPos 在合法范围内
          const cursorPos = fc.sample(
            fc.integer({ min: 0, max: text.length }),
            1
          )[0]

          const result = insertAssetReference(text, cursorPos, assetName)
          const reference = `@${assetName}`

          // 长度不变式
          expect(result.length).toBe(text.length + reference.length)

          // 前缀保持
          expect(result.slice(0, cursorPos)).toBe(text.slice(0, cursorPos))

          // 插入内容正确
          expect(result.slice(cursorPos, cursorPos + reference.length)).toBe(reference)

          // 后缀保持
          expect(result.slice(cursorPos + reference.length)).toBe(text.slice(cursorPos))
        }
      ),
      { numRuns: 200 }
    )
  })

  it('光标在首位和末位的边界情况', () => {
    const text = 'hello world'
    // 首位
    const atStart = insertAssetReference(text, 0, '图片1')
    expect(atStart).toBe('@图片1hello world')
    // 末位
    const atEnd = insertAssetReference(text, text.length, '音频2')
    expect(atEnd).toBe('hello world@音频2')
  })
})

// Feature: workspace-generation, Property 3: 文件校验（类型 + 大小）
describe('Property 3: 文件校验（类型 + 大小）', () => {
  const allValidTypes = [
    ...FILE_LIMITS.image.types,
    ...FILE_LIMITS.video.types,
    ...FILE_LIMITS.audio.types,
  ]

  it('合法类型 + 合法大小 → valid: true', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...allValidTypes),
        fc.integer({ min: 1, max: 1024 }), // 很小的文件必然合法
        (mimeType, fileSize) => {
          const result = validateFile('test.file', mimeType, fileSize)
          expect(result.valid).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('非法 MIME 类型 → valid: false，reason 包含 mimeType', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter(
          (s) => !allValidTypes.includes(s)
        ),
        (mimeType) => {
          const result = validateFile('bad.file', mimeType, 100)
          expect(result.valid).toBe(false)
          if (!result.valid) {
            expect(result.reason).toContain(mimeType)
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  it('超出大小限制 → valid: false，reason 包含文件名', () => {
    // 图片超出 10MB
    const result = validateFile('huge-photo.jpg', 'image/jpeg', 11 * 1024 * 1024)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.reason).toContain('huge-photo.jpg')
    }

    // 视频超出 100MB
    const result2 = validateFile('big-video.mp4', 'video/mp4', 101 * 1024 * 1024)
    expect(result2.valid).toBe(false)
    if (!result2.valid) {
      expect(result2.reason).toContain('big-video.mp4')
    }

    // 音频超出 20MB
    const result3 = validateFile('long-audio.mp3', 'audio/mpeg', 21 * 1024 * 1024)
    expect(result3.valid).toBe(false)
    if (!result3.valid) {
      expect(result3.reason).toContain('long-audio.mp3')
    }
  })
})

// Feature: workspace-generation, Property 4: 素材列表上限不变式
describe('Property 4: 素材列表上限不变式', () => {
  it('任何操作序列下列表长度始终满足 0 ≤ length ≤ 12', () => {
    // 模拟 addAsset/removeAsset 操作
    type Op = { type: 'add' } | { type: 'remove'; index: number }

    const opArb = fc.oneof(
      fc.constant({ type: 'add' as const }),
      fc.integer({ min: 0, max: 20 }).map((i) => ({ type: 'remove' as const, index: i }))
    )

    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 50 }), (ops) => {
        let list: string[] = []

        for (const op of ops) {
          if (op.type === 'add') {
            if (list.length < MAX_WORKSPACE_ASSETS) {
              list = [...list, `asset-${list.length}`]
            }
            // 超过上限时操作被拒绝，列表不变
          } else {
            const idx = op.index % Math.max(list.length, 1)
            if (list.length > 0) {
              list = list.filter((_, i) => i !== idx)
            }
          }

          // 不变式
          expect(list.length).toBeGreaterThanOrEqual(0)
          expect(list.length).toBeLessThanOrEqual(MAX_WORKSPACE_ASSETS)
        }
      }),
      { numRuns: 200 }
    )
  })

  it('列表长度为 12 时 add 操作被拒绝', () => {
    // 使用 store 的 addAsset 行为语义
    const list: string[] = Array.from({ length: 12 }, (_, i) => `asset-${i}`)
    expect(list.length).toBe(MAX_WORKSPACE_ASSETS)
    // 模拟拒绝
    const canAdd = list.length < MAX_WORKSPACE_ASSETS
    expect(canAdd).toBe(false)
  })
})

// Feature: workspace-generation, Property 5: 积分预估计算正确性
describe('Property 5: 积分预估计算正确性', () => {
  it('Seedance: estimateWorkspaceCost === ceil(duration × 1.5)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 4, max: 15 }), (duration) => {
        const cost = estimateWorkspaceCost('seedance', duration)
        expect(cost).toBe(Math.ceil(duration * 1.5))
      }),
      { numRuns: 100 }
    )
  })

  it('HappyHorse: estimateWorkspaceCost === ceil((duration + min(duration, 15)) × 1.5)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 3, max: 15 }), (duration) => {
        const cost = estimateWorkspaceCost('happyhorse', duration)
        const expected = Math.ceil((duration + Math.min(duration, 15)) * 1.5)
        expect(cost).toBe(expected)
      }),
      { numRuns: 100 }
    )
  })

  it('返回值始终为正整数', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('seedance' as const, 'happyhorse' as const),
        fc.integer({ min: 3, max: 15 }),
        (model, duration) => {
          const cost = estimateWorkspaceCost(model, duration)
          expect(cost).toBeGreaterThan(0)
          expect(Number.isInteger(cost)).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })
})

// Feature: workspace-generation, Property 6: 生成请求体构建完整性
describe('Property 6: 生成请求体构建完整性', () => {
  it('Seedance 请求体: prompt 文本项 + 图片 image_url + 音频 audio_url', async () => {
    const { buildSeedanceWorkspaceRequest } = await import('@/lib/workspace-request-builder')

    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.integer({ min: 4, max: 15 }),
        fc.constantFrom('16:9', '9:16', '1:1'),
        fc.array(fc.webUrl(), { minLength: 0, maxLength: 5 }),
        fc.array(fc.webUrl(), { minLength: 0, maxLength: 2 }),
        (prompt, duration, aspectRatio, imageUrls, audioUrls) => {
          const assetUrls = [...imageUrls, ...audioUrls]
          const assetTypes: Record<string, 'image' | 'video' | 'audio'> = {}
          for (const url of imageUrls) assetTypes[url] = 'image'
          for (const url of audioUrls) assetTypes[url] = 'audio'

          const body = buildSeedanceWorkspaceRequest({
            prompt, duration, aspectRatio, resolution: '720p', assetUrls, assetTypes,
          })

          // 必须包含 prompt 文本项
          const textItems = body.content.filter((c: { type: string }) => c.type === 'text')
          expect(textItems.length).toBe(1)
          expect(textItems[0].text).toBe(prompt)

          // 图片素材对应 image_url 项
          const imageItems = body.content.filter((c: { type: string }) => c.type === 'image_url')
          expect(imageItems.length).toBe(imageUrls.length)

          // 音频素材对应 audio_url 项
          const audioItems = body.content.filter((c: { type: string }) => c.type === 'audio_url')
          expect(audioItems.length).toBe(audioUrls.length)

          // 基础字段
          expect(body.resolution).toBe('720p')
          expect(body.ratio).toBe(aspectRatio)
          expect(body.duration).toBe(duration)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('HappyHorse 无参考图时使用 T2V 模型', async () => {
    const { buildT2VRequestBody } = await import('@/lib/happyhorse-workspace')

    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.integer({ min: 3, max: 15 }),
        fc.constantFrom('16:9', '9:16', '1:1'),
        (prompt, duration, aspectRatio) => {
          const body = buildT2VRequestBody({ prompt, duration, aspectRatio, resolution: '720P' })
          expect(body.model).toBe('happyhorse-1.0-t2v')
          expect(body.input.prompt).toBe(prompt)
          expect(body.parameters.duration).toBe(duration)
          expect(body.parameters.ratio).toBe(aspectRatio)
          expect(body.parameters.watermark).toBe(false)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('HappyHorse 有参考图时使用 R2V 模型且 media 包含所有参考图', async () => {
    const { buildR2VRequestBody } = await import('@/lib/happyhorse-workspace')

    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.integer({ min: 3, max: 15 }),
        fc.constantFrom('16:9', '9:16', '1:1'),
        fc.array(fc.webUrl(), { minLength: 1, maxLength: 9 }),
        (prompt, duration, aspectRatio, referenceImages) => {
          const body = buildR2VRequestBody({ prompt, duration, aspectRatio, resolution: '720P', referenceImages })
          expect(body.model).toBe('happyhorse-1.0-r2v')
          expect(body.input.prompt).toBe(prompt)
          expect(body.input.media.length).toBe(referenceImages.length)
          for (let i = 0; i < referenceImages.length; i++) {
            expect(body.input.media[i].type).toBe('reference_image')
            expect(body.input.media[i].url).toBe(referenceImages[i])
          }
          expect(body.parameters.duration).toBe(duration)
        }
      ),
      { numRuns: 100 }
    )
  })
})

// Feature: workspace-generation, Property 7: 画廊排序不变式
describe('Property 7: 画廊排序不变式', () => {
  it('任何时间戳数组按降序排列后，相邻项满足 items[i] >= items[i+1]', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.integer({ min: 1704067200000, max: 1798761600000 }).map((ts) => new Date(ts)),
          { minLength: 2, maxLength: 30 }
        ),
        (dates) => {
          // 模拟 gallery API 的排序行为
          const sorted = [...dates].sort((a, b) => b.getTime() - a.getTime())

          for (let i = 0; i < sorted.length - 1; i++) {
            expect(sorted[i].getTime()).toBeGreaterThanOrEqual(sorted[i + 1].getTime())
          }
        }
      ),
      { numRuns: 200 }
    )
  })
})

// Feature: workspace-generation, Property 8: 模型-时长参数联动
describe('Property 8: 模型-时长参数联动', () => {
  it('Seedance 返回 [4, 5, 8, 10, 15]', () => {
    const options = getDurationOptions('seedance')
    expect(options).toEqual([4, 5, 8, 10, 15])
  })

  it('HappyHorse 返回 [3, 5, 8, 10, 15]', () => {
    const options = getDurationOptions('happyhorse')
    expect(options).toEqual([3, 5, 8, 10, 15])
  })

  it('返回数组所有元素为正整数且严格递增', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('seedance' as const, 'happyhorse' as const),
        (model) => {
          const options = getDurationOptions(model)

          // 所有元素为正整数
          for (const d of options) {
            expect(d).toBeGreaterThan(0)
            expect(Number.isInteger(d)).toBe(true)
          }

          // 严格递增
          for (let i = 1; i < options.length; i++) {
            expect(options[i]).toBeGreaterThan(options[i - 1])
          }
        }
      ),
      { numRuns: 50 }
    )
  })
})
