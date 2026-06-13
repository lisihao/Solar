# AI Studio 系统性完善方案

## 文档信息

- **版本**: 1.0
- **作者**: PM Agent
- **创建日期**: 2025-12-17
- **状态**: 已评审

---

## 1. 问题分析

### 1.1 用户反馈的核心问题

| 问题编号 | 问题描述                                | 严重程度 | 当前状态               |
| -------- | --------------------------------------- | -------- | ---------------------- |
| P1       | Add Research Sources 不支持本地文件上传 | 高       | 仅支持网络搜索         |
| P2       | Studio Outputs 所有类型都未真正实现     | 严重     | 仅创建记录，无 AI 生成 |
| P3       | 引用格式 `([资料 1, 4])` 不专业         | 中       | 无附录系统、无跳转     |

### 1.2 代码审计发现

**前端 (`frontend/app/ai-studio/[projectId]/page.tsx`)**:

- Add Source Dialog 仅有网络搜索功能，无文件上传 UI
- Output 按钮点击后仅调用 `generateOutput` API，无后续处理
- 引用展示使用简单的 badge，无交互性

**后端 (`backend/src/modules/ai/ai-studio/ai-studio-output.service.ts`)**:

```typescript
// 第 137-139 行的注释揭示了问题
// In a real implementation, this would trigger an async AI generation job
// For now, we'll return the pending output and the client will poll for updates
```

- `generateOutput` 仅创建 `PENDING` 状态记录
- 无实际 AI 生成逻辑
- 无异步任务处理

---

## 2. 文件上传功能设计

### 2.1 支持的文件格式

| 格式       | 扩展名                  | 解析方案                      | 优先级 |
| ---------- | ----------------------- | ----------------------------- | ------ |
| PDF        | `.pdf`                  | pdf-parse / @react-pdf-viewer | P0     |
| Word       | `.docx`, `.doc`         | mammoth.js                    | P0     |
| 纯文本     | `.txt`, `.md`           | 直接读取                      | P0     |
| 图片       | `.png`, `.jpg`, `.jpeg` | GPT-4V / Claude Vision OCR    | P1     |
| PowerPoint | `.pptx`                 | pptx-parser                   | P2     |
| Excel      | `.xlsx`                 | xlsx / exceljs                | P2     |
| 音频       | `.mp3`, `.wav`          | Whisper API 转录              | P2     |
| 视频       | `.mp4`                  | 抽帧 + Whisper 转录           | P3     |

### 2.2 上传流程 UI 设计

```
+--------------------------------------------------+
|  Add Research Sources                        [X] |
+--------------------------------------------------+
|                                                  |
|  +------------+  +------------+  +------------+  |
|  | [网络搜索] |  | [上传文件] |  | [粘贴链接] |  |
|  +------------+  +------------+  +------------+  |
|                                                  |
|  ┌────────────────────────────────────────────┐  |
|  │                                            │  |
|  │    [拖拽文件到此处]                         │  |
|  │                                            │  |
|  │    或 点击选择文件                          │  |
|  │                                            │  |
|  │    支持 PDF, Word, TXT, MD, 图片            │  |
|  │    最大 50MB / 文件                         │  |
|  │                                            │  |
|  └────────────────────────────────────────────┘  |
|                                                  |
|  已选择文件:                                     |
|  ┌─────────────────────────────────────────┐    |
|  │ [PDF] research-paper.pdf    12.3MB  [X] │    |
|  │ [DOC] meeting-notes.docx    1.2MB   [X] │    |
|  └─────────────────────────────────────────┘    |
|                                                  |
|                              [取消]  [上传并解析] |
+--------------------------------------------------+
```

### 2.3 前端组件设计

```typescript
// frontend/components/ai-studio/FileUploader.tsx

interface FileUploaderProps {
  projectId: string;
  onFilesUploaded: (sources: Source[]) => void;
  onError: (error: string) => void;
  maxFileSize?: number; // bytes, default 50MB
  acceptedTypes?: string[];
}

interface UploadProgress {
  fileId: string;
  fileName: string;
  progress: number; // 0-100
  status: 'uploading' | 'parsing' | 'completed' | 'failed';
  error?: string;
}

const FileUploader: React.FC<FileUploaderProps> = ({
  projectId,
  onFilesUploaded,
  onError,
  maxFileSize = 50 * 1024 * 1024,
  acceptedTypes = ['.pdf', '.docx', '.doc', '.txt', '.md', '.png', '.jpg', '.jpeg']
}) => {
  const [files, setFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // 拖拽处理
  const handleDrop = (e: DragEvent) => { ... };

  // 文件选择
  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => { ... };

  // 上传处理
  const handleUpload = async () => { ... };

  return (...);
};
```

