# GenesisPod 工具系统增强方案

> 版本: v1.0.0
> 日期: 2025-12-18
> 状态: 实施中

## 一、背景与目标

### 1.1 背景

GenesisPod 是一个 AI 驱动的知识发现平台，通过 4 个专项 Agent（Slides、Docs、Designer、Developer）为用户提供内容生成服务。当前工具系统仅覆盖 12 种工具类型，无法满足完整的知识工作流需求。

### 1.2 目标

参考业界最佳实践（LangChain、OpenAI Agents SDK、MCP 协议、AutoGen），将工具系统从 12 种扩展到 45 种，覆盖 8 大类别，实现生产级 Agent 工具能力。

### 1.3 核心诉求

| 模块       | 核心需求             | 依赖的工具能力 |
| ---------- | -------------------- | -------------- |
| AI Studio  | 从资料库检索相关内容 | RAG 向量检索   |
| AI Office  | 解析用户上传的文档   | 文件解析器     |
| AI Teams   | 多轮对话上下文       | 记忆系统       |
| DocsAgent  | 运行数据分析代码     | Python 执行    |
| 全部 Agent | Multi-Agent 协作     | Agent 委派     |
| 导出功能   | 关键操作确认         | 人机协作       |

---

## 二、工具全景图

### 2.1 目标工具矩阵 (45 种)

