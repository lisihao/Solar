# AI Office 3.0 重构方案

> **实现状态**: ✅ 后端核心服务已完成 | ✅ 前端组件已完成 | 🔄 待测试和完善

## 已实现的文件清单

### 后端 (backend/src/modules/ai-office/ppt/)

```
ppt/
├── ppt.types.ts              ✅ 核心类型定义
├── slide-planning.service.ts ✅ 逐页规划服务
├── ppt-orchestrator.service.ts ✅ 总调度服务
├── slide-content.service.ts  ✅ 内容生成服务
├── slide-image.service.ts    ✅ 图像生成服务
├── slide-renderer.service.ts ✅ HTML 渲染服务
├── ppt-generation.controller.ts ✅ API 控制器
└── index.ts                  ✅ 模块导出
```

### 前端 (frontend/)

```
types/
└── ppt.ts                    ✅ 前端类型定义

components/ai-office/ppt/
├── PPTGenerator.tsx          ✅ PPT 生成器主组件
└── index.ts                  ✅ 组件导出
```

### 模块注册

```
backend/src/modules/ai-office/ai-office.module.ts ✅ 已更新，注册所有新服务
```

---

## 一、现状分析

### 1.1 当前 AI Office 架构

```
当前架构（单模型）
┌─────────────────────────────────────────────────────┐
│  用户输入提示词                                       │
│        ↓                                            │
│  [文本模型] → 直接生成 Markdown 格式的幻灯片           │
│        ↓                                            │
│  前端解析 Markdown → 渲染幻灯片                       │
│        ↓                                            │
│  导出 PPTX/PDF                                      │
└─────────────────────────────────────────────────────┘
```

**存在的问题**：

1. **单模型局限**：仅使用文本模型，无法生成高质量配图
2. **布局固定**：缺乏智能布局选择，模板应用机械化
3. **无逐页规划**：一次性生成所有内容，无法精细控制每页
4. **图片依赖搜索**：配图来自搜索引擎，质量和相关性差
5. **编辑能力弱**：生成后的编辑体验不如 Gamma/Genspark

### 1.2 竞品分析

#### Gamma AI (2025)

| 特性        | 描述                                   |
| ----------- | -------------------------------------- |
| AI 图像生成 | 集成 GPT-Image-1，可为每页生成定制图像 |
| 智能布局    | 自动建议最佳布局，支持多主题预览       |
| 实时协作    | 多人同时编辑，无冲突                   |
| 数据可视化  | 粘贴数据自动生成图表                   |
| 导出格式    | PPT、Google Slides、PDF、PNG           |
| 定价        | 免费400积分，$8/月无限制               |

#### Genspark AI Slides 2.0

| 特性       | 描述                               |
| ---------- | ---------------------------------- |
| 研究驱动   | 自动搜索网络获取最新数据填充内容   |
| 多 Agent   | 可调用图表、视频、图像等多种 Agent |
| 无幻觉技术 | Deep Thinking 模式，90% 减少错误   |
| PDF 转 PPT | 上传文档自动生成演示文稿           |
| 免费积分   | 每日 200 免费积分                  |

### 1.3 IMAGE 功能的双模型架构（可复用）

```
IMAGE 双模型架构
┌─────────────────────────────────────────────────────┐
│  内容输入（提示词/URL/文件/图片）                      │
│        ↓                                            │
│  [STEP 1] 内容提取 (ContentExtractor)               │
│        ↓                                            │
│  [STEP 1.5] 智能数据获取 (DataFetching)             │
│        ↓                                            │
│  [STEP 2] 文本模型 → 提示词增强 + 渲染模式决策         │
│        ↓                                            │
│  [STEP 3] 渲染决策                                   │
│     ├─ ai_image: 纯图像模型生成                      │
│     ├─ hybrid: 图像模型背景 + HTML文字叠加            │
│     └─ html_render: 纯HTML/SVG渲染                  │
│        ↓                                            │
│  [STEP 4] 图像模型生成（如需要）                      │
│        ↓                                            │
│  输出结果                                            │
└─────────────────────────────────────────────────────┘
```

