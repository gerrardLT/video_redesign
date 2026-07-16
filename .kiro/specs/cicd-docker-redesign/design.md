# Design Document: CI/CD Docker 重构

## Overview

重构项目的 Docker 构建系统和部署流程，核心改动：
1. 用 `pnpm deploy --prod` 替代手动 COPY node_modules，彻底解决 pnpm 符号链接在 Docker 中的兼容性问题
2. Workers 独立构建阶段（不再复用 app 镜像 tag）
3. BuildKit cache mount 加速重复构建
4. deploy.sh 增加超时/重试/健康检查/回滚能力
5. 镜像 tag 策略支持快速回退

### 设计目标

| 指标 | 当前 | 目标 |
|------|------|------|
| 构建可靠性 | 新增依赖需手动维护 COPY 列表 | pnpm deploy 自动解析依赖树 |
| 重复构建耗时 | ~12min（NO_CACHE=1 默认全量） | ~3min（层缓存 + store cache） |
| Workers 镜像 | 手动 tag 复用 app 镜像 | 独立 build target |
| 回滚速度 | 无自动化回滚 | 一条命令 < 30s |

## Architecture

### 多阶段构建总览

```mermaid
graph TD
    subgraph "Dockerfile Multi-Stage"
        BASE[base<br/>node:22-alpine + pnpm]
        DEPS[deps<br/>pnpm install --frozen-lockfile]
        BUILDER[builder<br/>next build + prisma generate]
        DEPLOY_PROD[deploy-prod<br/>pnpm deploy --prod /deploy]
        MIGRATOR[migrator<br/>prisma CLI + schema]
        APP_RUNNER[app-runner<br/>standalone + static]
        WORKERS_RUNNER[workers-runner<br/>src/workers + flat node_modules]
    end

    BASE --> DEPS
    DEPS --> BUILDER
    DEPS --> DEPLOY_PROD
    DEPS --> MIGRATOR
    BUILDER --> APP_RUNNER
    BUILDER --> WORKERS_RUNNER
    DEPLOY_PROD --> WORKERS_RUNNER
```

### 部署流程

```mermaid
sequenceDiagram
    participant GA as GitHub Actions
    participant SRV as 生产服务器
    participant DC as docker compose
    participant PG as PostgreSQL

    GA->>SRV: SSH 连接
    SRV->>SRV: git fetch + reset --hard
    SRV->>SRV: docker compose build (app + workers)
    SRV->>PG: pg_dump 备份
    SRV->>DC: docker compose up -d
    DC->>PG: 等待 healthy
    SRV->>DC: docker compose --profile migrate run --rm migrate
    alt 迁移成功
        SRV->>DC: restart workers
        SRV->>SRV: health check (max 3 retries)
    else 迁移失败
        SRV->>SRV: 终止并输出错误日志
    end
```

## Components and Interfaces

### 1. Dockerfile — 多阶段构建

#### Stage: base

所有阶段共享的基础镜像配置。

```dockerfile
# syntax=docker/dockerfile:1.4
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app
```

#### Stage: deps

安装全部依赖（含 devDependencies，因为构建阶段需要 TypeScript 等工具）。

```dockerfile
FROM base AS deps

# 安装 native addon 编译工具（esbuild、prisma engines 等需要）
RUN apk add --no-cache python3 make g++

# 先拷贝 lock 文件，最大化层缓存命中
COPY package.json pnpm-lock.yaml ./

# BuildKit cache mount: 复用 pnpm store 避免重复下载
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
```

**关键点**：
- `--mount=type=cache,id=pnpm-store,target=/pnpm/store`：pnpm 全局 store 缓存，即使 pnpm-lock.yaml 变更也能复用已下载的包
- 仅 COPY `package.json` + `pnpm-lock.yaml`，源码变更不会导致这层 invalidate

#### Stage: builder

执行 Next.js 构建和 Prisma client 生成。

