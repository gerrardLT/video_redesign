# 项目测试覆盖差距分析报告

> 生成时间: 2026-06-30
> 扫描范围: API 路由 / Workers / 核心 Service 层

---

## 现有测试概览

| 测试类型 | 位置 | 文件数 |
|---------|------|-------|
| 属性测试 (Property) | `tests/properties/` | 55 |
| 单元测试 (Unit) | `tests/unit/` | 15 |
| 集成测试 (Integration) | `tests/integration/` | 9 |
| 视觉测试 (Visual) | `tests/visual/` | 1 |
| Lib 单元测试 | `src/lib/__tests__/` | 10 |
| SSE 模块测试 | `src/lib/sse/__tests__/` | 4 |
| Worker 测试 | `src/workers/__tests__/` | 1 |

---

## 业务流程1: 视频重绘完整链路

### 上传 → 解析 → 编辑 → 生成 → 合并导出 → 超分

| 环节 | 相关文件 | 现有测试 | 覆盖状态 | 缺失什么 |
|------|---------|---------|---------|---------|
| 视频上传 | `api/upload/route.ts`, `api/upload-image/route.ts` | 无 | ❌ 无覆盖 | API 参数校验、文件大小/格式限制、OSS 上传流程 |
| 链接导入 | `api/projects/import-link/route.ts`, `workers/download-video.ts` | `video-import.property.test.ts`, `video-import-service.test.ts` | ✅ 有覆盖 | — |
| 视频解析 | `workers/parse-video.ts`, `lib/video/video-analyzer.ts`, `lib/video/ffmpeg.ts` | `video-pipeline.property.test.ts`, `video-pipeline.integration.test.ts` | ✅ 部分覆盖 | Worker 本身的错误处理/重试逻辑未单独测试 |
| 分镜分组 | `lib/video/grouping-service.ts`, `lib/video/script-merger.ts` | `video-pipeline.property.test.ts` | ✅ 部分覆盖 | grouping-service 独立单测缺失 |
| 分镜编辑 | `api/shots/[id]/route.ts`, `api/shot-groups/[id]/route.ts` | 无 | ❌ 无覆盖 | 分镜 CRUD、分组更新的 API 测试 |
| 人物形象 | `api/characters/[id]/generate-image/route.ts`, `workers/generate-character.ts` | 无 | ❌ 无覆盖 | 人物生成流程、形象锚定逻辑 |
| 视频生成 | `api/projects/[id]/generate/route.ts`, `workers/generate-video.ts`, `lib/video/generation-orchestrator.ts` | `generation-params.property.test.ts`, `workspace-generation.property.test.ts` | ✅ 部分覆盖 | Worker 链式串行逻辑、尾帧承接、异常中断恢复 |
| 版本历史 | `api/shot-groups/[id]/versions/route.ts`, `lib/video/version-history-service.ts` | `version-history-service.test.ts` | ✅ 有覆盖 | — |
| 视频合并 | `api/projects/[id]/export/route.ts`, `workers/merge-video.ts`, `lib/video/transition-engine.ts` | `merge-video.test.ts`, `transition-engine.test.ts`, `transition-engine.property.test.ts` | ✅ 有覆盖 | — |
| 视频超分 | `workers/upscale-video.ts`, `lib/video/wavespeed.ts` | `video-export-upscale.property.test.ts`, `video-export-upscale.test.ts` | ✅ 有覆盖 | — |
| 工作台生成 | `api/workspace/generate/route.ts`, `lib/video/workspace-generation-service.ts` | `workspace-generation.property.test.ts`, `workspace-generation.test.ts` | ✅ 有覆盖 | — |
| 帧连续性 | `lib/video/frame-continuity.ts` | 无 | ❌ 无覆盖 | 同场景尾帧承接算法 |
| 参考图构建 | `lib/video/reference-builder.ts`, `lib/video/group-gen-context.ts` | `reference-builder.test.ts` | ✅ 部分覆盖 | group-gen-context 缺测试 |
| Prompt 解析 | `lib/video/prompt-parser.ts` | `prompt-parser.property.test.ts`, `prompt-parser.test.ts` | ✅ 有覆盖 | — |
| 预览变换 | `lib/video/preview-transform.ts` | `preview-transform.test.ts` | ✅ 有覆盖 | — |
| Seedance API | `lib/video/seedance.ts` | `seedance.test.ts` | ✅ 有覆盖 | — |
| 看门狗 | `workers/parse-watchdog.ts`, `workers/generate-watchdog.ts` | 无 | ❌ 无覆盖 | 卡死任务检测、退款解卡逻辑 |
| 人脸检测 | `workers/face-check.ts` | 无 | ❌ 无覆盖 | 人脸审核结果处理 |
| HappyHorse | `api/projects/[id]/generate-happyhorse/route.ts`, `lib/shared/happyhorse.ts` | 无 | ❌ 无覆盖 | 第三方引擎调用、估算逻辑 |


