/**
 * 集成测试: Video Pipeline
 * 验证 buildReferenceData 函数在各种输入组合下的端到端行为，
 * 模拟完整管线从 shot 数据到 Seedance 参考数据的转换。
 *
 * 测试模块组合:
 * - prompt-parser.ts (resolveReferences)
 * - reference-builder.ts (buildReferenceData)
 *
 * 参考模型：first_frame / reference_video 已废弃，统一走
 * 「文本 + asset:// 人物锚定 / 多模态参考」。reference_image = 无人脸场景帧
 * (sceneFrameUrls) + 分镜关联的非角色素材图；[图N] 仅用于清洗 cleanPrompt，
 * 不再筛选 referenceImages。
 */

import { describe, it, expect } from 'vitest'
import { buildReferenceData } from '@/lib/reference-builder'

describe('Video Pipeline Integration Tests', () => {
  // ===================================================================
  // 9.1 完整参考管线测试
  // ===================================================================
  describe('9.1 完整参考管线', () => {
    it('有 shotAssets + coverUrl → 多模态参考数据正确', () => {
      const result = buildReferenceData({
        shot: {
          id: 'shot-1',
          orderIndex: 0,
          coverUrl: 'https://oss.example.com/cover.jpg',
          prompt: 'A girl [图1] dancing with [图2]',
          shotAssets: [
            { displayNum: 1, asset: { url: 'https://oss.example.com/asset1.jpg' } },
            { displayNum: 2, asset: { url: 'https://oss.example.com/asset2.jpg' } },
          ],
        },
        projectId: 'proj-1',
      })

      // cleanPrompt: [图N] 标记已移除
      expect(result.cleanPrompt).toBe('A girl dancing with')
      expect(result.cleanPrompt).not.toMatch(/\[图\d+\]/)

      // referenceImages: 分镜关联的非角色素材图
      expect(result.referenceImages).toContain('https://oss.example.com/asset1.jpg')
      expect(result.referenceImages).toContain('https://oss.example.com/asset2.jpg')

      // 未传 groupAudioUrl → 无 reference_audio
      expect(result.referenceAudioUrl).toBeUndefined()

      // 约束: referenceImages ≤ 9
      expect(result.referenceImages.length).toBeLessThanOrEqual(9)
    })
  })

  // ===================================================================
  // 9.2 最小化管线测试
  // ===================================================================
  describe('9.2 最小化管线', () => {
    it('全部缺失 → 降级为纯文生视频', () => {
      const result = buildReferenceData({
        shot: {
          id: 'shot-2',
          orderIndex: 0,
          coverUrl: null,
          prompt: 'just text',
          shotAssets: [],
        },
        projectId: 'proj-2',
      })

      // 纯文本 prompt 原样保留
      expect(result.cleanPrompt).toBe('just text')

      // 无任何参考数据
      expect(result.referenceImages).toEqual([])
      expect(result.referenceAudioUrl).toBeUndefined()
    })

    it('prompt 为 null + 所有参考为空 → 安全降级', () => {
      const result = buildReferenceData({
        shot: {
          id: 'shot-empty',
          orderIndex: 0,
          coverUrl: null,
          prompt: null,
          shotAssets: [],
        },
        projectId: 'proj-empty',
      })

      expect(result.cleanPrompt).toBe('')
      expect(result.referenceImages).toEqual([])
    })
  })

  // ===================================================================
  // 9.3 短视频管线测试
  // ===================================================================
  describe('9.3 短视频管线', () => {
    it('短视频模式：单任务使用第一分镜数据', () => {
      // 模拟批量路由中短视频模式只取第一个分镜
      const shots = [
        {
          id: 'shot-first',
          orderIndex: 0,
          coverUrl: 'https://oss.example.com/first-cover.jpg',
          prompt: 'first shot prompt [图1]',
          shotAssets: [
            { displayNum: 1, asset: { url: 'https://oss.example.com/first-asset.jpg' } },
          ],
        },
        {
          id: 'shot-second',
          orderIndex: 1,
          coverUrl: 'https://oss.example.com/second-cover.jpg',
          prompt: 'second shot prompt',
          shotAssets: [],
        },
      ]

      // 短视频模式只用第一个分镜
      const primaryShot = shots[0]
      const result = buildReferenceData({
        shot: primaryShot,
        projectId: 'proj-short',
      })

      // 验证使用的是第一分镜的数据：素材图来自第一分镜，cleanPrompt 为第一分镜
      expect(result.referenceImages).toContain('https://oss.example.com/first-asset.jpg')
      expect(result.referenceImages).not.toContain('https://oss.example.com/second-cover.jpg')
      expect(result.cleanPrompt).toBe('first shot prompt')
      expect(result.cleanPrompt).not.toMatch(/\[图\d+\]/)
    })
  })

  // ===================================================================
  // 9.4 单/批量一致性测试
  // ===================================================================
  describe('9.4 单/批量一致性', () => {
    it('同一 shot 同样参数 → 产出相同 ReferenceData', () => {
      const shot = {
        id: 'shot-4',
        orderIndex: 1,
        coverUrl: 'https://oss.example.com/cover.jpg',
        prompt: '[图1] test prompt with reference',
        shotAssets: [
          { displayNum: 1, asset: { url: 'https://oss.example.com/a1.jpg' } },
        ],
      }
      const params = {
        shot,
        projectId: 'proj-4',
      }

      // 模拟单分镜路由调用
      const resultSingle = buildReferenceData(params)
      // 模拟批量路由调用
      const resultBatch = buildReferenceData(params)

      // 产出完全一致
      expect(resultSingle).toEqual(resultBatch)
    })

    it('批量模式下每个 shot 独立构建且互不影响', () => {
      const shotA = {
        id: 'shot-a',
        orderIndex: 0,
        coverUrl: 'https://oss.example.com/cover-a.jpg',
        prompt: 'prompt A [图1]',
        shotAssets: [
          { displayNum: 1, asset: { url: 'https://oss.example.com/asset-a.jpg' } },
        ],
      }
      const shotB = {
        id: 'shot-b',
        orderIndex: 1,
        coverUrl: 'https://oss.example.com/cover-b.jpg',
        prompt: 'prompt B [图1]',
        shotAssets: [
          { displayNum: 1, asset: { url: 'https://oss.example.com/asset-b.jpg' } },
        ],
      }

      const commonParams = {
        projectId: 'proj-batch',
      }

      const resultA = buildReferenceData({ shot: shotA, ...commonParams })
      const resultB = buildReferenceData({ shot: shotB, ...commonParams })

      // 两个 shot 应该有不同的 cleanPrompt
      expect(resultA.cleanPrompt).toBe('prompt A')
      expect(resultB.cleanPrompt).toBe('prompt B')

      // 各自解析的素材引用不同且互不串扰
      expect(resultA.referenceImages).toContain('https://oss.example.com/asset-a.jpg')
      expect(resultA.referenceImages).not.toContain('https://oss.example.com/asset-b.jpg')
      expect(resultB.referenceImages).toContain('https://oss.example.com/asset-b.jpg')
      expect(resultB.referenceImages).not.toContain('https://oss.example.com/asset-a.jpg')
    })
  })

  // ===================================================================
  // 9.5 [图N] 解析测试
  // ===================================================================
  describe('9.5 [图N] 解析', () => {
    it('含多个引用 → cleanPrompt 无标记；referenceImages 含全部非角色素材图', () => {
      const result = buildReferenceData({
        shot: {
          id: 'shot-5',
          orderIndex: 0,
          coverUrl: null,
          prompt: '请参考[图1]的风格和[图3]的构图',
          shotAssets: [
            { displayNum: 1, asset: { url: 'https://oss.example.com/s1.jpg' } },
            { displayNum: 2, asset: { url: 'https://oss.example.com/s2.jpg' } },
            { displayNum: 3, asset: { url: 'https://oss.example.com/s3.jpg' } },
          ],
        },
        projectId: 'proj-5',
      })

      // cleanPrompt 不含任何 [图N] 标记
      expect(result.cleanPrompt).not.toMatch(/\[图\d+\]/)
      expect(result.cleanPrompt).toBe('请参考的风格和的构图')

      // referenceImages 纳入全部非角色素材图，不再按 [图N] 引用筛选
      // （[图N] 仅用于清洗 cleanPrompt）
      expect(result.referenceImages).toContain('https://oss.example.com/s1.jpg')
      expect(result.referenceImages).toContain('https://oss.example.com/s2.jpg')
      expect(result.referenceImages).toContain('https://oss.example.com/s3.jpg')
    })

    it('引用不存在的编号 → cleanPrompt 安全清洗，素材图照常纳入', () => {
      const result = buildReferenceData({
        shot: {
          id: 'shot-6',
          orderIndex: 0,
          coverUrl: null,
          prompt: '使用[图1]和[图5]的效果',
          shotAssets: [
            { displayNum: 1, asset: { url: 'https://oss.example.com/exists.jpg' } },
            // displayNum 5 不存在
          ],
        },
        projectId: 'proj-6',
      })

      // cleanPrompt 仍然清除了所有标记
      expect(result.cleanPrompt).not.toMatch(/\[图\d+\]/)
      expect(result.cleanPrompt).toBe('使用和的效果')

      // 存在的素材图被纳入 referenceImages
      expect(result.referenceImages).toContain('https://oss.example.com/exists.jpg')
      expect(result.referenceImages.length).toBe(1)
    })

    it('无引用标记的 prompt → cleanPrompt 原样；referenceImages 含分镜素材图', () => {
      const result = buildReferenceData({
        shot: {
          id: 'shot-7',
          orderIndex: 0,
          coverUrl: null,
          prompt: '一个简单的纯文本描述',
          shotAssets: [
            { displayNum: 1, asset: { url: 'https://oss.example.com/unused.jpg' } },
          ],
        },
        projectId: 'proj-7',
      })

      // 无标记，prompt 原样返回
      expect(result.cleanPrompt).toBe('一个简单的纯文本描述')

      // referenceImages 含分镜关联的素材图
      expect(result.referenceImages).toEqual(['https://oss.example.com/unused.jpg'])
    })
  })
})
