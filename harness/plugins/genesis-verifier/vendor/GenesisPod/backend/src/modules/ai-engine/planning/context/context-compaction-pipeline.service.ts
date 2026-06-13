import { Injectable, Logger } from "@nestjs/common";

// ─── Types ───

export type CompactionLevel = "none" | "prune" | "summarize" | "emergency";

export interface CompactionConfig {
  /** Start pruning old messages at this % of context window (default: 0.60) */
  pruneThreshold: number;
  /** AI-summarize conversation at this % (default: 0.80) */
  summarizeThreshold: number;
  /** Emergency truncation at this % (default: 0.95) */
  emergencyThreshold: number;
  /** Never break tool_use/tool_result pairs (default: true) */
  preserveToolPairs: boolean;
  /** Always keep system prompt (default: true) */
  preserveSystemPrompt: boolean;
  /** Keep at least this many recent turns (default: 3) */
  preserveLastNTurns: number;
  /** Model context window size in tokens */
  contextWindowTokens: number;
}

export interface CompactionResult {
  /** Messages after compaction */
  messages: LLMMessage[];
  /** Which level was applied */
  levelApplied: CompactionLevel;
  /** How many messages were removed */
  messagesRemoved: number;
  /** Estimated tokens saved */
  tokensSaved: number;
  /** Whether a summary message was inserted */
  summaryInserted: boolean;
}

/** Simplified LLM message type for compaction (role + content) */
export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | unknown;
  /** Tool use ID - for preserving tool_use/tool_result pairs */
  toolUseId?: string;
  /** Tool result reference - links to a tool_use message */
  toolResultFor?: string;
  /** Whether this is a tool_use block */
  isToolUse?: boolean;
  /** Whether this is a tool_result block */
  isToolResult?: boolean;
}

const DEFAULT_CONFIG: CompactionConfig = {
  pruneThreshold: 0.6,
  summarizeThreshold: 0.8,
  emergencyThreshold: 0.95,
  preserveToolPairs: true,
  preserveSystemPrompt: true,
  preserveLastNTurns: 3,
  contextWindowTokens: 128000,
};

// Average tokens per character (mixed Chinese/English)
const AVG_TOKENS_PER_CHAR = 0.6;

/**
 * Summarize function type - injected at call time for decoupling from LLM layer
 */
export type SummarizeFn = (text: string, maxLength: number) => Promise<string>;

/**
 * ContextCompactionPipelineService
 *
 * 3-level context compaction pipeline:
 * 1. Prune: Remove old user/assistant turns, preserving tool pairs and recent turns
 * 2. Summarize: AI-summarize old conversation into a single summary message
 * 3. Emergency: Keep only system prompt + last turn
 *
 * Key invariant: tool_use and tool_result messages are NEVER separated.
 * Inspired by Claude Code's adjustIndexToPreserveAPIInvariants().
 */
@Injectable()
export class ContextCompactionPipelineService {
  private readonly logger = new Logger(ContextCompactionPipelineService.name);

  /**
   * Run the compaction pipeline on a message array.
   *
   * @param messages - Current conversation messages
   * @param currentTokens - Estimated current token count
   * @param config - Pipeline configuration
   * @param summarizeFn - Optional AI summarization function (required for Level 2)
   */
  async compact(
    messages: LLMMessage[],
    currentTokens: number,
    config?: Partial<CompactionConfig>,
    summarizeFn?: SummarizeFn,
  ): Promise<CompactionResult> {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const utilization = currentTokens / cfg.contextWindowTokens;

    this.logger.debug(
      `[compact] utilization=${(utilization * 100).toFixed(1)}%, ` +
        `messages=${messages.length}, tokens=${currentTokens}`,
    );

    // No compaction needed
    if (utilization < cfg.pruneThreshold) {
      return {
        messages,
        levelApplied: "none",
        messagesRemoved: 0,
        tokensSaved: 0,
        summaryInserted: false,
      };
    }

    // Level 3: Emergency (highest priority check)
    if (utilization >= cfg.emergencyThreshold) {
      this.logger.warn(
        `[compact] Emergency compaction: utilization=${(utilization * 100).toFixed(1)}%`,
      );
      return this.emergencyCompact(messages, currentTokens, cfg);
    }

    // Level 2: Summarize
    if (utilization >= cfg.summarizeThreshold && summarizeFn) {
      this.logger.log(
        `[compact] Summarize compaction: utilization=${(utilization * 100).toFixed(1)}%`,
      );
      return this.summarizeCompact(messages, currentTokens, cfg, summarizeFn);
    }

    // Level 1: Prune
    this.logger.log(
      `[compact] Prune compaction: utilization=${(utilization * 100).toFixed(1)}%`,
    );
    return this.pruneCompact(messages, currentTokens, cfg);
  }

