/**
 * Script_Merger（时间轴脚本合并器）
 *
 * 将多个 Shot 的 prompt 合并为 Seedance 2.0 最优格式的时间轴脚本。
 *
 * 核心原则（基于 Seedance 2.0 社区最佳实践验证）：
 * - 每段只保留 1 个运镜 + 1 个核心动作 + 1 个光线关键词
 * - 保留时间码格式（镜头N：...），模型对分段有较好理解
 * - 开头一行全局风格锁定
 * - 结尾一行负面约束（防漂移、防变脸）
 * - 3-4 段最佳，超过 5 段内容会互相干扰
 * - 全组分镜/台词完整保留，绝不丢弃整段分镜或截断 {台词} 内容
 */

/**
 * 合并后脚本的「软目标」字数上限（中文字符）。
 *
 * Seedance 2.0 推荐区间 200~300 字，超出后模型对后半段关注度下降。
 * 此常量为**软目标**而非硬截断阈值：
 *   - 当合并脚本超过此值时，仅压缩可省略的环境/光线修饰词；
 *   - 绝不删除整段分镜，绝不切断 {台词} 大括号内容；
 *   - 完整性（全组分镜/台词不丢失）优先于字数紧凑性。
 */
export const MAX_SCRIPT_LENGTH = 250

/** 每组最大分镜数（与 grouping-service.ts 的 MAX_SHOTS_PER_GROUP 一致） */
export const MAX_SHOTS_PER_GROUP = 3

/** 默认负面约束（防止风格漂移、角色变脸等） */
const DEFAULT_NEGATIVE_CONSTRAINTS = '禁止风格漂移，禁止角色变脸，禁止光线突变，禁止出现文字水印'

/**
 * 受支持的专业运镜术语
 */
export const SUPPORTED_CAMERA_MOVES = ['推', '拉', '摇', '移', '跟随', '环绕', '固定'] as const

export type CameraMove = (typeof SUPPORTED_CAMERA_MOVES)[number]

/** 合并算法的输入分镜 */
export interface MergeInputShot {
  /** 分镜序号（连续、升序） */
  orderIndex: number
  /** 分镜在原视频中的起点（秒） */
  startTime: number
  /** 分镜在原视频中的终点（秒） */
  endTime: number
  /** Vision_Analyzer 生成的初始时间轴提示词（可能为空） */
  prompt: string | null
  /** 对白内容（JSON 字符串，如 [{"speaker":"角色A","text":"你好"}]） */
  dialogue?: string | null
  /** 场景描述（如"白色背景直播间"），用于在 prompt 中声明场景环境 */
  scene?: string | null
}

/** 合并算法的输出 */
export interface TimelineScriptResult {
  /** 合并后的 Timeline_Script */
  text: string
  /** 完整的时间轴分段 */
  segments: Array<{ relStart: number; relEnd: number; body: string }>
  /** 是否因超限丢弃了整段分镜（修复后恒为 false，全组分镜完整保留） */
  truncated: boolean
  /** 被丢弃的整段分镜数量（修复后恒为 0，全组分镜完整保留） */
  droppedSegmentCount: number
  /** 当合并脚本超过软目标且压缩了修饰词时的取舍说明；为 null 表示未发生任何取舍 */
  lossNotice: string | null
}

/** 合并选项 */
export interface MergeOptions {
  /** 生成时长（秒），用于归一化时间码 */
  genDuration?: number
  /** 全局风格前缀（如 "国风3D动画风格，暗色调"） */
  stylePrefix?: string
  /** 是否添加负面约束，默认 true */
  addNegativeConstraints?: boolean
}

/**
 * 从 prompt 中提取运镜术语
 */
function extractCameraMove(prompt: string): string {
  // 优先匹配二字术语
  for (const move of SUPPORTED_CAMERA_MOVES) {
    if (prompt.includes(move)) {
      return move
    }
  }
  return '固定'
}

