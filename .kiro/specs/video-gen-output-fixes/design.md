# Video Gen Output Fixes Bugfix Design

## Overview

本设计针对「视频生成产物」链路上 4 个用户报告缺陷给出最小、定向、可验证的修复方案，遵循缺陷条件方法学（Bug Condition Methodology）：先以缺陷条件 `C(X)` 圈定有问题的输入，定义期望属性 `P(result)`，再保证非缺陷输入 `¬C(X)` 的行为与修复前完全一致（`F(X) = F'(X)`）。

4 个缺陷归并为 3 个同质缺陷条件（Bug 1 与 Bug 4 同根因合并）：

- **缺陷一（Bug 1+4）— 合并时分镜/prompt 丢失**：`src/lib/script-merger.ts` 的 `MAX_SCRIPT_LENGTH=250` 硬预算导致 `mergeTimelineScript` 贪心循环 `break` 静默丢弃尾段整段分镜（含内嵌 `{台词}`），首段还可能被 `line.slice(0, budgetForTimeline)` 段内截断，`deduplicateAgainstStyle()` 正则可能误删 prompt 正文。丢失仅 `console.warn`，不上报前端。修复方向：重新设计承载方式，保证全组分镜 prompt/台词完整进入 `GenerationJob.promptSnapshot`；确有不可避免取舍时以结构化标志非静默上报。
- **缺陷二（Bug 2）— 封面用了原视频帧**：链路缺「下载生成视频后抽生成视频自身帧作封面」一步。`extractShotThumbnails()` 从原始视频抽帧写 `Shot.coverUrl`，生成成功（`atomicSuccessUpdate`）与合并（`merge-video.ts`）均不重抽封面，前端 `ShotGroupList.tsx` 用 `group.shots[0]?.coverUrl` 作 `poster`，封面恒为原视频帧。修复方向：生成成功后从生成视频抽帧写入**新字段** `ShotGroup.genCoverUrl`，前端 `poster` 改用该字段；不复用/覆写 `Shot.coverUrl`，保留其「无脸帧作场景参考」既有用途。
- **缺陷三（Bug 3）— 各组音频趋同**：两层叠加。(1) `merge-video.ts` 的 `resolveSegmentAudioPlans` 音轨优先级 1 恒命中 `'embedded'`（Seedance TTS），各组 `audioKey` 原声（优先级 2）几乎永不采用；(2) 未配 OSS 时 `getPublicUrl` 返回 `/uploads/{key}`（非 https），`reference-builder.ts` 的 `isPublicUrl` 拒绝，`referenceAudioUrl` 退化 `undefined`，每组在「无音频参考」下生成趋同。修复方向：合并音轨优先级改为「组 `audioKey` 原声 > 自带 TTS > 原视频整段提取 > 静音」，使各组真实原声作用于成片；生成阶段对 Seedance 以受信可抓取 URL（签名 URL）提供组音频；确无可用音频时非静默暴露。

修复严格遵守用户铁律：业务走真实接口与真实流程，禁止 fallback / 静默处理 / 假数据（可有备选方案，但不得静默降级）；改动代码同步更新函数/文件头/行内注释，删除过时注释。

## Glossary

