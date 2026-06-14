# Implementation Plan

## Overview

本计划针对 `bugfix.md` 确认的 13 个缺陷，采用 Bug 条件方法论的探索性修复流程：先在**未修复代码**上写探索性测试复现缺陷（任务 1），再写保持性测试固化既有行为（任务 2），最后按 `bugfix.md` 优先级（计费 → 状态与配置 → 音频/架构/安全）实现修复（任务 3–5）并回归验证（任务 6）。遵循铁律：真实接口/真实流程、无 fallback、无静默处理、无假数据；改码必须同步改注释。

## Tasks

- [x] 1. 编写 Bug 条件探索性测试（修复前）
  - **Property 1: Bug Condition** - 视频流水线计费与状态缺陷复现
  - **CRITICAL**：本测试必须在未修复代码上 **失败** —— 失败即证明缺陷存在
  - **DO NOT** 在测试失败时去修测试或修代码（本阶段只复现，不修复）
  - **NOTE**：本测试编码了期望行为，修复后它通过即验证修复
  - **GOAL**：surface 反例，证明各缺陷确实存在
  - **Scoped PBT 方法**：对确定性缺陷将属性收敛到具体失败用例以保证可复现
  - 测试点（对应 design 的 isBugCondition_N 与 Examples）：
    - 缺陷 1（PBT/scoped）：`creditBalance=0` 触发解析，断言「消耗任何外部资源前应被拒绝入队」——未修复跑完全程并 `actualCharge=min(0,40)=0`，失败
    - 缺陷 2（scoped）：断言 `estimateParseCreditCost(60)==30`、`estimateParseCreditCost(duration)==ceil(duration*0.5)`——未修复返回 40，失败
    - 缺陷 4（scoped）：同一 jobId 已存在 CHARGE 再次进入 `processProjectSegmentGenerate` 扣费事务，断言「不新增 CHARGE」——未修复重复 create，失败
    - 缺陷 6（scoped）：模拟 `merge-video` 合并失败，断言 `status=='MERGE_FAILED'`——未修复写 `FAILED`，失败
    - 缺陷 9（scoped）：按 `.env.example` 加载环境，断言含 `VISION_API_URL/VISION_API_KEY/VISION_MODEL` 且无 `GEMINI_API_KEY` Mock 说明/无 `FLUX`/Seedream 残留——未修复缺失，失败
    - 缺陷 7（边界扫描）：断言 `PARTIAL`/`COMPLETED` 存在真实写入点或已移除——未修复为死状态，失败
  - 在未修复代码上运行
  - **EXPECTED OUTCOME**：测试 **失败**（正确——证明缺陷存在）
  - 记录反例（如 `calculateParse(0,...)` 白嫖扣至 0、`estimateParseCreditCost(60)=40`、jobId 重复 CHARGE、合并写 `FAILED`、`.env.example` 缺 `VISION_*`）以理解根因
  - 测试写完、运行、失败已记录即标记完成
  - _Requirements: 2.1, 2.2, 2.4, 2.6, 2.7, 2.9_

- [x] 2. 编写保持性属性测试（修复前）
  - **Property 2: Preservation** - 非缺陷输入既有行为不变
  - **IMPORTANT**：遵循 observation-first 方法论——先在未修复代码上观察非缺陷输入（¬C(X)）的真实行为，再固化为 PBT
  - 观察并固化（对应 design Preservation Requirements 3.1–3.8）：
    - 余额充足解析：随机足额余额 + 合法视频元数据 → 解析完成、按真实消费扣费、置 `EDITABLE`（3.1）
    - 按组扣费幂等：随机 RESERVE/CHARGE 序列 → `atomicSuccessUpdate` 幂等、`existingCharge` 命中跳过、多冻结 REFUND 差额正确（3.2）
    - 生成积分流转：随机成功/失败/链式失败 → `RESERVE/CHARGE/REFUND` 与 `failProjectChain` 退款正确（3.3）
    - 合并成功与幂等：合并成功置 `EXPORTED`、`EXPORTED` 再入队幂等跳过（3.4/3.8）
    - 路由状态校验：`jobs/retry`、`jobs/cancel` 经 `assertTransition` 校验（3.5）
    - 充值幂等：随机重复 `orderId` → `topupCredits` 不重复入账（3.6）
    - OSS 读写：解析/生成/合并产物上传 OSS 并经 OSS URL 访问（3.7）
  - 优先用属性测试（PBT）覆盖输入域，给出「非缺陷输入行为不变」的强保证
  - 在未修复代码上运行
  - **EXPECTED OUTCOME**：测试 **通过**（确认需保持的基线行为）
  - 测试写完、运行、在未修复代码上通过即标记完成
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

