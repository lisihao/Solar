/**
 * Short Term Memory Service
 * Session-level temporary storage with TTL support
 */
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { LruMap } from "@/common/utils/lru-map";

interface MemoryItem {
  key: string;
  value: unknown;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ShortTermMemoryService {
  private readonly sessions: LruMap<string, Map<string, MemoryItem>>;

  constructor(private readonly configService: ConfigService) {
    const capacity = this.configService.get<number>(
      "AI_ENGINE_STM_CAPACITY",
      1000,
    );
    this.sessions = new LruMap<string, Map<string, MemoryItem>>(capacity);
  }

  private getSessionStore(sessionId: string): Map<string, MemoryItem> {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, new Map());
    }
    return this.sessions.get(sessionId)!;
  }

  private isExpired(item: MemoryItem): boolean {
    if (!item.expiresAt) return false;
    return item.expiresAt < new Date();
  }

  private getExpiresAt(ttl?: number): Date | undefined {
    if (!ttl || ttl <= 0) return undefined;
    return new Date(Date.now() + ttl * 1000);
  }

  async getWithSession(sessionId: string, key: string): Promise<unknown> {
    const store = this.getSessionStore(sessionId);
    const item = store.get(key);
    if (!item) return undefined;
    if (this.isExpired(item)) {
      store.delete(key);
      return undefined;
    }
    return item.value;
  }

  async setWithSession(
    sessionId: string,
    key: string,
    value: unknown,
    ttl?: number,
  ): Promise<void> {
    const store = this.getSessionStore(sessionId);
    const now = new Date();
    store.set(key, {
      key,
      value,
      expiresAt: this.getExpiresAt(ttl),
      createdAt: now,
      updatedAt: now,
    });
  }

  async appendWithSession(
    sessionId: string,
    key: string,
    value: unknown,
    ttl?: number,
  ): Promise<void> {
    const store = this.getSessionStore(sessionId);
    const existing = store.get(key);
    const now = new Date();
    let newValue: unknown[];
    if (!existing || this.isExpired(existing)) {
      newValue = [value];
    } else if (Array.isArray(existing.value)) {
      newValue = [...existing.value, value];
    } else {
      newValue = [existing.value, value];
    }
    store.set(key, {
      key,
      value: newValue,
      expiresAt: this.getExpiresAt(ttl),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    });
  }

  async deleteWithSession(sessionId: string, key: string): Promise<boolean> {
    const store = this.getSessionStore(sessionId);
    return store.delete(key);
  }

  async clearSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async listSession(
    sessionId: string,
  ): Promise<Array<{ key: string; value: unknown; expiresAt?: Date }>> {
    const store = this.getSessionStore(sessionId);
    const results: Array<{ key: string; value: unknown; expiresAt?: Date }> =
      [];
    for (const [key, item] of store.entries()) {
      if (!this.isExpired(item)) {
        results.push({ key, value: item.value, expiresAt: item.expiresAt });
      } else {
        store.delete(key);
      }
    }
    return results;
  }

  getAllSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  cleanup(): number {
    let count = 0;
    const now = new Date();
    for (const [sessionId, store] of this.sessions.entries()) {
      for (const [key, item] of store.entries()) {
        if (item.expiresAt && item.expiresAt < now) {
          store.delete(key);
          count++;
        }
      }
      if (store.size === 0) this.sessions.delete(sessionId);
    }
    return count;
  }
}
