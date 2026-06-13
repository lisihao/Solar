# AI Agent 工具能力系统 PRD

**产品需求文档**

---

## 文档信息

| 属性     | 内容                                |
| -------- | ----------------------------------- |
| 版本     | v1.0                                |
| 作者     | PM Agent                            |
| 创建日期 | 2025-12-17                          |
| 状态     | 草稿                                |
| 关联模块 | `backend/src/modules/ai/ai-agents/` |

---

## 目录

1. [产品愿景与目标](#1-产品愿景与目标)
2. [功能需求分析](#2-功能需求分析)
3. [系统架构设计](#3-系统架构设计)
4. [数据模型设计](#4-数据模型设计)
5. [API 设计](#5-api-设计)
6. [实现优先级与路线图](#6-实现优先级与路线图)
7. [竞品分析](#7-竞品分析)
8. [风险评估](#8-风险评估)
9. [附录](#9-附录)

---

## 1. 产品愿景与目标

### 1.1 背景分析

#### 当前架构状态

GenesisPod 已具备 AI Agent 系统的基础框架:

```
已实现:
- AgentRegistry: Agent 注册中心 (单例模式)
- ToolRegistry: 工具注册中心 (支持按类别查询)
- AgentOrchestrator: 任务编排、路由、流式事件处理
- BaseAgent/BaseTool: 抽象基类
- 4 个专业 Agent: SlidesAgent, DocsAgent, DesignerAgent, DeveloperAgent
- 14 种工具类型定义

核心缺失:
- 工具的实际实现 (ToolRegistry 有定义但无可执行实例)
- LLM Native Function Calling (无法让 LLM 自主决定调用工具)
- 动态规划能力 (预定义流程，无法根据执行结果调整)
```

#### 问题诊断

| 问题                  | 影响                         | 根因                       |
| --------------------- | ---------------------------- | -------------------------- |
| 工具无实际实现        | Agent 无法完成实际任务       | 只有接口定义，缺少具体实现 |
| 缺乏 Function Calling | LLM 无法自主决策工具调用     | 硬编码工作流，无动态能力   |
| 规划能力固化          | 无法根据中间结果调整执行策略 | plan() 方法返回静态计划    |
| 工具间无协作          | 复杂任务无法分解执行         | 缺少工具编排机制           |

### 1.2 核心价值主张

**让 AI Agent 从"会说话"进化为"能做事"**

构建一个完整的工具能力系统，使 Agent 能够:

1. **自主决策** - LLM 根据任务需求自主选择和调用工具
2. **动态规划** - 根据工具执行结果实时调整执行计划
3. **可扩展** - 新工具可热插拔，无需修改核心代码
4. **可观测** - 完整的执行链路追踪和监控

### 1.3 目标用户场景

#### 场景 1: 智能 PPT 生成

```
用户输入: "帮我做一个关于 2024 年 AI 发展趋势的 PPT"

Agent 行为:
1. [WEB_SEARCH] 搜索 "2024 AI 发展趋势"
2. [WEB_SCRAPER] 抓取搜索结果中的关键文章
3. [TEXT_GENERATION] 分析内容生成大纲
4. [TEXT_GENERATION] 为每页生成内容
5. [IMAGE_GENERATION] 生成配图
6. [EXPORT_PPTX] 导出 PPT 文件
```

#### 场景 2: 数据分析报告

```
用户输入: "分析这份销售数据，生成季度报告"
用户上传: sales_q4_2024.xlsx

Agent 行为:
1. [DATA_FETCH] 解析 Excel 数据
2. [DATA_ANALYSIS] 执行统计分析
3. [TEXT_GENERATION] 生成分析结论
4. [IMAGE_GENERATION] 生成可视化图表
5. [EXPORT_DOCX] 导出 Word 报告
```

#### 场景 3: 代码开发助手

```
用户输入: "帮我实现一个用户登录功能，要有邮箱验证"

Agent 行为:
1. [WEB_SEARCH] 搜索最佳实践
2. [CODE_GENERATION] 生成后端 API 代码
3. [CODE_GENERATION] 生成前端组件代码
4. [CODE_GENERATION] 生成测试用例
5. [TEXT_GENERATION] 生成使用文档
```

### 1.4 成功指标 (KPIs)

| 指标           | 当前值 | 目标值 | 衡量方式                |
| -------------- | ------ | ------ | ----------------------- |
| 工具实现覆盖率 | 0%     | 100%   | 已实现工具数/定义工具数 |
| 任务完成率     | -      | > 85%  | 成功完成的任务比例      |
| 平均任务耗时   | -      | < 60s  | 从输入到产出的时间      |
| 工具调用成功率 | -      | > 95%  | 成功调用次数/总调用次数 |
| 动态规划触发率 | 0%     | > 30%  | 执行中调整计划的比例    |
| 用户满意度     | -      | > 4.0  | 5 分制评分              |

---

## 2. 功能需求分析

### 2.1 工具能力体系设计

#### 2.1.1 工具分类与定义

```
工具能力金字塔:

                    ┌─────────────┐
                    │  导出层     │  EXPORT_PPTX, EXPORT_DOCX, EXPORT_PDF, EXPORT_IMAGE
                    ├─────────────┤
                    │  生成层     │  TEXT_GENERATION, IMAGE_GENERATION, CODE_GENERATION
                    ├─────────────┤
                    │  处理层     │  DATA_ANALYSIS, FILE_CONVERSION
                    ├─────────────┤
                    │  获取层     │  WEB_SEARCH, WEB_SCRAPER, DATA_FETCH
                    └─────────────┘
```

#### 2.1.2 工具能力矩阵

| 工具类型         | 输入              | 输出         | 依赖服务          | 优先级 |
| ---------------- | ----------------- | ------------ | ----------------- | ------ |
| WEB_SEARCH       | 查询词            | 搜索结果列表 | Bing/Google API   | P0     |
| WEB_SCRAPER      | URL               | 结构化内容   | Puppeteer/Cheerio | P0     |
| DATA_FETCH       | 资源ID/文件       | 结构化数据   | 内部服务          | P0     |
| TEXT_GENERATION  | Prompt + Context  | 生成文本     | LLM API           | P0     |
| IMAGE_GENERATION | Prompt            | 图片 URL     | DALL-E/SD         | P1     |
| CODE_GENERATION  | Prompt + Language | 代码块       | LLM API           | P1     |
| DATA_ANALYSIS    | 数据集            | 分析结果     | 内部算法          | P1     |
| FILE_CONVERSION  | 文件 + 目标格式   | 转换后文件   | 各格式库          | P2     |
| EXPORT_PPTX      | Slide Data        | PPTX 文件    | pptxgenjs         | P0     |
| EXPORT_DOCX      | Document Data     | DOCX 文件    | docx              | P0     |
| EXPORT_PDF       | Document/HTML     | PDF 文件     | Puppeteer         | P1     |
| EXPORT_IMAGE     | Canvas/SVG Data   | Image 文件   | sharp             | P2     |

### 2.2 Agent 规划与执行流程

#### 2.2.1 ReAct 模式设计

采用 **ReAct (Reasoning + Acting)** 模式，让 Agent 在推理和行动间循环:

```
┌──────────────────────────────────────────────────────────────────────┐
│                          ReAct 循环                                   │
│                                                                      │
│   ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐          │
│   │ Observe │───>│  Think  │───>│   Act   │───>│ Observe │──> ...   │
│   │ 观察    │    │  思考   │    │  行动   │    │  观察   │          │
│   └─────────┘    └─────────┘    └─────────┘    └─────────┘          │
│        │              │              │              │                │
│        v              v              v              v                │
│   用户输入      分析需求      调用工具      获取结果                  │
│   工具结果      制定计划      执行操作      更新状态                  │
│   环境状态      选择工具      生成输出      评估进度                  │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

#### 2.2.2 执行状态机

```
                              ┌──────────────────┐
                              │                  │
                              v                  │
┌─────────┐    ┌──────────┐    ┌───────────┐    ┌───────────┐    ┌───────────┐
│ PENDING │───>│ PLANNING │───>│ EXECUTING │───>│ COMPLETED │    │  FAILED   │
└─────────┘    └──────────┘    └───────────┘    └───────────┘    └───────────┘
                    │               │                                   ^
                    │               │                                   │
                    │               └───────────────────────────────────┘
                    │                           (执行错误)
                    │
                    └──> CANCELLED (用户取消)
```

#### 2.2.3 动态规划机制

```typescript
interface DynamicPlanning {
  // 初始规划
  initialPlan: AgentPlan;

  // 执行上下文 (累积的中间结果)
  executionContext: {
    completedSteps: PlanStep[];
    toolResults: Map<string, ToolResult>;
    observations: string[];
  };

  // 重规划触发条件
  replanTriggers: {
    toolFailure: boolean; // 工具执行失败
    unexpectedResult: boolean; // 结果不符预期
    newInformation: boolean; // 发现新信息
    userInterrupt: boolean; // 用户干预
  };

  // 重规划策略
  replanStrategy: "retry" | "skip" | "alternative" | "abort";
}
```

### 2.3 Function Calling 集成方案

#### 2.3.1 工具描述格式 (OpenAI Function Format)

```typescript
interface FunctionDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<
      string,
      {
        type: string;
        description: string;
        enum?: string[];
      }
    >;
    required: string[];
  };
}

// 示例: WEB_SEARCH 工具
const webSearchFunction: FunctionDefinition = {
  name: "web_search",
  description:
    "搜索互联网获取最新信息。适用于需要实时数据、新闻、或需要验证的信息。",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "搜索查询词",
      },
      num_results: {
        type: "number",
        description: "返回结果数量，默认 5",
      },
      language: {
        type: "string",
        description: "搜索语言",
        enum: ["zh-CN", "en-US", "auto"],
      },
    },
    required: ["query"],
  },
};
```

#### 2.3.2 多模型适配层

```typescript
interface LLMAdapter {
  // 将工具转换为模型特定格式
  formatTools(tools: ITool[]): unknown;

  // 解析模型的工具调用响应
  parseToolCalls(response: unknown): ToolCallRequest[];

  // 构建带工具结果的后续消息
  buildToolResultMessage(toolResult: ToolResult): unknown;
}

// 支持的 LLM Provider
type SupportedProvider =
  | "openai" // gpt-4, gpt-3.5-turbo (function calling)
  | "anthropic" // claude-3 (tool use)
  | "google" // gemini (function declarations)
  | "deepseek"; // deepseek-chat (function calling)
```

#### 2.3.3 工具调用流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Function Calling 流程                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   User Input                                                                │
│       │                                                                     │
│       v                                                                     │
│   ┌─────────────────────┐                                                   │
│   │ 1. 构建 Prompt      │  包含系统提示 + 用户输入 + 工具列表               │
│   └─────────────────────┘                                                   │
│       │                                                                     │
│       v                                                                     │
│   ┌─────────────────────┐                                                   │
│   │ 2. 调用 LLM API     │  携带 functions/tools 参数                        │
│   └─────────────────────┘                                                   │
│       │                                                                     │
│       v                                                                     │
│   ┌─────────────────────┐    ┌─────────────────────────────────────────┐   │
│   │ 3. 解析响应         │───>│ 3a. 包含 tool_calls?                    │   │
│   └─────────────────────┘    └─────────────────────────────────────────┘   │
│       │                           │ Yes                    │ No            │
│       │                           v                        v               │
│       │                   ┌───────────────┐        ┌───────────────┐       │
│       │                   │ 4. 执行工具   │        │ 返回最终响应  │       │
│       │                   └───────────────┘        └───────────────┘       │
│       │                           │                                         │
│       │                           v                                         │
│       │                   ┌───────────────┐                                │
│       │                   │ 5. 构建结果   │                                │
│       │                   │    消息       │                                │
│       │                   └───────────────┘                                │
│       │                           │                                         │
│       └───────────────────────────┘ (循环回到步骤 2)                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.4 用户交互设计

#### 2.4.1 任务执行可视化

```
┌─────────────────────────────────────────────────────────────────┐
│                    任务执行面板                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  任务: 生成 2024 AI 趋势分析 PPT                                 │
│  状态: 执行中 ●                                                  │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 执行计划                                                 │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ [x] 1. 搜索 AI 发展趋势资料          完成 (3.2s)         │   │
│  │ [x] 2. 抓取关键文章内容              完成 (8.5s)         │   │
│  │ [>] 3. 分析内容生成大纲              进行中...           │   │
│  │ [ ] 4. 生成幻灯片内容                等待中              │   │
│  │ [ ] 5. 生成配图                      等待中              │   │
│  │ [ ] 6. 导出 PPT                      等待中              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 工具调用日志                                             │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ 14:32:01 [WEB_SEARCH] 搜索 "2024 AI 发展趋势"           │   │
│  │          返回 10 条结果                                  │   │
│  │ 14:32:04 [WEB_SCRAPER] 抓取 https://example.com/ai...   │   │
│  │          提取 2,450 字内容                               │   │
│  │ 14:32:12 [TEXT_GENERATION] 分析内容中...                │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  [ 暂停 ]  [ 取消 ]  [ 查看详情 ]                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### 2.4.2 工具执行反馈

```typescript
interface ToolExecutionFeedback {
  // 实时进度
  progress: {
    stepId: string;
    percentage: number; // 0-100
    message: string;
  };

  // 工具调用通知
  toolCall: {
    toolType: ToolType;
    input: unknown;
    startTime: Date;
  };

  // 工具结果通知
  toolResult: {
    toolType: ToolType;
    success: boolean;
    summary: string;
    duration: number;
  };

  // 规划变更通知
  planChange: {
    reason: string;
    originalStep: PlanStep;
    newStep: PlanStep;
  };
}
```

---

## 3. 系统架构设计

### 3.1 整体架构图

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                              Client Layer                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │
│  │ Web Client  │  │ Mobile App  │  │ API Client  │  │ CLI Tool    │           │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘           │
└─────────┼────────────────┼────────────────┼────────────────┼──────────────────┘
          │                │                │                │
          └────────────────┴────────────────┴────────────────┘
                                    │
                                    v
┌───────────────────────────────────────────────────────────────────────────────┐
│                              API Gateway                                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │  /api/agents/execute  │  /api/agents/tasks/:id  │  /api/tools           │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    v
┌───────────────────────────────────────────────────────────────────────────────┐
│                           Orchestration Layer                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐               │
│  │ AgentOrchestrator│  │ PlanningEngine │  │ ExecutionEngine │               │
│  │                 │──>│                │──>│                 │               │
│  │ - 任务调度      │  │ - 动态规划     │  │ - 工具执行      │               │
│  │ - Agent 路由    │  │ - 重规划       │  │ - 结果聚合      │               │
│  │ - 会话管理      │  │ - 优化器       │  │ - 错误恢复      │               │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘               │
└───────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    v
┌───────────────────────────────────────────────────────────────────────────────┐
│                              Agent Layer                                       │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  │
│  │ SlidesAgent   │  │ DocsAgent     │  │ DesignerAgent │  │ DeveloperAgent│  │
│  │               │  │               │  │               │  │               │  │
│  │ - PPT 生成    │  │ - 文档生成    │  │ - 设计生成    │  │ - 代码生成    │  │
│  │ - 模板选择    │  │ - 结构规划    │  │ - 风格控制    │  │ - 语言支持    │  │
│  └───────────────┘  └───────────────┘  └───────────────┘  └───────────────┘  │
└───────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    v
┌───────────────────────────────────────────────────────────────────────────────┐
│                               Tool Layer                                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                           ToolRegistry                                   │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │  │                         Tool Implementations                     │   │ │
│  │  │ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────────────┐│   │ │
│  │  │ │WebSearch  │ │WebScraper │ │DataFetch  │ │TextGeneration     ││   │ │
│  │  │ └───────────┘ └───────────┘ └───────────┘ └───────────────────┘│   │ │
│  │  │ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────────────┐│   │ │
│  │  │ │ImageGen   │ │CodeGen    │ │DataAnalysis│ │FileConversion    ││   │ │
│  │  │ └───────────┘ └───────────┘ └───────────┘ └───────────────────┘│   │ │
│  │  │ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────────────┐│   │ │
│  │  │ │ExportPPTX │ │ExportDOCX │ │ExportPDF  │ │ExportImage        ││   │ │
│  │  │ └───────────┘ └───────────┘ └───────────┘ └───────────────────┘│   │ │
│  │  └─────────────────────────────────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    v
┌───────────────────────────────────────────────────────────────────────────────┐
│                           LLM Adapter Layer                                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐               │
│  │ OpenAIAdapter   │  │ AnthropicAdapter│  │ GoogleAdapter   │               │
│  │                 │  │                 │  │                 │               │
│  │ - function      │  │ - tool use      │  │ - function      │               │
│  │   calling       │  │                 │  │   declarations  │               │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘               │
└───────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    v
┌───────────────────────────────────────────────────────────────────────────────┐
│                           External Services                                    │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐    │
│  │ OpenAI  │ │Anthropic│ │ Google  │ │Bing API │ │ DALL-E  │ │ Storage │    │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘    │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 工具注册与发现机制

#### 3.2.1 工具生命周期

```
┌─────────────────────────────────────────────────────────────────┐
│                      Tool Lifecycle                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐ │
│   │  Define  │───>│ Register │───>│  Active  │───>│ Disabled │ │
│   │  定义    │    │  注册    │    │  激活    │    │  禁用    │ │
│   └──────────┘    └──────────┘    └──────────┘    └──────────┘ │
│        │               │               │               │        │
│        v               v               v               v        │
│   - 实现接口      - 验证Schema    - 可被调用      - 暂停服务   │
│   - 定义Schema    - 注入依赖      - 健康检查      - 维护升级   │
│   - 配置参数      - 初始化        - 统计收集      - 可恢复     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### 3.2.2 工具注册流程

```typescript
// 工具模块启动时自动注册
@Injectable()
export class ToolsModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly webSearchTool: WebSearchTool,
    private readonly webScraperTool: WebScraperTool,
    // ... 其他工具
  ) {}

  async onModuleInit() {
    // 批量注册所有工具
    this.toolRegistry.registerMany([
      this.webSearchTool,
      this.webScraperTool,
      // ... 其他工具
    ]);

    // 验证工具健康状态
    await this.validateToolHealth();
  }

  private async validateToolHealth() {
    const tools = this.toolRegistry.getAll();
    for (const tool of tools) {
      if (tool.healthCheck) {
        const healthy = await tool.healthCheck();
        if (!healthy) {
          this.logger.warn(`Tool ${tool.type} health check failed`);
        }
      }
    }
  }
}
```

#### 3.2.3 工具发现 API

```typescript
// 获取所有可用工具 (用于 Function Calling)
interface ToolDiscovery {
  // 获取所有工具的 Function 定义
  getFunctionDefinitions(): FunctionDefinition[];

  // 按类别获取工具
  getToolsByCategory(category: string): ITool[];

  // 按 Agent 获取兼容工具
  getToolsForAgent(agentType: AgentType): ITool[];

  // 检查工具可用性
  isToolAvailable(toolType: ToolType): boolean;
}
```

### 3.3 动态规划引擎

#### 3.3.1 规划引擎架构

```typescript
interface PlanningEngine {
  // 初始规划: 根据任务生成执行计划
  createPlan(task: AgentInput, context: PlanningContext): Promise<AgentPlan>;

  // 重规划: 根据执行情况调整计划
  replan(
    currentPlan: AgentPlan,
    executionState: ExecutionState,
    trigger: ReplanTrigger,
  ): Promise<AgentPlan>;

  // 计划优化: 优化执行顺序和并行度
  optimizePlan(plan: AgentPlan): AgentPlan;
}

interface ReplanTrigger {
  type: "tool_failure" | "unexpected_result" | "new_information" | "timeout";
  stepId: string;
  details: unknown;
}

interface ExecutionState {
  completedSteps: string[];
  toolResults: Map<string, ToolResult>;
  currentStep: string;
  elapsedTime: number;
  errors: Error[];
}
```

#### 3.3.2 LLM 驱动的规划

```typescript
// 使用 LLM 进行动态规划
async function createPlanWithLLM(
  task: AgentInput,
  availableTools: ITool[],
  context: PlanningContext,
): Promise<AgentPlan> {
  const systemPrompt = `
你是一个任务规划专家。根据用户任务和可用工具，创建执行计划。

可用工具:
${availableTools.map((t) => `- ${t.name}: ${t.description}`).join("\n")}

规划原则:
1. 将复杂任务分解为简单步骤
2. 识别步骤间的依赖关系
3. 尽可能并行执行独立步骤
4. 考虑工具的输入输出匹配
5. 预留错误恢复方案
`;

  const response = await llm.chat({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: task.prompt },
    ],
    functions: [
      {
        name: "create_plan",
        parameters: {
          type: "object",
          properties: {
            steps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  tool: { type: "string" },
                  dependencies: { type: "array", items: { type: "string" } },
                  input: { type: "object" },
                },
              },
            },
          },
        },
      },
    ],
  });

  return parsePlanFromResponse(response);
}
```

### 3.4 执行监控与反馈

#### 3.4.1 监控指标

```typescript
interface ExecutionMetrics {
  // 任务级指标
  task: {
    id: string;
    startTime: Date;
    endTime?: Date;
    status: AgentTaskStatus;
    totalSteps: number;
    completedSteps: number;
  };

