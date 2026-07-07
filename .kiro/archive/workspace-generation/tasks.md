# Implementation Plan: Workspace Generation

## Overview

实现工作台（Workspace）快速视频生成页面，包括前端组件（Prompt 输入、素材上传、模型选择、参数配置、积分预估、生成按钮、进度追踪、结果画廊、灵感模板）和后端 API（素材上传、生成触发、画廊列表），以及 Worker 层扩展（支持 workspace 模式的 generate-video）。

## Tasks

- [x] 1. 核心纯函数与类型定义
  - [x] 1.1 创建工作台类型定义和常量
    - 创建 `src/types/workspace.ts`，定义 `WorkspaceAsset`、`WorkspaceState`、`GenerateRequest`、`GenerateResponse`、`GalleryItem`、`GalleryResponse` 等接口
    - 创建 `src/constants/workspace.ts`，定义文件限制 `FILE_LIMITS`、模型时长映射 `MODEL_DURATION_OPTIONS`、灵感模板 `INSPIRATION_TEMPLATES`（≥6 个）
    - _Requirements: 2.1, 2.4, 3.3, 3.4, 4.4, 4.5, 10.3_

  - [x] 1.2 实现积分计算纯函数
    - 创建 `src/lib/credit-calc.ts`（若不存在则新建），导出 `estimateWorkspaceCost(model, duration)` 函数
    - Seedance 公式：`Math.ceil(duration * 1.5)`
    - HappyHorse 公式：`Math.ceil((duration + Math.min(duration, 15)) * 1.5)`
    - 导出 `getDurationOptions(model)` 函数，返回对应模型的时长选项数组
    - _Requirements: 5.1, 5.2, 5.3, 3.3, 3.4, 4.4, 4.5_

  - [x] 1.3 实现文件校验与素材引用纯函数
    - 创建 `src/lib/workspace-validators.ts`
    - 实现 `validatePromptLength(text)` — 校验 prompt 长度 ≤ 2500
    - 实现 `validateFile(fileName, mimeType, fileSize)` — 校验文件类型和大小
    - 实现 `insertAssetReference(text, cursorPos, assetName)` — 在光标位置插入 `@素材名称`
    - _Requirements: 1.1, 1.3, 2.1, 2.4, 2.5_

  - [x]* 1.4 编写属性测试：Prompt 长度校验
    - **Property 1: Prompt 长度校验**
    - **Validates: Requirements 1.1**

  - [x]* 1.5 编写属性测试：素材引用插入正确性
    - **Property 2: 素材引用插入正确性**
    - **Validates: Requirements 1.3**

  - [x]* 1.6 编写属性测试：文件校验（类型 + 大小）
    - **Property 3: 文件校验（类型 + 大小）**
    - **Validates: Requirements 2.1, 2.4, 2.5**

  - [x]* 1.7 编写属性测试：积分预估计算正确性
    - **Property 5: 积分预估计算正确性**
    - **Validates: Requirements 5.1, 5.2, 5.3**

  - [x]* 1.8 编写属性测试：模型-时长参数联动
    - **Property 8: 模型-时长参数联动**
    - **Validates: Requirements 3.3, 3.4, 4.3, 4.4, 4.5**

- [x] 2. Zustand 状态仓库
  - [x] 2.1 实现 useWorkspaceStore
    - 创建 `src/stores/workspace-store.ts`，实现完整的 `WorkspaceState` 接口
    - 包含 prompt、assets、model、aspectRatio、duration、resolution、generateStatus、currentJobId、creditBalance 等状态
    - 实现所有 actions：setPrompt、addAsset（含上限 12 个校验）、removeAsset、setModel、setAspectRatio、setDuration、setGenerateStatus、setCurrentJobId、setCreditBalance、insertAssetReference、reset
    - 默认值：model='seedance'、aspectRatio='16:9'、duration=5、resolution='720p'
    - _Requirements: 3.1, 4.1, 4.4, 4.5, 2.2, 2.8_

  - [x]* 2.2 编写属性测试：素材列表上限不变式
    - **Property 4: 素材列表上限不变式**
    - **Validates: Requirements 2.2, 2.7, 2.8**

