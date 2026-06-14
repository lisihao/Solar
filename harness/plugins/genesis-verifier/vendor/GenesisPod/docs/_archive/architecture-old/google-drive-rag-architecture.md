# Google Drive RAG 知识库 - 技术架构设计

> **Version**: 1.0
> **Author**: Architect Agent
> **Created**: 2025-12-26
> **Status**: Draft

---

## 1. Architecture Overview

### 1.1 系统架构图

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                    Frontend (Next.js)                                    │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────────────────┐ │
│  │  Knowledge Base     │  │  AI Ask             │  │  AI Studio                      │ │
│  │  Management UI      │  │  + RAG Integration  │  │  + Knowledge Base Sources       │ │
│  │                     │  │                     │  │                                 │ │
│  │  • Create/Delete KB │  │  • KB Selector      │  │  • Data Source Config           │ │
│  │  • Add Documents    │  │  • Source Citations │  │  • Search Priority              │ │
│  │  • Sync Status      │  │  • Citation Viewer  │  │  • Report Citations             │ │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────────────────┘ │
│                                                                                         │
└──────────────────────────────────────────┬──────────────────────────────────────────────┘
                                           │ REST API + SSE
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                    Backend (NestJS)                                      │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │                           Knowledge Base Module                                  │   │
│  │  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────────────┐   │   │
│  │  │ KnowledgeBase     │  │ Document          │  │ Sync                      │   │   │
│  │  │ Service           │  │ Processor         │  │ Service                   │   │   │
│  │  │                   │  │                   │  │                           │   │   │
│  │  │ • CRUD Operations │  │ • Content Extract │  │ • Change Detection        │   │   │
│  │  │ • Document Mgmt   │  │ • Chunking        │  │ • Incremental Update      │   │   │
│  │  │ • Stats           │  │ • Embedding       │  │ • Scheduled Sync          │   │   │
│  │  └───────────────────┘  └───────────────────┘  └───────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │                              RAG Core Engine                                     │   │
│  │  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────────────┐   │   │
│  │  │ RAG Search        │  │ Context           │  │ Citation                  │   │   │
│  │  │ Service           │  │ Builder           │  │ Generator                 │   │   │
│  │  │                   │  │                   │  │                           │   │   │
│  │  │ • Semantic Search │  │ • Prompt Building │  │ • Reference Extraction   │   │   │
│  │  │ • Reranking       │  │ • Token Limiting  │  │ • Source Linking          │   │   │
│  │  │ • Filtering       │  │ • Deduplication   │  │ • Citation Formatting     │   │   │
│  │  └───────────────────┘  └───────────────────┘  └───────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                         │
│  ┌───────────────────────────────────┐  ┌───────────────────────────────────────────┐ │
│  │ AI Ask Service (Enhanced)         │  │ Deep Research Service (Enhanced)          │ │
│  │                                   │  │                                           │ │
│  │ + RAGSearchService integration    │  │ + Knowledge Base as data source           │ │
│  │ + Context augmentation            │  │ + Hybrid search (KB + Web)                │ │
│  │ + Citation injection              │  │ + Source type annotation                  │ │
│  └───────────────────────────────────┘  └───────────────────────────────────────────┘ │
│                                                                                         │
└──────────────────────────────────────────┬──────────────────────────────────────────────┘
                                           │
                    ┌──────────────────────┼──────────────────────┐
                    │                      │                      │
                    ▼                      ▼                      ▼
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│   PostgreSQL + pgvector │  │   Google Drive API      │  │   OpenAI API            │
│                         │  │                         │  │                         │
│   • knowledge_bases     │  │   • OAuth 2.0           │  │   • text-embedding-3    │
│   • kb_documents        │  │   • Files API           │  │   • GPT-4o              │
│   • chunks              │  │   • Export API          │  │   • Claude              │
│   • embeddings (vector) │  │                         │  │                         │
└─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘
```

### 1.2 核心组件职责

| Component                | Responsibility                     |
| ------------------------ | ---------------------------------- |
| **KnowledgeBaseService** | 知识库 CRUD、文档管理、统计计算    |
| **DocumentProcessor**    | 内容提取、智能分块、批量向量化     |
| **SyncService**          | Google Drive 变更检测、增量更新    |
| **RAGSearchService**     | 语义搜索、结果重排序、相关性过滤   |
| **ContextBuilder**       | 构建 RAG Prompt、Token 限制、去重  |
| **CitationGenerator**    | 提取引用、格式化来源、生成引用列表 |

---

## 2. Data Flow

### 2.1 文档索引流程

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           Document Indexing Pipeline                                 │
└─────────────────────────────────────────────────────────────────────────────────────┘

 ┌─────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌───────┐
 │ Source  │────▶│ Download    │────▶│ Extract     │────▶│ Chunk       │────▶│ Embed │
 │ Files   │     │ Content     │     │ Text        │     │ Content     │     │       │
 └─────────┘     └─────────────┘     └─────────────┘     └─────────────┘     └───────┘
      │                │                    │                   │                │
      │                │                    │                   │                │
      ▼                ▼                    ▼                   ▼                ▼
 ┌─────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌───────┐
 │ Google  │     │ Binary      │     │ Plain Text  │     │ Chunk[]     │     │Vector │
 │ Drive   │     │ Files       │     │ + Metadata  │     │ with Meta   │     │ 1536d │
 │ File ID │     │ (pdf/docx)  │     │             │     │             │     │       │
 └─────────┘     └─────────────┘     └─────────────┘     └─────────────┘     └───────┘
                                                                                  │
                                                                                  ▼
                                                                          ┌─────────────┐
                                                                          │ PostgreSQL  │
                                                                          │ + pgvector  │
                                                                          └─────────────┘

 Timeline:
 ─────────────────────────────────────────────────────────────────────────────────────▶
       │              │              │              │              │
       │              │              │              │              │
    Download       Extract        Chunk         Embed          Store
    (~1-5s)       (~2-10s)       (~1s)        (~2-5s)        (~0.5s)
```

