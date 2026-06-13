# Google Drive RAG 知识库 PRD v2.0

> **Version**: 2.0 (Best Practices Edition)
> **Author**: PM & Architect Agent
> **Created**: 2025-12-26
> **Status**: Draft

---

## Document Information

| Field          | Value                            |
| -------------- | -------------------------------- |
| Module         | google-drive-rag-integration     |
| Type           | prd                              |
| Priority       | P0 (Critical)                    |
| Target Release | v1.3.0                           |
| Dependencies   | Google Drive Integration v1.0    |
| Database       | PostgreSQL (pgvector + 全文搜索) |

---

## 版本变更 (v1.0 → v2.0)

| 特性     | v1.0            | v2.0 (最佳实践)              | 提升效果          |
| -------- | --------------- | ---------------------------- | ----------------- |
| 分块策略 | 固定 512 tokens | Parent-Child 分层分块        | 上下文完整性 +40% |
| 检索方式 | 纯向量搜索      | 混合检索 (BM25 + 向量 + RRF) | 召回率 +15-30%    |
| 精排     | 无              | Cohere Rerank                | 精度 +23%         |
| 查询增强 | 无              | HyDE 假设文档生成            | 模糊查询 +20-35%  |
| 数据库   | PostgreSQL      | PostgreSQL (不变)            | -                 |

---

## 1. Executive Summary

### 1.1 Background

用户希望将 Google Drive 中的专业文档作为 AI 的领域知识输入，使 AI Ask 和 AI Studio 能够基于私有知识生成更专业的回答和报告。

本方案采用 **2024-2025 年业界 RAG 最佳实践**：

- **混合检索**：BM25 关键词 + 向量语义，RRF 融合
- **Parent-Child 分块**：小块检索，大块生成
- **Reranking**：Cohere 精排，过滤 30-40% 不相关结果
- **单一数据库**：全部基于 PostgreSQL 实现

### 1.2 Goals

| Goal           | Description                               | Success Metric     |
| -------------- | ----------------------------------------- | ------------------ |
| **高质量检索** | 混合检索 + Rerank，确保检索结果高度相关   | 检索相关度 > 90%   |
| **上下文完整** | Parent-Child 分块，保证 AI 获得足够上下文 | 上下文利用率 > 85% |
| **精确引用**   | 精确定位到文档页码/章节                   | 引用准确率 > 95%   |
| **响应速度**   | 混合检索 + Rerank 总延迟可控              | 端到端延迟 < 2s    |

---

## 2. 核心技术方案

