# AI App (L3) Recursive MECE + Naming Blueprint

> 日期: 2026-06-03
> 范围: `backend/src/modules/ai-app/` 全部 20 个子模块
> 性质: **审议蓝图 + 分级计划。本轮不改代码。**
> 方法: 两视角独立 MECE 校验 → 首席综合者交叉核验 + 磁盘事实复核 → 权威裁定。

---

## 0. 判据回顾（ai-app = 第一方 · 单一 AI 产品功能域）

| 判据       | 内容                                                                                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **归属**   | 是真正的单一 AI 产品功能域 → 留 `ai-app`。否则标 `misplaced` 并给目标层（common / platform(L1) / open-api/user / ai-engine / ai-harness / flatten）。       |
| **命名**   | dir 是否 kebab-case；dir 名 ↔ `@Controller` 路由前缀是否对齐；是否有冗余前缀（`ai-`/`agent-`/`topic-`）；类名是否全项目唯一。                               |
| **破坏性** | 路由 URL = 前端契约。改 dir 名若迫使路由 URL 变更 → `breaking=true`。dir-only 改名若造成 dir↔route 不一致 → `needs-route-change`。                          |
| **硬约束** | HTTP 只在 L3(ai-app)/L4(open-api)。engine/harness/platform/common 禁挂 controller。misplaced 模块若带 controller 但要下沉 → 标 `needs-http-stay-or-split`。 |

**覆盖率**: 磁盘清点 `ai-app/` 恰为 20 个目录，蓝图 100% 覆盖，无缺失/幻影模块。全部 20 个 dir 名通过 kebab-case 校验。

**两视角一致性**: 两份独立校验在全部 20 个模块的 verdict / breaking 上 **完全一致**，仅措辞粒度不同。下表为综合裁定（取更精确者）。

---

## 1. 逐模块归属表（stay / misplaced→target / flatten / split）

| #   | 模块                 | Verdict                       | Breaking | 归属理由                                                                                                                      |
| --- | -------------------- | ----------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | research             | stay                          | true     | 单一 AI 产品功能域，dir↔route 对齐                                                                                            |
| 2   | writing              | stay                          | true     | 单一 AI 产品功能域                                                                                                            |
| 3   | office               | stay                          | true     | 单一域；内部 `AgentsController` 路由有命名瑕疵（见 §2/§4）                                                                    |
| 4   | ask                  | stay                          | false    | 单一域                                                                                                                        |
| 5   | image                | stay                          | true     | 单一域（`forwardRef` 解 engine 循环依赖，符合规范）                                                                           |
| 6   | social               | stay                          | true     | 单一域                                                                                                                        |
| 7   | simulation           | stay                          | false    | 单一域                                                                                                                        |
| 8   | radar                | stay                          | false    | 单一域                                                                                                                        |
| 9   | library              | stay                          | false    | **聚合父目录**（collections/notes/rag/knowledge-graph/integrations），不拍扁                                                  |
| 10  | explore              | stay                          | false    | 产品供给侧 + 带 HTTP；`ingestion/` 子树为未来拆分候选（见 §5）                                                                |
| 11  | topic-insights       | stay                          | true     | Research 衍生应用；**不建议改名**（见 §2 争议裁定）                                                                           |
| 12  | teams                | stay                          | true     | `ai-app/teams` 业务层（辩论等），与 engine/harness 同名分层合法                                                               |
| 13  | custom-agents        | stay                          | true     | 用户自建 Agent CRUD/launch，`custom-` 前缀已消歧                                                                              |
| 14  | agent-playground     | stay                          | true     | Agent 调试台；`agent-` 前缀冗余但改名破坏路由（见 §2）                                                                        |
| 15  | ai-planning          | stay                          | true     | 单一域；`ai-` 前缀冗余但改名破坏路由（见 §2）                                                                                 |
| 16  | **byok**             | **misplaced → open-api/user** | false    | 纯 HTTP facade，无产品域逻辑；全部 controller 在 `user/*`+`admin/*`。**needs-http-stay**: controller 留 L4，不下沉 platform。 |
| 17  | **contracts**        | **split**                     | false    | 保留 interfaces + DI-token barrel 于 ai-app；`skills/*.skill.md` 迁 docs；`report-template/` 并入真实 owner（见 §3/§6）       |
| 18  | **management**       | **flatten**                   | false    | 空壳父目录，唯一子 `workspace/`（自带 `WorkspaceModule`），无 `management.module.ts`。提升为 `ai-app/workspace`。             |
| 19  | notifications-bridge | stay                          | false    | harness EventBus(L2.5) → platform glue；**最低合法层就是 L3**（platform L1 禁止向上依赖 harness）。保留 `-bridge` 后缀。      |
| 20  | feedback             | stay                          | false    | 第一方产品反馈域，消费 ai-engine AI 三分类；dir↔route 对齐                                                                    |

