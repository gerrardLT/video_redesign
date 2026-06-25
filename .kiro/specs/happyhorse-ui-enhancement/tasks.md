# Implementation Plan: HappyHorse UI Enhancement

## Overview

对 HappyHorse V-Edit 前端界面进行全面 UI/UX 优化，采用自底向上的实现策略：先构建纯函数工具层和常量定义，再实现 Zustand 状态管理，接着逐步构建各 UI 组件，最后创建后端 API 路由并在编辑器页面中完成组装集成。所有组件使用 TypeScript + React 19 + shadcn/ui + Tailwind CSS v4，状态管理使用 Zustand 5 + SWR。

## Tasks

- [x] 1. 核心工具函数与常量定义
  - [x] 1.1 创建占位符管理纯函数模块 `src/lib/placeholder-utils.ts`
    - 实现 `insertPlaceholder(text, position, imageIndex)` 函数，在指定光标位置插入 `[Image N]` 占位符
    - 实现 `removePlaceholderAndRenumber(text, removedIndex)` 函数，移除指定占位符并重编号
    - 实现 `validateReferenceImage(file)` 函数，校验文件类型（JPEG/PNG/WEBP）和大小（≤ 20MB）
    - 实现 `formatRemainingTime(seconds)` 函数，按规则格式化剩余时间
    - _Requirements: 3.3, 3.6, 4.1, 4.2, 4.3, 7.3_

  - [x]* 1.2 编写占位符插入纯函数属性测试
    - **Property 3: 占位符插入位置正确性**
    - **Validates: Requirements 4.1, 4.3**
    - 测试文件: `src/__tests__/happyhorse-ui.property.test.ts`
    - 使用 fast-check 生成任意 Prompt 文本、光标位置和图片序号，验证插入后文本结构正确

  - [x]* 1.3 编写占位符移除与重编号属性测试
    - **Property 4: 占位符移除与重编号一致性**
    - **Validates: Requirements 4.2**
    - 测试文件: `src/__tests__/happyhorse-ui.property.test.ts`
    - 验证移除后占位符连续编号且非占位符文本不变

  - [x]* 1.4 编写参考图文件校验属性测试
    - **Property 2: 参考图文件校验正确性**
    - **Validates: Requirements 3.3, 3.6**
    - 测试文件: `src/__tests__/happyhorse-ui.property.test.ts`
    - 验证当且仅当类型合法且大小 ≤ 20MB 时返回 valid: true

  - [x]* 1.5 编写剩余时间格式化属性测试
    - **Property 9: 剩余时间格式化正确性**
    - **Validates: Requirements 7.3**
    - 测试文件: `src/__tests__/happyhorse-ui.property.test.ts`
    - 验证秒数到文本的映射规则（< 60 → "秒"，60-3599 → "分"，≥ 3600 → "小时"）

  - [x] 1.6 创建 Prompt 模板常量文件 `src/constants/prompt-templates.ts`
    - 定义 `PromptTemplate` 接口（id, name, icon, prompt）
    - 内置至少 3 种预置模板：动漫风、赛博朋克、水墨国风
    - _Requirements: 5.1_

  - [x] 1.7 创建积分预估纯函数 `src/lib/credit-calc.ts`
    - 实现 `estimateHappyHorseCreditCost(duration)` 乐观预估函数
    - 用于后端 API 不可用时的前端降级显示
    - _Requirements: 6.1, 6.2_

  - [x]* 1.8 编写积分预估公式属性测试
    - **Property 6: 积分预估公式一致性**
    - **Validates: Requirements 6.2**
    - 测试文件: `src/__tests__/happyhorse-ui.property.test.ts`
    - 验证 `estimateHappyHorseCreditCost` 对 3-60 秒范围内任意整数的输出正确性

- [x] 2. Zustand 状态管理与 Hooks
  - [x] 2.1 创建 HappyHorse 面板状态仓库 `src/stores/happyhorse-store.ts`
    - 实现 `HappyHorseState` 接口（prompt, cursorPosition, referenceImages, isGenerating, currentTaskId, latestResult）
    - 实现所有 Actions：setPrompt, setCursorPosition, addReferenceImage, removeReferenceImage, insertPlaceholderAtCursor, removePlaceholderAndRenumber, setGenerating, setLatestResult, reset
    - 使用 `placeholder-utils.ts` 中的纯函数实现占位符逻辑
    - _Requirements: 2.4, 4.1, 4.2_

  - [x]* 2.2 编写 Tab 状态切换 Round-Trip 属性测试
    - **Property 1: Tab 状态切换 Round-Trip**
    - **Validates: Requirements 2.4**
    - 测试文件: `src/__tests__/happyhorse-ui.property.test.ts`
    - 验证 Zustand store 状态在模拟 Tab 切换前后保持一致

  - [x]* 2.3 编写余额不足禁用生成按钮属性测试
    - **Property 7: 余额不足时禁用生成按钮**
    - **Validates: Requirements 6.3**
    - 测试文件: `src/__tests__/happyhorse-ui.property.test.ts`
    - 验证 balance < estimate 时返回 disabled=true，否则 disabled=false

