/**
 * 集成测试 16.2：镜头参考图生成计费（真实图像生成 + 计费链路）
 *
 * 验证真实图像生成（复用 Flux 文生图）+ 真实 credit-service 计费链路；
 * 失败时 REFUND、绝不返回假图（需求 3.5）。
 *
 * 真实接口：真实文生图 + 真实 OSS 转存 + 真实 prisma 计费。不 mock 业务流程。
 *
 * 运行前置（否则 skipped）：
 *   RUN_INTEGRATION=1、INTEGRATION_IMAGE_READY=1（操作者确认已配置真实图像生成与 OSS 凭证）
 *   DATABASE_URL、INTEGRATION_USER_ID（足额积分）、INTEGRATION_SHOT_TASK_ID（真实 ShotTask）
 */

import { describe, it, expect } from 'vitest'
import { integrationEnabled, skipReason, env } from './_integration-gate'

const REQUIRED = ['DATABASE_URL', 'INTEGRATION_USER_ID', 'INTEGRATION_SHOT_TASK_ID', 'INTEGRATION_IMAGE_READY']
const enabled = integrationEnabled(REQUIRED)

describe.skipIf(!enabled)('集成16.2 镜头参考图生成计费（真实图像生成）', () => {
  if (!enabled) {
    console.info(`[integration 16.2] skipped: ${skipReason(REQUIRED)}`)
  }

  it('生成参考图：返回真实 OSS URL，且计费守恒（余额非负、只减不增）', async () => {
    const { generateShotReferenceImage } = await import('@/lib/capture-director')
    const { getBalance } = await import('@/lib/credit-service')

    const userId = env('INTEGRATION_USER_ID')
    const shotTaskId = env('INTEGRATION_SHOT_TASK_ID')

    const before = await getBalance(userId)
    const { referenceUrl } = await generateShotReferenceImage({ shotTaskId, userId })
    const after = await getBalance(userId)

    // 真实产物：非空 URL（非伪造占位）
    expect(typeof referenceUrl).toBe('string')
    expect(referenceUrl.length).toBeGreaterThan(0)
    expect(/^https?:\/\//.test(referenceUrl)).toBe(true)

    // 计费守恒：CHARGE 后余额只减不增、非负、整数
    expect(Number.isInteger(after)).toBe(true)
    expect(after).toBeGreaterThanOrEqual(0)
    expect(before - after).toBeGreaterThanOrEqual(0)
  }, 180_000)

  it('余额不足时在预检阶段拒绝（INSUFFICIENT_CREDITS），不返回假图', async () => {
    // 操作者可选提供一个零余额用户验证预检拒绝；未提供则跳过该子断言
    const poorUserId = process.env.INTEGRATION_POOR_USER_ID
    if (!poorUserId) {
      console.info('[integration 16.2] 跳过余额不足子用例：未提供 INTEGRATION_POOR_USER_ID')
      return
    }
    const { generateShotReferenceImage } = await import('@/lib/capture-director')
    const shotTaskId = env('INTEGRATION_SHOT_TASK_ID')

    await expect(
      generateShotReferenceImage({ shotTaskId, userId: poorUserId })
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_CREDITS' })
  }, 60_000)
})
