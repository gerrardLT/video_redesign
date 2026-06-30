/**
 * 受影响范围服务（impact-scope-service）
 *
 * 计算「重拍某个镜头」时需要一并重渲染的范围（需求 4.3, 4.4, 4.5）。
 *
 * 本地生活渲染管线中，分镜组（生成/合成的最小单位）= 单个 ShotTask：
 * local-render-service 将每个 ShotTask 的素材作为一段 clip，按顺序 crossfade 合成为成片。
 * 因此「被重拍镜头所属的分镜组」即该 ShotTask 本身。
 *
 * 受影响范围定义（需求 4.4）：
 *   1) 被重拍镜头所属分镜组（= 该 ShotTask）；
 *   2) 当该镜头属于某场景、且其所在分镜组对后续同场景分镜组存在尾帧承接
 *      （frame-continuity）时，沿尾帧链纳入所有依赖该尾帧的后续同场景分镜组。
 *
 * 承接判定语义复用 frame-continuity 的同场景承接口径：按 ShotTask.order 顺序，
 * 相邻镜头同场景 → 后者依赖前者尾帧（承接链延续）；一旦跨场景 → 尾帧承接断裂、链终止
 * （跨场景剪辑不依赖前段尾帧）。场景标识统一用 frame-continuity 的 normScene 归一化，
 * 与 transition-engine 同场景判定保持一致口径。
 *
 * 不静默缩小范围（需求 4.5）：当承接链判定所需的场景数据缺失（无法确定被重拍镜头
 * 或断裂点之前的某个后续镜头是否同场景承接）时，显式抛错，绝不默认「无承接」而漏算
 * 本应一并重拍的后续镜头，导致画面承接断裂。
 *
 * 纯计算（仅读库），不消耗积分。
 */

import { prisma } from './db'
import { normScene } from './frame-continuity'

/** computeReshootScope 返回结构 */
export interface ReshootScopeResult {
  /** 需重渲染的分镜组（ShotTask）集合，含被重拍镜头本身与承接链上的后续同场景镜头 */
  affectedGroupIds: string[]
  /** 是否触发了尾帧承接链扩散（受影响范围超出被重拍镜头本身） */
  hasContinuityChain: boolean
}

/**
 * 计算「重拍某镜头」的受影响范围。
 *
 * @param input.contentBriefId 内容任务 ID
 * @param input.shotTaskId 被重拍镜头（ShotTask）ID
 * @throws 当 brief 无镜头、shotTaskId 不属于该 brief、或承接链判定所需场景数据缺失时显式抛错
 */
export async function computeReshootScope(input: {
  contentBriefId: string
  shotTaskId: string
}): Promise<ReshootScopeResult> {
  const { contentBriefId, shotTaskId } = input

  // 读取该 brief 下全部镜头，按拍摄/合成顺序（order 升序）排列——承接链沿此顺序判定
  const shotTasks = await prisma.shotTask.findMany({
    where: { contentBriefId },
    orderBy: { order: 'asc' },
    select: { id: true, order: true, framingGuide: true },
  })

  if (shotTasks.length === 0) {
    throw new Error(
      `受影响范围计算失败：ContentBrief ${contentBriefId} 不存在或无任何拍摄镜头`
    )
  }

  const startIndex = shotTasks.findIndex((task) => task.id === shotTaskId)
  if (startIndex === -1) {
    throw new Error(
      `受影响范围计算失败：ShotTask ${shotTaskId} 不属于 ContentBrief ${contentBriefId}`
    )
  }

  // 被重拍镜头的场景，作为承接链判定基准。缺失场景数据时显式抛错，不静默按「无承接」缩小范围。
  const startScene = resolveScene(shotTasks[startIndex].framingGuide)
  if (startScene === null) {
    throw new Error(
      `受影响范围计算失败：ShotTask ${shotTaskId} 缺少场景承接数据（framingGuide.scene），` +
        `无法判定尾帧承接链；拒绝静默按「无承接」缩小受影响范围`
    )
  }

  // 受影响范围起点：被重拍镜头所属分镜组（= 该 ShotTask 本身）
  const affectedGroupIds: string[] = [shotTasks[startIndex].id]

  // 沿 order 向后扫描连续同场景镜头：
  //   同场景 → 后者依赖前者尾帧，纳入承接链；
  //   跨场景 → 尾帧承接断裂，后续不再依赖被重拍镜头尾帧，链终止。
  // 断裂点之前的后续镜头若缺失场景数据 → 无法判定是否同场景承接 → 显式抛错（不静默缩小范围）。
  for (let i = startIndex + 1; i < shotTasks.length; i++) {
    const nextScene = resolveScene(shotTasks[i].framingGuide)
    if (nextScene === null) {
      throw new Error(
        `受影响范围计算失败：ShotTask ${shotTasks[i].id} 缺少场景承接数据（framingGuide.scene），` +
          `无法判定是否与被重拍镜头同场景承接；拒绝静默缩小受影响范围`
      )
    }

    if (nextScene !== startScene) {
      // 跨场景剪辑：尾帧承接断裂，承接链在此终止
      break
    }

    // 同场景：后者依赖前者尾帧，纳入承接链
    affectedGroupIds.push(shotTasks[i].id)
  }

  return {
    affectedGroupIds,
    hasContinuityChain: affectedGroupIds.length > 1,
  }
}

/**
 * 从 ShotTask.framingGuide 解析场景标识，用于同场景尾帧承接判定。
 *
 * 复用 frame-continuity 的 normScene 归一化（去空白、转小写），保证场景比较口径与
 * transition-engine 同场景判定一致。无 framingGuide、无 scene 字段或场景为空白时返回
 * null，由调用方决定显式抛错（不静默缩小范围）。
 *
 * 注：framingGuide.scene 由 capture-director / playbook 实例化时写入场景标识。
 */
function resolveScene(framingGuide: unknown): string | null {
  if (framingGuide === null || typeof framingGuide !== 'object') {
    return null
  }

  const scene = (framingGuide as Record<string, unknown>).scene
  if (typeof scene !== 'string') {
    return null
  }

  const normalized = normScene(scene)
  return normalized.length > 0 ? normalized : null
}
