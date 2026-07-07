/**
 * 平台违禁词 / 敏感词过滤
 *
 * 内置常见平台审核红线词汇，用于文案生成后的自动过滤和提示。
 *
 * 覆盖维度：
 * 1. 绝对化用语（最、第一、顶级等）
 * 2. 虚假宣传（包治百病、100% 有效等）
 * 3. 医疗/健康违规（药效宣称、未认证疗效等）
 * 4. 竞品贬低
 * 5. 政治敏感
 * 6. 其他高风险词汇
 *
 * 用法：
 * - filterSensitiveWords(text) — 检测并高亮敏感词
 * - hasSensitiveWords(text) — 快速判断是否包含敏感词
 */

// ========================
// 类型定义
// ========================

export interface SensitiveMatch {
  /** 匹配到的敏感词 */
  word: string
  /** 分类 */
  category: 'absolute' | 'false_claim' | 'medical' | 'competitor' | 'political' | 'other'
  /** 风险等级 */
  riskLevel: 'HIGH' | 'MEDIUM' | 'LOW'
  /** 替换建议 */
  suggestion: string
}

// ========================
// 违禁词库
// ========================

interface SensitiveWord {
  word: string
  category: SensitiveMatch['category']
  riskLevel: SensitiveMatch['riskLevel']
  suggestion: string
}

const SENSITIVE_WORDS: SensitiveWord[] = [
  // 绝对化用语（广告法第九条）
  { word: '最好', category: 'absolute', riskLevel: 'HIGH', suggestion: '优质' },
  { word: '最佳', category: 'absolute', riskLevel: 'HIGH', suggestion: '出色' },
  { word: '最优', category: 'absolute', riskLevel: 'HIGH', suggestion: '优选' },
  { word: '最强', category: 'absolute', riskLevel: 'HIGH', suggestion: '实力强' },
  { word: '最便宜', category: 'absolute', riskLevel: 'HIGH', suggestion: '性价比高' },
  { word: '最低价', category: 'absolute', riskLevel: 'HIGH', suggestion: '超值价' },
  { word: '第一', category: 'absolute', riskLevel: 'HIGH', suggestion: '领先' },
  { word: '唯一', category: 'absolute', riskLevel: 'HIGH', suggestion: '特色' },
  { word: '顶级', category: 'absolute', riskLevel: 'HIGH', suggestion: '高端' },
  { word: '极品', category: 'absolute', riskLevel: 'HIGH', suggestion: '精品' },
  { word: '绝对', category: 'absolute', riskLevel: 'MEDIUM', suggestion: '非常' },
  { word: '全网最低', category: 'absolute', riskLevel: 'HIGH', suggestion: '限时特惠' },
  { word: '史上最强', category: 'absolute', riskLevel: 'HIGH', suggestion: '实力派' },
  { word: '世界级', category: 'absolute', riskLevel: 'HIGH', suggestion: '高品质' },
  { word: '国家级', category: 'absolute', riskLevel: 'HIGH', suggestion: '高品质' },
  { word: '驰名', category: 'absolute', riskLevel: 'HIGH', suggestion: '知名' },
  { word: '万能', category: 'absolute', riskLevel: 'MEDIUM', suggestion: '多功能' },
  { word: '完美', category: 'absolute', riskLevel: 'MEDIUM', suggestion: '出色' },
  { word: '100%', category: 'absolute', riskLevel: 'HIGH', suggestion: '高品质' },

  // 虚假宣传
  { word: '包治百病', category: 'false_claim', riskLevel: 'HIGH', suggestion: '' },
  { word: '立竿见影', category: 'false_claim', riskLevel: 'MEDIUM', suggestion: '效果显著' },
  { word: '永久', category: 'false_claim', riskLevel: 'MEDIUM', suggestion: '持久' },
  { word: '根治', category: 'false_claim', riskLevel: 'HIGH', suggestion: '' },
  { word: '药到病除', category: 'false_claim', riskLevel: 'HIGH', suggestion: '' },
  { word: '一次见效', category: 'false_claim', riskLevel: 'MEDIUM', suggestion: '体验感好' },
  { word: '无副作用', category: 'false_claim', riskLevel: 'HIGH', suggestion: '' },
  { word: '零风险', category: 'false_claim', riskLevel: 'HIGH', suggestion: '' },
  { word: '保证效果', category: 'false_claim', riskLevel: 'HIGH', suggestion: '用心服务' },
  { word: '假一赔万', category: 'false_claim', riskLevel: 'MEDIUM', suggestion: '品质保证' },

  // 医疗/健康违规
  { word: '治疗', category: 'medical', riskLevel: 'HIGH', suggestion: '' },
  { word: '疗效', category: 'medical', riskLevel: 'HIGH', suggestion: '' },
  { word: '处方', category: 'medical', riskLevel: 'HIGH', suggestion: '' },
  { word: '药效', category: 'medical', riskLevel: 'HIGH', suggestion: '' },

  // 竞品贬低
  { word: '秒杀同行', category: 'competitor', riskLevel: 'MEDIUM', suggestion: '品质出众' },
  { word: '碾压', category: 'competitor', riskLevel: 'LOW', suggestion: '出色' },
  { word: '吊打', category: 'competitor', riskLevel: 'LOW', suggestion: '优秀' },
]

// ========================
// 过滤函数
// ========================

/**
 * 检测文本中的敏感词
 * @param text 待检测文本
 * @returns 匹配到的敏感词列表
 */
export function filterSensitiveWords(text: string): SensitiveMatch[] {
  const matches: SensitiveMatch[] = []
  const lowerText = text.toLowerCase()

  for (const sw of SENSITIVE_WORDS) {
    if (lowerText.includes(sw.word.toLowerCase())) {
      matches.push({
        word: sw.word,
        category: sw.category,
        riskLevel: sw.riskLevel,
        suggestion: sw.suggestion,
      })
    }
  }

  return matches
}

/**
 * 快速判断文本是否包含敏感词
 */
export function hasSensitiveWords(text: string): boolean {
  const lowerText = text.toLowerCase()
  return SENSITIVE_WORDS.some((sw) => lowerText.includes(sw.word.toLowerCase()))
}

/**
 * 自动替换文本中的敏感词
 * @param text 原始文本
 * @returns 替换后的文本和替换记录
 */
export function replaceSensitiveWords(text: string): {
  cleaned: string
  replacements: Array<{ original: string; replaced: string }>
} {
  let cleaned = text
  const replacements: Array<{ original: string; replaced: string }> = []

  for (const sw of SENSITIVE_WORDS) {
    if (sw.suggestion && cleaned.includes(sw.word)) {
      cleaned = cleaned.replaceAll(sw.word, sw.suggestion)
      replacements.push({ original: sw.word, replaced: sw.suggestion })
    }
  }

  return { cleaned, replacements }
}

/**
 * 获取敏感词分类统计
 */
export function getSensitiveWordStats(): Record<string, number> {
  const stats: Record<string, number> = {}
  for (const sw of SENSITIVE_WORDS) {
    stats[sw.category] = (stats[sw.category] || 0) + 1
  }
  return stats
}
