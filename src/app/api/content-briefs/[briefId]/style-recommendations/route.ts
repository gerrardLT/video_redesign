/**
 * GET /api/content-briefs/[briefId]/style-recommendations
 *
 * 返回 3 个风格推荐，用于成片工作室屏 C 的风格推荐单选交互。
 *
 * 数据来源融合：
 * 1. playbook-engine：行业剧本库（按门店行业 + 目标筛选可用剧本）
 * 2. content-entropy-service：30 天内容同质化检测（避免推荐近期用过的风格）
 * 3. performance-learning-service：历史表现数据（表现好的风格排名靠前）
 * 4. PlanGenerationInput.stylePreference：用户上轮复盘采纳的风格偏好
 *
 * 响应：
 * - 200: { recommendations: StyleRecommendation[] }
 * - 401: 未认证
 * - 403: 无权限
 * - 404: ContentBrief 不存在
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/shared/db'
import { getUserIdFromRequest } from '@/lib/merchant/merchant-auth'
import { ApiError } from '@/lib/shared/api-error'

interface RouteContext {
  params: Promise<{ briefId: string }>
}

/** 风格推荐结果 */
interface StyleRecommendation {
  /** 风格 ID（对应 Playbook.id） */
  id: string
  /** 风格名称 */
  name: string
  /** 风格描述 */
  description: string
  /** 优点标签 */
  proTags: string[]
  /** 缺点标签 */
  conTags: string[]
  /** 预览提示（前端用于生成预览图的关键词） */
  previewHint: string
  /** 推荐排序分（越高越好，内部使用） */
  score: number
}

