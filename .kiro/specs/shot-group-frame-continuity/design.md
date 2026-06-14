# 分镜组同场景尾帧承接一致性 Bugfix 设计

## Overview

「单组生成」（`POST /api/shot-groups/[id]/generate`）与「一键生成」（链式 `triggerNextChainGroup`）在「同场景尾帧承接」上行为不一致：链式路径已实现承接，单组路径完全没有承接逻辑。根因是承接所需的前一组 Seedance 尾帧 `lastFrameUrl` 目前只在链式 worker 的内存里临时传递，从未持久化，单组路径无从读取。

本设计的修复策略由三部分组成，互相支撑：

1. **持久化尾帧（数据层）**：在 `ShotGroup` 上新增 `lastFrameUrl` 字段。任一路径（链式 / 单组）生成成功且 Seedance 返回了尾帧时，将该受信尾帧 URL 写入持久化存储，供后续任意路径复用。
2. **抽取共享承接逻辑（行为一致性）**：把「同场景判定 + 尾帧装配为 `reference_image` + prompt 承接指令」抽取为单一共享函数 `applySameSceneContinuation`，链式与单组路径共用同一实现，从根上保证两条路径行为一致。
3. **单组路径接入承接（修复点）**：单组生成在 bug 条件下读取前一组持久化尾帧，调用共享函数按软承接（`reference_image`，非 `first_frame`，参考图总数 ≤ 9）注入；同时单组路径在「存在同场景后继组」时请求 `returnLastFrame`，让自身尾帧也被持久化，使 单组→单组 承接同样可用。

所有改动遵循仓库规则：仅信任 Seedance 返回的受信尾帧（本账号、方舟平台近 30 天产物），不引入静默 fallback、不塞入伪造数据；修改逻辑时同步更新对应注释。

乱序/时序承接行为（先生成后序组再生成前序组、或 `force` 重生成前序组刷新尾帧）采用方案 A：维持现状、显式文档化，无需任何额外实现。因为这类时序场景等同于 `isBugCondition` 的「前一组在生成当时未成功 / 无持久化尾帧」分支（已被 Req 3.3 与 `isBugCondition` 覆盖），系统按生成顺序尽力承接、不做跨时序回溯或级联重生成；Req 3.8 仅为对该 Preservation 行为的显式声明。

## Glossary

- **Bug_Condition (C)**：触发缺陷的条件——对某分镜组发起单组生成时，存在同场景且已成功生成、且持有受信尾帧的前一组，本应承接却未承接。
- **Property (P)**：承接发生时的期望行为——前一组尾帧作为额外 `reference_image` 追加，prompt 含「以图片N作为起始承接画面」指令，且与链式路径产出一致的承接装配。
- **Preservation**：非 bug 条件下（无前一组 / 跨场景 / 前一组未成功无尾帧 / 链式路径）单组生成行为，以及 `scriptHash` 幂等、`force` 抽卡、积分冻结/扣费/退款，必须保持与修复前完全一致。
- **lastFrameUrl（持久化尾帧）**：Seedance 在 `return_last_frame=true` 且任务成功时返回的尾帧图片 URL（`content.last_frame_url`），属本账号方舟平台受信产物，作 `reference_image` 不触发人脸输入审核。本次新增持久化到 `ShotGroup.lastFrameUrl`。
- **软承接（soft continuation）**：把上一组尾帧作为 `role=reference_image` 注入并以 prompt 指定为起始承接画面的方式，区别于 `role=first_frame`（后者与 `reference_image` 互斥，会挤掉人物锚定）。
- **前一组（Previous Group, P）**：同项目内 `groupIndex` 小于当前组且为最大值的分镜组。
- **`triggerNextChainGroup`**：`src/workers/generate-video.ts` 中链式续接函数，是承接行为的一致性基准。
- **`buildGroupGenReference`**：`src/lib/group-gen-context.ts` 中按组装配 `referenceImages` / `referenceAudioUrl` / `characterPrefix` 的函数。
- **`normScene`**：场景名规范化（去空白、转小写）后比较的判定方式，用于「同场景」判断。

