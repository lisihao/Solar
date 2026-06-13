# Google Drive RAG 知识库 - 技术架构设计 v2.0

> **Version**: 2.0 (Best Practices Edition)
> **Author**: Architect Agent
> **Created**: 2025-12-26
> **Database**: PostgreSQL Only (pgvector + Full-Text Search)

---

## 1. Architecture Overview

### 1.1 系统架构图 (最佳实践版)

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                    Frontend (Next.js)                                    │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────────────────┐ │
│  │  Knowledge Base     │  │  AI Ask             │  │  AI Studio                      │ │
│  │  Management UI      │  │  + RAG Integration  │  │  + Knowledge Base Sources       │ │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────────────────┘ │
└──────────────────────────────────────────┬──────────────────────────────────────────────┘
                                           │
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                    Backend (NestJS)                                      │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │                         RAG Pipeline v2.0 (Best Practices)                       │   │
│  │                                                                                  │   │
│  │   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐    │   │
│  │   │    Query     │──▶│   Hybrid     │──▶│   Cohere     │──▶│   Parent     │    │   │
│  │   │ Enhancement  │   │   Search     │   │   Rerank     │   │  Retrieval   │    │   │
│  │   │   (HyDE)     │   │ (BM25+Vector)│   │              │   │              │    │   │
│  │   └──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘    │   │
│  │         │                   │                  │                  │             │   │
│  │         ▼                   ▼                  ▼                  ▼             │   │
│  │   ┌──────────────────────────────────────────────────────────────────────┐     │   │
│  │   │                     Context Builder + LLM Generation                  │     │   │
│  │   └──────────────────────────────────────────────────────────────────────┘     │   │
│  │                                                                                  │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │                         Document Processing Pipeline                             │   │
│  │                                                                                  │   │
│  │   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐    │   │
│  │   │   Content    │──▶│   Parent     │──▶│    Child     │──▶│   Embed +    │    │   │
│  │   │  Extraction  │   │  Chunking    │   │   Chunking   │   │   tsvector   │    │   │
│  │   │              │   │  (2000 tok)  │   │  (400 tok)   │   │              │    │   │
│  │   └──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘    │   │
│  │                                                                                  │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                         │
└──────────────────────────────────────────┬──────────────────────────────────────────────┘
                                           │
            ┌──────────────────────────────┼──────────────────────────────┐
            │                              │                              │
            ▼                              ▼                              ▼
┌───────────────────────────┐  ┌───────────────────────────┐  ┌───────────────────────────┐
│    PostgreSQL (Single)    │  │     External APIs         │  │     Google Drive          │
│                           │  │                           │  │                           │
│  • parent_chunks          │  │  • OpenAI Embedding       │  │  • OAuth 2.0              │
│  • child_chunks           │  │  • Cohere Rerank          │  │  • Files API              │
│  • child_embeddings       │  │  • GPT-4o / Claude        │  │  • Export API             │
│  • tsvector (BM25)        │  │                           │  │                           │
│  • pgvector (1536d)       │  │                           │  │                           │
│  • RRF hybrid_search()    │  │                           │  │                           │
└───────────────────────────┘  └───────────────────────────┘  └───────────────────────────┘
```

### 1.2 核心技术选型

| 组件          | 技术选择                      | 原因                       |
| ------------- | ----------------------------- | -------------------------- |
| **向量存储**  | PostgreSQL + pgvector         | 单一数据库，减少运维复杂度 |
| **全文搜索**  | PostgreSQL tsvector/tsquery   | 内置 BM25 类似功能         |
| **混合搜索**  | 自定义 SQL 函数 (RRF)         | 融合向量和关键词搜索       |
| **Reranking** | Cohere Rerank API             | 业界最佳精排效果           |
| **Embedding** | OpenAI text-embedding-3-small | 性价比高，1536 维          |
| **分块策略**  | Parent-Child                  | 检索精确 + 上下文完整      |

---

## 2. 核心数据流

### 2.1 文档索引流程 (Parent-Child)

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                      Document Indexing Pipeline (Parent-Child)                       │
└─────────────────────────────────────────────────────────────────────────────────────┘

 Google Drive File
        │
        ▼
┌───────────────────┐
│  1. Download      │  使用 Google Drive API 下载文件
│     & Extract     │  PDF → pdf-parse, DOCX → mammoth
└────────┬──────────┘
         │
         ▼ 原始文本 + 元数据
┌───────────────────┐
│  2. Create        │  按章节/段落边界分割
│     Parent Chunks │  每个 Parent ~2000 tokens
│     (2000 tok)    │  保留: pageStart, pageEnd, sectionTitle
└────────┬──────────┘
         │
         ▼ Parent Chunks[]
┌───────────────────┐
│  3. Split into    │  每个 Parent 分割为多个 Child
│     Child Chunks  │  每个 Child ~400 tokens
│     (400 tok)     │  50 tokens 重叠
│     + Overlap     │  保留 parentId 关联
└────────┬──────────┘
         │
         ▼ Child Chunks[]
┌───────────────────────────────────────────────────────────────────────────────────┐
│  4. Parallel Processing                                                            │
│                                                                                    │
│  ┌─────────────────────────┐         ┌─────────────────────────────────────────┐  │
│  │  4a. Generate tsvector  │         │  4b. Batch Embedding                    │  │
│  │      (BM25 indexing)    │         │      (OpenAI API, batch=100)            │  │
│  │                         │         │                                         │  │
│  │  to_tsvector('simple',  │         │  text-embedding-3-small                 │  │
│  │    content)             │         │  → 1536 维向量                          │  │
│  └────────────┬────────────┘         └────────────────┬────────────────────────┘  │
│               │                                       │                            │
│               └───────────────────┬───────────────────┘                            │
│                                   │                                                │
│                                   ▼                                                │
│  ┌───────────────────────────────────────────────────────────────────────────────┐│
│  │  5. Store to PostgreSQL                                                       ││
│  │                                                                               ││
│  │  parent_chunks: content, pageStart, pageEnd, sectionTitle                     ││
│  │  child_chunks:  content, parentId, position, content_tsvector                 ││
│  │  child_embeddings: vector (1536d)                                             ││
│  └───────────────────────────────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────────────────────────────┘

存储结构:
┌─────────────────┐
│  Parent Chunk   │  ~2000 tokens, 用于 LLM 上下文
│  (id: P001)     │
│  ┌───────────┐  │
│  │ Child C1  │──┼──▶ embedding + tsvector
│  │ Child C2  │──┼──▶ embedding + tsvector
│  │ Child C3  │──┼──▶ embedding + tsvector  ◀── 检索用
│  │ Child C4  │──┼──▶ embedding + tsvector
│  │ Child C5  │──┼──▶ embedding + tsvector
│  └───────────┘  │
└─────────────────┘
```

