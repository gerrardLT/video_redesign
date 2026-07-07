# Implementation Plan: 双模型生成引擎 (Dual Model Generation)

## Overview

将视频生成管线从单一 Seedance 2.0 扩展为 Seedance 2.0 + HappyHorse 双引擎可选架构。实现顺序：数据库模型 → 核心服务层 → Worker 扩展 → API 接口 → 前端引擎选择 UI。每一步增量构建，确保 Seedance 原有管线不受影响。

## Tasks

- [x] 1. 数据库模型扩展与迁移
  - [x] 1.1 扩展 Prisma Schema 新增引擎相关字段
    - 在 `Project` 模型新增 `engine` 字段（String, 默认 `"seedance"`）和 `bgmKey` 字段（String?）
    - 在 `GenerationJob` 模型新增 `engine` 字段（String, 默认 `"seedance"`）、`segmentIndex`（Int?）、`totalSegments`（Int?）
    - 在 `ShotGroup` 模型新增 `backgroundImageUrl` 字段（String?）
    - 执行 `npx prisma migrate dev` 生成迁移文件
    - 确保现有数据迁移后 engine 字段默认为 `seedance`
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [x] 2. HappyHorse API 客户端
  - [x] 2.1 实现 HappyHorse API 客户端模块 (`src/lib/happyhorse.ts`)
    - 实现 `createHappyHorseTask` 函数：构建 DashScope V-Edit 请求体，发送异步任务创建请求
    - 实现 `getHappyHorseTaskStatus` 函数：轮询任务状态，解析成功/失败响应
    - 请求体固定参数：model="happyhorse-1.0-video-edit", watermark=false, resolution="720P", audio_setting="origin"
    - 请求头必须包含 `X-DashScope-Async: enable` 和 `Authorization: Bearer $DASHSCOPE_API_KEY`
    - media 数组支持 1 个 video + 0-5 个 reference_image
    - `DASHSCOPE_API_KEY` 缺失时直接抛错
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 5.2, 5.3, 5.4_

  - [x]* 2.2 写属性测试：HappyHorse 请求体不变量
    - **Property 2: HappyHorse 请求体不变量**
    - 验证任何合法参数组合构建的请求体必须满足固定字段约束
    - **Validates: Requirements 5.2, 5.3, 5.4, 7.6**

  - [x]* 2.3 写属性测试：参考图数量上限
    - **Property 3: 参考图数量上限**
    - 验证任何长度 N 的参考图列表，实际发送的 reference_image 项数为 min(N, 5)
    - **Validates: Requirements 5.5**

  - [x]* 2.4 写属性测试：HappyHorse 错误响应解析
    - **Property 10: HappyHorse 错误响应解析**
    - 验证失败响应体中的 code 和 message 被完整保留
    - **Validates: Requirements 7.4**

- [x] 3. HappyHorse 积分计费
  - [x] 3.1 实现 HappyHorse 积分计算模块 (`src/lib/credit-calc.ts`)
    - 实现 `estimateHappyHorseCreditCost(inputDuration)` 预估函数
    - 实现 `calculateHappyHorseActualCost(inputDuration, outputDuration)` 结算函数
    - 公式: `ceil((inputDuration + min(inputDuration, 15)) × HAPPYHORSE_CREDIT_COEFFICIENT)`
    - 系数通过环境变量 `HAPPYHORSE_CREDIT_COEFFICIENT` 配置，默认 1.5
    - _Requirements: 8.2, 8.3, 8.5_

  - [x]* 3.2 写属性测试：HappyHorse 积分计算公式正确性
    - **Property 8: HappyHorse 积分计算公式正确性**
    - 验证任何正数输入时长计算结果为正整数且等于公式值
    - **Validates: Requirements 8.2**

  - [x] 3.3 扩展 credit-service 支持双轨计费
    - 在 `src/lib/credit-service.ts` 中新增 HappyHorse 模式的 RESERVE/CHARGE/REFUND 逻辑
    - 预检逻辑：余额不足时拒绝并抛出 `INSUFFICIENT_CREDITS` 错误
    - 结算逻辑：多退少补（实际消耗 vs 预估冻结差额处理）
    - _Requirements: 8.1, 8.3, 8.4, 8.5_

  - [x]* 3.4 写属性测试：余额不足必拒绝
    - **Property 9: 余额不足必拒绝**
    - 验证任何余额 < 预估消耗的组合必抛出 INSUFFICIENT_CREDITS
    - **Validates: Requirements 8.4**

- [ ] 4. Checkpoint - 确保所有测试通过
  - 确保所有测试通过，ask the user if questions arise.

