# ========================
# Stage 1: Dependencies
# ========================
FROM node:22-alpine AS deps
WORKDIR /app

# 安装 ffmpeg（视频处理必需）、构建工具和 pnpm
RUN apk add --no-cache ffmpeg python3 make g++ && \
    corepack enable && corepack prepare pnpm@10 --activate

COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma/

RUN pnpm install --frozen-lockfile --prod=false && npx prisma generate

# ========================
# Stage 2: Build
# ========================
FROM node:22-alpine AS builder
WORKDIR /app

RUN apk add --no-cache ffmpeg && \
    corepack enable && corepack prepare pnpm@10 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY . .

# 构建时使用临时环境变量（Prisma generate 不需要连接数据库）
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"

# Prisma 客户端生成（输出到 src/generated/prisma，须在 COPY 源码后执行）
RUN npx prisma generate

# 构建时需要的环境变量（Next.js 内联 NEXT_PUBLIC_* 到客户端包）
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL:-http://localhost:3000}

# 构建 Next.js
RUN pnpm build

# ========================
# Stage 3: Production Runner
# ========================
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# 安装 ffmpeg + ffprobe + yt-dlp（运行时视频处理和链接下载必需）
RUN apk add --no-cache ffmpeg yt-dlp

# 创建非 root 用户
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# P2 修复：镜像瘦身 — 仅拷贝 standalone 产物 + Workers 运行时必需依赖
# standalone 模式已内含 Next.js 运行所需的 node_modules 子集（~50MB vs 完整 ~800MB）

# Next.js standalone 产物（含精简 node_modules）
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Prisma 客户端和 schema（运行时 + migrate deploy 需要）
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src/generated/prisma ./src/generated/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

# Workers 源码（tsx 运行时编译执行）
COPY --from=builder /app/src/workers ./src/workers
COPY --from=builder /app/src/lib ./src/lib
COPY --from=builder /app/src/services ./src/services
COPY --from=builder /app/src/constants ./src/constants
COPY --from=builder /app/src/types ./src/types
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/package.json ./package.json

# Workers 运行时依赖（仅拷贝 Worker 进程需要但 standalone 未包含的包）
# standalone 已包含 Next.js 应用依赖；Worker 额外需要：bullmq, ioredis, tsx, ali-oss 等
COPY --from=builder /app/node_modules/bullmq ./node_modules/bullmq
COPY --from=builder /app/node_modules/ioredis ./node_modules/ioredis
COPY --from=builder /app/node_modules/tsx ./node_modules/tsx
COPY --from=builder /app/node_modules/ali-oss ./node_modules/ali-oss
COPY --from=builder /app/node_modules/dotenv ./node_modules/dotenv
COPY --from=builder /app/node_modules/jose ./node_modules/jose
COPY --from=builder /app/node_modules/bcryptjs ./node_modules/bcryptjs
COPY --from=builder /app/node_modules/zod ./node_modules/zod
COPY --from=builder /app/node_modules/fast-check ./node_modules/fast-check
COPY --from=builder /app/node_modules/pg ./node_modules/pg
COPY --from=builder /app/node_modules/@prisma/adapter-pg ./node_modules/@prisma/adapter-pg

# .env.production 复制为 .env，供 Prisma CLI (dotenv/config) 和运行时读取
COPY --from=builder /app/.env.production ./.env

# 创建上传目录（含 temp 子目录：generate/merge/upscale 等 worker 的本地中转目录）
RUN mkdir -p /app/public/uploads/temp && chown -R nextjs:nodejs /app/public/uploads

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# 启动脚本由 docker-compose command 指定
CMD ["node", "server.js"]
