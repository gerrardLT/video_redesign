# Requirements Document

## Introduction

将现有 AI 视频重绘 SaaS 平台改造为面向本地生活实体门店（第一阶段仅餐饮行业）的 AI 短视频营销代运营系统。系统解决商家不会策划、不会拍、不会剪、不会写文案、不会持续运营的问题，提供从商家问诊、内容计划、拍摄指引、自动成片、合规检查到数据复盘的完整闭环。保留旧系统视频生成、FFmpeg、OSS、BullMQ、积分、订阅等底层能力，仅改造上层业务逻辑和界面。

## Glossary

- **Platform**: 本地生活商家 AI 内容经营系统的整体应用
- **Onboarding_Service**: 商家问诊服务，负责收集门店信息并初始化门店数据
- **Profile_Generator**: 门店画像生成服务，基于问诊信息生成内容定位和策略
- **Playbook_Engine**: 行业剧本引擎，负责剧本选择与实例化
- **Calendar_Service**: 内容日历服务，生成 7 天内容计划
- **Capture_Director**: 拍摄任务服务，生成拍摄指引并检测素材质量
- **Render_Service**: 本地视频渲染服务，将素材组合成多版本视频
- **Copy_Generator**: 发布文案生成服务，生成标题、封面、字幕、平台文案
- **Compliance_Service**: 合规检查服务，检测违禁词、虚假宣传、AIGC 标识等
- **Metrics_Service**: 数据录入与表现学习服务，保存表现数据并生成优化建议
- **Entropy_Service**: 内容同质化检测服务，避免批量重复内容
- **Merchant**: 商家实体，关联用户账号，拥有一个或多个门店
- **Store**: 门店实体，包含地址、行业、主打产品等经营信息
- **Store_Profile**: 门店画像，AI 生成的内容定位、人设、风格等策略信息
- **Product_Offer**: 商品或优惠活动信息（套餐、折扣、团购等）
- **Playbook**: 行业剧本模板，定义视频结构、镜头顺序和文案模板
- **Content_Plan**: 内容计划，覆盖一段时间的每日内容安排
- **Content_Brief**: 单条内容任务，对应一天的拍摄和生成目标
- **Shot_Task**: 拍摄任务，单个镜头的拍摄指引
- **Raw_Asset**: 商家上传的原始素材（视频或图片）
- **Video_Variant**: 视频版本，AI 渲染生成的最终视频（促销版/氛围版/口播版）
- **Publish_Job**: 发布任务，视频导出或发布的记录
- **Publish_Metric**: 发布数据指标，视频在各平台的表现数据
- **Compliance_Check**: 合规检查记录，包含风险等级和问题列表
- **Consent_Record**: 出镜授权记录，顾客或员工的肖像使用授权

## Requirements

### Requirement 1: 商家问诊

**User Story:** As a 餐饮商家, I want to 通过问诊表单填写门店基本信息, so that 系统能了解我的经营情况并提供针对性的营销方案。

#### Acceptance Criteria

1. WHEN a registered user submits the onboarding form, THE Onboarding_Service SHALL create a Merchant record, a Store record, and associated Product_Offer records within a single database transaction
2. THE Onboarding_Service SHALL validate that the store industry field is one of the supported restaurant categories (RESTAURANT, DRINK, BAKERY, CAFE, HOTPOT, BBQ, FAST_FOOD, OTHER_LOCAL)
3. THE Onboarding_Service SHALL require the store name (maximum 50 characters), industry, and between 1 and 20 main products (each product name maximum 30 characters) as mandatory fields
4. WHEN the onboarding data is saved successfully, THE Onboarding_Service SHALL enqueue Store_Profile generation and 7-day Content_Plan generation within 5 seconds of the transaction commit
5. IF the onboarding form submission fails validation, THEN THE Onboarding_Service SHALL return an error response containing the field name and a validation failure reason for each invalid field
6. IF the user already has an existing Merchant record, THEN THE Onboarding_Service SHALL reject the submission and return an error message indicating that onboarding has already been completed
7. IF Store_Profile generation or Content_Plan generation fails after onboarding data is saved, THEN THE Onboarding_Service SHALL mark the Store record status as PROFILE_PENDING and allow the user to retry profile generation without re-submitting the onboarding form

