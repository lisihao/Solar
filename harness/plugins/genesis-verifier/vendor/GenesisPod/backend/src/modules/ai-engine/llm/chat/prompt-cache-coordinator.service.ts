import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "crypto";

/**
 * Frozen cache prefix for a mission — ensures all subagent calls share identical bytes
 */
export interface CachePrefix {
  /** The exact system prompt text to use */
  systemPromptText: string;
  /** The exact tool definitions (JSON-serializable) */
  toolDefinitions: unknown[];
  /** SHA-256 hash of concatenated system prompt + tool JSON for identity check */
  hash: string;
  /** When this prefix was created */
  createdAt: Date;
  /** How many times this prefix has been used */
  useCount: number;
}

/**
 * PromptCacheCoordinatorService
 *
 * Manages frozen prompt cache prefixes for multi-agent missions.
 * When a mission spawns N dimension research agents, all of them
 * should use the EXACT SAME system prompt + tool list bytes so
 * Anthropic's prompt caching can achieve 98%+ cache hit rate.
 *
 * Usage:
 * 1. Mission starts → createPrefix(missionId, systemPrompt, tools)
 * 2. Each subagent call → getPrefix(missionId) → use frozen bytes
 * 3. Mission ends → releasePrefix(missionId)
 *
 * Key constraint: per-agent customization must go in the USER message,
 * NOT in the system prompt. The system prompt must be byte-identical.
 */
@Injectable()
export class PromptCacheCoordinatorService {
  private readonly logger = new Logger(PromptCacheCoordinatorService.name);
  private readonly prefixes = new Map<string, CachePrefix>();

  /**
   * Create and freeze a cache prefix for a mission.
   * Once created, the prefix is immutable — all subagent calls will
   * use these exact bytes.
   */
  createPrefix(
    missionId: string,
    systemPromptText: string,
    toolDefinitions: unknown[],
  ): CachePrefix {
    // Compute hash for identity verification
    const toolJson = JSON.stringify(toolDefinitions);
    const hash = createHash("sha256")
      .update(systemPromptText)
      .update(toolJson)
      .digest("hex");

    const prefix: CachePrefix = {
      systemPromptText,
      toolDefinitions,
      hash,
      createdAt: new Date(),
      useCount: 0,
    };

    this.prefixes.set(missionId, prefix);

    this.logger.log(
      `[createPrefix] Mission ${missionId}: ` +
        `prompt=${systemPromptText.length}c, tools=${toolDefinitions.length}, hash=${hash.slice(0, 12)}`,
    );

    return prefix;
  }

  /**
   * Get the frozen prefix for a mission. Returns null if not found.
   * Increments use count for observability.
   */
  getPrefix(missionId: string): CachePrefix | null {
    const prefix = this.prefixes.get(missionId);
    if (prefix) {
      prefix.useCount++;
    }
    return prefix ?? null;
  }

  /**
   * Check if a prefix exists for a mission
   */
  hasPrefix(missionId: string): boolean {
    return this.prefixes.has(missionId);
  }

  /**
   * Release a prefix after mission completion.
   * Returns the final prefix with use count for cost analysis.
   */
  releasePrefix(missionId: string): CachePrefix | null {
    const prefix = this.prefixes.get(missionId);
    if (prefix) {
      this.logger.log(
        `[releasePrefix] Mission ${missionId}: used ${prefix.useCount} times`,
      );
      this.prefixes.delete(missionId);
    }
    return prefix ?? null;
  }

  /**
   * Get all active prefixes (for monitoring/debugging)
   */
  getActivePrefixes(): Array<{
    missionId: string;
    hash: string;
    useCount: number;
    createdAt: Date;
  }> {
    const result: Array<{
      missionId: string;
      hash: string;
      useCount: number;
      createdAt: Date;
    }> = [];
    for (const [missionId, prefix] of this.prefixes) {
      result.push({
        missionId,
        hash: prefix.hash,
        useCount: prefix.useCount,
        createdAt: prefix.createdAt,
      });
    }
    return result;
  }
}