  /**
   * Level 1: Remove old turns while preserving tool pairs and recent turns
   */
  private pruneCompact(
    messages: LLMMessage[],
    currentTokens: number,
    cfg: CompactionConfig,
  ): CompactionResult {
    void currentTokens; // used by caller for utilization, not needed inside prune

    const { systemMessages, conversationMessages } = this.splitSystemMessages(
      messages,
      cfg,
    );

    // Identify the boundary: keep last N turns (1 turn = user + assistant)
    const keepFromIndex = this.findTurnBoundary(
      conversationMessages,
      cfg.preserveLastNTurns,
    );

    // Messages to potentially remove
    const candidatesForRemoval = conversationMessages.slice(0, keepFromIndex);
    const keptMessages = conversationMessages.slice(keepFromIndex);

    // Adjust to preserve tool pairs
    const { safeRemoval, adjusted } = this.adjustForToolPairs(
      candidatesForRemoval,
      keptMessages,
      cfg,
    );

    const removedCount = safeRemoval.length;
    const removedTokens = this.estimateTokens(safeRemoval);

    const result = [...systemMessages, ...adjusted];

    this.logger.log(
      `[pruneCompact] Removed ${removedCount} messages, ` +
        `saved ~${removedTokens} tokens`,
    );

    return {
      messages: result,
      levelApplied: "prune",
      messagesRemoved: removedCount,
      tokensSaved: removedTokens,
      summaryInserted: false,
    };
  }

  /**
   * Level 2: AI-summarize old conversation into a single message
   */
  private async summarizeCompact(
    messages: LLMMessage[],
    currentTokens: number,
    cfg: CompactionConfig,
    summarizeFn: SummarizeFn,
  ): Promise<CompactionResult> {
    const { systemMessages, conversationMessages } = this.splitSystemMessages(
      messages,
      cfg,
    );

    const keepFromIndex = this.findTurnBoundary(
      conversationMessages,
      cfg.preserveLastNTurns,
    );

    const toSummarize = conversationMessages.slice(0, keepFromIndex);
    const toKeep = conversationMessages.slice(keepFromIndex);

    if (toSummarize.length === 0) {
      // Nothing to summarize, fall back to prune
      return this.pruneCompact(messages, currentTokens, cfg);
    }

    // Build text from messages to summarize
    const textToSummarize = toSummarize
      .filter((m) => typeof m.content === "string")
      .map((m) => `[${m.role}]: ${m.content as string}`)
      .join("\n\n");

    try {
      const summary = await summarizeFn(textToSummarize, 2000);

      const summaryMessage: LLMMessage = {
        role: "user",
        content:
          `[Conversation Summary]\n${summary}\n\n` +
          `[Note: The above summarizes ${toSummarize.length} earlier messages. ` +
          `The conversation continues below.]`,
      };

      const result = [...systemMessages, summaryMessage, ...toKeep];
      const removedTokens = this.estimateTokens(toSummarize);

      this.logger.log(
        `[summarizeCompact] Summarized ${toSummarize.length} messages → 1 summary, ` +
          `saved ~${removedTokens} tokens`,
      );

      return {
        messages: result,
        levelApplied: "summarize",
        messagesRemoved: toSummarize.length,
        tokensSaved: removedTokens - this.estimateTokens([summaryMessage]),
        summaryInserted: true,
      };
    } catch (error) {
      this.logger.warn(
        `[summarizeCompact] Summarization failed, falling back to prune: ${String(error)}`,
      );
      return this.pruneCompact(messages, currentTokens, cfg);
    }
  }

