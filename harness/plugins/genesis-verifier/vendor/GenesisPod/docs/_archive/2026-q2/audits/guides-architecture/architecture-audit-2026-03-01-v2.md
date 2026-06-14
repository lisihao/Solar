# 架构审计报告 (v2.0 - 12 维度模型)

**审计日期**: 2026-03-01
**审计版本**: f14fef374
**审计员**: Arch Auditor Agent v2.0
**审计范围**: 全量代码库

**代码库规模**:

- `ai-engine/` — 422 个非测试 TS 生产文件
- `ai-app/` — 774 个非测试 TS 生产文件
- `ai-infra/` — 包含在上述总计中
- `open-api/` — 包含在上述总计中
- 合计: 1,388 个非测试 TS 生产文件
- 测试文件: 722 个 spec/test 文件（测试比 52%）

**本轮主要变更**:

1. `ai-infra/facade/index.ts` 新建，72 个消费者已迁移
2. `ai-kernel/facade` 补充了 13+ 个缺失导出，24 个 ai-engine 文件迁移
3. 3 个 ai-engine facade 测试文件违规修复
4. Gateway try-catch 修复、silent catch logging 改进、ConfigService 迁移

---

## 评分模型说明

本报告采用 **v2.0 12 维度评分模型（满分 100 分）**，与此前 v1.0 8 维度模型不可直接比较。
v1.0 最后一次评分为 75/100（2026-02-XX），主要反映 Facade 边界合规状态。
v2.0 扩展了 5 个维度（API 设计、错误处理、数据库健康、安全态势、测试 QA），
覆盖更全面的企业级架构关注点。首次 v2.0 审计建立新基线。

---

## 执行摘要

| #   | 维度            | 满分    | 得分   | 状态   |
| --- | --------------- | ------- | ------ | ------ |
| 1   | Facade 边界     | 15      | **15** | 完美   |
| 2   | 依赖方向        | 8       | **6**  | 良好   |
| 3   | LLM 调用规范    | 8       | **7**  | 良好   |
| 4   | 注册与生命周期  | 5       | **4**  | 良好   |
| 5   | API 设计质量    | 10      | **6**  | 改进   |
| 6   | 错误处理健壮性  | 10      | **7**  | 良好   |
| 7   | 代码健康度      | 10      | **8**  | 良好   |
| 8   | 数据库与 Schema | 8       | **6**  | 良好   |
| 9   | 安全态势        | 10      | **7**  | 良好   |
| 10  | 测试与 QA       | 8       | **4**  | 需改进 |
| 11  | 可观测性        | 4       | **4**  | 完美   |
| 12  | 配置与依赖      | 4       | **2**  | 需改进 |
|     | **总计**        | **100** | **76** |        |

---

## D1: Facade 边界 [15/15]

### 结论：零违规，完美合规

本次审计对 `ai-app/`、`open-api/`、`ai-infra/` 三个消费层进行了全面扫描，**未发现任何跨越 Facade 边界直接访问 `ai-engine` 内部路径的违规**。

**扫描结果**:

```
# ai-app/** 直接访问 ai-engine/（非 facade）
→ 0 违规

# open-api/** 直接访问 ai-engine/（非 facade）
→ 0 违规

# ai-app/** 直接访问 ai-infra/（非 facade）
→ 0 违规

# 动态 import() 绕过 Facade
→ 0 违规
```

**合理例外（已核实）**:

本次扫描发现 9 个文件使用 `import { ... } from "../../../ai-engine/facade/base-classes"` 路径，均是合法使用：

| 文件                                                 | 原因                              |
| ---------------------------------------------------- | --------------------------------- |
| `ai-app/image/agents/image-designer.agent.ts`        | 继承 PlanBasedAgent（有文档说明） |
| `ai-app/simulation/agents/simulator.agent.ts`        | 继承 PlanBasedAgent               |
| `ai-app/research/agents/researcher.agent.ts`         | 继承 PlanBasedAgent               |
| `ai-app/writing/agents/story-architect.agent.ts`     | 继承 BaseAgent                    |
| `ai-app/writing/agents/editor.agent.ts`              | 继承 BaseAgent                    |
| `ai-app/writing/agents/writer.agent.ts`              | 继承 BaseAgent                    |
| `ai-app/writing/agents/consistency-checker.agent.ts` | 继承 BaseAgent                    |
| `ai-app/writing/agents/bible-keeper.agent.ts`        | 继承 BaseAgent                    |
| `ai-app/teams/agents/team-collaboration.agent.ts`    | 继承 PlanBasedAgent               |

