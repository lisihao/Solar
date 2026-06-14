/**
 * AskRoomRuntime - 消息级 turn 编排器
 *
 * 设计：teams-mode.md §6 turn 执行链路
 * 范围（W2-W4，6 mode 全部覆盖）：
 *   - 选 mode（启发式 + roomConfig + 用户显式）
 *   - 创建 AskRoomTurn
 *   - 调用对应 adapter（FREECHAT / PARALLEL_MERGE / DEBATE / VOTE / REVIEW / HANDOFF）
 *   - 落库 adapter 产出的消息
 *   - 终结 turn
 *
 * AbortController 管理：
 *   - 内部维护 turnId -> AbortController 映射，cancelTurn 时调用 abort()
 *   - 关键：runtime 单例进程内有效；多实例部署需用 Redis pub-sub（W5 follow-up）
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  AskMessage,
  AskRoomMember,
  AskRoomMode,
  AskTurnStatus,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  AskRoomServerEvent,
  askRoomKey,
} from "./gateway/ask-room-events.types";
import { FreechatAdapter } from "./adapters/freechat.adapter";
import { ParallelMergeAdapter } from "./adapters/parallel-merge.adapter";
import { DebateAdapter } from "./adapters/debate.adapter";
import { VoteAdapter } from "./adapters/vote.adapter";
import { ReviewAdapter } from "./adapters/review.adapter";
import { HandoffAdapter } from "./adapters/handoff.adapter";
import type {
  IModeAdapter,
  ModeContext,
} from "./adapters/mode-adapter.interface";
import { AskRoomService } from "./ai-ask-room.service";
import { SendRoomMessageDto } from "./dto/send-room-message.dto";
import { AskRoomRuntimeStateStore } from "./ai-ask-room-runtime-state.store";

interface TurnEmitContext {
  sessionId: string;
  emit: (room: string, event: AskRoomServerEvent) => void;
}

const HISTORY_FOR_LLM = 20;
const TURN_CANCEL_POLL_BASE_MS = 500;
const TURN_CANCEL_POLL_MAX_MS = 5_000;
const TURN_CANCEL_DB_FALLBACK_MS = 5_000;

@Injectable()
export class AskRoomRuntimeService {
  private readonly logger = new Logger(AskRoomRuntimeService.name);
  private readonly turnAbortControllers = new Map<string, AbortController>();
  private readonly turnCancellationPollers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly roomService: AskRoomService,
    private readonly runtimeStateStore: AskRoomRuntimeStateStore,
    private readonly freechatAdapter: FreechatAdapter,
    private readonly parallelMergeAdapter: ParallelMergeAdapter,
    private readonly debateAdapter: DebateAdapter,
    private readonly voteAdapter: VoteAdapter,
    private readonly reviewAdapter: ReviewAdapter,
    private readonly handoffAdapter: HandoffAdapter,
  ) {}

  /**
   * 处理一条用户消息：落库 USER 消息 -> 选 mode -> 跑 adapter -> 落库 AI 消息 -> 终结 turn。
   *
   * 调用方（controller / gateway）传入 emit 回调以推送流式事件。
   */
  async runTurn(input: {
    sessionId: string;
    userId: string;
    dto: SendRoomMessageDto;
    emit: TurnEmitContext["emit"];
  }): Promise<{
    turnId: string;
    userMessageId: string;
    userMessageSeq: number | null;
  }> {
    const { sessionId, userId, dto } = input;

    const session = await this.roomService.findUserRoom(sessionId, userId);
    const members = await this.prisma.askRoomMember.findMany({
      where: { sessionId, deletedAt: null },
      orderBy: { order: "asc" },
    });

    const mentionedIds = (dto.mentionedMemberIds ?? []).filter((id) =>
      members.some((m) => m.id === id),
    );

    // 2026-05-09 fix: 把 session 级 in-flight emitted seq 传给 appendUserMessage，
    // 让其取 max(DB MAX, sessionMaxEmittedSeq) + 1，避免 turn N+1 user msg
    // emit seq < turn N 仍在飞的事件 seq → 前端排序错乱。
    const sessionMinSeq =
      await this.runtimeStateStore.getSessionMaxEmittedSeq(sessionId);
    const userMessage = await this.roomService.appendUserMessage(
      sessionId,
      dto.content,
      mentionedIds,
      sessionMinSeq,
    );
    await this.runtimeStateStore.warmSessionMaxEmittedSeq(
      sessionId,
      userMessage.sequenceNum,
    );

    const mode = this.pickMode({
      explicit: dto.mode,
      sessionConfig: session.roomConfig,
      mentionedCount: mentionedIds.length,
      content: dto.content,
    });

    const participants = this.pickParticipants(mode, members, mentionedIds);

    const turn = await this.roomService.createTurn({
      sessionId,
      triggerMessageId: userMessage.id,
      mode,
      participantIds: participants.map((m) => m.id),
    });

    // 异步执行 adapter；不阻塞 controller 返回。
    // 评审 W2 v3 R1 重要：必须 .catch() 兜底防 unhandled rejection。
    void this.executeAdapterAsync({
      sessionId,
      userId,
      turnId: turn.id,
      mode,
      members,
      participants,
      userMessage,
      modeOptions: dto.modeOptions as Record<string, unknown> | undefined,
      emitContext: { sessionId, emit: input.emit },
    }).catch((err) => {
      this.logger.error(
        `[runTurn] turn=${turn.id} unhandled rejection: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });

    return {
      turnId: turn.id,
      userMessageId: userMessage.id,
      // 2026-05-09 fix: 让前端用真实 DB-assigned seq 渲染 user msg，
      // 而非依赖 lastSeq+1 乐观估计。后者在多 turn 并发场景下会与 backend
      // emit seq 错位，导致 user msg 视觉上落到 AI 思考之后。
      userMessageSeq: userMessage.sequenceNum,
    };
  }

  async cancelTurn(
    sessionId: string,
    turnId: string,
    userId: string,
  ): Promise<void> {
    await this.roomService.cancelTurn(sessionId, turnId, userId);
    await this.runtimeStateStore.markTurnCancelled(turnId);
    const controller = this.turnAbortControllers.get(turnId);
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
  }

  // ============ 内部 ============

  private async executeAdapterAsync(input: {
    sessionId: string;
    userId: string;
    turnId: string;
    mode: AskRoomMode;
    members: AskRoomMember[];
    participants: AskRoomMember[];
    userMessage: AskMessage;
    modeOptions?: Record<string, unknown>;
    emitContext: TurnEmitContext;
  }): Promise<void> {
    const {
      sessionId,
      userId,
      turnId,
      mode,
      members,
      participants,
      userMessage,
      modeOptions,
      emitContext,
    } = input;

    const room = askRoomKey(sessionId);
    const controller = new AbortController();
    this.turnAbortControllers.set(turnId, controller);
    this.attachTurnCancellationMonitor(turnId, controller);

    const seqStart = userMessage.sequenceNum ?? 0;
    // 2026-05-09（screenshot 42）：跟踪本 turn 已 emit 的最大 seq，让 turn.complete /
    // turn.error 用 maxEmitted+1 而非 lastMessage.sequenceNum+1。后者在
    // round.end / vote.closed / handoff.* / leader.synthesis.* 等无消息事件
    // 之后会落后于实际 turn 内 seq → 前端 per-turn 单调过滤会丢弃终态事件 →
    // currentTurnStatus 永远 RUNNING → 停止按钮残留。
    let maxEmittedSeq = seqStart;
    const emit = (event: AskRoomServerEvent): void => {
      if (event.sequenceNum > maxEmittedSeq) {
        maxEmittedSeq = event.sequenceNum;
      }
      void this.runtimeStateStore
        .recordSessionMaxEmittedSeq(sessionId, event.sequenceNum)
        .catch((err) => {
          this.logger.warn(
            `[emit] session=${sessionId} seq=${event.sequenceNum} runtime-state sync failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
      emitContext.emit(room, event);
    };
    emit({
      kind: "turn.started",
      turnId,
      sequenceNum: seqStart + 1,
      mode,
      participantIds: participants.map((m) => m.id),
    });

    const adapter = this.resolveAdapter(mode);
    if (!adapter) {
      const errMsg = `Mode ${mode} adapter not implemented in W2 PR3`;
      this.logger.warn(errMsg);
      emit({
        kind: "turn.error",
        turnId,
        sequenceNum: maxEmittedSeq + 1,
        error: errMsg,
      });
      emit({
        kind: "turn.complete",
        turnId,
        sequenceNum: maxEmittedSeq + 1,
        status: "FAILED",
      });
      await this.roomService.finalizeTurn(turnId, AskTurnStatus.FAILED, {
        reason: "adapter_not_implemented",
      });
      this.turnAbortControllers.delete(turnId);
      this.detachTurnCancellationMonitor(turnId);
      await this.runtimeStateStore.clearTurn(turnId);
      return;
    }

    // 评审 W2 v3 R1 次要：用 sequenceNum 排序更可靠（createdAt 毫秒精度可能并列）。
    // 同时按 createdAt 兜底覆盖 SOLO 历史消息（这些消息无 sequenceNum）。
    const orderedDesc = await this.prisma.askMessage.findMany({
      where: { sessionId },
      orderBy: [
        { sequenceNum: { sort: "desc", nulls: "last" } },
        { createdAt: "desc" },
      ],
      take: HISTORY_FOR_LLM,
    });
    const history = orderedDesc.reverse();

    const turn = await this.prisma.askRoomTurn.findUniqueOrThrow({
      where: { id: turnId },
    });

    const ctx: ModeContext = {
      session: await this.prisma.askSession.findUniqueOrThrow({
        where: { id: sessionId },
      }),
      members,
      participants,
      triggerMessage: userMessage,
      history,
      turn,
      modeOptions,
      userId,
      sequenceNumStart: seqStart + 1,
      signal: controller.signal,
    };

    try {
      const result = await adapter.execute(ctx, (event) => {
        emit(event);
      });

      // 落库 adapter 产出的消息
      await this.persistMessages(sessionId, turnId, result.messages);

      // 2026-05-09：用 maxEmittedSeq+1 而非 lastMessage.sequenceNum+1，
      // 确保覆盖 round.end / vote.closed / handoff.* / leader.synthesis.* 等
      // 无消息事件已推过的 seq。
      emit({
        kind: "turn.complete",
        turnId,
        sequenceNum: maxEmittedSeq + 1,
        status: "COMPLETED",
      });
      await this.roomService.finalizeTurn(turnId, AskTurnStatus.COMPLETED, {
        ...result.metadata,
        messageCount: result.messages.length,
      });
    } catch (err) {
      const cancelled = controller.signal.aborted;
      const errMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[runTurn] turn=${turnId} ${cancelled ? "CANCELLED" : "FAILED"}: ${errMessage}`,
      );
      if (cancelled) {
        emit({
          kind: "turn.complete",
          turnId,
          sequenceNum: maxEmittedSeq + 1,
          status: "CANCELLED",
        });
      } else {
        emit({
          kind: "turn.error",
          turnId,
          sequenceNum: maxEmittedSeq + 1,
          error: errMessage,
        });
        emit({
          kind: "turn.complete",
          turnId,
          sequenceNum: maxEmittedSeq + 1,
          status: "FAILED",
        });
      }
      await this.roomService.finalizeTurn(
        turnId,
        cancelled ? AskTurnStatus.CANCELLED : AskTurnStatus.FAILED,
        { error: errMessage },
      );
    } finally {
      this.turnAbortControllers.delete(turnId);
      this.detachTurnCancellationMonitor(turnId);
      await this.runtimeStateStore.clearTurn(turnId);
    }
  }

  private attachTurnCancellationMonitor(
    turnId: string,
    controller: AbortController,
  ): void {
    let nextDbPollAt = 0;
    const poll = async () => {
      if (controller.signal.aborted) return;
      if (await this.runtimeStateStore.isTurnCancelled(turnId)) {
        controller.abort();
        return;
      }
      if (Date.now() < nextDbPollAt) {
        return;
      }
      nextDbPollAt = Date.now() + TURN_CANCEL_DB_FALLBACK_MS;
      const turn = await this.prisma.askRoomTurn.findUnique({
        where: { id: turnId },
        select: { status: true },
      });
      if (turn?.status === AskTurnStatus.CANCELLED) {
        await this.runtimeStateStore.markTurnCancelled(turnId);
        controller.abort();
      }
    };
    let failureCount = 0;
    let inFlight = false;

    const schedule = (delayMs: number) => {
      if (controller.signal.aborted) return;
      const timer = setTimeout(() => {
        void tick();
      }, delayMs);
      timer.unref?.();
      this.turnCancellationPollers.set(turnId, timer);
    };

    const tick = async () => {
      if (controller.signal.aborted || inFlight) return;
      inFlight = true;
      try {
        await poll();
        failureCount = 0;
      } catch (err) {
        failureCount += 1;
        this.logger.warn(
          `[attachTurnCancellationMonitor] turn=${turnId} poll failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      } finally {
        inFlight = false;
      }

      if (!controller.signal.aborted) {
        const delayMs = Math.min(
          TURN_CANCEL_POLL_MAX_MS,
          TURN_CANCEL_POLL_BASE_MS * 2 ** failureCount,
        );
        schedule(delayMs);
      }
    };

    void tick();
  }

  private detachTurnCancellationMonitor(turnId: string): void {
    const timer = this.turnCancellationPollers.get(turnId);
    if (!timer) return;
    clearTimeout(timer);
    this.turnCancellationPollers.delete(turnId);
  }

  /**
   * 评审 W3 v4 R3 重要：用 never 强制 exhaustiveness check。
   * W4 添加 VOTE/REVIEW/HANDOFF case 时，TS 编译器会自动检测遗漏。
   */
  private resolveAdapter(mode: AskRoomMode): IModeAdapter | null {
    switch (mode) {
      case AskRoomMode.FREECHAT:
        return this.freechatAdapter;
      case AskRoomMode.PARALLEL_MERGE:
        return this.parallelMergeAdapter;
      case AskRoomMode.DEBATE:
        return this.debateAdapter;
      case AskRoomMode.VOTE:
        return this.voteAdapter;
      case AskRoomMode.REVIEW:
        return this.reviewAdapter;
      case AskRoomMode.HANDOFF:
        return this.handoffAdapter;
      default: {
        const _exhaustive: never = mode;
        return _exhaustive;
      }
    }
  }

  private pickMode(input: {
    explicit?: AskRoomMode;
    sessionConfig: Prisma.JsonValue;
    mentionedCount: number;
    content: string;
  }): AskRoomMode {
    if (input.explicit) return input.explicit;
    const cfg =
      input.sessionConfig && typeof input.sessionConfig === "object"
        ? (input.sessionConfig as Record<string, unknown>)
        : {};
    if (typeof cfg.defaultMode === "string") {
      const def = cfg.defaultMode as AskRoomMode;
      if (Object.values(AskRoomMode).includes(def)) return def;
    }
    if (input.mentionedCount > 0) return AskRoomMode.FREECHAT;
    return AskRoomMode.FREECHAT;
  }

  private pickParticipants(
    mode: AskRoomMode,
    members: AskRoomMember[],
    mentionedIds: string[],
  ): AskRoomMember[] {
    const enabled = members.filter((m) => m.enabled && !m.deletedAt);
    if (mode === AskRoomMode.FREECHAT) {
      if (mentionedIds.length > 0) {
        return enabled.filter((m) => mentionedIds.includes(m.id));
      }
      const leader = enabled.find((m) => m.role === "LEADER") ?? enabled[0];
      return leader ? [leader] : [];
    }
    if (mode === AskRoomMode.DEBATE && mentionedIds.length > 0) {
      return enabled.filter((m) => mentionedIds.includes(m.id));
    }
    return enabled;
  }

  private async persistMessages(
    sessionId: string,
    turnId: string,
    messages: Array<{
      id: string;
      senderType: "AI" | "SYSTEM";
      senderMemberId: string | null;
      content: string;
      modelId: string | null;
      modelName: string | null;
      tokens: number;
      parentMessageId?: string | null;
      sequenceNum: number;
    }>,
  ): Promise<void> {
    if (messages.length === 0) return;

    // ★ 真因修复（2026-05-08 turn=a70c75a2 P2002）：
    //   adapter 自己算的 sequenceNum 仅用于 socket emit + 前端 store 排序；
    //   写库时若直接用，并发 turn 或历史撞库会整 transaction 回滚 → turn FAILED。
    //   评审 W2 v3 R1 只给 appendUserMessage 加了 nextSequenceNum + retry，
    //   persistMessages 漏修。
    //
    //   修法：写库前 forEach 调用 nextSequenceNum 重新分配 db-seq（保持相对顺序）；
    //   单条 P2002 retry 最多 5 次。db-seq 与 emit-seq 解耦——前端 store 用
    //   emit-seq 排序流式渲染，reload 时从 db 读 db-seq 也单调，两者独立单调即可。
    for (const m of messages) {
      let attempt = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        attempt += 1;
        const seq = await this.roomService.nextSequenceNum(sessionId);
        try {
          await this.prisma.askMessage.create({
            data: {
              id: m.id,
              sessionId,
              role: m.senderType === "AI" ? "assistant" : "system",
              senderType: m.senderType,
              senderMemberId: m.senderMemberId,
              content: m.content,
              modelId: m.modelId,
              modelName: m.modelName,
              tokens: m.tokens,
              parentMessageId: m.parentMessageId ?? null,
              sequenceNum: seq,
              turnId,
            },
          });
          break;
        } catch (err) {
          if (this.isUniqueViolation(err) && attempt < 5) {
            await this.delay(20 * attempt);
            continue;
          }
          throw err;
        }
      }
    }
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: unknown }).code === "P2002"
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
