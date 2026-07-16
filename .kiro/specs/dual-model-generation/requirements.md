# Requirements Document

> **文档状态**：🔒 已封存（视频重绘后端能力保留，前端 /dashboard 已下线）
> **对应实现**：`src/lib/shared/happyhorse.ts`、`src/lib/video/segment-service.ts`、`src/lib/shared/flux.ts`
> **权威来源**：状态以 `AGENTS.md` + `docs/local-life-user-journey.md` 为准，冲突时以代码为准
> **最后校准**：2026-07-11

## Introduction

本功能将视频生成管线从单一 Seedance 2.0 模型扩展为支持 Seedance 2.0 和 HappyHorse 双模型可选。用户在发起生成前可选择引擎，两种引擎拥有各自独立的管线逻辑和积分计费规则。Seedance 2.0 保持原有链式分镜生成管线并新增背景图/背景音乐替换功能；HappyHorse 模式采用 V-Edit（视频编辑）管线，直接基于原视频进行风格化编辑，支持真人脸场景。

## Glossary

- **Engine**: 视频生成引擎标识，可选值为 `seedance` 或 `happyhorse`
- **Generation_System**: 视频生成系统，包含引擎选择、任务创建、轮询、结果处理的完整后端逻辑
- **HappyHorse_Client**: HappyHorse API 客户端模块，负责调用阿里云百炼 DashScope 平台的 V-Edit 接口
- **V-Edit**: HappyHorse 视频编辑模式（模型 ID: `happyhorse-1.0-video-edit`），输入原视频 + 参考图 + 文本指令，输出风格化编辑后的视频
- **Segment_Service**: 视频分段服务，负责将超过 15 秒的视频按场景切割点智能分段
- **Credit_Service**: 积分计费服务，负责按引擎计算、预扣、结算积分
- **Project**: 用户项目，包含原始视频、分镜数据和生成配置
- **GenerationJob**: 生成任务数据库记录，追踪单次生成请求的全生命周期
- **ShotGroup**: 分镜组，Seedance 模式下的最小生成单位
- **Reference_Image**: 参考图，用户上传的风格化参考图片（HappyHorse V-Edit 最多 5 张）
- **Scene_Cut_Point**: 场景切割点，FFmpeg 场景检测得出的视频画面变化突变时间点
- **Audio_Setting**: HappyHorse V-Edit 的音频处理选项，`origin` 表示保留原视频音轨

## Requirements

### Requirement 1: 引擎选择

**User Story:** 作为用户，我想要在发起视频生成前选择使用 Seedance 2.0 或 HappyHorse 引擎，以便根据场景（是否包含真人脸）选择合适的模型。

#### Acceptance Criteria

1. THE Generation_System SHALL 在 Project 和 GenerationJob 数据模型中提供 `engine` 字段，取值为 `seedance` 或 `happyhorse`
2. WHEN 用户选择 HappyHorse 引擎时，THE Generation_System SHALL 在引擎选择界面展示"支持真人脸"标注
3. WHEN 用户选择 Seedance 2.0 引擎时，THE Generation_System SHALL 在引擎选择界面展示"不支持真人脸（会被审核拦截）"标注
4. THE Generation_System SHALL 将用户选择的引擎记录到 Project 的 `engine` 字段，作为该项目的默认生成引擎
5. WHEN 用户未显式选择引擎时，THE Generation_System SHALL 使用 `seedance` 作为默认引擎值

### Requirement 2: Seedance 2.0 模式 — 保持原有管线

**User Story:** 作为用户，我想要在 Seedance 2.0 模式下继续使用原有的解析→分镜→链式生成→合并流程，以确保现有功能不受影响。

#### Acceptance Criteria

1. WHILE engine 为 `seedance` 时，THE Generation_System SHALL 保持原有的 AI 解析→分镜分组→链式串行生成→合并导出的完整管线
2. WHILE engine 为 `seedance` 时，THE Generation_System SHALL 继续使用 Seedance 2.0 API（火山方舟）创建和轮询任务
3. WHILE engine 为 `seedance` 时，THE Generation_System SHALL 保持现有的人物一致性（asset:// 参考图）、音画同步（reference_audio）和镜头衔接（reference_video）能力

