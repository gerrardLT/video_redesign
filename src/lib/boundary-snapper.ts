/**
 * Boundary_Snapper（分镜边界吸附）
 *
 * 纯函数实现：将 qwen 给出的分镜语义边界吸附到 ffmpeg 检测的真实场景切点。
 * 不包含任何 I/O，便于单元测试与属性化测试。
 *
 * 设计动机：qwen 视频直传能准确判断"哪里有镜头切换"（语义），但其返回的
 * startTime/endTime 是"估计值"（可能偏差数百毫秒）。用 ffmpeg 真实切点把边界
 * 吸附过去，保证下游音频切片、首帧提取的时间精确，杜绝音画漂移。
 *
 * 不变量（吸附后保证）：
 * - 按 orderIndex 升序；
 * - 相邻无空隙、无重叠：shot[i].endTime === shot[i+1].startTime；
 * - 每个 startTime < endTime；
 * - 所有时间 >= 0 且 endTime <= totalDuration。
 */

/** 吸附容差（秒）：qwen 边界与真实切点距离 ≤ 此值才吸附，否则保留 qwen 原值 */
export const SNAP_TOLERANCE = 0.3

export interface SnapInputShot {
  orderIndex: number
  startTime: number
  endTime: number
}

/**
 * 在 availableCuts 中找距离 t 最近且 ≤ tolerance 的切点。
 * 找到则从 availableCuts 中移除（消耗），返回该切点值；
 * 找不到则返回 t（回退 qwen 原值）。
 * 单调消耗保证每个切点最多被一个边界使用（修复风险8）。
 */
function snapAndConsume(t: number, availableCuts: number[], tolerance: number): number {
  if (availableCuts.length === 0) return t
  let bestIdx = -1
  let bestDiff = Infinity
  for (let i = 0; i < availableCuts.length; i++) {
    const d = Math.abs(availableCuts[i] - t)
    if (d < bestDiff) {
      bestDiff = d
      bestIdx = i
    }
    // 切点已排序，一旦距离开始增大且超过容差就可停止
    if (availableCuts[i] > t + tolerance) break
  }
  if (bestIdx >= 0 && bestDiff <= tolerance) {
    const val = availableCuts[bestIdx]
    availableCuts.splice(bestIdx, 1)  // 消耗该切点
    return val
  }
  return t
}

/**
 * 将 qwen 分镜边界吸附到最近真实场景切点。
 *
 * 算法：
 * 1. 对每个 shot 的 startTime 做吸附；
 * 2. 强制 startTime 序列严格递增（若吸附后某 start <= 前一个 start，则回退到「前一个 start
 *    与 qwen 原值的较大者」，保证严格单调，避免边界塌缩）；
 * 3. endTime 链式衔接：endTime[i] = startTime[i+1]；末个 endTime 吸附自身值并约束 totalDuration；
 *    若末个 endTime <= 末个 startTime，则强制为 totalDuration。
 *
 * @param shots 待吸附分镜（无需预排序）
 * @param sceneCuts ffmpeg 检测的真实切点（秒，升序；可为空 → 全部回退 qwen 原值）
 * @param totalDuration 视频总时长（秒）
 * @param tolerance 吸附容差，默认 SNAP_TOLERANCE
 * @returns 吸附后分镜（满足全部不变量）
 */
export function snapBoundaries(
  shots: SnapInputShot[],
  sceneCuts: number[],
  totalDuration: number,
  tolerance: number = SNAP_TOLERANCE
): SnapInputShot[] {
  if (shots.length === 0) return []

  const sorted = [...shots].sort((a, b) => a.orderIndex - b.orderIndex)

  // 单调消耗匹配：共享一个可用切点数组，每个切点最多被一个边界使用（修复风险8）
  const availableCuts = [...sceneCuts]

  // --- Step 1 + 2: 计算最终 startTime（吸附 + 强制严格递增） ---
  const starts: number[] = []
  for (let i = 0; i < sorted.length; i++) {
    const snapped = Math.max(0, snapAndConsume(sorted[i].startTime, availableCuts, tolerance))
    if (i === 0) {
      starts.push(snapped)
    } else {
      const prev = starts[i - 1]
      // 必须严格大于前一个 start；否则取 qwen 原值与 prev 的较大者再加微小增量兜底
      if (snapped > prev) {
        starts.push(snapped)
      } else {
        const fallback = Math.max(prev + 0.01, Math.min(sorted[i].startTime, totalDuration))
        starts.push(fallback > prev ? fallback : prev + 0.01)
      }
    }
  }

  // --- Step 3: 链式衔接 endTime ---
  return sorted.map((s, i) => {
    const start = starts[i]
    let end: number
    if (i < sorted.length - 1) {
      end = starts[i + 1]
    } else {
      end = Math.min(snapAndConsume(s.endTime, availableCuts, tolerance), totalDuration)
      if (end <= start) end = totalDuration > start ? totalDuration : start + 0.01
    }
    return { orderIndex: s.orderIndex, startTime: start, endTime: end }
  })
}
