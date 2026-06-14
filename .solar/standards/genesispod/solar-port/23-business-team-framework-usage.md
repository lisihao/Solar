# Business-Team Framework 使用规范

**版本：** 1.1
**强制级别：** 🔴 MUST
**状态：** 已采纳
**日期：** 2026-05-24（1.1 增补 §2.1 最小骨架取舍 / §5.2 质量基线门禁 / §8 标杆依据，2026-05-29）

> **核心原则**：**新建 agent team app 必须基于 `ai-harness/teams/business-team/` framework + §8.2 目录布局；不允许 copy-paste playground 整个目录树作为模板。**
> 本文是创建新 agent team app（mission-pipeline 型）的唯一权威 SOP。

---

## 1. 适用范围

本规范覆盖以下情况：

- **创建新 mission-pipeline 型 agent team app**（如未来新增 `ai-app/<new-team>/`）
- **修改现有 3 个 agent team app 的结构**（`agent-playground` / `social` / `radar`）
- **修改 `ai-harness/teams/business-team/` framework**

不在范围：

- 非 mission-pipeline 型 app（如 `ai-app/research`、`ai-app/writing` 等纯调用型）
- engine/infra 层的能力下沉

---

## 2. §8.2 目录布局 (MUST)

每个 agent team app 必须严格遵守以下顶层目录布局：

```
ai-app/<team-name>/
├── module/         NestJS Module + onModuleInit 装配
│   └── <team>.module.ts
├── api/            HTTP 边界
│   ├── controller/   *.controller.ts
│   └── dto/          *.dto.ts
├── runtime/        运行时配置/常量/网关
│   ├── <team>.config.ts          mission pipeline 配置 (defineMissionPipeline)
│   ├── <team>-runtime.config.ts  Zod 校验的运行时 tuning
│   ├── <team>.constants.ts
│   └── <team>.gateway.ts         WebSocket gateway（如适用）
├── mission/        mission 运行时业务
│   ├── pipeline/   stages + dispatcher + orchestrator + bindings + runtime-shell
│   │   ├── stages/
│   │   ├── <team>-pipeline-dispatcher.service.ts
│   │   ├── <team>-business-orchestrator.service.ts
│   │   ├── <team>-mission-runtime-shell.service.ts
│   │   └── mission-stage-bindings.service.ts
│   ├── agents/     SKILL.md per role（每个 agent 一个目录）
│   │   ├── <role-1>/SKILL.md
│   │   └── <role-2>/SKILL.md
│   ├── lifecycle/  mission 持久化
│   │   ├── <team>-mission-store.service.ts
│   │   ├── <team>-mission-event-buffer.service.ts
│   │   └── <team>-mission-config-snapshot.ts
│   ├── services/   helper services (可选)
│   └── （per-app 可选）roles/ context/ skills/ artifacts/ types/ chat/ export/ rerun/
├── events/         DomainEventRegistry schema
│   └── <team>.events.ts
├── integrations/   外部平台适配（可选，如 wechat/xhs/sources）
└── __tests__/      per-team 单测（contract 测试归 `src/__tests__/architecture/`）
```

**禁止行为**：

- ❌ 根目录直接放 `.ts` 文件（必须落到 module/api/runtime/mission/events）
- ❌ 出现旧版顶层目录 `services/` `controllers/` `dto/` `agents/` `utils/`
- ❌ 缺少 `module/`、`api/`、`runtime/`、`mission/`、`events/` 任一顶层
- ❌ `mission/` 下缺少 `pipeline/`、`agents/`、`lifecycle/` 任一必备子目录

**自动看护**：`src/__tests__/architecture/agent-team-layout.spec.ts`（43 tests）—— 违规 jest 红 → pre-push 拒推。

### 2.1 最小骨架 vs 完整能力（按需取用，反过度抽象）

