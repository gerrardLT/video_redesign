# syntax=docker/dockerfile:1.4
# ============================================================================
# Video Redesign — 多阶段 Docker 构建
# ============================================================================
# 构建阶段总览：
#   base          → 共享基础镜像（Node 22 + pnpm 10）
#   deps          → 安装全部依赖（dev + prod，含 native addon 编译）
#   builder       → Next.js 构建 + Prisma client 生成
#   deploy-prod   → pnpm deploy --prod 输出平坦 node_modules（无符号链接）
#   migrator      → 数据库迁移执行器（prisma migrate deploy）
#   app-runner    → Next.js standalone 生产运行器
#   workers-runner → BullMQ Workers 独立运行器
#
# 核心改动：用 pnpm deploy --prod 替代手动 COPY node_modules 子目录，
# 彻底解决 pnpm 符号链接在 Docker COPY 中不兼容的问题。
# 新增依赖只需 pnpm add xxx，Dockerfile 无需修改。
# ============================================================================


# ========================
# Stage: base
# 所有阶段共享的基础镜像配置
# ========================
FROM node:22-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app


# ========================
# Stage: deps
# 安装全部依赖（含 devDependencies，构建阶段需要 TypeScript 等工具）
# 使用 BuildKit cache mount 复用 pnpm store，避免重复下载
# ========================
FROM base AS deps

# native addon 编译工具（esbuild、prisma engines 等需要）
RUN apk add --no-cache python3 make g++

# 先拷贝 lock 文件，最大化层缓存命中（源码变更不会 invalidate 此层）
COPY package.json pnpm-lock.yaml ./

# 拷贝 prisma 目录（prisma postinstall 需要 schema 文件）
COPY prisma ./prisma/

# BuildKit cache mount: 复用 pnpm 全局 store，即使 lockfile 变更也能复用已下载的包
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile


# ========================
# Stage: builder
# 执行 Next.js 构建和 Prisma client 生成
# ========================
FROM deps AS builder

# 拷贝全部源码（.dockerignore 已排除 node_modules/.next/.git 等）
COPY . .

# Prisma generate（输出到 src/generated/prisma/，不需要真实数据库连接）
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN npx prisma generate

# Next.js 构建环境变量（NEXT_PUBLIC_* 会内联到客户端包）
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL:-http://localhost:3000}

# BuildKit cache mount: Next.js 增量编译缓存（webpack/turbopack 模块缓存）
RUN --mount=type=cache,id=nextjs-cache,target=/app/.next/cache \
    pnpm build


# ========================
# Stage: deploy-prod（核心改动）
# 使用 pnpm deploy --prod 生成无符号链接的平坦 node_modules
# 输出目录 /deploy 包含完整的 production 依赖树（真实文件，非 symlinks）
# ========================
FROM deps AS deploy-prod

# pnpm deploy 生成独立部署目录：
# - 所有 dependencies 中的包被解引用为真实文件（无符号链接）
# - 自动解析完整依赖树，新增依赖无需修改 Dockerfile
# - --prod 排除 devDependencies（tsx/dotenv 已移至 dependencies）
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm deploy --prod /deploy


# ========================
# Stage: migrator
# 独立的数据库迁移容器（按需启动，执行完成后自动退出）
# 基于完整 node_modules（prisma CLI 在 devDependencies 中，pnpm deploy --prod 不包含）
# ========================
FROM base AS migrator

# 从 deps 阶段获取完整 node_modules（含 prisma CLI 及其所有依赖）
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json

# Prisma schema、迁移文件和配置
COPY prisma ./prisma/
COPY prisma.config.ts ./prisma.config.ts

# .env.production 作为运行时 .env（实际 DATABASE_URL 由 docker-compose 环境变量覆盖）
COPY .env.production ./.env

CMD ["npx", "prisma", "migrate", "deploy"]


# ========================
# Stage: app-runner
# Next.js 生产运行器，基于 standalone 输出（已包含精简的运行时 node_modules）
# 不需要 deploy-prod 的产物（standalone 已内含 Next.js 运行依赖）
# ========================
FROM node:22-alpine AS app-runner
WORKDIR /app

ENV NODE_ENV=production

# 运行时工具：FFmpeg（视频处理）+ yt-dlp（链接下载）
RUN apk add --no-cache ffmpeg yt-dlp

# 安全：非 root 用户
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Next.js standalone 产物（含精简 node_modules 子集，约 50MB）
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Prisma client（运行时 ORM 查询需要）
COPY --from=builder /app/src/generated/prisma ./src/generated/prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# .env.production 复制为 .env，供运行时读取环境变量
COPY --from=builder /app/.env.production ./.env

# 上传目录（含 temp 子目录：generate/merge/upscale 等 worker 的本地中转目录）
RUN mkdir -p /app/public/uploads/temp && chown -R nextjs:nodejs /app/public/uploads

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]


# ========================
# Stage: workers-runner
# BullMQ Workers 独立运行器
# 从 deploy-prod 获取平坦 node_modules（无符号链接，包含 tsx/esbuild/bullmq 等完整依赖）
# ========================
FROM node:22-alpine AS workers-runner
WORKDIR /app

ENV NODE_ENV=production

# 运行时工具：FFmpeg（视频处理）+ yt-dlp（链接下载）
RUN apk add --no-cache ffmpeg yt-dlp

# 安全：非 root 用户
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# 从 pnpm deploy --prod 输出获取完整、平坦的 node_modules（无符号链接）
# 包含：tsx、esbuild、bullmq、ioredis、pg、ali-oss、dotenv、jose、bcryptjs、zod 等
COPY --from=deploy-prod /deploy/node_modules ./node_modules
COPY --from=deploy-prod /deploy/package.json ./package.json

# Workers 源码（tsx 运行时编译执行 TypeScript）
COPY --from=builder /app/src/workers ./src/workers
COPY --from=builder /app/src/lib ./src/lib
COPY --from=builder /app/src/services ./src/services
COPY --from=builder /app/src/constants ./src/constants
COPY --from=builder /app/src/types ./src/types
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Prisma client（Worker 进程 ORM 查询需要）
COPY --from=builder /app/src/generated/prisma ./src/generated/prisma
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

# .env.production 复制为 .env，供运行时读取环境变量
COPY --from=builder /app/.env.production ./.env

# 上传临时目录（Worker 处理视频时的本地中转）
RUN mkdir -p /app/public/uploads/temp && chown -R nextjs:nodejs /app/public/uploads

USER nextjs

CMD ["node", "--import", "tsx", "src/workers/index.ts"]