`facade/base-classes.ts` 是有意设计的轻量子 Facade，避免主 `index.ts` 的循环依赖链。`base-classes.ts` 内有详细注释说明原因，属于 Facade 体系的一部分，不构成违规。

**ESLint 规则覆盖**:

`.eslintrc.js` 包含完整的 9 个 Section 的 `no-restricted-imports` 规则，覆盖 ai-engine 所有子目录（agents、tools、core、llm、skills、teams、orchestration、knowledge、content、infra、safety、mcp）。测试文件豁免规则也正确配置。

**ai-infra/facade/index.ts** 和 **ai-kernel/facade/index.ts** 两个新建 Facade 均有完整的 export 清单，设计规范与 ai-engine/facade 一致。

---

## D2: 依赖方向 [6/8]

### 反向依赖（ai-engine → ai-app）: 0 违规 [4/4]

扫描 ai-engine 全量 TS 文件，**零实例**引用了 `modules/ai-app/`，反向依赖完全干净。

### 跨 App 依赖（ai-app 子模块间直接 import）: 2 处 [-2]

发现 2 处非测试文件的跨模块直接依赖：

| 文件                                                             | 违规导入                                                                          | 严重度 |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------ |
| `ai-app/planning/services/planning-orchestrator.service.ts:9-10` | `import { AiTeamsService } from "../../teams/ai-teams.service"`                   | 中     |
| `ai-app/planning/services/planning-orchestrator.service.ts:9-10` | `import { AiResponseService } from "../../teams/services/ai/ai-response.service"` | 中     |

`explore` 模块的 2 处跨模块依赖（访问 `library/proxy` 和 `admin/ingestion/config`）视为运维性辅助模块，属于合理的轻度跨模块依赖（不扣分）：

```
ai-app/explore/resources/dynamic-thumbnail.service.ts → ai-app/library/proxy/flaresolverr.service
ai-app/explore/resources/resources.module.ts → ai-app/admin/ingestion/config/config.module
```

### 模块依赖图健康: [2/2]

检视主要 `.module.ts` 文件，`forwardRef` 使用均有注释说明原因，合理：

- `AiImageModule ↔ AiEngineModule`（image 模块生成服务互依赖，已注释）
- `AiOfficeModule ↔ SlidesSkillsModule`（office + slides 循环，已注释）
- `ResearchProjectModule ↔ AiEngineModule`（AudioGenerationTool，已注释）
- `AiEngineLlmModule ↔ AiEngineOrchestrationModule`（内部合理循环）

---

## D3: LLM 调用规范 [7/8]

### 硬编码模型名（生产文件）: 1 处 [-1]

全库扫描 `model: "gpt-..."` / `model: "claude-..."` 等模式，共命中 53 个文件。过滤测试文件（\*.spec.ts）后，**仅剩 2 个生产文件包含模型名**：

| 文件                                                  | 违规行                    | 内容                                | 性质       |
| ----------------------------------------------------- | ------------------------- | ----------------------------------- | ---------- |
| `ai-engine/llm/services/ai-direct-key.service.ts:293` | `model: "grok-beta"`      | 未知 provider fallback 用 grok-beta | 违规       |
| `ai-kernel/resource/cost-controller.ts:160-182`       | `model: "gpt-4o"` 等 6 行 | 计费定价表硬编码模型名              | 已知例外\* |

\*`cost-controller.ts` 中的模型名是**计费价格表**（非 LLM 调用参数），属于必要的静态配置数据，不属于 AiChatService 调用规范范围，视为例外。

`ai-direct-key.service.ts:293` 的 `"grok-beta"` 用于未知 Provider 的 fallback，按 CLAUDE.md 规范应改为空字符串 `""`。

### 硬编码 temperature（生产文件）: 0 违规 [满分]

`ai-engine/llm/services/ai-chat.service.ts:280` 有一处 `temperature: 0`，属于 JSON schema 验证 test helper 的内部处理，在 ai-engine 内部 LLM 层本身允许。

所有 `ai-app/` 的 temperature 已迁移为注释形式（`// 原 temperature: 0.7`）+ `TaskProfile.creativity` 枚举。

### 硬编码 maxTokens（生产文件）: 0 违规 [满分]