```
┌────────────────────────────────────────────────────────────────────┐
│              GenesisPod 工具全景图                             │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  1️⃣ 信息获取类 (6 种)                                              │
│  ├── ✅ WEB_SEARCH        - 网络搜索                               │
│  ├── ✅ WEB_SCRAPER       - 网页抓取                               │
│  ├── ✅ DATA_FETCH        - 数据获取                               │
│  ├── 🔴 RAG_SEARCH        - 向量检索 [P0]                          │
│  ├── 🟡 DATABASE_QUERY    - 数据库查询 [P1]                        │
│  └── 🟡 KNOWLEDGE_GRAPH   - 知识图谱查询 [P1]                      │
│                                                                    │
│  2️⃣ 内容生成类 (6 种)                                              │
│  ├── ✅ TEXT_GENERATION   - 文本生成                               │
│  ├── ✅ IMAGE_GENERATION  - 图像生成                               │
│  ├── ✅ CODE_GENERATION   - 代码生成                               │
│  ├── 🟡 AUDIO_GENERATION  - 音频/TTS [P1]                          │
│  ├── 🟢 VIDEO_GENERATION  - 视频生成 [P2]                          │
│  └── 🟡 STRUCTURED_OUTPUT - 结构化输出 [P1]                        │
│                                                                    │
│  3️⃣ 数据处理类 (6 种)                                              │
│  ├── ✅ DATA_ANALYSIS     - 数据分析                               │
│  ├── ✅ FILE_CONVERSION   - 文件转换                               │
│  ├── 🔴 FILE_PARSER       - 文件解析 [P0]                          │
│  ├── 🟡 OCR_RECOGNITION   - OCR 识别 [P1]                          │
│  ├── 🟢 DATA_VALIDATION   - 数据验证 [P2]                          │
│  └── 🟢 DATA_CLEANING     - 数据清洗 [P2]                          │
│                                                                    │
│  4️⃣ 文档处理类 (6 种)                                              │
│  ├── ✅ EXPORT_PDF        - 导出 PDF                               │
│  ├── ✅ EXPORT_DOCX       - 导出 Word                              │
│  ├── ✅ EXPORT_PPTX       - 导出 PPT                               │
│  ├── ✅ EXPORT_IMAGE      - 导出图片                               │
│  ├── 🟢 DOCUMENT_DIFF     - 文档对比 [P2]                          │
│  └── 🟢 TEMPLATE_RENDER   - 模板渲染 [P2]                          │
│                                                                    │
│  5️⃣ 代码执行类 (5 种) [全新]                                       │
│  ├── 🔴 PYTHON_EXECUTOR   - Python 执行 [P0]                       │
│  ├── 🟡 JAVASCRIPT_EXECUTOR - JavaScript 执行 [P1]                 │
│  ├── 🟡 SQL_EXECUTOR      - SQL 执行 [P1]                          │
│  ├── 🟢 SHELL_EXECUTOR    - Shell 执行 [P2]                        │
│  └── 🟢 CONTAINER_EXECUTOR - 容器执行 [P2]                         │
│                                                                    │
│  6️⃣ 外部集成类 (6 种) [全新]                                       │
│  ├── 🟡 MESSAGE_PUSH      - 消息推送 [P1]                          │
│  ├── 🟡 CLOUD_STORAGE     - 云存储 [P1]                            │
│  ├── 🟢 GITHUB_INTEGRATION - GitHub 集成 [P2]                      │
│  ├── 🟢 EMAIL_SENDER      - 邮件发送 [P2]                          │
│  ├── 🟢 CALENDAR_INTEGRATION - 日历集成 [P2]                       │
│  └── 🟢 WEBHOOK_TRIGGER   - Webhook 触发 [P2]                      │
│                                                                    │
│  7️⃣ 记忆与状态类 (5 种) [全新]                                     │
│  ├── 🔴 SHORT_TERM_MEMORY - 短期记忆 [P0]                          │
│  ├── 🔴 LONG_TERM_MEMORY  - 长期记忆 [P0]                          │
│  ├── 🟡 ENTITY_MEMORY     - 实体记忆 [P1]                          │
│  ├── 🟡 KNOWLEDGE_BASE    - 知识库 [P1]                            │
│  └── 🟢 USER_PREFERENCES  - 用户偏好 [P2]                          │
│                                                                    │
│  8️⃣ Agent 协作类 (5 种) [全新]                                     │
│  ├── 🔴 AGENT_HANDOFF     - Agent 委派 [P0]                        │
│  ├── 🔴 HUMAN_APPROVAL    - 人机协作 [P0]                          │
│  ├── 🟡 AGENT_COMMUNICATION - Agent 通信 [P1]                      │
│  ├── 🟡 WORKFLOW_ORCHESTRATION - 工作流编排 [P1]                   │
│  └── 🟢 CONSENSUS_MECHANISM - 共识机制 [P2]                        │
│                                                                    │
│  图例: ✅ 已实现  🔴 P0 必须  🟡 P1 重要  🟢 P2 增强               │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### 2.2 优先级定义

| 优先级 | 说明                       | 工具数量 | 实现周期 |
| ------ | -------------------------- | -------- | -------- |
| P0     | 核心必需，严重影响产品价值 | 7 种     | 4-6 周   |
| P1     | 重要功能，影响用户体验     | 10 种    | 4-6 周   |
| P2     | 增强功能，提升竞争力       | 16 种    | 4-6 周   |

---

## 三、P0 核心工具详细设计

### 3.1 RAG 向量检索工具

#### 3.1.1 功能描述

从向量数据库中检索与查询相关的文档片段，支持 AI Studio 的资料研究场景。

#### 3.1.2 接口定义

```typescript
// 工具类型
ToolType.RAG_SEARCH = "rag_search";

// 输入参数
interface RAGSearchInput {
  query: string; // 查询文本
  collectionId?: string; // 集合 ID（项目/工作空间）
  resourceIds?: string[]; // 限定资源范围
  topK?: number; // 返回数量，默认 5
  threshold?: number; // 相似度阈值，默认 0.7
  filters?: {
    // 元数据过滤
    types?: string[]; // 资源类型
    dateRange?: [Date, Date]; // 时间范围
    tags?: string[]; // 标签
  };
  rerank?: boolean; // 是否重排序
}

