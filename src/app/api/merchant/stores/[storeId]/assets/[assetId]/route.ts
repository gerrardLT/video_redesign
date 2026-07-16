/**
 * DELETE /api/merchant/stores/[storeId]/assets/[assetId] — 删除素材库条目
 *
 * 鉴权：validateMerchantAccess(userId, storeId)
 * 校验：assetId 归属该 store，且为素材库条目（shotTaskId=null），删除 OSS 对象 + DB 行。
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'
import { getUserIdFromRequest, validateMerchantAccess } from '@/lib/merchant/merchant-auth'
import { ApiError } from '@/lib/shared/api-error'
import { deleteObject } from '@/lib/shared/storage'

interface RouteContext {
  params: Promise<{ storeId: string; assetId: string }>
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { storeId, assetId } = await context.params
    const userId = getUserIdFromRequest(request)
    await validateMerchantAccess(userId, storeId)

    const asset = await prisma.rawAsset.findUnique({ where: { id: assetId } })
    if (!asset || asset.storeId !== storeId || asset.shotTaskId !== null) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: '素材不存在或无权访问' } },
        { status: 404 }
      )
    }

    // 先删 OSS 对象（失败仅记日志，不阻断 DB 行删除，避免残留孤儿记录）
    for (const key of [asset.ossKey, asset.thumbnailKey]) {
      if (!key) continue
      try {
        await deleteObject(key)
      } catch (e) {
        console.warn('[assets/delete] 删除 OSS 对象失败（不阻断）:', key, e)
      }
    }

    await prisma.rawAsset.delete({ where: { id: assetId } })

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[DELETE /api/merchant/stores/[storeId]/assets/[assetId]] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
