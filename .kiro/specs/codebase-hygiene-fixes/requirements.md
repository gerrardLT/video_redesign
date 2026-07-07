# Requirements Document

## Introduction

本需求描述代码仓库的技术卫生修复工作，覆盖三个维度：将过时的 SQLite 语义测试文件重写为 PostgreSQL 语义、清理 Prisma Schema 中不再准确的注释、以及将 src/lib 平铺的约 95 个模块按业务域重新组织为子目录结构。改造后代码库的测试、注释与物理结构将准确反映当前技术栈（PostgreSQL 16 + Prisma 7.8）。

## Glossary

- **Test_Suite**: 项目中基于 Vitest 4 + fast-check 的自动化测试集合
- **Unit_Test_File**: `tests/unit/db-retry.test.ts`，db-retry 模块的单元测试文件
- **Property_Test_File_A**: `src/__tests__/properties/db-retry.property.test.ts`，db-retry 模块的属性测试文件
- **Property_Test_File_B**: `tests/properties/idempotent-cleanup.property.test.ts`，幂等清理逻辑的属性测试文件
- **DB_Retry_Module**: `src/lib/db-retry.ts`，导出 isRetriableError、withRetry、RETRY_CONFIG、_internals 的 PostgreSQL 事务冲突重试模块
- **Retriable_Error**: PostgreSQL 可重试事务冲突错误，包含 P2034、"deadlock detected"、"could not serialize access" 三种错误特征
- **Retry_Delays**: DB_Retry_Module 配置的重试延迟序列 [200, 500, 1000]（毫秒）
- **Schema_File**: `prisma/schema.prisma`，Prisma ORM 的数据模型定义文件
- **Shot_Model**: Schema_File 中定义的 Shot 数据模型
- **Lib_Directory**: `src/lib/` 目录，项目核心业务逻辑的服务层
- **Video_Domain**: 视频重绘产品线相关模块集合（FFmpeg、Seedance、分镜、转场、生成编排等）
- **Merchant_Domain**: 本地生活商家平台相关模块集合（门店画像、内容日历、拍摄任务、合规、复盘等）
- **Shared_Domain**: 跨产品线共享的基础设施模块集合（数据库、Redis、认证、队列、日志、积分等）
- **Import_Path**: TypeScript 源码中使用 @/ 路径别名引用模块的 import 语句

## Requirements

### Requirement 1: 单元测试文件重写为 PostgreSQL 语义

**User Story:** As a 开发者, I want db-retry 单元测试准确覆盖 PostgreSQL 事务冲突重试行为, so that 测试能真实验证当前实现逻辑而非已弃用的 SQLite 逻辑

#### Acceptance Criteria

1.1 THE Unit_Test_File SHALL 仅导入 DB_Retry_Module 实际导出的符号（isRetriableError、withRetry、RETRY_CONFIG、_internals），不导入任何不存在的符号

1.2 WHEN Unit_Test_File 执行 isRetriableError 测试用例时, THE Test_Suite SHALL 验证包含 "P2034" 的 Error 返回 true

1.3 WHEN Unit_Test_File 执行 isRetriableError 测试用例时, THE Test_Suite SHALL 验证包含 "deadlock detected" 的 Error 返回 true

1.4 WHEN Unit_Test_File 执行 isRetriableError 测试用例时, THE Test_Suite SHALL 验证包含 "could not serialize access" 的 Error 返回 true

1.5 WHEN Unit_Test_File 执行 isRetriableError 测试用例时, THE Test_Suite SHALL 验证不包含任何 Retriable_Error 特征的 Error 返回 false

1.6 WHEN Unit_Test_File 执行 isRetriableError 测试用例时, THE Test_Suite SHALL 验证非 Error 类型的值（string、null、undefined、number）返回 false

1.7 THE Unit_Test_File SHALL 验证 RETRY_CONFIG.maxRetries 等于 3

1.8 THE Unit_Test_File SHALL 验证 RETRY_CONFIG.delays 等于 [200, 500, 1000]

1.9 WHEN withRetry 包裹的操作首次成功时, THE Test_Suite SHALL 验证结果直接返回且不调用 sleep

1.10 WHEN withRetry 包裹的操作抛出非 Retriable_Error 时, THE Test_Suite SHALL 验证错误立即向外抛出且调用次数为 1

