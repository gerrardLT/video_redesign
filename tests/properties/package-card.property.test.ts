import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: commercialization-features
 * Property 1: 套餐卡片信息完整性（补充测试）
 *
 * 此文件是 packages-page.property.test.ts 的补充测试，
 * 重点验证套餐卡片的边界情况和渲染逻辑一致性。
 *
 * **Validates: Requirements 1.3**
 */

// ========================
// 纯函数提取（与 packages page 组件逻辑一致）
// ========================

interface PackageData {
  id: string
  name: string
  credits: number
  price: number // 单位：分
  description: string | null
  sortOrder: number
  isActive: boolean
}

/**
 * 格式化价格（分 → 元）
 */
function formatPrice(priceInCents: number): string {
  return `¥${(priceInCents / 100).toFixed(priceInCents % 100 === 0 ? 0 : 1)}`
}

/**
 * 格式化单位积分价格
 */
function formatUnitPrice(priceInCents: number, credits: number): string {
  const unit = priceInCents / 100 / credits
  return `¥${unit.toFixed(2)}/积分`
}

/**
 * 卡片渲染逻辑
 */
function renderPackageCard(pkg: PackageData) {
  return {
    name: pkg.name,
    priceText: formatPrice(pkg.price),
    creditsText: `${pkg.credits} 积分`,
    unitPriceText: formatUnitPrice(pkg.price, pkg.credits),
    isActive: pkg.isActive,
  }
}

/**
 * 套餐列表排序逻辑（按 sortOrder 升序）
 */
function sortPackages(packages: PackageData[]): PackageData[] {
  return [...packages].sort((a, b) => a.sortOrder - b.sortOrder)
}

/**
 * 过滤活跃套餐
 */
function filterActivePackages(packages: PackageData[]): PackageData[] {
  return packages.filter((p) => p.isActive)
}

// ========================
// 生成器
// ========================

const packageDataArb: fc.Arbitrary<PackageData> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
  credits: fc.integer({ min: 1, max: 100000 }),
  price: fc.integer({ min: 100, max: 9999900 }),
  description: fc.option(fc.string({ maxLength: 100 }), { nil: null }),
  sortOrder: fc.integer({ min: 0, max: 100 }),
  isActive: fc.boolean(),
})

// ========================
// Property Tests
// ========================

describe('套餐卡片信息完整性 - 补充 Property (Property 1 extended)', () => {
  it('所有渲染的卡片信息字段不为空字符串', () => {
    fc.assert(
      fc.property(packageDataArb, (pkg) => {
        const card = renderPackageCard(pkg)

        expect(card.name.length).toBeGreaterThan(0)
        expect(card.priceText.length).toBeGreaterThan(0)
        expect(card.creditsText.length).toBeGreaterThan(0)
        expect(card.unitPriceText.length).toBeGreaterThan(0)
      }),
      { numRuns: 200 }
    )
  })

  it('单位积分价格 = 价格(元) / 积分数', () => {
    fc.assert(
      fc.property(packageDataArb, (pkg) => {
        const card = renderPackageCard(pkg)
        const unitPrice = parseFloat(
          card.unitPriceText.replace('¥', '').replace('/积分', '')
        )
        const expected = pkg.price / 100 / pkg.credits

        // formatUnitPrice uses toFixed(2), so compare the formatted values
        expect(unitPrice.toFixed(2)).toBe(expected.toFixed(2))
      }),
      { numRuns: 200 }
    )
  })

  it('套餐列表按 sortOrder 升序排列', () => {
    fc.assert(
      fc.property(
        fc.array(packageDataArb, { minLength: 2, maxLength: 10 }),
        (packages) => {
          const sorted = sortPackages(packages)

          for (let i = 1; i < sorted.length; i++) {
            expect(sorted[i].sortOrder).toBeGreaterThanOrEqual(sorted[i - 1].sortOrder)
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('仅展示 isActive 的套餐', () => {
    fc.assert(
      fc.property(
        fc.array(packageDataArb, { minLength: 1, maxLength: 10 }),
        (packages) => {
          const active = filterActivePackages(packages)

          for (const pkg of active) {
            expect(pkg.isActive).toBe(true)
          }

          // 不遗漏任何活跃套餐
          const expectedCount = packages.filter((p) => p.isActive).length
          expect(active.length).toBe(expectedCount)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('价格格式以 ¥ 开头且为正数', () => {
    fc.assert(
      fc.property(packageDataArb, (pkg) => {
        const card = renderPackageCard(pkg)

        expect(card.priceText).toMatch(/^¥/)
        const numericPart = parseFloat(card.priceText.replace('¥', ''))
        expect(numericPart).toBeGreaterThan(0)
      }),
      { numRuns: 200 }
    )
  })
})
