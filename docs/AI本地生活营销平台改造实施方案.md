# AI 开发实施说明书：将 AI 视频重绘 SaaS 改造成本地生活 AI 营销代运营平台

## 0. 项目背景

当前项目是一个 AI 视频重绘 SaaS 平台，核心流程是：

> 用户上传短视频 → AI 多模态解析为分镜脚本 → 用户编辑分镜 → Seedance 2.0 逐组生成新视频 → 合并导出。

当前技术栈：

- Next.js 15.5 App Router
- TypeScript strict mode
- React 19
- Tailwind CSS v4
- shadcn/ui
- Zustand 5
- SWR
- PostgreSQL 16
- Prisma 7.8
- BullMQ + Redis
- 阿里云 OSS
- FFmpeg
- yt-dlp
- Seedance 2.0
- qwen-vl-max / OpenAI 兼容多模态分析
- Flux
- WaveSpeed
- JWT + Cookie
- Zod v4
- Vitest + fast-check
- Docker + docker-compose

现在要进行产品转型。

不要推倒重来。保留现有视频解析、分镜、生成、合并、队列、积分、订阅、OSS、版本历史、并发控制能力，把上层业务从“爆款视频复刻工具”改造成：

> 面向本地生活实体门店的 AI 短视频营销代运营系统。

新系统要解决的问题是：

> 商家不会策划、不会拍、不会剪、不会写文案、不会持续运营。系统要帮商家完成从商家问诊、内容计划、拍摄任务、自动成片、发布文案、合规检查、数据复盘的完整闭环。

第一阶段只做餐饮行业 MVP。不要一开始做美容、美发、服装、健身等多行业。

---

# 1. 产品改造总目标

## 1.1 新定位

将产品从：

> AI 视频重绘 SaaS 平台

改造成：

> 本地生活商家的 AI 内容经营系统。

产品主路径：

```text
商家问诊
→ 生成门店画像
→ 生成本周内容日历
→ 每天给出拍摄任务
→ 商家按提示上传真实门店素材
→ AI 自动剪辑生成 3 个视频版本
→ AI 生成标题、封面、字幕、口播、发布文案
→ 合规检查
→ 导出或发布
→ 数据复盘
→ 反向优化下一轮内容计划
```

## 1.2 第一阶段 MVP 范围

第一阶段只实现餐饮本地生活场景。

重点行业：

```text
餐厅、小吃店、饮品店、咖啡店、烘焙店、夜宵店、火锅店、烧烤店、快餐店
```

MVP 不追求全平台自动发布，不追求完整代运营，不追求复杂 BI。

MVP 必须完成：

1. 商家问诊。
2. 门店画像。
3. 餐饮行业剧本库。
4. 7 天内容日历。
5. 当日拍摄任务。
6. 素材上传。
7. AI 自动生成 3 个视频版本。
8. 标题、封面、字幕、发布文案生成。
9. 基础合规检查。
10. 导出成片。
11. 手动录入或简单同步视频表现数据。
12. 根据表现生成下一步建议。

---

# 2. 旧系统能力复用策略

## 2.1 保留并复用的能力

保留当前这些模块：

```text
src/lib/video-analyzer.ts
src/lib/ffmpeg.ts
src/lib/storage.ts
src/lib/grouping-service.ts
src/lib/script-merger.ts
src/lib/credit-service.ts
src/lib/distributed-lock.ts
src/lib/concurrency-controller.ts
src/lib/generation-orchestrator.ts
src/lib/priority-scheduler.ts
src/lib/privilege-engine.ts
src/lib/group-gen-context.ts
src/lib/frame-continuity.ts
src/lib/transition-engine.ts
src/lib/version-history-service.ts
src/lib/asset-lifecycle-service.ts
src/lib/subscription-service.ts
src/lib/seedance.ts
src/lib/wavespeed.ts
src/lib/auth.ts
src/lib/db.ts
src/lib/redis.ts
src/lib/queue.ts
src/lib/progress-publisher.ts
src/lib/logger.ts
```

旧能力的新用途：

| 旧能力 | 新用途 |
|---|---|
| 视频解析 | 解析参考视频，提炼“爆款结构”，不是复制内容 |
| 分镜编辑 | 改造成“拍摄任务 + 素材槽位” |
| Seedance 生成 | 用于补镜头、数字人口播、氛围镜头、品牌片段 |
| FFmpeg | 自动剪辑、字幕、封面、转场、合并 |
| OSS | 存储门店素材、成片、封面、历史版本 |
| BullMQ | 内容计划生成、视频渲染、发布任务、数据同步 |
| 积分系统 | 改造成生成额度、视频条数、AI 秒数额度 |
| 订阅系统 | 改造成单店版、增长版、连锁版 |
| 版本历史 | 用于视频 A/B 版本和内容复用 |
| 资产生命周期 | 用于门店素材和顾客出镜素材过期清理 |

## 2.2 不要继续强化的旧交互

弱化或隐藏这些功能：

```text
上传爆款视频 → 一键复刻
复杂分镜参数编辑
高级 AI 视频重绘参数
创作者导向的批量组生成
纯 AI 生成整条视频
```

这些能力可以保留在高级模式或内部能力中，但 MVP 主界面不要暴露给普通商家。

商家主界面必须足够简单：

```text
今天拍什么？
怎么拍？
一键生成
导出/发布
看效果
```

---

# 3. 新业务架构

## 3.1 新核心模块

在 `src/lib/` 下新增：

```text
src/lib/merchant-profile-service.ts
src/lib/store-profile-service.ts
src/lib/local-offer-service.ts
src/lib/content-calendar-service.ts
src/lib/playbook-engine.ts
src/lib/capture-director.ts
src/lib/local-render-service.ts
src/lib/compliance-service.ts
src/lib/publish-copy-service.ts
src/lib/metrics-ingestor.ts
src/lib/performance-learning-service.ts
src/lib/content-entropy-service.ts
```

可选后续模块：

```text
src/lib/platform-publisher/douyin.ts
src/lib/platform-publisher/kuaishou.ts
src/lib/platform-publisher/xiaohongshu.ts
src/lib/platform-publisher/wechat-channels.ts
```

第一阶段如果没有真实平台发布接口，可以先只实现导出和发布文案，不要强行接全平台 API。

---

# 4. 数据模型改造

