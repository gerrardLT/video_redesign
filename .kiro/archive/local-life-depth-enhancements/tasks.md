# Implementation Plan: 本地生活深化改造（三件套反馈控制回路）

## Overview

本实施计划基于 `requirements.md` 与 `design.md`，对既有「本地生活营销平台」服务层做**扩充式增强**，把所有「AI 输出但只读」终点统一改造为「可解释 / 可干预 / 可反哺」三件套闭环。

实施原则（贯穿所有任务，对应需求 0 全局约束）：
- 真实接口、无 fallback、无静默降级、无伪造数据；外部依赖失败显式报错。
- 所有消耗积分的 AI 动作统一复用既有 `credit-service`（reserve→charge/refund）+ `withCreditLock` 全局锁，先做余额预检，禁止新建并行计费路径、禁止 `withCreditLock` 重入。
- 数据库变更 additive-only（新增可空列 / 新表），不破坏既有数据与查询。
- 全部新增逻辑保持简体中文注释与用户文案；修改代码同步更新注释。
- 小白老板默认一键路径；高级参数收纳进「高级」抽屉，默认隐藏。
- 属性测试用 fast-check（`*.property.test.ts`，最少 100 次迭代，Node 环境）；测试任务为可选子任务（标记 `*`）。

## Tasks

- [x] 1. 数据库 additive 变更与周期口径基础设施
  - [x] 1.1 编写 Prisma additive-only schema 变更并生成迁移
    - 在 `prisma/schema.prisma` 既有表新增可空列：`ContentBrief.provenance`(Json?)、`ContentBrief.copyEdited`(Boolean @default(false))、`ContentBrief.planInputId`(String?)、`VideoVariant.regenScope`(Json?)
    - 新增表：`PlanGenerationInput`、`PlatformAccount`、`PublishQueueItem`、`Notification`、`CalendarDayState`、`StreakRecord`（字段/索引/唯一约束按 design Data Models）
    - 通过 `npx prisma migrate dev` 生成迁移并 `npx prisma generate`；确认迁移仅含 CREATE TABLE / ADD COLUMN / CREATE INDEX，无 DROP/ALTER COLUMN TYPE
    - _Requirements: 0.10_
  - [x]* 1.2 编写 additive 迁移属性测试
    - **Property 2: additive-only 迁移**
    - **Validates: Requirements 0.10**
    - 解析本 spec 产生的迁移 SQL，断言语句集合仅含 CREATE TABLE / ADD COLUMN（默认或可空）/ CREATE INDEX，且不含针对既有表的 DROP TABLE / DROP COLUMN / ALTER COLUMN TYPE / DROP CONSTRAINT
  - [x] 1.3 实现内容周期口径单点服务 `period-service`
    - 新建 `src/lib/period-service.ts`，实现 `resolvePeriods` / `periodIndexOf`，默认自然周（周一 00:00 至下周一 00:00），尊重 `StoreProfile.weeklyCadence` 配置
    - 供需求 1（跨周对比）、需求 8（提醒时长基准）、需求 11（连续创作/效果对比）统一引用，杜绝各页另立周期口径
    - _Requirements: 1.5, 8.3, 11.1_
  - [x]* 1.4 编写 period-service 单元测试
    - 验证周期边界（左闭右开）、weeklyCadence 覆盖、`periodIndexOf` 归属判定、跨月/跨年边界
    - _Requirements: 1.5_

