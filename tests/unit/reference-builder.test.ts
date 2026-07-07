import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildReferenceData } from '@/lib/video/reference-builder'

/**
 * 单元测试: reference-builder
 * 验证 buildReferenceData 各种输入组合
 *
 * 参考模型：first_frame / reference_video 流程已废弃，统一走
 * 「文本 + 多模态参考(reference_image/reference_audio)」。reference_image 来自
 * 无人脸场景帧(sceneFrameUrls) + 分镜关联的非角色素材图；reference_audio 取
 * groupAudioUrl（需至少 1 张参考图才生效）。
 */
describe('buildReferenceData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const baseShotWithAssets = {
    id: 'shot-1',
    orderIndex: 0,
    coverUrl: 'https://oss.example.com/cover.jpg',
    prompt: '参考[图1]生成一个女孩跳舞的视频',
    shotAssets: [
      { displayNum: 1, asset: { url: 'https://oss.example.com/asset1.jpg' } },
      { displayNum: 2, asset: { url: 'https://oss.example.com/asset2.jpg' } },
    ],
  }

  describe('多模态参考场景', () => {
    it('解析 [图N] 并以非角色素材图组装 referenceImages', () => {
      const result = buildReferenceData({
        shot: baseShotWithAssets,
        projectId: 'proj-1',
      })

      // cleanPrompt 不含 [图N]
      expect(result.cleanPrompt).not.toMatch(/\[图\d+\]/)
      expect(result.cleanPrompt).toBe('参考生成一个女孩跳舞的视频')

      // referenceImages 来自分镜关联的非角色素材图
      expect(result.referenceImages).toContain('https://oss.example.com/asset1.jpg')
      expect(result.referenceImages).toContain('https://oss.example.com/asset2.jpg')

      // 未传 groupAudioUrl → 无 reference_audio
      expect(result.referenceAudioUrl).toBeUndefined()
    })

    it('sceneFrameUrls(无人脸场景帧) 进入 referenceImages，排在素材图之前', () => {
      const result = buildReferenceData({
        shot: baseShotWithAssets,
        projectId: 'proj-1',
        sceneFrameUrls: [
          'https://oss.example.com/scene1.jpg',
          'https://localhost/scene-bad.jpg', // 非公网，应被过滤
        ],
      })

      expect(result.referenceImages).toEqual([
        'https://oss.example.com/scene1.jpg',
        'https://oss.example.com/asset1.jpg',
        'https://oss.example.com/asset2.jpg',
      ])
    })

    it('groupAudioUrl 有效且存在参考图时填充 referenceAudioUrl', () => {
      const result = buildReferenceData({
        shot: baseShotWithAssets,
        projectId: 'proj-1',
        groupAudioUrl: 'https://oss.example.com/group-audio.mp3',
      })

      // 有参考图(素材图) + 有效公网音频 → 填充
      expect(result.referenceImages.length).toBeGreaterThan(0)
      expect(result.referenceAudioUrl).toBe('https://oss.example.com/group-audio.mp3')
    })

    it('无参考图时即使有 groupAudioUrl 也不填充 referenceAudioUrl（Seedance 硬约束）', () => {
      const noAssetShot = {
        id: 'shot-no-asset',
        orderIndex: 0,
        coverUrl: null,
        prompt: 'pure text',
        shotAssets: [],
      }

      const result = buildReferenceData({
        shot: noAssetShot,
        projectId: 'proj-1',
        groupAudioUrl: 'https://oss.example.com/group-audio.mp3',
      })

      expect(result.referenceImages).toEqual([])
      expect(result.referenceAudioUrl).toBeUndefined()
    })
  })

  describe('无数据场景（降级）', () => {
    it('所有字段为空时降级为纯文生视频模式', () => {
      const emptyShot = {
        id: 'shot-2',
        orderIndex: 1,
        coverUrl: null,
        prompt: 'simple text prompt',
        shotAssets: [],
      }

      const result = buildReferenceData({
        shot: emptyShot,
        projectId: 'proj-2',
      })

      expect(result.cleanPrompt).toBe('simple text prompt')
      expect(result.referenceImages).toEqual([])
      expect(result.referenceAudioUrl).toBeUndefined()
    })

    it('prompt 为 null 时 cleanPrompt 返回空字符串', () => {
      const nullPromptShot = {
        id: 'shot-3',
        orderIndex: 0,
        coverUrl: null,
        prompt: null,
        shotAssets: [],
      }

      const result = buildReferenceData({
        shot: nullPromptShot,
        projectId: 'proj-3',
      })

      expect(result.cleanPrompt).toBe('')
    })
  })

  describe('约束测试', () => {
    it('referenceImages 最多 9 张（场景帧 + 素材图去重后截断）', () => {
      // 12 个无人脸场景帧 + 2 个素材图，去重后应被截断到 9
      const manySceneFrames = Array.from(
        { length: 12 },
        (_, i) => `https://oss.example.com/scene${i}.jpg`
      )

      const result = buildReferenceData({
        shot: baseShotWithAssets,
        projectId: 'proj-1',
        sceneFrameUrls: manySceneFrames,
      })

      expect(result.referenceImages.length).toBe(9)
      // 场景帧排在最前，先被纳入
      expect(result.referenceImages[0]).toBe('https://oss.example.com/scene0.jpg')
    })
  })
})