```dockerfile
FROM deps AS builder

# 拷贝全部源码
COPY . .

# Prisma generate（输出到 src/generated/prisma/）
RUN npx prisma generate

# Next.js 构建环境变量
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL:-http://localhost:3000}
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"

# BuildKit cache mount: Next.js 增量编译缓存
RUN --mount=type=cache,id=nextjs-cache,target=/app/.next/cache \
    pnpm build
```

**关键点**：
- `.next/cache` 持久化缓存加速增量构建（webpack/turbopack 模块缓存）
- `DATABASE_URL` 使用占位值——Prisma generate 不需要真实连接

#### Stage: deploy-prod（核心改动）

使用 `pnpm deploy --prod` 生成无符号链接的平坦 node_modules。

```dockerfile
FROM deps AS deploy-prod

# pnpm deploy 生成独立部署目录，所有依赖为真实文件（无符号链接）
# 注意：pnpm 10 非 workspace 项目直接在项目根目录执行 pnpm deploy
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm deploy --prod /deploy
```

**为什么用 `pnpm deploy` 而不是 `pnpm install --prod`**：
- `pnpm install` 生成的 node_modules 使用符号链接结构（`.pnpm/` + symlinks）
- Docker `COPY --from` 不支持跨层解析符号链接，导致复制的文件为空或缺失
- `pnpm deploy --prod` 输出的是完全平坦的目录结构，每个包都是真实文件
- 自动解析完整依赖树，新增依赖无需修改 Dockerfile

**前置条件**：
- package.json 中不能有 `workspace` 相关配置（当前项目已满足）
- tsx、esbuild 需移至 `dependencies`（Workers 运行时需要，详见下文）

#### Stage: migrator

独立的数据库迁移容器。

```dockerfile
FROM base AS migrator

# 从 deps 阶段获取完整 node_modules（prisma CLI 需要完整依赖链）
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json

# Prisma schema 和迁移文件
COPY prisma ./prisma/
COPY prisma.config.ts ./prisma.config.ts

CMD ["npx", "prisma", "migrate", "deploy"]
```

#### Stage: app-runner

Next.js 生产运行器，基于 standalone 输出。

```dockerfile
FROM node:22-alpine AS app-runner
WORKDIR /app
ENV NODE_ENV=production

# 运行时工具（视频处理）
RUN apk add --no-cache ffmpeg yt-dlp

# 安全：非 root 用户
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Next.js standalone 产物（已包含精简的 node_modules 子集）
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Prisma client（运行时 ORM 需要）
COPY --from=builder /app/src/generated/prisma ./src/generated/prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# 上传目录
RUN mkdir -p /app/public/uploads/temp && chown -R nextjs:nodejs /app/public/uploads

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
```

#### Stage: workers-runner（核心改动）

Workers 独立镜像，使用 `pnpm deploy` 输出的平坦 node_modules。

```dockerfile
FROM node:22-alpine AS workers-runner
WORKDIR /app
ENV NODE_ENV=production

# 运行时工具
RUN apk add --no-cache ffmpeg yt-dlp

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# 从 pnpm deploy 输出获取完整、平坦的 node_modules（无符号链接）
COPY --from=deploy-prod /deploy/node_modules ./node_modules
COPY --from=deploy-prod /deploy/package.json ./package.json

# Workers 源码
COPY --from=builder /app/src/workers ./src/workers
COPY --from=builder /app/src/lib ./src/lib
COPY --from=builder /app/src/services ./src/services
COPY --from=builder /app/src/constants ./src/constants
COPY --from=builder /app/src/types ./src/types
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Prisma client
COPY --from=builder /app/src/generated/prisma ./src/generated/prisma
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

USER nextjs
CMD ["node", "--import", "tsx", "src/workers/index.ts"]
```

**与现有方案的核心差异**：
- 不再逐个 COPY 单独的包（`node_modules/bullmq`、`node_modules/ioredis` 等）
- 不再需要手动解引用 esbuild 符号链接的 hack（`cp -rL`）
- 新增依赖只需 `pnpm add xxx` 即可，Dockerfile 无需修改

