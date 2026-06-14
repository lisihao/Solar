# Architect Review (Wave 1b + Wave 4)

**Reviewer:** Architect Agent
**Date:** 2026-05-24
**Scope:** commits `38f083248` / `4d81a8002` / `80822389c` / `4adf17a9b` / `4424d17f3` + 前置 P1/P2/P9b/P10
**Method:** read-only. 实际读过的文件列在文末 §7。

---

## 0. TL;DR

落地的东西骨架对，方向也对——`ai-app` 业务语义和 `ai-harness/teams/business-team` 运行时机制分得比之前任何一次都清楚，三层看护栏（ESLint + jest spec + pre-push）也都按"动态 import / 注释逃逸都拦"的标准做了。

但有 4 个真实问题，按严重度从大到小：

1. **§8.1 framework 切片粒度溢出真实消费方**——`lifecycle/`（7 framework）、`rerun/`（5 framework）、`helpers/`（3 helper）只有 playground 一家用，**事实上违反 "3 处使用再考虑抽象"**。文档 §6 还在自欺欺人写"P4-P7 推迟到真有第二消费方"，git log 显示 `54b4152d0`/`2e4b4d851`/`8947b1e3b`/`5853ad6d1` 已经把这些 framework 抽出来了。
2. **§8.2 runtime/ 顶层目录在三家含义不一致**——playground 是"thin config + adapter"，radar 也是，social 塞了 `mcp-client.service.ts` / `publish-queue.service.ts` / `rate-limiter.service.ts` / `session-manager.service.ts` 这种 stateful runtime service。看护栏放过了，因为 spec 只查"必须存在"，没查"什么不该进 runtime/"。
3. **`bridgeOrchestratorStageEvent` 在 radar 是死继承**——radar dispatcher 注释自己写明"framework bridge 不能直接用——radar 用自己的 handleOrchestratorEvent"。换句话说 framework 多态点（hook 签名）没匹配上一家真实消费方，那家被迫绕开。
4. **`mission-app-conformance.spec.ts` 锁的"必须 buildXxxConfigSnapshot"是命名巧合**——每家方法名不同（`buildForFreshRun` / `buildRadarConfigSnapshot` / `buildSocialConfigSnapshot`），这是 string match 不是 contract，未来重命名会假绿。

综合评分：**7.5 / 10**。骨架做对了，但 framework 自己也踩了它要救的坑（"为单一消费方做框架"）。

---

## 1. §8.2 目录布局合理性（5 顶层 + mission 3 必备子目录）

### 1.1 5 顶层（module / api / runtime / mission / events）是不是真正 MECE

**结论**：4/5 真正 MECE，runtime/ 是个含义不清的桶。

- `module/` ✅ — NestJS Module 装配点，单文件、职责零歧义
- `api/` ✅ — HTTP 边界（controller + dto + contracts），传统 web app boundary 切法
- `events/` ✅ — DomainEventRegistry 注册 schema，纯业务事件命名空间
- `mission/` ✅ — mission 运行时业务，所有 stage/role/lifecycle 都进这里
- `runtime/` ⚠️ — 在三家含义不一致

**runtime/ 三家对比**：

| App        | runtime/ 内容                                                                                                                                                                                               | 性质                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| playground | event-relay / input-rebuilder / playground.config / playground-runtime.config / playground-tuning-profile                                                                                                   | thin config + thin adapter (5 文件，~纯配置) |
| radar      | radar.config / radar.constants / radar.gateway                                                                                                                                                              | thin config + gateway (3 文件)               |
| social     | mcp-client / platform-limits.config / platforms.config / publish-queue / rate-limiter / selectors.config / session-manager / social.config / social.gateway / social-engine-bridge / social-publish.adapter | 11 文件，混 4 类东西                         |

social/runtime/ 里 `publish-queue.service.ts` / `rate-limiter.service.ts` / `mcp-client.service.ts` / `session-manager.service.ts` 是有状态、长寿命的 runtime service——这些既不是 "config"，也不是 "gateway / constants / tuning profile"。SOP §2 给 runtime/ 的定义是"运行时配置/常量/网关"，与社交媒体发布流水线的 publish queue / browser session / rate limiter 都对不上号。

**问题**：runtime/ 实际上变成"既不属于 api、也不属于 mission、又不属于 events 的剩余物"的兜底桶。"剩余物桶"会随时间堆得越来越乱。

**建议**：

- 要么 SOP §2 明文限定 runtime/ 只放 _.config.ts / _.constants.ts / _.gateway.ts / _.tuning-profile.ts / \*.adapter.ts 这 5 类后缀，并加入 layout spec lint；
- 要么承认 social 的 publish-queue / session-manager 属于 mission/services/ 或 integrations/，搬走（PR-X：social runtime 净化）。

### 1.2 mission/{pipeline, agents, lifecycle} 是否真 MECE

**结论**：3 个必备子目录基本 MECE，但"per-app 可选"清单已经在退化。

`mission/` 实际观测到的子目录（agent-playground 全集）：

```
agents/  artifacts/  chat/  context/  export/  lifecycle/  pipeline/  rerun/  roles/  skills/  types/
```

11 个子目录，6 个不在 SOP 强制清单里。逐个分析：

