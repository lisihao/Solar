# tracing

> harness 可观测性、评测追踪与 tracer 基础设施。

## 定位

`tracing/` 负责 trace collection、otel tracer、eval run 追踪、成本归因、session latency 等观测能力。

## 目录约定

- `index.ts`: 只做 public barrel
- `exports/`: 按观测 / 评测 / 延迟 / tracer / utils 分组导出
- `tracer/`: otel 语义、span 生命周期与 exporter
- 根目录 service / type: tracing 模块主实现

## 禁止事项

- 禁止把 admin controller 再塞回 tracing 根目录
- 禁止把 tracer 原子能力和业务评测 service 混成一个平铺出口

## 整理原则

- 根出口稳定，语义分组明确
- tracer 是基础设施层，evaluation / observability 是上层能力
- 新增 public symbol 优先进入 `exports/` 分组，而不是继续堆到根 `index.ts`
