# Requirements Document

> **文档状态**：✅ 已实现（当前生效）
> **对应实现**：`src/lib/sse/**`、`src/lib/shared/progress-publisher.ts`
> **权威来源**：状态以 `AGENTS.md` + `docs/local-life-user-journey.md` 为准，冲突时以代码为准
> **最后校准**：2026-07-11

## Introduction

实时进度推送功能：使用 Server-Sent Events (SSE) 实现服务端向客户端的实时进度推送，替代前端轮询机制。当后台 BullMQ Worker 处理视频生成、解析、合并等耗时任务时，通过 Redis Pub/Sub 将进度事件跨进程传递给 Next.js API 层，再经由 SSE 连接推送到客户端浏览器，让用户即时看到任务阶段变更、预估剩余时间和链式生成进度。SSE 作为增强手段，保留现有轮询兼容性。

## Glossary

- **SSE_Endpoint**: Server-Sent Events 接口端点，由 Next.js App Router 的 Route Handler 实现，维持与客户端的长连接并推送事件流
- **Progress_Event**: 进度事件数据结构，包含任务 ID、事件类型、当前阶段、进度百分比、预估剩余时间等字段
- **Redis_PubSub**: Redis 发布/订阅通道，Worker 进程通过 PUBLISH 发布进度事件，API 进程通过 SUBSCRIBE 接收事件并转发给对应 SSE 连接
- **Progress_Channel**: Redis Pub/Sub 频道命名规则，格式为 `progress:{userId}:{taskType}:{taskId}`，用于精准路由事件到目标客户端
- **Worker_Process**: 运行 BullMQ Worker 的独立 Node.js 进程（npx tsx src/workers/index.ts），负责执行视频生成、解析、合并等计算密集型任务
- **API_Process**: 运行 Next.js App Router 的进程，负责处理 HTTP 请求和维持 SSE 连接
- **Generation_Job**: 视频生成任务，状态流为 QUEUED→SUBMITTED→GENERATING→SUCCEEDED/FAILED
- **Chain_Generation**: 链式生成，一个项目包含多组镜头依次串行生成的场景，需追踪整体进度（当前第 N/M 组）
- **Parse_Task**: 视频解析任务，将用户上传的视频拆分为镜头组并生成描述
- **Character_Generation**: 人物形象生成任务，由 Seedream 模型为角色生成参考图
- **Merge_Export**: 合并导出任务，将所有生成的镜头视频合并为最终成片并上传 OSS
- **Heartbeat**: 心跳机制，SSE 连接定期发送空注释行（`:ping`）以维持连接活性并检测断连
- **Connection_Registry**: 连接注册表，管理当前活跃的 SSE 连接映射关系（userId → 连接集合），支持多标签页隔离

## Requirements

### Requirement 1: SSE 连接建立与管理

**User Story:** 作为前端客户端，我希望通过 SSE 与服务端建立持久连接，以便实时接收任务进度更新。

#### Acceptance Criteria

1. WHEN a client sends a GET request to the SSE_Endpoint with a valid authentication token, THE SSE_Endpoint SHALL establish a persistent HTTP connection with Content-Type `text/event-stream` and respond with HTTP 200
2. WHEN a SSE connection is established, THE SSE_Endpoint SHALL register the connection in the Connection_Registry with the authenticated userId and a unique connectionId
3. WHEN a SSE connection is established, THE SSE_Endpoint SHALL subscribe to the user's Redis_PubSub Progress_Channel pattern `progress:{userId}:*`
4. IF a client sends a GET request without a valid authentication token, THEN THE SSE_Endpoint SHALL respond with HTTP 401 and refuse the connection
5. WHEN the client disconnects or the connection is closed, THE SSE_Endpoint SHALL unsubscribe from Redis_PubSub and remove the connection from the Connection_Registry

### Requirement 2: 心跳与连接保活

**User Story:** 作为系统运维，我希望 SSE 连接具有心跳检测机制，以便及时发现死连接并清理资源。

#### Acceptance Criteria

1. WHILE a SSE connection is active, THE SSE_Endpoint SHALL send a Heartbeat comment (`:ping`) every 30 seconds to maintain connection liveness
2. IF a SSE connection has not successfully sent data (including heartbeat) for 90 seconds, THEN THE SSE_Endpoint SHALL close the connection and clean up associated resources
3. WHEN a SSE connection is abnormally terminated, THE SSE_Endpoint SHALL unsubscribe from the corresponding Redis_PubSub channel within 5 seconds
4. THE SSE_Endpoint SHALL include a `retry` field with value 3000 (milliseconds) in the initial event stream to instruct the client to auto-reconnect after 3 seconds on disconnection

### Requirement 3: 客户端重连与事件恢复

**User Story:** 作为用户，我希望网络中断后客户端能自动重连并恢复丢失的进度信息，以便不错过任务状态变更。

#### Acceptance Criteria

1. WHEN a client reconnects with a `Last-Event-ID` header, THE SSE_Endpoint SHALL query the current state of all active tasks for the user and send a full state snapshot as the first event
2. WHEN a client reconnects without a `Last-Event-ID` header, THE SSE_Endpoint SHALL send the current state snapshot of all active tasks for the user
3. THE SSE_Endpoint SHALL assign a monotonically increasing numeric `id` field to each event to support `Last-Event-ID` based reconnection tracking
4. WHEN the client EventSource triggers an error event, THE client SHALL attempt reconnection using the browser's built-in EventSource retry mechanism (respecting the server-specified retry interval)

### Requirement 4: Worker 进程进度发布