- [x] 3. Checkpoint - 确保纯函数和 Store 测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. 后端 API 路由
  - [x] 4.1 实现 POST /api/workspace/upload 素材上传 API
    - 创建 `src/app/api/workspace/upload/route.ts`
    - 接收 multipart/form-data，校验文件类型和大小（复用 `validateFile`）
    - 上传到 OSS（复用 `storage.ts`），返回 `{ url, thumbUrl, type, fileSize }`
    - 图片和视频生成缩略图，音频无缩略图
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6_

  - [x] 4.2 实现 POST /api/workspace/generate 生成触发 API
    - 创建 `src/app/api/workspace/generate/route.ts`
    - Zod v4 参数校验（prompt、model、aspectRatio、duration、resolution、assetUrls、assetTypes）
    - 时长范围二次校验（Seedance 4-15s，HappyHorse 3-15s）
    - 余额预检 → 创建 Project → 创建 GenerationJob → 冻结积分 → 入队 BullMQ
    - 返回 `{ jobId, projectId, estimatedCost }`
    - 错误处理：402（余额不足）、429（并发限制）、400（参数错误）
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 5.4_

  - [x] 4.3 实现 GET /api/workspace/gallery 画廊列表 API
    - 创建 `src/app/api/workspace/gallery/route.ts`
    - 支持 tab=discover/my、page、pageSize 查询参数
    - 查询 GenerationJob（shotId=null, shotGroupId=null, status=SUCCEEDED）
    - 按 createdAt 倒序，分页返回
    - 返回 `{ items, total, hasMore }`
    - _Requirements: 8.1, 8.3, 8.4, 8.5, 8.7, 9.1, 9.2, 9.3_

  - [x]* 4.4 编写属性测试：画廊排序不变式
    - **Property 7: 画廊排序不变式**
    - **Validates: Requirements 8.6, 9.1**

- [x] 5. 后端服务层
  - [x] 5.1 实现 workspace-generation-service.ts 生成编排服务
    - 创建 `src/lib/workspace-generation-service.ts`
    - 实现 `executeWorkspaceGeneration(input)` 函数
    - 编排流程：计算积分 → 创建 Project → 创建 GenerationJob → 冻结积分 → 入队 BullMQ
    - 积分冻结使用 `withCreditLock` 保证并发安全
    - _Requirements: 6.1, 6.4, 5.4_

  - [x] 5.2 实现 happyhorse-workspace.ts HappyHorse 工作台客户端
    - 创建 `src/lib/happyhorse-workspace.ts`
    - 实现 `buildT2VRequestBody(params)` 纯函数 — 无参考图时使用 T2V 模型
    - 实现 `buildR2VRequestBody(params)` 纯函数 — 有参考图时使用 R2V 模型
    - 实现 `createHappyHorseWorkspaceTask(params)` — 自动判断 T2V/R2V 模式调用 DashScope API
    - _Requirements: 6.3, 3.4_

  - [x]* 5.3 编写属性测试：生成请求体构建完整性
    - **Property 6: 生成请求体构建完整性**
    - **Validates: Requirements 6.1, 6.2, 6.3**

- [x] 6. Worker 层扩展
  - [x] 6.1 扩展 generate-video Worker 支持 workspace 模式
    - 修改 `src/workers/generate-video.ts`，增加 `mode: 'workspace'` 分支
    - 工作台模式逻辑：读取 Job → 根据 engine 分发（seedance/happyhorse）→ 轮询状态 → 下载视频 → 转存 OSS → 更新 DB → 扣费/退款 → 发布 SSE 事件
    - Seedance 分支：构建全模态请求体（text + reference_image + reference_audio）
    - HappyHorse 分支：调用 `createHappyHorseWorkspaceTask`
    - 失败时退款、发布 failed 事件
    - _Requirements: 6.2, 6.3, 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 7. Checkpoint - 确保后端 API 和 Worker 逻辑完整
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. 前端组件实现
  - [x] 8.1 实现 WorkspacePage 页面壳和 WorkspaceClient 容器组件
    - 修改 `src/app/dashboard/workspace/page.tsx` 为 Server Component 壳
    - 创建 `src/components/workspace/WorkspaceClient.tsx`（'use client'），作为所有子组件的容器
    - 初始化 useWorkspaceStore，加载用户积分余额
    - _Requirements: 全局布局_

  - [x] 8.2 实现 PromptInput 组件
    - 创建 `src/components/workspace/PromptInput.tsx`
    - 多行文本输入，最大 2500 字符，实时显示字符计数
    - 输入 `@` 时弹出已上传素材列表弹窗，选中后插入 `@素材名称`
    - 空内容时显示占位提示文案
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 8.3 实现 AssetUploader 组件
    - 创建 `src/components/workspace/AssetUploader.tsx`
    - 支持拖拽上传和点击选择文件
    - 文件类型/大小校验（复用 `validateFile`），上限 12 个
    - 上传进度展示、缩略图预览、删除按钮
    - 错误提示包含文件名和限制条件
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [x] 8.4 实现 ModelSelector 组件
    - 创建 `src/components/workspace/ModelSelector.tsx`
    - 展示 Seedance 2.0 和 HappyHorse 两个模型卡片
    - 每个卡片含名称、描述、支持时长范围
    - 切换模型时联动更新 duration 和积分预估
    - Seedance 标注：支持文/图/视频/音频全模态输入
    - HappyHorse 标注：支持真人脸风格化转换
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [x] 8.5 实现 ParamBar 参数配置组件
    - 创建 `src/components/workspace/ParamBar.tsx`
    - 比例选择：16:9 / 9:16 / 1:1，默认 16:9
    - 分辨率固定显示 720P
    - 时长选项根据当前模型动态渲染（复用 `getDurationOptions`）
    - 数量固定显示 1 个
    - 参数变化时触发积分重算
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [x] 8.6 实现 CreditEstimate 积分预估组件
    - 创建 `src/components/workspace/CreditEstimate.tsx`
    - 实时展示预估积分消耗（调用 `estimateWorkspaceCost`）
    - 参数变化后 300ms 防抖更新
    - 余额不足时高亮提示
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 8.7 实现 GenerateButton 生成按钮组件
    - 创建 `src/components/workspace/GenerateButton.tsx`
    - prompt 为空时禁用
    - 余额不足时禁用并显示余额不足提示
    - 提交中展示加载状态并禁用
    - 点击后调用 POST /api/workspace/generate
    - 错误处理：402 弹充值引导、429 显示排队提示、其他错误显示详情+重试
    - _Requirements: 6.1, 6.5, 6.6, 6.7, 6.8, 6.9_

  - [x] 8.8 实现 ProgressOverlay 进度浮层组件
    - 创建 `src/components/workspace/ProgressOverlay.tsx`
    - 复用现有 `useSSEProgress` Hook 和 `sse-progress-store`
    - 展示当前阶段（排队中/生成中/已完成/失败）
    - 百分比进度条
    - 完成时触发结果画廊刷新
    - 失败时展示原因和重试按钮
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 8.9 实现 InspirationStrip 灵感模板组件
    - 创建 `src/components/workspace/InspirationStrip.tsx`
    - 横向滚动卡片列表（≥6 个预设模板）
    - 点击卡片将文本填入 PromptInput
    - 填入后触发积分重算
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [x] 8.10 实现 ResultGallery 结果画廊组件
    - 创建 `src/components/workspace/ResultGallery.tsx`
    - 网格布局展示视频缩略图
    - 「发现」和「我的作品」两个 Tab
    - 点击缩略图弹出视频播放预览
    - 分页加载（每页 12 个），滚动到底部自动加载下一页
    - 新作品生成完成自动插入列表顶部
    - 无历史作品时展示空状态引导
    - 每个作品展示缩略图、生成时间、使用模型、时长信息
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 9.1, 9.2, 9.3, 9.4_

