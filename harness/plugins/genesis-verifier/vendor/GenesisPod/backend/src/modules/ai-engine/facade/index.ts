/**
 * AI Engine Facade — engine-only capability exports
 *
 * Only ai-engine internal symbols are exported here.
 * Harness symbols (AIFacade / ChatFacade / RAGFacade / AgentFacade /
 * TeamFacade / ToolFacade / ModelResolverService / FACADE_FEATURE_PROVIDERS /
 * AgentRegistry / TeamRegistry / RoleRegistry / mission types / team types /
 * constraint types / PlanBasedAgent / BaseAgent / MCPManager / etc.)
 * must be imported from "@/modules/ai-harness/facade".
 */

export { PromptSkillRegistrationService } from "../skills/integration";
export { CHAT_PROVIDER_PORT } from "./abstractions/runtime-deps.tokens";

// ★ 2026-05-04 (PR-6 standardize consumer): jaccardSimilarity 从
//   ai-app/{app} 上提到 engine/content（纯 token-set 文本相似度，
//   无 agent/mission 状态，跨 ai-app 可复用）
export { jaccardSimilarity } from "../content/text-similarity.util";

// ★ 2026-05-04 (PR-10b standardize consumer): JSON-fence 解析基元从
//   ai-app/{app}/services/chat 上提到 engine/content
//   （LLM 输出 → 结构化决策的通用 fence parser，零业务 DSL；
//   consumer LeaderDecision DSL 仍留 app 作为 caller-side wrapper）
export {
  parseJsonFence,
  extractJsonFenceContent,
  type JsonFenceParseResult,
} from "../content/json-fence-parser.util";

// ★ PR-A1 (2026-05-06 v1.4 报告装配重构):
//   MarkdownSanitizer — 状态机 fence 配对 / H2 精确剥离 / TOC 移除 /
//   blockquote fence 修复 / CRLF 归一 / BOM 剥除 / thinking 整块剥 /
//   prompt injection redaction（18 fixture 全覆盖）
//   任何输出 markdown 的 stage 都可复用（business-agnostic）。
//
//   注意：SanitizeOptions / SanitizeResult 与 safety/security/llm-injection 同名，
//   故重命名为 MarkdownSanitize* 暴露
export { sanitizeMarkdownBody } from "../content/markdown/markdown-sanitizer.util";
export {
  MARKDOWN_SANITIZER_VERSION,
  InputTooLargeError as MarkdownSanitizerInputTooLargeError,
  SanitizerAbortedError as MarkdownSanitizerAbortedError,
  type SanitizeOptions as MarkdownSanitizeOptions,
  type SanitizeResult as MarkdownSanitizeResult,
  type SanitizeRule as MarkdownSanitizeRule,
  type SanitizeRuleApplied as MarkdownSanitizeRuleApplied,
} from "../content/markdown/markdown-sanitizer.types";
// ★ PR-A8 (2026-05-07): sanitizer 监控聚合器（in-memory，admin metrics endpoint 拉 snapshot）
export {
  SanitizerMetricsService,
  type SanitizerMetricSnapshot,
} from "../content/markdown/sanitizer-metrics.service";

// ★ P0a-1 (2026-05-09, llm wiki v1.5.3 §3.1+§4.4+§10): wiki-link 与 slug 规范化基元
//   - parseMarkdownWikiLinks: 抽 [[slug]] 引用（跳过代码块/行内代码/HTML 注释/转义）
//   - normalizeMarkdownSlug:  title → kebab-case ASCII slug（NFKD + 变音符剥除 + 200 长度上限）
//   两者纯函数，business-agnostic；wiki/writing/research/office 跨引用解析复用。
export { parseMarkdownWikiLinks } from "../content/markdown/wiki-link-parser.util";
export { normalizeMarkdownSlug } from "../content/markdown/slug-normalize.util";

/**
 * Minimal interface matching MCPManager for ai-engine internal use.
 * ai-engine executor/capability files inject MCPManager at runtime via harness DI;
 * this interface avoids a direct ai-engine → ai-harness type import.
 */
/**
 * Minimal interface for legacy AgentRegistry used by ai-engine executor internals.
 * ai-engine executors inject AgentRegistry at runtime via harness DI;
 * this interface avoids a direct ai-engine → ai-harness type import.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface IAgentRegistryCompat {
  tryGet(agentId: string): any;
  getAll(): any[];
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface IMCPProvider {
  getClient(serverId: string):
    | {
        connected?: boolean;
        listTools(): Promise<
          Array<{ name: string; description?: string; inputSchema?: unknown }>
        >;
        getServerInfo?(): { name: string; version: string } | undefined;
      }
    | undefined;
  getAllClients(): Array<unknown>;
  getConnectedServers?(): Array<{
    serverId: string;
    serverName: string;
    tools: unknown[];
  }>;
  callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{
    content: Array<{ text?: string; data?: string }>;
    isError?: boolean;
  }>;
}

/**
 * Minimal interface matching ChatFacade.chat() for ai-engine internal use.
 * ai-engine cannot import ChatFacade directly (would violate unidirectional dependency).
 * Internal services that need LLM access should use AiChatService; runtime adapters
 * that need harness chat access should inject CHAT_PROVIDER_PORT.
 */