// 输出结果
interface RAGSearchOutput {
  results: Array<{
    resourceId: string; // 资源 ID
    chunkId: string; // 片段 ID
    content: string; // 文本内容
    score: number; // 相似度分数
    metadata: {
      title: string;
      source: string;
      pageNumber?: number;
      position?: { start: number; end: number };
    };
  }>;
  totalFound: number;
  queryEmbedding?: number[]; // 可选返回查询向量
}
```

#### 3.1.3 实现要点

1. **Embedding 服务**: 使用 OpenAI text-embedding-3-small
2. **向量存储**: 使用 PostgreSQL + pgvector 扩展
3. **重排序**: 可选使用 Cohere Rerank 或本地模型
4. **缓存策略**: 查询向量缓存 5 分钟

---

### 3.2 文件解析工具

#### 3.2.1 功能描述

解析多种文件格式（PDF、Word、PPT、Excel），提取文本内容和结构。

#### 3.2.2 接口定义

```typescript
// 工具类型
ToolType.FILE_PARSER = "file_parser";

// 输入参数
interface FileParserInput {
  file: {
    url?: string; // 文件 URL
    buffer?: Buffer; // 文件内容
    mimeType: string; // MIME 类型
    filename: string; // 文件名
  };
  options?: {
    extractImages?: boolean; // 是否提取图片
    extractTables?: boolean; // 是否提取表格
    preserveLayout?: boolean; // 是否保留布局
    ocrEnabled?: boolean; // 是否启用 OCR
    language?: string; // OCR 语言
    maxPages?: number; // 最大页数限制
  };
}

// 输出结果
interface FileParserOutput {
  content: string; // 纯文本内容
  structure: {
    title?: string;
    sections: Array<{
      level: number;
      title: string;
      content: string;
      pageRange?: [number, number];
    }>;
    metadata: {
      author?: string;
      createdAt?: Date;
      modifiedAt?: Date;
      pageCount?: number;
      wordCount?: number;
    };
  };
  tables?: Array<{
    pageNumber: number;
    headers: string[];
    rows: string[][];
  }>;
  images?: Array<{
    pageNumber: number;
    base64: string;
    caption?: string;
  }>;
}
```

#### 3.2.3 实现要点

1. **PDF 解析**: 使用 pdf-parse + pdfjs-dist
2. **Word 解析**: 使用 mammoth
3. **PPT 解析**: 使用 pptxjs 或自定义 XML 解析
4. **Excel 解析**: 使用 xlsx
5. **OCR**: 可选集成 Tesseract 或云服务

---

### 3.3 记忆系统工具

#### 3.3.1 短期记忆

```typescript
// 工具类型
ToolType.SHORT_TERM_MEMORY = "short_term_memory";

// 输入参数
interface ShortTermMemoryInput {
  action: "get" | "set" | "append" | "clear";
  sessionId: string;
  key?: string;
  value?: unknown;
  ttl?: number; // 过期时间（秒）
}

// 输出结果
interface ShortTermMemoryOutput {
  success: boolean;
  data?: unknown;
  keys?: string[];
}
```

#### 3.3.2 长期记忆

```typescript
// 工具类型
ToolType.LONG_TERM_MEMORY = "long_term_memory";

// 输入参数
interface LongTermMemoryInput {
  action: "store" | "retrieve" | "search" | "delete";
  userId: string;
  memory?: {
    type: "fact" | "preference" | "interaction" | "summary";
    content: string;
    importance?: number; // 0-1
    tags?: string[];
    metadata?: Record<string, unknown>;
  };
  query?: {
    text?: string;
    types?: string[];
    limit?: number;
    minImportance?: number;
  };
}

// 输出结果
interface LongTermMemoryOutput {
  success: boolean;
  memories?: Array<{
    id: string;
    type: string;
    content: string;
    importance: number;
    createdAt: Date;
    accessCount: number;
    lastAccessedAt: Date;
  }>;
}
```

#### 3.3.3 实现要点

1. **短期记忆**: 使用 Redis 存储，支持 TTL
2. **长期记忆**: 使用 PostgreSQL + 向量索引
3. **记忆检索**: 结合语义搜索和元数据过滤
4. **记忆压缩**: 定期总结和归档旧记忆

---

### 3.4 Python 代码执行工具

#### 3.4.1 功能描述

在安全沙箱中执行 Python 代码，支持数据分析和可视化。

#### 3.4.2 接口定义

```typescript
// 工具类型
ToolType.PYTHON_EXECUTOR = "python_executor";