在 `prisma/schema.prisma` 中新增以下业务模型。

注意：字段命名可以根据当前项目已有 User、Project、Asset、Subscription 模型适当调整。不要破坏旧数据。优先新增模型和关联。

## 4.1 枚举

```prisma
enum MerchantIndustry {
  RESTAURANT
  DRINK
  BAKERY
  CAFE
  HOTPOT
  BBQ
  FAST_FOOD
  OTHER_LOCAL
}

enum ContentGoal {
  TRAFFIC
  PROMOTION
  NEW_PRODUCT
  TRUST_BUILDING
  BRAND_STORY
  CUSTOMER_TESTIMONIAL
  WEEKEND_BOOST
  REPEAT_PURCHASE
}

enum ContentBriefStatus {
  DRAFT
  READY_TO_SHOOT
  MATERIALS_UPLOADED
  RENDERING
  GENERATED
  COMPLIANCE_REVIEW
  READY_TO_EXPORT
  EXPORTED
  PUBLISHED
  FAILED
  ARCHIVED
}

enum ShotTaskType {
  STOREFRONT
  PRODUCT_CLOSEUP
  COOKING_PROCESS
  STAFF_ACTION
  CUSTOMER_REACTION
  OWNER_TALKING
  ENVIRONMENT
  OFFER_DISPLAY
  CTA_SCREEN
  AI_GENERATED_FILLER
}

enum VideoVariantType {
  PROMOTION
  ATMOSPHERE
  OWNER_TALKING
  TRUST
  PRODUCT
}

enum ComplianceRiskLevel {
  LOW
  MEDIUM
  HIGH
  BLOCKED
}

enum PublishPlatform {
  DOUYIN
  KUAISHOU
  XIAOHONGSHU
  WECHAT_CHANNELS
  MANUAL_EXPORT
}

enum PublishJobStatus {
  DRAFT
  READY
  EXPORTING
  EXPORTED
  PUBLISHING
  PUBLISHED
  FAILED
}
```

## 4.2 商家与门店

```prisma
model Merchant {
  id          String   @id @default(cuid())
  userId      String
  name        String
  contactName String?
  phone       String?
  industry    MerchantIndustry
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  stores      Store[]

  @@index([userId])
  @@index([industry])
}

model Store {
  id              String   @id @default(cuid())
  merchantId      String
  name            String
  industry        MerchantIndustry
  city            String?
  district        String?
  businessArea    String?
  address         String?
  avgTicket       Int?
  openingHours    String?
  phone           String?
  mainProducts    Json?
  mainSellingPoints Json?
  targetCustomers Json?
  brandTone       String?
  canShootKitchen Boolean @default(false)
  canShootStaff   Boolean @default(true)
  canShootCustomers Boolean @default(false)
  hasGroupBuying  Boolean @default(false)
  hasReservation  Boolean @default(false)
  notes           String?

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  merchant        Merchant @relation(fields: [merchantId], references: [id], onDelete: Cascade)
  profile         StoreProfile?
  offers          ProductOffer[]
  contentPlans    ContentPlan[]
  contentBriefs   ContentBrief[]
  rawAssets       RawAsset[]
  socialAccounts  SocialAccount[]

  @@index([merchantId])
  @@index([industry])
  @@index([city, district])
}
```

## 4.3 门店画像

```prisma
model StoreProfile {
  id                    String   @id @default(cuid())
  storeId               String   @unique
  contentPositioning    String?
  recommendedPersona    String?
  contentDos            Json?
  contentDonts          Json?
  visualStyle           String?
  hookKeywords          Json?
  forbiddenClaims       Json?
  preferredCta          Json?
  weeklyCadence         Json?
  aiSummary             String?

  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  store                 Store @relation(fields: [storeId], references: [id], onDelete: Cascade)
}
```

## 4.4 商品、套餐、优惠

```prisma
model ProductOffer {
  id              String   @id @default(cuid())
  storeId          String
  name            String
  description     String?
  originalPrice   Int?
  salePrice       Int?
  validFrom       DateTime?
  validTo         DateTime?
  sellingPoints   Json?
  usageRules      String?
  isActive        Boolean @default(true)

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  store           Store @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@index([storeId])
  @@index([isActive])
}
```

金额字段用分为单位。

---

## 4.5 行业剧本库

```prisma
model Playbook {
  id              String   @id @default(cuid())
  industry        MerchantIndustry
  name            String
  goal            ContentGoal
  description     String?
  structure       Json
  requiredShots   Json
  optionalShots   Json?
  hookTemplates   Json
  captionTemplates Json
  coverTitleTemplates Json
  ctaTemplates    Json
  complianceRules Json?
  scoreWeight     Json?
  isActive        Boolean @default(true)

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  contentBriefs   ContentBrief[]

  @@index([industry])
  @@index([goal])
  @@index([isActive])
}
```

`structure` 示例：

```json
[
  {
    "order": 1,
    "name": "3秒钩子",
    "purpose": "引起食欲或价格兴趣",
    "durationSec": 3
  },
  {
    "order": 2,
    "name": "产品特写",
    "purpose": "展示菜品卖点",
    "durationSec": 5
  },
  {
    "order": 3,
    "name": "制作过程",
    "purpose": "制造真实感和烟火气",
    "durationSec": 5
  },
  {
    "order": 4,
    "name": "套餐展示",
    "purpose": "促成购买",
    "durationSec": 4
  },
  {
    "order": 5,
    "name": "到店引导",
    "purpose": "引导定位、团购或私信",
    "durationSec": 3
  }
]
```

---

## 4.6 内容计划与内容任务

```prisma
model ContentPlan {
  id          String   @id @default(cuid())
  storeId     String
  title       String
  startDate   DateTime
  endDate     DateTime
  strategy    Json?
  status      String   @default("ACTIVE")

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  store       Store @relation(fields: [storeId], references: [id], onDelete: Cascade)
  briefs      ContentBrief[]

  @@index([storeId])
  @@index([startDate, endDate])
}
```

