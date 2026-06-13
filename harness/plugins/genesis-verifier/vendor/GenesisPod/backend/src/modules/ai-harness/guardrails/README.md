# guardrails

> harness 运行态约束与资源防护层。

## 定位

`guardrails/` 只承接 mission / agent 执行期的保护能力，例如预算、并发、资源配额、运行时环境探测与约束强制。

## 目录约定

- `index.ts`: 只保留 public barrel
- `exports/`: 对外分组导出
- `budget/`: 预算核算与池化
- `billing/`: billing runtime 适配
- 根目录 service / type: 运行时约束主实现

## 禁止事项

- 禁止把 engine 级安全原子能力搬进来
- 禁止把 app 业务审批流挂成 runtime guardrail
- 禁止在 `index.ts` 继续堆平铺导出

## 整理原则

- 根出口保持薄，分组导出承担聚合
- runtime 保护与业务策略分离
- 兼容 re-export 可以保留，但要有明确归组
