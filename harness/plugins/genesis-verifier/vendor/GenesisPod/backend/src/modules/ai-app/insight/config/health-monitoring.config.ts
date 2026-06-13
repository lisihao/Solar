/**
 * Health Monitoring Configuration
 * Centralized constants for research mission health monitoring
 */

/** Time thresholds for health checks */
export const HEALTH_MONITORING = {
  /** Threshold (ms) for considering a task as interrupted (default: 30 min) */
  INTERRUPTED_THRESHOLD_MS: 30 * 60 * 1000,
  /** Maximum time (ms) a mission can be in EXECUTING state (default: 6 hours) */
  MAX_MISSION_DURATION_MS: 6 * 60 * 60 * 1000,
  /** Health check interval (ms) (default: 5 min) */
  CHECK_INTERVAL_MS: 5 * 60 * 1000,
  /** Maximum consecutive health check failures before alerting */
  MAX_CONSECUTIVE_FAILURES: 3,
} as const;

/** Time constants for search and data freshness */
export const DATA_FRESHNESS = {
  /** Six months in milliseconds — used for search recency scoring */
  SIX_MONTHS_MS: 6 * 30 * 24 * 60 * 60 * 1000,
  /** One year in milliseconds */
  ONE_YEAR_MS: 365 * 24 * 60 * 60 * 1000,
} as const;