---

## 业务流程2: 本地生活商家平台

### 商家入驻 → 门店画像 → 内容计划 → 拍摄任务 → 视频渲染 → 合规 → 发布 → 数据复盘

| 环节 | 相关文件 | 现有测试 | 覆盖状态 | 缺失什么 |
|------|---------|---------|---------|---------|
| 商家入驻 | `api/merchant/onboarding/route.ts`, `lib/merchant/merchant-auth.ts` | 无 | ❌ 无覆盖 | Onboarding 流程、商家认证 |
| 门店管理 | `api/stores/route.ts`, `api/stores/[storeId]/route.ts` | `store-switcher.property.test.ts` | ✅ 部分覆盖 | 门店 CRUD API 缺直接测试 |
| 门店画像 | `api/stores/[storeId]/profile/route.ts`, `lib/merchant/store-profile-service.ts` | `profile-adjust.property.test.ts` | ✅ 部分覆盖 | 画像生成/重新生成的完整流程 |
| 内容计划 | `api/stores/[storeId]/content-plan/*/route.ts`, `workers/generate-content-plan.ts`, `lib/merchant/content-calendar-service.ts` | `plan-input-consume.property.test.ts` | ✅ 部分覆盖 | Worker 流程、7天日历生成算法 |
| 剧本引擎 | `api/stores/[storeId]/playbooks/route.ts`, `lib/merchant/playbook-engine.ts` | 无 | ❌ 无覆盖 | 行业剧本选择/实例化逻辑 |
| 拍摄任务 | `api/content-briefs/[briefId]/shot-tasks/route.ts`, `lib/merchant/capture-director.ts` | `reshoot-advice.property.test.ts` | ✅ 部分覆盖 | 素材质量检测、拍摄指南生成 |
| 参考图/指南 | `api/shot-tasks/[shotTaskId]/guide/route.ts`, `api/shot-tasks/[shotTaskId]/reference-image/route.ts` | `shot-reference-billing.integration.test.ts` | ✅ 部分覆盖 | — |
| 素材上传 | `api/content-briefs/[briefId]/assets/route.ts` | `reshoot-asset-retention.property.test.ts` | ✅ 部分覆盖 | 素材上传校验 |
| 本地视频渲染 | `api/content-briefs/[briefId]/render/route.ts`, `workers/render-local-video.ts`, `lib/merchant/local-render-service.ts` | `render-params.property.test.ts`, `regen-reshoot.integration.test.ts` | ✅ 部分覆盖 | Worker 完整流程测试 |
| 一键出片 | `api/content-briefs/[briefId]/auto-render/route.ts`, `lib/merchant/ai-auto-render-service.ts` | 无 | ❌ 无覆盖 | 全 AI 出片编排逻辑 |
| 视频版本 | `api/content-briefs/[briefId]/variants/route.ts`, `api/video-variants/[variantId]/*/route.ts` | `regen-variant.property.test.ts` | ✅ 部分覆盖 | — |
| 合规审查 | `api/content-briefs/[briefId]/compliance/route.ts`, `workers/compliance-review.ts`, `lib/merchant/compliance-service.ts` | `rewrite-compliance.property.test.ts`, `copy-compliance-billing.integration.test.ts` | ✅ 有覆盖 | — |
| 文案生成 | `api/content-briefs/[briefId]/copy/route.ts`, `lib/merchant/copy-generator.ts`, `lib/merchant/publish-copy-service.ts` | `manual-copy.property.test.ts` | ✅ 部分覆盖 | copy-generator LLM 调用测试 |
| 发布队列 | `api/stores/[storeId]/publish-queue/route.ts`, `api/publish-queue/[itemId]/mark-published/route.ts`, `lib/merchant/publish-queue-service.ts` | `publish-queue.property.test.ts`, `mark-published.property.test.ts`, `publish-reminder.property.test.ts` | ✅ 有覆盖 | — |
| 矩阵发布 | `workers/matrix-publish.ts`, `lib/merchant/matrix-dispatch-service.ts` | 无 | ❌ 无覆盖 | 多账号发布逻辑、平台适配 |
| 数据抓取 | `workers/crawl-platform-metrics.ts`, `lib/merchant/platform-metrics-crawler.ts` | `platform-crawl.integration.test.ts`, `metric-source.property.test.ts` | ✅ 有覆盖 | — |
| 数据复盘 | `api/stores/[storeId]/insights/route.ts`, `lib/merchant/performance-learning-service.ts` | `performance-learning.property.test.ts`, `insights-unlock.property.test.ts` | ✅ 有覆盖 | — |
| 趋势分析 | `api/stores/[storeId]/metrics/trend/route.ts` | `metric-trend.property.test.ts`, `period-comparison.property.test.ts` | ✅ 有覆盖 | — |
| 同质化检测 | `lib/merchant/content-entropy-service.ts` | `content-entropy.property.test.ts` | ✅ 有覆盖 | — |
| 任务中心 | `api/stores/[storeId]/task-center/route.ts`, `lib/merchant/task-center-service.ts` | `task-center.property.test.ts`, `task-center-sse-store-switch.integration.test.ts` | ✅ 有覆盖 | — |
| 商家计费 | `lib/merchant/merchant-billing-service.ts` | `merchant-billing-flow.test.ts` | ✅ 有覆盖 | — |
| 商家订阅 | `api/merchant/subscription/route.ts` | 无 | ❌ 无覆盖 | 商家维度订阅逻辑 |
| 内容评分 | `lib/merchant/content-score-service.ts` | 无 | ❌ 无覆盖 | 评分算法 |
| POI注入 | `lib/merchant/poi-injection-service.ts` | 无 | ❌ 无覆盖 | POI 地理信息注入 |
| 日历锁定 | `api/stores/[storeId]/calendar/day-lock/route.ts` | `day-lock.property.test.ts` | ✅ 有覆盖 | — |


