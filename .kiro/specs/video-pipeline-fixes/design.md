# 视频流水线缺陷修复 Bugfix 设计

## Overview

本设计文档针对 `bugfix.md` 中确认的 13 个缺陷给出形式化的 Bug 条件、根因分析、修复方案与验证策略。这 13 个缺陷分布在五大类：

- **计费正确性（缺陷 1/2/3/4）**：解析阶段无余额预检、可被零余额白嫖、废弃首帧仍计费、解析与生成两套扣费哲学不一致、项目级分段生成 CHARGE 缺幂等且逻辑三处重复。
- **状态一致性（缺陷 5/6/7）**：worker 绕过 `assertTransition`、合并失败写错状态（注释声称 `MERGE_FAILED` 实际写 `FAILED`）、`PARTIAL`/`COMPLETED` 死状态。
- **配置与文档（缺陷 9）**：`.env.example` 与真实代码脱节（缺 `VISION_*`、保留误导性 Mock 说明与废弃变量）。
- **音频策略（缺陷 8）**：成片音轨三源叠加无确定优先级。
- **架构与安全（缺陷 10/11/12/13）**：私有媒体经无鉴权公开目录暴露、SQLite 单写锁并发风险、BullMQ `lockDuration` 与 10 分钟轮询不匹配、`firstFrameUrl` 死字段残留。

修复总策略遵循用户铁律：**真实接口、真实流程，禁止 fallback / 静默处理 / 假数据；改代码必须同步更新注释**。修复采用 Bug 条件方法论：对每个缺陷定义触发缺陷的输入集合 C(X) 与期望行为 P(result)，并对 ¬C(X)（非缺陷输入）做保持性验证，确保不引入回归。

修复按 `bugfix.md` 既定优先级推进：先堵计费漏洞 → 再统一状态与配置 → 最后音频、架构与安全加固。

## Glossary

- **Bug_Condition (C)**：触发某缺陷的输入条件集合。例如「解析触发时用户余额 < 预估解析成本」即为缺陷 1 的 C(X)。
- **Property (P)**：缺陷输入下修复后应满足的正确行为。例如「余额不足时在消耗任何外部资源前拒绝入队」。
- **Preservation（保持性）**：¬C(X) 下（非缺陷输入）修复前后行为必须完全一致，不引入回归。
- **F / F'**：F 为修复前的原函数，F' 为修复后的函数。
- **RESERVE / CHARGE / REFUND**：生成阶段的三段式积分模型——创建即冻结（RESERVE）、成功扣费（CHARGE）、多冻结退差额（REFUND）。
- **chargeParseCreditsTx**：`src/lib/credit-service.ts` 中解析阶段事后扣费函数，当前用 `Math.min(balance, amount)` 兜底扣至 0（缺陷 1 的核心）。
- **estimateParseCreditCost**：`src/lib/credit-service.ts` 中解析成本估算，当前含废弃首帧固定 `+10`（缺陷 2 的核心）。
- **atomicSuccessUpdate**：`src/workers/generate-video.ts` 中按组生成成功路径的原子扣费函数，已含 `existingCharge` 幂等检查（缺陷 4 的正确参照、缺陷 3.2 须保持）。
- **processProjectSegmentGenerate**：`src/workers/generate-video.ts` 中项目级分段生成函数，其内联 CHARGE **缺少** `existingCharge` 幂等检查（缺陷 4 的核心）。
- **assertTransition**：`src/lib/state-machine.ts` 中状态转换强制校验，当前仅被 `jobs/retry`、`jobs/cancel` 两个 API 路由调用，worker 未调用（缺陷 5 的核心）。
- **ProjectStatus**：`prisma/schema.prisma` 中 `Project.status`（String 字段 + 注释枚举）。注释列出 `DOWNLOADING|PARSING|EDITABLE|GENERATING|PARTIAL|COMPLETED|EXPORTED|FAILED`，其中无 `MERGE_FAILED`（缺陷 6），且 `PARTIAL`/`COMPLETED` 无写入点（缺陷 7）。
- **firstFrameUrl**：`ShotGroup.firstFrameUrl` 字段及 `parse-video.ts` 第 7 步、`generate-video.ts` 入参，first_frame 流程已废弃改用 `asset://` 人物锚定图（缺陷 13）。