| 子目录       | 真正职责                           | 应归属                                                           |
| ------------ | ---------------------------------- | ---------------------------------------------------------------- |
| `pipeline/`  | dispatcher + orchestrator + stages | ✅ MECE                                                          |
| `agents/`    | agent 定义（spec + SKILL.md）      | ✅ MECE                                                          |
| `lifecycle/` | mission 持久化                     | ✅ MECE                                                          |
| `roles/`     | RoleService NestJS wrapper         | ⚠️ 与 `agents/` 边界模糊（见 §1.3）                              |
| `context/`   | MissionContext + MissionDeps       | ✅ MECE                                                          |
| `artifacts/` | report / chapter / evidence util   | ⚠️ 这里堆了 `narrative.util.ts` / `evidence-budget.ts` 等 helper |
| `skills/`    | SKILL.md（17 个）                  | ⚠️ 与 `agents/` 里的 SKILL.md 双源（见 §1.4）                    |
| `chat/`      | leader chat 业务                   | ✅ MECE（playground 独有）                                       |
| `export/`    | report export 业务                 | ✅ MECE（playground 独有）                                       |
| `rerun/`     | rerun service / orchestrator       | ✅ MECE（playground 独有）                                       |
| `types/`     | leader-verdict.types               | ⚠️ 单文件目录，过度细分                                          |

**问题 A：`agents/` vs `roles/` 双源**

`agents/leader/leader.agent.ts` 是 agent spec；`roles/leader.service.ts` 是 NestJS RoleService。两者职责不同 SOP 文档没写清。

新人会问："Leader agent 改 prompt 改哪边？" → 答案要去看代码 import 图才能确认。建议 SOP §2.1 加：

```
agents/  AgentSpec + SKILL.md（"角色怎么想"）
roles/   RoleService（"角色 NestJS wrapper：业务参数整形 / 选择 agent"）
```

**问题 B：`agents/<role>/SKILL.md` vs `skills/<skill-id>/SKILL.md` 双源**

playground 同时存在 `mission/agents/researcher/researcher.agent.ts` 和 `mission/skills/web-research/SKILL.md`。两者都是 Skill 载体。一个 reviewer 看不出"哪个目录是 canonical"。

实际上 `agents/<role>/` 装的是"agent-level prompt"，`skills/<skill-id>/` 装的是"task-level skill"，两者粒度不同。但目录命名没体现这层差异。

**建议**：把 `skills/` 改名为 `skill-packs/` 或 `mission-skills/`，或在 SOP §2.1 用文字明确两者粒度。

### 1.3 5 顶层够不够？

够。可能的"第六个"候选：

- `integrations/` — 已经是 per-app 可选（social/wechat、playground/sources），不必强制
- `prompts/` — 各家 SKILL.md / agent.ts 里有 prompt，不要再单独搞
- `frontend-contracts/` — 已经在 `api/contracts/` 下，OK

**评分 §8.2 顶层布局**：8/10。骨架对，runtime/ 的语义边界没锁死是大隐患。

---

## 2. §8.1 framework 切片粒度

### 2.1 7 子目录（实际是 11 个）粒度评估

SOP §3 列了 7 个 framework 切片（invoker / dispatcher / bindings / state / span / events / lifecycle），但实地 `business-team/` 顶层有 **11 个目录**：

```
abstractions/  bindings/  dispatcher/  events/  helpers/  invocation/  lifecycle/  orchestrator/  rerun/  span/  state/
```

逐个看真实消费方：

| 切片            | 文件数               | 消费方                                                       | 评估                         |
| --------------- | -------------------- | ------------------------------------------------------------ | ---------------------------- |
| `invocation/`   | 1 framework + dag    | playground + social（**2 家**）                              | ✅ 合理抽象（2 家说服力 OK） |
| `dispatcher/`   | 1 framework          | playground + social + radar（**3 家**，但 radar 死继承）     | ⚠️ 命中 3 但 1 家绕开 bridge |
| `bindings/`     | 1 framework          | playground（**1 家**）                                       | ❌ 单消费方，违反 YAGNI      |
| `state/`        | 1 framework          | playground（**1 家**）                                       | ❌ 单消费方                  |
| `span/`         | 1 framework          | playground（**1 家**）                                       | ❌ 单消费方                  |
| `events/`       | 1 framework          | playground + social + radar（**3 家**）                      | ✅ 合理                      |
| `lifecycle/`    | 7 framework + shell  | shell 三家用；**7 个 helper framework 全部 playground 独占** | ❌ 7-of-8 单消费方           |
| `orchestrator/` | 1 framework          | playground + social + radar（**3 家**）                      | ✅ 合理                      |
| `rerun/`        | 5 framework + 1 pure | **全部 playground 独占**                                     | ❌ 单消费方                  |
| `helpers/`      | 3 helper             | **agent-playground 独占**（仅 supply-budget 1 项）           | ❌ 单消费方                  |
| `abstractions/` | 4 interface          | 接口层，OK                                                   | ✅                           |

**致命问题：文档与现实背离**

`docs/architecture/ai-app/agent-app-mass-migration-roadmap-2026-05-24.md` §6 "Wave 1 P4 重新评估" 写：

> 实地 grep 显示 P4 列出的 8 个 T2 helpers ... **仅存在于 playground 一家**，social / radar 没有等价物。把它们下沉到 harness 等于 **为单一消费方做框架**，违反 Karpathy "3 处使用再考虑抽象" 原则。
>
> **结论**：Wave 1 P4-P7 不是"3 teams 共同瘦身"，而是"playground 单家提取"。等真有第二家需要时再做。

但 `git log` 显示：

- `54b4152d0 feat(ai-harness): 下沉 T2 通用 helpers(P4)`
- `2e4b4d851 feat(ai-harness): 下沉 T3 rerun framework(P5,5 frameworks + dummy mock spec)`
- `8947b1e3b feat(ai-harness): 下沉 T4 lifecycle framework(P6,7 frameworks + FakeMars spec)`
- `5853ad6d1 feat(ai-harness): 下沉 BusinessTeamOrchestrator skeleton(P7,3 家迁)`

P4 / P5 / P6 / P7 **全部已落地**。其中 P7 (orchestrator) 三家都用，是合规的；P4 / P5 / P6 是为单一消费方做框架，与自己写的"推迟"决策直接矛盾。

P6 lifecycle 7 framework：

