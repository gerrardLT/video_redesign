# Implementation Plan

## Overview

本计划遵循探索式 bugfix 工作流（缺陷条件方法学），独立修复「视频生成产物」链路上 4 个缺陷（Bug 1+4 合并丢失、Bug 2 封面来源、Bug 3 组音频趋同），与既有 `video-pipeline-fixes` 无重叠。顺序为：先写三条缺陷条件探索测试（Property 1/2/3，在**未修复**代码上 FAIL）与保持测试（Property 4，在**未修复**代码上 PASS），再分缺陷实施修复，最后验证各探索测试状态翻转并跑全套测试。

测试框架：Vitest（`npm run test` → `vitest run`），属性化测试用 `fast-check`。用户铁律：业务走真实接口与真实流程，禁止 fallback / 静默处理 / 假数据；改动代码同步更新注释，删除过时注释。

## Tasks

- [x] 1. 编写缺陷一（Bug 1+4）合并丢失探索性测试
  - **Property 1: Bug Condition** - 合并时不丢分镜/prompt（Bug 1+4）
  - **CRITICAL**: 此测试必须在**未修复**代码上 FAIL —— 失败即确认 bug 存在
  - **DO NOT** 在测试失败时去修测试或代码；失败是预期的正确结果
  - **NOTE**: 此测试编码了期望行为，修复后转为 PASS 即可验证修复（Property 1）
  - **GOAL**: 暴露反例，证明 `mergeTimelineScript` 在原 250 字预算下会丢段/截断
  - **Scoped PBT Approach**: 对确定性丢段固定到具体可复现用例，并用 fast-check 随机化段数/prompt 长度/台词长度扩大覆盖
  - 依据 design「Bug Condition / isBugCondition_1_4」构造含 3 个分镜、各 prompt 含运镜+动作+较长 `{台词}`、合并后超 `budgetForTimeline`（约 180~200 字）的组
  - 断言（依据 design「Correctness Properties / Property 1」期望行为）：`merged.droppedSegmentCount = 0`；每个非空 `shot.prompt` 的核心语义/`{台词}` 完整出现在 `merged.text`
  - 覆盖三个子触发点：超预算尾段被 `break` 丢弃、单段超长被 `line.slice(0, budgetForTimeline)` 截断、`deduplicateAgainstStyle()` 正则误删 prompt 正文
  - 在**未修复**代码上运行（`npm run test`）
  - **EXPECTED OUTCOME**: 测试 FAIL（正确——证明 bug 存在）
  - 记录反例（如「3 段组 `droppedSegmentCount>0`」「首段台词被截断」「正文被去重误删」）以理解根因
  - 测试写好、运行并记录失败后，标记此任务完成
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 2. 编写缺陷二（Bug 2）封面来源探索性测试
  - **Property 2: Bug Condition** - 封面来自生成视频（Bug 2）
  - **CRITICAL**: 此测试必须在**未修复**代码上 FAIL —— 失败即确认 bug 存在
  - **DO NOT** 在测试失败时去修测试或代码；失败是预期的正确结果
  - **NOTE**: 此测试编码了期望行为，修复后转为 PASS 即可验证修复（Property 2）
  - **GOAL**: 暴露反例，证明展示用封面来源于原视频抽帧而非生成视频
  - 依据 design「Bug Condition / isBugCondition_2」模拟一个 `genStatus='SUCCEEDED'` 且有 `genVideoUrl` 的分镜组
  - 断言（依据 design「Correctness Properties / Property 2」期望行为）：存在来自 `group.genVideoUrl` 抽帧的封面字段（`ShotGroup.genCoverUrl`），且前端 `poster` 使用该字段
  - 在**未修复**代码上运行
  - **EXPECTED OUTCOME**: 测试 FAIL（未修复代码无 `genCoverUrl`、`poster` 用 `group.shots[0]?.coverUrl` 原视频帧）
  - 记录反例：`poster = shots[0].coverUrl`、不存在 `genCoverUrl`
  - 测试写好、运行并记录失败后，标记此任务完成
  - _Requirements: 1.6, 1.7, 1.8_

