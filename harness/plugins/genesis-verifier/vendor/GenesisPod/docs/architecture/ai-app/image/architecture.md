# AI Image 架构文档

> 企业级 AI 图像生成和信息图创建系统，支持多提供商集成、智能 Prompt 增强和混合渲染模式。

**版本**: v2.1
**最后更新**: 2026-02-01
**路径**: `backend/src/modules/ai-app/image/`

---

## 概述

AI Image 模块是 GenesisPod 的图像生成子系统，提供三种核心能力：

1. **AI 图像生成**: 支持 DALL-E、Imagen4、Gemini 等多提供商
2. **信息图生成**: HTML 模板渲染 + Puppeteer 截图，支持 12+ 布局模板
3. **混合模式**: AI 背景 + HTML 结构化内容叠加

### 核心特性

- **多步骤 SSE 流式处理**: 实时推送内容提取、Prompt 增强、图像生成等进度
- **4-Agent 视觉设计团队**: Content → Layout → Visual → Style 协作优化 Prompt
- **智能渲染模式选择**: 根据内容类型自动选择 `ai_image` / `hybrid` / `html_render`
- **品牌套件管理**: 用户自定义配色、字体、Logo，应用到生成结果
- **多格式导出**: PNG / SVG / PDF / PPTX

---

## 核心组件

### 1. Generation Layer (生成层)

#### GenerationService (主门面)

- **文件**: `generation/generation.service.ts`
- **职责**:
  - 协调整个生成流程 (原名 `AiImageService`)
  - SSE 流式处理管理
  - 依赖注入所有子服务
  - 实现 `IMAGE_GENERATION_SERVICE` 接口供 AI Engine 调用
- **关键方法**:
  - `generateImageStream()`: SSE 流式生成
  - `executeStreamGeneration()`: 内部执行逻辑
  - `convertToInfographicContent()`: 转换 Prompt 结果为信息图数据

#### ImageGenerationService (图像生成)

- **文件**: `generation/image-generation.service.ts`
- **职责**:
  - 提供商路由 (OpenAI / Google / Stability / Replicate / Together)
  - API 调用封装
  - 密钥管理 (通过 `SecretsService`)
  - 模型配置获取 (通过 `AIEngineFacade`)
- **支持提供商**:
  - Google: Gemini 2.0 Flash (multimodal), Imagen 4 (generateImages / predict)
  - OpenAI: DALL-E 3
  - Stability AI: Stable Diffusion XL
  - Replicate: Flux / SDXL
  - Together AI: Flux Schnell
- **关键方法**:
  - `callImageGenerationAPI()`: 统一入口，根据 provider 路由
  - `generateWithGemini()` / `generateWithImagen()`: Google 专用
  - `imageToImageWithGemini()`: 图生图 (reference image 支持)
  - `getApiKeyForModel()`: 从 Secret Manager 解析密钥

#### PromptEnhancementService (Prompt 增强)

- **文件**: `generation/prompt-enhancement.service.ts`
- **职责**:
  - 调用 LLM 分析内容，生成结构化 Prompt
  - 解析 AI 返回的 JSON (Information Architecture + Visual Language)
  - 智能渲染模式决策 (检测漫画、短视觉描述、列表内容)
  - 组合最终 Prompt (添加风格、负面词)
- **关键方法**:
  - `enhancePromptWithLLM()`: 通过 `AIEngineFacade.chat()` 调用 LLM
  - `parsePromptEnhancementResponse()`: 解析结构化输出
  - `composeFinalImagePrompt()`: 根据渲染模式组合最终 Prompt
- **依赖**: `AIEngineFacade` (统一 LLM 调用入口)

#### Imagen4PromptService (4-Agent 协作)

- **文件**: `generation/imagen4-prompt.service.ts`
- **职责**:
  - 实现 Visual Design Team 协作流程
  - 4 个 Agent 顺序执行: Content Analyst → Layout Architect → Visual Designer → Style Agent
  - 为 Imagen 4 生成优化的 Prompt
- **流程**:
  1. Content Agent: 分析内容类型、主题、关键要点
  2. Layout Agent: 规划构图、元素布局、视觉层次
  3. Visual Agent: 设计配色、字体、图形风格
  4. Style Agent: 生成最终 Imagen 4 Prompt + Negative Prompt
