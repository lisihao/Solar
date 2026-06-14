/**
 * DEBATE mode adapter
 *
 * 设计：teams-mode.md §5.2 DEBATE 行
 *
 * 行为：
 *   1. 选 RED / BLUE / 可选 JUDGE 三个成员（按 order / role 启发式）
 *   2. 把 AskRoomMember 投影成 IDebateAgent（chat 通过 ChatFacade 实现）
 *   3. 调用 harness DebatePattern.runDebate（多轮 RED → BLUE）
 *   4. 把 RoundResult 序列翻译成 PendingMessage + emit 流式事件
 *
 * 注意：本 adapter 是 W1 PR2 DebatePattern 的第一个真实消费方，
 * pattern 接口本身已通过 16/16 单测；adapter 只做投影和事件桥接。
 *
 * 流式：每回合的 chat 调用走 chatFacade.chatStream，按 chunk 推 participant.partial。
 * DebatePattern 本身不变（它只看 chat 回调的最终 {content, tokensUsed}）；
 * adapter 在回调内部完成 streaming → 累积 → 返回。
 */

import { Injectable, Logger } from "@nestjs/common";
import { v4 as uuid } from "uuid";
import { AIModelType, AskRoomMember, AskRoomMode } from "@prisma/client";
import {
  ChatFacade,
  DebatePattern,
  type ChatMessage,
  type DebateRole,
  type DebateRoundResult,
  type IDebateAgent,
} from "@/modules/ai-harness/facade";
import {
  emitSystemNotice,
  type IModeAdapter,
  type ModeContext,
  type ModeResult,
  type PendingMessage,
} from "./mode-adapter.interface";
import type { AskRoomServerEvent } from "../gateway/ask-room-events.types";

const DEFAULT_DEBATE_ROUNDS = 3;

/**
 * 显式 abort 错误。runtime 通过 instanceof 区分 CANCELLED / FAILED。
 * 评审 W3 v4 R2 重要：避免与 chat 抛错混淆。
 */
export class DebateAbortError extends Error {
  constructor(reason = "DEBATE adapter aborted") {
    super(reason);
    this.name = "DebateAbortError";
  }
}

@Injectable()
export class DebateAdapter implements IModeAdapter {
  readonly mode = AskRoomMode.DEBATE;
  private readonly logger = new Logger(DebateAdapter.name);

  constructor(
    private readonly chatFacade: ChatFacade,
    private readonly debatePattern: DebatePattern,
  ) {}

