# Implementation Plan: 用户资产库 (User Asset Library)

## Overview

基于 Next.js + Prisma + SQLite + BullMQ 技术栈，实现用户级资产管理系统。核心流程：扩展 Asset 数据模型 → 实现服务层（入库 + 查询管理）→ 创建 API 路由 → 构建前端页面和组件 → 集成到现有 Worker 和导航。使用 TypeScript 全栈开发，fast-check v4.8.0 进行属性测试。

## Tasks

- [x] 1. 数据库 Schema 扩展与迁移
  - [x] 1.1 修改 Prisma Schema 扩展 Asset 模型
    - 在 `prisma/schema.prisma` 中将 Asset 模型的 `projectId` 从 `String` 改为 `String?`
    - 新增 `category` 字段（`String?`，可选值：CHARACTER / MATERIAL / AUDIO）
    - 新增 `displayName` 字段（`String?`）
    - 新增 `@@index([userId])` 和 `@@index([userId, category])` 索引
    - 将 `project` 关系改为 `Project?`（可选关联）
    - 运行 `npx prisma migrate dev --name add-asset-library-fields` 生成迁移
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 1.2 创建数据迁移脚本
    - 创建 `prisma/migrations/data-migrate-asset-category.ts` 脚本
    - 将现有 `type = 'CHARACTER_IMAGE'` 的记录设置 `category = 'CHARACTER'`，`displayName` 从 `fileName` 提取（去后缀）
    - 将现有 `type = 'UPLOADED_IMAGE'` 的记录设置 `category = 'MATERIAL'`
    - 将现有 `type = 'AI_GENERATED'` 的记录设置 `category = 'MATERIAL'`
    - 提供运行说明（`npx tsx prisma/migrations/data-migrate-asset-category.ts`）
    - _Requirements: 7.4_

- [x] 2. 核心服务层实现
  - [x] 2.1 实现 AssetIngestionService（自动入库服务）
    - 创建 `src/lib/asset-ingestion-service.ts`
    - 实现 `ingestCharacterImage(params)` 方法，使用 upsert 语义（同 userId + characterId 下不重复）
    - 入库时设置 `category = 'CHARACTER'`、`displayName` 从 characterName 派生、`status = 'UPLOADED'`
    - 处理 thumbUrl 可选传入
    - _Requirements: 1.1, 1.2, 1.3_

  - [x]* 2.2 编写 AssetIngestionService 属性测试 - Property 1
    - **Property 1: 自动入库创建完整记录**
    - **Validates: Requirements 1.1, 1.2**
    - 测试文件: `src/lib/__tests__/asset-library-service.property.test.ts`
    - 使用 fast-check 生成随机 userId/projectId/characterName/imageUrl，验证入库后 Asset 记录字段完整

  - [x]* 2.3 编写 AssetIngestionService 属性测试 - Property 2
    - **Property 2: 再生成的 Upsert 语义**
    - **Validates: Requirements 1.3**
    - 测试文件: `src/lib/__tests__/asset-library-service.property.test.ts`
    - 对同一 characterId 多次调用 ingestCharacterImage，验证最终只有一条记录且 URL 为最新

  - [x] 2.4 实现 AssetLibraryService（资产库核心查询服务）
    - 创建 `src/lib/asset-library-service.ts`
    - 实现 `listAssets(query)` 方法：支持 userId 过滤、category 筛选、keyword 模糊搜索（displayName LIKE）、分页（page/pageSize）、按 createdAt DESC 排序
    - 实现 `getCategoryCounts(userId)` 方法：返回各分类资产数量和总计
    - 实现 `deleteAsset(assetId, userId)` 方法：验证所有权（403）、检查 OSS 引用保留、删除记录
    - 实现 `getCharacterAssets(userId)` 方法：获取用户所有 CHARACTER 类型资产
    - _Requirements: 2.1, 2.2, 4.1, 4.3, 4.4, 5.1, 5.2, 5.3, 6.2, 6.3, 6.4, 7.5_

  - [x]* 2.5 编写 AssetLibraryService 属性测试 - Property 4
    - **Property 4: 搜索与筛选正确性**
    - **Validates: Requirements 2.4, 5.1, 5.2, 5.3, 7.5**
    - 测试文件: `src/lib/__tests__/asset-library-service.property.test.ts`
    - 随机生成资产集合 + 查询条件，验证结果满足所有过滤约束且无遗漏

  - [x]* 2.6 编写 AssetLibraryService 属性测试 - Property 6
    - **Property 6: 分页正确性**
    - **Validates: Requirements 4.1, 4.3, 4.4**
    - 测试文件: `src/lib/__tests__/asset-library-service.property.test.ts`
    - 验证 totalPages = ceil(N/P)，各页大小正确，全页并集无重复无遗漏

  - [x]* 2.7 编写 AssetLibraryService 属性测试 - Property 7
    - **Property 7: 删除移除记录**
    - **Validates: Requirements 6.2**
    - 测试文件: `src/lib/__tests__/asset-library-service.property.test.ts`
    - 删除后查询不返回已删资产，用户资产总数减少 1

  - [x]* 2.8 编写 AssetLibraryService 属性测试 - Property 9
    - **Property 9: 用户数据隔离**
    - **Validates: Requirements 6.4, 7.5**
    - 测试文件: `src/lib/__tests__/asset-library-service.property.test.ts`
    - 两个不同 userId 互不可见对方资产，跨用户删除返回 403

  - [x]* 2.9 编写 AssetLibraryService 属性测试 - Property 10
    - **Property 10: 分类计数准确性**
    - **Validates: Requirements 8.3**
    - 测试文件: `src/lib/__tests__/asset-library-service.property.test.ts`
    - getCategoryCounts 返回值与实际数据库记录数一致

  - [x]* 2.10 编写 AssetLibraryService 属性测试 - Property 3
    - **Property 3: 分类枚举约束**
    - **Validates: Requirements 2.1, 2.2**
    - 测试文件: `src/lib/__tests__/asset-library-service.property.test.ts`
    - 任何资产的 category 必须为 CHARACTER / MATERIAL / AUDIO 之一，非法值被拒绝