  // 工具级指标
  tools: {
    [toolType: string]: {
      callCount: number;
      successCount: number;
      failureCount: number;
      totalDuration: number;
      avgDuration: number;
      lastError?: string;
    };
  };

  // LLM 使用指标
  llm: {
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    estimatedCost: number;
    callCount: number;
  };
}
```

#### 3.4.2 实时事件流

```typescript
// SSE 事件类型
type ExecutionSSEEvent =
  | { type: "plan_created"; plan: AgentPlan }
  | { type: "step_started"; stepId: string; message: string }
  | { type: "step_progress"; stepId: string; progress: number }
  | { type: "step_completed"; stepId: string; result: unknown }
  | { type: "tool_calling"; tool: ToolType; input: unknown }
  | { type: "tool_result"; tool: ToolType; result: ToolResult }
  | { type: "plan_changed"; reason: string; newPlan: AgentPlan }
  | { type: "error"; error: string; stepId?: string }
  | { type: "completed"; result: AgentResult };
```

### 3.5 错误处理与重试策略

#### 3.5.1 错误分类

```typescript
enum ToolErrorType {
  // 可重试错误
  RATE_LIMIT = "RATE_LIMIT", // API 限流
  TIMEOUT = "TIMEOUT", // 超时
  NETWORK_ERROR = "NETWORK_ERROR", // 网络错误
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE", // 服务不可用

