# 页面模板规范

> 15种专业页面模板的详细定义和使用指南

## 一、模板体系概览

### 1.1 模板分类

```
┌─────────────────────────────────────────────────────────────┐
│                    页面模板体系 (15种)                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  结构性页面 (5种)                                            │
│  ├── cover          封面页                                  │
│  ├── toc            目录页                                  │
│  ├── chapterTitle   章节标题页                              │
│  ├── chapterSummary 章节小结页                              │
│  └── conclusion     结束语页                                │
│                                                             │
│  内容型页面 (10种)                                           │
│  ├── timeline           时间线页                            │
│  ├── multiColumn        多栏并列页                          │
│  ├── splitLayout        左右分栏页                          │
│  ├── dashboard          数据仪表盘页                        │
│  ├── evolutionRoadmap   演进路线图页                        │
│  ├── comparison         对比分析页                          │
│  ├── caseStudy          案例展示页                          │
│  ├── maturityModel      成熟度模型页                        │
│  ├── riskOpportunity    风险/机遇对比页                     │
│  └── recommendations    建议行动页                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 模板用途速查表

| 模板               | 主要用途   | 典型场景             |
| ------------------ | ---------- | -------------------- |
| `cover`            | 报告封面   | 每份报告首页         |
| `toc`              | 目录导航   | 封面后               |
| `chapterTitle`     | 章节分隔   | 每章开始             |
| `chapterSummary`   | 章节总结   | 每章结束             |
| `conclusion`       | 全文总结   | 报告结尾             |
| `timeline`         | 时间演进   | 历史发展、阶段划分   |
| `multiColumn`      | 并列对比   | 框架展示、多要素对比 |
| `splitLayout`      | 深度分析   | 概述+详情、论点+证据 |
| `dashboard`        | 数据展示   | KPI、指标分析        |
| `evolutionRoadmap` | 能力演进   | 技术路线、能力成长   |
| `comparison`       | 详细对比   | 产品对比、方案对比   |
| `caseStudy`        | 案例分析   | 典型案例、最佳实践   |
| `maturityModel`    | 成熟度分级 | 能力模型、等级划分   |
| `riskOpportunity`  | 双面分析   | 风险机遇、正反论证   |
| `recommendations`  | 行动建议   | 战略建议、行动清单   |

---

## 二、结构性页面模板

### 2.1 封面页 (Cover)

**用途**: 报告首页，展示报告核心信息

**视觉布局**:

```
┌─────────────────────────────────────────────┐
│  [机构标识栏]                               │
│                                             │
│                                             │
│     ════════════════════════════           │
│           主标题 (36px Bold)                │
│     ────────────────────────────           │
│           副标题定位语 (14px)                │
│     ════════════════════════════           │
│                                             │
│                                             │
│  [作者]     [日期]                          │
│                                             │
│  [标签1] [标签2] [标签3] [标签4]            │
│                                             │
│                                    [页码]   │
└─────────────────────────────────────────────┘
```

**数据结构**:

```typescript
interface CoverPageConfig {
  template: "cover";
  elements: {
    organizationBar: {
      logo?: string;
      name: string;
    };
    titleBlock: {
      mainTitle: string; // 主标题，不超过20字
      subtitle: string; // 副标题/定位语
      accentLine: boolean; // 是否显示金色装饰线
    };
    metaInfo: {
      author: string;
      organization?: string;
      date: string; // 信息截止日期
      tags: string[]; // 4-5个关键词
    };
    footer: {
      pageNumber: string;
      brand: string;
    };
  };
}
```

**示例配置**:

```json
{
  "template": "cover",
  "elements": {
    "organizationBar": {
      "name": "GenesisPod"
    },
    "titleBlock": {
      "mainTitle": "美国AI系统深度分析报告",
      "subtitle": "政策、产业与技术的三位一体演进",
      "accentLine": true
    },
    "metaInfo": {
      "author": "DeepDive Research",
      "date": "2024年12月",
      "tags": ["AI政策", "产业生态", "技术趋势", "战略分析"]
    }
  }
}
```

---

### 2.2 目录页 (TOC)

**用途**: 展示报告结构，便于导航

**视觉布局**:

```
┌─────────────────────────────────────────────┐
│  目录                                       │
│  TABLE OF CONTENTS                          │
│                                             │
│  ┌──────────────────┐ ┌──────────────────┐ │
│  │ 00 前言与执行摘要 │ │ 04 应用层生态    │ │
│  │    研究背景与核心 │ │    企业级AI与主权 │ │
│  │    发现          │ │    AI发展        │ │
│  ├──────────────────┤ ├──────────────────┤ │
│  │ 01 宏观政策演进  │ │ 05 投资与风险    │ │
│  │    从市场引导到  │ │    泡沫与理性繁荣 │ │
│  │    举国体制      │ │    的博弈        │ │
│  ├──────────────────┤ ├──────────────────┤ │
│  │ 02 算力基础设施  │ │ 06 中国应对策略  │ │
│  │    芯片格局与数据 │ │    机遇与挑战    │ │
│  │    中心竞赛      │ │                  │ │
│  ├──────────────────┤ ├──────────────────┤ │
│  │ 03 模型层演进    │ │ 07 结束语与建议  │ │
│  │    从大模型到Agent│ │    战略启示与行动 │ │
│  └──────────────────┘ └──────────────────┘ │
│                                             │
│  ┌──────────────────────────────────────┐  │
│  │ 报告概览: 本报告通过134步深度研究...  │  │
│  └──────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

