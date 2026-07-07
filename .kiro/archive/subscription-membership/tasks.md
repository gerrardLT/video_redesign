# Implementation Plan: Subscription Membership (订阅制会员体系)

## Overview

在现有积分包购买体系基础上实现订阅制会员系统。实现顺序：数据模型 → 核心纯函数（CreditDispatcher / PrivilegeEngine）→ 业务服务（SubscriptionService）→ 支付网关扩展 → BullMQ Workers → API 路由 → 前端 Store 与页面 → 测试补充。每步增量构建，确保无孤立代码。

## Tasks

- [x] 1. Prisma Schema 与数据模型
  - [x] 1.1 新增 SubscriptionPlan、SubscriptionRecord、SubscriptionOrder 模型
    - 在 `prisma/schema.prisma` 中添加三个模型（字段、索引、关联关系按 design.md 定义）
    - 扩展 User 模型新增 `subscriptionRecords` 和 `subscriptionOrders` 关联
    - 扩展 CreditLedger 模型新增 `subscriptionOrderId` 可空字段和关联
    - CreditLedger action 枚举新增 `SUBSCRIPTION_GRANT`
    - 运行 `npx prisma migrate dev` 生成迁移
    - _Requirements: 1.1, 2.1, 2.2, 8.1_

  - [x] 1.2 创建种子数据
    - 在 `prisma/seed.ts` 中添加月卡套餐（29.9元/月，500积分/月，无奖励）和年卡套餐（249元/年，500积分/月，1000积分奖励）
    - 种子数据需幂等（upsert by type）
    - _Requirements: 1.1_

- [x] 2. CreditDispatcher 积分发放服务
  - [x] 2.1 实现 CreditDispatcher 核心逻辑
    - 创建 `src/lib/credit-dispatcher.ts`
    - 实现 `calculateCreditsToDispatch(planType, isFirstMonth)` 纯函数：月卡返回500，年卡首月返回1500，年卡后续月返回500
    - 实现 `dispatchSubscriptionCredits(userId, planId, subscriptionOrderId, isFirstMonth)` 方法：
      - 幂等检查：按 subscriptionOrderId 查询已有 SUBSCRIPTION_GRANT 流水
      - 通过 `withCreditLock` + Prisma 事务原子性操作
      - 写入 CreditLedger（action=SUBSCRIPTION_GRANT, subscriptionOrderId 关联）
      - 累加 User.creditBalance
      - 更新 SubscriptionRecord.totalCreditsGranted
    - _Requirements: 2.3, 3.4, 4.4, 8.1, 8.2_

  - [ ]* 2.2 属性测试：Property 3 - 积分发放计算正确性
    - **Property 3: Credit dispatch calculation correctness**
    - 测试 `calculateCreditsToDispatch` 纯函数：对任意 planType × isFirstMonth 组合验证返回值正确
    - **Validates: Requirements 2.3, 3.4, 4.4**

  - [ ]* 2.3 属性测试：Property 6 - 积分发放账本一致性
    - **Property 6: Credit dispatch ledger consistency (round-trip)**
    - 测试 dispatchSubscriptionCredits 后 CreditLedger + User.creditBalance 不变量
    - **Validates: Requirements 8.1, 8.2**

- [x] 3. PrivilegeEngine 特权引擎
  - [x] 3.1 实现 PrivilegeEngine 核心逻辑
    - 创建 `src/lib/privilege-engine.ts`
    - 实现 `determinePrivileges(isActiveSubscriber)` 纯函数：
      - ACTIVE: queuePriority=1, allowedResolutions=['480p','720p','1080p'], watermarkEnabled=false, historyRetentionDays=30, isActiveMember=true
      - 非 ACTIVE: queuePriority=5, allowedResolutions=['480p','720p'], watermarkEnabled=true, historyRetentionDays=7, isActiveMember=false
    - 实现 `getUserPrivileges(userId)` 异步方法：查询 SubscriptionRecord 状态 → 调用 determinePrivileges
    - _Requirements: 2.4, 5.2, 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ]* 3.2 属性测试：Property 1 - 活跃订阅授予完整会员特权
    - **Property 1: Active subscription grants full member privileges**
    - 对任意 ACTIVE 订阅场景验证 determinePrivileges 返回全部会员特权
    - **Validates: Requirements 2.4, 6.3, 7.1, 7.2, 7.3, 7.4**

  - [ ]* 3.3 属性测试：Property 2 - 非活跃订阅返回默认特权
    - **Property 2: Non-active subscription returns default privileges**
    - 对任意非 ACTIVE 场景验证 determinePrivileges 返回普通用户特权
    - **Validates: Requirements 5.2, 7.5**

