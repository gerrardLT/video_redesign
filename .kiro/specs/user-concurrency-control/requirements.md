# Requirements Document

> **文档状态**：✅ 已实现（当前生效）
> **对应实现**：`src/lib/shared/{privilege-engine,priority-scheduler,concurrency-controller}.ts`、`src/lib/video/generation-orchestrator.ts`、`src/workers/concurrency-reconcile.ts`
> **权威来源**：状态以 `AGENTS.md` + `docs/local-life-user-journey.md` 为准，冲突时以代码为准
> **最后校准**：2026-07-11

## Introduction

基于用户等级的并发控制系统，作为 SaaS 产品差异化卖点。不同订阅等级（免费/月卡/年卡）的用户在解析、生成、合并三种任务类型上拥有不同的并发额度与队列优先级。付费用户享受更高并发度、优先级队列调度、以及并行生成模式（一键同时入队所有分镜组），而免费用户则走链式串行生成、标准优先级、且受限于较低并发额度。系统在任务入队前校验用户并发额度，超限时拒绝并提示升级。

## Glossary

- **Concurrency_Controller**: 并发控制服务，负责在任务入队前检查用户当前进行中的任务数是否超过其等级允许的并发额度
- **Priority_Scheduler**: 优先级调度器，根据用户等级在 BullMQ 入队时设置 priority 字段，决定任务被 Worker 消费的优先顺序
- **Privilege_Engine**: 特权引擎，根据用户订阅状态返回用户特权配置（含并发额度、队列优先级、生成模式）
- **Generation_Orchestrator**: 生成编排器，根据用户等级决定一键生成时采用链式串行模式还是并行入队模式
- **User_Tier**: 用户等级，由订阅状态决定：FREE（无有效订阅）、MONTHLY（月卡会员）、YEARLY（年卡/企业会员）
- **Active_Task**: 进行中任务，指 GenerationJob/Project/MergeJob 状态为 QUEUED 或 GENERATING/PARSING/MERGING 的任务记录
- **Concurrency_Limit**: 并发额度，每种任务类型对应不同等级允许的同时进行中任务最大数量
- **Chain_Mode**: 链式串行模式，分镜组按顺序逐一入队生成，前一组完成后才触发下一组
- **Parallel_Mode**: 并行入队模式，一键生成时所有分镜组同时入队，由 Worker 并发处理

## Requirements

### Requirement 1: 等级并发额度配置

**User Story:** As a 系统管理员, I want 为不同用户等级配置差异化的并发额度, so that 产品可以通过并发能力分层作为付费卖点。

#### Acceptance Criteria

1. THE Privilege_Engine SHALL return the following parse concurrency limits per User_Tier: FREE=1, MONTHLY=2, YEARLY=5
2. THE Privilege_Engine SHALL return the following generate concurrency limits per User_Tier: FREE=1 (chain serial), MONTHLY=3, YEARLY=unlimited (all groups parallel)
3. THE Privilege_Engine SHALL return the following merge concurrency limits per User_Tier: FREE=1, MONTHLY=1, YEARLY=2
4. THE Privilege_Engine SHALL return concurrency configuration as part of the UserPrivileges interface alongside existing privilege fields (queuePriority, allowedResolutions, watermarkEnabled, historyRetentionDays)
5. WHEN a user's subscription status changes between tiers, THE Privilege_Engine SHALL return the updated concurrency limits on the next privilege query without caching delay

### Requirement 2: 队列优先级调度

**User Story:** As a 付费用户, I want 我的任务在队列中被优先处理, so that 我的生成/解析/合并速度比免费用户更快。

#### Acceptance Criteria

1. WHEN a YEARLY tier user submits a task, THE Priority_Scheduler SHALL set BullMQ job priority to 1 (highest priority)
2. WHEN a MONTHLY tier user submits a task, THE Priority_Scheduler SHALL set BullMQ job priority to 3
3. WHEN a FREE tier user submits a task, THE Priority_Scheduler SHALL set BullMQ job priority to 5 (lowest priority)
4. THE Priority_Scheduler SHALL apply the priority field to all task queues: video-parse, video-generate, video-merge
5. WHEN multiple tasks are waiting in the same queue, THE BullMQ Worker SHALL consume tasks in ascending priority order (lower number processed first)

### Requirement 3: 并发限制入队前校验

**User Story:** As a 系统, I want 在任务入队前校验用户并发额度, so that 用户不会超出其等级允许的并发数导致系统过载。

#### Acceptance Criteria

