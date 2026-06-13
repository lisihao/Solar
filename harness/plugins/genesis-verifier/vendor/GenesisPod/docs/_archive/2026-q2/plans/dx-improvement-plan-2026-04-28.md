# Genesis 开发者体验（DX）改进详细方案

> **创建日期**: 2026-04-28
> **基线 HEAD**: `ec0aa6a82`
> **状态**: 待评审
> **预计总工时**: 14 周（3 全职工程师）/ 26 周（1 全职工程师）

---

## 0. 摘要

Genesis 在 Agent 平台工程深度上达到 SOTA（85/100），但开发者体验（62/100）拖累整体竞争力。本方案分 **6 个 Sprint** 共 **12 项改进**，目标将单次 prompt 调优循环从 ~7 分钟降到 ~10 秒（42×），新 agent 上线从 ~2 小时降到 ~10 分钟（12×）。

**核心思路**：复用已有的 DX 资产（`@DefineAgent` decorator、`AgentRunner`、`FixtureStore`、`EventJournal`、`agent-playground` UI），**做产品化封装而非从零造轮子**。

---

## 1. 现状基线（验证后）

### 1.1 已有 DX 资产（在 `backend/src/modules/ai-harness/kernel/dx/`）

| 组件                         | 文件                      | 能力                                                                  |
| ---------------------------- | ------------------------- | --------------------------------------------------------------------- |
| `@DefineAgent` decorator     | `agent-spec.base.ts`      | 元数据声明（tools / skills / budget / inputSchema / outputSchema）    |
| `AgentSpec` 抽象基类         | 同上                      | `buildSystemPrompt()` / `validateBusinessRules()` / `stubFn()` 钩子   |
| `AgentRunner`                | `agent-runner.service.ts` | `run()` 一次性、`stream()` 流式；自动读 spec 元数据 + 装配 IAgentSpec |
| `FixtureStore`               | `fixture-store.ts`        | record/replay 事件流，文件级持久化（`version: 1` JSON 格式）          |
| `zod-schema-prompt`          | `zod-schema-prompt.ts`    | 把 zod schema 转成 LLM 可读的输出格式描述                             |
| `HarnessInspectorController` | `open-api/admin/`         | 运行时 introspect API（已存在）                                       |

### 1.2 已有可视化资产（在 `frontend/components/agent-playground/`）

```
AgentLiveGrid          MissionFlowView         PipelineTimeline
RawEventLog            MissionTodoBoard        TodoDetailDrawer
LeadJournalPanel       MemoryIndexPanel        VerifyConsensusPanel
ReportPanel            ReferencesPanel         CostBreakdownPanel
ComputeUsagePanel      DimensionsPanel         CapabilityMeters
TeamRosterPanel        TeamMissionModal        LeaderChatModal
DemoLauncher
```

### 1.3 真正的差距（不是"无"，是"未产品化"）

| 差距               | 现象                                                                 |
| ------------------ | -------------------------------------------------------------------- |
| 缺 CLI 入口        | `AgentRunner.run()` 必须从 NestJS 容器拿，不能命令行直跑             |
| 缺脚手架生成器     | 新 agent 要手抄文件结构                                              |
| 缺测试 ergonomics  | 没有 `evalAgent().expectFact()` 风格 helper                          |
| 缺 prompt 版本管理 | PromptRegistry 只有运行时注册，无 version / diff / rollback          |
| 缺本地 dev server  | 改 spec 要重启整个 NestJS（含 100+ module）                          |
| 缺 replay UI       | EventJournal 数据已存，但 `PipelineTimeline` 没有"按步回放" scrubber |
| 缺 tool 类型宏     | 工具定义代码冗长，没有类型推导自动 wiring                            |
| 缺 SKILL.md lint   | SKILL.md 写错（缺字段、引用文件不存在）只能等运行时报错              |
| 缺自动文档         | `@DefineAgent` 元数据未生成 markdown                                 |
| 缺 Eval 标准       | EvalPipeline 自定义，跨 agent 不可比                                 |
| 缺 VS Code 集成    | agent 类无 codelens、tool 名无 hover                                 |
| 缺声明式编程       | 没有 DSPy 风格的 signature → auto-prompt                             |

---

## 2. 4 类开发者画像与痛点

| 角色                                                 | 占比 | 主要痛点                                | 本方案覆盖度 |
| ---------------------------------------------------- | ---- | --------------------------------------- | ------------ |
| **Agent Author**（写 ai-app 的人）                   | 50%  | 调 prompt 慢、测试难写、无热重载        | 90%          |
| **Tool/Skill Author**（写 MCP tool / SKILL.md 的人） | 25%  | 缺类型宏、SKILL 无 lint、不知是否被加载 | 80%          |
| **Platform Contributor**（改 harness/engine 的人）   | 15%  | app.module 难导航、依赖关系复杂         | 60%          |
| **External Integrator**（通过 MCP/A2A 用的人）       | 10%  | 缺文档站、SDK 不齐                      | 40%          |

---

## 3. 12 项改进 - 详细设计

### 3.1 (#1) Agent CLI 脚手架 ⭐⭐⭐⭐⭐

**目标体验**：

```bash
# 创建新 agent
$ npx genesis agent new my-researcher --template basic
✓ Created backend/src/modules/ai-app/my-researcher/
  ├── my-researcher.spec.ts          @DefineAgent class
  ├── prompts/system.md              system prompt template
  ├── tools/                         agent-specific tools (optional)
  ├── fixtures/                      replay snapshots
  └── my-researcher.spec.spec.ts     unit + eval tests

# 本地 dryrun（不起后端，只跑这一个 agent）
$ npx genesis agent run my-researcher --input '{"topic":"React 19"}'
[10:23:01] thinking: Let me search for...
[10:23:04] action: search_web({query: "React 19 release"})
[10:23:06] observation: Found 8 results...
[10:23:12] output: { answer: "React 19 was released...", citations: [...] }
✓ Completed in 11.2s, 4823 tokens, $0.0234

# 跑 fixtures（从 ./fixtures/*.json 回放）
$ npx genesis agent test my-researcher
✓ basic-question.json     [12 events, deterministic]
✓ multi-step-research.json [47 events, deterministic]
2 fixtures, 0 failed (replay mode, no LLM cost)

# Inspect spec（看元数据）
$ npx genesis agent inspect my-researcher
my-researcher
├── tools: [search_web, read_url, save_note]
├── skills: [factual-research, citation-format]
├── budget: { maxTokens: 16000, maxIterations: 10, maxCostUsd: 0.50 }
├── inputSchema:  { topic: string, depth?: 'quick'|'deep' }
└── outputSchema: { answer: string, citations: Array<{...}> }
```

