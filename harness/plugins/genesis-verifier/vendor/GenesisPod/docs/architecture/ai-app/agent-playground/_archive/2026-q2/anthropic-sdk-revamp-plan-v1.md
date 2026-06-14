# Playground Anthropic-SDK 范式改造方案 v1（待评审）

**日期：** 2026-05-04
**目标：** playground 改造为 Anthropic Claude Agent SDK 范式 —— 开发新 agent = 写 SKILL.md + 选 tools + 配置 TeamConfig，**不写业务代码**
**作用域：** playground 是第一改造对象（不留双轨），改完作为后续 ai-app 的标杆
**状态：** v1 起草，等待内部专业评审

---

## 一、目标与衡量标准

### 1.1 目标 (North Star)

```
开发新 agent-team app 的全部代码：
  ├── <my-team>.config.ts          (~50 行声明式配置)
  ├── skills/<role>.skill.md        (3-8 份 SKILL.md, frontmatter + instructions)
  ├── <my-team>.module.ts           (5-10 行 NestJS module)
  └── prisma fields (optional)       (业务专属字段进 metadata JSONB, 默认零迁移)

跑通: controller / gateway / mission runner / lifecycle / rerun /
     export / chat / replay / events 全自动
```

### 1.2 量化验收标准

| 指标                                       | 目标                                  |
| ------------------------------------------ | ------------------------------------- |
| 复制 playground → 新 ai-app 改动文件数     | < 10（仅 config + SKILL.md + module） |
| 新 ai-app 开发时间（资深开发者）           | < 1 天（vs 现状 1-2 周）              |
| 新 ai-app 开发时间（AI Agent 自主）        | < 2 小时（vs 现状不可行）             |
| playground 业务代码总行数（不含 SKILL.md） | < 500 行（vs 现状 ~5000 行）          |
| harness/teams 通用 mission-pipeline 行数   | < 800 行                              |
| 全量 spec 通过率                           | 100%（行为零回退）                    |

### 1.3 非目标

- **不做** harness 顶层结构调整（W17 已完成、W21/W22 主线波次另议）
- **不做** prisma schema 大重构（playground 表保留，只加 generic table 作为新 ai-app 默认）
- **不做** 前端 UI 改造（保持 playground 前端功能不变）
- **不做** 对外 SDK 包发布（仅 monorepo 内 module export）

---

## 二、最终用户体验示例

### 2.1 写一个新 ai-app（writing-team）

**File 1: `modules/ai-app/writing-team/writing-team.config.ts`** (~40 行)

```typescript
import { defineMissionTeam } from "@/modules/ai-harness/facade";
import { z } from "zod";

const WritingTopicSchema = z.object({
  topic: z.string().min(2),
  audience: z.enum(["general", "expert", "executive"]),
  language: z.enum(["zh-CN", "en-US"]),
  depth: z.enum(["brief", "standard", "deep"]),
});

export const WritingTeamConfig = defineMissionTeam({
  id: "writing-team",
  description: "AI 写作团队：从 topic 到成稿",
  topicSchema: WritingTopicSchema,
  endpointPrefix: "writing-team", // 自动生成 /api/v1/writing-team/*
  eventPrefix: "writing-team", // 自动生成 writing-team.* 事件
  prismaTable: "writing_team_missions", // generic table + 业务字段进 metadata

  roles: [
    { id: "leader", skill: "writing-team.leader", loop: "leader-worker" },
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
    { stage: "persist" }, // built-in stage, no agent
  ],

  // 可选 hooks（业务专属逻辑），不写则用 harness 默认
  hooks: {
    afterReview: "writing-team.section-quality-enhancement", // 指 SKILL.md ID
  },
});
```

**Files 2-5: SKILL.md** (frontmatter + instructions)

```markdown
## <!-- skills/writing-team/leader.skill.md -->

name: writing-team.leader
description: 写作 mission 的 Leader，负责规划 + 签字
allowedTools: [web-search, library-search]
allowedModels: [claude-sonnet-4-6, gpt-5]
activateFor: [leader]

---

你是写作 Team 的 Leader...

## Phase 1: plan

... (instructions)

## Phase 2: signoff

... (instructions)
```

**File 6: `modules/ai-app/writing-team/writing-team.module.ts`** (~10 行)

