# abstractions

> `ai-infra` 共享抽象与 DI token。

## 定位

`abstractions/` 只放跨 `ai-infra` 与上层模块共享的最小抽象契约。

## 允许内容

- DI token
- 小而稳定的接口类型
- 为了跨层注入而存在的最小契约

## 禁止内容

- 业务逻辑实现
- 领域服务
- 为单一 app 场景临时添加的“伪抽象”
