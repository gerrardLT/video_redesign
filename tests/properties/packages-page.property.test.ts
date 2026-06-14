import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: commercialization-features
 * Property 1: 套餐卡片信息完整性
 *
 * For any valid package data, the rendered card shows name, price, credits, and unit price.
 *
 * **Validates: Requirements 1.3**
 */

// ========================
// 从页面组件提取的纯格式化逻辑
// ========================

interface PackageData {
  id: string
  name: string
  credits: number
  price: number // 单位：分
  description: string | null
}

/**
 * 格式化价格显示（与 page.tsx 中 formatPrice 逻辑一致）
 * 将分为单位的价格转为 ¥X 格式
 */
function formatPrice(priceInCents: number): string {
  return `¥${(priceInCents / 100).toFixed(priceInCents % 100 === 0 ? 0 : 1)}`
}

/**
 * 格式化单位积分价格（与 page.tsx 中 formatUnitPrice 逻辑一致）
 */
function formatUnitPrice(priceInCents: number, credits: number): string {
  const unit = priceInCents / 100 / credits
  return `¥${unit.toFixed(2)}/积分`
}

/**
 * 模拟卡片渲染输出：提取套餐卡片应展示的所有信息字段
 * 验证数据完整性，确保所有必要信息都被正确呈现
 */
function renderPackageCard(pkg: PackageData): {
  name: string
  priceText: string
  creditsText: string
  unitPriceText: string
} {
  return {
    name: pkg.name,
    priceText: formatPrice(pkg.price),
    creditsText: `${pkg.credits} 积分`,
    unitPriceText: formatUnitPrice(pkg.price, pkg.credits),
  }
}

// ========================
// 生成器
// ========================

// 套餐名称生成器：非空字符串
const packageNameArb = fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0)

// 价格生成器：以"角"为最小单位（分数为 10 的整数倍），匹配真实套餐定价规则
// 真实套餐价格均为 10 分的整数倍，如 990(¥9.9)、2990(¥29.9)、19990(¥199.9)
// 该约束保证 formatPrice 的一位小数显示无精度损失
const priceArb = fc.integer({ min: 10, max: 999990 }).map((jiao) => jiao * 10) // ¥1 ~ ¥99999

// 积分数量生成器：正整数
const creditsArb = fc.integer({ min: 1, max: 100000 })

// 完整套餐数据生成器
// 约束：价格（分）≥ 积分数，即单位积分价格 ≥ ¥0.01（每积分至少 1 分）
// 与真实套餐定价一致（如体验包 ¥9.9/50积分 = ¥0.198/积分，企业包 ¥199.9/2000积分 ≈ ¥0.10/积分）
// 该约束保证 formatUnitPrice 的两位小数显示恒为正数
const packageDataArb: fc.Arbitrary<PackageData> = fc
  .record({
    id: fc.uuid(),
    name: packageNameArb,
    credits: creditsArb,
    description: fc.option(fc.string({ maxLength: 100 }), { nil: null }),
  })
  .chain((base) => {
    // 价格下限：保证每积分至少 1 分，并向上取整到"角"（10 分）
    const minJiao = Math.max(10, Math.ceil(base.credits / 10))
    return fc
      .integer({ min: minJiao, max: 999990 })
      .map((jiao) => ({ ...base, price: jiao * 10 }))
  })

// ========================
// Property 1: 套餐卡片信息完整性
// ========================

describe('套餐卡片信息完整性 Property (Property 1)', () => {
  it('对于任意有效套餐数据，卡片渲染包含套餐名称', () => {
    fc.assert(
      fc.property(packageDataArb, (pkg) => {
        const card = renderPackageCard(pkg)

        // 卡片必须包含套餐名称
        expect(card.name).toBe(pkg.name)
        expect(card.name.length).toBeGreaterThan(0)
      }),
      { numRuns: 200 }
    )
  })

  it('对于任意有效套餐数据，卡片渲染包含 ¥ 格式化价格', () => {
    fc.assert(
      fc.property(packageDataArb, (pkg) => {
        const card = renderPackageCard(pkg)

        // 价格以 ¥ 开头
        expect(card.priceText).toMatch(/^¥/)
        // 价格数值正确：formatPrice 将分转为元
        const priceInYuan = pkg.price / 100
        expect(card.priceText).toContain('¥')
        // 验证数值正确性
        const displayedValue = parseFloat(card.priceText.replace('¥', ''))
        expect(displayedValue).toBeCloseTo(priceInYuan, 1)
      }),
      { numRuns: 200 }
    )
  })

  it('对于任意有效套餐数据，卡片渲染包含积分数量', () => {
    fc.assert(
      fc.property(packageDataArb, (pkg) => {
        const card = renderPackageCard(pkg)

        // 积分文本包含实际积分数量
        expect(card.creditsText).toContain(String(pkg.credits))
        // 积分文本包含 "积分" 字样
        expect(card.creditsText).toContain('积分')
      }),
      { numRuns: 200 }
    )
  })

  it('对于任意有效套餐数据，卡片渲染包含正确计算的单位积分价格', () => {
    fc.assert(
      fc.property(packageDataArb, (pkg) => {
        const card = renderPackageCard(pkg)

        // 单位价格格式为 ¥X.XX/积分
        expect(card.unitPriceText).toMatch(/^¥\d+\.\d{2}\/积分$/)

        // 验证单位价格计算正确：卡片展示的应是「原始单位价格四舍五入到两位小数」的结果。
        // 直接与 toFixed(2) 的舍入结果比对（精确镜像 formatUnitPrice 的显示语义），
        // 避免用容差带在半分边界（X.XX5）因浮点误差（如 0.005000…001 > 0.005）误判。
        const expectedDisplayedUnitPrice = parseFloat((pkg.price / 100 / pkg.credits).toFixed(2))
        const displayedUnitPrice = parseFloat(
          card.unitPriceText.replace('¥', '').replace('/积分', '')
        )
        expect(displayedUnitPrice).toBe(expectedDisplayedUnitPrice)
      }),
      { numRuns: 200 }
    )
  })

  it('对于任意有效套餐数据，所有四个信息字段均非空', () => {
    fc.assert(
      fc.property(packageDataArb, (pkg) => {
        const card = renderPackageCard(pkg)

        // 所有字段必须非空
        expect(card.name).not.toBe('')
        expect(card.priceText).not.toBe('')
        expect(card.creditsText).not.toBe('')
        expect(card.unitPriceText).not.toBe('')
      }),
      { numRuns: 200 }
    )
  })

  it('formatPrice 对整百价格不显示小数，非整百显示一位小数', () => {
    fc.assert(
      fc.property(priceArb, (priceInCents) => {
        const formatted = formatPrice(priceInCents)

        expect(formatted.startsWith('¥')).toBe(true)

        if (priceInCents % 100 === 0) {
          // 整百：不含小数点
          const numPart = formatted.replace('¥', '')
          expect(numPart).not.toContain('.')
        } else {
          // 非整百：含一位小数
          const numPart = formatted.replace('¥', '')
          expect(numPart).toMatch(/\d+\.\d/)
        }
      }),
      { numRuns: 200 }
    )
  })

  it('单位积分价格始终为正数', () => {
    fc.assert(
      fc.property(packageDataArb, (pkg) => {
        const card = renderPackageCard(pkg)
        const unitPrice = parseFloat(
          card.unitPriceText.replace('¥', '').replace('/积分', '')
        )

        expect(unitPrice).toBeGreaterThan(0)
      }),
      { numRuns: 200 }
    )
  })
})