**数据结构**:

```typescript
interface TocPageConfig {
  template: "toc";
  layout: "twoColumn" | "singleColumn";
  elements: {
    title: string;
    subtitle?: string;
    chapters: {
      number: string; // "00", "01"
      name: string; // 章节名称
      subtitle: string; // 章节副标题
      highlight?: boolean; // 是否高亮
    }[];
    overviewBox?: {
      title: string;
      content: string;
    };
  };
}
```

---

### 2.3 章节标题页 (ChapterTitle)

**用途**: 章节分隔，引入新章节

**视觉布局**:

```
┌─────────────────────────────────────────────┐
│                                             │
│                                             │
│            ┌────┐                           │
│            │ 01 │  CHAPTER ONE              │
│            └────┘                           │
│                                             │
│     ════════════════════════════════       │
│              宏观政策演进                    │
│     ────────────────────────────────       │
│        从市场引导到举国体制                  │
│     ════════════════════════════════       │
│                                             │
│     [AI政策] [国家战略] [产业规划] [监管]    │
│                                             │
│                                             │
│                                    [页码]   │
└─────────────────────────────────────────────┘
```

**数据结构**:

```typescript
interface ChapterTitlePageConfig {
  template: "chapterTitle";
  elements: {
    chapterNumber: string; // "01"
    chapterLabel: string; // "CHAPTER ONE"
    title: string; // 章节主标题
    subtitle: string; // 章节副标题
    keywords: string[]; // 关键词标签
    accentIcon?: string; // 装饰性图标
  };
}
```

---

### 2.4 章节小结页 (ChapterSummary)

**用途**: 总结本章核心要点和战略启示

**视觉布局**:

```
┌─────────────────────────────────────────────┐
│  本章小结与启示                              │
│  KEY TAKEAWAYS                              │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │ 观点1: 新国家资本主义                 │   │
│  │ ──────────────────────────────────── │   │
│  │ 核心机制: 政府通过战略投资...         │   │
│  │ 战略含义: 这意味着私营部门...         │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │ 观点2: 物理基建竞争                   │   │
│  │ ──────────────────────────────────── │   │
│  │ 核心机制: AI竞争已从模型...           │   │
│  │ 战略含义: 能源和土地成为...           │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌──────────────────────────────────────┐  │
│  │ 💡 关键战略启示                       │  │
│  │ • 启示1: 需要关注政府角色转变         │  │
│  │ • 启示2: 算力基础设施是新的战略资产   │  │
│  │ • 启示3: 能源成本将决定竞争力         │  │
│  └──────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

**数据结构**:

```typescript
interface ChapterSummaryPageConfig {
  template: "chapterSummary";
  layout: "gridWithHighlight";
  elements: {
    title: string;
    subtitle?: string;
    keyPoints: {
      label: string; // "观点1"
      title: string; // 核心观点标题
      content: string; // 详细说明
      mechanism?: string; // 核心机制
      strategicImplication?: string; // 战略含义
    }[];
    actionBox: {
      title: string; // "关键战略启示"
      icon?: string;
      items: string[]; // 启示列表
    };
  };
}
```

---

### 2.5 结束语页 (Conclusion)

**用途**: 全文核心观点回顾和战略建议

**数据结构**:

```typescript
interface ConclusionPageConfig {
  template: "conclusion";
  elements: {
    title: string;
    subtitle: string;
    corePoints: {
      label: string;
      title: string;
      mechanism: string; // 核心机制说明
      evidence: string; // 关键验证
      implication: string; // 战略含义
    }[];
    finalStatement?: {
      text: string;
      emphasis?: string;
    };
  };
}
```

---

## 三、内容型页面模板

### 3.1 时间线页 (Timeline)

**用途**: 展示时间演进、发展阶段

**视觉布局**:

```
┌─────────────────────────────────────────────┐
│  美国AI政策演进历程                          │
│  THE EVOLUTION OF US AI POLICY               │
│                                             │
│  ┌─────┐    ┌─────┐    ┌─────┐    ┌─────┐  │
│  │2016 │────│2020 │────│2023 │────│2025 │  │
│  │-2019│    │-2022│    │-2024│    │+    │  │
│  └──┬──┘    └──┬──┘    └──┬──┘    └──┬──┘  │
│     │          │          │          │      │
│  ┌──▼──────┐┌──▼──────┐┌──▼──────┐┌──▼────┐│
│  │市场技术 ││产业成型 ││治理并进 ││举国   ││
│  │引导期   ││期       ││期       ││体制期 ││
│  │         ││         ││         ││       ││
│  │•早期政策││•产业政策││•监管框架││•战略  ││
│  │•研发支持││•人才培养││•国际竞争││ 投资  ││
│  └─────────┘└─────────┘└─────────┘└───────┘│
│                                             │
│  ┌──────────────────────────────────────┐  │
│  │ 💡 核心洞察: 美国AI政策已从市场引导   │  │
│  │    转向国家战略主导，标志着新国家资本  │  │
│  │    主义的到来                         │  │
│  └──────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

**数据结构**:

```typescript
interface TimelinePageConfig {
  template: "timeline";
  layout: "horizontalFlow" | "verticalFlow";
  elements: {
    title: string;
    subtitle?: string;
    timeline: {
      axis: "horizontal" | "vertical";
      periods: {
        dateRange: string; // "2016-2019"
        stageName: string; // "市场技术引导期"
        description: string;
        highlights: string[];
        isCurrent?: boolean;
      }[];
    };
    insightBox?: {
      icon?: string;
      title?: string;
      content: string;
    };
  };
}
```

**适用场景**:

- 政策/技术演进历程
- 产品发展路线图
- 历史事件梳理
- 阶段性目标规划

---

### 3.2 多栏并列页 (MultiColumn)

**用途**: 2-5栏并列展示框架、对比

**视觉布局 (3栏示例)**:

```
┌─────────────────────────────────────────────┐
│  美国AI战略三大支柱                          │
│  THREE PILLARS OF US AI STRATEGY             │
│                                             │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ │
│  │    🏛️     │ │    💰     │ │    🔬     │ │
│  │   政策    │ │   资本    │ │   技术    │ │
│  │  POLICY   │ │  CAPITAL  │ │ TECHNOLOGY│ │
│  ├───────────┤ ├───────────┤ ├───────────┤ │
│  │ 核心抓手: │ │ 核心抓手: │ │ 核心抓手: │ │
│  │ 行政命令  │ │ 风险投资  │ │ 研发生态  │ │
│  │           │ │           │ │           │ │
│  │ • 要点1   │ │ • 要点1   │ │ • 要点1   │ │
│  │ • 要点2   │ │ • 要点2   │ │ • 要点2   │ │
│  │ • 要点3   │ │ • 要点3   │ │ • 要点3   │ │
│  │           │ │           │ │           │ │
│  │ 目标:     │ │ 目标:     │ │ 目标:     │ │
│  │ 确保领导力│ │ 持续投入  │ │ 保持优势  │ │
│  └───────────┘ └───────────┘ └───────────┘ │
└─────────────────────────────────────────────┘
```

