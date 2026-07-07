/**
 * 抖音平台作品数据抓取器
 *
 * 实现 PlatformWorksFetcher 接口，对接抖音开放平台创作者服务 API，
 * 抓取商家账号的视频作品表现数据。
 *
 * API 文档：https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/develop/server/video-management/
 *
 * 凭证说明：
 * - cookie 参数为解密后的会话凭证（access_token），由商家通过平台账号关联流程提供
 * - 支持两种凭证格式：
 *   1. 纯 access_token 字符串
 *   2. JSON 格式 { "access_token": "...", "open_id": "..." }
 *
 * 视频归属匹配策略：
 * - 查询该门店在 DOUYIN 平台已发布（PUBLISHED）的 PublishJob
 * - 按标题相似度将平台视频匹配到 ContentBrief
 * - 无法匹配的视频跳过（不伪造关联）
 *
 * Requirements: 7.5, 7.6
 */

import { prisma } from '@/lib/shared/db'
import { logger } from '@/lib/shared/logger'
import type { PlatformWorksFetcher, PlatformWorkMetrics } from '@/lib/merchant/platform-metrics-crawler'
import type { PublishPlatform } from '@/types/merchant'

// ========================
// 抖音开放平台 API 常量
// ========================

const DOUYIN_API_BASE = 'https://open.douyin.com'

/** 视频列表接口 */
const DOUYIN_VIDEO_LIST_URL = `${DOUYIN_API_BASE}/api/douyin/v1/video/video_list/`

/** 单次请求最大视频数 */
const DOUYIN_PAGE_SIZE = 20

/** 请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 15_000

// ========================
// 抖音 API 响应类型
// ========================

interface DouyinVideoListResponse {
  data: {
    list?: Array<{
      item_id: string
      title: string
      create_time: number
      /** 视频封面 URL */
      cover?: string
      /** 播放数 */
      statistics?: {
        play_count?: number
        digg_count?: number
        comment_count?: number
        share_count?: number
        download_count?: number
        collect_count?: number
        /** 主页访问数 */
        profile_visit_count?: number
        /** 链接点击数 */
        link_click_count?: number
      }
    }>
    cursor?: number
    has_more?: boolean
  }
  extra?: {
    error_code?: number
    description?: string
  }
}

// ========================
// 凭证解析
// ========================

interface DouyinCredential {
  access_token: string
  open_id?: string
}

/**
 * 解析 cookie 凭证为抖音 API 所需格式。
 * 支持纯字符串（直接作为 access_token）或 JSON 对象。
 */
function parseCookie(cookie: string): DouyinCredential {
  const trimmed = cookie.trim()
  // 尝试 JSON 解析
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      const accessToken = parsed.access_token || parsed.accessToken
      if (typeof accessToken !== 'string' || !accessToken) {
        throw new Error('JSON 凭证缺少 access_token 字段')
      }
      return {
        access_token: accessToken,
        open_id: typeof parsed.open_id === 'string' ? parsed.open_id : undefined,
      }
    } catch {
      // JSON 解析失败，降级为纯字符串
    }
  }
  // 纯字符串作为 access_token
  return { access_token: trimmed }
}

// ========================
// 视频归属匹配
// ========================

/**
 * 查询门店在抖音平台已发布的 PublishJob，构建标题 → contentBriefId 映射。
 * 用于将平台抓取到的视频匹配回本系统的 ContentBrief。
 */
async function buildPublishedBriefMap(storeId: string): Promise<Map<string, string>> {
  const publishedJobs = await prisma.publishJob.findMany({
    where: {
      platform: 'DOUYIN',
      status: 'PUBLISHED',
      contentBrief: { storeId },
    },
    select: {
      title: true,
      contentBriefId: true,
    },
    orderBy: { publishedAt: 'desc' },
    take: 100,
  })

  const map = new Map<string, string>()
  for (const job of publishedJobs) {
    if (job.title) {
      // 用标题前 20 个字符作为匹配 key（去空格、统一小写）
      const key = normalizeTitle(job.title)
      if (!map.has(key)) {
        map.set(key, job.contentBriefId)
      }
    }
  }
  return map
}

/** 标题归一化：去空格、取前 20 字符、统一小写 */
function normalizeTitle(title: string): string {
  return title.replace(/\s+/g, '').slice(0, 20).toLowerCase()
}

