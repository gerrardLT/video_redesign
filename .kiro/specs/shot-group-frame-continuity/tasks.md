# Implementation Plan

## Overview

本计划遵循探索式 bugfix 工作流，修复「单组生成」与「一键生成（链式）」在同场景尾帧承接上的行为不一致。顺序为：先写 Bug 条件探索测试（Property 1，未修复代码上 FAIL）与保持测试（Property 2，未修复代码上 PASS），再实施修复（持久化尾帧 + 抽取共享承接函数 + 链式复用 + 单组接入），最后验证两类测试状态翻转并跑全套测试。

## Tasks

- [x] 1. 编写 Bug 条件探索测试（在修复前）
  - **Property 1: Bug Condition** - 单组路径同场景尾帧承接缺失
  - **CRITICAL**: 此测试必须在未修复代码上 FAIL —— 失败即确认 bug 存在
  - **DO NOT** 在测试失败时去修测试或代码；失败是预期的正确结果
  - **NOTE**: 此测试编码了期望承接行为，修复后转为 PASS 即可验证修复
  - **GOAL**: 暴露反例，证明单组生成在 bug 条件下未承接前一组尾帧
  - **Scoped PBT Approach**: 对确定性场景固定到具体可复现用例——「项目含组 1、组 2 同场景，组 1 已成功生成且持有受信尾帧 `lastFrameUrl`」，对组 2 调用单组生成路由 `POST /api/shot-groups/[id]/generate`
  - 依据 design「Bug Condition / isBugCondition」构造满足条件的数据：`mode='single'`、存在前一组 P、`P.genStatus='SUCCEEDED'`、`P.lastFrameUrl` 非空、`normScene(lastShot(P).scene) == normScene(firstShot(G).scene)`
  - 断言（依据 design「Correctness Properties / Property 1」与「Fix Checking」伪代码）：
    - Seedance 入参 `referenceImages` 包含 `P.lastFrameUrl`
    - prompt 含「以图片N作为起始承接画面」承接指令
    - 单组承接装配结果与链式 `applySameSceneContinuation`（对同一前一组/当前组）一致
    - 全程软承接，未使用 `role=first_frame`
    - `referenceImages.length <= 9`
  - 补充用例：链式生成组 1 成功后查询 `ShotGroup.lastFrameUrl` 断言非空（未修复代码上字段不存在/为空而失败，确认「尾帧未持久化」根因）
  - 在未修复代码上运行
  - **EXPECTED OUTCOME**: 测试 FAIL（正确——证明 bug 存在：单组入参不含承接图、prompt 无承接指令、尾帧未持久化）
  - 记录反例（如「单组生成组 2 时 Seedance 入参不含组 1 尾帧，prompt 无承接指令；`ShotGroup` 无 `lastFrameUrl` 字段」）以理解根因
  - 测试写好、运行并记录失败后，标记此任务完成
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. 编写保持（Preservation）属性测试（在修复前）
  - **Property 2: Preservation** - 非承接输入行为保持不变
  - **IMPORTANT**: 遵循「观察优先」方法论——先在未修复代码上观察非 bug 输入的真实行为，再写测试断言该行为
  - 观察并记录未修复代码在以下非 bug 条件输入下的入参与 `scriptHash`（依据 design「Preservation Requirements」与 isBugCondition 返回 false 的分支）：
    - 首组（无前一组）：单独生成时入参不含承接参考图、独立起镜
    - 跨场景（与前一组 `scene` 不同或缺失）：不承接、独立起镜
    - 前一组未成功 / `lastFrameUrl` 为空：不承接、不报错、不静默塞入无效参考
    - 链式路径：`triggerNextChainGroup` 承接/跨场景/合并行为
    - 乱序/时序场景——(a) 先单独生成后序组（前序组当时未成功）后序组独立起镜；(b) `force` 重生成前序组刷新尾帧后，已生成的后序组不被自动重生成。观察这两类情况下系统不报错、不触发对已生成组的级联重生成
  - 编写属性测试断言（依据 design「Preservation Checking」伪代码 `F'_single(input) = F_single(input)`）：
    - 对所有 `isBugCondition` 返回 false 的输入，单组生成入参与 `scriptHash` 与修复前逐项一致
    - 软承接上限：随机参考图数量（含临界 8/9/10），承接仅在未满 9 张时发生且总数 ≤ 9（Req 3.4）
    - `scriptHash` 幂等短路、`force` 抽卡、积分冻结/扣费/退款行为不变（Req 3.6）
    - 链式路径行为不变（共享函数同入参同输出，Req 3.5）
    - 对乱序/时序输入（前一组在生成当时未成功或尾帧尚未刷新到位），单组生成装配与 `scriptHash` 与修复前一致，且系统不发起任何自动回补/级联重生成（Req 3.8）
  - 属性测试自动覆盖输入域，对「非 bug 输入行为不变」给出更强保证
  - 在未修复代码上运行
  - **EXPECTED OUTCOME**: 测试 PASS（确认需保持的基线行为）
  - 测试写好、运行并在未修复代码上通过后，标记此任务完成
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

