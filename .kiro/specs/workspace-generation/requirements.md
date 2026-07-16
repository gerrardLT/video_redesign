# Requirements Document

> **文档状态**：🔒 已封存（视频重绘后端能力保留，前端 /dashboard/workspace 已下线）
> **对应实现**：`src/lib/video/{workspace-generation-service,workspace-request-builder,workspace-validators}.ts`、`src/lib/shared/happyhorse-workspace.ts`、`src/stores/happyhorse-store.ts`
> **权威来源**：状态以 `AGENTS.md` + `docs/local-life-user-journey.md` 为准，冲突时以代码为准
> **最后校准**：2026-07-11

## Introduction

工作台（Workspace）是用户进行视频生成的核心入口页面。用户在此输入 prompt、上传参考素材（图片/视频/音频）、选择模型（Seedance 2.0 或 HappyHorse）、配置生成参数，一键触发视频生成任务。生成过程通过 SSE 实时推送进度，生成结果展示在页面下方画廊区域。工作台模式与现有「分镜工厂」模式互补——工作台面向快速单次生成，分镜工厂面向长视频逐组重绘。

## Glossary

- **Workspace**: 工作台页面，用户进行快速视频生成的主界面
- **Prompt_Input**: Prompt 文本输入组件，支持多行输入和 @ 引用素材
- **Reference_Asset**: 用户上传的参考素材（图片/视频/音频文件）
- **Asset_Manager**: 参考素材管理模块，负责上传、校验、预览和删除操作
- **Model_Selector**: 模型选择器，在 Seedance 2.0 和 HappyHorse 之间切换
- **Param_Panel**: 参数配置面板，包含比例、分辨率、时长、数量、风格等参数
- **Credit_Estimator**: 积分预估模块，生成前实时展示预估积分消耗
- **Generation_Trigger**: 生成触发模块，调用后端 API 创建生成任务
- **Progress_Tracker**: 进度追踪模块，通过 SSE 实时展示生成进度
- **Result_Gallery**: 结果画廊，展示生成完成的视频作品
- **Inspiration_Template**: 灵感模板，预设的 prompt 示例供用户快速选用
- **Workspace_Project**: 工作台生成时自动创建的项目记录，用于归档和历史查询

## Requirements

### Requirement 1: Prompt 输入

**User Story:** 作为用户，我希望在工作台输入视频描述文字，以便 AI 根据描述生成视频。

#### Acceptance Criteria

1. THE Prompt_Input SHALL 提供多行文本输入区域，最大长度为 2500 字符
2. WHEN 用户输入 `@` 字符时，THE Prompt_Input SHALL 弹出已上传素材列表供用户选择引用
3. WHEN 用户从列表中选择一个素材时，THE Prompt_Input SHALL 在光标位置插入 `@素材名称` 引用标记
4. WHILE 输入内容为空时，THE Prompt_Input SHALL 展示占位提示文案，说明支持的输入方式
5. THE Prompt_Input SHALL 实时显示当前已输入字符数

### Requirement 2: 参考素材管理

**User Story:** 作为用户，我希望上传图片、视频或音频作为参考素材，以便 AI 参考这些素材生成视频。

#### Acceptance Criteria

1. THE Asset_Manager SHALL 支持上传图片（jpg/png/webp）、视频（mp4/mov/webm）和音频（mp3/wav/aac）文件
2. THE Asset_Manager SHALL 限制单次生成任务最多关联 12 个参考素材
3. WHEN 用户拖拽文件到上传区域时，THE Asset_Manager SHALL 接收并上传文件
4. WHEN 用户选择文件后，THE Asset_Manager SHALL 校验文件类型和大小（图片最大 10MB，视频最大 100MB，音频最大 20MB）
5. IF 文件类型不在允许范围或超出大小限制，THEN THE Asset_Manager SHALL 显示具体的错误提示（包含文件名和限制条件）
6. WHEN 上传完成后，THE Asset_Manager SHALL 展示素材缩略图预览和文件名
7. WHEN 用户点击素材删除按钮时，THE Asset_Manager SHALL 从列表中移除该素材
8. IF 用户尝试上传第 13 个素材，THEN THE Asset_Manager SHALL 拒绝上传并提示已达上限

### Requirement 3: 模型选择

**User Story:** 作为用户，我希望在 Seedance 2.0 和 HappyHorse 之间切换模型，以便选择适合当前需求的生成引擎。

#### Acceptance Criteria

1. THE Model_Selector SHALL 默认选中 Seedance 2.0 模型
2. THE Model_Selector SHALL 展示每个模型的名称、描述和支持时长范围
3. WHEN 用户切换到 Seedance 2.0 时，THE Param_Panel SHALL 将可选时长范围更新为 4-15 秒
4. WHEN 用户切换到 HappyHorse 时，THE Param_Panel SHALL 将可选时长范围更新为 3-15 秒
5. WHEN 用户切换模型后，THE Credit_Estimator SHALL 重新计算积分预估值
6. WHILE 选中 HappyHorse 模型时，THE Model_Selector SHALL 标注该模型支持真人脸风格化转换
7. WHILE 选中 Seedance 2.0 模型时，THE Model_Selector SHALL 标注该模型支持文/图/视频/音频全模态输入

### Requirement 4: 参数配置

**User Story:** 作为用户，我希望配置视频生成参数（比例、分辨率、时长、数量、风格），以便控制生成结果的规格。

#### Acceptance Criteria

