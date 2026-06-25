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

import { ABSOLUTE_CLAIMS, FALSE_POPULARITY } from '@/constants/merchant'
import { calculateContentEntropy } from '@/lib/content-entropy-service'
import { prisma } from '@/lib/db'
import type { ComplianceIssue, ComplianceRiskLevel } from '@/types/merchant'

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
      issues: issues as unknown as Record<string, unknown>[],
      suggestions,
      blockedReasons,
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