```
business-team-checkpoint-store.framework.ts
business-team-event-buffer.framework.ts
business-team-lifecycle-transitions.framework.ts
business-team-mission-store.framework.ts
business-team-postmortem-helper.framework.ts
business-team-report-helper.framework.ts
business-team-update-helper.framework.ts
```

`grep -r "extends BusinessTeam(EventBuffer|LifecycleTransitions|Postmortem|Report|MissionStore|UpdateHelper|CheckpointStore)Framework" ai-app/`：**只命中 playground**。

P5 rerun 5 framework：

```
business-team-ctx-hydrator.framework.ts
business-team-rerun-guard.framework.ts
business-team-rerun-orchestrator.framework.ts
business-team-rerun-runtime-builder.framework.ts
business-team-stage-rerun-dispatcher.framework.ts
```

`grep -r "extends BusinessTeamRerun(Guard|Orchestrator|RuntimeBuilder|StageRerunDispatcher|CtxHydrator)Framework" ai-app/`：**只命中 playground**。

这是一个伪 framework——把"playground 内部分层"贴个 `framework.ts` 后缀放到 harness。

**怎么补救**：

A. **保留并接受存量负债**（最低成本，但留病根）：

- 在 SOP §3 / blueprint §8.1 表格里诚实标注每个 framework 的真实消费方数；
- 文档 §6 删掉"推迟"那句假话，改成"P4/P5/P6 已落地但暂只 1 消费方（playground），等 social/radar 实现 rerun + 完整 lifecycle 后回收双源"；
- 加 TODO：每个单消费方 framework 标 `@since-single-consumer 2026-05-24 promote-when=second-app-needs-rerun`。

B. **回滚 P4 / P5 / P6**（建议但工作量大）：

- 把 7+5+3 个 framework 类搬回 `ai-app/agent-playground/mission/lifecycle/`、`mission/rerun/`、`mission/services/helpers/`；
- 删 `business-team/{lifecycle,rerun,helpers}/` 里非 shell/orchestrator 文件；
- facade 同步去掉这些 export。

C. **在 framework 类上加 single-consumer 标记**（折衷）：

- 给每个单消费方 framework 加 `@deprecated single-consumer，第二消费方出现前不要新增 hook` JSDoc；
- 在 layout spec 加额外断言：单消费方 framework 文件名必须用 `*.scaffolding.ts` 后缀（不是 `*.framework.ts`），逼着新增 framework 时先证明 ≥2 消费方。

我推荐 **A + C 组合**——A 立刻能做（文档诚实），C 阻止未来"为单消费方做 framework" 复发。

### 2.2 `bridgeOrchestratorStageEvent` 多态点没匹配 radar

`business-team-mission-dispatcher.framework.ts:118-191` 实现的 `bridgeOrchestratorStageEvent`，签名假设业务方走"stage:lifecycle / stage:stalled / stage:degraded 三分"事件结构。

radar dispatcher 注释：

> radar 业务侧 stage 事件用 RADAR_EVENTS.RUN_STAGE 单一类型（非 `stage:lifecycle / stage:stalled / stage:degraded` 三分），故 framework bridge 不能直接用——radar 用自己的 handleOrchestratorEvent。但 emitToBus 通用 helper 仍受益继承。

radar 继承 `BusinessTeamMissionDispatcherFramework` 只为复用 `emitToBus` 一个方法（约 10 行）。配置里 `stageLifecycleEvent / stageStalledEvent / stageDegradedEvent` 三个字段全是占位符（"radar.stage:lifecycle" 等），从来不会被触发。

这是经典的"hook 签名假定了一种业务模式，第二消费方走不同模式时被迫绕开 hook"。framework 设计原则要求 hook 多态点要先对得起所有消费方。

**修法**：

- 把 `emitToBus` 拆到独立 `business-team-event-bus-adapter.ts`，让 radar 直接组合使用（不必继承）；
- `BusinessTeamMissionDispatcherFramework` 改成 mixin / 接口提供两种事件分发模式（三分 vs 单一），让 radar 显式选；
- 或者承认 radar 不该继承，dispatcher framework 改为 `playground + social` 二家专用，radar 走自己的轻量 dispatcher。

### 2.3 `state/` / `span/` 单消费方说明

这两个切片各只 1 framework class，且只有 playground 用。但与 lifecycle/rerun/helpers 不同的是——**它们的设计意图明显是"等 social/radar 第二消费方"**，单文件、抽象薄、API 小（state 是 typed wrapper，span 是 OTel tracking）。可接受为"轻量预留"，但应该在 README 写明"单消费方，第二家用时审视 hook 签名"。

### 2.4 `dispatcher/` / `bindings/` 单消费方说明

`bindings/business-team-stage-bindings.framework.ts` 是 46 行薄骨架（README 自己写"几乎没业务团队专属字段在 framework 层"）。这种"基类 + 一个 protected logger"的 framework 在 1 消费方时是负价值——直接在 playground 写一个 service 一样。

**结论**：§8.1 切片粒度方向对（11 个全是业界标准词，符合 MECE 11 顶层聚合精神），但有 **3 个切片（lifecycle helpers / rerun / bindings）属于"为单消费方做框架"**，建议按 §2.1 的 A+C 治理。

**评分 §8.1 framework 粒度**：6.5/10。粒度对、命名好，但 47% framework 文件单消费方违反自家 YAGNI 原则。

---

## 3. Framework vs business 边界（hook 接口设计）

### 3.1 invoker hook 接口（最干净）

`business-team-agent-invoker.interface.ts` 是这次 framework 化里设计最干净的接口：

