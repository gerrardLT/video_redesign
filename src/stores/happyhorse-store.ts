/**
 * HappyHorse 面板状态仓库
 *
 * 管理 HappyHorse 生成面板的所有本地状态，包括：
 * - Prompt 文本和光标位置
 * - 参考图列表及上传状态
 * - 生成任务状态（进行中/完成）
 * - 最新生成结果
 *
 * Tab 切换时通过 display:none 保留 DOM，状态自动保持。
 */

import { create } from 'zustand'
import { insertPlaceholder, removePlaceholderAndRenumber } from '@/lib/placeholder-utils'

/** 参考图数据结构 */
export interface ReferenceImage {
  /** 唯一标识 */
  id: string
  /** 上传前的文件对象 */
  file?: File
  /** OSS 公网 URL（上传后） */
  url: string
  /** 缩略图 URL */
  thumbnailUrl?: string
  /** 上传状态 */
  status: 'uploading' | 'success' | 'error'
}

/** 生成结果数据结构 */
export interface GenerationResult {
  /** 生成模式 */
  mode: 'direct' | 'segmented'
  /** 总分段数 */
  totalSegments: number
  /** 总积分消耗 */
  totalCost: number
  /** 生成任务列表 */
  jobs: Array<{ id: string; segmentIndex: number; status: string; videoUrl?: string }>
}

/** HappyHorse 面板状态接口 */
interface HappyHorseState {
  /** 编辑指令文本 */
  prompt: string
  /** 光标位置 */
  cursorPosition: number
  /** 参考图列表 */
  referenceImages: ReferenceImage[]
  /** 是否正在生成 */
  isGenerating: boolean
  /** 当前生成任务 ID */
  currentTaskId: string | null
  /** 最新生成结果 */
  latestResult: GenerationResult | null

  // Actions
  setPrompt: (text: string) => void
  setCursorPosition: (pos: number) => void
  addReferenceImage: (img: ReferenceImage) => void
  removeReferenceImage: (id: string) => void
  updateReferenceImageStatus: (id: string, status: ReferenceImage['status'], url?: string, thumbnailUrl?: string) => void
  insertPlaceholderAtCursor: (imageIndex: number) => void
  removePlaceholderAndRenumber: (removedIndex: number) => void
  setGenerating: (status: boolean, taskId?: string) => void
  setLatestResult: (result: GenerationResult | null) => void
  reset: () => void
}

/** 初始状态 */
const initialState = {
  prompt: '',
  cursorPosition: 0,
  referenceImages: [] as ReferenceImage[],
  isGenerating: false,
  currentTaskId: null as string | null,
  latestResult: null as GenerationResult | null,
}

export const useHappyHorseStore = create<HappyHorseState>((set, get) => ({
  ...initialState,

  setPrompt: (text: string) => set({ prompt: text }),

  setCursorPosition: (pos: number) => set({ cursorPosition: pos }),

  addReferenceImage: (img: ReferenceImage) => {
    set((state) => ({
      referenceImages: [...state.referenceImages, img],
    }))
  },

  removeReferenceImage: (id: string) => {
    const { referenceImages } = get()
    const index = referenceImages.findIndex((img) => img.id === id)
    if (index === -1) return

    // 移除图片
    set((state) => ({
      referenceImages: state.referenceImages.filter((img) => img.id !== id),
    }))

    // 移除对应占位符并重编号（序号从 1 开始）
    const removedIndex = index + 1
    const { prompt } = get()
    const newPrompt = removePlaceholderAndRenumber(prompt, removedIndex)
    set({ prompt: newPrompt })
  },

  updateReferenceImageStatus: (id, status, url?, thumbnailUrl?) => {
    set((state) => ({
      referenceImages: state.referenceImages.map((img) =>
        img.id === id
          ? { ...img, status, ...(url && { url }), ...(thumbnailUrl && { thumbnailUrl }) }
          : img
      ),
    }))
  },

  insertPlaceholderAtCursor: (imageIndex: number) => {
    const { prompt, cursorPosition } = get()
    const newPrompt = insertPlaceholder(prompt, cursorPosition, imageIndex)
    const placeholder = `[Image ${imageIndex}]`
    set({
      prompt: newPrompt,
      cursorPosition: cursorPosition + placeholder.length,
    })
  },

  removePlaceholderAndRenumber: (removedIndex: number) => {
    const { prompt } = get()
    const newPrompt = removePlaceholderAndRenumber(prompt, removedIndex)
    set({ prompt: newPrompt })
  },

  setGenerating: (status: boolean, taskId?: string) => {
    set({
      isGenerating: status,
      currentTaskId: taskId ?? null,
    })
  },

  setLatestResult: (result: GenerationResult | null) => set({ latestResult: result }),

  reset: () => set(initialState),
}))
