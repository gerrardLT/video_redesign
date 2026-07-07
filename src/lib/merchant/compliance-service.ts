/**
 * 合规检查服务
 *
 * 对生成的 VideoVariant 进行内容合规检查，扫描绝对化用语、虚假火爆、
 * AIGC 标识、顾客出镜授权、内容同质化等维度，汇总风险等级并保存检查记录。
 *
 * 检查规则链按序执行：
 * 1. 绝对化用语（扫描 title/caption/coverTitle/cta/subtitles）→ HIGH
 * 2. 虚假火爆（扫描 caption/title，无证据支撑）→ MEDIUM
 * 3. AIGC 标识（检查 renderParams/generationLog 含 Seedance 记录）→ MEDIUM
 * 4. 顾客出镜（CUSTOMER_REACTION 镜头 + 无 ConsentRecord）→ HIGH
 * 5. 同质化（调用 content-entropy-service，score<40=BLOCKED, <60=MEDIUM）
 *
 * Requirements: 9.1-9.10
 */

import { randomUUID } from 'crypto'
import { ABSOLUTE_CLAIMS, FALSE_POPULARITY } from '@/constants/merchant'
import { ApiError } from '@/lib/shared/api-error'
import { calculateContentEntropy } from './content-entropy-service'
import { getBalance } from '@/lib/shared/credit-service'
import { prisma } from '@/lib/shared/db'
import { Prisma } from '@/generated/prisma'
import {
  reserveMerchantCredits,
  chargeMerchantCredits,
  refundMerchantCredits,
} from './merchant-billing-service'
import type { ComplianceIssue, ComplianceRiskLevel, PlatformCopy } from '@/types/merchant'

// ============ 类型定义 ============

/** 字幕条目（从 VideoVariant.subtitles JSON 中解析） */
interface SubtitleEntry {
  text: string
  startSec: number
  endSec: number
}

/** 合规检查返回结果（对应 Prisma ComplianceCheck 模型） */
interface ComplianceCheck {
  id: string
  contentBriefId: string
  videoVariantId: string | null
  riskLevel: ComplianceRiskLevel
  issues: ComplianceIssue[]
  suggestions: string[] | null
  blockedReasons: string[] | null
  passed: boolean
  acknowledgedAt: Date | null
  createdAt: Date
}

// ============ 风险等级优先级 ============

const RISK_PRIORITY: Record<ComplianceRiskLevel, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  BLOCKED: 3,
}

// ============ 主入口 ============

/**
 * 执行合规检查
 *
 * 按规则链顺序对 VideoVariant 及其关联的 ContentBrief 进行合规扫描，
 * 汇总所有问题后确定整体风险等级，保存 ComplianceCheck 记录到数据库。
 *
 * @param input.contentBriefId 内容任务 ID
 * @param input.videoVariantId 视频版本 ID
 * @returns 保存后的 ComplianceCheck 记录
 */
