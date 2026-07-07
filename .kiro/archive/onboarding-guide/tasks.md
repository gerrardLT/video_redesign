# Implementation Plan: Onboarding Guide (新手引导流程)

## Overview

基于 Next.js 15 + Prisma + SQLite + Zustand + shadcn/ui 技术栈，实现新用户引导向导系统。核心流程：Prisma Schema 扩展（OnboardingProgress 模型）→ 服务层实现（OnboardingService + SampleProjectService）→ API 路由 → 前端引导引擎（useOnboarding hook + Zustand store）→ UI 组件（WelcomeWizard / TooltipGuide / SpotlightOverlay / OnboardingProvider）→ Dashboard/Editor 页面集成 → 属性测试（fast-check v4.8.0）。

## Tasks

- [x] 1. 数据库 Schema 扩展与静态数据准备
  - [x] 1.1 新增 OnboardingProgress Prisma 模型 + Project.isSample 字段
    - 在 `prisma/schema.prisma` 中新增 `OnboardingProgress` 模型
    - 字段：id(cuid)、userId(unique)、welcomeWizard、sampleProject、dashboardTooltip、editorGuide、firstProjectGuide（均为 String @default("NOT_COMPLETED")）、rewardGranted(Boolean @default(false))、createdAt、updatedAt
    - 在 `User` 模型中添加 `onboardingProgress OnboardingProgress?` 反向关系
    - 在 `Project` 模型中新增 `isSample Boolean @default(false) @map("is_sample")` 字段，用于标记示例项目
    - 使用 `@@map("onboarding_progress")` 映射表名
    - 运行 `npx prisma migrate dev --name add-onboarding-progress` 生成迁移
    - _Requirements: 5.1, 5.4, 2.3_

  - [x] 1.2 准备静态预制示例项目数据
    - 创建 `public/onboarding/` 目录
    - 创建 `public/onboarding/sample-project.json`：包含项目元数据（title: "示例项目 - 10秒短视频"、duration: 10）
    - 创建 `public/onboarding/shots.json`：至少 3 个分镜数据（cover 图片路径、prompt、duration）
    - 创建 `public/onboarding/characters.json`：至少 1 个预配置角色（name、imageUrl）
    - 将对应的预制图片文件放入 `public/onboarding/assets/` 目录（cover 图、角色图、预渲染视频）
    - _Requirements: 2.2, 2.4, 2.6_

- [x] 2. 核心服务层实现
  - [x] 2.1 实现 OnboardingService（进度管理 + 奖励发放）
    - 创建 `src/lib/onboarding-service.ts`
    - 定义类型：`OnboardingStepId`（WELCOME_WIZARD | SAMPLE_PROJECT_CREATED | DASHBOARD_TOOLTIP | EDITOR_GUIDE | FIRST_PROJECT_GUIDE）、`StepStatus`（NOT_COMPLETED | COMPLETED | SKIPPED）
    - 实现 `getProgress(userId)` 方法：查询 OnboardingProgress 记录，不存在时自动创建并返回初始状态
    - 实现 `updateStep(userId, stepId, status)` 方法：更新单个步骤状态
    - 实现 `resetProgress(userId)` 方法：将所有步骤重置为 NOT_COMPLETED，但 rewardGranted 保持不变
    - 实现 `checkAndGrantReward(userId)` 方法：检查所有步骤是否为 COMPLETED（SKIPPED 不算），若满足且 rewardGranted 为 false，则创建 CreditLedger TOPUP 记录（20 积分，remark "新手引导完成奖励"），并标记 rewardGranted = true
    - _Requirements: 1.1, 1.5, 5.1, 5.2, 5.4, 5.5, 6.2, 6.4, 8.1, 8.2, 8.4, 8.5_

  - [x] 2.2 实现 SampleProjectService（示例项目创建）
    - 创建 `src/lib/sample-project-service.ts`
    - 实现 `hasSampleProject(userId)` 方法：查询用户是否已有示例项目（通过 Project.name 前缀匹配 "[示例]" 或新增 `isSample Boolean @default(false)` 字段标记，推荐后者）
    - 注意：如使用 isSample 字段，需在 Task 1.1 中同步在 Project 模型新增该字段
    - 实现 `createSampleProject(userId)` 方法：
      - 先调用 hasSampleProject 检查幂等性，已存在则直接返回现有项目
      - 从 `public/onboarding/` 读取静态 JSON 数据
      - 创建 Project 记录（标记为示例项目，status = EDITABLE）
      - 创建关联的 Shot 记录（从 shots.json）
      - 创建关联的 Character 记录（从 characters.json）
      - 如果静态数据文件缺失，记录错误日志并跳过创建，不抛出异常
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 6.5_

  - [ ]* 2.3 编写 OnboardingService 属性测试 - Property 1
    - **Property 1: 完成奖励幂等性**
    - **Validates: Requirements 8.4**
    - 测试文件: `src/lib/__tests__/onboarding-service.property.test.ts`
    - 使用 fast-check 生成随机 userId，多次调用 checkAndGrantReward 后验证 CreditLedger 中最多存在 1 条引导奖励记录

  - [ ]* 2.4 编写 OnboardingService 属性测试 - Property 2
    - **Property 2: 全步骤完成才授予奖励**
    - **Validates: Requirements 8.1, 8.5**
    - 测试文件: `src/lib/__tests__/onboarding-service.property.test.ts`
    - 随机生成 5 个步骤的状态组合，验证仅当全部为 COMPLETED 时 checkAndGrantReward 才返回 true

  - [ ]* 2.5 编写 OnboardingService 属性测试 - Property 3
    - **Property 3: 重置进度正确性**
    - **Validates: Requirements 6.4**
    - 测试文件: `src/lib/__tests__/onboarding-service.property.test.ts`
    - 先设置随机步骤状态并授予奖励，调用 resetProgress 后验证所有步骤回到 NOT_COMPLETED，rewardGranted 仍为 true

  - [ ]* 2.6 编写 SampleProjectService 属性测试 - Property 4
    - **Property 4: 示例项目唯一性**
    - **Validates: Requirements 2.5**
    - 测试文件: `src/lib/__tests__/onboarding-service.property.test.ts`
    - 对同一 userId 多次调用 createSampleProject，验证数据库中该用户示例项目数量始终为 1