```typescript
import { Module } from "@nestjs/common";
import { HarnessTeamsModule } from "@/modules/ai-harness/facade";
import { WritingTeamConfig } from "./writing-team.config";

@Module({
  imports: [HarnessTeamsModule.forFeature(WritingTeamConfig)],
})
export class WritingTeamModule {}
```

**就这些**。注册到 app.module.ts，跑起来就有：

- `POST /api/v1/writing-team/team/run`
- `GET /api/v1/writing-team/missions`
- `GET /api/v1/writing-team/missions/:id`
- `POST /api/v1/writing-team/missions/:id/rerun`
- `POST /api/v1/writing-team/missions/:id/cancel`
- `GET /api/v1/writing-team/missions/:id/export?format=markdown`
- `WebSocket /writing-team` namespace（事件 replay / live mission progress）
- `POST /api/v1/writing-team/missions/:id/leader-chat`

---

## 三、架构设计

### 3.1 三层抽象

```
┌─────────────────────────────────────────────────┐
│  ai-app/<my-team>/                              │
│    ├── config.ts (TeamConfig + Pipeline 声明)  │
│    ├── skills/*.skill.md (Anthropic SKILL.md)  │
│    └── module.ts (forFeature 注册)              │
└─────────────────────────────────────────────────┘
                       ↓ 声明式配置
┌─────────────────────────────────────────────────┐
│  ai-harness/teams/mission-pipeline/             │
│    ├── MissionPipelineRunner                    │
│    │     按 config.pipeline[] 执行 stage 序列   │
│    ├── StagePrimitiveRegistry                   │
│    │     7 个内置 stage primitive               │
│    ├── MissionTopicGateway                      │
│    │     dynamic controller + gateway           │
│    └── MissionPipelineModule.forFeature(config) │
└─────────────────────────────────────────────────┘
                       ↓ 运行时调用
┌─────────────────────────────────────────────────┐
│  ai-harness/agents + ai-engine/skills           │
│    ├── AgentRunner (loop / executor)             │
│    ├── SpecAgentRegistry.fromSkill(skillId)     │
│    └── SkillActivator (frontmatter 驱动)        │
└─────────────────────────────────────────────────┘
```

### 3.2 7 个内置 Stage Primitive

playground 13 stage 抽象后的通用 primitive（每个 < 200 行）：

| Primitive    | 职责                                                       | playground 13 stage 中对应 |
| ------------ | ---------------------------------------------------------- | -------------------------- |
| `plan`       | role.skill 输出 dimensions/goals → ctx.plan                | s1 + s2                    |
| `research`   | role × N 并行 + 可选 per-item-pipeline                     | s3                         |
| `assess`     | leader-style role 评估前序产出，决定 retry/abort/continue  | s4                         |
| `synthesize` | 跨产出聚合（reconcile + analyst 通用模式）                 | s5 + s6                    |
| `draft`      | writer-style role 生成最终 artifact                        | s7 + s8                    |
| `review`     | reviewer/critic role 评分 + 可选 hook 触发增强             | s8b + s9 + s9b             |
| `signoff`    | leader role 终审 + accountability                          | s10                        |
| `persist`    | 内置无 LLM stage，写 mission_runs 表                       | s11                        |
| `learn`      | 内置异步 stage，触发 FailureLearner + memory consolidation | s12                        |

### 3.3 SKILL.md = Agent 单一真相源

```markdown
---
name: writing-team.leader
description: <一句话>
version: "1.0"
allowedTools: [tool-id-1, tool-id-2]
allowedModels: [model-id-1]
activateFor: [leader, signoff]
outputSchemaRef: writing-team.leader-output # 指向 zod schema 注册项
---

# Leader 灵魂

...

# Phase: plan

...

# Phase: signoff

...
```

由 `ai-engine/skills/SkillActivator` 加载 + frontmatter 解析；`AgentRunner` 用 `outputSchemaRef` 注入 schema 校验。

### 3.4 prismaTable 通用化策略

```sql
-- harness 提供的 generic 表
CREATE TABLE mission_runs (
  id UUID PRIMARY KEY,
  team_id TEXT NOT NULL,           -- 'agent-playground' | 'writing-team' | ...
  user_id UUID NOT NULL,
  workspace_id UUID,
  topic JSONB NOT NULL,            -- 业务 topic schema
  status TEXT NOT NULL,
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP,
  metadata JSONB,                  -- 业务专属字段（dimensions / userProfile / report / verdicts ...）
  -- 通用字段（rerun / heartbeat / lifecycle）
  ...
);

CREATE TABLE mission_events (...);          -- generic
CREATE TABLE mission_leader_chats (...);    -- generic
CREATE TABLE mission_checkpoints (...);     -- generic
```

