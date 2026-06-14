---
name: Capability Map
description: |
  写任何新代码前先查这份全栈能力索引，复用已有 canonical 能力，避免重复造轮子。
  覆盖：前端公共组件/hooks/design-tokens、L2.5 harness facade、L2 engine facade、L1 platform facade。
  Trigger keywords: 复用, 已有组件, 已有服务, canonical, 造轮子, 能力清单, capabilities, facade, 公共能力, 有没有现成的
  Not for: 新增依赖/跨层关系变更（-> ai-architecture-layering）；前端 UI 复用强制规则（-> 标准 22 / audit:ui-discipline）
allowed-tools: [Bash, Read, Grep, Glob]
tags: [reuse, capabilities, facade, frontend, harness, engine, platform, dry]
---

# Capability Map — 全栈能力复用索引

> **铁律**：在写任何新组件 / 服务 / hook / 工具 / 类型之前，**先查这份索引**确认没有现成的。
> 重复造轮子是本项目的高频反模式（前端组件库复用率曾 < 10%，见标准 22）。

## 索引在哪

机器可读真相源（由脚本从代码自动生成，**勿手改**）：

```
docs/architecture/capabilities.json
```

结构：每条 `{ name, kind, layer, domain, source, import }`。

- `layer` ∈ `frontend | harness | engine | platform`
- `kind` ∈ `value`（服务/类/函数/常量/组件）| `type`（类型/接口）| `namespace`
- `import` 是可直接粘贴的导入语句

四层来源：

| layer          | 真相源                                                              | 复用入口                           |
| -------------- | ------------------------------------------------------------------- | ---------------------------------- |
| frontend       | `components/ui/**` + `hooks/{core,domain}` + `lib/design/tokens.ts` | `@/components/...` / `@/hooks/...` |
| harness (L2.5) | `ai-harness/facade/index.ts`                                        | `@/modules/ai-harness/facade`      |
| engine (L2)    | `ai-engine/facade/index.ts`                                         | `@/modules/ai-engine/facade`       |
| platform (L1)  | `platform/facade/index.ts`                                          | `@/modules/platform/facade`        |

## 怎么查（开工前必做）

**按名字精确查**（要写 `XxxCard`？先确认有没有）：

```bash
node -e "const d=require('./docs/architecture/capabilities.json');console.log(d.capabilities.filter(c=>/card/i.test(c.name)).map(c=>c.layer+' '+c.name+'  '+c.import))"
```

**按层 + 子域浏览**（想知道 engine/rag 提供了什么）：

```bash
node -e "const d=require('./docs/architecture/capabilities.json');d.capabilities.filter(c=>c.layer==='engine'&&c.domain==='rag').forEach(c=>console.log(c.kind,c.name))"
```

**或直接 Grep**：`Grep pattern="\"name\": \"use" path=docs/architecture/capabilities.json`

## 高频复用速查（最易被重复造的轮子）

> 这是策划过的捷径；完整清单永远以 `capabilities.json` 为准。

### 前端（写卡片/弹层/状态前必看 — 同时受 audit:ui-discipline 硬零拦截）

| 想做                   | 用 canonical                                                                      | 不要自写                            |
| ---------------------- | --------------------------------------------------------------------------------- | ----------------------------------- |
| 资产卡片               | `AssetCard`                                                                       | `rounded-xl border bg-white` 手搓卡 |
| 卡片网格               | `CardGrid`                                                                        | 自写 grid 响应式                    |
| 统计卡 / 新建卡        | `StatCard` / `CreateCard`                                                         | —                                   |
| 弹窗 / 确认框          | `Modal` / `ConfirmDialog`（+ `useConfirm`）                                       | `fixed inset-0 z-50` 手搓           |
| 空 / 错 / 加载态       | `EmptyState` / `ErrorState` / `LoadingState`(`LoadingSkeleton`)                   | 自写 spinner / 空态                 |
| Tab 栏                 | `Tabs`                                                                            | `activeTab===` 手搓 tab 条          |
| 表格                   | `Table`/`THead`/`TBody`/`Tr`/`Th`/`Td`                                            | 原生 `<table>`                      |
| 页头                   | `PageHeaderHero`                                                                  | 自写 hero                           |
| 按钮 / 输入 / 开关     | `Button` / `Input` / `Textarea` / `Switch`                                        | 原生 + 手搓样式                     |
| 徽章 / 标签 / 进度     | `StatusBadge` / `Tag` / `ProgressBar`                                             | —                                   |
| 复制 / 分页 / 日期范围 | `CopyButton` / `Pagination` / `DateRangePicker`                                   | —                                   |
| 查看器                 | `PDFViewer` / `HTMLViewer` / `MermaidDiagram` / `ReaderView`                      | —                                   |
| 颜色/字号/间距         | `lib/design/tokens.ts`（`surface`/`text`/`toneToken`/`statusToken`/`roleToken`…） | 任意值 `text-[Npx]` / 硬编码 `#hex` |
| 异步/请求/流           | `useApi` / `useAsyncState` / `useAsyncOperation` / `useStream`                    | 自写 fetch loading 状态机           |