### 2. docker-compose.prod.yml 改动

```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
      target: app-runner
      args:
        NEXT_PUBLIC_APP_URL: ${NEXT_PUBLIC_APP_URL:-http://localhost:3000}
    # ... 其余不变

  workers:
    build:
      context: .
      dockerfile: Dockerfile
      target: workers-runner
    command: ["node", "--import", "tsx", "src/workers/index.ts"]
    # ... 其余不变（移除 image: video-redesign-app）

  migrate:
    build:
      context: .
      dockerfile: Dockerfile
      target: migrator
    # ... 其余不变
```

**核心改动**：
- `workers` 使用 `build.target: workers-runner` 而非 `image: video-redesign-app`
- `app` 显式指定 `target: app-runner`
- 消除部署脚本中手动 `docker tag` 的步骤

### 3. deploy.sh 重构

#### 3.1 配置默认值改动

```bash
# 改动：默认使用缓存（原来 NO_CACHE=1 每次全量构建）
NO_CACHE="${NO_CACHE:-0}"

# 新增：超时配置（秒）
DEPLOY_TIMEOUT="${DEPLOY_TIMEOUT:-900}"  # 15 分钟
HEALTH_CHECK_RETRIES=3
HEALTH_CHECK_INTERVAL=10
RETRY_COUNT=1  # 网络操作重试次数
```

#### 3.2 超时机制

```bash
# 部署开始计时
DEPLOY_START=$(date +%s)

# trap 处理 —— 中断时确保不留半更新状态
cleanup() {
  local exit_code=$?
  if [ $exit_code -ne 0 ]; then
    warn "部署中断（exit code: $exit_code），容器保持当前运行状态"
  fi
  local elapsed=$(( $(date +%s) - DEPLOY_START ))
  log "总耗时: ${elapsed}s"
}
trap cleanup EXIT

# 超时守护进程
timeout_guard() {
  sleep "$DEPLOY_TIMEOUT"
  err "部署超时（${DEPLOY_TIMEOUT}s），强制终止"
  kill -TERM $$ 2>/dev/null
}
timeout_guard &
TIMEOUT_PID=$!
trap "kill $TIMEOUT_PID 2>/dev/null; cleanup" EXIT
```

#### 3.3 网络操作重试

```bash
# 通用重试函数
retry() {
  local cmd="$*"
  local attempt=0
  while [ $attempt -le $RETRY_COUNT ]; do
    if eval "$cmd"; then
      return 0
    fi
    attempt=$((attempt + 1))
    if [ $attempt -le $RETRY_COUNT ]; then
      warn "命令失败，${attempt}/${RETRY_COUNT} 次重试中..."
      sleep 5
    fi
  done
  return 1
}

# 使用示例
retry git fetch origin
retry "$DC build $BUILD_ARGS"
```

#### 3.4 镜像 tag 策略

```bash
# 构建镜像并打 commit hash tag
CURRENT_COMMIT=$(git rev-parse --short HEAD)
IMAGE_TAG="video-redesign:${CURRENT_COMMIT}"

$DC build $BUILD_ARGS
docker tag "$($DC images -q app 2>/dev/null | head -n1)" "$IMAGE_TAG"

# 清理旧镜像：保留最近 5 个版本
cleanup_old_images() {
  local images=$(docker images "video-redesign" --format "{{.Tag}} {{.CreatedAt}}" | \
    sort -k2 -r | tail -n +6 | awk '{print $1}')
  for tag in $images; do
    docker rmi "video-redesign:$tag" 2>/dev/null || true
  done
}
```

#### 3.5 健康检查

```bash
health_check() {
  local url="http://localhost:3000/api/auth/me"
  local attempt=0
  
  while [ $attempt -lt $HEALTH_CHECK_RETRIES ]; do
    sleep "$HEALTH_CHECK_INTERVAL"
    if wget --no-verbose --tries=1 --spider "$url" 2>/dev/null; then
      ok "健康检查通过"
      return 0
    fi
    attempt=$((attempt + 1))
    warn "健康检查失败 (${attempt}/${HEALTH_CHECK_RETRIES})"
  done
  
  err "健康检查连续 ${HEALTH_CHECK_RETRIES} 次失败！"
  $DC logs --tail=50 "$APP_SERVICE"
  return 1
}
```

