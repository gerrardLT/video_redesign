# Implementation Plan: Codebase Hygiene Fixes

## Overview

将代码库从 SQLite 语义迁移到 PostgreSQL 语义（测试+注释），并按业务域重组 src/lib 目录。采用两阶段并行策略：Phase A 处理测试重写与 Schema 注释清理，Phase B 处理域目录重组与 import 路径更新。测试文件使用最终域路径编写，因此安排在文件迁移之后。

## Tasks

- [x] 1. 创建域目录结构与 Schema 注释清理
  - [x] 1.1 创建 src/lib 域子目录
    - 在 `src/lib/` 下创建 `video/`、`merchant/`、`shared/` 三个子目录
    - 已存在子目录（platform-fetchers/、sse/、validations/、validators/、__tests__/）保持原位不动
    - 不创建任何 index.ts barrel 文件
    - _Requirements: 5.1, 5.2, 5.3, 5.8_

  - [x] 1.2 清理 Prisma Schema 过时注释
    - 打开 `prisma/schema.prisma`
    - 找到 Shot 模型的 `dialogue` 字段注释，将 `// JSON 字符串，SQLite 无 JSON 类型` 修改为 `// JSON 字符串，存储对话/台词信息`
    - 全文检索确认不存在任何引用 SQLite 限制或特性的注释
    - _Requirements: 4.1, 4.2_

- [x] 2. 迁移视频域模块至 video/ 子目录
  - [x] 2.1 移动 Video_Domain 模块文件
    - 将以下文件从 `src/lib/` 移至 `src/lib/video/`：
      - seedance.ts, video-analyzer.ts, ffmpeg.ts, frame-continuity.ts, transition-engine.ts
      - grouping-service.ts, script-merger.ts, generation-orchestrator.ts, group-gen-context.ts
      - wavespeed.ts, segment-concat.ts, segment-service.ts
      - workspace-generation-service.ts, workspace-request-builder.ts, workspace-validators.ts
      - version-history-service.ts, frame-calculator.ts, boundary-snapper.ts
      - reference-builder.ts, render-pipeline.ts, preview-transform.ts
      - prompt-parser.ts, shot-schema.ts, appearance-comparator.ts
    - 使用文件系统移动（mv），不修改文件内容
    - _Requirements: 5.1_

- [x] 3. 迁移商家域模块至 merchant/ 子目录
  - [x] 3.1 移动 Merchant_Domain 模块文件
    - 将以下文件从 `src/lib/` 移至 `src/lib/merchant/`：
      - merchant-auth.ts, store-profile-service.ts, playbook-engine.ts
      - content-calendar-service.ts, capture-director.ts, local-render-service.ts
      - ai-auto-render-service.ts, compliance-service.ts, content-entropy-service.ts
      - copy-generator.ts, publish-copy-service.ts, publish-queue-service.ts
      - metrics-ingestor.ts, platform-metrics-crawler.ts, performance-learning-service.ts
      - merchant-billing-service.ts, merchant-context-builder.ts, merchant-templates.ts
      - content-brief-api-error.ts, content-brief-state-machine.ts, content-score-service.ts
      - cross-store-service.ts, engagement-service.ts, impact-scope-service.ts
      - matrix-dispatch-service.ts, poi-injection-service.ts, sensitive-words.ts
      - platform-presets.ts, trending-video-analyzer.ts, task-center-service.ts, period-service.ts
    - 使用文件系统移动（mv），不修改文件内容
    - _Requirements: 5.2_

