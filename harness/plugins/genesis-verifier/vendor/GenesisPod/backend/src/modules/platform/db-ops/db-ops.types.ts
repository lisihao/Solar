/**
 * Internal domain types for db-ops module (service layer only).
 * These are NOT HTTP request/response shapes; they live at the platform (L1) layer.
 *
 * HTTP-facing DTOs (TableListResponseDto, TableDetailDto, TableDiagnosisDto,
 * CleanupResultDto, TableStatsDto, TableListQueryDto) are in
 * modules/open-api/admin/db-ops/dto/table-info.dto.ts
 */

/**
 * Table Category Enum
 * Categorizes tables by their functional domain
 */
export enum TableCategory {
  USER = "USER",
  RESOURCE = "RESOURCE",
  AI_SESSION = "AI_SESSION",
  AI_CONFIG = "AI_CONFIG",
  NOTIFICATION = "NOTIFICATION",
  LOG = "LOG",
  SYSTEM = "SYSTEM",
  ANALYTICS = "ANALYTICS",
  EXTERNAL = "EXTERNAL",
  CACHE = "CACHE",
  KNOWLEDGE = "KNOWLEDGE",
  INGESTION = "INGESTION",
  OFFICE = "OFFICE",
  RESEARCH = "RESEARCH",
  OTHER = "OTHER",
}

/**
 * Health Status
 */
export type HealthStatus = "healthy" | "warning" | "critical";

/**
 * Cleanup Policy Type
 */
export type CleanupPolicyType =
  | "age"
  | "status"
  | "orphan"
  | "size"
  | "custom"
  | "none";

/**
 * Cleanup Policy
 * Defines cleanup rules for a table
 */
export interface CleanupPolicyDto {
  type: CleanupPolicyType;
  field?: string;
  threshold?: number;
  condition?: string;
  description?: string;
  /** Date field to use for threshold comparison (defaults to created_at) */
  dateField?: string;
}

/**
 * Table Info
 * Comprehensive information about a database table (internal domain type)
 */
export interface TableInfoDto {
  name: string; // PostgreSQL table name (snake_case)
  displayName: string; // Human-readable name
  category: TableCategory;
  rowCount: number;
  sizeBytes: number;
  sizeFormatted: string;
  dataSizeBytes: number;
  indexSizeBytes: number;
  toastSizeBytes: number;
  lastUpdated: Date | null;
  cleanableRows: number;
  cleanableBytes: number;
  healthStatus: HealthStatus;
  hasCleanupPolicy: boolean;
  cleanupPolicy?: CleanupPolicyDto;
  description?: string;
}

/**
 * Table Column
 */
export interface TableColumnDto {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  references?: string;
}

/**
 * Table Constraint
 */
export interface TableConstraintDto {
  name: string;
  type: "PRIMARY KEY" | "FOREIGN KEY" | "UNIQUE" | "CHECK" | "INDEX";
  columns: string[];
  references?: string;
}

/**
 * Diagnosis Issue
 */
export interface DiagnosisIssue {
  severity: "info" | "warning" | "critical";
  type:
    | "large_table"
    | "no_index"
    | "orphaned_data"
    | "old_data"
    | "bloat"
    | "missing_cleanup";
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Table Detail DTO
 * Extended info including schema and sample data
 */
export interface TableDetailDto extends TableInfoDto {
  schema: TableColumnDto[];
  sampleData: Record<string, unknown>[];
  relatedTables: string[];
  constraints: TableConstraintDto[];
}

/**
 * Table Diagnosis DTO
 * AI-powered diagnosis results
 */
export interface TableDiagnosisDto {
  tableName: string;
  analyzedAt: Date;
  issues: DiagnosisIssue[];
  recommendations: string[];
  healthScore: number; // 0-100
  cleanupSuggestion?: {
    estimatedRows: number;
    estimatedBytes: number;
    query: string;
    description: string;
  };
}

/**
 * Cleanup Result DTO
 */
export interface CleanupResultDto {
  success: boolean;
  tableName: string;
  deletedCount: number;
  freedBytes: number;
  freedFormatted: string;
  message: string;
  duration: number; // milliseconds
}

/**
 * Table Stats DTO
 * Aggregate statistics across all tables
 */
export interface TableStatsDto {
  totalTables: number;
  totalRows: number;
  totalSizeBytes: number;
  totalSizeFormatted: string;
  cleanableSizeBytes: number;
  cleanableSizeFormatted: string;
  lastAnalyzed: Date;
  byCategory: Record<
    TableCategory,
    {
      count: number;
      rows: number;
      sizeBytes: number;
    }
  >;
  healthSummary: {
    healthy: number;
    warning: number;
    critical: number;
  };
}

/**
 * Table List Query DTO
 */
export interface TableListQueryDto {
  search?: string;
  category?: TableCategory;
  sortBy?:
    | "name"
    | "rows"
    | "size"
    | "updated"
    | "status"
    | "category"
    | "cleanable";
  sortOrder?: "asc" | "desc";
  page?: number;
  pageSize?: number;
  healthStatus?: HealthStatus;
}

/**
 * Table List Response DTO
 */
export interface TableListResponseDto {
  tables: TableInfoDto[];
  total: number;
  page: number;
  pageSize: number;
  stats: TableStatsDto;
}