- [x] 3. 修复：单组生成与一键生成共用同场景尾帧承接

  - [x] 3.1 数据层：`ShotGroup` 新增持久化尾帧字段
    - 在 `prisma/schema.prisma` 的 `ShotGroup` 模型新增 `lastFrameUrl String? @map("last_frame_url")`，并补充字段注释（说明：本组成功时 Seedance 返回的受信尾帧 URL，供后续同场景承接复用）
    - 执行 `prisma migrate dev --name add_shotgroup_last_frame_url` 生成迁移并更新生成的 client（`src/generated/prisma`）
    - _Bug_Condition: isBugCondition(input) —— P.lastFrameUrl 需可从持久化读取_
    - _Expected_Behavior: 任一路径成功且返回尾帧时持久化该 URL（design Fix Implementation #1）_
    - _Requirements: 1.3, 2.2, 2.3_

  - [x] 3.2 行为层：抽取共享承接函数 `applySameSceneContinuation`
    - 新建 `src/lib/frame-continuity.ts`，实现「同场景判定 + 尾帧装配为 `reference_image` + prompt 承接指令」单一共享函数（依据 design Fix Implementation #2 伪代码）
    - `lastFrameUrl` 为空 / `referenceImages.length >= 9` / 跨场景或 `scene` 缺失 → `applied=false` 原样返回
    - 同场景时追加 `lastFrameUrl` 至末尾，`contIndex = length + 1`，prompt 拼接承接文案（与现有链式实现一字一致）
    - 由本模块统一持有并导出 `normScene`（`(s) => (s ?? '').trim().replace(/\s+/g,'').toLowerCase()`）
    - _Bug_Condition: isBugCondition(input) from design_
    - _Expected_Behavior: 软承接装配，referenceImages ≤ 9，prompt 含「以图片N作为起始承接画面」_
    - _Requirements: 2.1, 2.4, 3.4_

  - [x] 3.3 链式 worker：复用共享函数 + 持久化尾帧
    - `src/workers/generate-video.ts`：`triggerNextChainGroup` 删除内联同场景判定/尾帧追加/prompt 拼接与局部 `normScene`，改调用 `applySameSceneContinuation`，用返回值覆盖 `referenceImages`/`nextPrompt`，据 `applied` 输出等价日志（行为不变）
    - `atomicSuccessUpdate` 新增可选参数 `lastFrameUrl?: string`，在成功事务内写入 `ShotGroup.lastFrameUrl: lastFrameUrl ?? null`（覆盖陈旧尾帧，避免 `force` 重生成残留）
    - `processGroupVideoGenerate` 将轮询得到的 `lastFrameUrl` 透传给 `atomicSuccessUpdate`（链式与单组共用此函数，一处持久化覆盖两路径）
    - `returnLastFrame` 计算改为 `job.data.returnLastFrame === true || (chainMode && chainCurrentIndex < chainTotalGroups - 1)`，链式分支结果与现状相同
    - 同步更新被修改逻辑对应的注释
    - _Bug_Condition: isBugCondition(input) from design_
    - _Expected_Behavior: expectedBehavior —— 尾帧持久化 + 链式复用共享函数（design Fix Implementation #3）_
    - _Preservation: 链式承接/跨场景/合并行为不变（design Preservation Requirements，Req 3.5）_
    - _Requirements: 2.3, 2.4, 3.5_

  - [x] 3.4 单组路由：接入承接 + 请求尾帧
    - `src/app/api/shot-groups/[id]/generate/route.ts`：在 `seedancePrompt` 装配完成之后、`computeScriptHash` 之前插入承接逻辑
    - 查询前一组 P（`projectId` 相同、`groupIndex < group.groupIndex` 的最大者）
    - 若 `P && P.genStatus==='SUCCEEDED' && P.lastFrameUrl` → 调用 `applySameSceneContinuation`，用返回值覆盖 `referenceImages`/`seedancePrompt`，据 `applied` 输出承接/不承接日志；否则原样不变
    - 计算「是否存在同场景后继组 N」决定入队 `returnLastFrame: true`，使本组尾帧被持久化、支撑 单组→单组 承接
    - 保持 `scriptHash`、`force` 短路、余额校验、`withCreditLock` 冻结、`RESERVE` 流水、组/分镜状态置位等既有顺序与实现不变
    - 同步更新对应注释
    - _Bug_Condition: isBugCondition(input) where mode='single' from design_
    - _Expected_Behavior: expectedBehavior —— 读取 P.lastFrameUrl 软承接注入（design Fix Implementation #4）_
    - _Preservation: 非 bug 条件下 prompt/referenceImages/scriptHash 逐字节不变（Req 3.1, 3.2, 3.3, 3.6）_
    - _Requirements: 2.1, 2.2, 2.4, 3.1, 3.2, 3.3, 3.6, 3.7_

  - [x] 3.5 验证 Bug 条件探索测试现在通过
    - **Property 1: Expected Behavior** - 单组路径同场景尾帧承接
    - **IMPORTANT**: 重跑任务 1 的同一测试 —— 不要写新测试
    - 任务 1 的测试编码了期望承接行为，其通过即确认期望行为被满足
    - 运行任务 1 的 Bug 条件探索测试
    - **EXPECTED OUTCOME**: 测试 PASS（确认 bug 已修复：单组入参含承接图+指令、装配与链式一致、尾帧已持久化）
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 3.6 验证保持测试仍然通过
    - **Property 2: Preservation** - 非承接输入行为保持不变
    - **IMPORTANT**: 重跑任务 2 的同一组测试 —— 不要写新测试
    - 运行任务 2 的保持属性测试
    - **EXPECTED OUTCOME**: 测试 PASS（确认无回归）
    - 确认修复后所有保持测试仍通过（首组/跨场景/前组无尾帧独立起镜、scriptHash 幂等、force 抽卡、积分流程、链式行为均不变）
    - 确认乱序/时序场景（后序组先生成、前序组 `force` 刷新尾帧）行为保持不变、无自动级联重生成
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

