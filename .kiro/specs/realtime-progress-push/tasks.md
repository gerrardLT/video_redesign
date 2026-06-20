# Implementation Plan: 实时进度推送 (Realtime Progress Push)

## Overview

基于 Next.js 15 + React 19 + Zustand + ioredis + BullMQ + Prisma + SQLite 技术栈，实现 SSE 实时进度推送系统。核心流程：定义 ProgressEvent 数据结构 → 实现 SSE Event Serializer → 实现 ConnectionRegistry → 实现 Redis Subscriber Manager → 创建 SSE Route Handler → 实现 ProgressPublisher（Worker 侧）→ 集成到各 Worker → 实现客户端 useSSEProgress Hook → 属性测试与单元测试。使用 TypeScript 全栈开发，fast-check v4.8.0 进行属性测试。

## Tasks

- [x] 1. 核心数据结构与序列化模块
  - [x] 1.1 定义 ProgressEvent 类型与 TaskType 枚举
    - 创建 `src/lib/sse/types.ts`
    - 定义 `TaskType` 类型：`'generation' | 'parse' | 'character' | 'merge' | 'chain'`
    - 定义 `ProgressEventPayload` 接口：必填字段 taskId、taskType、eventType、timestamp；可选字段 progress(0-100)、estimatedRemainingSeconds、stage、metadata
    - 定义 `ChainMetadata` 接口：totalGroups、currentGroup、completedGroups、currentJobStatus
    - 定义 `ConnectionEntry` 接口：connectionId、controller、createdAt、lastActiveAt、eventCounter
    - _Requirements: 6.1, 6.2_

  - [x] 1.2 实现 SSE Event Serializer
    - 创建 `src/lib/sse/event-serializer.ts`
    - 实现 `serialize(event, eventId)` 方法：输出 `event: {taskType}\nid: {eventId}\ndata: {JSON}\n\n` 格式
    - 实现 `serializeHeartbeat()` 方法：输出 `:ping\n\n`
    - 实现 `serializeRetry(ms)` 方法：输出 `retry: {ms}\n\n`
    - 实现 `serializeSnapshot(tasks, eventId)` 方法：输出 `event: snapshot\nid: {eventId}\ndata: {JSON array}\n\n`
    - 确保 data 字段为合法 JSON 字符串，包含所有必填字段
    - _Requirements: 6.4, 3.3_

  - [x]* 1.3 编写属性测试 - Property 4: Progress_Event 结构完整性
    - **Property 4: Progress_Event 结构完整性**
    - **Validates: Requirements 6.1, 6.2, 6.4**
    - 测试文件: `src/lib/sse/__tests__/event-serializer.property.test.ts`
    - 使用 fast-check 随机生成 ProgressEventPayload，验证序列化后 data 字段为合法 JSON，包含所有必填字段，progress 在 0-100 范围内

  - [x]* 1.4 编写属性测试 - Property 5: SSE 序列化 Round-Trip
    - **Property 5: SSE 序列化 Round-Trip**
    - **Validates: Requirements 6.4**
    - 测试文件: `src/lib/sse/__tests__/event-serializer.property.test.ts`
    - 对任意合法 ProgressEventPayload 序列化为 SSE 格式后，从 data 行提取 JSON 并解析，验证与原始 payload 等价

  - [x]* 1.5 编写属性测试 - Property 9: 终态事件映射正确性
    - **Property 9: 终态事件映射正确性**
    - **Validates: Requirements 6.3**
    - 测试文件: `src/lib/sse/__tests__/event-serializer.property.test.ts`
    - 验证 SUCCEEDED 状态映射为 eventType='completed'，FAILED 状态映射为 eventType='failed'

  - [x]* 1.6 编写属性测试 - Property 6: Channel 路由正确性
    - **Property 6: Channel 路由正确性**
    - **Validates: Requirements 1.3, 4.1, 4.3, 4.4, 4.5**
    - 测试文件: `src/lib/sse/__tests__/event-serializer.property.test.ts`
    - 对任意 userId/taskType/taskId 组合，验证生成的 channel 名为 `progress:{userId}:{taskType}:{taskId}`，且 `progress:{userId}:*` 模式能匹配

