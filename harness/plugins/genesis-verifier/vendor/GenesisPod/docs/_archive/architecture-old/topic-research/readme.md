# Topic Research Design Documents

专题研究 (Topic Research) 模块设计文档索引

---

## 目录结构

```
docs/design/topic-research/
├── README.md                    # 本文件 - 设计文档索引
├── technical-design.md          # 技术架构设计
├── api-design.md                # API 接口设计
├── frontend-design.md           # 前端页面与组件设计
├── prompt-templates.md          # AI Prompt 模板设计
└── specs/                       # 规范文件 (可直接复制到代码中)
    ├── dto-design.ts            # DTO 数据结构定义
    ├── prisma-schema.prisma     # 数据库模型定义
    └── ai-team-config.ts        # AI 团队配置定义
```

**说明**：

- `.md` 文件是设计文档，描述设计决策和架构
- `specs/` 目录包含可直接用于实现的规范文件

---

## 文档列表

| 文档                                                       | 状态     | 描述                          |
| ---------------------------------------------------------- | -------- | ----------------------------- |
| [PRD](../../prd/topic-research/topic-research-prd-v1.0.md) | Complete | 产品需求文档                  |
| [Technical Design](./technical-design.md)                  | Complete | 技术架构、服务设计、刷新机制  |
| [API Design](./api-design.md)                              | Complete | REST API 接口规范             |
| [Frontend Design](./frontend-design.md)                    | Complete | 页面、组件、Store、API 层设计 |
| [Prompt Templates](./prompt-templates.md)                  | Complete | AI Prompt 模板设计            |

### 规范文件

| 文件                                                       | 描述         | 使用方式                                |
| ---------------------------------------------------------- | ------------ | --------------------------------------- |
| [specs/dto-design.ts](./specs/dto-design.ts)               | DTO 类型定义 | 复制到 `backend/src/modules/.../dto/`   |
| [specs/prisma-schema.prisma](./specs/prisma-schema.prisma) | 数据库模型   | 合并到 `backend/prisma/schema.prisma`   |
| [specs/ai-team-config.ts](./specs/ai-team-config.ts)       | AI 团队配置  | 复制到 `backend/src/modules/.../types/` |

---

## 设计完成状态

### 已完成

- [x] PRD 产品需求文档
- [x] 技术架构设计 (后端服务 + 刷新机制 + AI 集成)
- [x] API 接口设计 (REST API + SSE 流式)
- [x] 前端设计 (路由 + 组件 + Store + API)
- [x] DTO 数据结构定义 (Request/Response/SSE Events)
- [x] 数据库模型设计 (Prisma Schema)
- [x] AI 团队配置 (角色 + 工作流 + 维度模板)
- [x] Prompt 模板设计 (研究员 + 分析师 + 综合报告)

### 待实现

- [ ] 数据库迁移 (prisma migrate)
- [ ] 后端 Controller/Service 实现
- [ ] 前端页面实现
- [ ] 集成测试

---

## 核心概念

### 研究专题类型

| 类型       | 中文名   | 默认维度数 | 典型示例         |
| ---------- | -------- | ---------- | ---------------- |
| MACRO      | 宏观洞察 | 8          | 美国 AI 宏观洞察 |
| TECHNOLOGY | 技术专项 | 8          | 空芯光纤技术洞察 |
| COMPANY    | 企业洞察 | 8          | OpenAI 企业洞察  |

### 刷新机制

| 类型     | 触发方式  | 描述               |
| -------- | --------- | ------------------ |
| 全量刷新 | 手动/首次 | 重新研究所有维度   |
| 增量刷新 | 定时/手动 | 仅更新有变化的维度 |
| 维度刷新 | 手动      | 刷新单个维度       |

### 数据来源

- Web 搜索 (Tavily/Serper)
- 学术搜索 (ArXiv, Semantic Scholar)
- GitHub 仓库
- HackerNews
- RSS 订阅
- 本地资源库

---

## 快速导航

### 产品需求

- [PRD Overview](../../prd/topic-research/topic-research-prd-v1.0.md#1-overview)
- [User Stories](../../prd/topic-research/topic-research-prd-v1.0.md#4-user-stories)
- [Data Model](../../prd/topic-research/topic-research-prd-v1.0.md#7-data-model-design)

### 技术设计

- [系统架构图](./technical-design.md#11-system-architecture-diagram)
- [后端模块设计](./technical-design.md#2-backend-module-design)
- [数据源路由](./technical-design.md#3-data-source-routing-design)
- [AI 团队集成](./technical-design.md#4-ai-team-integration-design)
- [刷新机制](./technical-design.md#5-refresh-mechanism-design)

### API 设计

- [Topic CRUD](./api-design.md#1-topic-crud)
- [Refresh Operations](./api-design.md#2-refresh-operations)
- [Reports](./api-design.md#3-reports)
- [Evidence](./api-design.md#4-evidence-证据来源)

### 前端设计

- [路由结构](./frontend-design.md#路由结构)
- [核心组件](./frontend-design.md#核心组件)
- [Zustand Store](./frontend-design.md#zustand-store-设计)

### Prompt 模板

- [Research Lead Prompt](./prompt-templates.md#1-research-lead-prompt)
- [Researcher Prompt](./prompt-templates.md#2-researcher-prompt)
- [Report Synthesis Prompt](./prompt-templates.md#3-report-synthesis-prompt)

---

## 实现计划

### Phase 1: 基础架构

1. 合并 Prisma Schema，运行数据库迁移
2. 创建 NestJS Module 结构
3. 实现基础 CRUD API

### Phase 2: 核心功能

4. 实现 TopicTeamOrchestrator
5. 实现 DataSourceRouterService
6. 实现 SSE 流式进度

### Phase 3: 前端

7. 实现专题列表页
8. 实现创建向导
9. 实现详情页 (维度 + 报告 + 证据)

### Phase 4: 高级功能

10. 定时刷新调度
11. 报告导出 (PDF/DOCX)
12. 版本对比

---

## 技术栈

| 层级      | 技术                                        |
| --------- | ------------------------------------------- |
| Frontend  | Next.js 14, Zustand, TailwindCSS, shadcn/ui |
| Backend   | NestJS 10, Prisma, PostgreSQL, MongoDB      |
| AI        | LiteLLM, AI Engine Teams                    |
| Real-time | SSE, WebSocket                              |

---

**Last Updated**: 2026-01-11
**Design Status**: Complete - Ready for Implementation