## Bug Details

### Bug Condition

13 个缺陷的总 Bug 条件是各子条件的并集：`C(X) = C₁(X) ∨ C₂(X) ∨ … ∨ C₁₃(X)`。下方按缺陷给出每个子条件的形式化规格（编号对应 `bugfix.md` 的 1.N / 2.N）。

**缺陷 1 — 解析阶段无余额预检、可被零余额白嫖：**
```
FUNCTION isBugCondition_1(input)
  INPUT: input = { userId, projectId, videoUrl, balanceBeforeParse, parseCost }
  OUTPUT: boolean

  // 余额不足却仍执行完整解析、事后兜底扣至 0
  RETURN balanceBeforeParse < parseCost
         AND parseTriggered(input) == true        // 解析仍被入队/执行
         AND externalResourcesConsumed(input)      // 消耗了多模态/OSS/FFmpeg
         AND chargeClampedToZero(input)            // actualCharge = min(balance, cost)
END FUNCTION
```

**缺陷 2 — 废弃首帧固定 +10 仍计费：**
```
FUNCTION isBugCondition_2(input)
  INPUT: input = { duration }
  OUTPUT: boolean
  // 实际不再生成首帧，但成本仍含 PARSE_FIRST_FRAME_COST(=10)
  RETURN estimateParseCreditCost(duration) == ceil(duration * 0.5) + 10
         AND firstFrameGenerated(input) == false
END FUNCTION
```

**缺陷 3 — 解析与生成扣费哲学不一致：**
```
FUNCTION isBugCondition_3(input)
  RETURN parseChargingModel(input) == "事后扣+可欠费+不冻结"
         AND generateChargingModel(input) == "RESERVE→CHARGE→REFUND+不允许欠费"
END FUNCTION
```

**缺陷 4 — 项目级分段生成 CHARGE 缺幂等：**
```
FUNCTION isBugCondition_4(input)
  INPUT: input = { jobId, attemptsMade }
  // 重试时已存在该 jobId 的 CHARGE，却仍无条件 create
  RETURN path(input) == "processProjectSegmentGenerate"
         AND existsChargeLedger(jobId) == true
         AND hasExistingChargeGuard(input) == false   // 未做幂等检查
END FUNCTION
```

**缺陷 5 — worker 绕过状态校验：**
```
FUNCTION isBugCondition_5(input)
  INPUT: input = { from, to, writeSite }
  RETURN writeSite IN { parse-video, generate-video, merge-video }
         AND statusWrittenDirectly(input) == true       // 直接 update({status})
         AND assertTransitionCalled(input) == false
         AND stateMachineCommentClaimsEnforced() == true // 注释声称已强制校验
END FUNCTION
```

**缺陷 6 — 合并失败写错状态：**
```
FUNCTION isBugCondition_6(input)
  RETURN mergeFailed(input) == true
         AND statusWritten(input) == "FAILED"
         AND commentClaims(input) == "MERGE_FAILED"
         AND "MERGE_FAILED" NOT IN ProjectStatusEnum
END FUNCTION
```

**缺陷 7 — PARTIAL/COMPLETED 死状态：**
```
FUNCTION isBugCondition_7(status)
  RETURN status IN { "PARTIAL", "COMPLETED" }
         AND NOT EXISTS writeSite WHERE writes(status)   // 无任何 worker 写入
END FUNCTION
```

**缺陷 8 — 成片音轨三源叠加无确定策略：**
```
FUNCTION isBugCondition_8(input)
  RETURN audioSources(input) ⊇ { "按组切 audioKey", "Seedance TTS 配音", "merge 从原视频提取" }
         AND definedPriority(input) == false
         AND syncStrategy(input) == undefined
END FUNCTION
```

