# Slides Engine v3.0 - 统一架构文档

> 最后更新: 2026-01-01
> 版本: 3.1 (归一重构)

---

## 一、核心原则

### 1.1 意图驱动设计链条 ⭐ 最重要

**模板是应对逻辑的，逻辑来源于目标，目标来源于意图理解。环环相扣。**

```
用户输入 (sourceText + userRequirement)
        ↓
┌─────────────────────────────────────────────────────┐
│ Phase 1: 意图理解 (TaskDecompositionSkill)          │
│                                                      │
│ 回答：用户想表达什么？                               │
│ - 主题是什么？(topic)                                │
│ - 核心信息点？(keyInsights)                          │
│ - 有哪些数据？(dataPoints)                           │
│ - 目标受众？(targetAudience)                         │
└─────────────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────────────┐
│ Phase 2: 目标推导 (OutlinePlanningSkill)            │
│                                                      │
│ 回答：每页要达成什么效果？                           │
│ - 传达信息？(contentBrief)                           │
│ - 引发情感？(emotionalGoal)                          │
│ - 促成行动？(callToAction)                           │
└─────────────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────────────┐
│ Phase 3: 逻辑构建 (页面结构决策)                     │
│                                                      │
│ 回答：用什么结构承载内容？                           │
│ - 并列展示？→ pillars / multiColumn                  │
│ - 时序演进？→ timeline / evolutionRoadmap            │
│ - 对比分析？→ comparison / riskOpportunity           │
│ - 数据呈现？→ dashboard / chart                      │
│ - 图文结合？→ splitLayout                            │
└─────────────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────────────┐
│ Phase 4: 模板选择 (TemplateMatcherSkill)            │
│                                                      │
│ 回答：哪个模板最适合这个逻辑？                       │
│ - 根据逻辑类型匹配模板                               │
│ - 确保模板多样性（禁止连续相同）                     │
│ - 验证容量匹配                                       │
└─────────────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────────────┐
│ Phase 5: HTML 生成 (TemplateRenderingSkill)         │
│                                                      │
│ 执行：将内容填充到模板                               │
│ - 变量提取与注入                                     │
│ - 主题样式应用                                       │
│ - 图表渲染                                           │
└─────────────────────────────────────────────────────┘
        ↓
导出 (PPTX/PDF/PNG via Puppeteer)
```

### 1.2 页面三要素原则 ⭐ 核心

**每一页必须具备三个要素：观点 + 逻辑 + 数据**

```
┌─────────────────────────────────────────────────────────────┐
│                       单页结构模型                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 观点 (Viewpoint)                                     │   │
│  │                                                       │   │
│  │ = 页面标题                                           │   │
│  │ = 这一页想要表达的核心判断                           │   │
│  │ = 例：「AI 正在重塑企业竞争格局」                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 逻辑 (Logic)                                         │   │
│  │                                                       │   │
│  │ = 支撑观点的论证结构                                 │   │
│  │ = 决定使用什么模板                                   │   │
│  │ = 例：并列展示3个支柱 → 使用 S-003 三支柱模板        │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 数据 (Data)                                          │   │
│  │                                                       │   │
│  │ = 填充模板的具体内容                                 │   │
│  │ = 三种形式：                                         │   │
│  │   • 文字描述：解释性文本、要点、引用                 │   │
│  │   • 数字数据：统计值、百分比、KPI                    │   │
│  │   • 图片素材：图表、照片、图标、示意图               │   │
│  │                                                       │   │
│  │ = 数据必须直接支撑逻辑！                             │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### 1.2.1 观点 (Viewpoint)

| 要求         | 说明             | 示例                                                |
| ------------ | ---------------- | --------------------------------------------------- |
| 必须是判断句 | 不是描述，是结论 | ✅ 「AI 降低运营成本 30%」<br>❌ 「关于 AI 的成本」 |
| 必须有态度   | 表达立场或观点   | ✅ 「数字化转型势在必行」<br>❌ 「数字化转型介绍」  |
| 一页一观点   | 聚焦单一核心     | ✅ 一个清晰的判断<br>❌ 多个混杂的信息              |

#### 1.2.2 逻辑 (Logic)

**逻辑决定模板选择：**

| 逻辑类型 | 描述             | 对应模板                    |
| -------- | ---------------- | --------------------------- |
| 并列论证 | N个并列的支撑点  | S-003/S-004/S-005 (Pillars) |
| 时序论证 | 按时间顺序展开   | S-006/S-007 (Timeline)      |
| 对比论证 | 通过对比突显差异 | D-004/D-005 (Comparison)    |
| 数据论证 | 用数字说明问题   | D-001/D-002/D-003           |
| 因果论证 | 展示原因和结果   | S-008 (Process)             |
| 层级论证 | 展示优先级或层次 | S-009 (Pyramid)             |
| 案例论证 | 用实例佐证       | C-001/C-002/C-007           |

#### 1.2.3 数据 (Data)

```typescript
// 数据的三种形式
interface PageData {
  // 1. 描述性文字 - 解释和阐述
  textContent: {
    paragraphs?: string[]; // 段落文本
    bulletPoints?: string[]; // 要点列表
    quotes?: string[]; // 引用语句
    captions?: string[]; // 图片说明
  };

