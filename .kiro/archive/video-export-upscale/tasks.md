# Implementation Plan: 视频导出超分（Video Export Upscale）

## Overview

实现视频导出阶段的分辨率选择与 AI 超分功能。生成阶段统一 480p，导出时用户选择目标分辨率（480p/720p/1080p），高分辨率调用 WaveSpeed AI Video Upscaler 超分，采用「冻结→扣费」积分模型。核心组件：Export API Route、WaveSpeed 客户端、Upscale Worker、积分扩展、Merge Worker 改造。

## Tasks

- [x] 1. 数据库 Schema 扩展与积分服务
  - [x] 1.1 扩展 Project 模型添加导出状态字段
    - 在 Prisma schema 中为 Project 模型添加 `exportStatus`、`exportResolution`、`exportVideoUrl`、`exportError`、`exportCreatedAt` 字段
    - 运行 `prisma migrate dev` 生成迁移文件并应用
    - 确保字段均为可选（nullable），不影响现有数据
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 1.2 实现超分积分计算函数 `estimateUpscaleCreditCost`
    - 在 `src/lib/credit-service.ts` 中新增 `estimateUpscaleCreditCost(duration, targetResolution)` 纯函数
    - 480p 返回 0，720p 返回 `Math.ceil(duration × 1)`，1080p 返回 `Math.ceil(duration × 2)`
    - 导出函数并添加 JSDoc 注释说明积分公式
    - _Requirements: 2.2, 7.1, 7.2, 7.3_

  - [x]* 1.3 编写属性测试：超分积分计算公式正确性
    - **Property 1: 超分积分计算公式正确性**
    - 使用 fast-check 生成随机 duration（0.01~600s）和随机分辨率
    - 验证 480p 返回 0、720p 返回 ceil(duration×1)、1080p 返回 ceil(duration×2)、始终为非负整数
    - 测试文件：`src/__tests__/properties/video-export-upscale.property.test.ts`
    - **Validates: Requirements 2.2, 7.1, 7.2, 7.3**

- [x] 2. WaveSpeed API 客户端与队列扩展
  - [x] 2.1 创建 WaveSpeed API 客户端 `src/lib/wavespeed.ts`
    - 实现 `submitUpscaleTask(params)` 函数：POST 到 WaveSpeed Video Upscaler 端点，传入视频 URL 和目标分辨率
    - 实现 `getUpscaleResult(requestId)` 函数：GET 轮询任务结果
    - 使用环境变量 `WAVESPEED_API_KEY` 和 `WAVESPEED_API_BASE_URL` 配置
    - 添加请求超时、错误码解析、TypeScript 类型定义
    - 在 `.env.example` 中添加 `WAVESPEED_API_KEY` 和 `WAVESPEED_API_BASE_URL` 示例
    - _Requirements: 4.1, 4.2_

  - [x] 2.2 在 `src/lib/queue.ts` 中添加 `videoUpscaleQueue`
    - 新增 `videoUpscaleQueue = lazyQueue('video-upscale', { attempts: 1, removeOnComplete: 50, removeOnFail: 100 })`
    - attempts 设为 1（不由 BullMQ 自动重试，Worker 内部实现精细重试逻辑）
    - _Requirements: 4.1_

- [x] 3. Checkpoint - 确保积分函数和 WaveSpeed 客户端编译通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Export API Route 实现
  - [x] 4.1 创建导出 API 路由 `src/app/api/projects/[id]/export/route.ts`
    - 实现 POST handler：接受 `{ target_resolution }` 请求体
    - 参数校验：target_resolution 必须为 "480p"/"720p"/"1080p"，否则返回 400
    - 鉴权校验：验证项目属于当前用户，否则 404
    - 状态校验：项目必须处于可导出状态（含已生成分镜），否则 409
    - 重复导出校验：已有进行中导出（MERGING/UPSCALING）则返回 409
    - 当 target_resolution 为 720p/1080p 时：计算积分、余额预检（402）、冻结积分（RESERVE）
    - 入队 video-merge 任务，携带 target_resolution 字段
    - 更新项目 exportStatus 为 MERGING，记录 exportResolution 和 exportCreatedAt
    - 返回 202 Accepted：`{ exportId, status, targetResolution, estimatedCredits, currentBalance }`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 6.2, 7.4_

  - [x]* 4.2 编写属性测试：非法分辨率参数拒绝
    - **Property 2: 非法分辨率参数拒绝**
    - 使用 fast-check 生成任意字符串（排除 "480p"/"720p"/"1080p"），验证参数校验逻辑返回拒绝
    - 验证无副作用（无队列入队、无积分变动）
    - 测试文件：`src/__tests__/properties/video-export-upscale.property.test.ts`
    - **Validates: Requirements 1.2**

  - [x]* 4.3 编写属性测试：余额不足时拒绝导出
    - **Property 3: 余额不足时拒绝导出**
    - 使用 fast-check 生成随机 balance 和 cost 组合，当 balance < cost 且 cost > 0 时验证拒绝
    - 验证无积分冻结流水产生
    - 测试文件：`src/__tests__/properties/video-export-upscale.property.test.ts`
    - **Validates: Requirements 2.3**

