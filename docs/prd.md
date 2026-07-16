
# 本地生活 AI 营销平台 — 产品需求文档（PRD）

> **文档版本**：v1.0
> **产品名称**：本地生活商家 AI 营销平台
> **产品入口**：`/merchant`
> **目标行业**：本地实体门店（第一阶段：餐饮）
> **文档日期**：2026-07-14

---

## 一、产品定位

### 1.1 一句话定义

面向本地实体门店（第一阶段餐饮）的 AI 内容经营闭环系统——让「不会策划 / 不会拍 / 不会剪 / 不会写文案 / 不会持续运营」的商家，通过 AI 接管实现：**问诊 → 门店画像 → 7天内容日历 → 每日拍摄任务 → 素材上传质检 → 一键生成3版视频 → 文案+封面+字幕 → 合规检查 → 导出 → 数据回填 → 复盘反哺下一轮**。

### 1.2 核心理念

- 不是给商家一个「视频编辑器」，而是让商家完成「今天的营销任务」
- 核心对象由「项目驱动」转为「门店经营驱动」
- 核心业务实体：Store / ContentPlan / ContentBrief / ShotTask / VideoVariant / PublishMetric
- 用户操作路径极简化：看今日任务 → 拍 → 传 → 一键生成 → 导出/看效果

### 1.3 目标用户

- **小白老板（P0）**：完全不懂拍视频的小店老板，核心用户
- **运营型用户（P1）**：有一定运营能力的商家，使用高级可调参数
- **服务商/代运营（P2）**：管理多家门店的运营服务商（后续阶段）

---

## 二、业务闭环总览

### 2.1 完整业务链路

```
商家注册登录
  → 商家问诊（3步表单：门店信息/产品卖点/优惠活动）
    → AI 生成门店画像（内容定位/人设/风格/钩子词/违禁词/CTA）
      → AI 生成 7 天内容日历（每天一条 ContentBrief + 拍摄任务）
        → 商家每日查看「今日任务」
          → 按镜头指引拍摄素材
            → 上传素材 + 即时质检（FFmpeg 元数据提取 + 评分）
              → 一键生成 3 版视频（促销版/氛围版/口播版）
                → AI 生成标题/封面/字幕/平台文案
                  → 自动合规检查（违禁词/虚假宣传/AIGC标识/肖像授权/同质化）
                    → 视频导出（24h签名下载URL）
                      → 手动发布到平台
                        → 回填表现数据（播放/点赞/转化）
                          → AI 生成优化建议
                            → 反哺下一轮内容计划
```

### 2.2 五步线性主操作（用户视角）

1. **看今日任务** — 打开 App 即可看到今天该拍什么
2. **拍** — 按镜头指引拍摄（日常语言描述）
3. **传** — 上传素材，即时质检反馈
4. **一键生成** — AI 自动剪辑出 3 个版本
5. **导出/看效果** — 下载成品 + 查看数据


---

## 三、用户旅程与页面路由

### 3.1 路由结构

```
/login                                          登录/注册
/merchant                                       商家入口（Server Component 重定向）
  → 无商家身份：/merchant/onboarding            问诊入驻
  → 有门店：/merchant/stores/{storeId}          门店首页
      /merchant/stores/{storeId}/calendar       周计划/内容日历
      /merchant/stores/{storeId}/today          今日任务
      /merchant/stores/{storeId}/briefs/{briefId}/shoot     拍摄上传
      /merchant/stores/{storeId}/briefs/{briefId}/variants  成片/合规/文案/导出
      /merchant/stores/{storeId}/briefs/{briefId}/metrics   数据回填/复盘
      /merchant/stores/{storeId}/settings       门店设置
```

### 3.2 认证流程

- JWT (jose) + Cookie 方式认证
- 中间件拦截 `/api/*` 和 `/merchant/*` 路径
- 验证通过后注入 `x-user-id` / `x-user-role` 请求头供后续使用
- 未登录自动重定向到 `/login?redirect=原路径`
- 公开路径白名单：`/api/auth/login`、`/api/auth/register`、`/api/payments/*/callback`、`/api/showcase`、`/api/help-articles`

### 3.3 用户旅程

```
注册登录 (4/5)
  → 填写门店问诊 3 步表单 (3/5)
    → 系统生成门店画像 (5/5 系统自动)
      → 系统生成 7 天内容日历 (5/5 系统自动)
        → 打开今日任务看"拍什么" (5/5)
          → 按镜头指引拍摄 (3/5)
            → 上传素材 + 即时质检 (4/5)
              → 一键生成 3 个版本 (5/5 系统自动)
                → 查看 3 版本 + 合规 + 文案 (4/5)
                  → 选版本导出 (5/5)
                    → 手动发布到平台 (2/5)
                      → 回填播放/转化数据 (3/5)
                        → 系统给优化建议 (5/5 系统自动)
                          → 反哺下一周计划 (5/5 系统自动)
```

（数字为用户体验满意度预期，5 分最优）

---

## 四、核心功能需求

### 4.1 商家问诊（Onboarding）

**用户故事**：作为餐饮商家，我通过问诊表单填写门店基本信息，系统能了解我的经营情况并提供针对性的营销方案。

**功能描述**：
- 3 步表单收集门店信息：
  - 第 1 步：门店基本信息（名称≤50字、行业、地址、客单价、营业时间）
  - 第 2 步：产品与卖点（主打产品1-20个每个≤30字、核心卖点1-10个每个≤50字、目标客群）
  - 第 3 步：拍摄能力与优惠（能否拍厨房/员工/顾客、团购/预约、优惠信息≤20条）

**支持行业**：RESTAURANT / DRINK / BAKERY / CAFE / HOTPOT / BBQ / FAST_FOOD / OTHER_LOCAL

**业务规则**：
- 单事务创建 Merchant + Store + ProductOffer（数据一致性保证）
- 每个用户只能有一个 Merchant 记录（重复提交返回 409）
- 提交成功后 5 秒内异步入队：生成门店画像 + 生成 7 天内容计划
- 画像或计划生成失败时 Store.status 置为 PROFILE_PENDING，允许重试不需重新提交表单
- 返回 201 + merchantId + storeId

