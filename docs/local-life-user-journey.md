# 本地生活 AI 营销平台 — 用户旅程 / 状态机 / 数据流 / 交互 / 功能模块

> **文档状态**：📗 活文档（持续维护，当前有效）
> **用途/说明**：商家平台用户旅程/状态机/数据流活文档，仓库权威现状文档之一
> **权威来源**：本仓库权威文档为 `AGENTS.md` + `docs/local-life-user-journey.md`
> **最后校准**：2026-07-11

> 依据：`docs/AI本地生活营销平台改造实施方案.md`（设计意图）
> 校准：对照仓库实际代码（`src/app/merchant`、`src/app/api`、`src/lib`、`src/workers`、`prisma/schema.prisma`）
> 范围：第一阶段餐饮 MVP；含「设计 vs 现状」差距标注
> 维护：本文档为活文档，随实现推进同步更新

---

## 0. 一句话定位

把"不会策划 / 不会拍 / 不会剪 / 不会写文案 / 不会持续运营"的餐饮商家，
通过 AI 接管为一条闭环：**问诊 → 门店画像 → 7 天内容日历 → 每日拍摄任务 → 素材上传质检 → 一键生成 3 版视频 → 文案+封面+字幕 → 合规检查 → 导出 → 数据回填 → 复盘反哺下一轮**。

核心理念（实施方案 §20）：不是给商家一个"视频编辑器"，而是让商家完成"今天的营销任务"。
核心对象由「项目驱动」转为「门店经营驱动」：`Store / ContentPlan / ContentBrief / ShotTask / VideoVariant / PublishMetric`。

---

## 1. 功能模块图

```mermaid
graph TB
  subgraph FE["前端 /merchant（商家移动端，极简）"]
    UI1[问诊入驻 onboarding]
    UI2[门店首页 stores/:id]
    UI3[周日历 calendar]
    UI4[今日任务 today]
    UI5[拍摄上传 shoot]
    UI6[成片导出 variants]
    UI7[数据复盘 metrics]
    UI8[门店设置 settings]
  end

  subgraph API["API 层（Next Route Handlers）"]
    A1[POST /api/merchant/onboarding]
    A2[POST /stores/:id/content-plan/generate]
    A2b[GET /stores/:id/content-plan/current]
    A3[GET /stores/:id/today]
    A4[POST /content-briefs/:id/assets]
    A5[POST /content-briefs/:id/render]
    A6[GET /content-briefs/:id/variants]
    A7[POST /content-briefs/:id/compliance/acknowledge]
    A8[GET/POST /content-briefs/:id/metrics + insights]
    A9[POST /video-variants/:id/export]
    A10[GET /api/merchant/subscription]
    A11[POST /api/stores 建店]
  end

  subgraph SVC["服务层 src/lib（业务内核）"]
    S1[store-profile-service 画像]
    S2[playbook-engine 剧本引擎]
    S3[content-calendar-service 日历]
    S4[capture-director 拍摄/质检]
    S5[local-render-service 渲染]
    S6[performance-learning-service 复盘]
    S7[compliance-service 合规]
    S8[content-entropy-service 同质化]
    S10[merchant-billing-service 计费封装]
    S11[playbook-engine.instantiate 文案/镜头实例化]
  end

  subgraph WK["BullMQ Workers"]
    W1[generate-store-profile]
    W2[generate-content-plan]
    W3[render-local-video]
    W4[compliance-review]
    W5[sync-metrics / weekly-merchant-report]
  end

  subgraph INFRA["复用底座"]
    I1[(PostgreSQL / Prisma)]
    I2[(Redis / BullMQ)]
    I3[OSS 对象存储]
    I4[FFmpeg]
    I5[Seedance 2.0]
    I6[credit-service 积分]
    I7[privilege-engine 权益]
    I8[distributed-lock 分布式锁]
    I9[progress-publisher SSE]
  end

  FE --> API --> SVC --> WK
  SVC --> INFRA
  WK --> INFRA
  S10 --> I6 & I7
```

---

## 2. 用户旅程图

