/**
 * HANDOFF mode adapter
 *
 * 设计：teams-mode.md §5.2 HANDOFF 行
 *
 * 行为：
 *   1. 起始 member（modeOptions.startMemberId 或 leader）chat 一次
 *   2. 解析输出末尾的 "[HANDOFF: targetId]" 标记
 *      - 若有 → emit handoff.request；目标存在且未访问过 → handoff.accepted；切到 target
 *      - 若无 → 视为最终回答，结束
 *   3. 最大深度 5（沿用 HandoffCoordinator.DEFAULT_CONFIG）
 *   4. 输出消息链：每个被访问 member 一条
 *
 * 备注：harness `HandoffCoordinator` 在 ai-harness/teams/collaboration/patterns/handoff-pattern。
 * 本期采用"标记驱动"简化版（agent 自然语言判断 + 结构化标记）；
 * v0.3 升级为 ToolCall-based handoff（agent 通过工具显式发起）。
 *
 * 流式：askMember 走 chatFacade.chatStream，按 chunk 推 participant.partial（含
 * `[HANDOFF: x]` tag 原始字符）。caller 在 participant.done emit 时用 cleanContent
 * （已剥掉 tag）替换前端展示。
 */

import { Injectable, Logger } from "@nestjs/common";
import { v4 as uuid } from "uuid";
import { AIModelType, AskRoomMember, AskRoomMode } from "@prisma/client";
import { ChatFacade, type ChatMessage } from "@/modules/ai-harness/facade";
import {
  emitSystemNotice,
  type IModeAdapter,
  type ModeContext,
  type ModeResult,
  type PendingMessage,
} from "./mode-adapter.interface";
import type { AskRoomServerEvent } from "../gateway/ask-room-events.types";

interface HandoffOptionsInput {
  startMemberId?: string;
}

const HANDOFF_TAG_RE = /\[HANDOFF\s*[:：]\s*([a-zA-Z0-9_-]{1,64})\s*\]/i;
const MAX_HANDOFF_DEPTH = 5;

@Injectable()
export class HandoffAdapter implements IModeAdapter {
  readonly mode = AskRoomMode.HANDOFF;
  private readonly logger = new Logger(HandoffAdapter.name);

  constructor(private readonly chatFacade: ChatFacade) {}

