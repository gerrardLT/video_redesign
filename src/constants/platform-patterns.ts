/**
 * 支持的视频平台 URL 正则规则
 * 用于验证用户粘贴的分享链接格式
 */
export const PLATFORM_PATTERNS = [
  {
    platform: 'douyin' as const,
    label: '抖音',
    patterns: [
      /https?:\/\/(www\.)?douyin\.com\/video\/\d+/,
      /https?:\/\/v\.douyin\.com\/\w+/,
    ],
  },
  {
    platform: 'kuaishou' as const,
    label: '快手',
    patterns: [
      /https?:\/\/(www\.)?kuaishou\.com\/short-video\/\w+/,
      /https?:\/\/v\.kuaishou\.com\/\w+/,
    ],
  },
  {
    platform: 'weixin' as const,
    label: '微信视频号',
    patterns: [
      /https?:\/\/channels\.weixin\.qq\.com\/\w+/,
    ],
  },
] as const

/** 支持的视频平台类型 */
export type VideoPlatform = typeof PLATFORM_PATTERNS[number]['platform']
