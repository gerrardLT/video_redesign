# Requirements Document

## Introduction

本平台同一套代码内并行运行两条产品线：①视频重塑平台（`/dashboard`，C 端 PC 端用户）；②本地生活营销平台（`/merchant`，本地实体门店商家，移动端）。产品的真实定位是：**本地生活营销平台是主框架，视频重塑是其下的一个能力模块**。

当前两条线在「订阅 / 计费」上各自建立了一套并行体系：

- 视频重塑使用「积分（Credit）」体系：`credit-service`（RESERVE / CHARGE / REFUND / TOPUP）+ `privilege-engine`（UserTier = FREE / MONTHLY / YEARLY）+ `SubscriptionPlan / SubscriptionRecord`（按 `plan.type` 解读为 monthly / yearly）。
- 本地生活自建了「额度（Quota）」体系：`merchant-quota-service`（`checkMerchantQuota` / `getMerchantTier`）+ `SUBSCRIPTION_TIERS`（FREE / BASIC / GROWTH / AGENCY 四档，按 `plan.name` 解读为 MerchantTier）。

本 Spec 的目标是**收敛计费体系**：废除本地生活自建的额度体系，让本地生活的所有可计费操作统一消费视频重塑既有的「积分」，会员权益统一由视频重塑既有的订阅体系（UserTier）管控。账号、登录已是共用体系，本 Spec 仅确认并沿用，不重建。

本 Spec **不修改视频重塑的生成逻辑**（解析、分组、生成、合并、Seedance、HappyHorse 等），不决定重塑引擎选型，不关心生成产物效果——这些由用户后续自行处理，属于本 Spec 范围之外。

## Glossary

- **Billing_System（计费系统）**：负责对用户操作进行积分冻结、扣费、退款与权益判定的统一系统，由本 Spec 收敛后唯一保留的计费实现。
- **Credit_Service（积分服务）**：现有 `src/lib/credit-service.ts`，提供 RESERVE（冻结）、CHARGE（扣费）、REFUND（退款）、TOPUP（充值）四类动作，所有积分写操作经 Redis 全局锁 `withCreditLock` 串行化。
- **Credit_Ledger（积分流水）**：现有 `credit_ledger` 表 / `CreditLedger` 模型，记录每一笔积分变动。含 `jobId`（外键 → `generation_jobs.id`，约束名 `credit_ledger_job_id_fkey`）、`orderId`、`projectId`（可空、无外键）、`subscriptionOrderId` 等关联字段。
- **Privilege_Engine（特权引擎）**：现有 `src/lib/privilege-engine.ts`，依据用户订阅确定 UserTier 及其特权（分辨率、水印、版本历史、并发、队列优先级）。
- **User_Tier（用户等级）**：现有 `UserTier` 枚举，取值 FREE / MONTHLY / YEARLY，由 `determineTier` 依据 `SubscriptionRecord.status` 与 `SubscriptionPlan.type`（monthly / yearly）判定。
- **Merchant_Quota_Service（商家额度服务，待废除）**：现有 `src/lib/merchant-quota-service.ts`，含 `checkMerchantQuota` / `getMerchantTier` / `MerchantTier`，本 Spec 将其废除。
- **Merchant_Tier（商家等级，待废除）**：现有 `SUBSCRIPTION_TIERS`（`src/constants/merchant.ts`）定义的 FREE / BASIC / GROWTH / AGENCY 四档，本 Spec 将其废除。
- **Merchant_Operation（商家操作）**：本地生活平台中可能产生资源消耗的操作，包括建店（CREATE_STORE）、内容计划生成（CREATE_CONTENT_PLAN）、视频渲染（RENDER_VIDEO）、视频导出（EXPORT_VIDEO）、数据洞察访问（ACCESS_INSIGHTS）。
- **Content_Brief（内容任务）**：现有 `ContentBrief` 模型，本地生活平台中一条内容生产任务，是商家渲染 / 导出的承载实体。
- **Store（门店）**：现有 `Store` 模型，归属于 `Merchant`。
- **Merchant（商家）**：现有 `Merchant` 模型，与 `User` 一对一关联（`userId` 唯一）。
- **Subscription_Record（订阅记录）**：现有 `SubscriptionRecord` 模型，两条产品线共用同一张表。
- **Privilege_Mapping（权益映射表）**：由本 Spec 定义的、从 User_Tier 到本地生活会员权益（导出分辨率、是否启用合规检测、是否开放数据洞察、门店数量上限、并发批量等）的映射关系。
- **Group_Cost_Formula（按组积分公式）**：现有 `estimateGroupCreditCost(groupDuration, resolution)`，按分镜组总时长与分辨率估算积分消耗。

