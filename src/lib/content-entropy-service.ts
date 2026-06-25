/**
 * 内容同质化检测服务
 *
 * 通过三个维度（Playbook 使用模式、文本相似度、素材序列）检测
 * 新生成内容与历史内容的重复度，避免账号因内容雷同被平台降权。
 *
 * Requirements: 13.1-13.8
 */

import {
  ENTROPY_WINDOW_DAYS,
  ENTROPY_THRESHOLDS,
  MAX_CONSECUTIVE_PLAYBOOK_USE,
} from '@/constants/merchant'
import { prisma } from '@/lib/db'
import type { EntropyResult, EntropyReason } from '@/types/merchant'

// ============ Dice Coefficient 算法 ============

/**
 * 将字符串拆分为所有连续字符对（bigram）的多重集合
 * 返回 Map<bigram, count> 以支持重复 bigram 的精确计数
 */
function getBigrams(str: string): Map<string, number> {
  const bigrams = new Map<string, number>()
  const normalized = str.toLowerCase().trim()
  for (let i = 0; i < normalized.length - 1; i++) {
    const pair = normalized.substring(i, i + 2)
    bigrams.set(pair, (bigrams.get(pair) || 0) + 1)
  }
  return bigrams
}

/**
 * 计算两个字符串的 Dice coefficient 相似度
 *
 * dice(a, b) = 2 * |intersection(bigrams(a), bigrams(b))| / (|bigrams(a)| + |bigrams(b)|)
 *
 * 返回值范围 [0, 1]，1 表示完全相同，0 表示完全不同
 */
export function diceCoefficient(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1

  const bigramsA = getBigrams(a)
  const bigramsB = getBigrams(b)

  const sizeA = Array.from(bigramsA.values()).reduce((sum, v) => sum + v, 0)
  const sizeB = Array.from(bigramsB.values()).reduce((sum, v) => sum + v, 0)

  if (sizeA === 0 || sizeB === 0) return 0

  // 计算交集大小（取每个 bigram 在两个集合中的最小出现次数）
  let intersection = 0
  for (const [bigram, countA] of bigramsA) {
    const countB = bigramsB.get(bigram) || 0
    intersection += Math.min(countA, countB)
  }

  return (2 * intersection) / (sizeA + sizeB)
}

// ============ Playbook 维度检测 (Req 13.2) ============

/**
 * 检测 Playbook 连续使用模式
 *
 * 查最近 30 天的 ContentBrief，统计当前 playbookId 连续使用次数。
 * ≥ 4 次连续使用同一 playbook → MEDIUM 风险
 */
async function checkPlaybookEntropy(
  currentBrief: { playbookId: string | null },
  historicalBriefs: { id: string; playbookId: string | null }[]
): Promise<EntropyReason[]> {
  const reasons: EntropyReason[] = []

  if (!currentBrief.playbookId) return reasons

  // 从最近到最远统计连续使用同一 playbookId 的次数
  let consecutiveCount = 0
  for (const brief of historicalBriefs) {
    if (brief.playbookId === currentBrief.playbookId) {
      consecutiveCount++
    } else {
      break
    }
  }

  // 加上当前这一次
  const totalConsecutive = consecutiveCount + 1

  // ≥ 4 次（MAX_CONSECUTIVE_PLAYBOOK_USE + 1）→ MEDIUM
  if (totalConsecutive >= MAX_CONSECUTIVE_PLAYBOOK_USE + 1) {
    reasons.push({
      dimension: 'PLAYBOOK',
      matchedContentId: historicalBriefs[0]?.id || '',
      similarityValue: totalConsecutive / (MAX_CONSECUTIVE_PLAYBOOK_USE + 1),
      description: `同一剧本连续使用 ${totalConsecutive} 次（阈值 ${MAX_CONSECUTIVE_PLAYBOOK_USE + 1} 次）`,
    })
  }

  return reasons
}

// ============ 文本维度检测 (Req 13.3) ============

/**
 * 检测文本相似度
 *
 * 使用 Dice coefficient 将当前 title/caption 与历史内容对比。
 * 任一比较相似度 ≥ 0.8 → HIGH 风险
 */
