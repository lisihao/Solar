# 报告图文一体化架构重构方案

> 版本: 1.0
> 日期: 2025-01-27
> 状态: 待执行

## 一、问题定义

### 1.1 当前问题

| 问题       | 现象                                       | 根因                           |
| ---------- | ------------------------------------------ | ------------------------------ |
| 内容不一致 | 连续视图 1,705 字符，章节视图 209,527 字符 | `fullReport` 是 AI 压缩重写版  |
| 图表缺失   | 报告缺乏图表支撑                           | 图表在合成阶段生成，与内容脱节 |
| 图文脱节   | 图表与正文内容关联弱                       | 图表不在研究员写作时生成       |
| 数据可信度 | AI 可能编造图表数据                        | 没有引用原始证据中的图表       |

### 1.2 用户需求

1. **图文并茂** - 报告要有图表支撑文字内容
2. **两种视图一致** - 连续视图和章节视图显示相同完整内容
3. **图表在正文中** - 图表嵌入正文，不堆在头部或尾部
4. **引用原始图表** - 优先使用证据中的原始图表，而非 AI 生成

## 二、目标架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Phase 1: 证据收集阶段                              │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ DataSourceRouter                                                   │  │
│  │ ├── 获取网页/PDF 内容                                               │  │
│  │ ├── 提取图片 URL + caption                                         │  │
│  │ └── 过滤非图表图片（logo、icon 等）                                  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
│                                    ▼                                     │
│  TopicEvidence.metadata.extractedFigures: [                             │
│    { imageUrl, caption, type, alt }                                     │
│  ]                                                                       │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Phase 2: 维度研究阶段                              │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 研究员 AI                                                          │  │
│  │ 输入:                                                              │  │
│  │ ├── 证据内容                                                        │  │
│  │ └── 可用图表列表（从证据中提取）                                      │  │
│  │                                                                     │  │
│  │ 输出:                                                              │  │
│  │ ├── detailedContent: 完整文字（2000-4000字）                         │  │
│  │ │     └── 包含 <!-- figure:1:0 --> 占位符                           │  │
│  │ ├── figureReferences: 引用的原始图表                                 │  │
│  │ └── generatedCharts: AI 补充生成的图表（当原始不足时）                 │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
│                                    ▼                                     │
│  DimensionAnalysis.dataPoints: {                                        │
│    detailedContent,                                                      │
│    figureReferences,                                                     │
│    generatedCharts                                                       │
│  }                                                                       │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Phase 3: 报告合成阶段                              │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 职责（只做）:                                                       │  │
│  │ ├── 生成执行摘要、前言、目录                                         │  │
│  │ ├── 生成跨维度关联分析（新章节）                                      │  │
│  │ ├── 生成风险评估（新章节）                                           │  │
│  │ ├── 生成战略建议（新章节）                                           │  │
│  │ └── 拼接 detailedContent → fullReport                               │  │
│  │                                                                     │  │
│  │ 不做:                                                               │  │
│  │ └── ❌ 不重写维度章节内容                                            │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
│                                    ▼                                     │
│  TopicReport: {                                                         │
│    fullReport: "完整 Markdown（~200,000 字符）",                         │
│    charts: [...figureReferences, ...generatedCharts]                    │
│  }                                                                       │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Phase 4: 前端渲染                                  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ ReportEditor / ChapterizedReportView                               │  │
│  │ ├── 解析 <!-- figure:x:y --> 占位符                                 │  │
│  │ ├── 渲染引用图表（FigureReference 组件）                             │  │
│  │ ├── 渲染生成图表（ChartRenderer 组件）                               │  │
│  │ └── 图片加载失败时显示占位符                                          │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

## 三、数据结构设计

### 3.1 TopicEvidence 扩展

```typescript
// 在 metadata JSON 字段中存储提取的图表
interface EvidenceMetadata {
  // 现有字段...

  // 新增：提取的图表列表
  extractedFigures?: Array<{
    imageUrl: string; // 图片 URL
    caption: string; // 图片标题/说明
    type: "chart" | "table" | "diagram" | "photo";
    alt?: string; // alt 文本
    width?: number; // 图片宽度
    height?: number; // 图片高度
  }>;
}
```

