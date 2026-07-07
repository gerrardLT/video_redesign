# 一键出片与业务优化路线图

## 核心设计决策

**双轨并行**：保留现有"商家拍摄上传 → 渲染"流程（MANUAL 模式），新增"一键出片"AI 全自动模式（AUTO 模式）。两种模式共享 FFmpeg 合成管线（字幕、封面、上传），但素材来源不同：

| 维度 | MANUAL（现有） | AUTO（一键出片） |
|------|-------------|--------------|
| 素材来源 | 商家拍摄上传 RawAsset | 全部由 Seedance 2.0 文生视频生成 |
| 素材就绪检查 | required ShotTask 需 qualityScore >= 60 | 跳过（无上传环节） |
| Seedance 调用量 | 仅补充缺失可选镜头（max 3/版本） | 全部镜头（每版本 N 个 Seedance 任务） |
| 积分成本 | 较低（大部分素材免费） | 较高（全部 Seedance 生成） |
| 状态转换 | DRAFT → READY_TO_SHOOT → MATERIALS_UPLOADED → RENDERING | DRAFT/READY_TO_SHOOT → RENDERING（跳过拍摄和上传） |
| 入口 | POST /render（素材就绪检查） | POST /auto-render（直接入队） |

---

## Task 1: Schema 与状态机扩展

**目标**：为 ContentBrief 增加渲染模式标记，状态机支持 AUTO 模式的跳跃转换。

**文件修改**：

1. `prisma/schema.prisma`
   - ContentBrief 模型新增 `renderMode String @default("MANUAL")` — 值为 `MANUAL` | `AUTO`
   - 可选：新增 `autoGenStartedAt DateTime?` 记录一键出片触发时间

2. `src/lib/content-brief-state-machine.ts`
   - `VALID_BRIEF_TRANSITIONS` 增加 AUTO 模式合法转换：
     - `DRAFT: ['READY_TO_SHOOT', 'RENDERING']` — AUTO 模式可从 DRAFT 直跳 RENDERING
     - `READY_TO_SHOOT: ['MATERIALS_UPLOADED', 'RENDERING']` — 同理

---

## Task 2: AI 自动渲染服务（核心）

**目标**：新建 `ai-auto-render-service.ts`，实现"零素材全 AI 生成"渲染流程。

**新建文件**：`src/lib/ai-auto-render-service.ts`

**核心函数**：
```typescript
export async function aiAutoRender(input: {
  contentBriefId: string
  userId: string
}): Promise<Array<{ id: string; type: string; ossKey: string | null }>>
```

**流程设计**：

1. 获取分布式锁（复用 `acquireLock`，key = `render:brief:{briefId}`）
2. 置 RENDERING 状态（状态机守卫：`assertBriefTransition(status, 'RENDERING')`）
3. 读取 ContentBrief + ShotTasks + Store（同现有流程）
4. 构建 MerchantContext（复用 `buildMerchantContext`）
5. 对 3 种版本（PROMOTION / ATMOSPHERE / OWNER_TALKING）分别：
   - 遍历所有 ShotTask，**每个 ShotTask 均调用 Seedance 生成**（不再有 filler 上限）
   - Prompt 来源：`task.examplePrompt`（已有） → `buildAutoPrompt()` 自动生成
   - 生成结果下载到本地临时文件（复用 `generateFillerClip` 的轮询逻辑）
6. 调用现有 FFmpeg 合成管线：字幕、封面帧、crossfade、上传 OSS
   - **复用** `local-render-service.ts` 中的 `synthesizeVariant()`、`buildSubtitles()`、`uploadVariant()` 等内部函数（需 extract 为可导出或新建 `render-pipeline.ts` 共享模块）
7. 创建 VideoVariant 记录 + 积分 CHARGE/REFUND（复用现有计费逻辑）

**Prompt 生成策略**（`buildAutoPrompt`）：

```typescript
function buildAutoPrompt(
  shotType: string,
  instruction: string,
  brief: ContentBrief,
  merchantCtx: MerchantContext | null
): string
```

- 基础：复用现有 `buildFillerPrompt` 的 typeDescriptions 映射
- 增强：注入 `brief.hook`、`brief.mainMessage`、`merchantCtx.promptPrefix`
- 每个 ShotTask 的 `examplePrompt` 字段（playbook-engine 已填充）优先使用
- 画面风格统一为竖屏 9:16、高清画质

