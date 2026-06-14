/**
 * 统一日志工具
 * 
 * Sentry 集成准备就绪：
 * 当需要添加 Sentry 错误监控时，在此处初始化 Sentry SDK 并在 error() 中调用
 * Sentry.captureException()。无需修改其他代码中的 logger 调用。
 * 
 * 安装步骤（需要时执行）：
 * 1. pnpm add @sentry/nextjs
 * 2. 在此文件中 import * as Sentry from '@sentry/nextjs'
 * 3. 在 error() 方法中添加 Sentry.captureException(new Error(msg), { extra: meta })
 */

export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => {
    console.log(`[INFO] ${msg}`, meta || '')
  },
  warn: (msg: string, meta?: Record<string, unknown>) => {
    console.warn(`[WARN] ${msg}`, meta || '')
  },
  error: (msg: string, meta?: Record<string, unknown>) => {
    console.error(`[ERROR] ${msg}`, meta || '')
    // TODO: Sentry.captureException(new Error(msg), { extra: meta })
  },
}