1. THE Param_Panel SHALL 提供比例选项：16:9、9:16、1:1，默认为 16:9
2. THE Param_Panel SHALL 固定分辨率为 720P
3. THE Param_Panel SHALL 提供时长选项，取值范围与当前选中模型联动
4. WHEN 选中 Seedance 2.0 时，THE Param_Panel SHALL 提供 4s、5s、8s、10s、15s 时长选项，默认 5s
5. WHEN 选中 HappyHorse 时，THE Param_Panel SHALL 提供 3s、5s、8s、10s、15s 时长选项，默认 5s
6. THE Param_Panel SHALL 提供生成数量选项，固定为 1 个
7. WHEN 用户修改任意参数时，THE Credit_Estimator SHALL 重新计算积分预估值

### Requirement 5: 积分预估与扣费

**User Story:** 作为用户，我希望在生成前看到预估积分消耗，以便评估是否发起生成。

#### Acceptance Criteria

1. THE Credit_Estimator SHALL 根据当前选中模型、时长和分辨率实时计算并展示预估积分消耗
2. WHEN 选中 Seedance 2.0 时，THE Credit_Estimator SHALL 使用公式 `ceil(duration × 1.5)` 计算预估积分（720P）
3. WHEN 选中 HappyHorse 时，THE Credit_Estimator SHALL 使用公式 `ceil((duration + min(duration, 15)) × HAPPYHORSE_CREDIT_COEFFICIENT)` 计算预估积分
4. IF 用户当前积分余额小于预估消耗，THEN THE Generation_Trigger SHALL 禁用生成按钮并显示余额不足提示
5. THE Credit_Estimator SHALL 在参数变化后 300ms 内更新预估值（防抖）

### Requirement 6: 生成触发

**User Story:** 作为用户，我希望点击生成按钮一键触发视频生成，以便快速获得 AI 生成的视频。

#### Acceptance Criteria

1. WHEN 用户点击生成按钮时，THE Generation_Trigger SHALL 向后端发送生成请求（包含 prompt、参考素材 URL 列表、模型类型、比例、时长、分辨率）
2. WHEN 选中 Seedance 2.0 时，THE Generation_Trigger SHALL 调用 Seedance 生成 API
3. WHEN 选中 HappyHorse 时，THE Generation_Trigger SHALL 调用 HappyHorse 生成 API
4. THE Generation_Trigger SHALL 在发起生成前自动创建一个 Workspace_Project 记录用于归档
5. WHILE 生成请求正在提交中，THE Generation_Trigger SHALL 禁用生成按钮并展示加载状态
6. IF 后端返回 402（余额不足），THEN THE Generation_Trigger SHALL 展示积分不足提示并引导用户充值
7. IF 后端返回 429（并发限制），THEN THE Generation_Trigger SHALL 展示排队提示信息
8. IF 后端返回其他错误，THEN THE Generation_Trigger SHALL 展示错误详情并允许重试
9. WHEN prompt 为空时，THE Generation_Trigger SHALL 禁用生成按钮

### Requirement 7: 实时进度追踪

**User Story:** 作为用户，我希望在生成过程中看到实时进度，以便了解当前生成状态。

#### Acceptance Criteria

1. WHEN 生成任务提交成功后，THE Progress_Tracker SHALL 通过 SSE 连接接收实时进度事件
2. THE Progress_Tracker SHALL 展示当前生成阶段（排队中/生成中/已完成/失败）
3. WHILE 生成进行中，THE Progress_Tracker SHALL 展示百分比进度条
4. WHEN 收到 completed 事件时，THE Progress_Tracker SHALL 展示生成完成状态并触发结果刷新
5. IF 收到 failed 事件，THEN THE Progress_Tracker SHALL 展示失败原因并提供重试按钮
6. THE Progress_Tracker SHALL 复用现有 `useSSEProgress` Hook 和 `sse-progress-store` 进行状态管理

### Requirement 8: 结果画廊

**User Story:** 作为用户，我希望在工作台下方看到生成完成的视频，以便预览和管理作品。

#### Acceptance Criteria

1. THE Result_Gallery SHALL 以网格布局展示视频缩略图
2. WHEN 用户点击视频缩略图时，THE Result_Gallery SHALL 弹出视频播放预览
3. THE Result_Gallery SHALL 展示「发现」和「我的作品」两个 Tab
4. WHEN 选中「我的作品」Tab 时，THE Result_Gallery SHALL 展示当前用户所有工作台生成的历史作品
5. WHEN 选中「发现」Tab 时，THE Result_Gallery SHALL 展示公开的优质生成作品
6. WHEN 新作品生成完成时，THE Result_Gallery SHALL 自动将新作品插入到列表顶部
7. THE Result_Gallery SHALL 支持分页加载，每页展示 12 个作品

### Requirement 9: 历史记录

**User Story:** 作为用户，我希望查看自己所有在工作台生成的历史视频，以便回顾和下载过往作品。

#### Acceptance Criteria

1. THE Result_Gallery SHALL 在「我的作品」Tab 中按生成时间倒序展示作品
2. THE Result_Gallery SHALL 为每个历史作品展示缩略图、生成时间、使用模型和时长信息
3. WHEN 用户滚动到列表底部时，THE Result_Gallery SHALL 自动加载下一页历史作品
4. THE Result_Gallery SHALL 在无历史作品时展示空状态引导（鼓励用户开始创作）

### Requirement 10: 灵感模板

**User Story:** 作为用户，我希望看到预设的 prompt 模板，以便快速获得创作灵感并一键填入。

#### Acceptance Criteria

1. THE Inspiration_Template SHALL 在 Prompt 输入区域下方展示一排可横向滚动的灵感卡片
2. WHEN 用户点击灵感卡片时，THE Inspiration_Template SHALL 将该卡片的文本填入 Prompt_Input
3. THE Inspiration_Template SHALL 提供至少 6 个不同风格的预设 prompt 示例
4. WHEN 灵感文本填入后，THE Credit_Estimator SHALL 立即重新计算积分预估值