#### 文件结构

```
backend/scripts/agent-cli/
├── index.ts                  # 入口，subcommand router
├── commands/
│   ├── new.ts                # 模板生成
│   ├── run.ts                # 直接执行
│   ├── test.ts               # 跑 fixtures
│   ├── inspect.ts            # 元数据查看
│   └── help.ts
├── templates/
│   ├── basic/                # @DefineAgent + system prompt
│   ├── react-loop/           # ReAct 循环模板
│   ├── plan-act/             # PlanAct 模板
│   └── leader-worker/        # 多 agent 协作模板
└── shared/
    ├── bootstrap-mini.ts     # 最小 NestJS 引导（仅 ai-harness + ai-engine）
    ├── load-spec.ts          # 动态 import + readDefineAgentMeta
    └── pretty-print.ts       # 事件流彩色输出
```

#### 关键实现

**`shared/bootstrap-mini.ts`** —— 最小化容器：

```typescript
import { NestFactory } from "@nestjs/core";
import { Module } from "@nestjs/common";
import { HarnessModule } from "../../src/modules/ai-harness/harness.module";
import { AiEngineModule } from "../../src/modules/ai-engine/ai-engine.module";
import { AiInfraModule } from "../../src/modules/ai-infra/ai-infra.module";

@Module({
  imports: [HarnessModule, AiEngineModule, AiInfraModule],
})
class CliModule {}

export async function bootstrapMini() {
  return NestFactory.createApplicationContext(CliModule, {
    logger: ["error", "warn"],
  });
}
```

**`commands/run.ts`** —— 跑一次：

```typescript
import { bootstrapMini } from "../shared/bootstrap-mini";
import { AgentRunner } from "@/modules/ai-harness/kernel/dx";
import { loadSpec } from "../shared/load-spec";
import { prettyPrintEvent } from "../shared/pretty-print";

export async function run(agentName: string, input: unknown) {
  const ctx = await bootstrapMini();
  const runner = ctx.get(AgentRunner);
  const Spec = await loadSpec(agentName);

  for await (const ev of runner.stream(Spec, input)) {
    prettyPrintEvent(ev);
  }

  await ctx.close();
}
```

**`package.json`** 加：

```json
{
  "scripts": {
    "agent": "tsx backend/scripts/agent-cli/index.ts"
  },
  "bin": {
    "genesis": "./backend/scripts/agent-cli/index.ts"
  }
}
```

#### 实施步骤

1. 写 `bootstrap-mini.ts` —— 关键依赖：app.module 不能整体加载，必须 ai-harness + ai-engine + ai-infra 三层独立 ✅ 这与改进 #6 共享前置工作
2. 写 `commands/inspect.ts` 最简（只读元数据，不真跑）—— 验证 readDefineAgentMeta 在容器外能用
3. 写 `commands/run.ts` —— 跑一个简单 agent 验证 mini bootstrap 能跑通
4. 写 `commands/test.ts` —— 接 FixtureStore.replay()
5. 写 `commands/new.ts` —— 拷贝模板 + 替换占位符
6. 加 npm bin + 写 README
7. 补 5 个 jest spec（覆盖每个 subcommand）

#### 工作量

- 单人 5-7 天
- 依赖：HarnessModule、AiEngineModule 能独立 bootstrap（部分 service 可能依赖 PrismaService → 需要 mock 或本地 PG）

#### 验收标准

- [ ] `npx genesis agent new foo` 创建文件无 typecheck 错
- [ ] `npx genesis agent run foo --input '{}'` 30s 内出结果
- [ ] `npx genesis agent test foo` 不消耗 LLM token
- [ ] `npx genesis agent inspect foo` 完整列出元数据
- [ ] 5 个 jest spec 通过

---

### 3.2 (#2) Eval-as-Test 助手 ⭐⭐⭐⭐⭐

**目标体验**：

```typescript
// backend/src/modules/ai-app/research/__tests__/researcher.eval.spec.ts
import { evalAgent } from "@/modules/ai-harness/kernel/dx/eval";
import { ResearcherSpec } from "../researcher.spec";

describe("Researcher Agent - Eval", () => {
  it("answers factually with citations", async () => {
    await evalAgent(ResearcherSpec)
      .withInput({ topic: "React 19 features", depth: "quick" })
      .expectFact("React 19 was released in")
      .expectCitation(/react\.dev/)
      .expectOutputSchema() // 自动用 spec 的 outputSchema
      .expectCost({ maxTokens: 8000, maxUsd: 0.05 })
      .expectLatency({ p95Ms: 60_000 })
      .expectIterations({ max: 5 })
      .run();
  });

  it("handles unknown topic gracefully", async () => {
    await evalAgent(ResearcherSpec)
      .withInput({ topic: "XYZ-fake-2099-thing" })
      .expectExitReason("completed")
      .expectMatch(/no information|cannot find/)
      .run();
  });

  it("passes Ragas faithfulness threshold", async () => {
    await evalAgent(ResearcherSpec)
      .withDataset("./eval-dataset.jsonl") // 30 个 input/expected 对
      .expectRagas({
        faithfulness: { min: 0.85 },
        answerRelevancy: { min: 0.8 },
        contextPrecision: { min: 0.75 },
      })
      .run();
  });
});
```

#### 文件结构

```
backend/src/modules/ai-harness/kernel/dx/eval/
├── index.ts
├── eval-agent.ts            # 主 fluent API
├── matchers/
│   ├── fact.matcher.ts      # expectFact(string)
│   ├── citation.matcher.ts  # expectCitation(regex)
│   ├── schema.matcher.ts    # expectOutputSchema()
│   ├── cost.matcher.ts      # expectCost({maxTokens, maxUsd})
│   ├── latency.matcher.ts   # expectLatency({p95Ms})
│   ├── exit-reason.matcher.ts
│   └── ragas.matcher.ts     # 接 Ragas（依赖 #12）
├── runner/
│   ├── single-run.ts        # 跑一次 + 收集 metrics
│   └── dataset-run.ts       # 批量跑 + 聚合
└── reporters/
    ├── jest-reporter.ts     # 输出符合 jest 风格
    └── junit-reporter.ts    # CI 友好
```

