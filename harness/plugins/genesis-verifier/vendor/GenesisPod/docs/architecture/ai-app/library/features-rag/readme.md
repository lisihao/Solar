# RAG - 检索增强生成系统

> Embedding + Rerank + HyDE，构建企业级知识库问答系统

**最后更新**: 2026-01-15
**版本**: v1.0
**状态**: 生产环境

---

## 概述

RAG（Retrieval-Augmented Generation）模块是 GenesisPod 的知识库管理和检索系统，为 AI Ask、AI Teams 等应用提供知识检索增强能力。

### 核心特性

- **多源导入**: 支持 URL、本地文件、Google Drive、微信公众号
- **智能分块**: 自动文档分块和元数据提取
- **向量检索**: 基于 Embedding 的语义搜索
- **HyDE 增强**: 假设文档生成提升召回率
- **Rerank 重排**: 二次排序提升精准度
- **多知识库**: 支持跨多个知识库检索

---

## 系统架构

### RAG Pipeline

```
文档导入
    ↓
[Document Processing] 文档解析
    ├── PDF → 文本提取
    ├── Word → Markdown
    ├── URL → 网页抓取
    └── 微信公众号 → HTML 解析
    ↓
[Chunking] 智能分块
    ├── 语义分段
    ├── 重叠窗口
    └── 元数据保留
    ↓
[Embedding] 向量化
    ├── 使用 Embedding 模型
    └── 存储向量到数据库
    ↓
检索查询
    ↓
[HyDE] 假设文档生成（可选）
    ↓
[Vector Search] 向量检索
    ↓
[Rerank] 重排序（可选）
    ↓
返回相关片段
```

### 技术栈

| 层级       | 技术选型                      |
| ---------- | ----------------------------- |
| 后端       | NestJS + RAGPipelineService   |
| 向量数据库 | PostgreSQL + pgvector         |
| Embedding  | OpenAI text-embedding-3-large |
| Rerank     | Cohere Rerank API             |
| 文档解析   | pdf-parse, mammoth, cheerio   |
| 存储       | PostgreSQL (文档 + 向量)      |

---

## 功能模块

### 1. 知识库管理

#### 创建知识库

```typescript
POST /api/v1/rag/knowledge-bases
{
  "name": "产品文档库",
  "description": "公司所有产品相关文档",
  "embeddingModel": "text-embedding-3-large"
}

Response:
{
  "id": "kb-xxx",
  "name": "产品文档库",
  "documentCount": 0,
  "createdAt": "2026-01-15T10:00:00Z"
}
```

#### 获取知识库列表

```typescript
GET /api/v1/rag/knowledge-bases

Response:
{
  "knowledgeBases": [
    {
      "id": "kb-xxx",
      "name": "产品文档库",
      "documentCount": 23,
      "chunkCount": 456,
      "createdAt": "2026-01-15T10:00:00Z"
    }
  ]
}
```

### 2. 文档导入

#### 上传本地文件

```typescript
POST /api/v1/rag/knowledge-bases/:id/documents/upload
Content-Type: multipart/form-data

File: document.pdf

Response:
{
  "documentId": "doc-xxx",
  "title": "产品需求文档",
  "status": "PROCESSING", // PROCESSING | COMPLETED | FAILED
  "chunks": 0
}
```

#### 从 URL 导入

```typescript
POST /api/v1/rag/knowledge-bases/:id/documents/url
{
  "url": "https://example.com/article",
  "title": "可选标题" // 不提供则自动提取
}

# 系统自动:
# 1. 抓取网页内容
# 2. 提取主体文本
# 3. 分块和 Embedding
# 4. 存储到知识库
```

#### Google Drive 导入

```typescript
POST /api/v1/rag/knowledge-bases/:id/documents/google-drive
{
  "fileId": "1abc...xyz", // Google Drive 文件 ID
  "accessToken": "ya29...." // 用户 OAuth Token
}

# 支持格式:
# - Google Docs
# - Google Sheets
# - Google Slides
# - PDF, Word, Excel 等
```

#### 微信公众号导入

