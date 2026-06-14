# GenesisPod - 客户离线部署（On-Prem）

源码不公开的客户本地部署方案。客户拿到的是预编译 Docker 镜像 tar 包 + 一份 compose 配置，看不到 TypeScript / Python 源码。

## 架构

```
客户机器:
  ┌──────────────────────────────────────────────┐
  │ docker network: genesis-network              │
  │                                              │
  │ [postgres]   [redis]   [flaresolverr]        │
  │     ↑           ↑           ↑                │
  │     └───────────┴───────────┘                │
  │              [backend:4000]    [ai-service]  │
  │                    ↑               ↑         │
  │                    └───────┬───────┘         │
  │                       [frontend:3000] ◀── 唯一对外端口
  └──────────────────────────────────────────────┘
                            ↑
                       浏览器 / 客户端
```

- **唯一对外端口**：frontend 容器的 3000，建议客户再套 nginx 加 TLS。
- **数据库不外露**：postgres / redis 仅 docker network 内可见，客户连不上 psql / redis-cli。
- **LLM 走 BYOK**：开发方的 OpenAI / Claude API key **不进镜像**，客户用管理员账号登录后录入自己的 key。

## 版本号策略

`build-bundle.sh` 自动按以下优先级决定 VERSION：

| 优先级 | 来源                                                     | 例子                          |
| ------ | -------------------------------------------------------- | ----------------------------- |
| 1      | 命令行参数                                               | `bash build-bundle.sh v1.0.0` |
| 2      | 当前 commit 的 git tag（`npm run release` 流程会打 tag） | `v40.12.0`                    |
| 3      | `package.json` version + git short SHA                   | `40.11.0-f51c60d`             |
| 4      | 兜底纯 git short SHA                                     | `f51c60d`                     |

## 发布渠道

镜像发布到 **GitHub Container Registry (ghcr.io)** 私有仓库 (genesis-release org)：

```
ghcr.io/genesis-release/genesis-backend:<version>     # 业务镜像
ghcr.io/genesis-release/genesis-frontend:<version>    # 业务镜像
ghcr.io/genesis-release/genesis-ai-service:<version>  # 业务镜像
ghcr.io/genesis-release/genesis-installer:<version>   # 配置传输镜像（~6MB alpine）
```

**客户拿到的只有 GitHub 账号 + PAT（read:packages 权限）**——配置由 installer 镜像 docker run 派发，无需邮件 / 网盘传输任何文件。备用 tar.gz 渠道（`dist/onprem/genesis-config-<VERSION>.tar.gz`）保留给离线 / 不能连 ghcr 的客户。

## 开发侧：发布流程

### 一次性：登录 ghcr.io

```bash
# 生成 PAT：GitHub → Settings → Developer settings → Tokens (classic)
#   勾 write:packages + read:packages + delete:packages
echo $GHCR_TOKEN | docker login ghcr.io -u <你的 github 用户名> --password-stdin
# 注：登录用的是你（org owner / member）的个人账号；镜像 owner 是 genesis-release org
```

### 每次发布

```bash
# 在项目根目录跑（Windows 用 git bash）
npm run onprem:bundle                        # 自动 VERSION + push to ghcr
npm run onprem:release                       # standard-version bump + push + bundle

# 或直接调脚本（更多选项）
bash infra/onprem/scripts/build-bundle.sh v1.0.0
bash infra/onprem/scripts/build-bundle.sh v1.0.0 --skip-build  # 复用本地镜像
bash infra/onprem/scripts/build-bundle.sh v1.0.0 --no-push     # 仅 build/tag，不 push
```

产物：

- 4 个镜像 push 到 ghcr.io/genesis-release/genesis-\*:vX.Y.Z（含 installer）
- `dist/onprem/genesis-config-<VERSION>.tar.gz`（~16KB，备用离线渠道）

**交付给客户**：把客户的 GitHub 账号加为 org packages collaborator (Read)，客户用**自己的** GitHub 账号 + 自己生成的 `read:packages` PAT 登录 ghcr.io。**不要把开发者自己的 PAT 发给客户**——会暴露你账号下所有 packages。

org 加 collaborator 路径：
https://github.com/orgs/genesis-release/packages → 每个 package → Package settings → Manage access → Add user

**首次发布前检查**：org packages 默认私有，但 Package settings 里再确认一次 Visibility = Private。

## 客户侧：统一入口 `genesis.sh`

