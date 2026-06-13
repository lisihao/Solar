# 产业链分析（Industry Chain Analysis）— 实现方案设计基线

**状态：** ✅ 实现完成 v1.2（全 6 阶段；37 单测 + 406 arch 全绿；部署态验证项见 §8.5）
**日期：** 2026-06-06（v1.2 实施完成）
**作者：** Claude Code
**分支：** `claude/industrial-chain-analysis-vsNux`
**关联：** [AI 架构分层 CLAUDE.md](../../../.claude/CLAUDE.md) · [标准 16 AI Engine/Harness 结构](../../../.claude/standards/16-ai-engine-harness-structure.md) · [标准 22 前端 UI 组件治理](../../../.claude/standards/22-frontend-ui-component-governance.md)
**评审纪要：** [industry-chain/review-minutes.md](./review-minutes.md)

> **一句话目标**：输入一条产业链主题（如"算力底座"），由 **agent 动态编排** 调用 **SEC EDGAR + Web 搜索** 抽取产业链上中下游环节与参与者公司，结构化落库为 **实体 + 关系图谱**，前端复用 `KnowledgeGraphView` 渲染**可点击**的链路图——点击任一参与者节点即可查看其简介与 SEC 财报引用来源。能力**全部复用现有 ai-harness / ai-engine**，新增能力按下沉判据归位。

---

## 1. 背景与需求

- 用户诉求：构建"产业链分析"能力，能点击产业链看到链上所有相关参与者。
- 关键决策（已与用户确认）：
  1. **数据来源**：从 SEC 等权威外部源取数（不是 AI 凭空生成）。
  2. **落地形态**：动态编排 + 独立模块（非 Topic Insights 固定维度流水线衍生）。
  3. **网络**：远程容器可联外网，SEC / web-search 可真实调用。
  4. **能力约束（硬）**：所有能力必须复用现有 harness/engine；缺失能力构建并审视下沉为通用能力，扩展能力在既有能力上原地扩展。

### 1.1 一个必须对齐的认知

SEC EDGAR 提供的是**单公司权威披露**（10-K/10-Q/8-K 文本），**不直接提供产业链拓扑**。链条结构需 AI 从财报文本 + Web 搜索中抽取组装。SEC 在本方案中的角色是给每个参与者公司提供**可信事实背书与引用来源**，而非产业链骨架本身。

---

## 2. 业界标杆与借鉴点

| 标杆 | 借鉴点 |
| ---- | ------ |
| **Bloomberg SPLC** | 数据源 = SEC + 财报 + 电话会纪要（与本方案一致）；关系带**敞口权重**（营收/成本 %）→ `IndustryRelation.weight` |
| **FactSet Revere** | 关系分类法（客户/供应商/竞争/战略伙伴）；**定期基于 SEC 复核** = 增量刷新节奏 |
| **Microsoft GraphRAG** | LLM 抽主-谓-宾三元组建图；**反面教训**：原生不支持增量、需周期性全量重建、抽取昂贵 → 本方案用 SEC 指纹 delta 触发规避 |
| **Graphiti（Neo4j）** | 增量知识图谱：单节点/单边增量更新、**时序关系（valid_from/valid_to）**、实体去重消歧、不重建整图 |
| **AWS Agentic GraphRAG（资本市场）** | agent 动态编排 + 从 10-K 抽边 + **多跳遍历**发现级联依赖 |
| **REFinD / GPT-FinRE** | 金融关系/实体分类法；LLM in-context 抽取范式 |

**同类产品**（产品形态参考蓝本）：天眼查产业大脑、企查查产业链、启信产业大脑、火石创造、同花顺/Wind 产业链（中国市场，重数据运营）；CB Insights Market Map、PitchBook、Tracxn（西方）。

**差异化定位**：现有玩家重人工数据运营；本方案 = **AI 动态编排（覆盖长尾/新兴产业链）+ SEC 权威背书 + 轻量增量刷新（低 AI 成本保鲜）**。

---

## 3. 能力归位（复用 / 扩展 / 新建下沉）

> **下沉判据**：零 agent/mission 状态 + 多潜在消费方 → 下沉 engine/common；含产业链领域语义 → 留 app。

