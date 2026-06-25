import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { prisma } from '@/lib/db'
import { signToken, hashPassword } from '@/lib/auth'
import { checkRateLimit } from '@/lib/rate-limiter'

export const dynamic = 'force-dynamic'

// 注册请求 schema
const RegisterSchema = z.object({
  email: z.email('邮箱格式不正确'),
  password: z.string()
    .min(8, '密码至少 8 位')
    .regex(/[A-Z]|[0-9]|[^a-zA-Z0-9]/, '密码需包含大写字母、数字或特殊字符中的至少一种'),
  nickname: z.string().optional(),
})

export async function POST(request: NextRequest) {
  try {
    // P0 修复：注册接口速率限制（3 次/分钟/IP，防批量注册）
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown'
    const rateLimitKey = `auth:register:${clientIp}`
    const rateResult = checkRateLimit(rateLimitKey, 3, 60 * 1000)
    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: { code: 'RATE_LIMITED', message: '注册尝试过于频繁，请稍后重试' } },
        { status: 429 }
      )
    }

    const body = await request.json()
    const parsed = RegisterSchema.safeParse(body)

    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message ?? '参数校验失败'
      return NextResponse.json({ error: firstError }, { status: 400 })
    }

    const { email, password, nickname } = parsed.data

    // 检查邮箱是否已注册
    const existingUser = await prisma.user.findUnique({ where: { email } })
    if (existingUser) {
      return NextResponse.json({ error: '邮箱已被注册' }, { status: 400 })
    }

    // 哈希密码
    const passwordHash = await hashPassword(password)

    // 创建用户，默认 100 积分
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        nickname: nickname ?? null,
        creditBalance: 100,
        role: 'USER',
      },
    })

    // 签发 JWT
    const token = signToken({ userId: user.id, role: user.role })

    // 设置 HttpOnly cookie
    const response = NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        nickname: user.nickname,
        creditBalance: user.creditBalance,
      },
    })

    response.cookies.set('token', token, {
      httpOnly: true,
      secure: process.env.NEXT_PUBLIC_APP_URL?.startsWith('https') ?? false,
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 7 天
    })

    return response
  } catch (error) {
    console.error('注册失败:', error)
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 })
  }
}
