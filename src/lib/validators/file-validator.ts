import { z } from 'zod/v4'

export const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'] as const
export const MAX_VIDEO_SIZE = 314572800 // 300MB
export const MAX_VIDEO_DURATION = 120 // 120 seconds

export const VideoFileSchema = z.object({
  fileName: z.string().min(1, '文件名不能为空'),
  fileSize: z.number().min(1, '文件大小不能为 0').max(MAX_VIDEO_SIZE, '文件大小不能超过 300MB'),
  mimeType: z.enum(ALLOWED_VIDEO_TYPES, { message: '仅支持 mp4、mov、webm 格式' }),
  duration: z.number().min(0.1, '视频时长不能为 0').max(MAX_VIDEO_DURATION, '视频时长不能超过 2 分钟'),
})

export type VideoFileInput = z.infer<typeof VideoFileSchema>

export function validateVideoFile(file: {
  fileName: string
  fileSize: number
  mimeType: string
  duration: number
}) {
  return VideoFileSchema.safeParse(file)
}
