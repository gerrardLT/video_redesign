# Requirements Document

## Introduction

新用户引导向导功能：为注册后首次进入 Dashboard 的新用户提供一套轻量级、非阻塞的引导体验流程。通过欢迎页向导、预制示例项目（不消耗真实 AI 资源）、关键功能点 Tooltip/Spotlight 提示、编辑器内操作引导、以及引导进度持久化，帮助用户快速理解平台核心能力和操作流程，从而提升新用户激活率、首次生成成功率，并合理利用初始 100 积分体验额度。

## Glossary

- **Onboarding_Service**: 引导服务端模块，负责引导状态管理、示例项目创建、进度持久化和奖励发放
- **Onboarding_UI**: 引导前端界面模块，负责向导弹窗、Tooltip/Spotlight 提示、进度指示器的渲染和交互
- **Welcome_Wizard**: 欢迎向导，新用户首次登录时展示的多步骤引导弹窗，介绍平台核心功能
- **Sample_Project**: 示例项目，一个预制的短视频项目（10 秒，已完成解析），使用静态预制数据展示真实效果，不消耗 AI 资源
- **Tooltip_Guide**: 功能点提示引导，通过 Tooltip/Spotlight 高亮特定 UI 元素并展示操作说明
- **Onboarding_Progress**: 引导进度记录，存储用户已完成和跳过的引导步骤状态
- **Onboarding_Step**: 单个引导步骤，包含步骤标识、展示条件、内容和完成状态
- **Dashboard**: 用户主控制台页面，包含项目列表、资产库入口、套餐入口等
- **Editor**: 视频编辑器页面，包含分镜列表、提示词编辑、人物选择、生成按钮等
- **Completion_Reward**: 完成奖励，用户完成全部引导步骤后获得的额外积分奖励

## Requirements

### Requirement 1: 新用户首次登录欢迎向导

**User Story:** 作为新注册用户，我希望首次进入 Dashboard 时看到欢迎向导，以便快速了解平台能做什么以及如何开始。

#### Acceptance Criteria

1. WHEN a user logs in and the Onboarding_Progress record does not exist for that user, THE Onboarding_Service SHALL create an Onboarding_Progress record with all steps marked as NOT_COMPLETED
2. WHEN a user enters the Dashboard for the first time (Onboarding_Progress shows Welcome_Wizard step as NOT_COMPLETED), THE Onboarding_UI SHALL display the Welcome_Wizard as a modal overlay
3. THE Welcome_Wizard SHALL present a maximum of 4 steps, each step containing a title, description text, and an illustrative image or animation
4. THE Welcome_Wizard SHALL include a "下一步" button to advance, a "跳过引导" button to dismiss, and a step progress indicator showing current position
5. WHEN the user completes or skips the Welcome_Wizard, THE Onboarding_Service SHALL update the Welcome_Wizard step status to COMPLETED or SKIPPED in the Onboarding_Progress record

### Requirement 2: 示例项目自动创建

**User Story:** 作为新用户，我希望有一个预制的示例项目可以直接体验完整流程，以便在不消耗积分的情况下了解平台工作方式。

#### Acceptance Criteria

1. WHEN a new user's Onboarding_Progress is first created, THE Onboarding_Service SHALL create a Sample_Project in the user's project list with status set to EDITABLE
2. THE Sample_Project SHALL contain pre-populated data including: a 10-second video URL, parsed shot list (at least 3 shots with cover images), pre-filled prompts, and at least 1 pre-configured character with image
3. THE Sample_Project SHALL be clearly labeled with a "示例项目" badge in the Dashboard project list to distinguish it from user-created projects
4. WHEN a user triggers generation on the Sample_Project, THE Onboarding_Service SHALL return pre-rendered video results from static storage without calling the AI generation API and without deducting credits
5. THE Onboarding_Service SHALL limit each user to exactly 1 Sample_Project; duplicate creation attempts SHALL be ignored
6. IF the Sample_Project pre-populated data files are unavailable from static storage, THEN THE Onboarding_Service SHALL log an error and skip Sample_Project creation without blocking user access

