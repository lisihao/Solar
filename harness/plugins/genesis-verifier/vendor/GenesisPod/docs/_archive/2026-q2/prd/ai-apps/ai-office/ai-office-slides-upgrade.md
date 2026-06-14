# AI Office Slides 质量提升方案 v1.0

> **文档类型**: 产品需求文档 (PRD)
> **版本**: v1.0
> **作者**: 产品团队
> **创建日期**: 2024-12-25
> **状态**: 待评审
> **优先级**: P0 - 核心体验优化

---

## 一、背景与问题

### 1.1 竞品对标：Genspark AI Slides

通过对 Genspark AI Slides 的深度体验和工作流分析，发现其在 PPT 生成质量上显著优于我们的 AI Office。以下是一个真实案例：

**用户输入**: 基于10万字的《美国AI系统分析报告》生成40页商务PPT

**Genspark 输出质量**:

- 40页专业商务风格 PPT
- 内容精准提取自原始报告
- 12种专业模板自动匹配
- 统一的视觉规范和品牌标识
- 支持多轮精细迭代优化

**Genesis 当前输出**:

- 内容空洞，缺乏具体数据
- 布局单一，缺乏专业感
- 无法批量调整样式
- 迭代困难，修改成本高

### 1.2 核心问题诊断

| 问题维度   | 严重程度 | 问题描述                                      |
| ---------- | -------- | --------------------------------------------- |
| 内容质量   | 🔴 P0    | AI 自由发挥，无素材锚定，内容空洞缺乏数据支撑 |
| 迭代能力   | 🔴 P0    | 无批量修改，无智能优化建议，修改成本极高      |
| 模板系统   | 🟡 P1    | 6种通用布局 vs Genspark 12种语义化专业模板    |
| 一致性控制 | 🟡 P1    | 页眉页脚、间距、字体等缺乏全局统一机制        |
| 质量检查   | 🟠 P2    | 无重复检测、布局越界检测、内容完整性检查      |

---

## 二、竞品能力对比

### 2.1 Genspark 核心能力拆解

#### 2.1.1 素材驱动的内容生成

```
Genspark 工作流：
┌─────────────────────────────────────────────────────────────┐
│ 原始报告(10万字)                                              │
│     ↓                                                        │
│ 深度分析：章节结构、核心洞察、数据点、引用、建议               │
│     ↓                                                        │
│ 40页大纲规划（每页绑定原始素材章节）                          │
│     ↓                                                        │
│ 逐页内容生成（强制引用素材，禁止臆造）                        │
└─────────────────────────────────────────────────────────────┘
```

**关键机制**:

- 每个 slide 都有 `sourceRef` 指向原始素材
- 内容生成 prompt 包含素材约束
- 验证生成内容与素材的相关性

#### 2.1.2 专业语义化模板系统

| 模板名称        | 用途     | 布局特点                     |
| --------------- | -------- | ---------------------------- |
| 封面·商务简约   | 首页     | 居中标题 + 副标题 + 品牌标识 |
| 目录·简洁列表   | 目录     | 编号列表 + 章节预览          |
| 执行摘要        | 核心要点 | 3-5个卡片式要点              |
| 章节扉页        | 章节开始 | 大标题 + 章节编号            |
| 两列要点/对比   | 对比分析 | 左右分栏 + 对比标签          |
| 三支柱/三块内容 | 框架展示 | 三列卡片 + 图标              |
| 五要素框架      | 复杂框架 | 五列/五象限布局              |
| 案例卡片·三列   | 案例展示 | 三个案例卡片 + 图标          |
| 关键数据与KPI   | 数据展示 | 3-5个大数字 + 趋势指示       |
| 时间轴·横向     | 历程展示 | 横向时间轴 + 里程碑          |
| 路线图/阶段演进 | 规划展示 | 阶段箭头 + 内容卡片          |
| 结论与行动建议  | 收尾     | 核心观点 + 建议列表          |

#### 2.1.3 批量一致性操作

**Genspark 支持的批量操作**:

```
1. 全局背景色统一
   用户: "统一为深色背景"
   系统: 批量修改40页背景为 #0F172A

2. 页脚格式统一
   用户: "页码和品牌标识放右下角"
   系统: 批量设置 "第X页 | 🔷 CARI北美前沿"
   参数: { position: 'bottom-right', font: '14px', color: '#94A3B8' }

3. 布局安全区统一
   用户: "内容不要和页脚重叠"
   系统: 批量设置底部80px安全区
```

#### 2.1.4 智能迭代优化

**Genspark 的迭代能力**:

| 用户反馈                 | 系统响应                              |
| ------------------------ | ------------------------------------- |
| "P8和P10重复度很高"      | 检测重复 → 建议合并 → 删除P10，完善P8 |
| "P24 Google那页遗漏较多" | 分析素材 → 扩展为2页 → 补充遗漏内容   |
| "P38布局越界"            | 检测越界 → 调整间距 → 预留安全区      |
| "P43内容太空"            | 检测空白 → 增大字体 + 补充内容        |

### 2.2 能力差距矩阵

```
                    Genspark          Genesis            差距
素材绑定              ████████████      ░░░░░░░░░░░░      🔴 缺失
批量修改              ████████████      ░░░░░░░░░░░░      🔴 缺失
迭代建议              ████████████      ██░░░░░░░░░░      🔴 弱
专业模板              ████████████      ████████░░░░      🟡 不足
一致性控制            ████████████      ████░░░░░░░░      🟡 不足
质量检查              ████████████      ██░░░░░░░░░░      🟠 弱
内容生成              ████████████      ████████░░░░      🟡 可改进
```

---

## 三、优化目标

### 3.1 核心目标

> **让 AI Office Slides 从"能用"升级为"好用"，达到 Genspark 80%的用户体验**

### 3.2 量化指标

| 指标           | 当前值 | 目标值 | 提升幅度 |
| -------------- | ------ | ------ | -------- |
| 内容具体性评分 | 40%    | 85%    | +112%    |
| 用户迭代次数   | 5-8次  | 1-2次  | -75%     |
| 批量修改效率   | N/A    | 支持   | 新增     |
| 模板覆盖率     | 6种    | 12种   | +100%    |
| 一致性问题率   | 30%    | 5%     | -83%     |

### 3.3 用户价值

**Before（当前体验）**:

```
用户: 生成一个关于AI趋势的PPT
系统: [生成10页通用内容]
用户: 内容太空洞了，没有数据
系统: [无法有效改进]
用户: 算了，我自己写吧... 😞
```

**After（目标体验）**:

```
用户: 基于这份报告生成PPT [上传报告]
系统: [分析报告结构，生成大纲]
系统: 已识别6个章节，建议生成25页PPT，是否调整？
用户: 第三章内容太多，拆成3页
系统: [智能拆分，保持素材引用]
用户: 统一页脚格式
系统: [批量修改25页] ✅
用户: 完美！导出PPTX 🎉
```

---

## 四、功能设计

### 4.1 功能架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    AI Office Slides v2.0                        │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │  素材分析   │  │  智能规划   │  │  内容生成   │             │
│  │  服务       │──│  引擎       │──│  服务       │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│         │                │                │                     │
│         ▼                ▼                ▼                     │
│  ┌─────────────────────────────────────────────────┐           │
│  │              素材绑定层 (Source Binding)         │           │
│  │  - 章节映射  - 数据点提取  - 引用追踪            │           │
│  └─────────────────────────────────────────────────┘           │
│         │                │                │                     │
│         ▼                ▼                ▼                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │  模板系统   │  │  批量操作   │  │  质量检查   │             │
│  │  (12种)     │  │  引擎       │  │  服务       │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│         │                │                │                     │
│         ▼                ▼                ▼                     │
│  ┌─────────────────────────────────────────────────┐           │
│  │              一致性控制层 (Consistency)          │           │
│  │  - 全局样式  - 安全区管理  - 品牌规范            │           │
│  └─────────────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 功能模块详设

#### 4.2.1 【P0】素材绑定机制