### Requirement 3: Seedance 2.0 模式 — 背景图替换

**User Story:** 作为用户，我想要在 Seedance 2.0 模式下上传替换视频背景图，以便自定义生成视频的视觉风格。

#### Acceptance Criteria

1. WHILE engine 为 `seedance` 时，THE Generation_System SHALL 允许用户为分镜组上传一张背景图作为 reference_image 注入生成请求
2. WHEN 用户上传背景图时，THE Generation_System SHALL 将该图上传至 OSS 并生成签名 URL
3. WHEN 分镜组已设置背景图时，THE Generation_System SHALL 在构建 Seedance 请求体时将该背景图 URL 加入 content 数组的 reference_image 列表

### Requirement 4: Seedance 2.0 模式 — 背景音乐替换

**User Story:** 作为用户，我想要在 Seedance 2.0 模式下上传替换视频背景音乐，以便在合并导出时使用自定义音乐替代原有音频。

#### Acceptance Criteria

1. WHILE engine 为 `seedance` 时，THE Generation_System SHALL 允许用户上传一段音频文件作为项目级别的背景音乐
2. WHEN 用户上传背景音乐时，THE Generation_System SHALL 将该音频文件上传至 OSS 并记录其 OSS 键到 Project 模型
3. WHEN 项目设置了自定义背景音乐时，THE Generation_System SHALL 在合并导出阶段使用该音频替代原视频音轨（通过 FFmpeg 混音/替换实现）

### Requirement 5: HappyHorse V-Edit 模式 — 短视频直接生成

**User Story:** 作为用户，我想要在 HappyHorse 模式下对 3-15 秒的短视频直接进行 V-Edit 风格化编辑，无需 AI 解析分镜，一步生成结果。

#### Acceptance Criteria

1. WHILE engine 为 `happyhorse` 且原视频时长在 3-15 秒范围内时，THE Generation_System SHALL 直接使用原视频作为 V-Edit 的输入视频，无需 AI 解析和分镜分组
2. WHEN 用户发起 HappyHorse 生成时，THE HappyHorse_Client SHALL 调用 `happyhorse-1.0-video-edit` 模型，传入原视频 URL、用户参考图（0-5 张）和用户 prompt 指令
3. THE HappyHorse_Client SHALL 在请求头中携带 `X-DashScope-Async: enable` 标记
4. THE HappyHorse_Client SHALL 设置 `audio_setting` 为 `origin` 以保留原视频音轨
5. WHEN 用户上传参考图时，THE Generation_System SHALL 允许上传最多 5 张参考图（格式: JPEG/PNG/WEBP，单张 ≤ 20MB）
6. THE Generation_System SHALL 允许用户在 prompt 中使用 `[Image N]` 语法引用已上传的参考图

### Requirement 6: HappyHorse V-Edit 模式 — 长视频分段处理

**User Story:** 作为用户，我想要在 HappyHorse 模式下对超过 15 秒的视频也能进行 V-Edit 编辑，系统自动分段处理并合并为完整视频。

#### Acceptance Criteria

1. WHILE engine 为 `happyhorse` 且原视频时长超过 15 秒时，THE Segment_Service SHALL 使用 FFmpeg 场景检测在 Scene_Cut_Point 附近进行智能分段，每段不超过 15 秒
2. WHEN 视频被分段后，THE Generation_System SHALL 对每一段使用相同的参考图和 prompt 调用 HappyHorse V-Edit
3. WHEN 所有分段生成完成后，THE Generation_System SHALL 使用 FFmpeg 将各段结果按原始顺序合并为完整视频
4. THE Segment_Service SHALL 在每段时长尽量接近 15 秒的前提下，优先选择距离 15 秒整数倍最近的 Scene_Cut_Point 作为切割点
5. IF 某一分段 V-Edit 生成失败，THEN THE Generation_System SHALL 将该分段标记为失败并报告错误，不进行静默降级