export interface IChatProvider {
  chat(request: {
    messages: Array<{ role: string; content: string }>;
    modelType?: import("@prisma/client").AIModelType;
    taskProfile?: import("../llm/types").TaskProfile;
    model?: string;
    maxTokens?: number;
    temperature?: number;
    skipGuardrails?: boolean;
    /** LLM Function Calling: tool schemas to expose to the model */
    tools?: import("../tools/abstractions/tool.interface").FunctionDefinition[];
    [key: string]: unknown;
  }): Promise<{
    content: string;
    model: string;
    tokensUsed: number;
    inputTokens?: number;
    outputTokens?: number;
    finishReason?: string;
    /** LLM Function Calling: tool call requests returned by the model */
    toolCalls?: Array<{
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }>;
    [key: string]: unknown;
  }>;
}

// ★ Engine internal types used across AI App modules
export type { SaveEvidenceRequest } from "../knowledge/evidence/abstractions/evidence.interface";
// AICapabilityContext / SkillPromptBundle / SkillPromptOptions / UserIntent
// 已移至 @/modules/ai-harness/facade（属于 L2.5 execution 层，2026-05-01 PR-X-L 修反向依赖）
export type { SkillMdDefinition } from "../skills/types/skill-md.types";
export type { EmbeddingResult } from "@/modules/ai-engine/rag/embedding";
export type {
  SimilaritySearchOptions,
  SimilarityResult,
} from "@/modules/ai-engine/rag/vector/vector.service";

// ★ Registry classes — engine-owned registries only
export { ToolRegistry } from "../tools/registry/tool.registry";
export { SkillRegistry } from "../skills/registry/skill.registry";
// Shared HITL approval DB primitive (HumanApprovalTool + self-driven gate delegate).
export {
  HumanApprovalPrimitiveService,
  approvalRequestKey,
  approvalResponseKey,
} from "../tools/categories/collaboration/human-approval-primitive.service";
export type {
  ApprovalPollResult,
  ApprovalResponseData,
} from "../tools/categories/collaboration/human-approval-primitive.service";

// ★ 2026-06-02: 通用语义打分路由 core（LLM/Tools/Skills 共用）
export { ScoredRouterService } from "../routing/scored-router.service";
export { defaultScorers } from "../routing/signal-scorers";
export type {
  RoutableCandidate,
  RouteQuery,
  RouteResult,
  RouteScore,
  SignalScorer,
  CandidateSignals,
} from "../routing/abstractions/routing.types";

// ★ P17a (2026-05-24): 通用 ContentSource 契约 + Registry
//   任何 ai-app 暴露内容源都实现 ContentSource、注册到 ContentSourceRegistry。
//   consumer (ai-app/social / 未来其他 app) 注入 ContentSourceRegistry，
//   不直接 import 兄弟 ai-app 模块。
export {
  ContentSourceRegistry,
  ContentSourceProvider,
  CONTENT_SOURCE_TOKEN,
  CONTENT_SOURCE_METADATA,
  type ContentSource,
  type ContentSourceDescriptor,
  type SourceItem,
  type SourceListFilter,
  type SourceListResult,
  type SourceContentBundle,
} from "../content/sources";

// ★ Social publish port — ai-app/social 实现端口的反转入口
//   ai-engine 不依赖任何 social 实现；token + 接口在此暴露，
//   ai-app/social/engine-bridge 提供绑定。详见 abstractions/social-publish.port.ts
export {
  SOCIAL_PUBLISH_PORT,
  type SocialPublishPort,
  type SocialPublishContext,
  type SocialPlatform,
  type PublishJobStatus,
  type PublishJobReceipt,
  type PublishStatusSnapshot,
  type WechatMpPublishInput,
  type XhsPublishInput,
} from "../tools/categories/integration/abstractions";

// ★ High-frequency types used across AI App modules
export type {
  TaskProfile,
  CreativityLevel,
  OutputLengthLevel,
  ReasoningDepth,
  ContentPart,
  TextContentPart,
  ImageUrlContentPart,
} from "../llm/types";

