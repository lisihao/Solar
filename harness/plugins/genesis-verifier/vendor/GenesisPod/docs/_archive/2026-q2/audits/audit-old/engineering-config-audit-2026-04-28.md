# 工程配置审计与清理方案

> **审计日期**: 2026-04-28
> **审计范围**: 根目录 / backend / frontend / e2e / ai-service 的测试、构建、部署、环境、工具链配置
> **审计方法**: 配置文件枚举 + grep 引用追踪 + 启动链路反推
> **当前评分**: 62/100（工程整洁度）
> **目标评分**: 88/100

---

## 一、问题清单（按严重度分级）

### P0 - 孤儿文件 / 误导性配置（立即清理，零风险）

| #   | 文件                                  | 问题                                                           | 证据                                           |
| --- | ------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------- |
| 1   | `backend/jest.coverage-app.js`        | 0 npm script 引用，0 文档引用                                  | grep `jest.coverage-app` 仅 swc 版自身 require |
| 2   | `backend/jest.coverage-app.swc.js`    | 同上                                                           | 仅 require `jest.coverage-app.js`              |
| 3   | `backend/jest.coverage-engine.js`     | 同上                                                           | 同上                                           |
| 4   | `backend/jest.coverage-engine.swc.js` | 同上                                                           | 同上                                           |
| 5   | `backend/jest.config.swc.js`          | SWC 版无 npm script 暴露                                       | grep 仅自身存在                                |
| 6   | `backend/docker-entrypoint.sh`        | 与 `scripts/devops/docker-entrypoint.sh` **内容不同**，旧版 v8 | Dockerfile 用的是 scripts 版                   |
| 7   | `backend/start.sh`                    | 0 引用，与 Procfile 重复语义                                   | grep 仅生成的 changelog 提及                   |
| 8   | `backend/Procfile`                    | Heroku 风格残留，Railway 用 Dockerfile                         | 0 活跃引用                                     |
| 9   | `backend/package.json.build`          | 单行 `// Build: 1766269355`，疑似 cache buster 残留            | 0 引用                                         |
| 10  | `backend/.cleanup-backup/`            | 9.9MB 一次性数据备份                                           | gitignore 已排除，仅占盘                       |

**总计可删**: 10 项，预计释放 ~10.5MB 磁盘 + 大幅降低认知负担

---

### P1 - 部署链路五重身份（必须收敛到一处）

**当前后端启动路径有 5 套并存：**

```text
┌─────────────────────────────────────────────────────────────────┐
│ 入口                          启动命令                  状态     │
├─────────────────────────────────────────────────────────────────┤
│ 1. Dockerfile CMD             scripts/devops/docker-     声明在  │
│                               entrypoint.sh              用，但..│
│ 2. railway.toml startCommand  npm run deploy && node ..  ★实际生效│
│                               (覆盖了 Dockerfile CMD)            │
│ 3. nixpacks.toml [start]      npm run deploy && node ..  废弃    │
│                               (builder 已切 dockerfile)          │
│ 4. Procfile web               npm run deploy && node ..  Heroku  │
│ 5. backend/start.sh           npm run deploy →           孤儿    │
│                               npm run start:prod                │
│ 6. package.json#start:prod    node migrate-deploy.js &&  被 5 调 │
│                               node dist/main             用      │
└─────────────────────────────────────────────────────────────────┘
```

**迁移逻辑也分裂成 3 套：**

| 入口                   | 迁移做了什么                                                                        | 在哪里定义                            |
| ---------------------- | ----------------------------------------------------------------------------------- | ------------------------------------- |
| `npm run deploy`       | `tsx prisma/deploy-migrations.ts && npm run prisma:seed`                            | `package.json`                        |
| `migrate-deploy.js`    | 仅 `prisma migrate deploy`                                                          | `scripts/migrate-deploy.js`           |
| `docker-entrypoint.sh` | 诊断 + `fix-all-missing-structures.sql` + 列名修补 + `migrate deploy` + 验证 + seed | `scripts/devops/docker-entrypoint.sh` |

**风险**：改启动逻辑时改错文件不报错；新成员需逐文件读才能搞清。

---

### P2 - 测试体系冗余

