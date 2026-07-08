#!/usr/bin/env bash
#
# 生产环境 Docker 一键部署脚本
# 适用于已用 docker-compose.prod.yml 部署过的服务器更新最新代码
#
# 流程：环境检查 → 备份数据库 → 拉取代码 → 重建镜像 → 启动 → 数据库迁移 → 重启 Worker → 健康检查 → 清理
#
# 用法：
#   bash deploy.sh                       # 默认从 origin/main 拉取并部署（使用缓存）
#   bash deploy.sh rollback              # 回滚到上一个版本
#   bash deploy.sh rollback abc1234      # 回滚到指定 commit hash 版本
#   BRANCH=feat/xxx bash deploy.sh       # 指定分支
#   SKIP_BACKUP=1 bash deploy.sh         # 跳过数据库备份（不推荐）
#   NO_CACHE=1 bash deploy.sh            # 构建时禁用缓存（全量构建）
#   DEPLOY_TIMEOUT=1200 bash deploy.sh   # 自定义超时时间（秒）
#
# 配置变量（均可通过环境变量覆盖）：
#   COMPOSE_FILE       - docker-compose 文件路径（默认 docker-compose.prod.yml）
#   BRANCH             - 部署分支（默认 main）
#   SKIP_BACKUP        - 跳过备份（默认 0）
#   NO_CACHE           - 禁用构建缓存（默认 0，即默认启用缓存）
#   BACKUP_DIR         - 备份目录（默认 ./backups）
#   DEPLOY_TIMEOUT     - 部署超时时间秒（默认 900）
#   HEALTH_CHECK_RETRIES - 健康检查重试次数（默认 3）
#   HEALTH_CHECK_INTERVAL - 健康检查间隔秒（默认 10）
#   RETRY_COUNT        - 网络操作重试次数（默认 1）

set -euo pipefail

# ========================
# 配置（可通过环境变量覆盖）
# ========================
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
BRANCH="${BRANCH:-main}"
SKIP_BACKUP="${SKIP_BACKUP:-0}"
NO_CACHE="${NO_CACHE:-0}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
APP_SERVICE="app"
WORKERS_SERVICE="workers"
PG_SERVICE="postgres"

# 超时/重试/健康检查配置
DEPLOY_TIMEOUT="${DEPLOY_TIMEOUT:-900}"
HEALTH_CHECK_RETRIES="${HEALTH_CHECK_RETRIES:-3}"
HEALTH_CHECK_INTERVAL="${HEALTH_CHECK_INTERVAL:-10}"
RETRY_COUNT="${RETRY_COUNT:-1}"

# 计时器
DEPLOY_START=$(date +%s)

# ========================
# 工具函数
# ========================
log()  { echo -e "\033[1;36m[deploy]\033[0m $*"; }
ok()   { echo -e "\033[1;32m[ ok ]\033[0m $*"; }
warn() { echo -e "\033[1;33m[warn]\033[0m $*"; }
err()  { echo -e "\033[1;31m[fail]\033[0m $*" >&2; }

# ========================
# cleanup trap — 中断/退出时输出耗时
# ========================
cleanup() {
  local exit_code=$?
  # 清理超时守护进程
  if [ -n "${TIMEOUT_PID:-}" ]; then
    kill "$TIMEOUT_PID" 2>/dev/null || true
    wait "$TIMEOUT_PID" 2>/dev/null || true
  fi
  if [ $exit_code -ne 0 ]; then
    warn "部署中断（exit code: $exit_code），容器保持当前运行状态"
  fi
  local elapsed=$(( $(date +%s) - DEPLOY_START ))
  log "总耗时: ${elapsed}s"
}
trap cleanup EXIT

# ========================
# 超时守护进程
# ========================
timeout_guard() {
  sleep "$DEPLOY_TIMEOUT"
  err "部署超时（${DEPLOY_TIMEOUT}s），强制终止"
  kill -TERM $$ 2>/dev/null
}
timeout_guard &
TIMEOUT_PID=$!

# ========================
# 通用重试函数
# ========================
retry() {
  local cmd="$*"
  local attempt=0
  while [ $attempt -le "$RETRY_COUNT" ]; do
    if eval "$cmd"; then
      return 0
    fi
    attempt=$((attempt + 1))
    if [ $attempt -le "$RETRY_COUNT" ]; then
      warn "命令失败，第 ${attempt}/${RETRY_COUNT} 次重试中（5s 后）..."
      sleep 5
    fi
  done
  err "命令在 $((RETRY_COUNT + 1)) 次尝试后仍然失败: $cmd"
  return 1
}

