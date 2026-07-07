/**
 * 内容评分服务 — 本地生活数据分析维度
 *
 * 在现有 metrics 基础上，增加针对本地生活的数据分析维度：
 * 1. 完播率评估（基于视频时长对标 30% 基准线）
 * 2. 信息密度评分（分析视频是否包含：地点/产品/价格/特色/行动引导 5 要素）
 * 3. 平台适配度检查（视频规格、时长、是否有 POI、是否有团购引导）
 * 4. AI 优化建议
 *
 * 数据来源：用户手动录入的平台数据（播放量、点赞、评论、团购销量）→ AI 分析出洞察
 */

// ========================
// 类型定义
// ========================

export interface ContentScoreInput {
  /** 视频时长（秒） */
  durationSec: number
  /** 平台数据 */
  metrics: {
    views: number
    likes: number
    comments: number
    shares: number
    saves: number
    orders: number
  }
  /** 视频文案/标题 */
  title?: string
  /** 分镜描述列表 */
  shotDescriptions?: string[]
  /** 目标平台 */
  platform?: string
  /** 行业 */
  industry?: string
}

export interface ContentScoreResult {
  /** 综合评分 0-100 */
  overallScore: number
  /** 评分等级 */
  grade: 'S' | 'A' | 'B' | 'C' | 'D'
  /** 各维度评分 */
  dimensions: {
    /** 完播率评估 */
    completionRate: DimensionScore
    /** 互动率评估 */
    engagementRate: DimensionScore
    /** 信息密度 */
    infoDensity: DimensionScore
    /** 平台适配度 */
    platformFit: DimensionScore
    /** 转化效率 */
    conversionRate: DimensionScore
  }
  /** AI 优化建议（最多 5 条） */
  suggestions: ScoreSuggestion[]
}

export interface DimensionScore {
  /** 评分 0-100 */
  score: number
  /** 评级 */
  level: 'excellent' | 'good' | 'average' | 'poor'
  /** 说明 */
  description: string
  /** 基准线 */
  benchmark: string
}

export interface ScoreSuggestion {
  /** 维度 */
  dimension: string
  /** 优先级 high/medium/low */
  priority: 'high' | 'medium' | 'low'
  /** 建议内容 */
  text: string
  /** 预期提升 */
  expectedImpact: string
}

// ========================
// 评分常量
// ========================

/** 完播率基准线（抖音本地生活 30%） */
const COMPLETION_RATE_BENCHMARK = 0.30
/** 互动率基准线（抖音本地生活 5%） */
const ENGAGEMENT_RATE_BENCHMARK = 0.05
/** 黄金时长范围（秒） */
const GOLDEN_DURATION = { min: 15, max: 45 }
/** 信息密度 5 要素关键词 */
const INFO_ELEMENTS = {
  location: ['店', '地址', '位置', '商圈', '地铁', '路', '街', '区', '市'],
  product: ['菜', '品', '套餐', '招牌', '特色', '推荐', '必点', '必吃', '必喝'],
  price: ['元', '¥', '￥', '价', '便宜', '划算', '优惠', '折', '团购', '套餐'],
  feature: ['手工', '现做', '新鲜', '秘制', '独家', '限定', '创意', '特别'],
  cta: ['团购', '点击', '链接', '地址', '导航', '预约', '到店', '欢迎'],
}

// ========================
// 核心评分函数
// ========================

/**
 * 计算内容综合评分
 */
export function calculateContentScore(input: ContentScoreInput): ContentScoreResult {
  const { durationSec, metrics } = input

  // 1. 完播率评估（基于时长推算预估完播率）
  const estimatedCompletionRate = estimateCompletionRate(durationSec)
  const completionScore = scoreCompletionRate(estimatedCompletionRate)

  // 2. 互动率评估
  const engagementRate = metrics.views > 0
    ? (metrics.likes + metrics.comments + metrics.shares + metrics.saves) / metrics.views
    : 0
  const engagementScore = scoreEngagementRate(engagementRate)

  // 3. 信息密度评分
  const allText = [input.title || '', ...(input.shotDescriptions || [])].join(' ')
  const infoDensityScore = scoreInfoDensity(allText)

  // 4. 平台适配度
  const platformFitScore = scorePlatformFit(durationSec, input.platform)

  // 5. 转化效率
  const conversionScore = scoreConversionRate(metrics)

  // 综合评分（加权）
  const overallScore = Math.round(
    completionScore.score * 0.25 +
    engagementScore.score * 0.25 +
    infoDensityScore.score * 0.20 +
    platformFitScore.score * 0.15 +
    conversionScore.score * 0.15
  )

  // 生成优化建议
  const suggestions = generateSuggestions({
    completion: completionScore,
    engagement: engagementScore,
    infoDensity: infoDensityScore,
    platformFit: platformFitScore,
    conversion: conversionScore,
    durationSec,
    engagementRate,
  })

  return {
    overallScore,
    grade: scoreToGrade(overallScore),
    dimensions: {
      completionRate: completionScore,
      engagementRate: engagementScore,
      infoDensity: infoDensityScore,
      platformFit: platformFitScore,
      conversionRate: conversionScore,
    },
    suggestions,
  }
}

