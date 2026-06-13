-- 2026-06-12 修复团队工作流重复
-- acquireWorkflow 原先无去重，instantiateTeam / 重复点击会反复 create，
-- 导致同一用户同一市场工作流(source_listing_id)堆积多条（线上出现 10 条同名「深度洞察研究」）。
--
-- 本迁移分三步：
--   ① 把指向重复副本的 team.workflow_id 重定向到每组保留的最早一条（company_teams.workflow_id 无 FK，需手动重定向防悬空）
--   ② 删除多余副本（每组按 created_at 保留最早一条）
--   ③ 加偏唯一索引防复发（自建工作流 source_listing_id 为 NULL，不受约束）

-- ① team.workflow_id 重定向到每组（user_id, source_listing_id）最早的那条
WITH keep AS (
  SELECT DISTINCT ON (user_id, source_listing_id)
         id AS keep_id, user_id, source_listing_id
  FROM company_workflows
  WHERE source_listing_id IS NOT NULL
  ORDER BY user_id, source_listing_id, created_at ASC
)
UPDATE company_teams t
SET workflow_id = k.keep_id
FROM company_workflows w
JOIN keep k
  ON k.user_id = w.user_id
 AND k.source_listing_id = w.source_listing_id
WHERE t.workflow_id = w.id
  AND w.source_listing_id IS NOT NULL
  AND w.id <> k.keep_id;

-- ② 删除多余副本（每组保留最早一条）
DELETE FROM company_workflows c
WHERE c.source_listing_id IS NOT NULL
  AND c.id NOT IN (
    SELECT DISTINCT ON (user_id, source_listing_id) id
    FROM company_workflows
    WHERE source_listing_id IS NOT NULL
    ORDER BY user_id, source_listing_id, created_at ASC
  );

-- ③ 偏唯一索引防复发（source_listing_id 非空时，(user_id, source_listing_id) 唯一）
CREATE UNIQUE INDEX IF NOT EXISTS company_workflows_user_source_uniq
  ON company_workflows (user_id, source_listing_id)
  WHERE source_listing_id IS NOT NULL;
