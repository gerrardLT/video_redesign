import { test, expect } from '@playwright/test'

/**
 * zen-editorial-ui-overhaul · 视觉回归截图存档（Task 10.5）
 *
 * Validates Requirements 14.1, 14.2（全页面 v3 禅意风格视觉一致性）。
 *
 * ⚠️ 运行前置条件（本 spec 需真实浏览器 + 运行中的已登录 dev 环境，不在默认 `pnpm test` 范围内）：
 *   1. 安装 Playwright：`pnpm add -D @playwright/test && npx playwright install chromium`
 *   2. 启动依赖：`docker-compose up -d`（Redis）+ 数据库可用 + 已 seed 一个商家账号
 *   3. 启动应用：`pnpm dev`（端口 3011）与 `pnpm dev:workers`
 *   4. 配置环境变量：
 *        ZEN_E2E_BASE_URL（默认 http://localhost:3011）
 *        ZEN_E2E_PHONE / ZEN_E2E_PASSWORD（已完成问诊、含门店的商家账号）
 *        ZEN_E2E_STORE_ID（该账号的门店 ID）
 *   5. 运行：`npx playwright test tests/visual/zen-editorial.spec.ts`
 *
 * 截图输出至 test-results/zen-editorial/ 供人工目视比对（before/after 还原度）。
 * 命名遵循设计 Testing Strategy 的视觉回归表：门店首页(有数据/空态)、日历页、底部导航、Header。
 *
 * 设计说明：截图归档不做像素级断言（视觉风格的「高级感」无法机器判定），仅产出存档供人工评审，
 * 符合设计文档 Testing Strategy「Playwright 截图 before/after 存档，人工目视比对确认」。
 */

const BASE_URL = process.env.ZEN_E2E_BASE_URL ?? 'http://localhost:3011'
const PHONE = process.env.ZEN_E2E_PHONE ?? ''
const PASSWORD = process.env.ZEN_E2E_PASSWORD ?? ''
const STORE_ID = process.env.ZEN_E2E_STORE_ID ?? ''

// 缺少凭证时跳过（避免在无 dev 环境的 CI 中误失败）
const HAS_CREDS = Boolean(PHONE && PASSWORD && STORE_ID)

test.describe('zen-editorial 视觉截图存档（Req 14.1, 14.2）', () => {
  test.skip(!HAS_CREDS, '缺少 ZEN_E2E_* 凭证 / 未运行 dev 环境，跳过视觉截图')

  test.beforeEach(async ({ page }) => {
    // 登录（真实接口，无 mock）
    await page.goto(`${BASE_URL}/login`)
    await page.getByPlaceholder(/手机号|账号/).fill(PHONE)
    await page.getByPlaceholder(/密码/).fill(PASSWORD)
    await page.getByRole('button', { name: /登录|登 录/ }).click()
    await page.waitForURL(/\/(merchant|dashboard)/, { timeout: 15_000 })
  })

  test('门店首页（有数据态）', async ({ page }) => {
    await page.goto(`${BASE_URL}/merchant/stores/${STORE_ID}`)
    await page.waitForLoadState('networkidle')
    // 等签名标题区出现（serif 大标题）
    await expect(page.locator('h2').first()).toBeVisible()
    await page.screenshot({
      path: 'test-results/zen-editorial/store-home-with-data.png',
      fullPage: true,
    })
  })

  test('门店首页（空态插画）', async ({ page }) => {
    // 用一个无数据门店或 mock 空响应的场景；此处假设账号当日无任务即呈现空态
    await page.goto(`${BASE_URL}/merchant/stores/${STORE_ID}`)
    await page.waitForLoadState('networkidle')
    await page.screenshot({
      path: 'test-results/zen-editorial/store-home-empty.png',
      fullPage: true,
    })
  })

  test('日历页（节气式七日）', async ({ page }) => {
    await page.goto(`${BASE_URL}/merchant/stores/${STORE_ID}/calendar`)
    await page.waitForLoadState('networkidle')
    await page.screenshot({
      path: 'test-results/zen-editorial/calendar.png',
      fullPage: true,
    })
  })

  test('底部导航（选中态 + 磨砂背景）', async ({ page }) => {
    await page.goto(`${BASE_URL}/merchant/stores/${STORE_ID}`)
    await page.waitForLoadState('networkidle')
    const nav = page.locator('nav').last()
    await expect(nav).toBeVisible()
    await nav.screenshot({ path: 'test-results/zen-editorial/bottom-nav.png' })
  })

  test('Header（serif 门店名 + 磨砂玻璃）', async ({ page }) => {
    await page.goto(`${BASE_URL}/merchant/stores/${STORE_ID}`)
    await page.waitForLoadState('networkidle')
    const header = page.locator('header').first()
    await expect(header).toBeVisible()
    await header.screenshot({ path: 'test-results/zen-editorial/header.png' })
  })
})