- **输出**: `{ finalPrompt, negativePrompt, insights, statistics }`

---

### 2. Infographic Layer (信息图层)

#### InfographicService (信息图服务)

- **文件**: `infographic/infographic.service.ts`
- **职责**:
  - HTML 模板渲染
  - Puppeteer 截图生成图片
  - 支持 12+ 布局模板 (cards / timeline / comparison / pyramid 等)
  - 支持 9+ 设计风格 (consulting / tech / minimal / genspark 等)
- **关键方法**:
  - `generateInfographic()`: 主入口，生成信息图
  - `renderTemplate()`: 选择布局模板渲染 HTML
  - `captureScreenshot()`: Puppeteer 截图
- **布局模板**:
  - `cards`: 卡片网格 (默认)
  - `center_visual`: 中心图形 + 周围要点
  - `timeline`: 时间线/流程
  - `comparison`: 左右对比 (限 2 项)
  - `pyramid`: 金字塔/层级
  - `ranking`: 排行榜/横向比较表格
  - `matrix`: 2x2 矩阵/象限图
  - `funnel`: 漏斗图
  - `statistics`: 统计数据展示
  - `checklist`: 清单/要点列表
  - `radial`: 放射状布局

#### InfographicDataService / LayoutService / RenderService

- **文件**: `infographic/services/`
- **职责**: 分离数据处理、布局计算、渲染逻辑 (细分职责)

---

### 3. Storage Layer (存储层)

#### StorageService (存储服务)

- **文件**: `storage/storage.service.ts`
- **职责**:
  - R2/B2 云存储上传
  - 数据库持久化 (GeneratedImage 表)
  - 历史记录管理 (最新 20 张 + 无限收藏)
  - 预签名 URL 自动刷新 (检测过期并重新生成)
  - 收藏、可见性管理
- **关键方法**:
  - `uploadImageToStorage()`: 上传 base64 到 R2
  - `getHistory()`: 获取用户历史 (自动刷新过期 URL)
  - `cleanupOldImages()`: 保留最新 20 张未收藏图片
  - `addBookmark()` / `removeBookmark()`: 收藏管理
  - `updateVisibility()`: PUBLIC / PRIVATE 切换

---

### 4. Brand Kit Layer (品牌套件)

#### BrandKitService (品牌管理)

- **文件**: `brand-kit/brand-kit.service.ts`
- **职责**:
  - 用户品牌配置 CRUD (颜色、字体、Logo、语气)
  - 应用品牌配置到视觉语言
  - 预设品牌套件 (商务蓝、科技紫、极简黑白、活力橙)
- **关键方法**:
  - `create()` / `update()` / `delete()`: 品牌套件 CRUD
  - `applyToVisualLanguage()`: 应用品牌配色到生成结果
  - `getPresetBrandKits()`: 获取预设模板

---

### 5. Export Layer (导出层)

#### ExportService (多格式导出)

- **文件**: `export/export.service.ts`
- **职责**:
  - PNG: Puppeteer 高分辨率截图 (支持 scale 参数)
  - SVG: HTML 包装为 `<foreignObject>`
  - PDF: Puppeteer 打印 (支持 A4 / Letter / 16:9)
  - PPTX: 使用 `pptxgenjs` 导出 PowerPoint (先生成 PNG 再嵌入)
- **关键方法**:
  - `export()`: 统一导出入口，根据 format 路由
  - `exportToPNG()` / `exportToSVG()` / `exportToPDF()` / `exportToPPTX()`

---

### 6. Analytics Layer (分析层)

#### AnalyticsService (图片分析)

- **文件**: `analytics/analytics.service.ts`
- **职责**:
  - 自动打标签 (AI 分析 prompt 生成标签)
  - 风格分析 (提取配色、设计风格趋势)
  - 视觉主题聚类 (相似图片分组)

#### AgentExecutorService (Agent 执行)

- **文件**: `analytics/agent-executor.service.ts`
- **职责**: 执行分析 Agent 的通用框架

---

## 关键流程

### 1. 图像生成流程 (SSE Streaming)