  // 需要降级/替代的错误
  QUOTA_EXCEEDED = "QUOTA_EXCEEDED", // 配额用尽
  FEATURE_NOT_SUPPORTED = "FEATURE_NOT_SUPPORTED", // 功能不支持

  // 不可恢复错误
  INVALID_INPUT = "INVALID_INPUT", // 输入无效
  PERMISSION_DENIED = "PERMISSION_DENIED", // 权限拒绝
  RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND", // 资源不存在
}
```

#### 3.5.2 重试策略

```typescript
interface RetryStrategy {
  // 最大重试次数
  maxRetries: number;

  // 重试延迟 (指数退避)
  getDelay(attempt: number): number;

  // 是否应该重试
  shouldRetry(error: ToolError): boolean;

  // 重试时的替代策略
  getFallback(error: ToolError): ToolType | null;
}

const defaultRetryStrategy: RetryStrategy = {
  maxRetries: 3,

  getDelay(attempt: number): number {
    // 指数退避: 1s, 2s, 4s, 8s...
    return Math.min(1000 * Math.pow(2, attempt), 30000);
  },

  shouldRetry(error: ToolError): boolean {
    return [
      ToolErrorType.RATE_LIMIT,
      ToolErrorType.TIMEOUT,
      ToolErrorType.NETWORK_ERROR,
      ToolErrorType.SERVICE_UNAVAILABLE,
    ].includes(error.type);
  },

  getFallback(error: ToolError): ToolType | null {
    // 工具降级映射
    const fallbacks: Record<ToolType, ToolType | null> = {
      [ToolType.WEB_SEARCH]: null, // 无替代
      [ToolType.IMAGE_GENERATION]: null, // 可以跳过
      // ...
    };
    return fallbacks[error.toolType];
  },
};
```

---

## 4. 数据模型设计

### 4.1 工具定义 Schema

```typescript
// Prisma Schema
model Tool {
  id          String    @id @default(uuid())
  type        ToolType  @unique
  name        String
  description String
  version     String    @default("1.0.0")

  // 配置
  config      Json      // { timeout, retries, rateLimit, ... }

  // Schema 定义
  inputSchema  Json     // JSON Schema for input validation
  outputSchema Json     // JSON Schema for output

  // 状态
  enabled     Boolean   @default(true)
  healthStatus ToolHealthStatus @default(UNKNOWN)
  lastHealthCheck DateTime?

  // 统计
  totalCalls    Int     @default(0)
  successCalls  Int     @default(0)
  avgDuration   Float   @default(0)

  // 时间戳
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  // 关联
  executions  ToolExecution[]
}

