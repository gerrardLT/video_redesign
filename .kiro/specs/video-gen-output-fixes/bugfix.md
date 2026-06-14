# Bugfix Requirements Document

## Introduction

本 spec 独立修复「视频生成产物」链路上的 4 个用户报告缺陷，与既有 `video-pipeline-fixes`（计费/状态/安全 13 项）无重叠，单独立项、单独验证。

4 个缺陷已逐条读代码核实根因：

- **Bug 1（分镜部分丢失）+ Bug 4（prompt 在生成时丢失）**：同一根因。`src/lib/script-merger.ts` 的 `MAX_SCRIPT_LENGTH = 250` 把整条 prompt（风格行 + 时间轴 + 负面约束行）硬限在 ≤250 中文字，实际留给时间轴的预算只剩约 180~200 字（`budgetForTimeline = 250 − styleLineLength − negativeLength`）。`mergeTimelineScript` 的贪心循环逐行累加分镜行，一旦超 `budgetForTimeline` 即 `break`，剩余整段分镜（连同其内嵌 `{台词}` prompt）被静默丢弃，仅 `console.warn`，不报错、不回传前端。`grouping-service.ts` 每组最多 3 个分镜（`MAX_SHOTS_PER_GROUP = 3`），3 个压缩行 + 对白极易超 ~180 字预算，导致第 3（有时第 2）个 shot 连分镜带 prompt 一起被丢。次要丢失点：`deduplicateAgainstStyle()` 正则按「角色名：」去重可能成段删除 prompt 内容；首段还可能被 `line.slice(0, budgetForTimeline)` 段内截断。丢失发生在「建 Job 合并」那一刻（`shot.prompt → mergeTimelineScript → merged.text → seedancePrompt → GenerationJob.promptSnapshot`），下游 `seedance.ts` 本身不丢 prompt。

- **Bug 2（每个视频封面都不对，用的是原视频封面帧）**：整条链路缺少「下载生成视频后用 ffmpeg 抽生成视频自己的帧作封面」这一步。`parse-video.ts` 的 `extractShotThumbnails()` 从**原始视频**抽帧写入 `shot.coverUrl`；`generate-video.ts` 的 `atomicSuccessUpdate` 生成成功后只写 `genVideoUrl` / `resultVideoUrl`，从不重抽封面；`merge-video.ts` 合并后只置 `EXPORTED`、建 Asset，也不更新 `coverUrl`。前端 `ShotGroupList.tsx` 用 `poster={group.shots[0]?.coverUrl}`，于是封面永远是原视频帧。

- **Bug 3（音频一模一样）**：两层机制叠加。(1) `seedance.ts` 的 `generate_audio: true` 恒开，每个生成片段自带 Seedance TTS 音轨；`merge-video.ts` 的 `resolveSegmentAudioPlans` 音轨优先级 1 是 `'embedded'`（自带 TTS），恒命中，导致每组各异的 `audioKey` 原声（优先级 2）几乎永远用不上。(2) `storage.ts` 未配 OSS 时 `getPublicUrl` 返回 `/uploads/{key}`（非 https），而 `reference-builder.ts` 的 `isPublicUrl` 要求 `https://` 开头，于是所有组的 `referenceAudioUrl` 全部退化为 `undefined`，每组在「无音频参考」下生成，Seedance TTS 产出趋同。叠加 Bug 1 把对白也截断后音频更雷同。注意：`parse-video.ts` 的 `extractGroupAudio()` 确实按组切片、对象键 `group_{groupIndex}.mp3`、每组不同 `audioKey`，代码层不是「硬编码共用同一音频」，问题在门控置空 + 合并优先用 TTS 的退化。

修复必须遵守用户铁律：业务用真实接口、真实流程，禁止 fallback / 静默处理 / 假数据；改代码必须同步更新对应注释，不留过时注释。

## Bug Analysis

### Current Behavior (Defect)

当前缺陷行为如下：

