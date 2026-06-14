# AI Office 系统设计与任务划分

**版本**: v1.0
**日期**: 2025-11-15
**基于**: AI Office UI设计方案 - 三栏布局 v3.0

---

## 一、技术选型：Open Genspark vs 从零开发

### 1.1 Open Genspark 分析

**Open Genspark 现有能力**:

```
✓ PPT生成功能 (基于AI)
✓ 多AI模型支持架构
✓ Next.js全栈框架
✓ Vercel AI SDK集成
✓ 流式输出支持
✓ SuperAgent工具调用
```

**技术栈**:

```javascript
{
  framework: 'Next.js 14',
  ai: 'Vercel AI SDK',
  models: ['Gemini 1.5 Pro', '可扩展'],
  deployment: 'Vercel',
  ppt: 'Custom PPT Generator'
}
```

### 1.2 需求对比分析

| 功能需求       | Open Genspark | 我们的需求        | 匹配度    |
| -------------- | ------------- | ----------------- | --------- |
| **UI布局**     | 单页式        | 三栏布局          | ❌ 不匹配 |
| **PPT生成**    | ✓ 已实现      | ✓ 需要            | ✅ 可复用 |
| **Word生成**   | ✗ 无          | ✓ 核心功能        | ❌ 需开发 |
| **Excel生成**  | ✗ 无          | ✓ 核心功能        | ❌ 需开发 |
| **数据源管理** | 简单          | 复杂(多源+去重)   | ⚠️ 需重构 |
| **资源列表**   | ✗ 无          | ✓ 核心UI          | ❌ 需开发 |
| **AI交互**     | 基础对话      | 高级交互(@引用等) | ⚠️ 需增强 |
| **多AI模型**   | ✓ 支持        | ✓ 需要            | ✅ 可复用 |
| **模板系统**   | ✗ 无          | ✓ 核心功能        | ❌ 需开发 |

### 1.3 最终技术决策

**决策**: **借鉴技术栈，从零开发核心功能**

**理由**:

1. **UI架构完全不同**: Open Genspark是单页式，我们需要复杂的三栏布局
2. **功能范围扩大**: Word、Excel、数据源管理都需要重新开发
3. **代码复用成本高**: 大幅改造可能比重写还复杂
4. **灵活性**: 从零开发可以完全按我们的架构设计

**借鉴内容**:

- ✅ 技术栈选型 (Next.js + Vercel AI SDK)
- ✅ PPT生成的部分实现思路
- ✅ 多AI模型管理架构
- ✅ 流式输出实现方式

**独立开发**:

- ❌ 三栏布局UI框架
- ❌ Word、Excel生成引擎
- ❌ 数据源管理系统
- ❌ 资源+AI交互中间栏
- ❌ 模板系统

---

## 二、系统架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        用户界面层                            │
│              Next.js 14 + React 18 + Tailwind CSS           │
│  ┌──────────┬────────────────────┬───────────────────────┐  │
│  │ 左侧菜单 │  中间栏(资源+AI)   │   右侧文档编辑器      │  │
│  │ Sidebar  │  Resource + Chat   │   Document Editor     │  │
│  └──────────┴────────────────────┴───────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                      应用逻辑层 (BLL)                        │
│  ┌────────────┬──────────────┬─────────────┬─────────────┐ │
│  │ Document   │ Data         │ AI          │ Template    │ │
│  │ Generator  │ Collector    │ Processor   │ Engine      │ │
│  └────────────┴──────────────┴─────────────┴─────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                      API路由层 (Next.js API Routes)         │
│  /api/documents  /api/resources  /api/ai  /api/templates   │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                      服务层 (Services)                       │
│  ┌────────────┬──────────────┬─────────────┬─────────────┐ │
│  │ AI Service │ Storage      │ Cache       │ Queue       │ │
│  │ (多模型)   │ (S3/R2)      │ (Redis)     │ (Bull)      │ │
│  └────────────┴──────────────┴─────────────┴─────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                      数据访问层 (DAL)                        │
│              PostgreSQL 16 (Prisma + JSONB) + Redis        │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                      外部服务层                              │
│  OpenAI API │ Anthropic API │ YouTube API │ arXiv API      │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 前端架构设计

```typescript
// 项目结构
ai-office/
├── app/                          # Next.js 14 App Router
│   ├── layout.tsx               # 根布局
│   ├── page.tsx                 # 首页(工作台)
│   ├── documents/               # AI文档
│   │   ├── new/
│   │   │   └── page.tsx        # 新建文档页面(三栏布局)
│   │   └── [id]/
│   │       └── page.tsx        # 编辑文档页面
│   ├── spreadsheets/           # AI表格
│   ├── presentations/          # AI演示
│   ├── templates/              # 模板中心
│   └── api/                    # API路由
│       ├── documents/
│       ├── resources/
│       ├── ai/
│       └── templates/
│
├── components/                  # React组件
│   ├── layout/
│   │   ├── ThreeColumnLayout.tsx    # 三栏布局组件
│   │   ├── LeftSidebar.tsx          # 左侧菜单
│   │   ├── MiddlePanel.tsx          # 中间栏容器
│   │   └── RightPanel.tsx           # 右侧文档区
│   │
│   ├── resources/
│   │   ├── ResourceList.tsx         # 资源列表
│   │   ├── ResourceCard.tsx         # 资源卡片
│   │   ├── ResourceDetail.tsx       # 资源详情
│   │   └── AddResourceDialog.tsx    # 添加资源对话框
│   │
│   ├── ai-chat/
│   │   ├── ChatPanel.tsx            # AI交互面板
│   │   ├── ChatMessage.tsx          # 消息组件
│   │   ├── ChatInput.tsx            # 输入框
│   │   ├── MentionPicker.tsx        # @资源选择器
│   │   └── QuickActions.tsx         # 快捷操作
│   │
│   ├── editors/
│   │   ├── WordEditor.tsx           # Word编辑器
│   │   ├── ExcelEditor.tsx          # Excel编辑器
│   │   ├── PPTEditor.tsx            # PPT编辑器
│   │   └── AIGeneratedContent.tsx   # AI生成内容组件
│   │
│   └── templates/
│       ├── TemplateGallery.tsx
│       └── TemplateCard.tsx
│
├── lib/                         # 业务逻辑库
│   ├── generators/
│   │   ├── word-generator.ts        # Word文档生成器
│   │   ├── excel-generator.ts       # Excel生成器
│   │   └── ppt-generator.ts         # PPT生成器(借鉴Open Genspark)
│   │
│   ├── collectors/
│   │   ├── youtube-collector.ts     # YouTube数据采集
│   │   ├── paper-collector.ts       # 论文采集
│   │   └── web-collector.ts         # 网页采集
│   │
│   ├── ai/
│   │   ├── model-manager.ts         # AI模型管理
│   │   ├── router.ts                # 智能路由
│   │   ├── streaming.ts             # 流式输出
│   │   └── providers/
│   │       ├── openai.ts
│   │       ├── anthropic.ts
│   │       └── google.ts
│   │
│   ├── templates/
│   │   ├── template-engine.ts
│   │   └── template-manager.ts
│   │
│   └── utils/
│       ├── deduplication.ts         # 去重逻辑
│       ├── quality-control.ts       # 质量控制
│       └── cache.ts
│
├── hooks/                       # React Hooks
│   ├── useResources.ts          # 资源管理
│   ├── useAIChat.ts            # AI对话
│   ├── useDocumentEditor.ts    # 文档编辑
│   └── useMiddlePanelResize.ts # 中间栏调节
│
├── store/                       # 状态管理 (Zustand)
│   ├── documentStore.ts
│   ├── resourceStore.ts
│   ├── chatStore.ts
│   └── uiStore.ts              # UI状态(折叠、宽度等)
│
└── types/                       # TypeScript类型定义
    ├── document.ts
    ├── resource.ts
    ├── template.ts
    └── api.ts
```

