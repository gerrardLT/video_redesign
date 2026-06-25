/**
 * SSE 实时进度推送 — Route Handler
 *
 * GET /api/sse/progress
 *
 * 建立 Server-Sent Events 长连接，实时推送任务进度事件。
 * 鉴权方式：
 * - 优先从 middleware 注入的 x-user-id header 获取（常规 API 路由走 Cookie JWT）
 * - EventSource 不支持自定义 header，使用 ?token=JWT 传递完整 JWT token 验证
 *
 * 连接生命周期：
 * 1. 验证用户身份（JWT 签名验证）
 * 2. 检查全局连接容量
 * 3. 创建 ReadableStream 并注册到 ConnectionRegistry
 * 4. 订阅 Redis Pub/Sub 接收进度事件
 * 5. 发送 retry 指令设置重连间隔
 * 6. 启动 30 秒心跳保活定时器
 * 7. 监听连接关闭，清理所有资源
 */

import { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { connectionRegistry } from '@/lib/sse/connection-registry'
import { redisSubscriber } from '@/lib/sse/redis-subscriber'
import { serialize, serializeHeartbeat, serializeRetry } from '@/lib/sse/event-serializer'
import type { ProgressEventPayload } from '@/lib/sse/types'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** 心跳间隔：30 秒 */
const HEARTBEAT_INTERVAL_MS = 30_000
/** 客户端重连间隔：3 秒 */
const RETRY_MS = 3000

/**
 * 从 JWT token 中验证并提取 userId
 * P0 修复：SSE 鉴权从明文 userId 改为 JWT 签名验证，防止越权订阅他人事件
 */
async function verifySSEToken(token: string): Promise<string | null> {
  try {
    const secret = process.env.JWT_SECRET
    if (!secret) return null
    const jwtSecret = new TextEncoder().encode(secret)
    const { payload } = await jwtVerify(token, jwtSecret)
    return (payload.userId as string) || null
  } catch {
    return null
  }
}

/**
 * GET /api/sse/progress
 *
 * 建立 SSE 长连接，实时推送用户的任务进度事件。
 * 鉴权：x-user-id header（middleware 注入）或 ?token=JWT（EventSource 场景，需 JWT 签名验证）。
 * 容量超限返回 503，未授权返回 401。
 */
export async function GET(request: NextRequest): Promise<Response> {
  // 1. Auth — 优先从 middleware 注入的 x-user-id（已经过 JWT 验证）
  let userId = request.headers.get('x-user-id')

  // EventSource 不支持自定义 header，从 ?token= 获取 JWT 并验证签名
  if (!userId) {
    const token = request.nextUrl.searchParams.get('token')
    if (token) {
      userId = await verifySSEToken(token)
    }
  }

  if (!userId) {
    return new Response(
      JSON.stringify({ error: { code: 'UNAUTHORIZED', message: '未授权或 token 无效' } }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // 2. 全局连接容量检查
  if (connectionRegistry.isAtCapacity()) {
    return new Response(
      JSON.stringify({ error: '服务器连接数已满' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // 3. 创建 ReadableStream 实现 SSE 推送
  const stream = new ReadableStream({
    start(controller) {
      // 4. 注册连接到 ConnectionRegistry
      const connectionId = connectionRegistry.register(userId, controller)

      logger.info('SSE 连接建立', { userId, connectionId })

      // 5. 订阅 Redis 频道，接收进度事件并广播给用户所有连接
      // eventId 递增计数器，确保同一连接的事件 ID 单调递增
      let eventId = 0
      const onMessage = (event: ProgressEventPayload) => {
        eventId++
        const sseMessage = serialize(event, eventId)
        connectionRegistry.broadcast(userId, sseMessage)
      }
      redisSubscriber.subscribe(userId, onMessage)

      // 6. 发送 retry 指令，设置客户端重连间隔
      controller.enqueue(new TextEncoder().encode(serializeRetry(RETRY_MS)))

      // 7. 启动 30 秒心跳定时器
      const heartbeatTimer = setInterval(() => {
        connectionRegistry.broadcast(userId, serializeHeartbeat())
      }, HEARTBEAT_INTERVAL_MS)

      // 8. 监听连接关闭（客户端断开），清理所有资源
      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeatTimer)
        connectionRegistry.unregister(userId, connectionId)
        redisSubscriber.removeCallback(userId, onMessage)
        logger.info('SSE 连接关闭，资源已清理', { userId, connectionId })
      })
    },
  })

  // 9. 返回 SSE 响应，设置正确的 headers
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  })
}