- [x] 2. 需求1：数据复盘闭环反哺
  - [x] 2.1 扩充 `performance-learning-service`：应用建议 + 趋势 + 跨周对比 + 解锁门控
    - 在 `src/lib/performance-learning-service.ts` 新增 `applyInsights`（写入 `PlanGenerationInput`，纯写库不消耗积分）、`getMetricTrend`（按 date 升序，每个含该指标 brief 恰一次）、`getPeriodComparison`（引用 period-service，已结束周期 <2 返回 `available:false`）
    - 实现复盘解锁门控：带 metrics 的 brief 数 <3 时返回 `{ unlocked:false, remaining:N }`，不渲染建议、不伪造
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_
  - [x]* 2.2 编写「建议必带 evidence」属性测试
    - **Property 3: 每条建议必带 evidence**
    - **Validates: Requirements 1.2**
  - [x]* 2.3 编写「复盘建议应用保真」属性测试
    - **Property 4: 复盘建议应用保真**
    - **Validates: Requirements 1.3**
  - [x]* 2.4 编写「指标趋势有序且完整」属性测试
    - **Property 5: 指标趋势有序且完整**
    - **Validates: Requirements 1.4**
  - [x]* 2.5 编写「跨周对比差值一致性」属性测试
    - **Property 6: 跨周对比差值一致性**
    - **Validates: Requirements 1.5**
  - [x]* 2.6 编写「复盘解锁门槛」属性测试
    - **Property 7: 复盘解锁门槛**
    - **Validates: Requirements 1.6**
  - [x] 2.7 扩充 `content-calendar-service`：消费 PlanGenerationInput 并标注「已采纳上轮复盘建议」
    - 在 `src/lib/content-calendar-service.ts` 的内容计划生成读取未消费的 `PlanGenerationInput`（goal 偏好/复用权重/规避名单），生成计划时写入「已采纳上轮复盘建议:<摘要>」标注，并将 `consumedAt` 置位恰一次（一次性消费）
    - _Requirements: 1.3, 1.7_
  - [x]* 2.8 编写「反哺标注可见性（一次性消费）」属性测试
    - **Property 8: 反哺标注可见性（一次性消费）**
    - **Validates: Requirements 1.7**
  - [x] 2.9 实现复盘相关 API 路由
    - `GET /api/stores/[storeId]/insights`、`POST /api/stores/[storeId]/insights/apply`、`GET /api/stores/[storeId]/metrics/trend`、`GET /api/stores/[storeId]/metrics/period-comparison`
    - Route Handler 仅做校验 + 调用服务 + 返回；均不消耗积分
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.7_
  - [x] 2.10 实现 `metrics` 复盘页前端渲染与应用交互
    - 渲染 `suggestions`（含 evidence 通俗话术）、`recommendedNextGoals`、`playbooksToReuse/Avoid`、指标趋势图、跨周对比视图
    - 「应用」按钮调用 apply；<3 条时显式提示「再录入 N 条即可解锁优化建议」，不伪造
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

- [x] 3. 需求2：文案与合规可操作
  - [x] 3.1 扩充 `publish-copy-service`：就地保存 + 重生成 + 按平台改写
    - 在 `src/lib/publish-copy-service.ts` 新增 `saveManualCopy`（写回 platformCopies 并置 `copyEdited=true`，不消耗积分）、`regenerateCopy`、`rewriteForPlatform`（消耗积分，经 credit-service + withCreditLock + 余额预检；目标 `copyEdited=true` 且未 `confirmOverwrite` 时返回需确认，不覆盖）
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.8, 0.6, 0.7, 0.8_
  - [x]* 3.2 编写「文案就地编辑往返」属性测试
    - **Property 9: 文案就地编辑往返**
    - **Validates: Requirements 2.1**
  - [x]* 3.3 编写「人工修改标记保护」属性测试
    - **Property 10: 人工修改标记保护**
    - **Validates: Requirements 2.3, 2.8**
  - [x] 3.4 扩充 `compliance-service`：一键改写规避 + 自动重跑合规
    - 在 `src/lib/compliance-service.ts` 新增 `rewriteToCompliant`：读取命中违禁词/风险点(evidence)→生成去违禁文案→自动重跑 `runComplianceCheck`→仍 HIGH/BLOCKED 时 `stillBlocked=true` 显式返回剩余风险，绝不标记通过；消耗积分经 credit-service + withCreditLock + 余额预检
    - _Requirements: 2.5, 2.6, 2.7, 0.6, 0.7, 0.8_
  - [x]* 3.5 编写「改写后未通过不得标记通过」属性测试
    - **Property 11: 改写后未通过不得标记通过**
    - **Validates: Requirements 2.7**
  - [x] 3.6 实现文案/合规相关 API 路由
    - `PUT /api/content-briefs/[briefId]/copy`、`POST .../copy/regenerate`、`POST .../copy/rewrite-platform`、`POST .../compliance/rewrite`
    - 消耗积分端点在服务层执行外部推理前完成余额预检，不足显式 4xx 拒绝
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_
  - [x] 3.7 实现 `variants` 页文案/合规前端交互
    - 就地编辑标题/正文/标签/CTA；「重新生成文案」「按平台改写」覆盖人工修改时弹二次确认；BLOCKED/HIGH 展示命中词与 evidence 并挂「一键改写规避」按钮，改写后展示重跑结果与剩余风险
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