#### 关键实现

**`eval-agent.ts`** 主 API：

```typescript
export class EvalBuilder<TSpec extends typeof AgentSpec> {
  private input?: unknown;
  private dataset?: string;
  private expectations: Expectation[] = [];

  constructor(private Spec: TSpec) {}

  withInput(input: unknown): this {
    this.input = input;
    return this;
  }

  withDataset(path: string): this {
    this.dataset = path;
    return this;
  }

  expectFact(text: string): this {
    this.expectations.push(new FactMatcher(text));
    return this;
  }

  expectCost(cost: { maxTokens?: number; maxUsd?: number }): this {
    this.expectations.push(new CostMatcher(cost));
    return this;
  }

  // ... 其他 expect*

  async run(): Promise<EvalResult> {
    const ctx = await getOrCreateContext();
    const runner = ctx.get(AgentRunner);

    if (this.dataset) {
      return runDataset(this.Spec, this.dataset, this.expectations, runner);
    } else {
      return runSingle(this.Spec, this.input, this.expectations, runner);
    }
  }
}

export function evalAgent<T extends typeof AgentSpec>(Spec: T): EvalBuilder<T> {
  return new EvalBuilder(Spec);
}
```

**`matchers/fact.matcher.ts`** —— 用 JudgeService 实现：

```typescript
export class FactMatcher implements Expectation {
  constructor(private fact: string) {}

  async check(result: RunResult, ctx: Context): Promise<MatcherResult> {
    const judge = ctx.get(JudgeService);
    const verdict = await judge.verifyFact({
      claim: this.fact,
      output: result.output,
      strictness: "medium",
    });
    return {
      passed: verdict.confidence > 0.7,
      message: verdict.reasoning,
      details: { confidence: verdict.confidence },
    };
  }
}
```

#### 与现有 jest 集成

不需要改 jest config，eval 助手直接 throw 标准 jest assertion error。CI 跑 `npm test` 即可。

#### 实施步骤

1. 写 `EvalBuilder` 主 API（fluent chain）
2. 实现 6 个 matcher（fact / citation / schema / cost / latency / exit-reason）
3. 写 `single-run.ts`（包装 AgentRunner）
4. 写 `dataset-run.ts`（按 jsonl 批量跑 + 并发控制）
5. 接 JudgeService（已存在 SelfJudge / ExternalJudge / MetaJudge）
6. 写 jest reporter（彩色 + 失败 detail）
7. 写 5 个示例 spec（覆盖现有 ai-app 的 1-2 个 agent）

#### 工作量

- 单人 5-6 天
- 依赖：JudgeService（已存在）；FixtureStore（已存在）；BudgetAccountant（已存在）

#### 验收标准

- [ ] `evalAgent(Spec).withInput().expectFact().run()` 完整工作流通
- [ ] 6 个 matcher 各有 1 个 spec
- [ ] 提供 `expectMode: 'replay'` 选项不消耗真实 token
- [ ] 与现有 backend `npm test` 集成无 break

---

### 3.3 (#3) AgentSpec 自动文档生成 ⭐⭐⭐⭐

**目标产出**：每个 agent 自动有 `docs/agents/<name>.md`

```markdown
# Researcher Agent

> Auto-generated from `@DefineAgent` metadata. Do not edit.

## Overview

- **Class**: `ResearcherSpec` at `backend/src/modules/ai-app/research/researcher.spec.ts`
- **Loop**: react
- **Layer**: L3 (ai-app)

## Capabilities

### Tools

- `search_web` — Search public web with citation snippets
- `read_url` — Fetch and parse a URL into markdown
- `save_note` — Persist a note to user library

### Skills

- `factual-research` — Cross-check claims against multiple sources
- `citation-format` — Output IEEE-style citations

## Budget

|                | Value |
| -------------- | ----- |
| Max tokens     | 16000 |
| Max iterations | 10    |
| Max cost (USD) | 0.50  |

## I/O Schema

### Input

\`\`\`typescript
{ topic: string, depth?: 'quick' | 'deep' }
\`\`\`

### Output

\`\`\`typescript
{
answer: string,
citations: Array<{ url: string, title: string, snippet: string }>
}
\`\`\`

## Test Coverage

- Fixtures: 3 (basic-question, multi-step, edge-unknown)
- Eval datasets: 1 (`eval-dataset.jsonl`, 30 cases)
- Last Ragas score: faithfulness=0.91, relevancy=0.87
```

#### 实施

```
backend/scripts/agent-cli/commands/docs.ts
└── 命令：npx genesis docs gen
    1. 扫描 backend/src/modules/ai-app/**/*.spec.ts
    2. 对每个 @DefineAgent 类，readDefineAgentMeta()
    3. 解析 zod schema → typescript 类型字符串
    4. 检查 fixtures/ 目录、eval-dataset.jsonl
    5. 渲染 markdown 模板 → docs/agents/<name>.md
```

#### 集成 CI

`.github/workflows/agent-docs.yml`:

```yaml
on: pull_request
jobs:
  agent-docs-diff:
    steps:
      - run: npx genesis docs gen
      - run: |
          if [ -n "$(git diff --name-only docs/agents/)" ]; then
            echo "::error::Agent contracts changed but docs not regenerated. Run 'npx genesis docs gen'"
            git diff docs/agents/
            exit 1
          fi
```

#### 工作量

单人 1-2 天

#### 验收

- [ ] 已有 17 个 ai-app 全部生成文档
- [ ] CI 在 contract 变更时阻止 PR

---

### 3.4 (#4) Prompt 版本管理（轻量版）⭐⭐⭐⭐

**问题**：当前 PromptRegistry 是运行时注册（在代码里 `register('foo', '...')`），改 prompt 需要改代码 + 部署 + 全量影响所有用户。无 A/B、无 rollback。

