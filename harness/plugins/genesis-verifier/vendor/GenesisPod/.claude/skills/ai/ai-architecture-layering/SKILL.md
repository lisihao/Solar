---
name: AI Architecture Layering
description: |
  Decide where AI capabilities belong in the layered architecture.
  Trigger keywords: ai architecture, layering, ai engine, ai teams, capability placement
  Not for: AI Teams implementation (-> ai-teams-expert), Service patterns (-> ai-service-expert)
allowed-tools: [Read, Grep, Glob]
tags: [architecture, ai-engine, ai-teams, decision, layering]
boundaries:
  includes:
    - AI capability placement decisions
    - Layer boundary definitions
    - Architecture pattern guidance
  excludes:
    - AI Teams implementation details
    - AI service integration code
  handoff:
    - skill: ai-teams-expert
      when: AI Teams implementation
    - skill: ai-service-expert
      when: AI service integration
---

# AI Architecture Layering

> AI Engine 与 AI Apps 的职责边界定义，确保架构清晰、可复用。
>
> **统领心智模型（必读）**：`harness 是 Agent OS（操作系统），engine 是它驱动的计算引擎（CPU/存储/IO 全套能力机）`。
> 这条比喻解释了为什么"engine 无 agent/mission 状态"（=硬件不知道哪个进程在用它）、为什么依赖只能 harness→engine（=OS 驱动硬件、硬件不回调 OS）。
> 完整映射见 [standards/16-ai-engine-harness-structure.md](../../../standards/16-ai-engine-harness-structure.md) §一·补「Agent OS 心智模型」。

## 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│  AI Engine（核心能力层）                                          │
│  位置: backend/src/modules/ai-engine/                            │
│  职责: 领域无关的通用 AI 能力和框架                                │
└─────────────────────────────────────────────────────────────────┘
                              ↓ 提供能力
┌─────────────────────────────────────────────────────────────────┐
│  AI Apps（应用层）                                                │
│  位置: backend/src/modules/ai-app/                               │
│  职责: 特定业务场景的实现，使用 Engine 能力                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 核心原则

### AI Engine 的黄金法则

> **"如果把产品换成完全不同的领域（如医疗、教育、游戏），这个代码还能直接复用吗？"**

- **能复用** → 属于 AI Engine
- **不能复用** → 属于 AI Apps

### 依赖方向

```
AI Apps → AI Engine  ✅ 正确
AI Engine → AI Apps  ❌ 禁止
```

AI Engine **绝不能** import AI Apps 的任何代码。

---

## AI Engine 职责定义

### ✅ 应该包含

| 类别           | 内容                   | 示例                                               |
| -------------- | ---------------------- | -------------------------------------------------- |
| **LLM 抽象**   | 模型调用、适配器、配置 | `llm/`, `AiChatService`                            |
| **工具系统**   | 通用工具定义和执行     | `tools/web-search`, `tools/rag`                    |
| **Agent 框架** | Agent 基类、生命周期   | `PlanBasedAgent`, `ReactiveAgent`                  |
| **Team 框架**  | 团队协作抽象接口       | `TeamConfig interface`, `WorkflowConfig interface` |
| **编排引擎**   | 任务编排、DAG 执行     | `orchestration/`                                   |
| **质量框架**   | 通用质量检查器接口     | `quality/coherence-checker`                        |
| **约束引擎**   | 通用约束和守护         | `constraint/guardrails`                            |
| **记忆系统**   | 短期/长期记忆抽象      | `memory/`                                          |
| **证据追踪**   | 通用证据、引用管理     | `evidence/`                                        |

### ❌ 禁止包含

| 类别             | 错误示例                        | 正确位置                     |
| ---------------- | ------------------------------- | ---------------------------- |
| **业务团队配置** | `RESEARCH_TEAM_CONFIG`          | `ai-app/research/teams/`     |
| **业务工作流**   | `RESEARCH_WORKFLOW`             | `ai-app/research/workflows/` |
| **业务 Agent**   | `ResearcherAgent`（含业务模板） | `ai-app/research/agents/`    |
| **业务提示词**   | "深度研究"、"市场调研"          | `ai-app/*/prompts/`          |
| **业务术语**     | "研究报告"、"商业文档"          | AI Apps 层                   |

