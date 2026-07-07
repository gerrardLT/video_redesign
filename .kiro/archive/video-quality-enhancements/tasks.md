# Implementation Plan: Video Quality Enhancements

## Overview

本实现计划覆盖三个独立模块：超分前端适配、视频转场优化、人物状态管理。每个模块可独立开发，按模块组织任务，从数据层和核心逻辑开始，逐步到 API 层和前端 UI，最后进行集成串联。

## Tasks

- [x] 1. 超分前端适配：积分估算与导出页面
  - [x] 1.1 实现超分积分估算函数
    - 在 `src/lib/credit-service.ts` 中新增 `estimateUpscaleCreditCost(duration: number, resolution: '480p' | '720p' | '1080p'): number` 函数
    - 480p 返回 0，720p 返回 `Math.ceil(duration * 1)`，1080p 返回 `Math.ceil(duration * 2)`
    - 导出该函数供 API 和前端使用
    - _Requirements: 1.2_

  - [x]* 1.2 编写超分积分估算属性测试
    - **Property 1: 超分积分计算公式**
    - **Validates: Requirements 1.2**
    - 文件：`src/lib/__tests__/credit-service-upscale.property.test.ts`
    - 使用 fast-check 生成随机正浮点数 duration，验证三档计算结果

  - [x] 1.3 实现 Export Status API 路由
    - 创建 `src/app/api/projects/[id]/export-status/route.ts`，GET 方法
    - 返回当前导出任务状态（MERGING / UPSCALING / COMPLETED / FAILED）、输出分辨率、视频 URL、错误信息、退还积分数
    - 认证校验 + 项目归属校验
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 1.4 扩展 Export API 支持 target_resolution 参数
    - 修改 `src/app/api/projects/[id]/export/route.ts`，POST 请求体新增 `target_resolution` 字段（Zod 校验）
    - 当 resolution 为 720p/1080p 时，调用 `estimateUpscaleCreditCost` 计算积分并执行余额预检
    - 余额不足返回 403 + 明确错误信息（所需积分数、当前余额）
    - 余额充足时冻结积分，入队 merge-video 任务并携带 target_resolution
    - _Requirements: 1.5, 1.6_

  - [x] 1.5 实现 ResolutionSelector 前端组件
    - 创建 `src/components/export/ResolutionSelector.tsx`（'use client'）
    - 展示 480p/720p/1080p 三档卡片，480p 标注"免费"，720p/1080p 标注积分消耗
    - 默认选中 480p，选中高档位时查询用户余额并展示预估消耗和剩余
    - 余额不足时禁用导出按钮 + 展示"积分不足"提示
    - 使用 shadcn/ui RadioGroup + Card 组件
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 1.6 实现 ExportStatusDisplay 前端组件
    - 创建 `src/components/export/ExportStatusDisplay.tsx`（'use client'）
    - 覆盖四种状态 UI：MERGING（合并中 + 进度动画）、UPSCALING（超分处理中 + 动画）、COMPLETED（视频预览 + 下载按钮 + 分辨率标注）、FAILED（失败原因 + 退还积分 + 重试按钮）
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 1.7 集成导出页面并实现轮询逻辑
    - 修改 `src/app/dashboard/project/[id]/export/page.tsx`
    - 集成 ResolutionSelector 和 ExportStatusDisplay 组件
    - 实现 3 秒间隔轮询 export-status API，连续 3 次失败后展示连接异常提示
    - 导出按钮点击后调用 Export API 并携带 target_resolution
    - _Requirements: 1.6, 2.4_

  - [x]* 1.8 编写积分不足阻断导出属性测试
    - **Property 2: 积分不足阻断导出**
    - **Validates: Requirements 1.5**
    - 文件：`src/lib/__tests__/credit-service-upscale.property.test.ts`
    - 使用 fast-check 生成随机 balance 和 cost 组合，验证 balance < cost 时返回阻断结果

