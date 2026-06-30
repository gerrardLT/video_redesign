/**
 * 平台数据自动抓取服务（platform-metrics-crawler）—— 需求 7
 *
 * 职责（仅服务层，不含 Worker 与 API 路由）：
 *  1. requestAccountLink：关联平台账号前的风险告知 + 授权确认前置（需求 7.2）。
 *  2. saveCredential：保存平台会话凭证（cookie 服务端对称加密存储），
 *     未完成授权确认（authConfirmed=false）一律拒绝（需求 7.2/7.3/7.4）。
 *  3. crawlAccountMetrics：执行一次抓取（由 Worker 调用），把本人账号作品表现
 *     写入对应 ContentBrief 的 PublishMetric（source=API_SYNC）；失败时显式标记
 *     账号 NEEDS_RELINK 且不写入任何 metric，回退手动录入提示（需求 7.5/7.6/7.8）。
 *
 * 设计红线（遵循 AGENTS.md 与需求 0 全局约束）：
 *  - 真实接口、无 fallback、无静默降级、无伪造数据：抓取失败显式标记并返回失败原因，
 *    绝不用假数据掩盖；平台真实抓取由外部 fetcher 注入（见 PlatformWorksFetcher）。
 *  - 凭证加密密钥取自环境变量 PLATFORM_CRED_ENC_KEY，缺失时直接抛错（不静默回退），
 *    禁止明文存储凭证、禁止入 Git。
 *  - 自动抓取仅为增强，手动录入（metrics-ingestor.recordManualMetrics）永久保留为兜底；
 *    自动数据以 source=API_SYNC 写入，与手动 MANUAL 记录共存，不静默覆盖（需求 7.1/7.8）。
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.8
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'crypto'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import type { PublishPlatform } from '@/types/merchant'
import type { PlatformAccount } from '@/generated/prisma'

// ============================================================
// 常量与频率门控边界
// ============================================================

/** 系统级抓取最小间隔（小时）—— 低于此值会显著抬高反爬/风控风险（需求 7.5） */
export const MIN_CRAWL_INTERVAL_HOURS = 6
/** 抓取间隔上界（小时）—— 默认值（需求 7.5） */
export const MAX_CRAWL_INTERVAL_HOURS = 24
/** 默认抓取间隔（小时） */
export const DEFAULT_CRAWL_INTERVAL_HOURS = 24

/** 账号状态：可正常抓取 */
const STATUS_ACTIVE = 'ACTIVE'
/** 账号状态：凭证失效/平台改版/反爬，需商家重新关联（需求 7.6） */
const STATUS_NEEDS_RELINK = 'NEEDS_RELINK'

/** AES-256-GCM 加密参数 */
const ENC_ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // GCM 推荐 12 字节 IV
const AUTH_TAG_LENGTH = 16 // GCM 认证标签 16 字节
/** 加密串各段分隔符：iv:authTag:ciphertext（均为 base64） */
const ENC_SEGMENT_SEP = ':'

// ============================================================
// 错误类型
// ============================================================

/** 授权未确认错误（需求 7.2）—— saveCredential 在 authConfirmed=false 时抛出 */
export class CredentialAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CredentialAuthError'
  }
}

/** 抓取配置错误（如缺少真实 fetcher）—— 配置问题，非凭证失效，显式抛错不静默 */
export class CrawlConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CrawlConfigError'
  }
}

// ============================================================
// 凭证对称加密（AES-256-GCM）—— Property 25：decrypt(encrypt(x))===x 且密文≠明文
// ============================================================

/**
 * 读取并派生 32 字节加密密钥。
 * 密钥源自环境变量 PLATFORM_CRED_ENC_KEY，缺失直接抛错（遵循 AGENTS.md：环境变量缺失不静默回退）。
 * 通过 SHA-256 派生固定长度密钥，兼容任意长度的原始密钥串（hex/base64/任意明文）。
 * 惰性读取（在加解密时调用），避免模块加载期因未注入环境变量而误抛。
 */
function deriveEncryptionKey(): Buffer {
  const raw = process.env.PLATFORM_CRED_ENC_KEY
  if (!raw || raw.trim().length === 0) {
    throw new Error(
      'PLATFORM_CRED_ENC_KEY 未配置：平台凭证加密必须设置 PLATFORM_CRED_ENC_KEY 环境变量（禁止明文存储凭证、禁止使用默认回退密钥）'
    )
  }
  // SHA-256 派生 32 字节密钥，确定性映射，满足 AES-256 的密钥长度要求
  return createHash('sha256').update(raw, 'utf8').digest()
}

/**
 * 加密平台会话凭证（cookie）。
 * 返回 `iv:authTag:ciphertext`（均 base64）；因每次 IV 随机，密文必定不等于明文。
 */
