# Slides Engine v3.0 - 产品架构设计

> 结合 Tome、Gamma、Beautiful.ai 业界最佳实践，重新设计 AI PPT 生成引擎

**版本**: 2.0
**更新日期**: 2025-12-29
**作者**: 产品团队

---

## 一、业界最佳实践分析

### 1.1 Tome - 叙事优先架构

**核心理念**: "A deck is not just a collection of slides; it's a story meant to persuade, inform, or inspire."

| 能力         | 实现方式                                                 |
| ------------ | -------------------------------------------------------- |
| 叙事结构生成 | 输入 prompt → 生成完整叙事结构（标题、大纲、分页、布局） |
| 智能文档解析 | 处理 25 页文档，识别关键点重要性并适当展示               |
| 逻辑连贯性   | 每页逻辑连接，形成无缝叙事进展                           |
| 非线性布局   | 支持分支叙事流（如：技术路线 vs ROI路线）                |

### 1.2 Beautiful.ai - 智能设计系统

**核心理念**: "Smart Slides that adapt as you add content"

| 能力        | 实现方式                        |
| ----------- | ------------------------------- |
| 响应式模板  | 模板随内容量自动调整布局        |
| 品牌约束    | 设置品牌 Kit 后全局锁定设计规则 |
| DesignerBot | 从 prompt 直接生成设计方案      |

### 1.3 Gamma - 迭代式协作

**核心理念**: "AI-native presentation generator with iterative refinements"

| 能力       | 实现方式                              |
| ---------- | ------------------------------------- |
| 完整生成   | 一次生成完整 deck，自动对齐内容和视觉 |
| 迭代优化   | 支持持续对话式修改                    |
| Web-native | 输出为活的网页链接，非静态文件        |

### 1.4 核心差异总结

```
传统 AI PPT 工具:
  用户输入 → 模板选择 → 内容填充 → 输出

业界最佳实践 (Tome):
  用户输入 → 理解意图 → 叙事结构规划 → 页面分配 → 模板匹配 → 内容适配 → 一致性检查 → 输出
            ↑                                                              ↓
            └──────────────────── 迭代优化 ←────────────────────────────────┘
```

---

## 二、产品目标与原则

### 2.1 产品目标

1. **理解用户真实意图** - 不只是处理输入，而是理解"用户想通过这份 PPT 达成什么"
2. **生成有说服力的叙事** - 每份 PPT 都是一个完整的故事，有起承转合
3. **保证专业视觉品质** - 输出媲美专业设计师的视觉效果
4. **支持灵活迭代** - 用户可以对话式修改，而非推倒重来

### 2.2 设计原则

| 原则         | 说明                                   |
| ------------ | -------------------------------------- |
| **叙事优先** | 先规划故事结构，再选择模板和填充内容   |
| **语义理解** | 基于内容语义选择模板，而非简单类型映射 |
| **全局一致** | 风格、语言、术语、视觉全局统一         |
| **智能适配** | 模板随内容量自动调整，无需手动调整     |
| **可扩展**   | 用户可添加自定义模板，持续丰富模板库   |

---