  async execute(
    ctx: ModeContext,
    onEvent: (e: AskRoomServerEvent) => void,
  ): Promise<ModeResult> {
    const enabled = ctx.members.filter((m) => m.enabled && !m.deletedAt);
    let seq = ctx.sequenceNumStart;
    const messages: PendingMessage[] = [];

    if (enabled.length === 0) {
      seq += 1;
      messages.push(
        emitSystemNotice(
          onEvent,
          ctx.turn.id,
          seq,
          "房间内没有可用的成员。请在右侧成员面板启用至少一名成员后重试。",
        ),
      );
      return { messages, metadata: { reason: "no_participants" } };
    }

    const start = this.pickStart(enabled, ctx.modeOptions);
    if (!start) {
      seq += 1;
      messages.push(
        emitSystemNotice(
          onEvent,
          ctx.turn.id,
          seq,
          "未能确定 HANDOFF 起始成员。请检查 modeOptions.startMemberId 或确保至少有一名启用成员。",
        ),
      );
      return { messages, metadata: { reason: "no_start_member" } };
    }
    const visited = new Set<string>();
    const chain: string[] = [];

    let current: AskRoomMember | null = start;
    let lastMessageId: string | null = null;
    let depth = 0;

    while (current && depth < MAX_HANDOFF_DEPTH) {
      this.assertNotAborted(ctx.signal);
      if (visited.has(current.id)) {
        this.logger.warn(
          `[HANDOFF] cycle detected at member=${current.displayName}; stopping`,
        );
        seq += 1;
        messages.push(
          emitSystemNotice(
            onEvent,
            ctx.turn.id,
            seq,
            `检测到 handoff 环路（${current.displayName} 已发言），链路终止。`,
          ),
        );
        break;
      }
      visited.add(current.id);
      chain.push(current.id);

      const messageId = uuid();
      seq += 1;
      onEvent({
        kind: "participant.thinking",
        turnId: ctx.turn.id,
        sequenceNum: seq,
        memberId: current.id,
        messageId,
      });

      // 2026-05-08：单成员 chat() 失败用 error 占位 done，不阻断整 turn（之前
      // 抛错让整 turn FAIL，用户什么都看不到）。
      let chatResult: { content: string; tokensUsed: number };
      try {
        chatResult = await this.askMember(current, ctx, enabled, {
          messageId,
          memberId: current.id,
          onEvent,
          nextSeq: () => {
            seq += 1;
            return seq;
          },
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `[HANDOFF] member=${current.displayName} chat failed: ${errMsg}`,
        );
        seq += 1;
        const failContent = "[error] AI 服务暂时不可用，请稍后重试";
        onEvent({
          kind: "participant.done",
          turnId: ctx.turn.id,
          sequenceNum: seq,
          memberId: current.id,
          messageId,
          tokensUsed: 0,
          content: failContent,
        });
        messages.push({
          id: messageId,
          senderType: "AI",
          senderMemberId: current.id,
          content: failContent,
          modelId: current.modelId,
          modelName: null,
          tokens: 0,
          parentMessageId: lastMessageId ?? ctx.triggerMessage.id,
          sequenceNum: seq,
        });
        break;
      }

      const tagged = chatResult.content.match(HANDOFF_TAG_RE);
      const cleanContent = tagged
        ? chatResult.content.replace(HANDOFF_TAG_RE, "").trimEnd()
        : chatResult.content;
      seq += 1;
      onEvent({
        kind: "participant.done",
        turnId: ctx.turn.id,
        sequenceNum: seq,
        memberId: current.id,
        messageId,
        tokensUsed: chatResult.tokensUsed,
        content: cleanContent, // 推送已剥掉 [handoff:xxx] 标签的内容
      });

      messages.push({
        id: messageId,
        senderType: "AI",
        senderMemberId: current.id,
        content: cleanContent,
        modelId: current.modelId,
        modelName: null,
        tokens: chatResult.tokensUsed,
        parentMessageId: lastMessageId ?? ctx.triggerMessage.id,
        sequenceNum: seq,
      });
      lastMessageId = messageId;

      // 解析 handoff 目标
      if (!tagged) {
        // 无标记 → 终止
        break;
      }
      const targetId = tagged[1];
      // 评审 W4 v5 重要：先精确 id 匹配；displayName fallback 仅当全局唯一时生效，
      // 避免两个成员同名导致 handoff 路由到错误目标。
      const target = this.resolveHandoffTarget(targetId, enabled);

      if (!target) {
        seq += 1;
        onEvent({
          kind: "handoff.rejected",
          turnId: ctx.turn.id,
          sequenceNum: seq,
          from: current.id,
          to: targetId,
        });
        this.logger.warn(
          `[HANDOFF] target not found: ${targetId}; chain ends at ${current.displayName}`,
        );
        seq += 1;
        messages.push(
          emitSystemNotice(
            onEvent,
            ctx.turn.id,
            seq,
            `${current.displayName} 试图交接给 "${targetId}"，但该成员不在房间或已禁用，链路终止。`,
          ),
        );
        break;
      }
      if (visited.has(target.id)) {
        seq += 1;
        onEvent({
          kind: "handoff.rejected",
          turnId: ctx.turn.id,
          sequenceNum: seq,
          from: current.id,
          to: target.id,
        });
        seq += 1;
        messages.push(
          emitSystemNotice(
            onEvent,
            ctx.turn.id,
            seq,
            `${current.displayName} 试图交接给 ${target.displayName}（已发言过），为避免环路链路终止。`,
          ),
        );
        break;
      }

      seq += 1;
      onEvent({
        kind: "handoff.request",
        turnId: ctx.turn.id,
        sequenceNum: seq,
        from: current.id,
        to: target.id,
      });
      seq += 1;
      onEvent({
        kind: "handoff.accepted",
        turnId: ctx.turn.id,
        sequenceNum: seq,
        from: current.id,
        to: target.id,
      });

      current = target;
      depth += 1;
    }

    // 2026-05-08 R2 评审：max_depth 退出之前只在 metadata 标记，UI 看不到原因。
    // 补 system.notice 让用户知道链路因深度上限被截断。
    if (depth >= MAX_HANDOFF_DEPTH) {
      seq += 1;
      messages.push(
        emitSystemNotice(
          onEvent,
          ctx.turn.id,
          seq,
          `已达到 handoff 最大深度（${MAX_HANDOFF_DEPTH}），链路自动终止。`,
        ),
      );
    }

    return {
      messages,
      metadata: {
        chain,
        depth: chain.length,
        terminatedReason:
          chain.length >= MAX_HANDOFF_DEPTH ? "max_depth" : "no_handoff_tag",
      },
    };
  }

  // ============ 内部 ============

  private pickStart(
    enabled: AskRoomMember[],
    modeOptions: ModeContext["modeOptions"],
  ): AskRoomMember | null {
    const opts = (modeOptions ?? {}) as HandoffOptionsInput;
    if (opts.startMemberId) {
      // 评审 W4 v5 次要：仅匹配 enabled 列表（已过滤 deleted/disabled），
      // 防止用户传入已禁用 member id 时仍被作为起始。
      const m = enabled.find((x) => x.id === opts.startMemberId);
      if (m) return m;
    }
    return (
      enabled.find((m) => m.role === "LEADER") ??
      [...enabled].sort(
        (a, b) => a.order - b.order || a.id.localeCompare(b.id),
      )[0] ??
      null
    );
  }

  private async askMember(
    current: AskRoomMember,
    ctx: ModeContext,
    allEnabled: AskRoomMember[],
    emit: {
      messageId: string;
      memberId: string;
      onEvent: (e: AskRoomServerEvent) => void;
      nextSeq: () => number;
    },
  ): Promise<{ content: string; tokensUsed: number }> {
    const peers = allEnabled
      .filter((m) => m.id !== current.id)
      .map((m) => `- ${m.id} (${m.displayName})`)
      .join("\n");

    const sysParts: string[] = [];
    if (current.systemPrompt) sysParts.push(current.systemPrompt);
    sysParts.push(
      `你是 ${current.displayName}。如果你能回答用户问题，直接给出答复。\n` +
        "如果问题超出你的专长，**应交给更合适的成员**。结尾追加单独一行：\n" +
        "[HANDOFF: 成员id]\n" +
        "成员 id 必须从下方候选中选；不要交给已经发言过的成员。\n\n" +
        "可选成员：\n" +
        peers,
    );
    // 2026-05-09 反 prompt 污染：用户消息常含 @ 提及触发模型模仿群聊格式
    sysParts.push(
      "请直接给出回答内容，不要在回答前加 `[<名字>]`、`<名字>:`、`@<名字>` 等自报家门前缀；不要在回答中模拟多人对话或扮演其他成员。",
    );

    const messages: ChatMessage[] = [
      { role: "system", content: sysParts.join("\n\n") },
      { role: "user", content: ctx.triggerMessage.content },
    ];

    // 流式：partial 推原始内容（含 [HANDOFF: x] tag）；最终 participant.done
    // 由 caller emit 时会用解析后剥掉 tag 的 cleanContent 替换前端展示。
    let streamed = "";
    for await (const chunk of this.chatFacade.chatStream({
      messages,
      model: current.modelId,
      modelType: AIModelType.CHAT,
      taskProfile: { creativity: "medium", outputLength: "standard" },
      billing: {
        userId: ctx.userId,
        moduleType: "ai-ask",
        operationType: "room-handoff",
        referenceId: ctx.turn.id,
        description: `AI Ask Room HANDOFF - ${current.displayName}`,
      },
    })) {
      if (ctx.signal.aborted) {
        throw new Error("HANDOFF adapter aborted");
      }
      if (chunk.error) {
        throw new Error(chunk.error);
      }
      if (chunk.content) {
        streamed += chunk.content;
        emit.onEvent({
          kind: "participant.partial",
          turnId: ctx.turn.id,
          sequenceNum: emit.nextSeq(),
          memberId: emit.memberId,
          messageId: emit.messageId,
          deltaText: chunk.content,
        });
      }
    }

    return {
      content: streamed,
      tokensUsed: Math.ceil(streamed.length / 4),
    };
  }

  /**
   * 评审 W4 v5 重要：消歧的 handoff 目标解析。
   * 优先级：
   *   1. 精确 id 匹配
   *   2. id 前缀匹配（仅当唯一）
   *   3. displayName 完全匹配（仅当唯一）
   * 其余情况返回 undefined（adapter 会发 handoff.rejected 并终止）。
   */
  private resolveHandoffTarget(
    ref: string,
    enabled: AskRoomMember[],
  ): AskRoomMember | undefined {
    const lower = ref.toLowerCase();
    const exact = enabled.find((m) => m.id === ref);
    if (exact) return exact;
    const prefixMatches = enabled.filter((m) =>
      m.id.toLowerCase().startsWith(lower),
    );
    if (prefixMatches.length === 1) return prefixMatches[0];
    const nameMatches = enabled.filter(
      (m) => m.displayName.toLowerCase() === lower,
    );
    if (nameMatches.length === 1) return nameMatches[0];
    return undefined;
  }

  private assertNotAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new Error("HANDOFF adapter aborted");
    }
  }
}
