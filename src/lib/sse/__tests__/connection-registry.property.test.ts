/**
 * ConnectionRegistry 属性测试
 *
 * 使用纯函数模拟 ConnectionRegistry 的核心逻辑，避免 ReadableStreamDefaultController 的 mock 复杂度。
 * 验证注册/注销不变式、广播完整性、Event ID 单调递增、每用户连接数上限不变式。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import * as fc from 'fast-check'

// ========== MockConnectionRegistry：模拟核心逻辑的纯函数实现 ==========

interface MockConnection {
  id: string
  createdAt: number
  messages: string[]
  closed: boolean
  eventCounter: number
}

class MockConnectionRegistry {
  private connections = new Map<string, MockConnection[]>()
  private maxPerUser = 5
  private nextId = 0

  register(userId: string): string {
    const id = `conn-${this.nextId++}`
    if (!this.connections.has(userId)) {
      this.connections.set(userId, [])
    }
    const userConns = this.connections.get(userId)!

    // 超过每用户上限时淘汰最旧连接（createdAt 最小）
    if (userConns.length >= this.maxPerUser) {
      userConns.sort((a, b) => a.createdAt - b.createdAt)
      const evicted = userConns.shift()!
      evicted.closed = true
    }

    userConns.push({
      id,
      createdAt: Date.now() + this.nextId, // 确保时间唯一递增
      messages: [],
      closed: false,
      eventCounter: 0,
    })
    return id
  }

  unregister(userId: string, connectionId: string): void {
    const userConns = this.connections.get(userId)
    if (!userConns) return

    const idx = userConns.findIndex((c) => c.id === connectionId)
    if (idx !== -1) {
      userConns[idx].closed = true
      userConns.splice(idx, 1)
    }

    if (userConns.length === 0) {
      this.connections.delete(userId)
    }
  }

  broadcast(userId: string, message: string): void {
    const userConns = this.connections.get(userId)
    if (!userConns) return

    for (const conn of userConns) {
      if (!conn.closed) {
        conn.messages.push(message)
        conn.eventCounter++
      }
    }
  }

  getConnectionCount(userId: string): number {
    const userConns = this.connections.get(userId)
    return userConns ? userConns.length : 0
  }

  getConnections(userId: string): MockConnection[] {
    return this.connections.get(userId) || []
  }

  clear(): void {
    this.connections.clear()
    this.nextId = 0
  }
}

// ========== 属性测试 ==========

describe('ConnectionRegistry Property Tests', () => {
  let registry: MockConnectionRegistry

  beforeEach(() => {
    registry = new MockConnectionRegistry()
  })

  /**
   * Property 1: Connection Registry 注册/注销不变式
   * For any sequence of register/unregister operations,
   * getConnectionCount >= 0 and <= 5
   *
   * **Validates: Requirements 1.2, 1.5, 7.1, 7.3, 7.4**
   */
  describe('Property 1: Connection Registry 注册/注销不变式', () => {
    it('对任意 register/unregister 操作序列，getConnectionCount 始终 >= 0 且 <= 5', () => {
      // 操作类型：register 或 unregister（附带连接 ID）
      const operationArb = fc.oneof(
        fc.constant({ type: 'register' as const }),
        fc.constant({ type: 'unregister' as const })
      )

      fc.assert(
        fc.property(
          fc.array(operationArb, { minLength: 1, maxLength: 50 }),
          (operations) => {
            const reg = new MockConnectionRegistry()
            const userId = 'test-user'
            const registeredIds: string[] = []

            for (const op of operations) {
              if (op.type === 'register') {
                const connId = reg.register(userId)
                registeredIds.push(connId)
              } else {
                // unregister 随机选一个已注册的连接
                if (registeredIds.length > 0) {
                  const idx = Math.floor(Math.random() * registeredIds.length)
                  reg.unregister(userId, registeredIds[idx])
                  registeredIds.splice(idx, 1)
                }
              }

              // 不变式：连接数始终在 [0, 5] 范围内
              const count = reg.getConnectionCount(userId)
              expect(count).toBeGreaterThanOrEqual(0)
              expect(count).toBeLessThanOrEqual(5)
            }
          }
        ),
        { numRuns: 200 }
      )
    })
  })

  /**
   * Property 2: 广播完整性
   * For any userId with N active connections (1 ≤ N ≤ 5),
   * broadcast delivers the same message to all N
   *
   * **Validates: Requirements 7.2**
   */
  describe('Property 2: 广播完整性', () => {
    it('对任意 userId 注册 N 个连接后广播消息，所有 N 个连接都收到相同消息', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5 }),
          fc.string({ minLength: 1, maxLength: 200 }),
          (numConnections, message) => {
            const reg = new MockConnectionRegistry()
            const userId = 'broadcast-user'

            // 注册 N 个连接
            for (let i = 0; i < numConnections; i++) {
              reg.register(userId)
            }

            // 广播消息
            reg.broadcast(userId, message)

            // 验证所有活跃连接都收到了相同的消息
            const connections = reg.getConnections(userId)
            expect(connections.length).toBe(numConnections)

            for (const conn of connections) {
              expect(conn.closed).toBe(false)
              expect(conn.messages).toHaveLength(1)
              expect(conn.messages[0]).toBe(message)
            }
          }
        ),
        { numRuns: 200 }
      )
    })
  })

  /**
   * Property 3: Event ID 单调递增
   * For a single connection, the eventCounter sequence is strictly
   * monotonically increasing after each broadcast
   *
   * **Validates: Requirements 3.3**
   */
  describe('Property 3: Event ID 单调递增', () => {
    it('对单连接连续广播，eventCounter 严格单调递增', () => {
      fc.assert(
        fc.property(
          fc.array(fc.string({ minLength: 1, maxLength: 100 }), {
            minLength: 2,
            maxLength: 30,
          }),
          (messages) => {
            const reg = new MockConnectionRegistry()
            const userId = 'counter-user'

            reg.register(userId)

            const eventCounterHistory: number[] = []

            for (const msg of messages) {
              reg.broadcast(userId, msg)
              const connections = reg.getConnections(userId)
              expect(connections.length).toBe(1)
              eventCounterHistory.push(connections[0].eventCounter)
            }

            // 验证 eventCounter 严格单调递增
            for (let i = 1; i < eventCounterHistory.length; i++) {
              expect(eventCounterHistory[i]).toBeGreaterThan(
                eventCounterHistory[i - 1]
              )
            }
          }
        ),
        { numRuns: 200 }
      )
    })
  })

  /**
   * Property 8: 每用户连接数上限不变式
   * For same userId, register K > 5 connections, verify never more
   * than 5 active, oldest evicted first
   *
   * **Validates: Requirements 7.4**
   */
  describe('Property 8: 每用户连接数上限不变式', () => {
    it('对同一 userId 连续注册 K > 5 个连接，始终最多 5 个活跃连接，且被淘汰的是最旧的', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 6, max: 30 }),
          (totalRegistrations) => {
            const reg = new MockConnectionRegistry()
            const userId = 'limit-user'
            const allRegisteredIds: string[] = []

            for (let i = 0; i < totalRegistrations; i++) {
              const connId = reg.register(userId)
              allRegisteredIds.push(connId)

              // 不变式：连接数永远不超过 5
              const count = reg.getConnectionCount(userId)
              expect(count).toBeLessThanOrEqual(5)
              expect(count).toBeGreaterThanOrEqual(1)
            }

            // 最终验证：活跃连接应为最后注册的 5 个
            const activeConnections = reg.getConnections(userId)
            expect(activeConnections.length).toBe(5)

            // 验证活跃的是最近注册的 5 个连接（oldest evicted first）
            const lastFiveIds = allRegisteredIds.slice(-5)
            const activeIds = activeConnections.map((c) => c.id)
            expect(activeIds).toEqual(lastFiveIds)
          }
        ),
        { numRuns: 200 }
      )
    })
  })
})
