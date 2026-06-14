# Bugfix 需求文档

## Introduction

「单独生成某分镜组」（`POST /api/shot-groups/[id]/generate`）与「一键生成视频」（`POST /api/projects/[id]/generate` → 链式串行）这两条生成路径，在镜头衔接（尾帧承接）行为上不一致：

- **一键生成（链式）**：在 worker 的 `triggerNextChainGroup` 中已实现「同场景尾帧承接」——当上一组末镜的 `scene` 与下一组首镜的 `scene` 相同时，把上一组 Seedance 返回的尾帧（`lastFrameUrl`）作为额外 `reference_image` 追加，并在 prompt 末尾加「以图片N作为起始承接画面…」，实现镜头连续。
- **单组生成**：没有任何承接逻辑，每组都独立起镜。

导致用户单独重生成某一组时，该组与前一组（同场景）之间出现画面跳变，衔接效果与一键生成不一致。

**根因**：链式承接所依赖的尾帧 `lastFrameUrl` 目前只在链式 worker 的内存里临时传递，从未持久化。单组生成路径无法读取到前一组的尾帧，因此无法承接；此外，若前一组生成时未请求 `returnLastFrame`，则根本不存在可用尾帧。

本次修复目标：让单组生成与一键生成共用同一套「同场景尾帧承接」逻辑，使两条路径产出一致的衔接效果。

## Bug Analysis

> 触发条件（Bug Condition）：对某分镜组 G 发起单组生成时，项目内存在 G 的「前一组」P（`P.groupIndex` 为小于 G 的最大值），且 P 的末镜 `scene` 与 G 的首镜 `scene` 相同，且 P 已成功生成。
>
> 非触发条件（保持不变）：单组 G 没有前一组、或与前一组跨场景（`scene` 不同 / 缺失）、或前一组尚未成功生成、或链式（一键生成）路径。承接判定基于发起生成时刻前一组的持久化状态（`genStatus`、`lastFrameUrl`），不随后续乱序生成或重生成而回溯。

### Current Behavior (Defect)

1.1 WHEN 用户对某分镜组发起单组生成，且其前一组（同场景）已成功生成并存在受信尾帧 THEN 系统不承接前一组尾帧，该组独立起镜，与前一组之间出现画面跳变

1.2 WHEN 用户对某分镜组发起单组生成，且其前一组（同场景）已成功生成 THEN 系统无法读取到前一组的尾帧，因为尾帧 `lastFrameUrl` 从未持久化、仅在链式 worker 内存中临时传递

1.3 WHEN 任一分镜组（含链式与单组路径）成功生成 THEN 系统不持久化该组的 Seedance 尾帧，后续任何路径都无法复用该尾帧作承接

### Expected Behavior (Correct)

2.1 WHEN 用户对某分镜组发起单组生成，且其前一组（同场景）已成功生成并存在受信尾帧 THEN 系统 SHALL 把前一组尾帧作为额外 `reference_image` 追加，并在 prompt 中指定其为本组「起始承接画面」，产出与一键生成一致的承接效果

2.2 WHEN 用户对某分镜组发起单组生成，且其前一组（同场景）已成功生成 THEN 系统 SHALL 能从持久化数据中读取到前一组的尾帧 URL（无需依赖内存传递）

2.3 WHEN 任一分镜组（含链式与单组路径）成功生成且 Seedance 返回了尾帧 THEN 系统 SHALL 持久化该组的尾帧 URL，供后续任意路径复用

2.4 WHEN 单组生成与一键生成对「同一前一组、同一当前组」做承接 THEN 两条路径 SHALL 使用同一套承接判定与装配逻辑（同一共享函数），保证行为一致

### Unchanged Behavior (Regression Prevention)

3.1 WHEN 用户对某分镜组发起单组生成，且该组没有前一组（如项目首组） THEN 系统 SHALL CONTINUE TO 独立起镜，不追加任何承接参考图

3.2 WHEN 用户对某分镜组发起单组生成，且其与前一组跨场景（`scene` 不同或缺失） THEN 系统 SHALL CONTINUE TO 不承接尾帧、独立起镜（宁跳变不糊连的既有保守策略）

3.3 WHEN 用户对某分镜组发起单组生成，且其前一组尚未成功生成 / 无持久化尾帧 THEN 系统 SHALL CONTINUE TO 独立起镜，不报错、不静默塞入无效参考

3.4 WHEN 承接发生时，承接图作为 `reference_image` 注入（软承接） THEN 系统 SHALL CONTINUE TO 不使用 `role=first_frame`，且不挤占人物锚定/场景帧（参考图总数 ≤ 9）

