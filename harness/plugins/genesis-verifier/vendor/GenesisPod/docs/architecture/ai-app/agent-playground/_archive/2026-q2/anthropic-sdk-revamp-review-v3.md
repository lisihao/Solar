# 评审结论：方案 v3 🔄 修 2 项 P0-NEW 后可进 R0 实施

**评审日期：** 2026-05-04
**评审者：** architect agent (内部，第三轮 / 终审)
**被评审：** [`anthropic-sdk-revamp-plan-v3.md`](./anthropic-sdk-revamp-plan-v3.md)
**前置：** [v1 评审](./anthropic-sdk-revamp-review-v1.md) / [v2 评审](./anthropic-sdk-revamp-review-v2.md)

整体结论：**v3 比 v2 显著进步**，**12 项 v2 评审反馈 11 项已合格落实，1 项基本到位但有边角缺陷**。新发现 8 项问题中 **2 项 P0**（必修才能进 R0）+ 3 项 P1（R1 内修）+ 3 项 P2（实施过程修）。**修完 P0-NEW-1 / P0-NEW-2 后即可进 R0 实施。**

---

## 一、v2 评审 12 项落实情况

| #     | v2 评审项                                         | v3 章节         | 状态                 |
| ----- | ------------------------------------------------- | --------------- | -------------------- |
| P0-A  | R0 工作量 3.5 → 10-12 天                          | §0.5            | ✅                   |
| P0-B  | ESLint 完整可执行配置                             | §0.4 看护 2     | ✅                   |
| P0-C  | SerializableMissionPipelineConfig 子集类型        | §3.9.1          | ✅                   |
| P0-D  | custom_agent_artifacts 拆分大产物                 | §3.9.2          | ✅                   |
| P0-E  | 简单模式补 frontmatter wizard                     | §3.8.4          | ✅                   |
| P0-F  | stateful 自洽（appendDecision + crossStageState） | §3.4            | ✅                   |
| P0-G  | prompt 注入安全双轨                               | §3.9.4          | ✅                   |
| P1-H  | custom-agents 跨边界归位 L3.5                     | §3.1 / §0.1     | ✅                   |
| P1-I  | 前端事件兼容性契约章节                            | §3.7            | ⚠️ spec 实现策略含糊 |
| P1-J  | R4-B 前端时间 7-10 → 15-20 天                     | §4 R4-B / §9    | ✅                   |
| P1-K  | hook 行数估算列                                   | §5              | ✅                   |
| P1-L  | 14-18 周诚实数字                                  | §9              | ✅                   |
| P1-M  | ScopedCustomAgentMissionStore isolation spec      | §3.9.5 / §3.9.6 | ✅                   |
| P2-13 | 前端事件兼容性                                    | §3.7            | ⚠️ 同 P1-I           |

**小结：13 项 ✅ / 2 项 ⚠️（同根因）。落实率 92%。**

---

## 二、v3 引入的新问题（8 项）

### 🔴 P0-NEW-1：§0.3 Action 3 把 builtin-skills 17 个 SKILL.md 全部下推，破坏 BuiltinSkillCatalog 设计意图 + 注册时序未定

**实读源码确认**：

- `harness/agents/builtin-skills/skill-registry.ts` 注释：「ReAct/Agent runtime 内置 skill 目录」
- `harness/agents/builtin-skills/skill-loader.ts` L19：`BUILT_IN_DIR = path.resolve(__dirname, "built-in")` —— harness 启动时硬扫
- 17 个目录确实都是 playground 业务概念（dimension-research / leader-foreword 等）—— v3 §0.2 判定违规正确

**问题**：

- v3 §0.3 Action 3 写 "BuiltinSkillCatalog 改为 generic registry...由 ai-app onModuleInit 注册"
- harness `BuiltinSkillCatalog.register(skill)` 给 ai-app 调用 + harness 内部 `agent-runner.service.ts` 消费 = **合法 IoC**
- **但 NestJS OnModuleInit 顺序由模块依赖图决定**，如果 SkillLoader 先跑（empty register），ai-app 再 register，OK；如果反向，runtime 找 skill not found

**修订建议**（已落到 v3）：

1. §0.3 Action 3 加："注册时序保证：ai-app 模块必须 `imports: [AIHarnessFacadeModule]`，使 ai-app `onModuleInit` 在 SkillLoader 之后执行"
2. 加单测约束 SkillLoader.BUILT_IN_DIR 为空目录（永久门槛）