**缺陷 9 — .env.example 与代码脱节：**
```
FUNCTION isBugCondition_9(envExample)
  RETURN ({VISION_API_URL, VISION_API_KEY, VISION_MODEL} ⊄ envExample)   // 必填项缺失
         OR ("GEMINI_API_KEY 留空=Mock 模式" IN envExample)              // 误导说明
         OR ("FLUX_API_KEY" IN envExample OR "Seedream/meai.cloud" IN envExample) // 废弃残留
END FUNCTION
```

**缺陷 10 — 私有媒体经无鉴权公开目录暴露：**
```
FUNCTION isBugCondition_10(resource)
  RETURN resource.path STARTS WITH "public/uploads/"
         AND resource.kind IN { 原视频, 封面, 按组音频, 生成结果, 人物头像 }
         AND accessibleByAnonymousUrl(resource) == true
END FUNCTION
```

**缺陷 11 — SQLite 单写锁并发风险：**
```
FUNCTION isBugCondition_11(input)
  RETURN db == SQLite
         AND concurrentWriters(input) > 1   // 生成 concurrency=5 + 合并 + 链式续接
         AND writesCreditLedgerOrStatus(input)
END FUNCTION
```

**缺陷 12 — lockDuration 与轮询时长不匹配：**
```
FUNCTION isBugCondition_12(input)
  RETURN maxPollTime == 10min
         AND bullmqLockDuration == default(~30s)
         AND lockDuration < maxPollTime   // 可能被误判 stalled 重复派发
END FUNCTION
```

**缺陷 13 — firstFrameUrl 死字段残留：**
```
FUNCTION isBugCondition_13(input)
  RETURN field == "ShotGroup.firstFrameUrl"
         AND firstFrameFlowDeprecated() == true
         AND (commentClaims(field) == "作为 Seedance first_frame"
              OR fieldStillReferencedAsLiveLogic(input))
END FUNCTION
```

### Examples

- **缺陷 1**：用户 `creditBalance = 0`，上传 60s 视频触发解析 → 当前完整跑完多模态/OSS/FFmpeg，`chargeParseCreditsTx` 记 `actualCharge = min(0, 40) = 0`、ledger 备注「欠 40」，平台白白消耗外部成本。期望：入队前校验余额，0 余额直接拒绝并提示积分不足。
- **缺陷 2**：60s 视频 `estimateParseCreditCost(60) = ceil(30) + 10 = 40`，其中 `+10` 对应已废弃首帧。期望：`= ceil(30) = 30`，注释同步去掉首帧描述。
- **缺陷 4**：项目级分段任务 `attempts=3` 第二次重试，jobId X 已有 CHARGE → 当前再次 `create` CHARGE 重复扣费。期望：`existingCharge` 命中则跳过。
- **缺陷 6**：合并失败 → 当前写 `status='FAILED'`（注释却写「MERGE_FAILED…允许只重试合并」）。期望：写 `MERGE_FAILED`，用户可只重试合并。
- **缺陷 9**：开发者按 `.env.example` 配置（无 `VISION_*`），运行即在 `parseVideoDirectly` 抛「VISION_API_KEY 未配置」。期望：示例含 `VISION_*` 必填项、移除 Mock/FLUX 误导。
- **边界（缺陷 7）**：检视枚举发现 `PARTIAL`/`COMPLETED` 无写入点 → 要么实现要么清理，注释/文档同步。

## Expected Behavior

### Preservation Requirements（修复期间必须保持不变的行为）

**Unchanged Behaviors（对应 bugfix.md 3.1–3.8）：**
- 3.1 余额充足时解析正常完成（多模态分析、分组、抽缩略图、按组切音频），按真实消费扣费并置 `EDITABLE`。
- 3.2 按组生成 `atomicSuccessUpdate` 扣费保持幂等（`existingCharge` 检查、`RESERVE → CHARGE` 并对多冻结 `REFUND` 差额）。
- 3.3 生成成功/失败的 `RESERVE`/`CHARGE`/`REFUND` 积分流转（含链式失败 `failProjectChain` 退还下游冻结）保持不变。
- 3.4 全部分镜组生成成功后触发合并、合并成功置 `EXPORTED` 保持不变。
- 3.5 `jobs/retry`、`jobs/cancel` 路由经 `assertTransition` 校验保持不变。
- 3.6 `topupCredits` 按 `orderId` 幂等充值保持不变。
- 3.7 解析/生成/合并产物上传 OSS 并经 OSS URL 访问保持不变。
- 3.8 `merge-video` 检测到 `EXPORTED` 时幂等跳过保持不变。

