/**
 * AI Engine - Main Entry Point
 * AI 引擎主入口
 *
 * 依赖方向：AI App (L3) → AI Harness (L2.5) → AI Engine (L2) → AI Infra (L1)
 *
 * 12 顶层聚合（每个即一台「引擎」，详见 standards/16-ai-engine-harness-structure.md）：
 *   llm · tools · rag · knowledge · content · skills · planning · safety ·
 *   routing · reliability · evaluation · facade
 * 本层无 agent/mission 状态（早期的 core/constraint/memory 已解散或迁 ai-harness）。
 *
 * 使用方式（facade-first）：
 * ```typescript
 * // 推荐：统一从 facade 导入（App / Harness 不得穿透内部路径）
 * import { ITool, EngineError } from './ai-engine/facade';
 * // Agent / Team / Mission 类型请从 ai-harness/facade 导入
 * ```
 */

// 重新导出核心类型（选择性导出，避免冲突）
export type {
  // Types
  JsonValue,
  JsonObject,
  ExecutionResult,
  ExecutionMetadata,
  ExecutionError,
  ValidationResult,
  RetryConfig,
  TimeoutConfig,
  PaginationParams,
  PaginatedResult,
  DeepPartial,
  Nullable,
  Optional,
  MaybePromise,
  // Context
  BaseContext,
  // Interfaces
  IExecutable,
  IRegistry,
  IRegisterable,
  RegistryStats,
} from "./facade/index";
export {
  EngineExecutionMode,
  BaseRegistry,
  // Errors
  EngineError,
  ToolError,
  SkillError,
  TimeoutError,
  CancelledError,
  NotFoundError,
  ValidationError,
  // Error Codes
  CommonErrorCode,
  ToolErrorCode,
  SkillErrorCode,
  AgentErrorCode,
} from "./facade/index";

// Agent 类型系统

// 子模块命名空间导出
export * as Core from "./facade/index";
export * as Tools from "./tools";
export * as Skills from "./skills";
// W1-moderation (2026-06-02): safety/constraint split into moderation + validation
export * as Moderation from "./safety/moderation";
export * as Validation from "./safety/validation";
export * as Guardrails from "./safety/guardrails";
export * as LLM from "./llm";
// Memory barrel 已迁移到 ai-harness/memory（2026-04-30）
// 消费方请使用 "@/modules/ai-harness/facade" 或 "@/modules/ai-harness/memory"
// MCP moved to ai-engine/tools/adapters/mcp (PR-X7)
// export * as MCP from "./mcp"; — removed
// Teams barrel 已迁移到 ai-harness/teams（PR-X4）
// 消费方请使用 "@/modules/ai-harness/facade" 或 "@/modules/ai-harness/teams"

// 常用服务导出（便于直接导入）
export { ToolRegistry } from "./tools/registry";
// ShortTermMemoryService / LongTermMemoryService / MemoryCoordinatorService /
// HierarchicalMemoryCascadeService / WorkingMemoryManagerService / ConstraintEngine
// 都居住在 ai-harness — 消费方应从 "@/modules/ai-harness/facade" 或
// "@/modules/ai-harness/memory" 导入。engine 主 barrel 不再做反向 re-export。
export { GuardrailsPipelineService } from "./safety/guardrails/guardrails-pipeline.service";

// Teams 模块核心服务（PR-X4: 已迁移到 ai-harness/teams，不再从 ai-engine barrel 导出）
// 消费方请使用 "@/modules/ai-harness/facade" 或直接 "@/modules/ai-harness/teams"

// NestJS 模块导出
export { AiEngineModule } from "./ai-engine.module";
// AiEngineLightModule removed (PR-X24): zero external consumers.
export { AiEngineLLMModule } from "./llm/llm.module";
export { AiEngineToolsModule } from "./tools/tools.module";
export { AiEngineSkillsModule } from "./skills/skills.module";
export { AiEnginePlanningModule } from "@/modules/ai-engine/planning/planning.module";
// AiEngineMemoryModule 已移除（2026-04-30）—— 见 RuntimeMemoryModule
// (ai-harness/memory/working/memory.module.ts)
export { AiEngineSafetyModule } from "./safety/safety.module";

// TeamsModule（PR-X4: 已迁移，从 ai-harness/teams 导入）

// Facade (统一入口) — engine-only symbols
// AIFacade / ModelResolverService 已迁移至 ai-harness/facade（PR-X13/PR-X14）
// 消费方请从 "@/modules/ai-harness/facade" 导入。
// facade/types 已删除（PR-X14）；类型请从 ai-harness/facade 导入。

// Observability 服务 (AiObservability / CostAttribution / TraceCollector /
// SessionLatencyTracker) 居住在 ai-harness — 消费方应从
// "@/modules/ai-harness/facade" 导入。engine 主 barrel 不再做反向 re-export。

// Prompt Registry 导出
export { PromptRegistryService } from "./llm/prompts/prompt-registry.service";

// Image 生成栈（content/image factory+adapters+abstractions）已删除：
// 运行时零注入死代码。活路径为 ai-app/image（raw HTTP）+ llm/image（BYOK）。
