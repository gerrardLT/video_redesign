/**
 * 工作台（Workspace）Zustand 状态仓库
 *
 * 管理工作台页面所有本地状态：
 * - Prompt 文本
 * - 已上传参考素材列表
 * - 模型选择（默认 Seedance 2.0）
 * - 参数配置（比例/分辨率/时长）
 * - 生成状态与任务 ID
 * - 用户积分余额
 */

import { create } from 'zustand'
import type {
  WorkspaceAsset,
  WorkspaceModel,
  WorkspaceAspectRatio,
  WorkspaceResolution,
  WorkspaceGenerateStatus,
} from '@/types/workspace'
import { MAX_WORKSPACE_ASSETS, MODEL_DEFAULT_DURATION, MODEL_DURATION_OPTIONS } from '@/constants/workspace'
import { insertAssetReference } from '@/lib/workspace-validators'

/** 工作台状态接口 */
export interface WorkspaceState {
  /** Prompt 文本 */
  prompt: string
  /** 已上传参考素材列表 */
  assets: WorkspaceAsset[]
  /** 当前选中模型 */
  model: WorkspaceModel
  /** 画面比例 */
  aspectRatio: WorkspaceAspectRatio
  /** 生成时长（秒） */
  duration: number
  /** 分辨率（固定 720p） */
  resolution: WorkspaceResolution
  /** 生成状态 */
  generateStatus: WorkspaceGenerateStatus
  /** 当前生成任务 ID */
  currentJobId: string | null
  /** 当前生成项目 ID */
  currentProjectId: string | null
  /** 用户积分余额 */
  creditBalance: number

  // ===== Actions =====

  /** 设置 prompt 文本 */
  setPrompt: (text: string) => void
  /** 添加素材（上限 12 个，超出返回 false） */
  addAsset: (asset: WorkspaceAsset) => boolean
  /** 移除素材 */
  removeAsset: (id: string) => void
  /** 更新素材状态（上传完成后更新 ossUrl 等） */
  updateAsset: (id: string, patch: Partial<WorkspaceAsset>) => void
  /** 设置模型（联动重置时长为该模型默认值） */
  setModel: (model: WorkspaceModel) => void
  /** 设置画面比例 */
  setAspectRatio: (ratio: WorkspaceAspectRatio) => void
  /** 设置时长 */
  setDuration: (seconds: number) => void
  /** 设置分辨率 */
  setResolution: (resolution: WorkspaceResolution) => void
  /** 设置生成状态 */
  setGenerateStatus: (status: WorkspaceGenerateStatus) => void
  /** 设置当前任务 ID */
  setCurrentJobId: (jobId: string | null) => void
  /** 设置当前项目 ID */
  setCurrentProjectId: (projectId: string | null) => void
  /** 设置积分余额 */
  setCreditBalance: (balance: number) => void
  /** 在 prompt 指定光标位置插入素材引用 */
  insertAssetReference: (cursorPos: number, assetName: string) => void
  /** 重置为初始状态 */
  reset: () => void
}

/** 初始状态 */
const initialState = {
  prompt: '',
  assets: [] as WorkspaceAsset[],
  model: 'happyhorse' as WorkspaceModel,
  aspectRatio: '16:9' as WorkspaceAspectRatio,
  duration: MODEL_DEFAULT_DURATION.happyhorse,
  resolution: '720p' as WorkspaceResolution,
  generateStatus: 'idle' as WorkspaceGenerateStatus,
  currentJobId: null as string | null,
  currentProjectId: null as string | null,
  creditBalance: 0,
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  ...initialState,

  setPrompt: (text) => set({ prompt: text }),

  addAsset: (asset) => {
    const { assets } = get()
    if (assets.length >= MAX_WORKSPACE_ASSETS) {
      return false
    }
    set({ assets: [...assets, asset] })
    return true
  },

  removeAsset: (id) => {
    set((state) => ({
      assets: state.assets.filter((a) => a.id !== id),
    }))
  },

  updateAsset: (id, patch) => {
    set((state) => ({
      assets: state.assets.map((a) =>
        a.id === id ? { ...a, ...patch } : a
      ),
    }))
  },

  setModel: (model) => {
    const { duration } = get()
    const options = MODEL_DURATION_OPTIONS[model]
    // 保留当前时长（如果在新模型选项中存在），否则重置为默认
    const newDuration = options.includes(duration) ? duration : MODEL_DEFAULT_DURATION[model]
    set({
      model,
      duration: newDuration,
    })
  },

  setAspectRatio: (ratio) => set({ aspectRatio: ratio }),

  setDuration: (seconds) => set({ duration: seconds }),

  setResolution: (resolution) => set({ resolution }),

  setGenerateStatus: (status) => set({ generateStatus: status }),

  setCurrentJobId: (jobId) => set({ currentJobId: jobId }),

  setCurrentProjectId: (projectId) => set({ currentProjectId: projectId }),

  setCreditBalance: (balance) => set({ creditBalance: balance }),

  insertAssetReference: (cursorPos, assetName) => {
    const { prompt } = get()
    const newPrompt = insertAssetReference(prompt, cursorPos, assetName)
    set({ prompt: newPrompt })
  },

  reset: () => set(initialState),
}))