### Requirement 3: Dashboard 功能点 Tooltip 引导

**User Story:** 作为新用户，我希望 Dashboard 上的关键功能点有操作提示，以便我知道每个功能的用途和操作入口。

#### Acceptance Criteria

1. WHEN the Welcome_Wizard step is completed or skipped and the Dashboard_Tooltip step is NOT_COMPLETED, THE Onboarding_UI SHALL sequentially display Tooltip_Guide highlights on the following elements: "新建项目"按钮、"资产库"入口、"套餐"入口、"帮助中心"入口
2. THE Onboarding_UI SHALL display each Tooltip_Guide as a non-blocking floating card attached to the target element, with Spotlight dimming the surrounding area
3. WHEN the user clicks the Tooltip_Guide "知道了" button or clicks the highlighted element itself, THE Onboarding_UI SHALL advance to the next Tooltip_Guide in the sequence
4. WHEN the user clicks outside the Tooltip area or presses Escape, THE Onboarding_UI SHALL dismiss the current Tooltip sequence and mark the Dashboard_Tooltip step as SKIPPED
5. WHEN all Dashboard Tooltip_Guide items are viewed, THE Onboarding_Service SHALL mark the Dashboard_Tooltip step as COMPLETED

### Requirement 4: 编辑器内操作引导

**User Story:** 作为新用户，我希望首次进入编辑器时获得操作引导，以便了解如何编辑提示词、选择人物和发起生成。

#### Acceptance Criteria

1. WHEN a user enters the Editor page for the first time (Editor_Guide step is NOT_COMPLETED in Onboarding_Progress), THE Onboarding_UI SHALL display a sequential Tooltip_Guide on the following elements: 分镜列表区域、提示词编辑框、人物选择面板、生成按钮
2. THE Onboarding_UI SHALL display each Editor Tooltip_Guide with a descriptive text explaining the element's purpose and recommended usage
3. WHEN the user clicks "下一步" on an Editor Tooltip_Guide, THE Onboarding_UI SHALL advance to the next guide element
4. WHEN the user clicks "跳过" or presses Escape during the Editor guide sequence, THE Onboarding_Service SHALL mark the Editor_Guide step as SKIPPED
5. WHEN all Editor Tooltip_Guide items are viewed, THE Onboarding_Service SHALL mark the Editor_Guide step as COMPLETED
6. WHILE the Editor Tooltip_Guide is displayed, THE Onboarding_UI SHALL NOT block user interaction with the Editor; the user SHALL be able to dismiss and freely operate at any time

### Requirement 5: 引导进度持久化

**User Story:** 作为用户，我希望引导进度被持久化保存，以便我不会重复看到已完成的引导步骤，且刷新或重新登录后状态不丢失。

#### Acceptance Criteria

1. THE Onboarding_Service SHALL persist the Onboarding_Progress record in the database with the following fields: userId, step identifier, step status (NOT_COMPLETED | COMPLETED | SKIPPED), and updatedAt timestamp
2. WHEN a user completes or skips any Onboarding_Step, THE Onboarding_Service SHALL immediately update the corresponding step status in the database
3. WHEN a user re-enters a page containing an Onboarding_Step that is already COMPLETED or SKIPPED, THE Onboarding_UI SHALL NOT display that step's guide content
4. THE Onboarding_Service SHALL support the following steps: WELCOME_WIZARD, SAMPLE_PROJECT_CREATED, DASHBOARD_TOOLTIP, EDITOR_GUIDE, FIRST_PROJECT_GUIDE
5. WHEN querying Onboarding_Progress, THE Onboarding_Service SHALL return the full progress state in a single API call to minimize frontend round-trips

### Requirement 6: 跳过与重新查看引导