### Requirement 2: 门店画像生成

**User Story:** As a 餐饮商家, I want to 系统自动分析我的门店信息并生成内容定位, so that 我不需要自己思考营销策略就能获得专业的内容方向。

#### Acceptance Criteria

1. WHEN a Store record is created, THE Profile_Generator SHALL generate a Store_Profile within 30 seconds, containing content positioning, recommended persona, visual style, hook keywords (5-15 items), forbidden claims (at least 5 items), preferred CTA (3-5 items), and weekly publishing cadence (7 days with daily theme and posting count)
2. THE Profile_Generator SHALL use rule-based logic as the primary generation method, with LLM for refinement and natural language polish
3. THE Profile_Generator SHALL derive forbidden claims covering the following categories: absolute superlatives (最好、第一、唯一), false urgency (全城排队、每天卖爆), unverifiable health claims, price guarantee terms (最低价、保证), and fabricated customer endorsements
4. THE Profile_Generator SHALL generate content dos and donts lists (each containing 3-10 items) specific to the store's industry sub-category and shooting capabilities (canShootKitchen, canShootStaff, canShootCustomers)
5. IF the Store record is missing required input fields (industry, mainProducts, or mainSellingPoints), THEN THE Profile_Generator SHALL reject generation and return an error indicating which fields are missing
6. IF the Profile_Generator fails to populate all mandatory fields (content positioning, recommended persona, visual style, hook keywords, forbidden claims, preferred CTA, and weekly publishing cadence), THEN THE Profile_Generator SHALL set the Store_Profile status to incomplete and return an error indicating which fields could not be generated

### Requirement 3: 餐饮行业剧本库

**User Story:** As a 餐饮商家, I want to 系统内置餐饮行业常用视频结构模板, so that 我不需要自己策划视频内容就能拍出有效的短视频。

#### Acceptance Criteria

1. THE Playbook_Engine SHALL maintain at least 12 active Playbook records for the RESTAURANT industry category, where each Playbook is associated with one ContentGoal and contains at least 3 ordered segments in its video structure, at least 2 hook templates, at least 2 caption templates, at least 1 cover title template, and at least 1 CTA template
2. THE Playbook_Engine SHALL store each Playbook with a defined video structure consisting of ordered segments each specifying a segment name, purpose description, and duration in seconds (between 2 and 15 seconds per segment, total structure duration between 10 and 60 seconds), required shots with ShotTaskType, hook templates, caption templates, cover title templates, and CTA templates
3. WHEN selecting Playbooks for a Content_Plan, THE Playbook_Engine SHALL match Playbooks whose ContentGoal aligns with the store's specified content goals, prioritize Playbooks compatible with the store's active Product_Offers, and filter out Playbooks requiring shot types that the Store_Profile indicates are unavailable (e.g., kitchen shots when canShootKitchen is false)
4. WHEN a Playbook is selected for a specific store and scheduled date, THE Playbook_Engine SHALL instantiate it into a concrete Content_Brief where the hook references the store's actual product names or prices, the title includes the store name or product name, the caption incorporates the store's selling points, the CTA references the store's active offer or location, and Shot_Tasks include store-specific filming instructions
5. THE Playbook_Engine SHALL avoid selecting the same Playbook more than 3 consecutive times within a single Content_Plan
6. IF no active Playbook matches the requested ContentGoal for the store's industry, THEN THE Playbook_Engine SHALL fall back to selecting the highest-scoring available Playbook from a different compatible goal and indicate the substitution reason in the Content_Brief's aiReasoning field

### Requirement 4: 7 天内容日历生成

**User Story:** As a 餐饮商家, I want to 系统自动生成一周的内容计划, so that 我每天都知道该拍什么内容而不需要自己规划。

#### Acceptance Criteria