```typescript
POST /api/v1/rag/knowledge-bases/:id/documents/wechat
{
  "articleUrl": "https://mp.weixin.qq.com/s/xxxx"
}

# 系统自动:
# 1. 解析微信文章 HTML
# 2. 提取正文、图片、链接
# 3. 转换为 Markdown
# 4. 分块和向量化
```

### 3. RAG 检索

#### 基础查询

```typescript
POST /api/v1/rag/query
{
  "query": "如何配置数据库连接？",
  "knowledgeBaseIds": ["kb-1", "kb-2"], // 支持跨库检索
  "options": {
    "topK": 5, // 返回 Top-K 结果
    "minScore": 0.7 // 最低相似度阈值
  }
}

Response:
{
  "context": {
    "text": "数据库连接配置位于 .env 文件中...\n\n另外，在 prisma/schema.prisma 中...",
    "sources": [
      {
        "documentId": "doc-xxx",
        "documentTitle": "部署指南.pdf",
        "chunkId": "chunk-yyy",
        "excerpt": "数据库连接配置位于 .env 文件中，使用 DATABASE_URL 环境变量...",
        "score": 0.89,
        "metadata": {
          "page": 5,
          "section": "环境配置"
        }
      }
    ]
  }
}
```

#### HyDE 增强查询

```typescript
POST /api/v1/rag/query
{
  "query": "数据库怎么配置？",
  "knowledgeBaseIds": ["kb-xxx"],
  "options": {
    "useHyde": true, // 启用 HyDE
    "topK": 5
  }
}

# HyDE 流程:
# 1. 根据用户问题生成假设性文档
#    Input: "数据库怎么配置？"
#    HyDE 生成: "数据库配置通常在 .env 文件中，使用 DATABASE_URL 环境变量，格式为 postgresql://..."
# 2. 用生成的文档去检索（而不是用原问题）
# 3. 提升召回率
```

#### Rerank 重排

```typescript
POST /api/v1/rag/query
{
  "query": "数据库配置",
  "knowledgeBaseIds": ["kb-xxx"],
  "options": {
    "topK": 20, // 先检索 20 个候选
    "useRerank": true, // 启用 Rerank
    "rerankTopK": 5, // 重排后返回 Top-5
    "minScore": 0.6 // Rerank 后的最低分数
  }
}

# Rerank 流程:
# 1. 向量检索返回 Top-20
# 2. 调用 Cohere Rerank API 重新排序
# 3. 返回 Top-5 最相关结果
# 优势: 更精准，考虑问题和文档的语义匹配度
```

### 4. 文档管理

#### 查看文档详情

```typescript
GET /api/v1/rag/documents/:id

Response:
{
  "id": "doc-xxx",
  "title": "产品需求文档",
  "source": "upload", // upload | url | google-drive | wechat
  "status": "COMPLETED",
  "metadata": {
    "author": "张三",
    "createdAt": "2026-01-10",
    "pageCount": 15
  },
  "chunks": [
    {
      "id": "chunk-1",
      "content": "第一章：产品概述...",
      "tokens": 256,
      "metadata": { "page": 1, "section": "产品概述" }
    }
  ]
}
```

#### 重新处理文档

```typescript
POST /api/v1/rag/documents/:id/reprocess

# 重新分块、Embedding
# 适用于:
# - 更换 Embedding 模型
# - 调整分块策略
# - 修复处理失败的文档
```

#### 删除文档

```typescript
DELETE /api/v1/rag/documents/:id

# 同时删除:
# - 文档记录
# - 所有 Chunks
# - 向量数据
```

---

## API 接口

### 知识库管理

| 方法   | 路径                              | 说明           |
| ------ | --------------------------------- | -------------- |
| POST   | `/api/v1/rag/knowledge-bases`     | 创建知识库     |
| GET    | `/api/v1/rag/knowledge-bases`     | 获取知识库列表 |
| GET    | `/api/v1/rag/knowledge-bases/:id` | 获取知识库详情 |
| PATCH  | `/api/v1/rag/knowledge-bases/:id` | 更新知识库     |
| DELETE | `/api/v1/rag/knowledge-bases/:id` | 删除知识库     |