> **核心**：§2 列的是**结构白名单**，不是"每个新 app 都要建满"。新 app 应从**最小骨架**起步，按真实需要才长出可选能力。整包照搬 playground 全量目录 = 过度复杂（违反 CLAUDE.md「简洁优先 / YAGNI」）。

**MUST 子集（最小起步，参考 `radar`——6 个 `mission/` 子目录即可跑通）：**

| 层                | MUST 目录                                                                                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 顶层              | `module/` `api/` `runtime/` `mission/` `events/`                                                                                                                                 |
| `mission/`        | `pipeline/`（stages + dispatcher + business-orchestrator + runtime-shell）、`lifecycle/`（mission-store + event-buffer + config-snapshot）、`projectors/`、`query/`、`services/` |
| `mission/agents/` | 每个 role 一个 `<role>/SKILL.md`                                                                                                                                                 |

**可选能力（有真实需求才加，参考 `social` 9 子目录 / `playground` 全量）：**

| 可选目录                    | 何时才加                                        | 谁有                |
| --------------------------- | ----------------------------------------------- | ------------------- |
| `roles/`                    | role 逻辑超出 SKILL.md、需要 typed role service | social / playground |
| `context/`                  | 需要跨 stage 的上下文初始化 / 演进              | social / playground |
| `skills/`                   | app 自带 domain SKILL.md 目录（非 agent role）  | social / playground |
| `types/`                    | 公共类型超过单文件                              | social / playground |
| `chat/`                     | mission 内嵌 leader chat 交互                   | playground          |
| `dag-view/`                 | 需要 DAG 可视化端点                             | playground          |
| `export/`                   | 需要 CSV/JSON/MD 导出                           | playground          |
| `rerun/`                    | 需要单 stage 局部重跑                           | playground          |
| `calibration/` `artifacts/` | app 特有产物装配 / 标定                         | playground          |

**判据**：一个可选目录只为"将来可能用"而建 = 违规。**3 处使用再抽象**（CLAUDE.md 简洁原则）。radar 至今只用 6 子目录跑生产，是最小骨架的活样本。

---

## 3. 必须基于 `ai-harness/teams/business-team/` framework (MUST)

新 agent team app 的运行时骨架必须 **继承** 而不是 **复制** framework：

| 组件              | Framework 类（在 harness）                                | App 子类（在 ai-app）                                                      |
| ----------------- | --------------------------------------------------------- | -------------------------------------------------------------------------- |
| Agent 调用        | `BusinessTeamAgentInvoker.framework` (`invocation/`)      | `<Team>AgentInvoker extends BusinessTeamAgentInvoker.framework`            |
| Mission 派发      | `BusinessTeamMissionDispatcher.framework` (`dispatcher/`) | `<Team>PipelineDispatcher extends BusinessTeamMissionDispatcher.framework` |
| Stage 绑定        | `BusinessTeamStageBindings.framework` (`bindings/`)       | `<Team>StageBindings extends BusinessTeamStageBindings.framework`          |
| Cross-stage state | base class (`state/`)                                     | `<Team>CrossStageState extends ...`                                        |
| Mission span      | tracking helper (`span/`)                                 | 直接复用，无子类                                                           |
| Event relay       | shim pattern (`events/`)                                  | `<Team>EventRelay extends ...`                                             |
| Runtime shell     | `MissionRuntimeShellFramework` (`lifecycle/`)             | `<Team>MissionRuntimeShell extends ...`                                    |

**禁止行为**：

- ❌ Copy-paste playground/social/radar 整个 `mission/pipeline/` 目录作为新 app 起点
- ❌ 在 `ai-app/` 层重写已经在 `ai-harness/teams/business-team/` 提供的能力
- ❌ 不通过 framework subclass，而是直接 `import` framework 内部并 instantiate

**自动看护**：`src/__tests__/architecture/agent-team-facade-contract.spec.ts`（12 tests）—— `mission/{pipeline,lifecycle}/*.ts` 不得直接 `import` `ai-harness/teams/business-team/...`，必须走 `@/modules/ai-harness/facade`。