1. WHEN a 商家 manually requests a Content_Plan generation or a new store onboarding is completed, THE Calendar_Service SHALL generate a 7-day plan starting from the next calendar day, with exactly one Content_Brief per day, and return the complete plan within 30 seconds
2. WHEN generating a Content_Plan, THE Calendar_Service SHALL assign a fixed content goal to each day of the week: weekday lunch traffic on Monday, signature product on Tuesday, persona building on Wednesday, ambiance on Thursday, weekend preheat on Friday, promotions on Saturday, family/social scene on Sunday
3. WHEN generating each Content_Brief, THE Calendar_Service SHALL read the Store_Profile, active Product_Offers, and Playbooks whose status is active and whose category matches the assigned content goal for that day
4. WHEN generating a Content_Brief, THE Calendar_Service SHALL generate between 1 and 5 Shot_Tasks per Content_Brief based on the selected Playbook structure, where each Shot_Task contains a shooting description, recommended duration, and reference angle
5. WHEN generating a Content_Plan, THE Calendar_Service SHALL ensure that no two days within the same 7-day plan are assigned the same content goal
6. IF no active Product_Offer exists for the store, THEN THE Calendar_Service SHALL generate content focused on brand story, ambiance, and trust building goals, skipping any goal that requires product reference
7. IF the Store_Profile is missing or has no store name and category populated, THEN THE Calendar_Service SHALL reject the generation request and return an error indicating that the store profile must be completed before generating a content plan

### Requirement 5: 每日拍摄任务

**User Story:** As a 餐饮商家, I want to 每天打开系统就能看到清晰的拍摄指引, so that 我即使没有专业知识也能拍出合格的素材。

#### Acceptance Criteria

1. WHEN a merchant views today's task page, THE Platform SHALL display the current day's Content_Brief with all associated Shot_Tasks ordered by the sequence field in ascending order
2. THE Capture_Director SHALL provide each Shot_Task with a title (maximum 20 characters), plain-language instruction (maximum 200 characters), required duration in seconds (range 3 to 15 seconds), framing guide, and quality rules listing the inspection dimensions (orientation, resolution, duration, brightness, stability, audio presence)
3. THE Capture_Director SHALL mark each Shot_Task as either required or optional based on the Playbook structure
4. THE Platform SHALL display the overall shooting progress showing how many required shots have been uploaded versus total required, updated within 2 seconds after each asset upload completes
5. WHEN all required Shot_Tasks have uploaded assets that pass quality inspection with a quality score of 60 or above (on a 0-100 scale), THE Platform SHALL enable the video generation button
6. IF a merchant views today's task page and no Content_Brief exists for the current date, THEN THE Platform SHALL display a message indicating no task is scheduled for today and provide an option to generate a content plan
7. IF an uploaded asset fails quality inspection (quality score below 60), THEN THE Platform SHALL display the specific failed dimensions from the quality report and allow the merchant to re-upload a replacement asset for that Shot_Task

### Requirement 6: 素材上传与质量检测

**User Story:** As a 餐饮商家, I want to 上传拍摄的素材并立即知道质量是否合格, so that 我能在现场及时重拍不合格的内容。

#### Acceptance Criteria

1. WHEN a merchant uploads a video asset, THE Capture_Director SHALL extract metadata using FFmpeg (duration, resolution, orientation, file size, audio stream presence) and complete quality inspection within 10 seconds of upload completion
2. THE Capture_Director SHALL evaluate quality based on: vertical orientation (aspect ratio height > width, target 9:16), resolution at least 720p (minimum 720 pixels on the short edge), duration meeting the associated Shot_Task minimum and maximum duration requirement, file size between 1 byte and 300MB, average brightness above 15 (on a 0-255 scale, below which is considered too dark), and audio stream presence for Shot_Tasks marked as requiring voice-over
3. THE Capture_Director SHALL assign a quality score from 0 to 100 and provide a quality report listing each evaluated dimension with its measured value, pass/fail status, and a warning message for each dimension that fails its threshold
4. WHEN an uploaded asset has critical quality issues (resolution below 480p on the short edge, or duration less than 1 second, or file size exceeding 300MB), THE Capture_Director SHALL reject the asset, prevent it from being associated with the Shot_Task, and display a re-upload prompt indicating the specific rejection reason
5. WHEN an asset passes quality inspection (quality score of 60 or above and no critical quality issues), THE Platform SHALL create a Raw_Asset record with status UPLOADED, generate a thumbnail from the first frame, and update the associated Shot_Task status from PENDING to CAPTURED
6. THE Platform SHALL store uploaded assets in Alibaba Cloud OSS with the existing asset lifecycle management (14-day expiration policy)
7. IF quality inspection fails due to FFmpeg processing error or timeout, THEN THE Capture_Director SHALL report the inspection as inconclusive with an error message indicating the failure reason, and allow the merchant to retry the upload