export async function runComplianceCheck(input: {
  contentBriefId: string
  videoVariantId: string
}): Promise<ComplianceCheck> {
  const { contentBriefId, videoVariantId } = input

  // 查询 VideoVariant + ContentBrief + ShotTasks + Store 信息
  const videoVariant = await prisma.videoVariant.findUniqueOrThrow({
    where: { id: videoVariantId },
    include: {
      contentBrief: {
        include: {
          store: true,
          shotTasks: {
            include: {
              rawAssets: true,
            },
          },
        },
      },
    },
  })

  const contentBrief = videoVariant.contentBrief
  const store = contentBrief.store

  // 收集所有合规问题
  const issues: ComplianceIssue[] = []

  // ── 规则 1: 绝对化用语检查 ──
  const absoluteClaimIssues = checkAbsoluteClaims(contentBrief, videoVariant)
  issues.push(...absoluteClaimIssues)

  // ── 规则 2: 虚假火爆检查 ──
  const falsePopularityIssues = await checkFalsePopularity(contentBrief, store.id)
  issues.push(...falsePopularityIssues)

  // ── 规则 3: AIGC 标识检查 ──
  const aigcIssues = checkAigcDisclosure(videoVariant)
  issues.push(...aigcIssues)

  // ── 规则 4: 顾客出镜授权检查 ──
  const consentIssues = await checkCustomerConsent(contentBrief, store)
  issues.push(...consentIssues)

  // ── 规则 5: 同质化检查 ──
  const entropyIssues = await checkContentEntropy(contentBriefId, store.id)
  issues.push(...entropyIssues)

  // ── 汇总风险等级 (Req 9.9) ──
  const riskLevel = determineOverallRiskLevel(issues)
  const passed = riskLevel === 'LOW'
  const blockedReasons = riskLevel === 'BLOCKED'
    ? issues
        .filter((i) => i.riskLevel === 'BLOCKED')
        .map((i) => i.reason)
    : null

  // 生成修复建议
  const suggestions = generateSuggestions(issues)

  // 保存到数据库
  const record = await prisma.complianceCheck.create({
    data: {
      contentBriefId,
      videoVariantId,
      riskLevel,
      issues: issues as unknown as Prisma.InputJsonValue,
      suggestions,
      blockedReasons: blockedReasons === null
        ? Prisma.JsonNull
        : (blockedReasons as unknown as Prisma.InputJsonValue),
      passed,
    },
  })

  return {
    id: record.id,
    contentBriefId: record.contentBriefId,
    videoVariantId: record.videoVariantId,
    riskLevel: record.riskLevel as ComplianceRiskLevel,
    issues,
    suggestions,
    blockedReasons,
    passed: record.passed,
    acknowledgedAt: record.acknowledgedAt,
    createdAt: record.createdAt,
  }
}

// ============ 规则 1: 绝对化用语 ============

/**
 * 扫描 title, caption, coverTitle, cta, subtitles 中的绝对化用语
 */
function checkAbsoluteClaims(
  contentBrief: { suggestedTitle: string | null; suggestedCaption: string | null; suggestedCoverTitle: string | null; suggestedCta: string | null },
  videoVariant: { subtitles: unknown },
): ComplianceIssue[] {
  const issues: ComplianceIssue[] = []

  // 待扫描的字段映射
  const textFields: Array<{ field: string; text: string | null }> = [
    { field: 'title', text: contentBrief.suggestedTitle },
    { field: 'caption', text: contentBrief.suggestedCaption },
    { field: 'coverTitle', text: contentBrief.suggestedCoverTitle },
    { field: 'cta', text: contentBrief.suggestedCta },
  ]

  // 提取字幕文本
  const subtitlesText = extractSubtitlesText(videoVariant.subtitles)
  if (subtitlesText) {
    textFields.push({ field: 'subtitles', text: subtitlesText })
  }

  for (const { field, text } of textFields) {
    if (!text) continue
    for (const claim of ABSOLUTE_CLAIMS) {
      if (text.includes(claim)) {
        issues.push({
          dimension: 'ABSOLUTE_CLAIM',
          riskLevel: 'HIGH',
          field,
          matchedText: claim,
          reason: `文本中包含绝对化用语「${claim}」，违反广告法相关规定`,
        })
      }
    }
  }

  return issues
}

// ============ 规则 2: 虚假火爆 ============

/**
 * 扫描 caption, title 中的虚假火爆用语，
 * 仅在无证据支撑时标记为 MEDIUM 风险。
 *
 * 证据支撑定义：
 * - 关联 RawAsset type=CUSTOMER_REACTION
 * - 或同门店 30 天内有 PublishMetric views >= 10000
 */
async function checkFalsePopularity(
  contentBrief: {
    id: string
    suggestedTitle: string | null
    suggestedCaption: string | null
    shotTasks: Array<{ rawAssets: Array<{ type: string }> }>
  },
  storeId: string,
): Promise<ComplianceIssue[]> {
  const issues: ComplianceIssue[] = []

  const textFields: Array<{ field: string; text: string | null }> = [
    { field: 'caption', text: contentBrief.suggestedCaption },
    { field: 'title', text: contentBrief.suggestedTitle },
  ]

  // 收集所有匹配到的虚假火爆词
  const matches: Array<{ field: string; claim: string }> = []
  for (const { field, text } of textFields) {
    if (!text) continue
    for (const claim of FALSE_POPULARITY) {
      if (text.includes(claim)) {
        matches.push({ field, claim })
      }
    }
  }

  if (matches.length === 0) return issues

  // 检查是否有证据支撑
  const hasEvidence = await checkPopularityEvidence(contentBrief, storeId)

  // 有证据支撑则不标记
  if (hasEvidence) return issues

  for (const { field, claim } of matches) {
    issues.push({
      dimension: 'FALSE_POPULARITY',
      riskLevel: 'MEDIUM',
      field,
      matchedText: claim,
      reason: `文本中包含虚假火爆用语「${claim}」且无数据证据支撑`,
    })
  }

  return issues
}