- [x] 4. 需求3：拍摄事中引导
  - [x] 4.1 扩充 `capture-director`：拍摄前引导 + 重拍建议 + 参考图生成
    - 在 `src/lib/capture-director.ts` 新增 `buildCaptureGuide`（结构化构图/清单/量化阈值，纯计算）、`buildReshootAdvice`（仅针对 `pass=false` 维度产出建议）、`generateShotReferenceImage`（复用 Flux，消耗积分经 credit-service + withCreditLock + 余额预检）
    - 量化阈值固定取值：宽高比 0.5625(±2%)、短边 ≥720、亮度均值 ≥60；durationSec 区间来源于该 ShotTask 设定
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 0.6, 0.7, 0.8_
  - [x]* 4.2 编写「拍摄指导阈值映射一致」属性测试
    - **Property 12: 拍摄指导阈值映射一致**
    - **Validates: Requirements 3.3**
  - [x]* 4.3 编写「重拍建议对应失败维度」属性测试
    - **Property 13: 重拍建议对应失败维度**
    - **Validates: Requirements 3.4**
  - [x] 4.4 实现拍摄引导相关 API 路由
    - `GET /api/shot-tasks/[shotTaskId]/guide`、`GET .../reshoot-advice`（不消耗积分）、`POST .../reference-image`（消耗积分，余额预检）
    - _Requirements: 3.1, 3.3, 3.4, 3.5, 3.6_
  - [x] 4.5 实现 `shoot` 拍摄引导页前端
    - 拍摄前可视化构图引导 + 量化阈值通俗转述 + 参考图对照 + 质检失败后的重拍建议；小白默认全展开、不暴露技术术语
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 5. 需求4：生成可控性（单版本重生成 / 局部重拍）
  - [x] 5.1 实现 `impact-scope-service`：受影响范围计算
    - 新建 `src/lib/impact-scope-service.ts` 实现 `computeReshootScope`：受影响范围 = {被重拍镜头所属分镜组} ∪ {沿 frame-continuity 尾帧链依赖的后续同场景分镜组}；承接关系数据缺失时抛错（不静默缩小范围），纯计算不消耗积分
    - _Requirements: 4.3, 4.4, 4.5_
  - [x]* 5.2 编写「受影响范围闭包不变式」属性测试
    - **Property 15: 受影响范围闭包不变式**
    - **Validates: Requirements 4.3, 4.4, 4.5**
  - [x] 5.3 扩充 `local-render-service`：单版本重生成 + 局部重拍重合成
    - 在 `src/lib/local-render-service.ts` 新增 `regenerateSingleVariant`（仅重生成指定版本，保留其它版本）、`rerenderAffectedScope`（基于 computeReshootScope 仅重渲染受影响组集合，承接链一并重算）、`RenderAdvancedParams`；复用既有计费链路（reserve→charge/refund, withCreditLock, 余额预检），高级参数写入 `VideoVariant.renderParams` 与 `regenScope`
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6, 4.7, 4.8, 4.9, 0.6, 0.7, 0.8_
  - [x]* 5.4 编写「单版本重生成隔离性」属性测试
    - **Property 14: 单版本重生成隔离性**
    - **Validates: Requirements 4.2**
  - [x]* 5.5 编写「高级参数可解释标注」属性测试
    - **Property 16: 高级参数可解释标注**
    - **Validates: Requirements 4.7**
  - [x]* 5.6 编写「额度预检与守恒」属性测试（覆盖所有消耗积分 AI 动作）
    - **Property 1: 额度预检与守恒**
    - **Validates: Requirements 0.7, 4.8, 4.9**
    - 覆盖重新生成文案 / 按平台改写 / 一键改写规避 / 生成参考图 / 单版本重生成 / 局部重拍：`balance<cost` 在预检阶段拒绝且无任何 reserve/扣减；`balance>=cost` 结果恰为 RESERVE→CHARGE 或 RESERVE→REFUND，无无 RESERVE 的 CHARGE、无双重 CHARGE
  - [x] 5.7 扩充 `render-local-video` Worker 支持局部重渲染入参
    - 在渲染 Worker 接收 `scope=受影响分镜组集合` 入参，仅重渲染受影响组；范围内某组失败则 REFUND + 标记失败 + 承接链整体回滚（避免画面断裂），临时文件 finally 清理
    - _Requirements: 4.3, 4.5, 4.9_
  - [x] 5.8 实现生成可控性 API 路由
    - `POST /api/video-variants/[variantId]/regenerate`、`POST /api/content-briefs/[briefId]/reshoot`；均消耗积分，余额不足预检阶段显式拒绝
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.8, 4.9_
  - [x] 5.9 实现 `variants` 页生成可控性前端
    - 默认一键生成 3 版无参数；「重新生成此版本」「重拍某镜头」；运营型用户「高级」抽屉（风格/时长/模板，默认隐藏）+ 结果参数标注；触发承接链扩散时提示「将一并重算 N 个后续镜头组」
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6, 4.7_

