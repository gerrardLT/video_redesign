# Requirements Document

> **文档状态**：✅ 已实现（当前生效）
> **对应实现**：`Dockerfile`、`docker-compose*.yml`、`.github/workflows/**`
> **权威来源**：状态以 `AGENTS.md` + `docs/local-life-user-journey.md` 为准，冲突时以代码为准
> **最后校准**：2026-07-11

## Introduction

重新设计项目的 CI/CD 部署流程和 Docker 构建架构，解决当前 pnpm 符号链接导致 Docker COPY 失败、Next.js standalone 产物缺少 Workers 依赖、数据库迁移环境不稳定、构建速度慢等问题。目标是建立一套可靠、快速、支持回滚的自动化生产部署管道。

## Glossary

- **Build_System**: Docker multi-stage 构建系统，负责将源码编译为可部署的容器镜像
- **Deploy_Pipeline**: 从代码推送到生产环境运行的完整自动化流程（GitHub Actions → SSH → 服务器构建/部署）
- **Worker_Runtime**: BullMQ 后台任务进程的运行环境，需要 tsx/esbuild/bullmq/ioredis 等完整依赖链
- **Migrator**: 独立的数据库迁移执行容器，基于完整 node_modules 运行 prisma migrate deploy
- **Layer_Cache**: Docker BuildKit 层缓存机制，通过复用未变化的构建层加速重复构建
- **Rollback_System**: 部署回滚机制，包括数据库备份恢复和容器镜像回退
- **pnpm_Deploy**: pnpm 官方提供的 `pnpm deploy` 命令，生成无符号链接的独立部署目录
- **Health_Check**: 部署后对服务可用性的自动检测，确认应用正常响应
- **Image_Tag**: Docker 镜像标签策略，用 git commit hash 标记每次构建产物以支持回退

## Requirements

### Requirement 1: Docker 构建可靠性

**User Story:** 作为运维人员，我希望 Docker 构建不受 pnpm 符号链接结构影响，以确保每次构建都能可靠成功。

#### Acceptance Criteria

1. THE Build_System SHALL 使用 `pnpm deploy` 命令生成无符号链接的部署产物目录，替代直接 COPY node_modules
2. WHEN 新增或移除 npm 依赖时，THE Build_System SHALL 自动包含所有必需依赖，无需手动维护 COPY 列表
3. THE Build_System SHALL 在 deps 阶段完成所有依赖解析和 native addon 编译，后续阶段仅使用产物
4. IF Docker COPY 遇到符号链接路径导致文件缺失，THEN THE Build_System SHALL 在构建阶段报错终止，提供明确错误信息

### Requirement 2: Workers 运行时依赖完整性

**User Story:** 作为开发者，我希望 Workers 进程在生产容器中拥有完整的运行时依赖，以确保后台任务正常执行。

#### Acceptance Criteria

1. THE Worker_Runtime SHALL 包含 tsx、esbuild（含平台特定二进制）、bullmq、ioredis、pg、ali-oss、prisma client、dotenv、jose、bcryptjs、zod 的完整依赖树
2. WHEN Workers 源码 import 新的 npm 包时，THE Build_System SHALL 自动将该包及其依赖链纳入 Worker_Runtime，无需修改 Dockerfile
3. THE Worker_Runtime SHALL 与 Next.js standalone runner 共享同一基础镜像，通过 `pnpm deploy` 输出目录提供 Workers 专属依赖
4. WHEN Workers 进程启动时，THE Worker_Runtime SHALL 成功加载所有 TypeScript 源码并通过 tsx 实时编译执行

### Requirement 3: 数据库迁移稳定性

**User Story:** 作为运维人员，我希望数据库迁移有稳定的执行环境且自动运行，以避免部署后手动干预。

#### Acceptance Criteria

1. THE Migrator SHALL 基于独立的构建阶段（target: migrator），包含完整的 prisma CLI 及其依赖链
2. WHEN 部署流程执行时，THE Deploy_Pipeline SHALL 在应用容器启动后、流量接入前执行数据库迁移
3. IF 数据库迁移执行失败，THEN THE Deploy_Pipeline SHALL 终止部署流程并输出迁移错误日志
4. THE Migrator SHALL 通过 docker-compose profile 机制按需启动，迁移完成后自动退出并释放资源
5. THE Migrator SHALL 使用与 runner 相同的 DATABASE_URL 环境变量连接生产数据库