// Model classification by id pattern (STRONG/STANDARD/BASIC) — cross-app utility
export {
  classifyModelTier,
  ModelTier,
} from "@/modules/ai-engine/llm/types/model-tier.types";

// ★ Stream timing types (for TTFT/TTLT tracking)
export type {
  StreamTiming,
  StreamChunk,
} from "@/modules/ai-engine/llm/chat/ai-stream-handler.service";

// TaskPlan / IntentRouter / TaskPlanner 已删 (2026-04-30) — 死代码
export type {
  ToolContext,
  ITool,
  JSONSchema,
} from "../tools/abstractions/tool.interface";

// ★ Built-in tool IDs (W2 2026-05-16 — ai-app/social 调 BrowserContextTool 需要)
export { BUILTIN_TOOLS } from "../tools/abstractions/tool.interface";

// ★ Batch 1 supplemental exports

// Orchestration services
export { ContextCompressionService } from "../planning/context/context-compression.service";
// 2026-05-01 (PR-X-L): 以下 type / class 都属于 L2.5 ai-harness/runner，
// 已下沉为 ai-harness/facade 直接导出，engine facade 不再 re-export 走反向依赖：
//   - DataChunk / SummaryChunk / CompressionResult / CompressionOptions
//   - ContextStrategy
//   - ConstraintSeverity / ExtractedConstraint / ConstraintViolation
//     / OutputValidationResult / AiCallerFn / ReviewRequest / ReviewResult / ReviewCriteria
//   - EstablishedFact / ExecutionConfig
//   - FactExtractionRequest / FactExtractionResult / ContextEvolutionConfig
// ai-app 改从 @/modules/ai-harness/facade 引入这些符号。

// ContextBudgetCalculator (formerly TokenBudgetService) 是 engine 自有（planning/budget/），
// 修复原 reverse path（engine→harness→engine 绕一圈）为直接 engine 自身
export { ContextBudgetCalculator } from "../planning/budget/token-budget.service";
/** @deprecated use ContextBudgetCalculator */
export { ContextBudgetCalculator as TokenBudgetCalculatorService } from "../planning/budget/token-budget.service";
export type {
  ModelConfig as TokenBudgetModelConfig,
  TokenBudget,
  ContentPriority,
  BudgetAllocation,
} from "../planning/budget/token-budget.service";
// OutputReviewerService 已搬到 ai-harness/evaluation/critique/ (2026-05-02)
export { ContextEvolutionService } from "../knowledge/extraction/context-evolution.service";
// AgentExecutorService 已搬到 ai-harness/runner/executor/ (2026-04-30)
export { ContextInitializationService } from "../knowledge/world-building/context-initialization.service";
// Entity Resolution（实体消歧，多模块复用）
export { EntityResolutionService } from "../knowledge/entity-resolution/entity-resolution.service";
export type {
  EntityResolutionOptions,
  EntityCluster,
  EntityResolutionResult,
} from "../knowledge/entity-resolution/entity-resolution.service";
// TaskDecomposerService 已删 (2026-04-30) — 死代码
export { ModelFallbackService } from "../llm/models/selection/model-fallback.service";

// Content feature types
export {
  ContentComplexity,
  ContentCategory,
  DataDensity,
  TemporalDimension,
  HierarchyType,
} from "../content/types/content-features.types";
export type {
  ContentFeatures,
  ExtractedEntity,
  VisualizationOpportunity,
  ParagraphFeatures,
  SectionFeatures,
} from "../content/types/content-features.types";

// Content-fetch tokens & utilities
export { YOUTUBE_SERVICE_TOKEN } from "../content/fetch/content-fetch.service";
export {
  sanitizeForDb,
  sanitizeJson,
  stripScrapedArtifacts,
} from "../content/fetch/content-fetch.types";

// LLM Adapter
export { FunctionCallingLLMAdapter } from "../llm/adapters/function-calling-llm.adapter";

// Image generation interface & tokens
export {
  IMAGE_GENERATION_SERVICE,
  TTS_SERVICE,
} from "../tools/abstractions/generation-services.interface";
export type { IImageGenerationService } from "../tools/abstractions/generation-services.interface";
export { IMAGE_GENERATION_SERVICE_TOKEN } from "@/modules/ai-engine/content/abstractions/image.interface";
export type { IRAGPipelineService } from "@/modules/ai-engine/rag/abstractions/rag.interface";
export { RAG_PIPELINE_SERVICE_TOKEN } from "@/modules/ai-engine/rag/abstractions/rag.interface";
// KB-query augmentor port type — consumed by ai-app/library/kb-query service layer
export type { WikiPageRead } from "../rag/abstractions/kb-query-augmentor.interface";