- [x] 6. 检查点 - 批次一（需求 1-4）
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. 需求5：画像→内容个性化溯源
  - [x] 7.1 扩充 `playbook-engine`：实例化记录画像引用（溯源快照）
    - 在 `src/lib/playbook-engine.ts` 新增 `instantiatePlaybookWithProvenance`，返回 draft + `BriefProvenance`（references 每条 value 属于 StoreProfile 对应字段取值集合 + 通俗 plainText），无引用时 `isGenericTemplate=true`；落库到 `ContentBrief.provenance`（生成时快照）
    - _Requirements: 5.1, 5.2, 5.6_
  - [x]* 7.2 编写「溯源引用来自画像」属性测试
    - **Property 17: 溯源引用来自画像**
    - **Validates: Requirements 5.1, 5.2**
  - [x]* 7.3 编写「无引用即通用模板」属性测试
    - **Property 19: 无引用即通用模板**
    - **Validates: Requirements 5.6**
  - [x] 7.4 扩充 `store-profile-service`：画像调整（仅对后续生效，不回溯）
    - 在 `src/lib/store-profile-service.ts` 新增 `adjustStoreProfile`（剔除钩子词/修改卖点/人设/CTA），仅更新当前画像，不改写既有 brief 的 provenance 快照；纯写库不消耗积分
    - _Requirements: 5.3, 5.4_
  - [x]* 7.5 编写「画像调整仅对后续生效且不回溯」属性测试
    - **Property 18: 画像调整仅对后续生效且不回溯**
    - **Validates: Requirements 5.3, 5.4**
  - [x] 7.6 实现溯源/画像调整 API 路由
    - `GET /api/content-briefs/[briefId]/provenance`、`PATCH /api/stores/[storeId]/profile/adjust`（均不消耗积分）
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.6_
  - [x] 7.7 实现溯源展示与画像调整前端（today/shoot/总览）
    - 用通俗话术展示画像引用（如「这条用了你的招牌『现熬8小时骨汤』」），不暴露字段名；无引用显示「通用模板」；提供调整入口并提示仅对后续生效
    - _Requirements: 5.1, 5.3, 5.5, 5.6_

- [x] 8. 需求6：内容计划可编辑
  - [x] 8.1 扩充 `content-calendar-service`：编辑/新增 brief + 锁定跳过
    - 在 `src/lib/content-calendar-service.ts` 新增 `editContentBrief`（改期/换 goal/换 playbook/删除）、`addContentBrief`、`setDayLockState`；换 goal/playbook 时重实例化镜头脚本与文案草稿（基于 StoreProfile）；单日上界默认 3（可由 weeklyCadence 覆盖）超出显式拒绝；已拍素材保留并返回 `assetWarning`；纯写库不消耗积分
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.7_
  - [x]* 8.2 编写「单日 brief 数量上界」属性测试
    - **Property 20: 单日 brief 数量上界**
    - **Validates: Requirements 6.2**
  - [x]* 8.3 编写「换选题重实例化」属性测试
    - **Property 21: 换选题重实例化**
    - **Validates: Requirements 6.3**
  - [x]* 8.4 编写「换选题保留已拍素材」属性测试
    - **Property 22: 换选题保留已拍素材**
    - **Validates: Requirements 6.4**
  - [x]* 8.5 编写「锁定/跳过被尊重」属性测试
    - **Property 23: 锁定/跳过被尊重**
    - **Validates: Requirements 6.5, 6.7**
  - [x] 8.6 实现计划编辑 API 路由
    - `POST/PATCH/DELETE /api/content-briefs(+/[briefId])`、`PUT /api/stores/[storeId]/calendar/day-lock`（均不消耗积分）
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [x] 8.7 实现 `calendar` 计划可编辑前端
    - 某天 brief 的改期/换 goal/换 playbook/删除/新增；锁定/跳过；保存确认或撤销避免误操作；空缺如实展示不自动填充；换选题且有已拍素材时显式提示确认是否重拍
    - _Requirements: 6.1, 6.4, 6.5, 6.6, 6.7_

