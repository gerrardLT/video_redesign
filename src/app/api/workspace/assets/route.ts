/**
 * GET /api/workspace/assets
 * 工作台素材选择列表（用于 @ 引用弹窗）
 *
 * 返回用户资产库中的所有可用素材（非过期），用于 prompt @ 引用。
 * Query: keyword（可选搜索）
 */
import { NextRequest, NextResponse } from 'next/server'
import { listAssets } from '@/lib/asset-library-service'
import { toMediaProxyUrl } from '@/lib/storage'

export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id')
  if (!userId) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const keyword = searchParams.get('keyword') || undefined

  try {
    const result = await listAssets({
      userId,
      keyword,
      page: 1,
      pageSize: 50, // @ 弹窗最多展示 50 个
    })

    return NextResponse.json({
      items: result.items.map((item) => {
        const proxyUrl = toMediaProxyUrl(item.url) || item.url
        const proxyThumb = item.thumbUrl
          ? (toMediaProxyUrl(item.thumbUrl) || item.thumbUrl)
          : (item.type === 'CHARACTER_IMAGE' || item.type === 'UPLOADED_IMAGE' ? proxyUrl : null)

        return {
          id: item.id,
          name: item.displayName,
          type: item.type,
          url: proxyUrl,
          thumbUrl: proxyThumb,
          category: item.category,
        }
      }),
    })
  } catch {
    return NextResponse.json({ error: '获取素材失败' }, { status: 500 })
  }
}