### 2.2 RAG 查询流程 (5 阶段)

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                          RAG Query Pipeline (5 Stages)                               │
└─────────────────────────────────────────────────────────────────────────────────────┘

用户查询: "2024年光伏行业的发展趋势是什么?"
                │
                ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│  Stage 1: Query Enhancement (可选 HyDE)                              ~300ms       │
├───────────────────────────────────────────────────────────────────────────────────┤
│                                                                                   │
│  原始查询 ──▶ GPT-4o-mini ──▶ 假设性答案                                          │
│                                                                                   │
│  "2024年光伏行业发展趋势..."  →  "2024年光伏行业呈现以下趋势：                    │
│                                   1. N型电池技术快速替代P型                        │
│                                   2. 垂直一体化产能扩张                            │
│                                   3. 海外市场多元化布局..."                        │
│                                                                                   │
│  假设答案 embedding ──▶ 用于更精准的语义匹配                                      │
│                                                                                   │
└───────────────────────────────────────────────────────────────────────────────────┘
                │
                ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│  Stage 2: Hybrid Search (BM25 + Vector + RRF)                        ~200ms       │
├───────────────────────────────────────────────────────────────────────────────────┤
│                                                                                   │
│  ┌─────────────────────────────┐    ┌─────────────────────────────┐              │
│  │     BM25 全文搜索           │    │     向量语义搜索            │              │
│  │                             │    │                             │              │
│  │  SELECT ... WHERE           │    │  SELECT ... ORDER BY        │              │
│  │  content_tsvector @@        │    │  vector <=> query_vector    │              │
│  │  plainto_tsquery('光伏')    │    │                             │              │
│  │                             │    │                             │              │
│  │  擅长: 专业术语、产品名     │    │  擅长: 语义相似、同义词     │              │
│  │  "TOPCon", "HJT", "N型"     │    │  "发展趋势" ≈ "行业动态"    │              │
│  └──────────────┬──────────────┘    └──────────────┬──────────────┘              │
│                 │   top-20 each                    │                              │
│                 └──────────────┬───────────────────┘                              │
│                                │                                                  │
│                                ▼                                                  │
│                 ┌─────────────────────────────┐                                   │
│                 │   RRF Fusion (k=60)         │                                   │
│                 │                             │                                   │
│                 │   score = Σ 1/(60 + rank_i) │                                   │
│                 │                             │                                   │
│                 │   综合两路排名，取 top-20   │                                   │
│                 └──────────────┬──────────────┘                                   │
│                                │                                                  │
└────────────────────────────────┼──────────────────────────────────────────────────┘
                                 │ 20 Child Chunks
                                 ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│  Stage 3: Reranking (Cohere Cross-Encoder)                           ~500ms       │
