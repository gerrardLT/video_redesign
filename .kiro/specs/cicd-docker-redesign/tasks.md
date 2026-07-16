# Implementation Plan: CI/CD Docker 重构

## Overview

重构 Docker 构建系统和部署流程，核心改动链路为：package.json 依赖调整 → Dockerfile 多阶段重写（pnpm deploy 替代手动 COPY） → docker-compose 配置更新 → deploy.sh 增加超时/重试/回滚 → GitHub Actions 微调。每个步骤严格依赖前一步的产物。

## Tasks

- [x] 1. 调整 package.json 依赖分组
  - [x] 1.1 将 tsx 和 dotenv 从 devDependencies 移至 dependencies
    - 将 `tsx` (`^4.22.4`) 从 devDependencies 移至 dependencies
    - 将 `dotenv` (`^17.4.2`) 从 devDependencies 移至 dependencies
    - 确认 `pnpm.onlyBuiltDependencies` 已包含 `esbuild`（当前已配置，无需改动）
    - 执行 `pnpm install` 更新 lockfile
    - _Requirements: 2.1, 2.2_

- [x] 2. Checkpoint - 验证 lockfile 正确性
  - 确认 `pnpm-lock.yaml` 中 tsx/dotenv 已归入 production dependencies，ask the user if questions arise.

- [x] 3. 重写 Dockerfile 多阶段构建
  - [x] 3.1 重写完整 Dockerfile（6 个构建阶段）
    - 创建 `base` 阶段：node:22-alpine + corepack enable pnpm@10 + WORKDIR /app
    - 创建 `deps` 阶段：apk add python3 make g++ + COPY package.json/pnpm-lock.yaml + `--mount=type=cache,id=pnpm-store,target=/pnpm/store` pnpm install --frozen-lockfile
    - 创建 `builder` 阶段：COPY 源码 + prisma generate + `--mount=type=cache,id=nextjs-cache,target=/app/.next/cache` pnpm build
    - 创建 `deploy-prod` 阶段：`pnpm deploy --prod /deploy`（核心改动，输出无符号链接的平坦 node_modules）
    - 创建 `migrator` 阶段：从 deps 拷贝完整 node_modules + prisma schema + prisma.config.ts，CMD prisma migrate deploy
    - 创建 `app-runner` 阶段：standalone 产物 + static + public + prisma client，非 root 用户 nextjs
    - 创建 `workers-runner` 阶段：从 deploy-prod 拷贝 `/deploy/node_modules`（无符号链接）+ Workers 源码 + prisma client + tsconfig.json
    - 移除旧的 esbuild 手动解引用 hack（`cp -rL`）
    - 移除旧的逐个 COPY node_modules 子目录的方式
    - 添加 `# syntax=docker/dockerfile:1.4` 头部声明
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 3.1, 4.1, 4.2, 4.3, 4.4, 7.1, 7.4_

  - [ ]* 3.2 验证 Dockerfile 构建成功
    - 在服务器上分别构建三个 target 验证无报错：`docker build --target app-runner .`、`docker build --target workers-runner .`、`docker build --target migrator .`
    - 验证 workers-runner 容器内 `find /app/node_modules -type l | wc -l` 等于 0（无符号链接）
    - 验证 workers-runner 容器内 `node -e "require('tsx'); require('bullmq'); require('ioredis')"` 无错误
    - _Requirements: 1.1, 2.1, 7.4_

- [x] 4. 更新 docker-compose.prod.yml
  - [x] 4.1 修改 workers 和 app 服务的构建配置
    - `app` 服务添加 `build.target: app-runner`
    - `workers` 服务移除 `image: video-redesign-app`，改为 `build.context` + `build.target: workers-runner`
    - `migrate` 服务保持 `build.target: migrator` 不变（当前已正确）
    - 确保 workers 的 `command` 保持 `["node", "--import", "tsx", "src/workers/index.ts"]`
    - 更新文件头注释，说明新的构建架构
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 5. Checkpoint - 验证 docker-compose 配置语法
  - 执行 `docker compose -f docker-compose.prod.yml config` 确认语法正确，ask the user if questions arise.

