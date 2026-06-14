import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  ProcessId,
  JournalEntry,
  StepResult,
} from "../../../ai-harness/lifecycle/manager/process.types";

@Injectable()
export class EventJournalService implements OnModuleInit {
  private readonly logger = new Logger(EventJournalService.name);
  private tableReady = false;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    this.tableReady = await this.checkTableExists("process_events");
    if (!this.tableReady) {
      this.logger.warn("process_events table not found — service disabled");
    }
  }

  private async checkTableExists(tableName: string): Promise<boolean> {
    try {
      const result = await this.prisma.$queryRaw<[{ exists: boolean }]>(
        Prisma.sql`SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=${tableName}) AS "exists"`,
      );
      return result[0]?.exists ?? false;
    } catch {
      return false;
    }
  }

  /**
   * Record a new event for the process.
   * Sequence number is calculated atomically via MAX(sequence)+1 in a single INSERT.
   */
  async record(
    processId: ProcessId,
    type: string,
    payload?: Record<string, unknown>,
    result?: Record<string, unknown>,
  ): Promise<JournalEntry> {
    if (!this.tableReady) {
      return {
        id: "disabled",
        processId,
        sequence: 0,
        type,
        payload: payload ?? null,
        result: result ?? null,
        createdAt: new Date(),
      } as JournalEntry;
    }

    // ★ 2026-05-11 FK-guard：用 INSERT ... SELECT WHERE EXISTS 把不存在的 process_id
    //   变成 0 行 INSERT（没 SQL 异常 → PrismaService 不再在 ERROR 级刷屏）。
    //
    //   背景：多条 L3 链路把 MissionContext.processId 设成 missionId / sessionId
    //   而不是 AgentProcess.id。下游 ai-chat.service 会读 MissionContext.getAgentProcessId()
    //   并 emit "llm.journal.record"。EventJournal 之前 INSERT 直发会触发 23503 FK 违规，
    //   每分钟数十条 [PrismaService] ERROR。
    //
    //   行为差异：
    //     - process_id 在 agent_processes 中存在 → 与之前一致（写一行 + 返回 entry）
    //     - 不存在 → INSERT 0 行 → 返回 disabled 占位（行为同 tableReady=false 路径）
    //   不再依赖"必须为 AgentProcess id"的隐式约定，但也没有自动建父行（journal 仍只
    //   是观测，不是数据源）。根因清理（MissionContext.processId 不再被滥用为 missionId）
    //   走单独的后续 PR。
    const entries = await this.prisma.$queryRaw<JournalEntry[]>(Prisma.sql`
      INSERT INTO process_events (id, process_id, sequence, type, payload, result, created_at)
      SELECT
        gen_random_uuid(),
        ${processId},
        COALESCE((SELECT MAX(sequence) FROM process_events WHERE process_id = ${processId}), 0) + 1,
        ${type},
        ${payload ? JSON.stringify(payload) : null}::jsonb,
        ${result ? JSON.stringify(result) : null}::jsonb,
        NOW()
      WHERE EXISTS (SELECT 1 FROM agent_processes WHERE id = ${processId})
      RETURNING id, process_id AS "processId", sequence, type, payload, result, created_at AS "createdAt"
    `);

    const entry = entries[0];
    if (!entry) {
      this.logger.debug(
        `[record] Skipped: no AgentProcess row for processId=${processId} type="${type}"`,
      );
      return {
        id: "skipped-no-parent",
        processId,
        sequence: 0,
        type,
        payload: payload ?? null,
        result: result ?? null,
        createdAt: new Date(),
      } as JournalEntry;
    }

    this.logger.debug(
      `[record] Process ${processId} event #${entry.sequence} type="${type}"`,
    );

    return entry;
  }

  /**
   * Idempotent step execution with event sourcing.
   *
   * If an event with the same processId + type already exists in the DB,
   * the stored result is returned directly (replay mode).
   * Otherwise, the step is executed, the result is persisted, and then returned.
   */
  async recordStep<T>(processId: ProcessId, step: StepResult<T>): Promise<T> {
    if (!this.tableReady) return step.execute();
    const existing = await this.prisma.processEvent.findFirst({
      where: {
        processId,
        type: step.type,
      },
    });

    if (existing) {
      this.logger.debug(
        `[recordStep] Replaying existing event type="${step.type}" for process ${processId}`,
      );
      return existing.result as T;
    }

    const result = await step.execute();

    await this.record(
      processId,
      step.type,
      step.payload,
      result as Record<string, unknown>,
    );

    return result;
  }

  /**
   * Return all events for a process in chronological order.
   */
  async replay(processId: ProcessId): Promise<JournalEntry[]> {
    if (!this.tableReady) return [];
    const events = await this.prisma.processEvent.findMany({
      where: { processId },
      orderBy: { sequence: "asc" },
    });

    return events.map((e) => this.toJournalEntry(e));
  }

  /**
   * Paginated event history for a process.
   */
  async getHistory(
    processId: ProcessId,
    options?: { limit?: number; offset?: number },
  ): Promise<{ entries: JournalEntry[]; total: number }> {
    if (!this.tableReady) return { entries: [], total: 0 };
    const limit = options?.limit;
    const offset = options?.offset ?? 0;

    const [events, total] = await Promise.all([
      this.prisma.processEvent.findMany({
        where: { processId },
        orderBy: { sequence: "asc" },
        skip: offset,
        ...(limit !== undefined ? { take: limit } : {}),
      }),
      this.prisma.processEvent.count({ where: { processId } }),
    ]);

    return {
      entries: events.map((e) => this.toJournalEntry(e)),
      total,
    };
  }

  /**
   * Cast a Prisma ProcessEvent record to JournalEntry.
   * Field shapes are compatible — cast via unknown.
   */
  private toJournalEntry(record: unknown): JournalEntry {
    return record as JournalEntry;
  }
}