**核心数据实体**：
- **Merchant**：商家主体（userId 唯一关联 User，1:1）
- **Store**：门店（merchantId 关联 Merchant，1:N），含地址/行业/主打产品/卖点/拍摄能力
- **ProductOffer**：商品/优惠活动（storeId 关联 Store，1:N），含名称/原价/售价/卖点/使用规则

---

### 4.2 门店画像生成（Store Profile）

**用户故事**：作为餐饮商家，系统自动分析我的门店信息并生成内容定位，我不需要自己思考营销策略就能获得专业的内容方向。

**画像字段**：

- **contentPositioning**：内容定位（行业+客单价规则映射，如 HOTPOT + avgTicket>80 → "品质火锅体验种草"）
- **recommendedPersona**：推荐人设（拍摄能力决定：老板/厨师/第三人称）
- **hookKeywords**：钩子词 5-15 个（行业关键词库 + 主打产品组合）
- **forbiddenClaims**：违禁词≥5个（固定词库 + 行业特定违禁词）
- **preferredCta**：推荐CTA 3-5 个（根据团购/预约状态选择模板）
- **weeklyCadence**：每周发布节奏（固定 7 天节奏模板，含每天主题和发布数量）
- **contentDos**：内容建议 3-10 条（行业+拍摄能力）
- **contentDonts**：内容禁忌 3-10 条（行业+拍摄能力）
- **visualStyle**：视觉风格（行业规则）
- **aiSummary**：AI自然语言总结（唯一使用 LLM 的字段，调用 qwen 系列模型润色）

**业务规则**：
- 30 秒内完成生成
- 以规则引擎为主，LLM 仅用于 aiSummary 润色
- 必须所有必填字段填充完毕才标记 status=COMPLETE，否则 INCOMPLETE
- 输入缺少 industry / mainProducts / mainSellingPoints 时直接拒绝


---

### 4.3 行业剧本库（Playbook Engine）

**用户故事**：作为餐饮商家，系统内置餐饮行业常用视频结构模板，我不需要自己策划视频内容就能拍出有效的短视频。

**剧本结构**：
- 至少 12 个活跃餐饮剧本
- 每个剧本关联一个 ContentGoal（TRAFFIC / PROMOTION / NEW_PRODUCT / TRUST_BUILDING / BRAND_STORY / CUSTOMER_TESTIMONIAL / WEEKEND_BOOST / REPEAT_PURCHASE）
- 每个剧本包含：有序视频结构（3+ 片段，每段 2-15s，总时长 10-60s）、必选/可选镜头类型、Hook模板（2+）、Caption模板（2+）、封面标题模板（1+）、CTA模板（1+）
- 可设置 tierRequired（FREE / GROWTH）控制访问权限

**选择算法**：
1. 匹配行业 + 活跃状态（isActive=true）的剧本
2. 按 ContentGoal 分组筛选
3. 过滤不可用拍摄能力的剧本（如 canShootKitchen=false 时过滤 COOKING_PROCESS 必选镜头）
4. 按 scoreWeight 加权排序
5. 确保同一剧本不连续使用超过 3 次（查最近 3 个 ContentBrief 的 playbookId）
6. 无匹配 goal 时 fallback 到最高分可用剧本，在 aiReasoning 中说明替代原因

**实例化逻辑**：
- 模板变量替换：`{storeName}`, `{productName}`, `{price}`, `{cta}`, `{location}`
- LLM 润色 Hook 和 Caption（qwen 模型），确保自然且不违规
- 生成 ShotTask 时用日常用语描述（不用专业术语）
- 输出：title / goal / hook / mainMessage / suggestedTitle / suggestedCoverTitle / suggestedCaption / suggestedCta / platformCopies / tags / aiReasoning / shotTasks[]

---

### 4.4 7 天内容日历（Content Calendar）

**用户故事**：作为餐饮商家，系统自动生成一周的内容计划，我每天都知道该拍什么内容而不需要自己规划。

**每日目标分配**：

- **周一** TRAFFIC — 工作日午餐引流
- **周二** NEW_PRODUCT — 招牌产品/新品
- **周三** TRUST_BUILDING — 老板/厨师人设
- **周四** BRAND_STORY — 门店环境/体验
- **周五** WEEKEND_BOOST — 周末聚餐预热
- **周六** PROMOTION — 爆品/套餐促销
- **周日** REPEAT_PURCHASE — 家庭/朋友聚餐

**生成流程**：
1. 读取 Store + StoreProfile + 活跃 ProductOffers
2. 如有 performance-learning 数据 → 读取 recommendedNextGoals 和 playbooksToAvoid
3. 创建 ContentPlan 记录（startDate, endDate, strategy, status=ACTIVE）
4. 每天：selectPlaybook → instantiatePlaybook → 创建 ContentBrief + ShotTasks
5. 设置 ContentBrief.status = READY_TO_SHOOT

**业务规则**：
- 从下一个自然日开始的 7 天，每天恰好一条 ContentBrief
- 同一计划内 7 天不重复 ContentGoal
- 无 StoreProfile 或 contentPositioning 为空时拒绝生成
- 无活跃 ProductOffer 时跳过需要产品引用的 Goal（PROMOTION 等），改为 BRAND_STORY / TRUST_BUILDING
- 30 秒内完成全部生成
- Onboarding 路径触发的首次生成不计费；手动再次生成计费（固定 10 积分）

---

### 4.5 每日拍摄任务（Today's Task）

**用户故事**：作为餐饮商家，每天打开系统就能看到清晰的拍摄指引，即使没有专业知识也能拍出合格的素材。

**功能描述**：
- 展示当天 ContentBrief 的所有 ShotTask（按 order 升序排列）
- 每个 ShotTask 包含：
  - title（≤20字）
  - instruction（日常语言指导，≤200字，如"从左往右慢慢移动手机"）
  - durationSec（建议时长 3-15s）
  - framingGuide（构图引导 JSON）
  - qualityRules（质检规则 JSON）
  - required（是否必拍）
- 显示拍摄进度（已上传通过/总需拍摄），2 秒内刷新
- 全部必拍镜头通过质检（score≥60）后启用「一键生成」按钮
- 无当日任务时显示提示 + 生成计划入口

**镜头类型（ShotTaskType）**：
STOREFRONT / PRODUCT_CLOSEUP / COOKING_PROCESS / STAFF_ACTION / CUSTOMER_REACTION / OWNER_TALKING / ENVIRONMENT / OFFER_DISPLAY / CTA_SCREEN / AI_GENERATED_FILLER

