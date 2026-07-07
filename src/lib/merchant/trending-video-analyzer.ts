/**
 * 爆款视频拆解引擎
 *
 * 复用 video-analyzer.ts 的多模态视频分析能力，对爆款/高播放量视频进行结构化拆解：
 * - Hook 类型识别（价格钩子/悬念钩子/冲突钩子/利益点钩子等）
 * - 分镜节奏分析（镜头切换频率、时长分布、节奏曲线）
 * - 字幕风格识别（文案密度、语气特征、CTA 策略）
 * - 整体结构拆解（开头-铺垫-高潮-收尾的叙事弧线）
 *
 * 输出：
 * - 结构化拆解报告（TrendingVideoBreakdown）
 * - 可固化为 Playbook 模板（saveAsPlaybookTemplate）
 *
 * 数据来源：
 * - 手动传入视频 URL（商家/运营发现的爆款视频）
 * - 后续可扩展为自动采集平台高播放量视频
 */

import { parseVideoDirectly, type ParsedShot, type ParseVideoResult } from '../video/video-analyzer'
import { prisma } from '../shared/db'

// ========================
// 类型定义
// ========================

/** Hook（开头钩子）类型 */
export type HookType =
  | 'PRICE'        // 价格钩子："9.9 元吃到撑"
  | 'SUSPENSE'     // 悬念钩子："你绝对想不到..."
  | 'CONFLICT'     // 冲突钩子："老板说不能再便宜了"
  | 'BENEFIT'      // 利益点钩子："免费停车 3 小时"
  | 'EMOTIONAL'    // 情感钩子："看到最后一桌客人..."
  | 'AUTHORITY'    // 权威钩子："米其林三星主厨..."
  | 'SOCIAL_PROOF' // 社会认同钩子："排队 2 小时的店..."
  | 'CURIOSITY'    // 好奇心钩子："这道菜 90% 的人没吃过"
  | 'URGENCY'      // 紧迫感钩子："只剩最后 3 天"
  | 'OTHER'        // 其它

/** 节奏类型 */
export type PacingType =
  | 'FAST'     // 快切（平均镜头时长 < 2s）
  | 'MEDIUM'   // 中等（2-4s）
  | 'SLOW'     // 慢节奏（> 4s）
  | 'MIXED'    // 混合（开头快切 + 中段慢叙事 + 结尾快收）

/** 字幕风格 */
export interface SubtitleStyle {
  /** 文案密度：每镜头平均文案字数 */
  density: number
  /** 语气特征 */
  tone: 'CASUAL' | 'FORMAL' | 'HUMOROUS' | 'EMOTIONAL' | 'INFORMATIONAL'
  /** 是否有旁白/对白 */
  hasNarration: boolean
  /** CTA 策略 */
  ctaStrategy: 'DIRECT' | 'SOFT' | 'IMPLICIT' | 'NONE'
}

/** 叙事结构段 */
export interface NarrativeSegment {
  /** 段落名称 */
  phase: 'HOOK' | 'BUILDUP' | 'CLIMAX' | 'RESOLUTION' | 'CTA'
  /** 起始时间（秒） */
  startSec: number
  /** 结束时间（秒） */
  endSec: number
  /** 包含的镜头索引 */
  shotIndices: number[]
  /** 段落描述 */
  description: string
}

/** 爆款视频结构化拆解结果 */
export interface TrendingVideoBreakdown {
  /** 视频 URL */
  videoUrl: string
  /** 视频时长（秒） */
  durationSec: number
  /** 总分镜数 */
  totalShots: number
  /** Hook 类型 */
  hookType: HookType
  /** Hook 描述 */
  hookDescription: string
  /** Hook 文案（前 3 秒） */
  hookText: string
  /** 节奏类型 */
  pacingType: PacingType
  /** 平均镜头时长（秒） */
  avgShotDuration: number
  /** 字幕风格 */
  subtitleStyle: SubtitleStyle
  /** 叙事结构 */
  narrativeStructure: NarrativeSegment[]
  /** 关键镜头摘要 */
  keyShots: Array<{
    orderIndex: number
    scene: string
    shotType: string
    suggestedPrompt: string
  }>
  /** 可复用的 Seedance prompt 模板 */
  reusablePrompts: string[]
  /** 行业标签建议 */
  suggestedIndustry?: string
  /** 内容目标建议 */
  suggestedGoal?: string
  /** 分析时间 */
  analyzedAt: Date
}

// ========================
// 主入口
// ========================

/**
 * 拆解爆款视频
 *
 * 1. 调用 video-analyzer 的多模态分析获取结构化分镜
 * 2. 分析 Hook 类型（前 3 秒 / 前 1-2 个镜头）
 * 3. 分析节奏特征（镜头时长分布）
 * 4. 分析字幕/文案风格
 * 5. 构建叙事结构（Hook→铺垫→高潮→收尾→CTA）
 * 6. 提取可复用的 prompt 模板
 *
 * @param videoUrl 视频公网 URL
 * @param totalDuration 视频总时长（秒）
 */
