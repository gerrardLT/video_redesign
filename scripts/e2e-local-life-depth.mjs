/**
 * 本地生活深化改造 — 端到端真实流程驱动脚本（后端，全程真实 HTTP API + 真实 DB/Redis/LLM）
 * 跳过真正的视频生成（Seedance 渲染）；其余环节真实跑通。
 *
 * 运行：node scripts/e2e-local-life-depth.mjs
 */

const BASE = process.env.E2E_BASE || 'http://localhost:3011'
let cookie = ''
const results = []

function rec(step, ok, detail) {
  results.push({ step, ok, detail })
  const tag = ok ? 'PASS' : 'FAIL'
  console.log(`[${tag}] ${step}${detail ? ' :: ' + detail : ''}`)
}

async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' }
  if (cookie) headers['Cookie'] = cookie
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) {
    const tok = setCookie.match(/token=[^;]+/)
    if (tok) cookie = tok[0]
  }
  let json = null
  const text = await res.text()
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, json }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function poll(fn, { tries = 30, interval = 2000, label = '' } = {}) {
  for (let i = 0; i < tries; i++) {
    const v = await fn()
    if (v) return v
    await sleep(interval)
  }
  throw new Error(`poll timeout: ${label}`)
}

async function main() {
  console.log('=== 本地生活深化 E2E（后端真实流程，跳过视频生成）===')
  console.log('BASE =', BASE)

  // ── 1. 注册 + 登录态 ──
  const email = `e2e_${Date.now()}@example.com`
  const password = 'Test1234!'
  let r = await api('POST', '/api/auth/register', { email, password, nickname: 'E2E商家' })
  rec('1. 注册并获取会话', r.status === 200 && !!cookie, `status=${r.status} user=${r.json?.user?.id ?? '-'}`)
  if (!cookie) throw new Error('注册未获得会话 cookie，终止')

  // ── 2. 商家问诊（创建 Merchant + Store，异步触发画像生成）──
  const onboarding = {
    merchantName: 'E2E 牛肉面馆',
    contactName: '王老板',
    phone: '13800000000',
    store: {
      name: 'E2E 牛肉面馆(文三路店)',
      industry: 'RESTAURANT',
      city: '杭州', district: '西湖区', businessArea: '文三路',
      address: '文三路 100 号', avgTicket: 3500, openingHours: '10:00-22:00',
      mainProducts: ['现熬牛肉面', '红烧牛腩面'],
      mainSellingPoints: ['现熬8小时骨汤', '牛肉足量'],
      targetCustomers: ['周边上班族', '家庭'],
      canShootKitchen: true, canShootStaff: true, canShootCustomers: false,
      hasGroupBuying: true, hasReservation: false,
    },
    offers: [
      { name: '双人套餐', description: '两碗面+小菜', originalPrice: 7000, salePrice: 4900, sellingPoints: ['超值'] },
    ],
  }
  r = await api('POST', '/api/merchant/onboarding', onboarding)
  const storeId = r.json?.storeId
  rec('2. 商家问诊创建门店', r.status === 201 && !!storeId, `status=${r.status} storeId=${storeId ?? '-'}`)
  if (!storeId) throw new Error('问诊未返回 storeId，终止')

  // ── 3. 轮询门店画像生成（Worker + 真实 LLM aiSummary）──
  const profile = await poll(async () => {
    const p = await api('GET', `/api/stores/${storeId}/profile`)
    if (p.status === 200 && p.json?.profile?.status) return p.json.profile
    return null
  }, { tries: 40, interval: 2000, label: 'store profile' }).catch((e) => { rec('3. 门店画像生成', false, e.message); return null })
  if (profile) rec('3. 门店画像生成', true, `status=${profile.status} hookKw=${(profile.hookKeywords||[]).length} cta=${(profile.preferredCta||[]).length}`)

  // ── 4. 轮询内容计划（画像成功后 Worker 自动触发；超时则主动生成）──
  let plan = await poll(async () => {
    const p = await api('GET', `/api/stores/${storeId}/content-plan/current`)
    if (p.status === 200 && p.json?.contentPlan?.briefs?.length) return p.json.contentPlan
    return null
  }, { tries: 15, interval: 2000, label: 'auto content plan' }).catch(() => null)

  if (!plan) {
    const g = await api('POST', `/api/stores/${storeId}/content-plan/generate`, {})
    rec('4a. 主动触发内容计划生成', g.status === 202, `status=${g.status}`)
    plan = await poll(async () => {
      const p = await api('GET', `/api/stores/${storeId}/content-plan/current`)
      if (p.status === 200 && p.json?.contentPlan?.briefs?.length) return p.json.contentPlan
      return null
    }, { tries: 30, interval: 2000, label: 'content plan' }).catch((e) => { rec('4. 内容计划生成', false, e.message); return null })
  }
  if (!plan) throw new Error('内容计划未生成，终止后续依赖步骤')
  const briefs = plan.briefs
  rec('4. 内容计划生成', briefs.length > 0, `planId=${plan.id} briefs=${briefs.length}`)
  const brief0 = briefs[0]

  // ── 5. 需求5 溯源：GET provenance ──
  r = await api('GET', `/api/content-briefs/${brief0.id}/provenance`)
  rec('5. 内容溯源(可解释)', r.status === 200 && !!r.json?.provenance, `status=${r.status} generic=${r.json?.provenance?.isGenericTemplate} refs=${r.json?.provenance?.references?.length ?? '-'}`)

  // ── 6. 需求5 画像调整（仅对后续生效）──
  r = await api('PATCH', `/api/stores/${storeId}/profile/adjust`, { updateCta: ['到店报暗号立减'] })
  rec('6. 画像调整(可干预/不回溯)', r.status === 200, `status=${r.status}`)

  // ── 7. 需求6 计划可编辑：换选题 + 日锁定 ──
  r = await api('PATCH', `/api/content-briefs/${brief0.id}`, { op: 'CHANGE_GOAL', payload: { newGoal: 'BRAND_STORY' } })
  rec('7a. 换选题(重实例化)', r.status === 200, `status=${r.status} warn=${r.json?.assetWarning ? 'Y' : 'N'}`)
  const lockDate = new Date(brief0.scheduledDate)
  r = await api('PUT', `/api/stores/${storeId}/calendar/day-lock`, { date: lockDate.toISOString(), state: 'LOCKED' })
  rec('7b. 锁定某天(下一轮尊重)', r.status === 200, `status=${r.status}`)

  // ── 8. 需求3 拍摄引导：shot-tasks → guide / reshoot-advice ──
  r = await api('GET', `/api/content-briefs/${brief0.id}/shot-tasks`)
  const shotTasks = r.json?.shotTasks ?? []
  rec('8a. 取镜头任务', r.status === 200 && shotTasks.length > 0, `status=${r.status} shots=${shotTasks.length}`)
  if (shotTasks[0]) {
    const stId = shotTasks[0].id
    r = await api('GET', `/api/shot-tasks/${stId}/guide`)
    const g = r.json?.guide
    rec('8b. 拍摄前可视化引导', r.status === 200 && !!g?.qualityThresholds, `status=${r.status} aspect=${g?.qualityThresholds?.aspectRatio?.target} minBright=${g?.qualityThresholds?.minAvgBrightness}`)
    r = await api('GET', `/api/shot-tasks/${stId}/reshoot-advice`)
    rec('8c. 重拍建议(无质检如实提示)', r.status === 200, `status=${r.status} hasReport=${r.json?.hasReport}`)
  }

  // ── 9. 需求2 文案可操作：就地保存 → 重新生成(真实 LLM) → 按平台改写(真实 LLM) ──
  const platform = 'DOUYIN'
  const manualCopy = { title: 'E2E 手改标题', coverTitle: '现熬骨汤', caption: '手动编辑的文案内容', tags: ['牛肉面', '杭州美食'], cta: '到店品尝' }
  r = await api('PUT', `/api/content-briefs/${brief0.id}/copy`, { platform, copy: manualCopy })
  rec('9a. 文案就地保存(置人工修改标记)', r.status === 200, `status=${r.status}`)
  r = await api('POST', `/api/content-briefs/${brief0.id}/copy/regenerate`, { platform, confirmOverwrite: false })
  rec('9b. 重新生成-人工修改保护(应需确认)', r.status === 409 || r.json?.error?.code === 'CONFIRM_OVERWRITE_REQUIRED', `status=${r.status} code=${r.json?.error?.code ?? '-'}`)
  r = await api('POST', `/api/content-briefs/${brief0.id}/copy/regenerate`, { platform, confirmOverwrite: true })
  rec('9c. 重新生成文案(真实 LLM+计费)', r.status === 200 && !!r.json?.preview?.caption, `status=${r.status} len=${r.json?.preview?.caption?.length ?? '-'}`)
  r = await api('POST', `/api/content-briefs/${brief0.id}/copy/rewrite-platform`, { platform, confirmOverwrite: true })
  rec('9d. 按平台改写(真实 LLM+计费)', r.status === 200 && !!r.json?.preview, `status=${r.status}`)

  // ── 9.5 Fixture：跳过视频生成的前提下，把 3 条 brief 置为 EXPORTED 并建成片+待发布项 ──
  // （仅跳过渲染机制，不绕过业务校验；使下游数据复盘/发布闭环可对真实状态运行）
  const metricBriefs = briefs.slice(0, Math.min(3, briefs.length))
  {
    const { execFileSync } = await import('node:child_process')
    try {
      const out = execFileSync('node', ['scripts/e2e-fixture.mjs', storeId, metricBriefs.map((b) => b.id).join(',')], { encoding: 'utf8' })
      const okFix = out.includes('FIXTURE_OK')
      const vMatch = out.match(/FIXTURE variantId = (\S+)/)
      const iMatch = out.match(/FIXTURE publishQueueItemId = (\S+)/)
      globalThis.__variantId = vMatch?.[1]
      globalThis.__pqItemId = iMatch?.[1]
      rec('9.5 Fixture(置EXPORTED+成片+待发布项)', okFix, `exported=${(out.match(/exported briefs = (\d+)/)||[])[1] ?? '-'} variant=${globalThis.__variantId ?? '-'}`)
    } catch (e) {
      rec('9.5 Fixture(置EXPORTED+成片+待发布项)', false, e.message)
    }
  }

  // ── 10. 需求1 数据复盘闭环：录入≥3条 metrics → 解锁洞察 → 趋势/跨周 → 应用 ──
  let recorded = 0
  for (let i = 0; i < metricBriefs.length; i++) {
    const b = metricBriefs[i]
    const mr = await api('POST', `/api/content-briefs/${b.id}/metrics`, {
      platform, views: 5000 + i * 1000, likes: 200 + i * 50, comments: 10 + i, shares: 5,
      saves: 30 + i * 5, linkClicks: 50 + i * 10, messages: 2, orders: 8 + i, redemptions: 3 + i, revenueCents: 49000,
    })
    if (mr.status === 200 || mr.status === 201) recorded++
  }
  rec('10a. 录入发布数据(≥3条)', recorded === metricBriefs.length, `recorded=${recorded}/${metricBriefs.length}`)
  r = await api('GET', `/api/stores/${storeId}/insights`)
  rec('10b. 复盘洞察解锁/渲染', r.status === 200, `status=${r.status} unlocked=${r.json?.unlocked} suggestions=${r.json?.insights?.suggestions?.length ?? '-'} remaining=${r.json?.remaining ?? '-'}`)
  r = await api('GET', `/api/stores/${storeId}/metrics/trend?metric=views`)
  rec('10c. 指标趋势', r.status === 200, `status=${r.status} points=${r.json?.trend?.length ?? '-'}`)
  r = await api('GET', `/api/stores/${storeId}/metrics/period-comparison`)
  rec('10d. 跨周对比', r.status === 200, `status=${r.status} available=${r.json?.available}`)
  r = await api('POST', `/api/stores/${storeId}/insights/apply`, { acceptedNextGoals: ['TRAFFIC'], acceptedSuggestionSummaries: ['下周多做引流内容'] })
  rec('10e. 应用建议到下轮(可反哺)', r.status === 200 || r.status === 201, `status=${r.status}`)

  // ── 11. 需求7 自营账号关联(真实凭证流程+加密) ──
  r = await api('POST', `/api/stores/${storeId}/platform-accounts`, { platform })
  const authToken = r.json?.authToken
  rec('11a. 关联前风险告知+authToken', r.status === 200 && !!authToken, `status=${r.status} risks=${r.json?.risks?.length ?? '-'}`)
  r = await api('POST', `/api/stores/${storeId}/platform-accounts`, { platform, cookie: `e2e-session-${Date.now()}`, authConfirmed: true, authToken })
  rec('11b. 保存凭证(服务端加密存储)', r.status === 200 || r.status === 201, `status=${r.status}`)

  // ── 12. 需求9 任务/通知中心 ──
  r = await api('GET', `/api/stores/${storeId}/task-center`)
  rec('12a. 任务中心聚合', r.status === 200, `status=${r.status} tasks=${r.json?.tasks?.length ?? (Array.isArray(r.json) ? r.json.length : '-')}`)
  r = await api('GET', `/api/stores/${storeId}/notifications`)
  rec('12b. 通知中心列表', r.status === 200, `status=${r.status} notifs=${r.json?.notifications?.length ?? (Array.isArray(r.json) ? r.json.length : '-')}`)

  // ── 13. 需求10 多门店切换器/跨店看板 ──
  r = await api('GET', '/api/stores/switcher')
  rec('13a. 门店切换器(单店应隐藏)', r.status === 200, `status=${r.status} multiStore=${r.json?.multiStore}`)
  r = await api('GET', '/api/stores/dashboard')
  rec('13b. 跨店看板聚合', r.status === 200, `status=${r.status} stores=${Array.isArray(r.json) ? r.json.length : (r.json?.stores?.length ?? '-')}`)

  // ── 14. 需求11 激励留存 ──
  r = await api('GET', `/api/stores/${storeId}/engagement`)
  rec('14. 激励留存(连续创作/里程碑/对比/进阶)', r.status === 200, `status=${r.status} streakDays=${r.json?.streak?.days ?? '-'} milestones=${r.json?.milestones?.length ?? '-'} growth=${r.json?.growthComparison?.available}`)

  // ── 15. 需求8 待发布清单(fixture 导出后含 1 项) + 标记发布闭环 ──
  r = await api('GET', `/api/stores/${storeId}/publish-queue`)
  const pqItems = r.json?.items ?? (Array.isArray(r.json) ? r.json : [])
  rec('15a. 待发布清单(导出后填充)', r.status === 200 && pqItems.length >= 1, `status=${r.status} items=${pqItems.length}`)
  const pqItemId = globalThis.__pqItemId || pqItems[0]?.id
  if (pqItemId) {
    r = await api('POST', `/api/publish-queue/${pqItemId}/mark-published`, { platform })
    rec('15b. 标记已发布(可反哺数据回填)', r.status === 200 || r.status === 201, `status=${r.status}`)
    // 复核：标记后该项 publishedPlatforms 应含该平台
    r = await api('GET', `/api/stores/${storeId}/publish-queue`)
    const after = (r.json?.items ?? (Array.isArray(r.json) ? r.json : [])).find((x) => x.id === pqItemId)
    const platforms = after?.publishedPlatforms ?? []
    const marked = Array.isArray(platforms) && platforms.some((p) => (typeof p === 'string' ? p === platform : p?.platform === platform))
    rec('15c. 复核已发布平台落库', marked, `platforms=${JSON.stringify(platforms)}`)
  } else {
    rec('15b. 标记已发布(可反哺数据回填)', false, '无 publishQueueItemId 可标记')
  }

  // ── 汇总 ──
  const pass = results.filter((x) => x.ok).length
  const fail = results.length - pass
  console.log('\n=== 汇总 ===')
  console.log(`PASS=${pass} FAIL=${fail} TOTAL=${results.length}`)
  if (fail > 0) {
    console.log('失败项：')
    for (const x of results.filter((y) => !y.ok)) console.log(' -', x.step, '::', x.detail)
  }
  console.log('TEST_STORE_ID=' + storeId)
  console.log('TEST_EMAIL=' + email)
  console.log('TEST_PASSWORD=' + password)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error('E2E 中断:', e.message); console.log('TEST_STORE_ID_PARTIAL'); process.exit(2) })
