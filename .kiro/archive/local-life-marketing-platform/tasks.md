# Implementation Plan: 本地生活营销平台

## Overview

将现有 AI 视频重绘平台增量扩展为面向本地生活实体门店的 AI 短视频营销代运营系统。采用自底向上策略：数据模型 → 核心服务 → Worker → API → 前端。严格遵循增量改造原则，不修改/删除现有表和 API。

## Tasks

- [x] 1. 数据模型与基础设施
  - [x] 1.1 扩展 Prisma Schema 新增商家营销平台数据模型
    - 在 `prisma/schema.prisma` 中增量添加所有新枚举和模型
    - 执行 `npx prisma migrate dev` 生成迁移
    - 确保仅 additive-only 变更
    - _Requirements: 16.6, 16.5_

  - [x] 1.2 注册新增 BullMQ 队列
    - 在 `src/lib/queue.ts` 中用 `lazyQueue` 注册 4 个队列
    - _Requirements: 16.3, 16.7_

  - [x] 1.3 创建类型定义与 Zod 验证 Schema
    - 新建 `src/types/merchant.ts` + `src/lib/validations/merchant.ts`
    - _Requirements: 1.1, 1.3, 2.1, 6.3, 9.1, 11.2_

  - [x] 1.4 创建商家平台常量文件
    - 新建 `src/constants/merchant.ts`
    - _Requirements: 9.2, 9.3, 4.2, 6.2, 14.1-14.5_

  - [ ]* 1.5 编写数据库迁移增量性验证测试
    - **Property 16: 数据库迁移增量性**
    - **Validates: Requirements 16.6**

- [x] 2. Checkpoint - 数据模型基础设施验证
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. 商家问诊服务
  - [x] 3.1 实现商家问诊 API 路由
    - 新建 `src/app/api/merchant/onboarding/route.ts`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [ ]* 3.2 编写问诊事务原子性属性测试
    - **Property 1: 问诊事务原子性**
    - **Validates: Requirements 1.1, 1.6**

  - [ ]* 3.3 编写问诊 API 单元测试
    - _Requirements: 1.1, 1.4, 1.5, 1.6_

- [x] 4. 门店画像生成服务
  - [x] 4.1 实现门店画像规则引擎
    - 新建 `src/lib/store-profile-service.ts`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ]* 4.2 编写门店画像完整性属性测试
    - **Property 12: 门店画像必填字段完整性**
    - **Validates: Requirements 2.1, 2.6**

  - [x] 4.3 实现门店管理 API 路由
    - stores CRUD + profile + offers 路由
    - _Requirements: 1.7, 2.1, 15.1, 16.5_

- [x] 5. 行业剧本引擎
  - [x] 5.1 实现剧本引擎核心逻辑
    - 新建 `src/lib/playbook-engine.ts`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 5.2 创建餐饮行业剧本种子数据
    - `prisma/seed.ts` 中添加 ≥12 个 Playbook
    - _Requirements: 3.1, 3.2_

  - [ ]* 5.3 编写剧本连续使用上限属性测试
    - **Property 4: 剧本连续使用上限**
    - **Validates: Requirements 3.5, 13.2**

- [x] 6. 内容日历服务
  - [x] 6.1 实现日历生成服务
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_
  - [ ]* 6.2 编写日期与目标属性测试
    - **Property 2: 内容计划日期不变式**
    - **Property 3: 内容目标唯一性**
    - **Validates: Requirements 4.1, 4.2, 4.5**
  - [ ]* 6.3 编写日历单元测试
    - _Requirements: 4.1, 4.6, 4.7_

- [~] 7. Checkpoint - 核心服务层验证
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. 拍摄指导与质量检测
  - [x] 8.1 实现拍摄指导服务
    - _Requirements: 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 6.4, 6.5_
  - [ ]* 8.2 编写质量评分属性测试
    - **Property 5: 质量评分边界一致性**
    - **Validates: Requirements 6.2, 6.3, 6.4, 6.5**
  - [ ]* 8.3 编写拍摄排序属性测试
    - **Property 13: 拍摄任务排序不变式**
    - **Validates: Requirements 5.1**

