# Implementation Plan: User Concurrency Control (基于用户等级的并发控制)

## Overview

在现有订阅会员体系基础上，实现基于用户等级（FREE/MONTHLY/YEARLY）的并发控制子系统。包括并发额度配置、Redis 原子计数器、队列优先级调度、生成模式编排（链式/并行）、定时对账 Worker，以及 API 层入队前门控。所有核心逻辑封装为纯函数 + Redis 操作层，确保可测试性和正确性。

## Tasks

- [x] 1. 基础常量与类型定义
  - [x] 1.1 创建并发控制常量文件 `src/constants/concurrency.ts`
    - 定义 `CONCURRENCY_LIMITS` 常量映射：FREE=(parse:1, generate:1, merge:1), MONTHLY=(parse:2, generate:3, merge:1), YEARLY=(parse:5, generate:Infinity, merge:2)
    - 定义 `QUEUE_PRIORITIES` 常量映射：FREE=5, MONTHLY=3, YEARLY=1
    - 定义 `GENERATION_MODES` 常量映射：FREE='chain', MONTHLY='parallel', YEARLY='parallel'
    - 定义 `TaskType` 类型、`UserTier` 类型、`ConcurrencyConfig` 接口
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3_

  - [ ]* 1.2 编写并发配置常量属性测试
    - **Property 1: Concurrency limit configuration correctness**
    - **Property 2: Queue priority mapping correctness**
    - **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3**
    - 测试文件: `src/__tests__/properties/concurrency-control.property.test.ts`

- [x] 2. PrivilegeEngine 扩展
  - [x] 2.1 扩展 `src/lib/privilege-engine.ts` 添加并发配置
    - 新增 `getConcurrencyConfig(tier: UserTier): ConcurrencyConfig` 纯函数
    - 新增 `getGenerationMode(tier: UserTier): 'chain' | 'parallel'` 纯函数
    - 新增 `determineTier(subscriptionStatus, planType): UserTier` 纯函数
    - 扩展 `UserPrivileges` 接口添加 `tier`、`concurrency`、`generationMode` 字段
    - 修改 `getUserPrivileges` 在返回值中包含并发配置
    - _Requirements: 1.4, 1.5_

  - [ ]* 2.2 编写生成模式与批量大小属性测试
    - **Property 5: Generation mode and batch size determination**
    - **Property 6: Parallel mode job flag invariant**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.5, 4.6**
    - 测试文件: `src/__tests__/properties/concurrency-control.property.test.ts`

- [x] 3. PriorityScheduler 实现
  - [x] 3.1 创建 `src/lib/priority-scheduler.ts`
    - 实现 `getQueuePriority(tier: UserTier): number` 纯函数
    - 实现 `scheduleWithPriority(queue, jobName, data, tier, additionalOpts?)` 包装函数
    - 在 queue.add 时设置 opts.priority 字段
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 4. Checkpoint - 确保基础模块通过测试
  - 确保所有测试通过，如有问题请向用户确认。