```prisma
model ContentBrief {
  id              String   @id @default(cuid())
  storeId          String
  contentPlanId    String?
  playbookId       String?
  title            String
  goal             ContentGoal
  scheduledDate    DateTime
  status           ContentBriefStatus @default(DRAFT)

  hook             String?
  mainMessage      String?
  offerId          String?
  suggestedCaption String?
  suggestedTitle   String?
  suggestedCoverTitle String?
  suggestedCta     String?
  platformCopies   Json?
  tags             Json?
  aiReasoning      String?

  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  store            Store @relation(fields: [storeId], references: [id], onDelete: Cascade)
  contentPlan      ContentPlan? @relation(fields: [contentPlanId], references: [id], onDelete: SetNull)
  playbook         Playbook? @relation(fields: [playbookId], references: [id], onDelete: SetNull)
  shotTasks        ShotTask[]
  videoVariants    VideoVariant[]
  publishJobs      PublishJob[]
  complianceChecks ComplianceCheck[]
  metrics          PublishMetric[]

  @@index([storeId])
  @@index([scheduledDate])
  @@index([status])
}
```

---

## 4.7 拍摄任务与素材

```prisma
model ShotTask {
  id              String   @id @default(cuid())
  contentBriefId  String
  order           Int
  type            ShotTaskType
  title           String
  instruction     String
  examplePrompt   String?
  durationSec     Int
  required        Boolean @default(true)
  framingGuide    Json?
  qualityRules    Json?
  status          String  @default("PENDING")

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  contentBrief    ContentBrief @relation(fields: [contentBriefId], references: [id], onDelete: Cascade)
  rawAssets       RawAsset[]

  @@index([contentBriefId])
  @@index([order])
}
```

```prisma
model RawAsset {
  id              String   @id @default(cuid())
  storeId          String
  shotTaskId       String?
  uploaderUserId   String?
  type            String
  ossKey          String
  url             String?
  filename        String?
  mimeType        String?
  sizeBytes       Int?
  durationSec     Float?
  width           Int?
  height          Int?
  thumbnailKey    String?
  qualityScore    Float?
  qualityReport   Json?
  expiresAt       DateTime?

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  store           Store @relation(fields: [storeId], references: [id], onDelete: Cascade)
  shotTask        ShotTask? @relation(fields: [shotTaskId], references: [id], onDelete: SetNull)

  @@index([storeId])
  @@index([shotTaskId])
}
```

---

## 4.8 视频版本

```prisma
model VideoVariant {
  id              String   @id @default(cuid())
  contentBriefId  String
  type            VideoVariantType
  title           String
  description     String?
  ossKey          String?
  coverOssKey     String?
  durationSec     Float?
  width           Int?
  height          Int?
  subtitles       Json?
  renderParams    Json?
  generationLog   Json?
  score           Float?
  isSelected      Boolean @default(false)

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  contentBrief    ContentBrief @relation(fields: [contentBriefId], references: [id], onDelete: Cascade)
  publishJobs     PublishJob[]

  @@index([contentBriefId])
  @@index([type])
}
```

---

## 4.9 发布账号、发布任务、数据指标

```prisma
model SocialAccount {
  id              String   @id @default(cuid())
  storeId          String
  platform        PublishPlatform
  accountName     String?
  externalUserId  String?
  accessToken     String?
  refreshToken    String?
  tokenExpiresAt  DateTime?
  isActive        Boolean @default(true)

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  store           Store @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@index([storeId])
  @@index([platform])
}
```

```prisma
model PublishJob {
  id              String   @id @default(cuid())
  contentBriefId  String
  videoVariantId  String?
  platform        PublishPlatform
  status          PublishJobStatus @default(DRAFT)
  title           String?
  caption         String?
  tags            Json?
  locationText    String?
  externalPostId  String?
  exportedOssKey  String?
  errorMessage    String?

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  publishedAt     DateTime?

  contentBrief    ContentBrief @relation(fields: [contentBriefId], references: [id], onDelete: Cascade)
  videoVariant    VideoVariant? @relation(fields: [videoVariantId], references: [id], onDelete: SetNull)

  @@index([contentBriefId])
  @@index([platform])
  @@index([status])
}
```

```prisma
model PublishMetric {
  id              String   @id @default(cuid())
  contentBriefId  String
  platform        PublishPlatform
  publishJobId    String?
  views           Int     @default(0)
  likes           Int     @default(0)
  comments        Int     @default(0)
  shares          Int     @default(0)
  saves           Int     @default(0)
  profileVisits   Int     @default(0)
  linkClicks      Int     @default(0)
  messages        Int     @default(0)
  orders          Int     @default(0)
  redemptions     Int     @default(0)
  revenueCents    Int     @default(0)
  source          String  @default("MANUAL")
  capturedAt      DateTime @default(now())

  createdAt       DateTime @default(now())

  contentBrief    ContentBrief @relation(fields: [contentBriefId], references: [id], onDelete: Cascade)

  @@index([contentBriefId])
  @@index([platform])
  @@index([capturedAt])
}
```

---

## 4.10 合规检查

```prisma
model ComplianceCheck {
  id              String   @id @default(cuid())
  contentBriefId  String
  videoVariantId  String?
  riskLevel       ComplianceRiskLevel
  issues          Json
  suggestions     Json?
  blockedReasons  Json?
  passed          Boolean @default(false)

  createdAt       DateTime @default(now())

  contentBrief    ContentBrief @relation(fields: [contentBriefId], references: [id], onDelete: Cascade)

  @@index([contentBriefId])
  @@index([riskLevel])
}
```

## 4.11 出镜授权

```prisma
model ConsentRecord {
  id              String   @id @default(cuid())
  storeId          String
  personName       String?
  personRole       String?
  consentType      String
  consentText      String
  assetOssKey      String?
  validFrom        DateTime @default(now())
  validTo          DateTime?
  createdAt        DateTime @default(now())

  @@index([storeId])
}
```

---

# 5. 页面改造

## 5.1 新页面结构

新增或改造 `src/app`：

```text
src/app/
├── merchant/
│   ├── onboarding/
│   │   └── page.tsx
│   ├── stores/
│   │   ├── page.tsx
│   │   └── [storeId]/
│   │       ├── page.tsx
│   │       ├── calendar/
│   │       │   └── page.tsx
│   │       ├── today/
│   │       │   └── page.tsx
│   │       ├── briefs/
│   │       │   └── [briefId]/
│   │       │       ├── page.tsx
│   │       │       ├── shoot/
│   │       │       │   └── page.tsx
│   │       │       ├── variants/
│   │       │       │   └── page.tsx
│   │       │       └── metrics/
│   │       │           └── page.tsx
│   │       └── settings/
│   │           └── page.tsx
```

