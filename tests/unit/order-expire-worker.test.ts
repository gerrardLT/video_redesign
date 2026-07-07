/**
 * 订单过期 Worker 单元测试
 * 测试 order-expire-worker 的 BullMQ job 处理逻辑：
 * - 批量过期超时订单（expire-orders 定时任务）
 * - 单个订单延迟过期
 * - 幂等性保证
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock prisma
const mockPrisma = {
  packageOrder: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
}

vi.mock('@/lib/shared/db', () => ({
  prisma: mockPrisma,
}))

// Mock logger
vi.mock('@/lib/shared/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock redis（Worker 构造需要）
vi.mock('@/lib/shared/redis', () => ({
  redis: {
    options: { maxRetriesPerRequest: null },
    status: 'ready',
  },
}))

// Mock bullmq Worker 构造函数，捕获 processOrderExpire 函数
let capturedProcessor: ((job: unknown) => Promise<unknown>) | null = null

vi.mock('bullmq', () => ({
  Worker: class MockWorker {
    constructor(_name: string, processor: (job: unknown) => Promise<unknown>) {
      capturedProcessor = processor
    }
    on() { return this }
  },
}))

// Mock order-service 中不直接 mock 的部分
vi.mock('@/services/payment', () => ({
  getPaymentGateway: vi.fn(),
}))

vi.mock('@/lib/shared/queue', () => ({
  orderExpireQueue: { add: vi.fn() },
}))

vi.mock('@/lib/shared/credit-service', () => ({
  topupCredits: vi.fn(),
}))

vi.mock('@/lib/shared/notification-service', () => ({
  createPaymentSuccessNotification: vi.fn(),
}))

vi.mock('@/lib/shared/api-error', () => ({
  ApiError: class ApiError extends Error {
    code: string
    statusCode: number
    constructor(code: string, message: string, statusCode = 400) {
      super(message)
      this.code = code
      this.statusCode = statusCode
    }
  },
}))

// 动态导入 worker（触发 mock 后再加载）
beforeEach(async () => {
  vi.clearAllMocks()
  // 确保 worker 被加载，捕获 processor
  if (!capturedProcessor) {
    await import('@/workers/order-expire-worker')
  }
})

/**
 * 创建模拟 Job 对象
 */
function createMockJob(name: string, data: Record<string, unknown> = {}) {
  return { id: `job-${Date.now()}`, name, data }
}

describe('order-expire-worker', () => {
  describe('批量过期定时任务 (expire-orders)', () => {
    it('超时订单标记为 EXPIRED: expireAt < now 的 PENDING 订单被批量过期', async () => {
      // 模拟 updateMany 返回 3 个过期订单
      mockPrisma.packageOrder.updateMany.mockResolvedValueOnce({ count: 3 })

      const job = createMockJob('expire-orders')
      const result = await capturedProcessor!(job)

      expect(result).toEqual({ type: 'batch', expiredCount: 3 })
      expect(mockPrisma.packageOrder.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'PENDING',
          expireAt: { lt: expect.any(Date) },
        },
        data: { status: 'EXPIRED' },
      })
    })

    it('未超时订单不处理: 没有超时订单时返回 0', async () => {
      // 模拟没有符合条件的订单
      mockPrisma.packageOrder.updateMany.mockResolvedValueOnce({ count: 0 })

      const job = createMockJob('expire-orders')
      const result = await capturedProcessor!(job)

      expect(result).toEqual({ type: 'batch', expiredCount: 0 })
    })

    it('批量处理: 多个超时订单一次全部处理', async () => {
      // 模拟批量过期 10 个订单
      mockPrisma.packageOrder.updateMany.mockResolvedValueOnce({ count: 10 })

      const job = createMockJob('expire-orders')
      const result = await capturedProcessor!(job)

      expect(result).toEqual({ type: 'batch', expiredCount: 10 })
      // 确认只调用一次 updateMany（批量操作）
      expect(mockPrisma.packageOrder.updateMany).toHaveBeenCalledTimes(1)
    })
  })

  describe('单个订单延迟过期', () => {
    it('超时 PENDING 订单过期为 EXPIRED', async () => {
      const orderId = 'order-001'

      // findUnique 返回 PENDING 订单
      mockPrisma.packageOrder.findUnique.mockResolvedValueOnce({
        id: orderId,
        status: 'PENDING',
        expireAt: new Date(Date.now() - 60000), // 已过期
      })

      // update 成功
      mockPrisma.packageOrder.update.mockResolvedValueOnce({
        id: orderId,
        status: 'EXPIRED',
      })

      const job = createMockJob(`expire-order-${orderId}`, { orderId })
      const result = await capturedProcessor!(job)

      expect(result).toEqual({ type: 'single', orderId })
      expect(mockPrisma.packageOrder.findUnique).toHaveBeenCalledWith({
        where: { id: orderId },
      })
      expect(mockPrisma.packageOrder.update).toHaveBeenCalledWith({
        where: { id: orderId },
        data: { status: 'EXPIRED' },
      })
    })

    it('已支付订单不处理: status=PAID 的订单即使超时也不受影响', async () => {
      const orderId = 'order-paid'

      // findUnique 返回已支付订单
      mockPrisma.packageOrder.findUnique.mockResolvedValueOnce({
        id: orderId,
        status: 'PAID',
        expireAt: new Date(Date.now() - 60000), // 已过期但已支付
      })

      const job = createMockJob(`expire-order-${orderId}`, { orderId })
      const result = await capturedProcessor!(job)

      // 非 PENDING 状态：expireOrder 内部跳过，Worker 返回正常
      expect(result).toEqual({ type: 'single', orderId })
      // 不应调用 update（只跳过，不修改）
      expect(mockPrisma.packageOrder.update).not.toHaveBeenCalled()
    })

    it('幂等性: 重复执行不会对已 EXPIRED 的订单产生副作用', async () => {
      const orderId = 'order-already-expired'

      // findUnique 返回已过期订单
      mockPrisma.packageOrder.findUnique.mockResolvedValueOnce({
        id: orderId,
        status: 'EXPIRED',
        expireAt: new Date(Date.now() - 60000),
      })

      const job = createMockJob(`expire-order-${orderId}`, { orderId })
      const result = await capturedProcessor!(job)

      // 已 EXPIRED 订单不会再次被更新
      expect(result).toEqual({ type: 'single', orderId })
      expect(mockPrisma.packageOrder.update).not.toHaveBeenCalled()
    })

    it('缺少 orderId 时跳过处理', async () => {
      const job = createMockJob('expire-order-unknown', {})
      const result = await capturedProcessor!(job)

      expect(result).toEqual({ type: 'single', orderId: null, skipped: true })
      expect(mockPrisma.packageOrder.findUnique).not.toHaveBeenCalled()
    })
  })

  describe('不涉及积分退还', () => {
    it('过期订单无积分退还操作（PENDING 订单未支付，无积分需退还）', async () => {
      const orderId = 'order-no-refund'

      mockPrisma.packageOrder.findUnique.mockResolvedValueOnce({
        id: orderId,
        status: 'PENDING',
        credits: 100,
        expireAt: new Date(Date.now() - 60000),
      })

      mockPrisma.packageOrder.update.mockResolvedValueOnce({
        id: orderId,
        status: 'EXPIRED',
      })

      const job = createMockJob(`expire-order-${orderId}`, { orderId })
      await capturedProcessor!(job)

      // 确认 update 只修改 status，不涉及积分操作
      expect(mockPrisma.packageOrder.update).toHaveBeenCalledWith({
        where: { id: orderId },
        data: { status: 'EXPIRED' },
      })
    })
  })
})