**关键差异**（vs 现有 `assembleVariantClips`）：
- 移除 `MAX_FILLER_CLIPS_PER_VARIANT` 上限（AUTO 模式下所有镜头都 AI 生成）
- 移除 `hasAsset` 分支（AUTO 模式无上传素材）
- 超时调整：AUTO 模式需要更多 Seedance 调用，总超时可放宽到 900s

---

## Task 3: API 路由与 Worker

**新建文件**：

1. `src/app/api/content-briefs/[briefId]/auto-render/route.ts`
   - POST 入口，流程：
     1. 鉴权（brief.store.merchant.userId === currentUserId）
     2. 状态检查（DRAFT 或 READY_TO_SHOOT）
     3. 标记 `renderMode = "AUTO"`
     4. 积分预检：AUTO 模式成本 = 所有 ShotTask 时长 x 3 版本 x Seedance 单价（比 MANUAL 高）
     5. 冻结积分（`reserveMerchantCredits`）
     6. 入队 `render-local-video`（复用同一队列，Worker 内按 renderMode 分支）
   - 不需要素材就绪检查、不需要同质化检查（纯 AI 生成）

2. `src/workers/render-local-video.ts` 修改
   - 读取 `brief.renderMode`
   - `MANUAL` → 调用现有 `renderLocalVideoVariants()`
   - `AUTO` → 调用新增 `aiAutoRender()`

---

## Task 4: FFmpeg 管线共享（重构）

**目标**：将 `local-render-service.ts` 中的 FFmpeg 合成逻辑抽取为独立模块，供 MANUAL 和 AUTO 两种模式复用。

**新建文件**：`src/lib/render-pipeline.ts`

**从 `local-render-service.ts` 提取**：
- `synthesizeVariant()` — FFmpeg 合成（crossfade + 字幕 + 封面）
- `buildSubtitles()` — 字幕序列构建
- `uploadVariant()` — OSS 上传
- 相关的 FFmpeg helper 函数

**两个服务均 import**：
- `local-render-service.ts` → `import { synthesizeVariant } from './render-pipeline'`
- `ai-auto-render-service.ts` → `import { synthesizeVariant } from './render-pipeline'`

---

## Task 5: 前端入口

**目标**：在 Brief 详情页或今日任务页增加"一键出片"按钮。

- 条件展示：仅当 brief 有 ShotTask 且尚未上传素材（或用户主动选择）时显示
- 点击后弹出确认弹窗：说明积分成本预估 + 预计耗时
- 调用 POST /auto-render，返回 jobId 后跳转到进度页

---

## Task 6: 平台数据真实采集（抖音先行）

**目标**：激活已有 `crawl-platform-metrics` Worker，接入真实数据源。

**新建文件**：
- `src/lib/platform-fetchers/douyin.ts` — 实现 `PlatformWorksFetcher` 接口
- 对接抖音开放平台创作者服务 API（需商家 OAuth 授权）

**修改文件**：
- `src/workers/crawl-platform-metrics.ts` — 注册真实 fetcher（替换当前 UnrecoverableError 中止逻辑）

---

## Task 7: 矩阵号分发引擎

**目标**：从单 variant 发布扩展到多账号批量分发。

**新建文件**：
- `src/lib/matrix-dispatch-service.ts` — 批量调度（定时/间隔/错峰）
- `src/workers/matrix-publish.ts` — 多平台发布 Worker

**Schema 修改**：
- `PublishJob` 增加 `accountId`、`scheduledAt`、`matrixBatchId` 字段

---

## Task 8: 爆款视频拆解引擎

**新建文件**：`src/lib/trending-video-analyzer.ts`
- 复用 `video-analyzer.ts` 多模态能力拆解爆款结构
- 输出结构化拆解：hook 类型、分镜节奏、字幕风格
- 自动固化为 Playbook 模板

---

## Task 9: POI 深度注入

**修改文件**：`src/lib/publish-copy-service.ts`
- 增加平台原生 POI 标签注入（抖音 POI、快手位置）
- 自动植入区域长尾词
- 关联团购链接 CTA

**新建文件**：`src/lib/poi-injection-service.ts`

---

## 执行顺序与依赖

```
Task 4 (FFmpeg 共享) ← 无依赖，先做
    ↓
Task 1 (Schema) + Task 2 (AI渲染服务) + Task 3 (API+Worker) ← 可并行
    ↓
Task 5 (前端入口) ← 依赖 Task 3
    ↓
Task 6 (平台数据采集) ← 独立
    ↓
Task 7 (矩阵分发) ← 独立
    ↓
Task 8 (爆款拆解) + Task 9 (POI注入) ← 独立
```

预计总工期：Task 1-5 约 2 周，Task 6-9 约 4 周。
