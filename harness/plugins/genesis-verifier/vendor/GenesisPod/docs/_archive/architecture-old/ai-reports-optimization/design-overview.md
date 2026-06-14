# AI Reports 优化设计概述

> 参考 Genspark 专业报告生成逻辑，全面升级 GenesisPod 的 AI Reports 功能

## 一、背景与目标

### 1.1 现状分析

当前 GenesisPod 的深度研究报告存在以下问题：

| 问题维度       | 具体表现          | 影响                   |
| -------------- | ----------------- | ---------------------- |
| **结构单一**   | 固定4章节线性结构 | 缺乏层次感，不够专业   |
| **布局简陋**   | 纯文本 Markdown   | 无法承载复杂信息       |
| **无模板系统** | 所有内容统一格式  | 无法适配不同内容类型   |
| **可视化缺失** | 纯文字描述数据    | 信息密度低，阅读体验差 |
| **行动导向弱** | 仅有简单结论      | 用户难以获得明确指导   |

### 1.2 优化目标

```
┌─────────────────────────────────────────────────────────────┐
│                    优化目标体系                              │
├─────────────────────────────────────────────────────────────┤
│  专业度 ⭐⭐ → ⭐⭐⭐⭐⭐    达到咨询公司报告水准              │
│  视觉性 ⭐⭐ → ⭐⭐⭐⭐⭐    图表为主，文字为辅               │
│  结构性 ⭐⭐⭐ → ⭐⭐⭐⭐⭐   金字塔结构，MECE原则             │
│  行动性 ⭐⭐ → ⭐⭐⭐⭐⭐    每章启示 + 最终建议清单           │
│  导出性 ⭐⭐⭐ → ⭐⭐⭐⭐⭐   专业PPT/PDF输出                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、对标分析：Genspark vs DeepDive

### 2.1 核心差异对比

| 维度         | Genspark 参考     | DeepDive 现状 | 改进方向         |
| ------------ | ----------------- | ------------- | ---------------- |
| **报告结构** | 金字塔式 7+2 模型 | 线性 4 章节   | 采用 7+2 模型    |
| **页面模板** | 15 种专业模板     | 无模板概念    | 引入完整模板体系 |
| **模板选择** | AI 智能决策       | 固定结构      | 建设选择引擎     |
| **数据展示** | KPI卡片+图表      | 纯文字        | 数据可视化组件   |
| **内容组织** | MECE + 多视角     | 单线程叙述    | 结构化内容框架   |
| **行动导向** | 每章启示+建议清单 | 仅结论段落    | 强化行动指引     |

### 2.2 Genspark 核心优势提炼

**1. 金字塔结构设计**

```
封面层 ─────────────────────────────────────────────
       │ 主副标题 / 作者 / 日期 / 标签

导航层 ─────────────────────────────────────────────
       │ 目录 / 报告概览说明

执行摘要层 ─────────────────────────────────────────
       │ 核心问题框架 / 三大判断 / 关键洞察

正文层（每章统一结构）─────────────────────────────
       │ 章节标题页 → 内容页(多种布局) → 章节小结页

收尾层 ─────────────────────────────────────────────
       │ 核心观点回顾 / 战略建议 / 行动路线图