---

## 二、AI Office 3.0 新架构设计

### 2.1 核心理念：逐页规划 + 双模型生成

```
AI Office 3.0 架构
┌──────────────────────────────────────────────────────────────────┐
│  用户输入（提示词/URL/文件/参考图片）                               │
│        ↓                                                         │
│  [Phase 1] 内容理解与大纲生成                                      │
│     ├─ 内容提取 (复用 ContentExtractorService)                    │
│     ├─ 数据增强 (复用 DataFetchingService)                        │
│     └─ 文本模型 → 生成 PPT 大纲（标题、页数、每页主题）               │
│        ↓                                                         │
│  [Phase 2] 逐页规划（SlideBySlide Planning）                      │
│     ├─ 为每页选择最佳布局模板                                       │
│     ├─ 为每页决定渲染模式 (ai_image/hybrid/html_render)            │
│     ├─ 为每页生成内容结构和图像提示词                                │
│     └─ 输出: SlideSpec[] 数组                                     │
│        ↓                                                         │
│  [Phase 3] 并行生成                                               │
│     ├─ 文本模型：生成每页详细内容（标题、要点、演讲稿）                │
│     └─ 图像模型：为需要的页面生成配图（并行）                         │
│        ↓                                                         │
│  [Phase 4] 渲染与组装                                             │
│     ├─ 根据每页的渲染模式渲染                                       │
│     ├─ 组装完整 PPT                                               │
│     └─ 保存版本快照                                                │
│        ↓                                                         │
│  [Phase 5] 交互式编辑                                             │
│     ├─ 单页重新生成                                                │
│     ├─ 布局切换                                                    │
│     ├─ 图像重新生成/替换                                           │
│     └─ 实时预览                                                    │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 核心数据结构

```typescript
// ==================== 幻灯片规格定义 ====================

interface SlideSpec {
  id: string;
  index: number; // 页码（从0开始）

  // 内容规划
  purpose: SlidePurpose; // 页面目的
  title: string; // 标题
  contentOutline: string[]; // 内容大纲要点
  speakerNotes?: string; // 演讲者备注

  // 布局决策
  layoutType: SlideLayoutType; // 布局类型
  layoutReasoning: string; // 为什么选择这个布局

  // 渲染决策
  renderingMode: "ai_image" | "hybrid" | "html_render";
  renderingReasoning: string; // 为什么选择这个渲染模式

  // 图像规划（如果需要）
  imageSpec?: {
    prompt: string; // 图像生成提示词
    position: "background" | "left" | "right" | "center" | "grid";
    style: string; // 风格要求
    aspectRatio: string;
  };

  // 数据可视化（如果需要）
  chartSpec?: {
    type: "bar" | "line" | "pie" | "radar" | "funnel" | "timeline";
    data: any;
    title: string;
  };
}

type SlidePurpose =
  | "title" // 标题页
  | "agenda" // 议程/目录
  | "section_header" // 章节标题
  | "content" // 常规内容
  | "comparison" // 对比
  | "timeline" // 时间线
  | "statistics" // 数据统计
  | "quote" // 引用
  | "team" // 团队介绍
  | "closing" // 结束页
  | "qna"; // Q&A

type SlideLayoutType =
  | "title_center" // 标题居中
  | "title_subtitle" // 标题+副标题
  | "text_only" // 纯文本
  | "text_image_left" // 左图右文
  | "text_image_right" // 左文右图
  | "image_full" // 全屏图片
  | "two_columns" // 双栏
  | "three_columns" // 三栏
  | "cards_grid" // 卡片网格
  | "bullet_points" // 要点列表
  | "numbered_list" // 编号列表
  | "comparison_split" // 对比分割
  | "timeline_horizontal" // 水平时间线
  | "timeline_vertical" // 垂直时间线
  | "statistics_cards" // 统计卡片
  | "chart_with_text" // 图表+文字
  | "quote_highlight" // 引用高亮
  | "team_grid"; // 团队网格

