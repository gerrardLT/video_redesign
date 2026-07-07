/**
 * 内容计划生成 Worker
 *
 * 处理两个 BullMQ 队列任务：
 * 1. `generate-store-profile` — 生成门店画像（规则引擎 + LLM 润色）
 *    画像生成成功后，自动入队 `generate-content-plan` 任务（事件驱动串行）
 * 2. `generate-content-plan` — 生成 7 天内容计划（日历 + 剧本实例化）
 *    要求 StoreProfile 已存在，不存在则立即抛错由 BullMQ 重试
 *
 * 设计原则：
 * - 不静默吞错误，失败时抛出让 BullMQ 自动重试（队列配置 attempts: 3, backoff: exponential）
 * - Worker concurrency = 3（design.md 定义）
 * - 画像→日历为事件驱动串行（画像 Worker 成功后入队日历任务），而非轮询等待
 * - 参考现有 src/workers/parse-video.ts 的 Worker 模式
 *
 * Requirements: 1.4, 1.7, 2.1, 4.1
 */

import { Worker, Job, type ConnectionOptions } from 'bullmq'
import { redis } from '@/lib/shared/redis'
import { prisma } from '@/lib/shared/db'
import { createStoreProfile } from '@/lib/merchant/store-profile-service'
import { generateContentPlan } from '@/lib/merchant/content-calendar-service'
import { generateContentPlanQueue } from '@/lib/shared/queue'
import { chargeMerchantCredits, refundMerchantCredits } from '@/lib/merchant/merchant-billing-service'
import { CREDIT_COST_CONTENT_PLAN } from '@/constants/merchant'

// ========================
// Job Data 类型定义
// ========================

/** generate-store-profile 队列的 job 数据 */
export interface GenerateStoreProfileJobData {
  storeId: string
  merchantId: string
}

/** generate-content-plan 队列的 job 数据 */
export interface GenerateContentPlanJobData {
  storeId: string
  merchantId: string
  /**
   * 发起用户 ID（计费收敛）：用于 Worker 计费点的 CHARGE / REFUND（task 8.1）。
   * 由 /content-plan/generate 路由在 RESERVE 时透传。
   */
  userId?: string
  /**
   * 预生成的内容计划 id（计费收敛）：路由在 RESERVE 时预生成并透传，
   * Worker 创建 ContentPlan 时复用同一 id，使 CHARGE / REFUND（task 8.1）
   * 与路由的 RESERVE 共用同一 (CONTENT_PLAN, contentPlanId) 关联键（幂等键）。
   */
  contentPlanId?: string
}

// ========================
// 门店画像生成处理逻辑
// ========================

/**
 * 处理 generate-store-profile 队列任务
 *
 * 流程：
 * 1. 从 job.data 获取 { storeId, merchantId }
 * 2. 查询 Store 记录获取 industry, mainProducts, mainSellingPoints 等
 * 3. 调用 createStoreProfile() 生成画像
 * 4. 成功：Store.status 保持 ACTIVE
 * 5. 失败：Store.status = 'PROFILE_PENDING' (Req 1.7)
 */