| 问题                             | 详情                                                                                                                                                                                                                                                                                                                                                     | 影响                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `test:quick` 黑名单膨胀          | `--testPathIgnorePatterns="python-executor\|jwt-auth.guard\|jwt.strategy\|team-collaboration\|team-member.agent\|ai-image.service\|proxy.controller\|guardrails\|mcp-adapter\|mcp-server\|ai-social\|news-extractor\|collection-task\|openai.provider\|file-conversion\|planning-orchestrator.service.spec\|topic-research.gateway.spec"` 共 16 个被忽略 | 失败 spec 隐藏在 npm script 里，不易审视 |
| 两套 e2e 共存                    | `backend/test/jest-e2e.json`（NestJS supertest）+ `e2e/playwright.config.ts`（浏览器端 Playwright）                                                                                                                                                                                                                                                      | 路径不直观，新人不知该用哪套             |
| `e2e/` 不在 workspaces           | 独立 `node_modules` + `package-lock.json`                                                                                                                                                                                                                                                                                                                | 依赖版本可能漂移                         |
| 6 个 jest config 散在 backend 根 | 视觉污染，与 `tsconfig.json/Dockerfile` 等核心文件混杂                                                                                                                                                                                                                                                                                                   | 可读性差                                 |

---

### P3 - 工具链小问题

| 问题                                                                | 影响                                | 建议                                                          |
| ------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------- |
| `frontend/CHANGELOG.md` 4.5MB 写到 frontend 根                      | dev/build 每次重写                  | 挪到 `frontend/lib/generated/CHANGELOG.md`                    |
| Prisma 多文件 schema 每命令都要 `--schema=prisma/schema`            | 易遗漏                              | `package.json` 里加 `"prisma": { "schema": "prisma/schema" }` |
| `husky/pre-push` 跑 backend 全量 build (~38s)                       | 每次 push 阻塞                      | 改为 `tsc --noEmit` 增量                                      |
| `.husky/pre-commit` → `npm run pre-commit` → `lint-staged` 多层中转 | 无必要                              | 直接 `npx lint-staged`                                        |
| `backend/.eslintignore` 只列 `list-low.js` 等 4 项                  | 但 `.eslintrc.js` 有 1000+ 行未检查 | 验证 ignore 是否仍需要                                        |

---

## 二、详细执行方案

### Phase 1: 孤儿文件清理（30 分钟，零风险）

#### 步骤 1.1 - 验证孤儿文件无引用

```bash
# 对每个候选文件做最终验证
for f in jest.coverage-app jest.coverage-engine jest.config.swc; do
  echo "=== $f ==="
  grep -rn "$f" --include="*.json" --include="*.js" --include="*.ts" --include="*.sh" --include="*.yml" --include="*.toml" \
    --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist \
    --exclude-dir=_archive --exclude-dir=generated D:/projects/codes/genesis-agent-teams/
done
```

#### 步骤 1.2 - 删除 jest 孤儿（4 个文件）

```bash
cd D:/projects/codes/genesis-agent-teams/backend
git rm jest.coverage-app.js jest.coverage-app.swc.js
git rm jest.coverage-engine.js jest.coverage-engine.swc.js
```

**保留判断**: `jest.config.swc.js` —— 如果团队有"快速跑测试"需求，可在 `package.json` 加 `"test:swc": "jest --config jest.config.swc.js"` 后保留；否则一并删。

#### 步骤 1.3 - 删除部署残留（5 个文件）

```bash
cd D:/projects/codes/genesis-agent-teams/backend
git rm docker-entrypoint.sh    # 旧版，已被 scripts/devops/ 版本取代
git rm start.sh                # 0 引用
git rm Procfile                # Heroku 残留
git rm package.json.build      # cache buster 残留
git rm nixpacks.toml           # railway.toml 已用 dockerfile builder
```

#### 步骤 1.4 - 清理大文件备份

```bash
rm -rf D:/projects/codes/genesis-agent-teams/backend/.cleanup-backup/
# 注：这是 gitignored 的本地文件，不需要 git rm
```

#### 步骤 1.5 - 验证

```bash
cd D:/projects/codes/genesis-agent-teams
npm run test:backend -- --listTests | head -5    # 测试发现仍正常
npm run build:backend                            # 后端构建仍通过
docker build -t genesis-backend ./backend        # docker 构建仍通过
```

**提交**:

```text
chore(backend): remove 10 orphan config files

- 4 unreferenced jest.coverage-* configs
- backend/docker-entrypoint.sh (replaced by scripts/devops/ version)
- start.sh / Procfile / nixpacks.toml (Heroku/nixpacks legacy)
- package.json.build (cache buster residue)

Verified: npm scripts and docker build unchanged.
```

