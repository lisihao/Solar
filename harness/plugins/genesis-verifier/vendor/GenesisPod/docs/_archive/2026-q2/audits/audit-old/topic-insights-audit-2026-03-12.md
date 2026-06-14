# Topic Insights 模块架构审计报告

**审计日期**: 2026-03-12
**审计版本**: c97a5d8c9
**审计员**: Arch Auditor Agent v2.0
**审计范围**: `backend/src/modules/ai-app/topic-insights/` 全量代码库

**模块规模概览**:

- 生产 TS 文件: 181 个
- 测试 TS 文件: 99 个
- 总代码行数: 70,592 行（含测试）
- Service 文件: 67 个（64 个有 Logger 实例）
- Controller 文件: 6 个（均有 spec）
- DTO 文件: 17 个
- 测试用例数: ~3,384 个

---

## 维度评分

| 维度              | 分数 | 说明                                                                                       |
| ----------------- | ---- | ------------------------------------------------------------------------------------------ |
| 1. 模块结构与分层 | 7/10 | 目录组织清晰但存在 `topic-insights.service.ts` 1623 行的门面层过重问题                     |
| 2. 依赖关系       | 9/10 | Facade 边界全部正确；无跨 ai-app 兄弟模块依赖；无反向依赖                                  |
| 3. 代码重复       | 5/10 | JSON 提取模式在 4 处重复；`buildFiguresSummary` 重复调用路径；leader/orchestrator 代码重复 |
| 4. 错误处理       | 7/10 | 无静默 catch；`throw new Error()` 出现在服务层内部信号传递；WS Gateway 有 try-catch        |
| 5. 类型安全       | 9/10 | 生产代码仅 1 处 `as any`；无 `@ts-ignore`；DTO 覆盖全面                                    |
| 6. 测试覆盖       | 8/10 | 99 个测试文件、3384 个用例；6 个 Controller 均有 spec；核心路径覆盖充分                    |
| 7. 性能           | 6/10 | `p-limit` 并发控制已使用；44 个文件超 500 行（最大 2666 行）；N+1 风险点已知               |
| 8. 安全           | 8/10 | 全 Controller 有 JwtAuthGuard；TopicAccessGuard 细粒度；ConfigService 获取 JWT_SECRET      |
| 9. 可维护性       | 5/10 | 44 个文件超 500 行，最大 2666 行；函数层级深；Magic Error 字符串编码                       |
| 10. API 设计      | 9/10 | DTO 校验完整（343 处 validator）；全量 Swagger 文档；全量限流装饰器；RESTful 规范          |

**总分: 73/100**

---

## 关键问题清单（按严重程度排序）

### P0 — 立即处理

**P0-1: `throw new Error()` 用于内部错误信号传递（跨层污染）**

文件: `services/core/leader-planning.service.ts:630,640,902,914`、`services/dimension/section-writer.service.ts:342,666,771`

问题: 服务层使用裸 `throw new Error("[INSUFFICIENT_CREDITS] ...")` 而非 NestJS 标准异常。这些字符串标记（`[INSUFFICIENT_CREDITS]`、`[CONTEXT_TOO_LONG]`）被上层 catch 块用字符串 `.includes()` 检测，形成隐式协议。一旦字符串拼写有误，异常会逃逸为 500 错误。

正确做法: 定义 `InsufficientCreditsException extends ServiceUnavailableException`，通过 `instanceof` 检测，移除脆弱的字符串匹配。

**P0-2: `topic-insights.service.ts` 1623 行的过重门面层**

文件: `topic-insights.service.ts`

问题: 尽管已完成 God Service 分解，这个"门面 Service"仍有 1623 行和 86 个方法，大量包含实际业务逻辑（DB 查询、SSE 流等）而非纯委托。Controllers 同时注入此服务和细分 Service，造成职责不清。