- [x] 3. Checkpoint - 核心服务层验证
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. API 路由实现
  - [x] 4.1 实现获取引导进度 API（GET /api/onboarding）
    - 创建 `src/app/api/onboarding/route.ts`
    - 鉴权：从 session 获取 userId
    - 调用 OnboardingService.getProgress(userId) 返回完整进度状态
    - 首次调用时自动创建进度记录并触发 SampleProjectService.createSampleProject
    - _Requirements: 1.1, 5.5_

  - [x] 4.2 实现更新引导步骤 API（PUT /api/onboarding）
    - 在 `src/app/api/onboarding/route.ts` 中添加 PUT handler
    - Body 参数：`stepId`（OnboardingStepId）、`status`（COMPLETED | SKIPPED）
    - 使用 Zod 校验参数
    - 调用 OnboardingService.updateStep 更新步骤状态
    - 更新后调用 OnboardingService.checkAndGrantReward 检查是否满足奖励条件
    - 返回更新后的完整进度 + 是否获得奖励
    - _Requirements: 1.5, 3.5, 4.5, 5.2, 8.1, 8.2_

  - [x] 4.3 实现重置引导 API（POST /api/onboarding/reset）
    - 创建 `src/app/api/onboarding/reset/route.ts`
    - 鉴权：从 session 获取 userId
    - 调用 OnboardingService.resetProgress(userId) 重置进度
    - 检查是否已有示例项目，没有则重新创建
    - _Requirements: 6.4, 6.5_

  - [x] 4.4 实现创建示例项目 API（POST /api/onboarding/sample-project）
    - 创建 `src/app/api/onboarding/sample-project/route.ts`
    - 鉴权：从 session 获取 userId
    - 调用 SampleProjectService.createSampleProject(userId) 创建示例项目
    - 返回创建的项目数据或已存在的项目
    - _Requirements: 2.1, 2.5_