保留旧的：

```text
src/app/dashboard
src/app/admin
src/app/help
src/app/showcase
```

但 dashboard 首页要改成门店经营视角。

---

## 5.2 商家首页

页面路径：

```text
/merchant/stores/[storeId]
```

展示：

```text
今日任务卡片
本周内容计划
待拍摄视频
待生成视频
已生成待导出视频
最近表现最好的视频
AI 建议
```

核心按钮：

```text
开始今日拍摄
生成本周计划
查看数据复盘
```

不要把旧的视频项目列表作为主入口。

---

## 5.3 今日拍摄页

页面路径：

```text
/merchant/stores/[storeId]/today
```

展示：

```text
今日主题
视频目标
推荐钩子
需要拍摄的镜头列表
每个镜头的拍摄说明
每个镜头的上传入口
素材质量检测结果
一键生成视频按钮
```

每个镜头卡片格式：

```text
镜头 1：拍门头
时长：3 秒
怎么拍：站在门口，从左往右平移，拍到招牌和门口人流
注意：不要晃动，不要逆光
示例：门头 + 招牌 + 路人经过
上传按钮
```

---

## 5.4 视频版本页

页面路径：

```text
/merchant/stores/[storeId]/briefs/[briefId]/variants
```

展示 3 个版本：

```text
促销引流版
氛围种草版
老板口播版
```

每个版本展示：

```text
视频预览
标题
封面标题
发布文案
标签
CTA
合规状态
导出按钮
设为主推按钮
```

---

## 5.5 数据复盘页

页面路径：

```text
/merchant/stores/[storeId]/briefs/[briefId]/metrics
```

第一阶段可以手动录入数据：

```text
播放量
点赞
评论
收藏
转发
私信
团购点击
订单
核销
收入
```

然后 AI 给出建议：

```text
这条内容适合复用
封面点击可能偏弱
下次建议突出价格
下次建议增加出餐过程镜头
建议周五再发一次相似结构
```

---

# 6. API 路由设计

在 `src/app/api` 下新增：

```text
src/app/api/merchant/onboarding/route.ts
src/app/api/stores/route.ts
src/app/api/stores/[storeId]/route.ts
src/app/api/stores/[storeId]/profile/route.ts
src/app/api/stores/[storeId]/offers/route.ts
src/app/api/stores/[storeId]/content-plan/generate/route.ts
src/app/api/stores/[storeId]/content-plan/current/route.ts
src/app/api/stores/[storeId]/today/route.ts
src/app/api/content-briefs/[briefId]/route.ts
src/app/api/content-briefs/[briefId]/shot-tasks/route.ts
src/app/api/content-briefs/[briefId]/assets/route.ts
src/app/api/content-briefs/[briefId]/render/route.ts
src/app/api/content-briefs/[briefId]/variants/route.ts
src/app/api/content-briefs/[briefId]/compliance/route.ts
src/app/api/content-briefs/[briefId]/publish-copy/route.ts
src/app/api/content-briefs/[briefId]/metrics/route.ts
src/app/api/video-variants/[variantId]/export/route.ts
```

---

## 6.1 商家问诊接口

```text
POST /api/merchant/onboarding
```

请求：

```ts
type MerchantOnboardingRequest = {
  merchantName: string;
  contactName?: string;
  phone?: string;
  store: {
    name: string;
    industry: "RESTAURANT" | "DRINK" | "BAKERY" | "CAFE" | "HOTPOT" | "BBQ" | "FAST_FOOD" | "OTHER_LOCAL";
    city?: string;
    district?: string;
    businessArea?: string;
    address?: string;
    avgTicket?: number;
    openingHours?: string;
    mainProducts: string[];
    mainSellingPoints: string[];
    targetCustomers?: string[];
    canShootKitchen?: boolean;
    canShootStaff?: boolean;
    canShootCustomers?: boolean;
    hasGroupBuying?: boolean;
    hasReservation?: boolean;
  };
  offers?: {
    name: string;
    description?: string;
    originalPrice?: number;
    salePrice?: number;
    sellingPoints?: string[];
    usageRules?: string;
  }[];
};
```

处理逻辑：

```text
1. 校验用户登录。
2. 创建 Merchant。
3. 创建 Store。
4. 创建 ProductOffer。
5. 调用 merchant-profile-service 生成 StoreProfile。
6. 调用 content-calendar-service 生成 7 天内容计划。
7. 返回 storeId、profile、todayBrief。
```

---

## 6.2 生成内容计划接口

```text
POST /api/stores/[storeId]/content-plan/generate
```

请求：

```ts
type GenerateContentPlanRequest = {
  days?: number; // 默认 7
  startDate?: string;
  goals?: ContentGoal[];
};
```

处理逻辑：

```text
1. 读取 Store、StoreProfile、ProductOffer。
2. 读取餐饮行业 Playbook。
3. 生成 7 天 ContentPlan。
4. 每天生成一个 ContentBrief。
5. 每个 ContentBrief 生成 ShotTask。
6. 返回完整计划。
```

---

## 6.3 今日任务接口

```text
GET /api/stores/[storeId]/today
```

返回：

```ts
type TodayResponse = {
  store: Store;
  brief: ContentBrief;
  shotTasks: ShotTask[];
  uploadedAssets: RawAsset[];
  progress: {
    requiredShotCount: number;
    uploadedRequiredShotCount: number;
    readyToRender: boolean;
  };
};
```

---

## 6.4 上传素材接口

```text
POST /api/content-briefs/[briefId]/assets
```

使用现有 OSS 上传逻辑。

处理逻辑：

```text
1. 校验 brief 属于当前用户。
2. 校验 shotTaskId。
3. 上传到 OSS。
4. 用 FFmpeg 抽取 metadata 和缩略图。
5. 调用 capture-director 做基础质量评分。
6. 创建 RawAsset。
7. 更新 ShotTask 状态。
8. 如果必拍镜头都已上传，更新 brief.status = MATERIALS_UPLOADED。
```

素材质量评分维度：

```text
是否竖屏
是否低于 720p
时长是否过短
画面是否过暗
是否过度抖动
是否无声音，若该镜头需要口播
```

不要第一阶段做复杂 CV。可以先用 FFmpeg metadata + 简单规则。

---

## 6.5 视频生成接口