### 2.3 关键技术选型

| 层级           | 技术选择                 | 理由                                |
| -------------- | ------------------------ | ----------------------------------- |
| **框架**       | Next.js 14 (App Router)  | SSR支持、API Routes、优秀的开发体验 |
| **UI库**       | React 18                 | 成熟的生态、良好的性能              |
| **样式**       | Tailwind CSS + shadcn/ui | 快速开发、一致的设计系统            |
| **状态管理**   | Zustand                  | 轻量、简单、TypeScript友好          |
| **编辑器**     | TipTap (Word)            | 强大的富文本编辑器，基于ProseMirror |
| **编辑器**     | Handsontable (Excel)     | 功能完整的表格编辑器                |
| **编辑器**     | Fabric.js (PPT)          | Canvas图形编辑，参考Open Genspark   |
| **AI SDK**     | Vercel AI SDK            | 统一的AI接口，流式输出支持          |
| **文档生成**   | docx (Word)              | 成熟的Word生成库                    |
| **表格生成**   | exceljs (Excel)          | 功能完整的Excel库                   |
| **PPT生成**    | pptxgenjs                | 简单易用的PPT生成库                 |
| **HTTP客户端** | axios                    | 成熟可靠                            |
| **实时通信**   | WebSocket (Socket.io)    | AI流式输出、实时协作                |

---

## 三、数据库设计

### 3.1 PostgreSQL 数据模型设计

#### 3.1.1 用户集合 (users)

```typescript
{
  _id: ObjectId,
  email: string,
  name: string,
  avatar?: string,
  preferences: {
    defaultAIModel: string,
    middlePanelWidth: number,
    resourceListCollapsed: boolean,
    language: 'zh-CN' | 'en-US'
  },
  subscription: {
    plan: 'free' | 'personal' | 'pro' | 'team',
    validUntil?: Date,
    usageQuota: {
      documentsPerMonth: number,
      resourcesPerMonth: number,
      aiCalls: number
    }
  },
  createdAt: Date,
  updatedAt: Date
}
```

#### 3.1.2 文档集合 (documents)

```typescript
{
  _id: ObjectId,
  userId: ObjectId,
  type: 'word' | 'excel' | 'ppt',
  title: string,
  status: 'draft' | 'generating' | 'completed' | 'failed',

  // 关联的资源
  resources: [
    {
      resourceRef: {
        type: 'youtube_video' | 'academic_paper' | 'web_page',
        collection: string,  // resource_youtube, resource_papers等
        id: ObjectId
      }
    }
  ],

  // 使用的模板
  template?: {
    id: ObjectId,
    version: string
  },

  // AI配置
  aiConfig: {
    model: string,           // 'gpt-4-turbo', 'claude-3-sonnet'等
    language: string,
    detailLevel: number,     // 1-5
    professionalLevel: number // 1-5
  },

  // 文档内容 (根据type不同，结构不同)
  content: {
    // Word
    sections?: [
      {
        id: string,
        type: 'heading' | 'paragraph' | 'list' | 'table',
        content: string,
        aiGenerated: boolean,
        sourceResources?: [ObjectId]
      }
    ],

    // Excel
    sheets?: [
      {
        name: string,
        data: any[][],
        charts?: any[]
      }
    ],

    // PPT
    slides?: [
      {
        layout: string,
        elements: any[]
      }
    ]
  },

  // 生成历史
  generationHistory: [
    {
      timestamp: Date,
      action: 'create' | 'edit' | 'regenerate',
      aiModel: string,
      userPrompt?: string,
      cost?: number
    }
  ],

  // 导出记录
  exports: [
    {
      format: 'docx' | 'pdf' | 'xlsx' | 'pptx',
      url: string,
      exportedAt: Date
    }
  ],

  metadata: {
    wordCount?: number,
    pageCount?: number,
    slideCount?: number,
    estimatedReadTime?: number
  },

  createdAt: Date,
  updatedAt: Date
}
```

#### 3.1.3 数据采集统一索引 (data_collections)