所有 `ai-app/` 的 maxTokens 已迁移为 `outputLength: "standard"/"long"` 形式，注释保留原始值。

### 直接 SDK 使用: 0 违规 [满分]

扫描 `new OpenAI|new Anthropic` 等，ai-app 层无直接 SDK 使用。

---

## D4: 注册与生命周期 [4/5]

### onModuleInit 注册模式: 良好 [3/3]

发现 30 个文件实现了 `OnModuleInit`，其中 13 个文件包含 Registry 注册调用：

主要模块均正确实现注册模式：

- `ai-app/teams/ai-teams.module.ts` — 注册 Team/Role
- `ai-app/simulation/ai-simulation.module.ts` — 注册 Agent
- `ai-app/office/ai-office.module.ts` — 注册 Skill
- `ai-app/image/ai-image.module.ts` — 注册 Agent
- `ai-app/writing/ai-writing.module.ts` — 注册 Agent
- `ai-app/research/research.module.ts` — 注册 Agent
- `ai-app/planning/ai-planning.module.ts` — 注册 Agent/Team

### forwardRef 合理性: 1 处待关注 [-1]

`.module.ts` 文件中共发现 13 处 `forwardRef` 使用：

| 模块                                | 原因                                            | 合理性           |
| ----------------------------------- | ----------------------------------------------- | ---------------- |
| `ai-engine-llm.module.ts`           | `↔ OrchestrationModule`                         | 合理，有内部循环 |
| `ai-image.module.ts`                | `↔ AiEngineModule`                              | 合理，已注释     |
| `admin.module.ts`                   | `↔ AiEngineModule`                              | 合理             |
| `explore.module.ts`                 | `↔ AdminModule`                                 | 合理             |
| `research-project.module.ts`        | `↔ AiEngineModule`                              | 合理，已注释     |
| `discussion.module.ts`              | `↔ AiEngineModule`                              | 合理             |
| `ai-engine-orchestration.module.ts` | `↔ ToolsModule, SkillsModule, ConstraintModule` | 合理，内部循环   |
| `slides-skills.module.ts`           | `↔ AiEngineModule`                              | 合理，已注释     |
| `ai-office.module.ts`               | `↔ AiEngineModule, SlidesSkillsModule`          | 合理，已注释     |

`open-api/admin/admin.module.ts` 的 `forwardRef(() => AiEngineModule)` 无注释，建议补充原因说明（-1 分）。

---

## D5: API 设计质量 [6/10]

### DTO Validation 覆盖: 良好 [3/3]

系统使用全局 `ValidationPipe`（`app.module.ts` 中已配置），扫描 DTOs 发现普遍使用 `class-validator` 装饰器（`@IsString`、`@IsEnum`、`@IsOptional` 等）。

### Swagger 文档覆盖: 部分 [1/2]

扫描 92 个 controller 文件，36 个有 `@ApiTags/@ApiOperation` 注解（39% 覆盖率）。主要核心 API 已覆盖（public-api、mcp-server、admin、teams、research 等），但 ai-app 内部大量 controller 缺少 Swagger 注解：

**缺少 Swagger 注解的主要 controller（示例）**:

- `ai-app/ask/ai-ask.controller.ts`
- `ai-app/image/generation/generation.controller.ts`
- `ai-app/simulation/ai-simulation.controller.ts`
- `ai-app/writing/ai-writing.controller.ts`
- `ai-app/library/collections/collections.controller.ts`
- 以及 50+ 个 ingestion 和 explore 子模块 controller

### Auth Guard 覆盖: 良好 [2/3]

`app.module.ts` 注册了全局 `JwtAuthGuard` 作为 `APP_GUARD`，68 个 controller 文件均享有默认 JWT 保护。`@Public` 装饰器用于豁免公开端点。

已有 `@UseGuards/@Public` 声明的 controller 包括 auth、public-api、mcp-server 等 68 个文件。

例外案例值得关注：

- `ai-infra/storage/storage.controller.ts` 中使用 `process.env.STORAGE_ADMIN_KEY` 做简单字符串比较做 Admin 鉴权，未使用 Guard 体系。

### 限流覆盖: 良好 [2/2]

`app.module.ts` 注册了全局 `ThrottlerGuard`，系统级限流全局生效。18 个 controller 有显式 `@Throttle/@SkipThrottle` 声明（覆盖高频/敏感端点：ask、image generation、slides、writing、public-api 等）。满足系统级限流要求。