### Requirement 7: AI 自动生成视频版本

**User Story:** As a 餐饮商家, I want to 一键生成多个视频版本, so that 我能选择最适合的版本发布到不同平台。

#### Acceptance Criteria

1. WHEN a merchant triggers video rendering, THE Render_Service SHALL generate exactly 3 Video_Variant records: PROMOTION (促销引流版), ATMOSPHERE (氛围种草版), and OWNER_TALKING (老板口播版)
2. WHEN assembling each Video_Variant, THE Render_Service SHALL use RawAsset files uploaded for ShotTasks marked required=true as primary footage, and SHALL invoke Seedance to generate filler clips only for ShotTasks where no RawAsset has been uploaded and the ShotTask is marked required=false
3. THE Render_Service SHALL use FFmpeg to produce each Video_Variant as a single MP4 file (H.264, AAC audio, 9:16 aspect ratio, minimum 720p vertical resolution) with subtitle overlay, crossfade transitions of 0.5 seconds between clips, and a cover frame extracted from the first second of the final video
4. WHEN rendering starts, THE Platform SHALL reserve (freeze) the user's generation quota via Credit_Service using RESERVE semantics and set the Content_Brief status to RENDERING
5. WHEN rendering of all 3 variants completes successfully, THE Platform SHALL set the Content_Brief status to GENERATED and publish a progress event via Redis Pub/Sub containing the Content_Brief ID, new status, and list of generated Video_Variant IDs
6. IF rendering fails for any variant, THEN THE Render_Service SHALL refund the reserved quota via Credit_Service REFUND, set the Content_Brief status to FAILED, and log the error including Content_Brief ID, variant type, and failure reason
7. THE Render_Service SHALL acquire a distributed lock keyed by Content_Brief ID with a TTL of 720 seconds before processing, to prevent duplicate generation of the same Content_Brief
8. IF the total rendering duration exceeds 600 seconds, THEN THE Render_Service SHALL abort the rendering process, refund the reserved quota, set the Content_Brief status to FAILED, and log a timeout error
9. WHEN Seedance is invoked for filler shot generation, THE Render_Service SHALL generate no more than 3 filler clips per Video_Variant, each with a maximum duration of 5 seconds

### Requirement 8: 标题、封面、字幕与发布文案生成

**User Story:** As a 餐饮商家, I want to 系统自动生成每个视频的标题、封面文字和发布文案, so that 我不需要自己想文案就能直接发布。

#### Acceptance Criteria

1. WHEN a Video_Variant is generated, THE Copy_Generator SHALL produce a title (maximum 30 characters), cover title text (maximum 15 characters), subtitle content, and platform-specific publish captions for all 4 supported platforms (Douyin, Xiaohongshu, Wechat Channels, Kuaishou)
2. THE Copy_Generator SHALL generate platform-specific captions with the following constraints: Douyin caption maximum 300 characters containing location tag and store CTA, Xiaohongshu caption maximum 1000 characters emphasizing personal dining experience and avoiding explicit promotional language, Wechat Channels caption maximum 200 characters using factual statements about the store, and Kuaishou caption maximum 300 characters leading with price or discount information
3. THE Copy_Generator SHALL include between 3 and 10 tags per platform copy, each tag relevant to the store's industry, location, or current Product_Offer, and include one CTA text per platform copy matching the Store_Profile's preferred CTA list
4. THE Copy_Generator SHALL incorporate the store's active Product_Offer information (price, selling points) into promotional copy variants of type PROMOTION; for ATMOSPHERE and OWNER_TALKING variants, Product_Offer information is optional
5. THE Copy_Generator SHALL verify all generated text against the Store_Profile's forbidden claims list before output, and replace or remove any matching forbidden expressions; generated CTA text SHALL be selected from the Store_Profile's preferred CTA list
6. IF the Copy_Generator fails to produce complete text content for any platform, THEN THE Copy_Generator SHALL return an error indicating which platform and field failed, and SHALL NOT save partial results to the Content_Brief record