export async function analyzeTrendingVideo(params: {
  videoUrl: string
  totalDuration: number
  sceneCuts?: number[]
}): Promise<TrendingVideoBreakdown> {
  const { videoUrl, totalDuration, sceneCuts } = params

  // 1. 多模态视频分析
  const parseResult = await parseVideoDirectly({
    videoUrl,
    totalDuration,
    sceneCuts,
  })

  const { shots } = parseResult

  if (shots.length === 0) {
    throw new Error('视频分析未返回任何分镜数据')
  }

  // 2. Hook 分析
  const hookAnalysis = analyzeHook(shots)

  // 3. 节奏分析
  const pacingAnalysis = analyzePacing(shots, totalDuration)

  // 4. 字幕/文案风格分析
  const subtitleStyle = analyzeSubtitleStyle(shots)

  // 5. 叙事结构分析
  const narrativeStructure = analyzeNarrativeStructure(shots, totalDuration)

  // 6. 提取关键镜头 + 可复用 prompt
  const keyShots = extractKeyShots(shots)
  const reusablePrompts = extractReusablePrompts(shots, hookAnalysis.hookType)

  return {
    videoUrl,
    durationSec: totalDuration,
    totalShots: shots.length,
    hookType: hookAnalysis.hookType,
    hookDescription: hookAnalysis.description,
    hookText: hookAnalysis.text,
    pacingType: pacingAnalysis.pacingType,
    avgShotDuration: pacingAnalysis.avgDuration,
    subtitleStyle,
    narrativeStructure,
    keyShots,
    reusablePrompts,
    analyzedAt: new Date(),
  }
}

// ========================
// Hook 分析
// ========================

function analyzeHook(shots: ParsedShot[]): {
  hookType: HookType
  description: string
  text: string
} {
  // 取前 1-2 个镜头作为 Hook 分析对象
  const hookShots = shots.slice(0, Math.min(2, shots.length))
  const hookText = hookShots
    .flatMap(s => s.dialogue.map(d => d.text))
    .join(' ')
    .trim()

  // 基于文案内容识别 Hook 类型
  const hookType = classifyHook(hookText, hookShots)

  const description = buildHookDescription(hookType, hookShots)

  return { hookType, description, text: hookText || '(无对白/纯画面 Hook)' }
}

function classifyHook(text: string, shots: ParsedShot[]): HookType {
  const lowerText = text.toLowerCase()

  // 价格相关关键词
  if (/元|¥|￥|折|免费|半价|买一送一|特价|优惠/.test(text)) return 'PRICE'
  // 悬念/好奇
  if (/你猜|想不到|没想到|竟然|居然|到底|秘密/.test(text)) return 'SUSPENSE'
  // 冲突
  if (/不行|不可以|吵|争|不让|拒绝|反对/.test(text)) return 'CONFLICT'
  // 利益点
  if (/送|赠|免费|体验|福利|特权|停车|wifi/.test(lowerText)) return 'BENEFIT'
  // 情感
  if (/感动|哭了|暖心|最后一|看到|忍不住/.test(text)) return 'EMOTIONAL'
  // 权威
  if (/米其林|大师|冠军|专家|百年|老字号|非遗/.test(text)) return 'AUTHORITY'
  // 社会认同
  if (/排队|爆满|网红|打卡|好评|万人|销量/.test(text)) return 'SOCIAL_PROOF'
  // 好奇心
  if (/90%|大多数|很多人不知道|第一次|揭秘|真相/.test(text)) return 'CURIOSITY'
  // 紧迫感
  if (/最后|只剩|限时|即将|马上|倒计时|结束/.test(text)) return 'URGENCY'

  // 无对白时根据画面判断
  if (!text && shots.length > 0) {
    const firstShot = shots[0]
    if (firstShot.hasFace) return 'EMOTIONAL'
    if (/产品|食物|菜品/.test(firstShot.scene)) return 'BENEFIT'
    return 'OTHER'
  }

  return 'OTHER'
}

function buildHookDescription(hookType: HookType, hookShots: ParsedShot[]): string {
  const sceneTypes = hookShots.map(s => s.shotType).join(' + ')
  const typeLabels: Record<HookType, string> = {
    PRICE: '价格利益点开场',
    SUSPENSE: '悬念引导开场',
    CONFLICT: '冲突/对话开场',
    BENEFIT: '利益点直给开场',
    EMOTIONAL: '情感共鸣开场',
    AUTHORITY: '权威背书开场',
    SOCIAL_PROOF: '社会认同开场',
    CURIOSITY: '好奇心驱动开场',
    URGENCY: '紧迫感营造开场',
    OTHER: '其它开场方式',
  }
  return `${typeLabels[hookType]}（镜头类型: ${sceneTypes}）`
}