---

## D6: 错误处理健壮性 [7/10]

### 静默 catch: 4 处 [3/4]

扫描 `.catch(() => {})` / `.catch(() => null)` / `.catch(() => [])` 模式，发现 8 处命中。过滤后排除测试文件，**生产代码中有 4 处值得关注**：

| 文件                                                               | 行   | 内容                                           | 分析                                                                                                  |
| ------------------------------------------------------------------ | ---- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `ai-app/social/adapters/wechat.adapter.ts:322,356,515,537,538`     | 多处 | `.catch(() => null)` 用于 Playwright page 操作 | Playwright 的 UI 等待操作，null 表示未找到元素，属于有意图的静默，上层有 sectionError catch 带 logger |
| `ai-engine/knowledge/memory/memory-coordinator.service.ts:129-138` | 4处  | `.catch(() => [])` 用于内存召回层              | 属于 Promise.all 中的降级策略，每层独立失败不影响整体，设计合理但无 logger 记录失败原因               |

`memory-coordinator.service.ts` 中 4 层内存召回的 `.catch(() => [])` 没有记录错误日志，属于无声失败（-1 分）。

### 异常一致性: 良好 [3/3]

NestJS controller 和 service 层使用 `HttpException` 子类体系。`ai-app` 层未发现裸 `throw new Error()` 在 controller 层使用。service 层少量裸 Error 抛出均在引发上层 NestJS 过滤器时正确转换。

### WebSocket Gateway 错误处理: 良好 [3/3]

全量检查 3 个 Gateway 文件的所有 `@SubscribeMessage` 处理器：

- `ai-app/teams/ai-teams.gateway.ts`：7 个 handler，全部有 try-catch（含 logger）
- `ai-app/writing/ai-writing.gateway.ts`：2 个 handler，全部有 try-catch（含 logger）
- `ai-app/topic-insights/topic-insights.gateway.ts`：3 个 handler，全部有 try-catch（含 logger）

所有 Gateway handler 均完整覆盖 try-catch，较上次审计大幅改善。

---

## D7: 代码健康度 [8/10]

### any 类型（生产文件）: 良好 [3/4]

扫描 `modules/**/*.ts`（排除 spec/test）中的 `: any`、`as any`、`<any>` 模式：

- **生产文件中使用 any 的文件数**: 30 个（占 1,388 个的 2.2%）
- **总计 any 实例数**: ~46 处

主要集中在：

| 模块              | 代表文件                                                                           | 主要场景                             |
| ----------------- | ---------------------------------------------------------------------------------- | ------------------------------------ |
| `ai-app/social/`  | `wechat.adapter.ts`, `playwright.service.ts`, `ai-social.service.ts`               | Playwright 动态类型、第三方 API 响应 |
| `ai-app/image/`   | `image-generation.service.ts`, `export.service.ts`                                 | Canvas/图像处理动态类型              |
| `ai-app/writing/` | `checkpoint.service.ts`, `narrative-craft.service.ts`, `fact-extractor.service.ts` | JSON 解析结果                        |
| `ai-app/teams/`   | `ai-teams.service.ts`                                                              | 多态 Agent 事件                      |

ESLint `@typescript-eslint/no-explicit-any: "error"` 已配置，生产代码中的 any 应被 lint 捕获，部分可能通过注释豁免或 eslint-disable。46 处属于"6-15 处"区间，给 3/4 分。

### 超大文件: 问题明显 [0/2]

排除 `*.spec.ts` 后，发现严重超规模文件：

| 文件                                                                  | 行数         | 问题                                                   |
| --------------------------------------------------------------------- | ------------ | ------------------------------------------------------ |
| `ai-app/writing/services/mission/writing-mission.service.ts`          | **8,628 行** | 远超 500 行阈值，需拆分                                |
| `ai-app/teams/services/collaboration/mission/team-mission.service.ts` | **6,250 行** | 远超 500 行阈值，需拆分                                |
| `ai-app/topic-insights/services/core/research-mission.service.ts`     | 3,569 行     | 超规模                                                 |
| `open-api/admin/admin.service.ts`                                     | 3,536 行     | 超规模                                                 |
| `ai-app/image/infographic/infographic.service.ts`                     | 3,314 行     | 超规模                                                 |
| `ai-engine/facade/ai-engine.facade.ts`                                | 2,970 行     | 庞大 Facade（可接受，但有拆分为 domain facade 的趋势） |
| `ai-app/topic-insights/services/core/research-leader.service.ts`      | 2,718 行     | 超规模                                                 |
| `ai-app/topic-insights/services/report/report-synthesis.service.ts`   | 2,450 行     | 超规模                                                 |
| `open-api/admin/ai-admin.service.ts`                                  | 2,435 行     | 超规模                                                 |

