# Frontend

> Next.js 14 + TypeScript + Zustand + TailwindCSS。代码根：`frontend/`

## 顶层结构

| 目录                   | 内容                                                           |
| ---------------------- | -------------------------------------------------------------- |
| `frontend/app/`        | App Router 页面（agent-playground / ai-research / ai-teams …） |
| `frontend/components/` | 业务组件                                                       |
| `frontend/hooks/`      | React hooks（domain hooks / core hooks）                       |
| `frontend/stores/`     | Zustand stores                                                 |
| `frontend/services/`   | API 客户端                                                     |
| `frontend/lib/`        | 工具方法、配置（含品牌 config）                                |
| `frontend/contexts/`   | React Context                                                  |
| `frontend/types/`      | 全局类型                                                       |
| `frontend/public/`     | 静态资源                                                       |

## 文档

- [`nextjs-react.md`](nextjs-react.md) — Next.js + React 使用规范
- [`state-management.md`](state-management.md) — Zustand 状态管理
- [`ui-components.md`](ui-components.md) — UI 组件设计

子目录 `app/` `components/` `hooks/` `stores/` 预留给页面/组件/hook/store 专属设计文档（按需补充）。

## 关键规范

- **禁止 emoji**：图标统一用 Lucide React
- **禁止硬编码品牌名**：用 `config.brand.*`（from `@/lib/utils/config`）
- **禁止 `console.log`**：用 `logger`
- **禁止 `any`**：所有变量必须有类型
- **函数式组件**：React 使用函数组件 + Hooks
