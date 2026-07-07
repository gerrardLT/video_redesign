/**
 * POST /api/content-briefs — 某天新增内容任务（需求 6.1, 6.2）
 *
 * 在内容计划中为某门店的某一天新增一条 ContentBrief：基于 StoreProfile 实例化镜头脚本与
 * 文案草稿（含 provenance 溯源快照）。受单日 brief 数量上界约束（默认 3，可由
 * StoreProfile.weeklyCadence 覆盖），超出上界时显式拒绝（需求 6.2）。
 *
 * Route Handler 仅做鉴权 + 门店归属校验 + Zod 参数校验 + 调用服务 + 返回，纯写库不消耗积分。
 *
 * 鉴权：从 x-user-id header 获取用户 ID，通过 validateMerchantAccess 校验门店归属。
 *
 * 请求体：{ storeId, date(ISO 字符串), goal(ContentGoal), playbookId?(可选指定剧本) }
 *
 * 响应：
 * - 201: { brief: ContentBriefRecord, message }
 * - 400: 参数校验失败 / 日期非法（VALIDATION_ERROR）
 * - 401: 未认证
 * - 403: 无权限（非本门店）
 * - 409: 当日内容已达上限（DAY_LIMIT_EXCEEDED）
 * - 422: 门店画像未完成 / 剧本不可用（UNPROCESSABLE）
 * - 500: 服务器内部错误
 *
 * Requirements: 6.1, 6.2
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { getUserIdFromRequest, validateMerchantAccess } from '@/lib/merchant/merchant-auth'
import { addContentBrief } from '@/lib/merchant/content-calendar-service'
import { ContentGoalSchema } from '@/types/merchant'
import { mapContentBriefError } from '@/lib/merchant/content-brief-api-error'
/**
 * 新增 brief 请求体校验：
 * - storeId / goal 必填
 * - date 为 ISO 日期字符串（服务层会再次校验合法性并按 UTC 归一化）
 * - playbookId 可选；提供时使用指定剧本（其 goal 须与入参 goal 一致，否则服务层显式拒绝）
 */
const AddBriefSchema = z.object({
  storeId: z.string().min(1, 'storeId 不能为空'),
  date: z.string().min(1, 'date 不能为空'),
  goal: ContentGoalSchema,
  playbookId: z.string().min(1).optional(),
})
export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    // 解析请求体
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '请求体格式错误，需要 JSON' } },
        { status: 400 }
      )
    }
    const parseResult = AddBriefSchema.safeParse(body)
    if (!parseResult.success) {
      const fieldErrors = parseResult.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }))
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '验证失败', details: fieldErrors } },
        { status: 400 }
      )
    }
    const { storeId, date, goal, playbookId } = parseResult.data
    // 校验商家对该门店的访问权限（门店归属）
    await validateMerchantAccess(userId, storeId)
    // 调用服务新增 brief（纯写库，不消耗积分）
    const brief = await addContentBrief({
      storeId,
      date: new Date(date),
      goal,
      playbookId,
    })
    return NextResponse.json({ brief, message: '已新增内容任务' }, { status: 201 })
  } catch (error) {
    return mapContentBriefError(error, 'POST /api/content-briefs')
  }
}