- [x] 2. Checkpoint - 超分前端适配模块验证
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. 视频转场优化：Transition Engine 与 Merge Worker 集成
  - [x] 3.1 实现 Transition Engine 核心模块
    - 创建 `src/lib/transition-engine.ts`
    - 实现 `normScene` 规范化函数（或从 frame-continuity.ts 引入）
    - 实现 `computeTransitionPlan(segments: SegmentInfo[]): TransitionPlan`：
      - 同场景：crossfade 0.4s
      - 跨场景：fade 0.7s
      - 短段（duration < 2 × transitionDuration）：none
      - 单段：空转场数组
    - 实现转场重叠分配：offsetA = offsetB = duration / 2
    - 导出类型定义：TransitionType, TransitionConfig, SegmentInfo, TransitionPlan
    - _Requirements: 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 6.1, 6.2, 6.3_

  - [x]* 3.2 编写同场景 crossfade 时长约束属性测试
    - **Property 3: 同场景 crossfade 时长约束**
    - **Validates: Requirements 3.1**
    - 文件：`src/lib/__tests__/transition-engine.property.test.ts`

  - [x]* 3.3 编写转场重叠分配属性测试
    - **Property 4: 转场重叠分配**
    - **Validates: Requirements 3.3**
    - 文件：`src/lib/__tests__/transition-engine.property.test.ts`

  - [x]* 3.4 编写跨场景 fade 时长约束属性测试
    - **Property 5: 跨场景 fade 时长约束**
    - **Validates: Requirements 4.1**
    - 文件：`src/lib/__tests__/transition-engine.property.test.ts`

  - [x]* 3.5 编写跨场景时长大于同场景时长属性测试
    - **Property 6: 跨场景时长大于同场景时长**
    - **Validates: Requirements 4.3**
    - 文件：`src/lib/__tests__/transition-engine.property.test.ts`

  - [x]* 3.6 编写短段跳过转场属性测试
    - **Property 8: 短段跳过转场**
    - **Validates: Requirements 6.1**
    - 文件：`src/lib/__tests__/transition-engine.property.test.ts`

  - [x]* 3.7 编写合并总时长不变量属性测试
    - **Property 9: 合并总时长不变量**
    - **Validates: Requirements 6.2**
    - 文件：`src/lib/__tests__/transition-engine.property.test.ts`

  - [x] 3.8 实现 FFmpeg 转场 filter 构建函数
    - 在 `src/lib/transition-engine.ts` 中实现 `buildTransitionFilters(segments, plan): { videoFilter, audioFilter }`
    - 生成 xfade filter 链（链式串联多段 xfade，正确计算每一步的 offset）
    - 生成 acrossfade filter 链（音频过渡时长与视觉一致）
    - 确保非过渡区间内音频不被修改
    - _Requirements: 3.2, 5.1, 5.2, 5.3_

  - [x]* 3.9 编写音视频转场同步属性测试
    - **Property 7: 音视频转场同步**
    - **Validates: Requirements 5.1, 5.2**
    - 文件：`src/lib/__tests__/transition-engine.property.test.ts`

  - [x] 3.10 集成 Transition Engine 到 Merge Worker
    - 修改 `src/workers/merge-video.ts` 中的 `ffmpegConcat` 函数
    - 在合并前收集各段 SegmentInfo（通过 ffprobe 获取时长 + 读取 scene 字段）
    - 调用 `computeTransitionPlan` + `buildTransitionFilters` 获取 filter
    - 将 filter 拼接到 FFmpeg -filter_complex 参数中
    - FFmpeg xfade 执行失败时回退到无转场的 concat 合并（现有逻辑）
    - ffprobe 获取时长失败时该段 duration 设为 0，跳过相关转场
    - _Requirements: 3.1, 4.1, 5.1, 6.1_

  - [x]* 3.11 编写 buildTransitionFilters 单元测试
    - 文件：`src/lib/__tests__/transition-engine.test.ts`
    - 测试 2 段/3 段/5 段场景下的 xfade/acrossfade filter 字符串正确性
    - 测试全部为 none 转场时返回空 filter
    - _Requirements: 3.2, 5.2_