// LLM model fallback types
export type { ModelFallbackOptions } from "../llm/models/selection/model-fallback.service";
export { AiModelConfigService } from "@/modules/ai-engine/llm/models/config/ai-model-config.service";
export type { AIModelConfig } from "@/modules/ai-engine/llm/models/config/ai-model-config.service";

// 2026-05-29 open-api facade 收口：以下服务此前被 open-api 控制器直接穿透
// 内部路径访问，统一从 engine facade 暴露（见 .eslintrc.js open-api 边界规则）。
export { SystemModelInventoryService } from "../llm/models/catalog/system-model-inventory.service";
export { SkillAnalyticsService } from "../skills/analytics/skill-analytics.service";
export { MCPClientRegistryService } from "../tools/adapters/mcp/registry/mcp-client-registry.service";
// 注：ModelRecommendationsService 已在本文件下方（约 412 行）导出，勿重复。

// TeamMemberInfo 是 L2.5 ai-harness/runner 类型，2026-05-01 PR-X-M2 下沉为
// ai-harness/facade export，engine 不再 re-export

// Error detection utilities
export type { ErrorDetectionRetryConfig } from "@/modules/ai-engine/reliability/error-detection.utils";
export {
  DEFAULT_RETRY_CONFIG,
  isRetryableError,
  isRateLimitError,
  isPermanentError,
  withRetry,
  calculateBackoffDelay,
  sleep,
  isApiErrorContent,
  parseErrorType,
} from "@/modules/ai-engine/reliability/error-detection.utils";

// Skills interfaces
export type { ISkillOutputManager } from "../skills/output-manager/skill-output-manager.interface";
export { createSkillOutputManager } from "../skills/output-manager/skill-output-manager";
export type {
  ISkill,
  SkillContext,
  SkillResult,
  SkillPermissions,
  SkillLayer,
  SkillResultError,
  SkillResultMetadata,
  SkillDefinition,
  SkillConfig,
} from "../skills/abstractions/skill.interface";
export { SKILL_LAYERS } from "../skills/abstractions/skill.interface";

// Image matching types
export type {
  ImageMatchingRule,
  ImageRequirement,
} from "../content/types/image-matching.types";
export {
  ImageType,
  ImagePlacement,
  IMAGE_MATCHING_RULES,
} from "../content/types/image-matching.types";

// Content fetching (URL → markdown/transcript) — used by ai-app/library/document/preparse
// for W1 预解析管线（YouTube transcript / 网页正文 / SSRF guard 一体化）
//
// Re-export directly from concrete files (NOT the `./content/fetch` barrel)
// — the barrel's first export is `ContentFetchModule`, and when ai-app code
// goes `import { ContentFetchService } from ".../facade"` during a parent
// module's decorator evaluation, the barrel forces ContentFetchModule's
// own `@Module({ imports: [ContentProcessingModule, ...] })` decorator to
// run. Under the prod CJS load order (AppModule → AdminModule → AiEngineModule)
// `ContentProcessingModule` is still mid-evaluation, so `imports[0]` lands
// as `undefined` and Nest bootstrap crashes (incident 2026-05-12).
export { ContentFetchService } from "@/modules/ai-engine/content/fetch/content-fetch.service";
export type { FetchedContent } from "@/modules/ai-engine/content/fetch/content-fetch.types";

// RAG types & services
export { EmbeddingService } from "@/modules/ai-engine/rag/embedding";
export type {
  EmbeddingModelConfig,
  EmbeddingBatch,
} from "@/modules/ai-engine/rag/embedding";
export { VectorService } from "@/modules/ai-engine/rag/vector";
export type { VectorSearchResult } from "@/modules/ai-engine/rag/vector";
export { DocumentChunker } from "@/modules/ai-engine/rag/chunking";
export type {
  ChunkingConfig,
  ChildChunkData,
  ParentChunkData,
  ChunkedDocument,
} from "@/modules/ai-engine/rag/chunking";
export { DEFAULT_CHUNKING_CONFIG } from "@/modules/ai-engine/rag/chunking";
export { RAGPipelineService } from "@/modules/ai-engine/rag/pipeline";
export type {
  RAGQuery,
  RAGOptions,
  RAGResponse,
  RAGContext,
  ContextSource,
  SearchResult,
  HybridSearchParams,
  ProcessedDocument,
  DocumentMetadata,
  KnowledgeBaseStats,
  SyncResult,
  GoogleDriveFile,
} from "@/modules/ai-engine/rag/pipeline/rag-pipeline.interface";

// Policy research tools
export {
  FederalRegisterTool,
  CongressGovTool,
  WhiteHouseNewsTool,
  PolicyDataService,
} from "../tools/categories/information/policy";