- [x] 5. 视频分段服务
  - [x] 5.1 实现视频分段服务 (`src/lib/segment-service.ts`)
    - 实现 `segmentVideo` 函数：基于 FFmpeg 场景检测将长视频分为 ≤15 秒的片段
    - 贪心算法：从当前位置起，找距离 15s 最近的场景切割点
    - 15s 窗口内无切割点则强制切割
    - 最后一段 < 3s 时并入前一段
    - 场景检测失败时回退到固定 15s 均匀切割
    - _Requirements: 6.1, 6.4_

  - [x] 5.2 实现分段裁切与合并函数
    - 实现 `cutVideoSegments` 函数：FFmpeg -ss/-to 精确裁切，-c copy 不重新编码
    - 实现 `mergeSegments` 函数：FFmpeg concat demuxer 无损拼接
    - _Requirements: 6.2, 6.3_

  - [x]* 5.3 写属性测试：分段算法 — 每段不超过 15 秒
    - **Property 4: 分段算法 — 每段不超过 15 秒**
    - 验证任意输入的每个分段 duration ≤ 15
    - **Validates: Requirements 6.1**

  - [x]* 5.4 写属性测试：分段算法 — 覆盖完整时长
    - **Property 5: 分段算法 — 覆盖完整时长**
    - 验证第一段 startTime=0，最后一段 endTime=totalDuration，相邻段首尾相接
    - **Validates: Requirements 6.1, 6.3**

  - [x]* 5.5 写属性测试：分段算法 — 最短段约束
    - **Property 6: 分段算法 — 最短段约束**
    - 验证每个分段 duration ≥ 3 秒
    - **Validates: Requirements 6.1**

- [x] 6. HappyHorse 生成编排器
  - [x] 6.1 扩展生成编排器支持 HappyHorse 模式 (`src/lib/generation-orchestrator.ts`)
    - 实现 `orchestrateHappyHorseGeneration` 函数
    - 短视频（3-15s）：直接创建单个 GenerationJob 并入队
    - 长视频（>15s）：调用分段服务分段后为每段创建 GenerationJob，链式串行入队第一段
    - 积分预估 + withCreditLock 原子冻结
    - _Requirements: 5.1, 6.1, 6.2, 8.3_

  - [x]* 6.2 写属性测试：短视频路径选择
    - **Property 7: 短视频路径选择**
    - 验证 engine=happyhorse 且时长在 [3,15] 时选择 direct 模式
    - **Validates: Requirements 5.1**

  - [x]* 6.3 写属性测试：引擎字段验证
    - **Property 1: 引擎字段验证**
    - 验证引擎验证函数仅接受 "seedance" 或 "happyhorse"
    - **Validates: Requirements 1.1**

- [x] 7. Generate-Video Worker HappyHorse 分支
  - [x] 7.1 扩展 generate-video Worker 支持 HappyHorse 引擎 (`src/workers/generate-video.ts`)
    - 在 `processVideoGenerate` 中新增 engine 分支路由
    - 实现 `processHappyHorseGenerate` 函数：创建任务→轮询（5s 间隔，10min 超时）→下载→验证 MP4→上传 OSS→抽帧封面→扣费→创建 Asset
    - 分段模式：完成当前段后触发下一段（链式续接），全部完成后触发合并
    - 结果视频从 DashScope URL 立即下载转存 OSS（24h 过期保护）
    - 下载失败重试 3 次（间隔 2s）
    - _Requirements: 5.1, 5.2, 6.2, 6.5, 7.3, 10.1, 10.2, 10.3, 10.4_

  - [x]* 7.2 写单元测试：Worker 引擎路由分发
    - 验证 engine=seedance 走原有逻辑，engine=happyhorse 走新分支
    - Mock DashScope API 验证完整链路
    - _Requirements: 2.1, 5.1_

- [ ] 8. Checkpoint - 确保所有测试通过
  - 确保所有测试通过，ask the user if questions arise.

- [x] 9. Seedance 增强 — 背景图与背景音乐
  - [x] 9.1 实现背景图上传 API 和注入逻辑
    - 新增 `POST /api/projects/:id/background-image` 路由
    - 接收 multipart/form-data 上传图片（JPEG/PNG/WEBP, ≤10MB）
    - 上传至 OSS 并将 URL 写入 `ShotGroup.backgroundImageUrl`
    - 修改 Seedance 请求构建逻辑：将 backgroundImageUrl 加入 content 数组的 reference_image 列表
    - _Requirements: 3.1, 3.2, 3.3_

  - [x]* 9.2 写属性测试：背景图注入到 Seedance 请求
    - **Property 11: 背景图注入到 Seedance 请求**
    - 验证设置了 backgroundImageUrl 的分镜组请求体包含对应 reference_image 项
    - **Validates: Requirements 3.3**

  - [x] 9.3 实现背景音乐上传 API 和合并替换逻辑
    - 新增 `POST /api/projects/:id/background-music` 路由
    - 接收 multipart/form-data 上传音频（MP3/WAV/AAC, ≤50MB）
    - 上传至 OSS 并将 ossKey 写入 `Project.bgmKey`
    - _Requirements: 4.1, 4.2_

  - [x] 9.4 扩展 merge-video Worker 支持背景音乐替换
    - 合并时检查 `Project.bgmKey`：若存在，下载 BGM → FFmpeg 替换原音轨
    - FFmpeg 命令: `-i video -i bgm -map 0:v -map 1:a -c:v copy -shortest`
    - _Requirements: 4.3_

  - [x]* 9.5 写属性测试：背景音乐替换合并命令
    - **Property 12: 背景音乐替换合并命令**
    - 验证设置了 bgmKey 的项目合并命令包含正确的 FFmpeg 参数
    - **Validates: Requirements 4.3**