**界面原则**：
- 隐藏一切技术参数（AI模型设置、渲染参数、分镜组配置、Seedance prompt、FFmpeg编码选项）
- 拍摄指导用日常词汇（如"从左往右慢慢移动手机"而非"水平横移镜头"）
- 禁用术语：分镜、帧率、码率、景别、色温、白平衡、跟焦


---

### 4.6 素材上传与质量检测（Capture Director）

**用户故事**：作为餐饮商家，上传拍摄的素材并立即知道质量是否合格，我能在现场及时重拍不合格的内容。

**质检维度与评分**：

- **orientation（权重20）**：height > width 竖屏 9:16，宽高比 0.5625 允许 ±2% 偏差
- **resolution（权重25）**：短边 ≥ 720px 通过；短边 < 480px 致命拒收
- **duration（权重20）**：目标时长 ±50% 通过；< 1s 致命拒收
- **fileSize（权重10）**：1B ~ 300MB 通过；> 300MB 致命拒收
- **brightness（权重15）**：平均亮度（0-255量纲）≥ 60 通过（capture-guide 标准）；基础质检 > 15
- **audio（权重10）**：有音轨通过（OWNER_TALKING 类型必须有音轨）

**评分规则**：
- 总分 0-100，各维度按权重加和
- ≥60 分且无致命问题 → 通过（passed=true）
- 有致命问题（critical=true）→ 直接拒收，不入库
- 通过后：创建 RawAsset 记录、生成缩略图（第一帧）、ShotTask 状态 PENDING → CAPTURED
- 拒收后：ShotTask 保持 PENDING，允许重传
- 10 秒内完成质检

**技术实现**：
- 元数据提取：`ffprobe -v quiet -print_format json -show_streams -show_format`
- 亮度检测：`ffmpeg -i file -vf "fps=1,signalstats" -f null -`（取 YAVG 平均值）
- 缩略图生成：`ffmpeg -i file -vf "select=eq(n\\,0)" -vframes 1 -f image2 output`
- 存储路径：`merchant/{storeId}/assets/{assetId}.mp4`（阿里云 OSS）
- 14 天资产过期策略

---

### 4.7 AI 视频渲染（Local Render Service）

**用户故事**：作为餐饮商家，一键生成多个视频版本，我能选择最适合的版本发布到不同平台。

**生成规则**：
- 固定生成 3 个版本：
  - **PROMOTION**（促销引流版）：钩子(价格)→产品→优惠→CTA，大字价格+利益点，快切节奏
  - **ATMOSPHERE**（氛围种草版）：环境→产品→制作过程→氛围，轻文案+标签，慢移节奏
  - **OWNER_TALKING**（老板口播版）：口播(人)→产品→推荐→CTA，字幕跟随语音，自然节奏
- 必拍素材作为主素材
- 可选镜头缺失时调用 Seedance 2.0 生成补充片段（每版本最多 3 个，每个 ≤5s）

**FFmpeg 合成规范**：
- 统一编码：H.264 / AAC / 9:16 / 720p+
- 片段间 0.5s crossfade 转场
- 字幕叠加（ASS 格式）
- 从第 1 秒提取封面帧
- 输出存储：`merchant/{storeId}/variants/{variantId}.mp4`

**计费与锁机制**：
- 渲染前 RESERVE 冻结积分（按分镜组时长 × 分辨率公式计算）
- 获取分布式锁（key=ContentBriefId，TTL=720s）防重复生成
- 成功 → CHARGE 实扣（冻结多余部分退回差额）
- 失败 → REFUND 全额退回
- 超时上限 600 秒，超时则 abort + REFUND + 状态置 FAILED
- 余额不足在入队前预检阶段拒绝（HTTP 402 + INSUFFICIENT_CREDITS + 所需/当前余额）
- 所有积分写操作经 `withCreditLock` 全局 Redis 锁串行化

**状态流转**：
ContentBrief: MATERIALS_UPLOADED → RENDERING → GENERATED（成功）/ FAILED（失败）


---

### 4.8 发布文案生成（Publish Copy Service）

**用户故事**：作为餐饮商家，系统自动生成每个视频的标题、封面文字和发布文案，我不需要自己想文案就能直接发布。

**生成内容**：
- title（标题，≤30字）
- coverTitle（封面标题，≤15字）
- 字幕内容（ASS 格式）
- 4 个平台专属文案（platformCopies）
- tags（标签 3-10 个，涵盖行业/地域/当前优惠）
- CTA 文案（必须从 StoreProfile.preferredCta 中选取）

**平台文案约束**：
- **抖音**（≤300字）：短平快，带同城标签，突出价格
- **小红书**（≤1000字）：体验分享，避免硬广，种草口吻
- **微信视频号**（≤200字）：简洁可信，熟人推荐语气
- **快手**（≤300字）：接地气，价格利益点前置

**安全检查**：
- 生成后对 StoreProfile.forbiddenClaims 做二次扫描过滤
- CTA 必须从 preferredCta 列表中选取
- PROMOTION 版本必须包含 ProductOffer 信息（价格、卖点）
- 任一平台生成失败则整体返回错误，不保存部分结果

---

### 4.9 合规检查（Compliance Service）

**用户故事**：作为餐饮商家，系统自动检查视频和文案是否合规，我不会因为违规表达而被平台处罚。

**检查规则链**：

1. **绝对化用语**（HIGH）：扫描标题/文案/封面/CTA/字幕，匹配词库（最好/第一/全网最低/唯一/必吃/不吃后悔/保证/100%/全城第一/最便宜）
2. **虚假火爆**（MEDIUM）：扫描文案/标题，匹配词库（全城排队/每天卖爆/全网疯抢/万人好评）且无支撑证据（无 CUSTOMER_REACTION 素材或近30天无 views≥10000 的 PublishMetric）
3. **AIGC 标识**（MEDIUM）：检查渲染参数/生成日志是否引用 Seedance 生成片段
4. **顾客出镜**（HIGH）：CUSTOMER_REACTION 镜头 + canShootCustomers=false 时检查是否有有效 ConsentRecord
5. **内容同质化**（MEDIUM/BLOCKED）：调用 entropy-service 计算相似度评分

