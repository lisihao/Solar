/**
 * Search Pipeline — Barrel Exports
 *
 * Modular search pipeline that replaces the fetchDataForDimension() flow.
 * Entry point: SearchOrchestratorService.search()
 */

// Core
export { SearchOrchestratorService } from "./search-orchestrator.service";
export { GlobalSourceThrottleService } from "./global-source-throttle.service";
export { SearchExecutorService } from "./search-executor.service";

// Query
export { QueryStrategyService } from "./query";

// Fusion
export { ResultFusionService, SearchFusionQualityGateService } from "./fusion";

// Rerank（引擎版权威，W1 去重：本地副本已删，统一消费 ai-engine/knowledge/rerank）
export { LlmRerankerAdapter } from "@/modules/ai-engine/facade";
export type {
  RerankAdapter,
  RerankCandidate,
  RerankRequest,
  RerankedItem,
  RerankConfig,
} from "@/modules/ai-engine/facade";

// Adapters
export {
  WebSearchAdapter,
  AcademicSearchAdapter,
  GithubSearchAdapter,
  HackernewsSearchAdapter,
  SocialSearchAdapter,
  PolicySearchAdapter,
  FinanceSearchAdapter,
  WeatherSearchAdapter,
  LocalSearchAdapter,
  IndustryReportSearchAdapter,
  SearchAdapterBase,
} from "./adapters";

// Types
export * from "./search.types";
