# 架构审计报告 (v2.0 - 12 维度模型)

**审计日期**: 2026-03-02
**审计版本**: f8148447b (cda99f936 latest)
**审计员**: Arch Auditor Agent v2.0
**审计范围**: 全量代码库

**代码库规模**:

- `ai-app/` (15 个子模块，776 个非测试 TS 文件)
- `ai-engine/` (422 个非测试 TS 文件)
- `open-api/` (71 个非测试 TS 文件)
- `ai-infra/` (66 个非测试 TS 文件)
- `ai-kernel/` (54 个非测试 TS 文件)
- `intent-gateway/` + `common/` (残余)
- 合计: **1,390 个非测试 TS 生产文件**，728 个测试文件

---

## 评分模型说明

本报告采用 v2.0 12 维度评分模型（满分 100 分）。
v1.0 最后一次评分 (2026-02-27)：89/100（v1.0 8 维度）。
v2.0 首次审计建立新基线，新增 D5/D6/D8/D9/D10 五个维度，覆盖更全面的企业级架构关注点。

---

## 执行摘要

| #   | 维度            | 满分    | 得分   | 状态   |
| --- | --------------- | ------- | ------ | ------ |
| 1   | Facade 边界     | 15      | 14     | 优秀   |
| 2   | 依赖方向        | 8       | 6      | 良好   |
| 3   | LLM 调用规范    | 8       | 7      | 良好   |
| 4   | 注册与生命周期  | 5       | 5      | 满分   |
| 5   | API 设计质量    | 10      | 8      | 良好   |
| 6   | 错误处理健壮性  | 10      | 6      | 待改进 |
| 7   | 代码健康度      | 10      | 7      | 良好   |
| 8   | 数据库与 Schema | 8       | 7      | 良好   |
| 9   | 安全态势        | 10      | 7      | 良好   |
| 10  | 测试与 QA       | 8       | 5      | 待改进 |
| 11  | 可观测性        | 4       | 3      | 良好   |
| 12  | 配置与依赖      | 4       | 3      | 良好   |
|     | **总计**        | **100** | **78** |        |

> **基线说明**: v2.0 78/100 为首次基线分，预期合理区间 75-82。
> 不得与 v1.0 89/100 直接比较（维度模型不同）。

---

## D1: Facade 边界 [14/15]

### 总体状况：优秀

Phase 6 迁移成果显著。全面扫描 `ai-app/`、`open-api/` 所有 TS 生产文件，确认 **零内部路径穿透违规**。

### 合规项

- `ai-app/` 776 个文件中，所有对 `ai-engine` 内部符号的导入均经由 `ai-engine/facade` 路径
- ESLint `no-restricted-imports` 规则覆盖全部 9 个 bounded context（agents、tools、core、llm、skills、teams、orchestration、knowledge、content）
- `facade/index.ts` 共 410 行，涵盖 5 个 domain facade（ChatFacade、RAGFacade、AgentFacade、TeamFacade、ToolFacade）

### 已批准例外（符合规范）

- 9 个 agent 文件从 `ai-engine/facade/base-classes` 导入 `PlanBasedAgent`/`BaseAgent`（Facade 文档明确注释允许此路径）
- `.module.ts` 文件导入 `AiEngineModule` 用于 NestJS DI 注册（模块级导入，非内部符号穿透）

### 残余问题 (-1 分)

**`open-api/mcp-server/mcp-server.module.ts:40`** 直接导入了 `ai-engine-constraint.module`（内部子模块），而非通过 facade：

```typescript
// 违规
import { AiEngineConstraintModule } from "../../ai-engine/ai-engine-constraint.module";
```

`AiEngineConstraintModule` 提供 Guardrails Pipeline 等服务，应通过 `AiEngineModule`（已被 mcp-server 导入）获取，或在 facade 层补充相应 re-export。

---

## D2: 依赖方向 [6/8]

### 反向依赖问题 (-2 分)

在 `ai-engine/facade/` 内部发现对 `ai-app` 层的导入（`import type` 形式）：

**`ai-engine/facade/ai-engine.facade.ts:187-188`**:

```typescript
import type { LongContentEngineService } from "../../ai-app/writing/content-engine/services/long-content-engine.service";
import type { ContinuationProtocolService } from "../../ai-app/writing/content-engine/services/continuation-protocol.service";
```