```text
POST /api/content-briefs/[briefId]/render
```

处理逻辑：

```text
1. 校验用户权限。
2. 校验素材是否满足最低要求。
3. 扣除额度或冻结额度。
4. 创建 BullMQ Job：render-local-video。
5. brief.status = RENDERING。
6. 返回 jobId。
```

---

## 6.6 获取视频版本接口

```text
GET /api/content-briefs/[briefId]/variants
```

返回所有生成的视频版本。

---

## 6.7 合规检查接口

```text
POST /api/content-briefs/[briefId]/compliance
```

处理逻辑：

```text
1. 检查文案是否包含绝对化用语。
2. 检查是否涉及虚假承诺。
3. 检查是否有顾客出镜但没有授权记录。
4. 检查是否过度同质化。
5. 检查是否需要 AIGC 标识。
6. 生成 ComplianceCheck。
7. 高风险则禁止导出或发布。
```

---

## 6.8 数据录入接口

```text
POST /api/content-briefs/[briefId]/metrics
```

请求：

```ts
type MetricsInput = {
  platform: PublishPlatform;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  profileVisits?: number;
  linkClicks?: number;
  messages?: number;
  orders?: number;
  redemptions?: number;
  revenueCents?: number;
};
```

处理逻辑：

```text
1. 保存 PublishMetric。
2. 调用 performance-learning-service。
3. 生成下一步建议。
```

---

# 7. 新服务层实现要求

## 7.1 merchant-profile-service.ts

职责：

```text
根据商家问诊信息生成门店画像。
```

导出函数：

```ts
export async function createStoreProfile(input: {
  storeId: string;
  industry: MerchantIndustry;
  mainProducts: string[];
  mainSellingPoints: string[];
  targetCustomers?: string[];
  avgTicket?: number;
  hasGroupBuying?: boolean;
  canShootKitchen?: boolean;
  canShootStaff?: boolean;
  canShootCustomers?: boolean;
}): Promise<StoreProfile>
```

生成内容：

```text
门店内容定位
推荐人设
内容风格
适合拍什么
不适合拍什么
常用钩子关键词
禁用夸大表达
推荐 CTA
每周发布节奏
```

第一阶段可以规则 + LLM 混合。

不要完全依赖 LLM。规则优先，LLM 用于润色。

---

## 7.2 playbook-engine.ts

职责：

```text
根据行业、目标、门店画像选择合适剧本。
```

导出函数：

```ts
export async function selectPlaybooks(input: {
  industry: MerchantIndustry;
  goals: ContentGoal[];
  storeProfile: StoreProfile;
  offers: ProductOffer[];
  days: number;
}): Promise<Playbook[]>
```

```ts
export async function instantiatePlaybook(input: {
  playbook: Playbook;
  store: Store;
  profile: StoreProfile;
  offer?: ProductOffer;
  scheduledDate: Date;
}): Promise<{
  title: string;
  goal: ContentGoal;
  hook: string;
  mainMessage: string;
  suggestedTitle: string;
  suggestedCoverTitle: string;
  suggestedCaption: string;
  suggestedCta: string;
  platformCopies: Record<string, string>;
  tags: string[];
  shotTasks: Array<{
    order: number;
    type: ShotTaskType;
    title: string;
    instruction: string;
    durationSec: number;
    required: boolean;
    framingGuide?: unknown;
    qualityRules?: unknown;
  }>;
}>
```

剧本库种子数据放到：

```text
prisma/seed.ts
```

或者：

```text
src/constants/playbooks/restaurant.ts
```

然后 seed 到数据库。

第一阶段至少内置 12 个餐饮剧本：

```text
1. 招牌菜食欲特写
2. 19.9/29.9 引流套餐
3. 老板推荐今日必点
4. 后厨烟火气
5. 周末聚餐推荐
6. 午市快餐引流
7. 夜宵场景种草
8. 新品上新
9. 老顾客都点什么
10. 门店环境氛围
11. 店员/厨师专业背书
12. 限时优惠倒计时
```

---

## 7.3 content-calendar-service.ts

职责：

```text
生成 7 天内容计划。
```

导出函数：

```ts
export async function generateContentPlan(input: {
  storeId: string;
  startDate: Date;
  days: number;
  preferredGoals?: ContentGoal[];
}): Promise<ContentPlan>
```

逻辑：

```text
1. 读取 Store。
2. 读取 StoreProfile。
3. 读取 active ProductOffer。
4. 读取 Playbook。
5. 生成 7 天计划。
6. 每天生成 ContentBrief。
7. 每个 brief 生成 ShotTask。
```

7 天默认节奏：

```text
周一：低价引流 / 工作日午餐
周二：招牌产品 / 制作过程
周三：老板/厨师人设
周四：门店环境 / 体验感
周五：周末聚餐预热
周六：爆品/套餐强促销
周日：复购/家庭/朋友聚餐场景
```

不要让商家看到复杂策略，只展示每天主题。

---

## 7.4 capture-director.ts

职责：

```text
生成拍摄任务，检查素材质量。
```

导出函数：

```ts
export function buildShotTasksFromPlaybook(...): ShotTaskDraft[]
```

```ts
export async function inspectRawAsset(input: {
  ossKey: string;
  mimeType: string;
  shotTask: ShotTask;
}): Promise<{
  qualityScore: number;
  qualityReport: {
    isVertical?: boolean;
    durationOk?: boolean;
    resolutionOk?: boolean;
    tooDark?: boolean;
    tooShaky?: boolean;
    hasAudio?: boolean;
    warnings: string[];
  };
}>
```

第一阶段的质量检测可以简单：

```text
竖屏 9:16 加分
720p 以上加分
时长达到要求加分
文件大小异常扣分
需要口播但无音轨扣分
```

---

## 7.5 local-render-service.ts

职责：

```text
把商家素材、剧本、文案、字幕、BGM、封面组合成 3 个视频版本。
```

导出函数：

```ts
export async function renderLocalVideoVariants(input: {
  contentBriefId: string;
}): Promise<VideoVariant[]>
```

生成 3 个版本：

```text
PROMOTION：促销引流版
ATMOSPHERE：氛围种草版
OWNER_TALKING：老板口播版
```

优先使用真实素材。

只有在素材不足时，才调用 Seedance 生成补充镜头。

渲染策略：