---

## 2. 命名审视表（dir/route 对齐 · 建议改名 · 是否破坏）

| 模块                      | dir kebab? | route 前缀                                                                             | dir↔route        | 建议改名                         | 破坏?     | 裁定                                                                                                                                                                                         |
| ------------------------- | ---------- | -------------------------------------------------------------------------------------- | ---------------- | -------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| topic-insights            | ✅         | `topic-insights`（6 controller 硬编码字面量，无 alias） + `api/topic-insights/latency` | 对齐             | `insight`（理论上）              | **true**  | **更正蓝图**: 原标 renameBreaking=false 错误。6 个 controller 用硬编码 `"topic-insights"`，无 alias/版本。dir-only 改名 → dir↔route 失配；连 route 一起改 → 破坏前端契约。**裁定: 不改名。** |
| ai-planning               | ✅         | `ai-planning`（硬编码）                                                                | 对齐             | `planning`（去 `ai-` 冗余）      | **true**  | route 硬编码，改名迫使 URL 变更。仅在 FE+BE 协调路由迁移时可行；否则保持。                                                                                                                   |
| agent-playground          | ✅         | （路由按 controller 定义）                                                             | —                | `playground`（去 `agent-` 冗余） | **true**  | 若路由含 `agent-playground` 字面量则改名破坏 URL。本轮仅标注，不改。                                                                                                                         |
| office (AgentsController) | ✅         | `@Controller("agents")` (office/agents/agents.controller.ts:38)                        | **失配**         | route → `ai-office/agents`       | **true**  | 裸 `agents` 路由逃逸 `ai-office` 命名空间 + 概念上与 ai-harness `agents` 聚合撞名。route 变更=破坏前端契约。**本轮仅标注，延后协调路由迁移。**                                               |
| management                | ✅         | `@Controller("workspaces")`（route 在 controller 上）                                  | flatten 后仍对齐 | flatten → `workspace`            | **false** | route `workspaces` 定义在 controller，dir-only flatten 不改任何 URL。`WorkspaceModule` 直接注册于 `app.module.ts`，无聚合 import 断裂。                                                      |
| byok                      | ✅         | `user/*` + `admin/*`                                                                   | —                | （随迁移 open-api/user）         | false     | 移动不改 route 字面量；HTTP 留 L4。                                                                                                                                                          |
| explore                   | ✅         | root `explore.module.ts` 仅聚合 youtube                                                | **部分失配**     | （ingestion 拆分候选）           | false     | 本轮 stay；ingestion 子树 needs-http-stay-or-split，延后评估。                                                                                                                               |
| 其余 14 模块              | ✅         | dir↔route 对齐                                                                         | 对齐             | 无                               | 见 §1     | 命名合规，无动作                                                                                                                                                                             |

---

## 3. 同名概念消歧（cross-module global-uniqueness）