**Scope：** 所有不满足任一 Cₙ(X) 的输入（即 ¬C(X)）都应完全不受本次修复影响，包括：余额充足的解析、按组生成成功/失败路径、首次（非重试）的项目级分段扣费、合并成功路径、充值流程、OSS 读写路径。

> 注：缺陷输入下的期望正确行为在「Correctness Properties」中以 Property 形式给出，本节聚焦「不可改变」的行为。

## Hypothesized Root Cause

基于代码证据，各缺陷的最可能根因：

1. **计费哲学分裂（缺陷 1/3）**：`chargeParseCreditsTx` 设计为「解析已花真钱 → 事后兜底扣至 0」，与生成阶段「先 RESERVE 冻结、不允许欠费」是两套独立演进的模型。根因是解析路径缺少入队前的余额预检/冻结环节，把扣费完全后置到 `parse-video.ts` 步骤 10 的成功事务。

2. **重构未清理残留（缺陷 2/13）**：first_frame 流程废弃后，`estimateParseCreditCost` 的 `+10` 与注释、`ShotGroup.firstFrameUrl` 字段及注释、`parse-video.ts` 第 7 步说明、`generate-video.ts` 的 `firstFrameUrl` 入参均未同步清理。

3. **扣费逻辑复制三份（缺陷 4）**：CHARGE 逻辑分散在 `chargeCredits`、`atomicSuccessUpdate` 内联、`processProjectSegmentGenerate` 内联三处。仅前两者有 `existingCharge` 幂等检查，项目级内联遗漏，重试（`attempts=3`）可重复写 CHARGE。

4. **状态机仅作文档（缺陷 5/6/7）**：`assertTransition` 实际只在两个 API 路由调用，worker 直接 `update({ status })`。`state-machine.ts` 注释声称「关键写状态处强制校验」与现实不符；`merge-video.ts` 失败分支注释写 `MERGE_FAILED` 但代码写 `FAILED`，且该枚举值不在 schema 注释内；`PARTIAL`/`COMPLETED` 在注释枚举里但无写入点。根因是 `Project.status` 为 String + 注释枚举，缺乏类型层约束，注释与写入点长期漂移。

5. **配置文档滞后（缺陷 9）**：代码已切到 `VISION_*` 多模态直传，`.env.example` 仍停留在 Gemini Mock + FLUX 时代。

6. **音频多源叠加（缺陷 8）**：解析按组切 `audioKey`、Seedance `generate_audio` TTS、`merge-video` 在片段无音频时从原视频提取——三处独立实现，缺乏统一的「音轨来源优先级 + 音画同步」决策点。

7. **基础设施约束（缺陷 10/11/12）**：产物落 `public/uploads/`（Next.js 无鉴权静态公开）；SQLite 单写锁（`db-retry.ts` 的存在即痛点佐证）；BullMQ 默认 stalled 检测 ~30s 远小于 `MAX_POLL_TIME=10min`，仅靠分布式锁掩盖重复派发。

## Correctness Properties

> 本节为所有正确性属性的唯一来源。属性按缺陷族归纳：Bug 条件属性（缺陷输入下的正确行为）+ 保持性属性（非缺陷输入下行为不变）。

Property 1: Bug Condition - 解析前余额预检（缺陷 1/3）

_For any_ 触发解析的输入，当用户余额不足以支付预估解析成本（isBugCondition_1 / isBugCondition_3 为真）时，修复后系统 SHALL 在消耗任何外部资源（多模态/OSS/FFmpeg）之前拒绝入队/执行并明确提示积分不足，绝不兜底扣至 0、绝不产生欠费，使解析与生成采用一致的「预检/冻结、不允许欠费」扣费哲学。

**Validates: Requirements 2.1, 2.3**

Property 2: Bug Condition - 解析计费仅含真实消费（缺陷 2）