1.1 WHEN 一个分镜组含 3 个分镜、压缩后的时间轴脚本（风格行 + 各分镜行 + 内嵌 `{台词}` + 负面约束行）总长超过 `MAX_SCRIPT_LENGTH`（250 字）扣除风格行与负面约束行后的可用预算（约 180~200 字）THEN 系统在 `mergeTimelineScript` 贪心循环中 `break`，把超预算的整段分镜及其内嵌 prompt/台词静默丢弃，仅 `console.warn`，`merged.text` 与最终写入 `GenerationJob.promptSnapshot` 的脚本只包含前若干段

1.2 WHEN 某个 shot 在数据库中存有有效 prompt，但其所在分镜行在合并时落入被丢弃的尾段 THEN 系统在「建 Job 合并」时丢掉该 shot 的 prompt（连同分镜），下游 Seedance 生成时该 shot 的 prompt 完全缺失，且不报错、不回传前端

1.3 WHEN 单个分镜的压缩正文本身就超过 `budgetForTimeline` THEN 系统对强制保留的首段执行 `line.slice(0, budgetForTimeline)` 段内截断，截去该 shot prompt/台词的尾部描述

1.4 WHEN `stylePrefix` 含「角色名：外貌」模式且 `deduplicateAgainstStyle()` 的正则与 prompt 正文意外匹配 THEN 系统成段删除 prompt 内容，造成 prompt 信息丢失

1.5 WHEN 分镜或 prompt 因 1.1~1.4 被丢弃/截断 THEN 系统不向调用方或前端返回任何错误或可见提示，用户无法感知「分镜组里分镜只用了一部分」「shot 有 prompt 但生成时丢了」

1.6 WHEN 一个分镜组的某次生成成功 THEN 系统在 `atomicSuccessUpdate` 中只写 `ShotGroup.genVideoUrl` / `Shot.genVideoUrl` / `GenerationJob.resultVideoUrl`，从不下载生成视频重抽封面帧，`Shot.coverUrl` 仍保留解析阶段从原始视频抽取的帧

1.7 WHEN 项目完成合并导出 THEN `merge-video.ts` 只置 `project.status = EXPORTED` 并创建 Asset，不更新任何 `coverUrl`，封面仍是原视频帧

1.8 WHEN 前端 `ShotGroupList.tsx` 渲染生成视频播放器 THEN 系统使用 `poster={group.shots[0]?.coverUrl}`，即原视频第一帧，导致每个生成视频的封面与其真实内容不符

1.9 WHEN 任一分镜组提交 Seedance 生成 THEN `seedance.ts` 恒置 `generate_audio: true`，每个生成片段都自带 Seedance TTS 音轨

1.10 WHEN `merge-video.ts` 的 `resolveSegmentAudioPlans` 为各段决策音源 THEN 优先级 1 `'embedded'`（自带 TTS）恒命中，每组各异的 `audioKey` 原声（优先级 2）几乎永远不被采用

1.11 WHEN 运行环境未配置 OSS、`storage.ts` 的 `getPublicUrl` 对组音频返回 `/uploads/{key}`（非 https）THEN `reference-builder.ts` 的 `isPublicUrl` 判定不通过，所有组的 `referenceAudioUrl` 退化为 `undefined`，每组在「无音频参考」下生成，Seedance TTS 产出趋同，导致各组音频听起来一模一样

### Expected Behavior (Correct)

修复后应有的正确行为如下：

2.1 WHEN 一个分镜组含 3 个分镜、合并脚本超过原 250 字预算 THEN 系统 SHALL 保留该组全部分镜及其 prompt/台词，不再因预算硬限静默丢弃整段分镜（通过提高/重新设计字数预算或改变承载方式，使全组分镜完整进入 `GenerationJob.promptSnapshot`）

2.2 WHEN 某个 shot 存有有效 prompt THEN 系统 SHALL 在建 Job 合并后，使该 shot 的 prompt 完整出现在提交给 Seedance 的脚本中，不在「建 Job 合并」环节丢失任何 shot 的 prompt

