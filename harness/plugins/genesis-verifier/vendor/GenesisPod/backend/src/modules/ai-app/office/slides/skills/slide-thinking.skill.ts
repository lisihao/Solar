/**
 * AI Slides V5.0 - Slide Thinking Skill
 *
 * Records and emits AI thinking process during slide generation:
 * - Step-by-step reasoning
 * - Decision points
 * - Insights and observations
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  ISkill,
  SkillContext,
  SkillResult,
  SkillLayer,
  SKILL_LAYERS,
} from "@/modules/ai-harness/facade";
import { EventEmitter2 } from "@nestjs/event-emitter";

// ============================================================================
// Types
// ============================================================================

/**
 * Thinking entry type
 */
export type ThinkingEntryType =
  | "step"
  | "decision"
  | "insight"
  | "warning"
  | "output";

/**
 * Thinking entry
 */
export interface ThinkingEntry {
  id: string;
  type: ThinkingEntryType;
  title: string;
  content: string;
  reasoning?: string;
  decision?: string;
  timestamp: Date;
  duration?: number;
  pageIndex?: number;
  skillId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Input for recording thinking
 */
export interface ThinkingInput {
  /** Mission ID for context */
  missionId: string;
  /** Type of thinking entry */
  type: ThinkingEntryType;
  /** Short title */
  title: string;
  /** Main content */
  content: string;
  /** Optional reasoning explanation */
  reasoning?: string;
  /** Optional decision made */
  decision?: string;
  /** Page index if relevant */
  pageIndex?: number;
  /** Source skill ID */
  skillId?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Output from thinking recording
 */
export interface ThinkingOutput {
  /** Generated entry */
  entry: ThinkingEntry;
  /** Whether event was emitted */
  eventEmitted: boolean;
}

/**
 * Thinking summary
 */
export interface ThinkingSummary {
  totalEntries: number;
  byType: Record<ThinkingEntryType, number>;
  totalDuration: number;
  keyDecisions: string[];
  insights: string[];
}

// ============================================================================
// Skill Implementation
// ============================================================================

@Injectable()
export class SlideThinkingSkill implements ISkill<
  ThinkingInput,
  ThinkingOutput
> {
  readonly id = "slides-thinking";
  readonly name = "Slide Thinking";
  readonly description =
    "Records and emits AI thinking process during slide generation";
  readonly layer: SkillLayer = SKILL_LAYERS.QUALITY;
  readonly domain = "slides";

  // Memory management constants
  private static readonly MAX_ENTRIES_PER_MISSION = 500;
  private static readonly ENTRY_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
  private static readonly CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
  private static readonly MAX_MISSIONS = 100;

  private readonly logger = new Logger(SlideThinkingSkill.name);
  private entries: Map<string, ThinkingEntry[]> = new Map();
  private lastCleanup: number = Date.now();

  constructor(private readonly eventEmitter: EventEmitter2) {}

  /**
   * Record a thinking entry and emit event
   */
  async execute(
    input: ThinkingInput,
    context: SkillContext,
  ): Promise<SkillResult<ThinkingOutput>> {
    const startTime = Date.now();

    // Periodic cleanup to prevent memory leaks
    this.maybeCleanup();

    try {
      // Generate unique ID
      const entryId = `thinking-${input.missionId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Create entry
      const entry: ThinkingEntry = {
        id: entryId,
        type: input.type,
        title: input.title,
        content: input.content,
        reasoning: input.reasoning,
        decision: input.decision,
        timestamp: new Date(),
        pageIndex: input.pageIndex,
        skillId: input.skillId || context.skillId,
        metadata: input.metadata,
      };

      // Store entry with size limit
      let missionEntries = this.entries.get(input.missionId) || [];
      missionEntries.push(entry);

      // Enforce per-mission size limit (keep most recent entries)
      if (missionEntries.length > SlideThinkingSkill.MAX_ENTRIES_PER_MISSION) {
        missionEntries = missionEntries.slice(
          -SlideThinkingSkill.MAX_ENTRIES_PER_MISSION,
        );
      }

      this.entries.set(input.missionId, missionEntries);

      // Emit SSE event
      let eventEmitted = false;
      try {
        this.eventEmitter.emit("slides.thinking", {
          missionId: input.missionId,
          sessionId: context.sessionId,
          type: `thinking:${input.type}`,
          data: entry,
        });
        eventEmitted = true;
      } catch (err) {
        this.logger.warn(`[execute] Failed to emit event: ${err}`);
      }

      const endTime = Date.now();
      const duration = endTime - startTime;
      entry.duration = duration;

      this.logger.debug(
        `[execute] Recorded thinking: ${input.type} - ${input.title}`,
      );

      return {
        success: true,
        data: {
          entry,
          eventEmitted,
        },
        metadata: {
          executionId: entryId,
          startTime: new Date(startTime),
          endTime: new Date(endTime),
          duration,
        },
      };
    } catch (error) {
      const endTime = Date.now();
      this.logger.error(`[execute] Failed:`, error);
      return {
        success: false,
        error: {
          code: "THINKING_RECORD_FAILED",
          message: error instanceof Error ? error.message : "Unknown error",
        },
        metadata: {
          executionId: `thinking-error-${Date.now()}`,
          startTime: new Date(startTime),
          endTime: new Date(endTime),
          duration: endTime - startTime,
        },
      };
    }
  }

  /**
   * Get all entries for a mission
   */
  getEntries(missionId: string): ThinkingEntry[] {
    return this.entries.get(missionId) || [];
  }

  /**
   * Get summary of thinking for a mission
   */
  getSummary(missionId: string): ThinkingSummary {
    const entries = this.getEntries(missionId);

    const byType: Record<ThinkingEntryType, number> = {
      step: 0,
      decision: 0,
      insight: 0,
      warning: 0,
      output: 0,
    };

    entries.forEach((e) => {
      byType[e.type]++;
    });

    const totalDuration = entries.reduce(
      (sum, e) => sum + (e.duration || 0),
      0,
    );

    const keyDecisions = entries
      .filter((e) => e.type === "decision" && e.decision)
      .map((e) => e.decision!)
      .slice(0, 10);

    const insights = entries
      .filter((e) => e.type === "insight")
      .map((e) => e.content)
      .slice(0, 10);

    return {
      totalEntries: entries.length,
      byType,
      totalDuration,
      keyDecisions,
      insights,
    };
  }

  /**
   * Clear entries for a mission
   */
  clearEntries(missionId: string): void {
    this.entries.delete(missionId);
  }

  /**
   * Emit thinking summary event
   */
  emitSummary(missionId: string, sessionId: string): void {
    const summary = this.getSummary(missionId);

    this.eventEmitter.emit("slides.thinking", {
      missionId,
      sessionId,
      type: "thinking:summary",
      data: summary,
    });
  }

  /**
   * Periodic cleanup to prevent memory leaks
   * - Removes entries older than TTL
   * - Removes oldest missions if exceeding MAX_MISSIONS
   */
  private maybeCleanup(): void {
    const now = Date.now();

    // Only run cleanup periodically
    if (now - this.lastCleanup < SlideThinkingSkill.CLEANUP_INTERVAL_MS) {
      return;
    }

    this.lastCleanup = now;
    const cutoff = now - SlideThinkingSkill.ENTRY_TTL_MS;

    // Clean up expired entries
    for (const [missionId, entries] of this.entries) {
      const validEntries = entries.filter(
        (entry) => entry.timestamp.getTime() > cutoff,
      );

      if (validEntries.length === 0) {
        this.entries.delete(missionId);
      } else if (validEntries.length !== entries.length) {
        this.entries.set(missionId, validEntries);
      }
    }

    // If still too many missions, remove oldest ones
    if (this.entries.size > SlideThinkingSkill.MAX_MISSIONS) {
      const sortedMissions = Array.from(this.entries.entries())
        .map(([id, entries]) => ({
          id,
          latestTimestamp: Math.max(
            ...entries.map((e) => e.timestamp.getTime()),
          ),
        }))
        .sort((a, b) => b.latestTimestamp - a.latestTimestamp);

      // Keep only the most recent MAX_MISSIONS
      const toRemove = sortedMissions.slice(SlideThinkingSkill.MAX_MISSIONS);
      for (const { id } of toRemove) {
        this.entries.delete(id);
      }

      this.logger.debug(
        `[maybeCleanup] Removed ${toRemove.length} old missions, ${this.entries.size} remaining`,
      );
    }
  }

  /**
   * Get current memory stats (for debugging/monitoring)
   */
  getMemoryStats(): { missionCount: number; totalEntries: number } {
    let totalEntries = 0;
    for (const entries of this.entries.values()) {
      totalEntries += entries.length;
    }
    return {
      missionCount: this.entries.size,
      totalEntries,
    };
  }
}

// ============================================================================
// Helper Functions for Other Skills
// ============================================================================

/**
 * Create a thinking step helper
 */
export function createThinkingStep(
  skill: SlideThinkingSkill,
  missionId: string,
  context: SkillContext,
) {
  return async (
    type: ThinkingEntryType,
    title: string,
    content: string,
    options?: {
      reasoning?: string;
      decision?: string;
      pageIndex?: number;
      metadata?: Record<string, unknown>;
    },
  ) => {
    return skill.execute(
      {
        missionId,
        type,
        title,
        content,
        reasoning: options?.reasoning,
        decision: options?.decision,
        pageIndex: options?.pageIndex,
        metadata: options?.metadata,
      },
      context,
    );
  };
}