  async execute(
    ctx: ModeContext,
    onEvent: (e: AskRoomServerEvent) => void,
  ): Promise<ModeResult> {
    const enabled = (ctx.participants ?? ctx.members).filter(
      (m) => m.enabled && !m.deletedAt,
    );
    const roles = this.assignRoles(enabled);
    if (!roles) {
      this.logger.warn(
        `[DEBATE] turn=${ctx.turn.id} not enough members for RED+BLUE`,
      );
      const notice = emitSystemNotice(
        onEvent,
        ctx.turn.id,
        ctx.sequenceNumStart + 1,
        "DEBATE 模式至少需要 2 名启用成员（正方 + 反方）。请添加或启用更多成员后重试。",
      );
      return {
        messages: [notice],
        metadata: { reason: "insufficient_members" },
      };
    }
    const { red, blue, judge } = roles;

    const cfg = (ctx.session.roomConfig ?? {}) as Record<string, unknown>;
    const maxRounds =
      typeof cfg.debateRounds === "number"
        ? cfg.debateRounds
        : DEFAULT_DEBATE_ROUNDS;
    const enableJudge = judge !== null;

    let seq = ctx.sequenceNumStart;
    const eventByRound = new Map<number, void>();

    const emitRoundStart = (round: number): void => {
      if (eventByRound.has(round)) return;
      eventByRound.set(round, undefined);
      seq += 1;
      onEvent({
        kind: "round.start",
        turnId: ctx.turn.id,
        sequenceNum: seq,
        round,
      });
    };

    const memberById = new Map(ctx.members.map((m) => [m.id, m]));
    const messageIdByRoundAndMember = new Map<string, string>();
    // 2026-05-08 R2 评审：之前 messages.map 重新分配 seq，与 participant.done
    // 事件的 seq 不一致 → 违反 PendingMessage.sequenceNum 契约。改为捕获每条
    // done 事件的 seq，messages[].sequenceNum 直接复用。
    const doneSeqByRoundAndMember = new Map<string, number>();

    const buildAgent = (
      member: AskRoomMember,
      role: DebateRole,
    ): IDebateAgent => {
      const stance =
        role === "RED" ? "正方" : role === "BLUE" ? "反方" : "裁判";
      return {
        id: member.id,
        displayName: member.displayName,
        role,
        stance,
        metadata: {
          modelId: member.modelId,
          turnId: ctx.turn.id,
          sessionId: ctx.session.id,
        },
        chat: async ({ systemPrompt, history, userMessage }) => {
          if (ctx.signal.aborted) {
            throw new DebateAbortError();
          }
          // 评审 W3 v4 R2 阻塞：round 推断协议依赖 DebatePattern 实现细节。
          // 协议（W1 PR2 debate-pattern.ts:125-128, 152-156）：
          //   - 每回合 RED/BLUE 各自 history.push 2 entries（user prompt + assistant reply）
          //   - JUDGE 在 maxRounds 之后执行，自身 history 为空（独立 IDebateAgent），
          //     通过 history.length=0 但 results 已含 RED/BLUE 全部回合识别
          //   - 因此 history.length / 2 + 1 是当前 agent 自身的下一回合编号
          // 若 pattern 协议变更（如改 history 维护策略），此处会无声破坏。
          // 长期方案：让 pattern 显式向 chat 入参传 round（W1 follow-up F2 已登记）
          const round =
            role === "JUDGE"
              ? maxRounds + 1 // pattern 内 JUDGE.round=maxRounds+1（行 197）
              : Math.floor(history.length / 2) + 1;
          if (role !== "JUDGE") {
            emitRoundStart(round);
          }

          const messageId = uuid();
          messageIdByRoundAndMember.set(`${round}:${member.id}`, messageId);
          seq += 1;
          onEvent({
            kind: "participant.thinking",
            turnId: ctx.turn.id,
            sequenceNum: seq,
            memberId: member.id,
            messageId,
          });

          const llmMessages: ChatMessage[] = [
            { role: "system", content: systemPrompt },
            ...history,
            { role: "user", content: userMessage },
          ];
          // 流式：增量 chunk 推 participant.partial。失败/中断用占位回退，
          // 让 DebatePattern 仍能拿到非空 content 继续后续回合。
          let streamed = "";
          let streamError: string | null = null;
          try {
            for await (const chunk of this.chatFacade.chatStream({
              messages: llmMessages,
              model: member.modelId,
              modelType: AIModelType.CHAT,
              taskProfile: { creativity: "medium", outputLength: "standard" },
              billing: {
                userId: ctx.userId,
                moduleType: "ai-ask",
                operationType: "room-debate",
                referenceId: ctx.turn.id,
                description: `AI Ask Room DEBATE - ${member.displayName} (${role})`,
              },
            })) {
              if (ctx.signal.aborted) {
                throw new DebateAbortError();
              }
              if (chunk.error) {
                streamError = chunk.error;
                break;
              }
              if (chunk.content) {
                streamed += chunk.content;
                seq += 1;
                onEvent({
                  kind: "participant.partial",
                  turnId: ctx.turn.id,
                  sequenceNum: seq,
                  memberId: member.id,
                  messageId,
                  deltaText: chunk.content,
                });
              }
            }
          } catch (err) {
            if (err instanceof DebateAbortError || ctx.signal.aborted)
              throw err;
            streamError = err instanceof Error ? err.message : String(err);
            this.logger.warn(
              `[DEBATE] member=${member.displayName} role=${role} stream failed: ${streamError}`,
            );
          }

          // [B2 2026-05-09] streamError 即视为失败：保留半截 + 错误后缀让下一轮
          // 辩手看到上一轮被中断而非整段静默通过。
          let chatContent: string;
          let chatTokens: number;
          if (streamError) {
            chatContent = streamed
              ? `${streamed}\n\n[输出被中断]`
              : "[error] AI 服务暂时不可用，请稍后重试";
            chatTokens = 0;
          } else {
            chatContent = streamed;
            chatTokens = Math.ceil(streamed.length / 4);
          }

          seq += 1;
          doneSeqByRoundAndMember.set(`${round}:${member.id}`, seq);
          onEvent({
            kind: "participant.done",
            turnId: ctx.turn.id,
            sequenceNum: seq,
            memberId: member.id,
            messageId,
            tokensUsed: chatTokens,
            content: chatContent,
          });
          return { content: chatContent, tokensUsed: chatTokens };
        },
      };
    };

    const agents: IDebateAgent[] = [
      buildAgent(red, "RED"),
      buildAgent(blue, "BLUE"),
    ];
    if (enableJudge && judge) {
      agents.push(buildAgent(judge, "JUDGE"));
    }

    let results: DebateRoundResult[];
    try {
      results = await this.debatePattern.runDebate({
        topic: ctx.triggerMessage.content,
        agents,
        config: {
          maxRounds,
          enableJudge,
          signal: ctx.signal,
        },
      });
    } catch (err) {
      // 2026-05-08 R2 评审：runDebate 自身抛错（非 chat() 失败 — 已在 buildAgent
      // 内 catch）也用 system.notice 兜底，避免整 turn FAIL 让用户看不到原因。
      // AbortError 仍透传到 runtime 让其分类为 CANCELLED。
      // [2026-05-09] 加 err.name === "AbortError" 兜底标准 AbortError（DebatePattern
      // 内部 sleep/setTimeout 触发的 abort 可能用标准 AbortError 而非 DebateAbortError）。
      const isAbort =
        ctx.signal.aborted ||
        err instanceof DebateAbortError ||
        (err instanceof Error && err.name === "AbortError");
      if (isAbort) {
        throw err;
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[DEBATE] runDebate failed turn=${ctx.turn.id}: ${errMsg}`,
      );
      const messages: PendingMessage[] = [];
      seq += 1;
      messages.push(
        emitSystemNotice(
          onEvent,
          ctx.turn.id,
          seq,
          "辩论流程异常中断，请稍后重试或切换到 PARALLEL_MERGE 模式。",
        ),
      );
      return {
        messages,
        metadata: {
          rounds: maxRounds,
          enableJudge,
          red: red.id,
          blue: blue.id,
          judge: judge?.id ?? null,
          speeches: 0,
          patternFailed: true,
        },
      };
    }

    // round.end 事件（每个 round RED+BLUE 完成后发一次）
    const roundsCovered = new Set(
      results.filter((r) => r.role !== "JUDGE").map((r) => r.round),
    );
    for (const r of [...roundsCovered].sort((a, b) => a - b)) {
      seq += 1;
      onEvent({
        kind: "round.end",
        turnId: ctx.turn.id,
        sequenceNum: seq,
        round: r,
      });
    }

    const messages: PendingMessage[] = results.map((r) => {
      const member = memberById.get(r.speakerId);
      const lookupKey = `${r.round}:${r.speakerId}`;
      const messageId = messageIdByRoundAndMember.get(lookupKey) ?? uuid();
      // 2026-05-08 R2 评审：复用 participant.done 时捕获的 seq，保证与事件契约
      // PendingMessage.sequenceNum === participant.done.sequenceNum 一致。
      // 兜底：JUDGE 等极端情况未命中时用新 seq（不应发生，但防御）。
      const doneSeq = doneSeqByRoundAndMember.get(lookupKey);
      const messageSeq = doneSeq ?? ++seq;
      return {
        id: messageId,
        senderType: "AI",
        senderMemberId: member?.id ?? null,
        content: r.content,
        modelId: member?.modelId ?? null,
        modelName: null,
        tokens: r.tokensUsed ?? 0,
        parentMessageId: ctx.triggerMessage.id,
        sequenceNum: messageSeq,
      };
    });

    return {
      messages,
      metadata: {
        rounds: maxRounds,
        enableJudge,
        red: red.id,
        blue: blue.id,
        judge: judge?.id ?? null,
        speeches: results.length,
      },
    };
  }

  // ============ 内部 ============

  private assignRoles(members: AskRoomMember[]): {
    red: AskRoomMember;
    blue: AskRoomMember;
    judge: AskRoomMember | null;
  } | null {
    if (members.length < 2) return null;
    // 评审 W3 v4 R2 次要：order 相等 tiebreaker by id 保证确定性。
    const sorted = [...members].sort(
      (a, b) => a.order - b.order || a.id.localeCompare(b.id),
    );
    const leader = sorted.find((m) => m.role === "LEADER");
    const nonLeader = sorted.filter((m) => m.id !== leader?.id);

    let red: AskRoomMember | undefined;
    let blue: AskRoomMember | undefined;
    let judge: AskRoomMember | null = null;

    if (members.length >= 3) {
      red = nonLeader[0];
      blue = nonLeader[1];
      judge = leader ?? nonLeader[2] ?? null;
      // 评审 W3 v4 R2 阻塞：4+ 成员时 nonLeader[3..] 被丢弃，加 warn 提示用户。
      const excluded = members.length - (judge ? 3 : 2);
      if (excluded > 0) {
        this.logger.warn(
          `[DEBATE] room has ${members.length} members; ${excluded} excluded ` +
            `(only RED/BLUE${judge ? "/JUDGE" : ""} participate). ` +
            `Consider PARALLEL_MERGE for full participation.`,
        );
      }
    } else {
      red = sorted[0];
      blue = sorted[1];
    }

    if (!red || !blue) return null;
    return { red, blue, judge };
  }
}