```typescript
interface BusinessTeamAgentInvokerHooks<TSpec, TInput, TResult> {
  invokeOnce(spec, input, ctx): Promise<TResult>; // 必填
  onAgentEvent?(event, ctx): Promise<void>; // 可选
  onAgentStart?(ctx): void; // 可选
  onAgentEnd?(ctx, status, err?): void; // 可选
  onRetry?(ctx, attempt, err, delayMs): void; // 可选
  onDegrade?(ctx, err, info): Promise<void>; // 可选
}
```

满足"换 business 不影响 framework"的几个标志：

- 必填 hook 只有 1 个（`invokeOnce`），其余全 optional + 有 default
- TSpec / TInput / TResult 用泛型逃逸业务类型，不在 framework 里假设业务 schema
- `BusinessTeamInvocationContext` 是 framework 已知的最小集（missionId / userId / agentId / role），不强迫业务侧塞 framework 不需要的字段

这个接口是其他 framework 应该模仿的标杆。

### 3.2 dispatcher hook 接口（设计有缺陷）

`business-team-mission-dispatcher.framework.ts:54-68` 的 config：

```typescript
interface BusinessTeamMissionDispatcherConfig {
  namespace: string;
  stageLifecycleEvent: string;
  stageStalledEvent: string;
  stageDegradedEvent: string;
  mapStepId?: MapStepIdHook;
}
```

3 个 stage event type 字符串是必填——但 radar 不走三分事件结构，对 radar 是 dead config。这是 hook 签名假定业务模式的反例（见 §2.2）。

**修法**：把 `stage*Event` 三字段改成 optional + framework 在 `bridgeOrchestratorStageEvent` 入口先检查 `config.stageLifecycleEvent != null` 再 emit；或者把三分事件桥接逻辑改成独立的 mixin/decorator，让 radar 不继承时无 dead config。

### 3.3 orchestrator framework hook

`business-team-orchestrator.framework.ts` 抽象方法是 `resolveStageRunner(stepId)`、`adaptRunnerToHooks(runner, stepId, primitive)`、`getStageNumber(stepId)`——业务方填表 + 提供默认 adapter。这个设计 OK，因为 3 家都用，并且业务方可以 override `adaptRunnerToHooks` 应对 "leader-plan 同时 runRole + extractPlanFields" 这种多 hook 场景。

但**有一个隐忧**：`adaptRunnerToHooks` 默认实现做"primitive → hook key" 映射（plan→runRole / persist→persist / ...），这相当于把"orchestrator primitive ↔ business hook 命名"耦合写进 framework。任何业务方新增非标准 primitive 都得 override。这是个潜在的 boundary leak。

### 3.4 bindings framework hook

`business-team-stage-bindings.framework.ts:30-44` 只有两个抽象方法：`buildCtx(args): TCtx` + `buildDeps(): TDeps`。

这个抽象在 1 消费方时几乎零价值——业务侧实际上写的是：

```typescript
export class MissionStageBindingsService extends BusinessTeamStageBindingsFramework<CtxArgs, MyCtx, MyDeps> {
  buildCtx(args) { return { ... }; }
  buildDeps() { return { ... }; }
}
```

framework 提供的只是 logger 和一个 marker class。这种 framework 没有节省任何代码，只是让 reviewer 知道"这是个 stage bindings"。**反对意见**：这种 marker class 应该用 TypeScript interface + decorator 实现，不应该用继承——继承会带来"未来 framework 加字段所有子类都受影响"的扩散性风险。

**建议**：bindings/ 不必继承 framework class，改成 implements `BusinessTeamStageBindings` interface 即可。framework class 可以删（约 46 行）。

### 3.5 综合评估

| 接口            | 必填 hook  | 可选 hook | 设计质量 | 备注                                                |
| --------------- | ---------- | --------- | -------- | --------------------------------------------------- |
| invoker         | 1          | 5         | A        | 标杆                                                |
| orchestrator    | 1 + 1 隐式 | 1 默认    | B        | adaptRunnerToHooks 默认实现耦合 primitive↔hook 命名 |
| dispatcher      | 4 字段     | 1 hook    | C        | 三 stage event 字段对 radar 是 dead config          |
| bindings        | 2          | 0         | D        | 1 消费方零价值，应该改 interface                    |
| state           | 0          | 0         | C        | typed wrapper，1 消费方                             |
| span            | 0          | 0         | C        | 1 消费方                                            |
| rerun (5个)     | -          | -         | F        | 1 消费方，全部 framework 化越权                     |
| lifecycle (7个) | -          | -         | F        | 1 消费方，全部 framework 化越权                     |

**评分 framework vs business 边界**：6/10。invoker 是标杆，orchestrator/state/span 可接受，dispatcher 有真实多态点缺陷，bindings/lifecycle/rerun framework 化决策错误。

---

## 4. 未来扩展性（新 agent team app 的接入成本）

### 4.1 SOP §5 的"新建 agent team app 检查清单" 13 步是否完整

逐项审核：

| 步骤                                                    | 评估                                                                                                                                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. 目录骨架                                             | ✅ 直接对应 §8.2，机械化                                                                                                                                                |
| 2. pipeline 配置                                        | ✅ `defineMissionPipeline()` API 清晰                                                                                                                                   |
| 3. 运行时 tuning                                        | ✅ Zod schema 套路化                                                                                                                                                    |
| 4. stage 实现                                           | ✅ "一个 step 一个文件" 是好规范                                                                                                                                        |
| 5. agents (SKILL.md)                                    | ⚠️ 但 SOP 没写 `agents/<role>/` vs `skills/<skill-id>/` 双源怎么选                                                                                                      |
| 6. dispatcher / orchestrator / runtime-shell / bindings | ⚠️ "继承 framework 类"——但要继承的 4 个 framework 中 bindings 是 1 消费方 framework，新人不知该继承还是该绕开                                                           |
| 7. lifecycle                                            | ❌ SOP 没说要不要继承 `BusinessTeamMissionStoreFramework` 等 7 个 lifecycle framework。新人会去看 playground 然后照抄 7 层继承——这就是"copy-paste playground"的复发路径 |
| 8. events schema                                        | ✅                                                                                                                                                                      |
| 9. liveness adapter                                     | ✅ conformance spec 拦                                                                                                                                                  |
| 10. config snapshot                                     | ⚠️ conformance spec 用 string match 而非 contract（见 §0 第 4 条）                                                                                                      |
| 11. app.module.ts 集成                                  | ✅                                                                                                                                                                      |
| 12. MISSION_APP_MODULES 登记                            | ✅                                                                                                                                                                      |
| 13. 跑全套验证                                          | ✅                                                                                                                                                                      |