- [x] 4. Checkpoint - 确保所有测试通过
  - 运行完整测试套件（探索测试、保持测试、单元测试、属性测试、集成测试），确保全部通过
  - 端到端验证：一键生成后单独重生成某同场景组，断言其 Seedance 入参承接前一组尾帧、衔接效果与链式一致
  - 持久化链路验证：链式/单组成功后 `ShotGroup.lastFrameUrl` 已写入；`force` 重生成后刷新为最新值（本次无尾帧则为 null）
  - 乱序验证：先生成后序组再生成前序组、以及 `force` 重生成前序组，确认系统不自动回补/级联重生成已生成组，符合方案 A
  - 如有疑问，向用户确认

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2"], "dependsOn": [] },
    { "wave": 2, "tasks": ["3.1", "3.2"], "dependsOn": ["1", "2"] },
    { "wave": 3, "tasks": ["3.3", "3.4"], "dependsOn": ["3.1", "3.2"] },
    { "wave": 4, "tasks": ["3.5", "3.6"], "dependsOn": ["3.3", "3.4"] },
    { "wave": 5, "tasks": ["4"], "dependsOn": ["3.5", "3.6"] }
  ]
}
```

- 任务 1、2 必须先于任何实现完成，并分别在未修复代码上记录 FAIL / PASS。
- 任务 3.1、3.2 是 3.3、3.4 的前置依赖（数据字段与共享函数先就绪）。
- 任务 3.5、3.6 依赖 3.1–3.4 的修复全部落地。
- 任务 4 依赖 3.5、3.6 通过。

## Notes

- **Property 格式**：任务 1、2 及验证子任务 3.5、3.6 使用 `**Property N: Type**` 格式以启用悬停状态追踪。
- **测试先行**：探索测试（Property 1）与保持测试（Property 2）必须在修复前编写并运行——前者预期 FAIL（证明 bug），后者预期 PASS（确立基线）。
- **不要在探索测试失败时去修测试**：失败是预期的正确结果，修复实现后该测试自然转为 PASS。
- **仅信任 Seedance 尾帧**：承接尾帧仅取 Seedance 返回的受信产物（本账号、方舟平台近 30 天），不使用 FFmpeg 从成片抽取真人脸帧（Req 3.7）。
- **同步更新注释**：依据仓库 code-quality 规则，修改逻辑时一并更新对应注释，不留过时/废弃描述。
- **无静默 fallback**：前一组无受信尾帧时独立起镜、不报错、不塞入无效参考（Req 3.3），不引入伪造数据。
- **乱序/时序承接（方案 A）**：先生成后序组再生成前序组、或 `force` 重生成前序组刷新尾帧的时序场景，采用方案 A（维持现状、显式文档化），不引入新代码逻辑与自动级联重生成，仅以测试断言「无回补/无级联」行为（Req 3.8）。
