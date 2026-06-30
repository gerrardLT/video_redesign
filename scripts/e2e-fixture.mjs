/**
 * E2E fixture：在「跳过视频生成」前提下，为下游数据复盘/发布闭环准备真实可用状态。
 *
 * 仅跳过真正的渲染机制，不绕过业务校验：把指定内容任务置为 EXPORTED（使其可录入发布数据），
 * 并为首个 brief 创建一个真实 VideoVariant + PublishQueueItem（驱动发布清单/标记发布/任务中心待发布）。
 *
 * 用法：node scripts/e2e-fixture.mjs <storeId> <briefId1,briefId2,...>
 * 复用与 src/lib/db.ts 相同的 PrismaPg adapter 连接方式。
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'

const require = createRequire(import.meta.url)

// 载入 .env / .env.local 到 process.env（仅补缺失项）
for (const f of ['.env', '.env.local']) {
  if (!fs.existsSync(f)) continue
  const txt = fs.readFileSync(f, 'utf8')
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1')
    }
  }
}

const storeId = process.argv[2]
const briefIds = (process.argv[3] || '').split(',').filter(Boolean)
if (!storeId || briefIds.length === 0) {
  console.error('用法: node scripts/e2e-fixture.mjs <storeId> <briefId1,briefId2,...>')
  process.exit(2)
}

const { PrismaClient } = require('../src/generated/prisma')
const { PrismaPg } = require('@prisma/adapter-pg')

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  // 1. 将指定 brief 置为 EXPORTED（满足 metrics 录入资格 EXPORTED/PUBLISHED/ARCHIVED）
  const upd = await prisma.contentBrief.updateMany({
    where: { id: { in: briefIds }, storeId },
    data: { status: 'EXPORTED' },
  })
  console.log('FIXTURE exported briefs =', upd.count)

  // 2. 为首个 brief 创建一个真实 VideoVariant（模拟已产出成片，不经 Seedance 渲染）
  const briefId = briefIds[0]
  let variant = await prisma.videoVariant.findFirst({ where: { contentBriefId: briefId } })
  if (!variant) {
    variant = await prisma.videoVariant.create({
      data: {
        contentBriefId: briefId,
        type: 'PROMOTION',
        title: 'E2E 促销版成片',
        durationSec: 12,
        ossKey: `merchant/${storeId}/e2e/variant-promotion.mp4`,
        coverOssKey: `merchant/${storeId}/e2e/variant-cover.jpg`,
        isSelected: true,
      },
    })
  }
  console.log('FIXTURE variantId =', variant.id)

  // 3. 创建待发布清单项（导出成功后加入清单的真实状态）
  let item = await prisma.publishQueueItem.findFirst({ where: { videoVariantId: variant.id } })
  if (!item) {
    item = await prisma.publishQueueItem.create({
      data: {
        storeId,
        contentBriefId: briefId,
        videoVariantId: variant.id,
        publishedPlatforms: [],
      },
    })
  }
  console.log('FIXTURE publishQueueItemId =', item.id)
  console.log('FIXTURE_OK')
}

main()
  .catch((e) => { console.error('FIXTURE 失败:', e.message); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect() })
