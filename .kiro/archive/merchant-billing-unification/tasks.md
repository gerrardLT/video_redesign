# Implementation Plan: Merchant Billing Unification（商家计费体系收敛）

## Overview

本实施计划把本地生活营销平台（`/merchant`）自建的「额度（Quota）」体系收敛到视频重塑既有的「积分（Credit）+ 订阅（UserTier）」体系。落地顺序：先做 additive-only 数据迁移与权益常量，再在 `credit-service` 增加以 `(bizRefType, bizRefId)` 为幂等键、**绝不写 `jobId`** 的内部实现，封装出 `merchant-billing-service`，随后改造各 Route / `local-render-service` / Worker 计费接入点，最后删除额度体系并整合主框架导航。

所有积分写经 `withCreditLock` 串行化；外部失败一律抛错不静默降级；迁移仅新增可空列与索引，绝不改动视频重塑工作流既有的列、表与约束。代码与注释统一使用简体中文，TypeScript 严格模式，禁止 `any`。

## Tasks

- [x] 1. CreditLedger additive-only 迁移（新增商家实体关联列）
  - [x] 1.1 在 `prisma/schema.prisma` 的 `CreditLedger` 模型新增 `bizRefType String? @map("biz_ref_type")` 与 `bizRefId String? @map("biz_ref_id")` 两个可空、无外键列，并新增复合索引 `@@index([bizRefType, bizRefId])`
    - 仅新增 nullable 列与索引，不修改/删除任何既有列与约束（含 `credit_ledger_job_id_fkey`）
    - 通过 `npx prisma migrate dev` 生成迁移并 `npx prisma generate` 重新生成客户端（禁止手动编辑 `prisma/migrations/` 与 `src/generated/prisma/`）
    - 确认 `Merchant`/`Store`/`ContentBrief`/`VideoVariant` 模型无任何字段变更
    - _Requirements: 4.2, 4.3, 7.1, 7.3_

- [x] 2. 权益常量与 privilege-engine 扩展（会员权益从 Merchant_Tier 收敛到 UserTier）
  - [x] 2.1 改造 `src/constants/merchant.ts`：移除 `SUBSCRIPTION_TIERS`，新增 `MERCHANT_PRIVILEGE_MAPPING` 与 `CREDIT_COST_CONTENT_PLAN`
    - `MERCHANT_PRIVILEGE_MAPPING: Record<UserTier, { exportResolution, complianceCheckEnabled, insightsEnabled, maxStores }>`，FREE=720p/关闭洞察/maxStores=1，MONTHLY=1080p/开放洞察/maxStores=3，YEARLY=1080p/开放洞察/maxStores=10
    - `CREDIT_COST_CONTENT_PLAN = 10`（固定单价，取值 ≥ 0）
    - 删除 `SUBSCRIPTION_TIERS` 的同时删除其废弃注释
    - _Requirements: 2.2, 3.3, 5.2, 5.3, 5.4, 5.7_

  - [x] 2.2 在 `src/lib/privilege-engine.ts` 新增 `MerchantPrivileges` 接口、纯函数 `determineMerchantPrivileges(tier)` 与异步 `getMerchantPrivileges(userId)`
    - `determineMerchantPrivileges` 直接查 `MERCHANT_PRIVILEGE_MAPPING`，`batchConcurrency` 复用 `CONCURRENCY_LIMITS[tier].generate` 语义
    - `getMerchantPrivileges` 复用既有 `determineTier` / `getUserPrivileges` 的订阅查询路径得到 tier，再映射；不新增任何按 `plan.name` 解读的路径
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 7.2_

  - [x]* 2.3 为 `determineMerchantPrivileges` 编写属性测试
    - **Property 9: Privilege_Mapping 映射正确**
    - **Validates: Requirements 5.2, 5.3, 5.4**
    - 文件 `src/__tests__/property/merchant-billing-unification.property.test.ts`，fast-check，for all tier ∈ {FREE,MONTHLY,YEARLY} 断言权益项与映射表一致，≥100 次迭代

  - [x]* 2.4 为 `determineTier` 编写属性测试
    - **Property 8: 会员等级解读唯一且与套餐名无关**
    - **Validates: Requirements 5.1, 7.2**
    - 随机 status/planType/planName，断言结果只依赖 status 与 planType、与 planName 无关