```typescript
{
  _id: ObjectId,
  userId: ObjectId,
  name: string,
  description?: string,

  // 资源引用列表
  resources: [
    {
      resourceRef: {
        type: 'youtube_video' | 'academic_paper' | 'web_page' | 'database' | 'file',
        collection: string,    // 对应的collection名称
        id: ObjectId          // 对应collection中的_id
      },

      // 冗余的基本信息(方便列表显示)
      resourceId: string,      // 外部ID (YouTube ID, DOI等)
      title: string,
      summary: string,
      addedAt: Date,
      status: 'pending' | 'collecting' | 'collected' | 'failed'
    }
  ],

  totalResources: number,
  stats: {
    byType: {
      youtube_video: number,
      academic_paper: number,
      web_page: number,
      // ...
    },
    totalSize: number  // bytes
  },

  tags: [string],
  createdAt: Date,
  updatedAt: Date
}
```

#### 3.1.4 YouTube资源集合 (resource_youtube)

```typescript
{
  _id: ObjectId,
  userId: ObjectId,

  // 唯一标识
  resourceId: string,        // YouTube Video ID
  resourceType: 'youtube_video',
  url: string,

  // 元数据(完整)
  metadata: {
    title: string,
    description: string,
    channel: {
      id: string,
      name: string,
      subscribers: number
    },
    duration: string,        // ISO 8601 duration
    publishedAt: Date,
    statistics: {
      views: number,
      likes: number,
      comments: number
    },
    thumbnails: {
      default: string,
      medium: string,
      high: string
    },
    tags: [string],
    category: string,
    language: string
  },

  // 内容(完整)
  content: {
    subtitles: {
      'zh-CN'?: [
        {
          start: number,
          end: number,
          text: string
        }
      ],
      'en'?: [...]
      // 其他语言...
    },
    transcription?: {
      fullText: string,
      segments: [...]
    },
    keyFrames: [
      {
        timestamp: number,
        url: string,
        description?: string
      }
    ]
  },

  // AI分析(完整)
  aiAnalysis: {
    summary: string,
    keyPoints: [string],
    topics: [string],
    entities: [
      {
        name: string,
        type: 'person' | 'organization' | 'technology' | 'concept'
      }
    ],
    sentiment: {
      overall: 'positive' | 'neutral' | 'negative',
      confidence: number
    },
    difficultyLevel: 'beginner' | 'intermediate' | 'advanced',
    targetAudience: [string],
    prerequisites: [string],
    learningOutcomes: [string]
  },

  // 质量控制
  quality: {
    completeness: number,    // 0-1
    reliability: number,     // 0-1
    lastValidated: Date
  },

  // 版本控制
  version: number,

  collectedAt: Date,
  updatedAt: Date
}
```

#### 3.1.5 学术论文集合 (resource_papers)

```typescript
{
  _id: ObjectId,
  userId: ObjectId,

  resourceId: string,        // DOI 或 arXiv ID
  resourceType: 'academic_paper',

  metadata: {
    title: string,
    authors: [
      {
        name: string,
        affiliation: string,
        email?: string
      }
    ],
    abstract: string,
    keywords: [string],
    publishedAt: Date,
    venue: string,            // 期刊或会议名称
    doi?: string,
    arxivId?: string,
    citations: number,
    pdfUrl?: string
  },

  content: {
    fullText: string,
    sections: [
      {
        title: string,
        content: string,
        level: number
      }
    ],
    figures: [
      {
        caption: string,
        url: string,
        type: 'image' | 'chart' | 'diagram'
      }
    ],
    tables: [...],
    equations: [...],
    references: [
      {
        title: string,
        authors: string,
        year: number,
        venue: string
      }
    ]
  },

  aiAnalysis: {
    summary: string,
    contributions: [string],
    methodology: string,
    results: string,
    limitations: [string],
    futureWork: [string],
    impact: 'low' | 'medium' | 'high' | 'very high',
    field: string,
    subfields: [string]
  },

  collectedAt: Date,
  updatedAt: Date
}
```

#### 3.1.6 网页资源集合 (resource_web)

```typescript
{
  _id: ObjectId,
  userId: ObjectId,

  resourceId: string,        // URL的hash
  resourceType: 'web_page',
  url: string,

  metadata: {
    title: string,
    description?: string,
    author?: string,
    publishedAt?: Date,
    modifiedAt?: Date,
    siteName?: string,
    language: string,
    favicon?: string
  },

  content: {
    rawHtml?: string,
    cleanedText: string,
    structuredData?: any,    // JSON-LD等结构化数据
    images: [
      {
        src: string,
        alt: string
      }
    ],
    links: [string]
  },

  aiAnalysis: {
    summary: string,
    mainTopics: [string],
    keyInsights: [string],
    credibility: number,     // 0-1
    bias?: 'left' | 'center' | 'right' | 'unknown'
  },

  collectedAt: Date,
  updatedAt: Date
}
```

#### 3.1.7 模板集合 (templates)

```typescript
{
  _id: ObjectId,
  userId?: ObjectId,         // null表示系统模板
  type: 'word' | 'excel' | 'ppt',
  name: string,
  description: string,
  category: string,
  tags: [string],

  // 适用的数据源类型
  compatibleResourceTypes: ['youtube_video', 'academic_paper'],

  // 模板结构定义
  structure: {
    // Word模板
    sections?: [
      {
        id: string,
        title: string,
        type: 'ai_generated' | 'data_table' | 'cover_page',
        aiPrompt?: string,
        variables?: [string],
        format?: any
      }
    ],

    // Excel模板
    sheets?: [...],

    // PPT模板
    slides?: [...]
  },

  // 模板样式
  styles: {
    theme?: string,
    colors?: any,
    fonts?: any
  },

  // 使用统计
  usage: {
    count: number,
    rating: number,
    reviews: number
  },

  isPublic: boolean,
  version: string,

  createdAt: Date,
  updatedAt: Date
}
```

#### 3.1.8 AI对话历史 (chat_sessions)

```typescript
{
  _id: ObjectId,
  userId: ObjectId,
  documentId: ObjectId,

  messages: [
    {
      id: string,
      role: 'user' | 'assistant' | 'system',
      content: string,

      // @资源引用
      mentionedResources?: [
        {
          resourceRef: {
            type: string,
            collection: string,
            id: ObjectId
          }
        }
      ],

      // 附件
      attachments?: [
        {
          type: 'image' | 'file',
          url: string
        }
      ],

      metadata: {
        model?: string,
        tokens?: number,
        cost?: number,
        latency?: number
      },

      timestamp: Date
    }
  ],

  createdAt: Date,
  updatedAt: Date
}
```