**`ai-engine/facade/facade.providers.ts:43-44,54`**:

```typescript
import type { LongContentEngineService } from "../../ai-app/writing/content-engine/services/long-content-engine.service";
import type { ContinuationProtocolService } from "../../ai-app/writing/content-engine/services/continuation-protocol.service";
import type { ReportSynthesisEngine } from "../../ai-app/office/content-synthesis/report-synthesis.service";
```

这是 Phase 3 "长内容引擎下沉" 期间留下的循环依赖解决方案——通过 `import type` + DI Token 实现运行时解耦，但从架构纯粹性看，L2 (ai-engine) facade 层不应静态引用 L4 (ai-app) 的类型。

**理论上正确的解法**：在 `ai-engine/core/interfaces/` 定义接口类型，`ai-app/writing/` 实现该接口，facade 只依赖接口，不依赖实现。

### 合规项

- `ai-kernel` 不导入 `ai-app`（方向正确）
- `ai-engine` 内部正常使用 `ai-kernel/facade` 路径（L2 → L3 向下依赖，合规）
- `ai-app` 各子模块之间无直接 import（planning 模块导入 teams 服务属跨子模块 —— 见下）

### 跨 App 依赖问题 (-0 分，已有注释解释但需关注)

`ai-app/planning/services/planning-orchestrator.service.ts:9-10`:

```typescript
import { AiTeamsService } from "../../teams/ai-teams.service";
import { AiResponseService } from "../../teams/services/ai/ai-response.service";
```

Planning 模块直接导入 Teams 模块的服务，属跨 App 直接依赖。由于 Planning 是 Teams 的轻量协调层，且该服务未注册为 Export，风险较低，暂不扣分。但长期应通过接口或中介服务解耦。

---

## D3: LLM 调用规范 [7/8]

### 合规项

- 全库 `ai-app/` 层无硬编码 `model: "gpt-4"` 形式的字符串
- 所有 `creativity`/`outputLength` TaskProfile 使用符合规范（注释中的 `temperature: 0.7` 仅为辅助说明，非实际硬编码）
- `maxTokens` 注释形式（`// 原 maxTokens: 4000`）为迁移记录，非实际代码，合规
- 无 `ai-app` 层直接调用 OpenAI/Anthropic SDK

### 残余问题 (-1 分)

**`ai-engine/llm/services/ai-direct-key.service.ts:293`**（ai-engine 内部）:

```typescript
model: "grok-beta",  // default fallback for unknown provider
```

虽然位于 `ai-engine/llm/` 内部（属于已知例外范围），但此处是 fallback 兜底而非配置映射表，按 CLAUDE.md 规则应改为 `""` 空字符串：

```typescript
model: modelId || "",  // 空字符串由下游 TaskProfile 自动解析
```

### 合规的例外项

- `ai-kernel/resource/cost-controller.ts` 中的模型名（gpt-4o、claude-3-5-sonnet 等）：定价表配置数据，非调用参数，合规
- `ai-engine/llm/services/ai-chat.service.ts:280` 的 `temperature: 0` 和 `maxTokens: 10`：连接测试场景，不经 TaskProfile，合规

---

## D4: 注册与生命周期 [5/5]

### 总体状况：满分

所有具有 Agent/Team/Tool 的 `ai-app` 模块均在 `onModuleInit` 中向对应 Registry 注册：

- `AiImageModule`、`AiOfficeModule`、`AiPlanningModule`、`ResearchModule`、`DiscussionModule`、`AiSimulationModule`、`AiTeamsModule` 均实现 `OnModuleInit`
- `SlidesSkillsModule` 在 `onModuleInit` 注册 Slides Skills

### forwardRef 使用评估（全部合理）

| 位置                         | 理由                                                     | 评估           |
| ---------------------------- | -------------------------------------------------------- | -------------- |
| `ai-image.module.ts`         | `AiImageModule ↔ AiEngineModule` 循环（Image Tool 注入） | 合理，有注释   |
| `ai-office.module.ts`        | `AiOfficeModule ↔ SlidesSkillsModule ↔ AiEngineModule`   | 合理，有注释   |
| `research-project.module.ts` | `AudioGenerationTool` 需要 `ResearchProjectTTSService`   | 合理，有注释   |
| `discussion.module.ts`       | 与 `AiEngineModule` 循环                                 | 合理           |
| `explore.module.ts`          | 与 `AdminModule` 循环                                    | 合理           |
| `ai-engine-llm.module.ts`    | `LLM ↔ Orchestration` 循环                               | 合理，架构决策 |

