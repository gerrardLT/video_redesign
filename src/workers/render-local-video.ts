/**
 * 本地视频渲染 Worker
 *
 * 处理 `render-local-video` BullMQ 队列任务，按 job.data.mode 分发四种渲染入口：
 * 1. 缺省（整体渲染）：调用 renderLocalVideoVariants()，生成 3 种风格视频版本
 * 2. REGEN_VARIANT（单版本重生成）：携带 videoVariantId，调用 regenerateSingleVariant()，
 *    仅重生成指定版本，保留其它版本（需求 4.2）
 * 3. RESHOOT_SCOPE（局部重拍）：携带 shotTaskId，调用 rerenderAffectedScope()，
 *    仅重渲染受影响分镜组集合（被重拍组 ∪ 承接链后续同场景组），承接链一并重算避免画面断裂（需求 4.3/4.5）
 * 4. AUTO_RENDER（一键出片）：调用 aiAutoRender()，全 AI 生成渲染（所有镜头由 Seedance 生成）
 *
 * 渲染完成后，对涉及的每个 VideoVariant 自动入队 compliance-review 合规检查。
 *
 * Worker 配置：
 * - 队列名: render-local-video
 * - concurrency: 2（design.md 定义）
 *
 * 关键约束：
 * - local-render-service 内部已处理 锁/积分(RESERVE→CHARGE/REFUND)/超时/临时文件 finally 清理，
 *   Worker 只负责按 mode 分发并处理返回值，不重复实现计费或回滚逻辑。
 * - 局部重渲染范围内某组失败时，service 内部已 REFUND + 标记失败 + 承接链整体回滚（避免画面断裂），
 *   Worker 不吞错，直接向上抛让 BullMQ 重试（不静默降级）。
 * - 使用共享 Redis 连接
 */

import { Worker, Job, type ConnectionOptions } from 'bullmq'
import { redis } from '@/lib/shared/redis'
import {
  renderLocalVideoVariants,
  regenerateSingleVariant,
  rerenderAffectedScope,
} from '@/lib/merchant/local-render-service'
import { type RenderAdvancedParams } from '@/lib/video/render-pipeline'
import { aiAutoRender } from '@/lib/merchant/ai-auto-render-service'
import { complianceReviewQueue } from '@/lib/shared/queue'

// ========================
// 类型定义
// ========================

/**
 * 渲染模式：
 * - 缺省/INTEGRAL：整体渲染全部 3 个版本
 * - REGEN_VARIANT：单版本重生成（需 videoVariantId）
 * - RESHOOT_SCOPE：局部重拍受影响范围重合成（需 shotTaskId）
 * - AUTO_RENDER：一键出片，全 AI 生成（需 contentBriefId）
 */
export type RenderLocalVideoMode = 'INTEGRAL' | 'REGEN_VARIANT' | 'RESHOOT_SCOPE' | 'AUTO_RENDER'

export interface RenderLocalVideoJobData {
  /** 内容任务 ID（整体渲染 / 局部重拍必填；单版本重生成可省略，由版本反查所属 brief） */
  contentBriefId?: string
  /** 操作用户 ID（计费主体） */
  userId: string
  /** 渲染模式，缺省按整体渲染处理 */
  mode?: RenderLocalVideoMode
  /** 单版本重生成目标版本 ID（mode=REGEN_VARIANT 必填） */
  videoVariantId?: string
  /** 被重拍镜头 ID（mode=RESHOOT_SCOPE 必填） */
  shotTaskId?: string
  /** 运营型用户高级抽屉参数（可选，仅单版本重生成透传） */
  advancedParams?: RenderAdvancedParams
  /** 选定风格 ID（可选，屏 C 单选生成时传入，仅生成单版本） */
  selectedStyle?: string
  /** 创作模式（可选，来自 creation-mode-router，透传给 renderLocalVideoVariants） */
  creationMode?: import('@/generated/prisma').CreationMode
  /** 门店 ID */
  storeId?: string
}

/** 归一化后的待合规检查版本（统一携带所属 brief，供入队 compliance-review） */
interface RenderedVariantRef {
  id: string
  type: string
  contentBriefId: string
}

// ========================
// 任务处理函数
// ========================