- [x] 6. 重构 deploy.sh 部署脚本
  - [x] 6.1 添加超时/计时/trap 基础设施
    - 修改 `NO_CACHE` 默认值从 `1` 改为 `0`（默认启用缓存）
    - 添加 `DEPLOY_TIMEOUT`（默认 900s）、`HEALTH_CHECK_RETRIES`（3）、`HEALTH_CHECK_INTERVAL`（10s）、`RETRY_COUNT`（1）配置变量
    - 添加 `DEPLOY_START` 计时器和 `cleanup` trap 函数（输出总耗时）
    - 添加 `timeout_guard` 后台进程（超时强制终止）
    - 更新脚本头注释，反映新增参数和用法
    - _Requirements: 8.1, 8.3, 8.4_

  - [x] 6.2 添加重试函数和镜像 tag 策略
    - 实现通用 `retry()` 函数（支持 $RETRY_COUNT 次重试，间隔 5s）
    - 将 `git fetch` 和 `docker compose build` 包装进 retry 调用
    - 构建完成后用 `CURRENT_COMMIT`（git short hash）打 tag：`video-redesign:{commit_hash}`
    - 实现 `cleanup_old_images()` 函数保留最近 5 个版本镜像
    - 移除旧的手动 `docker tag video-redesign-app` 步骤（不再需要 workers 复用 app 镜像 tag）
    - _Requirements: 6.1, 6.2, 8.2_

  - [x] 6.3 添加健康检查和备份清理
    - 实现 `health_check()` 函数：wget 访问 `/api/auth/me`，最多重试 3 次，间隔 10s
    - 健康检查失败时输出容器最近 50 行日志
    - 实现 `cleanup_old_backups()` 函数：删除 7 天前的 pg_dump 备份
    - 在部署流程末尾调用健康检查和备份清理
    - _Requirements: 5.5, 5.6, 6.3, 6.4_

  - [x] 6.4 添加回滚命令支持
    - 实现 `bash deploy.sh rollback [commit_hash]` 子命令
    - 无参数时自动选择上一个版本 tag
    - 回滚时尝试恢复对应时间的数据库备份（如存在）
    - 用目标 tag 重启容器
    - 在脚本头注释中添加回滚用法说明
    - _Requirements: 6.5_

- [x] 7. Checkpoint - 验证 deploy.sh 语法
  - 执行 `bash -n deploy.sh` 确认无语法错误，ask the user if questions arise.

- [x] 8. 微调 GitHub Actions 部署工作流
  - [x] 8.1 更新 deploy.yml 配置
    - `timeout-minutes` 从 15 调整为 20（留出更多余量）
    - SSH 部署命令中添加 `export DOCKER_BUILDKIT=1` 和 `export COMPOSE_DOCKER_CLI_BUILD=1`
    - 更新文件头注释说明 BuildKit 要求
    - _Requirements: 4.1, 5.1, 5.2, 5.3_

- [x] 9. Final checkpoint - 确认全部改动一致性
  - 确认 Dockerfile 中引用的 stage name 与 docker-compose.prod.yml 中 target 名称一致
  - 确认 deploy.sh 不再有 `docker tag ... video-redesign-app` 步骤
  - 确认 deploy.sh 中 `NO_CACHE` 默认值为 0
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- 本特性为 IaC/DevOps 改造，不涉及应用层代码变更和数据库 schema 变更
- 不适用 Property-Based Testing（shell 脚本和 Docker 配置无法有效迭代测试）
- 验证任务（标记 `*`）需要 Docker 环境，建议在服务器上执行
- `pnpm deploy --prod` 要求 tsx/dotenv 在 dependencies 中，因此 package.json 调整**必须**先于 Dockerfile 重写
- Workers 镜像与 App 镜像共享同一 Dockerfile，通过不同 build target 分别构建
- 回滚能力依赖镜像 tag 保留策略（最近 5 个版本）和 pg_dump 备份（最近 7 天）

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["3.1"] },
    { "id": 2, "tasks": ["3.2", "4.1"] },
    { "id": 3, "tasks": ["6.1"] },
    { "id": 4, "tasks": ["6.2", "6.3"] },
    { "id": 5, "tasks": ["6.4", "8.1"] }
  ]
}
```
