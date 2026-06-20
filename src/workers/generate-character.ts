/**
 * 人物图生成 Worker
 * 处理 'image-generate' 队列任务
 * 流程：获取人物 → 方舟 Seedream 5.0 lite 生成参考图（转存 OSS）→ 更新人物记录 → 自动入库到用户资产库
 *
 * 人物锚定图即「可复用的人物形象资产」：存自有 OSS（Character.imageUrl + CHARACTER 资产），
 * 后续每个分镜组生成都把这张 https 图作 reference_image 引用，保证全片人物一致。
 * 入库使用 upsert 语义：同一用户 + 同一角色下只保留一条 CHARACTER 资产，
 * 再生成时更新 URL 而非新增记录，保证幂等和无重复。
 *
 * 说明：火山方舟的 asset:// 入库仅支持「预置虚拟人像」与「真人认证(控制台/扫码)」流程，无编程接口，
 *       故 AI 生成的人脸不入 asset://，直接用受信的 Seedream 产物 URL 作参考图（30 天受信期内有效）。
 */

import { Worker, Job, type ConnectionOptions } from 'bullmq'
import { redis } from '@/lib/redis'
import { prisma } from '@/lib/db'
import { generateCharacterImage, editImage } from '@/lib/flux'
import { buildStylePrompt } from '@/lib/style-service'
import { ingestCharacterImage } from '@/lib/asset-ingestion-service'
import { publishStateChange, publishCompleted, publishFailed } from '@/lib/progress-publisher'
import { withCreditLock } from '@/lib/distributed-lock'
import { ApiError } from '@/lib/api-error'

export interface ImageGenerateJobData {
  characterId: string
  projectId: string
  userId: string
  prompt: string
  /** 用户上传的原图 OSS URL（有值时走图生图风格化分支，无值时走纯文生图） */
  sourceImageUrl?: string
}

// 人物锚定图构图约束：干净、单人、正面、纯背景的参考图能显著提升 Seedance 从
// reference_image 提取身份的稳定性（杂背景/多人/裁切是角色漂移的主因，比"缺角度"更关键）。
const ANCHOR_COMPOSITION = '正面、中性表情、自然站姿，单人居中、半身或全身完整，纯色浅灰背景，柔和均匀光照，五官清晰，高清写实细节'
// 负面约束（Seedream 无独立 negative_prompt 字段，内联进 prompt 表达）。
const ANCHOR_NEGATIVE = '画面只包含一个人物；不要文字、字幕、水印、logo；不要多人、不要分屏或拼图、不要相框边框、不要遮挡面部、不要复杂杂乱背景'

/**
 * 组装人物锚定图的文生图 prompt：全局风格 + 外貌主体 + 构图约束 + 负面约束。
 * - stylePrefix：项目画风/色调（来自 StyleConfig），使锚定图与项目画风一致；空则省略。
 * - appearance：人物外貌描述（主体）。
 * - 构图/负面：固定约束，产出干净单人参考图。
 */
function buildCharacterAnchorPrompt(stylePrefix: string, appearance: string): string {
  return [stylePrefix, appearance, ANCHOR_COMPOSITION, `要求：${ANCHOR_NEGATIVE}`]
    .filter((s) => s && s.trim().length > 0)
    .join('，')
}

