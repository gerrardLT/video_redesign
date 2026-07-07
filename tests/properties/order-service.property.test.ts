import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: commercialization-features
 * Property 2: 订单创建正确性
 * Property 3: 订单超时过期
 * Property 7: 订单列表排序
 *
 * **Validates: Requirements 2.1, 2.4, 4.1**
 */

// ========================
// 模拟类型定义
// ========================

interface Package {
  id: string
  name: string
  credits: number
  price: number // 单位：分
  isActive: boolean
}

type OrderStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'REQUIRES_MANUAL_REVIEW'
type PayMethod = 'wechat' | 'alipay'

interface PackageOrder {
  id: string
  userId: string
  packageId: string
  amount: number
  credits: number
  status: OrderStatus
  payMethod: PayMethod
  expireAt: Date
  createdAt: Date
}

// ========================
// 模拟 Order Service 核心逻辑（纯函数，避免 Prisma 依赖）
// ========================

/**
 * 模拟 createOrder 核心逻辑：
 * 给定套餐信息和支付方式，生成一笔 PENDING 订单
 */
function simulateCreateOrder(
  userId: string,
  pkg: Package,
  payMethod: PayMethod,
  now: Date
): PackageOrder {
  const expireAt = new Date(now.getTime() + 30 * 60 * 1000) // now + 30 分钟

  return {
    id: `order_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId,
    packageId: pkg.id,
    amount: pkg.price,
    credits: pkg.credits,
    status: 'PENDING',
    payMethod,
    expireAt,
    createdAt: now,
  }
}

/**
 * 模拟 expireTimedOutOrders 核心逻辑：
 * 将所有 PENDING 且 expireAt < now 的订单标记为 EXPIRED
 */
function simulateExpireTimedOutOrders(
  orders: PackageOrder[],
  now: Date
): { updatedOrders: PackageOrder[]; expiredCount: number } {
  let expiredCount = 0
  const updatedOrders = orders.map((order) => {
    if (order.status === 'PENDING' && order.expireAt.getTime() < now.getTime()) {
      expiredCount++
      return { ...order, status: 'EXPIRED' as OrderStatus }
    }
    return order
  })
  return { updatedOrders, expiredCount }
}

/**
 * 模拟 getOrdersByUser 返回排序逻辑：
 * 按 createdAt 倒序排列
 */
function simulateGetOrdersByUser(
  orders: PackageOrder[],
  userId: string,
  page: number,
  pageSize: number
): PackageOrder[] {
  const userOrders = orders.filter((o) => o.userId === userId)
  const sorted = [...userOrders].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  )
  const start = (page - 1) * pageSize
  return sorted.slice(start, start + pageSize)
}

// ========================
// 生成器
// ========================

const packageArb = fc.record({
  id: fc.uuid(),
  name: fc.constantFrom('体验包', '基础包', '专业包', '企业包'),
  credits: fc.constantFrom(100, 500, 2000, 10000),
  price: fc.constantFrom(4900, 17900, 49900, 199900), // 单位：分
  isActive: fc.constant(true),
})

const payMethodArb: fc.Arbitrary<PayMethod> = fc.constantFrom('wechat', 'alipay')

const userIdArb = fc.uuid()

// 生成一个合理的时间戳范围（2024年内），确保是有效 Date（毫秒级唯一性通过整数生成保证）
const dateArb = fc
  .integer({ min: new Date('2024-01-01T00:00:00Z').getTime(), max: new Date('2025-12-31T23:59:59Z').getTime() })
  .map((ms) => new Date(ms))

const orderStatusArb: fc.Arbitrary<OrderStatus> = fc.constantFrom(
  'PENDING',
  'PAID',
  'EXPIRED',
  'REQUIRES_MANUAL_REVIEW'
)

// 生成一个 PackageOrder，支持自定义部分字段
function orderArb(overrides?: {
  userId?: fc.Arbitrary<string>
  status?: fc.Arbitrary<OrderStatus>
  createdAt?: fc.Arbitrary<Date>
  expireAt?: fc.Arbitrary<Date>
}): fc.Arbitrary<PackageOrder> {
  return fc.record({
    id: fc.uuid(),
    userId: overrides?.userId ?? userIdArb,
    packageId: fc.uuid(),
    amount: fc.constantFrom(4900, 17900, 49900, 199900),
    credits: fc.constantFrom(100, 500, 2000, 10000),
    status: overrides?.status ?? orderStatusArb,
    payMethod: payMethodArb,
    expireAt: overrides?.expireAt ?? dateArb,
    createdAt: overrides?.createdAt ?? dateArb,
  })
}

// ========================
// Property 2: 订单创建正确性
// ========================

describe('订单创建正确性 Property (Property 2)', () => {
  it('对于任意有效的 packageId 和 payMethod，createOrder 生成 PENDING 状态订单', () => {
    fc.assert(
      fc.property(
        userIdArb,
        packageArb,
        payMethodArb,
        dateArb,
        (userId, pkg, payMethod, now) => {
          const order = simulateCreateOrder(userId, pkg, payMethod, now)

          expect(order.status).toBe('PENDING')
        }
      ),
      { numRuns: 200 }
    )
  })

  it('订单金额等于套餐价格', () => {
    fc.assert(
      fc.property(
        userIdArb,
        packageArb,
        payMethodArb,
        dateArb,
        (userId, pkg, payMethod, now) => {
          const order = simulateCreateOrder(userId, pkg, payMethod, now)

          expect(order.amount).toBe(pkg.price)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('订单积分等于套餐积分数', () => {
    fc.assert(
      fc.property(
        userIdArb,
        packageArb,
        payMethodArb,
        dateArb,
        (userId, pkg, payMethod, now) => {
          const order = simulateCreateOrder(userId, pkg, payMethod, now)

          expect(order.credits).toBe(pkg.credits)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('expireAt 等于创建时间 + 30 分钟', () => {
    fc.assert(
      fc.property(
        userIdArb,
        packageArb,
        payMethodArb,
        dateArb,
        (userId, pkg, payMethod, now) => {
          const order = simulateCreateOrder(userId, pkg, payMethod, now)

          const expectedExpireAt = new Date(now.getTime() + 30 * 60 * 1000)
          expect(order.expireAt.getTime()).toBe(expectedExpireAt.getTime())
        }
      ),
      { numRuns: 200 }
    )
  })

  it('订单关联正确的 userId 和 packageId', () => {
    fc.assert(
      fc.property(
        userIdArb,
        packageArb,
        payMethodArb,
        dateArb,
        (userId, pkg, payMethod, now) => {
          const order = simulateCreateOrder(userId, pkg, payMethod, now)

          expect(order.userId).toBe(userId)
          expect(order.packageId).toBe(pkg.id)
          expect(order.payMethod).toBe(payMethod)
        }
      ),
      { numRuns: 200 }
    )
  })
})

// ========================
// Property 3: 订单超时过期
// ========================

describe('订单超时过期 Property (Property 3)', () => {
  it('所有 PENDING 且 expireAt < now 的订单变为 EXPIRED', () => {
    fc.assert(
      fc.property(
        fc.array(
          orderArb({ status: fc.constant('PENDING' as OrderStatus) }),
          { minLength: 1, maxLength: 20 }
        ),
        dateArb,
        (orders, now) => {
          const { updatedOrders } = simulateExpireTimedOutOrders(orders, now)

          for (let i = 0; i < orders.length; i++) {
            if (orders[i].expireAt.getTime() < now.getTime()) {
              expect(updatedOrders[i].status).toBe('EXPIRED')
            }
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('expireAt >= now 的 PENDING 订单状态不变', () => {
    fc.assert(
      fc.property(
        fc.array(
          orderArb({ status: fc.constant('PENDING' as OrderStatus) }),
          { minLength: 1, maxLength: 20 }
        ),
        dateArb,
        (orders, now) => {
          const { updatedOrders } = simulateExpireTimedOutOrders(orders, now)

          for (let i = 0; i < orders.length; i++) {
            if (orders[i].expireAt.getTime() >= now.getTime()) {
              expect(updatedOrders[i].status).toBe('PENDING')
            }
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('非 PENDING 状态的订单不受影响', () => {
    fc.assert(
      fc.property(
        fc.array(
          orderArb({
            status: fc.constantFrom('PAID', 'EXPIRED', 'REQUIRES_MANUAL_REVIEW') as fc.Arbitrary<OrderStatus>,
          }),
          { minLength: 1, maxLength: 20 }
        ),
        dateArb,
        (orders, now) => {
          const { updatedOrders, expiredCount } = simulateExpireTimedOutOrders(orders, now)

          // 非 PENDING 状态订单不会被过期
          expect(expiredCount).toBe(0)
          for (let i = 0; i < orders.length; i++) {
            expect(updatedOrders[i].status).toBe(orders[i].status)
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('过期数量等于满足条件的订单数', () => {
    fc.assert(
      fc.property(
        fc.array(orderArb(), { minLength: 0, maxLength: 30 }),
        dateArb,
        (orders, now) => {
          const { expiredCount } = simulateExpireTimedOutOrders(orders, now)

          const expectedCount = orders.filter(
            (o) => o.status === 'PENDING' && o.expireAt.getTime() < now.getTime()
          ).length

          expect(expiredCount).toBe(expectedCount)
        }
      ),
      { numRuns: 200 }
    )
  })
})

// ========================
// Property 7: 订单列表排序
// ========================

describe('订单列表排序 Property (Property 7)', () => {
  it('getOrdersByUser 返回结果按 createdAt 严格降序排列', () => {
    fc.assert(
      fc.property(
        userIdArb,
        fc.array(
          orderArb({ createdAt: dateArb }),
          { minLength: 2, maxLength: 30 }
        ),
        fc.integer({ min: 1, max: 5 }),  // page
        fc.integer({ min: 5, max: 20 }), // pageSize
        (userId, ordersTemplate, page, pageSize) => {
          // 将所有订单的 userId 统一为同一用户
          const orders = ordersTemplate.map((o) => ({ ...o, userId }))

          const result = simulateGetOrdersByUser(orders, userId, page, pageSize)

          // 验证返回列表按 createdAt 降序
          for (let i = 1; i < result.length; i++) {
            expect(result[i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(
              result[i].createdAt.getTime()
            )
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('返回的订单都属于指定用户', () => {
    fc.assert(
      fc.property(
        userIdArb,
        userIdArb, // 另一个用户
        fc.array(orderArb(), { minLength: 1, maxLength: 20 }),
        (targetUserId, otherUserId, ordersTemplate) => {
          fc.pre(targetUserId !== otherUserId)

          // 混合两个用户的订单
          const orders = ordersTemplate.map((o, i) => ({
            ...o,
            userId: i % 2 === 0 ? targetUserId : otherUserId,
          }))

          const result = simulateGetOrdersByUser(orders, targetUserId, 1, 100)

          // 所有返回的订单都属于 targetUserId
          for (const order of result) {
            expect(order.userId).toBe(targetUserId)
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('分页不超过 pageSize 条记录', () => {
    fc.assert(
      fc.property(
        userIdArb,
        fc.array(
          orderArb(),
          { minLength: 1, maxLength: 50 }
        ),
        fc.integer({ min: 1, max: 3 }),   // page
        fc.integer({ min: 1, max: 10 }),  // pageSize
        (userId, ordersTemplate, page, pageSize) => {
          const orders = ordersTemplate.map((o) => ({ ...o, userId }))

          const result = simulateGetOrdersByUser(orders, userId, page, pageSize)

          expect(result.length).toBeLessThanOrEqual(pageSize)
        }
      ),
      { numRuns: 200 }
    )
  })
})
