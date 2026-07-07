/**
 * 新手引导服务
 * 提供引导进度管理（查询、更新、重置）和完成奖励发放功能
 */
import { prisma } from './db'

// ========================
// 类型定义
// ========================

/** 引导步骤标识 */
export type OnboardingStepId =
  | 'WELCOME_WIZARD'
  | 'SAMPLE_PROJECT_CREATED'
  | 'DASHBOARD_TOOLTIP'
  | 'EDITOR_GUIDE'
  | 'FIRST_PROJECT_GUIDE'

/** 步骤状态 */
export type StepStatus = 'NOT_COMPLETED' | 'COMPLETED' | 'SKIPPED'

/** 引导进度数据结构 */
export interface OnboardingProgress {
  userId: string
  steps: Record<OnboardingStepId, StepStatus>
  rewardGranted: boolean
  updatedAt: string
}

/** 奖励积分数量 */
const REWARD_CREDITS = 20

/** 奖励备注 */
const REWARD_REMARK = '新手引导完成奖励'

// ========================
// 步骤ID → Prisma 列名映射
// ========================

const STEP_COLUMN_MAP: Record<OnboardingStepId, string> = {
  WELCOME_WIZARD: 'welcomeWizard',
  SAMPLE_PROJECT_CREATED: 'sampleProject',
  DASHBOARD_TOOLTIP: 'dashboardTooltip',
  EDITOR_GUIDE: 'editorGuide',
  FIRST_PROJECT_GUIDE: 'firstProjectGuide',
}

/** 所有步骤 ID 列表 */
const ALL_STEP_IDS: OnboardingStepId[] = [
  'WELCOME_WIZARD',
  'SAMPLE_PROJECT_CREATED',
  'DASHBOARD_TOOLTIP',
  'EDITOR_GUIDE',
  'FIRST_PROJECT_GUIDE',
]

// ========================
// 辅助函数
// ========================

/**
 * 将 Prisma 记录转换为标准化的 OnboardingProgress 对象
 */
function toProgress(record: {
  userId: string
  welcomeWizard: string
  sampleProject: string
  dashboardTooltip: string
  editorGuide: string
  firstProjectGuide: string
  rewardGranted: boolean
  updatedAt: Date
}): OnboardingProgress {
  return {
    userId: record.userId,
    steps: {
      WELCOME_WIZARD: record.welcomeWizard as StepStatus,
      SAMPLE_PROJECT_CREATED: record.sampleProject as StepStatus,
      DASHBOARD_TOOLTIP: record.dashboardTooltip as StepStatus,
      EDITOR_GUIDE: record.editorGuide as StepStatus,
      FIRST_PROJECT_GUIDE: record.firstProjectGuide as StepStatus,
    },
    rewardGranted: record.rewardGranted,
    updatedAt: record.updatedAt.toISOString(),
  }
}

// ========================
// 服务方法
// ========================

/**
 * 获取用户引导进度
 * 如果记录不存在，自动创建初始记录（所有步骤为 NOT_COMPLETED）并返回
 */
export async function getProgress(userId: string): Promise<OnboardingProgress> {
  const record = await prisma.onboardingProgress.upsert({
    where: { userId },
    create: { userId },
    update: {},
  })

  return toProgress(record)
}

/**
 * 更新单个引导步骤的状态
 */
export async function updateStep(
  userId: string,
  stepId: OnboardingStepId,
  status: StepStatus
): Promise<void> {
  const column = STEP_COLUMN_MAP[stepId]

  // 确保记录存在（upsert 模式：不存在则创建后再更新目标步骤）
  await prisma.onboardingProgress.upsert({
    where: { userId },
    create: {
      userId,
      [column]: status,
    },
    update: {
      [column]: status,
    },
  })
}

/**
 * 重置用户引导进度
 * 将所有步骤重置为 NOT_COMPLETED，但 rewardGranted 保持不变（防止重复领取奖励）
 */
export async function resetProgress(userId: string): Promise<void> {
  await prisma.onboardingProgress.upsert({
    where: { userId },
    create: { userId },
    update: {
      welcomeWizard: 'NOT_COMPLETED',
      sampleProject: 'NOT_COMPLETED',
      dashboardTooltip: 'NOT_COMPLETED',
      editorGuide: 'NOT_COMPLETED',
      firstProjectGuide: 'NOT_COMPLETED',
      // rewardGranted 保持不变，不在 update 中指定
    },
  })
}

/**
 * 检查并发放完成奖励
 *
 * 仅当所有 5 个步骤均为 COMPLETED（SKIPPED 不算）且尚未发放过奖励时，
 * 创建 CreditLedger TOPUP 记录（20 积分）并标记 rewardGranted = true。
 *
 * @returns true 表示本次成功授予奖励；false 表示未满足条件或已授予过
 */
export async function checkAndGrantReward(userId: string): Promise<boolean> {
  // 获取当前进度记录（不存在则创建）
  const record = await prisma.onboardingProgress.upsert({
    where: { userId },
    create: { userId },
    update: {},
  })

  // 已发放过奖励，直接返回 false（幂等保证）
  if (record.rewardGranted) {
    return false
  }

  // 检查所有步骤是否均为 COMPLETED
  const allCompleted = ALL_STEP_IDS.every((stepId) => {
    const column = STEP_COLUMN_MAP[stepId] as keyof typeof record
    return record[column] === 'COMPLETED'
  })

  if (!allCompleted) {
    return false
  }

  // 在事务中：增加积分余额 + 创建 TOPUP 流水 + 标记 rewardGranted
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } })
    const newBalance = user.creditBalance + REWARD_CREDITS

    await tx.user.update({
      where: { id: userId },
      data: { creditBalance: newBalance },
    })

    await tx.creditLedger.create({
      data: {
        userId,
        action: 'TOPUP',
        amount: REWARD_CREDITS,
        balanceAfter: newBalance,
        remark: REWARD_REMARK,
      },
    })

    await tx.onboardingProgress.update({
      where: { userId },
      data: { rewardGranted: true },
    })
  })

  return true
}