#### 3.6 回滚命令

```bash
# deploy.sh rollback [commit_hash]
if [ "${1:-}" = "rollback" ]; then
  TARGET_TAG="${2:-}"
  
  if [ -z "$TARGET_TAG" ]; then
    # 获取上一个版本 tag
    TARGET_TAG=$(docker images "video-redesign" --format "{{.Tag}}" | \
      grep -v "latest" | sort -r | sed -n '2p')
  fi
  
  if [ -z "$TARGET_TAG" ]; then
    err "没有可用的回滚版本"
    exit 1
  fi
  
  log "回滚到版本: $TARGET_TAG"
  
  # 恢复对应数据库备份（如果存在）
  BACKUP_FILE=$(ls -t "$BACKUP_DIR"/pg_backup_*.sql.gz 2>/dev/null | sed -n '2p')
  if [ -n "$BACKUP_FILE" ]; then
    log "恢复数据库备份: $BACKUP_FILE"
    gunzip -c "$BACKUP_FILE" | $DC exec -T "$PG_SERVICE" psql -U postgres video_redesign
  fi
  
  # 用目标版本 tag 重启容器
  docker tag "video-redesign:$TARGET_TAG" video-redesign-app:latest
  $DC up -d
  
  ok "已回滚到 $TARGET_TAG"
  exit 0
fi
```

#### 3.7 备份清理

```bash
# 清理 7 天前的备份
cleanup_old_backups() {
  find "$BACKUP_DIR" -name "pg_backup_*.sql.gz" -mtime +7 -delete 2>/dev/null || true
  local count=$(ls "$BACKUP_DIR"/pg_backup_*.sql.gz 2>/dev/null | wc -l)
  log "当前保留 ${count} 个数据库备份"
}
```

### 4. package.json 依赖调整

Workers 运行时需要 tsx 和 esbuild，必须将它们从 devDependencies 移至 dependencies：

```json
{
  "dependencies": {
    "tsx": "^4.22.4",
    "dotenv": "^17.4.2"
  },
  "devDependencies": {
    // tsx 和 dotenv 从这里移除
  }
}
```

**说明**：
- `tsx`：Workers 使用 `node --import tsx` 运行时编译 TypeScript
- `dotenv`：Workers 运行时需要加载 .env 配置
- `esbuild`：tsx 的运行时依赖，pnpm 会自动解析（无需显式声明在 dependencies 中，因为它是 tsx 的 peer dependency）
- `@esbuild/linux-x64`：平台特定包，pnpm 的 `onlyBuiltDependencies` 配置确保在 Alpine 环境中正确安装

### 5. GitHub Actions Workflow（微调）

```yaml
jobs:
  deploy:
    timeout-minutes: 20  # 留出比 deploy.sh 内部超时更多的余量
    steps:
      - name: SSH 部署
        run: |
          ssh $SERVER_USER@$SERVER_HOST << 'DEPLOY_SCRIPT'
            set -e
            cd /www/wwwroot/video-redesign
            # 显式启用 BuildKit
            export DOCKER_BUILDKIT=1
            export COMPOSE_DOCKER_CLI_BUILD=1
            bash deploy.sh
          DEPLOY_SCRIPT
```

## Data Models

本次重构不涉及数据库 schema 变更。相关的数据模型仅为运维数据：

### 镜像版本记录（隐式，通过 docker images 管理）

| 字段 | 类型 | 说明 |
|------|------|------|
| tag | string | git commit short hash（如 `a1b2c3d`） |
| created_at | timestamp | 构建时间 |
| size | bytes | 镜像大小 |

### 备份文件命名规范