### 2.4 后端 API 设计

```typescript
// POST /api/v1/ai-studio/projects/:projectId/sources/upload

// 请求: multipart/form-data
interface UploadFileRequest {
  files: File[]; // 多文件上传
}

// 响应
interface UploadFileResponse {
  sources: Array<{
    id: string;
    title: string;
    sourceType: "pdf" | "word" | "text" | "image";
    status: "PENDING" | "PARSING" | "COMPLETED" | "FAILED";
    content?: string;
    metadata: {
      fileName: string;
      fileSize: number;
      mimeType: string;
      pageCount?: number; // PDF
      wordCount?: number;
    };
  }>;
  errors?: Array<{
    fileName: string;
    error: string;
  }>;
}
```

### 2.5 文件解析服务设计

```typescript
// backend/src/modules/ai/ai-studio/services/file-parser.service.ts

interface ParsedFile {
  title: string;
  content: string;
  abstract?: string;
  metadata: {
    pageCount?: number;
    wordCount?: number;
    author?: string;
    createdAt?: Date;
    language?: string;
  };
}

interface FileParser {
  canParse(mimeType: string, extension: string): boolean;
  parse(buffer: Buffer, fileName: string): Promise<ParsedFile>;
}

// 具体实现
class PdfParser implements FileParser { ... }
class WordParser implements FileParser { ... }
class TextParser implements FileParser { ... }
class ImageParser implements FileParser { ... }  // 使用 Vision AI

// 解析服务
@Injectable()
export class FileParserService {
  private parsers: FileParser[] = [
    new PdfParser(),
    new WordParser(),
    new TextParser(),
    new ImageParser(this.aiService),
  ];

  async parseFile(file: Express.Multer.File): Promise<ParsedFile> {
    const parser = this.parsers.find(p =>
      p.canParse(file.mimetype, path.extname(file.originalname))
    );

    if (!parser) {
      throw new UnsupportedFileTypeError(file.mimetype);
    }

    return parser.parse(file.buffer, file.originalname);
  }
}
```

---

## 3. Outputs 功能实现方案

### 3.1 Output 类型详细规格

#### 3.1.1 Study Guide (学习指南)

**输出结构**:

```json
{
  "title": "Study Guide: [主题]",
  "sections": [
    {
      "title": "Key Concepts",
      "content": "...",
      "keyTerms": [{ "term": "概念1", "definition": "定义..." }]
    },
    {
      "title": "Learning Objectives",
      "objectives": ["目标1", "目标2"]
    },
    {
      "title": "Summary",
      "content": "..."
    },
    {
      "title": "Review Questions",
      "questions": [{ "question": "问题1?", "answer": "答案1" }]
    }
  ],
  "citations": ["source-id-1", "source-id-2"]
}
```

**Prompt 模板**:

```
You are an expert educational content creator. Based on the provided research sources, create a comprehensive study guide.

The study guide should include:
1. Key Concepts - Main ideas and terminology with clear definitions
2. Learning Objectives - What the reader should understand after studying
3. Detailed Summary - Synthesized content from all sources
4. Review Questions - 5-10 questions with answers to test understanding

Format your response as structured JSON matching this schema:
{schema}

Sources:
{sources}
```

#### 3.1.2 Briefing Doc (简报文档)

**输出结构**:

```json
{
  "title": "Executive Briefing: [主题]",
  "executiveSummary": "...",
  "keyFindings": [
    { "finding": "发现1", "importance": "high", "sourceRef": "source-id" }
  ],
  "recommendations": [
    { "action": "建议1", "priority": "high", "rationale": "..." }
  ],
  "risks": [
    { "risk": "风险1", "likelihood": "medium", "impact": "high" }
  ],
  "nextSteps": ["步骤1", "步骤2"],
  "citations": [...]
}
```

#### 3.1.3 FAQ (常见问题)

**输出结构**:

```json
{
  "title": "FAQ: [主题]",
  "categories": [
    {
      "name": "基础概念",
      "questions": [
        {
          "question": "什么是...?",
          "answer": "...",
          "sourceRefs": ["source-id-1"]
        }
      ]
    }
  ],
  "citations": [...]
}
```

#### 3.1.4 Timeline (时间线)

**输出结构**:

```json
{
  "title": "Timeline: [主题]",
  "events": [
    {
      "date": "2023-01-15",
      "title": "事件标题",
      "description": "事件描述",
      "importance": "major" | "minor",
      "sourceRef": "source-id"
    }
  ],
  "periods": [
    {
      "startDate": "2020-01",
      "endDate": "2023-12",
      "name": "发展期",
      "description": "..."
    }
  ],
  "citations": [...]
}
```

#### 3.1.5 Audio Overview (音频概述)

**输出结构**:

```json
{
  "title": "Audio Overview: [主题]",
  "script": {
    "segments": [
      {
        "speaker": "Host1" | "Host2",
        "text": "对话内容...",
        "emotion": "neutral" | "excited" | "thoughtful"
      }
    ],
    "duration": "estimated 10 minutes"
  },
  "audioUrl": "https://...",  // 生成后填充
  "transcript": [...],
  "citations": [...]
}
```

**实现方案 (分阶段)**:

- **Phase 1**: 仅生成脚本 (Markdown 格式的对话)
- **Phase 2**: 集成 TTS (ElevenLabs / Azure TTS)
- **Phase 3**: 双声音对话合成

#### 3.1.6 Trend Report (趋势报告)

**输出结构**:

```json
{
  "title": "Trend Report: [主题]",
  "overview": "...",
  "trends": [
    {
      "name": "趋势1",
      "description": "...",
      "direction": "rising" | "stable" | "declining",
      "confidence": 0.85,
      "evidence": ["证据1", "证据2"],
      "sourceRefs": [...]
    }
  ],
  "predictions": [
    {
      "prediction": "预测内容",
      "timeframe": "2024-2025",
      "probability": "high" | "medium" | "low"
    }
  ],
  "recommendations": [...],
  "citations": [...]
}
```

#### 3.1.7 Comparison (对比分析)

**输出结构**:

```json
{
  "title": "Comparison: [对象A] vs [对象B]",
  "subjects": ["对象A", "对象B", "对象C"],
  "dimensions": [
    {
      "name": "性能",
      "values": {
        "对象A": { "value": "高", "notes": "..." },
        "对象B": { "value": "中", "notes": "..." }
      }
    }
  ],
  "summary": {
    "winner": "对象A",
    "rationale": "...",
    "useCase": {
      "对象A": "适用于...",
      "对象B": "适用于..."
    }
  },
  "citations": [...]
}
```

#### 3.1.8 Knowledge Graph (知识图谱)

**输出结构**:

```json
{
  "title": "Knowledge Graph: [主题]",
  "nodes": [
    {
      "id": "node-1",
      "label": "概念1",
      "type": "concept" | "entity" | "event" | "person",
      "description": "...",
      "sourceRefs": [...]
    }
  ],
  "edges": [
    {
      "source": "node-1",
      "target": "node-2",
      "relationship": "is-a" | "has" | "causes" | "related-to",
      "label": "关系描述"
    }
  ],
  "clusters": [
    {
      "name": "技术类",
      "nodeIds": ["node-1", "node-2"]
    }
  ],
  "citations": [...]
}
```

### 3.2 后端实现改进

