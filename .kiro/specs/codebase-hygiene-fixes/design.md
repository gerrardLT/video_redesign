# Design Document

## Overview

本设计覆盖三项并行的代码卫生修复：

1. **测试文件重写**：将三个包含 SQLite 语义的测试文件（单元测试 + 两个属性测试）完全重写为 PostgreSQL 事务冲突语义
2. **Schema 注释清理**：移除 `prisma/schema.prisma` 中引用 SQLite 限制的过时注释
3. **src/lib 域重组**：将 ~85 个平铺模块按业务域迁移至 `video/`、`merchant/`、`shared/` 三个子目录，更新全部 import 路径

三项工作互相独立，但共享一个验证标准：`tsc --noEmit` 通过 + `pnpm test` 全绿。

## Architecture

### 域分层模型

```
src/lib/
├── video/              # 视频重绘产品线（~23 模块）
├── merchant/           # 本地生活商家平台（~30 模块）
├── shared/             # 跨产品线共享基础设施（~40 模块）
├── platform-fetchers/  # 保持原位（已有子目录）
├── sse/                # 保持原位
├── validations/        # 保持原位
├── validators/         # 保持原位
└── __tests__/          # 保持原位
```

### 域归属决策原则

| 域 | 归属标准 | 典型模块 |
|---|---|---|
| `video/` | 仅被视频重绘产品线调用，或实现视频处理核心逻辑 | seedance.ts, ffmpeg.ts, frame-continuity.ts |
| `merchant/` | 仅被商家平台调用，或实现商家业务逻辑 | merchant-auth.ts, store-profile-service.ts, compliance-service.ts |
| `shared/` | 被两个产品线共同依赖，或属于基础设施 | db.ts, redis.ts, auth.ts, credit-service.ts, queue.ts |

### Import 路径迁移规则

所有 `@/lib/module-name` 形式的 import 语句按以下规则重写：

```typescript
// Before
import { withRetry } from '@/lib/db-retry'
import { seedanceGenerate } from '@/lib/seedance'
import { storeProfileService } from '@/lib/store-profile-service'

// After
import { withRetry } from '@/lib/shared/db-retry'
import { seedanceGenerate } from '@/lib/video/seedance'
import { storeProfileService } from '@/lib/merchant/store-profile-service'
```

已有子目录（`platform-fetchers/`、`sse/`、`validations/`、`validators/`、`__tests__/`）保持原位不动，其 import 路径不变。

## Components

### Component 1: 单元测试重写 (`tests/unit/db-retry.test.ts`)

**现状问题**：
- 导入 `isSQLiteLockError`（已不存在，当前导出为 `isRetriableError`）
- RETRY_CONFIG.delays 断言为 `[500, 1000, 1500]`（实际为 `[200, 500, 1000]`）
- 所有测试用例使用 "SQLITE_BUSY"/"database is locked" 错误消息

**重写策略**：完全重写文件，导入正确的 `{isRetriableError, withRetry, RETRY_CONFIG, _internals}`，使用 PostgreSQL 错误特征 `P2034`、`deadlock detected`、`could not serialize access`。

```typescript
// tests/unit/db-retry.test.ts — 核心结构
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isRetriableError, withRetry, RETRY_CONFIG, _internals } from '@/lib/shared/db-retry'

describe('isRetriableError', () => {
  // 正面用例：P2034, deadlock detected, could not serialize access → true
  // 反面用例：其他 Error → false, 非 Error 类型 → false
})

describe('RETRY_CONFIG', () => {
  // maxRetries === 3, delays === [200, 500, 1000]
})

describe('withRetry', () => {
  // 注入零延迟 sleep，验证：
  // - 首次成功 → 直接返回
  // - 非可重试错误 → 立即抛出
  // - N 次可重试后恢复 → sleep 序列正确
  // - 4 次可重试 → 抛出最后一次错误
})
```

### Component 2: 属性测试 A 重写 (`src/__tests__/properties/db-retry.property.test.ts`)

**现状问题**：
- 文件头注释描述 "SQLite retry semantics"
- 生成器使用 SQLITE_BUSY、database is locked
- 断言延迟序列 [500, 1000, 1500]