```text
1. 读取 ContentBrief。
2. 读取 ShotTask 和 RawAsset。
3. 根据 VariantType 选择素材顺序。
4. 生成字幕。
5. 生成封面标题。
6. 用 FFmpeg 合成视频。
7. 保存到 OSS。
8. 创建 VideoVariant。
```

不要在第一阶段做复杂卡点、复杂 BGM 版权库。可以先做：

```text
无 BGM
或使用项目内置免版权 BGM
或仅生成 BGM 建议，不自动内置
```

---

## 7.6 publish-copy-service.ts

职责：

```text
根据视频版本生成不同平台的发布文案。
```

导出函数：

```ts
export async function generatePublishCopy(input: {
  contentBriefId: string;
  variantType: VideoVariantType;
  platforms: PublishPlatform[];
}): Promise<Record<PublishPlatform, {
  title: string;
  caption: string;
  tags: string[];
  cta: string;
}>>
```

文案要求：

```text
抖音：短、直接、带同城、带套餐或到店 CTA
小红书：体验感、种草感、避免硬广
视频号：偏熟人推荐、简洁可信
快手：接地气、价格利益点明确
```

第一阶段可以只生成，不自动发布。

---

## 7.7 compliance-service.ts

职责：

```text
合规检查。
```

导出函数：

```ts
export async function runComplianceCheck(input: {
  contentBriefId: string;
  videoVariantId?: string;
}): Promise<ComplianceCheck>
```

检查规则：

```text
1. 禁止绝对化表达：
   最好、第一、全网最低、唯一、必吃、不吃后悔、保证、包治、永久、100%
2. 禁止虚假火爆：
   全城都在排队、每天卖爆、全网疯抢
   除非商家提供证据，否则提示风险
3. 禁止伪造顾客评价：
   顾客说、全网好评、真实顾客反馈
   如果没有顾客素材或授权，提示风险
4. 顾客出镜风险：
   如果素材包含顾客镜头且 canShootCustomers=false，提示中高风险
5. AIGC 风险：
   如果视频中包含 Seedance 生成镜头，标记需要 AIGC 声明
6. 同质化风险：
   调用 content-entropy-service 检查与历史视频相似度
```

风险等级：

```text
LOW：允许导出
MEDIUM：允许导出，但提示修改
HIGH：不建议发布，需要用户确认
BLOCKED：禁止导出或发布
```

---

## 7.8 content-entropy-service.ts

职责：

```text
避免批量同质化视频。
```

导出函数：

```ts
export async function calculateContentEntropy(input: {
  contentBriefId: string;
  videoVariantId?: string;
}): Promise<{
  score: number;
  duplicateRisk: "LOW" | "MEDIUM" | "HIGH";
  reasons: string[];
}>
```

第一阶段可以用简单规则：

```text
同一 playbook 连续使用超过 3 次，扣分
标题与历史标题相似度过高，扣分
文案与历史文案相似度过高，扣分
镜头顺序完全一致，扣分
使用完全相同素材，扣分
```

不需要一开始做复杂向量数据库。可以先用字符串相似度和规则。

---

## 7.9 metrics-ingestor.ts

职责：

```text
保存视频表现数据。
```

导出函数：

```ts
export async function recordManualMetrics(input: {
  contentBriefId: string;
  platform: PublishPlatform;
  metrics: {
    views?: number;
    likes?: number;
    comments?: number;
    shares?: number;
    saves?: number;
    linkClicks?: number;
    messages?: number;
    orders?: number;
    redemptions?: number;
    revenueCents?: number;
  };
}): Promise<PublishMetric>
```

---

## 7.10 performance-learning-service.ts

职责：

```text
根据视频数据生成下一步建议。
```

导出函数：

```ts
export async function generatePerformanceInsights(input: {
  storeId: string;
  contentBriefId?: string;
}): Promise<{
  summary: string;
  suggestions: string[];
  recommendedNextGoals: ContentGoal[];
  playbooksToReuse: string[];
  playbooksToAvoid: string[];
}>
```

第一阶段规则：

```text
播放高但转化低：下次强化 CTA 和优惠表达
播放低但转化高：内容吸引面窄，但用户精准，可继续做同类
点赞高收藏高：适合种草类复用
评论高：适合做二创回应
团购点击高：复用标题和优惠结构
连续低播放：换开头钩子和封面
```

---

# 8. Worker 改造

新增 Worker：

```text
src/workers/generate-content-plan.ts
src/workers/render-local-video.ts
src/workers/compliance-review.ts
src/workers/sync-metrics.ts
src/workers/weekly-merchant-report.ts
```

在 `src/workers/index.ts` 中注册。

---

## 8.1 render-local-video worker

任务名：

```text
render-local-video
```

输入：

```ts
type RenderLocalVideoJob = {
  contentBriefId: string;
  userId: string;
};
```

流程：

```text
1. 获取分布式锁，防止重复生成。
2. 校验 brief.status = MATERIALS_UPLOADED 或 READY_TO_SHOOT。
3. 冻结或扣除额度。
4. 调用 local-render-service 生成 3 个版本。
5. 调用 compliance-service 分别检查。
6. brief.status = GENERATED 或 READY_TO_EXPORT。
7. 发布进度事件。
8. 失败则退款或释放额度。
```

复用现有：

```text
generation-orchestrator
credit-service
distributed-lock
progress-publisher
logger
```

---

# 9. 前端组件新增

新增组件：

```text
src/components/merchant/
├── MerchantOnboardingForm.tsx
├── StoreProfileCard.tsx
├── TodayTaskCard.tsx
├── WeeklyCalendar.tsx
├── ContentBriefCard.tsx
├── ShotTaskCard.tsx
├── ShotAssetUploader.tsx
├── RenderProgressPanel.tsx
├── VideoVariantCard.tsx
├── PublishCopyPanel.tsx
├── ComplianceBadge.tsx
├── MetricsInputForm.tsx
└── PerformanceInsightCard.tsx
```

## 9.1 MerchantOnboardingForm

字段：

```text
店名
行业
城市
商圈
客单价
主打产品
主打卖点
目标顾客
是否能拍后厨
是否能拍员工
是否能拍顾客
是否有团购
当前优惠
```

提交后跳转：

```text
/merchant/stores/[storeId]/today
```

---

## 9.2 ShotTaskCard

必须极简。

显示：