- [x] 4. 迁移共享域模块至 shared/ 子目录
  - [x] 4.1 移动 Shared_Domain 模块文件
    - 将以下文件从 `src/lib/` 移至 `src/lib/shared/`：
      - db.ts, db-retry.ts, redis.ts, queue.ts, auth.ts, auth-helpers.ts
      - logger.ts, storage.ts, distributed-lock.ts, concurrency-controller.ts
      - credit-service.ts, credit-calc.ts, credit-dispatcher.ts
      - priority-scheduler.ts, privilege-engine.ts, progress-publisher.ts
      - rate-limiter.ts, subscription-service.ts, notification-service.ts
      - order-service.ts, onboarding-service.ts, api-client.ts, api-error.ts
      - utils.ts, expiry-status.ts, state-machine.ts, stepper-navigation.ts
      - placeholder-utils.ts, validate-share-link.ts
      - asset-ingestion-service.ts, asset-library-service.ts, asset-lifecycle-service.ts
      - face-detection-service.ts, flux.ts, help-center-service.ts
      - sample-project-service.ts, showcase-service.ts, style-service.ts
      - video-import-service.ts, happyhorse.ts, happyhorse-workspace.ts, script-hash.ts
    - 使用文件系统移动（mv），不修改文件内容
    - _Requirements: 5.3_

- [x] 5. Checkpoint - 确认文件迁移完成
  - 验证 `src/lib/` 根目录不再包含已迁移的 .ts 文件（仅保留子目录）
  - 确认 video/、merchant/、shared/ 中文件数量与迁移清单一致
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 5.5_

- [x] 6. 更新全部 import 路径
  - [x] 6.1 更新 Video_Domain 模块的 import 路径
    - 在项目全局搜索 `@/lib/seedance`、`@/lib/video-analyzer`、`@/lib/ffmpeg` 等所有 video 域模块的旧 import 路径
    - 替换为 `@/lib/video/{module-name}` 格式
    - 覆盖范围：src/app/api/、src/workers/、src/components/、src/lib/ 内部互引、tests/ 目录
    - _Requirements: 5.4, 5.6_

  - [x] 6.2 更新 Merchant_Domain 模块的 import 路径
    - 在项目全局搜索所有 merchant 域模块的旧 import 路径（@/lib/merchant-auth、@/lib/store-profile-service 等）
    - 替换为 `@/lib/merchant/{module-name}` 格式
    - 覆盖范围：src/app/api/、src/workers/、src/components/、src/lib/ 内部互引、tests/ 目录
    - _Requirements: 5.4, 5.6_

  - [x] 6.3 更新 Shared_Domain 模块的 import 路径
    - 在项目全局搜索所有 shared 域模块的旧 import 路径（@/lib/db、@/lib/redis、@/lib/auth 等）
    - 替换为 `@/lib/shared/{module-name}` 格式
    - 覆盖范围：src/app/api/、src/workers/、src/components/、src/lib/ 内部互引、tests/ 目录
    - 特别注意：域子目录内部的模块互引也需更新（如 video/ 下模块引用 shared/ 下模块）
    - _Requirements: 5.4, 5.6_

- [x] 7. Checkpoint - 确认 import 路径更新完整
  - 执行 `tsc --noEmit` 验证无编译错误
  - 若有 "Cannot find module" 错误，逐一修复遗漏的 import 路径
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 5.6, 6.2_

- [x] 8. 重写单元测试文件为 PostgreSQL 语义
  - [x] 8.1 重写 `tests/unit/db-retry.test.ts`
    - 完全重写文件，导入 `{ isRetriableError, withRetry, RETRY_CONFIG, _internals }` from `@/lib/shared/db-retry`
    - 实现 isRetriableError 测试组：验证 P2034、deadlock detected、could not serialize access 返回 true；其他 Error 和非 Error 类型返回 false
    - 实现 RETRY_CONFIG 测试组：验证 maxRetries === 3，delays === [200, 500, 1000]
    - 实现 withRetry 测试组（注入零延迟 sleep via _internals）：首次成功直接返回、非可重试错误立即抛出、N 次可重试后恢复 sleep 序列正确、4 次可重试抛出最后错误
    - 确保文件中无任何 "SQLITE_BUSY"、"database is locked"、"isSQLiteLockError" 引用
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13, 6.1_

  - [ ]* 8.2 为 isRetriableError 编写属性测试
    - **Property 1: isRetriableError 正确识别可重试错误**
    - **Property 2: isRetriableError 拒绝非可重试输入**
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2**