├───────────────────────────────────────────────────────────────────────────────────┤
│                                                                                   │
│  20 Child Chunks ──▶ Cohere Rerank API ──▶ 5 精排结果                            │
│                      (rerank-v3.5)                                                │
│                                                                                   │
│  输入:                                                                            │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │ query: "2024年光伏行业的发展趋势是什么?"                                    │ │
│  │ documents: [                                                                │ │
│  │   "N型电池技术在2024年实现突破...",  // RRF rank 1                          │ │
│  │   "光伏组件出口数据显示...",          // RRF rank 2                          │ │
│  │   "TOPCon电池量产效率达到...",        // RRF rank 3                          │ │
│  │   ...                                                                       │ │
│  │ ]                                                                           │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                   │
│  输出: 按真实相关性重排，过滤掉 30-40% 不相关结果                                 │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │ results: [                                                                  │ │
│  │   { index: 2, relevance_score: 0.95 },  // 原 rank 3 → 新 rank 1            │ │
│  │   { index: 0, relevance_score: 0.91 },  // 原 rank 1 → 新 rank 2            │ │
│  │   { index: 5, relevance_score: 0.87 },  // 原 rank 6 → 新 rank 3            │ │
│  │   ...                                                                       │ │
│  │ ]                                                                           │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                   │
└───────────────────────────────────────────────────────────────────────────────────┘
                                 │ 5 Best Child Chunks
                                 ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│  Stage 4: Parent Chunk Retrieval                                     ~100ms       │
├───────────────────────────────────────────────────────────────────────────────────┤
│                                                                                   │
│  Child Chunk (400 tok) ──▶ parentId ──▶ Parent Chunk (2000 tok)                  │
│                                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │  Child C3 (命中)                                                            │ │
│  │  "TOPCon电池量产效率达到26%，较去年提升..."                                  │ │
│  │                            │                                                │ │
│  │                            │ parentId                                       │ │
│  │                            ▼                                                │ │
│  │  Parent P001 (返回给 LLM)                                                   │ │
│  │  "第三章 技术发展趋势                                                       │ │
│  │   3.1 N型电池技术突破                                                       │ │
│  │   2024年，N型电池技术实现重大突破。TOPCon电池量产效率达到26%，              │ │
│  │   较去年提升1.2个百分点。HJT电池在降本方面取得进展...                        │ │
│  │   [完整的2000 tokens上下文]"                                                │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                   │
│  优势: 检索精确 (小块) + 上下文完整 (大块)                                        │
│                                                                                   │
└───────────────────────────────────────────────────────────────────────────────────┘
                                 │ 3-5 Parent Chunks
                                 ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│  Stage 5: Context Building & LLM Generation                          ~800ms       │
├───────────────────────────────────────────────────────────────────────────────────┤
│                                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │  System Prompt:                                                             │ │
│  │  你是专业的 AI 助手。请基于以下参考资料回答用户问题。                         │ │
│  │  引用时使用 [1] [2] 标注来源。                                               │ │
│  │                                                                             │ │
│  │  参考资料:                                                                  │ │
│  │  [1] 2024新能源行业报告.pdf (Page 23-28)                                    │ │
│  │  第三章 技术发展趋势                                                        │ │
│  │  3.1 N型电池技术突破...                                                     │ │
│  │  [~2000 tokens]                                                             │ │
│  │                                                                             │ │
│  │  [2] 光伏产业链分析.pdf (Section 4.2)                                       │ │
│  │  产业链垂直整合趋势...                                                      │ │
│  │  [~2000 tokens]                                                             │ │
│  │                                                                             │ │
│  │  用户问题: 2024年光伏行业的发展趋势是什么?                                   │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
│                              │                                                    │
│                              ▼                                                    │
│                         GPT-4o 生成                                               │
│                              │                                                    │
│                              ▼                                                    │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │  根据参考资料，2024年光伏行业的主要发展趋势包括：                            │ │
│  │                                                                             │ │
│  │  1. **N型电池技术加速替代P型** [1]                                          │ │
│  │     TOPCon、HJT等N型电池量产效率达到26%，市场份额快速提升...                 │ │
│  │                                                                             │ │
│  │  2. **产业链垂直整合** [2]                                                  │ │
│  │     头部企业推进硅料-硅片-电池-组件全产业链布局...                           │ │
│  │                                                                             │ │
│  │  ────────────────────────────────────────────                               │ │
│  │  📖 Sources:                                                                │ │
│  │  [1] 2024新能源行业报告.pdf - Page 23-28                                    │ │
│  │  [2] 光伏产业链分析.pdf - Section 4.2                                       │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                   │
└───────────────────────────────────────────────────────────────────────────────────┘

总延迟: ~1.5s (HyDE 可选，不用则 ~1.2s)
```

---

## 3. PostgreSQL 混合搜索实现

### 3.1 数据库 Schema

```sql
-- ==================== 启用扩展 ====================
CREATE EXTENSION IF NOT EXISTS vector;       -- pgvector
CREATE EXTENSION IF NOT EXISTS pg_trgm;      -- 模糊匹配 (可选)

-- ==================== 知识库表 ====================
CREATE TABLE knowledge_bases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'CREATING',
    last_error TEXT,
    document_count INT DEFAULT 0,
    chunk_count INT DEFAULT 0,
    total_tokens INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    last_sync_at TIMESTAMP
);

CREATE INDEX knowledge_bases_user_id_idx ON knowledge_bases(user_id);

-- ==================== 文档表 ====================
CREATE TABLE knowledge_base_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    source_type VARCHAR(50) NOT NULL,
    source_id VARCHAR(255) NOT NULL,
    title VARCHAR(500) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size INT,
    index_status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    index_error TEXT,
    parent_chunk_count INT DEFAULT 0,
    child_chunk_count INT DEFAULT 0,
    token_count INT DEFAULT 0,
    source_modified_at TIMESTAMP,
    last_indexed_at TIMESTAMP,
    content_hash VARCHAR(64),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(knowledge_base_id, source_id)
);

