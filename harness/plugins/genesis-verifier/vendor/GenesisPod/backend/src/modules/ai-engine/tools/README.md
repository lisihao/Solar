# tools

> 工具定义、注册、执行与 adapter 边界。

## 定位

`tools/` 负责单次工具调用能力，不负责 agent 视角的工具编排。

## 明确边界

- 允许：
  - tool contract
  - registry / middleware / concurrency
  - source adapter，如 MCP
  - 分类工具实现

- 不允许：
  - agent-specific tool orchestration
  - app 领域服务伪装成 tool core
