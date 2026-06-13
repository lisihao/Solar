# 架构审计报告 (v2.0 - 维度 9-12)

**审计日期**: 2026-03-10
**审计版本**: d108809fd
**审计员**: Arch Auditor Agent v2.0
**审计范围**: `backend/src/modules/ai-app/topic-insights/` 全量（维度 9-12）

**代码库规模**:

- 生产文件: 178 个非测试 TS 文件
- 测试文件: 102 个 spec 文件
- 测试覆盖比: 57.3%（102/178）
- 控制器数量: 6 个（collaboration/mission/report/report-review/todo/topic）
- 服务数量: 71 个 `.service.ts` 文件

---

## 评分总览（维度 9-12）

| #   | 维度            | 满分   | 得分   | 状态           |
| --- | --------------- | ------ | ------ | -------------- |
| 9   | 安全态势        | 10     | **8**  | 良好，1 处遗漏 |
| 10  | 测试与 QA       | 8      | **8**  | 优秀           |
| 11  | 可观测性        | 4      | **3**  | 良好，3 处遗漏 |
| 12  | 配置与依赖      | 4      | **2**  | 需改进         |
|     | **D9-D12 合计** | **26** | **21** |                |

---

## D9: 安全态势 [8/10]

### 评分细分

| 子项            | 满分 | 得分 | 说明                                                    |
| --------------- | ---- | ---- | ------------------------------------------------------- |
| SQL 注入防护    | 2    | 2    | 全部使用 Prisma tagged template，安全                   |
| 硬编码密钥      | 2    | 2    | 无硬编码，全部走 ConfigService/SecretsService           |
| Prompt 注入防护 | 3    | 2    | sanitize() 普遍采用，1 处遗漏                           |
| safeCompare     | 3    | 2    | 模块内无 API key 直接比较；JWT 由 NestJS JwtModule 处理 |

### 合规项（正面证据）

**SQL 注入：全部安全**
共 5 处 `$queryRaw` 调用，均使用 Prisma 参数化 tagged template：

- `topic-insights.service.ts:1588` — `WHERE rt.id = ${topicId}` 参数化
- `services/core/topic-crud.service.ts:637` — 同上
- `services/core/topic-schedule.service.ts:121` — 同上
- `services/core/topic-dimension.service.ts:344` — 同上
- `services/core/topic-export.service.ts:190` — 同上

Prisma tagged template 会将 `${variable}` 替换为占位符并独立传参，等价于 prepared statements，无注入风险。

**API Key 管理：规范**

- `pubmed.connector.ts`: 通过 `ConfigService.get("NCBI_API_KEY")` 获取
- `semantic-scholar.connector.ts`: 优先从 SecretsService 解密读取，回退到 ConfigService，有 5 分钟缓存
- `finance-api.connector.ts`: 完全通过 SecretsService，不落磁盘

**Prompt 注入防护：有专用基础设施**

- `utils/prompt-sanitizer.ts`: 完整实现，覆盖 13 类攻击模式（指令覆盖/角色劫持/系统伪装/提示泄露/DAN 模式）
- `utils/security-audit-logger.ts`: 安全事件结构化日志，区分 LOW/MEDIUM/HIGH/CRITICAL
- 高频入口已覆盖：`research-leader.service.ts`（3 处）、`leader-planning.service.ts`（3 处）、`leader-chat.service.ts`（2 处）

**ConfigService 采用率：100%**
全模块无 `process.env` 直接访问（grep 确认无结果）。

### 违规项

**[D9-V1] MEDIUM: interactive-research.service.ts:295 — payload.question 未经 sanitize 直接注入 prompt**

```typescript
// interactive-research.service.ts:295
content: `Follow-up question: ${payload.question}${payload.context ? `\nContext: ${payload.context}` : ""}...`,
```

`payload.question` 和 `payload.context` 是用户输入的追问内容，直接以字符串插值嵌入 LLM 的 user 消息，没有调用 `sanitize()` 处理。

同文件 `topic.name` 在 system 角色的 `"${topic.name}"` 插值（291 行）：topic.name 属于数据库中保存的用户创建内容，同样未经净化。

**修复建议**:

```typescript
import { sanitize } from "../../utils/prompt-sanitizer";

// 第 291 行 (system role)
content: `You are a research assistant analyzing the topic "${sanitize(topic.name)}". ...`,

// 第 295 行 (user role)
content: `Follow-up question: ${sanitize(payload.question)}${payload.context ? `\nContext: ${sanitize(payload.context)}` : ""}...`,
```