### Requirement 9: 基础合规检查

**User Story:** As a 餐饮商家, I want to 系统自动检查视频和文案是否合规, so that 我不会因为违规表达而被平台处罚。

#### Acceptance Criteria

1. WHEN a Video_Variant is generated, THE Compliance_Service SHALL automatically perform a compliance check on the variant's title, suggestedCaption, suggestedCoverTitle, subtitle text, and suggestedCta fields, and create a Compliance_Check record associated with both the Content_Brief and the Video_Variant
2. THE Compliance_Service SHALL scan all text fields (title, caption, cover title, subtitles, CTA) for absolute claims (最好、第一、全网最低、唯一、必吃、保证、100%) and flag each match as a HIGH risk issue in the Compliance_Check issues array
3. THE Compliance_Service SHALL scan all text fields for false popularity claims (全城排队、每天卖爆、全网疯抢) and flag each match as MEDIUM risk, where supporting evidence is defined as a Raw_Asset of type CUSTOMER_REACTION linked to the same Content_Brief or a Publish_Metric record with views greater than or equal to 10000 for the same store within the past 30 days
4. THE Compliance_Service SHALL check if any Video_Variant's renderParams or generationLog references Seedance-generated shots, and flag the variant as requiring AIGC disclosure marking with a MEDIUM risk issue
5. IF a Video_Variant's associated Raw_Assets include shots with shotTask.type = CUSTOMER_REACTION and the store's canShootCustomers flag is false, THEN THE Compliance_Service SHALL verify that a Consent_Record with matching storeId and a validTo date in the future (or null) exists, flagging the absence as a HIGH risk issue
6. WHEN the Compliance_Check contains at least one BLOCKED issue, THE Compliance_Service SHALL set the overall riskLevel to BLOCKED, prevent export, and return the list of blocked reasons in the blockedReasons field
7. WHEN the Compliance_Check overall riskLevel is HIGH (at least one HIGH issue and no BLOCKED issues), THE Compliance_Service SHALL allow export only after the user confirms acknowledgment via an explicit API call, and record the acknowledgment timestamp in the Compliance_Check record
8. THE Compliance_Service SHALL invoke the Entropy_Service to compare the current variant's title, caption, and shot sequence against the store's previous 30 videos, flagging a MEDIUM risk issue if the text similarity score exceeds 0.7 or if the same Playbook has been used more than 3 consecutive times
9. THE Compliance_Service SHALL determine the overall Compliance_Check riskLevel as the highest severity among all individual issues (BLOCKED > HIGH > MEDIUM > LOW), defaulting to LOW if no issues are found, and set the passed field to true only when riskLevel is LOW
10. WHEN a user requests video export via the export API, IF no Compliance_Check record exists for the target Video_Variant, THEN THE Compliance_Service SHALL perform the compliance check before allowing export to proceed

### Requirement 10: 视频导出

**User Story:** As a 餐饮商家, I want to 将生成的视频导出为可直接发布的成品, so that 我能下载后手动发布到各平台。

#### Acceptance Criteria