// ========================
// 节奏分析
// ========================

function analyzePacing(shots: ParsedShot[], totalDuration: number): {
  pacingType: PacingType
  avgDuration: number
} {
  const durations = shots.map(s => s.endTime - s.startTime)
  const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length

  if (avgDuration < 2) return { pacingType: 'FAST', avgDuration }
  if (avgDuration > 4) return { pacingType: 'SLOW', avgDuration }

  // 检查是否混合节奏（前半段和后半段差异大）
  const mid = Math.floor(shots.length / 2)
  const firstHalf = durations.slice(0, mid)
  const secondHalf = durations.slice(mid)
  const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length
  const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length

  if (Math.abs(firstAvg - secondAvg) > 1.5) {
    return { pacingType: 'MIXED', avgDuration }
  }

  return { pacingType: 'MEDIUM', avgDuration }
}

// ========================
// 字幕/文案风格分析
// ========================

function analyzeSubtitleStyle(shots: ParsedShot[]): SubtitleStyle {
  const dialogues = shots.flatMap(s => s.dialogue)
  const allText = dialogues.map(d => d.text).join('')
  const totalChars = allText.length

  // 文案密度：每镜头平均字数
  const density = shots.length > 0 ? totalChars / shots.length : 0

  // 是否有旁白/对白
  const hasNarration = dialogues.length > 0

  // 语气特征分析
  const tone = classifyTone(allText, dialogues)

  // CTA 策略
  const ctaStrategy = classifyCtaStrategy(allText)

  return { density, tone, hasNarration, ctaStrategy }
}

function classifyTone(text: string, dialogues: Array<{ speaker: string; text: string }>): SubtitleStyle['tone'] {
  if (/哈哈|嘻嘻|笑死|绝了|离谱|太可/.test(text)) return 'HUMOROUS'
  if (/感动|温暖|真心|用心|坚持|梦想/.test(text)) return 'EMOTIONAL'
  if (/地址|营业时间|电话|预约|导航/.test(text)) return 'INFORMATIONAL'
  if (/您好|欢迎|请|感谢/.test(text) || dialogues.some(d => d.speaker === '旁白')) return 'FORMAL'
  return 'CASUAL'
}

function classifyCtaStrategy(text: string): SubtitleStyle['ctaStrategy'] {
  if (/快来|赶紧|马上|立刻|点击|下单|抢购/.test(text)) return 'DIRECT'
  if (/推荐|试试|值得一|不妨|可以考虑/.test(text)) return 'SOFT'
  if (/欢迎|期待|等你|来吧/.test(text)) return 'IMPLICIT'
  return 'NONE'
}

// ========================
// 叙事结构分析
// ========================

function analyzeNarrativeStructure(shots: ParsedShot[], totalDuration: number): NarrativeSegment[] {
  const n = shots.length
  if (n === 0) return []

  const segments: NarrativeSegment[] = []

  // HOOK: 前 1-2 个镜头（前 15% 时长）
  const hookEnd = Math.min(2, Math.ceil(n * 0.15))
  segments.push({
    phase: 'HOOK',
    startSec: shots[0].startTime,
    endSec: shots[Math.min(hookEnd - 1, n - 1)].endTime,
    shotIndices: Array.from({ length: hookEnd }, (_, i) => i),
    description: '开头钩子，吸引停留',
  })

  if (n <= 2) return segments

  // BUILDUP: 15%-60% 时段
  const buildupStart = hookEnd
  const buildupEnd = Math.ceil(n * 0.6)
  if (buildupEnd > buildupStart) {
    segments.push({
      phase: 'BUILDUP',
      startSec: shots[buildupStart].startTime,
      endSec: shots[Math.min(buildupEnd - 1, n - 1)].endTime,
      shotIndices: Array.from({ length: buildupEnd - buildupStart }, (_, i) => buildupStart + i),
      description: '内容铺垫，展示产品/环境/过程',
    })
  }

  // CLIMAX: 60%-80% 时段
  const climaxStart = buildupEnd
  const climaxEnd = Math.ceil(n * 0.8)
  if (climaxEnd > climaxStart && climaxStart < n) {
    segments.push({
      phase: 'CLIMAX',
      startSec: shots[climaxStart].startTime,
      endSec: shots[Math.min(climaxEnd - 1, n - 1)].endTime,
      shotIndices: Array.from({ length: climaxEnd - climaxStart }, (_, i) => climaxStart + i),
      description: '高潮段落，核心卖点/情感爆点',
    })
  }

  // RESOLUTION + CTA: 最后 20%
  const resolutionStart = climaxEnd > climaxStart ? climaxEnd : buildupEnd
  if (resolutionStart < n) {
    const hasExplicitCta = shots.slice(resolutionStart).some(s =>
      s.dialogue.some(d => /关注|点赞|下单|快来|地址|导航/.test(d.text))
    )

    segments.push({
      phase: hasExplicitCta ? 'CTA' : 'RESOLUTION',
      startSec: shots[resolutionStart].startTime,
      endSec: shots[n - 1].endTime,
      shotIndices: Array.from({ length: n - resolutionStart }, (_, i) => resolutionStart + i),
      description: hasExplicitCta ? '行动号召 + 收尾' : '自然收尾',
    })
  }

  return segments
}