- **Bug_Condition (C)**：触发缺陷的输入条件。本设计含三条：`isBugCondition_1_4`（合并丢失）、`isBugCondition_2`（封面来源错误）、`isBugCondition_3`（组音频趋同）。
- **Property (P)**：缺陷输入下修复后应满足的正确行为。
- **Preservation（保持不变）**：非缺陷输入下，修复后行为与修复前完全一致（`F(X) = F'(X)`）。
- **F / F'**：修复前 / 修复后的函数。
- **mergeTimelineScript**：`src/lib/script-merger.ts` 中将组内多个 Shot 的 prompt 合并为 Seedance 时间轴脚本的函数，输出 `TimelineScriptResult`。
- **MAX_SCRIPT_LENGTH**：`script-merger.ts` 中合并脚本字数硬上限常量（当前 250），缺陷一根因。
- **promptSnapshot**：`GenerationJob.promptSnapshot`，建 Job 时由合并脚本 baked 的最终提交文本。
- **extractShotThumbnails**：`src/workers/parse-video.ts` 中从**原始视频**抽帧写 `Shot.coverUrl` 的函数。
- **atomicSuccessUpdate**：`src/workers/generate-video.ts` 中生成成功后的原子化事务（写 `genVideoUrl`、扣费、尾帧持久化），缺陷二封面抽帧须挂载于此而不破坏其原子性/幂等性。
- **Shot.coverUrl**：解析阶段从原视频抽取的帧。双用途：编辑器缩略图 + `hasFace=false` 分镜作 Seedance `reference_image` 场景参考（不可被封面修复污染）。
- **ShotGroup.genCoverUrl（新增）**：生成视频自身抽取的封面帧 URL，供前端 `poster` 展示。
- **resolveSegmentAudioPlans**：`src/workers/merge-video.ts` 中逐段决策音轨来源（`embedded` / `file` / `silence`）的函数，缺陷三根因之一。
- **isPublicUrl**：`src/lib/reference-builder.ts` 中判定 URL 是否为可用公网地址（要求 `https://` 开头且不含 localhost）的函数，缺陷三根因之一。
- **getPublicUrl / getSignedObjectUrl**：`src/lib/storage.ts` 中拼接 OSS 直链 / 生成短时效签名 URL 的函数。
- **audioKey**：`ShotGroup.audioKey`，解析阶段按组切片上传的组音频对象键 `audio/{projectId}/group_{groupIndex}.mp3`，每组不同。

## Bug Details

### Bug Condition

本设计含三条独立缺陷条件，分别对应缺陷一/二/三。Bug 1 与 Bug 4 同根因（建 Job 合并时丢失），合并为 `isBugCondition_1_4`。

**缺陷一（Bug 1+4）：合并时分镜/prompt 丢失**

缺陷在「组内合并脚本（风格行 + 各分镜行 + 内嵌 `{台词}` + 负面约束行）总长超过 250 字扣除风格行与负面约束行后的可用预算」时触发：`mergeTimelineScript` 贪心循环对超预算尾段 `break` 整段丢弃，或对首段 `slice` 段内截断，或 `deduplicateAgainstStyle()` 误删 prompt 正文。

```
FUNCTION isBugCondition_1_4(group)
  INPUT: group of type ShotGroup（含 shots[]、各 shot.prompt、dialogue、stylePrefix）
  OUTPUT: boolean

  merged ← mergeTimelineScript(group.shots, options)   // F（修复前）
  RETURN merged.droppedSegmentCount > 0
      OR (任一 shot.prompt 非空 但其核心语义/台词未完整出现在 merged.text)
END FUNCTION
```

**缺陷二（Bug 2）：封面用了原视频帧而非生成视频帧**

```
FUNCTION isBugCondition_2(group)
  INPUT: group of type ShotGroup（genStatus=SUCCEEDED, 有 genVideoUrl）
  OUTPUT: boolean

  RETURN group.genStatus = 'SUCCEEDED'
     AND group.genVideoUrl 非空
     AND 前端 poster 来源 = group.shots[0].coverUrl（原始视频抽帧）
     AND 不存在任何来自 group.genVideoUrl 的封面字段
END FUNCTION
```

**缺陷三（Bug 3）：各组音频趋同**

```
FUNCTION isBugCondition_3(group)
  INPUT: group of type ShotGroup（有按组切片的 audioKey）
  OUTPUT: boolean

  RETURN group.audioKey 非空
     AND ( referenceAudioUrl(group) = undefined            // 门控置空（含本地 /uploads 退化）
           OR resolveSegmentAudioPlans 对该段 source = 'embedded' 恒命中 ) // 合并优先级使原声永不采用
END FUNCTION
```

### Examples

**缺陷一：**
- 一组 3 个分镜，每个 prompt 含运镜 + 动作 + 较长 `{台词}`，合并后约 220 字 > `budgetForTimeline`（约 180~200 字）→ 第 3 段（有时第 2 段）连分镜带台词被 `break` 丢弃，`promptSnapshot` 仅含前 2 段。期望：3 段及台词完整保留。
- 单个分镜压缩正文本身就超预算 → 首段被 `line.slice` 截去尾部台词。期望：保留台词核心语义，不做丢台词的硬截断。
- `stylePrefix` 含「小明：短发白T」且 `deduplicateAgainstStyle` 正则匹配到 prompt 正文里的「小明：抬头说…」→ 成段删除正文。期望：仅删与风格前缀真实重复的外貌描述。
- 任何丢弃/截断发生时：当前仅 `console.warn`，前端无感知。期望：返回结构化标志并被前端/调用方感知。

