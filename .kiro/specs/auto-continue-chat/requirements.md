# Requirements Document

## Introduction

本功能是一个面向 Kiro（基于 VS Code 内核）的扩展，名为「自动续接对话扩展」。当用户与 Kiro 对话时遇到 "Too many requests"（限流）错误导致对话中断后，扩展能够自动检测该中断，并在经过克制的退避等待后自动重新发起/续接对话，使用户无需手动点击重试。

设计上必须遵循一个关键事实：Kiro 自身在限流时已存在较激进的重试行为（参见社区已知问题），过度重试会进一步加重限流。因此本扩展的核心价值不仅是"自动重试"，更是"克制、可控、有上限、有退避"的自动续接，避免使限流问题恶化。

检测机制基于 Kiro 对话面板真实渲染的文本与状态（真实数据来源），不依赖伪造或假设的状态。当检测能力不可用时，扩展必须显式报错并停止自动行为，而非静默失败或基于假数据继续运行。

### 形态与已知约束

- 形态：VS Code / Kiro 扩展（已确认）。这是唯一能同时做到"精准识别限流错误文本"与"重新发起对话"的形态。
- 已知约束：Kiro 对话 UI 内部并非公开稳定 API，扩展依赖读取真实渲染的对话面板内容；Kiro 大版本 UI 变更可能影响检测，需在检测失效时显式告警。

## Glossary

- **Auto_Continue_Extension（自动续接扩展）**：本功能交付的 VS Code / Kiro 扩展整体。
- **Chat_Monitor（对话监视器）**：负责持续读取 Kiro 对话面板真实渲染内容与状态的组件。
- **Rate_Limit_Detector（限流检测器）**：基于 Chat_Monitor 读取的真实文本，判定当前是否为限流中断的组件。
- **Retry_Scheduler（重试调度器）**：负责计算退避时间、调度自动续接动作、维护重试计数与上限的组件。
- **Continue_Action（续接动作）**：扩展程序化触发的"继续/重发"操作（点击 Continue 按钮或重新提交上一条用户指令）。
- **Status_Indicator（状态指示器）**：状态栏中展示扩展启用状态与当前续接进度的 UI 元素。
- **Activity_Log（运行日志）**：记录检测、重试、退避、停止等事件的日志输出。
- **限流错误**：Kiro 对话面板中出现的 "Too many requests, please wait before trying again." 或语义等价的限流提示。
- **退避等待**：两次自动续接之间按指数增长计算的等待时间。
- **重试上限**：单次中断事件允许的最大自动续接次数。

## Requirements

### 需求 1：限流中断检测

**User Story:** 作为 Kiro 用户，我希望扩展能自动识别对话因限流而中断，从而不需要我盯着屏幕判断是否出错。

#### 验收标准

1. WHILE Auto_Continue_Extension 处于启用状态，THE Chat_Monitor SHALL 持续读取 Kiro 对话面板当前渲染的文本与状态。
2. WHEN Kiro 对话面板出现 "Too many requests" 限流提示文本，THE Rate_Limit_Detector SHALL 将当前状态判定为"限流中断"。
3. WHEN Kiro 对话正常完成且未出现限流提示文本，THE Rate_Limit_Detector SHALL 将当前状态判定为"非限流中断"。
4. IF Chat_Monitor 无法读取对话面板内容（例如 Kiro UI 结构变更导致检测失效），THEN THE Auto_Continue_Extension SHALL 在 Status_Indicator 与 Activity_Log 中显式报告"检测不可用"并暂停自动续接动作。

### 需求 2：自动续接对话

**User Story:** 作为 Kiro 用户，我希望对话因限流中断后扩展能自动续接，从而不需要我手动点击重试。

#### 验收标准

1. WHEN Rate_Limit_Detector 判定为"限流中断" AND Auto_Continue_Extension 处于启用状态 AND 当前重试次数小于重试上限，THE Retry_Scheduler SHALL 在等待一次退避等待后调度一次 Continue_Action。
2. WHEN Retry_Scheduler 调度 Continue_Action，THE Auto_Continue_Extension SHALL 通过点击对话面板的"继续"控件或重新提交上一条用户指令来续接对话。
3. WHEN 一次 Continue_Action 执行后对话恢复正常生成，THE Retry_Scheduler SHALL 将当前中断事件的重试计数重置为 0。
4. IF Rate_Limit_Detector 判定为"非限流中断"，THEN THE Retry_Scheduler SHALL 不调度任何 Continue_Action。