/**
 * 从 prompt 中移除已在全局风格前缀中真实重复的角色外貌描述（精确去重）。
 *
 * 策略：
 *   1. 从 stylePrefix 提取「角色名：外貌描述」的完整映射；
 *   2. 在 prompt 中查找「角色名：…」模式时，只有当后续内容确实是外貌描述
 *      且与 stylePrefix 中该角色的外貌描述存在实质重复时才移除；
 *   3. 动作描述（如「小明：独自走在街道上」）即使角色名匹配也不移除，
 *      避免误删 prompt 正文内容。
 *
 * 判定「真实重复」的标准：prompt 中角色名后的描述词汇与 stylePrefix
 * 中该角色的外貌描述存在 ≥50% 的关键词重叠（纯外貌词汇匹配）。
 */
function deduplicateAgainstStyle(prompt: string, stylePrefix: string): string {
  if (!stylePrefix || !prompt) return prompt

  // 从 stylePrefix 提取「角色名：外貌描述」映射
  // 匹配模式：角色名（2~8字） + 冒号 + 外貌描述（到句末标点或字符串结束）
  const charDescPattern = /([^\s，。；、]{2,8})[：:]([^。；]*)/g
  const charDescMap = new Map<string, string>()
  let match
  while ((match = charDescPattern.exec(stylePrefix)) !== null) {
    if (match[1] && match[2]) {
      charDescMap.set(match[1], match[2].trim())
    }
  }

  if (charDescMap.size === 0) return prompt

  let result = prompt
  for (const [name, styleDesc] of charDescMap) {
    // 提取 stylePrefix 中该角色外貌描述的关键词集合（≥2字的词素）
    const styleKeywords = extractAppearanceKeywords(styleDesc)
    if (styleKeywords.length === 0) continue

    // 在 prompt 中查找「角色名：…」模式
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const findPattern = new RegExp(
      `([，,]?\\s*)${escapedName}[：:]([^，。；,;]*)([，。；,;]?)`,
      'g'
    )

    result = result.replace(findPattern, (fullMatch, _pre, content) => {
      // 提取 prompt 中匹配段的关键词
      const contentKeywords = extractAppearanceKeywords(content)
      if (contentKeywords.length === 0) return fullMatch // 无可比对关键词，保留原文

      // 计算与 stylePrefix 外貌描述的关键词重叠度
      const overlapCount = contentKeywords.filter((kw) =>
        styleKeywords.some((sk) => sk.includes(kw) || kw.includes(sk))
      ).length
      const overlapRatio = overlapCount / contentKeywords.length

      // 仅当重叠度 ≥50% 时才判定为「真实重复外貌描述」并移除
      if (overlapRatio >= 0.5) {
        return '' // 移除真实重复的外貌描述
      }
      return fullMatch // 不是外貌描述重复，保留原文（如动作描述）
    })
  }

  // 清理残留的连续标点和首尾标点
  result = result
    .replace(/^[，,。；\s]+/, '')
    .replace(/[，,。；\s]+$/, '')
    .replace(/[，,]{2,}/g, '，')

  return result || prompt // 如果去重后为空则保留原文
}

/**
 * 从描述文本中提取外貌相关的关键词（≥2字的名词/形容词词素）。
 * 用于判定两段描述是否存在实质重复。
 */
function extractAppearanceKeywords(text: string): string[] {
  if (!text) return []
  // 以标点/空格切分，提取 ≥2 字的片段作为关键词
  return text
    .split(/[，,。；\s、的]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)
}

/** 风格行压缩上限（中文字符）：只保留画风+色调关键词，避免占用过多 prompt 预算 */
const MAX_STYLE_LINE_LENGTH = 50

