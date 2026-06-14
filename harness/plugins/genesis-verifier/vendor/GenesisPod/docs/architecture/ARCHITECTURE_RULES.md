# GenesisPod 架构规则总表

> **目的**：固化当前架构，让系统只能变好，不能变差。
>
> **状态**：v1.0 — 2026-05-27 首版定型。
>
> **变更**：任何架构例外必须登记到 [EXCEPTIONS.md](./EXCEPTIONS.md)。规则本身的修改必须经 ADR。

---

## 适用范围

本规则约束以下三层 + frontend：

| 层              | 路径                                                        | 角色                              |
| --------------- | ----------------------------------------------------------- | --------------------------------- |
| L4 Open API     | `backend/src/modules/open-api/`                             | 对外接口                          |
| L3 AI App       | `backend/src/modules/ai-app/{playground,social,radar,...}/` | 业务应用                          |
| L2.5 AI Harness | `backend/src/modules/ai-harness/`                           | Agent runtime 内核（机制层）      |
| L2 AI Engine    | `backend/src/modules/ai-engine/`                            | LLM / Tools / RAG 等能力          |
| L1 Platform     | `backend/src/modules/platform/`（旧称 ai-infra）            | Credits / Storage / Notifications |
| Frontend        | `frontend/`                                                 | Presentation only                 |

依赖方向严格 **L4 → L3 → L2.5 → L2 → L1**。

---

## 6 层规则

每层 4 项：**规则内容 / 机器检查 / 例外机制 / 收敛目标**。

---

### 第 1 层 · 拓扑规则（目录布局）

#### 1.1 规则内容

`ai-app/{mission-app}/` 顶层只允许：

```
api/  events/  integrations/  mission/  module/  runtime/  __tests__/
```

`ai-app/{mission-app}/mission/` 下只允许：

```
agents/  artifacts/  chat/  context/  dag-view/  export/  lifecycle/
pipeline/  projectors/  query/  rerun/  roles/  services/  skills/  types/
```

`ai-harness/teams/business-team/` 顶层只允许：

```
abstractions/  bindings/  dispatcher/  events/  helpers/  invocation/
lifecycle/  orchestrator/  rerun/  span/  state/
```

`ai-engine/` 顶层只允许 capability 桶：

```
content/  facade/  knowledge/  llm/  planning/  rag/  safety/  skills/  tools/
```

#### 1.2 机器检查

- `backend/src/__tests__/architecture/layer-3-authority/agent-team-layout.spec.ts` — ai-app/playground 顶层 + business-team 顶层断言
- 待补：`mission/` 子目录白名单 spec
- 待补：`ai-engine` 顶层白名单 spec

#### 1.3 例外机制

新增目录必须：

1. 在 EXCEPTIONS.md 登记
2. 附 ADR（`docs/architecture/decisions/`）说明动机 + 何时合并回主目录
3. 注明负责人 + 移除截止

#### 1.4 收敛目标

不再通过"临时加目录"解决设计问题。三个月内 EXCEPTIONS.md 列出的临时目录必须收口。

---

### 第 2 层 · 依赖方向规则

#### 2.1 规则内容