// ==================== PPT 文档定义 ====================

interface PPTDocument {
  id: string;
  userId: string;

  // 基本信息
  title: string;
  theme: PPTTheme;
  aspectRatio: "16:9" | "4:3" | "1:1";

  // 幻灯片内容
  slides: GeneratedSlide[];

  // 生成配置
  generationConfig: {
    textModelId: string;
    imageModelId: string;
    style: string;
    language: string;
  };

  // 版本管理
  versions: PPTVersion[];
  currentVersionId: string;

  // 元数据
  metadata: {
    slideCount: number;
    wordCount: number;
    imageCount: number;
    generatedAt: Date;
    lastEditedAt: Date;
  };
}

interface GeneratedSlide {
  id: string;
  index: number;
  spec: SlideSpec; // 原始规格

  // 生成的内容
  content: {
    title: string;
    subtitle?: string;
    bodyText?: string;
    bulletPoints?: string[];
    speakerNotes?: string;
  };

  // 生成的图像
  images?: {
    url: string;
    prompt: string;
    position: string;
    modelUsed: string;
  }[];

  // 渲染结果
  renderedHtml?: string; // 用于预览

  // 编辑状态
  isEdited: boolean;
  editHistory: SlideEdit[];
}

interface PPTTheme {
  id: string;
  name: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
    textLight: string;
  };
  fonts: {
    heading: string;
    body: string;
  };
  style: "minimal" | "corporate" | "creative" | "dark" | "academic";
}
```

### 2.3 服务架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        AI Office 3.0 服务层                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐   ┌──────────────────┐                    │
│  │ PPTOrchestrator  │   │ SlideBySlide     │                    │
│  │ Service          │──→│ PlanningService  │                    │
│  │ (总调度器)        │   │ (逐页规划)        │                    │
│  └────────┬─────────┘   └──────────────────┘                    │
│           │                                                      │
│           ├──────────────────┬──────────────────┐               │
│           ↓                  ↓                  ↓               │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐ │
│  │ SlideContent     │ │ SlideImage       │ │ SlideRenderer    │ │
│  │ GeneratorService │ │ GeneratorService │ │ Service          │ │
│  │ (内容生成-文本模型)│ │ (图像生成-图像模型)│ │ (渲染)           │ │
│  └──────────────────┘ └──────────────────┘ └──────────────────┘ │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    复用现有服务                            │   │
│  │  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐ │   │
│  │  │ ContentExtractor│ │ DataFetching   │ │ AIModel        │ │   │
│  │  │ Service        │ │ Service        │ │ Service        │ │   │
│  │  └────────────────┘ └────────────────┘ └────────────────┘ │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 三、详细设计

### 3.1 Phase 1: 内容理解与大纲生成

**输入处理**（复用 IMAGE 的实现）：

```typescript
interface PPTGenerationInput {
  // 输入内容 - 支持多种形式
  prompt?: string; // 直接提示词
  urls?: string[]; // URL 列表
  files?: UploadedFile[]; // 上传文件
  referenceImages?: string[]; // 参考图片（风格参考）

  // 生成配置
  slideCount?: number; // 期望页数（默认自动）
  theme?: string; // 主题ID
  aspectRatio?: "16:9" | "4:3"; // 比例
  language?: string; // 语言

  // 模型选择
  textModelId?: string;
  imageModelId?: string;