CREATE INDEX kb_documents_kb_id_idx ON knowledge_base_documents(knowledge_base_id);
CREATE INDEX kb_documents_status_idx ON knowledge_base_documents(index_status);

-- ==================== Parent Chunks (大块，用于生成) ====================
CREATE TABLE parent_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES knowledge_base_documents(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    token_count INT NOT NULL,
    position INT NOT NULL,
    page_start INT,
    page_end INT,
    section_title VARCHAR(500),
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX parent_chunks_kb_id_idx ON parent_chunks(knowledge_base_id);
CREATE INDEX parent_chunks_doc_id_idx ON parent_chunks(document_id);

-- ==================== Child Chunks (小块，用于检索) ====================
CREATE TABLE child_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id UUID NOT NULL REFERENCES parent_chunks(id) ON DELETE CASCADE,
    document_id UUID NOT NULL,
    content TEXT NOT NULL,
    token_count INT NOT NULL,
    position INT NOT NULL,
    -- BM25 全文搜索 (自动生成)
    content_tsvector TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('simple', content)
    ) STORED,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX child_chunks_parent_id_idx ON child_chunks(parent_id);
CREATE INDEX child_chunks_doc_id_idx ON child_chunks(document_id);
CREATE INDEX child_chunks_tsvector_idx ON child_chunks USING GIN (content_tsvector);

-- ==================== Child Embeddings (向量) ====================
CREATE TABLE child_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    child_id UUID NOT NULL UNIQUE REFERENCES child_chunks(id) ON DELETE CASCADE,
    vector vector(1536) NOT NULL,
    model VARCHAR(50) DEFAULT 'text-embedding-3-small',
    created_at TIMESTAMP DEFAULT NOW()
);

-- IVFFlat 索引 (近似最近邻，加速搜索)
CREATE INDEX child_embeddings_vector_idx ON child_embeddings
    USING ivfflat (vector vector_cosine_ops)
    WITH (lists = 100);
```

### 3.2 混合搜索函数 (RRF 融合)

```sql
-- ==================== 核心: 混合搜索函数 ====================
CREATE OR REPLACE FUNCTION hybrid_search(
    query_text TEXT,                    -- 用户查询文本
    query_vector vector(1536),          -- 查询向量
    kb_ids UUID[],                      -- 知识库 ID 列表
    match_count INT DEFAULT 20,         -- 返回结果数
    bm25_weight FLOAT DEFAULT 0.5,      -- BM25 权重
    vector_weight FLOAT DEFAULT 0.5,    -- 向量权重
    rrf_k INT DEFAULT 60                -- RRF 常数
)
RETURNS TABLE (
    child_id UUID,
    parent_id UUID,
    content TEXT,
    document_id UUID,
    bm25_rank INT,
    vector_rank INT,
    rrf_score FLOAT,
    bm25_score FLOAT,
    vector_score FLOAT
) AS $$
WITH
-- ===== BM25 全文搜索 =====
bm25_search AS (
    SELECT
        c.id,
        c.parent_id,
        c.content,
        c.document_id,
        ts_rank_cd(c.content_tsvector, plainto_tsquery('simple', query_text), 32) as score,
        ROW_NUMBER() OVER (
            ORDER BY ts_rank_cd(c.content_tsvector, plainto_tsquery('simple', query_text), 32) DESC
        ) as rank
    FROM child_chunks c
    JOIN parent_chunks p ON p.id = c.parent_id
    WHERE p.knowledge_base_id = ANY(kb_ids)
      AND c.content_tsvector @@ plainto_tsquery('simple', query_text)
    ORDER BY score DESC
    LIMIT match_count * 2
),

-- ===== 向量语义搜索 =====
vector_search AS (
    SELECT
        c.id,
        c.parent_id,
        c.content,
        c.document_id,
        1 - (e.vector <=> query_vector) as score,
        ROW_NUMBER() OVER (
            ORDER BY e.vector <=> query_vector
        ) as rank
    FROM child_chunks c
    JOIN child_embeddings e ON e.child_id = c.id
    JOIN parent_chunks p ON p.id = c.parent_id
    WHERE p.knowledge_base_id = ANY(kb_ids)
    ORDER BY e.vector <=> query_vector
    LIMIT match_count * 2
),

-- ===== RRF 融合 =====
combined AS (
    SELECT
        COALESCE(b.id, v.id) as id,
        COALESCE(b.parent_id, v.parent_id) as parent_id,
        COALESCE(b.content, v.content) as content,
        COALESCE(b.document_id, v.document_id) as document_id,
        COALESCE(b.rank, 1000) as bm25_rank,
        COALESCE(v.rank, 1000) as vector_rank,
        COALESCE(b.score, 0) as bm25_score,
        COALESCE(v.score, 0) as vector_score,
        -- RRF 公式: score = w1/(k + rank1) + w2/(k + rank2)
        (bm25_weight / (rrf_k + COALESCE(b.rank, 1000))) +
        (vector_weight / (rrf_k + COALESCE(v.rank, 1000))) as rrf_score
    FROM bm25_search b
    FULL OUTER JOIN vector_search v ON b.id = v.id
)