---

## 业务流程3: 认证与用户管理

| 环节 | 相关文件 | 现有测试 | 覆盖状态 | 缺失什么 |
|------|---------|---------|---------|---------|
| 用户注册 | `api/auth/register/route.ts` | `auth.test.ts` | ✅ 有覆盖 | — |
| 用户登录 | `api/auth/login/route.ts` | `auth.test.ts` | ✅ 有覆盖 | — |
| 登出 | `api/auth/logout/route.ts` | 无 | ❌ 无覆盖 | Cookie 清理逻辑 |
| 当前用户 | `api/auth/me/route.ts` | 无 | ❌ 无覆盖 | JWT 解析、用户信息返回 |
| 开发登录 | `api/auth/dev-login/route.ts` | 无 | ⚠️ 仅开发环境 | 环境门控检查 |
| 认证中间件 | `lib/shared/auth.ts`, `lib/shared/auth-helpers.ts` | `auth.test.ts` | ✅ 有覆盖 | — |
| 商家认证 | `api/merchant/me/route.ts`, `lib/merchant/merchant-auth.ts` | 无 | ❌ 无覆盖 | 商家身份校验、门店权限 |
| 限流 | `lib/shared/rate-limiter.ts` | 无 | ❌ 无覆盖 | 滑动窗口/令牌桶算法 |

---

## 业务流程4: 积分与订阅

