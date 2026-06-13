/**
 * Writing Mission Types
 *
 * Shared type definitions for writing missions.
 * Extracted from WritingMissionService to allow independent imports.
 */

import type { MissionResult } from "@/modules/ai-harness/facade";

/**
 * 写作任务类型
 */
export type WritingMissionType =
  | "outline"
  | "chapter"
  | "revision"
  | "consistency_check"
  | "full_story"
  | "edit";

/**
 * 对话消息（多轮对话）
 */
export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

/**
 * 写作任务输入
 */
export interface WritingMissionInput {
  projectId: string;
  missionType: WritingMissionType;
  chapterId?: string;
  volumeId?: string;
  userPrompt: string;
  targetWordCount?: number;
  additionalInstructions?: string;
  parallelWriters?: number;
  targetAgent?: string;
  conversationHistory?: ConversationMessage[];
}

/**
 * 写作任务结果
 */
export interface WritingMissionResult extends MissionResult {
  content?: string;
  wordCount?: number;
  qualityMetrics?: {
    overall: number;
    wordCount: number;
    coherence: number;
    completeness: number;
    consistency: number;
  };
  consistencyReport?: {
    status: "PASSED" | "ISSUES_FOUND";
    issues: Array<{
      type: string;
      severity: string;
      description: string;
    }>;
  };
  bibleUpdates?: Array<{
    type: "character_state" | "timeline_event" | "new_fact";
    data: Record<string, unknown>;
  }>;
}