/**
 * 尝试将抖音视频标题匹配到已知 ContentBrief。
 * 返回匹配的 contentBriefId 或 null。
 */
function matchVideoToBrief(
  videoTitle: string,
  briefMap: Map<string, string>,
): string | null {
  const normalized = normalizeTitle(videoTitle)
  // 精确匹配
  if (briefMap.has(normalized)) {
    return briefMap.get(normalized)!
  }
  // 前缀匹配：视频标题包含 brief 标题（或反过来）
  for (const [key, briefId] of briefMap) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return briefId
    }
  }
  return null
}

// ========================
// HTTP 请求封装
// ========================

async function fetchDouyinVideoList(
  credential: DouyinCredential,
  cursor = 0,
): Promise<DouyinVideoListResponse> {
  const url = new URL(DOUYIN_VIDEO_LIST_URL)
  url.searchParams.set('cursor', String(cursor))
  url.searchParams.set('count', String(DOUYIN_PAGE_SIZE))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'access-token': credential.access_token,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(
        `抖音 API 请求失败：HTTP ${response.status} ${response.statusText}`
      )
    }

    const result = (await response.json()) as DouyinVideoListResponse

    // 检查业务错误码
    const errorCode = result.extra?.error_code
    if (errorCode && errorCode !== 0) {
      const desc = result.extra?.description || '未知错误'
      // error_code 2190001 = access_token 失效
      if (errorCode === 2190001 || errorCode === 2190002) {
        throw new Error(`抖音凭证已失效（error_code=${errorCode}），请重新关联账号`)
      }
      throw new Error(`抖音 API 业务错误：${desc}（error_code=${errorCode}）`)
    }

    return result
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`抖音 API 请求超时（${REQUEST_TIMEOUT_MS}ms）`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

// ========================
// PlatformWorksFetcher 实现
// ========================

/**
 * 抖音平台作品抓取器
 *
 * 抓取商家抖音账号的视频列表及表现数据，并通过标题匹配
 * 将视频关联回本系统的 ContentBrief。
 */
export class DouyinWorksFetcher implements PlatformWorksFetcher {
  async fetchWorks(input: {
    platform: PublishPlatform
    cookie: string
    storeId: string
  }): Promise<PlatformWorkMetrics[]> {
    const { cookie, storeId } = input

    // 1. 解析凭证
    const credential = parseCookie(cookie)

    // 2. 构建门店已发布 brief 映射（用于视频归属匹配）
    const briefMap = await buildPublishedBriefMap(storeId)

    if (briefMap.size === 0) {
      logger.info('[douyin-fetcher] 门店无已发布的抖音作品，跳过抓取', { storeId })
      return []
    }

    // 3. 调用抖音 API 获取视频列表（最多翻 3 页，覆盖近期作品）
    const allVideos: DouyinVideoListResponse['data']['list'] = []
    let cursor = 0
    const maxPages = 3

    for (let page = 0; page < maxPages; page++) {
      const result = await fetchDouyinVideoList(credential, cursor)
      const videos = result.data?.list ?? []
      allVideos.push(...videos)

      if (!result.data?.has_more) break
      cursor = result.data?.cursor ?? 0
    }

    logger.info('[douyin-fetcher] 获取到抖音视频列表', {
      storeId,
      totalVideos: allVideos.length,
    })

    // 4. 匹配视频 → ContentBrief，构建 PlatformWorkMetrics
    const metrics: PlatformWorkMetrics[] = []
    let matched = 0
    let unmatched = 0

    for (const video of allVideos) {
      if (!video.title || !video.item_id) continue

      const contentBriefId = matchVideoToBrief(video.title, briefMap)
      if (!contentBriefId) {
        unmatched++
        continue
      }

      matched++
      const stats = video.statistics ?? {}
      metrics.push({
        contentBriefId,
        platform: 'DOUYIN' as PublishPlatform,
        views: stats.play_count ?? 0,
        likes: stats.digg_count ?? 0,
        comments: stats.comment_count ?? 0,
        shares: stats.share_count ?? 0,
        saves: stats.collect_count ?? 0,
        profileVisits: stats.profile_visit_count,
        linkClicks: stats.link_click_count,
      })
    }

    logger.info('[douyin-fetcher] 视频归属匹配完成', {
      storeId,
      matched,
      unmatched,
    })

    return metrics
  }
}
