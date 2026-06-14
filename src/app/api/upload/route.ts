import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { uploadBuffer } from '@/lib/storage'

export const dynamic = 'force-dynamic'

// POST /api/upload - 本地文件上传 + OSS 同步
export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')!
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const projectId = formData.get('projectId') as string | null

    if (!file) {
      return NextResponse.json({ error: '未提供文件' }, { status: 400 })
    }

    if (!projectId) {
      return NextResponse.json({ error: '缺少 projectId' }, { status: 400 })
    }

    // 校验文件大小（300MB）
    if (file.size > 314572800) {
      return NextResponse.json({ error: '文件大小不能超过 300MB' }, { status: 400 })
    }

    // 校验文件类型
    const allowedTypes = ['video/mp4', 'video/quicktime', 'video/webm']
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: '仅支持 mp4、mov、webm 格式' }, { status: 400 })
    }

    // 创建上传目录
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'videos', userId, projectId)
    await mkdir(uploadDir, { recursive: true })

    // 生成文件名
    const ext = path.extname(file.name) || '.mp4'
    const fileName = `${Date.now()}${ext}`
    const filePath = path.join(uploadDir, fileName)

    // 写入本地文件（parse-video 需要本地文件供 FFmpeg 处理）
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    await writeFile(filePath, buffer)

    // 本地相对路径（parse-video 使用）
    const localUrl = `/uploads/videos/${userId}/${projectId}/${fileName}`

    // 同时上传到 OSS（公网可访问，失败不阻塞上传流程）
    let ossUrl: string = localUrl
    try {
      const ossKey = `videos/${userId}/${projectId}/${fileName}`
      ossUrl = await uploadBuffer(ossKey, buffer)
      console.log(`[upload] 视频已上传到 OSS: ${ossUrl}`)
    } catch (err) {
      console.warn('[upload] 上传到 OSS 失败，降级使用本地路径:', err)
    }

    return NextResponse.json({
      url: ossUrl,         // OSS 公网 URL（存入 DB，供外部访问）
      localUrl,            // 本地相对路径（供 parse-video 内部使用）
      fileName: file.name,
      fileSize: file.size,
    })
  } catch (error) {
    console.error('[POST /api/upload]', error)
    return NextResponse.json({ error: '文件上传失败' }, { status: 500 })
  }
}