```mermaid
journey
  title 餐饮商家：从入驻到复盘的完整旅程
  section 入驻（一次性）
    注册登录: 4: 商家
    填写门店问诊(3步): 3: 商家
    系统生成门店画像: 5: 系统
    系统生成7天内容日历: 5: 系统
  section 每日生产
    打开今日任务看"拍什么": 5: 商家
    按镜头指引拍摄: 3: 商家
    上传素材+即时质检: 4: 商家,系统
    一键生成3个版本: 5: 系统
  section 发布
    查看3版本+合规+文案: 4: 商家,系统
    选版本导出(24h签名下载): 5: 商家
    手动发布到平台: 2: 商家
  section 复盘
    回填播放/转化数据: 3: 商家
    系统给优化建议: 5: 系统
    反哺下一周计划: 5: 系统
```

### 2.1 路由路径（实际）

```text
/login
  → /merchant                                （Server Component 重定向）
      → 无商家：/merchant/onboarding
      → 有门店：/merchant/stores/{storeId}
          → /merchant/stores/{storeId}/calendar          周计划
          → /merchant/stores/{storeId}/today             今日任务
          → /merchant/stores/{storeId}/briefs/{briefId}/shoot     拍摄上传
          → /merchant/stores/{storeId}/briefs/{briefId}/variants  成片/合规/文案/导出
          → /merchant/stores/{storeId}/briefs/{briefId}/metrics   数据回填/复盘
          → /merchant/stores/{storeId}/settings          门店设置
      AI 视频重绘后端能力保留（/api/projects/*），Inhot 四模式通过创作中心接入
```

### 2.2 5 步线性主操作（实施方案 §20 / Req 15.4）

```text
看今日任务 → 拍 → 传 → 一键生成 → 导出/看效果
```

---

## 3. 状态机

### 3.1 ContentBrief 状态机（核心对象，ContentBriefStatus）

```mermaid
stateDiagram-v2
  [*] --> DRAFT: 日历生成 brief
  DRAFT --> READY_TO_SHOOT: 拍摄任务(ShotTask)就绪
  READY_TO_SHOOT --> MATERIALS_UPLOADED: 必拍镜头素材全部质检 ≥60
  MATERIALS_UPLOADED --> RENDERING: POST /render（RESERVE 冻结积分 + 入队）
  READY_TO_SHOOT --> RENDERING: 必拍齐全亦可直接触发
  RENDERING --> GENERATED: 3 版本渲染成功（CHARGE 实扣）
  RENDERING --> FAILED: 渲染失败 / 超时600s（REFUND 退款）
  FAILED --> RENDERING: 重试（幂等安全）
  GENERATED --> COMPLIANCE_REVIEW: 触发合规检查
  COMPLIANCE_REVIEW --> READY_TO_EXPORT: 风险 LOW/MEDIUM，或 HIGH 已确认
  COMPLIANCE_REVIEW --> GENERATED: 风险 BLOCKED（禁止导出）
  READY_TO_EXPORT --> EXPORTED: 导出成功（PublishJob=EXPORTED）
  EXPORTED --> PUBLISHED: 回填数据 / 标记已发布
  GENERATED --> ARCHIVED
  EXPORTED --> ARCHIVED
```

> 说明：实际渲染计费在 `local-render-service` 内完成——成功置 GENERATED 同事务 CHARGE（差额自动退回），失败置 FAILED 并幂等 REFUND。合规检查由 `render-local-video` worker 在生成后对每个 variant 调用 `compliance-service`。

### 3.2 ShotTask / RawAsset 质检状态

```mermaid
stateDiagram-v2
  [*] --> PENDING: 镜头任务创建
  PENDING --> 质检中: 上传素材(FFmpeg 抽元数据)
  质检中 --> CAPTURED: 评分≥60 且无致命问题(入库 RawAsset)
  质检中 --> PENDING: 评分<60（保留可重传）
  质检中 --> 拒收: <480p / <1s / >300MB（不入库）
  拒收 --> PENDING
  CAPTURED --> PENDING: 删除素材
```

质检维度（capture-director / Req 6.2）：竖屏 9:16、短边≥720p、时长达标、文件 1B~300MB、亮度>15、需口播则需音轨。

