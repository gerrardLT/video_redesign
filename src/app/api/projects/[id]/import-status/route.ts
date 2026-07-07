import { NextRequest, NextResponse } from 'next/server'
import { getImportStatus } from '@/lib/shared/video-import-service'

export const dynamic = 'force-dynamic'

// GET /api/projects/[id]/import-status - 查询视频导入进度
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = request.headers.get('x-user-id')!
    const { id } = await params

    const status = await getImportStatus(id, userId)

    if (!status) {
      return NextResponse.json(
        { error: '未找到导入任务' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      taskId: status.taskId,
      status: status.status,
      progress: status.progress,
      errorMsg: status.errorMsg,
      platform: status.platform,
    })
  } catch (error) {
    console.error('[GET /api/projects/[id]/import-status]', error)
    return NextResponse.json({ error: '查询导入状态失败' }, { status: 500 })
  }
}