// ★ Batch 2 — Core services
export { AiChatService } from "@/modules/ai-engine/llm/chat/ai-chat.service";
export type {
  ChatObserver,
  ChatObserverEvent,
  ChatOptions,
  ChatResult,
} from "@/modules/ai-engine/llm/chat/ai-chat.service";
export type { ChatMessage } from "../llm/types";
export {
  inferIsReasoning,
  getKnownModelLimit,
} from "@/modules/ai-engine/llm/types/model.utils";

// ★ Model Election
export { ModelElectionService } from "../llm/models/selection";
// ★ Model Recommendations (DB + 默认推荐合并)
export { ModelRecommendationsService } from "../llm/models/selection";
export {
  NoEligibleModelError,
  type ElectionCandidate,
  type ElectionRequest,
  type ElectionResult,
  type ElectionRoleHint,
  type ElectionScore,
  type ElectionCostBias,
} from "../llm/models/selection";
// MissionElectionTracker / MissionElectionReservation relocated to ai-harness
// (mission state is L2.5) — import them from '@/modules/ai-harness/facade'.
export { SearchService } from "../content/web-search/web-search.service";
export { SkillLoaderService } from "../skills/loader/loading/skill-loader.service";
// P9c (2026-05-24): SKILL.md loader 上提自首个 ai-app(@migrated-from utils/),通用 Anthropic skill 标准格式 loader + duty 模板渲染。
// 各 app 通过自身 shim 注入 agentsRootDir(各 app __dirname 推算),保持 callers 二元 API 不变。
export {
  loadSkill,
  clearSkillCache,
  parseSkill,
  type ParsedSkill,
  type SkillFrontmatter,
} from "../skills/loader/skill-md/skill-md-loader";
export { buildPromptFromDuty } from "../skills/loader/skill-md/duty-loader";
export { SkillContentService } from "../skills/content/skill-content.service";
export type {
  SkillVersionRecord,
  FullSkillDefinition,
} from "../skills/content/skill-content.service";
export { SkillSandboxService } from "../skills/sandbox/skill-sandbox.service";
export { MultiKeyRegistry } from "@/modules/platform/credentials/governance/key-health/multi-key.manager";
export type { KeyHealthStatus } from "@/modules/platform/credentials/governance/key-health/multi-key.manager";
// AICapabilityResolver 是 L2.5 ai-harness/runner 服务，2026-05-01 PR-X-M2
// 下沉为 ai-harness/facade export
// IntentRouterService / RouteResult / AgentContext 已删 (2026-04-30) — 死代码

// ★ Batch 2 — Safety
export { GuardrailsPipelineService } from "../safety/guardrails/guardrails-pipeline.service";
export type {
  GuardrailInput,
  GuardrailOutput,
  GuardrailsPipelineResult,
} from "../safety/guardrails/guardrails.interface";

// ★ Content services
// ImageMatchingService / ImagePrompt / ImageMatchingResult 已随死代码清理移除
// （运行时零注入）。matching 仅保留 types，由本 index 上方直接 export（见 ImageType 等）。

// ★ 沉淀（2026-04-29）: figure 抽取（来自 {app}, TI 暂不切换）
export {
  FigureExtractorService,
  FigureRelevanceService,
  type ExtractedFigure,
  type FigureRelevanceConfig,
} from "../content/figure";

// ★ 沉淀（2026-04-29）: LLM 注入防御三件套（OWASP LLM01）
export {
  createSecurityLogger,
  SecurityAuditLogger,
  SecurityEventType,
  SecuritySeverity,
  type SecurityLogEntry,
  sanitize,
  sanitizePromptInput,
  sanitizeExternalContent,
  containsDangerousContent,
  escapeForPrompt,
  type SanitizeOptions,
  type SanitizeResult,
  wrapExternalContent,
  wrapExternalContentBatch,
  getExternalContentNotice,
  type WrapExternalContentOptions,
} from "../safety/security/llm-injection";

// ★ 沉淀（2026-04-29）: LLM Reranker（来自 {app}, 用 AiChatService 内层调用）
export {
  LlmRerankerAdapter,
  type RerankableItem,
  type RerankCandidate,
  type RerankedItem,
  type RerankResult,
  type RerankRequest,
  type RerankAdapter,
  type RerankConfig,
  DEFAULT_RERANK_CONFIG,
} from "../knowledge/rerank";