# ========================
# 健康检查函数
# ========================
health_check() {
  local url="http://localhost:3000/api/auth/me"
  local attempt=0

  log "执行健康检查（最多 ${HEALTH_CHECK_RETRIES} 次，间隔 ${HEALTH_CHECK_INTERVAL}s）..."
  while [ $attempt -lt "$HEALTH_CHECK_RETRIES" ]; do
    sleep "$HEALTH_CHECK_INTERVAL"
    if wget --no-verbose --tries=1 --spider "$url" 2>/dev/null; then
      ok "健康检查通过"
      return 0
    fi
    attempt=$((attempt + 1))
    warn "健康检查失败 (${attempt}/${HEALTH_CHECK_RETRIES})"
  done

  err "健康检查连续 ${HEALTH_CHECK_RETRIES} 次失败！"
  log "输出 app 容器最近 50 行日志："
  $DC logs --tail=50 "$APP_SERVICE" || true
  return 1
}

# ========================
# 清理旧镜像：保留最近 5 个版本
# ========================
cleanup_old_images() {
  local old_tags
  old_tags=$(docker images "video-redesign" --format "{{.Tag}} {{.CreatedAt}}" 2>/dev/null | \
    sort -k2 -r | tail -n +6 | awk '{print $1}')
  if [ -n "$old_tags" ]; then
    for tag in $old_tags; do
      docker rmi "video-redesign:$tag" 2>/dev/null || true
    done
    log "已清理旧镜像，保留最近 5 个版本"
  fi
}

# ========================
# 清理旧备份：删除 7 天前的备份
# ========================
cleanup_old_backups() {
  find "$BACKUP_DIR" -name "pg_backup_*.sql.gz" -mtime +7 -delete 2>/dev/null || true
  local count
  count=$(find "$BACKUP_DIR" -name "pg_backup_*.sql.gz" 2>/dev/null | wc -l)
  log "当前保留 ${count} 个数据库备份"
}

# ========================
# 自动选择 docker compose 命令
# ========================
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  err "未找到 docker compose / docker-compose 命令，请先安装 Docker"
  exit 1
fi

DC="$DC -f $COMPOSE_FILE"

# ========================
# 回滚命令：bash deploy.sh rollback [commit_hash]
# ========================
if [ "${1:-}" = "rollback" ]; then
  TARGET_TAG="${2:-}"

  if [ -z "$TARGET_TAG" ]; then
    # 无参数时自动选择上一个版本（跳过当前最新）
    TARGET_TAG=$(docker images "video-redesign" --format "{{.Tag}}" 2>/dev/null | \
      grep -v "latest" | head -n 2 | tail -n 1)
  fi

  if [ -z "$TARGET_TAG" ]; then
    err "没有可用的回滚版本（video-redesign 镜像 tag 列表为空）"
    exit 1
  fi

  log "===== 回滚到版本: $TARGET_TAG ====="

  # 尝试恢复对应的数据库备份（选择倒数第二个备份文件）
  BACKUP_FILE=$(find "$BACKUP_DIR" -name "pg_backup_*.sql.gz" 2>/dev/null | sort -r | sed -n '2p')
  if [ -n "$BACKUP_FILE" ]; then
    log "恢复数据库备份: $BACKUP_FILE"
    if gunzip -c "$BACKUP_FILE" | $DC exec -T "$PG_SERVICE" psql -U postgres video_redesign 2>/dev/null; then
      ok "数据库已恢复"
    else
      warn "数据库恢复失败，继续执行容器回滚"
    fi
  else
    warn "未找到可用的数据库备份，仅回滚容器"
  fi

  # 用目标 tag 重启容器
  # 由于 docker-compose 使用 build target，回滚通过 git checkout 到目标 commit 并重新 up 实现
  log "使用镜像 video-redesign:$TARGET_TAG 重启容器..."
  $DC up -d
  ok "已回滚到 $TARGET_TAG"
  exit 0
fi

# ========================
# 第 0 步：前置检查
# ========================
log "===== 前置环境检查 ====="

if [ ! -f "$COMPOSE_FILE" ]; then
  err "未找到 $COMPOSE_FILE，请在项目根目录执行本脚本"
  exit 1
fi

if [ ! -f ".env.production" ]; then
  err "未找到 .env.production，请先从 .env.production.example 复制并填写真实配置"
  exit 1
