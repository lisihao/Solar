# 专家市场 · 3 方事实契约 v0（设计草案）

> 状态：**设计草案，未动代码**。北极星 = 1 方(自家 app)/2 方(伙伴)/3 方(外部开发者)在**同一套契约**上汇聚生产与消费能力。
> 配套决策与复盘见 memory `project_marketplace_fact_contract_constitution_2026_06_10`。现状端口见 `backend/src/modules/ai-app/marketplace/capability/capability-runner.port.ts`。

---

## 0. 这份契约要解决的问题

#16b 硬切失败的结构根因：能力核端口只有 **11 个 type + 一个 `domain` 字符串逃生舱**，而最富消费方 playground 需要 **80 个 typed 事件**。窄契约套富消费方 → 每类业务事件靠 `emitDomain("字符串名")` 约定，消费方各写 switch、各自字符串识别同一份事实（`dimension:graded` 在 playground projector 与 company bridge 各识别一遍）。

v0 的目标：把「事实」标准化成**带类型、可序列化、零 app 点名**的契约，让 1/2/3 方都对着它写。

---

## 1. 唯一的边界规则：事实 vs 解释

- **事实（进契约 / 核供）**：客观发生了什么，换任何消费方都不变。agent 调了某工具拿到某输出、stage 起止、花了多少 token、第几轮 ReAct、维度完成、评分数值 X、verifier 给了 critique。
- **解释（留 app / 投影）**：某 app 决定拿事实怎么呈现/聚合/什么文案/什么策略。评分→红 badge、14-chip 点亮、序言成文、>280 字截断、3 桶折叠。

**边界落点**：数据「还是纯事实」的最后一刻 = 契约边界；第一次编码进某 app 的选择 = app 起点。**压缩/截断是解释**，契约层绝不替 app 做（现 `relayAgentEvent` 在源头 truncate = 越界、有损）。

**三个自检**（任何字段都套）：①换人测试（加第 N 个 app 要不要每家不同？要→解释）②点名测试（出现 `playground`/`s2-leader-plan` 等 app 概念？有→污染）③增长测试（每来一个 app 就加字段/type？是→边界切错侧）。

---

## 2. 契约表面（四件套）

一个能力（capability）对宿主暴露四样东西，缺一不可：

```
能力  ──①Manifest（声明：我是谁、要什么权限、怎么验收）
      ──②run(input, ctx) → ③Result（终态产物）
      └─ ctx.onFact(FactEvent)（②执行期间的事实流）
宿主  ──④Projection（app 私有：把事实流投影成自己的呈现事件 + 落库 + UI）
```

①②③属**契约（通用，1/2/3 方共用）**；④属**各 app 私有（解释）**。

---

## 3. ② + ③：事实流 FactEvent（v0 核心）

**两个事实族，全部可 JSON 序列化**（3 方在沙箱/远程跑，不能传进程内对象引用）。所有 payload 字段都是「原始事实」——评分给数值不给字母档、计数给 number 不给 badge。

### 3a. AgentFact —— agent 执行级（来自 harness `IAgentEvent`，原件透传、零裁剪）

> 现状这些已存在于 `ai-harness/agents/abstractions/agent-event.interface.ts`（11 typed event），但被 `relayAgentEvent` 在源头裁剪成薄 `agent-trace` 才出核。v0 = **原件透传**。

```ts
type AgentFact =
  | { kind: "agent.started"; agentRef: AgentRef; ts: number }
  | {
      kind: "agent.thinking";
      agentRef: AgentRef;
      text: string;
      tokenCount: number;
      modelId?: string;
      ts: number;
    }
  | {
      kind: "agent.action_planned";
      agentRef: AgentRef;
      action: ActionFact;
      ts: number;
    } // tool_call: {toolId,input}; parallel: {calls[]}
  | {
      kind: "agent.action_executed";
      agentRef: AgentRef;
      result: ActionResultFact;
      ts: number;
    } // {toolId,output,latencyMs,error?} —— output 完整，不 stringify+slice
  | {
      kind: "agent.reflection";
      agentRef: AgentRef;
      revision: number;
      score: number | null;
      verdicts: { judgeId: string; score: number; critique?: string }[];
      ts: number;
    }
  | {
      kind: "agent.tools_recalled";
      agentRef: AgentRef;
      recalledIds: string[];
      categories: string[];
      source: string;
      ts: number;
    }
  | {
      kind: "agent.iteration";
      agentRef: AgentRef;
      iteration: number;
      maxIterations: number;
      approachingLimit: boolean;
      lastActionKind?: string;
      ts: number;
    }
  | {
      kind: "agent.validation_failed";
      agentRef: AgentRef;
      rejectCount: number;
      maxRejects: number;
      issues: string;
      ts: number;
    }
  | {
      kind: "agent.budget_warning";
      agentRef: AgentRef;
      severity: "pressure" | "soft" | "exhausted";
      tokensUsed?: number;
      tokensLimit?: number;
      costUsd?: number | null;
      ts: number;
    }
  | {
      kind: "agent.error";
      agentRef: AgentRef;
      message: string;
      recoverable: boolean;
      failureCode?: HarnessFailureCode;
      diagnostic?: Record<string, unknown>;
      ts: number;
    } // ★ failureCode/diagnostic 现被丢，必须带
  | {
      kind: "agent.terminated";
      agentRef: AgentRef;
      reason: "completed" | "budget" | "error" | "cancelled";
      tokensUsed: number;
      costCents: number;
      iterations?: number;
      modelId?: string;
      ts: number;
    };
```