  // 2. 数字数据 - 量化证据
  numericData: {
    stats?: Array<{
      value: string; // 数值 (如 "85%")
      label: string; // 标签 (如 "市场份额")
      change?: string; // 变化 (如 "+12%")
    }>;
    kpis?: Array<{
      value: string;
      label: string;
      trend?: "up" | "down" | "flat";
    }>;
    chartData?: any; // 图表数据
  };

  // 3. 图片素材 - 视觉证据
  visualAssets: {
    images?: string[]; // 图片 URL
    icons?: string[]; // 图标
    charts?: string[]; // 图表
    diagrams?: string[]; // 示意图
  };
}
```

**数据必须支撑逻辑的检查规则：**

```
观点：「AI 降低运营成本 30%」
逻辑：数据论证 → D-001 (Big Number)
数据：
  ✅ 数字: "30%" (直接支撑)
  ✅ 文字: "对比传统方式节省人力成本" (解释数字)
  ❌ 数字: "用户增长 50%" (无关数据)
```

### 1.3 内容决定结构，结构决定模板

| 内容类型    | 逻辑结构 | 正确模板           | 错误模板       |
| ----------- | -------- | ------------------ | -------------- |
| 3个核心优势 | 并列展示 | S-003 (3-Pillar)   | ❌ timeline    |
| 发展历程    | 时序演进 | S-006 (Timeline)   | ❌ pillars     |
| A vs B      | 对比分析 | D-004 (Comparison) | ❌ dashboard   |
| 4个KPI指标  | 数据呈现 | D-002 (Dashboard)  | ❌ splitLayout |
| 案例+图片   | 图文结合 | C-001/C-002        | ❌ pillars     |

### 1.3 模板多样性原则

- **并列内容** → 使用同一模板（如3个支柱用 S-003）
- **非并列内容** → 使用不同模板
- **相邻页面** → 禁止连续使用相同模板（已在 OutlinePlanningSkill 中实现）

### 1.4 单一渲染路径

```
TemplateRenderingSkill → FourStepDesignSkill (降级)
        ↓
    HTML 输出
        ↓
    Puppeteer 截图
        ↓
    PPTX/PDF/PNG