```
用户请求
  ↓
Controller (POST /ai-image/generate/stream)
  ↓
GenerationService.generateImageStream()
  ↓
步骤 1: 内容提取
  - URL 内容抓取 (ContentExtractorService)
  - 文件解析 (PDF/DOCX/TXT)
  - 合并用户 prompt
  ↓
步骤 1.5: 智能数据获取 (可选)
  - 检测需求 (DataFetchingService)
  - 获取实时数据 (API/搜索)
  ↓
步骤 2: AI Prompt 生成
  - 尝试 4-Agent 协作 (Imagen4PromptService)
  - 失败回退到单次 LLM 调用 (PromptEnhancementService)
  - 解析结构化输出 (Information Architecture + Visual Language)
  - 决策渲染模式 (ai_image / hybrid / html_render)
  ↓
步骤 3: 图像生成
  - 如果 html_render / hybrid:
    * 生成信息图 (InfographicService)
    * 如果 hybrid: 先生成 AI 背景图
  - 如果 ai_image:
    * 调用图像生成 API (ImageGenerationService)
  ↓
步骤 4: 存储
  - 上传到 R2 (StorageService)
  - 保存到数据库 (GeneratedImage)
  - 清理旧图片 (保留最新 20 张)
  ↓
返回结果 (SSE complete 事件)
```

### 2. 信息图生成流程

```
PromptInsights (从 LLM 解析)
  ↓
convertToInfographicContent()
  - 提取 Information Architecture (title, sections, metrics)
  - 提取 Visual Language (colors, fonts, design style)
  - 选择模板布局 (templateLayout)
  ↓
InfographicService.generateInfographic()
  - 选择 HTML 模板 (cards / timeline / comparison 等)
  - 渲染 HTML (Handlebars / 自定义模板)
  - 应用设计风格 (consulting / tech / minimal 等)
  - 注入背景图 (如果 hybrid 模式)
  ↓
Puppeteer 截图
  - 启动浏览器
  - 等待字体加载
  - 截图 (PNG / base64)
  ↓
上传到 R2 / 返回 URL
```

### 3. Prompt 增强流程

```
原始内容 (prompt + urls + content + files)
  ↓
PromptEnhancementService.enhancePromptWithLLM()
  - 系统 Prompt: PROMPT_ENHANCEMENT_SYSTEM
  - 通过 AIEngineFacade.chat() 调用 LLM
  - LLM 分析内容，返回 JSON:
    * content_analysis (类型、语言、复杂度)
    * rendering_mode (ai_image / hybrid / html_render)
    * template_layout (布局模板)
    * information_architecture (标题、章节、指标)
    * visual_language (配色、字体、风格)
    * design_journal (设计思路记录)
  ↓
parsePromptEnhancementResponse()
  - 提取 JSON (兼容 code fence)
  - 智能模式决策:
    * 检测漫画/插画 → 强制 ai_image
    * 检测短视觉描述 → 强制 ai_image
    * 检测列表/排名 → 强制 hybrid
  - 验证章节数量 (与用户需求匹配)
  - 返回 PromptEngineeringInsights
  ↓
composeFinalImagePrompt()
  - 如果 ai_image: 使用纯图像 prompt，移除信息图关键词
  - 如果 hybrid/html_render: 添加 "infographic", "data visualization"
  - 添加用户 style 参数
  - 合并 negative prompts
```

### 4. 4-Agent 协作流程 (Imagen4PromptService)

```
输入: { prompt, content, urls, style, aspectRatio, templateLayout }
  ↓
Agent 1: Content Analyst
  - 分析主题、关键要点、情感色调
  - 输出: contentAnalysis
  ↓
Agent 2: Layout Architect
  - 规划构图、元素布局、视觉层次
  - 输入: contentAnalysis
  - 输出: layoutPlan
  ↓
Agent 3: Visual Designer
  - 设计配色、字体、图形风格
  - 输入: contentAnalysis + layoutPlan
  - 输出: visualLanguage
  ↓
Agent 4: Style Agent
  - 生成 Imagen 4 优化的 Prompt
  - 生成 Negative Prompt
  - 输入: contentAnalysis + layoutPlan + visualLanguage
  - 输出: finalPrompt + negativePrompt
  ↓
返回: { finalPrompt, negativePrompt, insights, statistics }
```

---

## 数据模型

### GeneratedImage (数据库表)

