# BusinessAgentTeam Framework

> Long-running mission lifecycle 框架（heartbeat / rerun / event relay / store contract），
> 支撑 `ai-app/playground` 这类 SOTA 多 stage Agent 团队。
> 反向迁移目标：`ai-app/research`、`ai-app/writing`、`ai-app/insight` 等。

## 文件结构（蓝图 §8.1，2026-05-24 P8 整理后）

```
business-team/
├── abstractions/                       跨子目录共享契约
│   ├── business-team-spec.interface.ts          E4  BusinessAgentTeamSpec
│   ├── mission-runtime-shell.interface.ts       E0  IMissionRuntimeAdapter
│   ├── mission-store.interface.ts               E2  IBusinessTeamMissionStore
│   └── rerun-guard.interface.ts                 E3  IBusinessRerunGuard
├── lifecycle/{abstractions,__tests__}/  E0 + P6 (mission runtime shell + 7 件 lifecycle framework)
├── events/{__tests__}/                  E1     (event relay framework，旧名 relay/，P8 改名)
├── invocation/{abstractions,__tests__}/ P1     (agent invoker framework + DAG concurrency)
├── dispatcher/{abstractions,__tests__}/ P2     (mission dispatcher runtime-glue)
├── bindings/{abstractions,__tests__}/   P2     (stage bindings 薄骨架)
├── state/{__tests__}/                   P2     (cross-stage state typed wrapper)
├── span/{__tests__}/                    P2     (OTel mission span 三级嵌套)
├── rerun/{abstractions,__tests__}/      E3 + P5 (heartbeat-decision 纯函数 + 5 件 rerun framework)
├── orchestrator/{abstractions,__tests__}/ P7    (业务侧 orchestrator skeleton)
├── helpers/{__tests__}/                 P4     (batch-executor / supply-budget / axis-grade-grounding)
└── README.md（本文件 + 每子目录有自己的 README）
```

每个子目录的 README 描述本目录含哪些 framework / contract、业务侧应如何继承、历史演进；本文件保留装配模板与全局设计原则。

## 装配模板（playground 是 reference 实现）

业务模块只需提供 4 个 adapter（`BusinessAgentTeamSpec` 的 4 个字段）：

```ts
// ai-app/research/research.module.ts (示意)
import {
  MissionRuntimeShellFramework,
  EventRelayFramework,
  type IMissionRuntimeAdapter,
  type BusinessAgentTeamSpec,
} from "@/modules/ai-harness/facade";

@Injectable()
class ResearchEventRelay extends EventRelayFramework {
  constructor(eventBus: DomainEventBus) {
    super(eventBus, "research"); // ← 业务 namespace
  }
}

@Injectable()
class ResearchMissionRuntimeShell {
  constructor(
    framework: MissionRuntimeShellFramework,
    /* ... business deps */
  ) {
    // adapter 注入 wallTimeMs / credits / budgetMultiplier / createMissionRow
  }
  async openSession(input: ResearchInput) {
    return framework.openSession({ adapter: this.adapter, input });
  }
}

@Injectable()
class ResearchMissionStore implements IBusinessTeamMissionStore {
  // 7 个核心 lifecycle 方法 + ~N 个业务专属方法
}

@Injectable()
class ResearchRerunGuard implements IBusinessRerunGuard {
  async checkInFlight(missionId, userId) {
    const detail = await this.store.getById(missionId, userId);
    const latestBusinessTs = await this.queryLatestBusinessEventTs(missionId);
    const decision = decideMissionInFlight({
      // ← framework 纯函数
      status: detail.status,
      heartbeatAgeMs: hbAt ? Date.now() - hbAt : null,
      latestBusinessEventAgeMs: latestBusinessTs
        ? Date.now() - latestBusinessTs
        : null,
    });
    return { ...decision, status, heartbeatAgeMs, latestBusinessEventAgeMs };
  }
  async ensureRerunable(missionId, userId) {
    /* throw if inFlight, cleanup if zombie */
  }
}
```

## 设计原则

### YAGNI：抽象只跟随真实 consumer

| 抽象                | 是否落地     | 理由                                                                |
| ------------------- | ------------ | ------------------------------------------------------------------- |
| E0 Runtime Shell    | ✅ Framework | 通用：wall timer + abort + try-finally 死手准则                     |
| E1 Event Relay      | ✅ Framework | 通用：emit / budget exhaustion / IAgentEvent 翻译 8 类型            |
| E2 Mission Store    | ⚪ 接口      | 业务 schema 各异（28 playground methods vs research subset）        |
| E3 Rerun Guard      | 🟡 半框架    | 9-cell 决策纯函数（共享）+ SQL LIKE / store 调用（业务侧实现）      |
| E3 Ctx Hydrator     | ⚪ 跳过      | ctx schema 100% 业务（dimensions / reportArtifact / chapterDrafts） |
| E3 Stage Dispatcher | ⚪ 跳过      | 与 PIPELINE.steps 强耦合，每个 stage 函数签名 / 写库 schema 都不同  |
| E4 Factory          | ⚪ 接口      | 1 consumer 时 NestJS DI 自然完成装配；2 consumer 时再抽真 factory   |

**第二个 consumer 出现时再做的事**：

1. `BusinessAgentTeamFactory.assemble(spec)`：把 4 个 adapter 装成 `TeamRuntime`
2. `BusinessTeamRegistry`：模块自注册
3. `BusinessTeamModuleBuilder`：NestJS Dynamic Module 帮装 provider 图
4. ctx-hydrator / stage-dispatcher 的"业务方注入 ctx 类型 + harness 提供 hydrate
   skeleton"模式

### 单向依赖

```
ai-app/playground              ← 业务实现（reference）
   ↓ uses
ai-harness/teams/business-team ← framework + 接口
   ↓ uses
ai-harness/facade              ← public API
```

业务侧只通过 `@/modules/ai-harness/facade` 引用 framework，不穿透内部路径。

### 事件 namespace 强校验

EventRelayFramework 通过 `${namespace}.xxx` 模板拼接所有 event type；业务方在
constructor 注入 namespace 字符串后，`agent:thought` / `cost:tick` / `mission:`
等 ~10+ 类事件全自动加前缀。

### 心跳决策单一源

`decideMissionInFlight(input): HeartbeatDecision` 是纯函数（无副作用）。业务方
读 status / heartbeat / latestBusinessEventTs 后调本函数即得 inFlight /
zombieDetected 判定，9-cell 矩阵语义全 framework 集中管理。

## 历史演进

| 阶段 | 时间       | 内容                                                                                 | Commit      |
| ---- | ---------- | ------------------------------------------------------------------------------------ | ----------- |
| E0   | 2026-05-08 | mission runtime shell framework 上提（wall timer / abort / shell）                   | ffaf672b3   |
| E1   | 2026-05-08 | event relay framework 上提（emit / tickCost / IAgentEvent 8 类）                     | 14f8e8ec9   |
| E2   | 2026-05-08 | mission store 接口抽出（structural typing）                                          | 6f94ebc33   |
| E3   | 2026-05-08 | rerun guard 9-cell 纯函数 + 接口（YAGNI: ctx-hydrator / dispatcher 跳过）            | a1e18f5d3   |
| E4   | 2026-05-08 | BusinessAgentTeamSpec 聚合接口 + README（NestJS DI 完成装配）                        | (本 commit) |
| E5   | -          | 邻居业务（research / writing / TI）反向迁移（用户决策：先做实 playground，邻居延后） | -           |
| E6   | 2026-06    | rename 完成：后端模块统一为 `playground`，前端路由/组件目录保留 `agent-playground`   | -           |