### 2.2 RAG 查询流程

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              RAG Query Flow                                          │
└─────────────────────────────────────────────────────────────────────────────────────┘

User Query: "2024年光伏行业的主要发展趋势是什么?"

Step 1: Query Embedding
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  User Query ──▶ OpenAI Embedding API ──▶ Query Vector (1536 dimensions)              │
└──────────────────────────────────────────────────────────────────────────────────────┘

Step 2: Vector Search
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  Query Vector ──▶ pgvector Cosine Similarity ──▶ Top-K Relevant Chunks               │
│                                                                                      │
│  SELECT c.*, e.vector, 1 - (e.vector <=> $query_vector) AS similarity               │
│  FROM chunks c                                                                       │
│  JOIN embeddings e ON e.chunk_id = c.id                                             │
│  WHERE c.document_id IN (SELECT id FROM kb_documents WHERE kb_id = ANY($kb_ids))    │
│  ORDER BY similarity DESC                                                            │
│  LIMIT 10                                                                            │
└──────────────────────────────────────────────────────────────────────────────────────┘

Step 3: Reranking & Filtering
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  Top-K Chunks ──▶ Relevance Threshold (0.7) ──▶ Deduplicate ──▶ Final Chunks (5)    │
└──────────────────────────────────────────────────────────────────────────────────────┘

Step 4: Context Building
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  ┌─────────────────────────────────────────────────────────────────────────────────┐│
│  │ System Prompt:                                                                   ││
│  │ 你是一个专业的 AI 助手。请基于以下参考资料回答用户问题。                          ││
│  │ 如果参考资料中没有相关信息，请明确说明。                                          ││
│  │ 回答时请在相关内容后标注来源编号，如 [1]、[2]。                                   ││
│  │                                                                                  ││
│  │ 参考资料:                                                                        ││
│  │ [1] 来源: 2024新能源行业报告.pdf (Page 23-25)                                    ││
│  │ N型电池技术在2024年实现了重大突破，TOPCon技术市场份额快速提升...                  ││
│  │                                                                                  ││
│  │ [2] 来源: 光伏产业链分析.pdf (Section 3.2)                                       ││
│  │ 头部企业持续推进垂直一体化布局，硅料-硅片-电池-组件全产业链覆盖...                ││
│  │                                                                                  ││
│  │ [3] 来源: 2024新能源行业报告.pdf (Page 45-48)                                    ││
│  │ 受贸易政策影响，中国光伏企业加速在东南亚、中东等地区布局海外产能...              ││
│  │                                                                                  ││
│  │ 用户问题: 2024年光伏行业的主要发展趋势是什么?                                    ││
│  └─────────────────────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────────────────┘

Step 5: LLM Generation
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  Augmented Prompt ──▶ GPT-4o / Claude ──▶ Response with Citations                   │
└──────────────────────────────────────────────────────────────────────────────────────┘

Step 6: Citation Extraction
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  Response Text ──▶ Extract [1], [2], [3] References ──▶ Link to Source Documents    │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 AI Studio 混合搜索流程

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                        AI Studio Hybrid Search Flow                                  │
└─────────────────────────────────────────────────────────────────────────────────────┘

Research Query: "分析新能源汽车电池技术发展趋势"

                              ┌─────────────────────┐
                              │  Research Planner   │
                              └──────────┬──────────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    │                    │                    │
                    ▼                    ▼                    ▼
         ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
         │  Step 1:        │  │  Step 2:        │  │  Step 3:        │
         │  基础概念搜索   │  │  技术细节搜索   │  │  市场数据搜索   │
         └────────┬────────┘  └────────┬────────┘  └────────┬────────┘
                  │                    │                    │
      ┌───────────┴───────────┐        │        ┌───────────┴───────────┐
      │                       │        │        │                       │
      ▼                       ▼        ▼        ▼                       ▼
┌───────────┐           ┌───────────┐  │  ┌───────────┐           ┌───────────┐
│ Knowledge │           │ Web       │  │  │ Knowledge │           │ Academic  │
│ Base      │           │ Search    │  │  │ Base      │           │ Search    │
│ Search    │           │           │  │  │ Search    │           │           │
└─────┬─────┘           └─────┬─────┘  │  └─────┬─────┘           └─────┬─────┘
      │                       │        │        │                       │
      │  [KB-1] [KB-2]        │        │        │  [KB-3]               │
      │  5 chunks             │        │        │  3 chunks             │
      │                       │        │        │                       │
      │               [Web-1] [Web-2]  │        │               [Acad-1] [Acad-2]
      │               10 results       │        │               5 papers
      │                       │        │        │                       │
      └───────────┬───────────┘        │        └───────────┬───────────┘
                  │                    │                    │
                  ▼                    ▼                    ▼
         ┌─────────────────────────────────────────────────────────────┐
         │                    Result Aggregation                        │
         │  ┌─────────────────────────────────────────────────────────┐ │
         │  │ Sources by Type:                                        │ │
         │  │   • Knowledge Base: 8 chunks from 3 documents           │ │
         │  │   • Web: 10 results from Google/Bing                    │ │
         │  │   • Academic: 5 papers from arXiv                       │ │
         │  └─────────────────────────────────────────────────────────┘ │
         └─────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
         ┌─────────────────────────────────────────────────────────────┐
         │                    Report Synthesis                          │
         │                                                             │
         │  Report with Citations:                                     │
         │  • Private Sources: [KB-1], [KB-2], [KB-3]                  │
         │  • Public Sources: [Web-1], [Web-2], [Acad-1], [Acad-2]     │
         └─────────────────────────────────────────────────────────────┘
