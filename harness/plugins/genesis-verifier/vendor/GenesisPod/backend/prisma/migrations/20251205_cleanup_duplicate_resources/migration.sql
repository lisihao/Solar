-- 清理重复的资源记录
-- 该脚本会保留每组重复记录中最早创建的一条，删除其余的重复记录
-- 注意：数据库列名使用下划线命名法（source_url 而不是 sourceUrl）
-- 外键关系应该有 ON DELETE CASCADE 设置，因此只需要删除 resources 表的记录

-- 删除重复的resources记录（基于 source_url，保留最早创建的）
DELETE FROM resources
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY source_url ORDER BY created_at ASC) as rn
    FROM resources
    WHERE source_url IS NOT NULL
      AND source_url != ''
  ) sub WHERE rn > 1
);

-- 删除基于 normalized_url 的重复记录
DELETE FROM resources
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY normalized_url ORDER BY created_at ASC) as rn
    FROM resources
    WHERE normalized_url IS NOT NULL
      AND normalized_url != ''
  ) sub WHERE rn > 1
);