- [x] 3. 编写缺陷三（Bug 3）组音频趋同探索性测试
  - **Property 3: Bug Condition** - 各组真实使用各自原声（Bug 3）
  - **CRITICAL**: 此测试必须在**未修复**代码上 FAIL —— 失败即确认 bug 存在
  - **DO NOT** 在测试失败时去修测试或代码；失败是预期的正确结果
  - **NOTE**: 此测试编码了期望行为，修复后转为 PASS 即可验证修复（Property 3）
  - **GOAL**: 暴露反例，证明各组专属 `audioKey` 原声未被真实采用
  - 依据 design「Bug Condition / isBugCondition_3」构造两组不同 `audioKey` 的分镜组（含未配 OSS、本地 `/uploads/{key}` 路径场景）
  - 断言（依据 design「Correctness Properties / Property 3」期望行为）：`resolveSegmentAudioPlans` 为各段选中各自组原声（`source='file'` 指向不同 audioPath）；未配 OSS 时组音频被真实提供、不被静默置空为 `referenceAudioUrl=undefined`
  - 在**未修复**代码上运行
  - **EXPECTED OUTCOME**: 测试 FAIL（未修复代码恒选 `source='embedded'`；`referenceAudioUrl=undefined`）
  - 记录反例：所有段 `source='embedded'`、`referenceAudioUrl=undefined`
  - 测试写好、运行并记录失败后，标记此任务完成
  - _Requirements: 1.9, 1.10, 1.11_

- [x] 4. 编写保持（Preservation）属性测试（在修复前）
  - **Property 4: Preservation** - 非缺陷输入行为完全不变
  - **IMPORTANT**: 遵循「观察优先」方法论——先在**未修复**代码上观察非缺陷输入的真实行为，再写测试断言该行为
  - 观察并记录未修复代码在以下非缺陷输入下的真实输出（依据 design「Preservation Requirements」3.1~3.7 与 Testing Strategy）：
    - 合并脚本**未超预算**的组 → 记录 `mergeTimelineScript` 的 `text`/`segments`/`droppedSegmentCount`（3.1）
    - `[图N]` 素材引用解析、运镜词前缀补全、`{台词}` 大括号格式保留的输出（3.2）
    - `hasFace=false` 无脸帧的 `Shot.coverUrl` 作 `reference_image` 场景参考的取值（3.3）
    - 已配 OSS、组音频为 https 公网 URL 时 `referenceAudioUrl` 与合并音源决策（3.6）
    - 无 `audioKey` / 确无原声的段走 `embedded` / `silence` 的音轨决策与音画对齐（3.4, 3.5）
  - 用 fast-check 编写属性测试，断言上述非缺陷输入修复后输出与修复前**逐字/逐项一致**（`F(X) = F'(X)`）
  - 属性测试自动生成大量跨域输入，覆盖手写用例易漏的边界，提供更强的不回归保证
  - 在**未修复**代码上运行（`npm run test`）
  - **EXPECTED OUTCOME**: 测试 PASS（确认需保持的基线行为）
  - 测试写好、运行并在未修复代码上通过后，标记此任务完成
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 5. 修复缺陷一（Bug 1+4）：合并不丢分镜/prompt

  - [x] 5.1 重新设计字数承载并修正去重，保证全组分镜/台词完整
    - 文件：`src/lib/script-merger.ts`；函数：`mergeTimelineScript`、`deduplicateAgainstStyle`
    - 取消「超预算即 `break` 丢整段」与「首段 `line.slice(0, budgetForTimeline)` 截台词」两处有损路径
    - 按分镜组实际段数（组 ≤3 段，`MAX_SHOTS_PER_GROUP=3`）计算自适应预算，保证每段「`镜头N：`前缀 + 运镜 + 核心动作 + `{台词}`」完整保留
    - `MAX_SCRIPT_LENGTH` 由「硬截断阈值」降级为「软目标」；超软目标时仅压缩可省略修饰（光线/环境形容词等），绝不删整段、绝不切断 `{台词}` 大括号内容
    - 修正 `deduplicateAgainstStyle()`：仅当待删片段确与 `stylePrefix` 某条「角色名：外貌」描述真实重复时才移除，正则锚定角色外貌描述模式，避免匹配 prompt 正文
    - 同步更新 `MAX_SCRIPT_LENGTH`、`mergeTimelineScript`、`deduplicateAgainstStyle` 的常量/函数/行内注释，删除「超预算贪心丢段 / 首段段内截断」过时描述
    - _Bug_Condition: isBugCondition_1_4(group) —— 合并脚本超原 250 字预算导致丢段/截断_
    - _Expected_Behavior: Property 1 —— droppedSegmentCount=0 且全组 prompt/台词语义 ∈ merged.text_
    - _Preservation: 3.1, 3.2（未超预算输出不变、`[图N]`/运镜/`{台词}` 解析不变）_
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 5.2 不可避免取舍非静默上报并回传前端
    - 文件：`src/lib/script-merger.ts`、`src/app/api/shot-groups/[id]/generate/route.ts`、`src/app/api/projects/[id]/generate/route.ts`、`src/components/shot/ShotGroupList.tsx`
    - 扩展 `TimelineScriptResult`：在 `truncated`/`droppedSegmentCount` 基础上新增结构化取舍说明字段（如 `lossNotice`）
    - 两条 `generate` 路由读取该结果，在 API 响应中以结构化字段回传；前端 `ShotGroupList` 在对应组卡片展示「本组脚本发生取舍」可见提示（复用既有 `groupErrors`/提示区域）
    - 禁止仅 `console.warn` 后静默继续（遵守用户铁律：禁止静默处理）
    - 同步更新相关注释
    - _Bug_Condition: isBugCondition_1_4(group)_
    - _Expected_Behavior: Property 1 —— 不可避免取舍以结构化标志非静默暴露并回传前端_
    - _Requirements: 2.5_

  - [x] 5.3 验证缺陷一探索性测试现在通过
    - **Property 1: Expected Behavior** - 合并时不丢分镜/prompt（Bug 1+4）
    - **IMPORTANT**: 重跑任务 1 的同一测试 —— 不要写新测试
    - 任务 1 的测试编码了期望行为，其通过即确认期望行为被满足
    - 运行任务 1 的合并探索性测试
    - **EXPECTED OUTCOME**: 测试 PASS（确认缺陷一已修复）
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 5.4 验证保持测试仍然通过
    - **Property 4: Preservation** - 非缺陷输入行为完全不变
    - **IMPORTANT**: 重跑任务 4 的同一组测试 —— 不要写新测试
    - 运行任务 4 的保持属性测试
    - **EXPECTED OUTCOME**: 测试 PASS（确认未超预算合并、`[图N]`/运镜/`{台词}` 解析无回归）
    - _Requirements: 3.1, 3.2_

