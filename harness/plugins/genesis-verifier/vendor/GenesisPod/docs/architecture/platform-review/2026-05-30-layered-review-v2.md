# Genesis.ai 平台分层评审 v2(整改后复审)

> **日期**:2026-05-30
> **方法**:Workflow 多 agent 编排 —— 7 维度并行深读评分 → 逐维度对抗核查(过滤已整改的陈旧发现) → 首席架构师综合
> **规模**:15 个 subagent,~1.85M tokens,381 次工具调用,51 条原始差距经核查
> **基线**:origin/main `30b8c15da`(P0/P1/P2 整改 + /metrics 修复已合入)
> **对标**:LangGraph / AutoGen / CrewAI / OpenAI Agents SDK / Temporal / LiteLLM / OpenAI Deep Research / Perplexity

---

## 1. 执行摘要

这是一个成熟度**显著高于多数开源 agent 框架**的企业级 AI 深研平台。七层中 Engine(7.8)、Playground(7.4)、Rules-Standards(7.4)、Harness(7.1) 已达 SOTA 中上水准,真正的护城河在于:

- 结构性并发正确性(`finalize` 单入口终态仲裁)
- 生产级 BYOK 密钥编排 + 信封加密 v2
- 成本台账正确范式(unknown model 显式 null 而非假 0)
- 罕见的三层架构看护元治理

但复审揭示了一个**系统性成熟度断层**:可靠性/正确性的工程实现,远超其安全隔离与持久化执行的覆盖面。三个最尖锐的结论:

1. **IDOR 越权在已修的 agent-playground 之外仍系统性残留** —— Harness 持久层(checkpoint/event-store 无 owner 列)与 OpenAPI agents-api(任务/产物端点无归属校验)是两处确认的 P0。等于"修了一个模块,露了两条同源路径"。
2. **untrusted 输入治理缺口** —— 用户自由文本直入 Leader prompt、SSRF 字面校验可被 DNS rebinding 绕过、MCP/Webhook URL 无出站防护。对一个大量消费外部网页 + 工具调用 + BYOK 的 agent 平台,这是头号攻击面。
3. **分布式真实性赤字** —— 限流/配额/消息/健康状态大量是进程内内存态,多 pod 水平扩展下"名存实亡",且无 step-level durable execution。

关键判断:**底层能力大多已具备**(`assertReadAccess`、ai-engine/safety guardrail、Redis 原语、BullMQ、pricing registry),缺的是**把它们对称地接线到所有入口,并用 spec 固化为不变量**。整改是"扩展已有模式",不是"从零建设"。

---

## 2. 定位契合度

**高度契合,但尚未完全兑现"企业级"承诺。**

- **作为"AI 深研平台"的产品形态**(plan→fanout→synthesize→write→multi-judge→signoff 的 7-agent 12-stage 流水 + 增量 rerun)完整度对标 OpenAI Deep Research / Perplexity —— 研究编排与质量门是**真实强项**。
- **但"企业级"三字的硬门槛** —— 多租户数据隔离、合规审计链、成本硬熔断、水平扩展一致性 —— 存在确认的结构性缺口:
  - 跨租户可读他人 agent 产物(IDOR)直接违反 B2B 隔离红线
  - 统一 append-only 审计缺失则 SOC2/ISO27001 无法过
  - 进程内限流使配额可被实例数倍绕过

**结论**:产品能力已是企业级,但安全/合规/分布式基线还停留在"单租户高质量原型 → 多租户生产"的过渡带。**补齐路线图 rank 1-4 后方可宣称企业级就绪。**

一个值得肯定的诚实信号:CLAUDE.md 主动标注 honor-only 护栏、ADR-0005 明确暂缓 Org 层 —— 团队对自身缺口有清醒认知,这本身降低了交付风险。

---

## 3. 七层记分卡

