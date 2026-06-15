import { Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import type { EvalRunResult } from "./eval-harness.types";

export const EVAL_RUN_STORE = Symbol("EVAL_RUN_STORE");

export interface EvalRunStore {
  saveRun(run: EvalRunResult): Promise<void>;
  getRun(runId: string): Promise<EvalRunResult | null>;
  listRuns(limit?: number): Promise<EvalRunResult[]>;
}

@Injectable()
export class InMemoryEvalRunStore implements EvalRunStore {
  private readonly runs = new Map<string, EvalRunResult>();

  async saveRun(run: EvalRunResult): Promise<void> {
    this.runs.set(run.id, run);
  }

  async getRun(runId: string): Promise<EvalRunResult | null> {
    return this.runs.get(runId) ?? null;
  }

  async listRuns(limit = 50): Promise<EvalRunResult[]> {
    const safeLimit = normalizeLimit(limit);
    return Array.from(this.runs.values())
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, safeLimit);
  }
}

interface EvalRunRow {
  id: string;
  dataset_id: string;
  dataset_name: string;
  dataset_version: string | null;
  status: string;
  summary: unknown;
  cases: unknown;
  metadata: unknown;
  started_at: Date | string;
  completed_at: Date | string;
  duration_ms: number;
}

@Injectable()
export class PrismaEvalRunStore implements EvalRunStore {
  private readonly logger = new Logger(PrismaEvalRunStore.name);

  constructor(@Optional() private readonly prisma?: PrismaService) {}

  async saveRun(run: EvalRunResult): Promise<void> {
    if (!this.prisma) return;

    try {
      await this.prisma.$executeRaw`
        INSERT INTO "harness_eval_runs" (
          "id",
          "dataset_id",
          "dataset_name",
          "dataset_version",
          "status",
          "summary",
          "cases",
          "metadata",
          "started_at",
          "completed_at",
          "duration_ms"
        )
        VALUES (
          ${run.id},
          ${run.datasetId},
          ${run.datasetName},
          ${run.datasetVersion ?? null},
          ${run.status},
          CAST(${this.toJsonString(run.summary)} AS JSONB),
          CAST(${this.toJsonString(run.cases)} AS JSONB),
          CAST(${this.toJsonString(run.metadata ?? {})} AS JSONB),
          ${run.startedAt},
          ${run.completedAt},
          ${run.durationMs}
        )
        ON CONFLICT ("id") DO UPDATE SET
          "dataset_id" = EXCLUDED."dataset_id",
          "dataset_name" = EXCLUDED."dataset_name",
          "dataset_version" = EXCLUDED."dataset_version",
          "status" = EXCLUDED."status",
          "summary" = EXCLUDED."summary",
          "cases" = EXCLUDED."cases",
          "metadata" = EXCLUDED."metadata",
          "started_at" = EXCLUDED."started_at",
          "completed_at" = EXCLUDED."completed_at",
          "duration_ms" = EXCLUDED."duration_ms";
      `;
    } catch (err) {
      this.logger.warn(
        `saveRun failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async getRun(runId: string): Promise<EvalRunResult | null> {
    if (!this.prisma) return null;

    try {
      const rows = await this.prisma.$queryRaw<EvalRunRow[]>`
        SELECT
          "id",
          "dataset_id",
          "dataset_name",
          "dataset_version",
          "status",
          "summary",
          "cases",
          "metadata",
          "started_at",
          "completed_at",
          "duration_ms"
        FROM "harness_eval_runs"
        WHERE "id" = ${runId}
        LIMIT 1;
      `;
      return rows[0] ? this.fromRow(rows[0]) : null;
    } catch (err) {
      this.logger.warn(
        `getRun failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  async listRuns(limit = 50): Promise<EvalRunResult[]> {
    if (!this.prisma) return [];

    try {
      const safeLimit = normalizeLimit(limit);
      const rows = await this.prisma.$queryRaw<EvalRunRow[]>`
        SELECT
          "id",
          "dataset_id",
          "dataset_name",
          "dataset_version",
          "status",
          "summary",
          "cases",
          "metadata",
          "started_at",
          "completed_at",
          "duration_ms"
        FROM "harness_eval_runs"
        ORDER BY "started_at" DESC
        LIMIT ${safeLimit};
      `;
      return rows.map((row) => this.fromRow(row));
    } catch (err) {
      this.logger.warn(
        `listRuns failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  private toJsonString(value: unknown): string {
    return JSON.stringify(value ?? null);
  }

  private fromRow(row: EvalRunRow): EvalRunResult {
    return {
      id: row.id,
      datasetId: row.dataset_id,
      datasetName: row.dataset_name,
      datasetVersion: row.dataset_version ?? undefined,
      status: row.status === "failed" ? "failed" : "completed",
      startedAt: new Date(row.started_at),
      completedAt: new Date(row.completed_at),
      durationMs: row.duration_ms,
      cases: Array.isArray(row.cases) ? row.cases : [],
      summary:
        row.summary && typeof row.summary === "object"
          ? (row.summary as EvalRunResult["summary"])
          : {
              total: 0,
              passed: 0,
              failed: 0,
              errored: 0,
              passRate: 0,
              averageScore: 0,
            },
      metadata:
        row.metadata && typeof row.metadata === "object"
          ? (row.metadata as Record<string, unknown>)
          : undefined,
    };
  }
}

export function createEvalRunStore(
  memory: InMemoryEvalRunStore,
  prisma: PrismaEvalRunStore,
): EvalRunStore {
  return process.env.HARNESS_EVAL_PERSIST === "1" ? prisma : memory;
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 50;
  return Math.max(0, Math.min(500, Math.floor(limit)));
}
