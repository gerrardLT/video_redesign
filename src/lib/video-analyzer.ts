/**
 * 视频分析客户端
 * 通过 OpenAI 兼容接口，将视频 URL 直传给多模态模型（Qwen-VL / 豆包 Seed 等）解析为结构化分镜。
 *
 * 铁律：真实接口、真实流程，无静默 fallback。
 * 当 VISION_MODEL / VISION_API_KEY / VISION_API_URL 未配置或 API 调用失败时，
 * 一律抛出描述性错误，绝不降级返回 Mock / 占位数据。
 */

import { ParseResultSchema, validateTimeline, repairTimeline, formatZodError } from './shot-schema'

const API_BASE_URL = process.env.VISION_API_URL || ''
const API_KEY = process.env.VISION_API_KEY || ''
const MODEL = process.env.VISION_MODEL || ''

export interface ParsedShot {
  orderIndex: number
  startTime: number
  endTime: number
  scene: string
  shotType: string
  cameraMove: string
  dialogue: Array<{ speaker: string; text: string }>
  audioDesc: string
  characters: Array<{ name: string; appearance: string }>
  suggestedPrompt: string
  /** 该分镜是否包含清晰可辨识的人脸 */
  hasFace: boolean
  /** 分类：scene（无人脸）| character（有人脸） */
  frameType: 'scene' | 'character'
}

export interface ParseVideoResult {
  globalSettings?: {
    artStyle: string
    colorTone: string
    subtitleDeclaration: string
    characters: Array<{ name: string; appearance: string; props?: string }>
  }
  shots: ParsedShot[]
}

