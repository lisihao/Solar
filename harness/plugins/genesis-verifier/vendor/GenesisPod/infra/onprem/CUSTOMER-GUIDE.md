# GenesisPod 客户运维手册

> 在线最新版：**https://github.com/genesis-release/docs**
> 本副本由你的 installer 镜像离线分发，与上述线上版本一致（按 installer 镜像 tag 对应版本）

这份手册是装机、升级、备份、排查问题的全程指南。**首选用 `genesis.sh` 一键命令**；如果脚本出错，每条命令都附了「手动操作」备用步骤，照着做也能搞定。

---

## 0. 准备工作

### 0.1 服务器要求

| 项                        | 最低                                | 推荐              |
| ------------------------- | ----------------------------------- | ----------------- |
| OS                        | Ubuntu 22.04 / CentOS 8 / Debian 11 | Ubuntu 24.04 LTS  |
| CPU                       | 2 核                                | 4 核              |
| 内存                      | 4GB                                 | 8GB               |
| 磁盘（`/var/lib/docker`） | 30GB                                | 100GB+            |
| 网络                      | 能访问 `ghcr.io`                    | 同左 + HTTPS 出网 |

### 0.2 必装软件

```bash
# Ubuntu / Debian
sudo apt update
sudo apt install -y docker.io docker-compose-plugin openssl curl tar

# CentOS / RHEL
sudo dnf install -y docker docker-compose-plugin openssl curl tar
sudo systemctl enable --now docker

# 验证版本
docker --version           # 期望 24.0+
docker compose version     # 期望 v2.x
```

### 0.3 让当前用户能直接跑 docker（不用 sudo）

```bash
sudo usermod -aG docker $USER
newgrp docker        # 立即生效（或重新登录）
docker ps            # 不报权限错就 OK
```

### 0.4 登录 ghcr.io

```bash
# 用「你自己的」GitHub 账号 + 自己的 PAT
# PAT 生成路径：GitHub Settings → Developer settings → Personal access tokens (classic)
# 只勾 read:packages 权限即可
echo "ghp_你的token" | docker login ghcr.io -u <你的 github 用户名> --password-stdin
```

> 这一步只需做一次。凭据存在 `~/.docker/config.json`，之后所有 docker pull 都自动用。

---

## 1. 首次安装

### 一键命令（90% 情况）

```bash
# 1. 把配置「倒」到当前目录
docker run --rm -v "$(pwd):/out" ghcr.io/genesis-release/genesis-installer:v40.2.28

# 2. 进入新目录
cd genesis-config-v40.2.28

# 3. 一键安装
bash genesis.sh install
```

期间会问 3 个问题：

- `Admin email` —— 第一个管理员的邮箱（自动建账号）
- `Admin password` —— 至少 8 字符
- `Public base URL` —— 用户浏览器输入的访问地址（如 `https://genesis.acme.com`，留空走同源）

跑完 5-10 分钟（首次拉镜像 3.4GB + 数据库迁移），出现 `✓ GenesisPod 部署完成` 即成功。

### 手动操作（脚本失败时）

```bash
# 1. 检查环境（脚本能告诉你哪里不对）
bash genesis.sh preflight

# 2. 手动拉镜像
docker pull ghcr.io/genesis-release/genesis-backend:v40.2.28
docker pull ghcr.io/genesis-release/genesis-frontend:v40.2.28
docker pull ghcr.io/genesis-release/genesis-ai-service:v40.2.28

# 3. 手动生成 .env.production
cp .env.production.example .env.production
# 用 openssl rand -hex 32 生成 6 个密钥，写进 .env：
#   POSTGRES_PASSWORD, REDIS_PASSWORD, JWT_SECRET, JWT_REFRESH_SECRET,
#   SETTINGS_ENCRYPTION_KEY, STORAGE_ADMIN_KEY
# 然后填 ADMIN_INITIAL_EMAIL / ADMIN_INITIAL_PASSWORD / PUBLIC_BASE_URL
chmod 600 .env.production

# 4. 启动
docker compose --env-file .env.production up -d

# 5. 看 backend 启动进度
docker logs -f genesis-backend
# 看到 "Nest application successfully started" 即可
```