**目标**：

```typescript
// 旧（保留 backwards-compat）
this.promptRegistry.register('researcher-system', 'You are...');

// 新方式 1：从文件加载（按 version）
this.promptRegistry.loadFromFile('researcher-system', {
  versions: {
    v1: 'prompts/researcher-system.v1.md',
    v2: 'prompts/researcher-system.v2.md',
  },
  default: 'v2',
});

// 新方式 2：用户/mission 级 override
const prompt = this.promptRegistry.get('researcher-system', {
  version: ctx.experimentVariant ?? 'v2',  // A/B
});

// CLI: 比较两个版本
$ npx genesis prompt diff researcher-system v1 v2
```

#### 文件结构

```
backend/src/modules/ai-engine/llm/prompts/
├── prompt-registry.service.ts        # 改造：加 version 字段
├── prompt-template.service.ts        # 不变
├── prompt-loader.service.ts          # 新增：从文件系统加载
├── prompt-version.types.ts           # 新增：PromptVersion / PromptDescriptor
└── prompts.module.ts

backend/src/modules/ai-app/<app>/prompts/
├── researcher-system.v1.md           # frontmatter: { version, author, date }
├── researcher-system.v2.md
└── ...
```

#### Prompt 文件格式

```markdown
---
id: researcher-system
version: v2
author: jason@team
created: 2026-04-28
description: |
  Adds explicit citation format requirement after observing
  inconsistent output in mission #1234.
parent: v1
---

You are a careful researcher. When answering:

1. Always cite sources using IEEE format [1], [2]
2. ...
```

#### 关键 API

```typescript
// prompt-loader.service.ts
@Injectable()
export class PromptLoaderService {
  /** 启动时扫描 prompts/ 目录 + 注册到 registry */
  async loadAll(rootDir: string): Promise<void> {
    const files = await glob("**/*.v*.md", { cwd: rootDir });
    for (const file of files) {
      const { id, version, body } = await this.parseFile(file);
      this.registry.registerVersion(id, version, body);
    }
  }
}

// prompt-registry.service.ts (改造)
@Injectable()
export class PromptRegistry {
  private prompts = new Map<string, Map<string, string>>();
  // ↑ id → (version → body)

  registerVersion(id: string, version: string, body: string): void {
    /* ... */
  }

  get(id: string, opts?: { version?: string }): string {
    const versions = this.prompts.get(id);
    if (!versions) throw new Error(`Prompt ${id} not found`);
    const version = opts?.version ?? this.getDefault(id);
    const body = versions.get(version);
    if (!body) throw new Error(`Prompt ${id}@${version} not found`);
    return body;
  }
}
```

#### CLI 命令

```bash
# 列出所有 prompt 及版本
$ npx genesis prompt list

# 看一个 prompt 当前内容
$ npx genesis prompt show researcher-system --version v2

# diff 两个版本
$ npx genesis prompt diff researcher-system v1 v2

# 创建新版本（拷贝当前 default + 加 frontmatter）
$ npx genesis prompt new researcher-system --from v2 --bump v3

# 验证（检查所有引用 prompt 的代码 + 文件存在性）
$ npx genesis prompt validate
```

#### A/B 路由（可选 Tier 2）

留出 hook：`PromptRegistry.get(id, { userId, ctx })` → 通过外部 service（GrowthBook / 内部 feature flag）决定 version。本方案 V1 不实现，预留接口。

#### 实施步骤

1. 改 `PromptRegistry` 加 version map（保留无 version 的旧 API 兼容）
2. 写 `PromptLoaderService` + parse frontmatter（用 `gray-matter`）
3. 启动时 hook 自动扫描 `prompts/` 目录
4. CLI 4 个命令
5. 把 ai-app 现有的 prompt（散在代码里的）逐步迁移到 `.md` 文件（**不强求一次完成**）

#### 工作量

- 核心 3 天
- prompt 迁移视代码量另算（17 个 ai-app 大概 1-2 天）

#### 验收

- [ ] 注册一个 prompt 用版本 v1/v2/v3
- [ ] `prompt diff` 输出 unified diff
- [ ] `prompt validate` 检测出引用了不存在的 prompt
- [ ] 现有调 `registry.get('foo')`（无 version）的代码无 break

---

### 3.5 (#5) Mission Replay UI ⭐⭐⭐⭐⭐

**已有数据源**：`protocol/journal/event-journal.service.ts` 持久化所有事件
**前端已有**：`PipelineTimeline.tsx`、`RawEventLog.tsx`
**缺**：步骤 scrubber + 时间轴 + "回到第 N 步看当时状态"

**目标体验**：

```
┌─────────────────────────────────────────────────────────────┐
│ Mission #abc123 — Replay Mode                              │
├─────────────────────────────────────────────────────────────┤
│ ◀ ▶  Step 23 / 89   [────●──────────]  T+47.2s            │
│      Speed: 1×  10×  Pause                                  │
├─────────────────────────────────────────────────────────────┤
│ Pipeline Timeline (highlighted current step)               │
│ ┌─Stage S3 Researcher─┐ ┌─Stage S4 Leader─┐                │
│ │ ●●●●●●●●●○○○○       │ │ ────             │                │
│ └─────────────────────┘ └──────────────────┘                │
├─────────────────────────────────────────────────────────────┤
│ State at step 23:                                          │
│ ├── Active agent: researcher-3                             │
│ ├── Memory: {...}                                          │
│ ├── Current todos: [3 in-progress, 5 pending]              │
│ ├── Cost so far: $0.124 / $0.50                            │
│ └── Last event: tool_call(search_web, query="...")         │
└─────────────────────────────────────────────────────────────┘
```

#### 后端 API（已部分存在）

```
GET  /api/v1/agent-playground/replay/:missionId
       ?step=N         // 已有 ?since=ts
       &include=state  // 新增：返回到该步的累积状态快照
```

修改 `AgentPlaygroundController.replay()`：

```typescript
@Get('replay/:missionId')
async replay(
  @Param('missionId') id: string,
  @Query('step') step?: number,
  @Query('include') include?: 'state' | 'events',
) {
  if (step !== undefined && include === 'state') {
    return this.eventJournal.replayUpTo(id, step);
    // ↑ 重放事件流到第 step 步，返回 { events, finalState, metrics }
  }
  // ... 现有逻辑
}
```