```typescript
{
  id: string;
  prompt: string;                    // 用户原始输入
  enhancedPrompt?: string;           // AI 增强后的 Prompt
  imageUrl: string;                  // 图片 URL (R2 预签名 URL)
  width: number;
  height: number;
  userId?: string;
  textModelUsed?: string;            // Prompt 增强使用的模型
  imageModelUsed?: string;           // 图像生成使用的模型
  isBookmarked: boolean;             // 收藏标记
  visibility: "PRIVATE" | "PUBLIC";  // 可见性
  processingSteps: ProcessingStep[]; // SSE 流程记录
  promptInsights: PromptEngineeringInsights; // AI 分析结果
  createdAt: Date;
}
```

### PromptEngineeringInsights (Prompt 分析结果)

```typescript
{
  imagePrompt: string;                          // 最终图像 Prompt
  fallbackPrompt?: string;                      // 备用 Prompt
  backgroundPrompt?: string;                    // 背景图 Prompt (hybrid 模式)
  renderingMode: "ai_image" | "hybrid" | "html_render";
  templateLayout: TemplateLayoutType;           // 布局模板类型
  contentAnalysis?: ContentAnalysis;            // 内容分析 (类型、语言、复杂度)
  designJournal: PromptDesignJournalEntry[];    // 设计思路记录
  informationArchitecture: {                    // 信息架构
    title?: string;
    subtitle?: string;
    heroStatement?: string;
    sections: PromptSection[];                  // 章节 (标题、摘要、要点、指标)
    callToAction?: string;
  };
  visualLanguage: {                             // 视觉语言
    colorPalette: string[];
    primaryColor?: string;
    accentColor?: string;
    backgroundColor?: string;
    textColor?: string;
    typography?: string;
    designStyle?: string;                       // consulting / tech / minimal 等
    fontStyle?: string;                         // sans / serif / mono / rounded
    borderRadius?: string;
    shadowStyle?: string;
  };
  negativeKeywords: string[];                   // 负面词列表
}
```

### BrandKit (品牌套件)

```typescript
{
  id: string;
  userId: string;
  name: string;
  description?: string;
  colors: BrandColor[];          // [{ name, hex, usage: "primary" | "accent" | ... }]
  fonts: BrandFont[];            // [{ name, family, weight, usage: "heading" | "body" }]
  logos?: {
    primary?: string;
    secondary?: string;
    icon?: string;
  };
  voice?: {
    tone: "formal" | "casual" | "friendly" | "professional";
    keywords: string[];
  };
  defaultStyle: DesignStyle;     // consulting / tech / minimal 等
}
```

---

## 文件结构

```
image/
├── ai-image.module.ts                        # 模块定义，依赖注入
├── generation/
│   ├── generation.service.ts                 # 主门面 (原 AiImageService)
│   ├── generation.controller.ts              # REST API + SSE 端点
│   ├── image-generation.service.ts           # 图像生成 API 调用
│   ├── prompt-enhancement.service.ts         # Prompt 增强
│   ├── imagen4-prompt.service.ts             # 4-Agent 协作
│   ├── prompt-templates.ts                   # 系统 Prompt 模板
│   └── index.ts
├── infographic/
│   ├── infographic.service.ts                # 信息图生成主服务
│   ├── infographic.generator.ts              # HTML 生成器
│   ├── infographic.types.ts                  # 类型定义
│   ├── infographic.constants.ts              # 常量 (风格、布局)
│   ├── infographic.utils.ts                  # 工具函数
│   ├── services/
│   │   ├── infographic-data.service.ts       # 数据处理
│   │   ├── infographic-layout.service.ts     # 布局计算
│   │   └── infographic-render.service.ts     # 渲染逻辑
│   ├── templates/
│   │   └── template-base.helper.ts           # HTML 模板基类
│   └── index.ts
├── storage/
│   ├── storage.service.ts                    # 存储服务 (R2 + DB)
│   └── index.ts
├── export/
│   ├── export.service.ts                     # 多格式导出 (PNG/SVG/PDF/PPTX)
│   ├── export.controller.ts                  # 导出 API
│   └── index.ts
├── brand-kit/
│   ├── brand-kit.service.ts                  # 品牌套件管理
│   ├── brand-kit.controller.ts               # 品牌套件 API
│   └── index.ts
├── analytics/
│   ├── analytics.service.ts                  # 图片分析
│   ├── agent-executor.service.ts             # Agent 执行框架
│   └── index.ts
├── core/
│   ├── image.types.ts                        # 核心类型定义
│   ├── image.constants.ts                    # 常量配置
│   ├── image.utils.ts                        # 工具函数
│   ├── engine.types.ts                       # 引擎类型
│   └── index.ts
├── __tests__/
│   └── ai-image.service.spec.ts              # 单元测试
└── index.ts
```

