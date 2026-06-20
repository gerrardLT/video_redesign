/**
 * 视频分析客户端
 * 通过 OpenAI 兼容接口，将视频 URL 直传给多模态模型（Doubao-Seed-2.0-Pro / Qwen-VL 等）解析为结构化分镜。
 *
 * 推荐模型：doubao-seed-2-0-pro-260215（火山方舟，Video-MME-v2 排名 #3，视频理解能力强）
 * 备选模型：qwen-vl-max（阿里云百炼 DashScope，成本低但视频理解能力弱一档）
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
  characters: Array<{
    name: string
    appearance: string
    /** 角色外观四维度详细描述（可选，AI 模型可能未返回） */
    appearanceDetail?: {
      hair: string
      clothing: string
      accessories: string
      makeup: string
    }
  }>
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
      "characters": [{"name": "人物名", "appearance": "外貌详细描述", "appearanceDetail": {"hair": "发型发色描述", "clothing": "服装款式颜色描述", "accessories": "配饰描述（无则空字符串）", "makeup": "妆容描述（无则空字符串）"}}],
      "suggestedPrompt": "按下方格式要求生成",
      "hasFace": true
    }
  ]
}

规则：
1. 按视频中真实的镜头切换点切分分镜，startTime/endTime 必须基于视频真实时间。如果用户消息中提供了 FFmpeg 检测到的剪辑点，必须严格以此为准，每个剪辑点独立输出一个分镜（即使时长很短也不要合并）。没有剪辑点的连续镜头不要强行拆分（除非超过 15s）
2. globalSettings 是全片统一设定，所有分镜共享同一套美术风格和角色外貌
3. scene 必须包含：场所类型 + 光线条件 + 前后景物体
4. characters.appearance 必须包含：性别 + 年龄段 + 发型发色 + 服装 + 配饰 + 特殊标记
5. characters.appearanceDetail 是对角色外观的四维度结构化拆分（hair: 发型发色, clothing: 服装款式颜色, accessories: 配饰, makeup: 妆容），用于后续精确比对角色造型变化。无法识别的维度输出空字符串
6. cameraMove 只能从以下选取一个：固定、推、拉、摇、移、跟随、环绕
7. dialogue 必须准确转录视频音频中听到的对白，逐字逐句完整记录，绝不省略、绝不缩写、绝不合并。哪怕对白很长也必须完整写出。无对白则留空数组
8. hasFace：判断该分镜是否包含清晰可辨识的人脸（正脸、侧脸均算）
9. 只输出 JSON，不要其他解释文字
10. 【对白完整性最高优先级】：dialogue.text 必须包含该时间段内说话者的每一个字，包括语气词、重复词、口头禅。宁可多写也绝不漏字。suggestedPrompt 中引号内的对白同样必须完整，与 dialogue.text 一致

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
  /** FFmpeg 检测到的真实剪辑点时间戳（秒）。空数组表示一镜到底。 */
  sceneCuts?: number[]
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

  const { videoUrl, totalDuration, sceneCuts = [] } = params
  const apiUrl = buildChatCompletionsUrl(API_BASE_URL)

  // 累计 token 消耗追踪（首次调用 + 可能的 repair 调用）
  let totalInputTokens = 0
  let totalOutputTokens = 0

  // 包装 callModel 以累加 token
  const trackUsage = (usage: { prompt_tokens?: number; completion_tokens?: number } | undefined) => {
    if (usage) {
      totalInputTokens += usage.prompt_tokens ?? 0
      totalOutputTokens += usage.completion_tokens ?? 0
    }
  }

  // 构建剪辑点辅助信息，约束 AI 分镜行为
  let sceneCutGuide = ''
  if (sceneCuts.length === 0) {
    if (totalDuration <= 15) {
      // 一镜到底且 ≤15s：整段作为一个分镜
      sceneCutGuide = `\n\n【重要：FFmpeg 场景检测结果】\n此视频**没有检测到任何剪辑点**，是一镜到底的连续拍摄。视频总时长 ${totalDuration.toFixed(1)}s ≤ 15s，请将整段视频作为**一个分镜**输出，不要拆分。`
    } else {
      // 一镜到底但超 15s：让 AI 根据内容节奏切，每段 4-15s
      sceneCutGuide = `\n\n【重要：FFmpeg 场景检测结果】\n此视频**没有检测到任何剪辑点**，是一镜到底的连续拍摄。但视频总时长 ${totalDuration.toFixed(1)}s 超过 15s（生成引擎上限），请根据动作变化、对白节奏等内容节奏找合适的切点，将视频切成每段 4-15 秒的分镜。切点应选在动作间歇或对白停顿处，保证每段内容连贯完整。`
    }
  } else {
    // 有真实剪辑点：告诉 AI 按剪辑点独立输出每个分镜（不合并），分组交给代码层
    const cutsStr = sceneCuts.map(t => `${t.toFixed(1)}s`).join(', ')
    sceneCutGuide = `\n\n【重要：FFmpeg 场景检测结果】\nFFmpeg 在以下时间点检测到真实的画面剪辑/转场：[${cutsStr}]。\n请严格以这些剪辑点作为分镜切分的边界，每个剪辑点独立输出一个分镜，即使时长不足 4 秒也不要合并（后续系统会自动处理分组合并）。如果两个相邻剪辑点之间超过 15s，可以在该段内部根据动作/对白节奏做二次切分（每段不超过 15s）。`
  }

  const userContent = [
    { type: 'video_url' as const, video_url: { url: videoUrl } },
    {
      type: 'text' as const,
      text: `这是一段 ${totalDuration.toFixed(1)} 秒的视频。请仔细观看完整视频（包括画面和音频），分析其中的分镜、运动、对白和音效，生成分镜脚本 JSON。注意听清视频中的对白并准确转录到 dialogue 字段中。${sceneCutGuide}`,
    },
  ]

  // Seed-2.0-Pro 带 reasoning 思考链，temperature 不宜压低（会限制思考探索），使用默认值
  const { content, usage: firstUsage } = await callModel(apiUrl, userContent, undefined)
  trackUsage(firstUsage)

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
    const repairResult = await callModelWithHistory(
      apiUrl,
      userContent,
      content,
      repairContent,
      0.1
    )
    trackUsage(repairResult.usage)
    const repairParsed = JSON.parse(extractJson(repairResult.content))
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

  // 输出视频解析总成本汇总（火山方舟官方定价：input ¥3.2/M, output ¥16.0/M）
  const totalInputCostRMB = (totalInputTokens / 1_000_000) * 3.2
  const totalOutputCostRMB = (totalOutputTokens / 1_000_000) * 16.0
  const totalCostRMB = totalInputCostRMB + totalOutputCostRMB
  console.log(
    `[video-analyzer] ═══ 解析总计 ═══ input=${totalInputTokens} output=${totalOutputTokens} tokens | ` +
    `总成本: ¥${totalCostRMB.toFixed(4)} | 分镜数: ${parsed.shots.length}`
  )

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