_For any_ 时长 duration，修复后 `estimateParseCreditCost(duration)` SHALL 等于 `ceil(duration * 0.5)`（移除废弃首帧固定 +10），且函数注释与真实计费口径一致。

**Validates: Requirements 2.2**

Property 3: Bug Condition - 项目级分段扣费幂等（缺陷 4）

_For any_ 项目级分段生成任务，当该 jobId 已存在 CHARGE 记录（isBugCondition_4 为真，如队列重试）时，修复后扣费逻辑 SHALL 跳过重复写入（与 `atomicSuccessUpdate` 一致），保证扣费恰好一次；且三处 CHARGE 逻辑 SHALL 收敛为单一可复用实现。

**Validates: Requirements 2.4**

Property 4: Bug Condition - worker 状态转换合法性（缺陷 5）

_For any_ worker 关键状态写入（`QUEUED→GENERATING→SUCCEEDED→FAILED` 等），修复后系统 SHALL 经 `assertTransition` 校验合法后再写入；若选择不在 worker 强制校验，则 `state-machine.ts` 注释 SHALL 同步修正为与真实调用点一致，不留与代码不符的注释。

**Validates: Requirements 2.5**

Property 5: Bug Condition - 合并失败状态可区分（缺陷 6）

_For any_ 合并失败输入，修复后系统 SHALL 写入 `MERGE_FAILED`（已加入 ProjectStatus 枚举注释），使其可与生成 `FAILED` 区分、支持「只重试合并」，相关注释与重试语义一致。

**Validates: Requirements 2.6**

Property 6: Bug Condition - 死状态归属明确（缺陷 7）

_For any_ `PARTIAL`/`COMPLETED` 状态，修复后系统 SHALL 要么落地真实写入点实现其语义，要么作为遗留枚举清理移除，并同步注释与文档。

**Validates: Requirements 2.7**

Property 7: Bug Condition - 单一确定音轨策略（缺陷 8）

_For any_ 成片合并，修复后系统 SHALL 依据明确的单一音轨来源优先级与音画同步策略确定音轨，消除三源叠加导致的串味/错位，且不静默丢弃或伪造音轨。

**Validates: Requirements 2.8**

Property 8: Bug Condition - 配置与代码一致（缺陷 9）

_For any_ 按 `.env.example` 配置的开发者，修复后示例 SHALL 包含 `VISION_API_URL`/`VISION_API_KEY`/`VISION_MODEL` 等必填项及说明，移除 `GEMINI_API_KEY` 的 Mock 误导说明与 `FLUX`/Seedream 废弃残留，使按其配置即可真实运行。

**Validates: Requirements 2.9**

Property 9: Bug Condition - 私有媒体鉴权访问（缺陷 10）

_For any_ 私有媒体资源（原视频、封面、按组音频、生成结果、人物头像），修复后系统 SHALL 通过鉴权访问控制保护，不将其置于无鉴权公开目录或保留可被任意 URL 访问的本地公开副本。

**Validates: Requirements 2.10**

Property 10: Bug Condition - 并发积分事务可靠（缺陷 11）

_For any_ 生成/合并/链式续接的高并发积分账本与状态写入，修复后系统 SHALL 提供可承载并发事务的方案（迁移到支持并发写的数据库，或对关键写显式串行化/排队），保证账本与状态的一致性。

**Validates: Requirements 2.11**

Property 11: Bug Condition - stalled 检测匹配轮询时长（缺陷 12）

_For any_ 最长 10 分钟轮询的生成任务，修复后系统 SHALL 配置与轮询时长匹配的 BullMQ `lockDuration`/stalled 参数，避免任务被误判 stalled 而重复派发。

**Validates: Requirements 2.12**

Property 12: Bug Condition - 清理 firstFrame 残留（缺陷 13）

_For any_ 首帧相关字段与逻辑，修复后系统 SHALL 清理废弃的 `firstFrameUrl` 字段及相关残留逻辑并同步更新/删除注释，使代码与「first_frame 已废弃、改用 asset:// 人物锚定图」一致。

**Validates: Requirements 2.13**

Property 13: Preservation - 余额充足解析与既有积分流转不变