- [x] 9. 本地视频渲染服务
  - [x] 9.1 实现渲染服务
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9_
  - [ ]* 9.2 编写额度守恒属性测试
    - **Property 6: 额度守恒（RESERVE/CHARGE/REFUND）**
    - **Validates: Requirements 7.4, 7.5, 7.6, 7.8**
  - [ ]* 9.3 编写版本完整性属性测试
    - **Property 7: 视频版本完整性**
    - **Validates: Requirements 7.1, 7.5**

- [x] 10. 发布文案生成服务
  - [x] 10.1 实现文案生成服务
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_
  - [ ]* 10.2 编写文案单元测试
    - _Requirements: 8.1, 8.2, 8.5, 8.6_

- [x] 11. 合规检查服务
  - [x] 11.1 实现合规检查服务
    - _Requirements: 9.1-9.10_
  - [ ]* 11.2 编写风险等级属性测试
    - **Property 8: 合规风险等级单调性**
    - **Validates: Requirements 9.9**
  - [ ]* 11.3 编写阻断导出属性测试
    - **Property 9: 合规阻断导出不变式**
    - **Validates: Requirements 9.6, 9.7, 10.2**

- [x] 12. 同质化检测服务
  - [x] 12.1 实现同质化检测
    - _Requirements: 13.1-13.8_
  - [ ]* 12.2 编写同质化边界属性测试
    - **Property 10: 同质化分数边界行为**
    - **Validates: Requirements 13.6, 13.7, 13.8**
  - [ ]* 12.3 编写 Dice 算法单元测试
    - _Requirements: 13.3_

- [ ] 13. 数据录入与学习服务
  - [x] 13.1 实现数据录入服务
    - _Requirements: 11.1-11.7_
  - [-] 13.2 实现表现学习服务
    - _Requirements: 12.1-12.7_
  - [ ]* 13.3 编写数据录入单元测试
    - _Requirements: 11.2, 11.3, 11.4, 11.7_

- [ ] 14. 订阅额度管理
  - [-] 14.1 实现额度检查
    - _Requirements: 14.1-14.8_
  - [ ]* 14.2 编写月度重置属性测试
    - **Property 11: 订阅额度月度重置**
    - **Validates: Requirements 14.2, 14.3, 14.4, 14.8**

- [~] 15. Checkpoint - 服务层完整验证
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 16. Worker 进程
  - [-] 16.1 实现 generate-content-plan Worker
    - _Requirements: 1.4, 1.7, 2.1, 4.1_
  - [-] 16.2 实现 render-local-video Worker
    - _Requirements: 7.1-7.9, 16.3_
  - [-] 16.3 实现 compliance-review Worker
    - _Requirements: 9.1, 9.10_
  - [~] 16.4 注册 Worker 到入口
    - _Requirements: 16.7_
  - [ ]* 16.5 编写锁互斥属性测试
    - **Property 14: 分布式锁互斥性**
    - **Validates: Requirements 7.7**

- [~] 17. Checkpoint - Worker 层验证
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 18. API 路由 - 内容计划与今日任务
  - [ ] 18.1 实现内容计划 API
    - POST /api/stores/[storeId]/content-plan/generate + GET current
    - _Requirements: 4.1, 5.1, 5.6, 14.6_
  - [ ] 18.2 实现今日任务 API
    - GET /api/stores/[storeId]/today
    - _Requirements: 5.1, 5.6, 15.1_

- [ ] 19. API 路由 - 任务与素材
  - [~] 19.1 实现任务详情 API
    - _Requirements: 5.1, 5.2, 5.3_
  - [~] 19.2 实现素材上传 API
    - _Requirements: 6.1-6.7_
  - [ ] 19.3 实现渲染与合规 API
    - _Requirements: 7.1, 7.4, 9.1, 9.7, 11.1, 12.1, 13.6, 14.7_