- [x] 3. Checkpoint - 核心服务层验证
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. API 路由实现
  - [x] 4.1 实现资产列表 API（GET /api/asset-library）
    - 创建 `src/app/api/asset-library/route.ts`
    - 鉴权：从 session 获取 userId
    - Query 参数：`category`、`keyword`、`page`、`pageSize`
    - 使用 Zod 校验参数（keyword 最大 100 字符，page >= 1，pageSize 1-100）
    - 调用 AssetLibraryService.listAssets 返回分页数据
    - _Requirements: 4.1, 4.3, 4.4, 5.1, 5.2, 5.3_

  - [x] 4.2 实现资产删除 API（DELETE /api/asset-library/[id]）
    - 创建 `src/app/api/asset-library/[id]/route.ts`
    - 鉴权：验证 userId 所有权
    - 调用 AssetLibraryService.deleteAsset，处理 403/404 错误
    - _Requirements: 6.2, 6.3, 6.4_

  - [x] 4.3 实现角色图列表 API（GET /api/asset-library/characters）
    - 创建 `src/app/api/asset-library/characters/route.ts`
    - 鉴权：从 session 获取 userId
    - 调用 AssetLibraryService.getCharacterAssets 返回 CHARACTER 资产列表
    - _Requirements: 3.1, 3.4_

  - [x] 4.4 实现分类计数 API（GET /api/asset-library/counts）
    - 创建 `src/app/api/asset-library/counts/route.ts`
    - 鉴权：从 session 获取 userId
    - 调用 AssetLibraryService.getCategoryCounts 返回统计数据
    - _Requirements: 8.3_

