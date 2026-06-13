# AI Office 多文件智能分析系统设计方案

> **文档类型**: 系统架构设计
> **创建日期**: 2025-11-23
> **版本**: v1.0
> **作者**: Senior Product Manager & Senior Architect
> **状态**: RFC (Request for Comments)

---

## 目录

- [1. 执行摘要](#1-执行摘要)
- [2. 产品需求分析](#2-产品需求分析)
- [3. Gemini File Search 能力分析](#3-gemini-file-search-能力分析)
- [4. 系统架构设计](#4-系统架构设计)
- [5. 核心功能设计](#5-核心功能设计)
- [6. 技术实现方案](#6-技术实现方案)
- [7. 数据流设计](#7-数据流设计)
- [8. API 接口设计](#8-api-接口设计)
- [9. 实施路线图](#9-实施路线图)
- [10. 风险与挑战](#10-风险与挑战)

---

## 1. 执行摘要

### 1.1 项目背景

GenesisPod 系统当前拥有完善的资源收藏功能，用户可以保存 Paper、Blog、YouTube 视频等多种类型内容。然而，这些收藏的内容目前仅能单独查看，缺乏跨文件的智能分析能力。

### 1.2 核心价值主张

**利用 Google Gemini File Search 的内置 RAG 能力**，为用户提供：

1. **跨文件知识提取** - 从多个收藏的 PDF、文档中提取和综合知识
2. **智能问答** - 基于整个知识库回答问题，自动引用来源
3. **主题发现** - 自动发现收藏内容中的关联主题和趋势
4. **对比分析** - 对比不同文档的观点和数据
5. **知识图谱** - 构建个人知识图谱

### 1.3 技术亮点

- ✅ **零运维 RAG** - Gemini File Search 全托管向量数据库和检索
- ✅ **亚秒级响应** - 跨 3000+ 文件查询 < 2 秒
- ✅ **自动引用** - 内置 grounding metadata 和 citations
- ✅ **成本优化** - 存储免费，仅索引时收费 $0.15/M tokens
- ✅ **无缝集成** - 与现有 AI Office 完美融合

---

## 2. 产品需求分析

### 2.1 用户画像

#### 主要用户群

1. **研究人员** - 需要综合分析多篇论文
2. **知识工作者** - 整理和提取跨领域知识
3. **内容创作者** - 需要从收藏内容中提取素材
4. **学习者** - 构建个人知识体系

#### 用户痛点

| 痛点         | 当前状况                 | 期望状态        |
| ------------ | ------------------------ | --------------- |
| **信息孤岛** | 每篇文档独立查看         | 跨文档关联分析  |
| **知识遗忘** | 收藏后很少回看           | 主动知识提醒    |
| **查找困难** | 记不清哪篇文档有什么内容 | 智能语义搜索    |
| **综合分析** | 人工对比多篇文档很费时   | AI 自动综合对比 |

### 2.2 核心用户场景

#### Scenario 1: 文献综述撰写

```
用户：研究生
目标：撰写机器学习综述论文
收藏：50+ 篇 ML 相关论文 PDF

工作流：
1. 在 AI Office 中选择"文献综述"模式
2. 选择相关的 50 篇论文
3. 提问："总结近 5 年 Transformer 架构的主要创新"
4. 系统自动：
   - 检索所有相关段落
   - 按时间线组织
   - 生成综述草稿
   - 附带精确引用（论文名 + 页码）
```

#### Scenario 2: 技术决策支持

```
用户：技术 Leader
目标：选择前端框架
收藏：React/Vue/Angular 技术博客 30+

工作流：
1. 提问："对比 React、Vue、Angular 的性能和生态"
2. 系统分析所有相关博客
3. 生成对比表格
4. 给出基于团队情况的建议
5. 每个结论都有明确出处
```

#### Scenario 3: 个人知识管理

```
用户：终身学习者
目标：整理过去一年的学习内容
收藏：200+ 篇文章、视频笔记

工作流：
1. 启动"知识图谱"功能
2. 系统自动提取主题和关系
3. 可视化知识网络
4. 发现知识盲点
5. 推荐相关阅读
```

### 2.3 功能优先级 (MoSCoW)

#### Must Have (P0)

- ✅ 基础多文件问答（基于 Collection）
- ✅ 自动引用和来源标注
- ✅ 支持 PDF、DOCX、TXT、Markdown
- ✅ 与 AI Office 聊天界面集成

#### Should Have (P1)

- 📌 Collection 级别的 File Search Store 管理
- 📌 语义搜索结果高亮
- 📌 对比分析模式
- 📌 导出分析报告

#### Could Have (P2)

- 🔮 知识图谱可视化
- 🔮 主题自动聚类
- 🔮 智能摘要生成
- 🔮 跨语言分析

#### Won't Have (本期)

- ❌ 实时协作编辑
- ❌ 视频内容分析（需额外转录）
- ❌ 图像内容识别

---

## 3. Gemini File Search 能力分析

### 3.1 核心技术能力

基于最新研究（2025年11月发布），Gemini File Search 提供：

#### 全托管 RAG 管道

```
用户文件上传 → 自动分块 → 向量化 → 存储 → 语义检索 → 生成回答
    ↑             ↑          ↑       ↑        ↑          ↑
   API         Gemini     Vector    GCS    Gemini    With Citations
```

#### 性能指标

| 指标         | 数值           | 来源                   |
| ------------ | -------------- | ---------------------- |
| **查询延迟** | < 2 秒         | 跨所有语料库并行查询   |
| **文件规模** | 3,000+ 文件    | Phaser Studio 实际案例 |
| **存储限制** | 1 TB           | Tier 3 项目            |
| **索引成本** | $0.15/M tokens | 仅一次性索引           |
| **存储成本** | $0             | 完全免费               |
| **查询成本** | $0             | 向量嵌入免费           |

#### 支持的文件格式

- 📄 **文档**: PDF, DOCX, TXT, RTF
- 📊 **数据**: JSON, CSV, TSV
- 💻 **代码**: Python, Java, C++, JavaScript, Go, etc.
- 📝 **标记**: Markdown, HTML, XML

### 3.2 关键优势

#### vs 自建 RAG 系统

| 维度           | 自建 RAG                   | Gemini File Search | 优势                 |
| -------------- | -------------------------- | ------------------ | -------------------- |
| **开发成本**   | 需要实现分块、嵌入、向量DB | 开箱即用           | ✅ 节省 80% 开发时间 |
| **运维成本**   | 需要维护向量数据库集群     | 全托管             | ✅ 零运维            |
| **性能优化**   | 需要手动调优               | 自动优化           | ✅ Google 级别优化   |
| **扩展性**     | 需要规划扩容               | 自动扩展           | ✅ 无上限            |
| **引用准确性** | 需要自己实现追踪           | 内置 grounding     | ✅ 原生支持          |

#### 实际案例分析

**Phaser Studio** 使用场景：

- 管理 3,000+ 文件（模板、组件、文档）
- 处理数千次查询
- 并行搜索所有语料库
- 2 秒内合并结果
- **效率提升**: 从数小时人工交叉引用 → 2 秒自动化

---

## 4. 系统架构设计

### 4.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend Layer                          │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  AI Office   │  │   Library    │  │  Collection  │          │
│  │  Chat UI     │  │   Page       │  │  Manager     │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                  │                  │                  │
│         └──────────────────┼──────────────────┘                  │
│                            │                                     │
└────────────────────────────┼─────────────────────────────────────┘
                             │
┌────────────────────────────┼─────────────────────────────────────┐
│                       Backend Layer                              │
├────────────────────────────┼─────────────────────────────────────┤
│                            ↓                                     │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │           Multi-File Analysis Service                   │    │
│  ├─────────────────────────────────────────────────────────┤    │
│  │  • Collection → File Store Mapper                       │    │
│  │  • File Upload & Index Manager                          │    │
│  │  • Query Router & Context Builder                       │    │
│  │  • Citation Parser & Formatter                          │    │
│  └────────┬──────────────────────────────┬─────────────────┘    │
│           │                              │                       │
│           ↓                              ↓                       │
│  ┌────────────────┐            ┌────────────────────┐           │
│  │  Collections   │            │   Resources DB     │           │
│  │  Service       │            │  (Existing)        │           │
│  └────────┬───────┘            └────────┬───────────┘           │
│           │                              │                       │
└───────────┼──────────────────────────────┼───────────────────────┘
            │                              │
┌───────────┼──────────────────────────────┼───────────────────────┐
│      External Services Layer             │                       │
├───────────┼──────────────────────────────┼───────────────────────┤
│           ↓                              ↓                       │
│  ┌────────────────────────────────────────────────────────┐     │
│  │           Google Gemini API                             │     │
│  ├────────────────────────────────────────────────────────┤     │
│  │  ┌──────────────────┐  ┌──────────────────────────┐   │     │
│  │  │  File Search     │  │  Gemini Pro/Flash        │   │     │
│  │  │  Store API       │  │  Generation API          │   │     │
│  │  ├──────────────────┤  └──────────────────────────┘   │     │
│  │  │ • File Upload    │                                  │     │
│  │  │ • Indexing       │                                  │     │
│  │  │ • Vector Search  │                                  │     │
│  │  │ • Citation Gen   │                                  │     │
│  │  └──────────────────┘                                  │     │
│  └────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────┘
```

### 4.2 核心组件设计

#### 4.2.1 Collection → File Store Mapper

**职责**:

- 维护 Collection 到 Gemini File Search Store 的映射关系
- 自动同步 Collection 变更到 File Store
- 管理文件的增删改查

**数据模型**:

```typescript
interface FileSearchStore {
  id: string;
  collectionId: string;
  geminiStoreId: string; // Gemini API 返回的 Store ID
  name: string;
  fileCount: number;
  indexedAt: Date;
  status: "indexing" | "ready" | "error";
  metadata: {
    totalTokens: number;
    indexingCost: number;
  };
}

interface IndexedFile {
  id: string;
  storeId: string;
  resourceId: string;
  geminiFileId: string; // Gemini API 返回的 File ID
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadedAt: Date;
  indexedAt: Date;
  status: "uploading" | "indexed" | "error";
  chunks: number;
  tokens: number;
}
```

#### 4.2.2 File Upload & Index Manager

**核心流程**:

```typescript
class FileIndexManager {
  /**
   * 将 Collection 中的资源索引到 Gemini File Search
   */
  async indexCollection(collectionId: string): Promise<FileSearchStore> {
    // 1. 获取 Collection 中所有支持的资源
    const resources = await this.getIndexableResources(collectionId);

    // 2. 创建或获取 Gemini File Search Store
    const store = await this.getOrCreateStore(collectionId);

    // 3. 批量上传文件
    const uploadPromises = resources.map(async (resource) => {
      // 下载资源文件（PDF, DOCX等）
      const fileContent = await this.downloadResource(resource);

      // 上传到 Gemini
      const geminiFile = await geminiApi.uploadFile({
        file: fileContent,
        mimeType: resource.mimeType,
      });

      // 添加到 Store
      await geminiApi.addFileToStore(store.geminiStoreId, geminiFile.id);

      // 保存映射关系
      return this.saveIndexedFile({
        storeId: store.id,
        resourceId: resource.id,
        geminiFileId: geminiFile.id,
        ...metadata,
      });
    });

    await Promise.all(uploadPromises);

    // 4. 更新 Store 状态
    await this.updateStoreStatus(store.id, "ready");

    return store;
  }

  /**
   * 增量更新：只索引新增的资源
   */
  async syncCollection(collectionId: string): Promise<void> {
    const store = await this.getStore(collectionId);
    const newResources = await this.getNewResources(
      collectionId,
      store.indexedAt,
    );

    for (const resource of newResources) {
      await this.indexResource(store, resource);
    }
  }

  /**
   * 从索引中移除文件
   */
  async removeFromIndex(resourceId: string): Promise<void> {
    const indexedFile = await this.getIndexedFile(resourceId);
    await geminiApi.removeFileFromStore(
      indexedFile.storeId,
      indexedFile.geminiFileId,
    );
    await this.deleteIndexedFile(indexedFile.id);
  }
}
```

#### 4.2.3 Query Router & Context Builder

**智能路由策略**:

```typescript
interface QueryContext {
  collectionIds?: string[]; // 指定搜索的 Collection
  resourceTypes?: ResourceType[]; // 限制资源类型
  dateRange?: { from: Date; to: Date }; // 时间范围过滤
  includeNotes?: boolean; // 是否包含用户笔记
  maxResults?: number; // 最大结果数
}

class QueryRouter {
  async search(query: string, context: QueryContext): Promise<SearchResult> {
    // 1. 确定搜索范围
    const stores = await this.resolveStores(context);

    // 2. 构建 Gemini 查询
    const geminiQuery = {
      query,
      fileSearchStores: stores.map((s) => s.geminiStoreId),
      maxResults: context.maxResults || 10,
    };

    // 3. 执行搜索
    const response = await geminiApi.searchWithFileSearch({
      model: "gemini-2.0-flash",
      tools: [
        {
          fileSearch: {
            stores: geminiQuery.fileSearchStores,
          },
        },
      ],
      contents: [
        {
          role: "user",
          parts: [{ text: query }],
        },
      ],
    });

    // 4. 解析结果和引用
    return this.parseResponse(response);
  }
}
```

#### 4.2.4 Citation Parser & Formatter

**引用格式化**:

```typescript
interface Citation {
  resourceId: string;
  resourceTitle: string;
  pageNumber?: number;
  chunkIndex: number;
  excerpt: string;
  confidence: number;
}

class CitationFormatter {
  /**
   * 将 Gemini 的 grounding metadata 转换为用户友好的引用
   */
  formatCitations(groundingMetadata: any): Citation[] {
    return groundingMetadata.groundingChunks.map((chunk) => ({
      resourceId: this.resolveResourceId(chunk.fileId),
      resourceTitle: chunk.fileName,
      pageNumber: chunk.pageNumber,
      excerpt: chunk.text.substring(0, 200),
      confidence: chunk.score,
    }));
  }

  /**
   * 生成 Markdown 格式的引用
   */
  toMarkdown(citations: Citation[]): string {
    return citations
      .map(
        (c, i) =>
          `[${i + 1}] **${c.resourceTitle}** ${c.pageNumber ? `(p. ${c.pageNumber})` : ""}\n` +
          `   > ${c.excerpt}...`,
      )
      .join("\n\n");
  }
}
```

---

## 5. 核心功能设计

### 5.1 Feature 1: Collection 智能问答

#### 用户界面

```
┌─────────────────────────────────────────────────────────┐
│  AI Office - Multi-File Analysis                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  📚 Selected Collection: "Machine Learning Papers"     │
│      └─ 47 files indexed | Last updated: 2h ago       │
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │ 💬 Ask anything about your collection...         │ │
│  │                                                   │ │
│  │ [Your question here]                             │ │
│  │                                                   │ │
│  │                                    [🔍 Analyze]  │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                         │
│  🤖 AI Assistant:                                       │
│                                                         │
│  Based on your collection, here are the main          │
│  innovations in Transformer architectures:             │
│                                                         │
│  1. **Attention is All You Need (2017)** [1]          │
│     - Introduced multi-head self-attention            │
│     - Removed recurrence entirely                     │
│                                                         │
│  2. **BERT (2018)** [2]                               │
│     - Bidirectional training                          │
│     - Masked language modeling                        │
│                                                         │
│  3. **GPT-3 (2020)** [3]                              │
│     - Scale to 175B parameters                        │
│     - Few-shot learning                               │
│                                                         │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                         │
│  📖 References:                                         │
│                                                         │
│  [1] "Attention is All You Need" (p. 3)               │
│      > "We propose a new simple network architecture  │
│        based solely on attention mechanisms..."        │
│      [View in document]                                │
│                                                         │
│  [2] "BERT: Pre-training of Deep Bidirectional..."    │
│      > "Unlike recent language representation models  │
│        (Peters et al., 2018a; Radford et al...."      │
│      [View in document]                                │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

#### 技术实现

```typescript
// AI Office 聊天组件集成
const MultiFileChat: React.FC = () => {
  const [selectedCollection, setSelectedCollection] = useState<Collection>();
  const [messages, setMessages] = useState<Message[]>([]);

  const handleAsk = async (question: string) => {
    // 1. 发送到后端 Multi-File Analysis API
    const response = await fetch('/api/v1/ai-office/multi-file-search', {
      method: 'POST',
      body: JSON.stringify({
        collectionId: selectedCollection.id,
        query: question,
        context: {
          includeNotes: true,
          maxResults: 5,
        }
      })
    });

    const data = await response.json();

    // 2. 渲染回答和引用
    setMessages([...messages, {
      role: 'assistant',
      content: data.answer,
      citations: data.citations,
      metadata: data.groundingMetadata,
    }]);
  };

  return (
    <div>
      <CollectionSelector onChange={setSelectedCollection} />
      <ChatInterface messages={messages} onSendMessage={handleAsk} />
      <CitationPanel citations={messages[messages.length - 1]?.citations} />
    </div>
  );
};
```

### 5.2 Feature 2: 对比分析模式

#### 产品设计

```
┌─────────────────────────────────────────────────────────┐
│  📊 Compare Documents                                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Select documents to compare:                          │
│                                                         │
│  ☑ React Best Practices Guide.pdf                     │
│  ☑ Vue.js Style Guide.pdf                             │
│  ☑ Angular Coding Standards.docx                      │
│                                                         │
│  Comparison Criteria:                                  │
│  ○ Performance      ○ Learning Curve                  │
│  ○ Ecosystem        ○ Community Support               │
│  ● Custom: "state management approaches"              │
│                                                         │
│                                    [Generate Report]   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

#### 后端实现

```typescript
class ComparisonAnalyzer {
  async compareDocuments(
    resourceIds: string[],
    criteria: string,
  ): Promise<ComparisonReport> {
    // 1. 为每个文档创建临时 Store（或使用已有）
    const stores = await Promise.all(
      resourceIds.map((id) => this.getOrCreateStoreForResource(id)),
    );

    // 2. 生成对比提示词
    const prompt = this.buildComparisonPrompt(criteria, resourceIds);

    // 3. 并行查询每个 Store
    const responses = await Promise.all(
      stores.map((store) =>
        geminiApi.search({
          query: prompt,
          fileSearchStores: [store.geminiStoreId],
        }),
      ),
    );

    // 4. 合并结果，生成对比表格
    return this.synthesizeComparison(responses, criteria);
  }

  private buildComparisonPrompt(criteria: string, docs: string[]): string {
    return `
      Compare and contrast the following aspects across the provided documents:

      Criteria: ${criteria}

      For each document, extract:
      1. Main approach or methodology
      2. Advantages mentioned
      3. Limitations or challenges
      4. Code examples (if any)

      Present the comparison in a structured table format.
      Include specific quotes and page numbers for each point.
    `;
  }
}
```

### 5.3 Feature 3: 自动主题发现

#### 算法设计

```typescript
class TopicDiscovery {
  async discoverTopics(collectionId: string): Promise<TopicCluster[]> {
    const store = await this.getStore(collectionId);

    // 1. 提取每个文档的主要主题
    const topics = await this.extractDocumentTopics(store);

    // 2. 使用聚类算法分组
    const clusters = this.clusterTopics(topics);

    // 3. 为每个聚类生成摘要
    const clustersWithSummaries = await Promise.all(
      clusters.map(async (cluster) => ({
        ...cluster,
        summary: await this.generateClusterSummary(cluster),
        keyDocuments: await this.findRepresentativeDocuments(cluster),
      })),
    );

    return clustersWithSummaries;
  }

  private async extractDocumentTopics(store: FileSearchStore) {
    // 使用 Gemini 提取主题
    const prompt = `
      Analyze the uploaded documents and extract:
      1. Main topics/themes (3-5 per document)
      2. Key concepts mentioned
      3. Keywords (10-15 per document)

      Return in JSON format.
    `;

    const response = await geminiApi.search({
      query: prompt,
      fileSearchStores: [store.geminiStoreId],
    });

    return JSON.parse(response.text);
  }
}
```

---

## 6. 技术实现方案

### 6.1 后端实现

#### 6.1.1 NestJS Module 结构

```
backend/src/modules/multi-file-analysis/
├── multi-file-analysis.module.ts
├── controllers/
│   ├── file-search.controller.ts
│   └── comparison.controller.ts
├── services/
│   ├── gemini-file-search.service.ts
│   ├── file-index.service.ts
│   ├── query-router.service.ts
│   ├── citation-formatting.utils.service.ts
│   └── comparison-analyzer.service.ts
├── entities/
│   ├── file-search-store.entity.ts
│   └── indexed-file.entity.ts
├── dto/
│   ├── create-file-store.dto.ts
│   ├── search-query.dto.ts
│   └── comparison-request.dto.ts
└── types/
    └── gemini-api.types.ts
```

#### 6.1.2 核心 Service 实现

**GeminiFileSearchService**:

```typescript
import { Injectable } from "@nestjs/common";
import { GoogleGenerativeAI, FileState } from "@google/generative-ai";

@Injectable()
export class GeminiFileSearchService {
  private genAI: GoogleGenerativeAI;

  constructor(
    @InjectRepository(FileSearchStore)
    private storeRepo: Repository<FileSearchStore>,
    private configService: ConfigService,
  ) {
    this.genAI = new GoogleGenerativeAI(configService.get("GEMINI_API_KEY"));
  }

  /**
   * 创建 File Search Store
   */
  async createStore(name: string): Promise<string> {
    const fileManager = this.genAI.fileManager;

    const store = await fileManager.createFileSearchStore({
      displayName: name,
    });

    return store.name; // 返回 Store ID
  }

  /**
   * 上传文件到 Gemini
   */
  async uploadFile(
    filePath: string,
    mimeType: string,
    displayName: string,
  ): Promise<string> {
    const fileManager = this.genAI.fileManager;

    const uploadResult = await fileManager.uploadFile(filePath, {
      mimeType,
      displayName,
    });

    // 等待文件处理完成
    let file = await fileManager.getFile(uploadResult.file.name);
    while (file.state === FileState.PROCESSING) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      file = await fileManager.getFile(uploadResult.file.name);
    }

    if (file.state === FileState.FAILED) {
      throw new Error(`File processing failed: ${file.error}`);
    }

    return file.name; // 返回 File ID
  }

  /**
   * 将文件添加到 Store
   */
  async addFileToStore(storeId: string, fileId: string): Promise<void> {
    const fileManager = this.genAI.fileManager;

    await fileManager.addFileToStore(storeId, {
      file: fileId,
    });
  }

  /**
   * 使用 File Search 进行查询
   */
  async searchWithFileSearch(storeIds: string[], query: string): Promise<any> {
    const model = this.genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      tools: [
        {
          fileSearch: {
            stores: storeIds.map((id) => ({ id })),
          },
        },
      ],
    });

    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [{ text: query }],
        },
      ],
    });

    const response = result.response;

    return {
      text: response.text(),
      citations:
        response.candidates[0]?.groundingMetadata?.groundingChunks || [],
      usage: response.usageMetadata,
    };
  }

  /**
   * 删除 Store
   */
  async deleteStore(storeId: string): Promise<void> {
    const fileManager = this.genAI.fileManager;
    await fileManager.deleteFileSearchStore(storeId);
  }
}
```

**FileIndexService**:

```typescript
@Injectable()
export class FileIndexService {
  constructor(
    private geminiService: GeminiFileSearchService,
    private resourceService: ResourcesService,
    @InjectRepository(FileSearchStore)
    private storeRepo: Repository<FileSearchStore>,
    @InjectRepository(IndexedFile)
    private indexedFileRepo: Repository<IndexedFile>,
  ) {}

  /**
   * 为 Collection 创建并索引 File Search Store
   */
  async indexCollection(
    collectionId: string,
    userId: string,
  ): Promise<FileSearchStore> {
    // 1. 检查是否已存在 Store
    let store = await this.storeRepo.findOne({
      where: { collectionId },
    });

    if (store && store.status === "ready") {
      return store;
    }

    // 2. 创建新 Store
    if (!store) {
      const geminiStoreId = await this.geminiService.createStore(
        `collection_${collectionId}`,
      );

      store = this.storeRepo.create({
        collectionId,
        geminiStoreId,
        name: `Collection ${collectionId}`,
        status: "indexing",
      });

      await this.storeRepo.save(store);
    }

    // 3. 获取 Collection 中所有可索引的资源
    const resources = await this.resourceService.findByCollection(
      collectionId,
      { types: ["PAPER", "BLOG", "REPORT"] }, // 只索引文档类型
    );

    // 4. 批量索引文件
    const indexPromises = resources.map(async (resource) => {
      try {
        await this.indexResource(store, resource);
      } catch (error) {
        console.error(`Failed to index resource ${resource.id}:`, error);
      }
    });

    await Promise.allSettled(indexPromises);

    // 5. 更新 Store 状态
    store.status = "ready";
    store.fileCount = await this.indexedFileRepo.count({
      where: { storeId: store.id },
    });
    store.indexedAt = new Date();

    await this.storeRepo.save(store);

    return store;
  }

  /**
   * 索引单个资源
   */
  private async indexResource(
    store: FileSearchStore,
    resource: Resource,
  ): Promise<void> {
    // 1. 下载文件
    const filePath = await this.downloadResourceFile(resource);

    // 2. 上传到 Gemini
    const geminiFileId = await this.geminiService.uploadFile(
      filePath,
      this.getMimeType(resource.type),
      resource.title,
    );

    // 3. 添加到 Store
    await this.geminiService.addFileToStore(store.geminiStoreId, geminiFileId);

    // 4. 保存索引记录
    const indexedFile = this.indexedFileRepo.create({
      storeId: store.id,
      resourceId: resource.id,
      geminiFileId,
      fileName: resource.title,
      fileType: resource.type,
      fileSize: 0, // TODO: Get actual file size
      status: "indexed",
    });

    await this.indexedFileRepo.save(indexedFile);

    // 5. 清理临时文件
    await fs.unlink(filePath);
  }

  /**
   * 下载资源文件到本地临时目录
   */
  private async downloadResourceFile(resource: Resource): Promise<string> {
    if (resource.pdfUrl) {
      // 下载 PDF
      const response = await fetch(resource.pdfUrl);
      const buffer = await response.arrayBuffer();

      const tempPath = `/tmp/${resource.id}.pdf`;
      await fs.writeFile(tempPath, Buffer.from(buffer));

      return tempPath;
    }

    // TODO: 处理其他文件类型
    throw new Error("No downloadable file found for resource");
  }

  private getMimeType(resourceType: string): string {
    const mimeTypes = {
      PAPER: "application/pdf",
      BLOG: "text/html",
      REPORT: "application/pdf",
    };
    return mimeTypes[resourceType] || "application/pdf";
  }
}
```

#### 6.1.3 Controller 实现

```typescript
@Controller("api/v1/ai-office")
@UseGuards(JwtAuthGuard)
export class FileSearchController {
  constructor(
    private fileIndexService: FileIndexService,
    private queryRouter: QueryRouterService,
    private citationFormatter: CitationFormatterService,
  ) {}

  /**
   * 索引 Collection
   */
  @Post("file-search/index")
  async indexCollection(@Body() dto: IndexCollectionDto, @Request() req) {
    const store = await this.fileIndexService.indexCollection(
      dto.collectionId,
      req.user.id,
    );

    return {
      storeId: store.id,
      status: store.status,
      fileCount: store.fileCount,
      indexedAt: store.indexedAt,
    };
  }

  /**
   * 多文件智能搜索
   */
  @Post("file-search/query")
  async search(@Body() dto: SearchQueryDto, @Request() req) {
    const result = await this.queryRouter.search(dto.query, {
      collectionIds: dto.collectionIds,
      maxResults: dto.maxResults || 5,
    });

    return {
      answer: result.text,
      citations: this.citationFormatter.formatCitations(result.citations),
      metadata: {
        tokensUsed: result.usage.totalTokenCount,
        filesSearched: result.filesSearched,
      },
    };
  }

  /**
   * 对比分析
   */
  @Post("file-search/compare")
  async compare(@Body() dto: ComparisonRequestDto, @Request() req) {
    const report = await this.comparisonAnalyzer.compareDocuments(
      dto.resourceIds,
      dto.criteria,
    );

    return report;
  }
}
```

### 6.2 前端实现

#### 6.2.1 AI Office 集成

**MultiFileSearchPanel Component**:

```typescript
// frontend/components/features/MultiFileSearchPanel.tsx

import { useState, useEffect } from 'react';
import { Collection } from '@/types';
import { config } from '@/lib/config';

interface Citation {
  resourceId: string;
  resourceTitle: string;
  pageNumber?: number;
  excerpt: string;
  confidence: number;
}

interface SearchResult {
  answer: string;
  citations: Citation[];
  metadata: {
    tokensUsed: number;
    filesSearched: number;
  };
}

export default function MultiFileSearchPanel() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<Collection | null>(null);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [storeStatus, setStoreStatus] = useState<'not_indexed' | 'indexing' | 'ready'>('not_indexed');

  // 加载用户的 Collections
  useEffect(() => {
    loadCollections();
  }, []);

  // 检查选中 Collection 的索引状态
  useEffect(() => {
    if (selectedCollection) {
      checkIndexStatus(selectedCollection.id);
    }
  }, [selectedCollection]);

  const loadCollections = async () => {
    const response = await fetch(`${config.apiBaseUrl}/api/v1/collections`);
    const data = await response.json();
    setCollections(data);
  };

  const checkIndexStatus = async (collectionId: string) => {
    const response = await fetch(
      `${config.apiBaseUrl}/api/v1/ai-office/file-search/status/${collectionId}`
    );
    const data = await response.json();
    setStoreStatus(data.status);
  };

  const handleIndexCollection = async () => {
    if (!selectedCollection) return;

    setIndexing(true);
    setStoreStatus('indexing');

    try {
      const response = await fetch(
        `${config.apiBaseUrl}/api/v1/ai-office/file-search/index`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            collectionId: selectedCollection.id,
          }),
        }
      );

      const data = await response.json();

      if (data.status === 'ready') {
        setStoreStatus('ready');
      }
    } catch (error) {
      console.error('Indexing failed:', error);
      setStoreStatus('not_indexed');
    } finally {
      setIndexing(false);
    }
  };

  const handleSearch = async () => {
    if (!selectedCollection || !query.trim()) return;

    setLoading(true);

    try {
      const response = await fetch(
        `${config.apiBaseUrl}/api/v1/ai-office/file-search/query`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            collectionIds: [selectedCollection.id],
            query,
          }),
        }
      );

      const data = await response.json();
      setResult(data);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Collection Selector */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Select Collection
        </label>
        <select
          value={selectedCollection?.id || ''}
          onChange={(e) => {
            const coll = collections.find(c => c.id === e.target.value);
            setSelectedCollection(coll || null);
          }}
          className="w-full rounded-lg border border-gray-300 px-4 py-2"
        >
          <option value="">-- Choose a collection --</option>
          {collections.map(coll => (
            <option key={coll.id} value={coll.id}>
              {coll.name} ({coll.items?.length || 0} items)
            </option>
          ))}
        </select>
      </div>

      {/* Index Status */}
      {selectedCollection && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium text-blue-900">Index Status</h4>
              <p className="text-sm text-blue-700">
                {storeStatus === 'not_indexed' && 'Collection not indexed yet'}
                {storeStatus === 'indexing' && 'Indexing in progress...'}
                {storeStatus === 'ready' && 'Ready for search'}
              </p>
            </div>

            {storeStatus === 'not_indexed' && (
              <button
                onClick={handleIndexCollection}
                disabled={indexing}
                className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {indexing ? 'Indexing...' : 'Index Now'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Search Box */}
      {storeStatus === 'ready' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Ask a Question
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="What would you like to know?"
              className="flex-1 rounded-lg border border-gray-300 px-4 py-2"
            />
            <button
              onClick={handleSearch}
              disabled={loading || !query.trim()}
              className="rounded-lg bg-green-600 px-6 py-2 text-white hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Answer */}
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <h3 className="mb-4 text-lg font-semibold">Answer</h3>
            <div className="prose prose-sm max-w-none">
              {result.answer}
            </div>

            <div className="mt-4 flex gap-4 text-xs text-gray-500">
              <span>🔍 {result.metadata.filesSearched} files searched</span>
              <span>💬 {result.metadata.tokensUsed} tokens used</span>
            </div>
          </div>

          {/* Citations */}
          {result.citations.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-6">
              <h3 className="mb-4 text-lg font-semibold">References</h3>
              <div className="space-y-4">
                {result.citations.map((citation, i) => (
                  <div key={i} className="rounded-lg bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
                            {i + 1}
                          </span>
                          <span className="font-medium">{citation.resourceTitle}</span>
                          {citation.pageNumber && (
                            <span className="text-sm text-gray-500">
                              (p. {citation.pageNumber})
                            </span>
                          )}
                        </div>

                        <blockquote className="mt-2 border-l-4 border-gray-300 pl-4 text-sm italic text-gray-700">
                          {citation.excerpt}
                        </blockquote>

                        <div className="mt-2 text-xs text-gray-500">
                          Confidence: {(citation.confidence * 100).toFixed(1)}%
                        </div>
                      </div>

                      <a
                        href={`/resource/${citation.resourceId}`}
                        target="_blank"
                        className="ml-4 text-blue-600 hover:underline"
                      >
                        View →
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

#### 6.2.2 在 AI Office 中集成

```typescript
// frontend/app/ai-office/page.tsx

import { useState } from 'react';
import MultiFileSearchPanel from '@/components/features/MultiFileSearchPanel';

export default function AIOffice() {
  const [mode, setMode] = useState<'chat' | 'multi-file'>('chat');

  return (
    <div className="flex h-screen">
      <Sidebar />

      <main className="flex-1 flex flex-col">
        {/* Mode Switcher */}
        <div className="border-b border-gray-200 p-4">
          <div className="flex gap-2">
            <button
              onClick={() => setMode('chat')}
              className={`px-4 py-2 rounded-lg ${
                mode === 'chat'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700'
              }`}
            >
              💬 AI Chat
            </button>
            <button
              onClick={() => setMode('multi-file')}
              className={`px-4 py-2 rounded-lg ${
                mode === 'multi-file'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700'
              }`}
            >
              📚 Multi-File Analysis
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {mode === 'chat' && <ChatInterface />}
          {mode === 'multi-file' && <MultiFileSearchPanel />}
        </div>
      </main>
    </div>
  );
}
```

---

## 7. 数据流设计

### 7.1 索引流程

```
User Action: "Index Collection"
         │
         ↓
┌────────────────────────────────────────┐
│  Frontend: MultiFileSearchPanel       │
│  - Click "Index Now" button            │
└────────────┬───────────────────────────┘
             │ POST /api/v1/ai-office/file-search/index
             │ { collectionId: "xxx" }
             ↓
┌────────────────────────────────────────┐
│  Backend: FileSearchController         │
│  - Validate user permission            │
│  - Delegate to FileIndexService        │
└────────────┬───────────────────────────┘
             │
             ↓
┌────────────────────────────────────────┐
│  FileIndexService                      │
│  1. Check existing store               │
│  2. Create Gemini File Search Store    │
│  3. Get all resources in collection    │
│  4. For each resource:                 │
└────────────┬───────────────────────────┘
             │
             ↓ (parallel)
    ┌────────┴────────┬─────────┬─────────┐
    │                 │         │         │
    ↓                 ↓         ↓         ↓
┌─────────┐     ┌─────────┐  ┌─────────┐  ...
│Resource1│     │Resource2│  │Resource3│
└────┬────┘     └────┬────┘  └────┬────┘
     │               │            │
     │ Download PDF  │            │
     ↓               ↓            ↓
┌─────────────────────────────────────────┐
│  Gemini File API                        │
│  1. Upload file                         │
│  2. Wait for processing (ACTIVE state)  │
│  3. Add to File Search Store            │
└────────────┬────────────────────────────┘
             │
             ↓
┌────────────────────────────────────────┐
│  Database: Save IndexedFile records    │
│  - geminiFileId                        │
│  - storeId                             │
│  - resourceId                          │
└────────────┬───────────────────────────┘
             │
             ↓
┌────────────────────────────────────────┐
│  Update FileSearchStore                │
│  - status: "ready"                     │
│  - fileCount: N                        │
│  - indexedAt: now()                    │
└────────────┬───────────────────────────┘
             │
             ↓
      Return to Frontend
```

### 7.2 查询流程

```
User Query: "What are the main findings?"
         │
         ↓
┌────────────────────────────────────────┐
│  Frontend: Search Input                │
│  - User types question                 │
│  - Click "Search" button               │
└────────────┬───────────────────────────┘
             │ POST /api/v1/ai-office/file-search/query
             │ { collectionIds: ["xxx"], query: "..." }
             ↓
┌────────────────────────────────────────┐
│  Backend: FileSearchController         │
│  - Validate collection access          │
│  - Delegate to QueryRouter             │
└────────────┬───────────────────────────┘
             │
             ↓
┌────────────────────────────────────────┐
│  QueryRouterService                    │
│  1. Resolve collection → store mapping │
│  2. Build query context                │
│  3. Call Gemini File Search API        │
└────────────┬───────────────────────────┘
             │
             ↓
┌────────────────────────────────────────┐
│  Gemini API                            │
│  - Model: gemini-2.0-flash             │
│  - Tool: fileSearch                    │
│  - Stores: [storeId1, storeId2, ...]   │
│  ─────────────────────────────────────│
│  Process:                              │
│  1. Embed user query                   │
│  2. Vector search across all stores    │
│  3. Retrieve top-k chunks              │
│  4. Generate answer with grounding     │
└────────────┬───────────────────────────┘
             │
             ↓ Response with grounding metadata
┌────────────────────────────────────────┐
│  CitationFormatterService              │
│  1. Extract grounding chunks           │
│  2. Map fileId → resourceId            │
│  3. Format citations with excerpts     │
└────────────┬───────────────────────────┘
             │
             ↓
┌────────────────────────────────────────┐
│  Response to Frontend                  │
│  {                                     │
│    answer: "...",                      │
│    citations: [                        │
│      {                                 │
│        resourceId: "...",              │
│        resourceTitle: "...",           │
│        pageNumber: 42,                 │
│        excerpt: "...",                 │
│        confidence: 0.95                │
│      }                                 │
│    ],                                  │
│    metadata: { ... }                   │
│  }                                     │
└────────────┬───────────────────────────┘
             │
             ↓
      Render Result + Citations
```

---

## 8. API 接口设计

### 8.1 RESTful API Specification

#### 8.1.1 索引管理

**POST /api/v1/ai-office/file-search/index**

创建或更新 Collection 的文件索引

```typescript
// Request
{
  "collectionId": "string",
  "forceReindex": boolean  // optional, 强制重新索引
}

// Response 200 OK
{
  "storeId": "string",
  "status": "indexing" | "ready" | "error",
  "fileCount": number,
  "indexedAt": "2025-11-23T10:00:00Z",
  "metadata": {
    "totalTokens": number,
    "indexingCost": number
  }
}

// Response 400 Bad Request
{
  "error": "Collection not found" | "Collection is empty"
}
```

**GET /api/v1/ai-office/file-search/status/:collectionId**

获取索引状态

```typescript
// Response 200 OK
{
  "collectionId": "string",
  "status": "not_indexed" | "indexing" | "ready" | "error",
  "fileCount": number,
  "lastIndexed": "2025-11-23T10:00:00Z" | null,
  "errorMessage": "string" | null
}
```

**DELETE /api/v1/ai-office/file-search/index/:collectionId**

删除索引

```typescript
// Response 204 No Content
```

#### 8.1.2 智能搜索

**POST /api/v1/ai-office/file-search/query**

多文件智能问答

```typescript
// Request
{
  "collectionIds": string[],  // 可以跨多个 Collection 搜索
  "query": string,
  "context": {
    "maxResults": number,      // optional, default: 5
    "includeNotes": boolean,   // optional, 是否包含用户笔记
    "resourceTypes": string[], // optional, 限制资源类型
    "dateRange": {             // optional, 时间范围
      "from": "2024-01-01",
      "to": "2024-12-31"
    }
  }
}

// Response 200 OK
{
  "answer": "string",  // AI 生成的回答
  "citations": [
    {
      "resourceId": "string",
      "resourceTitle": "string",
      "pageNumber": number | null,
      "chunkIndex": number,
      "excerpt": "string",
      "confidence": number  // 0-1
    }
  ],
  "metadata": {
    "tokensUsed": number,
    "filesSearched": number,
    "processingTime": number  // ms
  }
}
```

#### 8.1.3 对比分析

**POST /api/v1/ai-office/file-search/compare**

对比分析多个文档

```typescript
// Request
{
  "resourceIds": string[],  // 要对比的资源 ID
  "criteria": string,       // 对比维度/标准
  "format": "table" | "prose"  // optional, 输出格式
}

// Response 200 OK
{
  "comparison": {
    "summary": "string",
    "table": {  // if format === "table"
      "headers": string[],
      "rows": {
        [resourceId: string]: {
          [criterion: string]: {
            "value": string,
            "citation": Citation
          }
        }
      }
    },
    "narrative": "string"  // if format === "prose"
  },
  "metadata": {
    "documentsCompared": number,
    "tokensUsed": number
  }
}
```

#### 8.1.4 主题发现

**POST /api/v1/ai-office/file-search/topics**

自动发现 Collection 中的主题

```typescript
// Request
{
  "collectionId": "string",
  "minClusterSize": number  // optional, 最小聚类大小
}

// Response 200 OK
{
  "topics": [
    {
      "id": "string",
      "name": "string",
      "keywords": string[],
      "summary": "string",
      "documentCount": number,
      "representativeDocuments": [
        {
          "resourceId": "string",
          "title": "string",
          "relevance": number
        }
      ]
    }
  ],
  "metadata": {
    "totalTopics": number,
    "coverage": number  // 被聚类覆盖的文档百分比
  }
}
```

---

## 9. 实施路线图

### 9.1 Phase 1: MVP (4-6 weeks)

#### Week 1-2: 基础设施搭建

- [ ] 设置 Gemini API 集成
- [ ] 实现 FileSearchStore 和 IndexedFile 数据模型
- [ ] 实现 GeminiFileSearchService 基础服务
- [ ] 实现文件下载和上传功能

#### Week 3-4: 核心功能开发

- [ ] 实现 Collection 索引功能
- [ ] 实现基础问答功能
- [ ] 实现 Citation 格式化
- [ ] 前端 MultiFileSearchPanel 组件

#### Week 5-6: 集成和测试

- [ ] AI Office 页面集成
- [ ] 端到端测试
- [ ] 性能优化
- [ ] 文档编写

**交付物**:

- ✅ 基础多文件问答功能
- ✅ Collection 级别索引管理
- ✅ 自动引用和来源标注
- ✅ 支持 PDF、DOCX、TXT

### 9.2 Phase 2: 高级功能 (4 weeks)

#### Week 7-8: 对比分析

- [ ] 实现 ComparisonAnalyzer 服务
- [ ] 对比分析 API 端点
- [ ] 前端对比分析界面
- [ ] 表格和可视化展示

#### Week 9-10: 主题发现

- [ ] 实现主题提取算法
- [ ] 聚类分析实现
- [ ] 知识图谱基础结构
- [ ] 前端可视化组件

**交付物**:

- ✅ 文档对比分析
- ✅ 主题自动发现
- ✅ 知识图谱基础版

### 9.3 Phase 3: 优化和扩展 (4 weeks)

#### Week 11-12: 性能优化

- [ ] 增量索引优化
- [ ] 查询缓存机制
- [ ] 批处理优化
- [ ] 成本监控和优化

#### Week 13-14: 用户体验提升

- [ ] 搜索结果高亮
- [ ] 导出功能（PDF、Markdown）
- [ ] 历史查询记录
- [ ] 推荐相关问题

**交付物**:

- ✅ 性能优化 (查询 < 2s)
- ✅ 导出和分享功能
- ✅ 智能推荐系统

---

## 10. 风险与挑战

### 10.1 技术风险

#### Risk 1: Gemini API 限流和配额

**风险等级**: 🔴 High

**问题描述**:

- Gemini API 有请求频率限制
- 大量用户同时索引可能触发限流
- 存储配额 1TB 可能不足

**缓解措施**:

1. **请求队列**:

   ```typescript
   class RateLimitedQueue {
     private queue: Task[] = [];
     private processing = 0;
     private maxConcurrent = 5;

     async add(task: Task) {
       this.queue.push(task);
       await this.process();
     }

     private async process() {
       while (this.processing < this.maxConcurrent && this.queue.length > 0) {
         const task = this.queue.shift();
         this.processing++;

         await this.executeWithBackoff(task).finally(() => this.processing--);
       }
     }

     private async executeWithBackoff(task: Task, retries = 3) {
       try {
         return await task();
       } catch (error) {
         if (error.code === 429 && retries > 0) {
           await this.sleep(2 ** (3 - retries) * 1000); // Exponential backoff
           return this.executeWithBackoff(task, retries - 1);
         }
         throw error;
       }
     }
   }
   ```

2. **配额监控**:
   - 实时监控存储使用量
   - 接近限制时通知管理员
   - 自动清理过期索引

#### Risk 2: 索引成本控制

**风险等级**: 🟡 Medium

**问题描述**:

- 索引成本 $0.15/M tokens
- 大型 Collection (100+ PDFs) 可能产生可观成本
- 重复索引浪费资源

**缓解措施**:

1. **增量索引**:

   ```typescript
   async syncCollection(collectionId: string) {
     const store = await this.getStore(collectionId);
     const lastIndexed = store.indexedAt;

     // 只索引新增或更新的资源
     const newResources = await this.getResourcesAfter(
       collectionId,
       lastIndexed
     );

     // 批处理索引
     for (const batch of this.chunk(newResources, 10)) {
       await this.indexBatch(store, batch);
     }
   }
   ```

2. **用户配额管理**:
   - 每个用户每月免费额度
   - 超额使用付费
   - 管理员可设置全局限制

#### Risk 3: 引用准确性

**风险等级**: 🟡 Medium

**问题描述**:

- Gemini 的 grounding metadata 可能不完全准确
- 页码定位可能有偏差
- 跨语言文档引用可能混乱

**缓解措施**:

1. **引用验证**:

   ```typescript
   async validateCitation(citation: Citation) {
     // 下载原文档对应页面
     const pageContent = await this.extractPage(
       citation.resourceId,
       citation.pageNumber
     );

     // 模糊匹配检查
     const similarity = this.calculateSimilarity(
       pageContent,
       citation.excerpt
     );

     if (similarity < 0.8) {
       citation.confidence *= 0.5;  // 降低置信度
     }

     return citation;
   }
   ```

2. **用户反馈机制**:
   - 允许用户报告错误引用
   - 积累数据改进算法

### 10.2 产品风险

#### Risk 1: 用户采用率

**风险等级**: 🟡 Medium

**问题描述**:

- 用户可能不理解多文件分析的价值
- 索引等待时间可能降低使用意愿
- 学习曲线可能较陡

**缓解措施**:

1. **新手引导**:
   - 首次使用时展示示例场景
   - 预设常见问题模板
   - 视频教程

2. **快速开始**:
   - 提供示例 Collection
   - 预先索引热门主题
   - 即时搜索已索引内容

3. **价值展示**:
   - 对比传统方式的时间节省
   - 展示引用准确性
   - 突出知识发现能力

#### Risk 2: 数据隐私

**风险等级**: 🔴 High

**问题描述**:

- 用户文件上传到 Google 服务器
- 可能包含敏感信息
- GDPR/数据合规问题

**缓解措施**:

1. **明确告知**:

   ```typescript
   <PrivacyNotice>
     ⚠️ 您的文件将上传到 Google Gemini 服务进行处理。
     请勿上传包含以下内容的文件：
     - 个人敏感信息 (PII)
     - 商业机密
     - 受法律保护的内容

     [我已了解并同意] [取消]
   </PrivacyNotice>
   ```

2. **数据控制**:
   - 用户随时可删除索引
   - 自动过期清理 (90 天)
   - 导出功能保留本地副本

3. **企业版考虑**:
   - 自建 RAG 选项
   - 本地部署模型
   - 私有云方案

---

## 附录

### A. Gemini File Search API 参考

#### 创建 File Search Store

```typescript
const fileManager = genAI.fileManager;

const store = await fileManager.createFileSearchStore({
  displayName: "My Knowledge Base",
});

console.log(`Store created: ${store.name}`);
// Output: stores/abc123def456
```

#### 上传文件

```typescript
const uploadResult = await fileManager.uploadFile("path/to/document.pdf", {
  mimeType: "application/pdf",
  displayName: "Research Paper",
});

// 等待处理完成
let file = await fileManager.getFile(uploadResult.file.name);
while (file.state === FileState.PROCESSING) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  file = await fileManager.getFile(uploadResult.file.name);
}
```

#### 添加到 Store

```typescript
await fileManager.addFileToStore(store.name, {
  file: file.name,
});
```

#### 使用 File Search 查询

```typescript
const model = genAI.getGenerativeModel({
  model: "gemini-2.0-flash",
  tools: [
    {
      fileSearch: {
        stores: [{ id: store.name }],
      },
    },
  ],
});

const result = await model.generateContent({
  contents: [
    {
      role: "user",
      parts: [{ text: "What are the main findings?" }],
    },
  ],
});

console.log(result.response.text());
console.log(result.response.candidates[0].groundingMetadata);
```

### B. 成本估算

#### 场景 1: 中小型用户 (10个Collections, 每个50个PDF)

```
索引成本:
- 文件数: 500
- 平均文件大小: 5MB
- 平均tokens: 50,000/文件
- 总tokens: 25M tokens
- 索引费用: 25M × $0.15/M = $3.75 (一次性)

查询成本:
- 存储: 免费
- 向量嵌入: 免费
- 仅 Gemini 生成成本

月度成本估算: < $5
```

#### 场景 2: 重度用户 (100个Collections, 每个100个PDF)

```
索引成本:
- 文件数: 10,000
- 总tokens: 500M tokens
- 索引费用: 500M × $0.15/M = $75 (一次性)

增量更新:
- 每月新增: 10%
- 更新费用: $7.5/月

月度成本估算: $7.5 - $15
```

### C. 技术限制

| 限制项          | 值  | 备注                   |
| --------------- | --- | ---------------------- |
| 最大文件大小    | 2GB | 单个文件               |
| 最大 Store 大小 | 1TB | Tier 3 项目            |
| 并发上传        | 5   | 建议值                 |
| 查询超时        | 30s | API 超时               |
| 支持文件格式    | 40+ | 包括 PDF, DOCX, TXT 等 |

---

## 参考资料

- [Introducing the File Search Tool in Gemini API](https://blog.google/technology/developers/file-search-gemini-api/)
- [File Search | Gemini API Documentation](https://ai.google.dev/gemini-api/docs/file-search)
- [Gemini API's New "File Search" Tool — Built-In RAG for Everyone](https://medium.com/@abdulkadir9929/gemini-apis-new-file-search-tool-built-in-rag-for-everyone-e990c054dcff)
- [Gemini File Search API Explained: A Practical Handbook for PMs](https://www.productcompass.pm/p/gemini-file-search-api)
- [What is Gemini File Search? RAG with Gemini API](https://websearchapi.ai/blog/what-is-gemini-file-search)

---

**文档版本**: v1.0
**最后更新**: 2025-11-23
**状态**: RFC - 待评审
**下一步**: 团队评审 → 技术验证 → 开发启动