---

## AI Apps 职责定义

### ✅ 应该包含

| 类别           | 内容           | 位置示例                                        |
| -------------- | -------------- | ----------------------------------------------- |
| **团队配置**   | 具体团队定义   | `ai-app/research/teams/research-team.config.ts` |
| **工作流定义** | 业务流程步骤   | `ai-app/research/workflows/`                    |
| **业务 Agent** | 特定领域 Agent | `ai-app/research/agents/`                       |
| **提示词模板** | 业务相关提示词 | `ai-app/*/prompts/`                             |
| **领域服务**   | 业务逻辑服务   | `ai-app/research/services/`                     |

### AI Apps 目录结构

```
backend/src/modules/ai-app/
├── research/          # AI Studio - 深度研究
│   ├── teams/         # 研究团队配置
│   ├── workflows/     # 研究工作流
│   ├── agents/        # 研究相关 Agent
│   └── services/      # 研究业务服务
├── office/            # AI Office - 文档生成
│   ├── teams/         # 报告/PPT 团队配置
│   └── ...
├── teams/             # AI Teams - 辩论协作
│   ├── teams/         # 辩论团队配置
│   └── ...
└── ...
```

---

## 当前违规项（待修复）

### 违规 1: Team Templates in Engine

**位置**: `ai-engine/teams/templates/`

| 文件               | 问题                     | 应迁移至                 |
| ------------------ | ------------------------ | ------------------------ |
| `research-team.ts` | 硬编码"深度研究"业务配置 | `ai-app/research/teams/` |
| `report-team.ts`   | 硬编码"报告撰写"业务配置 | `ai-app/office/teams/`   |
| `debate-team.ts`   | 硬编码"辩论团队"业务配置 | `ai-app/teams/teams/`    |
| `slides-team.ts`   | 硬编码"演示文稿"业务配置 | `ai-app/office/teams/`   |

### 违规 2: Business Agent in Engine

**位置**: `ai-engine/agents/implementations/researcher/`

| 问题               | 描述                                                     |
| ------------------ | -------------------------------------------------------- |
| `ResearchTaskType` | 包含 `LITERATURE_REVIEW`, `REPORT_GENERATION` 等业务枚举 |
| `templates[]`      | 包含"文献综述"、"市场调研"等业务模板                     |

---

## 修复模式：Team Registry

### 设计模式

```typescript
// AI Engine 提供注册接口
interface ITeamRegistry {
  register(config: TeamConfig): void;
  get(teamId: string): TeamConfig | undefined;
  getAll(): TeamConfig[];
}

// AI Apps 注册自己的团队配置
@Module({})
export class ResearchModule implements OnModuleInit {
  constructor(private teamRegistry: ITeamRegistry) {}

  onModuleInit() {
    this.teamRegistry.register(RESEARCH_TEAM_CONFIG);
  }
}
```

### 依赖关系

```
ai-app/research → ai-engine/teams (注册到)
ai-app/office → ai-engine/teams (注册到)
ai-engine/teams → (不依赖任何 ai-app)
```

---

## 决策检查清单

添加新 AI 能力时，回答以下问题：

### Q1: 是否领域无关？

```
□ 换成医疗/教育/游戏领域还能用吗？
  → 能: AI Engine
  → 不能: AI Apps
```

### Q2: 是否包含业务术语？

```
□ 代码中是否有"研究"、"报告"、"辩论"等词？
  → 有: AI Apps
  → 无: 可能是 AI Engine
```

### Q3: 是否是配置还是框架？

```
□ 是具体配置（团队角色、工作流步骤）还是抽象框架？
  → 配置: AI Apps
  → 框架: AI Engine
```

### Q4: 依赖方向检查

```
□ 新代码是否需要 import ai-app 的内容？
  → 是: 不能放 AI Engine
  → 否: 可以放 AI Engine
```

---

## 相关文档

- [Decision Examples](references/decision-examples.md)
- [Layer Characteristics](references/layer-characteristics.md)
