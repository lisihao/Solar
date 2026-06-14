# Agentic AI 与多智能体系统

## 概述

Agentic AI 代表了人工智能从被动响应向主动执行的范式转变。Agent 能够自主规划、执行任务、使用工具，并与其他 Agent 协作完成复杂目标。

## 核心概念

### 1. Agent 定义

```
┌─────────────────────────────────────────────────────────────┐
│                      Agentic AI 架构                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   ┌─────────────────────────────────────────────────────┐   │
│   │                    Agent Core                        │   │
│   │  ┌─────────┐  ┌─────────┐  ┌─────────┐            │   │
│   │  │ Planner │  │ Memory  │  │ Tools   │            │   │
│   │  └─────────┘  └─────────┘  └─────────┘            │   │
│   │       │            │            │                   │   │
│   │       ▼            ▼            ▼                   │   │
│   │  ┌─────────────────────────────────────────────┐   │   │
│   │  │              LLM Backbone                    │   │   │
│   │  │     (推理、决策、自然语言理解)               │   │   │
│   │  └─────────────────────────────────────────────┘   │   │
│   └─────────────────────────────────────────────────────┘   │
│                           │                                  │
│                           ▼                                  │
│   ┌─────────────────────────────────────────────────────┐   │
│   │                  Environment                         │   │
│   │  APIs | Databases | Web | Code Execution | Users    │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 2. Agent 核心能力

| 能力                    | 描述                   | 实现方式                          |
| ----------------------- | ---------------------- | --------------------------------- |
| **规划 (Planning)**     | 将复杂任务分解为子任务 | Chain-of-Thought, Tree-of-Thought |
| **记忆 (Memory)**       | 短期/长期信息存储      | 向量数据库, 上下文窗口            |
| **工具使用 (Tool Use)** | 调用外部 API 和工具    | Function Calling, MCP             |
| **反思 (Reflection)**   | 评估和改进自身输出     | Self-critique, Verification       |
| **学习 (Learning)**     | 从经验中改进           | In-context learning, Fine-tuning  |

## 主流 Agent 框架

### 1. ReAct (Reasoning + Acting)

```
思考 → 行动 → 观察 → 思考 → 行动 → 观察 → ... → 完成

┌──────────────────────────────────────────────────────┐
│  Question: 2024年诺贝尔物理学奖得主是谁？              │
├──────────────────────────────────────────────────────┤
│  Thought 1: 我需要搜索2024年诺贝尔物理学奖信息       │
│  Action 1: Search["2024 Nobel Prize Physics"]        │
│  Observation 1: John Hopfield 和 Geoffrey Hinton...  │
│  Thought 2: 找到答案了，让我整理回复                  │
│  Action 2: Finish[John Hopfield 和 Geoffrey Hinton]  │
└──────────────────────────────────────────────────────┘
```

### 2. Plan-and-Execute

```
┌─────────────────────────────────────────────────────────────┐
│                    Plan-and-Execute 架构                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    Planner Agent                      │   │
│  │  输入: 用户目标                                       │   │
│  │  输出: [Step1, Step2, Step3, ...]                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                  │
│                           ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   Executor Agent                      │   │
│  │  逐步执行计划，调用工具，收集结果                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                  │
│                           ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   Re-planner Agent                    │   │
│  │  根据执行结果，动态调整后续计划                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 3. LangGraph 状态机

```python
from langgraph.graph import StateGraph, END

# 定义状态
class AgentState(TypedDict):
    messages: list[BaseMessage]
    next_action: str

# 构建图
workflow = StateGraph(AgentState)

# 添加节点
workflow.add_node("agent", agent_node)
workflow.add_node("tools", tool_node)

# 添加边
workflow.add_edge("agent", "tools")
workflow.add_conditional_edges(
    "tools",
    should_continue,
    {
        "continue": "agent",
        "end": END
    }
)

# 编译运行
app = workflow.compile()
```

## 多智能体协作

### 1. 协作模式

```
┌─────────────────────────────────────────────────────────────┐
│                    多智能体协作模式                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. 层级模式 (Hierarchical)                                 │
│     ┌─────────┐                                             │
│     │ Manager │                                             │
│     └────┬────┘                                             │
│     ┌────┴────┬────────┐                                    │
│     ▼         ▼        ▼                                    │
│  ┌─────┐  ┌─────┐  ┌─────┐                                 │
│  │Worker│  │Worker│  │Worker│                               │
│  └─────┘  └─────┘  └─────┘                                 │
│                                                              │
│  2. 平等协作模式 (Peer-to-Peer)                             │
│     ┌─────┐ ←──→ ┌─────┐                                   │
│     │Agent│      │Agent│                                    │
│     └─────┘ ←──→ └─────┘                                   │
│        ↑           ↑                                        │
│        └─────┬─────┘                                        │
│              ▼                                              │
│          ┌─────┐                                            │
│          │Agent│                                            │
│          └─────┘                                            │
│                                                              │
│  3. 辩论模式 (Debate)                                       │
│     ┌─────────┐    ┌─────────┐                             │
│     │ Agent A │ ←→ │ Agent B │                             │
│     │ (正方)  │    │ (反方)  │                             │
│     └─────────┘    └─────────┘                             │
│           │            │                                    │
│           └──────┬─────┘                                    │
│                  ▼                                          │
│            ┌──────────┐                                     │
│            │  Judge   │                                     │
│            └──────────┘                                     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 2. 通信协议

```typescript
// Agent 间消息格式
interface AgentMessage {
  from: string; // 发送者 Agent ID
  to: string | string[]; // 接收者
  type: MessageType; // 消息类型
  content: any; // 消息内容
  metadata: {
    timestamp: Date;
    conversationId: string;
    replyTo?: string;
  };
}

