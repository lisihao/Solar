# 扩展治理与目录优化执行清单

**日期：** 2026-05-02  
**状态：** 待执行  
**约束来源：**

- [16-ai-engine-harness-structure.md](D:/projects/codes/genesis-agent-teams/.claude/standards/16-ai-engine-harness-structure.md)
- [17-extension-governance.md](D:/projects/codes/genesis-agent-teams/.claude/standards/17-extension-governance.md)
- [extension-governance-and-customization-audit-2026-05-02.md](D:/projects/codes/genesis-agent-teams/docs/audits/extension-governance-and-customization-audit-2026-05-02.md)

---

## 1. 目标

本清单用于把扩展治理标准转化为可执行整改项，并确保目录优化与能力边界同步推进。

**执行顺序强约束：**

1. 先 `ai-infra`
2. 再 `ai-engine`
3. 再 `ai-harness`
4. 最后才是 `ai-app` 消费侧收敛

在基础层（infra / engine / harness）未完成归类、命名、契约唯一化前，**不展开 app 主体整改**。

---

## 2. P0 清单

### P0-1. 主线 SkillRegistry 唯一化

现状：

- engine 有主线 `SkillRegistry`
- harness 仍有 `BuiltInReActSkillRegistry`

目标：

- engine 保留唯一主线 `SkillRegistry`
- harness 内部注册表降格为 `BuiltInSkillCatalog` / `BuiltinSkillSource`

涉及目录：

- `backend/src/modules/ai-engine/skills/registry/`
- `backend/src/modules/ai-harness/agents/builtin-skills/`
- `backend/src/modules/ai-harness/agents/learning/`
- `backend/src/modules/ai-harness/harness.module.ts`

动作：

- 重命名 harness 内部 registry 语义
- 调整 learning coordinator 写入路径
- 更新 facade/export/test

### P0-2. Memory tool 反向注册治理

现状：

- `ai-harness/memory/working/memory.module.ts` 在 `onModuleInit()` 中把 memory tools 注册进 engine `ToolRegistry`

目标：

- 建立正式的 `memory tool provider` 契约
- 禁止长期依赖隐式反向注册

涉及目录：

- `backend/src/modules/ai-harness/memory/working/`
- `backend/src/modules/ai-harness/memory/tools/`
- `backend/src/modules/ai-engine/tools/`

动作：

- 明确 memory tool 的 provider surface
- 重构注册入口
- 为后续 manifest 契约预留接口

### P0-3. Checkpoint 主契约唯一化

现状：

- `memory/checkpoint/`
- `memory/state-checkpoint/`

目标：

- 统一 `CheckpointStore` / `CheckpointScope` 顶层语义
- 区分 agent / mission / session scope，而不是双主语义并存

涉及目录：

- `backend/src/modules/ai-harness/memory/checkpoint/`
- `backend/src/modules/ai-harness/memory/state-checkpoint/`

动作：

- 对齐命名
- 抽统一 contract
- 收敛测试命名与导出结构

### P0-4. 测试碎片命名清理

现状：

- `supplemental` 107 个
- `extra` 29 个
- `legacy` 7 个

目标：

- 只保留 `spec / integration / e2e` 三类后缀

动作：

- 先按目录批量登记
- 再合并/改名
- 最后补守护规则

---

## 3. P1 清单

### P1-1. facade 稳定面中的领域接口复核（仍属 core 范围）

候选：

- `ai-engine/facade/abstractions/research.interface.ts`
- `ai-engine/facade/abstractions/simulation.interface.ts`

目标：

- 判断是否为跨域稳定能力接口
- 如否，先从 core facade 稳定面移出；app 落位留到基础层收敛后再做

### P1-2. engine 中的“业务线沉淀能力”复核

候选：

- `ai-engine/content/figure/`
- `ai-engine/tools/categories/processing/template-render.tool.ts`

目标：

- 判断是真通用能力还是单业务上浮

### P1-3. harness built-in skill packs 与 runtime core 解耦

候选：

- `leader-mid-mission-assess`
- `mece-mission-planning`
- `multi-judge-mission-review`

目标：

- 把玩法型 skill 与 runtime core 结构解耦

### P1-4. collaboration / todo / mission executor 语义收敛

候选：

- `ai-harness/teams/collaboration/todo/`
- `ai-harness/lifecycle/manager/mission-executor.service.ts`

目标：

- 明确哪些是通用原语
- 哪些应下沉到领域装配层

---

