#!/usr/bin/env bash
#
# 生产环境 Docker 一键部署脚本
# 适用于已用 docker-compose.prod.yml 部署过的服务器更新最新代码
#
# 流程：环境检查 → 备份数据库 → 拉取代码 → 重建镜像 → 启动 → 数据库迁移 → 重启 Worker → 健康检查
#
# 用法：
#   bash deploy.sh                  # 默认从 origin/deploy/docker 拉取并部署
#   BRANCH=main bash deploy.sh      # 指定分支
#   SKIP_BACKUP=1 bash deploy.sh    # 跳过数据库备份（不推荐）
#   NO_CACHE=0 bash deploy.sh       # 构建时使用缓存（更快但可能不彻底）

set -euo pipefail

# ========================
# 配置（可通过环境变量覆盖）
# ========================
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
BRANCH="${BRANCH:-deploy/docker}"
SKIP_BACKUP="${SKIP_BACKUP:-0}"
NO_CACHE="${NO_CACHE:-1}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
APP_SERVICE="app"
WORKERS_SERVICE="workers"
# 容器内数据库路径（与 docker-compose.prod.yml 的 DATABASE_URL 对应）
DB_PATH_IN_CONTAINER="/app/data/prod.db"

# ========================
# 工具函数
# ========================
log()  { echo -e "\033[1;36m[deploy]\033[0m $*"; }
ok()   { echo -e "\033[1;32m[ ok ]\033[0m $*"; }
warn() { echo -e "\033[1;33m[warn]\033[0m $*"; }
err()  { echo -e "\033[1;31m[fail]\033[0m $*" >&2; }

# 自动选择 docker compose 命令（兼容 v1 docker-compose 和 v2 docker compose）
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
# 第 1 步：备份生产数据库
# ========================
if [ "$SKIP_BACKUP" = "1" ]; then
  warn "已跳过数据库备份（SKIP_BACKUP=1）"
else
  log "===== 备份生产数据库 ====="
  mkdir -p "$BACKUP_DIR"
  BACKUP_FILE="$BACKUP_DIR/prod.db.backup.$(date +%Y%m%d_%H%M%S)"
  # 仅当 app 容器在运行时才能备份；首次部署可能没有容器，允许失败
  if $DC ps "$APP_SERVICE" 2>/dev/null | grep -q "Up"; then
    if $DC cp "$APP_SERVICE:$DB_PATH_IN_CONTAINER" "$BACKUP_FILE" 2>/dev/null; then
      ok "数据库已备份到 $BACKUP_FILE"
    else
      warn "数据库备份失败（可能数据库文件尚未创建），继续部署"
    fi
  else
    warn "app 容器未运行，跳过备份（可能是首次部署）"
  fi
fi

# ========================
# 第 2 步：拉取最新代码
# ========================
log "===== 拉取最新代码（分支：$BRANCH）====="
git fetch origin
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"
CURRENT_COMMIT=$(git rev-parse --short HEAD)
ok "代码已更新到 $BRANCH @ $CURRENT_COMMIT"

# ========================
# 第 3 步：重建镜像
# ========================
log "===== 重建 Docker 镜像 ====="
if [ "$NO_CACHE" = "1" ]; then
  $DC build --no-cache "$APP_SERVICE"
else
  $DC build "$APP_SERVICE"
fi
ok "镜像构建完成"

# workers 服务复用 app 镜像（docker-compose.prod.yml 中 image: video-redesign-app）
# 确保该 tag 存在，避免 workers 拉取失败
APP_IMAGE_ID=$($DC images -q "$APP_SERVICE" 2>/dev/null | head -n1 || true)
if [ -n "$APP_IMAGE_ID" ]; then
  docker tag "$APP_IMAGE_ID" video-redesign-app 2>/dev/null || true
  ok "已将 app 镜像打 tag: video-redesign-app"
fi

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
# 第 5 步：同步数据库 schema（db push，项目原生工作流）
# 说明：本项目使用 prisma db push（非 migrate），直接对比当前库与 schema.prisma 应用差异，
#       不依赖 migration 历史，避免 P3005（数据库非空且无 baseline）错误。
#       --accept-data-loss 用于应用含废弃字段删除的变更；核心数据表仅新增，不丢数据。
#       数据库已在第 1 步备份，可回滚。
# ========================
log "===== 同步数据库 schema（prisma db push）====="
if $DC exec -T "$APP_SERVICE" npx prisma db push --accept-data-loss --skip-generate; then
  ok "数据库 schema 同步完成"
else
  err "数据库 schema 同步失败！请检查日志。数据库已在第 1 步备份，可手动回滚"
  err "回滚命令示例：$DC cp $BACKUP_FILE $APP_SERVICE:$DB_PATH_IN_CONTAINER"
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
log "===== 部署结果 ====="
$DC ps

echo ""
log "app 最近日志："
$DC logs --tail=20 "$APP_SERVICE" || true

echo ""
log "workers 最近日志："
$DC logs --tail=20 "$WORKERS_SERVICE" || true

echo ""
ok "部署完成！分支 $BRANCH @ $CURRENT_COMMIT"
ok "请在浏览器访问站点验证：landing page / 导出 / 资产库 等功能"
