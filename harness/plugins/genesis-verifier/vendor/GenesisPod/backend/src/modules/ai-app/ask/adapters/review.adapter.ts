/**
 * REVIEW mode adapter
 *
 * 设计：teams-mode.md §5.2 REVIEW 行
 *
 * 行为：
 *   1. 角色：modeOptions.authorMemberId / reviewerMemberIds 显式给出
 *      或 leader=author，其余=reviewers
 *   2. author 出初稿（chat 1）
 *   3. reviewers 并行评审（chat N）输出 status + score + feedback
 *   4. author 收到反馈后修订（chat 2）输出终稿
 *   5. 输出消息：1 初稿 + N 反馈 + 1 终稿
 *
 * 备注：harness `ReviewWorkflowService` 内部依赖 Prisma `Review` 模型，本期未建表
 * （v1 评审 P1-14：表迁移延 W4 实现，v3 评审决策"用 turn metadata 承载，先不依赖落库"）。
 * 因此本 adapter 不调用 ReviewWorkflowService，仅复用 ReviewRequest/ReviewResult 类型概念。
 *
 * 流式：askDraft / askReview / askRevision 都走 chatFacade.chatStream，按 chunk 推
 * participant.partial。
 *
 * [B4 2026-05-09] askReview 的 prompt 让模型直接输出展示格式（**评审：xx** / 状态 /
 * 评分 / 反馈），末尾追加 [REVIEW: status=x score=n] 解析 tag。落库前 parseReview 剥
 * 掉 tag。流式期间用户看到的就是最终展示格式，仅末尾的 tag 在 done 一刻消失。
 */

import { Injectable, Logger } from "@nestjs/common";
import { v4 as uuid } from "uuid";
import { AIModelType, AskRoomMember, AskRoomMode } from "@prisma/client";
import { ChatFacade, type ChatMessage } from "@/modules/ai-harness/facade";
import {
  emitSystemNotice,
  sanitizeStreamError,
  type IModeAdapter,
  type ModeContext,
  type ModeResult,
  type PendingMessage,
} from "./mode-adapter.interface";
import type { AskRoomServerEvent } from "../gateway/ask-room-events.types";

interface ReviewOptionsInput {
  authorMemberId?: string;
  reviewerMemberIds?: string[];
}

interface ReviewerFeedback {
  member: AskRoomMember;
  messageId: string;
  status: "approved" | "needs_revision" | "rejected";
  score: number;
  /** 评审正文（解析自模型输出，剥掉头部状态行 + 末尾解析 tag），喂给 askRevision LLM */
  feedback: string;
  /** 已剥掉 [REVIEW:...] tag 的展示正文（"**评审：xx**\n状态：...\n\n<feedback>"），用于 emit done + 落库 */
  content: string;
  doneSeq: number;
  tokensUsed: number;
  error?: string;
}

@Injectable()
export class ReviewAdapter implements IModeAdapter {
  readonly mode = AskRoomMode.REVIEW;
  private readonly logger = new Logger(ReviewAdapter.name);

  constructor(private readonly chatFacade: ChatFacade) {}