### 2.1 RAG Pipeline 架构 (最佳实践)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     RAG Pipeline v2.0 (Best Practices)                           │
└─────────────────────────────────────────────────────────────────────────────────┘

                              用户查询
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Stage 1: Query Enhancement (查询增强)                                           │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │  原始查询: "光伏行业趋势"                                                  │  │
│  │      │                                                                     │  │
│  │      ▼                                                                     │  │
│  │  ┌─────────────────┐                                                       │  │
│  │  │  HyDE (可选)    │  LLM 生成假设性答案，用于更精准的语义匹配             │  │
│  │  │  Hypothetical   │  "2024年光伏行业呈现N型电池技术替代、一体化..."       │  │
│  │  │  Document       │                                                       │  │
│  │  └─────────────────┘                                                       │  │
│  │      │                                                                     │  │
│  │      ▼                                                                     │  │
│  │  增强查询 → 用于后续检索                                                    │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Stage 2: Hybrid Retrieval (混合检索)                              PostgreSQL    │
│  ┌─────────────────────────────┐     ┌─────────────────────────────┐           │
│  │     BM25 全文搜索           │     │     向量语义搜索            │           │
│  │     (PostgreSQL tsvector)   │     │     (pgvector)              │           │
│  │                             │     │                             │           │
│  │  • 精确匹配专业术语         │     │  • 语义相似性匹配           │           │
│  │  • 产品名、数字、缩写       │     │  • 同义词、概念关联         │           │
│  │  • 关键词权重 (tf-idf)      │     │  • 1536 维向量余弦距离      │           │
│  │                             │     │                             │           │
│  └──────────────┬──────────────┘     └──────────────┬──────────────┘           │
│                 │                                   │                           │
│                 │         top-20 each               │                           │
│                 └─────────────┬─────────────────────┘                           │
│                               ▼                                                 │
│                 ┌─────────────────────────────┐                                 │
│                 │   RRF (Reciprocal Rank      │                                 │
│                 │        Fusion)              │                                 │
│                 │                             │                                 │
│                 │   score = Σ 1/(k + rank_i)  │                                 │
│                 │   k = 60 (常用值)           │                                 │
│                 │                             │                                 │
│                 │   融合两路排名，综合评分    │                                 │
│                 └──────────────┬──────────────┘                                 │
│                                │                                                │
│                                ▼                                                │
│                         top-20 候选 (Child Chunks)                              │
└─────────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Stage 3: Reranking (精排)                                        Cohere API    │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                                                                           │  │
│  │   top-20 候选  ──▶  Cohere Rerank API  ──▶  top-5 精排结果               │  │
│  │                     (Cross-Encoder)                                       │  │
│  │                                                                           │  │
│  │   • 深度语义匹配 (query-document pair)                                    │  │
│  │   • 过滤 30-40% 不相关结果                                                │  │
│  │   • 精度提升 ~23%                                                         │  │
│  │                                                                           │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Stage 4: Parent Retrieval (父块获取)                             PostgreSQL    │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                                                                           │  │
│  │   Child Chunks (400 tokens)  ──▶  Parent Chunks (2000 tokens)             │  │
│  │                                                                           │  │
│  │   检索用小块 (精确)           提供给 LLM 的大块 (完整上下文)              │  │
│  │                                                                           │  │
│  │   ┌─────────────────────────────────────────────────────────────┐        │  │
│  │   │  Parent Chunk (2000 tokens)                                 │        │  │
│  │   │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌────────┐ │        │  │
│  │   │  │ Child 1 │ │ Child 2 │ │ Child 3 │ │ Child 4 │ │Child 5 │ │        │  │
│  │   │  │ 400 tok │ │ 400 tok │ │ 400 tok │ │ 400 tok │ │400 tok │ │        │  │
│  │   │  └─────────┘ └────▲────┘ └─────────┘ └─────────┘ └────────┘ │        │  │
│  │   └───────────────────│─────────────────────────────────────────┘        │  │
│  │                       │                                                   │  │
│  │                  检索命中                                                 │  │
│  │                                                                           │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Stage 5: Context Building & Generation                           LLM (GPT-4)   │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                                                                           │  │
│  │  ┌─────────────────────────────────────────────────────────────────────┐ │  │
│  │  │ System Prompt:                                                      │ │  │
│  │  │ 你是专业的 AI 助手，请基于以下参考资料回答问题。                     │ │  │
│  │  │ 引用时使用 [1] [2] 标注来源。                                        │ │  │
│  │  │                                                                     │ │  │
│  │  │ 参考资料:                                                           │ │  │
│  │  │ [1] 2024新能源行业报告.pdf (Page 23-28)                             │ │  │
│  │  │ [Parent Chunk 1 完整内容 - 2000 tokens]                             │ │  │
│  │  │                                                                     │ │  │
│  │  │ [2] 光伏产业链分析.pdf (Section 3.2)                                │ │  │
│  │  │ [Parent Chunk 2 完整内容 - 2000 tokens]                             │ │  │
│  │  │                                                                     │ │  │
│  │  │ 用户问题: {query}                                                   │ │  │
│  │  └─────────────────────────────────────────────────────────────────────┘ │  │
│  │                                                                           │  │
│  │                              ▼                                            │  │
│  │                         LLM 生成回答                                      │  │
│  │                              │                                            │  │
│  │                              ▼                                            │  │
│  │                    回答 + [1] [2] 引用标注                                │  │
│  │                                                                           │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Parent-Child 分块策略

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      Parent-Child Chunking Strategy                              │
└─────────────────────────────────────────────────────────────────────────────────┘