## Bug Details

### Bug Condition

缺陷在用户对某分镜组 G 发起**单组生成**时显现：项目内存在 G 的前一组 P（`groupIndex` 小于 G 的最大者），P 已成功生成且持有受信尾帧，且 P 末镜 `scene` 与 G 首镜 `scene` 相同。此时本应像链式路径那样承接 P 的尾帧，但单组路径没有任何承接逻辑、且尾帧从未持久化，导致 G 独立起镜、与 P 之间画面跳变。

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type GenerateRequest = { groupId, mode }
  OUTPUT: boolean

  IF input.mode <> 'single' THEN RETURN false          // 仅单组路径触发；链式不触发
  G ← getGroup(input.groupId)
  P ← getPreviousGroup(G)                                // groupIndex < G 的最大者
  IF P = NULL THEN RETURN false                          // 无前一组（如项目首组）→ 不触发
  IF P.genStatus <> 'SUCCEEDED' THEN RETURN false        // 前一组未成功 → 不触发
  IF P.lastFrameUrl 为空 THEN RETURN false               // 前一组无受信尾帧 → 不触发
  IF normScene(lastShot(P).scene) <> normScene(firstShot(G).scene) THEN RETURN false  // 跨场景/缺失 → 不触发

  RETURN true   // 同场景、前一组成功且有受信尾帧 → 本应承接却没承接