- [x] 9. 重写属性测试文件 A 为 PostgreSQL 语义
  - [x] 9.1 重写 `src/__tests__/properties/db-retry.property.test.ts`
    - 完全重写文件，文件头注释描述 PostgreSQL 事务冲突重试语义（P2034/deadlock/serialization failure）
    - 使用 fast-check 生成 retriableErrorMessageArb（包含 P2034、deadlock detected、could not serialize access 及其随机后缀变体）
    - 使用 fast-check 生成 nonRetriableErrorMessageArb（过滤排除三种可重试特征）
    - 实现属性：N 次重试后成功 → sleep 序列为 [200, 500, 1000] 的前 N 个元素
    - 实现属性：非可重试错误 → 立即抛出，调用次数 1，sleep 次数 0
    - 实现属性：连续 4 次可重试 → 抛出原始错误，总调用 4 次，sleep 序列 [200, 500, 1000]
    - 实现属性：第 M+1 次成功时返回值严格相等
    - 实现属性：M 次可重试后一次非可重试 → 非可重试错误立即抛出，sleep 次数 = M
    - 确保文件中无任何 "SQLITE_BUSY"、"database is locked"、"SQLite" 引用
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9_

  - [ ]* 9.2 为 withRetry 延迟序列编写属性测试
    - **Property 3: withRetry 返回值保持不变**
    - **Property 4: withRetry 延迟序列正确性**
    - **Validates: Requirements 1.9, 1.11, 2.3, 2.6**

  - [ ]* 9.3 为 withRetry 错误传播编写属性测试
    - **Property 5: withRetry 非可重试错误立即传播**
    - **Property 6: withRetry 重试耗尽后抛出原始错误**
    - **Property 7: withRetry 混合失败序列正确处理**
    - **Validates: Requirements 1.10, 1.12, 2.4, 2.5, 2.7**

- [x] 10. 重写属性测试文件 B 为 PostgreSQL 语义
  - [x] 10.1 重写 `tests/properties/idempotent-cleanup.property.test.ts`
    - 修改文件头注释为 PostgreSQL 幂等清理属性描述
    - 将所有 `'SQLITE_BUSY: database is locked'` 替换为 `'P2034: Transaction failed due to a write conflict'`
    - 保留原有幂等性验证逻辑不变（清理顺序、失败隔离、跨项目不影响、二次清理等价性）
    - 确保文件中无任何 "SQLITE_BUSY"、"database is locked"、"SQLite" 引用
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [ ]* 10.2 为幂等清理编写属性测试
    - **Property 8: 幂等清理完整性与隔离性**
    - **Validates: Requirements 3.3**

- [x] 11. Final checkpoint - 全量验证
  - [x] 11.1 执行 TypeScript 编译验证
    - 运行 `tsc --noEmit`，确认零错误
    - 若有类型错误，逐一修复（悬空引用、类型不匹配等）
    - 确认无 any 类型引入，严格模式兼容
    - _Requirements: 5.6, 6.2, 6.3_

  - [x] 11.2 执行全量测试验证
    - 运行 `pnpm test`，确认退出码为 0
    - 若有测试失败，根据错误信息修复（import 路径遗漏、断言值不匹配等）
    - 确认 RETRY_CONFIG 断言与 DB_Retry_Module 实际导出值一致
    - _Requirements: 5.7, 6.1_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Phase A（测试重写 + Schema 注释）和 Phase B（域重组 + import 更新）在 Wave 层面实现并行
- 测试文件使用最终域路径（@/lib/shared/db-retry），安排在文件迁移完成后的 Wave 执行
- 不创建 barrel (index.ts) 文件，维持直接路径引用风格
- 已存在子目录（platform-fetchers/、sse/、validations/、validators/、__tests__/）保持原位
- 属性测试覆盖 design.md 中定义的 8 个 Correctness Properties
- 最终验证需要 tsc --noEmit 通过 + pnpm test 全绿

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "3.1", "4.1"] },
    { "id": 2, "tasks": ["6.1", "6.2", "6.3"] },
    { "id": 3, "tasks": ["8.1", "8.2", "9.1", "9.2", "9.3", "10.1", "10.2"] },
    { "id": 4, "tasks": ["11.1", "11.2"] }
  ]
}
```
