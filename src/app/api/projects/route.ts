import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { prisma } from '@/lib/db'
import { generateUploadUrl, toMediaProxyUrl } from '@/lib/storage'

export const dynamic = 'force-dynamic'

// POST /api/projects - 创建项目
const CreateProjectSchema = z.object({
  name: z.string().min(1, '项目名称不能为空').max(100, '项目名称不能超过 100 字'),
  videoFileName: z.string().min(1, '文件名不能为空'),
  videoFileSize: z.number().min(1).max(314572800, '文件大小不能超过 300MB'),
  videoDuration: z.number().min(0.1).max(120, '视频时长不能超过 2 分钟'),
  mimeType: z.enum(['video/mp4', 'video/quicktime', 'video/webm'], {
    message: '仅支持 mp4、mov、webm 格式',
  }),
})

export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')!
    const body = await request.json()

    const parsed = CreateProjectSchema.safeParse(body)
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message || '参数校验失败'
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: firstError } },
        { status: 400 }
      )
    }

    const { name, videoFileName, videoDuration } = parsed.data

    // 创建项目记录（初始状态 UPLOADING，并发检查不含此状态，避免上传阶段就占用 parse 并发额度）
    const project = await prisma.project.create({
      data: {
        userId,
        name,
        status: 'UPLOADING',
        duration: videoDuration,
      },
    })

    // 生成上传 URL（MVP: 本地模拟）
    const { url, key } = generateUploadUrl(project.id, videoFileName)

    return NextResponse.json(
      {
        project: {
          id: project.id,
          name: project.name,
          status: project.status,
        },
        uploadUrl: url,
        uploadKey: key,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('[POST /api/projects]', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '创建项目失败' } },
      { status: 500 }
    )
  }
}

// GET /api/projects - 获取用户项目列表
export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')!

    const projects = await prisma.project.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { shots: true },
        },
        shots: {
          where: { genStatus: 'SUCCEEDED' },
          select: { id: true },
        },
      },
    })

    const result = projects.map((p) => ({
      id: p.id,
      name: p.name,
      coverUrl: toMediaProxyUrl(p.coverUrl) ?? null,
      status: p.status,
      isSample: p.isSample,
      createdAt: p.createdAt.toISOString(),
      shotCount: p._count.shots,
      completedCount: p.shots.length,
    }))

    return NextResponse.json({ projects: result })
  } catch (error) {
    console.error('[GET /api/projects]', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '获取项目列表失败' } },
      { status: 500 }
    )
  }
}