SELECT
    id as child_id,
    parent_id,
    content,
    document_id,
    bm25_rank::INT,
    vector_rank::INT,
    rrf_score,
    bm25_score,
    vector_score
FROM combined
ORDER BY rrf_score DESC
LIMIT match_count;
$$ LANGUAGE SQL STABLE;


-- ==================== 使用示例 ====================
-- SELECT * FROM hybrid_search(
--     '光伏行业发展趋势',                           -- 查询文本
--     '[0.1, 0.2, ...]'::vector,                   -- 查询向量
--     ARRAY['kb-uuid-1', 'kb-uuid-2']::uuid[],    -- 知识库
--     20,                                          -- 返回数量
--     0.5,                                         -- BM25 权重
--     0.5,                                         -- 向量权重
--     60                                           -- RRF k 值
-- );
```

### 3.3 中文搜索优化 (可选)

```sql
-- 创建中文分词配置 (如果需要更好的中文支持)
-- 需要安装 pg_jieba 或 zhparser 扩展

-- 方案 1: 使用 simple 配置 (按字符分词，简单但有效)
-- 已在上述 schema 中使用

-- 方案 2: 安装中文分词扩展 (需要服务器配置)
-- CREATE EXTENSION IF NOT EXISTS pg_jieba;
-- ALTER TABLE child_chunks
--   ALTER COLUMN content_tsvector
--   SET GENERATED ALWAYS AS (to_tsvector('jiebacfg', content)) STORED;
```

---

## 4. 核心服务实现

### 4.1 RAGPipelineService (完整实现)

```typescript
// backend/src/modules/knowledge-base/services/rag-pipeline.service.ts

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { CohereClient } from "cohere-ai";
import OpenAI from "openai";

@Injectable()
export class RAGPipelineService {
  private readonly logger = new Logger(RAGPipelineService.name);
  private readonly openai: OpenAI;
  private readonly cohere: CohereClient;

  constructor(private readonly prisma: PrismaService) {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.cohere = new CohereClient({ token: process.env.COHERE_API_KEY });
  }

  /**
   * 完整 RAG Pipeline
   */
  async search(
    knowledgeBaseIds: string[],
    query: string,
    options: RAGPipelineOptions = {},
  ): Promise<RAGPipelineResult> {
    const {
      topK = 5,
      enableHyDE = false,
      enableRerank = true,
      bm25Weight = 0.5,
      vectorWeight = 0.5,
      maxContextTokens = 8000,
    } = options;

    const timing: Record<string, number> = {};
    const startTime = Date.now();

    // ========== Stage 1: Query Enhancement ==========
    let queryVector: number[];
    let hydeAnswer: string | null = null;

    const stage1Start = Date.now();
    if (enableHyDE) {
      const enhanced = await this.generateHyDE(query);
      queryVector = await this.embed(enhanced.hypotheticalAnswer);
      hydeAnswer = enhanced.hypotheticalAnswer;
    } else {
      queryVector = await this.embed(query);
    }
    timing.queryEnhancement = Date.now() - stage1Start;

    // ========== Stage 2: Hybrid Search ==========
    const stage2Start = Date.now();
    const hybridResults = await this.hybridSearch(
      query,
      queryVector,
      knowledgeBaseIds,
      enableRerank ? topK * 4 : topK,
      bm25Weight,
      vectorWeight,
    );
    timing.hybridSearch = Date.now() - stage2Start;

    this.logger.log(`Hybrid search: ${hybridResults.length} candidates`);

    if (hybridResults.length === 0) {
      return this.emptyResult(query, timing);
    }

    // ========== Stage 3: Reranking ==========
    let finalChildChunks: HybridSearchRow[];

    if (enableRerank && hybridResults.length > topK) {
      const stage3Start = Date.now();
      const reranked = await this.rerank(query, hybridResults, topK);
      finalChildChunks = reranked.map((r) => ({
        ...hybridResults[r.index],
        rerankScore: r.relevanceScore,
      }));
      timing.reranking = Date.now() - stage3Start;
      this.logger.log(`Reranked to ${finalChildChunks.length} results`);
    } else {
      finalChildChunks = hybridResults.slice(0, topK);
      timing.reranking = 0;
    }

    // ========== Stage 4: Parent Retrieval ==========
    const stage4Start = Date.now();
    const parentIds = [...new Set(finalChildChunks.map((c) => c.parent_id))];
    const parentChunks = await this.prisma.parentChunk.findMany({
      where: { id: { in: parentIds } },
      include: {
        document: { select: { title: true } },
      },
    });
    timing.parentRetrieval = Date.now() - stage4Start;

    // ========== Stage 5: Build Context ==========
    const stage5Start = Date.now();
    const context = this.buildContext(
      parentChunks,
      finalChildChunks,
      maxContextTokens,
    );
    timing.contextBuilding = Date.now() - stage5Start;

    timing.total = Date.now() - startTime;

    return {
      context,
      childChunks: finalChildChunks.map((c) => ({
        id: c.child_id,
        content: c.content,
        parentId: c.parent_id,
        bm25Score: c.bm25_score,
        vectorScore: c.vector_score,
        rrfScore: c.rrf_score,
        rerankScore: c.rerankScore,
      })),
      parentChunks: parentChunks.map((p) => ({
        id: p.id,
        content: p.content,
        documentTitle: p.document.title,
        pageStart: p.pageStart,
        pageEnd: p.pageEnd,
        sectionTitle: p.sectionTitle,
      })),
      query,
      hydeAnswer,
      timing,
      metadata: {
        totalCandidates: hybridResults.length,
        afterRerank: finalChildChunks.length,
        parentChunksUsed: parentChunks.length,
        contextTokens: context.totalTokens,
      },
    };
  }