// ★ 沉淀（2026-04-29）: LLM 输出后处理（白名单清理 + 13 个正交修复函数）
export {
  sanitizeSectionOutput,
  stripLeadingBulletLists,
  stripAnalyticalInlineBullets,
  stripSectionOpeningShortLines,
  stripCitationStacking,
  replaceMarketingLanguage,
  repairBrokenBoldPairs,
  normalizeTransitionHeadings,
  normalizeBoldStyle,
  convertOrdinalBulletsToParagraphs,
  fixOrdinalBoldPosition,
  convertLongListItemsToParagraphs,
  removeOrphanCitations,
  // ★ 沉淀（2026-04-29）: 图表 JSON 块清理（LLM 泄漏 metadata 修复）
  stripChartJsonFromContent,
  extractMarkdownFromJsonString,
} from "../llm/output/sanitization";

// ★ 沉淀（2026-04-29）: figure URL 有效性校验
export { isValidFigureUrl } from "../content/figure/figure-url-sanitizer.util";

// ★ 沉淀（2026-04-29）: Report Template — 13 类格式化标准（沉淀自 ai-app/contracts/report-template）
export * from "../content/report-template";

// ★ 沉淀（2026-04-29）: 引用工具（纯 utility，零 DI）
export {
  type CitationWithContext,
  type EvidenceFingerprint,
  type CitationVerifyResult,
  type VerificationStats,
  type VerifyCitationsResult,
  type EvidenceForVerification,
  type LocalToGlobalMap,
  extractCitationsWithContext,
  buildEvidenceFingerprint,
  scoreCitationMatch,
  verifyCitations,
  buildContiguousMapping,
  restoreGlobalIndices,
  // ★ Phase 9 沉淀 (2026-04-29): 5 种学术引用格式
  type CitationStyle,
  type SourceCategory as CitationSourceCategory,
  type CitationAuthor,
  type CitationMetadata,
  type FormattedCitation,
  type Bibliography,
  type RawEvidence as CitationRawEvidence,
  buildCitationMetadata,
  formatCitation,
  generateBibliography,
} from "../content/citation";

// ★ Phase 7: Content engine abstractions
export type {
  ILongContentEngine,
  IContinuationProtocol,
  IReportSynthesisEngine,
} from "../content/abstractions/content-engine.interface";

// Agent types

// Common types
export type {
  JsonObject,
  JsonValue,
  ValidationResult,
  ValidationIssue,
  ExecutionResult,
  ExecutionMetadata,
  ExecutionError,
  BaseContext,
  RetryConfig,
  TimeoutConfig,
  PaginationParams,
  PaginatedResult,
  DeepPartial,
  Nullable,
  Optional,
  MaybePromise,
} from "@/modules/ai-engine/facade/abstractions/common.types";

export { EngineExecutionMode } from "@/modules/ai-engine/facade/abstractions/common.types";

export {
  EngineError,
  ValidationError,
  TimeoutError,
  CancelledError,
  NotFoundError,
  RetryExhaustedError,
  PreconditionError,
  DependencyError,
  RateLimitError,
} from "./abstractions/engine.error";

export {
  CommonErrorCode,
  ToolErrorCode,
  SkillErrorCode,
  AgentErrorCode,
} from "./abstractions/error-codes.constants";

export {
  type IRegisterable,
  type IRegistry,
  BaseRegistry,
  type RegistryStats,
} from "./abstractions/registry.interface";

export { type IExecutable } from "./abstractions/executable.interface";

export { ToolError } from "../tools/abstractions/tool.error";
export { SkillError } from "../skills/abstractions/skill.error";

// Orchestrator abstractions — 2026-05-01 PR-X-M2: 16 个类型下沉到 ai-harness/facade
// 因为 orchestrator.interface 是 L2.5 ai-harness 概念，engine facade 不
// 再 re-export。ai-app 已改 from "@/modules/ai-harness/facade" 引入。

// Workflow Handlers / Executors —— 2026-04-30 (C2-step2) 删除死代码:
//   - WorkflowHandlerRegistry / WorkflowNodeHandler / MapStepConfig (仅被 BaseExecutor 用，BaseExecutor 死)
//   - DAGExecutor (engine 728行重型版，被 ai-harness/runner/dag/ 165行轻量版取代)
//   保留: FunctionCallingExecutor (从 ai-engine/index.ts 单独 export)

// IConstraintEnforcementService 已下沉为 ai-harness/facade export (PR-X-M2)

// Memory abstractions 已移除（2026-04-30）—— Memory 整体迁到 ai-harness/memory，
// 请从 "@/modules/ai-harness/memory/abstractions/memory.interface" 或
// "@/modules/ai-harness/facade" 导入 IMemoryStore / MemoryEntry 等类型。
// engine facade 不能 re-export ai-harness 类型（ESLint 单向依赖规则）。

// ★ Image Search tool types
export type {
  ImageSearchInput,
  ImageSearchResult,
  ImageSearchOutput,
} from "../tools/categories/information/image-search/image-search.types";