export function encryptCredential(plaintext: string): string {
  const key = deriveEncryptionKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ENC_ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(ENC_SEGMENT_SEP)
}

/**
 * 解密平台会话凭证。入参为 encryptCredential 的输出格式。
 * 任一段缺失或认证标签校验失败均抛错（防止被篡改的密文被静默接受）。
 */
export function decryptCredential(payload: string): string {
  const key = deriveEncryptionKey()
  const segments = payload.split(ENC_SEGMENT_SEP)
  if (segments.length !== 3) {
    throw new Error('凭证密文格式非法：期望 iv:authTag:ciphertext 三段结构')
  }
  const [ivB64, authTagB64, ciphertextB64] = segments
  const iv = Buffer.from(ivB64, 'base64')
  const authTag = Buffer.from(authTagB64, 'base64')
  const ciphertext = Buffer.from(ciphertextB64, 'base64')
  const decipher = createDecipheriv(ENC_ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })
  decipher.setAuthTag(authTag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return plaintext.toString('utf8')
}

// ============================================================
// 频率门控（Property 26：允许 当且仅当 now - lastCrawledAt >= interval）
// ============================================================

/**
 * 将抓取间隔夹紧到系统允许区间 [MIN_CRAWL_INTERVAL_HOURS, MAX_CRAWL_INTERVAL_HOURS]。
 * 防止配置出界导致过于频繁（抬高风控风险）或过于稀疏。
 */
export function clampCrawlIntervalHours(hours: number): number {
  if (!Number.isFinite(hours)) return DEFAULT_CRAWL_INTERVAL_HOURS
  return Math.min(MAX_CRAWL_INTERVAL_HOURS, Math.max(MIN_CRAWL_INTERVAL_HOURS, Math.trunc(hours)))
}

/**
 * 判断当前是否允许抓取（纯函数，便于属性测试）。
 * 规则（需求 7.5 / Property 26）：
 *  - 从未抓取过（lastCrawledAt 为空）→ 允许；
 *  - 否则当且仅当 now - lastCrawledAt >= interval 才允许。
 * interval 取自 intervalH（夹紧到 [6,24] 小时）。
 */
export function isCrawlAllowed(input: {
  lastCrawledAt: Date | null
  intervalH: number
  now: Date
}): boolean {
  const { lastCrawledAt, intervalH, now } = input
  if (!lastCrawledAt) return true
  const intervalMs = clampCrawlIntervalHours(intervalH) * 60 * 60 * 1000
  return now.getTime() - lastCrawledAt.getTime() >= intervalMs
}

// ============================================================
// 平台作品抓取 fetcher 抽象（真实实现由 Worker 注入，不在服务层伪造数据）
// ============================================================

/** 单条平台作品的真实表现数据 */
export interface PlatformWorkMetrics {
  /** 关联到本系统的内容任务 ID（由发布回填关系解析得到） */
  contentBriefId: string
  /** 平台维度 */
  platform: PublishPlatform
  views: number
  likes: number
  comments: number
  shares: number
  saves: number
  profileVisits?: number
  linkClicks?: number
  messages?: number
  orders?: number
  redemptions?: number
  revenueCents?: number
}

/**
 * 平台作品抓取器接口。
 * 真实实现需用解密后的 cookie 调用对应平台的真实接口抓取本人账号作品表现，
 * 失败（凭证失效/平台改版/反爬限制）时抛错 —— 由 crawlAccountMetrics 捕获并标记 NEEDS_RELINK。
 * 禁止返回伪造数据。
 */
export interface PlatformWorksFetcher {
  fetchWorks(input: { platform: PublishPlatform; cookie: string; storeId: string }): Promise<PlatformWorkMetrics[]>
}

/** 模块级已注册的真实 fetcher（由 Worker 启动时通过 registerPlatformWorksFetcher 注入） */
let registeredFetcher: PlatformWorksFetcher | null = null

/**
 * 注册真实平台作品抓取器（在 Worker 进程启动时调用）。
 * 服务层不内置任何默认/伪造实现，未注册时 crawlAccountMetrics 显式抛 CrawlConfigError。
 */
export function registerPlatformWorksFetcher(fetcher: PlatformWorksFetcher): void {
  registeredFetcher = fetcher
}

// ============================================================
// requestAccountLink —— 风险告知 + 授权确认前置（需求 7.2）
// ============================================================

/** requestAccountLink 返回结构：风险告知文案 + 授权握手 token */
export interface AccountLinkRequest {
  /** 平台用户协议（ToS）提示文案 */
  tosNotice: string
  /** 需明确告知商家的风险点（反爬/风控/账号安全等） */
  risks: string[]
  /** 授权握手 token：前端在授权确认后回传，串联告知与保存动作 */
  authToken: string
}

