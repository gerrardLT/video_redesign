/**
 * 人脸检测服务
 * 异步调用阿里云内容安全 API 对参考素材进行人脸检测
 * 提供触发检测、执行检测、查询被拦截素材、手动复审等功能
 */
import { prisma } from './db'
import { faceCheckQueue } from './queue'
import { ApiError } from './api-error'

// ========================
// 接口定义
// ========================

interface AliyunContentSafetyResponse {
  result: 'pass' | 'reject' | 'error'
  detail: Record<string, unknown>
  reason?: string
}

interface RejectedAssetsParams {
  page?: number
  pageSize?: number
}

interface RejectedAssetsResult {
  items: Record<string, unknown>[]
  total: number
  page: number
  pageSize: number
}

// ========================
// 人脸检测服务
// ========================

export const faceDetectionService = {
  /**
   * 触发人脸检测（异步入队）
   * 将素材状态设为 CHECKING 并添加到人脸检测队列
   */
  async triggerFaceCheck(assetId: string, userId: string): Promise<void> {
    if (!assetId) {
      throw new ApiError('VALIDATION_ERROR', '素材ID不能为空')
    }

    const asset = await prisma.asset.findUnique({ where: { id: assetId } })
    if (!asset) {
      throw new ApiError('NOT_FOUND', '素材不存在', 404)
    }

    // 更新素材状态为 CHECKING
    await prisma.asset.update({
      where: { id: assetId },
      data: { status: 'CHECKING' },
    })

    // 添加到人脸检测队列
    await faceCheckQueue.add('face-check', { assetId, userId })
  },

  /**
   * 执行人脸检测（Worker 内部调用）
   * 调用阿里云内容安全 API 进行人脸检测，根据结果更新素材状态
   * @returns 检测结果 'pass' | 'reject' | 'error'
   */
  async performFaceCheck(assetId: string, userId: string): Promise<string> {
    const asset = await prisma.asset.findUnique({ where: { id: assetId } })
    if (!asset) {
      throw new ApiError('NOT_FOUND', `素材不存在: ${assetId}`, 404)
    }

    let result: 'pass' | 'reject' | 'error' = 'pass'
    let detail: string | null = null
    let rejectReason: string | null = null

    try {
      // 调用阿里云内容安全 API
      const apiResult = await callAliyunContentSafety(asset.url)
      result = apiResult.result
      detail = JSON.stringify(apiResult.detail)
      if (result === 'reject') {
        rejectReason = apiResult.reason || '检测到真人面部，参考素材不允许包含真人脸'
      }
    } catch (error) {
      result = 'error'
      detail = JSON.stringify({
        error: error instanceof Error ? error.message : '检测服务异常',
      })
    }

    // 根据检测结果更新素材状态
    const statusMap: Record<string, string> = {
      pass: 'APPROVED',
      reject: 'REJECTED',
      error: 'CHECK_FAILED',
    }

    await prisma.asset.update({
      where: { id: assetId },
      data: {
        status: statusMap[result],
        rejectReason,
      },
    })

    // 记录内容安全审核日志
    await prisma.contentSafetyLog.create({
      data: {
        assetId,
        userId,
        checkType: 'face_detection',
        result,
        detail,
      },
    })

    return result
  },

  /**
   * 查询被拦截的素材列表（分页）
   * 仅返回 status=REJECTED 的素材，包含项目和用户信息
   */
  async getRejectedAssets(params: RejectedAssetsParams = {}): Promise<RejectedAssetsResult> {
    const { page = 1, pageSize = 20 } = params

    const where = { status: 'REJECTED' as const }

    const [items, total] = await Promise.all([
      prisma.asset.findMany({
        where,
        include: {
          project: {
            select: {
              name: true,
              userId: true,
              user: { select: { nickname: true, email: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.asset.count({ where }),
    ])

    return { items, total, page, pageSize }
  },

  /**
   * 管理员手动复审
   * 将被拦截的素材标记为通过或维持拒绝
   */
  async manualReview(
    assetId: string,
    adminUserId: string,
    action: 'approve' | 'reject'
  ): Promise<void> {
    if (!assetId) {
      throw new ApiError('VALIDATION_ERROR', '素材ID不能为空')
    }

    const asset = await prisma.asset.findUnique({ where: { id: assetId } })
    if (!asset) {
      throw new ApiError('NOT_FOUND', '素材不存在', 404)
    }

    const newStatus = action === 'approve' ? 'APPROVED' : 'REJECTED'
    const rejectReason = action === 'reject' ? '管理员复审维持拒绝' : null

    await prisma.asset.update({
      where: { id: assetId },
      data: {
        status: newStatus,
        rejectReason,
      },
    })

    // 记录复审日志
    await prisma.contentSafetyLog.create({
      data: {
        assetId,
        userId: adminUserId,
        checkType: 'face_detection',
        result: action === 'approve' ? 'pass' : 'reject',
        detail: JSON.stringify({ action, reviewedBy: adminUserId }),
        reviewedBy: adminUserId,
        reviewedAt: new Date(),
      },
    })
  },
}

// ========================
// 阿里云内容安全 API 调用（桩实现）
// ========================

/**
 * 阿里云内容安全 API 调用
 * 当前为桩实现，生产环境替换为真实 API 调用
 *
 * 生产环境调用地址: https://green.cn-shanghai.aliyuncs.com
 * API: ImageModeration (图片内容检测 - 人脸检测场景)
 *
 * @param imageUrl - 待检测的图片 URL
 * @returns 检测结果
 */
async function callAliyunContentSafety(
  imageUrl: string
): Promise<AliyunContentSafetyResponse> {
  // TODO: 生产环境替换为真实阿里云内容安全 API 调用
  // 需要配置环境变量:
  //   ALIYUN_ACCESS_KEY_ID
  //   ALIYUN_ACCESS_KEY_SECRET
  //   ALIYUN_CONTENT_SAFETY_ENDPOINT (默认 https://green.cn-shanghai.aliyuncs.com)
  //
  // 示例调用逻辑:
  // const client = new China.China({ endpoint, accessKeyId, accessKeySecret })
  // const response = await client.imageModerationRequest({ ... })

  console.log(`[FaceDetection] Checking image: ${imageUrl}`)

  return {
    result: 'pass',
    detail: {
      suggestion: 'pass',
      label: 'normal',
      confidence: 99,
      faceCount: 0,
    },
  }
}

// 导出桩函数以便测试时可以 mock
export { callAliyunContentSafety as _callAliyunContentSafety }