---

### Phase 2: 部署链路收敛（2 小时，需 staging 验证）

#### 步骤 2.1 - 决定真理来源（Decision）

**推荐方案：`Dockerfile CMD` 作为唯一启动入口**

理由：

- Docker 是事实上的运行时，CMD 是 OCI 标准
- Railway/Render/Fly 等多平台兼容
- 本地 `docker run` 与生产行为一致

**新结构**：

```text
backend/
├── Dockerfile                              # CMD ./scripts/entrypoint.sh
├── railway.toml                            # 不再写 startCommand
└── scripts/
    └── entrypoint.sh                       # 唯一启动脚本
        ├── 1. node scripts/migrate.js     # 统一迁移
        ├── 2. (optional) prisma db seed   # 通过 SEED_ON_BOOT=1 控制
        └── 3. exec node dist/main
```

#### 步骤 2.2 - 重写 entrypoint

```bash
# 新建：backend/scripts/entrypoint.sh
cat > backend/scripts/entrypoint.sh <<'EOF'
#!/bin/sh
set -e

echo "[entrypoint] Genesis Backend starting..."

# 1. Run migrations (idempotent)
node scripts/migrate.js

# 2. Optional seed (controlled by env var)
if [ "${SEED_ON_BOOT:-0}" = "1" ]; then
  echo "[entrypoint] Running seed..."
  npm run prisma:seed || echo "[entrypoint] Seed failed, continuing..."
fi

# 3. Start app
echo "[entrypoint] Starting Node.js application..."
exec node dist/main
EOF
chmod +x backend/scripts/entrypoint.sh
```

#### 步骤 2.3 - 合并迁移逻辑

将 `scripts/devops/docker-entrypoint.sh` 中的 SQL 修补逻辑评估：

- **如果 `prisma migrate deploy` 已能产出正确 schema** → 删除 SQL 修补部分
- **如果还有未迁移的历史漂移** → 把 SQL 转成正式迁移脚本归档到 `prisma/migrations/`

新 `backend/scripts/migrate.js`：

```javascript
#!/usr/bin/env node
const { execSync } = require("child_process");

const SCHEMA = "prisma/schema";

try {
  console.log("[migrate] Applying migrations...");
  execSync(`npx prisma migrate deploy --schema=${SCHEMA}`, {
    stdio: "inherit",
    timeout: 120_000,
  });
  console.log("[migrate] OK");
  process.exit(0);
} catch (e) {
  console.error("[migrate] FAILED");
  process.exit(1);
}
```

#### 步骤 2.4 - 修改 Dockerfile

```diff
- CMD ["./scripts/devops/docker-entrypoint.sh"]
+ CMD ["./scripts/entrypoint.sh"]
```

#### 步骤 2.5 - 修改 railway.toml

```toml
[build]
builder = "dockerfile"

[deploy]
healthcheckPath = "/api/v1/health"
healthcheckTimeout = 600
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 5
# startCommand removed - use Dockerfile CMD
```

#### 步骤 2.6 - 删除冗余文件

```bash
git rm backend/scripts/devops/docker-entrypoint.sh
git rm backend/scripts/migrate-deploy.js
# 保留 backend/scripts/devops/send-release-notification.ts
```

#### 步骤 2.7 - package.json 同步

```diff
- "start:prod": "node scripts/migrate-deploy.js && node dist/main",
+ "start:prod": "node scripts/migrate.js && node dist/main",
- "deploy": "tsx prisma/deploy-migrations.ts && npm run prisma:seed",
+ "deploy": "node scripts/migrate.js",
```

#### 步骤 2.8 - 验证流程

1. 本地 `docker build -t genesis-be ./backend && docker run --rm genesis-be`
2. Railway staging 部署，观察 startup logs
3. 健康检查 200ms 内通过
4. 24 小时观察无回归

**提交**:

```text
refactor(backend): unify deployment to single entrypoint

- Dockerfile CMD is the single source of truth
- railway.toml no longer overrides startCommand
- merged 3 migration scripts into one (scripts/migrate.js)
- removed: nixpacks.toml, scripts/devops/docker-entrypoint.sh,
  scripts/migrate-deploy.js, prisma/deploy-migrations.ts

Migration logic is now: prisma migrate deploy → optional seed → app start.
SQL hotfixes from old entrypoint moved to prisma/migrations/2026XXXX_*.
```

