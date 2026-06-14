# 27 - Extension Cookbook（如何新增 X）

> Onboarding 配方：新增 Agent / Team / Skill / Tool / Mission-Stage 的最小可运行步骤。
>
> 每个配方的文件路径、基类名、导入路径、Registry 名都已对照真实代码核对（见文末「参考实现」）。
> 复制样板时把占位符替换成你的命名即可，不要臆造未列出的字段。
>
> 核心规则（来自 CLAUDE.md，所有配方通用）：
>
> - AI App 层一律从 `@/modules/ai-harness/facade` 或 `@/modules/ai-engine/facade` 导入，**禁止穿透内部路径**。
> - 注册发生在 `onModuleInit`，Registry 作为**硬依赖**注入（缺失即启动失败，不要 `@Optional` 兜过去）。
> - LLM 调用走 `ChatFacade.chat()` + `modelType` + `taskProfile`，禁止硬编码模型名 / 温度。
> - 禁 `any` / `console.log` / emoji；异步必 try-catch。
> - 新增 .module.ts / 入口文件由主 Agent 操作，Sub-Agent 不得新建模块。

---

## 速查表

| 类型          | 新建文件位置（示例）                                      | 注册 Registry                | 注册方法                   | 导入来源                |
| ------------- | --------------------------------------------------------- | ---------------------------- | -------------------------- | ----------------------- |
| Agent         | `ai-app/<mod>/agents/<name>.agent.ts`                     | `AgentRegistry`              | `.register(agent)`         | `ai-harness/facade`     |
| Team          | `ai-app/<mod>/teams/<name>-team.config.ts`                | `TeamRegistry`               | `.registerConfig(config)`  | `ai-harness/facade`     |
| Skill (code)  | `ai-app/<mod>/skills/<name>.skill.ts`                     | `SkillRegistry`              | `.register(skill)`         | `ai-harness/facade`     |
| Tool          | `ai-engine/tools/categories/<cat>/<name>.tool.ts`         | `ToolRegistry`（自动批注册） | 加进 `ALL_TOOL_CLASSES`    | 相对路径（engine 内部） |
| Mission-Stage | `ai-app/playground/mission/pipeline/stages/sN-*.stage.ts` | `MissionPipelineRegistry`    | step + `buildHooksForStep` | `ai-harness/facade`     |

> 验证命令（在 `backend/` 下）：`npm run type-check` / `npm run verify:arch` / `npm run test:quick`。
> 全栈快捷命令（在仓库根）：`npm run verify:quick`（type-check + test:quick）、`npm run verify:full`。

---

## 要 X 能力 → 从哪个 facade 导入（canonical 速查）

> **背景**：约 23 个 engine 原子符号同时从 `ai-engine/facade` 与 `ai-harness/facade` 导出，IDE
> auto-import 会随机挑一个。**canonical 来源 = `ai-engine/facade`**；harness 对这些符号仅做过渡
> re-export，且已加 `@deprecated` JSDoc（IDE 显示删除线）引导你换源。**不要因为"两边都能 import 通"
> 就随手挑 harness 那条**。

**判定法则（一句话）：**

- **engine 原子能力**（LLM 调用 / RAG / Skill 注册 / Tool 注册 / 模型配置 / 安全守卫等，"换个 App 也能复用"）→ **从 `@/modules/ai-engine/facade` 导入**。
- **harness 运行时能力**（Agent / Team / Mission 生命周期 / 编排 loop / 协议 / 追踪 / 资源 guardrails 等，"必知 agent / mission"）→ **从 `@/modules/ai-harness/facade` 导入**。