- [x] 4. Checkpoint - 转场引擎模块验证
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. 人物状态管理：数据模型与核心逻辑
  - [x] 5.1 新增 CharacterState Prisma 模型
    - 修改 `prisma/schema.prisma`：
      - 新增 CharacterState 模型（id, characterId, name, description, imageUrl, isDefault, createdAt, updatedAt）
      - 修改 ShotGroupCharacter 新增 characterStateId 可空字段 + 关系
      - 修改 Character 新增 states 反向关系
    - 执行 `npx prisma migrate dev` 生成迁移
    - _Requirements: 7.1, 7.2, 8.1_

  - [x] 5.2 实现 CharacterState CRUD API
    - 创建 `src/app/api/characters/[characterId]/states/route.ts`（GET + POST）
    - 创建 `src/app/api/characters/[characterId]/states/[stateId]/route.ts`（PATCH + DELETE）
    - POST：创建状态，若为该角色首个状态则自动设 isDefault = true
    - PATCH：更新名称/描述/图片/isDefault，设新 default 时取消旧 default
    - DELETE：拒绝删除唯一 default 状态（返回 409）；正常删除时 Prisma onDelete: SetNull 自动置空引用
    - Zod 校验请求体
    - _Requirements: 7.3, 7.4, 10.4, 10.5_

  - [x]* 5.3 编写角色默认状态唯一性属性测试
    - **Property 10: 角色默认状态唯一性**
    - **Validates: Requirements 7.3, 7.4**
    - 文件：`src/lib/__tests__/character-state.property.test.ts`
    - 模拟随机 create/setDefault 操作序列，验证任何时刻最多一个 isDefault

  - [x] 5.4 实现 ShotGroupCharacter 状态关联 API
    - 创建 `src/app/api/shot-groups/[shotGroupId]/characters/[characterId]/route.ts`（PATCH）
    - 请求体接受 `{ characterStateId: string | null }`
    - 更新 ShotGroupCharacter 记录的 characterStateId
    - Zod 校验 + 归属校验
    - _Requirements: 8.1_

  - [x] 5.5 改造 buildGroupGenReference 锚定图装配逻辑
    - 修改 `src/lib/group-gen-context.ts`
    - 当 ShotGroupCharacter.characterStateId 非空时，查询对应 CharacterState
    - 若 CharacterState.imageUrl 非空，使用该 URL 作为锚定图
    - 否则回退到 Character.imageUrl
    - 查询失败时回退到 Character.imageUrl，不中断生成流程
    - _Requirements: 8.2, 8.3, 8.4_

  - [x]* 5.6 编写锚定图来源解析属性测试
    - **Property 11: 锚定图来源解析**
    - **Validates: Requirements 8.2, 8.3, 8.4**
    - 文件：`src/lib/__tests__/group-gen-context.property.test.ts`
    - 生成随机 CharacterState + ShotGroupCharacter 组合，验证解析优先级

  - [x] 5.7 改造 applySameSceneContinuation 尾帧承接逻辑
    - 修改 `src/lib/frame-continuity.ts`
    - 在 applySameSceneContinuation 函数中新增参数：prevCharacterStates、currentCharacterStates
    - 在同场景判定后、应用承接前，检测任何共享角色的 characterStateId 是否不同
    - 状态不同（包括一方为空一方非空）→ 跳过承接（返回 applied: false）
    - 所有共享角色状态相同 → 按现有逻辑正常承接
    - _Requirements: 9.1, 9.2, 9.3_

  - [x]* 5.8 编写状态切换跳过尾帧承接属性测试
    - **Property 12: 状态切换跳过尾帧承接**
    - **Validates: Requirements 9.1, 9.2**
    - 文件：`src/lib/__tests__/frame-continuity-state.property.test.ts`
    - 生成随机相邻组角色状态配置，验证承接判定结果

  - [x]* 5.9 编写状态删除级联置空属性测试
    - **Property 13: 状态删除级联置空**
    - **Validates: Requirements 10.4**
    - 文件：`src/lib/__tests__/character-state.property.test.ts`

  - [x]* 5.10 编写默认状态删除保护属性测试
    - **Property 14: 默认状态删除保护**
    - **Validates: Requirements 10.5**
    - 文件：`src/lib/__tests__/character-state.property.test.ts`

