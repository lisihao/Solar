# GenesisPod Roadmap · 2026-05 → 2027-05

> GenesisPod 平台未来 12 个月战略与执行路线图。基于 4 层架构（ai-app / ai-harness / ai-engine / ai-infra）已落地 + 标杆 app（agent-playground）成熟 + ai-ask Teams 模式上线 + LLM Wiki MVP 落地 + Storage Lifecycle v1.2 共识达成的现状制定。

**版本**：v1.0 · 2026-05-10
**文档形态**：完整版（背景 / 原则 / 6 主线 / 4 季度甘特 / 风险 / 退路 / 治理）
**维护节奏**：双周更新里程碑状态；季度末 retrospective + 下季度规划修订
**关联**：`.claude/CLAUDE.md` · `.claude/standards/16-ai-engine-harness-structure.md` · `docs/architecture/**/`

---

## 一、北极星（North Star）

**对标 Anthropic Managed Agent + Claude Agent SDK 形态**。三个具象指标：

| 维度                   | 当前                                          | 12 月后目标                                                       |
| ---------------------- | --------------------------------------------- | ----------------------------------------------------------------- |
| **新 AI App 上线周期** | 数周（手工搭基础设施）                        | **5 工作日**（复制 playground 4 层骨架，零基础设施代码）          |
| **架构合规度**         | 9.8/10（看护体系成熟）；与 Anthropic 对齐 60% | **≥ 80%**（P0 4 项 + P1 8 项闭环）                                |
| **生态形态**           | 闭源单体                                      | **`@genesis/agent-harness` v0.1+ 开源** + 商业化 marketplace 雏形 |

非目标（明确剔除）：

- ❌ 重写（沉淀 + 标杆复制，不做大爆炸式重构）
- ❌ 多云多 vendor 抽象（v1 锁定 Cloudflare R2 + 当前 LLM provider 矩阵）
- ❌ 移动端 native（Web + 响应式即可）

---

## 二、设计原则（贯穿 12 月）

### 原则 1：能力 ≥ 标杆 baseline（三维量化）

任何 app 重构、harness 演进必须三维同时达标：

| 维度     | 测量                                      | 验收              |
| -------- | ----------------------------------------- | ----------------- |
| **质量** | LLM judge（Opus-4.7）10-dim × 0-10 rubric | ≥ baseline × 0.95 |
| **成本** | per-mission token × LiteLLM 单价          | ≤ baseline × 1.3  |
| **延迟** | P95 端到端 mission duration               | ≤ baseline × 1.2  |

**三项缺一不通过**。复用 topic-insights harness redesign 已建立的方法论。

### 原则 2：横向复制 > 纵向重写

新 app 必须复制 playground 4 层骨架（Edge / Mission / Roles / Agents），不允许"另起炉灶造基础设施"。任何"基础设施代码"必须下沉到 ai-engine / ai-harness / ai-infra，由 PR-审查阻断。

### 原则 3：Feature flag + 灰度 + 自动回退三件套

每个主线项目必须配备：① env flag 拐点开关；② 0% → 10% → 50% → 100% traffic split；③ SLO 触发自动 rollback（参考 `HarnessRolloutService` 模式）。**先迁移再删除**为铁律。

### 原则 4：4 路集体评审共识

任何跨 app / 跨层 / 跨架构的设计文档变更，必须 4 路并行审计（architect / reviewer / security / tester）达成 4/4 APPROVED 共识方可推主线。复用 PR-R0~R8 / LLM Wiki / Storage Lifecycle / 报告装配 v1.7 已验证的流程。

### 原则 5：暴露多义性，不静默选择（Karpathy 原则）

需求模糊时（"优化 / 改进 / 加强"），列出所有合理解读、工作量、影响面，让用户裁决，不替用户选。本 roadmap 本身遵循此原则——不确定项已在 §九 "未决议题" 显式列出。

### 原则 6：YAGNI / 反过度抽象

不为单一用例做接口；不写"未来用得着"的代码；3 处使用再考虑抽象。所有 P0 优先解决"实在债"，不优先"理论债"。

### 原则 7：Karpathy 强成功标准

每个里程碑必须可被一句话独立验证（`npm run X` 全绿 / 响应时间 < Y ms / 类型检查 0 error），不是"让它跑起来 / 改得更好"。

### 原则 8：交付前自检 + 深度代码检视（CLAUDE.md 已锁）

每次落地前过 7 项清单（DB 配套 / 前后端协议 / 错误路径 / 资源清理 / 安全边界 / 旧代码清理 / 项目规范）。逐文件 diff 审查。

