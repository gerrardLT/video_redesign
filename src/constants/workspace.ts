/**
 * 工作台（Workspace）常量定义
 *
 * 包含文件上传限制、模型时长映射、灵感模板等配置。
 */

import type { WorkspaceModel, WorkspaceAssetType, InspirationTemplate } from '@/types/workspace'

// ========================
// 文件上传限制
// ========================

/** 单种素材类型的限制配置 */
export interface FileLimitConfig {
  /** 最大文件大小（字节） */
  maxSize: number
  /** 允许的 MIME 类型列表 */
  types: string[]
}

/** 各类素材文件限制 */
export const FILE_LIMITS: Record<WorkspaceAssetType, FileLimitConfig> = {
  image: {
    maxSize: 10 * 1024 * 1024, // 10MB
    types: ['image/jpeg', 'image/png', 'image/webp'],
  },
  video: {
    maxSize: 100 * 1024 * 1024, // 100MB
    types: ['video/mp4', 'video/quicktime', 'video/webm'],
  },
  audio: {
    maxSize: 20 * 1024 * 1024, // 20MB
    types: ['audio/mpeg', 'audio/wav', 'audio/aac'],
  },
} as const

/** 单次生成最多关联的参考素材数量 */
export const MAX_WORKSPACE_ASSETS = 12

/** Prompt 最大字符数 */
export const MAX_PROMPT_LENGTH = 2500

// ========================
// 模型时长映射
// ========================

/** 各模型可选时长（秒） */
export const MODEL_DURATION_OPTIONS: Record<WorkspaceModel, number[]> = {
  seedance: [4, 5, 8, 10, 15],
  happyhorse: [3, 5, 8, 10, 15],
} as const

/** 各模型默认时长（秒） */
export const MODEL_DEFAULT_DURATION: Record<WorkspaceModel, number> = {
  seedance: 5,
  happyhorse: 5,
} as const

/** 各模型时长范围描述 */
export const MODEL_DURATION_RANGE: Record<WorkspaceModel, string> = {
  seedance: '4-15s',
  happyhorse: '3-15s',
} as const

// ========================
// 模型信息
// ========================

/** 模型展示信息 */
export interface ModelInfo {
  id: WorkspaceModel
  name: string
  description: string
  badge: string
  durationRange: string
}

export const MODEL_INFO: ModelInfo[] = [
  {
    id: 'seedance',
    name: 'Seedance 2.0',
    description: '火山方舟视频生成大模型',
    badge: '文/图/视频/音频 全模态输入',
    durationRange: '4-15s',
  },
  {
    id: 'happyhorse',
    name: 'HappyHorse',
    description: '阿里百炼视频生成模型',
    badge: '支持真人脸风格化转换',
    durationRange: '3-15s',
  },
] as const

// ========================
// 灵感模板（≥6 个）
// ========================

export const INSPIRATION_TEMPLATES: InspirationTemplate[] = [
  {
    id: 'cyberpunk-street',
    text: '赛博朋克街道，霓虹灯映在雨水中，镜头缓慢推进，电影感画面',
    tag: '科幻',
  },
  {
    id: 'golden-shiba',
    text: '一只威风凛凛的金色柴犬奔跑在广袤雪原上，慢动作特写',
    tag: '动物',
  },
  {
    id: 'snow-mountain-lake',
    text: '雪山脚下宁静的湖泊，日落时分电影感光影，航拍视角缓缓上升',
    tag: '风光',
  },
  {
    id: 'ink-crane',
    text: '水墨画风格飞鹤掠过连绵山峰，慢动作，画面逐渐展开如卷轴',
    tag: '国风',
  },
  {
    id: 'sakura-anime',
    text: '少女走在樱花隧道中，花瓣纷飞，动漫风格，柔和光线',
    tag: '动漫',
  },
  {
    id: 'future-city',
    text: '未来城市夜景，飞行汽车穿梭天际线，俯拍全景，科技感十足',
    tag: '科幻',
  },
  {
    id: 'ocean-sunset',
    text: '金色夕阳洒在海面上，海浪轻柔拍打沙滩，第一视角漫步',
    tag: '治愈',
  },
  {
    id: 'dance-energetic',
    text: '都市街头，年轻人充满活力地跳街舞，快节奏剪辑，运动感镜头',
    tag: '人物',
  },
] as const