---

## 2. 装完之后

### 2.1 登录

浏览器打开你填的 `Public base URL`（或 `http://服务器IP:3000`），用刚填的 admin email + password 登录。

**立即做的两件事**：

1. 进「设置 → 账号 → 修改密码」改密码
2. 进「系统 → AI → 模型」录 LLM API key（OpenAI / Claude / Gemini 至少配一个，否则所有 AI 功能不可用）

### 2.2 健康检查

```bash
bash genesis.sh status
```

正常输出：

```
容器状态
  genesis-postgres        Up    healthy
  genesis-redis           Up    healthy
  genesis-backend         Up    healthy   ← 这个最重要
  genesis-frontend        Up    healthy
  genesis-ai-service      Up    running   （无 healthcheck）
  genesis-flaresolverr    Up    running
关键端点
  ✓ backend /health
```

任一容器是 `unhealthy` 或 `Exited`，看 §6 故障排查。

---

## 3. 升级版本

### 一键升级（推荐）

```bash
# 1. 先看有没有新版
bash genesis.sh check-update
# 输出：
#   当前版本: v40.2.28
#   最新版本: v40.3.0
#   有新版本可用，运行：bash genesis.sh upgrade v40.3.0

# 2. 升级（自动拉镜像 + 滚动重启，老数据保留）
bash genesis.sh upgrade v40.3.0
```

> 整个过程 2-5 分钟。`.env.production` 会自动备份成 `.env.production.bak.<时间戳>`，
> 升级失败可以手动回滚（见 §3 末尾）。

### 离线升级（不能连 ghcr 的环境）

向开发方索要 `genesis-config-vX.Y.Z.tar.gz`，scp 到服务器，然后：

```bash
bash genesis.sh upgrade /tmp/genesis-config-v40.3.0.tar.gz
```

### 升级失败回滚

```bash
# 1. 恢复 .env.production 备份
cp .env.production.bak.20260513_103045 .env.production

# 2. 恢复旧版 docker-compose（如果开发方给你了旧 bundle）
# 或者：编辑 .env.production，把 BACKEND_IMAGE / FRONTEND_IMAGE / AI_SERVICE_IMAGE 改回旧 tag

# 3. 重启
docker compose --env-file .env.production up -d --force-recreate
```

如果数据库 schema 已经迁移过（多见于跨大版本升级），单纯回滚 image 不够，必须先用 backup 还原数据库（见 §5）。**所以升级前务必备份。**

---

## 4. 备份数据

### 一键备份

```bash
bash genesis.sh backup                # 输出到 ./backups/
bash genesis.sh backup /mnt/backup    # 输出到指定目录
```

产物：`genesis-backup-<时间戳>.tar.gz`，包含：

- `postgres.sql` —— 数据库全量 dump（用户、配置、所有 LLM 历史）
- `backend_thumbnails.tar.gz` —— 缩略图
- `backend_exports.tar.gz` —— 导出文件
- `env.production.encrypted-please` —— 你的 `.env.production`（含数据库密码、JWT secret，**异地存放必须 gpg 加密**）

### 手动备份（脚本失败时）

```bash
# 1. 数据库
docker exec genesis-postgres pg_dump -U genesis genesis > backup-db-$(date +%F).sql

# 2. 缩略图 + 导出文件
docker run --rm \
  -v $(basename $PWD)_backend_thumbnails:/data \
  -v $(pwd):/out \
  alpine tar czf /out/backup-thumbnails-$(date +%F).tar.gz -C /data .

docker run --rm \
  -v $(basename $PWD)_backend_exports:/data \
  -v $(pwd):/out \
  alpine tar czf /out/backup-exports-$(date +%F).tar.gz -C /data .

# 3. 加密 .env.production
gpg --symmetric .env.production
# 生成 .env.production.gpg，原文件保留即可
```

### 加密 + 异地存放

```bash
# 加密备份
gpg --symmetric --cipher-algo AES256 genesis-backup-20260513_103045.tar.gz
# 输入两次密码，生成 .tar.gz.gpg，删原文件
rm genesis-backup-20260513_103045.tar.gz

# 上传到 S3 / Aliyun OSS / 自己的备份服务器
aws s3 cp genesis-backup-20260513_103045.tar.gz.gpg s3://your-backup-bucket/
# 或 scp 到另一台服务器
```

