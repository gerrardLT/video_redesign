/**
 * Worker 入口文件
 * 启动所有 BullMQ Worker 进程
 *
 * 运行方式: npx tsx src/workers/index.ts
 *
 * P0 修复：添加 SIGTERM/SIGINT 优雅退出处理
 * Docker stop 发送 SIGTERM 后默认 10 秒强杀，优雅退出让正在处理的任务完成当前步骤后安全关闭。
 */

import 'dotenv/config'
import { Worker } from 'bullmq'

console.log('[Workers] 正在启动所有 Worker...')
console.log(`[Workers] Redis: ${process.env.REDIS_URL || 'redis://localhost:6379'}`)

// 收集所有启动的 Worker 实例，用于优雅退出
const activeWorkers: Worker[] = []

/**
 * 注册 Worker 实例到全局列表（用于优雅退出时逐一 close）
 */
function registerWorker(workerModule: { default?: Worker } & Record<string, unknown>) {
  // Worker 通常作为 default export 或命名导出
  const worker = workerModule.default || Object.values(workerModule).find(v => v instanceof Worker)
  if (worker instanceof Worker) {
    activeWorkers.push(worker)
  }
}

/**
 * 优雅退出：等待所有正在处理的任务完成当前步骤后关闭 Worker
 * BullMQ Worker.close() 会：
 * 1. 停止获取新任务
 * 2. 等待当前正在处理的任务完成（或超时）
 * 3. 断开 Redis 连接
 */
async function gracefulShutdown(signal: string) {
  console.log(`\n[Workers] 收到 ${signal}，开始优雅退出...`)
  console.log(`[Workers] 等待 ${activeWorkers.length} 个 Worker 完成当前任务...`)

  const shutdownTimeout = setTimeout(() => {
    console.error('[Workers] 优雅退出超时（8s），强制退出')
    process.exit(1)
  }, 8000) // Docker 默认 10s SIGKILL，留 2s 余量

  try {
    await Promise.allSettled(
      activeWorkers.map(worker => worker.close())
    )
    clearTimeout(shutdownTimeout)
    console.log('[Workers] 全部 Worker 已安全关闭')
    process.exit(0)
  } catch (err) {
    clearTimeout(shutdownTimeout)
    console.error('[Workers] 优雅退出异常:', err)
    process.exit(1)
  }
}

// 注册信号处理器
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

// 捕获未处理异常，避免进程静默崩溃
process.on('uncaughtException', (err) => {
  console.error('[Workers] 未捕获异常:', err)
  // 不立即退出，让 BullMQ 有机会将任务标记为 stalled 供重派
  gracefulShutdown('uncaughtException')
})

process.on('unhandledRejection', (reason) => {
  console.error('[Workers] 未处理的 Promise 拒绝:', reason)
  // 不退出进程，BullMQ 内部已有 error handler
})