// ========================
// 子评分函数
// ========================

/** 基于时长估算完播率 */
function estimateCompletionRate(durationSec: number): number {
  // 经验公式：时长越短完播率越高
  if (durationSec <= 15) return 0.55
  if (durationSec <= 25) return 0.40
  if (durationSec <= 35) return 0.32
  if (durationSec <= 45) return 0.25
  if (durationSec <= 60) return 0.18
  return 0.12
}

function scoreCompletionRate(rate: number): DimensionScore {
  const ratio = rate / COMPLETION_RATE_BENCHMARK
  const score = Math.min(100, Math.round(ratio * 80))

  return {
    score,
    level: score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'average' : 'poor',
    description: `预估完播率 ${(rate * 100).toFixed(0)}%（基准线 ${(COMPLETION_RATE_BENCHMARK * 100).toFixed(0)}%）`,
    benchmark: `≥${(COMPLETION_RATE_BENCHMARK * 100).toFixed(0)}%`,
  }
}

function scoreEngagementRate(rate: number): DimensionScore {
  const ratio = rate / ENGAGEMENT_RATE_BENCHMARK
  const score = Math.min(100, Math.round(ratio * 80))

  return {
    score,
    level: score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'average' : 'poor',
    description: `互动率 ${(rate * 100).toFixed(1)}%（基准线 ${(ENGAGEMENT_RATE_BENCHMARK * 100).toFixed(0)}%）`,
    benchmark: `≥${(ENGAGEMENT_RATE_BENCHMARK * 100).toFixed(0)}%`,
  }
}

function scoreInfoDensity(text: string): DimensionScore {
  if (!text) {
    return {
      score: 0,
      level: 'poor',
      description: '无文案内容可供分析',
      benchmark: '包含 5 要素中的 3+ 项',
    }
  }

  let matchedElements = 0
  const foundElements: string[] = []

  for (const [element, keywords] of Object.entries(INFO_ELEMENTS)) {
    const found = keywords.some((kw) => text.includes(kw))
    if (found) {
      matchedElements++
      foundElements.push(getElementLabel(element))
    }
  }

  const score = Math.min(100, Math.round((matchedElements / 5) * 100))

  return {
    score,
    level: score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'average' : 'poor',
    description: `信息密度 ${matchedElements}/5 要素${foundElements.length > 0 ? `（含: ${foundElements.join('、')}）` : ''}`,
    benchmark: '地点/产品/价格/特色/行动引导 5 要素',
  }
}

function scorePlatformFit(durationSec: number, platform?: string): DimensionScore {
  let score = 70 // 基础分
  const notes: string[] = []

  // 时长检查
  if (durationSec >= GOLDEN_DURATION.min && durationSec <= GOLDEN_DURATION.max) {
    score += 20
    notes.push('时长在黄金范围内')
  } else if (durationSec < GOLDEN_DURATION.min) {
    score -= 10
    notes.push(`时长偏短（${durationSec}s < ${GOLDEN_DURATION.min}s）`)
  } else if (durationSec > GOLDEN_DURATION.max + 15) {
    score -= 15
    notes.push(`时长偏长（${durationSec}s > ${GOLDEN_DURATION.max}s）`)
  }

  // 平台特定检查
  if (platform === 'douyin_local' && durationSec > 45) {
    score -= 10
    notes.push('抖音本地生活建议 ≤45s')
  }
  if (platform === 'xiaohongshu' && durationSec > 60) {
    score -= 10
    notes.push('小红书建议 ≤60s')
  }

  score = Math.max(0, Math.min(100, score))

  return {
    score,
    level: score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'average' : 'poor',
    description: notes.length > 0 ? notes.join('，') : '平台适配良好',
    benchmark: `${GOLDEN_DURATION.min}-${GOLDEN_DURATION.max}s 黄金时长`,
  }
}

