# Prisma Scripts

数据库 schema、迁移和种子数据相关脚本。

## 脚本列表

| 脚本                   | 用途                                  | 使用场景       |
| ---------------------- | ------------------------------------- | -------------- |
| `schema/`              | 数据库 schema 定义（模块化拆分）      | 核心文件       |
| `seed.ts`              | 主种子数据脚本                        | 初始化数据库   |
| `seed-data-sources.ts` | 数据源种子数据（YouTube/Blog/Policy） | 添加数据源     |
| `deploy-migrations.ts` | 部署迁移脚本（统一处理所有迁移场景）  | 生产环境部署   |
| `diagnose-db.ts`       | 数据库诊断工具                        | 排查数据库问题 |

## 使用说明

### 开发环境

```bash
# 生成 Prisma Client
npm run prisma:generate

# 创建迁移
npm run prisma:migrate

# 应用迁移
npx prisma migrate dev

# 运行种子数据
npm run seed

# 打开 Prisma Studio
npm run prisma:studio
```

### 生产环境部署

```bash
# 运行完整部署流程（包含迁移 + 种子数据）
npm run deploy

# 或分步执行：
# 1. 运行部署迁移脚本（处理所有复杂场景）
npm run deploy:migrate

# 2. 运行种子数据
npm run seed
```

> **注意**: `deploy-migrations.ts` 已统一处理以下场景：
>
> - 失败迁移的解决
> - 回滚迁移的清理
> - 枚举值添加（事务外）
> - 缺失表结构的修复（fallback）
> - 数据修复（MCP 包名、Secret 分类等）

### Railway 环境管理

```bash
# 连接到 Railway 数据库
npm run db:studio:railway

# 或使用 PowerShell 脚本
./scripts/devops/studio-railway.ps1
```

## 迁移管理

### 创建新迁移

```bash
# 修改 schema.prisma 后
npx prisma migrate dev --name <migration_name>
```

### 迁移命名规范

```
YYYYMMDD_description

示例:
20260114_add_phase3_optimization
20260122_add_mcp_servers
```

### 复杂迁移处理

所有复杂迁移场景统一在 `deploy-migrations.ts` 中处理：

**Step 3.5**: 关键表结构检查（fallback for failed migrations）

```typescript
// 检查并创建缺失的表/列
// 例如: secrets.current_version, secret_versions, login_history
```

**Step 4.5**: 枚举值添加（事务外执行）

```typescript
// PostgreSQL ALTER TYPE ADD VALUE 必须在事务外执行
// 自动检查并添加缺失的枚举值
```

**Step 4.6**: 数据修复（已知问题）

```typescript
// MCP 包名修复: @anthropics → @modelcontextprotocol
// Secret 分类修复: GitHub 相关 secrets → DEV_TOOLS
```

> **原则**: 所有修复逻辑统一管理，避免创建一次性脚本。如需新增修复，直接在 `deploy-migrations.ts` 中添加新的 Step。

## 种子数据

### 主种子脚本 (seed.ts)

包含基础数据：

- 用户数据
- 基础配置
- 系统设置

### 数据源种子 (seed-data-sources.ts)

```bash
# 添加所有数据源
npx tsx prisma/seed-data-sources.ts

# 只添加 YouTube 数据源
npx tsx prisma/seed-data-sources.ts youtube

# 只添加 Blog 数据源
npx tsx prisma/seed-data-sources.ts blog

# 只添加 Policy 数据源
npx tsx prisma/seed-data-sources.ts policy
```

## 数据库诊断

```bash
# 运行诊断脚本
npm run diagnose

# 或直接运行
npx tsx prisma/diagnose-db.ts
```

诊断内容：

- 数据库连接状态
- 表结构完整性
- 数据类型一致性
- 常见问题检测

## 注意事项

### PostgreSQL 特殊限制

1. **枚举值添加**: `ALTER TYPE ADD VALUE` 不能在事务中执行
   - `deploy-migrations.ts` Step 4.5 自动处理
   - 使用 `IF NOT EXISTS` 避免重复添加

2. **迁移回滚**: 生产环境谨慎回滚迁移
   - 优先创建新的前向迁移
   - 必要时使用 `prisma migrate resolve`

3. **Schema 修改**: 大表结构变更前评估影响
   - 大表 ALTER 可能导致长时间锁表
   - 关键表在低峰期执行
   - 考虑使用 `pg_repack` 等工具

### 最佳实践

1. **本地测试**: 所有迁移先在本地完整测试
2. **备份数据**: 生产环境操作前备份数据库
3. **分步执行**: 复杂迁移拆分为多个小步骤
4. **监控日志**: 部署时密切监控日志输出
5. **统一修复**: 新的修复逻辑添加到 `deploy-migrations.ts`，避免创建临时脚本

## 归档脚本

已废弃的一次性修复脚本已移动到 `backend/scripts/_archive/prisma-fixes/`：

- `fix-enum-values.ts` → 整合到 `deploy-migrations.ts` Step 4.5
- `fix-all-missing-structures.sql` → 整合到 `deploy-migrations.ts` Step 3.5
- `add_research_type.sql` → 已应用的历史迁移

详见: `backend/scripts/_archive/prisma-fixes/README.md`

## 工具脚本

数据库相关工具脚本位于 `backend/scripts/db/`：

- `clean-ui-patrol.ts` - 清理 UI Patrol 测试数据
- `seed-ui-patrol.ts` - 初始化 UI Patrol 数据

## 相关文档

- [Prisma 官方文档](https://www.prisma.io/docs)
- [PostgreSQL 官方文档](https://www.postgresql.org/docs/)
- [项目开发规范](../standards/00-overview.md)

---

**最后更新**: 2026-01-23
**维护者**: Backend Team