### 需求 3：克制重试与指数退避

**User Story:** 作为 Kiro 用户，我希望自动重试是克制的，从而避免频繁重试反而加重限流、浪费配额。

#### 验收标准

1. THE Retry_Scheduler SHALL 使用指数退避计算两次 Continue_Action 之间的退避等待，退避等待 = 初始等待 × (退避倍数 ^ 已重试次数)。
2. THE Retry_Scheduler SHALL 使用初始等待默认值 5 秒、退避倍数默认值 2、退避等待上限默认值 300 秒。
3. WHEN 计算得到的退避等待超过退避等待上限，THE Retry_Scheduler SHALL 使用退避等待上限作为实际等待时间。
4. WHILE 处于退避等待期间，THE Retry_Scheduler SHALL 不发起新的 Continue_Action。

### 需求 4：重试上限与停止条件

**User Story:** 作为 Kiro 用户，我希望自动续接有明确上限和停止条件，从而避免无限循环消耗资源。

#### 验收标准

1. THE Retry_Scheduler SHALL 使用重试上限默认值 10 次。
2. WHEN 单次中断事件的连续自动续接次数达到重试上限，THE Retry_Scheduler SHALL 停止自动续接并在 Status_Indicator 与 Activity_Log 中报告"已达重试上限"。
3. IF 同一中断事件连续触发自动续接，THEN THE Retry_Scheduler SHALL 在每次调度后将当前重试计数加 1。
4. WHEN 用户在对话面板手动输入新的指令，THE Retry_Scheduler SHALL 终止当前中断事件的自动续接流程并将重试计数重置为 0。

### 需求 5：启用、禁用与手动取消

**User Story:** 作为 Kiro 用户，我希望随时一键开关自动续接，从而在需要手动控制时立即接管。

#### 验收标准

1. THE Status_Indicator SHALL 在状态栏展示 Auto_Continue_Extension 当前为"启用"或"禁用"状态。
2. WHEN 用户点击 Status_Indicator，THE Auto_Continue_Extension SHALL 在"启用"与"禁用"状态之间切换。
3. WHILE Auto_Continue_Extension 处于禁用状态，THE Retry_Scheduler SHALL 不调度任何 Continue_Action。
4. WHEN 用户在自动续接进行中触发"取消续接"命令，THE Retry_Scheduler SHALL 立即停止当前调度并取消等待中的退避计时。

### 需求 6：可配置参数

**User Story:** 作为 Kiro 用户，我希望能自定义等待时间和重试上限，从而根据自己的配额和使用习惯调整行为。

#### 验收标准

1. THE Auto_Continue_Extension SHALL 提供配置项 initialWaitSeconds（初始等待，秒）、backoffMultiplier（退避倍数）、maxWaitSeconds（退避等待上限，秒）、maxRetries（重试上限，次）。
2. WHEN 用户修改任一配置项，THE Retry_Scheduler SHALL 在下一次调度时使用更新后的配置值。
3. IF 任一配置项被设置为小于其允许的最小值（initialWaitSeconds 最小 1、backoffMultiplier 最小 1、maxWaitSeconds 最小 1、maxRetries 最小 1），THEN THE Auto_Continue_Extension SHALL 拒绝该值并在 Activity_Log 中报告配置无效。

### 需求 7：可见性与日志

**User Story:** 作为 Kiro 用户，我希望清楚看到扩展每一步在做什么，从而信任它并在异常时排查。

#### 验收标准

1. WHEN Rate_Limit_Detector 判定为"限流中断"，THE Status_Indicator SHALL 显示"检测到限流，准备续接"状态。
2. WHILE 处于退避等待期间，THE Status_Indicator SHALL 显示当前剩余等待时间与已重试次数。
3. WHEN 发生检测、退避、续接、重置、达到上限、检测不可用中的任一事件，THE Activity_Log SHALL 记录该事件的类型与发生时间。
4. WHEN Auto_Continue_Extension 完成一次自动续接动作，THE Activity_Log SHALL 记录本次使用的退避等待时长与当前重试计数。