### 3.3 合规风险等级 → 导出门控（ComplianceRiskLevel）

```mermaid
stateDiagram-v2
  [*] --> LOW: 无问题(passed=true)
  [*] --> MEDIUM: 虚假火爆 / AIGC标识 / 同质化
  [*] --> HIGH: 绝对化用语 / 未授权出镜
  [*] --> BLOCKED: 命中阻断项
  LOW --> 允许导出
  MEDIUM --> 允许导出: 仅提示修改
  HIGH --> 允许导出: 需 acknowledge 显式确认
  BLOCKED --> 禁止导出: 返回 blockedReasons
```

### 3.4 PublishJob 状态（导出/发布任务）

```mermaid
stateDiagram-v2
  [*] --> DRAFT
  DRAFT --> READY: 校验通过待导出
  READY --> EXPORTING: 触发导出
  DRAFT --> EXPORTING: 直接触发导出
  EXPORTING --> EXPORTED: OSS 上传成功 + 24h 签名URL
  EXPORTING --> FAILED: OSS/FFmpeg 失败
  EXPORTED --> PUBLISHING: 接平台发布(后续阶段)
  PUBLISHING --> PUBLISHED
  PUBLISHING --> FAILED
  FAILED --> EXPORTING: 重试
```

---

## 4. 数据流转图

### 4.1 全链路数据流

```mermaid
flowchart LR
  subgraph 入驻链
    O[问诊表单] -->|单事务| M[(Merchant)]
    M --> ST[(Store)]
    ST --> OF[(ProductOffer)]
    ST -. 入队 .-> WPP[generate-store-profile]
    WPP --> SP[(StoreProfile 画像)]
    WPP -. 成功后入队 .-> WCP[generate-content-plan]
  end

  subgraph 计划链
    PB[(Playbook 12+ 餐饮剧本)] --> PE[playbook-engine 选剧本]
    SP --> PE
    OF --> PE
    WCP --> PE
    PE --> CAL[content-calendar-service]
    CAL --> CP[(ContentPlan)]
    CAL --> CB[(ContentBrief x7)]
    CAL --> SHT[(ShotTask 1-5/brief)]
  end

  subgraph 拍摄链
    UP[上传素材] --> FF[FFmpeg 元数据/缩略图]
    FF --> CD[capture-director 质检评分]
    CD --> RA[(RawAsset + qualityReport)]
    RA --> SHT
  end

  subgraph 生成链
    RND[POST /render] -->|RESERVE| CR[credit-service]
    RND --> WRV[render-local-video worker]
    WRV --> LOCK[distributed-lock 防重复]
    WRV --> LRS[local-render-service]
    SHT --> LRS
    RA --> LRS
    SEED[Seedance 补镜头] -. 素材不足时 .-> LRS
    LRS --> FF2[FFmpeg 合成+字幕+封面]
    FF2 --> OSS[(OSS 成片)]
    LRS --> VV[(VideoVariant x3)]
    WRV -->|成功 CHARGE / 失败 REFUND| CR
    VV --> COMP[compliance-service]
    ENT[content-entropy 同质化] --> COMP
    COMP --> CC[(ComplianceCheck)]
    LRS --> SSE[progress-publisher SSE]
  end

  subgraph 发布复盘链
    EXP[POST /export] -->|getMerchantPrivileges 分辨率| PRIV[privilege-engine]
    EXP --> FF3[FFmpeg 烧字幕重编码]
    FF3 --> OSS
    EXP --> PJ[(PublishJob EXPORTED)]
    PJ --> DL[24h 签名下载URL]
    MET[回填数据] --> PM[(PublishMetric)]
    PM --> PL[performance-learning-service]
    PL --> INS[建议 + 复用/规避剧本 + 下个目标]
    INS -. 反哺 .-> CAL
  end

  CB --> RND
  VV --> EXP
  CB --> MET
```

### 4.2 计费 / 权益横切（merchant-billing-unification 收敛后）