| 你要的能力                                                                        | canonical facade    | 代表符号                                                                                                                                 |
| --------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| LLM 调用 / 模型配置 / failover / 发现 / 连接测试 / 自动配置                       | `ai-engine/facade`  | `AiChatService` `AiModelConfigService` `ModelFallbackService` `AiModelDiscoveryService` `AiConnectionTestService` `AutoConfigureService` |
| 模型选举 / prompt 缓存协调 / `inferIsReasoning`                                   | `ai-engine/facade`  | `ModelElectionService` `MissionElectionTracker` `PromptCacheCoordinatorService` `inferIsReasoning`                                       |
| RAG 基元（embedding / 向量 / 切块 / pipeline）                                    | `ai-engine/facade`  | `EmbeddingService` `VectorService` `DocumentChunker` `RAGPipelineService`                                                                |
| Skill 注册 / 桥接                                                                 | `ai-engine/facade`  | `SkillRegistry` `PromptSkillBridge`                                                                                                      |
| Tool 注册 / 具体工具                                                              | `ai-engine/facade`  | `ToolRegistry` `FederalRegisterTool` `CongressGovTool` `WhiteHouseNewsTool`                                                              |
| 上下文压缩 / 上下文演化 / 跨切面综合 / token 预算                                 | `ai-engine/facade`  | `ContextCompressionService` `ContextEvolutionService` `CrossCuttingSynthesisService` `TokenBudgetService`                                |
| 安全守卫 / 熔断 / 图像匹配 / 内容 sanitize / function-calling 适配 / YouTube 抓取 | `ai-engine/facade`  | `CapabilityGuardService` `CircuitBreakerService` `ImageMatchingService` `sanitizeForDb` `FunctionCallingLLMAdapter` `YoutubeService`     |
| Agent 定义 / 注册 / 基类                                                          | `ai-harness/facade` | `AgentRegistry` `AgentFactory` `BaseAgent` `PlanBasedAgent`                                                                              |
| Team / Role 注册 / Mission 编排 / pipeline                                        | `ai-harness/facade` | `TeamRegistry` `RoleRegistry` `MissionOrchestrator` `MissionPipelineOrchestrator`                                                        |
| Mission 生命周期 / 终态仲裁 / checkpoint / 健康监测                               | `ai-harness/facade` | `MissionLifecycleManager` `MissionCheckpointService` `MissionHealthMonitor`                                                              |
| 运行循环 / executor / token 追踪 / DAG 调度                                       | `ai-harness/facade` | `AgentExecutorService` `QueryLoopService` `TokenTrackerService` `DAGExecutor`                                                            |
| 协议（事件总线 / IPC / A2A / 实时 / journal）                                     | `ai-harness/facade` | `DomainEventBus` `EventBusService` `MessageBusService` `EventJournalService`                                                             |
| 追踪 / 可观测 / 评测 harness                                                      | `ai-harness/facade` | `AgentTracer` `AiObservabilityService` `EvalHarnessService`                                                                              |
| 资源 guardrails（预算 / 计费 / 限流 / 并发 / 约束）                               | `ai-harness/facade` | `MissionBudgetPool` `BillingRuntimeEnvAdapter` `RateLimiter` `ConstraintEngine`                                                          |

> **当且仅当一个符号两边都导出时**，挑 `ai-engine/facade`（canonical）。harness 那条标了 `@deprecated`，
> 留着只为不破坏 600+ 现有 import，**不要新增对 harness 那条的依赖**。纯 harness 运行时符号（上表下半部分）
> 在 engine/facade 不存在，照常从 `ai-harness/facade` 导入。

---

## 配方 1：新增 Agent

参考实现：`backend/src/modules/ai-app/insight/agents/topic-insights.agent.ts`

### ① 必改/新建文件

1. 新建 `ai-app/<module>/agents/<name>.agent.ts` —— Agent 类。
2. 改 `ai-app/<module>/<module>.module.ts` —— 加进 providers + 在 `onModuleInit` 注册（入口文件由主 Agent 改）。

### ② Hello-world 样板（extend `PlanBasedAgent`）

```typescript
import { Injectable, Logger } from "@nestjs/common";
import {
  PlanBasedAgent,
  BUILTIN_TOOLS,
  type AgentInput,
  type AgentPlan,
  type AgentEvent,
  type ToolId,
} from "@/modules/ai-harness/facade";

@Injectable()
export class MyAgent extends PlanBasedAgent {
  private readonly logger = new Logger(MyAgent.name);
  readonly id = "my-agent";
  readonly name = "My Agent";
  readonly description = "一句话说明能力";
  readonly capabilities = ["能力A", "能力B"];
  readonly requiredTools: ToolId[] = [BUILTIN_TOOLS.WEB_SEARCH];
  protected templates = [];
  protected selectionKeywords: string[] = ["关键词1", "关键词2"];

  async plan(input: AgentInput): Promise<AgentPlan> {
    return {
      taskId: this.generateTaskId(),
      agentId: this.id,
      steps: [],
      estimatedTime: 0,
      toolsRequired: this.requiredTools,
      modelsRequired: ["chat"],
      metadata: { module: "my-module" },
    };
  }

  async *execute(_plan: AgentPlan): AsyncGenerator<AgentEvent> {
    yield {
      type: "complete",
      result: {
        success: true,
        artifacts: [],
        summary: "done",
        tokensUsed: 0,
        duration: 0,
      },
    };
  }
}
```