| 能力 | 归类 | 落点 | 复用度 |
| ---- | ---- | ---- | ------ |
| 动态编排 agent | 复用 | `ai-harness/facade`（`MissionPipelineOrchestrator`） | ✅ |
| 增量更新 + 版本化 | 复用 | `ai-harness/memory/{checkpoint,working,consolidation}` | ✅ |
| 关系可信度共识校验 | 复用 | `ai-harness/evaluation/verify/judge.service`（self/external/critical 三评） | ✅ |
| 嵌入向量底座 | 复用 | `ai-engine/rag/embedding` | ✅ |
| 实体/关系三元组抽取 | **复用抽取范式/prompt 经验** | chain-mapper agent 用产业链 prompt 直出结构化关系 JSON（Zod 约束） | ⚠️ M2：`extractFacts` 无 `category` 入参、输出非三元组，不能直接复用其 API；复用的是抽取 prompt 经验，落库前补"名→id 消歧 + relationType 枚举分类"映射步 |
| **N-hop 多跳查询** | **新增首个递归 CTE 能力** | `common/graph/graph.service.ts` 新增 `nHopNeighbors(nodeId, depth, edgeTable, relTypes?)` | ⚠️ M(SHOULD)：GraphService 现无任何 `WITH RECURSIVE`，此为首个边表遍历方法（形态异于现有 resource-bound 方法）；须带环路检测 |
| **SEC EDGAR 工具** | **新建 → 天然下沉** | `ai-engine/tools/categories/information/data/sec-edgar.tool.ts` | 🆕 通用数据源，与 finance-api 同层 |
| **实体语义去重/消歧** | **新建 → 下沉 engine/knowledge** | `ai-engine/knowledge/entity-resolution/entity-resolution.service.ts` | 🆕 零 agent 状态、多消费方（决策已确认） |
| 产业链数据模型 | 新建 → 留 app | `ai-app/industry-chain/` Prisma schema | 🆕 领域语义 |
| 编排 pipeline/agent/controller/落库 | 新建 → 留 app | `ai-app/industry-chain/` | 🆕 领域业务 |

---

## 4. 数据模型（手写 SQL 迁移，不用 `prisma migrate dev`）

```prisma
model IndustryChain {
  id        String  @id @default(cuid())
  topic     String
  status    String  // PLANNING | RUNNING | COMPLETED | FAILED
  ownerId   String
  missionId String?
  createdAt DateTime @default(now())
  entities  IndustryEntity[]
  relations IndustryRelation[]
}

model IndustryEntity {
  id                String   @id @default(cuid())
  chainId           String
  name              String
  type              String   // SEGMENT | COMPANY | PRODUCT
  cik               String?  // SEC CIK
  segment           String?  // 所属环节
  description       String?  @db.Text
  sourceRefs        Json?    // SEC 引用 [{accessionNumber, url, reportType, date}]
  sourceFingerprint String?  // 增量 delta 触发依据
  version           Int      @default(1)
  lastRefreshedAt   DateTime?
  chain             IndustryChain @relation(fields: [chainId], references: [id], onDelete: Cascade)
  @@index([chainId])
  @@index([cik])
}

model IndustryRelation {
  id           String   @id @default(cuid())
  chainId      String
  sourceId     String
  targetId     String
  relationType String   // SUPPLIES | CONSUMES | COMPETES_WITH | PARTNERS_WITH | BELONGS_TO
  weight       Float?   // 敞口 %（借 Bloomberg SPLC）
  evidence     String?  @db.Text
  validFrom    DateTime?  // 时序（借 Graphiti）
  validTo      DateTime?  // null = 当前有效；非 null = 已失效（不删，标记）
  chain        IndustryChain @relation(fields: [chainId], references: [id], onDelete: Cascade)
  @@index([chainId])
  @@index([sourceId])
  @@index([targetId])
  @@unique([chainId, sourceId, targetId, relationType])  // M8：防增量刷新产生重复边
}
```

> **M8 落库前确定性校验**（persist 步，非 LLM）：`relationType` 枚举白名单 + `weight ∈ [0,1]` + 自环拒绝 `sourceId !== targetId` + `cik` 为 10 位数字 + `sourceRefs[].url` 协议白名单（仅 `https://`/`http://`）。
> **状态字段**：`status`/`type`/`relationType` 用 `String`（避免 `ALTER TYPE` 迁移坑），app 层用 TS 联合类型约束防漂移。

---

## 5. 增量更新策略（省 AI 核心）

| 档位 | 触发 | AI 消耗 | 做法 |
| ---- | ---- | ------- | ---- |
| **L0 零 AI** | 节点定期刷新 | 0 token | 拉 SEC `submissions` JSON（纯 HTTP），比对 `sourceFingerprint`，无变化只更新 `lastRefreshedAt` |
| **L1 小 AI** | 指纹变化（出新财报） | 1 次 short 调用 | 只对该节点新文件做摘要，更新该行 + `version++` |
| **L2 局部编排** | 某环节关系可能变 | 1 次 scoped mission | chain-mapper 只跑该 segment 子图，不碰其余 |
| **L3 全量重算** | 链条结构变 | 全量 | 罕见，低频/手动 |