```mermaid
flowchart TB
  subgraph 权益
    Sub[GET /api/merchant/subscription] --> PRIV[privilege-engine：UserTier→权益]
    PRIV --> Map[exportResolution / insightsEnabled / maxStores / batchConcurrency]
  end
  subgraph 计费
    Bill[merchant-billing-service] --> CRBZ[credit-service *ByBizRef]
    CRBZ --> Ledger[(CreditLedger：jobId=null, bizRefType/bizRefId)]
  end
  Plan[内容计划生成] -->|固定 10 积分 RESERVE→CHARGE| Bill
  Render[视频渲染] -->|按分镜组时长 RESERVE→CHARGE/REFUND| Bill
  Export[导出含超分] -->|超分才扣，普通导出不扣| Bill
  Store[建店] -->|不扣费，maxStores 门控| PRIV
  Insight[数据洞察] -->|不扣费，insightsEnabled 门控| PRIV
```

要点：
- 会员权益统一由 `UserTier`（FREE/MONTHLY/YEARLY）映射，不再用旧的 Merchant_Tier（FREE/BASIC/GROWTH/AGENCY）。
- 所有商家积分流水 `jobId` 恒为 null，以 `(bizRefType, bizRefId)` 关联挂账并作幂等键，杜绝 `credit_ledger_job_id_fkey` 外键违约。
- 写积分全部经 `withCreditLock` 全局锁串行化。

---

## 5. 关键交互时序图

### 5.1 入驻 → 画像 → 日历

```mermaid
sequenceDiagram
  participant U as 商家
  participant FE as /merchant/onboarding
  participant API as POST /api/merchant/onboarding
  participant DB as Prisma/PG
  participant Q as BullMQ
  participant WP as generate-store-profile
  participant WC as generate-content-plan

  U->>FE: 填写 3 步表单（门店/产品卖点/优惠）
  FE->>API: 提交
  API->>DB: 单事务创建 Merchant + Store + ProductOffer
  API->>Q: 入队 generate-store-profile
  API-->>FE: 201 {storeId}
  FE->>U: 跳转 /merchant/stores/{storeId}
  Q->>WP: 生成画像（规则为主 + LLM 润色）
  WP->>DB: 写 StoreProfile
  WP->>Q: 入队 generate-content-plan（onboarding 路径，不计费）
  Q->>WC: 生成 7 天计划
  WC->>DB: 写 ContentPlan + 7×ContentBrief + ShotTask
```

### 5.2 上传 → 一键生成（含计费 / 锁 / SSE）

```mermaid
sequenceDiagram
  participant U as 商家
  participant FE as shoot 页
  participant UPA as POST /assets
  participant CD as capture-director
  participant RA as POST /render
  participant CS as credit-service
  participant W as render-local-video
  participant LR as local-render-service
  participant SSE as progress-publisher

  loop 每个镜头
    U->>UPA: 上传视频
    UPA->>CD: FFmpeg 质检评分
    CD-->>FE: qualityReport（≥60 通过；<480p/<1s/>300MB 拒收）
  end
  U->>RA: 必拍齐全 → 生成视频
  RA->>RA: estimateRenderCost（Σ 分镜组）
  RA->>CS: 余额预检 + reserveMerchantCredits(RESERVE)
  RA->>W: 入队 + brief=RENDERING
  W->>LR: 渲染 3 版本（FFmpeg；素材不足才 Seedance 补镜头）
  LR->>SSE: 进度事件
  SSE-->>FE: SSE 实时进度 %
  LR-->>W: 3×VideoVariant
  W->>CS: 成功→事务内 chargeMerchantCredits（多冻结差额退回）
  Note over W,CS: 失败→refundMerchantCredits + brief=FAILED，抛错由 BullMQ 重试
  W->>FE: brief=GENERATED（SSE 完成事件）
```

> SSE 实现：前端 `useSSEProgress` Hook 用原生 `EventSource` 连接**全局端点** `/api/sse/progress?token={briefId}`（EventSource 不支持自定义 header，鉴权 token 走 query param），而非每个 brief 独立的 `/render/stream`。Worker 经 `progress-publisher`（Redis Pub/Sub）发布进度，SSE 端点订阅后转推；断连超 10s 自动降级为 3-5s 高频轮询。