**风险等级与导出门控**：
- **LOW**（passed=true）：允许导出
- **MEDIUM**：允许导出，仅提示修改建议
- **HIGH**：需商家点击 acknowledge 显式确认后方可导出（记录确认时间戳）
- **BLOCKED**：禁止导出，返回 blockedReasons 列表

**汇总规则**：取所有 issues 中最高等级（BLOCKED > HIGH > MEDIUM > LOW），无 issues 时为 LOW。

---

### 4.10 内容同质化检测（Content Entropy Service）

**用户故事**：作为餐饮商家，系统防止生成重复度过高的视频，我的账号不会因为内容雷同而被平台降权。

**相似度计算维度**：

1. **Playbook 维度**：查30天内连续使用同一 playbookId 次数 → ≥4次触发 MEDIUM
2. **文本维度**：Dice coefficient 计算 bigram 相似度（title/caption 对比历史）→ ≥80% 触发 HIGH
3. **素材维度**：检查 shotTask 序列中 rawAsset ossKey 与历史对比 → 3+ 连续相同触发 MEDIUM

**判定规则**：
- uniquenessScore < 40：**阻断生成**（BLOCKED），返回错误+失败维度
- 40-60：**警告但允许**（MEDIUM），附带 duplication warning
- `> 60`：**通过**（LOW）
- 历史记录 < 2 条时跳过检测，返回 score=100

---

### 4.11 视频导出（Export）

**用户故事**：作为餐饮商家，将生成的视频导出为可直接发布的成品，我能下载后手动发布到各平台。

**导出规格**：
- 格式：H.264 MP4 + AAC 音频，字幕烧入（hardcoded subtitles）
- 分辨率：1080x1920（付费用户 MONTHLY/YEARLY）/ 720x1280（FREE 用户）
- 竖屏 9:16
- 180 秒内完成导出
- 生成 24 小时签名下载 URL（OSS signed URL）
- 创建 PublishJob 记录（status=EXPORTED）

**前置校验**：
- 必须存在 ComplianceCheck 记录（无记录时先执行合规检查）
- HIGH 风险需先 acknowledge 确认
- BLOCKED 风险拒绝导出并返回 blockedReasons
- 无完成的 VideoVariant 时拒绝

**计费**：
- 普通导出不额外扣费
- 含超分处理（WaveSpeed）时按超分计费公式扣费（RESERVE → CHARGE/REFUND）


---

### 4.12 数据录入与表现学习（Metrics & Performance Learning）

**用户故事**：作为餐饮商家，手动录入视频在各平台的表现数据，系统能了解哪些内容效果好并给出优化建议。

**可录入指标**：
views / likes / comments / shares / saves / linkClicks / messages / orders / redemptions / revenue（分为单位）

- 所有字段为非负整数，最大值 999999999
- 每条 ContentBrief 最多 50 条 metric 记录（跨平台 × 时间点）
- ContentBrief 必须为 EXPORTED 及之后状态才能录入
- 录入成功后 5 秒内异步触发表现学习分析

**学习规则引擎**：

1. 播放 TOP30% + 转化 BOTTOM30% → 建议强化 CTA + 优惠表达
2. 收藏/评论 TOP30% → 建议复用该剧本结构（playbooksToReuse）
3. 同一剧本/Hook 连续 3+ 低播放（低于历史均值 50%）→ 建议换钩子/封面风格（playbooksToAvoid）
4. linkClicks TOP30% → 建议复用标题和优惠结构
5. 数据不足（< 3 条有 metrics 的 brief）→ 返回空建议，不伪造

**输出**：
- suggestions[]（1-5条，含 category/action/evidence）
- recommendedNextGoals[]（TOP3 推荐 ContentGoal）
- playbooksToReuse[]（复用候选 playbookId）
- playbooksToAvoid[]（规避名单 playbookId）

**反哺机制**：下一轮 content-plan 生成时自动读取学习结果作为输入参数。

---

### 4.13 订阅与计费体系

**计费统一**：平台使用统一的积分（Credit）体系，两条产品线共享同一套账号、积分与订阅。

**用户等级（UserTier）**：
- **FREE**：免费体验
- **MONTHLY**：月度会员
- **YEARLY**：年度会员

**会员权益映射（Privilege Mapping）**：

- **导出分辨率**：FREE=720p / MONTHLY,YEARLY=1080p
- **数据洞察**：FREE=关闭 / MONTHLY,YEARLY=开放
- **门店数量上限**：由 UserTier 对应的 maxStores 决定
- **并发批量**：由 UserTier 对应的 batchConcurrency 决定

**可计费操作**：
- **内容计划生成**（CREATE_CONTENT_PLAN）：固定 10 积分（Onboarding 首次免费）
- **视频渲染**（RENDER_VIDEO）：按分镜组时长 × 分辨率公式计算
- **视频导出含超分**（EXPORT_VIDEO）：超分才扣费，普通导出不扣
- **建店**（CREATE_STORE）：不扣费，maxStores 门控
- **数据洞察**（ACCESS_INSIGHTS）：不扣费，insightsEnabled 门控

**计费流程**：
- RESERVE（冻结）→ 操作执行 → CHARGE（成功实扣）/ REFUND（失败退回）
- 余额不足在 RESERVE 前预检阶段拒绝，返回 INSUFFICIENT_CREDITS
- 所有积分写操作经 Redis 全局锁 `withCreditLock` 串行化（不可重入）
- 商家操作积分流水 jobId 恒为 null，以 (bizRefType, bizRefId) 作为幂等键
- 同一操作重试不重复冻结/扣费/退款

---

## 五、核心状态机

### 5.1 ContentBrief 状态机（核心对象）

```
[创建] → DRAFT
  → READY_TO_SHOOT（拍摄任务就绪）
    → MATERIALS_UPLOADED（必拍镜头素材全部质检≥60）
      → RENDERING（POST /render 触发，RESERVE 冻结积分 + 入队）
        → GENERATED（3 版本渲染成功，CHARGE 实扣）
        → FAILED（渲染失败/超时600s，REFUND 退款；可重试）
      → GENERATED
        → COMPLIANCE_REVIEW（触发合规检查）
          → READY_TO_EXPORT（风险 LOW/MEDIUM，或 HIGH 已确认）
          → GENERATED（风险 BLOCKED，禁止导出）
        → READY_TO_EXPORT
          → EXPORTED（导出成功，PublishJob=EXPORTED）
            → PUBLISHED（回填数据/标记已发布）
      → ARCHIVED（归档）
```

