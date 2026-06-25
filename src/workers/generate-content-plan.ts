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
import { redis } from '@/lib/redis'
import { prisma } from '@/lib/db'
import { createStoreProfile } from '@/lib/store-profile-service'
import { generateContentPlan } from '@/lib/content-calendar-service'
import { generateContentPlanQueue } from '@/lib/queue'

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

    // 画像生成成功后，自动触发日历生成（事件驱动串行）
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
 * 1. 从 job.data 获取 { storeId, merchantId }
 * 2. 检查 StoreProfile 是否存在（不存在则立即抛错，由 BullMQ 指数退避重试）
 * 3. 调用 generateContentPlan() 生成 7 天内容计划
 * 4. startDate = 明天, days = 7
 *
 * 注意：此任务由 processGenerateStoreProfile 成功后入队触发，
 * 正常情况下 StoreProfile 已存在。若因竞态条件不存在，BullMQ 自动重试即可。
 */
async function processGenerateContentPlan(job: Job<GenerateContentPlanJobData>): Promise<void> {
  const { storeId, merchantId } = job.data
  console.log(
    `[generate-content-plan] 开始生成内容计划 storeId=${storeId}, merchantId=${merchantId}（attempt ${job.attemptsMade + 1}）`
  )

  // 直接检查 StoreProfile 是否存在（由画像 Worker 成功后触发入队，正常应已存在）
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

  // 调用内容日历生成服务
  const { contentPlan, briefs } = await generateContentPlan({
    storeId,
    startDate: tomorrow,
    days: 7,
  })

  console.log(
    `[generate-content-plan] 内容计划生成成功 storeId=${storeId}, ` +
    `planId=${contentPlan.id}, briefs=${briefs.length}条`
  )
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