enum ToolType {
  WEB_SEARCH
  WEB_SCRAPER
  DATA_FETCH
  TEXT_GENERATION
  IMAGE_GENERATION
  CODE_GENERATION
  DATA_ANALYSIS
  FILE_CONVERSION
  EXPORT_PPTX
  EXPORT_DOCX
  EXPORT_PDF
  EXPORT_IMAGE
}

enum ToolHealthStatus {
  HEALTHY
  DEGRADED
  UNHEALTHY
  UNKNOWN
}
```

### 4.2 执行记录 Schema

```typescript
// Prisma Schema
model AgentExecution {
  id          String    @id @default(uuid())
  taskId      String    @unique // 对应 OfficeAgentTask.id

  // 关联
  userId      String?
  agentType   AgentType

  // 输入
  input       Json      // AgentInput

  // 规划
  initialPlan Json?     // 初始 AgentPlan
  currentPlan Json?     // 当前 AgentPlan (可能经过重规划)
  replanCount Int       @default(0)

  // 状态
  status      ExecutionStatus @default(PENDING)
  currentStep String?
  progress    Float     @default(0) // 0-100

  // 结果
  result      Json?     // AgentResult
  artifacts   Json[]    // 产出物列表

  // 统计
  tokensUsed  Int       @default(0)
  toolCalls   Int       @default(0)
  duration    Int?      // 毫秒

  // 时间戳
  startedAt   DateTime?
  completedAt DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  // 关联
  toolExecutions ToolExecution[]
}

enum ExecutionStatus {
  PENDING
  PLANNING
  EXECUTING
  PAUSED
  COMPLETED
  FAILED
  CANCELLED
}
```

### 4.3 工具执行记录 Schema

```typescript
model ToolExecution {
  id          String    @id @default(uuid())

  // 关联
  executionId String
  execution   AgentExecution @relation(fields: [executionId], references: [id])
  toolId      String?
  tool        Tool?     @relation(fields: [toolId], references: [id])

  // 执行信息
  toolType    ToolType
  stepId      String    // 对应 PlanStep.id
  input       Json

  // 结果
  status      ToolExecutionStatus @default(PENDING)
  output      Json?
  error       String?

  // 重试信息
  attemptNumber Int     @default(1)
  retryable   Boolean   @default(false)

  // 性能
  duration    Int?      // 毫秒
  tokensUsed  Int?      // 如果涉及 LLM

  // 时间戳
  startedAt   DateTime?
  completedAt DateTime?
  createdAt   DateTime  @default(now())

  @@index([executionId])
  @@index([toolType])
  @@index([status])
}