  /**
   * HyDE: 生成假设性答案
   */
  private async generateHyDE(
    query: string,
  ): Promise<{ hypotheticalAnswer: string }> {
    const response = await this.openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `你是专业的研究助手。请根据用户问题，写一段可能的答案（150-300字）。
答案不需要完全准确，但应包含相关的专业术语和概念。
直接输出答案，不要前缀。`,
        },
        { role: "user", content: query },
      ],
      temperature: 0.7,
      max_tokens: 400,
    });

    return {
      hypotheticalAnswer: response.choices[0].message.content || query,
    };
  }

  /**
   * 向量化
   */
  private async embed(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });
    return response.data[0].embedding;
  }

  /**
   * PostgreSQL 混合搜索
   */
  private async hybridSearch(
    queryText: string,
    queryVector: number[],
    kbIds: string[],
    limit: number,
    bm25Weight: number,
    vectorWeight: number,
  ): Promise<HybridSearchRow[]> {
    const vectorStr = `[${queryVector.join(",")}]`;

    const results = await this.prisma.$queryRaw<HybridSearchRow[]>`
      SELECT * FROM hybrid_search(
        ${queryText},
        ${vectorStr}::vector,
        ${kbIds}::uuid[],
        ${limit},
        ${bm25Weight},
        ${vectorWeight},
        60
      )
    `;

    return results;
  }

  /**
   * Cohere Rerank
   */
  private async rerank(
    query: string,
    candidates: HybridSearchRow[],
    topN: number,
  ): Promise<{ index: number; relevanceScore: number }[]> {
    try {
      const response = await this.cohere.rerank({
        model: "rerank-v3.5",
        query,
        documents: candidates.map((c) => c.content),
        topN,
        returnDocuments: false,
      });

      return response.results.map((r) => ({
        index: r.index,
        relevanceScore: r.relevanceScore,
      }));
    } catch (error) {
      this.logger.error(`Rerank failed: ${error.message}`);
      // 降级: 返回原顺序
      return candidates.slice(0, topN).map((_, i) => ({
        index: i,
        relevanceScore: 1 - i * 0.1,
      }));
    }
  }

  /**
   * 构建上下文
   */
  private buildContext(
    parentChunks: any[],
    childChunks: HybridSearchRow[],
    maxTokens: number,
  ): RAGContext {
    // 按 child 的相关性排序 parent
    const parentOrder = [
      ...new Set(
        childChunks
          .sort(
            (a, b) =>
              (b.rerankScore || b.rrf_score) - (a.rerankScore || a.rrf_score),
          )
          .map((c) => c.parent_id),
      ),
    ];

    const orderedParents = parentOrder
      .map((id) => parentChunks.find((p) => p.id === id))
      .filter(Boolean);

    const parts: string[] = [];
    const sources: SourceReference[] = [];
    let totalTokens = 0;

    for (let i = 0; i < orderedParents.length; i++) {
      const p = orderedParents[i];
      const tokens = this.estimateTokens(p.content);

      if (totalTokens + tokens > maxTokens) break;

      const loc = p.pageStart
        ? `Page ${p.pageStart}${p.pageEnd !== p.pageStart ? `-${p.pageEnd}` : ""}`
        : p.sectionTitle || "Section";

      parts.push(`[${i + 1}] 来源: ${p.document.title} (${loc})\n${p.content}`);
      sources.push({
        index: i + 1,
        documentId: p.documentId,
        documentTitle: p.document.title,
        pageStart: p.pageStart,
        pageEnd: p.pageEnd,
        sectionTitle: p.sectionTitle,
        excerpt: p.content.substring(0, 200) + "...",
      });

      totalTokens += tokens;
    }

    return {
      text: parts.join("\n\n---\n\n"),
      sources,
      totalTokens,
    };
  }

  private estimateTokens(text: string): number {
    const cn = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const other = text.length - cn;
    return Math.ceil(cn / 1.5 + other / 4);
  }

  private emptyResult(
    query: string,
    timing: Record<string, number>,
  ): RAGPipelineResult {
    return {
      context: { text: "", sources: [], totalTokens: 0 },
      childChunks: [],
      parentChunks: [],
      query,
      hydeAnswer: null,
      timing,
      metadata: {
        totalCandidates: 0,
        afterRerank: 0,
        parentChunksUsed: 0,
        contextTokens: 0,
      },
    };
  }
}

