/**
 * 数据迁移脚本：为现有 Asset 记录填充 category 和 displayName 字段
 *
 * 迁移策略：
 * 1. type = 'CHARACTER_IMAGE' → category = 'CHARACTER'，displayName 从 fileName 提取（去后缀）
 * 2. type = 'UPLOADED_IMAGE'  → category = 'MATERIAL'
 * 3. type = 'AI_GENERATED'    → category = 'MATERIAL'
 *
 * 幂等安全：仅更新 category 为 null 的记录，重复运行不会覆盖已迁移数据
 *
 * 运行方式：npx tsx prisma/migrations/data-migrate-asset-category.ts
 */

import { PrismaClient } from '../../src/generated/prisma'
import { PrismaLibSql } from '@prisma/adapter-libsql'

const adapter = new PrismaLibSql({
  url: process.env.DATABASE_URL ?? 'file:./dev.db',
})
const prisma = new PrismaClient({ adapter })

/**
 * 从文件名中提取显示名称（去除扩展名）
 * 例如: "character_01.png" → "character_01"
 */
function extractDisplayName(fileName: string | null): string | null {
  if (!fileName) return null
  const lastDot = fileName.lastIndexOf('.')
  if (lastDot <= 0) return fileName
  return fileName.substring(0, lastDot)
}

async function main() {
  console.log('开始数据迁移：为现有 Asset 记录填充 category 字段...\n')

  // 1. CHARACTER_IMAGE → category = 'CHARACTER'，displayName 从 fileName 提取
  const characterAssets = await prisma.asset.findMany({
    where: {
      type: 'CHARACTER_IMAGE',
      category: null,
    },
    select: {
      id: true,
      fileName: true,
    },
  })

  let characterUpdated = 0
  for (const asset of characterAssets) {
    const displayName = extractDisplayName(asset.fileName)
    await prisma.asset.update({
      where: { id: asset.id },
      data: {
        category: 'CHARACTER',
        displayName,
      },
    })
    characterUpdated++
  }
  console.log(`✅ CHARACTER_IMAGE → CHARACTER: ${characterUpdated} 条记录已更新`)

  // 2. UPLOADED_IMAGE → category = 'MATERIAL'
  const uploadedResult = await prisma.asset.updateMany({
    where: {
      type: 'UPLOADED_IMAGE',
      category: null,
    },
    data: {
      category: 'MATERIAL',
    },
  })
  console.log(`✅ UPLOADED_IMAGE → MATERIAL: ${uploadedResult.count} 条记录已更新`)

  // 3. AI_GENERATED → category = 'MATERIAL'
  const aiResult = await prisma.asset.updateMany({
    where: {
      type: 'AI_GENERATED',
      category: null,
    },
    data: {
      category: 'MATERIAL',
    },
  })
  console.log(`✅ AI_GENERATED → MATERIAL: ${aiResult.count} 条记录已更新`)

  // 汇总
  const total = characterUpdated + uploadedResult.count + aiResult.count
  console.log(`\n迁移完成，共更新 ${total} 条记录`)
}

main()
  .catch((e) => {
    console.error('❌ 数据迁移失败:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
