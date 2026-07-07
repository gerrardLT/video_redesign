/**
 * SSE 连接注册表 — ConnectionRegistry
 *
 * 管理当前所有活跃的 SSE 连接。支持多用户、多标签页隔离，
 * 实现每用户连接上限（5）、全局连接上限（1000）和连接 TTL（30 分钟）。
 *
 * 数据结构: Map<userId, Map<connectionId, ConnectionEntry>>
 * 导出为单例实例供全局使用。
 */

import { randomUUID } from 'crypto'
import type { ConnectionEntry } from './types'
import { logger } from '@/lib/shared/logger'

/** 每用户最大连接数 */
const MAX_CONNECTIONS_PER_USER = 5
/** 全局最大连接数 */
const MAX_TOTAL_CONNECTIONS = 1000
/** 连接最长存活时间: 30 分钟 */
const CONNECTION_TTL_MS = 30 * 60 * 1000
/** 过期连接清理检查间隔: 60 秒 */
const CLEANUP_INTERVAL_MS = 60 * 1000

const encoder = new TextEncoder()

class ConnectionRegistryImpl {
  /** userId → connectionId → ConnectionEntry */
  private connections = new Map<string, Map<string, ConnectionEntry>>()
  /** 定期清理过期连接的定时器 */
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    this.startCleanupInterval()
  }

  /**
   * 注册新连接，返回生成的 connectionId。
   * 若该用户连接数超过上限（5），淘汰 createdAt 最小的旧连接。
   */
  register(userId: string, controller: ReadableStreamDefaultController): string {
    const connectionId = randomUUID()
    const now = Date.now()

    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Map())
    }

    const userConnections = this.connections.get(userId)!

    // 超过每用户上限时淘汰最旧连接
    if (userConnections.size >= MAX_CONNECTIONS_PER_USER) {
      const oldestEntry = this.findOldestConnection(userConnections)
      if (oldestEntry) {
        logger.info('SSE 连接淘汰最旧连接', {
          userId,
          evictedConnectionId: oldestEntry.connectionId,
        })
        this.closeController(oldestEntry.controller)
        userConnections.delete(oldestEntry.connectionId)
      }
    }

    const entry: ConnectionEntry = {
      connectionId,
      controller,
      createdAt: now,
      lastActiveAt: now,
      eventCounter: 0,
    }

    userConnections.set(connectionId, entry)

    logger.info('SSE 连接已注册', {
      userId,
      connectionId,
      userConnectionCount: userConnections.size,
      totalConnections: this.getTotalConnections(),
    })

    return connectionId
  }

  /**
   * 注销连接，移除注册并关闭对应 controller。
   */
  unregister(userId: string, connectionId: string): void {
    const userConnections = this.connections.get(userId)
    if (!userConnections) return

    const entry = userConnections.get(connectionId)
    if (!entry) return

    this.closeController(entry.controller)
    userConnections.delete(connectionId)

    // 如果该用户已无连接，清理空 Map
    if (userConnections.size === 0) {
      this.connections.delete(userId)
    }

    logger.info('SSE 连接已注销', {
      userId,
      connectionId,
      remainingConnections: userConnections.size,
    })
  }

  /**
   * 向指定用户的所有活跃连接广播 SSE 消息。
   * 每个连接的 eventCounter 自增，lastActiveAt 更新。
   */
  broadcast(userId: string, sseMessage: string): void {
    const userConnections = this.connections.get(userId)
    if (!userConnections || userConnections.size === 0) return

    const encoded = encoder.encode(sseMessage)

    for (const [connectionId, entry] of userConnections) {
      try {
        entry.controller.enqueue(encoded)
        entry.eventCounter++
        entry.lastActiveAt = Date.now()
      } catch {
        // 连接可能已关闭，清理该连接
        logger.warn('SSE 广播写入失败，移除连接', { userId, connectionId })
        userConnections.delete(connectionId)
        if (userConnections.size === 0) {
          this.connections.delete(userId)
        }
      }
    }
  }

  /**
   * 获取指定用户的活跃连接数。
   */
  getConnectionCount(userId: string): number {
    const userConnections = this.connections.get(userId)
    return userConnections ? userConnections.size : 0
  }

  /**
   * 获取全局活跃连接总数。
   */
  getTotalConnections(): number {
    let total = 0
    for (const userConnections of this.connections.values()) {
      total += userConnections.size
    }
    return total
  }

  /**
   * 全局连接数是否已达上限（>= 1000）。
   * 达到上限时应拒绝新连接并返回 HTTP 503。
   */
  isAtCapacity(): boolean {
    return this.getTotalConnections() >= MAX_TOTAL_CONNECTIONS
  }

  /**
   * 获取所有用户的连接数分布（用于监控端点）。
   */
  getConnectionsPerUser(): Map<string, number> {
    const result = new Map<string, number>()
    for (const [userId, userConnections] of this.connections) {
      result.set(userId, userConnections.size)
    }
    return result
  }

  /**
   * 启动定期清理过期连接的定时器。
   * 每 60 秒扫描一次，关闭存活超过 30 分钟的连接。
   */
  private startCleanupInterval(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredConnections()
    }, CLEANUP_INTERVAL_MS)

    // 允许进程在无其他活跃引用时正常退出
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref()
    }
  }

  /**
   * 扫描并关闭所有超过 TTL 的连接。
   * 到期时先发送 reconnect 事件通知客户端重连，再关闭连接。
   */
  private cleanupExpiredConnections(): void {
    const now = Date.now()
    let expiredCount = 0

    for (const [userId, userConnections] of this.connections) {
      for (const [connectionId, entry] of userConnections) {
        if (now - entry.createdAt >= CONNECTION_TTL_MS) {
          // 发送 reconnect 事件通知客户端重连
          this.sendReconnectEvent(entry.controller)
          this.closeController(entry.controller)
          userConnections.delete(connectionId)
          expiredCount++
        }
      }

      // 清理空 Map
      if (userConnections.size === 0) {
        this.connections.delete(userId)
      }
    }

    if (expiredCount > 0) {
      logger.info('SSE 过期连接清理完成', {
        expiredCount,
        remainingTotal: this.getTotalConnections(),
      })
    }
  }

  /**
   * 向 controller 发送 reconnect 事件，通知客户端应重新建立连接。
   */
  private sendReconnectEvent(controller: ReadableStreamDefaultController): void {
    try {
      const message = 'event: reconnect\ndata: {"reason":"connection_ttl_exceeded"}\n\n'
      controller.enqueue(encoder.encode(message))
    } catch {
      // 连接可能已关闭，忽略写入失败
    }
  }

  /**
   * 安全关闭 controller，捕获可能的异常。
   */
  private closeController(controller: ReadableStreamDefaultController): void {
    try {
      controller.close()
    } catch {
      // controller 可能已关闭，忽略
    }
  }

  /**
   * 找到连接 Map 中 createdAt 最小（最旧）的连接。
   */
  private findOldestConnection(
    userConnections: Map<string, ConnectionEntry>
  ): ConnectionEntry | null {
    let oldest: ConnectionEntry | null = null
    for (const entry of userConnections.values()) {
      if (!oldest || entry.createdAt < oldest.createdAt) {
        oldest = entry
      }
    }
    return oldest
  }

  /**
   * 停止清理定时器（用于测试或进程关闭时）。
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  /**
   * 清空所有连接（用于测试）。
   */
  clear(): void {
    for (const [userId, userConnections] of this.connections) {
      for (const [, entry] of userConnections) {
        this.closeController(entry.controller)
      }
      userConnections.clear()
    }
    this.connections.clear()
  }
}

/** 单例实例，全局共享 */
export const connectionRegistry = new ConnectionRegistryImpl()