  /**
   * Level 3: Emergency — keep only system prompt + last turn
   */
  private emergencyCompact(
    messages: LLMMessage[],
    currentTokens: number,
    cfg: CompactionConfig,
  ): CompactionResult {
    void currentTokens;

    const { systemMessages, conversationMessages } = this.splitSystemMessages(
      messages,
      cfg,
    );

    // Keep only the last turn (last user + last assistant)
    const lastTurnIndex = this.findTurnBoundary(conversationMessages, 1);
    const kept = conversationMessages.slice(lastTurnIndex);
    const removed = conversationMessages.slice(0, lastTurnIndex);

    const result = [...systemMessages, ...kept];
    const removedTokens = this.estimateTokens(removed);

    this.logger.warn(
      `[emergencyCompact] Emergency: kept ${result.length} of ${messages.length} messages, ` +
        `saved ~${removedTokens} tokens`,
    );

    return {
      messages: result,
      levelApplied: "emergency",
      messagesRemoved: removed.length,
      tokensSaved: removedTokens,
      summaryInserted: false,
    };
  }

  // ─── Helpers ───

  /**
   * Split system messages from conversation messages
   */
  private splitSystemMessages(
    messages: LLMMessage[],
    cfg: CompactionConfig,
  ): { systemMessages: LLMMessage[]; conversationMessages: LLMMessage[] } {
    if (!cfg.preserveSystemPrompt) {
      return { systemMessages: [], conversationMessages: [...messages] };
    }

    const systemMessages: LLMMessage[] = [];
    const conversationMessages: LLMMessage[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        systemMessages.push(msg);
      } else {
        conversationMessages.push(msg);
      }
    }

    return { systemMessages, conversationMessages };
  }

  /**
   * Find the index from which to keep messages (last N turns)
   * A "turn" is a user message + its corresponding assistant response
   */
  private findTurnBoundary(messages: LLMMessage[], turns: number): number {
    let turnCount = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        turnCount++;
        if (turnCount >= turns) {
          return i;
        }
      }
    }
    return 0;
  }

  /**
   * Adjust removal boundaries to preserve tool_use/tool_result pairs.
   * If a tool_use is in the removal set but its tool_result is in the keep set (or vice versa),
   * move the pair to the keep set.
   */
  private adjustForToolPairs(
    candidatesForRemoval: LLMMessage[],
    keptMessages: LLMMessage[],
    cfg: CompactionConfig,
  ): { safeRemoval: LLMMessage[]; adjusted: LLMMessage[] } {
    if (!cfg.preserveToolPairs) {
      return { safeRemoval: candidatesForRemoval, adjusted: keptMessages };
    }

    // Collect tool use IDs from kept messages
    const keptToolUseIds = new Set<string>();
    const keptToolResultForIds = new Set<string>();

    for (const msg of keptMessages) {
      if (msg.isToolUse && msg.toolUseId) keptToolUseIds.add(msg.toolUseId);
      if (msg.isToolResult && msg.toolResultFor)
        keptToolResultForIds.add(msg.toolResultFor);
    }

    const safeRemoval: LLMMessage[] = [];
    const movedToKeep: LLMMessage[] = [];

    for (const msg of candidatesForRemoval) {
      const shouldKeep =
        // This tool_use's result is in the keep set
        (msg.isToolUse &&
          msg.toolUseId &&
          keptToolResultForIds.has(msg.toolUseId)) ||
        // This tool_result's tool_use is in the keep set
        (msg.isToolResult &&
          msg.toolResultFor &&
          keptToolUseIds.has(msg.toolResultFor));

      if (shouldKeep) {
        movedToKeep.push(msg);
      } else {
        safeRemoval.push(msg);
      }
    }

    return {
      safeRemoval,
      adjusted: [...movedToKeep, ...keptMessages],
    };
  }

  /**
   * Estimate token count for a set of messages
   */
  private estimateTokens(messages: LLMMessage[]): number {
    let totalChars = 0;
    for (const msg of messages) {
      if (typeof msg.content === "string") {
        totalChars += msg.content.length;
      } else {
        totalChars += JSON.stringify(msg.content).length;
      }
    }
    return Math.ceil(totalChars * AVG_TOKENS_PER_CHAR);
  }
}