- [x] 4. Checkpoint - 确保核心纯函数测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. SubscriptionService 核心服务
  - [x] 5.1 实现 SubscriptionService 订阅生命周期管理
    - 创建 `src/lib/subscription-service.ts`
    - 实现 `createSubscription(input)`：校验套餐存在+用户无活跃订阅 → 创建 SubscriptionOrder(PENDING, expireAt=30min) → 调用 PaymentGateway 发起签约支付
    - 实现 `handleSubscriptionPaymentCallback(callbackData)`：幂等(非PENDING跳过) → Order→PAID → 创建 SubscriptionRecord(ACTIVE) → 调用 CreditDispatcher 发放积分 → 调用 PrivilegeEngine 激活特权 → 注册 BullMQ 续费任务
    - 实现 `handleRenewalCallback(callbackData)`：成功→延长有效期+发放积分，失败→标记FAILED+安排24h重试
    - 实现 `cancelSubscription(userId, recordId)`：设置 renewalType=CANCELED → 解除签约协议
    - 实现 `manualRenew(userId, recordId, payMethod)`：创建续费 Order → 发起支付
    - 实现 `expireSubscription(recordId)`：状态→EXPIRED → 撤销特权（积分不变）
    - 实现 `triggerAutoRenewal(recordId)`：通过签约协议发起代扣
    - 实现 `retryRenewal(recordId)`：重试逻辑（retryCount+1），重试仍失败→发通知
    - 实现 `getActiveSubscription(userId)` 和 `getSubscriptionHistory(userId, page, pageSize)`
    - 实现辅助函数 `extendEndDate(currentEndDate, planType)`：月卡+30天，年卡+365天
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.2, 3.3, 3.4, 3.5, 3.6, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 6.4_

  - [ ]* 5.2 属性测试：Property 4 - 计费周期延长正确性
    - **Property 4: Period extension preserves correct duration**
    - 测试 `extendEndDate` 纯函数：月卡延长恰好30天，年卡延长恰好365天，新日期严格大于旧日期
    - **Validates: Requirements 3.3, 4.3**

  - [ ]* 5.3 属性测试：Property 5 - 到期条件触发状态转换
    - **Property 5: Expiration condition triggers state transition**
    - 测试到期判定逻辑：endDate < now 且无成功续费订单 → 状态应为 EXPIRED
    - **Validates: Requirements 5.1, 6.4**

  - [ ]* 5.4 属性测试：Property 7 - 待支付订单超时过期
    - **Property 7: Pending subscription order expiration**
    - 测试订单过期判定：PENDING + expireAt < now → EXPIRED，其他状态不变
    - **Validates: Requirements 2.5**

  - [ ]* 5.5 属性测试：Property 8 - 取消操作状态转换
    - **Property 8: Cancellation sets renewal type**
    - 测试取消逻辑：取消后 renewalType=CANCELED，但状态保持 ACTIVE（若未到期）
    - **Validates: Requirements 6.1, 9.5**

  - [ ]* 5.6 属性测试：Property 9 - 支付回调映射正确性
    - **Property 9: Payment callback maps to correct order status**
    - 测试回调结果映射：success → PAID, failure → FAILED（确定性映射）
    - **Validates: Requirements 9.4**

  - [ ]* 5.7 属性测试：Property 10 - 到期不扣积分
    - **Property 10: Expiration preserves credit balance**
    - 测试到期事件后 User.creditBalance 不变
    - **Validates: Requirements 5.3**

