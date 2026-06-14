# PostgreSQL 高级特性

## 概述

GenesisPod 使用 PostgreSQL 16 作为主数据库，采用 "PostgreSQL-First" 设计理念，利用其高级特性替代专用数据库：

- 递归 CTE 替代 Neo4j 图数据库
- JSONB 替代 MongoDB 文档存储
- 数组类型和 GIN 索引替代向量数据库

## 递归 CTE (知识图谱实现)

### 1. 核心原理

递归公用表表达式 (Recursive CTE) 用于处理层级和图结构数据：

```sql
WITH RECURSIVE cte_name AS (
    -- 非递归项（基础查询）
    SELECT ... FROM table WHERE condition

    UNION ALL

    -- 递归项（引用 CTE 自身）
    SELECT ... FROM table
    JOIN cte_name ON ...
)
SELECT * FROM cte_name;
```

### 2. 知识图谱遍历

```sql
-- 查找相关资源（深度优先）
WITH RECURSIVE related_resources AS (
    -- 基础：起始资源
    SELECT
        r.id,
        r.title,
        r.type,
        1 AS depth,
        ARRAY[r.id] AS path,
        false AS cycle
    FROM resources r
    WHERE r.id = '起始资源ID'

    UNION ALL

    -- 递归：通过关系表查找关联资源
    SELECT
        r.id,
        r.title,
        r.type,
        rr.depth + 1,
        rr.path || r.id,
        r.id = ANY(rr.path)  -- 循环检测
    FROM resources r
    JOIN resource_relations rel ON r.id = rel.target_id
    JOIN related_resources rr ON rel.source_id = rr.id
    WHERE rr.depth < 5        -- 深度限制
      AND NOT rr.cycle        -- 避免循环
)
SELECT DISTINCT ON (id) *
FROM related_resources
WHERE NOT cycle
ORDER BY id, depth;
```

### 3. 路径查找

```sql
-- 查找两个资源之间的路径
WITH RECURSIVE find_path AS (
    SELECT
        source_id,
        target_id,
        ARRAY[source_id] AS path,
        1 AS depth
    FROM resource_relations
    WHERE source_id = '资源A'

    UNION ALL

    SELECT
        rel.source_id,
        rel.target_id,
        fp.path || rel.source_id,
        fp.depth + 1
    FROM resource_relations rel
    JOIN find_path fp ON rel.source_id = fp.target_id
    WHERE NOT rel.source_id = ANY(fp.path)
      AND fp.depth < 10
)
SELECT path || target_id AS full_path
FROM find_path
WHERE target_id = '资源B'
ORDER BY array_length(path, 1)
LIMIT 1;
```

### 4. 分类树结构

```sql
-- 获取完整分类树
WITH RECURSIVE category_tree AS (
    -- 根节点
    SELECT
        id,
        name,
        parent_id,
        0 AS level,
        name::TEXT AS path
    FROM categories
    WHERE parent_id IS NULL

    UNION ALL

    -- 子节点
    SELECT
        c.id,
        c.name,
        c.parent_id,
        ct.level + 1,
        ct.path || ' > ' || c.name
    FROM categories c
    JOIN category_tree ct ON c.parent_id = ct.id
)
SELECT * FROM category_tree
ORDER BY path;
```

## JSONB 文档存储

### 1. JSONB vs JSON

| 特性     | JSON     | JSONB    |
| -------- | -------- | -------- |
| 存储格式 | 文本     | 二进制   |
| 解析时机 | 每次访问 | 存储时   |
| 索引支持 | 无       | GIN/GiST |
| 运算符   | 基础     | 丰富     |
| 存储空间 | 较小     | 较大     |
| 推荐场景 | 日志存储 | 查询操作 |

### 2. JSONB 操作符

```sql
-- 提取值
SELECT
    metadata->'source' AS source,           -- JSONB
    metadata->>'title' AS title,            -- TEXT
    metadata#>'{tags,0}' AS first_tag,      -- 路径提取
    metadata#>>'{author,name}' AS author    -- 路径提取为 TEXT
FROM resources;

-- 存在性检查
SELECT * FROM resources
WHERE metadata ? 'tags';                    -- 键存在

SELECT * FROM resources
WHERE metadata ?| ARRAY['tag1', 'tag2'];    -- 任一键存在

SELECT * FROM resources
WHERE metadata ?& ARRAY['tag1', 'tag2'];    -- 所有键存在

-- 包含检查
SELECT * FROM resources
WHERE metadata @> '{"type": "article"}';    -- 包含

SELECT * FROM resources
WHERE metadata <@ '{"type": "article", "status": "published"}';  -- 被包含

-- 路径存在
SELECT * FROM resources
WHERE metadata @? '$.tags[*] ? (@ == "important")';
```

### 3. JSONB 函数

```sql
-- 构建 JSONB
SELECT jsonb_build_object(
    'id', id,
    'title', title,
    'metadata', metadata
) FROM resources;

-- 数组操作
SELECT jsonb_array_elements(metadata->'tags') AS tag
FROM resources;

-- 合并
UPDATE resources
SET metadata = metadata || '{"updated": true}'::jsonb
WHERE id = 'xxx';

-- 删除键
UPDATE resources
SET metadata = metadata - 'deprecated_field'
WHERE id = 'xxx';

-- 设置嵌套值
UPDATE resources
SET metadata = jsonb_set(
    metadata,
    '{stats,views}',
    (COALESCE((metadata->'stats'->>'views')::int, 0) + 1)::text::jsonb
)
WHERE id = 'xxx';
```

### 4. JSONB 索引