**缺陷二：**
- 第 2 组生成成功，生成视频内容是夜景，但 `poster` 显示原视频白天帧（`shots[0].coverUrl`）。期望：`poster` 显示从生成视频抽取的夜景帧。
- `hasFace=false` 的场景分镜：其 `coverUrl` 仍需作 `reference_image` 场景参考（重新生成时）。期望：封面修复不得改写该 `coverUrl`。

**缺陷三：**
- 第 1、2、3 组各有不同 `audioKey` 原声，但成片三组音频听起来一样（都是 Seedance 通用 TTS）。期望：三组成片音频可区分、体现各组原声差异。
- 开发环境未配 OSS，`audioKey` 对应 `/uploads/audio/{projectId}/group_0.mp3` → `referenceAudioUrl` 退化 `undefined`。期望：以真实可用方式提供组音频（合并阶段读本地真实音频文件），不静默置空。
- 某组确无任何可用音频。期望：非静默暴露（报错/可见提示），不静默退化为无差别 TTS。

## Expected Behavior

### Preservation Requirements

**必须保持不变的既有行为（对应需求 3.1~3.7）：**

- **3.1** 合并脚本未超限时，时间轴脚本含全部分镜、时间码归一化、末段对齐到 `genDuration` 的逻辑不变。
- **3.2** prompt 中 `[图N]` 素材引用解析、运镜词前缀补全、`{台词}` 大括号格式保留不变。
- **3.3** `hasFace=false` 无脸场景帧的 `coverUrl` 继续作 `reference_image` 场景参考使用（封面修复不得破坏此用途）。
- **3.4** 生成片段自带音轨且该组无任何可用原声参考时，继续输出可正常播放、音画对齐的视频（不串味、不错位、不丢轨）。
- **3.5** 合并阶段音画对齐（apad/atrim、统一重采样 44100/stereo）与 trim-on-merge 逐段 A/V 一一对应行为不变。
- **3.6** 已配 OSS、组音频为 https 公网 URL 时，继续正常作为 `referenceAudioUrl` 与合并音源使用，生产链路不受影响。
- **3.7** 生成成功后的扣费、状态机（`SUCCEEDED`/`genStatus`）、尾帧持久化、链式续接的原子化/幂等行为不变（封面抽帧新增步骤不得破坏 `atomicSuccessUpdate` 原子性与幂等性）。

**范围（不受本次修复影响的输入）：**

- 合并脚本本就不超预算的组；
- 封面链路本就正确的场景（如不存在）；
- 已配 OSS、组音频已正常作用的生产链路；
- 无 `audioKey` 或确无原声、本就走自带 TTS / 静音兜底的段。

> 注：缺陷输入下「期望的正确行为」由下文 Correctness Properties 的 Property 1/2/3 定义；本节聚焦「必须不变」的部分。

## Hypothesized Root Cause

**缺陷一（Bug 1+4）：**
1. **字数硬预算 + 贪心丢段**：`MAX_SCRIPT_LENGTH=250` 减去风格行/负面约束行后预算仅约 180~200 字，`mergeTimelineScript` 循环对超预算段 `break`，整段（含台词）被丢弃，仅 `console.warn`。
2. **首段段内截断**：单段过长时 `line.slice(0, budgetForTimeline)` 截去尾部台词/动作。
3. **去重正则误伤**：`deduplicateAgainstStyle()` 的 `角色名：…` 正则可能匹配并删除 prompt 正文，而非仅删与风格前缀真实重复的外貌描述。
4. **丢失不可见**：丢弃/截断仅日志告警，`TimelineScriptResult` 虽有 `truncated`/`droppedSegmentCount`，但两条 `generate` 路由未读取、未回传前端。