END FUNCTION
```

### Examples

- **缺陷场景**：项目「一键生成」后，组 1 与组 2 同属场景「客厅」。用户单独重生成组 2。期望组 2 承接组 1 尾帧自然衔接；实际组 2 独立起镜，与组 1 出现画面跳变。
- **缺陷场景（持久化缺失）**：组 1 由链式生成成功，Seedance 曾返回尾帧，但该尾帧仅存在于当时 worker 内存、未持久化。用户单独生成组 2 时，DB 中读不到组 1 尾帧，无法承接。
- **非缺陷（首组）**：用户单独生成项目首组（无前一组）→ 独立起镜，符合预期，不应改变。
- **非缺陷（跨场景）**：组 2 属「客厅」、组 3 属「室外」，单独生成组 3 → 跨场景不承接，独立起镜，符合预期。
- **非缺陷（链式）**：一键生成链式续接组 2 → 由 `triggerNextChainGroup` 既有逻辑承接，行为不应改变。
- **非缺陷（乱序生成，符合预期）**：用户先单独生成组 2（此时组 1 尚未成功生成）→ 组 2 独立起镜；之后再单独生成组 1 成功并持久化尾帧 → 系统不自动回头重生成组 2 来补承接，组 2 保持已生成结果、不报错。承接判定以发起生成当时前一组的持久化状态为准（Req 3.8）。
- **非缺陷（重生成前序组，符合预期）**：用户对组 1 执行 `force` 重生成并刷新其尾帧 → 系统不自动重生成已基于旧尾帧生成的组 2，组 2 承接保持为生成当时的状态（可能为过时尾帧），不报错、不静默改动（Req 3.8）。

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors（必须保持不变）:**
- 单组生成在「无前一组 / 跨场景 / 前一组未成功或无持久化尾帧」时，CONTINUE TO 独立起镜，不追加承接参考图、不报错、不静默塞入无效参考（Req 3.1 / 3.2 / 3.3）。
- 承接发生时 CONTINUE TO 使用 `role=reference_image`（软承接），不使用 `role=first_frame`，且不挤占人物锚定/场景帧（参考图总数 ≤ 9）（Req 3.4）。
- 一键生成（链式）路径 CONTINUE TO 保持既有「同场景承接 / 跨场景独立起镜 / 自动合并」行为不变（Req 3.5）。
- 单组生成路径 CONTINUE TO 保持既有 `scriptHash` 幂等短路、`force` 抽卡、积分冻结/扣费/退款行为不变（Req 3.6）。
- 承接所用尾帧来源 CONTINUE TO 仅信任 Seedance 返回的尾帧，不使用 FFmpeg 从成片抽取的真人脸帧（Req 3.7）。
- 乱序生成或重生成前序组的时序场景下，CONTINUE TO 以「发起生成当前组那一刻、前一组的持久化状态（`genStatus`、`lastFrameUrl`）」为承接判定依据，不做跨时序回溯或级联重生成——后序组先于前序组生成、或前序组 `force` 刷新尾帧，均不触发对已生成组的自动重生成（Req 3.8）。

**Scope:**
所有不满足 bug 条件的输入应完全不受本次修复影响，包括：
- 没有前一组的分镜组（项目首组）
- 与前一组跨场景或 `scene` 缺失的分镜组
- 前一组尚未成功生成、或前一组无持久化尾帧的分镜组
- 链式（一键生成）路径的所有组
- 乱序生成或重生成前序组导致的时序场景（前一组在生成当时未成功 / 尾帧尚未刷新到位）

> 承接发生时的期望正确行为见下方「Correctness Properties」的 Property 1。

## Hypothesized Root Cause

依据缺陷描述与现有实现，根因确定且单一：

1. **尾帧从未持久化（核心根因）**：`ShotGroup` 模型没有尾帧字段。链式 worker 中 `lastFrameUrl` 来自 `getSeedanceTaskStatus().lastFrameUrl`，仅作为函数参数在 `processGroupVideoGenerate → triggerNextChainGroup` 内存中传递，任务结束即丢失。单组路径在另一进程（Next.js 应用进程）发起，无法读取任何尾帧。

2. **承接逻辑仅存在于链式 worker，未被复用**：「同场景判定 + 尾帧装配 + prompt 承接指令」内联在 `triggerNextChainGroup` 内（含局部 `normScene` 闭包），单组路由 `route.ts` 完全没有等价逻辑，结构上无法共用。

3. **单组路径不请求 `returnLastFrame`**：worker 仅在 `chainMode` 且非最后一组时设置 `returnLastFrame`。单组生成既不请求尾帧，也就不会产生可供后续承接的尾帧，形成「即使持久化也无源数据」的二级缺口。

## Correctness Properties

Property 1: Bug Condition - 单组路径同场景尾帧承接

_For any_ 满足 bug 条件的单组生成请求（`isBugCondition` 返回 true），修复后的单组生成 SHALL 把前一组持久化尾帧作为额外 `reference_image` 追加、在 prompt 中以「以图片N作为起始承接画面」指定其为本组起始承接画面，且其承接判定与装配结果与链式 `triggerNextChainGroup` 对同一「前一组、当前组」的承接装配一致；承接全程为软承接（不使用 `role=first_frame`），参考图总数 ≤ 9。

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

Property 2: Preservation - 非承接输入行为保持不变

_For any_ 不满足 bug 条件的输入（`isBugCondition` 返回 false：无前一组 / 跨场景或 `scene` 缺失 / 前一组未成功或无持久化尾帧 / 乱序或时序场景下前一组在生成当时未成功或尾帧尚未刷新到位 / 链式路径），修复后的单组生成 SHALL 产出与修复前完全一致的结果——独立起镜、不追加承接参考图，且 `scriptHash` 幂等短路、`force` 抽卡、积分冻结/扣费/退款行为不变；链式路径行为亦保持不变；且不做跨时序回溯或级联重生成。

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8**

## Fix Implementation

### Changes Required

#### 1. 数据层：`ShotGroup` 新增持久化尾帧字段

**File**: `prisma/schema.prisma`

**Model**: `ShotGroup`

新增字段并补充注释：
```prisma
lastFrameUrl   String?  @map("last_frame_url") // 本组生成成功时 Seedance 返回的受信尾帧 URL（returnLastFrame=true 时有值），供后续同场景承接复用
```

迁移：执行 `prisma migrate dev --name add_shotgroup_last_frame_url` 生成迁移并更新生成的 client（`src/generated/prisma`）。`Shot` 模型本次无需新增字段（尾帧以「组」为粒度承接，组末镜场景从既有 `Shot.scene` 读取即可）。

#### 2. 行为层：抽取共享承接函数

**File**: `src/lib/frame-continuity.ts`（新建）

抽取「同场景判定 + 尾帧装配 + prompt 承接指令」为单一共享函数，链式与单组共用：

```
FUNCTION applySameSceneContinuation(params)
  INPUT: params = {
    prevGroupId,        // 前一组 id（链式=currentGroupId，单组=P.id）
    currentGroupId,     // 待承接组 id（链式=nextGroup.id，单组=G.id）
    lastFrameUrl,       // 前一组受信尾帧 URL（链式=内存值，单组=P.lastFrameUrl）
    referenceImages,    // 当前已装配参考图
    prompt,             // 当前 prompt
  }
  OUTPUT: { referenceImages, prompt, applied: boolean, contIndex? }

  IF lastFrameUrl 为空 THEN RETURN { referenceImages, prompt, applied: false }
  IF referenceImages.length >= 9 THEN RETURN { referenceImages, prompt, applied: false }  // 不挤占人物锚定/场景帧

  prevLastShot  ← 前一组末镜（orderIndex desc，取 scene）
  nextFirstShot ← 当前组首镜（orderIndex asc，取 scene）
  prevScene ← normScene(prevLastShot.scene)
  nextScene ← normScene(nextFirstShot.scene)

  IF prevScene 为空 OR nextScene 为空 OR prevScene <> nextScene THEN
    RETURN { referenceImages, prompt, applied: false }   // 跨场景/缺失 → 不承接

  contIndex ← referenceImages.length + 1                 // 追加在末尾的 1 基序号（图片N）
  newRefs   ← [...referenceImages, lastFrameUrl]
  newPrompt ← prompt + "\n承接：以图片{contIndex}（上一镜头结尾画面）作为本组起始画面，自然衔接上一镜头的人物姿态、机位、构图与光线，保持镜头连续"
  RETURN { referenceImages: newRefs, prompt: newPrompt, applied: true, contIndex }
