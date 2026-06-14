/**
 * 分镜解析结构 Zod Schema 与时间线修正工具
 * 用于校验 Gemini 返回的 JSON 数据结构，以及自动修复时间线问题
 */
import { z } from 'zod/v4'

// ========================
// Schema 定义
// ========================

/** 单个 Shot 的 Zod Schema */
export const ShotSchema = z.object({
  orderIndex: z.number().int().nonnegative(),
  startTime: z.number().nonnegative(),
  endTime: z.number().positive(),
  scene: z.string().min(1).max(500),
  shotType: z.string().min(1),
  cameraMove: z.string().min(1),
  dialogue: z.array(z.object({
    speaker: z.string(),
    text: z.string(),
  })),
  audioDesc: z.string().optional().default(''),
  characters: z.array(z.object({
    name: z.string(),
    appearance: z.string(),
  })),
  suggestedPrompt: z.string().min(1).max(1000),
  hasFace: z.boolean(),
  // 建议生成组编号（qwen 直接标注哪些相邻分镜属于同一生成单元）。
  // 可选：qwen 偶尔漏给时，解析阶段回退为「每镜头独立成组」（确定性默认策略，非伪造数据）。
  groupId: z.number().int().nonnegative().optional(),
}).refine(data => data.endTime > data.startTime, {
  message: 'endTime 必须大于 startTime',
})

/** 全局一致性设定 Schema（视频级统一设定，所有分镜共享） */
export const GlobalSettingsSchema = z.object({
  artStyle: z.string(),
  colorTone: z.string(),
  subtitleDeclaration: z.string(),
  characters: z.array(z.object({
    name: z.string(),
    appearance: z.string(),
    props: z.string().optional(),
  })),
}).optional()

/** 完整解析结果 Schema */
export const ParseResultSchema = z.object({
  globalSettings: GlobalSettingsSchema,
  shots: z.array(ShotSchema).min(1),
})

// ========================
// 类型导出
// ========================

export type ParsedShotInput = z.input<typeof ShotSchema>
export type ParsedShotOutput = z.output<typeof ShotSchema>

export interface TimelineShot {
  orderIndex: number
  startTime: number
  endTime: number
}

// ========================
// 时间线修正与验证
// ========================

/**
 * 时间线完整性修正
 * - 按 orderIndex 升序排列
 * - 从第二个 shot 开始，每个 startTime = 前一个 endTime
 * - 第一个 startTime 和最后一个 endTime 保持原值
 *
 * 纯函数：修正后保证无重叠、升序、连续
 */
export function repairTimeline<T extends TimelineShot>(shots: T[]): T[] {
  if (shots.length === 0) return []

  // 按 orderIndex 升序排列（浅拷贝，不修改原数组）
  const sorted = [...shots].sort((a, b) => a.orderIndex - b.orderIndex)

  // 深拷贝以避免修改原始对象
  const repaired: T[] = sorted.map(s => ({ ...s }))

  // 从第二个 shot 开始，链式衔接 startTime
  for (let i = 1; i < repaired.length; i++) {
    repaired[i].startTime = repaired[i - 1].endTime
    // 如果链式衔接后 endTime <= startTime，则向后推移
    if (repaired[i].endTime <= repaired[i].startTime) {
      repaired[i].endTime = repaired[i].startTime + (sorted[i].endTime - sorted[i].startTime)
    }
  }

  return repaired
}

/**
 * 验证时间线完整性
 * - 无重叠
 * - 按 orderIndex 升序
 * - 每个 endTime > startTime
 * - 所有时间 >= 0
 */
export function validateTimeline(shots: TimelineShot[]): {
  valid: boolean
  issues: string[]
} {
  const issues: string[] = []

  if (shots.length === 0) {
    return { valid: true, issues: [] }
  }

  // 按 orderIndex 排序后检查
  const sorted = [...shots].sort((a, b) => a.orderIndex - b.orderIndex)

  for (let i = 0; i < sorted.length; i++) {
    const shot = sorted[i]

    // 所有时间 >= 0
    if (shot.startTime < 0) {
      issues.push(`Shot ${shot.orderIndex}: startTime (${shot.startTime}) < 0`)
    }
    if (shot.endTime < 0) {
      issues.push(`Shot ${shot.orderIndex}: endTime (${shot.endTime}) < 0`)
    }

    // endTime > startTime
    if (shot.endTime <= shot.startTime) {
      issues.push(`Shot ${shot.orderIndex}: endTime (${shot.endTime}) <= startTime (${shot.startTime})`)
    }

    // 检查与前一个的关系（升序 + 无重叠）
    if (i > 0) {
      const prev = sorted[i - 1]
      if (shot.orderIndex <= prev.orderIndex) {
        issues.push(`Shot at position ${i}: orderIndex (${shot.orderIndex}) <= previous (${prev.orderIndex})`)
      }
      if (shot.startTime < prev.endTime) {
        issues.push(`Shot ${shot.orderIndex}: startTime (${shot.startTime}) overlaps with previous endTime (${prev.endTime})`)
      }
    }
  }

  return { valid: issues.length === 0, issues }
}

/**
 * 格式化 Zod 错误信息为可读字符串
 */
export function formatZodError(error: z.ZodError): string {
  return error.issues.map(issue => {
    const path = issue.path.join('.')
    return `${path}: ${issue.message}`
  }).join('; ')
}