### 3.2 数据库索引设计

```javascript
// users
db.users.createIndex({ email: 1 }, { unique: true });
db.users.createIndex({ createdAt: -1 });

// documents
db.documents.createIndex({ userId: 1, createdAt: -1 });
db.documents.createIndex({ status: 1 });
db.documents.createIndex({ "resources.resourceRef.id": 1 });

// data_collections
db.data_collections.createIndex({ userId: 1, createdAt: -1 });
db.data_collections.createIndex({ "resources.resourceRef.id": 1 });

// resource_youtube
db.resource_youtube.createIndex({ resourceId: 1, userId: 1 }, { unique: true });
db.resource_youtube.createIndex({ userId: 1, collectedAt: -1 });
db.resource_youtube.createIndex({
  "metadata.title": "text",
  "aiAnalysis.summary": "text",
});

// resource_papers
db.resource_papers.createIndex({ resourceId: 1, userId: 1 }, { unique: true });
db.resource_papers.createIndex({ userId: 1, collectedAt: -1 });
db.resource_papers.createIndex({
  "metadata.title": "text",
  "metadata.abstract": "text",
});

// resource_web
db.resource_web.createIndex({ resourceId: 1, userId: 1 }, { unique: true });
db.resource_web.createIndex({ url: 1 });

// templates
db.templates.createIndex({ type: 1, isPublic: 1 });
db.templates.createIndex({ category: 1 });
db.templates.createIndex({ "usage.rating": -1 });

// chat_sessions
db.chat_sessions.createIndex({ documentId: 1 });
db.chat_sessions.createIndex({ userId: 1, createdAt: -1 });
```

---

## 四、API设计

### 4.1 RESTful API设计

#### 4.1.1 资源管理 API

```typescript
// 添加资源
POST /api/resources
Body: {
  type: 'youtube_video' | 'academic_paper' | 'web_page',
  url: string,
  collectionId?: ObjectId,  // 可选，添加到指定collection
  options?: {
    autoAnalyze: boolean,
    extractSubtitles: boolean,
    // ...
  }
}
Response: {
  resourceId: ObjectId,
  status: 'pending' | 'collecting',
  estimatedTime: number  // 秒
}

// 获取资源列表
GET /api/resources?collectionId=xxx&type=youtube_video&page=1&limit=20
Response: {
  resources: [
    {
      _id: ObjectId,
      type: string,
      title: string,
      summary: string,
      thumbnail?: string,
      status: string,
      addedAt: Date
    }
  ],
  total: number,
  page: number,
  limit: number
}

// 获取资源详情
GET /api/resources/:id
Response: {
  // 完整的resource对象
}

// 删除资源
DELETE /api/resources/:id

// 重新采集资源
POST /api/resources/:id/recollect
```

#### 4.1.2 文档管理 API

```typescript
// 创建文档
POST /api/documents
Body: {
  type: 'word' | 'excel' | 'ppt',
  title: string,
  resourceIds: [ObjectId],
  templateId?: ObjectId,
  aiConfig: {
    model: string,
    language: string,
    detailLevel: number,
    professionalLevel: number
  }
}
Response: {
  documentId: ObjectId,
  status: 'draft'
}

// 生成文档(AI)
POST /api/documents/:id/generate
Body: {
  prompt?: string,
  section?: string  // 生成特定章节
}
Response: Stream (Server-Sent Events)
{
  event: 'progress',
  data: {
    progress: 0.5,
    message: '正在生成第二章...'
  }
}
{
  event: 'section',
  data: {
    sectionId: string,
    content: string
  }
}
{
  event: 'complete',
  data: {
    documentId: ObjectId,
    metadata: {...}
  }
}

// 获取文档
GET /api/documents/:id
Response: {
  // 完整的document对象
}

// 更新文档
PATCH /api/documents/:id
Body: {
  title?: string,
  content?: any,
  // ...
}

// 导出文档
POST /api/documents/:id/export
Body: {
  format: 'docx' | 'pdf' | 'xlsx' | 'pptx'
}
Response: {
  downloadUrl: string,
  expiresIn: number  // 秒
}

// 列出用户文档
GET /api/documents?type=word&status=completed&page=1&limit=20
```

#### 4.1.3 AI交互 API

```typescript
// AI对话
POST /api/ai/chat
Body: {
  documentId: ObjectId,
  message: string,
  mentionedResources?: [
    {
      type: string,
      id: ObjectId
    }
  ],
  context?: {
    currentSection?: string,
    selectedText?: string
  }
}
Response: Stream (Server-Sent Events)
{
  event: 'token',
  data: {
    token: string
  }
}
{
  event: 'complete',
  data: {
    messageId: string,
    fullContent: string,
    metadata: {
      model: string,
      tokens: number,
      cost: number
    }
  }
}

// 获取对话历史
GET /api/ai/chat/:documentId
Response: {
  messages: [...]
}

// AI智能建议
POST /api/ai/suggestions
Body: {
  documentId: ObjectId,
  type: 'improve' | 'expand' | 'summarize' | 'chart'
}
Response: {
  suggestions: [
    {
      type: string,
      description: string,
      action: {
        type: string,
        params: any
      }
    }
  ]
}
```

#### 4.1.4 模板管理 API

```typescript
// 获取模板列表
GET /api/templates?type=word&category=research&page=1

// 获取模板详情
GET /api/templates/:id

// 创建自定义模板
POST /api/templates
Body: {
  type: 'word' | 'excel' | 'ppt',
  name: string,
  structure: {...},
  // ...
}

// 更新模板
PATCH /api/templates/:id

// 删除模板
DELETE /api/templates/:id
```

### 4.2 WebSocket API (实时协作)

```typescript
// 连接
const socket = io("ws://localhost:3000");

// 加入文档房间
socket.emit("join-document", { documentId: "xxx" });

// AI生成进度推送
socket.on("generation-progress", (data) => {
  console.log(data.progress, data.message);
});

// AI生成的新内容
socket.on("content-update", (data) => {
  console.log(data.sectionId, data.content);
});

// 其他用户的编辑(协作)
socket.on("user-edit", (data) => {
  console.log(data.userId, data.change);
});
```

