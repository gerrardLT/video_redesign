/**
 * 分镜组同场景尾帧承接共享模块
 *
 * 背景：「单组生成」（src/app/api/shot-groups/[id]/generate/route.ts）与「一键生成」
 * （链式 src/workers/generate-video.ts 的 triggerNextChainGroup）此前在「同场景尾帧承接」上行为
 * 不一致——链式路径已实现承接，单组路径完全没有。为从根上保证两条路径行为一致，这里把
 * 「同场景判定 + 尾帧装配为 reference_image + prompt 承接指令」抽取为单一共享函数，两条路径共用。
 *
 * 软承接（soft continuation）：把上一组尾帧作为 role=reference_image 注入，并以 prompt 指定其为
 * 本组「起始承接画面」，区别于 role=first_frame（后者与 reference_image 互斥，会挤掉人物锚定）。
 * 承接尾帧仅取 Seedance 返回的受信产物（本账号、方舟平台近 30 天），不做任何静默 fallback，
 * 不塞入伪造数据。
 */
import { prisma } from '@/lib/db'

/**
 * 场景名规范化：去除全部空白并转小写，用于「同场景」判定。
 * 由本模块统一持有并导出，链式与单组路径复用同一实现，避免各处局部闭包判定口径漂移。
 */
export const normScene = (s: string | null | undefined): string =>
  (s ?? '').trim().replace(/\s+/g, '').toLowerCase()

/** applySameSceneContinuation 入参 */
export interface ApplySameSceneContinuationParams {
  /** 前一组 id（链式=currentGroupId，单组=P.id）——读取其末镜 scene */
  prevGroupId: string
  /** 待承接的当前组 id（链式=nextGroup.id，单组=G.id）——读取其首镜 scene */
  currentGroupId: string
  /** 前一组受信尾帧 URL（链式=内存值，单组=P.lastFrameUrl）；为空表示无可承接尾帧 */
  lastFrameUrl?: string | null
  /** 当前已装配的参考图列表 */
  referenceImages: string[]
  /** 当前 prompt */
  prompt: string
}

/** applySameSceneContinuation 出参 */
export interface ApplySameSceneContinuationResult {
  /** 承接后的参考图列表（未承接时与入参同值） */
  referenceImages: string[]
  /** 承接后的 prompt（未承接时与入参同值） */
  prompt: string
  /** 是否实际发生承接 */
  applied: boolean
  /** 承接尾帧在参考图列表中的 1 基序号（图片N），仅 applied=true 时有值 */
  contIndex?: number
}

/**
 * 同场景尾帧承接：判定前一组末镜与当前组首镜是否同场景，若是则把前一组受信尾帧追加为额外
 * reference_image，并在 prompt 末尾拼接承接指令。链式与单组路径共用此函数，保证产出完全一致。
 *
 * 不承接（applied=false，原样返回）的情形：
 * - lastFrameUrl 为空（前一组无受信尾帧）；
 * - referenceImages 已满 9 张（不挤占人物锚定/场景帧，保持软承接上限）；
 * - 前一组末镜或当前组首镜 scene 缺失，或两者跨场景（保守，宁跳变不糊连）。
 *
 * 同场景时：把 lastFrameUrl 追加到 referenceImages 末尾，contIndex = referenceImages.length + 1，
 * prompt 末尾拼接承接文案（与链式既有实现一字一致）。
 */
export async function applySameSceneContinuation(
  params: ApplySameSceneContinuationParams
): Promise<ApplySameSceneContinuationResult> {
  const { prevGroupId, currentGroupId, lastFrameUrl, referenceImages, prompt } = params

  // 无受信尾帧 → 不承接，原样返回
  if (!lastFrameUrl) {
    return { referenceImages, prompt, applied: false }
  }
  // 参考图已满 9 张 → 不追加，避免挤掉人物锚定/场景帧
  if (referenceImages.length >= 9) {
    return { referenceImages, prompt, applied: false }
  }

  // 取前一组末镜 scene（orderIndex desc）与当前组首镜 scene（orderIndex asc）
  const [prevLastShot, nextFirstShot] = await Promise.all([
    prisma.shot.findFirst({
      where: { shotGroupId: prevGroupId },
      orderBy: { orderIndex: 'desc' },
      select: { scene: true },
    }),
    prisma.shot.findFirst({
      where: { shotGroupId: currentGroupId },
      orderBy: { orderIndex: 'asc' },
      select: { scene: true },
    }),
  ])

  const prevScene = normScene(prevLastShot?.scene)
  const nextScene = normScene(nextFirstShot?.scene)

  // scene 缺失或跨场景 → 不承接，独立起镜
  if (!prevScene || !nextScene || prevScene !== nextScene) {
    return { referenceImages, prompt, applied: false }
  }

  // 同场景 → 软承接：尾帧追加到末尾，prompt 指定其为起始承接画面
  const contIndex = referenceImages.length + 1 // 追加在末尾的 1 基序号（图片N）
  const newRefs = [...referenceImages, lastFrameUrl]
  const newPrompt = `${prompt}\n承接：以图片${contIndex}（上一镜头结尾画面）作为本组起始画面，自然衔接上一镜头的人物姿态、机位、构图与光线，保持镜头连续`

  return { referenceImages: newRefs, prompt: newPrompt, applied: true, contIndex }
}