// QueryLoopService / TokenTrackerService 已下沉为 ai-harness/facade export (PR-X-M2)

// 2026-05-01 (PR-X-L): ContextCompactionPipelineService 是 engine 自有，从源头直接 import
export {
  ContextCompactionPipelineService,
  type CompactionConfig,
  type CompactionResult,
  type CompactionLevel,
} from "../planning/context/context-compaction-pipeline.service";

// ExecutionCheckpointService 是 L2.5 ai-harness/runner 概念，
// 已下沉为 ai-harness/facade 直接 export，engine facade 不再 re-export

// AdaptiveReplannerService / ReplanTrigger / ... 已搬到 ai-harness (2026-04-30)
//   消费方改 import "@/modules/ai-harness/facade"

// ★ Phase 3: Tool Concurrency
export { ToolConcurrencyService } from "../tools/concurrency/tool-concurrency.service";
export type {
  ConcurrencyMetadata,
  ExecutionPartition,
} from "../tools/concurrency/tool-concurrency.service";

// ★ Phase 8 沉淀 (2026-04-29): Search 多源融合 + 质量门通用工具
export {
  type IndexedItem,
  normalizeUrl,
  dedupeByUrlAndTitle,
  tokenizeQuery,
  computeRelevanceScore,
  extractDomain as extractSearchDomain,
  enforceDomainDiversity,
  type SuggestedSearchAction,
  type QualityGateInput,
  type QualityGateContext,
  type QualityGateItem,
  type QualityVerdict,
  evaluateSearchQuality,
} from "../tools/search-fusion";

// SessionMemorySidecarService 已下沉为 ai-harness/facade export (PR-X-M2)

// ★ Phase 10: Coordinator Synthesize-Before-Delegate
export { CrossCuttingSynthesisService } from "../knowledge/synthesis/cross-cutting-synthesis.service";
export type {
  DimensionResult,
  CrossCuttingTheme,
  Contradiction,
  ResearchGap,
  SynthesisResult,
  // v1.5.3 P0a-3: low-level detect API types (shared with wiki-lint)
  SynthesisDocument,
  DataGap,
} from "../knowledge/synthesis/cross-cutting-synthesis.service";

// ★ v1.5.3 P0a-3: LLM Wiki STALE detection primitive (also reusable for
// research/writing "this citation may be outdated" warnings)
export { StaleDetectorService } from "../knowledge/consistency/stale-detector.service";
export type {
  StaleSourceEntry,
  StaleResult,
  DetectStaleOptions,
} from "../knowledge/consistency/stale-detector.service";

// ★ Phase 5: Prompt Cache Coordination
export { PromptCacheCoordinatorService } from "@/modules/ai-engine/llm/chat/prompt-cache-coordinator.service";
export type { CachePrefix } from "@/modules/ai-engine/llm/chat/prompt-cache-coordinator.service";

// ★ Phase 9: Background Autonomous Agents
//   2026-04-30 (C2-step1): AutoDream 已搬到 ai-harness/memory/consolidation/，
//   ai-app 调用方应改 from "@/modules/ai-harness/facade"

// ════════════════════════════════════════════════════════════════════
// Safety / Resilience / Security （PR-X15: engine 公开 API barrel
// 供 ai-harness/facade 转发，避免 harness 穿透 engine 私有路径）
// ════════════════════════════════════════════════════════════════════
export {
  EntityHealthRegistry,
  TaskCompletionType,
} from "../reliability/entity-health/entity-health.registry";
export type {
  CircuitState,
  CircuitBreakerConfig,
  HealthMetrics,
} from "../reliability/entity-health/entity-health.registry";
export {
  RateLimitService,
  RateLimitedError,
} from "../reliability/rate-limit/rate-limit.service";
export type {
  RateLimitConfig as EngineRateLimitConfig,
  RateLimitCheckResult,
} from "../reliability/rate-limit/rate-limit.service";
// CapabilityGuardService / CapabilityCheckResult 已迁 ai-harness/guardrails/capability（W2，律4）
// SSRF / 出站防护(platform-review wave1)：项目唯一统一出站闸门，ai-app / open-api 经此复用
export {
  assertUrlSafe,
  isBlockedIp,
  safeFetch,
} from "../safety/security/ssrf/ssrf-guard";
export type { AssertUrlSafeOptions } from "../safety/security/ssrf/ssrf-guard";

// ════════════════════════════════════════════════════════════════════
// LLM Error Classification (PR-X28: lifted from common/ai-orchestration)
// ════════════════════════════════════════════════════════════════════
export {
  AIError,
  AIErrorType,
  AIErrorClassifier,
} from "../llm/abstractions/error-classifier";