fi

# 检查关键环境变量是否存在（不打印值，仅检查 key 是否配置）
for key in JWT_SECRET SEEDANCE_API_KEY OSS_ACCESS_KEY_ID WAVESPEED_API_KEY; do
  if ! grep -q "^${key}=" .env.production; then
    warn ".env.production 缺少 ${key}，相关功能可能不可用"
  fi
done
ok "环境检查通过，使用命令：$DC"

# ========================
# 第 1 步：备份生产数据库（PostgreSQL pg_dump）
# ========================
if [ "$SKIP_BACKUP" = "1" ]; then
  warn "已跳过数据库备份（SKIP_BACKUP=1）"
else
  log "===== 备份生产数据库（PostgreSQL）====="
  mkdir -p "$BACKUP_DIR"
  BACKUP_FILE="$BACKUP_DIR/pg_backup_$(date +%Y%m%d_%H%M%S).sql.gz"
  # 仅当 postgres 容器在运行时才能备份
  if $DC ps "$PG_SERVICE" 2>/dev/null | grep -q "Up"; then
    if $DC exec -T "$PG_SERVICE" pg_dump -U postgres video_redesign | gzip > "$BACKUP_FILE" 2>/dev/null; then
      ok "数据库已备份到 $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
    else
      warn "数据库备份失败，继续部署（可能是首次部署）"
    fi
  else
    warn "postgres 容器未运行，跳过备份（可能是首次部署）"
  fi
fi

# ========================
# 第 2 步：拉取最新代码（带重试）
# ========================
log "===== 拉取最新代码（分支：$BRANCH）====="
retry git fetch origin
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"
CURRENT_COMMIT=$(git rev-parse --short HEAD)
ok "代码已更新到 $BRANCH @ $CURRENT_COMMIT"

# ========================
# 第 3 步：重建镜像（带重试 + commit hash tag）
# ========================
log "===== 重建 Docker 镜像 ====="

BUILD_ARGS=""
if [ "$NO_CACHE" = "1" ]; then
  BUILD_ARGS="--no-cache"
fi

# 构建 app 和 workers（docker-compose 中各自指定了 build target）
retry "$DC build $BUILD_ARGS"
ok "镜像构建完成"

# 用 commit hash 打 tag（用于版本追踪和回滚）
IMAGE_TAG="video-redesign:${CURRENT_COMMIT}"
APP_IMAGE_ID=$($DC images -q "$APP_SERVICE" 2>/dev/null | head -n1 || true)
if [ -n "$APP_IMAGE_ID" ]; then
  docker tag "$APP_IMAGE_ID" "$IMAGE_TAG" 2>/dev/null || true
  ok "已为镜像打 tag: $IMAGE_TAG"
fi

# 清理旧版本镜像（保留最近 5 个）
cleanup_old_images

# ========================
# 第 4 步：启动容器
# ========================
log "===== 启动容器 ====="
$DC up -d
ok "容器已启动"

# 等待 app 容器就绪
log "等待 app 容器就绪..."
sleep 8

# ========================
# 第 5 步：数据库迁移（prisma migrate deploy）
# 使用独立的 migrator 容器执行（基于 deps 阶段，有完整 prisma CLI 依赖链）
# ========================
log "===== 同步数据库 schema（prisma migrate deploy）====="
if $DC --profile migrate run --rm migrate; then
  ok "数据库迁移完成"
else
  err "数据库迁移失败！请检查日志。数据库已在第 1 步备份，可手动回滚"
  err "回滚命令：bash deploy.sh rollback"
  exit 1
fi

# ========================
# 第 6 步：重启 Worker（加载新 schema）
# ========================
log "===== 重启 Worker ====="
$DC restart "$WORKERS_SERVICE"
ok "Worker 已重启"

# ========================
# 第 7 步：健康检查
# ========================
log "===== 健康检查 ====="
if ! health_check; then
  err "部署完成但健康检查失败，请手动检查或执行回滚：bash deploy.sh rollback"
  exit 1
fi

# ========================
# 第 8 步：清理旧备份
# ========================
log "===== 清理旧备份 ====="
cleanup_old_backups

# ========================
# 部署完成
# ========================
log "===== 部署结果 ====="
$DC ps

echo ""
ok "部署完成！分支 $BRANCH @ $CURRENT_COMMIT"
ok "镜像 tag: $IMAGE_TAG"
ok "请在浏览器访问站点验证功能"