| 层                  | 分  | 一句话                                                                                                                               |
| ------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Engine**          | 7.8 | 基元层最强:多维模型选举 + BYOK 编排 + 定价纪律 + RAG 对齐 SOTA,缺口集中在 SSRF 未做 DNS 解析与工具幂等                               |
| **Playground**      | 7.4 | 研究编排产品形态完整、并发正确性(finalize 仲裁)与成本台账是范本,弱在 workspace 隔离名存实亡与 description 注入面                     |
| **Rules-Standards** | 7.4 | 三层架构看护与成本/能力治理是 SOTA 级元治理,但 10 条 agent-runtime 血泪洞察全 honor-only、多租户无 spec 锁                           |
| **Harness**         | 7.1 | runner 成熟贴近 SOTA 且落地 Claude Code 反向洞察,但 checkpoint/event-store 无 owner 列是 P0 IDOR、消息纯进程内、无 durable execution |
| **DX**              | 6.5 | 模块 README 与 verify 分层优秀,但起栈即崩(漏 Python)、verify:changed 路径错、安全 spec 被排除出快速门等破窗多                        |
| **OpenAPI**         | 6.4 | MCP/agents-api/webhook 面很全且 BullMQ durable 扎实,但 agents-api IDOR 与 Webhook SSRF 双 P0、key 不绑租户、限流进程内               |
| **Infra**           | 6.1 | BYOK 与信封加密达企业 SOTA,但可观测/审计是最大短板(工作分支落后于 main)、迁移治理脆弱、无调用前硬预算                                |

---

## 4. 五大跨层主题(系统性根因)

1. **IDOR/越权在已修模块之外系统性残留**:agent-playground 的 `assertReadAccess` 整改是对的,但同源问题在 Harness 持久层、OpenAPI agents-api、Playground workspace 读路径三处复现。**根因 = 缺统一 access guard 的全 app 强制契约 + 无静态 spec 锁"查询必带 owner/workspace 谓词"**,整改靠模块逐个打补丁而非结构性不变量。

2. **untrusted 输入未做出站/注入防护**:SSRF 字面黑名单可 DNS rebinding 绕过、MCP relay 零校验、Webhook 仅 `@IsUrl`、用户 description 直入 Leader prompt。项目已具备防护原语(`escapeUserPromptContent`、ai-engine/safety guardrail、external-content-wrapper)**但未对称接线到所有入口**。

3. **分布式真实性赤字**:限流/配额/agent 间消息/A2A context/多密钥健康/健康探针大量是进程内内存态。多 pod 下配额可被实例数倍绕过、消息互不可见、限流名存实亡。Redis 原语已存在但**未在生产 bootstrap 装配**。

4. **无 step-level durable execution + 成本调用前硬熔断缺失**:崩溃恢复只到粗粒度 checkpoint,re-dispatch 链路不闭环(kernel-scheduler 只改 DB 状态不真正续跑 loop),重跑 stage 重烧 credit、副作用工具可能重复执行(无幂等键)。成本全是**事后记账,无调用前预扣**,react-runaway 类失控仅单进程 downgrade/abort 兜底。

5. **声明与实现的落差(可信度风险)**:"辩论选举"实为串行打分降权、openclaw-config 宣传限流值与实际 `@Throttle` 不一致、双成本账不对账、honor-only 护栏未固化为 spec、文档端口/健康路径漂移。能力大多真实存在但**命名/宣传/文档与代码脱节**,影响企业评审的信任度。

---

## 5. 优先级路线图(impact × effort 排序)

