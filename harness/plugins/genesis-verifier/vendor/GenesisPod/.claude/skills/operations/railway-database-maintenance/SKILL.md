---
name: Railway Database Maintenance
description: 连接 Railway 生产数据库执行维护操作 - 迁移、枚举变更、数据修复、状态检查
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
tags:
  - railway
  - database
  - postgresql
  - migration
  - maintenance
boundaries:
  includes:
    - 生产数据库迁移执行
    - Enum 类型变更（ADD VALUE、重命名）
    - 表结构变更（DDL）
    - 数据修复和清理
    - 迁移状态检查
    - Prisma 迁移记录同步
  excludes:
    - 应用代码开发
    - Prisma schema 设计（参考 data skills）
    - 本地开发数据库操作
---

# Railway Database Maintenance

## 概述

本项目使用 Railway 托管 PostgreSQL 数据库。由于本地没有 `psql` 客户端，所有数据库维护操作通过 **Node.js + pg 模块**直接连接生产数据库执行。

## 环境信息

### 获取数据库连接 URL

```bash
# 查看 Railway 项目状态
railway status

# 获取数据库公网 URL（本地连接必须用 PUBLIC_URL）
railway variables --json | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).DATABASE_PUBLIC_URL))"
```

**关键区别**：

- `DATABASE_URL` = 内部地址（`postgres.railway.internal:5432`），仅 Railway 服务间可用
- `DATABASE_PUBLIC_URL` = 公网地址（`tramway.proxy.rlwy.net:20087`），本地连接必须使用此地址

### 项目路径

- Prisma Schema: `backend/prisma/schema/` (多文件 schema: `base.prisma` + `models.prisma`)
- Migrations: `backend/prisma/migrations/`
- package.json prisma 配置: `backend/package.json`

## 连接方式

### 方式一：Node.js + pg（推荐，无需安装 psql）

```bash
# 执行单条 SQL
node -e "
const{Client}=require('pg');
const c=new Client('DATABASE_PUBLIC_URL_HERE');
c.connect()
  .then(()=>c.query('YOUR SQL HERE'))
  .then(r=>{console.log('Result:',r.rows);c.end()})
  .catch(e=>{console.error(e);c.end()})
"
```

```bash
# 执行多条 SQL（按顺序）
node -e "
const{Client}=require('pg');
const c=new Client('DATABASE_PUBLIC_URL_HERE');
c.connect().then(async()=>{
  const sqls=[
    'SQL_1',
    'SQL_2',
    'SQL_3',
  ];
  for(const sql of sqls){
    console.log('Running:', sql.substring(0,60));
    await c.query(sql);
  }
  console.log('All done');
  c.end();
}).catch(e=>{console.error(e);c.end()})
"
```

### 方式二：Prisma migrate deploy（适用于标准迁移）

```bash
# 从 backend 目录执行，使用公网 URL
cd "D:\projects\codes\genesis-ai\backend"
DATABASE_URL="DATABASE_PUBLIC_URL_HERE" npx prisma migrate deploy --schema ./prisma/schema/
```

**注意**: Windows 上环境变量传递可能有问题，推荐使用方式一。

## 常见操作

### 1. 添加 Enum 值

```sql
ALTER TYPE "EnumName" ADD VALUE IF NOT EXISTS 'NEW_VALUE';
```

**注意**: PostgreSQL 的 `ADD VALUE` 不支持事务回滚，使用 `IF NOT EXISTS` 防止重复执行报错。

### 2. 删除表和约束

```sql
-- 先删外键约束
ALTER TABLE "table_name" DROP CONSTRAINT IF EXISTS "constraint_name";
-- 再删表
DROP TABLE IF EXISTS "table_name";
-- 最后删孤立的 enum 类型
DROP TYPE IF EXISTS "EnumTypeName";
```

### 3. 查询当前 Enum 值

```sql
SELECT unnest(enum_range(NULL::"EnumName"));
```

### 4. 检查迁移状态

```sql
SELECT migration_name, finished_at, applied_steps_count
FROM _prisma_migrations
ORDER BY finished_at DESC
LIMIT 10;
```

### 5. 手动记录迁移（在直接执行 SQL 后）

当手动执行了迁移 SQL 而非通过 `prisma migrate deploy` 时，需要在 `_prisma_migrations` 表中记录：

```sql
INSERT INTO _prisma_migrations (id, checksum, migration_name, finished_at, applied_steps_count)
VALUES (gen_random_uuid(), 'manual', 'MIGRATION_FOLDER_NAME', NOW(), 1)
ON CONFLICT DO NOTHING;
```

### 6. 查看表结构

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'your_table'
ORDER BY ordinal_position;
```

### 7. 数据修复

```sql
-- 更新特定记录
UPDATE "table_name" SET "column" = 'value' WHERE "id" = 'xxx';

-- 批量修复
UPDATE "table_name" SET "status" = 'ACTIVE' WHERE "status" IS NULL;
```

## 操作流程

### 标准迁移流程

1. 确认迁移文件存在于 `backend/prisma/migrations/`
2. 获取 `DATABASE_PUBLIC_URL`
3. 尝试 `prisma migrate deploy`
4. 若失败，读取迁移 SQL 文件手动执行
5. 手动执行后，记录到 `_prisma_migrations` 表

### Enum 变更流程

1. 确认 Prisma schema 中已添加新值
2. 确认迁移文件已生成
3. 通过 Node.js + pg 执行 `ALTER TYPE ... ADD VALUE`
4. 记录迁移

## 故障排查

| 错误                                  | 原因                  | 解决                             |
| ------------------------------------- | --------------------- | -------------------------------- |
| `P1001: Can't reach database`         | 使用了内部地址        | 改用 `DATABASE_PUBLIC_URL`       |
| `22P02: invalid input value for enum` | Enum 值未添加到数据库 | 执行 `ALTER TYPE ... ADD VALUE`  |
| `psql must be installed`              | 本地无 psql           | 使用 Node.js + pg 方式           |
| `No migration found`                  | Schema 路径不对       | 指定 `--schema ./prisma/schema/` |
| 环境变量未传递（Windows）             | `set` 命令链接问题    | 用 Node.js 内联连接字符串        |

## 安全注意事项

- 不要在代码或日志中硬编码数据库密码
- 执行 DDL 前先在本地验证 SQL 正确性
- 生产环境操作前确认操作范围，避免误删
- `DROP` 和 `DELETE` 操作务必加 `IF EXISTS` / `WHERE` 条件