- [x] 5. 前端状态管理与组件实现
  - [x] 5.1 创建 AssetLibrary Zustand Store
    - 创建 `src/stores/asset-library-store.ts`
    - 状态字段：category、keyword、page、pageSize
    - Actions：setCategory、setKeyword、setPage、reset
    - _Requirements: 2.3, 2.4, 5.4_

  - [x] 5.2 实现 AssetFilterBar 组件
    - 创建 `src/components/asset-library/asset-filter-bar.tsx`
    - 分类 Tab 按钮（全部 / 角色图 / 素材 / 音频），每个 Tab 显示对应数量
    - 搜索输入框，300ms debounce
    - 使用 shadcn/ui 组件（Tabs、Input）
    - _Requirements: 2.3, 2.4, 5.4, 8.3_

  - [x] 5.3 实现 AssetGrid 组件
    - 创建 `src/components/asset-library/asset-grid.tsx`
    - 网格布局展示资产卡片（缩略图、名称、类型、项目名、创建日期）
    - 删除按钮 + 确认对话框
    - 分页控件
    - 空状态和加载状态展示
    - _Requirements: 4.1, 4.2, 6.1, 6.5_

  - [x] 5.4 实现 AssetLibraryPage 页面
    - 创建 `src/app/dashboard/assets/page.tsx`
    - 组合 AssetFilterBar + AssetGrid
    - 使用 SWR 或 fetch 调用 API（列表 + 分类计数）
    - 页面标题 "资产库"
    - _Requirements: 4.1, 8.2_

  - [x] 5.5 实现 ProjectCharacterPicker 组件
    - 创建 `src/components/project/character-picker.tsx`
    - 调用 `/api/asset-library/characters` 获取用户 CHARACTER 资产
    - 展示资产名称、缩略图、创建日期
    - 选择后将 Asset OSS URL 赋值给 Character.imageUrl
    - 使用 shadcn/ui Dialog 或 Popover 实现选择器交互
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 6. Checkpoint - 前端组件验证
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Worker 集成与导航接入
  - [x] 7.1 集成 AssetIngestionService 到 generate-character Worker
    - 修改 `src/workers/generate-character.ts`
    - 在步骤 5（创建 Asset 记录）处调用 `AssetIngestionService.ingestCharacterImage`
    - 传入 userId、projectId、characterId、characterName、imageUrl
    - 替换现有直接 `prisma.asset.create` 调用，使用 upsert 语义
    - 确保失败时不创建入库记录（保持 catch 逻辑不变）
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 7.2 在 Dashboard 导航中添加"资产库"入口
    - 修改 `src/app/dashboard/layout.tsx`
    - 在 `NAV_LINKS` 数组中添加 `{ href: '/dashboard/assets', label: '资产库', exact: false }`
    - 放置在"我的项目"之后
    - _Requirements: 8.1, 8.2_

  - [x]* 7.3 编写 AssetIngestionService 单元测试
    - 测试文件: `src/lib/__tests__/asset-ingestion-service.test.ts`
    - 测试自动入库创建完整记录（字段验证）
    - 测试再生成 upsert 更新而非新增
    - 测试生成失败不创建记录
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x]* 7.4 编写 AssetLibraryService 单元测试
    - 测试文件: `src/lib/__tests__/asset-library-service.test.ts`
    - 测试复用角色图时 URL 一致
    - 测试删除时检查引用保留 OSS 文件
    - 测试跨用户访问返回 403
    - 测试 displayName 从 characterName/fileName 派生
    - _Requirements: 3.3, 6.3, 6.4, 7.3_

- [x] 8. Final Checkpoint - 全功能验证
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties (使用 fast-check v4.8.0)
- Unit tests validate specific examples and edge cases
- 数据迁移脚本需在 schema migration 之后手动运行
- generate-character Worker 集成是核心流程，确保 upsert 语义正确替换原有 create 逻辑
- ProjectCharacterPicker 需嵌入到现有的角色编辑界面中

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "2.4"] },
    { "id": 3, "tasks": ["2.2", "2.3", "2.5", "2.6", "2.7", "2.8", "2.9", "2.10"] },
    { "id": 4, "tasks": ["4.1", "4.2", "4.3", "4.4", "5.1"] },
    { "id": 5, "tasks": ["5.2", "5.3", "5.5"] },
    { "id": 6, "tasks": ["5.4", "7.1", "7.2"] },
    { "id": 7, "tasks": ["7.3", "7.4"] }
  ]
}
```
