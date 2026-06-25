/**
 * 工作台（Workspace）类型定义
 *
 * 工作台是快速单次视频生成页面，与「分镜工厂」互补。
 * 用户输入 prompt + 上传参考素材 + 选择模型 → 一键生成视频。
 */

/** 支持的生成模型 */
export type WorkspaceModel = 'seedance' | 'happyhorse'

/** 画面比例 */
export type WorkspaceAspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9'

/** 分辨率 */
export type WorkspaceResolution = '480p' | '720p' | '1080p'

/** 参考素材类型 */
export type WorkspaceAssetType = 'image' | 'video' | 'audio'

/** 参考素材上传状态 */
export type WorkspaceAssetStatus = 'uploading' | 'uploaded' | 'failed'

/** 生成流程状态 */
export type WorkspaceGenerateStatus = 'idle' | 'submitting' | 'generating' | 'completed' | 'failed'

/** 已上传的参考素材 */
export interface WorkspaceAsset {
  /** 客户端临时 ID */
  id: string
  /** 原始文件名 */
  fileName: string
  /** 文件大小（字节） */
  fileSize: number
  /** 素材类型 */
  type: WorkspaceAssetType
  /** MIME 类型 */
  mimeType: string
  /** 上传完成后的 OSS URL */
  ossUrl: string
  /** 缩略图 URL（图片/视频有，音频无） */
  thumbUrl?: string
  /** 上传进度 0-100 */
  uploadProgress: number
  /** 上传状态 */
  status: WorkspaceAssetStatus
}

/** 生成请求参数（前端 → API） */
export interface WorkspaceGenerateRequest {
  prompt: string
  model: WorkspaceModel
  aspectRatio: WorkspaceAspectRatio
  duration: number
  resolution: WorkspaceResolution
  /** 参考素材 OSS URL 列表（最多 12 个） */
  assetUrls: string[]
  /** 素材类型映射 { url: type } */
  assetTypes: Record<string, WorkspaceAssetType>
}

/** 生成响应（API → 前端） */
export interface WorkspaceGenerateResponse {
  jobId: string
  projectId: string
  estimatedCost: number
}

/** 画廊 Tab 类型 */
export type GalleryTab = 'discover' | 'my'

/** 画廊查询参数 */
export interface GalleryQuery {
  tab: GalleryTab
  page?: number
  pageSize?: number
}

/** 画廊单项 */
export interface GalleryItem {
  /** GenerationJob ID */
  id: string
  projectId: string
  /** 视频播放 URL（鉴权代理） */
  videoUrl: string
  /** 封面缩略图 */
  coverUrl?: string
  /** prompt 快照 */
  prompt: string
  /** 使用的模型 */
  model: WorkspaceModel
  /** 视频时长（秒） */
  duration: number
  /** 画面比例 */
  aspectRatio: string
  /** 生成时间 ISO 8601 */
  createdAt: string
}

/** 画廊列表响应 */
export interface GalleryResponse {
  items: GalleryItem[]
  total: number
  hasMore: boolean
}

/** 素材上传响应 */
export interface WorkspaceUploadResponse {
  /** OSS URL */
  url: string
  /** 缩略图 URL（图片/视频有） */
  thumbUrl?: string
  /** 素材类型 */
  type: WorkspaceAssetType
  /** 文件大小（字节） */
  fileSize: number
}

/** 灵感模板项 */
export interface InspirationTemplate {
  /** 唯一标识 */
  id: string
  /** 模板文本 */
  text: string
  /** 风格标签（可选） */
  tag?: string
}
