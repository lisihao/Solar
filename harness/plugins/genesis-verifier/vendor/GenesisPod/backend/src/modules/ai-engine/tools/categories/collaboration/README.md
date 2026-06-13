# 协作工具 (Collaboration Tools)

Agent 间协作和人机协作工具集，用于实现复杂的多 Agent 工作流和人机交互。

## 工具列表

### 1. Agent 委派工具 (Agent Handoff Tool)

**类型**: `agent_handoff`

**用途**: 将任务委派给其他专业 Agent 执行，实现 Agent 间协作。

**支持模式**:

- **同步模式** (`waitForResult: true`): 等待目标 Agent 完成并返回结果
- **异步模式** (`waitForResult: false`): 立即返回，任务在后台执行

**关键特性**:

- 跨 Agent 任务委派
- 降级策略支持
- 任务追踪
- 超时控制

**使用示例**:

```typescript
// 同步委派 - 等待结果
const handoffInput = {
  targetAgent: AgentType.DESIGNER,
  task: {
    prompt: "为科技产品发布会生成海报，主题：未来科技",
    context: {
      theme: "未来科技",
      colors: ["#0066FF", "#00CCFF"],
      size: "1920x1080",
    },
    priority: "high",
  },
  options: {
    waitForResult: true,
    timeout: 60000, // 60秒
    fallbackAgent: AgentType.SLIDES, // 降级到 Slides Agent
  },
};

const result = await agentHandoffTool.execute(handoffInput, context);
if (result.success && result.data?.status === "completed") {
  console.log("任务完成:", result.data.result);
}

// 异步委派 - 后台执行
const asyncHandoff = {
  targetAgent: AgentType.DOCS,
  task: {
    prompt: "生成产品技术文档",
    priority: "normal",
  },
  options: {
    waitForResult: false,
  },
};

const delegated = await agentHandoffTool.execute(asyncHandoff, context);
console.log("任务已委派:", delegated.data?.handoffId);
```

**输入参数**:

```typescript
interface AgentHandoffInput {
  targetAgent: AgentType; // 目标 Agent
  task: {
    prompt: string; // 任务提示词
    context?: Record<string, unknown>; // 任务上下文
    priority?: "low" | "normal" | "high"; // 优先级
  };
  options?: {
    waitForResult?: boolean; // 是否等待结果
    timeout?: number; // 超时时间（毫秒）
    fallbackAgent?: AgentType; // 降级 Agent
  };
}
```

**输出结果**:

```typescript
interface AgentHandoffOutput {
  success: boolean; // 是否成功
  handoffId: string; // 委派 ID
  targetAgent: AgentType; // 实际执行的 Agent
  status: "delegated" | "completed" | "failed"; // 状态
  result?: AgentResult; // 执行结果（同步模式）
  error?: string; // 错误信息
  metadata?: {
    handoffAt: Date; // 委派时间
    completedAt?: Date; // 完成时间
    usedFallback?: boolean; // 是否使用降级
  };
}
```

---

### 2. 人类审批工具 (Human Approval Tool)

**类型**: `human_approval`

**用途**: 在 Agent 执行过程中请求人类审批、选择或反馈。

**支持类型**:

- **confirm**: 确认/拒绝操作
- **choose**: 从多个选项中选择
- **input**: 输入自定义内容
- **review**: 审查并提供反馈

**关键特性**:

- 多种交互模式
- 超时自动处理
- 默认操作配置
- 上下文预览

**使用示例**:

```typescript
// 1. 确认操作
const confirmInput = {
  type: "confirm",
  prompt: "是否继续生成剩余 10 张图片？这将消耗 100 积分。",
  context: {
    summary: "已生成 5/15 张图片",
    details: {
      completed: 5,
      remaining: 10,
      cost: 100,
    },
  },
  options: {
    timeout: 60000,
    defaultAction: "reject", // 超时默认拒绝
  },
};

const approval = await humanApprovalTool.execute(confirmInput, context);
if (approval.data?.approved) {
  // 用户批准，继续执行
}

// 2. 选择方案
const chooseInput = {
  type: "choose",
  prompt: "请选择海报设计风格",
  context: {
    preview: "https://example.com/preview.png",
  },
  options: {
    choices: [
      {
        id: "modern",
        label: "现代简约",
        description: "极简主义设计，留白充足",
      },
      {
        id: "tech",
        label: "科技感",
        description: "科技蓝渐变，数字化元素",
      },
      {
        id: "creative",
        label: "创意艺术",
        description: "艺术插画风格，色彩丰富",
      },
    ],
    timeout: 120000, // 2分钟
  },
};

const choice = await humanApprovalTool.execute(chooseInput, context);
const selectedStyle = choice.data?.response?.choice;

// 3. 内容审查
const reviewInput = {
  type: "review",
  prompt: "请审查以下文档内容是否符合要求",
  context: {
    summary: "产品发布会演讲稿",
    details: {
      wordCount: 1500,
      sections: 5,
      estimatedTime: "10分钟",
    },
    preview: "https://example.com/doc.pdf",
  },
};

const review = await humanApprovalTool.execute(reviewInput, context);
if (review.data?.approved) {
  const feedback = review.data.response?.feedback;
  // 根据反馈进行调整
}

// 4. 自定义输入
const inputRequest = {
  type: "input",
  prompt: "请输入产品的核心卖点（3-5个关键词）",
  context: {
    summary: "用于生成营销文案",
  },
};

const input = await humanApprovalTool.execute(inputRequest, context);
const keywords = input.data?.response?.input;
```

**输入参数**:

```typescript
interface HumanApprovalInput {
  type: "confirm" | "choose" | "input" | "review"; // 审批类型
  prompt: string; // 提示信息
  context?: {
    summary?: string; // 摘要
    details?: unknown; // 详细信息
    preview?: string; // 预览 URL
  };
  options?: {
    choices?: Array<{
      // 选项列表（choose 类型）
      id: string;
      label: string;
      description?: string;
    }>;
    timeout?: number; // 超时时间
    defaultAction?: string; // 默认操作
  };
}
```

**输出结果**:

```typescript
interface HumanApprovalOutput {
  approved: boolean; // 是否批准
  response?: {
    choice?: string; // 用户选择（choose）
    input?: unknown; // 用户输入（input）
    feedback?: string; // 用户反馈（review）
  };
  respondedAt: Date; // 响应时间
  timedOut: boolean; // 是否超时
  metadata?: {
    requestId: string; // 请求 ID
    requestedAt: Date; // 请求时间
    responseTime: number; // 响应时长
  };
}
```

---

## 实现状态

### 当前版本 (v1.0 - 模拟版)

两个工具的基础架构已完成，提供模拟实现：

- ✅ 完整的类型定义
- ✅ 输入参数验证
- ✅ 错误处理和超时控制
- ✅ 降级策略支持
- ✅ 日志记录
- ✅ JSDoc 文档

**模拟行为**:

- `AgentHandoffTool`: 返回模拟的 Agent 执行结果
- `HumanApprovalTool`: 自动批准所有请求（开发测试用）

### 后续集成 (Roadmap)

#### Agent 委派工具

- [ ] 集成 Agent 执行系统
- [ ] 实现真实的 Agent 调用
- [ ] 添加任务队列支持
- [ ] 实现任务状态持久化
- [ ] 添加任务追踪 API

#### 人类审批工具

- [ ] 集成 WebSocket 实时通知
- [ ] 实现审批请求数据库存储
- [ ] 添加前端审批界面
- [ ] 实现响应轮询机制
- [ ] 添加审批历史记录

---

## 使用场景

### Agent 委派

1. **跨领域任务**
   - Docs Agent 需要图片 → 委派给 Designer Agent
   - Slides Agent 需要数据分析 → 委派给 Developer Agent

2. **专业分工**
   - 复杂任务拆解成多个子任务
   - 每个子任务委派给最合适的 Agent

3. **降级策略**
   - 主 Agent 不可用时自动降级
   - 提高系统可靠性

### 人类审批

1. **重要决策**
   - 大额消费确认
   - 敏感操作批准

2. **创意输入**
   - 设计风格选择
   - 内容主题确定

3. **质量把控**
   - 内容审查
   - 最终确认

---

## 工作流示例

### 复杂文档生成工作流

```typescript
// Docs Agent 主任务
async function generateTechnicalDocument(prompt: string) {
  // 1. 生成文档大纲
  const outline = await generateOutline(prompt);

  // 2. 请求人类审批大纲
  const outlineApproval = await humanApprovalTool.execute(
    {
      type: "review",
      prompt: "请审查文档大纲是否符合要求",
      context: {
        summary: "技术文档大纲",
        details: outline,
      },
    },
    context,
  );

  if (!outlineApproval.data?.approved) {
    // 根据反馈调整大纲
    const feedback = outlineApproval.data?.response?.feedback;
    outline = await adjustOutline(outline, feedback);
  }

  // 3. 委派图片生成给 Designer Agent
  const imageGeneration = await agentHandoffTool.execute(
    {
      targetAgent: AgentType.DESIGNER,
      task: {
        prompt: "根据文档主题生成配图",
        context: { outline, style: "technical" },
        priority: "high",
      },
      options: {
        waitForResult: true,
        timeout: 120000,
      },
    },
    context,
  );

  // 4. 生成文档内容
  const content = await generateContent(outline, imageGeneration.data?.result);

  // 5. 最终审批
  const finalApproval = await humanApprovalTool.execute(
    {
      type: "confirm",
      prompt: "文档已生成完毕，是否导出？",
      context: {
        preview: content.previewUrl,
        details: {
          pages: content.pageCount,
          images: content.imageCount,
        },
      },
    },
    context,
  );

  if (finalApproval.data?.approved) {
    return await exportDocument(content);
  }
}
```

---

## 测试

目前两个工具都提供模拟实现，可以在不集成真实系统的情况下进行测试。

**运行测试**:

```bash
# TODO: 添加单元测试
npm test -- agent-handoff.tool
npm test -- human-approval.tool
```

---

## 技术细节

### 架构设计

两个工具都继承自 `BaseTool` 基类，遵循统一的工具接口规范：

```typescript
export abstract class BaseTool<TInput, TOutput> {
  abstract readonly type: ToolType;
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly inputSchema: JSONSchema;
  abstract readonly outputSchema: JSONSchema;

  async execute(
    input: TInput,
    context: ToolContext,
  ): Promise<ToolResult<TOutput>>;
  protected abstract doExecute(
    input: TInput,
    context: ToolContext,
  ): Promise<TOutput>;
  validateInput(input: TInput): boolean;
}
```

### 错误处理

- 输入参数验证
- 超时控制
- 降级策略
- 详细错误日志

### 日志记录

使用 NestJS Logger，记录关键操作：

- 工具调用
- 参数验证
- 执行结果
- 错误信息

---

## 贡献

如需添加新的协作工具或改进现有实现，请参考现有代码结构。

**代码规范**:

- TypeScript 严格模式
- 完整的类型定义
- JSDoc 注释
- 错误处理
- 日志记录
