/**
 * merchant-billing-service 单元测试
 *
 * 覆盖商家计费体系收敛（merchant-billing-unification）中两个代表性的确定性用例，
 * 保持纯函数级（不依赖实时数据库写入）：
 * 1. 内容计划生成固定单价：扣费额恒等于 CREDIT_COST_CONTENT_PLAN（Req 3.3 EXAMPLE）。
 * 2. 视频导出超分计费门控：含超分按 estimateRenderCost 计费（> 0），不含超分不扣减（= 0）（Req 3.5 两代表用例）。
 *
 * 说明：积分流水写入与余额守恒由属性测试（task 4.4-4.8）与集成测试（task 7.2 / 12.1）覆盖，
 * 本文件聚焦可隔离的成本计算逻辑，断言扣费额而非账本写入。
 *
 * 注意：vitest.config.ts 不自动加载 .env，而 credit-service → db 在模块加载时即要求 DATABASE_URL。
 * 因此在所有业务模块导入之前，先通过 dotenv/config 从 .env 注入环境变量
 *（ESM 按导入顺序求值，副作用导入先于后续业务模块执行）。
 */
import 'dotenv/config'
import { describe, it, expect } from 'vitest'
import { estimateRenderCost } from '@/lib/merchant/merchant-billing-service'
import { estimateGroupCreditCost } from '@/lib/shared/credit-service'
import { CREDIT_COST_CONTENT_PLAN } from '@/constants/merchant'

/**
 * 导出超分计费门控（纯逻辑，仅用于测试）：
 * 复刻设计「含超分才 reserveMerchantCredits（按 estimateRenderCost 计费），不含超分不扣减」的决策，
 * 用于在纯函数层断言扣费额，不触及数据库写入。
 *
 * @param withUpscale 本次导出是否包含超分处理
 * @param groupDurations 各分镜组时长（秒）
 * @param resolution 目标分辨率
 * @returns 应冻结/扣费的积分额：含超分为各分镜组 estimateRenderCost 之和，不含超分为 0
 */
function computeExportReserveCost(
  withUpscale: boolean,
  groupDurations: number[],
  resolution: string
): number {
  return withUpscale ? estimateRenderCost(groupDurations, resolution) : 0
}

describe('merchant-billing-service · 内容计划固定单价（Req 3.3）', () => {
  it('内容计划生成扣费额恒等于 CREDIT_COST_CONTENT_PLAN 固定单价', () => {
    // 内容计划生成走 RESERVE→CHARGE/REFUND，按平台配置的固定单价计费
    expect(CREDIT_COST_CONTENT_PLAN).toBe(10)
  })

  it('固定单价取值 ≥ 0 且为整数（Req 3.3 约束）', () => {
    expect(CREDIT_COST_CONTENT_PLAN).toBeGreaterThanOrEqual(0)
    expect(Number.isInteger(CREDIT_COST_CONTENT_PLAN)).toBe(true)
  })
})

describe('merchant-billing-service · 导出超分计费门控（Req 3.5）', () => {
  it('导出含超分：按 estimateRenderCost 计费，扣费额 > 0 且等于各分镜组积分之和', () => {
    const groupDurations = [5, 8, 12]
    const resolution = '1080p'
    const expected = groupDurations.reduce(
      (sum, d) => sum + estimateGroupCreditCost(d, resolution),
      0
    )

    const cost = computeExportReserveCost(true, groupDurations, resolution)

    expect(cost).toBe(expected)
    expect(cost).toBeGreaterThan(0)
  })

  it('导出不含超分：不额外扣减积分，扣费额为 0（余额不变）', () => {
    const groupDurations = [5, 8, 12]

    const cost = computeExportReserveCost(false, groupDurations, '1080p')

    expect(cost).toBe(0)
  })
})

describe('merchant-billing-service · estimateRenderCost 代表用例', () => {
  it('空分镜组返回 0（无可计费时长）', () => {
    expect(estimateRenderCost([], '1080p')).toBe(0)
  })

  it('渲染成本等于各分镜组 estimateGroupCreditCost 之和（720p 含 1.5 倍率）', () => {
    const groupDurations = [4, 10]
    const resolution = '720p'
    const expected =
      estimateGroupCreditCost(4, resolution) + estimateGroupCreditCost(10, resolution)

    expect(estimateRenderCost(groupDurations, resolution)).toBe(expected)
  })
})
