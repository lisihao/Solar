/**
 * HTTP-facing DTOs for admin/tables endpoints.
 * All types originate in the platform layer (db-ops.types.ts) and are
 * re-exported here so controller consumers have a single import point.
 *
 * Platform-layer internal types stay at modules/platform/db-ops/db-ops.types.ts.
 * Dependency direction: open-api (L4) → platform (L1). Correct.
 */

// TableCategory is an enum (runtime value) — use plain export
export { TableCategory } from "@/modules/platform/db-ops/db-ops.types";

// All remaining are interfaces or type aliases — use export type
export type {
  HealthStatus,
  TableDetailDto,
  TableDiagnosisDto,
  CleanupResultDto,
  TableStatsDto,
  TableListQueryDto,
  TableListResponseDto,
} from "@/modules/platform/db-ops/db-ops.types";
