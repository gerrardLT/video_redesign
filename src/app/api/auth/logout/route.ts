import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST() {
  const response = NextResponse.json({ message: '已登�? })

  // 清除 token cookie
  response.cookies.set('token', '', {
    httpOnly: true,
    secure: process.env.NEXT_PUBLIC_APP_URL?.startsWith('https'),
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  })

  return response
}