playground 现有 3 个 `agent_playground_*` 表保留（兼容），新 ai-app 走 generic 表。playground 改造时**不动数据库**，TeamConfig.prismaTable 默认指向 generic 表，playground config 显式指向自己的旧表（兼容层）。

### 3.5 Harness DI 拓扑

```
HarnessTeamsModule (常驻)
  ├── MissionPipelineRunner
  ├── StagePrimitiveRegistry (7 primitive)
  ├── MissionStoreService (generic, 操作 mission_runs)
  ├── MissionEventStore (generic, 操作 mission_events)
  ├── MissionLeaderChatService (generic, prompt 走 SKILL.md)
  ├── MissionExportService (generic, registered exporters)
  ├── MissionRerunOrchestratorService (generic)
  └── HarnessTeamsModule.forFeature(config) → 动态生成:
        - DynamicMissionController(config.endpointPrefix)
        - DynamicMissionGateway(config.id)
        - 注册 events 前缀到 DomainEventRegistry
        - 注册 SkillProvider（指向 config.skills）
```

---

## 四、实施路径（5 个 PR + 渐进迁移）

### Phase R1: 基础设施落地（不动 playground，确保通用框架可用）

#### PR-R1-A: harness/teams/mission-pipeline 框架（5 天，HIGH 风险）

- 新建 `harness/teams/mission-pipeline/` 子聚合
- 实现 7 个 stage primitive（每个 < 200 行）
- 实现 `MissionPipelineRunner`（< 400 行）
- 实现 `MissionPipelineModule.forFeature(config)` 动态 module
- 单元 + integration spec 覆盖
- **不影响** playground

#### PR-R1-B: TeamConfig API + SKILL.md 加载机制（2 天，MEDIUM 风险）

- 扩展 `harness/teams/abstractions/team.interface.ts`：增加 `MissionPipelineConfig` 子类型（pipeline / hooks / topicSchema / endpointPrefix / eventPrefix / prismaTable）
- 注意：现有 `TeamConfig` (leader+members 拓扑) 保留兼容，新增 `MissionTeamConfig extends TeamConfig`
- 实现 `defineMissionTeam(config)` 验证 + 默认值填充
- 接 `engine/skills/SkillActivator` 用 SKILL.md frontmatter 加载

#### PR-R1-C: Generic prisma 表 + Store services（3 天，MEDIUM 风险）

- 创建 `mission_runs / mission_events / mission_leader_chats / mission_checkpoints` 通用表
- 迁移脚本：手写 SQL（项目规则）
- 实现 generic store services（按 teamId 隔离查询）
- playground 表**保留**作为 legacy

#### PR-R1-D: Generic controller / gateway / chat / export / rerun（3 天，HIGH 风险）

- `MissionPipelineModule.forFeature(config)` 动态创建：
  - DynamicMissionController（@Controller(config.endpointPrefix)）
  - DynamicMissionGateway（namespace = config.id）
  - 注入 generic services
- ratelimit / auth guard 可在 config 声明
- 业务事件前缀（`config.eventPrefix`）注入 emit chain

### Phase R2: playground 迁移（用 R1 框架重写 playground）

#### PR-R2-A: 创建 `playground.config.ts` 用 R1 框架（2 天，HIGH 风险）

- 新建 `modules/ai-app/agent-playground/agent-playground.config.ts`
- pipeline = [plan, research(fanOut=byDimensions, hookAfter=reconcile), assess, synthesize, draft, review, signoff, persist, learn]
- hooks 注册 playground 业务专属：
  - `afterResearch`: 触发 reconciler stage primitive 但带 playground SKILL.md
  - `afterDraft`: 触发 quality-enhancement hook（s8b 业务）
  - `beforeSignoff`: 触发 objective-evaluation hook（s9b 业务）
- prismaTable 指向 `agent_playground_missions`（兼容旧表）
- eventPrefix = "agent-playground"（保持前端兼容）
- 同时启动旧 controller，让两条路径并存验证