**数据结构**:

```typescript
interface MultiColumnPageConfig {
  template: "multiColumn";
  columns: 2 | 3 | 4 | 5;
  elements: {
    title: string;
    subtitle?: string;
    columns: {
      icon?: string;
      header: string;
      subtitle?: string;
      keyPoint?: string; // 核心抓手说明
      bulletPoints: string[];
      goal?: string;
      colorTheme?: "blue" | "green" | "purple" | "gold";
    }[];
  };
}
```

**适用场景**:

- 框架/模型展示 (如三大支柱)
- 并列要素对比
- 分类说明
- 选项呈现

---

### 3.3 左右分栏页 (SplitLayout)

**用途**: 深度分析，左侧概述+右侧详情

**视觉布局**:

```
┌─────────────────────────────────────────────┐
│  NVIDIA 的双支柱战略                         │
│                                             │
│  ┌───────────────┬─────────────────────────┐│
│  │               │                         ││
│  │  [标签]       │  ┌─────────────────────┐││
│  │  核心战略     │  │ 企业级AI            │││
│  │               │  │ NIMs 微服务         │││
│  │  详细说明     │  │ • 降低AI部署门槛    │││
│  │  段落文字...  │  │ • 标准化推理服务    │││
│  │               │  │ • 云+端灵活部署     │││
│  │  ┌─────────┐ │  └─────────────────────┘││
│  │  │核心要素 │ │                         ││
│  │  │• 要素1  │ │  ┌─────────────────────┐││
│  │  │• 要素2  │ │  │ 主权AI              │││
│  │  │• 要素3  │ │  │ 政府定制方案        │││
│  │  └─────────┘ │  │ • 本土化部署        │││
│  │               │  │ • 数据主权保障      │││
│  │  [关键指标]   │  │ • 战略安全合作      │││
│  │  毛利率 70%+  │  └─────────────────────┘││
│  └───────────────┴─────────────────────────┘│
└─────────────────────────────────────────────┘
```

**数据结构**:

```typescript
interface SplitLayoutPageConfig {
  template: "splitLayout";
  ratio: "40:60" | "30:70" | "50:50";
  elements: {
    title: string;
    leftPanel: {
      label?: string;
      title: string;
      description: string;
      highlightBox?: {
        title: string;
        items: string[];
      };
      keyMetrics?: {
        label: string;
        value: string;
      }[];
    };
    rightPanel: {
      type: "cardList" | "chart" | "table" | "bulletList";
      items?: {
        icon?: string;
        title: string;
        description?: string;
        bulletPoints?: string[];
        tags?: string[];
      }[];
      chartConfig?: ChartConfig;
    };
  };
}
```

**适用场景**:

- 概述+详细分析
- 论点+论据展示
- 定性+定量结合
- 策略+执行细节

---

### 3.4 数据仪表盘页 (Dashboard)

**用途**: 展示关键指标、数据图表

**视觉布局**:

```
┌─────────────────────────────────────────────┐
│  AI产业关键指标                              │
│  KEY METRICS                                 │
│                                             │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌────┐│
│  │ $3.3T   │ │ +35%    │ │ 1.5B    │ │2026││
│  │ 市场规模 │ │ YoY增长 │ │ AI用户  │ │窗口││
│  │ 2030预测│ │ 投资增速│ │ 全球    │ │期  ││
│  │ ▲ 稳增  │ │ ▲ 强劲  │ │ ▲ 爆发  │ │关键││
│  └─────────┘ └─────────┘ └─────────┘ └────┘│
│                                             │
│  ┌───────────────────┐ ┌───────────────────┐│
│  │ 市场规模预测       │ │ 投资分布          │││
│  │ ┌─────────────┐   │ │                   ││
│  │ │   ▓▓▓▓▓▓   │   │ │   ╭───╮          ││
│  │ │  ▓▓▓▓      │   │ │  ╱     ╲         ││
│  │ │ ▓▓         │   │ │ │ 40%   │ 30%    ││
│  │ │▓           │   │ │  ╲     ╱         ││
│  │ └─────────────┘   │ │   ╰───╯ 30%     ││
│  │ 2024  25  26  27  │ │                   ││
│  └───────────────────┘ └───────────────────┘│
└─────────────────────────────────────────────┘
```