**重写策略**：完全重写，使用 PostgreSQL 重试语义生成器。

```typescript
// 生成器定义
const retriableErrorMessageArb = fc.oneof(
  fc.constant('P2034: Transaction failed due to a write conflict'),
  fc.constant('deadlock detected'),
  fc.constant('could not serialize access'),
  fc.string().map(s => `P2034: ${s}`),                    // P2034 + 随机后缀
  fc.string().map(s => `deadlock detected: ${s}`),         // deadlock + 随机上下文
  fc.string().map(s => `could not serialize access: ${s}`) // serialization + 随机上下文
)

const nonRetriableErrorMessageArb = fc.string({ minLength: 1 }).filter(
  s => !s.includes('P2034') && 
       !s.includes('deadlock detected') && 
       !s.includes('could not serialize access')
)
```

### Component 3: 属性测试 B 重写 (`tests/properties/idempotent-cleanup.property.test.ts`)

**现状问题**：
- 模拟 deleteMany 失败时使用 `'SQLITE_BUSY: database is locked'`

**重写策略**：保留全部幂等性验证逻辑（清理顺序、失败隔离、跨项目隔离、二次清理等价性），仅将错误消息替换为 PostgreSQL 语义。

```typescript
// 替换前
return { callOrder, finalStore, error: new Error('SQLITE_BUSY: database is locked') }

// 替换后
return { callOrder, finalStore, error: new Error('P2034: Transaction failed due to a write conflict') }
```

### Component 4: Schema 注释清理 (`prisma/schema.prisma`)

**现状**：
```prisma
dialogue  String? // JSON 字符串，SQLite 无 JSON 类型
```

**目标**：
```prisma
dialogue  String? // JSON 字符串，存储对话/台词信息
```

### Component 5: src/lib 域重组

**域映射表**：

#### video/ (视频重绘)

| 模块文件 | 职责 |
|---|---|
| seedance.ts | Seedance 2.0 API 客户端 |
| video-analyzer.ts | AI 视频多模态分析 |
| ffmpeg.ts | FFmpeg 操作封装 |
| frame-continuity.ts | 同场景尾帧承接 |
| transition-engine.ts | 转场引擎 |
| grouping-service.ts | 分镜分组算法 |
| script-merger.ts | 时间轴脚本合并 |
| generation-orchestrator.ts | 生成编排器 |
| group-gen-context.ts | 分镜组生成上下文 |
| wavespeed.ts | WaveSpeed 超分 API |
| segment-concat.ts | 片段拼接 |
| segment-service.ts | 片段服务 |
| workspace-generation-service.ts | 工作台生成服务 |
| workspace-request-builder.ts | 工作台请求构建 |
| workspace-validators.ts | 工作台校验器 |
| version-history-service.ts | 版本历史服务 |
| frame-calculator.ts | 帧计算器 |
| boundary-snapper.ts | 边界对齐 |
| reference-builder.ts | 参考图构建 |
| render-pipeline.ts | 渲染管线 |
| preview-transform.ts | 预览变换 |
| prompt-parser.ts | 提示词解析 |
| shot-schema.ts | 分镜结构定义 |
| appearance-comparator.ts | 外观比对 |

#### merchant/ (本地生活商家平台)

| 模块文件 | 职责 |
|---|---|
| merchant-auth.ts | 商家身份鉴权 |
| store-profile-service.ts | 门店画像 |
| playbook-engine.ts | 行业剧本 |
| content-calendar-service.ts | 内容日历 |
| capture-director.ts | 拍摄任务 |
| local-render-service.ts | 本地素材合成 |
| ai-auto-render-service.ts | 一键 AI 出片 |
| compliance-service.ts | 合规检查 |
| content-entropy-service.ts | 内容同质化检测 |
| copy-generator.ts | 发布文案生成 |
| publish-copy-service.ts | 发布文案服务 |
| publish-queue-service.ts | 待发布清单 |
| metrics-ingestor.ts | 数据录入 |
| platform-metrics-crawler.ts | 平台数据抓取 |
| performance-learning-service.ts | 数据复盘 |
| merchant-billing-service.ts | 商家计费 |
| merchant-context-builder.ts | 商家上下文构建 |
| merchant-templates.ts | 商家模板 |
| content-brief-api-error.ts | 内容简报 API 错误 |
| content-brief-state-machine.ts | 内容简报状态机 |
| content-score-service.ts | 内容评分 |
| cross-store-service.ts | 跨门店服务 |
| engagement-service.ts | 互动服务 |
| impact-scope-service.ts | 影响范围 |
| matrix-dispatch-service.ts | 矩阵分发 |
| poi-injection-service.ts | POI 注入 |
| sensitive-words.ts | 违禁词库 |
| platform-presets.ts | 平台预设 |
| trending-video-analyzer.ts | 热门视频分析 |
| task-center-service.ts | 任务中心 |
| period-service.ts | 周期服务 |

