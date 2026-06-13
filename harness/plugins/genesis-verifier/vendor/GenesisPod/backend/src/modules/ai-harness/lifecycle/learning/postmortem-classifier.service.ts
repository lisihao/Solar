import { Injectable } from "@nestjs/common";

export type FailureMode =
  | "reviewer_loop"
  | "tool_truncation"
  | "llm_timeout"
  | "pod_recycle"
  | "schema_reject"
  | "success"
  | "user_cancel"
  | "unknown";

export interface ClassifyInput {
  status: string;
  events: Array<{ type: string; ts: number; payload?: unknown }>;
  metrics?: {
    totalTokens?: number;
    wallTimeMs?: number;
    toolCalls?: number;
  };
}

export interface ClassifyResult {
  mode: FailureMode;
  signals: string[];
  confidence: number;
}

/**
 * Patterns 配置（v3 R0 Action 4: caller 注入 substring patterns，避免 base layer 含
 * 业务概念）。每个 mode 的 substring 列表 + 阈值由 caller 提供。
 *
 * harness 提供 generic defaults（仅业界通用错误模式，不含任何 ai-app 业务名）。
 * ai-app 通过 PostmortemPatternsBuilder 添加业务专属 patterns。
 */
export interface PostmortemPatterns {
  readonly userCancel: readonly string[]; // 触发 user_cancel 模式
  readonly toolTruncation: {
    readonly substrings: readonly string[];
    readonly threshold: number;
  };
  readonly llmTimeout: {
    readonly substrings: readonly string[];
    readonly threshold: number;
  };
  readonly schemaReject: {
    readonly substrings: readonly string[];
    readonly threshold: number;
  };
  readonly reviewerLoop: {
    readonly substrings: readonly string[];
    readonly threshold: number;
  };
}

/**
 * Generic patterns —— 业界通用错误模式（无 ai-app 业务概念）。
 *
 * ai-app 可在此基础上 extend 自己的业务 patterns（如 consumer 的 'chapter:revision'）。
 */
export const GENERIC_POSTMORTEM_PATTERNS: PostmortemPatterns = {
  userCancel: ["user-cancel"],
  toolTruncation: {
    substrings: ["tool:truncated"],
    threshold: 5,
  },
  llmTimeout: {
    substrings: ["llm:timeout", "timeout"],
    threshold: 3,
  },
  schemaReject: {
    substrings: ["validation:failed", "schema_reject"],
    threshold: 3,
  },
  reviewerLoop: {
    substrings: ["revision:stuck"], // generic "revision stuck" 概念
    threshold: 5,
  },
};

@Injectable()
export class PostmortemClassifierService {
  /**
   * @param input mission 事件流 + status + 度量
   * @param patterns substring patterns（caller 必须注入；不传走 generic defaults）
   */
  classify(
    input: ClassifyInput,
    patterns: PostmortemPatterns = GENERIC_POSTMORTEM_PATTERNS,
  ): ClassifyResult {
    if (input.status === "completed") {
      return { mode: "success", signals: [], confidence: 1 };
    }

    if (input.status === "cancelled") {
      const lastEvent = input.events[input.events.length - 1];
      const matchUserCancel = patterns.userCancel.some((sub) =>
        lastEvent?.type?.includes(sub),
      );
      if (matchUserCancel) {
        return {
          mode: "user_cancel",
          signals: ["user-initiated"],
          confidence: 1,
        };
      }
      return {
        mode: "pod_recycle",
        signals: ["no_user_cancel_event"],
        confidence: 0.7,
      };
    }

    // failed status: scan events for dominant signal
    let truncationCount = 0;
    let timeoutCount = 0;
    let schemaRejectCount = 0;
    let stuckRevisionCount = 0;

    for (const e of input.events) {
      if (patterns.toolTruncation.substrings.some((s) => e.type.includes(s))) {
        truncationCount++;
      }
      if (patterns.llmTimeout.substrings.some((s) => e.type.includes(s))) {
        timeoutCount++;
      }
      if (patterns.schemaReject.substrings.some((s) => e.type.includes(s))) {
        schemaRejectCount++;
      }
      if (patterns.reviewerLoop.substrings.some((s) => e.type.includes(s))) {
        stuckRevisionCount++;
      }
    }

    const counts: Array<{
      mode: FailureMode;
      count: number;
      threshold: number;
    }> = [
      {
        mode: "reviewer_loop",
        count: stuckRevisionCount,
        threshold: patterns.reviewerLoop.threshold,
      },
      {
        mode: "tool_truncation",
        count: truncationCount,
        threshold: patterns.toolTruncation.threshold,
      },
      {
        mode: "llm_timeout",
        count: timeoutCount,
        threshold: patterns.llmTimeout.threshold,
      },
      {
        mode: "schema_reject",
        count: schemaRejectCount,
        threshold: patterns.schemaReject.threshold,
      },
    ];

    counts.sort((a, b) => b.count - a.count);
    const top = counts[0];

    if (top.count >= top.threshold) {
      return {
        mode: top.mode,
        signals: counts
          .filter((c) => c.count > 0)
          .map((c) => `${c.mode}:${c.count}`),
        confidence: Math.min(1, top.count / (top.threshold * 2)),
      };
    }

    return {
      mode: "unknown",
      signals: counts
        .filter((c) => c.count > 0)
        .map((c) => `${c.mode}:${c.count}`),
      confidence: 0,
    };
  }
}