```typescript
// backend/src/modules/ai/ai-studio/ai-studio-output.service.ts

import { Injectable } from '@nestjs/common';
import { Queue } from 'bull';
import { InjectQueue } from '@nestjs/bull';

@Injectable()
export class AiStudioOutputService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    @InjectQueue('output-generation') private outputQueue: Queue,
  ) {}

  async generateOutput(userId: string, projectId: string, dto: GenerateOutputDto) {
    // ... 现有验证逻辑 ...

    // 创建 output 记录
    const output = await this.prisma.researchProjectOutput.create({
      data: {
        projectId,
        type: dto.type,
        title,
        status: 'GENERATING',  // 直接设为 GENERATING
        metadata: { ... },
      },
    });

    // 加入异步队列
    await this.outputQueue.add('generate', {
      outputId: output.id,
      type: dto.type,
      sourceIds: sources.map(s => s.id),
      options: dto.options,
      userId,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });

    return { output, config, sourceCount: sources.length };
  }
}

// backend/src/modules/ai/ai-studio/processors/output-generation.processor.ts

@Processor('output-generation')
export class OutputGenerationProcessor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    private readonly outputService: AiStudioOutputService,
  ) {}

  @Process('generate')
  async handleGenerate(job: Job<OutputGenerationJob>) {
    const { outputId, type, sourceIds, options } = job.data;

    try {
      // 1. 获取源内容
      const sources = await this.prisma.researchProjectSource.findMany({
        where: { id: { in: sourceIds } },
      });

      // 2. 构建上下文
      const context = this.buildContext(sources);

      // 3. 获取 prompt 模板
      const prompt = this.getPromptForType(type, options);

      // 4. 调用 AI 生成
      const result = await this.aiService.chat({
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user + '\n\n' + context },
        ],
        model: options?.model || 'gpt-4-turbo',
        responseFormat: { type: 'json_object' },
      });

      // 5. 解析和验证结果
      const content = JSON.parse(result.content);

      // 6. 更新状态
      await this.outputService.updateOutput(
        outputId,
        'COMPLETED',
        JSON.stringify(content),
        undefined,
        result.usage?.totalTokens,
      );

    } catch (error) {
      await this.outputService.updateOutput(
        outputId,
        'FAILED',
        undefined,
        error.message,
      );
      throw error;
    }
  }

  private getPromptForType(type: string, options: any): { system: string; user: string } {
    const prompts: Record<string, { system: string; user: string }> = {
      STUDY_GUIDE: {
        system: `You are an expert educational content creator...`,
        user: `Create a comprehensive study guide based on the following sources...`,
      },
      BRIEFING_DOC: {
        system: `You are an executive briefing specialist...`,
        user: `Create an executive briefing document...`,
      },
      // ... 其他类型
    };
    return prompts[type] || prompts.CUSTOM;
  }
}
```

### 3.3 前端展示组件设计

```typescript
// frontend/components/ai-studio/outputs/OutputViewer.tsx

interface OutputViewerProps {
  output: Output;
  onRegenerate: () => void;
  onExport: (format: 'pdf' | 'markdown' | 'json') => void;
}

const OutputViewer: React.FC<OutputViewerProps> = ({ output, onRegenerate, onExport }) => {
  const renderContent = () => {
    if (output.status === 'GENERATING') {
      return <GeneratingIndicator />;
    }
    if (output.status === 'FAILED') {
      return <ErrorDisplay error={output.error} onRetry={onRegenerate} />;
    }

    const content = JSON.parse(output.content);

    switch (output.type) {
      case 'STUDY_GUIDE':
        return <StudyGuideView data={content} />;
      case 'BRIEFING_DOC':
        return <BriefingDocView data={content} />;
      case 'FAQ':
        return <FAQView data={content} />;
      case 'TIMELINE':
        return <TimelineView data={content} />;
      case 'AUDIO_OVERVIEW':
        return <AudioOverviewView data={content} />;
      case 'TREND_REPORT':
        return <TrendReportView data={content} />;
      case 'COMPARISON':
        return <ComparisonView data={content} />;
      case 'KNOWLEDGE_GRAPH':
        return <KnowledgeGraphView data={content} />;
      default:
        return <RawContentView content={content} />;
    }
  };

  return (
    <div className="output-viewer">
      <div className="output-header">
        <h2>{output.title}</h2>
        <div className="output-actions">
          <button onClick={onRegenerate}>Regenerate</button>
          <button onClick={() => onExport('pdf')}>Export PDF</button>
          <button onClick={() => onExport('markdown')}>Export MD</button>
        </div>
      </div>
      <div className="output-content">
        {renderContent()}
      </div>
    </div>
  );
};
```

### 3.4 实现优先级排序