// 输入参数
interface PythonExecutorInput {
  code: string; // Python 代码
  context?: {
    variables?: Record<string, unknown>; // 预置变量
    dataframes?: Record<string, unknown>; // 预置 DataFrame
  };
  options?: {
    timeout?: number; // 超时时间（秒），默认 30
    memoryLimit?: number; // 内存限制（MB），默认 512
    allowNetwork?: boolean; // 是否允许网络，默认 false
    allowFileSystem?: boolean; // 是否允许文件系统，默认 false
  };
}

// 输出结果
interface PythonExecutorOutput {
  success: boolean;
  stdout: string;
  stderr: string;
  returnValue?: unknown;
  figures?: Array<{
    type: "matplotlib" | "plotly" | "altair";
    format: "png" | "svg" | "html";
    data: string; // base64 或 HTML
  }>;
  dataframes?: Record<
    string,
    {
      columns: string[];
      data: unknown[][];
      shape: [number, number];
    }
  >;
  executionTime: number; // 毫秒
}
```

#### 3.4.3 实现要点

1. **沙箱环境**: 使用 Docker 容器隔离
2. **预装库**: pandas, numpy, matplotlib, plotly, scikit-learn
3. **安全限制**: 禁止 os, subprocess, eval 等危险操作
4. **资源限制**: CPU、内存、执行时间限制

---

### 3.5 Agent 委派工具

#### 3.5.1 功能描述

支持 Agent 之间的任务委派和结果传递。

#### 3.5.2 接口定义

```typescript
// 工具类型
ToolType.AGENT_HANDOFF = "agent_handoff";

// 输入参数
interface AgentHandoffInput {
  targetAgent: AgentType; // 目标 Agent
  task: {
    prompt: string; // 任务描述
    context?: Record<string, unknown>; // 上下文
    files?: UploadedFile[]; // 附件
    priority?: "low" | "normal" | "high";
  };
  options?: {
    waitForResult?: boolean; // 是否等待结果
    timeout?: number; // 超时时间
    fallbackAgent?: AgentType; // 失败时的备选 Agent
  };
}

// 输出结果
interface AgentHandoffOutput {
  success: boolean;
  handoffId: string;
  targetAgent: AgentType;
  status: "delegated" | "completed" | "failed";
  result?: AgentResult;
  error?: string;
}
```

#### 3.5.3 实现要点

1. **任务队列**: 使用 Bull/BullMQ 管理异步任务
2. **状态追踪**: 跟踪委派任务的执行状态
3. **结果传递**: 支持大结果的流式传递
4. **错误处理**: 支持重试和降级

---

### 3.6 人机协作工具

#### 3.6.1 功能描述

在关键操作前请求用户确认，支持人机协作流程。

#### 3.6.2 接口定义

```typescript
// 工具类型
ToolType.HUMAN_APPROVAL = "human_approval";

// 输入参数
interface HumanApprovalInput {
  type: "confirm" | "choose" | "input" | "review";
  prompt: string; // 提示信息
  context?: {
    summary?: string; // 操作摘要
    details?: unknown; // 详细信息
    preview?: string; // 预览内容
  };
  options?: {
    choices?: Array<{
      // 选项（type=choose 时）
      id: string;
      label: string;
      description?: string;
    }>;
    inputSchema?: JSONSchema; // 输入 Schema（type=input 时）
    timeout?: number; // 超时时间（秒）
    defaultAction?: string; // 超时默认操作
  };
}

// 输出结果
interface HumanApprovalOutput {
  approved: boolean;
  response?: {
    choice?: string; // 用户选择
    input?: unknown; // 用户输入
    feedback?: string; // 用户反馈
  };
  respondedAt: Date;
  timedOut: boolean;
}
```

#### 3.6.3 实现要点

1. **WebSocket 通知**: 实时推送确认请求
2. **超时处理**: 支持配置默认行为
3. **审计日志**: 记录所有人机交互
4. **权限控制**: 基于操作类型的权限检查

---

## 四、架构增强

### 4.1 MCP 协议适配层

```typescript
// MCP 工具包装器
interface MCPToolWrapper {
  // MCP 标准资源管理
  resources: MCPResource[];

