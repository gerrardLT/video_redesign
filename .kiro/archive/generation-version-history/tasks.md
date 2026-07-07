# Implementation Plan: Generation Version History

## Overview

为分镜组（ShotGroup）实现版本历史管理功能。按数据层 → 服务层 → API 层 → Worker 集成 → 前端状态 → 前端组件的顺序递增实现，每层构建在前一层之上，确保无孤立代码。技术栈：Next.js 15 + Prisma + SQLite + Zustand + shadcn/ui + fast-check v4.8.0。

## Tasks

- [x] 1. Prisma Schema 与数据层
  - [x] 1.1 新增 GenerationVersion 模型并更新关系
    - 在 `prisma/schema.prisma` 中新增 `GenerationVersion` 模型，包含 id、shotGroupId、generationJobId、versionNumber、videoUrl、coverUrl、lastFrameUrl、promptSnapshot、costEstimate、isCurrent、createdAt 字段
    - 添加 `@@unique([shotGroupId, versionNumber])`、`@@index([shotGroupId])`、`@@index([generationJobId])` 约束
    - 在 `ShotGroup` 模型中新增 `versions GenerationVersion[]` 反向关系
    - 在 `GenerationJob` 模型中新增 `version GenerationVersion?` 反向关系（1:1）
    - 运行 `npx prisma migrate dev` 生成迁移文件
    - _Requirements: 1.1, 1.3, 2.1_

- [x] 2. VersionHistoryService 核心服务实现
  - [x] 2.1 实现 getPromptExcerpt 工具函数
    - 在 `src/lib/version-history-service.ts` 中实现 `getPromptExcerpt(prompt: string | null): string`
    - 超过 30 字符截断并追加 "..."，空/null 返回 "(无提示词)"
    - _Requirements: 3.2_

  - [ ]* 2.2 编写 Property 7 属性测试：Prompt 摘要截断
    - **Property 7: Prompt 摘要截断**
    - 使用 fast-check 生成任意字符串，验证 getPromptExcerpt 的截断逻辑正确性
    - **Validates: Requirements 3.2**

  - [x] 2.3 实现 createVersion 方法
    - 在 `src/lib/version-history-service.ts` 中实现 `createVersion(input: CreateVersionInput): Promise<GenerationVersion>`
    - 在 Prisma 事务内完成：查询当前版本数、超限淘汰、计算 nextVersionNumber、创建记录（isCurrent=true）、旧当前版本设为 false、更新 ShotGroup 字段
    - 淘汰时调用 OSS 删除旧版本文件（best-effort，失败仅记录日志）
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 8.2_

  - [ ]* 2.4 编写 Property 1 属性测试：单一当前版本不变式
    - **Property 1: 单一当前版本不变式**
    - 生成随机 createVersion/switchVersion 操作序列，验证任意时刻恰好一个 isCurrent=true
    - **Validates: Requirements 1.2, 2.2, 5.1**

  - [ ]* 2.5 编写 Property 3 属性测试：版本号单调递增
    - **Property 3: 版本号单调递增**
    - 随机创建+删除序列后，验证版本号始终使用 MAX(versionNumber)+1，无回收
    - **Validates: Requirements 1.3**

  - [ ]* 2.6 编写 Property 4 属性测试：版本数量上限与淘汰
    - **Property 4: 版本数量上限与淘汰**
    - 随机数量的版本创建，验证不超过 VERSION_LIMIT，且淘汰的是最旧非当前版本
    - **Validates: Requirements 2.1, 2.3, 8.2**

  - [ ]* 2.7 编写 Property 5 属性测试：失败任务不产生版本
    - **Property 5: 失败任务不产生版本**
    - 随机 FAILED job 数据输入，验证版本列表不变
    - **Validates: Requirements 2.4**

  - [x] 2.8 实现 switchVersion 方法
    - 在 `src/lib/version-history-service.ts` 中实现 `switchVersion(shotGroupId: string, versionId: string): Promise<GenerationVersion>`
    - Prisma 事务内：旧当前版本 isCurrent=false、目标版本 isCurrent=true、更新 ShotGroup 三个字段
    - 不消耗积分，不创建 CreditLedger 记录
    - 处理版本不存在（404）、版本不属于该组（400）、并发冲突（409 + 重试一次）
    - _Requirements: 5.1, 5.2, 5.4_

  - [ ]* 2.9 编写 Property 2 属性测试：ShotGroup 字段与当前版本同步
    - **Property 2: ShotGroup 字段与当前版本同步**
    - 任意 createVersion/switchVersion 操作后验证 ShotGroup 三字段与当前版本一致
    - **Validates: Requirements 1.4, 5.2**

  - [ ]* 2.10 编写 Property 10 属性测试：版本切换不消耗积分
    - **Property 10: 版本切换不消耗积分**
    - 随机切换操作后验证无 CreditLedger 记录产生
    - **Validates: Requirements 5.4**

  - [x] 2.11 实现 deleteVersion 方法
    - 在 `src/lib/version-history-service.ts` 中实现 `deleteVersion(shotGroupId: string, versionId: string): Promise<void>`
    - 当前版本禁止删除（抛出 400 错误）
    - 非当前版本：删除数据库记录 + 删除 OSS 文件（best-effort）
    - _Requirements: 6.2, 6.3, 6.4_

  - [ ]* 2.12 编写 Property 8 属性测试：当前版本不可删除
    - **Property 8: 当前版本不可删除**
    - 随机选中当前版本尝试删除，验证操作失败且版本不变
    - **Validates: Requirements 6.2**

  - [ ]* 2.13 编写 Property 9 属性测试：非当前版本可删除
    - **Property 9: 非当前版本可删除**
    - 随机选中非当前版本删除，验证成功且其余版本不受影响
    - **Validates: Requirements 6.3**

  - [x] 2.14 实现 listVersions 和 getVersionStats 方法
    - 在 `src/lib/version-history-service.ts` 中实现 `listVersions(shotGroupId: string): Promise<GenerationVersion[]>`（按 versionNumber 降序）
    - 实现 `getVersionStats(shotGroupId: string): Promise<{ count: number; limit: number }>`
    - _Requirements: 3.1, 3.4, 8.1, 8.4_

  - [ ]* 2.15 编写 Property 6 属性测试：版本列表降序排列
    - **Property 6: 版本列表降序排列**
    - 随机版本集合，验证 listVersions 返回结果按 versionNumber 降序
    - **Validates: Requirements 3.1**

