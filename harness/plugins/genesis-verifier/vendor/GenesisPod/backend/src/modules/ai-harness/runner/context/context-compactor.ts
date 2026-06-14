/**
 * ContextCompactor — 长对话压缩器
 *
 * 当 envelope.messages 的估算 token 数超过阈值时，触发压缩：
 *   1. 保留最后 K 条完整对话（近因区）
 *   2. 把更早的 N 条对话用 LLM 总结为一条 system 摘要消息
 *   3. 返回新 envelope（不可变）
 *
 * Phase 5 设计：
 *   - compactor 作为独立服务，便于替换实现（本地 LLM / 云端 LLM / rule-based）
 *   - 不修改 budget，只重组 messages
 *   - 压缩失败降级：保留原 envelope，记 warn 不抛错
 */

import { Injectable, Logger, Optional, Inject } from "@nestjs/common";
import type {
  IContextEnvelope,
  IContextMessage,
} from "../../agents/abstractions";
import { ContextEnvelope } from "../../agents/core/context-envelope";
import { AiChatService } from "../../../ai-engine/llm/chat/ai-chat.service";
import { estimateEnvelopeTokens } from "./token-estimator";
import { AIModelType } from "@prisma/client";

export const COMPACTOR_CONFIG_TOKEN = "HARNESS_COMPACTOR_CONFIG";

export interface CompactorConfig {
  /** 触发压缩的 token 阈值（默认 8000） */
  triggerTokens?: number;
  /** 压缩后保留的最新消息条数（默认 8） */
  keepRecent?: number;
  /** 摘要的最大长度（字符；默认 1000） */
  summaryMaxChars?: number;
}

export interface CompactionResult {
  envelope: IContextEnvelope;
  compacted: boolean;
  removedMessageCount: number;
  summaryChars: number;
}

const DEFAULTS = {
  triggerTokens: 8_000,
  keepRecent: 8,
  summaryMaxChars: 1_000,
};

const SUMMARIZATION_PROMPT = `You are a context summarizer. Compress the following conversation into a concise briefing that a fresh agent can use to continue the task.

Rules:
- Preserve: decisions made, facts established, open questions, next steps
- Drop: verbose reasoning, repeated phrasing, chit-chat, meta-commentary
- Output as plain text, no markdown headers, under %MAX_CHARS% characters

Conversation to compress:
`;

@Injectable()
export class ContextCompactor {
  private readonly logger = new Logger(ContextCompactor.name);

  constructor(
    @Optional() private readonly chatService?: AiChatService,
    @Optional()
    @Inject(COMPACTOR_CONFIG_TOKEN)
    private readonly config: CompactorConfig = {},
  ) {}

  /** 如果需要，压缩 envelope 并返回；否则返回原 envelope */
  async compact(envelope: IContextEnvelope): Promise<CompactionResult> {
    const trigger = this.config.triggerTokens ?? DEFAULTS.triggerTokens;
    const keepRecent = this.config.keepRecent ?? DEFAULTS.keepRecent;
    const summaryMax = this.config.summaryMaxChars ?? DEFAULTS.summaryMaxChars;

    const estimated = estimateEnvelopeTokens(envelope);
    if (estimated < trigger || envelope.messages.length <= keepRecent) {
      return {
        envelope,
        compacted: false,
        removedMessageCount: 0,
        summaryChars: 0,
      };
    }

    if (!this.chatService) {
      this.logger.warn(
        `[compact] triggered but AiChatService not available — skipping`,
      );
      return {
        envelope,
        compacted: false,
        removedMessageCount: 0,
        summaryChars: 0,
      };
    }

    const toCompress = envelope.messages.slice(0, -keepRecent);
    const recent = envelope.messages.slice(-keepRecent);

    const conversation = toCompress
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n");

    let summary: string;
    try {
      const response = await this.chatService.chat({
        messages: [{ role: "user", content: conversation }],
        systemPrompt: SUMMARIZATION_PROMPT.replace(
          "%MAX_CHARS%",
          String(summaryMax),
        ),
        taskProfile: { creativity: "low", outputLength: "short" },
        // 系统配置感知 + BYOK
        modelType: AIModelType.CHAT,
        userId: envelope.memory.userId,
      });
      summary = response.content.slice(0, summaryMax);
    } catch (err) {
      this.logger.warn(
        `[compact] summarization failed, keeping envelope as-is: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        envelope,
        compacted: false,
        removedMessageCount: 0,
        summaryChars: 0,
      };
    }

    const summaryMsg: IContextMessage = {
      role: "system",
      content: `[context-summary replacing ${toCompress.length} earlier messages]\n${summary}`,
      timestamp: Date.now(),
    };

    const newMessages = [summaryMsg, ...recent];

    const next: IContextEnvelope =
      envelope instanceof ContextEnvelope
        ? new ContextEnvelope(
            {
              system: envelope.system,
              messages: newMessages,
              reminders: envelope.reminders,
              tools: envelope.tools,
              memory: envelope.memory,
              budget: envelope.budget,
              metadata: {
                ...(envelope.metadata ?? {}),
                compactedAt: Date.now(),
                compactedCount:
                  ((envelope.metadata?.compactedCount as number) ?? 0) + 1,
              },
            },
            envelope.id,
          )
        : { ...envelope, messages: newMessages };

    return {
      envelope: next,
      compacted: true,
      removedMessageCount: toCompress.length,
      summaryChars: summary.length,
    };
  }
}