async function processGenerateStoreProfile(job: Job<GenerateStoreProfileJobData>): Promise<void> {
  const { storeId, merchantId } = job.data
  console.log(
    `[generate-store-profile] 开始生成门店画像 storeId=${storeId}, merchantId=${merchantId}（attempt ${job.attemptsMade + 1}）`
  )

  // 查询 Store 记录，获取画像生成所需的全部字段
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: {
      id: true,
      industry: true,
      mainProducts: true,
      mainSellingPoints: true,
      targetCustomers: true,
      avgTicket: true,
      hasGroupBuying: true,
      hasReservation: true,
      canShootKitchen: true,
      canShootStaff: true,
      canShootCustomers: true,
    },
  })

  if (!store) {
    throw new Error(`[generate-store-profile] 门店不存在: storeId=${storeId}`)
  }

  try {
    // 调用画像生成服务（规则引擎 + LLM 润色）
    await createStoreProfile({
      storeId: store.id,
      industry: store.industry as Parameters<typeof createStoreProfile>[0]['industry'],
      mainProducts: store.mainProducts as string[],
      mainSellingPoints: store.mainSellingPoints as string[],
      targetCustomers: store.targetCustomers as string[] | undefined,
      avgTicket: store.avgTicket ?? undefined,
      hasGroupBuying: store.hasGroupBuying,
      hasReservation: store.hasReservation,
      canShootKitchen: store.canShootKitchen,
      canShootStaff: store.canShootStaff,
      canShootCustomers: store.canShootCustomers,
    })

    console.log(`[generate-store-profile] 门店画像生成成功 storeId=${storeId}`)
    // 成功时 Store.status 保持 ACTIVE（默认值），无需额外更新

    // 画像生成成功后，自动触发日历生成（事件驱动串行）。
    // 计费收敛（task 8.1）：此 onboarding 自动触发路径不透传 userId / contentPlanId，
    // 因未经路由 RESERVE 冻结积分，Worker 据此跳过 CHARGE / REFUND，保持本路径不计费，
    // 避免在无冻结的情况下扣费。
    await generateContentPlanQueue.add('generate-content-plan', { storeId, merchantId })
    console.log(`[generate-store-profile] 已入队 generate-content-plan 任务 storeId=${storeId}`)
  } catch (error) {
    // 失败时将 Store.status 标记为 PROFILE_PENDING，允许用户重试 (Req 1.7)
    console.error(
      `[generate-store-profile] 门店画像生成失败 storeId=${storeId}:`,
      error instanceof Error ? error.message : String(error)
    )

    await prisma.store.update({
      where: { id: storeId },
      data: { status: 'PROFILE_PENDING' },
    })

    // 抛出让 BullMQ 重试
    throw error
  }
}

// ========================
// 内容计划生成处理逻辑
// ========================

/**
 * 处理 generate-content-plan 队列任务
 *
 * 流程：
 * 1. 从 job.data 获取 { storeId, merchantId, userId?, contentPlanId? }
 * 2. 检查 StoreProfile 是否存在（不存在则立即抛错，由 BullMQ 指数退避重试）
 * 3. 调用 generateContentPlan() 生成 7 天内容计划（透传 contentPlanId 复用为记录 id）
 * 4. startDate = 明天, days = 7
 *
 * 计费收敛（task 8.1，统一积分计费 RESERVE→CHARGE/REFUND）：
 * - 仅当 job.data 同时带有 userId 与 contentPlanId 时计费——这表示请求来自
 *   /content-plan/generate 路由，且该路由已按固定 CREDIT_COST_CONTENT_PLAN 执行 RESERVE 冻结。
 * - 成功：在事务内 CHARGE 固定单价（关联键 CONTENT_PLAN + contentPlanId，与路由 RESERVE 同键，幂等）。
 * - 失败：按关联键幂等 REFUND 退款解卡，再抛错让 BullMQ 重试（重试不重复扣费/退款）。
 * - 画像 Worker 自动触发的 onboarding 路径不带 userId / contentPlanId（未 RESERVE），跳过计费。
 * - 注意：StoreProfile 未就绪属可恢复的瞬时重试，其抛错位于计费块之前，不触发退款，
 *   避免「退款后重试又扣费」的账目错乱。
 *
 * 注意：此任务由 processGenerateStoreProfile 成功后入队触发，
 * 正常情况下 StoreProfile 已存在。若因竞态条件不存在，BullMQ 自动重试即可。
 */