复用 `ai-engine/knowledge/consistency/stale-detector.service` 批量挑出待刷新节点。

---

## 6. 实施阶段（每步附 verify）

### Phase 0 — 前置（facade / 注册策略，SHOULD-FIX）

- **0.1** `ai-engine/facade/index.ts` 补 export `EntityResolutionService` 及其类型（CLAUDE.md"先补 facade export 再用"）。
- **0.2** 确认 SEC 工具注册策略 = app 层 `industry-chain.module.ts` 的 `onModuleInit` 经 `ToolRegistry.register()` 动态注册（非 facade 转发，避免膨胀）。
  - **verify**：`ai-app/industry-chain` 引用这些符号时 `npm run lint` 无 no-restricted-imports error

### Phase 1 — 下沉 engine 的通用能力（先建，复用价值高 + 风险最高）

- **1.1 SEC EDGAR 工具**（M3/M4）✅ 已实现：`ai-engine/tools/categories/information/data/sec-edgar.tool.ts`，`BaseTool` 子类。
  - **M3 细化（基于实现期新证据）**：复用 `PolicyDataService.httpGet`（内建 30s 超时 + host 级 429 冷却 + 自定义 header 覆盖，且**不**强制 API Key）——所有同类公开 API 工具（federal-register/congress/arxiv）均复用它，比自写 fetch 更符合"全部复用"。M3 精神（不照搬 finance-api 15s 节流）以**工具内 `MIN_REQUEST_INTERVAL=100ms` 自建节流**（10 req/s）保留。
  - CIK 查找改用 SEC 推荐的 `company_tickers.json`（ticker/title→CIK 全量映射，内存缓存 6h）；提交记录 `data.sec.gov/submissions/CIK{补零10位}.json`。UA = `{brand.name}-IndustryChain {brand.contactEmail}`（SEC 合规）。
  - 安全：UA 合规；catch 仅记 message，不透完整响应体/内部拓扑。
  - **verify（开发态）**✅：类型检查通过 + 9 个离线单测全绿（fixture 喂 mock httpGet，覆盖 CIK 解析/过滤/URL 构造/UA/节流）。
  - **verify（部署态，待）**：sec.gov 在开发容器 egress 白名单之外（403），真实联网调用 = **部署后冒烟检查**，不在开发态执行。
- **1.2 实体消歧服务**（M2 配套 + SHOULD）：`ai-engine/knowledge/entity-resolution/entity-resolution.service.ts`，复用 `EmbeddingService` **取向量**，服务内**自实现 cosine** 比较，相似度 > **0.85（初始值，需按所用 embedding 模型分布校准，留调参入口）** 合并。
  - **verify**：集成测试（标注需真实 embedding 服务）或用预计算 mock 向量，"NVIDIA"/"英伟达"/"Nvidia Corp" 归并为 1 实体；含一组"形近不同实体不误并"反例

### Phase 2 — 原地扩展既有能力

- **2.1 N-hop 多跳查询**（M-SHOULD）：`common/graph/graph.service.ts` 新增 `nHopNeighbors(nodeId, depth, edgeTable, relTypes?)`——首个 `WITH RECURSIVE` 边表遍历，参数化边表（不写死产业链域）。**必须带环路检测**（`path` 数组 + `WHERE NOT (id = ANY(path))` 或 PG14+ `CYCLE` 子句），因产业链存在合法互供环（A供B、B也供A）。
  - **verify**：单测自带 `IndustryRelation` 夹具；**含环图 3 跳不死循环**；返回正确 nodes/edges

### Phase 3 — 数据模型（留 app）

- **3.1** `models.prisma` 新增 3 model（见 §4）+ 手写迁移 `prisma/migrations/20260606_industry_chain/migration.sql`；`prisma generate`。
  - **verify**：`prisma generate` 无错；迁移 `migrate deploy` 本地成功

### Phase 4 — 产业链业务编排（留 app）