1. WHEN a merchant requests video export for a Video_Variant, THE Platform SHALL generate a final video file with subtitles baked in, encoded as H.264 MP4 with AAC audio, and store it in OSS within 180 seconds of export initiation
2. THE Platform SHALL verify that the Video_Variant has an associated Compliance_Check record with risk level LOW or MEDIUM before allowing export; IF the risk level is HIGH, THEN THE Platform SHALL allow export only after the merchant provides explicit acknowledgment; IF the risk level is BLOCKED, THEN THE Platform SHALL reject the export and display the specific blocked reasons
3. WHEN export completes successfully, THE Platform SHALL create a Publish_Job record with status EXPORTED and provide a download URL signed with a 24-hour time-limited signature
4. THE Platform SHALL export video in 9:16 vertical format (1080x1920 for subscribers, 720x1280 for free-tier users) with resolution determined by the user's subscription tier
5. IF the user's subscription plan does not include export capability, THEN THE Platform SHALL display an upgrade prompt indicating the required tier instead of the export button
6. IF the export process fails due to OSS upload failure or FFmpeg encoding error, THEN THE Platform SHALL set the Publish_Job status to FAILED, log the error context, and display an error message indicating the export failed with a retry option
7. WHEN a merchant requests export, THE Platform SHALL reject the request if there are no completed Video_Variant records for the target Content_Brief, returning an error message indicating no completed video is available for export

### Requirement 11: 数据手动录入

**User Story:** As a 餐饮商家, I want to 手动录入视频在各平台的表现数据, so that 系统能了解哪些内容效果好并给出优化建议。

#### Acceptance Criteria

1. WHEN a merchant submits performance metrics for a Content_Brief, THE Metrics_Service SHALL create a Publish_Metric record with the specified platform, views, likes, comments, shares, saves, link clicks, messages, orders, redemptions, and revenue (in cents)
2. THE Metrics_Service SHALL validate that all numeric metric fields are non-negative integers with a maximum value of 999999999, and that the platform is a valid PublishPlatform value
3. IF any metric field fails validation, THEN THE Metrics_Service SHALL reject the submission and return an error message indicating which fields are invalid and the acceptable range
4. IF the specified Content_Brief does not exist or its status is before EXPORTED, THEN THE Metrics_Service SHALL reject the submission and return an error message indicating the Content_Brief is not eligible for metrics recording
5. THE Metrics_Service SHALL associate the metric record with the corresponding Content_Brief and record the submission timestamp as capturedAt
6. WHEN metrics are saved successfully, THE Metrics_Service SHALL trigger the performance learning analysis asynchronously within 5 seconds
7. THE Platform SHALL allow multiple metric entries for the same Content_Brief across different platforms and different capturedAt timestamps, up to a maximum of 50 metric entries per Content_Brief

### Requirement 12: 表现学习与优化建议

**User Story:** As a 餐饮商家, I want to 系统根据数据表现给出下一步内容建议, so that 我的视频效果能越来越好。

#### Acceptance Criteria

1. WHEN performance metrics are recorded for a Content_Brief, THE Metrics_Service SHALL generate between 1 and 5 suggestions within 10 seconds, where each suggestion contains a category (hook/CTA/offer/structure/timing), a specific recommended action, and the metric evidence that triggered it
2. IF a Content_Brief has views in the top 30% of the store's historical average but conversion metrics (linkClicks + orders + redemptions) in the bottom 30%, THEN THE Metrics_Service SHALL suggest strengthening CTA placement and offer expression in the next Content_Brief using a different Playbook CTA template
3. IF a Content_Brief has saves or comments count in the top 30% of the store's historical average, THEN THE Metrics_Service SHALL recommend reusing the same Playbook structure and return the playbookId and hook style as reuse candidates
4. WHEN generating content goals for the next Content_Plan, THE Metrics_Service SHALL require at least 3 Content_Briefs with recorded metrics for the store before producing goal recommendations, and SHALL return the top 3 recommended ContentGoal values ranked by historical conversion performance
5. IF 3 or more Content_Briefs using the same Playbook or hook style each have views below 50% of the store's historical average, THEN THE Metrics_Service SHALL flag that Playbook or hook style in the playbooksToAvoid list with the underperforming metric evidence
6. WHEN generating the next Content_Plan, THE Calendar_Service SHALL retrieve the playbooksToReuse, playbooksToAvoid, and recommendedNextGoals from the Metrics_Service and SHALL exclude avoided Playbooks from selection and prioritize reuse candidates and recommended goals in the plan generation
7. IF a store has fewer than 3 Content_Briefs with recorded metrics, THEN THE Metrics_Service SHALL return an empty suggestions list and indicate that insufficient data is available for performance-based recommendations