1.11 WHEN withRetry 包裹的操作连续抛出 Retriable_Error 后恢复时, THE Test_Suite SHALL 验证 sleep 按 Retry_Delays 顺序调用且最终返回成功结果

1.12 WHEN withRetry 包裹的操作连续 4 次（1 初始 + 3 重试）抛出 Retriable_Error 时, THE Test_Suite SHALL 验证最终抛出最后一次捕获的错误，且 sleep 调用序列为 [200, 500, 1000]

1.13 THE Unit_Test_File SHALL 不包含任何对 "SQLITE_BUSY"、"database is locked"、"isSQLiteLockError" 的引用

### Requirement 2: 属性测试文件 A 重写为 PostgreSQL 语义

**User Story:** As a 开发者, I want db-retry 属性测试覆盖 PostgreSQL 重试语义的所有边界情况, so that 任意输入组合下重试行为均满足规格

#### Acceptance Criteria

2.1 THE Property_Test_File_A SHALL 使用 fast-check 生成包含 "P2034"、"deadlock detected"、"could not serialize access" 的随机 Retriable_Error 消息

2.2 THE Property_Test_File_A SHALL 使用 fast-check 生成不包含任何 Retriable_Error 特征的随机非可重试错误消息

2.3 WHEN 操作在第 N 次（N ∈ [1, 3]）重试后成功时, THE Property_Test_File_A SHALL 验证 sleep 调用序列为 Retry_Delays 的前 N 个元素

2.4 WHEN 操作抛出非可重试错误时, THE Property_Test_File_A SHALL 验证 withRetry 立即抛出该错误，调用次数为 1，sleep 调用次数为 0

2.5 WHEN 操作连续 4 次抛出 Retriable_Error 时, THE Property_Test_File_A SHALL 验证最终抛出原始错误，总调用次数为 4，sleep 调用序列为 [200, 500, 1000]

2.6 WHEN 操作在第 M 次（M ∈ [0, 3]）成功时, THE Property_Test_File_A SHALL 验证返回值与操作产生的值严格相等

2.7 WHEN 操作前 M 次抛出 Retriable_Error 后第 M+1 次抛出非可重试错误时, THE Property_Test_File_A SHALL 验证非可重试错误立即抛出，总 sleep 次数等于 M

2.8 THE Property_Test_File_A SHALL 不包含任何对 "SQLITE_BUSY"、"database is locked"、"SQLite" 的引用

2.9 THE Property_Test_File_A 的文件头注释 SHALL 准确描述 PostgreSQL 事务冲突重试语义（P2034/deadlock/serialization failure）

### Requirement 3: 属性测试文件 B 重写为 PostgreSQL 语义

**User Story:** As a 开发者, I want 幂等清理属性测试反映 PostgreSQL 错误语义, so that 模拟的失败场景与真实运行时一致

#### Acceptance Criteria

3.1 THE Property_Test_File_B 的文件头注释 SHALL 准确描述基于 PostgreSQL 的幂等清理属性

3.2 WHEN 模拟 deleteMany 操作失败时, THE Property_Test_File_B SHALL 使用 Retriable_Error 消息（P2034 或 "deadlock detected"）而非 "SQLITE_BUSY"

3.3 THE Property_Test_File_B SHALL 保留原有的幂等性验证逻辑（清理顺序、失败隔离、跨项目不影响、二次清理等价性）

3.4 THE Property_Test_File_B SHALL 不包含任何对 "SQLITE_BUSY"、"database is locked"、"SQLite" 的引用

### Requirement 4: Prisma Schema 过时注释清理

**User Story:** As a 开发者, I want Schema 注释准确描述当前技术状态, so that 阅读 Schema 时不会产生错误的技术认知

#### Acceptance Criteria

4.1 THE Schema_File 中 Shot_Model 的 dialogue 字段注释 SHALL 描述该字段为 JSON 字符串格式（存储对话/台词信息），不引用 SQLite 或任何已弃用的数据库类型限制

4.2 THE Schema_File SHALL 不包含任何引用 SQLite 限制或特性的注释

### Requirement 5: src/lib 模块按域分组重组

**User Story:** As a 开发者, I want lib 目录按业务域组织为子目录, so that 模块边界清晰、依赖方向明确、可维护性提升

#### Acceptance Criteria