/** 单轮调用模型，返回 content + usage */
async function callModel(apiUrl: string, userContent: unknown[], temperature?: number): Promise<{ content: string; usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number }; prompt_tokens_details?: { cached_tokens?: number } } }> {
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
      // 带 reasoning 的模型（如 Seed-2.0-Pro）不传 temperature 让模型走最优默认值；
      // 普通模型（如 qwen-vl-max）可显式传入 0.3 控制确定性
      ...(temperature !== undefined ? { temperature } : {}),
      max_tokens: 16384,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`视频分析 API 调用失败 (HTTP ${response.status}): ${errorText}`)
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string | null; reasoning_content?: string | null } }>
    usage?: {
      prompt_tokens?: number
      completion_tokens?: number
      total_tokens?: number
      prompt_tokens_details?: { cached_tokens?: number }
      completion_tokens_details?: { reasoning_tokens?: number }
    }
  }
  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('视频分析 API 返回内容为空')
  }

  // 记录 token 消耗和真实成本（Doubao-Seed-2.0-Pro 火山方舟定价：input $0.47/M, output $2.37/M）
  if (data.usage) {
    const inputTokens = data.usage.prompt_tokens ?? 0
    const outputTokens = data.usage.completion_tokens ?? 0
    const reasoningTokens = data.usage.completion_tokens_details?.reasoning_tokens ?? 0
    const cachedTokens = data.usage.prompt_tokens_details?.cached_tokens ?? 0
    // 火山方舟 Seed-2.0-Pro 官方定价（元/百万tokens，输入长度[0,32K]档位）：input ¥3.2/M, output ¥16.0/M
    const inputCostRMB = (inputTokens / 1_000_000) * 3.2
    const outputCostRMB = (outputTokens / 1_000_000) * 16.0
    const totalCostRMB = inputCostRMB + outputCostRMB
    console.log(
      `[video-analyzer] Token 消耗: input=${inputTokens}(cached=${cachedTokens}) output=${outputTokens}(reasoning=${reasoningTokens}) total=${inputTokens + outputTokens} | ` +
      `成本: input=¥${inputCostRMB.toFixed(4)} output=¥${outputCostRMB.toFixed(4)} 合计=¥${totalCostRMB.toFixed(4)}`
    )
  }

  return { content, usage: data.usage }
}

/** 带历史消息的 repair 调用 */
async function callModelWithHistory(
  apiUrl: string,
  userContent: unknown[],
  assistantContent: string,
  repairContent: unknown[],
  temperature?: number
): Promise<{ content: string; usage?: { prompt_tokens?: number; completion_tokens?: number } }> {
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
      // repair 阶段用低温度（纯纠错不需要探索性）
      ...(temperature !== undefined ? { temperature } : {}),
      max_tokens: 16384,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`视频分析 repair API 调用失败 (HTTP ${response.status}): ${errorText}`)
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string | null; reasoning_content?: string | null } }>
    usage?: {
      prompt_tokens?: number
      completion_tokens?: number
      total_tokens?: number
      completion_tokens_details?: { reasoning_tokens?: number }
    }
  }
  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('视频分析 repair API 返回内容为空')
  }

  // 记录 repair 调用的 token 消耗
  if (data.usage) {
    const inputTokens = data.usage.prompt_tokens ?? 0
    const outputTokens = data.usage.completion_tokens ?? 0
    const inputCostRMB = (inputTokens / 1_000_000) * 3.2
    const outputCostRMB = (outputTokens / 1_000_000) * 16.0
    console.log(
      `[video-analyzer] Repair Token 消耗: input=${inputTokens} output=${outputTokens} | 成本: ¥${(inputCostRMB + outputCostRMB).toFixed(4)}`
    )
  }

  return { content, usage: data.usage }
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