### Requirement 13: 内容同质化检测

**User Story:** As a 餐饮商家, I want to 系统防止生成重复度过高的视频, so that 我的账号不会因为内容雷同而被平台降权。

#### Acceptance Criteria

1. WHEN a video generation request is submitted, THE Entropy_Service SHALL calculate content similarity against the store's generated content from the last 30 calendar days, comparing across three dimensions: Playbook usage pattern, text similarity (titles and captions), and shot sequence/asset composition
2. WHEN the same Playbook is used in 4 or more consecutive generation requests within the 30-day window, THE Entropy_Service SHALL flag the request as MEDIUM duplication risk
3. WHEN any title or caption in the new generation has a string similarity score of 80% or above compared to any single historical title or caption, THE Entropy_Service SHALL flag the request as HIGH duplication risk
4. WHEN 3 or more consecutive shots in the new generation reuse the same asset references in the same order as any historical content, THE Entropy_Service SHALL flag the request as MEDIUM duplication risk
5. WHEN the Entropy_Service completes the similarity check, THE Entropy_Service SHALL return a uniqueness score from 0 to 100 (higher means more unique) accompanied by a list of duplication reasons, where each reason identifies the dimension (Playbook/text/shot-asset), the matched historical content reference, and the measured similarity value
6. IF the uniqueness score is below 40, THEN THE Entropy_Service SHALL block the generation request and return an error message indicating the duplication dimensions that failed, along with the uniqueness score
7. IF the uniqueness score is between 40 and 60 (inclusive), THEN THE Entropy_Service SHALL allow the generation request to proceed but attach a duplication warning to the response containing the risk level and duplication reasons
8. IF the store has fewer than 2 historical generated videos within the 30-day window, THEN THE Entropy_Service SHALL skip the similarity check and return a uniqueness score of 100 with an empty duplication reasons list

### Requirement 14: 订阅与额度管理

**User Story:** As a 餐饮商家, I want to 根据自己的需求选择合适的订阅等级, so that 我能获得与我规模匹配的功能和额度。

#### Acceptance Criteria

1. THE Platform SHALL support four subscription tiers: FREE (免费体验), BASIC (单店基础), GROWTH (单店增长), and AGENCY (服务商)
2. WHILE a merchant is on the FREE tier, THE Platform SHALL limit the merchant to 1 store, 1 Content_Plan, and 3 video generations total (lifetime, non-resetting)
3. WHILE a merchant is on the BASIC tier, THE Platform SHALL allow 1 store, up to 10 Content_Plans, and up to 30 video generations per calendar month, with unused generations not carrying over to the next month
4. WHILE a merchant is on the GROWTH tier, THE Platform SHALL allow 1 store, unlimited Content_Plans, up to 100 video generations per calendar month, access to Playbook templates marked as Growth-tier or above, automated compliance checking on all generated content, and access to performance analytics dashboard
5. WHILE a merchant is on the AGENCY tier, THE Platform SHALL allow up to 20 stores, up to 50 sub-accounts, up to 500 video generations per calendar month, batch generation of up to 10 concurrent video tasks, and consolidated cross-store reporting
6. WHEN a merchant attempts a quota-gated action (creating a store, creating a Content_Plan, or initiating a video generation) that would exceed their tier's quota, THE Platform SHALL block the action and display an upgrade prompt indicating the current quota usage, the quota limit, and the minimum tier required to proceed
7. WHEN a merchant initiates a video generation request, THE Platform SHALL verify that the merchant's remaining monthly (or lifetime for FREE tier) video generation quota is greater than zero before submitting the rendering task; IF the remaining quota is zero, THEN THE Platform SHALL reject the request and display a message indicating the quota has been exhausted along with the quota reset date (for monthly tiers) or an upgrade prompt (for FREE tier)
8. WHEN a new calendar month begins, THE Platform SHALL reset the video generation counter to zero for all merchants on BASIC, GROWTH, and AGENCY tiers