### 5.2 ShotTask 状态

```
[创建] → PENDING
  → 上传素材（FFmpeg 抽元数据）→ 质检中
    → 评分≥60 且无致命问题 → CAPTURED（入库 RawAsset）
    → 评分<60 → 保留 PENDING（可重传）
    → 致命问题（<480p / <1s / >300MB）→ 拒收 → PENDING
  → 删除素材 → PENDING
```

### 5.3 PublishJob 状态

```
[创建] → DRAFT
  → READY（校验通过待导出）
    → EXPORTING（触发导出）
      → EXPORTED（OSS 上传成功 + 24h 签名URL）
      → FAILED（OSS/FFmpeg 失败，可重试）
    → PUBLISHING（接平台发布，后续阶段）
      → PUBLISHED
      → FAILED
```

### 5.4 合规风险等级导出门控

```
LOW → 允许导出
MEDIUM → 允许导出（仅提示修改）
HIGH → 需 acknowledge 显式确认后允许导出
BLOCKED → 禁止导出（返回 blockedReasons）
```


---

## 六、深化改造需求（三件套反馈控制回路）

### 6.0 改造核心理念

平台第一阶段上线后发现的根因问题：**把每个 AI 产物和检测结果都做成了「只读终点」，而不是「下一步动作的起点」。缺的不是功能数量，而是「反馈控制回路」。**

统一改造模式——「三件套」：
1. **可解释（Explainable）**：AI 输出附带依据溯源，让用户知道"为什么是这个"
2. **可干预（Actionable）**：提供一键改/重做/规避动作，小白=一键完成，运营型=高级抽屉细调
3. **可反哺（Feedback Loop）**：本步结果自动喂给下一步（复盘→下周计划、合规→文案改写、质检→重拍引导）

### 6.1 数据复盘闭环反哺

- metrics 页渲染 performance-learning-service 产出的 suggestions / recommendedNextGoals / playbooksToReuse / playbooksToAvoid（当前已计算但前端未展示）
- 每条建议展示 evidence（证据/溯源文本）— 可解释
- 「应用建议」按钮将建议写入下一轮 content-plan 生成输入 — 可反哺
- 指标趋势图（历史多条 brief 某指标变化）
- 跨周对比视图（本周 vs 上周关键指标增减）
- 数据不足（< 3 条有 metrics 的 brief）时显式提示"再录入 N 条即可解锁优化建议"
- 下一轮计划标注"已采纳上轮复盘建议：<建议摘要>"形成可见反哺闭环

### 6.2 文案与合规可操作

- variants 页平台文案支持就地编辑（保存回 platformCopies，置 copyEditedFlag=true）
- 「重新生成文案」按钮（消耗积分，基于 StoreProfile + brief 上下文调用 LLM）— 可干预
- 「按平台改写」按钮（消耗积分，针对特定平台调性产出适配文案）
- 存在人工修改标记时，重新生成需二次确认才覆盖
- 合规 BLOCKED/HIGH 时展示命中违禁词+原因（可解释）+ 「一键改写规避」按钮
- 一键改写规避：调用 compliance-service 配合文案生成，去除违禁表达后自动重跑合规 — 可反哺
- 改写后仍未通过则显式提示剩余风险点，不标记通过

### 6.3 拍摄事中引导

- 拍摄前展示可视化构图引导（framingGuide 结构化渲染，非纯文字）
- 明示量化质检阈值：竖屏9:16(±2%)、短边≥720p、目标时长区间、平均亮度≥60、是否需口播
- 用通俗语言转述达标条件（不暴露技术参数）
- 质检不通过时针对失败维度给具体重拍建议（如"光线偏暗，建议靠近窗边或开灯重拍"）— 可反哺
- 支持生成镜头参考画面（基于 StoreProfile + 镜头脚本，调用图像生成，消耗积分）

### 6.4 生成可控性

- 默认「一键生成」路径：AI 自动选择风格/时长/模板，商家无需任何参数输入
- **单版本重生成**：对某个 VideoVariant 不满意可单独重生成，保留其他版本
- **局部重拍**：替换某 ShotTask 素材后，仅基于受影响范围重新合成
- 受影响范围定义：被重拍镜头所属分镜组 + 尾帧承接链上的后续同场景分镜组
- 承接链上后续同场景组一并重算，保证画面不断裂
- 运营型用户展开「高级」抽屉可调参数（风格/时长/模板），结果上标注使用参数（可解释）
- 所有重生成/局部重拍复用既有计费链路（reserve→charge/refund + withCreditLock）

### 6.5 画像→内容个性化溯源

- ContentBrief 标注引用了 StoreProfile 的哪些依据（卖点/钩子词/人设/CTA）— 可解释
- 实例化时记录引用关系（provenance 结构体），前端用通俗话术展示（如"这条用了你的招牌'现熬8小时骨汤'"）
- 商家可调整画像依据（剔除钩子词/修改卖点）— 可干预
- 调整仅对后续生成生效，不回溯重写旧 brief — 可反哺
- 无可溯源记录时如实显示"通用模板"，不伪造

### 6.6 内容计划可编辑

- calendar 页支持对单条 brief：改期 / 更换 goal / 更换 playbook / 删除 / 新增
- 改期校验日期合法，单日上界默认 3 条（weeklyCadence 可覆盖），超过拒绝
- 换 goal/playbook 时重实例化镜头脚本与文案草稿（基于 StoreProfile）— 可反哺
- 已拍素材不自动丢弃，提示"选题已变更，原素材可能与新脚本不匹配"
- 「锁定/跳过」某天：下一轮自动生成尊重该状态，不覆盖用户决定
- 允许某天空缺（如实展示，不自动填充伪内容）
- 提供保存确认/撤销，避免误操作

### 6.7 自营账号数据自动抓取

- 手动录入永久保留为兜底，自动抓取仅为增强
- 关联平台账号前明确告知风险（ToS/反爬/封号），需商家显式授权确认
- 凭证加密存储，仅抓取商家本人账号数据
- 后台 Worker 按受控频率定期抓取（默认每 24h 一次，最小间隔≥6h）
- 抓取失败时显式标记需重新关联，回退手动录入提示
- 自动 vs 手动数据冲突时标注来源，由商家选择采用
- 产品内明示抓取脆弱性边界

