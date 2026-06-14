import { Injectable, Logger, Optional } from "@nestjs/common";
import { TokenTrackerService, TokenUsageEntry } from "./token-tracker.service";

// ─── Configuration ───

/**
 * Configuration for the query loop
 */
export interface QueryLoopConfig {
  /** Maximum number of auto-continuations (default: 5) */
  maxContinuations: number;
  /** Output token delta below which we consider diminishing returns (default: 500) */
  diminishingThreshold: number;
  /** Total token budget limit across all continuations (optional) */
  tokenBudgetLimit?: number;
  /** Minimum continuations before checking diminishing returns (default: 3) */
  minContinuationsForDiminishing: number;
  /** Continuation prompt appended when output is truncated */
  continuationPrompt: string;
}

const DEFAULT_CONFIG: QueryLoopConfig = {
  maxContinuations: 5,
  diminishingThreshold: 500,
  minContinuationsForDiminishing: 3,
  continuationPrompt:
    "Your previous response was truncated. Continue writing from exactly where you left off. Do not repeat any content already written. Do not add any preamble or transition — continue the text seamlessly.",
};

// ─── Result Types ───

export type QueryLoopStopReason =
  | "complete"
  | "budget_exhausted"
  | "diminishing_returns"
  | "max_continuations"
  | "error";

export interface QueryLoopResult {
  /** Assembled full content from all continuations */
  content: string;
  /** Number of continuations performed (0 = no continuation needed) */
  continuations: number;
  /** Total input tokens across all LLM calls */
  totalInputTokens: number;
  /** Total output tokens across all LLM calls */
  totalOutputTokens: number;
  /** Why the loop stopped */
  stoppedReason: QueryLoopStopReason;
  /** Whether any continuation was performed */
  wasContinued: boolean;
}

// ─── Chat Function Type ───

/**
 * A chat function that the query loop wraps.
 * This abstracts over AiChatService.chat(), ChatFacade.chat(), etc.
 */
export interface ChatFnResult {
  content: string;
  model: string;
  tokensUsed: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  isError?: boolean;
  /** Finish reason from the API (e.g., "stop", "length", "end_turn") */
  finishReason?: string;
}

export type ChatMessage = { role: string; content: string };
export type ChatFn = (messages: ChatMessage[]) => Promise<ChatFnResult>;

// ─── Service ───

/**
 * QueryLoopService - Multi-turn auto-continuation engine
 *
 * Wraps LLM calls in a loop that:
 * 1. Detects truncated output (finishReason === "length")
 * 2. Automatically continues with a continuation prompt
 * 3. Tracks actual token usage via TokenTrackerService
 * 4. Detects diminishing returns (low delta after N continuations)
 * 5. Assembles the full content from all continuations
 *
 * Inspired by Claude Code's query loop with token budget management.
 */
@Injectable()
export class QueryLoopService {
  private readonly logger = new Logger(QueryLoopService.name);

  constructor(
    @Optional()
    private readonly tokenTracker?: TokenTrackerService,
  ) {}