  // MCP 提示模板
  prompts: MCPPrompt[];

  // 进度报告
  reportProgress(token: string, progress: number, message?: string): void;

  // 取消支持
  onCancel(callback: () => void): void;
}

// MCP 服务器实现
class DeepDiveMCPServer {
  // 注册工具
  registerTool(tool: ITool): void;

  // 处理请求
  async handleRequest(request: MCPRequest): Promise<MCPResponse>;

  // 资源订阅
  subscribeResource(uri: string): Subscription;
}
```

### 4.2 安全护栏 (Guardrails)

```typescript
// 护栏配置
interface GuardrailConfig {
  // 内容过滤
  contentFilter?: {
    enabled: boolean;
    categories: string[];
    threshold: number;
  };

  // 输出验证
  outputValidation?: {
    enabled: boolean;
    schema: JSONSchema;
    fallback: "retry" | "error" | "default";
  };

  // 速率限制
  rateLimit?: {
    enabled: boolean;
    maxCalls: number;
    windowMs: number;
  };

  // 成本控制
  costControl?: {
    enabled: boolean;
    maxTokens: number;
    maxCost: number;
  };
}
```

### 4.3 可观测性增强

```typescript
// 链路追踪
interface ToolTrace {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operationName: string;
  startTime: Date;
  endTime?: Date;
  status: "ok" | "error";
  attributes: Record<string, unknown>;
  events: TraceEvent[];
}