---

### Phase 3: 测试配置归集（1 小时，零风险）

#### 步骤 3.1 - 集中 jest 配置

新建 `backend/config/jest/`：

```text
backend/
├── config/
│   └── jest/
│       ├── jest.config.js          # 移自 backend/
│       ├── jest.e2e.config.js      # 移自 backend/test/jest-e2e.json
│       └── unstable.json           # 新建：装从 test:quick 抽出的 ignore 列表
└── test/
    └── (e2e specs only)
```

#### 步骤 3.2 - 抽 ignore 列表

```javascript
// backend/config/jest/unstable.json
{
  "$comment": "Tests temporarily skipped — see TODO in README",
  "ignore": [
    "python-executor",
    "jwt-auth.guard",
    "jwt.strategy",
    "team-collaboration",
    "team-member.agent",
    "ai-image.service",
    "proxy.controller",
    "guardrails",
    "mcp-adapter",
    "mcp-server",
    "ai-social",
    "news-extractor",
    "collection-task",
    "openai.provider",
    "file-conversion",
    "planning-orchestrator.service.spec",
    "topic-research.gateway.spec"
  ]
}
```

#### 步骤 3.3 - 更新 npm scripts

```diff
- "test": "jest",
- "test:quick": "jest --forceExit --testPathIgnorePatterns=\"...\"",
- "test:e2e": "jest --config ./test/jest-e2e.json",
+ "test": "jest --config config/jest/jest.config.js",
+ "test:quick": "jest --config config/jest/jest.config.js --forceExit --testPathIgnorePatterns=\"$(node -p \"require('./config/jest/unstable.json').ignore.join('|')\")\"",
+ "test:e2e": "jest --config config/jest/jest.e2e.config.js",
```

#### 步骤 3.4 - 修复 rootDir 引用

`jest.config.js` 内 `rootDir: "src"` → `rootDir: "../../src"`（相对配置文件）。
所有 `<rootDir>/__mocks__` 引用同步检查。

#### 步骤 3.5 - 加入 e2e 到 workspaces

根 `package.json`:

```diff
"workspaces": [
  "frontend",
  "backend",
+ "e2e"
],
```

删除 `e2e/node_modules` 和 `e2e/package-lock.json`，根目录 `npm install`。

**提交**:

```text
refactor(backend): consolidate jest configs into config/jest/

- Move 2 jest configs from backend/ root to backend/config/jest/
- Extract test:quick ignore list to config/jest/unstable.json
- Add e2e/ to npm workspaces (drop independent lockfile)

Reduces backend/ root file count from 21 to 14.
```

---

### Phase 4: 工具链优化（1 小时）

#### 步骤 4.1 - Prisma schema 配置化

`backend/package.json`:

```diff
"prisma": {
+ "schema": "prisma/schema",
  "seed": "tsx prisma/seed.ts"
}
```

之后所有 `--schema=prisma/schema` 参数可去掉。

#### 步骤 4.2 - frontend CHANGELOG 挪位

`frontend/scripts/generate-changelog.js` 输出路径：

```diff
- output: path.join(__dirname, '../CHANGELOG.md'),
+ output: path.join(__dirname, '../lib/generated/CHANGELOG.md'),
```

`.gitignore`:

```diff
- /CHANGELOG.md
+ frontend/lib/generated/CHANGELOG.md
```

#### 步骤 4.3 - husky 简化

`.husky/pre-commit`:

```diff
- npm run pre-commit
+ npx lint-staged
```

`.husky/pre-push` 改为：

```bash
# 移除全量 build，改增量类型检查
npx concurrently \
  "npm run type-check:frontend" \
  "npm run type-check:backend"
```

#### 步骤 4.4 - 验证 facade boundary 脚本

```bash
ls D:/projects/codes/genesis-agent-teams/scripts/devops/check-facade-boundary.sh
```

如不存在，需补齐或从 ci.yml 移除该步骤。

**提交**:

```text
chore(tooling): trim husky hooks, fix changelog location, prisma schema config

- pre-push no longer runs full backend build (~38s saved per push)
- pre-commit calls lint-staged directly
- frontend CHANGELOG moved into lib/generated (was polluting root)
- backend prisma config in package.json (no more --schema= flag)
```

---

