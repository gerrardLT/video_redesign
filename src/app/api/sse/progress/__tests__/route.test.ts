/**
 * SSE Route Handler 单元测试
 *
 * 测试 GET /api/sse/progress 的核心行为：
 * - 无效 token 返回 HTTP 401
 * - 正确返回 Content-Type: text/event-stream
 * - 全局连接超限返回 HTTP 503
 * - retry 字段值为 3000
 * - 心跳格式为 `:ping\n\n`
 *
 * Requirements: 1.1, 1.4, 2.1, 2.4, 9.2
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock connectionRegistry
vi.mock('@/lib/sse/connection-registry', () => ({
  connectionRegistry: {
    isAtCapacity: vi.fn().mockReturnValue(false),
    register: vi.fn().mockReturnValue('conn-test-id'),
    unregister: vi.fn(),
    broadcast: vi.fn(),
  },
}))

// Mock redisSubscriber
vi.mock('@/lib/sse/redis-subscriber', () => ({
  redisSubscriber: {
    subscribe: vi.fn(),
    removeCallback: vi.fn(),
  },
}))

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { GET } from '../route'
import { connectionRegistry } from '@/lib/sse/connection-registry'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(connectionRegistry.isAtCapacity).mockReturnValue(false)
  vi.mocked(connectionRegistry.register).mockReturnValue('conn-test-id')
})

/**
 * 创建模拟的 NextRequest
 * @param headers - 自定义 header 对象
 * @param searchParams - URL query 参数对象
 */
function createMockRequest(
  headers: Record<string, string> = {},
  searchParams: Record<string, string> = {}
): NextRequest {
  const url = new URL('http://localhost:3000/api/sse/progress')
  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, value)
  }
  return new NextRequest(url, { headers })
}

describe('GET /api/sse/progress', () => {
  describe('鉴权 - Requirements 1.1, 1.4', () => {
    it('无 x-user-id header 且无 token 参数返回 HTTP 401', async () => {
      const request = createMockRequest()
      const response = await GET(request)

      expect(response.status).toBe(401)
      expect(response.headers.get('Content-Type')).toBe('application/json')

      const body = await response.json()
      expect(body.error).toBeDefined()
    })

    it('有 x-user-id header 时正常建立连接（HTTP 200）', async () => {
      const request = createMockRequest({ 'x-user-id': 'user-123' })
      const response = await GET(request)

      expect(response.status).toBe(200)
    })

    it('无 x-user-id 但有 token query 参数时正常建立连接', async () => {
      const request = createMockRequest({}, { token: 'user-456' })
      const response = await GET(request)

      expect(response.status).toBe(200)
    })
  })

  describe('Content-Type - Requirement 1.1', () => {
    it('成功连接时返回 Content-Type: text/event-stream', async () => {
      const request = createMockRequest({ 'x-user-id': 'user-123' })
      const response = await GET(request)

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('text/event-stream')
    })

    it('成功连接时返回 Cache-Control: no-cache, no-transform', async () => {
      const request = createMockRequest({ 'x-user-id': 'user-123' })
      const response = await GET(request)

      expect(response.headers.get('Cache-Control')).toBe('no-cache, no-transform')
    })
  })

  describe('全局连接超限 - Requirement 9.2', () => {
    it('isAtCapacity 返回 true 时响应 HTTP 503', async () => {
      vi.mocked(connectionRegistry.isAtCapacity).mockReturnValue(true)

      const request = createMockRequest({ 'x-user-id': 'user-123' })
      const response = await GET(request)

      expect(response.status).toBe(503)
      expect(response.headers.get('Content-Type')).toBe('application/json')

      const body = await response.json()
      expect(body.error).toBeDefined()
    })

    it('isAtCapacity 返回 false 时正常建立连接', async () => {
      vi.mocked(connectionRegistry.isAtCapacity).mockReturnValue(false)

      const request = createMockRequest({ 'x-user-id': 'user-123' })
      const response = await GET(request)

      expect(response.status).toBe(200)
    })
  })

  describe('retry 字段 - Requirement 2.4', () => {
    it('SSE 流的第一条消息包含 retry: 3000', async () => {
      const request = createMockRequest({ 'x-user-id': 'user-123' })
      const response = await GET(request)

      // 从响应 body stream 中读取前几个 chunk
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()

      const { value } = await reader.read()
      const text = decoder.decode(value)

      expect(text).toContain('retry: 3000')
      reader.releaseLock()
    })
  })

  describe('心跳格式 - Requirement 2.1', () => {
    it('心跳通过 broadcast 发送，格式为 :ping\\n\\n', async () => {
      // 使用 fake timers 测试心跳
      vi.useFakeTimers()

      const request = createMockRequest({ 'x-user-id': 'user-123' })
      await GET(request)

      // 推进 30 秒触发心跳定时器
      vi.advanceTimersByTime(30_000)

      // 验证 broadcast 被调用，且消息格式为 :ping\n\n
      expect(connectionRegistry.broadcast).toHaveBeenCalledWith('user-123', ':ping\n\n')

      vi.useRealTimers()
    })
  })
})
