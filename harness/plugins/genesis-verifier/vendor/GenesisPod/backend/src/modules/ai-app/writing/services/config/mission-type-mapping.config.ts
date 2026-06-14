/**
 * Mission Type Mapping Configuration
 *
 * Maps WritingMissionType to execution strategies, DB values,
 * and validation rules.
 */

import type { WritingMissionType } from "../mission/writing-mission.types";

/**
 * Mission type execution strategy
 */
export interface MissionTypeConfig {
  /** DB enum value */
  dbType: string;
  /** Whether this type uses the full_story executor */
  isFullStory: boolean;
  /** Whether to skip word count validation */
  skipWordCountCheck: boolean;
  /** Minimum word count for validation */
  minWordCount: number;
  /** Default creativity level */
  creativity: "deterministic" | "low" | "medium" | "high";
  /** Default output length */
  outputLength:
    | "minimal"
    | "short"
    | "medium"
    | "standard"
    | "long"
    | "extended";
  /** Whether this type emits mission:started event separately */
  emitStartEvent: boolean;
  /** Whether this type emits mission:completed event separately */
  emitCompleteEvent: boolean;
}

/**
 * Mission type configurations
 */
export const MISSION_TYPE_CONFIGS: Record<
  WritingMissionType,
  MissionTypeConfig
> = {
  full_story: {
    dbType: "CHAPTER",
    isFullStory: true,
    skipWordCountCheck: false,
    minWordCount: 200,
    creativity: "high",
    outputLength: "long",
    emitStartEvent: false,
    emitCompleteEvent: false,
  },
  chapter: {
    dbType: "CHAPTER",
    isFullStory: false,
    skipWordCountCheck: false,
    minWordCount: 200,
    creativity: "high",
    outputLength: "long",
    emitStartEvent: true,
    emitCompleteEvent: true,
  },
  outline: {
    dbType: "OUTLINE",
    isFullStory: false,
    skipWordCountCheck: false,
    minWordCount: 50,
    creativity: "medium",
    outputLength: "medium",
    emitStartEvent: true,
    emitCompleteEvent: true,
  },
  edit: {
    dbType: "REVISION",
    isFullStory: false,
    skipWordCountCheck: true,
    minWordCount: 0,
    creativity: "medium",
    outputLength: "long",
    emitStartEvent: true,
    emitCompleteEvent: true,
  },
  revision: {
    dbType: "REVISION",
    isFullStory: false,
    skipWordCountCheck: false,
    minWordCount: 200,
    creativity: "medium",
    outputLength: "long",
    emitStartEvent: true,
    emitCompleteEvent: true,
  },
  consistency_check: {
    dbType: "CONSISTENCY",
    isFullStory: false,
    skipWordCountCheck: true,
    minWordCount: 0,
    creativity: "low",
    outputLength: "medium",
    emitStartEvent: true,
    emitCompleteEvent: true,
  },
};