5.1 THE Lib_Directory SHALL 包含 video/ 子目录，存放 Video_Domain 相关模块（包括但不限于 seedance.ts、video-analyzer.ts、ffmpeg.ts、frame-continuity.ts、transition-engine.ts、grouping-service.ts、script-merger.ts、generation-orchestrator.ts、group-gen-context.ts、wavespeed.ts、segment-concat.ts、segment-service.ts、workspace-generation-service.ts、workspace-request-builder.ts、workspace-validators.ts、version-history-service.ts、frame-calculator.ts、boundary-snapper.ts、reference-builder.ts、render-pipeline.ts、preview-transform.ts、prompt-parser.ts、shot-schema.ts、appearance-comparator.ts）

5.2 THE Lib_Directory SHALL 包含 merchant/ 子目录，存放 Merchant_Domain 相关模块（包括但不限于 merchant-auth.ts、store-profile-service.ts、playbook-engine.ts、content-calendar-service.ts、capture-director.ts、local-render-service.ts、ai-auto-render-service.ts、compliance-service.ts、content-entropy-service.ts、copy-generator.ts、publish-copy-service.ts、publish-queue-service.ts、metrics-ingestor.ts、platform-metrics-crawler.ts、performance-learning-service.ts、merchant-billing-service.ts、merchant-context-builder.ts、merchant-templates.ts、content-brief-api-error.ts、content-brief-state-machine.ts、content-score-service.ts、cross-store-service.ts、engagement-service.ts、impact-scope-service.ts、matrix-dispatch-service.ts、poi-injection-service.ts、sensitive-words.ts、platform-presets.ts、trending-video-analyzer.ts、task-center-service.ts、period-service.ts）

5.3 THE Lib_Directory SHALL 包含 shared/ 子目录，存放 Shared_Domain 相关模块（包括但不限于 db.ts、db-retry.ts、redis.ts、queue.ts、auth.ts、auth-helpers.ts、logger.ts、storage.ts、distributed-lock.ts、concurrency-controller.ts、credit-service.ts、credit-calc.ts、credit-dispatcher.ts、priority-scheduler.ts、privilege-engine.ts、progress-publisher.ts、rate-limiter.ts、subscription-service.ts、notification-service.ts、order-service.ts、onboarding-service.ts、api-client.ts、api-error.ts、utils.ts、expiry-status.ts、state-machine.ts、stepper-navigation.ts、placeholder-utils.ts、validate-share-link.ts、asset-ingestion-service.ts、asset-library-service.ts、asset-lifecycle-service.ts、face-detection-service.ts、flux.ts、help-center-service.ts、sample-project-service.ts、showcase-service.ts、style-service.ts、video-import-service.ts、happyhorse.ts、happyhorse-workspace.ts、script-hash.ts）

5.4 WHEN 模块从 Lib_Directory 根目录移入子目录后, THE 项目中所有引用该模块的 Import_Path SHALL 更新为新路径（如 @/lib/db-retry → @/lib/shared/db-retry）

5.5 WHEN 所有模块重组完成后, THE Lib_Directory 根目录 SHALL 不包含任何 .ts 文件（仅保留子目录和可能的 index.ts 重导出文件）

5.6 WHEN 所有 Import_Path 更新完成后, THE 项目 SHALL 通过 TypeScript 编译（tsc --noEmit）无错误

5.7 WHEN 所有 Import_Path 更新完成后, THE Test_Suite SHALL 全部通过（pnpm test 退出码为 0）

5.8 THE Lib_Directory 中已存在的子目录（platform-fetchers/、sse/、validations/、validators/、__tests__/）SHALL 保持原位不变

### Requirement 6: 跨需求一致性

**User Story:** As a 开发者, I want 所有改动保持前后端数据一致性, so that 重构不引入运行时回归

#### Acceptance Criteria

6.1 WHEN 测试文件重写完成后, THE Unit_Test_File 和 Property_Test_File_A 中的 RETRY_CONFIG 断言 SHALL 与 DB_Retry_Module 的实际导出值一致（maxRetries: 3, delays: [200, 500, 1000]）

6.2 WHEN 模块重组完成后, THE 项目中不存在对 @/lib/ 根目录下已移走模块的悬空引用（编译通过即验证）

6.3 THE 所有改动 SHALL 保持 TypeScript 严格模式兼容（无 any 类型引入、无类型错误）