**功能描述**: 将 PPT 内容生成与原始素材强绑定，确保内容有据可查。

**数据结构**:

```typescript
interface SourceAnalysis {
  id: string;
  chapters: ChapterInfo[]; // 章节结构
  keyInsights: Insight[]; // 核心洞察
  dataPoints: DataPoint[]; // 数据点（数字、百分比、日期等）
  quotes: Quote[]; // 可引用内容
  recommendations: string[]; // 建议/结论
}

interface ChapterInfo {
  id: string;
  title: string;
  level: number; // 章节层级
  content: string; // 原始内容
  summary: string; // AI 摘要
  keyPoints: string[]; // 关键要点
  dataPoints: DataPoint[]; // 本章数据点
}

interface SlideSpec {
  // ... existing fields
  sourceRef: string; // 🔑 绑定的章节ID
  sourceExcerpt: string; // 原始素材片段
  requiredDataPoints: string[]; // 必须包含的数据点
  mustNotFabricate: boolean; // 禁止臆造标记
}
```

**生成约束 Prompt**:

```
你是专业的 PPT 内容撰写专家。请基于以下原始素材生成幻灯片内容。

【原始素材】
"""
${sourceExcerpt}
"""

【必须包含的数据点】
${requiredDataPoints.join('\n')}

【生成约束】
1. 所有内容必须来源于上述素材，禁止添加素材中没有的信息
2. 必须包含列出的数据点，保持数字准确
3. 每个要点必须有具体数字、案例或事实支撑
4. 如果素材不足以支撑某个要点，用 [需补充] 标记

【输出格式】
...
```

**验证机制**:

```typescript
interface ContentValidation {
  dataPointsCovered: number; // 覆盖的数据点数
  dataPointsMissing: string[]; // 缺失的数据点
  fabricatedContent: string[]; // 可能臆造的内容
  sourceRelevance: number; // 与素材相关性 0-100
}
```

#### 4.2.2 【P0】批量操作引擎

**功能描述**: 支持对整个 PPT 进行批量样式和内容修改。

**API 设计**:

```typescript
// 批量更新接口
POST / api / ai - office / documents / { id } / batch - update;

// 请求体
interface BatchUpdateRequest {
  operation: BatchOperation;
  config: BatchConfig;
  pageRange: "all" | number[]; // 应用范围
}

type BatchOperation =
  | "update_footer" // 更新页脚
  | "update_header" // 更新页眉
  | "update_background" // 更新背景
  | "update_theme" // 更新主题
  | "update_font" // 更新字体
  | "update_safe_area" // 更新安全区
  | "update_logo"; // 更新Logo

// 页脚配置示例
interface FooterConfig {
  format: string; // "第{page}页 | {icon} {brand}"
  position: "bottom-left" | "bottom-center" | "bottom-right";
  style: {
    fontSize: number;
    fontFamily: string;
    color: string;
  };
  icon?: string; // emoji 或图标
  brand?: string; // 品牌名称
}

// 安全区配置
interface SafeAreaConfig {
  top: number;
  bottom: number;
  left: number;
  right: number;
}
```

**前端交互**:

```
┌─────────────────────────────────────────────────┐
│  全局样式设置                              [×]  │
├─────────────────────────────────────────────────┤
│                                                 │
│  页脚格式                                       │
│  ┌─────────────────────────────────────────┐   │
│  │ 第{page}页 | 🔷 {brand}                 │   │
│  └─────────────────────────────────────────┘   │
│  品牌名称: [CARI北美前沿        ]              │
│  位置: ○左下 ○居中 ●右下                      │
│  字号: [14] px   颜色: [#94A3B8]               │
│                                                 │
│  安全区                                         │
│  上: [40]px  下: [80]px  左: [40]px  右: [40]px│
│                                                 │
│  应用范围: ●全部页面 ○选中页面                 │
│                                                 │
│  [预览效果]              [应用到全部]          │
└─────────────────────────────────────────────────┘
```

#### 4.2.3 【P0】智能迭代建议

**功能描述**: 自动检测问题并提供优化建议。