| 允许                                                                                         | 禁止                                                                                                                                                    |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai-app/**` → `ai-harness/**` 通过 `facade/`<br/>`ai-app/**` → `ai-engine/**` 通过 `facade/` | `ai-harness/**` → `ai-app/**`<br/>`ai-engine/**` → `ai-app/**`<br/>`ai-engine/**` → `ai-harness/**`（除合法 port adapter）<br/>`ai-infra/**` → 任何上层 |

**Frontend**：

| 允许                                                                       | 禁止                                           |
| -------------------------------------------------------------------------- | ---------------------------------------------- |
| 读 `GET /missions/:id/view` 作为 mission truth 唯一入口                    | 在 frontend 重新定义 mission truth             |
| `useMissionDetailView` (单 canonical entry)                                | 其它 hook 重建 truth                           |
| `useAgentPlaygroundStream` 提供 immediacy                                  | stream layer 承载 truth reconstruction         |
| events 派生（trace / cost.byStage 等 backend canonical view 不暴露的数据） | 重新派生 mission/stage/agent 等 canonical 字段 |

#### 2.2 机器检查

- `backend/src/__tests__/architecture/layer-boundaries.spec.ts` — 6 个依赖方向断言
- `backend/.eslintrc.js` — `no-restricted-imports` 多 file-level override（ai-app/ → engine facade only / engine ↛ harness 等）
- `frontend/.eslintrc.json` — `@typescript-eslint/no-restricted-imports` 拦截已删 helper（derive.ts / todo-ledger / synthesize-artifact）
- 待补：frontend canonical truth 单源 spec（grep 检查除 `useMissionDetailView` 外无其它 truth helper）

#### 2.3 例外机制

ESLint override 必须文档化到 EXCEPTIONS.md（当前 `useMissionLegacyView` 即隐性例外）。

#### 2.4 收敛目标

任何跨层耦合必须显式暴露为 port/facade，禁止直接 import 内部路径。

---

### 第 3 层 · Authority 规则（真相单源）

#### 3.1 规则内容

每类真相只能有一个 owner：

| 真相                                                 | Owner                                                |
| ---------------------------------------------------- | ---------------------------------------------------- |
| `mission.status`                                     | backend canonical view (`mission-view.projector.ts`) |
| `stage.status`                                       | backend canonical view                               |
| `agent.phase`                                        | backend canonical view                               |
| `todo` 列表与状态                                    | backend `<app>-todo-board.projector.ts`              |
| `artifact` v1→v2 normalize                           | backend `ArtifactComposerService`                    |
| `resumable / rerunnable` 策略                        | backend `BusinessTeamResumeRerunPolicyFramework`     |
| Token-by-token UX / retry flicker / agent trace 解析 | frontend presentation / stream layer                 |
| events 派生（trace / cost.byStage）                  | frontend hook，**不**进 canonical view               |

#### 3.2 机器检查

- `backend/src/__tests__/architecture/canonical-view-pattern.spec.ts` I1-I6
- `backend/src/modules/ai-app/playground/mission/projectors/__tests__/fixture-replay.spec.ts`
- 待补：projector 纯函数 AST check（不 import `*Service`，不发事件，不写库）
- 待补：replay-twice idempotency spec（对每个 fixture 跑 projector N 次，断言 deep-equal）

#### 3.3 例外机制

非 canonical 字段进 view（如 `MissionViewBaseAgent` extension 字段）必须：

1. 在 EXCEPTIONS.md 登记
2. 说明为什么不能从 events 派生
3. 标注是否 cross-app 收益

#### 3.4 收敛目标

不允许前后端共同定义同一份真相。frontend 只读 canonical / 派生 events，不构造 mission/stage/agent 等核心 truth。

---

### 第 4 层 · Vocabulary 规则

#### 4.1 规则内容

**Harness business-team kernel 禁词**（出现即污染）：

```
dimension  reportArtifact  chapterReview  radarCluster  socialPublish
leaderSignoff  leaderVerdict  themeSummary  reviewerVerdict
playground  agent-playground  social  radar  topic-insights
```

只允许在以下位置出现：

- `ai-harness/teams/business-team/bindings/` （app 接入点）
- `ai-harness/teams/business-team/__tests__/` （测试）
- 注释 / 文档字符串

**Engine production code 禁词**（出现即直接 fail）：

```
playground  social  radar  topic-insights  agent-playground
mission.status  rerunStage  leaderVerdict
chapterReview  reportArtifact  themeSummary
```

只允许在：

- `ai-engine/**/__tests__/`
- 注释 / 文档字符串

#### 4.2 机器检查

- 待补：`backend/src/__tests__/architecture/vocab-purity.spec.ts` — grep 检查 harness/engine production 源码

#### 4.3 例外机制

任何禁词出现在非测试 / 非注释位置 → CI fail。如果业务确有需要，必须改写为参数化（通过 `bindings/` 或 facade 接入）。

#### 4.4 收敛目标

harness 只讲机制，engine 只讲能力。

---

### 第 5 层 · Frontend 收口规则

#### 5.1 规则内容

**生产代码禁止 import 以下已删 / 待退休 helper**：

```
@/lib/features/agent-playground/derive.ts
@/lib/features/agent-playground/todo-ledger.ts
@/lib/features/agent-playground/synthesize-artifact.ts
@/lib/features/agent-playground/view-to-derived.shim.ts
```

**Drawer-derive 继续保留** 但只走 `*-shapes` 代理，且只做 UI-only 派生。

**Mission truth 唯一入口**：`useMissionDetailView`

**Stream layer 职责**：`useAgentPlaygroundStream` 只提供 immediacy（live token / live event），**不**重建 truth。

**空态规则**：页面没有 backend canonical data → 显示失败 / 空态 / loading，**不**前端自愈成另一套 truth。

#### 5.2 机器检查

- `frontend/.eslintrc.json` — restricted imports 已落
- 待补：`frontend/__tests__/protection-net/canonical-mission-truth.spec.ts` —— 全局 grep 检查 mission truth 只来自 `useMissionDetailView`

#### 5.3 例外机制

`useMissionLegacyView` 是当前最大隐性例外 → 登记到 EXCEPTIONS.md，明确：

- 保留原因：events 派生（trace / cost.byStage）不能从 canonical view 拿
- 收敛计划：拆为 `useEventDerivations`（只剩 events-only data）+ page.tsx 直读 `missionView.X`
- 移除截止：暂未定

#### 5.4 收敛目标

前端长期只剩 presentation helpers，不剩 truth helpers。

---

### 第 6 层 · Durability / Observability 规则

#### 6.1 规则内容

**Durability**：

- Checkpoint 写入点必须枚举（不允许散落随处保存）
- Replay 输入必须可重建 canonical view（idempotency invariant：projector(events) × N 次 = deep-equal）
- Rerun / resume 决策必须可追踪（每个决策点输出 trace）
- `viewVersion` / `snapshotVersion` / event seq 来源必须统一
- Terminal settlement 必须有协议（不允许随处手写终态修补）

**Observability**：

- 每次 rerun / resume 决策必须输出 trace
- Projector 输出必须可做 fixture replay diff
- Canonical view truth regression 必须可检测
- Mission timeline 必须覆盖：stage lifecycle / checkpoint / rerun / reopen / final settle

#### 6.2 机器检查

- `fixture-replay.spec.ts` 已存在，但缺：
  - replay-twice idempotency assertion
  - decision trace assertion
  - 14-stage lifecycle / checkpoint / rerun 覆盖率
- 已存在：`benchmark < 200ms` (projector perf)
- 待补：`event-types-coverage.spec.ts` —— 检查 backend emit 的所有事件类型都有 frontend / projector handler

#### 6.3 例外机制

事件类型增加 / 删除必须更新 contract spec。terminal sweep 类容灾代码必须有"原因 + 何时移除" 注释。

#### 6.4 收敛目标

系统不是"能跑"，而是"长期运行可恢复、可解释、可定位"。

---

## "8 条立刻硬规则"映射 spec 落地状态

| #   | 规则                                                          | spec 位置                                          | 状态    |
| --- | ------------------------------------------------------------- | -------------------------------------------------- | ------- |
| 1   | ai-app → harness → engine 单向                                | `layer-boundaries.spec.ts` + ESLint                | ✅      |
| 2   | business-team kernel 禁 app-specific 词汇                     | `vocab-purity.spec.ts`                             | ⏳ 待落 |
| 3   | ai-engine 禁 app-specific 词汇                                | `vocab-purity.spec.ts`                             | ⏳ 待落 |
| 4   | frontend 禁 import derive / todo-ledger / synthesize-artifact | `frontend/.eslintrc.json`                          | ✅      |
| 5   | canonical truth 只来自 `GET /missions/:id/view`               | `canonical-mission-truth.spec.ts`（待补完整 grep） | ⚠️ 半落 |
| 6   | projector 无副作用 / policy 不写 view                         | `projector-purity.spec.ts`                         | ⏳ 待落 |
| 7   | 新共享逻辑 < 2 app 复用，不准上提 harness                     | `harness-uplift-gate.spec.ts`                      | ⏳ 待落 |
| 8   | 所有架构例外必须登记                                          | `EXCEPTIONS.md` + audit spec                       | ⏳ 待落 |

---

## 收敛路线

### 阶段 1：冻结规则（本文档 + EXCEPTIONS.md + 关键 spec 补齐）

> 目标：从今天开始，架构不再继续变坏。

**交付物**：

- [x] `ARCHITECTURE_RULES.md`（本文档）
- [x] `EXCEPTIONS.md` — 登记当前所有隐性例外
- [ ] `vocab-purity.spec.ts` — 硬规则 2/3
- [ ] `canonical-mission-truth.spec.ts` — 硬规则 5
- [ ] `projector-purity.spec.ts` — 硬规则 6
- [ ] `harness-uplift-gate.spec.ts` — 硬规则 7
- [ ] CI 接入

### 阶段 2：按规则找现存例外

把所有不完全符合的地方列成 exception register，每条附：位置 / 暂时允许原因 / 负责人 / 移除截止 / 不移除的风险。

**典型例外（当前已知）**：

- `useMissionLegacyView` —— frontend 收口隐性例外
- `mission-presentation.types` —— legacy `DerivedView` shape 残留
- `drawer-derive` proxy —— UI-only 派生
- Terminal sweep（agent / chapter / todo）—— Durability 容灾
- `chapter-pipeline.helper.ts` sub-agent 不发 `emitLifecycle` —— 完整性容灾

目标：允许过渡，但不允许"永久临时"。

### 阶段 3：逐批收敛

按影响最大优先收，不要平均发力。建议顺序：

1. Frontend compatibility surface（useMissionLegacyView 拆分）
2. Harness kernel ports / boundaries（vocab purity）
3. Engine facade-only discipline
4. Durability kernel hardening（replay invariant）
5. Observability / diff / trace（decision trace）

---

## 引用文档

- `CLAUDE.md` —— 项目级 AI 助手规则（红线）
- `docs/architecture/ai-app/agent-playground/README.md` —— playground 守护机制
- `docs/architecture/ai-app/agent-playground/playground-dfx-assessment-2026-05-26.md` —— DFX 评估
- `docs/architecture/ai-app/agent-playground/playground-multi-review-coverage-2026-05-26.md` —— 多路检视
- `standards/16-ai-engine-harness-structure.md` —— 4 层 + L2.5 结构标准
- `EXCEPTIONS.md` —— 例外登记

---

**最后更新**：2026-05-27
**版本**：v1.0
**维护者**：架构组
