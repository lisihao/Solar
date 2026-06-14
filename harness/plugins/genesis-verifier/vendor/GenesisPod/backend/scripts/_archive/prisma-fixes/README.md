# Prisma 修复脚本归档

本目录包含已废弃的一次性修复脚本，这些功能已整合到 `deploy-migrations.ts` 中。

## 归档文件

### fix-enum-values.ts

- **原用途**: 修复 PostgreSQL 枚举值（绕过事务限制）
- **归档原因**: 功能已整合到 `deploy-migrations.ts` 的 Step 4.5
- **归档时间**: 2026-01-23
- **新位置**: `backend/prisma/deploy-migrations.ts` (lines 280-348)

### fix-all-missing-structures.sql

- **原用途**: 一次性修复所有缺失的表、列和索引
- **归档原因**: 功能已整合到 `deploy-migrations.ts` 的 Step 3.5
- **归档时间**: 2026-01-23
- **新位置**: `backend/prisma/deploy-migrations.ts` (lines 112-270)

## 历史背景

这些脚本是在数据库迁移过程中为解决特定问题而创建的：

1. **PostgreSQL 限制**: `ALTER TYPE ADD VALUE` 无法在事务中执行
2. **迁移失败**: 部分迁移在 Railway 环境中失败，导致表结构不完整
3. **紧急修复**: 需要快速修复生产环境问题

## 当前方案

所有修复逻辑已统一到 `deploy-migrations.ts`，该脚本会：

1. 检查并解决失败的迁移
2. 清理回滚的迁移记录
3. 运行标准 Prisma 迁移
4. 确保关键表结构完整（fallback）
5. 添加缺失的枚举值（事务外）
6. 修复已知数据问题

## 使用建议

- **不要直接运行这些归档脚本**
- 如果遇到类似问题，参考 `deploy-migrations.ts` 的实现
- 新的修复逻辑应添加到 `deploy-migrations.ts`，而不是创建新脚本

---

**归档日期**: 2026-01-23
**维护者**: Backend Team
