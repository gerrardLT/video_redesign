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

# 构建时使用临时 SQLite（仅供 SSG 预渲染读空表用，运行时由 .env.production 覆盖）
ENV DATABASE_URL="file:./build.db"

# Prisma 客户端生成（输出到 src/generated/prisma，须在 COPY 源码后执行）
RUN npx prisma generate

# 创建空数据库供 SSG 预渲染使用（构建时需要表结构，运行时会用真实 DB）
RUN npx prisma db push --accept-data-loss 2>/dev/null || true

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

# 拷贝构建产物
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src/generated/prisma ./src/generated/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/src/workers ./src/workers
COPY --from=builder /app/src/lib ./src/lib
COPY --from=builder /app/src/services ./src/services
COPY --from=builder /app/src/constants ./src/constants
COPY --from=builder /app/src/types ./src/types
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
# .env.production 复制为 .env，供 Prisma CLI (dotenv/config) 和运行时读取
COPY --from=builder /app/.env.production ./.env

# 创建上传目录（含 temp 子目录：generate/merge/upscale 等 worker 的本地中转目录，
# .dockerignore 已排除该目录内容，运行时各 worker 也会自建，这里预置一份兜底）
RUN mkdir -p /app/public/uploads/temp && chown -R nextjs:nodejs /app/public/uploads
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# 启动脚本由 docker-compose command 指定
CMD ["node", "server.js"]