---

## 三、现状盘点（2026-05-10 基线）

### 3.1 已完成

| 领域                  | 关键成果                                                                                                        | 证据                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **架构分层**          | L4/L3/L2.5/L2/L1 + 三层看护（ESLint + spec + pre-push）                                                         | `.claude/standards/16-ai-engine-harness-structure.md`             |
| **标杆 app**          | agent-playground 4 层骨架成熟（Edge/Mission/Roles/Agents），9 PR 中 7 已落                                      | `docs/architecture/ai-app/agent-playground/benchmark-app-plan.md` |
| **报告系统 v1.7**     | 装配不变量 + figure-curator + sub-section N 段拼接 + 版本化抽屉 + WYSIWYG 导出                                  | commit `db043da31` / `e12acc6e0`                                  |
| **ai-ask Teams 模式** | 6 adapters（freechat/parallel-merge/debate/vote/review/handoff）+ 房间 UI + per-turn seq + cancel-aware billing | commit `0536dd061`                                                |
| **ai-infra/secrets**  | MultiKey + BYOK 用户中心化 + DistributableKey 整体删除（双源治理）                                              | commit `757dc66af`                                                |
| **LLM Wiki MVP**      | 10 张表 + ingest + diff/log/export/settings + Graph 视图 + R2 三件套 off-load                                   | commit `e58e44e0e` 系列                                           |
| **报告版本化**        | DB / service / pipeline / endpoint / 前端切换器全链                                                             | commit `774a71d13`                                                |
| **通知系统 W1-W4**    | DomainEvent 桥 + Socket.IO + 业务桥（research/writing/office/byok）+ quiet hours                                | commit `6acb54052`                                                |
| **通用看护**          | ErrorBoundary / fixture / events zod / lint 拦断言 / pricing 单源                                               | reference_audit_debt_dashboard                                    |

### 3.2 进行中

| 项目                       | 状态                                      | 缺口                                               |
| -------------------------- | ----------------------------------------- | -------------------------------------------------- |
| **Storage Lifecycle v1.2** | 设计 4 路共识，PR-S 系列待实施            | mission_events 99 MB 行级未治理；GDPR 删除路径未落 |
| **Anthropic 对齐**         | 60% 对齐度，Phase 1 状态外置（Redis）已落 | P0 4 项 + P1 8 项待修                              |
| **Harness 重构主线**       | W17-W22 6 波次未完                        | 顶层 11 聚合定型，子目录 abstractions/ 散点        |
| **playground 标杆化**      | PR-1~PR-7/9 落地，PR-4/PR-8 等 W21/W22    | 边界违规残留 1 项；S12 死代码已清；24K 合理        |

### 3.3 未启动 / Legacy 状态

| 模块                                                               | 状态                                                                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| ai-app/research                                                    | legacy 流程，未按 playground 4 层重构（topic-insights harness 已 done 可复用方法论） |
| ai-app/writing + writing-team                                      | 未对齐新架构                                                                         |
| ai-app/office                                                      | features-office v1-v5 文档堆叠未落地，PPT/Doc 未到 GA                                |
| ai-app/social / image / simulation / planning / explore / feedback | 未对齐新架构                                                                         |
| ai-app/topic-insights                                              | harness 已重构，但与 playground 是两条独立线，未沉淀通用模式                         |
| **AI Knowledge Base 接入**                                         | Wiki 数据有了，research/writing/playground 均未当 RAG 源接入                         |
| **Open API / SDK**                                                 | modules/open-api/ 体系化未启动；harness 未抽 npm 包                                  |

### 3.4 已知重债

来自 reference_audit_debt_dashboard 5 维度：

- **god-class**：team.mission.ts 690 行旧实现以注释挂着；多个 service > 2500 行
- **shim**：facade 散点 re-export
- **biz-name**：硬编码品牌名残留
- **any 类型**：少量 lying assertion
- **TODO**：S12 消费侧（leader plan duty）半闭合等

---

## 四、7 主线总览

```
M1  Infra 收尾（基座稳定）        ─── L1 ai-infra
M2  Engine + Harness 沉淀        ─── L2 / L2.5
M3  标杆 app 横向复制             ─── L3 ai-app（横向铺开）
M4  AI Report 独立模块            ─── L3 ai-app（新建）
M5  知识闭环（Wiki + RAG + Memory）─── L2 + L3 跨层
M6  Open / SDK / Marketplace     ─── L4 + 商业化
M7  Code Agent（内部基础原语）    ─── L2 / L2.5（执行能力底座 + 未来自演进内核前置）
```

