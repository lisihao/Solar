/**
 * AI Engine - Tool Concurrency Service
 * 工具并发调度服务
 *
 * Determines which tools can safely run in parallel based on their category,
 * side effects, and resource access patterns.
 *
 * Inspired by Claude Code's isConcurrencySafe(input) pattern.
 */

import { Injectable, Logger } from "@nestjs/common";

/**
 * Concurrency metadata for a tool
 */
export interface ConcurrencyMetadata {
  /** Whether this tool can safely run in parallel with other tools */
  isConcurrencySafe: boolean;
  /** Side effects: none=pure read, read=data read, write=state mutation */
  sideEffects: "none" | "read" | "write";
  /** Resources this tool accesses (for conflict detection) */
  resourcesAccessed: string[];
}

/**
 * Default concurrency metadata based on tool category.
 *
 * Mapping rationale:
 * - information / generation / processing: pure reads or stateless transforms → safe to parallelize
 * - execution / integration / collaboration: mutate external state or shared resources → sequential
 */
const CATEGORY_DEFAULTS: Record<string, ConcurrencyMetadata> = {
  information: {
    isConcurrencySafe: true,
    sideEffects: "read",
    resourcesAccessed: [],
  },
  generation: {
    isConcurrencySafe: true,
    sideEffects: "none",
    resourcesAccessed: [],
  },
  processing: {
    isConcurrencySafe: true,
    sideEffects: "read",
    resourcesAccessed: [],
  },
  execution: {
    isConcurrencySafe: false,
    sideEffects: "write",
    resourcesAccessed: ["system"],
  },
  integration: {
    isConcurrencySafe: false,
    sideEffects: "write",
    resourcesAccessed: ["external"],
  },
  collaboration: {
    isConcurrencySafe: false,
    sideEffects: "write",
    resourcesAccessed: ["state"],
  },
};

/**
 * Conservative default for unknown categories
 */
const DEFAULT_METADATA: ConcurrencyMetadata = {
  isConcurrencySafe: false,
  sideEffects: "write",
  resourcesAccessed: [],
};

/**
 * A single tool call descriptor passed to partition()
 */
export interface ToolCallDescriptor {
  /** Tool ID (used for override lookup and as partition key) */
  toolId: string;
  /** Tool category (used for CATEGORY_DEFAULTS lookup) */
  category?: string;
}

/**
 * Execution partition result
 */
export interface ExecutionPartition {
  /** Groups of tool IDs that can run in parallel (each group is one Promise.all batch) */
  parallelGroups: string[][];
  /** Tool IDs that must run sequentially (one at a time, in order) */
  sequential: string[];
}

/**
 * ToolConcurrencyService
 *
 * Partitions a list of tool calls into parallel-safe batches and sequential calls.
 *
 * Partition strategy:
 * 1. Consecutive concurrency-safe tools are grouped into a parallel batch.
 * 2. A non-concurrent tool flushes the current batch and runs alone in sequential.
 * 3. Within a parallel batch, tools that access the same named resource are split
 *    into a new batch to avoid intra-group conflicts.
 */
@Injectable()
export class ToolConcurrencyService {
  private readonly logger = new Logger(ToolConcurrencyService.name);

  /** Per-tool overrides registered at startup */
  private readonly overrides = new Map<string, ConcurrencyMetadata>();

  /**
   * Get concurrency metadata for a tool.
   *
   * Resolution order: override → category default → conservative default
   */
  getMetadata(toolId: string, category?: string): ConcurrencyMetadata {
    const override = this.overrides.get(toolId);
    if (override) {
      return override;
    }

    if (category) {
      return CATEGORY_DEFAULTS[category.toLowerCase()] ?? DEFAULT_METADATA;
    }

    return DEFAULT_METADATA;
  }

  /**
   * Register a concurrency override for a specific tool.
   *
   * Call this from onModuleInit to declare a tool's actual concurrency characteristics
   * when they differ from its category's defaults (e.g. a read-only "integration" tool).
   */
  registerOverride(toolId: string, metadata: ConcurrencyMetadata): void {
    this.overrides.set(toolId, metadata);
    this.logger.debug(
      `[registerOverride] ${toolId}: concurrent=${metadata.isConcurrencySafe}, sideEffects=${metadata.sideEffects}`,
    );
  }

  /**
   * Partition an ordered list of tool calls into parallel groups and sequential calls.
   *
   * The output preserves the original ordering intent:
   * - parallelGroups[i] completes before parallelGroups[i+1] starts.
   * - sequential items interleave with parallel groups in the order they appeared.
   *
   * Callers should schedule execution as:
   *   await Promise.all(parallelGroups[0].map(run))
   *   for (const id of sequential) await run(id)
   *   await Promise.all(parallelGroups[1].map(run))
   *   ...
   *
   * Note: for strict ordering across mixed parallel/sequential groups,
   * callers should iterate the original list using the partition as a lookup.
   */
  partition(toolCalls: ToolCallDescriptor[]): ExecutionPartition {
    const parallelGroups: string[][] = [];
    const sequential: string[] = [];

    let currentParallelGroup: string[] = [];
    let currentResources = new Set<string>();

    for (const call of toolCalls) {
      const meta = this.getMetadata(call.toolId, call.category);

      if (meta.isConcurrencySafe) {
        // Check for resource conflicts within the current parallel group
        const hasConflict = meta.resourcesAccessed.some((r) =>
          currentResources.has(r),
        );

        if (hasConflict) {
          // Flush the current group and start a new one with this tool
          if (currentParallelGroup.length > 0) {
            parallelGroups.push(currentParallelGroup);
          }
          currentParallelGroup = [call.toolId];
          currentResources = new Set(meta.resourcesAccessed);
        } else {
          currentParallelGroup.push(call.toolId);
          for (const r of meta.resourcesAccessed) {
            currentResources.add(r);
          }
        }
      } else {
        // Flush any pending parallel group before the sequential tool
        if (currentParallelGroup.length > 0) {
          parallelGroups.push(currentParallelGroup);
          currentParallelGroup = [];
          currentResources = new Set();
        }
        sequential.push(call.toolId);
      }
    }

    // Flush any remaining parallel group
    if (currentParallelGroup.length > 0) {
      parallelGroups.push(currentParallelGroup);
    }

    if (toolCalls.length > 0) {
      this.logger.debug(
        `[partition] ${toolCalls.length} tools → ` +
          `${parallelGroups.length} parallel groups, ${sequential.length} sequential`,
      );
    }

    return { parallelGroups, sequential };
  }
}