/**
 * 压缩全局风格前缀为简短的风格声明行（画风 + 色调关键词）。
 *
 * 完整的 stylePrefix 可能含角色外貌等大量文字（用于前端展示），但提交 Seedance 时：
 * - 角色外观由 asset:// 人物锚定图（reference_image）锚定，无需在文本里重复（官方最佳实践）；
 * - prompt 总预算紧张，风格行应只保留画风/色调关键词。
 *
 * 策略：取 stylePrefix 中不含「：」的前若干段（画风、色调），拼接并截断到 MAX_STYLE_LINE_LENGTH。
 * 含「：」的段（角色外貌描述）一律剔除。
 */
function compressStylePrefix(stylePrefix: string): string {
  if (!stylePrefix) return ''

  // 按句号/分号切段，剔除含「：」的角色描述段
  const segments = stylePrefix
    .split(/[。；]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.includes('：') && !s.includes(':'))

  let result = segments.join('，')
  if (result.length > MAX_STYLE_LINE_LENGTH) {
    result = result.slice(0, MAX_STYLE_LINE_LENGTH)
  }
  return result
}

/**
 * 将 prompt 原样保留（去除重复时间码、折叠空白）
 * 如果有对白，嵌入到 prompt 末尾（Seedance 原生 TTS 会根据引号内容生成语音）
 */
function compressPrompt(prompt: string | null, dialogue?: string | null): string {
  if (!prompt) return '镜头固定'

  // 去除已有的时间码前缀，折叠空白
  let cleaned = prompt
    .replace(/\d+\s*[-–]\s*\d+\s*秒[:：]?\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) cleaned = '镜头固定'

  // 确保每段以运镜词开头（官方建议：每个镜头先交代运镜方式）
  // 已含「镜头{运镜}」开头则保留；否则按提取到的运镜（缺省"固定"）在开头补全
  const move = extractCameraMove(cleaned)
  if (!cleaned.startsWith(`镜头${move}`)) {
    cleaned = `镜头${move}，${cleaned}`
  }

  // 嵌入对白：Seedance generate_audio=true 时会根据台词生成语音+唇形同步
  // 官方规范：台词必须用大括号 {} 包裹（音乐用（）、音效用<>、字幕用【】）
  if (dialogue) {
    const dialogueLines = parseDialogue(dialogue)
    if (dialogueLines.length > 0) {
      const dialogueText = dialogueLines
        .map((d) => `${d.speaker}说：{${d.text}}`)
        .join('，')
      cleaned = `${cleaned}，${dialogueText}`
    }
  }

  return cleaned
}

/**
 * 解析对白 JSON 字符串
 * dialogue 存储格式为 JSON.stringify([{speaker, text}])
 */
function parseDialogue(dialogue: string): Array<{ speaker: string; text: string }> {
  try {
    const parsed = JSON.parse(dialogue)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (d: unknown) =>
        d && typeof d === 'object' && 'text' in d && typeof (d as { text: unknown }).text === 'string' && (d as { text: string }).text.trim().length > 0
    ) as Array<{ speaker: string; text: string }>
  } catch {
    return []
  }
}

/**
 * 估算单个 Shot 压缩后的字数（供外部预判）
 */
export function estimateSegmentChars(prompt: string | null): number {
  const compressed = compressPrompt(prompt)
  // 12 ≈ "镜头N：" 前缀 + 换行符余量
  return compressed.length + 12
}

/**
 * 可省略的环境/光线修饰词列表（超软目标时用于压缩，不影响核心语义）
 */
const OMITTABLE_MODIFIERS = [
  '阳光明媚', '夕阳西下', '灯光昏暗', '月色朦胧', '晨光熹微',
  '柔光笼罩', '光影斑驳', '暖黄灯光', '冷蓝光线', '逆光剪影',
  '环境光', '顶光', '侧光', '氛围感', '电影感',
  '清冷', '温暖', '幽暗', '明亮', '柔和',
]

/**
 * 对单行分镜文本做软压缩：仅移除 `{台词}` 大括号**外部**的可省略环境/光线修饰词。
 * 保留运镜 + 核心动作 + `{台词}` 大括号内的全部内容（绝不修改大括号内文本）。
 */