- [x] 3. 修复计费漏洞（缺陷 1/2/3/4）

  - [x] 3.1 移除废弃首帧成本（缺陷 2）
    - `src/lib/credit-service.ts`：`estimateParseCreditCost` 删除 `PARSE_FIRST_FRAME_COST(=10)`，改为 `return Math.ceil(duration * 0.5)`
    - 同步删除函数注释中「第一组 Seedream 首帧图生成」「+10 首帧图固定成本」描述，仅保留多模态分析成本说明
    - _Bug_Condition: isBugCondition_2(input) — estimateParseCreditCost 含废弃 +10_
    - _Expected_Behavior: estimateParseCreditCost(d)==ceil(d*0.5) 且注释一致_
    - _Preservation: 3.1 余额充足解析按真实消费扣费不变_
    - _Requirements: 2.2_

  - [x] 3.2 新增解析前余额预检/冻结并重构事后扣费（缺陷 1/3）
    - `src/lib/credit-service.ts`：新增 `reserveParseCreditsTx`（或复用 `reserveCredits` 范式），入队/开始前校验 `balance >= parseCost`，不足抛 `ApiError('INSUFFICIENT_CREDITS', ...)` 拒绝入队，足额则冻结
    - 重构 `chargeParseCreditsTx`：移除 `actualCharge = Math.min(balance, amount)` 兜底，改为对已冻结额度做正式 CHARGE（对齐生成阶段 RESERVE→CHARGE），不允许欠费、不扣至负
    - `src/workers/parse-video.ts`：在 `parseVideoDirectly` 等外部资源消耗前（入队侧或 worker 起始）调用余额预检/冻结，不足则不进入多模态/OSS/FFmpeg；步骤 10 成功事务改为对已冻结额度做正式 CHARGE
    - 同步更新 `parse-video.ts` 文件头流程注释（去掉首帧步骤）与步骤 10 注释（删除「余额不足兜底扣至 0」）、`chargeParseCreditsTx` 注释
    - _Bug_Condition: isBugCondition_1 / isBugCondition_3 — 余额不足仍跑全程并扣至 0、与生成扣费哲学不一致_
    - _Expected_Behavior: 消耗外部资源前拒绝入队并提示积分不足，绝不欠费（Property 1）_
    - _Preservation: 3.1 余额充足解析不变、3.3 既有积分流转不变_
    - _Requirements: 2.1, 2.3_

  - [x] 3.3 收敛 CHARGE 为单一幂等实现（缺陷 4）
    - `src/lib/credit-service.ts`：抽取统一 `chargeCreditsTx`，内置 `existingCharge` 幂等检查 + RESERVE 差额 REFUND
    - **键冲突（必须先解决）**：解析扣费 `chargeParseCreditsTx(tx, userId, projectId, amount)` 按 **projectId** 关联（无 jobId），而生成扣费（`atomicSuccessUpdate` / `processProjectSegmentGenerate`）按 **jobId** 关联；统一签名 `chargeCreditsTx(tx, { userId, jobId, actualAmount })` 仅支持 jobId，无法覆盖解析路径。需二选一并在实现前明确：
      - 方案 A（推荐）：统一签名扩展为双键 `chargeCreditsTx(tx, { userId, jobId?, projectId?, actualAmount })`，幂等检查（`existingCharge`）按传入的 jobId 或 projectId 查 `creditLedger`，覆盖解析与生成两条路径
      - 方案 B：解析路径（projectId 关联）单独保留独立实现，统一实现仅收敛两处 jobId 关联的生成 CHARGE，并在注释中明确解析不纳入收敛及其原因
    - `src/workers/generate-video.ts`：`atomicSuccessUpdate` 内联与 `processProjectSegmentGenerate`（约 377 行）内联 CHARGE 均改为调用 `chargeCreditsTx`
    - **连带缺陷（项目级 CHARGE 未真正扣减余额，必须一并修正）**：`processProjectSegmentGenerate` 的内联 CHARGE 不仅缺 `existingCharge` 幂等检查，还**只 `creditLedger.create` 写一条 CHARGE、从不 `tx.user.update` 更新 `user.creditBalance`**（`balanceAfter` 直接写当前余额），也**没有 RESERVE 差额 REFUND**——与 `atomicSuccessUpdate` 行为不一致，导致项目级分段生成实际并未真正扣减用户余额。此为缺陷行为（非需保持的基线），统一实现 `chargeCreditsTx` 时须确保项目级路径同样真正扣减余额并退还 RESERVE 差额，不可被误当作需保持的既有行为
    - 同步更新三处相关注释，删除重复实现的旧注释
    - _Bug_Condition: isBugCondition_4 — processProjectSegmentGenerate 缺 existingCharge 幂等，且只写 creditLedger、从不更新 user.creditBalance、无 RESERVE 差额 REFUND_
    - _Expected_Behavior: 重复 jobId 仅一条 CHARGE，三处收敛为单一实现（兼容 jobId/projectId 双键），项目级 CHARGE 真正扣减余额并退还 RESERVE 差额（Property 3）_
    - _Preservation: 3.2 atomicSuccessUpdate 幂等不变、首次按组生成扣费不变（注：项目级「未扣减余额」为缺陷行为，不在保持范围）_
    - _Requirements: 2.4_

  - [x] 3.4 验证 Bug 条件探索性测试现在通过（计费部分）
    - **Property 1: Expected Behavior** - 视频流水线计费缺陷已修复
    - **IMPORTANT**：重跑任务 1 中计费相关测试（缺陷 1/2/4），不要新写测试
    - **EXPECTED OUTCOME**：测试 **通过**（确认计费缺陷已修复）
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 3.5 验证保持性测试仍通过（计费部分）
    - **Property 2: Preservation** - 非缺陷计费输入行为不变
    - **IMPORTANT**：重跑任务 2 中计费相关测试，不要新写测试
    - **EXPECTED OUTCOME**：测试 **通过**（确认无回归）
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 4. 统一状态与配置（缺陷 5/6/7/9）

  - [x] 4.1 新增 MERGE_FAILED 并明确 PARTIAL/COMPLETED 归属（缺陷 6/7）
    - `prisma/schema.prisma`：`Project.status` 注释枚举加入 `MERGE_FAILED`
    - 对 `PARTIAL`/`COMPLETED`：若无落地写入点则从注释枚举与代码中清理移除（推荐），并同步文档
    - 同步更新 schema 注释与相关文档
    - _Bug_Condition: isBugCondition_6 / isBugCondition_7 — MERGE_FAILED 缺失、死状态_
    - _Expected_Behavior: 合并失败可区分（Property 5）、死状态归属明确（Property 6）_
    - _Preservation: 3.4 合并成功置 EXPORTED 不变_
    - _Requirements: 2.6, 2.7_

  - [x] 4.2 状态校验落地或修正注释（缺陷 5）
    - `src/lib/state-machine.ts`：在 worker 关键状态写入处调用 `assertTransition`（推荐），将 `MERGE_FAILED` 及清理后枚举纳入 `VALID_TRANSITIONS`（如 `GENERATING/EXPORTED → MERGE_FAILED`、`MERGE_FAILED → GENERATING` 支持只重试合并）
    - 若不在 worker 强制校验，则修正文件头注释删除「在关键写状态处强制校验」表述，使其与真实调用点一致
    - `src/workers/parse-video.ts`、`src/workers/generate-video.ts` 关键状态写入按选择经 `assertTransition`
    - _Bug_Condition: isBugCondition_5 — worker 绕过 assertTransition、注释与代码不符_
    - _Expected_Behavior: worker 状态转换合法性校验或注释修正一致（Property 4）_
    - _Preservation: 3.5 路由 assertTransition 校验不变_
    - _Requirements: 2.5_

  - [x] 4.3 合并失败写 MERGE_FAILED（缺陷 6）
    - `src/workers/merge-video.ts`：catch 分支 `data.status` 由 `'FAILED'` 改为 `'MERGE_FAILED'`，使注释与代码一致、支持只重试合并；若启用 worker 校验则经 `assertTransition`
    - 同步更新该分支注释与重试语义说明
    - _Bug_Condition: isBugCondition_6 — 合并失败写错状态_
    - _Expected_Behavior: 合并失败写 MERGE_FAILED 可区分（Property 5）_
    - _Preservation: 3.8 EXPORTED 幂等跳过不变_
    - _Requirements: 2.6_

  - [x] 4.4 配置对齐真实代码（缺陷 9）
    - `.env.example`：新增 `VISION_API_URL`/`VISION_API_KEY`/`VISION_MODEL` 必填项及说明
    - 删除 `GEMINI_API_KEY` 及其「留空=Mock 模式」误导说明
    - 删除已废弃的 `FLUX_API_KEY` 与 meai.cloud/Seedream 注释残留
    - _Bug_Condition: isBugCondition_9 — .env.example 与代码脱节_
    - _Expected_Behavior: 含 VISION_* 必填项、无 Mock/FLUX 残留，按其配置即可真实运行（Property 8）_
    - _Preservation: 3.7 OSS 读写路径不变_
    - _Requirements: 2.9_

  - [x] 4.5 验证 Bug 条件探索性测试现在通过（状态与配置部分）
    - **Property 1: Expected Behavior** - 状态与配置缺陷已修复
    - **IMPORTANT**：重跑任务 1 中缺陷 6/7/9 相关测试，不要新写测试
    - **EXPECTED OUTCOME**：测试 **通过**
    - _Requirements: 2.5, 2.6, 2.7, 2.9_

  - [x] 4.6 验证保持性测试仍通过（状态部分）
    - **Property 2: Preservation** - 非缺陷状态/路由输入行为不变
    - **IMPORTANT**：重跑任务 2 中状态/路由/合并相关测试，不要新写测试
    - **EXPECTED OUTCOME**：测试 **通过**（确认无回归）
    - _Requirements: 3.4, 3.5, 3.8_