/**
 * 关联平台账号前的风险告知与授权确认前置（需求 7.2）。
 * 仅返回风险告知与一次性 authToken；未完成授权确认不得进入凭证存储流程
 *（凭证存储入口由 saveCredential 的 authConfirmed 强校验把关）。
 */
export async function requestAccountLink(input: {
  storeId: string
  platform: PublishPlatform
}): Promise<AccountLinkRequest> {
  const { storeId, platform } = input

  // 校验门店存在，避免对不存在的门店发起关联流程（storeId 即 Store.id）
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true },
  })
  if (!store) {
    throw new Error(`门店不存在：storeId=${storeId}`)
  }

  const tosNotice =
    '关联平台账号前请知悉：本功能仅用于抓取你本人账号下作品的公开表现数据，' +
    '需遵守对应平台的用户协议（ToS）。请确认你已阅读并同意在自有账号范围内授权数据抓取。'

  const risks = [
    '平台可能将自动化访问视为违规，存在账号被风控限流甚至封禁的风险。',
    '平台改版或反爬策略调整可能随时导致抓取中断，届时需要你重新关联。',
    '会话凭证（cookie）等同于登录态，仅服务端加密存储、仅用于抓取你本人账号数据。',
    '自动抓取仅为增强，手动录入数据始终保留为兜底，不会因关联失败而丢失。',
  ]

  return {
    tosNotice,
    risks,
    authToken: randomUUID(),
    // 备注：platform 用于前端展示「正在关联<平台>」上下文，服务层不在此持久化握手态。
  }
}

// ============================================================
// saveCredential —— 凭证服务端加密存储 + 授权确认强校验（需求 7.2/7.3/7.4）
// ============================================================

/**
 * 保存平台会话凭证（需求 7.3/7.4）。
 *
 * 安全要点：
 *  - authConfirmed 必须为 true，否则抛 CredentialAuthError，不进入凭证存储（Property 24）。
 *  - 入参 cookie 为明文会话凭证；本函数在服务端用 AES-256-GCM 加密后再落库，
 *    数据库仅存密文（encryptedCookie），禁止明文存储（Property 25）。
 *  - 按 (storeId, platform) 唯一约束 upsert：重新关联时刷新凭证并将状态复位为 ACTIVE。
 *  - crawlIntervalH 夹紧到 [6,24] 小时（需求 7.5）。
 *  - 纯写库，不消耗积分。
 */
export async function saveCredential(input: {
  storeId: string
  platform: PublishPlatform
  /** 明文会话凭证，由服务端加密后存储（禁止前端预加密、禁止明文落库） */
  cookie: string
  /** 必须已完成授权确认；false 直接拒绝（需求 7.2 / Property 24） */
  authConfirmed: boolean
  /** 抓取间隔（小时），缺省 24，落库前夹紧到 [6,24] */
  crawlIntervalH?: number
}): Promise<PlatformAccount> {
  const { storeId, platform, cookie, authConfirmed, crawlIntervalH } = input

  // ─── 授权确认前置（Property 24）：未确认不得进入凭证存储 ───
  if (authConfirmed !== true) {
    throw new CredentialAuthError('未完成授权确认，拒绝保存平台凭证（需先完成风险告知与授权确认）')
  }

  if (!cookie || cookie.trim().length === 0) {
    throw new Error('平台会话凭证为空，无法保存')
  }

  // ─── 服务端加密（Property 25）：仅存密文 ───
  const encryptedCookie = encryptCredential(cookie)
  const intervalH = clampCrawlIntervalHours(crawlIntervalH ?? DEFAULT_CRAWL_INTERVAL_HOURS)

  // upsert：首次关联创建；重新关联刷新凭证并复位状态为 ACTIVE
  const account = await prisma.platformAccount.upsert({
    where: { storeId_platform: { storeId, platform } },
    create: {
      storeId,
      platform,
      encryptedCookie,
      authConfirmed: true,
      status: STATUS_ACTIVE,
      crawlIntervalH: intervalH,
    },
    update: {
      encryptedCookie,
      authConfirmed: true,
      status: STATUS_ACTIVE,
      crawlIntervalH: intervalH,
    },
  })

  logger.info('[platform-metrics-crawler] 平台凭证已加密存储', {
    storeId,
    platform,
    platformAccountId: account.id,
  })

  return account
}

// ============================================================
// crawlAccountMetrics —— 执行一次抓取（由 Worker 调用）
// ============================================================

/** crawlAccountMetrics 返回结构 */
export interface CrawlResult {
  /** 本次写入/更新了 metric 的 brief id 集合 */
  updatedBriefIds: string[]
  /** 是否因频率未到被跳过（非错误，等待下次调度） */
  skipped?: boolean
  /** 失败信息（凭证失效/反爬/改版）；存在时未写入任何 metric */
  failed?: { reason: string; needsRelink: boolean }
}