function softCompressLine(line: string): string {
  // 将 {台词} 大括号内容保护起来：先提取所有 {...} 段替换为占位符，压缩外部后再还原
  const bracketContents: string[] = []
  const placeholder = '\u0000BRACKET'
  let protected_ = line.replace(/\{[^}]*\}/g, (match) => {
    bracketContents.push(match)
    return `${placeholder}${bracketContents.length - 1}\u0000`
  })

  // 仅对大括号外部文本做修饰词压缩
  for (const modifier of OMITTABLE_MODIFIERS) {
    protected_ = protected_.replace(new RegExp(`[，,、]?${modifier}[，,、]?`, 'g'), (m) => {
      if (m.startsWith('，') || m.startsWith(',') || m.startsWith('、')) return ''
      return ''
    })
  }

  // 清理连续标点
  protected_ = protected_.replace(/[，,]{2,}/g, '，').replace(/^[，,]+/, '').replace(/[，,]+$/, '')

  // 还原 {台词} 大括号内容
  let result = protected_
  for (let i = 0; i < bracketContents.length; i++) {
    result = result.replace(`${placeholder}${i}\u0000`, bracketContents[i])
  }
  return result
}

/**
 * 将多个 Shot 的 prompt 合并为 Seedance 2.0 最优格式的时间轴脚本。
 *
 * 输出格式：
 * ```
 * {风格前缀}
 * 镜头1：{运镜+动作+{台词}}
 * 镜头2：{运镜+动作+{台词}}
 * 镜头3：{运镜+动作+{台词}}
 * 禁止风格漂移，禁止角色变脸，禁止光线突变，禁止出现文字水印
 * ```
 *
 * 完整性保证：全组分镜（≤MAX_SHOTS_PER_GROUP=3段）及其 {台词} 完整保留，
 * 绝不丢弃整段分镜，绝不切断 {台词} 大括号内容。
 *
 * 字数策略：MAX_SCRIPT_LENGTH 为「软目标」而非硬截断阈值。
 *   - 未超软目标：直接输出，与修复前行为完全一致（Preservation 3.1/3.2）；
 *   - 超过软目标：仅压缩可省略的环境/光线修饰词（softCompressLine），
 *     保留「镜头N：」前缀 + 运镜 + 核心动作 + {台词}，生成 lossNotice 取舍说明。
 *
 * @param groupShots 组内分镜列表（无需预排序）
 * @param options 合并选项
 */