**检测能力**:

```typescript
interface QualityReport {
  // 重复检测
  duplicates: {
    pages: [number, number]; // 重复的页码
    similarity: number; // 相似度 0-100
    suggestion: "merge" | "differentiate";
    mergedContent?: string; // 合并后的建议内容
  }[];

  // 布局问题
  layoutIssues: {
    page: number;
    type: "overflow" | "overlap" | "misalign" | "empty_space";
    description: string;
    autoFix?: () => void; // 自动修复函数
  }[];

  // 内容问题
  contentIssues: {
    page: number;
    type: "too_sparse" | "too_dense" | "missing_data" | "vague";
    description: string;
    suggestion: string;
  }[];

  // 一致性问题
  consistencyIssues: {
    type: "font" | "color" | "spacing" | "style";
    affectedPages: number[];
    description: string;
    autoFix?: () => void;
  }[];
}
```

**用户交互**:

```
┌─────────────────────────────────────────────────┐
│  📋 质量检查报告                          [×]  │
├─────────────────────────────────────────────────┤
│                                                 │
│  🔴 发现 3 个问题需要处理                       │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │ ⚠️ 重复内容                              │   │
│  │ P8 和 P10 内容相似度 85%                 │   │
│  │ 建议：合并到 P8，删除 P10                │   │
│  │ [查看对比] [一键合并] [忽略]             │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │ ⚠️ 布局越界                              │   │
│  │ P38 内容超出安全区，与页脚重叠           │   │
│  │ 建议：调整内容区域，预留底部 80px        │   │
│  │ [查看详情] [自动修复] [忽略]             │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │ ⚠️ 内容稀疏                              │   │
│  │ P43 内容填充率仅 35%，显得空洞           │   │
│  │ 建议：增大字体 或 补充内容               │   │
│  │ [增大字体] [AI补充内容] [忽略]           │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  [全部忽略]                    [一键修复全部]  │
└─────────────────────────────────────────────────┘
```

#### 4.2.4 【P1】专业模板系统升级

**新增模板**:

```typescript
const PROFESSIONAL_TEMPLATES = {
  // === 开篇类 ===
  cover_hero: {
    name: "封面·商务简约",
    purpose: "title",
    layout: {
      titlePosition: "center",
      subtitlePosition: "below",
      brandPosition: "bottom-right",
      backgroundType: "gradient" | "image",
    },
  },

  agenda_simple: {
    name: "目录·简洁列表",
    purpose: "agenda",
    layout: {
      style: "numbered_list",
      columns: 1,
      showPageNumbers: true,
    },
  },

  // === 内容类 ===
  exec_summary: {
    name: "执行摘要",
    purpose: "summary",
    layout: {
      style: "cards",
      cardCount: { min: 3, max: 5 },
      showIcons: true,
    },
  },

  two_column_compare: {
    name: "两列对比",
    purpose: "comparison",
    layout: {
      leftLabel: string,
      rightLabel: string,
      showVsIcon: true,
    },
  },

  three_pillars: {
    name: "三支柱框架",
    purpose: "framework",
    layout: {
      columns: 3,
      showConnectors: true,
      iconPosition: "top",
    },
  },

  framework_5: {
    name: "五要素框架",
    purpose: "framework",
    layout: {
      style: "pentagon" | "row",
      showNumbers: true,
    },
  },

  case_cards: {
    name: "案例卡片",
    purpose: "examples",
    layout: {
      cardCount: 3,
      showLogo: true,
      showMetrics: true,
    },
  },

  // === 数据类 ===
  kpi_highlights: {
    name: "关键数据",
    purpose: "statistics",
    layout: {
      metricCount: { min: 3, max: 5 },
      showTrend: true,
      showComparison: true,
    },
  },

  timeline_horizontal: {
    name: "时间轴",
    purpose: "timeline",
    layout: {
      direction: "horizontal",
      eventCount: { min: 4, max: 6 },
      showConnectors: true,
    },
  },

  roadmap: {
    name: "路线图",
    purpose: "planning",
    layout: {
      phaseCount: { min: 3, max: 5 },
      showArrows: true,
    },
  },

  // === 章节类 ===
  section_divider: {
    name: "章节扉页",
    purpose: "section_header",
    layout: {
      titleSize: "large",
      showChapterNumber: true,
      backgroundType: "accent_color",
    },
  },

  // === 收尾类 ===
  conclusion_actions: {
    name: "结论与建议",
    purpose: "closing",
    layout: {
      insightCount: 3,
      recommendationCount: { min: 5, max: 7 },
      style: "two_section",
    },
  },
};
```

