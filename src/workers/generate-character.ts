/**
 * 人物图生成 Worker
 * 处理 'image-generate' 队列任务
 * 流程：获取人物 → 方舟 Seedream 5.0 lite 生成参考图（转存 OSS）→ 更新人物记录 → 创建 Asset
 *
 * 人物锚定图即「可复用的人物形象资产」：存自有 OSS（Character.imageUrl + CHARACTER_IMAGE Asset），
 * 后续每个分镜组生成都把这张 https 图作 reference_image 引用，保证全片人物一致。
 * 说明：火山方舟的 asset:// 入库仅支持「预置虚拟人像」与「真人认证(控制台/扫码)」流程，无编程接口，
 *       故 AI 生成的人脸不入 asset://，直接用受信的 Seedream 产物 URL 作参考图（30 天受信期内有效）。
 */

import { Worker, Job, type ConnectionOptions } from 'bullmq'
import { redis } from '@/lib/redis'
import { prisma } from '@/lib/db'
import { generateCharacterImage } from '@/lib/flux'
import { buildStylePrompt } from '@/lib/style-service'

export interface ImageGenerateJobData {
  characterId: string
  projectId: string
  userId: string
  prompt: string
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
  const { characterId, projectId, userId, prompt } = job.data
  console.log(`[generate-character] 开始生成人物图 characterId=${characterId}`)

  try {
    // 1. 获取人物信息
    const character = await prisma.character.findUnique({
      where: { id: characterId },
    })

    if (!character) {
      throw new Error(`人物不存在: ${characterId}`)
    }

    // 2. 组装锚定图 prompt：拼项目全局风格（画风一致）+ 外貌主体 + 构图/负面约束（干净单人参考图）。
    //    prompt 为人物外貌描述；无风格配置时 buildStylePrompt 返回空串，自动省略风格段。
    const stylePrefix = await buildStylePrompt(projectId)
    const finalPrompt = buildCharacterAnchorPrompt(stylePrefix, prompt)

    // 3. 调用方舟 Seedream 5.0 lite 生成参考图（内部已转存到自有 OSS，返回公网 URL）
    const result = await generateCharacterImage(finalPrompt, `characters/${projectId}`)
    const imageUrl = result.imageUrl

    // 4. 更新人物记录的 imageUrl，并把锚定图状态置为 ACTIVE（可复用的人物形象资产已就绪）
    await prisma.character.update({
      where: { id: characterId },
      data: { imageUrl, avatarStatus: 'ACTIVE' },
    })

    // 5. 创建 Asset 记录（类型为 CHARACTER_IMAGE）—— 系统内可复用的人物形象资产
    await prisma.asset.create({
      data: {
        projectId,
        userId,
        type: 'CHARACTER_IMAGE',
        url: imageUrl,
        fileName: `${character.name}-参考图.png`,
        isCharImage: true,
        status: 'UPLOADED',
        sortOrder: 0,
      },
    })

    console.log(`[generate-character] 人物锚定图生成完成（可复用资产已就绪）characterId=${characterId}`)
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : '人物图生成失败'
    console.error(`[generate-character] characterId=${characterId} 失败:`, errorMsg)
    // 标记形象生成失败，供前端展示并允许重新生成（best-effort，不掩盖原始错误）
    await prisma.character
      .update({ where: { id: characterId }, data: { avatarStatus: 'FAILED' } })
      .catch(() => {})
    throw error // 让 BullMQ 处理重试逻辑
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
