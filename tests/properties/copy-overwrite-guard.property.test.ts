// Feature: local-life-depth-enhancements, Property 10: 人工修改标记保护
//
// 属性测试：对任意 (copyEdited, confirmOverwrite) 组合，regenerateCopy / rewriteForPlatform：
//   - 当 copyEdited=true AND confirmOverwrite=false 时：抛 CONFIRM_OVERWRITE_REQUIRED（返回需确认），
//     不替换文案（不调用 contentBrief.update）、不清除标记、不调用 LLM（不调用 fetch）、不冻结积分（不 reserve）。
//   - 仅当 confirmOverwrite=true 或 copyEdited=false 时：方可调用 LLM 生成、替换文案、清除标记（update copyEdited=false）。
// 遍历 (copyEdited, confirmOverwrite) 4 种组合断言。
//
// 被测：src/lib/publish-copy-service.ts 的 regenerateCopy / rewriteForPlatform
// 对 prisma / credit-service / merchant-billing-service / LLM(fetch) 做 vi.mock 内存桩。
//
// **Validates: Requirements 2.3, 2.8**

import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'
import type { PlatformCopy, PublishPlatform } from '@/types/merchant'

// ============================================================
// 内存桩（vi.hoisted 在所有 import 之前执行）
// 1) 在模块求值前注入 LLM 环境变量，避免 publish-copy-service 模块加载时
//    因 MERCHANT_LLM_API_URL / KEY 缺失而走配置缺失分支（与本属性无关）。
// 2) 声明所有需要被拦截的 mock 函数，供下方 vi.mock 工厂引用。
// ============================================================
const {
  briefFindMock,
  briefUpdateMock,
  txBriefFindMock,
  productOfferFindMock,
  transactionMock,
  getBalanceMock,
  reserveMock,
  chargeMock,
  refundMock,
  fetchMock,
} = vi.hoisted(() => {
  process.env.MERCHANT_LLM_API_URL = 'https://stub.local/v1'
  process.env.MERCHANT_LLM_API_KEY = 'stub-key'
  return {
    briefFindMock: vi.fn(),
    briefUpdateMock: vi.fn(),
    txBriefFindMock: vi.fn(),
    productOfferFindMock: vi.fn(),
    transactionMock: vi.fn(),
    getBalanceMock: vi.fn(),
    reserveMock: vi.fn(),
    chargeMock: vi.fn(),
    refundMock: vi.fn(),
    fetchMock: vi.fn(),
  }
})

// prisma 内存桩：顶层 contentBrief.findUniqueOrThrow 返回完整 brief（含 store.profile）；
// $transaction 回调注入 tx（其 contentBrief.findUniqueOrThrow 返回 platformCopies，update 复用 briefUpdateMock）。
vi.mock('@/lib/shared/db', () => ({
  prisma: {
    contentBrief: {
      findUniqueOrThrow: briefFindMock,
      update: briefUpdateMock,
    },
    productOffer: {
      findUnique: productOfferFindMock,
    },
    $transaction: transactionMock,
  },
}))

// 积分余额查询内存桩
vi.mock('@/lib/shared/credit-service', () => ({
  getBalance: getBalanceMock,
}))

// 计费链路内存桩（reserve→charge/refund）
vi.mock('@/lib/merchant/merchant-billing-service', () => ({
  reserveMerchantCredits: reserveMock,
  chargeMerchantCredits: chargeMock,
  refundMerchantCredits: refundMock,
}))

import { regenerateCopy, rewriteForPlatform } from '@/lib/merchant/publish-copy-service'

// ============================================================
// 测试夹具
// ============================================================

const PLATFORMS: PublishPlatform[] = ['DOUYIN', 'XIAOHONGSHU', 'WECHAT_CHANNELS', 'KUAISHOU']

/** 一份合法的现有文案（用于 REWRITE 模式输入 + 校验通过） */
function makeValidCopy(suffix = ''): PlatformCopy {
  return {
    title: `招牌好味${suffix}`,
    coverTitle: '到店尝鲜',
    caption: '现做现卖，欢迎到店品尝本周招牌。',
    tags: ['美食', '本地生活', '到店'],
    cta: '到店体验',
  }
}

/** 构造顶层 findUniqueOrThrow 返回的 brief（含 store.profile + 平台现有文案） */
function makeBrief(platform: PublishPlatform, copyEdited: boolean) {
  return {
    id: 'brief-1',
    storeId: 'store-1',
    offerId: null,
    copyEdited,
    platformCopies: { [platform]: makeValidCopy('-existing') },
    store: {
      id: 'store-1',
      name: '测试小馆',
      industry: '餐饮',
      city: '杭州',
      district: '西湖区',
      businessArea: '文三路',
      mainProducts: ['牛肉面'],
      mainSellingPoints: ['现熬骨汤'],
      // 画像：preferredCta / forbiddenClaims 置空，使后处理不改写、文案原样通过校验
      profile: {
        id: 'profile-1',
        storeId: 'store-1',
        contentPositioning: '街坊熟客小馆',
        recommendedPersona: '热情老板',
        hookKeywords: [],
        forbiddenClaims: [],
        preferredCta: [],
      },
    },
  }
}

/** 一次合法的 LLM 响应（fetch 返回体）：choices[0].message.content 为合法文案 JSON */
function makeLlmResponse() {
  return {
    ok: true,
    text: async () => '',
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(makeValidCopy('-new')) } }],
    }),
  }
}