| 同名概念                  | 磁盘事实（已复核）                                                                                                                                                                   | 裁定                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **user-skills**           | byok `@Controller("user/skills")` + `UserSkillsService` vs `open-api/user/skills/skills.controller.ts` `@Controller("skills")` + `skills.service.ts`（**两者今天都已存在**）         | route 不同(`user/skills` vs `skills`)→无硬 URL 撞车，但两个面向用户的 skill 暴露面真实重复。**裁定**: byok 迁入 open-api/user 时，把 `UserSkillsController/Service` 折叠进 `open-api/user/skills`（语义化为 user-skill-grants），单一 owner。                                                                        |
| **skills（三义）**        | (a) `ai-engine/skills` = 唯一 `SkillRegistry`；(b) byok `user/skills` = 用户 CRUD；(c) `contracts/skills/*.skill.md` = 架构模式文档（非可执行 prompt skill，依 SKILL-DIAGNOSTIC.md） | (1) contracts/skills/\*.md → `docs/architecture`；(2) `ai-engine/skills` 保持唯一 SkillRegistry；(3) byok user-skills 折叠入 open-api/user/skills。消除三义碰撞，src 内 `skills` 仅指 engine SkillRegistry。                                                                                                         |
| **KnowledgeGraphService** | `topic-insights/services/data/knowledge-graph.service.ts:31` vs `library/knowledge-graph/knowledge-graph.service.postgres.ts:9`（**两个不同实现**，后者 Postgres-backed）            | 不同域，不合并。重命名消歧: `TopicInsightsKnowledgeGraphService` / `LibraryKnowledgeGraphService`，满足全项目类名唯一。                                                                                                                                                                                              |
| **CheckpointService**     | `writing/services/mission/checkpoint.service.ts:48` vs `office/slides/checkpoint/checkpoint.service.ts:131`                                                                          | 域私有(module-scoped provider)，无 DI 撞车，但类名相同。前缀化: `WritingMissionCheckpointService` / `SlidesCheckpointService`（grep 唯一）。**注意**: 二者均为 app 域进度存储，**不是** ai-harness/memory/checkpoint 引擎状态——保持该分离（MECE 规则"checkpoint 不分两处"指的是 harness 唯一引擎 checkpoint 基元）。 |
| **DashboardController**   | `explore/ingestion/config/controllers/dashboard.controller.ts:7` vs `explore/ingestion/sources/dashboard.controller.ts:7`（route: `data-management/dashboard` vs `data-collection`） | 类名重名。重命名: `IngestionConfigDashboardController` / `IngestionSourcesDashboardController`（route URL 不变）。                                                                                                                                                                                                   |
| **report-template**       | `contracts/report-template/pipeline` vs `management/workspace/report-template.service.ts`（live service）                                                                            | 并入单一 owner = workspace（拥有实时 service）；contracts 仅在需要时 re-export 共享 type。                                                                                                                                                                                                                           |
| **teams（三层）**         | `ai-engine/teams`(Registry 基元) / `ai-harness/teams`(collaboration: voting/debate/review) / `ai-app/teams`(AiTeams\* 业务)                                                          | 依 CLAUDE.md 分层合法共存，靠 layer path + app 层 `Ai*` 类前缀消歧。**无需改动。**                                                                                                                                                                                                                                   |
| **notifications**         | `notifications-bridge`(ai-app, EventBus→platform glue) vs `platform/notifications`(真实 NotificationService)                                                                         | `-bridge` 后缀已消歧。保留后缀。bridge 留 L3（platform L1 禁止向上依赖 harness L2.5）。**无需改动。**                                                                                                                                                                                                                |
| **agents**                | `ai-harness/agents`(定义层) / `ai-app/custom-agents`(用户 CRUD) / `ai-app/agent-playground`(调试台) / office 裸 `@Controller("agents")`                                              | custom-/agent- 前缀 + 稳定 route 已消歧；唯一真问题是 office 裸 `agents` route 逃逸命名空间（见 §2，延后）。                                                                                                                                                                                                         |

---

## 4. 分级计划

### T1 — 非破坏（可本轮后安全执行，不动任何路由 URL）

| 模块/概念                            | 动作                    | 细节                                                                                                                                                                                                                                                           |
| ------------------------------------ | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **management**                       | **flatten**             | 提升 `management/workspace/` → `ai-app/workspace`。route `workspaces` 在 controller 上，dir-only flatten 零 URL 变更。`WorkspaceModule` 直接注册于 `app.module.ts`，无聚合 import 断裂。                                                                       |
| **contracts**                        | **split（非 HTTP）**    | (a) `skills/*.skill.md`(11) + `SKILL-DIAGNOSTIC.md` → `docs/architecture`；(b) `report-template/` 并入 workspace（flatten 后）；(c) 保留 `interfaces/` + `mission-platform.contract.ts` + `agent-catalog` 为 ai-app 共享 barrel。无 controller/route，非破坏。 |
| **KnowledgeGraphService**            | dir-only 类改名         | → `TopicInsightsKnowledgeGraphService` / `LibraryKnowledgeGraphService`。先确认无死代码/重复再操作。                                                                                                                                                           |
| **CheckpointService**                | dir-only 类改名（可选） | → `WritingMissionCheckpointService` / `SlidesCheckpointService`。module-scoped，无 DI 影响。                                                                                                                                                                   |
| **DashboardController（explore×2）** | dir-only 类改名         | → `IngestionConfigDashboardController` / `IngestionSourcesDashboardController`。route URL 不变。                                                                                                                                                               |
| **notifications-bridge**             | 无动作（确认 stay）     | 已在最低合法层；保留 `-bridge` 后缀。                                                                                                                                                                                                                          |