| #   | 项                                                                   | 严重度 | 涉及层                       | 工作量 |
| --- | -------------------------------------------------------------------- | ------ | ---------------------------- | ------ |
| 1   | 对称补齐 IDOR:Harness 持久层 + OpenAPI agents-api 归属校验           | **P0** | Harness/OpenAPI/Playground   | L      |
| 2   | 统一 SSRF/出站防护 + untrusted 输入注入隔离                          | P1     | Engine/OpenAPI/Playground    | M      |
| 3   | 分布式状态收敛到 Redis:限流/配额/消息/密钥健康                       | P1     | OpenAPI/Engine/Harness/Infra | L      |
| 4   | 统一 append-only 审计表 + 高敏操作全覆盖留痕                         | P1     | Infra/Playground/OpenAPI     | M      |
| 5   | 成本真值源统一 + 调用前硬预算熔断                                    | P1     | Engine/Harness/Infra         | M      |
| 6   | 把最高后果的 honor-only 护栏固化为可执行 spec                        | P1     | Rules-Standards/Harness      | L      |
| 7   | 修复 DX 起栈/验证破窗                                                | P1     | DX                           | **S**  |
| 8   | step-level durable execution 与 re-dispatch 闭环                     | P2     | Harness/Playground           | XL     |
| 9   | PII 脱敏提升到 artifact 组合层 + 可配置策略                          | P2     | Playground/Engine            | M      |
| 10  | 补多租户/可观测/韧性规范文档 + 文档漂移修正                          | P2     | Rules-Standards/DX/Infra     | M      |
| 11  | 基建加固收尾:迁移治理/CBC 迁移/bcrypt/KMS/覆盖率门                   | P2     | Infra/Rules-Standards        | L      |
| 12  | 质量增强:真多判官投票 + MCP O(N) 鉴权 + facade 可发现性 + API 版本化 | P3     | 多层                         | M      |

### rank 1 — 对称补齐 IDOR(P0,一票否决项)

- **根因**:两处独立确认的 P0 同根 —— `HARNESS-SEC-001`(checkpoint/event_store 无 owner 列,resume/replay/fork 零过滤)与 `OAPI-001`(agents-api getTask/cancelTask/downloadArtifact 按单键查询无 userId),叠加 Playground workspace 读路径名存实亡。
- **风险**:agentId/taskId 多为业务派生**可枚举**,envelope 含对话/工具结果/生成产物(PPTX/DOCX/代码)。企业采购与渗透测试的**一票否决项**,整改成本远低于事故代价。
- **第一步**:为 `harness_checkpoints`/`harness_agent_events` 加 `ownerUserId` 列 + 索引(手写迁移),`PrismaCheckpointStore.save` 停止硬编码 `scope:JsonNull` 真正落 owner;同步在 `AgentsService.getTask/getArtifactDownload` 加 `where:{id,userId}` 并补"非 owner→404"端到端 spec。

### rank 2 — 统一 SSRF/出站防护

- **根因**:四处同根(`ENG-001` content-fetch 字面校验可 rebinding、`ENG-002` MCP relay 零校验、`OAPI-002` Webhook 仅 `@IsUrl`、`PG-02` description 直入 Leader prompt)。
- **风险**:SSRF 经云元数据(169.254.169.254)可直接升级为凭证泄露 + 横向移动。
- **第一步**:抽统一 `SsrfGuard` service(字面校验后做 DNS 解析 → 对所有 A/AAAA IP 复跑黑名单 → 请求时 pin IP + `redirect:'manual'`),先接线到 `content-fetch.validateUrl` 与 webhook dispatcher/test 两个最高危出站点。

### rank 3 — 分布式状态收敛 Redis

- **根因**:五处同根于"进程内内存态在水平扩展下失真"(`OAPI-004` Throttler/RateLimitGuard/MCP quota、`ENG-004` RateLimitService 默认 InMemory + MultiKeyManager static Map、`HARNESS-RES-001` MessagePersistence 纯内存)。
- **第一步**:实现并默认装配 `RedisTokenBucketStore` 在 bootstrap 调 `RateLimitService.setStore`;MCP dailyQuota 改 Redis `INCR`+`EXPIRE`;限流 tracker 从 IP 改 apiKeyId。

### rank 4 — 统一审计

- **根因**:`INFRA-P0-3`(工作分支无通用 audit_logs 表) + `PG-05`(run/rerun/visibility/budget 无 audit) + `OAPI-003`(成本/审计以 apiKeyId 串号)同根。
- **注意**:核查发现 `audit_logs` + `AuditLogService` **已在 origin/main**,首要动作是**合分支对齐而非从零建**。
- **第一步**:确认 origin/main 的 audit_logs 合入工作分支;再把 audit 接线扩展到 runMission/rerun×3/updateVisibility(记 from→to)/updateMission(预算)/secret reveal/credit freeze。

### rank 5 — 成本真值源 + 前置熔断