### 5.3 合规 → 导出 → 复盘

```mermaid
sequenceDiagram
  participant U as 商家
  participant V as variants 页
  participant EXP as POST /export
  participant PRIV as privilege-engine
  participant M as metrics 页
  participant PL as performance-learning

  U->>V: 查看 3 版本 + 合规徽章 + 四平台文案
  alt 合规 BLOCKED
    V-->>U: 禁用导出 + blockedReasons
  else 合规 HIGH
    U->>V: 确认风险（compliance/acknowledge）
  end
  U->>EXP: 导出选中版本
  EXP->>PRIV: getMerchantPrivileges → exportResolution（FREE 720p / 付费 1080p）
  EXP-->>U: 24h 签名下载 URL（PublishJob=EXPORTED）
  U->>M: 回填 播放/点赞/收藏/团购点击/订单/收入
  M->>PL: 异步触发表现学习
  PL-->>U: summary + suggestions + 复用/规避剧本 + recommendedNextGoals
```

### 5.4 导出 → 数据回填 → 复盘反哺

```mermaid
sequenceDiagram
  participant U as 商家
  participant FEv as /variants 页
  participant EX as POST /video-variants/:id/export
  participant CK as compliance/acknowledge
  participant FEm as /metrics 页
  participant MET as POST /content-briefs/:id/metrics
  participant INS as GET /content-briefs/:id/insights
  participant PLS as performance-learning-service

  U->>FEv: 预览 3 版 + 各平台文案
  alt 合规 BLOCKED
    FEv-->>U: 禁用导出 + 显示原因
  else 高风险需确认
    U->>CK: 确认风险（complianceCheckId）
  end
  U->>EX: 导出选中版本（超分才扣积分）
  EX-->>U: 24h 有效下载链接
  U->>U: 发布到抖音/小红书/视频号
  U->>FEm: 手动回填播放/点赞/转化数据
  FEm->>MET: 提交 PublishMetric
  FEm->>INS: 拉取优化建议（≥3 条数据触发）
  INS->>PLS: 分析历史表现 → 反哺下一轮 playbook
  PLS-->>FEm: 优化建议（选题/钩子/发布时间）
```

---

## 6. 设计 vs 现状差距清单

> 校准方式：逐一核对 `src/app/merchant` 实际页面文件 + 全站 `<Link>`/`router.push` 入口可达性。
> 原始结论：后端服务与 API 基本齐全，闭环「后半段」（成片导出→数据复盘）在前端无任何入口，等于断链。
> **更新（已全部修复）：成片导出 / 数据复盘 / Brief 详情 / 日历点击 / 门店画像展示 / 会员升级充值 / 首页拍摄入口 七处问题均已接通，闭环完整可达。**

### 6.1 功能模块可达性矩阵

| 功能模块 | 后端服务/API | 前端页面 | 入口可达 | 状态 |
|---|---|---|---|---|
| 问诊入驻 | onboarding API + generate-store-profile | `/merchant/onboarding` | ✅ stores 列表/空态均有入口 | 通 |
| 门店首页 | stores/:id 聚合 | `/merchant/stores/[storeId]` | ✅ 列表点击进入 | 通 |
| 周日历 | content-plan/current | `/calendar` | ✅ 首页多处「查看周计划」 | 通 |
| 今日任务 | stores/:id/today | `/today` | ✅ 底部导航 | 通 |
| 拍摄上传 | assets 上传 + capture-director 质检 | `/briefs/[briefId]/shoot` | ✅ today 页「开始拍摄」 | 通 |
| **成片导出** | variants + export API（齐全） | `/briefs/[briefId]/variants` | ✅ 总览页/首页/shoot 完成后均可达 | **已接通** |
| **数据复盘** | metrics + insights API（齐全） | `/briefs/[briefId]/metrics` | ✅ 总览页/首页/variants 导出后可达 | **已接通** |
| **Brief 详情** | content-briefs/:id（API 有） | `briefs/[briefId]/page.tsx` | ✅ 已新增页面，日历点击进入 | **已补齐** |
| 门店设置 | settings API | `/settings` | ✅ 底部导航 | 通 |
| 门店画像展示 | StoreProfile + `GET /stores/:id/profile` + `profile/regenerate` | `/settings` 内画像卡 | ✅ 设置页展示+重新生成 | **已接通** |
| 会员升级/积分充值 | subscriptions/plans·create + packages + orders（真实支付网关） | `/membership` | ✅ 设置页/首页会员卡入口 | **已接通** |

