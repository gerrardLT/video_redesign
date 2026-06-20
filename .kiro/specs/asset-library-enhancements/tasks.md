# Implementation Plan: 资产库增强 (Asset Library Enhancements)

## Overview

基于现有资产库模块，增加三大核心交互能力：全屏预览/缩放查看、文件下载、角色图跨项目应用。实现路径为：先扩展后端服务层和 API 路由，再构建前端新组件（Preview_Modal、Character_Apply_Dialog），最后增强现有 Asset_Card 组件并编写属性测试。

技术选型：TypeScript + Next.js Route Handlers + Prisma + 阿里云 OSS 签名 URL + shadcn/ui + Zustand + fast-check 属性测试。

## Tasks

- [x] 1. 扩展后端服务层和工具函数
  - [x] 1.1 实现缩放/平移计算纯函数模块
    - 创建 `src/lib/preview-transform.ts`
    - 实现 `clampScale(raw: number): number`，将缩放比例限制在 [0.5, 3.0] 范围
    - 实现 `clampPan(panX, panY, scale, imageWidth, imageHeight, viewportWidth, viewportHeight): { panX, panY }`，确保平移偏移不超出可视边界
    - 实现 `zoomAtPoint(currentScale, delta, mouseX, mouseY, panX, panY): ViewTransform`，以鼠标位置为缩放中心的滚轮缩放逻辑
    - 导出类型 `ViewTransform { scale: number; panX: number; panY: number }`
    - _Requirements: 1.3, 1.5_

  - [x] 1.2 扩展 asset-library-service.ts 添加下载和跨项目应用方法
    - 在 `src/lib/asset-library-service.ts` 中新增 `generateDownloadUrl(assetId: string, userId: string): Promise<{ downloadUrl: string; fileName: string }>`
    - 新增 `applyToCharacter(assetId: string, targetProjectId: string, targetCharacterId: string, userId: string): Promise<Character>`
    - 新增 `listProjectsWithCharacterCount(userId: string): Promise<ProjectWithCharacters[]>`
    - 新增 `listCharactersByProject(projectId: string, userId: string): Promise<CharacterOption[]>`
    - 下载方法调用已有 `storage.ts` 的 `getSignedObjectUrl(key, 600)` 生成 10 分钟签名 URL
    - 应用方法在 Prisma 事务中验证所有权并更新 `character.imageUrl`
    - 所有方法包含完整的所有权验证（403）和存在性检查（404）
    - _Requirements: 2.1, 3.4, 3.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2_

  - [x]* 1.3 编写属性测试 - 缩放边界 (Property 1)
    - **Property 1: 缩放比例始终在有效范围内**
    - **Validates: Requirements 1.3**
    - 创建 `src/lib/__tests__/asset-library-enhancements.property.test.ts`
    - 使用 fast-check 生成随机缩放操作序列，验证 `clampScale` 输出始终 ∈ [0.5, 3.0]
    - 最少 100 iterations

  - [x]* 1.4 编写属性测试 - 平移边界 (Property 2)
    - **Property 2: 平移偏移始终保证图片可见**
    - **Validates: Requirements 1.5**
    - 使用 fast-check 生成随机 scale + pan + 图片尺寸 + 视口尺寸组合
    - 验证 `clampPan` 输出满足：当 scale * imageSize > viewportSize 时，图片边缘不超出视口

  - [x]* 1.5 编写属性测试 - 跨项目应用正确性 (Property 3)
    - **Property 3: 跨项目应用正确设置 imageUrl 且不复制文件**
    - **Validates: Requirements 3.4, 3.5, 5.2, 5.6**
    - 模拟 Prisma 事务，验证成功应用后 character.imageUrl === asset.url（字节一致，无复制）

  - [x]* 1.6 编写属性测试 - 所有权验证 (Property 5)
    - **Property 5: 所有权验证——非法访问始终返回 403**
    - **Validates: Requirements 5.1, 5.3, 5.5**
    - 使用 fast-check 生成随机用户/资产/项目所有权组合
    - 验证非法访问始终抛出 403 错误，且不修改任何 Character 记录

  - [x]* 1.7 编写属性测试 - 项目列表排序 (Property 6)
    - **Property 6: 项目列表按更新时间降序排列**
    - **Validates: Requirements 6.1**
    - 使用 fast-check 生成随机项目集合（含随机 updatedAt）
    - 验证返回结果中相邻项 projects[i].updatedAt >= projects[i+1].updatedAt

