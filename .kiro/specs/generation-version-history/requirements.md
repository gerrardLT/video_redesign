# Requirements Document

## Introduction

生成版本历史功能：为每个分镜组（ShotGroup）的视频生成结果提供版本历史管理。当前系统每次重新生成视频时会直接覆盖 genVideoUrl，导致用户无法回看之前的生成结果、无法对比不同提示词效果、无法在团队间共享多版本供选择。本功能通过自动保存每次生成的版本记录（视频URL、封面、使用的prompt、生成时间、积分消耗），支持版本列表浏览、A/B 对比预览、切换当前使用版本、删除历史版本，并确保合并导出时使用当前选中版本的视频。

## Glossary

- **ShotGroup**: 分镜组，项目中的一个视频片段单元，对应一次 Seedance 生成调用与一段合并视频
- **Generation_Version**: 生成版本，记录单次视频生成结果的完整快照，包含视频URL、封面URL、尾帧URL、prompt快照、积分消耗和生成时间
- **Current_Version**: 当前版本，分镜组中被选定为正在使用的版本，合并导出时以此版本的视频为准
- **Version_History_Service**: 版本历史服务端模块，负责版本的创建、查询、切换、删除和数量限制管理
- **Version_History_UI**: 版本历史前端界面，提供版本列表浏览、A/B 对比预览和版本管理交互
- **AB_Compare_View**: A/B 对比视图，将用户选择的两个版本并排播放以便比较效果差异
- **Version_Limit**: 版本数量上限，每个分镜组允许保留的最大版本数（默认10个），防止存储无限膨胀
- **Export_Pipeline**: 导出管线，合并导出时读取各分镜组的当前版本视频URL进行拼接的流程

## Requirements

### Requirement 1: 首次生成自动创建版本

**User Story:** 作为用户，我希望首次生成视频时系统自动创建版本记录，以便后续生成结果不会覆盖当前结果。

#### Acceptance Criteria

1. WHEN a GenerationJob for a ShotGroup completes with status SUCCEEDED, THE Version_History_Service SHALL create a Generation_Version record containing the resultVideoUrl, genCoverUrl, lastFrameUrl, promptSnapshot, costEstimate, and generation completion timestamp
2. WHEN the first Generation_Version is created for a ShotGroup, THE Version_History_Service SHALL mark the Generation_Version as Current_Version
3. WHEN a Generation_Version is created, THE Version_History_Service SHALL assign a sequential version number starting from 1 within the scope of the ShotGroup
4. WHEN a Generation_Version is created, THE Version_History_Service SHALL update the ShotGroup.genVideoUrl, ShotGroup.genCoverUrl, and ShotGroup.lastFrameUrl fields to reference the new version's corresponding URLs

### Requirement 2: 重新生成保留旧版本

**User Story:** 作为用户，我希望重新生成视频时保留之前的版本，以便在新结果不满意时可以回退到旧版本。

#### Acceptance Criteria

1. WHEN a ShotGroup is regenerated and the GenerationJob completes with status SUCCEEDED, THE Version_History_Service SHALL create a new Generation_Version without deleting any existing versions
2. WHEN a new Generation_Version is created from regeneration, THE Version_History_Service SHALL automatically set the new version as Current_Version and unmark the previous Current_Version
3. WHEN the version count for a ShotGroup reaches the Version_Limit, THE Version_History_Service SHALL delete the oldest non-current Generation_Version before creating the new version
4. IF a GenerationJob fails (status FAILED), THEN THE Version_History_Service SHALL NOT create a Generation_Version record, and the existing Current_Version SHALL remain unchanged

### Requirement 3: 版本列表浏览

**User Story:** 作为用户，我希望能浏览某个分镜组的所有历史版本，以便了解生成记录全貌并选择满意的版本。

#### Acceptance Criteria

1. WHEN a user opens the version history panel for a ShotGroup, THE Version_History_UI SHALL display a list of all Generation_Version records sorted by version number in descending order (newest first)
2. THE Version_History_UI SHALL display each Generation_Version's version number, thumbnail (genCoverUrl), prompt excerpt (前30个字符), generation time, and credits consumed
3. THE Version_History_UI SHALL visually distinguish the Current_Version from other versions using a highlighted badge or border
4. THE Version_History_UI SHALL display the total version count and the Version_Limit for the ShotGroup (例如 "3/10")

