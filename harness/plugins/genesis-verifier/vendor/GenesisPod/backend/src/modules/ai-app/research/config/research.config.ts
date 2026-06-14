/**
 * Research Module Configuration
 *
 * Centralized constants for the Research module.
 * Grouped by functional area to make tuning straightforward.
 */

// ---------------------------------------------------------------------------
// Demo polling (iterative-research.service)
// ---------------------------------------------------------------------------

/** Configuration for demo generation polling in the iterative loop */
export const DEMO_CONFIG = {
  /** Interval (ms) between each poll when waiting for a demo to finish generating */
  POLL_INTERVAL_MS: 3_000,
  /** Maximum total wait time (ms) before giving up on demo polling */
  POLL_TIMEOUT_MS: 120_000,
} as const;

// ---------------------------------------------------------------------------
// Iteration loop (iterative-research.service)
// ---------------------------------------------------------------------------

/** Configuration for the self-iterating outer research loop */
export const ITERATION_CONFIG = {
  /** Maximum number of accumulated ideas (insights + creative) kept in memory per loop;
   *  oldest items are evicted when the cap is reached to prevent OOM on long runs */
  MAX_ACCUMULATED_IDEAS: 30,
  /** How long (ms) to wait for user feedback between iterations before auto-continuing */
  FEEDBACK_TIMEOUT_MS: 120_000,
  /** Maximum allowed feedback timeout (cap for user-provided values) */
  MAX_FEEDBACK_TIMEOUT_MS: 600_000,
} as const;

// ---------------------------------------------------------------------------
// Exit decision (evaluation/exit-decision.service)
// ---------------------------------------------------------------------------

/** Maximum iteration counts allowed per depth level before the loop is force-stopped */
export const MAX_ITERATIONS: Record<"quick" | "standard" | "thorough", number> =
  {
    quick: 2,
    standard: 4,
    thorough: 6,
  } as const;

/** Quality score thresholds (0–1) that trigger an early exit when met */
export const QUALITY_THRESHOLD: Record<
  "quick" | "standard" | "thorough",
  number
> = {
  quick: 0.6,
  standard: 0.75,
  thorough: 0.85,
} as const;

/** Configuration for the exit-decision heuristics */
export const EXIT_DECISION_CONFIG = {
  /** Information gain below this fraction is considered "saturated" */
  SATURATION_GAIN_THRESHOLD: 0.03,
  /** Score delta below this value in two consecutive rounds triggers convergence exit */
  CONVERGENCE_DELTA_THRESHOLD: 0.05,
  /** Minimum completed iterations before saturation/convergence exits are allowed */
  MIN_ITERATIONS_FOR_EARLY_EXIT: 3,
} as const;

// ---------------------------------------------------------------------------
// Discussion orchestrator timeouts (discussion/discussion-orchestrator.service)
// ---------------------------------------------------------------------------

/** Timeout constants for each phase of the discussion-driven research orchestrator */
export const ORCHESTRATOR_CONFIG = {
  /** Maximum time (ms) allowed for a standard research phase (ideation, execution, findings) */
  STAGE_TIMEOUT_MS: 2 * 60 * 1000,
  /** Maximum time (ms) allowed for the synthesis phase
   *  (multi-step report generation needs more headroom than other phases) */
  SYNTHESIS_TIMEOUT_MS: 12 * 60 * 1000,
  /** Rate-limit guard: short delay (ms) between successive LLM calls in tight loops */
  RATE_LIMIT_DELAY_MS: 300,
} as const;

/** Estimated credit costs per research depth level */
export const CREDITS_CONFIG = {
  /** Credits required per depth level; fallback to `standard` when depth is unknown */
  PER_DEPTH: {
    quick: 300,
    standard: 700,
    thorough: 1500,
  } as const,
  /** Default credit estimate when depth cannot be resolved */
  DEFAULT: 700,
} as const;

// ---------------------------------------------------------------------------
// SSE / streaming (discussion/discussion.controller)
// ---------------------------------------------------------------------------

/** SSE connection configuration for the deep-research streaming endpoint */
export const SSE_CONFIG = {
  /** Heartbeat interval (ms) — keeps Railway/Cloudflare proxies from closing idle SSE connections */
  HEARTBEAT_INTERVAL_MS: 15_000,
  /** Hard timeout (ms) on the entire SSE stream — safety net against hung LLM calls
   *  (research typically takes 10–20 min; 30 min gives comfortable headroom) */
  STREAM_TIMEOUT_MS: 30 * 60 * 1000,
} as const;

// ---------------------------------------------------------------------------
// Quality gate thresholds (quality/research-quality-gate.service)
// ---------------------------------------------------------------------------

/** Dual-layer quality gate thresholds (Layer 1 structural + Layer 2 LLM content scorer) */
export const QUALITY_GATE_DUAL_LAYER_CONFIG = {
  /** Layer 2 content score below which overall verdict fails */
  CONTENT_SCORE_THRESHOLD: 0.5,
  /** Layer 2 content score below which critique suggestions are triggered */
  CRITIQUE_TRIGGER_THRESHOLD: 0.6,
  /** Layer 1 structural overall score below which overall verdict fails */
  STRUCTURAL_SCORE_THRESHOLD: 0.6,
} as const;

/** Formatting and content quality thresholds used by ResearchQualityGateService */
export const QUALITY_GATE_CONFIG = {
  /** Minimum character count (excluding whitespace) required per report section */
  MIN_SECTION_CHARS: 500,
  /** Character count below which a section is considered empty */
  EMPTY_SECTION_CHARS: 50,
  /** Maximum number of bold markers (**text**) allowed in the full report */
  MAX_BOLD_COUNT: 15,
  /** Maximum number of blockquote lines (> …) allowed in the full report */
  MAX_BLOCKQUOTE_COUNT: 5,
  /** Minimum fraction of sections that must contain at least one citation marker [n] */
  MIN_CITATION_COVERAGE_RATIO: 0.3,
  /** Minimum number of sections before the citation-coverage check is applied */
  MIN_SECTIONS_FOR_CITATION_CHECK: 3,
} as const;
