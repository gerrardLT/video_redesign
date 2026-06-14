# ========================
# Stage 1: Dependencies
# ========================
FROM node:22-alpine AS deps
WORKDIR /app

# 安装 ffmpeg（视频处理必需）、构建工具和 pnpm
RUN apk add --no-cache ffmpeg python3 make g++ && \
    corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma/

RUN pnpm install --frozen-lockfile --prod=false && npx prisma generate

# ========================
# Stage 2: Build
# ========================
FROM node:22-alpine AS builder
WORKDIR /app

RUN apk add --no-cache ffmpeg && \
    corepack enable && corepack prepare pnpm@latest --activate

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY . .

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

# 安装 ffmpeg + ffprobe（运行时视频处理必需）
RUN apk add --no-cache ffmpeg

# 创建非 root 用户
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# 拷贝构建产物
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/src/workers ./src/workers
COPY --from=builder /app/src/lib ./src/lib
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules

# 创建上传目录
RUN mkdir -p /app/public/uploads && chown -R nextjs:nodejs /app/public/uploads
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# 启动脚本由 docker-compose command 指定
CMD ["node", "server.js"]