### Requirement 4: A/B 对比预览

**User Story:** 作为用户，我希望能选择两个版本并排播放对比，以便直观判断哪个版本效果更好。

#### Acceptance Criteria

1. WHEN a user selects two Generation_Version records for comparison, THE AB_Compare_View SHALL display the two videos side by side in equal-width panels
2. WHILE the AB_Compare_View is active, THE AB_Compare_View SHALL synchronize the playback position of both videos (play, pause, seek operations affect both simultaneously)
3. THE AB_Compare_View SHALL display each version's version number and prompt excerpt above its video panel for identification
4. WHEN a user clicks a "use this version" button within the AB_Compare_View, THE Version_History_Service SHALL set the selected version as Current_Version

### Requirement 5: 切换当前使用版本

**User Story:** 作为用户，我希望能将某个历史版本设为当前使用版本，以便导出时使用该版本而无需重新生成。

#### Acceptance Criteria

1. WHEN a user selects a Generation_Version and confirms the switch action, THE Version_History_Service SHALL set the selected version as Current_Version and unmark the previous Current_Version
2. WHEN the Current_Version is switched, THE Version_History_Service SHALL update the ShotGroup.genVideoUrl to the selected version's videoUrl, ShotGroup.genCoverUrl to the selected version's coverUrl, and ShotGroup.lastFrameUrl to the selected version's lastFrameUrl
3. WHEN the Current_Version is switched, THE Version_History_UI SHALL immediately reflect the change by updating the highlighted version indicator without requiring a page reload
4. THE Version_History_Service SHALL complete the version switch operation without consuming any user credits

### Requirement 6: 删除历史版本

**User Story:** 作为用户，我希望能删除不需要的历史版本，以便释放存储空间并保持版本列表整洁。

#### Acceptance Criteria

1. WHEN a user requests to delete a Generation_Version, THE Version_History_UI SHALL display a confirmation dialog before proceeding
2. IF a user attempts to delete the Current_Version, THEN THE Version_History_UI SHALL prevent the deletion and display a message indicating the current版本不可删除
3. WHEN deletion is confirmed for a non-current Generation_Version, THE Version_History_Service SHALL remove the Generation_Version record from the database
4. WHEN a Generation_Version is deleted, THE Version_History_Service SHALL delete the associated video file and cover image from OSS_Storage
5. WHEN a Generation_Version is successfully deleted, THE Version_History_UI SHALL remove the item from the version list and update the version count display without requiring a page reload

### Requirement 7: 合并导出使用当前版本

**User Story:** 作为用户，我希望合并导出时使用每个分镜组当前选中的版本视频，以便导出结果与预览一致。

#### Acceptance Criteria

1. WHEN the Export_Pipeline begins a merge export, THE Export_Pipeline SHALL read each ShotGroup's genVideoUrl field (which always points to the Current_Version's video)
2. THE Export_Pipeline SHALL NOT directly access Generation_Version records during export; the ShotGroup.genVideoUrl field SHALL serve as the single source of truth for export
3. WHEN a ShotGroup has no Current_Version (genVideoUrl is null), THE Export_Pipeline SHALL skip the ShotGroup and log a warning indicating the group has no generated video

### Requirement 8: 版本数量限制管理

**User Story:** 作为用户，我希望系统自动限制每个分镜组的版本数量，以便存储空间不会无限增长。

#### Acceptance Criteria

1. THE Version_History_Service SHALL enforce a configurable Version_Limit per ShotGroup (default value: 10)
2. WHEN the version count for a ShotGroup equals the Version_Limit and a new generation succeeds, THE Version_History_Service SHALL identify the oldest non-current Generation_Version for automatic deletion
3. WHEN a Generation_Version is automatically deleted due to Version_Limit enforcement, THE Version_History_Service SHALL delete the associated video file and cover image from OSS_Storage
4. THE Version_History_UI SHALL display the current version count and Version_Limit to inform the user of remaining capacity
5. IF all non-current versions have been deleted and the Version_Limit is still reached (only the Current_Version exists), THEN THE Version_History_Service SHALL allow creating the new version by increasing the effective count to Version_Limit + 1 temporarily, then the new version becomes Current_Version and the system returns to Version_Limit compliance