- [x] 6. Checkpoint - 人物状态核心逻辑验证
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. 人物状态管理：前端状态管理面板
  - [x] 7.1 实现角色状态管理 Zustand Store
    - 创建 `src/stores/character-state-store.ts`
    - 管理角色状态列表（CRUD）、当前选中状态、加载状态
    - 提供 actions：fetchStates, createState, updateState, deleteState, setSelectedState
    - _Requirements: 10.1_

  - [x] 7.2 实现角色状态列表面板组件
    - 创建 `src/components/editor/CharacterStatePanel.tsx`（'use client'）
    - 展示角色所有 CharacterState 列表
    - 支持新增状态（名称 + 描述输入）、编辑名称/描述、上传锚定图、删除操作
    - 默认状态标注"默认"标签，唯一默认状态禁止删除
    - 使用 shadcn/ui Card + Dialog + Input 组件
    - _Requirements: 10.1, 10.5_

  - [x] 7.3 实现分镜组角色状态选择器组件
    - 创建 `src/components/editor/ShotGroupCharacterStateSelector.tsx`（'use client'）
    - 在分镜组角色关联区域为每个角色展示状态下拉选择器
    - 未选择时显示"默认状态"标签
    - 选择变更时调用 PATCH API 更新 characterStateId
    - 使用 shadcn/ui Select 组件
    - _Requirements: 10.2, 10.3_

  - [x] 7.4 集成角色状态面板到编辑器
    - 修改编辑器角色详情面板，嵌入 CharacterStatePanel 组件
    - 修改分镜组编辑面板，嵌入 ShotGroupCharacterStateSelector 组件
    - 删除状态后刷新受影响组的状态选择器
    - _Requirements: 10.1, 10.2, 10.4_

  - [x]* 7.5 编写角色状态管理面板单元测试
    - 文件：`src/components/editor/__tests__/CharacterStatePanel.test.tsx`
    - 测试状态列表渲染、新增操作、删除保护提示
    - _Requirements: 10.1, 10.5_

- [x] 8. 最终集成与验证
  - [x] 8.1 串联 Generate Worker 中的状态感知
    - 修改 `src/workers/generate-video.ts`
    - 在调用 buildGroupGenReference 前读取 ShotGroupCharacter 的 characterStateId
    - 在调用 applySameSceneContinuation 时传入前后组的角色状态映射
    - _Requirements: 8.2, 9.1_

  - [x] 8.2 串联 Merge Worker 中超分触发逻辑
    - 修改 `src/workers/merge-video.ts`
    - 合并完成后检测 target_resolution，若为 720p/1080p 则入队 upscale-video 任务
    - 超分完成后更新导出状态为 COMPLETED，失败时退还冻结积分并更新状态为 FAILED
    - _Requirements: 2.1, 2.3_

  - [x]* 8.3 编写 Merge Worker 集成测试
    - 文件：`src/workers/__tests__/merge-video.test.ts`
    - 测试含转场的 2-3 段视频合并流程（mock FFmpeg 命令执行）
    - 测试超分触发逻辑（mock BullMQ 入队）
    - _Requirements: 3.1, 4.1, 5.1_

- [x] 9. Final Checkpoint - 全模块集成验证
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- 每个任务引用具体的 Requirements 条款以确保可追溯性
- 三个模块可独立开发：模块 1（超分前端）、模块 3+7（转场引擎）、模块 5+7（人物状态）互不阻塞
- 属性测试验证设计文档中定义的 14 个 Correctness Properties
- Prisma schema 变更（任务 5.1）需在人物状态模块其他任务之前完成
- 所有 Worker 改造遵循项目规范：不使用 fallback、失败抛错由 BullMQ 重试

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.1", "5.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "3.2", "3.3", "3.4", "3.5", "3.6", "3.7", "5.2"] },
    { "id": 2, "tasks": ["1.4", "3.8", "5.3", "5.4", "5.5"] },
    { "id": 3, "tasks": ["1.5", "1.8", "3.9", "3.11", "5.6", "5.7"] },
    { "id": 4, "tasks": ["1.6", "3.10", "5.8", "5.9", "5.10", "7.1"] },
    { "id": 5, "tasks": ["1.7", "7.2", "7.3"] },
    { "id": 6, "tasks": ["7.4", "7.5", "8.1", "8.2"] },
    { "id": 7, "tasks": ["8.3"] }
  ]
}
```
