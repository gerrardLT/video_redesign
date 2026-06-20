/**
 * 订阅积分发放服务 (CreditDispatcher)
 *
 * 负责订阅积分的计算与原子性发放：
 * - calculateCreditsToDispatch：纯函数，根据套餐类型和月份计算应发放积分数
 * - dispatchSubscriptionCredits：幂等发放订阅积分，经 Redis 全局锁跨进程串行化
 *
 * 积分规则：
 * - 月卡：每月 500 积分
 * - 季卡首月：500 + 300 奖励 = 800 积分
 * - 季卡后续月：500 积分
 * - 年卡首月：500 + 1000 奖励 = 1500 积分
 * - 年卡后续月：500 积分
 */
import { prisma } from './db'
import { withCreditLock } from './distributed-lock'

/**
 * 计算当期应发放积分数（纯函数）
 *
 * @param planType 套餐类型：'monthly'（月卡）、'quarterly'（季卡）或 'yearly'（年卡）
 * @param isFirstMonth 是否为首月（季卡/年卡首月发放额外奖励积分）
 * @returns 应发放积分数
 */
export function calculateCreditsToDispatch(
  planType: 'monthly' | 'quarterly' | 'yearly',
  isFirstMonth: boolean
): number {
  const BASE_MONTHLY_CREDITS = 500
  const QUARTERLY_FIRST_MONTH_BONUS = 300
  const YEARLY_FIRST_MONTH_BONUS = 1000

  if (planType === 'monthly') {
    return BASE_MONTHLY_CREDITS
  }

  if (planType === 'quarterly') {
    // 季卡：首月发放基础积分 + 300 奖励积分，后续月仅发放基础积分
    if (isFirstMonth) {
      return BASE_MONTHLY_CREDITS + QUARTERLY_FIRST_MONTH_BONUS
    }
    return BASE_MONTHLY_CREDITS
  }

  // 年卡：首月发放基础积分 + 全部奖励积分，后续月仅发放基础积分
  if (isFirstMonth) {
    return BASE_MONTHLY_CREDITS + YEARLY_FIRST_MONTH_BONUS
  }

  return BASE_MONTHLY_CREDITS
}

/**
 * 发放订阅积分
 *
 * 幂等性：按 subscriptionOrderId 检查是否已存在 SUBSCRIPTION_GRANT 流水，
 * 重复调用（如队列重试、重复回调）不会双重发放。
 *
 * 原子性：通过 withCreditLock（Redis 全局积分写锁）+ Prisma 事务保证
 * 跨进程串行化与数据一致性，写入 CreditLedger、累加 User.creditBalance、
 * 更新 SubscriptionRecord.totalCreditsGranted 三步在同一事务中完成。
 *
 * @param userId 用户 ID
 * @param planId 套餐 ID（用于查询套餐类型）
 * @param subscriptionOrderId 订阅订单 ID（幂等键）
 * @param isFirstMonth 是否为首月
 * @returns 实际发放积分数（幂等跳过时返回 0）
 */
export async function dispatchSubscriptionCredits(
  userId: string,
  planId: string,
  subscriptionOrderId: string,
  isFirstMonth: boolean
): Promise<number> {
  return await withCreditLock(async () => {
    return await prisma.$transaction(async (tx) => {
      // 幂等检查：已存在该 subscriptionOrderId 的 SUBSCRIPTION_GRANT 流水则跳过
      const existingGrant = await tx.creditLedger.findFirst({
        where: {
          subscriptionOrderId,
          action: 'SUBSCRIPTION_GRANT',
        },
      })
      if (existingGrant) {
        return 0
      }

      // 查询套餐类型以计算应发放积分
      const plan = await tx.subscriptionPlan.findUniqueOrThrow({
        where: { id: planId },
      })

      const credits = calculateCreditsToDispatch(
        plan.type as 'monthly' | 'quarterly' | 'yearly',
        isFirstMonth
      )

      // 累加用户积分余额
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } })
      const newBalance = user.creditBalance + credits

      await tx.user.update({
        where: { id: userId },
        data: { creditBalance: newBalance },
      })

      // 写入 CreditLedger 流水
      await tx.creditLedger.create({
        data: {
          userId,
          subscriptionOrderId,
          action: 'SUBSCRIPTION_GRANT',
          amount: credits,
          balanceAfter: newBalance,
          remark: `订阅积分发放 ${credits} 积分（${plan.name}${isFirstMonth ? '，含首月奖励' : ''}）`,
        },
      })

      // 更新 SubscriptionRecord 累计已发放积分
      // 通过 subscriptionOrderId 找到关联的 SubscriptionRecord
      const order = await tx.subscriptionOrder.findUniqueOrThrow({
        where: { id: subscriptionOrderId },
      })

      if (order.recordId) {
        await tx.subscriptionRecord.update({
          where: { id: order.recordId },
          data: {
            totalCreditsGranted: {
              increment: credits,
            },
          },
        })
      }

      return credits
    })
  }, 'dispatchSubscriptionCredits')
}
