// 提取核心文件「2026-06-09 11:30 前最近一次保存」的快照到 .history-1130/
import fs from 'fs'
import path from 'path'

const HISTORY = path.join(process.env.APPDATA, 'Kiro', 'User', 'History')
const PROJECT = 'video-redesign'
const TARGET = new Date('2026-06-09T11:30:00').getTime()
const OUT = path.join(process.cwd(), '.history-1130')

// 关注文件（rel 路径片段 → 输出文件名）
const WANT = [
  'src/lib/gemini.ts',
  'src/workers/parse-video.ts',
  'src/lib/reference-builder.ts',
  'src/lib/grouping-service.ts',
  'src/lib/ffmpeg.ts',
  'src/lib/script-merger.ts',
  'src/lib/shot-schema.ts',
  'src/lib/frame-calculator.ts',
  'src/app/api/shot-groups/%5Bid%5D/generate/route.ts',
  'src/workers/generate-video.ts',
  'src/workers/merge-video.ts',
]

function norm(s) { return s.replace(/\\/g, '/') }
fs.mkdirSync(OUT, { recursive: true })

const dirs = fs.readdirSync(HISTORY, { withFileTypes: true }).filter(d => d.isDirectory())
const summary = []

for (const d of dirs) {
  const ej = path.join(HISTORY, d.name, 'entries.json')
  if (!fs.existsSync(ej)) continue
  let data
  try { data = JSON.parse(fs.readFileSync(ej, 'utf8')) } catch { continue }
  const resource = norm(data.resource || '')
  if (!resource.includes(PROJECT)) continue
  const rel = resource.split(PROJECT + '/')[1] || ''
  const want = WANT.find(w => rel === w)
  if (!want) continue
  const entries = data.entries || []
  let before = null
  for (const e of entries) {
    if (e.timestamp <= TARGET && (!before || e.timestamp > before.timestamp)) before = e
  }
  if (!before) { summary.push({ rel, status: 'NO_1130_VERSION (11:30前无快照)' }); continue }
  const src = path.join(HISTORY, d.name, before.id)
  if (!fs.existsSync(src)) { summary.push({ rel, status: 'SNAPSHOT_MISSING' }); continue }
  // 输出文件名：把路径分隔符换成 __
  const outName = want.replace(/%5B/g, '[').replace(/%5D/g, ']').replace(/\//g, '__')
  fs.copyFileSync(src, path.join(OUT, outName))
  summary.push({ rel, status: 'OK ' + new Date(before.timestamp).toLocaleString('sv'), out: outName })
}

console.log('提取到:', OUT)
for (const s of summary) console.log(' ', s.status.padEnd(28), s.rel)