### Requirement 4: 构建速度优化

**User Story:** 作为运维人员，我希望 Docker 构建充分利用层缓存，以减少重复构建时间并避免网络超时。

#### Acceptance Criteria

1. THE Build_System SHALL 默认启用 Docker BuildKit 层缓存（NO_CACHE 默认为 0）
2. THE Build_System SHALL 将 pnpm store 挂载为 BuildKit cache mount（`--mount=type=cache`），避免重复下载依赖包
3. WHEN 仅源码变更而 pnpm-lock.yaml 未变时，THE Build_System SHALL 复用依赖安装层缓存，跳过 pnpm install
4. THE Build_System SHALL 将 Next.js 构建缓存（`.next/cache`）挂载为持久化 cache mount，加速增量构建
5. WHEN 用户显式指定 NO_CACHE=1 时，THE Build_System SHALL 跳过所有缓存执行全量构建

### Requirement 5: 部署自动化

**User Story:** 作为开发者，我希望推送到 main 分支后自动完成生产部署，无需人工介入。

#### Acceptance Criteria

1. WHEN 代码推送到 main 分支时，THE Deploy_Pipeline SHALL 自动触发部署流程
2. THE Deploy_Pipeline SHALL 支持 GitHub Actions workflow_dispatch 手动触发
3. THE Deploy_Pipeline SHALL 使用 concurrency group 确保同一时间仅有一个部署在执行
4. THE Deploy_Pipeline SHALL 按顺序执行：备份数据库 → 拉取代码 → 构建镜像 → 启动容器 → 执行迁移 → 重启 Workers → 健康检查
5. WHEN 部署完成后，THE Health_Check SHALL 通过 HTTP 请求验证应用主端点（/api/auth/me）响应正常
6. IF Health_Check 连续 3 次失败，THEN THE Deploy_Pipeline SHALL 标记部署失败并输出容器日志

### Requirement 6: 回滚能力

**User Story:** 作为运维人员，我希望部署失败时能快速回滚到上一个可用版本，以减少生产中断时间。

#### Acceptance Criteria

1. THE Deploy_Pipeline SHALL 在构建镜像时使用 git commit short hash 作为 Image_Tag（格式：`video-redesign-app:{commit_hash}`）
2. THE Deploy_Pipeline SHALL 保留最近 5 个版本的 Docker 镜像，支持快速回退到任意历史版本
3. WHEN 部署前检测到 PostgreSQL 容器运行中，THE Rollback_System SHALL 自动执行 pg_dump 备份并保存为带时间戳的压缩文件
4. THE Rollback_System SHALL 保留最近 7 天的数据库备份文件，自动清理过期备份
5. IF 用户执行回滚命令（`bash deploy.sh rollback`），THEN THE Rollback_System SHALL 将容器回退到上一个 Image_Tag 版本并恢复对应的数据库备份

### Requirement 7: Workers 与 App 镜像分离

**User Story:** 作为运维人员，我希望 Workers 服务不再依赖手动 tag 的 app 镜像名称，以消除部署时的隐式依赖。

#### Acceptance Criteria

1. THE Build_System SHALL 为 Workers 构建独立的 Docker 镜像阶段（target: workers），包含完整的 Worker_Runtime 依赖
2. THE docker-compose 配置 SHALL 使用 build target 指定 Workers 服务的构建阶段，替代 `image: video-redesign-app` 的隐式引用
3. WHEN App 镜像构建成功时，THE Build_System SHALL 同时构建 Workers 镜像，确保两者使用相同的代码版本
4. THE Workers 镜像 SHALL 仅包含 Workers 运行所需文件（源码 + 依赖 + prisma client），排除 Next.js 构建产物

### Requirement 8: 部署脚本健壮性

**User Story:** 作为运维人员，我希望部署脚本能优雅处理各种异常情况，以避免部署卡死或资源泄漏。

#### Acceptance Criteria

1. THE Deploy_Pipeline SHALL 为整体部署流程设置超时上限（15 分钟），超时后终止并报告失败
2. WHEN git fetch 或 docker build 因网络超时失败时，THE Deploy_Pipeline SHALL 自动重试一次
3. THE Deploy_Pipeline SHALL 在部署开始时记录起始时间，完成后输出总耗时
4. IF 部署中断（Ctrl+C 或进程终止），THEN THE Deploy_Pipeline SHALL 确保容器处于上一个稳定状态，不留半更新的服务