---

## 4. import 规则 (MUST)

`ai-app/<team>/**/*.ts` 跨层 import：

```typescript
// ✅ 正确：从 facade 拿 framework + service
import {
  defineMissionPipeline,
  MissionPipelineRegistry,
  MissionPipelineOrchestrator,
  BusinessTeamAgentInvoker,
  BusinessTeamMissionDispatcher,
  MissionLivenessGuard,
  MissionLifecycleManager,
  DomainEventRegistry,
} from "@/modules/ai-harness/facade";

import {
  SkillLoaderService,
  loadSkill,
  ToolRegistry,
} from "@/modules/ai-engine/facade";

// ❌ 错误：穿透内部子路径
import { BusinessTeamAgentInvoker } from "@/modules/ai-harness/teams/business-team/invocation/business-team-agent-invoker.framework";
import { ToolRegistry } from "@/modules/ai-engine/tools/registry/tool-registry";
```

**自动看护**（三层）：

1. **ESLint** `backend/.eslintrc.js` SECTION 10 — IDE 实时 + lint-staged pre-commit
2. **jest spec** `layer-boundaries.spec.ts` + `agent-team-facade-contract.spec.ts` — 动态 import / 注释 escape 也拦
3. **pre-push hook** `.husky/pre-push` [0/6] — push 前最后防线

---

## 5. 新建 agent team app 检查清单

按顺序：

1. **目录骨架**：建 `ai-app/<team>/{module,api,runtime,mission/{pipeline,agents,lifecycle},events}/`
2. **pipeline 配置**：`runtime/<team>.config.ts` 用 `defineMissionPipeline()` 定义 step 顺序 + DAG
3. **运行时 tuning**：`runtime/<team>-runtime.config.ts` 用 Zod schema 校验 env 注入
4. **stage 实现**：`mission/pipeline/stages/<s1>.stage.ts` 一个 step 一个文件
5. **agents (SKILL.md)**：`mission/agents/<role>/SKILL.md` 每个 agent 一个 frontmatter + instructions
6. **dispatcher / orchestrator / runtime-shell / bindings**：继承 framework 类，只填业务 hook
7. **lifecycle**：`mission/lifecycle/<team>-mission-store.service.ts` 实现 mission 持久化
8. **events schema**：`events/<team>.events.ts` 声明业务事件 + 在 module `onModuleInit` 注册
9. **liveness adapter**：module `onModuleInit` 注册 `livenessGuard.registerAdapter(...)` 防孤儿
10. **config snapshot**：runtime-shell `openSession()` 冻结 typed config snapshot
11. **app.module.ts 集成**：在 `backend/src/app.module.ts` import `<Team>Module`
12. **`MISSION_APP_MODULES` 登记**：把新 module 路径加到 `mission-app-conformance.spec.ts:23`
13. **跑全套验证**：`npm run type-check` + `npx jest src/__tests__/architecture` + `npm run build`

**红线**：任一项缺失，jest 自动看护会红，pre-push 拒推。

### 5.1 安全控制（MUST，2026-05-24 P32 security 审计补）

新 agent team app 的 HTTP / WS / 外部抓取边界**必须**实现以下安全控制（现有 3 个 app 已遵守，新 app 缺则视为安全回归）：

