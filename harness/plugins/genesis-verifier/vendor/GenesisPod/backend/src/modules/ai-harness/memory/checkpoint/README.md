# checkpoint

> harness 内部 checkpoint 主契约。

## 定位

`checkpoint/` 负责 agent/runtime 级 checkpoint、事件存储与 store 实现。

## 禁止事项

- 禁止把 mission app-specific resume 逻辑堆进这里