**数据结构**:

```typescript
interface DashboardPageConfig {
  template: "dashboard";
  elements: {
    title: string;
    subtitle?: string;
    kpiCards: {
      label: string;
      value: string;
      unit?: string;
      trend?: "+" | "-" | "=";
      trendLabel?: string;
      description?: string;
      highlightColor?: "green" | "blue" | "gold" | "red";
    }[];
    charts: {
      type: "bar" | "line" | "pie" | "donut";
      title: string;
      data: ChartData;
      position: "bottomLeft" | "bottomRight" | "fullWidth";
    }[];
  };
}
```

**适用场景**:

- 关键业务指标
- 市场数据分析
- 财务指标展示
- 运营数据监控

---

### 3.5 演进路线图页 (EvolutionRoadmap)

**用途**: 展示能力演进、技术路线

**视觉布局**:

```
┌─────────────────────────────────────────────┐
│  AI Agent 能力演进路线图                     │
│  ~2025 ────────────────────────── 2030+     │
│                                             │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐     │
│  │ Phase 1 │─►│ Phase 2 │─►│ Phase 3 │     │
│  │  ~2025  │  │2025-2027│  │ 2027+   │     │
│  └────┬────┘  └────┬────┘  └────┬────┘     │
│       │            │            │           │
│  ┌────▼────┐  ┌────▼────┐  ┌────▼────┐     │
│  │  助手   │  │  代理人  │  │ 自主执行│     │
│  │ COPILOT │  │  AGENT  │  │AUTONOMOUS│    │
│  │         │  │         │  │         │     │
│  │•任务辅助│  │•任务执行│  │•自主决策│     │
│  │•信息检索│  │•多步规划│  │•战略闭环│     │
│  │•建议生成│  │•工具调用│  │•自我优化│     │
│  └─────────┘  └─────────┘  └─────────┘     │
│       ▲                                     │
│    当前阶段                                  │
│                                             │
│  ┌──────────────────────────────────────┐  │
│  │ 💡 关键洞察: 从助手到自主执行者的跃迁  │  │
│  │    需要解决可靠性、安全性和对齐问题   │  │
│  └──────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

**数据结构**:

```typescript
interface EvolutionRoadmapPageConfig {
  template: "evolutionRoadmap";
  elements: {
    title: string;
    subtitle?: string;
    phases: {
      phaseNumber: number;
      dateRange: string;
      phaseName: string;
      subtitle?: string;
      capabilities: string[];
      isCurrent?: boolean;
    }[];
    insightBox?: {
      icon?: string;
      content: string;
    };
  };
}
```

**适用场景**:

- 技术演进路线
- 产品发展规划
- 能力成长路径
- 战略实施阶段

---

### 3.6 对比分析页 (Comparison)

**用途**: 详细的多维度对比

**视觉布局**:

```
┌─────────────────────────────────────────────┐
│  Genesis vs Stargate 项目对比                │
│                                             │
│  ┌───────────────────┬───────────────────┐ │
│  │     GENESIS       │     STARGATE      │ │
│  │     创世纪计划     │     星门计划       │ │
│  ├───────────────────┼───────────────────┤ │
│  │ 📍 平台定位        │ 📍 平台定位        │ │
│  │ ASSP国家级安全AI  │ 10GW级算力集群     │ │
│  │ 平台              │ 超级工程           │ │
│  ├───────────────────┼───────────────────┤ │
│  │ 🏛️ 政府特点        │ 🏛️ 政府特点        │ │
│  │ 深度介入，安全优先 │ 行政扫除障碍       │ │
│  ├───────────────────┼───────────────────┤ │
│  │ 💰 投资规模        │ 💰 投资规模        │ │
│  │ 未公开            │ $500B+            │ │
│  ├───────────────────┼───────────────────┤ │
│  │ 🎯 头部企业        │ 🎯 头部企业        │ │
│  │ 24家              │ OpenAI+Oracle等    │ │
│  └───────────────────┴───────────────────┘ │
│                                             │
│  ┌──────────────────────────────────────┐  │
│  │ 💡 关键洞察: 两大项目体现了"国家意志  │  │
│  │    ×巨头执行"的新模式               │  │
│  └──────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