1. **controller 类级别 `@UseGuards(JwtAuthGuard)`** —— 默认所有端点认证，无显式公开理由不得省略。需公开端点用 `@Public()` 显式标注 + PR 说明
2. **写操作配 `@UseGuards(JwtAuthGuard, RateLimitGuard)`** —— POST / PATCH / DELETE 必须限流。⚠️ 当前 `RateLimitGuard` 是单 pod in-memory（多 pod 实际限额翻倍），跨 pod 强限额用 `DistributedRateLimitGuard`
3. **ownership 校验在 service 层** —— 用户资源（mission / topic / run）的归属校验必须在 service 内完成（`getOwnedById(id, userId)` 模式），不能只靠 controller 传 userId
4. **UUID 路径参数走 `ParseUUIDPipe`** —— `@Param("xxxId", new ParseUUIDPipe({ version: "4" }))`，防非法格式无谓触及 DB
5. **外部 URL 抓取必过 SSRF 校验** —— 调 `assertSafeHttpUrl(url)` 后再 fetch。⚠️ 已知局限：仅 host-string 黑名单，不防 DNS rebinding / redirect-follow（生产应在出站层加 IP 解析校验 + 逐跳重定向校验，见 radar `ssrf-util.ts` 注释）
6. **WebSocket 鉴权要查 blocklist** —— gateway 不能只 `JwtService.verify`（不查 Redis 禁用名单），被禁用户旧 socket 会持续收事件直到 token 过期。需校验 token 是否在 blocklist
7. **禁硬编码 secret / model 名** —— 走 `APP_CONFIG` / TaskProfile（见 CLAUDE.md 行为红线）

**自动看护现状**：上述第 1/2/4 项可静态扫（controller decorator），但目前 `agent-team-layout.spec` 只锁目录结构，**未锁安全 decorator**。新 app 评审时人工核对本清单。后续如加 security decorator AST spec，更新此节。

### 5.2 质量基线门禁（MUST，可看护）

> **原则**：playground 之所以是标杆（见 §8），靠的是可量化的质量纪律。这些纪律必须是**机器可看护的门禁**，不是人工自觉。每条规则映射到一个 spec / lint / hook。

| #   | 规则                                                                           | 阈值 / 判据                                     | 看护载体                                                   | 现状    |
| --- | ------------------------------------------------------------------------------ | ----------------------------------------------- | ---------------------------------------------------------- | ------- |
| 1   | **mission 类 app 测试比**：`__tests__` spec 数 / 非测试 `.ts` 数               | ≥ 35%（playground 41% / radar 实测）            | `agent-team-quality-gate.spec.ts`（新增）                  | ✅ 已加 |
| 2   | **production 代码零 facade 穿透**（测试可 reach 内部）                         | 非 `__tests__` 文件 0 处内部路径 import         | `agent-team-facade-contract.spec.ts` + ESLint SECTION 10   | ✅ 已有 |
| 3   | **无 `any` / `console.log`**（mission app 非测试代码）                         | 0 处                                            | ESLint `@typescript-eslint/no-explicit-any` + `no-console` | ✅ 已有 |
| 4   | **终态只经 `MissionLifecycleManager.finalize` → arbiter**，禁直写 mission 终态 | store 不得旁路 `markX`/`applyTerminalIfRunning` | `mission-contract-guards.spec.ts`（C0 终态写收口）         | ✅ 已有 |
| 5   | **每个 stage 一个文件**，`mission/pipeline/stages/` 下无多 stage runner 合并   | 1 file ≤ 1 stage runner class                   | `agent-team-quality-gate.spec.ts`（新增）                  | ✅ 已加 |
| 6   | **outputSchema 用真 zod**，禁伪造 always-success 对象（lying assertion）       | 不得 `outputSchema: { parse:` 字面对象          | `agent-team-quality-gate.spec.ts`（新增）                  | ✅ 已加 |

**禁止行为**：

- ❌ 测试比低于阈值就提交（gate 红 → pre-push 拒推）
- ❌ 用伪造 schema 蒙混 framework 校验（CLAUDE.md 反向洞察：lying assertion 是技术债）
- ❌ 在 store 里直写终态绕过 finalize 仲裁（破坏 terminal arbiter 一致性）

**门禁源码**：`backend/src/__tests__/architecture/agent-team-quality-gate.spec.ts`。新 app 自动纳入（扫 `MISSION_APP_MODULES` 清单）。

---

## 6. 修改 `ai-harness/teams/business-team/` framework 的红线

修改 framework 前必须满足：