```

---

## 3. Component Design

### 3.1 KnowledgeBaseService

```typescript
// backend/src/modules/knowledge-base/knowledge-base.service.ts

@Injectable()
export class KnowledgeBaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documentProcessor: DocumentProcessorService,
    private readonly syncService: SyncService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * 创建知识库
   */
  async create(
    userId: string,
    dto: CreateKnowledgeBaseDto,
  ): Promise<KnowledgeBase> {
    const kb = await this.prisma.knowledgeBase.create({
      data: {
        userId,
        name: dto.name,
        description: dto.description,
        status: "CREATING",
      },
    });

    // 异步添加文档
    if (dto.documents?.length) {
      this.addDocumentsAsync(kb.id, dto.documents);
    }

    return kb;
  }

  /**
   * 添加文档（异步）
   */
  async addDocumentsAsync(
    kbId: string,
    documents: AddDocumentDto[],
  ): Promise<void> {
    // 更新状态为 INDEXING
    await this.prisma.knowledgeBase.update({
      where: { id: kbId },
      data: { status: "INDEXING" },
    });

    // 使用队列处理文档
    for (const doc of documents) {
      await this.documentQueue.add("process-document", {
        knowledgeBaseId: kbId,
        document: doc,
      });
    }
  }

  /**
   * 处理单个文档
   */
  async processDocument(kbId: string, doc: AddDocumentDto): Promise<void> {
    const kbDoc = await this.prisma.knowledgeBaseDocument.create({
      data: {
        knowledgeBaseId: kbId,
        sourceType: doc.sourceType,
        sourceId: doc.sourceId,
        title: doc.title,
        mimeType: doc.mimeType,
        indexStatus: "PROCESSING",
      },
    });

    try {
      // 1. 提取内容
      const content = await this.documentProcessor.extractContent(doc);

      // 2. 分块
      const chunks = await this.documentProcessor.chunkContent(content);

      // 3. 向量化
      const embeddedChunks = await this.documentProcessor.embedChunks(chunks);

      // 4. 存储
      await this.storeChunksWithEmbeddings(kbDoc.id, embeddedChunks);

      // 5. 更新状态
      await this.prisma.knowledgeBaseDocument.update({
        where: { id: kbDoc.id },
        data: {
          indexStatus: "INDEXED",
          chunkCount: embeddedChunks.length,
          tokenCount: embeddedChunks.reduce((sum, c) => sum + c.tokenCount, 0),
          lastIndexedAt: new Date(),
          contentHash: this.computeContentHash(content),
        },
      });

      // 6. 发送进度事件
      this.eventEmitter.emit("kb.document.indexed", {
        kbId,
        documentId: kbDoc.id,
      });
    } catch (error) {
      await this.prisma.knowledgeBaseDocument.update({
        where: { id: kbDoc.id },
        data: {
          indexStatus: "FAILED",
          indexError: error.message,
        },
      });
      throw error;
    }
  }

  /**
   * 存储 chunks 和向量
   */
  private async storeChunksWithEmbeddings(
    documentId: string,
    embeddedChunks: EmbeddedChunk[],
  ): Promise<void> {
    // 批量插入 chunks
    const chunkData = embeddedChunks.map((c, i) => ({
      id: uuidv4(),
      documentId,
      content: c.content,
      tokenCount: c.tokenCount,
      position: i,
      pageNumber: c.metadata?.pageNumber,
      sectionTitle: c.metadata?.sectionTitle,
      metadata: c.metadata,
    }));

    await this.prisma.chunk.createMany({ data: chunkData });

    // 批量插入 embeddings (使用原生 SQL 支持 pgvector)
    for (let i = 0; i < chunkData.length; i++) {
      const chunk = chunkData[i];
      const embedding = embeddedChunks[i].vector;

      await this.prisma.$executeRaw`
        INSERT INTO embeddings (id, chunk_id, vector, model, created_at)
        VALUES (
          ${uuidv4()},
          ${chunk.id},
          ${embedding}::vector,
          'text-embedding-3-small',
          NOW()
        )
      `;
    }
  }

  /**
   * 获取知识库统计信息
   */
  async getStats(kbId: string): Promise<KnowledgeBaseStats> {
    const [docCount, chunkCount, totalTokens] = await Promise.all([
      this.prisma.knowledgeBaseDocument.count({
        where: { knowledgeBaseId: kbId, indexStatus: "INDEXED" },
      }),
      this.prisma.chunk.count({
        where: { document: { knowledgeBaseId: kbId } },
      }),
      this.prisma.chunk.aggregate({
        where: { document: { knowledgeBaseId: kbId } },
        _sum: { tokenCount: true },
      }),
    ]);

    return {
      documentCount: docCount,
      chunkCount,
      totalTokens: totalTokens._sum.tokenCount || 0,
    };
  }
}
```

### 3.2 DocumentProcessorService

```typescript
// backend/src/modules/knowledge-base/services/document-processor.service.ts

@Injectable()
export class DocumentProcessorService {
  private readonly openai: OpenAI;
  private readonly logger = new Logger(DocumentProcessorService.name);