```text
镜头名称
拍摄时长
怎么拍
注意事项
上传按钮
素材状态
质量提示
```

不要显示底层分镜 JSON。

---

## 9.3 VideoVariantCard

显示：

```text
视频预览
版本类型
标题
封面标题
发布文案
合规状态
导出按钮
```

---

# 10. 状态管理

新增 Zustand store：

```text
src/stores/merchant-store.ts
src/stores/content-brief-store.ts
src/stores/render-progress-store.ts
```

`merchant-store.ts`：

```ts
type MerchantState = {
  currentStoreId?: string;
  stores: Store[];
  setCurrentStoreId: (id: string) => void;
  setStores: (stores: Store[]) => void;
};
```

`content-brief-store.ts`：

```ts
type ContentBriefState = {
  todayBrief?: ContentBrief;
  shotTasks: ShotTask[];
  variants: VideoVariant[];
  setTodayBrief: (brief: ContentBrief) => void;
  setShotTasks: (tasks: ShotTask[]) => void;
  setVariants: (variants: VideoVariant[]) => void;
};
```

---

# 11. 权限与订阅改造

当前系统有积分和订阅。

改造为：

```text
免费体验版：
- 1 个门店
- 7 天内容计划
- 3 条草稿生成
- 不支持批量导出
- 不支持数据复盘高级建议

单店基础版：
- 1 个门店
- 每月 30 条视频
- 基础剧本库
- 基础数据复盘

单店增长版：
- 1 个门店
- 每月 100 条视频
- 多版本生成
- 高级剧本库
- 数据复盘
- 合规检查

服务商版：
- 多门店
- 子账号
- 多门店内容日历
- 批量生成
- 汇总报表
```

第一阶段代码中只需要预留 plan key：

```ts
type PlanKey = "FREE" | "BASIC" | "GROWTH" | "AGENCY";
```

额度检查新增：

```ts
canCreateStore
canGenerateContentPlan
canRenderVideoVariant
canExportVideo
canAccessMetricsInsight
```

---

# 12. Seed 数据：餐饮剧本库

在 `prisma/seed.ts` 中初始化至少 12 个 Playbook。

示例：

```ts
const restaurantPlaybooks = [
  {
    industry: "RESTAURANT",
    name: "招牌菜食欲特写",
    goal: "NEW_PRODUCT",
    description: "通过近景、热气、拉丝、翻炒等画面制造食欲。",
    structure: [
      { order: 1, name: "开头钩子", durationSec: 3 },
      { order: 2, name: "菜品近景", durationSec: 5 },
      { order: 3, name: "制作过程", durationSec: 5 },
      { order: 4, name: "成品展示", durationSec: 4 },
      { order: 5, name: "到店引导", durationSec: 3 }
    ],
    requiredShots: [
      {
        type: "PRODUCT_CLOSEUP",
        title: "拍招牌菜近景",
        instruction: "靠近菜品，拍到热气、色泽和细节，保持 3 到 5 秒稳定画面。",
        durationSec: 5
      },
      {
        type: "COOKING_PROCESS",
        title: "拍制作过程",
        instruction: "拍出锅、翻炒、浇汁、切开、拉丝等最有食欲的瞬间。",
        durationSec: 5
      },
      {
        type: "OFFER_DISPLAY",
        title: "拍套餐或价格信息",
        instruction: "拍清楚套餐内容、菜品组合或优惠价格，不要虚假夸大。",
        durationSec: 3
      }
    ],
    hookTemplates: [
      "这道菜刚端上桌，隔壁都在看",
      "来{businessArea}不知道吃什么，可以试试这个",
      "{salePrice}元吃到这一桌，适合下班直接来"
    ],
    captionTemplates: [
      "{storeName}今日推荐：{productName}，适合朋友聚餐和下班来吃。",
      "在{businessArea}附近的朋友，可以收藏这家。"
    ],
    coverTitleTemplates: [
      "{businessArea}这口太香了",
      "{salePrice}元吃这一桌",
      "下班就想吃这个"
    ],
    ctaTemplates: [
      "想吃可以点定位过来",
      "团购在主页/左下角",
      "附近的朋友可以先收藏"
    ]
  }
];
```

注意变量替换：

```text
{storeName}
{businessArea}
{productName}
{salePrice}
{avgTicket}
{city}
{district}
```

---

# 13. 渲染策略细节

第一阶段不要过度依赖 Seedance。

视频生成优先级：

```text
真实素材剪辑 > 真实素材 + AI 补文案/字幕/封面 > AI 补镜头 > 纯 AI 视频
```

默认生成 15～25 秒竖屏视频。

FFmpeg 合成规则：

```text
分辨率：1080x1920
帧率：30fps
格式：mp4
视频编码：h264
音频编码：aac
字幕：烧录字幕
封面：从最佳帧截取 + 标题文字
```

字幕样式：

```text
大字
短句
每行不超过 12 个中文
重点词可以加粗，但第一阶段不需要复杂特效
```

---

# 14. 合规要求

任何 AI 生成镜头、数字人口播、虚拟场景都要在系统中记录：

```text
isAiGenerated = true
generationProvider = "Seedance 2.0" | "Flux" | ...
generationPrompt
createdAt
```

如果视频使用了 AI 生成画面，发布前显示提示：

```text
该视频包含 AI 生成内容，请根据发布平台要求添加 AI 生成声明或标识。
```

禁止自动生成这些表达：

```text
全网最低
全国第一
最好吃
必吃
不吃后悔
保证有效
100%满意
包治
永久
唯一
全城都在排队
每天卖爆
```

`compliance-service.ts` 中维护一个 `FORBIDDEN_CLAIMS` 数组。

---

# 15. 实施顺序

严格按以下顺序实施，不要跳步。

## 阶段 1：数据库与种子数据

1. 新增 Prisma models。
2. 新增 enums。
3. 执行迁移。
4. 写餐饮 Playbook seed。
5. 确保旧项目数据不受影响。

完成标准：

```text
pnpm prisma generate
pnpm prisma migrate dev
pnpm prisma db seed
pnpm test
```

---

## 阶段 2：服务层

实现：

```text
merchant-profile-service.ts
playbook-engine.ts
content-calendar-service.ts
capture-director.ts
compliance-service.ts
content-entropy-service.ts
publish-copy-service.ts
metrics-ingestor.ts
performance-learning-service.ts
```

完成标准：

