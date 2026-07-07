/**
 * 示例项目服务
 * 负责为新用户创建预制示例项目（包含分镜组、分镜、人物数据）
 * 示例项目不消耗 AI 资源，从静态 JSON 文件加载数据
 */
import { readFile } from 'fs/promises'
import path from 'path'
import { prisma } from './db'
import { logger } from './logger'

// ========================
// 静态数据类型定义
// ========================

interface SampleProjectData {
  title: string
  duration: number
  description: string
  status: string
  videoUrl: string
}

interface SampleShotData {
  order: number
  prompt: string
  duration: number
  coverUrl: string
}

interface SampleCharacterData {
  name: string
  imageUrl: string
  description: string
}

// ========================
// 辅助函数：读取静态 JSON 文件
// ========================

/**
 * 安全读取 public/onboarding/ 目录下的 JSON 文件
 * 文件缺失或解析失败时返回 null，记录错误日志但不抛出异常
 */
async function readStaticJson<T>(filename: string): Promise<T | null> {
  try {
    const filePath = path.join(process.cwd(), 'public', 'onboarding', filename)
    const content = await readFile(filePath, 'utf-8')
    return JSON.parse(content) as T
  } catch (error) {
    logger.error(`读取引导静态数据文件失败: ${filename}`, {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

// ========================
// 公开 API
// ========================

/**
 * 检查用户是否已有示例项目
 * @param userId 用户 ID
 * @returns 是否已存在示例项目
 */
export async function hasSampleProject(userId: string): Promise<boolean> {
  const count = await prisma.project.count({
    where: { userId, isSample: true },
  })
  return count > 0
}

/**
 * 为用户创建示例项目（幂等操作）
 * - 已存在示例项目则直接返回现有项目
 * - 从 public/onboarding/ 读取静态 JSON 数据创建项目及关联记录
 * - 静态数据文件缺失时记录错误日志并返回 null，不抛出异常
 *
 * @param userId 用户 ID
 * @returns 创建或已存在的示例项目，静态数据缺失时返回 null
 */
export async function createSampleProject(userId: string) {
  // 幂等检查：已有示例项目则直接返回
  const existing = await prisma.project.findFirst({
    where: { userId, isSample: true },
  })
  if (existing) {
    return existing
  }

  // 读取静态数据
  const projectData = await readStaticJson<SampleProjectData>('sample-project.json')
  if (!projectData) {
    logger.error('示例项目创建失败：sample-project.json 缺失或解析失败', { userId })
    return null
  }

  const shotsData = await readStaticJson<SampleShotData[]>('shots.json')
  if (!shotsData) {
    logger.error('示例项目创建失败：shots.json 缺失或解析失败', { userId })
    return null
  }

  const charactersData = await readStaticJson<SampleCharacterData[]>('characters.json')

  // 计算分镜时间轴（基于每个 shot 的 duration 累加）
  let currentTime = 0
  const shotTimeline = shotsData.map((shot) => {
    const startTime = currentTime
    const endTime = currentTime + shot.duration
    currentTime = endTime
    return { ...shot, startTime, endTime }
  })

  // 使用事务创建项目及所有关联数据
  const project = await prisma.$transaction(async (tx) => {
    // 1. 创建 Project 记录
    const newProject = await tx.project.create({
      data: {
        userId,
        name: projectData.title,
        videoUrl: projectData.videoUrl,
        status: projectData.status,
        duration: projectData.duration,
        isSample: true,
      },
    })

    // 2. 创建 ShotGroup（所有分镜归为一组）
    const totalDuration = shotTimeline.length > 0
      ? shotTimeline[shotTimeline.length - 1].endTime
      : projectData.duration

    const shotGroup = await tx.shotGroup.create({
      data: {
        projectId: newProject.id,
        groupIndex: 0,
        genDuration: totalDuration,
        startTime: 0,
        endTime: totalDuration,
        genStatus: 'SUCCEEDED',
      },
    })

    // 3. 创建 Shot 记录
    for (const shot of shotTimeline) {
      await tx.shot.create({
        data: {
          projectId: newProject.id,
          shotGroupId: shotGroup.id,
          orderIndex: shot.order - 1,
          startTime: shot.startTime,
          endTime: shot.endTime,
          prompt: shot.prompt,
          coverUrl: shot.coverUrl,
          genStatus: 'SUCCEEDED',
        },
      })
    }

    // 4. 创建 Character 记录（characters.json 可选，缺失时跳过）
    if (charactersData && charactersData.length > 0) {
      for (const char of charactersData) {
        await tx.character.create({
          data: {
            projectId: newProject.id,
            name: char.name,
            appearance: char.description,
            imageUrl: char.imageUrl,
          },
        })
      }
    }

    return newProject
  })

  logger.info('示例项目创建成功', { userId, projectId: project.id })
  return project
}