#### PR-R2-B: 验证 playground.config 行为与旧实现等价（2 天，HIGH 风险）

- e2e mission run 对比：旧 `team.mission.ts` vs 新 `MissionPipelineRunner`
- 事件流对比 / 数据库写入对比 / 报告内容对比
- 9 路 mission 验证（参考 PR #81 验证标准）

#### PR-R2-C: 删除 playground 旧实现（2 天，HIGH 风险）

- 删除：team.mission.ts / 13 stage 文件 / 8 role services / mission-runtime-shell / mission-stage-bindings / mission-context / mission-deps / agent-invoker / agent-execution-support / agent-playground-event-relay / agent-invocation-policy / leader.service / leader-failure-diagnostic / mission-rerun-orchestrator / mission-export / leader-chat / leader-chat-prompt / leader-decision-parser / per-dim-pipeline / runner-state / narrative / report-artifact-sections / word-count-normalizer / duty-loader.ts / 18 个 duty.md
- 保留：playground.config.ts / 18 个 SKILL.md / 业务 dto / Prisma 表 schema / 业务 hook（如 reconciler / quality-enhancement / objective-evaluation 三个 SKILL.md）
- 改后 playground 目录大约 30 文件（vs 现状 ~80 文件）

### Phase R3: 验收 + 沉淀（playground 改完后）

#### PR-R3-A: writing-team demo（1 天）

- 用 < 10 文件实现一个 writing-team
- 跑通 e2e
- 对比时间：从 0 到能跑应该 < 1 天

#### PR-R3-B: 文档 + memory 沉淀（半天）

- `services/README.md` → 描述新范式
- memory 沉淀决策路径

---

## 五、playground 13 stage → harness 7 stage primitive 详细映射

| playground stage            | harness primitive                                      | 业务专属处理                                                        |
| --------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------- |
| s1-budget                   | `persist`(pre) + 通用 budget validation                | endpoint 前 budget guard，进 stage primitive 之前                   |
| s2-leader-plan              | `plan`                                                 | playground SKILL.md `playground.leader@plan`                        |
| s3-researcher-collect       | `research` (fanOut="byPlanDimensions") + per-item hook | 内嵌 chapter pipeline 作为 hook：`playground.research-pipeline`     |
| s4-leader-assess            | `assess`                                               | playground SKILL.md `playground.leader@assess`，配 retry/abort 策略 |
| s5-reconciler               | `synthesize` (mode="reconcile")                        | playground SKILL.md `playground.reconciler`                         |
| s6-analyst                  | `synthesize` (mode="analyze")                          | playground SKILL.md `playground.analyst`                            |
| s7-writer-outline           | `draft` (sub-stage="outline")                          | playground SKILL.md `playground.writer@outline`                     |
| s8-writer                   | `draft` (sub-stage="full")                             | playground SKILL.md `playground.writer@full`                        |
| s8b-quality-enhancement     | `review` 的 `afterReview` hook                         | playground SKILL.md `playground.quality-enhance`                    |
| s9-critic                   | `review` (mode="meta-critic")                          | playground SKILL.md `playground.critic`                             |
| s9b-objective-eval          | `review` (mode="objective")                            | playground SKILL.md `playground.objective-eval`                     |
| s10-leader-foreword-signoff | `signoff`                                              | playground SKILL.md `playground.leader@signoff`                     |
| s11-persist                 | `persist`                                              | 通用，无 LLM                                                        |
| s12-self-evolution          | `learn`                                                | 通用，自动触发 FailureLearner + memory consolidation                |

**关键判断**：playground 13 stage 全部能映射到 7 primitive + hooks，没有真正"独一无二"的 stage 形态。证明 7 primitive 是对的抽象。

---

## 六、风险与缓解