- [x] 3. credit-service 扩展（以 bizRef 为幂等键、无 jobId 的内部实现）
  - [x] 3.1 在 `src/lib/credit-service.ts` 新增 `reserveCreditsByBizRef({ userId, bizRefType, bizRefId, amount, remark })`
    - 经 `withCreditLock` + Prisma 事务；幂等键 `(bizRefType, bizRefId, action='RESERVE')` 已存在则跳过
    - 余额 < amount → 抛 `ApiError('INSUFFICIENT_CREDITS', ..., 402)`，余额不变、绝不为负
    - 写 `CreditLedger` 时 `jobId` 恒为 null，关联字段写 `bizRefType`/`bizRefId`
    - 与既有 `freezeExportCredits`/`projectId` 版本并存，不改动既有函数签名
    - _Requirements: 3.2, 4.1, 4.4, 6.3_

  - [x] 3.2 在 `src/lib/credit-service.ts` 新增 `chargeCreditsByBizRef`（基于已有 RESERVE 的差额退款记账）
    - 泛化既有 `chargeCreditsTx` 的关联键，由 `jobId`/`projectId` 扩展为 `(bizRefType, bizRefId)`
    - 多冻结差额（reserved − actual）以 REFUND 退回后再记 CHARGE；幂等键 `(bizRefType, bizRefId, action='CHARGE')` 已存在则跳过
    - _Requirements: 4.4, 6.5_

  - [x] 3.3 在 `src/lib/credit-service.ts` 新增 `refundCreditsByBizRef`（CHARGE 前失败的全额补偿退款）
    - 退还额 = 该关联键已 RESERVE 的额度；幂等键 `(bizRefType, bizRefId, action='REFUND')` 已存在则跳过、不重复退款
    - 经 `withCreditLock` 串行化
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 4. merchant-billing-service（商家积分计费封装，新增）
  - [x] 4.1 创建 `src/lib/merchant-billing-service.ts`，实现纯函数 `estimateRenderCost(groupDurations, resolution)`
    - 对每个分镜组时长调用既有 `estimateGroupCreditCost(duration, resolution)` 求和返回
    - 纯函数，无副作用，便于属性测试
    - _Requirements: 3.1, 3.7_

  - [x]* 4.2 为 `estimateRenderCost` 编写属性测试
    - **Property 1: 渲染成本等于各分镜组积分之和**
    - **Validates: Requirements 3.1, 3.7**
    - 随机时长数组（每项 > 0）+ 分辨率，断言 == Σ `estimateGroupCreditCost`

  - [x] 4.3 在 `merchant-billing-service.ts` 实现 `reserveMerchantCredits` / `chargeMerchantCredits` / `refundMerchantCredits` 薄封装
    - 内部分别委托 3.1/3.2/3.3 的 `*ByBizRef` 函数；`MerchantBizRefType = 'CONTENT_BRIEF' | 'CONTENT_PLAN' | 'STORE'`
    - 注意：`'STORE'` 仅为类型完整性占位，建店不扣积分（Req 3.4），该 bizRef 不进入 reserve/charge 路径；实现时不得为建店添加任何扣费逻辑
    - 函数签名不接受 `jobId` 参数，关联恒走 `bizRefType`/`bizRefId`；`chargeMerchantCredits` 提供可在外部事务中调用的 tx 版本，与状态更新同事务
    - _Requirements: 3.1, 3.2, 4.1, 4.4, 6.1, 6.5_

  - [x]* 4.4 编写「余额不足必拒绝且余额不变」属性测试
    - **Property 2: 余额不足必拒绝且余额不变**
    - **Validates: Requirements 3.2, 3.3**
    - 随机 `balance < cost`，断言 `reserveMerchantCredits` 抛 402 且余额前后不变、非负

  - [x]* 4.5 编写「商家计费动作幂等」属性测试
    - **Property 5: 商家计费动作幂等**
    - **Validates: Requirements 4.4, 6.2**
    - 对同一 `(bizRefType, bizRefId)` 重复调用 RESERVE/CHARGE/REFUND N 次，断言最终余额与流水条数等同单次

  - [x]* 4.6 编写「冻结—退款往返一致」属性测试
    - **Property 6: 冻结—退款往返一致**
    - **Validates: Requirements 6.1, 6.4**
    - 随机初始余额 + 冻结额（amount ≤ balance），reserve→refund 后断言余额恢复到操作前

  - [x]* 4.7 编写「差额退款使净扣等于实扣」属性测试
    - **Property 7: 差额退款使净扣等于实扣**
    - **Validates: Requirements 6.5**
    - 随机 `0 ≤ actual ≤ reserved`，reserve→charge 后断言净减少量恰好 == actual

  - [x]* 4.8 编写「商家流水不含 jobId 且正确关联商家实体」属性测试
    - **Property 4: 商家流水不含 jobId 且正确关联商家实体**
    - **Validates: Requirements 4.1, 4.2, 4.5**
    - 随机商家操作，断言所有写入流水 `jobId===null` 且 `bizRefType ∈ {CONTENT_BRIEF,CONTENT_PLAN,STORE}`、`bizRefId` 等于发起实体主键

  - [x]* 4.9 编写 merchant-billing-service 单元测试
    - 文件 `src/__tests__/merchant-billing-service.test.ts`
    - 内容计划固定单价扣费额 == `CREDIT_COST_CONTENT_PLAN`（Req 3.3 EXAMPLE）；导出含超分扣减 / 不含超分余额不变（Req 3.5 两代表用例）
    - _Requirements: 3.3, 3.5_