- [x] 2. ConnectionRegistry 实现
  - [x] 2.1 实现 ConnectionRegistry 模块
    - 创建 `src/lib/sse/connection-registry.ts`
    - 使用 `Map<string, Map<string, ConnectionEntry>>` 存储 userId → connectionId → entry
    - 实现 `register(userId, controller)` 方法：生成 UUID connectionId，注册连接，超过 5 个时淘汰最旧连接（关闭其 controller）
    - 实现 `unregister(userId, connectionId)` 方法：移除连接，关闭对应 controller
    - 实现 `broadcast(userId, sseMessage)` 方法：向该用户所有连接的 controller 写入消息
    - 实现 `getConnectionCount(userId)` 方法
    - 实现 `getTotalConnections()` 方法
    - 实现 `isAtCapacity()` 方法：全局连接数 >= 1000 时返回 true
    - 实现连接最长 30 分钟存活的定时检查逻辑，到期发送 reconnect 事件后关闭
    - _Requirements: 1.2, 1.5, 7.1, 7.2, 7.3, 7.4, 9.1, 9.2_

  - [x]* 2.2 编写属性测试 - Property 1: Connection Registry 注册/注销不变式
    - **Property 1: Connection Registry 注册/注销不变式**
    - **Validates: Requirements 1.2, 1.5, 7.1, 7.3, 7.4**
    - 测试文件: `src/lib/sse/__tests__/connection-registry.property.test.ts`
    - 对任意 register/unregister 操作序列，验证 getConnectionCount 始终 >= 0 且 <= 5

  - [x]* 2.3 编写属性测试 - Property 2: 广播完整性
    - **Property 2: 广播完整性**
    - **Validates: Requirements 7.2**
    - 测试文件: `src/lib/sse/__tests__/connection-registry.property.test.ts`
    - 对任意 userId 注册 N 个连接 (1 ≤ N ≤ 5) 后广播消息，验证所有 N 个 controller 都收到相同消息

  - [x]* 2.4 编写属性测试 - Property 3: Event ID 单调递增
    - **Property 3: Event ID 单调递增**
    - **Validates: Requirements 3.3**
    - 测试文件: `src/lib/sse/__tests__/connection-registry.property.test.ts`
    - 对单连接连续分配的 event id 序列，验证每个 id 严格大于前一个

  - [x]* 2.5 编写属性测试 - Property 8: 每用户连接数上限不变式
    - **Property 8: 每用户连接数上限不变式**
    - **Validates: Requirements 7.4**
    - 测试文件: `src/lib/sse/__tests__/connection-registry.property.test.ts`
    - 对同一 userId 连续注册 K > 5 个连接，验证 registry 中始终最多 5 个活跃连接，且被淘汰的是 createdAt 最小的

- [x] 3. Checkpoint - 核心模块验证
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Redis Subscriber Manager 实现
  - [x] 4.1 实现 Redis Subscriber Manager
    - 创建 `src/lib/sse/redis-subscriber.ts`
    - 创建独立的 ioredis 实例用于 PSUBSCRIBE（与现有 redis 实例分离）
    - 实现 `subscribe(userId, onMessage)` 方法：使用 `PSUBSCRIBE progress:{userId}:*`，如已存在订阅则复用，注册消息回调
    - 实现 `unsubscribe(userId)` 方法：当该用户无活跃连接时取消订阅 `PUNSUBSCRIBE`
    - 实现 `getActiveSubscriptionCount()` 方法
    - 处理 Redis 连接断开后自动重连并重新订阅
    - 消息接收后解析 JSON 为 ProgressEventPayload，解析失败记录错误日志并丢弃
    - _Requirements: 1.3, 1.5, 2.3_

  - [x]* 4.2 编写 Redis Subscriber Manager 单元测试
    - 测试文件: `src/lib/sse/__tests__/redis-subscriber.test.ts`
    - 测试同用户多次 subscribe 只创建一个 Redis 订阅
    - 测试 unsubscribe 后 getActiveSubscriptionCount 正确减少
    - 测试无效 JSON 消息被丢弃而非抛出异常
    - _Requirements: 1.3, 1.5_

- [x] 5. SSE Route Handler 实现
  - [x] 5.1 实现 SSE Route Handler
    - 创建 `src/app/api/sse/progress/route.ts`
    - 实现 GET handler：
      1. 从 Authorization header 提取并验证 token（复用现有 auth 逻辑），无效返回 401
      2. 检查全局连接上限 `isAtCapacity()`，超限返回 503
      3. 创建 ReadableStream + TransformStream
      4. 注册连接到 ConnectionRegistry
      5. 调用 RedisSubscriberManager.subscribe，消息回调中使用 EventSerializer 序列化后 broadcast 给用户所有连接
      6. 发送 `retry: 3000` 指令
      7. 读取 `Last-Event-ID` header，查询当前活跃任务状态发送全量快照
      8. 启动 30 秒心跳定时器
      9. 监听连接关闭（request.signal.addEventListener('abort')），清理资源：停止心跳、unregister、检查是否需要 unsubscribe
    - 设置响应 headers：`Content-Type: text/event-stream`、`Cache-Control: no-cache`、`Connection: keep-alive`
    - 实现 90 秒无活动超时检测，超时关闭连接并清理
    - 监听进程退出信号（SIGTERM/SIGINT），优雅关闭所有活跃连接（发送 reconnect 事件后关闭），确保部署重启时客户端能自动重连到新进程
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 9.1, 9.2, 9.4_

  - [x]* 5.2 编写 SSE Route Handler 单元测试
    - 测试文件: `src/app/api/sse/progress/__tests__/route.test.ts`
    - 测试无效 token 返回 HTTP 401
    - 测试正确返回 Content-Type: text/event-stream
    - 测试全局连接超限返回 HTTP 503
    - 测试 retry 字段值为 3000
    - 测试心跳格式为 `:ping\n\n`
    - _Requirements: 1.1, 1.4, 2.1, 2.4, 9.2_