**User Story:** 作为 Worker 进程，我希望能在任务处理的关键节点发布进度事件到 Redis，以便 API 进程转发给客户端。

#### Acceptance Criteria

1. WHEN a Generation_Job transitions to a new state (QUEUED, SUBMITTED, GENERATING, SUCCEEDED, FAILED), THE Worker_Process SHALL publish a Progress_Event to the Redis_PubSub channel `progress:{userId}:generation:{jobId}`
2. WHEN a Generation_Job is in GENERATING state and receives progress from the AI provider, THE Worker_Process SHALL publish a Progress_Event containing the estimated remaining time in seconds
3. WHEN a Parse_Task transitions state (started, splitting, describing, completed, failed), THE Worker_Process SHALL publish a Progress_Event to the channel `progress:{userId}:parse:{taskId}`
4. WHEN a Character_Generation task transitions state (started, generating, succeeded, failed), THE Worker_Process SHALL publish a Progress_Event to the channel `progress:{userId}:character:{taskId}`
5. WHEN a Merge_Export task transitions state (started, merging, uploading, completed, failed), THE Worker_Process SHALL publish a Progress_Event to the channel `progress:{userId}:merge:{taskId}`

### Requirement 5: 链式生成整体进度推送

**User Story:** 作为用户，我希望在链式生成场景下看到整体进度（当前第几组/共几组），以便了解全局生成状况。

#### Acceptance Criteria

1. WHEN a Chain_Generation is initiated for a project with M shot groups, THE Worker_Process SHALL publish a Progress_Event containing `totalGroups: M` and `currentGroup: 1` to channel `progress:{userId}:chain:{projectId}`
2. WHEN the N-th group in a Chain_Generation completes, THE Worker_Process SHALL publish a Progress_Event with `currentGroup: N+1` and `completedGroups: N` (if N < M) or a chain-completed event (if N === M)
3. WHEN any single group in a Chain_Generation fails, THE Worker_Process SHALL publish a Progress_Event with event type `chain_group_failed` including the failed group index and failure reason
4. THE Progress_Event for Chain_Generation SHALL include both the chain-level progress (N/M groups) and the current group's individual Generation_Job status

### Requirement 6: 进度事件数据结构

**User Story:** 作为前端开发者，我希望进度事件具有一致的数据结构，以便统一解析和渲染不同类型任务的进度。

#### Acceptance Criteria

1. THE Progress_Event SHALL contain the following required fields: `taskId` (string), `taskType` (enum: generation, parse, character, merge, chain), `eventType` (string), `timestamp` (ISO 8601 string)
2. THE Progress_Event SHALL contain optional fields: `progress` (number, 0-100), `estimatedRemainingSeconds` (number), `stage` (string), `metadata` (object)
3. WHEN a task reaches a terminal state (SUCCEEDED or FAILED), THE Progress_Event SHALL include an `eventType` of `completed` or `failed` respectively, and THE SSE_Endpoint SHALL stop publishing events for that task
4. THE SSE_Endpoint SHALL serialize Progress_Event as JSON in the `data` field of the SSE message, with `event` field set to the `taskType`

### Requirement 7: 多标签页与多设备隔离

**User Story:** 作为用户，我希望在多个浏览器标签页或设备上都能独立接收进度推送，以便在不同窗口查看任务状态。

#### Acceptance Criteria

1. THE Connection_Registry SHALL support multiple simultaneous SSE connections for the same userId, each identified by a unique connectionId
2. WHEN a Progress_Event is received from Redis_PubSub for a userId, THE SSE_Endpoint SHALL broadcast the event to all active connections belonging to that userId
3. WHEN one SSE connection for a userId is closed, THE SSE_Endpoint SHALL NOT affect other active connections for the same userId
4. THE Connection_Registry SHALL enforce a maximum of 5 simultaneous SSE connections per userId; IF a 6th connection is attempted, THEN THE SSE_Endpoint SHALL close the oldest connection before accepting the new one

### Requirement 8: 轮询兼容性保留

**User Story:** 作为前端开发者，我希望 SSE 推送与现有轮询机制并存，以便在 SSE 不可用时优雅降级到轮询。

#### Acceptance Criteria

1. THE existing polling API endpoints SHALL remain functional and return the same response format regardless of whether SSE is active
2. WHEN a client successfully establishes a SSE connection, THE client SHALL reduce polling frequency from the current interval (3-5 seconds) to a low-frequency fallback interval (60 seconds) as a safety net
3. IF the SSE connection fails to establish or is disconnected for more than 10 seconds, THEN THE client SHALL resume the original high-frequency polling interval (3-5 seconds)
4. THE SSE_Endpoint and the polling endpoints SHALL share the same underlying data source to ensure consistency between pushed events and polled states

### Requirement 9: 连接资源清理与限流

**User Story:** 作为系统运维，我希望 SSE 连接有资源限制和清理机制，以便防止资源耗尽影响系统稳定性。

#### Acceptance Criteria

1. THE SSE_Endpoint SHALL enforce a maximum connection duration of 30 minutes; WHEN the limit is reached, THE SSE_Endpoint SHALL gracefully close the connection with a `reconnect` event instructing the client to re-establish
2. WHEN the total number of active SSE connections across all users exceeds a configurable threshold (default 1000), THE SSE_Endpoint SHALL reject new connections with HTTP 503 until active connections drop below the threshold
3. THE SSE_Endpoint SHALL track connection metrics (total active connections, connections per user, average connection duration) and expose them via an internal monitoring endpoint
4. WHEN the API_Process restarts or deploys, THE SSE_Endpoint SHALL gracefully close all existing connections, allowing clients to auto-reconnect to the new process instance
