# Requirements Document

## Introduction

资产库增强功能：在现有资产库基础上，补充资产的交互操作能力和跨项目复用流程。当前资产卡片仅支持删除操作，用户无法放大查看、下载原图、或将角色图应用到其他项目的人物角色。本需求覆盖三大核心增强：（1）资产全屏预览/放大查看；（2）资产下载到本地；（3）角色图跨项目应用到任意项目的人物角色，实现真正的跨项目人物一致性复用。

## Glossary

- **Asset_Library_UI**: 资产库前端界面，提供资产浏览、筛选、搜索和管理交互
- **Asset_Card**: 资产卡片组件，展示单个资产的缩略图、名称、分类和操作按钮
- **Preview_Modal**: 资产预览弹窗，以全屏模态框方式展示资产原图并提供缩放交看能力
- **Asset_Library_Service**: 资产库后端服务模块，负责资产查询、元数据和文件访问
- **Character_Apply_Dialog**: 角色图应用对话框，允许用户选择目标项目和目标人物角色来应用当前角色图
- **Character**: 人物角色记录，包含 imageUrl 字段用于视频生成时的参考图
- **Project**: 用户的视频项目，包含多个人物角色
- **OSS_Signed_URL**: 阿里云 OSS 签名 URL，用于授权访问私有存储文件的临时下载链接

## Requirements

### Requirement 1: 资产全屏预览

**User Story:** 作为用户，我希望点击资产卡片能放大查看资产原图，以便清晰确认资产内容和质量。

#### Acceptance Criteria

1. WHEN a user clicks on an Asset_Card thumbnail, THE Asset_Library_UI SHALL open a Preview_Modal displaying the asset at its original resolution
2. WHILE the Preview_Modal is open, THE Preview_Modal SHALL display the asset name, category, creation date, and file size as metadata
3. WHILE the Preview_Modal is open, THE Preview_Modal SHALL provide zoom-in and zoom-out controls allowing the user to scale the image between 50% and 300% of the viewport-fit size
4. WHEN the user presses the Escape key or clicks the backdrop area, THE Preview_Modal SHALL close and return focus to the triggering Asset_Card
5. WHILE the Preview_Modal is open, THE Preview_Modal SHALL support mouse wheel scrolling to zoom and drag-to-pan when the image exceeds the viewport
6. IF the asset image fails to load in Preview_Modal, THEN THE Preview_Modal SHALL display an error placeholder with the message "图片加载失败" and a retry button

### Requirement 2: 资产下载

**User Story:** 作为用户，我希望能将资产原图下载到本地，以便在其他工具中使用或备份重要素材。

#### Acceptance Criteria

1. WHEN a user clicks the download button on an Asset_Card or within the Preview_Modal, THE Asset_Library_Service SHALL generate an OSS_Signed_URL with a validity period of 10 minutes
2. WHEN the OSS_Signed_URL is generated, THE Asset_Library_UI SHALL trigger a browser file download using the signed URL with the original file name as the download filename
3. THE Asset_Card SHALL display a download button in the hover overlay alongside the existing delete button
4. WHILE the Preview_Modal is open, THE Preview_Modal SHALL display a download button in the toolbar area
5. IF the OSS_Signed_URL generation fails, THEN THE Asset_Library_UI SHALL display a toast notification with the message "下载链接生成失败，请重试"

### Requirement 3: 角色图跨项目应用

**User Story:** 作为用户，我希望将资产库中的角色图直接应用到其他项目的人物角色上，以便在多个项目中保持人物形象一致而无需重新生成。

#### Acceptance Criteria

1. WHEN a user clicks the "应用到角色" button on a CHARACTER category Asset_Card, THE Asset_Library_UI SHALL open a Character_Apply_Dialog
2. WHEN the Character_Apply_Dialog opens, THE Asset_Library_Service SHALL load the user's project list with each project's character list for selection
3. WHILE the Character_Apply_Dialog is open, THE Character_Apply_Dialog SHALL display a two-level selector: first select target Project, then select target Character within that project
4. WHEN the user confirms the application in Character_Apply_Dialog, THE Asset_Library_Service SHALL update the target Character.imageUrl field with the selected asset's URL
5. WHEN the Character.imageUrl is updated via cross-project application, THE Asset_Library_Service SHALL NOT duplicate the asset file in OSS_Storage; the same URL SHALL be referenced directly
6. WHEN the application succeeds, THE Asset_Library_UI SHALL display a success toast with the message "已应用到 [项目名] - [角色名]"
7. IF the target Character already has an imageUrl set, THEN THE Character_Apply_Dialog SHALL display a warning message "该角色已有参考图，确认覆盖？" and require explicit confirmation before proceeding
8. THE "应用到角色" button SHALL only be visible on Asset_Card items with category equal to CHARACTER

### Requirement 4: 资产卡片操作菜单增强

**User Story:** 作为用户，我希望资产卡片提供更多操作入口，以便快速执行预览、下载、应用等操作而无需多次点击。

#### Acceptance Criteria

1. THE Asset_Card SHALL display an action overlay on hover containing: preview button, download button, and delete button for all asset categories
2. WHEN the asset category is CHARACTER, THE Asset_Card action overlay SHALL additionally display an "应用到角色" button
3. THE Asset_Card SHALL support clicking the thumbnail area to trigger the preview action (open Preview_Modal)
4. THE Asset_Card action buttons SHALL each display a recognizable icon with a tooltip label describing the action
5. WHILE any action is in progress (download or apply), THE corresponding button SHALL display a loading spinner and be disabled to prevent duplicate requests

### Requirement 5: 跨项目角色应用 API

**User Story:** 作为开发者，我希望有一个明确的后端 API 来处理角色图跨项目应用，以便前端能安全地更新目标角色的参考图。

#### Acceptance Criteria

1. WHEN the Asset_Library_Service receives a cross-project apply request, THE Asset_Library_Service SHALL verify that the requesting user owns both the asset and the target project
2. WHEN the ownership verification passes, THE Asset_Library_Service SHALL update the target Character record's imageUrl with the asset URL within a single database transaction
3. IF the requesting user does not own the target project, THEN THE Asset_Library_Service SHALL return a 403 Forbidden error with the message "无权操作该项目"
4. IF the target Character ID does not exist in the specified project, THEN THE Asset_Library_Service SHALL return a 404 Not Found error with the message "目标角色不存在"
5. IF the specified Asset ID does not belong to the requesting user, THEN THE Asset_Library_Service SHALL return a 403 Forbidden error with the message "无权访问该资产"
6. WHEN the apply request succeeds, THE Asset_Library_Service SHALL return the updated Character record including the new imageUrl field

### Requirement 6: 项目与角色列表查询

**User Story:** 作为用户，我希望在应用角色图时能看到我所有项目及其角色列表，以便准确选择目标。

#### Acceptance Criteria

1. WHEN the Character_Apply_Dialog requests the user's project list, THE Asset_Library_Service SHALL return all projects belonging to the authenticated user sorted by last updated time (newest first)
2. WHEN a user selects a target project in the Character_Apply_Dialog, THE Asset_Library_Service SHALL return all characters within that project including their current imageUrl (if present) and character name
3. THE Character_Apply_Dialog SHALL display each project's name and character count for quick identification
4. THE Character_Apply_Dialog SHALL display each character's name and a thumbnail of the current reference image (or a placeholder if no image is set)
5. WHEN the project list or character list is loading, THE Character_Apply_Dialog SHALL display a loading skeleton to indicate data is being fetched
