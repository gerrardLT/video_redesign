import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { prisma } from '@/lib/db'
import { signToken, comparePassword } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// 登录请求 schema
const LoginSchema = z.object({
  email: z.email('邮箱格式不正�?),
  password: z.string().min(1, '请输入密�?),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = LoginSchema.safeParse(body)

    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message ?? '参数校验失败'
      return NextResponse.json({ error: firstError }, { status: 400 })
    }

    const { email, password } = parsed.data

    // 查找用户（不暴露是邮箱还是密码错误）
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      return NextResponse.json({ error: '邮箱或密码错�? }, { status: 401 })
    }

    // 验证密码
    const isValid = await comparePassword(password, user.passwordHash)
    if (!isValid) {
      return NextResponse.json({ error: '邮箱或密码错�? }, { status: 401 })
    }

    // 更新最后登录时�?
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
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
    console.error('登录失败:', error)
    return NextResponse.json({ error: '服务器内部错�? }, { status: 500 })
  }
}