async function processRenderLocalVideo(job: Job<RenderLocalVideoJobData>): Promise<void> {
  const { contentBriefId, userId, videoVariantId, shotTaskId, advancedParams, selectedStyle, creationMode } = job.data
  const mode: RenderLocalVideoMode = job.data.mode ?? 'INTEGRAL'

  console.log(
    `[render-local-video] 开始渲染 mode=${mode} contentBriefId=${contentBriefId ?? '-'} ` +
      `videoVariantId=${videoVariantId ?? '-'} shotTaskId=${shotTaskId ?? '-'}（attempt ${job.attemptsMade + 1}）`
  )

  // 按 mode 分发到对应渲染入口；各入口内部已处理积分/锁/超时/临时文件清理，
  // 失败时内部已幂等退款 + 状态回滚并抛错，此处不捕获，直接向上抛让 BullMQ 重试（不静默降级）。
  const variants = await dispatchRender({
    mode,
    contentBriefId,
    userId,
    videoVariantId,
    shotTaskId,
    advancedParams,
    selectedStyle,
    creationMode,
  })

  console.log(`[render-local-video] 渲染完成（mode=${mode}），涉及 ${variants.length} 个版本`)

  // 对涉及的每个 VideoVariant 入队合规检查（重生成/重拍后内容已变，需重新过审）
  for (const variant of variants) {
    await complianceReviewQueue.add('compliance-review', {
      contentBriefId: variant.contentBriefId,
      videoVariantId: variant.id,
    })
    console.log(`[render-local-video] 已入队合规检查: variantId=${variant.id}, type=${variant.type}`)
  }
}

/**
 * 按 mode 分发到对应渲染入口，并将返回结果归一化为待合规检查的版本列表。
 *
 * 各分支的必填入参缺失时显式抛错（不静默回退），让任务失败由 BullMQ 处理。
 */
async function dispatchRender(params: {
  mode: RenderLocalVideoMode
  contentBriefId?: string
  userId: string
  videoVariantId?: string
  shotTaskId?: string
  advancedParams?: RenderAdvancedParams
  selectedStyle?: string
  creationMode?: import('@/generated/prisma').CreationMode
}): Promise<RenderedVariantRef[]> {
  const { mode, contentBriefId, userId, videoVariantId, shotTaskId, advancedParams, selectedStyle, creationMode } = params

  if (mode === 'REGEN_VARIANT') {
    if (!videoVariantId) {
      throw new Error('[render-local-video] REGEN_VARIANT 模式缺少 videoVariantId')
    }
    // 单版本重生成：仅重生成指定版本，保留其它版本（需求 4.2）
    const variant = await regenerateSingleVariant({ videoVariantId, userId, advancedParams })
    return [{ id: variant.id, type: variant.type, contentBriefId: variant.contentBriefId }]
  }

  if (mode === 'RESHOOT_SCOPE') {
    if (!contentBriefId) {
      throw new Error('[render-local-video] RESHOOT_SCOPE 模式缺少 contentBriefId')
    }
    if (!shotTaskId) {
      throw new Error('[render-local-video] RESHOOT_SCOPE 模式缺少 shotTaskId')
    }
    // 局部重拍：仅重渲染受影响分镜组集合，承接链一并重算（需求 4.3/4.5）。
    // 范围内某组失败时 service 内部已 REFUND + 承接链整体回滚，错误向上抛出。
    const variants = await rerenderAffectedScope({ contentBriefId, shotTaskId, userId })
    return variants.map((v) => ({ id: v.id, type: v.type, contentBriefId: v.contentBriefId }))
  }

  if (mode === 'AUTO_RENDER') {
    if (!contentBriefId) {
      throw new Error('[render-local-video] AUTO_RENDER 模式缺少 contentBriefId')
    }
    // 一键出片：全 AI 生成渲染（所有镜头由 Seedance 生成）
    const variants = await aiAutoRender({ contentBriefId, userId })
    return variants.map((v) => ({ id: v.id, type: v.type, contentBriefId }))
  }

  // 缺省：整体渲染全部 3 个版本（或 selectedStyle 指定单版本）
  if (!contentBriefId) {
    throw new Error('[render-local-video] 整体渲染模式缺少 contentBriefId')
  }
  const variants = await renderLocalVideoVariants({ contentBriefId, userId, selectedStyle, creationMode })
  return variants.map((v) => ({ id: v.id, type: v.type, contentBriefId }))
}

// ========================
// Worker 实例
// ========================

const connection = redis as unknown as ConnectionOptions

const worker = new Worker<RenderLocalVideoJobData>(
  'render-local-video',
  processRenderLocalVideo,
  {
    connection,
    concurrency: 2,
  }
)

worker.on('completed', (job) => {
  console.log(`[render-local-video] 任务 ${job.id} 完成`)
})

worker.on('failed', (job, err) => {
  console.error(`[render-local-video] 任务 ${job?.id} 失败:`, err.message)
})

export default worker
export { processRenderLocalVideo }