- [x] 5. 前端引导引擎与状态管理
  - [x] 5.1 实现 useOnboarding hook
    - 创建 `src/hooks/use-onboarding.ts`
    - 使用 SWR 获取 /api/onboarding 进度数据
    - 提供 `progress`、`currentStep`、`isStepActive(stepId)`
    - 提供 `completeStep(stepId)` 方法：调用 PUT /api/onboarding 并 mutate SWR 缓存
    - 提供 `skipStep(stepId)` 方法：标记为 SKIPPED 并跳过后续同序列步骤
    - 提供 `resetOnboarding()` 方法：调用 POST /api/onboarding/reset
    - 根据步骤顺序计算 currentStep（第一个 NOT_COMPLETED 步骤）
    - _Requirements: 1.2, 3.1, 4.1, 5.3, 6.1, 6.3_

  - [x] 5.2 实现 OnboardingProvider 组件
    - 创建 `src/components/onboarding/onboarding-provider.tsx`
    - 使用 React Context 提供引导状态给子组件
    - 包裹 useOnboarding hook 并通过 Context 分发
    - 仅在用户已登录时激活（未登录不请求 API）
    - _Requirements: 5.3, 9.4_

- [x] 6. UI 组件实现
  - [x] 6.1 实现 WelcomeWizard 组件
    - 创建 `src/components/onboarding/welcome-wizard.tsx`
    - 4 步欢迎向导 Modal：平台介绍 → 功能概览 → 积分说明 → 开始体验
    - 每步包含标题、描述文案、插图/动画
    - 包含"下一步"按钮、"跳过引导"按钮、步骤进度指示器（dots）
    - 最后一步显示"开始体验"按钮
    - 完成时调用 completeStep('WELCOME_WIZARD')，跳过时调用 skipStep('WELCOME_WIZARD')
    - 使用 shadcn/ui Dialog 组件作为 Modal 基础
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 9.3_

  - [x] 6.2 实现 TooltipGuide 组件
    - 创建 `src/components/onboarding/tooltip-guide.tsx`
    - Props：targetSelector（目标元素选择器）、content（提示内容）、position（top/bottom/left/right）、onNext、onSkip
    - 使用 Floating UI 或手动计算位置定位到目标元素旁
    - 显示浮动卡片：标题 + 描述 + "知道了"/"跳过"按钮
    - 点击"知道了"或目标元素本身触发 onNext
    - 点击外部区域或按 Escape 触发 onSkip
    - 300ms 内完成 dismiss 动画
    - z-index 设置：高于页面内容但低于 toast 通知
    - _Requirements: 3.2, 3.3, 3.4, 9.1, 9.2, 9.5_

  - [x] 6.3 实现 SpotlightOverlay 组件
    - 创建 `src/components/onboarding/spotlight-overlay.tsx`
    - Props：targetSelector（高亮目标选择器）、visible（是否显示）
    - 使用 CSS clip-path 或 SVG mask 实现目标区域高亮、周围区域半透明遮罩
    - 点击遮罩区域（非高亮区域）触发 dismiss
    - 不阻塞对高亮元素的点击交互
    - _Requirements: 3.2, 9.1, 9.3_

  - [x] 6.4 实现 Dashboard Tooltip 引导序列
    - 创建 `src/components/onboarding/dashboard-guide.tsx`
    - 定义 Dashboard Tooltip 序列：新建项目按钮 → 资产库入口 → 套餐入口 → 帮助中心入口
    - 组合 TooltipGuide + SpotlightOverlay 按序展示
    - 全部查看完毕调用 completeStep('DASHBOARD_TOOLTIP')
    - 中途跳过或 Escape 调用 skipStep('DASHBOARD_TOOLTIP')
    - 仅在 WELCOME_WIZARD 已完成/跳过 且 DASHBOARD_TOOLTIP 为 NOT_COMPLETED 时激活
    - _Requirements: 3.1, 3.3, 3.4, 3.5_

  - [x] 6.5 实现 Editor Tooltip 引导序列
    - 创建 `src/components/onboarding/editor-guide.tsx`
    - 定义 Editor Tooltip 序列：分镜列表区域 → 提示词编辑框 → 人物选择面板 → 生成按钮
    - 组合 TooltipGuide + SpotlightOverlay 按序展示
    - 每个 Tooltip 包含功能说明和推荐用法描述
    - 全部查看完毕调用 completeStep('EDITOR_GUIDE')
    - 中途"跳过"或 Escape 调用 skipStep('EDITOR_GUIDE')
    - 不阻塞编辑器操作，用户可自由操作
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [x] 7. Checkpoint - UI 组件验证
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. 页面集成与导航
  - [x] 8.1 Dashboard 页面集成 OnboardingProvider 和引导组件
    - 修改 `src/app/dashboard/layout.tsx` 或 Dashboard 页面
    - 在页面层级包裹 OnboardingProvider
    - 条件渲染 WelcomeWizard（步骤为 NOT_COMPLETED 时显示）
    - 条件渲染 DashboardGuide（满足触发条件时显示）
    - 示例项目在项目列表中显示"示例项目"Badge
    - 添加"重新查看引导"入口到用户设置或帮助菜单
    - _Requirements: 1.2, 2.3, 3.1, 6.3, 9.4_

  - [x] 8.2 Editor 页面集成引导组件
    - 修改 Editor 页面（如 `src/app/dashboard/projects/[id]/editor/page.tsx`）
    - 条件渲染 EditorGuide（EDITOR_GUIDE 步骤为 NOT_COMPLETED 时显示）
    - 不阻塞编辑器正常功能
    - _Requirements: 4.1, 4.6_

  - [x] 8.3 首次创建项目引导集成
    - 在项目创建流程中（如 `src/app/dashboard/projects/` 相关页面）
    - 检测用户创建第一个非示例项目时，FIRST_PROJECT_GUIDE 为 NOT_COMPLETED
    - 显示轻量级流程指引：输入视频链接 → 等待解析 → 编辑分镜和提示词 → 选择人物 → 发起生成
    - 使用 Tooltip 或 Banner 形式展示，不阻塞操作
    - 完成或关闭后调用 completeStep('FIRST_PROJECT_GUIDE')
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 8.4 奖励发放 UI 通知
    - 在 OnboardingProvider 或 useOnboarding 中监听奖励授予事件
    - 使用 toast 通知显示"🎉 恭喜完成新手引导！获得 20 积分奖励"
    - 显示更新后的积分余额
    - _Requirements: 8.3_