## 三、系统架构

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Slides Engine v3.0                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Layer 1: 意图理解层                           │   │
│  │  ┌───────────────────┐  ┌───────────────────────────────────┐   │   │
│  │  │ IntentAnalyzer    │  │ DocumentParser                    │   │   │
│  │  │ 理解用户真实目的   │  │ 解析文档结构，识别关键点重要性    │   │   │
│  │  └───────────────────┘  └───────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    ↓                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Layer 2: 叙事规划层                           │   │
│  │  ┌───────────────────┐  ┌───────────────────────────────────┐   │   │
│  │  │ NarrativePlanner  │  │ StorylineGenerator                │   │   │
│  │  │ 规划故事结构       │  │ 生成叙事线（起承转合）            │   │   │
│  │  └───────────────────┘  └───────────────────────────────────┘   │   │
│  │  ┌───────────────────┐  ┌───────────────────────────────────┐   │   │
│  │  │ PageAllocator     │  │ RhythmController                  │   │   │
│  │  │ 分配页面内容       │  │ 控制信息密度节奏（张弛有度）      │   │   │
│  │  └───────────────────┘  └───────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    ↓                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Layer 3: 模板调度层                           │   │
│  │  ┌───────────────────┐  ┌───────────────────────────────────┐   │   │
│  │  │ TemplateMatcher   │  │ ContextAwareSelector              │   │   │
│  │  │ 语义匹配模板       │  │ 上下文感知（避免重复、保证多样）  │   │   │
│  │  └───────────────────┘  └───────────────────────────────────┘   │   │
│  │  ┌─────────────────────────────────────────────────────────┐    │   │
│  │  │                  Template Library                        │    │   │
│  │  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │    │   │
│  │  │  │ 内置模板 │ │ 组织模板 │ │ 用户模板 │ │ 市场模板 │   │    │   │
│  │  │  │  30+    │ │ 可扩展  │ │ 可扩展  │ │ 可下载  │   │    │   │
│  │  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │    │   │
│  │  └─────────────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    ↓                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Layer 4: 内容生成层                           │   │
│  │  ┌───────────────────┐  ┌───────────────────────────────────┐   │   │
│  │  │ ContentAdapter    │  │ VisualGenerator                   │   │   │
│  │  │ 适配内容到模板    │  │ 生成图表、图像、图标              │   │   │
│  │  └───────────────────┘  └───────────────────────────────────┘   │   │
│  │  ┌───────────────────┐                                          │   │
│  │  │ HtmlRenderer      │                                          │   │
│  │  │ 渲染最终 HTML     │                                          │   │
│  │  └───────────────────┘                                          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    ↓                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Layer 5: 一致性保障层                         │   │
│  │  ┌───────────────────┐  ┌───────────────────────────────────┐   │   │
│  │  │ StyleEnforcer     │  │ TerminologyUnifier                │   │   │
│  │  │ 强制风格一致      │  │ 统一术语表达                      │   │   │
│  │  └───────────────────┘  └───────────────────────────────────┘   │   │
│  │  ┌───────────────────┐  ┌───────────────────────────────────┐   │   │
│  │  │ TransitionChecker │  │ QualityValidator                  │   │   │
│  │  │ 检查页面过渡      │  │ 验证输出质量                      │   │   │
│  │  └───────────────────┘  └───────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 数据流

```
用户输入
    │
    ├── 需求描述: "为投资人做一份公司介绍 PPT"
    ├── 素材文档: 公司介绍.docx (15页)
    └── 偏好设置: 风格=专业, 页数=15, 受众=投资人
            │
            ▼
┌─────────────────────────────────────────────────────────┐
│  IntentAnalyzer                                         │
│  输出: {                                                │
│    purpose: "融资路演",                                  │
│    audience: "投资人",                                   │
│    tone: "专业自信",                                     │
│    keyMessage: "公司值得投资",                           │
│    expectedOutcome: "获得投资意向"                       │
│  }                                                      │
└─────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────┐
│  DocumentParser                                         │
│  输出: {                                                │
│    sections: [                                          │
│      { title: "公司简介", importance: 0.8, ... },       │
│      { title: "核心团队", importance: 0.9, ... },       │
│      { title: "产品介绍", importance: 0.95, ... },      │
│      { title: "市场分析", importance: 0.85, ... },      │
│      { title: "财务数据", importance: 0.9, ... },       │
│      ...                                                │
│    ],                                                   │
│    keyPoints: ["ARR 增长 300%", "市场份额第一", ...],   │
│    dataPoints: [{ type: "chart", data: ... }, ...],     │
│  }                                                      │
└─────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────┐
│  NarrativePlanner                                       │
│  输出: {                                                │
│    storyline: {                                         │
│      opening: ["封面", "目录", "核心价值主张"],          │
│      context: ["市场机会", "行业痛点"],                  │
│      solution: ["产品介绍", "技术壁垒", "差异化优势"],   │
│      proof: ["客户案例", "财务数据", "增长曲线"],        │
│      team: ["核心团队", "顾问团队"],                     │
│      closing: ["融资计划", "里程碑", "联系方式"]         │
│    },                                                   │
│    pageCount: 15,                                       │
│    rhythmPattern: "高-中-高-中-高" // 信息密度节奏       │
│  }                                                      │
└─────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────┐
│  PageAllocator + TemplateMatcher                        │
│  输出: [                                                │
│    { page: 1, content: "封面", template: "N-001", ... },│
│    { page: 2, content: "目录", template: "S-001", ... },│
│    { page: 3, content: "价值主张", template: "C-008",...}│
│    ...                                                  │
│  ]                                                      │
└─────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────┐
│  ContentAdapter + HtmlRenderer                          │
│  输出: [                                                │
│    { page: 1, html: "<div>...</div>", ... },            │
│    { page: 2, html: "<div>...</div>", ... },            │
│    ...                                                  │
│  ]                                                      │
└─────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────┐
│  ConsistencyEngine                                      │
│  输出: {                                                │
│    pages: [...],  // 调整后的页面                       │
│    report: {                                            │
│      styleConsistency: true,                            │
│      terminologyUnified: true,                          │
│      transitionsSmooth: true,                           │
│    }                                                    │
│  }                                                      │
└─────────────────────────────────────────────────────────┘
            │
            ▼
      最终 PPT 输出
```

