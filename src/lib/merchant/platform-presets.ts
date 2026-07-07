/**
 * 平台适配导出配置
 *
 * 定义各本地生活平台的视频规格预设，用于一键生成多平台适配版本。
 *
 * 平台规格参考：
 * - 抖音本地生活：竖屏 9:16（1080x1920），15-45s 黄金时长
 * - 小红书探店：竖屏 3:4（1080x1440）首选，15-60s
 * - 视频号：竖屏 9:16，30-90s
 * - 通用：竖屏 9:16，不限时长
 */

// ========================
// 类型定义
// ========================

export interface PlatformPreset {
  /** 平台标识 */
  id: PlatformId
  /** 平台中文名 */
  label: string
  /** 画面比例 */
  ratio: string
  /** 输出分辨率 "宽x高" */
  resolution: string
  /** 输出宽度 */
  width: number
  /** 输出高度 */
  height: number
  /** 最大建议时长（秒），null 表示不限 */
  maxDuration: number | null
  /** 最大建议时长描述 */
  maxDurationLabel: string | null
  /** 封面比例 */
  coverRatio: string | null
  /** 平台特色说明 */
  tips: string
}

export type PlatformId = 'douyin_local' | 'xiaohongshu' | 'wechat_video' | 'universal'

// ========================
// 预设配置
// ========================

export const PLATFORM_PRESETS: Record<PlatformId, PlatformPreset> = {
  douyin_local: {
    id: 'douyin_local',
    label: '抖音本地生活',
    ratio: '9:16',
    resolution: '1080x1920',
    width: 1080,
    height: 1920,
    maxDuration: 45,
    maxDurationLabel: '45秒',
    coverRatio: '9:16',
    tips: '竖屏 9:16，15-45s 黄金时长，POI 标签加权，完播率 > 30% 目标',
  },
  xiaohongshu: {
    id: 'xiaohongshu',
    label: '小红书',
    ratio: '3:4',
    resolution: '1080x1440',
    width: 1080,
    height: 1440,
    maxDuration: 60,
    maxDurationLabel: '60秒',
    coverRatio: '3:4',
    tips: '竖屏 3:4 首选，15-60s，真实感 > 精修感，封面即信息密度',
  },
  wechat_video: {
    id: 'wechat_video',
    label: '视频号',
    ratio: '9:16',
    resolution: '1080x1920',
    width: 1080,
    height: 1920,
    maxDuration: 90,
    maxDurationLabel: '90秒',
    coverRatio: '9:16',
    tips: '竖屏 9:16，30-90s，社交裂变加权',
  },
  universal: {
    id: 'universal',
    label: '通用',
    ratio: '9:16',
    resolution: '1080x1920',
    width: 1080,
    height: 1920,
    maxDuration: null,
    maxDurationLabel: null,
    coverRatio: null,
    tips: '竖屏 9:16，不限时长，适配多平台',
  },
}

/** 所有平台 ID 列表 */
export const ALL_PLATFORM_IDS = Object.keys(PLATFORM_PRESETS) as PlatformId[]

/** 获取平台预设 */
export function getPlatformPreset(id: PlatformId): PlatformPreset {
  return PLATFORM_PRESETS[id]
}

/** 根据比例字符串解析宽高 */
export function parseRatio(ratio: string): { w: number; h: number } {
  const [w, h] = ratio.split(':').map(Number)
  return { w, h }
}

/**
 * 计算从源分辨率裁切/缩放到目标分辨率的 FFmpeg filter 参数
 *
 * 策略：
 * 1. 先按比例裁切（crop）到目标比例
 * 2. 再缩放到目标分辨率（scale）
 *
 * @param srcWidth 源宽度
 * @param srcHeight 源高度
 * @param targetWidth 目标宽度
 * @param targetHeight 目标高度
 * @returns FFmpeg filter 字符串
 */
export function buildCropScaleFilter(
  srcWidth: number,
  srcHeight: number,
  targetWidth: number,
  targetHeight: number,
): string {
  const srcRatio = srcWidth / srcHeight
  const targetRatio = targetWidth / targetHeight

  if (Math.abs(srcRatio - targetRatio) < 0.01) {
    // 比例基本一致，直接缩放
    return `scale=${targetWidth}:${targetHeight}`
  }

  if (srcRatio > targetRatio) {
    // 源更宽，裁切左右
    const cropW = Math.round(srcHeight * targetRatio)
    const cropX = Math.round((srcWidth - cropW) / 2)
    return `crop=${cropW}:${srcHeight}:${cropX}:0,scale=${targetWidth}:${targetHeight}`
  } else {
    // 源更高，裁切上下
    const cropH = Math.round(srcWidth / targetRatio)
    const cropY = Math.round((srcHeight - cropH) / 2)
    return `crop=${srcWidth}:${cropH}:0:${cropY},scale=${targetWidth}:${targetHeight}`
  }
}

/**
 * 获取推荐话题标签（按平台）
 */
export function getPlatformHashtags(platformId: PlatformId, city?: string, category?: string): string[] {
  const base: Record<PlatformId, string[]> = {
    douyin_local: ['同城美食', '探店', '本地生活', '宝藏小店'],
    xiaohongshu: ['探店日记', '好物分享', '周末好去处', '拍照打卡'],
    wechat_video: ['生活记录', '日常分享', '推荐', '好店推荐'],
    universal: ['探店', '推荐', '好物分享'],
  }

  const tags = [...base[platformId]]

  if (city) {
    tags.unshift(`${city}探店`, `${city}美食`)
  }
  if (category) {
    tags.unshift(category)
  }

  return tags.slice(0, 8)
}
