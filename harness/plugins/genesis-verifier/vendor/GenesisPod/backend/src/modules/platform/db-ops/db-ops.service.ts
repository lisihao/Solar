import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import * as fs from "fs/promises";
import * as path from "path";
import { PrismaService } from "../../../common/prisma/prisma.service";
import {
  TableCategory,
  HealthStatus,
  CleanupPolicyDto,
  TableInfoDto,
  TableColumnDto,
  TableConstraintDto,
  DiagnosisIssue,
  TableDetailDto,
  TableDiagnosisDto,
  CleanupResultDto,
  TableStatsDto,
  TableListQueryDto,
  TableListResponseDto,
} from "./db-ops.types";
import { TABLE_CATEGORIES } from "./catalogs/table-category.catalog";
import { TABLE_DISPLAY_NAMES } from "./catalogs/table-display-name.catalog";
import { TABLE_CLEANUP_POLICIES } from "./policies/table-cleanup-policy.catalog";
import { TABLE_CLEANUP_EXCEPTIONS } from "./policies/table-cleanup-exception.catalog";

@Injectable()
export class DbOpsService {
  private readonly logger = new Logger(DbOpsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Format bytes to human-readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }

  /**
   * Get display name for a table
   */
  private getDisplayName(tableName: string): string {
    if (TABLE_DISPLAY_NAMES[tableName]) {
      return TABLE_DISPLAY_NAMES[tableName];
    }
    // Convert snake_case to Title Case
    return tableName
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  /**
   * Get category for a table
   */
  private getCategory(tableName: string): TableCategory {
    return TABLE_CATEGORIES[tableName] || TableCategory.OTHER;
  }

  /**
   * Determine health status based on table metrics
   */
  private determineHealthStatus(
    rowCount: number,
    sizeBytes: number,
    cleanableBytes: number,
    hasCleanupPolicy: boolean,
  ): HealthStatus {
    // Critical: Very large tables or high cleanable percentage
    if (sizeBytes > 1024 * 1024 * 1024) {
      // > 1GB
      return "critical";
    }
    if (cleanableBytes > 0 && cleanableBytes / sizeBytes > 0.5) {
      return "warning";
    }
    // Warning: Large tables without cleanup policy
    if (sizeBytes > 100 * 1024 * 1024 && !hasCleanupPolicy) {
      // > 100MB
      return "warning";
    }
    if (rowCount > 100000 && !hasCleanupPolicy) {
      return "warning";
    }
    return "healthy";
  }

  /**
   * Build WHERE clause from a cleanup policy (same logic as cleanupTable uses for DELETE).
   * Returns null for custom policies (no generic WHERE possible).
   */
  private buildCleanupWhereClause(policy: CleanupPolicyDto): string | null {
    if (policy.type === "age" && policy.field && policy.threshold) {
      return `"${policy.field}" < NOW() - INTERVAL '${policy.threshold} days'`;
    }
    if (policy.type === "status" && policy.field && policy.condition) {
      const conditions = policy.condition.split(" OR ").map((s) => s.trim());
      const dateField = policy.dateField || "created_at";
      const statusClause = `"${policy.field}" IN (${conditions.map((c) => `'${c}'`).join(", ")})`;
      return policy.threshold
        ? `${statusClause} AND "${dateField}" < NOW() - INTERVAL '${policy.threshold} days'`
        : statusClause;
    }
    return null;
  }

  /**
   * Estimate cleanable rows and bytes for tables that have a cleanup policy.
   * Runs actual COUNT queries against the DB using the same WHERE clause as cleanup.
   * Returns a map of tableName -> { cleanableRows, cleanableBytes }.
   */
  private async estimateCleanable(
    tableNames: string[],
  ): Promise<Map<string, { cleanableRows: number; cleanableBytes: number }>> {
    const result = new Map<
      string,
      { cleanableRows: number; cleanableBytes: number }
    >();

    // Build UNION ALL query for all tables with age/status policies
    const parts: Array<{
      tableName: string;
      where: string;
    }> = [];
    for (const name of tableNames) {
      const policy = TABLE_CLEANUP_POLICIES[name];
      if (!policy) continue;
      const where = this.buildCleanupWhereClause(policy);
      if (where) {
        parts.push({ tableName: name, where });
      }
    }

    if (parts.length === 0) return result;

    // Run individual count queries in parallel (UNION ALL doesn't work well with different tables)
    const queries = parts.map(async ({ tableName, where }) => {
      try {
        // Count rows and estimate their size based on average row size
        const rows = await this.prisma.$queryRawUnsafe<
          Array<{
            cleanable_rows: string;
            total_rows: string;
            total_size: string;
          }>
        >(
          `SELECT
            (SELECT COUNT(*)::text FROM "${tableName}" WHERE ${where}) as cleanable_rows,
            c.reltuples::bigint::text as total_rows,
            pg_total_relation_size(c.oid)::text as total_size
          FROM pg_class c
          WHERE c.relname = $1
            AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')`,
          tableName,
        );
        const cleanableRows = parseInt(rows[0]?.cleanable_rows || "0", 10);
        const totalRows = parseInt(rows[0]?.total_rows || "1", 10) || 1;
        const totalSize = parseInt(rows[0]?.total_size || "0", 10);
        // Estimate cleanable bytes proportional to row count
        const cleanableBytes = Math.floor(
          (cleanableRows / totalRows) * totalSize,
        );
        result.set(tableName, { cleanableRows, cleanableBytes });
      } catch {
        // If a query fails (e.g. column doesn't exist), skip silently
      }
    });

    await Promise.all(queries);
    return result;
  }

  /**
   * Get list of all tables with their statistics
   */
  async getTableList(query: TableListQueryDto): Promise<TableListResponseDto> {
    const {
      search,
      category,
      sortBy = "size",
      sortOrder = "desc",
      page = 1,
      pageSize = 50,
      healthStatus,
    } = query;

    try {
      // Query PostgreSQL for table sizes
      const tableSizes = await this.prisma.$queryRawUnsafe<
        Array<{
          table_name: string;
          row_estimate: string;
          total_bytes: string;
          table_bytes: string;
          index_bytes: string;
          toast_bytes: string;
        }>
      >(`
        SELECT
          c.relname as table_name,
          c.reltuples::bigint::text as row_estimate,
          pg_total_relation_size(c.oid)::text as total_bytes,
          pg_relation_size(c.oid)::text as table_bytes,
          pg_indexes_size(c.oid)::text as index_bytes,
          COALESCE(pg_relation_size(c.reltoastrelid), 0)::text as toast_bytes
        FROM pg_class c
        WHERE c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
          AND c.relkind = 'r'
        ORDER BY pg_total_relation_size(c.oid) DESC
      `);

      // Collect table names that have cleanup policies for actual estimation
      const tableNamesWithPolicies = tableSizes
        .map((t) => String(t.table_name))
        .filter((name) => TABLE_CLEANUP_POLICIES[name]);
      const cleanableMap = await this.estimateCleanable(tableNamesWithPolicies);

      // Transform to TableInfoDto array
      let tables: TableInfoDto[] = tableSizes.map((t) => {
        const tableName = String(t.table_name);
        const rowCount = parseInt(t.row_estimate, 10) || 0;
        const sizeBytes = parseInt(t.total_bytes, 10) || 0;
        const dataSizeBytes = parseInt(t.table_bytes, 10) || 0;
        const indexSizeBytes = parseInt(t.index_bytes, 10) || 0;
        const toastSizeBytes = parseInt(t.toast_bytes, 10) || 0;
        const tableCategory = this.getCategory(tableName);
        const cleanupPolicy = TABLE_CLEANUP_POLICIES[tableName];
        const hasCleanupPolicy = !!cleanupPolicy;

        const estimated = cleanableMap.get(tableName);
        const cleanableBytes = estimated?.cleanableBytes ?? 0;
        const cleanableRows = estimated?.cleanableRows ?? 0;

        const healthStatus = this.determineHealthStatus(
          rowCount,
          sizeBytes,
          cleanableBytes,
          hasCleanupPolicy,
        );

        return {
          name: tableName,
          displayName: this.getDisplayName(tableName),
          category: tableCategory,
          rowCount,
          sizeBytes,
          sizeFormatted: this.formatBytes(sizeBytes),
          dataSizeBytes,
          indexSizeBytes,
          toastSizeBytes,
          lastUpdated: null, // Would need trigger to track this
          cleanableRows,
          cleanableBytes,
          healthStatus,
          hasCleanupPolicy,
          cleanupPolicy,
        };
      });

      // Apply filters
      if (search) {
        const searchLower = search.toLowerCase();
        tables = tables.filter(
          (t) =>
            t.name.toLowerCase().includes(searchLower) ||
            t.displayName.toLowerCase().includes(searchLower),
        );
      }

      if (category) {
        tables = tables.filter((t) => t.category === category);
      }

      if (healthStatus) {
        tables = tables.filter((t) => t.healthStatus === healthStatus);
      }

      // Apply sorting
      tables.sort((a, b) => {
        let comparison = 0;
        switch (sortBy) {
          case "name":
            comparison = a.name.localeCompare(b.name);
            break;
          case "rows":
            comparison = a.rowCount - b.rowCount;
            break;
          case "size":
            comparison = a.sizeBytes - b.sizeBytes;
            break;
          case "category":
            comparison = a.category.localeCompare(b.category);
            break;
          case "status":
            const statusOrder = { critical: 0, warning: 1, healthy: 2 };
            comparison =
              statusOrder[a.healthStatus] - statusOrder[b.healthStatus];
            break;
          case "cleanable":
            comparison = a.cleanableBytes - b.cleanableBytes;
            break;
          default:
            comparison = a.sizeBytes - b.sizeBytes;
        }
        return sortOrder === "desc" ? -comparison : comparison;
      });

      // Calculate stats
      const stats = this.calculateStats(tables);

      // Apply pagination
      const total = tables.length;
      const start = (page - 1) * pageSize;
      const paginatedTables = tables.slice(start, start + pageSize);

      return {
        tables: paginatedTables,
        total,
        page,
        pageSize,
        stats,
      };
    } catch (error) {
      this.logger.error("Failed to get table list:", error);
      throw error;
    }
  }

  /**
   * Calculate aggregate statistics
   */
  private calculateStats(tables: TableInfoDto[]): TableStatsDto {
    const byCategory = {} as TableStatsDto["byCategory"];

    // Initialize all categories
    Object.values(TableCategory).forEach((cat) => {
      byCategory[cat] = { count: 0, rows: 0, sizeBytes: 0 };
    });

    let totalRows = 0;
    let totalSizeBytes = 0;
    let cleanableSizeBytes = 0;
    let healthy = 0;
    let warning = 0;
    let critical = 0;

    tables.forEach((t) => {
      totalRows += t.rowCount;
      totalSizeBytes += t.sizeBytes;
      cleanableSizeBytes += t.cleanableBytes;

      if (byCategory[t.category]) {
        byCategory[t.category].count++;
        byCategory[t.category].rows += t.rowCount;
        byCategory[t.category].sizeBytes += t.sizeBytes;
      }

      if (t.healthStatus === "healthy") healthy++;
      else if (t.healthStatus === "warning") warning++;
      else critical++;
    });

    return {
      totalTables: tables.length,
      totalRows,
      totalSizeBytes,
      totalSizeFormatted: this.formatBytes(totalSizeBytes),
      cleanableSizeBytes,
      cleanableSizeFormatted: this.formatBytes(cleanableSizeBytes),
      lastAnalyzed: new Date(),
      byCategory,
      healthSummary: { healthy, warning, critical },
    };
  }

  /**
   * Get detailed info for a single table
   */
  async getTableDetail(tableName: string): Promise<TableDetailDto> {
    this.validateTableName(tableName);
    try {
      // Get basic table info
      const tableInfo = await this.prisma.$queryRawUnsafe<
        Array<{
          row_estimate: string;
          total_bytes: string;
          table_bytes: string;
          index_bytes: string;
          toast_bytes: string;
        }>
      >(
        `
        SELECT
          c.reltuples::bigint::text as row_estimate,
          pg_total_relation_size(c.oid)::text as total_bytes,
          pg_relation_size(c.oid)::text as table_bytes,
          pg_indexes_size(c.oid)::text as index_bytes,
          COALESCE(pg_relation_size(c.reltoastrelid), 0)::text as toast_bytes
        FROM pg_class c
        WHERE c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
          AND c.relkind = 'r'
          AND c.relname = $1
      `,
        tableName,
      );

      if (!tableInfo.length) {
        throw new NotFoundException(`Table ${tableName} not found`);
      }

      const info = tableInfo[0];
      const rowCount = parseInt(info.row_estimate, 10) || 0;
      const sizeBytes = parseInt(info.total_bytes, 10) || 0;
      const dataSizeBytes = parseInt(info.table_bytes, 10) || 0;
      const indexSizeBytes = parseInt(info.index_bytes, 10) || 0;
      const toastSizeBytes = parseInt(info.toast_bytes, 10) || 0;

      // Get column info
      const columns = await this.prisma.$queryRawUnsafe<
        Array<{
          column_name: string;
          data_type: string;
          is_nullable: string;
          column_default: string | null;
          is_pk: boolean;
          fk_table: string | null;
        }>
      >(
        `
        SELECT
          c.column_name,
          c.data_type,
          c.is_nullable,
          c.column_default,
          COALESCE(pk.is_pk, false) as is_pk,
          fk.foreign_table_name as fk_table
        FROM information_schema.columns c
        LEFT JOIN (
          SELECT kcu.column_name, true as is_pk
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
          WHERE tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY'
        ) pk ON c.column_name = pk.column_name
        LEFT JOIN (
          SELECT kcu.column_name, ccu.table_name as foreign_table_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
          JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
          WHERE tc.table_name = $1 AND tc.constraint_type = 'FOREIGN KEY'
        ) fk ON c.column_name = fk.column_name
        WHERE c.table_name = $1
        ORDER BY c.ordinal_position
      `,
        tableName,
      );

      const schema: TableColumnDto[] = columns.map((col) => ({
        name: col.column_name,
        type: col.data_type,
        nullable: col.is_nullable === "YES",
        defaultValue: col.column_default,
        isPrimaryKey: col.is_pk,
        isForeignKey: !!col.fk_table,
        references: col.fk_table || undefined,
      }));

      // Get sample data (limit to 10 rows)
      // SAFETY: tableName validated by validateTableName() whitelist at method entry
      let sampleData: Record<string, unknown>[] = [];
      try {
        sampleData = await this.prisma.$queryRawUnsafe(
          `SELECT * FROM "${tableName}" LIMIT $1`,
          10,
        );
      } catch (e) {
        this.logger.warn(`Failed to get sample data for ${tableName}:`, e);
      }

      // Get related tables (foreign keys)
      const relatedTables = [
        ...new Set(
          columns.filter((c) => c.fk_table).map((c) => c.fk_table as string),
        ),
      ];

      // Get constraints
      const constraintRows = await this.prisma.$queryRawUnsafe<
        Array<{
          constraint_name: string;
          constraint_type: string;
          column_name: string;
        }>
      >(
        `
        SELECT tc.constraint_name, tc.constraint_type, kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_name = $1
      `,
        tableName,
      );

      const constraintMap = new Map<string, TableConstraintDto>();
      constraintRows.forEach((row) => {
        if (!constraintMap.has(row.constraint_name)) {
          constraintMap.set(row.constraint_name, {
            name: row.constraint_name,
            type: row.constraint_type as TableConstraintDto["type"],
            columns: [],
          });
        }
        constraintMap.get(row.constraint_name)!.columns.push(row.column_name);
      });

      const tableCategory = this.getCategory(tableName);
      const cleanupPolicy = TABLE_CLEANUP_POLICIES[tableName];
      const hasCleanupPolicy = !!cleanupPolicy;

      const cleanableMap = await this.estimateCleanable(
        hasCleanupPolicy ? [tableName] : [],
      );
      const estimated = cleanableMap.get(tableName);
      const cleanableBytes = estimated?.cleanableBytes ?? 0;
      const cleanableRows = estimated?.cleanableRows ?? 0;

      const healthStatus = this.determineHealthStatus(
        rowCount,
        sizeBytes,
        cleanableBytes,
        hasCleanupPolicy,
      );

      return {
        name: tableName,
        displayName: this.getDisplayName(tableName),
        category: tableCategory,
        rowCount,
        sizeBytes,
        sizeFormatted: this.formatBytes(sizeBytes),
        dataSizeBytes,
        indexSizeBytes,
        toastSizeBytes,
        lastUpdated: null,
        cleanableRows,
        cleanableBytes,
        healthStatus,
        hasCleanupPolicy,
        cleanupPolicy,
        schema,
        sampleData,
        relatedTables,
        constraints: Array.from(constraintMap.values()),
      };
    } catch (error) {
      this.logger.error(`Failed to get table detail for ${tableName}:`, error);
      throw error;
    }
  }

  /**
   * Validate table name to prevent SQL injection
   */
  private validateTableName(tableName: string): void {
    // Validate format: must be alphanumeric with underscores, starting with letter or underscore
    const tableNameRegex = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    if (!tableNameRegex.test(tableName)) {
      throw new BadRequestException(
        `Invalid table name format: ${tableName}. Only alphanumeric characters and underscores are allowed.`,
      );
    }

    // Additional validation: check against known Prisma model names
    const knownTables = Object.keys(TABLE_CATEGORIES);
    if (!knownTables.includes(tableName)) {
      throw new BadRequestException(
        `Unknown table: ${tableName}. Table must be a valid Prisma model.`,
      );
    }
  }

  /**
   * Get sample data from a table
   */
  async getTableSample(
    tableName: string,
    limit: number = 10,
  ): Promise<Record<string, unknown>[]> {
    try {
      // Validate table name to prevent SQL injection
      this.validateTableName(tableName);

      const validTables = await this.prisma.$queryRawUnsafe<
        Array<{ relname: string }>
      >(
        `
        SELECT c.relname
        FROM pg_class c
        WHERE c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
          AND c.relkind = 'r'
          AND c.relname = $1
      `,
        tableName,
      );

      if (!validTables.length) {
        throw new NotFoundException(`Table ${tableName} not found`);
      }

      // SAFETY: tableName validated by pg_class existence check above
      return await this.prisma.$queryRawUnsafe(
        `SELECT * FROM "${tableName}" LIMIT $1`,
        Math.min(limit, 100),
      );
    } catch (error) {
      this.logger.error(`Failed to get sample for ${tableName}:`, error);
      throw error;
    }
  }

  /**
   * Diagnose a table for issues and recommendations
   */
  async diagnoseTable(tableName: string): Promise<TableDiagnosisDto> {
    const issues: DiagnosisIssue[] = [];
    const recommendations: string[] = [];

    try {
      const detail = await this.getTableDetail(tableName);

      // Check for large table
      if (detail.sizeBytes > 500 * 1024 * 1024) {
        // > 500MB
        issues.push({
          severity: "critical",
          type: "large_table",
          message: `Table is very large (${detail.sizeFormatted})`,
          details: { size: detail.sizeBytes },
        });
        recommendations.push(
          "Consider archiving old data or implementing partitioning",
        );
      } else if (detail.sizeBytes > 100 * 1024 * 1024) {
        // > 100MB
        issues.push({
          severity: "warning",
          type: "large_table",
          message: `Table is moderately large (${detail.sizeFormatted})`,
          details: { size: detail.sizeBytes },
        });
      }

      // Check for missing cleanup policy
      if (!detail.hasCleanupPolicy && detail.rowCount > 10000) {
        issues.push({
          severity: "warning",
          type: "missing_cleanup",
          message: "No cleanup policy defined for large table",
          details: { rowCount: detail.rowCount },
        });
        recommendations.push(
          "Consider adding a cleanup policy based on age or status",
        );
      }

      // Check for high TOAST ratio (indicates large JSON/text columns)
      if (detail.toastSizeBytes > detail.dataSizeBytes) {
        issues.push({
          severity: "info",
          type: "bloat",
          message: "Table has significant TOAST data (large text/JSON fields)",
          details: {
            toastSize: detail.toastSizeBytes,
            dataSize: detail.dataSizeBytes,
          },
        });
        recommendations.push(
          "Consider compressing or archiving large text/JSON data",
        );
      }

      // Check index ratio
      if (
        detail.indexSizeBytes > detail.dataSizeBytes * 2 &&
        detail.sizeBytes > 10 * 1024 * 1024
      ) {
        issues.push({
          severity: "warning",
          type: "bloat",
          message: "Indexes are unusually large compared to data",
          details: {
            indexSize: detail.indexSizeBytes,
            dataSize: detail.dataSizeBytes,
          },
        });
        recommendations.push("Review indexes for redundancy, consider REINDEX");
      }

      // Calculate health score
      let healthScore = 100;
      issues.forEach((issue) => {
        if (issue.severity === "critical") healthScore -= 30;
        else if (issue.severity === "warning") healthScore -= 15;
        else healthScore -= 5;
      });
      healthScore = Math.max(0, healthScore);

      // Build cleanup suggestion if applicable
      let cleanupSuggestion = undefined;
      if (detail.cleanupPolicy) {
        const policy = detail.cleanupPolicy;
        let query = "";
        let description = "";

        if (policy.type === "age" && policy.field && policy.threshold) {
          query = `DELETE FROM "${tableName}" WHERE "${policy.field}" < NOW() - INTERVAL '${policy.threshold} days'`;
          description = `Delete records older than ${policy.threshold} days based on ${policy.field}`;
        } else if (policy.type === "status" && policy.condition) {
          query = `DELETE FROM "${tableName}" WHERE status IN (${policy.condition
            .split(" OR ")
            .map((s) => `'${s.trim()}'`)
            .join(", ")})`;
          description = `Delete records with status: ${policy.condition}`;
        }

        if (query) {
          cleanupSuggestion = {
            estimatedRows: detail.cleanableRows,
            estimatedBytes: detail.cleanableBytes,
            query,
            description,
          };
        }
      }

      return {
        tableName,
        analyzedAt: new Date(),
        issues,
        recommendations,
        healthScore,
        cleanupSuggestion,
      };
    } catch (error) {
      this.logger.error(`Failed to diagnose table ${tableName}:`, error);
      throw error;
    }
  }

  /**
   * Diagnose all tables
   */
  async diagnoseBatch(): Promise<TableDiagnosisDto[]> {
    const { tables } = await this.getTableList({ pageSize: 1000 });
    const results: TableDiagnosisDto[] = [];

    for (const table of tables) {
      try {
        const diagnosis = await this.diagnoseTable(table.name);
        if (diagnosis.issues.length > 0) {
          results.push(diagnosis);
        }
      } catch (e) {
        this.logger.warn(`Failed to diagnose ${table.name}:`, e);
      }
    }

    return results;
  }

  /**
   * Get aggregate statistics only
   */
  async getStats(): Promise<TableStatsDto> {
    const { stats } = await this.getTableList({ pageSize: 1000 });
    return stats;
  }

  /**
   * Execute cleanup for a specific table
   */
  async cleanupTable(tableName: string): Promise<CleanupResultDto> {
    const startTime = Date.now();
    this.validateTableName(tableName);
    const policy = TABLE_CLEANUP_POLICIES[tableName];

    if (!policy) {
      return {
        success: false,
        tableName,
        deletedCount: 0,
        freedBytes: 0,
        freedFormatted: "0 B",
        message: `No cleanup policy defined for table ${tableName}`,
        duration: Date.now() - startTime,
      };
    }

    try {
      let deletedCount = 0;

      // Get size before
      // SAFETY: tableName validated by validateTableName() whitelist
      const sizeBefore = await this.prisma.$queryRawUnsafe<
        Array<{ size: string }>
      >(`SELECT pg_total_relation_size($1::regclass)::text as size`, tableName);
      const beforeBytes = parseInt(sizeBefore[0]?.size || "0", 10);

      // Execute cleanup based on policy type
      // SAFETY: tableName validated by validateTableName() whitelist; policy fields come from hardcoded TABLE_CLEANUP_POLICIES
      if (policy.type === "custom") {
        deletedCount = await this.executeCustomCleanup(tableName);
      } else if (policy.type === "age" && policy.field && policy.threshold) {
        // Pre-cleanup: clear foreign key references pointing to rows about to be deleted
        if (tableName === "raw_data") {
          await this.prisma.$executeRawUnsafe(`
            UPDATE "resources" SET "raw_data_id" = NULL
            WHERE "raw_data_id" IN (
              SELECT "id" FROM "raw_data"
              WHERE "${policy.field}" < NOW() - INTERVAL '${policy.threshold} days'
            )
          `);
        }

        const result = await this.prisma.$executeRawUnsafe(`
          DELETE FROM "${tableName}"
          WHERE "${policy.field}" < NOW() - INTERVAL '${policy.threshold} days'
        `);
        deletedCount = result;
      } else if (policy.type === "status" && policy.field && policy.condition) {
        // SAFETY: conditions come from hardcoded TABLE_CLEANUP_POLICIES, not user input
        const conditions = policy.condition.split(" OR ").map((s) => s.trim());
        const dateField = policy.dateField || "created_at";

        // Pre-cleanup hook: clear export physical files before deleting DB records
        if (tableName === "export_jobs") {
          await this.cleanupExportFiles(
            conditions,
            dateField,
            policy.threshold ?? 7,
          );
        }

        const result = await this.prisma.$executeRawUnsafe(`
          DELETE FROM "${tableName}"
          WHERE "${policy.field}" IN (${conditions.map((c) => `'${c}'`).join(", ")})
          ${policy.threshold ? `AND "${dateField}" < NOW() - INTERVAL '${policy.threshold} days'` : ""}
        `);
        deletedCount = result;
      }

      // VACUUM to reclaim dead tuples before measuring size reduction
      if (deletedCount > 0) {
        try {
          // SAFETY: tableName validated by validateTableName() whitelist
          await this.prisma.$executeRawUnsafe(`VACUUM "${tableName}"`);
        } catch (vacuumError) {
          this.logger.warn(
            `VACUUM failed for ${tableName} (non-critical): ${vacuumError}`,
          );
        }
      }

      // Get size after
      const sizeAfter = await this.prisma.$queryRawUnsafe<
        Array<{ size: string }>
      >(`SELECT pg_total_relation_size($1::regclass)::text as size`, tableName);
      const afterBytes = parseInt(sizeAfter[0]?.size || "0", 10);
      const freedBytes = Math.max(0, beforeBytes - afterBytes);

      return {
        success: true,
        tableName,
        deletedCount,
        freedBytes,
        freedFormatted: this.formatBytes(freedBytes),
        message: `Cleaned up ${deletedCount} rows, freed ${this.formatBytes(freedBytes)}`,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      this.logger.error(`Failed to cleanup table ${tableName}:`, error);
      return {
        success: false,
        tableName,
        deletedCount: 0,
        freedBytes: 0,
        freedFormatted: "0 B",
        message: `Cleanup failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        duration: Date.now() - startTime,
      };
    }
  }

  // ==================== Custom cleanup handlers ====================

  /**
   * Route custom cleanup policies to their specific handlers
   */
  private async executeCustomCleanup(tableName: string): Promise<number> {
    const policy = TABLE_CLEANUP_EXCEPTIONS[tableName];
    if (!policy) {
      this.logger.warn(`No custom cleanup handler for table: ${tableName}`);
      return 0;
    }

    if (policy.strategy === "keep-latest-per-parent") {
      return this.cleanupKeepLatestPerParent(policy);
    }

    this.logger.warn(`Unsupported custom cleanup strategy for ${tableName}`);
    return 0;
  }

  /**
   * Keep only the latest N rows per parent key for policy-governed tables.
   */
  private async cleanupKeepLatestPerParent(policy: {
    tableName: string;
    parentField: string;
    orderField: string;
    keepLatest: number;
    cascadeTables: string[];
  }): Promise<number> {
    const result = await this.prisma.$executeRawUnsafe(`
      DELETE FROM "${policy.tableName}"
      WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY ${policy.parentField}
            ORDER BY ${policy.orderField} DESC
          ) AS rn
          FROM "${policy.tableName}"
        ) ranked
        WHERE rn > ${policy.keepLatest}
      )
    `);

    // VACUUM cascade-affected child tables to reclaim space
    if (result > 0) {
      for (const table of policy.cascadeTables) {
        try {
          await this.prisma.$executeRawUnsafe(`VACUUM "${table}"`);
        } catch {
          // Non-critical: table may not exist or VACUUM may fail in transaction
        }
      }
    }

    this.logger.log(
      `Cleaned ${result} old rows from ${policy.tableName} (kept latest ${policy.keepLatest} per parent)`,
    );
    return result;
  }

  /**
   * Pre-cleanup: remove physical export files before deleting DB records.
   * Queries file_path for rows matching the cleanup criteria, then deletes directories.
   */
  private async cleanupExportFiles(
    statuses: string[],
    dateField: string,
    thresholdDays: number,
  ): Promise<void> {
    const exportDir = process.env.EXPORT_DIR || "./exports";

    const jobs = await this.prisma.$queryRawUnsafe<
      Array<{ file_path: string | null }>
    >(
      `SELECT file_path FROM "export_jobs"
       WHERE "status" IN (${statuses.map((s) => `'${s}'`).join(", ")})
       AND "${dateField}" < NOW() - INTERVAL '${thresholdDays} days'
       AND file_path IS NOT NULL`,
    );

    let cleaned = 0;
    for (const job of jobs) {
      if (!job.file_path) continue;
      try {
        const dir = path.dirname(job.file_path);
        const resolvedDir = path.resolve(dir);
        const resolvedExportDir = path.resolve(exportDir);

        // Safety: only delete within the export directory
        if (!resolvedDir.startsWith(resolvedExportDir)) {
          this.logger.warn(`Skipping suspicious export path: ${job.file_path}`);
          continue;
        }

        await fs.rm(dir, { recursive: true, force: true });
        cleaned++;
      } catch (error) {
        this.logger.warn(
          `Failed to cleanup export file ${job.file_path}: ${error}`,
        );
      }
    }

    if (cleaned > 0) {
      this.logger.log(`Cleaned ${cleaned} export file directories`);
    }
  }

  /**
   * Run cleanup on all tables with cleanup policies
   */
  async cleanupBatch(): Promise<CleanupResultDto[]> {
    const results: CleanupResultDto[] = [];
    const tablesWithPolicies = Object.keys(TABLE_CLEANUP_POLICIES);

    this.logger.log(
      `Running batch cleanup on ${tablesWithPolicies.length} tables`,
    );

    for (const tableName of tablesWithPolicies) {
      try {
        const result = await this.cleanupTable(tableName);
        if (result.deletedCount > 0) {
          results.push(result);
          this.logger.log(
            `Cleaned ${tableName}: ${result.deletedCount} rows, freed ${result.freedFormatted}`,
          );
        }
      } catch (error) {
        this.logger.warn(`Failed to cleanup ${tableName}:`, error);
      }
    }

    this.logger.log(
      `Batch cleanup completed: ${results.length} tables cleaned`,
    );
    return results;
  }
}