/** 预定义的风格模板库（当 Playbook 库为空时的 fallback） */
const DEFAULT_STYLES: Omit<StyleRecommendation, 'score'>[] = [
  {
    id: 'style-fast-paced',
    name: '快节奏种草',
    description: '高频切换 + 特写镜头 + 快节奏 BGM，适合抖音引流',
    proTags: ['完播率高', '制作简单'],
    conTags: ['信息密度低'],
    previewHint: '快节奏剪辑，多角度特写，节奏感强',
  },
  {
    id: 'style-emotional',
    name: '情绪短片',
    description: '慢镜头 + 暖色调 + 故事叙事，适合品牌形象',
    proTags: ['品牌感强', '易引发共鸣'],
    conTags: ['制作周期长'],
    previewHint: '电影感暖色调，慢镜头，情感叙事',
  },
  {
    id: 'style-talking-head',
    name: '老板口播',
    description: '真人出镜 + 产品讲解，适合信任建设',
    proTags: ['信任度高', '转化率强'],
    conTags: ['需要出镜'],
    previewHint: '真人出镜讲解，产品展示，亲和力',
  },
  {
    id: 'style-process',
    name: '制作过程',
    description: '全流程展示 + ASMR 音效，适合餐饮/手工',
    proTags: ['真实感强', '易获收藏'],
    conTags: ['需要拍摄素材'],
    previewHint: '后厨操作台，制作流程，烟火气',
  },
  {
    id: 'style-customer',
    name: '顾客视角',
    description: '顾客体验全流程 + 真实反应，适合口碑营销',
    proTags: ['真实可信', '社交证明'],
    conTags: ['需顾客配合'],
    previewHint: '顾客进店，点单，用餐反应，好评',
  },
]

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const userId = getUserIdFromRequest(request)
    const { briefId } = await context.params

    // 查询 brief + store 信息
    const brief = await prisma.contentBrief.findUnique({
      where: { id: briefId },
      include: {
        store: {
          include: { merchant: true },
        },
      },
    })

    if (!brief) {
      throw new ApiError('NOT_FOUND', `ContentBrief 不存在: ${briefId}`, 404)
    }

    // 鉴权：验证 brief.store.merchant.userId === currentUserId
    if (brief.store.merchant.userId !== userId) {
      throw new ApiError('FORBIDDEN', '无权访问此内容任务', 403)
    }

    // 查询门店行业
    const industry = (brief.store as { industry?: string }).industry ?? 'FOOD_AND_BEVERAGE'

    // 尝试从 Playbook 库获取行业剧本
    const playbooks = await prisma.playbook.findMany({
      where: {
        industry: industry as never,
        isActive: true,
      },
      take: 10,
      orderBy: { updatedAt: 'desc' },
    })

    // 查询最近 30 天用过的剧本 ID（用于降权）
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const recentBriefs = await prisma.contentBrief.findMany({
      where: {
        storeId: brief.storeId,
        createdAt: { gte: thirtyDaysAgo },
        status: { notIn: ['DRAFT', 'FAILED', 'ARCHIVED'] },
      },
      select: {
        creationMode: true,
        videoVariants: { select: { styleLabel: true } },
      },
    })

    // 收集已用过的风格标签
    const usedStyleLabels = new Set<string>()
    for (const rb of recentBriefs) {
      for (const vv of rb.videoVariants) {
        if (vv.styleLabel) usedStyleLabels.add(vv.styleLabel)
      }
    }

    // 查询 stylePreference（来自上轮复盘）
    const latestInput = await prisma.planGenerationInput.findFirst({
      where: { storeId: brief.storeId },
      orderBy: { createdAt: 'desc' },
      select: { stylePreference: true },
    })

    const stylePreference = latestInput?.stylePreference as {
      preferredStyleIds?: string[]
      avoidedStyleIds?: string[]
    } | null

    // 构建风格推荐列表
    let recommendations: StyleRecommendation[]

    if (playbooks.length >= 3) {
      // 从 Playbook 库构建推荐
      recommendations = playbooks.slice(0, 5).map((pb) => {
        const pbData = pb as {
          id: string
          name: string
          description: string | null
          goal: string
          scoreWeight: { views?: number; conversion?: number } | null
        }

        // 计算推荐分
        let score = 50 // 基础分
        const weight = pbData.scoreWeight

        // 表现权重加成
        if (weight?.views) score += weight.views * 20
        if (weight?.conversion) score += weight.conversion * 20

        // 已用过的风格降权
        if (usedStyleLabels.has(pbData.name)) score -= 30

        // stylePreference 偏好加成
        if (stylePreference?.preferredStyleIds?.includes(pbData.id)) score += 25
        if (stylePreference?.avoidedStyleIds?.includes(pbData.id)) score -= 40

        // 根据 goal 生成标签
        const proTags: string[] = []
        const conTags: string[] = []

        switch (pbData.goal) {
          case 'TRAFFIC':
            proTags.push('引流效果好', '覆盖面广')
            conTags.push('转化率一般')
            break
          case 'PROMOTION':
            proTags.push('转化率强', '紧迫感')
            conTags.push('同质化风险')
            break
          case 'TRUST_BUILDING':
            proTags.push('品牌感强', '长期价值')
            conTags.push('短期引流弱')
            break
          default:
            proTags.push('行业适配', '易上手')
            conTags.push('需调优')
        }

        return {
          id: pbData.id,
          name: pbData.name,
          description: pbData.description ?? `${pbData.goal} 风格内容`,
          proTags,
          conTags,
          previewHint: pbData.description ?? pbData.name,
          score,
        }
      })
    } else {
      // Playbook 库为空，使用默认风格模板
      recommendations = DEFAULT_STYLES.map((s, i) => {
        let score = 80 - i * 10 // 基础分递减
        if (usedStyleLabels.has(s.name)) score -= 30
        if (stylePreference?.preferredStyleIds?.includes(s.id)) score += 25
        if (stylePreference?.avoidedStyleIds?.includes(s.id)) score -= 40
        return { ...s, score }
      })
    }

    // 按 score 排序，取前 3
    recommendations.sort((a, b) => b.score - a.score)
    const top3 = recommendations.slice(0, 3)

    // 移除内部分数字段
    const output = top3.map(({ score, ...rest }) => rest)

    return NextResponse.json({ recommendations: output })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      )
    }
    console.error('[style-recommendations] 服务器错误:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } },
      { status: 500 }
    )
  }
}
