/**
 * 缺陷二（Bug 2）封面来源 —— 探索性测试（Property 2: Bug Condition）
 *
 * 对应 spec：.kiro/specs/video-gen-output-fixes
 * 依据 design「Bug Condition / isBugCondition_2」与「Correctness Properties / Property 2」。
 *
 * 缺陷条件 isBugCondition_2(group)：
 *   RETURN group.genStatus = 'SUCCEEDED'
 *      AND group.genVideoUrl 非空
 *      AND 前端 poster 来源 = group.shots[0].coverUrl（原始视频抽帧）
 *      AND 不存在任何来自 group.genVideoUrl 的封面字段
 *
 * 本测试编码「修复后应有的期望行为」（Property 2）：
 *   - 存在来自 group.genVideoUrl 自身抽帧的封面字段 ShotGroup.genCoverUrl；
 *   - 生成成功处理（atomicSuccessUpdate）从生成视频抽帧并写入 genCoverUrl；
 *   - 前端 ShotGroupData 暴露 genCoverUrl，VideoPlayer 的 poster 使用 genCoverUrl
 *     （而非原视频帧 group.shots[0]?.coverUrl）。
 *
 * !!! 重要 !!!
 * 本测试**必须在未修复代码上 FAIL** —— 失败即确认缺陷存在。
 * 失败是预期的正确结果，禁止为了让它通过而修改测试或源码。
 * 修复（任务 6）落地后，本测试将自然转为 PASS（验证 Property 2）。
 *
 * 缺陷二是「缺字段 + 接错线」的结构性缺陷（链路缺少「下载生成视频后抽生成视频自身帧作封面」一步），
 * 而非纯函数缺陷，故探索性断言锚定到真实代码结构：直接读取 Prisma schema、生成 Worker、
 * 前端组件的真实源码，断言修复后应存在的字段与接线。这与用户铁律一致——基于真实接口/真实结构，
 * 不构造假数据、不静默处理。
 *
 * Validates: Requirements 1.6, 1.7, 1.8
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

/** 仓库根目录（vitest 以项目根为 cwd 运行） */
const ROOT = process.cwd()

/** 读取仓库内真实源码文件 */
function readSource(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf-8')
}

/** 从 schema.prisma 抽取 `model ShotGroup { ... }` 代码块，用于字段断言 */
function extractShotGroupModel(schema: string): string {
  const start = schema.indexOf('model ShotGroup {')
  expect(start).toBeGreaterThanOrEqual(0) // 真实模型必须存在
  const rest = schema.slice(start)
  const end = rest.indexOf('\n}')
  expect(end).toBeGreaterThanOrEqual(0)
  return rest.slice(0, end + 2)
}

describe('缺陷二（Bug 2）封面来源 —— 探索性测试（Property 2: Bug Condition）', () => {
  // isBugCondition_2 的输入：一个 genStatus='SUCCEEDED' 且有 genVideoUrl 的分镜组，
  // 其原视频抽帧封面（shots[0].coverUrl）与生成视频内容不符。以真实数据形态固定该缺陷场景。
  const succeededGroup = {
    id: 'group-cuid-0001',
    projectId: 'proj-cuid-0001',
    groupIndex: 0,
    genStatus: 'SUCCEEDED' as const,
    // 生成成功后回存 OSS 的生成视频 URL（真实链路：generated/{projectId}/{shotGroupId}_{ts}.mp4）
    genVideoUrl: 'https://oss.example.com/generated/proj-cuid-0001/group-cuid-0001_1700000000000.mp4',
    shots: [
      // 原始视频解析阶段抽帧写入的封面（extractShotThumbnails），与生成视频内容不符
      { id: 'shot-cuid-0001', orderIndex: 0, prompt: null, coverUrl: 'https://oss.example.com/thumbnails/proj-cuid-0001/shot-cuid-0001.jpg' },
    ],
  }

  it('Req 1.6：ShotGroup 应有来自生成视频抽帧的封面字段 genCoverUrl（Prisma 模型）', () => {
    // 前置：缺陷场景成立（SUCCEEDED 且有生成视频 URL）
    expect(succeededGroup.genStatus).toBe('SUCCEEDED')
    expect(succeededGroup.genVideoUrl).toBeTruthy()

    const schema = readSource('prisma/schema.prisma')
    const model = extractShotGroupModel(schema)

    // 期望行为（Property 2 / Req 1.6）：存在承载「生成视频自身封面」的新字段 genCoverUrl
    // 未修复代码反例：ShotGroup 仅有 genVideoUrl / lastFrameUrl，无 genCoverUrl
    expect(model).toMatch(/genCoverUrl/)
    expect(model).toMatch(/gen_cover_url/)
  })

  it('Req 1.6：生成成功处理应从生成视频抽帧并写入 genCoverUrl（generate-video.ts / atomicSuccessUpdate）', () => {
    const worker = readSource('src/workers/generate-video.ts')

    // 期望行为（Property 2 / Req 1.6）：atomicSuccessUpdate 在事务内写入 genCoverUrl
    // 未修复代码反例：atomicSuccessUpdate 只写 genStatus/genVideoUrl/lastFrameUrl，从不抽生成视频封面
    expect(worker).toMatch(/genCoverUrl/)
  })

  it('Req 1.8：前端 ShotGroupData 应暴露 genCoverUrl 字段（ShotGroupList.tsx）', () => {
    const component = readSource('src/components/shot/ShotGroupList.tsx')

    // 期望行为（Property 2 / Req 1.8）：组数据结构暴露生成视频封面字段供 poster 使用
    // 未修复代码反例：ShotGroupData 仅有 genVideoUrl 与 shots[].coverUrl，无 genCoverUrl
    expect(component).toMatch(/genCoverUrl/)
  })

  it('Req 1.8：前端 poster 应使用生成视频封面 genCoverUrl，而非原视频帧 shots[0].coverUrl（ShotGroupList.tsx）', () => {
    const component = readSource('src/components/shot/ShotGroupList.tsx')

    // 定位 VideoPlayer 的 poster 表达式
    const posterMatch = component.match(/poster=\{([^}]*)\}/)
    expect(posterMatch).not.toBeNull()
    const posterExpr = posterMatch![1]

    // 期望行为（Property 2 / Req 1.8）：poster 使用 group.genCoverUrl（来自生成视频抽帧）
    // 未修复代码反例：poster = group.shots[0]?.coverUrl（原视频帧），与生成内容不符
    expect(posterExpr).toMatch(/genCoverUrl/)
    expect(posterExpr).not.toMatch(/shots\[0\]\?\.coverUrl/)
  })
})