---

## 五、任务划分

### 5.1 开发阶段划分

```
Phase 0: 项目准备 (1周)
   ↓
Phase 1: 核心基础设施 (2周)
   ↓
Phase 2: 数据采集系统 (2周)
   ↓
Phase 3: AI集成与交互 (2周)
   ↓
Phase 4: 文档生成引擎 (3周)
   ↓
Phase 5: UI与交互完善 (2周)
   ↓
Phase 6: 测试与优化 (2周)
   ↓
Phase 7: 上线准备 (1周)

总计: 15周 (约3.5个月)
```

### 5.2 Phase 0: 项目准备 (Week 1)

**目标**: 搭建开发环境和基础框架

**任务列表**:

| 任务ID | 任务名称                     | 负责人 | 工时 | 依赖 |
| ------ | ---------------------------- | ------ | ---- | ---- |
| P0-1   | 项目初始化(Next.js 14)       | 全栈1  | 4h   | -    |
| P0-2   | 配置TypeScript和ESLint       | 全栈1  | 2h   | P0-1 |
| P0-3   | 安装核心依赖包               | 全栈1  | 2h   | P0-1 |
| P0-4   | 配置Tailwind CSS + shadcn/ui | 前端1  | 4h   | P0-1 |
| P0-5   | 搭建PostgreSQL开发环境       | 后端1  | 4h   | -    |
| P0-6   | 配置Redis缓存                | 后端1  | 2h   | -    |
| P0-7   | 设置Git仓库和CI/CD           | DevOps | 6h   | -    |
| P0-8   | 创建数据库Schema定义         | 后端1  | 8h   | P0-5 |
| P0-9   | 搭建API路由框架              | 全栈1  | 4h   | P0-1 |
| P0-10  | 配置环境变量管理             | 全栈1  | 2h   | P0-1 |

**交付物**:

- ✅ 可运行的Next.js项目
- ✅ 配置完成的开发环境
- ✅ 数据库连接和基础Schema
- ✅ CI/CD流水线

### 5.3 Phase 1: 核心基础设施 (Week 2-3)

**目标**: 实现三栏布局和基础UI框架

**任务列表**:

| 任务ID               | 任务名称                  | 负责人 | 工时 | 优先级 |
| -------------------- | ------------------------- | ------ | ---- | ------ |
| **1.1 三栏布局开发** |
| P1-1                 | ThreeColumnLayout组件开发 | 前端1  | 12h  | P0     |
| P1-2                 | 左侧菜单Sidebar组件       | 前端1  | 8h   | P0     |
| P1-3                 | 中间栏MiddlePanel组件     | 前端1  | 12h  | P0     |
| P1-4                 | 右侧RightPanel容器组件    | 前端1  | 4h   | P0     |
| P1-5                 | 中间栏宽度调节功能        | 前端1  | 6h   | P1     |
| P1-6                 | 响应式布局适配            | 前端1  | 8h   | P1     |
| **1.2 资源列表UI**   |
| P1-7                 | ResourceList组件开发      | 前端2  | 8h   | P0     |
| P1-8                 | ResourceCard组件          | 前端2  | 6h   | P0     |
| P1-9                 | 资源折叠/展开功能         | 前端2  | 4h   | P1     |
| P1-10                | AddResourceDialog对话框   | 前端2  | 8h   | P0     |
| **1.3 AI交互面板UI** |
| P1-11                | ChatPanel组件开发         | 前端2  | 10h  | P0     |
| P1-12                | ChatMessage组件           | 前端2  | 6h   | P0     |
| P1-13                | ChatInput输入框组件       | 前端2  | 8h   | P0     |
| P1-14                | @资源提及MentionPicker    | 前端2  | 8h   | P1     |
| P1-15                | 快捷操作按钮QuickActions  | 前端2  | 4h   | P2     |
| **1.4 状态管理**     |
| P1-16                | Zustand store设计和实现   | 全栈1  | 10h  | P0     |
| P1-17                | UI状态管理(折叠、宽度)    | 全栈1  | 4h   | P1     |
| P1-18                | 用户偏好持久化            | 全栈1  | 4h   | P1     |

**交付物**:

- ✅ 完整的三栏布局框架
- ✅ 资源列表UI(静态数据)
- ✅ AI交互面板UI(静态)
- ✅ 响应式布局支持

### 5.4 Phase 2: 数据采集系统 (Week 4-5)

**目标**: 实现YouTube、Papers、Web数据采集

**任务列表**:

| 任务ID                 | 任务名称                  | 负责人 | 工时 | 优先级 |
| ---------------------- | ------------------------- | ------ | ---- | ------ |
| **2.1 YouTube采集**    |
| P2-1                   | YouTube API集成           | 后端1  | 8h   | P0     |
| P2-2                   | 视频元数据采集            | 后端1  | 6h   | P0     |
| P2-3                   | 字幕下载和解析            | 后端1  | 10h  | P0     |
| P2-4                   | 音频转录(Whisper API)     | 后端1  | 8h   | P1     |
| P2-5                   | 关键帧提取                | 后端1  | 6h   | P2     |
| P2-6                   | AI内容分析                | 后端1  | 10h  | P0     |
| **2.2 Papers采集**     |
| P2-7                   | arXiv API集成             | 后端2  | 8h   | P0     |
| P2-8                   | PDF下载和解析             | 后端2  | 10h  | P0     |
| P2-9                   | 全文内容提取              | 后端2  | 8h   | P0     |
| P2-10                  | 引用关系解析              | 后端2  | 6h   | P1     |
| P2-11                  | AI论文分析                | 后端2  | 10h  | P0     |
| **2.3 Web采集**        |
| P2-12                  | 网页爬虫开发              | 后端2  | 8h   | P0     |
| P2-13                  | HTML内容清洗              | 后端2  | 6h   | P0     |
| P2-14                  | 结构化数据提取            | 后端2  | 6h   | P1     |
| P2-15                  | AI网页分析                | 后端2  | 8h   | P0     |
| **2.4 去重和质量控制** |
| P2-16                  | 资源去重算法实现          | 后端1  | 8h   | P0     |
| P2-17                  | 数据质量检查              | 后端1  | 6h   | P0     |
| P2-18                  | 错误处理和重试机制        | 后端1  | 6h   | P0     |
| **2.5 API开发**        |
| P2-19                  | POST /api/resources API   | 全栈1  | 6h   | P0     |
| P2-20                  | GET /api/resources API    | 全栈1  | 4h   | P0     |
| P2-21                  | DELETE /api/resources/:id | 全栈1  | 2h   | P0     |
| P2-22                  | 采集进度WebSocket推送     | 全栈1  | 6h   | P1     |
| **2.6 前端集成**       |
| P2-23                  | 资源添加功能集成          | 前端1  | 8h   | P0     |
| P2-24                  | 资源列表数据绑定          | 前端1  | 6h   | P0     |
| P2-25                  | 采集进度实时显示          | 前端1  | 6h   | P1     |
| P2-26                  | 资源详情预览              | 前端2  | 8h   | P1     |

