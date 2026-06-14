/**
 * Script_Merger（时间轴脚本合并器）
 *
 * 将多个 Shot 的 prompt 合并为 Seedance 2.0 最优格式的时间轴脚本。
 *
 * 核心原则（基于 Seedance 2.0 社区最佳实践验证）：
 * - 总字数控制在 200-300 字（超过 300 字后面的描述会被模型忽略）
 * - 每段只保留 1 个运镜 + 1 个核心动作 + 1 个光线关键词
 * - 保留时间码格式（0-4秒：...），模型对时间分段有较好理解
 * - 开头一行全局风格锁定
 * - 结尾一行负面约束（防漂移、防变脸）
 * - 3-4 段最佳，超过 5 段内容会互相干扰
 */

/** 合并后脚本的目标上限（中文字符）。
 * Seedance 2.0 最优区间：整条 prompt（含风格行+时间轴+负面约束）≤250 中文字，
 * 超出后模型会忽略后半段并"取平均"产出通用结果。 */
export const MAX_SCRIPT_LENGTH = 250

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
}

/** 合并算法的输出 */
export interface TimelineScriptResult {
  /** 合并后的 Timeline_Script */
  text: string
  /** 完整的时间轴分段 */
  segments: Array<{ relStart: number; relEnd: number; body: string }>
  /** 是否因超限丢弃了整段分镜（与 droppedSegmentCount>0 同步；单段过长的段内截断不计入此标志） */
  truncated: boolean
  /** 被丢弃的整段分镜数量（不含首段的段内截断） */
  droppedSegmentCount: number
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
 * 从 prompt 中移除已在全局风格前缀中声明的角色外貌描述（规则去重）
 * 避免"写实3D风格。小明：短发少年白T恤"在每段都重复。
 * 策略：提取 stylePrefix 中的角色名列表，如果 prompt 中含有"角色名+外貌描述"模式则移除。
 */
function deduplicateAgainstStyle(prompt: string, stylePrefix: string): string {
  if (!stylePrefix || !prompt) return prompt

  // 从 stylePrefix 提取角色名（匹配"角色名：外貌"或"角色名（外貌）"模式）
  const charNamePattern = /([^\s，。；、]+)[：:]/g
  const charNames: string[] = []
  let match
  while ((match = charNamePattern.exec(stylePrefix)) !== null) {
    if (match[1] && match[1].length >= 2 && match[1].length <= 8) {
      charNames.push(match[1])
    }
  }

  if (charNames.length === 0) return prompt

  let result = prompt
  for (const name of charNames) {
    // 移除 prompt 中的"角色名：XXX"、"角色名，XXX外貌"类描述
    // 匹配模式：角色名 + 冒号/逗号 + 后续到下一个逗号/句号/分号
    const removePattern = new RegExp(
      `[，,]?\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[：:][^，。；,;]*[，。；,;]?`,
      'g'
    )
    result = result.replace(removePattern, '')
  }

  // 清理残留的连续标点和首尾标点
  result = result
    .replace(/^[，,。；\s]+/, '')
    .replace(/[，,。；\s]+$/, '')
    .replace(/[，,]{2,}/g, '，')

  return result || prompt // 如果去重后为空则保留原文
}

/** 风格行压缩上限（中文字符）：只保留画风+色调关键词，避免占用过多 prompt 预算 */
const MAX_STYLE_LINE_LENGTH = 50

/**
 * 压缩全局风格前缀为简短的风格声明行（画风 + 色调关键词）。
 *
 * 完整的 stylePrefix 可能含角色外貌等大量文字（用于前端展示），但提交 Seedance 时：
 * - 角色外观由 asset:// 人物锚定图（reference_image）锚定，无需在文本里重复（官方最佳实践）；
 * - prompt 总预算紧张（≤250字），风格行应只保留画风/色调关键词。
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
  // 12 ≈ "0-15秒：" 时间码前缀 + 换行符余量
  return compressed.length + 12
}

/**
 * 将多个 Shot 的 prompt 合并为 Seedance 2.0 最优格式的时间轴脚本。
 *
 * 输出格式：
 * ```
 * {风格前缀}
 * 镜头1：{压缩后的运镜+动作+光线}
 * 镜头2：{压缩后的运镜+动作+光线}
 * 镜头3：{压缩后的运镜+动作+光线}
 * 禁止风格漂移，禁止角色变脸，禁止光线突变，禁止出现文字水印
 * ```
 *
 * 字数预算保证：输出 `text.length` 恒 ≤ MAX_SCRIPT_LENGTH。
 * - 多段时按预算贪心保留前若干段，超出的整段被丢弃（计入 droppedSegmentCount）；
 * - 即便单个分镜的压缩正文本身就超预算，也会对该（强制保留的）首段做「段内截断」：
 *   保留「镜头N：」前缀与运镜词，仅截去尾部描述，使 text 仍不超过 MAX_SCRIPT_LENGTH。
 * - 返回的 segments 始终是未截断的完整时间轴元数据，截断只影响渲染出的 text / 保留行。
 *
 * @param groupShots 组内分镜列表（无需预排序）
 * @param options 合并选项
 */
export function mergeTimelineScript(
  groupShots: MergeInputShot[],
  options?: MergeOptions
): TimelineScriptResult {
  if (groupShots.length === 0) {
    return { text: '', segments: [], truncated: false, droppedSegmentCount: 0 }
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

    // 先去重（移除与全局风格重复的角色外貌描述），再压缩
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

  // 组装最终脚本
  const parts: string[] = []

  // 1. 全局风格行（压缩为画风+色调关键词，角色外貌由人物锚定图承载，不在文本重复）
  //    不再写入精确总时长（秒）——时长由 API duration 参数控制，文本里强写秒数反而不稳定。
  const compressedStyle = options?.stylePrefix ? compressStylePrefix(options.stylePrefix) : ''
  if (compressedStyle) {
    parts.push(compressedStyle)
  }

  // 2. 时间轴分段（按字数预算贪心添加）
  //    预算 = MAX_SCRIPT_LENGTH − 风格行（含其后的换行符）− 负面约束行（含其前的换行符），
  //    因此「风格行 + 已保留分镜行 + 负面约束行」用 \n 拼接后的总长度必然 ≤ MAX_SCRIPT_LENGTH。
  //    贪心规则：
  //      - 首行（镜头1）为强制保留行，保证 text 非空；若它单行就超出预算
  //        （单个分镜 prompt 极长的对抗场景），则在「段落内」截断该行——
  //        保留行首的「镜头N：」前缀与紧随的运镜词（位于行首，不会被截掉），
  //        仅截去尾部描述，使整行长度收敛到预算内；截断后不再追加后续分镜。
  //      - 其余行按「换行符 + 行内容」累加，一旦超预算即停止（丢弃剩余整段分镜）。
  const styleLineLength = parts.length > 0 ? parts[0].length + 1 : 0
  const negativeLength = (options?.addNegativeConstraints !== false) ? DEFAULT_NEGATIVE_CONSTRAINTS.length + 1 : 0
  const budgetForTimeline = MAX_SCRIPT_LENGTH - styleLineLength - negativeLength

  let timelineLength = 0
  let lineTruncated = false
  const keptLines: string[] = []
  for (const line of timelineLines) {
    if (keptLines.length === 0) {
      // 首行强制保留。若其长度超出可用预算，则在段落内截断：
      // 从行首切片（行首即「镜头N：」前缀 + 运镜词），仅截去尾部描述，确保整行 ≤ 预算。
      if (line.length > budgetForTimeline) {
        const truncatedLine = line.slice(0, Math.max(0, budgetForTimeline))
        keptLines.push(truncatedLine)
        timelineLength += truncatedLine.length
        lineTruncated = true
        break // 首行已占满预算，无空间容纳后续分镜
      }
      keptLines.push(line)
      timelineLength += line.length
      continue
    }
    // 后续行需额外计入与上一行之间的换行符
    const addition = line.length + 1
    if (timelineLength + addition > budgetForTimeline) {
      break
    }
    keptLines.push(line)
    timelineLength += addition
  }

  parts.push(...keptLines)

  // 3. 负面约束行
  if (options?.addNegativeConstraints !== false) {
    parts.push(DEFAULT_NEGATIVE_CONSTRAINTS)
  }

  const text = parts.join('\n')

  const droppedCount = timelineLines.length - keptLines.length
  if (droppedCount > 0 || lineTruncated) {
    console.warn(
      `[script-merger] 脚本超${MAX_SCRIPT_LENGTH}字预算：丢弃${droppedCount}/${timelineLines.length}段` +
        (lineTruncated ? '，并对首段做段内截断' : '')
    )
  }

  // truncated 反映「是否有整段分镜被丢弃」，与 droppedSegmentCount 同步（保持二者语义一致）；
  // 单段过长触发的段内截断仅通过上面的 warn 记录，不改变 droppedSegmentCount。
  return {
    text,
    segments,
    truncated: droppedCount > 0,
    droppedSegmentCount: droppedCount,
  }
}