- [x] 6. PaymentGateway 签约代扣扩展
  - [x] 6.1 扩展支付网关接口与实现
    - 在 `src/services/payment/types.ts` 新增 `CreateContractPaymentParams`、`ContractDeductionParams`、`SubscriptionCallbackData` 类型定义
    - 扩展 `IPaymentGateway` 接口新增：`createContractPayment`、`executeContractDeduction`、`cancelContract`、`verifyContractCallback` 方法
    - 在 `src/services/payment/wechat-gateway.ts` 实现微信签约代扣（调用微信支付委托代扣 API）
    - 在 `src/services/payment/alipay-gateway.ts` 实现支付宝周期扣款签约（调用支付宝周期扣款签约 API）
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 7. Checkpoint - 确保服务层完整
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. BullMQ Workers
  - [x] 8.1 新增订阅相关队列定义
    - 在 `src/lib/queue.ts` 新增 `subscriptionRenewalQueue` 和 `subscriptionExpireQueue`
    - 在 `registerCommercializationSchedules()` 中注册：
      - 订阅到期检测：每小时全量扫描（`0 * * * *`）
    - _Requirements: 3.2, 5.1_

  - [x] 8.2 实现 subscription-renewal-worker
    - 创建 `src/workers/subscription-renewal-worker.ts`
    - 处理逻辑：接收 recordId → 查询 SubscriptionRecord → 验证状态为 ACTIVE 且 renewalType=AUTO → 调用 SubscriptionService.triggerAutoRenewal
    - BullMQ attempts=2, 指数退避
    - _Requirements: 3.2, 3.5_

  - [x] 8.3 实现 subscription-expire-worker
    - 创建 `src/workers/subscription-expire-worker.ts`
    - 处理逻辑：扫描 endDate < now 且 status 为 ACTIVE 或 CANCELED 的记录 → 批量调用 SubscriptionService.expireSubscription
    - 兜底机制：每小时全量扫描，处理遗漏
    - _Requirements: 5.1, 6.4_

  - [x] 8.4 注册 Workers 到入口文件
    - 在 `src/workers/index.ts` 注册新增的 subscription-renewal-worker 和 subscription-expire-worker
    - _Requirements: 3.2, 5.1_

  - [ ]* 8.5 单元测试：Workers 逻辑
    - 测试 SubscriptionRenewalWorker：到期前3天触发、重试逻辑、非 AUTO 跳过
    - 测试 SubscriptionExpireWorker：批量扫描、状态转换、已 EXPIRED 跳过
    - _Requirements: 3.2, 3.5, 5.1_

- [x] 9. API 路由
  - [x] 9.1 套餐列表 API
    - 创建 `src/app/api/subscriptions/plans/route.ts`
    - GET /api/subscriptions/plans：返回 isActive=true 的套餐列表，按 sortOrder 排序
    - _Requirements: 1.1, 1.2_

  - [x] 9.2 创建订阅 API
    - 创建 `src/app/api/subscriptions/create/route.ts`
    - POST /api/subscriptions/create：body={planId, payMethod, enableAutoRenewal} → 调用 SubscriptionService.createSubscription → 返回支付参数
    - 鉴权校验、参数 Zod 校验、错误码处理
    - _Requirements: 2.1_

  - [x] 9.3 取消订阅 API
    - 创建 `src/app/api/subscriptions/cancel/route.ts`
    - POST /api/subscriptions/cancel：body={recordId} → 调用 SubscriptionService.cancelSubscription
    - 鉴权校验、状态校验
    - _Requirements: 6.1, 6.2_

  - [x] 9.4 手动续费 API
    - 创建 `src/app/api/subscriptions/renew/route.ts`
    - POST /api/subscriptions/renew：body={recordId, payMethod} → 调用 SubscriptionService.manualRenew → 返回支付参数
    - _Requirements: 4.2_

  - [x] 9.5 支付回调 API
    - 创建 `src/app/api/payments/wechat/subscription-callback/route.ts`
    - 创建 `src/app/api/payments/alipay/subscription-callback/route.ts`
    - POST 回调：验签 → 解析回调数据 → 调用 SubscriptionService.handleSubscriptionPaymentCallback 或 handleRenewalCallback
    - 处理签约成功、扣款成功/失败、签约解除回调
    - _Requirements: 9.3, 9.4, 9.5_

  - [x] 9.6 订阅状态查询 API
    - 创建 `src/app/api/subscriptions/status/route.ts`
    - GET /api/subscriptions/status：返回当前活跃订阅记录 + 用户特权信息
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 9.7 支付历史 API
    - 创建 `src/app/api/subscriptions/history/route.ts`
    - GET /api/subscriptions/history：分页返回用户的 SubscriptionOrder 列表
    - _Requirements: 10.5_

- [x] 10. Checkpoint - 确保 API 层完整
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Zustand Store
  - [x] 11.1 实现 subscription-store
    - 创建 `src/stores/subscription-store.ts`
    - 状态：currentSubscription, plans, paymentHistory, privileges, loading
    - Actions：fetchPlans, fetchCurrentSubscription, fetchPrivileges, createSubscription, cancelSubscription, manualRenew, fetchPaymentHistory
    - 各 action 调用对应 API 路由，处理 loading 和错误状态
    - _Requirements: 1.2, 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 12. 前端页面与组件
  - [x] 12.1 套餐展示页面
    - 创建 `src/app/dashboard/subscription/plans/page.tsx`（复用现有 /dashboard 路由组结构）
    - 使用 shadcn/ui Card 组件展示月卡/年卡套餐：价格、月积分、奖励积分、特权列表、年卡折扣标注
    - 套餐选择 + 支付方式选择 + 开通按钮
    - 响应式布局，支持移动端
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 12.2 会员管理 Dashboard 页面
    - 创建 `src/app/dashboard/subscription/page.tsx`（与套餐展示页在同一路由组下）
    - 展示：当前套餐名称、状态 Badge（ACTIVE/CANCELED/EXPIRED）、到期日期
    - 展示：当月已到账积分、累计已发放积分
    - 展示：当前会员特权列表（带图标）
    - 提供：取消订阅按钮、手动续费入口（7天内到期+未自动续费时显示）
    - 无有效订阅时展示套餐推荐与开通入口
    - _Requirements: 1.4, 4.1, 10.1, 10.2, 10.3, 10.4, 10.6_

  - [x] 12.3 支付历史列表组件
    - 创建 `src/components/subscription/payment-history.tsx`
    - Table/List 展示每笔支付的金额、时间、状态、类型（首次/续费/手动续费）
    - 分页支持
    - _Requirements: 10.5_

