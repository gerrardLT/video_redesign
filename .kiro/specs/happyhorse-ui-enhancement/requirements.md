# Requirements Document

## Introduction

对 HappyHorse V-Edit 前端界面进行全面 UI/UX 优化，涵盖引擎选择器卡片化、参考图拖拽上传与悬浮放大、生成积分预估、进度动画、结果预览对比、Prompt 模板快捷填充、生成状态实时推送、历史记录列表，以及信息架构层面的 Tab 切换布局重构。目标是将现有朴素界面升级为专业级创作工具体验。

## Glossary

- **Engine_Selector**: 引擎选择器组件，用于在 Seedance 分镜模式与 HappyHorse 风格化模式之间切换
- **Generate_Panel**: HappyHorse 生成面板，包含 Prompt 输入、参考图管理、生成操作等功能区域
- **Prompt_Area**: 编辑指令文本输入区域，用户在此描述期望的风格变化
- **Template_Picker**: Prompt 模板快捷选择器，提供预置风格模板一键填入功能
- **Reference_Image_Uploader**: 参考图上传组件，支持拖拽放置和文件选择
- **Credit_Estimator**: 积分预估显示模块，在生成前展示预计消耗积分数
- **Progress_Indicator**: 生成进度指示器，展示实时进度动画和预估剩余时间
- **Result_Preview**: 生成结果预览组件，支持原视频与生成视频的 Before/After 对比
- **History_List**: 历史记录列表组件，展示当前项目的 HappyHorse 生成历史
- **SSE_Client**: Server-Sent Events 客户端，接收后端推送的实时生成进度事件
- **Mode_Tab**: 模式标签页组件，实现 Seedance 与 HappyHorse 面板的 Tab 切换布局

## Requirements

### Requirement 1: 引擎选择器卡片化

**User Story:** As a 创作者, I want 通过卡片式引擎选择器直观对比两种引擎的特性差异, so that 我能快速做出适合当前项目的引擎选择决策。

#### Acceptance Criteria

1. THE Engine_Selector SHALL 以 Tab 标签页形式呈现两种模式（"Seedance 分镜模式" 和 "HappyHorse 风格化模式"），每个 Tab 包含引擎图标、名称和功能简介
2. WHEN 用户选中某个 Tab, THE Engine_Selector SHALL 高亮当前选中 Tab 并在下方展示对应引擎的功能面板
3. THE Engine_Selector SHALL 在 HappyHorse Tab 上展示推荐角标（如"推荐"徽章），标识其支持真人脸的优势
4. THE Engine_Selector SHALL 在每个 Tab 内展示功能对比标签（如"支持真人脸""分镜脚本""风格化转换"等 Tag），帮助用户区分两种引擎的能力范围
5. WHEN 引擎切换请求正在处理中, THE Engine_Selector SHALL 禁用 Tab 交互并显示加载状态

### Requirement 2: 信息架构 Tab 切换布局

**User Story:** As a 创作者, I want 编辑器按模式分 Tab 展示对应面板, so that 界面信息层级清晰，我只看到当前模式相关的操作区域。

#### Acceptance Criteria

1. THE Mode_Tab SHALL 将 Seedance 分镜模式面板和 HappyHorse 风格化模式面板组织为互斥的 Tab 内容区域
2. WHEN HappyHorse 模式被选中, THE Mode_Tab SHALL 隐藏分镜组列表（ShotGroup List），仅展示 Generate_Panel
3. WHEN Seedance 模式被选中, THE Mode_Tab SHALL 展示分镜组列表和分镜编辑相关操作区域
4. THE Mode_Tab SHALL 在 Tab 切换时保留各面板的用户输入状态（Prompt 文本、已上传参考图等），切回时恢复

### Requirement 3: 参考图拖拽上传与悬浮放大

**User Story:** As a 创作者, I want 通过拖拽方式上传参考图并悬浮预览大图, so that 我能更高效地管理参考图且确认图片细节。

#### Acceptance Criteria

1. THE Reference_Image_Uploader SHALL 支持拖拽放置文件到上传区域触发上传
2. WHEN 用户将文件拖入上传区域, THE Reference_Image_Uploader SHALL 显示拖入高亮视觉反馈（边框变色或背景色变化）
3. WHEN 用户将非图片文件或超过大小限制的文件拖入, THE Reference_Image_Uploader SHALL 显示错误提示并拒绝接收
4. WHEN 用户将鼠标悬停在已上传的缩略图上, THE Reference_Image_Uploader SHALL 显示放大预览浮层（展示原图尺寸或固定较大尺寸）
5. THE Reference_Image_Uploader SHALL 继续支持点击按钮选择文件的传统上传方式
6. THE Reference_Image_Uploader SHALL 在单张图片超过 20MB 或格式非 JPEG/PNG/WEBP 时拒绝上传并提示具体原因

### Requirement 4: 参考图自动插入占位符

