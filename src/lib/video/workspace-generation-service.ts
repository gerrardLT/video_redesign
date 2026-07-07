/**
 * 工作台生成编排服务
 *
 * 负责工作台单次视频生成的完整编排流程：
 * 1. 计算积分预估
 * 2. 创建 Project（type=workspace，engine 区分模型）
 * 3. 创建 GenerationJob（shotId=null, shotGroupId=null）
 * 4. 冻结积分（withCreditLock）
 * 5. 入队 BullMQ（generate-video，mode='workspace'）
 *
 * 工作台不涉及 Shot / ShotGroup 表，直接通过 Project + GenerationJob 归档。
 */

import { prisma } from '@/lib/shared/db'
import { reserveCredits, getBalance } from '@/lib/shared/credit-service'
import { estimateWorkspaceCost } from '@/lib/shared/credit-calc'
import { videoGenerateQueue } from '@/lib/shared/queue'
import type { WorkspaceModel, WorkspaceAssetType } from '@/types/workspace'

/** 工作台生成输入参数 */
export interface WorkspaceGenerateInput {
  userId: string
  prompt: string
  model: WorkspaceModel
  aspectRatio: string
  duration: number
  resolution: string
  assetUrls: string[]
  assetTypes: Record<string, WorkspaceAssetType>
}

/** 工作台生成结果 */
export interface WorkspaceGenerateResult {
  jobId: string
  projectId: string
  estimatedCost: number
}

/**
 * 执行工作台生成编排
 *
 * @throws Error('INSUFFICIENT_CREDITS') 余额不足
 */
export async function executeWorkspaceGeneration(
  input: WorkspaceGenerateInput
): Promise<WorkspaceGenerateResult> {
  const { userId, prompt, model, aspectRatio, duration, resolution, assetUrls, assetTypes } = input

  // 1. 计算预估积分
  const estimatedCost = estimateWorkspaceCost(model, duration)

  // 2. 余额预检
  const balance = await getBalance(userId)
  if (balance < estimatedCost) {
    const error = new Error('INSUFFICIENT_CREDITS')
    ;(error as Error & { balance?: number; required?: number }).balance = balance
    ;(error as Error & { balance?: number; required?: number }).required = estimatedCost
    throw error
  }

  // 3. 创建 Project（工作台模式，engine 区分引擎）
  const project = await prisma.project.create({
    data: {
      userId,
      name: prompt.substring(0, 50) || '工作台生成',
      status: 'GENERATING',
      engine: model,
      aspectRatio,
      duration,
    },
  })

  // 4. 创建 GenerationJob（shotId=null, shotGroupId=null 标记为工作台任务）
  const job = await prisma.generationJob.create({
    data: {
      userId,
      projectId: project.id,
      shotId: null,
      shotGroupId: null,
      engine: model,
      promptSnapshot: prompt,
      resolution,
      duration,
      status: 'CREATED',
      costEstimate: estimatedCost,
    },
  })

  // 5. 冻结积分（withCreditLock 保证并发安全）
  await reserveCredits(userId, job.id, estimatedCost)

  // 6. 更新 Job 状态为 QUEUED
  await prisma.generationJob.update({
    where: { id: job.id },
    data: { status: 'QUEUED' },
  })

  // 7. 入队 BullMQ（generate-video 队列，workspace 模式）
  await videoGenerateQueue.add(
    `workspace-${job.id}`,
    {
      jobId: job.id,
      projectId: project.id,
      userId,
      mode: 'workspace',
      workspaceData: {
        assetUrls,
        assetTypes,
      },
    },
    { jobId: job.id }
  )

  return {
    jobId: job.id,
    projectId: project.id,
    estimatedCost,
  }
}
