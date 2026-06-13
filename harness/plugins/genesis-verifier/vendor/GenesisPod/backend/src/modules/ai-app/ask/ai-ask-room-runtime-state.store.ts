import { Injectable, Logger, Optional } from "@nestjs/common";
import { CacheService } from "@/common/cache/cache.service";
import { PrismaService } from "@/common/prisma/prisma.service";

const SESSION_SEQ_KEY_PREFIX = "ask:room:seq:";
const TURN_CANCEL_KEY_PREFIX = "ask:room:turn-cancel:";
const SESSION_SEQ_TTL_SECONDS = 24 * 60 * 60;
const TURN_CANCEL_TTL_SECONDS = 2 * 60 * 60;

@Injectable()
export class AskRoomRuntimeStateStore {
  private readonly logger = new Logger(AskRoomRuntimeStateStore.name);
  private readonly localSessionMaxSeq = new Map<string, number>();
  private readonly localCancelledTurns = new Set<string>();

  constructor(
    @Optional() private readonly cache?: CacheService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  async getSessionMaxEmittedSeq(sessionId: string): Promise<number> {
    const local = this.localSessionMaxSeq.get(sessionId) ?? 0;
    const cached = await this.safeCacheGet<number>(
      SESSION_SEQ_KEY_PREFIX + sessionId,
    );
    const persisted = this.prisma
      ? ((
          await this.prisma.askRoomSessionRuntimeState.findUnique({
            where: { sessionId },
            select: { maxEmittedSeq: true },
          })
        )?.maxEmittedSeq ?? 0)
      : 0;
    return Math.max(local, cached ?? 0, persisted);
  }

  async recordSessionMaxEmittedSeq(
    sessionId: string,
    sequenceNum: number,
  ): Promise<number> {
    const local = this.localSessionMaxSeq.get(sessionId) ?? 0;
    let next = Math.max(local, sequenceNum);

    if (this.prisma) {
      const rows = await this.prisma.$queryRaw<{ max_emitted_seq: number }[]>`
        INSERT INTO ask_room_session_runtime_states
          ("session_id", "max_emitted_seq", "created_at", "updated_at")
        VALUES (${sessionId}, ${sequenceNum}, NOW(), NOW())
        ON CONFLICT ("session_id")
        DO UPDATE SET
          "max_emitted_seq" = GREATEST(
            ask_room_session_runtime_states."max_emitted_seq",
            EXCLUDED."max_emitted_seq"
          ),
          "updated_at" = NOW()
        RETURNING "max_emitted_seq"
      `;
      next = Math.max(next, rows[0]?.max_emitted_seq ?? 0);
    } else {
      const cached = await this.safeCacheGet<number>(
        SESSION_SEQ_KEY_PREFIX + sessionId,
      );
      next = Math.max(next, cached ?? 0);
    }

    this.localSessionMaxSeq.set(sessionId, next);
    await this.cache?.set(
      SESSION_SEQ_KEY_PREFIX + sessionId,
      next,
      SESSION_SEQ_TTL_SECONDS,
    );
    return next;
  }

  async markTurnCancelled(turnId: string): Promise<void> {
    this.localCancelledTurns.add(turnId);
    await this.cache?.set(
      TURN_CANCEL_KEY_PREFIX + turnId,
      true,
      TURN_CANCEL_TTL_SECONDS,
    );
  }

  async isTurnCancelled(turnId: string): Promise<boolean> {
    if (this.cache) {
      const cached = await this.safeCacheGet<boolean>(
        TURN_CANCEL_KEY_PREFIX + turnId,
      );
      if (cached) {
        this.localCancelledTurns.add(turnId);
        return true;
      }
      this.localCancelledTurns.delete(turnId);
      return false;
    }
    return this.localCancelledTurns.has(turnId);
  }

  async clearTurn(turnId: string): Promise<void> {
    this.localCancelledTurns.delete(turnId);
    await this.cache?.del(TURN_CANCEL_KEY_PREFIX + turnId);
  }

  async clearSession(sessionId: string): Promise<void> {
    this.localSessionMaxSeq.delete(sessionId);
    await this.cache?.del(SESSION_SEQ_KEY_PREFIX + sessionId);
  }

  async warmSessionMaxEmittedSeq(
    sessionId: string,
    sequenceNum: number | null | undefined,
  ): Promise<void> {
    if (typeof sequenceNum !== "number" || !Number.isFinite(sequenceNum))
      return;
    try {
      await this.recordSessionMaxEmittedSeq(sessionId, sequenceNum);
    } catch (err) {
      this.logger.warn(
        `[warmSessionMaxEmittedSeq] session=${sessionId} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async safeCacheGet<T>(key: string): Promise<T | undefined> {
    if (!this.cache) return undefined;
    try {
      return await this.cache.get<T>(key);
    } catch (err) {
      this.logger.warn(
        `[safeCacheGet] key=${key} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return undefined;
    }
  }
}