```

**2. 11种页面布局类型**

| 类型            | 用途          | 特征                        |
| --------------- | ------------- | --------------------------- |
| 时间线页        | 展示演进历程  | 横向时间轴 + 阶段卡片       |
| 多栏并列页      | 对比分析      | 2-5栏平行结构               |
| 左右分栏页      | 深度分析      | 左侧概述/论点，右侧详细要点 |
| 数据仪表盘页    | 关键指标展示  | KPI卡片 + 图表组合          |
| 阶梯演进页      | 能力成熟度    | 分级展示（L0-L5）           |
| 案例对比页      | 竞品/方案对比 | 案例卡片 + 核心数据         |
| 风险/机遇对比页 | 双面分析      | 红绿正反对比布局            |
| 章节标题页      | 章节分隔      | 大号编号 + 标题 + 关键词    |
| 四象限页        | 分类分析      | 2x2矩阵结构                 |
| 流程/架构页     | 系统说明      | 步骤卡片 + 层级关系         |
| 小结建议页      | 总结行动      | 要点提炼 + 行动建议         |

**3. 内容组织逻辑（MECE原则）**

- **宏观层面**: 为什么重要 → 是什么 → 怎么做
- **微观层面**: 背景铺垫 → 现状描述 → 趋势分析 → 竞争格局 → 启示建议

**4. 专业性体现要素**

- 框架化思维（自创分析框架）
- 多视角分析（正反/角色/时间）
- 完整证据链（定量+案例+权威引用）
- 行动导向（具体建议+时间窗口）

---

## 三、整体架构设计

### 3.1 系统架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         DeepDive Report Engine V2                        │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │   Content    │  │   Structure  │  │   Template   │  │   Rendering  │ │
│  │   Analyzer   │──│   Planner    │──│   Selector   │──│   Engine     │ │
│  │   内容分析器  │  │   结构规划器  │  │   模板选择器  │  │   渲染引擎   │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘ │
│         │                │                 │                 │          │
│         ▼                ▼                 ▼                 ▼          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    Shared Knowledge Base                          │   │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐     │   │
│  │  │ Template   │ │ Layout     │ │ Chart      │ │ Style      │     │   │
│  │  │ Library    │ │ Patterns   │ │ Components │ │ System     │     │   │
│  │  │ 模板库     │ │ 布局模式    │ │ 图表组件    │ │ 样式系统    │     │   │
│  │  └────────────┘ └────────────┘ └────────────┘ └────────────┘     │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 核心模块职责

| 模块                  | 职责                             | 输入            | 输出            |
| --------------------- | -------------------------------- | --------------- | --------------- |
| **Content Analyzer**  | 分析内容特征，提取数据/结构/目的 | 原始研究内容    | ContentFeatures |
| **Structure Planner** | 规划报告大纲，确定章节和页面数量 | ContentFeatures | ReportBlueprint |
| **Template Selector** | 为每页选择最佳模板，调整布局参数 | 页面内容        | TemplateConfig  |
| **Rendering Engine**  | 渲染最终报告，支持多格式导出     | 完整报告配置    | HTML/PDF/PPTX   |

### 3.3 数据流设计

```
用户发起深度研究
       │
       ▼
┌──────────────────┐
│  搜索与收集阶段   │  现有流程保持不变
│  (保持现有流程)   │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  内容分析阶段     │  【新增】分析内容特征
│  ContentAnalyzer │  - 数据类型/密度
└────────┬─────────┘  - 结构类型
         │            - 内容目的
         ▼            - 视觉需求
┌──────────────────┐
│  结构规划阶段     │  【新增】生成报告蓝图
│  StructurePlanner│  - 章节规划
└────────┬─────────┘  - 页面分配
         │            - 布局设计
         ▼
┌──────────────────┐
│  模板选择阶段     │  【新增】智能模板匹配
│  TemplateSelector│  - 特征→模板映射
└────────┬─────────┘  - 参数动态调整
         │            - 上下文感知
         ▼
┌──────────────────┐
│  内容生成阶段     │  【升级】结构化内容生成
│  ContentGenerator│  - 金字塔结构
└────────┬─────────┘  - MECE原则
         │            - 数据可视化
         ▼