> **M7 设计动机**：当前所有 LLM agent 全是"知识工作者"（产出报告/对话/知识），系统缺**执行能力**——没有 agent 能 Read/Edit/Bash/git 操作代码。这导致两个缺口：① 工程师 sub-agent 场景仍依赖手工 Task tool；② 未来"自演进内核"（Self-Iteration Kernel · v2.0 命题）的 Apply 层无落点。M7 作为**内部基础原语**先打地基，不开 ai-app/code 用户产品（v2.0 候选）。
>
> **杠杆**：本地已有 `d:/projects/codes/claude-code-build`（Claude Code v2.1.88 还原源码 1916 文件 + 反向洞察 10 条已锁 CLAUDE.md），工具集 / query loop / 安全护栏全套参考实现可借鉴。

---

## 五、7 主线详解

### M1 · Infra 收尾（基座稳定）

**目标**：让所有 ai-app 不再担心存储、缓存、可观测性、限流的底层问题。

| 里程碑                          | 内容                                                                                                                                                                                   | 季度                  | Owner                  | 验收标准                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------- | -------------------------------------------------------- |
| **M1.1 Storage Lifecycle 落地** | PR-S1: FieldOffload 升级为 RowArchive 二合一；PR-S2: mission_events 99 MB → R2；PR-S3: GDPR 删除路径同步 std/IA/DB；PR-S4: admin 仪表盘；PR-S5: 加密敏感字段；PR-S6: legal_hold 双角色 | **Q2 2026（5-6 月）** | infra-owner            | mission_events DB 行数下降 ≥ 80%；GDPR 删除 e2e 测试通过 |
| **M1.2 Cache Governance**       | Redis 散点缓存抽 `ai-infra/cache-governance/`；TTL/失效统一；Redis 内存使用监控                                                                                                        | Q3 2026（7 月）       | infra-owner            | 所有业务 cache 走 facade；Redis 命中率仪表盘             |
| **M1.3 Observability 整合**     | tracing/llm-events/latency/eval/attribution 5 子聚合落库；admin grafana-style 视图                                                                                                     | Q3 2026（7-8 月）     | infra-owner            | per-mission 全链路追踪；P95 latency dashboard            |
| **M1.4 Resilience 矩阵**        | rate-limit/concurrency/budget/circuit-breaker 体系化 + admin 配置 UI                                                                                                                   | Q3 2026（8-9 月）     | infra-owner            | 所有 endpoint 都有显式 SLO；超限自动降级                 |
| **M1.5 Audit Trail 强化**       | secret 操作 / data export / impersonation 全链 audit log                                                                                                                               | Q4 2026（10 月）      | infra-owner + security | 合规审计 e2e 演练通过                                    |

### M2 · Engine + Harness 沉淀

**目标**：让 harness 真正成为可分发的 Agent runtime。

| 里程碑                                    | 内容                                                                                 | 季度                  | 验收标准                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------ | --------------------- | ----------------------------------------------------- |
| **M2.1 Anthropic P0 4 项**                | 见 project_anthropic_audit_2026_04_30                                                | **Q2 2026（5-6 月）** | 对齐度 60% → 80%                                      |
| **M2.2 Harness W17-W22 6 波次**           | 顶层 11 聚合最后 6 波收尾                                                            | Q2-Q3 2026（5-7 月）  | 所有 abstractions/ 归位；spec 测试 100% pass          |
| **M2.3 Skill / Tool 单一注册中心**        | 当前 2 个 SkillRegistry 同名类（reference_two_skill_registries）收一                 | Q3 2026（6 月）       | 全仓只剩 1 个 SkillRegistry 类                        |
| **M2.4 Capability Discovery 统一**        | DataSourceRouter 类 capability 上下文统一（topic-insight zero-results 类 bug 根因）  | Q3 2026（7-8 月）     | 所有 capability resolve 走单一上下文管道              |
| **M2.5 Engine LLM 路由器升级**            | StructuredOutputRouter 8 adapter 覆盖率 100%；admin capability matrix UI             | Q3 2026（8-9 月）     | 所有 LLM 调用经 router；自动按 provider slug 推断能力 |
| **M2.6 Harness Mission Lifecycle 标准化** | mission lifecycle / liveness guard / stage emit 形成统一契约（不再 5 stage 漏 emit） | Q4 2026（10-11 月）   | 4 路评审共识；所有 app 接入                           |
| **M2.7 Harness 跨 mission Memory**        | working/checkpoint/event-store/consolidation 5 子聚合端到端                          | Q4 2026（11-12 月）   | 跨 mission failure-learning 闭环                      |