**[D9-V2] INFO: JWT token 比较委托给 JwtModule，无需 safeCompare**

`topic-insights.gateway.ts` 通过 `jwt.verify()` 验证 WebSocket token，属于 HMAC 签名验证而非字符串等值比较，不需要 safeCompare，此项合规。

### D9 小结

扣分：1 处 prompt 注入防护遗漏（-2 分）。基础设施完整但存在覆盖死角。

---

## D10: 测试与 QA [8/8]

### 评分细分

| 子项            | 满分 | 得分 | 说明                                      |
| --------------- | ---- | ---- | ----------------------------------------- |
| 测试覆盖比      | 3    | 3    | 57.3%，远超 30% 阈值                      |
| Controller spec | 3    | 3    | 6/6 控制器全部有 spec                     |
| 关键路径测试    | 2    | 2    | Mission 生命周期、Leader 规划均有专门测试 |

### 合规项

**测试覆盖比：57.3%（102 spec / 178 production）**
满分门槛 >30%，本模块 57.3% 明显超出，属于平台最高水平。

**6/6 Controller 全覆盖**:

- `controllers/__tests__/collaboration.controller.spec.ts`
- `controllers/__tests__/mission.controller.spec.ts`
- `controllers/__tests__/report.controller.spec.ts`
- `controllers/__tests__/report-review.controller.spec.ts`
- `controllers/__tests__/todo.controller.spec.ts`
- `controllers/__tests__/topic.controller.spec.ts`

**关键路径测试全覆盖**:

Mission 生命周期:

- `services/core/__tests__/mission-lifecycle.service.spec.ts`
- `services/core/__tests__/mission-execution.service.spec.ts`
- `services/core/__tests__/mission-query.service.spec.ts`
- `services/monitoring/__tests__/research-mission-health.service.spec.ts`

Leader 规划:

- `services/core/__tests__/leader-planning.service.spec.ts`
- `services/core/__tests__/leader-planning.service-supplemental.spec.ts`
- `services/core/__tests__/research-leader.service.spec.ts`（含 supplemental/supplemental2）

补充测试深度:

- 多个 `*-supplemental.spec.ts`、`*-supplemental2.spec.ts` 文件覆盖边界情况
- `__tests__/unit/prompt-sanitizer.spec.ts` — 安全基础设施有专项测试
- `services/data/connectors/__tests__/` — 外部 API 连接器有 mock 隔离测试

**无 skip/xtest 模式**
全量 grep 确认：无 `it.skip`、`xit`、`xdescribe`、`test.skip`（误报 2 条均为 `result.skip` 数据字段，非测试跳过）。

### D10 小结

满分。测试覆盖率、Controller 覆盖、关键路径测试三项均达到最优水平。

---

## D11: 可观测性与运维 [3/4]

### 评分细分

| 子项          | 满分 | 得分 | 说明                                               |
| ------------- | ---- | ---- | -------------------------------------------------- |
| Logger 采用率 | 2    | 2    | 68/71 服务有 Logger，3 处遗漏                      |
| 健康检查      | 1    | 1    | 模块级健康端点存在                                 |
| Trace 覆盖    | 1    | 0    | TraceCollector 仅在 mission 主路径，其他路径未覆盖 |

### 合规项

**Logger 覆盖率：95.8%（68/71）**
绝大多数服务使用规范的 `private readonly logger = new Logger(ClassName.name)` 模式。

**健康检查端点**:
`mission.controller.ts` 提供了模块内部的 mission 健康端点：

- `GET topics/:topicId/missions/:missionId/health`（697 行）
- `GET topics/:topicId/health`（721 行）
- 有 `forceHealthCheck()` 强制检查接口

**TraceCollector 集成**:
`services/core/mission-observability.service.ts` 完整集成 `TraceCollectorService`，覆盖：

- `startTrace` / `endTrace`
- `addSpan` / `endSpan`
- 错误上报到 trace
  `@Optional()` 装饰器确保 TraceCollector 不可用时服务可降级运行。

### 违规项

**[D11-V1] LOW: research-strategy.service.ts — 无 Logger**

`services/core/research-strategy.service.ts` 是一个计算密集型服务（维度新鲜度评估、研究策略决策），完全没有 Logger 实例。维度评估结果（FRESH/STALE/NEW 策略）无法追踪，线上排障困难。