  constructor(
    private readonly googleDriveFileService: GoogleDriveFileService,
    private readonly contentExtractor: ContentExtractorService,
  ) {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  /**
   * 从 Google Drive 提取文档内容
   */
  async extractContent(doc: DocumentSource): Promise<ExtractedContent> {
    this.logger.log(`Extracting content from: ${doc.title}`);

    let rawContent: Buffer;

    if (doc.sourceType === "GOOGLE_DRIVE") {
      // 从 Google Drive 下载
      rawContent = await this.googleDriveFileService.downloadFile(
        doc.userId,
        doc.sourceId,
      );
    } else if (doc.sourceType === "LOCAL_UPLOAD") {
      // 从本地存储读取
      rawContent = await this.readLocalFile(doc.sourceId);
    }

    // 根据 MIME 类型提取文本
    const text = await this.extractTextByMimeType(rawContent, doc.mimeType);

    return {
      text,
      metadata: {
        title: doc.title,
        mimeType: doc.mimeType,
        fileSize: rawContent.length,
        extractedAt: new Date(),
      },
    };
  }

  /**
   * 根据 MIME 类型提取文本
   */
  private async extractTextByMimeType(
    content: Buffer,
    mimeType: string,
  ): Promise<string> {
    switch (mimeType) {
      case "application/pdf":
        return this.extractFromPdf(content);
      case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      case "application/msword":
        return this.extractFromDocx(content);
      case "text/plain":
      case "text/markdown":
        return content.toString("utf-8");
      case "application/vnd.google-apps.document":
        // Google Docs 需要通过 API 导出
        return this.extractFromGoogleDoc(content);
      default:
        throw new Error(`Unsupported MIME type: ${mimeType}`);
    }
  }

  /**
   * 智能分块
   */
  async chunkContent(
    content: ExtractedContent,
    config: ChunkingConfig = DEFAULT_CHUNKING_CONFIG,
  ): Promise<Chunk[]> {
    const text = content.text;
    const chunks: Chunk[] = [];

    if (config.strategy === "semantic") {
      // 语义分块：按段落/章节边界
      chunks.push(...this.semanticChunk(text, config));
    } else if (config.strategy === "fixed") {
      // 固定大小分块
      chunks.push(...this.fixedSizeChunk(text, config));
    } else if (config.strategy === "recursive") {
      // 递归分块
      chunks.push(...this.recursiveChunk(text, config));
    }

    return chunks;
  }

  /**
   * 语义分块实现
   */
  private semanticChunk(text: string, config: ChunkingConfig): Chunk[] {
    const chunks: Chunk[] = [];
    const separators = config.separators || ["\n\n", "\n", ". ", " "];

    // 首先按最大分隔符分割
    let segments = text.split(separators[0]);

    for (const segment of segments) {
      const tokenCount = this.estimateTokens(segment);

      if (tokenCount <= config.chunkSize) {
        // 段落大小合适，直接作为一个 chunk
        chunks.push({
          content: segment.trim(),
          tokenCount,
          metadata: {},
        });
      } else {
        // 段落太大，需要进一步分割
        const subChunks = this.splitBySize(segment, config);
        chunks.push(...subChunks);
      }
    }

    // 添加重叠
    return this.addOverlap(chunks, config.chunkOverlap);
  }

  /**
   * 批量向量化
   */
  async embedChunks(chunks: Chunk[]): Promise<EmbeddedChunk[]> {
    this.logger.log(`Embedding ${chunks.length} chunks`);

    const embeddedChunks: EmbeddedChunk[] = [];
    const batchSize = 100; // OpenAI API 批量限制

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const texts = batch.map((c) => c.content);

      const response = await this.openai.embeddings.create({
        model: "text-embedding-3-small",
        input: texts,
      });

      for (let j = 0; j < batch.length; j++) {
        embeddedChunks.push({
          ...batch[j],
          vector: response.data[j].embedding,
        });
      }
    }

    return embeddedChunks;
  }

  /**
   * 估算 Token 数
   */
  private estimateTokens(text: string): number {
    // 简单估算：中文约 2 字符/token，英文约 4 字符/token
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return Math.ceil(chineseChars / 2 + otherChars / 4);
  }
}

// 默认分块配置
const DEFAULT_CHUNKING_CONFIG: ChunkingConfig = {
  strategy: "semantic",
  chunkSize: 512,
  chunkOverlap: 50,
  separators: ["\n\n", "\n", "。", ". ", " "],
  preserveMetadata: true,
  addPosition: true,
};
```

### 3.3 RAGSearchService

```typescript
// backend/src/modules/knowledge-base/services/rag-search.service.ts

@Injectable()
export class RAGSearchService {
  private readonly openai: OpenAI;
  private readonly logger = new Logger(RAGSearchService.name);

