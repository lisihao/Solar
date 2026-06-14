# GenesisPod 分层架构系统评审报告

> **日期**: 2026-05-30
> **范围**: playground / harness / engine / infra / open-api + 规则规范（.claude）
> **方法**: 18 个 agent 实读关键文件 → 6 层差距分析 → 5 个横切镜头 → 综合路线图
> **对标基线**: OpenAI Agents SDK、LangGraph、Anthropic agent patterns、Temporal / 12-factor agents、企业 SaaS（Stripe / WorkOS / OpenAI org-project）
> **配套文档**: [整改方案](./2026-05-30-remediation-plan.md) · [多租户 Org 模型 ADR](./multi-tenancy-org-model-adr.md)

---

## 一、总体结论

**整体成熟度 6.5/10。** GenesisPod 是一个**工程纪律罕见、单层峰值能力强的「高质量单租户 AI 深度研究产品」，但尚未跨过「企业级多租户可售 / 可审计 / 可合规平台」门槛。**

判定企业级不看单层峰值，看**横切能力是否贯通**——而横切三件事系统性缺失，且同一根因在 L1→L5 反复显形。

| 维度                                                                          | 分        | 判断                              |
| ----------------------------------------------------------------------------- | --------- | --------------------------------- |
| 架构治理（facade / 单向依赖 / MECE）                                          | **9**     | SOTA，三重门禁、规范-代码近零漂移 |
| 韧性原语（failover / 熔断 / 条件写仲裁）                                      | **8**     | 生产级                            |
| 单层峰值（BYOK 信封加密 / playground 12 阶段编排 / engine model-policy 单源） | **8–8.5** | 超多数开源框架                    |
| 企业就绪（多租户 / RBAC / 审计 / 计费归因）                                   | **6.5**   | ⚠ 售卖硬门槛缺位                  |
| AI + 合规治理（输出质量 / 注入防护 / 审计链）                                 | **5**     | ⚠ 研究平台命脉缺位                |
| 开发者易用性 DX                                                               | **5.5**   | ⚠ 为维护者优化、未为上手者优化    |

> **一句话**：「代码长什么样」治理到 9.5 分，「AI 系统在生产里如何安全、可信、可计费、可审计地多租户运行」只治理到约 5 分。治理资源严格度与业务风险呈**反相关**——越易机器化 / 越低风险的代码形态看护越严（拒推），越决定可售卖性的运行时关切越停留在散文甚至缺位。

---

## 二、Top 关键差距（按优先级）

### 🔴 Critical

**G1. ownership/visibility 未强制执行（IDOR）+ workspaceId 悬空**

> **2026-05-30 修订**：本条初稿把"多租户缺位"列为需新建 Organization 的 critical，复审后**部分撤回**——既有 `User + Topic/TopicMember(role) + ContentVisibility(PRIVATE/SHARED/PUBLIC) + workspaceId` 已是**自洽**的租户模型，真正的缺陷是**未一致执行**该模型，非缺实体。Organization 推迟（见 [ADR](./multi-tenancy-org-model-adr.md) §6）。

真 bug：L4 多个 `get/cancel/download/SSE` 端点大多 `where:{id,userId}`——既**漏了 `SHARED` 共享**（visibility 实际没生效），又有端点**不校验归属**（横向越权 IDOR）。`workspaceId` 仅半截透传从不作过滤、悬空误导。`Workspace`/`Topic`/`workspaceId` 三个 grouping 概念重叠（MECE 问题）。→ **修法是用既有 `TopicMember` + `ContentVisibility` 收口强制执行，不是新增租户主键。** 详见 [ADR](./multi-tenancy-org-model-adr.md)。

**G2. 安全护栏对外部内容裸奔（indirect prompt injection 主攻面）**
研究 mission 的核心动作就是抓取大量不可信外部内容喂 LLM，而护栏只扫 user 角色文本、对 tool/RAG 回内容**完全无防护**；检测纯正则、异常时 **fail-open**、且可被单个 env **全局关闭**（`GUARDRAILS_ENABLED`）。`react-loop.ts:1797` / `simple-loop.ts:129` / `llm-executor.ts:501` 内部推理调用全程 `skipGuardrails:true`。一次被注入的外部页面即可劫持研究 agent 执行越权工具调用或泄露上下文。

**G3. CI 合并门不含架构 spec 与覆盖率门禁——唯一真护栏可被整体绕过**
实读 `ci.yml` 验证：合并门 `quality` job 只跑 `check-facade-boundary.sh`（仅 ai-app→engine 的 shell 检查），**从不跑 `verify:arch`**（真正的 7 层 30+ jest 架构 spec）；`test:quick` 不带 `--coverage`，写死的 85% 阈值**永不触发**。即 CLAUDE.md 宣称的「CI 二次执行」「85% gate」是**不实陈述**——最强护栏全挂本地 pre-push，可被 `--no-verify` 绕过。这让「规则即代码」资产价值打折，且 agent 以 CLAUDE.md 为决策依据会被持续误导。

### 🟠 High

**G4. 可观测性零 OTel/Prometheus + 审计链只覆盖 secrets 一处**
实读 `backend/package.json`：全栈 **0 处 `@opentelemetry`/`prom-client`**，可观测性是「自建 DB 表 + EventEmitter 字符串事件」——无法接入企业 APM、无端到端 trace 归因、无可查询 cost ledger。审计仅 `SecretAccessLog` 一处；计费扣费 / key 分发 / 账户冻结 / mission 发起全无不可篡改审计链。