**缺陷二（Bug 2）：**
1. **缺少生成视频抽帧步骤**：`atomicSuccessUpdate` 只写 `genVideoUrl`，从不抽生成视频封面。
2. **前端读错字段**：`ShotGroupList.tsx` 用 `group.shots[0]?.coverUrl`（原视频帧）作 `poster`。
3. **合并阶段不更新封面**：`merge-video.ts` 只置 `EXPORTED`、建 Asset，不更新任何封面字段。

**缺陷三（Bug 3）：**
1. **合并优先级错配**：`resolveSegmentAudioPlans` 优先级 1 `'embedded'` 恒命中，组 `audioKey` 原声（优先级 2）几乎永不采用。
2. **本地音频门控置空**：未配 OSS 时 `getPublicUrl` 返回非 https 的 `/uploads/{key}`，`isPublicUrl` 拒绝 → `referenceAudioUrl` 退化 `undefined`。
3. **私有读场景无签名 URL**：即便配了 OSS，若 Bucket 私有读，明文直链不可被 Seedance 抓取，组音频参考仍可能失效。

## Correctness Properties

Property 1: Bug Condition - 合并时不丢分镜/prompt（Bug 1+4）

_For any_ 满足 `isBugCondition_1_4` 的分镜组（合并脚本在原 250 字预算下会丢段或对首段段内截断），修复后的 `mergeTimelineScript'` SHALL 保留该组全部分镜及其 prompt/台词核心语义于 `merged.text`（`droppedSegmentCount = 0`、无台词硬截断、风格去重不误删正文），使其完整进入 `GenerationJob.promptSnapshot`；若确有不可避免的内容取舍，SHALL 通过结构化标志（`truncated`/`droppedSegmentCount` 及取舍说明）非静默暴露，并由调用方回传前端，禁止仅 `console.warn` 后静默继续。

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

Property 2: Bug Condition - 封面来自生成视频（Bug 2）

_For any_ 满足 `isBugCondition_2` 的分镜组（`genStatus=SUCCEEDED` 且有 `genVideoUrl`），修复后的生成成功处理 SHALL 从 `group.genVideoUrl` 自身抽取封面帧写入 `ShotGroup.genCoverUrl`，且前端 `poster` SHALL 使用该字段，使每个生成视频封面与其真实内容一致；合并导出完成后用于展示的封面 SHALL 对应生成视频内容。

**Validates: Requirements 2.6, 2.7, 2.8**

Property 3: Bug Condition - 各组真实使用各自原声（Bug 3）

_For any_ 满足 `isBugCondition_3` 的分镜组（有专属 `audioKey` 但生成/合并未真实用上），修复后的生成/合并 SHALL 使该组真实组音频（`audioKey` 原声）实际作用于该组产物，使两个 `audioKey` 不同的组成片音频可区分（非无差别 TTS）；当某组确无可用音频时 SHALL 以非静默方式暴露（报错/可见提示），禁止静默退化为无差别 TTS。

**Validates: Requirements 2.9, 2.10, 2.11**

Property 4: Preservation - 非缺陷输入行为完全不变

_For any_ 不满足任一缺陷条件的输入（`NOT (isBugCondition_1_4(X) OR isBugCondition_2(X) OR isBugCondition_3(X))`：脚本未超预算、封面链路本就正确、组音频已正常作用、已配 OSS 的生产链路等），修复后的函数 SHALL 产生与修复前完全相同的结果（`F(X) = F'(X)`），保持时间码归一化、`[图N]`/运镜/`{台词}` 解析、无脸帧作场景参考、合并音画对齐与 trim-on-merge、扣费/状态机/尾帧/链式续接的原子化与幂等等既有行为不变。

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

## Fix Implementation

> 假设上述根因分析成立（探索性测试将先在未修复代码上确认/证伪）。

### 缺陷一（Bug 1+4）：合并不丢分镜/prompt

**文件**：`src/lib/script-merger.ts`、`src/app/api/shot-groups/[id]/generate/route.ts`、`src/app/api/projects/[id]/generate/route.ts`、前端 `src/components/shot/ShotGroupList.tsx`

**函数**：`mergeTimelineScript`、`deduplicateAgainstStyle`、两条 `generate` 路由、`ShotGroupList`

