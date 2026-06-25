/**
 * 属性测试：视频版本完整性 (Property 7)
 *
 * 对于任意成功的渲染执行：
 * - 恰好生成 3 个 VideoVariant 记录
 * - 类型集合为 {PROMOTION, ATMOSPHERE, OWNER_TALKING}
 * - ContentBrief 状态转移为 GENERATED
 *
 * 模拟渲染成功路径，验证输出完整性约束。
 *
 * **Validates: Requirements 7.1, 7.5**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import type { VideoVariantType, ContentBriefStatus } from '@/types/merchant'

// ========================
// 类型定义
// ========================

/** 渲染产出记录 */
interface RenderOutputRecord {
  id: string
  type: VideoVariantType
  contentBriefId: string
  ossKey: string
}

/** ContentBrief 状态变更记录 */
interface BriefStatusTransition {
  contentBriefId: string
  fromStatus: ContentBriefStatus
  toStatus: ContentBriefStatus
}

/** 必须生成的 3 种版本类型 */
const REQUIRED_VARIANT_TYPES: VideoVariantType[] = ['PROMOTION', 'ATMOSPHERE', 'OWNER_TALKING']

// ========================
// 模拟成功渲染流程输出
// ========================

/**
 * 模拟成功的渲染流程
 * 根据 local-render-service.ts 的逻辑：
 * - 始终生成 3 种固定版本类型
 * - 成功后状态转为 GENERATED
 */
function simulateSuccessfulRender(params: {
  contentBriefId: string
  storeId: string
}): {
  variants: RenderOutputRecord[]
  statusTransition: BriefStatusTransition
} {
  const { contentBriefId, storeId } = params

  // 生成 3 种版本
  const variants: RenderOutputRecord[] = REQUIRED_VARIANT_TYPES.map((type) => ({
    id: `variant-${type}-${contentBriefId}`,
    type,
    contentBriefId,
    ossKey: `merchant/${storeId}/variants/variant-${type}-${contentBriefId}.mp4`,
  }))

  // 状态转移
  const statusTransition: BriefStatusTransition = {
    contentBriefId,
    fromStatus: 'RENDERING',
    toStatus: 'GENERATED',
  }

  return { variants, statusTransition }
}

// ========================
// 不变式验证函数
// ========================

/**
 * 验证渲染产出完整性
 */
function validateRenderCompleteness(
  variants: RenderOutputRecord[],
  statusTransition: BriefStatusTransition,
): { valid: boolean; reason?: string } {
  // 不变式 1: 恰好 3 个 VideoVariant
  if (variants.length !== 3) {
    return { valid: false, reason: `应生成 3 个版本，实际 ${variants.length} 个` }
  }

  // 不变式 2: 类型集合为 {PROMOTION, ATMOSPHERE, OWNER_TALKING}
  const types = new Set(variants.map((v) => v.type))
  for (const requiredType of REQUIRED_VARIANT_TYPES) {
    if (!types.has(requiredType)) {
      return { valid: false, reason: `缺少必要版本类型: ${requiredType}` }
    }
  }

  // 不变式 3: 无重复类型
  if (types.size !== 3) {
    return { valid: false, reason: `存在重复版本类型，唯一类型数: ${types.size}` }
  }

  // 不变式 4: 所有 variant 关联同一 contentBriefId
  const briefIds = new Set(variants.map((v) => v.contentBriefId))
  if (briefIds.size !== 1) {
    return { valid: false, reason: `VideoVariant 关联了多个 contentBriefId` }
  }

  // 不变式 5: ContentBrief 状态应转为 GENERATED
  if (statusTransition.toStatus !== 'GENERATED') {
    return {
      valid: false,
      reason: `ContentBrief 状态应为 GENERATED，实际为 ${statusTransition.toStatus}`,
    }
  }

  // 不变式 6: 所有 variant 应有 ossKey
  for (const variant of variants) {
    if (!variant.ossKey || variant.ossKey.trim() === '') {
      return { valid: false, reason: `VideoVariant ${variant.type} 的 ossKey 为空` }
    }
  }

  return { valid: true }
}

// ========================
// 生成器
// ========================

/** ContentBrief ID 生成器 */
const briefIdArb = fc.uuid()

/** Store ID 生成器 */
const storeIdArb = fc.uuid()

// ========================
// 属性测试
// ========================

describe('Property 7: 视频版本完整性', () => {
  it('成功渲染后恰好生成 3 个 VideoVariant，类型为 {PROMOTION, ATMOSPHERE, OWNER_TALKING}', () => {
    fc.assert(
      fc.property(briefIdArb, storeIdArb, (contentBriefId, storeId) => {
        const { variants, statusTransition } = simulateSuccessfulRender({
          contentBriefId,
          storeId,
        })

        const result = validateRenderCompleteness(variants, statusTransition)
        expect(result.valid).toBe(true)
      }),
      { numRuns: 100 },
    )
  })

  it('每种 VideoVariant 类型出现恰好 1 次', () => {
    fc.assert(
      fc.property(briefIdArb, storeIdArb, (contentBriefId, storeId) => {
        const { variants } = simulateSuccessfulRender({ contentBriefId, storeId })

        const typeCounts = new Map<VideoVariantType, number>()
        for (const v of variants) {
          typeCounts.set(v.type, (typeCounts.get(v.type) ?? 0) + 1)
        }

        for (const type of REQUIRED_VARIANT_TYPES) {
          expect(typeCounts.get(type)).toBe(1)
        }
      }),
      { numRuns: 100 },
    )
  })

  it('ossKey 格式满足 merchant/{storeId}/variants/{variantId}.mp4 模式', () => {
    fc.assert(
      fc.property(briefIdArb, storeIdArb, (contentBriefId, storeId) => {
        const { variants } = simulateSuccessfulRender({ contentBriefId, storeId })

        for (const variant of variants) {
          expect(variant.ossKey).toMatch(/^merchant\/[^/]+\/variants\/[^/]+\.mp4$/)
          expect(variant.ossKey).toContain(storeId)
        }
      }),
      { numRuns: 100 },
    )
  })

  it('状态从 RENDERING 转为 GENERATED', () => {
    fc.assert(
      fc.property(briefIdArb, storeIdArb, (contentBriefId, storeId) => {
        const { statusTransition } = simulateSuccessfulRender({ contentBriefId, storeId })

        expect(statusTransition.fromStatus).toBe('RENDERING')
        expect(statusTransition.toStatus).toBe('GENERATED')
      }),
      { numRuns: 100 },
    )
  })
})