function checkTextEntropy(
  currentBrief: { title: string; suggestedCaption: string | null },
  historicalBriefs: { id: string; title: string; suggestedCaption: string | null }[]
): EntropyReason[] {
  const reasons: EntropyReason[] = []
  const threshold = ENTROPY_THRESHOLDS.textSimilarity

  for (const historical of historicalBriefs) {
    // 比较标题
    const titleSim = diceCoefficient(currentBrief.title, historical.title)
    if (titleSim >= threshold) {
      reasons.push({
        dimension: 'TEXT',
        matchedContentId: historical.id,
        similarityValue: titleSim,
        description: `标题与历史内容相似度 ${(titleSim * 100).toFixed(1)}%（阈值 ${threshold * 100}%）`,
      })
    }

    // 比较文案
    if (currentBrief.suggestedCaption && historical.suggestedCaption) {
      const captionSim = diceCoefficient(
        currentBrief.suggestedCaption,
        historical.suggestedCaption
      )
      if (captionSim >= threshold) {
        reasons.push({
          dimension: 'TEXT',
          matchedContentId: historical.id,
          similarityValue: captionSim,
          description: `文案与历史内容相似度 ${(captionSim * 100).toFixed(1)}%（阈值 ${threshold * 100}%）`,
        })
      }
    }
  }

  return reasons
}

// ============ 素材维度检测 (Req 13.4) ============

/**
 * 检测素材序列重复
 *
 * 检查当前 shotTask 序列中 rawAsset 的 ossKey 是否与历史完全一致。
 * 3+ 个连续相同素材 → MEDIUM 风险
 */
function checkShotAssetEntropy(
  currentAssetKeys: string[],
  historicalBriefAssets: { briefId: string; assetKeys: string[] }[]
): EntropyReason[] {
  const reasons: EntropyReason[] = []

  if (currentAssetKeys.length < 3) return reasons

  for (const historical of historicalBriefAssets) {
    if (historical.assetKeys.length < 3) continue

    // 对每对起始位置 (i, j) 计算连续匹配长度，找最长的
    let maxConsecutive = 0
    for (let i = 0; i < currentAssetKeys.length; i++) {
      for (let j = 0; j < historical.assetKeys.length; j++) {
        if (currentAssetKeys[i] !== historical.assetKeys[j]) continue

        // 从 (i, j) 开始计算连续匹配
        let len = 0
        while (
          i + len < currentAssetKeys.length &&
          j + len < historical.assetKeys.length &&
          currentAssetKeys[i + len] === historical.assetKeys[j + len]
        ) {
          len++
        }
        maxConsecutive = Math.max(maxConsecutive, len)
      }
    }

    if (maxConsecutive >= 3) {
      reasons.push({
        dimension: 'SHOT_ASSET',
        matchedContentId: historical.briefId,
        similarityValue: maxConsecutive / Math.max(currentAssetKeys.length, historical.assetKeys.length),
        description: `素材序列有 ${maxConsecutive} 个连续相同资源与历史内容一致（阈值 3 个）`,
      })
    }
  }

  return reasons
}

// ============ 分数计算与风险判定 ============

/**
 * 根据检测到的问题计算 uniquenessScore
 *
 * 评分逻辑：
 * - 基础分 100
 * - 每个 PLAYBOOK 维度原因扣 20 分
 * - 每个 TEXT 维度原因扣 30 分（相似度越高扣越多）
 * - 每个 SHOT_ASSET 维度原因扣 15 分
 * - 最低 0 分
 */
function calculateScore(reasons: EntropyReason[]): number {
  let score = 100

  for (const reason of reasons) {
    switch (reason.dimension) {
      case 'PLAYBOOK':
        score -= 20
        break
      case 'TEXT':
        // 文本相似度越高扣分越多
        score -= Math.round(30 * reason.similarityValue)
        break
      case 'SHOT_ASSET':
        score -= 15
        break
    }
  }

  return Math.max(0, Math.min(100, score))
}