| 环节 | 相关文件 | 现有测试 | 覆盖状态 | 缺失什么 |
|------|---------|---------|---------|---------|
| 积分余额 | `api/credits/balance/route.ts`, `lib/shared/credit-service.ts` | `credit-service-upscale.property.test.ts` | ✅ 部分覆盖 | 仅覆盖超分场景，RESERVE/CHARGE/REFUND 全流程缺失 |
| 积分历史 | `api/credits/history/route.ts` | 无 | ❌ 无覆盖 | 流水查询 API |
| 积分计算 | `lib/shared/credit-calc.ts`, `lib/shared/credit-dispatcher.ts` | 无 | ❌ 无覆盖 | 不同操作的积分计价规则 |
| 分布式锁 | `lib/shared/distributed-lock.ts` | 无 | ❌ 无覆盖 | 锁获取/释放/超时、跨进程串行化 |
| 并发控制 | `lib/shared/concurrency-controller.ts`, `workers/concurrency-reconcile.ts` | `concurrency.property.test.ts` | ✅ 部分覆盖 | reconcile 看门狗逻辑 |
| 订阅创建 | `api/subscriptions/create/route.ts`, `lib/shared/subscription-service.ts` | 无 | ❌ 无覆盖 | 订阅创建、套餐选择 |
| 订阅续费 | `api/subscriptions/renew/route.ts`, `workers/subscription-renewal-worker.ts` | 无 | ❌ 无覆盖 | 自动续费逻辑 |
| 订阅过期 | `workers/subscription-expire-worker.ts` | 无 | ❌ 无覆盖 | 到期降级处理 |
| 订阅取消 | `api/subscriptions/cancel/route.ts` | 无 | ❌ 无覆盖 | 取消退款计算 |
| 订阅状态 | `api/subscriptions/status/route.ts` | 无 | ❌ 无覆盖 | 状态查询 |
| 套餐列表 | `api/subscriptions/plans/route.ts`, `api/packages/route.ts` | `packages-page.property.test.ts`, `package-card.property.test.ts` | ✅ 部分覆盖 | 后端 API 直接测试缺失 |
| 支付回调 | `api/payments/alipay/callback/route.ts`, `api/payments/wechat/callback/route.ts` | `payment-gateway.property.test.ts` | ✅ 部分覆盖 | 签名验证、幂等处理 |
| 订阅回调 | `api/payments/alipay/subscription-callback/route.ts`, `api/payments/wechat/subscription-callback/route.ts` | 无 | ❌ 无覆盖 | 订阅支付回调处理 |
| 订单管理 | `api/orders/route.ts`, `lib/shared/order-service.ts` | `order-service.property.test.ts` | ✅ 有覆盖 | — |
| 订单过期 | `workers/order-expire-worker.ts` | 无 | ❌ 无覆盖 | 超时订单处理 |
| 特权引擎 | `lib/shared/privilege-engine.ts`, `lib/shared/priority-scheduler.ts` | 无 | ❌ 无覆盖 | 用户等级→并发/优先级映射 |


---

## 业务流程5: 资产管理

| 环节 | 相关文件 | 现有测试 | 覆盖状态 | 缺失什么 |
|------|---------|---------|---------|---------|
| 资产库列表 | `api/asset-library/route.ts`, `lib/shared/asset-library-service.ts` | `asset-library-service.test.ts`, `asset-library-service.property.test.ts`, `asset-library-enhancements.property.test.ts` | ✅ 有覆盖 | — |
| 资产上传 | `api/asset-library/upload/route.ts`, `api/assets/presign/route.ts`, `api/assets/confirm/route.ts` | `asset-ingestion-service.test.ts` | ✅ 部分覆盖 | presign/confirm API 层 |
| 资产收藏 | `api/assets/[id]/bookmark/route.ts` | `bookmark-api.test.ts` | ✅ 有覆盖 | — |
| 资产续期 | `api/assets/[id]/renew/route.ts` | 无 | ❌ 无覆盖 | 续期逻辑 |
| 资产过期 | `lib/shared/asset-lifecycle-service.ts`, `workers/asset-cleanup-worker.ts` | `idempotent-cleanup.property.test.ts`, `notification-expiry.property.test.ts` | ✅ 有覆盖 | — |
| 过期状态 | `lib/shared/expiry-status.ts` | `expiry-status.test.ts` | ✅ 有覆盖 | — |
| 资产下载 | `api/asset-library/[id]/download/route.ts` | 无 | ❌ 无覆盖 | 签名 URL 生成 |
| 媒体代理 | `api/media/[...key]/route.ts` | 无 | ❌ 无覆盖 | OSS 媒体代理访问 |
| OSS 存储 | `lib/shared/storage.ts` | 无 | ❌ 无覆盖 | 上传/删除/签名 URL |
| 项目资产 | `api/projects/[id]/assets/route.ts` | 无 | ❌ 无覆盖 | 项目关联资产查询 |

---

## 业务流程6: 管理后台