enum MessageType {
  TASK_ASSIGNMENT = "task_assignment",
  TASK_RESULT = "task_result",
  QUESTION = "question",
  ANSWER = "answer",
  FEEDBACK = "feedback",
  BROADCAST = "broadcast",
}
```

### 3. AWS re:Invent 2025 Agentic AI 趋势

AWS 在 re:Invent 2025 发布的 Agentic AI 功能：

- **Amazon Bedrock Agents**: 全托管 Agent 服务
- **Agent Blueprints**: 预构建的 Agent 模板
- **Multi-Agent Orchestration**: 多 Agent 编排能力
- **Knowledge Bases**: 企业知识库集成
- **Guardrails**: Agent 行为安全边界

```
┌─────────────────────────────────────────────────────────────┐
│              AWS Bedrock Agent 架构                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                 Bedrock Agent                         │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  │   │
│  │  │ Foundation  │  │ Knowledge   │  │ Action     │  │   │
│  │  │ Model       │  │ Base        │  │ Groups     │  │   │
│  │  └─────────────┘  └─────────────┘  └────────────┘  │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                  │
│              ┌────────────┼────────────┐                    │
│              ▼            ▼            ▼                    │
│         ┌────────┐  ┌──────────┐  ┌─────────┐             │
│         │ Lambda │  │ API      │  │ S3      │             │
│         │        │  │ Gateway  │  │         │             │
│         └────────┘  └──────────┘  └─────────┘             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Agent 评估指标

### 1. 任务完成度

```python
# 评估 Agent 任务完成能力
metrics = {
    "task_success_rate": 0.85,     # 任务成功率
    "step_efficiency": 0.72,       # 步骤效率 (实际步数/最优步数)
    "tool_accuracy": 0.91,         # 工具调用准确率
    "recovery_rate": 0.68,         # 错误恢复率
}
```

### 2. 常用 Benchmark

| Benchmark      | 评估内容          | 领域     |
| -------------- | ----------------- | -------- |
| **WebArena**   | Web 导航和交互    | 网页操作 |
| **SWE-bench**  | 代码修复能力      | 软件工程 |
| **GAIA**       | 通用 Agent 能力   | 综合任务 |
| **AgentBench** | 多环境 Agent 能力 | 综合评估 |
| **ToolBench**  | 工具使用能力      | API 调用 |

## 安全与对齐

### 1. Agent 安全边界

```typescript
// Guardrails 配置
const agentGuardrails = {
  // 内容过滤
  contentFilters: {
    blockedTopics: ["harmful", "illegal"],
    piiProtection: true,
  },

  // 行为限制
  actionLimits: {
    maxApiCallsPerMinute: 100,
    maxTokensPerResponse: 4096,
    allowedDomains: ["api.example.com"],
    blockedActions: ["deleteDatabase", "transferFunds"],
  },

  // 人工监督
  humanInLoop: {
    requiredForActions: ["purchase", "delete", "modify"],
    escalationThreshold: 0.8,
  },
};
```

### 2. 对齐策略

- **Constitutional AI**: 内置行为准则
- **RLHF**: 人类反馈强化学习
- **Red Teaming**: 对抗性测试
- **Monitoring**: 实时行为监控

## 发展趋势

### 1. 2024-2025 关键进展

- **更长上下文**: 100K+ tokens 支持复杂任务
- **更好的工具使用**: Function Calling 标准化
- **MCP 协议**: Anthropic 的 Model Context Protocol
- **多模态 Agent**: 视觉+语言+代码
- **自主学习**: 从交互中持续改进

### 2. 未来方向

```
┌─────────────────────────────────────────────────────────────┐
│                  Agentic AI 发展路线                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  2024        2025        2026        2027+                  │
│    │          │           │           │                     │
│    ▼          ▼           ▼           ▼                     │
│  ┌────┐    ┌────┐     ┌────┐     ┌────┐                   │
│  │单任│    │复杂│     │自主│     │通用│                   │
│  │务  │ → │工作│  →  │系统│  →  │Agent│                  │
│  │Agent│   │流  │     │    │     │     │                   │
│  └────┘    └────┘     └────┘     └────┘                   │
│                                                              │
│  - 简单工具  - 多Agent   - 持续学习  - AGI特性             │
│  - 单轮对话  - 长期任务  - 自我改进  - 自主目标             │
│  - 人工监督  - 部分自主  - 环境适应  - 通用能力             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## 参考资源

- [LangGraph 官方文档](https://langchain-ai.github.io/langgraph/)
- [AutoGPT](https://github.com/Significant-Gravitas/AutoGPT)
- [CrewAI](https://github.com/joaomdmoura/crewai)
- [AWS Bedrock Agents](https://docs.aws.amazon.com/bedrock/latest/userguide/agents.html)
- [Anthropic MCP](https://modelcontextprotocol.io/)
