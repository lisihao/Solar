# 评审结论：方案 v2 🔄 修订后可实施（v3）

**评审日期：** 2026-05-04
**评审者：** architect agent (内部，第二轮)
**被评审：** [`anthropic-sdk-revamp-plan-v2.md`](./anthropic-sdk-revamp-plan-v2.md)
**前置评审：** [`anthropic-sdk-revamp-review-v1.md`](./anthropic-sdk-revamp-review-v1.md)

整体结论：**v2 比 v1 显著进步**，方向 100% 正确（§0 把 base layer 业务无关摆到最高优先级），架构合理（7 primitive + IMissionStore + 薄壳 controller + 双轨上线）。但有 **3 项 P0 致命缺陷阻断 R0 启动 + 2 项 P0 阻断 R4 启动** + 5 项 P1 严重问题。修订到 v3 后可实施。

---

## 一、v1 评审 17 项落实情况

| #     | 项目                          | 状态              | v2 章节                                                                                 |
| ----- | ----------------------------- | ----------------- | --------------------------------------------------------------------------------------- |
| P0-1  | 撤回 mission-pipeline 子聚合  | ✅ 已落实         | §3.1（归位到 teams/orchestrator + teams/services/stages + lifecycle/mission-lifecycle） |
| P0-2  | 撤回 DynamicMissionController | ✅ 已落实         | §3.6（薄壳 controller in ai-app）                                                       |
| P0-3  | 撤回 generic mission_runs 表  | ⚠️ 部分落实       | §3.5 是的，但 **§3.8 复活了 generic 表 + metadata JSONB** ★ 新发现 #N1                  |
| P0-4  | 新增 R1-A0 SkillSpecBuilder   | ✅ 已落实         | §3.3.2 / §4 R1-A0                                                                       |
| P0-5  | forFeature spike              | ⚠️ 部分落实       | §4 R1-E（措辞含糊：通过/未通过两种走向都未明确）                                        |
| P1-6  | KPI 重新校准                  | ✅ 已落实         | §1.2（playground < 2500 行）                                                            |
| P1-7  | 不 extends TeamConfig         | ✅ 已落实         | §3.1 / §1.1                                                                             |
| P1-8  | stateful agent runtime        | ⚠️ 部分落实       | §3.4（解决了 1/3 个问题）                                                               |
| P1-9  | forTeam 不可绕过隔离          | ⚠️ 部分落实       | §3.5.3（每 ai-app 自有表免除问题，但 §3.8 复活 forAgent 模式无 isolation spec）         |
| P2-10 | R3-A 提前                     | ✅ 已落实         | §4                                                                                      |
| P2-11 | runtime_version 标记          | ✅ 已落实         | §4 R2-A                                                                                 |
| P2-12 | 9 路定性等价                  | ✅ 已落实         | §4 R2-B                                                                                 |
| P2-13 | 前端事件兼容性契约            | ❌ **未落实**     | 完全漏掉，需 v3 新增 §3.9                                                               |
| P2-14 | R2-C 真实回滚                 | ✅ 已落实         | §7（数据库不变性当回滚抓手）                                                            |
| P2-15 | W21 协调                      | ✅ 已落实         | §8                                                                                      |
| P2-16 | 18 SKILL.md 重组              | ✅ 已落实         | §4 R2-A0                                                                                |
| P2-17 | 时间重估                      | ✅ 已落实但仍低估 | §9（13 周，但实际 14-18 周）                                                            |

**小结**：17 项中 **13 项 ✅ / 3 项 ⚠️ / 1 项 ❌**。落实率显著提升（v1 评审后 v2 修订到位率 76%）。

---

## 二、新增章节质量评分

| 章节                        | 评分     | 关键问题                                                                                                                                                                                                                                  |
| --------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §0 基本原则                 | **6/10** | 方向正确，但 R0 工作量严重低估（实际 base layer 已有 **105 处 playground 字面** + report-artifact-assembler / critique-refine 等 service 含业务条件分支）；ESLint selector 配置不严谨；spec 黑白名单需文档化                              |
| §3.4 stateful agent runtime | **5/10** | 只解决了 stateful role decisions 持久化的 1/3 个问题：(a) 崩溃 resume 不自洽（in-memory ctx 没说存 store）；(b) 没覆盖 non-stateful role 副作用累计（s4PatchFailures）；(c) defaultExtractDecision phase 集合 generic vs 业务自定义没说清 |
| §3.7 前台 UI                | **4/10** | 5 步向导 Step 4 严重低估：简单模式 5 引导问题**只能生成 instructions body 不能生成 frontmatter**（allowedTools / allowedModels / outputSchemaRef 没问），跑起来必然报错；Step 5 topic schema editor 是 form-builder 级 UX，不是"5 步之一" |
| §3.8 用户自定义 Agent       | **3/10** | **3 项 fatal**：(a) `MissionPipelineConfig` 含 zod 实例 / function refs，不可 JSON 序列化；(b) `custom_agent_missions.metadata Json` 复活 v1 P0-3 反模式；(c) custom-agents 模块跨边界（不是业务 ai-app 但放 ai-app 层）                  |

