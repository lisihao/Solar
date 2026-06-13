# AI Teams 现状与差距分析

> 版本: 1.0
> 日期: 2026-01-01
> 状态: Draft
> 试点场景: AI Slides (PPT 生成)

---

## 一、分析背景

### 1.1 目标架构

将 AI Teams 作为底层引擎，支撑上层的业务场景（AI Studio、AI Office、AI Simulation 等）。

```
┌─────────────────────────────────────────────────────────┐
│  业务场景层                                              │
│  AI Slides | AI Studio | AI Simulation | 自定义 Team    │
├─────────────────────────────────────────────────────────┤
│  团队抽象层                                              │
│  Team / Leader / Member / Role / Workflow               │
├─────────────────────────────────────────────────────────┤
│  AI Teams Engine                                        │
│  Orchestrator | Skills | Tools | Constraints | Memory   │
└─────────────────────────────────────────────────────────┘
```

### 1.2 试点选择

选择 **AI Slides (PPT 生成)** 作为首个试点场景：

- 流程清晰：4 阶段管线
- 角色明确：5 个 AI 角色协作
- 交付明确：可量化的 PPT 产出
- 约束可测：成本（Token）、质量（评分）、效率（时间）

---

## 二、AI Teams 现状

### 2.1 已有核心能力

| 能力模块       | 实现状态    | 关键组件                                      | 完成度 |
| -------------- | ----------- | --------------------------------------------- | ------ |
| **任务编排**   | ✅ 已实现   | TeamMission, AgentTask, TeamMissionService    | 80%    |
| **角色系统**   | ✅ 已实现   | TopicAIMember, TeamMemberAgent, 7种预定义角色 | 85%    |
| **工具注册**   | ⚠️ 部分实现 | TeamMemberAgent.resolveTools(), ToolType 枚举 | 60%    |
| **技能注册**   | ❌ 分散     | 无统一 Registry，分散在各模块                 | 30%    |
| **约束引擎**   | ❌ 缺失     | 无 Constraint Engine                          | 0%     |
| **协作通信**   | ✅ 已实现   | AiTeamsGateway, TeamCollaborationService      | 85%    |
| **上下文管理** | ✅ 已实现   | ContextRouterService, AiResponseService       | 75%    |
| **记忆系统**   | ⚠️ 基础     | 短期上下文，无长期记忆                        | 40%    |

### 2.2 TeamMission 工作流

```
当前 AI Teams 的 Mission 执行流程：

用户创建 Mission (指定 Leader)
         │
         ▼
┌─────────────────┐
│ PENDING         │
└────────┬────────┘
         │ startMission()
         ▼
┌─────────────────┐
│ PLANNING        │ ← Leader 分解任务
└────────┬────────┘
         │ executeLeaderPlanning()
         ▼
┌─────────────────┐
│ IN_PROGRESS     │ ← 成员并行执行 AgentTask
└────────┬────────┘
         │ 所有任务完成
         ▼
┌─────────────────┐
│ REVIEW          │ ← Leader 审核整合
└────────┬────────┘
         │ leaderReview()
         ▼
┌─────────────────┐
│ COMPLETED       │
└─────────────────┘
```

### 2.3 角色能力映射

```typescript
// 当前 AI Teams 的角色 → 工具映射

researcher → [WEB_SEARCH, WEB_SCRAPER, RAG_SEARCH, KNOWLEDGE_GRAPH, DATA_FETCH]
analyst    → [DATA_ANALYSIS, PYTHON_EXECUTOR, DATABASE_QUERY, DATA_VALIDATION]
writer     → [TEXT_GENERATION, EXPORT_DOCX, EXPORT_PDF, TEMPLATE_RENDER]
developer  → [CODE_GENERATION, PYTHON_EXECUTOR, JAVASCRIPT_EXECUTOR, GITHUB]
designer   → [IMAGE_GENERATION, EXPORT_IMAGE, EXPORT_PPTX, TEMPLATE_RENDER]
moderator  → [TEXT_GENERATION, AGENT_HANDOFF, CONSENSUS_MECHANISM]
leader     → [上述所有 + TASK_DELEGATION, WORKFLOW_ORCHESTRATION, HUMAN_APPROVAL]
```

### 2.4 数据模型

```
核心实体关系：

Topic (话题/工作空间)
  ├── TopicAIMember[] (AI 成员)
  │     ├── aiModel, displayName, roleDescription
  │     ├── capabilities[], expertiseAreas[]
  │     ├── workStyle, isLeader
  │     └── systemPrompt, tools[]
  │
  ├── TeamMission[] (任务)
  │     ├── title, description, objectives
  │     ├── leader (指定的 Leader)
  │     ├── taskBreakdown (分解方案)
  │     ├── status (PENDING → COMPLETED)
  │     └── AgentTask[] (子任务)
  │           ├── assignee (执行成员)
  │           ├── dependsOn[] (依赖)
  │           ├── status, output
  │           └── reviewedBy, reviewComments
  │
  └── TopicMessage[] (消息记录)
```