_For any_ 不触发缺陷条件的输入（¬C(X)：余额充足的解析、按组生成成功/失败、首次项目级分段扣费、合并成功、充值、OSS 读写），修复后系统 SHALL 产生与修复前相同的结果，保留 3.1–3.8 全部既有行为（解析正常完成并扣真实消费、`atomicSuccessUpdate` 幂等、`RESERVE/CHARGE/REFUND` 流转、合并置 `EXPORTED`、路由 `assertTransition` 校验、`topupCredits` 幂等、OSS 访问、`EXPORTED` 幂等跳过）。

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8**

## Fix Implementation

### Changes Required

按 `bugfix.md` 优先级分组列出文件级改动。所有改动遵循「真实流程、无 fallback、改码同步改注释」铁律。

#### A. 计费漏洞（缺陷 1/2/3/4）

**文件**：`src/lib/credit-service.ts`

1. **移除废弃首帧成本（缺陷 2）**：`estimateParseCreditCost` 删除 `PARSE_FIRST_FRAME_COST(=10)`，改为 `return Math.ceil(duration * 0.5)`；同步删除函数注释中「第一组 Seedream 首帧图生成」「+10 首帧图固定成本」描述，仅保留多模态分析成本说明。

2. **新增解析前余额预检/冻结（缺陷 1/3）**：新增 `reserveParseCreditsTx`（或在入队前调用 `reserveCredits` 范式）——在解析入队/开始前校验 `balance >= parseCost`，不足则抛 `ApiError('INSUFFICIENT_CREDITS', ...)` 拒绝入队，足额则冻结。重构 `chargeParseCreditsTx`：移除 `actualCharge = Math.min(balance, amount)` 兜底逻辑，改为对已冻结额度做正式 CHARGE（与生成阶段 RESERVE→CHARGE 对齐），不允许欠费、不扣至负。同步更新函数注释，删除「余额不足兜底扣至 0」描述。

3. **CHARGE 逻辑收敛为单一实现（缺陷 4）**：抽取统一的 `chargeCreditsTx(tx, { userId, jobId, actualAmount })`，内置 `existingCharge` 幂等检查 + RESERVE 差额 REFUND。`atomicSuccessUpdate` 内联与 `processProjectSegmentGenerate` 内联均改为调用该函数。

**文件**：`src/workers/parse-video.ts`

4. **入队前/解析前余额预检（缺陷 1/3）**：在调用 `parseVideoDirectly` 等外部资源消耗之前，先在入队侧（解析任务的创建/入队 API）或 worker 起始处调用余额预检/冻结；不足则不入队/提前失败并提示，绝不进入多模态/OSS/FFmpeg。步骤 10 的成功事务改为对已冻结额度做正式 CHARGE。同步更新文件头注释流程描述（去掉「首帧图生成」步骤）与步骤 10 注释（删除「余额不足兜底扣至 0」）。

**文件**：`src/workers/generate-video.ts`

5. **项目级分段扣费改用统一幂等实现（缺陷 4）**：`processProjectSegmentGenerate` 成功事务内的内联 CHARGE 改为调用 `chargeCreditsTx`（含 `existingCharge` 幂等）。

#### B. 状态与配置（缺陷 5/6/7/9）

**文件**：`prisma/schema.prisma`

6. **新增 MERGE_FAILED、明确 PARTIAL/COMPLETED（缺陷 6/7）**：`Project.status` 注释枚举加入 `MERGE_FAILED`；对 `PARTIAL`/`COMPLETED` 决策——若无落地写入点则从注释枚举与代码中清理移除（推荐，符合「无死状态」），并同步文档。

**文件**：`src/lib/state-machine.ts`

7. **状态校验落地或修正注释（缺陷 5）**：在 worker 关键状态写入处调用 `assertTransition`（推荐），并把 `MERGE_FAILED`、清理后的枚举纳入 `VALID_TRANSITIONS`（如 `GENERATING/EXPORTED → MERGE_FAILED`、`MERGE_FAILED → GENERATING` 以支持只重试合并）；若不在 worker 强制校验，则修正文件头注释删除「在关键写状态处强制校验」表述，使其与真实调用点一致。

