# System Docs

> 系统级文档目录。这里关注仓库整体、系统边界、容器关系和跨组件数据流，不展开单个业务模块内部细节。

## 目录

| 文档                                                                     | 说明                                                      |
| ------------------------------------------------------------------------ | --------------------------------------------------------- |
| [context.md](context.md)                                                 | 系统上下文，说明用户、前端、后端、AI 服务和基础设施的关系 |
| [container.md](container.md)                                             | 仓库内主要运行单元、后端五层结构和活跃系统划分            |
| [data-flows.md](data-flows.md)                                           | AI Teams 与 Agent Playground 的关键数据流                 |
| [../architecture/system-overview.md](../architecture/system-overview.md) | 合并视图，适合快速总览                                    |

## 推荐阅读顺序

1. [context.md](context.md)
2. [container.md](container.md)
3. [data-flows.md](data-flows.md)
4. [../architecture/system-overview.md](../architecture/system-overview.md)

## 维护规则

1. 系统图必须能回指到真实代码入口或部署单元。
2. 系统文档描述跨组件关系，组件内部实现细节放回 `docs/architecture/`。
3. 系统边界变化时，先更新本目录，再更新 `docs/README.md` 和 `docs/architecture/system-overview.md`。