建议: 将剩余逻辑下沉到已有的 `TopicCrudService`、`TopicScheduleService` 等子 Service，把 `topic-insights.service.ts` 精简到纯路由委托（<200 行）。

---

### P1 — 本迭代处理

**P1-1: JSON 提取逻辑四处重复实现**

文件:

- `services/data/data-source-fetcher.service.ts:903-909`（`jsonBlockMatch`/`codeBlockMatch` 模式）
- `services/data/data-source-router.service.ts:2104-2112`（完全相同的实现）
- `services/data/data-source-planner.service.ts:441`（`jsonMatch` 模式）
- `services/collaboration/research-reflection.service.ts:212`（`/\{[\s\S]*\}/` 模式）

`extractJsonFromResponse` 工具函数已存在（`services/utils/extract-json.utils.ts`，被 50 处引用），但上述 4 处未使用它，而是内联实现。应全部替换为共享工具函数。

**P1-2: 44 个生产文件超过 500 行（最大 2666 行）**

超大文件清单（前 10）：

| 文件                                               | 行数 |
| -------------------------------------------------- | ---- |
| `services/data/data-source-router.service.ts`      | 2666 |
| `services/dimension/dimension-mission.service.ts`  | 2552 |
| `services/report/report-synthesis.service.ts`      | 2483 |
| `services/collaboration/research-todo.service.ts`  | 1661 |
| `topic-insights.service.ts`                        | 1623 |
| `services/dimension/dimension-writing.service.ts`  | 1515 |
| `services/dimension/section-writer.service.ts`     | 1382 |
| `services/core/topic-team-orchestrator.service.ts` | 1297 |
| `services/core/mission-lifecycle.service.ts`       | 1297 |
| `services/report/report-generator.service.ts`      | 1281 |

`data-source-router.service.ts` 和 `dimension-mission.service.ts` 是最高优先级，各自超过 2500 行，单一文件中承担了多个概念层的职责。

**P1-3: `buildFiguresSummary` 存在三条调用路径，单一实现分散于两处**

代码已有 `evidence-summary.utils.ts` 统一了此函数，但 `leader-planning.service.ts` 和 `research-leader.service.ts` 仍直接引用了该函数（14 处调用方）。这不是 DRY 违反，但此函数产生的 `figuresSummary` 被三个不同服务分别注入进 prompt，缺乏统一的上下文长度检查（已有 `HARD_TRUNCATE_LIMIT`，但各调用点执行不一致）。

**P1-4: Magic Error String 协议脆弱**

文件: `leader-planning.service.ts`, `section-writer.service.ts`、以及调用方的 catch 块

`[INSUFFICIENT_CREDITS]`、`[CONTEXT_TOO_LONG]`、`Refresh cancelled` 等特殊字符串被用作异常信号，通过 `.message.includes(...)` 检测。共有 5 处此类模式。无类型安全保障，重构时容易遗漏。

---

### P2 — 下次迭代处理

**P2-1: 测试文件中硬编码模型名**

文件: `services/collaboration/__tests__/research-reviewer.service.spec.ts`（7处 `"gpt-4"`）、`services/collaboration/__tests__/research-reflection.service.spec.ts`（5处 `"gemini-pro"`）、`services/dimension/__tests__/section-writer.service.spec.ts`（46+处 `"gpt-4o"`, `"claude-3-sonnet"`, `"claude-3-opus"`）、`services/quality/__tests__/critique-refine.service.spec.ts`（16处 `"gpt-4"`）

总计 80+ 个测试 fixture 中含有硬编码模型名。生产代码本身已正确使用空字符串或 TaskProfile，但测试 mock 数据使用具体模型名，导致测试场景与规范不一致，在回归测试时容易掩盖真实问题。

**P2-2: `void` fire-and-forget 链异常捕获不一致**

文件: `services/core/mission-execution.service.ts:929,954,1072,1077`、`services/core/mission-lifecycle.service.ts:274,472,476,486,504,650`、`services/core/mission-kernel-bridge.service.ts:117,216,241,264,317,346`