```

### 1.5 废弃组件

- ~~PptxSlidesRenderer~~ → 已删除（2026-01-01）
- 导出统一使用 HTML 截图路径

---

## 二、目录结构

```
slides/
├── ARCHITECTURE.md              # 本文档
├── slides.module.ts             # 模块定义
├── slides.controller.ts         # HTTP API 入口
│
├── orchestrator/                # 编排层
│   ├── slides-orchestrator.service.ts  # 三阶段管线
│   └── multi-model.service.ts   # 多模型调用
│
├── roles/                       # 角色层 (AI Agent)
│   ├── architect.service.ts     # 架构师：任务分解+大纲规划
│   ├── writer.service.ts        # 写手：内容填充
│   ├── renderer.service.ts      # 渲染师：HTML生成
│   └── reviewer.service.ts      # 审核员：质量检查
│
├── skills/                      # 技能层 (确定性逻辑)
│   ├── template-rendering.skill.ts    # ⭐ 主渲染引擎
│   ├── four-step-design.skill.ts      # 降级：AI 4步设计
│   ├── template-matcher.skill.ts      # 模板匹配
│   ├── page-type-selection.skill.ts   # 页面类型选择
│   └── narrative-planner.skill.ts     # 叙事规划
│
├── templates/                   # 模板库
│   ├── base/
│   │   ├── design-tokens.ts     # 设计令牌
│   │   ├── common-styles.ts     # 公共样式
│   │   └── template-registry.ts # 模板注册中心
│   └── categories/
│       ├── data.templates.ts        # D-001~D-006 数据模板
│       ├── structural.templates.ts  # S-001~S-009 结构模板
│       ├── content.templates.ts     # C-001~C-007 内容模板
│       ├── narrative.templates.ts   # N-001~N-005 叙事模板
│       └── action.templates.ts      # A-001~A-005 行动模板
│
├── rendering/                   # 导出层
│   └── slides-export.service.ts # 统一导出服务
│
├── checkpoint/                  # 检查点
│   ├── checkpoint.service.ts    # 状态持久化
│   └── checkpoint.types.ts      # 类型定义
│
└── types/                       # 类型定义
    ├── slides.types.ts          # 主类型
    └── slides-templates.types.ts # 模板类型
```

---

## 三、渲染决策流程

### 3.1 模板选择决策树

```
页面目的 (purpose)
├── title/opening
│   └── cover → N-001
│
├── toc
│   └── toc → S-001
│
├── section/transition
│   └── chapterTitle → N-003
│
├── content
│   ├── 有统计数据?
│   │   ├── 1个大数字 → D-001 (Big Number)
│   │   ├── 2-4个KPI → D-002 (Dashboard)
│   │   └── 趋势数据 → D-003 (Trend Chart)
│   │
│   ├── 有并列要点?
│   │   ├── 3个支柱 → S-003 (3-Pillar)
│   │   ├── 4个支柱 → S-004 (4-Pillar)
│   │   └── 5个支柱 → S-005 (5-Pillar)
│   │
│   ├── 有时间线?
│   │   ├── 3-5个节点 → S-006 (Timeline)
│   │   └── 详细卡片 → S-007 (Timeline Card)
│   │
│   ├── 有对比?
│   │   ├── 两方对比 → D-004 (Comparison Dual)
│   │   └── 表格对比 → D-005 (Comparison Table)
│   │
│   ├── 有图片?
│   │   ├── 图左文右 → C-001
│   │   └── 文左图右 → C-002
│   │
│   └── 默认
│       └── 要点列表 → C-003 (Bullet List)
│
├── recommendations
│   └── recommendations → A-001
│
├── riskOpportunity
│   └── riskOpportunity → A-002
│
└── closing
    └── conclusion → N-005