/**
 * 检查虚假火爆的证据支撑
 *
 * 证据支撑条件（满足任一即可）：
 * 1. 同 ContentBrief 的 ShotTask 有 type=CUSTOMER_REACTION 的 RawAsset
 * 2. 同门店 30 天内有 PublishMetric views >= 10000
 */
async function checkPopularityEvidence(
  contentBrief: {
    shotTasks: Array<{ rawAssets: Array<{ type: string }> }>
  },
  storeId: string,
): Promise<boolean> {
  // 条件 1: 检查是否有 CUSTOMER_REACTION 类型的 RawAsset
  const hasCustomerReaction = contentBrief.shotTasks.some((task) =>
    task.rawAssets.some((asset) => asset.type === 'CUSTOMER_REACTION'),
  )
  if (hasCustomerReaction) return true

  // 条件 2: 检查同门店 30 天内是否有 views >= 10000 的 PublishMetric
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const highViewMetric = await prisma.publishMetric.findFirst({
    where: {
      contentBrief: { storeId },
      views: { gte: 10000 },
      capturedAt: { gte: thirtyDaysAgo },
    },
  })

  return highViewMetric !== null
}

// ============ 规则 3: AIGC 标识 ============

/**
 * 检查 renderParams 和 generationLog 中是否包含 Seedance 生成记录，
 * 如有则标记需要 AIGC 标识声明。
 */
function checkAigcDisclosure(
  videoVariant: { renderParams: unknown; generationLog: unknown },
): ComplianceIssue[] {
  const issues: ComplianceIssue[] = []

  const hasSeedanceInRenderParams = containsSeedanceReference(videoVariant.renderParams)
  const hasSeedanceInGenerationLog = containsSeedanceReference(videoVariant.generationLog)

  if (hasSeedanceInRenderParams) {
    issues.push({
      dimension: 'AIGC',
      riskLevel: 'MEDIUM',
      field: 'renderParams',
      reason: '视频包含 Seedance AI 生成内容，需添加 AIGC 标识声明',
    })
  }

  if (hasSeedanceInGenerationLog) {
    issues.push({
      dimension: 'AIGC',
      riskLevel: 'MEDIUM',
      field: 'generationLog',
      reason: '视频包含 Seedance AI 生成记录，需添加 AIGC 标识声明',
    })
  }

  return issues
}

/**
 * 递归检查 JSON 数据中是否包含 Seedance 相关引用
 */
function containsSeedanceReference(data: unknown): boolean {
  if (data === null || data === undefined) return false

  if (typeof data === 'string') {
    const lower = data.toLowerCase()
    return lower.includes('seedance')
  }

  if (Array.isArray(data)) {
    return data.some((item) => containsSeedanceReference(item))
  }

  if (typeof data === 'object') {
    return Object.values(data as Record<string, unknown>).some((value) =>
      containsSeedanceReference(value),
    )
  }

  return false
}

// ============ 规则 4: 顾客出镜授权 ============

/**
 * 检查 CUSTOMER_REACTION 类型镜头是否有对应的出镜授权记录。
 * 仅当门店 canShootCustomers=false 或无有效 ConsentRecord 时标记为 HIGH。
 */
