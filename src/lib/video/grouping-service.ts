/**
 * Grouping_Service（分镜分组服务）
 *
 * 纯函数实现：将解析得到的相邻 Shot 按规则聚合为若干分镜组（Shot_Group）。
 * 每组对应一次 Seedance API 调用。
 *
 * 分组规则：
 * - 每组总时长 ≤ 15s（Seedance 单次生成上限）
 * - 每组总时长 ≥ 4s（Seedance 最小时长约束，不足时向前合并或 clamp 到 4s）
 * - 每组最多包含 3 个 shot（防止 prompt 过长被 Seedance 忽略）
 * - 优先让每个 shot 独立成组，只有 <4s 的 shot 才向前合并
 */

/** 分组上限（秒），Seedance 单次生成上限 */
export const MAX_GROUP_DURATION = 15
/** 分组下限（秒），Seedance 最小时长约束 */
export const MIN_GROUP_DURATION = 4
/** 每组最大 shot 数量（防止 prompt 过长） */
const MAX_SHOTS_PER_GROUP = 3

/** 分组算法的输入分镜（仅需排序与时长相关字段） */
export interface GroupingInputShot {
  /** 分镜序号（连续、升序） */
  orderIndex: number
  /** 分镜在原视频中的起点（秒） */
  startTime: number
  /** 分镜在原视频中的终点（秒） */
  endTime: number
}

/** 分组算法的输出：一个分镜组的计算结果 */
export interface ShotGroupPlan {
  /** 组序号，从 0 起连续递增 */
  groupIndex: number
  /** 组内 Shot 的 orderIndex（连续、升序） */
  shotOrderIndexes: number[]
  /** 组内首个 Shot 的 startTime */
  startTime: number
  /** 组内末个 Shot 的 endTime */
  endTime: number
  /** 组内各 Shot 时长之和（Σ(endTime - startTime)） */
  rawDuration: number
  /** 提交 Seedance 的时长，整数秒，约束在 [4, 15] */
  genDuration: number
}

/** 将数值约束在 [min, max] 闭区间内 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * 将分镜列表按规则分组。
 *
 * 策略：
 * 1. 每个 shot 优先独立成组
 * 2. 时长 <4s 的 shot 向前合并（与前一组合并），前提是：
 *    - 合并后总时长不超过 15s
 *    - 合并后组内 shot 数不超过 3 个
 * 3. 如果无法向前合并（前一组已满），则独立成组（genDuration clamp 到 4s）
 *
 * @param shots 待分组的分镜列表（无需预排序，内部会按 orderIndex 升序处理）
 * @returns 分镜组计划数组，groupIndex 从 0 起连续递增
 */
export function groupShots(shots: GroupingInputShot[]): ShotGroupPlan[] {
  if (shots.length === 0) {
    return []
  }

  // 按 orderIndex 升序排序
  const sorted = [...shots].sort((a, b) => a.orderIndex - b.orderIndex)

  const plans: ShotGroupPlan[] = []

  for (const shot of sorted) {
    const shotDuration = shot.endTime - shot.startTime

    // 时长 <4s 的 shot 尝试向前合并
    if (shotDuration < MIN_GROUP_DURATION && plans.length > 0) {
      const lastPlan = plans[plans.length - 1]
      const canMerge =
        lastPlan.rawDuration + shotDuration <= MAX_GROUP_DURATION &&
        lastPlan.shotOrderIndexes.length < MAX_SHOTS_PER_GROUP

      if (canMerge) {
        lastPlan.shotOrderIndexes.push(shot.orderIndex)
        lastPlan.endTime = shot.endTime
        lastPlan.rawDuration += shotDuration
        lastPlan.genDuration = clamp(Math.ceil(lastPlan.rawDuration), MIN_GROUP_DURATION, MAX_GROUP_DURATION)
        continue
      }
    }

    // 独立成组
    plans.push({
      groupIndex: plans.length,
      shotOrderIndexes: [shot.orderIndex],
      startTime: shot.startTime,
      endTime: shot.endTime,
      rawDuration: shotDuration,
      genDuration: clamp(Math.ceil(shotDuration), MIN_GROUP_DURATION, MAX_GROUP_DURATION),
    })
  }

  return plans
}
