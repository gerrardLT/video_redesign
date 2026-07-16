/**
 * 统一日志工具
 *
 * 支持结构化 context 字段（requestId/userId/action），便于日志检索与追踪。
 * Sentry 集成准备就绪：
 * 当需要添加 Sentry 错误监控时，在此处初始化 Sentry SDK 并在 error() 中调用
 * Sentry.captureException()。无需修改其他代码中的 logger 调用。
 *
 * 安装步骤（需要时执行）：
 * 1. pnpm add @sentry/nextjs
 * 2. 在此文件中 import * as Sentry from '@sentry/nextjs'
 * 3. 在 error() 方法中添加 Sentry.captureException(new Error(msg), { extra: meta })
 */

/** 可选的结构化上下文，附加到每条日志中 */
export interface LogContext {
  /** 请求唯一标识，用于串联同一请求的日志链 */
  requestId?: string
  /** 操作用户 ID */
  userId?: string
  /** 业务动作标签（如 'render', 'onboarding', 'compliance'） */
  action?: string
  /** 自由扩展字段 */
  [key: string]: unknown
}

function formatMeta(meta?: Record<string, unknown>, context?: LogContext): string {
  const merged = { ...meta, ...context }
  if (Object.keys(merged).length === 0) return ''
  return JSON.stringify(merged)
}

export const logger = {
  info: (msg: string, meta?: Record<string, unknown>, context?: LogContext) => {
    console.log(`[INFO] ${msg}`, formatMeta(meta, context))
  },
  warn: (msg: string, meta?: Record<string, unknown>, context?: LogContext) => {
    console.warn(`[WARN] ${msg}`, formatMeta(meta, context))
  },
  error: (msg: string, meta?: Record<string, unknown>, context?: LogContext) => {
    console.error(`[ERROR] ${msg}`, formatMeta(meta, context))
    // TODO: Sentry.captureException(new Error(msg), { extra: { ...meta, ...context } })
  },
}