### Requirement 7: HappyHorse API 客户端

**User Story:** 作为开发者，我想要一个封装完善的 HappyHorse API 客户端，以便系统可靠地创建和查询 V-Edit 任务。

#### Acceptance Criteria

1. THE HappyHorse_Client SHALL 向 DashScope endpoint（`POST https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis`）发送异步任务创建请求
2. THE HappyHorse_Client SHALL 使用 `GET https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}` 轮询任务状态
3. WHEN 任务状态为 SUCCEEDED 时，THE HappyHorse_Client SHALL 提取 `video_url` 并立即下载转存至 OSS（因原始 URL 24 小时过期）
4. WHEN 任务状态为 FAILED 时，THE HappyHorse_Client SHALL 提取 `code` 和 `message` 作为错误信息返回
5. IF 环境变量 `DASHSCOPE_API_KEY` 未配置，THEN THE HappyHorse_Client SHALL 直接抛出错误，不进行静默降级
6. THE HappyHorse_Client SHALL 在请求中设置 `watermark: false` 和 `resolution: "720P"`

### Requirement 8: 积分计费 — 双引擎差异化

**User Story:** 作为用户，我想要在使用不同引擎时看到准确的积分消耗估算，以便合理分配积分预算。

#### Acceptance Criteria

1. WHILE engine 为 `seedance` 时，THE Credit_Service SHALL 继续使用现有的基于 completion_tokens 的积分计算公式
2. WHILE engine 为 `happyhorse` 时，THE Credit_Service SHALL 使用基于视频秒数的积分计算公式（输入视频秒数 + 输出视频秒数 × 单价系数）
3. WHEN 用户发起 HappyHorse 生成前，THE Credit_Service SHALL 根据输入视频时长预估积分消耗并进行余额预检
4. IF 用户积分余额不足以覆盖预估消耗，THEN THE Credit_Service SHALL 拒绝生成请求并返回"积分不足"提示
5. WHEN HappyHorse 生成完成后，THE Credit_Service SHALL 根据实际输入视频时长和输出视频时长结算最终积分（多退少补）

### Requirement 9: 数据库模型扩展

**User Story:** 作为开发者，我想要在数据库模型中标记每个项目和生成任务所使用的引擎，以便追踪引擎使用记录和支持引擎特定的业务逻辑。

#### Acceptance Criteria

1. THE Generation_System SHALL 在 Project 模型中新增 `engine` 字段（String 类型，默认值 `seedance`），记录项目默认使用的生成引擎
2. THE Generation_System SHALL 在 GenerationJob 模型中新增 `engine` 字段（String 类型，默认值 `seedance`），记录该次生成任务实际使用的引擎
3. THE Generation_System SHALL 在 Project 模型中新增 `bgmKey` 字段（String 可空），存储用户上传的自定义背景音乐的 OSS 键
4. THE Generation_System SHALL 确保现有数据迁移后 `engine` 字段默认为 `seedance`，不影响已有项目和任务

### Requirement 10: 生成结果资产管理

**User Story:** 作为用户，我想要 HappyHorse 生成的视频结果和 Seedance 生成的结果一样被妥善管理（OSS 存储、14 天过期、可预览），以确保一致的用户体验。

#### Acceptance Criteria

1. WHEN HappyHorse V-Edit 生成成功后，THE Generation_System SHALL 将结果视频从 DashScope 临时 URL 下载并上传至项目 OSS 目录
2. THE Generation_System SHALL 对 HappyHorse 生成的视频资产应用与 Seedance 相同的 14 天过期策略
3. THE Generation_System SHALL 为 HappyHorse 生成的视频抽取封面帧（通过 FFmpeg）用于前端预览展示
4. WHEN HappyHorse 长视频分段全部完成并合并后，THE Generation_System SHALL 将合并后的完整视频作为最终生成结果记录到 GenerationJob