## 4. 目录优化建议

### 4.1 ai-harness/memory

建议目标结构：

```text
memory/
├── working/             # 运行态 working memory
├── semantic/            # 语义记忆与召回协调
├── checkpoint/          # 统一 checkpoint contract + scoped implementations
├── consolidation/       # 原 dream/ 收敛
├── indexing/            # 原 auto-index/ 收敛
├── stores/              # 内部 store 实现
└── tools-provider/      # 向 engine 提供 memory tools 的正式 provider
```

说明：

- `dream/` 应并入 `consolidation/`
- `auto-index/` 应并入 `indexing/`
- `tools/` 不应长期作为“直接反向注册入口”

### 4.2 ai-harness/agents/builtin-skills

建议目标结构：

```text
agents/
├── builtin-skills/
│   ├── catalog/
│   ├── loader/
│   ├── activator/
│   └── packs/
```

说明：

- `skill.registry.ts` 语义降级为 catalog/source
- `built-in/` 更适合改为 `packs/`

### 4.3 ai-engine/facade/abstractions

建议目标：

- 只保留稳定跨域能力接口
- 业务命名接口迁回领域 port

### 4.4 测试目录

建议目标：

- 同一主题测试优先合并回主 spec
- 无法合并时，使用 `integration` 明示层级
- 禁止继续增长 `supplemental/extra/legacy`

---

## 5. 波次建议

### W18 前

1. 固化 `17-extension-governance.md`
2. 先冻结 `backend/prisma/**` 与 `src/common/prisma/**` 的双层归属
3. 确认 ai-infra 首批边界裁决与目标命名
4. 确认 P0-1 / P0-2 / P0-3 的目标命名和 contract
5. 冻结新增碎片化测试命名

### W18

1. ai-infra 命名规范与边界说明先对齐
2. 先处理 database / storage / credits / db-governance / credentials 首批对象
3. 同步清理 ai-infra 测试碎片命名

### W19 前

1. 先清理基础层测试碎片命名
2. 完成 ai-engine 首批伪通用与 facade 稳定面候选复核
3. 确认 harness built-in skill / memory 目录目标结构

### W19

1. ai-engine 命名规范对齐
2. 同时处理 engine 侧“伪通用”候选

### W20 前

1. 收敛 harness memory / builtin-skills / collaboration 目标结构
2. 关闭 engine / infra 侧 blocker 后再进入 harness 主体波次

### W20

1. ai-harness 命名规范对齐
2. 同时处理 memory / builtin-skills / collaboration 归位

### W20+

1. 引入正式 manifest / provider contracts
2. 补 extension / memory / customization 自动化守护

---

## 6. 逐项登记模板

| 文件/目录 | 分类       | 当前问题                   | 目标位置/目标语义              | 动作                                        | 优先级 | 波次 |
| --------- | ---------- | -------------------------- | ------------------------------ | ------------------------------------------- | ------ | ---- |
| 示例      | C 业务定制 | 位于 core 但只服务单一业务 | 先从 core 波次剔除，标记待下沉 | move/remove-from-core + later app placement | P1     | W18  |

---

## 7. 首批整改台账

下表是基于 2026-05-02 首轮审计整理出的**第一批基础层必须处理对象**。后续执行时，按波次逐项关闭，不再从零散审计笔记里回溯。