原始文档 (例: 50 页 PDF)
│
▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Step 1: 语义分段 (按章节/段落边界)                                              │
│                                                                                 │
│  原文 → [章节1] [章节2] [章节3] ... [章节N]                                      │
└─────────────────────────────────────────────────────────────────────────────────┘
│
▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Step 2: 创建 Parent Chunks (~2000 tokens)                                       │
│                                                                                 │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │  Parent Chunk 1                                                          │  │
│  │  • ID: parent-001                                                        │  │
│  │  • Content: 章节1完整内容 (约2000 tokens)                                 │  │
│  │  • Metadata: { documentId, title, pageStart: 1, pageEnd: 3 }             │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │  Parent Chunk 2                                                          │  │
│  │  • ID: parent-002                                                        │  │
│  │  • Content: 章节2完整内容 (约2000 tokens)                                 │  │
│  │  • Metadata: { documentId, title, pageStart: 4, pageEnd: 6 }             │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────┘
│
▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Step 3: 分割为 Child Chunks (~400 tokens，50 tokens 重叠)                       │
│                                                                                 │
│  Parent Chunk 1:                                                                │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐                   │
│  │ Child   │ │ Child   │ │ Child   │ │ Child   │ │ Child   │                   │
│  │ 001-1   │ │ 001-2   │ │ 001-3   │ │ 001-4   │ │ 001-5   │                   │
│  │ 400 tok │ │ 400 tok │ │ 400 tok │ │ 400 tok │ │ 400 tok │                   │
│  │         │◀──50──▶│         │◀──50──▶│         │◀──50──▶│         │           │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘                   │
│      │                                                                          │
│      └── parentId: parent-001 (关联父块)                                        │
│                                                                                 │
│  Parent Chunk 2:                                                                │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐                   │
│  │ Child   │ │ Child   │ │ Child   │ │ Child   │ │ Child   │                   │
│  │ 002-1   │ │ 002-2   │ │ 002-3   │ │ 002-4   │ │ 002-5   │                   │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘                   │
│      │                                                                          │
│      └── parentId: parent-002                                                   │
└─────────────────────────────────────────────────────────────────────────────────┘
│
▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Step 4: 仅对 Child Chunks 生成向量 (节省存储和计算)                             │
│                                                                                 │
│  Child 001-1 → embedding → [0.123, -0.456, ...]  (1536 维)                      │
│  Child 001-2 → embedding → [0.789, -0.012, ...]                                 │
│  ...                                                                            │
│                                                                                 │
│  Child Chunks 用于检索，Parent Chunks 用于生成                                  │
└─────────────────────────────────────────────────────────────────────────────────┘

存储结构:
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│  parent_chunks  │───1:N─│  child_chunks   │───1:1─│   embeddings    │
├─────────────────┤       ├─────────────────┤       ├─────────────────┤
│ id              │       │ id              │       │ id              │
│ document_id     │       │ parent_id (FK)  │       │ child_id (FK)   │
│ content (长)    │       │ content (短)    │       │ vector          │
│ page_start      │       │ position        │       │ model           │
│ page_end        │       │ token_count     │       └─────────────────┘
│ section_title   │       │ tsvector (BM25) │
└─────────────────┘       └─────────────────┘
```

### 2.3 PostgreSQL 混合搜索实现

```sql
-- PostgreSQL 单库实现混合搜索 (BM25 + 向量 + RRF)

-- 1. 表结构 (支持混合搜索)
CREATE TABLE child_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id UUID NOT NULL REFERENCES parent_chunks(id) ON DELETE CASCADE,
    document_id UUID NOT NULL,
    content TEXT NOT NULL,
    token_count INT NOT NULL,
    position INT NOT NULL,

    -- BM25 全文搜索支持
    content_tsvector TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('simple', content)  -- 使用 simple 配置支持中文
    ) STORED,

    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    child_id UUID NOT NULL UNIQUE REFERENCES child_chunks(id) ON DELETE CASCADE,
    vector vector(1536) NOT NULL,
    model VARCHAR(50) DEFAULT 'text-embedding-3-small',
    created_at TIMESTAMP DEFAULT NOW()
);

-- 2. 索引
CREATE INDEX child_chunks_tsvector_idx ON child_chunks USING GIN (content_tsvector);
CREATE INDEX embeddings_vector_idx ON embeddings USING ivfflat (vector vector_cosine_ops) WITH (lists = 100);

