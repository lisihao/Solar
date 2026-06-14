import { Injectable, Logger } from "@nestjs/common";

// ─── Types ───

export type SidecarCategory =
  | "finding"
  | "decision"
  | "source"
  | "insight"
  | "error";

export interface SidecarEntry {
  timestamp: Date;
  category: SidecarCategory;
  content: string;
  confidence?: number;
  dimensionName?: string;
}

export interface SidecarConfig {
  /** Max entries before oldest are pruned (default: 200) */
  maxEntries: number;
  /** Max summary length in chars when generating compact summary (default: 4000) */
  maxSummaryChars: number;
}

interface SidecarSession {
  entries: SidecarEntry[];
  config: SidecarConfig;
  createdAt: Date;
  compactionCount: number;
}

const DEFAULT_CONFIG: SidecarConfig = {
  maxEntries: 200,
  maxSummaryChars: 4000,
};

/**
 * SessionMemorySidecarService
 *
 * Maintains a running log of key findings OUTSIDE the LLM context window.
 * When ContextCompactionPipeline compresses conversation history, earlier
 * findings are lost from the messages array. The sidecar preserves them
 * and can inject a compact summary into the system prompt.
 *
 * Key design:
 * - Non-blocking: addEntry() is synchronous, no async overhead
 * - Bounded: maxEntries prevents unbounded growth
 * - Category-aware: findings, decisions, sources categorized for summary generation
 * - Compaction-integrated: onCompaction() returns a formatted summary for system prompt injection
 *
 * Inspired by Claude Code's SessionMemory pattern (separate from context window).
 */
@Injectable()
export class SessionMemorySidecarService {
  private readonly logger = new Logger(SessionMemorySidecarService.name);
  private readonly sessions = new Map<string, SidecarSession>();

  /**
   * Initialize a sidecar for a session
   */
  initialize(sessionId: string, config?: Partial<SidecarConfig>): void {
    const fullConfig = { ...DEFAULT_CONFIG, ...config };
    this.sessions.set(sessionId, {
      entries: [],
      config: fullConfig,
      createdAt: new Date(),
      compactionCount: 0,
    });
    this.logger.debug(`[initialize] Session ${sessionId}`);
  }

  /**
   * Add an entry to the sidecar (non-blocking, synchronous)
   */
  addEntry(sessionId: string, entry: SidecarEntry): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      // Auto-initialize if not found
      this.initialize(sessionId);
      this.addEntry(sessionId, entry);
      return;
    }

    session.entries.push(entry);

    // Prune oldest if over limit
    if (session.entries.length > session.config.maxEntries) {
      const excess = session.entries.length - session.config.maxEntries;
      session.entries.splice(0, excess);
    }
  }

  /**
   * Get all entries for a session
   */
  getEntries(sessionId: string): SidecarEntry[] {
    return this.sessions.get(sessionId)?.entries ?? [];
  }

  /**
   * Get entry count
   */
  getEntryCount(sessionId: string): number {
    return this.sessions.get(sessionId)?.entries.length ?? 0;
  }

  /**
   * Generate a full markdown representation of all entries
   */
  getMarkdown(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session || session.entries.length === 0) return "";

    const lines: string[] = ["# Session Memory\n"];

    // Group by category
    const grouped = new Map<SidecarCategory, SidecarEntry[]>();
    for (const entry of session.entries) {
      const list = grouped.get(entry.category) ?? [];
      list.push(entry);
      grouped.set(entry.category, list);
    }

    const categoryLabels: Record<SidecarCategory, string> = {
      finding: "Key Findings",
      decision: "Decisions Made",
      source: "Important Sources",
      insight: "Insights",
      error: "Issues Encountered",
    };

    for (const [category, entries] of grouped) {
      lines.push(`\n## ${categoryLabels[category]}\n`);
      for (const entry of entries) {
        const dim = entry.dimensionName ? ` [${entry.dimensionName}]` : "";
        const conf =
          entry.confidence !== undefined
            ? ` (confidence: ${(entry.confidence * 100).toFixed(0)}%)`
            : "";
        lines.push(`- ${entry.content}${dim}${conf}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Generate a compact summary suitable for system prompt injection.
   * Called after compaction to preserve key context.
   */
  getSummary(sessionId: string, maxChars?: number): string {
    const session = this.sessions.get(sessionId);
    if (!session || session.entries.length === 0) return "";

    const limit = maxChars ?? session.config.maxSummaryChars;

    // Prioritize: findings > insights > decisions > sources > errors
    const priorityOrder: SidecarCategory[] = [
      "finding",
      "insight",
      "decision",
      "source",
      "error",
    ];
    const lines: string[] = [
      `[Session Memory — ${session.entries.length} items, ${session.compactionCount} compactions]\n`,
    ];

    let totalChars = lines[0].length;

    for (const category of priorityOrder) {
      const entries = session.entries.filter((e) => e.category === category);
      if (entries.length === 0) continue;

      for (const entry of entries) {
        const line = `- [${category}] ${entry.content}`;
        if (totalChars + line.length > limit) break;
        lines.push(line);
        totalChars += line.length;
      }

      if (totalChars >= limit) break;
    }

    return lines.join("\n");
  }

  /**
   * Called when context compaction occurs.
   * Returns a formatted summary for system prompt injection.
   * Increments the compaction counter.
   */
  onCompaction(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) return "";

    session.compactionCount++;

    this.logger.log(
      `[onCompaction] Session ${sessionId}: compaction #${session.compactionCount}, ` +
        `${session.entries.length} entries preserved`,
    );

    return this.getSummary(sessionId);
  }

  /**
   * Clean up a completed session
   */
  destroy(sessionId: string): SidecarEntry[] {
    const session = this.sessions.get(sessionId);
    const entries = session?.entries ?? [];
    this.sessions.delete(sessionId);

    if (entries.length > 0) {
      this.logger.debug(
        `[destroy] Session ${sessionId}: ${entries.length} entries, ` +
          `${session?.compactionCount ?? 0} compactions`,
      );
    }

    return entries;
  }

  /**
   * Check if a session exists
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }
}