┌──────────────────┐
│  渲染输出阶段     │  【升级】专业级渲染
│  RenderingEngine │  - 组件化渲染
└──────────────────┘  - 多格式导出
```

---

## 四、报告结构设计（7+2 模型）

### 4.1 标准报告骨架

```typescript
interface ReportStructure {
  meta: ReportMeta; // 报告元信息
  sections: [
    PrefaceSection, // 00 前言与执行摘要 (10-15%)
    ...ChapterSection[], // 01-0N 正文章节 (70-80%)
    ConclusionSection, // 0N+1 结束语与建议 (10-15%)
  ];
}
```

### 4.2 各层详细结构

#### 封面层 (Cover)

```json
{
  "template": "cover",
  "elements": {
    "organizationBar": "顶部机构标识",
    "titleBlock": {
      "mainTitle": "报告主标题",
      "subtitle": "副标题定位语",
      "accentLine": "金色横线装饰"
    },
    "metaInfo": {
      "author": "报告作者",
      "date": "信息截止日期",
      "tags": ["标签1", "标签2", "标签3", "标签4"]
    },
    "footer": "页码 + 品牌标识"
  }
}
```

#### 导航层 (TOC)

```json
{
  "template": "toc",
  "layout": "twoColumn",
  "elements": {
    "title": "目录",
    "chapters": [
      {
        "number": "00",
        "name": "前言与执行摘要",
        "subtitle": "研究背景与核心发现"
      },
      {
        "number": "01",
        "name": "章节名称",
        "subtitle": "章节副标题说明"
      }
    ],
    "overviewBox": "报告概览说明（可选）"
  }
}
```

#### 执行摘要层 (Executive Summary)

```json
{
  "template": "executiveSummary",
  "elements": {
    "keyQuestions": [
      "问题1: 报告要回答的核心议题？",
      "问题2: ...",
      "问题3: ..."
    ],
    "coreJudgments": [
      {
        "label": "判断1",
        "title": "核心判断标题",
        "content": "判断内容说明",
        "confidence": "high"
      }
    ],
    "keyInsights": ["洞察1", "洞察2", "洞察3"],
    "recommendations": ["建议1", "建议2", "建议3"]
  }
}
```

#### 正文章节 (Chapter)

```json
{
  "id": "01",
  "type": "chapter",
  "title": "章节标题",
  "subtitle": "章节副标题",
  "keywords": ["关键词1", "关键词2"],
  "pages": [
    { "template": "chapterTitle", "..." },    // 章节标题页
    { "template": "timeline", "..." },         // 内容页 - 根据内容选择模板
    { "template": "dashboard", "..." },        // 内容页
    { "template": "comparison", "..." },       // 内容页
    { "template": "chapterSummary", "..." }   // 章节小结页
  ]
}
```

#### 收尾层 (Conclusion)

```json
{
  "template": "conclusion",
  "elements": {
    "title": "结束语",
    "subtitle": "核心观点回顾与战略启示",
    "corePoints": [
      {
        "label": "观点1",
        "title": "核心观点标题",
        "mechanism": "核心机制说明",
        "evidence": "关键验证",
        "implication": "战略含义"
      }
    ],
    "recommendations": [
      {
        "number": "01",
        "icon": "图标",
        "title": "建议标题",
        "description": "建议详细说明",
        "priority": "high"
      }
    ],
    "timelineFooter": {
      "year": "2026",
      "label": "黄金窗口期",
      "milestones": ["里程碑1", "里程碑2", "里程碑3"]
    },
    "callToAction": {
      "icon": "rocket",
      "text": "行动起来，把握机遇"
    }
  }
}
```

### 4.3 章节数量规则

| 报告类型     | 章节数量 | 页面范围 | 适用场景           |
| ------------ | -------- | -------- | ------------------ |
| **快速报告** | 3-4 章   | 10-15 页 | 简单问题、快速概览 |
| **标准报告** | 5-6 章   | 20-35 页 | 常规研究、综合分析 |
| **深度报告** | 7-9 章   | 40-60 页 | 复杂主题、战略决策 |

### 4.4 页面分配逻辑

```
总页数 = N

开篇 (10-15%): 1 封面 + 1 目录 + 1-2 前言 + 1-2 执行摘要 = 4-6 页
正文 (70-80%): 每章 4-8 页 × 章节数
收尾 (10-15%): 1 结束语 + 1-2 建议页 + 0-1 附录 = 2-4 页
```

---

## 五、类型系统设计

### 5.1 报告元数据类型

```typescript
// 报告元数据
interface ReportMeta {
  id: string;
  title: string;
  subtitle: string;
  author: {
    name: string;
    organization: string;
  };
  date: {
    created: string; // ISO 日期
    updated: string;
    dataAsOf: string; // 数据截止日期
  };
  tags: string[]; // 4-5 个关键词
  version: string;
  language: "zh-CN" | "en-US";
  pageCount: number;
}
```

### 5.2 页面模板类型

```typescript
// 页面模板枚举
type PageTemplate =
  // 结构性页面
  | "cover" // 封面页
  | "toc" // 目录页
  | "chapterTitle" // 章节标题页
  | "chapterSummary" // 章节小结页
  | "conclusion" // 结束语页
  // 内容型页面
  | "timeline" // 时间线页
  | "multiColumn" // 多栏并列页
  | "splitLayout" // 左右分栏页
  | "dashboard" // 数据仪表盘页
  | "evolutionRoadmap" // 演进路线图页
  | "comparison" // 对比分析页
  | "caseStudy" // 案例展示页
  | "maturityModel" // 成熟度模型页
  | "riskOpportunity" // 风险/机遇对比页
  | "recommendations"; // 建议行动页
```

### 5.3 内容特征类型

```typescript
// 内容特征（用于智能模板选择）
interface ContentFeatures {
  // 数据特征
  dataType: "quantitative" | "qualitative" | "mixed" | "none";
  dataDensity: "high" | "medium" | "low";
  hasTimeSeries: boolean;
  hasComparison: boolean;
  comparisonDimensions: number;

  // 结构特征
  structureType:
    | "hierarchical"
    | "parallel"
    | "sequential"
    | "contrasting"
    | "narrative";
  elementCount: number;
  hasProcessFlow: boolean;
  hasLevelsOrStages: boolean;