- [x] 9. 检查点 - 批次二（需求 5-6）
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. 需求7：自营账号数据自动抓取
  - [x] 10.1 实现 `platform-metrics-crawler`：授权/凭证/抓取
    - 新建 `src/lib/platform-metrics-crawler.ts` 实现 `requestAccountLink`（风险告知 + 授权确认前置）、`saveCredential`（`authConfirmed=false` 拒绝；cookie 服务端加密存储，提供 encrypt/decrypt 往返）、`crawlAccountMetrics`（写入 PublishMetric `source=API_SYNC`；失败标记 `NEEDS_RELINK` 且不写任何 metric；与 MANUAL 记录共存不覆盖）
    - 凭证加密密钥取自环境变量（如 `PLATFORM_CRED_ENC_KEY`），缺失时直接抛错（不静默），禁止明文存储
    - 抓取频率门控：`now - lastCrawledAt >= interval`（interval∈[6,24]h，默认 24h）
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.8_
  - [x]* 10.2 编写「授权确认前置」属性测试
    - **Property 24: 授权确认前置**
    - **Validates: Requirements 7.2**
  - [x]* 10.3 编写「凭证加密往返」属性测试
    - **Property 25: 凭证加密往返**
    - **Validates: Requirements 7.4**
  - [x]* 10.4 编写「抓取频率门控」属性测试
    - **Property 26: 抓取频率门控**
    - **Validates: Requirements 7.5**
  - [x]* 10.5 编写「抓取失败不伪造」属性测试
    - **Property 27: 抓取失败不伪造**
    - **Validates: Requirements 7.6**
  - [x]* 10.6 编写「来源共存不覆盖」属性测试
    - **Property 28: 来源共存不覆盖**
    - **Validates: Requirements 7.8**
  - [x] 10.7 实现 `crawl-platform-metrics` Worker 并注册受控定时调度
    - 新建 `src/workers/crawl-platform-metrics.ts`，在 `src/lib/queue.ts` 注册重复任务；按账号 `lastCrawledAt` 门控（系统级最小间隔 ≥6h）；单账号失败隔离 + 触发 `CRAWL_FAILED` 通知，不影响其它账号、不重试伪造
    - _Requirements: 7.5, 7.6_
  - [x] 10.8 实现平台账号关联 API 路由
    - `POST /api/stores/[storeId]/platform-accounts`（授权确认 + 保存凭证，不消耗积分）
    - _Requirements: 7.2, 7.3, 7.4_
  - [x] 10.9 实现平台账号关联前端
    - 关联前明示 ToS/反爬/账号安全风险与授权确认；明示抓取脆弱性边界；来源冲突标注（自动/手动）由商家选择；失效显示「需重新关联」入口；保留手动录入作为永久兜底
    - _Requirements: 7.1, 7.2, 7.7, 7.8_

- [x] 11. 需求8：发布闭环（清单 + 提醒）
  - [x] 11.1 实现 `publish-queue-service`：待发布清单 + 标记发布
    - 新建 `src/lib/publish-queue-service.ts` 实现 `enqueueForPublish`（每个导出 variant 恰一个 PublishQueueItem）、`listPublishQueue`、`markPublished`（记录平台与时间，纳入后续复盘范围）
    - _Requirements: 8.1, 8.2, 8.4_
  - [x]* 11.2 编写「导出与清单一一对应」属性测试
    - **Property 29: 导出与清单一一对应**
    - **Validates: Requirements 8.1**
  - [x]* 11.3 编写「发布标记往返」属性测试
    - **Property 31: 发布标记往返**
    - **Validates: Requirements 8.4**
  - [x] 11.4 扩充 `notification-worker`：发布超时提醒（恰一次语义）
    - 在 `src/workers/notification-worker.ts` 增加：导出后超过 `remindAfterH`（默认 24h，基于 period/时间）未标记发布则触发一次提醒；`reminded` 仅在发送成功后置位，保证恰一次
    - _Requirements: 8.3_
  - [x]* 11.5 编写「超时提醒恰一次」属性测试
    - **Property 30: 超时提醒恰一次**
    - **Validates: Requirements 8.3**
  - [x] 11.6 接线：导出成功后加入待发布清单
    - 在导出/合并成功路径调用 `enqueueForPublish`，记录目标平台维度发布状态
    - _Requirements: 8.1_
  - [x] 11.7 实现发布闭环 API 路由
    - `GET /api/stores/[storeId]/publish-queue`、`POST /api/publish-queue/[itemId]/mark-published`（均不消耗积分）
    - _Requirements: 8.2, 8.4_
  - [x] 11.8 实现待发布清单前端
    - 清单视图（未发布/已发布到 X 平台）；发布引导（复制文案/下载视频/跳转平台入口）；手动标记已发布；明确为「清单+提醒+手动标记」不伪装一键自动分发
    - _Requirements: 8.2, 8.4, 8.5, 8.6_

