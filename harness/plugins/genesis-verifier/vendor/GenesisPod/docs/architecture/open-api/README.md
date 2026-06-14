# L4 Open API

> 对外开放接口层。MCP / A2A / Public REST / Webhooks。
> 代码路径：`backend/src/modules/open-api/`

## 子模块清单

| 子模块      | 代码路径             | 职责                                            |
| ----------- | -------------------- | ----------------------------------------------- |
| `admin/`    | `open-api/admin/`    | 管理后台 API（T1 信任边界）                     |
| `external/` | `open-api/external/` | 外部消费者 API，含 Public REST / MCP / A2A      |
| `system/`   | `open-api/system/`   | 系统级内部 API（健康检查、运维端点）            |
| `user/`     | `open-api/user/`     | 用户侧 API（API Key 认证，T1 重构后 MECE 分区） |

> **注**：上表为 T1 信任边界重构后的 MECE 分区（`admin / external / system / user`）。旧子目录（`a2a-api/`、`agents-api/`、`ai-core/`、`byok-admin/`、`mcp-admin/`、`mcp-server/`、`public-api/`、`skills-api/`、`teams-api/`、`webhooks/`）已合并入对应新分区，不再单独存在。

## 设计原则

- 统一对外接口层，隔离内部实现
- MCP Server 遵循 JSON-RPC 2.0 协议
- Public API 需要 API Key 认证（密钥管理在 `platform/credentials/`）
- 不承载业务逻辑，只做路由与认证；业务委托给 L3 ai-app
- 依赖方向：`open-api → ai-app → ai-harness → ai-engine → platform`，open-api 处于最外层