---

## 四、核心模块设计

### 4.1 意图理解 (IntentAnalyzer)

**目标**: 理解用户真正想要什么，而非字面需求

```typescript
interface IntentAnalysis {
  // 演示目的
  purpose: "inform" | "persuade" | "instruct" | "inspire" | "report";

  // 目标受众
  audience: {
    type: string; // "投资人" | "客户" | "内部团队" | "公众"
    expertise: string; // "专家" | "普通" | "新手"
    expectations: string[];
  };

  // 语气风格
  tone: "formal" | "professional" | "casual" | "inspiring" | "analytical";

  // 核心信息
  keyMessage: string; // 一句话总结要传达的核心

  // 期望结果
  expectedOutcome: string; // 听众看完后应该做什么/想什么

  // 约束条件
  constraints: {
    timeLimit?: number; // 演讲时长
    pageLimit?: number; // 页数限制
    brandGuidelines?: string;
  };
}
```

**提示词设计要点**:

- 使用追问策略，而非一次性理解
- 参考 Tome 的"理解文档关键点重要性"能力
- 输出结构化意图分析

### 4.2 叙事规划 (NarrativePlanner)

**目标**: 像专业演讲稿撰写人一样规划故事结构

```typescript
interface NarrativePlan {
  // 故事线结构
  storyline: {
    hook: string[]; // 开场钩子（抓住注意力）
    context: string[]; // 背景铺垫（建立共识）
    tension: string[]; // 制造张力（提出问题/挑战）
    resolution: string[]; // 解决方案（核心内容）
    proof: string[]; // 证据支撑（数据/案例）
    call_to_action: string[]; // 行动号召（结尾）
  };

  // 页面分配
  pageAllocation: PageAssignment[];

  // 信息密度节奏
  rhythmPattern: ("high" | "medium" | "low")[];

  // 情感曲线
  emotionalArc: {
    page: number;
    emotion: "curiosity" | "concern" | "hope" | "confidence" | "urgency";
  }[];
}
```

**叙事结构模式库**:

| 模式      | 结构                      | 适用场景 |
| --------- | ------------------------- | -------- |
| 问题-解决 | 痛点 → 方案 → 证据 → 行动 | 销售提案 |
| 旅程叙事  | 过去 → 现在 → 未来        | 公司介绍 |
| 金字塔    | 结论 → 论点1/2/3 → 总结   | 咨询报告 |
| 对比      | A vs B → 分析 → 推荐      | 方案对比 |
| 教学      | 概念 → 原理 → 示例 → 练习 | 培训材料 |

### 4.3 模板匹配 (TemplateMatcher)

**目标**: 基于语义而非类型选择最佳模板

```typescript
interface TemplateMatchingContext {
  // 当前页内容
  pageContent: {
    topic: string;
    contentType: "narrative" | "data" | "list" | "comparison" | "visual";
    dataPoints: number;
    keyMessage: string;
  };

  // 上下文
  previousPages: TemplateSelection[]; // 前面用了什么模板
  nextPageHint: string; // 下一页预计内容
  positionInStory: "opening" | "middle" | "closing";

  // 全局约束
  globalStyle: GlobalStyleGuide;
  usedTemplates: string[]; // 已使用的模板（避免重复）
}

interface TemplateMatchResult {
  recommended: {
    templateId: string;
    confidence: number;
    reason: string;
  };
  alternatives: {
    templateId: string;
    confidence: number;
    reason: string;
  }[];
}
```

**匹配算法权重**:

| 因素         | 权重 | 说明                         |
| ------------ | ---- | ---------------------------- |
| 内容语义匹配 | 30%  | 内容关键词 vs 模板适用场景   |
| 容量适配     | 20%  | 内容量 vs 模板容量           |
| 叙事位置     | 15%  | 开场/中间/结尾适合的模板不同 |
| 上下文兼容   | 15%  | 与前后页的视觉连贯性         |
| 多样性       | 10%  | 避免连续使用相同/相似模板    |
| 情感匹配     | 10%  | 模板调性 vs 当前情感目标     |

