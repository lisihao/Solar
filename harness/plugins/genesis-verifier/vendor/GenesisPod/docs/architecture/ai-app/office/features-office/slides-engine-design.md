# Slides Engine v3.0 设计方案

> 基于 Genspark 深度分析，重构 AI Office Slides 生成引擎

**版本**: 3.0
**创建日期**: 2025-12-28
**状态**: Draft
**作者**: Claude Code (基于 Genspark 逆向分析)

---

## 目录

1. [执行摘要](#1-执行摘要)
2. [Genspark 分析总结](#2-genspark-分析总结)
3. [系统架构设计](#3-系统架构设计)
4. [五大核心技能](#4-五大核心技能)
5. [多模型协作架构](#5-多模型协作架构)
6. [检查点与版本管理](#6-检查点与版本管理)
7. [前端 UI 设计](#7-前端-ui-设计)
8. [页面模板规范](#8-页面模板规范)
9. [实施路线图](#9-实施路线图)
10. [附录](#10-附录)

---

## 1. 执行摘要

### 1.1 项目背景

当前 Slides 模块存在以下核心问题：

- 模板选择逻辑不完整（仅 20% 实现）
- 缺乏多模型协作架构
- 图文语义匹配度低
- 无版本管理和回滚能力
- 一次性生成，不支持迭代优化

### 1.2 目标

| 目标       | 描述                   | 衡量标准                              |
| ---------- | ---------------------- | ------------------------------------- |
| 质量对齐   | 达到 Genspark 输出质量 | 专家盲评 > 80% 认可                   |
| 多模型协作 | 4+ 模型分工协作        | Architect → Writer → Renderer → Image |
| 版本管理   | 支持检查点保存和回滚   | 任意检查点可恢复                      |
| 迭代生成   | 支持对话式修改         | 用户满意度 > 90%                      |

### 1.3 核心创新

1. **三阶段生成管线**: 任务分解 → 大纲规划 → 逐页渲染
2. **四步页面设计**: 风格定调 → 布局细化 → 视觉规划 → HTML 生成
3. **检查点系统**: 每阶段自动保存，支持任意回滚
4. **对话式修改**: 支持用户实时干预和调整

---

## 2. Genspark 分析总结

### 2.1 分析来源

| 文件                    | 内容               | 关键发现              |
| ----------------------- | ------------------ | --------------------- |
| `genspark-html.txt`     | 12+ 页面 HTML 源码 | 设计系统规范          |
| `gensparkdoc.txt`       | 交互对话日志       | 意图识别 + 工具系统   |
| `genspark-thinking.txt` | 思考过程日志       | 三阶段管线 + 四步设计 |

### 2.2 设计系统常量

```css
/* Canvas */
--canvas-width: 1280px;
--canvas-height: 720px;

/* Colors */
--bg-primary: #0f172a; /* 深蓝背景 */
--bg-card: #1e293b; /* 卡片背景 */
--border-default: #334155; /* 默认边框 */
--accent-gold: #d4af37; /* 金色强调 */
--accent-blue: #3b82f6; /* 蓝色强调 */
--text-primary: #f8fafc; /* 主文字 */
--text-secondary: #94a3b8; /* 次级文字 */

/* Typography */
--font-family: "Noto Sans SC", sans-serif;
--font-title: 36px / 900;
--font-subtitle: 18px / 400;
--font-body: 16px / 400;
--font-caption: 13px / 400;

/* Spacing */
--padding-page: 50px 80px 80px 80px; /* 注意底部安全区 80px */
--border-radius-card: 12px;
--border-accent-width: 5px;

/* External Resources */
--tailwind-cdn: https: ; //cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css;
--fontawesome-cdn: https: ; //cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css;
--echarts-cdn: https: ; //cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js;
```

### 2.3 页面类型识别

从 HTML 源码中识别出 15 种页面类型：

| #   | 类型             | 特征                       | 典型场景      |
| --- | ---------------- | -------------------------- | ------------- |
| 1   | cover            | 居中标题 + 副标题 + 元信息 | 封面          |
| 2   | toc              | 章节列表 + 图标            | 目录          |
| 3   | questions        | 问题列表 + 编号            | 前言/核心问题 |
| 4   | pillars          | 3列卡片 + 图标             | 三大支柱      |
| 5   | framework        | 5列卡片                    | 五位一体      |
| 6   | timeline         | 水平时间轴 + 阶段卡片      | 政策演进      |
| 7   | evolutionRoadmap | 垂直路线图                 | 技术演进      |
| 8   | dashboard        | ECharts 图表 + 指标卡      | 数据展示      |
| 9   | comparison       | 左右对比 + 指标            | A vs B        |
| 10  | splitLayout      | 左右分栏（可调比例）       | 图文混排      |
| 11  | caseStudy        | 公司信息 + 挑战/方案/成果  | 案例分析      |
| 12  | multiColumn      | 2-4列并列内容              | 要点展示      |
| 13  | recommendations  | 建议列表 + 优先级          | 行动建议      |
| 14  | maturityModel    | 雷达图 + 维度评估          | 成熟度模型    |
| 15  | riskOpportunity  | 风险/机会矩阵              | SWOT 分析     |

### 2.4 工具系统

Genspark 使用可见的工具调用：

```
🧠 深度思考 - 任务分解、策略规划
📄 Doc View - 查看源文档内容
🔍 Search - 搜索相关信息
✍️ Write - 生成/修改内容
🎨 Render - 渲染页面 HTML
```

### 2.5 意图识别

```typescript
const INTENT_TYPES = {
  create_outline: "用户要求创建文档大纲",
  write_section: "用户要求撰写特定章节",
  modify_content: "用户要求修改已有内容",
  add_data: "用户要求补充数据/案例",
  refine_style: "用户对风格/表达不满意",
  confirm: "用户确认/同意当前方案",
  reject: "用户否定/要求重做",
  rollback: "用户要求回滚到之前版本",
};
```

---

## 3. 系统架构设计

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Slides Engine v3.0                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐            │
│  │   Phase 1    │   │   Phase 2    │   │   Phase 3    │            │
│  │  任务分解    │──▶│  大纲规划    │──▶│  逐页渲染    │            │
│  │  Architect   │   │  Architect   │   │  Renderer    │            │
│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘            │
│         │                  │                  │                     │
│         ▼                  ▼                  ▼                     │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │               Checkpoint Manager                          │      │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐        │      │
│  │  │ CP-001  │ │ CP-002  │ │ CP-003  │ │ CP-00N  │        │      │
│  │  │ 任务分解│ │ 大纲确认│ │ 页面-1  │ │ 页面-N  │        │      │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘        │      │
│  └──────────────────────────────────────────────────────────┘      │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │               Multi-Model Orchestrator                    │      │
│  │         (使用 ModelSelectorService 动态选择模型)           │      │
│  │                                                           │      │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │      │
│  │  │  Architect  │  │   Writer    │  │  Renderer   │      │      │
│  │  │    CHAT     │  │  CHAT_FAST  │  │    CHAT     │      │      │
│  │  │  统筹规划   │  │  并行写作   │  │  HTML 生成  │      │      │
│  │  └─────────────┘  └─────────────┘  └─────────────┘      │      │
│  │                                                           │      │
│  │  ┌─────────────┐  ┌─────────────┐                        │      │
│  │  │   Image     │  │  Reviewer   │                        │      │
│  │  │ IMAGE_GEN   │  │    CHAT     │                        │      │
│  │  │  图像生成   │  │  质量审核   │                        │      │
│  │  └─────────────┘  └─────────────┘                        │      │
│  └──────────────────────────────────────────────────────────┘      │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 三阶段生成管线

#### Phase 1: 任务分解

```typescript
interface TaskDecomposition {
  totalPages: number;
  chapters: Chapter[];
  designStrategy: {
    colorScheme: "dark" | "light" | "custom";
    accentColor: string;
    styleReference: string;
  };
  todoList: TodoItem[];
}

interface Chapter {
  id: string;
  title: string;
  pageRange: [number, number];
  keyPoints: string[];
}

interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
}
```

#### Phase 2: 大纲规划

```typescript
interface OutlinePlan {
  pages: PageOutline[];
  globalStyles: GlobalStyles;
  contentFlow: ContentFlowAnalysis;
}

interface PageOutline {
  pageNumber: number;
  title: string;
  templateType: PageTemplateType;
  contentBrief: string; // 简要描述
  keyElements: string[]; // 关键元素列表
  layoutHints: LayoutHint[]; // 布局提示
  dataRequirements?: DataRequirement[]; // 数据需求
  imageRequirements?: ImageRequirement[]; // 图像需求
}

type PageTemplateType =
  | "cover"
  | "toc"
  | "questions"
  | "pillars"
  | "framework"
  | "timeline"
  | "evolutionRoadmap"
  | "dashboard"
  | "comparison"
  | "splitLayout"
  | "caseStudy"
  | "multiColumn"
  | "recommendations"
  | "maturityModel"
  | "riskOpportunity";
```

#### Phase 3: 逐页渲染

```typescript
interface PageRenderResult {
  pageNumber: number;
  html: string;
  css: string;
  scripts?: string;
  images: GeneratedImage[];
  metadata: PageMetadata;
}

interface GeneratedImage {
  id: string;
  url: string;
  prompt: string;
  semanticContext: string; // 图像对应的语义块
  position: "background" | "inline" | "card" | "icon";
}
```

### 3.3 数据流

```
素材输入 ──▶ 任务分解 ──▶ 大纲规划 ──▶ 用户确认
                                          │
                                          ▼
    ┌────────────────────────────────────────┐
    │         逐页渲染循环                    │
    │                                        │
    │   ┌──────┐    ┌──────┐    ┌──────┐   │
    │   │ 四步  │──▶│ HTML │──▶│ 图像  │   │
    │   │ 设计  │    │ 生成 │    │ 生成  │   │
    │   └──────┘    └──────┘    └──────┘   │
    │        │                      │       │
    │        ▼                      ▼       │
    │   ┌────────────────────────────┐     │
    │   │       质量审核              │     │
    │   │  - 布局检查                │     │
    │   │  - 内容完整性              │     │
    │   │  - 图文匹配度              │     │
    │   └────────────────────────────┘     │
    │                 │                     │
    │                 ▼                     │
    │   ┌────────────────────────────┐     │
    │   │       保存检查点            │     │
    │   └────────────────────────────┘     │
    └────────────────────────────────────────┘
                      │
                      ▼
               最终输出
```

---

## 4. 五大核心技能

### 4.1 Skill 1: 任务分解 (Task Decomposition)

**输入**: 源文档/素材
**输出**: 结构化待办事项列表

```typescript
// Prompt 模板
const TASK_DECOMPOSITION_PROMPT = `
你是一位资深的商务演示策划专家。分析以下内容，创建PPT制作的任务列表。

## 源内容
{{sourceContent}}

## 输出要求
1. 分析报告结构，识别主要章节
2. 规划PPT整体框架和页面数量
3. 为每个章节创建具体任务
4. 输出JSON格式的任务列表

## 输出格式
{
  "totalPages": number,
  "chapters": [
    {
      "id": "ch-1",
      "title": "章节标题",
      "pageRange": [1, 3],
      "keyPoints": ["要点1", "要点2"]
    }
  ],
  "todoList": [
    {
      "id": "task-1",
      "content": "分析报告结构,规划PPT整体框架和页面布局",
      "status": "pending"
    }
  ],
  "designStrategy": {
    "colorScheme": "dark",
    "accentColor": "#D4AF37",
    "styleReference": "McKinsey 咨询风格"
  }
}
`;
```

### 4.2 Skill 2: 大纲规划 (Outline Planning)

**输入**: 任务分解结果
**输出**: 每页的内容大纲

```typescript
// 大纲格式（从 Genspark 提取）
const OUTLINE_FORMAT = `
页码
标题
布局描述/结构说明
- 要点1：详细内容
- 要点2：详细内容
[可选：左右分区说明]
[可选：图表需求]
`;

// 示例
const OUTLINE_EXAMPLE = `
8
AI2C：端侧Agent与交互标准
左：生态进展
- Apple：App Intents+端侧情境语义库+私有云PCC
- Google：App Functions API+Gemini Nano/Pro/Ultra
- Meta：On-Body AI（眼镜、神经腕带）
右：关键命题
- 交互标准化（MCP/AAIF）优于"模拟点击"
- 行动安全：细粒度授权、白名单与受控执行
`;
```

### 4.3 Skill 3: 页面类型选择 (Page Type Selection)

**决策树**:

```
内容分析
    │
    ├─── 时间序列？
    │       ├─── 3-5阶段 → timeline
    │       ├─── 6+阶段 → evolutionRoadmap
    │       └─── 叙事性 → splitLayout
    │
    ├─── 对比/比较？
    │       ├─── 2项+风险/机遇 → riskOpportunity
    │       ├─── 2项+高数据 → comparison
    │       └─── 3+项并列 → multiColumn
    │
    ├─── 层级/框架？
    │       ├─── 等级模型 → maturityModel
    │       ├─── 3项并列 → pillars
    │       ├─── 4-5项并列 → framework
    │       └─── 流程 → evolutionRoadmap
    │
    ├─── 数据展示？
    │       ├─── 高密度+4+指标 → dashboard
    │       └─── 对比性数据 → comparison
    │
    └─── 建议/行动？
            ├─── ≤4条+紧迫 → recommendations
            ├─── 5-7条 → recommendations
            └─── >7条 → splitLayout
```

### 4.4 Skill 4: 四步页面设计 (4-Step Page Design)

```typescript
interface FourStepDesignProcess {
  step1_drafting: {
    purpose: "确定页面风格和核心元素";
    output: {
      style: string; // "McKinsey-style cover"
      coreElements: string[]; // ["title", "subtitle", "date"]
      mood: string; // "professional, data-driven"
    };
  };

  step2_refiningLayout: {
    purpose: "细化布局策略";
    output: {
      alignment: string; // "left-aligned title"
      graphicsPosition: string; // "abstract tech on right"
      spacing: string; // "generous whitespace"
    };
  };

  step3_planningVisuals: {
    purpose: "规划视觉元素";
    output: {
      backgroundColor: string; // "#001f3f"
      accentColors: string[]; // ["#D4AF37", "#3B82F6"]
      decorations: string[]; // ["gradient overlay", "grid lines"]
    };
  };

  step4_formulatingHTML: {
    purpose: "生成最终HTML代码";
    output: {
      html: string;
      inlineStyles: boolean;
      externalDependencies: string[];
    };
  };
}
```

**Prompt 模板**:

```typescript
const FOUR_STEP_DESIGN_PROMPT = `
你是一位资深的演示设计师，正在设计第 {{pageNumber}} 页。

## 页面信息
- 标题: {{title}}
- 模板类型: {{templateType}}
- 内容大纲:
{{contentOutline}}

## 四步设计流程

### Step 1: Drafting (风格定调)
思考这一页的整体风格和核心视觉元素。考虑：
- 这是什么类型的内容？
- 应该给观众什么感受？
- 核心视觉元素是什么？

### Step 2: Refining Layout (布局细化)
详细规划布局策略。考虑：
- 标题和内容的对齐方式
- 图形元素的位置
- 留白和间距

### Step 3: Planning Visuals (视觉规划)
确定色彩和装饰元素。考虑：
- 背景色和渐变
- 强调色使用位置
- 装饰性元素（线条、图标等）

### Step 4: Formulating HTML (HTML生成)
基于以上思考，生成最终的HTML代码。
- Canvas: 1280x720px
- 使用 TailwindCSS 类
- 内联样式补充
- 底部安全区 80px

## 输出
请依次完成四个步骤的思考，最后输出完整的HTML代码。
`;
```

### 4.5 Skill 5: 内容压缩 (Content Compression)

**目的**: 将长文本压缩为适合幻灯片的简洁内容

```typescript
const CONTENT_COMPRESSION_PROMPT = `
将以下内容压缩为适合幻灯片展示的格式：

## 原始内容
{{originalContent}}

## 压缩规则
1. 标题: 最多10个汉字
2. 副标题: 最多20个汉字
3. 要点: 每条最多15个汉字
4. 描述: 每段最多50个汉字
5. 保留关键数据和术语
6. 使用平行结构

## 输出格式
{
  "title": "压缩后标题",
  "subtitle": "压缩后副标题",
  "points": ["要点1", "要点2", "要点3"],
  "description": "简短描述"
}
`;
```

---

## 5. 多模型协作架构

### 5.1 系统模型类型

系统使用 `AIModelType` 枚举定义模型类型，具体模型由管理员在后台配置：

```typescript
// Prisma Schema 定义
enum AIModelType {
  CHAT              // 标准聊天模型 - 复杂对话和分析
  CHAT_FAST         // 快速聊天模型 - 简单任务：分类、翻译、摘要
  IMAGE_GENERATION  // 图片生成模型
  IMAGE_EDITING     // 图片编辑模型
  MULTIMODAL        // 多模态模型
  EMBEDDING         // 向量嵌入模型
  RERANK            // 重排序模型
}
```

### 5.2 角色与模型类型映射

| 角色      | 模型类型           | 选择策略       | 职责                         | 并行度      |
| --------- | ------------------ | -------------- | ---------------------------- | ----------- |
| Architect | `CHAT`             | QUALITY_FIRST  | 任务分解、大纲规划、质量审核 | 1           |
| Writer    | `CHAT_FAST`        | COST_OPTIMIZED | 内容填充、文案润色           | N（可并行） |
| Renderer  | `CHAT`             | QUALITY_FIRST  | 四步设计、HTML生成           | 1           |
| Image     | `IMAGE_GENERATION` | DEFAULT        | 图像生成                     | N（可并行） |
| Reviewer  | `CHAT`             | QUALITY_FIRST  | 质量检查、一致性验证         | 1           |

> **注意**: 具体使用哪个模型（如 GPT-4o、Claude、Gemini）由管理员在 Admin Console → AI Models 中配置默认模型决定。

### 5.3 调用流程

```
                    ┌─────────────────┐
                    │    Architect    │
                    │     (CHAT)      │
                    │ QUALITY_FIRST   │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
        ┌─────────┐    ┌─────────┐    ┌─────────┐
        │ Writer  │    │ Writer  │    │ Writer  │
        │(CHAT_   │    │(CHAT_   │    │(CHAT_   │
        │ FAST)   │    │ FAST)   │    │ FAST)   │
        │ Page 1  │    │ Page 2  │    │ Page 3  │
        └────┬────┘    └────┬────┘    └────┬────┘
             │              │              │
             └──────────────┼──────────────┘
                            │
                            ▼
                    ┌─────────────────┐
                    │    Renderer     │
                    │     (CHAT)      │
                    │   QUALITY_FIRST │
                    │   逐页渲染       │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
        ┌─────────┐    ┌─────────┐    ┌─────────┐
        │  Image  │    │  Image  │    │  Image  │
        │(IMAGE_  │    │(IMAGE_  │    │(IMAGE_  │
        │ GEN)    │    │ GEN)    │    │ GEN)    │
        │ Img 1   │    │ Img 2   │    │ Img 3   │
        └────┬────┘    └────┬────┘    └────┬────┘
             │              │              │
             └──────────────┼──────────────┘
                            │
                            ▼
                    ┌─────────────────┐
                    │    Reviewer     │
                    │     (CHAT)      │
                    │   QUALITY_FIRST │
                    │   质量审核       │
                    └─────────────────┘
```

### 5.4 服务接口定义

```typescript
import { AIModelType } from "@prisma/client";
import {
  ModelSelectionStrategy,
  AiTaskType,
} from "@/common/ai-orchestration/types";

// 模型选择配置
interface ModelSelectionConfig {
  modelType: AIModelType;
  strategy: ModelSelectionStrategy;
  fallbackEnabled?: boolean;
}

// 架构师服务
interface IArchitectService {
  readonly modelConfig: ModelSelectionConfig; // { modelType: CHAT, strategy: QUALITY_FIRST }

  decomposeTask(input: SourceMaterial): Promise<TaskDecomposition>;
  planOutline(decomposition: TaskDecomposition): Promise<OutlinePlan>;
  reviewQuality(pages: PageRenderResult[]): Promise<QualityReport>;
}

// 写作服务
interface IWriterService {
  readonly modelConfig: ModelSelectionConfig; // { modelType: CHAT_FAST, strategy: COST_OPTIMIZED }

  fillContent(pageOutline: PageOutline): Promise<PageContent>;
  compressContent(content: string, maxLength: number): Promise<string>;
  polishText(text: string, style: string): Promise<string>;
}

// 渲染服务
interface IRendererService {
  readonly modelConfig: ModelSelectionConfig; // { modelType: CHAT, strategy: QUALITY_FIRST }

  designPage(page: PageOutline, content: PageContent): Promise<PageDesign>;
  generateHTML(design: PageDesign): Promise<string>;
  renderWithThinking(page: PageOutline): Promise<FourStepResult>;
}

// 图像服务
interface IImageService {
  readonly modelConfig: ModelSelectionConfig; // { modelType: IMAGE_GENERATION, strategy: DEFAULT }

  generateImage(
    prompt: string,
    context: SemanticContext,
  ): Promise<GeneratedImage>;
  batchGenerate(requirements: ImageRequirement[]): Promise<GeneratedImage[]>;
}

// 审核服务
interface IReviewerService {
  readonly modelConfig: ModelSelectionConfig; // { modelType: CHAT, strategy: QUALITY_FIRST }

  checkLayout(html: string): Promise<LayoutIssue[]>;
  checkContentIntegrity(
    page: PageRenderResult,
    outline: PageOutline,
  ): Promise<IntegrityIssue[]>;
  checkImageMatch(image: GeneratedImage, context: string): Promise<MatchScore>;
}
```

### 5.5 模型选择流程

```typescript
// 使用 ModelSelectorService 动态选择模型
async function selectModelForRole(role: SlidesRole): Promise<AiModelConfig> {
  const roleConfigs: Record<SlidesRole, ModelSelectionConfig> = {
    architect: {
      modelType: AIModelType.CHAT,
      strategy: ModelSelectionStrategy.QUALITY_FIRST,
    },
    writer: {
      modelType: AIModelType.CHAT_FAST,
      strategy: ModelSelectionStrategy.COST_OPTIMIZED,
    },
    renderer: {
      modelType: AIModelType.CHAT,
      strategy: ModelSelectionStrategy.QUALITY_FIRST,
    },
    image: {
      modelType: AIModelType.IMAGE_GENERATION,
      strategy: ModelSelectionStrategy.DEFAULT,
    },
    reviewer: {
      modelType: AIModelType.CHAT,
      strategy: ModelSelectionStrategy.QUALITY_FIRST,
    },
  };

  const config = roleConfigs[role];
  const taskType = this.mapModelTypeToTaskType(config.modelType);

  // 通过 ModelSelectorService 选择具体模型
  return this.modelSelector.selectModel(taskType, {
    strategy: config.strategy,
  });
}
```

---

## 6. 检查点与版本管理

### 6.1 检查点系统设计

```typescript
interface Checkpoint {
  id: string; // UUID
  name: string; // 用户友好名称
  type: CheckpointType;
  timestamp: Date;
  state: CheckpointState;
  metadata: CheckpointMetadata;
}

type CheckpointType =
  | "task_decomposition" // 任务分解完成
  | "outline_confirmed" // 大纲确认
  | "page_rendered" // 单页渲染完成
  | "batch_rendered" // 批量渲染完成
  | "user_modified" // 用户手动修改
  | "auto_save"; // 自动保存

interface CheckpointState {
  taskDecomposition?: TaskDecomposition;
  outlinePlan?: OutlinePlan;
  pages: PageState[];
  conversation: ConversationMessage[];
  globalStyles?: GlobalStyles;
}

interface PageState {
  pageNumber: number;
  outline: PageOutline;
  content?: PageContent;
  html?: string;
  images?: GeneratedImage[];
  status: "pending" | "in_progress" | "completed" | "error";
}

interface CheckpointMetadata {
  version: string; // 语义版本号
  previousCheckpointId?: string; // 前一个检查点
  trigger: "auto" | "user"; // 触发方式
  description?: string; // 用户描述
  tags?: string[]; // 标签
}
```

### 6.2 检查点操作

```typescript
interface ICheckpointManager {
  // 创建检查点
  create(
    state: CheckpointState,
    type: CheckpointType,
    name?: string,
  ): Promise<Checkpoint>;

  // 获取检查点
  get(id: string): Promise<Checkpoint>;
  list(filter?: CheckpointFilter): Promise<Checkpoint[]>;

  // 恢复检查点
  restore(id: string): Promise<CheckpointState>;

  // 比较检查点
  diff(id1: string, id2: string): Promise<CheckpointDiff>;

  // 删除检查点
  delete(id: string): Promise<void>;
  prune(keepLast: number): Promise<void>;
}
```

### 6.3 自动保存策略

```typescript
const AUTO_SAVE_TRIGGERS = {
  // 阶段完成时自动保存
  PHASE_COMPLETE: true,

  // 每 N 页渲染完成后保存
  PAGE_INTERVAL: 5,

  // 用户确认后保存
  USER_CONFIRM: true,

  // 时间间隔保存（分钟）
  TIME_INTERVAL: 5,

  // 最大保存数量
  MAX_CHECKPOINTS: 50,
};
```

### 6.4 数据库 Schema

```prisma
// Prisma Schema
model SlidesCheckpoint {
  id          String   @id @default(cuid())
  sessionId   String   // 会话ID
  name        String
  type        String   // CheckpointType
  version     String
  stateJson   Json     // CheckpointState 序列化
  metadata    Json     // CheckpointMetadata
  createdAt   DateTime @default(now())

  session     SlidesSession @relation(fields: [sessionId], references: [id])

  @@index([sessionId, createdAt])
}

model SlidesSession {
  id              String   @id @default(cuid())
  userId          String
  title           String
  status          String   // 'active' | 'completed' | 'archived'
  currentStateId  String?  // 当前状态的检查点ID
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  checkpoints     SlidesCheckpoint[]

  @@index([userId, updatedAt])
}
```

### 6.5 版本树可视化

```
CP-001 [任务分解] ─────┬── CP-002 [大纲确认]
                       │        │
                       │        ├── CP-003 [页面1-5]
                       │        │        │
                       │        │        └── CP-004 [页面6-10]
                       │        │                 │
                       │        │                 └── CP-005 [完成] ← current
                       │        │
                       │        └── CP-006 [用户修改大纲] (分支)
                       │                 │
                       │                 └── CP-007 [页面1-5]
                       │
                       └── CP-008 [重新分解] (分支)
```

---

## 7. 前端 UI 设计

### 7.1 布局结构

```
┌──────────────────────────────────────────────────────────────────────┐
│  Header: [返回] [项目名称: 美国AI全景分析报告]    [检查点] [导出] [设置] │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌────────────────────────────┐ ┌────────────────────────────────┐   │
│  │                            │ │                                │   │
│  │    Conversation Panel      │ │       Preview Panel            │   │
│  │                            │ │                                │   │
│  │  ┌──────────────────────┐  │ │  ┌──────────────────────────┐ │   │
│  │  │ 🧠 深度思考           │  │ │  │                          │ │   │
│  │  │ 正在分析报告结构...   │  │ │  │     Slides Preview       │ │   │
│  │  │                      │  │ │  │                          │ │   │
│  │  │ ✅ 已识别 6 个章节    │  │ │  │  ┌─────┐ ┌─────┐ ┌─────┐ │ │   │
│  │  │ ✅ 规划 18 页幻灯片   │  │ │  │  │  1  │ │  2  │ │  3  │ │ │   │
│  │  └──────────────────────┘  │ │  │  └─────┘ └─────┘ └─────┘ │ │   │
│  │                            │ │  │                          │ │   │
│  │  ┌──────────────────────┐  │ │  │  当前: 第 5 页            │ │   │
│  │  │ 📄 大纲预览           │  │ │  │  ┌────────────────────┐ │ │   │
│  │  │                      │  │ │  │  │                    │ │ │   │
│  │  │ 1. 封面              │  │ │  │  │   Selected Slide   │ │ │   │
│  │  │ 2. 目录              │  │ │  │  │   Preview          │ │ │   │
│  │  │ 3. 前言与核心问题     │  │ │  │  │                    │ │ │   │
│  │  │ 4. 政策演进时间轴     │  │ │  │  └────────────────────┘ │ │   │
│  │  │ ...                  │  │ │  └──────────────────────────┘ │   │
│  │  └──────────────────────┘  │ │                                │   │
│  │                            │ │  ┌──────────────────────────┐ │   │
│  │  ┌──────────────────────┐  │ │  │ Properties Panel         │ │   │
│  │  │ [确认大纲]  [修改]    │  │ │  │ 模板: timeline           │ │   │
│  │  └──────────────────────┘  │ │  │ 背景: #0F172A            │ │   │
│  │                            │ │  │ 元素: 4 个阶段卡片        │ │   │
│  │  ┌──────────────────────┐  │ │  └──────────────────────────┘ │   │
│  │  │ 💬 输入修改建议...     │  │ │                                │   │
│  │  └──────────────────────┘  │ └────────────────────────────────┘   │
│  └────────────────────────────┘                                       │
│                                                                       │
├──────────────────────────────────────────────────────────────────────┤
│  Progress: [████████████░░░░░░░░] 12/18 页 | 检查点: CP-004          │
└──────────────────────────────────────────────────────────────────────┘
```

### 7.2 核心组件

```typescript
// 对话面板
interface ConversationPanelProps {
  messages: ConversationMessage[];
  toolCalls: ToolCallDisplay[];
  onSendMessage: (content: string) => void;
  onConfirm: () => void;
  onReject: () => void;
}

// 预览面板
interface PreviewPanelProps {
  pages: PageState[];
  selectedPage: number;
  onSelectPage: (pageNumber: number) => void;
  onEditPage: (pageNumber: number) => void;
  zoomLevel: number;
}

// 检查点管理器
interface CheckpointManagerProps {
  checkpoints: Checkpoint[];
  currentCheckpointId: string;
  onRestore: (id: string) => void;
  onCompare: (id1: string, id2: string) => void;
  onCreateManual: (name: string) => void;
}

// 工具调用展示
interface ToolCallDisplayProps {
  icon: string; // 🧠 📄 🔍 ✍️ 🎨
  name: string;
  status: "pending" | "running" | "completed" | "error";
  output?: string;
  expandable: boolean;
}
```

### 7.3 交互流程

```
1. 用户上传素材/选择源内容
         │
         ▼
2. 显示 🧠 深度思考 工具调用
   - 实时展示分析过程
   - 展示任务分解结果
         │
         ▼
3. 展示大纲预览
   - 用户可确认或修改
   - 修改后重新生成
         │
         ▼
4. 用户确认 → 创建检查点 CP-002
         │
         ▼
5. 逐页渲染
   - 显示 🎨 渲染 工具调用
   - 实时更新预览
   - 每 5 页自动保存检查点
         │
         ▼
6. 渲染完成
   - 创建完成检查点
   - 支持导出和编辑
```

---

## 8. 页面模板规范

### 8.1 模板定义

每个模板需要实现以下接口：

```typescript
interface PageTemplate {
  type: PageTemplateType;
  name: string;
  description: string;

  // 内容 Schema
  contentSchema: ContentSchema;

  // 默认样式
  defaultStyles: TemplateStyles;

  // 渲染函数
  render(content: TemplateContent, styles: TemplateStyles): string;

  // 验证函数
  validate(content: TemplateContent): ValidationResult;

  // 图像需求
  imageRequirements: ImageRequirement[];
}

interface ContentSchema {
  required: FieldDefinition[];
  optional: FieldDefinition[];
}

interface FieldDefinition {
  name: string;
  type: "string" | "array" | "object" | "number";
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
}
```

### 8.2 Timeline 模板示例

```typescript
const TimelineTemplate: PageTemplate = {
  type: "timeline",
  name: "时间轴",
  description: "展示3-5个阶段的时间演进",

  contentSchema: {
    required: [
      { name: "title", type: "string", maxLength: 20 },
      { name: "subtitle", type: "string", maxLength: 40 },
      { name: "stages", type: "array", minItems: 3, maxItems: 5 },
    ],
    optional: [{ name: "footer", type: "string", maxLength: 30 }],
  },

  defaultStyles: {
    backgroundColor: "#0F172A",
    accentColor: "#3B82F6",
    highlightColor: "#D4AF37",
    lineColor: "#334155",
    cardBackground: "#1E293B",
    cardBorder: "#334155",
  },

  imageRequirements: [
    {
      position: "background",
      optional: true,
      description: "抽象科技背景",
    },
  ],

  render(content, styles) {
    // 返回完整 HTML
    return `<!DOCTYPE html>...`;
  },

  validate(content) {
    const issues: string[] = [];
    if (!content.title) issues.push("缺少标题");
    if (!content.stages || content.stages.length < 3) {
      issues.push("阶段数量不足3个");
    }
    return { valid: issues.length === 0, issues };
  },
};
```

### 8.3 所有模板清单

| 模板             | 必需字段                              | 可选字段           | 图像需求     |
| ---------------- | ------------------------------------- | ------------------ | ------------ |
| cover            | title, subtitle                       | date, author, logo | background   |
| toc              | chapters                              | pageNumbers        | -            |
| questions        | title, questions                      | description        | -            |
| pillars          | title, items(3)                       | subtitle, footer   | icons        |
| framework        | title, items(5)                       | subtitle           | icons        |
| timeline         | title, stages(3-5)                    | subtitle           | background   |
| evolutionRoadmap | title, stages(4-8)                    | milestones         | icons        |
| dashboard        | title, charts, metrics                | subtitle           | charts       |
| comparison       | title, itemA, itemB                   | metrics            | icons        |
| splitLayout      | title, leftContent, rightContent      | ratio              | inline       |
| caseStudy        | company, challenge, solution, results | logo               | company logo |
| multiColumn      | title, columns(2-4)                   | -                  | icons        |
| recommendations  | title, items                          | priority, timeline | -            |
| maturityModel    | title, dimensions, levels             | currentState       | radar chart  |
| riskOpportunity  | title, risks, opportunities           | matrix             | -            |

---

## 9. 实施路线图

### Phase 1: 核心架构 (1周)

| 任务 | 文件                        | 描述           |
| ---- | --------------------------- | -------------- |
| T1   | checkpoint.service.ts       | 检查点管理服务 |
| T2   | checkpoint.types.ts         | 检查点类型定义 |
| T3   | architect.service.ts        | 架构师模型服务 |
| T4   | renderer.service.ts         | 渲染器模型服务 |
| T5   | multi-model-orchestrator.ts | 多模型编排器   |

### Phase 2: 技能实现 (1周)

| 任务 | 文件                         | 描述         |
| ---- | ---------------------------- | ------------ |
| T6   | task-decomposition.skill.ts  | 任务分解技能 |
| T7   | outline-planning.skill.ts    | 大纲规划技能 |
| T8   | page-type-selection.skill.ts | 页面类型选择 |
| T9   | four-step-design.skill.ts    | 四步设计技能 |
| T10  | content-compression.skill.ts | 内容压缩技能 |

### Phase 3: 模板完善 (1周)

| 任务    | 文件                  | 描述         |
| ------- | --------------------- | ------------ |
| T11-T25 | templates/\*.tsx      | 15种模板实现 |
| T26     | template-validator.ts | 模板验证器   |
| T27     | html-generator.ts     | HTML 生成器  |

### Phase 4: 前端重构 (1周)

| 任务 | 文件                  | 描述         |
| ---- | --------------------- | ------------ |
| T28  | ConversationPanel.tsx | 对话面板     |
| T29  | PreviewPanel.tsx      | 预览面板     |
| T30  | CheckpointManager.tsx | 检查点管理   |
| T31  | ToolCallDisplay.tsx   | 工具调用展示 |
| T32  | SlidesTab v3          | 主页面重构   |

### 验收标准

- [ ] 三阶段管线正常运行
- [ ] 四步设计思考过程可见
- [ ] 检查点创建和恢复正常
- [ ] 15种模板全部可用
- [ ] 多模型协作正确调度
- [ ] 图文语义匹配度 > 80%

---

## 10. 附录

### A. Genspark HTML 示例

#### Cover 页面

```html
<!DOCTYPE html>
<html data-theme="dark" lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <link
      href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css"
      rel="stylesheet"
    />
    <link
      href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;700;900&display=swap"
      rel="stylesheet"
    />
    <style>
      body {
        margin: 0;
        padding: 0;
        font-family: "Noto Sans SC", sans-serif;
        background-color: #0f172a;
      }
      .slide-container {
        width: 1280px;
        height: 720px;
        background-color: #0f172a;
        position: relative;
        overflow: hidden;
      }
      /* ... 更多样式 ... */
    </style>
  </head>
  <body>
    <div class="slide-container">
      <!-- 内容 -->
    </div>
  </body>
</html>
```

#### Timeline 页面

见 `debug/timeline.txt` 完整示例

### B. 提示词模板库

所有提示词模板存放于:

```
backend/src/modules/ai/ai-office/slides/prompts/
├── task-decomposition.prompt.ts
├── outline-planning.prompt.ts
├── page-type-selection.prompt.ts
├── four-step-design.prompt.ts
├── content-compression.prompt.ts
└── quality-review.prompt.ts
```

### C. 参考资料

1. Genspark 示例文件: `debug/genspark-html.txt`
2. Genspark 交互日志: `debug/gensparkdoc.txt`
3. Genspark 思考过程: `debug/genspark-thinking.txt`
4. 现有设计文档: `docs/features/ai-office/system-design.md`

---

**文档结束**

---

_Generated by Claude Code based on Genspark reverse engineering analysis_
