/**
 * 端到端测试脚本：模拟完整的视频解析流程
 * 直接调用 processParseVideo 逻辑（不通过队列），方便观察中间步骤问题
 *
 * 运行方式: npx tsx scripts/test-parse-flow.ts
 */

import 'dotenv/config'
import { prisma } from '../src/lib/db'

const TEST_VIDEO_URL = 'https://video-redesign-sh.oss-cn-shanghai.aliyuncs.com/84bd44e4e685b2a7dd6171a424830929.mp4'

async function main() {
  console.log('=== 开始端到端解析流程测试 ===')
  console.log(`测试视频: ${TEST_VIDEO_URL}`)
  console.log('')

  // 1. 创建测试用户（如果不存在）
  let user = await prisma.user.findFirst({ where: { email: 'test@test.com' } })
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: 'test@test.com',
        passwordHash: 'test-hash',
        nickname: 'Test User',
        creditBalance: 9999,
      },
    })
    console.log(`[1/9] 创建测试用户: ${user.id}`)
  } else {
    console.log(`[1/9] 使用已有用户: ${user.id}`)
  }

  // 2. 创建测试项目
  const project = await prisma.project.create({
    data: {
      userId: user.id,
      name: `解析测试_${Date.now()}`,
      videoUrl: TEST_VIDEO_URL,
      status: 'PARSING',
    },
  })
  console.log(`[2/9] 创建项目: ${project.id}`)
  console.log('')

  // 3. 动态导入 processParseVideo 并执行
  console.log('[3/9] 开始执行解析流程...')
  console.log('---')

  try {
    // 直接调用 worker 的核心处理函数
    const { processParseVideo } = await import('../src/workers/parse-video')

    // 模拟 BullMQ Job 对象
    const fakeJob = {
      data: {
        projectId: project.id,
        videoUrl: TEST_VIDEO_URL,
      },
      id: 'test-job-001',
      updateProgress: async () => {},
      log: async (msg: string) => console.log(`  [job-log] ${msg}`),
    }

    await processParseVideo(fakeJob as unknown as Parameters<typeof processParseVideo>[0])

    console.log('')
    console.log('---')
    console.log('[✅] 解析流程完成！')
    console.log('')

    // 4. 查询结果
    const updatedProject = await prisma.project.findUnique({ where: { id: project.id } })
    console.log(`[4/9] 项目状态: ${updatedProject?.status}`)
    console.log(`      时长: ${updatedProject?.duration}s`)
    console.log(`      宽高比: ${updatedProject?.aspectRatio}`)

    const shots = await prisma.shot.findMany({
      where: { projectId: project.id },
      orderBy: { orderIndex: 'asc' },
    })
    console.log(`[5/9] 分镜数量: ${shots.length}`)
    for (const shot of shots) {
      console.log(`      Shot ${shot.orderIndex}: ${shot.startTime.toFixed(1)}s-${shot.endTime.toFixed(1)}s | ${shot.shotType} | hasFace=${shot.hasFace} | group=${shot.shotGroupId || 'none'}`)
    }

    const groups = await prisma.shotGroup.findMany({
      where: { projectId: project.id },
      orderBy: { groupIndex: 'asc' },
    })
    console.log(`[6/9] 分镜组数量: ${groups.length}`)
    for (const g of groups) {
      console.log(`      Group ${g.groupIndex}: ${g.startTime.toFixed(1)}s-${g.endTime.toFixed(1)}s | duration=${g.genDuration.toFixed(1)}s | audio=${g.audioKey || 'none'}`)
    }

    const characters = await prisma.character.findMany({
      where: { projectId: project.id },
    })
    console.log(`[7/9] 人物数量: ${characters.length}`)
    for (const c of characters) {
      console.log(`      ${c.name}: ${c.appearance?.substring(0, 50)}...`)
    }

    // 检查异常
    console.log('')
    console.log('=== 问题检测 ===')
    let issues = 0

    // 检查是否有 shot 没有归组
    const ungroupedShots = shots.filter(s => !s.shotGroupId)
    if (ungroupedShots.length > 0) {
      issues++
      console.log(`❌ 有 ${ungroupedShots.length} 个分镜未归组`)
    }

    // 检查是否有组没有音频
    const noAudioGroups = groups.filter(g => !g.audioKey)
    if (noAudioGroups.length > 0) {
      issues++
      console.log(`⚠️  有 ${noAudioGroups.length} 个组没有音频: ${noAudioGroups.map(g => g.groupIndex).join(',')}`)
    }

    // 检查时间轴连续性
    for (let i = 1; i < shots.length; i++) {
      const gap = shots[i].startTime - shots[i - 1].endTime
      if (Math.abs(gap) > 0.5) {
        issues++
        console.log(`⚠️  Shot ${shots[i - 1].orderIndex} 和 Shot ${shots[i].orderIndex} 之间有 ${gap.toFixed(2)}s 的间隙/重叠`)
      }
    }

    // 检查 hasFace 是否都为 true（可能是模型没真正分析）
    const allHasFace = shots.every(s => s.hasFace)
    if (allHasFace && shots.length > 3) {
      issues++
      console.log(`⚠️  所有分镜 hasFace 都为 true，可能模型没有真正分析人脸`)
    }

    // 检查 coverUrl
    const noCoverShots = shots.filter(s => !s.coverUrl)
    if (noCoverShots.length > 0) {
      issues++
      console.log(`⚠️  有 ${noCoverShots.length} 个分镜没有封面URL`)
    }

    if (issues === 0) {
      console.log('✅ 未检测到明显问题')
    }

  } catch (error: unknown) {
    console.error('')
    console.error('---')
    console.error('[❌] 解析流程失败！')
    console.error(error)

    // 查看项目最终状态
    const failedProject = await prisma.project.findUnique({ where: { id: project.id } })
    console.error(`    项目状态: ${failedProject?.status}`)
    console.error(`    错误信息: ${failedProject?.errorMsg}`)
  }

  // 关闭连接
  await prisma.$disconnect()
  process.exit(0)
}

main().catch(err => {
  console.error('脚本异常:', err)
  process.exit(1)
})
