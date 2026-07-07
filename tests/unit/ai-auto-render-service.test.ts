/**
 * AI 一键出片触发逻辑单元测试
 *
 * 测试 POST /api/content-briefs/[briefId]/auto-render 路由的入口验证逻辑：
 * - 正常触发：入队渲染任务 + 更新 brief renderMode/autoGenStartedAt
 * - 已有进行中渲染时拒绝重复触发（409）
 * - brief 状态不允许触发时返回 400
 * - brief 不存在时返回 404
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock 依赖模块
vi.mock('@/lib/shared/db', () => ({
  prisma: {
    contentBrief: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('@/lib/shared/queue', () => ({
  renderLocalVideoQueue: {
    add: vi.fn(),
  },
}))

vi.mock('@/lib/merchant/merchant-auth', () => ({
  getUserIdFromRequest: vi.fn(),
}))

vi.mock('@/lib/merchant/merchant-billing-service', () => ({
  estimateRenderCost: vi.fn(),
  reserveMerchantCredits: vi.fn(),
}))

vi.mock('@/lib/shared/credit-service', () => ({
  getBalance: vi.fn(),
}))

// 导入被 mock 的模块
import { prisma } from '@/lib/shared/db'
import { renderLocalVideoQueue } from '@/lib/shared/queue'
import { getUserIdFromRequest } from '@/lib/merchant/merchant-auth'
import { estimateRenderCost, reserveMerchantCredits } from '@/lib/merchant/merchant-billing-service'
import { getBalance } from '@/lib/shared/credit-service'

// 导入被测路由
import { POST } from '@/app/api/content-briefs/[briefId]/auto-render/route'

// ========================
// 测试数据工厂
// ========================

const TEST_USER_ID = 'user-001'
const TEST_BRIEF_ID = 'brief-001'
const TEST_STORE_ID = 'store-001'
const TEST_MERCHANT_ID = 'merchant-001'

function makeBrief(overrides: Partial<{
  status: string
  merchantUserId: string
  shotTasks: Array<{ durationSec: number }>
}> = {}) {
  const {
    status = 'READY_TO_SHOOT',
    merchantUserId = TEST_USER_ID,
    shotTasks = [{ durationSec: 5 }, { durationSec: 8 }],
  } = overrides

  return {
    id: TEST_BRIEF_ID,
    status,
    storeId: TEST_STORE_ID,
    renderMode: null,
    store: {
      id: TEST_STORE_ID,
      merchant: { userId: merchantUserId, id: TEST_MERCHANT_ID },
    },
    shotTasks,
  }
}

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost:3011/api/content-briefs/brief-001/auto-render', {
    method: 'POST',
  })
}

function makeContext() {
  return { params: Promise.resolve({ briefId: TEST_BRIEF_ID }) }
}

// ========================
// 测试
// ========================

describe('POST /api/content-briefs/[briefId]/auto-render', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 默认 mock 返回
    vi.mocked(getUserIdFromRequest).mockReturnValue(TEST_USER_ID)
    vi.mocked(getBalance).mockResolvedValue(10000)
    vi.mocked(estimateRenderCost).mockReturnValue(100)
    vi.mocked(reserveMerchantCredits).mockResolvedValue(undefined as never)
    vi.mocked(renderLocalVideoQueue.add).mockResolvedValue({ id: 'job-001' } as never)
    vi.mocked(prisma.contentBrief.update).mockResolvedValue({} as never)
  })

  it('正常触发：入队渲染任务 + 更新 brief renderMode', async () => {
    // 准备
    vi.mocked(prisma.contentBrief.findUnique).mockResolvedValue(makeBrief() as never)

    // 执行
    const response = await POST(makeRequest(), makeContext())
    const body = await response.json()

    // 断言：202 + jobId
    expect(response.status).toBe(202)
    expect(body.jobId).toBe('job-001')
    expect(body.message).toContain('一键出片')

    // 断言：更新 renderMode = "AUTO"
    expect(prisma.contentBrief.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TEST_BRIEF_ID },
        data: { renderMode: 'AUTO' },
      })
    )

    // 断言：入队渲染任务
    expect(renderLocalVideoQueue.add).toHaveBeenCalledWith(
      expect.stringContaining('auto-render'),
      expect.objectContaining({
        contentBriefId: TEST_BRIEF_ID,
        userId: TEST_USER_ID,
        mode: 'AUTO_RENDER',
      }),
      expect.any(Object)
    )
  })

  it('DRAFT 状态也允许触发一键出片', async () => {
    vi.mocked(prisma.contentBrief.findUnique).mockResolvedValue(
      makeBrief({ status: 'DRAFT' }) as never
    )

    const response = await POST(makeRequest(), makeContext())
    expect(response.status).toBe(202)
    expect(renderLocalVideoQueue.add).toHaveBeenCalled()
  })

  it('已有进行中渲染时拒绝重复触发（409）', async () => {
    vi.mocked(prisma.contentBrief.findUnique).mockResolvedValue(
      makeBrief({ status: 'RENDERING' }) as never
    )

    const response = await POST(makeRequest(), makeContext())
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.code).toBe('CONFLICT')
    expect(body.error.message).toContain('正在生成中')
    // 不应入队
    expect(renderLocalVideoQueue.add).not.toHaveBeenCalled()
  })

  it('brief 状态不允许触发时返回 400（非 DRAFT/READY_TO_SHOOT）', async () => {
    // MATERIALS_UPLOADED 不在允许列表中
    vi.mocked(prisma.contentBrief.findUnique).mockResolvedValue(
      makeBrief({ status: 'MATERIALS_UPLOADED' }) as never
    )

    const response = await POST(makeRequest(), makeContext())
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.code).toBe('INVALID_STATUS')
    expect(body.error.message).toContain('MATERIALS_UPLOADED')
    expect(renderLocalVideoQueue.add).not.toHaveBeenCalled()
  })

  it('GENERATED 状态不允许触发', async () => {
    vi.mocked(prisma.contentBrief.findUnique).mockResolvedValue(
      makeBrief({ status: 'GENERATED' }) as never
    )

    const response = await POST(makeRequest(), makeContext())
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.code).toBe('INVALID_STATUS')
    expect(renderLocalVideoQueue.add).not.toHaveBeenCalled()
  })

  it('brief 不存在时返回 404', async () => {
    vi.mocked(prisma.contentBrief.findUnique).mockResolvedValue(null)

    const response = await POST(makeRequest(), makeContext())
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error.code).toBe('NOT_FOUND')
    expect(renderLocalVideoQueue.add).not.toHaveBeenCalled()
  })

  it('积分不足时返回 402', async () => {
    vi.mocked(prisma.contentBrief.findUnique).mockResolvedValue(makeBrief() as never)
    vi.mocked(getBalance).mockResolvedValue(10) // 余额不足
    vi.mocked(estimateRenderCost).mockReturnValue(500)

    const response = await POST(makeRequest(), makeContext())
    const body = await response.json()

    expect(response.status).toBe(402)
    expect(body.error.code).toBe('INSUFFICIENT_CREDITS')
    expect(body.error.details.required).toBe(500)
    expect(body.error.details.balance).toBe(10)
    expect(renderLocalVideoQueue.add).not.toHaveBeenCalled()
  })

  it('无权限访问时返回 403', async () => {
    vi.mocked(prisma.contentBrief.findUnique).mockResolvedValue(
      makeBrief({ merchantUserId: 'other-user' }) as never
    )

    const response = await POST(makeRequest(), makeContext())
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.code).toBe('FORBIDDEN')
    expect(renderLocalVideoQueue.add).not.toHaveBeenCalled()
  })
})
