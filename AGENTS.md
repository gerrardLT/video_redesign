# Video Redesign — AI 视频重绘平台

## 项目概述

AI 视频重绘 SaaS 平台：用户上传短视频 → AI 多模态解析为分镜脚本 → 用户编辑/调整分镜内容 → Seedance 2.0 逐组生成新视频 → 合并导出。

## 技术栈

- **框架**: Next.js 15.5 (App Router, standalone output, Turbopack dev)
- **语言**: TypeScript 5, 严格模式
- **运行时**: Node 22
- **包管理**: pnpm 10 (monorepo-free, single package)
- **UI**: React 19, Tailwind CSS v4, shadcn/ui, lucide-react, tw-animate-css
- **状态管理**: Zustand 5 (客户端), SWR (服务端数据)
- **数据库**: PostgreSQL 16 (@prisma/adapter-pg), Prisma 7.8 ORM
- **队列**: BullMQ + Redis 7 (ioredis)
- **对象存储**: 阿里云 OSS (ali-oss)
- **视频处理**: FFmpeg (场景检测/Normalize/音频切片/缩略图), yt-dlp (链接下载)
- **AI 服务**:
  - 火山引擎方舟 Seedance 2.0 (视频生成)
  - 多模态视频直传分析 (OpenAI 兼容接口, qwen-vl-max 等)
  - Flux (人物形象生成)
  - WaveSpeed (视频超分)
- **认证**: JWT (jose) + Cookie, bcryptjs 密码哈希
- **校验**: Zod v4
- **测试**: Vitest 4 + fast-check (属性测试), @testing-library/react
- **部署**: Docker (multi-stage), docker-compose, 宝塔面板

## 项目结构

```
src/
├── app/                    # Next.js App Router 页面和 API 路由
│   ├── (auth)/             # 登录/注册页面（公开）
│   ├── admin/              # 管理后台页面
│   ├── api/                # 所有 REST API 路由（Next.js Route Handlers）
│   ├── dashboard/          # 用户仪表盘（项目列表）
│   ├── help/               # 帮助中心页面
│   └── showcase/           # 案例展示页面
├── components/             # React 组件
│   ├── ui/                 # shadcn/ui 基础组件
│   ├── editor/             # 视频编辑器组件（分镜编辑、版本历史）
│   ├── project/            # 项目管理组件
│   ├── shot/               # 分镜相关组件
│   ├── subscription/       # 订阅/会员组件
│   └── onboarding/         # 新手引导组件
├── lib/                    # 核心业务逻辑（后端服务层）
│   ├── seedance.ts         # Seedance 2.0 API 客户端
│   ├── video-analyzer.ts   # AI 视频多模态分析
│   ├── ffmpeg.ts           # FFmpeg 操作封装
│   ├── storage.ts          # OSS 存储操作（私有访问+签名URL）
│   ├── grouping-service.ts # 分镜分组算法
│   ├── script-merger.ts    # 时间轴脚本合并
│   ├── credit-service.ts   # 积分系统（RESERVE/CHARGE/REFUND）
│   ├── distributed-lock.ts # Redis 分布式锁（生成锁+全局积分写锁）
│   ├── concurrency-controller.ts # Redis 原子并发计数器（入队门控）
│   ├── generation-orchestrator.ts # 生成编排器（链式串行+批量冻结）
│   ├── priority-scheduler.ts # 优先级调度器（按用户等级设队列优先级）
│   ├── privilege-engine.ts # 用户特权引擎（等级→并发/优先级配置）
│   ├── group-gen-context.ts # 分镜组生成上下文（参考图+音频装配）
│   ├── frame-continuity.ts # 同场景尾帧承接（镜头连贯性）
│   ├── transition-engine.ts # 转场引擎（xfade/acrossfade计算）
│   ├── version-history-service.ts # 版本历史服务
│   ├── asset-lifecycle-service.ts # 资产生命周期（14天过期）
│   ├── subscription-service.ts # 订阅会员服务
│   ├── wavespeed.ts        # WaveSpeed 超分 API 客户端
│   ├── auth.ts             # 认证逻辑
│   ├── db.ts               # Prisma 客户端实例
│   ├── db-retry.ts         # SQLite 写锁重试（SQLITE_BUSY 兜底）
│   ├── redis.ts            # Redis 连接
│   ├── queue.ts            # BullMQ 队列定义（延迟加载，含定时任务注册）
│   ├── progress-publisher.ts # Redis Pub/Sub 进度事件发布
│   └── logger.ts           # 结构化日志
├── workers/                # BullMQ Worker 进程（独立于 Next.js）
│   ├── parse-video.ts      # 视频解析（下载→Normalize→AI分析→分组→音频切片）
│   ├── generate-video.ts   # 视频生成（链式串行，调用 Seedance 2.0）
│   ├── generate-character.ts # 人物形象生成（Flux）
│   ├── merge-video.ts      # 视频合并导出（含转场引擎）
│   ├── upscale-video.ts    # 视频超分（WaveSpeed）
│   ├── download-video.ts   # 链接视频下载（yt-dlp）
│   ├── face-check.ts       # 人脸检测审核
│   ├── parse-watchdog.ts   # 解析看门狗（定时检测卡死的解析任务）
│   ├── generate-watchdog.ts # 生成看门狗（定时检测卡死的生成任务，退款解卡）
│   ├── asset-cleanup-worker.ts # 资产过期清理（每日凌晨3点）
│   ├── order-expire-worker.ts  # 订单超时过期
│   ├── notification-worker.ts  # 通知推送（过期提醒等）
│   ├── concurrency-reconcile.ts # 并发计数器对账（每5分钟修复Redis漂移）
│   ├── subscription-renewal-worker.ts # 订阅自动续费
│   ├── subscription-expire-worker.ts  # 订阅到期处理
│   └── index.ts            # Worker 启动入口
├── stores/                 # Zustand 状态仓库
├── hooks/                  # 自定义 React Hooks
├── types/                  # 类型定义
├── services/               # 支付等外部服务封装
├── constants/              # 常量定义
└── generated/prisma/       # Prisma 自动生成（禁止手动编辑）
prisma/
├── schema.prisma           # 数据库模型定义
├── migrations/             # 迁移文件（禁止手动编辑）
└── seed.ts                 # 种子数据
```