> 说明: T1 内 misplaced 无-controller 模块（contracts 的文档/类型部分）可安全归位；带 controller 的 byok 不在 T1（见 T2）。

### T2 — 破坏（仅标注 + 风险 + 别名策略选项，本轮不执行）

| 模块/概念                                            | 变更                                      | 破坏点                                                                                                                                   | 别名/缓解策略                                                                                                                                                        |
| ---------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **byok → open-api/user**                             | 含 controller 跨层移动 + 折叠 user-skills | **needs-http-stay**: 13 个 controller 必须留 L4，**禁止**下沉 platform。`UserSkillsService` 随迁或推入 platform/credentials 与同侪对齐。 | 移动保持 route 字面量不变 → 用户 URL 不破坏；破坏面在内部 import 路径。先建 open-api/user/byok 目标，逐 controller 迁移 + 折叠 user-skills 入 open-api/user/skills。 |
| **topic-insights → insight**                         | dir 改名                                  | 6 controller 硬编码 `"topic-insights"` route，无 alias → 改 dir 必连 route，破坏前端/第三方契约                                          | **裁定: 不改名**（保 route↔dir 对齐）。若坚持简化: 需 FE+BE 协调路由迁移 + 双写 alias 过渡期。                                                                       |
| **ai-planning → planning**                           | dir 改名（去 `ai-`）                      | route `ai-planning` 硬编码 → URL 变更                                                                                                    | 需 FE+BE 协调；过渡期 controller 双 `@Controller(["ai-planning","planning"])` alias。                                                                                |
| **agent-playground → playground**                    | dir 改名（去 `agent-`）                   | 若 route 含 `agent-playground` 字面量 → URL 变更                                                                                         | 同上 alias 策略。                                                                                                                                                    |
| **office AgentsController route → ai-office/agents** | route 收敛                                | `@Controller("agents")` 改前缀 = 前端契约变更                                                                                            | 延后协调路由迁移；过渡期双 route alias。本轮仅标注命名空间瑕疵。                                                                                                     |
| **explore/ingestion 拆分**                           | 子树拆分评估                              | 带 HTTP controller → **needs-http-stay-or-split**                                                                                        | 本轮 stay；ingestion(data-collection/data-management/crawler/scheduler) 为数据管线 back-office，非 end-user discovery，列后续拆分评估。                              |

---

## 5. explore/ingestion 拆分候选（深入说明）

- root `explore.module.ts` 仅聚合 youtube → name↔route 部分失配。
- `ingestion/` 子树(`data-collection/*` + `data-management/*` + crawler + scheduler) 是数据管线/运营 back-office，非 end-user "discovery" 语义。
- 现状带 HTTP controller → 标 **needs-http-stay-or-split**，本轮保留 ai-app。
- 同时在 T1 解决两个 `DashboardController` 同名（见 §3/§4）。

---

## 6. contracts split 细则

| 子项                                                             | 现状                                                      | 去向                                                                     |
| ---------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------ |
| `interfaces/` + `mission-platform.contract.ts` + `agent-catalog` | 合法跨 app TS 契约 + DI token                             | **保留** ai-app/contracts barrel                                         |
| `skills/*.skill.md`(11) + `SKILL-DIAGNOSTIC.md`                  | 架构模式设计文档（非可执行 prompt skill）                 | → `docs/architecture`                                                    |
| `report-template/pipeline`                                       | 与 `management/workspace/report-template.service.ts` 重复 | 并入 workspace（flatten 后单一 owner），contracts 仅 re-export 共享 type |

---

## 7. 关键更正（相对原蓝图输入）

1. **topic-insights renameBreaking: false → true（更正）**。6 controller 硬编码 route，无 alias。**裁定不改名。**
2. **byok user-skills 与 open-api/user/skills 双面已确认在磁盘上同时存在**（非假设风险）。迁移时折叠为单一 owner。
3. **office `@Controller("agents")` 命名空间逃逸已确认**（office/agents/agents.controller.ts:38）。route 收敛属 T2 破坏，延后。
4. **management 确认空壳**（仅 workspace 子目录，无 management.module.ts）→ flatten 非破坏。

---

**结论**: 20/20 模块归属明确，18 stay + 1 misplaced(byok) + 1 flatten(management) + 1 split(contracts，注: contracts 计入 split 而非 stay)。无破坏动作可立即进 T1；所有迫使路由 URL 变更的改名与含-controller 跨层下沉归 T2，仅标注 + 别名策略，待 FE+BE 协调。
