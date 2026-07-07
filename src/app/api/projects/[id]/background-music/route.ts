/**
 * POST /api/projects/:id/background-music
 * 上传项目背景音乐（Seedance 模式合并导出时替换原音轨）
 *
 * 接收 multipart/form-data：
 * - audio: 音频文件（MP3/WAV/AAC, ≤50MB）
 *
 * 上传至 OSS 并将 ossKey 写入 Project.bgmKey
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'
import { uploadBuffer } from '@/lib/shared/storage'

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB
const ALLOWED_TYPES = ['audio/mpeg', 'audio/wav', 'audio/aac', 'audio/mp4', 'audio/x-m4a']

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params
  const userId = request.headers.get('x-user-id')
  if (!userId) {
    return NextResponse.json({ error: '未认证' }, { status: 401 })
  }

  // 校验项目归属
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true },
  })
  if (!project) {
    return NextResponse.json({ error: '项目不存在' }, { status: 404 })
  }

  // 解析 multipart/form-data
  const formData = await request.formData()
  const audioFile = formData.get('audio') as File | null

  if (!audioFile) {
    return NextResponse.json({ error: '缺少 audio 字段' }, { status: 400 })
  }

  // 校验文件类型
  if (!ALLOWED_TYPES.includes(audioFile.type)) {
    return NextResponse.json(
      { error: `不支持的音频格式: ${audioFile.type}，仅支持 MP3/WAV/AAC` },
      { status: 400 }
    )
  }

  // 校验文件大小
  if (audioFile.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `音频大小超出限制: ${(audioFile.size / 1024 / 1024).toFixed(1)}MB，最大 50MB` },
      { status: 400 }
    )
  }

  // 上传到 OSS
  const ext = audioFile.name.split('.').pop() || 'mp3'
  const ossKey = `bgm/${projectId}/music_${Date.now()}.${ext}`
  const buffer = Buffer.from(await audioFile.arrayBuffer())
  await uploadBuffer(ossKey, buffer)

  // 更新 Project.bgmKey
  await prisma.project.update({
    where: { id: projectId },
    data: { bgmKey: ossKey },
  })

  return NextResponse.json({ ossKey })
}
