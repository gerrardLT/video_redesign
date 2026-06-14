/**
 * 风格服务
 * 提供风格模板查询、项目风格配置管理和 prompt 前缀拼接功能
 */
import { z } from 'zod'
import { prisma } from './db'

// ========================
// Zod 校验 Schema
// ========================

/** 保存风格配置的输入校验 */
export const StyleConfigInputSchema = z.object({
  templateId: z.string().optional(),
  customDescription: z
    .string()
    .max(500, '描述不能超过500字')
    .optional(),
})

export type StyleConfigInput = z.infer<typeof StyleConfigInputSchema>

// ========================
// 风格模板查询
// ========================

/**
 * 获取所有激活的风格模板列表，按 sortOrder 排序
 */
export async function getTemplates() {
  return prisma.styleTemplate.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  })
}

/**
 * 获取单个模板详情
 */
export async function getTemplate(id: string) {
  return prisma.styleTemplate.findUnique({
    where: { id },
  })
}

// ========================
// 项目风格配置
// ========================

/**
 * 获取项目当前风格配置（含关联的模板信息）
 */
export async function getProjectStyle(projectId: string) {
  return prisma.styleConfig.findUnique({
    where: { projectId },
    include: { template: true },
  })
}

/**
 * 设置项目风格配置（Upsert）
 * 支持 templateId、customDescription 或混合配置
 */
export async function saveProjectStyle(
  projectId: string,
  input: StyleConfigInput
) {
  // Zod 校验输入
  const validated = StyleConfigInputSchema.parse(input)

  // 如果指定了 templateId，验证模板存在且激活
  if (validated.templateId) {
    const template = await prisma.styleTemplate.findUnique({
      where: { id: validated.templateId },
    })
    if (!template) {
      throw new Error('风格模板不存在')
    }
    if (!template.isActive) {
      throw new Error('风格模板已不可用')
    }
  }

  return prisma.styleConfig.upsert({
    where: { projectId },
    create: {
      projectId,
      templateId: validated.templateId ?? null,
      customDescription: validated.customDescription ?? null,
    },
    update: {
      templateId: validated.templateId ?? null,
      customDescription: validated.customDescription ?? null,
    },
    include: { template: true },
  })
}

// ========================
// Prompt 前缀构建
// ========================

/**
 * 获取项目的风格 prompt 前缀
 *
 * 拼接规则：
 * - 如果有模板：使用 template.promptPrefix
 * - 如果有自定义描述：追加 customDescription
 * - 如果两者都有：`${promptPrefix}, ${customDescription}`
 * - 如果项目没设置风格：返回空字符串
 *
 * 最终融合到分镜 prompt 的方式：
 * `${stylePrompt}${stylePrompt ? ', ' : ''}${originalPrompt}`
 */
export async function buildStylePrompt(projectId: string): Promise<string> {
  const config = await prisma.styleConfig.findUnique({
    where: { projectId },
    include: { template: true },
  })

  if (!config) {
    return ''
  }

  const parts: string[] = []

  if (config.template?.promptPrefix) {
    parts.push(config.template.promptPrefix)
  }

  if (config.customDescription) {
    parts.push(config.customDescription)
  }

  return parts.join(', ')
}