- [x] 5. ConcurrencyController 实现
  - [x] 5.1 创建 `src/lib/concurrency-controller.ts` 核心逻辑
    - 实现 Redis Lua 脚本：原子 check-and-increment（INCR → 超限回滚 DECR）
    - 实现 Redis Lua 脚本：安全 decrement（不低于 0）
    - 实现 `checkAndIncrement(userId, taskType, limit): Promise<ConcurrencyCheckResult>`
    - 实现 `decrement(userId, taskType): Promise<void>`
    - Redis key 模式: `concurrency:{userId}:{taskType}`
    - _Requirements: 3.5, 3.6_

  - [x] 5.2 实现 `getActiveTaskCountsFromDB` 和对账逻辑
    - 实现从数据库查询用户各类型活跃任务计数（parse: DOWNLOADING/PARSING, generate: QUEUED/GENERATING/SUBMITTED/CREDIT_RESERVED, merge: MERGING）
    - 实现 `reconcile(userId)`: 从 DB 重建单用户 Redis 计数器
    - 实现 `reconcileAll()`: 扫描所有有活跃任务的用户并逐一对账
    - _Requirements: 3.1, 3.2, 3.3, 6.3, 6.4_

  - [x] 5.3 实现 `buildRejectionResponse` 构建超限拒绝响应
    - 返回包含 currentTier、currentLimit、nextTierLimit、upgradePrompt 的结构化响应
    - 确保 nextTierLimit 严格大于 currentLimit（或 'unlimited'）
    - _Requirements: 3.4, 7.1, 7.3_

  - [ ]* 5.4 编写并发准入决策属性测试
    - **Property 4: Concurrency admission decision**
    - **Validates: Requirements 3.4, 3.5**
    - 测试文件: `src/__tests__/properties/concurrency-control.property.test.ts`

  - [ ]* 5.5 编写活跃任务计数属性测试
    - **Property 3: Active task counting correctness**
    - **Validates: Requirements 3.1, 3.2, 3.3**
    - 测试文件: `src/__tests__/properties/concurrency-control.property.test.ts`

  - [ ]* 5.6 编写终态递减属性测试
    - **Property 10: Terminal state decrements active count**
    - **Validates: Requirements 6.1**
    - 测试文件: `src/__tests__/properties/concurrency-control.property.test.ts`

  - [ ]* 5.7 编写对账一致性属性测试
    - **Property 11: Reconciliation corrects Redis counter**
    - **Validates: Requirements 6.3, 6.4**
    - 测试文件: `src/__tests__/properties/concurrency-control.property.test.ts`

  - [ ]* 5.8 编写拒绝响应结构属性测试
    - **Property 12: Rejection response contains upgrade information**
    - **Validates: Requirements 7.1, 7.3**
    - 测试文件: `src/__tests__/properties/concurrency-control.property.test.ts`

- [x] 6. GenerationOrchestrator 实现
  - [x] 6.1 创建 `src/lib/generation-orchestrator.ts`
    - 实现 `calculateParallelBatchSize(totalGroups, concurrencyLimit): number` 纯函数
    - 实现 `orchestrateGeneration` 方法：
      - 根据 tier 确定模式（chain/parallel）
      - 计算全部组积分总额
      - 余额校验（不足则拒绝 INSUFFICIENT_CREDITS）
      - withCreditLock 原子冻结全部积分
      - FREE: 仅入队第一组（chainMode=true）
      - MONTHLY: 入队 min(N, 3) 组（chainMode=false）
      - YEARLY: 全量入队（chainMode=false）
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3_

  - [ ]* 6.2 编写积分总额计算属性测试
    - **Property 7: Total credit cost is sum of group costs**
    - **Validates: Requirements 5.1**
    - 测试文件: `src/__tests__/properties/concurrency-control.property.test.ts`

  - [ ]* 6.3 编写余额不足拒绝属性测试
    - **Property 8: Credit insufficiency rejection**
    - **Validates: Requirements 5.2**
    - 测试文件: `src/__tests__/properties/concurrency-control.property.test.ts`

  - [ ]* 6.4 编写隔离退款属性测试
    - **Property 9: Isolated refund for failed parallel groups**
    - **Validates: Requirements 5.4**
    - 测试文件: `src/__tests__/properties/concurrency-control.property.test.ts`

- [x] 7. Checkpoint - 确保核心逻辑模块通过测试
  - 确保所有测试通过，如有问题请向用户确认。

- [x] 8. API 路由集成并发控制
  - [x] 8.1 修改解析 API 路由添加并发检查
    - 在 `/api/projects/[id]/parse` 入队前调用 `checkAndIncrement(userId, 'parse', limit)`
    - 超限返回 HTTP 429 + CONCURRENCY_LIMIT_REACHED 响应体
    - 使用 `scheduleWithPriority` 替代原直接 queue.add
    - _Requirements: 2.4, 3.1, 3.4, 3.6_

  - [x] 8.2 修改生成 API 路由集成 GenerationOrchestrator
    - 在 `/api/projects/[id]/generate` 替换现有一键生成逻辑为 `orchestrateGeneration`
    - 入队前并发检查（generate 类型）
    - 根据 tier 使用不同模式编排
    - 超限/余额不足返回对应错误码
    - _Requirements: 3.2, 3.4, 4.1, 4.2, 4.3, 5.2_

  - [x] 8.3 修改合并 API 路由添加并发检查
    - 在 `/api/projects/[id]/export` 入队前调用 `checkAndIncrement(userId, 'merge', limit)`
    - 超限返回 HTTP 429 + CONCURRENCY_LIMIT_REACHED 响应体
    - 使用 `scheduleWithPriority` 设置合并任务优先级
    - _Requirements: 2.4, 3.3, 3.4, 3.6_

  - [x] 8.4 在现有 Worker 完成/失败回调中添加并发计数递减
    - 修改 `src/workers/parse-video.ts` 完成/失败时调用 `decrement(userId, 'parse')`
    - 修改 `src/workers/generate-video.ts` 完成/失败时调用 `decrement(userId, 'generate')`
    - 修改 `src/workers/merge-video.ts` 完成/失败时调用 `decrement(userId, 'merge')`
    - _Requirements: 6.1, 6.2_