```text
每个 service 有基本单元测试
餐饮门店可以生成 7 天内容计划
每个 ContentBrief 至少有 3 个 ShotTask
```

---

## 阶段 3：API

实现核心 API：

```text
POST /api/merchant/onboarding
GET /api/stores/[storeId]/today
POST /api/stores/[storeId]/content-plan/generate
POST /api/content-briefs/[briefId]/assets
POST /api/content-briefs/[briefId]/render
GET /api/content-briefs/[briefId]/variants
POST /api/content-briefs/[briefId]/metrics
```

完成标准：

```text
用 Postman 或测试脚本完整跑通：
创建商家 → 创建门店 → 生成计划 → 获取今日任务 → 上传素材 → 触发生成 → 获取视频版本
```

---

## 阶段 4：Worker 与视频生成

实现：

```text
render-local-video worker
local-render-service
```

先不追求复杂特效。

完成标准：

```text
上传 3 段门店素材后，可以生成 3 个 mp4 视频版本。
视频能正常播放。
视频有字幕。
视频有封面。
VideoVariant 写入数据库。
```

---

## 阶段 5：前端页面

实现：

```text
/merchant/onboarding
/merchant/stores/[storeId]
/merchant/stores/[storeId]/today
/merchant/stores/[storeId]/briefs/[briefId]/variants
/merchant/stores/[storeId]/briefs/[briefId]/metrics
```

完成标准：

```text
普通商家可以不理解分镜、不理解 AI 参数，也能完成一次视频生成。
```

---

## 阶段 6：订阅与额度

接入现有：

```text
credit-service
subscription-service
privilege-engine
```

新增额度类型：

```text
CONTENT_PLAN_GENERATION
LOCAL_VIDEO_RENDER
VIDEO_EXPORT
```

完成标准：

```text
免费用户有生成限制。
付费用户有更高额度。
失败任务会退款。
```

---

## 阶段 7：复盘闭环

实现：

```text
手动录入数据
生成 AI 建议
推荐复用剧本
推荐下一个内容目标
```

完成标准：

```text
商家录入一条视频数据后，系统能给出下一条内容建议。
```

---

# 16. 测试要求

## 16.1 单元测试

新增测试目录：

```text
src/lib/__tests__/merchant-profile-service.test.ts
src/lib/__tests__/playbook-engine.test.ts
src/lib/__tests__/content-calendar-service.test.ts
src/lib/__tests__/capture-director.test.ts
src/lib/__tests__/compliance-service.test.ts
src/lib/__tests__/content-entropy-service.test.ts
src/lib/__tests__/performance-learning-service.test.ts
```

测试重点：

```text
餐饮门店能生成合理画像
7 天内容计划不为空
每个 brief 有 shotTasks
合规服务能拦截违禁词
同一 playbook 连续使用会降低内容熵
数据表现能生成建议
```

---

## 16.2 属性测试

使用 fast-check 测试：

```text
任意门店名称、任意产品列表，不应该导致内容计划生成崩溃
任意空 offers，系统仍然能生成非促销型内容
任意异常指标输入，不应该导致 performance-learning-service 崩溃
```

---

## 16.3 E2E 手工测试流程

准备一个测试门店：

```text
店名：阿强砂锅饭
行业：RESTAURANT
城市：杭州
商圈：滨江宝龙城
客单价：35
主打产品：砂锅牛肉饭、招牌鸡腿饭、老火靓汤
卖点：现点现做、分量足、适合上班族午餐
优惠：29.9 元单人套餐
```

完整测试：

```text
1. 新用户注册登录。
2. 进入商家问诊。
3. 创建门店。
4. 自动生成 7 天内容日历。
5. 打开今日任务。
6. 上传 3 段视频素材。
7. 点击一键生成。
8. 等待 worker 完成。
9. 查看 3 个版本。
10. 查看合规提示。
11. 导出视频。
12. 手动录入播放量和团购点击。
13. 查看 AI 复盘建议。
```

---

# 17. AI 开发代理需要遵守的限制

开发时不要做这些事：

```text
不要重写整个项目架构
不要删除旧的视频重绘能力
不要一次性接入所有平台发布
不要一开始做多行业
不要把复杂分镜参数暴露给商家
不要默认纯 AI 生成整条门店视频
不要生成违规夸大营销文案
不要用水印作为免费版核心限制
不要把“爆款复刻”作为前端主文案
```

优先做这些事：

```text
让商家少填字段
让商家知道今天拍什么
让商家按镜头上传素材
让系统自动生成视频
让系统自动生成文案
让系统提示风险
让数据反哺下一条内容
```

---

# 18. 最终验收标准

第一阶段完成后，系统必须支持以下完整闭环：

```text
商家首次登录
→ 填写门店信息
→ 系统生成门店画像
→ 系统生成 7 天内容计划
→ 商家进入今日任务
→ 商家按 3～5 个镜头提示上传素材
→ 系统自动生成 3 个餐饮短视频版本
→ 系统生成标题、封面、发布文案、标签、CTA
→ 系统完成基础合规检查
→ 商家导出视频
→ 商家录入视频表现数据
→ 系统给出下一条内容建议
```

如果这个闭环跑通，就算第一阶段成功。

---

# 19. 推荐的第一版产品文案

不要写：

```text
爆款视频复刻
一键洗爆款
AI 自动做爆款
```

改成：

```text
会拍照，就会做同城短视频
每天 10 分钟，门店自己做内容
把门店日常，变成同城流量
AI 帮你想选题、教你拍、自动剪、给文案
```

---

# 20. 最重要的产品原则

所有实现都围绕一个原则：

> 不要让商家使用一个“视频编辑器”，而是让商家完成一个“今天的营销任务”。

旧系统的核心对象是：

```text
Project
Shot
Generation
Export
```

新系统的核心对象应该是：

```text
Store
ContentPlan
ContentBrief
ShotTask
VideoVariant
PublishMetric
```

也就是从“项目驱动”转为“门店经营驱动”。

---

# 21. 推荐给 AI 开发代理的第一条开发指令

请基于当前 Next.js + Prisma + BullMQ 项目，先完成“阶段 1：数据库与种子数据”和“阶段 2：核心服务层”，不要改 UI，不要接平台发布，不要重写旧视频生成流程。完成后提供迁移文件、seed 数据、service 单元测试和可运行说明。
