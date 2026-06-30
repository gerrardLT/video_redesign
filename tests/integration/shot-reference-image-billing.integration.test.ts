/**
 * 集成测试 16.2：镜头参考图生成计费（真实方舟图像生成 + 真实计费链路）
 *
 * 覆盖 spec「local-life-depth-enhancements」需求 3.5：
 * - 走真实方舟（Seedream 5.0 lite）文生图，产物转存真实 OSS，绝不 mock 图像生成。
 * - 验证计费链路 reserve→charge（成功），净扣减恰为固定单价。
 * - 失败/不足时不返回假图：余额不足在预检阶段显式拒绝（无 reserve、无扣减、无图返回）。
 *   （reserve 后失败 REFUND 的守恒不变式由 Property 1 credit-precheck.property.test.ts 通用覆盖。）
 *
 * 真实依赖：PostgreSQL、Redis、方舟图像凭证（SEEDANCE_API_KEY）、OSS 凭证。
 * 缺任一依赖或未开启 RUN_INTEGRATION=1 时整组显式跳过（打印原因），绝不伪造通过。
 */

import { describe, it, expect, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { redis } from '@/lib/redis'
import { generateShotReferenceImage } from '@/lib/capture-director'
import { CREDIT_COST_SHOT_REFERENCE_IMAGE } from '@/constants/merchant'
import { ApiError } from '@/lib/api-error'
import {
  computeGate,
  announceSkip,
  hasArkCredential,
  hasOssCredential,
  missingEnv,
  createMerchantFixture,
  cleanupMerchantFixture,
  getUserBalance,
} from './_merchant-helpers'

const LABEL = '16.2 镜头参考图生成计费'

const envMiss = missingEnv(['DATABASE_URL', 'REDIS_URL'])
const { skip, reason } = computeGate([
  { ok: envMiss.length === 0, miss: `缺少环境变量 ${envMiss.join('/')}` },
  { ok: hasArkCredential(), miss: '缺少方舟图像凭证（SEEDANCE_API_KEY）' },
  { ok: hasOssCredential(), miss: '缺少 OSS 凭证（OSS_BUCKET/OSS_ACCESS_KEY_ID/OSS_ACCESS_KEY_SECRET）' },
])
if (skip) announceSkip(LABEL, reason)

/** 在 brief 下创建一个镜头任务（参考图提示词来源） */
async function createShotTask(contentBriefId: string) {
  return prisma.shotTask.create({
    data: {
      contentBriefId,
      order: 1,
      type: 'PRODUCT_CLOSEUP',
      title: '招牌牛肉面特写',
      instruction: '近景拍摄一碗现做牛肉面，热气腾腾，骨汤清亮，面条筋道，竖屏构图',
      durationSec: 5,
      required: true,
    },
  })
}

describe.skipIf(skip)('集成测试 16.2：镜头参考图生成计费（真实图像生成 + 计费）', () => {
  afterAll(async () => {
    await prisma.$disconnect().catch(() => {})
    await redis.quit().catch(() => {})
  })

  it('成功路径：真实生成参考图并转存 OSS + RESERVE→CHARGE，净扣减恰为单价，返回真实图片 URL（需求 3.5）', async () => {
    const fx = await createMerchantFixture({ creditBalance: 1000 })
    try {
      const brief = await prisma.contentBrief.create({
        data: { storeId: fx.storeId, title: '参考图测试', goal: 'TRAFFIC', scheduledDate: new Date(), status: 'DRAFT' },
      })
      const shot = await createShotTask(brief.id)

      const before = await getUserBalance(fx.userId)
      const { referenceUrl } = await generateShotReferenceImage({ shotTaskId: shot.id, userId: fx.userId })

      // 返回真实图片 URL（非空、为 https 链接），且真实可访问（不返回假图）
      expect(typeof referenceUrl).toBe('string')
      expect(referenceUrl).toMatch(/^https?:\/\//)
      const head = await fetch(referenceUrl)
      expect(head.ok).toBe(true)
      const contentType = head.headers.get('content-type') ?? ''
      expect(contentType.startsWith('image/')).toBe(true)

      // 净扣减恰为固定单价
      const after = await getUserBalance(fx.userId)
      expect(before - after).toBe(CREDIT_COST_SHOT_REFERENCE_IMAGE)

      // 计费流水：RESERVE + CHARGE，关联键以 SHOT_REF: 前缀
      const ledger = await prisma.creditLedger.findMany({
        where: { userId: fx.userId, bizRefType: 'CONTENT_BRIEF', bizRefId: { startsWith: `SHOT_REF:${shot.id}:` } },
      })
      const actions = ledger.map((e) => e.action)
      expect(actions).toContain('RESERVE')
      expect(actions).toContain('CHARGE')
      expect(ledger.every((e) => e.jobId === null)).toBe(true)
    } finally {
      await cleanupMerchantFixture(fx)
    }
  }, 180_000)

  it('余额不足：预检阶段显式拒绝，不返回假图、不 reserve、不扣减（需求 3.5/0.7）', async () => {
    // 余额 1 < 单价 2，预检必拒
    const fx = await createMerchantFixture({ creditBalance: 1 })
    try {
      const brief = await prisma.contentBrief.create({
        data: { storeId: fx.storeId, title: '余额不足', goal: 'TRAFFIC', scheduledDate: new Date(), status: 'DRAFT' },
      })
      const shot = await createShotTask(brief.id)

      const before = await getUserBalance(fx.userId)
      let url: string | undefined
      await expect(
        (async () => {
          const r = await generateShotReferenceImage({ shotTaskId: shot.id, userId: fx.userId })
          url = r.referenceUrl
        })()
      ).rejects.toBeInstanceOf(ApiError)

      // 未返回任何（假）图
      expect(url).toBeUndefined()

      // 余额不变；无任何计费流水（无 reserve、无 charge）
      const after = await getUserBalance(fx.userId)
      expect(after).toBe(before)
      const ledger = await prisma.creditLedger.findMany({
        where: { userId: fx.userId, bizRefType: 'CONTENT_BRIEF', bizRefId: { startsWith: `SHOT_REF:${shot.id}:` } },
      })
      expect(ledger.length).toBe(0)
    } finally {
      await cleanupMerchantFixture(fx)
    }
  }, 60_000)
})