**交付物**:

- ✅ YouTube、Papers、Web三种数据源采集
- ✅ 完整的去重和质量控制
- ✅ 资源管理API
- ✅ 前端资源管理功能

### 5.5 Phase 3: AI集成与交互 (Week 6-7)

**目标**: 实现AI对话和智能生成

**任务列表**:

| 任务ID             | 任务名称              | 负责人 | 工时 | 优先级 |
| ------------------ | --------------------- | ------ | ---- | ------ |
| **3.1 AI模型集成** |
| P3-1               | Vercel AI SDK集成     | 后端1  | 6h   | P0     |
| P3-2               | OpenAI API接入        | 后端1  | 4h   | P0     |
| P3-3               | Anthropic API接入     | 后端1  | 4h   | P0     |
| P3-4               | Google AI API接入     | 后端1  | 4h   | P1     |
| P3-5               | 模型管理器开发        | 后端1  | 8h   | P0     |
| P3-6               | 智能路由系统          | 后端1  | 10h  | P1     |
| **3.2 AI对话功能** |
| P3-7               | 对话上下文管理        | 后端1  | 8h   | P0     |
| P3-8               | 流式输出实现          | 后端1  | 8h   | P0     |
| P3-9               | @资源引用处理         | 后端1  | 8h   | P0     |
| P3-10              | 对话历史存储          | 后端1  | 4h   | P0     |
| P3-11              | POST /api/ai/chat API | 全栈1  | 8h   | P0     |
| **3.3 AI内容生成** |
| P3-12              | 文档结构分析          | 后端2  | 10h  | P0     |
| P3-13              | 章节内容生成          | 后端2  | 10h  | P0     |
| P3-14              | 内容质量检查          | 后端2  | 6h   | P1     |
| P3-15              | 智能建议系统          | 后端2  | 8h   | P1     |
| **3.4 前端集成**   |
| P3-16              | AI对话功能集成        | 前端1  | 10h  | P0     |
| P3-17              | 流式消息显示          | 前端1  | 8h   | P0     |
| P3-18              | @资源提及UI交互       | 前端1  | 6h   | P0     |
| P3-19              | AI生成进度显示        | 前端1  | 6h   | P0     |
| P3-20              | 快捷指令功能          | 前端2  | 6h   | P1     |

**交付物**:

- ✅ 多AI模型支持
- ✅ 完整的AI对话功能
- ✅ 流式输出和实时显示
- ✅ @资源引用功能

### 5.6 Phase 4: 文档生成引擎 (Week 8-10)

**目标**: 实现Word、Excel、PPT生成

**任务列表**:

| 任务ID                | 任务名称                         | 负责人 | 工时 | 优先级 |
| --------------------- | -------------------------------- | ------ | ---- | ------ |
| **4.1 Word文档生成**  |
| P4-1                  | docx.js库集成                    | 后端1  | 4h   | P0     |
| P4-2                  | Word文档生成器开发               | 后端1  | 16h  | P0     |
| P4-3                  | 样式和格式化引擎                 | 后端1  | 10h  | P0     |
| P4-4                  | 智能排版算法                     | 后端1  | 12h  | P1     |
| P4-5                  | 目录自动生成                     | 后端1  | 6h   | P1     |
| P4-6                  | 页眉页脚处理                     | 后端1  | 4h   | P2     |
| **4.2 Excel表格生成** |
| P4-7                  | exceljs库集成                    | 后端2  | 4h   | P0     |
| P4-8                  | Excel生成器开发                  | 后端2  | 16h  | P0     |
| P4-9                  | 图表生成功能                     | 后端2  | 12h  | P0     |
| P4-10                 | 公式和函数支持                   | 后端2  | 10h  | P1     |
| P4-11                 | 条件格式化                       | 后端2  | 8h   | P1     |
| P4-12                 | 数据分析功能                     | 后端2  | 10h  | P1     |
| **4.3 PPT演示生成**   |
| P4-13                 | pptxgenjs库集成                  | 全栈2  | 4h   | P0     |
| P4-14                 | PPT生成器开发(参考Open Genspark) | 全栈2  | 20h  | P0     |
| P4-15                 | 幻灯片布局引擎                   | 全栈2  | 12h  | P0     |
| P4-16                 | 图表和可视化                     | 全栈2  | 10h  | P0     |
| P4-17                 | 主题和样式系统                   | 全栈2  | 8h   | P1     |
| P4-18                 | 动画和切换效果                   | 全栈2  | 6h   | P2     |
| **4.4 文档编辑器**    |
| P4-19                 | TipTap Word编辑器集成            | 前端1  | 12h  | P0     |
| P4-20                 | Handsontable Excel编辑器集成     | 前端1  | 12h  | P0     |
| P4-21                 | Fabric.js PPT编辑器集成          | 前端2  | 16h  | P0     |
| P4-22                 | AI生成内容标记和确认             | 前端1  | 10h  | P0     |
| P4-23                 | 编辑器工具栏开发                 | 前端2  | 8h   | P0     |
| **4.5 导出功能**      |
| P4-24                 | DOCX导出                         | 后端1  | 4h   | P0     |
| P4-25                 | PDF导出(Puppeteer)               | 后端1  | 8h   | P1     |
| P4-26                 | XLSX导出                         | 后端2  | 4h   | P0     |
| P4-27                 | PPTX导出                         | 全栈2  | 4h   | P0     |
| P4-28                 | 文件存储(S3/R2)                  | 后端1  | 6h   | P0     |

