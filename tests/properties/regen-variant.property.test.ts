// Feature: local-life-depth-enhancements, Property 14: 单版本重生成隔离性
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: local-life-depth-enhancements
 * Property 14: 单版本重生成隔离性
 *
 * 对含 N(≥1) 个 VideoVariant 的 ContentBrief 与被选中重生成的版本 v：
 * 调用 local-render-service.regenerateSingleVariant 后，
 *   1) 版本总数仍为 N（不新增、不删除）；
 *   2) v 之外的所有版本的 id 与内容保持不变（不被触碰）；
 *   3) 仅 v 被替换（同一 id 就地更新内容），且数据库 update 恰只命中 v 的 id 一次。
 *
 * **Validates: Requirements 4.2**
 *
 * 测试手段（真实逻辑、无 fallback、无伪造）：
 * regenerateSingleVariant 真实执行其编排/合成/计费控制流，仅对其叶子副作用依赖做内存桩：
 *   - @/lib/db 的 prisma：用内存 variants 集合实现 videoVariant.findUniqueOrThrow / update /
 *     $transaction，逐行记录被 update 的目标 id，从而真实验证「仅目标行被就地更新、集合大小不变、
 *     其它行不被触碰」的隔离性不变式；
 *   - FFmpeg（child_process.execFile）与 ffprobe：内存桩，ffprobe 返回固定元数据，ffmpeg no-op；
 *   - fs/promises（mkdir/writeFile/rm/readFile）：内存桩，readFile 返回固定 buffer；
 *   - @/lib/storage（uploadBuffer/getSignedObjectUrl/downloadToTemp）：内存桩；
 *   - @/lib/video/seedance / @/lib/distributed-lock / @/lib/progress-publisher / @/lib/impact-scope-service：内存桩；
 *   - @/lib/credit-service.getBalance 返回充足余额（计费守恒由 Property 1 专门覆盖，此处只关注隔离性），
 *     @/lib/merchant-billing-service 的 reserve/charge/refund 为 no-op。
 * 被测控制流（读取目标版本→校验高级参数→预检→RESERVE→编排→合成→$transaction 内就地 update + CHARGE）
 * 全程真实执行，断言作用于内存 variants 集合的真实读写结果。
 */

// ========================
// 共享内存状态（每次迭代重置）
// ========================

const dbState = vi.hoisted(() => ({
  // 该 brief 下的全部 VideoVariant 行（内存集合，模拟持久化）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  variants: [] as any[],
  // findUniqueOrThrow 装配 variant.contentBrief 时使用的 brief（含 shotTasks/store）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  brief: null as any,
  // 记录每次 videoVariant.update 命中的目标 id，用于断言「仅目标行被更新且恰一次」
  updatedIds: [] as string[],
}))

// ========================
// Mock 依赖（内存桩）
// ========================

vi.mock('@/lib/shared/db', () => {
  const videoVariant = {
    // 读取目标版本 + 装配所属 brief（shotTasks/rawAssets/store）
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
      const v = dbState.variants.find((x) => x.id === where.id)
      if (!v) throw new Error(`VideoVariant ${where.id} 不存在`)
      return { ...v, contentBrief: dbState.brief }
    }),
    // 就地更新：记录被命中的 id，仅修改该行（其它行不受影响）
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      dbState.updatedIds.push(where.id)
      const v = dbState.variants.find((x) => x.id === where.id)
      if (!v) throw new Error(`VideoVariant ${where.id} 不存在`)
      Object.assign(v, data)
      return { ...v }
    }),
  }
  return {
    prisma: {
      videoVariant,
      // $transaction 透传同一组内存读写方法（callback 形式）
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn({ videoVariant })),
    },
  }
})

// FFmpeg / ffprobe：内存桩。promisify(execFile) 走通用 promisify（mock 无 custom 符号），
// 回调以 (null, { stdout, stderr }) resolve；ffprobe 返回固定视频元数据，其余 ffmpeg no-op。
vi.mock('child_process', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execFile: vi.fn((...args: any[]) => {
    const cb = args[args.length - 1]
    const file = args[0]
    if (typeof cb !== 'function') return
    if (file === 'ffprobe') {
      cb(null, {
        stdout: JSON.stringify({
          streams: [{ codec_type: 'video', width: 720, height: 1280 }],
          format: { duration: '10' },
        }),
        stderr: '',
      })
    } else {
      cb(null, { stdout: '', stderr: '' })
    }
  }),
}))

vi.mock('fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
  rm: vi.fn(async () => undefined),
  readFile: vi.fn(async () => Buffer.from('fake-media-bytes')),
}))

vi.mock('@/lib/shared/storage', () => ({
  uploadBuffer: vi.fn(async () => undefined),
  getSignedObjectUrl: vi.fn(() => 'https://signed.local/asset'),
  downloadToTemp: vi.fn(async () => undefined),
}))

vi.mock('@/lib/video/seedance', () => ({
  createSeedanceTask: vi.fn(async () => ({ taskId: 'seedance_test' })),
  getSeedanceTaskStatus: vi.fn(async () => ({ status: 'succeeded', videoUrl: 'https://x.local/v.mp4' })),
}))

vi.mock('@/lib/shared/distributed-lock', () => ({
  acquireLock: vi.fn(async () => true),
  releaseLock: vi.fn(async () => undefined),
}))

vi.mock('@/lib/shared/progress-publisher', () => ({
  publishStateChange: vi.fn(async () => undefined),
  publishCompleted: vi.fn(async () => undefined),
  publishFailed: vi.fn(async () => undefined),
}))