#### 前端组件

```
frontend/components/agent-playground/replay/
├── ReplayProvider.tsx          # context: currentStep / totalSteps / playing / speed
├── ReplayScrubber.tsx          # 进度条 + step 计数 + 速度选择
├── ReplayPlaybackControls.tsx  # ◀ ▶ pause
├── StateSnapshotPanel.tsx      # 显示 state-at-step（agent / memory / todos / cost）
└── useReplayState.ts           # hook，按 step 拉 ?step=N&include=state
```

#### 关键交互

1. URL `?replay=true&step=23` → 进入 replay 模式
2. 拖动 scrubber → debounce 300ms → 拉 `?step=N&include=state`
3. 现有 `PipelineTimeline.tsx` 接受 `currentStep` prop，高亮当前节点
4. 现有 `RawEventLog.tsx` 接受 `untilStep` prop，截断显示
5. 新 `StateSnapshotPanel` 显示该步状态

#### 实施步骤

1. 后端 `EventJournal.replayUpTo(missionId, step)` 实现（事件流 fold 到状态）
2. Controller `?step=N&include=state` 路由
3. 前端 `ReplayProvider` + scrubber UI
4. 改造 `PipelineTimeline`、`RawEventLog`、`MemoryIndexPanel` 接受"截断到第 N 步"
5. 补 5 个集成测试

#### 工作量

- 后端 3 天
- 前端 4-5 天（含组件改造）
- 总计 ~1.5 周

#### 验收

- [ ] 任意 mission 进 replay 模式后，scrubber 能定位到任意 step
- [ ] 拉 state 响应 < 500ms（10000 步以内）
- [ ] 现有 live mode 不受影响
- [ ] PipelineTimeline / RawEventLog / MemoryIndexPanel 三处都能 reflect step 变化

---

### 3.6 (#6) Local Hot-Reload Dev Server ⭐⭐⭐⭐

**痛点**：当前改一个 spec 文件需要重启整个 NestJS（300+ provider，~10s 冷启动），mvr-feedback 循环太慢。

**目标**：

```bash
$ npx genesis dev my-researcher
ℹ Starting Genesis dev server (mini)...
✓ Loaded HarnessModule, AiEngineModule (skipped: ai-app/*, open-api/*)
✓ Watching: backend/src/modules/ai-app/my-researcher/**
✓ Dev UI ready at http://localhost:5173/dev/my-researcher

> [Inspector] {} ↓ Type input + Enter to run
> [Inspector] { "topic": "X" }
[10:23:01] thinking: ...
[10:23:04] action: ...
✓ Done in 11.2s

# 改 my-researcher.spec.ts → 自动 hot reload，不退出 server
[FILE_CHANGE] my-researcher.spec.ts → reloading spec...
✓ Reloaded in 230ms
```

#### 关键技术决策

**A. 用 `tsx watch` + Nest `createApplicationContext`**（推荐）

- 利用 esbuild 的 watch + tsx 的 ESM hook
- Nest standalone context 启动比完整 app 快 ~5x
- spec 文件用 dynamic import + `delete require.cache` 强制重载

**B. 用 nodemon + 进程重启**（保底方案）

- 简单但每次重启 ~10s

#### 文件结构

```
backend/scripts/agent-cli/commands/dev.ts
backend/scripts/agent-cli/dev-ui/
├── server.ts                # 起 mini-NestJS + Express UI
├── public/
│   ├── index.html
│   ├── app.tsx              # React inspector UI
│   └── style.css
└── api/
    ├── run.ts               # POST /api/run { spec, input }
    ├── inspect.ts           # GET  /api/inspect/:spec
    └── reload.ts            # POST /api/reload { spec }
```

#### 关键依赖：app.module 拆分

**前置**：app.module.ts 当前 296 行 + 93 import 混着所有层。dev server 只能加载 ai-harness + ai-engine + ai-infra，**必须先做 app.module 拆分**（与架构审计 Tier 2 #5 重叠）。

拆分目标：

```typescript
// backend/src/modules/harness-only.module.ts (新增)
@Module({
  imports: [
    HarnessModule,
    AiEngineModule,
    AiInfraModule,
    PrismaModule,
    EventEmitterModule.forRoot(),
  ],
})
export class HarnessOnlyModule {}

// backend/src/app.module.ts (改造)
@Module({
  imports: [
    HarnessOnlyModule, // ← 子模块化
    AiAppModule,
    OpenApiModule,
    // 原本散在外面的全 import
  ],
})
export class AppModule {}
```

dev server 只 import HarnessOnlyModule。

#### 实施步骤

1. **先决条件**：拆 app.module.ts → HarnessOnlyModule + AiAppModule + OpenApiModule（独立 PR）
2. 写 `dev-ui/server.ts` — Express + 静态 React
3. 实现 `/api/inspect/:spec` 用 readDefineAgentMeta
4. 实现 `/api/run` SSE 流回事件
5. 实现 `/api/reload` 删除 require cache + 重新 import
6. tsx watch 监听 spec 文件 → 触发 reload
7. 简单的 React inspector UI（输入 JSON + 看流式事件）

#### 工作量

- app.module 拆分：2 天
- mini-server + UI：5-6 天
- hot reload 机制：3 天
- 总计 **~2 周**

#### 验收

- [ ] `npx genesis dev <agent>` 5s 内启动
- [ ] 改 spec 文件后 < 500ms 重载
- [ ] 浏览器 inspector 能跑 + 看流式事件
- [ ] 不影响生产 `npm run dev`

#### 风险

- Nest 的 dynamic provider 机制不友好于 hot-reload（service 实例缓存）
- 备选方案：每次 reload 重建整个 ApplicationContext（~2s，仍快于全量 ~10s）

---

### 3.7 (#7) Tool 定义类型宏 ⭐⭐⭐⭐

**当前**：tool 定义需要分散在多处（types/registry/handler）

**目标**：