#### shared/ (共享基础设施)

| 模块文件 | 职责 |
|---|---|
| db.ts | Prisma 客户端实例 |
| db-retry.ts | PostgreSQL 事务冲突重试 |
| redis.ts | Redis 连接 |
| queue.ts | BullMQ 队列定义 |
| auth.ts | 认证逻辑 |
| auth-helpers.ts | 认证辅助 |
| logger.ts | 结构化日志 |
| storage.ts | OSS 存储操作 |
| distributed-lock.ts | Redis 分布式锁 |
| concurrency-controller.ts | 并发计数器 |
| credit-service.ts | 积分系统 |
| credit-calc.ts | 积分计算 |
| credit-dispatcher.ts | 积分分发 |
| priority-scheduler.ts | 优先级调度器 |
| privilege-engine.ts | 用户特权引擎 |
| progress-publisher.ts | 进度事件发布 |
| rate-limiter.ts | 速率限制 |
| subscription-service.ts | 订阅会员 |
| notification-service.ts | 通知推送 |
| order-service.ts | 订单服务 |
| onboarding-service.ts | 新手引导 |
| api-client.ts | API 客户端 |
| api-error.ts | API 错误定义 |
| utils.ts | 通用工具函数 |
| expiry-status.ts | 过期状态 |
| state-machine.ts | 通用状态机 |
| stepper-navigation.ts | 步进导航 |
| placeholder-utils.ts | 占位符工具 |
| validate-share-link.ts | 分享链接校验 |
| asset-ingestion-service.ts | 资产导入 |
| asset-library-service.ts | 资产库 |
| asset-lifecycle-service.ts | 资产生命周期 |
| face-detection-service.ts | 人脸检测 |
| flux.ts | Seedream 文生图/图生图 |
| help-center-service.ts | 帮助中心 |
| sample-project-service.ts | 示例项目 |
| showcase-service.ts | 案例展示 |
| style-service.ts | 风格服务 |
| video-import-service.ts | 视频导入 |
| happyhorse.ts | HappyHorse 集成 |
| happyhorse-workspace.ts | HappyHorse 工作台 |
| script-hash.ts | 脚本哈希 |

## Implementation Strategy

### 执行顺序

1. **Phase A**：测试文件重写 + Schema 注释清理（无 import 路径变更，可立即验证）
2. **Phase B**：src/lib 域重组 + import 路径更新（批量迁移，最后统一验证）

Phase A 和 Phase B 可以在不同分支上并行开发，但合并时需注意测试文件中的 import 路径需反映最终域位置。

### Import 路径更新策略

采用**全量搜索替换 + 编译验证**策略：

1. 对每个被迁移的模块，在项目中搜索 `@/lib/{module-name}`
2. 替换为 `@/lib/{domain}/{module-name}`
3. 替换完毕后执行 `tsc --noEmit` 验证无遗漏
4. 执行 `pnpm test` 验证运行时行为不变

### 边界文件处理

- `src/lib/__tests__/` 目录保持原位，但其内部 import 路径同样需要更新
- Worker 文件（`src/workers/`）中的 `@/lib/xxx` import 全部需要更新
- API 路由（`src/app/api/`）中的 import 全部需要更新
- React 组件中通过 `@/lib/xxx` 引用的模块同样需要更新

## Interfaces

### DB_Retry_Module 接口（不变）