### 3.2 DimensionAnalysis.dataPoints 扩展

```typescript
interface DataPoints {
  // 现有字段
  trends: Array<{...}>;
  challenges: Array<{...}>;
  opportunities: Array<{...}>;
  confidenceLevel: string;
  detailedContent: string;

  // 新增：引用的原始图表
  figureReferences?: Array<{
    id: string;                     // 图表 ID，用于占位符匹配
    evidenceCitationIndex: number;  // 来源证据编号 [1], [2]
    figureIndex: number;            // 证据中的第几个图表
    imageUrl: string;               // 图片 URL
    caption: string;                // 图表标题
    position: string;               // 位置：after_paragraph_N
    source: string;                 // 来源说明
  }>;

  // 新增：AI 补充生成的图表（当原始图表不足时）
  generatedCharts?: Array<{
    id: string;
    type: "line" | "bar" | "pie" | "area" | "radar";
    title: string;
    position: string;
    data: Array<{ label: string; value: number; series?: string }>;
    source: string;
  }>;
}
```

### 3.3 TopicReport.charts 合并格式

```typescript
interface ReportChart {
  id: string;
  chartType: "reference" | "generated"; // 区分引用图表和生成图表

  // 引用图表字段
  imageUrl?: string;
  caption?: string;
  evidenceCitationIndex?: number;

  // 生成图表字段
  type?: "line" | "bar" | "pie" | "area" | "radar";
  title?: string;
  data?: Array<{ label: string; value: number; series?: string }>;

  // 公共字段
  position: string;
  source: string;
  dimensionId: string;
  dimensionName: string;
}
```

## 四、详细实施计划

### Phase 1: 证据收集阶段 - 图表提取

#### 1.1 创建 FigureExtractorService

**文件**: `backend/src/modules/ai-app/research/topic-research/services/figure-extractor.service.ts`

**功能**:

- 从 HTML 内容中提取 `<img>` 和 `<figure>` 标签
- 过滤非图表图片（logo、icon、avatar、广告等）
- 分类图表类型（chart、table、diagram、photo）
- 解析相对 URL 为绝对 URL

#### 1.2 修改 DataSourceRouterService

**文件**: `backend/src/modules/ai-app/research/topic-research/services/data-source-router.service.ts`

**改动**:

- 在获取证据内容后，调用 FigureExtractorService 提取图表
- 将提取的图表存储到返回结果中

#### 1.3 修改证据保存逻辑

**文件**: `backend/src/modules/ai-app/research/topic-research/services/dimension-research.service.ts`

**改动**:

- 保存证据时，将 extractedFigures 存入 metadata 字段

---

### Phase 2: 维度研究阶段 - 图表引用

#### 2.1 修改维度研究 Prompt

**文件**: `backend/src/modules/ai-app/research/topic-research/prompts/dimension-research.prompt.ts`

**改动**:

- 增加「可用图表列表」输入
- 增加图表引用规范
- 修改输出格式，增加 figureReferences 和 generatedCharts

#### 2.2 修改 formatEvidenceForPrompt

**文件**: `backend/src/modules/ai-app/research/topic-research/prompts/dimension-research.prompt.ts`

**改动**:

- 在格式化证据时，包含该证据的可用图表列表

#### 2.3 修改 DimensionResearchService

**文件**: `backend/src/modules/ai-app/research/topic-research/services/dimension-research.service.ts`

**改动**:

- 修改 parseAIResponse 解析 figureReferences 和 generatedCharts
- 修改 validateAndNormalizeResponse 标准化新字段

#### 2.4 修改类型定义

**文件**: `backend/src/modules/ai-app/research/topic-research/types/research.types.ts`

**改动**:

- 扩展 DimensionAnalysisResult 接口
- 扩展 AIDimensionAnalysisResponse 接口

---

### Phase 3: 报告合成阶段 - 拼接而非重写

#### 3.1 创建 SupplementaryContentService

**文件**: `backend/src/modules/ai-app/research/topic-research/services/supplementary-content.service.ts`

**功能**:

- 只生成补充内容（执行摘要、前言、跨维度分析等）
- 不重写维度章节内容

#### 3.2 修改 ReportSynthesisService