大量使用 `void this.xxx().catch(err => {...})` 模式，部分有 logger，部分直接 `void` 无 catch 保护（如 `mission-execution.service.ts:1077` 的 `void this.prisma.researchMission...`）。应确保所有 fire-and-forget 链都有 `.catch(err => this.logger.error(...))`。

**P2-3: `collaboration.controller.ts` 缺少细粒度资源级 Guard**

`collaboration.controller.ts` 使用了类级别 `@UseGuards(JwtAuthGuard)` 但无方法级的 `TopicAccessGuard`，而 `mission.controller.ts` 每个方法都有 `@UseGuards(TopicAccessGuard)`。协作端点（添加协作者、删除协作者等）访问同一 topic 资源，应同样使用 `TopicAccessGuard` 验证所有权。

**P2-4: `data-source-router.service.ts` 与 `data-source-fetcher.service.ts` 存在逻辑重叠**

两个文件合计 3718 行，且均包含 LLM 调用 + JSON 解析 + 数据源路由逻辑。根据文件名语义，一个应该只负责"路由决策"，另一个负责"执行拉取"，但实际上各自都完整实现了路由→拉取→解析的完整链路，存在职责混淆。

---

### P3 — 长期改进

**P3-1: N+1 查询风险点**

`services/collaboration/research-todo.service.ts:148` 在 todos 循环中对每个 `todo.modelId` 单独调用 `getModelDisplayNameMap`，是已知的 N+1 场景。其他 `findMany` 调用均为批量操作，风险较低。

**P3-2: `p-limit` ESM/CJS 互操作绕过方案**

`services/core/refresh-pipeline.service.ts:9-13` 和 `services/search/global-source-throttle.service.ts:17-25` 使用了 `require("p-limit")` 绕过 ESM 模块的运行时补丁。这依赖不稳定的 CJS interop 行为。建议升级项目为支持 ESM 或将 `p-limit` 替换为 CJS 兼容的并发限制库（如自实现的信号量）。

**P3-3: `topic-insights.module.ts` providers 数组过于庞大**

Module 文件本身有 250+ 行的 providers 列表（67+ 个服务）。考虑按子领域拆分为子 Module（如 `MissionModule`、`ReportModule`、`SearchModule`），提升模块可测试性和可维护性。

---

## 亮点

1. **Facade 边界 100% 合规**: 全量扫描 180+ 个生产文件，所有 ai-engine 导入均通过 `@/modules/ai-engine/facade`，无一处穿透内部路径。这是核心架构约束执行最彻底的模块。

2. **零 `console.log`、零 `@ts-ignore`**: 生产代码中无任何 console 输出语句，无 ts-ignore 注释。Logger 实例化率 100%（64/64 服务文件）。

3. **全量 @Throttle 限流**: 6 个 Controller 的所有端点均有按语义分级的 `@Throttle` 装饰器（AI 触发操作 5/min，读操作 30/min），设计精细。

4. **全量 Swagger 文档**: 6 个 Controller 全部有 `@ApiTags`，所有方法有 `@ApiOperation`，覆盖率 100%。

5. **测试覆盖深度**: 99 个测试文件、3384 个测试用例，test:production 比约 55%（高于 30% 基准线）。6 个 Controller 全部有 spec，核心 Service（leader-planning、mission-execution、research-leader）有多份补充 spec。

6. **`p-limit` 并发控制**: `SearchOrchestratorService` 和 `RefreshPipelineService` 均使用 `p-limit` 做并发控制，避免了无限制的 `Promise.all` 导致的资源耗尽。

7. **God Service 已完成分解**: `ResearchLeaderService` 拆分为 `LeaderPlanningService`/`LeaderIntentService`/`LeaderAgentSelectionService`/`LeaderReviewService`；`MissionExecutionService` 拆分为 `MissionLifecycleService`/`MissionQueryService`/`MissionObservabilityService`/`MissionKernelBridgeService`。方向正确。