**主要风险：步骤 6/7 没说清"哪些 framework 必继承、哪些是 playground-only"**

新人按 SOP §3 表格会去继承全部 7 个 component（包括 bindings 这个 1 消费方 framework）和后续被诱导继承 7 个 lifecycle framework。两年后 SOP 维护者会发现"为什么所有 mission app 都长得像 playground"——因为 SOP 推荐他们继承 playground-only framework。

**修法**：

- SOP §3 表格加一列 "推荐继承度"（必继承 / 可继承 / 仅当业务有 X 场景时继承 / 不要继承）；
- SOP §5 步骤 6/7 拆分成"骨干 framework 继承（dispatcher / orchestrator / runtime-shell / invoker）" + "可选 framework 继承（bindings / state / span）" + "playground-only framework 不要继承（lifecycle 7 个 / rerun 5 个）"。

### 4.2 Wave 1 P4-P7 推迟判断（roadmap §6）

文档原文：

> 实地 grep 显示 P4 列出的 8 个 T2 helpers ... 仅存在于 playground 一家。**结论**：Wave 1 P4-P7 不是"3 teams 共同瘦身"，而是"playground 单家提取"。等真有第二家需要时再做。

这判断 100% 对，但**事实是 P4-P7 已经做了**（commit `54b4152d0` / `2e4b4d851` / `8947b1e3b` / `5853ad6d1`）。这是文档说谎，不是判断错误。

实际 git 历史的可能解读：

1. P4-P7 在写"推迟"决策之前就完成了，但文档没回填；
2. "推迟"是事后理性化（先做了 P4-P7，后写文档说"不做"以掩盖过度抽象）。

无论哪种，文档与现实不一致是治理问题。

**修法**：

- 立刻更新 roadmap §6：诚实写 "P4/P5/P6 已落地（commit X/Y/Z），但目前仅 playground 消费。决策回顾：当时为了让 P9b reorg 不带 god class 进新目录而连带做了 framework 化；后续第二消费方出现前不许新增 hook。"
- 加 ADR-XXX：framework 决策回顾——为什么 P4/P5/P6 落地了但不应该作为模板。

### 4.3 三家 app 的瘦身实测

roadmap 列出的 "capability sink summary"：

| Capability          | Before | After | Sunk to harness |
| ------------------- | ------ | ----- | --------------- |
| agent-invoker       | 280    | 241   | 155 + 83        |
| pipeline-dispatcher | 1216   | 1136  | 192 + 38        |
| stage-bindings      | 180    | 187   | 46 + 46         |
| cross-stage-state   | 186    | 177   | 81              |
| mission-span        | 150    | 29    | 178             |
| execution-support   | 159    | 72    | 140             |
| event-relay         | 25     | -     | shim            |

- **真省了的**：mission-span (150→29，-121)、execution-support (159→72，-87)。这两项是真有价值的下沉。
- **微省的**：agent-invoker (-39)、pipeline-dispatcher (-80)、cross-stage-state (-9)。投入产出比一般。
- **反而增加的**：stage-bindings (180→187，**净增 7 行**)。这个 framework 不仅没省，还让 playground 多写了 7 行 boilerplate。这是 §2.1 §3.4 主要论据。

### 4.4 真接入新 app 的成本

按 SOP 走，新 mission-pipeline app 的最小可用骨架（不考虑业务实现）：

```
module/<team>.module.ts                 ~150 行（仿 radar/agent-playground 装配）
api/controller/<team>.controller.ts     ~50 行
api/dto/run-mission.dto.ts              ~30 行
runtime/<team>.config.ts                ~50 行（defineMissionPipeline）
runtime/<team>-runtime.config.ts        ~30 行（Zod tuning）
mission/pipeline/<team>-pipeline-dispatcher.service.ts  ~400 行
mission/pipeline/<team>-business-orchestrator.service.ts  ~150 行
mission/pipeline/<team>-mission-runtime-shell.service.ts  ~120 行
mission/pipeline/stages/*.stage.ts      ~80 行/stage × N
mission/agents/<role>/{role}.agent.ts   ~80 行/role × N
mission/agents/<role>/SKILL.md
mission/lifecycle/<team>-mission-store.service.ts  ~200 行
events/<team>.events.ts                 ~30 行
```

骨架成本：**~1200-1500 行 + N stage + N role**。这相对于 playground 113 文件确实瘦身了很多——主要是省掉了 lifecycle 7 helper 和 rerun 5 framework 这些 playground-only 包袱。**前提是新 app 不去继承这些 framework**——SOP 必须明确禁止（见 §4.1）。

**评分 未来扩展性**：7/10。骨架明确、复用清楚；但"哪些不该继承"指引缺失，新 app 会被 SOP 引导成"playground 复制版"，回到 framework 想救的坑。

---

## 5. 三层看护栏强度

### 5.1 ESLint `no-restricted-imports` SECTION 10

`backend/.eslintrc.js:382-409`：

```js
{
  group: [
    "**/ai-harness/agents/**",
    "**/ai-harness/runner/**",
    "**/ai-harness/teams/**",
    ...
    "**/ai-harness/lifecycle/**",
  ],
  message: "Access AI Harness internals only through 'ai-harness/facade'. ...",
}
```