// 视频直传分析的系统提示词：针对完整视频（含连续画面+音频），输出全局一致性设定 + 分镜脚本
const SYSTEM_PROMPT = `你是一个专业的视频分镜分析师。用户会给你一段**完整视频**（包含连续画面和音频），请观看整段视频后，按结构化维度生成精准的分镜脚本，用于后续 AI 视频复刻。

你必须观察视频的连续运动、镜头切换、人物动作与对白，按以下 5 个维度分析每个分镜，确保描述精准、具体、可还原：

【5 维度分析框架】：
1. 主体属性（Subject）：画面中的主要人/物，性别、年龄段、发型、服装颜色与款式、手持物品、身体姿态
2. 运动动态（Motion）：主体在做什么动作？动作方向、速度、幅度（如"右手从身侧抬至肩部高度"而非"举手"）
3. 环境上下文（Environment）：背景场所、空间感、纵深、前景/背景物体、时间段（白天/夜晚）
4. 摄影机参数（Camera）：景别（特写/近景/中景/全景/远景）+ 运镜（固定/推/拉/摇/移/跟随/环绕）+ 角度（平视/俯视/仰视）
5. 光线与色调（Lighting）：光源方向（左侧/右侧/顶部/背光）、色温（暖/冷/中性）、光质（硬光/柔光/漫射）

请严格按以下 JSON 格式输出（不要输出其他内容）：

{
  "globalSettings": {
    "artStyle": "美术风格描述（如：古风仙侠3D写实风格，CG高清渲染质感）",
    "colorTone": "整体色调（如：冷暗调为主，对战场景辅以金、红高光亮色）",
    "subtitleDeclaration": "无字幕 或 描述字幕样式",
    "characters": [
      {
        "name": "角色名",
        "appearance": "完整外貌：性别+年龄段+脸型+发型发色+服装详细描述+配饰+体型+特殊标记",
        "props": "角色始终携带的道具或标志性元素"
      }
    ]
  },
  "shots": [
    {
      "orderIndex": 0,
      "startTime": 0,
      "endTime": 5,
      "scene": "环境维度：具体场所+空间感+前背景物体",
      "shotType": "中景/远景/特写/近景/全景",
      "cameraMove": "固定/推/拉/摇/移/跟随/环绕",
      "dialogue": [{"speaker": "人物名", "text": "对白内容"}],
      "audioDesc": "背景音乐或音效描述",
      "characters": [{"name": "人物名", "appearance": "外貌详细描述"}],
      "suggestedPrompt": "按下方格式要求生成",
      "hasFace": true
    }
  ]
}

规则：
1. 按视频中真实的镜头切换点切分分镜，startTime/endTime 必须基于视频真实时间，每个分镜建议 1-8 秒
2. globalSettings 是全片统一设定，所有分镜共享同一套美术风格和角色外貌
3. scene 必须包含：场所类型 + 光线条件 + 前后景物体
4. characters.appearance 必须包含：性别 + 年龄段 + 发型发色 + 服装 + 配饰 + 特殊标记
5. cameraMove 只能从以下选取一个：固定、推、拉、摇、移、跟随、环绕
6. dialogue 必须准确转录视频音频中听到的对白，逐字逐句完整记录，绝不省略、绝不缩写、绝不合并。哪怕对白很长也必须完整写出。无对白则留空数组
7. hasFace：判断该分镜是否包含清晰可辨识的人脸（正脸、侧脸均算）
8. 只输出 JSON，不要其他解释文字
9. 【对白完整性最高优先级】：dialogue.text 必须包含该时间段内说话者的每一个字，包括语气词、重复词、口头禅。宁可多写也绝不漏字。suggestedPrompt 中引号内的对白同样必须完整，与 dialogue.text 一致

【suggestedPrompt 格式要求 — Seedance 2.0 时间轴分镜脚本】：
由于生成时会传入首帧图片锚定画面，suggestedPrompt 重点描述"怎么动"而非"画面里有什么"。

格式：
"{startTime}-{endTime}秒：[运镜] 镜头{运镜术语}，[动作] {主体}+{具体物理化动作}+{光线变化}，[对白] {角色名}（情绪）："{对白内容}""

【撰写铁律 — 必须遵守】：
1. 物理化动作：用"右手食指竖起轻摆""裙摆随转身扬起 30°"这类可物理模拟的描述，禁止抽象形容词
2. 运镜与动作分离：写"镜头固定，人物缓缓转身"，绝不写"镜头绕着转身的人旋转"
3. 一段一个运镜：从 固定/推/拉/摇/移/跟随/环绕 中选一个
4. 动作精确量化：方向+幅度+速度
5. 光线物理化：光源方向+色温+强度
6. 对白必须嵌入：如果该分镜有对白/旁白，必须用引号写入 suggestedPrompt（Seedance 会根据引号内容自动生成语音+唇形同步）。无对白时省略 [对白] 标签

【字数铁律 — 极其重要】：
单个分镜 suggestedPrompt 的**动作+运镜+光线**部分控制在 60-100 字以内。
但是：**对白部分不计入字数限制**！对白必须逐字完整引用，绝不省略。
即：suggestedPrompt = 运镜+动作+光线（60-100字）+ 完整对白（不限字数）。
原因：对白由 Seedance TTS 生成语音+唇形同步，任何省略都会导致成片配音缺失。
绝不堆砌多个动作、多个修饰词。主体长相由首帧图片锚定，禁止在 suggestedPrompt 里重复描述人物外貌。

【全局设定字数要求】：
globalSettings.artStyle 用关键词式短句（≤40字，如"古风仙侠3D写实，CG高清渲染"），
colorTone ≤30字（如"冷暗调为主，对战辅以金红高光"），避免长段堆砌。
`

/**
 * 把视频 URL 直传给多模态模型，解析为结构化分镜。
 *
 * @param videoUrl 视频的公网可访问 URL（OSS URL）
 * @param totalDuration 视频总时长（秒）
 */