## Requirements

### Requirement 1: 范围边界与共用基线确认

**User Story:** As a 平台维护者, I want 明确本次计费收敛的范围边界与共用现状基线, so that 改造不波及视频重塑生成链路，且不重复建设已共用的能力。

#### Acceptance Criteria

1. THE Billing_System SHALL 沿用现有共用的账号与登录体系（同一张 `User` 表、同一套 `/api/auth/*` 接口、同一个在 `middleware.ts` 注入 `x-user-id` 的 JWT 机制），不新建任何并行的账号或登录实现。
2. THE Billing_System SHALL 保持视频重塑的生成逻辑（解析、分组、生成、合并、Seedance、HappyHorse 等 Worker 与服务）不变，不修改其请求 / 响应结构。
3. WHERE 某项需求涉及视频重塑的生成产物效果、重塑引擎选型或「真实性 / 虚构」边界, THE Billing_System SHALL 将其视为本 Spec 范围之外，不在本 Spec 中定义。
4. THE Billing_System SHALL 将本地生活营销平台视为主框架、视频重塑视为其下的一个能力模块，二者共享同一套账号、积分与订阅体系。

### Requirement 2: 废除本地生活自建额度体系

**User Story:** As a 平台维护者, I want 移除本地生活自建的额度体系, so that 平台只保留一套计费实现，消除两套并行体系带来的不一致。

#### Acceptance Criteria

1. THE Billing_System SHALL 移除 `src/lib/merchant-quota-service.ts`（含 `checkMerchantQuota`、`getMerchantTier`、`MerchantTier` 类型）。
2. THE Billing_System SHALL 移除 `src/constants/merchant.ts` 中的 `SUBSCRIPTION_TIERS` 常量（FREE / BASIC / GROWTH / AGENCY 四档及其 quota 配置）。
3. WHEN 任一本地生活接口（建店、`/api/stores/[storeId]/content-plan/generate`、`/api/content-briefs/[briefId]/render`、`/api/video-variants/[variantId]/export`、数据洞察接口）原先调用 `checkMerchantQuota`, THE Billing_System SHALL 改为调用统一的 Credit_Service 与 Privilege_Engine，不再引用任何额度判定逻辑。
4. THE Billing_System SHALL 移除 `src/types/merchant.ts` 中仅服务于额度体系的类型（`QuotaAction`、`QuotaCheckResult`）在生产代码中的引用。
5. WHILE 额度体系被废除, THE Billing_System SHALL 保持 `Merchant`、`Store`、`ContentBrief`、`VideoVariant` 等业务实体模型不变（仅计费相关字段与逻辑调整）。

### Requirement 3: 商家操作统一按积分计费

**User Story:** As a 餐饮商家, I want 我的每一项消耗都按统一的积分结算, so that 我只需要关注一个积分余额，不必理解两套计费规则。

#### Acceptance Criteria

1. WHEN 商家发起视频渲染（RENDER_VIDEO）, THE Billing_System SHALL 按 Group_Cost_Formula 对该 Content_Brief 涉及的全部分镜组求和计算应扣积分，并在渲染入队前执行 RESERVE 冻结、渲染成功时执行 CHARGE 记账、渲染失败时执行 REFUND 退款。
2. WHEN 商家发起视频渲染且积分余额小于本次 RESERVE 所需积分, THE Billing_System SHALL 拒绝该请求并返回错误码 `INSUFFICIENT_CREDITS`（HTTP 402），同时返回所需积分与当前余额，不允许欠费、不允许扣至负数。
3. WHEN 商家发起内容计划生成（CREATE_CONTENT_PLAN）, THE Billing_System SHALL 按平台配置的固定积分单价 `CREDIT_COST_CONTENT_PLAN`（设计阶段确定，取值 ≥ 0）执行扣费，且当余额不足以支付该单价时拒绝请求并返回 `INSUFFICIENT_CREDITS`。
4. WHEN 商家创建门店（CREATE_STORE）, THE Billing_System SHALL 不扣减积分，门店数量改由 User_Tier 的 Privilege_Mapping 门店上限门控（见 Requirement 5）。
5. WHEN 商家导出视频（EXPORT_VIDEO）且导出包含超分处理, THE Billing_System SHALL 按现有导出超分计费公式执行 RESERVE / CHARGE / REFUND；WHEN 导出不包含超分处理, THE Billing_System SHALL 不额外扣减积分（与视频重塑「合并导出不扣、仅超分扣」一致）。
6. WHEN 商家访问数据洞察（ACCESS_INSIGHTS）, THE Billing_System SHALL 不按次扣减积分，是否可访问改由 User_Tier 的 Privilege_Mapping 门控（见 Requirement 5）。
7. THE Billing_System SHALL 反转此前「商家渲染只走额度不扣积分」的临时修法，统一后商家渲染按本需求第 1 条扣减积分。