**具体改动**：
1. **重新设计字数承载，保证全组分镜不丢**：取消「超预算即 `break` 丢整段」与「首段 `line.slice` 截台词」两处有损路径。改为按分镜组实际段数计算自适应预算（组 ≤3 段，`MAX_SHOTS_PER_GROUP=3`），保证每段「`镜头N：`前缀 + 运镜 + 核心动作 + `{台词}`」完整保留。`MAX_SCRIPT_LENGTH` 由「硬截断阈值」降级为「软目标」并同步更新其注释语义。
2. **有损压缩仅作用于非关键描述**：当超软目标时，仅压缩可省略的修饰（光线/环境形容词等），绝不删除整段、绝不切断 `{台词}` 大括号内容。
3. **修正风格去重误删**：`deduplicateAgainstStyle()` 改为仅当待删片段确实与 `stylePrefix` 中某条「角色名：外貌」描述真实重复时才移除，正则锚定到角色外貌描述模式，避免匹配 prompt 正文。
4. **不可避免取舍非静默上报**：扩展 `TimelineScriptResult`，在 `truncated`/`droppedSegmentCount` 基础上新增结构化取舍说明字段（如 `lossNotice`）。两条 `generate` 路由读取该结果，在 API 响应中以结构化字段回传；前端 `ShotGroupList` 在对应组卡片展示「本组脚本发生取舍」可见提示（复用既有 `groupErrors`/提示区域），禁止仅 `console.warn`。
5. **同步注释**：更新 `MAX_SCRIPT_LENGTH`、`mergeTimelineScript`、`deduplicateAgainstStyle` 的函数/常量注释，删除「超预算贪心丢段 / 首段段内截断」的过时描述。

### 缺陷二（Bug 2）：封面取自生成视频

**文件**：Prisma schema（`ShotGroup` 增 `genCoverUrl`）、`src/workers/generate-video.ts`、`src/workers/merge-video.ts`、项目详情接口（`/api/projects/[id]`）、前端 `ShotGroupList.tsx`

**函数**：`atomicSuccessUpdate` 及其调用处、`processMergeVideo`、`ShotGroupCard`

**具体改动**：
1. **新增字段**：`ShotGroup.genCoverUrl`（生成视频封面 URL）。**不复用、不覆写 `Shot.coverUrl`**，以保留无脸帧作场景参考的既有用途（满足 3.3）。
2. **生成视频抽帧**：在 `processGroupVideoGenerate` 已下载 `tempVideoPath`（上传 OSS 之前）的环节，用 ffmpeg 从生成视频抽一帧（如第 0.1s，scale 等比），上传 OSS（对象键 `gencover/{projectId}/{shotGroupId}.jpg`），得到 `genCoverUrl`。抽帧/上传失败采用既有失败隔离风格（记录真实错误、不写伪造 URL、不阻塞主流程）。
3. **原子写入**：将 `genCoverUrl` 作为参数传入 `atomicSuccessUpdate`，在同一事务内随 `genStatus/genVideoUrl` 一并写 `ShotGroup.genCoverUrl`，保持事务原子性与幂等性（满足 3.7）。抽帧本身在事务外完成（仅写入在事务内），避免长时 I/O 占用事务。
4. **合并导出封面**：`merge-video.ts` 合并成功后，将项目展示封面（`project.coverUrl`）更新为首个成功组的 `genCoverUrl`，使导出展示封面对应生成内容（满足 2.7）。
5. **接口与前端**：`/api/projects/[id]` 的 `shotGroups` 返回 `genCoverUrl`；`ShotGroupData` 接口新增 `genCoverUrl`；`VideoPlayer` 的 `poster` 改用 `group.genCoverUrl || undefined`（满足 2.8）。
6. **同步注释**：更新 `atomicSuccessUpdate` 文件头/函数注释，新增「生成视频封面抽帧并持久化」说明；前端 `poster` 处注释说明改用生成视频封面。

### 缺陷三（Bug 3）：各组真实使用各自原声

**文件**：`src/workers/merge-video.ts`、`src/lib/group-gen-context.ts`、`src/lib/storage.ts`（复用 `getSignedObjectUrl`/`isOSSConfigured`）、`src/lib/reference-builder.ts`