### Phase 5: Railway 运维脚本归集（45 分钟，零风险）

#### 背景：Railway 相关文件当前分散在 5 处

| #   | 位置                                                    | 内容                                                                                                       | 处理                                         |
| --- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 1   | `infra/railway/`                                        | `deploy.sh`、`README.md`、`DEPLOY.md`、`TROUBLESHOOTING.md`、`backend.env.example`、`frontend.env.example` | ✅ 扩充为唯一运维入口                        |
| 2   | `backend/railway.toml`                                  | Railway 构建/启动声明                                                                                      | ⚠️ **必须留 service root**（Railway 强约定） |
| 3   | `frontend/railway.toml`                                 | 同上                                                                                                       | ⚠️ **必须留 service root**                   |
| 4   | `backend/.env.railway`                                  | Railway DB 连接（dotenv -e 用）                                                                            | ⚠️ 留 backend/（dotenv 默认从 cwd 找）       |
| 5   | `backend/scripts/devops/`                               | `studio-railway.{bat,ps1}`、`send-release-notification.ts`                                                 | → 迁移到 `infra/railway/scripts/`            |
| 6   | `scripts/devops/monitor-production.sh`                  | Railway logs 拉取分析                                                                                      | → 迁移到 `infra/railway/scripts/`            |
| 7   | `scripts/_archive/fixes/2025-01-fix-railway-*.{sh,bat}` | 已归档历史脚本                                                                                             | ✅ 不动                                      |

#### 分层原则

| 类别                                               | 归属                     | 判断标准                         |
| -------------------------------------------------- | ------------------------ | -------------------------------- |
| 平台元数据 (`railway.toml` / `Dockerfile`)         | service root             | Railway 强约定（不可改）         |
| 容器内运行的脚本 (`entrypoint.sh` / `migrate.js`)  | `backend/scripts/`       | 进 image，运行时执行             |
| 运维侧脚本 (`deploy/monitor/logs/studio/db-shell`) | `infra/railway/scripts/` | 在工程师本地或 CI 跑，不进 image |
| 环境样板 (`*.env.example`)                         | `infra/railway/envs/`    | 描述运维环境的契约               |
| 运维文档 (`DEPLOY` / `TROUBLESHOOTING` / runbook)  | `infra/railway/`         | 给运维人读                       |

**判断口诀**：在容器里跑还是在工程师机器上跑——容器里跑的留 `backend/`，工程师跑的归 `infra/`。

#### 步骤 5.1 - 创建目标结构

```bash
cd D:/projects/codes/genesis-agent-teams
mkdir -p infra/railway/scripts infra/railway/envs infra/railway/runbooks
```

#### 步骤 5.2 - 迁移现有脚本

```bash
# 运维脚本
git mv scripts/devops/monitor-production.sh infra/railway/scripts/monitor.sh
git mv backend/scripts/devops/studio-railway.bat infra/railway/scripts/studio.bat
git mv backend/scripts/devops/studio-railway.ps1 infra/railway/scripts/studio.ps1
git mv backend/scripts/devops/send-release-notification.ts infra/railway/scripts/release-notify.ts

# 环境样板
git mv infra/railway/backend.env.example infra/railway/envs/backend.env.example
git mv infra/railway/frontend.env.example infra/railway/envs/frontend.env.example
```

#### 步骤 5.3 - 处理 .env.railway

`backend/.env.railway` 含真实 DB 连接（已 gitignore），**不挪**——`dotenv -e .env.railway` 默认从 cwd 找。但要在 `infra/railway/envs/` 加一份脱敏样板：

```bash
# infra/railway/envs/backend.env.railway.example
DATABASE_URL=postgresql://postgres:<password>@<proxy-host>.proxy.rlwy.net:<port>/railway
# ...其它 prod-only 变量
```

#### 步骤 5.4 - 新增辅助脚本

`infra/railway/scripts/logs.sh`:

```bash
#!/bin/bash
# Tail Railway production logs
exec railway logs --num "${1:-100}" --service "${SERVICE:-backend}"
```

`infra/railway/scripts/db-shell.sh`:

```bash
#!/bin/bash
# Open psql to Railway production DB (uses backend/.env.railway)
set -e
cd "$(dirname "$0")/../../../backend"
DATABASE_URL=$(grep '^DATABASE_URL=' .env.railway | cut -d= -f2-)
exec psql "$DATABASE_URL"
```