- [x] 5. Checkpoint - 计费内核与权益映射就绪
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. API Route 改造（仅校验 + 调服务 + 返回，移除额度判定）
  - [x] 6.1 改造 `src/app/api/content-briefs/[briefId]/render/route.ts`
    - 移除 `checkMerchantQuota(RENDER_VIDEO)`；入队前 `estimateRenderCost` + `reserveMerchantCredits(CONTENT_BRIEF, briefId, est)`
    - 余额不足 → 402 `INSUFFICIENT_CREDITS`（含 `required` / `balance`），拒绝入队
    - _Requirements: 2.3, 3.1, 3.2, 3.7_

  - [x] 6.2 改造 `src/app/api/stores/[storeId]/content-plan/generate/route.ts`
    - 移除 `checkMerchantQuota(CREATE_CONTENT_PLAN)`；按固定 `CREDIT_COST_CONTENT_PLAN` 走 `reserveMerchantCredits(CONTENT_PLAN, planId, ...)`
    - 余额不足 → 402 `INSUFFICIENT_CREDITS`
    - _Requirements: 2.3, 3.3_

  - [x] 6.3 改造 `src/app/api/video-variants/[variantId]/export/route.ts`
    - 移除 `getMerchantTier` + `SUBSCRIPTION_TIERS[tier].exportResolution`，改用 `getMerchantPrivileges(userId).exportResolution`
    - 含超分才 `reserveMerchantCredits`（复用导出超分公式），不含超分不扣减
    - _Requirements: 2.3, 3.5, 5.3, 5.4_

  - [x] 6.4 改造 `src/app/api/content-briefs/[briefId]/insights/route.ts`
    - 移除 `checkMerchantQuota(ACCESS_INSIGHTS)`；按 `getMerchantPrivileges(userId).insightsEnabled` 门控
    - 未开放 → 403 `INSIGHTS_NOT_AVAILABLE` 升级提示；不扣减积分
    - _Requirements: 2.3, 3.6, 5.6_

  - [x] 6.5 改造 `src/app/api/stores`（建店）路由
    - 移除 `checkMerchantQuota(CREATE_STORE)`；不扣减积分，按 `getMerchantPrivileges(userId).maxStores` 门控
    - 超限 → 403 `STORE_LIMIT_EXCEEDED`，升级提示含当前门店数、上限值、可解除限制的最低等级三要素
    - _Requirements: 2.3, 3.4, 5.5_

  - [x] 6.6 改造 `src/app/api/merchant/subscription/route.ts`（权益汇总）
    - 移除对 5 项 `checkMerchantQuota` + `SUBSCRIPTION_TIERS` 的汇总，改为返回 `getMerchantPrivileges` + `getBalance`（积分余额）
    - _Requirements: 2.3, 5.1, 5.2_

  - [x]* 6.7 编写「权益门控在超限/未开放时拒绝并给出升级提示」属性测试
    - **Property 10: 权益门控在超限/未开放时拒绝并给出升级提示**
    - **Validates: Requirements 5.5, 5.6**
    - 随机 tier + currentStores，断言 `currentStores >= maxStores` 时建店被拒且提示含当前数/上限/最低等级；`insightsEnabled=false` 时洞察被拒并返回升级提示

  - [x]* 6.8 编写「无扣减操作余额守恒」属性测试
    - **Property 3: 无扣减操作余额守恒**
    - **Validates: Requirements 3.4, 3.6**
    - 随机输入下建店与洞察访问操作前后余额完全相等、无新增流水

