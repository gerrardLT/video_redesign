/**
 * AI 文案与标签生成器
 *
 * 基于视频内容（分镜脚本摘要）+ 门店画像 + 目标平台，调用 AI 生成：
 * - 发布标题（含黄金3秒文案、地域标签、品类关键词）
 * - 正文文案（适配抖音/小红书不同风格）
 * - 推荐话题标签（#城市美食探店 #品类 #商圈名）
 * - 封面文案建议
 *
 * 生成后自动通过敏感词检测过滤。
 *
 * LLM 配置：复用 playbook-engine 的环境变量链路
 * （MERCHANT_LLM_API_URL → VISION_API_URL，MERCHANT_LLM_API_KEY → VISION_API_KEY）
 */

import { filterSensitiveWords, replaceSensitiveWords, type SensitiveMatch } from './sensitive-words'
import type { PlatformId } from './platform-presets'

// ========================
// LLM 配置
// ========================

const LLM_API_URL = process.env.MERCHANT_LLM_API_URL
  || process.env.VISION_API_URL
  || ''

const LLM_API_KEY = process.env.MERCHANT_LLM_API_KEY
  || process.env.DASHSCOPE_API_KEY
  || process.env.VISION_API_KEY
  || ''

const LLM_MODEL = process.env.MERCHANT_LLM_MODEL || 'qwen-plus'

// ========================
// 类型定义
// ========================

export interface CopyGenerationInput {
  /** 视频内容摘要（分镜脚本简述 / brief 标题等） */
  contentSummary: string
  /** 门店行业 */
  industry: string
  /** 门店名称 */
  storeName?: string
  /** 城市 */
  city?: string
  /** 主打产品 */
  mainProducts?: string[]
  /** 核心卖点 */
  mainSellingPoints?: string[]
  /** 目标平台 */
  platform: PlatformId
  /** 品牌调性 */
  brandTone?: string
}

export interface GeneratedCopy {
  /** 发布标题 */
  title: string
  /** 封面文字 */
  coverTitle: string
  /** 正文文案 */
  caption: string
  /** 推荐话题标签（不含 #） */
  tags: string[]
  /** 引导语 */
  cta: string
  /** 敏感词检测结果 */
  sensitiveCheck: {
    passed: boolean
    issues: SensitiveMatch[]
    /** 自动清理后的版本（如有敏感词） */
    cleanedTitle?: string
    cleanedCaption?: string
  }
}

// ========================
// 平台风格配置
// ========================

const PLATFORM_STYLE: Record<PlatformId, { tone: string; maxLength: number; tagCount: number }> = {
  douyin_local: {
    tone: '口语化、有冲击力、适合抖音推荐算法，多用emoji和感叹号，突出地域+品类+价格',
    maxLength: 200,
    tagCount: 5,
  },
  xiaohongshu: {
    tone: '真实感、分享式口吻、适合小红书种草风格，用"姐妹们""真的绝了"等自然表达',
    maxLength: 500,
    tagCount: 8,
  },
  wechat_video: {
    tone: '温馨、正能量、适合微信社交传播，语言朴实真诚',
    maxLength: 300,
    tagCount: 3,
  },
  universal: {
    tone: '通用营销风格，平衡信息密度和可读性',
    maxLength: 300,
    tagCount: 5,
  },
}

// ========================
// 核心生成函数
// ========================

/**
 * 生成平台适配的发布文案
 */
export async function generateCopy(input: CopyGenerationInput): Promise<GeneratedCopy> {
  if (!LLM_API_KEY || !LLM_API_URL) {
    throw new Error('文案生成 API 未配置（需要 MERCHANT_LLM_API_KEY 或 VISION_API_KEY）')
  }

  const platformStyle = PLATFORM_STYLE[input.platform]
  const platformLabel = getPlatformLabel(input.platform)

  // 构建 prompt
  const systemPrompt = `你是一个专业的本地生活短视频文案策划师。你的任务是为实体商家生成适配${platformLabel}平台的发布文案。

要求：
- 风格：${platformStyle.tone}
- 标题：控制在 20 字以内，包含品类关键词和地域标签，有吸引力
- 封面文字：6-10 字，信息密度高，一眼看懂
- 正文：控制在 ${platformStyle.maxLength} 字以内
- 话题标签：${platformStyle.tagCount} 个，包含 #城市+品类、#品类探店、#商圈名 等
- 引导语：1 句，引导用户点击团购/到店
- 禁止使用绝对化用语（最好、第一、顶级等）
- 禁止虚假宣传（保证效果、100% 等）
- 输出格式：严格按 JSON 格式输出`

  const userPrompt = `请为以下门店视频生成${platformLabel}发布文案：

门店信息：
- 行业：${input.industry}
- 门店名：${input.storeName || '未提供'}
- 城市：${input.city || '未提供'}
- 主打产品：${input.mainProducts?.join('、') || '未提供'}
- 核心卖点：${input.mainSellingPoints?.join('、') || '未提供'}
- 品牌调性：${input.brandTone || '未提供'}

视频内容摘要：
${input.contentSummary}

请按以下 JSON 格式输出：
{
  "title": "发布标题（20字以内）",
  "coverTitle": "封面文字（6-10字）",
  "caption": "正文文案",
  "tags": ["标签1", "标签2", "..."],
  "cta": "引导语"
}`

  // 调用 LLM
  const apiUrl = buildChatUrl(LLM_API_URL)
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LLM_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 1024,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`文案生成 API 调用失败 (HTTP ${response.status}): ${errorText}`)
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string | null } }>
  }
  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('文案生成 API 返回内容为空')
  }

  // 解析 JSON
  const jsonStr = extractJson(content)
  const parsed = JSON.parse(jsonStr) as {
    title: string
    coverTitle: string
    caption: string
    tags: string[]
    cta: string
  }

  // 敏感词检测
  const allText = `${parsed.title} ${parsed.coverTitle} ${parsed.caption} ${parsed.cta}`
  const issues = filterSensitiveWords(allText)
  const passed = issues.length === 0

  let cleanedTitle: string | undefined
  let cleanedCaption: string | undefined

  if (!passed) {
    const titleResult = replaceSensitiveWords(parsed.title)
    const captionResult = replaceSensitiveWords(parsed.caption)
    cleanedTitle = titleResult.cleaned
    cleanedCaption = captionResult.cleaned
  }

  return {
    title: cleanedTitle || parsed.title,
    coverTitle: parsed.coverTitle,
    caption: cleanedCaption || parsed.caption,
    tags: parsed.tags || [],
    cta: parsed.cta,
    sensitiveCheck: {
      passed,
      issues,
      cleanedTitle,
      cleanedCaption,
    },
  }
}

// ========================
// 辅助函数
// ========================

function getPlatformLabel(platform: PlatformId): string {
  const labels: Record<PlatformId, string> = {
    douyin_local: '抖音本地生活',
    xiaohongshu: '小红书',
    wechat_video: '视频号',
    universal: '通用',
  }
  return labels[platform]
}

function buildChatUrl(baseUrl: string): string {
  if (baseUrl.endsWith('/v1') || baseUrl.endsWith('/v3') || baseUrl.includes('/api/v3')) {
    return `${baseUrl}/chat/completions`
  }
  return `${baseUrl}/v1/chat/completions`
}

function extractJson(text: string): string {
  const jsonBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (jsonBlockMatch) {
    return jsonBlockMatch[1].trim()
  }
  const jsonStart = text.indexOf('{')
  if (jsonStart !== -1) {
    return text.slice(jsonStart)
  }
  return text.trim()
}