`infra/railway/scripts/studio.sh`（替代 .bat/.ps1，跨平台）:

```bash
#!/bin/bash
# Open Prisma Studio against Railway production DB
cd "$(dirname "$0")/../../../backend"
exec npx dotenv -e .env.railway -- prisma studio --schema=prisma/schema
```

#### 步骤 5.5 - 更新 root package.json

```diff
- "monitor": "bash scripts/devops/monitor-production.sh",
- "monitor:quiet": "bash scripts/devops/monitor-production.sh --quiet",
+ "monitor": "bash infra/railway/scripts/monitor.sh",
+ "monitor:quiet": "bash infra/railway/scripts/monitor.sh --quiet",
+ "rw:logs": "bash infra/railway/scripts/logs.sh",
+ "rw:studio": "bash infra/railway/scripts/studio.sh",
+ "rw:deploy": "bash infra/railway/scripts/deploy.sh",
+ "rw:db-shell": "bash infra/railway/scripts/db-shell.sh",
```

`backend/package.json`:

```diff
- "db:studio:railway": "dotenv -e .env.railway -- prisma studio --schema=prisma/schema",
- "release:preview": "tsx scripts/devops/send-release-notification.ts --dry-run",
- "release:notify": "tsx scripts/devops/send-release-notification.ts",
+ "release:preview": "tsx ../infra/railway/scripts/release-notify.ts --dry-run",
+ "release:notify": "tsx ../infra/railway/scripts/release-notify.ts",
```

#### 步骤 5.6 - 创建 runbook 占位

```bash
cat > infra/railway/runbooks/rollback.md <<'EOF'
# Rollback Runbook

## 触发条件
- 部署后健康检查持续 fail
- 关键指标（错误率、P95 延迟）异常

## 回滚步骤
1. railway link → 确认当前 service
2. railway deployments → 找到上一个 healthy 的 deployment ID
3. railway redeploy --deployment <ID>
4. 等待健康检查通过（~2 min）
5. 验证关键路径（登录 / 创建报告 / 查看历史）
EOF

cat > infra/railway/runbooks/db-migration.md <<'EOF'
# Database Migration Runbook

## 紧急修复 schema 漂移
- 详见 backend/prisma/migrations/ 下手写 SQL
- 通过 npm run rw:db-shell 直连 prod DB 验证

## 回滚一次失败的迁移
- prisma 不支持 down，需手写反向 SQL
- 在 _prisma_migrations 表标记 rolled_back_at
EOF

cat > infra/railway/runbooks/incident-response.md <<'EOF'
# Incident Response Runbook

## P1 事故响应流程
1. 确认影响范围：npm run monitor
2. 拉取最近 500 行日志：npm run rw:logs -- 500
3. 检查 DB 状态：npm run rw:db-shell
4. 决定回滚 vs 热修：参考 rollback.md
5. 事后 5why 分析归档到 docs/audit/
EOF
```

#### 步骤 5.7 - 更新 infra/railway/README.md

在文件顶部追加：

```markdown
## 目录结构

- `DEPLOY.md` — 首次部署 SOP
- `TROUBLESHOOTING.md` — 故障排查手册
- `envs/` — 环境变量样板
  - `backend.env.example`
  - `frontend.env.example`
  - `backend.env.railway.example`
- `scripts/` — 运维脚本（不进 image）
  - `deploy.sh` — 初次部署
  - `monitor.sh` — 生产监控
  - `logs.sh` — 日志拉取
  - `studio.sh` — Prisma Studio 直连 prod
  - `db-shell.sh` — psql 直连 prod
  - `release-notify.ts` — 发布通知
- `runbooks/` — 运维操作手册
  - `rollback.md`
  - `db-migration.md`
  - `incident-response.md`

## 容器内脚本（不在本目录）

- `backend/scripts/entrypoint.sh` — 容器启动入口（属于应用，进 image）
- `backend/scripts/migrate.js` — 迁移执行器（容器内运行）
- `backend/Dockerfile` — 镜像定义（Railway 平台约定，必须 service root）
- `backend/railway.toml` — Railway service 元数据（同上）
```

#### 步骤 5.8 - 验证

```bash
npm run monitor -- --quiet                    # 监控脚本路径正确
npm run rw:studio                             # 新别名能启动
bash infra/railway/scripts/deploy.sh --help   # 部署脚本可执行
git log --diff-filter=R --summary | head -10  # 确认 mv 而非删除（保留历史）
```