前置条件：Docker 24+ + Docker Compose v2 + openssl + 联外网（可访问 ghcr.io）。

**首选路径：installer 镜像（零文件传输）**——3 行命令：

```bash
# 1. 用你自己的 GitHub 账号 + PAT 登录 ghcr.io（一次性）
docker login ghcr.io -u <你的 github 用户名>   # 提示输你自己的 read:packages PAT

# 2. 从 installer 镜像把配置"倒"到当前目录
docker run --rm -v "$(pwd):/out" ghcr.io/genesis-release/genesis-installer:v1.0.0

# 3. 一键安装
cd genesis-config-v1.0.0 && bash genesis.sh install
```

**备用路径：离线 / 不能连 ghcr 的客户**——开发方 scp 发 tar.gz：

```bash
tar -xzf genesis-config-v1.0.0.tar.gz
cd genesis-config-v1.0.0
docker login ghcr.io -u <你的 github 用户名>
bash genesis.sh install
```

### `genesis.sh` 命令清单

| 命令                                      | 用途                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| `bash genesis.sh preflight`               | 装前体检：docker / 磁盘 / 内存 / ghcr 连通性 / 端口 3000 占用           |
| `bash genesis.sh install`                 | 首次部署（自动跑 preflight + pull 镜像 + 生成密钥 + 启动 + 等 healthy） |
| `bash genesis.sh upgrade <new.tar.gz>`    | 升级（版本对比 + 备份 env + pull 新镜像 + 滚动重启 + 自动 migrate）     |
| `bash genesis.sh backup [dir]`            | 备份 PostgreSQL + volumes 到单个 tar.gz（默认 `./backups/`）            |
| `bash genesis.sh restore <backup.tar.gz>` | 从备份恢复（破坏性，输入 RESTORE 确认）                                 |
| `bash genesis.sh status`                  | 打印 5 容器健康度 + 关键端点 200 检查                                   |
| `bash genesis.sh logs [service]`          | 看日志（默认 backend）                                                  |
| `bash genesis.sh uninstall`               | 彻底拆卸（破坏性，输入 DELETE 确认）                                    |
| `bash genesis.sh help`                    | 帮助                                                                    |

### 交互细节

- **install** 会交互问：admin email / admin password / public base URL。`SKIP_PROMPTS=1` 跳交互（admin 用随机密码自动填，事后改）
- **upgrade** 同版本会询问；降级要求输入版本号二次确认。`FORCE=1` 跳过两个警告
- **backup** 产物含明文 `.env.production`，**异地存放前必须 gpg 加密**
- **uninstall** 必须输入 `DELETE` 才执行（防误用）

兼容老脚本（旧文档引用）：`bash install.sh` / `bash upgrade.sh` 仍然能跑，但内部就是 `exec genesis.sh ...`。

`upgrade.sh` 干了什么：

1. 校验：同版本会询问 / 降级会要求输入版本号二次确认
2. 备份当前 `.env.production` → `.env.production.bak.<时间戳>`
3. `docker pull` 新镜像（从 ghcr.io，按 IMAGES 元数据）
4. 替换 `docker-compose.yml` / `install.sh` / `upgrade.sh` / `README.md` / `IMAGES`（保留 `.env.production`）
5. 更新 `.env.production` 里的镜像 tag 引用
6. `docker compose up -d --force-recreate --no-deps backend frontend ai-service`（保留 postgres / redis volume）
7. 轮询 healthy

强制跳过版本警告（自动化）：`FORCE=1 bash upgrade.sh ...`

## 备份建议

```bash
# 数据库备份
docker compose exec postgres pg_dump -U genesis genesis > backup-$(date +%F).sql

# Volume 备份（缩略图 + 导出文件）
docker run --rm -v genesis_backend_thumbnails:/data -v $(pwd):/backup alpine \
  tar czf /backup/thumbnails-$(date +%F).tar.gz -C /data .
```

## 故障排查

| 现象                   | 排查方向                                                                      |
| ---------------------- | ----------------------------------------------------------------------------- |
| backend 一直 unhealthy | `docker compose logs backend`，看 Prisma migrate 是否失败                     |
| 前端打开 500           | 检查 NEXT_PUBLIC_API_URL 是否和客户实际域名一致                               |
| LLM 调用全部 401       | 没在 admin 后台配 BYOK key，或者 key 失效                                     |
| postgres 启不来        | volume 残留 / 密码改过：`docker compose down -v` 重新初始化（**会清空数据**） |