/**
 * 根据 uniquenessScore 判定重复风险等级
 *
 * - score < 40 → HIGH（阻断生成）(Req 13.6)
 * - score 40-60 → MEDIUM（警告但允许）(Req 13.7)
 * - score > 60 → LOW（通过）
 */
function determineDuplicateRisk(score: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (score < ENTROPY_THRESHOLDS.blocked) return 'HIGH'
  if (score <= ENTROPY_THRESHOLDS.warning) return 'MEDIUM'
  return 'LOW'
}

// ============ 主函数 ============

/**
 * 计算内容同质化检测得分
 *
 * 对指定的 ContentBrief 执行三维度相似度分析，
 * 返回独特性评分和重复风险等级。
 *
 * @param input.contentBriefId - 待检测的 ContentBrief ID
 * @param input.storeId - 门店 ID（用于查询历史内容）
 */
export async function calculateContentEntropy(input: {
  contentBriefId: string
  storeId: string
}): Promise<EntropyResult> {
  const { contentBriefId, storeId } = input

  // 计算 30 天窗口的起始日期
  const windowStart = new Date()
  windowStart.setDate(windowStart.getDate() - ENTROPY_WINDOW_DAYS)

  // 查询当前 ContentBrief
  const currentBrief = await prisma.contentBrief.findUnique({
    where: { id: contentBriefId },
    include: {
      shotTasks: {
        orderBy: { order: 'asc' },
        include: {
          rawAssets: {
            select: { ossKey: true },
          },
        },
      },
    },
  })

  if (!currentBrief) {
    throw new Error(`ContentBrief ${contentBriefId} 不存在`)
  }

  // 查询历史 ContentBrief（按时间倒序，排除当前）
  const historicalBriefs = await prisma.contentBrief.findMany({
    where: {
      storeId,
      id: { not: contentBriefId },
      createdAt: { gte: windowStart },
      status: {
        in: ['GENERATED', 'COMPLIANCE_REVIEW', 'READY_TO_EXPORT', 'EXPORTED', 'PUBLISHED'],
      },
    },
    orderBy: { createdAt: 'desc' },
    include: {
      shotTasks: {
        orderBy: { order: 'asc' },
        include: {
          rawAssets: {
            select: { ossKey: true },
          },
        },
      },
    },
  })

  // Req 13.8: 历史记录 < 2 条时跳过检测，返回 score=100
  if (historicalBriefs.length < 2) {
    return {
      uniquenessScore: 100,
      duplicateRisk: 'LOW',
      reasons: [],
    }
  }

  // 三维度检测
  const allReasons: EntropyReason[] = []

  // 1. Playbook 维度 (Req 13.2)
  const playbookReasons = await checkPlaybookEntropy(
    { playbookId: currentBrief.playbookId },
    historicalBriefs.map(b => ({ id: b.id, playbookId: b.playbookId }))
  )
  allReasons.push(...playbookReasons)

  // 2. 文本维度 (Req 13.3)
  const textReasons = checkTextEntropy(
    { title: currentBrief.title, suggestedCaption: currentBrief.suggestedCaption },
    historicalBriefs.map(b => ({
      id: b.id,
      title: b.title,
      suggestedCaption: b.suggestedCaption,
    }))
  )
  allReasons.push(...textReasons)

  // 3. 素材维度 (Req 13.4)
  const currentAssetKeys = currentBrief.shotTasks
    .flatMap(st => st.rawAssets.map(a => a.ossKey))
    .filter(Boolean)

  const historicalBriefAssets = historicalBriefs.map(b => ({
    briefId: b.id,
    assetKeys: b.shotTasks
      .flatMap(st => st.rawAssets.map(a => a.ossKey))
      .filter(Boolean),
  }))

  const assetReasons = checkShotAssetEntropy(currentAssetKeys, historicalBriefAssets)
  allReasons.push(...assetReasons)

  // 计算分数和风险等级
  const uniquenessScore = calculateScore(allReasons)
  const duplicateRisk = determineDuplicateRisk(uniquenessScore)

  return {
    uniquenessScore,
    duplicateRisk,
    reasons: allReasons,
  }
}