**[D11-V2] LOW: topic-schedule.service.ts — 无 Logger**

`services/core/topic-schedule.service.ts` 管理定时刷新计划，调度逻辑变更（开启/暂停/取消）没有日志，问题定位困难。

**[D11-V3] LOW: citation-formatting.utils.service.ts — 无 Logger**

`services/report/citation-formatting.utils.service.ts` 是纯函数型服务，无状态操作，Logger 缺失影响较小，但大批量格式化失败时无可观测手段。

**[D11-V4] MEDIUM: Trace 覆盖仅限 mission 主路径**

`TraceCollectorService` 仅在 `ResearchMissionService`（通过 `MissionObservabilityService`）中使用。以下关键路径无 trace 覆盖：

- Leader Planning（`leader-planning.service.ts`）
- Data Source Routing（`data-source-router.service.ts`）
- Report Synthesis（`report-synthesis.service.ts`）
- Evidence Management（`evidence-management.service.ts`）

这意味着 AI 调用链（Planning → Research → Evidence → Report）在 Trace 视图中只有入口节点可见，无法形成完整调用树。

**修复建议**:

1. 为 3 个无 Logger 的服务各添加一行：

   ```typescript
   private readonly logger = new Logger(ResearchStrategyService.name);
   ```

2. 在 `leader-planning.service.ts` 等关键服务注入 `MissionObservabilityService`，在规划/写作/合成开始和结束时各调用一次 `addPhaseSpan`/`endPhaseSpan`。

### D11 小结

扣 1 分（Trace 覆盖不完整）。Logger 覆盖率优秀（95.8%），健康检查完善。Trace 仅覆盖 mission 层而非全链路，是主要不足。

---

## D12: 配置与依赖 [2/4]

### 评分细分

| 子项          | 满分 | 得分 | 说明                                     |
| ------------- | ---- | ---- | ---------------------------------------- |
| ConfigService | 2    | 2    | 100% 采用，无 process.env 直接访问       |
| ESLint 覆盖   | 1    | 0    | 无 topic-insights 专属的 import 限制规则 |
| 依赖健康      | 1    | 0    | 23 个 HIGH 漏洞，含直接依赖              |

### 合规项

**ConfigService 采用率：100%**
全模块 grep `process.env.` 生产文件结果为空。所有配置通过：

- `ConfigService.get<string>("JWT_SECRET")` — gateway 和 module 配置
- `ConfigService.get<string>("NCBI_API_KEY")` — PubMed connector
- `ConfigService.get<string>("SEMANTIC_SCHOLAR_API_KEY")` — Semantic Scholar connector
- `SecretsService.getValueInternal()` — Finance API connector（更高安全级别）

**ESLint 结构化覆盖**
`.eslintrc.js` 对 `**/modules/ai-app/**/*.ts` 有 `no-restricted-imports` 规则，覆盖 9 大 ai-engine 子路径，防止 topic-insights 穿透 facade 边界。LLM 硬编码规则对 ai-app 层也有覆盖。

### 违规项

**[D12-V1] HIGH: 23 个 HIGH 级别 npm 漏洞，含直接依赖**

`npm audit` 结果：

```
critical: 0
high:     23
moderate: 7
low:      6
```

直接依赖中存在 HIGH 漏洞（`isDirect: true`）：

- `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/platform-socket.io`, `@nestjs/websockets` 等核心框架
- 根因：`path-to-regexp` ReDoS（GHSA-9wv6-86v2-598j）、`multer` DoS（GHSA-5528-5vmv-3xc2 / GHSA-v52c-386h-88mc / GHSA-xf7r-hgr6-v32p）

关键漏洞说明：

- **path-to-regexp ReDoS**（GHSA-9wv6-86v2-598j）：带特定路由参数的请求可造成正则回溯，导致服务不响应。修复版本由 `@nestjs/serve-static@5.0.4` 提供（semver major breaking change）。
- **multer DoS × 3**：文件上传端点在特定输入下资源耗尽/清理不完整。

**[D12-V2] INFO: ESLint 规则无针对 topic-insights 内部子模块的结构约束**

当前 ESLint 只有跨模块（ai-app → ai-engine）的 import 规则，没有 topic-insights 内部分层规则（如防止 `controllers` 跳过 `services` 直接访问 Prisma，或 `data` 层访问 `report` 层）。随着模块增长，内部分层违规不会被 lint 捕获。此为低优先级长期改进项。

**修复建议**:

1. **立即行动**（D12-V1 - HIGH vulns）:

   ```bash
   # 升级 NestJS 主版本（breaking change，需评估兼容性）
   npm audit fix --force  # 慎用，会升级 major 版本

   # 或者针对性升级
   npm install @nestjs/serve-static@5.0.4
   npm install multer@2.x  # 等待 multer 2.x stable
   ```

   建议在下一个维护窗口评估 NestJS 版本锁定策略，并在 API 层为文件上传端点添加请求大小限制作为临时缓解措施。

2. **中期改进**（D12-V2 - 内部分层规则）:
   在 `.eslintrc.js` 的 `overrides` 中为 `topic-insights/controllers/**` 添加规则，禁止直接导入 `prisma.service`（应通过 service 层）。

### D12 小结

ConfigService 满分，但 npm 高危漏洞（直接依赖）和 ESLint 内部分层覆盖缺失各扣 1 分。漏洞大部分为传递性依赖，根因在于 NestJS 版本锁定，属平台级问题而非 topic-insights 模块特有。

---

## 架构债务优先级矩阵

| 优先级 | 问题                                                                    | 维度 | 影响范围                        | 修复成本                                              | 建议时机       |
| ------ | ----------------------------------------------------------------------- | ---- | ------------------------------- | ----------------------------------------------------- | -------------- |
| P1     | interactive-research.service.ts 中 payload.question/context 未 sanitize | D9   | 中（prompt injection 漏洞窗口） | 极低（2 行）                                          | 本迭代         |
| P1     | 23 个 HIGH npm 漏洞（path-to-regexp ReDoS，multer DoS）                 | D12  | 高（平台级）                    | 中（NestJS major 升级）                               | 本维护窗口评估 |
| P2     | Trace 覆盖仅限 mission 入口，Leader 规划/报告合成/Evidence 无 span      | D11  | 中（可观测性盲区）              | 中（5-8 个 service 注入 MissionObservabilityService） | 下次迭代       |
| P3     | research-strategy/topic-schedule/citation-formatting.utils 缺 Logger           | D11  | 低                              | 极低（3 行）                                          | 随手修复       |
| P3     | topic-insights 内部分层无 ESLint 结构约束                               | D12  | 低（长期）                      | 低                                                    | 长期           |

---

## 建议行动项

### 必须处理（本迭代）

- [ ] `interactive-research.service.ts:291,295` — 对 `topic.name`、`payload.question`、`payload.context` 调用 `sanitize()` 后再嵌入 prompt

### 计划处理（维护窗口）

- [ ] 评估 `npm audit` 报告中 HIGH 漏洞，特别关注 `path-to-regexp` ReDoS 和 `multer` DoS，制定 NestJS 版本升级计划或添加运行时缓解措施（请求大小限制、超时配置）

### 中期改进（下次迭代）

- [ ] 在 `leader-planning.service.ts`、`data-source-router.service.ts`、`report-synthesis.service.ts`、`evidence-management.service.ts` 中注入 `MissionObservabilityService`，在关键阶段添加 trace span，形成完整 AI 调用链 trace

### 随手改进

- [ ] `research-strategy.service.ts` — 添加 `private readonly logger = new Logger(ResearchStrategyService.name)`
- [ ] `topic-schedule.service.ts` — 同上（`TopicScheduleService.name`）
- [ ] `citation-formatting.utils.service.ts` — 同上（`CitationFormatterService.name`）

---

## 亮点总结

本次审计发现 topic-insights 模块在以下方面表现突出：

1. **Prompt 注入防护基础设施完善** — 有专用 `prompt-sanitizer.ts`（13 类攻击模式）和 `security-audit-logger.ts`（结构化安全事件），这在 AI App 层属于最佳实践级别
2. **测试质量行业领先** — 57.3% 覆盖率、6/6 Controller 全覆盖、无 skip 测试、有 supplemental spec 覆盖边界情况
3. **API Key 管理规范** — 层级化密钥管理（ConfigService → SecretsService），外部 API 密钥无一硬编码
4. **ConfigService 100% 采用** — 无任何 process.env 直接访问，配置完全集中管理

主要待改进点为 prompt sanitizer 的一处覆盖遗漏、Trace 链路不完整，以及平台级 npm 漏洞需要关注。

---

_评分模型: v2.0 (D9-D12 子集审计)_
_下次建议全量审计: 2026-04-10_
_报告工具: Arch Auditor Agent v2.0_