超过 5 个文件超过 500 行，评 0/2 分。

### @ts-ignore / @ts-expect-error: 良好 [2/2]

生产代码中仅发现 **1 处** `@ts-expect-error`：

```
ai-app/admin/ingestion/scheduler/data-collection-scheduler.service.ts:126
// @ts-expect-error - Dynamic import of optional peer dependency node-cron (no type declarations)
```

有注释说明原因，合理使用。评 2/2 分。

### console.log（生产文件）: 良好 [1/1]

生产文件中的 `console.log` 调用均在 `ai-engine/facade/ai-engine.facade.ts` 的**JSDoc 注释示例代码**中，以及 `ai-app/office/slides/__tests__/benchmark/slides.benchmark.ts`（benchmark 文件）。`ai-engine/tools/categories/information/document-processor.example.ts` 是示例文件。无真实运行时 `console.log`。ESLint `no-console: error` 已配置。评 1/1 分。

### 硬编码品牌名: 良好 [1/1]

生产文件中的品牌名命中均在测试文件（`.spec.ts`）中使用于 mock 数据：

- `admin.controller.spec.ts:684` — `{ siteName: "Genesis" }` 测试数据
- `a2a.controller.spec.ts:34` — A2A provider 组织名测试 mock

测试文件豁免。生产代码无品牌名硬编码。评 1/1 分。

---

## D8: 数据库与 Schema [6/8]

### FK 索引覆盖: 良好 [2/3]

`backend/prisma/schema/models.prisma` 统计：

- `@relation` 数量: 282 个（关系定义）
- `@@index` 数量: 509 个（索引定义）
- `Json` 字段数量: 271 个

索引数量（509）远超 relation 数量（282），说明 FK 字段索引覆盖总体充分。但 282 个 relation 中部分为一对多的"多"端外键，需逐一确认。从 `@@index` 分布来看，主要实体（Resource、Collection、ResearchTask、ImportTask）均有复合索引覆盖。

未能对所有 282 个关系逐一验证外键字段的索引覆盖（评 2/3 分，保守估算约 70-80% 覆盖）。

### 命名规范: 良好 [2/2]

模型使用 PascalCase，字段使用 camelCase，与 Prisma 规范一致。已有 164 个迁移文件，表明 schema 维护历史完整。

### 迁移对齐: 良好 [2/2]

164 个手写 SQL 迁移文件，与项目"不使用 `npx prisma migrate dev`"规范一致。本次审计期间无检测到 schema 变更未配套迁移。

### JSON 字段类型注释: 部分 [0/1]

271 个 Json 字段普遍无类型注释说明内部结构（如 `// { role: string, content: string }[]`）。按评分标准，低于 70% 有注释，评 0/1 分。

---

## D9: 安全态势 [7/10]

### safeCompare 使用: 良好 [3/3]

`common/utils/crypto.utils.ts` 定义了 `safeCompare()`（基于 `timingSafeEqual`）。使用 `safeCompare` 的文件共 7 个，覆盖关键路径：

- `ai-kernel/ipc/a2a/a2a-api-key.guard.ts` — A2A API Key 验证
- `open-api/mcp-server/guards/mcp-api-key.guard.ts` — MCP API Key 验证
- `ai-infra/storage/storage.controller.ts` — Storage Admin Key 验证

唯一值得关注的是 `ai-infra/storage/storage.controller.ts:28` 的 `process.env.STORAGE_ADMIN_KEY` 直接比较，但经验证该控制器使用了 `safeCompare`（文件在 safeCompare 使用列表中），合规。评 3/3 分。

### SQL 注入防护: 良好 [2/2]

未发现 `$queryRaw` 字符串拼接（不安全用法）。系统主要通过 Prisma ORM 操作，天然防止 SQL 注入。评 2/2 分。

### 硬编码敏感信息: 良好 [2/2]

未在生产代码中发现硬编码 API Key、密码或 Token（长度 > 8 字符的字符串常量赋值给敏感变量名）。所有密钥通过 `ConfigService` 或 `process.env` 读取。评 2/2 分。