### 4.4 一致性引擎 (ConsistencyEngine)

**目标**: 保证整份 PPT 的专业一致性

```typescript
interface GlobalStyleGuide {
  // 视觉一致性
  visual: {
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    cardStyle: "bordered" | "filled" | "minimal";
    borderRadius: "none" | "small" | "medium" | "large";
  };

  // 排版一致性
  typography: {
    titleStyle: "bold" | "light";
    titleCase: "sentence" | "title" | "upper";
    bodyLineHeight: number;
    bulletStyle: "•" | "→" | "✓" | "number";
  };

  // 语言一致性
  language: {
    tone: "formal" | "professional" | "casual";
    personPerspective: "first" | "third"; // "我们" vs "公司"
    terminology: Record<string, string>; // 术语表
    avoidWords: string[]; // 禁用词
  };

  // 结构一致性
  structure: {
    headerFormat: string; // 页面标题格式
    footerFormat: string; // 页脚格式
    pageNumbering: boolean;
    logoPosition: "none" | "top-left" | "top-right" | "bottom-right";
  };
}

interface ConsistencyCheck {
  passed: boolean;
  issues: {
    page: number;
    type: "visual" | "typography" | "language" | "structure";
    severity: "error" | "warning";
    description: string;
    suggestion: string;
  }[];
  autoFixes: {
    page: number;
    type: string;
    before: string;
    after: string;
  }[];
}
```

---

## 五、模板库设计

### 5.1 分类体系

**按设计意图分类，而非页面类型**:

```
Template Library
├── Narrative (叙事型) - 讲故事、建立背景
│   ├── N-001 封面-标准
│   ├── N-002 封面-图文
│   ├── N-003 问题引入
│   ├── N-004 背景说明
│   └── N-005 引用/洞察
│
├── Structural (结构型) - 展示框架、流程
│   ├── S-001 目录-双列
│   ├── S-002 章节分隔
│   ├── S-003 三支柱
│   ├── S-004 四支柱
│   ├── S-005 五支柱
│   ├── S-006 时间线-横向
│   ├── S-007 时间线-卡片
│   ├── S-008 流程步骤
│   └── S-009 层级金字塔
│
├── Data (数据型) - 展示数据、指标
│   ├── D-001 大数字
│   ├── D-002 数据仪表盘
│   ├── D-003 趋势图表
│   ├── D-004 对比双栏
│   ├── D-005 对比表格
│   └── D-006 排名列表
│
├── Content (内容型) - 详细说明、列表
│   ├── C-001 左图右文
│   ├── C-002 左文右图
│   ├── C-003 要点列表
│   ├── C-004 卡片网格-2
│   ├── C-005 卡片网格-3
│   ├── C-006 卡片网格-4
│   └── C-007 案例详情
│
└── Action (行动型) - 建议、总结、号召
    ├── A-001 建议-三栏
    ├── A-002 风险机会
    ├── A-003 核心结论
    ├── A-004 下一步
    └── A-005 感谢页
```

### 5.2 模板元数据

```typescript
interface TemplateMetadata {
  // 基础信息
  id: string; // "S-003"
  name: string; // "三支柱"
  category: TemplateCategory; // "structural"

  // 语义匹配关键词
  keywords: string[]; // ["核心", "要素", "支柱", "三个", "基础"]
  useCases: string[]; // ["展示3个核心战略", "说明3个关键因素"]

  // 内容规格
  contentSpec: {
    minBlocks: number; // 最少内容块
    maxBlocks: number; // 最多内容块
    idealBlocks: number; // 理想内容块数量
    blockTypes: ("title" | "text" | "data" | "list" | "image")[];
  };

  // 叙事位置适配
  positionFit: {
    opening: number; // 0-1，适合开场的程度
    middle: number;
    closing: number;
  };

  // 上下文兼容性
  compatibility: {
    goodBefore: string[]; // 适合放在这些模板前面
    goodAfter: string[]; // 适合放在这些模板后面
    avoidNear: string[]; // 避免与这些模板相邻
  };

  // 情感调性
  tone: "positive" | "neutral" | "analytical" | "warning" | "inspiring";

  // 视觉特征
  visual: {
    complexity: "simple" | "moderate" | "complex";
    dominantElement: "text" | "data" | "image" | "chart" | "mixed";
    whitespace: "compact" | "balanced" | "spacious";
  };
}
```

### 5.3 扩展性设计