- [x] 12. 检查点 - 批次三（需求 7-8）
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. 需求9：全局任务与通知中心
  - [x] 13.1 实现 `task-center-service`：任务聚合 + 通知中心
    - 新建 `src/lib/task-center-service.ts` 实现 `getTaskCenter`（按当前所选门店作用域聚合 待拍摄/渲染中/待导出/待发布；每项携带非空 `actionHref`；仅真实状态不含占位）与通知查询/已读切换（按门店作用域）
    - _Requirements: 9.1, 9.3, 9.4, 9.5_
  - [x]* 13.2 编写「任务中心作用域、真实性与可跳转」属性测试
    - **Property 32: 任务中心作用域、真实性与可跳转**
    - **Validates: Requirements 9.1, 9.4, 9.5**
  - [x]* 13.3 编写「通知作用域与已读切换」属性测试
    - **Property 33: 通知作用域与已读切换**
    - **Validates: Requirements 9.3**
  - [x] 13.4 实现任务/通知中心 API 路由
    - `GET /api/stores/[storeId]/task-center`、`GET /api/stores/[storeId]/notifications`、`PATCH /api/stores/[storeId]/notifications/[notificationId]/read`（标记已读，写入 `read=true`；挂门店作用域路径，避免与既有 `/api/notifications/[id]/read` 的 slug 冲突）（均不消耗积分）
    - _Requirements: 9.1, 9.2, 9.3_
  - [x] 13.5 实现任务/通知中心前端 + SSE 实时刷新
    - 复用既有 `progress-publisher`（SSE）近实时刷新任务状态；通知已读/未读；点击任务/通知直达 shoot/variants/metrics 等可操作页
    - _Requirements: 9.2, 9.3, 9.4_

- [x] 14. 需求10：多门店切换与跨店看板
  - [x] 14.1 实现 `cross-store-service`：门店切换器数据 + 跨店看板聚合
    - 新建 `src/lib/cross-store-service.ts` 实现 `getStoreSwitcher`（仅 `maxStores>1 AND storeCount>1` 时返回多店，否则 `multiStore:false`，privilege-engine 提供 maxStores）与 `getCrossStoreDashboard`（真实聚合各店本周完成度/最佳视频表现/待办数，不占位）
    - _Requirements: 10.1, 10.3, 10.4, 10.5_
  - [x]* 14.2 编写「切换器可见性等价」属性测试
    - **Property 34: 切换器可见性等价**
    - **Validates: Requirements 10.1, 10.4**
  - [x]* 14.3 编写「跨店看板真实聚合」属性测试
    - **Property 35: 跨店看板真实聚合**
    - **Validates: Requirements 10.3, 10.5**
  - [x] 14.4 实现多门店 API 路由
    - `GET /api/stores/switcher`、`GET /api/stores/dashboard`、`POST /api/stores/switch`（统一 `currentStoreId` 作用域键，不消耗积分）
    - _Requirements: 10.1, 10.2, 10.3_
  - [x] 14.5 实现门店切换器与跨店看板前端
    - 切换门店保持当前功能上下文加载目标门店数据；单店/权益不支持时隐藏切换器与看板（不展示空壳）
    - _Requirements: 10.1, 10.2, 10.4, 10.5_

