# AI Office 彻底重构计划

## 参考设计: Genspark AI Workspace

基于 [Genspark](https://www.genspark.ai/) 的设计理念，构建专项 Agent 矩阵 + 极简 Prompt Bar UI。

---

## 一、架构总览

### 1.1 设计理念

```
Genspark 核心理念:
┌─────────────────────────────────────────────────────────────┐
│  "Less control, more tools"                                 │
│  - 用户只需描述目标，Agent 自动完成一切                       │
│  - 每个专项 Agent 有独立入口和专属界面                        │
│  - Mixture-of-Agents: 智能路由到最优模型                     │
│  - 80+ 工具自动组合使用                                      │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 专项 Agent 矩阵

```
┌─────────────────────────────────────────────────────────────┐
│                    AI Office 入口页                          │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│  │   📊    │ │   📄    │ │   🎨    │ │   💻    │           │
│  │ Slides  │ │  Docs   │ │Designer │ │Developer│           │
│  │  PPT    │ │  Word   │ │ 设计工具 │ │ 代码助手 │           │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘           │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 🔍 描述你想要创建的内容...                           │   │
│  │    [智能路由到最合适的 Agent]                        │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 每个 Agent 的独立界面

```
┌─────────────────────────────────────────────────────────────┐
│ AI Slides                                          [← 返回] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 📊 描述你想要的 PPT 主题...                          │   │
│  │    例: "2025 年科技行业趋势分析报告，10页左右"        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  快速模板:                                                  │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐              │
│  │ 商业   │ │ 学术   │ │ 营销   │ │ 技术   │              │
│  │ 计划书 │ │ 报告   │ │ 方案   │ │ 架构   │              │
│  └────────┘ └────────┘ └────────┘ └────────┘              │
│                                                             │
│  生成进度:                                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░ 45%                            │   │
│  │ 📝 正在生成第 4/10 页幻灯片...                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  预览区域:                                                  │
│  ┌───────────────┬───────────────┬───────────────┐         │
│  │ Slide 1 ✓    │ Slide 2 ✓    │ Slide 3 ✓    │         │
│  │ [缩略图]      │ [缩略图]      │ [缩略图]      │         │
│  └───────────────┴───────────────┴───────────────┘         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、前端架构重构

### 2.1 新目录结构

```
frontend/
├── app/
│   └── ai-office/
│       ├── page.tsx              # 入口页 (Agent 选择器)
│       ├── slides/
│       │   └── page.tsx          # AI Slides 专属页面
│       ├── docs/
│       │   └── page.tsx          # AI Docs 专属页面
│       ├── designer/
│       │   └── page.tsx          # AI Designer 专属页面
│       └── developer/
│           └── page.tsx          # AI Developer 专属页面
│
├── components/
│   └── ai-office/
│       ├── core/                 # 核心通用组件
│       │   ├── AgentCard.tsx     # Agent 选择卡片
│       │   ├── PromptBar.tsx     # 极简输入框 (Genspark 风格)
│       │   ├── ProgressTracker.tsx # 进度追踪器
│       │   ├── TemplateGrid.tsx  # 模板选择网格
│       │   └── ResultCanvas.tsx  # 结果展示画布
│       │
│       ├── slides/               # AI Slides 专属组件
│       │   ├── SlidesAgent.tsx   # Slides Agent 主组件
│       │   ├── SlidePreview.tsx  # 幻灯片预览
│       │   ├── SlideEditor.tsx   # 单页编辑器
│       │   ├── OutlinePanel.tsx  # 大纲面板
│       │   └── ThemeSelector.tsx # 主题选择器
│       │
│       ├── docs/                 # AI Docs 专属组件
│       │   ├── DocsAgent.tsx     # Docs Agent 主组件
│       │   ├── DocumentPreview.tsx
│       │   ├── SectionEditor.tsx
│       │   └── ReferencePanel.tsx
│       │
│       ├── designer/             # AI Designer 专属组件
│       │   ├── DesignerAgent.tsx # Designer Agent 主组件
│       │   ├── DesignCanvas.tsx  # 设计画布
│       │   ├── StylePanel.tsx    # 样式面板
│       │   └── AssetLibrary.tsx  # 素材库
│       │
│       └── developer/            # AI Developer 专属组件
│           ├── DeveloperAgent.tsx
│           ├── CodePreview.tsx
│           ├── FileTree.tsx
│           └── TerminalPanel.tsx
│
└── lib/
    └── agents/                   # Agent 核心逻辑
        ├── types.ts              # Agent 类型定义
        ├── registry.ts           # Agent 注册中心
        ├── orchestrator.ts       # Agent 编排器
        ├── tools/                # 工具集
        │   ├── web-search.ts
        │   ├── image-gen.ts
        │   ├── data-fetch.ts
        │   └── export.ts
        └── agents/               # 具体 Agent 实现
            ├── slides.agent.ts
            ├── docs.agent.ts
            ├── designer.agent.ts
            └── developer.agent.ts
```

### 2.2 核心组件设计

#### PromptBar (极简输入框)

```tsx
// components/ai-office/core/PromptBar.tsx
interface PromptBarProps {
  placeholder: string;
  agentType?: AgentType;
  onSubmit: (input: AgentInput) => void;
  suggestions?: string[];
  isProcessing?: boolean;
}

// 功能:
// - 单行/多行自动切换
// - 文件上传支持 (拖拽/点击)
// - URL 自动识别
// - @资源 提及
// - 快捷命令 (/ppt, /doc, /design)
// - 语音输入 (可选)
```

#### AgentCard (Agent 选择卡片)

```tsx
// components/ai-office/core/AgentCard.tsx
interface AgentCardProps {
  agent: AgentConfig;
  isSelected?: boolean;
  onClick: () => void;
}

// 展示:
// - 图标 + 名称
// - 简短描述
// - 热门模板快捷入口
// - 使用统计 (可选)
```

### 2.3 状态管理重构

```typescript
// stores/agentStore.ts
interface AgentStore {
  // 当前 Agent
  currentAgent: AgentType | null;
  setCurrentAgent: (agent: AgentType) => void;

  // 任务状态
  currentTask: AgentTask | null;
  taskHistory: AgentTask[];

  // 进度追踪
  progress: {
    phase: string;
    percentage: number;
    message: string;
    subTasks: SubTask[];
  };

  // 结果
  result: AgentResult | null;

  // 工具调用记录 (透明推理)
  toolCalls: ToolCall[];
}
```

---

## 三、后端架构重构

### 3.1 新模块结构

```
backend/src/modules/
├── agents/                       # Agent 核心模块
│   ├── agents.module.ts
│   ├── agents.controller.ts      # 统一 Agent API
│   │   ├── POST /agents/execute  # 执行 Agent 任务
│   │   ├── GET /agents/status/:taskId
│   │   ├── GET /agents/stream/:taskId  # SSE 流
│   │   └── POST /agents/cancel/:taskId
│   │
│   ├── core/
│   │   ├── agent.interface.ts    # Agent 接口定义
│   │   ├── agent.registry.ts     # Agent 注册中心
│   │   ├── agent.orchestrator.ts # Agent 编排器
│   │   ├── tool.interface.ts     # 工具接口定义
│   │   └── tool.registry.ts      # 工具注册中心
│   │
│   ├── implementations/          # 具体 Agent 实现
│   │   ├── slides/
│   │   │   ├── slides.agent.ts
│   │   │   ├── slides.planner.ts
│   │   │   ├── slides.generator.ts
│   │   │   └── slides.renderer.ts
│   │   ├── docs/
│   │   │   ├── docs.agent.ts
│   │   │   ├── docs.researcher.ts
│   │   │   └── docs.writer.ts
│   │   ├── designer/
│   │   │   ├── designer.agent.ts
│   │   │   └── designer.generator.ts
│   │   └── developer/
│   │       ├── developer.agent.ts
│   │       └── developer.coder.ts
│   │
│   └── tools/                    # 通用工具
│       ├── web-search.tool.ts
│       ├── web-scraper.tool.ts
│       ├── image-generator.tool.ts
│       ├── data-analyzer.tool.ts
│       ├── file-converter.tool.ts
│       └── export.tool.ts
│
└── ai-office/                    # 保留现有模块 (逐步迁移)
    └── ...
```

### 3.2 Agent 接口定义

```typescript
// agents/core/agent.interface.ts

/**
 * Agent 基础接口
 * 所有专项 Agent 都必须实现此接口
 */
interface IAgent {
  readonly type: AgentType;
  readonly name: string;
  readonly description: string;
  readonly capabilities: string[];
  readonly requiredTools: ToolType[];

  /**
   * 分析用户输入，生成执行计划
   */
  plan(input: AgentInput): Promise<AgentPlan>;

  /**
   * 执行计划，返回流式结果
   */
  execute(plan: AgentPlan): AsyncGenerator<AgentEvent>;

  /**
   * 获取可用模板
   */
  getTemplates(): AgentTemplate[];
}

/**
 * Agent 输入
 */
interface AgentInput {
  prompt: string;
  files?: UploadedFile[];
  urls?: string[];
  resourceIds?: string[];
  templateId?: string;
  options?: Record<string, any>;
}

/**
 * Agent 执行计划
 */
interface AgentPlan {
  taskId: string;
  agentType: AgentType;
  steps: PlanStep[];
  estimatedTime: number;
  toolsRequired: ToolType[];
  modelsRequired: ModelType[];
}

/**
 * 执行步骤
 */
interface PlanStep {
  id: string;
  name: string;
  description: string;
  tool?: ToolType;
  model?: ModelType;
  dependencies: string[];
  estimatedDuration: number;
}

/**
 * Agent 事件 (流式输出)
 */
type AgentEvent =
  | { type: "plan_ready"; plan: AgentPlan }
  | { type: "step_start"; stepId: string; message: string }
  | { type: "step_progress"; stepId: string; progress: number; message: string }
  | { type: "step_complete"; stepId: string; result: any }
  | { type: "tool_call"; tool: string; input: any }
  | { type: "tool_result"; tool: string; output: any }
  | { type: "artifact"; artifact: Artifact }
  | { type: "complete"; result: AgentResult }
  | { type: "error"; error: string };
```

### 3.3 工具系统

```typescript
// agents/core/tool.interface.ts

/**
 * 工具接口
 */
interface ITool {
  readonly type: ToolType;
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JSONSchema;
  readonly outputSchema: JSONSchema;

  execute(input: any): Promise<any>;
}

/**
 * 工具类型枚举
 */
enum ToolType {
  // 信息获取
  WEB_SEARCH = "web_search",
  WEB_SCRAPER = "web_scraper",
  DATA_FETCH = "data_fetch",

  // 内容生成
  TEXT_GENERATION = "text_generation",
  IMAGE_GENERATION = "image_generation",
  CODE_GENERATION = "code_generation",

  // 数据处理
  DATA_ANALYSIS = "data_analysis",
  FILE_CONVERSION = "file_conversion",

  // 导出
  EXPORT_PPTX = "export_pptx",
  EXPORT_DOCX = "export_docx",
  EXPORT_PDF = "export_pdf",
  EXPORT_IMAGE = "export_image",
}
```

### 3.4 Agent 编排器

```typescript
// agents/core/agent.orchestrator.ts

/**
 * Agent 编排器
 * 负责协调多个 Agent 和工具的执行
 */
@Injectable()
class AgentOrchestrator {
  constructor(
    private agentRegistry: AgentRegistry,
    private toolRegistry: ToolRegistry,
    private modelRouter: ModelRouter,
  ) {}

  /**
   * 执行 Agent 任务
   */
  async *execute(input: AgentInput): AsyncGenerator<AgentEvent> {
    // 1. 选择最合适的 Agent
    const agent = this.selectAgent(input);

    // 2. 生成执行计划
    const plan = await agent.plan(input);
    yield { type: "plan_ready", plan };

    // 3. 执行计划
    for await (const event of agent.execute(plan)) {
      yield event;

      // 如果需要调用工具，执行工具
      if (event.type === "tool_call") {
        const tool = this.toolRegistry.get(event.tool);
        const result = await tool.execute(event.input);
        yield { type: "tool_result", tool: event.tool, output: result };
      }
    }
  }

  /**
   * 智能选择 Agent
   */
  private selectAgent(input: AgentInput): IAgent {
    // 基于 prompt 分析意图
    // 路由到最合适的 Agent
  }
}
```

### 3.5 模型路由器

```typescript
// agents/core/model.router.ts

/**
 * 模型路由器
 * 基于任务类型智能选择最优模型
 *
 * 参考 Genspark Mixture-of-Agents 架构
 */
@Injectable()
class ModelRouter {
  /**
   * 选择最优模型
   */
  async selectModel(task: ModelTask): Promise<AIModel> {
    const criteria = this.analyzeCriteria(task);

    // 根据任务复杂度、速度需求、准确性需求选择模型
    if (criteria.needsReasoning && criteria.complexity === "high") {
      return this.getModel(AIModelType.CHAT); // GPT-4, Claude Opus
    }

    if (criteria.needsSpeed) {
      return this.getModel(AIModelType.CHAT_FAST); // GPT-4o-mini, Claude Haiku
    }

    if (criteria.needsCreativity) {
      return this.getModel(AIModelType.MULTIMODAL); // Gemini 2.0
    }

    // 默认使用标准模型
    return this.getDefaultModel(task.type);
  }
}
```

---

## 四、数据模型更新

### 4.1 新增 Prisma 模型

```prisma
// prisma/schema.prisma

// Agent 任务记录
model AgentTask {
  id          String   @id @default(uuid())
  userId      String
  agentType   AgentType
  status      AgentTaskStatus

  input       Json     // AgentInput
  plan        Json?    // AgentPlan
  result      Json?    // AgentResult

  // 性能指标
  startedAt   DateTime?
  completedAt DateTime?
  duration    Int?     // 毫秒

  // 资源消耗
  tokensUsed  Int      @default(0)
  toolCalls   Int      @default(0)

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  user        User     @relation(fields: [userId], references: [id])
  artifacts   AgentArtifact[]
  toolLogs    AgentToolLog[]

  @@index([userId, agentType])
  @@index([status])
}

enum AgentType {
  SLIDES
  DOCS
  DESIGNER
  DEVELOPER
}

enum AgentTaskStatus {
  PENDING
  PLANNING
  EXECUTING
  COMPLETED
  FAILED
  CANCELLED
}

// Agent 产出物
model AgentArtifact {
  id        String   @id @default(uuid())
  taskId    String
  type      ArtifactType
  name      String
  mimeType  String
  size      Int
  url       String?  // S3 URL
  content   Json?    // 内联内容

  createdAt DateTime @default(now())

  task      AgentTask @relation(fields: [taskId], references: [id])

  @@index([taskId])
}

enum ArtifactType {
  PPTX
  DOCX
  PDF
  IMAGE
  CODE
  DATA
}

// 工具调用日志
model AgentToolLog {
  id        String   @id @default(uuid())
  taskId    String
  toolType  String
  input     Json
  output    Json?
  duration  Int      // 毫秒
  success   Boolean
  error     String?

  createdAt DateTime @default(now())

  task      AgentTask @relation(fields: [taskId], references: [id])

  @@index([taskId])
}
```

---

## 五、API 设计

### 5.1 统一 Agent API

```yaml
# Agent 执行
POST /api/v1/agents/execute
Request:
  agentType: AgentType        # 可选，不指定则智能路由
  prompt: string
  files?: File[]
  urls?: string[]
  resourceIds?: string[]
  templateId?: string
  options?: Record<string, any>
Response:
  taskId: string
  status: 'pending'

# 任务状态
GET /api/v1/agents/tasks/:taskId
Response:
  task: AgentTask

# 流式进度 (SSE)
GET /api/v1/agents/tasks/:taskId/stream
Response: SSE events (AgentEvent)

# 取消任务
POST /api/v1/agents/tasks/:taskId/cancel
Response:
  success: boolean

# 获取产出物
GET /api/v1/agents/tasks/:taskId/artifacts
Response:
  artifacts: AgentArtifact[]

# 下载产出物
GET /api/v1/agents/artifacts/:artifactId/download
Response: File stream

# 获取模板列表
GET /api/v1/agents/:agentType/templates
Response:
  templates: AgentTemplate[]
```

### 5.2 专项 Agent API (可选扩展)

```yaml
# Slides 专属
POST /api/v1/agents/slides/regenerate-slide
Request:
  taskId: string
  slideIndex: number
  instructions?: string
Response:
  slide: GeneratedSlide

# Docs 专属
POST /api/v1/agents/docs/regenerate-section
Request:
  taskId: string
  sectionId: string
  instructions?: string
Response:
  section: GeneratedSection

# Designer 专属
POST /api/v1/agents/designer/variations
Request:
  taskId: string
  count: number
Response:
  variations: DesignVariation[]
```

---

## 六、实施计划

### Phase 1: 基础架构 (1-2 周)

1. **后端核心框架**
   - [ ] 创建 agents 模块
   - [ ] 实现 Agent 接口和注册中心
   - [ ] 实现 Tool 接口和注册中心
   - [ ] 实现 Agent 编排器
   - [ ] 实现模型路由器
   - [ ] 添加 Prisma 模型

2. **前端基础组件**
   - [ ] 创建新目录结构
   - [ ] 实现 PromptBar 组件
   - [ ] 实现 AgentCard 组件
   - [ ] 实现 ProgressTracker 组件
   - [ ] 创建 agentStore

### Phase 2: AI Slides Agent (1 周)

1. **后端实现**
   - [ ] Slides Agent 主类
   - [ ] Slides Planner (大纲生成)
   - [ ] Slides Generator (内容生成)
   - [ ] Slides Renderer (PPTX 导出)
   - [ ] 注册相关工具

2. **前端实现**
   - [ ] Slides 页面 (/ai-office/slides)
   - [ ] SlidesAgent 组件
   - [ ] SlidePreview 组件
   - [ ] OutlinePanel 组件
   - [ ] ThemeSelector 组件

### Phase 3: AI Docs Agent (1 周)

1. **后端实现**
   - [ ] Docs Agent 主类
   - [ ] Docs Researcher (资料收集)
   - [ ] Docs Writer (内容撰写)
   - [ ] DOCX 导出工具

2. **前端实现**
   - [ ] Docs 页面 (/ai-office/docs)
   - [ ] DocsAgent 组件
   - [ ] DocumentPreview 组件
   - [ ] SectionEditor 组件

### Phase 4: AI Designer Agent (1 周)

1. **后端实现**
   - [ ] Designer Agent 主类
   - [ ] Design Generator
   - [ ] Image 导出工具

2. **前端实现**
   - [ ] Designer 页面 (/ai-office/designer)
   - [ ] DesignerAgent 组件
   - [ ] DesignCanvas 组件
   - [ ] StylePanel 组件

### Phase 5: AI Developer Agent (1 周)

1. **后端实现**
   - [ ] Developer Agent 主类
   - [ ] Code Generator
   - [ ] Code 导出工具

2. **前端实现**
   - [ ] Developer 页面 (/ai-office/developer)
   - [ ] DeveloperAgent 组件
   - [ ] CodePreview 组件
   - [ ] FileTree 组件

### Phase 6: 入口页和集成 (3-5 天)

1. **入口页面**
   - [ ] Agent 选择器界面
   - [ ] 智能路由输入框
   - [ ] 最近任务列表

2. **迁移和清理**
   - [ ] 迁移现有 PPT 3.0 功能
   - [ ] 迁移现有文档功能
   - [ ] 清理旧代码
   - [ ] 更新文档

---

## 七、关键设计决策

### 7.1 保留 vs 重写

| 功能         | 决策             | 原因           |
| ------------ | ---------------- | -------------- |
| PPT 3.0 流程 | 迁移到新架构     | 核心逻辑可复用 |
| 版本管理     | 保留             | 完整且稳定     |
| 资源引用     | 保留             | 功能完善       |
| AI 模型系统  | 保留             | 已完成动态化   |
| 聊天界面     | 替换为 PromptBar | 简化交互       |
| 经典布局     | 移除             | 不符合新设计   |

### 7.2 技术选型

| 技术     | 选择               | 备注                |
| -------- | ------------------ | ------------------- |
| 状态管理 | Zustand            | 保持现有            |
| SSE 实现 | NestJS Observable  | 保持现有            |
| 文件生成 | python-pptx, docx  | 保持现有            |
| 图像生成 | 复用 AI-Image 模块 |                     |
| 工具编排 | 自研               | 参考 LangChain 设计 |

### 7.3 透明推理 (Transparent Reasoning)

参考 Genspark，展示 Agent 的思考过程：

```tsx
// 进度面板示例
<ProgressTracker>
  <Step status="complete">📝 分析需求: 生成 10 页科技趋势 PPT</Step>
  <Step status="complete">🔍 调用工具: web_search("2025 科技趋势")</Step>
  <Step status="active">🎨 生成内容: 第 4/10 页</Step>
  <Step status="pending">📊 生成图表</Step>
  <Step status="pending">📁 导出 PPTX</Step>
</ProgressTracker>
```

---

## 八、风险和缓解

| 风险         | 影响          | 缓解措施                 |
| ------------ | ------------- | ------------------------ |
| 重构范围大   | 工期延长      | 分阶段实施，保持可用状态 |
| 现有功能中断 | 用户体验      | 新旧系统并行，渐进切换   |
| 性能问题     | Agent 响应慢  | 优化模型路由，增加缓存   |
| 工具依赖     | 外部 API 限制 | 降级策略，多提供商支持   |

---

## 九、成功指标

- [ ] 4 个专项 Agent 全部可用
- [ ] 端到端生成时间 < 5 分钟 (PPT 10 页)
- [ ] 导出成功率 > 99%
- [ ] UI 响应时间 < 200ms
- [ ] 用户满意度调研