// 集成 OpenTelemetry
class ToolTracer {
  startSpan(name: string, options?: SpanOptions): Span;
  endSpan(span: Span, status: SpanStatus): void;
  recordException(span: Span, error: Error): void;
}
```

---

## 五、文件结构

```
backend/src/modules/ai/ai-agents/
├── core/
│   ├── agent.types.ts           # 更新：新增工具类型
│   ├── tool.interface.ts        # 更新：MCP 支持
│   ├── tool.registry.ts         # 现有
│   ├── mcp-adapter.ts           # 新增：MCP 协议适配
│   ├── guardrails.ts            # 新增：安全护栏
│   └── memory/
│       ├── memory.interface.ts  # 新增：记忆接口
│       ├── short-term.memory.ts # 新增：短期记忆
│       └── long-term.memory.ts  # 新增：长期记忆
├── tools/
│   ├── information/
│   │   ├── web-search.tool.ts   # 现有
│   │   ├── web-scraper.tool.ts  # 现有
│   │   ├── data-fetch.tool.ts   # 现有
│   │   ├── rag-search.tool.ts   # 新增：RAG 检索
│   │   ├── database-query.tool.ts # 新增：数据库查询
│   │   └── knowledge-graph.tool.ts # 新增：知识图谱
│   ├── generation/
│   │   ├── text-generation.tool.ts # 现有
│   │   ├── image-generation.tool.ts # 现有
│   │   ├── code-generation.tool.ts # 现有
│   │   ├── audio-generation.tool.ts # 新增：音频生成
│   │   └── structured-output.tool.ts # 新增：结构化输出
│   ├── processing/
│   │   ├── data-analysis.tool.ts # 现有
│   │   ├── file-conversion.tool.ts # 现有
│   │   ├── file-parser.tool.ts  # 新增：文件解析
│   │   └── ocr-recognition.tool.ts # 新增：OCR
│   ├── export/
│   │   ├── export-pdf.tool.ts   # 现有
│   │   ├── export-docx.tool.ts  # 现有
│   │   ├── export-pptx.tool.ts  # 现有
│   │   └── export-image.tool.ts # 现有
│   ├── execution/
│   │   ├── python-executor.tool.ts # 新增
│   │   ├── javascript-executor.tool.ts # 新增
│   │   └── sql-executor.tool.ts # 新增
│   ├── integration/
│   │   ├── message-push.tool.ts # 新增
│   │   ├── cloud-storage.tool.ts # 新增
│   │   └── github-integration.tool.ts # 新增
│   ├── memory/
│   │   ├── short-term-memory.tool.ts # 新增
│   │   └── long-term-memory.tool.ts # 新增
│   └── collaboration/
│       ├── agent-handoff.tool.ts # 新增
│       └── human-approval.tool.ts # 新增
└── ai-agents.module.ts          # 更新：注册新工具
```

---

## 六、实施计划

### Phase 1: 核心补齐 (4-6 周)

| 周次     | 任务                           | 交付物                                  |
| -------- | ------------------------------ | --------------------------------------- |
| Week 1-2 | RAG 向量检索、文件解析         | rag-search.tool.ts, file-parser.tool.ts |
| Week 3-4 | 记忆系统、Python 执行          | memory/\*.ts, python-executor.tool.ts   |
| Week 5-6 | Agent 委派、人机协作、MCP 适配 | collaboration/\*.ts, mcp-adapter.ts     |

### Phase 2: 体验增强 (4-6 周)

| 周次       | 任务                         | 交付物                           |
| ---------- | ---------------------------- | -------------------------------- |
| Week 7-8   | 数据库查询、结构化输出、OCR  | database-query.tool.ts 等        |
| Week 9-10  | 音频生成、知识图谱、实体记忆 | audio-generation.tool.ts 等      |
| Week 11-12 | 消息推送、云存储、安全护栏   | integration/\*.ts, guardrails.ts |

### Phase 3: 竞争力提升 (4-6 周)

| 周次       | 任务                           | 交付物                           |
| ---------- | ------------------------------ | -------------------------------- |
| Week 13-14 | GitHub 集成、SQL 执行、JS 执行 | github-integration.tool.ts 等    |
| Week 15-16 | 视频生成、用户偏好、共识机制   | video-generation.tool.ts 等      |
| Week 17-18 | 工具热加载、完整 MCP 服务器    | dynamic-loader.ts, mcp-server.ts |

---

## 七、验收标准

### 7.1 功能验收

- [ ] 所有 P0 工具实现并通过单元测试
- [ ] 工具注册和执行流程正常
- [ ] MCP 协议基础适配完成
- [ ] 安全护栏基础功能可用

### 7.2 性能指标

| 指标            | 目标值      |
| --------------- | ----------- |
| RAG 检索延迟    | P95 < 500ms |
| 文件解析速度    | > 10 页/秒  |
| Python 执行启动 | < 2s        |
| 记忆检索延迟    | P95 < 200ms |

### 7.3 质量指标

| 指标       | 目标值 |
| ---------- | ------ |
| 测试覆盖率 | > 80%  |
| 工具成功率 | > 95%  |
| 文档完整性 | 100%   |

---

## 八、风险与依赖

### 8.1 技术风险

| 风险              | 影响         | 缓解措施                  |
| ----------------- | ------------ | ------------------------- |
| pgvector 性能瓶颈 | RAG 检索慢   | 考虑 Milvus/Pinecone 备选 |
| Python 沙箱安全   | 代码执行风险 | 多层隔离 + 白名单         |
| MCP 协议变更      | 适配工作增加 | 抽象适配层                |

### 8.2 外部依赖

| 依赖             | 用途        | 备选方案        |
| ---------------- | ----------- | --------------- |
| OpenAI Embedding | 向量化      | Cohere/本地模型 |
| Redis            | 短期记忆    | PostgreSQL      |
| Docker           | Python 沙箱 | Firecracker     |

---

## 九、参考资料

- [LangChain Tools Documentation](https://python.langchain.com/docs/modules/tools/)
- [OpenAI Agents SDK](https://github.com/openai/openai-agents-python)
- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
- [AutoGen Multi-Agent](https://microsoft.github.io/autogen/)

---

> **文档维护**: 本文档随实施进展持续更新
