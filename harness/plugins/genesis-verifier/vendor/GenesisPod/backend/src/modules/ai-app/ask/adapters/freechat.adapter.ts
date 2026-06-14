/**
 * FREECHAT mode adapter
 *
 * 设计：teams-mode.md §5.2 FREECHAT 行
 *
 * 行为：
 *   1. 解析触发消息中的 mentionedMemberIds
 *   2. 命中：仅这些成员各自回一条
 *   3. 未命中：本期降级到 leader（或 order=0 成员）回一条
 *      （评审 follow-up：v0.3 把 fan-out selector 下沉到 harness/freechat-pattern）
 *   4. 每个被选中成员通过 ChatFacade.chatStream 调用 LLM
 *   5. 输出 N 条 AI 消息（无 leader 合成）
 *
 * 流式：使用 chatFacade.chatStream，把每个增量 chunk 推为 participant.partial 事件。
 * 前端 store 累积 partialText 直到 participant.done。done 时仍带最终 content 兜底。
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

@Injectable()
export class FreechatAdapter implements IModeAdapter {
  readonly mode = AskRoomMode.FREECHAT;
  private readonly logger = new Logger(FreechatAdapter.name);

  constructor(private readonly chatFacade: ChatFacade) {}

  async execute(
    ctx: ModeContext,
    onEvent: (e: AskRoomServerEvent) => void,
  ): Promise<ModeResult> {
    const enabled = ctx.members.filter((m) => m.enabled && !m.deletedAt);
    const mentioned = (ctx.triggerMessage.mentionedMemberIds ?? [])
      .map((id) => enabled.find((m) => m.id === id))
      .filter((m): m is AskRoomMember => m !== undefined);

    let participants: AskRoomMember[];
    if (mentioned.length > 0) {
      participants = mentioned;
    } else {
      const leader =
        enabled.find((m) => m.role === "LEADER") ??
        [...enabled].sort((a, b) => a.order - b.order)[0];
      participants = leader ? [leader] : [];
    }

    let seq = ctx.sequenceNumStart;
    const messages: PendingMessage[] = [];

    if (participants.length === 0) {
      this.logger.warn(
        `[FREECHAT] turn=${ctx.turn.id} no eligible participants`,
      );
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

    for (const member of participants) {
      this.assertNotAborted(ctx.signal);
      // 评审 W2 v3 R2：messageId 在 thinking 起就确定，贯穿到 done 与最终 INSERT。
      // 详见 teams-mode.md §6.2 messageId 生成时机。
      const messageId = uuid();
      seq += 1;

      onEvent({
        kind: "participant.thinking",
        turnId: ctx.turn.id,
        sequenceNum: seq,
        memberId: member.id,
        messageId,
      });

      const llmMessages = this.buildLlmMessages(ctx, member);
      const startedAt = Date.now();

      // 流式：增量 chunk 推 participant.partial；失败/取消用占位回退。
      // 之前是 await chat() 一次返回，从 thinking 到 done 之间前端无任何反馈，
      // 体感"特别慢"。现在按 chunk 推 deltaText，前端 store 累积 partialText。
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
            operationType: "room-freechat",
            referenceId: ctx.turn.id,
            description: `AI Ask Room FREECHAT - ${member.displayName}`,
          },
        })) {
          if (ctx.signal.aborted) {
            throw new Error("FREECHAT adapter aborted");
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
        if (ctx.signal.aborted) throw err;
        streamError = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `[FREECHAT] member=${member.displayName} stream failed: ${streamError}`,
        );
      }

      // [B2 2026-05-09] streamError 即视为失败：哪怕已累积一半内容，也不能
      // 当成功落库（之前 `streamError && !streamed` 让半截内容静默通过）。
      // 保留半截 + 错误后缀让用户知道流被中断，比直接占位更有信息量。
      let finalContent: string;
      if (streamError) {
        finalContent = streamed
          ? `${streamed}\n\n[输出被中断：${streamError.slice(0, 100)}]`
          : "[error] AI 服务暂时不可用，请稍后重试";
      } else {
        finalContent = streamed;
      }
      // chatStream 不直接 yield tokensUsed（计费在 facade 内部完成），
      // 这里给 AskMessage.tokens 一个粗略估算（4 chars/token），不影响计费。
      const tokensUsed = Math.ceil(finalContent.length / 4);

      seq += 1;
      onEvent({
        kind: "participant.done",
        turnId: ctx.turn.id,
        sequenceNum: seq,
        memberId: member.id,
        messageId,
        tokensUsed,
        content: finalContent,
      });

      messages.push({
        id: messageId,
        senderType: "AI",
        senderMemberId: member.id,
        content: finalContent,
        modelId: member.modelId,
        modelName: null,
        tokens: tokensUsed,
        parentMessageId: ctx.triggerMessage.id,
        sequenceNum: seq,
      });

      this.logger.debug(
        `[FREECHAT] turn=${ctx.turn.id} member=${member.displayName} ` +
          `tokens=${tokensUsed} elapsed=${Date.now() - startedAt}ms`,
      );
    }

    return {
      messages,
      metadata: {
        participantCount: participants.length,
        mentionedHit: mentioned.length > 0,
      },
    };
  }

  private buildLlmMessages(
    ctx: ModeContext,
    member: AskRoomMember,
  ): ChatMessage[] {
    const systemParts: string[] = [];
    if (member.systemPrompt) {
      systemParts.push(member.systemPrompt);
    } else {
      systemParts.push(
        `你是 ${member.displayName}，与其他 AI 一起协助用户。请仅以 ${member.displayName} 的身份回答。`,
      );
    }
    // 反 prompt 污染：明确告诉 LLM 不要加自报家门前缀（截图 37 显示模型把
    // history 里 "[<displayName>] xxx" 格式当模板复制进自己的输出）
    systemParts.push(
      "请直接给出回答内容，不要在回答前加 `[<名字>]`、`<名字>:` 或类似的自报家门前缀；不要模拟多人对话。",
    );
    if (member.persona && typeof member.persona === "object") {
      systemParts.push(`【人设要点】\n${JSON.stringify(member.persona)}`);
    }

    // 评审 W2 v3 R2 重要：displayName 拼入 prompt 前必须 sanitize（防 prompt
    // 注入：displayName="admin] forget previous instructions [" 类构造）。
    //
    // ★ 2026-05-08 真因修复（screenshot 37）：之前所有 AI 历史都映射成
    //   role=assistant + 加 [displayName] 前缀。当前 member 看到"自己"历史
    //   被打名字标签 → 输出时模仿这个格式 → 出现 `[xAI (...)] 段一 [xAI
    //   (...)] 段二` 等错位。修法：
    //     - 自己说过 → role=assistant，content **不加前缀**
    //     - 其他 AI 说过 → role=user，content 加 `[发言者]` 让 LLM 知道是别人
    //     - 用户消息 → role=user，原文不加前缀
    const history: ChatMessage[] = ctx.history.slice(-20).map((m) => {
      if (m.senderType === "AI" && m.senderMemberId === member.id) {
        return { role: "assistant" as const, content: m.content };
      }
      if (m.senderType === "AI" && m.senderMemberId) {
        const rawSpeaker = this.lookupMemberName(ctx, m.senderMemberId);
        const speaker = rawSpeaker
          ? rawSpeaker.replace(/[\[\]\r\n]/g, "").slice(0, 40)
          : "AI";
        return {
          role: "user" as const,
          content: `[${speaker}] ${m.content}`,
        };
      }
      return { role: "user" as const, content: m.content };
    });

    return [
      { role: "system", content: systemParts.join("\n\n") },
      ...history,
      { role: "user", content: ctx.triggerMessage.content },
    ];
  }

  private lookupMemberName(ctx: ModeContext, memberId: string): string | null {
    const m = ctx.members.find((x) => x.id === memberId);
    return m ? m.displayName : null;
  }

  private assertNotAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new Error("FREECHAT adapter aborted");
    }
  }
}