2.3 WHEN 单个分镜的压缩正文较长 THEN 系统 SHALL 保留该 shot prompt/台词的核心语义内容，不做会丢失台词或关键动作的段内硬截断（如确需控制长度，须以不丢失语义的方式压缩并可被验证）

2.4 WHEN 执行风格去重 THEN 系统 SHALL 仅移除与全局风格前缀真实重复的角色外貌描述，不得误删 prompt 正文内容

2.5 WHEN 合并过程中确实发生了任何分镜丢弃或 prompt 截断 THEN 系统 SHALL 以非静默方式上报（返回结构化标志/错误并使其可被前端或调用方感知），禁止仅 `console.warn` 后静默继续

2.6 WHEN 一个分镜组生成成功 THEN 系统 SHALL 下载生成视频并用 ffmpeg 从**生成视频自身**抽取封面帧，写入对应的 `coverUrl`（或等价的生成封面字段），使封面来自生成视频而非原始视频

2.7 WHEN 项目合并导出完成 THEN 系统 SHALL 确保用于展示的封面对应生成视频内容（合并阶段或生成阶段已正确写入生成视频封面）

2.8 WHEN 前端渲染生成视频播放器 THEN 系统 SHALL 使用来自生成视频的封面作为 `poster`，使每个生成视频的封面与其真实内容一致

2.9 WHEN 各分镜组已具备每组不同的、可用的组音频参考（`audioKey` 原声）THEN 系统 SHALL 使该组音频真实作用于该组生成/合并，使各组音频彼此不同，体现各组原声差异（修正 `generate_audio` 恒开 + 合并优先级使原声永不命中的退化）

2.10 WHEN 运行环境未配置 OSS、组音频以本地 `/uploads/{key}` 路径存在 THEN 系统 SHALL 以真实可用的方式提供组音频参考（使本地音频成为 Seedance/合并可消费的真实音源），不得因 `isPublicUrl` 仅认 https 而把真实存在的组音频静默置空为「无音频参考」

2.11 WHEN 因任何原因无法获得某组的真实音频参考 THEN 系统 SHALL 以非静默方式暴露该情况（报错或可见提示），禁止静默退化为无差别 TTS

### Unchanged Behavior (Regression Prevention)

以下既有正确行为必须保持不变：

3.1 WHEN 一个分镜组的合并脚本在新预算/新承载方式下未超限 THEN 系统 SHALL CONTINUE TO 正常输出包含全部分镜的时间轴脚本，时间码归一化、末段对齐到 `genDuration` 的逻辑保持不变

3.2 WHEN prompt 中含 `[图N]` 素材引用、运镜术语、`{台词}` 大括号包裹 THEN 系统 SHALL CONTINUE TO 正确解析素材引用、补全运镜词前缀、保留官方台词大括号格式

3.3 WHEN 一个分镜是 `hasFace=false` 的无脸场景帧 THEN 系统 SHALL CONTINUE TO 将其 `coverUrl` 作为 reference_image 场景帧参考使用（修复封面来源不得破坏「无脸帧作场景参考」的既有用途）

3.4 WHEN 生成片段自带音轨且该组无任何可用原声参考 THEN 系统 SHALL CONTINUE TO 输出可正常播放、音画对齐的视频（音轨决策调整不得引入串味、错位或丢轨）

3.5 WHEN 合并阶段执行音画对齐（apad/atrim、统一重采样 44100/stereo）与按生成时长裁切（trim-on-merge）THEN 系统 SHALL CONTINUE TO 保持逐段 A/V 一一对应、拼接后不串味不错位的既有行为

3.6 WHEN 运行环境已正确配置 OSS、组音频为 https 公网 URL THEN 系统 SHALL CONTINUE TO 正常将其作为 `referenceAudioUrl` 与合并音源使用，已正常的生产链路行为不受影响

