/**
 * EventBus — 业务事件中央枢纽
 *
 * 职责：
 *   1. emit() 时按 EventRegistry 校验 type + payload schema
 *   2. 应用 throttle（每 source 每 window 最多 N 条）
 *   3. 应用 idempotency（idempotencyKey 在 60s 内重复直接 drop）
 *   4. 分发到所有 accept 的 IBroadcastAdapter
 *   5. adapter 失败只 logger.warn，永不抛
 *
 * 与 IAgentEvent 的桥接：
 *   - 业务方在 hook 里把 IAgentEvent 翻译成 DomainEvent
 *   - 例：PostToolUse hook → emit('{app}.evidence:found', {...})
 *
 * 存储架构（PR-E Phase 2 P0-4）：
 *   - throttle  → Redis  key=harness:event-bus:throttle:{type}|{agentId}
 *                         value=JSON{windowStart,count}  TTL=spec.throttle.windowMs
 *   - idempotency → Redis key=harness:event-bus:idempotency:{dedupKey}
 *                         value='1'  TTL=60s
 *   CacheService 是 @Global，HarnessModule 无需额外 import。
 *   无 REDIS_URL 时 CacheService 自动降级为进程内 in-memory cache（行为与原 Map 等价）。
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { EventRegistry } from "./event-registry";
import { IBroadcastAdapter, LoggerBroadcastAdapter } from "./broadcast-adapter";
import type { DomainEvent } from "./domain-event.types";
import { CacheService } from "@/common/cache/cache.service";

interface ThrottleState {
  windowStart: number;
  count: number;
}

const THROTTLE_KEY_PREFIX = "harness:event-bus:throttle:";
const IDEMPOTENCY_KEY_PREFIX = "harness:event-bus:idempotency:";
const IDEMPOTENCY_TTL_SEC = 60;

@Injectable()
export class EventBus {
  private readonly log = new Logger(EventBus.name);
  private readonly adapters: IBroadcastAdapter[] = [];

  constructor(
    private readonly registry: EventRegistry,
    private readonly cache: CacheService,
    @Optional() defaultAdapter?: LoggerBroadcastAdapter,
  ) {
    if (defaultAdapter) this.adapters.push(defaultAdapter);
  }

  registerAdapter(adapter: IBroadcastAdapter): void {
    if (!this.adapters.find((a) => a.id === adapter.id)) {
      this.adapters.push(adapter);
    }
  }

  unregisterAdapter(id: string): void {
    const i = this.adapters.findIndex((a) => a.id === id);
    if (i >= 0) this.adapters.splice(i, 1);
  }

  /**
   * 发出业务事件。
   * 返回 true 表示事件被广播；false 表示被 throttle/dedupe drop 或 schema 失败。
   */
  async emit<TPayload>(event: DomainEvent<TPayload>): Promise<boolean> {
    const spec = this.registry.get(event.type);
    if (!spec) {
      this.log.warn(
        `Domain event "${event.type}" not registered — dropping. ` +
          `Use EventRegistry.register() at module init.`,
      );
      return false;
    }

    // 1. Schema validation
    if (spec.schema) {
      const parsed = spec.schema.safeParse(event.payload);
      if (!parsed.success) {
        const detail = parsed.error.issues
          .map((i) => `${i.path.join(".")}:${i.message}`)
          .join("; ");
        const msg = `Domain event "${event.type}" payload validation failed: ${detail}`;
        // 默认行为：log.error + return false（不阻断业务，避免单事件挂全 mission）。
        // Railway stderr 会捕获 .error 便于事后溯源。
        // STRICT_DOMAIN_EVENT_VALIDATION=true 时 throw（dev 期排查 contract drift
        // 用，让 backend 自己炸而不是污染前端 ErrorBoundary）。
        this.log.error(msg);
        if (process.env.STRICT_DOMAIN_EVENT_VALIDATION === "true") {
          throw new Error(msg);
        }
        return false;
      }
    }

    // 2. Idempotency dedupe (Redis-backed, multi-pod consistent)
    if (event.idempotencyKey) {
      const iKey = `${IDEMPOTENCY_KEY_PREFIX}${event.idempotencyKey}`;
      const existing = await this.cache.get<string>(iKey);
      if (existing !== undefined) {
        return false;
      }
      await this.cache.set(iKey, "1", IDEMPOTENCY_TTL_SEC);
    }

    // 3. Throttle per (type, agentId|*) — Redis-backed, multi-pod consistent
    if (spec.throttle) {
      const sourceKey = event.agentId ?? "__global__";
      const tKey = `${THROTTLE_KEY_PREFIX}${event.type}|${sourceKey}`;
      const windowSec = Math.ceil(spec.throttle.windowMs / 1000);
      const now = Date.now();

      const raw = await this.cache.get<string>(tKey);
      let state: ThrottleState | undefined;
      if (raw !== undefined) {
        try {
          state = JSON.parse(raw) as ThrottleState;
        } catch {
          state = undefined;
        }
      }

      if (!state || now - state.windowStart > spec.throttle.windowMs) {
        await this.cache.set(
          tKey,
          JSON.stringify({ windowStart: now, count: 1 }),
          windowSec,
        );
      } else if (state.count >= spec.throttle.maxEvents) {
        return false; // throttled
      } else {
        await this.cache.set(
          tKey,
          JSON.stringify({
            windowStart: state.windowStart,
            count: state.count + 1,
          }),
          windowSec,
        );
      }
    }

    // 4. Broadcast
    await Promise.all(
      this.adapters
        .filter((a) => a.accepts(event))
        .map((a) =>
          a.broadcast(event).catch((err) => {
            this.log.warn(
              `Adapter ${a.id} failed for ${event.type}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }),
        ),
    );
    return true;
  }
}