```typescript
// src/lib/shared/db-retry.ts — 公开接口不变
export const RETRY_CONFIG: {
  readonly maxRetries: 3
  readonly delays: readonly [200, 500, 1000]
}

export function isRetriableError(error: unknown): boolean

export function withRetry<T>(
  operation: () => Promise<T>,
  label?: string
): Promise<T>

export const _internals: {
  sleep: (ms: number) => Promise<void>
}
```

### 域导出约定

每个子目录**不**创建统一的 `index.ts` barrel 文件。原因：

1. barrel 文件会导致 tree-shaking 效果下降
2. 当前项目的 import 均为直接路径引用（`@/lib/db-retry`），维持此风格更一致
3. 避免循环依赖风险

## Error Handling

### 测试重写中的错误语义

| 错误特征 | 含义 | 是否可重试 |
|---|---|---|
| `P2034` | Prisma 事务写冲突/死锁 | 是 |
| `deadlock detected` | PostgreSQL 死锁检测 | 是 |
| `could not serialize access` | PostgreSQL 序列化隔离冲突 | 是 |
| 其他任何错误 | 非事务冲突 | 否，立即抛出 |
| 非 Error 类型异常 | 非标准异常 | 否，立即抛出 |

### 重组过程中的编译错误处理

若 `tsc --noEmit` 报错，错误类型及修复策略：

| 错误类型 | 原因 | 修复 |
|---|---|---|
| `Cannot find module '@/lib/xxx'` | import 路径未更新 | 搜索旧路径，替换为新路径 |
| `Module has no exported member` | 模块导出名变更 | 核查目标文件 export |
| Circular dependency warning | 域间依赖方向错误 | 将模块调整至正确域 |

## Data Models

本次重构不涉及数据模型变更。Schema 仅修改注释文本，不改变字段定义或迁移状态。

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: isRetriableError 正确识别可重试错误

*For any* Error 对象，若其 message 包含 "P2034"、"deadlock detected" 或 "could not serialize access" 中的任意一个子串，isRetriableError 应返回 true

**Validates: Requirements 1.2, 1.3, 1.4, 2.1**

### Property 2: isRetriableError 拒绝非可重试输入

*For any* 值，若该值不是 Error 实例，或者是 Error 实例但 message 不包含三种可重试特征中的任何一种，isRetriableError 应返回 false

**Validates: Requirements 1.5, 1.6, 2.2**

### Property 3: withRetry 返回值保持不变

*For any* M ∈ [0, 3] 次可重试失败后第 M+1 次成功的操作，以及任意类型的返回值 V，withRetry 应返回与 V 严格相等（===）的值

**Validates: Requirements 1.9, 1.11, 2.3, 2.6**

### Property 4: withRetry 延迟序列正确性

*For any* N ∈ [1, 3] 次可重试失败后恢复的操作，sleep 调用序列应严格等于 [200, 500, 1000] 的前 N 个元素

**Validates: Requirements 1.11, 2.3**

### Property 5: withRetry 非可重试错误立即传播

*For any* 非可重试错误（不匹配三种 PostgreSQL 事务冲突特征），withRetry 应在首次调用时立即抛出该错误，sleep 调用次数为 0，操作调用次数为 1

**Validates: Requirements 1.10, 2.4**

### Property 6: withRetry 重试耗尽后抛出原始错误

*For any* 连续 4 次（1 初始 + 3 重试）可重试错误，withRetry 应抛出最后一次捕获的错误，且 sleep 调用序列为 [200, 500, 1000]

**Validates: Requirements 1.12, 2.5**

### Property 7: withRetry 混合失败序列正确处理

*For any* M ∈ [0, 3] 次可重试失败后紧接一次非可重试错误的操作序列，withRetry 应立即抛出该非可重试错误，总 sleep 次数等于 M，总操作调用次数等于 M+1

**Validates: Requirements 2.7**

### Property 8: 幂等清理完整性与隔离性

*For any* projectId 和任意初始记录数量，执行清理两次的最终状态应与执行一次完全相同（幂等性），且清理过程不影响其他 projectId 的记录（隔离性）

**Validates: Requirements 3.3**