  // 高级选项
  includeImages?: boolean; // 是否生成配图（默认true）
  includeSpeakerNotes?: boolean; // 是否生成演讲稿（默认true）
  targetAudience?: string; // 目标受众
  presentationStyle?: "formal" | "casual" | "educational";
}
```

**大纲生成提示词**：

```typescript
const OUTLINE_GENERATION_PROMPT = `
你是一位专业的演示文稿设计师。基于以下内容，生成一份PPT大纲。

## 输入内容
{content}

## 要求
1. 分析内容的核心主题和关键信息
2. 规划合理的幻灯片数量（通常 8-15 页）
3. 为每页确定目的和主要内容

## 输出格式（JSON）
{
  "title": "演示文稿标题",
  "subtitle": "副标题",
  "estimatedDuration": "预计演讲时长（分钟）",
  "targetAudience": "目标受众",
  "outline": [
    {
      "index": 0,
      "purpose": "title",
      "title": "标题页标题",
      "keyPoints": ["关键点1"]
    },
    {
      "index": 1,
      "purpose": "agenda",
      "title": "今日议程",
      "keyPoints": ["议题1", "议题2", "议题3"]
    },
    // ... 更多页面
  ]
}
`;
```

### 3.2 Phase 2: 逐页规划

**核心：为每一页独立做出布局和渲染决策**

```typescript
const SLIDE_PLANNING_PROMPT = `
你是一位演示文稿设计专家。为以下幻灯片选择最佳的布局和渲染方式。

## 幻灯片信息
- 页码: {index}
- 目的: {purpose}
- 标题: {title}
- 内容要点: {keyPoints}
- 整体风格: {style}

## 布局选项
- title_center: 标题居中（适合标题页、章节页）
- text_image_left: 左图右文（适合产品介绍、案例展示）
- text_image_right: 左文右图（适合数据解读）
- two_columns: 双栏对比（适合对比分析）
- bullet_points: 要点列表（适合列举多个观点）
- statistics_cards: 数据卡片（适合数据展示）
- timeline_horizontal: 时间线（适合历程、流程）
- chart_with_text: 图表+文字（适合数据分析）
- quote_highlight: 引用高亮（适合名人名言、重点强调）

## 渲染模式
- ai_image: 使用AI生成精美背景图（适合标题页、视觉冲击页）
- hybrid: AI背景 + 精确文字（适合需要背景氛围的内容页）
- html_render: 纯HTML渲染（适合数据密集、需要精确排版的页面）

## 输出格式（JSON）
{
  "layoutType": "选择的布局",
  "layoutReasoning": "选择理由",
  "renderingMode": "选择的渲染模式",
  "renderingReasoning": "选择理由",
  "imageSpec": {  // 仅当需要图像时
    "prompt": "图像生成提示词（英文，详细描述）",
    "position": "background/left/right/center",
    "style": "风格要求"
  },
  "contentStructure": {
    "hasTitle": true,
    "hasSubtitle": false,
    "bulletCount": 3,
    "hasChart": false,
    "hasImage": true
  }
}
`;
```

**智能决策规则**：

```typescript
// 自动渲染模式决策
function determineRenderingMode(slideSpec: SlideSpec): RenderingMode {
  const { purpose, keyPoints } = slideSpec;

  // 规则1: 标题页和章节页 → ai_image（视觉冲击）
  if (purpose === "title" || purpose === "section_header") {
    return "ai_image";
  }

  // 规则2: 数据密集页 → html_render（精确排版）
  if (purpose === "statistics" || keyPoints.length > 5) {
    return "html_render";
  }

  // 规则3: 引用页、结束页 → ai_image
  if (purpose === "quote" || purpose === "closing") {
    return "ai_image";
  }

  // 规则4: 普通内容页 → hybrid（背景氛围 + 清晰文字）
  return "hybrid";
}

