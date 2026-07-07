import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'
import { saveProjectStyle, StyleConfigInputSchema } from '@/lib/shared/style-service'
import { parseStructuredStyle, renderStructuredStyleToText, type StructuredStyle } from '@/types/style'
import { z } from 'zod/v4'

export const dynamic = 'force-dynamic'

/** 结构化风格更新 schema */
const StructuredStyleUpdateSchema = z.object({
  artStyle: z.string().optional(),
  colorTone: z.string().optional(),
  characters: z.array(z.object({
    name: z.string(),
    appearance: z.string(),
    props: z.string().optional(),
  })).optional(),
  subtitleDeclaration: z.string().optional(),
  extra: z.string().optional(),
  // 向后兼容：直接传 customDescription 也行
  customDescription: z.string().optional(),
  templateId: z.string().optional(),
})

/**
 * GET /api/projects/[id]/style - 获取项目风格设定（返回结构化 + 扁平）
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = request.headers.get('x-user-id')!
    const { id } = await params

    const project = await prisma.project.findFirst({
      where: { id, userId },
      select: { id: true },
    })
    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }

    const styleConfig = await prisma.styleConfig.findUnique({
      where: { projectId: id },
      include: { template: true },
    })

    // 解析结构化字段
    const structured = parseStructuredStyle(styleConfig?.structuredStyle)

    return NextResponse.json({
      styleConfig: {
        id: styleConfig?.id,
        templateId: styleConfig?.templateId,
        customDescription: styleConfig?.customDescription,
        structured,
        template: styleConfig?.template,
      },
    })
  } catch (error) {
    console.error('[GET /api/projects/[id]/style]', error)
    return NextResponse.json({ error: '获取风格设定失败' }, { status: 500 })
  }
}

/**
 * PUT /api/projects/[id]/style - 更新项目风格设定
 * 支持结构化字段（artStyle/colorTone/characters/...）或纯 customDescription
 * 结构化字段变更时自动同步更新 customDescription（双写）
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = request.headers.get('x-user-id')!
    const { id } = await params
    const body = await request.json()

    // 校验项目归属
    const project = await prisma.project.findFirst({
      where: { id, userId },
      select: { id: true, status: true },
    })
    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }

    if (project.status !== 'EDITABLE' && project.status !== 'FAILED') {
      return NextResponse.json(
        { error: `项目状态为 ${project.status}，无法编辑风格设定` },
        { status: 400 }
      )
    }

    const parseResult = StructuredStyleUpdateSchema.safeParse(body)
    if (!parseResult.success) {
      const firstError = parseResult.error.issues[0]?.message || '参数校验失败'
      return NextResponse.json({ error: firstError }, { status: 400 })
    }

    const input = parseResult.data

    // 判断是结构化更新还是纯文本更新
    const hasStructuredFields = input.artStyle !== undefined || input.colorTone !== undefined ||
      input.characters !== undefined || input.subtitleDeclaration !== undefined || input.extra !== undefined

    let structuredStyle: string | null = null
    let customDescription: string | null = input.customDescription ?? null

    if (hasStructuredFields) {
      // 结构化更新：读取现有 structured，合并变更，同步渲染 customDescription
      const existing = await prisma.styleConfig.findUnique({ where: { projectId: id } })
      const current = parseStructuredStyle(existing?.structuredStyle) || {
        artStyle: '', colorTone: '', characters: [],
      }

      const updated: StructuredStyle = {
        artStyle: input.artStyle ?? current.artStyle,
        colorTone: input.colorTone ?? current.colorTone,
        characters: input.characters ?? current.characters,
        subtitleDeclaration: input.subtitleDeclaration ?? current.subtitleDeclaration,
        extra: input.extra ?? current.extra,
      }

      structuredStyle = JSON.stringify(updated)
      // 同步渲染扁平文本（双写，保持 merger 一致性）
      customDescription = renderStructuredStyleToText(updated)
    }

    const styleConfig = await prisma.styleConfig.upsert({
      where: { projectId: id },
      create: {
        projectId: id,
        templateId: input.templateId ?? null,
        customDescription,
        structuredStyle,
      },
      update: {
        ...(input.templateId !== undefined && { templateId: input.templateId ?? null }),
        ...(customDescription !== null && { customDescription }),
        ...(structuredStyle !== null && { structuredStyle }),
      },
      include: { template: true },
    })

    const structured = parseStructuredStyle(styleConfig.structuredStyle)

    return NextResponse.json({
      styleConfig: {
        id: styleConfig.id,
        templateId: styleConfig.templateId,
        customDescription: styleConfig.customDescription,
        structured,
        template: styleConfig.template,
      },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : '更新风格设定失败'
    console.error('[PUT /api/projects/[id]/style]', error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