| 文件/目录                                                                                           | 分类             | 当前问题                                                                                         | 目标位置/目标语义                                | 动作                                         | 优先级 | 波次 |
| --------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------ | -------------------------------------------- | ------ | ---- |
| `backend/src/modules/ai-harness/agents/builtin-skills/skill.registry.ts`                            | D 过渡残留       | 仍承担 registry 命名与主线语义，和 engine 主注册中心并存                                         | `catalog/` 或 `source/` 语义                     | rename + API 收窄 + 调整引用                 | P0     | W20  |
| `backend/src/modules/ai-harness/agents/builtin-skills/skill-loader.ts`                              | B 领域装配       | 当前围绕旧 registry 语义组织                                                                     | `builtin-skills/loader/`                         | move + import rewrite                        | P1     | W22  |
| `backend/src/modules/ai-harness/agents/builtin-skills/skill-activator.ts`                           | B 领域装配       | fallback 到 engine 主 SkillRegistry，但边界仍偏过渡态                                            | `builtin-skills/activator/`                      | move + contract 对齐                         | P1     | W22  |
| `backend/src/modules/ai-harness/agents/builtin-skills/built-in/`                                    | D 过渡残留       | `built-in` 目录表达弱，不利于区分 runtime core 与 skill packs                                    | `builtin-skills/packs/`                          | rename subtree + import rewrite              | P1     | W22  |
| `backend/src/modules/ai-harness/agents/learning/skill-learning-coordinator.ts`                      | B 领域装配       | 仍直接面向 harness built-in registry 写入                                                        | engine 主 skill registration contract            | contract rewrite                             | P0     | W20  |
| `backend/src/modules/ai-harness/memory/working/memory.module.ts`                                    | D 结构过渡       | `onModuleInit()` 反向注册 memory tools 到 engine ToolRegistry                                    | `tools-provider/` 或 provider contract 入口      | split responsibilities + rewire registration | P0     | W21  |
| `backend/src/modules/ai-harness/memory/tools/`                                                      | D 结构过渡       | 长期作为反向注册入口，不是稳定 provider surface                                                  | `memory/tools-provider/` 或等价 provider subtree | move + rename + contract 对齐                | P0     | W21  |
| `backend/src/modules/ai-harness/memory/dream/`                                                      | D 命名不规范     | `dream` 不是目标标准词                                                                           | `memory/consolidation/`                          | subtree rename                               | P0     | W21  |
| `backend/src/modules/ai-harness/memory/auto-index/`                                                 | D 命名不规范     | `auto-index` 不是目标标准词                                                                      | `memory/indexing/`                               | subtree rename                               | P0     | W21  |
| `backend/src/modules/ai-harness/memory/checkpoint/`                                                 | A 通用内核       | 与 `state-checkpoint/` 并存，主 contract 未统一                                                  | `checkpoint/` scoped implementation              | contract extraction + rename cleanup         | P0     | W21  |
| `backend/src/modules/ai-harness/memory/state-checkpoint/`                                           | D 过渡残留       | mission/job checkpoint 成为第二套主语义                                                          | 合并到统一 `checkpoint/` 语义下                  | merge contract + scope-based rename          | P0     | W21  |
| `backend/src/modules/ai-engine/facade/abstractions/research.interface.ts`                           | C 高疑似业务定制 | facade 稳定面中出现 app 领域命名                                                                 | 保留为能力导向接口，或从 core facade 稳定面移除  | review + move/rename                         | P1     | W22  |
| `backend/src/modules/ai-engine/facade/abstractions/simulation.interface.ts`                         | C 高疑似业务定制 | facade 稳定面中出现 app 领域命名                                                                 | 保留为能力导向接口，或从 core facade 稳定面移除  | review + move/rename                         | P1     | W22  |
| `backend/src/modules/ai-engine/content/figure/figure-extractor.service.ts`                          | C 高疑似伪通用   | 来源于 `topic-insights`，需证明已通用化                                                          | 保留在 engine，或从本波次剔除并标记待下沉        | importer audit + capability review           | P1     | W18  |
| `backend/src/modules/ai-engine/tools/categories/processing/template-render.tool.ts`                 | C 高疑似伪通用   | 需证明其不是单业务模板渲染能力                                                                   | 保留在 engine 或下沉到 app 域                    | importer audit + capability review           | P1     | W18  |
| `backend/src/modules/ai-harness/teams/collaboration/todo/`                                          | C 高疑似业务定制 | TODO 语义未证明是通用协作原语                                                                    | app 团队域或保留为通用协作原语                   | review + move if needed                      | P1     | W22  |
| `backend/src/modules/ai-harness/lifecycle/manager/mission-executor.service.ts`                      | B 领域装配       | `mission-executor` 命名稳定，但需确认是否属于 lifecycle 还是 runner orchestration                | 保留在 lifecycle 或归并至 runner plan-execution  | ownership review                             | P1     | W22  |
| `backend/src/modules/ai-harness/agents/builtin-skills/built-in/leader-mid-mission-assess/SKILL.md`  | C 玩法型 skill   | 玩法/流程色彩强，不应伪装成 runtime core                                                         | built-in skill pack                              | keep but recategorize                        | P1     | W22  |
| `backend/src/modules/ai-harness/agents/builtin-skills/built-in/mece-mission-planning/SKILL.md`      | C 玩法型 skill   | 同上                                                                                             | built-in skill pack                              | keep but recategorize                        | P1     | W22  |
| `backend/src/modules/ai-harness/agents/builtin-skills/built-in/multi-judge-mission-review/SKILL.md` | C 玩法型 skill   | 同上                                                                                             | built-in skill pack                              | keep but recategorize                        | P1     | W22  |
| `backend/prisma/`                                                                                   | A 数据库资产层   | 当前位于 backend 根目录；需明确它是 workspace 级 schema/migration/seed 资产，而不是 ai-infra runtime module | 保持 backend 根级数据库资产层                    | ownership note + standard freeze             | P0     | W20  |
| `backend/src/common/prisma/`                                                                        | A 共享持久化底座 | Prisma runtime 供所有层复用；需明确它与 `backend/prisma/` 分层，不与 Nest 业务模块混放            | 保持 shared runtime substrate；后续如重组仅能收敛为 `persistence/database-runtime` 语义 | boundary note + naming proposal              | P0     | W20  |
| `backend/src/modules/ai-infra/abstractions/ai-services.interfaces.ts`                               | D 命名不规范     | 使用非标准复数后缀 `.interfaces.ts`，且位于 infra 稳定抽象面                                     | `ai-services.interface.ts` 或按职责拆分          | rename + interface surface review            | P1     | W20  |
| `backend/src/modules/ai-infra/storage/governance/__tests__/storage-governance.service.edge-cases.spec.ts` | D 测试碎片       | 原 `supplemental` 已更名，但仍需继续评估是否并回主 spec                                          | 合并回主 spec 或改为 `integration`               | merge/rename                                 | P0     | W19  |
| `backend/src/modules/ai-infra/auth/__tests__/auth.service.supplemental.spec.ts`                     | D 测试碎片       | `supplemental` 后缀不允许继续保留                                                                | 合并回主 spec 或改为 `integration`               | merge/rename                                 | P0     | W19  |
| `backend/src/modules/ai-infra/auth/__tests__/auth.service.legacy.spec.ts`                           | D 测试碎片       | `legacy` 后缀不允许继续保留                                                                      | 合并回主 spec、删除或改为 `integration`          | merge/delete/rename                          | P0     | W19  |
| `backend/src/modules/ai-infra/credentials/key-resolver/`                                            | A 通用内核       | 属于基础层 provider/key resolution 核心能力，需确认其 contract 不被 app 语义污染                 | 保留在 infra credentials bounded context         | contract review + exporter audit             | P1     | W20  |
| `backend/src/modules/ai-infra/credentials/user-model-configs/`                                      | B 领域装配       | 与 engine `llm/user-config` 存在跨层协作边界，需确认职责切分准确                                 | 保留在 infra user-owned configuration surface    | ownership review + boundary note             | P1     | W20  |
| `backend/src/modules/ai-infra/storage/`                                                             | A 通用内核       | 聚合过大；虽已拆出 `runtime/` 与 `governance/`，但治理聚合仍较重                                 | 保留在 infra，但继续细分 runtime vs governance   | split review + submodule proposal            | P1     | W21  |
| `backend/src/modules/ai-infra/storage/topic-report-storage.service.ts`                              | C 高疑似业务定制 | 明确围绕 `topic_reports.full_report` 提供领域包装；虽依赖 infra object storage，但语义属于 topic-insights/report | 迁出 infra core，改为 app 侧适配器或受控 bridge  | move candidate review + importer audit       | P0     | W22  |
| `backend/src/modules/ai-infra/db-governance/`                                                      | B 基础设施治理   | 含大量 AI/office/custom table policy 映射，需确认其仍属 infra table governance，而非业务配置汇总 | 保留在 infra table governance                    | ownership review + policy boundary audit     | P1     | W21  |
| `backend/src/modules/ai-infra/credits/`                                                             | B 基础设施治理   | 已拆出 `policy/` 与 `rewards/`，但产品线计费策略仍需继续从通用账本语义中隔离                      | 保留 infra ledger/quota core；策略侧逐步抽离为受控 policy surface | split ledger vs policy review                | P1     | W21  |