---

## 依赖关系

### 外部依赖

- **AIEngineFacade**: 统一 LLM 调用入口 (获取模型配置、执行 chat)
- **SecretsService**: 密钥管理 (从 Secret Manager 解析 API Key)
- **ContentExtractorService**: 内容提取 (URL、PDF、DOCX 等)
- **DataFetchingService**: 智能数据获取 (检测需求并获取实时数据)
- **R2StorageService**: 云存储 (上传、下载、预签名 URL)
- **PrismaService**: 数据库访问

### 内部依赖

```
GenerationService (主门面)
  ├── ContentExtractorService (内容提取)
  ├── DataFetchingService (数据获取)
  ├── PromptEnhancementService (Prompt 增强)
  │     └── AIEngineFacade (LLM 调用)
  ├── Imagen4PromptService (4-Agent 协作)
  │     └── AIEngineFacade (LLM 调用)
  ├── ImageGenerationService (图像生成)
  │     ├── AIEngineFacade (获取模型配置)
  │     └── SecretsService (密钥管理)
  ├── InfographicService (信息图生成)
  │     └── Puppeteer (HTML 截图)
  └── StorageService (存储)
        ├── R2StorageService (云存储)
        └── PrismaService (数据库)
```

---

## 配置说明

### 环境变量

```bash
# R2 存储 (可选)
R2_ACCOUNT_ID=xxx
R2_ACCESS_KEY_ID=xxx
R2_SECRET_ACCESS_KEY=xxx
R2_BUCKET_NAME=genesis-images
R2_PUBLIC_URL=https://cdn.gens.team

# 数据库
DATABASE_URL=postgresql://...
```

### 模型配置

通过 `AIModel` 表配置，支持的模型类型:

- `AIModelType.CHAT_FAST`: Prompt 增强使用 (GPT-4o-mini / Gemini 1.5 Flash)
- `AIModelType.IMAGE_GENERATION`: 图像生成 (DALL-E 3 / Imagen 4 / Gemini 2.0 Flash)

示例配置:

```typescript
{
  modelId: "imagen-4.0-flash-001",
  displayName: "Imagen 4 Flash",
  provider: "Google",
  modelType: "IMAGE_GENERATION",
  secretKey: "google-ai-api-key",  // 引用 Secret Manager
  apiEndpoint: null,                // 使用默认端点
  isEnabled: true,
  isDefault: true
}
```

---

## API 端点

### 图像生成

```typescript
// SSE 流式生成 (推荐)
POST /api/v1/ai-image/generate/stream
Body: {
  prompt?: string;
  urls?: string;          // 逗号分隔
  content?: string;
  imageModelId?: string;
  style?: string;
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3";
  negativePrompt?: string;
  skipEnhancement?: boolean;
  templateLayout?: "cards" | "timeline" | ...;
}
Response: Server-Sent Events (text/event-stream)
  - type: "step" → { step, title, status, content }
  - type: "complete" → { result: GeneratedImageResult }
  - type: "error" → { error: string }

// 非流式生成
POST /api/v1/ai-image/generate
Body: GenerateImageDto
Response: GeneratedImageResult

// 带文件上传
POST /api/v1/ai-image/generate-with-files
Content-Type: multipart/form-data
Body: { files: File[], ...GenerateImageDto }
```

### 历史记录

```typescript
// 获取历史记录 (最新 20 张 + 无限收藏)
GET /api/v1/ai-image/history
Response: GeneratedImageResult[]

// 获取单张图片
GET /api/v1/ai-image/:id
Response: GeneratedImageResult

// 获取公开图片 (无需认证)
GET /api/v1/ai-image/public/:id
Response: GeneratedImageResult | null

// 删除图片
DELETE /api/v1/ai-image/:id
Response: { success: boolean, message: string }
```

### 收藏管理