async function processGenerateContentPlan(job: Job<GenerateContentPlanJobData>): Promise<void> {
  const { storeId, merchantId, userId, contentPlanId } = job.data
  console.log(
    `[generate-content-plan] 开始生成内容计划 storeId=${storeId}, merchantId=${merchantId}（attempt ${job.attemptsMade + 1}）`
  )

  // 计费门控：仅当路由侧已 RESERVE（同时透传 userId 与 contentPlanId）时才走 CHARGE / REFUND。
  const shouldBill = Boolean(userId && contentPlanId)

  // 直接检查 StoreProfile 是否存在（由画像 Worker 成功后触发入队，正常应已存在）。
  // 该检查在计费块之前：画像未就绪为可恢复的瞬时重试，抛错不应触发退款。
  const profile = await prisma.storeProfile.findUnique({
    where: { storeId },
    select: { id: true, contentPositioning: true },
  })

  if (!profile || !profile.contentPositioning) {
    throw new Error(
      `[generate-content-plan] 门店画像未就绪，storeId=${storeId}。` +
      `画像可能尚在生成中，将由 BullMQ 自动重试。`
    )
  }

  // 计算明天的日期作为 startDate
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(0, 0, 0, 0)

  try {
    // 调用内容日历生成服务（透传 contentPlanId：提供时复用为 ContentPlan 记录 id，
    // 使 CHARGE / REFUND 与路由 RESERVE 共用同一 (CONTENT_PLAN, contentPlanId) 幂等键）
    const { contentPlan, briefs } = await generateContentPlan({
      storeId,
      startDate: tomorrow,
      days: 7,
      contentPlanId,
    })

    // 生成成功——仅计费路径在事务内 CHARGE 固定单价（幂等，重试不重复扣费）。
    // 内容计划为固定单价，实扣额 = 冻结额 = CREDIT_COST_CONTENT_PLAN，无差额退款。
    if (shouldBill) {
      await prisma.$transaction(async (tx) => {
        await chargeMerchantCredits(tx, {
          userId: userId!,
          bizRefType: 'CONTENT_PLAN',
          bizRefId: contentPlanId!,
          actualAmount: CREDIT_COST_CONTENT_PLAN,
        })
      })
    }

    console.log(
      `[generate-content-plan] 内容计划生成成功 storeId=${storeId}, ` +
      `planId=${contentPlan.id}, briefs=${briefs.length}条`
    )
  } catch (error) {
    // 生成失败——仅计费路径按关联键幂等 REFUND 退款解卡（已退则跳过），
    // 退款本身失败仅记日志，不掩盖原始错误；随后抛出让 BullMQ 重试（外部依赖失败不静默降级）。
    if (shouldBill) {
      try {
        await refundMerchantCredits({
          userId: userId!,
          bizRefType: 'CONTENT_PLAN',
          bizRefId: contentPlanId!,
        })
      } catch (refundErr) {
        console.error('[generate-content-plan] 退还冻结积分失败:', refundErr)
      }
    }
    throw error
  }
}

// ========================
// 创建 Worker 实例
// ========================

const connection = redis as unknown as ConnectionOptions

/** 门店画像生成 Worker */
const storeProfileWorker = new Worker<GenerateStoreProfileJobData>(
  'generate-store-profile',
  processGenerateStoreProfile,
  {
    connection,
    concurrency: 3,
  }
)

storeProfileWorker.on('completed', (job) => {
  console.log(`[generate-store-profile] 任务 ${job.id} 完成`)
})

storeProfileWorker.on('failed', (job, err) => {
  console.error(`[generate-store-profile] 任务 ${job?.id} 失败:`, err.message)
})

/** 内容计划生成 Worker */
const contentPlanWorker = new Worker<GenerateContentPlanJobData>(
  'generate-content-plan',
  processGenerateContentPlan,
  {
    connection,
    concurrency: 3,
  }
)

contentPlanWorker.on('completed', (job) => {
  console.log(`[generate-content-plan] 任务 ${job.id} 完成`)
})

contentPlanWorker.on('failed', (job, err) => {
  console.error(`[generate-content-plan] 任务 ${job?.id} 失败:`, err.message)
})

// 导出 Worker 实例和处理函数（供测试使用）
export {
  storeProfileWorker,
  contentPlanWorker,
  processGenerateStoreProfile,
  processGenerateContentPlan,
}

export default { storeProfileWorker, contentPlanWorker }