### Requirement 4: 商家积分流水与商家实体关联

**User Story:** As a 平台维护者, I want 商家积分流水能正确挂账到商家实体, so that 商家操作记账不会因 `jobId` 外键约束而失败。

#### Acceptance Criteria

1. WHEN Billing_System 为商家操作写入 Credit_Ledger 记录, THE Billing_System SHALL NOT 写入 `jobId` 字段（因 `credit_ledger_job_id_fkey` 外键要求 `jobId` 必须指向已存在的 `generation_jobs.id`，而商家操作无对应 GenerationJob）。
2. WHEN Billing_System 为商家操作写入 Credit_Ledger 记录, THE Billing_System SHALL 通过一个可空、且不引用 `generation_jobs` 的关联字段（复用现有 `projectId`，或新增可空无外键字段如 `contentBriefId` / `storeId`）将该流水关联到对应商家实体。
3. WHERE 新增可空关联字段以承载商家实体关联, THE Billing_System SHALL 采用 additive-only 迁移（仅新增可空列与索引），不修改、不删除 Credit_Ledger 既有列与约束。
4. THE Billing_System SHALL 使用该商家实体关联字段作为 RESERVE / CHARGE / REFUND 的幂等键，确保同一商家操作的重试不重复冻结、不重复扣费、不重复退款。
5. WHEN 任一商家操作的积分写入提交, THE Billing_System SHALL 不触发任何外键约束违约（即不出现因 `jobId` 外键导致的写入失败）。

### Requirement 5: 会员权益从 Merchant_Tier 收敛到 User_Tier

**User Story:** As a 餐饮商家, I want 我的订阅权益由统一的会员等级决定, so that 我在两条产品线看到一致的会员身份与权益。

#### Acceptance Criteria

1. THE Billing_System SHALL 仅保留一种订阅解读方式：依据 `SubscriptionRecord.status` 与 `SubscriptionPlan.type` 经 `determineTier` 得到 User_Tier（FREE / MONTHLY / YEARLY），不再依据 `SubscriptionPlan.name` 解读 Merchant_Tier。
2. THE Billing_System SHALL 定义 Privilege_Mapping，将原 Merchant_Tier 权益（导出分辨率、是否启用合规检测、是否开放数据洞察、门店数量上限、批量并发）映射为 User_Tier 的权益项。
3. WHILE 用户为 FREE 等级, THE Billing_System SHALL 提供导出分辨率最高 720p、关闭数据洞察、门店数量上限为 Privilege_Mapping 中 FREE 定义的值。
4. WHILE 用户为 MONTHLY 或 YEARLY 等级, THE Billing_System SHALL 提供导出分辨率最高 1080p、开放数据洞察、门店数量上限为 Privilege_Mapping 中对应等级定义的值。
5. WHEN 商家创建门店且名下门店数量已达到其 User_Tier 在 Privilege_Mapping 中的门店上限, THE Billing_System SHALL 拒绝创建并返回升级提示，提示中包含当前门店数、上限值与可解除限制的最低等级。
6. WHEN 商家访问数据洞察且其 User_Tier 在 Privilege_Mapping 中未开放数据洞察, THE Billing_System SHALL 拒绝访问并返回升级提示。
7. WHERE 原 AGENCY 等级特有且无法用三档 User_Tier 表达的权益（如子账号、多达 20 门店、批量并发 10）, THE Billing_System SHALL 在设计文档中显式记录其归属的 User_Tier 取值或标注为本 Spec 范围之外的后续事项。