  async execute(
    ctx: ModeContext,
    onEvent: (e: AskRoomServerEvent) => void,
  ): Promise<ModeResult> {
    const enabled = ctx.members.filter((m) => m.enabled && !m.deletedAt);
    let seq = ctx.sequenceNumStart;
    const messages: PendingMessage[] = [];

    if (enabled.length < 2) {
      seq += 1;
      messages.push(
        emitSystemNotice(
          onEvent,
          ctx.turn.id,
          seq,
          "REVIEW 模式至少需要 2 名启用成员（1 主答 + 1 评审）。请添加或启用更多成员后重试。",
        ),
      );
      return { messages, metadata: { reason: "insufficient_members" } };
    }

    const roles = this.assignRoles(enabled, ctx.modeOptions);
    if (!roles) {
      seq += 1;
      messages.push(
        emitSystemNotice(
          onEvent,
          ctx.turn.id,
          seq,
          "未能确定 REVIEW 角色（主答者或评审者）。请检查 modeOptions.authorMemberId / reviewerMemberIds 或确保至少有 2 名启用成员。",
        ),
      );
      return { messages, metadata: { reason: "no_author_or_reviewers" } };
    }
    const { author, reviewers } = roles;

    // 1. 初稿
    this.assertNotAborted(ctx.signal);
    const draftId = uuid();
    seq += 1;
    onEvent({
      kind: "participant.thinking",
      turnId: ctx.turn.id,
      sequenceNum: seq,
      memberId: author.id,
      messageId: draftId,
    });
    const draft = await this.askDraft(author, ctx, {
      messageId: draftId,
      memberId: author.id,
      onEvent,
      nextSeq: () => {
        seq += 1;
        return seq;
      },
    });
    const draftBubble = `# 初稿（by ${author.displayName}）\n\n${draft.content}`;
    seq += 1;
    onEvent({
      kind: "participant.done",
      turnId: ctx.turn.id,
      sequenceNum: seq,
      memberId: author.id,
      messageId: draftId,
      tokensUsed: draft.tokensUsed,
      content: draftBubble,
    });
    messages.push({
      id: draftId,
      senderType: "AI",
      senderMemberId: author.id,
      content: draftBubble,
      modelId: author.modelId,
      modelName: null,
      tokens: draft.tokensUsed,
      parentMessageId: ctx.triggerMessage.id,
      sequenceNum: seq,
    });

    // 2. 评审者并行评审
    const feedbacks = await this.runReviews(
      reviewers,
      draft.content,
      ctx,
      () => {
        seq += 1;
        return seq;
      },
      onEvent,
    );

    for (const fb of feedbacks) {
      messages.push({
        id: fb.messageId,
        senderType: "AI",
        senderMemberId: fb.member.id,
        content: fb.error
          ? "[error] AI 服务暂时不可用，请稍后重试"
          : fb.content,
        modelId: fb.member.modelId,
        modelName: null,
        tokens: fb.tokensUsed,
        parentMessageId: draftId,
        sequenceNum: fb.doneSeq,
      });
    }

    // 3. 主答者修订
    const successFeedbacks = feedbacks.filter((f) => !f.error);
    if (successFeedbacks.length === 0) {
      this.logger.warn(`[REVIEW] turn=${ctx.turn.id} all reviewers failed`);
      // 评审 W4 v5 重要：补一条 SYSTEM 消息让用户看到为何跳过修订。
      // 2026-05-08：之前只 push 不 emit → 当前 turn UI 看不到，需 reload。
      // 改用 emitSystemNotice 即时推流并保证持久化一致。
      seq += 1;
      const notice = emitSystemNotice(
        onEvent,
        ctx.turn.id,
        seq,
        "所有评审者暂不可用，已跳过修订阶段。可重试 turn 或切换 mode（FREECHAT / PARALLEL_MERGE）。",
      );
      // parentMessageId 关联到 draft 让消息树可追溯
      messages.push({ ...notice, parentMessageId: draftId });
      return {
        messages,
        metadata: {
          authorId: author.id,
          reviewerIds: reviewers.map((r) => r.id),
          revisionApplied: false,
          allReviewersFailed: true,
        },
      };
    }

    this.assertNotAborted(ctx.signal);
    const finalId = uuid();
    seq += 1;
    onEvent({
      kind: "participant.thinking",
      turnId: ctx.turn.id,
      sequenceNum: seq,
      memberId: author.id,
      messageId: finalId,
    });
    const final = await this.askRevision(
      author,
      ctx,
      draft.content,
      successFeedbacks,
      {
        messageId: finalId,
        memberId: author.id,
        onEvent,
        nextSeq: () => {
          seq += 1;
          return seq;
        },
      },
    );
    const finalBubble = `# 终稿（${author.displayName} 修订）\n\n${final.content}`;
    seq += 1;
    onEvent({
      kind: "participant.done",
      turnId: ctx.turn.id,
      sequenceNum: seq,
      memberId: author.id,
      messageId: finalId,
      tokensUsed: final.tokensUsed,
      content: finalBubble,
    });
    messages.push({
      id: finalId,
      senderType: "AI",
      senderMemberId: author.id,
      content: finalBubble,
      modelId: author.modelId,
      modelName: null,
      tokens: final.tokensUsed,
      parentMessageId: draftId,
      sequenceNum: seq,
    });

    return {
      messages,
      metadata: {
        authorId: author.id,
        reviewerIds: reviewers.map((r) => r.id),
        feedbackCount: successFeedbacks.length,
        revisionApplied: true,
        avgScore:
          successFeedbacks.reduce((s, f) => s + f.score, 0) /
          successFeedbacks.length,
      },
    };
  }

  // ============ 内部 ============

