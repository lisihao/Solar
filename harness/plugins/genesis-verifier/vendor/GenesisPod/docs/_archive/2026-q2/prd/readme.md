# PRD 文档目录

> **最后更新**: 2026-02-05
> **文档规范**: 当前版本在 `current/`，历史版本在 `archive/`

---

## 目录结构

```
prd/
├── current/              # 所有当前有效 PRD
│   ├── ai-apps/          # AI 应用层
│   ├── ai-teams/         # AI Teams 协作系统
│   ├── ai-engine/        # AI Engine 核心
│   ├── ai-research/      # AI Research
│   ├── infra/            # 基础设施层
│   └── features/         # 通用功能
├── archive/              # 历史版本归档
└── readme.md             # 本文件
```

### 快速导航

- [当前 PRD](./current/)
- [归档文档](./archive/)

---

## 目录结构概览

### AI 应用层 (AI Apps)

| 模块           | 当前版本 | 文档位置                                                     | 开发状态 |
| -------------- | -------- | ------------------------------------------------------------ | -------- |
| **AI Studio**  | v4.0     | [current/ai-apps/ai-studio/](./current/ai-apps/ai-studio/)   | 开发中   |
| **AI Office**  | v2.0     | [current/ai-apps/ai-office/](./current/ai-apps/ai-office/)   | 已完成   |
| **AI Slides**  | v3.1     | [current/ai-apps/ai-slides/](./current/ai-apps/ai-slides/)   | 待开发   |
| **AI Coding**  | v1.0     | [current/ai-apps/ai-coding/](./current/ai-apps/ai-coding/)   | 开发中   |
| **AI Ask**     | v1.0     | [current/ai-apps/ai-ask/](./current/ai-apps/ai-ask/)         | 开发中   |
| **AI Writing** | v2.0     | [current/ai-apps/ai-writing/](./current/ai-apps/ai-writing/) | 待重构   |

### AI 协作系统 (AI Teams)

| 模块               | 当前版本 | 文档位置                                                               | 开发状态 |
| ------------------ | -------- | ---------------------------------------------------------------------- | -------- |
| **AI Teams 核心**  | v2.0     | [current/ai-teams/](./current/ai-teams/)                               | 开发中   |
| **Topic Research** | v1.0     | [current/ai-teams/topic-research/](./current/ai-teams/topic-research/) | 开发中   |

> **注意**: 原 "AI Group" 已统一更名为 "AI Teams"，与代码模块保持一致。

### 基础设施层 (Infra)

| 模块                | 当前版本 | 文档位置                                                           | 开发状态 |
| ------------------- | -------- | ------------------------------------------------------------------ | -------- |
| **Core 核心系统**   | v2.0     | [current/infra/core/](./current/infra/core/)                       | 规划中   |
| **Knowledge Base**  | v1.0     | [current/infra/knowledge-base/](./current/infra/knowledge-base/)   | 开发中   |
| **Library 资源库**  | v2.0     | [current/infra/library/](./current/infra/library/)                 | 已完成   |
| **Integrations**    | v2.0     | [current/infra/integrations/](./current/infra/integrations/)       | 开发中   |
| **Data Collection** | v3.0     | [current/infra/data-collection/](./current/infra/data-collection/) | 已修复   |

---

## 常用文档快速链接

### AI Apps

#### AI Studio (AI 研究工作台)

- [AI Studio PRD v4.0](./current/ai-apps/ai-studio/ai-studio-prd-v4.0.md) - 全新设计，对标 NotebookLM
- [实施计划 v3.1](./current/ai-apps/ai-studio/ai-studio-plan-v3.1.md)
- [任务跟踪 v3.1](./current/ai-apps/ai-studio/ai-studio-tasks-v3.1.md)

#### AI Office (智能报告生成)

- [AI Office PRD v2.0](./current/ai-apps/ai-office/ai-office-prd.md) - Multi-Agent 报告生成系统
- [UI/UX 重新设计 v5.0](./current/ai-apps/ai-office/ai-office-redesign.md)

#### AI Slides (智能幻灯片)

- [视觉升级方案 v3.1](./current/ai-apps/ai-slides/ai-slides-visual-upgrade.md)
- [竞品差距分析](./current/ai-apps/ai-slides/slides-gap-analysis.md)
- [质量问题清单](./current/ai-apps/ai-slides/slides-quality-issues-v1.md)

#### AI Coding (AI 编程助手)

- [多智能体协作编程平台 v1.0](./current/ai-apps/ai-coding/ai-coding-feature.md)
- [重构方案 PRD](./current/ai-apps/ai-coding/ai-coding-refactor-prd-v1.0.md)
- [可视化增强方案](./current/ai-apps/ai-coding/ai-coding-visualization-enhancement.md)

#### AI Ask (智能问答)

- [会话管理功能 v1.0](./current/ai-apps/ai-ask/ask-ai-session-management.md)

#### AI Writing (智能写作)

- [模块重新设计 PRD](./current/ai-apps/ai-writing/redesign.md)

### AI Teams (AI 团队协作)

#### 核心功能

- [AI Teams PRD v1.0](./current/ai-teams/ai-group-prd.md) - 核心产品需求 (原 AI Group)
- [AI 交互规范 v2.0](./current/ai-teams/ai-group-spec.md)
- [团队协作功能 v1.0](./current/ai-teams/ai-group-team-collaboration.md)
- [内容解析功能 v1.0](./current/ai-teams/ai-group-content-parsing.md)
- [优化方案 v1.1](./current/ai-teams/ai-group-optimization.md)