| 环节 | 相关文件 | 现有测试 | 覆盖状态 | 缺失什么 |
|------|---------|---------|---------|---------|
| 用户管理 | `api/admin/users/route.ts` | 无 | ❌ 无覆盖 | 用户列表/搜索 |
| 项目管理 | `api/admin/projects/route.ts` | 无 | ❌ 无覆盖 | 项目列表 |
| 订单管理 | `api/admin/orders/route.ts`, `api/admin/orders/stats/route.ts` | 无 | ❌ 无覆盖 | 管理员订单查看/统计 |
| 积分调整 | `api/admin/credits/adjust/route.ts`, `api/admin/credits/ledger/route.ts` | 无 | ❌ 无覆盖 | 手动调额、台账审计 |
| 任务管理 | `api/admin/jobs/route.ts`, `api/admin/jobs/[id]/retry/route.ts` | 无 | ❌ 无覆盖 | 任务列表/重试 |
| 资产审计 | `api/admin/assets/route.ts`, `api/admin/assets/stats/route.ts` | 无 | ❌ 无覆盖 | 资产统计/管理 |
| 内容安全 | `api/admin/content-safety/route.ts`, `api/admin/content-safety/[id]/review/route.ts` | 无 | ❌ 无覆盖 | 内容安全审核 |
| 案例管理 | `api/admin/showcase/route.ts`, `api/admin/showcase/[id]/route.ts` | 无 | ❌ 无覆盖 | 案例 CRUD |
| 帮助文章 | `api/admin/help-articles/route.ts` | 无 | ❌ 无覆盖 | 文章管理 |

---

## 业务流程7: 辅助功能

| 环节 | 相关文件 | 现有测试 | 覆盖状态 | 缺失什么 |
|------|---------|---------|---------|---------|
| SSE 进度推送 | `api/sse/progress/route.ts`, `lib/sse/*` | `chain-progress.property.test.ts`, `connection-registry.property.test.ts`, `event-serializer.property.test.ts`, `redis-subscriber.test.ts` | ✅ 有覆盖 | — |
| 进度发布 | `lib/shared/progress-publisher.ts` | `progress-publisher.test.ts` | ✅ 有覆盖 | — |
| 通知系统 | `api/notifications/route.ts`, `workers/notification-worker.ts`, `lib/shared/notification-service.ts` | `notification.property.test.ts`, `notification-expiry.property.test.ts` | ✅ 有覆盖 | — |
| 帮助中心 | `api/help-articles/route.ts`, `lib/shared/help-center-service.ts` | `help-center.property.test.ts`, `help-center-service.test.ts` | ✅ 有覆盖 | — |
| 案例展示 | `api/showcase/route.ts`, `lib/shared/showcase-service.ts` | `showcase.property.test.ts` | ✅ 有覆盖 | — |
| 新手引导 | `api/onboarding/route.ts`, `lib/shared/onboarding-service.ts` | `stepper.property.test.ts` | ✅ 部分覆盖 | API 层直接测试 |
| 风格模板 | `api/styles/templates/route.ts`, `lib/shared/style-service.ts` | `style-service.property.test.ts` | ✅ 有覆盖 | — |
| DB 重试 | `lib/shared/db-retry.ts` | `db-retry.test.ts` | ✅ 有覆盖 | — |
| 状态机 | `lib/shared/state-machine.ts` | `state-machine.property.test.ts` | ✅ 有覆盖 | — |
| Flux/Seedream | `lib/shared/flux.ts` | 无 | ❌ 无覆盖 | 文生图/图生图 API 客户端 |
| 视频导入 | `lib/shared/video-import-service.ts` | `video-import.property.test.ts`, `video-import-service.test.ts` | ✅ 有覆盖 | — |
| 周报 | `workers/weekly-merchant-report.ts` | 无 | ⚠️ 占位文件 | 第一阶段占位，暂不需要 |
| 数据同步 | `workers/sync-metrics.ts` | 无 | ⚠️ 占位文件 | 第一阶段占位，暂不需要 |


---

## 覆盖率统计摘要

| 类别 | 总模块数 | 有测试 | 覆盖率 |
|------|---------|--------|--------|
| API 路由 (route.ts) | 130 | ~25 (通过 service 层间接覆盖) | ~19% |
| Workers | 22 (排除 index.ts) | 3 (直接) + 5 (间接) | ~36% |
| 核心 Service (shared) | 42 | 18 | ~43% |
| 核心 Service (merchant) | 31 | 15 | ~48% |
| 核心 Service (video) | 24 | 14 | ~58% |
| SSE 模块 | 4 | 4 | 100% |

---

## 优先级排序补写建议

### P0 (必须有) — 核心收入链路、数据一致性关键路径