// ==================== Types ====================
interface RAGPipelineOptions {
  topK?: number;
  enableHyDE?: boolean;
  enableRerank?: boolean;
  bm25Weight?: number;
  vectorWeight?: number;
  maxContextTokens?: number;
}

interface HybridSearchRow {
  child_id: string;
  parent_id: string;
  content: string;
  document_id: string;
  bm25_rank: number;
  vector_rank: number;
  rrf_score: number;
  bm25_score: number;
  vector_score: number;
  rerankScore?: number;
}

interface RAGContext {
  text: string;
  sources: SourceReference[];
  totalTokens: number;
}

interface SourceReference {
  index: number;
  documentId: string;
  documentTitle: string;
  pageStart?: number;
  pageEnd?: number;
  sectionTitle?: string;
  excerpt: string;
}

interface RAGPipelineResult {
  context: RAGContext;
  childChunks: any[];
  parentChunks: any[];
  query: string;
  hydeAnswer: string | null;
  timing: Record<string, number>;
  metadata: {
    totalCandidates: number;
    afterRerank: number;
    parentChunksUsed: number;
    contextTokens: number;
  };
}
```

### 4.2 DocumentProcessorService (Parent-Child 分块)

```typescript
// backend/src/modules/knowledge-base/services/document-processor.service.ts

@Injectable()
export class DocumentProcessorService {
  private readonly PARENT_TOKEN_SIZE = 2000;
  private readonly CHILD_TOKEN_SIZE = 400;
  private readonly CHILD_OVERLAP = 50;

  /**
   * 处理文档: 内容提取 → Parent 分块 → Child 分块 → 向量化
   */
  async processDocument(
    knowledgeBaseId: string,
    documentId: string,
    content: string,
    metadata: DocumentMetadata,
  ): Promise<ProcessingResult> {
    // 1. 创建 Parent Chunks (大块)
    const parentChunks = this.createParentChunks(content, metadata);

    // 2. 为每个 Parent 创建 Child Chunks (小块)
    const allChildChunks: ChildChunkData[] = [];
    for (const parent of parentChunks) {
      const children = this.createChildChunks(parent);
      allChildChunks.push(...children);
    }

    // 3. 批量向量化 Child Chunks
    const embeddings = await this.batchEmbed(
      allChildChunks.map((c) => c.content),
    );

    // 4. 存储到数据库
    await this.storeChunks(
      knowledgeBaseId,
      documentId,
      parentChunks,
      allChildChunks,
      embeddings,
    );

    return {
      parentChunkCount: parentChunks.length,
      childChunkCount: allChildChunks.length,
      totalTokens: allChildChunks.reduce((sum, c) => sum + c.tokenCount, 0),
    };
  }

  /**
   * 创建 Parent Chunks (按章节/段落边界)
   */
  private createParentChunks(
    content: string,
    metadata: DocumentMetadata,
  ): ParentChunkData[] {
    const chunks: ParentChunkData[] = [];

    // 按段落分割
    const paragraphs = content.split(/\n\n+/);
    let currentChunk = "";
    let currentTokens = 0;
    let position = 0;
    let currentPage = metadata.startPage || 1;

    for (const para of paragraphs) {
      const paraTokens = this.estimateTokens(para);

      if (currentTokens + paraTokens > this.PARENT_TOKEN_SIZE && currentChunk) {
        // 保存当前块
        chunks.push({
          content: currentChunk.trim(),
          tokenCount: currentTokens,
          position: position++,
          pageStart: currentPage,
          pageEnd: currentPage,
          sectionTitle: this.extractSectionTitle(currentChunk),
        });
        currentChunk = "";
        currentTokens = 0;
      }

      currentChunk += para + "\n\n";
      currentTokens += paraTokens;

      // 简单的页码估算
      if (currentTokens > 500) currentPage++;
    }

    // 最后一个块
    if (currentChunk.trim()) {
      chunks.push({
        content: currentChunk.trim(),
        tokenCount: currentTokens,
        position: position,
        pageStart: currentPage,
        pageEnd: currentPage,
        sectionTitle: this.extractSectionTitle(currentChunk),
      });
    }

    return chunks;
  }

  /**
   * 创建 Child Chunks (固定大小 + 重叠)
   */
  private createChildChunks(parent: ParentChunkData): ChildChunkData[] {
    const chunks: ChildChunkData[] = [];
    const words = parent.content.split(/\s+/);
    const wordsPerChunk = Math.ceil(this.CHILD_TOKEN_SIZE * 1.5); // 估算
    const overlapWords = Math.ceil(this.CHILD_OVERLAP * 1.5);

    let start = 0;
    let position = 0;

    while (start < words.length) {
      const end = Math.min(start + wordsPerChunk, words.length);
      const chunkWords = words.slice(start, end);
      const content = chunkWords.join(" ");

      chunks.push({
        parentId: parent.id!, // 稍后填充
        content,
        tokenCount: this.estimateTokens(content),
        position: position++,
      });

      start = end - overlapWords;
      if (start >= words.length - overlapWords) break;
    }

    return chunks;
  }

