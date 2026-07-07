// Feature: local-life-depth-enhancements, Property 16: 高级参数可解释标注
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

import { MAX_FILLER_DURATION_SEC } from '@/constants/merchant'

/**
 * Feature: local-life-depth-enhancements
 * Property 16: 高级参数可解释标注
 *
 * 对任意携带 advancedParams（style / templateId ∈ {PROMOTION, ATMOSPHERE, OWNER_TALKING}，
 * durationSec ∈ [1, MAX_FILLER_DURATION_SEC]）的单版本重生成：
 * local-render-service.regenerateSingleVariant 在 resolveAdvancedParams 校验通过后，
 * 写入 VideoVariant.renderParams.advancedParams 的内容必须与本次「实际提供」的高级参数项逐项一致
 * （未提供的项不出现，已提供的项原样标注），以满足需求 4.7「结果上标注本次使用的参数（可解释）」。
 *
 * **Validates: Requirements 4.7**
 *
 * 测试手段：对被测函数的所有外部边界做 vi.mock 内存桩——
 * - @/lib/db（prisma）：findUniqueOrThrow 返回固定 variant 上下文；$transaction 透传内存 tx，
 *   其 videoVariant.update 捕获写入的 renderParams（即被断言对象）。
 * - getBalance/计费链路（merchant-billing-service）：余额恒充足，reserve/charge/refund 为内存桩。
 * - storage / distributed-lock / seedance / progress-publisher / impact-scope-service：内存桩。
 * - child_process(execFile) / fs/promises：使 assembleVariantClips、compositeVideo 在内存中无副作用运行
 *   （ffprobe 返回固定元数据，ffmpeg 空操作，文件读写为内存桩），从而隔离真实 FFmpeg/OSS/Seedance。
 * 不使用 fallback、不依赖真实外部服务。
 */

// ========================
// 跨 mock 共享的内存状态（vi.hoisted 保证在 mock 工厂中可见）
// ========================
const captured = vi.hoisted(() => ({
  // 捕获 videoVariant.update 写入的 renderParams（被断言对象）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  renderParams: null as any,
}))

// ========================
// Mock Prisma（内存桩）
// ========================
vi.mock('@/lib/shared/db', () => {
  // 固定的 variant 上下文：单一已拍镜头（含 rawAssets），使 assembleVariantClips
  // 走「已有素材」单片段分支，无需 Seedance 补充，compositeVideo 走单片段分支。
  const buildVariant = () => ({
    id: 'variant_1',
    type: 'PROMOTION',
    contentBrief: {
      id: 'brief_1',
      storeId: 'store_1',
      hook: '钩子文案',
      mainMessage: '主信息文案',
      suggestedCta: '到店核销',
      shotTasks: [
        {
          id: 'shot_1',
          type: 'PRODUCT_CLOSEUP',
          order: 0,
          required: true,
          durationSec: 5,
          title: '产品特写',
          instruction: '近距离拍摄产品',
          examplePrompt: null,
          rawAssets: [
            { id: 'asset_1', ossKey: 'merchant/store_1/raw/asset_1.mp4', durationSec: 5, type: 'PRODUCT_CLOSEUP' },
          ],
        },
      ],
      store: { id: 'store_1' },
    },
  })

  return {
    prisma: {
      videoVariant: {
        findUniqueOrThrow: vi.fn(async () => buildVariant()),
      },
      // $transaction 透传内存 tx：update 捕获写入的 renderParams
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) =>
        fn({
          videoVariant: {
            update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
              captured.renderParams = data.renderParams
              return { id: 'variant_1', ...data }
            }),
          },
        })
      ),
    },
  }
})

// ========================
// Mock 计费链路（余额恒充足，reserve/charge/refund 内存桩）
// ========================
vi.mock('@/lib/shared/credit-service', () => ({
  getBalance: vi.fn(async () => 1_000_000),
  estimateGroupCreditCost: vi.fn(() => 10),
}))

vi.mock('@/lib/merchant/merchant-billing-service', () => ({
  estimateRenderCost: vi.fn(() => 10),
  reserveMerchantCredits: vi.fn(async () => undefined),
  chargeMerchantCredits: vi.fn(async () => undefined),
  refundMerchantCredits: vi.fn(async () => undefined),
}))

// ========================
// Mock 存储 / 锁 / 外部生成 / SSE / 影响范围（内存桩）
// ========================
vi.mock('@/lib/shared/storage', () => ({
  uploadBuffer: vi.fn(async () => undefined),
  getSignedObjectUrl: vi.fn(() => 'https://example.com/signed'),
  downloadToTemp: vi.fn(async () => undefined),
}))

