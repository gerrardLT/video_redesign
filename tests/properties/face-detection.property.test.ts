import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: product-competitiveness
 * Property 6: 人脸检测状态转换正确性
 * Property 7: 被拦截素材列表完整性
 *
 * **Validates: Requirements 4.3, 4.4, 4.6, 4.7**
 */

// ========================
// 类型定义
// ========================

type AssetStatus =
  | 'PENDING'
  | 'UPLOADED'
  | 'CHECKING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CHECK_FAILED'
  | 'EXPIRED'

interface MockAsset {
  id: string
  url: string
  status: AssetStatus
  type: string
  userId: string
  userName: string
  rejectReason: string | null
  createdAt: Date
}

type FaceCheckApiResult = 'pass' | 'reject' | 'error'

interface FaceCheckApiResponse {
  result: FaceCheckApiResult
  reason?: string
}

// ========================
// 纯函数模拟（来自 face-detection-service.ts 逻辑）
// ========================

/**
 * 模拟人脸检测状态转换逻辑
 * - API 返回 pass → APPROVED
 * - API 返回 reject → REJECTED (含 rejectReason)
 * - API 调用失败 → CHECK_FAILED
 */
function computeNewStatus(
  currentStatus: AssetStatus,
  apiResponse: FaceCheckApiResponse
): { newStatus: AssetStatus; rejectReason: string | null } {
  if (currentStatus !== 'CHECKING') {
    // 非 CHECKING 状态不处理
    return { newStatus: currentStatus, rejectReason: null }
  }

  const statusMap: Record<FaceCheckApiResult, AssetStatus> = {
    pass: 'APPROVED',
    reject: 'REJECTED',
    error: 'CHECK_FAILED',
  }

  const newStatus = statusMap[apiResponse.result]
  const rejectReason =
    apiResponse.result === 'reject'
      ? apiResponse.reason || '检测到真人面部，参考素材不允许包含真人脸'
      : null

  return { newStatus, rejectReason }
}

/**
 * 模拟被拦截素材列表过滤逻辑
 * 仅返回 status=REJECTED 的素材
 */
function filterRejectedAssets(assets: MockAsset[]): MockAsset[] {
  return assets.filter((a) => a.status === 'REJECTED')
}

/**
 * 验证被拦截素材记录的信息完整性
 */
function validateRejectedAssetInfo(asset: MockAsset): boolean {
  return (
    asset.id.length > 0 &&
    asset.url.length > 0 && // 缩略图/URL
    asset.userId.length > 0 &&
    asset.createdAt instanceof Date &&
    asset.rejectReason !== null &&
    asset.rejectReason.length > 0
  )
}

// ========================
// 生成器
// ========================

const assetStatusArb: fc.Arbitrary<AssetStatus> = fc.constantFrom(
  'PENDING',
  'UPLOADED',
  'CHECKING',
  'APPROVED',
  'REJECTED',
  'CHECK_FAILED',
  'EXPIRED'
)

const faceCheckResultArb: fc.Arbitrary<FaceCheckApiResult> = fc.constantFrom(
  'pass',
  'reject',
  'error'
)

const faceCheckResponseArb: fc.Arbitrary<FaceCheckApiResponse> = fc.record({
  result: faceCheckResultArb,
  reason: fc.option(
    fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
    { nil: undefined }
  ),
})

const mockAssetArb: fc.Arbitrary<MockAsset> = fc.record({
  id: fc.uuid(),
  url: fc.stringMatching(/^https:\/\/oss\.example\.com\/assets\/[a-z0-9]{8}\.(jpg|png)$/),
  status: assetStatusArb,
  type: fc.constantFrom('REFERENCE', 'AI_GENERATED', 'SOURCE_VIDEO'),
  userId: fc.uuid(),
  userName: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
  rejectReason: fc.option(
    fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
    { nil: null }
  ),
  createdAt: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }),
})

// ========================
// Property 6: 人脸检测状态转换正确性
// ========================

