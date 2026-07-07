/**
 * 集成测试共享夹具与环境门控（local-life-depth-enhancements 任务 16.x）
 *
 * 设计原则（遵循 AGENTS.md + design「Testing Strategy」）：
 * - 集成测试走真实接口与真实流程（真实 PostgreSQL/Prisma、Redis、LLM、方舟图像、Seedance、
 *   FFmpeg、OSS、SSE），绝不 mock 关键外部业务流程、绝不伪造数据。
 * - 默认 `pnpm test` 环境通常缺少真实外部凭证与 DATABASE_URL，故每个集成测试以 env 门控：
 *   缺少所需环境变量（统一开关 RUN_INTEGRATION=1 + 各依赖凭证）时显式跳过并打印跳过原因，
 *   绝不伪造通过、绝不用 mock 代替真实接口。env 齐备时执行真实端到端样例。
 * - 测试自行准备/清理最小真实数据（商家/门店/画像/brief/镜头/版本等），用真实 prisma；
 *   finally 清理临时数据与文件。
 *
 * 本文件不是测试文件（不带 .test.ts 后缀），不会被 vitest 收集，仅供各集成测试 import 复用。
 */

import 'dotenv/config'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/shared/db'

// ============================================================
// 环境门控判定
// ============================================================

/** 统一集成测试总开关：仅当显式置 1/true 时才尝试真实执行 */
export const RUN_INTEGRATION =
  process.env.RUN_INTEGRATION === '1' || process.env.RUN_INTEGRATION === 'true'

/** 是否存在某个非空环境变量 */
function hasEnv(key: string): boolean {
  const v = process.env[key]
  return typeof v === 'string' && v.trim().length > 0
}

/** 列出缺失（为空）的环境变量名 */
export function missingEnv(keys: string[]): string[] {
  return keys.filter((k) => !hasEnv(k))
}

/** LLM（文案/合规改写）凭证就绪：MERCHANT_LLM_API_KEY 或 DASHSCOPE_API_KEY 任一存在 */
export function hasLlmCredential(): boolean {
  return hasEnv('MERCHANT_LLM_API_KEY') || hasEnv('DASHSCOPE_API_KEY')
}

/** 方舟图像 / Seedance 视频凭证就绪：共用 SEEDANCE_API_KEY（同账号受信前提） */
export function hasArkCredential(): boolean {
  return hasEnv('SEEDANCE_API_KEY')
}

/** OSS 对象存储凭证就绪（上传/签名/下载真实产物所需） */
export function hasOssCredential(): boolean {
  return hasEnv('OSS_BUCKET') && hasEnv('OSS_ACCESS_KEY_ID') && hasEnv('OSS_ACCESS_KEY_SECRET')
}

/** 平台凭证加密密钥就绪（需求 7.4 凭证加密往返所需） */
export function hasCredEncKey(): boolean {
  return hasEnv('PLATFORM_CRED_ENC_KEY')
}

/**
 * 计算门控结果：所有基础条件满足才执行，否则跳过并给出清晰原因。
 *
 * @param checks 形如 [{ ok: boolean, miss: string }, ...]，ok=false 时把 miss 计入跳过原因
 * @returns { skip, reason }
 */
export function computeGate(checks: Array<{ ok: boolean; miss: string }>): {
  skip: boolean
  reason: string
} {
  const reasons: string[] = []
  if (!RUN_INTEGRATION) reasons.push('未设置 RUN_INTEGRATION=1')
  for (const c of checks) {
    if (!c.ok) reasons.push(c.miss)
  }
  return { skip: reasons.length > 0, reason: reasons.join('；') }
}

/** 在跳过时打印清晰原因（收集阶段输出，便于开发者识别为何被跳过而非失败） */
export function announceSkip(label: string, reason: string): void {
  // eslint-disable-next-line no-console
  console.warn(`[集成测试跳过] ${label}：${reason}（这是预期跳过，不是失败；齐备相应真实环境后将真实执行）`)
}