### ③ 注册位置（在 `<module>.module.ts`）

```typescript
import { AgentRegistry } from "@/modules/ai-harness/facade";

export class MyModule implements OnModuleInit {
  constructor(private readonly agentRegistry: AgentRegistry /* 硬依赖 */) {}
  onModuleInit() {
    this.agentRegistry.register(this.myAgent); // myAgent 通过 providers 注入
  }
}
```

### ④ 导入来源

`PlanBasedAgent` / `AgentRegistry` / `BUILTIN_TOOLS` / `AgentInput` / `AgentPlan` / `AgentEvent` / `ToolId` 全部从 `@/modules/ai-harness/facade`。

### ⑤ verify

`npm run type-check` + `npm run verify:arch`（确认没穿透 facade）。

---

## 配方 2：新增 Team

参考实现：`backend/src/modules/ai-app/insight/teams/topic-insights-team.config.ts`（配置）

- `backend/src/modules/ai-app/insight/topic-insights.module.ts`（注册，见 `onModuleInit`）

### ① 必改/新建文件

1. 新建 `ai-app/<module>/teams/<name>-team.config.ts` —— 导出 `TeamConfig`（含内嵌 `WorkflowConfig`）。
2. 改 `<module>.module.ts` —— 在 `onModuleInit` 调 `teamRegistry.registerConfig(...)`。

### ② Hello-world 样板（`TeamConfig`）

```typescript
import {
  BUILTIN_ROLES,
  BUILTIN_TOOLS,
  createConstraintProfile,
  type TeamConfig,
  type WorkflowConfig,
} from "@/modules/ai-harness/facade";

const MY_WORKFLOW: WorkflowConfig = {
  id: "my-workflow",
  name: "我的工作流",
  type: "hybrid",
  steps: [
    {
      id: "research",
      name: "研究",
      description: "并行研究",
      type: "task",
      executorRoles: [BUILTIN_ROLES.RESEARCHER],
      parallel: true,
      dependsOn: [],
    },
  ],
  timeout: 60 * 60 * 1000,
};

export const MY_TEAM_CONFIG: TeamConfig = {
  id: "my-team",
  name: "我的团队",
  description: "一句话说明",
  type: "predefined",
  leaderRoleId: BUILTIN_ROLES.RESEARCHER,
  memberRoles: [
    {
      roleId: BUILTIN_ROLES.RESEARCHER,
      minCount: 1,
      maxCount: 3,
      required: true,
    },
  ],
  workflow: MY_WORKFLOW,
  availableSkills: ["research-planning"],
  availableTools: [BUILTIN_TOOLS.WEB_SEARCH],
  constraintProfile: createConstraintProfile("thorough"),
  deliverableTypes: ["report"],
};
```

### ③ 注册位置（在 `<module>.module.ts`）

```typescript
import { TeamRegistry } from "@/modules/ai-harness/facade";
import { MY_TEAM_CONFIG } from "./teams";

export class MyModule implements OnModuleInit {
  constructor(private readonly teamRegistry: TeamRegistry /* 硬依赖 */) {}
  onModuleInit() {
    this.teamRegistry.registerConfig(MY_TEAM_CONFIG);
  }
}
```

> 注意：是 `registerConfig(...)`，不是 `register(...)`。若 team 用到自定义业务 leader 角色，
> 还需先 `roleRegistry.registerFromConfig(<ROLE_CONFIG>)`（topic-insights 复用 `RESEARCH_LEAD_ROLE_CONFIG`）。

### ④ 导入来源

`TeamRegistry` / `RoleRegistry` / `BUILTIN_ROLES` / `createConstraintProfile` / `TeamConfig` / `WorkflowConfig` 全部从 `@/modules/ai-harness/facade`。

### ⑤ verify

`npm run type-check` + `npm run verify:arch`。

---

## 配方 3：新增 Skill（code-based）