END FUNCTION
```

`normScene` 由本模块统一持有并导出/复用（`(s) => (s ?? '').trim().replace(/\s+/g,'').toLowerCase()`），从 `triggerNextChainGroup` 移除其局部闭包。承接 prompt 文案与现有链式实现保持一字一致，保证两路径产出完全相同。

#### 3. 链式 worker：复用共享函数 + 持久化尾帧

**File**: `src/workers/generate-video.ts`

- `triggerNextChainGroup`：删除内联的「同场景判定 + 尾帧追加 + prompt 拼接」代码块与局部 `normScene`，改为调用 `applySameSceneContinuation({ prevGroupId: currentGroupId, currentGroupId: nextGroup.id, lastFrameUrl, referenceImages, prompt: nextPrompt })`，用返回值覆盖 `referenceImages` / `nextPrompt`，并据 `applied` 输出与现有等价的承接/不承接日志。**行为保持不变**（同函数同入参同文案）。
- `atomicSuccessUpdate`：新增可选参数 `lastFrameUrl?: string`，在成功事务内对 `ShotGroup` 增加 `lastFrameUrl: lastFrameUrl ?? null` 的写入——成功且有尾帧则持久化；无尾帧（如未请求或本次未返回）则写 `null`，**确保持久化尾帧始终对应当前最新视频内容，避免 `force` 重生成后残留陈旧尾帧**。
- `processGroupVideoGenerate`：将轮询得到的 `lastFrameUrl` 透传给 `atomicSuccessUpdate`（链式与单组组生成都经此函数，一处持久化覆盖两条路径，落实 Req 2.3）。
- `returnLastFrame` 计算：worker 改为 `returnLastFrame: job.data.returnLastFrame === true || (job.data.chainMode && (chainCurrentIndex ?? 0) < ((chainTotalGroups ?? 1) - 1))`。链式分支 `job.data.returnLastFrame` 为 undefined，结果与现状完全相同（Req 3.5 保持）；新增的显式 `returnLastFrame` 仅供单组路径使用。

#### 4. 单组路由：接入承接 + 请求尾帧

**File**: `src/app/api/shot-groups/[id]/generate/route.ts`

承接逻辑插入在「`scriptHash` 幂等短路与余额校验之后、积分冻结事务之前」。`scriptHash` 固定基于**承接前的基础 `seedancePrompt`（角色前缀 + 脚本）+ 时长 + 分辨率**计算，承接内容（尾帧参考图与 prompt 承接指令）**不进入幂等键**，仅改写实际提交 Seedance 的 `prompt` 与 `referenceImages`。该取舍基于两条理由：

- **(a) 满足 Req 3.6「幂等短路行为不变」**：承接不改变幂等键，`SUCCEEDED` 且非 `force` 时仍正确命中幂等短路，行为与修复前一致。
- **(b) 满足 Req 3.8「不级联重生成」**：承接源自前一组持久化尾帧这一**外部可变状态**，若纳入幂等键，前一组 `force` 重生成刷新尾帧会静默改变本组幂等键并触发非预期重生成。

1. 计算 `scriptHash`：固定基于承接前的基础 `seedancePrompt`（角色前缀 + 脚本）+ 时长 + 分辨率，承接内容不参与该哈希；`force` 幂等短路与余额校验照常基于该哈希执行。
2. 幂等短路与余额校验通过后、积分冻结事务之前，查询前一组 `P = findFirst({ projectId, groupIndex: { lt: group.groupIndex }, orderBy: groupIndex desc })`。
3. 若 `P && P.genStatus === 'SUCCEEDED' && P.lastFrameUrl` → 调用 `applySameSceneContinuation({ prevGroupId: P.id, currentGroupId: group.id, lastFrameUrl: P.lastFrameUrl, referenceImages: groupRef.referenceImages, prompt: seedancePrompt })`，用返回值覆盖**实际提交 Seedance 的** `referenceImages` 与 `seedancePrompt`（不回写幂等键），并据 `applied` 输出承接/不承接日志；否则保持原 `referenceImages` / `seedancePrompt` 不变。
4. 计算「本组是否存在同场景后继组」以决定 `returnLastFrame`：查询紧邻后继组 N（`groupIndex` 大于本组的最小者），若 N 首镜 `scene` 与本组末镜 `scene` 同场景 → 入队时 `returnLastFrame: true`，使本组尾帧被持久化、支撑 单组→单组 承接（Req 2.3）。
5. 入队 `video-generate` 时携带承接后的 `prompt` / `referenceImages` 及 `returnLastFrame` 标志。

`scriptHash`、`force` 短路、余额校验、`withCreditLock` 冻结事务、`RESERVE` 流水、组/分镜状态置位等既有逻辑顺序与实现保持不变。

#### 5. Seedance 客户端

**File**: `src/lib/seedance.ts`

`SeedanceCreateParams.returnLastFrame` 与 `return_last_frame` 入参、`SeedanceTaskStatus.lastFrameUrl`（`content.last_frame_url`）均已具备，无需改动；本次仅复用既有契约。

## Testing Strategy

### Validation Approach

采用两阶段：先在**未修复代码**上用测试暴露反例（确认承接缺失与尾帧未持久化的根因），再在**修复后代码**上验证承接正确发生且非 bug 条件行为不变。

### Exploratory Bug Condition Checking

**Goal**: 在实现修复前先暴露反例，确认/反驳根因。若反驳则需重新假设。

**Test Plan**: 构造「项目含组 1、组 2 同场景，组 1 已成功生成」的数据，对组 2 调用单组生成路由，断言 Seedance 入参 `referenceImages` 包含组 1 尾帧、prompt 含承接指令。在未修复代码上运行以观察失败。

**Test Cases**:
1. **单组同场景承接缺失**：组 1 成功（含尾帧）、组 2 同场景，单独生成组 2，断言入参含承接参考图（未修复代码上失败）。
2. **尾帧未持久化**：链式生成组 1 成功后，查询 `ShotGroup.lastFrameUrl`，断言非空（未修复代码上字段不存在/为空而失败）。
3. **路径一致性**：对同一「前一组、当前组」，比较单组承接装配与链式 `applySameSceneContinuation` 装配结果，断言一致（未修复代码上单组无装配而失败）。
4. **边界——参考图已满 9 张**：referenceImages 已含 9 张时不追加尾帧（验证软承接上限）。

**Expected Counterexamples**:
- 单组路径 Seedance 入参不含前一组尾帧、prompt 无承接指令。
- 可能原因：尾帧未持久化、承接逻辑仅在链式 worker、单组未请求 `returnLastFrame`。

### Fix Checking

**Goal**: 验证所有满足 bug 条件的输入，修复后的单组生成产出期望承接行为。

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  singleResult ← F'_single(input)         // 修复后的单组生成入参装配
  chainResult  ← applySameSceneContinuation(对应前一组/当前组)   // 一致性基准
  ASSERT singleResult.referenceImages 包含 P.lastFrameUrl
  ASSERT singleResult.prompt 含「以图片N作为起始承接画面」指定
  ASSERT singleResult.承接装配 = chainResult.承接装配
  ASSERT NOT usesRole(singleResult, 'first_frame')
  ASSERT singleResult.referenceImages.length <= 9
END FOR
```