- [x] 3. Checkpoint - 服务层验证
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. API 路由层
  - [x] 4.1 实现版本列表 API
    - 创建 `src/app/api/shot-groups/[id]/versions/route.ts`
    - GET handler：调用 `listVersions` + `getVersionStats`，返回 `{ versions, stats }` JSON
    - 使用 `getPromptExcerpt` 处理 promptExcerpt 字段
    - 权限校验：确认 ShotGroup 属于当前用户
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 4.2 实现版本切换 API
    - 创建 `src/app/api/shot-groups/[id]/versions/[versionId]/switch/route.ts`
    - POST handler：调用 `switchVersion`，返回 `{ version, shotGroup }` JSON
    - 处理 400/404/409 错误响应
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 4.3 实现版本删除 API
    - 创建 `src/app/api/shot-groups/[id]/versions/[versionId]/route.ts`
    - DELETE handler：调用 `deleteVersion`，成功返回 204
    - 当前版本删除返回 400 `{ error: "当前版本不可删除" }`
    - _Requirements: 6.2, 6.3, 6.4, 6.5_

  - [ ]* 4.4 编写 API 路由单元测试
    - 测试 GET 版本列表的正常返回和空列表场景
    - 测试 POST 切换版本的成功和错误场景（404、400、409）
    - 测试 DELETE 版本的成功和拒绝删除当前版本场景
    - 测试权限校验：非所有者访问返回 403
    - _Requirements: 3.1, 5.1, 6.2, 6.3_

- [x] 5. Worker 集成
  - [x] 5.1 在 generate-video Worker 中集成版本创建
    - 修改 `src/lib/workers/generate-video.ts`（或对应 worker 文件）
    - 在 `atomicSuccessUpdate` 成功后调用 `versionHistoryService.createVersion`
    - 传入 shotGroupId、videoUrl、coverUrl、lastFrameUrl、promptSnapshot、costEstimate、generationJobId
    - `createVersion` 失败时仅记录 error 日志，不回滚生成结果（best-effort）
    - 仅在 GenerationJob status 为 SUCCEEDED 时调用，FAILED 时不创建版本
    - _Requirements: 1.1, 2.1, 2.4_

  - [ ]* 5.2 编写 Worker 集成单元测试
    - 测试生成成功时正确调用 createVersion
    - 测试生成失败时不调用 createVersion
    - 测试 createVersion 异常时 Worker 不中断
    - _Requirements: 1.1, 2.4_