enum ToolExecutionStatus {
  PENDING
  RUNNING
  COMPLETED
  FAILED
  SKIPPED
  RETRYING
}
```

### 4.4 规划状态 Schema

```typescript
model PlanState {
  id          String    @id @default(uuid())
  executionId String    @unique

  // 当前计划
  plan        Json      // AgentPlan

  // 步骤状态
  stepStates  Json      // Map<stepId, StepState>

  // 上下文
  context     Json      // 累积的执行上下文

  // 观察记录
  observations Json[]   // LLM 的观察/思考记录

  // 重规划历史
  replanHistory Json[]  // { trigger, oldPlan, newPlan, timestamp }

  // 时间戳
  updatedAt   DateTime  @updatedAt
}

// StepState 结构
interface StepState {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startTime?: Date;
  endTime?: Date;
  result?: unknown;
  error?: string;
  dependencies: string[];
  dependencyResults: Map<string, unknown>;
}
```

---

## 5. API 设计

### 5.1 工具管理 API

```typescript
// GET /api/tools
// 获取所有已注册的工具
interface GetToolsResponse {
  tools: {
    type: ToolType;
    name: string;
    description: string;
    category: string;
    enabled: boolean;
    healthStatus: ToolHealthStatus;
    inputSchema: JSONSchema;
    outputSchema: JSONSchema;
  }[];
}

// GET /api/tools/:type
// 获取特定工具详情
interface GetToolResponse {
  tool: {
    type: ToolType;
    name: string;
    description: string;
    category: string;
    enabled: boolean;
    healthStatus: ToolHealthStatus;
    inputSchema: JSONSchema;
    outputSchema: JSONSchema;
    config: {
      timeout: number;
      retries: number;
      rateLimit: number;
    };
    stats: {
      totalCalls: number;
      successRate: number;
      avgDuration: number;
    };
  };
}

// POST /api/tools/:type/test
// 测试工具执行
interface TestToolRequest {
  input: unknown;
}

interface TestToolResponse {
  success: boolean;
  result?: unknown;
  error?: string;
  duration: number;
}

// PATCH /api/tools/:type
// 更新工具配置
interface UpdateToolRequest {
  enabled?: boolean;
  config?: {
    timeout?: number;
    retries?: number;
    rateLimit?: number;
  };
}

// GET /api/tools/functions
// 获取所有工具的 Function Calling 定义
interface GetFunctionsResponse {
  functions: FunctionDefinition[];
}
```

### 5.2 Agent 执行 API

```typescript
// POST /api/agents/execute
// 执行 Agent 任务
interface ExecuteAgentRequest {
  agentType?: AgentType; // 可选，不指定则自动路由
  prompt: string;
  files?: UploadedFile[];
  urls?: string[];
  resourceIds?: string[];
  templateId?: string;
  options?: {
    // 执行选项
    maxSteps?: number; // 最大执行步骤
    timeout?: number; // 总超时时间
    enableReplan?: boolean; // 是否启用动态重规划
    parallelTools?: boolean; // 是否并行执行工具

    // LLM 选项
    model?: string; // 指定使用的模型
    temperature?: number; // 温度参数
  };
}

interface ExecuteAgentResponse {
  taskId: string;
  status: "pending";
  estimatedTime?: number; // 预估耗时 (毫秒)
}

// GET /api/agents/tasks/:taskId
// 获取任务状态
interface GetTaskResponse {
  task: {
    id: string;
    status: ExecutionStatus;
    agentType: AgentType;
    input: AgentInput;
    plan?: AgentPlan;
    progress: number;
    currentStep?: string;
    result?: AgentResult;
    error?: string;
    createdAt: Date;
    startedAt?: Date;
    completedAt?: Date;
  };
}

// SSE: GET /api/agents/tasks/:taskId/stream
// 任务执行事件流
// Content-Type: text/event-stream
// Events: plan_created, step_started, step_progress, step_completed,
//         tool_calling, tool_result, plan_changed, error, completed

// POST /api/agents/tasks/:taskId/pause
// 暂停任务
interface PauseTaskResponse {
  success: boolean;
  canResume: boolean;
}

// POST /api/agents/tasks/:taskId/resume
// 恢复任务
interface ResumeTaskResponse {
  success: boolean;
}

// POST /api/agents/tasks/:taskId/cancel
// 取消任务
interface CancelTaskResponse {
  success: boolean;
}

// POST /api/agents/tasks/:taskId/replan
// 手动触发重规划
interface ReplanRequest {
  reason: string;
  hints?: string; // 给 LLM 的重规划提示
}

interface ReplanResponse {
  success: boolean;
  newPlan?: AgentPlan;
}
```

### 5.3 监控与日志 API

```typescript
// GET /api/agents/metrics
// 获取执行指标统计
interface GetMetricsRequest {
  timeRange?: {
    start: Date;
    end: Date;
  };
  agentType?: AgentType;
}

interface GetMetricsResponse {
  summary: {
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    avgDuration: number;
    totalTokens: number;
    totalCost: number;
  };
  byAgent: {
    [agentType: string]: {
      tasks: number;
      successRate: number;
      avgDuration: number;
    };
  };
  byTool: {
    [toolType: string]: {
      calls: number;
      successRate: number;
      avgDuration: number;
    };
  };
  timeline: {
    date: string;
    tasks: number;
    success: number;
    failed: number;
  }[];
}

// GET /api/agents/tasks/:taskId/logs
// 获取任务执行日志
interface GetLogsResponse {
  logs: {
    timestamp: Date;
    level: "info" | "warn" | "error" | "debug";
    message: string;
    stepId?: string;
    toolType?: ToolType;
    metadata?: unknown;
  }[];
}

// GET /api/agents/tasks/:taskId/trace
// 获取完整执行链路
interface GetTraceResponse {
  trace: {
    id: string;
    taskId: string;
    spans: {
      id: string;
      name: string;
      type: "agent" | "planning" | "tool" | "llm";
      startTime: Date;
      endTime: Date;
      duration: number;
      status: "ok" | "error";
      attributes: Record<string, unknown>;
      children?: string[]; // 子 span id
    }[];
  };
}