---

## 三、新发现的问题（v2 引入的新风险）

### #N1：§3.8 复活了 v1 评审 P0-3 已撤的 "generic 表 + metadata JSONB" 反模式

v1 P0-3 砍掉 generic mission_runs 表（PostgreSQL TOAST 性能 + 业务索引消失）。v2 §3.8.1 把这个反模式原封不动地搬到 `custom_agent_missions.metadata Json`——用户自定义 Agent 跑出 50-200KB report 又是 detoast 性能问题。

### #N2：§3.4 stateful state 与 §3.5 IMissionStore 端口未对齐

`IMissionStore` 没列 `appendDecision/getDecisions`，但 §3.4 stateful 机制要求决策历史持久化（否则崩溃 resume 失效）。两节互不照应。

### #N3：§4 R4-B 前端 5 步向导 7-10 天严重低估

- TypeForm/Tally form builder 单独是月级工程
- Monaco markdown 编辑器 + frontmatter form + tools picker + topic schema form-builder 实际 15-20 天 + 1-2 轮 UX iteration
- v2 估 7-10 天不含 iteration buffer

### #N4：§5 13 stage → 7 primitive hook 行数估错

hook 总行数估 **1500-2000 行**（s4 dispatch ~300 / s8 judge consensus + memory + assembler ~450 / s10 accountability ~150 / s3 perItemPipeline ~450 / s12 postmortem ~150 / 其他 ~100），加 playground.config + controller + module + store + 8 SKILL.md = **2000-2700 行**，刚好踩 §1.2 KPI < 2500 行上限。**风险**：第二个 ai-app 出现，hook 越积越多，会有"是不是应该把 hook 抽 harness"的诱惑（违反 §0）。

### #N5：§9 时间表内部矛盾 + 缺 review/iteration buffer

累加 §4 各 R 阶段：60-82 天 = **12-16 周**（不是 13 周）。**没含 v2 评审/v3 评审/与用户决策来回的时间**（每个 R 阶段保守 1-2 天 review + 1 天修订）。诚实数字 **14-18 周**。

### #N6：harness 内部已存在 playground 业务条件分支（不是常量）

`harness/evaluation/critique/report-artifact-assembler.service.ts` L454-480 确认有运行时 playground 专属逻辑：

- 注释 `// playground 当前仅支持中文 mission`
- 业务条件分支（playground 专属预处理）

这些不是 BUILTIN_TEAMS 常量级别小改动，是**真业务逻辑泄漏**。R0 实际工作量被严重低估。

---

## 四、可实施性评估

| 维度                                  | 评估                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 13 周时间估                           | ❌ 低估，真实 **14-18 周**（含 review/iteration buffer + R0 真实清理工作量 + R4 form-builder UX） |
| 7 primitive + hooks 装 13 stage       | ⚠️ 勉强可行但 hook 会膨胀（playground 业务代码会刚好踩 KPI 上限）                                 |
| §0 自动化看护                         | ❌ ESLint selector 不严谨；现有代码 105 处违规 + business 条件分支不是"删常量"能搞定              |
| 第二个 ai-app（writing-team）能否跑通 | ✅ 可行（R3-A demo 是验证抓手）                                                                   |
| 用户自定义 Agent                      | ❌ §3.8 三项 fatal 缺陷阻断 R4 启动                                                               |

---

## 五、修订建议（v3 必修项）

