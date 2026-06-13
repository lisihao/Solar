# 产业链分析方案 — 多路评审纪要

**评审日期：** 2026-06-06
**评审对象：** [implementation-plan.md](./implementation-plan.md) v1.0
**评审方式：** 四路并行集中审视（架构师 / 架构看护 / 可行性·数据模型 / 安全边界），各路独立核对真实代码
**结论：** **有条件通过** — 0 个否决项，但有 **8 项 MUST-FIX** 必须回填方案后方可开工。已回填为 v1.1。

---

## 1. 四路总评

| 评审路 | Agent | 总评 | 关键发现数 |
| ------ | ----- | ---- | ---------- |
| 架构师 | architect | 有条件通过 | 2 严重 + 3 中轻 |
| 架构看护 | arch-guardian | 条件通过（9.5/10，0 阻断） | 1 MUST + 2 SHOULD |
| 可行性·数据模型 | reviewer | 有条件通过 | 2 MUST + 4 SHOULD |
| 安全边界 | security-auditor | 中等偏弱（基建强，方案明确度不足） | 1 严重 + 2 高 + 3 中 + 2 低 |

**一致认可**：技术方向正确（动态编排 + SEC 背书 + 增量刷新 + 复用图谱视图）；下沉判据用得对；依赖方向 L3→L2.5→L2 单向无穿透风险（除新建符号需补 facade export）。

---

## 2. 合并 MUST-FIX（开工前必须回填，已落入 v1.1）

| # | 来源 | 问题 | 修正 |
| - | ---- | ---- | ---- |
| **M1** | 架构师 | §4.2 pipeline primitive `map/resolve/verify` **不存在**——`StagePrimitiveId` 是闭合联合 `plan\|research\|assess\|synthesize\|draft\|review\|signoff\|persist\|learn`；新增 primitive 属改 harness 框架（禁区） | 映射到既有 primitive：抽取→`research`、消歧组图→`synthesize`、共识+结构校验→`review`、落库→`persist` |
| **M2** | 架构师 + 可行性 | `extractFacts(category:'relationship')` **签名不存在**（无 category 入参）；输出 `EstablishedFact`（自由文本 statement + 实体名数组，无方向/无枚举/无 DB id），**不是三元组** | chain-mapper agent 用产业链专用 prompt **直出结构化关系 JSON**（Zod 约束 `{source,target,relationType,evidence,weight}`）；§3"复用度"从 ✅ 降级为"复用抽取范式/prompt 经验"。落库前补显式映射：名→id（消歧）+ relationType 枚举分类 |
| **M3** | 可行性 | SEC 工具**不能照搬** finance-api 限速（15s/次、AlphaVantage 专用、依赖 PolicyDataService+ApiKey）；SEC 是 10 req/s、无 Key、标准 HTTP 429 | SEC 工具自定 `MIN_REQUEST_INTERVAL≈100ms`、标准 `fetch`、不注入 PolicyDataService；UA 格式 `GenesisPod-IndustryChain admin@<domain>` |
| **M4** | 可行性 | CIK 查找端点错误：`data.sec.gov/submissions/CIK*.json` 是**按 CIK 取数**，不是按名查 CIK | 两步：① `efts.sec.gov/LATEST/search-index?q={name}` 或 `browse-edgar` 查 CIK ② `data.sec.gov/submissions/CIK{补零10位}.json` 取 submissions；多匹配需名称消歧 |
| **M5** | 安全 (P0) | `sec_edgar_search` 新 toolId **未被** `external-observation.util` 的 `EXTERNAL_TOOL_SOURCE` 覆盖 → 财报正文裸进 LLM，间接 prompt injection (OWASP LLM01) | 在 `external-observation.util.ts` 的 `EXTERNAL_TOOL_SOURCE` 加 `/sec.?edgar\|edgar.?sec\|sec.?filing/i`；chain-mapper SKILL.md system prompt 附 `EXTERNAL_CONTENT_SYSTEM_NOTICE` |
| **M6** | 安全 (P0) + 架构看护 | 图谱读取/刷新端点缺 `ownerId` 过滤 → IDOR 越权读他人链/烧他人配额 | service 层**所有读写**带 `{ where: { id, ownerId: userId } }`；controller 从 `req.user.id` 取 userId（参照 playground `assertOwnership` / insight `getTopic(userId,id)`） |
| **M7** | 安全 (P1) + 架构看护 | controller 鉴权规格未定义；topic 输入无校验直拼进 system prompt | 类级 `@UseGuards(JwtAuthGuard)` + `@UseInterceptors(BillingContextInterceptor)`；`POST /analyze` 与 `/refresh` 限流 ≤5/min，GET ≤30/min；topic DTO `@IsString @MaxLength(500)` + service 层 `sanitizePromptInput(topic)` |
| **M8** | 架构师 + 安全 | `IndustryRelation` 无唯一约束 → 增量刷新产生重复边；persist 缺结构性校验 | 加 `@@unique([chainId,sourceId,targetId,relationType])`；persist 前确定性校验：relationType 枚举白名单 + weight 范围(0-1) + 自环 `sourceId!==targetId` + CIK 10 位 + sourceRefs.url 协议白名单(https/http) |

---

## 3. SHOULD-FIX（已落入 v1.1，不阻断）

| 来源 | 项 | 处理 |
| ---- | -- | ---- |
| 架构看护 | EntityResolutionService 须先在 `ai-engine/facade` 补 export；SEC 工具走 app `onModuleInit` 经 `ToolRegistry.register()` 动态注册（非 facade 转发） | 新增 Phase 0 |
| 架构师 + 可行性 | N-hop 是 GraphService **首个**递归 CTE / 边表遍历（非"原地同类扩展"）；产业链有环（A供B、B也供A）需环路检测；verify 自带 IndustryRelation 夹具 | §3 备注改写 + Phase 2 加环路检测 + 含环 3 跳不死循环单测 |
| 可行性 + 架构师 | 消歧 0.85 阈值需按所用 embedding 模型校准；`EmbeddingService` 只产向量、无 cosine API（消歧服务自实现比较）；verify 实为集成测试 | §1.2 标"初始值需校准"+ 自实现 cosine + verify 改集成测试或预算向量 mock |
| 可行性 | Phase 4 verify 是弱标准（"DB 有行"无下限；"满足成功标准"循环引用） | 改强标准（见 v1.1 Phase 4） |
| 安全 (P2/低) | SEC 响应内二级 URL 用 `safeFetch`；错误日志只记状态码+域名；mission cancel + refresh 幂等 + 前端 WebSocket 卸载清理 | 落入 §1.1 / 安全规格 / Phase 4 verify |

---

## 4. 处置

- v1.0 → **v1.1**：8 项 MUST-FIX + SHOULD-FIX 全部回填；新增 Phase 0（facade/注册前置）与"安全规格"小节。
- 状态：v1.1 **评审一致通过**，进入 Phase 0/1 实施。
- 实施期约束：每 Phase verify 后跑 `verify:arch`；逐文件 diff 审查；交付前 `verify:full` 全绿。