### 7.1 当前不展开的 app/open-api 清单

以下目录确认存在碎片测试或消费侧结构债，但**当前不作为主整改对象**。它们只在 core 归位时提供反向证据，不进入本阶段主体任务：

| 目录                                         | 现状                                 | 当前策略                 |
| -------------------------------------------- | ------------------------------------ | ------------------------ |
| `backend/src/modules/ai-app/topic-insights/` | `supplemental` 测试最密集            | 后置到 app 波次          |
| `backend/src/modules/ai-app/office/slides/`  | orchestrator/controller 补丁 spec 多 | 后置到 app 波次          |
| `backend/src/modules/ai-app/social/`         | adapter / service 碎片测试多         | 后置到 app 波次          |
| `backend/src/modules/open-api/admin/`        | controller / service 补丁 spec 多    | 后置到 app/open-api 波次 |

### 7.2 基础层测试碎片首批清理目录

这些目录在 W19/W22 前应优先处理，因为它们属于基础层且集中携带 `supplemental` / `extra` / `legacy` 残留：

| 目录                                                    | 现状                                           | 动作                       | 波次      |
| ------------------------------------------------------- | ---------------------------------------------- | -------------------------- | --------- |
| `backend/src/modules/ai-harness/agents/builtin-skills/` | supplement spec 残留                           | 合并 + registry 重命名同步 | W20 / W22 |
| `backend/src/modules/ai-harness/memory/`                | checkpoint / provider 相关测试将随目录重构移动 | 合并 + 命名收敛            | W21       |
| `backend/src/modules/ai-infra/auth/`                    | 存在 `supplemental` / `legacy` 测试残留        | 合并 + 命名收敛            | W19       |
| `backend/src/modules/ai-infra/storage/`                 | 已改为 `governance/*edge-cases.spec.ts` 等命名 | 合并 + 命名收敛            | W19       |

