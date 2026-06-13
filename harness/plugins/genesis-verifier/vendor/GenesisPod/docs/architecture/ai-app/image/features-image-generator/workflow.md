# IMAGE 生成工作流程技术文档

> **版本**: v2.0.0
> **最后更新**: 2024-12-02
> **状态**: 生产中（数据获取功能需配置 API Key）
>
> 本文档详细描述 GenesisPod ENGINE 的 IMAGE 模块（AI 图片/信息图生成）的完整工作流程，面向产品经理、开发人员和技术架构师。

---

## 产品概述

### 核心价值

IMAGE 模块为用户提供**一键生成高质量信息图和 AI 图片**的能力：

| 用户痛点               | 解决方案                     | 产品价值       |
| ---------------------- | ---------------------------- | -------------- |
| 设计工具学习成本高     | 自然语言描述即可生成         | 降低创作门槛   |
| 信息图文字显示乱码     | 智能模式选择 + HTML 精确渲染 | 专业级输出质量 |
| 需要手动整理数据       | 多源内容自动提取             | 提升效率 10x   |
| 数据信息图没有真实数据 | 智能数据获取（开发中）       | 内容真实可信   |

### 支持的输入类型

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         用户可以输入以下任意组合                            │
├──────────────────────────────────────────────────────────────────────────┤
│  📝 文字提示词      "北美 TOP 10 科技企业财务对比"                          │
│  🔗 URL 链接        YouTube / Bilibili / 任意网页                         │
│  📄 粘贴文本        直接粘贴报告、文章、笔记                                 │
│  📁 上传文件        PDF / Word / Excel / 纯文本                           │
│  🖼️ 参考图片        image-to-image 风格迁移                                │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 目录