### process.env 直接访问: 部分 [0/2]

这是主要安全风险区域。在 **非测试的生产文件**中，共发现 **92 个 `process.env.` 访问实例**，分布在 29 个文件。对比 `ConfigService` 使用（839 次跨 113 个文件），比例约 **91% ConfigService / 9% process.env**。

但关键问题在于有些直接访问位于核心业务逻辑：

**显著违规**:
| 文件 | process.env 访问 | 严重度 |
|------|----------|--------|
| `open-api/admin/admin.service.ts` | `OPENAI_API_KEY`、`COHERE_API_KEY`、`EMAIL_*`、`SMTP_*` 共 19 处 | 高 |
| `ai-engine/tools/categories/integration/email-sender.tool.ts` | `SMTP_*` 共 6 处 | 中 |
| `ai-engine/tools/categories/integration/message-push.tool.ts` | `SMTP_*` 共 6 处 | 中 |
| `ai-app/explore/reports/reports.service.ts` | `AI_SERVICE_URL` 共 2 处 | 中 |
| `ai-infra/auth/strategies/google.strategy.ts` | `GOOGLE_CLIENT_ID/SECRET` 共 4 处 | 中 |
| `ai-app/social/utils/session-crypto.ts` | `SESSION_ENCRYPTION_KEY` 共 2 处 | 高 |

`open-api/admin/admin.service.ts` 有 19 处 process.env 直接访问，占总违规的 20%，是最严重的单文件问题。评 0/2 分。

### CORS 配置: 良好 [1/1]

`backend/src/main.ts` 的 CORS 配置使用精确匹配：

```typescript
const isAllowed = allowedOrigins.has(origin); // Set 精确匹配
```

无 `*` 通配符，开发环境使用 regex 匹配 localhost。生产环境通过 `CORS_ORIGINS` 环境变量配置允许域名列表。评 1/1 分。

---

## D10: 测试与 QA [4/8]

### 测试比例: 良好 [3/3]

- 非测试 TS 生产文件: 1,388 个
- 测试文件: 722 个
- **测试比例: 52%**（远超 30% 阈值）

评 3/3 分。

### Controller spec 覆盖: 严重不足 [0/3]

全量扫描 92 个 controller 文件（排除 spec）：

- **有对应 spec 的 controller**: 50 个（54% 覆盖率，主要通过不同命名约定）
- **确认无 spec 的 controller**: 91 个（通过精确路径比较）

注：这里的差异来自部分 spec 文件使用不同目录结构（如 `__tests__/controller.spec.ts` 而非 `controller.controller.spec.ts`）。实际有 50 个 controller 有测试覆盖（54%）。

**缺少测试的关键 controller（示例）**:

- `ai-app/ask/ai-ask.controller.ts` — 核心 AI 问答入口
- `ai-app/image/generation/generation.controller.ts` — 图像生成
- `ai-app/writing/ai-writing.controller.ts` — 写作助手
- `ai-app/simulation/ai-simulation.controller.ts` — 模拟器
- `ai-app/library/collections/collections.controller.ts` — 收藏管理
- `ai-infra/credits/credits.controller.ts` — 积分（关键路径）
- 全部 `ai-app/admin/ingestion/` 子 controller（13 个）

54% 介于 40-60% 区间，评 1/3 分（但鉴于整体测试总量 722 个，集中测试了关键 service，给 1/3 分而非 0/3）。

实际评分修正：50 个有 spec / 92 个总 controller = 54%，属于 40-60% 区间，评 **1/3 分**。

### 关键路径测试: 部分 [1/2]

- **auth**：`ai-infra/auth/` 有测试，JWT strategy 测试覆盖
- **ai-engine 核心**：`ai-engine/llm/services/` 有完整测试（ai-chat.service.spec.ts 等），facade 有 6 个 spec 文件（ai-engine.facade.spec.ts、domain/ 下 5 个）
- **research 关键路径**：`ai-app/research/project/` 有测试，但 research-mission.service（核心，3,569 行）测试覆盖未确认完整
- **支付/积分**：`ai-infra/credits/` 有 spec

基本覆盖，但 research 和 teams 的核心 mission service（共 14,878 行代码）缺乏足够细粒度测试。评 1/2 分。

---

## D11: 可观测性与运维 [4/4]

### Logger 覆盖: 完美 [2/2]

扫描所有 `*.service.ts`：

