import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: commercialization-features
 * Property 20: 步骤导航可达性
 * Property 21: 步骤完成状态与活跃步骤计算
 *
 * **Validates: Requirements 16.3, 17.2, 17.3**
 */

// ========================
// 纯函数复制（来自 src/hooks/use-project-steps.ts）
// ========================

type StepStatus = 'completed' | 'active' | 'upcoming'

interface StepInfo {
  label: string
  anchorId: string
  status: StepStatus
}

interface ShotData {
  genStatus: string
}

interface CharacterData {
  enabled: boolean
}

interface AssetData {
  status: string
}

interface StyleConfigData {
  templateId?: string | null
  customDescription?: string | null
}

interface ProjectDetailData {
  videoUrl?: string | null
  status?: string | null
  shots?: ShotData[]
  characters?: CharacterData[]
  assets?: AssetData[]
  styleConfig?: StyleConfigData | null
}

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

/**
 * 计算各步骤完成状态和当前活跃步骤索引（与 Hook 中 computeStepStatuses 一致）
 */
function computeStepStatuses(project: ProjectDetailData): {
  steps: StepInfo[]
  currentStepIndex: number
} {
  const completedFlags = STEP_DEFINITIONS.map((def) => def.isCompleted(project))

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

/**
 * 步骤导航可达性判断
 * canNavigateTo 仅在 targetIndex <= currentStepIndex 时返回 true
 */
function canNavigateTo(currentStepIndex: number, targetIndex: number): boolean {
  return targetIndex <= currentStepIndex
}

// ========================
// 生成器
// ========================

/** 生成随机的 ProjectDetailData */
const projectDataArb: fc.Arbitrary<ProjectDetailData> = fc.record({
  videoUrl: fc.option(fc.webUrl(), { nil: null }),
  status: fc.option(fc.constantFrom('DRAFT', 'PARSING', 'GENERATING', 'EXPORTED', 'DOWNLOADING'), { nil: null }),
  shots: fc.option(
    fc.array(
      fc.record({ genStatus: fc.constantFrom('PENDING', 'GENERATING', 'SUCCEEDED', 'FAILED') }),
      { minLength: 0, maxLength: 5 }
    ),
    { nil: undefined }
  ),
  characters: fc.option(
    fc.array(fc.record({ enabled: fc.boolean() }), { minLength: 0, maxLength: 3 }),
    { nil: undefined }
  ),
  assets: fc.option(
    fc.array(
      fc.record({ status: fc.constantFrom('PENDING', 'UPLOADED', 'APPROVED', 'REJECTED', 'CHECKING') }),
      { minLength: 0, maxLength: 5 }
    ),
    { nil: undefined }
  ),
  styleConfig: fc.option(
    fc.record({
      templateId: fc.option(fc.uuid(), { nil: null }),
      customDescription: fc.option(
        fc.string({ minLength: 1, maxLength: 100 }),
        { nil: null }
      ),
    }),
    { nil: null }
  ),
})

// ========================
// Property 20: 步骤导航可达性
// ========================

describe('步骤导航可达性 Property (Property 20)', () => {
  it('canNavigateTo 对 targetIndex <= currentStepIndex 返回 true', () => {
    fc.assert(
      fc.property(
        projectDataArb,
        fc.integer({ min: 0, max: 6 }),
        (project, targetIndex) => {
          const { currentStepIndex } = computeStepStatuses(project)

          const result = canNavigateTo(currentStepIndex, targetIndex)

          if (targetIndex <= currentStepIndex) {
            expect(result).toBe(true)
          } else {
            expect(result).toBe(false)
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('currentStepIndex 之前的步骤始终可导航', () => {
    fc.assert(
      fc.property(
        projectDataArb,
        (project) => {
          const { currentStepIndex } = computeStepStatuses(project)

          for (let i = 0; i < currentStepIndex; i++) {
            expect(canNavigateTo(currentStepIndex, i)).toBe(true)
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('当前活跃步骤可导航', () => {
    fc.assert(
      fc.property(
        projectDataArb,
        (project) => {
          const { currentStepIndex } = computeStepStatuses(project)

          expect(canNavigateTo(currentStepIndex, currentStepIndex)).toBe(true)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('currentStepIndex 之后的步骤不可导航', () => {
    fc.assert(
      fc.property(
        projectDataArb,
        (project) => {
          const { currentStepIndex } = computeStepStatuses(project)

          for (let i = currentStepIndex + 1; i < 7; i++) {
            expect(canNavigateTo(currentStepIndex, i)).toBe(false)
          }
        }
      ),
      { numRuns: 200 }
    )
  })
})

// ========================
// Property 21: 步骤完成状态与活跃步骤计算
// ========================

describe('步骤完成状态与活跃步骤计算 Property (Property 21)', () => {
  it('currentStepIndex 等于第一个未完成步骤的索引', () => {
    fc.assert(
      fc.property(
        projectDataArb,
        (project) => {
          const { steps, currentStepIndex } = computeStepStatuses(project)

          // 所有 currentStepIndex 之前的步骤应已完成
          for (let i = 0; i < currentStepIndex; i++) {
            expect(steps[i].status).toBe('completed')
          }

          // 如果不是所有步骤都完成，当前步骤应为 active
          const allCompleted = steps.every((s) => s.status === 'completed')
          if (!allCompleted) {
            expect(steps[currentStepIndex].status).toBe('active')
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('恰好有一个 active 步骤（除非全部完成）', () => {
    fc.assert(
      fc.property(
        projectDataArb,
        (project) => {
          const { steps } = computeStepStatuses(project)

          const activeSteps = steps.filter((s) => s.status === 'active')
          const allCompleted = steps.every((s) => s.status === 'completed')

          if (allCompleted) {
            expect(activeSteps.length).toBe(0)
          } else {
            expect(activeSteps.length).toBe(1)
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('步骤总数始终为 7', () => {
    fc.assert(
      fc.property(
        projectDataArb,
        (project) => {
          const { steps } = computeStepStatuses(project)

          expect(steps.length).toBe(7)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('步骤 labels 与定义一致', () => {
    fc.assert(
      fc.property(
        projectDataArb,
        (project) => {
          const { steps } = computeStepStatuses(project)

          const expectedLabels = [
            '上传视频',
            'AI 解析',
            '确认形象',
            '参考素材',
            '设置风格',
            '生成视频',
            '合并导出',
          ]

          for (let i = 0; i < steps.length; i++) {
            expect(steps[i].label).toBe(expectedLabels[i])
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  it('currentStepIndex 在 [0, 6] 范围内', () => {
    fc.assert(
      fc.property(
        projectDataArb,
        (project) => {
          const { currentStepIndex } = computeStepStatuses(project)

          expect(currentStepIndex).toBeGreaterThanOrEqual(0)
          expect(currentStepIndex).toBeLessThanOrEqual(6)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('没有 videoUrl 时第一步为 active', () => {
    fc.assert(
      fc.property(
        projectDataArb.map((p) => ({ ...p, videoUrl: null })),
        (project) => {
          const { currentStepIndex, steps } = computeStepStatuses(project)

          expect(currentStepIndex).toBe(0)
          expect(steps[0].status).toBe('active')
        }
      ),
      { numRuns: 100 }
    )
  })

  it('全部完成时 currentStepIndex 为最后一步', () => {
    const fullyCompletedProject: ProjectDetailData = {
      videoUrl: 'https://example.com/video.mp4',
      status: 'EXPORTED',
      shots: [{ genStatus: 'SUCCEEDED' }],
      characters: [{ enabled: true }],
      assets: [{ status: 'UPLOADED' }],
      styleConfig: { templateId: 'tmpl-1', customDescription: 'test' },
    }

    const { currentStepIndex, steps } = computeStepStatuses(fullyCompletedProject)

    expect(currentStepIndex).toBe(6)
    expect(steps.every((s) => s.status === 'completed')).toBe(true)
  })
})