**交付物**:

- ✅ Word文档生成和编辑
- ✅ Excel表格生成和编辑
- ✅ PPT演示生成和编辑
- ✅ 多格式导出功能

### 5.7 Phase 5: 模板系统和优化 (Week 11-12)

**任务列表**:

| 任务ID               | 任务名称            | 负责人    | 工时 | 优先级 |
| -------------------- | ------------------- | --------- | ---- | ------ |
| **5.1 模板系统**     |
| P5-1                 | 模板引擎开发        | 后端1     | 12h  | P0     |
| P5-2                 | 模板变量系统        | 后端1     | 8h   | P0     |
| P5-3                 | 预置模板创建(10个)  | 产品+设计 | 20h  | P0     |
| P5-4                 | 模板管理API         | 全栈1     | 8h   | P0     |
| P5-5                 | 模板编辑器UI        | 前端1     | 16h  | P1     |
| P5-6                 | 模板市场UI          | 前端2     | 12h  | P1     |
| **5.2 性能优化**     |
| P5-7                 | Redis缓存优化       | 后端1     | 8h   | P0     |
| P5-8                 | 数据库查询优化      | 后端1     | 6h   | P0     |
| P5-9                 | 前端代码分割        | 前端1     | 6h   | P0     |
| P5-10                | 图片懒加载优化      | 前端1     | 4h   | P1     |
| P5-11                | WebSocket连接池优化 | 后端2     | 6h   | P1     |
| **5.3 用户体验优化** |
| P5-12                | 加载状态优化        | 前端2     | 8h   | P0     |
| P5-13                | 错误处理和提示      | 前端2     | 8h   | P0     |
| P5-14                | 空状态设计          | 前端2     | 4h   | P1     |
| P5-15                | 键盘快捷键          | 前端1     | 6h   | P1     |
| P5-16                | 帮助文档和引导      | 前端2     | 8h   | P2     |

**交付物**:

- ✅ 完整的模板系统
- ✅ 10个预置模板
- ✅ 性能优化完成
- ✅ 用户体验优化

### 5.8 Phase 6: 测试与质量保证 (Week 13-14)

**任务列表**:

| 任务ID | 任务名称            | 负责人  | 工时 |
| ------ | ------------------- | ------- | ---- |
| P6-1   | 单元测试(后端)      | 后端1+2 | 24h  |
| P6-2   | 集成测试            | 全栈1   | 16h  |
| P6-3   | E2E测试(Playwright) | 测试    | 20h  |
| P6-4   | 性能测试            | 测试    | 12h  |
| P6-5   | 安全测试            | 后端1   | 8h   |
| P6-6   | 浏览器兼容性测试    | 前端1+2 | 12h  |
| P6-7   | 移动端测试          | 前端2   | 8h   |
| P6-8   | Bug修复             | 全员    | 40h  |
| P6-9   | 用户验收测试(UAT)   | 产品    | 16h  |

**交付物**:

- ✅ 测试覆盖率 > 70%
- ✅ 关键Bug全部修复
- ✅ UAT通过

### 5.9 Phase 7: 上线准备 (Week 15)

**任务列表**:

| 任务ID | 任务名称       | 负责人 | 工时 |
| ------ | -------------- | ------ | ---- |
| P7-1   | 生产环境部署   | DevOps | 12h  |
| P7-2   | 监控和日志系统 | DevOps | 8h   |
| P7-3   | 备份和恢复策略 | DevOps | 6h   |
| P7-4   | 用户文档编写   | 产品   | 16h  |
| P7-5   | API文档完善    | 后端1  | 8h   |
| P7-6   | 营销材料准备   | 市场   | 16h  |
| P7-7   | 上线前检查清单 | 全员   | 4h   |
| P7-8   | 灰度发布       | DevOps | 8h   |

**交付物**:

- ✅ 生产环境就绪
- ✅ 完整的文档
- ✅ 成功上线

---

## 六、团队配置

### 6.1 推荐团队配置

| 角色             | 人数 | 职责                       | 技能要求                                |
| ---------------- | ---- | -------------------------- | --------------------------------------- |
| **全栈工程师**   | 2人  | 核心功能开发、API设计      | Next.js, React, Node.js, MongoDB        |
| **前端工程师**   | 2人  | UI组件、交互、编辑器集成   | React, TypeScript, TipTap, Handsontable |
| **后端工程师**   | 2人  | 数据采集、AI集成、文档生成 | Node.js, Python, AI APIs, 爬虫          |
| **DevOps工程师** | 1人  | 部署、监控、CI/CD          | Docker, K8s, Vercel, AWS                |
| **测试工程师**   | 1人  | 测试用例、自动化测试       | Playwright, Jest, Postman               |
| **产品经理**     | 1人  | 需求管理、用户测试         | 产品设计、文档编写                      |
| **UI/UX设计师**  | 1人  | 界面设计、交互设计         | Figma, 用户体验                         |

**总人数**: 10人
**开发周期**: 15周 (约3.5个月)

### 6.2 精简配置 (MVP)

如果资源有限，可以精简为:

| 角色              | 人数 | 说明             |
| ----------------- | ---- | ---------------- |
| **全栈工程师**    | 2人  | 负责前后端开发   |
| **AI/后端工程师** | 1人  | 专注AI和数据采集 |
| **产品+设计**     | 1人  | 兼任产品和设计   |

**总人数**: 4人
**开发周期**: 20-24周 (约5-6个月)

---

## 七、关键技术风险与对策

### 7.1 技术风险

| 风险                 | 影响 | 概率 | 对策                           |
| -------------------- | ---- | ---- | ------------------------------ |
| **AI API不稳定**     | 高   | 中   | 多模型备份、降级策略、本地缓存 |
| **大文档性能问题**   | 高   | 中   | 分块加载、虚拟滚动、WebWorker  |
| **数据采集失败率高** | 中   | 高   | 重试机制、人工补充、错误处理   |
| **编辑器兼容性**     | 中   | 中   | 充分测试、Polyfill、降级方案   |
| **实时协作冲突**     | 中   | 低   | CRDT算法、操作转换(OT)         |
| **数据去重不准确**   | 中   | 中   | 多维度匹配、人工审核           |