// 自动布局决策
function determineLayout(slideSpec: SlideSpec): SlideLayoutType {
  const { purpose, keyPoints } = slideSpec;

  // 基于目的选择
  const purposeLayoutMap: Record<SlidePurpose, SlideLayoutType> = {
    title: "title_center",
    agenda: "bullet_points",
    section_header: "title_subtitle",
    comparison: "comparison_split",
    timeline: "timeline_horizontal",
    statistics: "statistics_cards",
    quote: "quote_highlight",
    team: "team_grid",
    closing: "title_center",
    qna: "title_center",
    content: "text_image_right", // 默认
  };

  let layout = purposeLayoutMap[purpose] || "bullet_points";

  // 基于内容调整
  if (purpose === "content") {
    if (keyPoints.length <= 3) {
      layout = "text_image_right";
    } else if (keyPoints.length <= 6) {
      layout = "two_columns";
    } else {
      layout = "cards_grid";
    }
  }

  return layout;
}
```

### 3.3 Phase 3: 并行生成

**关键优化：内容生成和图像生成并行执行**

```typescript
async function generateSlidesParallel(
  slideSpecs: SlideSpec[],
  config: GenerationConfig,
): Promise<GeneratedSlide[]> {
  // 分组：需要图像的和不需要图像的
  const slidesNeedingImages = slideSpecs.filter(
    (s) => s.renderingMode !== "html_render" && s.imageSpec,
  );

  // 并行任务
  const contentPromises = slideSpecs.map((spec) =>
    generateSlideContent(spec, config.textModelId),
  );

  const imagePromises = slidesNeedingImages.map((spec) =>
    generateSlideImage(spec.imageSpec!, config.imageModelId),
  );

  // 等待所有完成
  const [contents, images] = await Promise.all([
    Promise.all(contentPromises),
    Promise.all(imagePromises),
  ]);

  // 组装结果
  return assembleSlides(slideSpecs, contents, images);
}
```

**内容生成提示词**：

```typescript
const SLIDE_CONTENT_PROMPT = `
为以下幻灯片生成详细内容。

## 幻灯片规格
- 标题: {title}
- 目的: {purpose}
- 布局: {layoutType}
- 内容大纲: {contentOutline}

## 要求
1. 标题简洁有力（不超过10个字）
2. 要点精炼（每点不超过15个字）
3. 语言风格: {style}
4. 如果需要演讲稿，每页约30秒的内容

## 输出格式（JSON）
{
  "title": "幻灯片标题",
  "subtitle": "副标题（可选）",
  "bulletPoints": ["要点1", "要点2", "要点3"],
  "speakerNotes": "演讲者备注（2-3句话）",
  "highlightText": "需要强调的关键词或数字"
}
`;
```

**图像生成提示词模板**：

```typescript
const IMAGE_PROMPT_TEMPLATE = `
{basePrompt}

Style: {style}, professional presentation visual, clean and modern
Aspect ratio: 16:9
Quality: high resolution, crisp details
Mood: {mood}
Color scheme: {colorScheme}

Negative: text, words, letters, watermark, logo, cluttered, busy
`;
```

### 3.4 Phase 4: 渲染与组装

**三种渲染模式的实现**：

```typescript
class SlideRendererService {
  async renderSlide(slide: GeneratedSlide, theme: PPTTheme): Promise<string> {
    const { spec, content, images } = slide;

    switch (spec.renderingMode) {
      case "ai_image":
        return this.renderAIImageSlide(slide, theme);
      case "hybrid":
        return this.renderHybridSlide(slide, theme);
      case "html_render":
        return this.renderHTMLSlide(slide, theme);
    }
  }

  // AI 图像模式：图像为主，文字叠加
  private async renderAIImageSlide(slide: GeneratedSlide, theme: PPTTheme) {
    const bgImage = slide.images?.[0]?.url;
    return `
      <div class="slide ai-image-slide" style="background-image: url(${bgImage})">
        <div class="overlay" style="background: rgba(0,0,0,0.4)">
          <h1 class="title">${slide.content.title}</h1>
          ${slide.content.subtitle ? `<h2>${slide.content.subtitle}</h2>` : ""}
        </div>
      </div>
    `;
  }

  // 混合模式：AI背景 + 精确HTML内容
  private async renderHybridSlide(slide: GeneratedSlide, theme: PPTTheme) {
    const bgImage = slide.images?.[0]?.url;
    return `
      <div class="slide hybrid-slide" style="background-image: url(${bgImage})">
        <div class="content-layer">
          <div class="text-container">
            <h1>${slide.content.title}</h1>
            <ul>
              ${slide.content.bulletPoints?.map((p) => `<li>${p}</li>`).join("")}
            </ul>
          </div>
        </div>
      </div>
    `;
  }