- ✅ 覆盖 `ai-harness/teams/**`，包括 `teams/business-team/**`
- ✅ IDE 实时 + lint-staged pre-commit
- ❌ **不查动态 `import()`**——ESLint `no-restricted-imports` 只查静态 import
- ❌ **不查注释 escape**（`// eslint-disable-next-line`、`/* eslint-disable */`）

这两个漏洞是已知的，spec 那层就是补这个。

### 5.2 `agent-team-facade-contract.spec.ts`（12 tests）

`extractImportTargets`（line 53-65）用正则：

```js
const re = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;
```

- ✅ 抓静态 `import ... from "..."`
- ✅ 抓动态 `import("...")` —— 补 ESLint 缺口
- ✅ 抓 `require("...")` —— 补 commonjs 缺口
- ✅ 先 `replace(/\/\*[\s\S]*?\*\//g, "")` 去掉块注释，再 `replace(/^\s*\/\/.*$/gm, "")` 去掉行注释 —— 补"注释 escape"

但发现一个**字符串拼接 import 的盲点**：

```typescript
// 这样 spec 抓不到
const path = "ai-harness/" + "teams/business-team/dispatcher";
const mod = await import(path);

// 也抓不到
const mod = await import(`ai-harness/teams/business-team/${component}`);
```

字符串模板 / 拼接 spec 没盖。ESLint 也不查。这是一个 100% 真实的逃逸通道（虽然 grep 现有代码没看到有人这么用）。**严重度低**——但应该在 spec 注释里写明"模板字符串 / 字符串拼接 import 不在 spec 拦截范围，code review 自查"。

第二个真实问题：spec 只查 `mission/pipeline/**` 和 `mission/lifecycle/**`。

```js
const pipelineDir = path.join(APP_ROOT, app, "mission", "pipeline");
const lifecycleDir = path.join(APP_ROOT, app, "mission", "lifecycle");
```

`mission/agents/`、`mission/roles/`、`mission/context/`、`mission/services/`、`api/controller/` 都不查 facade 收口。

这一定会被逃逸：playground 的 `mission/roles/agent-invoker.service.ts` 已经走 `@/modules/ai-harness/facade` 没问题，但 future agent team app 在 `mission/roles/` 写直接路径 import，spec 不会拦。

**修法**：spec 扩展到全 `mission/**` + `api/**`，或者直接锁全 app（只放过 `*.module.ts`）。

### 5.3 `agent-team-layout.spec.ts`（43 tests）

逐项审核：

- ✅ `dirs.filter(d => !ALLOWED_TOP_DIRS.has(d))` — 顶层目录白名单严格
- ✅ `files.filter(f => f.endsWith(".ts"))` — 根目录禁直接放 .ts
- ✅ `forbidden.includes(d)` — services/controllers/dto/agents/utils 黑名单
- ✅ `REQUIRED_MISSION_SUBDIRS` (pipeline/agents/lifecycle) 必备

**问题**：spec 没查 §8.2 的"runtime/ 内容性质"（见 §1.1）。social/runtime/ 塞 publish-queue / session-manager 等 stateful service spec 放过。

**修法**：layout spec 加一条：

```typescript
it.each(AGENT_TEAM_APPS)(
  "%s runtime/ 只放 *.config.ts / *.constants.ts / *.gateway.ts / *.tuning-profile.ts / *.adapter.ts",
  (app) => {
    const runtimeDir = path.join(APP_ROOT, app, "runtime");
    const files = listDirEntries(runtimeDir).files;
    const offending = files.filter(
      (f) =>
        !/\.(config|constants|gateway|tuning-profile|adapter|event-relay|input-rebuilder|snapshot)\.ts$/.test(
          f,
        ),
    );
    expect(offending).toEqual([]);
  },
);
```

但这会立刻让 social 红——所以要么先 baseline allowlist（一次例外，让旧违规留痕但禁新增），要么先 PR 把 social runtime 净化。

### 5.4 `mission-app-conformance.spec.ts` 的 string-match 缺陷

```typescript
const MISSION_APP_SHELLS: Array<[string, RegExp]> = [
  [
    "agent-playground/mission/pipeline/mission-runtime-shell.service.ts",
    /buildForFreshRun|configSnapshot/,
  ],
  [
    "radar/mission/pipeline/radar-mission-runtime-shell.service.ts",
    /buildRadarConfigSnapshot|configSnapshot/,
  ],
  [
    "social/mission/pipeline/social-runtime-shell.service.ts",
    /buildSocialConfigSnapshot|configSnapshot/,
  ],
];
```

每家函数名不同（`buildForFreshRun` vs `buildRadarConfigSnapshot` vs `buildSocialConfigSnapshot`）——spec 用 regex 匹配字符串。

**真实问题**：

1. 这不是 contract 测试，是 grep 测试。playground 把 `buildForFreshRun` 改名成 `freshConfigBuild` 就假绿（如果 `configSnapshot` 不在 file 里出现）。
2. 字符串巧合：spec 命名为 "config snapshot 冻结契约"，但断言只是"出现这个字符串"——`// configSnapshot used here` 注释也能通过断言。

**修法**：把 config snapshot 改成 framework-level contract——`MissionRuntimeShellFramework.openSession()` 返回类型中加 `configSnapshot: TypedConfigSnapshot` 字段，TypeScript 类型系统强制每家实现。然后 spec 改成"实例化 shell.openSession()，验证返回对象 typeof configSnapshot === 'object'"，跑真实代码。

### 5.5 pre-push hook

`.husky/pre-push` 第 `[0/6]` 步跑 `npx jest src/__tests__/architecture`：