| 优先级 | Output 类型           | 复杂度 | 预估工时 | 依赖     |
| ------ | --------------------- | ------ | -------- | -------- |
| P0     | FAQ                   | 低     | 2d       | 无       |
| P0     | Study Guide           | 低     | 2d       | 无       |
| P0     | Briefing Doc          | 低     | 2d       | 无       |
| P1     | Timeline              | 中     | 3d       | 时间解析 |
| P1     | Comparison            | 中     | 3d       | 矩阵渲染 |
| P1     | Trend Report          | 中     | 3d       | 图表组件 |
| P2     | Knowledge Graph       | 高     | 5d       | D3.js    |
| P2     | Audio Overview (脚本) | 中     | 3d       | 无       |
| P3     | Audio Overview (音频) | 高     | 10d      | TTS 集成 |

---

## 4. 引用系统改进方案

### 4.1 当前问题分析

**现状**:

- 引用格式: `([资料 1, 4])` - 不专业、不可点击
- 无附录编号系统
- 无跳转/高亮功能
- 引用和源之间无明确映射

**目标 (参考 NotebookLM)**:

- 引用格式: `[1]`, `[2]` 上标样式
- 每个引用对应具体的源段落
- 点击引用跳转到源内容
- 源内容有清晰的编号

### 4.2 NotebookLM 风格引用设计

```
用户问题: "LLM 推理优化有哪些方法?"

AI 回答:
┌──────────────────────────────────────────────────────────────────┐
│  大语言模型推理优化主要包括以下几个方向：                              │
│                                                                  │
│  1. **量化 (Quantization)**: 将模型权重从 FP32 降低到 INT8 或      │
│     INT4，可以减少内存占用并加速推理[1][3]。                         │
│                                                                  │
│  2. **知识蒸馏 (Knowledge Distillation)**: 用大模型训练小模型，     │
│     保持性能的同时降低计算成本[2]。                                  │
│                                                                  │
│  3. **推测解码 (Speculative Decoding)**: 使用小模型生成草稿，       │
│     大模型验证，提高吞吐量[1][4]。                                  │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│  Sources:                                                        │
│  [1] LLM Inference Optimization Survey (Zhang et al., 2024)      │
│  [2] DistilBERT Paper (Sanh et al., 2019)                        │
│  [3] GPTQ: Quantization for Transformers                         │
│  [4] Speculative Decoding: Exploiting ...                        │
└──────────────────────────────────────────────────────────────────┘
```

### 4.3 数据模型改进

```typescript
// 引用结构
interface Citation {
  id: string; // 引用 ID
  index: number; // 显示编号 [1], [2], ...
  sourceId: string; // 关联的源 ID
  snippet: string; // 引用的具体段落
  startOffset?: number; // 段落在源中的起始位置
  endOffset?: number; // 段落在源中的结束位置
}

// 消息结构扩展
interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[]; // 改为完整的引用对象数组
  timestamp: string;
}
```

### 4.4 后端改进

````typescript
// backend/src/modules/ai/ai-studio/ai-studio-chat.service.ts

async sendMessage(userId: string, projectId: string, dto: SendChatMessageDto) {
  // ... 获取源内容 ...

  // AI 生成时要求返回结构化引用
  const systemPrompt = `
You are a research assistant. Answer questions based on the provided sources.

IMPORTANT: When citing sources, use the format [n] where n is the source number.
After your answer, provide a JSON block with citation details:

\`\`\`citations
[
  { "index": 1, "sourceId": "source-id", "snippet": "exact quoted text from source" }
]
\`\`\`
`;

  const result = await this.aiService.chat({
    messages: [...],
    model: dto.model,
  });

  // 解析引用
  const { content, citations } = this.parseCitations(result.content, sources);

  // 保存消息
  const aiMessage = await this.prisma.researchProjectMessage.create({
    data: {
      chatId: chat.id,
      role: 'assistant',
      content,
      citations: citations as any,
    },
  });

  return { userMessage, aiMessage };
}

private parseCitations(
  content: string,
  sources: Source[]
): { content: string; citations: Citation[] } {
  // 1. 提取 citations JSON 块
  const citationMatch = content.match(/```citations\n([\s\S]*?)\n```/);
  let citations: Citation[] = [];

  if (citationMatch) {
    try {
      const rawCitations = JSON.parse(citationMatch[1]);
      citations = rawCitations.map((c: any, i: number) => ({
        id: `cite-${i}`,
        index: c.index,
        sourceId: c.sourceId,
        snippet: c.snippet,
      }));
    } catch (e) {
      console.error('Failed to parse citations:', e);
    }
  }

  // 2. 移除 citations 块
  const cleanContent = content.replace(/```citations[\s\S]*?```/, '').trim();

  return { content: cleanContent, citations };
}
````