```sql
-- GIN 索引（支持所有 JSONB 操作符）
CREATE INDEX idx_resources_metadata ON resources USING GIN (metadata);

-- 路径 GIN 索引（更高效的路径查询）
CREATE INDEX idx_resources_metadata_path ON resources
USING GIN (metadata jsonb_path_ops);

-- 表达式索引（特定字段）
CREATE INDEX idx_resources_type ON resources ((metadata->>'type'));

-- 部分索引
CREATE INDEX idx_resources_published ON resources ((metadata->>'status'))
WHERE metadata->>'status' = 'published';
```

## 数组类型

### 1. 数组操作

```sql
-- 创建数组列
ALTER TABLE resources ADD COLUMN tags TEXT[] DEFAULT '{}';

-- 数组操作符
SELECT * FROM resources
WHERE 'javascript' = ANY(tags);              -- 包含元素

SELECT * FROM resources
WHERE tags @> ARRAY['javascript', 'react'];  -- 包含所有

SELECT * FROM resources
WHERE tags && ARRAY['javascript', 'python']; -- 有交集

SELECT * FROM resources
WHERE tags <@ ARRAY['javascript', 'react', 'vue'];  -- 被包含

-- 数组函数
SELECT
    array_length(tags, 1) AS tag_count,
    array_to_string(tags, ', ') AS tags_string,
    unnest(tags) AS individual_tag
FROM resources;

-- 数组聚合
SELECT array_agg(DISTINCT tag) AS all_tags
FROM resources, unnest(tags) AS tag;
```

### 2. 数组索引

```sql
-- GIN 索引
CREATE INDEX idx_resources_tags ON resources USING GIN (tags);

-- 使用 gin_trgm_ops 的模糊搜索
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_resources_title_trgm ON resources
USING GIN (title gin_trgm_ops);
```

## 全文搜索

### 1. 基础配置

```sql
-- 添加全文搜索向量列
ALTER TABLE resources ADD COLUMN search_vector tsvector;

-- 更新搜索向量
UPDATE resources SET search_vector =
    setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(description, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(content, '')), 'C');

-- 创建 GIN 索引
CREATE INDEX idx_resources_search ON resources USING GIN (search_vector);

-- 自动更新触发器
CREATE FUNCTION update_search_vector() RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'B');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER resources_search_update
    BEFORE INSERT OR UPDATE ON resources
    FOR EACH ROW EXECUTE FUNCTION update_search_vector();
```

### 2. 搜索查询

```sql
-- 基础搜索
SELECT *
FROM resources
WHERE search_vector @@ plainto_tsquery('english', 'machine learning')
ORDER BY ts_rank(search_vector, plainto_tsquery('english', 'machine learning')) DESC;

-- 高级搜索语法
SELECT *
FROM resources
WHERE search_vector @@ to_tsquery('english', 'machine & learning | AI');

-- 短语搜索
SELECT *
FROM resources
WHERE search_vector @@ phraseto_tsquery('english', 'machine learning');

-- 带高亮的搜索
SELECT
    id,
    title,
    ts_headline('english', description, query, 'StartSel=<mark>, StopSel=</mark>') AS highlighted
FROM resources,
     plainto_tsquery('english', 'machine learning') AS query
WHERE search_vector @@ query;
```

## 性能优化

### 1. 索引策略

```sql
-- 复合索引
CREATE INDEX idx_resources_user_type ON resources (user_id, type);

-- 部分索引
CREATE INDEX idx_resources_active ON resources (created_at)
WHERE status = 'active';

-- 覆盖索引（包含所有需要的列）
CREATE INDEX idx_resources_list ON resources (type, created_at DESC)
INCLUDE (id, title);

-- 并行创建索引
CREATE INDEX CONCURRENTLY idx_large_table ON large_table (column);
```

### 2. 查询优化

```sql
-- 使用 EXPLAIN ANALYZE
EXPLAIN ANALYZE
SELECT * FROM resources WHERE type = 'article' ORDER BY created_at DESC LIMIT 10;

-- 批量插入
INSERT INTO resources (title, url, type)
SELECT * FROM unnest(
    ARRAY['Title 1', 'Title 2'],
    ARRAY['url1', 'url2'],
    ARRAY['article', 'video']
);

-- 批量更新
UPDATE resources
SET view_count = view_count + updates.count
FROM (VALUES
    ('id1', 10),
    ('id2', 5)
) AS updates(id, count)
WHERE resources.id = updates.id;

-- 批量 UPSERT
INSERT INTO resources (id, title, url, type)
VALUES ('id1', 'Title', 'url', 'article')
ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    updated_at = NOW();
```

### 3. 连接优化

```sql
-- 配置
SET work_mem = '256MB';           -- 排序内存
SET maintenance_work_mem = '1GB'; -- 维护操作内存
SET effective_cache_size = '4GB'; -- 可用缓存估计

-- 连接池配置（通过 URL 参数）
-- connection_limit=10&pool_timeout=20
```

## 监控和维护

```sql
-- 表大小统计
SELECT
    relname AS table_name,
    pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
    pg_size_pretty(pg_relation_size(relid)) AS data_size,
    pg_size_pretty(pg_indexes_size(relid)) AS index_size
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC;

-- 索引使用统计
SELECT
    indexrelname AS index_name,
    idx_scan AS times_used,
    pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;

-- 慢查询
SELECT
    query,
    calls,
    mean_time,
    total_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;

-- 定期维护
VACUUM ANALYZE resources;
REINDEX TABLE resources;
```

## 参考资源

- [PostgreSQL 官方文档](https://www.postgresql.org/docs/16/)
- [PostgreSQL JSON 函数](https://www.postgresql.org/docs/16/functions-json.html)
- [PostgreSQL 全文搜索](https://www.postgresql.org/docs/16/textsearch.html)
- [PostgreSQL 性能优化](https://wiki.postgresql.org/wiki/Performance_Optimization)