**模板选择逻辑**:

```typescript
function selectTemplate(slideSpec: SlideSpec): TemplateKey {
  const { purpose, contentType, dataPoints } = slideSpec;

  // 基于目的选择
  const purposeMap = {
    title: "cover_hero",
    agenda: "agenda_simple",
    section_header: "section_divider",
    summary: "exec_summary",
    comparison: "two_column_compare",
    statistics: "kpi_highlights",
    timeline: "timeline_horizontal",
    closing: "conclusion_actions",
  };

  // 基于数据点数量调整
  if (dataPoints.length >= 3 && purpose === "content") {
    return "kpi_highlights";
  }

  // 基于内容结构调整
  if (contentType === "framework" && dataPoints.length === 3) {
    return "three_pillars";
  }
  if (contentType === "framework" && dataPoints.length === 5) {
    return "framework_5";
  }

  return purposeMap[purpose] || "two_column_compare";
}
```

#### 4.2.5 【P1】全局一致性控制

**全局样式配置**:

```typescript
interface GlobalStyleConfig {
  // 页眉配置
  header?: {
    show: boolean;
    content: string;
    position: "left" | "center" | "right";
    style: TextStyle;
  };

  // 页脚配置
  footer: {
    show: boolean;
    format: string; // "第{page}页 | {icon} {brand}"
    position: "left" | "center" | "right";
    style: TextStyle;
    icon?: string;
    brand?: string;
  };

  // 页码配置
  pageNumber: {
    show: boolean;
    format: "number" | "chinese" | "roman"; // 1, 第1页, I
    position: "header" | "footer";
  };

  // 安全区配置
  safeArea: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };

  // 品牌配置
  brand: {
    logo?: string; // Logo URL
    name: string;
    primaryColor: string;
    secondaryColor: string;
  };

  // 字体配置
  typography: {
    headingFont: string;
    bodyFont: string;
    monoFont: string;
  };
}
```

**一致性检查器**:

```typescript
class ConsistencyChecker {
  check(slides: Slide[], config: GlobalStyleConfig): ConsistencyIssue[] {
    const issues: ConsistencyIssue[] = [];

    slides.forEach((slide, index) => {
      // 检查安全区
      if (this.hasOverflow(slide, config.safeArea)) {
        issues.push({
          type: "overflow",
          page: index + 1,
          description: "内容超出安全区",
        });
      }

      // 检查字体一致性
      if (this.hasFontInconsistency(slide, config.typography)) {
        issues.push({
          type: "font",
          page: index + 1,
          description: "字体与全局配置不一致",
        });
      }

      // 检查颜色一致性
      if (this.hasColorInconsistency(slide, config.brand)) {
        issues.push({
          type: "color",
          page: index + 1,
          description: "颜色与品牌规范不一致",
        });
      }
    });

    return issues;
  }
}
```

---

## 五、技术方案

### 5.1 后端改造

#### 5.1.1 新增服务

```
backend/src/modules/ai/ai-office/ppt/
├── source-analysis.service.ts      # 🆕 素材分析服务
├── batch-operation.service.ts      # 🆕 批量操作服务
├── quality-check.service.ts        # 🆕 质量检查服务
├── consistency.service.ts          # 🆕 一致性控制服务
├── template-matcher.service.ts     # 🆕 模板匹配服务
├── slide-planning.service.ts       # 改造：增加素材绑定
├── slide-content.service.ts        # 改造：增加素材约束
└── ppt-orchestrator.service.ts     # 改造：集成新服务
```