```typescript
// backend/src/modules/ai-app/research/tools/search-web.tool.ts
import { defineTool } from '@/modules/ai-harness/kernel/tools';
import { z } from 'zod';

export const searchWeb = defineTool({
  name: 'search_web',
  description: 'Search the public web for factual information',
  category: 'search',

  input: z.object({
    query: z.string().min(1).max(200),
    maxResults: z.number().int().min(1).max(20).default(5),
  }),

  output: z.object({
    results: z.array(z.object({
      title: z.string(),
      url: z.string().url(),
      snippet: z.string(),
    })),
  }),

  // 工具元信息（自动写到 MCP schema）
  metadata: {
    cost: { perCall: 0.001 },
    rateLimit: { perMinute: 60 },
    timeout: 10_000,
  },

  async execute({ query, maxResults }, ctx) {
    // 完全类型安全 — query: string, maxResults: number
    // ctx: { userId, missionId, logger, abortSignal }
    const results = await ctx.fetch(...);
    return { results };  // ← 返回类型由 output schema 推导
  },
});
```

#### 自动产物

1. **类型安全**：`execute` 入参/出参由 zod 自动推导
2. **自动注册**：导入即注册到 ToolRegistry（NestJS DI 风格 + 装饰器）
3. **MCP schema**：自动转 JSON Schema 暴露给 MCP server
4. **LLM prompt 描述**：自动用 `zod-schema-prompt` 转人类可读
5. **限流/超时**：metadata 自动接到 RateLimiter / ToolCircuitBreaker
6. **测试 mock**：`mockTool(searchWeb, () => ({ results: [...] }))`

#### 文件结构

```
backend/src/modules/ai-harness/kernel/tools/
├── define-tool.ts            # 主 API
├── tool-context.types.ts     # ToolExecutionContext
├── mock-tool.ts              # 测试用 mock helper
└── __tests__/
```

#### 关键实现

```typescript
export interface DefineToolOptions<I, O> {
  name: string;
  description: string;
  category?: string;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  metadata?: ToolMetadata;
  execute: (input: I, ctx: ToolExecutionContext) => Promise<O>;
}

export function defineTool<I, O>(opts: DefineToolOptions<I, O>): Tool<I, O> {
  // 1. 自动 ToolRegistry.register（在模块加载时）
  // 2. 包装 execute 加 timeout / rate-limit / error-classification
  // 3. 暴露 .toMcpSchema() / .toLlmPrompt() 工具方法
  return new Tool(opts);
}
```

#### 工作量

- 单人 4 天
- 包括：实现 + 迁移 5 个现有 tool 验证 + 测试

#### 验收

- [ ] `defineTool({...})` 类型推导无 any
- [ ] 自动注册到 ToolRegistry（启动后 `inspect` 能看到）
- [ ] 自动生成 MCP schema 通过 MCP server validation
- [ ] 5 个示例 tool 用新 API 改写无 break

---

### 3.8 (#8) SKILL.md Lint ⭐⭐⭐

```bash
$ npx genesis skill lint backend/src/modules/ai-app/

✗ research/skills/factual-research.md
  - Missing required frontmatter field: `name`
  - Referenced file `./examples/case-1.md` not found

✓ writing/skills/citation-format.md
✓ topic-insights/skills/dimension-design.md

2/3 passed, 1 with errors
```

#### 检查项

1. Frontmatter 必填字段：`name` / `description` / `version`
2. `name` 在全项目唯一（不与其他 skill 撞名）
3. SKILL.md 中引用的相对路径文件存在
4. SKILL.md 中引用的 tool 名都已注册
5. 与 SkillLoader 兼容（实际跑一遍 parse）

#### 实施

```typescript
// backend/scripts/agent-cli/commands/skill-lint.ts
import { SkillLoader } from "@/modules/ai-harness/kernel/skills";
// ...
```

#### 工作量

单人 2 天

#### 验收

- [ ] CI 集成（PR 改了 SKILL.md 必跑 lint）
- [ ] 17 个 ai-app 现有 SKILL.md 全部通过 lint（先修后开 lint）

---

### 3.9 (#9) Graph Studio Lite ⭐⭐⭐⭐

**重申原则**：不做"用 GUI 画 agent"（产品级投入太大），只做**反向可视化**——把现有 mission 流程图绘出来。

**已有**：`MissionFlowView.tsx`（看不到代码但从命名推测有简单流程图）

**目标增强**：

```
点击节点 → 弹 Drawer：
┌─────────────────────────────────────┐
│ Stage S3: Researcher                │
├─────────────────────────────────────┤
│ Loop type: ReAct                    │
│ Spec: ResearcherSpec                │
│ Active model: gpt-4-turbo (auto)    │
│ Tools used: search_web, read_url    │
│ Skills active: factual-research     │
│                                     │
│ ▼ System Prompt (v2)                │
│ ┌─────────────────────────────────┐ │
│ │ You are a careful researcher... │ │
│ │ [Edit in playground]            │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ▼ Local Re-run                      │
│ Input: { topic: ... }               │
│ [▶ Re-run this stage only]          │
└─────────────────────────────────────┘
```

#### 关键能力

1. **节点详情**：点击节点显示 spec / loop / tools / skills / current prompt
2. **Prompt 内联编辑**：当前 prompt → 复制到 playground 编辑（不直接改文件）
3. **Stage 单独 rerun**：用当前 mission 上下文 + 修改后的 prompt 跑这一步
4. **token 流量边**：节点间连线宽度反映 token 流量

#### 技术栈

- React Flow（不重造）
- 与现有 EventJournal 集成（事件流转节点状态）

#### 工作量

- 单人 2-3 周
- 复杂度主要在"Stage 单独 rerun"——需要后端支持"以某个 stage 起点 + 历史 ctx 重跑"

#### 验收

- [ ] 任意 mission 能切到 graph 视图
- [ ] 点节点显示完整 detail
- [ ] 改 prompt 后能 rerun 单 stage 不污染原 mission
- [ ] Token 流量边视觉清晰

---

### 3.10 (#10) VS Code Extension ⭐⭐⭐

**目标**：

1. **CodeLens** 在 `@DefineAgent` 类上方：
   ```
   ▶ Run | Test | Replay | Inspect
   class ResearcherSpec extends AgentSpec {
   ```
2. **Hover** 在 tool 名称上：
   ```
   tools: ['search_web']
              ↑ hover 显示 tool description + input schema
   ```
