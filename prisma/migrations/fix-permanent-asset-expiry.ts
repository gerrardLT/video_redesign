/**
 * 数据迁移脚本：修正永久资产的过期时间
 *
 * 目的：将所有 category 有值但 expiresAt 不为 null 的记录修正为 expiresAt=null
 * 确保系统不变量：category 有值 → expiresAt 为 null（永久资产不过期）
 *
 * 幂等设计：可安全重复执行，不会改变已正确的记录
 *
 * 使用方法：npx tsx prisma/migrations/fix-permanent-asset-expiry.ts
 */

import { PrismaClient } from '../../src/generated/prisma'
import { PrismaLibSql } from '@prisma/adapter-libsql'

const adapter = new PrismaLibSql({
  url: process.env.DATABASE_URL ?? 'file:./dev.db',
})
const prisma = new PrismaClient({ adapter })

async function migrate() {
  console.log('[数据迁移] 开始修正永久资产过期时间...')

  const result = await prisma.asset.updateMany({
    where: {
      category: { not: null },
      expiresAt: { not: null },
    },
    data: { expiresAt: null },
  })

  console.log(`[数据迁移] 修正了 ${result.count} 条永久资产的过期时间`)
  console.log('[数据迁移] 迁移完成')
}

migrate()
  .catch((e) => {
    console.error('[数据迁移] 迁移失败:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