- [x] 7. local-render-service 计费接入（反转「只走额度不扣积分」临时修法）
  - [x] 7.1 改造 `src/lib/local-render-service.ts`
    - 渲染成功（置 `GENERATED` 同一事务内）调用 `chargeMerchantCredits({ CONTENT_BRIEF, briefId, actualAmount })`，`actualAmount` 按 3 个 VideoVariant 实际渲染时长经 `estimateGroupCreditCost` 求和
    - 渲染失败（置 `FAILED`）调用 `refundMerchantCredits({ CONTENT_BRIEF, briefId })` 幂等退还
    - 移除「商家渲染只走额度不扣积分」的旧逻辑与废弃注释
    - _Requirements: 3.1, 3.7, 6.1, 6.5_

  - [x]* 7.2 编写渲染补偿集成测试
    - 文件 `tests/integration/merchant-billing-flow.test.ts`
    - reserve → 渲染成功 → charge（差额退回）；reserve → 渲染失败 → refund（余额恢复）
    - _Requirements: 6.1, 6.5_

- [x] 8. Worker 计费点接入
  - [x] 8.1 在 `render-local-video` / `generate-content-plan` Worker 接入 charge/refund 计费点
    - 复用 7.1 的 charge/refund 路径；外部依赖失败一律抛错让 BullMQ 重试（幂等安全），不静默降级
    - 失败路径退款解卡，复用既有看门狗/重试模型
    - _Requirements: 3.1, 6.1, 6.2, 6.3_

- [x] 9. 删除本地生活自建额度体系
  - [x] 9.1 删除 `src/lib/merchant-quota-service.ts` 整文件，并清除 `src/types/merchant.ts` 中 `QuotaAction` / `QuotaCheckResult` 在生产代码中的全部引用
    - 确认所有 Route（task 6 已改造）不再 import `checkMerchantQuota` / `getMerchantTier` / `MerchantTier`
    - _Requirements: 2.1, 2.4_

  - [x]* 9.2 移除/改写 `src/__tests__/property/subscription-quota.property.test.ts` 中复现额度逻辑的部分
    - 删除针对已废除额度体系的断言，保留与积分/权益相关的有效用例
    - _Requirements: 2.1, 2.2_

