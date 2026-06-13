/**
 * PrismaCheckpointStore — 生产级 ICheckpointStore 实现
 *
 * 替代 InMemoryCheckpointStore（仅测试/dev 用）。
 *
 * 设计：
 *   - envelope / identity / taskSnapshot / scope 全部走 JSONB（结构化但灵活）
 *   - 序列化前先 toPlainEnvelope / toPlainIdentity，避免 ContextEnvelope 类实例的 method 进 JSON
 *   - 反序列化由 HarnessFacade.resume() 用 ContextEnvelope ctor 重建（本类只返回 plain shape）
 *   - 写入失败抛错（caller 决定是否吃掉，HarnessedAgent 把 snapshot 包在 fire-and-forget 里）
 */

import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import type { ICheckpoint, ICheckpointStore } from "./checkpoint.types";
import type {
  IAgentIdentity,
  IContextEnvelope,
} from "../../agents/abstractions";

@Injectable()
export class PrismaCheckpointStore implements ICheckpointStore {
  private readonly log = new Logger(PrismaCheckpointStore.name);

  constructor(private readonly prisma: PrismaService) {}

  async save(checkpoint: ICheckpoint): Promise<void> {
    await this.prisma.harnessCheckpoint.create({
      data: {
        id: checkpoint.id,
        agentId: checkpoint.agentId,
        reason: checkpoint.reason,
        agentState: checkpoint.agentState,
        envelope: this.toPlainEnvelope(
          checkpoint.envelope,
        ) as Prisma.InputJsonValue,
        identity: this.toPlainIdentity(
          checkpoint.identity,
        ) as Prisma.InputJsonValue,
        eventsEmitted: checkpoint.eventsEmitted,
        taskSnapshot: checkpoint.taskSnapshot
          ? (checkpoint.taskSnapshot as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        scope: Prisma.JsonNull,
        // HARNESS-SEC-001：落归属用户（来自 envelope.userId）供 resume/fork 属主过滤
        ownerUserId: checkpoint.ownerUserId ?? null,
        takenAt: new Date(checkpoint.takenAt),
      },
    });
  }

  async load(id: string): Promise<ICheckpoint | null> {
    const row = await this.prisma.harnessCheckpoint.findUnique({
      where: { id },
    });
    return row ? this.fromRow(row) : null;
  }

  async listByAgent(agentId: string): Promise<readonly ICheckpoint[]> {
    const rows = await this.prisma.harnessCheckpoint.findMany({
      where: { agentId },
      orderBy: { takenAt: "desc" },
    });
    return rows.map((r) => this.fromRow(r));
  }

  async delete(id: string): Promise<void> {
    await this.prisma.harnessCheckpoint
      .delete({ where: { id } })
      .catch((err: unknown) => {
        // P2025 = record to delete does not exist — idempotent
        const code =
          typeof err === "object" && err !== null && "code" in err
            ? (err as { code: string }).code
            : undefined;
        if (code !== "P2025") throw err;
      });
  }

  async clear(): Promise<void> {
    // Defensive: prod must NOT call clear. Keep for parity with interface.
    if (process.env.NODE_ENV === "production") {
      this.log.warn(
        "PrismaCheckpointStore.clear called in production — refused",
      );
      return;
    }
    await this.prisma.harnessCheckpoint.deleteMany({});
  }

  // ── helpers ─────────────────────────────────────────────────────

  private fromRow(row: {
    id: string;
    agentId: string;
    reason: string;
    agentState: string;
    envelope: unknown;
    identity: unknown;
    eventsEmitted: number;
    taskSnapshot: unknown;
    ownerUserId: string | null;
    takenAt: Date;
  }): ICheckpoint {
    return {
      id: row.id,
      agentId: row.agentId,
      ownerUserId: row.ownerUserId ?? undefined,
      reason: row.reason as ICheckpoint["reason"],
      agentState: row.agentState as ICheckpoint["agentState"],
      envelope: row.envelope as IContextEnvelope,
      identity: row.identity as IAgentIdentity,
      eventsEmitted: row.eventsEmitted,
      taskSnapshot:
        (row.taskSnapshot as ICheckpoint["taskSnapshot"]) ?? undefined,
      takenAt: row.takenAt.getTime(),
    };
  }

  /**
   * Strip class methods / non-enumerable from ContextEnvelope before JSON store.
   * 直接结构化提取，比 JSON.parse(JSON.stringify(...)) 更明确，避免吃掉 metadata 里的 BigInt 等。
   */
  private toPlainEnvelope(env: IContextEnvelope): object {
    return {
      id: env.id,
      system: env.system,
      messages: [...env.messages],
      reminders: [...env.reminders],
      tools: [...env.tools],
      memory: { ...env.memory },
      budget: { ...env.budget },
      metadata: env.metadata ? { ...env.metadata } : undefined,
    };
  }

  private toPlainIdentity(identity: IAgentIdentity): object {
    return {
      role: { ...identity.role },
      persona: identity.persona ? { ...identity.persona } : undefined,
      goal: identity.goal ? { ...identity.goal } : undefined,
      constraints: identity.constraints
        ? { ...identity.constraints }
        : undefined,
      skills: identity.skills ? [...identity.skills] : [],
      tools: identity.tools ? [...identity.tools] : [],
      forbiddenTools: identity.forbiddenTools
        ? [...identity.forbiddenTools]
        : undefined,
    };
  }
}
