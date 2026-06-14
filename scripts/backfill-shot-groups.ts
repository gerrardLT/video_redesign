/**
 * 幂等数据回填脚本：为历史 Shot 补建分镜组（ShotGroup）归属
 *
 * 背景：
 *   多分镜合并生成功能新增了 ShotGroup 表与 Shot.shotGroupId 可空字段。
 *   迁移本身只新增表与可空列，不会为已存在的 Shot 建立分组归属。
 *   本脚本对"已存在但 shotGroupId 仍为 NULL"的 Shot，按所属项目分组，
 *   调用 Grouping_Service 的 groupShots 重算分组，创建 ShotGroup 记录，
 *   并回填 shots.shotGroupId。
 *
 * 铁律约束：
 *   - 仅补充归属关联（shotGroupId），绝不修改 Shot 既有业务字段（startTime/endTime/prompt 等）。
 *   - 可重复执行：已分组的 Shot 自动跳过；同一项目已存在的 ShotGroup 不重复创建。
 *   - 严禁任何 drop/delete/reset/truncate；全程使用 upsert 与查询/创建，不丢数据。
 *
 * 运行方式：
 *   npx tsx scripts/backfill-shot-groups.ts
 *
 * 对应需求：6.5
 */

import 'dotenv/config'
import { prisma } from '@/lib/db'
import { groupShots, type GroupingInputShot, type ShotGroupPlan } from '@/lib/grouping-service'

/** 单个项目的回填统计 */
interface ProjectBackfillResult {
  projectId: string
  /** 本次新建的 ShotGroup 数量 */
  createdGroups: number
  /** 本次复用的既有 ShotGroup 数量（幂等命中） */
  reusedGroups: number
  /** 本次回填 shotGroupId 的 Shot 数量 */
  linkedShots: number
}

/**
 * 回填单个项目：对该项目下尚未归组的 Shot 计算分组并补建 ShotGroup 归属。
 *
 * 幂等保证：
 *   - 仅选取 shotGroupId IS NULL 的 Shot 参与分组（已归组的 Shot 不参与、不被改动）。
 *   - ShotGroup 通过 (projectId, groupIndex) 唯一键 upsert，重复执行不会产生重复组。
 *   - 仅更新 Shot.shotGroupId，不触碰任何业务字段。
 */
async function backfillProject(projectId: string): Promise<ProjectBackfillResult> {
  const result: ProjectBackfillResult = {
    projectId,
    createdGroups: 0,
    reusedGroups: 0,
    linkedShots: 0,
  }

  // 仅取未归组的 Shot；已归组的 Shot 不参与计算，确保幂等与不改动既有归属
  const ungroupedShots = await prisma.shot.findMany({
    where: { projectId, shotGroupId: null },
    select: { id: true, orderIndex: true, startTime: true, endTime: true },
    orderBy: { orderIndex: 'asc' },
  })

  if (ungroupedShots.length === 0) {
    return result
  }

  // 计算该项目已存在的最大 groupIndex，新建分组在其之后顺延，避免与既有组序号冲突
  const maxExisting = await prisma.shotGroup.aggregate({
    where: { projectId },
    _max: { groupIndex: true },
  })
  const baseIndex = (maxExisting._max.groupIndex ?? -1) + 1

  // 调用 Grouping_Service 重算分组（纯函数，无副作用）
  const inputs: GroupingInputShot[] = ungroupedShots.map((s) => ({
    orderIndex: s.orderIndex,
    startTime: s.startTime,
    endTime: s.endTime,
  }))
  const plans: ShotGroupPlan[] = groupShots(inputs)

  // orderIndex -> Shot.id 映射，便于回填
  const orderIndexToShotId = new Map<number, string>()
  for (const s of ungroupedShots) {
    orderIndexToShotId.set(s.orderIndex, s.id)
  }

  for (const plan of plans) {
    // 顺延后的实际组序号，保证 (projectId, groupIndex) 唯一
    const groupIndex = baseIndex + plan.groupIndex

    // upsert 保证幂等：组已存在则复用（不覆盖业务快照字段），不存在则创建
    const existing = await prisma.shotGroup.findUnique({
      where: { projectId_groupIndex: { projectId, groupIndex } },
      select: { id: true },
    })

    let shotGroupId: string
    if (existing) {
      shotGroupId = existing.id
      result.reusedGroups += 1
    } else {
      const created = await prisma.shotGroup.create({
        data: {
          projectId,
          groupIndex,
          genDuration: plan.genDuration,
          startTime: plan.startTime,
          endTime: plan.endTime,
          // genStatus 使用模型默认值 PENDING；genVideoUrl/audioKey/timelineScript 留空
        },
        select: { id: true },
      })
      shotGroupId = created.id
      result.createdGroups += 1
    }

    // 回填该组内每个 Shot 的归属，仅更新 shotGroupId，不改动业务字段
    for (const orderIndex of plan.shotOrderIndexes) {
      const shotId = orderIndexToShotId.get(orderIndex)
      if (!shotId) {
        // 理论上不会发生：plan 的 orderIndex 全部来自 ungroupedShots
        throw new Error(
          `回填异常：项目 ${projectId} 组 ${groupIndex} 引用了不存在的 orderIndex=${orderIndex}`
        )
      }
      // 再次以 shotGroupId IS NULL 为条件，避免并发/重复执行时覆盖已有归属（幂等）
      const updated = await prisma.shot.updateMany({
        where: { id: shotId, shotGroupId: null },
        data: { shotGroupId },
      })
      result.linkedShots += updated.count
    }
  }

  return result
}

/** 脚本主入口：遍历所有存在未归组 Shot 的项目并逐一回填 */
async function main(): Promise<void> {
  console.log('[backfill-shot-groups] 开始回填历史分镜组归属...')

  // 找出所有"存在未归组 Shot"的项目（distinct 项目集合）
  const projectsWithUngrouped = await prisma.shot.findMany({
    where: { shotGroupId: null },
    select: { projectId: true },
    distinct: ['projectId'],
  })

  if (projectsWithUngrouped.length === 0) {
    console.log('[backfill-shot-groups] 没有需要回填的分镜，跳过。')
    return
  }

  console.log(`[backfill-shot-groups] 待处理项目数：${projectsWithUngrouped.length}`)

  let totalCreated = 0
  let totalReused = 0
  let totalLinked = 0

  for (const { projectId } of projectsWithUngrouped) {
    try {
      const r = await backfillProject(projectId)
      totalCreated += r.createdGroups
      totalReused += r.reusedGroups
      totalLinked += r.linkedShots
      console.log(
        `[backfill-shot-groups] 项目 ${projectId}：新建组 ${r.createdGroups}，复用组 ${r.reusedGroups}，回填分镜 ${r.linkedShots}`
      )
    } catch (err) {
      // 单个项目失败不影响其余项目；记录后继续，避免一处异常导致整体中断
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[backfill-shot-groups] 项目 ${projectId} 回填失败：${msg}`)
    }
  }

  console.log(
    `[backfill-shot-groups] 回填完成：累计新建组 ${totalCreated}，复用组 ${totalReused}，回填分镜 ${totalLinked}`
  )
}

main()
  .then(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
  .catch(async (err) => {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[backfill-shot-groups] 脚本执行失败：', msg)
    await prisma.$disconnect()
    process.exit(1)
  })
