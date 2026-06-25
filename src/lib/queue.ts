import { Queue, type ConnectionOptions, type QueueOptions } from 'bullmq'

/**
 * 队列延迟加载模块
 *
 * 每个队列仅在首次被调用时才创建实例（含 Redis 连接），
 * 避免 Next.js dev server 在模块加载时就实例化全部 10 个队列和 Redis 连接。
 * 对外暴露的 API 与之前完全一致（直接调用 .add() 等方法）。
 */

// 延迟获取 Redis 连接（仅在真正需要队列时才加载 ioredis）
let _connection: ConnectionOptions | undefined

function getConnection(): ConnectionOptions {
  if (!_connection) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Redis = require('ioredis').default || require('ioredis')
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: null, // Required for BullMQ
    })
    _connection = redis as unknown as ConnectionOptions
  }
  return _connection
}

// 创建延迟代理：模块加载时不实例化 Queue，首次访问属性/方法时才真正创建
function lazyQueue(name: string, defaultJobOptions?: QueueOptions['defaultJobOptions']): Queue {
  let instance: Queue | undefined
  return new Proxy({} as Queue, {
    get(_target, prop) {
      if (!instance) {
        instance = new Queue(name, {
          connection: getConnection(),
          defaultJobOptions,
        })
      }
      const value = (instance as unknown as Record<string | symbol, unknown>)[prop]
      if (typeof value === 'function') {
        return value.bind(instance)
      }
      return value
    },
  })
}

// ========================
// 视频处理相关队列
// ========================

export const videoParseQueue = lazyQueue('video-parse', {
  attempts: 2,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: 100,
  removeOnFail: 200,
})

export const videoGenerateQueue = lazyQueue('video-generate', {
  attempts: 3,
  backoff: { type: 'exponential', delay: 10000 },
  removeOnComplete: 100,
  removeOnFail: 200,
})

export const imageGenerateQueue = lazyQueue('image-generate', {
  attempts: 2,
  backoff: { type: 'exponential', delay: 3000 },
  removeOnComplete: 100,
  removeOnFail: 200,
})

export const videoMergeQueue = lazyQueue('video-merge', {
  attempts: 2,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: 50,
  removeOnFail: 100,
})

// ========================
// 视频超分队列
// ========================

export const videoUpscaleQueue = lazyQueue('video-upscale', {
  attempts: 1, // 不由 BullMQ 自动重试，Worker 内部实现精细重试逻辑
  removeOnComplete: 50,
  removeOnFail: 100,
})

// ========================
// 商业化功能队列
// ========================

export const assetCleanupQueue = lazyQueue('asset-cleanup', {
  attempts: 3,
  backoff: { type: 'exponential', delay: 10000 },
  removeOnComplete: 50,
  removeOnFail: 100,
})

export const orderExpireQueue = lazyQueue('order-expire', {
  attempts: 2,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: 50,
  removeOnFail: 100,
})

export const notificationQueue = lazyQueue('notification', {
  attempts: 2,
  backoff: { type: 'exponential', delay: 3000 },
  removeOnComplete: 100,
  removeOnFail: 200,
})

// ========================
// 产品竞争力功能队列
// ========================

export const videoDownloadQueue = lazyQueue('video-download', {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: 50,
  removeOnFail: 100,
})

export const faceCheckQueue = lazyQueue('face-check', {
  attempts: 2,
  backoff: { type: 'fixed', delay: 3000 },
  removeOnComplete: 200,
  removeOnFail: 500,
})

// ========================
// 解析看门狗队列
// ========================

export const parseWatchdogQueue = lazyQueue('parse-watchdog', {
  attempts: 2,
  backoff: { type: 'fixed', delay: 5000 },
  removeOnComplete: 50,
  removeOnFail: 100,
})

// 生成看门狗队列：定时扫描崩溃卡死的生成项目，退款解卡
export const generateWatchdogQueue = lazyQueue('generate-watchdog', {
  attempts: 2,
  backoff: { type: 'fixed', delay: 5000 },
  removeOnComplete: 50,
  removeOnFail: 100,
})

// ========================
// 并发控制相关队列
// ========================

