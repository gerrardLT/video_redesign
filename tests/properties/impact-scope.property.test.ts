// Feature: local-life-depth-enhancements, Property 15: 受影响范围闭包不变式
import { describe, it, expect, vi } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: local-life-depth-enhancements
 * Property 15: 受影响范围闭包不变式
 *
 * 对任意分镜组结构、场景划分与尾帧承接关系，
 * impact-scope-service.computeReshootScope 返回的受影响分镜组集合
 * 必须恰等于：
 *   {被重拍镜头所属分镜组} ∪ {沿 frame-continuity 尾帧链依赖该尾帧的所有后续同场景分镜组}
 * 该集合必须在承接关系下闭合：
 *   - 不含无关组（不纳入与被重拍镜头不同场景、或位于断裂点之后的镜头）；
 *   - 无悬挂未纳入的后续承接组（断裂点之前的连续同场景后续镜头一个都不漏）。
 *
 * 实现语义（与 src/lib/impact-scope-service.ts 对齐）：
 *   本地生活模型中分镜组（合成最小单位）= 单个 ShotTask；沿 ShotTask.order 升序扫描，
 *   从被重拍镜头起纳入连续同场景镜头，首次跨场景断裂即终止链；场景标识用 frame-continuity
 *   的 normScene 归一化判定；缺少 framingGuide.scene 时显式抛错（本属性的生成器保证每个镜头
 *   都带 scene，故走非抛错路径）。
 *
 * **Validates: Requirements 4.3, 4.4, 4.5**
 *
 * 测试手段：对 @/lib/db 的 prisma.shotTask.findMany 做内存桩，随机生成带 scene 的 shotTasks，
 * 桩按 order 升序返回（模拟实现里的 orderBy: { order: 'asc' }）；不依赖真实数据库。
 */

// ========================
// Mock Prisma（内存桩：捕获 where 过滤并按 order 升序返回，模拟真实 findMany）
// ========================
vi.mock('@/lib/db', () => ({
  prisma: {
    shotTask: {
      findMany: vi.fn(),
    },
  },
}))

// 动态导入以确保 mock 生效
const { prisma } = await import('@/lib/db')
const { computeReshootScope } = await import('@/lib/impact-scope-service')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const findMany = prisma.shotTask.findMany as unknown as ReturnType<typeof vi.fn>

/** 与 frame-continuity.normScene 一致的场景归一化：去首尾空白、去内部空白、转小写 */
const normScene = (s: string): string => s.trim().replace(/\s+/g, '').toLowerCase()

// ========================
// Arbitraries
// ========================

/**
 * 原始场景字符串生成器：刻意包含大小写 / 空白装饰，使若干不同原始串归一化为同一场景，
 * 借此同时验证 normScene 归一化口径下的「同场景」判定。
 */
const rawSceneArb = fc.constantFrom(
  'cafe',
  ' cafe ',
  'CAFE',
  'C a F e',
  'street',
  ' Street ',
  'kitchen',
  'KITCHEN',
  'counter',
  ' Counter'
)

/** 单个镜头记录：order 在数组内唯一（用于稳定排序），scene 为带 framingGuide 的原始场景串 */
const shotRecordArb = fc.record({
  order: fc.integer({ min: 0, max: 10_000 }),
  scene: rawSceneArb,
})

/** 一组镜头（order 唯一），1..8 个 */
const shotsArb = fc.uniqueArray(shotRecordArb, {
  minLength: 1,
  maxLength: 8,
  selector: (r) => r.order,
})

describe('Property 15: 受影响范围闭包不变式 (computeReshootScope)', () => {
  it('受影响集合 = 从被重拍镜头起的连续同场景前缀（闭合：不含无关组、无悬挂后续承接组）', async () => {
    /**
     * **Validates: Requirements 4.3, 4.4, 4.5**
     */
    await fc.assert(
      fc.asyncProperty(shotsArb, fc.nat(), async (shots, pick) => {
        findMany.mockReset()

        const contentBriefId = 'brief-1'

        // 赋稳定 id，并构造 ShotTask（含 framingGuide.scene），保证每个都有场景，避免抛错
        const shotTasks = shots.map((s, i) => ({
          id: `shot-${i}`,
          order: s.order,
          framingGuide: { scene: s.scene },
        }))

        // 内存桩：模拟 prisma.shotTask.findMany —— 按 contentBriefId 过滤、order 升序返回
        findMany.mockImplementation(
          async ({ where }: { where: { contentBriefId: string } }) => {
            if (where.contentBriefId !== contentBriefId) return []
            return [...shotTasks].sort((a, b) => a.order - b.order)
          }
        )

        // 实现内部依据 order 升序判定承接链，故期望值在「按 order 排序后的序列」上计算
        const sorted = [...shotTasks].sort((a, b) => a.order - b.order)

        // 选定被重拍镜头（确定性地从排序后序列中取一个）
        const startIndex = pick % sorted.length
        const startId = sorted[startIndex].id
        const startScene = normScene(sorted[startIndex].framingGuide.scene)

        // 期望受影响集合：从起点起连续同场景前缀，首次跨场景即终止
        const expected: string[] = [sorted[startIndex].id]
        let breakIndex = sorted.length // 链终止后的第一个下标（默认无终止）
        for (let i = startIndex + 1; i < sorted.length; i++) {
          if (normScene(sorted[i].framingGuide.scene) !== startScene) {
            breakIndex = i
            break
          }
          expected.push(sorted[i].id)
        }

        const result = await computeReshootScope({ contentBriefId, shotTaskId: startId })

        // 1) 恰等于期望集合（顺序也与实现一致：沿 order 升序）
        expect(result.affectedGroupIds).toStrictEqual(expected)

        // 2) 起点必然被纳入
        expect(result.affectedGroupIds).toContain(startId)

        // 3) 闭合-无关组：受影响集合内每个镜头都与被重拍镜头同场景
        for (const id of result.affectedGroupIds) {
          const task = sorted.find((t) => t.id === id)!
          expect(normScene(task.framingGuide.scene)).toBe(startScene)
        }

        // 4) 闭合-无悬挂后续承接组：断裂点（若存在）正好是首个不同场景镜头，
        //    即被排除的第一个后续镜头必为跨场景（不存在「本应纳入却被漏掉」的同场景后续组）
        if (breakIndex < sorted.length) {
          expect(result.affectedGroupIds).not.toContain(sorted[breakIndex].id)
          expect(normScene(sorted[breakIndex].framingGuide.scene)).not.toBe(startScene)
        }

        // 5) hasContinuityChain 当且仅当受影响范围扩散到被重拍镜头之外
        expect(result.hasContinuityChain).toBe(result.affectedGroupIds.length > 1)
      }),
      { numRuns: 200 }
    )
  })
})