- [x] 6. 修复缺陷二（Bug 2）：封面取自生成视频

  - [x] 6.1 新增 `ShotGroup.genCoverUrl` 字段并从生成视频抽帧持久化
    - 文件：`prisma/schema.prisma`（`ShotGroup` 增 `genCoverUrl`）、`src/workers/generate-video.ts`
    - 函数：`processGroupVideoGenerate`、`atomicSuccessUpdate` 及其调用处
    - 新增 `ShotGroup.genCoverUrl`（生成视频封面 URL）；**不复用、不覆写 `Shot.coverUrl`**，保留其无脸帧作场景参考用途
    - 在 `processGroupVideoGenerate` 已下载 `tempVideoPath`（上传 OSS 之前）环节，用 ffmpeg 从生成视频抽一帧（如第 0.1s，scale 等比），上传 OSS（对象键 `gencover/{projectId}/{shotGroupId}.jpg`）得到 `genCoverUrl`
    - 抽帧/上传失败按既有失败隔离风格处理：记录真实错误、不写伪造 URL、不阻塞主流程（遵守用户铁律：禁止假数据）
    - 将 `genCoverUrl` 作为参数传入 `atomicSuccessUpdate`，在同一事务内随 `genStatus`/`genVideoUrl` 一并写入；抽帧本身在事务外完成，仅写入在事务内，保持原子性/幂等性
    - 同步更新 `atomicSuccessUpdate` 文件头/函数注释，新增「生成视频封面抽帧并持久化」说明
    - _Bug_Condition: isBugCondition_2(group) —— genStatus=SUCCEEDED 且有 genVideoUrl，但封面来源为原视频帧_
    - _Expected_Behavior: Property 2 —— genCoverUrl 来源于 group.genVideoUrl 抽帧_
    - _Preservation: 3.3, 3.7（Shot.coverUrl 不被改写、atomicSuccessUpdate 原子性/幂等不变）_
    - _Requirements: 2.6_

  - [x] 6.2 合并导出更新展示封面，接口与前端改用生成封面
    - 文件：`src/workers/merge-video.ts`、`/api/projects/[id]` 项目详情接口、`src/components/shot/ShotGroupList.tsx`
    - 函数：`processMergeVideo`、`ShotGroupCard`/`VideoPlayer`
    - `merge-video.ts` 合并成功后，将项目展示封面（`project.coverUrl`）更新为首个成功组的 `genCoverUrl`，使导出展示封面对应生成内容
    - `/api/projects/[id]` 的 `shotGroups` 返回 `genCoverUrl`；`ShotGroupData` 接口新增 `genCoverUrl`；`VideoPlayer` 的 `poster` 改用 `group.genCoverUrl || undefined`
    - 同步更新前端 `poster` 处注释，说明改用生成视频封面
    - _Bug_Condition: isBugCondition_2(group)_
    - _Expected_Behavior: Property 2 —— 前端 poster 使用 genCoverUrl，导出展示封面对应生成内容_
    - _Requirements: 2.7, 2.8_

  - [x] 6.3 验证缺陷二探索性测试现在通过
    - **Property 2: Expected Behavior** - 封面来自生成视频（Bug 2）
    - **IMPORTANT**: 重跑任务 2 的同一测试 —— 不要写新测试
    - 运行任务 2 的封面来源探索性测试
    - **EXPECTED OUTCOME**: 测试 PASS（确认 `genCoverUrl` 来自生成视频且 `poster` 使用之）
    - _Requirements: 2.6, 2.7, 2.8_

  - [x] 6.4 验证保持测试仍然通过
    - **Property 4: Preservation** - 非缺陷输入行为完全不变
    - **IMPORTANT**: 重跑任务 4 的同一组测试 —— 不要写新测试
    - 运行任务 4 的保持属性测试
    - **EXPECTED OUTCOME**: 测试 PASS（确认 `Shot.coverUrl` 未被改写、`atomicSuccessUpdate` 原子性/幂等无回归）
    - _Requirements: 3.3, 3.7_