#### 5.1.2 数据库改造

```prisma
model OfficeDocument {
  // ... existing fields

  // 🆕 素材分析结果
  sourceAnalysis    Json?       @map("source_analysis")

  // 🆕 全局样式配置
  globalStyle       Json?       @map("global_style")

  // 🆕 质量检查报告
  qualityReport     Json?       @map("quality_report")
  qualityCheckedAt  DateTime?   @map("quality_checked_at")
}

model OfficeSlide {
  // ... existing fields

  // 🆕 素材绑定
  sourceRef         String?     @map("source_ref")
  sourceExcerpt     String?     @db.Text @map("source_excerpt")
  requiredDataPoints Json?      @map("required_data_points")

  // 🆕 模板信息
  templateKey       String?     @map("template_key")
  templateConfig    Json?       @map("template_config")
}
```

#### 5.1.3 API 新增

```typescript
// 素材分析
POST /api/ai-office/documents/{id}/analyze-source
Response: SourceAnalysis

// 批量操作
POST /api/ai-office/documents/{id}/batch-update
Body: BatchUpdateRequest
Response: { updated: number, failed: number }

// 质量检查
POST /api/ai-office/documents/{id}/quality-check
Response: QualityReport

// 应用建议
POST /api/ai-office/documents/{id}/apply-suggestion
Body: { suggestionId: string, action: 'apply' | 'dismiss' }

// 全局样式
PUT /api/ai-office/documents/{id}/global-style
Body: GlobalStyleConfig
```

### 5.2 前端改造

#### 5.2.1 新增组件

```
frontend/components/ai-office/
├── GlobalStylePanel.tsx           # 🆕 全局样式面板
├── BatchOperationDialog.tsx       # 🆕 批量操作对话框
├── QualityReportPanel.tsx         # 🆕 质量报告面板
├── SourceBindingView.tsx          # 🆕 素材绑定视图
├── TemplatePicker.tsx             # 🆕 模板选择器
└── SuggestionCard.tsx             # 🆕 建议卡片
```

#### 5.2.2 状态管理

```typescript
interface SlidesEditorState {
  // ... existing

  // 🆕 素材分析
  sourceAnalysis: SourceAnalysis | null;

  // 🆕 全局样式
  globalStyle: GlobalStyleConfig;

  // 🆕 质量报告
  qualityReport: QualityReport | null;
  isCheckingQuality: boolean;

  // 🆕 批量操作
  batchOperation: {
    isOpen: boolean;
    operation: BatchOperation | null;
    selectedPages: number[];
  };
}
```

---

## 六、实施计划

### 6.1 里程碑

```
Phase 1: 素材绑定机制（1.5周）
├── Week 1 前半: 素材分析服务
├── Week 1 后半: 内容生成约束
└── Week 2 前半: 前端素材绑定视图

Phase 2: 批量操作引擎（1周）
├── Week 2 后半: 批量操作 API
└── Week 3 前半: 批量操作 UI

Phase 3: 智能迭代建议（1.5周）
├── Week 3 后半: 质量检查服务
├── Week 4 前半: 建议生成逻辑
└── Week 4 后半: 建议 UI 和交互

Phase 4: 模板系统升级（1周）
├── Week 5 前半: 新模板实现
└── Week 5 后半: 模板匹配逻辑

Phase 5: 一致性控制（0.5周）
└── Week 6 前半: 全局样式和检查

Phase 6: 集成测试和优化（0.5周）
└── Week 6 后半: E2E 测试和性能优化
```

### 6.2 任务分解

#### Phase 1: 素材绑定机制

| 任务                                  | 负责人 | 工时 | 依赖 |
| ------------------------------------- | ------ | ---- | ---- |
| 设计 SourceAnalysis 数据结构          | 后端   | 2h   | -    |
| 实现 SourceAnalysisService            | 后端   | 8h   | 1    |
| 改造 SlideContentService 增加素材约束 | 后端   | 6h   | 2    |
| 改造 PPT 生成流程集成素材分析         | 后端   | 4h   | 3    |
| 实现 SourceBindingView 组件           | 前端   | 6h   | 4    |
| 前后端联调                            | 全栈   | 4h   | 5    |