- [x] 8.5 前端链式生成模式升级提示
    - 在一键生成触发后，若用户为 FREE tier 且使用 Chain_Mode，前端展示提示信息（如 banner/toast）告知付费用户支持并行生成
    - 提示内容包含升级入口链接和并行生成的速度优势描述
    - _Requirements: 7.2_

- [x] 9. 对账 Worker 实现
  - [x] 9.1 创建 `src/workers/concurrency-reconcile.ts`
    - 注册为 BullMQ repeatable job（每 5 分钟执行）
    - 调用 `ConcurrencyController.reconcileAll()` 执行全量对账
    - 记录对账日志（修复了哪些用户的计数偏差）
    - 在 Worker 入口 `src/workers/index.ts` 中注册启动
    - _Requirements: 6.3, 6.4_

  - [ ]* 9.2 编写对账 Worker 单元测试
    - 测试定时触发逻辑
    - 测试正偏差修复（Redis > DB）
    - 测试负偏差修复（Redis < DB）
    - 测试 Redis 异常时的错误处理
    - _Requirements: 6.3, 6.4_

- [x] 10. Checkpoint - 确保完整集成通过测试
  - 确保所有测试通过，如有问题请向用户确认。

- [x] 11. 最终集成与端到端验证
  - [x] 11.1 编写 ConcurrencyController 单元测试
    - 测试文件: `src/__tests__/unit/concurrency-controller.test.ts`
    - 覆盖: checkAndIncrement 正常放行、超限拒绝、边界值
    - 覆盖: decrement 正常递减、计数为 0 时不变负
    - 覆盖: reconcile 修复正偏差和负偏差
    - 覆盖: buildRejectionResponse 各 tier 升级提示
    - _Requirements: 3.4, 3.5, 3.6, 6.1, 6.3, 6.4, 7.1, 7.3_

  - [ ]* 11.2 编写集成测试验证端到端流程
    - 测试文件: `src/__tests__/integration/concurrency-flow.test.ts`
    - 覆盖: 并发入队 → 超限拒绝 → 任务完成 → 额度释放 → 再次入队成功
    - 覆盖: 并行模式生成 → 部分失败 → 隔离退款
    - 覆盖: 对账修复后入队恢复正常
    - _Requirements: 3.4, 3.5, 4.1, 4.2, 4.3, 5.4, 6.3_

- [x] 12. Final checkpoint - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- 所有属性测试集中在 `src/__tests__/properties/concurrency-control.property.test.ts` 文件中
- 实现语言: TypeScript，与设计文档一致
- Redis Lua 脚本保证并发原子性，避免 check-then-act 竞态
- 对账 Worker 作为安全网，修复 Worker 崩溃/Redis 重启导致的计数泄漏
- YEARLY tier generate 限制为 Infinity，实际由 BullMQ Worker concurrency 自然限流
- 积分冻结复用现有 `withCreditLock` 机制，保证原子性

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "3.1"] },
    { "id": 2, "tasks": ["2.2", "5.1"] },
    { "id": 3, "tasks": ["5.2", "5.3"] },
    { "id": 4, "tasks": ["5.4", "5.5", "5.6", "5.7", "5.8", "6.1"] },
    { "id": 5, "tasks": ["6.2", "6.3", "6.4", "8.1", "8.3"] },
    { "id": 6, "tasks": ["8.2", "8.4", "8.5", "9.1"] },
    { "id": 7, "tasks": ["9.2", "11.1"] },
    { "id": 8, "tasks": ["11.2"] }
  ]
}
```
