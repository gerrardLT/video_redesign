import { redirect } from 'next/navigation'

/**
 * 根路由入口
 *
 * 视频重绘前端与营销落地页已下线，系统唯一产品线为本地生活营销平台。
 * 访问 "/" 直接重定向到 /merchant；未登录时由 middleware 拦截跳转 /login。
 */
export default function RootPage() {
  redirect('/merchant')
}