### M3 · 标杆 app 横向复制

**目标**：5 工作日上线一个新 AI App。

> 复制方法论：① 复制 playground edge/mission/roles/agents 骨架；② 替换 agents 业务逻辑；③ 配置 stages DAG；④ 接 LLM Wiki 作 RAG；⑤ 4 路评审。

| 里程碑                               | 内容                                                  | 季度                  | 依赖       | 验收标准                                   |
| ------------------------------------ | ----------------------------------------------------- | --------------------- | ---------- | ------------------------------------------ |
| **M3.0 Playground 标杆收尾**         | PR-4 / PR-8（待 W21/W22）；24K → 18-19K 不强制        | **Q2 2026（5-6 月）** | M2.2       | 4 路评审共识；零回归                       |
| **M3.1 Research 重构**               | legacy → harness 4 层（topic-insights 经验复用）      | Q3 2026（6-8 月）     | M3.0       | 三维量化 ≥ baseline × 0.95 / × 1.3 / × 1.2 |
| **M3.2 Writing + Writing-Team 重构** | 长文 / 章节 / 作者团队；Wiki 作 source of truth       | Q3 2026（8-9 月）     | M3.0, M5.1 | 同上                                       |
| **M3.3 Topic-Insights 收口**         | harness 沉淀的通用部分提到 playground/research 共享层 | Q3 2026（9 月）       | M3.1       | 通用 stage 复用率 ≥ 60%                    |
| **M3.4 Image 重构**                  | features-image-generator 4 层骨架适配                 | Q4 2026（10 月）      | M3.0       | —                                          |
| **M3.5 Social 重构**                 | 4 层骨架适配                                          | Q4 2026（10-11 月）   | M3.0       | —                                          |
| **M3.6 Simulation / Planning 重构**  | 角色辩论 / 规划 4 层骨架适配                          | Q4 2026（11-12 月）   | M3.0       | —                                          |
| **M3.7 Explore / Feedback 重构**     | 浏览发现 / 反馈 4 层骨架适配（可能合并）              | Q1 2027（1-2 月）     | M3.0       | —                                          |
| **M3.8 Custom Agents/Teams GA**      | 用户自定义 agent + team config 全功能                 | Q1 2027（2-3 月）     | M2.6       | 用户上传 agent 后 5 分钟内可投产           |

### M4 · AI Report 独立模块（**0508 决策**）

**目标**：长 deliverable 跨 app 共享统一出口（playground / research / topic-insights / writing 都能产出一致格式的报告）。

| 里程碑                      | 内容                                                                                         | 季度                | 依赖       | 验收标准                              |
| --------------------------- | -------------------------------------------------------------------------------------------- | ------------------- | ---------- | ------------------------------------- |
| **M4.1 Report Module 设计** | 4 路评审 v1.0；契约：input = mission/topic + chapters + figures；output = 多格式 deliverable | **Q2 2026（6 月）** | —          | 4/4 评审共识                          |
| **M4.2 Report Core MVP**    | ai-app/report 4 层骨架；接收 playground/research/TI 输出；产出 markdown + html + JSON 元数据 | Q3 2026（7-8 月）   | M4.1, M3.0 | playground 报告完全切到 ai-app/report |
| **M4.3 Report 多格式导出**  | PDF / DOCX / PPTX / HTML 四出口；WYSIWYG 一致                                                | Q3 2026（8-9 月）   | M4.2       | 所有出口 e2e 测试通过                 |
| **M4.4 Report 模板系统**    | 行业模板 / 学术模板 / 商业模板；用户自定义模板                                               | Q4 2026（10-11 月） | M4.2       | ≥ 5 个内置模板 + 用户自定义           |
| **M4.5 Report 协作 / 版本** | 多人协作编辑 + 评论 + 版本对比（与现有版本化抽屉融合）                                       | Q4 2026（11-12 月） | M4.2, M4.4 | 多用户并发编辑无冲突                  |
| **M4.6 Report 智能修订**    | "AI 帮我精炼此章节" / "重写为商业语调" 等 inline 操作                                        | Q1 2027（1-3 月）   | M4.5       | 5+ 智能操作                           |

### M5 · 知识闭环

**目标**：Wiki + RAG + Memory 三位一体，AI 应用真正"越用越聪明"。