### 6.2 关键断点（按严重度排序，状态已更新）

1. ~~**成片导出页 `/variants` 是孤儿页**~~ ✅ **已修复**
   - 页面代码完整（SWR 拉 variants、导出、合规徽章、高风险确认全有）。
   - 现已接通：`shoot` 渲染完成后展示「查看成片并导出」CTA；brief 总览页「成片导出」卡；首页最佳视频卡「查看成片」按钮。

2. ~~**数据复盘页 `/metrics` 是孤儿页**~~ ✅ **已修复**
   - 现已接通：`/variants` 导出成功后「发布后来回填数据」卡；brief 总览页「数据复盘」卡；首页最佳视频卡「数据复盘」按钮。

3. ~~**Brief 详情页缺失 → 404**~~ ✅ **已修复**
   - 已新增 `briefs/[briefId]/page.tsx` 作为 brief 总览（任务进度 + 三个子页入口 shoot/variants/metrics，按状态门控）。

4. ~~**周日历项不可点击进 brief**~~ ✅ **已修复**
   - `calendar` 每个日卡已包 `<Link>` → brief 总览页。

5. ~~**门店画像（StoreProfile）前端零展示**~~ ✅ **已修复**
   - `settings` 页新增「AI 门店画像」卡：展示内容定位/推荐人设/视觉风格/钩子词/做与不做/违禁词/CTA + aiSummary，并提供「重新生成」（POST `/profile/regenerate`）。

6. ~~**会员升级 / 积分充值无页面**~~ ✅ **已修复**
   - 新增 `/membership` 页：会员套餐（`/api/subscriptions/plans` + `create`）与积分充值（`/api/packages` + `orders`）双 tab，对接真实微信 Native 扫码 / 支付宝跳转网关，支付由后端回调入账。
   - 入口：`settings` 页「会员与积分」卡 + 首页底部会员卡点击进入。

7. ~~**首页「开始拍摄」跳日历，逻辑别扭**~~ ✅ **已修复**
   - 今日任务卡「开始拍摄」改为直达当日 brief 的 `/shoot` 页。

### 6.3 接通断链实施进度

**已全部实施：**

1. ✅ 新增 `briefs/[briefId]/page.tsx` brief 总览页：任务信息 + 拍摄进度 + 三步入口卡，按状态门控子页可达性。解决原 404。
2. ✅ `shoot` 页：监听 SSE 完成事件刷新状态，渲染完成后展示「查看成片并导出」CTA → `/variants`。
3. ✅ `/variants` 页：导出成功后「发布后来回填数据」卡 → `/metrics`。
4. ✅ 入口补全：`calendar` 日卡 `<Link>` → 总览页；首页最佳视频卡「查看成片」「数据复盘」按钮。
5. ✅ `settings` 页新增「AI 门店画像」展示卡 + 重新生成。
6. ✅ 新增 `/membership` 会员与积分页（真实订阅/订单接口 + 真实支付网关），入口在 settings 卡 + 首页会员卡。
7. ✅ 首页「开始拍摄」改为直达当日 brief 的 `/shoot`。

> 验证：dev 编译通过，所有改动 `get_diagnostics` 干净；Playwright 实测——日历可点进总览页、总览页状态门控正确、`/membership` 真实拉取会员套餐（月卡¥30/季卡¥80/年卡¥249）与积分套餐（体验¥10/基础¥30/专业¥60/企业¥200）、settings 画像卡完整渲染真实画像数据。
>
> 计费安全：会员升级与积分充值全程走真实支付网关（微信 Native 扫码 / 支付宝跳转），到账由后端支付回调（`/api/payments/{channel}/subscription-callback`）处理，前端不直接改余额。