  /**
   * Execute a chat function with automatic continuation on truncation.
   *
   * @param chatFn - The LLM call function to wrap
   * @param messages - Initial messages to send
   * @param config - Loop configuration (optional, uses defaults)
   * @returns Assembled result with continuation metadata
   */
  async executeWithLoop(
    chatFn: ChatFn,
    messages: ChatMessage[],
    config?: Partial<QueryLoopConfig>,
  ): Promise<QueryLoopResult> {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const sessionId = `qloop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    this.tokenTracker?.createSession(sessionId);

    const contentParts: string[] = [];
    let continuations = 0;
    let stoppedReason: QueryLoopStopReason = "complete";

    // Local token accumulators — used for the final result regardless of whether
    // tokenTracker is present, since endSession() clears the session map before
    // we can read totals from it.
    let accumulatedInputTokens = 0;
    let accumulatedOutputTokens = 0;

    // Working copy of messages — we append assistant/user messages for continuations
    const workingMessages = [...messages];

    try {
      while (true) {
        // ── Call the LLM ──
        const result = await chatFn(workingMessages);

        if (result.isError) {
          this.logger.warn(
            `[executeWithLoop] LLM returned error: ${result.content.substring(0, 200)}`,
          );
          if (contentParts.length > 0) {
            // We have partial content — return what we have
            stoppedReason = "error";
            break;
          }
          // No content at all — return the error as-is
          return {
            content: result.content,
            continuations: 0,
            totalInputTokens: result.inputTokens ?? 0,
            totalOutputTokens: result.outputTokens ?? 0,
            stoppedReason: "error",
            wasContinued: false,
          };
        }

        // ── Track token usage ──
        const outputTokens = result.outputTokens ?? 0;
        const inputTokens = result.inputTokens ?? 0;

        accumulatedInputTokens += inputTokens;
        accumulatedOutputTokens += outputTokens;

        if (this.tokenTracker) {
          const usage: TokenUsageEntry = {
            inputTokens,
            outputTokens,
            cacheCreationTokens: result.cacheCreationTokens,
            cacheReadTokens: result.cacheReadTokens,
            model: result.model,
          };
          this.tokenTracker.recordUsage(sessionId, usage);
        }

        // ── Collect content ──
        contentParts.push(result.content);

        // ── Check if output was truncated ──
        const isTruncated = this.isTruncated(result);

        if (!isTruncated) {
          // LLM finished naturally
          stoppedReason = "complete";
          break;
        }

        // ── Output was truncated — consider continuation ──

        // Check max continuations
        if (continuations >= cfg.maxContinuations) {
          this.logger.log(
            `[executeWithLoop] Reached max continuations (${cfg.maxContinuations})`,
          );
          stoppedReason = "max_continuations";
          break;
        }

        // Check token budget
        if (cfg.tokenBudgetLimit && !this.tokenTracker) {
          this.logger.warn(
            `[executeWithLoop] tokenBudgetLimit=${cfg.tokenBudgetLimit} configured but TokenTrackerService not available — budget enforcement disabled`,
          );
        }
        if (cfg.tokenBudgetLimit && this.tokenTracker) {
          if (this.tokenTracker.isOverBudget(sessionId, cfg.tokenBudgetLimit)) {
            this.logger.log(
              `[executeWithLoop] Token budget exhausted (${cfg.tokenBudgetLimit})`,
            );
            stoppedReason = "budget_exhausted";
            break;
          }
        }

        // Check diminishing returns: if current output is much smaller than previous,
        // the model is producing less useful content with each continuation
        if (
          continuations >= cfg.minContinuationsForDiminishing &&
          outputTokens > 0
        ) {
          if (outputTokens < cfg.diminishingThreshold) {
            this.logger.log(
              `[executeWithLoop] Diminishing returns detected: ` +
                `outputTokens=${outputTokens} < threshold=${cfg.diminishingThreshold}`,
            );
            stoppedReason = "diminishing_returns";
            break;
          }
        }

        // ── Prepare continuation ──
        continuations++;

        this.logger.debug(
          `[executeWithLoop] Continuation #${continuations}: ` +
            `outputTokens=${outputTokens}, truncated=true`,
        );

        // Append the truncated response as assistant, then continuation prompt as user
        workingMessages.push(
          { role: "assistant", content: result.content },
          { role: "user", content: cfg.continuationPrompt },
        );
      }
    } finally {
      // Clean up token tracking session
      this.tokenTracker?.endSession(sessionId);
    }

    // Assemble final content
    const assembledContent = contentParts.join("");

    const loopResult: QueryLoopResult = {
      content: assembledContent,
      continuations,
      totalInputTokens: accumulatedInputTokens,
      totalOutputTokens: accumulatedOutputTokens,
      stoppedReason,
      wasContinued: continuations > 0,
    };

    if (continuations > 0) {
      this.logger.log(
        `[executeWithLoop] Completed with ${continuations} continuation(s), ` +
          `reason=${stoppedReason}, ` +
          `totalTokens=${loopResult.totalInputTokens + loopResult.totalOutputTokens}`,
      );
    }

    return loopResult;
  }

  /**
   * Detect if LLM output was truncated
   */
  private isTruncated(result: ChatFnResult): boolean {
    // Explicit finish reason from API
    if (result.finishReason === "length") {
      return true;
    }

    // Heuristic: if outputTokens is very close to common maxTokens boundaries
    // and finishReason is not explicitly "stop", might be truncated
    if (
      result.finishReason !== "stop" &&
      result.finishReason !== "end_turn" &&
      result.outputTokens
    ) {
      const knownLimits = [4096, 8192, 16384, 32768];
      for (const limit of knownLimits) {
        if (result.outputTokens >= limit - 50 && result.outputTokens <= limit) {
          this.logger.debug(
            `[isTruncated] Output tokens ${result.outputTokens} near limit ${limit}, treating as truncated`,
          );
          return true;
        }
      }
    }

    return false;
  }
}