- **根因**:`ENG-003`(CostAttribution 不经 pricing registry grounding) + `HARNESS-COST-001`(估算账 vs 计量账不对账 + downgrade≈abort 未承接) + `INFRA-P1-3`(纯事后记账无前置闸门)。memory 已记录日烧 250K calls 事故。
- **第一步**:cost 记账入口强制以 `ModelPricingRegistry.estimateCost` 为权威,registry 返 null 时标 unpriced 维度而非计 0;调用方传值仅作对账。

### rank 6 — honor-only 护栏固化 spec

- **根因**:`RS-01` 确认 CLAUDE.md 10 条 agent-runtime 反向洞察全 honor-only,最致命的 #4(retry storm)/#5(断路器)/#8(跨 thread 污染)无任何拦截。
- **第一步**:ai-harness/runner 加单元 spec 断言连续失败 N 次必终止循环(#5)、API-error 路径不触发 token 注入 hook(#4),复用 `protection-net.spec.ts` 反向证据模式。

### rank 7 — DX 破窗(性价比最高)

- **根因**:`DX-1`(npm run dev 拉 uvicorn 但 README 漏列 Python,起栈必崩)、`DX-2`(verify:changed 指向不存在路径却被文档标推荐)、`DX-4`(test:quick 排除 jwt/guardrails/mcp 等 17 个安全关键 spec)。
- **第一步**:package.json 改 verify:changed 路径为 `scripts/utils/verify-changed.js`;README 补 Python + `pip install ai-service/requirements.txt`(或拆 dev:core/dev:full)。

---

## 6. Quick Wins(低成本高收益,可即刻做)

1. 修 `package.json` verify:changed 路径(→`scripts/utils/verify-changed.js`)+ CI 加 scripts 引用存在性断言(DX-2,S)
2. README/overview 补 Python>=3.x + `pip install -r ai-service/requirements.txt`,或拆 dev:core/dev:full(DX-1,S)
3. 统一文档端口为 4000、健康路径为 `/health`、删除不存在的 dev:crawler 改 dev:ai(DX-5,S)
4. 新增 `GET /missions/:id/cost`(走 assertReadAccess)暴露已落库的 CostLedger per-stage/role/model 明细 —— 台账已建好只差一个读端点(PG-04,S)
5. agent-invoker 复用 canonical `estimateUsdFromTokens` 消除内联 `0.000003` 魔数(PG-08,S)
6. 对外措辞修正:"辩论/选举" → "多层独立质量审查",对齐 openclaw-config 限流值与实际 `@Throttle`(PG-07,S)
7. webhook dispatch/test 的 fetch 加 `redirect:'manual'` 先堵重定向 rebinding,作为完整 SsrfGuard 前的即时止血(OAPI-002 部分,S)

---

## 7. 对标 SOTA 的真实优势(应保护 + 对外讲清)

1. **结构性并发正确性达生产级范本**:`MissionLifecycleManager.finalize` 单入口终态仲裁(条件写 WHERE status=running 首写赢)从根消除 split-brain;`pg_advisory_xact_lock` 原子兜底并发上限 TOCTOU;`claimOrphanFailed` 条件写原子认领 orphan(count===1 才续跑)消除多 pod 重复烧 credit。**质量超过多数开源 agent 框架。**
2. **BYOK 密钥栈 + 信封加密 v2 达企业 SOTA**:KeyResolver 严格单入口 + MaterializedKeyChain 有序 failover + LastGood 粘性 + Redis KeyHealthStore 三态健康机 + account-wide 429 启发式(对标/优于 LiteLLM router);AES-256-GCM + KEK-wrapped DEK + per-user HKDF 子密钥 + dual-read v1→v2 平滑过渡。
3. **成本计量正确范式**:`ModelPricingRegistry` 唯一来源 DB、unknown modelId 显式返回 null 而非假 0;CostLedgerStore 逐 stage append 真实用量、终态取 DB SUM 作权威值、单行 clamp 防脏数据。
4. **三层架构看护元治理**:ESLint no-restricted-imports + jest 架构 spec(AST/regex 双覆盖动态 import/注释逃逸) + pre-push/CI 合并门;`no-hardcoded-pricing.spec` 锁定价单一源、`capability-provider-string-match` 禁 `modelId.includes('gpt')` 类 substring 判能力;`protection-net` 用反向证据模式验 guard 真会 fire。**这套元治理在开源框架里罕见。**
5. **Runner 层成熟贴近 SOTA**:4+1 loop(ReAct/PlanAct/Reflexion/Simple/LeaderWorker)经 LoopRegistry 派发 + model-level failover + 有界退避 + 多重出口闸,显式落地 Claude Code v2.1.88 反向洞察 —— 这些是 LangGraph/AutoGen 文档都没系统化的 agent-runtime 韧性知识。
6. **研究编排产品形态完整 + 增量 rerun 真复用 trajectory**:7-agent 12-stage + per-dim DAG fanout + 多判官质量门 + checkpoint crash-resume;`inheritFromMissionId` 继承 plan+findings+合格 chapter 直达 signoff。
7. **工程复盘文化沉淀为可维护性资产**:代码内联文档承载血泪根因,CLAUDE.md 诚实标注 honor-only、EXCEPTIONS.md 把偏离变成有责任人有期限的登记 —— **透明度本身是企业级交付的信任资产**。

---

## 8. 各层关键差距索引(供逐项追溯)

> 完整逐条(含 currentState/recommendation/evidence 文件路径/对抗核查 verdict)见 workflow 输出 `wf_1f2ecaaf-6d0`。

- **Playground**:PG-01 workspace 隔离名存实亡(P1) · PG-02 description 注入面(P1) · PG-03 PII 覆盖不足(P2) · PG-04 成本明细无端点(P2,quick win) · PG-05 审计仅 cancel/delete(P2) · PG-06 非 step-level durable(P2) · PG-07 "辩论选举"名实不符(P3) · PG-08 成本魔数(P3)
- **Harness**:HARNESS-SEC-001 checkpoint/event-store 无 owner 列(P0) · HARNESS-RES-001 消息纯进程内(P1) · HARNESS-RES-002 re-dispatch 不闭环(P2) · HARNESS-COST-001 双账不对账(P1) · HARNESS-HITL-001 无一等公民 HITL(P3)
- **Engine**:ENG-001 SSRF 可 rebinding(P1) · ENG-002 MCP relay 零校验(P1) · ENG-003 成本不经 pricing grounding(P1) · ENG-004 限流 InMemory + static Map(P1) · ENG-006 工具无幂等键(P3)
- **OpenAPI**:OAPI-001 agents-api IDOR(P0) · OAPI-002 Webhook SSRF(P1) · OAPI-003 审计串号(P1) · OAPI-004 限流进程内(P1) · OAPI-007 无 API 版本化(P3) · OAPI-008 每请求 O(N) 解密全 key(P3)
- **Infra**:INFRA-P0-3 无通用审计表(已在 main,合分支) · INFRA-P1-1 迁移失败标 applied(P2) · INFRA-P1-3 无前置预算(P1) · INFRA-P2-1 CBC 无 AEAD(P2) · INFRA-P2-2 bcrypt cost=10 + KEK 未接 KMS(P2)
- **Rules-Standards**:RS-01 10 条护栏 honor-only(P1) · RS-02 无多租户隔离规范 · RS-03 10-security.md 陈旧 · RS-04 无可观测/SLO 规范 · RS-05 覆盖率门未进 CI · RS-06 无 async-resilience 规范
- **DX**:DX-1 起栈漏 Python · DX-2 verify:changed 路径错 · DX-4 test:quick 排除安全 spec · DX-5 文档端口/健康路径漂移 · DX-6 facade 单 barrel 1555 行

---

## 9. 建议执行节奏

- **第一波(企业级就绪门槛)**:rank 1(P0 IDOR) + rank 2(SSRF) + rank 4(审计合分支) —— 守住采购/渗透必查项
- **第二波(生产可扩展)**:rank 3(分布式状态) + rank 5(成本熔断) + rank 6(护栏 spec) —— 多 pod 真实性
- **穿插(随时做)**:rank 7 + Quick Wins —— 全是 S,性价比最高,先做不亏
- **长期(架构投入)**:rank 8(durable execution,XL) + rank 9-12 —— 在安全/分布式基线稳固后排期