| 优先级   | 修订项                                                                                                                                                                                                                                    | 影响章节     |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **P0-A** | 重估 R0 工作量从 3.5 天 → 5-7 天，含 harness 内部 105 处 playground 字面 + report-artifact-assembler / critique-refine / section-self-eval 等 service 的 playground 业务条件分支清理                                                      | §0.4         |
| **P0-B** | §0.3 ESLint selector 补全：明确 ALLOWLIST_PATHS（含 `**/__tests__/**`）+ 区分 Literal vs MemberExpression + 给完整可执行配置示例                                                                                                          | §0.3         |
| **P0-C** | §3.8 定义 `SerializableMissionPipelineConfig` 子集类型（无 storeFactory / topicSchema 用 JSON Schema / hooks 仅 skillId 字符串），用户自定义 Agent 限定此子集                                                                             | §3.8         |
| **P0-D** | §3.8 `custom_agent_missions` 拆出大产物：单独 `custom_agent_artifacts` 表 / 对象存储 / 限制 metadata < 5KB                                                                                                                                | §3.8.1       |
| **P0-E** | §3.7.4 简单模式补 frontmatter 字段引导（工具选择 / 模型选择 / outputSchema 选择 UI 组件），或承认简单模式 = wizard 默认填全 frontmatter                                                                                                   | §3.7.4       |
| **P0-F** | §3.4 加跨 stage state 持久化：(a) IMissionStore 加 `appendDecision/getDecisions` 端口；(b) playground 表加 `leader_decisions JSONB` 列 + 手写迁移；(c) `ctx.crossStageState` 通用容器解决 non-stateful role 副作用累计（s4PatchFailures） | §3.4 / §3.5  |
| **P0-G** | §3.8 prompt 注入安全双轨：入库 scanner + tool ACL 强制（无论 SKILL.md 怎么说，allowedTools 是 hard limit）+ 用户自定义 Agent 默认禁用 internal tools                                                                                      | §3.8 / §6    |
| P1-H     | §3.8.2 custom-agents 模块归位：standards/16 加 L3.5 meta layer 或显式说明 custom-agents 是特殊 ai-app                                                                                                                                     | §3.8.2       |
| P1-I     | 加 §3.9 前端事件兼容性契约：列出 27+ event type 名 + payload 字段 byte-equal 保留矩阵                                                                                                                                                     | 新增 §3.9    |
| P1-J     | §4 R4-B 前端时间 7-10 天 → 15-20 天 + 1-2 轮 UX iteration                                                                                                                                                                                 | §4 R4-B / §9 |
| P1-K     | §5 加 hook 行数估算列，验证 playground 业务代码总行数（含 hook）仍 < 2500；或调整 KPI 到 2500-3000                                                                                                                                        | §5 / §1.2    |
| P1-L     | §9 时间表加 review/iteration buffer 1-2 周，诚实总数 **14-18 周**                                                                                                                                                                         | §9           |
| P1-M     | §3.8.2 `ScopedCustomAgentMissionStore` 加 isolation spec 测试约束 + 不可绕过 agentConfigId 注入文档                                                                                                                                       | §3.8.2       |

---

## 六、最终判断

**v2 现状：🔄 不可直接进入 R0 实施。修订到 v3 后可以。**

### 推荐执行顺序

1. **本轮 v2 评审反馈作者** → 回 v3，重点修 P0-A ~ P0-G 七项致命缺陷
2. v3 评审通过 → 启动 R0 + R1-A0（不依赖 R4 决策），平行做 R4 设计 spike（用户自定义 Agent 序列化方案 / 安全方案）
3. R0 实战发现的"真实 base layer 清理工作量"再校准 v3 总时间表
4. R3-A writing-team demo 完成且 framework 稳定后再启动 R2 playground 迁移
5. R4 单独后期阶段，serialization 方案不通过则**砍掉 R4**（不阻塞核心改造）

---

## 七、评审参考的实际代码（已 grep / 已读）

- `harness/teams/abstractions/team.interface.ts` L20-29：BUILTIN_TEAMS 确认
- `harness/teams/abstractions/role.interface.ts` L14-30：BUILTIN_ROLES 确认
- `harness/agents/domain/builtin-agent-catalog.ts`：BUILTIN_AGENTS + AGENT_CONFIGS 含 "AI Slides" / "智能 PPT" / 📊 业务文案
- `harness/agents/builtin-skills/built-in/` 18 个目录（含 dimension-research / report-meta-critic / mece-mission-planning / leader-foreword 等 SKILL.md，**业务概念已在 harness 沉淀**——v2 §0 没说这些算不算违规）
- harness 内 `playground` / `agent-playground` 字面 grep **105 处**（远超 v2 R0 估算）
- harness 内 generic SDK 词 `researcher / writer / reviewer / leader` 出现 946 次跨 109 文件（v2 黑名单**正确地不含**这些词，无误报风险）
- ai-app 内 `BUILTIN_TEAMS / BUILTIN_AGENTS / BUILTIN_ROLES` importer 全项目 246 处
- `ai-app/agent-playground/agents/` 18 个 soul/duty.md 实测确认
- s4-leader-assess (714 行) / s8-writer-draft (701 行) / s3-researcher-collect (796 行) 内核确认业务专属逻辑确实存在
- `harness/evaluation/critique/report-artifact-assembler.service.ts` L454-480 确认 harness 内有 playground 业务条件分支
- `SkillSpecBuilder` / `OutputSchemaRegistry` / `fromSkill` 全项目 grep **0 命中**（R1-A0 确实是新写）
- `defineMissionPipeline` / `MissionPipelineConfig` / `IMissionStore` 全项目 grep **0 命中**（R1-B/R1-C 确实是新写）