### Requirement 15: 商家界面极简化

**User Story:** As a 餐饮商家, I want to 界面足够简单直观, so that 我不需要学习复杂操作就能完成每日内容生产。

#### Acceptance Criteria

1. THE Platform SHALL present the merchant home page with: today's Content_Brief task card, weekly Content_Plan overview (7 days), pending actions count (Content_Briefs in READY_TO_SHOOT or MATERIALS_UPLOADED status), and the highest-view Video_Variant from the past 14 days
2. THE Platform SHALL hide all technical parameters (AI model settings, rendering parameters, shot group configurations, Seedance prompt details, FFmpeg encoding options) from the merchant-facing interface, exposing only task status and action buttons
3. THE Platform SHALL display shooting instructions using only everyday vocabulary (e.g., "从左往右慢慢移动手机" instead of "水平横移镜头"), excluding terms such as 分镜、帧率、码率、景别、色温、白平衡、跟焦
4. THE Platform SHALL provide a linear workflow with exactly 5 steps: see today's task, shoot, upload, generate, export, where each step displays a single primary action button and the current step is visually indicated
5. THE Platform SHALL retain the existing video redesign interface at the /dashboard path for advanced users, separate from the merchant interface at the /merchant path, with no cross-navigation links from the merchant interface to the dashboard
6. IF a merchant has no historical Video_Variant records, THEN THE Platform SHALL display the home page with a first-task onboarding prompt in place of the best-performing video section
7. WHEN a merchant navigates to a workflow step whose prerequisite step is incomplete, THE Platform SHALL display a message indicating the required prior step and provide a navigation link back to that step

### Requirement 16: 旧系统能力保留

**User Story:** As a 平台运营者, I want to 保留旧的视频重绘能力, so that 现有高级用户不受影响且底层技术资产得到复用。

#### Acceptance Criteria

1. THE Platform SHALL retain all existing video analysis, shot grouping, Seedance generation, FFmpeg processing, and merge export capabilities at their current API paths, such that existing API routes under /api/projects/, /api/upload/, /api/media/ continue to accept the same request schemas and return the same response schemas as before the merchant-workflow addition
2. THE Platform SHALL reuse the existing credit-service for generation quota management in the merchant workflow by invoking the same reserveCredits/chargeCredits/refundCredits functions with a merchant-workflow-specific identifier (contentBriefId or variantId) as the idempotency key, preserving the RESERVE/CHARGE/REFUND ledger pattern and Redis distributed lock serialization
3. THE Platform SHALL reuse the existing BullMQ queue infrastructure for new merchant-workflow workers (content plan generation, video rendering, compliance review) by registering new queue names in src/lib/queue.ts using the same lazyQueue factory pattern, shared Redis connection, and default retry/backoff configuration
4. THE Platform SHALL reuse the existing OSS storage service for merchant asset upload, video variant storage, and export file storage by calling the same uploadFile/uploadBuffer/getSignedObjectUrl/getMediaProxyUrl functions with merchant-namespaced key prefixes (e.g., merchant/{storeId}/assets/, merchant/{storeId}/variants/) that do not collide with existing videos/ key namespace
5. THE Platform SHALL maintain backward compatibility with existing user accounts by preserving the existing User table schema (additive columns or new relation tables only, no column removal or type change), such that the same authenticated user session can navigate to both the video redesign dashboard (/dashboard) and the merchant management interface (/merchant) without re-authentication
6. WHEN database migrations are applied for the merchant workflow, THE Platform SHALL use additive-only schema changes (new models, new columns with defaults, new indexes) and SHALL NOT alter or drop existing columns, tables, or constraints used by the video redesign workflow
7. WHILE both video-redesign workers and merchant-workflow workers are running, THE Platform SHALL configure separate BullMQ concurrency limits per queue so that merchant-workflow jobs do not reduce the processing throughput of existing video-parse, video-generate, and video-merge queues below their current configured concurrency