- [ ] 9. 单元测试
  - [ ]* 9.1 编写 OnboardingService 单元测试
    - 测试文件: `src/lib/__tests__/onboarding-service.test.ts`
    - 测试 getProgress：不存在时自动创建初始记录
    - 测试 updateStep：更新单个步骤状态
    - 测试 resetProgress：重置所有步骤但保留 rewardGranted
    - 测试 checkAndGrantReward：全部 COMPLETED 时授予奖励
    - 测试 checkAndGrantReward：存在 SKIPPED 时不授予奖励
    - 测试 checkAndGrantReward：已授予奖励时返回 false
    - _Requirements: 1.1, 5.2, 6.4, 8.1, 8.4, 8.5_

  - [ ]* 9.2 编写 SampleProjectService 单元测试
    - 测试文件: `src/lib/__tests__/sample-project-service.test.ts`
    - 测试 createSampleProject：首次创建成功并包含完整数据
    - 测试 createSampleProject：重复调用返回已有项目（幂等性）
    - 测试 createSampleProject：静态数据缺失时记录错误不抛出异常
    - 测试 hasSampleProject：正确判断存在性
    - _Requirements: 2.1, 2.2, 2.5, 2.6_

  - [ ]* 9.3 编写 useOnboarding hook 单元测试
    - 测试文件: `src/hooks/__tests__/use-onboarding.test.ts`
    - 测试 currentStep 计算逻辑（第一个 NOT_COMPLETED 步骤）
    - 测试 completeStep 调用 API 并更新缓存
    - 测试 skipStep 标记 SKIPPED 状态
    - 测试 isStepActive 正确判断
    - _Requirements: 5.3, 6.1_

- [x] 10. Final Checkpoint - 全功能验证
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties（使用 fast-check v4.8.0）
- Unit tests validate specific examples and edge cases
- 静态预制数据放在 `public/onboarding/` 目录，首次请求时由 SampleProjectService 读取
- OnboardingService 中的奖励发放通过 CreditLedger 模型实现（已有模型）
- 前端引导组件使用 Floating UI 定位，shadcn/ui 作为 UI 基础
- 引导不阻塞用户操作是核心原则，所有 Tooltip/Overlay 均可随时 dismiss

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["2.3", "2.4", "2.5", "2.6"] },
    { "id": 3, "tasks": ["4.1", "4.2", "4.3", "4.4"] },
    { "id": 4, "tasks": ["5.1", "5.2"] },
    { "id": 5, "tasks": ["6.1", "6.2", "6.3"] },
    { "id": 6, "tasks": ["6.4", "6.5"] },
    { "id": 7, "tasks": ["8.1", "8.2", "8.3", "8.4"] },
    { "id": 8, "tasks": ["9.1", "9.2", "9.3"] }
  ]
}
```
