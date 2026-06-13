# L3 AI Apps

> 业务应用层。每个子目录对应 `backend/src/modules/ai-app/{module}/`。

## 模块清单

| 模块          | 后端代码路径            | 文档目录                               |
| ------------- | ----------------------- | -------------------------------------- |
| ask           | `ai-app/ask/`           | [ask/](ask/)                           |
| contracts     | `ai-app/contracts/`     | [contracts/](contracts/)               |
| custom-agents | `ai-app/custom-agents/` | [custom-agents/](custom-agents/)       |
| explore       | `ai-app/explore/`       | [explore/](explore/)                   |
| feedback      | `ai-app/feedback/`      | [feedback/](feedback/)                 |
| image         | `ai-app/image/`         | [image/](image/)                       |
| insight       | `ai-app/insight/`       | [insight/](insight/)                   |
| library       | `ai-app/library/`       | [library/](library/)                   |
| office        | `ai-app/office/`        | [office/](office/)                     |
| planning      | `ai-app/planning/`      | [planning/](planning/)                 |
| playground    | `ai-app/playground/`    | [agent-playground/](agent-playground/) |
| radar         | `ai-app/radar/`         | [radar/](radar/)                       |
| research      | `ai-app/research/`      | [research/](research/)                 |
| simulation    | `ai-app/simulation/`    | [simulation/](simulation/)             |
| social        | `ai-app/social/`        | [social/](social/)                     |
| teams         | `ai-app/teams/`         | [teams/](teams/)                       |
| writing       | `ai-app/writing/`       | [writing/](writing/)                   |

> **命名注意**：后端模块目录已改名——`topic-insights/` → `insight/`，`agent-playground/` → `playground/`。
> 前端路由保留旧名（`frontend/app/ai-insights/`、`frontend/app/agent-playground/`、`frontend/app/ai-radar/`、`frontend/app/custom-agents/`），文档中指后端路径时用新名。

## benchmark Agent Team(MissionPipeline 派)

新 MissionPipeline 派 team(`debate-team` / `planning-team` / future)拷贝 `playground` 时的 canonical reference:

- [benchmark-agent-team-template.md](benchmark-agent-team-template.md) — how-to-copy guide(目录骨架 + 拷贝步骤 + 验收清单)
- [benchmark-agent-team-invariants.md](benchmark-agent-team-invariants.md) — what-must-hold(R6/R7/R8 / sediment topology / stage hook 模式 / idempotent 重构守门 / grep gate suite)
- [agent-playground/agent-team-boundary-audit-2026-05-08.md](agent-playground/agent-team-boundary-audit-2026-05-08.md) — 边界审计 Rev 5 设计共识 + Rev 6 Stage 0/1/3 实施回写
- [../ai-harness/facade/sediment-topology.md](../ai-harness/facade/sediment-topology.md) — `ai-harness` 6 个 sediment zones(canonical / foundational / parallel)+ grep-verified 依赖边

## 边界规则

- 业务编排专属层。多 agent / 业务流程 / mission 模板都归这里
- **必须通过 facade 消费下层**：`ai-engine/facade`、`ai-harness/facade`，不得穿透内部路径
- App 之间极少直接依赖,必要时通过 `ai-app/contracts/` interface tokens 解耦(参考 `mission-platform.contract.ts` 的 IMissionRunner / IMissionListReader pattern,Stage 1 / S1-5 落地)
- 通过 `onModuleInit` 向 `AgentRegistry` / `TeamRegistry` 注册自有 Agent / Team

## 注册模式

```typescript
onModuleInit() {
  this.agentRegistry.register(this.myAgent);
  this.teamRegistry.registerConfig(MY_TEAM_CONFIG);
}
```

详见 [`.claude/CLAUDE.md`](../../../.claude/CLAUDE.md) 中"模块依赖关系"。