```

### 3.2 模板多样性检查

```typescript
// 在 template-matcher.skill.ts 中实现
function ensureTemplateDiversity(
  pages: PageOutline[],
  currentPage: PageOutline,
  previousTemplate: string | null,
): string {
  const candidates = getTemplateCandidates(currentPage);

  // 规则1: 不能连续使用相同模板
  if (previousTemplate && candidates.includes(previousTemplate)) {
    candidates.splice(candidates.indexOf(previousTemplate), 1);
  }

  // 规则2: 统计最近5页的模板使用情况，避免重复
  const recentTemplates = pages.slice(-5).map((p) => p.templateType);
  const leastUsed = candidates.filter((t) => !recentTemplates.includes(t));

  return leastUsed.length > 0 ? leastUsed[0] : candidates[0];
}
```

---

## 四、数据流

### 4.1 完整流程

```
┌─────────────────────────────────────────────────────────────────┐
│ Phase 1: Task Decomposition                                     │
│ Input: sourceText, userRequirement                              │
│ Output: TaskDecomposition { topic, sections, designStrategy }   │
│ Checkpoint: task_decomposition                                  │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 2: Outline Planning                                       │
│ Input: TaskDecomposition                                        │
│ Output: OutlinePlan { pages[], globalStyles }                   │
│ Key: 每页确定 templateType                                       │
│ Checkpoint: outline_confirmed                                   │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 3: Page Rendering (循环)                                  │
│                                                                 │
│ For each page:                                                  │
│   1. WriterService.fillContent() → PageContent                 │
│   2. ImageGenerator.generate() → GeneratedImage[]              │
│   3. RendererService.renderPage():                             │
│      ├─ TemplateRenderingSkill.render()  ← 主路径             │
│      └─ FourStepDesignSkill.execute()    ← 降级路径           │
│   Output: PageState { html, ... }                              │
│                                                                 │
│ Checkpoint: page_rendered (每5页)                               │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 4: Quality Review                                         │
│ Output: QualityReport                                           │
│ Checkpoint: batch_rendered                                      │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│ Export (用户触发)                                                │
│ SlidesExportService.exportToPPTX/PDF/PNG()                     │
│ Method: HTML 截图 (Puppeteer)                                   │
│ Output: Buffer                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 五、模板分类与使用场景

### 5.1 数据模板 (D-\*)

| ID    | 名称             | 适用场景         | 内容要求       |
| ----- | ---------------- | ---------------- | -------------- |
| D-001 | Big Number       | 单一核心数据展示 | 1个stat + 说明 |
| D-002 | Dashboard 4KPI   | 多指标概览       | 2-4个stat      |
| D-003 | Trend Chart      | 趋势分析         | 时间序列数据   |
| D-004 | Comparison Dual  | 双方对比         | 2组并列数据    |
| D-005 | Comparison Table | 详细对比         | 多维度对比     |
| D-006 | Ranking List     | 排名展示         | 有序列表       |

### 5.2 结构模板 (S-\*)

| ID    | 名称            | 适用场景   | 内容要求      |
| ----- | --------------- | ---------- | ------------- |
| S-001 | TOC             | 目录页     | 章节列表      |
| S-002 | Section Divider | 章节分隔   | 章节标题      |
| S-003 | 3-Pillar        | 三大支柱   | 3个并列要点   |
| S-004 | 4-Pillar        | 四大支柱   | 4个并列要点   |
| S-005 | 5-Pillar        | 五大支柱   | 5个并列要点   |
| S-006 | Timeline        | 时间线     | 3-6个时间节点 |
| S-007 | Timeline Card   | 详细时间线 | 时间节点+详情 |
| S-008 | Process Steps   | 流程步骤   | 有序步骤      |
| S-009 | Pyramid         | 金字塔     | 层级结构      |

### 5.3 内容模板 (C-\*)

| ID    | 名称        | 适用场景       | 内容要求  |
| ----- | ----------- | -------------- | --------- |
| C-001 | Image Left  | 图文并排(图左) | 图片+文字 |
| C-002 | Image Right | 图文并排(图右) | 图片+文字 |
| C-003 | Bullet List | 要点列表       | 文字列表  |
| C-004 | Card Grid 2 | 双卡片         | 2个内容块 |
| C-005 | Card Grid 3 | 三卡片         | 3个内容块 |
| C-006 | Card Grid 4 | 四卡片         | 4个内容块 |
| C-007 | Case Detail | 案例详情       | 案例信息  |

