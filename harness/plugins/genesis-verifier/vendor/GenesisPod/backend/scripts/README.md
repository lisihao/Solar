# Backend Scripts

后端工具脚本集合，按功能分类组织。

> **顶层禁止散落脚本**：`backend/scripts/` 直属只允许放本 `README.md`，所有脚本必须归入下列子目录。
> 由 `npm run audit:scripts` 看护（pre-push 第 8 步焊死），违规拒推。新增类别需在 `dev-tools/audit-scripts-structure.ts` 的 `ALLOWED_DIRS` 登记。

## 目录结构

```
scripts/
├── _archive/      # 历史归档：已废弃 / 一次性修复 / 一次性诊断（保留参考，不删）
├── ci/            # CI 专用脚本
├── db/            # 数据库种子 / 测试夹具
├── dev-tools/     # 开发与审计工具（看护、循环依赖、覆盖率）
├── devops/        # 构建 / 部署 / 容器入口
├── maintenance/   # 数据与基础设施运维
└── thumbnails/    # 缩略图生成
```

## 分类清单

### dev-tools/ — 开发与审计工具

| 脚本                                  | 命令                             | 描述                                 |
| ------------------------------------- | -------------------------------- | ------------------------------------ |
| `audit-scripts-structure.ts`          | `npm run audit:scripts`          | 本目录顶层整洁度看护                 |
| `audit-architecture-debt.ts`          | `npm run audit:debt`             | 架构债务仪表盘（god-class / 跨层等） |
| `audit-capability-anti-patterns.cjs`  | `npm run audit:capability`       | capability 反模式看护（baseline）    |
| `audit-base-layer-file-governance.ts` | `npm run verify:file-governance` | L1 基础层文件治理                    |
| `detect-circular-deps.ts`             | `npm run dev:circular`           | 循环依赖检测                         |
| `ai-app-coverage-summary.js`          | （直接 node 运行）               | ai-app 测试覆盖率汇总                |
| `find-uncovered-files.js`             | （直接 node 运行）               | 未覆盖文件清单                       |

### devops/ — 构建 / 部署

| 脚本                          | 命令                     | 描述                                                   |
| ----------------------------- | ------------------------ | ------------------------------------------------------ |
| `entrypoint.sh`               | Docker `CMD`（容器内部） | 生产容器统一启动入口（diagnose→deploy→node dist/main） |
| `copy-build-assets.js`        | `npm run build` 末步     | 构建后复制静态产物到 dist                              |
| `apply-pending-migrations.js` | （手动 / 应急）          | 手动补跑未应用的 Prisma 迁移                           |

> `entrypoint.sh` 被 `backend/Dockerfile`（`chmod +x` + `CMD`）引用，路径变更须同步改 Dockerfile 与 `railway.toml` 注释。

### maintenance/ — 数据与基础设施运维

| 脚本                           | 命令                           | 描述                   |
| ------------------------------ | ------------------------------ | ---------------------- |
| `update-policy-whitelist.ts`   | `npm run maintenance:policy`   | 更新政策白名单         |
| `validate-data-integrity.ts`   | `npm run maintenance:validate` | 验证数据完整性         |
| `db-maintenance.ts`            | （手动）                       | 数据库清理 / 维护      |
| `rotate-kek-rewrap.ts`         | （手动 / 安全运维）            | KEK 轮换并重新包裹密钥 |
| `check-deprecated-tables.sql`  | （手动 SQL）                   | 检查废弃表             |
| `disable-stale-dimensions.sql` | （手动 SQL）                   | 停用陈旧维度           |

> 生产环境谨慎执行 maintenance 脚本。

### db/ — 种子 / 夹具

| 脚本                 | 描述                                 |
| -------------------- | ------------------------------------ |
| `seed-ui-patrol.ts`  | UI patrol E2E 测试夹具（非生产数据） |
| `clean-ui-patrol.ts` | 清理 UI patrol 夹具数据              |

> **业务 seed 不放这里**：走 `backend/src/common/seed/` 的 SeedSyncService（启动幂等同步），
> 架构 spec `__tests__/architecture/seed-governance.spec.ts` 拦截违规。Prisma 官方入口为 `prisma/seed.ts`（`npm run seed`）。

### ci/ — CI 专用

| 脚本                 | 命令                | 描述                          |
| -------------------- | ------------------- | ----------------------------- |
| `boot-smoke-test.js` | `npm run test:boot` | NestFactory DI 图解析冒烟测试 |

### thumbnails/ — 缩略图

| 脚本                         | 命令                          | 描述               |
| ---------------------------- | ----------------------------- | ------------------ |
| `generate-thumbnails.ts`     | `npm run thumbnails:generate` | 生成缺失的缩略图   |
| `generate-all-thumbnails.ts` | `npm run thumbnails:all`      | 重新生成所有缩略图 |
| `update-arxiv-thumbnails.ts` | `npm run thumbnails:arxiv`    | 更新 arXiv 缩略图  |

### \_archive/ — 历史归档

已废弃、一次性修复或一次性诊断脚本，保留供参考，**不要删除**。当前含：数据回填（`backfill-*`）、
乱码修复（`fix-*mojibake.py`）、一次性诊断（`check-*` / `quick-chart-check` / `db-check`）、
一次性迁移/清理（`migrate-social-content-to-task.dry-run` / `cleanup-youtube-broken` / `copy-b2-bucket`）、
早期 SQL 修复（`2025-01-*`）等。

## 规范

### 执行脚本

```bash
# 优先用 npm script
npm run <script-name>

# 无 npm 包装的，直接 tsx / node
npx tsx scripts/<category>/<script-name>.ts
node scripts/<category>/<script-name>.js
```

### 添加新脚本

1. 选定类别子目录（`dev-tools` / `devops` / `maintenance` / `db` / `ci` / `thumbnails`），**不要丢在顶层**
2. 放入该子目录；如确属新类别，先在 `dev-tools/audit-scripts-structure.ts` 的 `ALLOWED_DIRS` 登记
3. 视情况在 `package.json` 加 npm script
4. 更新本 README
5. 脚本内用 `__dirname` 推算路径时注意：相对 `backend/` 根的层级（子目录下为 `../..`）

### 归档旧脚本

1. 一次性 / 诊断脚本用完即 `git mv` 进 `_archive/`（保留，不删）
2. 从 `package.json` 移除对应 npm script
3. 更新本 README

## 注意事项

- 脚本用 `tsx`（TS）或 `node`（JS/CJS）运行
- 数据库相关脚本执行前确保数据库可访问
- 顶层整洁度由 `npm run audit:scripts` + pre-push 强制，绕不过

---

**维护者**: Backend Team