-- 3. 混合搜索函数 (RRF 融合)
CREATE OR REPLACE FUNCTION hybrid_search(
    query_text TEXT,
    query_vector vector(1536),
    kb_ids UUID[],
    match_count INT DEFAULT 20,
    bm25_weight FLOAT DEFAULT 0.5,
    vector_weight FLOAT DEFAULT 0.5,
    rrf_k INT DEFAULT 60
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
-- BM25 全文搜索
bm25_results AS (
    SELECT
        c.id,
        c.parent_id,
        c.content,
        c.document_id,
        ts_rank_cd(c.content_tsvector, plainto_tsquery('simple', query_text)) as score,
        ROW_NUMBER() OVER (ORDER BY ts_rank_cd(c.content_tsvector, plainto_tsquery('simple', query_text)) DESC) as rank
    FROM child_chunks c
    JOIN parent_chunks p ON p.id = c.parent_id
    WHERE p.knowledge_base_id = ANY(kb_ids)
      AND c.content_tsvector @@ plainto_tsquery('simple', query_text)
    ORDER BY score DESC
    LIMIT match_count * 2
),

-- 向量语义搜索
vector_results AS (
    SELECT
        c.id,
        c.parent_id,
        c.content,
        c.document_id,
        1 - (e.vector <=> query_vector) as score,
        ROW_NUMBER() OVER (ORDER BY e.vector <=> query_vector) as rank
    FROM child_chunks c
    JOIN embeddings e ON e.child_id = c.id
    JOIN parent_chunks p ON p.id = c.parent_id
    WHERE p.knowledge_base_id = ANY(kb_ids)
    ORDER BY e.vector <=> query_vector
    LIMIT match_count * 2
),

-- RRF 融合
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
        -- RRF 公式: score = Σ 1/(k + rank)
        (bm25_weight / (rrf_k + COALESCE(b.rank, 1000))) +
        (vector_weight / (rrf_k + COALESCE(v.rank, 1000))) as rrf_score
    FROM bm25_results b
    FULL OUTER JOIN vector_results v ON b.id = v.id
)

SELECT
    id as child_id,
    parent_id,
    content,
    document_id,
    bm25_rank,
    vector_rank,
    rrf_score,
    bm25_score,
    vector_score
FROM combined
ORDER BY rrf_score DESC
LIMIT match_count;

$$ LANGUAGE SQL;
```

### 2.4 Cohere Reranking 集成

```typescript
// Cohere Rerank 服务
@Injectable()
export class RerankService {
  private readonly cohere: CohereClient;
  private readonly logger = new Logger(RerankService.name);

  constructor() {
    this.cohere = new CohereClient({
      token: process.env.COHERE_API_KEY,
    });
  }

  /**
   * 使用 Cohere Rerank 对候选结果精排
   *
   * @param query 用户查询
   * @param documents 候选文档列表
   * @param topN 返回前 N 个结果
   * @returns 精排后的结果
   */
  async rerank(
    query: string,
    documents: RerankDocument[],
    topN: number = 5,
  ): Promise<RerankResult[]> {
    if (documents.length === 0) {
      return [];
    }

    this.logger.log(
      `Reranking ${documents.length} documents for query: ${query.substring(0, 50)}...`,
    );

    try {
      const response = await this.cohere.rerank({
        model: "rerank-v3.5", // 最新模型，支持多语言
        query: query,
        documents: documents.map((d) => d.content),
        topN: topN,
        returnDocuments: false, // 只返回索引和分数
      });

      return response.results.map((result) => ({
        index: result.index,
        relevanceScore: result.relevanceScore,
        document: documents[result.index],
      }));
    } catch (error) {
      this.logger.error(`Rerank failed: ${error.message}`);
      // 降级：返回原始顺序的前 N 个
      return documents.slice(0, topN).map((doc, index) => ({
        index,
        relevanceScore: 1 - index * 0.1, // 模拟分数
        document: doc,
      }));
    }
  }
}

interface RerankDocument {
  id: string;
  content: string;
  parentId: string;
  metadata: any;
}

