# Requirements Document

## Introduction

AI 角色外观状态变化自动识别功能。在视频解析阶段，利用多模态模型（qwen-vl-max）在分析每个分镜时额外输出角色的外观描述（发型、服装、配饰、妆容），并将这些描述持久化到数据模型中。生成阶段利用外观描述增强 Seedance prompt，实现角色造型变化的自动适配。当相邻分镜组的角色外观描述不同时，自动跳过尾帧承接，避免造型不一致的画面衔接。全流程零用户操作，全自动完成。

## Glossary

- **Video_Analyzer**: 视频分析模块（src/lib/video-analyzer.ts），负责调用 qwen-vl-max 多模态模型将视频解析为结构化分镜脚本
- **Appearance_Descriptor**: 角色外观描述数据结构，包含发型、服装、配饰、妆容四个维度的文本描述
- **Shot**: 单个分镜记录，包含时间段、场景、角色等信息
- **ShotGroup**: 分镜组，由相邻分镜聚合而成，对应一次 Seedance 生成调用
- **Group_Gen_Context**: 组生成上下文装配模块（src/lib/group-gen-context.ts），负责为每组 Seedance 生成请求组装参考数据和 prompt
- **Frame_Continuity**: 尾帧承接模块（src/lib/frame-continuity.ts），负责判定相邻组是否同场景并执行尾帧软承接
- **Appearance_Comparison**: 外观比对逻辑，判定相邻分镜组中同一角色的外观描述是否存在差异
- **Seedance_Prompt**: 提交给 Seedance 2.0 的生成 prompt 文本，包含运镜、动作、角色引用等信息

## Requirements

### Requirement 1: 视频分析阶段输出角色外观描述

**User Story:** As a 平台系统, I want 在视频分析时自动提取每个分镜中角色的外观特征, so that 后续生成阶段可以感知角色造型变化并做出适配。

#### Acceptance Criteria

1. WHEN Video_Analyzer 解析视频分镜时, THE Video_Analyzer SHALL 在每个分镜的 characters 数组中为每位角色输出包含发型、服装、配饰、妆容四个维度的 Appearance_Descriptor
2. WHEN 分镜中某角色的某个外观维度无法识别（如角色背影无法辨识发型）时, THE Video_Analyzer SHALL 将该维度标记为空字符串，保留其余可识别维度的描述
3. THE Video_Analyzer SHALL 在系统提示词中明确要求多模态模型按 Appearance_Descriptor 结构输出角色外观信息
4. WHEN 多模态模型返回的外观描述不符合 Appearance_Descriptor 结构时, THE Video_Analyzer SHALL 在 Zod 校验阶段检测到格式错误并触发 repair retry 流程

### Requirement 2: 外观描述数据持久化

**User Story:** As a 平台系统, I want 将角色外观描述持久化存储到分镜数据中, so that 后续生成和承接判定阶段可以读取使用。

#### Acceptance Criteria

1. THE Shot SHALL 包含一个存储角色外观描述的 JSON 字段（characterAppearances），记录该分镜中每位角色的 Appearance_Descriptor
2. WHEN Video_Analyzer 完成分镜解析后, THE 解析 Worker SHALL 将每个分镜的角色外观描述写入 Shot 的 characterAppearances 字段
3. THE ShotGroup SHALL 提供一个聚合外观描述的计算方式，取组内各分镜中同一角色外观描述中出现频率最高的描述作为该组的代表外观

### Requirement 3: 生成 prompt 追加外观描述

**User Story:** As a 平台系统, I want 在组装 Seedance 生成 prompt 时追加角色外观描述文案, so that 生成的视频能准确反映当前分镜组中角色的实际造型。

#### Acceptance Criteria

1. WHEN Group_Gen_Context 为某分镜组装配生成上下文时, THE Group_Gen_Context SHALL 读取该组的角色外观描述并将其拼接到 Seedance_Prompt 的角色引用部分
2. WHEN 某角色在当前组的外观描述与全局 Character.appearance 一致时, THE Group_Gen_Context SHALL 跳过外观描述追加，避免 prompt 冗余
3. WHEN 某角色在当前组的外观描述与全局 Character.appearance 存在差异时, THE Group_Gen_Context SHALL 将差异外观描述以「本镜头中{角色名}的造型：{外观描述}」格式追加到 Seedance_Prompt 中
4. THE Group_Gen_Context SHALL 将外观描述文案控制在 80 字以内，避免超出 Seedance prompt 字数限制

### Requirement 4: 基于外观变化的尾帧承接跳过

**User Story:** As a 平台系统, I want 当相邻分镜组中同一角色外观描述发生变化时自动跳过尾帧承接, so that 避免造型不一致的画面被错误衔接导致视觉冲突。

#### Acceptance Criteria

1. WHEN Frame_Continuity 执行同场景尾帧承接判定时, THE Frame_Continuity SHALL 额外执行 Appearance_Comparison 检查相邻两组中共有角色的外观描述是否一致
2. WHEN 相邻两组中任一共有角色的外观描述存在差异时, THE Frame_Continuity SHALL 跳过尾帧承接（applied=false），即使两组场景判定为同场景
3. WHEN 相邻两组中所有共有角色的外观描述均一致时, THE Frame_Continuity SHALL 按原有同场景承接逻辑继续执行
4. WHEN 相邻两组中无共有角色时, THE Frame_Continuity SHALL 按原有逻辑判定（仅基于场景一致性），外观比对不影响承接决策

### Requirement 5: 外观比对算法

**User Story:** As a 平台系统, I want 有一套明确的外观比对规则来判定两组之间角色外观是否变化, so that 承接跳过决策准确可靠。

#### Acceptance Criteria

1. THE Appearance_Comparison SHALL 逐维度（发型、服装、配饰、妆容）比对同一角色在前后两组的外观描述
2. WHEN 同一角色的任一非空维度描述在前后两组间存在文本差异时, THE Appearance_Comparison SHALL 判定该角色外观发生变化
3. WHEN 某维度在前组或后组为空字符串时, THE Appearance_Comparison SHALL 忽略该维度的比对，仅比对双方均非空的维度
4. THE Appearance_Comparison SHALL 在比对前对描述文本执行规范化处理（去除首尾空白、统一为小写、移除标点符号），减少文本噪声导致的误判

### Requirement 6: 全自动无用户干预

**User Story:** As a 平台用户, I want 角色外观变化的识别和适配全自动完成, so that 无需手动标注或干预即可获得正确的生成结果。

#### Acceptance Criteria

1. THE Video_Analyzer SHALL 在视频解析流程中自动完成外观提取，无需用户额外操作或配置
2. THE Group_Gen_Context SHALL 自动判断是否追加外观描述到 prompt，无需用户手动触发
3. THE Frame_Continuity SHALL 自动根据外观比对结果决定是否跳过承接，无需用户确认
4. IF 外观提取过程中 AI 模型返回异常或超时, THEN THE Video_Analyzer SHALL 将 characterAppearances 设为空数组并继续解析流程，不阻塞整体视频解析