async function checkCustomerConsent(
  contentBrief: {
    shotTasks: Array<{ type: string; rawAssets: Array<{ type: string }> }>
  },
  store: { id: string; canShootCustomers: boolean },
): Promise<ComplianceIssue[]> {
  const issues: ComplianceIssue[] = []

  // 检查是否有 CUSTOMER_REACTION 类型的 ShotTask
  const customerReactionTasks = contentBrief.shotTasks.filter(
    (task) => task.type === 'CUSTOMER_REACTION',
  )

  if (customerReactionTasks.length === 0) return issues

  // 如果门店已设置 canShootCustomers=true，需确认有有效 ConsentRecord
  // 如果 canShootCustomers=false，则直接标记为风险
  // 无论 canShootCustomers 如何，都需要有效的 ConsentRecord
  const now = new Date()

  const validConsent = await prisma.consentRecord.findFirst({
    where: {
      storeId: store.id,
      OR: [
        { validTo: null },         // 永久有效
        { validTo: { gt: now } },  // 未过期
      ],
    },
  })

  if (!validConsent) {
    issues.push({
      dimension: 'CONSENT',
      riskLevel: 'HIGH',
      field: 'shotTask.CUSTOMER_REACTION',
      reason: '视频包含顾客出镜镜头但未找到有效的出镜授权记录，需获取顾客授权',
    })
  }

  return issues
}

// ============ 规则 5: 同质化检查 ============

/**
 * 调用 content-entropy-service 检测内容同质化程度。
 * score < 40 → BLOCKED，score < 60 → MEDIUM
 */
async function checkContentEntropy(
  contentBriefId: string,
  storeId: string,
): Promise<ComplianceIssue[]> {
  const issues: ComplianceIssue[] = []

  const result = await calculateContentEntropy({ contentBriefId, storeId })

  if (result.uniquenessScore < 40) {
    issues.push({
      dimension: 'ENTROPY',
      riskLevel: 'BLOCKED',
      field: 'content',
      reason: `内容独特性评分过低（${result.uniquenessScore}/100），与历史内容高度重复，无法发布`,
    })
  } else if (result.uniquenessScore < 60) {
    issues.push({
      dimension: 'ENTROPY',
      riskLevel: 'MEDIUM',
      field: 'content',
      reason: `内容独特性评分较低（${result.uniquenessScore}/100），建议调整内容结构或文案以降低重复度`,
    })
  }

  return issues
}

// ============ 辅助函数 ============

/**
 * 从 VideoVariant.subtitles JSON 中提取全部字幕文本拼接为单个字符串
 */
function extractSubtitlesText(subtitles: unknown): string | null {
  if (!subtitles || !Array.isArray(subtitles)) return null

  const texts = (subtitles as SubtitleEntry[])
    .map((s) => s.text)
    .filter(Boolean)

  return texts.length > 0 ? texts.join(' ') : null
}

/**
 * 根据所有 issues 确定整体风险等级 (Req 9.9)
 * 取最高等级：BLOCKED > HIGH > MEDIUM > LOW
 * 无 issues 时默认 LOW
 */
function determineOverallRiskLevel(issues: ComplianceIssue[]): ComplianceRiskLevel {
  if (issues.length === 0) return 'LOW'

  let maxPriority = 0
  let maxLevel: ComplianceRiskLevel = 'LOW'

  for (const issue of issues) {
    const priority = RISK_PRIORITY[issue.riskLevel]
    if (priority > maxPriority) {
      maxPriority = priority
      maxLevel = issue.riskLevel
    }
  }

  return maxLevel
}

/**
 * 根据问题列表生成修复建议
 */
function generateSuggestions(issues: ComplianceIssue[]): string[] {
  const suggestions: string[] = []
  const dimensions = new Set(issues.map((i) => i.dimension))

  if (dimensions.has('ABSOLUTE_CLAIM')) {
    suggestions.push('请移除或替换绝对化用语，改用「优质」「精选」「人气」等合规表达')
  }

  if (dimensions.has('FALSE_POPULARITY')) {
    suggestions.push('虚假火爆描述需有数据支撑（如平台截图、实际播放量），否则请替换为客观描述')
  }

  if (dimensions.has('AIGC')) {
    suggestions.push('请在视频中添加「本视频含 AI 生成内容」的 AIGC 标识声明')
  }

  if (dimensions.has('CONSENT')) {
    suggestions.push('请上传顾客出镜授权书或移除顾客出镜画面')
  }

  if (dimensions.has('ENTROPY')) {
    suggestions.push('建议更换剧本模板、调整文案风格或使用新素材以提高内容独特性')
  }

  return suggestions
}

// ============================================================
// 一键改写规避 + 自动重跑合规（需求 2.5, 2.6, 2.7, 0.6, 0.7, 0.8）
// ============================================================

