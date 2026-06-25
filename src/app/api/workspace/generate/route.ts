/**
 * POST /api/workspace/generate
 * 工作台生成触发接口
 *
 * 参数校验 → 余额预检 → 创建 Project + Job → 冻结积分 → 入队 BullMQ
 *
 * Request: JSON { prompt, model, aspectRatio, duration, resolution, assetUrls, assetTypes }
 * Response: { jobId, projectId, estimatedCost }
 *
 * 错误码：
 * - 400 VALIDATION_ERROR: 参数校验失败
 * - 400 INVALID_DURATION: 时长超出模型允许范围
 * - 402 INSUFFICIENT_CREDITS: 余额不足
 * - 429 CONCURRENT_LIMIT: 并发生成超限
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { executeWorkspaceGeneration } from '@/lib/workspace-generation-service'
import { MODEL_DURATION_OPTIONS } from '@/constants/workspace'

/** 请求体 Schema */
const GenerateRequestSchema = z.object({
  prompt: z.string().min(1, 'prompt 不能为空').max(2500, '最多 2500 字符'),
  model: z.enum(['seedance', 'happyhorse']),
  aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']),
  duration: z.number().int().min(3).max(15),
  resolution: z.enum(['480p', '720p', '1080p']),
  assetUrls: z.array(z.string().url()).max(12).default([]),
  assetTypes: z.record(z.string(), z.enum(['image', 'video', 'audio'])).default({}),
})

export async function POST(request: NextRequest) {
  const userId = request.headers.get('x-user-id')
  if (!userId) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: '未登录' } },
      { status: 401 }
    )
  }

  // 解析请求体
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: '无法解析 JSON' } },
      { status: 400 }
    )
  }

  // Zod 参数校验
  const parsed = GenerateRequestSchema.safeParse(body)
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]?.message || '参数校验失败'
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: firstError }, details: parsed.error.issues },
      { status: 400 }
    )
  }

  const { prompt, model, aspectRatio, duration, resolution, assetUrls, assetTypes } = parsed.data

  // 时长范围二次校验（确保符合模型限制）
  const validDurations = MODEL_DURATION_OPTIONS[model]
  if (!validDurations.includes(duration)) {
    return NextResponse.json(
      {
        error: { code: 'INVALID_DURATION', message: `${model} 模型允许的时长为 ${validDurations.join('/')}s，当前: ${duration}s` },
        details: { allowedDurations: validDurations },
      },
      { status: 400 }
    )
  }

  // 执行生成编排
  try {
    const result = await executeWorkspaceGeneration({
      userId,
      prompt,
      model,
      aspectRatio,
      duration,
      resolution,
      assetUrls,
      assetTypes,
    })

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof Error) {
      // 余额不足
      if (error.message === 'INSUFFICIENT_CREDITS') {
        const err = error as Error & { balance?: number; required?: number }
        return NextResponse.json(
          {
            error: { code: 'INSUFFICIENT_CREDITS', message: '积分余额不足' },
            details: { balance: err.balance ?? 0, required: err.required ?? 0 },
          },
          { status: 402 }
        )
      }

      // 并发限制
      if (error.message === 'CONCURRENT_LIMIT') {
        return NextResponse.json(
          { error: { code: 'CONCURRENT_LIMIT', message: '当前生成任务数已达上限，请稍后再试' } },
          { status: 429 }
        )
      }
    }

    // 其他错误
    console.error('[workspace/generate] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