// ════════════════════════════════════════════════════════════════════
// BYOK / Credentials — 2026-06-02: 迁入 ai-engine（AI 专属：LLM 供应商/模型
// 密钥解析 + user-model-configs + BYOK 调度）。从本 facade 直接暴露。
//   消费方（ai-app/byok controllers、open-api/admin）从 "@/modules/ai-engine/facade" 导入。
// ════════════════════════════════════════════════════════════════════
export {
  ToolKeyResolverService,
  NoToolKeyError,
} from "@/modules/platform/credentials/resolution/tool-key-resolver/tool-key-resolver.service";
export type {
  ResolvedToolKey,
  ToolKeySource,
} from "@/modules/platform/credentials/resolution/tool-key-resolver/tool-key-resolver.service";
export { UserSecretsService } from "@/modules/platform/credentials/user-owned/user-secrets/user-secrets.service";
// NOTE: credential-management surfaces (ai-app/byok, open-api/admin/byok) import
// credential *services* (AuthorizationService / UserToolsService / KeyAssignments
// etc.) directly from source, NOT via this barrel — adding heavy credential
// services here bloats the facade barrel and triggers circular-load failures in
// unrelated consumers (e.g. orchestrator specs: "undefined reading 'SEARCH'").
// Those surfaces are eslint/ facade-boundary exempted instead.
export { KeyAssignmentsService } from "@/modules/platform/credentials/governance/key-assignments/key-assignments.service";
export { KeyRequestsService } from "@/modules/platform/credentials/governance/key-requests/key-requests.service";
export { UserApiKeysService } from "@/modules/platform/credentials/user-owned/user-api-keys/user-api-keys.service";
export { KeyResolverService } from "@/modules/platform/credentials/resolution/key-resolver/key-resolver.service";
export { NoAvailableKeyError } from "@/modules/platform/credentials/resolution/key-resolver/key-resolver.errors";
export type {
  ResolvedKey,
  KeyChain,
  KeySource,
} from "@/modules/platform/credentials/resolution/key-resolver/key-resolver.service";
export { ByokMaintenanceScheduler } from "@/modules/platform/credentials/governance/scheduling/byok-maintenance.scheduler";
export { UserModelConfigsService } from "@/modules/platform/credentials/user-owned/user-model-configs/user-model-configs.service";
export { AiModelDiscoveryService } from "@/modules/ai-engine/llm/models/catalog/ai-model-discovery.service";
export { ModelTypeService } from "@/modules/ai-engine/llm/models/catalog/model-type.service";
export { ApiFormatService } from "@/modules/ai-engine/llm/models/catalog/api-format.service";
export { AiProviderService } from "@/modules/ai-engine/llm/models/catalog/ai-provider.service";
export type { ModelTypeInput } from "@/modules/ai-engine/llm/models/catalog/model-type.service";
export { AiConnectionTestService } from "@/modules/ai-engine/llm/byok/ai-connection-test.service";
export { AutoConfigureService } from "@/modules/ai-engine/llm/byok/user-models-auto-configure.service";

// ════════════════════════════════════════════════════════════════════
// v3.1 阶段 B 子片 2 — capability_overrides 写入面（admin / BYOK / self-heal）
//
// admin（open-api/admin）与 BYOK（ai-app/byok）控制器通过 facade 注入
// CapabilityOverridesWriterService 调 applyOverrideTransactional；
// self-heal 服务由 ai-engine/llm/services 内部自用，**不** export
// （它是写入决策器而非写入入口，外部不应直接触发）。
//
// 仅写入入口 + 必要类型对外暴露：parser / model-capability types 不出 facade
// （v3.1 §3.6 SSOT：ai-app 永不读 caps）。
// ════════════════════════════════════════════════════════════════════
export { CapabilityOverridesWriterService } from "@/modules/ai-engine/llm/models/capability/capability-overrides-writer.service";
export type {
  ApplyOverrideOptions as CapabilityApplyOverrideOptions,
  ApplyOverrideResult as CapabilityApplyOverrideResult,
  CapabilityOverrideScope,
  CapabilityOverrideSource,
  CapabilityOverrideActor,
  CapabilityOverrideTarget,
} from "@/modules/ai-engine/llm/models/capability/capability-overrides-writer.types";
export type { ModelCapabilitiesOverrides } from "@/modules/ai-engine/llm/models/capability/model-capability.types";
// DTOs for admin (open-api/admin) + BYOK (ai-app/byok) controllers
export {
  ApplyCapabilityOverridesDto,
  DeleteCapabilityOverridesDto,
} from "@/modules/ai-engine/llm/models/capability/dto/apply-capability-overrides.dto";
