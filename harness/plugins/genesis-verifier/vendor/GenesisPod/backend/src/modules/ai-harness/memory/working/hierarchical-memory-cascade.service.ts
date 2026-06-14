import { Injectable, Logger } from "@nestjs/common";

// ─── Types ───

export type MemoryScope = "org" | "team" | "project" | "session";

/** Priority order: session (highest) → project → team → org (lowest) */
const SCOPE_PRIORITY: MemoryScope[] = ["session", "project", "team", "org"];

export interface MemoryCascadeQuery {
  orgId?: string;
  teamId?: string;
  projectId?: string;
  sessionId: string;
  key: string;
}

export interface MemoryCascadeResult {
  value: unknown;
  resolvedFrom: MemoryScope;
}

export interface MemoryWriteOptions {
  ttlMs?: number;
}

/**
 * HierarchicalMemoryCascadeService
 *
 * 4-level memory hierarchy: org → team → project → session
 * Lower scopes override higher scopes on the same key.
 *
 * Cascade resolution order (first match wins):
 * 1. session (highest priority)
 * 2. project
 * 3. team
 * 4. org (lowest priority)
 *
 * This enables:
 * - Org-level defaults (industry terminology, style guides)
 * - Team-level overrides (project background, methodology)
 * - Project-level context (topic-specific facts)
 * - Session-level findings (current research discoveries)
 */
@Injectable()
export class HierarchicalMemoryCascadeService {
  private readonly logger = new Logger(HierarchicalMemoryCascadeService.name);

  // Storage: Map<scopeKey, Map<key, { value, expiresAt? }>>
  // scopeKey format: "org:orgId" or "team:teamId" etc.
  private readonly store = new Map<
    string,
    Map<string, { value: unknown; expiresAt?: number }>
  >();

  /**
   * Write a value to a specific scope
   */
  write(
    scope: MemoryScope,
    scopeId: string,
    key: string,
    value: unknown,
    options?: MemoryWriteOptions,
  ): void {
    const scopeKey = `${scope}:${scopeId}`;
    if (!this.store.has(scopeKey)) {
      this.store.set(scopeKey, new Map());
    }
    const entry: { value: unknown; expiresAt?: number } = { value };
    if (options?.ttlMs) {
      entry.expiresAt = Date.now() + options.ttlMs;
    }
    this.store.get(scopeKey)!.set(key, entry);
  }

  /**
   * Resolve a key by cascading through scopes (session → project → team → org)
   */
  resolve(query: MemoryCascadeQuery): MemoryCascadeResult | null {
    const scopeIds: Array<{ scope: MemoryScope; id: string | undefined }> = [
      { scope: "session", id: query.sessionId },
      { scope: "project", id: query.projectId },
      { scope: "team", id: query.teamId },
      { scope: "org", id: query.orgId },
    ];

    for (const { scope, id } of scopeIds) {
      if (!id) continue;
      const scopeKey = `${scope}:${id}`;
      const scopeMap = this.store.get(scopeKey);
      if (!scopeMap) continue;

      const entry = scopeMap.get(query.key);
      if (!entry) continue;

      // Check TTL
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        scopeMap.delete(query.key);
        continue;
      }

      return { value: entry.value, resolvedFrom: scope };
    }

    return null;
  }

  /**
   * Resolve multiple keys, returning all found values with their sources
   */
  resolveAll(
    query: Omit<MemoryCascadeQuery, "key">,
    keys: string[],
  ): Map<string, MemoryCascadeResult> {
    const results = new Map<string, MemoryCascadeResult>();
    for (const key of keys) {
      const result = this.resolve({ ...query, key });
      if (result) {
        results.set(key, result);
      }
    }
    return results;
  }

  /**
   * Promote keys from session scope to project scope.
   * Copies values from session → project (does not delete from session).
   * Returns the number of keys promoted.
   */
  promote(sessionId: string, projectId: string, keys: string[]): number {
    const sessionKey = `session:${sessionId}`;
    const sessionMap = this.store.get(sessionKey);
    if (!sessionMap) return 0;

    let promoted = 0;
    for (const key of keys) {
      const entry = sessionMap.get(key);
      if (!entry) continue;

      // Skip expired
      if (entry.expiresAt && Date.now() > entry.expiresAt) continue;

      this.write("project", projectId, key, entry.value);
      promoted++;
    }

    if (promoted > 0) {
      this.logger.log(
        `[promote] ${promoted}/${keys.length} keys: session:${sessionId} → project:${projectId}`,
      );
    }

    return promoted;
  }

  /**
   * List all keys in a specific scope
   */
  listKeys(scope: MemoryScope, scopeId: string): string[] {
    const scopeKey = `${scope}:${scopeId}`;
    const scopeMap = this.store.get(scopeKey);
    if (!scopeMap) return [];

    // Clean expired entries while listing
    const keys: string[] = [];
    const now = Date.now();
    for (const [key, entry] of scopeMap) {
      if (entry.expiresAt && now > entry.expiresAt) {
        scopeMap.delete(key);
        continue;
      }
      keys.push(key);
    }
    return keys;
  }

  /**
   * Clear all entries in a scope
   */
  clearScope(scope: MemoryScope, scopeId: string): number {
    const scopeKey = `${scope}:${scopeId}`;
    const scopeMap = this.store.get(scopeKey);
    if (!scopeMap) return 0;

    const count = scopeMap.size;
    this.store.delete(scopeKey);
    return count;
  }

  /**
   * Delete a specific key from a scope
   */
  delete(scope: MemoryScope, scopeId: string, key: string): boolean {
    const scopeKey = `${scope}:${scopeId}`;
    const scopeMap = this.store.get(scopeKey);
    if (!scopeMap) return false;
    return scopeMap.delete(key);
  }
}

// Re-export SCOPE_PRIORITY for consumers that need to introspect the order
export { SCOPE_PRIORITY };