interface RerankResult {
  index: number;
  relevanceScore: number;
  document: RerankDocument;
}
```

### 2.5 HyDE 查询增强 (可选)

```typescript
// HyDE: Hypothetical Document Embeddings
@Injectable()
export class QueryEnhancementService {
  constructor(
    private readonly aiService: AiChatService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  /**
   * HyDE 查询增强
   *
   * 原理: 让 LLM 先生成一个"假设性答案"，然后用这个答案去做向量检索
   * 效果: 对模糊查询效果提升 20-35%
   */
  async enhanceQueryWithHyDE(query: string): Promise<EnhancedQuery> {
    // 1. 让 LLM 生成假设性答案
    const hypotheticalAnswer = await this.aiService.chat({
      model: "gpt-4o-mini", // 用小模型节省成本
      messages: [
        {
          role: "system",
          content: `你是一个专业的研究助手。请根据用户的问题，写一段可能的答案（150-300字）。
这个答案不需要完全准确，但应该包含相关的专业术语和概念。
直接输出答案内容，不要任何前缀。`,
        },
        { role: "user", content: query },
      ],
      temperature: 0.7,
      max_tokens: 400,
    });

    // 2. 对假设性答案做 embedding
    const hydeEmbedding = await this.embeddingService.embed(
      hypotheticalAnswer.content,
    );

    // 3. 同时保留原始查询的 embedding
    const originalEmbedding = await this.embeddingService.embed(query);

    return {
      originalQuery: query,
      hypotheticalAnswer: hypotheticalAnswer.content,
      originalEmbedding,
      hydeEmbedding,
      // 可以选择使用哪个 embedding，或者两者加权平均
      finalEmbedding: this.averageEmbeddings(
        originalEmbedding,
        hydeEmbedding,
        0.7,
      ),
    };
  }

  private averageEmbeddings(
    emb1: number[],
    emb2: number[],
    weight1: number = 0.5,
  ): number[] {
    const weight2 = 1 - weight1;
    return emb1.map((v, i) => v * weight1 + emb2[i] * weight2);
  }
}
```

---

## 3. 数据库 Schema (PostgreSQL 单库)

```prisma
// schema.prisma - 完整版

// ==================== 知识库核心表 ====================

// 知识库
model KnowledgeBase {
  id            String   @id @default(uuid())
  userId        String   @map("user_id")
  name          String
  description   String?

  // 状态
  status        KnowledgeBaseStatus @default(CREATING)
  lastError     String?  @map("last_error") @db.Text

  // 统计
  documentCount Int      @default(0) @map("document_count")
  chunkCount    Int      @default(0) @map("chunk_count")
  totalTokens   Int      @default(0) @map("total_tokens")

  // 时间戳
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")
  lastSyncAt    DateTime? @map("last_sync_at")

  // 关系
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  documents     KnowledgeBaseDocument[]
  parentChunks  ParentChunk[]

  @@index([userId])
  @@map("knowledge_bases")
}

enum KnowledgeBaseStatus {
  CREATING
  INDEXING
  READY
  SYNCING
  ERROR
}

// 知识库文档
model KnowledgeBaseDocument {
  id              String   @id @default(uuid())
  knowledgeBaseId String   @map("knowledge_base_id")

  // 来源信息
  sourceType      DocumentSourceType @default(GOOGLE_DRIVE)
  sourceId        String   @map("source_id")

  // 文档信息
  title           String
  mimeType        String   @map("mime_type")
  fileSize        Int?     @map("file_size")

  // 索引状态
  indexStatus     DocumentIndexStatus @default(PENDING)
  indexError      String?  @map("index_error") @db.Text
  parentChunkCount Int     @default(0) @map("parent_chunk_count")
  childChunkCount Int      @default(0) @map("child_chunk_count")
  tokenCount      Int      @default(0) @map("token_count")

  // 同步信息
  sourceModifiedAt DateTime? @map("source_modified_at")
  lastIndexedAt   DateTime? @map("last_indexed_at")
  contentHash     String?  @map("content_hash")

  // 时间戳
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  // 关系
  knowledgeBase   KnowledgeBase @relation(fields: [knowledgeBaseId], references: [id], onDelete: Cascade)
  parentChunks    ParentChunk[]

  @@unique([knowledgeBaseId, sourceId])
  @@index([knowledgeBaseId])
  @@map("knowledge_base_documents")
}

// ==================== Parent-Child 分块表 ====================

// 父块 (大块，用于生成)
model ParentChunk {
  id              String   @id @default(uuid())
  knowledgeBaseId String   @map("knowledge_base_id")
  documentId      String   @map("document_id")

  // 内容
  content         String   @db.Text
  tokenCount      Int      @map("token_count")

  // 位置信息
  position        Int
  pageStart       Int?     @map("page_start")
  pageEnd         Int?     @map("page_end")
  sectionTitle    String?  @map("section_title")

  // 元数据
  metadata        Json?

  // 时间戳
  createdAt       DateTime @default(now()) @map("created_at")

  // 关系
  knowledgeBase   KnowledgeBase @relation(fields: [knowledgeBaseId], references: [id], onDelete: Cascade)
  document        KnowledgeBaseDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)
  childChunks     ChildChunk[]

  @@index([knowledgeBaseId])
  @@index([documentId])
  @@map("parent_chunks")
}

// 子块 (小块，用于检索)
model ChildChunk {
  id           String   @id @default(uuid())
  parentId     String   @map("parent_id")
  documentId   String   @map("document_id")

  // 内容
  content      String   @db.Text
  tokenCount   Int      @map("token_count")

  // 位置信息
  position     Int      // 在父块内的位置

  // BM25 全文搜索 (使用原生 SQL 管理 tsvector)
  // content_tsvector 在迁移 SQL 中定义

  // 时间戳
  createdAt    DateTime @default(now()) @map("created_at")

  // 关系
  parent       ParentChunk @relation(fields: [parentId], references: [id], onDelete: Cascade)
  embedding    ChildEmbedding?

  @@index([parentId])
  @@index([documentId])
  @@map("child_chunks")
}