/**
 * 执行一次抓取（需求 7.5/7.6/7.8）：
 *  1. 频率门控：未到间隔则跳过（needsCrawl=false，非错误）。
 *  2. 解密凭证 → 调用真实 fetcher 抓取本人账号作品表现。
 *  3. 成功：以 source=API_SYNC 写入对应 brief 的 PublishMetric（与 MANUAL 记录共存，不覆盖），
 *     更新 lastCrawledAt 与状态 ACTIVE。
 *  4. 失败（凭证失效/平台改版/反爬）：标记账号 NEEDS_RELINK，不写入任何 metric，
 *     返回 failed.needsRelink=true，回退手动录入提示（Property 27）。
 *
 * 真实 fetcher 未注册时抛 CrawlConfigError（配置问题，非凭证失效，不标记 NEEDS_RELINK）。
 */
export async function crawlAccountMetrics(input: {
  platformAccountId: string
  /** 可选注入 fetcher（测试/特定调度用）；缺省使用已注册的真实 fetcher */
  fetcher?: PlatformWorksFetcher
  /** 可选当前时间（便于频率门控测试）；缺省 new Date() */
  now?: Date
}): Promise<CrawlResult> {
  const { platformAccountId } = input
  const now = input.now ?? new Date()
  const fetcher = input.fetcher ?? registeredFetcher

  const account = await prisma.platformAccount.findUnique({
    where: { id: platformAccountId },
  })
  if (!account) {
    throw new Error(`平台账号不存在：platformAccountId=${platformAccountId}`)
  }

  // ─── 频率门控（Property 26）：未到间隔则跳过，不抓取 ───
  if (!isCrawlAllowed({ lastCrawledAt: account.lastCrawledAt, intervalH: account.crawlIntervalH, now })) {
    return { updatedBriefIds: [], skipped: true }
  }

  // ─── 真实 fetcher 校验：未注册属配置错误，显式抛错（不伪造、不标记 NEEDS_RELINK）───
  if (!fetcher) {
    throw new CrawlConfigError(
      '未注册平台作品抓取器（PlatformWorksFetcher）：crawlAccountMetrics 需由 Worker 注入真实抓取实现'
    )
  }

  // ─── 抓取：失败即标记 NEEDS_RELINK 且不写任何 metric（Property 27）───
  let works: PlatformWorkMetrics[]
  try {
    const cookie = decryptCredential(account.encryptedCookie)
    works = await fetcher.fetchWorks({ platform: account.platform, cookie, storeId: account.storeId })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    await prisma.platformAccount.update({
      where: { id: account.id },
      data: { status: STATUS_NEEDS_RELINK },
    })
    logger.warn('[platform-metrics-crawler] 抓取失败，已标记需重新关联', {
      platformAccountId: account.id,
      storeId: account.storeId,
      platform: account.platform,
      reason,
    })
    return { updatedBriefIds: [], failed: { reason, needsRelink: true } }
  }

  // ─── 写入 PublishMetric（source=API_SYNC），与 MANUAL 共存不覆盖（Property 28）───
  // 仅写入归属本门店的 brief（安全校验，防止 fetcher 返回越权 briefId）。
  const updatedBriefIds: string[] = []
  for (const work of works) {
    const brief = await prisma.contentBrief.findUnique({
      where: { id: work.contentBriefId },
      select: { id: true, storeId: true },
    })
    if (!brief || brief.storeId !== account.storeId) {
      logger.warn('[platform-metrics-crawler] 跳过越权或不存在的 brief', {
        contentBriefId: work.contentBriefId,
        storeId: account.storeId,
      })
      continue
    }

    // create 新记录（不 update 既有 MANUAL/API_SYNC 记录）：自动与手动数据共存，由商家决定采用
    await prisma.publishMetric.create({
      data: {
        contentBriefId: work.contentBriefId,
        platform: work.platform,
        views: work.views,
        likes: work.likes,
        comments: work.comments,
        shares: work.shares,
        saves: work.saves,
        profileVisits: work.profileVisits ?? 0,
        linkClicks: work.linkClicks ?? 0,
        messages: work.messages ?? 0,
        orders: work.orders ?? 0,
        redemptions: work.redemptions ?? 0,
        revenueCents: work.revenueCents ?? 0,
        source: 'API_SYNC',
        capturedAt: now,
      },
    })
    updatedBriefIds.push(work.contentBriefId)
  }

  // ─── 成功：更新抓取时间与状态 ───
  await prisma.platformAccount.update({
    where: { id: account.id },
    data: { lastCrawledAt: now, status: STATUS_ACTIVE },
  })

  logger.info('[platform-metrics-crawler] 抓取完成', {
    platformAccountId: account.id,
    storeId: account.storeId,
    platform: account.platform,
    updatedBriefCount: updatedBriefIds.length,
  })

  return { updatedBriefIds }
}
