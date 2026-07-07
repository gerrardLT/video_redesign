# Implementation Plan: Asset Expiry Policy

## Overview

为资产系统引入"永久资产"与"临时资产"双轨生命周期策略。实现 ExpiryStatusCalculator 纯函数、修改 AssetLifecycleService 增加永久资产保护、修改 cleanup/notification Worker、新增 Bookmark API、前端 ExpiryBadge 组件、数据迁移脚本，以及完整的属性测试和单元测试覆盖。

## Tasks

- [x] 1. 实现 ExpiryStatusCalculator 纯函数模块
  - [x] 1.1 创建 `src/lib/expiry-status.ts`，实现 `computeExpiryStatus` 纯函数
    - 定义 `ExpiryStatus` 类型和 `ExpiryStatusResult` 接口
    - 实现四种状态判定逻辑：permanent / expiring_soon / active / expired
    - remainingDays 使用 Math.ceil 向上取整天数
    - 支持注入 `now` 参数便于测试
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x]* 1.2 编写属性测试：Property 1 - ExpiryStatus 计算正确性
    - **Property 1: ExpiryStatus 计算正确性**
    - 使用 fast-check 生成随机 expiresAt（null 或任意 Date）和 now
    - 验证所有分区规则的正确性
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4**

  - [x]* 1.3 编写单元测试：ExpiryStatusCalculator 边界情况
    - 测试 expiresAt 恰好等于 now 时为 expired
    - 测试 expiresAt 比 now 多恰好 3 天的边界
    - 测试 remainingDays 为小数时向上取整
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 2. 修改 AssetLifecycleService 增加永久资产保护
  - [x] 2.1 修改 `setExpiry` 方法，增加 category 检查逻辑
    - 在设置过期时间前检查 asset.category 是否有值
    - 若有值则记录日志并提前返回，不设置 expiresAt
    - _Requirements: 1.3, 6.2_

  - [x] 2.2 修改 `renewExpiry` 方法，增加 category 检查逻辑
    - 在续期前检查 asset.category 是否有值
    - 若有值则记录日志并提前返回，永久资产无需续期
    - _Requirements: 6.3_

  - [x]* 2.3 编写属性测试：Property 2 - setExpiry 跳过永久资产
    - **Property 2: setExpiry 跳过永久资产**
    - 使用 fast-check 生成随机 category 值的 Asset
    - 验证 category 有值时 expiresAt 保持不变
    - **Validates: Requirements 1.3, 6.2**

  - [x]* 2.4 编写属性测试：Property 3 - renewExpiry 跳过永久资产
    - **Property 3: renewExpiry 跳过永久资产**
    - 使用 fast-check 生成随机 category 值的 Asset
    - 验证 category 有值时 expiresAt 保持不变
    - **Validates: Requirements 6.3**

  - [x]* 2.5 编写属性测试：Property 7 - setExpiry 对临时资产正确计算过期时间
    - **Property 7: setExpiry 对临时资产正确计算过期时间**
    - 使用 fast-check 生成随机 createdAt 和 days
    - 验证 expiresAt === createdAt + days * 86400000
    - **Validates: Requirements 2.1**

- [x] 3. Checkpoint - 核心服务逻辑验证
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. 修改 asset-cleanup Worker
  - [x] 4.1 修改 `getExpiredAssets` 查询条件，排除永久资产
    - 查询条件增加 `expiresAt: { not: null }` 过滤
    - 确保仅扫描 expiresAt 不为 null 且 <= 当前时间的记录
    - 保持 status !== 'EXPIRED' 条件
    - _Requirements: 1.2, 2.3_

  - [x]* 4.2 编写属性测试：Property 5 - getExpiredAssets 排除永久资产
    - **Property 5: getExpiredAssets 排除永久资产**
    - 使用 fast-check 生成混合 expiresAt 的资产集合（含 null 和有值）
    - 验证返回结果中不含 expiresAt 为 null 的资产
    - 验证返回的所有资产 expiresAt <= now
    - **Validates: Requirements 1.2**

