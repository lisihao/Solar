# GenesisPod 文档

> 本目录以当前代码为准，历史方案统一放入 `_archive/`。

## 目录

| 目录            | 说明                                       |
| --------------- | ------------------------------------------ |
| `architecture/` | 与代码结构对齐的架构文档                   |
| `system/`       | 系统级文档目录，描述整体边界、容器和数据流 |
| `guides/`       | 开发、部署、测试、运维指南                 |
| `decisions/`    | ADR                                        |
| `api/`          | 对外 API 文档                              |
| `research/`     | 调研与对标资料                             |
| `demo/`         | 示例文档                                   |
| `slides/`       | 内部分享材料                               |
| `_archive/`     | 历史快照、旧 PRD、旧 audit                 |

## 快速导航

- [系统目录](system/README.md)
- [系统总览](architecture/system-overview.md)
- [架构总览](architecture/README.md)
- [AI Apps](architecture/ai-app/README.md)
- [AI Harness](architecture/ai-harness/README.md)
- [AI Engine](architecture/ai-engine/README.md)
- [AI Infra](architecture/ai-infra/README.md)
- [Open API](architecture/open-api/readme.md)
- [Frontend](architecture/frontend/README.md)

## 当前重点

当前多 Agent 相关的活跃实现主要在：

- `backend/src/modules/ai-app/teams/`
- `backend/src/modules/ai-app/playground/`（前端路由 `agent-playground`）
- `backend/src/modules/ai-harness/`
- `backend/src/modules/ai-engine/`

对应文档入口：

- [系统目录](system/README.md)
- [系统总览](architecture/system-overview.md)
- [Teams And Playground](architecture/ai-app/teams/README.md)
- [Teams Architecture](architecture/ai-app/teams/architecture.md)

## 维护规则

1. 文档必须以真实代码、控制器、Gateway、Prisma 模型和前端 store 为准。
2. 架构图、时序图、数据流图必须能追溯到具体代码入口。
3. 已失真的旧方案不要继续放在活跃导航里，移入 `_archive/` 或在入口文档中显式标注为历史。
4. 系统边界变化时，优先更新 `docs/system/`、`docs/README.md`、`docs/architecture/system-overview.md`。