## 命令

```bash
# 安装依赖
pnpm install

# 开发（Next.js + Turbopack，端口 3011）
pnpm dev

# 启动后台 Workers（单独终端）
pnpm dev:workers

# 构建
pnpm build

# Lint
pnpm lint

# 测试（单次运行）
pnpm test

# 测试（监听模式）
pnpm test:watch

# 测试覆盖率
pnpm test:coverage

# Prisma 相关
npx prisma generate          # 生成客户端
npx prisma db push           # 同步 schema 到数据库
npx prisma migrate dev       # 创建迁移
npx prisma studio            # 可视化数据库

# Docker 本地开发（仅 Redis）
docker-compose up -d

# Docker 生产部署
docker-compose -f docker-compose.prod.yml up -d --build
```

## 开发环境要求

- Node.js 22+
- pnpm 10+
- Redis 7（通过 `docker-compose up -d` 启动）
- FFmpeg + ffprobe（系统 PATH 中可用）
- 配置 `.env.local`（从 `.env.example` 复制，填写必要 API Key）

## 代码规范

### 通用规则

- 使用简体中文注释和日志输出
- TypeScript 严格模式，不允许 `any`（除非确有必要，加 eslint-disable 注释）
- 路径别名统一使用 `@/` 指向 `src/`
- 环境变量缺失时直接抛错，不使用默认回退值（生产安全第一）
- 修改代码时必须同步更新对应注释，删除旧逻辑时一并删除废弃注释

### 前端规范

- 默认 Server Component，仅需交互时标记 `'use client'`
- 状态管理用 Zustand（客户端本地状态）或 SWR（服务端数据）
- UI 组件使用 shadcn/ui，样式用 Tailwind CSS v4
- 组件文件使用 PascalCase，工具文件使用 kebab-case

### 后端规范

- API 路由统一放 `src/app/api/`，使用 Next.js Route Handlers
- 认证通过 middleware 注入 `x-user-id` / `x-user-role` 请求头
- 业务逻辑封装到 `src/lib/` 服务层，Route Handler 只做参数校验 + 调用服务 + 返回响应
- 数据库操作统一用 Prisma，不直接写 SQL
- 积分扣减必须经 Redis 分布式锁串行化（`withCreditLock`），防并发写丢失

### Worker 规范

- 每个 Worker 文件对应一个 BullMQ 队列
- Worker 内不使用 fallback 或静默降级，外部服务失败则抛错让 BullMQ 重试
- 临时文件在 finally 块中清理
- 处理结果需要区分"成功/失败/部分失败"，失败隔离但不吞错误

### 测试规范

- 属性测试（Property-Based Testing）使用 fast-check，文件名带 `.property.test.ts`
- 普通单元测试用 Vitest，放在 `src/__tests__/` 或 `src/**/__tests__/`
- 测试环境为 Node（非 jsdom），除非测试 React 组件

## 业务约束（关键决策边界）

### 必须遵守