  // 纯 HTML 模式：精确控制，适合数据密集
  private async renderHTMLSlide(slide: GeneratedSlide, theme: PPTTheme) {
    // 使用复用的 InfographicTemplateService
    return this.infographicTemplate.renderSlide(slide, theme);
  }
}
```

### 3.5 Phase 5: 交互式编辑

**单页重新生成**：

```typescript
interface SlideEditRequest {
  slideId: string;
  action:
    | "regenerate_content"
    | "regenerate_image"
    | "change_layout"
    | "edit_text";

  // 重新生成内容
  newPrompt?: string;

  // 更换布局
  newLayout?: SlideLayoutType;

  // 重新生成图像
  newImagePrompt?: string;

  // 直接编辑
  editedContent?: Partial<SlideContent>;
}

async function editSlide(request: SlideEditRequest): Promise<GeneratedSlide> {
  const { slideId, action } = request;
  const slide = await getSlide(slideId);

  switch (action) {
    case "regenerate_content":
      // 仅重新生成文字内容，保留图像
      const newContent = await generateSlideContent(
        { ...slide.spec, contentOutline: [request.newPrompt!] },
        textModelId,
      );
      return { ...slide, content: newContent, isEdited: true };

    case "regenerate_image":
      // 仅重新生成图像，保留文字
      const newImage = await generateSlideImage(
        { prompt: request.newImagePrompt!, ...slide.spec.imageSpec },
        imageModelId,
      );
      return { ...slide, images: [newImage], isEdited: true };

    case "change_layout":
      // 更换布局模板
      const newSpec = { ...slide.spec, layoutType: request.newLayout! };
      return await rerenderSlide(slide, newSpec);

    case "edit_text":
      // 直接编辑文字
      return {
        ...slide,
        content: { ...slide.content, ...request.editedContent },
        isEdited: true,
      };
  }
}
```

---

## 四、前端组件设计

### 4.1 新的工作区布局

```
┌─────────────────────────────────────────────────────────────────────┐
│  AI Office 3.0 工作区                                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────┐  ┌────────────────────────┐  ┌──────────────────────┐ │
│  │ 缩略图列表 │  │     幻灯片预览区       │  │    右侧面板          │ │
│  │          │  │                        │  │                      │ │
│  │ [Slide 1]│  │  ┌──────────────────┐  │  │  ┌────────────────┐  │ │
│  │ [Slide 2]│  │  │                  │  │  │  │ 输入/聊天      │  │ │
│  │ [Slide 3]│  │  │   当前幻灯片      │  │  │  │                │  │ │
│  │ [Slide 4]│  │  │   预览           │  │  │  └────────────────┘  │ │
│  │ [Slide 5]│  │  │                  │  │  │  ┌────────────────┐  │ │
│  │   ...    │  │  └──────────────────┘  │  │  │ 页面设置       │  │ │
│  │          │  │                        │  │  │ - 布局选择     │  │ │
│  │  + 添加页 │  │  ┌──────────────────┐  │  │  │ - 重新生成     │  │ │
│  │          │  │  │ 页面操作工具栏    │  │  │  │ - 图像选项     │  │ │
│  └──────────┘  │  └──────────────────┘  │  │  └────────────────┘  │ │
│                │                        │  │  ┌────────────────┐  │ │
│                └────────────────────────┘  │  │ 生成进度       │  │ │
│                                            │  │ - Step 1 ✓     │  │ │
│                                            │  │ - Step 2 ✓     │  │ │
│                                            │  │ - Step 3 ...   │  │ │
│                                            │  └────────────────┘  │ │
│                                            └──────────────────────┘ │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ 底部工具栏: [主题] [导出] [演示] [分享] [版本历史]            │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 关键组件

