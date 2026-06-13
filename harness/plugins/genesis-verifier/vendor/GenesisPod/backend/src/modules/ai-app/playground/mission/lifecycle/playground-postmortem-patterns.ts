/**
 * Playground postmortem patterns —— playground 业务专属 substring patterns
 *
 * 注入到 harness PostmortemClassifierService（v3 R0-A4：取代 base layer hardcode）。
 * 含 playground 业务概念："chapter:revision" 是 playground writer 业务事件，
 * 其他 ai-app（如 writing-team / debate-team）会用自己的业务 substring。
 */

import type { PostmortemPatterns } from "@/modules/ai-harness/facade";

export const PLAYGROUND_POSTMORTEM_PATTERNS: PostmortemPatterns = {
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
    // ★ 业务专属 substring：chapter / revision 是 playground writer 概念
    substrings: ["revision:stuck", "chapter:revision"],
    threshold: 5,
  },
};