- ✅ 全量跑 24 suites/228 tests，违规拒推
- ✅ `god-class size guard`（[0a/6]）+2500 行容差防大类回归
- ✅ frontend 目录结构看护（[0c/6]）

**漏洞**：用户可以 `git push --no-verify` 跳过。这是 git 本身机制，不是 hook 的锅，但 CI（如果有）应该二次执行 architecture spec 兜底——CLAUDE.md 说"CI 二次执行"，但我没在仓库找到 `.github/workflows/` 或 Railway CI 配置确认这点。需要追问 CI 是否真的 run `verify:arch`。

### 5.6 综合

**评分 三层看护栏**：8/10。三层结构对，覆盖动态 import / 注释 escape 等已知逃逸；但有 3 个真实漏洞：

- 字符串拼接 import（盲点，未来风险）
- spec 只查 `mission/pipeline` + `mission/lifecycle`，没覆盖 `mission/agents` / `mission/roles` / `mission/services` / `api/` （现存逃逸路径）
- runtime/ 内容性质未锁（social 已违例）

---

## 6. 综合评分与 Issue 清单

### 6.1 维度评分

| 维度                            | 评分       | 一句话                                                   |
| ------------------------------- | ---------- | -------------------------------------------------------- |
| §8.2 顶层布局                   | 8/10       | 骨架对，runtime/ 语义没锁死                              |
| §8.1 framework 切片粒度         | 6.5/10     | 47% framework 文件单消费方违反 YAGNI                     |
| framework vs business 边界 hook | 6/10       | invoker 是标杆，dispatcher 有 dead config，bindings 该删 |
| 未来扩展性（新 app 接入）       | 7/10       | 骨架明确，但 SOP 没说"哪些 framework 不该继承"           |
| 三层看护栏                      | 8/10       | 拦了动态/注释，但 spec 覆盖范围 + runtime/ 内容不全      |
| **综合**                        | **7.5/10** | 方向对、落地匀，但 framework 自己踩了它要救的坑          |

### 6.2 P0/P1/P2 Issue 清单

**P0（必须修，否则 framework 治理失效）**

1. **文档与现实不一致：roadmap §6 谎称 P4-P7 推迟，git 显示已落地**
   - 文件：`docs/architecture/ai-app/agent-app-mass-migration-roadmap-2026-05-24.md`
   - 修：立刻回填真实状态 + 写 ADR 解释为什么 P4/P5/P6 落地但当时不应该作为模板
   - 工作量：1h

2. **`bindings/business-team-stage-bindings.framework.ts` 单消费方，零节省价值**
   - 文件：`backend/src/modules/ai-harness/teams/business-team/bindings/`
   - 修：删 framework class，改 `BusinessTeamStageBindings` 为 interface，playground bindings 改 implements 不 extends
   - 工作量：2h
   - 影响：playground 1 文件 + 1 spec 改动，无业务行为变化

3. **`mission-app-conformance.spec.ts` config snapshot string-match 假断言**
   - 文件：`backend/src/__tests__/architecture/mission-app-conformance.spec.ts:43-66`
   - 修：把 config snapshot 提升为 framework-level 返回类型契约，spec 改成跑真实 `openSession()` 检查返回结构
   - 工作量：4h（涉及三家 runtime-shell 接口对齐）

**P1（强烈建议，影响长期治理）**

4. **`dispatcher` framework hook 不匹配 radar，造成 dead config**
   - 文件：`backend/src/modules/ai-harness/teams/business-team/dispatcher/business-team-mission-dispatcher.framework.ts`
   - 修：把 `bridgeOrchestratorStageEvent` 拆成独立 mixin / decorator，让 radar 不继承 framework 时也能用 `emitToBus`；或承认三分事件结构是 playground+social 专用，radar 走轻量 dispatcher
   - 工作量：6h

5. **§8.2 runtime/ 内容性质未锁死，social runtime/ 已经塞了 stateful service**
   - 文件：`backend/src/__tests__/architecture/agent-team-layout.spec.ts` + `ai-app/social/runtime/`
   - 修：layout spec 加 "runtime/ 只允许 X 类文件" 断言；先 baseline 留痕 social 现有违规，禁新增；分独立 PR 把 publish-queue / session-manager 搬到 mission/services/ 或 integrations/
   - 工作量：8h（spec 1h + social runtime 净化 7h）

6. **facade contract spec 覆盖范围只在 `mission/pipeline` + `mission/lifecycle`**
   - 文件：`backend/src/__tests__/architecture/agent-team-facade-contract.spec.ts:103-167`
   - 修：扩到全 `mission/**` + `api/**`，只放过 `*.module.ts`
   - 工作量：2h

7. **SOP §3 / §5 没说"哪些 framework 不该继承"，新 app 会复制 playground 全部包袱**
   - 文件：`.claude/standards/23-business-team-framework-usage.md`
   - 修：表格加"推荐继承度"列，明确标注 lifecycle 7 个 + rerun 5 个 framework 是 playground-only 不要继承
   - 工作量：1h

**P2（可选优化，长期价值）**

8. **`agents/<role>/` vs `roles/` 双源 + `skills/<skill-id>/` vs `agents/<role>/SKILL.md` 双源**
   - 文件：SOP §2.1
   - 修：SOP 文字明确 agents/ 是 "agent-level"、skills/ 是 "task-level"、roles/ 是 "NestJS wrapper"
   - 工作量：1h

9. **bindings 这类单消费方 framework 加 `@since-single-consumer` JSDoc 标记 + lint 阻止新增**
   - 文件：lifecycle/rerun 下 12 个 framework class
   - 修：所有单消费方 framework 加 `@deprecated single-consumer-do-not-add-hook`；ESLint rule 禁止新增 `*.framework.ts` 文件除非显式 allowlist
   - 工作量：4h