  constructor(private readonly prisma: PrismaService) {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  /**
   * 语义搜索
   */
  async search(
    knowledgeBaseIds: string[],
    query: string,
    options: RAGSearchOptions = {},
  ): Promise<RAGSearchResult> {
    const { topK = 5, threshold = 0.7, maxTokens = 4000 } = options;

    // 1. 向量化查询
    const queryEmbedding = await this.embedQuery(query);

    // 2. 向量搜索
    const results = await this.vectorSearch(
      knowledgeBaseIds,
      queryEmbedding,
      topK * 2, // 获取更多结果用于重排序
      threshold,
    );

    // 3. 重排序和去重
    const rerankedResults = this.rerankAndDedupe(results, topK);

    // 4. 构建搜索结果
    return {
      chunks: rerankedResults,
      query,
      totalFound: results.length,
    };
  }

  /**
   * 向量化查询
   */
  private async embedQuery(query: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: "text-embedding-3-small",
      input: query,
    });
    return response.data[0].embedding;
  }

  /**
   * pgvector 向量搜索
   */
  private async vectorSearch(
    knowledgeBaseIds: string[],
    queryVector: number[],
    limit: number,
    threshold: number,
  ): Promise<SearchResultChunk[]> {
    // 使用原生 SQL 查询 pgvector
    const vectorString = `[${queryVector.join(",")}]`;

    const results = await this.prisma.$queryRaw<SearchResultChunk[]>`
      SELECT
        c.id,
        c.content,
        c.token_count,
        c.position,
        c.page_number,
        c.section_title,
        c.metadata,
        d.id as document_id,
        d.title as document_title,
        d.source_id,
        d.source_type,
        1 - (e.vector <=> ${vectorString}::vector) as similarity
      FROM chunks c
      JOIN embeddings e ON e.chunk_id = c.id
      JOIN knowledge_base_documents d ON d.id = c.document_id
      WHERE d.knowledge_base_id = ANY(${knowledgeBaseIds}::uuid[])
        AND d.index_status = 'INDEXED'
        AND 1 - (e.vector <=> ${vectorString}::vector) >= ${threshold}
      ORDER BY similarity DESC
      LIMIT ${limit}
    `;

    return results;
  }

  /**
   * 重排序和去重
   */
  private rerankAndDedupe(
    results: SearchResultChunk[],
    topK: number,
  ): SearchResultChunk[] {
    // 去重：相同文档中相邻的 chunk 可能内容相似
    const seen = new Set<string>();
    const dedupedResults: SearchResultChunk[] = [];

    for (const result of results) {
      const contentKey = this.getContentKey(result.content);
      if (!seen.has(contentKey)) {
        seen.add(contentKey);
        dedupedResults.push(result);
      }
    }

    // 返回 topK 结果
    return dedupedResults.slice(0, topK);
  }

  /**
   * 构建 RAG 上下文
   */
  async buildContext(
    searchResult: RAGSearchResult,
    maxTokens: number = 4000,
  ): Promise<RAGContext> {
    const chunks = searchResult.chunks;
    const contextParts: string[] = [];
    let totalTokens = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkText = this.formatChunkForContext(chunk, i + 1);
      const chunkTokens = this.estimateTokens(chunkText);

      if (totalTokens + chunkTokens > maxTokens) {
        break;
      }

      contextParts.push(chunkText);
      totalTokens += chunkTokens;
    }

    return {
      contextText: contextParts.join("\n\n"),
      sources: chunks.map((c, i) => ({
        index: i + 1,
        documentId: c.document_id,
        documentTitle: c.document_title,
        pageNumber: c.page_number,
        sectionTitle: c.section_title,
        excerpt: this.truncate(c.content, 200),
        similarity: c.similarity,
      })),
      totalTokens,
    };
  }

  /**
   * 格式化 chunk 为上下文文本
   */
  private formatChunkForContext(
    chunk: SearchResultChunk,
    index: number,
  ): string {
    const location = chunk.page_number
      ? `Page ${chunk.page_number}`
      : chunk.section_title
        ? chunk.section_title
        : `Position ${chunk.position}`;

    return `[${index}] 来源: ${chunk.document_title} (${location})\n${chunk.content}`;
  }
}

// Types
interface RAGSearchOptions {
  topK?: number;
  threshold?: number;
  maxTokens?: number;
  filters?: {
    documentIds?: string[];
    dateRange?: { start: Date; end: Date };
  };
}

interface RAGSearchResult {
  chunks: SearchResultChunk[];
  query: string;
  totalFound: number;
}

interface SearchResultChunk {
  id: string;
  content: string;
  token_count: number;
  position: number;
  page_number?: number;
  section_title?: string;
  metadata?: any;
  document_id: string;
  document_title: string;
  source_id: string;
  source_type: string;
  similarity: number;
}

interface RAGContext {
  contextText: string;
  sources: SourceReference[];
  totalTokens: number;
}
```

### 3.4 AI Ask 集成

```typescript
// backend/src/modules/ai/ai-ask/ai-ask.service.ts (Enhanced)

@Injectable()
export class AiAskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiChatService: AiChatService,
    private readonly ragSearchService: RAGSearchService,
    private readonly citationGenerator: CitationGeneratorService,
  ) {}

  /**
   * 发送消息（带知识库支持）
   */
  async sendMessage(
    sessionId: string,
    content: string,
    options: SendMessageOptions = {},
  ): Promise<AiAskResponse> {
    const session = await this.getSession(sessionId);

    // 检查是否启用知识库
    if (session.useKnowledgeBase && session.knowledgeBaseIds?.length > 0) {
      return this.sendMessageWithRAG(session, content, options);
    }

    // 普通模式
    return this.sendMessageNormal(session, content, options);
  }

  /**
   * 带 RAG 的消息处理
   */
  private async sendMessageWithRAG(
    session: AskSession,
    content: string,
    options: SendMessageOptions,
  ): Promise<AiAskResponse> {
    // 1. 搜索知识库
    const searchResult = await this.ragSearchService.search(
      session.knowledgeBaseIds,
      content,
      { topK: 5, threshold: 0.7 },
    );

    // 2. 构建上下文
    const ragContext = await this.ragSearchService.buildContext(searchResult);

    // 3. 构建增强 Prompt
    const augmentedPrompt = this.buildRAGPrompt(ragContext, content);

    // 4. 调用 LLM
    const response = await this.aiChatService.chat({
      model: options.model || session.modelId || "gpt-4o",
      messages: [
        { role: "system", content: this.getRAGSystemPrompt() },
        ...this.getConversationHistory(session.id),
        { role: "user", content: augmentedPrompt },
      ],
    });

    // 5. 提取引用
    const citations = this.citationGenerator.extractCitations(
      response.content,
      ragContext.sources,
    );

    // 6. 保存消息
    await this.saveMessages(session.id, content, response.content, citations);

    return {
      content: response.content,
      citations,
      sourcesUsed: ragContext.sources.length,
      model: response.model,
    };
  }

  /**
   * 构建 RAG System Prompt
   */
  private getRAGSystemPrompt(): string {
    return `你是 GenesisPod 的 AI 助手。

当用户的问题与提供的参考资料相关时，请基于参考资料回答。
在引用参考资料时，请在相关内容后标注来源编号，例如 [1]、[2]。

如果参考资料中没有相关信息，请明确说明"根据知识库中的资料，未找到直接相关的信息"，
然后尝试基于你的通用知识提供回答。

保持回答简洁、专业、准确。`;
  }

  /**
   * 构建 RAG Prompt
   */
  private buildRAGPrompt(context: RAGContext, userQuery: string): string {
    if (context.sources.length === 0) {
      return userQuery;
    }

    return `参考资料:
${context.contextText}

---

用户问题: ${userQuery}`;
  }
}
```

### 3.5 AI Studio 集成

```typescript
// backend/src/modules/ai/ai-studio/deep-research/iterative-search.service.ts (Enhanced)