- [x] 5. 音频策略、架构与安全加固（缺陷 8/10/11/12/13）

  - [x] 5.1 确定单一音轨优先级与音画同步策略（缺陷 8）
    - `src/workers/merge-video.ts`：在 `ffmpegConcat` 明确单一优先级（建议：Seedance `generate_audio` TTS 配音 > 按组 `audioKey` 原声 > 从原视频整段提取），定义音画同步对齐规则
    - 移除三源静默叠加路径，文档化决策；不静默丢弃或伪造音轨
    - 同步更新相关注释
    - _Bug_Condition: isBugCondition_8 — 三源叠加无确定优先级_
    - _Expected_Behavior: 单一确定音轨策略（Property 7）_
    - _Preservation: 3.4 合并成功置 EXPORTED 不变_
    - _Requirements: 2.8_

  - [x] 5.2 私有媒体鉴权访问（缺陷 10）
    - 私有产物（原视频、封面、按组音频、生成结果、人物头像）不再经 `public/uploads/` 无鉴权公开
    - 改为经鉴权 API 路由代理 OSS（带签名 URL / 鉴权校验），或不保留本地公开副本
    - 调整各 worker 写盘路径与访问入口；同步更新注释
    - **安全提示**：确认所有访问入口都有鉴权校验，不留可被任意 URL 访问的公开副本
    - _Bug_Condition: isBugCondition_10 — 私有媒体经无鉴权公开目录暴露_
    - _Expected_Behavior: 私有媒体经鉴权访问控制保护（Property 9）_
    - _Preservation: 3.7 OSS 读写路径不变_
    - _Requirements: 2.10_

  - [x] 5.3 并发积分事务可靠性（缺陷 11）
    - 迁移到支持并发写的数据库（如 PostgreSQL），或对积分账本/状态关键写显式串行化/排队（独立队列 concurrency=1）
    - 同步更新相关注释与配置说明
    - _Bug_Condition: isBugCondition_11 — SQLite 单写锁并发风险_
    - _Expected_Behavior: 并发积分事务一致可靠（Property 10）_
    - _Preservation: 3.2/3.3 既有积分流转与幂等不变_
    - _Requirements: 2.11_

  - [x] 5.4 lockDuration 匹配轮询时长（缺陷 12）
    - 生成 Worker 配置 `lockDuration` ≥ `MAX_POLL_TIME`（10min，含余量），相应设置 stalled 检测，避免误判重复派发
    - 同步更新相关注释
    - _Bug_Condition: isBugCondition_12 — lockDuration < maxPollTime_
    - _Expected_Behavior: stalled 检测匹配轮询时长（Property 11）_
    - _Preservation: 3.3 生成积分流转不变_
    - _Requirements: 2.12_

  - [x] 5.5 清理 firstFrame 残留（缺陷 13）
    - `prisma/schema.prisma`：移除 `ShotGroup.firstFrameUrl` 字段（建迁移）
    - `src/workers/generate-video.ts`：移除 `firstFrameUrl` 入参与对应 Seedance 传参
    - `src/workers/parse-video.ts`：移除第 7 步首帧相关注释
    - 统一改用 `asset://` 人物锚定图作 reference_image，同步更新/删除所有相关注释
    - _Bug_Condition: isBugCondition_13 — firstFrameUrl 死字段与过时注释残留_
    - _Expected_Behavior: 清理 firstFrame 残留并同步注释（Property 12）_
    - _Preservation: 3.3 生成积分流转不变_
    - _Requirements: 2.13_

  - [x] 5.6 验证保持性测试仍通过（架构/安全部分）
    - **Property 2: Preservation** - 加固后非缺陷输入行为不变
    - **IMPORTANT**：重跑任务 2 全部保持性测试，不要新写测试
    - **EXPECTED OUTCOME**：测试 **通过**（确认无回归）
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.7, 3.8_