- [x] 2. 实现后端 API 路由
  - [x] 2.1 实现下载签名 URL API 路由
    - 创建 `src/app/api/asset-library/[id]/download/route.ts`
    - GET 方法：从 `x-user-id` header 获取用户身份
    - 调用 `generateDownloadUrl` 服务方法
    - 返回 `{ downloadUrl, fileName }` 或对应错误码（403/404/500）
    - 使用 Zod 校验路由参数
    - _Requirements: 2.1, 2.5_

  - [x] 2.2 实现跨项目应用 API 路由
    - 创建 `src/app/api/asset-library/[id]/apply-to-character/route.ts`
    - POST 方法：校验请求体 `{ targetProjectId, targetCharacterId }`（Zod）
    - 调用 `applyToCharacter` 服务方法
    - 返回更新后的 Character 或对应错误码（403/404）
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 2.3 实现项目列表查询 API 路由
    - 创建 `src/app/api/projects/list-with-characters/route.ts`
    - GET 方法：根据 `projectId` query 参数区分返回项目列表或角色列表
    - 无 `projectId` → 返回 `{ projects: [...] }`，含 characterCount，按 updatedAt DESC 排序
    - 有 `projectId` → 验证项目所有权后返回 `{ characters: [...] }`
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x]* 2.4 编写服务层单元测试
    - 创建 `src/lib/__tests__/asset-library-service.test.ts`（扩展已有文件）
    - 测试 `generateDownloadUrl`：正常路径 + 无权限 + 资产不存在
    - 测试 `applyToCharacter`：正常路径 + 覆盖已有 imageUrl + 各种 403/404 场景
    - 测试 `listProjectsWithCharacterCount`：空列表 + 排序验证
    - _Requirements: 2.1, 5.1~5.6_

- [x] 3. Checkpoint - 确保后端服务和 API 测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. 实现全屏预览组件
  - [x] 4.1 创建 Preview_Modal 组件
    - 创建 `src/components/asset-library/preview-modal.tsx`（'use client'）
    - 全屏模态框，使用 shadcn/ui Dialog 作为基础
    - 顶部工具栏：资产名称、缩放比例显示（百分比）、缩放按钮（+/-/重置）、下载按钮、关闭按钮
    - 底部信息栏：分类徽章（Badge）、创建日期、文件大小
    - 图片区域使用 CSS transform 实现缩放和平移
    - 调用 `clampScale`/`clampPan` 纯函数控制变换
    - 支持鼠标滚轮缩放（以鼠标位置为缩放中心，调用 `zoomAtPoint`）
    - 支持拖拽平移（mousedown → mousemove → mouseup，仅当图片超出视口时启用）
    - Escape 键 / 点击遮罩关闭
    - 图片加载失败显示"图片加载失败"错误占位 + 重试按钮
    - 使用 lucide-react 图标（ZoomIn, ZoomOut, RotateCcw, Download, X）
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.4_

  - [x]* 4.2 编写 Preview_Modal 组件测试
    - 创建 `src/components/asset-library/__tests__/preview-modal.test.tsx`
    - 测试环境使用 jsdom
    - 测试打开/关闭行为、缩放按钮交互、Escape 键关闭、错误占位显示
    - _Requirements: 1.1, 1.4, 1.6_

- [x] 5. 实现角色图跨项目应用组件
  - [x] 5.1 创建 Character_Apply_Dialog 组件
    - 创建 `src/components/asset-library/character-apply-dialog.tsx`（'use client'）
    - 使用 shadcn/ui Dialog + Select/RadioGroup 实现两级选择器
    - 打开时加载项目列表（Skeleton 过渡）
    - 选择项目后加载角色列表（Skeleton 过渡）
    - 每个项目显示名称和角色计数
    - 每个角色显示名称和当前参考图缩略图（或占位符）
    - 若目标角色已有 imageUrl → 显示覆盖警告"该角色已有参考图，确认覆盖？"（二次确认按钮）
    - 确认后调用 apply API → 成功 toast "已应用到 [项目名] - [角色名]" / 失败 toast
    - 使用 SWR 加载项目和角色列表数据
    - _Requirements: 3.1, 3.2, 3.3, 3.6, 3.7, 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x]* 5.2 编写属性测试 - Toast 消息格式 (Property 7)
    - **Property 7: 成功应用后 toast 消息包含项目名和角色名**
    - **Validates: Requirements 3.6**
    - 在 `src/lib/__tests__/asset-library-enhancements.property.test.ts` 中追加
    - 使用 fast-check 生成随机项目名和角色名字符串
    - 验证格式化后的 toast 消息包含两者作为子字符串

  - [x]* 5.3 编写 Character_Apply_Dialog 组件测试
    - 创建 `src/components/asset-library/__tests__/character-apply-dialog.test.tsx`
    - 测试两级选择流程、覆盖警告显示、加载状态
    - _Requirements: 3.1, 3.3, 3.7, 6.5_