```
┌─────────────────────────────────────────────────────────────┐
│                    Template Sources                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  优先级: 用户模板 > 组织模板 > 市场模板 > 内置模板          │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  内置模板   │  │  组织模板   │  │  用户模板           │ │
│  │             │  │             │  │                     │ │
│  │  30+ 模板   │  │  管理员上传  │  │  用户自定义         │ │
│  │  代码内置   │  │  组织共享    │  │  私有/可发布        │ │
│  │  只读       │  │  可修改      │  │  完全可控           │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
│         │                │                    │             │
│         └────────────────┼────────────────────┘             │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Template Registry (统一索引)            │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**用户模板创建流程**:

1. **从示例创建** - 选择已有 PPT 页面保存为模板
2. **从代码创建** - 上传 HTML + 元数据 JSON
3. **可视化编辑** - 模板编辑器（拖拽式）
4. **Fork 已有** - 基于现有模板修改

---

## 六、提示词工程

### 6.1 提示词设计原则

参考业界最佳实践（[OpenAI Prompt Engineering Guide](https://platform.openai.com/docs/guides/prompt-engineering)）:

| 原则                  | 应用                             |
| --------------------- | -------------------------------- |
| **Few-shot Learning** | 每个 Skill 提供 2-3 个优质示例   |
| **结构化输出**        | 所有输出使用 JSON 格式           |
| **自我评估**          | 要求 LLM 在输出前评估质量 (1-10) |
| **分步思考**          | Chain-of-Thought，先分析再输出   |
| **负面示例**          | 明确说明"不要做什么"             |

### 6.2 核心 Skill 提示词框架

```
每个 Skill 的提示词结构:

1. 角色定义
   "你是一位资深的 [角色]，擅长 [能力]..."

2. 任务描述
   "你的任务是 [具体任务]..."

3. 输入说明
   "你将收到以下输入: ..."

4. 思考过程
   "请按以下步骤思考:
    Step 1: ...
    Step 2: ...
    Step 3: ..."

5. 输出格式
   "请以 JSON 格式输出:
    {
      "analysis": "你的分析过程",
      "confidence": 0-10,
      "result": { ... }
    }"

6. 质量标准
   "优秀输出的标准:
    - ...
    - ..."

7. 负面示例
   "请避免:
    - ...
    - ..."

8. Few-shot 示例
   "示例 1: ..."
   "示例 2: ..."
```

---

## 七、实施路线图

### Phase 1: 基础重构 (Week 1-2)

- [ ] 重新设计核心接口 (IntentAnalysis, NarrativePlan, etc.)
- [ ] 实现 IntentAnalyzer 模块
- [ ] 实现 NarrativePlanner 模块
- [ ] 创建 30+ 内置模板（含完整元数据）

### Phase 2: 智能匹配 (Week 3)

- [ ] 实现 TemplateMatcher 语义匹配算法
- [ ] 实现上下文感知选择
- [ ] 实现多样性保证逻辑

### Phase 3: 一致性保障 (Week 4)

- [ ] 实现 GlobalStyleGuide 生成
- [ ] 实现 ConsistencyEngine 检查逻辑
- [ ] 实现自动修复能力

### Phase 4: 扩展能力 (Week 5-6)

- [ ] 数据库模型支持自定义模板
- [ ] 模板管理 API
- [ ] 模板编辑器前端

### Phase 5: 优化迭代 (Week 7+)

- [ ] 收集用户反馈
- [ ] 优化提示词
- [ ] 扩充模板库
- [ ] A/B 测试

---

## 八、成功指标

| 指标           | 目标               | 测量方式           |
| -------------- | ------------------ | ------------------ |
| 生成质量       | 用户满意度 ≥ 4.2/5 | 用户评分           |
| 叙事连贯性     | 逻辑评分 ≥ 8/10    | AI 自评 + 人工抽检 |
| 一致性         | 风格一致性 ≥ 95%   | 自动检测           |
| 生成速度       | 18 页 ≤ 90 秒      | 性能监控           |
| 模板匹配准确率 | ≥ 85%              | A/B 测试对比       |

---

**文档状态**: 设计中
**下一步**: 与技术团队评审，确定实施细节

---

_参考资料_:

- [Tome AI: Revolutionizing Presentation Making](https://tech-now.io/en/blogs/tome-ai-revolutionizing-presentation-making-with-ai-storytelling)
- [OpenAI Prompt Engineering Guide](https://platform.openai.com/docs/guides/prompt-engineering)
- [DAIR.AI Prompt Engineering Guide](https://www.promptingguide.ai/)