export async function parseVideoDirectly(params: {
  videoUrl: string
  totalDuration: number
}): Promise<ParseVideoResult> {
  if (!API_KEY) {
    throw new Error('视频分析 API Key 未配置（VISION_API_KEY）')
  }
  if (!API_BASE_URL) {
    throw new Error('视频分析 API URL 未配置（VISION_API_URL）')
  }
  if (!MODEL) {
    throw new Error('视觉分析模型未配置（VISION_MODEL）')
  }

  const { videoUrl, totalDuration } = params
  const apiUrl = buildChatCompletionsUrl(API_BASE_URL)

  const userContent = [
    { type: 'video_url' as const, video_url: { url: videoUrl } },
    {
      type: 'text' as const,
      text: `这是一段 ${totalDuration.toFixed(1)} 秒的视频。请仔细观看完整视频（包括画面和音频），分析其中的分镜、运动、对白和音效，生成分镜脚本 JSON。注意听清视频中的对白并准确转录到 dialogue 字段中。`,
    },
  ]

  const content = await callModel(apiUrl, userContent, 0.3)

  // 解析 JSON
  const jsonStr = extractJson(content)
  let parsed = JSON.parse(jsonStr) as ParseVideoResult

  // Zod 校验，失败则 repair retry（带原始输出 + 错误信息让模型修正）
  const zodResult = ParseResultSchema.safeParse(parsed)
  if (!zodResult.success) {
    const repairContent = [
      {
        type: 'text' as const,
        text: `你之前返回的 JSON 数据校验失败，请修正后重新输出完整 JSON：\n\n` +
          `原始输出：\n\`\`\`json\n${jsonStr.substring(0, 3000)}\n\`\`\`\n\n` +
          `校验错误：\n${formatZodError(zodResult.error)}\n\n` +
          `请严格按照要求的 JSON 格式重新输出修正后的完整结果。只输出 JSON。`,
      },
    ]
    const repairText = await callModelWithHistory(
      apiUrl,
      userContent,
      content,
      repairContent,
      0.1
    )
    const repairParsed = JSON.parse(extractJson(repairText))
    const repairZodResult = ParseResultSchema.safeParse(repairParsed)
    if (!repairZodResult.success) {
      throw new Error(`视频分析格式校验失败（repair 后仍无法通过）: ${formatZodError(repairZodResult.error)}`)
    }
    parsed = repairZodResult.data as unknown as ParseVideoResult
    console.log('[video-analyzer] repair retry 成功')
  }

  // 时间线完整性检查与修正
  const timelineValidation = validateTimeline(parsed.shots)
  if (!timelineValidation.valid) {
    console.warn(`[video-analyzer] 时间线问题: ${timelineValidation.issues.join(', ')}，自动修正`)
    const repaired = repairTimeline(parsed.shots)
    parsed = { ...parsed, shots: repaired as ParsedShot[] }
  }

  if (!parsed.shots || !Array.isArray(parsed.shots) || parsed.shots.length === 0) {
    throw new Error('视频分析结果无有效分镜数据')
  }

  // 规范化 hasFace / frameType（缺失则抛错，不静默伪造）
  for (const shot of parsed.shots) {
    if (typeof shot.hasFace !== 'boolean') {
      throw new Error(`视频分析结果缺失 hasFace 字段（orderIndex=${shot.orderIndex}）`)
    }
    shot.frameType = shot.hasFace ? 'character' : 'scene'
  }

  return parsed
}

// ========================
// 内部辅助函数
// ========================

/**
 * 根据 API_BASE_URL 拼接 chat/completions 路径。
 * - 已以 /v1 或 /v3 结尾（如 DashScope 兼容模式、火山方舟）→ 直接追加 /chat/completions
 * - 包含 /api/v3（火山方舟）→ 追加 /chat/completions
 * - 其余 → 追加 /v1/chat/completions
 */
function buildChatCompletionsUrl(baseUrl: string): string {
  if (baseUrl.endsWith('/v1') || baseUrl.endsWith('/v3') || baseUrl.includes('/api/v3')) {
    return `${baseUrl}/chat/completions`
  }
  return `${baseUrl}/v1/chat/completions`
}

/** 单轮调用模型 */
async function callModel(apiUrl: string, userContent: unknown[], temperature: number): Promise<string> {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      temperature,
      max_tokens: 8192,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`视频分析 API 调用失败 (HTTP ${response.status}): ${errorText}`)
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string | null } }>
  }
  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('视频分析 API 返回内容为空')
  }
  return content
}

/** 带历史消息的 repair 调用 */
async function callModelWithHistory(
  apiUrl: string,
  userContent: unknown[],
  assistantContent: string,
  repairContent: unknown[],
  temperature: number
): Promise<string> {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
        { role: 'assistant', content: assistantContent },
        { role: 'user', content: repairContent },
      ],
      temperature,
      max_tokens: 8192,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`视频分析 repair API 调用失败 (HTTP ${response.status}): ${errorText}`)
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string | null } }>
  }
  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('视频分析 repair API 返回内容为空')
  }
  return content
}

/**
 * 从 AI 响应中提取 JSON（处理 markdown 代码块包裹）
 */
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