### 5.4 叙事模板 (N-\*)

| ID    | 名称              | 适用场景 | 内容要求    |
| ----- | ----------------- | -------- | ----------- |
| N-001 | Cover             | 封面     | 标题+副标题 |
| N-002 | Executive Summary | 执行摘要 | 核心判断    |
| N-003 | Chapter Divider   | 章节标题 | 章节信息    |
| N-004 | TOC               | 目录     | 章节列表    |
| N-005 | Closing           | 结束页   | 致谢+联系   |

### 5.5 行动模板 (A-\*)

| ID    | 名称             | 适用场景   | 内容要求 |
| ----- | ---------------- | ---------- | -------- |
| A-001 | Recommendations  | 建议       | 建议列表 |
| A-002 | Risk-Opportunity | 风险与机遇 | 双列对比 |
| A-003 | Key Conclusions  | 关键结论   | 结论要点 |
| A-004 | Next Steps       | 下一步     | 行动计划 |
| A-005 | Thank You        | 致谢       | 联系方式 |

---

## 六、变量提取规范

### 6.1 标准变量命名

```typescript
// 标题类
TITLE, SUBTITLE, SECTION_TITLE

// 统计类
KPI{N}_VALUE, KPI{N}_LABEL, KPI{N}_CHANGE  // N=1,2,3,4
STAT_VALUE, STAT_LABEL

// 支柱类
P{N}_TITLE, P{N}_DESC, P{N}_STAT, P{N}_LABEL  // N=1,2,3,4,5
PILLAR{N}_TITLE, PILLAR{N}_DESC              // 兼容格式

// 时间线类
M{N}_DATE, M{N}_TITLE, M{N}_DESC  // N=1,2,3,4,5,6

// 列表类
ITEMS, BULLET_POINTS, LIST_ITEMS

// 章节类
CHAPTER_NUM, CHAPTER_EN, OVERVIEW
```

### 6.2 从 PageContent 提取变量

```typescript
// 关键路径: pageContent.sections[i]
sections: [
  {
    type: "stat",
    content: {
      value: "85%",
      label: "市场份额",
      change: "+12%",
    },
  },
  {
    type: "list",
    content: ["要点1", "要点2", "要点3"],
  },
  {
    type: "text",
    content: "段落文本...",
  },
];
```

---

## 七、质量保障

### 7.1 渲染前检查

- [ ] templateType 已设置且有效
- [ ] pageContent.sections 非空
- [ ] 变量提取完整

### 7.2 渲染后检查

- [ ] HTML 无语法错误
- [ ] 无未替换的 {{VARIABLE}}
- [ ] 无溢出内容

### 7.3 导出前检查

- [ ] 所有页面 HTML 已生成
- [ ] 图片 URL 可访问
- [ ] 字体已加载

---

## 八、废弃组件说明

### 8.1 PptxSlidesRenderer (已废弃)

- **位置**: `export/renderers/pptx-slides.renderer.ts`
- **状态**: 注入但从未调用
- **原因**: 导出统一使用 HTML 截图
- **处理**: 标记为 @deprecated，后续版本移除

### 8.2 原因

HTML 截图导出的优势：

1. 与预览 100% 一致
2. 支持复杂 CSS 效果
3. 维护成本低（单一渲染路径）

---

## 九、更新日志

| 版本 | 日期       | 变更                                                          |
| ---- | ---------- | ------------------------------------------------------------- |
| 3.2  | 2026-01-01 | 引入页面三要素原则（观点+逻辑+数据），添加 PageLogicType 类型 |
| 3.1  | 2026-01-01 | 归一重构，彻底删除 PptxSlidesRenderer                         |
| 3.0  | 2025-12-28 | 引入确定性模板系统                                            |