- [x] 6. 增强 Asset_Card 组件
  - [x] 6.1 修改 Asset_Card 添加操作叠层
    - 修改 `src/components/asset-library/asset-grid.tsx` 中的 AssetCard 组件
    - Hover 时显示操作叠层（半透明背景 + 按钮组）
    - 所有类别：预览（Eye）、下载（Download）、删除（Trash2）按钮
    - CHARACTER 类别额外显示：应用到角色（UserPlus）按钮
    - 每个按钮带 Tooltip 提示文字
    - 点击缩略图区域触发预览（打开 Preview_Modal）
    - 操作进行中对应按钮显示 Loader2 旋转 + disabled 状态
    - 添加 `onPreview`、`onDownload`、`onApplyToCharacter` 回调 props
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x]* 6.2 编写属性测试 - 按钮可见性规则 (Property 4 & 8)
    - **Property 4: "应用到角色"按钮仅在 CHARACTER 类别可见**
    - **Property 8: 操作卡片叠层按钮组合规则**
    - **Validates: Requirements 3.8, 4.1, 4.2**
    - 在 `src/lib/__tests__/asset-library-enhancements.property.test.ts` 中追加
    - 使用 fast-check 生成随机 category 值
    - 验证按钮集合规则：非 CHARACTER = {preview, download, delete}，CHARACTER = {preview, download, delete, apply}

  - [x]* 6.3 编写 Asset_Card 组件测试
    - 创建 `src/components/asset-library/__tests__/asset-card.test.tsx`
    - 测试 hover overlay 按钮渲染、CHARACTER 类别额外按钮、点击事件触发
    - _Requirements: 4.1, 4.2, 4.3_

- [x] 7. 整合页面层和状态管理
  - [x] 7.1 扩展 Zustand store 集成新功能
    - 修改 `src/stores/` 中的资产库 store（如已有）或创建 `src/stores/asset-library-store.ts`
    - 添加 `previewAsset: AssetLibraryItem | null`（当前预览资产）
    - 添加 `setPreviewAsset` / `clearPreviewAsset` actions
    - 添加 `downloadAsset(assetId: string)` 异步 action（调用下载 API + 触发浏览器下载）
    - 添加 `applyToCharacter(assetId, targetProjectId, targetCharacterId)` 异步 action
    - 添加各操作的 loading 状态管理
    - 为所有 fetch 请求配置 30s 超时（AbortController），超时后 toast "网络请求超时，请重试"
    - _Requirements: 2.2, 3.4, 4.5_

  - [x] 7.2 集成到资产库页面
    - 修改资产库页面文件，引入 Preview_Modal 和 Character_Apply_Dialog
    - 将 Asset_Card 的回调连接到 store actions
    - 下载操作：调用 API 获取签名 URL → 使用 `<a download>` 或 `window.open` 触发浏览器下载
    - 预览操作：设置 store.previewAsset → 打开 Preview_Modal
    - 应用操作：打开 Character_Apply_Dialog → 选择确认后调用 store.applyToCharacter
    - 确保所有 toast 使用 shadcn/ui 的 toast 组件
    - _Requirements: 1.1, 2.2, 3.1, 3.6, 4.3_

- [x] 8. Final checkpoint - 确保所有测试通过
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- 本功能不需要修改 Prisma schema，所有数据操作基于现有 Asset、Character、Project 模型
- 下载通过 OSS 签名 URL 实现（10 分钟有效期），无需代理文件流
- 跨项目应用直接引用同一 OSS URL，不复制文件（节省存储）
- 属性测试文件统一放置在 `src/lib/__tests__/asset-library-enhancements.property.test.ts`
- 组件测试需要 jsdom 环境（在测试文件顶部配置 `// @vitest-environment jsdom`）
- 缩放/平移逻辑抽取为纯函数（`preview-transform.ts`），便于属性测试和复用

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "1.4", "1.5", "1.6", "1.7", "2.1", "2.2", "2.3"] },
    { "id": 2, "tasks": ["2.4", "4.1", "5.1"] },
    { "id": 3, "tasks": ["4.2", "5.2", "5.3", "6.1"] },
    { "id": 4, "tasks": ["6.2", "6.3", "7.1"] },
    { "id": 5, "tasks": ["7.2"] }
  ]
}
```