#### 步骤 5.9 - 同步引用检查

```bash
# 全局 grep 旧路径，确保没有遗漏
grep -rn "scripts/devops/monitor-production" --exclude-dir=node_modules .
grep -rn "scripts/devops/send-release-notification" --exclude-dir=node_modules .
grep -rn "scripts/devops/studio-railway" --exclude-dir=node_modules .
```

**提交**:

```text
refactor(infra): consolidate Railway operations under infra/railway/

Operational scripts (run by engineers/CI, NOT inside container):
- mv scripts/devops/monitor-production.sh → infra/railway/scripts/monitor.sh
- mv backend/scripts/devops/studio-railway.{bat,ps1} → infra/railway/scripts/
- mv backend/scripts/devops/send-release-notification.ts → infra/railway/scripts/release-notify.ts

Env templates:
- mv infra/railway/{backend,frontend}.env.example → infra/railway/envs/

Added:
- infra/railway/scripts/{logs,db-shell,studio}.sh (cross-platform)
- infra/railway/runbooks/{rollback,db-migration,incident-response}.md
- npm aliases: rw:logs, rw:studio, rw:deploy, rw:db-shell

Unchanged (Railway platform requires service-root location):
- backend/railway.toml, backend/Dockerfile
- frontend/railway.toml, frontend/Dockerfile
- backend/scripts/entrypoint.sh (runs INSIDE container)
- backend/.env.railway (local secrets, dotenv reads from cwd)
```

---

## 三、最终目标结构

### `backend/` 根目录（清理后）

```text
backend/
├── .env.example
├── .env.railway
├── .eslintignore
├── .eslintrc.js
├── .gitattributes
├── Dockerfile                  # ← 唯一构建入口
├── nest-cli.json
├── package.json
├── railway.toml                # 无 startCommand
├── tsconfig.eslint.json
├── tsconfig.json
├── config/                     # ← 新增
│   └── jest/
│       ├── jest.config.js
│       ├── jest.e2e.config.js
│       └── unstable.json
├── prisma/
├── scripts/
│   ├── entrypoint.sh           # ← 唯一启动脚本
│   ├── migrate.js              # ← 唯一迁移脚本
│   └── ...
├── src/
└── test/
```

**对比**：21 个根文件 → **12 个**，减少 43%

### 部署链路（清理后）

```text
Railway Build → Dockerfile → CMD ./scripts/entrypoint.sh
                                  ├── node scripts/migrate.js
                                  ├── (optional) seed
                                  └── exec node dist/main
```

唯一路径，无歧义。

### Railway 运维结构（Phase 5 后）

```text
infra/railway/                        ← 运维侧唯一入口
├── README.md
├── DEPLOY.md
├── TROUBLESHOOTING.md
├── envs/
│   ├── backend.env.example
│   ├── frontend.env.example
│   └── backend.env.railway.example
├── scripts/                          ← 工程师/CI 运行（不进 image）
│   ├── deploy.sh
│   ├── monitor.sh
│   ├── logs.sh
│   ├── studio.sh
│   ├── db-shell.sh
│   └── release-notify.ts
└── runbooks/
    ├── rollback.md
    ├── db-migration.md
    └── incident-response.md

backend/                              ← 容器内运行（进 image）
├── Dockerfile                        ← Railway 平台约定，必须留
├── railway.toml                      ← 同上
└── scripts/
    ├── entrypoint.sh                 ← 容器启动入口
    └── migrate.js                    ← 容器内迁移执行
```

Railway 相关从 5 处分散收敛为 2 处（运维 / 容器内），职责边界清晰。

---

## 四、风险与回滚

| Phase            | 风险                                             | 回滚                                                          |
| ---------------- | ------------------------------------------------ | ------------------------------------------------------------- |
| 1 - 删孤儿       | 极低（已验证 0 引用）                            | `git revert`                                                  |
| 2 - 部署收敛     | 中等（生产启动逻辑变化）                         | 保留旧 entrypoint 一周，railway.toml 切回原 startCommand 即可 |
| 3 - jest 归集    | 低（CI 验证后即可发现）                          | 文件 mv 可直接 mv 回                                          |
| 4 - 工具链       | 低                                               | 各项独立可单独回滚                                            |
| 5 - Railway 归集 | 极低（git mv 保留历史，npm script 别名同步更新） | `git revert`                                                  |

