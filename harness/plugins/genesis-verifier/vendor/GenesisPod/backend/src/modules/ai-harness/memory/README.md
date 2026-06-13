# memory

> harness 侧 memory semantics。

## 定位

`memory/` 负责 working memory、checkpoint、vector store adapter、indexing、consolidation、memory tools。

## 明确边界

- execution state / recall policy / checkpoint scope 属于这里
- embedding / retrieval primitive 仍属于 engine 能力轴
- persistence substrate 仍属于 infra

- `checkpoint/`
  - agent/runtime 级 checkpoint contract
  - 给 harness 内部 loop / event / resume 机制使用

- `mission-checkpoint/`
  - mission/job 级 resume contract
  - 当前仍被 ai-app mission workflow 消费，后续再与主 checkpoint 统一