### Preservation Checking

**Goal**: 验证所有不满足 bug 条件的输入，修复后的单组生成与修复前完全一致。

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT F'_single(input) = F_single(input)   // 无前一组/跨场景/前组无尾帧/链式 → 装配不变
END FOR
```

**Testing Approach**: 推荐属性测试做保持校验，理由：自动覆盖输入域、捕获边缘案例、对「非 bug 输入行为不变」给出强保证。

**Test Plan**: 先在未修复代码上观察非 bug 输入（首组、跨场景、前组未成功）的入参与 `scriptHash`，再写属性测试断言修复后逐项一致。

**Test Cases**:
1. **首组保持**：无前一组时入参与修复前一致，不追加参考图。
2. **跨场景保持**：与前一组跨场景时不承接，独立起镜。
3. **前组无尾帧保持**：前一组未成功 / `lastFrameUrl` 为空时不承接、不报错。
4. **幂等/抽卡保持**：非 bug 条件下 `scriptHash` 与修复前一致；`force` 抽卡行为不变。
5. **链式保持**：链式 `triggerNextChainGroup` 承接/跨场景/合并行为不变（共享函数同入参同输出）。

### Unit Tests

- `applySameSceneContinuation`：同场景追加、跨场景/缺失不追加、`lastFrameUrl` 为空不追加、已满 9 张不追加、`contIndex` 取 `length+1`、prompt 文案与链式一字一致。
- `atomicSuccessUpdate`：有尾帧写入 `lastFrameUrl`、无尾帧写 `null`（覆盖陈旧尾帧）。
- 单组路由：bug 条件下入参含承接图+指令；非 bug 条件下入参与 `scriptHash` 不变；`returnLastFrame` 仅在存在同场景后继组时为 true。

### Property-Based Tests

- 随机生成项目分组与场景序列，断言：满足 bug 条件 → 单组承接装配 == 链式装配；不满足 → 单组装配与修复前一致。
- 随机参考图数量（含临界 8/9/10），断言承接仅在未满 9 张时发生且总数 ≤ 9。
- 随机 `scene` 值（含空/大小写/空白差异），断言 `normScene` 同场景判定与链式一致。

### Integration Tests

- 端到端：一键生成后单独重生成某同场景组，断言该组 Seedance 入参承接前一组尾帧、最终衔接效果与链式一致。
- 持久化链路：链式 / 单组生成成功后查询 `ShotGroup.lastFrameUrl` 已写入；`force` 重生成后该字段被刷新为最新值（或在本次未返回尾帧时为 null）。
- 跨场景与首组：单独生成首组 / 跨场景组，断言独立起镜、积分冻结/扣费/退款全流程不变。
