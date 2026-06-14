# 实施路线图

> AI Reports 优化的分阶段实施计划和任务清单

## 一、实施概览

### 1.1 总体规划

```
┌─────────────────────────────────────────────────────────────┐
│                    实施阶段概览                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Phase 1: 基础架构     Phase 2: 模板系统    Phase 3: 前端渲染 │
│  ================     ================    ================  │
│  • 数据结构升级        • 15种模板定义       • 组件库开发      │
│  • AI提示词优化        • 选择引擎实现       • 报告预览       │
│  • 服务层重构          • 参数调整逻辑       • 交互优化       │
│                                                             │
│  Phase 4: 导出升级     Phase 5: 质量保证                     │
│  ================     ================                       │
│  • PDF/PPT渲染        • 端到端测试                           │
│  • 样式系统集成        • 性能优化                            │
│  • 多格式支持          • 用户反馈迭代                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 优先级矩阵

| 优先级 | 阶段    | 核心内容            | 预估工作量 | 依赖    |
| ------ | ------- | ------------------- | ---------- | ------- |
| **P0** | Phase 1 | 数据结构 + AI提示词 | 5天        | 无      |
| **P1** | Phase 2 | 模板定义 + 选择引擎 | 9天        | Phase 1 |
| **P2** | Phase 3 | 前端组件 + 渲染     | 7天        | Phase 2 |
| **P2** | Phase 4 | 导出系统升级        | 5天        | Phase 3 |
| **P3** | Phase 5 | 测试 + 优化         | 4天        | Phase 4 |

---

## 二、Phase 1: 基础架构（P0）

### 2.1 目标

- 升级报告数据结构，支持金字塔式 7+2 模型
- 优化 AI 提示词，提升内容质量
- 重构报告生成服务架构

### 2.2 任务清单

#### 2.2.1 数据结构定义

| 任务 | 文件路径                                                           | 描述                       |
| ---- | ------------------------------------------------------------------ | -------------------------- |
| T1.1 | `backend/src/modules/ai/ai-office/types/report-v2.types.ts`        | 定义 ReportV2 完整类型系统 |
| T1.2 | `backend/src/modules/ai/ai-office/types/page-template.types.ts`    | 定义 15 种页面模板类型     |
| T1.3 | `backend/src/modules/ai/ai-office/types/content-features.types.ts` | 定义内容特征分析类型       |
| T1.4 | `backend/prisma/schema.prisma`                                     | 新增 ReportPage 表（可选） |

**T1.1 详细规格**:

```typescript
// report-v2.types.ts
export interface DeepResearchReportV2 {
  meta: ReportMeta;
  preface: PrefaceSection;
  chapters: ReportChapter[];
  conclusion: ConclusionSection;
  references: Reference[];
  metadata: ReportMetadata;
}
```

#### 2.2.2 AI 提示词升级

| 任务 | 文件路径                                                              | 描述                       |
| ---- | --------------------------------------------------------------------- | -------------------------- |
| T1.5 | `backend/src/modules/ai/ai-office/prompts/report-structure.prompt.ts` | 金字塔结构生成提示词       |
| T1.6 | `backend/src/modules/ai/ai-office/prompts/content-analyzer.prompt.ts` | 内容特征分析提示词         |
| T1.7 | `backend/src/modules/ai/ai-office/prompts/page-content.prompt.ts`     | 单页内容生成提示词         |
| T1.8 | 更新现有 `report-synthesizer` 提示词                                  | 整合 MECE 原则和多视角分析 |

**T1.5 提示词核心要点**:

- 金字塔结构：结论先行，分层递进
- MECE 原则：互不重叠，完全穷尽
- 问题驱动：明确报告要回答的核心问题
- 行动导向：每章有启示，最终有建议

#### 2.2.3 服务层重构

| 任务  | 文件路径                                                             | 描述               |
| ----- | -------------------------------------------------------------------- | ------------------ |
| T1.9  | `backend/src/modules/ai/ai-office/services/report-engine.service.ts` | 新建报告引擎主服务 |
| T1.10 | 更新 `deep-research-agent.service.ts`                                | 集成新报告引擎     |
| T1.11 | 更新 `report-synthesizer.service.ts`                                 | 适配新数据结构     |

### 2.3 验收标准

- [ ] 类型定义完整，TypeScript 编译无错误
- [ ] AI 能生成符合金字塔结构的报告大纲
- [ ] 单元测试覆盖核心类型和服务

---

## 三、Phase 2: 模板系统（P1）

### 3.1 目标

- 实现 15 种页面模板的完整定义
- 构建智能模板选择引擎
- 实现动态布局参数调整

### 3.2 任务清单

#### 3.2.1 模板定义

| 任务 | 模板                                     | 文件路径                |
| ---- | ---------------------------------------- | ----------------------- |
| T2.1 | cover, toc                               | `templates/structural/` |
| T2.2 | chapterTitle, chapterSummary, conclusion | `templates/structural/` |
| T2.3 | timeline, evolutionRoadmap               | `templates/content/`    |
| T2.4 | multiColumn, splitLayout                 | `templates/content/`    |
| T2.5 | dashboard, comparison                    | `templates/content/`    |
| T2.6 | caseStudy, maturityModel                 | `templates/content/`    |
| T2.7 | riskOpportunity, recommendations         | `templates/content/`    |

**每个模板包含**:

- 数据结构定义 (interface)
- 默认配置 (defaultConfig)
- 验证函数 (validate)
- 示例数据 (example)

#### 3.2.2 模板选择引擎

| 任务  | 文件路径                                | 描述             |
| ----- | --------------------------------------- | ---------------- |
| T2.8  | `services/content-analyzer.service.ts`  | 内容特征提取服务 |
| T2.9  | `services/template-selector.service.ts` | 模板选择主服务   |
| T2.10 | `services/template-selector.service.ts` | 决策规则实现     |
| T2.11 | `services/template-selector.service.ts` | 上下文感知选择   |
| T2.12 | `services/layout-adjuster.service.ts`   | 动态参数调整     |

**T2.9 核心接口**:

```typescript
interface TemplateSelectorService {
  analyzeContent(content: ContentBlock): ContentFeatures;
  selectTemplate(
    content: ContentBlock,
    context?: SelectionContext,
  ): TemplateSelection;
  adjustParams(template: PageTemplate, content: ContentBlock): LayoutParams;
}
```

#### 3.2.3 模板集成

| 任务  | 描述                             |
| ----- | -------------------------------- |
| T2.13 | 将模板选择引擎集成到报告生成流程 |
| T2.14 | 实现模板配置的 JSON 序列化       |
| T2.15 | 添加模板预览 API                 |

### 3.3 验收标准

- [ ] 15 种模板全部定义完成
- [ ] 模板选择引擎能正确识别内容特征
- [ ] 90% 以上的内容能匹配到合适模板
- [ ] 上下文感知避免连续重复模板

---

## 四、Phase 3: 前端渲染（P2）

### 4.1 目标

- 开发 15 种模板的 React 组件
- 实现报告预览和交互功能
- 支持实时编辑和调整

### 4.2 任务清单

#### 4.2.1 组件库开发

| 任务  | 组件             | 文件路径                                    |
| ----- | ---------------- | ------------------------------------------- |
| T3.1  | 基础组件         | `components/report/base/`                   |
| T3.2  | CoverPage        | `components/report/templates/CoverPage.tsx` |
| T3.3  | TocPage          | `components/report/templates/TocPage.tsx`   |
| T3.4  | ChapterTitlePage | `components/report/templates/`              |
| T3.5  | TimelinePage     | `components/report/templates/`              |
| T3.6  | MultiColumnPage  | `components/report/templates/`              |
| T3.7  | SplitLayoutPage  | `components/report/templates/`              |
| T3.8  | DashboardPage    | `components/report/templates/`              |
| T3.9  | ComparisonPage   | `components/report/templates/`              |
| T3.10 | 其他 6 种模板    | `components/report/templates/`              |

**T3.1 基础组件**:

- `ReportCard` - 通用卡片
- `KpiCard` - KPI 卡片
- `InsightBox` - 洞察框
- `Tag` - 标签
- `Timeline` - 时间线
- `ProgressBar` - 进度条
- `Chart` - 图表容器

#### 4.2.2 报告渲染器

| 任务  | 文件路径                               | 描述           |
| ----- | -------------------------------------- | -------------- |
| T3.11 | `components/report/ReportRenderer.tsx` | 报告主渲染组件 |
| T3.12 | `components/report/PageRenderer.tsx`   | 单页渲染器     |
| T3.13 | `components/report/ReportPreview.tsx`  | 预览模式组件   |
| T3.14 | `hooks/useReportRender.ts`             | 渲染状态管理   |

#### 4.2.3 交互功能

| 任务  | 描述                          |
| ----- | ----------------------------- |
| T3.15 | 页面导航（上/下页、目录跳转） |
| T3.16 | 全屏演示模式                  |
| T3.17 | 章节复制功能                  |
| T3.18 | 快捷键支持                    |

### 4.3 验收标准

- [ ] 15 种模板组件全部可渲染
- [ ] 报告预览流畅，无明显卡顿
- [ ] 支持键盘导航和全屏模式
- [ ] 组件样式与设计系统一致

---

## 五、Phase 4: 导出升级（P2）

### 5.1 目标

- 升级 PDF 导出，支持新模板
- 实现 PPT 导出功能
- 统一视觉样式

### 5.2 任务清单

#### 5.2.1 PDF 渲染器升级

| 任务 | 文件路径                              | 描述                   |
| ---- | ------------------------------------- | ---------------------- |
| T4.1 | `export/renderers/pdf-v2.renderer.ts` | 新版 PDF 渲染器        |
| T4.2 | 模板样式转换                          | 将 CSS 转换为 PDF 样式 |
| T4.3 | 图表转图片                            | 实现图表 SVG/PNG 导出  |
| T4.4 | 分页逻辑                              | 自动分页和页码         |

#### 5.2.2 PPT 渲染器

| 任务 | 文件路径                               | 描述                    |
| ---- | -------------------------------------- | ----------------------- |
| T4.5 | `export/renderers/pptx-v2.renderer.ts` | PPT 渲染器              |
| T4.6 | 模板到幻灯片映射                       | 每种模板对应的 PPT 布局 |
| T4.7 | 图表嵌入                               | 将图表嵌入 PPT          |
| T4.8 | 主题应用                               | 应用设计系统颜色和字体  |

#### 5.2.3 导出服务集成

| 任务  | 描述                           |
| ----- | ------------------------------ |
| T4.9  | 更新 ExportOrchestratorService |
| T4.10 | 新增 ReportV2 导出 API         |
| T4.11 | 导出进度反馈                   |

### 5.3 验收标准

- [ ] PDF 导出样式与预览一致
- [ ] PPT 导出可正常打开编辑
- [ ] 导出时间 < 30秒（标准报告）
- [ ] 文件大小优化合理

---

## 六、Phase 5: 质量保证（P3）

### 6.1 目标

- 端到端测试覆盖
- 性能优化
- 用户反馈收集和迭代

### 6.2 任务清单

#### 6.2.1 测试

| 任务 | 描述                   |
| ---- | ---------------------- |
| T5.1 | 单元测试：模板选择引擎 |
| T5.2 | 单元测试：内容特征分析 |
| T5.3 | 集成测试：报告生成流程 |
| T5.4 | E2E 测试：完整用户流程 |
| T5.5 | 视觉回归测试：模板渲染 |

#### 6.2.2 性能优化

| 任务 | 描述             |
| ---- | ---------------- |
| T5.6 | 报告生成性能分析 |
| T5.7 | 前端渲染性能优化 |
| T5.8 | 导出性能优化     |
| T5.9 | 缓存策略实现     |

#### 6.2.3 迭代优化

| 任务  | 描述               |
| ----- | ------------------ |
| T5.10 | 收集用户反馈       |
| T5.11 | 模板选择准确性调优 |
| T5.12 | AI 提示词迭代      |
| T5.13 | 文档完善           |

### 6.3 验收标准

- [ ] 测试覆盖率 > 80%
- [ ] 报告生成时间 < 60秒
- [ ] 无重大 Bug
- [ ] 用户满意度 > 4/5

---

## 七、风险与依赖

### 7.1 技术风险

| 风险                | 概率 | 影响 | 缓解措施                 |
| ------------------- | ---- | ---- | ------------------------ |
| AI 模板选择准确率低 | 中   | 高   | 增加人工规则兜底         |
| 导出样式不一致      | 中   | 中   | 使用 headless 浏览器渲染 |
| 性能不达标          | 低   | 高   | 分块生成、缓存优化       |
| PPT 兼容性问题      | 中   | 中   | 使用成熟库 (pptxgenjs)   |

### 7.2 依赖项

| 依赖                | 类型 | 说明           |
| ------------------- | ---- | -------------- |
| LiteLLM             | 现有 | AI 调用        |
| Chart.js / Recharts | 新增 | 图表渲染       |
| pptxgenjs           | 新增 | PPT 生成       |
| Puppeteer           | 可选 | PDF 高保真渲染 |

---

## 八、里程碑

| 里程碑 | 交付物                 | 目标日期 |
| ------ | ---------------------- | -------- |
| M1     | Phase 1 完成：基础架构 | +1周     |
| M2     | Phase 2 完成：模板系统 | +2.5周   |
| M3     | Phase 3 完成：前端渲染 | +4周     |
| M4     | Phase 4 完成：导出升级 | +5周     |
| M5     | Phase 5 完成：正式发布 | +6周     |

---

## 九、资源需求

### 9.1 人员配置

| 角色     | 人数 | 主要职责         |
| -------- | ---- | ---------------- |
| 后端开发 | 1    | 服务层、AI 集成  |
| 前端开发 | 1    | 组件、渲染、交互 |
| 全栈开发 | 1    | 导出、集成、测试 |

### 9.2 工具/服务

- AI 模型：GPT-4o / Claude 3.5
- 图表库：Chart.js 或 Recharts
- PDF 库：@react-pdf/renderer 或 Puppeteer
- PPT 库：pptxgenjs
- 测试：Jest、Vitest、Playwright

---

## 十、附录

### 10.1 文件结构规划

```
backend/src/modules/ai/ai-office/
├── types/
│   ├── report-v2.types.ts          # 报告类型
│   ├── page-template.types.ts       # 模板类型
│   └── content-features.types.ts    # 特征类型
├── services/
│   ├── report-engine.service.ts     # 报告引擎
│   ├── content-analyzer.service.ts  # 内容分析
│   ├── template-selector.service.ts # 模板选择
│   └── layout-adjuster.service.ts   # 布局调整
├── prompts/
│   ├── report-structure.prompt.ts   # 结构生成
│   ├── content-analyzer.prompt.ts   # 内容分析
│   └── page-content.prompt.ts       # 页面内容
└── templates/
    ├── structural/                  # 结构性模板
    └── content/                     # 内容型模板

frontend/components/report/
├── base/                            # 基础组件
├── templates/                       # 模板组件
├── ReportRenderer.tsx               # 主渲染器
├── ReportPreview.tsx                # 预览组件
└── styles/
    └── report-tokens.css            # 设计令牌
```

### 10.2 API 规划

```typescript
// 新增 API 端点
POST /api/v1/ai-office/projects/:id/reports/v2
  - 使用新报告引擎生成

GET /api/v1/ai-office/projects/:id/reports/:reportId/preview
  - 获取报告预览数据

POST /api/v1/ai-office/projects/:id/reports/:reportId/export
  - 导出报告 (format: pdf|pptx|docx)

POST /api/v1/ai-office/template-preview
  - 模板预览 API
```

---

## 十一、参考资料

- [设计概述](./design-overview.md)
- [页面模板规范](./page-template-specification.md)
- [模板选择引擎](./template-selection-engine.md)
- [视觉设计系统](./visual-design-system.md)

---

**文档版本**: v1.0
**创建日期**: 2024-12-28