- [整体架构](#整体架构)
- [工作流程详解](#工作流程详解)
  - [步骤 0: 输入验证](#步骤-0-输入验证)
  - [步骤 1: 内容提取](#步骤-1-内容提取-content-extraction)
  - [步骤 1.5: 信息获取](#步骤-15-信息获取-data-fetching)
  - [步骤 2: AI Prompt 增强](#步骤-2-ai-prompt-增强-prompt-enhancement)
  - [步骤 3: 图片生成](#步骤-3-图片生成-image-generation)
- [三种渲染模式](#三种渲染模式)
- [模板布局类型](#模板布局类型)
- [关键文件清单](#关键文件清单)
- [已知问题与改进计划](#已知问题与改进计划)
- [实施计划](#实施计划)
- [验收检查清单](#验收检查清单)

---

## 整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                    用户输入 (GenerateImageOptions)                    │
├─────────────────────────────────────────────────────────────────────┤
│  • prompt (文字提示词)                                                │
│  • urls (YouTube/Bilibili/网页链接)                                   │
│  • content (粘贴的文本)                                               │
│  • files (上传的文件: PDF/Word/图片等)                                 │
│  • imageBase64 (参考图片，用于 image-to-image)                         │
│  • templateLayout (用户指定的模板布局，可选)                            │
│  • aspectRatio (宽高比: 1:1, 16:9, 9:16, 4:3)                        │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│               步骤 1: 内容提取 (Content Extraction)                   │
│               ContentExtractorService                                │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│         步骤 1.5: 信息获取 (Data Fetching) - 🔧 集成中                │
│         DataFetchingService - 检测是否需要联网搜索获取真实数据          │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│              步骤 2: AI Prompt 增强 (Prompt Enhancement)             │
│              调用 LLM + PROMPT_ENHANCEMENT_SYSTEM                    │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                步骤 3: 图片生成 (Image Generation)                   │
│                根据 renderingMode 分支执行                           │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        保存到数据库并返回                            │
│                        GeneratedImage 记录                          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 工作流程详解

### 步骤 0: 输入验证

**代码位置**: `ai-image.service.ts:1668-1681`

验证用户至少提供了以下输入之一：

| 输入类型   | 字段名        | 说明                       |
| ---------- | ------------- | -------------------------- |
| 文字提示词 | `prompt`      | 自然语言描述               |
| URL 链接   | `urls`        | 支持 YouTube/Bilibili/网页 |
| 直接粘贴   | `content`     | 任意文本内容               |
| 上传文件   | `files`       | PDF/Word/Excel/TXT         |
| 参考图片   | `imageBase64` | 用于 image-to-image        |

如果没有任何输入，抛出 `BadRequestException`。

---

### 步骤 1: 内容提取 (Content Extraction)

**代码位置**: `ai-image.service.ts:1683-1912`

**职责**: 将各种输入源转换为统一的文本内容。

#### 1.1 处理直接 Prompt

```typescript
if (prompt) {
  contentParts.push(`User prompt: ${prompt}`);
}
```

#### 1.2 处理 URLs

支持多种 URL 类型，自动识别并调用对应提取器：

| URL 类型 | 提取内容      | 技术实现          |
| -------- | ------------- | ----------------- |
| YouTube  | 字幕/转录文本 | YouTubeService    |
| Bilibili | 字幕/视频内容 | BilibiliExtractor |
| 普通网页 | 正文内容      | Readability 算法  |

```typescript
const urlContent = await this.contentExtractor.extractFromUrl(trimmedUrl);
```

**高级特性**: 支持 "URL + 描述" 格式：

```
https://youtube.com/watch?v=xxx 请生成关于这个视频的信息图
```

系统会将用户描述作为生成指令传递给 AI。

#### 1.3 处理粘贴文本

直接作为内容添加，无需额外处理。

#### 1.4 处理上传文件

调用 `ContentExtractorService.extractFromFile()` 处理：

| 文件类型      | 提取方式         |
| ------------- | ---------------- |
| PDF           | pdf-parse 库解析 |
| Word (.docx)  | mammoth 库解析   |
| Excel (.xlsx) | xlsx 库解析      |
| 纯文本        | 直接读取         |

#### 1.5 处理参考图片

参考图片不会被解析为内容，而是直接传递给后续的 image-to-image 生成流程。

**输出**: `inputContent` - 合并后的全部内容文本

---

### 步骤 1.5: 信息获取 (Data Fetching)

> **当前状态**: ✅ 已完成集成
> **代码位置**: `data-fetching.service.ts`（完整实现，~550 行）
> **模块注册**: ✅ 已注册到 `ai-image.module.ts`
> **集成位置**: `ai-image.service.ts` 步骤 1 后、步骤 2 前

#### 问题背景

当用户请求需要真实数据的信息图时（如 "北美 TOP 10 科技企业财务数据对比"），系统无法主动获取数据，导致 AI 生成占位符内容（X%, Y%, Z%）。

**典型失败案例分析**（基于 Gemini 思考链）：

```
用户请求: "北美 TOP 10 科技企业财务数据，完成增长率横评"

理想的数据获取流程:
1. 识别目标实体: Apple, Microsoft, Alphabet, Amazon, NVIDIA, Meta, Tesla, Broadcom, Salesforce, Adobe
2. 确定数据指标: Revenue (营收), Net Income (净利润), Growth Rate (增长率)
3. 确定时间范围: FY2014 - FY2023 (10年对比)
4. 多源数据验证: 交叉核对 Yahoo Finance, MacroTrends, 官方财报
5. 结构化输出: 公司名 + 具体数值 + 单位 + 增长率

当前问题:
- 系统无法自动执行上述流程
- AI 只能生成占位符: "Apple: X% growth, Microsoft: Y% growth..."
```

#### 已实现功能

DataFetchingService 已完成以下核心功能：

**1. 智能检测数据获取需求**

```typescript
detectDataFetchingNeed(content: string): {
  needsFetching: boolean;
  intent?: string;  // top_ranking | comparison | trend_analysis | data_query
  queries: string[];
}
```

检测条件矩阵：

| 检测维度 | 关键词示例                      | 权重 |
| -------- | ------------------------------- | ---- |
| 动作指令 | 获取、查询、搜索、比较、分析    | 必需 |
| 实时性   | 最新、当前、2024年、近期        | 增强 |
| 数据类型 | TOP N、排名、增长率、营收、利润 | 必需 |
| 实体类型 | 企业、公司、市场、行业、品牌    | 增强 |

触发条件: `(动作指令 AND 数据类型) OR (实时性 AND 实体类型)`

**2. 意图识别与查询生成**

| 意图类型         | 触发特征         | 生成的查询示例                                               |
| ---------------- | ---------------- | ------------------------------------------------------------ |
| `top_ranking`    | TOP N、排名、前X | "北美 科技 企业排名 2024", "top tech companies revenue 2024" |
| `comparison`     | 对比、比较、vs   | "Apple vs Microsoft revenue comparison"                      |
| `trend_analysis` | 趋势、变化、增长 | "AI market growth trend 2024"                                |
| `data_query`     | 数据、统计、指标 | "Tesla revenue 2023 financial data"                          |

**3. 多搜索 API 支持**

| API        | 优先级 | 特点                      | 配置来源             |
| ---------- | ------ | ------------------------- | -------------------- |
| Perplexity | 1      | AI 驱动搜索，结果更结构化 | `PERPLEXITY_API_KEY` |
| Serper     | 2      | Google 搜索 API，覆盖面广 | `SERPER_API_KEY`     |
| Tavily     | 3      | 专为 AI Agent 设计        | `TAVILY_API_KEY`     |

**4. 结构化数据解析**

```typescript
interface StructuredDataItem {
  name: string; // 实体名称（如 "Apple Inc."）
  value: string | number; // 数据值（如 394.3）
  unit?: string; // 单位（如 "Billion USD"）
  comparison?: string; // 对比值（如 "+8.2%"）
  trend?: "up" | "down" | "stable";
  source?: string; // 数据来源（如 "FY2023 Annual Report"）
  fiscalYear?: string; // 财年（如 "2023"）
}
```

**5. 数据验证与清洗**

针对财务数据的特殊处理：

- 财年对齐（不同公司财年结束日期不同）
- 货币统一（转换为 USD）
- 负值处理（净亏损的增长率计算）
- 多源交叉验证

#### 预期工作流程

```
用户输入: "北美 TOP 10 科技企业财务数据对比"
                    │
                    ▼
         ┌──────────────────────────────────────┐
         │ Step 1: 意图识别                      │
         │ intent = "top_ranking"               │
         │ entities = ["北美", "科技企业"]        │
         │ metrics = ["财务数据"]                │
         └──────────────────────────────────────┘
                    │
                    ▼
         ┌──────────────────────────────────────┐
         │ Step 2: 查询生成                      │
         │ queries = [                          │
         │   "top 10 north america tech companies by market cap 2024",
         │   "Apple Microsoft revenue profit 2023 2024",
         │   "NVIDIA Tesla financial growth rate"
         │ ]                                    │
         └──────────────────────────────────────┘
                    │
                    ▼
         ┌──────────────────────────────────────┐
         │ Step 3: 并行搜索                      │
         │ Perplexity API → 结构化财务数据       │
         │ (超时 5s，失败则跳过)                  │
         └──────────────────────────────────────┘
                    │
                    ▼
         ┌──────────────────────────────────────┐
         │ Step 4: 数据解析与验证                │
         │ - 提取公司名、营收、利润、增长率       │
         │ - 交叉验证数据一致性                  │
         │ - 格式化为 StructuredDataItem[]      │
         └──────────────────────────────────────┘
                    │
                    ▼
         ┌──────────────────────────────────────┐
         │ Step 5: 内容增强                      │
         │ enrichedContent = originalContent +  │
         │ "## 真实数据                         │
         │ - Apple: $394.3B revenue (+8.2%)    │
         │ - Microsoft: $211.9B revenue (+12%) │
         │ - ..."                               │
         └──────────────────────────────────────┘
                    │
                    ▼
              继续步骤 2 (AI Prompt 增强)
```

#### 集成状态

| 任务                                                       | 优先级 | 状态      | 说明                     |
| ---------------------------------------------------------- | ------ | --------- | ------------------------ |
| 在 `ai-image.module.ts` 中注册 DataFetchingService         | P0     | ✅ DONE   | 添加 import 和 providers |
| 在 `ai-image.service.ts` 注入 DataFetchingService          | P0     | ✅ DONE   | constructor 注入         |
| 在 `generateImage()` 步骤 1 后调用 `processDataFetching()` | P0     | ✅ DONE   | 核心集成点，含 5s 超时   |
| 在 `generateImageStream()` 同步集成数据获取                | P0     | ✅ DONE   | 流式接口也支持           |
| 添加数据获取超时 (5s)                                      | P1     | ✅ DONE   | Promise.race 实现        |
| 添加降级策略                                               | P1     | ✅ DONE   | 超时/失败时继续生成      |
| 添加数据缓存 (15分钟)                                      | P2     | ✅ DONE   | 内存缓存，最多100条      |
| 添加 Tavily API 支持                                       | P2     | ✅ DONE   | 第三优先级               |
| 配置搜索 API Key                                           | P0     | ⚠️ 待配置 | 见下方环境变量说明       |

#### 环境变量配置

在 **Railway** 中配置以下任一环境变量即可启用数据获取功能：

**Railway 配置步骤：**

1. 进入 Railway 项目 → backend 服务
2. 点击 **Variables** 选项卡
3. 添加以下任一环境变量（按优先级选择一个即可）：

| 变量名               | 优先级 | 说明                                             |
| -------------------- | ------ | ------------------------------------------------ |
| `PERPLEXITY_API_KEY` | 1      | Perplexity AI（推荐，AI 驱动搜索，结果最结构化） |
| `TAVILY_API_KEY`     | 2      | Tavily（专为 AI Agent 设计）                     |
| `SERPER_API_KEY`     | 3      | Serper Google 搜索                               |

**获取 API Key：**

- Perplexity: https://www.perplexity.ai/settings/api （推荐，免费额度较多）
- Tavily: https://app.tavily.com/ （1000 次/月免费）
- Serper: https://serper.dev/ （2500 次免费）

**验证配置：**
配置后重新部署，在日志中搜索 `[STEP 1.5]` 可查看数据获取是否生效。

#### 边界情况处理

| 场景               | 处理策略                                     |
| ------------------ | -------------------------------------------- |
| 搜索 API 不可用    | 跳过数据获取，继续使用 AI 生成（会有占位符） |
| 搜索超时 (>5s)     | 中断搜索，继续流程                           |
| 无法解析结构化数据 | 将原始搜索结果作为文本附加到内容             |
| 数据不一致         | 取多数源一致的值，或标注数据来源             |
| 用户未请求数据获取 | `needsFetching=false`，跳过此步骤            |

---

### 步骤 2: AI Prompt 增强 (Prompt Enhancement)

**代码位置**: `ai-image.service.ts:1915-2132`

**职责**: 调用 LLM 分析内容，生成结构化的设计决策。

#### 智能模式选择（核心逻辑）

**STEP 0: 视觉场景 vs 信息图判断**

| 输入特征                         | 判定结果      | 示例                   |
| -------------------------------- | ------------- | ---------------------- |
| 短提示词 (< 30字) + 无结构化特征 | `ai_image`    | "猫嗅毛线"、"日落风景" |
| 长内容 / 结构化数据              | `hybrid`      | "AI技术发展趋势分析"   |
| 纯数据表格                       | `html_render` | 财务报表、规格表       |

**代码级强制检测** (`ai-image.service.ts:562-568`):

```typescript
const promptLength = fallbackPrompt.length;
const wordCount = fallbackPrompt
  .split(/[\s，。、！？；：""''【】《》（）]+/)
  .filter((w) => w.length > 0).length;
const hasStructuredContent =
  /\d+%|\d+\.\d+|第[一二三四五六七八九十]+|步骤|流程|对比|分析|报告|数据|统计|方案|计划/.test(
    fallbackPrompt,
  );
const isShortVisualPrompt =
  (promptLength < 30 || wordCount < 10) && !hasStructuredContent;

if (isShortVisualPrompt && insights.renderingMode !== "ai_image") {
  insights.renderingMode = "ai_image"; // 强制使用纯 AI 图片模式
}
```

这段代码解决了**短视觉提示词被误判为信息图**的问题，确保 "猫嗅毛线" 这类描述直接生成 AI 图片，而不是带乱码文字的信息图。

#### 输出结构 (PromptEngineeringInsights)

```typescript
interface PromptEngineeringInsights {
  // 核心输出
  imagePrompt: string; // 最终图片生成提示词
  fallbackPrompt?: string; // 备用提示词
  backgroundPrompt?: string; // 背景生成提示词 (hybrid 模式)
  renderingMode: RenderingMode; // "ai_image" | "hybrid" | "html_render"
  templateLayout: TemplateLayoutType;

  // 内容分析
  contentAnalysis?: ContentAnalysis;
  informationArchitecture: PromptInformationArchitecture;

  // 视觉设计
  visualLanguage: PromptVisualLanguage;
  layoutPlan: string[];

  // 质量保障
  qualityChecks: string[];
  negativeKeywords: string[];

  // 决策追踪
  designJournal: PromptDesignJournalEntry[];
  styleShiftReasoning: string[];
  inspiration: string[];
}
```

---

### 步骤 3: 图片生成 (Image Generation)

**代码位置**: `ai-image.service.ts:2135-2370`

根据 `renderingMode` 分三个分支执行：

#### 分支 A: ai_image 模式

```
纯 AI 图片生成
     │
     ▼
callImageGenerationAPI(final_prompt)
     │
     └─ 或 callImageToImageAPI() (如有参考图片)
     │
     ▼
输出: 纯 AI 生成的图片 (无文字叠加)
```

**适用场景**: 短视觉场景描述

- 风景、人物、物品描写
- 艺术创作、概念设计
- 无需精确文字的图片

#### 分支 B: hybrid 模式（推荐用于信息图）

```
混合模式 (AI 背景 + HTML 文字)
     │
     ├─ 1. callImageGenerationAPI(background_prompt)
     │      生成装饰性背景 (明确不含文字)
     │
     ├─ 2. convertToInfographicContent(promptInsights)
     │      转换为结构化信息图内容
     │
     └─ 3. InfographicTemplateService.generateInfographic()
            渲染 HTML 模板 + 背景叠加
     │
     ▼
输出: AI 背景 + HTML 文字精确渲染的信息图
```

**核心优势**:

- AI 背景提供视觉吸引力
- HTML 渲染确保文字 100% 清晰
- 支持复杂布局和数据可视化

#### 分支 C: html_render 模式

```
纯 HTML 渲染
     │
     ├─ 1. convertToInfographicContent(promptInsights)
     │
     └─ 2. InfographicTemplateService.generateInfographic()
            渲染纯 HTML 模板 (纯色/渐变背景)
     │
     ▼
输出: 纯 HTML 渲染的信息图 (无 AI 背景)
```

**适用场景**:

- 纯数据表格
- 极简设计风格
- 需要最快响应速度

---

## 三种渲染模式

| 模式          | 适用场景        | 技术实现                       | 优点                | 缺点                |
| ------------- | --------------- | ------------------------------ | ------------------- | ------------------- |
| `ai_image`    | 短视觉场景描述  | 纯 AI API (Imagen/DALL-E/Flux) | 视觉效果最好        | AI 生成的文字会乱码 |
| `hybrid`      | 信息图/报告     | AI 背景 + Puppeteer HTML       | 文字精确 + 背景美观 | 生成时间较长        |
| `html_render` | 纯数据/简洁设计 | 纯 Puppeteer HTML              | 速度最快，文字完美  | 视觉效果较朴素      |

### 模式选择流程图

```
               用户输入
                  │
                  ▼
         ┌───────────────────┐
         │ 内容长度 < 30 字？ │
         └───────────────────┘
              │YES      │NO
              ▼         ▼
    ┌─────────────┐  ┌─────────────────────┐
    │ 检查结构化   │  │ 检查是否需要文字    │
    │ 特征关键词   │  │ 精确渲染            │
    └─────────────┘  └─────────────────────┘
       │NO    │YES        │YES       │NO
       ▼       ▼          ▼          ▼
  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
  │ai_image│ │ hybrid │ │ hybrid │ │ai_image│
  └────────┘ └────────┘ └────────┘ └────────┘
```

---

## 模板布局类型

| 模板            | 适用场景                | 最佳内容项数 | 示例                   |
| --------------- | ----------------------- | ------------ | ---------------------- |
| `cards`         | 3+ 个并列话题           | 3-6          | 产品特性列表、新闻摘要 |
| `center_visual` | 一个核心概念 + 周围要点 | 4-8          | 品牌定位、核心价值     |
| `timeline`      | 时间序列/流程步骤       | 4-8          | 项目计划、历史发展     |
| `comparison`    | **仅 2 个选项**对比     | 2            | A vs B、优缺点         |
| `pyramid`       | 层级结构                | 3-5          | 组织架构、优先级       |
| `radial`        | 中心辐射关系            | 4-8          | 生态系统、关系网络     |
| `statistics`    | 数据/指标密集           | 4-12         | KPI 仪表盘、调查结果   |
| `checklist`     | 清单/要点列表           | 5-10         | 最佳实践、注意事项     |
| `funnel`        | 漏斗/转化流程           | 3-6          | 销售漏斗、用户转化     |
| `matrix`        | 2x2 矩阵分析            | 4            | 优先级矩阵、BCG 矩阵   |

### 模板选择规则

```
内容结构分析
      │
      ▼
┌─────────────────────────────────────┐
│ 规则 1: comparison 仅限 2 个选项     │
│ 规则 2: 3+ 选项优先使用 cards        │
│ 规则 3: 时序数据优先使用 timeline    │
│ 规则 4: 数字密集优先使用 statistics  │
│ 规则 5: 超过 6 个卡片建议分页/精简   │
└─────────────────────────────────────┘
```

---

## 关键文件清单

| 文件                                                           | 职责                                                   | 代码行数 | 状态    |
| -------------------------------------------------------------- | ------------------------------------------------------ | -------- | ------- |
| `backend/src/modules/ai-image/ai-image.service.ts`             | 主服务：流程控制、LLM 调用、渲染模式决策、数据获取集成 | ~3200    | ✅ 生产 |
| `backend/src/modules/ai-image/content-extractor.service.ts`    | 内容提取：YouTube字幕、网页、PDF等                     | ~500     | ✅ 生产 |
| `backend/src/modules/ai-image/infographic-template.service.ts` | HTML 模板渲染：各种布局模板                            | ~2000    | ✅ 生产 |
| `backend/src/modules/ai-image/data-fetching.service.ts`        | 数据获取：搜索API、结构化解析、缓存                    | ~550     | ✅ 生产 |
| `backend/src/modules/ai-image/ai-image.module.ts`              | 模块定义：服务注册和导出                               | ~36      | ✅ 生产 |
| `frontend/components/ai-image/ImageGenerator.tsx`              | 前端 UI 组件                                           | ~2000    | ✅ 生产 |

---

## 已知问题与改进计划

### 问题 1: 缺少数据获取步骤集成（已解决 ✅）

**修复时间**: 2024-12-02

**已完成**:

1. ✅ 在 `ai-image.module.ts` 注册 `DataFetchingService`
2. ✅ 在 `generateImage()` 和 `generateImageStream()` 步骤 1 后调用 `processDataFetching()`
3. ✅ 添加 5 秒超时保护和优雅降级
4. ✅ 添加 15 分钟内存缓存
5. ⚠️ 待运维配置搜索 API Key

**后续验证**:
配置 API Key 后验证以下场景：

```
输入: "北美 TOP 10 科技企业财务增长率对比"
期望: Apple 394B (+8%), Microsoft 211B (+12%), ...
```

### 问题 2: 短视觉提示词误判（已解决 ✅）

**现状**: 已通过代码级强制检测修复

**修复版本**: 2024-11-30

**修复代码**: `ai-image.service.ts:562-568`

### 问题 3: comparison 模板滥用

**现状**: comparison 模板有时被用于 3+ 个选项的场景，导致布局拥挤

**改进建议**:

- 在 Prompt Enhancement 阶段严格限制 comparison 仅用于 2 选项
- 3+ 选项自动切换为 cards 或 statistics 模板
- 超过 6 个卡片时建议用户精简内容

---

## 实施计划

### Phase 1: 智能数据获取集成 ✅ COMPLETED

**目标**: 将已实现的 DataFetchingService 集成到主流程

**完成时间**: 2024-12-02

**完成内容**:

| 任务                                  | 优先级 | 状态      | 说明                 |
| ------------------------------------- | ------ | --------- | -------------------- |
| 1.1 注册 DataFetchingService 到模块   | P0     | ✅ DONE   | `ai-image.module.ts` |
| 1.2 在 generateImage 中集成调用       | P0     | ✅ DONE   | 步骤 1 和步骤 2 之间 |
| 1.3 在 generateImageStream 中集成调用 | P0     | ✅ DONE   | 流式接口同步支持     |
| 1.4 添加超时保护 (5s)                 | P1     | ✅ DONE   | Promise.race 实现    |
| 1.5 添加优雅降级                      | P1     | ✅ DONE   | 失败时继续主流程     |
| 1.6 添加 15 分钟内存缓存              | P2     | ✅ DONE   | 避免重复请求         |
| 1.7 添加 Tavily API 支持              | P2     | ✅ DONE   | 第三优先级           |
| 1.8 配置搜索 API Key                  | P0     | ⚠️ 待运维 | 需在 .env 中配置     |

**验收标准**:

- [x] 代码编译无错误
- [x] 不需要数据获取的请求不受影响
- [x] 响应时间增加不超过 5 秒（超时保护）
- [x] 搜索失败时优雅降级，不阻塞主流程
- [ ] "北美 TOP 10 科技企业财务数据" 能返回真实数据（需配置 API Key 后测试）
- [ ] 搜索结果正确格式化为结构化数据（需配置 API Key 后测试）

---

### Phase 2: 模板智能选择优化 (Priority: P1)

**目标**: 优化模板选择逻辑，避免模板滥用

**任务清单**:

| 任务                          | 优先级 | 状态    | 说明            |
| ----------------------------- | ------ | ------- | --------------- |
| 2.1 限制 comparison 仅 2 选项 | P1     | PENDING | Prompt 阶段校验 |
| 2.2 完善 statistics 模板      | P1     | PENDING | 适合数据密集型  |
| 2.3 添加内容分页建议          | P2     | PENDING | 超过 6 项时提示 |

---

### Phase 3: 视觉质量提升 (Priority: P1)

**目标**: 提升信息图视觉效果，对标 Genspark 质量

**任务清单**:

| 任务               | 优先级 | 状态         | 说明                        |
| ------------------ | ------ | ------------ | --------------------------- |
| 3.1 玻璃态效果优化 | P1     | ✅ COMPLETED | Glassmorphism CSS           |
| 3.2 渐变配色系统   | P1     | ✅ COMPLETED | genspark/tech_gradient 预设 |
| 3.3 SVG 连接线     | P2     | PENDING      | center_visual/radial 模板   |
| 3.4 动态图标库     | P2     | PENDING      | 更丰富的图标选择            |

---

### Phase 4: 错误处理与监控 (Priority: P2)

**目标**: 提升系统稳定性和可观测性

**任务清单**:

| 任务                  | 优先级 | 状态    | 说明                    |
| --------------------- | ------ | ------- | ----------------------- |
| 4.1 JSON 解析错误恢复 | P2     | PENDING | AI 输出格式错误时的回退 |
| 4.2 生成质量评分      | P3     | PENDING | 自动评估输出质量        |
| 4.3 Prometheus 指标   | P3     | PENDING | 监控生成成功率/延迟     |
| 4.4 用户反馈收集      | P3     | PENDING | 收集用户满意度数据      |

---

## 验收检查清单

### 功能验收

- [ ] 短视觉提示词正确使用 ai_image 模式
- [ ] 信息图请求正确使用 hybrid 模式
- [ ] 数据请求能获取真实数据（Phase 1 完成后）
- [ ] 模板选择符合内容结构
- [ ] 文字渲染清晰无乱码
- [ ] URL 内容提取成功率 > 90%
- [ ] 文件上传解析成功率 > 95%

### 性能验收

| 场景          | 目标响应时间 | 当前状态  |
| ------------- | ------------ | --------- |
| 简单 AI 图片  | < 8s         | ✅ 达标   |
| HTML 信息图   | < 12s        | ✅ 达标   |
| Hybrid 信息图 | < 15s        | ✅ 达标   |
| 含数据获取    | < 20s        | 🔧 待测试 |

### 质量验收

- [ ] 信息图视觉效果对标 Genspark
- [ ] 配色方案专业统一
- [ ] 布局清晰易读
- [ ] 无明显设计缺陷
- [ ] 移动端适配良好

---

## 附录：完整数据流示意图

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              完整数据流                                       │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  用户输入                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │ { prompt, urls, content, files, imageBase64, templateLayout, ... }      │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                       │
│                                      ▼                                       │
│  步骤 0: 输入验证 (line 1668-1681)                                            │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │ 检查: prompt || urls || content || files || imageBase64                 │ │
│  │ 失败: 抛出 BadRequestException                                           │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                       │
│                                      ▼                                       │
│  步骤 1: 内容提取 (line 1683-1912)                                            │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │ ContentExtractorService                                                 │ │
│  │   ├─ extractFromUrl(youtube/bilibili/web)                               │ │
│  │   ├─ extractFromFile(pdf/docx/xlsx)                                     │ │
│  │   └─ 合并为 inputContent: string                                         │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                       │
│                                      ▼                                       │
│  步骤 1.5: 数据获取 (data-fetching.service.ts) 🔧 待集成                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │ DataFetchingService                                                     │ │
│  │   ├─ detectDataFetchingNeed(inputContent)                               │ │
│  │   ├─ callSearchAPI(Perplexity/Serper)                                   │ │
│  │   └─ enrichContent() 合并真实数据到 inputContent                          │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                       │
│                                      ▼                                       │
│  步骤 2: Prompt 增强 (line 1915-2132)                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │ LLM (Gemini/OpenAI) + PROMPT_ENHANCEMENT_SYSTEM                         │ │
│  │   ├─ 分析内容结构                                                        │ │
│  │   ├─ 选择 renderingMode: ai_image | hybrid | html_render                │ │
│  │   ├─ 选择 templateLayout: cards | timeline | ...                        │ │
│  │   ├─ 生成 informationArchitecture (sections, metrics, bullets)          │ │
│  │   ├─ 生成 visualLanguage (colors, typography, style)                    │ │
│  │   └─ 输出 PromptEngineeringInsights                                      │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                       │
│                            ┌─────────┼─────────┐                             │
│                            │         │         │                             │
│                            ▼         ▼         ▼                             │
│  步骤 3: 图片生成 (line 2135+)                                                │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐                         │
│  │ ai_image    │   │ hybrid      │   │ html_render │                         │
│  │             │   │             │   │             │                         │
│  │ 纯 AI 图片   │   │ AI 背景 +   │   │ 纯 HTML     │                         │
│  │ 生成        │   │ HTML 文字   │   │ 渲染        │                         │
│  │             │   │             │   │             │                         │
│  │ Imagen/     │   │ Imagen +    │   │ Puppeteer   │                         │
│  │ DALL-E/Flux │   │ Puppeteer   │   │             │                         │
│  └─────────────┘   └─────────────┘   └─────────────┘                         │
│                            │         │         │                             │
│                            └─────────┼─────────┘                             │
│                                      │                                       │
│                                      ▼                                       │
│  输出                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │ GeneratedImageResult {                                                  │ │
│  │   id, imageUrl, prompt, enhancedPrompt,                                 │ │
│  │   promptInsights, negativePrompt,                                       │ │
│  │   width, height, createdAt, processingSteps,                            │ │
│  │   textModelUsed, imageModelUsed                                         │ │
│  │ }                                                                       │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 更新历史

| 版本   | 日期       | 更新内容                                                                                                                                       |
| ------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| v2.0.0 | 2024-12-02 | **完成 DataFetchingService 集成**：模块注册、generateImage/generateImageStream 集成、5s超时保护、15分钟缓存、Tavily API 支持、环境变量配置说明 |
| v1.2.0 | 2024-12-02 | 根据 Gemini 思考链分析，大幅扩展步骤 1.5 数据获取文档：添加典型失败案例、检测条件矩阵、意图识别表、预期工作流程图、边界情况处理                |
| v1.1.0 | 2024-12-02 | 更新 DataFetchingService 实现状态；修正代码行号引用；添加产品视角描述；完善验收标准                                                            |
| v1.0.0 | 2024-12-02 | 初始版本                                                                                                                                       |