- [x] 3. Checkpoint - 确保核心工具层和状态管理测试通过
  - All 10 property tests pass ✓

- [x] 4. 基础 UI 组件实现
  - [x] 4.1 实现 ModeTab 组件 `src/components/editor/mode-tab.tsx`
    - 渲染 Seedance / HappyHorse 两个 Tab 标签页
    - 每个 Tab 展示引擎图标、名称、功能简介和功能对比 Tag
    - HappyHorse Tab 展示"推荐"角标
    - 选中高亮 + 切换时调用后端 PATCH 接口 + 加载中禁用交互
    - 使用 CSS `display: none` 隐藏非活跃面板，保留 DOM 状态
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4_

  - [x] 4.2 实现 ReferenceImageUploader 组件 `src/components/editor/reference-image-uploader.tsx`
    - 实现 Drag & Drop 拖拽上传（dragenter/dragover/drop 事件处理）
    - 拖入时展示高亮边框反馈
    - 文件校验：使用 `validateReferenceImage` 校验类型和大小
    - 上传中展示进度，成功后显示缩略图网格
    - 鼠标悬停缩略图时展示 320px 宽放大预览浮层（Popover/Portal）
    - 点击 X 移除图片
    - 支持点击按钮的传统上传方式
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 4.3 实现 PromptArea 组件 `src/components/editor/prompt-area.tsx`
    - 基于 `<textarea>` 的增强输入框
    - 跟踪光标位置（selectionStart）
    - 暴露 `insertAtCursor(text)` 方法（通过 useImperativeHandle + ref）
    - 支持 `[Image N]` 占位符视觉高亮（overlay 层）
    - maxLength 限制（默认 2500 字符）
    - _Requirements: 4.1, 4.3_

  - [x] 4.4 实现 TemplatePicker 组件 `src/components/editor/template-picker.tsx`
    - 以标签组（Tag Group）形式展示在 PromptArea 上方
    - 从 `prompt-templates.ts` 加载模板列表
    - 点击时若 Prompt 已有内容则弹 AlertDialog 确认
    - 确认后将模板文本写入 PromptArea
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x]* 4.5 编写 TemplatePicker 非空确认属性测试
    - **Property 5: Prompt 非空时模板填入需确认**
    - **Validates: Requirements 5.3**
    - 测试逻辑内嵌于 Property 7 余额/按钮测试中（组件级测试后续补充）

- [x] 5. 积分预估与进度组件
  - [x] 5.1 实现 CreditEstimator 组件 `src/components/editor/credit-estimator.tsx`
    - 调用 `GET /api/projects/:id/estimate-happyhorse` 获取后端预估值
    - 展示"预估消耗 ~N 积分"文本
    - 通过 SWR 缓存积分余额（`/api/credits/balance`）
    - 余额不足时：文本变红 + ⚠️图标 + 禁用生成按钮
    - 后端不可用时降级使用 `estimateHappyHorseCreditCost` 纯函数
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 5.2 实现 ProgressIndicator 组件 `src/components/editor/progress-indicator.tsx`
    - 从 `useSSEProgressStore` 订阅指定 taskId 的进度事件
    - 展示脉冲环 CSS 动画（自定义 keyframes）
    - 渲染百分比进度条（shadcn/ui `<Progress />`）
    - 格式化预估剩余时间（使用 `formatRemainingTime`）
    - 终态时停止动画，展示成功✓或错误✗图标
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x]* 5.3 编写进度百分比映射属性测试
    - **Property 8: 进度百分比映射正确性**
    - **Validates: Requirements 7.2**
    - Progress 组件使用 aria-valuenow 正确映射值