**数据结构**:

```typescript
interface ComparisonPageConfig {
  template: "comparison";
  layout: "sideBySide" | "table";
  elements: {
    title: string;
    items: {
      name: string;
      subtitle?: string;
      color?: string;
      attributes: {
        [key: string]: string; // 维度名: 描述
      };
      kpis?: {
        label: string;
        value: string;
      }[];
    }[];
    insightBox?: {
      icon?: string;
      content: string;
    };
  };
}
```

**适用场景**:

- 产品/服务对比
- 竞品分析
- 方案评估
- 技术选型

---

### 3.7 案例展示页 (CaseStudy)

**用途**: 展示典型案例、最佳实践

**视觉布局**:

```
┌─────────────────────────────────────────────┐
│  企业级AI应用典型案例                        │
│                                             │
│  ┌───────────────────────────────────────┐ │
│  │ 🔷 Palantir AIP                        │ │
│  │   政府+企业AI平台的典范                 │ │
│  │                                        │ │
│  │   • 深度整合现有IT系统                  │ │
│  │   • 支持敏感数据的本地部署              │ │
│  │   • 完整的合规与审计能力                │ │
│  │                                        │ │
│  │   ┌────────────┐                       │ │
│  │   │ +151%      │ 合同价值增速           │ │
│  │   └────────────┘                       │ │
│  └───────────────────────────────────────┘ │
│                                             │
│  ┌───────────────────────────────────────┐ │
│  │ 🟢 ServiceNow Now Assist               │ │
│  │   企业工作流AI助手                      │ │
│  │                                        │ │
│  │   • 无缝嵌入现有工作流                  │ │
│  │   • 自动化ticket处理                   │ │
│  │   • 智能知识库检索                      │ │
│  │                                        │ │
│  │   ┌────────────┐                       │ │
│  │   │ 3x         │ 响应效率提升           │ │
│  │   └────────────┘                       │ │
│  └───────────────────────────────────────┘ │
│                                             │
│  趋势总结: 企业级AI正从"锦上添花"走向"刚需"  │
└─────────────────────────────────────────────┘
```

**数据结构**:

```typescript
interface CaseStudyPageConfig {
  template: "caseStudy";
  elements: {
    title: string;
    introduction?: string;
    cases: {
      name: string;
      icon?: string;
      tagline: string;
      keyPoints: string[];
      kpi?: {
        value: string;
        label: string;
      };
      colorTheme?: "dark" | "light" | "accent";
    }[];
    trendSummary?: string;
  };
}
```

**适用场景**:

- 成功案例展示
- 最佳实践分享
- 竞品案例分析
- 应用场景说明

---

### 3.8 成熟度模型页 (MaturityModel)

**用途**: 展示分级/分层能力模型

**视觉布局**:

```
┌─────────────────────────────────────────────┐
│  Data Agent 成熟度模型                       │
│                                             │
│  ┌─────────────┬───────────────────────────┐│
│  │             │                           ││
│  │  模型说明   │  ┌─────────────────────┐  ││
│  │             │  │ L5 完全自主         │  ││
│  │  Data Agent │  │ Fully Autonomous    │  ││
│  │  是能够     │  │ 战略闭环 ★          │  ││
│  │  自主处理   │  ├─────────────────────┤  ││
│  │  数据任务   │  │ L4 高度自治         │  ││
│  │  的AI系统   │  │ Highly Autonomous   │  ││
│  │             │  ├─────────────────────┤  ││
│  │  ┌───────┐ │  │ L3 有条件自治       │  ││
│  │  │核心要素│ │  │ Conditional Auto.   │  ││
│  │  │• 对象 │ │  │ ◄── 当前阶段        │  ││
│  │  │• 行动 │ │  ├─────────────────────┤  ││
│  │  │• 逻辑 │ │  │ L2 部分辅助         │  ││
│  │  └───────┘ │  ├─────────────────────┤  ││
│  │             │  │ L1 增强展示         │  ││
│  │             │  ├─────────────────────┤  ││
│  │             │  │ L0 无辅助           │  ││
│  │             │  └─────────────────────┘  ││
│  └─────────────┴───────────────────────────┘│
└─────────────────────────────────────────────┘
```

**数据结构**:

```typescript
interface MaturityModelPageConfig {
  template: "maturityModel";
  elements: {
    title: string;
    leftPanel: {
      description: string;
      coreConcept: {
        title: string;
        items: string[];
      };
    };
    levels: {
      level: string; // "L5", "L4"
      name: string; // "完全自主"
      english?: string; // "Fully Autonomous"
      description: string;
      tag?: string; // "战略闭环"
      isCurrent?: boolean;
      color?: "gold" | "blue" | "green" | "gray";
    }[];
  };
}
```

**适用场景**:

- 能力成熟度评估
- 技术等级划分
- 发展阶段定义
- 评估框架展示

---

### 3.9 风险/机遇对比页 (RiskOpportunity)

**用途**: 双面分析，展示风险与机遇

**视觉布局**:

```
┌─────────────────────────────────────────────┐
│  AI投资: 泡沫 vs 理性繁荣                    │
│                                             │
│  ┌───────────────────┬───────────────────┐ │
│  │ 🔴 风险信号        │ 🟢 理性繁荣证据    │ │
│  │ BUBBLE SIGNALS     │ RATIONAL EXUBER.  │ │
│  ├───────────────────┼───────────────────┤ │
│  │                   │                   │ │
│  │ ⚠️ 财务魔法        │ ✓ 实际落地        │ │
│  │ 部分公司收入增长   │ 企业AI应用渗透    │ │
│  │ 依赖关联交易       │ 率持续提升        │ │
│  │                   │                   │ │
│  │ ⚠️ 估值泡沫        │ ✓ 成本下降        │ │
│  │ 头部公司市盈率     │ 推理成本每年下降  │ │
│  │ 超过100倍         │ 90%+              │ │
│  │                   │                   │ │
│  │ ⚠️ 预期过高        │ ✓ 基础设施实在    │ │
│  │ AGI时间表不断     │ 算力投资转化为    │ │
│  │ 推迟              │ 实际产能          │ │
│  └───────────────────┴───────────────────┘ │
│                                             │
│  当前市场结构估测:                           │
│  ┌─────────────────────────────────────┐   │
│  │  泡沫 40%  ████████░░░░░░░░░  60% 价值 │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  我们的判断: 整体偏向理性繁荣，但需警惕局部泡沫│
└─────────────────────────────────────────────┘
```

**数据结构**:

```typescript
interface RiskOpportunityPageConfig {
  template: "riskOpportunity";
  elements: {
    title: string;
    leftPanel: {
      type: "risk";
      title: string;
      items: {
        icon?: string;
        title: string;
        description: string;
      }[];
    };
    rightPanel: {
      type: "opportunity";
      title: string;
      items: {
        icon?: string;
        title: string;
        description: string;
      }[];
    };
    gauge?: {
      riskPercentage: number;
      valuePercentage: number;
      label: string;
    };
    conclusion?: {
      text: string;
      emphasis?: string;
    };
  };
}
```

**适用场景**:

- 风险评估
- 机遇分析
- 正反论证
- 决策权衡

---

### 3.10 建议行动页 (Recommendations)

**用途**: 战略建议和行动清单

**视觉布局**:

```
┌─────────────────────────────────────────────┐
│  战略建议与行动                              │
│  STRATEGIC RECOMMENDATIONS                   │
│                                             │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │ 01 🎯   │ │ 02 🔧   │ │ 03 🌐   │       │
│  │ 坚定    │ │ 打造    │ │ 构建    │       │
│  │ 基础大模│ │ Data    │ │ 数据    │       │
│  │ 型投入  │ │ Agent   │ │ 联盟    │       │
│  │         │ │         │ │         │       │
│  │ 持续投入│ │ 建设企业│ │ 与行业头│       │
│  │ 基础模型│ │ 级数据智│ │ 部建立数│       │
│  │ 研发... │ │ 能体... │ │ 据共享..│       │
│  └─────────┘ └─────────┘ └─────────┘       │
│                                             │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌───┐ │
│  │ 04 🔬   │ │ 05 📱   │ │ 06 🚀   │ │07 │ │
│  │ 优先    │ │ 端侧    │ │ AI2D   │ │...│ │
│  │ AI4Sci  │ │ Agent   │ │ 加速    │ │   │ │
│  └─────────┘ └─────────┘ └─────────┘ └───┘ │
│                                             │
│  ═══════════════════════════════════════   │
│         2026 黄金窗口期                      │
│  ┌─────┬─────┬─────┬─────┬─────┬─────┐     │
│  │ Q1  │ Q2  │ Q3  │ Q4  │ Q1  │ Q2  │     │
│  │战略 │能力 │生态 │规模 │国际 │领导 │     │
│  │规划 │建设 │布局 │扩张 │拓展 │地位 │     │
│  └─────┴─────┴─────┴─────┴─────┴─────┘     │
│                                             │
│  ┌──────────────────────────────────────┐  │
│  │ 🚀 行动起来，把握历史性机遇窗口        │  │
│  └──────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

**数据结构**:

```typescript
interface RecommendationsPageConfig {
  template: "recommendations";
  elements: {
    title: string;
    subtitle?: string;
    recommendations: {
      number: string; // "01"
      icon?: string;
      title: string;
      description: string;
      priority?: "high" | "medium" | "low";
      color?: string;
    }[];
    timelineFooter?: {
      year: string;
      label: string;
      milestones: {
        period: string;
        label: string;
      }[];
    };
    callToAction?: {
      icon?: string;
      text: string;
    };
  };
}
```

**适用场景**:

- 战略建议
- 行动清单
- 实施路线图
- 决策指南

---

## 四、模板使用原则

### 4.1 选择原则

| 内容特征   | 推荐模板          | 备选模板           |
| ---------- | ----------------- | ------------------ |
| 时间演进   | `timeline`        | `evolutionRoadmap` |
| 2项对比    | `splitLayout`     | `riskOpportunity`  |
| 3-5项并列  | `multiColumn`     | `caseStudy`        |
| 高密度数据 | `dashboard`       | `splitLayout`      |
| 层级结构   | `maturityModel`   | `evolutionRoadmap` |
| 行动建议   | `recommendations` | `multiColumn`      |
| 深度分析   | `splitLayout`     | `dashboard`        |

### 4.2 避免误用

| 误用场景           | 错误模板      | 正确模板      |
| ------------------ | ------------- | ------------- |
| 非时间内容用时间线 | `timeline`    | `multiColumn` |
| 纯文字用仪表盘     | `dashboard`   | `splitLayout` |
| 超过5项用多栏      | `multiColumn` | `splitLayout` |
| 单主体用对比       | `comparison`  | `splitLayout` |

### 4.3 组合建议

**标准章节结构**:

```
章节标题页 (chapterTitle)
    ↓
时间线/背景页 (timeline/splitLayout)
    ↓
数据分析页 (dashboard)
    ↓
对比分析页 (comparison/multiColumn)
    ↓
案例展示页 (caseStudy) [可选]
    ↓
章节小结页 (chapterSummary)
```

---

## 五、参考资料

- [设计概述](./design-overview.md)
- [模板选择引擎](./template-selection-engine.md)
- [视觉设计系统](./visual-design-system.md)

---

**文档版本**: v1.0
**创建日期**: 2024-12-28