### 文档导入

| 方法 | 路径                                                     | 说明              |
| ---- | -------------------------------------------------------- | ----------------- |
| POST | `/api/v1/rag/knowledge-bases/:id/documents/upload`       | 上传文件          |
| POST | `/api/v1/rag/knowledge-bases/:id/documents/url`          | 从 URL 导入       |
| POST | `/api/v1/rag/knowledge-bases/:id/documents/google-drive` | Google Drive 导入 |
| POST | `/api/v1/rag/knowledge-bases/:id/documents/wechat`       | 微信公众号导入    |

### 文档管理

| 方法   | 路径                                        | 说明         |
| ------ | ------------------------------------------- | ------------ |
| GET    | `/api/v1/rag/documents/:id`                 | 获取文档详情 |
| POST   | `/api/v1/rag/documents/:id/reprocess`       | 重新处理     |
| DELETE | `/api/v1/rag/documents/:id`                 | 删除文档     |
| GET    | `/api/v1/rag/knowledge-bases/:id/documents` | 获取文档列表 |

### RAG 检索

| 方法 | 路径                      | 说明     |
| ---- | ------------------------- | -------- |
| POST | `/api/v1/rag/query`       | RAG 查询 |
| POST | `/api/v1/rag/batch-query` | 批量查询 |

---

## 数据模型

### KnowledgeBase

```prisma
model KnowledgeBase {
  id             String   @id @default(cuid())
  userId         String
  name           String
  description    String?
  embeddingModel String   @default("text-embedding-3-large")
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  documents      Document[]
}
```

### Document

```prisma
model Document {
  id              String   @id @default(cuid())
  knowledgeBaseId String
  title           String
  source          String   // upload | url | google-drive | wechat
  sourceUrl       String?
  status          String   // PROCESSING | COMPLETED | FAILED
  metadata        Json?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  chunks          DocumentChunk[]
  knowledgeBase   KnowledgeBase @relation(fields: [knowledgeBaseId], references: [id], onDelete: Cascade)
}
```

### DocumentChunk

```prisma
model DocumentChunk {
  id         String   @id @default(cuid())
  documentId String
  content    String   @db.Text
  embedding  Vector(1536) // pgvector
  tokens     Int
  metadata   Json?    // page, section, heading
  createdAt  DateTime @default(now())

  document   Document @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([embedding], type: Hnsw) // pgvector HNSW 索引
}
```

---

## 核心服务说明

### RAGPipelineService

RAG 主服务，负责：

- 编排完整 RAG 流程
- 协调各子服务
- 返回检索结果

### DocumentProcessorService

文档处理服务，负责：

- 解析各种格式文档
- 提取文本内容
- 提取元数据

### EmbeddingProcessorService

Embedding 服务，负责：

- 调用 Embedding 模型
- 批量向量化
- 管理 Embedding 配额

### UrlFetchService

URL 抓取服务，负责：

- 抓取网页内容
- 提取主体文本
- 处理动态加载页面

### WechatImportService

微信导入服务，负责：

- 解析微信公众号文章
- 提取图片和链接
- 转换为 Markdown

### GoogleDriveRAGService

Google Drive 服务，负责：

- OAuth 认证
- 下载 Drive 文件
- 解析 Google 文档格式

---

## 配置项

### Chunking 策略

```typescript
// rag/services/document-processor.service.ts
const CHUNK_CONFIG = {
  maxTokens: 512, // 每块最大 Token 数
  overlap: 50, // 重叠 Token 数
  strategy: "semantic", // semantic | fixed | markdown
};
```

### Embedding 模型

```typescript
// 支持的模型
const EMBEDDING_MODELS = {
  "text-embedding-3-large": 3072, // 维度
  "text-embedding-3-small": 1536,
  "text-embedding-ada-002": 1536,
};
```

### HyDE 提示词

```typescript
// HyDE 假设文档生成提示词
const HYDE_PROMPT = `Based on the question below, generate a hypothetical document that would answer this question. Write in a factual, informative style.