// 子块向量
model ChildEmbedding {
  id        String   @id @default(uuid())
  childId   String   @unique @map("child_id")

  // 向量 (使用 pgvector 扩展)
  // vector 字段在迁移 SQL 中定义

  model     String   @default("text-embedding-3-small")
  createdAt DateTime @default(now()) @map("created_at")

  // 关系
  child     ChildChunk @relation(fields: [childId], references: [id], onDelete: Cascade)

  @@map("child_embeddings")
}

// ==================== AI 集成扩展 ====================

// 扩展 AskSession
model AskSession {
  // ... 现有字段 ...

  // 知识库配置
  knowledgeBaseIds   String[] @default([]) @map("knowledge_base_ids")
  useKnowledgeBase   Boolean  @default(false) @map("use_knowledge_base")
  enableHyDE         Boolean  @default(false) @map("enable_hyde")  // HyDE 开关
  enableRerank       Boolean  @default(true) @map("enable_rerank") // Rerank 开关
}

// 扩展 ResearchProject
model ResearchProject {
  // ... 现有字段 ...

  // 知识库配置
  knowledgeBaseIds   String[] @default([]) @map("knowledge_base_ids")
  searchPriority     SearchPriority @default(BALANCED) @map("search_priority")
  enableHyDE         Boolean  @default(false) @map("enable_hyde")
  enableRerank       Boolean  @default(true) @map("enable_rerank")
}

enum SearchPriority {
  KNOWLEDGE_BASE_FIRST
  WEB_FIRST
  BALANCED
}
```

---

## 4. 完整 RAG 服务实现

```typescript
// backend/src/modules/knowledge-base/services/rag-pipeline.service.ts

@Injectable()
export class RAGPipelineService {
  private readonly logger = new Logger(RAGPipelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
    private readonly rerankService: RerankService,
    private readonly queryEnhancementService: QueryEnhancementService,
  ) {}

  /**
   * 完整 RAG Pipeline (最佳实践版)
   */
  async search(
    knowledgeBaseIds: string[],
    query: string,
    options: RAGSearchOptions = {},
  ): Promise<RAGSearchResult> {
    const {
      topK = 5,
      enableHyDE = false,
      enableRerank = true,
      bm25Weight = 0.5,
      vectorWeight = 0.5,
    } = options;

    const startTime = Date.now();

    // ========== Stage 1: Query Enhancement (可选 HyDE) ==========
    let queryVector: number[];
    let hydeAnswer: string | null = null;

    if (enableHyDE) {
      this.logger.log("Using HyDE query enhancement");
      const enhanced =
        await this.queryEnhancementService.enhanceQueryWithHyDE(query);
      queryVector = enhanced.finalEmbedding;
      hydeAnswer = enhanced.hypotheticalAnswer;
    } else {
      queryVector = await this.embeddingService.embed(query);
    }

    // ========== Stage 2: Hybrid Search (BM25 + Vector + RRF) ==========
    const hybridResults = await this.hybridSearch(
      query,
      queryVector,
      knowledgeBaseIds,
      topK * 4, // 获取更多候选用于 Rerank
      bm25Weight,
      vectorWeight,
    );

    this.logger.log(`Hybrid search found ${hybridResults.length} candidates`);

    if (hybridResults.length === 0) {
      return {
        chunks: [],
        parentChunks: [],
        query,
        totalFound: 0,
        searchTime: Date.now() - startTime,
        stages: { hybridSearch: true, rerank: false, parentRetrieval: false },
      };
    }

    // ========== Stage 3: Reranking ==========
    let finalResults: HybridSearchResult[];

    if (enableRerank && hybridResults.length > topK) {
      const rerankInput = hybridResults.map((r) => ({
        id: r.childId,
        content: r.content,
        parentId: r.parentId,
        metadata: { documentId: r.documentId },
      }));

      const reranked = await this.rerankService.rerank(
        query,
        rerankInput,
        topK,
      );

      finalResults = reranked.map((r) => ({
        ...hybridResults[r.index],
        rerankScore: r.relevanceScore,
      }));

      this.logger.log(`Reranked to ${finalResults.length} results`);
    } else {
      finalResults = hybridResults.slice(0, topK);
    }

    // ========== Stage 4: Parent Chunk Retrieval ==========
    const parentIds = [...new Set(finalResults.map((r) => r.parentId))];
    const parentChunks = await this.prisma.parentChunk.findMany({
      where: { id: { in: parentIds } },
      include: {
        document: {
          select: { title: true, sourceId: true },
        },
      },
    });

    const parentChunkMap = new Map(parentChunks.map((p) => [p.id, p]));

    // ========== 构建最终结果 ==========
    const searchTime = Date.now() - startTime;

    return {
      chunks: finalResults.map((r) => ({
        id: r.childId,
        content: r.content,
        parentId: r.parentId,
        documentId: r.documentId,
        bm25Score: r.bm25Score,
        vectorScore: r.vectorScore,
        rrfScore: r.rrfScore,
        rerankScore: r.rerankScore,
      })),
      parentChunks: parentChunks.map((p) => ({
        id: p.id,
        content: p.content,
        documentId: p.documentId,
        documentTitle: p.document.title,
        pageStart: p.pageStart,
        pageEnd: p.pageEnd,
        sectionTitle: p.sectionTitle,
      })),
      query,
      hydeAnswer,
      totalFound: hybridResults.length,
      searchTime,
      stages: {
        hybridSearch: true,
        rerank: enableRerank,
        parentRetrieval: true,
      },
    };
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
  ): Promise<HybridSearchResult[]> {
    const vectorString = `[${queryVector.join(",")}]`;

    // 调用 PostgreSQL 混合搜索函数
    const results = await this.prisma.$queryRaw<HybridSearchResult[]>`
      SELECT * FROM hybrid_search(
        ${queryText},
        ${vectorString}::vector,
        ${kbIds}::uuid[],
        ${limit},
        ${bm25Weight},
        ${vectorWeight},
        60  -- RRF k 值
      )
    `;

    return results;
  }