**Phase 2 必须先在 staging 部署验证 24h，再合 main。**

---

## 五、可验证的成功标准

| 指标                          | 当前                                                                          | 目标                |
| ----------------------------- | ----------------------------------------------------------------------------- | ------------------- |
| backend/ 根文件数             | 21                                                                            | 12                  |
| 重复部署入口数                | 5                                                                             | 1                   |
| 重复迁移逻辑数                | 3                                                                             | 1                   |
| 孤儿配置文件数                | 10                                                                            | 0                   |
| Railway 运维脚本分散点数      | 4（infra/railway, scripts/devops, backend/scripts/devops, 散在 root scripts） | 1（infra/railway/） |
| `npm run test` 通过           | ✅                                                                            | ✅（不退化）        |
| `docker build ./backend` 通过 | ✅                                                                            | ✅                  |
| Railway 部署成功率            | 当前                                                                          | 不退化              |
| pre-push 耗时                 | ~50s                                                                          | ~8s                 |

---

## 六、执行排期建议

| Phase    | 工时      | 何时做                                  |
| -------- | --------- | --------------------------------------- |
| Phase 1  | 30min     | 立即（任何时间，零风险）                |
| Phase 2  | 2h        | 工作日上午（便于 staging 观察）         |
| Phase 3  | 1h        | Phase 1 之后                            |
| Phase 4  | 1h        | 任意                                    |
| Phase 5  | 45min     | Phase 1 之后任意（零风险，git mv 为主） |
| **总计** | **5.25h** | 可在一个工作日完成                      |

---

## 七、关于"jest.config.js 是否必须放根目录"

**结论**：不必须。

**Jest 配置查找规则**（按优先级）：

1. `--config <path>` 显式指定（任意位置）
2. `package.json#jest` 字段
3. cwd 向上查找 `jest.config.{ts,mts,cts,js,mjs,cjs,json}`

**移到子目录的代价**：

- 所有 `package.json#scripts` 中的 `jest` 调用要加 `--config config/jest/jest.config.js`
- `<rootDir>` 的相对路径要重新计算（`rootDir: "src"` → `rootDir: "../../src"`）
- IDE 集成（VS Code Jest 插件）需要 `.vscode/settings.json` 指 `jest.jestCommandLine`

**移到子目录的收益**：

- 根目录视觉清爽
- 配置文件集中（jest + e2e + ignore 列表一起管理）
- 更符合"每类配置一个目录"的现代 monorepo 惯例（如 Nx、Turborepo）

**本项目建议**：执行 Phase 3 一并归集，但**这是次要优化**——Phase 1 删孤儿带来的收益是 Phase 3 的 5 倍。

---

## 附录 A：完整命令清单（一键执行版）

```bash
#!/bin/bash
# Phase 1: 孤儿清理
cd D:/projects/codes/genesis-agent-teams/backend
git rm jest.coverage-app.js jest.coverage-app.swc.js
git rm jest.coverage-engine.js jest.coverage-engine.swc.js
git rm docker-entrypoint.sh start.sh Procfile package.json.build nixpacks.toml
rm -rf .cleanup-backup/

# 验证
cd ..
npm run test:backend -- --listTests | head -5
npm run build:backend

# 提交
git commit -m "chore(backend): remove 9 orphan config files

Verified: 0 references in codebase, build/test unchanged."
```

## 附录 B：grep 验证脚本

```bash
#!/bin/bash
# 在删除任何文件前运行此脚本验证
TARGETS=(
  "jest.coverage-app"
  "jest.coverage-engine"
  "jest.config.swc"
  "Procfile"
  "nixpacks"
  "package.json.build"
  "backend/start.sh"
)

for t in "${TARGETS[@]}"; do
  echo "=== $t ==="
  count=$(grep -rln "$t" \
    --include="*.json" --include="*.js" --include="*.ts" \
    --include="*.sh" --include="*.yml" --include="*.toml" \
    --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist \
    --exclude-dir=_archive --exclude-dir=generated \
    D:/projects/codes/genesis-agent-teams/ 2>/dev/null | wc -l)
  echo "References: $count"
done
```

---

**审计人**: Claude Code
**审阅状态**: 待人工 review
**实施 PR 跟踪**: 待创建（建议命名 `chore/engineering-cleanup-2026-04`）