### 🔴 P0-NEW-2：§3.8.5 topic schema MVP 限定 key-value 列表无法表达 playground RunMissionInputSchema 的 9 个非 string/enum 字段

**实读 dto/run-mission.dto.ts 确认**，playground RunMissionInputSchema 含：

- `withFigures: boolean`
- `concurrency: number int 1-10 default 3`
- `maxCredits: number optional`
- `wallTimeMs: number optional`
- `budgetMultiplierOverride: number optional`
- `knowledgeBaseIds: array<uuid> optional`

**v3 §3.8.5 列的"string / enum / required" 三类不够**，6+ 字段表达不了。

**后果**：用户复制 playground 模板时 topicSchema 丢失，§3.8.3 Step 2 "复制平台模板"必报错。

**修订建议**（已落到 v3）：MVP 字段类型扩到 `string / number / boolean / enum / array<string>`，每类配相应约束。

### 🟡 P1-NEW-1：§3.7.3 前端契约 spec 实现策略不严谨

v3 §3.7.3 写"启动时遍历 events 注册的 type，断言完全等于 v2 evolution 之前的快照"——**没说 fixture 怎么生成、checked-in 哪里、payload 字段怎么测**。

**修订建议**（R1 内修）：

- (a) event type 字符串集合：与 `fixtures/playground-event-types.snapshot.ts` 严格相等
- (b) 每 event payload 字段：jsonSchema 校验
- (c) 关键 enum 取值集合：与 `fixtures/playground-enums.snapshot.ts` 严格相等

### 🟡 P1-NEW-2：§3.4.5 `ctx.store` 字段未在 MissionContext 接口定义

v3 §3.4.5 代码示例 `await ctx.store.getDecisions(...)` —— `ctx.store` 是新设计字段还是 DI 注入？v3 没说。现有 `MissionContextPackage`（grep 命中）不含 store 字段。§3.2 写 stateful state 通过 hook 写入，§3.4.5 又写 stage primitive 直接调 store —— **互相矛盾**。

**修订建议**（R1 内修）：明确 stage primitive 收 `storeAdapter: { appendDecision, getDecisions, ... }` 入参（DI 注入到 primitive 构造），保持 ctx 是纯数据。

### 🟡 P1-NEW-3：§3.9.1 zod ↔ JSON Schema 转换非 1:1 mapping，平台模板无法完整序列化

`json-schema-to-zod` 不能逆向 zod refinements / transforms / preprocess。复制 playground 模板时 zod-only 特性静默丢失。

**修订建议**（R1 内修）：§3.9.1 加 caveat 说明转换有损 + UI 给用户 warning。

### 🟢 P2-NEW-1：§0.5 R0 上限 12 天 vs §9 时间表 W1-2 仅 10 天

W1-2 = 10 工作日，R0 跑到 12 天会推迟时间表。建议 W1-2.5 或加 buffer。

### 🟢 P2-NEW-2：§5 hook 行数 2920 紧贴 §1.2 KPI 3000 上限

真实落地几乎必然超 5-10%。建议 KPI 调到 < 3500 或加 buffer 警告。

### 🟢 P2-NEW-3：§3.4 IMissionStore 塞 4 个新 method 违反 ISP

未来 short-circuit store 也得实现这 4 个。建议拆 IMissionStateStore 子接口。

---

## 三、最终判断

**v3 状态：🔄 修 2 项 P0-NEW 后即可进入 R0 实施。**

### 必修门槛（进 R0 前）

1. **P0-NEW-1**：§0.3 Action 3 加注册时序保证 + builtin-skills 空目录看护
2. **P0-NEW-2**：§3.8.5 topic schema 字段类型扩到 5 类

### R1 内修

- P1-NEW-1 / P1-NEW-2 / P1-NEW-3

### 实施过程修

- P2-NEW-1 / P2-NEW-2 / P2-NEW-3

---

## 四、评审参考的实际代码（已读）

- harness/agents/builtin-skills/skill-registry.ts（BuiltinSkillCatalog 设计意图）
- harness/agents/builtin-skills/skill-loader.ts（OnModuleInit 硬扫 built-in 目录）
- harness/agents/builtin-skills/built-in/ 17 个目录（确认全是 playground 业务概念）
- ai-app/agent-playground/dto/run-mission.dto.ts（RunMissionInputSchema 6+ 个非 string/enum 字段）
- harness/teams/abstractions/mission-context.interface.ts（现有 MissionContextPackage 不含 store）
- v3 方案全文 1500 行 + v2 评审全文