#### Phase 2: 批量操作引擎

| 任务                       | 负责人 | 工时 | 依赖 |
| -------------------------- | ------ | ---- | ---- |
| 设计批量操作 API           | 后端   | 2h   | -    |
| 实现 BatchOperationService | 后端   | 8h   | 1    |
| 实现 GlobalStylePanel      | 前端   | 6h   | 2    |
| 实现 BatchOperationDialog  | 前端   | 4h   | 3    |
| 前后端联调                 | 全栈   | 4h   | 4    |

#### Phase 3: 智能迭代建议

| 任务                        | 负责人 | 工时 | 依赖  |
| --------------------------- | ------ | ---- | ----- |
| 设计 QualityReport 数据结构 | 后端   | 2h   | -     |
| 实现重复检测算法            | 后端   | 6h   | 1     |
| 实现布局检查算法            | 后端   | 4h   | 1     |
| 实现内容检查算法            | 后端   | 4h   | 1     |
| 实现 QualityCheckService    | 后端   | 4h   | 2,3,4 |
| 实现 QualityReportPanel     | 前端   | 6h   | 5     |
| 实现 SuggestionCard         | 前端   | 4h   | 6     |
| 实现一键修复逻辑            | 全栈   | 6h   | 7     |

#### Phase 4-6: 略（按类似方式分解）

---

## 七、验收标准

### 7.1 功能验收

| 功能点   | 验收标准                   | 测试方法                  |
| -------- | -------------------------- | ------------------------- |
| 素材绑定 | 100% 的 slide 都有素材引用 | 检查数据库 sourceRef 字段 |
| 内容质量 | 数据点覆盖率 ≥ 90%         | 对比生成内容与素材数据点  |
| 批量修改 | 40页 PPT 批量修改 < 3秒    | 性能测试                  |
| 质量检查 | 检测出 90% 的已知问题      | 准备问题样本，测试召回率  |
| 一键修复 | 修复成功率 ≥ 85%           | 对检测问题执行修复并验证  |
| 模板匹配 | 模板匹配准确率 ≥ 80%       | 专家评估                  |

### 7.2 性能验收

| 指标                 | 目标值 |
| -------------------- | ------ |
| 素材分析（10万字）   | < 30秒 |
| 大纲生成（40页）     | < 20秒 |
| 单页内容生成         | < 5秒  |
| 批量样式修改（40页） | < 3秒  |
| 质量检查（40页）     | < 10秒 |

### 7.3 用户体验验收

- [ ] 用户可以上传原始报告并生成高质量 PPT
- [ ] 用户可以一键统一页脚格式
- [ ] 用户可以看到质量问题并一键修复
- [ ] 用户迭代修改次数减少 50% 以上
- [ ] 用户满意度评分 ≥ 4.0/5.0

---

## 八、风险与应对

| 风险               | 可能性 | 影响 | 应对措施                           |
| ------------------ | ------ | ---- | ---------------------------------- |
| 素材分析耗时过长   | 中     | 高   | 分块处理、缓存机制、异步分析       |
| 内容质量提升不明显 | 中     | 高   | 迭代优化 prompt、增加人工评估反馈  |
| 批量操作性能问题   | 低     | 中   | 数据库批量更新优化、前端虚拟滚动   |
| 模板匹配准确率低   | 中     | 中   | 增加用户手动选择、收集反馈优化算法 |

---

## 九、附录

### 附录A: Genspark 工作流完整日志

参见 `debug/info.txt`

### 附录B: 现有 AI Office 代码分析

参见 `docs/architecture/ai-office-analysis.md`

### 附录C: 专业 PPT 设计规范

参见 `docs/design/ppt-design-guidelines.md`

---

**文档变更记录**:

| 版本 | 日期       | 变更内容 | 作者     |
| ---- | ---------- | -------- | -------- |
| v1.0 | 2024-12-25 | 初始版本 | 产品团队 |