  // 内容性质
  contentPurpose:
    | "introduce"
    | "analyze"
    | "compare"
    | "conclude"
    | "recommend"
    | "warn"
    | "showcase";
  argumentType: "thesis" | "evidence" | "synthesis" | "action";
  emotionalTone: "neutral" | "positive" | "cautionary" | "urgent";

  // 视觉需求
  needsVisualization: boolean;
  visualizationType:
    | "chart"
    | "diagram"
    | "iconGrid"
    | "timeline"
    | "matrix"
    | "none";
  spacePriority: "text" | "visual" | "balanced";
}
```

### 5.4 页面配置类型

```typescript
// 通用页面配置
interface PageConfig {
  id: string;
  pageNumber: number;
  template: PageTemplate;
  title: string;
  subtitle?: string;
  label?: string; // 如 "STRATEGIC BLUEPRINT"
  elements: PageElements; // 根据模板类型变化
  footer: {
    pageIndicator: string; // "第6页"
    brand: string;
  };
}

// 图表配置
interface ChartConfig {
  type: "bar" | "line" | "pie" | "donut" | "gauge" | "progress";
  title: string;
  data: ChartData;
  options: ChartOptions;
}

// KPI 卡片配置
interface KpiCard {
  label: string;
  value: string;
  unit?: string;
  trend?: "+" | "-" | "=";
  trendValue?: string;
  description?: string;
  highlightColor?: string;
}
```

### 5.5 完整报告类型

```typescript
// 深度研究报告 V2
interface DeepResearchReportV2 {
  meta: ReportMeta;

  preface: {
    keyQuestions: string[];
    executiveSummary: {
      coreJudgments: CoreJudgment[];
      keyInsights: string[];
      recommendations: string[];
    };
  };

  chapters: ReportChapter[];

  conclusion: {
    corePointsReview: CorePoint[];
    strategicRecommendations: Recommendation[];
    actionTimeline?: ActionTimeline;
  };

  references: Reference[];

  metadata: {
    totalSources: number;
    totalTokens: number;
    duration: number;
    searchRounds: number;
    generatedAt: string;
  };
}

// 章节结构
interface ReportChapter {
  id: string;
  number: string; // "01", "02"
  title: string;
  subtitle: string;
  keywords: string[];
  pages: PageConfig[];
  summary?: ChapterSummary;
}
```

---

## 六、与现有系统的集成

### 6.1 保持兼容的模块

| 模块                       | 说明                               |
| -------------------------- | ---------------------------------- |
| `DeepResearchAgentService` | 保持现有搜索和反思流程             |
| `IterativeSearchService`   | 搜索逻辑不变                       |
| `SelfReflectionService`    | 反思决策不变                       |
| SSE 事件流                 | 保持现有事件类型，新增报告结构事件 |

### 6.2 需要升级的模块

| 模块                       | 改动                                   |
| -------------------------- | -------------------------------------- |
| `ReportSynthesizerService` | 重构为 ReportEngineService，支持新结构 |
| `ResearchPlannerService`   | 增加结构规划能力                       |
| 前端 `ResearchTab`         | 升级报告渲染组件                       |
| 导出服务                   | 支持新的报告格式导出                   |

### 6.3 新增模块

| 模块                      | 职责                      |
| ------------------------- | ------------------------- |
| `ContentAnalyzerService`  | 内容特征分析              |
| `TemplateSelectorService` | 智能模板选择              |
| `PageRendererService`     | 页面级别渲染              |
| 前端模板组件库            | 15种页面模板的 React 组件 |

---

## 七、预期效果

### 7.1 报告质量提升

| 指标       | 当前 | 目标 | 提升     |
| ---------- | ---- | ---- | -------- |
| 专业度评分 | 60   | 95   | +58%     |
| 信息密度   | 中   | 高   | +100%    |
| 可视化比例 | 0%   | 40%  | 从0到有  |
| 行动导向性 | 弱   | 强   | 质的飞跃 |

### 7.2 用户价值提升

- **决策支持**: 核心判断+建议清单，直接指导行动
- **信息效率**: 金字塔结构，5分钟把握核心
- **专业呈现**: 可直接用于汇报、分享
- **多格式导出**: 满足不同场景需求

---

## 八、相关文档

- [页面模板规范](./page-template-specification.md) - 15种模板详细定义
- [模板选择引擎](./template-selection-engine.md) - 智能选择算法
- [视觉设计系统](./visual-design-system.md) - 设计令牌和组件
- [实施路线图](./implementation-roadmap.md) - 分阶段计划

---

**文档版本**: v1.0
**创建日期**: 2024-12-28
**作者**: GenesisPod Team