### 6.8 发布闭环（清单 + 提醒）

- VideoVariant 导出成功后自动加入「待发布清单」
- 清单展示每条已导出内容的发布状态（未发布/已发布到某平台）
- 导出后超过 24h（可配置）未标记发布时触发提醒通知
- 商家手动标记「已发布到某平台」→ 记录平台+时间 → 纳入后续数据回填/复盘范围
- 提供各平台发布引导（复制文案/下载视频/跳转平台入口）
- 本阶段明确为「清单+提醒+手动标记」，不声称自动分发

### 6.9 全局任务与通知中心

- 全局任务中心聚合当前门店作用域下的进行中任务（待拍摄/渲染中/待导出/待发布）
- 状态变化实时或近实时反映（复用 SSE/进度机制）
- 通知中心承接过期提醒/发布提醒/抓取失效提醒，支持已读/未读
- 点击任务/通知直达可操作页面
- 如实反映真实状态，不展示占位/伪造任务

### 6.10 多门店切换与跨店看板

- 会员权益 maxStores > 1 且拥有多店时提供门店切换器
- 切换保持当前功能上下文，加载目标门店数据
- 跨店看板汇总各门店关键指标（本周完成度/最佳视频/待办数）
- 仅 1 家门店或权益不支持多店时隐藏切换器与看板
- 跨店数据为真实聚合查询

### 6.11 激励与留存

- 记录并展示连续创作情况（连续发布天数/周数）
- 完成某周全部任务或达成里程碑时给予可见激励（徽章/进度/鼓励文案）
- 基于真实历史数据展示「效果对比」（本月最佳 vs 上月最佳）— 可解释
- 新手阶段提供进阶引导任务，逐步解锁更深功能（渐进式）
- 激励与对比基于真实数据，不伪造数字


---

## 七、技术架构概要

### 7.1 技术栈

- **框架**：Next.js 15.5（App Router, standalone output, Turbopack dev）
- **语言**：TypeScript 5（严格模式）
- **运行时**：Node 22
- **包管理**：pnpm 10
- **UI**：React 19, Tailwind CSS v4, shadcn/ui, lucide-react
- **状态管理**：Zustand 5（客户端）, SWR（服务端数据）
- **数据库**：PostgreSQL 16（@prisma/adapter-pg）, Prisma 7.8 ORM
- **队列**：BullMQ + Redis 7（ioredis）
- **对象存储**：阿里云 OSS（ali-oss）
- **视频处理**：FFmpeg + ffprobe, yt-dlp
- **AI 服务**：
  - 火山引擎方舟 Seedance 2.0（视频生成）
  - 多模态视频分析（OpenAI 兼容接口，推荐 doubao-seed-2-0-pro）
  - 火山方舟 Seedream 5.0 lite（文生图/图生图）
  - WaveSpeed（视频超分）
  - 商家营销文案/画像 LLM（DashScope 兼容）
- **认证**：JWT (jose) + Cookie, bcryptjs 密码哈希
- **校验**：Zod v4
- **部署**：Docker (multi-stage), docker-compose, 宝塔面板

### 7.2 架构分层

```
┌─────────────────────────────────────────────┐
│  客户端 Browser（/merchant）                  │
│  React 19 + Zustand + SWR + shadcn/ui       │
├─────────────────────────────────────────────┤
│  API 层（Next.js App Router Route Handlers） │
│  参数校验(Zod) + 调用服务层 + 返回响应       │
├─────────────────────────────────────────────┤
│  服务层（src/lib/merchant/ + src/lib/shared/）│
│  核心业务逻辑封装                             │
├─────────────────────────────────────────────┤
│  Worker 层（BullMQ 独立进程）                 │
│  异步重任务处理                               │
├─────────────────────────────────────────────┤
│  基础设施                                     │
│  PostgreSQL / Redis / OSS / FFmpeg / AI APIs │
└─────────────────────────────────────────────┘
```

### 7.3 核心 API 路由

**商家平台 API**：
- `POST /api/merchant/onboarding` — 问诊入驻
- `POST /api/stores` — 建店
- `GET /api/stores/{storeId}` — 门店信息
- `POST /api/stores/{storeId}/content-plan/generate` — 生成内容计划
- `GET /api/stores/{storeId}/content-plan/current` — 当前计划
- `GET /api/stores/{storeId}/today` — 今日任务
- `POST /api/content-briefs/{briefId}/assets` — 上传素材
- `POST /api/content-briefs/{briefId}/render` — 触发渲染
- `GET /api/content-briefs/{briefId}/variants` — 获取视频版本
- `POST /api/content-briefs/{briefId}/compliance/acknowledge` — 合规确认
- `GET/POST /api/content-briefs/{briefId}/metrics` — 数据录入
- `GET /api/content-briefs/{briefId}/insights` — 优化建议
- `POST /api/video-variants/{variantId}/export` — 视频导出
- `GET /api/merchant/subscription` — 订阅信息

### 7.4 核心服务（src/lib/merchant/）

- **store-profile-service**：门店画像生成
- **playbook-engine**：行业剧本引擎（选择 + 实例化）
- **content-calendar-service**：内容日历生成与编辑
- **capture-director**：拍摄指导 + 素材质检
- **local-render-service**：视频渲染（整体/单版本/局部重拍）
- **ai-auto-render-service**：AI 自动渲染调度
- **compliance-service**：合规检查
- **content-entropy-service**：同质化检测
- **copy-generator / publish-copy-service**：文案生成
- **metrics-ingestor**：数据录入
- **performance-learning-service**：表现学习
- **merchant-billing-service**：商家计费封装

### 7.5 BullMQ Worker

- **generate-content-plan**：门店画像 + 7 天内容计划生成
- **render-local-video**：视频渲染（整体/单版本重生成/局部重拍/一键出片）
- **merchant-video-download**：商家复刻爆款视频下载
- **compliance-review**：视频版本合规审查
- **crawl-platform-metrics**：平台数据抓取
- **matrix-publish**：矩阵号多账号发布
- **sync-metrics**：数据同步（占位）
- **weekly-merchant-report**：周报（占位）