**函数**：`resolveSegmentAudioPlans`、`buildGroupGenReference`

**具体改动**：
1. **合并音轨优先级重排（核心修复）**：`resolveSegmentAudioPlans` 将优先级改为
   - 优先级 1：该组 `audioKey` 原声（`source='file'`）——真实、各组不同；
   - 优先级 2：生成片段自带 Seedance TTS 音轨（`source='embedded'`）；
   - 优先级 3：从原视频整段按 `[startTime,endTime]` 提取原声（`source='file'`）；
   - 兜底：静音补齐（`source='silence'`）。
   该重排使各组成片真实采用各自原声，两组 `audioKey` 不同 → 成片音频可区分（满足 2.9）。音画对齐（apad/atrim、重采样）逻辑完全不变（满足 3.4/3.5）。本地 `/uploads/{key}` 原声经既有 `resolveMediaUrlToLocal` 映射到 public 目录读取，开发环境也用真实音频（满足 2.10）。
2. **生成阶段以受信 URL 提供组音频**：`buildGroupGenReference` 中，已配 OSS 时用 `getSignedObjectUrl(audioKey)` 生成短时效签名 URL 作 `groupAudioUrl`（Bucket 私有读也可被 Seedance 抓取），签名 URL 以 `https` 开头可通过 `isPublicUrl`，使各组生成阶段真实带各自音频参考。
3. **非静默暴露无音频**：当某组有 `audioKey` 但无法获得 Seedance 可抓取 URL（未配 OSS）时，返回结构化标志/日志（非 `undefined` 静默置空），调用方据此可见提示；该组最终差异由合并阶段优先级 1 的真实原声保证（满足 2.11）。
4. **`generate_audio` 说明**：保留 `seedance.ts` 的 `generate_audio` 以维持生成阶段唇形/音画，但成片各组音频差异由合并阶段优先级 1 的真实组原声决定；同步更新 `resolveSegmentAudioPlans`、`SegmentAudioPlan` 注释，反映新优先级语义，删除「自带 TTS 最高优先级」过时描述。
5. **同步注释**：更新 `group-gen-context.ts`、`reference-builder.ts` 中关于音频参考门控的注释。

## Testing Strategy

### Validation Approach

两阶段：先在**未修复**代码上用探索性测试surface反例、确认根因；再验证修复满足 Fix Checking 与 Preservation Checking。

### Exploratory Bug Condition Checking

**Goal**：在实现修复前surface反例，确认/证伪根因；若证伪则重新假设。

**Test Plan**：对三条缺陷条件分别构造在未修复代码上必现/可现的失败用例。

**Test Cases**：
1. **合并丢段（缺陷一）**：构造 3 段、含较长台词、合并 > 预算的组，断言 `mergeTimelineScript` 的 `droppedSegmentCount=0` 且每段台词出现在 `text` —— 在未修复代码上失败（会丢段/截断）。
2. **首段截断（缺陷一）**：构造单段超长 prompt，断言台词核心语义保留 —— 未修复代码上首段被 `slice` 截断而失败。
3. **去重误删（缺陷一）**：构造 `stylePrefix` 角色名与 prompt 正文「角色名：…」共现，断言正文未被删 —— 未修复代码上可能失败。
4. **封面来源（缺陷二）**：模拟生成成功，断言存在来自 `genVideoUrl` 的封面字段且前端 `poster` 用之 —— 未修复代码无 `genCoverUrl`、`poster` 用原视频帧而失败。
5. **组音频趋同（缺陷三）**：构造两组不同 `audioKey`，断言 `resolveSegmentAudioPlans` 为各段选中各自组原声（`source='file'` 指向不同 audioPath）—— 未修复代码恒选 `'embedded'` 而失败。
6. **本地音频置空（缺陷三）**：未配 OSS 时断言组音频被真实提供/不静默置空 —— 未修复代码 `referenceAudioUrl=undefined` 而失败。

**Expected Counterexamples**：
- 合并：`droppedSegmentCount>0` 或台词缺失于 `text`；
- 封面：无 `genCoverUrl`、`poster=shots[0].coverUrl`；
- 音频：所有段 `source='embedded'`、`referenceAudioUrl=undefined`。