| 里程碑                                           | 内容                                                                           | 季度                     | 验收标准                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------ | ----------------------------------------------- |
| **M5.1 Wiki → Research/Writing/Playground 注入** | Wiki 作为 RAG 源；跨 mission cite                                              | **Q2-Q3 2026（6-7 月）** | playground mission 引用 Wiki ≥ 30%              |
| **M5.2 Failure Learning 消费侧闭环**             | postmortem → vector_memory（写入侧已落）；leader plan duty 读回                | Q3 2026（7-8 月）        | failureLearner 真消费；mission rerun 失败率下降 |
| **M5.3 Cross-Mission Memory v1**                 | working/checkpoint/event-store/consolidation 5 子聚合端到端                    | Q4 2026（10-11 月）      | per-user mission 历史可被新 mission 引用        |
| **M5.4 Knowledge Graph + Entity Linking**        | wiki 实体抽取 → 知识图谱 → 自动 cite suggestion                                | Q1 2027（1-3 月）        | 自动 cite 命中率 ≥ 50%                          |
| **M5.5 RAG 升级 v2**                             | hybrid retrieval（dense + sparse + graph）；rerank 模型；evidence quality 评分 | Q1 2027（2-3 月）        | RAG 召回质量提升 ≥ 30%                          |

### M6 · Open / SDK / Marketplace（**0508 决策：开源 + 商业化**）

**目标**：对标 Claude Agent SDK，建立 GenesisPod Agent 生态。

| 里程碑                          | 内容                                                                                      | 季度                | 依赖       | 验收标准                                     |
| ------------------------------- | ----------------------------------------------------------------------------------------- | ------------------- | ---------- | -------------------------------------------- |
| **M6.1 Open API 稳定**          | modules/open-api/ 体系化（OAuth + rate-limit + quota + webhook）                          | Q3 2026（9 月）     | M1.4       | 外部 dev 可调用所有核心能力                  |
| **M6.2 SDK 设计与 OSS 准备**    | `@genesis/agent-harness` 拆包设计；MIT/Apache 选型；CLA + 法务审查；CI 双发（私有 + npm） | Q4 2026（10 月）    | M2.6       | 法务通过；OSS 仓库 init                      |
| **M6.3 SDK v0.1.0 发布**        | runner / agents / handoffs / protocols 子集 npm 公开包；hello-world example；文档站点     | Q4 2026（11-12 月） | M6.2       | npm i @genesis/agent-harness 可跑 quickstart |
| **M6.4 SDK v0.2 + Plugin 体系** | tool plugin / skill plugin / agent template 三套扩展点                                    | Q1 2027（1-2 月）   | M6.3       | 第三方可注册自定义 tool                      |
| **M6.5 Marketplace v0.1**       | 用户上传 agent/team config；订阅 / fork / star；rating 系统                               | Q1 2027（2-3 月）   | M3.8, M6.4 | ≥ 50 个社区 agent                            |
| **M6.6 商业化雏形**             | hosted-tier billing；BYOK 多租户隔离；compliance（SOC 2 readiness）                       | Q2 2027（4-5 月）   | M6.5       | 1-3 个 pilot 客户上线                        |

### M7 · Code Agent（内部基础原语）

**目标**：让 GenesisPod 拥有"执行能力 agent"——能 Read 代码 / Edit 文件 / Bash 跑命令 / git 操作 / npm 验证，作为内部基础原语服务工程师 sub-agent 场景与未来自演进内核（v2.0）。**保守 scope**：不开 ai-app/code 用户产品；不暴露 Open API；4 模式权限锁 PR-only Apply。

**关键设计**：

- **工具原语 mirror Claude Code**：Read / Write / Edit / Glob / Grep / Bash / ToolSearch（已反向工程，10 条 Anthropic 自己注释里的"血的教训"已落 CLAUDE.md）
- **4 操作模式**：Plan（read-only）/ Edit（写文件）/ Execute（跑 shell + git local）/ PR（push + 开 PR），每模式权限边界明确
- **安全沙箱继承现有规则**：Sub-Agent worktree 隔离 + 文件白名单 + 全局回退禁令 + 入口文件保护（CLAUDE.md 已锁的 7 条 Sub-Agent 管控全适用）
- **harness 一等公民**：归位 `ai-harness/agents/core/code-agent`，所有 ai-app 可复用，不依附任一 app