---

## 三、AI Slides 现状

### 3.1 架构概览

```
AI Slides 当前架构 (v3.1):

┌────────────────────────────────────────────────────────┐
│ Orchestrator Layer (编排层)                             │
│ SlidesOrchestratorService - 主编排                      │
│ MultiModelService - 多模型统一接口                       │
└────────────────────────────────────────────────────────┘
                         ↓
┌────────────────────────────────────────────────────────┐
│ Role Layer (角色层 - 5个硬编码角色)                      │
│ ┌──────────┐ ┌────────┐ ┌──────────┐ ┌───────┐ ┌─────┐ │
│ │Architect │ │ Writer │ │ Renderer │ │ImageGen│ │Review│ │
│ │ 规划师   │ │ 写手   │ │ 渲染师   │ │ 画家  │ │审核员│ │
│ └──────────┘ └────────┘ └──────────┘ └───────┘ └─────┘ │
└────────────────────────────────────────────────────────┘
                         ↓
┌────────────────────────────────────────────────────────┐
│ Skill Layer (技能层 - 15+ 确定性逻辑)                   │
│ TemplateRenderingSkill (2023行)                        │
│ OutlinePlanningSkill (1534行)                          │
│ TaskDecompositionSkill (524行)                         │
│ ContentAnalyzerSkill, ContentCompressionSkill, ...     │
└────────────────────────────────────────────────────────┘
                         ↓
┌────────────────────────────────────────────────────────┐
│ Template Layer (模板层 - 50+ 模板)                      │
│ D-001~006 (数据类) | S-001~009 (结构类)                │
│ C-001~007 (内容类) | N-001~005 (叙事类)                │
│ A-001~002 (行动类)                                      │
└────────────────────────────────────────────────────────┘
```

### 3.2 四阶段管线

```
Phase 1: 任务分解 (Task Decomposition)
├─ 角色: Architect
├─ 输入: sourceText + userRequirement
├─ 输出: TaskDecomposition { totalPages, chapters, designStrategy }
├─ 技能: TaskDecompositionSkill
└─ 时间: 30-60秒

         ↓

Phase 2: 大纲规划 (Outline Planning)
├─ 角色: Architect
├─ 输入: TaskDecomposition + sourceText
├─ 输出: OutlinePlan { pages[], globalStyles }
├─ 技能: OutlinePlanningSkill
├─ 核心: 页面三要素（观点 + 逻辑 + 数据）
└─ 时间: 1-2分钟

         ↓

Phase 3: 逐页渲染 (Page-by-Page Rendering)
├─ For each page:
│   ├─ Writer: 填充内容 → PageContent
│   ├─ ImageGen: 生成配图 → Images
│   └─ Renderer: 渲染 HTML → PageState
├─ 技能: TemplateRenderingSkill, ContentCompressionSkill
└─ 时间: 30-60秒/页

         ↓

Phase 4: 质量审核 (Quality Review)
├─ 角色: Reviewer
├─ 输入: 所有 PageState[]
├─ 输出: QualityReport { score, issues[], suggestions[] }
└─ 时间: 30-60秒
```

### 3.3 角色配置（硬编码）

```typescript
// MultiModelService 中的角色配置

ROLE_CONFIGS = {
  architect: {
    modelType: CHAT,
    strategy: QUALITY_FIRST,
    timeout: 120000,
    maxRetries: 3,
  },
  writer: {
    modelType: CHAT,
    strategy: SPEED_FIRST,
    timeout: 60000,
    maxRetries: 2,
  },
  renderer: {
    modelType: CHAT,
    strategy: COST_OPTIMIZED,
    timeout: 90000,
    maxRetries: 2,
  },
  image: {
    modelType: IMAGE_GENERATION,
    timeout: 90000,
    maxRetries: 3,
  },
  reviewer: {
    modelType: CHAT,
    strategy: QUALITY_FIRST,
    timeout: 45000,
    maxRetries: 2,
  },
};
```

### 3.4 已有的高价值能力

| 能力               | 说明                             | 可复用性             |
| ------------------ | -------------------------------- | -------------------- |
| **页面三要素原则** | 观点 + 逻辑 + 数据               | 高 - 可作为领域知识  |
| **50+ 模板库**     | 覆盖各类 PPT 场景                | 高 - 直接复用        |
| **确定性渲染**     | TemplateRenderingSkill 不依赖 AI | 高 - 作为 Skill 注册 |
| **反馈循环**       | 内容溢出自动压缩/拆分            | 高 - 通用模式        |
| **检查点系统**     | 版本管理与回滚                   | 高 - AI Teams 可复用 |
| **多模型降级**     | GPT-4o → Claude → Grok           | 中 - 可整合到 Engine |

