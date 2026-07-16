# Requirements Document

> **文档状态**：🔒 已封存（视频重绘后端能力保留，前端 /dashboard 已下线）
> **对应实现**：`src/lib/video/transition-engine.ts`（转场后端已落地；导出分辨率前端随 /dashboard 下线）
> **权威来源**：状态以 `AGENTS.md` + `docs/local-life-user-journey.md` 为准，冲突时以代码为准
> **最后校准**：2026-07-11

## Introduction

视频质量增强功能集：包含三个互相独立但共同提升成片质量的优化模块。

1. **超分前端适配**：后端超分能力（WaveSpeed API + Upscale Worker）已完整实现，但导出页面缺少分辨率选择 UI。本需求补全前端分辨率选择器、积分消耗预估、状态展示等交互。
2. **视频转场优化**：当前合并视频为各分镜组硬拼接，画面跳变、音频突变。本需求在 FFmpeg 合并阶段加入 crossfade/fade-to-black 视觉过渡和 audio crossfade 音频过渡。
3. **人物状态管理**：当前每个角色只有一张固定锚定图，无法表达造型变化。本需求引入 CharacterState 模型，支持一个角色拥有多个造型状态，分镜组可指定使用特定状态的锚定图。

## Glossary

- **Export_Page**: 导出页面前端组件（src/app/dashboard/project/[id]/export/page.tsx），负责展示分辨率选择、积分预估、导出状态
- **Resolution_Selector**: 分辨率选择器 UI 组件，展示 480p/720p/1080p 三档选项及对应积分消耗
- **Export_API**: 导出后端接口（POST /api/projects/[id]/export），接受 target_resolution 参数
- **Merge_Worker**: 视频合并 Worker（src/workers/merge-video.ts），负责将各分镜组视频通过 FFmpeg 合并为完整视频
- **FFmpeg_Concat**: Merge_Worker 中的 ffmpegConcat 函数，执行实际的 FFmpeg filter 链式视频合并
- **Transition_Engine**: 转场引擎，在 FFmpeg_Concat 中实现 xfade/axfade filter 的链式串联逻辑
- **ShotGroup**: 分镜组，对应一次 Seedance 生成调用的最小单位
- **normScene**: 场景名规范化函数（src/lib/frame-continuity.ts），用于判定两个分镜组是否属于同一场景
- **Character**: 人物模型，包含 name、appearance、imageUrl（锚定图）等字段
- **CharacterState**: 人物状态模型（新增），表示一个角色的特定造型变体，包含独立的锚定图
- **ShotGroupCharacter**: 分镜组与人物的关联表，记录每组出现哪些人物
- **buildGroupGenReference**: 组生成上下文装配函数（src/lib/group-gen-context.ts），负责组装 Seedance 生成所需的参考图和角色引用前缀
- **Credit_Service**: 积分服务，提供余额查询和消耗计算

## Requirements

### Requirement 1: 导出页面分辨率选择器

**User Story:** As a 用户, I want to 在导出页面选择目标分辨率, so that 我可以根据需求和预算选择合适的画质档位

#### Acceptance Criteria

1. WHEN 导出页面加载完成, THE Export_Page SHALL 展示 Resolution_Selector 组件，包含 480p、720p、1080p 三个可选档位
2. THE Resolution_Selector SHALL 在每个档位旁展示积分消耗标签：480p 显示"免费"，720p 显示按 ceil(总时长秒数 × 1) 计算的积分数，1080p 显示按 ceil(总时长秒数 × 2) 计算的积分数
3. THE Resolution_Selector SHALL 默认选中 480p 档位
4. WHEN 用户选择 720p 或 1080p 档位, THE Export_Page SHALL 向后端查询用户当前积分余额，并在 UI 中展示预估消耗积分数和剩余余额
5. IF 用户积分余额不足以支付所选档位的超分费用, THEN THE Export_Page SHALL 禁用导出按钮并展示"积分不足"提示（包含所需积分数和当前余额）
6. WHEN 用户点击导出按钮, THE Export_Page SHALL 将所选 target_resolution 参数传递给 Export_API

### Requirement 2: 超分导出状态展示

**User Story:** As a 用户, I want to 在导出过程中看到超分进度和状态, so that 我知道视频处理到哪一步了

#### Acceptance Criteria

1. WHEN 导出任务进入 UPSCALING 状态, THE Export_Page SHALL 展示"超分处理中"状态标识和动画进度指示器
2. WHEN 导出任务完成（状态为 COMPLETED）, THE Export_Page SHALL 展示最终视频预览播放器和下载按钮，并标注实际输出分辨率
3. IF 超分处理失败（状态为 FAILED）, THEN THE Export_Page SHALL 展示失败原因、已退还积分数，并提供"重试"按钮
4. THE Export_Page SHALL 通过轮询（间隔 3 秒）获取最新导出状态，覆盖 MERGING、UPSCALING、COMPLETED、FAILED 四种状态的 UI 展示

### Requirement 3: 同场景组间视觉过渡

**User Story:** As a 用户, I want to 合并后的视频在同场景分镜组之间有平滑过渡, so that 画面不会在同场景中突然跳变

#### Acceptance Criteria

1. WHEN 相邻两个 ShotGroup 属于同一场景（normScene 判定结果相等）, THE Transition_Engine SHALL 在两组视频拼接点插入 0.3 至 0.5 秒的 crossfade 视觉过渡
2. THE Transition_Engine SHALL 使用 FFmpeg xfade filter 实现 crossfade 效果，过渡时长默认为 0.4 秒
3. THE Transition_Engine SHALL 确保过渡区间内前一组视频尾部与后一组视频头部存在时间重叠（过渡时长从双方各取一半）