1. WHEN a user requests to enqueue a parse task, THE Concurrency_Controller SHALL count the user's Active_Tasks of type parse (status in QUEUED, PARSING)
2. WHEN a user requests to enqueue a generate task, THE Concurrency_Controller SHALL count the user's Active_Tasks of type generate (status in QUEUED, GENERATING)
3. WHEN a user requests to enqueue a merge task, THE Concurrency_Controller SHALL count the user's Active_Tasks of type merge (status in QUEUED, MERGING)
4. IF the user's active task count for the requested type reaches the Concurrency_Limit for the user's User_Tier, THEN THE Concurrency_Controller SHALL reject the request with HTTP 429 and a response body containing error code CONCURRENCY_LIMIT_REACHED, the current limit value, and a prompt to upgrade
5. IF the user's active task count is below the Concurrency_Limit, THEN THE Concurrency_Controller SHALL allow the task to proceed to enqueue
6. THE Concurrency_Controller SHALL perform the check atomically using a Redis-based counter to prevent race conditions between concurrent enqueue requests from the same user

### Requirement 4: 生成模式差异化

**User Story:** As a 付费用户, I want 一键生成时所有分镜组同时入队并行生成, so that 我的视频生成速度大幅提升不需要等待前一组完成。

#### Acceptance Criteria

1. WHEN a FREE tier user triggers one-click generation, THE Generation_Orchestrator SHALL enqueue shot groups in Chain_Mode (only the first group enters the queue, subsequent groups are triggered sequentially upon prior group completion)
2. WHEN a MONTHLY tier user triggers one-click generation, THE Generation_Orchestrator SHALL enqueue up to 3 shot groups simultaneously in Parallel_Mode, with remaining groups entering the queue as active groups complete
3. WHEN a YEARLY tier user triggers one-click generation, THE Generation_Orchestrator SHALL enqueue all shot groups simultaneously in Parallel_Mode
4. WHEN Parallel_Mode is used, THE Generation_Orchestrator SHALL freeze credits for all groups in a single atomic operation before enqueuing (reusing the existing withCreditLock mechanism)
5. WHEN Parallel_Mode is used, THE Generation_Orchestrator SHALL set the chainMode field to false for all enqueued jobs to prevent chain continuation logic from triggering
6. WHEN Chain_Mode is used, THE Generation_Orchestrator SHALL preserve the existing chain generation behavior (chainMode=true, sequential triggering with last-frame continuity)

### Requirement 5: 并行入队积分冻结

**User Story:** As a 系统, I want 并行入队时一次性冻结所有组的积分, so that 积分账本一致性得到保证且不会出现部分组入队后余额不足的情况。

#### Acceptance Criteria

1. WHEN Parallel_Mode generation is triggered, THE Generation_Orchestrator SHALL calculate the total credits required for all shot groups before enqueuing
2. IF the user's credit balance is insufficient to cover the total cost of all groups, THEN THE Generation_Orchestrator SHALL reject the entire generation request with error code INSUFFICIENT_CREDITS and return the required vs available credit amounts
3. WHEN the total credit balance is sufficient, THE Generation_Orchestrator SHALL create RESERVE type CreditLedger entries for all groups within a single withCreditLock transaction
4. IF any group fails during Parallel_Mode generation, THEN THE generate-video Worker SHALL refund the credits for the failed group independently without affecting other groups' credit reservations

### Requirement 6: 并发计数一致性

**User Story:** As a 系统, I want 并发计数在任务完成或失败时正确递减, so that 用户的并发额度被正确释放不会出现额度泄漏。

#### Acceptance Criteria

1. WHEN a task transitions to a terminal state (SUCCEEDED, FAILED, CANCELED), THE Concurrency_Controller SHALL decrement the user's active task count for the corresponding task type
2. IF a Worker process crashes without updating task status, THEN THE existing watchdog Workers (parse-watchdog, generate-watchdog) SHALL detect stuck tasks and transition them to FAILED state, which triggers the concurrency count decrement
3. THE Concurrency_Controller SHALL derive active task counts from the database (GenerationJob, Project status) as the source of truth, using Redis counters only as a fast-path optimization with periodic reconciliation
4. WHEN reconciliation detects a mismatch between Redis counter and database count, THE Concurrency_Controller SHALL correct the Redis counter to match the database value

### Requirement 7: 升级提示与用户体验

**User Story:** As a 免费用户, I want 在达到并发限制时收到清晰的升级提示, so that 我了解付费可以获得更高并发能力。

#### Acceptance Criteria

1. WHEN a user receives a CONCURRENCY_LIMIT_REACHED rejection, THE API response SHALL include the user's current tier, current limit, and the next tier's limit for comparison
2. WHEN a FREE tier user is in Chain_Mode generation, THE frontend SHALL display an indication that paid tiers support parallel generation for faster results
3. THE API response for CONCURRENCY_LIMIT_REACHED SHALL include a structured upgrade prompt containing the benefit description of the next available tier

