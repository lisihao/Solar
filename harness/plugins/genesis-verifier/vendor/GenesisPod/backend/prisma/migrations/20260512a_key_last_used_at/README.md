# Migration 20260512a — key `last_used_at` 归一

**Type**: Schema change（单向破坏性，DROP COLUMN）
**Tables**: `secret_keys`、`user_api_keys`、`key_assignments`
**Rollback complexity**: 高（需手工 ADD COLUMN + 反向推断，因业务流量已混入新字段）

---

## 部署 SOP

### 1. 备份（**必做**，单向不可逆）

```bash
# 在生产 DB host 上跑
pg_dump -h <host> -U <user> -d genesis \
  -t secret_keys -t user_api_keys -t key_assignments \
  --data-only --column-inserts \
  -f pre-20260512a-backup-$(date +%Y%m%d-%H%M).sql
```

存档到 S3/对象存储，保留至少 30 天。

### 2. 评估 backfill UPDATE 影响（**大表必看**）

`UPDATE ... SET last_used_at = last_tested_at WHERE last_used_at IS NULL ...` 在大表会持 RowExclusiveLock。**部署前先 EXPLAIN**：

```sql
EXPLAIN (ANALYZE false)
UPDATE "user_api_keys"
   SET "last_used_at" = "last_tested_at"
 WHERE "last_used_at" IS NULL AND "last_tested_at" IS NOT NULL;
```

- 单表 < 10k 行：直接跑无虞
- 10k–100k 行：低峰窗口跑，<10s 可接受
- \> 100k 行：**改成分批模板**（见下）

### 3. 分批 backfill 模板（仅大表使用）

替换 migration.sql 的 Step 2，改为：

```sql
DO $$
DECLARE
  batch_size INT := 5000;
  rows_updated INT;
BEGIN
  LOOP
    UPDATE "user_api_keys"
       SET "last_used_at" = "last_tested_at"
     WHERE "id" IN (
       SELECT "id" FROM "user_api_keys"
        WHERE "last_used_at" IS NULL AND "last_tested_at" IS NOT NULL
        LIMIT batch_size
     );
    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    EXIT WHEN rows_updated = 0;
    PERFORM pg_sleep(0.1);  -- 让出 lock 给业务流量
  END LOOP;
END $$;
```

### 4. 执行

```bash
cd backend
npx prisma migrate deploy
```

观察前后端 BYOK 写路径（5 分钟）：

- `getValueInternal` 写 `last_used_at`
- `persistDbHealthOutcome` 写 `last_used_at + access_count`

---

## Rollback（紧急回滚）

> ⚠️ **不可精确还原**：部署后业务流量也写 `last_used_at`，无法区分"Test 写的"和"真用写的"。回滚 = 把所有 `last_used_at` 全部当成 `last_tested_at`，**数据语义有损**。

```sql
-- Step R1: 恢复 last_tested_at 列
ALTER TABLE "secret_keys" ADD COLUMN "last_tested_at" TIMESTAMP(3);
ALTER TABLE "user_api_keys" ADD COLUMN "last_tested_at" TIMESTAMP(3);

-- Step R2: 反向 backfill（语义损失：业务流量被当 Test）
UPDATE "secret_keys" SET "last_tested_at" = "last_used_at";
UPDATE "user_api_keys" SET "last_tested_at" = "last_used_at";

-- Step R3: 删 last_used_at + access_count
DROP INDEX IF EXISTS "secret_keys_last_used_at_idx";
DROP INDEX IF EXISTS "user_api_keys_last_used_at_idx";
DROP INDEX IF EXISTS "key_assignments_last_used_at_idx";
ALTER TABLE "secret_keys" DROP COLUMN "last_used_at";
ALTER TABLE "user_api_keys" DROP COLUMN "last_used_at";
ALTER TABLE "key_assignments" DROP COLUMN "last_used_at";
ALTER TABLE "key_assignments" DROP COLUMN "access_count";

-- Step R4: 还原代码（revert 这次 PR + redeploy）
```

如果需要精确还原，必须 `pg_restore` 第 1 步的备份 + truncate + 重灌（接受这段时间业务数据丢失）。

---

## 相关 commit

- `51bfb1293` fix(admin/secrets,byok): unify lastUsedAt
- `27615ce83` fix(p0): post-review P0 fixes（spec 残留清理）