// ============================================================
// 最小真实数据夹具（真实 prisma 写入，测试结束 finally 清理）
// ============================================================

/** 一套最小商家业务实体的 ID 句柄 */
export interface MerchantFixture {
  userId: string
  merchantId: string
  storeId: string
}

/**
 * 创建最小商家业务实体链路：User → Merchant → Store(+StoreProfile)。
 *
 * 画像（StoreProfile）带 forbiddenClaims / preferredCta / hookKeywords，
 * 满足文案/合规改写服务的画像非空前置。纯真实写库。
 *
 * @param opts.creditBalance 初始积分余额（默认 1000，便于精确断言净扣减）
 */
export async function createMerchantFixture(opts?: {
  creditBalance?: number
  forbiddenClaims?: string[]
}): Promise<MerchantFixture> {
  const creditBalance = opts?.creditBalance ?? 1000
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`

  const user = await prisma.user.create({
    data: {
      email: `lldepth-integration-${suffix}@test.local`,
      passwordHash: 'integration-test-placeholder-hash',
      creditBalance,
    },
  })

  const merchant = await prisma.merchant.create({
    data: { userId: user.id, name: `集成测试商家-${suffix}`, industry: 'RESTAURANT' },
  })

  const store = await prisma.store.create({
    data: {
      merchantId: merchant.id,
      name: `集成测试门店-${suffix}`,
      industry: 'RESTAURANT',
      city: '上海',
      district: '徐汇',
      businessArea: '徐家汇',
      mainProducts: ['招牌牛肉面', '现包小笼包'],
      mainSellingPoints: ['现做现卖', '骨汤现熬8小时'],
    },
  })

  await prisma.storeProfile.create({
    data: {
      storeId: store.id,
      contentPositioning: '社区性价比家常面馆',
      recommendedPersona: '实在的面馆老板',
      visualStyle: '暖光、烟火气、手机竖屏实拍',
      hookKeywords: ['现熬骨汤', '8小时', '现包小笼', '人均30', '排队'],
      forbiddenClaims: opts?.forbiddenClaims ?? ['第一', '最好吃', '全网最低', '绝对', '国家级'],
      preferredCta: ['点击下方团购', '到店报暗号', '关注不迷路'],
    },
  })

  return { userId: user.id, merchantId: merchant.id, storeId: store.id }
}

/**
 * 清理 createMerchantFixture 及其衍生数据。
 *
 * 删除顺序：先删无外键阻塞的积分流水与门店作用域附属表，再删 Merchant（级联 Store→
 * Profile→ContentBrief→ShotTask→RawAsset→VideoVariant→ComplianceCheck→Metric），最后删 User。
 * 任一步失败仅吞掉「记录已不存在」类错误，保证清理幂等。
 */
export async function cleanupMerchantFixture(fx: MerchantFixture): Promise<void> {
  const swallow = () => {
    /* 记录可能已被级联删除，忽略 */
  }

  // 门店作用域附属表（无级联到 Store，需显式删）
  await prisma.platformAccount.deleteMany({ where: { storeId: fx.storeId } }).catch(swallow)
  await prisma.publishQueueItem.deleteMany({ where: { storeId: fx.storeId } }).catch(swallow)
  await prisma.storeNotification.deleteMany({ where: { storeId: fx.storeId } }).catch(swallow)

  // 积分流水以 userId 关联（bizRef 非外键），显式按 userId 清除
  await prisma.creditLedger.deleteMany({ where: { userId: fx.userId } }).catch(swallow)

  // 删 Merchant 级联清除 Store → Profile/ContentBrief/ShotTask/RawAsset/VideoVariant 等
  await prisma.merchant.delete({ where: { id: fx.merchantId } }).catch(swallow)

  await prisma.user.delete({ where: { id: fx.userId } }).catch(swallow)
}

/** 读取用户当前积分余额 */
export async function getUserBalance(userId: string): Promise<number> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
  return user.creditBalance
}

/** 生成确定的唯一字符串后缀，便于隔离并发用例数据 */
export function uniqueSuffix(): string {
  return randomUUID()
}