- [x] 15. 需求11：激励与留存
  - [x] 15.1 实现 `engagement-service`：连续创作 + 里程碑 + 效果对比 + 进阶引导
    - 新建 `src/lib/engagement-service.ts` 实现 `getStreak`（基于 period-service 的最大连续发布段，仅真实数据）、`checkMilestones`（达成条件成立时返回；检测到新达成里程碑时写入一条 `Notification(type=MILESTONE, actionHref=激励页)` 使其在通知中心可见）、`getGrowthComparison`（本月最佳 vs 上月最佳，历史不足返回 `available:false`）、`getOnboardingProgress`（渐进式进阶任务）
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 9.3_
  - [x]* 15.2 编写「连续创作计算正确」属性测试
    - **Property 36: 连续创作计算正确**
    - **Validates: Requirements 11.1, 11.5**
  - [x]* 15.3 编写「里程碑触发等价」属性测试
    - **Property 37: 里程碑触发等价**
    - **Validates: Requirements 11.2**
  - [x]* 15.4 编写「效果对比取真实最佳」属性测试
    - **Property 38: 效果对比取真实最佳**
    - **Validates: Requirements 11.3**
  - [x] 15.5 实现激励留存 API 路由
    - `GET /api/stores/[storeId]/engagement`（连续创作/里程碑/效果对比/进阶引导，不消耗积分）
    - _Requirements: 11.1, 11.2, 11.3, 11.4_
  - [x] 15.6 实现激励留存前端
    - 连续创作展示 + 里程碑徽章/进度/鼓励文案 + 真实效果对比（含 evidence）+ 新手进阶引导；数据不足显式提示不制造虚假成长
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

- [x] 16. 集成测试（真实接口 / 接线代表性样例）
  - [x]* 16.1 文案重生成 / 按平台改写 / 一键改写规避计费链路集成测试
    - 走真实 LLM 接口，验证 reserve→charge/refund 与 `withCreditLock` 串行
    - _Requirements: 2.2, 2.4, 2.6, 0.6, 0.8_
  - [x]* 16.2 镜头参考图生成计费集成测试
    - 真实图像生成 + 计费链路，失败 REFUND 不返回假图
    - _Requirements: 3.5_
  - [x]* 16.3 单版本重生成 / 局部重拍集成测试
    - 真实 Seedance + FFmpeg，验证受影响范围重渲染与承接不断裂
    - _Requirements: 4.2, 4.3, 4.5_
  - [x]* 16.4 平台账号关联与受控抓取集成测试
    - 真实凭证流程 + BullMQ 受控抓取写入 PublishMetric，失败标记 NEEDS_RELINK
    - _Requirements: 7.3, 7.5, 7.6_
  - [x]* 16.5 任务中心 SSE 实时刷新与门店切换上下文保持集成测试
    - _Requirements: 9.2, 10.2_

- [x] 17. 最终检查点 - 确保全部测试通过
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- 标记 `*` 的子任务为可选（属性测试 / 单元测试 / 集成测试），可为加速 MVP 跳过；核心实现任务不可标记可选。
- 每个任务引用具体需求条款（granular sub-requirements）以保证可追溯。
- 检查点（任务 6/9/12/17）在批次边界做增量验证。
- 属性测试验证 design「Correctness Properties」中的 38 条通用不变式（Property 1-38 全覆盖），使用 fast-check，最少 100 次迭代。
- 所有消耗积分的 AI 动作统一复用 `credit-service` + `withCreditLock` + 余额预检，禁止新建并行计费路径、禁止锁重入。
- 数据库变更 additive-only；新增逻辑保持简体中文注释与文案。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3"] },
    { "id": 1, "tasks": ["1.2", "1.4", "2.1", "2.7", "3.1", "3.4", "4.1", "5.1", "7.1", "7.4", "10.1", "11.1", "13.1", "14.1", "15.1"] },
    { "id": 2, "tasks": ["5.3", "8.1", "10.7", "11.4", "11.6", "2.2", "2.3", "2.4", "2.5", "2.6", "2.8", "3.2", "3.3", "3.5", "4.2", "4.3", "5.2", "7.2", "7.3", "7.5", "10.2", "10.3", "10.4", "10.5", "10.6", "11.2", "11.3", "13.2", "13.3", "14.2", "14.3", "15.2", "15.3", "15.4"] },
    { "id": 3, "tasks": ["5.4", "5.5", "5.6", "5.7", "8.2", "8.3", "8.4", "8.5", "11.5", "2.9", "3.6", "4.4", "5.8", "7.6", "8.6", "10.8", "11.7", "13.4", "14.4", "15.5"] },
    { "id": 4, "tasks": ["2.10", "3.7", "4.5", "5.9", "7.7", "8.7", "10.9", "11.8", "13.5", "14.5", "15.6"] },
    { "id": 5, "tasks": ["16.1", "16.2", "16.3", "16.4", "16.5"] }
  ]
}
```