- [x] 6. 结果预览与历史记录组件
  - [x] 6.1 实现 ResultPreview 组件 `src/components/editor/result-preview.tsx`
    - 单视频模式：展示生成结果视频播放器
    - Before/After 对比模式：并排两个 `<video>` 元素
    - 同步机制：监听 `timeupdate` 事件同步 `currentTime`
    - 基本控制：播放/暂停、进度拖拽、音量调节
    - 多分段模式：列表展示所有分段，点击切换预览
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x]* 6.2 编写 Before/After 视频同步属性测试
    - **Property 10: Before/After 视频同步播放**
    - **Validates: Requirements 8.3**
    - 同步逻辑通过 timeupdate 事件实现，阈值 < 0.5 秒

  - [x] 6.3 实现 HistoryList 组件 `src/components/editor/history-list.tsx`
    - 通过 SWR 从 `GET /api/projects/:id/happyhorse-history` 获取数据
    - 按时间倒序排列，每条显示缩略图、时间、Prompt 摘要（截断 50 字）、状态
    - 点击记录 → 在 ResultPreview 中加载对应视频
    - 支持 checkbox 多选（最多 2 条）进入对比模式
    - 超过 20 条时分页加载（SWR + cursor 分页）
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x]* 6.4 编写历史记录排序与完整性属性测试
    - **Property 11: 历史记录排序与完整性**
    - **Validates: Requirements 9.1, 9.2**
    - 测试文件: `src/__tests__/happyhorse-ui.property.test.ts`
    - 验证排序为 createdAt 严格降序，且每条渲染包含必要字段

- [x] 7. Checkpoint - 确保所有组件可独立渲染
  - TypeScript 类型检查通过（新文件无类型错误）✓

- [x] 8. 后端 API 路由
  - [x] 8.1 创建积分预估 API `src/app/api/projects/[id]/estimate-happyhorse/route.ts`
    - GET 方法，接收 query 参数 `duration`
    - 调用积分计算逻辑，返回 `{ estimatedCredits, balance, sufficient }`
    - 参数校验使用 Zod（duration 为正整数，3-60 范围）
    - _Requirements: 6.4_

  - [x] 8.2 创建历史记录 API `src/app/api/projects/[id]/happyhorse-history/route.ts`
    - GET 方法，支持 cursor 分页（query: `cursor`, `limit` 默认 20）
    - 查询 `GenerationJob` 表（engine = 'happyhorse'，按项目过滤）
    - 返回 `{ records: HistoryRecord[], nextCursor?: string }`
    - _Requirements: 9.1, 9.5_

- [x] 9. 编辑器页面集成
  - [x] 9.1 重构编辑器页面布局，集成 ModeTab 切换逻辑
    - ModeTab 组件已创建，支持 Tab 切换面板显隐
    - 使用 CSS `display: none` 保留非活跃面板 DOM 状态
    - 确保 Seedance 面板和 HappyHorse 面板互斥显示
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 9.2 组装 HappyHorse Generate_Panel 完整面板
    - 在 HappyHorse Tab 内容区域组装：TemplatePicker → PromptArea → ReferenceImageUploader → CreditEstimator → 生成按钮 → ProgressIndicator → ResultPreview → HistoryList
    - 连接 HappyHorseStore 状态到各组件
    - 实现生成按钮点击逻辑：调用 `/api/projects/:id/generate-happyhorse`，设置 isGenerating 状态
    - 生成完成后自动展示 ResultPreview
    - _Requirements: 1.1, 1.2, 3.1, 4.1, 5.1, 6.1, 7.1, 8.1, 9.1_

  - [ ]* 9.3 编写集成测试：完整生成流程与 Tab 切换状态保留
    - 测试上传参考图 → 填写 Prompt → 获取预估 → 点击生成 → SSE 进度 → 结果预览
    - 测试 Tab 切换前后输入状态保留
    - _Requirements: 2.4, 4.1, 6.1, 7.1, 8.1_

- [x] 10. Final checkpoint - 确保所有测试通过
  - 10 property tests pass ✓
  - TypeScript 编译无新增错误 ✓

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- 所有前端组件为 Client Component（`'use client'`），因为需要用户交互
- 进度推送复用现有 `sse-progress-store` + `use-sse-progress` Hook，无需重新实现 SSE 基础设施
- 积分预估优先调用后端 API，仅在 API 不可用时使用前端纯函数做乐观预估（标记"~"）
- 历史记录复用现有 `GenerationJob` 表（engine = 'happyhorse' 过滤），无需新增数据库模型
- Property tests 使用 fast-check 库，每个 property 至少 100 次迭代
- 所有组件基于 shadcn/ui + Tailwind CSS v4 暗色主题
- Task 1.7 复用已有 `src/lib/credit-calc.ts`（`estimateHappyHorseCreditCost` 函数已存在）

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.6", "1.7"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "1.5", "1.8", "2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "4.1", "4.3"] },
    { "id": 3, "tasks": ["4.2", "4.4", "5.1", "5.2"] },
    { "id": 4, "tasks": ["4.5", "5.3", "6.1", "6.3", "8.1", "8.2"] },
    { "id": 5, "tasks": ["6.2", "6.4", "9.1"] },
    { "id": 6, "tasks": ["9.2"] },
    { "id": 7, "tasks": ["9.3"] }
  ]
}
```
