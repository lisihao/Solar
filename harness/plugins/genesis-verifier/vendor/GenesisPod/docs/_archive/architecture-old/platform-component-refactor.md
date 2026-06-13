# DeepDive Platform Architecture & Component Refactor Blueprint

## 1. Overview

DeepDive 已逐渐演化为多业务形态（视频深度理解、AI 创作、知识库等），但底层公共能力（内容采集、AI 编排、知识管理、UI 组件）散落各处并存在重复实现。为了支撑未来的平台化、公共组件化以及更多业务线扩展，需要从整体架构、前后端组件、AI 服务等层面系统梳理与重构。

本方案分为三层：

```
┌──────────────────────────────────────────────────────┐
│ Presentation (Front-end Apps & Design System)        │
├──────────────────────────────────────────────────────┤
│ Experience Services (Domain & Platform Services)     │
├──────────────────────────────────────────────────────┤
│ Data & Integration (AI Orchestration, Content, Infra)│
└──────────────────────────────────────────────────────┘
```

目标：建立“平台组件 + 业务组件”双层架构，沉淀共性能力，支撑业务快速组合。

---

## 2. Presentation Layer（前端）

### 2.1 平台 UI 组件（Platform UI Kit）

适合作为 `@/components/platform/*` 抽象：

| 组件模块                | 功能点                                                                         |
| ----------------------- | ------------------------------------------------------------------------------ |
| Layout Shells           | 3 列/2 列响应式布局、弹性栅格、卡片墙；支持深色主题 token。                    |
| Gallery / Library Rails | 横纵缩略图库、滚轮切换、收藏状态标识、空态占位。                               |
| Insights Cards          | 设计日志、信息架构、数据洞察等结构化渲染卡片；支持插槽扩展。                   |
| Timeline / Status Trail | 处理步骤、状态变迁、进度条，含图标、时间、描述模板。                           |
| Prompt Input Suite      | 文本域、Mentions、SourcePool、模式切换（Prompt/URL/YouTube/Files）、错误提示。 |
| Model Controls          | 模型选择、参数调整（纵横比、温度、限制等）、刷新按钮。                         |
| AI Status Indicators    | Loading、流式输出、错误弹层、结果提示统一样式。                                |
| Modal & Context Menus   | Lightbox、右键菜单、确认框、全局 toast。                                       |
| Chart & Layout Tokens   | 统一配色、字体、阴影、圆角、图表样式约定。                                     |

### 2.2 业务 UI 组件（Business Assemblies）

建立在平台组件之上，位于 `@/modules/*`：

- **Image Generator Workspace**：使用 Gallery + Canvas + Insights + Prompt Suite 组合。
- **YouTube DeepDive**：视频播放器、AI 对话、笔记列表、章节导航。
- **Knowledge Library**：资料卡片、过滤器、笔记编辑器。
- **Consulting Report Builder**：信息架构套件、图表模板、导出预览。

---

## 3. Experience Services（后端/中间层）

### 3.1 平台服务（应抽象为公共模块）

| 服务模块                  | 职责                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------- |
| Content Ingestion Service | URL/文件/视频/字幕采集，清洗、格式化、缓存，支持 fallback（如 YouTube timedtext）。 |
| Knowledge Service         | 笔记、标签、引用、知识图谱、资源索引统一 API。                                      |
| AI Orchestration Service  | 模型目录、默认优选、调用路由、速率限流、调用日志。                                  |
| Prompt Insight Service    | 提示词增强、结构化输出（design journal/layout plan/quality checks），可复用。       |
| Generation Task Service   | 生成任务状态、结果、书签、历史记录统一管理。                                        |
| Audit & Observability     | 请求日志、模型调用追踪、错误分类、指标上报。                                        |
| Workflow Engine (可选)    | 串联多阶段流程（例如：内容提取 -> Prompt 生成 -> 产出渲染）。                       |

### 3.2 业务服务（保留业务特有逻辑）

- **Video Intelligence Service**：视频抓取、章节摘要、问答上下文对齐。
- **Image Creation Service**：素材整合、风格模板、Refine 流程。
- **Report Assembly Service**：咨询式信息图、指标体系、场景化 Prompt。
- **Creative Content Service**：新闻/营销内容重写、社媒模板。

---

## 4. AI Platform Layer