| 里程碑                         | 内容                                                                                                                                   | 季度                | 依赖             | 验收标准                                                                            |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------- | ----------------------------------------------------------------------------------- |
| **M7.1 Tool 原语层**           | `ai-engine/tools/code/`：Read/Write/Edit/Glob/Grep/Bash/ToolSearch；强制 Read-before-Edit 契约；Bash timeout/runInBackground/沙箱 flag | Q3 2026（7-8 月）   | M2.3             | 7 个原语 100% spec 覆盖；Claude Code 反向洞察 10 条全过                             |
| **M7.2 Sandbox + 权限层**      | `ai-infra/sandbox-runner/`：worktree 隔离 + 资源限额 + 网络策略；4 模式 ACL 引擎；input sanitize（防 prompt 注入）                     | Q3 2026（8 月）     | M1.4             | 沙箱逃逸 e2e 演练通过；4 模式权限 spec 全过；4 路评审共识                           |
| **M7.3 Code Agent 主体**       | `ai-harness/agents/core/code-agent`：BaseAgentRunner 派生；subagents（explorer/reviewer/tester）注册；hooks 集成；mission 化封装       | Q3 2026（8-9 月）   | M7.1, M7.2, M2.6 | code-agent 跑通 5 个典型 mission（探索代码 / 改 prompt / 跑测试 / 修 lint / 开 PR） |
| **M7.4 Sub-Agent 场景切换**    | 现有 Task tool 用法（Sub-Agent 隔离 worktree + 白名单）逐步切到 code-agent；保留 Task tool 作 fallback                                 | Q4 2026（10 月）    | M7.3             | ≥ 5 个项目内常见 sub-agent 场景切到 code-agent；零 worktree 隔离失效                |
| **M7.5 内部诊断服务（alpha）** | code-agent 跑 prompt drift detection / capability gap auto-discovery（仅产出建议 PR，PR-only Apply）                                   | Q4 2026（11-12 月） | M7.3, M5.2       | 至少 1 类 drift 场景产出有效建议 PR；4 路评审 gate 通过率 ≥ 50%                     |
| **M7.6 自演进前置评估**        | 评估 Self-Iteration Kernel（v2.0 命题）启动条件：M7.5 alpha 数据 + 沙箱稳定 + 元层契约设计                                             | Q1 2027（1-3 月）   | M7.5             | 决策报告 + 4 路评审：v2.0 启动 / 推迟 / 调整范围                                    |

**为什么 M7 不开 ai-app/code 用户产品（v2.0 候选）**：

- ai-app/code（Cursor-like AI App）需要完整 IDE 体验、文件树 UI、diff 视图、协作等，工作量与 M3 整条主线相当
- 内部 primitive 先稳定 6 个月，数据、安全、UX 都验证后再考虑用户产品形态
- 优先级让位给 M3 横向复制 + M4 AI Report（直接 user-facing value）

---

## 六、季度甘特（视觉总览）

```
                        Q2'26      Q3'26       Q4'26       Q1'27       Q2'27
                        (5-6月)    (7-9月)     (10-12月)   (1-3月)     (4-5月)
M1 Infra   ────────────[████ S]──[████]─────[██]
M2 Eng/Har ────────────[██]─────[██████]─[████]
M3 Apps    ────────────[█ Pg]─[██ R+W]────[████ I+S+Sm+P]─[██ Cust]
M4 Report  ─────────────[█ D]──[████ MVP]──[████ Tpl]────[██ AI修订]
M5 Wiki    ─────────────[█]────[████]─────[██ XMem]─────[██ KG+RAGv2]
M6 SDK/MP  ──────────────────────[█ API]──[██████ SDK]──[████ MP]─[██ 商]
M7 CodeAg  ───────────────────[██ T+SB]──[████ Agt+α]──[██ EvalV2]

S=Storage  Pg=Playground  R=Research  W=Writing  I=Image  S=Social  Sm=Simulation
P=Planning  Cust=Custom  D=Design  Tpl=Template  XMem=Cross-Memory
KG=Knowledge Graph  MP=Marketplace  商=商业化
T=Tool 原语  SB=Sandbox  Agt=Code Agent  α=alpha 诊断  EvalV2=自演进前置评估
```

### 季度核心交付（Top 3）