`AgentRef`：**中性身份**，禁 `playground.*`。`{ role: string; instanceId?: string; dimension?: string }`。role 取能力自定义角色名（如 `researcher`/`leader`），不绑任何 app。

### 3b. PipelineFact —— 编排/流水线级（机制事实，现多走 `domain` 字符串舱）

> 这些是「编排器客观跑了哪些 step、产出了什么」，与 app 无关。现状在 `deep-insight-stage-bindings.ts` 用 `emitDomain("字符串", data)` 硬编码产出 → v0 提成 typed。

```ts
type PipelineFact =
  | { kind: "mission.started"; input: CapabilityRunInput; ts: number }
  | { kind: "mission.completed"; usage: Usage; wallTimeMs: number; ts: number }
  | {
      kind: "mission.failed";
      failureCode?: HarnessFailureCode;
      message: string;
      ts: number;
    }
  | {
      kind:
        | "stage.started"
        | "stage.completed"
        | "stage.failed"
        | "stage.degraded"
        | "stage.stalled";
      stageId: string;
      reason?: string;
      elapsedMs?: number;
      usage?: Usage;
      ts: number;
    } // stageId 是能力自定义的稳定 id，非 app 的「14-chip」概念
  | {
      kind: "unit.started" | "unit.completed" | "unit.failed"; // 「unit」=能力内部可并行的工作单元（deep-insight 里是 dimension；通用化命名）
      unitId: string;
      label?: string;
      producedCount?: number;
      ts: number;
    }
  | {
      kind: "unit.graded";
      unitId: string;
      axes: Record<string, number>;
      overall: number;
      summary?: string;
      ts: number;
    } // ★ 给数值，app 投字母档
  | {
      kind: "artifact.produced";
      artifactId: string;
      artifactType: string;
      meta: Record<string, number>;
      ts: number;
    } // sectionsCount/citationsCount/wordCount 等计数事实
  | {
      kind: "verdict";
      verdictType: "verifier" | "critic" | "red-team" | "leader-signoff";
      target?: string;
      score?: number;
      passed?: boolean;
      critique?: string;
      ts: number;
    } // ★ 给原始裁决，app 投 decision 三档/badge
  | {
      kind: "plan.produced";
      units: { id?: string; name: string; rationale?: string }[];
      goals?: Record<string, unknown>;
      ts: number;
    }
  | {
      kind: "cost.tick";
      stageId?: string;
      deltaTokens: number;
      deltaCostUsd: number;
      ts: number;
    };
```

```ts
interface FactEnvelope {
  // 统一信封，3 方/远程边界友好
  capabilityId: string; // manifest.id
  runId: string; // 宿主生成
  seq: number; // 单调序号，乱序/补发可重排
  fact: AgentFact | PipelineFact;
}
type OnFact = (e: FactEnvelope) => void; // 替代现 ctx.onEvent(CapabilityRunEvent)
```

**与现状的差异（v0 要做的）**：

- 删 `CapabilityRunEvent.type === "domain"` 字符串逃生舱；其 payload 里的 `agent:lifecycle`/`dimension:research:*`/`leader:goals-set`/`stage:metrics` 全部映到上面 typed FactEvent。
- 删 `telemetry.systemStageId` 注释里的 `14-chip`/`s1-budget…s11-persist`（app 呈现概念）；契约只给中性 `stageId`。
- `AgentFact` 原件透传，停掉 `relayAgentEvent` 的源头裁剪/截断。

---

## 4. ①Manifest：3 方声明（1 方能手挥、3 方必须显式）

```ts
interface CapabilityManifest {
  id: string; // 全局唯一，禁 app 名前缀
  title: string;
  version: string;
  input: JsonSchema; // 入参 schema（3 方/宿主据此校验）
  result: JsonSchema; // 终态产物 schema
  facts: FactKind[]; // 声明本能力会发哪些 FactEvent（宿主据此知道能投影什么）—— 等于「事件契约自描述」
  permissions: {
    // ★ 3 方逼出来的原语：能力要访问什么
    tools?: string[]; // 申请的 engine tool id（宿主授权/拒绝）
    data?: ("web" | "knowledge-base" | "user-files")[];
    network?: boolean;
  };
  evaluation?: {
    // ★ 质量信号（市场信任地基）
    rubric?: { passThreshold: number; maxAttempts: number };
    emitsVerdict: boolean; // 是否在 facts 里发 verdict
  };
  execution: "in-process" | "sandboxed" | "remote-mcp"; // 见 §6
  billing: { attribution: "consumer-pays" | "publisher-subsidized" }; // ★ token 谁付
}
```