10. **字符串拼接 / 模板字符串 import 是 facade contract spec 盲点**
    - 文件：`agent-team-facade-contract.spec.ts`
    - 修：spec 注释明文标注盲点；future 如果发现真实逃逸再加 AST-based check
    - 工作量：0.5h（仅注释）

11. **CI 是否二次跑 architecture spec 未确认**
    - 文件：`.github/workflows/` 或 Railway CI 配置
    - 修：核查 CI 配置确保 `verify:arch` 在远程二次执行；如果没有则补
    - 工作量：1h（确认）+ 1h（如缺则补）

### 6.3 是否合理的最后判断

**§8.2 顶层布局**：方向合理。把 module/api/runtime/mission/events 切开，对应 NestJS 装配 / HTTP 边界 / 运行时配置 / mission 业务 / 事件 schema 这 5 个真实关注点。但 runtime/ 必须收紧到 "config + constants + gateway + adapter + event-relay" 5 类后缀，不然必然变成"剩余物桶"。

**§8.1 framework 切片**：方向合理但执行越权。invocation / dispatcher / orchestrator / events / state / span / abstractions 7 个切片有真实多消费方（≥2）或合理预留，OK。lifecycle 多余 6 个 framework + rerun 5 个 + helpers 3 个 + bindings 1 个，**全是为单消费方做的伪 framework**。承认它们是"playground 内部模块化"，不是"通用 framework"，治理上让 SOP 别推荐继承即可。

**Framework hook 边界**：invoker 是标杆，其他可以模仿。dispatcher 的 stage event 三分结构是命中 2/3 消费方的 hook 假设，radar 被迫绕开是真实信号——framework 设计要 fit 全部消费方或者承认只服务部分。

**三层看护栏**：结构对，覆盖大头。3 个盲点（字符串拼接 import / spec 覆盖范围 / runtime/ 内容性质）都属于"已知漏洞"，迭代 1-2 次能补全。

**整体落地节奏**：Wave 1b（P9b/P10/P11）目录 reorg + Wave 4（P21-P24）三层看护是对的——先把目录骨架锁死再加守护。但 framework 抽取（P4/P5/P6/P7）和 reorg/守护是同期做的，不是按"先抽真共享、再 reorg、再守护"分波次走，所以单消费方 framework 趁机搭车进了 harness。下次类似项目建议：framework 抽取要先验证 ≥2 消费方在 ai-app 同时演示用例，再让它进 harness。

---

## 7. 读过的文件清单（架构师评估必须列出依据）

实际读过：

1. `docs/architecture/ai-app/agent-playground/agent-playground-target-boundary-and-directory-blueprint-2026-05-24.md`（全文）
2. `docs/architecture/ai-app/agent-app-mass-migration-roadmap-2026-05-24.md`（全文）
3. `.claude/standards/23-business-team-framework-usage.md`（全文）
4. `backend/src/__tests__/architecture/agent-team-layout.spec.ts`（全文）
5. `backend/src/__tests__/architecture/agent-team-facade-contract.spec.ts`（全文）
6. `backend/src/__tests__/architecture/mission-app-conformance.spec.ts`（全文）
7. `backend/src/modules/ai-harness/teams/business-team/README.md`（全文）
8. `backend/src/modules/ai-harness/teams/business-team/invocation/business-team-agent-invoker.framework.ts`（全文）
9. `backend/src/modules/ai-harness/teams/business-team/invocation/abstractions/business-team-agent-invoker.interface.ts`（全文）
10. `backend/src/modules/ai-harness/teams/business-team/dispatcher/business-team-mission-dispatcher.framework.ts`（全文）
11. `backend/src/modules/ai-harness/teams/business-team/bindings/business-team-stage-bindings.framework.ts`（全文）
12. `backend/src/modules/ai-harness/teams/business-team/orchestrator/business-team-orchestrator.framework.ts`（前 80 行）
13. `backend/src/modules/ai-harness/teams/business-team/state/business-team-cross-stage-state.framework.ts`（前 30 行）
14. `backend/src/modules/ai-app/agent-playground/mission/pipeline/playground.pipeline.ts`（前 50 行）
15. `backend/src/modules/ai-app/agent-playground/mission/roles/agent-invoker.service.ts`（前 80 行）
16. `backend/src/modules/ai-app/agent-playground/module/agent-playground.module.ts`（前 120 行）
17. `backend/src/modules/ai-app/radar/mission/pipeline/radar-pipeline-dispatcher.service.ts`（line 100-220）
18. `backend/src/modules/ai-app/social/runtime/index.ts`（全文）
19. `backend/.eslintrc.js`（line 370-485，SECTION 10 + ai-engine 反向 import 禁令）
20. `.husky/pre-push`（全文）

辅助 grep（不是 read 但是数据来源）：

- 三家 mission/ 子目录列表 / runtime/ 子目录列表 / pipeline/ 文件列表
- `extends BusinessTeam*Framework` 跨 ai-app 的所有命中
- git log 在 `backend/src/modules/ai-harness/teams/business-team/` 上的全部 commit

不评分项（没读过的，不发表意见）：

- frontend canonical mission shell（P25/P26/P27）—— 不在我审查范围
- `business-team/{rerun,helpers,lifecycle}/` 7+5+3 framework class 的具体实现细节（只看了文件存在性 + 消费方 grep，没逐文件 read）—— 评分基于消费方计数，没基于实现质量

---

**最后说一句**：这一轮 Wave 1b + Wave 4 的工作落地质量在过去半年的架构改动里是上游 1/3 的——目录有 SOP、看护有三层、framework 有真实多消费方（4 个）。主要的问题不是"做得不够"，而是"做过头"（lifecycle / rerun / helpers 不该 framework 化）和"文档不诚实"（roadmap §6 谎称 P4-P7 推迟）。这两点修了就是 8.5/10。