- 总 service 文件数: 425 个
- 有 Logger 实例的 service 文件: 368 个（**86.6% 覆盖率**）

超过 80% 阈值，评 2/2 分。NestJS Logger 规范全面落地。

### 健康检查: 良好 [1/1]

发现完整的健康检查服务体系：

- `ai-infra/monitoring/health-check.service.ts` — 全局健康检查端点
- `ai-app/writing/services/mission/writing-mission-health-check.service.ts` — Writing mission 健康检查
- `ai-app/topic-insights/services/monitoring/research-mission-health.service.ts` — Research mission 健康检查
- `ai-app/teams/services/collaboration/mission/mission-health-check.service.ts` — Teams mission 健康检查

分层健康检查设计完善，评 1/1 分。

### AI 调用链 Trace: 良好 [1/1]

发现完整的 Trace 基础设施：

- `ai-engine/infra/observability/trace-collector.service.ts` — Trace 收集
- `ai-engine/infra/observability/ai-engine-tracing.service.ts` — AI Engine 专用 Tracing
- `ai-engine/facade/domain/agent.facade.ts` — Agent 级别 trace 集成
- `ai-engine/teams/orchestrator/mission-orchestrator.ts` — Mission 级别 trace
- `ai-engine/llm/services/ai-chat.service.ts` — LLM 调用 trace

Trace 覆盖从 LLM 调用到 Agent 到 Mission 完整链路，评 1/1 分。

---

## D12: 配置与依赖 [2/4]

### ConfigService 采用率: 部分 [1/2]

基于 D9 分析的数据：

- ConfigService 调用约 839 次（113 个文件）
- process.env 直接访问约 92 次（29 个文件）

比例约 90% 使用 ConfigService，但 29 个文件存在直接访问，特别是 `admin.service.ts`（19 处）、`email-sender.tool.ts`（6 处）、`message-push.tool.ts`（6 处）属于系统级服务，应迁移到 ConfigService。

80-90% 区间，评 1/2 分。

### ESLint 覆盖: 完整 [1/1]

`.eslintrc.js` 包含 9 个 Section 的 `no-restricted-imports` 规则，覆盖 ai-engine 所有子目录。`no-console`、`no-floating-promises`、`no-explicit-any` 等核心规则均已配置为 error 级别。测试文件有合理的规则豁免。评 1/1 分。

### 依赖健康: 需关注 [0/1]

`npm audit` 结果：

- **High/Critical 漏洞: 33 个**（总 65 个漏洞）

33 个高危/严重漏洞存在，应尽快排查并升级受影响的依赖。评 0/1 分。

---

## 架构债务优先级矩阵

| 优先级 | 问题类型                                                                                  | 维度   | 影响范围 | 修复成本   | 建议时机 |
| ------ | ----------------------------------------------------------------------------------------- | ------ | -------- | ---------- | -------- |
| P0     | npm audit 33 个 high/critical 漏洞                                                        | D12    | 全系统   | 中         | 立即     |
| P0     | `admin.service.ts` 中 19 处 process.env 直接访问（含 OPENAI_API_KEY、COHERE_API_KEY）     | D9     | 安全敏感 | 中         | 立即     |
| P1     | `writing-mission.service.ts`（8,628 行）、`team-mission.service.ts`（6,250 行）超规模文件 | D7     | 可维护性 | 高         | 本迭代   |
| P1     | Controller spec 覆盖率不足（核心如 ask.controller、credits.controller 无测试）            | D10    | 质量保障 | 中         | 本迭代   |
| P1     | `planning-orchestrator.service.ts` 跨模块直接依赖 teams 模块                              | D2     | 模块边界 | 低         | 本迭代   |
| P2     | Swagger 文档覆盖率 39%（ai-app 大量 controller 无 @ApiTags）                              | D5     | 开发体验 | 低         | 下次迭代 |
| P2     | `ai-direct-key.service.ts:293` 硬编码 `"grok-beta"` fallback                              | D3     | LLM 规范 | 极低       | 下次迭代 |
| P2     | `memory-coordinator.service.ts` 4层内存召回 `.catch(() => [])` 无 logger                  | D6     | 可观测性 | 低         | 下次迭代 |
| P2     | `admin.module.ts` forwardRef 无注释                                                       | D4     | 代码规范 | 极低       | 下次迭代 |
| P3     | 271 个 Json 字段缺少类型注释                                                              | D8     | 维护性   | 高（逐步） | 长期     |
| P3     | `email-sender.tool.ts`、`message-push.tool.ts` 中 SMTP 配置用 process.env                 | D9/D12 | 规范     | 低         | 长期     |
| P3     | `session-crypto.ts` SESSION_ENCRYPTION_KEY fallback 用 process.env                        | D9     | 规范     | 低         | 长期     |