### Requirement 6: 失败补偿与退款幂等

**User Story:** As a 餐饮商家, I want 操作失败时被正确退还积分且不会重复退款, so that 我不会因系统重试而损失或多得积分。

#### Acceptance Criteria

1. IF 商家渲染或导出操作在 CHARGE 之前失败, THEN THE Billing_System SHALL 按该操作的商家实体关联键执行 REFUND，将已 RESERVE 的积分全额退还。
2. IF 某商家操作的 REFUND 已存在对应流水记录, THEN THE Billing_System SHALL 跳过本次退款（幂等），不重复增加余额。
3. WHEN Billing_System 执行任一商家操作的 RESERVE / CHARGE / REFUND, THE Billing_System SHALL 经 Redis 全局锁 `withCreditLock` 串行化执行该积分写操作。
4. FOR ALL 商家操作, 对同一关联键先 RESERVE 再 REFUND 后, 用户积分余额 SHALL 恢复到该操作发生前的数值（冻结—退款的往返一致性）。
5. IF 实际扣费额小于已冻结额, THEN THE Billing_System SHALL 在 CHARGE 时将多冻结部分以 REFUND 退回，使最终净扣减等于实际扣费额。

### Requirement 7: 存量数据迁移与兼容

**User Story:** As a 平台维护者, I want 既有商家数据在体系收敛后仍可正常工作, so that 上线收敛不影响已存在的商家、门店与内容任务。

#### Acceptance Criteria

1. THE Billing_System SHALL 在收敛后保持既有 `Merchant`、`Store`、`ContentBrief`、`VideoVariant` 记录可被正常读取与操作，不因废除额度体系而失效。
2. WHEN 一个既有商家在收敛前持有某 Merchant_Tier 订阅, THE Billing_System SHALL 依据其 `SubscriptionRecord` 与 `SubscriptionPlan.type` 重新解读为对应的 User_Tier 并据此判定权益。
3. THE Billing_System SHALL 对所有计费相关的数据库变更采用 additive-only 迁移（新增可空列、新增索引），不修改或删除视频重塑工作流正在使用的既有列、表与约束。
4. WHERE 既有商家曾按额度运行且无对应 Credit_Ledger 流水, THE Billing_System SHALL 不为历史操作补记积分流水，仅对收敛上线后的新操作按积分计费。

### Requirement 8: 主框架与模块的信息架构

**User Story:** As a 商家用户, I want 在统一的主框架下访问视频重塑能力, so that 视频重塑作为本地生活平台的一个模块而非完全隔离的孤岛。

#### Acceptance Criteria

1. THE Billing_System SHALL 重新评估本地生活既有需求中「`/merchant` 与 `/dashboard` 完全隔离、禁止从商家界面跳转到 dashboard」的约束（原 local-life-marketing-platform Requirement 15.5）。
2. WHILE 已登录用户访问平台, THE Billing_System SHALL 允许同一会话在本地生活主框架（`/merchant`）与视频重塑模块（`/dashboard`）之间导航而无需重新认证。
3. THE Billing_System SHALL 在本地生活主框架中提供进入视频重塑模块的导航入口，将视频重塑呈现为主框架下的一个能力模块。
4. WHERE 视频重塑模块的页面内部结构与交互, THE Billing_System SHALL 保持其现状不变，仅调整其在主框架中的导航归属。

### Requirement 9: 范围之外事项的显式声明

**User Story:** As a 平台维护者, I want 明确哪些事项不在本 Spec 范围, so that 后续工作边界清晰，避免误改重塑生成链路。

#### Acceptance Criteria

1. THE Billing_System SHALL 将视频重塑的生成逻辑（parse-video、grouping、generate-video、merge、Seedance、HappyHorse）排除在本 Spec 的修改范围之外。
2. THE Billing_System SHALL 将重塑引擎选型与生成产物效果排除在本 Spec 的决策范围之外。
3. THE Billing_System SHALL 将「真实性 / 虚构」内容边界排除在本 Spec 的范围之外。
4. WHERE 本 Spec 的需求与上述范围之外事项存在交叉, THE Billing_System SHALL 仅在计费与权益层面做调整，不改变生成行为本身。