  private assignRoles(
    enabled: AskRoomMember[],
    modeOptions: ModeContext["modeOptions"],
  ): { author: AskRoomMember; reviewers: AskRoomMember[] } | null {
    const opts = (modeOptions ?? {}) as ReviewOptionsInput;
    let author: AskRoomMember | undefined;
    let reviewers: AskRoomMember[];

    if (opts.authorMemberId) {
      author = enabled.find((m) => m.id === opts.authorMemberId);
    }
    if (!author) {
      author =
        enabled.find((m) => m.role === "LEADER") ??
        [...enabled].sort(
          (a, b) => a.order - b.order || a.id.localeCompare(b.id),
        )[0];
    }

    if (opts.reviewerMemberIds && opts.reviewerMemberIds.length > 0) {
      reviewers = enabled.filter(
        (m) => m.id !== author?.id && opts.reviewerMemberIds!.includes(m.id),
      );
    } else {
      reviewers = enabled.filter((m) => m.id !== author?.id);
    }

    if (!author || reviewers.length === 0) return null;
    return { author, reviewers };
  }

  private async askDraft(
    author: AskRoomMember,
    ctx: ModeContext,
    emit: {
      messageId: string;
      memberId: string;
      onEvent: (e: AskRoomServerEvent) => void;
      nextSeq: () => number;
    },
  ): Promise<{ content: string; tokensUsed: number }> {
    const sysParts: string[] = [];
    if (author.systemPrompt) sysParts.push(author.systemPrompt);
    sysParts.push(
      `你是 ${author.displayName}，正在撰写一份初稿，准备接受其他成员的评审。\n` +
        "请就用户问题给出**清晰、有结构、可被批注**的初稿，方便评审者指出改进点。",
    );
    // 2026-05-09 反 prompt 污染：用户消息常含 @ 提及，模型易模仿群聊格式
    sysParts.push(
      "请直接给出初稿内容，不要在前面加 `[<名字>]`、`<名字>:`、`@<名字>` 等自报家门前缀；不要模拟多人对话。",
    );

    let streamed = "";
    for await (const chunk of this.chatFacade.chatStream({
      messages: [
        { role: "system", content: sysParts.join("\n\n") },
        { role: "user", content: ctx.triggerMessage.content },
      ],
      model: author.modelId,
      modelType: AIModelType.CHAT,
      taskProfile: { creativity: "medium", outputLength: "long" },
      billing: {
        userId: ctx.userId,
        moduleType: "ai-ask",
        operationType: "room-review-draft",
        referenceId: ctx.turn.id,
        description: `AI Ask Room REVIEW draft - ${author.displayName}`,
      },
    })) {
      if (ctx.signal.aborted) {
        throw new Error("REVIEW adapter aborted");
      }
      if (chunk.error) {
        // [B3 2026-05-09] 脱敏后再 throw，防 provider 原始 error（含 stack/auth）
        // 顺着 runtime catch 进入 turn.error.error 直推前端。askDraft / askRevision
        // 的 throw 不在 execute() try-catch 内，会逃逸到 runtime；askReview 已在
        // runReviews 局部 catch，但同样脱敏保持一致。
        throw new Error(sanitizeStreamError(chunk.error));
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

  private async runReviews(
    reviewers: AskRoomMember[],
    draft: string,
    ctx: ModeContext,
    nextSeq: () => number,
    onEvent: (e: AskRoomServerEvent) => void,
  ): Promise<ReviewerFeedback[]> {
    const tasks = reviewers.map(async (reviewer) => {
      this.assertNotAborted(ctx.signal);
      const messageId = uuid();
      onEvent({
        kind: "participant.thinking",
        turnId: ctx.turn.id,
        sequenceNum: nextSeq(),
        memberId: reviewer.id,
        messageId,
      });
      try {
        const fb = await this.askReview(reviewer, draft, ctx, {
          messageId,
          memberId: reviewer.id,
          onEvent,
          nextSeq,
        });
        const doneSeq = nextSeq();
        const partial: ReviewerFeedback = {
          member: reviewer,
          messageId,
          status: fb.status,
          score: fb.score,
          feedback: fb.feedback,
          content: fb.content,
          doneSeq,
          tokensUsed: fb.tokensUsed,
        };
        onEvent({
          kind: "participant.done",
          turnId: ctx.turn.id,
          sequenceNum: doneSeq,
          memberId: reviewer.id,
          messageId,
          tokensUsed: fb.tokensUsed,
          // [B4] fb.content 已是展示正文（与 partialText 一致），done 时不跳变
          content: fb.content,
        });
        return partial;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const doneSeq = nextSeq();
        onEvent({
          kind: "participant.done",
          turnId: ctx.turn.id,
          sequenceNum: doneSeq,
          memberId: reviewer.id,
          messageId,
          tokensUsed: 0,
          content: "[error] AI 服务暂时不可用，请稍后重试",
        });
        return {
          member: reviewer,
          messageId,
          status: "rejected" as const,
          score: 0,
          feedback: "",
          content: "",
          doneSeq,
          tokensUsed: 0,
          error: errMsg,
        };
      }
    });
    return await Promise.all(tasks);
  }

  private async askReview(
    reviewer: AskRoomMember,
    draft: string,
    ctx: ModeContext,
    emit: {
      messageId: string;
      memberId: string;
      onEvent: (e: AskRoomServerEvent) => void;
      nextSeq: () => number;
    },
  ): Promise<{
    status: "approved" | "needs_revision" | "rejected";
    score: number;
    feedback: string;
    /** 不含解析 tag 的展示正文 */
    content: string;
    tokensUsed: number;
  }> {
    const sysParts: string[] = [];
    if (reviewer.systemPrompt) sysParts.push(reviewer.systemPrompt);
    // [B4 2026-05-09] 让模型直接输出最终展示格式，末尾追加单行解析 tag。
    // 避免之前 STATUS/SCORE/FEEDBACK 三行结构化输出 → done 时被 formatFeedback
    // 替换成 "**评审：xx** ..." 整段视觉跳变。
    sysParts.push(
      `你是 ${reviewer.displayName}，正在评审一份初稿。请按以下格式作答：\n\n` +
        `**评审：${reviewer.displayName}**\n` +
        "状态：<approved 或 needs_revision 或 rejected>\n" +
        "评分：<0-100>/100\n" +
        "\n" +
        "<具体反馈，≤ 500 字，可分点>\n" +
        "\n" +
        "[REVIEW: status=<approved|needs_revision|rejected> score=<0-100>]\n\n" +
        "（最后一行的 [REVIEW: ...] 是必须的解析标签）",
    );

    const messages: ChatMessage[] = [
      { role: "system", content: sysParts.join("\n\n") },
      {
        role: "user",
        content: `用户问题：${ctx.triggerMessage.content}\n\n初稿：\n${draft}`,
      },
    ];

    let streamed = "";
    for await (const chunk of this.chatFacade.chatStream({
      messages,
      model: reviewer.modelId,
      modelType: AIModelType.CHAT,
      taskProfile: { creativity: "low", outputLength: "medium" },
      billing: {
        userId: ctx.userId,
        moduleType: "ai-ask",
        operationType: "room-review-feedback",
        referenceId: ctx.turn.id,
        description: `AI Ask Room REVIEW feedback - ${reviewer.displayName}`,
      },
    })) {
      if (ctx.signal.aborted) {
        throw new Error("REVIEW adapter aborted");
      }
      if (chunk.error) {
        // [B3 2026-05-09] 脱敏后再 throw，防 provider 原始 error（含 stack/auth）
        // 顺着 runtime catch 进入 turn.error.error 直推前端。askDraft / askRevision
        // 的 throw 不在 execute() try-catch 内，会逃逸到 runtime；askReview 已在
        // runReviews 局部 catch，但同样脱敏保持一致。
        throw new Error(sanitizeStreamError(chunk.error));
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
      ...this.parseReview(streamed),
      tokensUsed: Math.ceil(streamed.length / 4),
    };
  }

  /**
   * 解析 askReview 的流式输出。
   * 模型应输出：
   *   **评审：xx**
   *   状态：approved
   *   评分：90/100
   *
   *   <反馈正文>
   *
   *   [REVIEW: status=approved score=90]
   *
   * 提取末尾 tag 拿 status/score；剥掉 tag 行剩下的就是展示 content。
   * feedback prose 从 content 里再 split 拿（去掉前 3 行头部），喂给 askRevision。
   *
   * 兜底：tag 缺失时回退到老 STATUS/SCORE/FEEDBACK 三行格式 parsing。
   */
  private parseReview(text: string): {
    status: "approved" | "needs_revision" | "rejected";
    score: number;
    feedback: string;
    content: string;
  } {
    const tagMatch = text.match(
      /\[\s*REVIEW\s*[:：]\s*status\s*=\s*(approved|needs_revision|rejected)\s+score\s*=\s*(\d{1,3})\s*\]/i,
    );

    if (tagMatch) {
      const status = tagMatch[1].toLowerCase() as
        | "approved"
        | "needs_revision"
        | "rejected";
      const score = Math.max(0, Math.min(100, parseInt(tagMatch[2], 10)));
      const content = text.replace(tagMatch[0], "").trim();
      // feedback prose: 跳过前几行（**评审：xx** / 状态: / 评分:），剩下的当反馈
      const lines = content.split(/\r?\n/);
      const proseStart = lines.findIndex(
        (l, i) =>
          i >= 2 && l.trim() !== "" && !/^(状态|评分|score|status)/i.test(l),
      );
      const feedback =
        proseStart >= 0
          ? lines.slice(proseStart).join("\n").trim().slice(0, 800)
          : content.slice(0, 800);
      return { status, score, feedback, content: content.slice(0, 2000) };
    }

    // 老格式兜底
    const status = (
      text.match(/STATUS\s*[:：]\s*(approved|needs_revision|rejected)/i)?.[1] ??
      "needs_revision"
    ).toLowerCase() as "approved" | "needs_revision" | "rejected";
    const score = Math.max(
      0,
      Math.min(
        100,
        parseInt(text.match(/SCORE\s*[:：]\s*(\d{1,3})/i)?.[1] ?? "60", 10),
      ),
    );
    const feedback = (
      text.match(/FEEDBACK\s*[:：]\s*([\s\S]+)/i)?.[1].trim() ??
      text.slice(0, 500)
    ).slice(0, 800);
    // 老格式回退：用 formatFeedback 重组成新展示格式（兼容旧模型/历史 prompt 残留）
    const fallbackContent = [
      `**评审：未知评审者**`,
      `状态：${status} | 评分：${score}/100`,
      "",
      feedback,
    ].join("\n");
    return { status, score, feedback, content: fallbackContent };
  }

  private async askRevision(
    author: AskRoomMember,
    ctx: ModeContext,
    draft: string,
    feedbacks: ReviewerFeedback[],
    emit: {
      messageId: string;
      memberId: string;
      onEvent: (e: AskRoomServerEvent) => void;
      nextSeq: () => number;
    },
  ): Promise<{ content: string; tokensUsed: number }> {
    const fbBlock = feedbacks
      .map((f) => {
        const safeName = f.member.displayName
          .replace(/[\[\]\r\n]/g, "")
          .slice(0, 40);
        return `[${safeName} - ${f.status} (${f.score}/100)]\n${f.feedback}`;
      })
      .join("\n\n");

    const sysParts: string[] = [];
    if (author.systemPrompt) sysParts.push(author.systemPrompt);
    sysParts.push(
      `你是 ${author.displayName}，正在根据评审反馈修订初稿。\n` +
        "约束：吸收评审者的合理意见；拒绝时简要说明拒绝理由；保持原有正确观点不被弱化。\n" +
        "输出**仅终稿**，无前言无后记。",
    );
    // 2026-05-09 反 prompt 污染：保持终稿格式干净
    sysParts.push(
      "请直接给出终稿内容，不要在前面加 `[<名字>]`、`<名字>:`、`@<名字>` 等自报家门前缀；不要模拟多人对话。",
    );

    const messages: ChatMessage[] = [
      { role: "system", content: sysParts.join("\n\n") },
      {
        role: "user",
        content: `用户问题：${ctx.triggerMessage.content}\n\n初稿：\n${draft}\n\n评审反馈：\n${fbBlock}`,
      },
    ];

    let streamed = "";
    for await (const chunk of this.chatFacade.chatStream({
      messages,
      model: author.modelId,
      modelType: AIModelType.CHAT,
      taskProfile: { creativity: "medium", outputLength: "long" },
      billing: {
        userId: ctx.userId,
        moduleType: "ai-ask",
        operationType: "room-review-revision",
        referenceId: ctx.turn.id,
        description: `AI Ask Room REVIEW revision - ${author.displayName}`,
      },
    })) {
      if (ctx.signal.aborted) {
        throw new Error("REVIEW adapter aborted");
      }
      if (chunk.error) {
        // [B3 2026-05-09] 脱敏后再 throw，防 provider 原始 error（含 stack/auth）
        // 顺着 runtime catch 进入 turn.error.error 直推前端。askDraft / askRevision
        // 的 throw 不在 execute() try-catch 内，会逃逸到 runtime；askReview 已在
        // runReviews 局部 catch，但同样脱敏保持一致。
        throw new Error(sanitizeStreamError(chunk.error));
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

  private assertNotAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new Error("REVIEW adapter aborted");
    }
  }
}