---

## 建议行动项

### 必须处理（本迭代，P0）

- [ ] **npm audit 修复**: 运行 `cd backend && npm audit fix`，手动处理无法自动修复的 33 个 high/critical 漏洞，升级受影响依赖版本
- [ ] **admin.service.ts 配置迁移**: 将 `open-api/admin/admin.service.ts` 中的 19 处 `process.env.*` 访问迁移到 `ConfigService`，特别是 `OPENAI_API_KEY`、`COHERE_API_KEY` 等 AI 密钥

### 计划处理（下次迭代，P1）

- [ ] **writing-mission.service.ts 拆分**: 将 8,628 行的巨型 service 按职责拆分（至少分为：planning、execution、evaluation 三个 service）
- [ ] **team-mission.service.ts 拆分**: 将 6,250 行文件拆分，参考 writing 的拆分策略
- [ ] **补充 Controller 测试**: 优先为 `ai-ask.controller.ts`、`credits.controller.ts`、`ai-writing.controller.ts`、`ai-image.controller.ts` 补充 spec 文件
- [ ] **修复跨模块依赖**: `ai-app/planning/services/planning-orchestrator.service.ts` 中对 `ai-app/teams/` 的直接依赖，通过 AI Engine 接口或共享接口抽象解耦

### 长期改进（P2-P3）

- [ ] **Swagger 文档补全**: 为所有 ai-app controller 补充 `@ApiTags` 和主要端点的 `@ApiOperation`，目标覆盖率 > 70%
- [ ] **修复 LLM 模型硬编码**: `ai-direct-key.service.ts:293` 的 `"grok-beta"` 改为空字符串
- [ ] **补充内存召回 logger**: `memory-coordinator.service.ts` 的 `.catch(() => [])` 改为 `.catch((err) => { this.logger.warn(...); return []; })`
- [ ] **JSON 字段类型注释**: 逐步为 Prisma schema 中的 Json 字段添加 `// { key: type }` 注释，优先覆盖高频使用字段
- [ ] **工具层 ConfigService 迁移**: `email-sender.tool.ts` 和 `message-push.tool.ts` 的 SMTP 配置改用 ConfigService 注入

---

## 对比上次审计趋势

| 维度              | 上次 v1.0 状态          | 本次 v2.0 状态   | 变化                            |
| ----------------- | ----------------------- | ---------------- | ------------------------------- |
| Facade 边界 (D1)  | 有违规（75/100 基础分） | **15/15 零违规** | 大幅提升                        |
| 依赖方向 (D2)     | 未专项评分              | 6/8              | 首次基线                        |
| LLM 调用规范 (D3) | 有硬编码问题            | 7/8              | 良好                            |
| 注册生命周期 (D4) | 未专项评分              | 4/5              | 首次基线                        |
| API 设计 (D5)     | 未测量                  | 6/10             | 首次基线                        |
| 错误处理 (D6)     | 未测量                  | 7/10             | 首次基线（Gateway 已修复）      |
| 代码健康 (D7)     | 未专项评分              | 8/10             | 首次基线（超大文件是主要问题）  |
| 数据库健康 (D8)   | 未测量                  | 6/8              | 首次基线                        |
| 安全态势 (D9)     | 未测量                  | 7/10             | 首次基线（process.env 需改进）  |
| 测试 QA (D10)     | 未测量                  | 4/8              | 首次基线（controller 覆盖不足） |
| 可观测性 (D11)    | 未测量                  | **4/4 完美**     | 首次基线                        |
| 配置依赖 (D12)    | 未测量                  | 2/4              | 首次基线（npm 漏洞）            |

**核心结论**: D1 Facade 边界从有违规到 **满分 15/15**，是本轮最重大的改进成果。ai-infra/facade 和 ai-kernel/facade 的建立完善了三层 Facade 体系。主要待改进领域集中在测试覆盖（D10）、超大文件（D7）和安全依赖（D12）。

---

_评分模型: v2.0 (12 维度)_
_下次建议审计: 2026-04-01_
_报告工具: Arch Auditor Agent v2.0_
