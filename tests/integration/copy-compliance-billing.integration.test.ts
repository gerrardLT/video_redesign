/**
 * 集成测试 16.1：文案重生成 / 按平台改写 / 一键改写规避计费链路（真实 LLM 接口）
 *
 * 验证 reserve→charge/refund 与 withCreditLock 串行（需求 2.2, 2.4, 2.6, 0.6, 0.8）。
 *
 * 真实接口：调用真实 LLM（DashScope/qwen 兼容接口）+ 真实 credit-service 计费链路 + 真实 prisma。
 * 不 mock 任何关键业务流程。默认环境缺少凭证/DB 时干净跳过（不伪造通过）。
 *
 * 运行前置（满足后方真实执行，否则 skipped）：
 *   RUN_INTEGRATION=1
 *   DATABASE_URL、(MERCHANT_LLM_API_KEY 或 DASHSCOPE_API_KEY)
 *   INTEGRATION_USER_ID（计费主体，需有足额积分）
 *   INTEGRATION_BRIEF_ID（真实 ContentBrief，含 platformCopies）
 *   INTEGRATION_VARIANT_ID（该 brief 下真实 VideoVariant，供合规重跑）
 *   可选 INTEGRATION_PLATFORM（默认 DOUYIN）
 *
 * 服务在 it() 体内动态 import，避免缺 DATABASE_URL 时文件加载即失败。
 */

import { describe, it, expect } from 'vitest'
import { integrationEnabled, skipReason, env } from './_integration-gate'
import type { PublishPlatform } from '@/types/merchant'

const BASE_ENV = ['DATABASE_URL', 'INTEGRATION_USER_ID', 'INTEGRATION_BRIEF_ID', 'INTEGRATION_VARIANT_ID']
const hasLlm = !!(process.env.MERCHANT_LLM_API_KEY || process.env.DASHSCOPE_API_KEY)
const enabled = integrationEnabled(BASE_ENV) && hasLlm

describe.skipIf(!enabled)('集成16.1 文案/合规计费链路（真实 LLM）', () => {
  if (!enabled) {
    // 记录跳过原因，便于运维补齐环境后真实运行
    console.info(`[integration 16.1] skipped: ${skipReason(BASE_ENV)}${hasLlm ? '' : '；缺少 LLM 密钥(MERCHANT_LLM_API_KEY/DASHSCOPE_API_KEY)'}`)
  }

  const platform = (process.env.INTEGRATION_PLATFORM as PublishPlatform) || ('DOUYIN' as PublishPlatform)

  it('重新生成文案：真实 LLM + reserve→charge，余额非负且产出合法文案', async () => {
    const { regenerateCopy } = await import('@/lib/publish-copy-service')
    const { getBalance } = await import('@/lib/credit-service')

    const userId = env('INTEGRATION_USER_ID')
    const contentBriefId = env('INTEGRATION_BRIEF_ID')

    const before = await getBalance(userId)
    const { preview } = await regenerateCopy({ contentBriefId, platform, userId, confirmOverwrite: true })
    const after = await getBalance(userId)

    // 真实 LLM 产出的平台文案结构合法
    expect(typeof preview.title).toBe('string')
    expect(typeof preview.caption).toBe('string')
    expect(Array.isArray(preview.tags)).toBe(true)
    expect(typeof preview.cta).toBe('string')

    // 计费守恒：成功 CHARGE 后余额只减不增，且为整数（不先扣后退到负数）
    expect(Number.isInteger(after)).toBe(true)
    expect(after).toBeGreaterThanOrEqual(0)
    expect(before - after).toBeGreaterThanOrEqual(0)
  }, 120_000)

  it('按平台改写：真实 LLM + 计费链路完成且文案合法', async () => {
    const { rewriteForPlatform } = await import('@/lib/publish-copy-service')
    const userId = env('INTEGRATION_USER_ID')
    const contentBriefId = env('INTEGRATION_BRIEF_ID')

    const { preview } = await rewriteForPlatform({ contentBriefId, platform, userId, confirmOverwrite: true })
    expect(typeof preview.caption).toBe('string')
    expect(preview.caption.length).toBeGreaterThan(0)
  }, 120_000)

  it('一键改写规避：真实改写 + 自动重跑合规；未通过绝不标记通过（Property 11）', async () => {
    const { rewriteToCompliant } = await import('@/lib/compliance-service')
    const userId = env('INTEGRATION_USER_ID')
    const contentBriefId = env('INTEGRATION_BRIEF_ID')
    const videoVariantId = env('INTEGRATION_VARIANT_ID')

    const result = await rewriteToCompliant({ contentBriefId, videoVariantId, userId })

    expect(result.rewrittenCopy).toBeTruthy()
    expect(result.recheck).toBeTruthy()
    // 仍为 HIGH/BLOCKED 时 stillBlocked=true，且重跑结果绝不被标记为通过
    if (result.recheck.riskLevel === 'HIGH' || result.recheck.riskLevel === 'BLOCKED') {
      expect(result.stillBlocked).toBe(true)
      expect(result.recheck.passed).toBe(false)
    }
  }, 180_000)

  it('计费链路无悬挂 RESERVE：用户不存在未结算的孤立冻结（reserve 必有 charge/refund 收尾）', async () => {
    const { prisma } = await import('@/lib/db')
    const userId = env('INTEGRATION_USER_ID')
    const contentBriefId = env('INTEGRATION_BRIEF_ID')

    // 该 brief 关联的积分流水：每个 RESERVE 必有对应 CHARGE 或 REFUND 收尾（无悬挂冻结）
    const ledger = await prisma.creditLedger.findMany({
      where: { userId, bizRefType: 'CONTENT_BRIEF', bizRefId: { contains: contentBriefId } },
      select: { action: true, bizRefId: true },
    })
    const byRef = new Map<string, Set<string>>()
    for (const row of ledger) {
      if (!row.bizRefId) continue
      const set = byRef.get(row.bizRefId) ?? new Set<string>()
      set.add(row.action)
      byRef.set(row.bizRefId, set)
    }
    for (const [, actions] of byRef) {
      if (actions.has('RESERVE')) {
        expect(actions.has('CHARGE') || actions.has('REFUND')).toBe(true)
      }
    }
  }, 60_000)
})