/**
 * 一键改写规避的固定积分单价（一次 AI 文案改写动作）。
 *
 * 与内容计划生成（CREDIT_COST_CONTENT_PLAN）同属「单次外部推理」固定单价计费，
 * 取值较轻（仅一次针对性改写调用，非整条内容生成）。走 RESERVE→CHARGE/REFUND 流程。
 */
const CREDIT_COST_COMPLIANCE_REWRITE = 5

/** 计费实体关联类型固定为内容任务（无 jobId，恒走 bizRefType/bizRefId） */
const COMPLIANCE_REWRITE_BIZ_REF_TYPE = 'CONTENT_BRIEF' as const

// ───── 改写用 LLM 配置（OpenAI 兼容接口，与发布文案服务同源；缺失直接抛错，禁止 fallback）─────

/** 改写 LLM API 基址（阿里云百炼 DashScope OpenAI 兼容接口） */
const REWRITE_LLM_API_URL = process.env.MERCHANT_LLM_API_URL
  || (process.env.DASHSCOPE_API_KEY
    ? 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    : '')

/** 改写 LLM API 密钥 */
const REWRITE_LLM_API_KEY = process.env.MERCHANT_LLM_API_KEY
  || process.env.DASHSCOPE_API_KEY
  || ''

/** 改写 LLM 模型名称（默认 qwen-plus） */
const REWRITE_LLM_MODEL = process.env.MERCHANT_LLM_MODEL || 'qwen-plus'

/**
 * 一键改写规避（需求 2.5, 2.6, 2.7）
 *
 * 流程：
 * 1) 读取该 (contentBriefId, videoVariantId) 最近一次 ComplianceCheck 命中的违禁词/风险点
 *    (evidence)；若尚无检查记录则先跑一次以建立 evidence 基线。
 * 2) 调用文案生成（真实 LLM）针对命中的违禁表达产出去违禁的合规候选文案，并写回
 *    ContentBrief 的 suggested* 字段与 tags（合规检查扫描的就是这些字段）。
 * 3) 用改写后的文案自动重新跑一次 runComplianceCheck（可反哺）。
 * 4) 若重跑结果仍为 HIGH/BLOCKED，则 stillBlocked=true 显式返回剩余风险点，绝不标记通过。
 *
 * 计费：消耗积分，复用既有 credit-service + merchant-billing-service（reserve→charge/refund）
 * 与 withCreditLock 全局锁；执行前先做余额预检，余额不足在预检阶段显式拒绝（不先扣后退）。
 *
 * 说明：本动作改写的是 brief 级 suggested* 草稿文案（合规检查的扫描对象），
 * 与 saveManualCopy 写入的 platformCopies「人工修改」内容相互独立，不会静默覆盖人工文案。
 *
 * @throws ApiError('INSUFFICIENT_CREDITS', 402) 余额不足时在预检阶段拒绝
 * @throws Error LLM 配置缺失 / 改写生成失败 / 数据缺失时（不伪造、不 fallback）
 */