**G5. 持久化执行不彻底 + 反向洞察 #6 在 BYOK failover 主路径缺失**
durable execution 仍是进程内 loop + 仅 s2/s3/s8 三个 milestone checkpoint + in-memory `crossState` 是真相源、无 reconciliation sweeper——pod 崩溃 / 滚动部署丢失中段进度。叠加硬漂移：CLAUDE.md 称反向洞察 10 条「全部强制」，但 #6（跨 provider failover 必须 strip thinking signature）在 ai-engine/llm 与 ai-harness **均无 strip util**，恰好命中 BYOK 跨 provider failover 高频路径 → 确定性 400。

**G6. 开发者易用性 DX 系统性偏弱（5.5/10）**
为维护者优化、未为上手者优化，time-to-first-success 明显长于 OpenAI Agents SDK / LangGraph。四个跨层投影：

- **无「如何新增 agent/team/skill/tool/stage」扩展指南** —— 数十篇 design/audit 文档却没有一篇 onboarding-grade how-to，README 只讲「不许做什么」，新人靠逆向阅读 `topic-insights.agent.ts` 自学。
- **facade 双导出污染可发现性** —— `AiChatService / SkillRegistry / ToolRegistry / RAGPipelineService` 等 ~23 个符号**同时**从 `ai-engine/facade` 和 `ai-harness/facade` 导出（harness barrel 1555 行 / 299 export，大量反向 re-export），无 canonical 指引，IDE 自动导入随机挑一个 → 长期 import 不一致。
- **对外响应契约三套形状自相矛盾** —— 成功走 `{success,data,metadata}`、错误走扁平 `{statusCode,code,traceId}`、而 Swagger 文档又写第三种 `{statusCode,message,error}`（代码从不返回）。外部开发者按文档写解析**必错**。
- **外部上手路径近乎空白** —— 无 SDK、无 examples/、无 quickstart；Swagger `deepScanRoutes:true` 把 142 个 controller（含 27 个 admin 内部端点）混在一份文档里。

---

## 三、五个横切镜头的系统性结论

1. **架构边界**（9.5/方向，7/语义纯度）：单向依赖零违规、机器强制；但「唯一性」和「engine 不知 mission」靠**文档/alias 挂账**而非真正消除——`ToolRegistry` 双重定义（ai-engine 与 ai-harness/runner/env，task #9 半年未推完，仅加 alias）、mission 经 `KernelContext`(common 层 AsyncLocalStorage) 与 facade re-export 两条隐蔽通道**下渗进 engine**（`mission_election_states.mission_id` 持 ai-app 级 FK），门禁拦 import 方向拦不住语义穿透。例外只进不出，复利侵蚀门禁可信度。

2. **企业就绪**：多租户、durable execution、RBAC+审计、成本归因四条是同一根因跨层显形，是售卖前架构性返工点，需「先建数据模型+读路径、写路径渐进迁移」统一治理。

3. **Agent 运行时对标**：loop 策略谱系 + 终态单写者仲裁（`MissionLifecycleManager.finalize` 条件写首写赢）+ 模型 failover 字节级落地、playground 真实复用 harness 不自造——方向最对；但 guardrails 被 `skipGuardrails` 一刀切架空、handoffs 缺 capability/RBAC/input_filter（与 L4 对外 A2A scope 缺失同源）、durable 三处削弱。

4. **规范治理**：闭环侧 9.5（pre-push 8 步硬门禁顶级）；脱节侧——§1.3 十条反向洞察 **0 个 spec**（纯散文却称「全部强制」），standards/10 对 multi-tenant/RBAC/audit **0 normative**，连「禁硬编码 temperature」在 `.eslintrc.js:616` 实际是 `warn` 非 `error`。

5. **DX**：见 G6。

---

## 四、分层亮点（不应在整改中破坏的资产）

- **L3 playground**：业务编排与运行时彻底解耦（`PlaygroundBusinessOrchestrator` vs dispatcher）、`PlaygroundCrossStageState` 容器化、终态仲裁单入口条件写、`STAGE_NUMBER_CONTRACTS` 数值契约集中校验、Foresight 预测校准闭环（Brier score 反哺）。
- **L2.5 harness**：`MissionLifecycleManager` 单写者仲裁、Loop 策略谱系 + LoopRegistry、模型级 failover 闭包（MAX_MODEL_FAILOVERS 防 retry storm）、OTel GenAI semantic conventions、checkpoint dual-store + fork/replay。
- **L2 engine**：`model-policy.ts` 单一权威解析、DI 倒置 Symbol token 物理阻断反向依赖、BYOK 严格化、prompt cache 友好、48 工具统一 ToolRegistry。
- **L1 infra**：`CreditsService` updateMany + 行锁条件扣减 + 幂等键（教科书级并发正确性）、`SecretsService` 信封加密 v2 + 完整审计链 + 版本/轮转/回滚、CircuitBreaker 统一抽象。
- **L4 open-api**：facade-only 边界、A2A webhook SSRF 黑名单、原型污染消毒、timing-safe key 比较、A2A v0.3 / MCP 协议合规。
- **L5 standards**：MECE 三重看护、术语 100% 对标业界 SDK、Claude Code 反向洞察固化为护栏（虽执行未具象化）。

---

## 五、最值得单独强调的发现：治理诚实性裂缝

本次审计最反直觉的结论不是某个功能缺失，而是**治理诚实性裂缝**——CLAUDE.md 宣称的「CI 二次执行 / 85% gate / 反向洞察全部强制 / layer-boundaries 单文件 7 断言」经实读 `ci.yml`、`backend/package.json`、`__tests__/architecture` 验证存在**硬漂移**。由于人和后续 agent 都以 CLAUDE.md 为决策依据，这个漂移的修复优先级应等同于功能性 critical 项。**整改方案 P0 将「治理诚实化」列为独立工作项。**

---

详细的分阶段整改任务卡见 [2026-05-30-remediation-plan.md](./2026-05-30-remediation-plan.md)。
