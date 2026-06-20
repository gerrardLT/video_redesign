# Requirements Document

## Introduction

当前系统对所有 AI 生成资产统一设置 14 天过期策略，由 asset-cleanup Worker 定时清理。但用户资产库中的角色图是跨项目复用的永久资产，不应被自动清理。本功能引入"永久资产"与"临时资产"双轨生命周期策略，确保入库资产不会被误删，同时为用户提供清晰的过期状态感知和资产升级路径。

## Glossary

- **Asset**: 系统中的素材记录，存储于 assets 表，包含图片 URL、状态、过期时间等元数据
- **Permanent_Asset**: 永久资产，expiresAt 为 null 的资产，不受 cleanup Worker 清理影响
- **Temporary_Asset**: 临时资产，expiresAt 有具体日期的资产，到期后被 cleanup Worker 清理
- **Asset_Library**: 用户资产库，存放 category 有值的跨项目复用资产
- **Cleanup_Worker**: asset-cleanup 定时任务，每日 3:00 扫描并清理 expiresAt <= now() 的资产
- **Asset_Lifecycle_Service**: 资产生命周期服务，负责过期检测、标记和文件清理逻辑
- **Ingestion_Service**: 资产入库服务，负责将生成的角色图自动入库到用户资产库
- **Expiry_Status**: 资产过期状态标识，分为 permanent（永久）、expiring_soon（即将过期）、active（有效期内）、expired（已过期）
- **Bookmark_Action**: 收藏操作，用户将临时资产升级为永久资产的行为

## Requirements

### Requirement 1: 永久资产识别与保护

**User Story:** 作为用户，我希望入库到资产库的角色图被标记为永久资产，以便跨项目持续复用而不会被自动清理。

#### Acceptance Criteria

1. WHEN Ingestion_Service 将角色图入库到 Asset_Library 时，THE Ingestion_Service SHALL 确保 Asset 的 expiresAt 字段为 null
2. WHEN Cleanup_Worker 扫描过期资产时，THE Cleanup_Worker SHALL 仅查询 expiresAt 不为 null 且 expiresAt <= 当前时间的 Asset 记录
3. THE Asset_Lifecycle_Service SHALL 将 category 字段有值的 Asset 识别为 Permanent_Asset
4. WHEN Asset 的 category 字段有值且 expiresAt 不为 null 时，THE Asset_Lifecycle_Service SHALL 将该 Asset 的 expiresAt 设置为 null

### Requirement 2: 临时资产过期策略

**User Story:** 作为系统管理者，我希望项目级临时产物保持 14 天自动过期，以便控制存储成本。

#### Acceptance Criteria

1. WHEN 项目解析阶段创建 CHARACTER_IMAGE 类型的 Asset 且该 Asset 未入库到 Asset_Library 时，THE Asset_Lifecycle_Service SHALL 设置 expiresAt 为创建时间加 14 天
2. WHEN 用户手动上传参考图到项目时，THE Asset_Lifecycle_Service SHALL 设置 expiresAt 为创建时间加 14 天
3. WHILE Temporary_Asset 的 expiresAt 到达当前时间，THE Cleanup_Worker SHALL 删除对应的 OSS 文件并标记 Asset 状态为 EXPIRED

### Requirement 3: 资产过期状态展示

**User Story:** 作为用户，我希望在前端清晰看到每个资产的过期状态，以便了解资产生命周期并及时操作。

#### Acceptance Criteria

1. WHEN Asset 的 expiresAt 为 null 时，THE System SHALL 向前端返回 Expiry_Status 为 "permanent"
2. WHEN Asset 的 expiresAt 距当前时间不超过 3 天且大于当前时间时，THE System SHALL 向前端返回 Expiry_Status 为 "expiring_soon" 并附带剩余天数
3. WHEN Asset 的 expiresAt 大于当前时间超过 3 天时，THE System SHALL 向前端返回 Expiry_Status 为 "active" 并附带剩余天数
4. WHEN Asset 的 expiresAt 小于或等于当前时间时，THE System SHALL 向前端返回 Expiry_Status 为 "expired"
5. THE System SHALL 在资产列表和资产详情中展示 Expiry_Status 对应的视觉标识

### Requirement 4: 临时资产收藏升级

**User Story:** 作为用户，我希望将有价值的临时资产收藏到资产库升级为永久资产，以便长期保存和复用。

#### Acceptance Criteria

1. WHEN 用户对 Temporary_Asset 执行 Bookmark_Action 时，THE System SHALL 将该 Asset 的 expiresAt 设置为 null
2. WHEN 用户对 Temporary_Asset 执行 Bookmark_Action 时，THE System SHALL 为该 Asset 设置合适的 category 值
3. WHEN Bookmark_Action 完成后，THE System SHALL 立即在前端更新该 Asset 的 Expiry_Status 为 "permanent"
4. IF 用户对已过期（status 为 EXPIRED）的 Asset 执行 Bookmark_Action，THEN THE System SHALL 返回错误提示说明资产已被清理无法收藏

### Requirement 5: 过期提醒通知

**User Story:** 作为用户，我希望在临时资产即将过期前收到提醒，以便决定是否收藏保留。

#### Acceptance Criteria

1. WHEN Temporary_Asset 的 expiresAt 距当前时间不超过 3 天时，THE System SHALL 生成过期提醒通知
2. THE System SHALL 在通知中包含 Asset 名称、所属项目名称和剩余过期天数
3. THE System SHALL 在通知中提供直接执行 Bookmark_Action 的操作入口
4. THE System SHALL 每个 Asset 仅发送一次过期提醒通知，避免重复打扰

### Requirement 6: 数据一致性保障

**User Story:** 作为系统管理者，我希望现有数据与新策略保持一致，以便平滑过渡到新的过期策略。

#### Acceptance Criteria

1. WHEN 系统部署新版本时，THE System SHALL 执行数据迁移，将所有 category 有值且 expiresAt 不为 null 的现有 Asset 的 expiresAt 设置为 null
2. WHEN Asset_Lifecycle_Service 的 setExpiry 方法被调用时，THE Asset_Lifecycle_Service SHALL 检查 Asset 的 category 字段，若有值则跳过过期设置
3. WHEN Asset_Lifecycle_Service 的 renewExpiry 方法被调用时，THE Asset_Lifecycle_Service SHALL 检查 Asset 的 category 字段，若有值则跳过续期操作（永久资产无需续期）