vi.mock('@/lib/shared/distributed-lock', () => ({
  acquireLock: vi.fn(async () => true),
  releaseLock: vi.fn(async () => undefined),
}))

vi.mock('@/lib/video/seedance', () => ({
  createSeedanceTask: vi.fn(async () => ({ taskId: 'task_1' })),
  getSeedanceTaskStatus: vi.fn(async () => ({ status: 'succeeded', videoUrl: 'https://example.com/v.mp4' })),
}))

vi.mock('@/lib/shared/progress-publisher', () => ({
  publishProgress: vi.fn(async () => undefined),
}))

vi.mock('@/lib/merchant/impact-scope-service', () => ({
  computeReshootScope: vi.fn(async () => ({ affectedGroupIds: [], hasContinuityChain: false })),
}))

// ========================
// Mock 文件系统与子进程：隔离真实 FFmpeg / ffprobe / 磁盘 IO
// ========================
vi.mock('fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
  rm: vi.fn(async () => undefined),
  readFile: vi.fn(async () => Buffer.from('fake-media-bytes')),
}))

vi.mock('child_process', () => ({
  // execFile 回调式桩：ffprobe 返回固定元数据 JSON，ffmpeg 空操作
  // promisify(execFile) 走通用包装：callback(null, value) → 解析为 value
  execFile: (
    cmd: string,
    _args: string[],
    opts: unknown,
    cb?: (err: unknown, result: { stdout: string; stderr: string }) => void
  ) => {
    const callback = (typeof opts === 'function' ? opts : cb) as (
      err: unknown,
      result: { stdout: string; stderr: string }
    ) => void
    if (cmd === 'ffprobe') {
      callback(null, {
        stdout: JSON.stringify({
          streams: [{ codec_type: 'video', width: 720, height: 1280 }],
          format: { duration: '12.00' },
        }),
        stderr: '',
      })
    } else {
      callback(null, { stdout: '', stderr: '' })
    }
  },
}))

// 动态导入：确保上述 mock 在被测模块加载前生效
const { regenerateSingleVariant } = await import('@/lib/merchant/local-render-service')

// ========================
// Arbitraries
// ========================

// 合法风格 / 模板取值集合（与 local-render-service.VALID_RENDER_STYLES 对齐）
const STYLE_VALUES = ['PROMOTION', 'ATMOSPHERE', 'OWNER_TALKING'] as const

// 随机生成合法 advancedParams：每项独立可选（requiredKeys: [] → 未提供的键直接缺省），
// 因此生成对象本身即「实际提供的项集合」，可直接作为期望标注值。
const advancedParamsArb = fc.record(
  {
    style: fc.constantFrom(...STYLE_VALUES),
    templateId: fc.constantFrom(...STYLE_VALUES),
    durationSec: fc.integer({ min: 1, max: MAX_FILLER_DURATION_SEC }),
  },
  { requiredKeys: [] }
)

// ========================
// Property 16: 高级参数可解释标注
// ========================

describe('Property 16: 高级参数可解释标注', () => {
  beforeEach(() => {
    captured.renderParams = null
  })

  it('renderParams.advancedParams 恰为本次实际提供的高级参数项', async () => {
    /**
     * **Validates: Requirements 4.7**
     */
    await fc.assert(
      fc.asyncProperty(advancedParamsArb, async (advancedParams) => {
        captured.renderParams = null

        await regenerateSingleVariant({
          videoVariantId: 'variant_1',
          userId: 'user_1',
          advancedParams,
        })

        // 期望值：实际提供的项（展开为普通对象，规避 fast-check 生成的 null 原型表示差异）
        const expectedApplied = { ...advancedParams }

        // 必须写入了 renderParams，且其 advancedParams 与「实际提供」的项逐项一致
        expect(captured.renderParams).not.toBeNull()
        expect(captured.renderParams.advancedParams).toStrictEqual(expectedApplied)
      }),
      { numRuns: 200 }
    )
  })

  it('未提供 advancedParams 时标注为空对象（无臆造参数）', async () => {
    /**
     * **Validates: Requirements 4.7**
     */
    captured.renderParams = null

    await regenerateSingleVariant({
      videoVariantId: 'variant_1',
      userId: 'user_1',
    })

    expect(captured.renderParams).not.toBeNull()
    expect(captured.renderParams.advancedParams).toStrictEqual({})
  })
})
