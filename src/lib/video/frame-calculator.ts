/**
 * 动态帧数计算器
 * 根据视频时长计算最佳抽帧数量，供 parse-video Worker 使用
 *
 * 策略：
 * - 短视频 (≤15s)：6-10 帧
 * - 中等视频 (15-60s)：10-15 帧
 * - 长视频 (>60s)：15-20 帧
 * 确保不超过 Qwen-VL 多模态 API 的帧上限（15帧），同时覆盖足够的时间跨度
 */

/** Qwen-VL 多模态 API 单次调用最大帧数 */
const MAX_FRAMES_LIMIT = 15

/**
 * 根据视频时长计算推荐的最大抽帧数
 * @param duration 视频时长（秒）
 * @returns 推荐最大帧数，范围 [6, 15]
 */
export function calculateMaxFrames(duration: number): number {
  if (duration <= 0) return 6

  if (duration <= 15) {
    // 短视频：每 2-3 秒一帧，6-10 帧
    return Math.min(Math.max(Math.ceil(duration / 2), 6), 10)
  }

  if (duration <= 60) {
    // 中等视频：每 4-5 秒一帧，10-15 帧
    return Math.min(Math.max(Math.ceil(duration / 4), 10), MAX_FRAMES_LIMIT)
  }

  // 长视频：固定 15 帧上限
  return MAX_FRAMES_LIMIT
}