```typescript
// 添加收藏
POST /api/v1/ai-image/:id/bookmark
Response: { success: boolean, message: string }

// 移除收藏
DELETE /api/v1/ai-image/:id/bookmark
Response: { success: boolean, message: string }

// 获取所有收藏
GET /api/v1/ai-image/bookmarks
Response: GeneratedImageResult[]
```

### 可见性管理

```typescript
// 更新可见性
POST /api/v1/ai-image/:id/visibility
Body: { visibility: "PRIVATE" | "PUBLIC" }
Response: { success: boolean, message: string }
```

### 清理管理

```typescript
// 手动清理旧图片 (保留最新 20 张 + 收藏)
POST /api/v1/ai-image/cleanup
Response: { deletedCount: number, message: string }

// 管理员清理所有用户 (需要密钥)
POST /api/v1/ai-image/cleanup-all?key=genesis-admin-cleanup-2024
Response: { totalDeleted, usersCleaned, orphanDeleted, message }

// 管理员删除所有图片 (需要密钥)
DELETE /api/v1/ai-image/delete-all?key=genesis-admin-cleanup-2024
Response: { deletedCount: number, message: string }
```

### 分析功能

```typescript
// 自动打标签
POST / api / v1 / ai - image / ai / auto - tag;
Response: {
  (id, prompt);
}
[];

// 分析风格
POST / api / v1 / ai - image / ai / analyze - styles;
Response: {
  (id, enhancedPrompt);
}
[];

// 聚类主题
POST / api / v1 / ai - image / ai / cluster - themes;
Response: {
  (id, imageUrl);
}
[];
```

---

## 最佳实践

### 1. Prompt 优化建议

```typescript
// ✅ 推荐: 提供详细上下文
{
  prompt: "分析 2024 年 AI 发展趋势",
  urls: ["https://example.com/ai-report-2024.pdf"],
  style: "consulting",
  templateLayout: "timeline"
}

// ❌ 避免: 过于简短
{
  prompt: "AI 趋势"
}

// ✅ 推荐: 使用 skipEnhancement 保留原始创意
{
  prompt: "A futuristic cyberpunk city at night, neon lights reflecting on wet streets, flying cars, detailed, 8k",
  skipEnhancement: true,
  aspectRatio: "16:9"
}
```

### 2. 渲染模式选择

```typescript
// AI Image 模式: 纯图像生成 (无结构化内容)
- 短视觉描述 (< 50 字 或 < 15 词)
- 漫画/插画内容 (检测关键词: "漫画", "插画", "comic", "illustration")
- 艺术创作

// Hybrid 模式: AI 背景 + HTML 结构化内容
- 数据可视化 + 精美背景
- 需要精确文字/数字显示
- 复杂图表 (时间线、对比、金字塔)

// HTML Render 模式: 纯 HTML 模板渲染
- 纯数据展示 (无需 AI 背景)
- 快速生成 (节省 API 调用)
```

### 3. 模板布局选择

```typescript
// 时间线: 流程、历史事件、步骤说明
templateLayout: "timeline";

// 对比: 两项产品/方案比较
templateLayout: "comparison";

// 排名: TOP 10 列表、排行榜
templateLayout: "ranking";

// 金字塔: 层级结构 (马斯洛需求、组织架构)
templateLayout: "pyramid";

// 象限图: 2x2 分析 (SWOT、优先级矩阵)
templateLayout: "matrix";
```

### 4. 性能优化

```typescript
// 使用 SSE 流式处理，提供实时反馈
const eventSource = new EventSource("/api/v1/ai-image/generate/stream?prompt=...");
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === "step") {
    // 更新进度 UI
  } else if (data.type === "complete") {
    // 显示最终结果
  }
};

// 预先上传大文件，避免重复传输
POST /api/v1/ai-image/generate-with-files
// 而非在 SSE 请求中携带 base64

// 使用品牌套件，避免重复配置
const brandKit = await createBrandKit({ name: "企业品牌", colors: [...] });
// 后续生成时引用品牌套件
```

### 5. 错误处理

```typescript
try {
  const result = await generateImage({ prompt: "..." });
} catch (error) {
  if (error.message.includes("blocked by safety filters")) {
    // 提示用户修改 Prompt，避免违规内容
  } else if (error.message.includes("No API key")) {
    // 提示管理员配置模型
  } else {
    // 通用错误处理
  }
}
```

