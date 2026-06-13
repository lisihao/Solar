/**
 * MemorySubFacade
 * Handles short-term and long-term memory operations.
 * Plain TypeScript class — NOT @Injectable. Instantiated by AIFacade.
 */

import { Logger } from "@nestjs/common";
import type { MemoryFeature } from "../facade.providers";
import type {
  StoreMemoryRequest,
  RetrieveMemoryRequest,
  MemoryItem,
} from "../types";

export class MemorySubFacade {
  private readonly logger = new Logger(MemorySubFacade.name);

  constructor(private readonly memory?: MemoryFeature) {}

  async storeMemory(request: StoreMemoryRequest): Promise<void> {
    this.logger.debug(
      `[storeMemory] sessionId=${request.sessionId}, type=${request.type}`,
    );

    if (request.type === "short" && this.memory?.shortTerm) {
      await this.memory.shortTerm.setWithSession(
        request.sessionId,
        "memory",
        request.content,
      );
    } else if (request.type === "long" && this.memory?.longTerm) {
      await this.memory.longTerm.setWithUser(
        request.sessionId,
        "memory",
        request.content,
      );
    } else {
      this.logger.warn(
        `[storeMemory] Memory service not available for type=${request.type}`,
      );
    }
  }

  async retrieveMemory(request: RetrieveMemoryRequest): Promise<MemoryItem[]> {
    this.logger.debug(
      `[retrieveMemory] sessionId=${request.sessionId}, topK=${request.topK}`,
    );

    const items: MemoryItem[] = [];

    if (this.memory?.shortTerm) {
      const memory = await this.memory.shortTerm.getWithSession(
        request.sessionId,
        "memory",
      );
      if (memory) {
        items.push({
          id: `short-${request.sessionId}`,
          content: typeof memory === "string" ? memory : JSON.stringify(memory),
          type: "short",
          createdAt: new Date(),
        });
      }
    }

    if (this.memory?.longTerm && request.query) {
      const results = await this.memory.longTerm.search(request.query, {
        userId: request.sessionId,
        limit: request.topK,
      });
      for (const result of results) {
        items.push({
          id: result.key,
          content:
            typeof result.value === "string"
              ? result.value
              : JSON.stringify(result.value),
          type: "long",
          score: result.score,
          createdAt: new Date(),
        });
      }
    }

    return items;
  }

  async clearMemory(sessionId: string): Promise<void> {
    this.logger.debug(`[clearMemory] sessionId=${sessionId}`);

    if (this.memory?.shortTerm) {
      await this.memory.shortTerm.deleteWithSession(sessionId, "memory");
    }
  }

  async sessionMemoryGet(sessionId: string, key: string): Promise<unknown> {
    if (!this.memory?.shortTerm) return undefined;
    return this.memory.shortTerm.getWithSession(sessionId, key);
  }

  async sessionMemorySet(
    sessionId: string,
    key: string,
    value: unknown,
    ttl?: number,
  ): Promise<void> {
    if (!this.memory?.shortTerm) return;
    await this.memory.shortTerm.setWithSession(sessionId, key, value, ttl);
  }

  async sessionMemoryClear(sessionId: string): Promise<void> {
    if (!this.memory?.shortTerm) return;
    await this.memory.shortTerm.clearSession(sessionId);
  }
}