// GET /api/tools/:type/health
// 获取工具健康状态
interface GetToolHealthResponse {
  status: ToolHealthStatus;
  lastCheck: Date;
  details: {
    latency: number;
    errorRate: number;
    availability: number;
  };
}
```

---

## 6. 实现优先级与路线图

### 6.1 功能优先级划分

#### P0 - 核心必需 (第一阶段)

| 功能                     | 描述                      | 工时估算 |
| ------------------------ | ------------------------- | -------- |
| WEB_SEARCH 工具实现      | 集成 Bing/Google 搜索 API | 2d       |
| WEB_SCRAPER 工具实现     | 基于 Puppeteer 的网页抓取 | 3d       |
| TEXT_GENERATION 工具实现 | 封装 LLM 调用             | 1d       |
| EXPORT_PPTX 工具实现     | 复用现有 PPT 生成能力     | 1d       |
| EXPORT_DOCX 工具实现     | 复用现有文档生成能力      | 1d       |
| Function Calling 集成    | OpenAI/Anthropic 适配     | 3d       |
| 基础执行引擎             | 工具调用执行和结果收集    | 3d       |
| 执行事件流               | SSE 实时进度推送          | 2d       |

**小计: 16 工作日**

#### P1 - 重要功能 (第二阶段)

| 功能                      | 描述               | 工时估算 |
| ------------------------- | ------------------ | -------- |
| DATA_FETCH 工具实现       | 资源数据获取       | 2d       |
| IMAGE_GENERATION 工具实现 | DALL-E/SD 图像生成 | 3d       |
| CODE_GENERATION 工具实现  | 代码生成封装       | 1d       |
| DATA_ANALYSIS 工具实现    | 数据分析算法       | 3d       |
| EXPORT_PDF 工具实现       | PDF 导出能力       | 2d       |
| 动态规划引擎              | 基于 LLM 的重规划  | 5d       |
| 错误重试策略              | 指数退避、降级处理 | 2d       |
| 执行监控指标              | 性能、成本统计     | 2d       |

**小计: 20 工作日**

#### P2 - 增强功能 (第三阶段)

| 功能                     | 描述                         | 工时估算 |
| ------------------------ | ---------------------------- | -------- |
| FILE_CONVERSION 工具实现 | 文件格式转换                 | 3d       |
| EXPORT_IMAGE 工具实现    | 图片导出                     | 1d       |
| 并行工具执行             | 独立工具并行调度             | 3d       |
| 工具健康检查             | 自动检测工具可用性           | 2d       |
| 执行链路追踪             | 完整的 trace 支持            | 3d       |
| 多模型适配               | Google Gemini、DeepSeek 支持 | 3d       |
| 工具热插拔               | 运行时注册/注销工具          | 2d       |
| 执行缓存                 | 工具结果缓存复用             | 2d       |

**小计: 19 工作日**

### 6.2 分阶段实现计划

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           实现路线图                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Phase 1: 核心能力 (Week 1-3)                                               │
│  ├── Week 1: 工具实现基础                                                   │
│  │   ├── Day 1-2: WEB_SEARCH 工具                                           │
│  │   ├── Day 3-5: WEB_SCRAPER 工具                                          │
│  ├── Week 2: 执行能力                                                       │
│  │   ├── Day 1: TEXT_GENERATION 工具                                        │
│  │   ├── Day 2-3: Function Calling 集成 (OpenAI)                            │
│  │   ├── Day 4-5: 基础执行引擎                                              │
│  ├── Week 3: 导出与事件                                                     │
│  │   ├── Day 1: EXPORT_PPTX 工具                                            │
│  │   ├── Day 2: EXPORT_DOCX 工具                                            │
│  │   ├── Day 3-4: 执行事件流 (SSE)                                          │
│  │   ├── Day 5: 集成测试                                                    │
│  │                                                                          │
│  >>> Milestone 1: Agent 能够执行简单的搜索-分析-生成任务 <<<                  │
│                                                                             │
│  Phase 2: 增强能力 (Week 4-7)                                               │
│  ├── Week 4: 更多工具                                                       │
│  │   ├── Day 1-2: DATA_FETCH 工具                                           │
│  │   ├── Day 3-5: IMAGE_GENERATION 工具                                     │
│  ├── Week 5: 规划能力                                                       │
│  │   ├── Day 1: CODE_GENERATION 工具                                        │
│  │   ├── Day 2-5: 动态规划引擎                                              │
│  ├── Week 6: 可靠性                                                         │
│  │   ├── Day 1-3: DATA_ANALYSIS 工具                                        │
│  │   ├── Day 4-5: 错误重试策略                                              │
│  ├── Week 7: 监控与导出                                                     │
│  │   ├── Day 1-2: EXPORT_PDF 工具                                           │
│  │   ├── Day 3-4: 执行监控指标                                              │
│  │   ├── Day 5: 集成测试                                                    │
│  │                                                                          │
│  >>> Milestone 2: Agent 具备动态规划和完整的工具链 <<<                        │
│                                                                             │
│  Phase 3: 优化扩展 (Week 8-11)                                              │
│  ├── Week 8: 扩展工具                                                       │
│  │   ├── Day 1-3: FILE_CONVERSION 工具                                      │
│  │   ├── Day 4: EXPORT_IMAGE 工具                                           │
│  │   ├── Day 5: 工具健康检查                                                │
│  ├── Week 9: 并行与追踪                                                     │
│  │   ├── Day 1-3: 并行工具执行                                              │
│  │   ├── Day 4-5: 工具健康检查 (续)                                         │
│  ├── Week 10: 追踪与适配                                                    │
│  │   ├── Day 1-3: 执行链路追踪                                              │
│  │   ├── Day 4-5: 多模型适配 (开始)                                         │
│  ├── Week 11: 完善与优化                                                    │
│  │   ├── Day 1: 多模型适配 (完成)                                           │
│  │   ├── Day 2-3: 工具热插拔                                                │
│  │   ├── Day 4-5: 执行缓存                                                  │
│  │                                                                          │
│  >>> Milestone 3: 生产就绪的工具能力系统 <<<                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.3 里程碑验收标准

#### Milestone 1: 基础执行能力 (Week 3)

```
验收标准:
[x] WEB_SEARCH 工具可正常搜索并返回结果
[x] WEB_SCRAPER 工具可抓取指定网页内容
[x] TEXT_GENERATION 工具可生成文本
[x] EXPORT_PPTX/DOCX 工具可导出文件
[x] Function Calling 可让 LLM 自主选择工具
[x] SSE 可实时推送执行进度
[x] 简单任务端到端可完成

演示场景:
"搜索 AI 最新趋势，生成一份简要报告"
- Agent 调用 WEB_SEARCH 搜索
- Agent 调用 TEXT_GENERATION 生成报告
- Agent 调用 EXPORT_DOCX 导出文档
```

#### Milestone 2: 动态规划能力 (Week 7)

```
验收标准:
[x] 动态规划引擎可根据执行结果调整计划
[x] 工具执行失败可自动重试
[x] 支持图像生成和数据分析
[x] 支持 PDF 导出
[x] 执行指标可正常收集

演示场景:
"分析这份数据，生成带图表的报告"
- Agent 制定初始计划
- Agent 发现数据格式问题，触发重规划
- Agent 完成数据分析，生成图表
- Agent 生成并导出 PDF 报告
```

#### Milestone 3: 生产就绪 (Week 11)

```
验收标准:
[x] 所有 12 种工具类型已实现
[x] 支持并行工具执行
[x] 工具健康检查正常运行
[x] 执行链路追踪完整
[x] 支持多个 LLM Provider
[x] 工具可热插拔
[x] 执行缓存有效