@Injectable()
export class IterativeSearchService {
  constructor(
    private readonly webSearchService: WebSearchService,
    private readonly ragSearchService: RAGSearchService,
  ) {}

  /**
   * 执行混合搜索
   */
  async executeHybridSearch(
    step: ResearchPlanStep,
    config: SearchConfig,
  ): Promise<HybridSearchResult> {
    const results: HybridSearchResult = {
      knowledgeBaseResults: [],
      webResults: [],
      academicResults: [],
    };

    // 并行执行多种搜索
    const searchPromises: Promise<void>[] = [];

    // 1. 知识库搜索
    if (config.knowledgeBaseIds?.length > 0) {
      searchPromises.push(
        this.searchKnowledgeBase(step.query, config).then((r) => {
          results.knowledgeBaseResults = r;
        }),
      );
    }

    // 2. 网络搜索
    if (config.enableWebSearch) {
      searchPromises.push(
        this.searchWeb(step.query, step.type).then((r) => {
          results.webResults = r;
        }),
      );
    }

    // 3. 学术搜索
    if (config.enableAcademicSearch && step.type === "academic") {
      searchPromises.push(
        this.searchAcademic(step.query).then((r) => {
          results.academicResults = r;
        }),
      );
    }

    await Promise.all(searchPromises);

    // 4. 根据优先级排序结果
    return this.prioritizeResults(results, config.searchPriority);
  }

  /**
   * 知识库搜索
   */
  private async searchKnowledgeBase(
    query: string,
    config: SearchConfig,
  ): Promise<KBSearchResult[]> {
    const searchResult = await this.ragSearchService.search(
      config.knowledgeBaseIds,
      query,
      { topK: 10, threshold: 0.6 },
    );

    return searchResult.chunks.map((chunk) => ({
      type: "KNOWLEDGE_BASE" as const,
      title: chunk.document_title,
      content: chunk.content,
      source: {
        documentId: chunk.document_id,
        pageNumber: chunk.page_number,
        sectionTitle: chunk.section_title,
      },
      relevanceScore: chunk.similarity,
    }));
  }

  /**
   * 结果优先级排序
   */
  private prioritizeResults(
    results: HybridSearchResult,
    priority: SearchPriority,
  ): HybridSearchResult {
    switch (priority) {
      case "KNOWLEDGE_BASE_FIRST":
        // 知识库结果优先，相关度高于阈值的优先展示
        return {
          ...results,
          combinedResults: [
            ...results.knowledgeBaseResults,
            ...results.webResults,
            ...results.academicResults,
          ],
        };

      case "WEB_FIRST":
        // 网络结果优先
        return {
          ...results,
          combinedResults: [
            ...results.webResults,
            ...results.knowledgeBaseResults,
            ...results.academicResults,
          ],
        };

      case "BALANCED":
      default:
        // 混合排序：按相关度评分
        const all = [
          ...results.knowledgeBaseResults,
          ...results.webResults,
          ...results.academicResults,
        ];
        all.sort((a, b) => b.relevanceScore - a.relevanceScore);
        return { ...results, combinedResults: all };
    }
  }
}
```

---

## 4. Database Design

### 4.1 ERD

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                 Entity Relationship Diagram                          │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────┐       ┌─────────────────────────┐       ┌─────────────────────────┐
│      User       │       │    KnowledgeBase        │       │  KnowledgeBaseDocument  │
├─────────────────┤       ├─────────────────────────┤       ├─────────────────────────┤
│ id (PK)         │───┐   │ id (PK)                 │───┐   │ id (PK)                 │
│ email           │   │   │ user_id (FK)            │   │   │ knowledge_base_id (FK)  │
│ name            │   │   │ name                    │   │   │ source_type             │
│ ...             │   │   │ description             │   │   │ source_id               │
└─────────────────┘   │   │ status                  │   │   │ title                   │
                      │   │ document_count          │   │   │ mime_type               │
                      │   │ chunk_count             │   │   │ file_size               │
                      │   │ total_tokens            │   │   │ index_status            │
                      │   │ created_at              │   │   │ index_error             │
                      │   │ updated_at              │   │   │ chunk_count             │
                      │   │ last_sync_at            │   │   │ token_count             │
                      │   └─────────────────────────┘   │   │ source_modified_at      │
                      │            │                     │   │ last_indexed_at         │
                      │            │ 1:N                 │   │ content_hash            │
                      └────────────┘                     │   │ created_at              │
                                                         │   │ updated_at              │
                                                         │   └─────────────────────────┘
                                                         │            │
                                                         │            │ 1:N
                                                         └────────────┘
                                                                      │
                                                                      ▼
┌─────────────────────────┐       ┌─────────────────────────┐
│        Chunk            │       │       Embedding         │
├─────────────────────────┤       ├─────────────────────────┤
│ id (PK)                 │───────│ id (PK)                 │
│ document_id (FK)        │  1:1  │ chunk_id (FK, UNIQUE)   │
│ content                 │       │ vector (vector(1536))   │
│ token_count             │       │ model                   │
│ position                │       │ created_at              │
│ page_number             │       └─────────────────────────┘
│ section_title           │
│ metadata                │
│ created_at              │
└─────────────────────────┘


┌─────────────────────────┐       ┌─────────────────────────┐
│      AskSession         │       │    ResearchProject      │
├─────────────────────────┤       ├─────────────────────────┤
│ id (PK)                 │       │ id (PK)                 │
│ user_id (FK)            │       │ user_id (FK)            │
│ title                   │       │ name                    │
│ model_id                │       │ description             │
│ knowledge_base_ids []   │       │ knowledge_base_ids []   │
│ use_knowledge_base      │       │ search_priority         │
│ created_at              │       │ created_at              │
│ updated_at              │       │ updated_at              │
└─────────────────────────┘       └─────────────────────────┘
```