| 季度        | 三大交付                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Q2 2026** | ① Storage Lifecycle 落地（M1.1）② Anthropic P0 4 项闭环（M2.1）③ Playground 标杆收尾（M3.0）                                                                                   |
| **Q3 2026** | ① Research + Writing 4 层重构（M3.1, M3.2）② AI Report MVP（M4.2/4.3）③ Wiki 注入 + Failure Learning 闭环（M5.1, M5.2）④ **Code Agent 工具原语 + Sandbox + 主体（M7.1-M7.3）** |
| **Q4 2026** | ① Image/Social/Simulation/Planning 4 层重构（M3.4-3.6）② Report 模板 + 协作（M4.4, M4.5）③ SDK v0.1.0 发布（M6.3）④ **Code Agent Sub-Agent 切换 + alpha 诊断（M7.4-M7.5）**    |
| **Q1 2027** | ① Custom Agents/Teams GA（M3.8）② Knowledge Graph + RAG v2（M5.4, M5.5）③ Marketplace v0.1（M6.5）④ **自演进内核前置评估（M7.6）**                                             |
| **Q2 2027** | ① 商业化 pilot（M6.6）② SOC 2 readiness ③ 12 月 retrospective + 下一年战略                                                                                                     |

---

## 七、风险与退路

### 7.1 主要风险

| 风险                             | 概率 | 影响 | 缓解                                                                                                |
| -------------------------------- | ---- | ---- | --------------------------------------------------------------------------------------------------- |
| **Storage 数据迁移误删**         | 中   | 极高 | 先迁移再删除；feature flag；回滚演练；4 路评审共识                                                  |
| **app 横向复制掉进"复制粘贴债"** | 高   | 中   | 每个 app 复制后立即抽公共到 ai-engine/harness（M2.4 capability discovery）                          |
| **Anthropic 对齐继续退化**       | 中   | 中   | 季度对齐度审计（已有方法论）                                                                        |
| **SDK 法务/合规阻塞**            | 中   | 高   | Q4 2026 早做 CLA + 第三方依赖审计                                                                   |
| **多 session 并行 commit 漂移**  | 高   | 中   | 已落 git commit -- pathspec 规范；CLAUDE.md 已锁                                                    |
| **Marketplace 内容审核 / 安全**  | 高   | 高   | M6.5 启动前 0.5 季度做 sandbox 隔离                                                                 |
| **Code Agent 沙箱逃逸**          | 中   | 极高 | M7.2 worktree + 4 模式 ACL + 入口文件保护；e2e 演练；4 路评审共识；PR-only Apply                    |
| **Code Agent prompt 注入**       | 高   | 高   | input sanitize + 关键 op require human approve + 白名单（CLAUDE.md 已有 7 条 Sub-Agent 管控全继承） |
| **Code Agent 自循环烧 token**    | 中   | 中   | 复用 M1.4 budget 硬闸 + Claude Code 反向洞察 #4（API error 不跑 stop hook，避免 retry 死循环）      |
| **季度承诺过度**                 | 中   | 中   | 双周 milestone 状态更新；季度末必须 retro 调整                                                      |

### 7.2 退路

每条主线必须配备：

1. **代码级**：feature flag 立即切回 legacy
2. **运行时**：SLO 触发自动 rollback（已有 HarnessRolloutService 模式）
3. **数据级**：所有新写字段向后兼容（null/缺失字段 legacy 能读）
4. **团队级**：4 路评审共识 = 任何成员一票否决可阻挡

### 7.3 季度 Stop-the-line 触发条件

任一触发，本季度立即冻结新承诺，转入修复模式：

- 生产事故 P0 级 ≥ 1 次
- 单季度 SLO 违反 ≥ 3 次
- 架构合规度下降 ≥ 0.3 分
- 用户报告高频 bug ≥ 5 个未修

---

## 八、治理机制

### 8.1 双周节奏

| 节点       | 内容                                                              |
| ---------- | ----------------------------------------------------------------- |
| **每周一** | 双周 sprint 起点 — 选择本期 PR 列表；明确 owner / 验收标准        |
| **每周五** | 状态对齐 — 更新 roadmap.md 里程碑状态字段；blocked 项明确处理路径 |
| **双周末** | retro — 上 sprint 偏差分析；下 sprint scope 调整                  |

### 8.2 季度节奏

| 节点            | 内容                                     |
| --------------- | ---------------------------------------- |
| **季度 D-2 周** | 本季度交付盘点 + 三维质量指标采集        |
| **季度 D-1 周** | 下季度 milestone 修订 + 4 路评审共识     |
| **季度 D 日**   | 公司内 / 社区（M6 后）发布 release notes |

### 8.3 决策与变更

- **里程碑增减**：4 路评审 + 用户审批
- **季度 scope 大改**：必须更新 roadmap.md 主版本号（v1.0 → v1.1）
- **北极星变更**：必须更新 CLAUDE.md 同步

