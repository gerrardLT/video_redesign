/**
 * 内容任务状态管理 — Zustand Store
 *
 * 管理当前内容任务的本地状态：
 * - todayBrief: 今日内容任务
 * - currentBrief: 当前查看的内容任务
 * - shotTasks: 当前任务的拍摄列表
 * - variants: 当前任务的视频版本列表
 * - renderProgress: 渲染进度（0-100 或 null 表示未在渲染）
 *
 * 使用 Zustand 5 的 create 函数，不使用 devtools。
 *
 * Requirements: 15.1, 15.4
 */

import { create } from 'zustand'
import type { ContentGoal, ContentBriefStatus, ShotTaskType, VideoVariantType } from '@/types/merchant'

/** 内容任务数据（对应 Prisma ContentBrief） */
export interface ContentBrief {
  id: string
  storeId: string
  contentPlanId?: string | null
  playbookId?: string | null
  title: string
  goal: ContentGoal
  scheduledDate: string
  status: ContentBriefStatus
  hook?: string | null
  mainMessage?: string | null
  offerId?: string | null
  suggestedCaption?: string | null
  suggestedTitle?: string | null
  suggestedCoverTitle?: string | null
  suggestedCta?: string | null
  platformCopies?: Record<string, unknown> | null
  tags?: string[] | null
  aiReasoning?: string | null
  createdAt: string
  updatedAt: string
}

/** 拍摄任务数据（对应 Prisma ShotTask） */
export interface ShotTask {
  id: string
  contentBriefId: string
  order: number
  type: ShotTaskType
  title: string
  instruction: string
  examplePrompt?: string | null
  durationSec: number
  required: boolean
  framingGuide?: Record<string, unknown> | null
  qualityRules?: Record<string, unknown> | null
  status: string
  createdAt: string
  updatedAt: string
}

/** 视频版本数据（对应 Prisma VideoVariant） */
export interface VideoVariant {
  id: string
  contentBriefId: string
  type: VideoVariantType
  title: string
  description?: string | null
  ossKey?: string | null
  coverOssKey?: string | null
  durationSec?: number | null
  width?: number | null
  height?: number | null
  subtitles?: Array<{ text: string; startSec: number; endSec: number }> | null
  renderParams?: Record<string, unknown> | null
  generationLog?: Record<string, unknown> | null
  score?: number | null
  isSelected: boolean
  createdAt: string
  updatedAt: string
}

/** 内容任务状态接口 */
export interface ContentBriefState {
  /** 今日内容任务 */
  todayBrief: ContentBrief | null
  /** 当前查看的内容任务 */
  currentBrief: ContentBrief | null
  /** 当前任务的拍摄列表 */
  shotTasks: ShotTask[]
  /** 当前任务的视频版本列表 */
  variants: VideoVariant[]
  /** 渲染进度百分比（0-100），null 表示未在渲染 */
  renderProgress: number | null
  /** 设置今日任务 */
  setTodayBrief: (b: ContentBrief | null) => void
  /** 设置当前任务 */
  setCurrentBrief: (b: ContentBrief | null) => void
  /** 设置拍摄任务列表 */
  setShotTasks: (tasks: ShotTask[]) => void
  /** 设置视频版本列表 */
  setVariants: (v: VideoVariant[]) => void
  /** 设置渲染进度 */
  setRenderProgress: (p: number | null) => void
  /** 重置状态 */
  reset: () => void
}

const initialState = {
  todayBrief: null as ContentBrief | null,
  currentBrief: null as ContentBrief | null,
  shotTasks: [] as ShotTask[],
  variants: [] as VideoVariant[],
  renderProgress: null as number | null,
}

export const useContentBriefStore = create<ContentBriefState>((set) => ({
  ...initialState,

  setTodayBrief: (b: ContentBrief | null) => set({ todayBrief: b }),

  setCurrentBrief: (b: ContentBrief | null) => set({ currentBrief: b }),

  setShotTasks: (tasks: ShotTask[]) => set({ shotTasks: tasks }),

  setVariants: (v: VideoVariant[]) => set({ variants: v }),

  setRenderProgress: (p: number | null) => set({ renderProgress: p }),

  reset: () => set(initialState),
}))
