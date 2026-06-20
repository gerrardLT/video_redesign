import { PrismaClient } from '../src/generated/prisma'
import { PrismaLibSql } from '@prisma/adapter-libsql'

const adapter = new PrismaLibSql({
  url: process.env.DATABASE_URL ?? 'file:./dev.db',
})
const prisma = new PrismaClient({ adapter })

// ========================
// 套餐种子数据
// ========================
const packages = [
  {
    name: '体验包',
    credits: 50,
    price: 990, // ¥9.9
    description: '适合新用户体验，快速了解 AI 视频重塑效果',
    sortOrder: 1,
  },
  {
    name: '基础包',
    credits: 200,
    price: 2990, // ¥29.9
    description: '满足日常创作需求，性价比之选',
    sortOrder: 2,
  },
  {
    name: '专业包',
    credits: 500,
    price: 5990, // ¥59.9
    description: '专业创作者首选，批量生成更划算',
    sortOrder: 3,
  },
  {
    name: '企业包',
    credits: 2000,
    price: 19990, // ¥199.9
    description: '企业级大容量套餐，团队协作无忧',
    sortOrder: 4,
  },
]

// ========================
// 订阅套餐种子数据
// ========================
const subscriptionPlans = [
  {
    type: 'monthly',
    name: '月卡会员',
    price: 2990, // ¥29.9
    monthlyCredits: 500,
    bonusCredits: 0,
    description: '按月订阅，每月自动到账500积分，享受会员特权',
    privileges: JSON.stringify([
      '优先生成队列',
      '支持1080p分辨率',
      '去除水印',
      '30天版本历史',
    ]),
    sortOrder: 1,
  },
  {
    type: 'quarterly',
    name: '季卡会员',
    price: 7990, // ¥79.9（vs 月卡 ¥29.9×3=¥89.7，省约11%）
    monthlyCredits: 500,
    bonusCredits: 300, // 开通赠送300积分
    description: '按季订阅，每月自动到账500积分，开通赠送300积分',
    privileges: JSON.stringify([
      '优先生成队列',
      '支持1080p分辨率',
      '去除水印',
      '30天版本历史',
      '季卡专属300积分奖励',
    ]),
    sortOrder: 2,
  },
  {
    type: 'yearly',
    name: '年卡会员',
    price: 24900, // ¥249
    monthlyCredits: 500,
    bonusCredits: 1000,
    description: '按年订阅，每月自动到账500积分，额外赠送1000积分奖励，享受全部会员特权',
    privileges: JSON.stringify([
      '优先生成队列',
      '支持1080p分辨率',
      '去除水印',
      '30天版本历史',
      '年卡专属1000积分奖励',
    ]),
    sortOrder: 3,
  },
]

// ========================
// 风格模板种子数据
// ========================
const styleTemplates = [
  {
    name: '写实风格',
    description: '高度真实的画面效果，适合纪录片和产品展示',
    promptPrefix: 'realistic, photorealistic, high quality, detailed',
    sortOrder: 1,
  },
  {
    name: '动漫风格',
    description: '鲜艳的动漫画风，适合娱乐和二次元内容',
    promptPrefix: 'anime style, vibrant colors, cel shading',
    sortOrder: 2,
  },
  {
    name: '3D渲染',
    description: '精致的三维渲染效果，适合科技和建筑展示',
    promptPrefix: '3D render, cinema 4D, octane render, high quality',
    sortOrder: 3,
  },
  {
    name: '水彩风格',
    description: '柔和的水彩画效果，适合艺术和文艺类内容',
    promptPrefix: 'watercolor painting, soft colors, artistic',
    sortOrder: 4,
  },
  {
    name: '赛博朋克',
    description: '霓虹灯效的未来感画面，适合科幻和潮流内容',
    promptPrefix: 'cyberpunk style, neon lights, futuristic, dark',
    sortOrder: 5,
  },
]

async function main() {
  console.log('🌱 开始插入种子数据...')

  // 使用 upsert 确保幂等性：按名称匹配
  for (const pkg of packages) {
    await prisma.package.upsert({
      where: { id: pkg.name }, // 利用 name 作为唯一标识逻辑
      update: {
        credits: pkg.credits,
        price: pkg.price,
        description: pkg.description,
        sortOrder: pkg.sortOrder,
        isActive: true,
      },
      create: {
        id: pkg.name, // 使用名称作为 ID 方便 upsert
        name: pkg.name,
        credits: pkg.credits,
        price: pkg.price,
        description: pkg.description,
        sortOrder: pkg.sortOrder,
        isActive: true,
      },
    })
    console.log(`  ✅ 套餐: ${pkg.name} (${pkg.credits}积分, ¥${(pkg.price / 100).toFixed(1)})`)
  }

  for (const template of styleTemplates) {
    await prisma.styleTemplate.upsert({
      where: { id: template.name }, // 使用名称作为唯一标识逻辑
      update: {
        description: template.description,
        promptPrefix: template.promptPrefix,
        sortOrder: template.sortOrder,
        isActive: true,
      },
      create: {
        id: template.name, // 使用名称作为 ID 方便 upsert
        name: template.name,
        description: template.description,
        promptPrefix: template.promptPrefix,
        sortOrder: template.sortOrder,
        isActive: true,
      },
    })
    console.log(`  ✅ 风格模板: ${template.name}`)
  }

  // 插入订阅套餐种子数据（幂等：按 type 作为 ID 进行 upsert）
  for (const plan of subscriptionPlans) {
    await prisma.subscriptionPlan.upsert({
      where: { id: plan.type }, // 使用 type 作为 ID 确保幂等
      update: {
        name: plan.name,
        price: plan.price,
        monthlyCredits: plan.monthlyCredits,
        bonusCredits: plan.bonusCredits,
        description: plan.description,
        privileges: plan.privileges,
        sortOrder: plan.sortOrder,
        isActive: true,
      },
      create: {
        id: plan.type, // 使用 type 作为 ID 方便 upsert 幂等
        name: plan.name,
        type: plan.type,
        price: plan.price,
        monthlyCredits: plan.monthlyCredits,
        bonusCredits: plan.bonusCredits,
        description: plan.description,
        privileges: plan.privileges,
        sortOrder: plan.sortOrder,
        isActive: true,
      },
    })
    console.log(`  ✅ 订阅套餐: ${plan.name} (¥${(plan.price / 100).toFixed(1)}/期, ${plan.monthlyCredits}积分/月${plan.bonusCredits > 0 ? `, +${plan.bonusCredits}积分奖励` : ''})`)
  }

  console.log('\n🎉 种子数据插入完成！')
  console.log(`   - ${packages.length} 个积分套餐`)
  console.log(`   - ${styleTemplates.length} 个风格模板`)
  console.log(`   - ${subscriptionPlans.length} 个订阅套餐`)
}

main()
  .catch((e) => {
    console.error('❌ 种子数据插入失败:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