- [x] 6. ProgressPublisher 模块（Worker 侧）
  - [x] 6.1 实现 ProgressPublisher
    - 创建 `src/lib/progress-publisher.ts`
    - 使用现有 `src/lib/redis.ts` 的 redis 实例进行 PUBLISH
    - 实现 `publish(userId, taskType, taskId, event)` 方法：
      1. 构造 channel 名称 `progress:{userId}:{taskType}:{taskId}`
      2. 将 event 序列化为 JSON
      3. 调用 `redis.publish(channel, json)`
      4. fire-and-forget 模式：PUBLISH 失败只记录 warn 日志，不抛出异常，不阻塞调用方
    - 实现辅助方法 `publishStateChange(userId, taskType, taskId, stage, progress?, eta?)`
    - 实现辅助方法 `publishCompleted(userId, taskType, taskId)`
    - 实现辅助方法 `publishFailed(userId, taskType, taskId, reason?)`
    - 实现辅助方法 `publishChainProgress(userId, projectId, chainMetadata)`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4_

  - [x]* 6.2 编写 ProgressPublisher 单元测试
    - 测试文件: `src/lib/__tests__/progress-publisher.test.ts`
    - 测试 publish 调用 redis.publish 时 channel 名称格式正确
    - 测试 publish 失败时不抛异常，仅记录 warn 日志
    - 测试 publishStateChange/publishCompleted/publishFailed 生成正确的 eventType
    - 测试 publishChainProgress 的 metadata 包含 totalGroups、currentGroup、completedGroups
    - _Requirements: 4.1, 5.1, 5.2_

- [x] 7. Checkpoint - 服务端模块验证
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Worker 集成（进度发布接入）
  - [x] 8.1 集成 ProgressPublisher 到 generate-video Worker
    - 修改 `src/workers/generate-video.ts`
    - 在任务状态变更点（QUEUED→SUBMITTED→GENERATING→SUCCEEDED/FAILED）调用 `publishStateChange`
    - 在 GENERATING 阶段收到 AI provider 进度回调时，调用 `publish` 发送包含 estimatedRemainingSeconds 的事件
    - 在任务成功/失败时调用 `publishCompleted` / `publishFailed`
    - 在链式生成场景中调用 `publishChainProgress` 更新链级进度
    - 确保 publish 调用不影响现有任务执行流程（fire-and-forget）
    - _Requirements: 4.1, 4.2, 5.1, 5.2, 5.3, 5.4_

  - [x] 8.2 集成 ProgressPublisher 到 parse-video Worker
    - 修改 `src/workers/parse-video.ts`
    - 在 started、splitting、describing、completed、failed 阶段调用 `publishStateChange`
    - 解析进度计算：splitting 阶段 progress 按帧数估算，describing 阶段按已完成镜头组/总组数计算
    - _Requirements: 4.3_

  - [x] 8.3 集成 ProgressPublisher 到 generate-character Worker
    - 修改 `src/workers/generate-character.ts`
    - 在 started、generating、succeeded、failed 阶段调用 `publishStateChange` / `publishCompleted` / `publishFailed`
    - _Requirements: 4.4_

  - [x] 8.4 集成 ProgressPublisher 到 merge-video Worker
    - 修改 `src/workers/merge-video.ts`
    - 在 started、merging、uploading、completed、failed 阶段调用 `publishStateChange` / `publishCompleted` / `publishFailed`
    - merging 阶段可根据 ffmpeg 输出解析进度百分比
    - _Requirements: 4.5_

  - [x]* 8.5 编写属性测试 - Property 7: 链式生成进度一致性
    - **Property 7: 链式生成进度一致性**
    - **Validates: Requirements 5.1, 5.2, 5.4**
    - 测试文件: `src/lib/sse/__tests__/chain-progress.property.test.ts`
    - 对任意 M 组链式生成，当第 N 组完成时，验证：N < M 则 currentGroup=N+1 且 completedGroups=N；N===M 则 eventType='completed' 且 completedGroups=M