```
backups/pg_backup_20240115_143022.sql.gz
         ^         ^        ^
         |         |        +-- 时分秒
         |         +----------- 年月日
         +-------------------- 固定前缀
```

保留策略：最近 7 天，超期自动清理。

## Error Handling

### 构建阶段错误

| 错误场景 | 处理方式 |
|----------|----------|
| pnpm install 网络超时 | BuildKit cache mount 保底（已缓存的包不重新下载），deploy.sh 重试 1 次 |
| pnpm deploy 失败 | 构建终止，退出码非零，deploy.sh 停止流程 |
| next build 失败 | 构建终止，deploy.sh 停止流程 |
| prisma generate 失败 | 构建终止（通常是 schema 语法错误） |

### 部署阶段错误

| 错误场景 | 处理方式 |
|----------|----------|
| 数据库迁移失败 | 终止部署，输出错误日志 + 恢复命令提示 |
| 健康检查 3 次失败 | 标记部署失败，输出容器日志 |
| 超时（15 分钟） | 强制终止，容器保持旧版本运行 |
| Ctrl+C 中断 | trap 捕获，容器保持当前状态 |
| git fetch 失败 | 重试 1 次后失败终止 |

### 回滚错误

| 错误场景 | 处理方式 |
|----------|----------|
| 无可用历史镜像 | 输出错误信息并退出 |
| 数据库恢复失败 | 输出错误但继续尝试容器回滚 |

## Testing Strategy

### 测试方法

本特性属于基础设施/DevOps 改造，涉及 Dockerfile、shell 脚本和 docker-compose 配置。**不适用 Property-Based Testing**（原因：IaC 配置和 shell 脚本不是有清晰输入/输出的纯函数，行为不随输入变化，无法有效进行 100+ 次迭代测试）。

### 测试策略

#### 集成测试（CI 中执行）

1. **构建验证**：
   - `docker build --target app-runner .` 成功退出
   - `docker build --target workers-runner .` 成功退出
   - `docker build --target migrator .` 成功退出

2. **镜像内容验证**：
   - Workers 容器内执行 `node -e "require('tsx'); require('bullmq'); require('ioredis')"` 无错误
   - Workers 容器内 `/app/node_modules` 无符号链接：`find /app/node_modules -type l | wc -l` 等于 0
   - App 容器内存在 `server.js`（standalone 入口）

3. **迁移容器验证**：
   - `docker compose --profile migrate run --rm migrate` 正常退出（需要可用的 PostgreSQL）

#### 冒烟测试（部署后手动/自动执行）

1. `curl -s http://localhost:3000/api/auth/me` 返回 HTTP 200/401（非 502/503）
2. Workers 容器日志无 `MODULE_NOT_FOUND` 错误
3. `docker images video-redesign --format "{{.Tag}}"` 包含当前 commit hash

#### Shell 脚本测试（本地验证）

1. `bash deploy.sh --dry-run`（可选的空跑模式）验证流程步骤
2. `NO_CACHE=1 bash deploy.sh` 验证传递 `--no-cache`
3. `bash deploy.sh rollback` 验证回滚流程

### 验收标准覆盖矩阵

| 需求 | 验证方式 | 自动化级别 |
|------|----------|-----------|
| R1: pnpm deploy 无符号链接 | 集成测试 — 检查 node_modules 无 symlink | CI 自动 |
| R2: Workers 依赖完整 | 集成测试 — require 验证 | CI 自动 |
| R3: 迁移容器工作 | 集成测试 — migrate run | CI 自动（需 PG） |
| R4: 缓存加速 | 对比测试 — 两次构建耗时 | 手动验证 |
| R5: 自动部署 | GitHub Actions 执行记录 | CI 自动 |
| R6: 回滚能力 | 冒烟测试 — rollback 命令 | 手动验证 |
| R7: Workers 独立镜像 | 集成测试 — 分别构建 target | CI 自动 |
| R8: 脚本健壮性 | Shell 测试 — 模拟异常 | 半自动 |