- 所有外部 API 调用（Seedance、OSS、支付、AI 分析）使用真实接口，不 mock、不 fallback
- 积分系统写操作必须经 Redis 锁串行化（`withCreditLock`）
- 视频解析前做余额预检，余额不足直接拒绝（不允许事后扣至 0）
- FFmpeg 操作基于 normalized 后的视频（统一编码/帧率）
- 人物一致性通过 `asset://` 虚拟角色锚定图实现（reference_image 方案）
- 分镜组（ShotGroup）是生成的最小单位，一次 Seedance 调用 = 一个分镜组
- 时间轴校验不信任模型输出（非负、时长为正、不重叠、不超总时长）

### 禁止操作

- 禁止手动编辑 `src/generated/prisma/`（Prisma 自动生成）
- 禁止手动编辑 `prisma/migrations/`（通过 `prisma migrate dev` 生成）
- 禁止提交 `.env*` 文件、API Key、数据库文件到 Git
- 禁止在 API Route 中直接操作积分余额（必须通过 credit-service）
- 禁止在前端直接调用外部 AI API（所有 AI 调用走后端/Worker）
- 禁止使用静默降级处理关键业务流程失败（错误必须抛出或显式报告）

### 修改前需确认

- Prisma schema 变更（影响数据库迁移和所有查询层）
- 积分计费规则变更（影响用户余额和订单流水）
- Seedance API 请求体格式变更（影响视频生成结果）
- Worker 重试策略变更（影响任务可靠性和资源消耗）
- 认证中间件变更（影响全局安全）

## 架构决策记录

### 为什么用 PostgreSQL

多用户并发场景下 PostgreSQL 的行级锁和 MVCC 并发控制远优于 SQLite 单写锁模型。通过 Prisma adapter 层隔离，从 SQLite 迁移到 PostgreSQL 仅需更换 adapter 和连接配置。

### 为什么 Worker 独立进程

BullMQ Worker 需要长连接和高并发处理，与 Next.js serverless 模型冲突。独立进程通过 `npx tsx src/workers/index.ts` 启动，共享同一份 `src/lib/` 代码。

### 为什么分镜组而不是单镜头生成

Seedance 2.0 单次调用支持 4-15s 视频，分镜组将相邻镜头合并为一段连续生成请求，减少 API 调用次数 + 保证镜头间过渡平滑。

### 为什么统一链式串行生成

所有用户等级统一使用链式串行模式（仅入队第一组，后续由 Worker 逐组触发），原因：
- 分镜组尾帧衔接需要前一组完成后才能拿到尾帧给下一组（同场景承接）
- 并发限制的含义为"项目级"（用户能同时对多少个不同项目发起生成），而非组内并行

### 并发控制架构

多层并发控制互补：
- **API 入口层**：Redis 原子计数器（parse/merge）或 DB 状态查询（generate）门控
- **Worker 层**：BullMQ concurrency 限制同时执行的任务数
- **任务层**：Redis 分布式锁（按分镜组）防止同一组被重复处理
- **积分层**：全局积分写锁（withCreditLock）跨进程串行化，防止 read-modify-write 丢失更新
- **漂移修复**：concurrency-reconcile 看门狗每5分钟用 DB 真相覆盖 Redis 计数器

## Git 规范

- 分支命名: `feat/xxx`, `fix/xxx`, `refactor/xxx`
- Commit 消息: 中文，格式 `类型: 简述`（如 `feat: 新增视频超分导出`）
- 不要 force push 到共享分支

## 常见陷阱

1. **Prisma 热重载问题**: 开发时如果遇到 Prisma Client 过期，执行 `npx prisma generate` 重新生成
2. **Redis 连接**: Workers 必须在 Redis 启动后运行，否则 BullMQ 会崩溃
3. **FFmpeg 路径**: Windows 开发需确保 ffmpeg/ffprobe 在 PATH 中（或使用 WSL）
4. **环境变量**: 所有关键 API Key 缺失会直接抛错，不会静默跳过
5. **SQLite 并发写**: 积分等高并发写场景通过 Redis 全局锁（withCreditLock）跨进程串行化，防止 read-modify-write 丢失更新
6. **Turbopack 端口**: 开发端口固定 3011（`pnpm dev` 已配置），前端 NEXT_PUBLIC_APP_URL 要匹配
7. **生成目录**: `src/generated/prisma/` 在 `.gitignore` 中，首次 clone 需执行 `npx prisma generate`
8. **全局积分写锁不可重入**: `withCreditLock` 内部不得再调用 `withCreditLock`（会自锁死至超时抛错）
9. **并发计数器漂移**: Worker 崩溃/Redis 重启可能导致 Redis 并发计数器与 DB 真实状态不一致，由 concurrency-reconcile 看门狗每 5 分钟修复
10. **资产 14 天过期**: 生成视频/合并导出的 Asset 设有 14 天过期，过期后 OSS 文件会被清理；合并任务应在此期限内执行