Question: {query}

Hypothetical Document:`;
```

---

## 前端集成

### Hook 使用

```typescript
import { useKnowledgeBases, useRAGQuery, useDocumentUpload } from '@/hooks/domain';

function RAGPanel() {
  const { knowledgeBases } = useKnowledgeBases();
  const { query, querying } = useRAGQuery();
  const { upload, uploading } = useDocumentUpload();

  const handleQuery = async (question: string) => {
    const result = await query({
      query: question,
      knowledgeBaseIds: [knowledgeBases[0]?.id],
      options: { topK: 5, useRerank: true }
    });
    console.log('检索结果:', result.context.sources);
  };

  return <div>...</div>;
}
```

### 路由结构

```
/rag
  ├── /                         # 知识库列表
  ├── /new                      # 创建知识库
  ├── /[kbId]                   # 知识库详情
  │   ├── /                     # 文档列表
  │   ├── /upload               # 上传文档
  │   └── /settings             # 知识库设置
  └── /query                    # RAG 检索测试界面
```

---

## 使用指南

### 1. 创建知识库并上传文档

```bash
# 1. 创建知识库
curl -X POST https://api.gens.team/api/v1/rag/knowledge-bases \
  -d '{"name": "技术文档库"}'

# 2. 上传文档
curl -X POST https://api.gens.team/api/v1/rag/knowledge-bases/KB_ID/documents/upload \
  -F "file=@document.pdf"

# 3. 等待处理完成（状态变为 COMPLETED）
```

### 2. RAG 查询

```bash
curl -X POST https://api.gens.team/api/v1/rag/query \
  -d '{
    "query": "如何配置数据库？",
    "knowledgeBaseIds": ["kb-xxx"],
    "options": {
      "topK": 5,
      "useHyde": false,
      "useRerank": true
    }
  }'
```

### 3. 集成到 AI Ask

```typescript
// AI Ask 自动使用 RAG
POST /api/v1/ai-ask/sessions/SESSION_ID/messages
{
  "content": "根据文档，如何配置数据库？",
  "knowledgeBaseIds": ["kb-xxx"] // 指定知识库
}

# 系统自动:
# 1. RAG 检索相关文档
# 2. 将检索结果注入 AI 上下文
# 3. AI 基于文档内容回答
```

---

## 最佳实践

### 1. 文档准备

- **格式选择**: PDF > Word > 纯文本
- **文档质量**: 清晰的章节结构，避免扫描件
- **元数据**: 提供标题、作者、日期等元数据

### 2. 知识库组织

- **按主题分库**: 技术文档、产品文档、市场文档分开管理
- **定期更新**: 删除过时文档，添加最新内容
- **权限管理**: 敏感文档单独建库

### 3. 检索优化

- **HyDE**: 用于模糊问题（"怎么做"类问题）
- **Rerank**: 用于精准查询（"具体参数是什么"）
- **topK**: 一般设置 5-10
- **minScore**: 0.6-0.7 比较合适

### 4. 成本控制

- **Embedding 缓存**: 相同文档不重复 Embedding
- **批量处理**: 大量文档分批次上传
- **Rerank 选择性使用**: 仅在需要高精度时启用

---

## 性能指标

| 指标         | 目标值             |
| ------------ | ------------------ |
| 文档上传处理 | < 30s / 10MB       |
| RAG 查询延迟 | < 2s (不含 Rerank) |
| RAG 查询延迟 | < 4s (含 Rerank)   |
| 向量检索精度 | > 85% (Top-5)      |

---

## 相关文档

- [AI Ask RAG 集成](../ai-ask/readme.md#rag-知识库问答)
- [pgvector 配置指南](../../../guides/database-extensions.md)
- [Embedding 模型对比](../../../guides/ai-models.md#embedding-models)

---

## 更新日志

### v1.0 (2026-01-15)

- 初始版本发布
- 支持多源文档导入
- HyDE 增强检索
- Rerank 重排序
- Google Drive 和微信公众号集成