  /**
   * 构建 RAG Context (用于 LLM)
   */
  async buildContext(
    searchResult: RAGSearchResult,
    maxTokens: number = 8000,
  ): Promise<RAGContext> {
    const { parentChunks, chunks } = searchResult;

    // 按相关性排序的 parent chunks
    const usedParentIds = chunks
      .sort(
        (a, b) => (b.rerankScore || b.rrfScore) - (a.rerankScore || a.rrfScore),
      )
      .map((c) => c.parentId);

    const orderedParents = [...new Set(usedParentIds)]
      .map((id) => parentChunks.find((p) => p.id === id))
      .filter(Boolean);

    // 构建上下文，控制 token 数
    const contextParts: string[] = [];
    const sources: SourceReference[] = [];
    let totalTokens = 0;

    for (let i = 0; i < orderedParents.length; i++) {
      const parent = orderedParents[i];
      const estimatedTokens = this.estimateTokens(parent.content);

      if (totalTokens + estimatedTokens > maxTokens) {
        break;
      }

      const sourceNum = i + 1;
      const location = parent.pageStart
        ? `Page ${parent.pageStart}${parent.pageEnd !== parent.pageStart ? `-${parent.pageEnd}` : ""}`
        : parent.sectionTitle || `Section ${parent.id.slice(-4)}`;

      contextParts.push(
        `[${sourceNum}] 来源: ${parent.documentTitle} (${location})\n${parent.content}`,
      );

      sources.push({
        index: sourceNum,
        documentId: parent.documentId,
        documentTitle: parent.documentTitle,
        pageStart: parent.pageStart,
        pageEnd: parent.pageEnd,
        sectionTitle: parent.sectionTitle,
        excerpt: parent.content.substring(0, 200) + "...",
      });

      totalTokens += estimatedTokens;
    }

    return {
      contextText: contextParts.join("\n\n---\n\n"),
      sources,
      totalTokens,
      parentChunksUsed: sources.length,
    };
  }

  private estimateTokens(text: string): number {
    // 中文约 1.5 字符/token，英文约 4 字符/token
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return Math.ceil(chineseChars / 1.5 + otherChars / 4);
  }
}

// Types
interface RAGSearchOptions {
  topK?: number;
  enableHyDE?: boolean;
  enableRerank?: boolean;
  bm25Weight?: number;
  vectorWeight?: number;
}

interface HybridSearchResult {
  childId: string;
  parentId: string;
  content: string;
  documentId: string;
  bm25Rank: number;
  vectorRank: number;
  rrfScore: number;
  bm25Score: number;
  vectorScore: number;
  rerankScore?: number;
}