3. **Go to Definition**：tool 名 → 跳到 `defineTool()` 位置
4. **TreeView**：项目内所有 agent + skill 列表（侧边栏）
5. **Status Bar**：显示当前 dev server 状态

#### 实施

独立 repo `genesis-vscode`：

```
genesis-vscode/
├── package.json              # vscode extension manifest
├── src/
│   ├── extension.ts          # activate
│   ├── codelens-provider.ts  # @DefineAgent codelens
│   ├── hover-provider.ts     # tool hover
│   ├── definition-provider.ts
│   ├── tree-view-provider.ts # 侧边栏
│   └── command-handlers/
│       ├── run-agent.ts
│       ├── test-agent.ts
│       └── ...
└── README.md
```

通过 ts-morph 解析 `@DefineAgent` AST 元数据。

#### 工作量

单人 3-4 周（不熟 VS Code API 时间翻倍）

**风险**：依赖 #1 CLI 稳定（codelens 命令直接调 CLI）。建议 Sprint 6 之后再做。

---

### 3.11 (#11) DSPy 风格声明式包装层 ⭐⭐⭐

**最简版本（V0）**——给 input/output schema，框架生成 system prompt（zod-schema-prompt 已是雏形）：

```typescript
// 简版：从 schema 自动生成
const QASignature = defineSignature({
  name: "qa-signature",
  description: "Answer factual questions with citations",
  input: z.object({
    question: z.string().describe("A factual question"),
  }),
  output: z.object({
    answer: z.string().describe("Concise answer"),
    citations: z.array(z.string().url()).describe("Source URLs"),
  }),
});

// 自动 buildSystemPrompt
const QAAgent = AgentSpec.fromSignature(QASignature, {
  loop: "react",
  tools: [searchWeb, readUrl],
});
```

**完整版本（V1）**：支持 prompt 自动优化（DSPy compile）

```typescript
const optimized = await optimize(QASignature, {
  trainset: dataset,
  metric: factualAccuracy,
  optimizer: "BootstrapFewShot",
  maxRounds: 5,
});
// optimized 是一个新的 AgentSpec，prompt 通过自动搜索 few-shot 例子优化过
```

#### 现实路径

- V0 工作量：单人 2 周
- V1 工作量：单人 6-8 周（需要训练数据、搜索算法、metric 实现）

**建议**：先做 V0，V1 视效果决定是否投入。

---

### 3.12 (#12) Eval Dataset 标准（接 Ragas） ⭐⭐⭐⭐

**目标**：所有 agent 用业界标准 metric 评估，跨项目可比。

#### Ragas 4 大 metric

1. **Faithfulness** — 输出忠实于检索到的 context（无 hallucination）
2. **Answer Relevancy** — 输出与 question 相关
3. **Context Precision** — 检索到的 context 中相关比例
4. **Context Recall** — 真实答案需要的 context 是否被检索到

#### 实施

```typescript
// backend/src/modules/ai-harness/governance/observability/ragas/
├── faithfulness.metric.ts
├── answer-relevancy.metric.ts
├── context-precision.metric.ts
├── context-recall.metric.ts
├── ragas-runner.ts          # 编排 4 metric
└── ragas-report.ts          # 生成 markdown 报告
```

每个 metric 内部用 LLM-as-judge 实现（Ragas 论文的方法）。

#### 与 EvalPipeline 集成

```typescript
// backend/src/modules/ai-harness/governance/observability/eval-pipeline.service.ts
class EvalPipelineService {
  async runRagas(spec: AgentSpec, dataset: string): Promise<RagasReport> {
    // 现有 eval-pipeline 加 ragas runner
  }
}
```

#### CLI

```bash
$ npx genesis eval ragas my-researcher --dataset eval.jsonl
Running Ragas eval on 30 cases...
✓ Faithfulness:        0.91 (target: 0.85)
✓ Answer Relevancy:    0.87 (target: 0.80)
✗ Context Precision:   0.72 (target: 0.75) — needs improvement
✓ Context Recall:      0.89 (target: 0.85)

Report: docs/agents/my-researcher/eval-report-2026-04-28.md
```

#### 工作量

单人 2 周

#### 验收

- [ ] 4 个 metric 各有实现
- [ ] 与 #2 evalAgent.expectRagas() 集成
- [ ] 1 个示例 dataset + agent 跑通

---

## 4. Sprint 路线图

| Sprint        | 周次   | 内容                                              | 依赖                 | 工时   |
| ------------- | ------ | ------------------------------------------------- | -------------------- | ------ |
| **Sprint 1**  | W1-2   | #1 CLI、#2 Eval-as-Test、#3 自动文档              | 无                   | 2 周   |
| **Sprint 2**  | W3-4   | #4 Prompt 版本、#7 Tool 类型宏、#8 Skill Lint     | #1                   | 2 周   |
| **Sprint 3**  | W5-6   | #5 Mission Replay UI                              | EventJournal（已有） | 1.5 周 |
| **Sprint 4**  | W7-8   | app.module 拆分（前置）+ #6 Hot-Reload Dev Server | 架构审计 Tier 2 #5   | 2 周   |
| **Sprint 5**  | W9-10  | #12 Ragas Eval                                    | #2                   | 2 周   |
| **Sprint 6**  | W11-14 | #9 Graph Studio Lite + #11 DSPy V0                | #1 #5                | 4 周   |
| **Sprint 7+** | W15+   | #10 VS Code Ext + #11 DSPy V1（按需）             | #1 稳定              | 6-8 周 |

**总工时**：14 周（必做项）+ 8 周（可选） = **14-22 周**

**最小可行路径**：Sprint 1 + 2 + 3 = **5.5 周**，已能交付 80% DX 价值。

---

## 5. 资源需求

| 角色       | 时间         | 主要任务                                                      |
| ---------- | ------------ | ------------------------------------------------------------- |
| 后端工程师 | 100% × 12 周 | CLI、prompt 版本、tool 宏、skill lint、ragas、app.module 拆分 |
| 全栈工程师 | 100% × 6 周  | Mission Replay UI、Graph Studio Lite                          |
| 前端工程师 | 50% × 4 周   | VS Code Ext（Sprint 7）                                       |