- [x] 10. 引擎选择 API 与前端 UI
  - [x] 10.1 实现引擎切换 API (`PATCH /api/projects/:id/engine`)
    - Zod 校验 engine 取值为 "seedance" 或 "happyhorse"
    - 更新 Project.engine 字段
    - 默认值为 "seedance"
    - _Requirements: 1.1, 1.4, 1.5_

  - [x] 10.2 实现 HappyHorse 生成入口 API (`POST /api/projects/:id/generate-happyhorse`)
    - 接收 prompt + referenceImages 参数
    - 调用 orchestrateHappyHorseGeneration 编排
    - 返回 mode/totalSegments/totalCost/jobs
    - 余额不足返回 402
    - _Requirements: 5.1, 5.2, 5.5, 5.6, 8.3, 8.4_

  - [x] 10.5 修改现有生成路由支持 engine 参数转发 (`POST /api/projects/:id/generate`)
    - 在现有 generate 路由中新增可选 `engine` 参数（默认使用 Project.engine）
    - 当 `engine === 'happyhorse'` 时，转发到 HappyHorse 编排逻辑（调用 orchestrateHappyHorseGeneration）
    - 当 `engine === 'seedance'` 或未传时，保持原有 Seedance 编排逻辑不变
    - _Requirements: 1.1, 1.4, 2.1_

  - [x] 10.3 实现引擎选择前端组件
    - 在项目编辑器中添加引擎选择 UI（单选切换）
    - Seedance 标注"不支持真人脸（会被审核拦截）"
    - HappyHorse 标注"支持真人脸"
    - 选择后调用 PATCH API 更新项目引擎
    - _Requirements: 1.2, 1.3, 1.4_

  - [x] 10.4 实现 HappyHorse 生成参考图上传和 prompt 输入 UI
    - 参考图上传组件：最多 5 张，支持 JPEG/PNG/WEBP，单张 ≤20MB
    - prompt 输入框：支持 `[Image N]` 语法引用参考图
    - 生成按钮调用 generate-happyhorse API
    - _Requirements: 5.5, 5.6_

- [x] 11. HappyHorse 分段合并与资产管理
  - [x] 11.1 扩展 merge-video Worker 支持 HappyHorse 分段合并
    - HappyHorse 分段合并：接收各段 OSS URL，FFmpeg concat 无损拼接
    - 不需要转场效果（场景切割点已自然衔接）
    - 合并后视频作为最终结果记录到 GenerationJob
    - _Requirements: 6.3, 10.4_

  - [x] 11.2 确保 HappyHorse 生成资产统一管理
    - HappyHorse 生成的视频抽取封面帧（FFmpeg）用于预览
    - 应用 14 天过期策略（复用 asset-lifecycle-service）
    - 生成结果存入项目 OSS 目录
    - _Requirements: 10.1, 10.2, 10.3_

- [x] 12. 环境变量配置与集成验证
  - [x] 12.1 更新环境变量配置和文档
    - 在 `.env.example` 和 `.env.production.example` 中添加 `DASHSCOPE_API_KEY` 和 `HAPPYHORSE_CREDIT_COEFFICIENT`
    - 在 happyhorse.ts 启动时校验 `DASHSCOPE_API_KEY` 存在性
    - _Requirements: 7.5_

  - [x]* 12.2 写集成测试：Seedance 管线回归验证
    - 验证 engine=seedance 完整路径不受影响
    - 验证引擎字段默认值行为
    - _Requirements: 2.1, 2.2, 2.3, 9.4_

- [ ] 13. Final Checkpoint - 确保所有测试通过
  - 确保所有测试通过，ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- 每个任务引用具体的 requirements 子条目确保可追溯
- Checkpoints 确保增量验证，避免后期发现基础层问题
- Property tests 使用 fast-check 库，文件命名 `*.property.test.ts`
- 所有代码使用 TypeScript（与设计文档一致）
- Seedance 原有管线不做任何修改，仅新增分支和字段
- HappyHorse 结果 URL 24 小时过期，Worker 中必须立即下载转存

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "5.1", "12.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "3.2", "3.3", "5.2"] },
    { "id": 3, "tasks": ["3.4", "5.3", "5.4", "5.5", "6.1"] },
    { "id": 4, "tasks": ["6.2", "6.3", "7.1", "9.1"] },
    { "id": 5, "tasks": ["7.2", "9.2", "9.3"] },
    { "id": 6, "tasks": ["9.4", "9.5", "10.1", "10.2", "10.5"] },
    { "id": 7, "tasks": ["10.3", "10.4", "11.1"] },
    { "id": 8, "tasks": ["11.2", "12.2"] }
  ]
}
```