- [x] 5. Merge Worker 改造
  - [x] 5.1 改造 `src/workers/merge-video.ts` 支持导出超分流程
    - 在 `VideoMergeJobData` 接口中新增 `targetResolution?: '480p' | '720p' | '1080p'` 字段
    - 合并统一以 480p 分辨率输出（硬编码 outputResolution 为 '480p'，忽略 jobData 中的 outputResolution 用于超分场景）
    - 合并完成后判断 `targetResolution`：
      - 若为 "480p" 或未指定：保持现有逻辑（EXPORTED/COMPLETED）
      - 若为 "720p"/"1080p"：上传 480p 合并视频到 OSS 后，入队 `videoUpscaleQueue` 任务，更新 exportStatus 为 UPSCALING
    - 超分入队时传入：projectId、userId、mergedVideoOssUrl、targetResolution、reservedCredits、videoDuration
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 6. Upscale Worker 实现
  - [x] 6.1 创建超分 Worker `src/workers/upscale-video.ts`
    - 定义 `VideoUpscaleJobData` 接口
    - 实现主处理函数 `processUpscaleVideo(job)`：
      1. 调用 `submitUpscaleTask` 提交超分任务到 WaveSpeed
      2. 轮询 `getUpscaleResult`（间隔 5 秒，最大 120 次/10 分钟超时）
      3. 处理 WaveSpeed API 5xx（指数退避重试 3 次：2s, 4s, 8s）
      4. 处理 429 限流（等待 30s 后重试 1 次）
      5. 成功：下载超分视频 → 上传 OSS → 正式扣费（chargeCreditsTx，按 projectId 幂等） → 更新 exportStatus=COMPLETED 并记录 exportVideoUrl
      6. 失败/超时：返还冻结积分（refundCredits） → 更新 exportStatus=FAILED 并记录 exportError
    - 下载/上传 OSS 失败时重试 2 次（间隔 5s），全部失败后退款标记失败
    - 创建 BullMQ Worker 实例监听 `video-upscale` 队列
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 6.3, 6.4, 6.5_

  - [x]* 6.2 编写属性测试：扣费幂等性
    - **Property 4: 扣费幂等性**
    - 使用 mock Prisma 客户端模拟 `chargeCreditsTx` 被多次调用的场景
    - 验证无论调用多少次（≥1），CHARGE 类型流水记录恰好一条，余额最终变动量恰好等于一次扣费额度
    - 测试文件：`src/__tests__/properties/video-export-upscale.property.test.ts`
    - **Validates: Requirements 4.4, 5.4**

  - [x]* 6.3 编写属性测试：退款幂等性
    - **Property 5: 退款幂等性**
    - 使用 mock Prisma 客户端模拟 `refundCredits` 被多次调用的场景
    - 验证若之前存在 RESERVE 记录，无论调用多少次（≥1），REFUND 类型流水恰好一条，余额最终变动量恰好等于一次退款额度
    - 测试文件：`src/__tests__/properties/video-export-upscale.property.test.ts`
    - **Validates: Requirements 4.5, 4.6**

- [x] 7. Checkpoint - 确保 Worker 编译通过且属性测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Worker 注册与集成联调
  - [x] 8.1 在 `src/workers/index.ts` 中注册 Upscale Worker
    - 添加 `await import('./upscale-video')` 并打印启动日志
    - 遵循现有 Worker 注册模式（try/catch + console.log/error）
    - _Requirements: 4.1_

  - [x] 8.2 添加环境变量配置并更新 `.env.example`
    - 在 `.env.example` 和 `.env.production.example` 中添加 `WAVESPEED_API_KEY` 和 `WAVESPEED_API_BASE_URL`
    - 在 WaveSpeed 客户端中增加启动时环境变量校验（缺失 API Key 时抛出明确错误）
    - _Requirements: 4.1_

  - [x]* 8.3 编写单元测试覆盖关键路径
    - 测试 Export API Route 的参数校验逻辑（400/402/404/409 场景）
    - 测试 WaveSpeed 客户端的请求构造和响应解析
    - 测试导出状态流转的正确性（MERGING → UPSCALING → COMPLETED / FAILED）
    - 测试文件：`src/__tests__/unit/video-export-upscale.test.ts`
    - _Requirements: 1.2, 2.3, 4.5, 6.1_

- [x] 9. Final Checkpoint - 确保全部测试通过，功能联通
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties（使用 fast-check ^4.8.0，项目已安装）
- Unit tests validate specific examples and edge cases
- 测试命令：`pnpm test`（vitest run）
- 合并阶段统一 480p 输出是本次改造的关键变更点，需注意与现有 outputResolution 参数的兼容处理
- WaveSpeed API 采用轮询模式与现有 Seedance 轮询一致，简化部署
- 积分操作复用现有 `reserveCredits` / `chargeCreditsTx` / `refundCredits`，通过 projectId 关联实现幂等

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1", "2.2"] },
    { "id": 1, "tasks": ["1.3", "4.1"] },
    { "id": 2, "tasks": ["4.2", "4.3", "5.1"] },
    { "id": 3, "tasks": ["6.1"] },
    { "id": 4, "tasks": ["6.2", "6.3", "8.1", "8.2"] },
    { "id": 5, "tasks": ["8.3"] }
  ]
}
```