### 7.6 共享基础设施（src/lib/shared/）

- **credit-service**：积分服务（RESERVE/CHARGE/REFUND/TOPUP）
- **privilege-engine**：会员权益引擎（UserTier → 权益映射）
- **distributed-lock**：Redis 分布式锁
- **concurrency-controller**：并发控制
- **storage**：OSS 对象存储封装
- **progress-publisher**：SSE 实时进度推送
- **queue**：BullMQ 队列工厂
- **auth**：认证工具
- **logger**：日志
- **subscription-service**：订阅管理


---

## 八、核心数据模型

### 8.1 商家与门店

- **Merchant**：id, userId(唯一), name, contactName, phone, industry, createdAt, updatedAt
- **Store**：id, merchantId, name, industry, city, district, businessArea, address, avgTicket(分), openingHours, mainProducts(JSON), mainSellingPoints(JSON), targetCustomers(JSON), brandTone, canShootKitchen, canShootStaff, canShootCustomers, hasGroupBuying, hasReservation, status(ACTIVE/PROFILE_PENDING), createdAt, updatedAt
- **StoreProfile**：id, storeId(唯一), contentPositioning, recommendedPersona, contentDos(JSON), contentDonts(JSON), visualStyle, hookKeywords(JSON), forbiddenClaims(JSON), preferredCta(JSON), weeklyCadence(JSON), aiSummary, status(COMPLETE/INCOMPLETE), createdAt, updatedAt
- **ProductOffer**：id, storeId, name, description, originalPrice(分), salePrice(分), validFrom, validTo, sellingPoints(JSON), usageRules, isActive, createdAt, updatedAt

### 8.2 内容计划

- **Playbook**：id, industry, name, goal, description, structure(JSON), requiredShots(JSON), optionalShots(JSON), hookTemplates(JSON), captionTemplates(JSON), coverTitleTemplates(JSON), ctaTemplates(JSON), complianceRules(JSON), scoreWeight(JSON), tierRequired, isActive, createdAt, updatedAt
- **ContentPlan**：id, storeId, title, startDate, endDate, strategy(JSON), status(ACTIVE/COMPLETED/CANCELLED), createdAt, updatedAt
- **ContentBrief**：id, storeId, contentPlanId, playbookId, title, goal, scheduledDate, status(ContentBriefStatus枚举), hook, mainMessage, suggestedTitle, suggestedCoverTitle, suggestedCaption, suggestedCta, platformCopies(JSON), tags(JSON), aiReasoning, provenance(JSON), copyEditedFlag, createdAt, updatedAt

### 8.3 拍摄与素材

- **ShotTask**：id, contentBriefId, order, type(ShotTaskType枚举), title, instruction, durationSec, required, framingGuide(JSON), qualityRules(JSON), status(PENDING/CAPTURED), createdAt, updatedAt
- **RawAsset**：id, storeId, shotTaskId, ossKey, mimeType, fileSizeBytes, durationSec, width, height, thumbnailKey, qualityScore, qualityReport(JSON), status, createdAt, expiresAt

### 8.4 视频版本与合规

- **VideoVariant**：id, contentBriefId, type(PROMOTION/ATMOSPHERE/OWNER_TALKING/TRUST/PRODUCT), ossKey, durationSec, width, height, thumbnailKey, renderParams(JSON), generationLog(JSON), status, createdAt, updatedAt
- **ComplianceCheck**：id, contentBriefId, videoVariantId, riskLevel(LOW/MEDIUM/HIGH/BLOCKED), passed, issues(JSON), blockedReasons(JSON), acknowledgedAt, createdAt

### 8.5 发布与数据

- **PublishJob**：id, contentBriefId, videoVariantId, status(DRAFT/READY/EXPORTING/EXPORTED/PUBLISHING/PUBLISHED/FAILED), ossKey, downloadUrl, signedUrlExpiresAt, platform, createdAt, updatedAt
- **PublishMetric**：id, contentBriefId, platform, views, likes, comments, shares, saves, linkClicks, messages, orders, redemptions, revenue, source(MANUAL/API_SYNC), capturedAt, createdAt
- **ConsentRecord**：id, storeId, subjectName, subjectType, consentType, validFrom, validTo, evidenceKey, createdAt

### 8.6 枚举类型汇总

- **MerchantIndustry**：RESTAURANT / DRINK / BAKERY / CAFE / HOTPOT / BBQ / FAST_FOOD / OTHER_LOCAL
- **ContentGoal**：TRAFFIC / PROMOTION / NEW_PRODUCT / TRUST_BUILDING / BRAND_STORY / CUSTOMER_TESTIMONIAL / WEEKEND_BOOST / REPEAT_PURCHASE
- **ContentBriefStatus**：DRAFT / READY_TO_SHOOT / MATERIALS_UPLOADED / RENDERING / GENERATED / COMPLIANCE_REVIEW / READY_TO_EXPORT / EXPORTED / PUBLISHED / FAILED / ARCHIVED
- **ShotTaskType**：STOREFRONT / PRODUCT_CLOSEUP / COOKING_PROCESS / STAFF_ACTION / CUSTOMER_REACTION / OWNER_TALKING / ENVIRONMENT / OFFER_DISPLAY / CTA_SCREEN / AI_GENERATED_FILLER
- **VideoVariantType**：PROMOTION / ATMOSPHERE / OWNER_TALKING / TRUST / PRODUCT
- **ComplianceRiskLevel**：LOW / MEDIUM / HIGH / BLOCKED
- **PublishPlatform**：DOUYIN / KUAISHOU / XIAOHONGSHU / WECHAT_CHANNELS / MANUAL_EXPORT
- **PublishJobStatus**：DRAFT / READY / EXPORTING / EXPORTED / PUBLISHING / PUBLISHED / FAILED

---

## 九、非功能需求

### 9.1 性能要求

- 门店画像生成：≤30 秒
- 内容日历生成（7天）：≤30 秒
- 素材质检：≤10 秒
- 视频渲染（3版本）：≤600 秒（超时 abort）
- 视频导出：≤180 秒
- 表现学习分析：≤10 秒
- 拍摄进度刷新：≤2 秒
- 异步任务入队：≤5 秒

### 9.2 可靠性