| 风险                                                      | 等级   | 缓解                                                                                             |
| --------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------ |
| playground 业务细节漏迁移（边角逻辑泄漏）                 | HIGH   | R2-B 阶段 e2e 双跑对比 9 路 mission，确保等价                                                    |
| 7 stage primitive 抽象漏 playground 特殊逻辑              | HIGH   | R1-A 写完后，先用 playground.config 起手做"等价性 dry-run" 测试，发现漏再补 hook                 |
| Prisma 双轨期数据混淆                                     | MEDIUM | playground 旧表 / generic 表完全独立，TeamConfig.prismaTable 显式声明，不混                      |
| 动态 module + NestJS DI 边界                              | MEDIUM | 参考 office/slides 已有的 forFeature 模式（已审计过，可工作）                                    |
| 前端兼容（事件前缀 / endpoint 路径）                      | LOW    | TeamConfig 保留 endpointPrefix=agent-playground / eventPrefix=agent-playground 即可              |
| 13 stage 逐个删除时漏改 module / DI 注册                  | MEDIUM | R2-C 拆 commit 进行：每删 1 stage 跑测试                                                         |
| W21/W22 主线波次冲突                                      | LOW    | mission-pipeline 在 harness/teams 子聚合下，与 W21（memory）/ W22（base layer 定制代码归位）正交 |
| harness/teams 现有 TeamConfig 与新 MissionTeamConfig 冲突 | MEDIUM | MissionTeamConfig extends TeamConfig，新增可选字段，不破坏现有 ITeam                             |

---

## 七、回滚策略

每个 PR 单独 commit，可独立 revert：

- **R1-A/B/C/D 完成但 R2 未做**：harness 多了 mission-pipeline 子聚合，playground 不变。零回滚成本。
- **R2-A 双轨期发现新框架有漏**：playground 仍跑旧实现（旧代码未删），新 config 可禁用。
- **R2-C 删除阶段发现回归**：从 R2-A commit 上 cherry-pick 旧文件回来。

---

## 八、与现有 W21 / W22 主线波次的关系

| W21（memory 契约收敛）        | 与本方案                                   | 影响                                    |
| ----------------------------- | ------------------------------------------ | --------------------------------------- |
| checkpoint 主 contract 唯一化 | mission-checkpoints 表用 W21 唯一 contract | R1-C 实施前对齐 W21 checkpoint contract |
| memory tool provider 化       | 不冲突                                     | —                                       |

| W22（base layer 定制代码归位） | 与本方案                                                          | 影响                                              |
| ------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------- |
| 伪通用能力下沉                 | 我们做的就是这个                                                  | mission-pipeline 是 W22 实施的具体载体            |
| facade 稳定面瘦身              | R1 完成后 harness/facade 增加 mission-pipeline export，反而增加面 | 通过 sub-facade（domain/team-mission.facade）隔离 |

---

## 九、需要拍板的决策点

1. **新 generic 表 vs 改 playground 表**？
   - 推荐 generic 表 + 旧表保留，零迁移风险
2. **playground 的 13 stage 抽 7 primitive，confidence？**
   - 我个人 80%，需 R1-A 完成后的 dry-run 验证最后 20%
3. **R2-A/B/C 之间是否预留观察期**？
   - 推荐 R2-A 后线上跑 1 周再做 R2-C 删除
4. **要不要先做 R3-A writing-team demo 再做 R2 playground 迁移**？
   - 推荐先做 R3-A 验证框架，发现框架问题改 R1，**再做 R2 playground 迁移**（playground 更复杂，风险更高）

---

## 十、实施时序（建议调整后）

```
W1:  R1-A mission-pipeline 框架 + 7 stage primitive
W2:  R1-B TeamConfig API + R1-C generic prisma 表 + R1-D dynamic controller/gateway
W3:  R3-A writing-team demo（先做小）
     ↓ 发现框架问题 → 修 R1
W4:  R2-A playground.config.ts 双轨上线
W5:  R2-B e2e 等价性验证（9 路 mission）
W6:  R2-C 删除 playground 旧实现 + R3-B 文档沉淀

总计 6 周，含 1-2 周缓冲。
```

---

## 十一、用户体验对比（最终）

| 维度                    | 现状                                        | 目标                                    |
| ----------------------- | ------------------------------------------- | --------------------------------------- |
| 新 ai-app 文件数        | ~80                                         | < 10                                    |
| 新 ai-app 代码行数      | ~5000                                       | ~200（不含 SKILL.md）                   |
| 开发新 agent 的最小知识 | 13 stage + 8 role + lifecycle + rerun + ... | "写 SKILL.md + TeamConfig 声明"         |
| AI Agent 自主开发可行性 | 不可行（业务装配理解门槛高）                | ✅ 可行（声明式）                       |
| playground 自身代码行数 | ~5000                                       | < 500（仅 config + 业务 hook SKILL.md） |

---

**v1 起草完成 — 等待 architect agent 内部评审。**
