/**
 * Search Module Types
 *
 * Core type definitions for the modular search pipeline.
 * Reuses existing DataSourceType / DataSourceResult from data-source.types.
 */

import type {
  DataSourceType,
  DataSourceResult,
} from "../../types/data-source.types";
import type { RerankConfig } from "@/modules/ai-engine/facade";

// ============================================================================
// Adapter Interface
// ============================================================================

/** Search adapter — one per data source category */
export interface ISearchAdapter {
  /** Unique source identifier (used as throttle key) */
  readonly sourceId: string;
  /** Primary DataSourceType this adapter handles */
  readonly sourceType: DataSourceType;
  /** Additional DataSourceTypes this adapter handles (e.g. policy → 3 sub-types) */
  readonly additionalTypes?: DataSourceType[];
  /** Global concurrency limit for this source */
  readonly concurrency: number;
  /** Default timeout per search call (ms) */
  readonly defaultTimeoutMs: number;

  /** Execute a search */
  search(request: AdapterSearchRequest): Promise<AdapterSearchResult>;

  /** Format a base query for this specific source */
  formatQuery(baseQuery: string, context?: QueryContext): string;

  /** Check if this adapter is operational */
  isAvailable(): Promise<boolean>;
}

/** Request to an adapter */
export interface AdapterSearchRequest {
  query: string;
  maxResults: number;
  since?: Date;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Adapter-specific metadata (e.g. topic config for local search) */
  metadata?: Record<string, unknown>;
}

/** Result from an adapter */
export interface AdapterSearchResult {
  items: DataSourceResult[];
  sourceMetrics: SourceMetrics;
}

/** Per-source execution metrics */
export interface SourceMetrics {
  sourceId: string;
  durationMs: number;
  queryUsed: string;
  totalAvailable?: number;
  error?: string;
  throttleWaitMs?: number;
}

// ============================================================================
// Query Strategy
// ============================================================================

/** Source-aware queries — different queries for different sources */
export interface SourceAwareQueries {
  /** Base English queries (translated from original) */
  baseQueries: string[];
  /** Per-source specialized queries (sourceType → queries) */
  sourceSpecific: Map<DataSourceType, string[]>;
  /** Detected language of original queries */
  language: "en" | "zh" | "mixed";
}

/** Context for query formatting */
export interface QueryContext {
  topicName: string;
  dimensionName: string;
  dimensionDescription?: string;
  freshness?: "recent" | "standard" | "archival";
}

// ============================================================================
// Quality Gate
// ============================================================================

/** Quality gate verdict */
export interface QualityVerdict {
  /** Whether results are sufficient for report writing */
  sufficient: boolean;
  /** Identified quality gaps */
  gaps: string[];
  /** Suggested remedial actions */
  suggestedActions: SuggestedAction[];
}

export type SuggestedAction =
  | "add_web_fallback"
  | "broaden_query"
  | "add_academic_source"
  | "retry_failed_sources"
  | "extend_time_range";

// ============================================================================
// Throttle
// ============================================================================

/** Per-source throttle stats (for monitoring) */
export interface ThrottleStats {
  sourceId: string;
  concurrency: number;
  activeCount: number;
  pendingCount: number;
  /** 速率上限（req/s）；undefined 表示该 source 不限速 */
  reqPerSec?: number;
  /** 当前剩余 cooldown 毫秒数；0 = 不在 cooldown */
  cooldownRemainingMs: number;
}

// ============================================================================
// Search Pipeline Options
// ============================================================================

/** Options passed to SearchOrchestrator.search() */
export interface SearchPipelineOptions {
  maxResults?: number;
  since?: Date;
  /** Leader-assigned tool IDs (filter adapters) */
  assignedTools?: string[];
  /** Kernel process ID (for capability checks) */
  processId?: string;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** RAG-Fusion config */
  ragFusionConfig?: {
    enabled?: boolean;
    maxVariants?: number;
  };
  /**
   * ★ Rerank 阶段配置（默认关闭；开启后在 fusion 与 quality-gate 之间插入精排）。
   */
  rerankConfig?: RerankConfig;
}