### Requirement 4: 跨场景组间视觉过渡

**User Story:** As a 用户, I want to 合并后的视频在不同场景之间有明确的转场效果, so that 观众能感知到场景切换

#### Acceptance Criteria

1. WHEN 相邻两个 ShotGroup 属于不同场景（normScene 判定结果不相等或 scene 字段缺失）, THE Transition_Engine SHALL 在两组视频拼接点插入 0.5 至 1.0 秒的 fade-to-black 或 dissolve 视觉过渡
2. THE Transition_Engine SHALL 使用 FFmpeg xfade filter 的 fade 类型实现 fade-to-black 效果，过渡时长默认为 0.7 秒
3. THE Transition_Engine SHALL 确保跨场景过渡时长大于同场景过渡时长

### Requirement 5: 音频过渡处理

**User Story:** As a 用户, I want to 视频合并时音频也有平滑过渡, so that 拼接点不会出现音量突变或音频断裂

#### Acceptance Criteria

1. WHEN 相邻 ShotGroup 之间存在视觉过渡（同场景或跨场景）, THE Transition_Engine SHALL 在同一过渡区间内同步应用 audio crossfade
2. THE Transition_Engine SHALL 使用 FFmpeg acrossfade filter 实现音频过渡，过渡时长与对应视觉过渡时长一致
3. THE Transition_Engine SHALL 确保音频过渡不改变非过渡区间内的原始音频内容

### Requirement 6: 转场参数约束

**User Story:** As a 系统, I want to 转场参数受到合理约束, so that 过渡效果不会导致视频内容被过度截断

#### Acceptance Criteria

1. IF 某个 ShotGroup 的生成视频时长小于过渡时长的 2 倍, THEN THE Transition_Engine SHALL 跳过该组与相邻组之间的过渡，改为硬拼接
2. THE Transition_Engine SHALL 确保合并后视频的总时长等于各组视频时长之和减去所有过渡重叠时长之和
3. WHEN 项目仅包含一个 ShotGroup, THE Transition_Engine SHALL 不应用任何转场处理，直接输出该组视频

### Requirement 7: CharacterState 数据模型

**User Story:** As a 用户, I want to 为同一个角色创建多个造型状态, so that 视频中角色换装/换发型后仍能保持一致性

#### Acceptance Criteria

1. THE CharacterState SHALL 包含 id、characterId、name（状态名称）、description（状态描述）、imageUrl（该状态的锚定图 URL）、isDefault（是否为默认状态）、createdAt 字段
2. THE Character SHALL 与 CharacterState 形成一对多关系：一个 Character 可拥有多个 CharacterState 记录
3. WHEN 创建新的 CharacterState 且该角色尚无任何状态记录, THE 系统 SHALL 将该状态的 isDefault 标记为 true
4. THE 系统 SHALL 确保每个 Character 最多有一个 isDefault 为 true 的 CharacterState

### Requirement 8: 分镜组关联角色状态

**User Story:** As a 用户, I want to 为每个分镜组指定角色使用的具体造型状态, so that 不同分镜组中角色可以呈现不同外观

#### Acceptance Criteria

1. THE ShotGroupCharacter 关联表 SHALL 新增 characterStateId 可空字段，指向该组中该角色使用的 CharacterState
2. WHEN ShotGroupCharacter 的 characterStateId 为空, THE buildGroupGenReference SHALL 使用 Character.imageUrl 作为该角色的锚定图（向后兼容）
3. WHEN ShotGroupCharacter 的 characterStateId 指向一个有效的 CharacterState, THE buildGroupGenReference SHALL 使用该 CharacterState.imageUrl 作为该角色的锚定图
4. IF characterStateId 指向的 CharacterState 的 imageUrl 为空, THEN THE buildGroupGenReference SHALL 回退使用 Character.imageUrl

### Requirement 9: 状态切换与尾帧承接

**User Story:** As a 系统, I want to 在相邻组使用不同角色状态时跳过尾帧承接, so that 造型变化不会被前一组的尾帧画面约束

#### Acceptance Criteria

1. WHEN 相邻两个 ShotGroup 中同一角色使用不同的 CharacterState（characterStateId 不同或一方为空一方非空）, THE 尾帧承接逻辑 SHALL 跳过该对组之间的同场景尾帧承接（等同于跨场景处理）
2. WHEN 相邻两个 ShotGroup 中所有角色的 CharacterState 均相同, THE 尾帧承接逻辑 SHALL 按照现有同场景/跨场景规则正常执行承接判断
3. THE 尾帧承接逻辑 SHALL 在 applySameSceneContinuation 函数中增加状态切换检测，作为额外的"不承接"判定条件

### Requirement 10: 前端角色状态管理

**User Story:** As a 用户, I want to 在编辑器中管理角色的造型状态并为分镜组选择状态, so that 我可以直观地控制角色在不同镜头中的外观

#### Acceptance Criteria

1. THE 编辑器 SHALL 在角色详情面板中展示该角色所有 CharacterState 列表，支持新增、编辑名称/描述、上传锚定图、删除状态的操作
2. THE 编辑器 SHALL 在分镜组角色关联区域为每个已关联角色提供状态下拉选择器，列出该角色所有可用状态
3. WHEN 用户未为某组某角色选择状态, THE 编辑器 SHALL 显示"默认状态"标签并使用 Character.imageUrl 对应的外观
4. WHEN 用户删除一个 CharacterState, THE 系统 SHALL 将所有引用该状态的 ShotGroupCharacter.characterStateId 置为空（回退到默认）
5. IF 用户尝试删除标记为 isDefault 的唯一状态, THEN THE 系统 SHALL 拒绝删除并提示"默认状态不可删除"