**文件**: `backend/src/modules/ai-app/research/topic-research/services/report-synthesis.service.ts`

**改动**:

- 新增 `buildFullReportFromDimensions()` 方法 - 直接使用 detailedContent
- 新增 `collectAllCharts()` 方法 - 合并所有图表
- 修改 `synthesizeReport()` - 调用新逻辑
- 新增 `rebuildFullReport()` - 增量更新支持

#### 3.3 修改报告合成 Prompt

**文件**: `backend/src/modules/ai-app/research/topic-research/prompts/report-synthesis.prompt.ts`

**改动**:

- 简化 Prompt，只要求生成补充内容
- 移除重写章节的要求

---

### Phase 4: 前端渲染

#### 4.1 创建 FigureRenderer 组件

**文件**: `frontend/components/ai-research/reports/FigureRenderer.tsx`

**功能**:

- 渲染引用图表（显示图片 + caption）
- 处理图片加载失败
- 支持点击放大

#### 4.2 修改 ReportEditor

**文件**: `frontend/components/ai-research/reports/ReportEditor.tsx`

**改动**:

- 简化 markdownContent 逻辑
- 解析 `<!-- figure:x:y -->` 占位符
- 渲染图表

#### 4.3 修改 ChapterizedReportView

**文件**: `frontend/components/ai-research/reports/ChapterizedReportView.tsx`

**改动**:

- 统一使用 detailedContent + figureReferences
- 渲染图表

---

## 五、任务分解

### Task 1: 图表提取服务 (Phase 1)

- 1.1 创建 FigureExtractorService
- 1.2 修改 DataSourceRouterService 集成图表提取
- 1.3 修改证据保存逻辑

### Task 2: 维度研究 Prompt 改造 (Phase 2.1)

- 2.1 修改 DIMENSION_RESEARCH_SYSTEM_PROMPT
- 2.2 修改 DIMENSION_RESEARCH_USER_PROMPT_TEMPLATE
- 2.3 修改 formatEvidenceForPrompt 包含图表信息

### Task 3: 维度研究服务改造 (Phase 2.2)

- 3.1 修改类型定义 (research.types.ts)
- 3.2 修改 parseAIResponse 解析新字段
- 3.3 修改 validateAndNormalizeResponse

### Task 4: 报告合成改造 (Phase 3)

- 4.1 新增 buildFullReportFromDimensions 方法
- 4.2 新增 collectAllCharts 方法
- 4.3 修改 synthesizeReport 流程
- 4.4 简化报告合成 Prompt

### Task 5: 前端渲染改造 (Phase 4)

- 5.1 创建 FigureRenderer 组件
- 5.2 修改 ReportEditor
- 5.3 修改 ChapterizedReportView

### Task 6: 测试与验证

- 6.1 单元测试
- 6.2 集成测试
- 6.3 端到端验证

---

## 六、风险与兼容性

### 6.1 向后兼容

```typescript
// 处理旧数据（没有 figureReferences）
const dataPoints = da.dataPoints as DataPointsType;
const content =
  dataPoints.detailedContent ||
  this.buildContentFromLegacyFields(dataPoints) ||
  da.summary;
```

### 6.2 图片加载失败处理

```typescript
// 前端降级显示
{imageError ? (
  <div className="bg-gray-100 p-8 text-center">
    <ImageOff className="h-12 w-12 mx-auto" />
    <p>{figure.caption}</p>
    <a href={figure.imageUrl} target="_blank">查看原图</a>
  </div>
) : (
  <img src={figure.imageUrl} onError={() => setImageError(true)} />
)}
```

### 6.3 跨域图片问题

- 使用后端代理获取图片
- 或者将图片下载到自有存储

---

## 七、预期结果

| 指标           | 当前     | 目标         |
| -------------- | -------- | ------------ |
| 连续视图字符数 | 1,705    | ~200,000     |
| 章节视图字符数 | 209,527  | ~200,000     |
| 两视图内容一致 | ❌       | ✅           |
| 图表数量/报告  | 0-3      | 5-15         |
| 图表来源       | AI 生成  | 原始引用优先 |
| 图表位置       | 章节末尾 | 正文中嵌入   |
| 图表可信度     | 低       | 高           |