`manifest.facts` 自描述 = 「契约自带它发哪些事实」，宿主投影层据此静态生成消费代码，**消灭字符串识别表**。

---

## 5. ④Projection：留 app 的解释（v0 要明确「不进契约」的清单）

每个 app 一个 projector，**消费同一条 FactEvent 流**，产自己的呈现事件 + 落库。已实扫确认属解释、留 app 的：

| app        | 解释（留 app，喂 FactEvent 投影，不再字符串识别）                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| playground | `agent:narrative` 成文、`NarrativeStage`(s1-budget…) 分段、`leader:foreword` 序言、`mission:preflight-warning` 阈值+红段、`dimension:graded`→字母档、`systemStageId`→14-chip、rerun 触发链 |
| company    | 3 桶折叠(planning/execution/review)、`buildNarrativeText` 截断 280/200/60、渐进任务单调状态机、验收阈值 `DEFAULT_ACCEPTANCE_THRESHOLD=60`、知识图谱/library 沉淀                           |
| 3 方 app   | 自定，宿主只保证给到 typed FactEvent                                                                                                                                                       |

**持久化也属 app**（现 `MissionPersistencePort` 已是消费方注入，方向对）：契约只发事实，落不落库、落哪、回放怎么做是 app 决定。

---

## 6. §3 之外的另一根轴：信任 + 执行隔离（一套契约、多种部署）

语义契约只有一套；**信任与执行位置按方分层**：

| 方   | 信任   | 执行                                                | FactEvent 传输 |
| ---- | ------ | --------------------------------------------------- | -------------- |
| 1 方 | 全信任 | in-process（直接调 AgentRunner）                    | 进程内回调     |
| 2 方 | 部分   | sandboxed（资源/权限受限的进程内或同集群）          | 进程内/IPC     |
| 3 方 | 零信任 | **remote-mcp**（独立沙箱/远程，经 MCP server 暴露） | 序列化过网络   |

`ICapabilityRunner` 现注释已预埋「未来 sandbox/remote/MCP 实现，消费方零改动」——v0 把它升成硬约束：**FactEvent 必须可序列化**（§3 已遵守），`run()` 的 input/result/permissions 全部 JSON-Schema 化，使同一份 manifest 既能 in-process 跑 1 方、也能经 MCP 跑 3 方。

---

## 7. 零点名（spec/lint 强制，非 honor）

- 契约层（manifest / FactEvent / port）**禁出现任何 app 名**：`playground`、`company`、`s1-budget…s11-persist`、`14-chip`、`sourceTodoId`。
- 能力内部 agent 标识去 `playground.` 前缀（现 `agent-spec-catalog` 是 playground 与核共享 → v0 需别名层或迁中性 id，注意 playground 引用同步）。
- 落地：扩 `backend/src/__tests__/architecture` 加一条 spec —— 扫 `marketplace/capability/**` 出现 app 名字面量即红。把现「honor-only」升成自动拦截。

---

## 8. 平价测试（v0 的承重承诺，防 #16b 重演）

写一个 **playground-parity 契约测试**：断言「FactEvent 流能重建出 playground 当前 80 个事件」——**即便 playground 还没跑在契约上**。

- 作用：强制契约始终是**超集**（playground 是最富消费方），而不是「company-complete」。
- 形式：golden trace —— 喂一组 FactEvent，跑 playground projector，比对它能产出的 80 事件集合无缺。
- 这条测试就是 #16b 缺的那道闸：**「测试绿」从此 = 事实超集平价，而不是「跑通了」**。

---

## 9. 分阶段落地（顺序与 #16b 正相反）

1. **阶段 1**：实现 §3–§7 契约（typed FactEvent + manifest + 零点名 + 可序列化），**用 §8 平价测试按 playground 超集校验**；迁 company 上干净契约（删其 `domain` 字符串识别 + 硬编码 stepId）。雷：别当成「只为 company 修」。
2. **阶段 2**：迁 playground（1 方）上同一契约 = 吃狗粮、了结双源；flag 纪律（生产实测平价才删私有 pipeline）。
3. **阶段 3**：经 MCP/A2A 对外 + 沙箱 + 计费 + eval 放 2 方、3 方。

---

## 10. 待你拍板的决策（v0 留口）

- **D1 谁当实现真源**：deep-insight 核留作实现，还是把 playground 那份更富、更实战的 pipeline 提升为实现真源、删 deep-insight 副本？（契约不变，但决定阶段 1 的代码投在哪份上，避免给「迟早要删的副本」投钱。）
- **D2 `unit` 通用化命名**：deep-insight 的 `dimension` 在契约里叫什么中性词（`unit`/`segment`/`workItem`）？影响 manifest.facts 词汇。
- **D3 去点名 vs playground 不动的折中**：阶段 1 是给核做 `playground.*` 别名层（playground 零改），还是直接迁共享 catalog 的中性 id（playground 同步改引用）？
- **D4 计费归因模型**：3 方能力的 token 成本 `consumer-pays` 为默认，还是允许 `publisher-subsidized`？影响 manifest.billing 与 guardrails。
