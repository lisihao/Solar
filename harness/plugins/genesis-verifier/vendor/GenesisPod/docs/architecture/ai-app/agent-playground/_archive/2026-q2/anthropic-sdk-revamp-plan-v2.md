# Playground Anthropic-SDK 范式改造方案 v2

**版本：** 2.0
**日期：** 2026-05-04
**状态：** 等待内部 v2 评审
**关联：**

- v1 方案：[`anthropic-sdk-revamp-plan-v1.md`](./anthropic-sdk-revamp-plan-v1.md)
- v1 评审：[`anthropic-sdk-revamp-review-v1.md`](./anthropic-sdk-revamp-review-v1.md)
- 基线规范：standards/16-ai-engine-harness-structure.md / 17-extension-governance.md / 18-base-layer-file-governance.md

---

## 目录

- [§0 基本原则（最高优先级）](#0-基本原则base-layer-业务无关)
- [§1 目标与衡量](#1-目标与衡量)
- [§2 用户体验（三视图）](#2-用户体验三视图)
- [§3 架构设计](#3-架构设计)
  - [§3.1 三层抽象](#31-三层抽象)
  - [§3.2 7 个 stage primitive](#32-7-个-stage-primitive)
  - [§3.3 SKILL.md 单一真相源](#33-skillmd-单一真相源)
  - [§3.4 stateful agent runtime（保留 SupervisedMission 历史决策）](#34-stateful-agent-runtime保留-supervisedmission-历史决策)
  - [§3.5 数据模型：每 ai-app 自有表 + IMissionStore 端口](#35-数据模型每-ai-app-自有表--imissionstore-端口)
  - [§3.6 控制层：薄壳 controller in ai-app](#36-控制层薄壳-controller-in-ai-app)
  - [§3.7 前台 Agent 配置 UI 设计](#37-前台-agent-配置-ui-设计)
  - [§3.8 用户自定义 Agent 数据模型 + API](#38-用户自定义-agent-数据模型--api)
- [§4 实施路径（5 阶段）](#4-实施路径5-阶段)
- [§5 playground 13 stage → 7 primitive 详细映射](#5-playground-13-stage--7-primitive-详细映射)
- [§6 风险与缓解](#6-风险与缓解)
- [§7 回滚策略](#7-回滚策略)
- [§8 与 W21/W22 协调](#8-与-w21w22-协调)
- [§9 时间表](#9-时间表)
- [§10 验收标准](#10-验收标准)

---

## §0 基本原则：base layer 业务无关（最高优先级）

> **必须在所有其他 R 之前完成。这是其他所有方案的前提。**

### 0.1 原则陈述

按 standards/16/17/18：

| 层              | 应有                                                                                                                      | **不应有**                                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1 ai-infra     | DB/缓存/队列/鉴权/存储/计费等基础设施                                                                                     | 任何业务语义                                                                                                                                                                                         |
| L2 ai-engine    | LLM 调用/工具/RAG/skill 定义/任务分解/safety/content                                                                      | agent 状态、mission、playground/writing/debate 等业务名                                                                                                                                              |
| L2.5 ai-harness | agent 运行时（含 agent/mission 状态）、runner loop、teams 协作模式抽象、memory、protocols、guardrails、tracing、lifecycle | **具体业务名**（playground / research / writing / debate / slides / topic-insights / library / office / ask / image / social / simulation / planning）、**业务文案**、**业务图标**、**业务能力描述** |
| L3 ai-app       | 全部产品语义、业务流程、专属规则、业务表                                                                                  | —                                                                                                                                                                                                    |

**判别口诀**（16 §二）：

- engine: "不需要知道 agent / mission 是谁就能做的事"
- harness: "必须知道 agent / mission 才有意义的事 —— **但不知道是哪个 ai-app**"

### 0.2 现存违规清理（R0 阶段，**必须先做**）

```
违规 1: harness/teams/abstractions/team.interface.ts
        export const BUILTIN_TEAMS = { RESEARCH, REPORT, DEBATE, DESIGN, SLIDES, TOPIC_INSIGHTS }

违规 2: harness/teams/abstractions/role.interface.ts
        export const BUILTIN_ROLES = { RESEARCH_LEAD, CONTENT_LEAD, TECH_LEAD, SLIDES_LEAD, ... }

违规 3: harness/agents/domain/builtin-agent-catalog.ts
        BUILTIN_AGENTS + AGENT_CONFIGS (含 "AI Slides" / "智能 PPT" / 📊 / "导出 PPTX" 等业务文案)
```

#### 清理动作

**违规 1 + 2 + 3 统一处理：**

```typescript
// before (harness/teams/abstractions/team.interface.ts)
export const BUILTIN_TEAMS = {
  RESEARCH: "research",
  ...
} as const;
export type BuiltinTeamId = (typeof BUILTIN_TEAMS)[keyof typeof BUILTIN_TEAMS];

// after
// （删除 BUILTIN_TEAMS / BuiltinTeamId）
export type TeamId = string;
```

业务名 + 文案 + 图标全部下沉到各自 ai-app：

```typescript
// ai-app/research/research.constants.ts
export const RESEARCH_TEAM_ID = "research" as const;

// ai-app/office/slides/slides.constants.ts
export const SLIDES_TEAM_ID = "slides" as const;
export const SLIDES_AGENT_CONFIG = {
  id: SLIDES_TEAM_ID,
  name: "AI Slides",
  description: "智能 PPT 生成器，快速创建专业演示文稿",
  icon: "📊",
  capabilities: ["自动生成大纲", ...],
};

// ai-app/<each>/<each>.module.ts
@Module({...})
export class SlidesModule implements OnModuleInit {
  constructor(private readonly teamRegistry: TeamRegistry) {}
  onModuleInit() {
    this.teamRegistry.register(SLIDES_AGENT_CONFIG);
  }
}
```

`harness/teams/registry/team-registry.ts` 已存在 `register(config)` 机制，BUILTIN_TEAMS 常量是冗余的。

#### 同步清理 PR-2 postmortem-classifier 的 substring 灰色地带

```typescript
// before (PR-2 v1, harness/lifecycle/learning/postmortem-classifier.service.ts)
if (e.type.includes("revision:stuck")) stuckRevisionCount++;

// after (v2)
classify(input: ClassifyInput, patterns?: PostmortemPatterns): ClassifyResult { ... }

// patterns 由 ai-app 注入：
// ai-app/agent-playground/services/postmortem-patterns.ts
export const PLAYGROUND_POSTMORTEM_PATTERNS: PostmortemPatterns = {
  stuckRevision: ["revision:stuck", "chapter:revision"],
  toolTruncation: ["tool:truncated"],
  llmTimeout: ["llm:timeout", "timeout"],
  userCancel: ["user-cancel"],
};
```

### 0.3 自动化看护（R0 阶段同步落地）

#### 看护 1：`base-layer-business-leakage.spec.ts`

新建 `backend/src/__tests__/architecture/base-layer-business-leakage.spec.ts`：

```typescript
const BLACKLIST_BUSINESS_TERMS = [
  "playground",
  "research",
  "writing",
  "debate",
  "slides",
  "topic-insights",
  "library",
  "office",
  "ask",
  "image",
  "social",
  "simulation",
  "planning",
  "ai-research",
  "topic_insights",
  "writing_team",
  "debate_team",
];

const ALLOWLIST_PATHS = [
  // 已批准的"业务名作文档示例"位置
  "*/README.md",
  "*/__tests__/**",
  // 兼容性 forwarder（迁移期）
  "*/legacy-*.ts",
];

describe("base layer business leakage", () => {
  for (const layer of ["ai-engine", "ai-harness", "ai-infra"]) {
    it(`${layer} 全量代码不含业务词`, () => {
      const violations = scanLayer(
        layer,
        BLACKLIST_BUSINESS_TERMS,
        ALLOWLIST_PATHS,
      );
      expect(violations).toEqual([]);
    });
  }
});
```

#### 看护 2：改进 ESLint `no-restricted-syntax`

```js
// backend/.eslintrc.js
{
  files: ["src/modules/ai-{harness,engine,infra}/**/*.ts"],
  rules: {
    "no-restricted-syntax": ["error", {
      selector: "Literal[value=/playground|writing-team|debate|slides|topic-insights|office|...|/]",
      message: "禁止在 base layer 硬编码具体业务名，下推到 ai-app 层",
    }],
  }
}
```

#### 看护 3：每个 v2 PR 必过 self-check

```markdown
- [ ] 本 PR 改动的 harness/engine/infra 文件 grep 不到任何 ai-app 名
- [ ] 本 PR 改动的 base layer 文件 grep 不到中文产品文案（"智能 PPT" / "AI 写作" 等）
- [ ] 任何 business literal 改成 caller 注入的参数 / config 字段
- [ ] `npm run verify:arch` + `base-layer-business-leakage.spec.ts` 通过
```

### 0.4 R0 工作量

| 子项                                                                 | 工作量     |
| -------------------------------------------------------------------- | ---------- |
| 删 BUILTIN_TEAMS / BUILTIN_AGENTS / BUILTIN_ROLES + 散落 importer 改 | 1 天       |
| 业务名 + 文案下推到各 ai-app constants                               | 1 天       |
| postmortem-classifier substring 改 config 注入                       | 0.5 天     |
| `base-layer-business-leakage.spec.ts` + ESLint rule                  | 0.5 天     |
| 全量 verify:arch + 全 spec 跑通                                      | 0.5 天     |
| **R0 合计**                                                          | **3.5 天** |

**R0 不通过，R1/R2/R3/R4 全部不能开。**

---

## §1 目标与衡量

### 1.1 目标 (North Star)

```
开发新 ai-app（mission-team）的全部代码：
  ├── <my-team>.config.ts            ~80 行声明式（MissionPipelineConfig）
  ├── <my-team>.controller.ts        ~30 行薄壳 controller（NestJS 标准）
  ├── <my-team>.module.ts            ~10 行 NestJS module
  ├── <my-team>-mission.service.ts   ~100 行 IMissionStore 实现（业务表 prisma 操作）
  ├── skills/<role>.skill.md         3-8 份 SKILL.md (Anthropic frontmatter 标准)
  ├── prisma 业务表 + 手写迁移        业务字段独立列 + metadata JSONB（小字段）

跑通: controller / mission runner / lifecycle / rerun / export / chat / replay / events 全自动
```

最终用户体验示例：

```typescript
// modules/ai-app/writing-team/writing-team.config.ts
import { defineMissionPipeline } from "@/modules/ai-harness/facade";
import { WritingMissionStore } from "./writing-mission.service";
import { z } from "zod";

const TopicSchema = z.object({
  topic: z.string().min(2),
  audience: z.enum(["general", "expert", "executive"]),
  language: z.enum(["zh-CN", "en-US"]),
  depth: z.enum(["brief", "standard", "deep"]),
});

export const WritingTeamConfig = defineMissionPipeline({
  id: "writing-team",
  endpointPrefix: "writing-team",
  eventPrefix: "writing-team",
  topicSchema: TopicSchema,

  roles: [
    {
      id: "leader",
      skill: "writing-team.leader",
      loop: "leader-worker",
      stateful: true,
    },
    {
      id: "researcher",
      skill: "writing-team.researcher",
      loop: "react",
      concurrency: 3,
    },
    { id: "writer", skill: "writing-team.writer", loop: "reflexion" },
    { id: "reviewer", skill: "writing-team.reviewer", loop: "simple" },
  ],

  pipeline: [
    { stage: "plan", role: "leader" },
    { stage: "research", role: "researcher", fanOut: "byPlanDimensions" },
    { stage: "draft", role: "writer" },
    { stage: "review", role: "reviewer" },
    { stage: "signoff", role: "leader" },
    { stage: "persist" },
  ],

  storeFactory: (ctx) => new WritingMissionStore(ctx.prisma),

  hooks: {
    afterReview: { skill: "writing-team.section-quality-enhancement" },
  },

  postmortemPatterns: {
    /* 业务专属 substring patterns */
  },
});
```

### 1.2 量化验收（修订后，诚实数字）

| 指标                                                                | 目标                                                                | 备注                                  |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------- |
| 复制 playground → 新 mission-style ai-app 改动文件数                | < 15（含 SKILL.md / config / module / controller / store / prisma） | 不含 SKILL.md 时 < 8                  |
| 新 ai-app 开发时间（资深开发者）                                    | < 2 天                                                              | vs 现状 1-2 周                        |
| 新 ai-app 开发时间（AI Agent 自主）                                 | < 4 小时                                                            | vs 现状不可行                         |
| playground 业务代码总行数（不含 SKILL.md）                          | < 2500 行                                                           | vs 现状 ~5000 行（减半）              |
| harness/teams/orchestrator/mission-pipeline-orchestrator 行数       | < 600 行                                                            | 含核心 happy-path                     |
| 每个 stage primitive 平均行数                                       | < 250 行（happy-path）                                              | 业务专属逻辑通过 hook 注入            |
| harness/engine/infra 业务词命中数（业务名 / 中文文案 / emoji icon） | **0**                                                               | base-layer-business-leakage.spec 守门 |
| 全量 spec 通过率                                                    | 100%（行为零回退）                                                  | —                                     |

### 1.3 非目标

- 不做 harness 顶层结构调整（W17 已完成、W21/W22 主线波次另议）
- 不做 prisma schema 大重构（playground 表保留）
- 不做对外 SDK 包发布（仅 monorepo 内 module export）
- **不做 generic mission_runs 表**（按 v1 评审，每 ai-app 自有表）
- **不做 NestJS dynamic module / forFeature**（按 v1 评审，普通 module）

---

## §2 用户体验（三视图）

### 2.1 视图 A：开发者（写代码做新 ai-app）

见 §1.1 代码示例。**6 类文件 + ~250 行业务代码** 即可拉起新 ai-app（含 controller endpoints / WebSocket / mission runner / lifecycle / rerun / export / chat / replay / events）。

### 2.2 视图 B：高级用户（在前台 UI 自定义 Agent，无需写代码）

通过 **AI 配置 → Agent tab → 创建向导（5 步）**：

```
Step 1: 选类型     [Mission 团队] (MVP 仅此一种)
Step 2: 选模板     [playground 模板 / research 模板 / 空白 / 我的复制]
Step 3: 基本信息   名称 / 图标 / 描述 / 左侧菜单位置
Step 4: 角色配置   每个角色: SKILL.md instructions（双模式编辑器）+ tools + models
Step 5: Topic schema + 预览
```

保存后：

- 后端：写入 `custom_agent_configs` 表 + 用户编辑的 SKILL.md 写 `user_skills` 表
- 前端：左侧菜单**自动出现 "我的 Agent / <name>"** 入口
- 点击进入：复用 generic MissionUI 渲染（topic 表单 + 历史 mission 列表 + mission 详情页）

### 2.3 视图 C：普通用户（用平台预置 ai-app 跑业务）

零变化。playground / research / library 等保持现状。

---

## §3 架构设计

### §3.1 三层抽象

```
┌─────────────────────────────────────────────────────────┐
│  L3 ai-app/<my-team>/                                   │
│    ├── <team>.config.ts          (MissionPipelineConfig) │
│    ├── <team>.controller.ts      (薄壳，~30 行)          │
│    ├── <team>.module.ts          (~10 行)                │
│    ├── <team>-mission.store.ts   (IMissionStore 实现)    │
│    ├── skills/*.skill.md         (Anthropic SKILL.md)    │
│    └── 业务专属 hook services / business 表 prisma model │
└─────────────────────────────────────────────────────────┘
                       ↓ 声明式配置（不 hardcode）
┌─────────────────────────────────────────────────────────┐
│  L2.5 ai-harness                                        │
│    ├── teams/orchestrator/                              │
│    │     ├── mission-pipeline-orchestrator.service.ts   │
│    │     ├── adaptive-replanner.service.ts (existing)   │
│    │     └── teams-mission-orchestrator.ts (existing)   │
│    ├── teams/services/stages/                           │
│    │     ├── plan.stage-primitive.ts                    │
│    │     ├── research.stage-primitive.ts                │
│    │     ├── assess.stage-primitive.ts                  │
│    │     ├── synthesize.stage-primitive.ts              │
│    │     ├── draft.stage-primitive.ts                   │
│    │     ├── review.stage-primitive.ts                  │
│    │     ├── signoff.stage-primitive.ts                 │
│    │     └── stage-primitive.interface.ts               │
│    ├── teams/registry/mission-pipeline-registry.ts      │
│    ├── lifecycle/mission-lifecycle/                     │
│    │     ├── abstractions/mission-store.interface.ts    │
│    │     ├── abstractions/mission-event-store.interface │
│    │     ├── mission-rerun-orchestrator.service.ts      │
│    │     └── (existing: abort/ownership/health/orphan)  │
│    └── facade (export)                                  │
└─────────────────────────────────────────────────────────┘
                       ↓ 用 LLM 原子能力
┌─────────────────────────────────────────────────────────┐
│  L2 ai-engine                                           │
│    ├── skills/                                          │
│    │     ├── skill-spec-builder.service.ts (R1-A0 新增) │
│    │     ├── output-schema-registry.ts     (R1-A0 新增) │
│    │     ├── runtime/skill-activator.service.ts (existing) │
│    │     └── registry/skill-registry.ts (existing, DB-backed) │
│    ├── tools/registry/tool-registry.ts (existing)       │
│    └── llm/services/ai-chat.service.ts (existing)       │
└─────────────────────────────────────────────────────────┘
```

**严格遵守 §0 基本原则**：harness / engine / infra 文件**全 grep 0 命中** ai-app 名 / 中文文案 / emoji。

### §3.2 7 个 stage primitive

每个 primitive 是 `IStagePrimitive` 实现，输入 `(ctx, config)` 输出 stage outputs。

| Primitive    | 职责（generic）                                                                     | 输入 ctx                 | 输出 ctx                                                  |
| ------------ | ----------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------- |
| `plan`       | 调 leader-style role 输出 dimensions / goals                                        | invariants               | `plan: { dimensions, goals, ... }`                        |
| `research`   | 按 fanOut 策略 fan-out × N 调 worker role；可选 per-item 子 pipeline hook           | plan                     | `researcherResults[]`                                     |
| `assess`     | 调 leader-style role 评估前序产出，决定 retry/abort/continue；返回决策动作给 runner | plan + researcherResults | `assessDecision`（含 stage outputs 业务字段，由 hook 写） |
| `synthesize` | 跨产出聚合，调 synthesis role；mode 参数决定行为（reconcile / analyze）             | 前序 ctx                 | `synthesisOutput`（业务字段由 hook 写）                   |
| `draft`      | 调 writer-style role 生成 artifact                                                  | 前序 ctx                 | `draft / artifact`                                        |
| `review`     | 调 reviewer-style role 评分 + 可选 enhancement hook                                 | draft                    | `reviewVerdict`                                           |
| `signoff`    | 调 leader-style role 终审 + accountability                                          | 全 ctx                   | `signoff`                                                 |

**内置无 LLM stage**：

- `persist`：写 IMissionStore.markCompleted/markFailed
- `learn`：异步 fire-and-forget，触发 FailureLearner + memory consolidation

**关键设计**：

- 每个 primitive 含核心 happy-path < 250 行
- 业务专属逻辑（如 s4 的 4 路 action 处理 / s8 的 judge consensus retry / s10 的 accountability sharedState 引用）**通过 hook 注入**
- hook 由 ai-app 提供 SKILL.md 或 service，registry 按 stage 名查找

```typescript
// harness/teams/services/stages/stage-primitive.interface.ts
export interface IStagePrimitive<TIn = unknown, TOut = unknown> {
  readonly id: string; // "plan" | "research" | ...
  run(args: {
    ctx: MissionContext<TIn>;
    role: ResolvedRole; // 含 SKILL.md / loop / outputSchema
    config: StageStepConfig;
    hooks: ResolvedHooks;
  }): Promise<TOut>;
}
```

### §3.3 SKILL.md 单一真相源

#### 3.3.1 SKILL.md 标准格式

```markdown
---
name: writing-team.leader
description: 写作 mission 的 Leader，负责规划 + 签字
version: "1.0"
allowedTools: [web-search, library-search]
allowedModels: [claude-sonnet-4-6, gpt-5]
activateFor: [leader]
outputSchemaRef: writing-team.leader-output
---

# Leader 灵魂

...

# Phase: plan

...

# Phase: signoff

{{#if previousDecisions}}

## 你过去的决策（必须引用）

{{#each previousDecisions}}

- [{{phase}}] {{decision}} — {{rationale}}
  {{/each}}
  {{/if}}
  ...
```

#### 3.3.2 R1-A0：必备底座（SkillSpecBuilder + OutputSchemaRegistry）

按 v1 评审 P0-4，**R1 之前必须先做 R1-A0**：

```typescript
// engine/skills/skill-spec-builder.service.ts
@Injectable()
export class SkillSpecBuilder {
  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly outputSchemaRegistry: OutputSchemaRegistry,
  ) {}

  build(skill: ISkill): IAgentSpec {
    return {
      id: skill.frontmatter.name,
      systemPrompt: skill.instructions,
      allowedTools: this.resolveAllowedTools(skill.frontmatter.allowedTools),
      allowedModels: skill.frontmatter.allowedModels,
      outputSchema: skill.frontmatter.outputSchemaRef
        ? this.outputSchemaRegistry.get(skill.frontmatter.outputSchemaRef)
        : z.unknown(),
    };
  }
}

// engine/skills/output-schema-registry.ts
@Injectable()
export class OutputSchemaRegistry {
  private readonly schemas = new Map<string, z.ZodType>();
  register(id: string, schema: z.ZodType): void { ... }
  get(id: string): z.ZodType { ... }
}
```

ai-app 在 onModuleInit 注册自己的 outputSchema：

```typescript
// ai-app/writing-team/writing-team.module.ts
onModuleInit() {
  this.outputSchemaRegistry.register("writing-team.leader-output", LeaderOutputSchema);
  // ...
}
```

#### 3.3.3 SKILL.md 加载链

```
ai-app SKILL.md 文件 (frontmatter + body)
  ↓
SkillActivator (existing) parses
  ↓
SkillSpecBuilder.build(skill) → IAgentSpec
  ↓
AgentRunner.run(spec, input, ctx)
```

**用户自定义 SKILL.md** 走同一链路（DB-backed via SkillRegistry），见 §3.8。

### §3.4 stateful agent runtime（保留 SupervisedMission 历史决策）

**关键问题**：playground 的 SupervisedMission 跨 4 milestone（plan/assess/foreword/signoff）持有 `decisions[]` 历史，最后 `accountabilityNote` 引用历史做问责。这是 playground 灵魂。

**SKILL.md 是无状态的**——每次激活重 prompt。

#### 3.4.1 解决方案：stateful 标记 + ctx 透传

```typescript
// MissionPipelineConfig
roles: [
  { id: "leader", skill: "writing-team.leader", stateful: true },  // ★ 标记
  ...
]

// MissionContext 自动维护 stateful role 的 stateful state
ctx.statefulRoleStates = {
  "leader": {
    decisions: [],  // 累计的历史决策
    custom: {},     // 业务自定义 stateful 字段
  }
}
```

#### 3.4.2 stage primitive 自动注入

```typescript
// plan.stage-primitive.ts
async run({ ctx, role, config, hooks }) {
  const skill = role.skill;
  const previousDecisions = ctx.statefulRoleStates[role.id]?.decisions ?? [];

  // 通过 SKILL.md 模板注入历史
  const renderedPrompt = renderSkill(skill, { previousDecisions, ... });

  const result = await runner.run(spec, input, { ... });

  // 自动记录决策
  if (role.stateful) {
    const decisionFromHook = await hooks.extractDecision?.({ result, phase: "plan" })
      ?? defaultExtractDecision(result, "plan");
    ctx.statefulRoleStates[role.id].decisions.push(decisionFromHook);
  }

  return result;
}
```

#### 3.4.3 ai-app 提供 hooks 自定义 decision 提取

```typescript
// ai-app/agent-playground/playground-stateful-hooks.ts
export const PlaygroundLeaderStatefulHooks = {
  extractDecision: ({ result, phase }) => ({
    phase,
    at: new Date().toISOString(),
    decision:
      phase === "plan"
        ? `plan:${result.dimensions.length}-dim`
        : phase === "assess"
          ? `${result.decision}: ${result.perDimension.map((p) => `${p.dimensionId}=${p.action}`).join(", ")}`
          : `${phase}:${JSON.stringify(result).slice(0, 100)}`,
    rationale: result.themeSummary?.slice(0, 200) ?? result.rationale ?? "",
  }),
};
```

**严守 §0**：harness 的 `defaultExtractDecision` 是 generic（无业务名）；ai-app 通过 config.hooks 注入业务专属提取逻辑。

### §3.5 数据模型：每 ai-app 自有表 + IMissionStore 端口

按 v1 评审 P0-3，**不做 generic mission_runs 表**。

#### 3.5.1 端口定义

```typescript
// harness/lifecycle/mission-lifecycle/abstractions/mission-store.interface.ts
export interface IMissionStore<TMission = unknown> {
  create(input: MissionCreateInput): Promise<TMission>;
  getById(id: string, userId: string): Promise<TMission | null>;
  listByUser(userId: string, opts?: ListOpts): Promise<TMission[]>;
  markCompleted(id: string, result: MissionResult): Promise<void>;
  markFailed(id: string, error: MissionError): Promise<void>;
  markCancelled(id: string, reason: string): Promise<void>;
  refreshHeartbeat(id: string, podId: string): Promise<void>;
  recoverOrphanedRunning(thresholdMin: number): Promise<number>;
  recoverPodCrashedRunning(staleSec: number): Promise<number>;
  appendDimensions?(
    id: string,
    items: { name: string; rationale: string }[],
  ): Promise<string[]>;
  // ... extend per ai-app 需要
}

export interface IMissionEventStore {
  append(missionId: string, event: BufferedEvent): Promise<void>;
  read(missionId: string, sinceTs?: number): Promise<BufferedEvent[]>;
  // ...
}
```

#### 3.5.2 ai-app 实现自己的 store

```typescript
// ai-app/agent-playground/services/mission/lifecycle/playground-mission.store.ts
@Injectable()
export class PlaygroundMissionStore implements IMissionStore<AgentPlaygroundMission> {
  constructor(private readonly prisma: PrismaService) {}

  async create(input) {
    return this.prisma.agentPlaygroundMission.create({
      data: { ...input, ... },
    });
  }
  // ... 操作 agent_playground_missions 业务表
}
```

playground 表 schema **保持完全不动**（满足决策 C）。新 ai-app（如 writing-team）创建自己的表。

#### 3.5.3 forTeam 隔离（v1 评审 P1-9）

**不需要 forTeam**——每个 ai-app 自己写 store，store 内部直接操作自己的 prisma 表，**没有 teamId 跨表问题**。

如果未来确实需要"用户自定义 Agent"共享 generic 表（§3.8），那 generic store 必须用 forTeam 模式：

```typescript
@Injectable()
export class CustomAgentMissionStore implements IMissionStore {
  constructor(private readonly prisma: PrismaService) {}

  // 强制 agentConfigId 注入，不暴露原始查询
  forAgent(agentConfigId: string): ScopedMissionStore {
    return new ScopedCustomAgentMissionStore(this.prisma, agentConfigId);
  }
}
```

### §3.6 控制层：薄壳 controller in ai-app

按 v1 评审 P0-2，**不做 DynamicController**。

#### 3.6.1 ai-app 写自己的 30 行 controller

```typescript
// ai-app/writing-team/writing-team.controller.ts
@Controller("writing-team")
@UseGuards(JwtAuthGuard)
export class WritingTeamController {
  constructor(
    private readonly orchestrator: MissionPipelineOrchestrator,
    private readonly config: typeof WritingTeamConfig, // injected via DI token
  ) {}

  @Post("team/run")
  async run(@Body() dto: unknown, @Request() req: RequestWithUser) {
    return this.orchestrator.run(this.config, dto, req.user.id);
  }

  @Get("missions")
  listMissions(@Request() req: RequestWithUser) {
    return this.orchestrator.listMissions(this.config.id, req.user.id);
  }

  @Get("missions/:id")
  getMission(@Param("id") id: string, @Request() req: RequestWithUser) {
    return this.orchestrator.getMission(this.config.id, id, req.user.id);
  }

  @Post("missions/:id/cancel")
  cancel(@Param("id") id: string, @Request() req: RequestWithUser) {
    return this.orchestrator.cancel(this.config.id, id, req.user.id);
  }
  // ... rerun / export / chat 同样 thin
}
```

业务字段路由（如 `/missions/:id/leader-chat`）按需扩展，但**生产路径**全部委托给 generic orchestrator。

### §3.7 前台 Agent 配置 UI 设计

#### 3.7.1 AI 配置页 4 个 tab

```
设置 → AI 配置
  ├── BYOK            (existing)
  ├── 模型             (existing)
  ├── Agent           (★ 新增)
  └── 偏好             (existing/optional)
```

#### 3.7.2 Agent tab 内容

```
我的 Agent ────────────────────────────────────
┌──────────────┬──────────────┬──────────────┐
│ Agent A      │ Agent B      │ + 创建新 Agent │
│ Mission 团队 │ Mission 团队 │              │
│ 5 missions   │ 12 missions  │              │
│ [运行] [编辑]│ [运行] [编辑]│              │
└──────────────┴──────────────┴──────────────┘

平台模板 ────────────────────────────────────
┌──────────────┬──────────────┬──────────────┐
│ 📊 PPT 团队  │ 📝 写作团队  │ 🔍 研究团队  │
│ [浏览]       │ [使用]       │ [使用]       │
└──────────────┴──────────────┴──────────────┘
```

#### 3.7.3 创建 Agent 5 步向导

```
Step 1: 选类型
  [Mission 团队]     ← MVP 仅此

Step 2: 选模板
  - 浏览平台模板（playground / writing-team / ...）
  - 我的 Agent 复制
  - 空白开始
  ☑ 选中"playground 模板" → 自动填充 §3-§5

Step 3: 基本信息
  名称: ____________
  图标: 🎯 (emoji 选择器)
  描述: ____________
  左侧菜单分组: [我的 Agent ▼] (默认)

Step 4: 角色配置
  [+] 添加角色
  ┌──────────────────────────────────────────┐
  │ 角色 1: Leader                  [×] [↑]  │
  │ Skill: [双模式编辑器]                     │
  │   ○ 简单模式（5 个引导问题）              │
  │   ○ 高级模式（直接编辑 SKILL.md markdown）│
  │ 允许工具: [☑ web-search ☑ library-search]│
  │ 允许模型: [☑ claude-sonnet-4-6]          │
  │ 输出格式: [free-text ▼ / 结构化 JSON]    │
  └──────────────────────────────────────────┘

Step 5: Topic schema + 预览
  字段:
    [+] 添加字段
    topic       string  required  "研究主题"
    depth       enum    required  ["quick","standard","deep"]
  预览（运行时表单）:
    [研究主题: ___]
    [深度: quick ▼]
    [运行]

  [创建 Agent]
```

#### 3.7.4 Skill 编辑器（双模式）

**简单模式**（5 个引导问题）：

```
1. 这个角色是谁？
   [Senior researcher with deep domain knowledge.]

2. 主要职责？
   [Collect findings from web/academic sources, validate evidence.]

3. 输出格式？
   ○ 自由文本
   ○ 结构化 JSON
   ○ 带 schema 的结构化（已选）→ 跳到 schema 编辑器

4. 拒绝什么？
   [Don't hallucinate sources. Refuse if topic is unclear.]

5. 风格？
   [Concise, evidence-based, cite specifics.]
```

向导生成 SKILL.md 文本，存到 `user_skills` 表。

**高级模式**：直接 markdown 编辑器（CodeMirror / Monaco），用户自己写 frontmatter + body。

#### 3.7.5 左侧菜单动态项

```typescript
// frontend/components/layout/sidebar.tsx
const { data: customAgents } = useQuery("/api/v1/custom-agents");

return (
  <Sidebar>
    <PlatformSection />
    {customAgents.length > 0 && (
      <Section title="我的 Agent" collapsible>
        {customAgents.map(a => (
          <SidebarItem
            key={a.id}
            icon={a.icon}
            label={a.name}
            href={`/agent/${a.id}`}
          />
        ))}
      </Section>
    )}
  </Sidebar>
);
```

#### 3.7.6 Agent 运行页（generic MissionUI）

```
GET /agent/:id
  → 渲染 page:
    Topic 输入表单（按 config.topicSchema 生成 form）
    历史 Missions 列表（GET /api/v1/custom-agents/:id/missions）

GET /agent/:id/missions/:missionId
  → 复用 playground 同款 MissionDetailPage 组件
    （组件已是 config-driven，按 pipeline 渲染时间线）
```

### §3.8 用户自定义 Agent 数据模型 + API

#### 3.8.1 prisma 表

```prisma
// 用户自定义 Agent 配置
model CustomAgentConfig {
  id           String   @id @default(uuid())
  userId       String
  workspaceId  String?
  name         String
  description  String?
  icon         String?
  templateId   String?    // 引用平台模板 id（如 "playground"）
  config       Json       // MissionPipelineConfig 序列化
  status       String     // 'draft' | 'active' | 'archived'
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
  @@index([userId, status])
  @@map("custom_agent_configs")
}

// 用户自定义 SKILL.md
model UserSkill {
  id              String   @id @default(uuid())
  userId          String
  name            String   // SKILL.md frontmatter.name
  frontmatterJson Json     // 解析后的 frontmatter
  instructions    String   @db.Text  // markdown body
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@unique([userId, name])
  @@map("user_skills")
}

// 用户自定义 Agent mission（generic 表，按 agentConfigId 隔离）
model CustomAgentMission {
  id              String   @id @default(uuid())
  agentConfigId   String
  userId          String
  workspaceId     String?
  topic           Json
  status          String
  startedAt       DateTime @default(now())
  completedAt     DateTime?
  metadata        Json?     // 业务产物存这里（user-generated agent 没有自己的业务表）
  heartbeatAt     DateTime?
  podId           String?
  // ... 其他通用字段
  @@index([agentConfigId, userId, startedAt])
  @@map("custom_agent_missions")
}

model CustomAgentMissionEvent {
  id          String   @id @default(uuid())
  missionId   String
  type        String
  agentId     String?
  payload     Json
  ts          BigInt
  @@index([missionId, ts])
  @@map("custom_agent_mission_events")
}
```

#### 3.8.2 后端 API（在 ai-app 层新建 custom-agents 模块）

```
ai-app/custom-agents/
  ├── custom-agents.controller.ts
  ├── custom-agents.module.ts
  ├── custom-agent.config-builder.ts    # 把 CustomAgentConfig.config 反序列化为 MissionPipelineConfig
  ├── custom-agent-mission.store.ts     # 实现 IMissionStore（按 agentConfigId 隔离）
  └── services/
      ├── custom-agent-config.service.ts
      └── user-skill.service.ts
```

```
# Custom Agent CRUD
GET    /api/v1/custom-agents
POST   /api/v1/custom-agents
GET    /api/v1/custom-agents/:id
PATCH  /api/v1/custom-agents/:id
DELETE /api/v1/custom-agents/:id

# Custom Agent Mission
POST   /api/v1/custom-agents/:id/run
GET    /api/v1/custom-agents/:id/missions
GET    /api/v1/custom-agents/:id/missions/:missionId
POST   /api/v1/custom-agents/:id/missions/:missionId/cancel
POST   /api/v1/custom-agents/:id/missions/:missionId/rerun
GET    /api/v1/custom-agents/:id/missions/:missionId/export

# User Skills
GET    /api/v1/user-skills
POST   /api/v1/user-skills
PATCH  /api/v1/user-skills/:id
DELETE /api/v1/user-skills/:id

# Templates Gallery
GET    /api/v1/agent-templates           # 平台模板（playground / writing / ...）
GET    /api/v1/agent-templates/:id       # 单模板详情

# Tool Catalog（已有 ToolRegistry，加 endpoint 暴露）
GET    /api/v1/tool-catalog
```

#### 3.8.3 SkillRegistry 多源 lookup

```
SkillActivator.lookup(skillId)
  → 优先级 1: BuiltinSkillCatalog (in-memory, 平台预置 SKILL.md from filesystem)
  → 优先级 2: UserSkillProvider (DB-backed, user_skills table)
  → 找不到 → throw / fallback
```

`UserSkillProvider implements ISkillProvider`（已有端口，§"engine/skills 现状"），只需新建 adapter 把 user_skills 表 row 转 `ISkill`。

---

## §4 实施路径（5 阶段）

### R0 基本原则严守（**必须先做**，3.5 天）

详见 §0.2 / §0.3 / §0.4。

### R1 通用框架落地（无 ai-app 改动）

#### R1-A0 SkillSpecBuilder + OutputSchemaRegistry（3-5 天，MEDIUM 风险）

- engine/skills/skill-spec-builder.service.ts
- engine/skills/output-schema-registry.ts
- engine/facade exports
- 单元测试

#### R1-A 7 个 stage primitive（5-7 天，HIGH 风险）

- harness/teams/services/stages/stage-primitive.interface.ts
- 7 个 primitive：plan / research / assess / synthesize / draft / review / signoff
- 每个 happy-path < 250 行，业务专属逻辑通过 hook 注入
- 单元 + integration spec

#### R1-B MissionPipelineOrchestrator + MissionPipelineConfig + Registry（4-6 天，HIGH 风险）

- harness/teams/orchestrator/mission-pipeline-orchestrator.service.ts
- harness/teams/registry/mission-pipeline-registry.ts
- defineMissionPipeline(config) helper + 校验
- 不 extends TeamConfig，独立类型（v1 评审 P1-7）
- 单元 + e2e spec（mock store / mock SKILL.md）

#### R1-C IMissionStore / IMissionEventStore 端口（2 天，MEDIUM 风险）

- harness/lifecycle/mission-lifecycle/abstractions/mission-store.interface.ts
- harness/lifecycle/mission-lifecycle/abstractions/mission-event-store.interface.ts
- 把现有 PlaygroundMissionStore 改成 implements 该端口（不动表）
- harness/facade exports

#### R1-D MissionRerunOrchestrator + MissionExportService 通用化（3-5 天，MEDIUM 风险）

- harness/lifecycle/mission-lifecycle/mission-rerun-orchestrator.service.ts（迁移 ai-app 现版）
- export 留 ai-app 层（v1 评审：导出格式属业务，不进 harness）
- harness/facade exports

#### R1-E NestJS forFeature spike + 决策（1 天）

- spike：动态 module + dynamic @Controller 是否可行
- 验证不通过 → 撤回 forFeature，全部走"普通 NestJS module + 普通 controller"
- v1 评审默认推荐撤回（评审 P0-5）

**R1 合计：18-24 天**

### R3-A writing-team demo（先于 R2，5-7 天，MEDIUM 风险）

按 v1 评审 P2-10：先做小 ai-app 验证框架。

- writing-team.config.ts (~80 行)
- writing-team.controller.ts (~30 行)
- writing-team.module.ts
- writing-team-mission.store.ts (~100 行 + prisma 业务表)
- 4 份 SKILL.md
- e2e: writing-team mission 完整跑通
- 暴露框架问题 → 修 R1

### R2 playground 迁移（保持外观零变化）

#### R2-A0 playground 18 个 soul/duty.md → 8 个 SKILL.md 重组（v1 评审 P2-16）（3-5 天）

- 当前 18 个 soul/duty.md 是二级结构，不符合 frontmatter SKILL.md 标准
- 重组成 8 个 SKILL.md（leader / researcher / reconciler / analyst / writer / reviewer / verifier / steward）
- frontmatter 含 activateFor 和 outputSchemaRef
- 验证：用旧 buildPromptFromDuty 生成的 prompt vs 新 SkillActivator 生成的 prompt **逐字符对比**等价

#### R2-A playground.config.ts 双轨上线（5-7 天，HIGH 风险）

- 创建 playground.config.ts
- pipeline = [budget, plan, research(fanOut+hooks), assess, synthesize(reconcile), synthesize(analyze), draft(outline), draft(full), review(quality-enhancement), review(critic), review(objective-eval), signoff, persist, learn]
- hooks 注册 playground 业务专属（reconciler / quality-enhancement / objective-eval / accountability extractor / ...）
- prismaTable 指向 PlaygroundMissionStore（保持原表）
- eventPrefix = "agent-playground"（保持现有）
- endpointPrefix = "agent-playground"（保持现有）
- **双轨**：旧 team.mission.ts 不删，新 MissionPipelineOrchestrator 通过 feature flag 启用
- mission_runs.metadata 加 `runtime_version: 'legacy' | 'pipeline-v1'`（评审 P2-11）

#### R2-B e2e 等价性验证（5-7 天，HIGH 风险）

- 9 路 mission 矩阵（按 topic / depth / lengthProfile 组合）
- 等价性标准（v1 评审 P2-12）：
  - mission completed/failed/cancelled 一致
  - failureCode 字符串集合一致
  - reportArtifact.sections.length 一致
  - reviewScore 在 ±10
  - 报告 wordCount 在 ±20%
  - dimensions.length 一致
  - 事件 type 字符串集合一致
- 远程 Railway 跑（项目规则）
- 双轨期至少观察 1 周

#### R2-C 删除 playground 旧实现（3-5 天，MEDIUM 风险）

- 删：team.mission.ts / 13 stage 文件 / mission-runtime-shell / mission-stage-bindings / mission-context / mission-deps / per-dim-pipeline / runner-state / narrative / report-artifact-sections / word-count-normalizer / duty-loader / 18 个 soul/duty.md
- 保留：playground.config.ts / 8 个 SKILL.md / 业务 hook services / playground-mission.store / business 专属 prisma model / dto / module / 薄 controller
- 改后 playground 目录约 30 文件（vs 现状 ~80）
- 跑全量 spec + 远程 mission e2e

### R4 用户自定义 Agent UI + API（按 §3.7 / §3.8）

#### R4-A 后端 ai-app/custom-agents 模块（5-7 天，MEDIUM 风险）

- prisma：custom_agent_configs / user_skills / custom_agent_missions / custom_agent_mission_events 表 + 手写迁移
- custom-agents.module.ts + controller.ts
- CustomAgentMissionStore 实现 IMissionStore
- UserSkillProvider 实现 ISkillProvider
- API endpoints

#### R4-B 前端 5 步向导（7-10 天，HIGH 风险）

- frontend/app/settings/ai/agents/ 路径
- create wizard 5 步组件
- skill-editor 双模式
- topic-form 按 schema 渲染
- agent runtime 页面 `/agent/:id`（复用 generic MissionUI）
- 左侧菜单 customAgents 动态项

#### R4-C e2e + 用户验收（3-5 天）

- 用户从 0 创建一个 agent → 跑通一次 mission → 导出报告
- e2e playwright 测试

**R4 合计：15-22 天**

---

## §5 playground 13 stage → 7 primitive 详细映射

| playground stage            | harness primitive                      | hook 注入业务专属                                                                                       | playground SKILL.md                                                                                                       |
| --------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| s1-budget                   | `persist`(pre) + 通用 budget guard     | budgetEstimator hook                                                                                    | —                                                                                                                         |
| s2-leader-plan              | `plan`                                 | extractDecision hook（plan）                                                                            | `playground.leader@plan`                                                                                                  |
| s3-researcher-collect       | `research` (fanOut="byPlanDimensions") | perItemPipeline hook（含 chapter writer + reviewer + integrator + 5-axis grade）                        | `playground.researcher` + `playground.chapter-writer` + `playground.chapter-reviewer` + `playground.dimension-integrator` |
| s4-leader-assess            | `assess`                               | dispatchAssessActions hook（accept/retry/replace/abort 四路）+ s4PatchRound 上限 + s4PatchFailures 上报 | `playground.leader@assess`                                                                                                |
| s5-reconciler               | `synthesize` (mode="reconcile")        | single_dimension 短路 hook                                                                              | `playground.reconciler`                                                                                                   |
| s6-analyst                  | `synthesize` (mode="analyze")          | retry-once hook (空输出兜底)                                                                            | `playground.analyst`                                                                                                      |
| s7-writer-outline           | `draft` (sub-stage="outline")          | thorough+ 档位 gate hook                                                                                | `playground.writer@outline`                                                                                               |
| s8-writer                   | `draft` (sub-stage="full")             | judge consensus retry hook + memory.indexer hook + reportArtifact assembler hook                        | `playground.writer@full`                                                                                                  |
| s8b-quality-enhancement     | `review` 的 `afterReview` hook         | sectionSelfEval + sectionRemediation 调用                                                               | `playground.quality-enhance`                                                                                              |
| s9-critic                   | `review` (mode="meta-critic")          | criticL4 score scaling hook                                                                             | `playground.critic`                                                                                                       |
| s9b-objective-eval          | `review` (mode="objective")            | reportEvaluation 10 维注入 hook                                                                         | `playground.objective-eval`                                                                                               |
| s10-leader-foreword-signoff | `signoff`                              | accountability hook（引用 ctx.statefulRoleStates.leader.decisions）+ s4PatchFailures gate hook          | `playground.leader@signoff`                                                                                               |
| s11-persist                 | `persist`                              | —                                                                                                       | —                                                                                                                         |
| s12-self-evolution          | `learn`                                | postmortem-classifier hook + memory.consolidation 触发                                                  | —                                                                                                                         |

**关键判断**：

- 7 primitive 全部能容纳 playground 13 stage
- 业务专属 stuff 全部走 hook 注入（playground 提供）
- harness primitive 内核 < 250 行，hook 实现行数计入 ai-app（playground 业务代码 ~1500-2500 行符合 §1.2 KPI）

---

## §6 风险与缓解

| 风险                                                                                    | 等级   | 缓解                                                                                                                              |
| --------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| §0 基本原则违规清理破坏现有 ai-app（office/research/topic-insights 引用 BUILTIN_TEAMS） | HIGH   | R0 改动后跑全量 spec；importer 全量 grep 提前更新                                                                                 |
| stateful agent runtime（decisions[] 透传）实现 bug 导致 accountability 失效             | HIGH   | R2-B e2e 矩阵专门有"accountability 引用历史"用例                                                                                  |
| 7 stage primitive 抽象漏 playground 特殊逻辑                                            | HIGH   | R3-A writing-team demo 先验证；R2-A 双轨期可观察 1 周                                                                             |
| Prisma 双轨期数据写入不一致                                                             | MEDIUM | playground 旧表保留，新框架走 PlaygroundMissionStore 直接写旧表，无双表问题                                                       |
| NestJS module DI / scope 问题                                                           | MEDIUM | R1-E 1 天 spike 提前验证                                                                                                          |
| 18 个 duty.md → 8 个 SKILL.md 重组期间 prompt 等价性破坏                                | HIGH   | R2-A0 单独阶段，逐字符对比                                                                                                        |
| 用户自定义 Agent SKILL.md 安全（用户 prompt 注入）                                      | MEDIUM | R4-A 加 prompt-injection 检查（engine/safety 已有）                                                                               |
| 前端 5 步向导 UX 复杂度大                                                               | MEDIUM | MVP 简单模式 5 引导问题 + 高级模式 markdown 编辑器双模式                                                                          |
| W21 / W22 主线波次冲突                                                                  | LOW    | mission-pipeline 在 teams/orchestrator + lifecycle/mission-lifecycle 子聚合，与 W21 memory 契约 / W22 base layer 定制代码归位正交 |

---

## §7 回滚策略

每个 R 阶段单独 commit + feature flag 控制，可独立 revert：

- **R0 后回滚**：BUILTIN_TEAMS 等常量恢复（git revert R0 commits）
- **R1 完成后但 R2 未做**：harness 多了 mission-pipeline 框架但无 ai-app 用，零回滚成本
- **R2-A 双轨期发现新框架问题**：feature flag 切回 legacy runtime（playground 旧实现仍在）
- **R2-C 删除阶段发现回归**：保留新代码 + 修 bug；新框架已写新数据到 playground 旧表，无双表迁移
- **R4 后回滚**：CustomAgent 模块独立，可 disable

#### R2-C 真实回滚路径（v1 评审 P2-14）

R2-A 起 mission_runs.metadata.runtime_version='pipeline-v1'，但表 schema 是 playground 旧表（playground.config 通过 PlaygroundMissionStore 写入旧表）。**R2-C 删除新框架代码后，旧 controller 仍能读这些 mission（因为表没变）**——回滚不需要数据迁移，只需要 git revert R2-A/B/C 三轮 commits。

---

## §8 与 W21/W22 协调

| 主线波次                    | 关系   | 协调点                                                                                                      |
| --------------------------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| W17 engine 顶层重组         | 已完成 | 无影响                                                                                                      |
| W18 命名规范对齐            | ⏳待办 | 本方案产物全部按命名规范（`.compactor.ts` / `.classifier.ts` / `.utils.ts` 等）                             |
| W19 harness 命名规范对齐    | ⏳待办 | 同上                                                                                                        |
| W20 扩展治理契约            | ⏳待办 | §0 + R0 自动化看护是 W20 的具体载体之一                                                                     |
| W21 memory 契约收敛         | ⏳待办 | R1-C IMissionStore 端口与 W21 checkpoint 主 contract 对齐；如 W21 未启动可先用临时 contract，W21 启动时同步 |
| W22 base layer 定制代码归位 | ⏳待办 | §0 R0 + R2-C 删除 playground 私有代码 = W22 在 playground 上的具体落地                                      |

---

## §9 时间表

```
W1:    R0 基本原则违规清理 (3.5 天)
W2:    R1-A0 SkillSpecBuilder + OutputSchemaRegistry (3-5 天)
W3:    R1-A 7 stage primitive (5-7 天)
W4-5:  R1-B MissionPipelineOrchestrator + Config + Registry (4-6 天)
       R1-C IMissionStore 端口 (2 天)
       R1-D MissionRerunOrchestrator 通用化 (3-5 天)
       R1-E NestJS forFeature spike (1 天)
W6:    R3-A writing-team demo (5-7 天)
       ↓ 发现 R1 框架问题 → 修 R1
W7:    R2-A0 playground 18 → 8 SKILL.md 重组 (3-5 天)
W8:    R2-A playground.config 双轨上线 (5-7 天)
W9:    R2-B e2e 等价性验证（双轨观察 1 周）
W10:   R2-C 删除 playground 旧实现 (3-5 天)
W11-13: R4-A/B/C 用户自定义 Agent UI + API (15-22 天)

总计 13 周（3 个月），单人全职。含 W21/W22 主线协调缓冲。
```

---

## §10 验收标准

### R0 验收

- [ ] BUILTIN_TEAMS / BUILTIN_AGENTS / BUILTIN_ROLES 常量删除，业务名下推到 ai-app
- [ ] base-layer-business-leakage.spec.ts 通过（0 命中）
- [ ] ESLint no-restricted-syntax 已配置 + lint 通过
- [ ] postmortem-classifier substring 改为 config 注入
- [ ] 全量 spec + verify:arch 通过

### R1 验收

- [ ] 7 stage primitive 单元测试覆盖
- [ ] MissionPipelineOrchestrator e2e（mock store）跑通
- [ ] IMissionStore / IMissionEventStore 端口暴露在 facade
- [ ] SkillSpecBuilder 接 SKILL.md → IAgentSpec 验证

### R3-A 验收

- [ ] writing-team < 15 文件实现完整 mission 流程
- [ ] 资深开发者 < 2 天独立完成
- [ ] 跑通 e2e mission

### R2 验收

- [ ] playground 18 → 8 SKILL.md 重组后 prompt 等价（逐字符）
- [ ] R2-B 9 路 mission 等价性达标（按 §6 R2-B 标准）
- [ ] playground 前台 0 改动验证
- [ ] R2-C 后 playground 目录文件数 < 35

### R4 验收

- [ ] 用户从 AI 配置页 5 步创建 agent
- [ ] 左侧菜单出现 "我的 Agent / <name>"
- [ ] 点击进入跑通一次 mission
- [ ] 导出 markdown 报告

### 整体验收

- [ ] 新 ai-app（mission-style）开发时间：资深开发者 < 2 天 / AI Agent < 4 小时
- [ ] playground 业务代码总行数 < 2500
- [ ] base-layer-business-leakage.spec：0 命中（永远 0）
- [ ] 全部 spec / verify:arch / e2e 通过

---

**v2 起草完成 — 等待内部 v2 评审。**

**关键变更 vs v1**：

1. **§0 新增**：base layer 业务无关原则 + R0 违规清理 + 自动化看护
2. **§3.1**：mission-pipeline 不新建子聚合，归位到 `teams/orchestrator/` + `teams/services/stages/` + `lifecycle/mission-lifecycle/`
3. **§3.4 新增**：stateful agent runtime（保留 SupervisedMission 历史决策）
4. **§3.5**：撤回 generic mission_runs 表，改"每 ai-app 自有表 + IMissionStore 端口"
5. **§3.6**：撤回 DynamicMissionController，改"薄壳 controller in ai-app"
6. **§3.7 新增**：前台 Agent 配置 UI 设计
7. **§3.8 新增**：用户自定义 Agent 数据模型 + API
8. **§4 R0**：基本原则严守阶段（最高优先级）
9. **§4 R1-A0 新增**：SkillSpecBuilder + OutputSchemaRegistry 必备底座
10. **§4 R3-A**：writing-team demo 提前到 R2 之前（v1 评审 P2-10）
11. **§4 R2-A0 新增**：playground 18 → 8 SKILL.md 重组前置
12. **§9 时间**：6 周 → 13 周（诚实数字 + W21/W22 协调缓冲）
13. **§10 验收**：base-layer-business-leakage 0 命中作为永久门槛