---

## 四、差距分析

### 4.1 架构差距总览

```
┌─────────────────────────────────────────────────────────────────┐
│                        差距对比矩阵                              │
├───────────────┬─────────────────────┬─────────────────────────┤
│     维度       │    AI Teams 现状    │    AI Slides 现状       │
├───────────────┼─────────────────────┼─────────────────────────┤
│ 角色定义       │ 动态配置            │ 硬编码 5 个              │
│               │ TopicAIMember       │ ROLE_CONFIGS            │
├───────────────┼─────────────────────┼─────────────────────────┤
│ 任务编排       │ TeamMission        │ SlidesOrchestrator      │
│               │ 动态分解            │ 固定 4 阶段              │
├───────────────┼─────────────────────┼─────────────────────────┤
│ 技能系统       │ 无统一 Registry    │ 15+ Skills 独立目录      │
├───────────────┼─────────────────────┼─────────────────────────┤
│ 工具系统       │ ToolType 枚举      │ 通过角色隐式使用         │
│               │ 动态解析            │                         │
├───────────────┼─────────────────────┼─────────────────────────┤
│ 约束控制       │ ❌ 无              │ ❌ 无                    │
├───────────────┼─────────────────────┼─────────────────────────┤
│ 工作流配置     │ 无显式 Workflow    │ 固定管线                 │
├───────────────┼─────────────────────┼─────────────────────────┤
│ 检查点         │ ❌ 无              │ ✅ CheckpointService     │
├───────────────┼─────────────────────┼─────────────────────────┤
│ 实时通信       │ WebSocket          │ SSE                     │
└───────────────┴─────────────────────┴─────────────────────────┘
```

### 4.2 核心差距详解

#### 差距 1: 技能注册中心缺失

**现状：**

- AI Teams: 工具通过 `TeamMemberAgent.resolveTools()` 动态解析，但无统一的 Skill Registry
- AI Slides: 15+ Skills 在独立目录，未与 AI Teams 打通

**影响：**

- 无法复用 Slides 的高价值 Skills（如 TemplateRenderingSkill）
- 无法让其他 Team 按需调用这些能力

**需要：**

```typescript
// 统一的 Skill Registry
interface SkillRegistry {
  register(skill: Skill): void;
  discover(requirement: SkillRequirement): Skill[];
  invoke(skillId: string, input: any): Promise<any>;
}
```

#### 差距 2: 约束引擎完全缺失

**现状：**

- AI Teams: 无约束概念，无法控制成本/质量/效率
- AI Slides: 有隐式的超时和重试，但无显式约束

**影响：**

- 用户无法控制预算
- 无法做质量 vs 速度的权衡
- 无法预估任务成本

**需要：**

```typescript
// Constraint Engine
interface ConstraintEngine {
  evaluate(mission: Mission, constraints: Constraints): EvaluationResult;
  allocate(resources: Resource[], constraints: Constraints): AllocationPlan;
  monitor(execution: Execution): ConstraintViolation[];
  adjust(plan: Plan, violation: ConstraintViolation): AdjustedPlan;
}

interface Constraints {
  cost: { budget: number; modelPreference: "cheap" | "balanced" | "premium" };
  quality: {
    depth: "quick" | "standard" | "comprehensive";
    reviewRequired: boolean;
  };
  efficiency: { deadline: Duration; priority: "urgent" | "normal" | "low" };
}
```

#### 差距 3: 工作流不可配置

**现状：**

- AI Teams: TeamMission 有固定的状态流转，但无显式 Workflow 定义
- AI Slides: 4 阶段固定管线，硬编码在 Orchestrator

**影响：**

- 无法为不同场景定制工作流
- 无法动态调整执行顺序
- 无法支持条件分支

**需要：**

```typescript
// Workflow Engine
interface Workflow {
  steps: WorkflowStep[];
  transitions: Transition[];
  conditions: Condition[];
}

interface WorkflowStep {
  id: string;
  name: string;
  executor: Role | Role[];
  skills: Skill[];
  parallel: boolean;
  timeout: Duration;
  onSuccess: string; // next step id
  onFailure: string; // fallback step id
}
```

#### 差距 4: 检查点未整合

**现状：**

- AI Teams: 无检查点机制
- AI Slides: 完整的 CheckpointService（4 个检查点类型）

**影响：**

- AI Teams 任务失败需要完全重做
- 无法从中间状态恢复

**需要：**

