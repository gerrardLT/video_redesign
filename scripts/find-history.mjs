// 扫描 Kiro 本地历史，定位本项目核心文件在「昨天 11:30」附近的快照
import fs from 'fs'
import path from 'path'

const HISTORY = path.join(process.env.APPDATA, 'Kiro', 'User', 'History')
const PROJECT = 'video-redesign'
// 目标时间：2026-06-09 11:30 本地时间
const TARGET = new Date('2026-06-09T11:30:00').getTime()
// 关注的核心文件（解析/生成链路）
const FILES = [
  'src/lib/gemini.ts',
  'src/workers/parse-video.ts',
  'src/lib/reference-builder.ts',
  'src/lib/grouping-service.ts',
  'src/lib/ffmpeg.ts',
  'src/lib/script-merger.ts',
  'src/lib/shot-schema.ts',
  'src/lib/frame-calculator.ts',
  'src/app/api/shot-groups',
  'src/workers/generate-video.ts',
  'src/workers/merge-video.ts',
  'src/app/api/projects',
]

function norm(s) { return s.replace(/\\/g, '/') }

const dirs = fs.readdirSync(HISTORY, { withFileTypes: true }).filter(d => d.isDirectory())
const results = []

for (const d of dirs) {
  const ej = path.join(HISTORY, d.name, 'entries.json')
  if (!fs.existsSync(ej)) continue
  let data
  try { data = JSON.parse(fs.readFileSync(ej, 'utf8')) } catch { continue }
  const resource = norm(data.resource || '')
  if (!resource.includes(PROJECT)) continue
  // 只看关注文件
  const rel = resource.split(PROJECT + '/')[1] || resource
  if (!FILES.some(f => rel.includes(f))) continue
  const entries = data.entries || []
  if (entries.length === 0) continue
  // 找时间戳 <= TARGET 中最接近的，以及之后第一个
  let before = null, after = null
  for (const e of entries) {
    const t = e.timestamp
    if (t <= TARGET) { if (!before || t > before.timestamp) before = e }
    else { if (!after || t < after.timestamp) after = e }
  }
  results.push({ rel, dir: d.name, before, after, total: entries.length })
}

results.sort((a, b) => a.rel.localeCompare(b.rel))
const fmt = (t) => t ? new Date(t).toLocaleString('sv') : '—'
console.log('目标时间: 2026-06-09 11:30:00')
console.log('文件'.padEnd(48), '| 11:30前最近版本     | 之后首个版本       | 历史目录/快照id')
for (const r of results) {
  console.log(
    r.rel.padEnd(48),
    '|', fmt(r.before?.timestamp).padEnd(19),
    '|', fmt(r.after?.timestamp).padEnd(19),
    '|', r.dir + '/' + (r.before?.id || r.after?.id || '?')
  )
}
