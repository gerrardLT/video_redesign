import { z } from 'zod/v4'

// 用户角色
export const RoleSchema = z.enum(['USER', 'ADMIN'])
export type Role = z.infer<typeof RoleSchema>

// 项目状态
// 真实流程：PARSING → EDITABLE → GENERATING → EXPORTED；合并失败置 MERGE_FAILED（可只重试合并）
// MERGE_FAILED 区别于生成 FAILED，使用户在不重新生成的前提下只重试合并
export const ProjectStatusSchema = z.enum([
  'PARSING', 'EDITABLE', 'GENERATING', 'EXPORTED', 'MERGE_FAILED', 'FAILED'
])
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>

// 分镜生成状态
export const GenStatusSchema = z.enum([
  'PENDING', 'QUEUED', 'GENERATING', 'SUCCEEDED', 'FAILED', 'CANCELED'
])
export type GenStatus = z.infer<typeof GenStatusSchema>

// 生成任务状态
export const JobStatusSchema = z.enum([
  'CREATED', 'QUEUED', 'CREDIT_RESERVED', 'SUBMITTED', 'GENERATING',
  'SUCCEEDED', 'FAILED', 'CANCELED', 'REFUNDED'
])
export type JobStatus = z.infer<typeof JobStatusSchema>

// 素材类型
export const AssetTypeSchema = z.enum([
  'CHARACTER_IMAGE', 'UPLOADED_IMAGE', 'AI_GENERATED'
])
export type AssetType = z.infer<typeof AssetTypeSchema>

// 积分动作类型
export const CreditActionSchema = z.enum([
  'RESERVE', 'CHARGE', 'REFUND', 'ADMIN_ADJUST'
])
export type CreditAction = z.infer<typeof CreditActionSchema>

// 视频生成参数
export const DurationSchema = z.enum(['4', '6', '8', '10', '15'])
export type Duration = z.infer<typeof DurationSchema>

export const AspectRatioSchema = z.enum(['9:16', '16:9', '1:1'])
export type AspectRatio = z.infer<typeof AspectRatioSchema>

export const ResolutionSchema = z.enum(['480p', '720p'])
export type Resolution = z.infer<typeof ResolutionSchema>

// 案例展示分类
export const ShowcaseCategorySchema = z.enum([
  'brand', 'education', 'ecommerce', 'entertainment',
  'technology', 'lifestyle', 'travel', 'other'
])
export type ShowcaseCategory = z.infer<typeof ShowcaseCategorySchema>

// 帮助文章板块
export const HelpSectionSchema = z.enum(['quickstart', 'guide', 'faq'])
export type HelpSection = z.infer<typeof HelpSectionSchema>

// 资产审核状态（扩展）
export const AssetStatusSchema = z.enum([
  'UPLOADED', 'CHECKING', 'APPROVED', 'REJECTED', 'CHECK_FAILED', 'GENERATED', 'EXPIRED'
])
export type AssetStatus = z.infer<typeof AssetStatusSchema>

// 视频下载任务状态
export const DownloadTaskStatusSchema = z.enum([
  'PENDING', 'DOWNLOADING', 'COMPLETED', 'FAILED'
])
export type DownloadTaskStatus = z.infer<typeof DownloadTaskStatusSchema>
