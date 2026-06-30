/**
 * 集成测试 16.3：单版本重生成 / 局部重拍（真实 Seedance + 真实 FFmpeg + 真实 OSS + 计费）
 *
 * 覆盖 spec「local-life-depth-enhancements」需求 4.2 / 4.3 / 4.5：
 * - 单版本重生成（regenerateSingleVariant）：仅就地替换目标版本，其它版本不受影响（隔离性，需求 4.2）。
 * - 局部重拍（rerenderAffectedScope）：基于 impact-scope-service 计算的受影响范围（含尾帧承接链）
 *   仅重渲染受影响分镜组，承接链一并重算、画面承接不断裂（需求 4.3/4.5），全部成功后同事务批量更新。
 * - 复用既有计费链路 reserve→charge，净扣减恰为按受影响时长估算的成本。
 *
 * 真实流程：用 FFmpeg/ffprobe 真实合成，从真实 OSS 下载素材；缺失可选镜头素材时真实调用 Seedance
 * 生成补充片段（非阻塞）。需提供一个真实样例视频 INTEGRATION_SAMPLE_VIDEO 作为门店素材
 * （绝不用伪造素材；缺失则显式跳过）。
 *
 * 真实依赖：PostgreSQL、Redis、Seedance/方舟凭证（SEEDANCE_API_KEY）、OSS 凭证、
 * 本机 FFmpeg/ffprobe、样例视频 INTEGRATION_SAMPLE_VIDEO。
 * 缺任一依赖或未开启 RUN_INTEGRATION=1 时整组显式跳过（打印原因），绝不伪造通过。
 */

import { execFileSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { describe, it, expect, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { redis } from '@/lib/redis'
import { regenerateSingleVariant, rerenderAffectedScope } from '@/lib/local-render-service'
import { estimateRenderCost } from '@/lib/merchant-billing-service'
import { uploadBuffer, deleteObject } from '@/lib/storage'
import {
  computeGate,
  announceSkip,
  hasArkCredential,
  hasOssCredential,
  missingEnv,
  createMerchantFixture,
  cleanupMerchantFixture,
  getUserBalance,
  uniqueSuffix,
} from './_merchant-helpers'

const LABEL = '16.3 单版本重生成/局部重拍'
const SAMPLE_VIDEO = process.env.INTEGRATION_SAMPLE_VIDEO

/** 检测本机 FFmpeg/ffprobe 是否可用（真实渲染前置） */
function ffmpegAvailable(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const envMiss = missingEnv(['DATABASE_URL', 'REDIS_URL'])
const sampleOk = !!SAMPLE_VIDEO && existsSync(SAMPLE_VIDEO)
// ffmpeg 检测仅在其它门控通过时执行，避免无谓 spawn
const baseChecks = [
  { ok: envMiss.length === 0, miss: `缺少环境变量 ${envMiss.join('/')}` },
  { ok: hasArkCredential(), miss: '缺少 Seedance/方舟凭证（SEEDANCE_API_KEY）' },
  { ok: hasOssCredential(), miss: '缺少 OSS 凭证' },
  { ok: sampleOk, miss: '缺少真实样例视频 INTEGRATION_SAMPLE_VIDEO（绝不用伪造素材）' },
]
const baseGate = computeGate(baseChecks)
const ffmpegOk = baseGate.skip ? false : ffmpegAvailable()
const { skip, reason } = computeGate([...baseChecks, { ok: ffmpegOk, miss: '本机缺少 FFmpeg/ffprobe' }])
if (skip) announceSkip(LABEL, reason)

/** 上传样例视频到 OSS 作为某镜头的真实素材，返回 ossKey */
async function uploadSampleAsset(storeId: string, shotTaskId: string): Promise<string> {
  const buf = readFileSync(SAMPLE_VIDEO as string)
  const key = `merchant/${storeId}/test-assets/${shotTaskId}-${uniqueSuffix()}.mp4`
  await uploadBuffer(key, buf)
  return key
}

describe.skipIf(skip)('集成测试 16.3：单版本重生成/局部重拍（真实 Seedance + FFmpeg）', () => {
  afterAll(async () => {
    await prisma.$disconnect().catch(() => {})
    await redis.quit().catch(() => {})
  })

  it('局部重拍：受影响范围（同场景承接链）一并重算 + 计费守恒（需求 4.3/4.5）', async () => {
    const fx = await createMerchantFixture({ creditBalance: 1000 })
    const ossKeys: string[] = []
    try {
      const brief = await prisma.contentBrief.create({
        data: {
          storeId: fx.storeId,
          title: '局部重拍测试',
          goal: 'TRAFFIC',
          scheduledDate: new Date(),
          status: 'GENERATED',
          hook: '现熬骨汤',
          mainMessage: '现做现卖',
          suggestedCta: '点击下方团购',
        },
      })

      // 两个同场景（scene=store）必拍镜头，沿尾帧承接链构成受影响范围扩散
      const shot1 = await prisma.shotTask.create({
        data: {
          contentBriefId: brief.id, order: 1, type: 'STOREFRONT', title: '门头', instruction: '门头实拍',
          durationSec: 5, required: true, framingGuide: { scene: 'store', angle: '平视', movement: '固定' },
        },
      })
      const shot2 = await prisma.shotTask.create({
        data: {
          contentBriefId: brief.id, order: 2, type: 'PRODUCT_CLOSEUP', title: '产品特写', instruction: '牛肉面特写',
          durationSec: 5, required: true, framingGuide: { scene: 'store', angle: '俯拍', movement: '固定' },
        },
      })

      // 上传真实素材给两个镜头
      const k1 = await uploadSampleAsset(fx.storeId, shot1.id)
      const k2 = await uploadSampleAsset(fx.storeId, shot2.id)
      ossKeys.push(k1, k2)
      await prisma.rawAsset.create({ data: { storeId: fx.storeId, shotTaskId: shot1.id, type: 'VIDEO', ossKey: k1, durationSec: 5 } })
      await prisma.rawAsset.create({ data: { storeId: fx.storeId, shotTaskId: shot2.id, type: 'VIDEO', ossKey: k2, durationSec: 5 } })

      // 一个已存在版本（局部重拍以最新素材重合成）
      const variant = await prisma.videoVariant.create({
        data: { contentBriefId: brief.id, type: 'PROMOTION', title: '促销版', durationSec: 10 },
      })

      const before = await getUserBalance(fx.userId)
      // 重拍 shot1：受影响范围 = {shot1, shot2}（同场景承接链）
      const updated = await rerenderAffectedScope({ contentBriefId: brief.id, shotTaskId: shot1.id, userId: fx.userId })

      // 受影响版本重合成成功，产出真实 ossKey、时长有效
      expect(updated.length).toBe(1)
      const v = updated[0]
      expect(v.id).toBe(variant.id)
      expect(v.ossKey).toBeTruthy()
      expect((v.durationSec ?? 0)).toBeGreaterThan(0)
      ossKeys.push(v.ossKey as string)
      if (v.coverOssKey) ossKeys.push(v.coverOssKey)

      // regenScope 记录受影响范围（含承接链）：affectedGroupIds 包含两个镜头、hasContinuityChain=true
      const scope = v.regenScope as { mode?: string; affectedGroupIds?: string[]; hasContinuityChain?: boolean } | null
      expect(scope?.mode).toBe('RESHOOT_SCOPE')
      expect(scope?.affectedGroupIds).toEqual(expect.arrayContaining([shot1.id, shot2.id]))
      expect(scope?.hasContinuityChain).toBe(true)

      // 计费守恒：净扣减恰为按受影响时长（10s）估算的成本
      const expectedCost = estimateRenderCost([10], '720p')
      const after = await getUserBalance(fx.userId)
      expect(before - after).toBe(expectedCost)

      const ledger = await prisma.creditLedger.findMany({
        where: { userId: fx.userId, bizRefType: 'CONTENT_BRIEF', bizRefId: { startsWith: `RESHOOT:${brief.id}:${shot1.id}:` } },
      })
      const actions = ledger.map((e) => e.action)
      expect(actions).toContain('RESERVE')
      expect(actions).toContain('CHARGE')
    } finally {
      for (const k of ossKeys) await deleteObject(k).catch(() => {})
      await cleanupMerchantFixture(fx)
    }
  }, 600_000)

  it('单版本重生成：仅就地替换目标版本，其它版本不受影响（隔离性，需求 4.2）', async () => {
    const fx = await createMerchantFixture({ creditBalance: 1000 })
    const ossKeys: string[] = []
    try {
      const brief = await prisma.contentBrief.create({
        data: {
          storeId: fx.storeId, title: '单版本重生成测试', goal: 'TRAFFIC', scheduledDate: new Date(),
          status: 'GENERATED', hook: '现熬骨汤', mainMessage: '现做现卖', suggestedCta: '点击下方团购',
        },
      })
      const shot = await prisma.shotTask.create({
        data: {
          contentBriefId: brief.id, order: 1, type: 'PRODUCT_CLOSEUP', title: '产品特写', instruction: '牛肉面特写',
          durationSec: 6, required: true, framingGuide: { scene: 'store' },
        },
      })
      const k = await uploadSampleAsset(fx.storeId, shot.id)
      ossKeys.push(k)
      await prisma.rawAsset.create({ data: { storeId: fx.storeId, shotTaskId: shot.id, type: 'VIDEO', ossKey: k, durationSec: 6 } })

      const target = await prisma.videoVariant.create({
        data: { contentBriefId: brief.id, type: 'PROMOTION', title: '促销版', durationSec: 6 },
      })
      const other = await prisma.videoVariant.create({
        data: { contentBriefId: brief.id, type: 'ATMOSPHERE', title: '氛围版', durationSec: 6 },
      })
      const otherUpdatedAtBefore = other.updatedAt

      const before = await getUserBalance(fx.userId)
      const updated = await regenerateSingleVariant({ videoVariantId: target.id, userId: fx.userId })

      // 目标版本被就地替换（id 不变，产出真实 ossKey）
      expect(updated.id).toBe(target.id)
      expect(updated.ossKey).toBeTruthy()
      ossKeys.push(updated.ossKey as string)
      if (updated.coverOssKey) ossKeys.push(updated.coverOssKey)

      // 其它版本完全不受影响（ossKey 仍为空、updatedAt 未变）
      const otherAfter = await prisma.videoVariant.findUniqueOrThrow({ where: { id: other.id } })
      expect(otherAfter.ossKey).toBeNull()
      expect(otherAfter.updatedAt.getTime()).toBe(otherUpdatedAtBefore.getTime())

      // 计费守恒：净扣减恰为按全 brief 时长（6s）估算的成本
      const expectedCost = estimateRenderCost([6], '720p')
      const after = await getUserBalance(fx.userId)
      expect(before - after).toBe(expectedCost)
    } finally {
      for (const k of ossKeys) await deleteObject(k).catch(() => {})
      await cleanupMerchantFixture(fx)
    }
  }, 600_000)
})