- [x] 10. 主框架与模块导航整合
  - [x] 10.1 解除 `/merchant` 与 `/dashboard` 隔离约束并提供导航入口
    - 确认 `middleware.ts` 对 `/merchant` 与 `/dashboard` 注入同一套 `x-user-id` / `x-user-role`（仅确认现状，不改认证机制）
    - 在 `/merchant` 主框架提供进入 `/dashboard` 视频重塑模块的导航入口；视频重塑模块内部页面结构与交互保持不变
    - 在代码注释中标注已重新评估并解除 local-life-marketing-platform Req 15.5 的隔离约束
    - _Requirements: 1.1, 8.1, 8.2, 8.3, 8.4_

- [x] 11. Checkpoint - 改造接入完成
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. 集成、迁移与冒烟校验
  - [x]* 12.1 扩充商家计费集成测试（在 task 7.2 已创建的文件基础上补充，不新建文件）
    - 文件 `tests/integration/merchant-billing-flow.test.ts`（沿用 7.2，追加用例而非覆盖）
    - 真实 PostgreSQL 写一笔商家流水断言不触发 `credit_ledger_job_id_fkey` 外键违约（Req 4.5）；各 Route 改造后走积分/权益不再引用额度逻辑（Req 2.3）；同一 JWT 会话访问 `/merchant` 与 `/dashboard` 均放行（Req 8.2）；既有 Merchant/Store/ContentBrief/VideoVariant 读写正常（Req 7.1）
    - _Requirements: 2.3, 4.5, 7.1, 8.2_

  - [x]* 12.2 编写结构 / 迁移冒烟检查
    - 静态检查：生产代码无 `merchant-quota-service` / `SUBSCRIPTION_TIERS` / `QuotaAction` / `QuotaCheckResult` 引用，`pnpm build` 通过（Req 2.1/2.2/2.4）
    - 迁移检查：`credit_ledger` 仅新增 `biz_ref_type`/`biz_ref_id` 可空列与复合索引；Merchant/Store/ContentBrief/VideoVariant 表结构无变更；确认无历史额度数据回填脚本（Req 7.4）
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 4.3, 7.3, 7.4_

- [x] 13. Final checkpoint - 收敛完成
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- 标记 `*` 的子任务为可选（属性测试 / 单元测试 / 集成测试 / 冒烟检查），可为更快 MVP 跳过；核心实现任务不带 `*`，必须实现。
- 每个任务标注所校验的具体需求子条款，便于追溯；属性测试任务显式引用设计文档中的属性编号与其验证的需求条款。
- 所有积分写经 `withCreditLock` 串行化，且 `withCreditLock` 内部不得再嵌套调用 `withCreditLock`。
- 商家计费函数绝不接受/写入 `jobId`，关联恒走 `bizRefType` / `bizRefId`，从源头杜绝 `credit_ledger_job_id_fkey` 外键违约。
- 迁移严格 additive-only：仅新增可空列与索引，绝不修改/删除视频重塑工作流既有列、表与约束。
- 不触碰视频重塑生成链路（parse/generate/merge/Seedance/HappyHorse），本 Spec 仅在计费与权益层调整（Req 9.1-9.4 范围外）。
- 属性测试统一落在 `src/__tests__/property/merchant-billing-unification.property.test.ts`，使用 fast-check，每个属性 ≥100 次迭代，并以注释关联设计属性编号。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "4.1", "10.1"] },
    { "id": 1, "tasks": ["2.2", "3.1"] },
    { "id": 2, "tasks": ["2.3", "3.2"] },
    { "id": 3, "tasks": ["4.2", "3.3"] },
    { "id": 4, "tasks": ["2.4", "4.3"] },
    { "id": 5, "tasks": ["4.4", "6.1", "6.2", "6.3", "6.4", "6.5", "6.6", "7.1", "4.9"] },
    { "id": 6, "tasks": ["4.5", "7.2", "8.1", "9.1"] },
    { "id": 7, "tasks": ["4.6", "9.2", "12.1", "12.2"] },
    { "id": 8, "tasks": ["4.7"] },
    { "id": 9, "tasks": ["4.8"] },
    { "id": 10, "tasks": ["6.7"] },
    { "id": 11, "tasks": ["6.8"] }
  ]
}
```