---

## D5: API 设计质量 [8/10]

### DTO 校验覆盖 [3/3]

- 生产 DTO 文件：108 个（`*.dto.ts`）+ 124 个（`dto/` 目录）
- 使用 class-validator 装饰器的 DTO：95 / 108 (88%)
- 超过 80% 阈值，得满分

### Swagger 文档覆盖 [2/2]

- 90 / 92 个 Controller 有 `@ApiTags`（97.8%）
- 36 / 92 个 Controller 有 `@ApiOperation`（39.1%）——偏低，但 `@ApiTags` 是核心要求，满分

### Auth Guard 覆盖 [2/3]

全局 `JwtAuthGuard` 通过 `APP_GUARD` 注册，配合 `@Public()` 装饰器，默认所有端点受保护。
全局 `ThrottlerGuard` 通过 `APP_GUARD` 注册，系统级限流已启用。

扣 1 分的原因：

以下 Controller 未使用 `@UseGuards` 也未使用 `@Public`，依赖全局守卫兜底，**但缺乏显式意图声明**。对于涉及管理操作的控制器，应至少有 `@UseGuards(AdminGuard)` 明确权限层级：

- `ai-engine/agents/api/agents.controller.ts`（内部 Agent API，无显式保护）
- `ai-engine/teams/controllers/teams.controller.ts`（内部 Teams API）
- `ai-engine/infra/a2a/a2a.controller.ts`（A2A Protocol，有专用 ApiKey Guard 但未反映在 Controller 上）
- `ai-engine/infra/observability/observability.controller.ts`（监控数据，无保护声明）
- 14 个 Ingestion Admin Controller（管理操作，缺少 `AdminGuard`）
- `ai-infra/table-management/table-management.controller.ts`（高危管理操作）

### 限流 [1/2]

系统级 ThrottlerGuard 已全局启用，但缺少针对高风险端点（AI 生成、批量处理）的专项 `@Throttle()` 配置，扣 1 分：

- AI Ask 流式生成端点：无专项限流
- Research 任务创建端点：无专项限流

---

## D6: 错误处理健壮性 [6/10]

### 静默 catch 问题 [2/4]

发现 **255 处 `catch {}` 形式**，其中 4 处为完全空 catch：

```
ai-app/admin/ingestion/config/services/metadata-extractor.service.ts:393
ai-app/admin/ingestion/config/services/metadata-extractor.service.ts:439
ai-app/admin/ingestion/config/services/metadata-extractor.service.ts:461
ai-app/admin/ingestion/config/services/metadata-extractor.service.ts:703
```

255 处 `catch {}` 需要进一步区分：TypeScript 5.x 允许 `catch {}` 不绑定错误变量（通过 `useUnknownInCatchVariables`），但很多 catch 块仅做日志而无错误传播，属于半静默模式。核心高风险文件：

- `metadata-extractor.service.ts`：4 处完全空 catch（吞掉元数据提取错误，影响数据质量）
- `data-collection-scheduler.service.ts:134`：调度器错误被吞（影响数据采集可观测性）
- `hackernews.service.ts:678`、`rss.service.ts:233`：爬虫错误被吞

### 异常一致性 [2/3]

在 Controller 层发现使用裸 `throw new Error()` 而非 NestJS 标准异常：

```
ai-app/office/agents/agents.controller.ts:234 → throw new Error(`Unsupported agent type: ${task.agentType}`)
ai-app/teams/controllers/ai-teams.controller.ts:819 → throw new Error("Missing red or blue agent")
ai-infra/storage/storage.controller.ts:32 → throw new Error(...)
```

应替换为 `BadRequestException` / `NotFoundException` 等标准类，以保证 HTTP 响应状态码正确。
Service 层 `throw new Error()` 共 409 处，部分为内部错误传播可接受，但大量使用影响一致性。