---

## 故障排查

### 1. 图像生成失败

**问题**: `No API key found for model`

**解决**:

1. 检查 `AIModel` 表中模型配置
2. 确认 `secretKey` 字段已设置
3. 检查 Secret Manager 中密钥是否存在
4. 验证密钥权限 (Imagen 4 需要启用 API)

**问题**: `Image generation blocked by safety filters`

**解决**:

1. 检查 Prompt 是否包含敏感内容
2. 修改 Prompt，避免违规关键词
3. 添加 `negativePrompt` 排除不当内容
4. 如果是 Gemini/Imagen，查看 API 返回的 `blockReason`

### 2. 信息图布局错误

**问题**: 章节数量不匹配 (用户请求 5 项，AI 只生成 3 项)

**解决**:

1. 检查日志中的 `SECTION COUNT MISMATCH` 警告
2. 在 Prompt 中明确指定数量: "生成 5 个要点"
3. 使用 `templateLayout: "ranking"` 强制列表布局
4. 检查 LLM 返回的 JSON 是否完整

**问题**: 模板样式不符合预期

**解决**:

1. 检查 `visualLanguage.designStyle` 是否有效 (consulting / tech / minimal 等)
2. 使用品牌套件覆盖默认配色
3. 查看 Puppeteer 截图日志，确认字体加载
4. 检查 CSS 渲染是否正确 (浏览器控制台)

### 3. SSE 流式中断

**问题**: SSE 连接断开，进度丢失

**解决**:

1. 检查 Nginx/反向代理缓冲配置:
   ```nginx
   proxy_buffering off;
   proxy_cache off;
   proxy_read_timeout 300s;
   ```
2. 确认客户端 `EventSource` 正确处理 `error` 事件
3. 检查服务端日志，确认是否有异常抛出
4. 使用 POST 方式避免 URL 长度限制

### 4. R2 存储问题

**问题**: 预签名 URL 过期

**解决**:

1. `StorageService.getHistory()` 自动检测并刷新过期 URL
2. 检查 R2 配置中的 `expiresInSeconds` (默认 7 天)
3. 确认 `X-Amz-Date` 和 `X-Amz-Expires` 参数正确
4. 手动调用 `R2StorageService.refreshImageUrl()` 刷新

**问题**: 上传失败

**解决**:

1. 检查 R2 凭证配置 (ACCOUNT_ID, ACCESS_KEY, SECRET_KEY)
2. 确认 Bucket 权限 (允许 PutObject)
3. 检查文件大小限制 (默认 50MB)
4. 查看 S3-compatible API 错误响应

---

## 更新日志

### v2.1 (2026-02-01)

- ✅ 重构为 `GenerationService` 主门面 (原 `AiImageService`)
- ✅ 添加 4-Agent 协作 (`Imagen4PromptService`)
- ✅ 智能渲染模式决策 (ai_image / hybrid / html_render)
- ✅ 预签名 URL 自动刷新
- ✅ 支持 12+ 信息图布局模板
- ✅ 品牌套件管理
- ✅ 多格式导出 (PNG/SVG/PDF/PPTX)

### v2.0 (2025-12-15)

- ✅ 迁移到 `AIEngineFacade` 统一 LLM 调用
- ✅ 集成 `SecretsService` 密钥管理
- ✅ 重构信息图生成流程
- ✅ 添加 SSE 流式处理

### v1.0 (2025-06-01)

- ✅ 初始版本: DALL-E 3 + Gemini 2.0 Flash 支持
- ✅ 基础信息图生成 (cards 布局)
- ✅ R2 存储集成

---

## 参考资料

- [AI Engine 架构文档](../../ai-engine/ai-engine-architecture.md)
- [Imagen 4 API 文档](https://ai.google.dev/gemini-api/docs/imagen)
- [Gemini Multimodal 文档](https://ai.google.dev/gemini-api/docs/vision)
- [DALL-E 3 API 文档](https://platform.openai.com/docs/guides/images)
- [Puppeteer 文档](https://pptr.dev/)
- [pptxgenjs 文档](https://gitbrent.github.io/PptxGenJS/)

---

**维护者**: GenesisPod Team
**联系方式**: tech@gens.team
