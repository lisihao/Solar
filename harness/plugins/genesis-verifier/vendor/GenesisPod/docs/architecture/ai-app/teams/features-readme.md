# AI Teams Features Index

> 本页是 `docs/architecture/ai-app/teams/` 的功能索引页，只保留当前可用导航，不再混放旧实现草稿。

## 当前主入口

| 文档                                                                     | 说明                                            | 状态    |
| ------------------------------------------------------------------------ | ----------------------------------------------- | ------- |
| [README.md](README.md)                                                   | 当前目录边界说明                                | Current |
| [architecture.md](architecture.md)                                       | `ai-app/teams` 与 `agent-playground` 的整体架构 | Current |
| [core-concepts.md](core-concepts.md)                                     | 当前 Teams 核心对象和边界                       | Current |
| [mission-lifecycle.md](mission-lifecycle.md)                             | 当前 Team Mission 生命周期                      | Current |
| [features-ai-teams/system-design.md](features-ai-teams/system-design.md) | 当前 `ai-app/teams` 系统设计                    | Current |
| [../../system-overview.md](../../system-overview.md)                     | 仓库级组件关系与数据流                          | Current |

## 功能专题

| 文档                                                                             | 主题              | 说明                               | 状态         |
| -------------------------------------------------------------------------------- | ----------------- | ---------------------------------- | ------------ |
| [features-ai-teams/topic-research.md](features-ai-teams/topic-research.md)       | Topic Research    | 业务专题说明，部分章节仍待逐段校验 | Needs review |
| [features-ai-teams/debate-system.md](features-ai-teams/debate-system.md)         | Debate            | 讨论辩论能力                       | Needs review |
| [features-ai-teams/mission-execution.md](features-ai-teams/mission-execution.md) | Mission Execution | 任务执行机制专题                   | Needs review |

## 代码事实源

新增或校正文档时，优先核对以下代码：

- `backend/src/modules/ai-app/teams/controllers/ai-teams.controller.ts`
- `backend/src/modules/ai-app/teams/ai-teams.gateway.ts`
- `backend/src/modules/ai-app/teams/services/`
- `backend/prisma/schema/models.prisma`
- `frontend/services/ai-teams/api.ts`
- `frontend/stores/ai-teams/`

## 历史文档处理规则

1. 仍引用 `backend/src/modules/ai-engine/teams/*` 的页面默认按历史资料处理。
2. 仍引用 `docs/architecture/ai-apps/ai-teams/*` 或 `docs/features/ai-teams/*` 的链接需要重写。
3. 未能映射到 controller、gateway、Prisma 或 frontend store 的图和流程，不能标注为当前架构。