### 4.2 索引设计

```sql
-- pgvector 扩展
CREATE EXTENSION IF NOT EXISTS vector;

-- 向量索引 (IVFFlat for approximate nearest neighbor search)
CREATE INDEX embeddings_vector_idx ON embeddings
USING ivfflat (vector vector_cosine_ops)
WITH (lists = 100);

-- 文档索引
CREATE INDEX kb_documents_kb_id_idx ON knowledge_base_documents(knowledge_base_id);
CREATE INDEX kb_documents_status_idx ON knowledge_base_documents(index_status);

-- Chunk 索引
CREATE INDEX chunks_document_id_idx ON chunks(document_id);

-- 知识库用户索引
CREATE INDEX knowledge_bases_user_id_idx ON knowledge_bases(user_id);
```

---

## 5. API Specification

### 5.1 Knowledge Base APIs

#### 创建知识库

```http
POST /api/v1/knowledge-bases
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "新能源行业研究",
  "description": "2023-2025 新能源行业报告和分析",
  "documents": [
    {
      "sourceType": "GOOGLE_DRIVE",
      "sourceId": "1abc2def3ghi...",
      "title": "2024新能源行业报告.pdf",
      "mimeType": "application/pdf"
    }
  ]
}
```

**Response:**

```json
{
  "id": "kb-uuid",
  "name": "新能源行业研究",
  "description": "2023-2025 新能源行业报告和分析",
  "status": "INDEXING",
  "documentCount": 0,
  "chunkCount": 0,
  "totalTokens": 0,
  "createdAt": "2025-12-26T10:00:00Z"
}
```

#### 搜索知识库

```http
POST /api/v1/knowledge-bases/:id/search
Authorization: Bearer <token>
Content-Type: application/json

{
  "query": "2024年光伏行业发展趋势",
  "topK": 5,
  "threshold": 0.7
}
```

**Response:**

```json
{
  "chunks": [
    {
      "id": "chunk-uuid",
      "content": "N型电池技术在2024年实现了重大突破...",
      "documentTitle": "2024新能源行业报告.pdf",
      "pageNumber": 23,
      "sectionTitle": "技术发展趋势",
      "similarity": 0.89
    }
  ],
  "totalFound": 15,
  "searchTime": 120
}
```

### 5.2 AI Ask 知识库设置

```http
PUT /api/v1/ask/sessions/:id/knowledge-bases
Authorization: Bearer <token>
Content-Type: application/json

{
  "knowledgeBaseIds": ["kb-uuid-1", "kb-uuid-2"],
  "useKnowledgeBase": true
}
```

---

## 6. Performance Optimization

### 6.1 向量搜索优化

| Optimization     | Description                          | Impact              |
| ---------------- | ------------------------------------ | ------------------- |
| **IVFFlat 索引** | 近似最近邻搜索，牺牲少量精度换取速度 | 搜索速度提升 10-50x |
| **分区策略**     | 按知识库 ID 分区，减少搜索范围       | 搜索速度提升 2-5x   |
| **连接池**       | 复用数据库连接                       | 减少连接开销 30%    |
| **查询缓存**     | 缓存热门查询的 embedding             | 减少 API 调用 50%   |

### 6.2 文档处理优化

| Optimization       | Description                         | Impact            |
| ------------------ | ----------------------------------- | ----------------- |
| **并行处理**       | 多文档并行提取和向量化              | 处理速度提升 3-5x |
| **批量 Embedding** | 批量调用 OpenAI API（最多 100 条）  | API 调用减少 99%  |
| **增量更新**       | 只处理变更的 chunks，不重建整个文档 | 更新时间减少 80%  |
| **队列处理**       | 使用 Bull 队列异步处理              | 不阻塞用户请求    |

### 6.3 缓存策略

```typescript
// 缓存配置
const CACHE_CONFIG = {
  // 查询 embedding 缓存
  queryEmbedding: {
    ttl: 3600, // 1 hour
    maxSize: 10000,
  },

  // 搜索结果缓存
  searchResult: {
    ttl: 300, // 5 minutes
    maxSize: 1000,
  },

  // 知识库元数据缓存
  knowledgeBaseMeta: {
    ttl: 60, // 1 minute
    maxSize: 100,
  },
};
```

---

## 7. Error Handling

### 7.1 错误分类

| Error Type              | HTTP Status | Retry | User Message                 |
| ----------------------- | ----------- | ----- | ---------------------------- |
| `KB_NOT_FOUND`          | 404         | No    | 知识库不存在或已删除         |
| `DOC_EXTRACTION_FAILED` | 500         | Yes   | 文档内容提取失败，请稍后重试 |
| `EMBEDDING_FAILED`      | 500         | Yes   | 向量化处理失败，请稍后重试   |
| `SEARCH_FAILED`         | 500         | Yes   | 搜索失败，请稍后重试         |
| `QUOTA_EXCEEDED`        | 429         | Yes   | API 配额超限，请稍后重试     |
| `UNSUPPORTED_FORMAT`    | 400         | No    | 不支持的文件格式             |

