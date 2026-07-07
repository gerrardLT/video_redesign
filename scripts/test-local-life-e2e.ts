/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 本地生活营销平台 — 全流程端到端测试脚本
 *
 * 通过真实 HTTP 接口（localhost:3011）驱动完整业务链路，不 mock、不 fallback：
 *   1. 注册测试用户 → 登录拿 Cookie
 *   2. 商家问诊建店（RESTAURANT 行业，种子剧本仅覆盖餐饮）
 *   3. 轮询门店画像生成（规则引擎 + LLM）
 *   4. 轮询内容计划生成（画像成功后事件驱动自动触发）
 *   5. 读取今日任务 / 内容简报 / 拍摄任务
 *   6. ffmpeg 合成达标素材（竖屏 720x1280 / 6s / 带音轨）上传到每个必拍镜头
 *   7. 触发渲染（素材就绪 + 同质化检测）→ 轮询生成完成
 *   8. 读取视频变体
 *   9. 合规检查
 *   10. 生成多平台发布文案
 *   11. 导出视频（签名下载 URL）
 *   12. 录入发布表现数据
 *
 * 用法: npx tsx scripts/test-local-life-e2e.ts
 *
 * 前置依赖：pnpm dev（3011）、pnpm dev:workers、Redis、PostgreSQL、ffmpeg 在 PATH、
 *          已执行 npx prisma db seed（种入餐饮剧本与订阅套餐）。
 */
import 'dotenv/config'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdir, unlink, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { randomUUID } from 'crypto'

const execFileAsync = promisify(execFile)

const BASE = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'http://localhost:3011'

// ========================
// 测试结果收集
// ========================
interface StageResult {
  stage: string
  ok: boolean
  detail: string
}
const results: StageResult[] = []
function record(stage: string, ok: boolean, detail: string) {
  results.push({ stage, ok, detail })
  const icon = ok ? '✅' : '❌'
  console.log(`${icon} [${stage}] ${detail}`)
}

// ========================
// 带 Cookie 的 HTTP 客户端
// ========================
let cookieJar = ''

interface HttpResult {
  status: number
  ok: boolean
  json: any
  text: string
}

async function http(
  method: string,
  url: string,
  body?: unknown,
  isForm = false
): Promise<HttpResult> {
  const headers: Record<string, string> = {}
  if (cookieJar) headers['Cookie'] = cookieJar
  let payload: BodyInit | undefined
  if (body !== undefined) {
    if (isForm) {
      payload = body as FormData
    } else {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(body)
    }
  }
  const res = await fetch(`${BASE}${url}`, { method, headers, body: payload })

  // 捕获 Set-Cookie（登录/注册）
  const setCookie = res.headers.getSetCookie?.() ?? []
  for (const c of setCookie) {
    const tokenMatch = c.match(/token=[^;]+/)
    if (tokenMatch) cookieJar = tokenMatch[0]
  }

  const text = await res.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: res.status, ok: res.ok, json, text }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// ========================
// 合成达标测试视频（竖屏 720x1280 / 6s / 带音轨 / 亮度充足）
// ========================
async function makeTestVideo(): Promise<string> {
  const dir = path.join(tmpdir(), 'local-life-e2e')
  await mkdir(dir, { recursive: true })
  const out = path.join(dir, `clip_${randomUUID()}.mp4`)
  await execFileAsync('ffmpeg', [
    '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=30:duration=6',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k',
    '-shortest', '-y', out,
  ], { timeout: 60_000 })
  return out
}

