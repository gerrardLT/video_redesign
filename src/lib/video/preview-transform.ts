/**
 * 资产预览缩放/平移计算纯函数模块
 *
 * 提供 Preview_Modal 所需的缩放和平移计算逻辑，所有函数为纯函数，无副作用，
 * 方便属性测试和跨组件复用。
 *
 * 核心逻辑：
 * - clampScale：将缩放比例限制在 [0.5, 3.0] 范围
 * - clampPan：确保平移偏移不超出可视边界
 * - zoomAtPoint：以鼠标位置为缩放中心的滚轮缩放
 */

/** 缩放范围常量 */
export const MIN_SCALE = 0.5
export const MAX_SCALE = 3.0

/** 视图变换状态（缩放比例 + 平移偏移） */
export interface ViewTransform {
  scale: number
  panX: number
  panY: number
}

/**
 * 将缩放比例限制在有效范围 [0.5, 3.0] 内
 *
 * @param raw 原始缩放值（可能超出范围）
 * @returns 被限制后的缩放值，始终 ∈ [0.5, 3.0]
 */
export function clampScale(raw: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw))
}

/**
 * 限制平移偏移，确保图片不超出视口可视边界
 *
 * 逻辑规则：
 * - 当 scale * imageSize <= viewportSize 时，图片小于视口，居中显示（pan = 0）
 * - 当 scale * imageSize > viewportSize 时，限制 pan 使图片边缘不超出视口
 *   最大偏移量 = (scaledSize - viewportSize) / 2
 *
 * @param panX 水平平移偏移（像素）
 * @param panY 垂直平移偏移（像素）
 * @param scale 当前缩放比例
 * @param imageWidth 图片原始宽度（像素）
 * @param imageHeight 图片原始高度（像素）
 * @param viewportWidth 视口宽度（像素）
 * @param viewportHeight 视口高度（像素）
 * @returns 被限制后的 { panX, panY }
 */
export function clampPan(
  panX: number,
  panY: number,
  scale: number,
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number
): { panX: number; panY: number } {
  // 计算缩放后的图片尺寸
  const scaledWidth = scale * imageWidth
  const scaledHeight = scale * imageHeight

  // 水平方向：图片小于视口时居中，否则限制边界
  let clampedPanX: number
  if (scaledWidth <= viewportWidth) {
    clampedPanX = 0
  } else {
    const maxPanX = (scaledWidth - viewportWidth) / 2
    clampedPanX = Math.min(maxPanX, Math.max(-maxPanX, panX))
  }

  // 垂直方向：图片小于视口时居中，否则限制边界
  let clampedPanY: number
  if (scaledHeight <= viewportHeight) {
    clampedPanY = 0
  } else {
    const maxPanY = (scaledHeight - viewportHeight) / 2
    clampedPanY = Math.min(maxPanY, Math.max(-maxPanY, panY))
  }

  return { panX: clampedPanX, panY: clampedPanY }
}

/**
 * 以鼠标位置为缩放中心的滚轮缩放计算
 *
 * 算法原理：
 * 缩放中心保持不动 → 新偏移 = 旧偏移 * (newScale / oldScale) + mousePos * (1 - newScale / oldScale)
 * 这样鼠标指向的点在缩放前后保持在屏幕同一位置。
 *
 * @param currentScale 当前缩放比例
 * @param delta 缩放增量（正值放大，负值缩小）
 * @param mouseX 鼠标相对于视口中心的 X 坐标（像素）
 * @param mouseY 鼠标相对于视口中心的 Y 坐标（像素）
 * @param panX 当前水平平移偏移
 * @param panY 当前垂直平移偏移
 * @returns 新的 ViewTransform（scale 已 clamp，pan 未 clamp——调用方需再调用 clampPan）
 */
export function zoomAtPoint(
  currentScale: number,
  delta: number,
  mouseX: number,
  mouseY: number,
  panX: number,
  panY: number
): ViewTransform {
  // 计算新缩放比例并限制范围
  const newScale = clampScale(currentScale + delta)

  // 如果缩放比例没有实际变化（已达边界），直接返回原值
  if (newScale === currentScale) {
    return { scale: currentScale, panX, panY }
  }

  // 缩放比率
  const ratio = newScale / currentScale

  // 以鼠标位置为缩放中心计算新偏移
  // 公式推导：将坐标系以视口中心为原点，鼠标点不动则：
  // newPan = oldPan * ratio + mousePos * (1 - ratio)
  const newPanX = panX * ratio + mouseX * (1 - ratio)
  const newPanY = panY * ratio + mouseY * (1 - ratio)

  return {
    scale: newScale,
    panX: newPanX,
    panY: newPanY,
  }
}