### 4.5 前端引用组件

```typescript
// frontend/components/ai-studio/CitationLink.tsx

interface CitationLinkProps {
  citation: Citation;
  sources: Source[];
  onSourceClick: (sourceId: string, snippet: string) => void;
}

const CitationLink: React.FC<CitationLinkProps> = ({
  citation,
  sources,
  onSourceClick,
}) => {
  const source = sources.find(s => s.id === citation.sourceId);
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <span className="citation-wrapper">
      <sup
        className="citation-link"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onClick={() => onSourceClick(citation.sourceId, citation.snippet)}
      >
        [{citation.index}]
      </sup>
      {showTooltip && (
        <div className="citation-tooltip">
          <div className="tooltip-title">{source?.title}</div>
          <div className="tooltip-snippet">"{citation.snippet}"</div>
        </div>
      )}
    </span>
  );
};

// CSS
.citation-link {
  color: #7C3AED;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.2s;
}

.citation-link:hover {
  color: #5B21B6;
  text-decoration: underline;
}

.citation-tooltip {
  position: absolute;
  background: white;
  border: 1px solid #E5E7EB;
  border-radius: 8px;
  padding: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  max-width: 300px;
  z-index: 100;
}

.tooltip-title {
  font-weight: 600;
  margin-bottom: 4px;
}

.tooltip-snippet {
  font-size: 0.875rem;
  color: #6B7280;
  font-style: italic;
}
```

### 4.6 源面板高亮跳转

```typescript
// frontend/components/ai-studio/SourcesPanel.tsx

const SourcesPanel: React.FC<SourcesPanelProps> = ({
  sources,
  highlightedSourceId,
  highlightedSnippet,
  ...
}) => {
  const sourceRefs = useRef<Record<string, HTMLDivElement>>({});

  // 滚动到高亮的源
  useEffect(() => {
    if (highlightedSourceId && sourceRefs.current[highlightedSourceId]) {
      sourceRefs.current[highlightedSourceId].scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [highlightedSourceId]);

  return (
    <div className="sources-panel">
      {sources.map((source, index) => (
        <div
          key={source.id}
          ref={el => { if (el) sourceRefs.current[source.id] = el; }}
          className={`source-item ${
            highlightedSourceId === source.id ? 'highlighted' : ''
          }`}
        >
          <div className="source-index">[{index + 1}]</div>
          <div className="source-content">
            <h4>{source.title}</h4>
            <HighlightedContent
              content={source.content || source.abstract || ''}
              highlight={
                highlightedSourceId === source.id ? highlightedSnippet : undefined
              }
            />
          </div>
        </div>
      ))}
    </div>
  );
};

// 高亮组件
const HighlightedContent: React.FC<{
  content: string;
  highlight?: string;
}> = ({ content, highlight }) => {
  if (!highlight) {
    return <p>{content}</p>;
  }

  const parts = content.split(new RegExp(`(${escapeRegex(highlight)})`, 'gi'));

  return (
    <p>
      {parts.map((part, i) =>
        part.toLowerCase() === highlight.toLowerCase() ? (
          <mark key={i} className="highlight">{part}</mark>
        ) : (
          part
        )
      )}
    </p>
  );
};
```

---

## 5. 实施路线图

### 5.1 Phase 1: 核心功能修复 (1-2 周)

| 任务                      | 工时 | 优先级 | 产出            |
| ------------------------- | ---- | ------ | --------------- |
| 实现 Output 异步生成队列  | 2d   | P0     | Bull 队列集成   |
| 实现 FAQ 生成             | 1d   | P0     | FAQ 输出可用    |
| 实现 Study Guide 生成     | 1d   | P0     | 学习指南可用    |
| 实现 Briefing Doc 生成    | 1d   | P0     | 简报文档可用    |
| Output 状态轮询/WebSocket | 1d   | P0     | 实时状态更新    |
| Output 展示组件           | 2d   | P0     | 3 种输出类型 UI |

**里程碑**: 基础 Output 功能可用

### 5.2 Phase 2: 文件上传 (1 周)