3.7 WHEN 分镜组生成成功后写入积分扣费、状态机（`SUCCEEDED`/`genStatus`）、尾帧持久化与链式续接 THEN 系统 SHALL CONTINUE TO 保持原子化事务、幂等扣费、链式触发等既有行为不变（封面抽帧新增步骤不得破坏 `atomicSuccessUpdate` 的原子性与幂等性）

## 缺陷条件与属性（Bug Condition Methodology）

> 说明：**F** = 修复前函数；**F'** = 修复后函数。Bug 1 与 Bug 4 同源，合并为一个缺陷条件。

### Bug 1 + Bug 4：分镜/prompt 在合并时丢失

```pascal
FUNCTION isBugCondition_1_4(group)
  INPUT: group of type ShotGroup (含 shots[]、各 shot.prompt、dialogue、stylePrefix)
  OUTPUT: boolean

  // 合并脚本在原 250 字预算下会丢弃整段分镜或对首段段内截断
  merged ← mergeTimelineScript(group.shots, options)   // F
  RETURN merged.droppedSegmentCount > 0
      OR (任一 shot.prompt 非空 但其语义内容未完整出现在 merged.text)
END FUNCTION
```

```pascal
// Property: Fix Checking —— 无 prompt/分镜丢失
FOR ALL group WHERE isBugCondition_1_4(group) DO
  merged ← mergeTimelineScript'(group.shots, options)   // F'
  ASSERT merged.droppedSegmentCount = 0
  ASSERT FOR EACH shot IN group.shots WHERE shot.prompt 非空:
            shot 的核心 prompt/台词语义 出现在 merged.text
  ASSERT 若仍存在不可避免的内容取舍 THEN merged 以非静默标志暴露（不得仅 console.warn）
END FOR
```

### Bug 2：封面用了原视频帧而非生成视频帧

```pascal
FUNCTION isBugCondition_2(group)
  INPUT: group of type ShotGroup (genStatus=SUCCEEDED, 有 genVideoUrl)
  OUTPUT: boolean

  // 展示用封面来源于原始视频抽帧，而非生成视频
  RETURN group.genStatus = 'SUCCEEDED'
     AND coverShownInUI(group) 来源于 原始视频抽帧 (extractShotThumbnails)
END FUNCTION
```

```pascal
// Property: Fix Checking —— 封面来自生成视频
FOR ALL group WHERE isBugCondition_2(group) DO
  执行生成成功后处理 F'(group)
  ASSERT 展示用封面 来源于 group.genVideoUrl 的抽帧（ffmpeg 从生成视频抽取）
END FOR
```

### Bug 3：各组音频趋同

```pascal
FUNCTION isBugCondition_3(group)
  INPUT: group of type ShotGroup (有按组切片的 audioKey)
  OUTPUT: boolean

  // 该组有专属原声，但生成/合并实际未用上（被恒开 TTS 或音频参考置空覆盖）
  RETURN group.audioKey 非空
     AND (referenceAudioUrl(group) = undefined           // 门控置空（含本地 /uploads 退化）
          OR mergeAudioSource(group) = 'embedded' 恒命中) // 合并优先级使原声永不采用
END FUNCTION
```

```pascal
// Property: Fix Checking —— 各组真实使用各自原声
FOR ALL group WHERE isBugCondition_3(group) DO
  执行生成/合并 F'(group)
  ASSERT group 的真实组音频（audioKey 原声）被实际作用于该组产物
  ASSERT 两个 audioKey 不同的组 → 产物音频可区分（非无差别 TTS）
  ASSERT 若某组确无可用音频 THEN 以非静默方式暴露（不得静默退化）
END FOR
```

### Preservation（全部 4 个缺陷共用）

```pascal
// Property: Preservation Checking
FOR ALL X WHERE NOT (isBugCondition_1_4(X) OR isBugCondition_2(X) OR isBugCondition_3(X)) DO
  ASSERT F(X) = F'(X)
END FOR
```

即：未触发上述缺陷条件的输入（脚本未超预算、封面链路本就正确、组音频已正常作用、已配置 OSS 的生产链路等），修复后行为与修复前完全一致。