#### Topic Research (专题研究)

- [专题洞察完整 PRD v1.0](./current/ai-teams/topic-research/topic-research-prd.md)
- [UX 增强方案 v1.0](./current/ai-teams/topic-research/topic-research-ux-enhancement.md)
- [UI 优化](./current/ai-teams/topic-research/ui-optimization.md)
- [报告编辑功能](./current/ai-teams/topic-research/report-editing.md)
- [Leader 交互设计](./current/ai-teams/topic-research/leader-interaction.md)

### Infra (基础设施)

#### Core (核心系统)

- [GenesisPod 核心 PRD v2.0](./current/infra/core/genesis-ai-prd-v2.0.md)
- [积分系统 PRD v1.0](./current/infra/core/credits-system-prd.md) - AI 功能计费管控
- [管理后台存储增强](./current/infra/core/admin-storage-enhancement.md)
- [自动反馈处理系统 v1.0](./current/infra/core/auto-feedback-resolution.md)
- [YouTube 字幕导出功能 v1.0](./current/infra/core/youtube-subtitle-prd.md)
- [AI 战略模拟 PRD](./current/infra/core/ai-strategic-simulation-prd.md)

#### Knowledge Base (知识库系统)

- [知识库系统设计 v1.0](./current/infra/knowledge-base/library-knowledge-base-system.md)
- [知识库增强 PRD](./current/infra/knowledge-base/knowledge-base-enhancement-prd.md)
- [数据源管理 PRD](./current/infra/knowledge-base/knowledge-base-data-sources-prd.md)
- [UX 改进方案](./current/infra/knowledge-base/knowledge-ux-improvements.md)

#### Library (资源库)

- [资源库优化方案 v2.0](./current/infra/library/library-optimization-v2.md)

#### Integrations (第三方集成)

- [Google Drive RAG 知识库 v2.0](./current/infra/integrations/google-drive-rag-knowledge-base.md)
- [Notes 与 Notion 集成系统 v1.0](./current/infra/integrations/notes-notion-integration.md)
- [Google Drive 集成 v1.0](./current/infra/integrations/google-drive-integration.md)

#### Data Collection (数据采集)

- [数据采集系统 PRD v3.0](./current/infra/data-collection/data-collection-prd.md)
- [批量采集监控设计 v1.0](./current/infra/data-collection/data-collection-monitor-design.md)

---

## 命名规范

| 元素 | 说明         | 示例                                              |
| ---- | ------------ | ------------------------------------------------- |
| 模块 | 功能模块名称 | `ai-studio`, `ai-teams`, `data-collection`        |
| 类型 | 文档类型     | `prd`, `spec`, `plan`, `tasks`, `audit`, `design` |
| 版本 | 语义化版本号 | `v1.0`, `v2.0`, `v3.1`                            |

**规则**:

- 统一使用连字符 `-` 分隔
- 禁止使用下划线 `_`
- 版本号必须带 `v` 前缀
- 所有文件名小写 (kebab-case)

---

## 文档更新流程

1. **新建文档**: 在 `current/` 对应目录创建，版本从 `v1.0` 开始
2. **小更新**: 版本号小版本递增 (v1.0 → v1.1)
3. **大更新**:
   - 旧版本移至 `archive/` 并添加 `-archived` 后缀
   - 在 `current/` 创建新版本
   - 更新本索引文件
4. **文档废弃**: 移至 `archive/` 并在归档索引中说明原因

---

## 模块状态总览

| 模块            | PRD 版本 | 开发状态 | 文档完整度 | 优先级 |
| --------------- | -------- | -------- | ---------- | ------ |
| AI Studio       | v4.0     | 开发中   | 90%        | P0     |
| AI Office       | v2.0     | 已完成   | 95%        | P1     |
| AI Slides       | v3.1     | 待开发   | 95%        | P1     |
| AI Teams        | v2.0     | 开发中   | 90%        | P0     |
| Topic Research  | v1.0     | 开发中   | 95%        | P0     |
| AI Coding       | v1.0     | 开发中   | 95%        | P1     |
| AI Ask          | v1.0     | 开发中   | 80%        | P2     |
| AI Writing      | v2.0     | 待重构   | 60%        | P2     |
| Knowledge Base  | v1.0     | 开发中   | 85%        | P1     |
| Library         | v2.0     | 已完成   | 80%        | P1     |
| Integrations    | v2.0     | 开发中   | 90%        | P1     |
| Data Collection | v3.0     | 已修复   | 90%        | P1     |
| Core            | v2.0     | 规划中   | 95%        | P0     |

---

## 归档文档

历史版本文档存放于 `archive/` 目录，详见 [archive/readme.md](./archive/readme.md)

---

## 贡献指南

### 添加新 PRD

1. 在 `current/` 对应目录创建文档
2. 遵循命名规范: `[模块]-[类型]-v[版本].md`
3. 更新本索引文件
4. 提交 PR 并说明变更

### 更新现有 PRD

1. 小更新: 直接修改文件，更新版本号和日期
2. 大更新: 移动旧版本到 `archive/`，创建新版本
3. 更新索引文件

---

**维护者**: 文档专家 Agent
**最后审查**: 2026-02-05