function scoreConversionRate(metrics: ContentScoreInput['metrics']): DimensionScore {
  if (metrics.views === 0) {
    return {
      score: 0,
      level: 'poor',
      description: '暂无播放数据',
      benchmark: '团购转化率 > 1%',
    }
  }

  const conversionRate = metrics.orders / metrics.views
  const score = Math.min(100, Math.round(conversionRate * 5000)) // 2% = 100 分

  return {
    score,
    level: score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'average' : 'poor',
    description: `转化率 ${(conversionRate * 100).toFixed(2)}%（${metrics.orders}/${metrics.views}）`,
    benchmark: '团购转化率 > 1%',
  }
}

// ========================
// 建议生成
// ========================

function generateSuggestions(scores: {
  completion: DimensionScore
  engagement: DimensionScore
  infoDensity: DimensionScore
  platformFit: DimensionScore
  conversion: DimensionScore
  durationSec: number
  engagementRate: number
}): ScoreSuggestion[] {
  const suggestions: ScoreSuggestion[] = []

  // 完播率建议
  if (scores.completion.score < 60) {
    if (scores.durationSec > 45) {
      suggestions.push({
        dimension: '完播率',
        priority: 'high',
        text: `当前视频 ${scores.durationSec}s 偏长，建议控制在 15-45s 黄金时长范围内，提升完播率`,
        expectedImpact: '完播率提升 10-20%',
      })
    }
    suggestions.push({
      dimension: '完播率',
      priority: 'high',
      text: '黄金3秒钩子建议用动态镜头（慢动作出锅、火焰、蒸汽）开场，避免静态门头',
      expectedImpact: '完播率提升 5-15%',
    })
  }

  // 互动率建议
  if (scores.engagement.score < 60) {
    suggestions.push({
      dimension: '互动率',
      priority: 'medium',
      text: '建议在视频结尾设置互动问题（如"你最想尝哪道菜？"），引导用户评论',
      expectedImpact: '评论率提升 30-50%',
    })
  }

  // 信息密度建议
  if (scores.infoDensity.score < 60) {
    suggestions.push({
      dimension: '信息密度',
      priority: 'medium',
      text: '建议补充缺失的信息要素：地点（商圈/地址）、产品（招牌菜名）、价格（团购价）、行动引导（点击团购）',
      expectedImpact: '转化率提升 15-25%',
    })
  }

  // 平台适配建议
  if (scores.platformFit.score < 60) {
    suggestions.push({
      dimension: '平台适配',
      priority: 'medium',
      text: '发布时务必添加 POI 门店定位标签和团购链接，这是抖音本地生活的核心加权因素',
      expectedImpact: '曝光量提升 20-40%',
    })
  }

  // 转化建议
  if (scores.conversion.score < 60 && scores.conversion.score > 0) {
    suggestions.push({
      dimension: '转化效率',
      priority: 'high',
      text: '建议在视频中明确展示团购套餐内容和价格，并在评论区置顶购买链接',
      expectedImpact: '团购销量提升 20-30%',
    })
  }

  // 优秀内容的进阶建议
  if (suggestions.length === 0) {
    suggestions.push({
      dimension: '进阶优化',
      priority: 'low',
      text: '当前内容各项指标表现优秀，建议保持更新频率（每周 3-5 条），持续积累账号权重',
      expectedImpact: '长期获客成本持续降低',
    })
  }

  return suggestions.slice(0, 5)
}

// ========================
// 辅助函数
// ========================

function scoreToGrade(score: number): 'S' | 'A' | 'B' | 'C' | 'D' {
  if (score >= 90) return 'S'
  if (score >= 75) return 'A'
  if (score >= 60) return 'B'
  if (score >= 40) return 'C'
  return 'D'
}

function getElementLabel(element: string): string {
  const labels: Record<string, string> = {
    location: '地点',
    product: '产品',
    price: '价格',
    feature: '特色',
    cta: '行动引导',
  }
  return labels[element] || element
}