**User Story:** As a 创作者, I want 上传参考图后自动在 Prompt 中插入对应占位符, so that 我无需手动记忆和输入引用格式。

#### Acceptance Criteria

1. WHEN 一张参考图上传成功, THE Generate_Panel SHALL 在 Prompt_Area 当前光标位置插入 `[Image N]` 占位符（N 为该图的序号）
2. WHEN 一张参考图被移除, THE Generate_Panel SHALL 从 Prompt_Area 中删除对应的 `[Image N]` 占位符，并重新编号剩余占位符
3. IF Prompt_Area 当前无光标焦点, THEN THE Generate_Panel SHALL 将占位符追加到 Prompt 文本末尾

### Requirement 5: Prompt 模板快捷填充

**User Story:** As a 创作者, I want 通过一键选择预置风格模板填充 Prompt, so that 我能快速开始常见风格的生成而无需从头编写指令。

#### Acceptance Criteria

1. THE Template_Picker SHALL 在 Prompt_Area 附近展示常用风格模板选项（至少包含"动漫风""赛博朋克""水墨国风"三种预置模板）
2. WHEN 用户点击某个模板选项, THE Template_Picker SHALL 将对应模板文本填入 Prompt_Area（替换当前内容）
3. WHEN Prompt_Area 已有用户输入内容且用户点击模板, THE Template_Picker SHALL 弹出确认提示询问是否替换当前内容
4. THE Template_Picker SHALL 以标签（Tag）或按钮组形式呈现，占据最小视觉空间

### Requirement 6: 生成按钮积分预估显示

**User Story:** As a 创作者, I want 在点击生成前看到预估积分消耗, so that 我能提前评估成本决定是否继续。

#### Acceptance Criteria

1. THE Credit_Estimator SHALL 在生成按钮区域显示预估积分消耗文本（格式如"预估消耗 ~N 积分"）
2. WHEN 项目视频时长或分段数量变化时, THE Credit_Estimator SHALL 重新计算并更新预估积分值
3. IF 用户当前积分余额不足以覆盖预估消耗, THEN THE Credit_Estimator SHALL 以警告样式显示余额不足提示并禁用生成按钮
4. THE Credit_Estimator SHALL 调用后端积分预估接口获取真实预估值，不依赖前端本地计算

### Requirement 7: 生成进度动画与实时状态

**User Story:** As a 创作者, I want 生成过程中看到实时进度动画和预估剩余时间, so that 我了解生成进展而非面对无反馈的等待。

#### Acceptance Criteria

1. WHILE 生成任务处于进行中状态, THE Progress_Indicator SHALL 展示脉冲环或粒子特效动画替代静态"生成中..."文字
2. WHILE 生成任务处于进行中状态, THE Progress_Indicator SHALL 展示百分比进度条
3. WHILE 生成任务处于进行中状态, THE Progress_Indicator SHALL 展示预估剩余时间文本
4. THE SSE_Client SHALL 通过 Server-Sent Events 连接接收后端推送的进度事件（包含进度百分比和预估剩余秒数）
5. IF SSE 连接断开, THEN THE SSE_Client SHALL 在 3 秒后自动重连，重连期间展示"连接中..."状态
6. WHEN 生成任务完成（成功或失败）, THE Progress_Indicator SHALL 停止动画并展示最终状态（成功图标或错误信息）

### Requirement 8: 生成结果视频预览与对比

**User Story:** As a 创作者, I want 生成完成后直接在面板内预览结果视频并与原视频对比, so that 我能立即评估生成效果。

#### Acceptance Criteria

1. WHEN 生成任务成功完成, THE Result_Preview SHALL 在面板内展示生成结果视频播放器
2. THE Result_Preview SHALL 提供 Before/After 对比模式，允许用户同时查看原视频和生成视频
3. WHEN 用户切换到对比模式, THE Result_Preview SHALL 并排或上下排列原视频与生成视频，同步播放进度
4. THE Result_Preview SHALL 支持视频播放基本控制（播放/暂停、进度拖拽、音量调节）
5. IF 生成结果包含多个分段视频, THEN THE Result_Preview SHALL 以列表或轮播形式展示所有分段

### Requirement 9: 历史记录列表与对比

**User Story:** As a 创作者, I want 查看当前项目的 HappyHorse 生成历史记录, so that 我能回顾之前的生成效果并进行版本对比。

#### Acceptance Criteria

1. THE History_List SHALL 展示当前项目所有 HappyHorse 生成记录，按时间倒序排列
2. THE History_List SHALL 为每条记录展示缩略图、生成时间、使用的 Prompt 摘要和状态（成功/失败/进行中）
3. WHEN 用户点击某条历史记录, THE History_List SHALL 在 Result_Preview 中加载该条记录的生成视频
4. THE History_List SHALL 支持选择两条记录进行对比查看
5. IF 历史记录超过 20 条, THEN THE History_List SHALL 分页或滚动加载展示

