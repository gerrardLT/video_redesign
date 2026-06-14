/**
 * useProjectSteps Hook
 * 基于项目数据计算各步骤的完成状态，供 Stepper 组件使用
 */

import { useMemo, useCallback } from 'react'

// ========================
// 类型定义
// ========================

/** 步骤状态 */
export type StepStatus = 'completed' | 'active' | 'upcoming'

/** 单个步骤信息 */
export interface StepInfo {
  label: string
  anchorId: string
  status: StepStatus
}

/** Hook 返回值 */
export interface UseProjectStepsReturn {
  steps: StepInfo[]
  currentStepIndex: number
  canNavigateTo: (stepIndex: number) => boolean
}

/** Shot 数据（仅需 genStatus 字段） */
interface ShotData {
  genStatus: string
}

/** Character 数据（仅需 enabled 字段） */
interface CharacterData {
  enabled: boolean
}

/** Asset 数据（仅需 status 字段） */
interface AssetData {
  status: string
}

/** StyleConfig 数据 */
interface StyleConfigData {
  templateId?: string | null
  customDescription?: string | null
}

/** 项目详情数据（Hook 参数） */
export interface ProjectDetailData {
  videoUrl?: string | null
  status?: string | null
  shots?: ShotData[]
  characters?: CharacterData[]
  assets?: AssetData[]
  styleConfig?: StyleConfigData | null
}

// ========================
// 步骤定义
// ========================

interface StepDefinition {
  label: string
  anchorId: string
  isCompleted: (project: ProjectDetailData) => boolean
}

const STEP_DEFINITIONS: StepDefinition[] = [
  {
    label: '上传视频',
    anchorId: 'video-section',
    isCompleted: (project) => !!project.videoUrl,
  },
  {
    label: 'AI 解析',
    anchorId: 'shots-section',
    isCompleted: (project) => Array.isArray(project.shots) && project.shots.length > 0,
  },
  {
    label: '确认形象',
    anchorId: 'characters-section',
    isCompleted: (project) =>
      Array.isArray(project.characters) && project.characters.some((c) => c.enabled),
  },
  {
    label: '参考素材',
    anchorId: 'assets-section',
    isCompleted: (project) =>
      Array.isArray(project.assets) && project.assets.some((a) => a.status === 'UPLOADED'),
  },
  {
    label: '设置风格',
    anchorId: 'style-section',
    isCompleted: (project) =>
      !!project.styleConfig &&
      (!!project.styleConfig.templateId || !!project.styleConfig.customDescription),
  },
  {
    label: '生成视频',
    anchorId: 'generate-section',
    isCompleted: (project) =>
      Array.isArray(project.shots) && project.shots.some((s) => s.genStatus === 'SUCCEEDED'),
  },
  {
    label: '合并导出',
    anchorId: 'export-section',
    isCompleted: (project) => project.status === 'EXPORTED',
  },
]

// ========================
// 核心计算逻辑（纯函数，方便测试）
// ========================

/**
 * 计算各步骤完成状态和当前活跃步骤索引
 */
export function computeStepStatuses(project: ProjectDetailData): {
  steps: StepInfo[]
  currentStepIndex: number
} {
  const completedFlags = STEP_DEFINITIONS.map((def) => def.isCompleted(project))

  // currentStepIndex = 第一个未完成步骤的索引
  // 如果所有步骤都完成，currentStepIndex = 最后一步
  let currentStepIndex = completedFlags.findIndex((completed) => !completed)
  if (currentStepIndex === -1) {
    currentStepIndex = STEP_DEFINITIONS.length - 1
  }

  const steps: StepInfo[] = STEP_DEFINITIONS.map((def, index) => {
    let status: StepStatus
    if (completedFlags[index]) {
      status = 'completed'
    } else if (index === currentStepIndex) {
      status = 'active'
    } else {
      status = 'upcoming'
    }

    return {
      label: def.label,
      anchorId: def.anchorId,
      status,
    }
  })

  return { steps, currentStepIndex }
}

// ========================
// Hook 实现
// ========================

/**
 * 基于项目数据计算各步骤的完成状态
 * @param project 项目详情数据（由调用方传入）
 */
export function useProjectSteps(project: ProjectDetailData): UseProjectStepsReturn {
  const { steps, currentStepIndex } = useMemo(() => computeStepStatuses(project), [project])

  const canNavigateTo = useCallback(
    (stepIndex: number): boolean => {
      return stepIndex <= currentStepIndex
    },
    [currentStepIndex]
  )

  return { steps, currentStepIndex, canNavigateTo }
}