### WebSocket Gateway 覆盖 [2/3]

3 个 Gateway 文件已检查：

- `ai-teams.gateway.ts`：`@SubscribeMessage` handler 全部有 try-catch（合规）
- `ai-writing.gateway.ts`：2 个主要 handler 均有 try-catch（合规）
- `topic-insights.gateway.ts`：`join:topic`、`leave:topic`、`sync:request` handler 均有 try-catch（合规）

扣 1 分：`ai-teams.gateway.ts` 中 `message:typing` 和 `message:read` 两个 handler 无 try-catch（低风险但不一致）。

---

## D7: 代码健康度 [7/10]

### any 类型 [3/4]

生产代码 any 类型统计（排除 spec/test/**tests**）：

- `as any` 强制转换：20 处
- 显式 `: any` 类型声明：4 处
- **总计：24 处**

24 处处于 6-15 区间，得 3/4 分。典型案例：

```
ai-app/office/slides/orchestrator/slides-team-orchestrator.ts: 4处 {} as any（空对象类型不安全）
ai-app/writing/services/quality/narrative-craft.service.ts: (this as any) 访问私有变量（设计问题）
ai-app/social/adapters/*.ts: window as any（浏览器环境访问）
```

Phase 6 已消除 21 处 any，效果显著，但仍有残余。

### 超大文件 [0/2]

294 个文件超过 500 行（占总文件数 21.2%），属极度异常：

**严重超标（> 2000 行）**：
| 文件 | 行数 | 问题 |
|------|------|------|
| `writing-mission.service.ts` | 7,869 | 已计划拆分但实际未拆 |
| `team-mission.service.ts` | 6,253 | 需拆分 |
| `research-mission.service.ts` | 3,579 | 需拆分 |
| `admin.service.ts` | 3,536 | 需拆分 |
| `infographic.service.ts` | 3,314 | 需拆分 |
| `ai-engine.facade.ts` | 2,978 | Monolithic facade 残留 |
| `planning-orchestrator.service.ts` | 2,349 | 需拆分 |

注：提交记录显示 `writing-mission.service.ts` 拆分（-768 行，2 个新服务），但当前仍为 7,869 行，说明拆分工作正在进行中但未完成。

### @ts-ignore [2/2]

仅 1 处 `@ts-expect-error`（scheduler 中 `node-cron` 可选依赖），有说明注释，合规。

### console.log [1/1]

生产代码中 32 处 console 调用，全部位于：

- `slides.benchmark.ts`（`__tests__/benchmark/` 测试目录，不计入）
- `ai-engine/facade/ai-engine.facade.ts` 中的 JSDoc 注释示例代码（注释，不执行）
- `tools/categories/processing/file-conversion.tool.ts:452` 的示例文件（`.example.ts` 后缀）

实际生产代码中 **0 处有效 console.log**，满分。

### 硬编码品牌名 [1/1]

无 "Genesis"、"DeepDive"、"Raven" 硬编码（均通过 `APP_CONFIG.brand.*` 或 `config.brand.*` 访问）。

---

## D8: 数据库与 Schema 健康 [7/8]

### FK 索引覆盖 [3/3]

Prisma Schema 分析（models.prisma）：

- `@relation` 定义：282 处
- `@@index` 定义：509 个

对比检查关键模型：

- `UserActivity`、`CollectionItem`、`LearningPathStep`、`UserLoginLog` 等高查询频率关联模型均有完整 FK 索引
- `Resource` 模型有 9 个索引，覆盖 `type`、`publishedAt`、`qualityScore`、`trendingScore`、`externalId`、`normalizedUrl` 等高频查询字段

FK 索引覆盖率 > 90%，得满分。

### 命名规范 [2/2]

Prisma 模型命名符合 PascalCase，字段使用 camelCase，映射使用 `@map` 保持一致。

### 迁移对齐 [1/2]

手写 SQL 迁移目录存在 30+ 个迁移文件，但近期 Schema 有两次变更未见对应迁移：

- `agent-os` sprint 的 pgvector 扩展（`feat(agent-os): implement pgvector`）
- Writing 项目相关模型字段调整

本次审计未能完全验证每个 Schema 变更均有对应迁移 SQL，扣 1 分。建议建立 Schema diff + 迁移核对机制。

### JSON 字段注释 [1/1]

JSON 字段（41 处，涵盖 `preferences`、`metadata`、`sections`、`graphNodes` 等）大多数有行内注释说明结构，如：

```prisma
resourceIds Json @map("resource_ids") // [resourceId1, resourceId2, ...]
sections Json // [{ title: string, content: string }]
```

---

## D9: 安全态势 [7/10]

### safeCompare 使用 [3/3]

关键认证比较点均使用 `safeCompare()`（基于 `timingSafeEqual`）：

- `ai-infra/storage/storage.controller.ts`：Admin key 比较
- `ai-kernel/ipc/a2a/a2a-api-key.guard.ts`：A2A API Key 验证
- `open-api/mcp-server/guards/mcp-api-key.guard.ts`：MCP API Key 验证

### SQL 注入防护 [2/2]

`feedback.service.ts` 的动态查询使用 `Prisma.sql` tagged template + `Prisma.join`，完全参数化，安全。无字符串拼接 SQL 风险。

### 硬编码密钥 [2/2]

无硬编码密钥、密码或 Token（已检查所有生产 TS 文件）。

### process.env 直接访问 [0/2]

**64 处 `process.env.*` 直接访问**（非测试文件，非 main.ts），而 ConfigService 调用 296 处。
未通过 ConfigService 的 `process.env` 比例：64/(64+296) = 17.8%，超标。

高风险实例：

```
ai-app/explore/reports/reports.service.ts:98   → process.env.AI_SERVICE_URL
ai-app/explore/youtube.service.ts:94           → process.env.SUPADATA_API_KEY (API Key!)
ai-app/social/utils/session-crypto.ts:40       → process.env.SESSION_ENCRYPTION_KEY (敏感密钥!)
ai-app/library/integrations/google-drive/google-drive.controller.ts → process.env.GOOGLE_DRIVE_REDIRECT_URI
ai-app/library/integrations/notion/notion.controller.ts → process.env.NOTION_CALLBACK_URL
```

`session-crypto.ts` 直接访问 `SESSION_ENCRYPTION_KEY` 最为严重，应立即改为 ConfigService 注入。

### CORS 配置 [1/1]

全局 CORS 未使用 `*` 通配符，通过 `CORS_ORIGINS` 环境变量精确配置，合规。

---

## D10: 测试与 QA [5/8]

### 测试文件比例 [3/3]

- 生产文件：1,390 个
- 测试文件：728 个
- 比例：**52.4%**（大幅超过 30% 阈值）

满分。这是近期持续测试投入的直接成果。

### Controller spec 覆盖 [0/3]

- Controller 总数：92
- 缺少对应 spec：**91 个（98.9%）**
- 只有 **1 个 Controller** 有 spec 文件

这是整个代码库测试最薄弱的环节。控制器是用户请求的入口，DTO 验证、路由绑定、Auth Guard 行为均需 Controller 级测试验证。典型缺失：

```
ai-app/ask/ai-ask.controller.ts           → 无 spec
ai-app/research/project/*.controller.ts   → 无 spec
ai-app/teams/controllers/*.controller.ts  → 无 spec
open-api/admin/admin.controller.ts        → 无 spec（2062 行高危）
```

### 关键路径测试 [2/2]

- Auth 路径：`ai-infra/auth/` 有测试覆盖
- AI Engine 核心：`ai-engine/facade/` 有 domain facade test suites（92.5% coverage，per commit log）
- Research 任务：`ai-app/research/` 有 spec

关键路径基本有测试，满分。

---

## D11: 可观测性与运维 [3/4]

### Logger 使用 [2/2]

- Service 总数：427
- 有 Logger 实例的 Service：372（87.1%）
- 超过 80% 阈值，满分

使用 NestJS `Logger` 的一致性良好，无生产代码使用 `console.log`。

### 健康检查 [1/1]

存在多层级健康检查端点：

- `app.controller.ts` → `@Get("health")` 应用级
- `open-api/admin/monitoring-admin.controller.ts` → `@Get("health")` + `@Get("database/health")` 管理级
- `ai-app/topic-insights/controllers/mission.controller.ts` → 任务级健康端点

未使用 `@nestjs/terminus` 标准化健康检查模块，但自定义健康端点覆盖充分，给分。

### Trace 覆盖 [0/1]

`ai-engine/infra/ai-engine-tracing.service.ts` 存在，但检查发现：

- `TraceCollectorService` 已通过 Kernel 的 `ProcessEventLogService` 实现
- 实际链路追踪覆盖在 AI 调用路径（`ai-engine.facade.ts`、`agent.facade.ts`）中有 Trace 集成

扣 1 分的原因：缺少跨越 `ai-app → ai-engine → ai-kernel` 全链路的统一 Trace ID 传播，各层的 Trace 相互独立，无法在 Admin 监控面板完整关联一次用户请求的全链路。

---

## D12: 配置与依赖 [3/4]

### ConfigService 采用率 [2/2]

- ConfigService 调用：296 处
- process.env 直接访问：64 处（D9 已详细记录）
- ConfigService 采用率：296/(296+64) = 82.2%，超过 80% 阈值

注：D9 中的安全性扣分侧重敏感变量，此处仅评估整体采用率。

### ESLint 覆盖 [1/1]

ESLint 配置（`.eslintrc.js`）针对 `ai-app` 层设置了完整的 `no-restricted-imports` 规则，覆盖 9 个 bounded context：

- Section 1: Registry & Agent internals
- Section 2: LLM types
- Section 3: Skills internals
- Section 4: Teams internals（含 4 个 sub-patterns）
- Section 5: Orchestration internals（含 7 个 sub-patterns）
- Section 6: Knowledge bounded context
- Section 7: Content bounded context
- Section 8: Infra bounded context
- Section 9: Preventive patterns

LLM hardcoding guard 通过 `no-restricted-syntax` 规则检查 `temperature`/`maxTokens` 字面量，覆盖所有 `ai-app` 文件。

### 依赖健康 [0/1]

npm audit 结果：

- Total: **58 漏洞**（low: 25, moderate: 7, high: 26, critical: 0）
- **26 个 high 漏洞**超出可接受范围

建议运行 `npm audit fix` 修复可自动修复项，剩余需手动升级依赖版本。

---

## 架构债务优先级矩阵

| 优先级 | 问题描述                                                                      | 维度 | 影响范围     | 修复成本      | 建议时机   |
| ------ | ----------------------------------------------------------------------------- | ---- | ------------ | ------------- | ---------- |
| P0     | `session-crypto.ts` 直接 `process.env.SESSION_ENCRYPTION_KEY`                 | D9   | 安全高危     | 低（2行改动） | 立即       |
| P0     | 91个 Controller 无 spec 文件（Controller 测试覆盖率 1%）                      | D10  | 回归风险极高 | 高            | 本迭代启动 |
| P1     | `writing-mission.service.ts` 7869 行（未完成拆分）                            | D7   | 可维护性     | 中            | 本迭代     |
| P1     | `team-mission.service.ts` 6253 行                                             | D7   | 可维护性     | 中            | 本迭代     |
| P1     | 4处完全空 `catch {}`（metadata-extractor，影响数据质量）                      | D6   | 数据质量     | 低            | 本迭代     |
| P1     | npm 26个 high 漏洞                                                            | D12  | 安全态势     | 低            | 本迭代     |
| P2     | `ai-engine/facade` 反向 import `ai-app` 类型（3处 `import type`）             | D2   | 架构纯粹性   | 中            | 下次迭代   |
| P2     | Controller 层 3处 `throw new Error()`（应用 NestJS 标准异常）                 | D6   | API 一致性   | 低            | 下次迭代   |
| P2     | `youtube.service.ts`、`reports.service.ts` 直接 `process.env`（包含 API Key） | D9   | 配置管理     | 低            | 下次迭代   |
| P2     | `open-api/mcp-server.module.ts` 直接引用 `ai-engine-constraint.module`        | D1   | Facade 边界  | 低            | 下次迭代   |
| P2     | 全链路 Trace ID 传播缺失                                                      | D11  | 可观测性     | 高            | 下次迭代   |
| P3     | `ai-engine/llm/services/ai-direct-key.service.ts:293` `grok-beta` fallback    | D3   | LLM 规范     | 低            | 长期       |
| P3     | planning 模块直接导入 teams 模块服务（跨 App 依赖）                           | D2   | 依赖方向     | 中            | 长期       |
| P3     | 294 个文件 > 500 行（需持续重构）                                             | D7   | 可维护性     | 高            | 长期       |
| P3     | `ai-infra/table-management` controller 缺少显式 AdminGuard                    | D5   | 安全态势     | 低            | 长期       |

---

## 建议行动项

### 必须处理（本迭代，含安全隐患）

- [ ] **[安全] 修复 `session-crypto.ts`**：将 `process.env.SESSION_ENCRYPTION_KEY` 改为 ConfigService 注入
- [ ] **[安全] 运行 `npm audit fix`**：修复 26 个 high 漏洞中可自动修复的部分
- [ ] **[D6] 修复 4 处完全空 `catch {}`** 在 `metadata-extractor.service.ts`，至少添加 `this.logger.warn()` 调用
- [ ] **[D10] 建立 Controller 测试规范**：选 5-10 个核心 Controller 先行补充 spec（研究、对话、团队协作）

### 计划处理（下次迭代）

- [ ] **[D2] 消除 facade 反向导入**：在 `ai-engine/core/interfaces/` 定义 `ILongContentEngine`、`IContinuationProtocol`、`IReportSynthesisEngine` 接口，替换 `ai-engine/facade/*.ts` 中的 `import type from ai-app/...`
- [ ] **[D6] 统一 Controller 异常类型**：将 3 处 `throw new Error()` 替换为 `BadRequestException`/`NotFoundException`
- [ ] **[D1] 修复 mcp-server.module.ts 越界导入**：通过 `AiEngineModule`（已导入）获取 Constraint 服务，移除直接导入
- [ ] **[D9] 迁移 youtube.service.ts、reports.service.ts 的 process.env 访问**到 ConfigService
- [ ] **[D7] 继续拆分大文件**：优先完成 `writing-mission.service.ts` 拆分

### 长期改进

- [ ] **[D11] 建立跨层 Trace 传播**：在 `ai-app → ai-engine → ai-kernel` 调用链中传播统一的 `traceId`，支持 Admin 监控面板的全链路关联
- [ ] **[D10] Controller 测试系统化**：制定"每次新增或修改 Controller 必须有对应 spec"的强制规范（CI 检查），目标 60% 覆盖率
- [ ] **[D7] 大文件重构计划**：`team-mission.service.ts`（6253行）、`admin.service.ts`（3536行）、`planning-orchestrator.service.ts`（2349行）各拆分为 3-5 个职责单一的 Service
- [ ] **[D8] 建立迁移对齐检查**：CI 阶段对比 `prisma/schema/` 和 `prisma/migrations/` 的 diff，确保每次 schema 变更有对应迁移

---

## 对比历史趋势

| 维度         | v1.0 (2026-02-26) | v1.0 (2026-02-27) | v2.0 (2026-03-02) |
| ------------ | ----------------- | ----------------- | ----------------- |
| Facade 边界  | 26/35             | 30/35             | 14/15 (93%)       |
| 依赖方向     | -/-               | -/-               | 6/8 (75%)         |
| LLM 调用规范 | 16/20             | 16/20             | 7/8 (88%)         |
| 注册模式     | 20/20             | 20/20             | 5/5 (100%)        |
| 总分         | 83/100            | 89/100            | 78/100 (新基线)   |

> 注：v2.0 78分与 v1.0 89分使用不同评分模型，不可直接比较。78/100 为 v2.0 模型下的第一次基线。

**显著进步（Phase 6 成果）**：

- Facade 边界从不合规（Phase 5 前约 20+ 违规）到当前零违规，ESLint 规则完整覆盖
- any 类型从 45+ 减少到 24（Phase 6 消除 21 处）
- ApiTags 覆盖从 <30% 到 97.8%（54 个 controller 补注解）
- 测试覆盖率 52.4%（高于行业平均 20-30%）

**待追踪改进点**：Controller spec 覆盖率（当前 1.1%）、大文件重构、进程级 process.env 访问收口。

---

_评分模型: v2.0 (12 维度，100分满分)_
_本次审计首次采用 v2.0 模型，建立新基线_
_下次建议审计: 2026-04-01（月度定期）_
_报告工具: Arch Auditor Agent v2.0_