```typescript
// 组件树结构
<PPTWorkspace>
  <SlideThumbnailList>
    <SlideThumbnail />
    <AddSlideButton />
  </SlideThumbnailList>

  <SlidePreviewArea>
    <SlideCanvas>
      <AIImageSlide />      // 纯图像模式
      <HybridSlide />       // 混合模式
      <HTMLRenderSlide />   // HTML渲染模式
    </SlideCanvas>
    <SlideToolbar>
      <LayoutSelector />
      <RegenerateButton />
      <ImageEditButton />
    </SlideToolbar>
  </SlidePreviewArea>

  <RightPanel>
    <ChatInput />           // AI 对话输入
    <SlideSettings>
      <LayoutPicker />
      <RenderingModeToggle />
      <ImagePromptEditor />
    </SlideSettings>
    <GenerationProgress>
      <ProgressStep />
    </GenerationProgress>
  </RightPanel>

  <BottomToolbar>
    <ThemeSelector />
    <ExportButton />
    <PresentButton />
    <ShareButton />
    <VersionHistoryButton />
  </BottomToolbar>
</PPTWorkspace>
```

### 4.3 状态管理（扩展现有 Store）

```typescript
// 扩展 aiOfficeStore.ts

interface PPTStore {
  // 当前文档
  currentPPT: PPTDocument | null;

  // 选中的幻灯片
  selectedSlideIndex: number;

  // 生成状态
  isGenerating: boolean;
  generationPhase: "outline" | "planning" | "content" | "images" | "rendering";
  generationProgress: number;
  generationSteps: GenerationStep[];

  // 编辑状态
  editingSlideId: string | null;
  pendingEdits: Map<string, SlideEditRequest>;

  // Actions
  generatePPT: (input: PPTGenerationInput) => Promise<void>;
  regenerateSlide: (
    slideId: string,
    options: RegenerateOptions,
  ) => Promise<void>;
  updateSlideContent: (slideId: string, content: Partial<SlideContent>) => void;
  changeSlideLayout: (slideId: string, layout: SlideLayoutType) => void;
  reorderSlides: (fromIndex: number, toIndex: number) => void;
  deleteSlide: (slideId: string) => void;
  addSlide: (afterIndex: number, spec?: Partial<SlideSpec>) => void;

  // 版本管理
  saveVersion: (description?: string) => void;
  restoreVersion: (versionId: string) => void;
}
```

---

## 五、API 设计

### 5.1 新增 API 端点

```typescript
// 后端路由

// PPT 生成
POST   /api/ai-office/ppt/generate          // 生成完整 PPT（流式）
POST   /api/ai-office/ppt/generate/outline  // 仅生成大纲
POST   /api/ai-office/ppt/generate/slide    // 生成单页

// PPT CRUD
GET    /api/ai-office/ppt/:id               // 获取 PPT
PUT    /api/ai-office/ppt/:id               // 更新 PPT
DELETE /api/ai-office/ppt/:id               // 删除 PPT

// 幻灯片操作
PUT    /api/ai-office/ppt/:id/slides/:slideId           // 更新单页
POST   /api/ai-office/ppt/:id/slides/:slideId/regenerate // 重新生成单页
POST   /api/ai-office/ppt/:id/slides/reorder            // 重排序
POST   /api/ai-office/ppt/:id/slides                    // 添加新页

// 导出
POST   /api/ai-office/ppt/:id/export        // 导出 PPTX/PDF

// 版本
GET    /api/ai-office/ppt/:id/versions      // 版本列表
POST   /api/ai-office/ppt/:id/versions      // 保存版本
POST   /api/ai-office/ppt/:id/versions/:versionId/restore // 恢复版本
```

### 5.2 流式生成响应格式

```typescript
// SSE 事件流

// 进度事件
event: progress
data: {
  "phase": "outline",
  "step": "analyzing_content",
  "progress": 15,
  "message": "正在分析内容结构..."
}

// 大纲完成事件
event: outline_complete
data: {
  "title": "PPT标题",
  "slideCount": 12,
  "outline": [...]
}

// 单页完成事件
event: slide_complete
data: {
  "index": 0,
  "slide": { ... }
}

// 图像生成事件
event: image_generated
data: {
  "slideIndex": 0,
  "imageUrl": "...",
  "prompt": "..."
}

// 完成事件
event: complete
data: {
  "pptId": "...",
  "totalSlides": 12,
  "duration": 45000
}
```

