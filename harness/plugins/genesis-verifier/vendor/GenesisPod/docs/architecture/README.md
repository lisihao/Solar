# Architecture

> 与当前代码结构对齐的架构索引。

## 五层结构

| 层       | 文档                                | 代码路径                          | 说明                         |
| -------- | ----------------------------------- | --------------------------------- | ---------------------------- |
| L4       | [open-api/](open-api/readme.md)     | `backend/src/modules/open-api/`   | 对外 API、MCP、A2A、Webhooks |
| L3       | [ai-app/](ai-app/README.md)         | `backend/src/modules/ai-app/`     | 业务应用层                   |
| L2.5     | [ai-harness/](ai-harness/README.md) | `backend/src/modules/ai-harness/` | Agent 运行时与编排           |
| L2       | [ai-engine/](ai-engine/README.md)   | `backend/src/modules/ai-engine/`  | 原子 AI 能力                 |
| L1       | [platform/](ai-infra/README.md)     | `backend/src/modules/platform/`   | 基础设施底座（旧称 ai-infra）|
| Frontend | [frontend/](frontend/README.md)     | `frontend/`                       | Next.js 应用                 |

## 图解

- [illustrated/](illustrated/README.md) —— **架构手绘图集**（engine 6 + harness 6，直观心智模型；权威结构仍以 standards/16 为准）

## 系统级文档

- [../system/README.md](../system/README.md)
  - 系统级目录入口
  - context / container / data flow 分拆文档
- [system-overview.md](system-overview.md)
  - 仓库组件关系
  - 五层依赖图
  - `ai-app/teams` 与 `ai-app/playground` 数据流
  - 核心存储与传输路径
- [monetization/](monetization/subscription-byok-credit-system-design.md)
  - 商业化：订阅制 + Free-tier BYOK + 统一 Credit 计量
  - 跨 platform(credits) / ai-app(byok) / ai-harness(计量) 的平台级设计

## 依赖方向

```text
open-api -> ai-app -> ai-harness -> ai-engine -> platform
```

补充规则：

- `ai-app` 可以消费 `ai-engine/facade` 与 `ai-harness/facade`
- `ai-engine` 不得反向依赖 `ai-harness`、`ai-app`
- L1 `platform`（旧称 ai-infra，真实目录 `backend/src/modules/platform/`）不得依赖更高层
- 约束由 `backend/src/__tests__/architecture/layer-1-topology/layer-boundaries.spec.ts` 守护