参考实现：`backend/src/modules/ai-app/office/slides/skills/content-compression.skill.ts`（Skill 类）

- `backend/src/modules/ai-app/office/slides/skills/slides-skills.module.ts`（批量注册，见 `onModuleInit`）

### ① 必改/新建文件

1. 新建 `ai-app/<module>/skills/<name>.skill.ts` —— `implements ISkill<I, O>`。
2. 改对应 skills module —— 加进 providers + 在 `onModuleInit` 调 `skillRegistry.register(skill)`。

### ② Hello-world 样板（`implements ISkill`）

```typescript
import { Injectable, Optional } from "@nestjs/common";
import {
  ISkill,
  SkillContext,
  SkillResult,
  SkillLayer,
  SKILL_LAYERS,
  ChatFacade,
  ChatMessage,
} from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";

@Injectable()
export class MySkill implements ISkill<{ text: string }, { summary: string }> {
  readonly id = "my-skill";
  readonly name = "我的技能";
  readonly description = "一句话说明";
  readonly layer: SkillLayer = SKILL_LAYERS.CONTENT;
  readonly domain = "my-domain";
  readonly tags = ["tag"];
  readonly version = "1.0.0";

  constructor(@Optional() private readonly chatFacade: ChatFacade) {}

  async execute(
    input: { text: string },
    context: SkillContext,
  ): Promise<SkillResult<{ summary: string }>> {
    const startTime = new Date();
    try {
      const messages: ChatMessage[] = [{ role: "user", content: input.text }];
      const res = await this.chatFacade.chat({
        messages,
        modelType: AIModelType.CHAT,
        taskProfile: { creativity: "low", outputLength: "short" },
      });
      return {
        success: true,
        data: { summary: res.content ?? "" },
        metadata: {
          executionId: context.executionId,
          startTime,
          endTime: new Date(),
          duration: Date.now() - startTime.getTime(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: "MY_SKILL_FAILED",
          message: error instanceof Error ? error.message : String(error),
        },
        metadata: {
          executionId: context.executionId,
          startTime,
          endTime: new Date(),
          duration: Date.now() - startTime.getTime(),
        },
      };
    }
  }
}
```

### ③ 注册位置（在 skills module 的 `onModuleInit`）

```typescript
import { SkillRegistry } from "@/modules/ai-harness/facade";

export class MySkillsModule implements OnModuleInit {
  constructor(
    private readonly skillRegistry: SkillRegistry,
    private readonly mySkill: MySkill,
  ) {}
  onModuleInit() {
    this.skillRegistry.register(this.mySkill);
  }
}
```

> 纯 prompt 技能（无 DI）走 SKILL.md + `PromptSkillBridge.registerDomain("<domain>")` 自动注册；
> 只有需要注入依赖（如 ChatFacade）的 code-based 技能才手动 `skillRegistry.register`。

### ④ 导入来源

`ISkill` / `SkillContext` / `SkillResult` / `SkillLayer` / `SKILL_LAYERS` / `ChatFacade` / `ChatMessage` / `SkillRegistry` 全部从 `@/modules/ai-harness/facade`。`AIModelType` 从 `@prisma/client`。

### ⑤ verify

`npm run type-check` + `npm run verify:arch`。

---

## 配方 4：新增 Tool

参考实现：`backend/src/modules/ai-engine/tools/categories/information/jobs/job-search.tool.ts`（Tool 类）

- `backend/src/modules/ai-engine/tools/tools.provider.ts`（`ALL_TOOL_CLASSES` 批量注册）

> Tool 是 AI Engine 层能力（不感知 agent/mission）。注册是**自动**的：把类加进 `ALL_TOOL_CLASSES`，
> `AiEngineModule` 在 `onModuleInit` 遍历 `ALL_TOOLS_TOKEN` 注入的实例逐个 `toolRegistry.register(tool)`。
> 不需要自己写 register 调用。

### ① 必改/新建文件

1. 新建 `ai-engine/tools/categories/<category>/<name>.tool.ts` —— `extends BaseTool<I, O>`。
2. 在该 category 的 `index.ts` 导出。
3. 改 `ai-engine/tools/tools.provider.ts` —— import + 加进 `ALL_TOOL_CLASSES` 数组 + 在 `TOOL_ID_CLASS_MAP` 加 `"my-tool": MyTool`。