**文件**：`src/workers/merge-video.ts`

8. **合并失败写 MERGE_FAILED（缺陷 6）**：catch 分支 `data.status` 由 `'FAILED'` 改为 `'MERGE_FAILED'`，使注释与代码一致、支持只重试合并；若启用 worker 校验则经 `assertTransition`。

**文件**：`.env.example`

9. **配置对齐真实代码（缺陷 9）**：新增 `VISION_API_URL`/`VISION_API_KEY`/`VISION_MODEL` 必填项及说明；删除 `GEMINI_API_KEY` 及其「留空=Mock 模式」误导说明；删除已废弃的 `FLUX_API_KEY` 与 meai.cloud/Seedream 注释残留。

#### C. 音频、架构与安全（缺陷 8/10/11/12/13）

**文件**：`src/workers/merge-video.ts` + 文档

10. **确定音轨优先级（缺陷 8）**：在 `ffmpegConcat` 明确单一优先级（建议：Seedance `generate_audio` TTS 配音 > 按组 `audioKey` 原声 > 从原视频整段提取），并定义音画同步对齐规则；移除三源静默叠加路径，文档化决策。

**文件**：媒体访问层（新增鉴权路由 / 调整存储策略）

11. **私有媒体鉴权访问（缺陷 10）**：私有产物不再经 `public/uploads/` 无鉴权公开——改为经鉴权 API 路由代理 OSS（带签名 URL / 鉴权校验），或不保留本地公开副本；调整各 worker 写盘路径与访问入口。

**文件**：数据库与 worker 配置（缺陷 11/12）

12. **并发可靠性（缺陷 11）**：迁移到支持并发写的数据库（如 PostgreSQL），或对积分账本/状态关键写显式串行化/排队（独立队列 concurrency=1）。

13. **lockDuration 匹配轮询（缺陷 12）**：生成 Worker 配置 `lockDuration` ≥ `MAX_POLL_TIME`（10min，含余量），并相应设置 stalled 检测，避免误判重复派发。

**文件**：`prisma/schema.prisma` + `src/workers/parse-video.ts` + `src/workers/generate-video.ts`

14. **清理 firstFrame 残留（缺陷 13）**：移除 `ShotGroup.firstFrameUrl` 字段（建迁移）、`generate-video.ts` 的 `firstFrameUrl` 入参与对应 Seedance 传参、`parse-video.ts` 第 7 步注释；统一改用 `asset://` 人物锚定图作 reference_image，同步更新所有相关注释。

## Testing Strategy

### Validation Approach

采用两阶段验证：先在**未修复代码**上跑探索性测试，复现并确认每个缺陷的反例（确认/反驳根因）；再实现修复，跑 Fix Checking（缺陷输入下满足 P）与 Preservation Checking（非缺陷输入下行为不变）。

### Exploratory Bug Condition Checking

**目标**：在修复前于未修复代码上复现缺陷反例，确认/反驳根因。若反驳则需重新假设。

**Test Plan**：对每个缺陷构造触发输入并断言期望行为，在未修复代码上观察失败。

**Test Cases**：
1. **解析白嫖（缺陷 1）**：`creditBalance=0` 触发解析，断言「不应消耗外部资源且不应入队」（未修复必失败：跑完全程且扣至 0）。
2. **首帧多扣（缺陷 2）**：`estimateParseCreditCost(60)`，断言 `==30`（未修复返回 40，失败）。
3. **项目级重复扣费（缺陷 4）**：同一 jobId 已有 CHARGE 再次进入扣费事务，断言「不新增 CHARGE」（未修复重复写，失败）。
4. **合并失败状态（缺陷 6）**：模拟合并失败，断言 `status=='MERGE_FAILED'`（未修复写 `FAILED`，失败）。
5. **配置缺失（缺陷 9）**：按 `.env.example` 加载环境，断言 `VISION_*` 齐备（未修复缺失，失败）。
6. **边界（缺陷 7）**：扫描代码断言 `PARTIAL`/`COMPLETED` 存在写入点或已移除（未修复为死状态，失败）。

