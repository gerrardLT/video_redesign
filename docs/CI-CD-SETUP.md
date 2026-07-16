# CI/CD 自动部署设置指南

> **文档状态**：📗 活文档（运维有效）
> **用途/说明**：GitHub Actions → 宝塔服务器 CI/CD 自动部署配置指南
> **权威来源**：本仓库权威文档为 `AGENTS.md` + `docs/local-life-user-journey.md`
> **最后校准**：2026-07-11

## 架构

```
推送 main 分支 → GitHub Actions CI 检查 → SSH 到宝塔服务器 → 执行 deploy.sh → 部署完成
```

## 一次性设置步骤

### 1. 生成 SSH 密钥对（在你本地执行）

```bash
# 生成专用部署密钥（不要用你日常的 SSH key）
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/deploy_key -N ""
```

### 2. 把公钥添加到服务器

```bash
# 复制公钥到服务器的 authorized_keys
ssh-copy-id -i ~/.ssh/deploy_key.pub root@165.154.147.155

# 或者手动追加：
cat ~/.ssh/deploy_key.pub | ssh root@165.154.147.155 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

### 3. 在 GitHub 配置 Secrets

打开 https://github.com/gerrardLT/video_redesign/settings/secrets/actions

添加以下 Secrets：

| Secret 名称 | 值 | 说明 |
|---|---|---|
| `SERVER_SSH_KEY` | `~/.ssh/deploy_key` 的完整内容 | 私钥（`cat ~/.ssh/deploy_key`） |
| `SERVER_HOST` | `165.154.147.155` | 服务器 IP |
| `SERVER_USER` | `root` | SSH 用户名 |

### 4. 确认服务器项目目录

```bash
# SSH 到服务器确认目录存在
ssh root@165.154.147.155 "ls /www/wwwroot/video-redesign/deploy.sh"
```

### 5. 测试部署

```bash
# 本地推送任意修改到 main
git push origin main

# 打开 GitHub Actions 页面查看执行状态
# https://github.com/gerrardLT/video_redesign/actions
```

## 工作流说明

### CI 检查 (ci.yml)
- 触发：所有 main 推送 + PR
- 内容：安装依赖 → Prisma generate → 运行测试
- 用时：约 2-3 分钟

### 自动部署 (deploy.yml)
- 触发：推送 main 分支 + 手动触发
- 内容：SSH 到服务器执行 `deploy.sh`
- 用时：约 5-10 分钟（取决于 Docker 构建）
- 并发控制：同一时间只允许一个部署，后续排队

### 手动触发部署

GitHub 仓库 → Actions → "部署到生产环境" → Run workflow → 选择 main 分支 → 确认

## 部署流程详情（deploy.sh 内部）

```
1. 备份 PostgreSQL 数据库（pg_dump）
2. 拉取最新代码（git pull）
3. 重建 Docker 镜像（docker compose build）
4. 启动容器（docker compose up -d）
5. 数据库迁移（prisma migrate deploy）
6. 重启 Worker 进程
7. 健康检查
```

## 故障排查

### 部署失败

```bash
# SSH 到服务器查看日志
ssh root@165.154.147.155

# 查看应用日志
cd /www/wwwroot/video-redesign
docker compose -f docker-compose.prod.yml logs --tail=50 app
docker compose -f docker-compose.prod.yml logs --tail=50 workers

# 检查容器状态
docker compose -f docker-compose.prod.yml ps
```

### 回滚

```bash
# 查看最近的备份
ls -la /www/wwwroot/video-redesign/backups/

# 回滚到上一个 commit
cd /www/wwwroot/video-redesign
git log --oneline -5  # 找到要回滚的 commit
git reset --hard <commit-hash>
bash deploy.sh
```

### SSH 连接失败

```bash
# 本地测试 SSH 连接
ssh -i ~/.ssh/deploy_key root@165.154.147.155 "echo ok"

# 检查 GitHub Secret 是否正确（注意私钥开头结尾换行）
# 私钥应该以 -----BEGIN OPENSSH PRIVATE KEY----- 开头
```