- [x] 6. Checkpoint - 确保所有测试通过
  - 重跑任务 1（**Property 1**）全部 Bug 条件测试 —— 现在应全部 **通过**（确认 13 个缺陷已修复）
  - 重跑任务 2（**Property 2**）全部保持性测试 —— 应全部 **通过**（确认无回归）
  - 运行项目 build/编译与完整测试套件，确保无错误
  - 复核所有改动均同步更新了注释（铁律），无 fallback/静默处理/假数据
  - 如有疑问，向用户确认

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2"], "dependsOn": [] },
    { "wave": 2, "tasks": ["3.1"], "dependsOn": ["1", "2"] },
    { "wave": 3, "tasks": ["3.2", "3.3"], "dependsOn": ["3.1"] },
    { "wave": 4, "tasks": ["3.4", "3.5"], "dependsOn": ["3.2", "3.3"] },
    { "wave": 5, "tasks": ["4.1"], "dependsOn": ["3.4", "3.5"] },
    { "wave": 6, "tasks": ["4.2", "4.3", "4.4"], "dependsOn": ["4.1"] },
    { "wave": 7, "tasks": ["4.5", "4.6"], "dependsOn": ["4.2", "4.3", "4.4"] },
    { "wave": 8, "tasks": ["5.1", "5.2", "5.3", "5.4", "5.5"], "dependsOn": ["4.5", "4.6"] },
    { "wave": 9, "tasks": ["5.6"], "dependsOn": ["5.1", "5.2", "5.3", "5.4", "5.5"] },
    { "wave": 10, "tasks": ["6"], "dependsOn": ["5.6"] }
  ]
}
```

- 任务 1、2 必须在任意修复（3+）之前完成：任务 1 须在未修复代码上失败，任务 2 须在未修复代码上通过。
- 任务 3 各子任务顺序执行（3.2 依赖 3.1 的成本口径、3.3 收敛后供后续复用）。
- 任务 4 依赖任务 3 完成；4.2/4.3 依赖 4.1 新增的 `MERGE_FAILED` 枚举。
- 任务 5 子任务（5.1–5.5）相互独立，可并行，完成后统一跑 5.6 保持性回归。
- 任务 6 依赖全部修复任务完成。

## Notes

- **Property 1 / Property 2**：标注 `**Property N:**` 的任务支持悬停查看测试状态。Property 1 为 Bug 条件（探索 + 修复后期望行为），Property 2 为保持性。
- **observation-first**：保持性测试（任务 2）须先在未修复代码上观察真实输出再固化，不可凭假设编写。
- **不要新写验证测试**：3.4/3.5/4.5/4.6/5.6 及任务 6 均为重跑任务 1/2 中已有测试，禁止另写新测试。
- **缺陷 7 决策**：`PARTIAL`/`COMPLETED` 推荐作为遗留死状态清理移除（符合「无死状态」），如确需保留须落地真实写入点。
- **缺陷 11/12 为基础设施级改动**（数据库迁移 / Worker 配置），属高影响项，执行前应与用户确认范围与回滚方案。
