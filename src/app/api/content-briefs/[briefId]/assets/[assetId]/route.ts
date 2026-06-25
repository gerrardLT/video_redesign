/**
 * DELETE /api/content-briefs/[briefId]/assets/[assetId] — 删除素材
 *
 * 删除 RawAsset 记录并回退关联 ShotTask 状态为 PENDING。
 * 用于商家重新上传素材时先删除旧的。
 *
 * 鉴权：验证 brief.store.merchant.userId === currentUserId
 *
 * 响应：
 * - 200: { message: string }
 * - 401: 未认证
 * - 403: 无权限
 * - 404: ContentBrief 或 RawAsset 不存在
 * - 500: 服务器内部错误
 *
 * Requirements: 6.1-6.7
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserIdFromRequest } from '@/lib/merchant-auth'
import { ApiError } from '@/lib/api-error'
import { deleteObject } from '@/lib/storage'

interface RouteContext {
  params: Promise<{ briefId: string; assetId: string }>
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { briefId, assetId } = await context.params
    const userId = getUserIdFromRequest(request)

    // 查询 ContentBrief 并验证归属
    const brief = await prisma.contentBrief.findUnique({
      where: { id: briefId },
      include: {
        store: {
          include: {
            merchant: { select: { userId: true } },
          },
        },
      },
    })

    if (!brief) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'ContentBrief 不存在' } },
        { status: 404 }
      )
    }

    if (brief.store.merchant.userId !== userId) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: '无权访问该内容任务' } },
        { status: 403 }
      )
    }

    // 查询 RawAsset
    const asset = await prisma.rawAsset.findUnique({
      where: { id: assetId },
    })

    if (!asset || asset.storeId !== brief.storeId) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: '素材不存在' } },
        { status: 404 }
      )
    }

    // 删除 OSS 文件（包括缩略图）
    try {
      await deleteObject(asset.ossKey)
      if (asset.thumbnailKey) {
        await deleteObject(asset.thumbnailKey)
      }
    } catch (ossErr) {
      console.warn('[DELETE assets] OSS 删除失败，继续处理数据库记录:', ossErr)
    }

    // 记录关联的 shotTaskId，后续需要回退状态
    const shotTaskId = asset.shotTaskId

    // 删除 RawAsset 记录
    await prisma.rawAsset.delete({
      where: { id: assetId },
    })

    // 回退 ShotTask 状态为 PENDING
    if (shotTaskId) {
      // 检查该 ShotTask 是否还有其他通过的素材
      const remainingAssets = await prisma.rawAsset.findFirst({
        where: {
          shotTaskId,
          qualityScore: { gte: 60 },
        },
      })

      // 无其他合格素材时回退状态
      if (!remainingAssets) {
        await prisma.shotTask.update({
          where: { id: shotTaskId },
          data: { status: 'PENDING' },
        })
      }
    }

    return NextResponse.json({ message: '素材已删除' })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[DELETE /api/content-briefs/[briefId]/assets/[assetId]] 未知错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