export function mergeTimelineScript(
  groupShots: MergeInputShot[],
  options?: MergeOptions
): TimelineScriptResult {
  if (groupShots.length === 0) {
    return { text: '', segments: [], truncated: false, droppedSegmentCount: 0, lossNotice: null }
  }

  // 按 orderIndex 升序
  const sorted = [...groupShots].sort((a, b) => a.orderIndex - b.orderIndex)

  // 计算相对时间码
  let accumulated = 0
  const styleText = options?.stylePrefix || ''
  const segments = sorted.map((shot) => {
    const duration = shot.endTime - shot.startTime
    const relStart = accumulated
    const relEnd = accumulated + duration
    accumulated = relEnd

    // 先去重（移除与全局风格真实重复的角色外貌描述），再压缩
    const dedupedPrompt = styleText ? deduplicateAgainstStyle(shot.prompt || '', styleText) : shot.prompt
    const body = compressPrompt(dedupedPrompt, shot.dialogue)
    return { relStart, relEnd, body }
  })

  // 归一化时间码到 genDuration
  const rawTotal = accumulated
  const targetDuration = options?.genDuration ?? rawTotal
  const scale = rawTotal > 0 ? targetDuration / rawTotal : 1

  const normalizedSegments = segments.map((seg) => ({
    relStart: Math.round(seg.relStart * scale * 10) / 10,
    relEnd: Math.round(seg.relEnd * scale * 10) / 10,
    body: seg.body,
  }))

  // 强制末段对齐到 targetDuration
  if (normalizedSegments.length > 0) {
    normalizedSegments[normalizedSegments.length - 1].relEnd = targetDuration
  }

  // 渲染分镜行：官方推荐用「镜头N」标识分镜顺序，不用精确秒数（模型对精确时间支持不稳定）。
  // body 本身以运镜词（如"镜头固定"）开头，去掉其多余的"镜头"前缀，避免"镜头1：镜头固定"重复。
  const timelineLines = normalizedSegments.map(
    (seg, i) => `镜头${i + 1}：${seg.body.replace(/^镜头/, '')}`
  )

  // 组装最终脚本 —— 全部分镜行完整保留，不做任何丢段/截断
  const parts: string[] = []

  // 1. 全局风格行（压缩为画风+色调关键词，角色外貌由人物锚定图承载，不在文本重复）
  //    不再写入精确总时长（秒）——时长由 API duration 参数控制，文本里强写秒数反而不稳定。
  const compressedStyle = options?.stylePrefix ? compressStylePrefix(options.stylePrefix) : ''
  if (compressedStyle) {
    parts.push(compressedStyle)
  }

  // 1.5 场景描述行：取组内首个分镜的 scene 字段，作为环境背景文字声明。
  //     帧图（reference_image）提供视觉锚定，此行提供语义强化，二者协同使 Seedance 准确理解"在哪个场景"。
  //     无 scene 时不写（不伪造），仅靠帧图和 prompt 内零散描述承载。
  const sceneDesc = sorted[0]?.scene?.trim()
  if (sceneDesc) {
    parts.push(`场景：${sceneDesc}`)
  }

  // 2. 时间轴分段 —— 全部分镜行完整保留（≤MAX_SHOTS_PER_GROUP=3段），绝不丢段
  parts.push(...timelineLines)

  // 3. 负面约束行
  if (options?.addNegativeConstraints !== false) {
    parts.push(DEFAULT_NEGATIVE_CONSTRAINTS)
  }

  let text = parts.join('\n')
  let lossNotice: string | null = null

  // 软目标压缩：当超过 MAX_SCRIPT_LENGTH 时，仅压缩可省略修饰词，绝不删整段/切台词
  if (text.length > MAX_SCRIPT_LENGTH) {
    // 对各分镜行做软压缩（移除环境/光线修饰词）
    const compressedLines = timelineLines.map((line) => softCompressLine(line))
    const compressedParts: string[] = []
    if (compressedStyle) {
      compressedParts.push(compressedStyle)
    }
    // 场景描述行保留（不可省略，是场景锚定的关键文字信号）
    if (sceneDesc) {
      compressedParts.push(`场景：${sceneDesc}`)
    }
    compressedParts.push(...compressedLines)
    if (options?.addNegativeConstraints !== false) {
      compressedParts.push(DEFAULT_NEGATIVE_CONSTRAINTS)
    }
    const compressedText = compressedParts.join('\n')

    // 仅当压缩后确实缩短了才使用压缩版本
    if (compressedText.length < text.length) {
      lossNotice = `本组脚本超过${MAX_SCRIPT_LENGTH}字软目标（原${text.length}字→压缩后${compressedText.length}字），已压缩环境/光线修饰词，全部分镜及台词完整保留`
      text = compressedText
    } else {
      // 压缩无效果但仍超软目标 —— 记录但不做任何有损操作，保持完整性
      lossNotice = `本组脚本超过${MAX_SCRIPT_LENGTH}字软目标（${text.length}字），无可压缩修饰词，全部分镜及台词已完整保留`
    }
  }

  // 修复后恒不丢段：droppedSegmentCount = 0, truncated = false
  return {
    text,
    segments,
    truncated: false,
    droppedSegmentCount: 0,
    lossNotice,
  }
}