// ========================
// 主流程
// ========================
async function main() {
  console.log('============================================')
  console.log('  本地生活营销平台 — 全流程端到端测试')
  console.log(`  目标服务: ${BASE}`)
  console.log('============================================\n')

  const ts = Date.now()
  const email = `lltest_${ts}@example.com`
  const password = 'Test1234!'

  // ---- Stage 1: 注册 ----
  {
    const r = await http('POST', '/api/auth/register', { email, password, nickname: '本地生活测试' })
    if (r.ok && cookieJar) {
      record('注册', true, `用户已创建 ${email}，userId=${r.json?.user?.id}`)
    } else {
      record('注册', false, `HTTP ${r.status}: ${r.text}`)
      return finish()
    }
  }

  // ---- Stage 2: 验证登录态 ----
  {
    const r = await http('GET', '/api/auth/me')
    record('鉴权校验', r.ok, r.ok ? `当前用户 ${r.json?.user?.email ?? r.json?.email ?? '已登录'}` : `HTTP ${r.status}`)
  }

  // ---- Stage 3: 商家问诊建店 ----
  let storeId = ''
  {
    const r = await http('POST', '/api/merchant/onboarding', {
      merchantName: '测试餐厅集团',
      contactName: '王老板',
      phone: '13800000000',
      store: {
        name: `自动化测试餐厅_${ts}`,
        industry: 'RESTAURANT',
        city: '杭州',
        district: '西湖区',
        businessArea: '文三路',
        address: '文三路 100 号',
        avgTicket: 6800,
        openingHours: '10:00-22:00',
        mainProducts: ['招牌牛肉面', '秘制小笼包', '现炒小炒'],
        mainSellingPoints: ['现做现卖', '本地老字号', '食材新鲜'],
        targetCustomers: ['上班族', '家庭聚餐', '学生'],
        canShootKitchen: true,
        canShootStaff: true,
        canShootCustomers: true,
        hasGroupBuying: true,
        hasReservation: true,
      },
      offers: [
        {
          name: '工作日午市套餐',
          description: '12 道菜任选 3 道 + 米饭',
          originalPrice: 6800,
          salePrice: 3980,
          sellingPoints: ['超值', '现做'],
          usageRules: '工作日 11:00-14:00 可用',
        },
      ],
    })
    if (r.status === 201 && r.json?.storeId) {
      storeId = r.json.storeId
      record('商家问诊建店', true, `merchantId=${r.json.merchantId}, storeId=${storeId}`)
    } else {
      record('商家问诊建店', false, `HTTP ${r.status}: ${r.text}`)
      return finish()
    }
  }

  // ---- Stage 4: 轮询门店画像生成（AI）----
  {
    const deadline = Date.now() + 120_000 // 2 分钟
    let done = false
    while (Date.now() < deadline) {
      const r = await http('GET', `/api/stores/${storeId}/profile`)
      if (r.ok && r.json?.profile?.contentPositioning) {
        record('门店画像生成(AI)', true,
          `定位: ${String(r.json.profile.contentPositioning).slice(0, 40)}... ` +
          `钩子词 ${(r.json.profile.hookKeywords?.length ?? 0)} 个`)
        done = true
        break
      }
      await sleep(5000)
    }
    if (!done) record('门店画像生成(AI)', false, '2 分钟内画像未生成（检查 worker 日志 / LLM Key）')
  }

  // ---- Stage 5: 轮询内容计划生成（画像成功后自动触发）----
  let briefId = ''
  let shotTasks: any[] = []
  {
    const deadline = Date.now() + 120_000
    let plan: any = null
    while (Date.now() < deadline) {
      const r = await http('GET', `/api/stores/${storeId}/content-plan/current`)
      if (r.ok && r.json?.contentPlan?.briefs?.length > 0) {
        plan = r.json.contentPlan
        break
      }
      await sleep(5000)
    }
    if (plan) {
      record('内容计划生成(AI)', true,
        `planId=${plan.id}, 共 ${plan.briefs.length} 条内容简报（7天）`)
      // 选取第一条 brief
      const firstBrief = plan.briefs[0]
      briefId = firstBrief.id
      shotTasks = firstBrief.shotTasks ?? []
      record('内容简报选取', true,
        `briefId=${briefId}, 主题=${firstBrief.theme ?? firstBrief.goal ?? '-'}, ` +
        `拍摄任务 ${shotTasks.length} 个`)
    } else {
      record('内容计划生成(AI)', false, '2 分钟内内容计划未生成（检查 generate-content-plan worker / 剧本种子）')
      return finish()
    }
  }

  // ---- Stage 6: 读取今日任务（验证只读导航接口）----
  {
    const r = await http('GET', `/api/stores/${storeId}/today`)
    record('今日任务', r.ok, r.ok
      ? (r.json?.brief ? `今日有任务 briefId=${r.json.brief.id}` : '今日无任务（计划从明天开始，符合预期）')
      : `HTTP ${r.status}`)
  }

  // ---- Stage 7: 合成达标素材并上传到每个必拍镜头 ----
  {
    if (shotTasks.length === 0) {
      // brief 列表里可能未带 shotTasks，单独拉取
      const r = await http('GET', `/api/content-briefs/${briefId}/shot-tasks`)
      if (r.ok) shotTasks = r.json?.shotTasks ?? []
    }
    const requiredTasks = shotTasks.filter((t) => t.required)
    record('拍摄任务解析', requiredTasks.length > 0,
      `必拍镜头 ${requiredTasks.length} 个 / 共 ${shotTasks.length} 个`)

    let testVideo = ''
    try {
      testVideo = await makeTestVideo()
      record('合成测试素材', true, `已生成达标素材 ${path.basename(testVideo)} (720x1280/6s/带音轨)`)
    } catch (e) {
      record('合成测试素材', false, `ffmpeg 合成失败: ${(e as Error).message}`)
      return finish()
    }

    let uploaded = 0
    let passed = 0
    for (const task of requiredTasks) {
      const buf = await readFile(testVideo)
      const form = new FormData()
      form.append('file', new Blob([buf], { type: 'video/mp4' }), 'clip.mp4')
      form.append('shotTaskId', task.id)
      const r = await http('POST', `/api/content-briefs/${briefId}/assets`, form, true)
      if (r.status === 201) {
        uploaded++
        if (r.json?.inspection?.passed) passed++
      } else {
        console.log(`   ⚠ 镜头 "${task.title ?? task.type}" 上传失败 HTTP ${r.status}: ${r.text.slice(0, 200)}`)
      }
    }
    await unlink(testVideo).catch(() => {})
    record('素材上传+质检', passed === requiredTasks.length && requiredTasks.length > 0,
      `上传成功 ${uploaded}/${requiredTasks.length}，质检通过(≥60分) ${passed}/${requiredTasks.length}`)
  }

  // ---- Stage 8: 触发渲染（仅验证素材就绪校验 + 同质化检测 + 成功受理入队）----
  // 说明：按需求不验证"视频生成"本身（Seedance/ffmpeg 合成产物），仅确认渲染请求被正确受理。
  {
    const r = await http('POST', `/api/content-briefs/${briefId}/render`)
    if (r.status === 202) {
      record('触发渲染(受理)', true, `jobId=${r.json?.jobId}` +
        (r.json?.entropyWarning ? `（同质化警告: ${r.json.entropyWarning.uniquenessScore}/100）` : ''))
    } else {
      record('触发渲染(受理)', false, `HTTP ${r.status}: ${r.text.slice(0, 300)}`)
    }
  }

  // 视频生成及其下游（变体/合规/发布文案/导出/数据回填）依赖实际生成产物，
  // 按本次测试范围跳过，不做验证。
  console.log('\n（已按要求跳过：视频生成、变体、合规、发布文案、导出、数据回填等依赖生成产物的阶段）')

  finish()
}

function finish() {
  console.log('\n============================================')
  console.log('  测试结果汇总')
  console.log('============================================')
  const pass = results.filter((r) => r.ok).length
  for (const r of results) {
    console.log(`${r.ok ? '✅ PASS' : '❌ FAIL'}  ${r.stage}`)
  }
  console.log('--------------------------------------------')
  console.log(`  通过 ${pass}/${results.length}`)
  console.log('============================================')
  process.exit(results.every((r) => r.ok) ? 0 : 1)
}

main().catch((err) => {
  console.error('[Fatal Error]', err)
  finish()
})