8. **`HEALTH_MONITORING` 配置常量**: 健康监控阈值从代码中提取到 `config/health-monitoring.config.ts`，且 `INTERRUPTED_THRESHOLD_MS` 已合理设置为 30 分钟（匹配 LLM 任务实际耗时）。

9. **`buildFiguresSummary` Base64 防护**: `evidence-summary.utils.ts` 已正确过滤 `data:` 开头的 base64 URL（参见 `sanitizeImageUrl` 调用），防止 prompt injection。

---

## 架构债务优先级矩阵

| 优先级 | 问题                                                           | 维度     | 影响范围         | 修复成本                       | 建议时机     |
| ------ | -------------------------------------------------------------- | -------- | ---------------- | ------------------------------ | ------------ |
| P0     | `throw new Error()` 用作内部信号（脆弱字符串协议）             | 错误处理 | 高（运行时安全） | 低（定义 2-3 个自定义异常类）  | 立即         |
| P0     | `topic-insights.service.ts` 1623 行过重门面层                  | 结构     | 高（维护性）     | 中（提取逻辑到已有子 Service） | 立即         |
| P1     | JSON 提取逻辑 4 处重复（未使用共享 `extractJsonFromResponse`） | 代码重复 | 中               | 低（搜索替换）                 | 本迭代       |
| P1     | 44 个文件超 500 行（最大 2666 行）                             | 可维护性 | 高（认知负担）   | 高（需拆分重构）               | 本迭代起分批 |
| P1     | Magic Error String 协议（5 处）                                | 错误处理 | 中               | 低                             | 本迭代       |
| P2     | 测试 fixture 含 80+ 硬编码模型名                               | 测试质量 | 低（测试准确性） | 低                             | 下次迭代     |
| P2     | fire-and-forget 部分无 catch 保护                              | 错误处理 | 中               | 低                             | 下次迭代     |
| P2     | `collaboration.controller.ts` 无 `TopicAccessGuard`            | 安全     | 中               | 低                             | 下次迭代     |
| P3     | `p-limit` ESM/CJS 绕过方案                                     | 依赖     | 低（技术债）     | 中                             | 长期         |
| P3     | Module providers 数组 250+ 行                                  | 结构     | 低               | 高                             | 长期         |

---

## 建议行动项

### 必须处理（本迭代）

- [ ] 定义 `InsufficientCreditsException`、`ContextTooLongException` 继承 NestJS 标准异常，替换所有 `throw new Error("[TAG]")` 模式
- [ ] 将 `data-source-fetcher.service.ts:903-909` 和 `data-source-router.service.ts:2104-2112` 的内联 JSON 提取替换为 `extractJsonFromResponse`
- [ ] 将 `topic-insights.service.ts` 中剩余 DB 操作/业务逻辑迁移到对应子 Service，保持门面层纯委托

### 计划处理（下次迭代）

- [ ] 将测试 fixture 中的硬编码模型名（`"gpt-4"`, `"gpt-4o"`, `"claude-3-sonnet"` 等）替换为空字符串或测试专用常量
- [ ] 审查所有裸 `void this.prisma...` 链，补充 `.catch(err => this.logger.error(...))`
- [ ] 为 `collaboration.controller.ts` 的资源修改端点添加 `@UseGuards(TopicAccessGuard)`

### 长期改进

- [ ] 将 `data-source-router.service.ts`（2666 行）拆分：决策层（路由策略）与执行层（数据拉取）分离
- [ ] 将 `dimension-mission.service.ts`（2552 行）拆分：可按"规划"/"执行"/"评估"三阶段分离
- [ ] 将 `TopicInsightsModule` 按子领域拆分为 `MissionModule`、`ReportModule`、`SearchModule`，减少单模块的 provider 数量

---

_报告工具: Arch Auditor Agent v2.0_
_下次建议审计: 2026-04-12（月度）_