- [x] 7. 修复缺陷三（Bug 3）：各组真实使用各自原声

  - [x] 7.1 重排合并音轨优先级，使各组原声真实作用于成片
    - 文件：`src/workers/merge-video.ts`；函数：`resolveSegmentAudioPlans`
    - 将优先级改为：① 该组 `audioKey` 原声（`source='file'`，真实、各组不同）→ ② 生成片段自带 Seedance TTS（`source='embedded'`）→ ③ 原视频整段按 `[startTime,endTime]` 提取原声（`source='file'`）→ 兜底静音补齐（`source='silence'`）
    - 本地 `/uploads/{key}` 原声经既有 `resolveMediaUrlToLocal` 映射到 public 目录读取，开发环境也用真实音频
    - 音画对齐（apad/atrim、统一重采样 44100/stereo）与 trim-on-merge 逻辑完全不变
    - 同步更新 `resolveSegmentAudioPlans`、`SegmentAudioPlan` 注释反映新优先级语义，删除「自带 TTS 最高优先级」过时描述
    - _Bug_Condition: isBugCondition_3(group) —— audioKey 非空但 resolveSegmentAudioPlans 恒命中 embedded_
    - _Expected_Behavior: Property 3 —— 各组 audioKey 原声实际作用，两组 audioKey 不同则成片音频可区分_
    - _Preservation: 3.4, 3.5（音画对齐、trim-on-merge、无 audioKey 走 embedded/silence 不变）_
    - _Requirements: 2.9, 2.10_

  - [x] 7.2 生成阶段以受信签名 URL 提供组音频，无音频非静默暴露
    - 文件：`src/lib/group-gen-context.ts`、`src/lib/storage.ts`（复用 `getSignedObjectUrl`/`isOSSConfigured`）、`src/lib/reference-builder.ts`
    - 函数：`buildGroupGenReference`
    - 已配 OSS 时用 `getSignedObjectUrl(audioKey)` 生成短时效签名 URL 作 `groupAudioUrl`（Bucket 私有读也可被 Seedance 抓取，且以 `https` 开头通过 `isPublicUrl`）
    - 某组有 `audioKey` 但无法获得 Seedance 可抓取 URL（未配 OSS）时，返回结构化标志/日志，非 `undefined` 静默置空；调用方据此可见提示（遵守用户铁律：禁止静默处理）
    - 保留 `seedance.ts` 的 `generate_audio` 以维持生成阶段唇形/音画；成片各组音频差异由合并阶段优先级 ① 的真实原声决定
    - 同步更新 `group-gen-context.ts`、`reference-builder.ts` 关于音频参考门控的注释
    - _Bug_Condition: isBugCondition_3(group) —— 未配 OSS 时 referenceAudioUrl 退化 undefined_
    - _Expected_Behavior: Property 3 —— 真实提供组音频参考；确无可用音频时非静默暴露_
    - _Requirements: 2.10, 2.11_

  - [x] 7.3 验证缺陷三探索性测试现在通过
    - **Property 3: Expected Behavior** - 各组真实使用各自原声（Bug 3）
    - **IMPORTANT**: 重跑任务 3 的同一测试 —— 不要写新测试
    - 运行任务 3 的组音频探索性测试
    - **EXPECTED OUTCOME**: 测试 PASS（确认各组选中各自 `source='file'` 原声、未配 OSS 时不静默置空）
    - _Requirements: 2.9, 2.10, 2.11_

  - [x] 7.4 验证保持测试仍然通过
    - **Property 4: Preservation** - 非缺陷输入行为完全不变
    - **IMPORTANT**: 重跑任务 4 的同一组测试 —— 不要写新测试
    - 运行任务 4 的保持属性测试
    - **EXPECTED OUTCOME**: 测试 PASS（确认已配 OSS 的 https 链路、无 audioKey 走 embedded/silence、音画对齐无回归）
    - _Requirements: 3.4, 3.5, 3.6_