性能指标:
- 任务完成率 > 85%
- 平均任务耗时 < 60s
- 工具调用成功率 > 95%
- P95 延迟 < 120s
```

---

## 7. 竞品分析

### 7.1 LangChain / LangGraph

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          LangChain / LangGraph                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  架构特点:                                                                   │
│  - Chain: 线性工具链，工具间串行执行                                          │
│  - Agent: ReAct 模式，LLM 自主决策工具调用                                    │
│  - Graph: 状态图，支持复杂工作流                                             │
│                                                                             │
│  核心组件:                                                                   │
│  ┌───────────────┐    ┌───────────────┐    ┌───────────────┐               │
│  │ Tools         │    │ Agents        │    │ Memory        │               │
│  │ - 工具抽象    │    │ - ReAct       │    │ - 对话历史    │               │
│  │ - 自动描述    │    │ - OpenAI      │    │ - 向量存储    │               │
│  │ - 类型推导    │    │ - XML         │    │ - Summary     │               │
│  └───────────────┘    └───────────────┘    └───────────────┘               │
│                                                                             │
│  优势:                                                                       │
│  - 生态丰富，大量预置工具和集成                                              │
│  - 文档完善，社区活跃                                                        │
│  - Python/TypeScript 双语言支持                                             │
│  - LangSmith 提供强大的可观测性                                              │
│                                                                             │
│  劣势:                                                                       │
│  - 抽象层次高，自定义困难                                                    │
│  - 学习曲线陡峭                                                             │
│  - 过度封装导致调试困难                                                      │
│                                                                             │
│  可借鉴:                                                                     │
│  - Tool 描述自动生成机制                                                     │
│  - LangGraph 的状态图设计                                                   │
│  - LangSmith 的追踪设计                                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 OpenAI Agents SDK (Swarm)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          OpenAI Agents SDK (Swarm)                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  设计理念:                                                                   │
│  - 轻量级: 仅做最小封装                                                      │
│  - Agent 即 Prompt + Tools                                                   │
│  - Handoff: Agent 间切换                                                     │
│                                                                             │
│  核心概念:                                                                   │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                                                                       │ │
│  │  Agent = {                                                            │ │
│  │    name: string,                                                      │ │
│  │    instructions: string,      // System Prompt                        │ │
│  │    functions: Function[],     // 可用工具                              │ │
│  │    tool_choice: string        // 工具选择策略                          │ │
│  │  }                                                                    │ │
│  │                                                                       │ │
│  │  Handoff = 一个 Agent 将控制权交给另一个 Agent                         │ │
│  │                                                                       │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  优势:                                                                       │
│  - 极简设计，易于理解和调试                                                  │
│  - 与 OpenAI API 原生集成                                                    │
│  - Handoff 机制优雅                                                         │
│                                                                             │
│  劣势:                                                                       │
│  - 功能有限，不适合复杂场景                                                  │
│  - 仅支持 OpenAI                                                            │
│  - 缺乏持久化和可观测性                                                      │
│                                                                             │
│  可借鉴:                                                                     │
│  - 简洁的 Agent 定义方式                                                     │
│  - Handoff 机制用于 Agent 协作                                               │
│  - 工具作为普通函数的设计                                                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.3 Anthropic MCP (Model Context Protocol)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Anthropic MCP                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  设计理念:                                                                   │
│  - 统一协议: 标准化 LLM 与外部系统的交互                                      │
│  - 可组合: Server 提供能力，Client 消费能力                                   │
│  - 安全: 内置权限控制                                                        │
│                                                                             │
│  协议架构:                                                                   │
│  ┌───────────────┐         ┌───────────────┐                               │
│  │  MCP Client   │  <--->  │  MCP Server   │                               │
│  │  (Claude)     │  JSON   │  (Tool Impl)  │                               │
│  └───────────────┘  -RPC   └───────────────┘                               │
│                                                                             │
│  能力类型:                                                                   │
│  - Resources: 数据访问 (文件、数据库)                                        │
│  - Prompts: 预定义的 Prompt 模板                                            │
│  - Tools: 可执行的操作                                                      │
│                                                                             │
│  优势:                                                                       │
│  - 标准化协议，生态可互通                                                    │
│  - Server 可独立部署和升级                                                   │
│  - 内置安全机制                                                             │
│                                                                             │
│  劣势:                                                                       │
│  - 协议相对复杂                                                             │
│  - 生态尚在建设中                                                           │
│  - 主要面向 Claude                                                          │
│                                                                             │
│  可借鉴:                                                                     │
│  - Resource/Tool 分离的设计                                                 │
│  - 标准化的工具描述格式                                                      │
│  - 安全和权限控制机制                                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.4 竞品对比总结

| 维度           | LangChain | OpenAI Swarm | Anthropic MCP | Genesis (本系统) |
| -------------- | --------- | ------------ | ------------- | ---------------- |
| **复杂度**     | 高        | 低           | 中            | 中               |
| **灵活性**     | 中        | 高           | 中            | 高               |
| **生态**       | 丰富      | 有限         | 建设中        | 自建             |
| **多模型支持** | 好        | 仅 OpenAI    | 主要 Claude   | 好               |
| **可观测性**   | LangSmith | 无           | 基础          | 自建             |
| **动态规划**   | LangGraph | 无           | 无            | 内置             |
| **学习成本**   | 高        | 低           | 中            | 中               |

### 7.5 设计决策

基于竞品分析，我们采取以下设计决策:

```
借鉴:
1. LangChain - Tool 自动描述机制、状态图设计思想
2. Swarm - 简洁的 Agent 定义、Handoff 协作模式
3. MCP - Resource/Tool 分离、标准化描述格式

创新:
1. 深度集成现有业务 - 复用 PPT/Doc 生成能力
2. 动态规划优先 - 内置 ReAct + 重规划能力
3. 多模型原生支持 - 适配层设计
4. 业务可观测性 - 面向业务的指标和追踪
```

---

## 8. 风险评估

### 8.1 技术风险

| 风险                      | 影响 | 概率 | 缓解措施                         |
| ------------------------- | ---- | ---- | -------------------------------- |
| LLM API 不稳定            | 高   | 中   | 多模型备份、本地缓存、降级策略   |
| Function Calling 准确率低 | 高   | 中   | 优化 Prompt、增加示例、人工确认  |
| 工具执行超时              | 中   | 高   | 合理超时设置、异步执行、取消机制 |
| 动态规划死循环            | 高   | 低   | 最大步骤限制、循环检测、超时熔断 |
| 并行执行资源争用          | 中   | 中   | 资源池管理、限流、队列           |
| 外部服务依赖              | 中   | 中   | 健康检查、熔断、降级             |

### 8.2 产品风险

| 风险             | 影响 | 概率 | 缓解措施                     |
| ---------------- | ---- | ---- | ---------------------------- |
| 用户期望过高     | 中   | 高   | 明确能力边界、渐进式引导     |
| 执行结果不符预期 | 高   | 中   | 增加确认环节、支持人工干预   |
| 成本控制困难     | 中   | 中   | Token 预算、成本预估、告警   |
| 隐私数据泄露     | 高   | 低   | 数据脱敏、权限控制、审计日志 |

### 8.3 项目风险

| 风险         | 影响 | 概率 | 缓解措施               |
| ------------ | ---- | ---- | ---------------------- |
| 工期延误     | 中   | 中   | 分阶段交付、MVP 优先   |
| 技术债务累积 | 中   | 高   | 代码审查、重构预留时间 |
| 依赖冲突     | 低   | 中   | 版本锁定、兼容性测试   |

---

## 9. 附录

### 9.1 工具实现示例

```typescript
// WEB_SEARCH 工具完整实现示例

