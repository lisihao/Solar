# mission-checkpoint

> mission/job 级恢复契约。

## 定位

`mission-checkpoint/` 当前承载长任务恢复所需的 mission snapshot/store/service。

## 说明

- 这不是 harness 内部主 checkpoint contract
- 它当前被 ai-app mission workflow 消费
- 后续应和 `checkpoint/` 做 scope 级统一，而不是继续平行扩张
