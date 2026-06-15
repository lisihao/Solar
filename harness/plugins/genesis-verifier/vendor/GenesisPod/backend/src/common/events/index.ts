/**
 * Events Module Exports
 */

export * from "./event-bus.service";
export * from "./event-types";
export * from "./events.module";

// Canonical 事件总线（2026-06-03 从 ai-harness/protocols/events 下沉 + 更名）
// EventBus(原 DomainEventBus)：schema 校验 + Redis 节流 + broadcast-adapter。
// 阶段2 将迁移上面 EventBusService 的消费方至此并删旧实现。
export { EventBus } from "./event-bus";
export { EventRegistry } from "./event-registry";
export { LoggerBroadcastAdapter } from "./broadcast-adapter";
export type { IBroadcastAdapter } from "./broadcast-adapter";
export type { DomainEvent, DomainEventTypeSpec } from "./domain-event.types";