- [x] 5. 实现 Bookmark API
  - [x] 5.1 创建 `src/app/api/assets/[id]/bookmark/route.ts`，实现 POST 处理
    - 实现鉴权：校验 x-user-id 与 asset.userId 一致
    - 实现校验：asset.status !== 'EXPIRED'，否则返回 400
    - 实现更新：设置 expiresAt=null，category=body.category || 'CHARACTER'
    - 返回更新后的 asset 附带 expiryStatus
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x]* 5.2 编写属性测试：Property 4 - Bookmark 升级为永久资产
    - **Property 4: Bookmark 升级为永久资产**
    - 使用 fast-check 生成状态非 EXPIRED 的临时资产
    - 验证 Bookmark 操作后 expiresAt 为 null 且 category 有值
    - 验证 computeExpiryStatus 返回 'permanent'
    - **Validates: Requirements 4.1, 4.2, 4.3**

  - [x]* 5.3 编写单元测试：Bookmark API 边界情况
    - 测试已过期资产执行 Bookmark 返回 400 错误
    - 测试非本人资产操作返回 403 错误
    - 测试资产不存在返回 404 错误
    - 测试重复收藏（已是永久资产）的幂等行为
    - _Requirements: 4.1, 4.4_

- [x] 6. 修改 notification Worker 增加 bookmark 入口链接
  - [x] 6.1 修改过期提醒通知的 meta 字段，增加 `bookmarkLink`
    - 在通知 meta 中增加 `bookmarkLink: /api/assets/${assetId}/bookmark`
    - 确保通知内容包含资产名称、项目名称、剩余天数
    - _Requirements: 5.2, 5.3_

  - [x]* 6.2 编写属性测试：Property 8 - 过期提醒通知幂等性
    - **Property 8: 过期提醒通知幂等性**
    - 使用 fast-check 生成随机资产
    - 验证同一天内多次执行提醒流程，最多只产生一条通知
    - **Validates: Requirements 5.4**

  - [x]* 6.3 编写属性测试：Property 9 - 通知内容完整性
    - **Property 9: 通知内容完整性**
    - 使用 fast-check 生成即将过期的资产及其关联项目
    - 验证通知内容包含资产名称、项目名称、剩余天数
    - **Validates: Requirements 5.2**

- [x] 7. Checkpoint - Worker 和 API 验证
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. 创建数据迁移脚本
  - [x] 8.1 创建 `prisma/migrations/fix-permanent-asset-expiry.ts` 数据迁移脚本
    - 使用 updateMany 批量将 category 有值且 expiresAt 不为 null 的记录修正
    - 设置 expiresAt 为 null，确保幂等可重复执行
    - 记录影响行数日志
    - _Requirements: 6.1_

  - [x]* 8.2 编写属性测试：Property 6 - 数据迁移不变量
    - **Property 6: 数据迁移不变量**
    - 使用 fast-check 生成随机资产集合（部分 category 有值且 expiresAt 不为 null）
    - 验证迁移后不存在同时满足 category != null 且 expiresAt != null 的记录
    - **Validates: Requirements 1.4, 6.1**

- [x] 9. 实现前端 ExpiryBadge 组件
  - [x] 9.1 创建 `src/components/asset/expiry-badge.tsx` 组件
    - 使用 shadcn/ui Badge 组件
    - 实现四种状态的视觉样式：permanent(绿)/expiring_soon(红)/active(默认)/expired(灰)
    - 展示对应文案：永久 / {N}天后过期 / 剩余{N}天 / 已过期
    - 集成到资产库列表页（AssetGrid 组件）和项目资产列表中，在每个资产卡片上展示 ExpiryBadge
    - _Requirements: 3.5_

  - [x]* 9.2 编写单元测试：ExpiryBadge 组件渲染
    - 测试四种状态分别渲染正确的样式和文案
    - 测试 remainingDays 为 null 时不显示天数
    - _Requirements: 3.5_

- [x] 10. 扩展资产列表 API 响应
  - [x] 10.1 修改资产列表和资产详情 API，附带 expiryStatus 字段
    - 在 GET /api/asset-library 响应中使用 computeExpiryStatus 计算每个资产的状态
    - 在 GET /api/projects/:id/assets 响应中同样附带 expiryStatus 和 remainingDays
    - 扩展 Zustand asset store，增加 bookmarkAsset action
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.3_

- [x] 11. Final Checkpoint - 全部集成验证
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties (使用 fast-check v4.8.0)
- 单元测试验证具体边界情况和错误处理
- 本功能不新增 Prisma 模型，仅修改现有逻辑和新增 API
- 数据迁移脚本为幂等设计，可安全重复执行

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.1", "2.2"] },
    { "id": 2, "tasks": ["2.3", "2.4", "2.5", "4.1"] },
    { "id": 3, "tasks": ["4.2", "5.1", "6.1", "8.1"] },
    { "id": 4, "tasks": ["5.2", "5.3", "6.2", "6.3", "8.2"] },
    { "id": 5, "tasks": ["9.1", "10.1"] },
    { "id": 6, "tasks": ["9.2"] }
  ]
}
```
