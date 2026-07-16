# Requirements Document

> **文档状态**：✅ 已实现（当前生效）
> **对应实现**：`src/lib/shared/{subscription-service,credit-dispatcher,privilege-engine}.ts`、`src/workers/subscription-*.ts`、`/membership`
> **权威来源**：状态以 `AGENTS.md` + `docs/local-life-user-journey.md` 为准，冲突时以代码为准
> **最后校准**：2026-07-11

## Introduction

在现有积分包（Package + PackageOrder）一次性购买体系基础上，新增订阅制会员体系。通过月卡/年卡会员套餐提供每月自动到账积分与会员特权，建立持续付费粘性机制，降低用户流失率。订阅制与积分包并存，互不排斥；会员积分与购买积分合并计算，不区分来源。

## Glossary

- **Subscription_System**: 订阅制会员体系，管理会员套餐定义、订阅生命周期、积分发放与特权控制的系统模块
- **Subscription_Plan**: 会员套餐定义，包含月卡和年卡两种类型，定义价格、每月积分额度和附加权益
- **Subscription_Order**: 订阅订单，记录用户开通/续费订阅的支付信息与订单状态
- **Subscription_Record**: 用户订阅记录，记录当前订阅状态、有效期、续费方式等信息
- **Credit_Dispatcher**: 积分发放服务，负责在续费成功后按套餐定义向用户账户发放积分
- **Privilege_Engine**: 特权引擎，根据用户订阅状态动态决定其可用特权（优先队列、高分辨率、去水印、版本历史保留时长）
- **Payment_Gateway**: 支付网关，对接微信支付/支付宝的签约代扣（自动续费）和手动支付能力
- **Auto_Renewal**: 自动续费，通过微信/支付宝签约代扣协议实现的周期性扣款
- **Manual_Renewal**: 手动续费，用户主动发起的续费支付行为
- **Subscription_Dashboard**: 会员专享页面，展示当前订阅状态、剩余权益、续费入口的前端页面
- **Generation_Queue**: 生成队列，基于 BullMQ 实现的视频生成任务队列，支持 priority 参数控制任务优先级

## Requirements

### Requirement 1: 会员套餐定义与展示

**User Story:** As a 潜在会员用户, I want 查看可用的会员套餐及其权益详情, so that 我能了解订阅价值并做出购买决策

#### Acceptance Criteria

1. THE Subscription_System SHALL 提供月卡套餐（29.9元/月，每月到账500积分）和年卡套餐（249元/年，每月到账500积分，额外赠送总计1000积分奖励）
2. THE Subscription_Dashboard SHALL 展示每种套餐的价格、每月积分额度、附加权益列表和年卡相对月卡的折扣信息
3. THE Subscription_Dashboard SHALL 在套餐展示页标注会员特权：优先生成队列、1080p 分辨率、去水印、30天版本历史保留
4. WHILE 用户已订阅某套餐, THE Subscription_Dashboard SHALL 展示当前套餐名称、到期日期、已到账积分与剩余权益

### Requirement 2: 首次订阅开通

**User Story:** As a 普通用户, I want 选择并开通一个会员套餐, so that 我能立即获得会员积分和特权

#### Acceptance Criteria

1. WHEN 用户选择一个套餐并确认开通, THE Subscription_System SHALL 创建一笔 Subscription_Order 并调用 Payment_Gateway 发起支付
2. WHEN Payment_Gateway 返回支付成功回调, THE Subscription_System SHALL 创建 Subscription_Record 并将状态设为 ACTIVE
3. WHEN Subscription_Record 状态变为 ACTIVE, THE Credit_Dispatcher SHALL 立即向用户账户发放当月积分（月卡500积分，年卡500积分+按比例分摊的额外奖励积分）
4. WHEN Subscription_Record 状态变为 ACTIVE, THE Privilege_Engine SHALL 立即为用户启用全部会员特权
5. IF 支付超时（30分钟内未完成支付）, THEN THE Subscription_System SHALL 将 Subscription_Order 状态标记为 EXPIRED

### Requirement 3: 自动续费

**User Story:** As a 已订阅会员, I want 系统自动为我续费, so that 我无需手动操作即可持续享受会员权益

#### Acceptance Criteria

1. WHEN 用户首次开通订阅并选择自动续费, THE Payment_Gateway SHALL 与微信支付或支付宝完成签约代扣协议
2. WHEN 月卡订阅到期前3天, THE Subscription_System SHALL 通过签约代扣协议向 Payment_Gateway 发起扣款请求
3. WHEN 自动扣款成功, THE Subscription_System SHALL 将 Subscription_Record 有效期延长一个计费周期（月卡延长30天，年卡延长365天）
4. WHEN 自动扣款成功, THE Credit_Dispatcher SHALL 向用户账户发放当期积分
5. IF 自动扣款失败, THEN THE Subscription_System SHALL 在24小时后重试一次扣款
6. IF 重试扣款仍失败, THEN THE Subscription_System SHALL 向用户发送续费失败通知，并提示手动续费

### Requirement 4: 手动续费

**User Story:** As a 已订阅会员, I want 在自动续费关闭时手动续费, so that 我能在到期前主动延续会员权益

#### Acceptance Criteria

1. WHILE 用户订阅即将到期（剩余7天内）且未开启自动续费, THE Subscription_Dashboard SHALL 展示手动续费入口和到期提醒
2. WHEN 用户点击手动续费, THE Subscription_System SHALL 创建续费 Subscription_Order 并调用 Payment_Gateway 发起支付
3. WHEN 续费支付成功, THE Subscription_System SHALL 将 Subscription_Record 有效期延长一个计费周期
4. WHEN 续费支付成功, THE Credit_Dispatcher SHALL 向用户账户发放当期积分