### 7.3 目录优化优先顺序

执行顺序固定如下：

1. 先统一 contract，再移动目录
2. 先完成 infra / engine / harness 的归类正确性，再处理 app 消费侧
3. 先清理基础层测试碎片，再做 harness 命名大波次
4. 先确认伪通用是否剔出 core，再决定是否后续下沉到 app
5. 任何 facade 稳定面变更都必须最后做，并同步 exporter/importer

### 7.4 ai-infra 当前重点

`ai-infra` 本阶段不是大规模 rename 主战场，但有四类基础工作必须跟上：

1. **测试碎片命名清理**
2. **抽象面后缀规范化**
3. **credentials 与 engine `llm/user-config` / `llm/key-health` 的职责边界确认**
4. **storage / db-governance 的过大聚合复核**
5. **database 资产层与 runtime 持久化底座的双层边界冻结**

### 7.4.1 ai-infra 顶层目录裁决

| 目录 | 裁决 | 说明 |
| --- | --- | --- |
| `abstractions/` | 保留 | 基础 DI token 与稳定抽象面 |
| `auth/` | 保留 | 身份认证基础能力，继续防止 app 语义渗入 |
| `credentials/` | 保留 | 唯一 credentials bounded context |
| `credits/` | 保留并继续拆分 | 已拆出 `policy/` 与 `rewards/`，后续继续收敛产品线策略 |
| `db-governance/` | 保留 | 基础设施治理边界，继续复核 policy 是否过宽 |
| `email/` | 保留 | 基础通知通道 |
| `encryption/` | 保留 | 基础加解密原语 |
| `facade/` | 保留 | 对外稳定入口，不作为能力堆积点 |
| `monitoring/` | 保留并复核 | 保留基础监控，但持续复核领域通知/保留策略是否过宽 |
| `notifications/` | 保留并复核 | 保留站内通知基础能力，继续复核是否混入 app 级模板语义 |
| `release/` | 保留并复核 | 保留版本/公告底座，继续复核是否混入产品线内容管理 |
| `secrets/` | 保留 | 系统级密钥资产 |
| `settings/` | 保留并复核 | 保留系统设置，继续防止产品专属配置无约束增长 |
| `storage/` | 保留并继续拆分 | 已拆出 `runtime/` 与 `governance/`，治理聚合继续细化 |

### 7.5 database / prisma 归属裁决

1. `backend/prisma/**` 保持 backend 根级，不并入 `modules/ai-infra/**`
2. `backend/prisma/**` 只承载 schema / migrations / seed / diagnose / SQL scripts
3. `backend/src/common/prisma/**` 视为运行时共享底座，不与 migrations/seed 混放
4. 若后续要把 runtime database 能力进一步显式化，只能收敛为 `common/persistence` 或 `ai-infra/persistence-adapters` 一类语义，不能把资产层和 runtime 层合并

---

## 8. 完成判定

以下条件全部满足，才算“扩展治理与目录优化”完成：

1. 主线 registry 唯一
2. checkpoint 主 contract 唯一
3. memory 目录职责收敛
4. 测试后缀白名单落地
5. 定制代码已完成归类和归位
6. 标准文档、架构文档、整改清单一致

