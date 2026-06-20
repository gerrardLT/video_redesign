/**
 * preview-transform 纯函数模块单元测试
 *
 * 测试缩放限制、平移边界、以鼠标位置为中心的缩放计算
 */
import { describe, it, expect } from 'vitest'
import {
  clampScale,
  clampPan,
  zoomAtPoint,
  MIN_SCALE,
  MAX_SCALE,
} from '@/lib/preview-transform'

describe('clampScale', () => {
  it('应将小于 0.5 的值限制为 0.5', () => {
    expect(clampScale(0)).toBe(MIN_SCALE)
    expect(clampScale(-1)).toBe(MIN_SCALE)
    expect(clampScale(0.3)).toBe(MIN_SCALE)
  })

  it('应将大于 3.0 的值限制为 3.0', () => {
    expect(clampScale(4)).toBe(MAX_SCALE)
    expect(clampScale(100)).toBe(MAX_SCALE)
    expect(clampScale(3.1)).toBe(MAX_SCALE)
  })

  it('应保持范围内的值不变', () => {
    expect(clampScale(0.5)).toBe(0.5)
    expect(clampScale(1.0)).toBe(1.0)
    expect(clampScale(2.0)).toBe(2.0)
    expect(clampScale(3.0)).toBe(3.0)
  })

  it('应正确处理边界值', () => {
    expect(clampScale(0.5)).toBe(0.5)
    expect(clampScale(3.0)).toBe(3.0)
  })
})

describe('clampPan', () => {
  it('当缩放后图片小于视口时，应居中（pan = 0）', () => {
    // 图片 100x100，视口 800x600，scale=1 → 100 < 800, 100 < 600
    const result = clampPan(50, 30, 1, 100, 100, 800, 600)
    expect(result.panX).toBe(0)
    expect(result.panY).toBe(0)
  })

  it('当缩放后图片等于视口时，应居中（pan = 0）', () => {
    // 图片 800x600，视口 800x600，scale=1 → 800 == 800, 600 == 600
    const result = clampPan(100, -50, 1, 800, 600, 800, 600)
    expect(result.panX).toBe(0)
    expect(result.panY).toBe(0)
  })

  it('当缩放后图片大于视口时，应允许有限平移', () => {
    // 图片 1000x800，视口 500x400，scale=1
    // scaledWidth=1000, maxPanX=(1000-500)/2=250
    // scaledHeight=800, maxPanY=(800-400)/2=200
    const result = clampPan(100, -50, 1, 1000, 800, 500, 400)
    expect(result.panX).toBe(100) // 在范围内，保持不变
    expect(result.panY).toBe(-50) // 在范围内，保持不变
  })

  it('应将超出范围的平移值限制到最大偏移', () => {
    // 图片 1000x800，视口 500x400，scale=1
    // maxPanX=250, maxPanY=200
    const result = clampPan(300, -300, 1, 1000, 800, 500, 400)
    expect(result.panX).toBe(250)
    expect(result.panY).toBe(-200)
  })

  it('应将负方向超出范围的平移值限制到最小偏移', () => {
    // maxPanX=250, maxPanY=200
    const result = clampPan(-300, 300, 1, 1000, 800, 500, 400)
    expect(result.panX).toBe(-250)
    expect(result.panY).toBe(200)
  })

  it('应正确处理缩放因子对边界的影响', () => {
    // 图片 400x300，视口 800x600，scale=2 → scaled=800x600 == viewport
    const result = clampPan(50, 50, 2, 400, 300, 800, 600)
    expect(result.panX).toBe(0)
    expect(result.panY).toBe(0)

    // scale=3 → scaled=1200x900 > viewport
    // maxPanX=(1200-800)/2=200, maxPanY=(900-600)/2=150
    const result2 = clampPan(50, 50, 3, 400, 300, 800, 600)
    expect(result2.panX).toBe(50)
    expect(result2.panY).toBe(50)
  })
})

describe('zoomAtPoint', () => {
  it('应返回 clamp 后的缩放值', () => {
    // 从 0.5 缩小 → 应该被 clamp 到 0.5
    const result = zoomAtPoint(0.5, -0.1, 0, 0, 0, 0)
    expect(result.scale).toBe(0.5)
    expect(result.panX).toBe(0)
    expect(result.panY).toBe(0)
  })

  it('应返回 clamp 后的缩放值（上界）', () => {
    // 从 3.0 放大 → 应该被 clamp 到 3.0
    const result = zoomAtPoint(3.0, 0.1, 0, 0, 0, 0)
    expect(result.scale).toBe(3.0)
    expect(result.panX).toBe(0)
    expect(result.panY).toBe(0)
  })

  it('以视口中心缩放时偏移不变', () => {
    // 鼠标在视口中心（0,0），当前 pan 为 0
    const result = zoomAtPoint(1.0, 0.5, 0, 0, 0, 0)
    expect(result.scale).toBe(1.5)
    expect(result.panX).toBe(0)
    expect(result.panY).toBe(0)
  })

  it('以偏移位置缩放时应调整偏移量', () => {
    // 鼠标在 (100, 50)，当前 scale=1, pan=(0,0)
    // newScale = 1.5, ratio = 1.5
    // newPanX = 0 * 1.5 + 100 * (1 - 1.5) = -50
    // newPanY = 0 * 1.5 + 50 * (1 - 1.5) = -25
    const result = zoomAtPoint(1.0, 0.5, 100, 50, 0, 0)
    expect(result.scale).toBe(1.5)
    expect(result.panX).toBeCloseTo(-50)
    expect(result.panY).toBeCloseTo(-25)
  })

  it('缩小时应反向调整偏移', () => {
    // 从 2.0 缩小到 1.5，鼠标在 (200, 100)，pan=(0,0)
    // ratio = 1.5/2.0 = 0.75
    // newPanX = 0 * 0.75 + 200 * (1 - 0.75) = 50
    // newPanY = 0 * 0.75 + 100 * (1 - 0.75) = 25
    const result = zoomAtPoint(2.0, -0.5, 200, 100, 0, 0)
    expect(result.scale).toBe(1.5)
    expect(result.panX).toBeCloseTo(50)
    expect(result.panY).toBeCloseTo(25)
  })

  it('已有偏移时缩放应正确计算新偏移', () => {
    // currentScale=1, delta=1 → newScale=2, ratio=2
    // mouseX=50, mouseY=30, panX=10, panY=20
    // newPanX = 10 * 2 + 50 * (1-2) = 20 - 50 = -30
    // newPanY = 20 * 2 + 30 * (1-2) = 40 - 30 = 10
    const result = zoomAtPoint(1.0, 1.0, 50, 30, 10, 20)
    expect(result.scale).toBe(2.0)
    expect(result.panX).toBeCloseTo(-30)
    expect(result.panY).toBeCloseTo(10)
  })
})