- **4.1**（M2/M5）`agents/chain-mapper/SKILL.md`：ReAct loop，白名单 `[web_search, web_scraper, sec_edgar_search]`，**产业链专用 prompt 直出结构化关系 JSON**（Zod `{source,target,relationType,evidence,weight}`，非依赖 `extractFacts` API）；system prompt **必附** `EXTERNAL_CONTENT_SYSTEM_NOTICE`（间接注入防御）。
- **4.2**（M1）`pipeline/industry-chain.config.ts`：`defineMissionPipeline()`，step 用**合法 primitive**：`research`(SEC/web 抽取) → `synthesize`(实体消歧组图 + 名→id + relationType 分类) → `review`(JudgeService 共识 **+ persist 前确定性结构校验 M8**) → `persist`(落库)。
- **4.3**（M6）`industry-chain.service.ts`：经 `ai-harness/facade` 发起编排；落库；`getGraph()`/`getEntity()` **所有读写带 `{ where: { ..., ownerId: userId } }` 过滤**（防 IDOR）；mission 支持 `abortRegistry` 取消。
- **4.4**（M7）controller：类级 `@UseGuards(JwtAuthGuard)` + `@UseInterceptors(BillingContextInterceptor)`；端点 `POST /analyze`(≤5/min)、`GET /:id`、`GET /:id/graph`、`GET /entity/:id`(GET ≤30/min)、`POST /:id/entity/:eid/refresh`(≤5/min, running 态拒重复)、`POST /:id/cancel`。topic DTO `@IsString @MaxLength(500)` + service `sanitizePromptInput(topic)`。
- ⚠️ `.module.ts` 与 `app.module.ts` 接入由主 Agent 手动完成（Sub-Agent 禁建模块/改入口）。
  - **verify**（强标准）：`/analyze` 返回 missionId；mission 完成后 `nodes.length>=3 && edges.length>=2`；≥1 个 COMPANY 节点 `sourceRefs` 含真实 SEC `accessionNumber`；消歧合并 ≥1 对候选实体（日志可查）；越权访问他人 chain 返回 403/404；`/cancel` 可中止；`verify:arch` 通过

### Phase 5 — 前端（复用 KnowledgeGraphView，不自写图谱）

- **5.1** `app/industry-chain/[chainId]/page.tsx` + service hook；复用 `components/common/views/KnowledgeGraphView.tsx`；节点配色走 design tokens；入口用 canonical 组件（Modal/Button/EmptyState/LoadingState）。
  - **链路布局（用户决策 2026-06-06）**：`KnowledgeGraphView` 现有 `force/circular/hierarchical` 均不适配产业链"上→下游分层流向"（hierarchical 实为按节点类型分带）。决策 = **在该 canonical 组件内原地新增 `layout='chain'` 模式**（按 segment 分泳道/分层、方向排列），符合"既有能力原地扩展"铁律，点击交互复用现有 `selectedNode` 详情面板。
- **5.2** 点击节点 → 右侧面板显示 `description` + SEC 引用链接。**XSS 防护**：`description` 用纯文本节点渲染（禁 `dangerouslySetInnerHTML`）；SEC 链接渲染前校验 `url.startsWith('https://')`，不满足不渲染为链接；WebSocket 监听在组件卸载 `useEffect` 清理中 `socket.off`。
  - **verify**：`audit:ui-discipline` 基线不上涨；类型检查 0 error；远程 URL 实点验证

### 安全规格（汇总，跨 Phase 落实）

| 项 | 落点 | 来源 |
| -- | ---- | ---- |
| 间接注入：`sec_edgar` 加入 `EXTERNAL_TOOL_SOURCE` 正则 `/sec.?edgar\|edgar.?sec\|sec.?filing/i`；chain-mapper 附 `EXTERNAL_CONTENT_SYSTEM_NOTICE` | `ai-harness/runner/loop/external-observation.util.ts` + SKILL.md | M5 |
| IDOR：service 所有读写带 `ownerId: userId` 过滤 | §4.3 | M6 |
| 鉴权 + 限流 + 计费上下文 | §4.4 | M7 |
| 输入校验 + sanitize | §4.4 | M7 |
| persist 前确定性结构校验（枚举/范围/自环/CIK/URL 协议） | §4.2 review 步 | M8 |
| SEC SSRF：固定域名 `assertUrlSafe`，二级 URL `safeFetch`，错误日志限粒度 | §1.1 | 安全 P2 |

### Phase 6 — 交付前自检 + 提交

- 交付清单全过（DB 配套 / 前后端协议 / 错误路径 / 资源清理 / 安全边界 / 旧码清理 / 规范）。
- `verify:full` + `verify:arch` 全绿 → commit → push 到 `claude/industrial-chain-analysis-vsNux`（不建 PR 除非用户要）。

---

## 7. 成功标准（强标准）

1. `POST /industry-chain/analyze {topic:"算力底座"}` 返回 `missionId`，WebSocket 收到 stage 事件
2. mission 完成后 `GET /industry-chain/:id/graph` 返回 `{nodes,edges,stats}`，`nodes.length>0 && edges.length>0`
3. ≥1 个 COMPANY 节点带非空 `sourceRefs`（SEC 引用）
4. 前端点击节点 → 右侧详情面板出现；`npm run verify:full` + `verify:arch` 全绿