### ② Hello-world 样板（`extends BaseTool`，engine 内部相对导入）

```typescript
import { Injectable, Logger } from "@nestjs/common";
import { BaseTool } from "../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../abstractions/tool.interface";

export interface MyToolInput {
  query: string;
}
export interface MyToolOutput {
  success: boolean;
  result?: string;
  error?: string;
}

@Injectable()
export class MyTool extends BaseTool<MyToolInput, MyToolOutput> {
  private readonly logger = new Logger(MyTool.name);
  readonly id = "my-tool";
  readonly sideEffect = "none" as const;
  readonly name = "My Tool";
  readonly description = "一句话说明工具能力（LLM 选工具时读这段）";
  readonly category: ToolCategory = "information";
  readonly tags = ["tag"];
  readonly defaultTimeout = 20000;
  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  };
  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: { success: { type: "boolean" }, result: { type: "string" } },
  };

  protected async doExecute(
    input: MyToolInput,
    _context: ToolContext,
  ): Promise<MyToolOutput> {
    try {
      return { success: true, result: `echo: ${input.query}` };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
```

### ③ 注册位置（在 `tools.provider.ts`，非 onModuleInit）

```typescript
// 1) import
import { MyTool } from "./categories/information/my/my.tool";
// 2) 加进数组
export const ALL_TOOL_CLASSES: Type<ITool>[] = [/* ...existing..., */ MyTool];
// 3) 加进 id→class 映射
export const TOOL_ID_CLASS_MAP: Record<string, Type<ITool>> = {
  /* ... */ "my-tool": MyTool,
};
```

> 实际 `toolRegistry.register(tool)` 发生在 `ai-engine/ai-engine.module.ts`（注入 `ALL_TOOLS_TOKEN` 后遍历），
> 你无需改 module —— 把类加进 provider 数组即被自动发现。

### ④ 导入来源

Tool 文件用**相对路径**导入 engine 内部基元（`BaseTool` / `ToolContext` / `JSONSchema` / `ToolCategory`）——
这是 engine 层内部代码，不走 facade。**只有 ai-app 层消费 tool 时才从 facade 拿 `BUILTIN_TOOLS` / `ToolRegistry`。**

### ⑤ verify

`npm run type-check` + `npm run verify:arch`（确认 engine 没反向依赖 harness）+ `npm run test:quick`。

---

## 配方 5：新增 Mission-Stage（agent-playground pipeline）

参考实现：

- Stage 函数：`backend/src/modules/ai-app/playground/mission/pipeline/stages/s1-mission-estimate-budget.stage.ts`
- Pipeline 声明：`backend/src/modules/ai-app/playground/runtime/playground.config.ts`（`PLAYGROUND_PIPELINE.steps`）
- Stage 挂载：`backend/src/modules/ai-app/playground/mission/pipeline/playground-business-orchestrator.service.ts`（`buildHooksForStep` + `build<SN>Hooks`）

> Stage 不是直接注册到 Registry —— `PlaygroundPipelineDispatcher.onModuleInit` 把整条
> `PLAYGROUND_PIPELINE`（含每 step 的 hooks）`registry.register(...)` 到 `MissionPipelineRegistry`。
> 新增一个 stage = ①写 stage 函数 ②在 `playground.config.ts` 的 pipeline.steps 声明 step ③在 orchestrator 加 hook builder 分支。

### ① 必改/新建文件

1. 新建 `backend/src/modules/ai-app/playground/mission/pipeline/stages/sN-<desc>.stage.ts` —— 导出 `runXxxStage(ctx, deps, ...)` 纯函数。
2. 改 `backend/src/modules/ai-app/playground/runtime/playground.config.ts` —— 在 `PLAYGROUND_PIPELINE.steps` 加一个 step（含 `primitive` / `id` / `dag`）。
3. 改 `backend/src/modules/ai-app/playground/mission/pipeline/playground-business-orchestrator.service.ts` ——
   在 `buildHooksForStep` 加 `if (stepId === "sN-xxx") return this.buildSNHooks();` + 实现 `buildSNHooks()`，
   并在 `STAGE_NUMBER` 加序号。

### ② Hello-world 样板（stage 函数，与真实 S1 同结构）

