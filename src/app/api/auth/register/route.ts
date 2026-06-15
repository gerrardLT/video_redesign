import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { prisma } from '@/lib/db'
import { signToken, hashPassword } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// 注册请求 schema
const RegisterSchema = z.object({
  email: z.email('邮箱格式不正�?),
  password: z.string().min(8, '密码至少 8 �?),
  nickname: z.string().optional(),
})

export async function POST(request: NextRequest) {
  try {
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

    // 创建用户，默�?100 积分
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
      secure: process.env.NEXT_PUBLIC_APP_URL?.startsWith('https'),
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 7 �?
    })

    return response
  } catch (error) {
    console.error('注册失败:', error)
    return NextResponse.json({ error: '服务器内部错�? }, { status: 500 })
  }
}
