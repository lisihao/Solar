# Teams And Playground

> 本目录覆盖当前仍在运行的两套多 Agent 业务实现。

## 范围

### 1. `ai-app/teams`

代码目录：

- `backend/src/modules/ai-app/teams/`
- `frontend/app/ai-teams/`

职责：

- Topic 协作
- AI 成员
- Debate
- Team Mission
- Topic 级 WebSocket 实时同步

### 2. `ai-app/playground`

代码目录：

- `backend/src/modules/ai-app/playground/`
- `frontend/app/agent-playground/`

职责：

- 结构化 mission pipeline
- replay、rerun、cancel、leader chat、export
- `agent-playground.*` 事件流

## 当前入口文档

| 文档                                                                     | 说明                                     |
| ------------------------------------------------------------------------ | ---------------------------------------- |
| [architecture.md](architecture.md)                                       | 当前系统边界、组件关系、架构图、数据流图 |
| [features-ai-teams/system-design.md](features-ai-teams/system-design.md) | `ai-app/teams` 的现行系统设计            |
| [../../system-overview.md](../../system-overview.md)                     | 仓库级总览                               |

## 重要说明

旧文档里大量出现的以下路径已经不是当前事实：

- `backend/src/modules/ai-engine/teams/*`
- `docs/features/ai-teams/*`
- `docs/architecture/ai-apps/ai-teams/*`

当前请以：

- `backend/src/modules/ai-app/teams/`
- `backend/src/modules/ai-app/playground/`
- `backend/src/modules/ai-harness/`
- `backend/src/modules/ai-engine/`

以及本目录的新入口文档为准。

## 建议阅读顺序

1. [system-overview.md](../../system-overview.md)
2. [architecture.md](architecture.md)
3. [features-ai-teams/system-design.md](features-ai-teams/system-design.md)
4. `backend/src/modules/ai-app/teams/ai-teams.module.ts`
5. `backend/src/modules/ai-app/playground/agent-playground.module.ts`