| 模块                     | 功能点                                                             |
| ------------------------ | ------------------------------------------------------------------ |
| Model Registry           | 维护模型元信息（类型、能力、限额、供应商），暴露统一查询接口。     |
| Prompt Template Store    | 系统 Prompt、业务 Prompt 模板管理，支持版本化。                    |
| Structured Output Parser | 对 AI 返回 JSON/Markdown 做 Schema 校验、格式纠错、fallback 处理。 |
| Prompt Insight Tracer    | 保存 AI 思考过程、布局计划、质量校验，供 UI 展示和调试。           |
| Invocation Router        | 根据模型类型、权重、可用性调度具体供应商/API key。                 |
| Metrics / Alerting       | 模型成功率、耗时、结构化解析失败率、fallback 统计。                |

---

## 5. 平台 vs 业务组件对照（应重构的重点）

### 前端

- **公共化**：Layout、Gallery、Insights、Prompt Suite、Timeline、Lightbox、主题 tokens。
- **业务化**：Image Workspace 组合、YouTube 互动、Report Builder 逻辑。

### 后端

- **公共化**：内容采集/清洗、知识库、AI 编排、Prompt Insight、生成任务、审计。
- **业务化**：领域特定工作流（视频问答、咨询模板、AI 助手策略）。

### AI

- **公共化**：模型目录、提示模板、结构化解析、调用路由。
- **业务化**：场景化 Prompt、业务指标、定制报告结构。

---

## 6. 现状痛点 & 优先级

| 痛点                             | 影响                        | 优先级 | 对策                                                     |
| -------------------------------- | --------------------------- | ------ | -------------------------------------------------------- |
| 前端组件耦合、重复实现           | 难以维护、复用              | 高     | 抽离平台 UI 组件库，逐页替换落地。                       |
| AI 调用逻辑分散                  | 国际模型配置、fallback 混乱 | 高     | 建立 AI Orchestration Service + Prompt Insight Service。 |
| 内容采集/解析逻辑散              | 各业务自建 fallback         | 中     | 统一 Content Ingestion Service，封装重试/缓存策略。      |
| Prompt Insight 只在 Image 中使用 | 其他场景无法复用            | 高     | 平台化 Prompt Insight 服务 + 前端渲染组件。              |
| 生成历史 / 收藏 API 分散         | 难以跨业务查询              | 中     | Generation Task Service 统一持久化与 API。               |
| 日志 & 监控零散                  | 定位问题困难                | 中     | 打通审计日志、模型日志、错误分类，输出指标面板。         |
| Mojibake 字符/国际化处理         | 用户体验受损                | 低     | 统一编码处理，规范 API/文案输出。                        |

---

## 7. 重构路线图

### 阶段 0：准备

- 形成平台团队（架构、前端、后端、AI 负责人）。
- 明确接口规范（TypeScript & Swagger），建立项目 ADR 文档目录。

### 阶段 1：平台基础能力

1. **前端**：抽象 Layout、Gallery、Insights 等组件，编写 Storybook / 文档。
2. **AI Orchestration**：重构模型列表接口、统一 Prompt 调用、structured parser。
3. **Content Ingestion**：封装 YouTube transcript 逻辑及其他数据源采集。
4. **Knowledge Service**：整理笔记、标签、图谱 API，删除冗余实现。

### 阶段 2：业务模块迁移

1. **Image Generator**：基于平台组件重构页面，接入 Prompt Insights 服务。
2. **YouTube DeepDive**：使用共享笔记组件、内容提取服务。
3. **Knowledge Library**：统一使用平台 UI 组件及知识服务。
4. **AI 助手**：整合 Prompt Suite、Timeline、模型管理器。

### 阶段 3：扩展与治理

- 推出 Developer Handbook（组件使用、服务调用样例）。
- 建立指标与报警，监控失败率、fallback 次数。
- 定期 Review 平台组件使用率，淘汰过时模块。
- 规划 API gateway / BFF，以 API 契约驱动兼容移动端或第三方应用。

---

## 8. 文档与治理

- **docs/architecture/**：存放平台/业务架构、ADR、组件图谱。
- **docs/components/**：公共组件 API 和样式规范。
- **docs/services/**：服务接口、响应示例、错误码表。
- **CHANGELOG**：记录平台组件更新，提醒业务线升级。
- **Coding Guidelines**：统一命名、文件结构、编码格式、Mojibake 处理要求。

---

## 9. 行动建议

1. 认可本架构蓝图，任命平台团队和负责人。
2. 以 Image Generator 为试点，将公共组件抽象与业务重构同步推进。
3. 建立平台服务与组件仓库（monorepo 或 packages），支持版本化。
4. 加强监控与测试：组件 Storybook、自测脚本、后端契约测试、AI 调用回归。
5. 利用平台能力快速复用到新业务场景（如报告生成、运营工具），验证平台价值。

这份文档旨在提供全局视角，帮助团队按“平台标准化 + 业务装配”方向推进重构，实现长期可扩展的 DeepDive 平台。