### 后端 engine (L2)（无 agent/mission 状态的基元）

| 想做                       | 用 canonical（从 `@/modules/ai-engine/facade`）                                     |
| -------------------------- | ----------------------------------------------------------------------------------- |
| 调 LLM                     | `AiChatService.chat()` + `TaskProfile`（**禁止**硬编码模型名/温度）                 |
| 选模型 / 降级              | `ModelElectionService` / `ModelFallbackService`                                     |
| RAG 检索                   | `RAGPipelineService` / `EmbeddingService` / `VectorService` / `DocumentChunker`     |
| 工具 / 技能注册            | `ToolRegistry` / `SkillRegistry`（项目唯一，**勿新建**）                            |
| 解析 LLM JSON 输出         | `parseJsonFence` / `extractJsonFenceContent`                                        |
| 清洗 markdown / 报告后处理 | `sanitizeMarkdownBody` / `postProcessFinalReport` / `formatDimensionContent`        |
| 安全（SSRF/注入/PII）      | `safeFetch` / `assertUrlSafe` / `sanitizePromptInput` / `GuardrailsPipelineService` |
| 重试 / 退避                | `withRetry` / `isRetryableError` / `calculateBackoffDelay`                          |
| 引用 / 参考文献            | `verifyCitations` / `formatCitation` / `generateBibliography`                       |
| 打分路由                   | `ScoredRouterService`                                                               |

### 后端 harness (L2.5)（有 agent/mission 状态的编排层）

| 想做                          | 从 `@/modules/ai-harness/facade` 找                                  |
| ----------------------------- | -------------------------------------------------------------------- |
| 统一门面                      | `HarnessFacade`                                                      |
| 定义 / 跑 Agent               | `DefineAgent` / `AgentFactory` / `SpecAgentRegistry` / `AgentRunner` |
| 团队 / 协作（投票/辩论/评审） | teams 子域（Registry + collaboration 模式）                          |
| Agent 切换                    | handoffs 子域                                                        |
| 记忆 / checkpoint / 事件流    | memory 子域（vector/working/checkpoint/event-store）                 |
| 资源限额 / 计费               | guardrails 子域（budget/billing/rate-limit/capability-guard）        |
| 追踪 / 评测                   | tracing / evaluation 子域                                            |

> harness 导出量大（1000+），按 `domain` 浏览：`c.layer==='harness' && c.domain==='memory'` 等。

### 后端 platform (L1)（通用基础设施，零 agent 状态）

| 想做               | 用 canonical（从 `@/modules/platform/facade`）                                         |
| ------------------ | -------------------------------------------------------------------------------------- |
| 认证               | `AuthService`                                                                          |
| 积分 / 计费        | `CreditsService` / `CreditRulesService` / `CheckinService`                             |
| 密钥 / BYOK        | `SecretsService` / `SecretKeysService` / `KeyResolverService`                          |
| 对象存储 / 容量    | `ObjectStorageService` / `StorageGovernanceService`                                    |
| 邮件 / 通知        | `EmailService` / `NotificationService` / `NotificationDispatcher`                      |
| 监控 / 健康 / 审计 | `AIMetricsService` / `HealthCheckService` / `AuditLogService` / `ErrorTrackingService` |
| 韧性               | `CircuitBreaker` / `AbortableScope` / Token Bucket 限流                                |
| 数据库运维 / 设置  | `DbOpsService` / `SettingsService`                                                     |

## 找不到现成能力时

1. **缺口在前端 canonical（如 Tabs 不适配）** → 按 CLAUDE.md「前端 UI 组件复用优先」**停下来问用户**，不要静默自写或擅自新建公共组件。
2. **缺口在后端 facade** → 若底层已有实现只是没导出，先在对应 `facade/index.ts` 补 export（不要穿透内部路径绕过 facade）；若确实没有，按「架构决策必须确认」先报方案。
3. 新增/删除任何公共能力后 → `npm run capabilities:update` 刷新索引并提交，否则 CI `capability-index` 门 + pre-push `[7/7]` 会拒。

## 看护机制

| 命令                          | 用途                                        |
| ----------------------------- | ------------------------------------------- |
| `npm run capabilities:check`  | 看护：索引与代码不一致即 exit 1（默认模式） |
| `npm run capabilities:update` | 重新生成 `capabilities.json`                |

接线：`.husky/pre-push` 第 `[7/7]` 步 + CI `capability-index` job（汇入 `ci-status` 合并门）。
生成器：`scripts/utils/generate-capabilities.ts`（TS 编译器 API，AST 级抽取，递归解析 `export *`）。
