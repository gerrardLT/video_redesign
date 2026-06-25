'use client'

/**
 * 商家数据 SWR Hooks
 *
 * 提供商家侧所有数据获取的 SWR hooks，统一错误处理和缓存策略。
 * 使用全局 fetcher 模式，所有请求通过标准 fetch API 发起。
 *
 * 导出：
 * - useTodayBrief(storeId) — 今日内容任务
 * - useContentPlan(storeId) — 当前内容计划
 * - useContentBrief(briefId) — 单条内容任务详情
 * - useShotTasks(briefId) — 拍摄任务列表
 * - useVideoVariants(briefId) — 视频版本列表
 * - useSubscription() — 订阅与额度信息
 *
 * Requirements: 15.1
 */

import useSWR, { type SWRConfiguration } from 'swr'
import type { ContentBrief, ShotTask, VideoVariant } from '@/stores/content-brief-store'

// ========================
// 全局 Fetcher
// ========================

/**
 * 统一 fetcher：发起 GET 请求，非 2xx 抛错
 */
async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    const error = new Error('请求失败') as Error & { status: number; info: unknown }
    error.status = res.status
    try {
      error.info = await res.json()
    } catch {
      error.info = null
    }
    throw error
  }
  return res.json()
}

// ========================
// 类型定义
// ========================

/** 内容计划响应 */
export interface ContentPlanResponse {
  id: string
  storeId: string
  title: string
  startDate: string
  endDate: string
  status: string
  briefs: ContentBrief[]
  createdAt: string
  updatedAt: string
}

/** 订阅额度信息响应 */
export interface SubscriptionResponse {
  tier: string
  videoGenerationsUsed: number
  videoGenerationsLimit: number
  storesUsed: number
  storesLimit: number
  contentPlansUsed: number
  contentPlansLimit: number
  resetDate?: string | null
}

// ========================
// 默认 SWR 配置
// ========================

const defaultConfig: SWRConfiguration = {
  revalidateOnFocus: false,
  dedupingInterval: 5000,
  errorRetryCount: 3,
}

// ========================
// Hooks
// ========================

/**
 * 获取今日内容任务
 *
 * @param storeId - 门店 ID，为 null 时不发起请求
 */
export function useTodayBrief(storeId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<ContentBrief | null>(
    storeId ? `/api/stores/${storeId}/today` : null,
    fetcher,
    {
      ...defaultConfig,
      refreshInterval: 0,
    }
  )

  return {
    todayBrief: data ?? null,
    error,
    isLoading,
    mutate,
  }
}

/**
 * 获取当前内容计划
 *
 * @param storeId - 门店 ID，为 null 时不发起请求
 */
export function useContentPlan(storeId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<ContentPlanResponse>(
    storeId ? `/api/stores/${storeId}/content-plan/current` : null,
    fetcher,
    {
      ...defaultConfig,
      refreshInterval: 0,
    }
  )

  return {
    contentPlan: data ?? null,
    error,
    isLoading,
    mutate,
  }
}

/**
 * 获取单条内容任务详情
 *
 * @param briefId - 内容任务 ID，为 null 时不发起请求
 */
export function useContentBrief(briefId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<ContentBrief>(
    briefId ? `/api/content-briefs/${briefId}` : null,
    fetcher,
    defaultConfig
  )

  return {
    brief: data ?? null,
    error,
    isLoading,
    mutate,
  }
}

/**
 * 获取拍摄任务列表
 *
 * @param briefId - 内容任务 ID，为 null 时不发起请求
 */
export function useShotTasks(briefId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<ShotTask[]>(
    briefId ? `/api/content-briefs/${briefId}/shot-tasks` : null,
    fetcher,
    defaultConfig
  )

  return {
    shotTasks: data ?? [],
    error,
    isLoading,
    mutate,
  }
}

/**
 * 获取视频版本列表
 *
 * @param briefId - 内容任务 ID，为 null 时不发起请求
 */
export function useVideoVariants(briefId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<VideoVariant[]>(
    briefId ? `/api/content-briefs/${briefId}/variants` : null,
    fetcher,
    defaultConfig
  )

  return {
    variants: data ?? [],
    error,
    isLoading,
    mutate,
  }
}

/**
 * 获取订阅与额度信息
 */
export function useSubscription() {
  const { data, error, isLoading, mutate } = useSWR<SubscriptionResponse>(
    '/api/merchant/subscription',
    fetcher,
    {
      ...defaultConfig,
      refreshInterval: 60_000,
    }
  )

  return {
    subscription: data ?? null,
    error,
    isLoading,
    mutate,
  }
}
