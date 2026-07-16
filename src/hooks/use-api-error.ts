/**
 * 前端统一错误处理 hook
 * 根据错误类型显示 toast 或重定向
 */

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface ApiErrorResponse {
  code?: string
  error?: string
  message?: string
}

export function useApiError() {
  const router = useRouter()

  const handleError = useCallback(
    (error: ApiErrorResponse) => {
      const code = error.code
      const message = error.message || error.error || '操作失败'

      switch (code) {
        case 'UNAUTHORIZED':
          // 未登录，重定向到登录页
          router.push('/login')
          break
        case 'FORBIDDEN':
          // 无权限，重定向到商家平台首页
          router.push('/merchant')
          break
        case 'RATE_LIMITED':
          // 频率限制，提示用户
          alert('请求过于频繁，请稍后再试')
          break
        case 'INSUFFICIENT_CREDITS':
          alert('积分不足，请联系管理员充值')
          break
        default:
          // 通用错误提示
          alert(message)
          break
      }
    },
    [router]
  )

  return { handleError }
}