### 8.4 状态字段约定

每个里程碑在执行过程中维护以下字段（未来添加）：

```markdown
- M1.1 Storage Lifecycle: 🟡 进行中 (PR-S1 ✅ / PR-S2 in-flight) · ETA 6 月底 · Owner: infra-owner
```

状态枚举：⬜ 未启动 / 🟡 进行中 / ✅ 完成 / 🔴 阻塞 / ⏸ 暂停

---

## 九、未决议题（需要后续决策）

| 议题                                             | 何时决策   | 决策方式                                                                                             |
| ------------------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------- |
| **AI Office 模块（PPT/Doc 生成）的命运**         | Q3 2026 末 | 看 M4 AI Report 多格式导出能否覆盖 Office 80% 场景，能则废弃 office 模块；不能则 Q4 启动 office 重构 |
| **多语言战略**                                   | Q4 2026    | 当前主要中文 + 部分 i18n；是否进军英文市场决定 SDK 文档语言 + marketplace 受众                       |
| **移动端形态**                                   | 2027 H2    | 当前响应式 Web；是否做 native 看用户数据                                                             |
| **AI Ask Teams 与 Custom Teams 的合并**          | Q1 2027    | 二者概念已重叠（多 AI 协作），Q1 2027 做架构合并设计                                                 |
| **Topic-Insights 是否独立 app vs 并入 Research** | Q3 2026    | M3.3 收口阶段决定                                                                                    |
| **YouTube / Explore 等"非生成型" app 的去留**    | Q1 2027    | 看 M3.7 重构 ROI                                                                                     |
| **Self-Iteration Kernel（自演进内核）启动**      | Q1 2027 末 | M7.6 评估报告决定：v2.0 命题（建议）/ 提前到 v1.x 末 / 延后到 2027 H2；当前 M7 是其前置基座          |
| **ai-app/code（Cursor-like 用户产品）启动**      | Q2 2027    | M7 内部 primitive 稳定 6 个月后评估；v1.0 内不开，v2.0 候选                                          |

---

## 十、版本管理

| 版本 | 日期       | 变更                                                                                                                                           |
| ---- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| v1.0 | 2026-05-10 | 初版（基于 4 项决策：独立 AI Report 模块 / 开源+商业化 SDK / 12 月跨度 / 完整长文档）                                                          |
| v1.1 | 2026-05-10 | 新增 M7 · Code Agent 主线（内部基础原语，保守 scope）；§九增 Self-Iteration Kernel 与 ai-app/code 两项未决议题；甘特 + 风险 + 季度交付同步更新 |

**下次主版本预定**：2026-08-10（Q2 retrospective 后）。
**双周维护**：每周五更新里程碑状态字段（不变更主版本号）。

---

## 附录 A · 关键参考文档

- 架构层级规范：`.claude/standards/16-ai-engine-harness-structure.md`
- 扩展点治理：`.claude/standards/17-extension-governance.md`
- 基础层文件治理：`.claude/standards/18-base-layer-file-governance.md`
- Topic-Insights Harness 重构（v2 方法论范本）：`docs/architecture/ai-harness/redesign/00-overview.md`
- Playground 标杆方案：`docs/architecture/ai-app/agent-playground/benchmark-app-plan.md`
- Storage Lifecycle v1.2：`docs/architecture/ai-infra/storage/storage-lifecycle-design.md`
- LLM Wiki 设计：`docs/architecture/ai-app/library/`（详见 commit `2613811bb` / `1c6a6be48`）
- Anthropic 审计基线：memory `project_anthropic_audit_2026_04_30`
- Claude Code 反向洞察 10 条（CLAUDE.md 已锁）
- Claude Code v2.1.88 还原源码 1916 文件（M7 工具集 / sandbox / hooks 设计参考）：memory `reference_claude_code_v2_1_88_source.md` · 本地路径 `d:/projects/codes/claude-code-build`

## 附录 B · 缩写表

| 缩写  | 全称                                          |
| ----- | --------------------------------------------- |
| L1-L4 | Layer 1 (Infrastructure) → Layer 4 (Open API) |
| BYOK  | Bring Your Own Key                            |
| TI    | Topic Insights                                |
| RAG   | Retrieval-Augmented Generation                |
| KG    | Knowledge Graph                               |
| SLO   | Service Level Objective                       |
| MECE  | Mutually Exclusive, Collectively Exhaustive   |
| SDK   | Software Development Kit                      |
| MP    | Marketplace                                   |