/** 并发对账队列：定时扫描所有活跃用户，修复 Redis 并发计数器与数据库之间的偏差 */
export const concurrencyReconcileQueue = lazyQueue('concurrency-reconcile', {
  attempts: 2,
  backoff: { type: 'fixed', delay: 5000 },
  removeOnComplete: 50,
  removeOnFail: 100,
})

// ========================
// 订阅会员相关队列
// ========================

/** 订阅续费队列：处理到期前自动续费扣款与重试 */
export const subscriptionRenewalQueue = lazyQueue('subscription-renewal', {
  attempts: 2,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: 50,
  removeOnFail: 100,
})

/** 订阅到期队列：定时扫描并过期超期订阅记录 */
export const subscriptionExpireQueue = lazyQueue('subscription-expire', {
  attempts: 2,
  backoff: { type: 'fixed', delay: 5000 },
  removeOnComplete: 50,
  removeOnFail: 100,
})

// ========================
// 本地生活营销平台队列
// ========================

/** 生成门店画像：基于问诊信息生成内容定位和策略 */
export const generateStoreProfileQueue = lazyQueue('generate-store-profile', {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: 50,
  removeOnFail: 100,
})

/** 生成 7 天内容计划：根据门店画像和剧本库生成每日内容任务 */
export const generateContentPlanQueue = lazyQueue('generate-content-plan', {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: 50,
  removeOnFail: 100,
})

/** 渲染本地视频：将商家素材组合成 3 版本视频（促销/氛围/口播） */
export const renderLocalVideoQueue = lazyQueue('render-local-video', {
  attempts: 2,
  backoff: { type: 'exponential', delay: 10000 },
  removeOnComplete: 50,
  removeOnFail: 100,
})

/** 合规检查：扫描视频文案是否存在违禁词、虚假宣传等 */
export const complianceReviewQueue = lazyQueue('compliance-review', {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: 100,
  removeOnFail: 200,
})

/** 数据同步（第一阶段占位，后续实现平台 API 自动拉取） */
export const syncMetricsQueue = lazyQueue('sync-metrics', {
  attempts: 3,
  backoff: { type: 'exponential', delay: 10000 },
  removeOnComplete: 50,
  removeOnFail: 100,
})

/** 商家周报（第一阶段占位，后续实现自动周报） */
export const weeklyMerchantReportQueue = lazyQueue('weekly-merchant-report', {
  attempts: 2,
  backoff: { type: 'exponential', delay: 30000 },
  removeOnComplete: 20,
  removeOnFail: 50,
})

// ========================
// 定时任务调度注册
// ========================

/**
 * 注册所有商业化功能的定时调度任务（Repeatable Jobs）
 * 应在应用启动时调用一次
 */
export async function registerCommercializationSchedules() {
  // 资产清理：每天凌晨 3:00 执行
  await assetCleanupQueue.add(
    'daily-cleanup',
    {},
    { repeat: { pattern: '0 3 * * *' } }
  )

  // 过期提醒通知：每天上午 10:00 扫描 3 天内到期资产
  await notificationQueue.add(
    'expiry-reminder',
    {},
    { repeat: { pattern: '0 10 * * *' } }
  )

  // 订单过期：每 5 分钟扫描超时未支付订单
  await orderExpireQueue.add(
    'expire-orders',
    {},
    { repeat: { pattern: '*/5 * * * *' } }
  )

  // 解析看门狗：每 10 分钟扫描卡死在 PARSING 状态超时的项目
  await parseWatchdogQueue.add(
    'scan-stuck-parsing',
    {},
    { repeat: { pattern: '*/10 * * * *' } }
  )

  // 生成看门狗：每 10 分钟扫描崩溃卡死在 GENERATING 的项目，退还冻结积分并解卡
  await generateWatchdogQueue.add(
    'scan-stuck-generating',
    {},
    { repeat: { pattern: '*/10 * * * *' } }
  )

  // 订阅到期检测：每小时全量扫描过期订阅记录
  await subscriptionExpireQueue.add(
    'scan-expired-subscriptions',
    {},
    { repeat: { pattern: '0 * * * *' } }
  )

  // 并发对账：每 5 分钟扫描所有活跃用户，修复 Redis 并发计数器偏差
  await concurrencyReconcileQueue.add(
    'reconcile-counters',
    {},
    { repeat: { pattern: '*/5 * * * *' } }
  )
}
