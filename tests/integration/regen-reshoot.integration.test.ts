/**
 * 集成测试 16.3：单版本重生成 / 局部重拍（真实 Seedance + FFmpeg）
 *
 * 验证受影响范围重渲染与承接不断裂（需求 4.2, 4.3, 4.5）。
 *
 * 真实接口：真实 Seedance 生成 + 真实 FFmpeg 合成 + 真实 prisma 计费。不 mock 业务流程。
 *
 * 运行前置（否则 skipped）：
 *   RUN_INTEGRATION=1、INTEGRATION_RENDER_READY=1（操作者确认已配置真实 Seedance/FFmpeg/OSS）
 *   DATABASE_URL、INTEGRATION_USER_ID（足额积分）
 *   INTEGRATION_BRIEF_ID、INTEGRATION_VARIANT_ID（该 brief 下真实版本）
 *   INTEGRATION_SHOT_TASK_ID（该 brief 下真实镜头，含 framingGuide.scene 承接数据）
 */

import { describe, it, expect } from 'vitest'
import { integrationEnabled, skipReason, env } from './_integration-gate'

const REQUIRED = [
  'DATABASE_URL',
  'INTEGRATION_USER_ID',
  'INTEGRATION_BRIEF_ID',
  'INTEGRATION_VARIANT_ID',
  'INTEGRATION_SHOT_TASK_ID',
  'INTEGRATION_RENDER_READY',
]
const enabled = integrationEnabled(REQUIRED)

describe.skipIf(!enabled)('集成16.3 单版本重生成 / 局部重拍（真实 Seedance + FFmpeg）', () => {
  if (!enabled) {
    console.info(`[integration 16.3] skipped: ${skipReason(REQUIRED)}`)
  }

  it('受影响范围闭包：computeReshootScope 含被重拍镜头本身（承接链纯计算，不消耗积分）', async () => {
    const { computeReshootScope } = await import('@/lib/merchant/impact-scope-service')
    const contentBriefId = env('INTEGRATION_BRIEF_ID')
    const shotTaskId = env('INTEGRATION_SHOT_TASK_ID')

    const scope = await computeReshootScope({ contentBriefId, shotTaskId })
    expect(Array.isArray(scope.affectedGroupIds)).toBe(true)
    expect(scope.affectedGroupIds).toContain(shotTaskId)
    // 触发承接链时受影响集合应超过被重拍镜头本身
    if (scope.hasContinuityChain) {
      expect(scope.affectedGroupIds.length).toBeGreaterThan(1)
    }
  }, 60_000)

  it('单版本重生成：仅替换目标版本，其它版本保留（隔离性，Property 14）', async () => {
    const { regenerateSingleVariant } = await import('@/lib/merchant/local-render-service')
    const { prisma } = await import('@/lib/shared/db')

    const userId = env('INTEGRATION_USER_ID')
    const contentBriefId = env('INTEGRATION_BRIEF_ID')
    const videoVariantId = env('INTEGRATION_VARIANT_ID')

    const beforeIds = (
      await prisma.videoVariant.findMany({ where: { contentBriefId }, select: { id: true } })
    ).map((v) => v.id).sort()

    const result = await regenerateSingleVariant({ videoVariantId, userId })
    expect(result).toBeTruthy()
    expect(result.id).toBe(videoVariantId)

    const afterIds = (
      await prisma.videoVariant.findMany({ where: { contentBriefId }, select: { id: true } })
    ).map((v) => v.id).sort()

    // 版本集合不变（仅目标版本被原地替换/更新，其它版本保留）
    expect(afterIds).toEqual(beforeIds)
  }, 600_000)

  it('局部重拍：仅重渲染受影响范围并返回受影响版本（regenScope 标注）', async () => {
    const { rerenderAffectedScope } = await import('@/lib/merchant/local-render-service')
    const userId = env('INTEGRATION_USER_ID')
    const contentBriefId = env('INTEGRATION_BRIEF_ID')
    const shotTaskId = env('INTEGRATION_SHOT_TASK_ID')

    const variants = await rerenderAffectedScope({ contentBriefId, shotTaskId, userId })
    expect(Array.isArray(variants)).toBe(true)
    expect(variants.length).toBeGreaterThan(0)
    // 受影响版本应带 regenScope 追溯（需求 4.5）
    expect(variants[0]).toHaveProperty('regenScope')
  }, 600_000)
})