// ========================
// 关键镜头 + 可复用 Prompt
// ========================

function extractKeyShots(shots: ParsedShot[]): TrendingVideoBreakdown['keyShots'] {
  // 选取有代表性的镜头：Hook + 中间 + 收尾各取 1-2 个
  const keyIndices = new Set<number>()
  keyIndices.add(0) // 始终包含第一个镜头
  if (shots.length > 1) keyIndices.add(Math.floor(shots.length / 2)) // 中间镜头
  if (shots.length > 2) keyIndices.add(shots.length - 1) // 最后一个镜头

  // 添加有对白的镜头
  shots.forEach((s, i) => {
    if (s.dialogue.length > 0 && keyIndices.size < 8) keyIndices.add(i)
  })

  return Array.from(keyIndices)
    .sort((a, b) => a - b)
    .map(i => ({
      orderIndex: shots[i].orderIndex,
      scene: shots[i].scene,
      shotType: shots[i].shotType,
      suggestedPrompt: shots[i].suggestedPrompt,
    }))
}

function extractReusablePrompts(shots: ParsedShot[], hookType: HookType): string[] {
  const prompts: string[] = []

  // 取前 3 个镜头的 suggestedPrompt 作为模板
  const hookShots = shots.slice(0, Math.min(3, shots.length))
  for (const shot of hookShots) {
    if (shot.suggestedPrompt) {
      prompts.push(shot.suggestedPrompt)
    }
  }

  // 如果有高潮镜头，也提取
  if (shots.length > 4) {
    const climaxShot = shots[Math.floor(shots.length * 0.7)]
    if (climaxShot?.suggestedPrompt) {
      prompts.push(climaxShot.suggestedPrompt)
    }
  }

  return prompts
}

// ========================
// Playbook 模板固化
// ========================

/**
 * 将爆款拆解结果固化为 Playbook 模板
 *
 * @param breakdown 拆解结果
 * @param industry 所属行业
 * @param goal 内容目标
 * @returns 创建的 Playbook ID
 */
export async function saveBreakdownAsPlaybook(params: {
  breakdown: TrendingVideoBreakdown
  industry: string
  goal: string
  name?: string
}): Promise<string> {
  const { breakdown, industry, goal, name } = params

  // 构建 Playbook 结构
  const structure = breakdown.narrativeStructure.map(seg => ({
    phase: seg.phase,
    durationSec: seg.endSec - seg.startSec,
    shotCount: seg.shotIndices.length,
    description: seg.description,
  }))

  // 从拆解结果提取模板
  const hookTemplates = breakdown.hookText
    ? [breakdown.hookText]
    : []

  const captionTemplates = breakdown.subtitleStyle.hasNarration
    ? breakdown.keyShots
        .filter(s => s.suggestedPrompt)
        .map(s => s.suggestedPrompt)
        .slice(0, 5)
    : []

  // 提取必拍镜头类型
  const requiredShots = [...new Set(
    breakdown.keyShots.map(s => s.shotType)
  )]

  // 创建 Playbook
  const playbook = await prisma.playbook.create({
    data: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      industry: industry as any, // MerchantIndustry enum
      name: name ?? `爆款拆解-${breakdown.hookType}-${breakdown.pacingType}节奏`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      goal: goal as any, // ContentGoal enum
      description: `来源: ${breakdown.videoUrl}\nHook: ${breakdown.hookDescription}\n节奏: ${breakdown.pacingType} (${breakdown.avgShotDuration.toFixed(1)}s/镜头)\n字幕风格: ${breakdown.subtitleStyle.tone}`,
      structure: JSON.parse(JSON.stringify(structure)),
      requiredShots: JSON.parse(JSON.stringify(requiredShots)),
      hookTemplates: JSON.parse(JSON.stringify(hookTemplates)),
      captionTemplates: JSON.parse(JSON.stringify(captionTemplates)),
      coverTitleTemplates: JSON.parse(JSON.stringify(hookTemplates.slice(0, 3))),
      ctaTemplates: JSON.parse(JSON.stringify([])),
    },
  })

  return playbook.id
}