vi.mock('@/lib/merchant/impact-scope-service', () => ({
  computeReshootScope: vi.fn(async () => ({ affectedGroupIds: [], hasContinuityChain: false })),
}))

// 余额充足 → 通过预检并执行（计费守恒由 Property 1 专门覆盖，此处只关注隔离性）
vi.mock('@/lib/shared/credit-service', () => ({
  getBalance: vi.fn(async () => 1_000_000),
  estimateGroupCreditCost: vi.fn(() => 1),
}))

vi.mock('@/lib/merchant/merchant-billing-service', () => ({
  estimateRenderCost: vi.fn(() => 10),
  reserveMerchantCredits: vi.fn(async () => undefined),
  chargeMerchantCredits: vi.fn(async () => undefined),
  refundMerchantCredits: vi.fn(async () => undefined),
}))

// 动态导入以确保上述 mock 生效
const { regenerateSingleVariant } = await import('@/lib/merchant/local-render-service')

// ========================
// Arbitraries
// ========================

// 合法版本类型（local-render 支持的三种，作为目标版本与编排模板的取值域）
const VALID_TYPES = ['PROMOTION', 'ATMOSPHERE', 'OWNER_TALKING'] as const

// 单个 VideoVariant 行：id 唯一、内容随机（用于验证非目标行原样保留）
const variantRecordArb = fc.record({
  id: fc.uuid(),
  type: fc.constantFrom(...VALID_TYPES),
  title: fc.string({ maxLength: 20 }),
  ossKey: fc.string({ maxLength: 40 }),
  coverOssKey: fc.string({ maxLength: 40 }),
  durationSec: fc.double({ min: 1, max: 60, noNaN: true, noDefaultInfinity: true }),
  width: fc.constant(720),
  height: fc.constant(1280),
  subtitles: fc.constant(null),
  renderParams: fc.constant(null),
  generationLog: fc.constant(null),
  regenScope: fc.constant(null),
})

// N(1..5) 个 id 互异的版本集合
const variantsArb = fc.uniqueArray(variantRecordArb, {
  minLength: 1,
  maxLength: 5,
  selector: (v) => v.id,
})

// 固定的镜头集合：每个镜头都带已拍素材（避免触发 Seedance 补充片段路径），保证至少一个可用片段
function buildBrief(briefId: string) {
  return {
    id: briefId,
    storeId: 'store_test',
    hook: '今日特惠',
    mainMessage: '招牌现做',
    suggestedCta: '到店品尝',
    store: { id: 'store_test', name: '测试门店' },
    shotTasks: [
      {
        id: 'shot_test',
        type: 'PRODUCT_CLOSEUP',
        order: 0,
        required: true,
        durationSec: 5,
        title: '产品特写',
        instruction: '近距离展示产品',
        examplePrompt: null,
        rawAssets: [{ id: 'asset_test', ossKey: 'merchant/store_test/raw/asset_test.mp4', durationSec: 5, type: 'video' }],
      },
    ],
  }
}

// ========================
// Property 14: 单版本重生成隔离性
// ========================

describe('Property 14: 单版本重生成隔离性', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('regenerateSingleVariant 后版本总数不变、仅目标版本被替换、其它版本原样保留', async () => {
    /**
     * **Validates: Requirements 4.2**
     */
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        variantsArb,
        fc.nat(),
        fc.uuid(),
        async (briefId, variants, targetSeed, userId) => {
          const N = variants.length
          const targetIndex = targetSeed % N
          const targetId = variants[targetIndex].id

          // ── 每次迭代重置内存状态（避免跨迭代污染）──
          // 所有版本归属同一 brief；深拷贝入库，断言时与独立快照比较
          dbState.variants = variants.map((v) => ({ ...v, contentBriefId: briefId }))
          dbState.brief = buildBrief(briefId)
          dbState.updatedIds = []

          // 重生成前：非目标版本的独立深快照（按 id 索引）
          const beforeOthers = new Map<string, string>()
          for (const v of dbState.variants) {
            if (v.id === targetId) continue
            beforeOthers.set(v.id, JSON.stringify(v))
          }

          const result = await regenerateSingleVariant({ videoVariantId: targetId, userId })

          // (1) 版本总数仍为 N（不新增、不删除）
          expect(dbState.variants.length).toBe(N)

          // (3) 数据库 update 恰只命中目标 id 一次（仅目标行被就地更新）
          expect(dbState.updatedIds).toEqual([targetId])

          // 返回的就是目标版本（同一 id）
          expect(result.id).toBe(targetId)

          // (2) 非目标版本的 id 与内容保持不变（逐行深比较，未被触碰）
          const afterIds = dbState.variants.map((v) => v.id).sort()
          const beforeIds = variants.map((v) => v.id).sort()
          expect(afterIds).toEqual(beforeIds)

          for (const v of dbState.variants) {
            if (v.id === targetId) continue
            expect(JSON.stringify(v)).toBe(beforeOthers.get(v.id))
          }

          // 仅 v 被替换：目标行仍存在且内容已被更新（regenScope 标注单版本重生成范围）
          const targetRow = dbState.variants.find((v) => v.id === targetId)
          expect(targetRow).toBeDefined()
          expect(targetRow.regenScope).toMatchObject({ mode: 'SINGLE_VARIANT', videoVariantId: targetId })
        },
      ),
      { numRuns: 150 },
    )
  })
})
