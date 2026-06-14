import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { validateAndImport } from '@/lib/video-import-service'
import { checkRateLimit } from '@/lib/rate-limiter'

export const dynamic = 'force-dynamic'

// POST /api/projects/import-link - 通过分享链接导入视频
const ImportLinkSchema = z.object({
  url: z.string().min(1, '请输入视频链接').url('请输入有效的链接地址'),
  name: z.string().max(100, '项目名称不能超过 100 字').optional(),
})

export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')!

    // 限流：3 次/分钟/用户
    const rateLimitKey = `${userId}:import-link`
    const rateResult = checkRateLimit(rateLimitKey, 3, 60 * 1000)
    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: '操作过于频繁，请稍后再试（每分钟最多 3 次）' },
        { status: 429 }
      )
    }

    const body = await request.json()

    const parsed = ImportLinkSchema.safeParse(body)
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message || '参数校验失败'
      return NextResponse.json({ error: firstError }, { status: 400 })
    }

    const { url, name } = parsed.data

    const result = await validateAndImport(userId, url, name)

    return NextResponse.json(
      {
        projectId: result.projectId,
        taskId: result.taskId,
        platform: result.platform,
      },
      { status: 201 }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : '导入失败'
    console.error('[POST /api/projects/import-link]', error)

    // 链接验证失败返回 400
    if (message.includes('不支持') || message.includes('请输入') || message.includes('验证失败')) {
      return NextResponse.json({ error: message }, { status: 400 })
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