import { Injectable } from "@nestjs/common";
import {
  BaseTool,
  ToolContext,
  ToolResult,
  JSONSchema,
} from "../core/tool.interface";
import { ToolType } from "../core/agent.types";

interface WebSearchInput {
  query: string;
  numResults?: number;
  language?: "zh-CN" | "en-US" | "auto";
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
}

@Injectable()
export class WebSearchTool extends BaseTool<WebSearchInput, SearchResult[]> {
  readonly type = ToolType.WEB_SEARCH;
  readonly name = "网络搜索";
  readonly description =
    "搜索互联网获取最新信息。适用于需要实时数据、新闻、或需要验证的信息。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "搜索查询词",
      },
      numResults: {
        type: "number",
        description: "返回结果数量，默认 5",
        default: 5,
      },
      language: {
        type: "string",
        description: "搜索语言",
        enum: ["zh-CN", "en-US", "auto"],
        default: "auto",
      },
    },
    required: ["query"],
  };

  readonly outputSchema: JSONSchema = {
    type: "array",
    items: {
      type: "object",
      properties: {
        title: { type: "string", description: "结果标题" },
        url: { type: "string", description: "结果链接" },
        snippet: { type: "string", description: "摘要片段" },
        publishedDate: { type: "string", description: "发布日期" },
      },
    },
  };

  constructor(private readonly searchService: SearchService) {
    super();
    this.defaultTimeout = 10000; // 10 秒超时
  }

  validateInput(input: WebSearchInput): boolean {
    return typeof input.query === "string" && input.query.trim().length > 0;
  }

  protected async doExecute(
    input: WebSearchInput,
    context: ToolContext,
  ): Promise<SearchResult[]> {
    const { query, numResults = 5, language = "auto" } = input;

    // 调用搜索服务
    const results = await this.searchService.search({
      query,
      count: numResults,
      market: language === "auto" ? undefined : language,
    });

    // 转换结果格式
    return results.map((r) => ({
      title: r.name,
      url: r.url,
      snippet: r.snippet,
      publishedDate: r.datePublished,
    }));
  }

  // 可选: 健康检查
  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.searchService.search({
        query: "test",
        count: 1,
      });
      return result.length > 0;
    } catch {
      return false;
    }
  }

  // 转换为 Function Calling 格式
  toFunctionDefinition(): FunctionDefinition {
    return {
      name: this.type,
      description: this.description,
      parameters: this.inputSchema,
    };
  }
}
```

### 9.2 执行引擎核心逻辑

```typescript
// 执行引擎核心逻辑示例

@Injectable()
export class ExecutionEngine {
  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly llmService: LLMService,
    private readonly planningEngine: PlanningEngine,
  ) {}

  async *executeWithFunctionCalling(
    input: AgentInput,
    agent: IAgent,
    userId?: string,
  ): AsyncGenerator<AgentEvent> {
    // 1. 创建初始规划
    const plan = await agent.plan(input);
    yield { type: "plan_ready", plan };

    // 2. 准备 Function Calling
    const tools = this.toolRegistry.getMany(agent.requiredTools);
    const functions = tools.map((t) => t.toFunctionDefinition());

    // 3. 构建初始消息
    const messages: Message[] = [
      { role: "system", content: agent.getSystemPrompt() },
      { role: "user", content: input.prompt },
    ];

    // 4. ReAct 循环
    let iteration = 0;
    const maxIterations = 10;
    const context: ToolContext = { taskId: plan.taskId, userId };

    while (iteration < maxIterations) {
      iteration++;

      // 调用 LLM
      const response = await this.llmService.chat({
        messages,
        functions,
        function_call: "auto",
      });

      // 检查是否有工具调用
      if (response.function_call) {
        const { name, arguments: args } = response.function_call;

        yield {
          type: "tool_call",
          tool: name as ToolType,
          input: JSON.parse(args),
        };

        // 执行工具
        const tool = this.toolRegistry.get(name as ToolType);
        const result = await tool.execute(JSON.parse(args), context);

        yield {
          type: "tool_result",
          tool: name as ToolType,
          output: result.data,
          duration: result.duration,
        };

        // 将结果加入对话
        messages.push({
          role: "assistant",
          content: null,
          function_call: response.function_call,
        });
        messages.push({
          role: "function",
          name,
          content: JSON.stringify(result.data),
        });

        // 检查是否需要重规划
        if (!result.success) {
          const newPlan = await this.planningEngine.replan(
            plan,
            { toolResults: new Map([[name, result]]) },
            { type: "tool_failure", stepId: name, details: result.error },
          );
          yield { type: "plan_changed", reason: "Tool failure", newPlan };
        }
      } else {
        // 没有工具调用，LLM 完成了任务
        yield {
          type: "complete",
          result: {
            success: true,
            artifacts: [],
            summary: response.content,
            tokensUsed: response.usage?.total_tokens || 0,
            duration: Date.now() - plan.timestamp,
          },
        };
        break;
      }
    }
  }
}
```

### 9.3 术语表

| 术语             | 定义                                     |
| ---------------- | ---------------------------------------- |
| Agent            | 能够自主执行任务的 AI 实体               |
| Tool             | Agent 可调用的原子能力单元               |
| Function Calling | LLM 自主决定调用函数的能力               |
| ReAct            | Reasoning + Acting，推理与行动交替的模式 |
| Plan             | 任务执行计划，包含有序的步骤             |
| Replan           | 根据执行情况重新规划                     |
| Orchestrator     | 编排器，协调 Agent 和 Tool 的执行        |
| Artifact         | 任务产出物，如文档、图片等               |
| SSE              | Server-Sent Events，服务器推送事件       |

---

## 变更记录

| 版本 | 日期       | 变更内容 | 作者     |
| ---- | ---------- | -------- | -------- |
| 1.0  | 2025-12-17 | 初始版本 | PM Agent |

---

**文档状态**: 草稿
**下一步**: 技术评审 -> 详细设计 -> 开发实现