async function processGenerateCharacter(job: Job<ImageGenerateJobData>): Promise<void> {
  const { characterId, projectId, userId, prompt, sourceImageUrl } = job.data
  const mode = sourceImageUrl ? '图生图（用户上传参考）' : '纯文生图'
  console.log(`[generate-character] 开始生成人物图 characterId=${characterId}，模式：${mode}`)
  void publishStateChange(userId, 'character', characterId, 'started', 0)

  // 人物形象生成固定消耗 2 积分（Seedream 单张 2K 成本 ¥0.06，2积分 ≈ ¥0.12 月卡 / ¥0.07 年卡）
  const CHARACTER_GEN_COST = 2

  try {
    // 0. 积分预检与扣费（生成前即扣，失败不退——与纯文生图行为一致，避免恶意刷量）
    await withCreditLock(() =>
      prisma.$transaction(async (tx) => {
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } })
        if (user.creditBalance < CHARACTER_GEN_COST) {
          throw new ApiError(
            'INSUFFICIENT_CREDITS',
            `积分不足：生成人物形象需 ${CHARACTER_GEN_COST} 积分，当前余额 ${user.creditBalance}`,
            402
          )
        }
        const newBalance = user.creditBalance - CHARACTER_GEN_COST
        await tx.user.update({
          where: { id: userId },
          data: { creditBalance: newBalance },
        })
        await tx.creditLedger.create({
          data: {
            userId,
            action: 'CHARGE',
            amount: -CHARACTER_GEN_COST,
            balanceAfter: newBalance,
            remark: `人物形象生成（${mode}）扣费 ${CHARACTER_GEN_COST} 积分`,
          },
        })
      })
    , 'characterGenCharge')
    console.log(`[generate-character] 积分扣费完成: ${CHARACTER_GEN_COST} 积分`)
    // 1. 获取人物信息
    const character = await prisma.character.findUnique({
      where: { id: characterId },
    })

    if (!character) {
      throw new Error(`人物不存在: ${characterId}`)
    }

    // 2. 组装 prompt：项目全局风格 + 外貌主体 + 构图约束
    const stylePrefix = await buildStylePrompt(projectId)
    const finalPrompt = buildCharacterAnchorPrompt(stylePrefix, prompt)
    console.log(`[generate-character] 完整生成 prompt characterId=${characterId}:\n${finalPrompt}`)

    // 3. 根据是否有 sourceImageUrl 决定走文生图还是图生图
    void publishStateChange(userId, 'character', characterId, 'generating', 30)
    let imageUrl: string

    if (sourceImageUrl) {
      // 图生图分支：以用户上传的原图为参考，结合外貌描述 + 项目风格做风格化重绘
      // 产出为 Seedream AI 生成图，不含原始真人人脸生物特征，绕过 Seedance 人脸审核
      const img2imgPrompt = `参考图1中人物的五官结构、体型和姿态，用以下风格重新绘制该人物的角色设定图：${finalPrompt}`
      console.log(`[generate-character] 图生图参考: ${sourceImageUrl}`)
      const result = await editImage(sourceImageUrl, img2imgPrompt, `characters/${projectId}`)
      imageUrl = result.imageUrl
    } else {
      // 纯文生图分支（原有逻辑不变）
      const result = await generateCharacterImage(finalPrompt, `characters/${projectId}`)
      imageUrl = result.imageUrl
    }

    // 4. 更新人物记录的 imageUrl，并把锚定图状态置为 ACTIVE
    await prisma.character.update({
      where: { id: characterId },
      data: { imageUrl, avatarStatus: 'ACTIVE' },
    })

    // 5. 自动入库到用户资产库
    await ingestCharacterImage({
      userId,
      projectId,
      characterId: character.id,
      characterName: character.name,
      imageUrl,
    })

    console.log(`[generate-character] 人物锚定图生成完成（${mode}，已入库）characterId=${characterId}`)
    void publishCompleted(userId, 'character', characterId)
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : '人物图生成失败'
    console.error(`[generate-character] characterId=${characterId} 失败:`, errorMsg)
    void publishFailed(userId, 'character', characterId, errorMsg)
    // 标记形象生成失败
    await prisma.character
      .update({ where: { id: characterId }, data: { avatarStatus: 'FAILED' } })
      .catch(() => {})
    throw error
  }
}

// 创建 Worker 实例
const connection = redis as unknown as ConnectionOptions

const worker = new Worker<ImageGenerateJobData>(
  'image-generate',
  processGenerateCharacter,
  {
    connection,
    concurrency: 3,
    limiter: {
      max: 5,
      duration: 60000,
    },
  }
)

worker.on('completed', (job) => {
  console.log(`[generate-character] 任务 ${job.id} 完成`)
})

worker.on('failed', (job, err) => {
  console.error(`[generate-character] 任务 ${job?.id} 失败:`, err.message)
})

export default worker
export { processGenerateCharacter }
