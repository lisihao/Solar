# business-team / events

Namespace-aware event relay：业务方 extends + 注入 namespace 字符串后，所有 lifecycle / agent / cost 事件自动加 `${namespace}.xxx` 前缀。

## 含

- `event-relay.framework.ts` — `EventRelayFramework`（E1；emit / tickCost / IAgentEvent 8 类翻译 / budget exhaustion / namespace 强校验）

## 业务侧应如何继承

```ts
@Injectable()
class PlaygroundEventRelay extends EventRelayFramework {
  constructor(eventBus: DomainEventBus) {
    super(eventBus, "agent-playground"); // ← 业务 namespace
  }
}
```

业务方仅暴露 namespace 字符串与 DomainEventBus 实例，framework 内部拼接所有事件类型；social/radar 同款模式。

## 历史

- 2026-05-08 PR-E1：从 reference impl `agent-playground` 抽出（`@migrated-from`），原 ~360 行 emit/tickCost/IAgentEvent 翻译全部上提。
- 2026-05-24 P8：原目录 `relay/` rename 为 `events/` 对齐蓝图 §8.1（`relay` 是动作词，`events` 是业界标准聚合词）。