---

## 六、实现路线图

### Phase 1: 基础架构（Week 1-2）

- [ ] 定义核心数据结构（SlideSpec, GeneratedSlide, PPTDocument）
- [ ] 创建 PPTOrchestratorService（总调度器）
- [ ] 创建 SlideBySlideplanningService（逐页规划）
- [ ] 复用并适配 ContentExtractorService
- [ ] 复用并适配 DataFetchingService

### Phase 2: 生成引擎（Week 3-4）

- [ ] 创建 SlideContentGeneratorService（内容生成）
- [ ] 创建 SlideImageGeneratorService（图像生成）
- [ ] 实现并行生成逻辑
- [ ] 创建 SlideRendererService（三种渲染模式）
- [ ] 实现流式 API 端点

### Phase 3: 前端重构（Week 5-6）

- [ ] 重构 PPT 工作区布局
- [ ] 实现缩略图列表组件
- [ ] 实现幻灯片预览组件（三种模式）
- [ ] 实现右侧设置面板
- [ ] 实现生成进度展示
- [ ] 扩展 Zustand Store

### Phase 4: 编辑功能（Week 7-8）

- [ ] 实现单页重新生成
- [ ] 实现布局切换
- [ ] 实现图像重新生成
- [ ] 实现拖拽排序
- [ ] 实现添加/删除页面
- [ ] 实现文本直接编辑

### Phase 5: 导出与完善（Week 9-10）

- [ ] 完善 PPTX 导出（使用 pptxgenjs）
- [ ] 完善 PDF 导出
- [ ] 实现版本管理
- [ ] 实现主题切换
- [ ] 性能优化
- [ ] 测试与修复

---

## 七、技术要点

### 7.1 复用 IMAGE 模块的代码

| 功能       | 原文件                            | 复用方式 |
| ---------- | --------------------------------- | -------- |
| 内容提取   | `content-extractor.service.ts`    | 直接复用 |
| 数据获取   | `data-fetching.service.ts`        | 直接复用 |
| 模型管理   | `ai-model.service.ts`             | 直接复用 |
| 提示词系统 | `ai-image.service.ts:167-442`     | 参考改造 |
| HTML 渲染  | `infographic-template.service.ts` | 参考扩展 |
| 导出服务   | `export.service.ts`               | 扩展复用 |

### 7.2 关键性能优化

1. **并行生成**：内容和图像同时生成
2. **增量渲染**：生成一页显示一页，不等待全部完成
3. **图像懒加载**：缩略图使用低分辨率，预览使用高分辨率
4. **缓存策略**：相同内容的图像提示词缓存

### 7.3 与 Gamma/Genspark 的差异化

| 特性     | Gamma       | Genspark | 我们的方案       |
| -------- | ----------- | -------- | ---------------- |
| 图像来源 | GPT-Image-1 | 多 Agent | 可配置多模型     |
| 布局选择 | AI 建议     | 固定模板 | 逐页智能决策     |
| 数据集成 | 粘贴数据    | 网络搜索 | 复用数据采集系统 |
| 渲染模式 | 单一        | 单一     | 三种模式智能切换 |
| 编辑能力 | 强          | 中       | 单页级精细编辑   |

---

## 八、总结

AI Office 3.0 的核心改进：

1. **双模型架构**：文本模型负责内容，图像模型负责视觉，各司其职
2. **逐页规划**：每一页都有独立的布局和渲染决策，告别"一锅炖"
3. **三种渲染模式**：根据内容特点智能选择最佳渲染方式
4. **并行生成**：内容和图像并行生成，大幅提升速度
5. **精细编辑**：支持单页级别的重新生成、布局切换、图像替换
6. **代码复用**：充分复用 IMAGE 模块的成熟实现

这套方案既借鉴了 Gamma 和 Genspark 的优点，又结合了我们项目已有的 IMAGE 双模型架构，形成了独特的竞争优势。