- 将 CheckpointService 抽象为 Engine 能力
- 所有 Team 场景都可使用

#### 差距 5: Leader 审核机制差异

**现状：**

- AI Teams: Leader 可以 review AgentTask，有返工循环
- AI Slides: Reviewer 是独立角色，只生成报告不触发返工

**影响：**

- Slides 的质量问题无法自动修复
- 缺少反馈闭环

**需要：**

- 统一 Leader 审核机制
- 支持审核不通过时的自动返工

### 4.3 能力迁移映射

```
AI Slides 角色 → AI Teams 角色映射：

Architect  ──→  Leader + Analyst
                ├─ 任务分解 → Leader 职责
                └─ 大纲规划 → Analyst 技能

Writer     ──→  Writer
                └─ 内容填充 → TEXT_GENERATION

Renderer   ──→  Designer (扩展)
                └─ HTML 渲染 → 新增 TEMPLATE_RENDER 技能

ImageGen   ──→  Designer
                └─ 图像生成 → IMAGE_GENERATION

Reviewer   ──→  Leader (合并)
                └─ 质量审核 → Leader 审核职责
```

```
AI Slides Skills → AI Teams Skill Registry：

TaskDecompositionSkill   → 注册为通用 Skill
OutlinePlanningSkill     → 注册为 PPT 领域 Skill
TemplateRenderingSkill   → 注册为 PPT 领域 Skill
ContentAnalyzerSkill     → 注册为通用 Skill
ContentCompressionSkill  → 注册为通用 Skill
```

---

## 五、重构路径建议

### 5.1 阶段规划

```
Phase 1: Engine 核心能力补齐 (2-3周)
├─ P0: 实现 Constraint Engine
├─ P0: 实现 Skill Registry
├─ P1: 实现 Workflow Engine
└─ P1: 整合 Checkpoint 机制

Phase 2: AI Slides 迁移适配 (2-3周)
├─ 将 5 个角色映射为 TopicAIMember 配置
├─ 将 15+ Skills 注册到 Skill Registry
├─ 将 4 阶段管线转换为 Workflow 配置
└─ 复用 Leader 审核机制

Phase 3: 约束验证 (1-2周)
├─ 在 Slides 场景验证成本约束
├─ 在 Slides 场景验证质量约束
├─ 在 Slides 场景验证效率约束
└─ 调优约束参数

Phase 4: 推广到其他场景 (持续)
├─ AI Studio 迁移
├─ AI Simulation 迁移
└─ 新场景快速接入
```

### 5.2 风险评估

| 风险             | 概率 | 影响 | 缓解措施                 |
| ---------------- | ---- | ---- | ------------------------ |
| Engine 抽象过度  | 中   | 高   | 以 Slides 场景驱动设计   |
| 迁移破坏现有功能 | 中   | 高   | 保留旧实现，渐进切换     |
| 约束机制不准确   | 高   | 中   | 先做成本约束（最易量化） |
| 性能下降         | 低   | 中   | 保留直连优化路径         |

---

## 六、成功标准

| 指标       | 目标                | 衡量方式           |
| ---------- | ------------------- | ------------------ |
| 功能完整性 | Slides 所有功能正常 | 回归测试 100% 通过 |
| 约束准确率 | 成本预估误差 < 20%  | 实际 vs 预估对比   |
| 代码复用率 | > 60% Skills 可复用 | 其他场景调用次数   |
| 性能损耗   | < 10%               | 迁移前后对比       |

---

## 附录: 关键文件清单

### AI Teams 核心文件

```
backend/src/modules/ai/ai-teams/
├── ai-teams.module.ts
├── ai-teams.controller.ts (1200+ 行)
├── ai-teams.service.ts (700+ 行)
├── agents/
│   └── team-member.agent.ts (558 行)
└── services/
    ├── team-mission.service.ts (2000+ 行)
    ├── ai-response.service.ts
    ├── context-router.service.ts
    └── team-collaboration.service.ts
```

### AI Slides 核心文件

```
backend/src/modules/ai/ai-office/slides/
├── slides.controller.ts
├── services/
│   ├── slides-orchestrator.service.ts
│   ├── multi-model.service.ts
│   ├── architect.service.ts
│   ├── writer.service.ts
│   ├── renderer.service.ts
│   └── reviewer.service.ts
└── skills/
    ├── template-rendering.skill.ts (2023 行)
    ├── outline-planning.skill.ts (1534 行)
    ├── task-decomposition.skill.ts (524 行)
    └── ... (15+ skills)
```

---

**文档历史**

| 版本 | 日期       | 作者        | 变更说明 |
| ---- | ---------- | ----------- | -------- |
| 1.0  | 2026-01-01 | Claude Code | 初始版本 |
