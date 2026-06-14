# L5 Open API — 开放接口层

> MCP Server、Public API、Webhooks

## 模块路径

`backend/src/modules/open-api/`

## 子模块

| 子模块     | 路径                   | 描述                                 |
| ---------- | ---------------------- | ------------------------------------ |
| MCP Server | `open-api/mcp-server/` | 对外提供 MCP 协议接口 (JSON-RPC 2.0) |
| Public API | `open-api/public-api/` | REST API for 外部消费者              |
| Webhooks   | `open-api/webhooks/`   | Webhook 事件分发                     |

## 设计原则

- 统一对外接口层，隔离内部实现
- MCP Server 遵循 JSON-RPC 2.0 协议
- Public API 需要 API Key 认证

---

最后更新: 2026-03-05