**建议**：每天 cron 跑一次：

```bash
crontab -e
# 加入：每天凌晨 3 点备份
0 3 * * * cd /opt/genesis-config-v40.2.28 && bash genesis.sh backup /mnt/backup >> /var/log/genesis-backup.log 2>&1
```

---

## 5. 从备份还原

> **破坏性操作**：会覆盖当前数据库和文件。先 `genesis.sh backup` 备份一次当前状态再操作。

### 一键还原

```bash
bash genesis.sh restore /path/to/genesis-backup-20260513_103045.tar.gz
# 提示输入 RESTORE 确认
```

### 手动还原（脚本失败时）

```bash
# 1. 停服务
docker compose stop

# 2. 还原数据库
docker compose start postgres
sleep 5
docker exec -i genesis-postgres dropdb -U genesis genesis --if-exists
docker exec -i genesis-postgres createdb -U genesis genesis
cat backup-db-2026-05-13.sql | docker exec -i genesis-postgres psql -U genesis genesis

# 3. 还原 volumes
docker run --rm \
  -v $(basename $PWD)_backend_thumbnails:/data \
  -v $(pwd):/in \
  alpine sh -c "cd /data && tar xzf /in/backup-thumbnails-2026-05-13.tar.gz"

# 4. 重启全栈
docker compose --env-file .env.production up -d
```

---

## 6. 故障排查

### 6.1 backend 一直 unhealthy

```bash
# 1. 先看日志最后 100 行
bash genesis.sh logs backend
# 或：docker logs --tail 100 genesis-backend

# 2. 常见原因和对策
```

| 日志关键字                     | 原因                     | 对策                                                                                                                                     |
| ------------------------------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `prisma migrate` + error       | 数据库迁移失败           | 第一次启动可能要 30 分钟跑全量迁移，请耐心等；超过 30 分钟看下一行报错                                                                   |
| `EACCES` / `permission denied` | 卷挂载权限               | `docker compose down && docker volume rm $(basename $PWD)_backend_thumbnails && bash genesis.sh install`（**会丢缩略图，但不丢数据库**） |
| `connect ECONNREFUSED redis`   | redis 容器没起           | `docker compose ps redis`，看是否 healthy；不是就 `docker compose restart redis`                                                         |
| `JWT secret must be set`       | `.env.production` 缺密钥 | `bash genesis.sh preflight` 不会发现这个，手动 cat `.env.production` 看是否齐全 6 个密钥                                                 |
| `Cannot find module`           | 镜像不完整               | `docker pull <镜像名>` 重拉一次                                                                                                          |

### 6.2 前端打开 502 / 500

```bash
# 1. backend 是否健康
bash genesis.sh status

# 2. 浏览器开发者工具 → Network，看请求的 URL 对不对
#    如果 URL 是 localhost:4000 而服务器 IP 不是 localhost → 改 .env.production 里的 PUBLIC_BASE_URL
sed -i 's|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=http://你的服务器IP:3000|' .env.production
docker compose --env-file .env.production up -d --force-recreate frontend
```

### 6.3 LLM 全部 401 / 不可用

不是 bug，是没配 BYOK key：

1. 浏览器登录 admin
2. 进「系统 → AI → 模型」
3. 在 OpenAI / Claude / Gemini 任意一栏录入你自己的 API key
4. 点「测试连接」，绿勾即可

### 6.4 端口 3000 被占用

```bash
# 1. 查谁占用
sudo ss -tlnp | grep :3000        # 或 sudo netstat -tlnp | grep :3000

# 2. 改 GenesisPod 监听端口（如 改成 8080）
sed -i 's|^FRONTEND_PORT=.*|FRONTEND_PORT=8080|' .env.production
docker compose --env-file .env.production up -d --force-recreate frontend
# 然后访问 http://服务器IP:8080
```

### 6.5 磁盘满了

```bash
# 1. 看 docker 占用
docker system df

# 2. 清理未用的镜像（不影响在跑的容器）
docker image prune -a   # 删除所有未被引用的 image，谨慎

# 3. 数据库占多大
docker exec genesis-postgres du -sh /var/lib/postgresql/data
```

