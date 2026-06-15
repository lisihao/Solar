/**
 * EventRegistry — 业务事件类型中央表
 *
 * 业务模块（业务模块 / ...）启动时注册自己用到的事件类型，
 * 中央表强制：
 *   - 同一 type 全局唯一（防止 'mission:started' 多个模块定义不一致）
 *   - schema 校验 payload 形状
 *   - throttle 配置 / ack 配置随类型走
 *
 * Harness 内置事件类型为 'harness.*' 前缀；业务方用模块名前缀（'{app}.*'）。
 */

import { Injectable, Logger } from "@nestjs/common";
import type { DomainEventTypeSpec } from "./domain-event.types";

@Injectable()
export class EventRegistry {
  private readonly log = new Logger(EventRegistry.name);
  private readonly specs = new Map<string, DomainEventTypeSpec<unknown>>();

  register<TPayload>(spec: DomainEventTypeSpec<TPayload>): void {
    if (this.specs.has(spec.type)) {
      this.log.warn(
        `Domain event type "${spec.type}" already registered — overwriting`,
      );
    }
    this.specs.set(spec.type, spec as DomainEventTypeSpec<unknown>);
  }

  registerAll(specs: readonly DomainEventTypeSpec<unknown>[]): void {
    for (const s of specs) this.register(s);
  }

  get(type: string): DomainEventTypeSpec<unknown> | undefined {
    return this.specs.get(type);
  }

  has(type: string): boolean {
    return this.specs.has(type);
  }

  list(): readonly DomainEventTypeSpec<unknown>[] {
    return [...this.specs.values()];
  }

  /** 按前缀过滤（业务方查询自己模块的事件类型） */
  listByPrefix(prefix: string): readonly DomainEventTypeSpec<unknown>[] {
    return this.list().filter((s) => s.type.startsWith(prefix));
  }
}
