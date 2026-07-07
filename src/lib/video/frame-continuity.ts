/**
 * 分镜组视频衔接模块（Reference Video 方案）
 *
 * 核心机制：每组生成时，无条件将前一组的已生成视频 URL 作为 reference_video 传给 Seedance，
 * 由模型分析上一段视频的运动轨迹、光线、构图来自然续接。不再做任何「同场景判定」——
 * 无论同场景切景别、跨场景剪辑、动作 match cut，模型都能理解如何过渡。
 *
 * 废弃逻辑（保留导出但标记 @deprecated，避免外部调用方编译报错）：
 * - applySameSceneContinuation：旧的静态图承接方案
 * - normScene：旧的场景名规范化
 * - AI 场景判定 / 关键词匹配 / 外观变化检测
 */
import { prisma } from '@/lib/shared/db'

/**
 * 获取前一组的生成视频 URL（用于 reference_video 无缝衔接）。
 *
 * 无条件衔接——不做场景判定，由 Seedance 模型自己理解如何从前一段视频自然过渡。
 * 返回 null 表示无可衔接的前序视频（第一组 / 前一组未生成成功）。
 *
 * @param projectId 项目 ID
 * @param currentGroupIndex 当前组的 groupIndex（查找 < 此值的最近已成功组）
 * @returns 前一组的 genVideoUrl（OSS 公网 URL），或 null
 */
export async function getPrevGroupVideoUrl(
  projectId: string,
  currentGroupIndex: number
): Promise<string | null> {
  const prevGroup = await prisma.shotGroup.findFirst({
    where: {
      projectId,
      groupIndex: { lt: currentGroupIndex },
      genStatus: 'SUCCEEDED',
      genVideoUrl: { not: null },
    },
    orderBy: { groupIndex: 'desc' },
    select: { genVideoUrl: true },
  })
  return prevGroup?.genVideoUrl ?? null
}

/**
 * 构建 reference_video 衔接的 prompt 后缀指令。
 * 当有前一组视频传入时，在 prompt 末尾追加此指令告诉 Seedance 从前段视频结尾续接。
 */
export const VIDEO_CONTINUATION_PROMPT_SUFFIX =
  '\n@视频1 是上一组镜头的结尾片段，本组应从该视频结尾处自然续接，保持动作方向、光线、构图的连贯性'

// ========================
// 废弃导出（保留编译兼容，避免外部调用方 import 报错）
// ========================

/**
 * @deprecated 已废弃——改用 getPrevGroupVideoUrl + reference_video 方案。
 * 保留导出仅为编译兼容，内部逻辑已替换为无操作。
 */
export const normScene = (s: string | null | undefined): string =>
  (s ?? '').trim().replace(/\s+/g, '').toLowerCase()

/**
 * @deprecated 已废弃——改用 reference_video 无条件衔接，不再做场景判定。
 * 保留导出仅为编译兼容，始终返回未承接（applied=false）。
 */
export async function applySameSceneContinuation(params: {
  prevGroupId: string
  currentGroupId: string
  lastFrameUrl?: string | null
  referenceImages: string[]
  prompt: string
}): Promise<{
  referenceImages: string[]
  prompt: string
  applied: boolean
  contIndex?: number
}> {
  // 废弃：始终返回不承接，实际衔接由 reference_video 方案承担
  return { referenceImages: params.referenceImages, prompt: params.prompt, applied: false }
}