**精简版**：1 个后端 + 1 个全栈，14 周完成 9 项必做 + 3 项可选。

---

## 6. 成功指标（量化）

| 指标                              | 当前（基线） | Sprint 3 后 | Sprint 5 后 | 测量方法                   |
| --------------------------------- | ------------ | ----------- | ----------- | -------------------------- |
| 单次 prompt 调优循环              | ~7 min       | ~2 min      | ~10 s       | 改 prompt → 看到结果的耗时 |
| 新 agent 上线（idea → merged PR） | ~2 hr        | ~30 min     | ~10 min     | git log 时间戳             |
| Test 写一个 agent eval 用例       | ~30 min      | ~5 min      | ~5 min      | 自评                       |
| Agent contract 文档同步率         | 0%（手动）   | 100%        | 100%        | CI 检查                    |
| Eval 跨 agent 可比性              | ❌           | 🟡          | ✅          | Ragas 报告齐全             |
| Prompt 改不需重新部署             | ❌           | ✅          | ✅          | version flag 切换          |
| 本地调试不需起完整后端            | ❌           | 🟡          | ✅          | dev server 时间            |
| 改 spec 热重载时间                | ~10s         | -           | < 1s        | dev server tsx watch       |

---

## 7. 风险与缓解

| 风险                                             | 概率 | 影响 | 缓解                                                                          |
| ------------------------------------------------ | ---- | ---- | ----------------------------------------------------------------------------- |
| Nest 容器初始化太慢，CLI/dev server 体验差       | 中   | 高   | 用 `createApplicationContext`（比 `create()` 快 5×）；mini module 只加载 3 层 |
| app.module 拆分破坏现有功能                      | 中   | 高   | 渐进式拆 + 完整回归测试                                                       |
| FixtureStore 录的 fixture 因 spec 变化失效       | 高   | 低   | fixture 加 spec hash 自动检测过期；`agent test --re-record` 一键更新          |
| Ragas metric 实现质量不稳定（LLM-as-judge 噪声） | 中   | 中   | 用 MetaJudge consensus（已有）+ 定期 calibration                              |
| VS Code Ext 维护成本高                           | 中   | 低   | 独立 repo + community contributions；不影响主线                               |
| Graph Studio 的 stage rerun 改动太大             | 中   | 中   | 先做只读 visualization，rerun 是 V2                                           |
| Prompt 文件版本爆炸（v1/v2/.../v37）             | 低   | 低   | CLI `prompt prune --keep-latest 5`（不删除有 mission 用到的）                 |

---

## 8. 与既有审计的关系

| 审计项                                        | 状态         | 与本方案关系            |
| --------------------------------------------- | ------------ | ----------------------- |
| Engineering Config Audit (Phase 1-5)          | 大部分已落地 | 无冲突                  |
| Architecture Audit Tier 2 #5（拆 app.module） | 待做         | **Sprint 4 前置依赖**   |
| Frontend Cleanup Plan                         | 进行中       | Replay UI 与之配合      |
| Agent vs SOTA Audit                           | 已完成       | 本方案补足"DX 维度差距" |

---

## 9. 不做什么（明确边界）

| ❌ 不做                                 | 原因                                |
| --------------------------------------- | ----------------------------------- |
| 全功能 LangGraph Studio（GUI 画 agent） | 投入太大、与 code-first DNA 不符    |
| 通用 prompt marketplace                 | 偏离 agent 平台定位                 |
| 自研 LLM observability 产品             | LangSmith / Langfuse 已成熟，可对接 |
| Auto fine-tune 闭环（Sprint 7 探索性）  | ROI 不明，等 SkillLearner 数据积累  |
| 替代 jest/vitest 的自研测试框架         | 引入复杂度，不如基于 jest 扩展      |

---

## 10. 实施起点（建议）

如果只批一周时间验证可行性，做以下 3 件事：

1. **Day 1-2**：实现 `bootstrap-mini.ts` + `npx genesis agent inspect <name>` —— 验证 mini bootstrap 能跑、能拿元数据
2. **Day 3**：实现 `npx genesis agent run <name>` —— 验证 AgentRunner 在 CLI 上下文工作
3. **Day 4-5**：实现 1 个 `evalAgent().expectFact().run()` 端到端 —— 验证 JudgeService 可装配

如果这 5 天能跑通，Sprint 1 后续 + 全方案就有信心走完。

---

## 11. 关键设计决策清单（待确认）

| #   | 问题                        | 推荐                                     | 理由                   |
| --- | --------------------------- | ---------------------------------------- | ---------------------- |
| 1   | CLI 用什么？                | tsx 直跑                                 | 已有 tsx，避免双轨     |
| 2   | Prompt 文件位置？           | 跟 agent 同目录 `prompts/`               | co-location，不集中    |
| 3   | Eval 跑在 jest 还是新框架？ | jest                                     | 统一测试栈             |
| 4   | Hot-reload 用什么？         | tsx watch + Nest standalone context 重建 | 比 nodemon 快          |
| 5   | Graph 库？                  | React Flow                               | 不重造轮子             |
| 6   | VS Code Ext 时机？          | Sprint 7+                                | 等 CLI 稳定            |
| 7   | DSPy V0 优先级？            | Sprint 6                                 | 实验性，不阻塞 V1      |
| 8   | Ragas metric 用谁的 judge？ | MetaJudge（已有）                        | 减低 LLM-as-judge 噪声 |

---

## 12. 附录 - 参考与对标

- LangGraph Studio: https://github.com/langchain-ai/langgraph-studio
- DSPy: https://github.com/stanfordnlp/dspy
- Ragas: https://github.com/explodinggradients/ragas
- OpenAI Agents SDK: https://github.com/openai/openai-agents-python
- Anthropic claude-agent-sdk: https://github.com/anthropics/claude-agent-sdk
- Mastra: https://github.com/mastra-ai/mastra
- Letta (MemGPT): https://github.com/letta-ai/letta

---

**评审人**: 待定
**实施 PR 跟踪**: 建议命名 `dx/sprint-N-<topic>`，每 Sprint 1 个 epic PR
**复盘节点**: Sprint 3 末（验证最小价值）/ Sprint 5 末（验证生产价值）