| 任务              | 工时 | 优先级 | 产出          |
| ----------------- | ---- | ------ | ------------- |
| 文件上传 API 端点 | 1d   | P0     | 上传接口      |
| PDF 解析服务      | 1d   | P0     | PDF 内容提取  |
| Word 解析服务     | 0.5d | P0     | Word 内容提取 |
| 文本/MD 解析      | 0.5d | P0     | 纯文本支持    |
| 前端上传组件      | 2d   | P0     | 拖拽上传 UI   |

**里程碑**: 文件上传功能可用

### 5.3 Phase 3: 引用系统改进 (1 周)

| 任务             | 工时 | 优先级 | 产出         |
| ---------------- | ---- | ------ | ------------ |
| 引用数据模型改进 | 0.5d | P1     | 结构化引用   |
| AI 引用提取逻辑  | 1d   | P1     | 自动引用解析 |
| 前端引用组件     | 1.5d | P1     | 可点击引用   |
| 源面板高亮跳转   | 1d   | P1     | 跳转高亮     |

**里程碑**: NotebookLM 风格引用

### 5.4 Phase 4: 高级输出 (2 周)

| 任务                 | 工时 | 优先级 | 产出       |
| -------------------- | ---- | ------ | ---------- |
| Timeline 生成        | 2d   | P1     | 时间线输出 |
| Comparison 生成      | 2d   | P1     | 对比分析   |
| Trend Report 生成    | 2d   | P1     | 趋势报告   |
| Knowledge Graph 生成 | 3d   | P2     | 知识图谱   |
| Audio Overview 脚本  | 2d   | P2     | 播客脚本   |

**里程碑**: 所有输出类型可用

### 5.5 Phase 5: 体验优化 (1 周)

| 任务         | 工时 | 优先级 | 产出           |
| ------------ | ---- | ------ | -------------- |
| 输出导出功能 | 2d   | P2     | PDF/MD 导出    |
| 图片源支持   | 2d   | P2     | Vision AI 解析 |
| 移动端适配   | 2d   | P2     | 响应式布局     |

**里程碑**: 完整用户体验

---

## 6. 技术依赖

### 6.1 新增依赖包

**后端**:

```json
{
  "dependencies": {
    "@nestjs/bull": "^0.6.x",
    "bull": "^4.x",
    "pdf-parse": "^1.1.x",
    "mammoth": "^1.6.x",
    "multer": "^1.4.x"
  }
}
```

**前端**:

```json
{
  "dependencies": {
    "react-dropzone": "^14.x",
    "@react-pdf-viewer/core": "^3.x"
  }
}
```

### 6.2 基础设施

- **Redis**: 用于 Bull 队列 (已部署)
- **文件存储**: 使用现有 MinIO/S3

---

## 7. 验收标准

### 7.1 文件上传

- [ ] 可拖拽上传 PDF 文件
- [ ] 可拖拽上传 Word 文件
- [ ] 可拖拽上传 TXT/MD 文件
- [ ] 显示上传和解析进度
- [ ] 解析后自动添加为 Source
- [ ] 错误处理和提示

### 7.2 Output 生成

- [ ] 点击 Output 按钮立即开始生成
- [ ] 显示生成进度状态
- [ ] 生成完成后展示结构化内容
- [ ] 支持重新生成
- [ ] 支持导出 PDF/Markdown
- [ ] 每种类型有专属展示组件

### 7.3 引用系统

- [ ] 引用格式为 `[1]`, `[2]` 上标
- [ ] Hover 显示引用预览
- [ ] 点击跳转到源面板
- [ ] 源内容高亮引用段落
- [ ] 消息底部显示源列表

---

## 8. 风险与缓解

| 风险              | 影响 | 概率 | 缓解措施                        |
| ----------------- | ---- | ---- | ------------------------------- |
| AI 生成质量不稳定 | 高   | 中   | 优化 Prompt、添加重试机制       |
| 文件解析失败      | 中   | 中   | 多解析器 fallback、清晰错误提示 |
| 队列积压          | 中   | 低   | 限流、优先级队列                |
| 大文件超时        | 中   | 中   | 分块处理、进度反馈              |

---

## 9. 变更记录

| 版本 | 日期       | 变更内容 | 作者     |
| ---- | ---------- | -------- | -------- |
| 1.0  | 2025-12-17 | 初始版本 | PM Agent |