1. **至少 2 个消费方需要这个改动**（避免 over-engineering for single consumer）
2. **3 个 app 同步迁移**：framework 提取必须 playground + social + radar 同 PR 落地，**不允许 1-of-3**
3. **不破坏向后兼容**：现有子类继承点（hook 签名）保持稳定，新增 hook 必须 optional + 有 default

**自动看护**：`agent-team-layout.spec.ts` 锁 §8.1 子目录白名单（abstractions/invocation/dispatcher/bindings/lifecycle/orchestrator/state/span/events/helpers/rerun），加新顶层子目录会红。

---

## 7. 例外审批流程

如果 §2-§6 任一规则无法满足：

1. **停下来问用户**：说明哪条规则不适配 + 为什么 + 建议替代方案
2. **获批后留痕**：在对应 spec 的 allowlist 加例外 + PR 描述注释原因
3. **基线只能减不能增**：例外即"被批准一次"，下次 PR 再增即被锁

**禁止行为**：

- ❌ 未经批准在 spec 加 `it.skip(...)` 跳过
- ❌ 未经批准用 `// eslint-disable-next-line` 绕过
- ❌ 把 spec 的 forbidden 列表删一项就提交

---

## 8. 标杆依据（为什么以 `agent-playground` 为范本）

> 本节是 narrative（非规则），解释"标杆气质"从何而来，让新 app 作者知道该学什么。数据为 2026-05-29 实测。

`agent-playground` 是本项目 mission 家族的**事实标杆**——不是钦定，是 `radar` / `social` 已照它骨架长出来的客观结果（mission 框架现有 3 个消费方）。它够格的硬证据：

| 维度        | 实测                                                                                      | 说明                                             |
| ----------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 测试纪律    | 222 文件 / 92 测试（**~41%**）                                                            | 全项目最高测试密度，是 §5.2 门禁阈值的来源       |
| Facade 纪律 | production 代码**零穿透**（违规仅在 `__tests__`）                                         | §4 import 规则的合格样板                         |
| 代码卫生    | 222 文件中 `any`/`console.log` **仅 2 处**                                                | §5.2 规则 3 的标杆                               |
| 横向耦合    | 对 `ai-app/teams` **零依赖**                                                              | app 之间不互相依赖（CLAUDE.md 模块依赖原则）     |
| 框架复用    | mission 框架被 playground + radar + social 消费                                           | 证明 §3 framework 是真·可复制，非特殊待遇        |
| 运行时模式  | terminal arbiter / liveness guard / event-buffer replay / checkpoint resume / local rerun | §5.2 规则 4 + CLAUDE.md 反向洞察 10 条的业务落地 |

**适用边界（呼应 §1）**：标杆只适用于 mission-pipeline 家族（多步骤 + 多角色 + 产出 artifact）。`ask`/`image`/`library` 等问答/生成/CRUD 型**不在**此列——强套这套框架 = 过度抽象。

**学它什么（而非抄它什么）**：学 §5.2 的质量纪律、§3 的继承而非复制、§2.1 的最小起步；**不要**整包复制它的 222 文件。

---

## 相关文档

- [agent-playground 边界 + 目录蓝图](../docs/architecture/ai-app/agent-playground/agent-playground-target-boundary-and-directory-blueprint-2026-05-24.md) — §8.2 目录 + §8.1 framework 设计原始来源
- [agent app 迁移路线图 v2](../docs/architecture/ai-app/agent-app-mass-migration-roadmap-2026-05-24.md) — Wave 1b + Wave 4 完成状态
- [`16-ai-engine-harness-structure.md`](16-ai-engine-harness-structure.md) — ai-engine / ai-harness 11 顶层聚合（MECE）
- [`02-directory-structure.md`](02-directory-structure.md) — 项目整体目录规范
- [架构边界 jest spec](../backend/src/__tests__/architecture/) —— 自动看护源码

---

**最后更新**: 2026-05-29
**维护者**: Claude Code (Wave 6 P31；1.1 黄金路径增补)
