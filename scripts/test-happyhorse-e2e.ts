/**
 * HappyHorse V-Edit 端到端测试脚本
 *
 * 流程：
 * 1. 上传 3 张参考图到 OSS
 * 2. 获取项目的原视频 OSS URL
 * 3. 直接调用 HappyHorse API（createHappyHorseTask）
 * 4. 轮询任务状态直到完成
 * 5. 下载结果视频到 OSS
 *
 * 用法: npx tsx scripts/test-happyhorse-e2e.ts
 */
import 'dotenv/config'
import { uploadFile, getPublicUrl } from '../src/lib/storage'
import { createHappyHorseTask, getHappyHorseTaskStatus } from '../src/lib/happyhorse'
import path from 'path'

// 配置
const REF_IMAGES = [
  'C:\\Users\\gerrard\\Desktop\\测试视频\\1.jpg',
  'C:\\Users\\gerrard\\Desktop\\测试视频\\2.jpg',
  'C:\\Users\\gerrard\\Desktop\\测试视频\\3.jpg',
]
const PROMPT = '使用上传的三张帽子图片替换视频中人物的帽子，[Image 1] [Image 2] [Image 3] 中的帽子样式，其他完全保持不变'
const POLL_INTERVAL = 5000 // 5秒
const MAX_POLL_TIME = 10 * 60 * 1000 // 10分钟

async function main() {
  console.log('===== HappyHorse V-Edit 端到端测试 =====')
  console.log()

  // Step 1: 上传参考图到 OSS
  console.log('[Step 1] 上传 3 张参考图到 OSS...')
  const imageUrls: string[] = []
  for (let i = 0; i < REF_IMAGES.length; i++) {
    const filePath = REF_IMAGES[i]
    const ossKey = `test/happyhorse-ref/ref_${i + 1}_${Date.now()}.jpg`
    console.log(`  上传 ${path.basename(filePath)} → ${ossKey}`)
    const url = await uploadFile(ossKey, filePath)
    imageUrls.push(url)
    console.log(`  ✓ 完成: ${url}`)
  }
  console.log()

  // Step 2: 获取测试视频 URL（使用项目 t11 的原视频）
  // 从数据库查项目的 videoUrl，或直接用一个已知的 OSS 视频
  const { prisma } = await import('../src/lib/db')
  const project = await prisma.project.findFirst({
    where: { name: 't11' },
    select: { id: true, videoUrl: true, duration: true },
  })

  if (!project || !project.videoUrl) {
    console.error('[Error] 找不到项目 t11 或无原始视频 URL')
    process.exit(1)
  }

  // videoUrl 可能是 /api/media/xxx 代理路径，需要转换为真实 OSS URL
  let videoUrl = project.videoUrl
  if (videoUrl.startsWith('/api/media/')) {
    // 从代理路径提取 OSS key，生成公网 URL
    const key = decodeURIComponent(videoUrl.replace('/api/media/', ''))
    videoUrl = getPublicUrl(key)
  }

  console.log(`[Step 2] 使用项目视频: ${videoUrl.substring(0, 80)}...`)
  console.log(`  时长: ${project.duration}s`)
  console.log()

  // Step 3: 创建 HappyHorse V-Edit 任务
  console.log('[Step 3] 创建 HappyHorse V-Edit 任务...')
  console.log(`  prompt: ${PROMPT}`)
  console.log(`  参考图: ${imageUrls.length} 张`)
  imageUrls.forEach((url, i) => console.log(`    [Image ${i + 1}]: ${url.substring(0, 80)}...`))

  const { taskId } = await createHappyHorseTask({
    videoUrl,
    prompt: PROMPT,
    referenceImages: imageUrls,
    resolution: '720P',
    audioSetting: 'origin',
  })

  console.log(`  ✓ 任务已创建: taskId = ${taskId}`)
  console.log()

  // Step 4: 轮询任务状态
  console.log('[Step 4] 轮询任务状态（每 5 秒）...')
  const startTime = Date.now()
  let status = await getHappyHorseTaskStatus(taskId)
  let pollCount = 0

  while (
    (status.status === 'PENDING' || status.status === 'RUNNING') &&
    Date.now() - startTime < MAX_POLL_TIME
  ) {
    pollCount++
    const elapsed = Math.round((Date.now() - startTime) / 1000)
    console.log(`  [${elapsed}s] 第 ${pollCount} 次轮询 - 状态: ${status.status}`)
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL))
    status = await getHappyHorseTaskStatus(taskId)
  }

  const totalTime = Math.round((Date.now() - startTime) / 1000)
  console.log()

  // Step 5: 处理结果
  if (status.status === 'SUCCEEDED') {
    console.log(`[Step 5] ✓ 生成成功！耗时 ${totalTime} 秒`)
    console.log(`  DashScope 结果 URL（24h 过期）: ${status.videoUrl?.substring(0, 100)}...`)
    console.log(`  输入时长: ${status.inputDuration}s`)
    console.log(`  输出时长: ${status.outputDuration}s`)

    // 下载并转存到 OSS
    if (status.videoUrl) {
      console.log()
      console.log('  正在下载结果视频并转存到 OSS...')
      const response = await fetch(status.videoUrl)
      if (!response.ok) {
        console.error(`  下载失败: HTTP ${response.status}`)
        process.exit(1)
      }
      const buffer = Buffer.from(await response.arrayBuffer())
      console.log(`  视频大小: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`)

      const ossKey = `generated/test/happyhorse_result_${Date.now()}.mp4`
      const ossUrl = await uploadFile(ossKey, buffer as unknown as string)
      // 注: uploadFile 接受文件路径不接受 buffer，需要先写临时文件
      const fs = await import('fs/promises')
      const tmpPath = `./public/uploads/temp/hh_test_${Date.now()}.mp4`
      await fs.mkdir(path.dirname(tmpPath), { recursive: true })
      await fs.writeFile(tmpPath, buffer)
      const finalUrl = await uploadFile(ossKey, tmpPath)
      await fs.unlink(tmpPath).catch(() => {})

      console.log(`  ✓ 已转存到 OSS: ${finalUrl}`)
    }
  } else if (status.status === 'FAILED') {
    console.log(`[Step 5] ✗ 生成失败！耗时 ${totalTime} 秒`)
    console.log(`  错误码: ${status.error?.code}`)
    console.log(`  错误信息: ${status.error?.message}`)
  } else {
    console.log(`[Step 5] ⚠ 轮询超时（${totalTime}s），任务未完成`)
    console.log(`  最后状态: ${status.status}`)
  }

  console.log()
  console.log('===== 测试结束 =====')
  process.exit(0)
}

main().catch(err => {
  console.error('[Fatal Error]', err)
  process.exit(1)
})