| # | 模块 | 理由 | 建议测试类型 |
|---|------|------|-------------|
| 1 | `credit-service.ts` 完整 RESERVE/CHARGE/REFUND 流程 | 积分是核心货币，写丢失=直接经济损失 | 属性测试 + 集成测试 |
| 2 | `credit-calc.ts` + `credit-dispatcher.ts` | 计价规则错误=多扣/少扣 | 单元测试 + 属性测试 |
| 3 | `distributed-lock.ts` | 锁失败=并发写丢失 | 属性测试 (模拟竞争) |
| 4 | `subscription-service.ts` 全生命周期 | 订阅=核心收入，创建/续费/过期/取消 | 集成测试 |
| 5 | 支付回调签名验证 (`payments/*/callback`) | 签名校验失败=资金安全风险 | 单元测试 |
| 6 | 订阅回调 (`payments/*/subscription-callback`) | 订阅支付状态同步 | 单元测试 |
| 7 | `privilege-engine.ts` + `priority-scheduler.ts` | 等级映射错误=付费用户体验降级 | 属性测试 |
| 8 | `order-expire-worker.ts` | 订单超时不过期=资金冻结 | 单元测试 |

### P1 (应该有) — 主要用户流程、异常处理

| # | 模块 | 理由 | 建议测试类型 |
|---|------|------|-------------|
| 1 | `parse-video.ts` Worker 完整流程 | 解析是用户第一步操作，失败体验极差 | 集成测试 |
| 2 | `generate-video.ts` 链式串行 + 异常恢复 | 生成中断=积分白扣 | 单元测试 |
| 3 | `generate-watchdog.ts` + `parse-watchdog.ts` | 看门狗失效=任务永久卡死 | 单元测试 |
| 4 | 商家入驻流程 (`merchant/onboarding`) | 商家第一印象 | 集成测试 |
| 5 | `playbook-engine.ts` | 剧本是内容计划的基础 | 单元测试 + 属性测试 |
| 6 | `ai-auto-render-service.ts` 一键出片 | 商家核心卖点功能 | 集成测试 |
| 7 | `rate-limiter.ts` | 限流失效=API 被滥用 | 属性测试 |
| 8 | `frame-continuity.ts` | 镜头不连贯=视频质量问题 | 单元测试 |
| 9 | `merchant-auth.ts` | 商家鉴权错误=越权访问 | 单元测试 |
| 10 | `concurrency-reconcile.ts` Worker | 对账失效=并发计数器永久漂移 | 单元测试 |
| 11 | `matrix-publish.ts` + `matrix-dispatch-service.ts` | 矩阵发布是商家核心功能 | 集成测试 |
| 12 | `storage.ts` OSS 操作 | 存储是全局依赖 | 单元测试 (接口契约) |

### P2 (最好有) — 边缘场景、辅助功能

| # | 模块 | 理由 | 建议测试类型 |
|---|------|------|-------------|
| 1 | 管理后台全部 API (`api/admin/*`) | 内部工具，影响面窄 | 单元测试 |
| 2 | `face-check.ts` Worker | 人脸审核，非核心阻断路径 | 单元测试 |
| 3 | `flux.ts` Seedream 接口 | 图片生成，非核心链路 | 接口契约测试 |
| 4 | `happyhorse.ts` + `happyhorse-workspace.ts` | 第三方引擎，可选功能 | 单元测试 |
| 5 | `content-score-service.ts` | 评分辅助，不影响主流程 | 单元测试 |
| 6 | `poi-injection-service.ts` | 地理信息增强 | 单元测试 |
| 7 | `upload/route.ts` + `upload-image/route.ts` | 上传校验 | 单元测试 |
| 8 | `media/[...key]/route.ts` 媒体代理 | 基础设施 | 单元测试 |
| 9 | `auth/logout` + `auth/me` | 简单 CRUD | 单元测试 |
| 10 | `trending-video-analyzer.ts` | 趋势分析增值 | 属性测试 |
| 11 | `cross-store-service.ts` | 跨门店功能 | 单元测试 |

---

## 关键发现总结

1. **API 路由层几乎完全没有直接测试** — 130 个 route.ts 文件，没有一个有对应的 API 层集成/单元测试。现有测试全部作用在 service 层或 Worker 层。
2. **积分/订阅整条链路是最大盲区** — 作为核心收入引擎，credit-service/subscription-service 的完整流程测试严重缺失。
3. **Worker 层测试极度匮乏** — 22 个 Worker 仅 1 个有直接测试(merge-video)，其余靠 service 层间接覆盖。
4. **商家平台 Service 层覆盖率优于视频重绘** — 得益于大量属性测试。
5. **管理后台零测试** — 9 个管理路由模块完全无测试。
6. **分布式基础设施(锁/限流/并发)缺少测试** — 这些是系统可靠性的基石。