**User Story:** 作为用户，我希望能随时跳过引导，也能在需要时重新查看引导，以便引导不强制占用时间但又可在需要时找回。

#### Acceptance Criteria

1. THE Onboarding_UI SHALL display a "跳过引导" option on every active Onboarding_Step, allowing the user to immediately dismiss the current step
2. WHEN the user selects "跳过引导", THE Onboarding_Service SHALL mark the current step as SKIPPED and SHALL NOT display subsequent steps in the same sequence
3. THE Onboarding_UI SHALL provide a "重新查看引导" entry in the user settings or help menu, visible at all times regardless of current progress state
4. WHEN the user triggers "重新查看引导", THE Onboarding_Service SHALL reset all Onboarding_Step statuses to NOT_COMPLETED and THE Onboarding_UI SHALL restart from the Welcome_Wizard
5. WHEN a user who has existing projects triggers "重新查看引导", THE Onboarding_Service SHALL NOT create a duplicate Sample_Project if one already exists

### Requirement 7: 首次创建项目时的流程指引

**User Story:** 作为新用户，我希望首次创建自己的项目时得到流程指引，以便我了解从上传视频到生成结果的完整步骤。

#### Acceptance Criteria

1. WHEN a user creates their first non-sample project and the FIRST_PROJECT_GUIDE step is NOT_COMPLETED, THE Onboarding_UI SHALL display a contextual guide overlay explaining the project creation flow
2. THE Onboarding_UI SHALL present the project creation flow guide in sequential steps: 输入视频链接 → 等待解析 → 编辑分镜和提示词 → 选择人物 → 发起生成
3. WHEN the user dismisses or completes the project creation flow guide, THE Onboarding_Service SHALL mark the FIRST_PROJECT_GUIDE step as COMPLETED
4. THE Onboarding_UI SHALL display each flow guide step as a lightweight tooltip or banner that does not block the underlying page interaction

### Requirement 8: 引导完成奖励

**User Story:** 作为新用户，我希望完成全部引导后获得额外积分奖励，以便我有动力完成引导并获得更多体验资源。

#### Acceptance Criteria

1. WHEN all Onboarding_Steps are marked as COMPLETED (not SKIPPED), THE Onboarding_Service SHALL grant the user a Completion_Reward of additional credits (configurable amount, default 20 credits)
2. WHEN the Completion_Reward is granted, THE Onboarding_Service SHALL create a CreditLedger entry with action TOPUP and remark "新手引导完成奖励"
3. WHEN the Completion_Reward is granted, THE Onboarding_UI SHALL display a congratulatory notification showing the reward amount and updated credit balance
4. THE Onboarding_Service SHALL grant the Completion_Reward at most once per user; repeated completion after "重新查看引导" SHALL NOT trigger additional rewards
5. IF any Onboarding_Step is SKIPPED rather than COMPLETED, THEN THE Onboarding_Service SHALL NOT grant the Completion_Reward

### Requirement 9: 引导非阻塞与轻量原则

**User Story:** 作为用户，我希望引导不会阻塞我的正常操作，以便我可以自由探索平台而不被强制引导流程打断。

#### Acceptance Criteria

1. WHILE any Onboarding_Step is displayed, THE Onboarding_UI SHALL allow the user to interact with all underlying page elements by clicking outside the guide area
2. THE Onboarding_UI SHALL dismiss any active Tooltip_Guide or overlay within 300ms of the user clicking outside the guide area or pressing Escape
3. THE Onboarding_UI SHALL NOT use full-screen blocking modals for Tooltip_Guide steps; only the Welcome_Wizard initial step SHALL use a centered modal overlay
4. WHEN a user navigates away from a page with an active guide, THE Onboarding_UI SHALL dismiss the guide and preserve the current progress state without marking incomplete steps as failed
5. THE Onboarding_UI SHALL render all guide elements with a z-index that keeps them above page content but below critical system UI (toast notifications, error dialogs)