### 6.6 想重置一切，重头开始

> **会丢全部数据，不可恢复**。先备份。

```bash
bash genesis.sh uninstall
# 输入 DELETE 确认
# 然后重新装：
docker run --rm -v "$(pwd):/out" ghcr.io/genesis-release/genesis-installer:v40.2.28
cd genesis-config-v40.2.28
bash genesis.sh install
```

---

## 7. 日常运维

### 看实时日志

```bash
bash genesis.sh logs              # backend 日志（默认）
bash genesis.sh logs frontend
bash genesis.sh logs postgres
```

### 重启某个服务

```bash
docker compose restart backend
# 或重启所有
docker compose --env-file .env.production restart
```

### 进容器调试

```bash
docker exec -it genesis-backend sh
docker exec -it genesis-postgres psql -U genesis genesis
```

### 监控容器资源占用

```bash
docker stats genesis-backend genesis-frontend genesis-ai-service
```

---

## 8. 安全建议

1. **`.env.production` 必须 chmod 600**，备份必须 gpg 加密
2. **不要把 3000 端口直接暴露公网**，用 nginx + Let's Encrypt 套 HTTPS：
   ```nginx
   server {
       listen 443 ssl http2;
       server_name genesis.your-domain.com;
       ssl_certificate /etc/letsencrypt/live/genesis.your-domain.com/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/genesis.your-domain.com/privkey.pem;
       location / {
           proxy_pass http://localhost:3000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
       }
   }
   ```
3. **每月轮换 JWT secret**（视情况）
4. **PAT 必须只授 `read:packages`**，不要给完整 repo 权限
5. **服务器 SSH 关掉密码登录，只用密钥 + fail2ban**

---

## 9. 内置数据从哪里来

刚装完，登录 admin 后台你能看到的内置数据：

| 来源                                      | 内容                                                                                                                                                 | 数量                                    |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| **Prisma schema migrations**              | AI 模型默认 4 个（grok / gpt-4 / claude / gemini）、AI providers 18 个（OpenAI/Anthropic/Doubao/Kimi/...）、数据源 5+ 个（arxiv / hackernews / ...） | 自动随首次 `prisma migrate deploy` 落库 |
| **后端启动时 `SeedSyncService` 幂等同步** | Simulation 外部数据源（market/finance/news/regulation）、YouTube 默认订阅源（Y Combinator / Bloomberg Tech / Lenny's Podcast 等）                    | backend 容器每次启动跑，已有数据不覆盖  |
| **代码注册（不走 DB）**                   | 所有 Tool（Tavily/Serper/arxiv 搜索/...）、所有 Skill（48 个 SKILL.md）                                                                              | 自动可用，无需配置                      |

**唯一你必须做的**：登录 admin → 系统 → AI → 模型，给至少一个模型录 BYOK API key（OpenAI / Claude / Gemini 选一个），否则所有 LLM 调用 401。

**完全为空、admin 自己创建的**：AI 团队模板、写作风格模板、Prompt 模板、报告模板 —— 这些是给客户灵活定制用，不预置默认值。

**升级时**：如果新版本要加内置数据（如 v40.3.x 新增一批 YouTube 源），开发方会把它放在 `SeedSyncService` 数据文件里，你 `bash genesis.sh upgrade vX.Y.Z` 时自动跑同步，已有的数据不会丢、新数据会补进来。

如要禁用自动同步（极少用，比如手动调试）：`.env.production` 加 `SEED_SYNC_ENABLED=false` 后重启 backend。

---

## 10. 联系开发方

遇到上面没覆盖的问题：

1. 跑 `bash genesis.sh status` 截图
2. 跑 `bash genesis.sh logs backend` 抓最后 200 行
3. 发邮件给开发方：**hello@gens.team**

附上以上两份输出 + 你做了什么操作 + 期望结果 vs 实际结果，加快诊断。

---

**手册版本**：跟随 `VERSION` 文件。如果你在 `genesis-config-v40.2.28/` 目录里，对应这份手册的 v40.2.28 版本。