### 7.2 重试策略

```typescript
const RETRY_CONFIG = {
  maxAttempts: 3,
  initialDelay: 1000, // 1 second
  maxDelay: 30000, // 30 seconds
  backoffMultiplier: 2,

  // 可重试的错误
  retryableErrors: [
    "EMBEDDING_FAILED",
    "SEARCH_FAILED",
    "QUOTA_EXCEEDED",
    "NETWORK_ERROR",
  ],
};
```

---

## 8. Monitoring & Observability

### 8.1 关键指标

| Metric                      | Description    | Alert Threshold |
| --------------------------- | -------------- | --------------- |
| `kb.indexing.duration`      | 文档索引耗时   | > 60s           |
| `kb.search.latency`         | 搜索响应时间   | > 500ms         |
| `kb.embedding.error_rate`   | 向量化错误率   | > 5%            |
| `kb.search.relevance_score` | 平均相关度分数 | < 0.6           |
| `kb.storage.usage`          | 向量存储使用量 | > 80%           |

### 8.2 日志格式

```typescript
// 结构化日志
this.logger.log({
  event: "kb.document.indexed",
  knowledgeBaseId: "kb-uuid",
  documentId: "doc-uuid",
  chunkCount: 128,
  tokenCount: 25600,
  duration: 15230,
  success: true,
});
```

---

## 9. Security Considerations

### 9.1 数据隔离

```typescript
// 所有查询都必须验证用户所有权
async search(userId: string, kbId: string, query: string) {
  // 验证知识库所有权
  const kb = await this.prisma.knowledgeBase.findFirst({
    where: {
      id: kbId,
      userId: userId,  // 强制用户级别隔离
    },
  });

  if (!kb) {
    throw new ForbiddenException('Knowledge base not found or access denied');
  }

  // 执行搜索...
}
```

### 9.2 敏感数据处理

| Data Type          | Storage    | Encryption | Access Control |
| ------------------ | ---------- | ---------- | -------------- |
| 文档内容           | PostgreSQL | At rest    | User-level     |
| 向量数据           | PostgreSQL | At rest    | User-level     |
| Google Drive Token | PostgreSQL | AES-256    | User-level     |

---

## 10. Deployment Plan

### 10.1 数据库迁移

```sql
-- Migration: add_knowledge_base_tables

-- 1. 启用 pgvector 扩展
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. 创建知识库表
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

-- 3. 创建文档表
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
  chunk_count INT DEFAULT 0,
  token_count INT DEFAULT 0,
  source_modified_at TIMESTAMP,
  last_indexed_at TIMESTAMP,
  content_hash VARCHAR(64),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(knowledge_base_id, source_id)
);

-- 4. 创建 chunks 表
CREATE TABLE chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES knowledge_base_documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  token_count INT NOT NULL,
  position INT NOT NULL,
  page_number INT,
  section_title VARCHAR(255),
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 5. 创建 embeddings 表
CREATE TABLE embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_id UUID NOT NULL UNIQUE REFERENCES chunks(id) ON DELETE CASCADE,
  vector vector(1536) NOT NULL,
  model VARCHAR(50) NOT NULL DEFAULT 'text-embedding-3-small',
  created_at TIMESTAMP DEFAULT NOW()
);

-- 6. 创建索引
CREATE INDEX knowledge_bases_user_id_idx ON knowledge_bases(user_id);
CREATE INDEX kb_documents_kb_id_idx ON knowledge_base_documents(knowledge_base_id);
CREATE INDEX kb_documents_status_idx ON knowledge_base_documents(index_status);
CREATE INDEX chunks_document_id_idx ON chunks(document_id);
CREATE INDEX embeddings_vector_idx ON embeddings USING ivfflat (vector vector_cosine_ops) WITH (lists = 100);

-- 7. 扩展 ask_sessions 表
ALTER TABLE ask_sessions ADD COLUMN knowledge_base_ids UUID[] DEFAULT '{}';
ALTER TABLE ask_sessions ADD COLUMN use_knowledge_base BOOLEAN DEFAULT FALSE;

-- 8. 扩展 research_projects 表
ALTER TABLE research_projects ADD COLUMN knowledge_base_ids UUID[] DEFAULT '{}';
ALTER TABLE research_projects ADD COLUMN search_priority VARCHAR(50) DEFAULT 'BALANCED';
```

### 10.2 部署顺序

1. **数据库迁移** - 执行上述 SQL 迁移
2. **后端部署** - 部署新的 Knowledge Base 模块
3. **前端部署** - 部署知识库管理 UI
4. **功能验证** - 端到端测试
5. **监控配置** - 配置告警和仪表板

---

## 11. References

- [PRD: Google Drive RAG Knowledge Base](../prd/google-drive-rag-knowledge-base-v1.0.md)
- [pgvector Documentation](https://github.com/pgvector/pgvector)
- [OpenAI Embeddings Guide](https://platform.openai.com/docs/guides/embeddings)
- [RAG Best Practices](https://docs.anthropic.com/claude/docs/retrieval-augmented-generation)
- [LangChain Text Splitters](https://python.langchain.com/docs/modules/data_connection/document_transformers/)

---

## Change Log

| Version | Date       | Changes              | Author          |
| ------- | ---------- | -------------------- | --------------- |
| 1.0     | 2025-12-26 | Initial Architecture | Architect Agent |
