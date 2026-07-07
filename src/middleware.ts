import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

// 不需要认证的 API 路径
const PUBLIC_API_PATHS = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/dev-login', // 开发模式一键登录（仅 NODE_ENV=development 可用）
  '/api/payments/wechat/callback',
  '/api/payments/alipay/callback',
  '/api/showcase',
  '/api/help-articles',
]

// 需要保护的页面路径前缀
const PROTECTED_PAGE_PREFIXES = ['/dashboard', '/admin', '/projects', '/project', '/merchant']

function getJwtSecret(): Uint8Array {
  // 必须由环境变量 JWT_SECRET 提供；缺失即抛错，禁止默认回退密钥
  // （回退密钥会让生产环境 token 可被任意伪造）。
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET 未配置：服务端必须设置 JWT_SECRET 环境变量（禁止使用默认回退密钥）')
  }
  return new TextEncoder().encode(secret)
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // API 路由保护
  if (pathname.startsWith('/api/')) {
    // 公开的认证 API 不拦截
    if (PUBLIC_API_PATHS.some((p) => pathname.startsWith(p))) {
      return NextResponse.next()
    }

    // 登出也需要认证
    const token = request.cookies.get('token')?.value

    if (!token) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: '未登录' } },
        { status: 401 }
      )
    }

    try {
      const { payload } = await jwtVerify(token, getJwtSecret())
      const userId = payload.userId as string
      const userRole = payload.role as string

      // 在请求头中注入用户信息供 API Route 使用
      const requestHeaders = new Headers(request.headers)
      requestHeaders.set('x-user-id', userId)
      requestHeaders.set('x-user-role', userRole)

      return NextResponse.next({
        request: { headers: requestHeaders },
      })
    } catch {
      // P1 修复：token 验证失败返回统一错误格式
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: '登录已过期，请重新登录' } },
        { status: 401 }
      )
    }
  }

  // 页面保护：需要登录的页面
  if (PROTECTED_PAGE_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    const token = request.cookies.get('token')?.value

    if (!token) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('redirect', pathname)
      return NextResponse.redirect(loginUrl)
    }

    try {
      const { payload } = await jwtVerify(token, getJwtSecret())
      const userId = payload.userId as string
      const userRole = payload.role as string

      // 在请求头中注入用户信息供 Server Component 使用（与 API 分支行为一致）
      const requestHeaders = new Headers(request.headers)
      requestHeaders.set('x-user-id', userId)
      requestHeaders.set('x-user-role', userRole)

      return NextResponse.next({
        request: { headers: requestHeaders },
      })
    } catch (err) {
      console.error('[middleware] 页面保护 JWT 验证失败:', pathname, err instanceof Error ? err.message : String(err))
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('redirect', pathname)
      return NextResponse.redirect(loginUrl)
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/api/:path*', '/dashboard/:path*', '/admin/:path*', '/projects/:path*', '/project/:path*', '/merchant', '/merchant/:path*'],
}
