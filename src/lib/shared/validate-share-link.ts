/**
 * 视频分享链接格式验证（纯客户端安全，无 Node.js 依赖）
 * 供前端组件和服务端共同引用
 *
 * 支持两种输入方式：
 * 1. 纯 URL（如 https://v.douyin.com/xxx）
 * 2. 带有分享文案的完整文本（如抖音分享口令），自动从中提取 URL
 *
 * 平台策略：
 * - 已知平台（抖音/快手/视频号）：立即识别并展示平台图标
 * - 其他 http/https 链接：也放行（yt-dlp 支持 1000+ 平台），标记为 'other'
 * - 下载失败由 Worker 层报真实错误，前端不提前拦截
 */
import { PLATFORM_PATTERNS, type VideoPlatform } from '@/constants/platform-patterns'

/** 扩展平台类型：已知平台 + 通用其他平台 */
export type ExtendedPlatform = VideoPlatform | 'other'

export interface ValidateResult {
  valid: boolean
  platform?: ExtendedPlatform
  /** 提取/规整后的纯净 URL（成功时有值），调用方应使用此字段作为实际请求地址 */
  extractedUrl?: string
  error?: string
}

/**
 * 从分享文案中提取第一个 http/https 链接
 * 适用场景：用户从抖音/快手等 App 复制的分享文本（含口令码 + 标题 + 链接 + 引导文案）
 *
 * 示例输入：
 *   `5.89 F@H.IV 04/25 bNJ:/ :8pm "其实我给你的爱比你想得多~" https://v.douyin.com/HCI5EgJn6DU/ 复制此链接，打开Dou音搜索`
 * 输出：
 *   `https://v.douyin.com/HCI5EgJn6DU/`
 */
function extractUrlFromText(text: string): string | null {
  // 匹配 http/https 开头、遇到空白或中文字符截断的 URL
  const urlMatch = text.match(/https?:\/\/[^\s\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+/)
  return urlMatch ? urlMatch[0] : null
}

/**
 * 验证分享链接格式
 * - 已知平台：返回具体 platform
 * - 未知但有效的 URL：platform='other'，也允许通过（交给 yt-dlp 处理）
 * - 支持直接粘贴分享文案（自动从中提取 URL）
 *
 * @param input - 用户粘贴的链接或分享文案
 * @returns { valid, platform, extractedUrl, error }
 */
export function validateShareLink(input: string): ValidateResult {
  // 1. 基础验证 - 不为空
  if (!input || !input.trim()) {
    return { valid: false, error: '请输入视频链接' }
  }

  const trimmed = input.trim()

  // 2. 确定待验证的 URL：如果输入本身就是 URL 直接用，否则从文本中提取
  let url: string
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    url = trimmed
  } else {
    // 尝试从分享文案中提取 URL
    const extracted = extractUrlFromText(trimmed)
    if (!extracted) {
      return { valid: false, error: '未识别到视频链接，请粘贴包含链接的分享文案或直接输入链接' }
    }
    url = extracted
  }

  // 3. 优先匹配已知平台（展示平台图标）
  for (const { platform, patterns } of PLATFORM_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(url)) {
        return { valid: true, platform, extractedUrl: url }
      }
    }
  }

  // 4. 未匹配已知平台但是有效 URL → 也放行，标记为 'other'（yt-dlp 支持 1000+ 平台）
  return { valid: true, platform: 'other', extractedUrl: url }
}