export async function rewriteToCompliant(input: {
  contentBriefId: string
  videoVariantId: string
  userId: string
}): Promise<{
  rewrittenCopy: PlatformCopy
  recheck: ComplianceCheck
  stillBlocked: boolean
}> {
  const { contentBriefId, videoVariantId, userId } = input

  // LLM 配置预检：缺失直接抛错（遵循 AGENTS.md「环境变量缺失直接抛错」，禁止 fallback）
  if (!REWRITE_LLM_API_URL || !REWRITE_LLM_API_KEY) {
    throw new Error('[compliance-rewrite] LLM 配置缺失：MERCHANT_LLM_API_URL 或 MERCHANT_LLM_API_KEY / DASHSCOPE_API_KEY 未设置')
  }

  // 加载内容任务（取当前 suggested* 草稿文案 + tags 作为改写输入）
  const brief = await prisma.contentBrief.findUniqueOrThrow({
    where: { id: contentBriefId },
  })

  // ── 步骤 1：读取最近一次合规检查命中的违禁词/风险点（evidence）──
  // 若尚无检查记录，先跑一次以建立 evidence 基线（不计费，仅用于读取证据）。
  let latestCheck = await prisma.complianceCheck.findFirst({
    where: { contentBriefId, videoVariantId },
    orderBy: { createdAt: 'desc' },
  })
  if (!latestCheck) {
    await runComplianceCheck({ contentBriefId, videoVariantId })
    latestCheck = await prisma.complianceCheck.findFirst({
      where: { contentBriefId, videoVariantId },
      orderBy: { createdAt: 'desc' },
    })
  }
  const priorIssues = ((latestCheck?.issues ?? []) as unknown as ComplianceIssue[]) || []

  // 收集命中的违禁/风险表达（evidence）：优先取 matchedText，否则取 reason 作为规避指引
  const avoidExpressions = Array.from(
    new Set(
      priorIssues
        .map((issue) => issue.matchedText)
        .filter((t): t is string => typeof t === 'string' && t.length > 0),
    ),
  )
  const riskReasons = priorIssues.map((issue) => issue.reason).filter(Boolean)

  // ── 步骤 2 前置：余额预检（余额不足在 reserve 前显式拒绝，禁止先扣后退）──
  const balance = await getBalance(userId)
  if (balance < CREDIT_COST_COMPLIANCE_REWRITE) {
    throw new ApiError(
      'INSUFFICIENT_CREDITS',
      `积分不足：一键改写规避需 ${CREDIT_COST_COMPLIANCE_REWRITE} 积分，当前余额 ${balance}`,
      402,
    )
  }

  // 计费关联键：使用「brief + 一键改写 + 唯一后缀」组成，避免与该 brief 的渲染/导出计费
  // （以 briefId 为关联键）发生 RESERVE 幂等冲突，保证本次改写独立冻结/扣费/退款。
  const bizRefId = `${contentBriefId}:compliance-rewrite:${randomUUID()}`

  // ── 冻结积分（RESERVE，经 credit-service + withCreditLock 全局锁串行化）──
  await reserveMerchantCredits({
    userId,
    bizRefType: COMPLIANCE_REWRITE_BIZ_REF_TYPE,
    bizRefId,
    amount: CREDIT_COST_COMPLIANCE_REWRITE,
    remark: `[COMPLIANCE_REWRITE] 一键改写规避冻结 ${CREDIT_COST_COMPLIANCE_REWRITE} 积分`,
  })

  try {
    // ── 步骤 2：调用真实 LLM 产出去违禁的合规候选文案 ──
    const currentCopy: PlatformCopy = {
      title: brief.suggestedTitle ?? '',
      coverTitle: brief.suggestedCoverTitle ?? '',
      caption: brief.suggestedCaption ?? '',
      tags: Array.isArray(brief.tags) ? (brief.tags as unknown[]).map(String) : [],
      cta: brief.suggestedCta ?? '',
    }

    const rewrittenCopy = await generateCompliantCopy({
      currentCopy,
      avoidExpressions,
      riskReasons,
    })

    // 写回 brief 的 suggested* 字段与 tags（合规检查扫描的就是这些字段，使重跑作用于新文案）
    await prisma.contentBrief.update({
      where: { id: contentBriefId },
      data: {
        suggestedTitle: rewrittenCopy.title,
        suggestedCoverTitle: rewrittenCopy.coverTitle,
        suggestedCaption: rewrittenCopy.caption,
        suggestedCta: rewrittenCopy.cta,
        tags: rewrittenCopy.tags as unknown as object,
      },
    })

    // ── 步骤 3：用改写后的文案自动重新跑一次合规检查（可反哺）──
    const recheck = await runComplianceCheck({ contentBriefId, videoVariantId })

    // ── 步骤 4：仍为 HIGH/BLOCKED 时 stillBlocked=true，显式返回剩余风险，绝不标记通过 ──
    const stillBlocked = recheck.riskLevel === 'HIGH' || recheck.riskLevel === 'BLOCKED'

    // 动作已真实消耗外部推理并完成重跑 → 正式扣费（CHARGE）。
    // 注意：stillBlocked 不影响计费——改写动作本身已执行，仅内容尚未合规（如实返回剩余风险）。
    await prisma.$transaction(async (tx) => {
      await chargeMerchantCredits(tx, {
        userId,
        bizRefType: COMPLIANCE_REWRITE_BIZ_REF_TYPE,
        bizRefId,
        actualAmount: CREDIT_COST_COMPLIANCE_REWRITE,
      })
    })

    return { rewrittenCopy, recheck, stillBlocked }
  } catch (error) {
    // 改写生成 / 重跑失败：幂等退还本次冻结积分（REFUND），余额恢复至冻结前
    await refundMerchantCredits({
      userId,
      bizRefType: COMPLIANCE_REWRITE_BIZ_REF_TYPE,
      bizRefId,
    })
    throw error
  }
}