  /**
   * 批量向量化
   */
  private async batchEmbed(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];
    const batchSize = 100;

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const response = await this.openai.embeddings.create({
        model: "text-embedding-3-small",
        input: batch,
      });
      embeddings.push(...response.data.map((d) => d.embedding));
    }

    return embeddings;
  }

  /**
   * 存储到数据库
   */
  private async storeChunks(
    kbId: string,
    docId: string,
    parents: ParentChunkData[],
    children: ChildChunkData[],
    embeddings: number[][],
  ): Promise<void> {
    // 1. 插入 Parent Chunks
    const parentRecords = await Promise.all(
      parents.map((p) =>
        this.prisma.parentChunk.create({
          data: {
            knowledgeBaseId: kbId,
            documentId: docId,
            content: p.content,
            tokenCount: p.tokenCount,
            position: p.position,
            pageStart: p.pageStart,
            pageEnd: p.pageEnd,
            sectionTitle: p.sectionTitle,
          },
        }),
      ),
    );

    // 2. 插入 Child Chunks + Embeddings
    let embeddingIndex = 0;
    for (let i = 0; i < parents.length; i++) {
      const parentId = parentRecords[i].id;
      const parentChildren = children.filter((_, idx) => {
        // 简化: 按顺序分配 children 到 parents
        const startIdx = parents.slice(0, i).reduce((sum, p) => {
          return sum + Math.ceil(p.tokenCount / this.CHILD_TOKEN_SIZE);
        }, 0);
        const endIdx =
          startIdx + Math.ceil(parents[i].tokenCount / this.CHILD_TOKEN_SIZE);
        return idx >= startIdx && idx < endIdx;
      });

      for (const child of parentChildren) {
        const childRecord = await this.prisma.childChunk.create({
          data: {
            parentId,
            documentId: docId,
            content: child.content,
            tokenCount: child.tokenCount,
            position: child.position,
          },
        });

        // 插入向量 (使用原生 SQL)
        const vector = embeddings[embeddingIndex++];
        await this.prisma.$executeRaw`
          INSERT INTO child_embeddings (id, child_id, vector, model)
          VALUES (
            gen_random_uuid(),
            ${childRecord.id}::uuid,
            ${`[${vector.join(",")}]`}::vector,
            'text-embedding-3-small'
          )
        `;
      }
    }
  }

  private estimateTokens(text: string): number {
    const cn = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    return Math.ceil(cn / 1.5 + (text.length - cn) / 4);
  }

  private extractSectionTitle(content: string): string | null {
    const firstLine = content.split("\n")[0];
    if (
      firstLine.length < 100 &&
      /^[#\d一二三四五六七八九十]/.test(firstLine)
    ) {
      return firstLine.replace(/^#+\s*/, "").trim();
    }
    return null;
  }
}
```

---

## 5. 性能与成本

### 5.1 延迟分析

| Stage     | 操作             | 延迟          | 备注                |
| --------- | ---------------- | ------------- | ------------------- |
| 1         | HyDE (可选)      | ~300ms        | GPT-4o-mini 生成    |
| 2         | Hybrid Search    | ~200ms        | PostgreSQL 混合查询 |
| 3         | Rerank           | ~500ms        | Cohere API 调用     |
| 4         | Parent Retrieval | ~100ms        | PostgreSQL 查询     |
| 5         | Context Building | ~50ms         | 内存操作            |
| **Total** |                  | **~1.2-1.5s** | 不含 LLM 生成       |

### 5.2 成本估算

| 服务             | 单价             | 月用量 (10万次) | 月成本       |
| ---------------- | ---------------- | --------------- | ------------ |
| OpenAI Embedding | $0.02/1M tokens  | ~2M tokens      | ~$4          |
| Cohere Rerank    | $1/1000 searches | 100K searches   | ~$100        |
| PostgreSQL       | -                | 已有            | $0           |
| **Total**        |                  |                 | **~$104/月** |

### 5.3 优化建议

1. **Embedding 缓存**: 缓存热门查询的 embedding，减少 API 调用
2. **Rerank 降级**: API 不可用时，回退到 RRF 结果
3. **异步索引**: 使用 Bull 队列处理文档索引
4. **分区表**: 按 knowledge_base_id 分区，加速查询

---

## 6. 文档归档

| 文档      | 路径                                                 | 描述                |
| --------- | ---------------------------------------------------- | ------------------- |
| PRD v2.0  | `docs/prd/google-drive-rag-knowledge-base.md`        | 产品需求 (最佳实践) |
| 架构 v2.0 | `docs/architecture/google-drive-rag-architecture.md` | 本文档              |
| PRD v1.0  | `docs/prd/google-drive-rag-knowledge-base-v1.0.md`   | 初版 (已废弃)       |
| 架构 v1.0 | `docs/architecture/google-drive-rag-architecture.md` | 初版 (已废弃)       |

---

## Change Log

| Version | Date       | Changes                | Author          |
| ------- | ---------- | ---------------------- | --------------- |
| 1.0     | 2025-12-26 | Initial Architecture   | Architect Agent |
| 2.0     | 2025-12-26 | Best Practices Edition | Architect Agent |
