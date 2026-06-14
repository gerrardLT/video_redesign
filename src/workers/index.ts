/**
 * Worker 入口文件
 * 启动所有 BullMQ Worker 进程
 *
 * 运行方式: npx tsx src/workers/index.ts
 */

import 'dotenv/config'

console.log('[Workers] 正在启动所有 Worker...')
console.log(`[Workers] Redis: ${process.env.REDIS_URL || 'redis://localhost:6379'}`)

// 动态导入各 Worker（触发注册）
async function startWorkers() {
  try {
    await import('./parse-video')
    console.log('[Workers] ✅ parse-video Worker 已启动')
  } catch (err) {
    console.error('[Workers] ❌ parse-video Worker 启动失败:', err)
  }

  try {
    await import('./generate-video')
    console.log('[Workers] ✅ generate-video Worker 已启动')
  } catch (err) {
    console.error('[Workers] ❌ generate-video Worker 启动失败:', err)
  }

  try {
    await import('./generate-character')
    console.log('[Workers] ✅ generate-character Worker 已启动')
  } catch (err) {
    console.error('[Workers] ❌ generate-character Worker 启动失败:', err)
  }

  try {
    await import('./merge-video')
    console.log('[Workers] ✅ merge-video Worker 已启动')
  } catch (err) {
    console.error('[Workers] ❌ merge-video Worker 启动失败:', err)
  }

  try {
    await import('./asset-cleanup-worker')
    console.log('[Workers] ✅ asset-cleanup Worker 已启动')
  } catch (err) {
    console.error('[Workers] ❌ asset-cleanup Worker 启动失败:', err)
  }

  try {
    await import('./order-expire-worker')
    console.log('[Workers] ✅ order-expire Worker 已启动')
  } catch (err) {
    console.error('[Workers] ❌ order-expire Worker 启动失败:', err)
  }

  try {
    await import('./notification-worker')
    console.log('[Workers] ✅ notification Worker 已启动')
  } catch (err) {
    console.error('[Workers] ❌ notification Worker 启动失败:', err)
  }

  try {
    await import('./face-check')
    console.log('[Workers] ✅ face-check Worker 已启动')
  } catch (err) {
    console.error('[Workers] ❌ face-check Worker 启动失败:', err)
  }

  try {
    await import('./download-video')
    console.log('[Workers] ✅ download-video Worker 已启动')
  } catch (err) {
    console.error('[Workers] ❌ download-video Worker 启动失败:', err)
  }

  try {
    await import('./parse-watchdog')
    console.log('[Workers] ✅ parse-watchdog Worker 已启动')
  } catch (err) {
    console.error('[Workers] ❌ parse-watchdog Worker 启动失败:', err)
  }

  try {
    await import('./generate-watchdog')
    console.log('[Workers] ✅ generate-watchdog Worker 已启动')
  } catch (err) {
    console.error('[Workers] ❌ generate-watchdog Worker 启动失败:', err)
  }

  // 注册所有 Repeatable 定时调度任务（资产清理、过期提醒、订单过期、解析看门狗）
  try {
    const { registerCommercializationSchedules } = await import('../lib/queue')
    await registerCommercializationSchedules()
    console.log('[Workers] ✅ 定时调度任务已注册')
  } catch (err) {
    console.error('[Workers] ❌ 定时调度任务注册失败:', err)
  }

  console.log('[Workers] 全部 Worker 已启动，等待任务...')
}

startWorkers()