describe('人脸检测状态转换正确性 Property (Property 6)', () => {
  it('API 返回 pass 时，CHECKING 状态转为 APPROVED', () => {
    fc.assert(
      fc.property(fc.uuid(), (assetId) => {
        void assetId
        const response: FaceCheckApiResponse = { result: 'pass' }
        const { newStatus, rejectReason } = computeNewStatus('CHECKING', response)

        expect(newStatus).toBe('APPROVED')
        expect(rejectReason).toBeNull()
      }),
      { numRuns: 100 }
    )
  })

  it('API 返回 reject 时，CHECKING 状态转为 REJECTED 且 rejectReason 非空', () => {
    fc.assert(
      fc.property(
        fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
        (reason) => {
          const response: FaceCheckApiResponse = { result: 'reject', reason }
          const { newStatus, rejectReason } = computeNewStatus('CHECKING', response)

          expect(newStatus).toBe('REJECTED')
          expect(rejectReason).not.toBeNull()
          expect(rejectReason!.length).toBeGreaterThan(0)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('API 调用失败（error）时，CHECKING 状态转为 CHECK_FAILED', () => {
    fc.assert(
      fc.property(fc.uuid(), (assetId) => {
        void assetId
        const response: FaceCheckApiResponse = { result: 'error' }
        const { newStatus, rejectReason } = computeNewStatus('CHECKING', response)

        expect(newStatus).toBe('CHECK_FAILED')
        expect(rejectReason).toBeNull()
      }),
      { numRuns: 100 }
    )
  })

  it('非 CHECKING 状态的素材不受检测结果影响', () => {
    fc.assert(
      fc.property(
        assetStatusArb.filter((s) => s !== 'CHECKING'),
        faceCheckResponseArb,
        (currentStatus, response) => {
          const { newStatus } = computeNewStatus(currentStatus, response)

          expect(newStatus).toBe(currentStatus)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('状态转换确定性：相同输入得到相同输出', () => {
    fc.assert(
      fc.property(
        assetStatusArb,
        faceCheckResponseArb,
        (currentStatus, response) => {
          const result1 = computeNewStatus(currentStatus, response)
          const result2 = computeNewStatus(currentStatus, response)

          expect(result1.newStatus).toBe(result2.newStatus)
          expect(result1.rejectReason).toBe(result2.rejectReason)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('reject 时 rejectReason 优先使用 API 返回的 reason', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
        (reason) => {
          const response: FaceCheckApiResponse = { result: 'reject', reason }
          const { rejectReason } = computeNewStatus('CHECKING', response)

          expect(rejectReason).toBe(reason)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('reject 无 reason 时使用默认拒绝原因', () => {
    const response: FaceCheckApiResponse = { result: 'reject' }
    const { rejectReason } = computeNewStatus('CHECKING', response)

    expect(rejectReason).toContain('真人面部')
  })
})

// ========================
// Property 7: 被拦截素材列表完整性
// ========================

describe('被拦截素材列表完整性 Property (Property 7)', () => {
  it('列表仅包含 status=REJECTED 的素材', () => {
    fc.assert(
      fc.property(
        fc.array(mockAssetArb, { minLength: 0, maxLength: 30 }),
        (assets) => {
          const rejected = filterRejectedAssets(assets)

          for (const asset of rejected) {
            expect(asset.status).toBe('REJECTED')
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('不遗漏任何 REJECTED 状态的素材', () => {
    fc.assert(
      fc.property(
        fc.array(mockAssetArb, { minLength: 0, maxLength: 30 }),
        (assets) => {
          const rejected = filterRejectedAssets(assets)

          const expectedCount = assets.filter((a) => a.status === 'REJECTED').length
          expect(rejected.length).toBe(expectedCount)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('非 REJECTED 状态的素材不出现在列表中', () => {
    fc.assert(
      fc.property(
        fc.array(
          mockAssetArb.map((a) => ({
            ...a,
            status: fc.sample(
              fc.constantFrom('APPROVED', 'CHECKING', 'CHECK_FAILED', 'PENDING', 'UPLOADED') as fc.Arbitrary<AssetStatus>,
              1
            )[0],
          })),
          { minLength: 1, maxLength: 20 }
        ),
        (assets) => {
          const rejected = filterRejectedAssets(assets)
          expect(rejected.length).toBe(0)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('被拦截记录包含完整信息字段（URL、用户、时间、原因）', () => {
    fc.assert(
      fc.property(
        fc.array(
          mockAssetArb.map((a) => ({
            ...a,
            status: 'REJECTED' as AssetStatus,
            rejectReason: '检测到真人面部',
          })),
          { minLength: 1, maxLength: 10 }
        ),
        (assets) => {
          const rejected = filterRejectedAssets(assets)

          for (const asset of rejected) {
            expect(validateRejectedAssetInfo(asset)).toBe(true)
          }
        }
      ),
      { numRuns: 200 }
    )
  })
})