### 7.2 架构风险

| 风险                | 对策                         |
| ------------------- | ---------------------------- |
| **MongoDB性能瓶颈** | 合理索引、分片、读写分离     |
| **AI成本过高**      | 缓存、智能路由、成本监控     |
| **并发处理能力**    | 队列系统、异步处理、限流     |
| **数据安全**        | 加密存储、访问控制、审计日志 |

---

## 八、成本估算

### 8.1 开发成本

| 项目               | 人员 | 周期 | 成本(USD) |
| ------------------ | ---- | ---- | --------- |
| **标准配置(10人)** | 10人 | 15周 | $225,000  |
| **精简配置(4人)**  | 4人  | 24周 | $144,000  |

### 8.2 运营成本 (每月)

| 项目                          | 成本(USD)  |
| ----------------------------- | ---------- |
| **服务器**(Vercel Pro)        | $50-100    |
| **数据库**(MongoDB Atlas M10) | $50-100    |
| **缓存**(Redis Cloud)         | $30-50     |
| **存储**(S3/R2, 500GB)        | $50-100    |
| **AI API**(估计20K次调用)     | $400-1000  |
| **监控和日志**                | $50-100    |
| **总计**                      | $630-1,450 |

---

## 九、里程碑和交付计划

### 9.1 关键里程碑

```
Week 3  ✓ MVP1: 三栏布局完成
Week 5  ✓ MVP2: 数据采集系统完成
Week 7  ✓ MVP3: AI对话功能完成
Week 10 ✓ MVP4: Word+Excel+PPT生成完成
Week 12 ✓ Beta版本: 模板系统+优化完成
Week 14 ✓ RC版本: 测试完成
Week 15 ✓ 正式上线
```

### 9.2 演示计划

| 时间    | 版本    | 演示内容               |
| ------- | ------- | ---------------------- |
| Week 3  | Alpha 1 | 三栏布局、静态资源列表 |
| Week 5  | Alpha 2 | YouTube采集、资源管理  |
| Week 7  | Alpha 3 | AI对话、流式输出       |
| Week 10 | Beta 1  | 完整的Word生成流程     |
| Week 12 | Beta 2  | Word+Excel+PPT全功能   |
| Week 14 | RC      | 完整产品+模板系统      |

---

## 十、建议与总结

### 10.1 关于Open Genspark的使用建议

**推荐策略**: **参考学习，不直接基于**

**具体做法**:

1. **技术栈参考**: 采用相同的Next.js + Vercel AI SDK + MongoDB架构
2. **代码参考**: 学习其PPT生成和多AI模型管理的实现思路
3. **独立开发**: 从零开发三栏布局和核心业务逻辑

**理由**:

- ✅ 避免被其现有架构限制
- ✅ 可以完全按我们的设计实现
- ✅ 代码质量和可维护性更好
- ✅ 学习曲线更合理

### 10.2 优先级建议

**必须实现 (P0)**:

- ✅ 三栏布局
- ✅ YouTube + Papers数据采集
- ✅ AI对话基础功能
- ✅ Word文档生成
- ✅ 基础模板系统

**重要功能 (P1)**:

- ✅ Excel表格生成
- ✅ PPT演示生成
- ✅ 智能路由和多模型
- ✅ Web数据采集
- ✅ 高级编辑功能

**锦上添花 (P2)**:

- ⭐ 实时协作
- ⭐ 模板市场
- ⭐ 移动端优化
- ⭐ 国际化

### 10.3 快速启动建议

**第一周行动清单**:

1. ✅ 搭建Next.js项目
2. ✅ 配置MongoDB和Redis
3. ✅ 实现ThreeColumnLayout基础框架
4. ✅ 完成数据库Schema设计
5. ✅ 集成Vercel AI SDK
6. ✅ 创建第一个API端点
7. ✅ 部署到开发环境

**快速验证**:

- Week 1: 能看到三栏布局
- Week 2: 能添加一个YouTube视频
- Week 3: 能和AI对话
- Week 4: 能生成一个简单的Word文档

---

## 附录

### A. 技术栈清单

```json
{
  "frontend": {
    "framework": "Next.js 14",
    "ui": "React 18",
    "styling": "Tailwind CSS + shadcn/ui",
    "state": "Zustand",
    "editors": {
      "word": "TipTap",
      "excel": "Handsontable",
      "ppt": "Fabric.js"
    }
  },
  "backend": {
    "runtime": "Node.js 20",
    "framework": "Next.js API Routes",
    "database": "MongoDB 7.0",
    "cache": "Redis 7.0",
    "queue": "Bull (Redis-based)",
    "storage": "S3 / Cloudflare R2"
  },
  "ai": {
    "sdk": "Vercel AI SDK",
    "models": ["gpt-4-turbo", "claude-3-sonnet", "gemini-1.5-pro"]
  },
  "document": {
    "word": "docx",
    "excel": "exceljs",
    "ppt": "pptxgenjs"
  },
  "testing": {
    "unit": "Jest + React Testing Library",
    "e2e": "Playwright",
    "api": "Supertest"
  },
  "deployment": {
    "platform": "Vercel",
    "ci_cd": "GitHub Actions",
    "monitoring": "Sentry + Vercel Analytics"
  }
}
```

### B. 开发工具推荐

| 类别        | 工具                        | 用途       |
| ----------- | --------------------------- | ---------- |
| **IDE**     | VS Code                     | 代码编辑   |
| **API测试** | Postman / Insomnia          | API调试    |
| **数据库**  | MongoDB Compass             | 数据库管理 |
| **Git**     | GitHub Desktop / SourceTree | 版本控制   |
| **设计**    | Figma                       | UI/UX设计  |
| **协作**    | Notion / Linear             | 项目管理   |
| **监控**    | Sentry                      | 错误监控   |

---

**文档版本**: v1.0
**最后更新**: 2025-11-15
**审核状态**: 待审核