### Fix Checking

**Goal**：对所有满足缺陷条件的输入，修复后函数产生期望行为。

**Pseudocode：**
```
FOR ALL input WHERE isBugCondition_1_4(input) DO
  merged ← mergeTimelineScript'(input.shots, options)
  ASSERT merged.droppedSegmentCount = 0
  ASSERT FOR EACH shot WHERE shot.prompt 非空: shot 核心 prompt/台词语义 ∈ merged.text
  ASSERT 若有不可避免取舍 THEN merged 以结构化标志暴露（非仅 console.warn）
END FOR

FOR ALL group WHERE isBugCondition_2(group) DO
  执行生成成功处理 F'(group)
  ASSERT group.genCoverUrl 来源于 group.genVideoUrl 抽帧 AND 前端 poster 使用 group.genCoverUrl
END FOR

FOR ALL group WHERE isBugCondition_3(group) DO
  执行生成/合并 F'(group)
  ASSERT group 的 audioKey 原声被实际作用于该组产物
  ASSERT 两个 audioKey 不同的组 → 产物音频可区分
  ASSERT 若确无可用音频 THEN 非静默暴露
END FOR
```

### Preservation Checking

**Goal**：对所有不满足缺陷条件的输入，修复后函数结果与修复前一致。

**Pseudocode：**
```
FOR ALL input WHERE NOT (isBugCondition_1_4(input) OR isBugCondition_2(input) OR isBugCondition_3(input)) DO
  ASSERT F(input) = F'(input)
END FOR
```

**Testing Approach**：推荐属性化测试（PBT）做 Preservation：
- 自动生成大量跨域输入，覆盖手写用例易漏的边界；
- 对「未超预算的组」断言 `mergeTimelineScript` 输出与修复前逐字一致；
- 对「已配 OSS、组音频 https 正常」与「无 audioKey 走 embedded/silence」断言音轨决策不变。

**Test Plan**：先在**未修复**代码上观测非缺陷输入（未超预算合并、无脸帧场景参考、已配 OSS 音频链路、自带 TTS 兜底）的行为并固化，再写 PBT 断言修复后一致。

**Test Cases**：
1. **合并未超预算保持不变**：观测未超预算组的 `text`/`segments`/`droppedSegmentCount`，断言修复后逐字一致。
2. **无脸帧场景参考保持不变**：断言 `Shot.coverUrl` 未被封面修复改写，仍作 `reference_image`。
3. **已配 OSS 音频链路保持不变**：断言 https 组音频仍作 `referenceAudioUrl` 与合并音源。
4. **自带 TTS / 静音兜底保持不变**：无 `audioKey` 且无原声的段，断言仍走 embedded / silence、音画对齐不变。

### Unit Tests

- `mergeTimelineScript`：3 段含台词不丢段、首段不截台词、去重不误删正文、不可避免取舍置结构化标志。
- 生成成功：`genCoverUrl` 写入且来自生成视频；`Shot.coverUrl` 未被改写；事务原子性/幂等不变。
- `resolveSegmentAudioPlans`：组 `audioKey` 原声优先于 embedded；无 audioKey 下探 embedded → 原视频提取 → silence。
- `buildGroupGenReference`：已配 OSS 用签名 URL；未配 OSS 非静默标志。

### Property-Based Tests

- 随机分镜组（段数/prompt 长度/台词）→ 断言 `droppedSegmentCount=0` 且台词语义保留（Fix），未超预算时输出与修复前一致（Preservation）。
- 随机组音频配置（不同 `audioKey`/有无 OSS）→ 断言各组音轨来源真实区分（Fix），既有正常链路不变（Preservation）。
- 随机封面链路状态 → 断言 `poster` 取生成封面，`Shot.coverUrl` 不变。

### Integration Tests

- 端到端：解析 → 建 Job（promptSnapshot 含全组台词）→ 生成（写 genCoverUrl）→ 合并（各组原声、展示封面对应生成内容）。
- 链式与单组两路径产出一致性（合并脚本、封面、音频）。
- 前端：组卡片 `poster` 显示生成封面、取舍/无音频可见提示正确渲染。