**Expected Counterexamples**：
- 零余额解析仍消耗外部成本并欠费扣至 0；`estimateParseCreditCost(60)=40`；项目级 jobId 重复 CHARGE；合并失败写 `FAILED`；`.env.example` 无 `VISION_*`。
- 可能根因：解析缺预检/冻结、首帧成本未清理、项目级内联缺幂等、合并分支写错常量、配置文档滞后。

### Fix Checking

**目标**：验证所有满足 Bug 条件的输入，修复后函数满足期望行为。

**Pseudocode：**
```
FOR ALL input WHERE isBugCondition(input) DO       // 任一 Cₙ(X)
  result := fixedFunction(input)
  ASSERT expectedBehavior(result)                  // 对应 Property 1..12
END FOR
```

具体断言：余额不足解析在消耗外部资源前被拒（P1）；`estimateParseCreditCost(d)==ceil(d*0.5)`（P2）；重复 jobId 仅一条 CHARGE（P3）；worker 非法转换被 `assertTransition` 拦截或注释已修正（P4）；合并失败写 `MERGE_FAILED`（P5）；死状态已实现或移除（P6）；音轨按既定优先级确定（P7）；`.env.example` 含 `VISION_*` 且无 Mock/FLUX 残留（P8）；私有媒体需鉴权（P9）；并发积分事务一致（P10）；`lockDuration≥MAX_POLL_TIME`（P11）；`firstFrameUrl` 已清理（P12）。

### Preservation Checking

**目标**：验证所有不满足 Bug 条件的输入，修复后结果与修复前一致。

**Pseudocode：**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalFunction(input) == fixedFunction(input)
END FOR
```

**Testing Approach**：保持性优先用属性测试（PBT），因其可在输入域内自动生成大量用例、覆盖边界、给出「非缺陷输入行为不变」的强保证。

**Test Plan**：先在未修复代码上观察非缺陷输入行为（余额充足解析、按组生成、首次项目级扣费、合并成功、充值、OSS 访问），据此写 PBT 固化行为。

**Test Cases**：
1. **余额充足解析保持**：随机生成足额余额 + 合法视频元数据，断言解析完成、按真实消费扣费、置 `EDITABLE`（3.1）。
2. **按组扣费幂等保持**：随机 RESERVE/CHARGE 序列，断言 `atomicSuccessUpdate` 幂等且 REFUND 差额正确（3.2）。
3. **生成积分流转保持**：随机成功/失败/链式失败，断言 `RESERVE/CHARGE/REFUND` 与 `failProjectChain` 退款正确（3.3）。
4. **充值幂等保持**：随机重复 `orderId`，断言 `topupCredits` 不重复入账（3.6）。
5. **合并成功与幂等保持**：合并成功置 `EXPORTED`、`EXPORTED` 再入队幂等跳过（3.4/3.8）。

### Unit Tests

- `estimateParseCreditCost` 多组 duration 边界（0、含小数、上限 120s）。
- 解析前余额预检：余额=cost-1 拒绝、=cost 通过。
- `chargeCreditsTx` 幂等：重复 jobId 仅一条 CHARGE，含 RESERVE 差额 REFUND。
- 状态机：`assertTransition` 对新增 `MERGE_FAILED` 转换与非法转换的接受/拒绝。
- 合并失败分支写 `MERGE_FAILED`。

### Property-Based Tests

- 生成随机余额×成本组合，验证 P1（不足必拒、不欠费）与 P13（足额行为不变）。
- 生成随机 jobId 重试序列，验证 P3 扣费恰好一次（幂等）。
- 生成随机状态转换序列，验证 P4 仅合法转换被接受。
- 生成随机 `.env` 子集，验证 P8 必填项校验。

### Integration Tests

- 端到端解析流：零余额拒绝 → 充值 → 足额解析成功置 `EDITABLE` 并扣真实消费。
- 端到端生成→合并：全部组成功触发合并、合并成功 `EXPORTED`；合并失败 `MERGE_FAILED` 且可只重试合并。
- 私有媒体访问：匿名 URL 访问被拒、鉴权后可访问。
- 并发：多任务并发写积分账本，验证账本与状态最终一致、无重复/丢失扣费。