// 动态导入各 Worker（触发注册）
async function startWorkers() {
  try {
    const mod = await import('./parse-video')
    registerWorker(mod)
    console.log('[Workers] ✅ parse-video Worker 已启动')
  } catch (err) {
    console.error('[Workers] ❌ parse-video Worker 启动失败:', err)
  }

  try {
    const mod = await import('./generate-video')
    registerWorker(mod)
    console.log('[Workers] ✅ generate-video Worker 已启动')
  } catch (err) {
    console.error('[Workers] ❌ generate-video Worker 启动失败:', err)
  }

  try {
    const mod = await import('./generate-character')
    registerWorker(mod)
    console.log('[Workers] ✅ generate-character Worker 已启动')
  } catch (err) {
    console.error('[Workers] ❌ generate-character Worker 启动失败:', err)
  }

  try {
    const mod = await import('./merge-video')
    registerWorker(mod)
    console.log('[Workers] ✅ merge-video Worker 已启动')
  } catch (err) {
    console.error('[Workers] ❌ merge-video Worker 启动失败:', err)
  }

  try {
    const mod = await import('./asset-cleanup-worker')
    registerWorker(mod)
    console.log('[Workers] ✅ asset-cleanup Worker 已启动')
  } catch (err) {
    console.error('[Workers] ❌ asset-cleanup Worker 启动失败:', err)
  }

  try {
    const mod = await import('./order-expire-worker')
    registerWorker(mod)
    console.log('[Workers] ✅ order-expire Worker 已启动')
  } catch (err) {
    console.error('[Workers] ❌ order-expire Worker 启动失败:', err)
  }

  try {
    const mod = await import('./notification-worker')
    registerWorker(mod)
    console.log('[Workers] ✅ notification Worker 已启动')
  } catch (err) {
    console.error('[Workers] ❌ notification Worker 启动失败:', err)
  }

  try {
    const mod = await import('./face-check')
    registerWorker(mod)
    console.log('[Workers] ✅ face-check Worker 已启动')
  } catch (err) {
    console.error('[Workers] ❌ face-check Worker 启动失败:', err)
  }

  try {
    const mod = await import('./download-video')
    registerWorker(mod)
    console.log('[Workers] ✅ download-video Worker 已启动')
  } catch (err) {
    console.error('[Workers] ❌ download-video Worker 启动失败:', err)
  }

  try {
    const mod = await import('./parse-watchdog')
    registerWorker(mod)
    console.log('[Workers] ✅ parse-watchdog Worker 已启动')
  } catch (err) {
    console.error('[Workers] ❌ parse-watchdog Worker 启动失败:', err)
  }

  try {
    const mod = await import('./generate-watchdog')
    registerWorker(mod)
    console.log('[Workers] ✅ generate-watchdog Worker 已启动')
  } catch (err) {
    console.error('[Workers] ❌ generate-watchdog Worker 启动失败:', err)
  }

  try {
    const mod = await import('./upscale-video')
    registerWorker(mod)
    console.log('[Workers] ✅ upscale-video Worker 已启动')
  } catch (err) {
    console.error('[Workers] ❌ upscale-video Worker 启动失败:', err)
  }

  try {
    const mod = await import('./subscription-renewal-worker')
    registerWorker(mod)
    console.log('[Workers] ✅ subscription-renewal Worker 已启动')
  } catch (err) {
    console.error('[Workers] ❌ subscription-renewal Worker 启动失败:', err)
  }

  try {
    const mod = await import('./subscription-expire-worker')
    registerWorker(mod)
    console.log('[Workers] ✅ subscription-expire Worker 已启动')
  } catch (err) {
    console.error('[Workers] ❌ subscription-expire Worker 启动失败:', err)
  }

  try {
    const mod = await import('./concurrency-reconcile')
    registerWorker(mod)
    console.log('[Workers] ✅ concurrency-reconcile Worker 已启动')
  } catch (err) {
    console.error('[Workers] ❌ concurrency-reconcile Worker 启动失败:', err)
  }

  try {
    const mod = await import('./generate-content-plan')
    registerWorker(mod)
    console.log('[Workers] ✅ generate-content-plan Worker 已启动')
  } catch (err) {
    console.error('[Workers] ❌ generate-content-plan Worker 启动失败:', err)
  }

  try {
    const mod = await import('./render-local-video')
    registerWorker(mod)
    console.log('[Workers] ✅ render-local-video Worker 已启动')
  } catch (err) {
    console.error('[Workers] ❌ render-local-video Worker 启动失败:', err)
  }

  try {
    const mod = await import('./compliance-review')
    registerWorker(mod)
    console.log('[Workers] ✅ compliance-review Worker 已启动')
  } catch (err) {
    console.error('[Workers] ❌ compliance-review Worker 启动失败:', err)
  }

  try {
    const mod = await import('./sync-metrics')
    registerWorker(mod)
    console.log('[Workers] ✅ sync-metrics Worker 已启动')
  } catch (err) {
    console.error('[Workers] ❌ sync-metrics Worker 启动失败:', err)
  }

  try {
    const mod = await import('./weekly-merchant-report')
    registerWorker(mod)
    console.log('[Workers] ✅ weekly-merchant-report Worker 已启动')
  } catch (err) {
    console.error('[Workers] ❌ weekly-merchant-report Worker 启动失败:', err)
  }

  // 注册所有 Repeatable 定时调度任务（资产清理、过期提醒、订单过期、解析看门狗、订阅到期、并发对账）
  try {
    const { registerCommercializationSchedules } = await import('../lib/queue')
    await registerCommercializationSchedules()
    console.log('[Workers] ✅ 定时调度任务已注册')
  } catch (err) {
    console.error('[Workers] ❌ 定时调度任务注册失败:', err)
  }

  console.log('[Workers] 全部 Worker 已启动，等待任务...')
  console.log(`[Workers] 已注册 ${activeWorkers.length} 个 Worker 实例用于优雅退出`)
}

/**
 * P3 修复：启动时清理上次进程可能残留的临时文件
 * Worker 崩溃/kill -9 后 temp 目录可能遗留未清理的中间文件（下载、归一化、合并等）
 * 清理规则：仅删除超过 1 小时的文件（避免误删当前正在处理的文件）
 */
async function cleanupStaleTempFiles() {
  try {
    const path = await import('path')
    const fs = await import('fs/promises')
    const tempDir = path.join(process.cwd(), 'public', 'uploads', 'temp')

    const entries = await fs.readdir(tempDir, { withFileTypes: true }).catch(() => [])
    if (entries.length === 0) return

    const ONE_HOUR_AGO = Date.now() - 60 * 60 * 1000
    let cleaned = 0

    for (const entry of entries) {
      const fullPath = path.join(tempDir, entry.name)
      try {
        const stat = await fs.stat(fullPath)
        if (stat.mtimeMs < ONE_HOUR_AGO) {
          if (entry.isDirectory()) {
            await fs.rm(fullPath, { recursive: true, force: true })
          } else {
            await fs.unlink(fullPath)
          }
          cleaned++
        }
      } catch {
        // 单个文件清理失败不影响其他
      }
    }

    if (cleaned > 0) {
      console.log(`[Workers] 🧹 启动清理：已删除 ${cleaned} 个过期临时文件/目录`)
    }
  } catch {
    // temp 目录不存在或清理失败不影响启动
  }
}

// 先清理残留，再启动 Workers
cleanupStaleTempFiles().then(() => startWorkers())