- [x] 8. Checkpoint - 确保所有测试通过
  - 运行完整测试套件（`npm run test`），确保三个探索测试（Property 1/2/3）全部通过（缺陷已修复）、保持测试（Property 4）通过（无回归）
  - 运行 `npm run build` 确认编译通过、`npm run lint` 无新增告警
  - 端到端验证：解析 → 建 Job（`promptSnapshot` 含全组台词）→ 生成（写 `genCoverUrl`）→ 合并（各组原声、展示封面对应生成内容）
  - 确认所有改动代码的注释已同步更新、无过时注释（遵守 code-quality 规则）
  - 如有疑问，向用户确认

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2", "3", "4"], "dependsOn": [] },
    { "wave": 2, "tasks": ["5.1", "5.2", "6.1", "6.2", "7.1", "7.2"], "dependsOn": ["1", "2", "3", "4"] },
    { "wave": 3, "tasks": ["5.3", "5.4", "6.3", "6.4", "7.3", "7.4"], "dependsOn": ["5.1", "5.2", "6.1", "6.2", "7.1", "7.2"] },
    { "wave": 4, "tasks": ["8"], "dependsOn": ["5.3", "5.4", "6.3", "6.4", "7.3", "7.4"] }
  ]
}
```

- 任务 1、2、3（探索测试）与 4（保持测试）必须先于任何实现完成，并分别在未修复代码上记录 FAIL / PASS。
- 三个缺陷的实现（5、6、7）彼此独立，可并行；各自的验证子任务依赖对应实现落地。
- 任务 8 依赖所有验证子任务通过。

## Notes

- **Property 格式**：探索测试 1/2/3、保持测试 4 及验证子任务（5.3/5.4、6.3/6.4、7.3/7.4）均使用 `**Property N: Type**` 格式以启用悬停状态追踪。
- **三条缺陷条件**：本 spec 含三条独立缺陷条件（`isBugCondition_1_4`、`isBugCondition_2`、`isBugCondition_3`），分别由 Property 1/2/3 编码；Property 4 为共用保持性属性。
- **测试先行**：探索测试（Property 1/2/3）必须在修复前编写并在未修复代码上 FAIL（证明 bug）；保持测试（Property 4）须在未修复代码上 PASS（确立基线）。
- **不要在探索测试失败时去修测试**：失败是预期的正确结果，修复实现后该测试自然转为 PASS。
- **观察优先（保持测试）**：先在未修复代码上观察非缺陷输入真实输出并固化，再写 PBT 断言修复后逐字/逐项一致。
- **无静默处理 / 无假数据**：依据用户铁律，合并取舍、封面抽帧失败、无可用组音频等情况一律非静默暴露，不写伪造 URL、不静默退化。
- **同步更新注释**：依据仓库 code-quality 规则，修改逻辑时一并更新对应函数/文件头/行内注释，删除过时/废弃描述。
- **不污染 `Shot.coverUrl`**：封面修复使用新字段 `ShotGroup.genCoverUrl`，保留 `Shot.coverUrl` 的「无脸帧作场景参考」既有用途（Req 3.3）。