---

## 8. 风险

| 风险 | 等级 | 缓解 |
| ---- | ---- | ---- |
| 抽取质量（agent 编关系/幻觉） | 高 | JudgeService 共识校验入库前拦截；先固定"算力底座"单例调通再泛化 |
| SEC 限速/UA 要求 | 中 | 内置限速 + 退避 + 声明性 UA |
| 财报正文超长 | 中 | 抽取走 web-search 摘要 + 关键段落，不全文解析 |
| 实体消歧误并/漏并 | 中 | 阈值可调（0.85）+ 保留人工校正入口（后续） |
| 手写迁移失败 | 低 | 禁用 `DO $$ EXCEPTION` 包 ALTER TYPE |

---

## 8.5 实施完成情况（2026-06-06）

全 6 阶段已实现并提交到 `claude/industrial-chain-analysis-vsNux`。开发态验证（类型检查 + 离线单测 + 架构边界 + UI 纪律）全绿；需真实 DB/LLM/SEC egress/前端 runtime 的部分属**部署态验证**（本开发容器无这些）。

| Phase | 内容 | 开发态验证 |
| ----- | ---- | ---------- |
| 1.1 | SEC EDGAR 工具 | ✅ tsc + 9 单测 |
| 1.2 | 实体消歧服务（下沉 engine/knowledge） | ✅ tsc + 7 单测 |
| 2 | N-hop 递归 CTE（扩展 common/graph） | ✅ tsc + 5 单测（含白名单防注入/环路检测断言） |
| 3 | 数据模型 + 手写迁移 | ✅ prisma validate/generate + 3 delegate |
| 4a | 抽取 schema + M2 映射 + M8 校验 + M5 | ✅ tsc + 11 单测 |
| 4b | service/controller/module/pipeline | ✅ tsc + 5 单测 + verify:arch 406 全绿 |
| 5 | 前端 chain 布局 + 页面 | ✅ tsc + audit:ui-discipline 0 违规 |

**合计 37 新增单测全绿；verify:arch 406 全绿；前后端 tsc 0 error。**

### 部署态验证清单（待 sec.gov egress / DB / LLM / 前端 runtime 的环境执行）
1. `prisma migrate deploy` 应用 `20260612_add_industry_chain` 迁移
2. SEC 工具对真实公司（如 NVIDIA）联网返回 filings（容器 egress 白名单不含 sec.gov → 部署后冒烟）
3. `POST /industry-chain/analyze {topic:"算力底座"}` 跑通 mission，`GET /:id/graph` 返回 `nodes≥3 && edges≥2`，≥1 COMPANY 带真实 SEC `accessionNumber`
4. 前端页面点击节点见详情面板（chain 布局上→下游分列）

### 编排 persist 衔接 —— 已按方案 B 接线（用户决策 2026-06-06）
关键认知：stage primitive 是**通用编排壳**，不自己跑 agent，而是调注入的 hook——所以 **B 包住了 A**：
- `research.perItemPipeline` hook 经 `HarnessFacade.execute` 跑 chain-mapper agent（ReAct + 工具）产出结构化抽取（= A 的 agent 跑法）。
- `persist.persist` hook 读 research 输出 → `IndustryChainService.persistExtraction` 落领域表（M2 映射 + M8 校验在内）。
- 框架白送 mission 生命周期/事件流/checkpoint/cost。
- pipeline 精简为 `research→persist` 两步（消歧/结构校验已内含于 persistExtraction）；JudgeService 共识 review step 为后续可选增强。

hook 闭包绑定 service（含 HarnessFacade），故 pipeline 运行时构建（`service.buildPipeline()`）后注册。
**离线验证**：buildPipeline 接线单测（research hook 跑 agent 解析 + persist hook 落库）已绿；**端到端跑通仍属部署态**（需 LLM + SEC egress + DB）。

---

## 9. 评审结论

> 四路并行评审（架构师 / 架构看护 / 可行性 / 安全）—— **有条件通过，0 否决**。8 项 MUST-FIX 已全部回填本 v1.1（M1 pipeline primitive 合法化、M2 抽取映射、M3 SEC 限速、M4 CIK 端点、M5 间接注入、M6 IDOR、M7 鉴权限流、M8 唯一约束+结构校验）+ SHOULD-FIX（Phase 0 facade、N-hop 环路检测、消歧阈值校准、Phase 4 强 verify）。详见 [review-minutes.md](./review-minutes.md)。
>
> **状态 ✅ 评审一致通过，进入 Phase 0/1 实施。**