- [x] 9. Checkpoint - 确保前端组件渲染正常
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. 集成联调
  - [x] 10.1 组装 WorkspaceClient，串联所有子组件和状态流
    - 在 WorkspaceClient 中组装所有子组件
    - 确保状态流通：Prompt 输入 → 模型选择 → 参数配置 → 积分预估 → 生成触发 → 进度追踪 → 结果画廊
    - 素材上传成功后自动更新 @ 引用列表
    - 生成完成后自动刷新画廊
    - _Requirements: 全部需求的端到端联调_

  - [x]* 10.2 编写单元测试覆盖核心交互场景
    - 测试：默认模型为 Seedance 2.0（Req 3.1）
    - 测试：默认比例为 16:9（Req 4.1）
    - 测试：空 prompt 禁用生成按钮（Req 6.9）
    - 测试：402 响应映射到充值引导（Req 6.6）
    - 测试：429 响应映射到排队提示（Req 6.7）
    - 测试：HappyHorse 有参考图时使用 R2V 模型（Req 6.3）
    - 测试：素材上传第 13 个被拒绝（Req 2.8）
    - 测试：灵感模板 ≥ 6 个（Req 10.3）
    - _Requirements: 覆盖关键验收标准_

- [x] 11. Final checkpoint - 确保所有测试通过
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties (Properties 1-8 from design)
- Unit tests validate specific examples and edge cases
- 前端组件基于 shadcn/ui + Tailwind CSS v4 实现，遵循项目既有设计规范
- 积分操作全部经 `withCreditLock` Redis 锁串行化，不允许直接操作余额
- Worker 扩展复用现有 generate-video 基础设施，新增 workspace 模式分支
- SSE 进度复用现有 `useSSEProgress` Hook + `sse-progress-store`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["1.4", "1.5", "1.6", "1.7", "1.8", "2.1"] },
    { "id": 2, "tasks": ["2.2", "4.1", "5.1", "5.2"] },
    { "id": 3, "tasks": ["4.2", "4.3", "5.3"] },
    { "id": 4, "tasks": ["4.4", "6.1"] },
    { "id": 5, "tasks": ["8.1", "8.2", "8.3", "8.4", "8.5", "8.6", "8.9"] },
    { "id": 6, "tasks": ["8.7", "8.8", "8.10"] },
    { "id": 7, "tasks": ["10.1"] },
    { "id": 8, "tasks": ["10.2"] }
  ]
}
```
