/**
 * SSE 连接监控端点单元测试
 *
 * 测试 GET /api/internal/sse-metrics 的核心行为：
 * - 返回正确的 JSON 结构（totalActiveConnections, connectionsPerUser, timestamp）
 * - 无鉴权请求返回 HTTP 401
 *
 * Requirements: 9.3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock connectionRegistry
vi.mock('@/lib/sse/connection-registry', () => ({
  connectionRegistry: {
    getTotalConnections: vi.fn().mockReturnValue(5),
    getConnectionsPerUser: vi.fn().mockReturnValue(new Map([['user-1', 3], ['user-2', 2]])),
  },
}))

// Mock logger
vi.mock('@/lib/shared/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { GET } from '../route'
import { connectionRegistry } from '@/lib/sse/connection-registry'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(connectionRegistry.getTotalConnections).mockReturnValue(5)
  vi.mocked(connectionRegistry.getConnectionsPerUser).mockReturnValue(
    new Map([['user-1', 3], ['user-2', 2]])
  )
})

/**
 * 创建模拟的 NextRequest
 * @param headers - 自定义 header 对象
 */
function createMockRequest(headers: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/internal/sse-metrics')
  return new NextRequest(url, { headers })
}

describe('GET /api/internal/sse-metrics', () => {
  describe('鉴权 - Requirement 9.3', () => {
    it('无 x-internal-api-key header 返回 HTTP 401', async () => {
      const request = createMockRequest()
      const response = await GET(request)

      expect(response.status).toBe(401)

      const body = await response.json()
      expect(body.error).toBeDefined()
    })

    it('x-internal-api-key 值错误时返回 HTTP 401', async () => {
      const request = createMockRequest({ 'x-internal-api-key': 'wrong-key' })
      const response = await GET(request)

      expect(response.status).toBe(401)

      const body = await response.json()
      expect(body.error).toBeDefined()
    })
  })

  describe('返回正确的 JSON 结构 - Requirement 9.3', () => {
    it('鉴权通过时返回包含 totalActiveConnections、connectionsPerUser、timestamp 的 JSON', async () => {
      const request = createMockRequest({ 'x-internal-api-key': 'internal-secret' })
      const response = await GET(request)

      expect(response.status).toBe(200)

      const body = await response.json()

      // 验证 totalActiveConnections 字段
      expect(body.totalActiveConnections).toBe(5)

      // 验证 connectionsPerUser 字段（Map 被 Object.fromEntries 转换为对象）
      expect(body.connectionsPerUser).toEqual({ 'user-1': 3, 'user-2': 2 })

      // 验证 timestamp 字段为合法 ISO 8601 时间戳
      expect(body.timestamp).toBeDefined()
      expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp)
    })

    it('返回 Content-Type 为 application/json', async () => {
      const request = createMockRequest({ 'x-internal-api-key': 'internal-secret' })
      const response = await GET(request)

      expect(response.headers.get('Content-Type')).toContain('application/json')
    })
  })
})