```typescript
import type { MissionInvariants } from "../../context/mission-context";
import type { CommonDeps } from "../../context/mission-deps";
import { narrate } from "../../artifacts/narrative.util";

export async function runMyStage(
  ctx: MissionInvariants,
  deps: CommonDeps,
): Promise<void> {
  const { missionId, userId, input } = ctx;
  await narrate(deps.emit, missionId, userId, {
    stage: "sN-my-stage",
    role: "mission",
    tag: "info",
    text: `My stage 处理主题「${input.topic}」`,
  });
  // ...真实工作（调 deps 上的 service / billing / pool）...
}
```

### ③ 注册位置（两处都在 orchestrator）

```typescript
// playground-business-orchestrator.service.ts
import { runMyStage } from "./stages/sN-my-stage.stage";

buildHooksForStep(stepId: string, _primitive: string): ResolvedStageHooks {
  if (stepId === "sN-my-stage") return this.buildMyStageHooks();
  // ...其它分支...
}

private buildMyStageHooks(): ResolvedStageHooks {
  const hooks = {
    persist: async (args: { ctx: StageRunArgs["ctx"] }): Promise<void> => {
      const entry = this.getEntry(args.ctx.missionId);
      const invariants = this.buildStageInvariants(entry);
      await runMyStage(invariants, this.stageBindings.buildDeps());
    },
  };
  return hooks as unknown as ResolvedStageHooks;
}
```

> 注意：hook 的 key（`persist` / `runRole` / `fanOut` ...）由 step 的 `primitive` 决定 —— `persist` primitive
> 期望 `hooks.persist`，`plan` primitive 期望 `hooks.runRole` 等。照搬同 primitive 的既有 stage 的 hook 形状。

### ④ 导入来源

- Stage 函数：`MissionInvariants` / `CommonDeps` / `narrate` 走**相对路径**（同模块内部）。
- Pipeline 声明：`defineMissionPipeline` / `MissionPipelineConfig` 从 `@/modules/ai-harness/facade`。
- Orchestrator：`ResolvedStageHooks` / `StageRunArgs` 从 `@/modules/ai-harness/facade`。

### ⑤ verify

`npm run type-check` + `npm run test:quick`（playground pipeline 有 spec 校验 step↔hook 一一对应；
`buildHooksForStep` 对未声明的 step 会 throw，漏挂 hook 即启动失败）。

---

## 参考实现索引（已 Read 核对）

| 配方          | 参考文件（绝对路径）                                                                                                                                                                      |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent         | `backend/src/modules/ai-app/insight/agents/topic-insights.agent.ts`                                                                                                                       |
| Agent 注册    | `backend/src/modules/ai-app/insight/topic-insights.module.ts`（`onModuleInit`: `agentRegistry.register`）                                                                                 |
| Team 配置     | `backend/src/modules/ai-app/insight/teams/topic-insights-team.config.ts`                                                                                                                  |
| Team 注册     | `backend/src/modules/ai-app/insight/topic-insights.module.ts`（`onModuleInit`: `teamRegistry.registerConfig`）                                                                            |
| Skill         | `backend/src/modules/ai-app/office/slides/skills/content-compression.skill.ts`                                                                                                            |
| Skill 注册    | `backend/src/modules/ai-app/office/slides/skills/slides-skills.module.ts`（`onModuleInit`: `skillRegistry.register`）                                                                     |
| Tool          | `backend/src/modules/ai-engine/tools/categories/information/jobs/job-search.tool.ts`                                                                                                      |
| Tool 注册     | `backend/src/modules/ai-engine/tools/tools.provider.ts`（`ALL_TOOL_CLASSES`）+ `backend/src/modules/ai-engine/ai-engine.module.ts`（遍历 `ALL_TOOLS_TOKEN` 调 `toolRegistry.register`）   |
| Mission-Stage | `backend/src/modules/ai-app/playground/mission/pipeline/stages/s1-mission-estimate-budget.stage.ts`                                                                                       |
| Pipeline 声明 | `backend/src/modules/ai-app/playground/runtime/playground.config.ts`（`PLAYGROUND_PIPELINE`）                                                                                             |
| Stage 挂载    | `backend/src/modules/ai-app/playground/mission/pipeline/playground-business-orchestrator.service.ts`（`buildHooksForStep`）+ `.../pipeline/playground.pipeline.ts`（`registry.register`） |

---

**最后更新**: 2026-05-30
**维护者**: Claude Code