- [ ] 13. 单元测试
  - [ ]* 13.1 SubscriptionService 单元测试
    - 创建 `tests/unit/subscription-service.test.ts`
    - 测试 createSubscription：正常流程、套餐不存在抛错、用户已有活跃订阅冲突(409)
    - 测试 handleSubscriptionPaymentCallback：幂等处理（非PENDING跳过）、正常激活流程
    - 测试 cancelSubscription：正常取消、已取消不重复操作、非法状态报错
    - 测试 expireSubscription：正常到期降级、积分余额不变
    - 测试 triggerAutoRenewal：正常扣款、签约协议不存在报错
    - _Requirements: 2.1, 2.2, 2.3, 5.1, 5.3, 6.1_

  - [ ]* 13.2 CreditDispatcher 单元测试
    - 创建 `tests/unit/credit-dispatcher.test.ts`
    - 测试 dispatchSubscriptionCredits：正常发放、幂等跳过（重复回调不双重发放）、余额正确累加
    - _Requirements: 8.1, 8.2_

  - [ ]* 13.3 PrivilegeEngine 单元测试
    - 创建 `tests/unit/privilege-engine.test.ts`
    - 测试 getUserPrivileges：有活跃订阅返回会员特权、无订阅返回普通特权
    - 测试边界：订阅刚过期、状态为 CANCELED 但未到期
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [ ] 14. 属性测试文件创建
  - [ ]* 14.1 创建属性测试文件并编写全部 Property 1-10
    - 创建 `tests/properties/subscription-membership.property.test.ts`
    - 使用 fast-check v4.8.0 编写 Property 1-10 属性测试
    - 每个属性测试通过注释关联设计文档属性编号
    - 每个属性最少运行 100 次迭代
    - **Property 1**: determinePrivileges(true) → 全部会员特权
    - **Property 2**: determinePrivileges(false) → 默认特权
    - **Property 3**: calculateCreditsToDispatch 正确性
    - **Property 4**: extendEndDate 周期正确性
    - **Property 5**: 到期判定纯函数
    - **Property 6**: 积分发放账本一致性
    - **Property 7**: 订单过期判定
    - **Property 8**: 取消操作状态转换
    - **Property 9**: 回调结果映射
    - **Property 10**: 到期不扣积分
    - **Validates: Requirements 2.3, 2.4, 2.5, 3.3, 3.4, 4.3, 4.4, 5.1, 5.2, 5.3, 6.1, 6.3, 6.4, 7.1-7.5, 8.1, 8.2, 9.4, 9.5**

- [x] 15. Final Checkpoint - 全部测试通过
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- 所有积分操作复用现有 `withCreditLock` 分布式锁模式，保证跨进程安全
- Workers 复用现有 `lazyQueue` + `registerCommercializationSchedules` 模式
- 支付网关扩展在现有 `IPaymentGateway` 接口上新增方法，不破坏已有支付流程
- Prisma schema 新增模型不影响现有表结构
- 前端组件统一使用 shadcn/ui，与项目现有风格一致
- 属性测试使用 fast-check v4.8.0，纯函数可直接测试，带副作用函数需 mock Prisma/Redis

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "3.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.2", "3.3"] },
    { "id": 3, "tasks": ["5.1", "6.1"] },
    { "id": 4, "tasks": ["5.2", "5.3", "5.4", "5.5", "5.6", "5.7", "8.1"] },
    { "id": 5, "tasks": ["8.2", "8.3", "8.4"] },
    { "id": 6, "tasks": ["8.5", "9.1", "9.2", "9.3", "9.4", "9.5", "9.6", "9.7"] },
    { "id": 7, "tasks": ["11.1"] },
    { "id": 8, "tasks": ["12.1", "12.2", "12.3"] },
    { "id": 9, "tasks": ["13.1", "13.2", "13.3", "14.1"] }
  ]
}
```