/**
 * 调用真实 LLM 产出去违禁的合规候选文案。
 *
 * 输入当前文案 + 命中的违禁/风险表达（evidence），要求模型在保留原意与卖点的前提下
 * 改写并去除这些表达，输出严格 JSON 的 PlatformCopy。生成失败 / 解析失败直接抛错，
 * 不返回部分结果、不伪造（遵循「真实接口、无 fallback」）。
 */
async function generateCompliantCopy(input: {
  currentCopy: PlatformCopy
  avoidExpressions: string[]
  riskReasons: string[]
}): Promise<PlatformCopy> {
  const { currentCopy, avoidExpressions, riskReasons } = input

  const avoidList = avoidExpressions.length > 0 ? avoidExpressions.join('、') : '（无具体命中词，请按风险原因规避）'
  const reasonList = riskReasons.length > 0 ? riskReasons.map((r) => `- ${r}`).join('\n') : '- （无）'

  const systemPrompt = `你是一位精通广告法与平台合规的本地生活短视频文案编辑。你的任务是改写下方文案，
去除其中的违禁/高风险表达，同时尽量保留原文的核心卖点、信息与吸引力。

## 必须去除或替换的表达（违禁词/风险点）
${avoidList}

## 合规风险原因（改写时需规避）
${reasonList}

## 改写要求
- 不得使用绝对化用语（如「最」「第一」「顶级」等）与无证据支撑的虚假火爆表达。
- 保留门店真实卖点，用合规、客观、口语化的表达替换违规措辞。
- 标题最多 30 字符，封面文字最多 15 字符；标签 3-10 个、纯文本不带 # 号。

## 输出要求
严格按以下 JSON 格式输出，不要输出任何额外内容：
{
  "title": "标题，最多30字符",
  "coverTitle": "封面文字，最多15字符",
  "caption": "正文文案",
  "tags": ["标签1", "标签2", "..."],
  "cta": "行动号召文本"
}`

  const userPrompt = `## 待改写文案（去除违禁表达后输出合规版本）
- 标题：${currentCopy.title || '（空）'}
- 封面文字：${currentCopy.coverTitle || '（空）'}
- 正文：${currentCopy.caption || '（空）'}
- 标签：${currentCopy.tags.length > 0 ? currentCopy.tags.join('、') : '（空）'}
- 行动号召：${currentCopy.cta || '（空）'}

请输出去除上述违禁/风险表达后的合规文案 JSON。`

  const response = await fetch(`${REWRITE_LLM_API_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${REWRITE_LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: REWRITE_LLM_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.5,
      max_tokens: 2000,
    }),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`[compliance-rewrite] LLM 调用失败: HTTP ${response.status}, body=${errText}`)
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = data.choices?.[0]?.message?.content?.trim()
  if (!content) {
    throw new Error('[compliance-rewrite] LLM 返回空内容')
  }

  const parsed = parseRewriteResponse(content)
  if (!parsed) {
    throw new Error(`[compliance-rewrite] LLM 输出解析失败: ${content.slice(0, 200)}`)
  }

  return parsed
}

/**
 * 解析改写 LLM 返回的 JSON 文案内容（兼容 markdown code block 与纯 JSON）。
 * 字段不完整时返回 null，由调用方抛错（不伪造、不补默认值）。
 */
function parseRewriteResponse(content: string): PlatformCopy | null {
  try {
    const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
    const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : content.trim()
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>

    if (
      typeof parsed.title !== 'string' ||
      typeof parsed.coverTitle !== 'string' ||
      typeof parsed.caption !== 'string' ||
      !Array.isArray(parsed.tags) ||
      typeof parsed.cta !== 'string'
    ) {
      return null
    }

    return {
      title: String(parsed.title),
      coverTitle: String(parsed.coverTitle),
      caption: String(parsed.caption),
      tags: (parsed.tags as unknown[]).map(String),
      cta: String(parsed.cta),
    }
  } catch {
    return null
  }
}