beforeEach(() => {
  briefFindMock.mockReset()
  briefUpdateMock.mockReset()
  txBriefFindMock.mockReset()
  productOfferFindMock.mockReset()
  transactionMock.mockReset()
  getBalanceMock.mockReset()
  reserveMock.mockReset()
  chargeMock.mockReset()
  refundMock.mockReset()
  fetchMock.mockReset()

  // LLM(fetch) 全局桩
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValue(makeLlmResponse())

  // 余额充足（balance >= cost），排除预检拒绝路径对本属性的干扰
  getBalanceMock.mockResolvedValue(1_000_000)
  reserveMock.mockResolvedValue(undefined)
  chargeMock.mockResolvedValue(undefined)
  refundMock.mockResolvedValue(undefined)

  // $transaction：注入 tx，使 update 走 briefUpdateMock；tx.findUniqueOrThrow 返回当前 platformCopies
  transactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      contentBrief: {
        findUniqueOrThrow: txBriefFindMock,
        update: briefUpdateMock,
      },
    })
  )
})

// ============================================================
// Property 10: 人工修改标记保护
// ============================================================

describe('Property 10: 人工修改标记保护', () => {
  /**
   * 对任意 (copyEdited, confirmOverwrite) 组合 × {regenerateCopy, rewriteForPlatform} × 平台：
   *
   * - copyEdited=true AND confirmOverwrite=false ⇒ 抛 CONFIRM_OVERWRITE_REQUIRED（需确认），
   *   且不替换文案（update 不被调用）、不清除标记、不调用 LLM（fetch 不被调用）、不冻结积分（reserve 不被调用）。
   * - 其余 3 种组合（confirmOverwrite=true 或 copyEdited=false）⇒ 正常执行：
   *   调用 LLM（fetch）、冻结积分（reserve）、替换文案并清除标记（update 携带 copyEdited:false）。
   *
   * **Validates: Requirements 2.3, 2.8**
   */
  it('遍历 (copyEdited, confirmOverwrite) 4 种组合：仅 (true,false) 需确认且不副作用', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        fc.boolean(),
        fc.constantFrom<PublishPlatform>(...PLATFORMS),
        fc.constantFrom<'GENERATE' | 'REWRITE'>('GENERATE', 'REWRITE'),
        async (copyEdited, confirmOverwrite, platform, mode) => {
          // 每次迭代重置副作用计数与桩返回
          briefFindMock.mockReset()
          briefUpdateMock.mockReset()
          txBriefFindMock.mockReset()
          reserveMock.mockClear()
          chargeMock.mockClear()
          fetchMock.mockClear()
          fetchMock.mockResolvedValue(makeLlmResponse())

          briefFindMock.mockResolvedValue(makeBrief(platform, copyEdited))
          txBriefFindMock.mockResolvedValue({ platformCopies: { [platform]: makeValidCopy('-existing') } })

          const callee = mode === 'GENERATE' ? regenerateCopy : rewriteForPlatform
          const args = { contentBriefId: 'brief-1', platform, userId: 'user-1', confirmOverwrite }

          const mustConfirm = copyEdited && !confirmOverwrite

          if (mustConfirm) {
            // 受保护：必须抛 CONFIRM_OVERWRITE_REQUIRED 需确认
            let thrown: unknown
            try {
              await callee(args)
            } catch (e) {
              thrown = e
            }
            expect(thrown).toBeDefined()
            expect((thrown as { code?: string }).code).toBe('CONFIRM_OVERWRITE_REQUIRED')

            // 不替换文案、不清除标记、不调用 LLM、不冻结积分
            expect(briefUpdateMock).not.toHaveBeenCalled()
            expect(fetchMock).not.toHaveBeenCalled()
            expect(reserveMock).not.toHaveBeenCalled()
            expect(chargeMock).not.toHaveBeenCalled()
          } else {
            // 允许替换：正常返回预览
            const result = await callee(args)
            expect(result.preview).toBeDefined()

            // 调用了 LLM、冻结了积分
            expect(fetchMock).toHaveBeenCalled()
            expect(reserveMock).toHaveBeenCalled()

            // 替换文案并清除人工修改标记（update 携带 copyEdited:false）
            expect(briefUpdateMock).toHaveBeenCalled()
            const updateArg = briefUpdateMock.mock.calls[0][0] as {
              data: { copyEdited: boolean; platformCopies: Record<string, PlatformCopy> }
            }
            expect(updateArg.data.copyEdited).toBe(false)
            // postProcessCopy 可能追加地区标签，仅检查核心字段不丢失
            const saved = updateArg.data.platformCopies[platform]
            expect(saved.title).toBe(makeValidCopy('-new').title)
            expect(saved.caption).toBe(makeValidCopy('-new').caption)
            expect(saved.coverTitle).toBe(makeValidCopy('-new').coverTitle)
            expect(saved.cta).toBe(makeValidCopy('-new').cta)
            // LLM 原始标签应被保留（postProcessCopy 可能追加但不应丢失原始标签）
            for (const tag of makeValidCopy('-new').tags) {
              expect(saved.tags).toContain(tag)
            }
          }
        }
      ),
      { numRuns: 200 }
    )
  })
})
