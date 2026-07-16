# Requirements Document

> **文档状态**：🔒 已封存（视频重绘后端能力保留，前端 /dashboard 已下线）
> **对应实现**：`src/lib/video/wavespeed.ts`、`src/workers/upscale-video.ts`
> **权威来源**：状态以 `AGENTS.md` + `docs/local-life-user-journey.md` 为准，冲突时以代码为准
> **最后校准**：2026-07-11

## Introduction

视频导出超分功能：视频生成阶段统一使用 480p 分辨率以节省 Seedance 生成成本，在导出环节为用户提供分辨率选择（480p / 720p / 1080p），选择高分辨率时调用 WaveSpeed AI Video Upscaler API 对 480p 源视频进行超分处理，并按分辨率档位向用户收取不同积分。

## Glossary

- **Export_Service**: 视频导出服务，负责协调分辨率选择、积分校验、超分调用和最终文件交付的后端模块
- **Upscale_Worker**: 基于 BullMQ 的异步任务处理器，负责调用 WaveSpeed API 完成视频超分并轮询结果
- **WaveSpeed_API**: WaveSpeed AI Video Upscaler 外部 API 服务，接受视频 URL 和目标分辨率参数，返回超分后的视频
- **Credit_Service**: 现有积分服务，提供余额预检、冻结、扣除、返还等事务安全操作
- **Resolution_Tier**: 分辨率档位，分为 480p（基础/免费）、720p（中档收费）、1080p（高档收费）三级
- **Merge_Worker**: 现有视频合并 Worker，负责将各分镜组视频合并为一个完整视频文件
- **OSS**: 对象存储服务，存放合并后和超分后的视频文件

## Requirements

### Requirement 1: 导出分辨率选择

**User Story:** As a 用户, I want to 在导出视频时选择目标分辨率, so that 我可以根据需求和预算获得不同画质的成品视频

#### Acceptance Criteria

1. WHEN 用户触发导出请求, THE Export_Service SHALL 接受 target_resolution 参数（取值为 "480p"、"720p" 或 "1080p"）
2. IF target_resolution 参数缺失或取值不在允许列表中, THEN THE Export_Service SHALL 返回 400 错误并说明合法取值范围
3. WHEN target_resolution 为 "480p", THE Export_Service SHALL 直接执行合并导出流程，不调用 WaveSpeed_API
4. WHEN target_resolution 为 "720p" 或 "1080p", THE Export_Service SHALL 在合并完成后触发超分处理流程

### Requirement 2: 导出前积分预检

**User Story:** As a 用户, I want to 在导出前知道积分是否充足, so that 我不会在等待合并完成后才发现无法超分

#### Acceptance Criteria

1. WHEN target_resolution 为 "720p" 或 "1080p", THE Export_Service SHALL 在创建合并任务前计算超分所需积分
2. THE Export_Service SHALL 按公式计算超分积分消耗：ceil(视频时长秒数 × 每秒积分单价)，其中 720p 每秒积分单价为 1 积分，1080p 每秒积分单价为 2 积分
3. IF 用户积分余额不足以支付超分费用, THEN THE Export_Service SHALL 返回 402 错误并说明所需积分数和当前余额
4. WHEN 积分预检通过, THE Export_Service SHALL 冻结对应积分额度（RESERVE），防止并发消费导致余额不足

### Requirement 3: 视频合并阶段

**User Story:** As a 系统, I want to 合并分镜视频为完整文件, so that 超分阶段有完整的输入视频

#### Acceptance Criteria

1. THE Merge_Worker SHALL 统一以 480p 分辨率输出合并视频
2. WHEN 合并完成且 target_resolution 为 "480p", THE Merge_Worker SHALL 将合并视频上传 OSS 并标记导出完成
3. WHEN 合并完成且 target_resolution 为 "720p" 或 "1080p", THE Merge_Worker SHALL 将合并视频上传 OSS 后触发超分任务入队

### Requirement 4: WaveSpeed 超分处理

**User Story:** As a 用户, I want to 通过 AI 超分将 480p 视频升级到更高分辨率, so that 我获得高画质的成品视频

#### Acceptance Criteria

1. WHEN 超分任务启动, THE Upscale_Worker SHALL 向 WaveSpeed_API 发送 POST 请求，传入合并视频的 OSS 公开 URL 和 target_resolution 参数
2. THE Upscale_Worker SHALL 以轮询方式查询 WaveSpeed_API 的处理结果（GET /api/v3/predictions/{requestId}/result），轮询间隔为 5 秒，最大轮询次数为 120 次（10 分钟超时）
3. WHEN WaveSpeed_API 返回处理成功, THE Upscale_Worker SHALL 下载超分后的视频并上传至 OSS
4. WHEN 超分视频上传 OSS 成功, THE Upscale_Worker SHALL 正式扣除冻结积分（CHARGE）并更新项目导出状态为已完成
5. IF WaveSpeed_API 返回处理失败, THEN THE Upscale_Worker SHALL 返还冻结积分（REFUND）并将项目导出状态标记为失败
6. IF 轮询超时（超过 120 次仍未完成）, THEN THE Upscale_Worker SHALL 返还冻结积分（REFUND）并将项目导出状态标记为超时失败

### Requirement 5: 超分任务容错与重试

**User Story:** As a 系统, I want to 在超分过程中处理各种异常, so that 用户积分不会因系统错误而丢失

#### Acceptance Criteria

1. IF WaveSpeed_API 请求返回 HTTP 5xx 错误, THEN THE Upscale_Worker SHALL 按指数退避策略重试，最多重试 3 次
2. IF WaveSpeed_API 请求返回 HTTP 429（限流）, THEN THE Upscale_Worker SHALL 等待 30 秒后重试
3. IF 超分后视频下载或上传 OSS 失败, THEN THE Upscale_Worker SHALL 重试 2 次（间隔 5 秒），全部失败后返还冻结积分并标记失败
4. THE Upscale_Worker SHALL 通过 projectId 实现扣费幂等性（同一项目同时只允许一个活跃导出），防止队列重试导致重复扣费

### Requirement 6: 导出状态追踪

**User Story:** As a 用户, I want to 查看导出进度和状态, so that 我知道视频何时可以下载

#### Acceptance Criteria

1. THE Export_Service SHALL 维护导出状态字段，取值为 MERGING、UPSCALING、COMPLETED、FAILED
2. WHEN 导出任务创建, THE Export_Service SHALL 将项目状态设为 MERGING
3. WHEN 合并完成且需要超分, THE Export_Service SHALL 将项目状态设为 UPSCALING
4. WHEN 超分完成或 480p 合并完成, THE Export_Service SHALL 将项目状态设为 COMPLETED 并记录最终视频 URL
5. IF 任何阶段失败, THEN THE Export_Service SHALL 将项目状态设为 FAILED 并记录失败原因

### Requirement 7: 积分定价规则

**User Story:** As a 产品运营, I want to 按分辨率阶梯收费, so that 超分成本能被合理覆盖且对用户友好

#### Acceptance Criteria

1. THE Export_Service SHALL 对 480p 导出不收取额外积分（合并导出免费）
2. THE Export_Service SHALL 对 720p 导出按 ceil(视频时长秒数 × 1) 计算积分消耗
3. THE Export_Service SHALL 对 1080p 导出按 ceil(视频时长秒数 × 2) 计算积分消耗
4. THE Export_Service SHALL 在响应中返回本次导出预估消耗的积分数，供前端展示确认

