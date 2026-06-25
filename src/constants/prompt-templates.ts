/**
 * Prompt 模板常量定义
 *
 * 预置风格模板供 TemplatePicker 组件一键填入 Prompt。
 * 每个模板包含唯一 id、显示名称、图标和完整 Prompt 文本。
 */

/** Prompt 模板接口 */
export interface PromptTemplate {
  /** 唯一标识 */
  id: string
  /** 显示名称（如 "动漫风"） */
  name: string
  /** emoji 图标 */
  icon: string
  /** 模板 Prompt 文本 */
  prompt: string
}

/** 内置风格模板列表（至少 3 种） */
export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'anime',
    name: '动漫风',
    icon: '🎨',
    prompt: '将视频转换为日系动漫风格，保持人物动作和表情不变，色彩鲜明，线条流畅，背景简化为动漫场景',
  },
  {
    id: 'cyberpunk',
    name: '赛博朋克',
    icon: '🌆',
    prompt: '将视频转换为赛博朋克风格，添加霓虹灯光效果、暗色调科技感、数字化UI元素叠加，保持人物主体不变',
  },
  {
    id: 'ink-painting',
    name: '水墨国风',
    icon: '🖌️',
    prompt: '将视频转换为中国水墨画风格，笔触飘逸写意，黑白为主淡彩点缀，背景化为山水意境，人物保持辨识度',
  },
  {
    id: 'oil-painting',
    name: '油画风',
    icon: '🖼️',
    prompt: '将视频转换为古典油画风格，笔触厚重有质感，色彩饱满温暖，光影明暗分明，如同文艺复兴时期的画作',
  },
  {
    id: 'pixel-art',
    name: '像素风',
    icon: '👾',
    prompt: '将视频转换为复古像素风格，低分辨率像素化处理，色彩鲜明有限调色板，保持人物轮廓可识别',
  },
]