- [x] 9. 客户端 useSSEProgress Hook 实现
  - [x] 9.1 实现 useSSEProgress Hook
    - 创建 `src/hooks/use-sse-progress.ts`
    - 使用浏览器原生 EventSource API 连接 `/api/sse/progress`
    - 在请求中通过 URL query 参数传递 auth token（EventSource 不支持自定义 header，需在 Route Handler 兼容 query 参数鉴权）
    - 监听 `generation`、`parse`、`character`、`merge`、`chain`、`snapshot` 事件
    - 接收到事件后更新 Zustand store 中的 progressMap
    - SSE 连接成功后将轮询间隔降低为 60 秒
    - SSE 断连超过 10 秒未恢复时恢复高频轮询（3-5 秒）
    - 实现 `reconnect()` 方法供手动触发重连
    - 组件卸载时关闭 EventSource 连接
    - _Requirements: 3.4, 8.1, 8.2, 8.3_

  - [x] 9.2 创建 SSE Progress Zustand Store
    - 创建 `src/stores/sse-progress-store.ts`
    - 状态字段：`isConnected`(boolean)、`progressMap`(Map<string, ProgressEventPayload>)、`lastEventId`(number)
    - Actions：`updateProgress(event)`、`setConnected(status)`、`clearTask(taskId)`、`resetAll()`
    - 终态事件（completed/failed）到达后，延迟 5 秒后从 progressMap 移除（让 UI 显示完成状态）
    - _Requirements: 8.2, 8.3_

  - [x]* 9.3 编写 useSSEProgress Hook 单元测试
    - 测试文件: `src/hooks/__tests__/use-sse-progress.test.ts`
    - 测试 SSE 连接建立后 isConnected 为 true
    - 测试接收事件后 progressMap 正确更新
    - 测试 SSE 断连 10 秒后轮询频率恢复为 3-5 秒
    - 测试 SSE 重连后轮询频率降至 60 秒
    - 测试组件卸载后 EventSource 正确关闭
    - _Requirements: 8.2, 8.3, 3.4_

- [x] 10. SSE Route Handler 兼容 Query 参数鉴权
  - [x] 10.1 扩展 SSE Route Handler 支持 query token
    - 修改 `src/app/api/sse/progress/route.ts`
    - 除 Authorization header 外，支持从 URL query 参数 `?token=xxx` 获取鉴权 token（EventSource 兼容方案）
    - 优先使用 header，header 不存在时降级到 query 参数
    - _Requirements: 1.1, 1.4_

- [x] 11. Checkpoint - 全链路验证
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. 监控端点与资源指标
  - [x] 12.1 实现 SSE 连接监控端点
    - 创建 `src/app/api/internal/sse-metrics/route.ts`
    - 返回 JSON：totalActiveConnections、connectionsPerUser（Map）、averageConnectionDuration
    - 仅内部访问（校验 internal-api-key 或限制为服务端调用）
    - _Requirements: 9.3_

  - [x]* 12.2 编写监控端点单元测试
    - 测试文件: `src/app/api/internal/sse-metrics/__tests__/route.test.ts`
    - 测试返回正确的 JSON 结构
    - 测试无鉴权请求被拒绝
    - _Requirements: 9.3_

- [x] 13. Final Checkpoint - 全功能验证
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties (使用 fast-check v4.8.0)
- Unit tests validate specific examples and edge cases
- ProgressPublisher 使用 fire-and-forget 模式，发布失败不影响任务执行
- Redis Subscriber Manager 需要独立 ioredis 实例（subscribe 模式限制）
- EventSource 不支持自定义 header，需通过 query 参数传递 token（任务 10.1）
- SSE 作为增强手段，现有轮询 API 保持不变，两者共享同一数据源
- 连接最长 30 分钟存活，到期发送 reconnect 事件后关闭，客户端自动重连

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["1.3", "1.4", "1.5", "1.6", "2.2", "2.3", "2.4", "2.5"] },
    { "id": 3, "tasks": ["4.1", "6.1"] },
    { "id": 4, "tasks": ["4.2", "5.1", "6.2"] },
    { "id": 5, "tasks": ["5.2", "8.1", "8.2", "8.3", "8.4"] },
    { "id": 6, "tasks": ["8.5", "9.1", "9.2", "10.1"] },
    { "id": 7, "tasks": ["9.3", "12.1"] },
    { "id": 8, "tasks": ["12.2"] }
  ]
}
```