- 所有外部 API 调用（Seedance、OSS、支付、AI 分析、平台抓取）使用真实接口
- 禁止 mock、fallback、静默降级、假数据掩盖
- 外部服务失败 → 显式报错/抛异常 → BullMQ 自动重试
- Worker 内不使用 fallback，失败抛错让队列重试
- 临时文件在 finally 块中清理
- 处理结果区分"成功/失败/部分失败"

### 9.3 安全性

- 环境变量缺失直接抛错，不使用默认回退值
- JWT_SECRET 必须由环境变量提供，缺失即抛错
- 积分操作经 Redis 全局锁串行化
- 前端不直接调用外部 AI API（所有 AI 调用走后端/Worker）
- 平台凭证加密存储（环境变量提供加密密钥）
- 14 天资产过期自动清理

### 9.4 并发控制

多层互补：
- **API 入口层**：Redis 原子计数器门控
- **Worker 层**：BullMQ concurrency 限制同时执行任务数
- **任务层**：Redis 分布式锁（按 ContentBriefId）防重复处理
- **积分层**：全局积分写锁（withCreditLock）跨进程串行化
- **漂移修复**：concurrency-reconcile 看门狗每 5 分钟用 DB 真相覆盖 Redis 计数器

---

## 十、业务约束与红线

### 10.1 必须遵守

- 所有外部 API 调用使用真实接口，不 mock、不 fallback
- 积分系统写操作必须经 Redis 锁串行化（withCreditLock，不可重入）
- 余额不足直接拒绝（不允许事后扣至负数）
- FFmpeg 操作基于 normalized 后的视频（统一编码/帧率）
- 分镜组是生成的最小单位（一次 Seedance 调用 = 一个分镜组）
- 时间轴校验不信任模型输出（非负、时长为正、不重叠、不超总时长）

### 10.2 禁止操作

- 禁止手动编辑 src/generated/prisma/（Prisma 自动生成）
- 禁止手动编辑 prisma/migrations/（通过 prisma migrate dev 生成）
- 禁止提交 .env* 文件、API Key、数据库文件到 Git
- 禁止在 API Route 中直接操作积分余额（必须通过 credit-service）
- 禁止在前端直接调用外部 AI API
- 禁止使用静默降级处理关键业务流程失败

### 10.3 界面约束

- 默认 Server Component，仅需交互时标记 'use client'
- 隐藏一切技术参数（AI模型/渲染参数/Seedance prompt/FFmpeg 选项）
- 拍摄指导用日常词汇，禁用术语：分镜/帧率/码率/景别/色温/白平衡/跟焦
- 5 步线性工作流，每步一个主操作按钮
- 前置步骤未完成时显示提示+导航回链

---

## 十一、后端能力基座

### 11.1 AI 视频重绘后端能力

平台底层保留了完整的 AI 视频处理能力基座，包括：

- **视频解析**：parse-video Worker — FFmpeg normalize + AI 视频分析 + 镜头分组 + 音频切片
- **视频生成**：generate-video Worker — Seedance 任务编排 + 分镜组合成
- **视频合并**：merge-video Worker — 多片段 FFmpeg 拼接 + 转场 + 字幕烧入
- **视频超分**：upscale-video Worker — WaveSpeed 超分辨率处理
- **视频下载**：download-video Worker — yt-dlp 短链解析 + 代理下载
- **视频处理库**：src/lib/video/ — Seedance API 封装、FFmpeg 工具、渲染管线、转场引擎、帧连续性等
- **旧系统 API**：/api/projects/* — 项目管理/解析/生成/导出等完整 API 路由

这些能力以 Worker + 服务库的形式存在，既支撑商家平台的视频生成需求，也保持独立的视频处理产品线可用。

### 11.2 Inhot 融合模块

Inhot 是后期融合进平台的创作功能模块，通过 `creation-mode-router` 将四种创作模式接入商家内容任务体系：

- **REPLICATE_TRENDING**（复刻爆款）：下载源视频 → 解析 → 重新生成同结构视频
- **IMMERSIVE_SHORT**（沉浸式短片）：商家上传素材 → AI 编排成短片
- **INSPIRE_TO_VIDEO**（灵感生视频）：文字描述 → Seedance T2V 生成
- **PHOTO_ANIMATE**（照片跟我动）：静态图片 → Seedance I2V 动态化

API 入口：`POST /api/content-briefs/[briefId]/creation`

### 11.3 共享基础设施

两条产品线共享以下基础设施：
- 认证体系（同一 User 表 + JWT）
- 积分/订阅体系（credit-service / privilege-engine / subscription-service）
- 并发控制（distributed-lock / concurrency-controller）
- BullMQ 队列基础设施
- OSS 对象存储
- SSE 实时进度推送（progress-publisher）

---

## 十二、MVP 范围与阶段规划

### 第一阶段（当前）— 餐饮 MVP

- 目标行业：仅餐饮
- 核心闭环：问诊 → 画像 → 日历 → 拍摄 → 生成 → 文案 → 合规 → 导出 → 数据回填 → 复盘
- 深化改造（三件套）：复盘反哺 + 文案/合规可操作 + 拍摄引导 + 生成可控 + 画像溯源 + 计划可编辑 + 发布清单 + 任务中心

### 后续阶段（规划中）

- 多行业支持（饮品/烘焙/咖啡/火锅/烧烤/快餐）
- 自动数据抓取稳定化
- 矩阵号多账号发布（matrix-publish）
- 服务商/代运营多门店管理
- 跨店数据报表
- 自动发布到平台 API（当平台开放时）

---

## 十三、验收标准总览

### 核心验收指标

1. 商家从注册到第一次导出视频的完整路径可走通
2. 3 步问诊表单 → 门店画像在 30s 内生成完毕
3. 7 天内容日历在 30s 内生成完毕
4. 素材上传 10s 内返回质检结果
5. 一键生成 3 版视频在 600s 内完成
6. 合规检查自动执行并正确门控导出
7. 导出 180s 内完成并提供有效下载链接
8. 数据录入后可查看优化建议（≥3 条数据时）
9. 复盘建议可应用到下一轮计划生成
10. 计费流程正确（RESERVE → CHARGE/REFUND，余额不足预检拒绝）
11. 所有外部 API 调用为真实接口，无 mock/fallback

---

*文档结束*