3.5 WHEN 一键生成（链式）路径运行 THEN 系统 SHALL CONTINUE TO 保持既有的同场景尾帧承接、跨场景独立起镜、自动合并行为不变

3.6 WHEN 单组生成路径运行 THEN 系统 SHALL CONTINUE TO 保持既有的 `scriptHash` 幂等短路、`force` 抽卡、积分冻结/扣费/退款行为不变

3.7 WHEN 承接所用尾帧来源被选取 THEN 系统 SHALL CONTINUE TO 仅信任 Seedance 返回的尾帧（本账号、方舟平台、近 30 天受信产物），不使用 FFmpeg 从成片抽取的真人脸帧，避免被方舟输入审核拦截

3.8 WHEN 用户以乱序方式生成分镜组（先生成后序组再生成前序组，或重生成前序组导致其尾帧刷新） THEN 系统 SHALL CONTINUE TO 以「发起生成当前组 G 那一刻、前一组 P 的持久化状态（`genStatus`、`lastFrameUrl`）」为承接判定依据，按生成顺序尽力承接，不做跨时序的回溯或级联刷新——即：
- 若先单独生成组 2（此时组 1 尚未成功）→ 组 2 独立起镜；之后再生成组 1 成功并持久化尾帧时，系统 SHALL NOT 自动回头重生成组 2 来补承接，组 2 保持已生成结果，不报错；
- 若重生成前序组 P（`force`）导致其尾帧刷新，系统 SHALL NOT 自动重生成已基于旧尾帧生成的后序组，后序组承接保持为生成当时的状态（可能是过时尾帧），不报错、不静默改动。

> 说明：3.8 属 Preservation 行为的显式声明（方案 A：维持现状、显式文档化）。乱序下「未承接」等同于「前一组在生成当时未成功 / 无持久化尾帧」分支，已被 3.3 及 `isBugCondition` 覆盖；本条不引入新代码逻辑、不引入自动触发 / 级联重生成。

## Bug 条件与属性（结构化伪代码）

### Bug 条件函数

```pascal
FUNCTION isBugCondition(req)
  INPUT: req = { groupId, mode }  // mode = 'single'（单组生成）
  OUTPUT: boolean

  IF req.mode <> 'single' THEN RETURN false        // 仅单组路径触发
  G ← getGroup(req.groupId)
  P ← getPreviousGroup(G)                           // groupIndex 小于 G 的最大者
  IF P = NULL THEN RETURN false                     // 无前一组 → 不触发
  IF P.genStatus <> 'SUCCEEDED' THEN RETURN false   // 前一组未成功 → 不触发
  IF normScene(lastShot(P).scene) <> normScene(firstShot(G).scene) THEN RETURN false  // 跨场景 → 不触发
  IF P.lastFrameUrl 不存在受信尾帧 THEN RETURN false // 无受信尾帧 → 不触发

  RETURN true   // 同场景、前一组成功且有受信尾帧 → 本应承接却没承接
END FUNCTION
```

### 属性规格（Fix Checking）

```pascal
// 属性：修复校验——单组路径在 bug 条件下应承接前一组尾帧，结果与链式一致
FOR ALL req WHERE isBugCondition(req) DO
  singleResult ← F'_single(req)        // 修复后的单组生成
  chainResult  ← F_chain(req.groupId)  // 链式对同一组的承接装配
  ASSERT singleResult.referenceImages 包含 P.lastFrameUrl
  ASSERT singleResult.prompt 含「以图片N作为起始承接画面」指定
  ASSERT singleResult.承接装配 = chainResult.承接装配   // 两路径行为一致
  ASSERT NOT usesRole(singleResult, 'first_frame')      // 软承接
  ASSERT singleResult.referenceImages.length <= 9
END FOR
```

### 保持不变（Preservation Checking）

```pascal
// 属性：保持校验——非 bug 条件下，单组生成行为与修复前完全一致
FOR ALL req WHERE NOT isBugCondition(req) DO
  ASSERT F'_single(req) = F_single(req)   // 无前一组/跨场景/前组未成功/链式 → 不变
END FOR
```

**定义说明**
- **F_single**：修复前的单组生成函数（无承接，独立起镜）
- **F'_single**：修复后的单组生成函数（同场景且前组有受信尾帧时承接）
- **F_chain**：链式 `triggerNextChainGroup` 的承接装配逻辑（作为一致性基准）