### Requirement 5: 到期处理

**User Story:** As a 系统管理者, I want 会员到期后自动降级为普通用户, so that 只有付费会员才能享受会员特权

#### Acceptance Criteria

1. WHEN Subscription_Record 到达到期日期且未续费成功, THE Subscription_System SHALL 将 Subscription_Record 状态设为 EXPIRED
2. WHEN Subscription_Record 状态变为 EXPIRED, THE Privilege_Engine SHALL 立即撤销该用户的全部会员特权
3. WHEN Subscription_Record 状态变为 EXPIRED, THE Subscription_System SHALL 保留用户账户中的剩余积分余额，不做扣减
4. WHEN Subscription_Record 状态变为 EXPIRED, THE Subscription_Dashboard SHALL 展示"会员已到期"状态和重新订阅入口

### Requirement 6: 取消订阅

**User Story:** As a 已订阅会员, I want 取消自动续费, so that 到期后不再自动扣款但当期权益不受影响

#### Acceptance Criteria

1. WHEN 用户请求取消订阅, THE Subscription_System SHALL 将 Subscription_Record 的续费方式标记为 CANCELED
2. WHEN 订阅被标记为 CANCELED, THE Payment_Gateway SHALL 解除与微信支付或支付宝的签约代扣协议
3. WHILE Subscription_Record 状态为 CANCELED 且未到期, THE Privilege_Engine SHALL 继续为用户保留全部会员特权直到当期结束
4. WHEN 被取消的订阅到达到期日期, THE Subscription_System SHALL 将 Subscription_Record 状态设为 EXPIRED 并触发到期处理流程

### Requirement 7: 会员特权生效与差异化体验

**User Story:** As a 会员用户, I want 在使用系统时获得优先级与更高质量的服务体验, so that 我的付费得到实际价值回报

#### Acceptance Criteria

1. WHILE 用户 Subscription_Record 状态为 ACTIVE, THE Generation_Queue SHALL 将该用户的生成任务 priority 设为高优先级（priority=1，普通用户 priority=5）
2. WHILE 用户 Subscription_Record 状态为 ACTIVE, THE Subscription_System SHALL 允许该用户选择 1080p 分辨率生成视频
3. WHILE 用户 Subscription_Record 状态为 ACTIVE, THE Subscription_System SHALL 对该用户生成的视频不添加水印
4. WHILE 用户 Subscription_Record 状态为 ACTIVE, THE Subscription_System SHALL 为该用户保留30天的版本历史记录
5. WHILE 用户 Subscription_Record 状态为非 ACTIVE, THE Subscription_System SHALL 将版本历史保留期限恢复为默认7天

### Requirement 8: 积分到账与积分体系兼容

**User Story:** As a 会员用户, I want 会员积分与购买积分合并使用, so that 我无需关心积分来源即可正常消费

#### Acceptance Criteria

1. WHEN Credit_Dispatcher 发放会员积分, THE Subscription_System SHALL 在 CreditLedger 中记录一笔 action=SUBSCRIPTION_GRANT 的流水，关联对应的 Subscription_Order
2. WHEN Credit_Dispatcher 发放会员积分, THE Subscription_System SHALL 将积分直接累加到 User.creditBalance，与购买积分合并计算
3. THE Subscription_System SHALL 允许用户同时拥有有效订阅和通过积分包购买的额外积分
4. WHEN 用户消费积分, THE Subscription_System SHALL 从 User.creditBalance 统一扣减，不区分积分来源

### Requirement 9: 订阅支付对接（微信/支付宝签约代扣）

**User Story:** As a 中国区用户, I want 通过微信支付或支付宝完成订阅开通和自动续费, so that 我能使用熟悉的支付方式

#### Acceptance Criteria

1. WHEN 用户选择微信支付开通订阅, THE Payment_Gateway SHALL 调用微信支付签约代扣接口创建周期性扣款协议
2. WHEN 用户选择支付宝开通订阅, THE Payment_Gateway SHALL 调用支付宝周期扣款签约接口创建周期性扣款协议
3. WHEN Payment_Gateway 收到支付平台的签约成功回调, THE Subscription_System SHALL 记录签约协议编号并关联到 Subscription_Record
4. WHEN Payment_Gateway 收到支付平台的扣款结果回调, THE Subscription_System SHALL 根据扣款结果更新 Subscription_Order 状态
5. IF Payment_Gateway 接收到签约解除回调, THEN THE Subscription_System SHALL 将对应 Subscription_Record 的续费方式标记为 CANCELED

### Requirement 10: 会员管理页面

**User Story:** As a 会员用户, I want 在专属管理页面查看和管理我的订阅, so that 我能全面掌握自己的会员状态

#### Acceptance Criteria

1. THE Subscription_Dashboard SHALL 展示当前订阅套餐名称、状态（ACTIVE/CANCELED/EXPIRED）、到期日期
2. THE Subscription_Dashboard SHALL 展示当月已到账积分、累计到账积分
3. THE Subscription_Dashboard SHALL 展示当前生效的会员特权列表
4. THE Subscription_Dashboard SHALL 提供"取消订阅"操作入口和"切换套餐"操作入口
5. THE Subscription_Dashboard SHALL 展示订阅支付历史记录列表，包含每笔支付的金额、时间、状态
6. WHILE 用户无有效订阅, THE Subscription_Dashboard SHALL 展示套餐推荐与开通入口