- [x] 6. Checkpoint - 后端完整验证
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. 前端状态管理
  - [x] 7.1 实现 version-history-store
    - 创建 `src/stores/version-history-store.ts`，使用 Zustand 管理版本历史状态
    - 实现 state：versions、stats、isLoading、error、compareMode、compareVersionIds
    - 实现 actions：fetchVersions、switchVersion、deleteVersion、enterCompareMode、exitCompareMode
    - switchVersion 成功后同步更新 shot-store 中对应 ShotGroup 的 genVideoUrl/genCoverUrl/lastFrameUrl
    - _Requirements: 3.1, 5.3, 6.5_

  - [ ]* 7.2 编写 Store 单元测试
    - 测试 fetchVersions 正确设置 versions 和 stats
    - 测试 switchVersion 后 store 状态正确更新
    - 测试 deleteVersion 后从列表中移除并更新 count
    - 测试 enterCompareMode/exitCompareMode 状态切换
    - _Requirements: 3.1, 5.3, 6.5_

- [x] 8. 前端 UI 组件
  - [x] 8.1 实现 VersionItemCard 版本卡片组件
    - 创建 `src/components/editor/version-item-card.tsx`
    - 展示缩略图（coverUrl）、版本号、prompt 摘要（前30字符）、生成时间、积分消耗
    - 当前版本显示高亮徽标（badge）
    - 提供"设为当前版本"、"删除"操作按钮
    - 支持选中状态（用于 A/B 对比选择）
    - 使用 shadcn/ui Card、Badge、Button 组件
    - _Requirements: 3.2, 3.3, 5.1, 6.1_

  - [x] 8.2 实现 VersionHistoryPanel 版本面板组件
    - 创建 `src/components/editor/version-history-panel.tsx`
    - 作为侧边面板展示版本列表（降序排列）
    - 头部显示版本计数 "n/10" 格式
    - 集成 VersionItemCard 列表渲染
    - 支持选择两个版本进入 A/B 对比模式
    - 删除操作显示确认对话框（shadcn/ui AlertDialog）
    - 调用 version-history-store 的 actions
    - _Requirements: 3.1, 3.3, 3.4, 4.1, 6.1, 6.5_

  - [x] 8.3 实现 VersionCompareView A/B 对比组件
    - 创建 `src/components/editor/version-compare-view.tsx`
    - 双视频并排等宽面板布局
    - 同步播放控制（play/pause/seek 操作同时影响两个视频）
    - 每个面板上方显示版本号和 prompt 摘要
    - 提供"使用此版本"按钮，点击后调用 switchVersion
    - 使用 useRef 控制 HTMLVideoElement 同步
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ]* 8.4 编写前端组件单元测试
    - 测试 VersionItemCard 渲染正确数据和高亮状态
    - 测试 VersionHistoryPanel 版本列表降序排列展示
    - 测试删除确认对话框流程
    - 测试当前版本删除按钮禁用状态
    - 测试 VersionCompareView 双视频同步播放
    - _Requirements: 3.1, 3.2, 3.3, 4.2, 6.1, 6.2_

- [x] 9. 集成联调与最终验证
  - [x] 9.1 将版本面板集成到编辑器页面
    - 在编辑器页面（ShotGroup Card 或相关面板）中添加"版本历史"入口按钮
    - 点击打开 VersionHistoryPanel
    - 确保切换版本后 ShotGroup Card 展示的视频 URL 实时更新
    - 确认合并导出流程读取 ShotGroup.genVideoUrl 无需修改（向后兼容）
    - _Requirements: 5.3, 7.1, 7.2, 7.3_

- [x] 10. Final Checkpoint - 全功能验证
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- 每个任务引用具体需求条款以保证需求可追溯性
- Property 测试使用 fast-check v4.8.0，每个 property 最少运行 100 次迭代
- OSS 文件删除采用 best-effort 策略：数据库操作优先，文件删除失败仅记录日志不回滚
- 版本号不回收（删除后新版本仍使用 MAX+1），避免用户混淆
- switchVersion 在 Prisma 事务内完成，保证 isCurrent 一致性
- 合并导出完全向后兼容：仅读取 ShotGroup.genVideoUrl，不感知版本系统

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.3"] },
    { "id": 2, "tasks": ["2.2", "2.5", "2.6", "2.7", "2.8", "2.11", "2.14"] },
    { "id": 3, "tasks": ["2.4", "2.9", "2.10", "2.12", "2.13", "2.15"] },
    { "id": 4, "tasks": ["4.1", "4.2", "4.3", "5.1"] },
    { "id": 5, "tasks": ["4.4", "5.2", "7.1"] },
    { "id": 6, "tasks": ["7.2", "8.1"] },
    { "id": 7, "tasks": ["8.2", "8.3"] },
    { "id": 8, "tasks": ["8.4", "9.1"] }
  ]
}
```