- [ ] 20. API 路由 - 导出与权限
  - [~] 20.1 实现导出 API
    - _Requirements: 10.1-10.7_
  - [x] 20.2 实现订阅 API
    - _Requirements: 14.6, 14.7_
  - [ ] 20.3 实现权限验证工具
    - _Requirements: 16.5_
  - [ ]* 20.4 编写旧系统兼容属性测试
    - **Property 15: 旧系统 API 向后兼容**
    - **Validates: Requirements 16.1**

- [ ] 21. Checkpoint - API 层验证
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 22. 前端 - 布局与基础组件
  - [~] 22.1 创建商家布局路由
    - _Requirements: 15.4, 15.5_
  - [ ] 22.2 创建基础 UI 组件
    - _Requirements: 15.2, 15.4_

- [ ] 23. 前端 - 问诊表单
  - [ ] 23.1 实现问诊表单页
    - _Requirements: 1.1, 1.3, 15.2, 15.3_

- [ ] 24. 前端 - 首页与日历
  - [~] 24.1 实现门店首页
    - _Requirements: 15.1, 15.6_
  - [ ] 24.2 实现日历视图
    - _Requirements: 4.1, 15.1_

- [ ] 25. 前端 - 拍摄与上传
  - [ ] 25.1 实现拍摄上传页
    - _Requirements: 5.1, 5.2, 5.4, 5.5, 5.7, 6.7, 15.3, 15.4_

- [ ] 26. 前端 - 版本与导出
  - [ ] 26.1 实现版本导出页
    - _Requirements: 7.1, 8.1, 10.1, 10.2, 10.5, 15.2, 15.4_

- [ ] 27. 前端 - 数据与建议
  - [ ] 27.1 实现数据建议页
    - _Requirements: 11.1, 12.1, 15.2_

- [ ] 28. Checkpoint - 前端验证
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 29. 状态管理与集成
  - [~] 29.1 创建 Zustand stores
    - _Requirements: 15.1, 15.4_
  - [~] 29.2 创建 SWR hooks
    - _Requirements: 15.1_
  - [ ] 29.3 集成 SSE 进度推送
    - _Requirements: 7.5, 15.4_

- [ ] 30. Final checkpoint - 全量验证
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests validate correctness properties from design document
- 增量改造：不修改/删除现有表结构和 API
- 路径隔离：/merchant 与 /dashboard 完全独立
- 复用：credit-service, distributed-lock, storage, BullMQ, progress-publisher
- 无静默降级：外部调用失败即抛错

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3", "1.4"] },
    { "id": 1, "tasks": ["1.2", "1.5", "5.2"] },
    { "id": 2, "tasks": ["3.1", "4.1", "20.3"] },
    { "id": 3, "tasks": ["3.2", "3.3", "4.2", "4.3", "5.1"] },
    { "id": 4, "tasks": ["5.3", "6.1"] },
    { "id": 5, "tasks": ["6.2", "6.3", "8.1"] },
    { "id": 6, "tasks": ["8.2", "8.3", "9.1"] },
    { "id": 7, "tasks": ["9.2", "9.3", "10.1", "12.1"] },
    { "id": 8, "tasks": ["10.2", "11.1", "12.2", "12.3"] },
    { "id": 9, "tasks": ["11.2", "11.3", "13.1", "13.2"] },
    { "id": 10, "tasks": ["13.3", "14.1"] },
    { "id": 11, "tasks": ["14.2", "16.1", "16.3"] },
    { "id": 12, "tasks": ["16.2", "16.4", "16.5"] },
    { "id": 13, "tasks": ["18.1", "18.2"] },  
    { "id": 14, "tasks": ["19.1", "19.2", "19.3"] },
    { "id": 15, "tasks": ["20.1", "20.2", "20.4"] },
    { "id": 16, "tasks": ["22.1", "22.2"] },
    { "id": 17, "tasks": ["23.1", "29.1", "29.2"] },
    { "id": 18, "tasks": ["24.1", "24.2"] },
    { "id": 19, "tasks": ["25.1", "26.1"] },
    { "id": 20, "tasks": ["27.1", "29.3"] }
  ]
}
```


