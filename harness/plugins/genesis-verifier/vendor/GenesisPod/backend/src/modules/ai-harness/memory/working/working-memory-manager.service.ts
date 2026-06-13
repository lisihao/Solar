/**
 * Working Memory Manager Service
 * Process-level memory management backed by ProcessMemory table.
 */
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { MemoryLayer, Prisma } from "@prisma/client";
import type {
  ProcessId,
  MemoryEntry,
  MemoryQuery as KernelMemoryQuery,
} from "../../../ai-harness/lifecycle/manager/process.types";

@Injectable()
export class WorkingMemoryManagerService implements OnModuleInit {
  private readonly logger = new Logger(WorkingMemoryManagerService.name);
  private tableReady = false;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    this.tableReady = await this.checkTableExists("process_memories");
    if (!this.tableReady) {
      this.logger.warn("process_memories table not found — service disabled");
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

  async read(
    processId: ProcessId,
    layer: MemoryLayer,
    key: string,
  ): Promise<unknown | null> {
    if (!this.tableReady) return null;
    const entry = await this.prisma.processMemory.findUnique({
      where: { processId_layer_key: { processId, layer, key } },
    });
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt < new Date()) {
      await this.prisma.processMemory.delete({ where: { id: entry.id } });
      return null;
    }
    return entry.value;
  }

  async write(entry: MemoryEntry): Promise<void> {
    if (!this.tableReady) return;
    await this.prisma.processMemory.upsert({
      where: {
        processId_layer_key: {
          processId: entry.processId,
          layer: entry.layer,
          key: entry.key,
        },
      },
      update: {
        value: entry.value as Prisma.InputJsonValue,
        expiresAt: entry.expiresAt ?? null,
      },
      create: {
        processId: entry.processId,
        layer: entry.layer,
        key: entry.key,
        value: entry.value as Prisma.InputJsonValue,
        expiresAt: entry.expiresAt,
      },
    });
  }

  async query(query: KernelMemoryQuery): Promise<MemoryEntry[]> {
    if (!this.tableReady) return [];
    const where: Record<string, unknown> = { processId: query.processId };
    if (query.layer) where.layer = query.layer;
    if (query.keyPattern) where.key = { contains: query.keyPattern };

    const results = await this.prisma.processMemory.findMany({
      where,
      take: query.limit ?? 100,
      orderBy: { updatedAt: "desc" },
    });

    return results.map((r) => ({
      processId: r.processId,
      layer: r.layer,
      key: r.key,
      value: r.value,
      expiresAt: r.expiresAt ?? undefined,
    }));
  }

  async cleanup(processId: ProcessId): Promise<number> {
    if (!this.tableReady) return 0;
    const now = new Date();
    const result = await this.prisma.processMemory.deleteMany({
      where: {
        processId,
        expiresAt: { lt: now },
      },
    });
    return result.count;
  }

  async deleteAll(processId: ProcessId): Promise<number> {
    if (!this.tableReady) return 0;
    const result = await this.prisma.processMemory.deleteMany({
      where: { processId },
    });
    return result.count;
  }
}