interface RAGSearchResult {
  chunks: ChunkResult[];
  parentChunks: ParentChunkResult[];
  query: string;
  hydeAnswer?: string;
  totalFound: number;
  searchTime: number;
  stages: {
    hybridSearch: boolean;
    rerank: boolean;
    parentRetrieval: boolean;
  };
}

interface RAGContext {
  contextText: string;
  sources: SourceReference[];
  totalTokens: number;
  parentChunksUsed: number;
}
```

---

## 5. 性能指标 (最佳实践版)

| 指标         | 基础版 (v1.0) | 最佳实践版 (v2.0) | 提升   |
| ------------ | ------------- | ----------------- | ------ |
| 检索召回率   | ~70%          | ~85-90%           | +20%   |
| 检索精度     | ~60%          | ~85%              | +25%   |
| 端到端延迟   | ~800ms        | ~1.5s             | +700ms |
| 上下文利用率 | ~60%          | ~85%              | +25%   |
| 引用准确率   | ~80%          | ~95%              | +15%   |

**延迟分解 (v2.0)**:

- Query Enhancement (HyDE): ~300ms (可选)
- Hybrid Search: ~200ms
- Reranking: ~500ms
- Parent Retrieval: ~100ms
- Context Building: ~50ms
- **Total**: ~1.2-1.5s

---

## 6. 外部依赖

| 依赖                      | 用途       | 成本             |
| ------------------------- | ---------- | ---------------- |
| **OpenAI Embedding API**  | 向量化     | $0.02/1M tokens  |
| **Cohere Rerank API**     | 精排       | $1/1000 searches |
| **PostgreSQL + pgvector** | 存储和搜索 | 已有             |

**月度成本估算** (10万次查询/月):

- Embedding: ~$20
- Rerank: ~$100
- **Total**: ~$120/月

---

## 7. 任务分解

| Phase                 | Task                                         | Est. | Priority |
| --------------------- | -------------------------------------------- | ---- | -------- |
| **Phase 1: 基础设施** |                                              |      |          |
| T-001                 | 数据库 Schema 迁移 (Parent-Child + tsvector) | 0.5d | P0       |
| T-002                 | PostgreSQL 混合搜索函数实现                  | 1d   | P0       |
| T-003                 | 文档处理流水线 (Parent-Child 分块)           | 1.5d | P0       |
| T-004                 | Embedding 服务                               | 0.5d | P0       |
| **Phase 2: RAG 核心** |                                              |      |          |
| T-005                 | Cohere Rerank 集成                           | 0.5d | P0       |
| T-006                 | RAG Pipeline 服务 (完整流程)                 | 1d   | P0       |
| T-007                 | Context Builder 服务                         | 0.5d | P0       |
| T-008                 | HyDE 查询增强 (可选)                         | 0.5d | P2       |
| **Phase 3: AI 集成**  |                                              |      |          |
| T-009                 | AI Ask 知识库集成                            | 1d   | P0       |
| T-010                 | AI Studio 知识库集成                         | 1d   | P0       |
| T-011                 | 引用生成服务                                 | 0.5d | P0       |
| **Phase 4: 前端**     |                                              |      |          |
| T-012                 | 知识库管理页面                               | 1.5d | P0       |
| T-013                 | AI Ask 知识库选择器 + 引用展示               | 1d   | P0       |
| T-014                 | AI Studio 数据源配置                         | 0.5d | P0       |
| **Phase 5: 优化**     |                                              |      |          |
| T-015                 | 同步更新机制                                 | 1d   | P1       |
| T-016                 | 性能优化 + 缓存                              | 1d   | P1       |
| T-017                 | 监控 + 错误处理                              | 0.5d | P0       |

**Total**: ~14 工作日

---

## 8. References

- [RAG Best Practices 2025 - Orkes](https://orkes.io/blog/rag-best-practices/)
- [Enterprise RAG Guide - Data Nucleus](https://datanucleus.dev/rag-and-agentic-ai/what-is-rag-enterprise-guide-2025)
- [Cohere Rerank Documentation](https://docs.cohere.com/reference/rerank)
- [pgvector Documentation](https://github.com/pgvector/pgvector)
- [PostgreSQL Full Text Search](https://www.postgresql.org/docs/current/textsearch.html)
- [HyDE Paper](https://arxiv.org/abs/2212.10496)

---

## Change Log

| Version | Date       | Changes                | Author               |
| ------- | ---------- | ---------------------- | -------------------- |
| 1.0     | 2025-12-26 | Initial PRD            | PM & Architect Agent |
| 2.0     | 2025-12-26 | Best Practices Edition | PM & Architect Agent |
