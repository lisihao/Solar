# GenesisPod v2.0 产品需求文档 (PRD)

> **文档版本**: v2.1
> **创建日期**: 2024-12-02
> **最后更新**: 2024-12-02
> **文档状态**: Draft
> **负责人**: Product Team
>
> **v2.1 更新说明**:
>
> - 统一渲染模式：图像模型(背景/视觉) + HTML/SVG(文字/图表)
> - 明确使用系统配置的默认模型（AIModel 表）

---

## 目录

1. [产品概述](#一产品概述)
2. [竞品分析](#二竞品分析)
3. [核心架构](#三核心架构文本模型图像模型htmlsvg)
4. [功能模块详细设计](#四功能模块详细设计)
5. [渲染引擎设计](#五渲染引擎设计)
6. [数据模型设计](#六数据模型设计)
7. [API 接口设计](#七api-接口设计)
8. [用户体验设计](#八用户体验设计)
9. [版本规划](#九版本规划)
10. [成功指标](#十成功指标)
11. [风险与对策](#十一风险与对策)

---

## 一、产品概述

### 1.1 产品定位

**GenesisPod** 是一款企业级 AI 驱动视觉内容生成引擎，采用 **文本模型 + 图像模型 + HTML + SVG** 的组合路径，融合：

| 竞品                           | 核心能力借鉴                             |
| ------------------------------ | ---------------------------------------- |
| **Napkin AI**                  | 多Agent协作、矢量图形输出、元素可编辑    |
| **Canva Magic Studio**         | 品牌一致性系统、多模态设计、Magic Switch |
| **Nano Banana Pro** (Imagen 4) | 4K高质量图像、精准文字渲染、局部编辑     |

### 1.2 核心价值主张

```
"从文字到专业视觉，智能理解 → 精准渲染 → 自由编辑"
```

- **智能**：文本模型深度理解内容结构，自动选择最佳呈现方式
- **精准**：HTML/SVG 确保文字100%清晰可读，图像模型提供高质量背景/插图
- **灵活**：矢量输出可编辑每个元素，支持品牌定制
- **高效**：5秒出图，自然语言迭代优化

### 1.3 目标用户

| 用户类型      | 核心需求           | 典型场景                         |
| ------------- | ------------------ | -------------------------------- |
| 商务专业人士  | 快速生成汇报材料   | 周报、月报、提案、会议纪要可视化 |
| 内容创作者    | 图文并茂的内容     | 公众号封面、博客配图、社媒卡片   |
| 教育工作者    | 复杂概念可视化     | 课件、讲义、思维导图、知识图谱   |
| 产品/市场团队 | 品牌一致的营销物料 | 产品介绍、功能对比、活动海报     |
| 研究人员      | 论文/报告图表      | 数据可视化、流程图、架构图       |

### 1.4 与现有系统关系

GenesisPod 是 Genesis 平台的核心图像生成模块，与以下模块协同：

```
┌─────────────────────────────────────────────────────────────┐
│                    Genesis Platform                         │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ AI Research │  │ AI Office   │  │ GenesisPod     │  │
│  │ (资源研究)   │  │ (文档生成)  │  │ (视觉内容生成) ◀───│  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
│         │                │                     │             │
│         └────────────────┴─────────────────────┘             │
│                          ↓                                   │
│                   统一资源/内容池                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、竞品分析

### 2.1 竞品功能对标矩阵

| 功能维度     | Napkin AI | Canva Magic | Nano Banana Pro | Genesis 现状 | **Genesis v2.0** |
| ------------ | :-------: | :---------: | :-------------: | :----------: | :--------------: |
| **输入理解** |
| 文本内容分析 |    ✅     |     ⚠️      |       ⚠️        |      ✅      |       ✅+        |
| URL 智能抓取 |    ❌     |     ❌      |       ❌        |      ✅      |        ✅        |
| 文件解析     |    ⚠️     |     ✅      |       ✅        |      ✅      |        ✅        |
| 图片参考     |    ❌     |     ✅      |       ✅        |      ✅      |        ✅        |
| **AI 能力**  |
| 多Agent协作  |    ✅     |     ⚠️      |       ❌        |      ❌      |        ✅        |
| 自动布局选择 |    ✅     |     ✅      |       ❌        |      ✅      |       ✅+        |
| 内容结构识别 |    ✅     |     ⚠️      |       ⚠️        |      ✅      |       ✅+        |
| 多语言支持   | ✅ (60+)  |   ✅ (21)   |       ✅        |  ✅ (中/英)  |        ✅        |
| **渲染能力** |
| 文字渲染质量 | ✅ (SVG)  | ✅ (Canvas) |       ⚠️        |      ⚠️      |  ✅ (HTML/SVG)   |
| 高质量背景   |    ⚠️     |     ✅      |       ✅        |      ✅      |        ✅        |
| 4K 输出      |    ❌     |     ⚠️      |       ✅        |      ❌      |        ✅        |
| 混合渲染     |    ❌     |     ⚠️      |       ❌        |      ✅      |       ✅+        |
| **编辑能力** |
| 元素可编辑   |    ✅     |     ✅      |       ⚠️        |      ❌      |        ✅        |
| SVG 矢量输出 |    ✅     |     ✅      |       ❌        |      ❌      |        ✅        |
| 自然语言微调 |    ✅     |     ✅      |       ✅        |      ❌      |        ✅        |
| 局部重绘     |    ❌     |     ✅      |       ✅        |      ❌      |        ✅        |
| 版本历史     |    ⚠️     |     ✅      |       ❌        |      ⚠️      |        ✅        |
| **品牌系统** |
| 品牌配色     |    ✅     |     ✅      |       ⚠️        |      ⚠️      |        ✅        |
| 品牌字体     | ✅ (Pro)  |     ✅      |       ❌        |      ❌      |        ✅        |
| 品牌模板     |    ⚠️     |     ✅      |       ❌        |      ❌      |        ✅        |
| 品牌语调     |    ❌     |     ✅      |       ❌        |      ❌      |        P2        |
| **输出格式** |
| PNG          |    ✅     |     ✅      |       ✅        |      ✅      |        ✅        |
| SVG          | ✅ (Pro)  |     ✅      |       ❌        |      ❌      |        ✅        |
| PDF          |    ✅     |     ✅      |       ❌        |      ❌      |        ✅        |
| PPT          | ✅ (Pro)  |     ✅      |       ❌        |      ❌      |        ✅        |

### 2.2 竞品核心技术分析

#### Napkin AI - 多Agent架构

```
用户文本 → GPT-4o mini (编排Agent)
              ↓
    ┌─────────┴─────────┬─────────┬─────────┐
    ↓                   ↓         ↓         ↓
  Content            Layout     Icon      Style
  Agent              Agent      Agent     Agent
  (提炼要点)          (选布局)   (选图标)   (配色)
    ↓                   ↓         ↓         ↓
    └─────────────────────────────────────────┘
                        ↓
                   合成 SVG 矢量图
```

**关键洞察**：Napkin 不使用扩散模型，而是用 LLM + 矢量图形，确保输出可编辑。

#### Canva Magic Studio - 品牌一致性

```
Brand Kit (品牌资产)
    ├── Colors (配色方案)
    ├── Fonts (字体)
    ├── Logo (标识)
    ├── Voice (语调)
    └── Templates (模板)
           ↓
    Magic Design (AI 设计)
           ↓
    自动应用品牌规范
```

**关键洞察**：品牌系统是企业用户的核心需求，确保所有输出一致。

#### Nano Banana Pro - 高质量图像

```
特性:
├── 4K 分辨率 (4096x4096)
├── 精准文字渲染 (多语言)
├── 局部编辑 (选区重绘)
├── 风格控制 (光照/角度/景深)
└── 图生图 (参考图变体)
```

**关键洞察**：当需要纯视觉内容（非信息图表）时，AI 图像模型是最佳选择。

### 2.3 Genesis 差异化定位

| 维度         | Napkin   | Canva      | Nano Banana | **GenesisPod**        |
| ------------ | -------- | ---------- | ----------- | --------------------- |
| **核心场景** | 商务图表 | 全场景设计 | 艺术图像    | **研究内容可视化**    |
| **输入来源** | 纯文本   | 多媒体     | 提示词      | **URL/文件/资源库**   |
| **技术路径** | LLM+SVG  | 多模型     | 扩散模型    | **LLM+图像+HTML/SVG** |
| **差异优势** | 可编辑   | 品牌系统   | 高质量      | **深度内容理解**      |

---

## 三、核心架构：统一渲染模式

### 3.1 架构设计原则

**统一渲染模式**：所有视觉内容均采用 **图像模型(背景/视觉) + HTML/SVG(文字/图表)** 的组合方式，不再区分多种渲染模式。

**核心理念**：

- **图像模型**：负责生成背景、插图、视觉元素等非文字内容
- **HTML/SVG**：负责渲染文字、数据图表、图标等需要100%清晰度的内容
- **合成输出**：两层叠加合成最终图像

**模型配置原则**：

- 所有模型均从系统 `AIModel` 配置表获取
- 文本模型：使用 `modelType=CHAT` 且 `isDefault=true` 的模型
- 图像模型：使用 `modelType=IMAGE_GENERATION` 且 `isDefault=true` 的模型
- 不硬编码任何模型名称，完全依赖数据库配置

### 3.2 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         GenesisPod v2.1                             │
│                      统一渲染模式 (Unified Rendering)                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                        输入层 (Input Layer)                         │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │ │
│  │  │ 文本     │ │ URL      │ │ 文件     │ │ 图片     │ │ 资源     │ │ │
│  │  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ │ │
│  │       └───────────┬┴───────────┴────────────┴────────────┘        │ │
│  └───────────────────┼───────────────────────────────────────────────┘ │
│                      ↓                                                  │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │              文本模型层 (Text Model Layer)                         │ │
│  │              从 AIModel 表获取 (modelType=CHAT, isDefault=true)    │ │
│  │                                                                    │ │
│  │  ┌─────────────────────────────────────────────────────────────┐  │ │
│  │  │                 Orchestrator Agent (默认文本模型)             │  │ │
│  │  │                      负责任务编排与决策                        │  │ │
│  │  └─────────────────────────┬───────────────────────────────────┘  │ │
│  │                            ↓                                       │ │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐          │ │
│  │  │ Content   │ │ Layout    │ │ Visual    │ │ Style     │          │ │
│  │  │ Agent     │ │ Agent     │ │ Agent     │ │ Agent     │          │ │
│  │  │ • 要点提炼 │ │ • 布局选择 │ │ • 背景描述 │ │ • 配色方案 │          │ │
│  │  │ • 结构分析 │ │ • 模板匹配 │ │ • 图表类型 │ │ • 字体选择 │          │ │
│  │  │ • 摘要生成 │ │ • 元素排布 │ │ • 图标匹配 │ │ • 品牌应用 │          │ │
│  │  └─────┬─────┘ └─────┬─────┘ └─────┬─────┘ └─────┬─────┘          │ │
│  │        └─────────────┴─────────────┴─────────────┘                 │ │
│  │                            ↓                                       │ │
│  │                   VisualSpecification                              │ │
│  │         (背景提示词, 文字内容, 布局结构, 样式配置)                    │ │
│  └────────────────────────────┬──────────────────────────────────────┘ │
│                               ↓                                         │
│  ┌────────────────────────────┴──────────────────────────────────────┐ │
│  │                  统一渲染引擎 (Unified Rendering Engine)            │ │
│  │                                                                    │ │
│  │  ┌───────────────────────────────────────────────────────────┐    │ │
│  │  │                     渲染流水线                              │    │ │
│  │  │                                                            │    │ │
│  │  │   Step 1: 图像模型生成背景层                                │    │ │
│  │  │   (AIModel: modelType=IMAGE_GENERATION, isDefault=true)    │    │ │
│  │  │   • 根据 Visual Agent 的背景描述生成图像                     │    │ │
│  │  │   • 支持风格控制、色调匹配                                  │    │ │
│  │  │                           ↓                                │    │ │
│  │  │   Step 2: HTML/SVG 渲染文字层                               │    │ │
│  │  │   • 标题、正文、列表 → HTML 渲染                            │    │ │
│  │  │   • 图标、图表、流程图 → SVG 渲染                           │    │ │
│  │  │   • 确保文字 100% 清晰可读                                  │    │ │
│  │  │                           ↓                                │    │ │
│  │  │   Step 3: 图层合成                                         │    │ │
│  │  │   • 背景层 + 文字层 = 最终输出                              │    │ │
│  │  │   • 使用 Canvas/Sharp 合成                                  │    │ │
│  │  └───────────────────────────────────────────────────────────┘    │ │
│  └───────────────────────────┬───────────────────────────────────────┘ │
│                              ↓                                          │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │                   编辑器层 (Editor Layer)                          │ │
│  │                                                                    │ │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐      │ │
│  │  │文字编辑  │ │背景重绘  │ │布局切换  │ │样式切换  │ │品牌应用  │      │ │
│  │  │(HTML层) │ │(图像层) │ │         │ │         │ │         │      │ │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘      │ │
│  └───────────────────────────┬───────────────────────────────────────┘ │
│                              ↓                                          │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │                   输出层 (Output Layer)                            │ │
│  │                                                                    │ │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐      │ │
│  │  │PNG 1x-4x│ │SVG 矢量 │ │PDF 文档 │ │PPT 幻灯 │ │分享链接  │      │ │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘      │ │
│  └───────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.3 统一渲染流程详解

```
┌─────────────────────────────────────────────────────────────────────┐
│                        统一渲染流水线                                │
│                                                                      │
│   输入内容 (文本/URL/资源)                                           │
│        ↓                                                             │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │  Step 1: 内容分析 (文本模型)                                  │   │
│   │  • 提取关键信息、结构化内容                                   │   │
│   │  • 生成背景描述提示词                                         │   │
│   │  • 确定布局和样式                                             │   │
│   └─────────────────────────────────────────────────────────────┘   │
│        ↓                                                             │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │  Step 2: 背景层生成 (图像模型)                                │   │
│   │  • 根据提示词生成背景图像                                     │   │
│   │  • 可选：纯色/渐变背景 (无需调用模型)                         │   │
│   │  • 输出：背景图层 PNG                                         │   │
│   └─────────────────────────────────────────────────────────────┘   │
│        ↓                                                             │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │  Step 3: 文字层渲染 (HTML/SVG)                                │   │
│   │  • 标题、正文、列表 → HTML + CSS                              │   │
│   │  • 图标 → SVG 图标库                                          │   │
│   │  • 图表 → ECharts/D3.js → SVG                                │   │
│   │  • 流程图 → SVG 路径                                          │   │
│   │  • 输出：透明背景的文字层 PNG                                 │   │
│   └─────────────────────────────────────────────────────────────┘   │
│        ↓                                                             │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │  Step 4: 图层合成                                             │   │
│   │  • 背景层 + 文字层 → 最终图像                                 │   │
│   │  • 使用 Sharp/Canvas 合成                                     │   │
│   │  • 输出：PNG/SVG/PDF                                          │   │
│   └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.4 模型配置与获取

**重要**：所有模型均从数据库 `AIModel` 表获取，不硬编码模型名称。

#### 模型获取逻辑

```typescript
// 获取默认文本模型
async function getDefaultTextModel(): Promise<AIModel> {
  // 优先级 1: isDefault=true 且 modelType=CHAT
  let model = await prisma.aIModel.findFirst({
    where: {
      isEnabled: true,
      isDefault: true,
      modelType: "CHAT",
    },
  });

  // 优先级 2: 任意启用的 CHAT 模型
  if (!model) {
    model = await prisma.aIModel.findFirst({
      where: {
        isEnabled: true,
        modelType: "CHAT",
      },
    });
  }

  return model;
}

// 获取默认图像模型
async function getDefaultImageModel(): Promise<AIModel> {
  // 优先级 1: isDefault=true 且 modelType=IMAGE_GENERATION
  let model = await prisma.aIModel.findFirst({
    where: {
      isEnabled: true,
      isDefault: true,
      modelType: "IMAGE_GENERATION",
    },
  });

  // 优先级 2: 任意启用的 IMAGE_GENERATION 模型
  if (!model) {
    model = await prisma.aIModel.findFirst({
      where: {
        isEnabled: true,
        modelType: "IMAGE_GENERATION",
      },
    });
  }

  // 优先级 3: MULTIMODAL 模型作为兜底
  if (!model) {
    model = await prisma.aIModel.findFirst({
      where: {
        isEnabled: true,
        modelType: "MULTIMODAL",
      },
    });
  }

  return model;
}
```

#### AIModel 数据表结构

```prisma
model AIModel {
  id          String      @id @default(uuid())
  name        String      @db.VarChar(50)
  displayName String      @map("display_name") @db.VarChar(100)
  provider    String      @db.VarChar(50)  // Google, OpenAI, xAI, Anthropic
  modelId     String      @unique @map("model_id") @db.VarChar(200)
  modelType   AIModelType @default(CHAT) @map("model_type")
  apiEndpoint String      @map("api_endpoint") @db.Text
  apiKey      String?     @map("api_key") @db.Text
  isEnabled   Boolean     @default(true) @map("is_enabled")
  isDefault   Boolean     @default(false) @map("is_default")
  // ...
}

enum AIModelType {
  CHAT              // 文本对话模型
  IMAGE_GENERATION  // 图像生成模型
  MULTIMODAL        // 多模态模型
}
```

### 3.5 各层技术实现

| 层级     | 模型来源                              | 技术实现         | 输出                     |
| -------- | ------------------------------------- | ---------------- | ------------------------ |
| 内容分析 | AIModel (CHAT, isDefault)             | LLM API 调用     | VisualSpecification JSON |
| 背景生成 | AIModel (IMAGE_GENERATION, isDefault) | 图像生成 API     | PNG 背景图               |
| 文字渲染 | 无需模型                              | HTML + CSS + SVG | 透明 PNG                 |
| 图表渲染 | 无需模型                              | ECharts / D3.js  | SVG                      |
| 图层合成 | 无需模型                              | Sharp / Canvas   | 最终图像                 |

### 3.6 背景类型智能选择

文本模型分析内容后，自动选择背景类型：

| 内容类型      | 背景类型      | 说明               |
| ------------- | ------------- | ------------------ |
| 数据报表/KPI  | 纯色/渐变     | 简洁背景，突出数据 |
| 流程图/架构图 | 纯色/轻微纹理 | 不干扰线条和连接   |
| 营销物料      | AI 生成图像   | 高视觉冲击力       |
| 文章配图      | AI 生成图像   | 氛围感背景         |
| 教学课件      | 纯色/主题图像 | 清晰易读           |

**纯色/渐变背景**：无需调用图像模型，直接 CSS 渲染
**AI生成背景**：调用配置的默认图像模型生成

---

## 四、功能模块详细设计

### 4.1 模块一：智能内容理解

#### 4.1.1 多Agent协作系统

```typescript
// Agent 定义 - 使用系统配置的默认模型
interface AgentConfig {
  name: string;
  // 不硬编码模型，运行时从 AIModel 表获取
  systemPrompt: string;
  outputSchema: JSONSchema;
}

// Agent 执行器 - 动态获取模型
class AgentExecutor {
  private textModel: AIModel;

  async initialize() {
    // 从数据库获取默认文本模型
    this.textModel = await getDefaultTextModel();
    if (!this.textModel) {
      throw new Error("No default CHAT model configured");
    }
  }

  async execute(agent: AgentConfig, input: any) {
    return await this.callLLM({
      model: this.textModel, // 使用配置的默认模型
      systemPrompt: agent.systemPrompt,
      input,
      outputSchema: agent.outputSchema,
    });
  }
}

const AGENTS: Record<string, AgentConfig> = {
  orchestrator: {
    name: "Orchestrator Agent",
    systemPrompt: `你是一个内容分析编排专家...`,
    outputSchema: OrchestratorOutputSchema,
  },
  content: {
    name: "Content Agent",
    systemPrompt: `你是一个内容提炼专家，负责从原始内容中提取核心要点...`,
    outputSchema: ContentOutputSchema,
  },
  layout: {
    name: "Layout Agent",
    systemPrompt: `你是一个布局设计专家，根据内容结构选择最佳布局模板...`,
    outputSchema: LayoutOutputSchema,
  },
  visual: {
    name: "Visual Agent",
    systemPrompt: `你是一个视觉设计专家，负责背景描述和图表类型建议...`,
    outputSchema: VisualOutputSchema,
  },
  style: {
    name: "Style Agent",
    systemPrompt: `你是一个视觉风格专家，负责配色方案和整体风格建议...`,
    outputSchema: StyleOutputSchema,
  },
};
```

#### 4.1.2 Orchestrator Agent 输出结构

```typescript
interface OrchestratorOutput {
  // 内容分析
  contentAnalysis: {
    type: "data_heavy" | "balanced" | "visual_concept";
    structureType:
      | "parallel_stories"
      | "sequential_process"
      | "central_concept"
      | "comparison"
      | "hierarchy";
    language: "zh" | "en" | "mixed";
    complexity: "high" | "medium" | "low";
    wordCount: number;
    hasData: boolean;
    hasTimeline: boolean;
    mainPointsCount: number;
  };

  // 背景决策 (统一渲染模式下的背景类型选择)
  backgroundDecision: {
    type: "solid" | "gradient" | "ai_generated"; // 纯色 | 渐变 | AI生成
    reasoning: string;
    // 纯色/渐变时的颜色配置
    colors?: {
      primary: string;
      secondary?: string;
      direction?: "horizontal" | "vertical" | "diagonal";
    };
    // AI生成时的提示词
    imagePrompt?: string;
  };

  // 任务分派
  agentTasks: {
    content: ContentAgentTask;
    layout: LayoutAgentTask;
    visual: VisualAgentTask;
    style: StyleAgentTask;
  };
}
```

#### 4.1.3 Content Agent 输出结构

```typescript
interface ContentAgentOutput {
  // 信息架构
  informationArchitecture: {
    title: string;
    subtitle?: string;
    heroStatement?: string;
    sections: Array<{
      id: string;
      title: string;
      summary?: string;
      bullets: string[];
      metrics?: Array<{
        label: string;
        value: string;
        unit?: string;
        trend?: "up" | "down" | "stable";
      }>;
      sectionType: "main" | "summary" | "callout";
    }>;
    callToAction?: string;
  };

  // 关键数据提取
  extractedData?: {
    numbers: Array<{ value: number; label: string; context: string }>;
    percentages: Array<{ value: number; label: string }>;
    comparisons: Array<{ itemA: string; itemB: string; dimension: string }>;
    timeline?: Array<{ date: string; event: string }>;
  };
}
```

#### 4.1.4 Layout Agent 输出结构

```typescript
interface LayoutAgentOutput {
  // 布局选择
  templateLayout: TemplateLayoutType;
  layoutReasoning: string;

  // 布局参数
  layoutParams: {
    columns?: number;
    rows?: number;
    orientation: "horizontal" | "vertical" | "grid";
    centerElement?: boolean;
    hasHeader: boolean;
    hasFooter: boolean;
  };

  // 元素排布
  elementPlacements: Array<{
    elementId: string;
    gridArea?: string;
    position: { x: number; y: number };
    size: { width: number; height: number };
    zIndex: number;
  }>;
}

type TemplateLayoutType =
  | "cards" // 卡片网格
  | "center_visual" // 中心视觉
  | "timeline" // 时间轴
  | "comparison" // 对比
  | "pyramid" // 金字塔
  | "radial" // 放射状
  | "statistics" // 统计数据
  | "checklist" // 清单
  | "funnel" // 漏斗
  | "matrix" // 矩阵
  | "mindmap" // 思维导图
  | "flowchart" // 流程图
  | "org_chart"; // 组织架构
```

#### 4.1.5 Visual Agent 输出结构

```typescript
interface VisualAgentOutput {
  // 图标建议
  iconSuggestions: Array<{
    sectionId: string;
    iconName: string; // Lucide 图标名
    iconCategory: string; // 图标分类
    alternativeIcons: string[];
  }>;

  // 图表建议
  chartSuggestions?: Array<{
    dataId: string;
    chartType: "bar" | "line" | "pie" | "donut" | "area" | "radar";
    chartConfig: Record<string, any>;
  }>;

  // 背景建议 (统一渲染模式 - 背景层)
  backgroundSuggestion: {
    type: "solid" | "gradient" | "ai_generated";
    // 纯色/渐变配置
    colors?: {
      primary: string;
      secondary?: string;
      direction?: "horizontal" | "vertical" | "diagonal";
    };
    // AI生成配置 (type='ai_generated' 时使用)
    aiConfig?: {
      prompt: string; // AI 图像生成提示词
      style: string; // 风格描述
      colorTone: string; // 色调
      complexity: "minimal" | "moderate" | "detailed";
    };
  };
}
```

#### 4.1.6 Style Agent 输出结构

```typescript
interface StyleAgentOutput {
  // 视觉语言
  visualLanguage: {
    // 配色
    colorPalette: {
      primary: string;
      secondary: string;
      accent: string;
      background: string;
      text: string;
      muted: string;
    };

    // 字体
    typography: {
      headingFont: string;
      bodyFont: string;
      headingWeight: 600 | 700 | 800;
      bodyWeight: 400 | 500;
      headingSizes: { h1: number; h2: number; h3: number };
      bodySizes: { large: number; normal: number; small: number };
    };

    // 样式
    designStyle:
      | "consulting"
      | "tech"
      | "minimal"
      | "creative"
      | "dark"
      | "academic";
    iconStyle: "outline" | "filled" | "duotone";
    borderRadius: "none" | "small" | "medium" | "large";
    shadowStyle: "none" | "subtle" | "medium" | "strong";

    // 间距
    spacing: {
      section: number;
      element: number;
      padding: number;
    };
  };

  // 品牌应用 (如果有品牌配置)
  brandApplication?: {
    brandKitId: string;
    overrides: Partial<VisualLanguage>;
  };
}
```

### 4.2 模块二：渲染引擎

#### 4.2.1 HTML/SVG 渲染器

```typescript
interface HTMLRenderer {
  // 渲染信息图
  renderInfographic(
    content: ContentAgentOutput,
    layout: LayoutAgentOutput,
    style: StyleAgentOutput,
  ): Promise<{
    html: string;
    svg: string;
    editableElements: EditableElement[];
  }>;

  // 渲染单个模板
  renderTemplate(
    templateType: TemplateLayoutType,
    data: TemplateData,
    style: VisualLanguage,
  ): Promise<string>;

  // 导出为图片
  exportToImage(html: string, options: ExportOptions): Promise<Buffer>;
}

interface ExportOptions {
  format: "png" | "jpeg" | "webp";
  width: number;
  height: number;
  scale: 1 | 2 | 3 | 4; // 分辨率倍数
  quality?: number; // JPEG 质量
}
```

#### 4.2.2 模板系统

```typescript
// 模板定义
interface TemplateDefinition {
  id: TemplateLayoutType;
  name: string;
  description: string;

  // 布局约束
  constraints: {
    minItems: number;
    maxItems: number;
    aspectRatios: string[];
    orientations: ("horizontal" | "vertical" | "square")[];
  };

  // HTML 模板
  htmlTemplate: string;

  // CSS 样式
  cssTemplate: string;

  // 渲染函数
  render: (data: TemplateData, style: VisualLanguage) => string;
}

// 模板数据
interface TemplateData {
  title: string;
  subtitle?: string;
  sections: TemplateSectionData[];
  footer?: string;
  watermark?: string;
}

interface TemplateSectionData {
  id: string;
  title?: string;
  content: string | string[];
  icon?: string;
  metrics?: MetricData[];
  chart?: ChartData;
  image?: string;
}
```

#### 4.2.3 Hybrid 合成引擎

```typescript
interface HybridComposer {
  // 生成 AI 背景
  generateBackground(
    prompt: string,
    options: BackgroundOptions,
  ): Promise<Buffer>;

  // 合成图层
  composeLayers(
    background: Buffer,
    foreground: string, // HTML/SVG
    options: ComposeOptions,
  ): Promise<Buffer>;
}

interface BackgroundOptions {
  width: number;
  height: number;
  style: "abstract" | "gradient" | "pattern" | "scene";
  colorHints: string[]; // 期望的主色调
  blur?: number; // 模糊程度 (让文字更清晰)
  brightness?: number; // 亮度调整
  saturation?: number; // 饱和度调整
}

interface ComposeOptions {
  blendMode: "normal" | "overlay" | "soft-light";
  backgroundOpacity: number;
  padding: number;
  shadow?: boolean; // 文字阴影增强可读性
}
```

#### 4.2.4 AI 图像引擎

```typescript
interface AIImageEngine {
  // 生成图像
  generateImage(
    prompt: string,
    options: ImageGenerationOptions,
  ): Promise<GeneratedImage>;

  // 局部重绘
  inpaint(image: Buffer, mask: Buffer, prompt: string): Promise<Buffer>;

  // 图生图
  imageToImage(
    referenceImage: Buffer,
    prompt: string,
    strength: number, // 0-1, 参考图影响程度
  ): Promise<Buffer>;
}

interface ImageGenerationOptions {
  model: "nano-banana-pro" | "imagen-4" | "dall-e-3" | "stable-diffusion";
  width: number;
  height: number;
  aspectRatio: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
  style?: string;
  negativePrompt?: string;
  seed?: number;
  quality?: "standard" | "hd" | "4k";
}

interface GeneratedImage {
  imageUrl: string;
  imageBase64?: string;
  width: number;
  height: number;
  model: string;
  prompt: string;
  seed?: number;
}
```

### 4.3 模块三：编辑系统

#### 4.3.1 可编辑元素定义

```typescript
interface EditableElement {
  id: string;
  type: "text" | "icon" | "shape" | "image" | "chart" | "connector";

  // 位置和大小
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
  };

  // 内容
  content:
    | TextContent
    | IconContent
    | ShapeContent
    | ImageContent
    | ChartContent;

  // 样式
  style: ElementStyle;

  // 状态
  locked: boolean;
  visible: boolean;
  groupId?: string;

  // 层级
  zIndex: number;
}

interface TextContent {
  text: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  color: string;
  alignment: "left" | "center" | "right";
  lineHeight?: number;
}

interface IconContent {
  iconName: string;
  iconLibrary: "lucide" | "heroicons" | "custom";
  color: string;
  strokeWidth?: number;
}

interface ShapeContent {
  shapeType: "rectangle" | "circle" | "ellipse" | "line" | "arrow" | "polygon";
  fill: string;
  stroke: string;
  strokeWidth: number;
  cornerRadius?: number;
  points?: Array<{ x: number; y: number }>;
}
```

#### 4.3.2 自然语言编辑接口

```typescript
interface NaturalLanguageEdit {
  // 解析编辑指令
  parseInstruction(
    instruction: string,
    currentState: InfographicState,
  ): Promise<EditAction[]>;

  // 执行编辑
  executeEdits(
    state: InfographicState,
    actions: EditAction[],
  ): Promise<InfographicState>;
}

type EditAction =
  | { type: "UPDATE_TEXT"; elementId: string; newText: string }
  | { type: "UPDATE_COLOR"; elementId: string; newColor: string }
  | { type: "UPDATE_STYLE"; elementId: string; style: Partial<ElementStyle> }
  | { type: "ADD_ELEMENT"; element: EditableElement }
  | { type: "REMOVE_ELEMENT"; elementId: string }
  | { type: "MOVE_ELEMENT"; elementId: string; newPosition: Position }
  | { type: "RESIZE_ELEMENT"; elementId: string; newSize: Size }
  | { type: "CHANGE_LAYOUT"; newLayout: TemplateLayoutType }
  | { type: "APPLY_BRAND"; brandKitId: string }
  | { type: "REGENERATE_BACKGROUND"; newPrompt?: string };

// 示例指令解析
const INSTRUCTION_EXAMPLES = {
  把标题改成蓝色: [
    { type: "UPDATE_COLOR", elementId: "title", newColor: "#2563eb" },
  ],
  增加一个关于安全性的要点: [
    {
      type: "ADD_ELEMENT",
      element: { type: "text", content: { text: "安全性..." } },
    },
  ],
  换成时间轴布局: [{ type: "CHANGE_LAYOUT", newLayout: "timeline" }],
  使用我的品牌色: [{ type: "APPLY_BRAND", brandKitId: "user_brand_kit_id" }],
};
```

#### 4.3.3 版本历史管理

```typescript
interface VersionManager {
  // 创建版本
  createVersion(
    infographicId: string,
    state: InfographicState,
    description?: string,
  ): Promise<Version>;

  // 获取版本列表
  getVersions(infographicId: string): Promise<Version[]>;

  // 恢复版本
  restoreVersion(
    infographicId: string,
    versionId: string,
  ): Promise<InfographicState>;

  // 比较版本
  compareVersions(versionIdA: string, versionIdB: string): Promise<VersionDiff>;
}

interface Version {
  id: string;
  infographicId: string;
  version: number;
  state: InfographicState;
  thumbnail?: string;
  description?: string;
  createdAt: Date;
  createdBy?: string;
}
```

### 4.4 模块四：品牌系统

#### 4.4.1 品牌配置

```typescript
interface BrandKit {
  id: string;
  userId: string;
  name: string;
  isDefault: boolean;

  // 视觉资产
  assets: {
    logo?: {
      url: string;
      darkUrl?: string; // 深色背景版本
      width: number;
      height: number;
    };
    favicon?: string;
    watermark?: string;
  };

  // 配色方案
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    success: string;
    warning: string;
    error: string;
    background: string;
    surface: string;
    text: string;
    textMuted: string;
    border: string;
  };

  // 字体
  typography: {
    headingFont: string;
    bodyFont: string;
    monoFont?: string;
    // 字体文件 URL (自定义字体)
    customFonts?: Array<{
      family: string;
      url: string;
      weight: number;
      style: "normal" | "italic";
    }>;
  };

  // 设计规范
  designTokens: {
    borderRadius: "none" | "small" | "medium" | "large" | "full";
    shadowStyle: "none" | "subtle" | "medium" | "strong";
    iconStyle: "outline" | "filled" | "duotone";
    spacing: "compact" | "normal" | "spacious";
  };

  // 品牌语调 (用于 AI 文案生成)
  voice?: {
    tone: string[]; // 如: ["professional", "friendly", "innovative"]
    guidelines: string; // 详细语调指南
    avoidWords: string[]; // 避免使用的词汇
    preferredPhrases: string[];
  };

  createdAt: Date;
  updatedAt: Date;
}
```

#### 4.4.2 品牌应用服务

```typescript
interface BrandService {
  // 获取用户品牌配置
  getUserBrandKits(userId: string): Promise<BrandKit[]>;

  // 创建品牌配置
  createBrandKit(userId: string, config: Partial<BrandKit>): Promise<BrandKit>;

  // 从 Logo 自动提取品牌色
  extractColorsFromLogo(logoUrl: string): Promise<{
    primary: string;
    secondary: string;
    accent: string;
    background: string;
  }>;

  // 应用品牌到信息图
  applyBrandKit(
    infographicState: InfographicState,
    brandKit: BrandKit,
  ): InfographicState;

  // 生成品牌变体
  generateBrandVariants(
    infographicState: InfographicState,
    brandKit: BrandKit,
    count: number,
  ): Promise<InfographicState[]>;
}
```

### 4.5 模块五：导出系统

#### 4.5.1 导出服务

```typescript
interface ExportService {
  // 导出 PNG
  exportPNG(
    infographic: InfographicState,
    options: PNGExportOptions,
  ): Promise<Buffer>;

  // 导出 SVG
  exportSVG(
    infographic: InfographicState,
    options: SVGExportOptions,
  ): Promise<string>;

  // 导出 PDF
  exportPDF(
    infographic: InfographicState,
    options: PDFExportOptions,
  ): Promise<Buffer>;

  // 导出 PPT
  exportPPT(
    infographic: InfographicState,
    options: PPTExportOptions,
  ): Promise<Buffer>;

  // 生成分享链接
  createShareLink(
    infographicId: string,
    options: ShareOptions,
  ): Promise<string>;
}

interface PNGExportOptions {
  scale: 1 | 2 | 3 | 4; // 1x = 原始, 4x = 4K
  background: "transparent" | "white" | string;
  quality?: number; // 0-100, 仅 JPEG
}

interface SVGExportOptions {
  embedFonts: boolean; // 内嵌字体
  embedImages: boolean; // 内嵌图片为 base64
  optimized: boolean; // SVGO 优化
}

interface PDFExportOptions {
  pageSize: "A4" | "A3" | "Letter" | "Custom";
  orientation: "portrait" | "landscape";
  margin: number;
  quality: "screen" | "print" | "high";
}

interface PPTExportOptions {
  slideSize: "16:9" | "4:3" | "custom";
  includeNotes: boolean;
  editable: boolean; // 是否保留可编辑性
}

interface ShareOptions {
  expiresIn?: number; // 过期时间 (秒)
  password?: string; // 访问密码
  allowDownload: boolean;
  allowEmbed: boolean;
}
```

---

## 五、渲染引擎设计

### 5.1 HTML 模板引擎

#### 5.1.1 Cards 模板

```html
<!-- cards 模板 -->
<div
  class="infographic infographic-cards"
  style="--primary: {{primaryColor}}; --accent: {{accentColor}};"
>
  <!-- 头部 -->
  <header class="infographic-header">
    <h1 class="title">{{title}}</h1>
    <p class="subtitle">{{subtitle}}</p>
  </header>

  <!-- 卡片网格 -->
  <div class="cards-grid" style="--columns: {{columns}};">
    {{#each sections}}
    <article class="card {{#if isSummary}}card-summary{{/if}}">
      <div class="card-icon">
        <svg class="icon"><!-- {{iconName}} --></svg>
      </div>
      <h2 class="card-title">{{title}}</h2>
      <p class="card-summary">{{summary}}</p>
      <ul class="card-bullets">
        {{#each bullets}}
        <li>{{this}}</li>
        {{/each}}
      </ul>
      {{#if metrics}}
      <div class="card-metrics">
        {{#each metrics}}
        <div class="metric">
          <span class="metric-value">{{value}}</span>
          <span class="metric-label">{{label}}</span>
        </div>
        {{/each}}
      </div>
      {{/if}}
    </article>
    {{/each}}
  </div>

  <!-- 底部 -->
  {{#if callToAction}}
  <footer class="infographic-footer">
    <p class="cta">{{callToAction}}</p>
  </footer>
  {{/if}}
</div>
```

#### 5.1.2 Timeline 模板

```html
<!-- timeline 模板 -->
<div class="infographic infographic-timeline">
  <header class="infographic-header">
    <h1 class="title">{{title}}</h1>
  </header>

  <div class="timeline-container" data-orientation="{{orientation}}">
    <div class="timeline-line"></div>

    {{#each sections}}
    <div class="timeline-item" data-index="{{@index}}">
      <div class="timeline-marker">
        <div class="marker-dot"></div>
        {{#if date}}<span class="marker-date">{{date}}</span>{{/if}}
      </div>
      <div class="timeline-content">
        <div class="timeline-icon">
          <svg class="icon"><!-- {{iconName}} --></svg>
        </div>
        <h3 class="timeline-title">{{title}}</h3>
        <p class="timeline-description">{{summary}}</p>
        {{#if bullets}}
        <ul class="timeline-bullets">
          {{#each bullets}}
          <li>{{this}}</li>
          {{/each}}
        </ul>
        {{/if}}
      </div>
    </div>
    {{/each}}
  </div>
</div>
```

#### 5.1.3 CSS 样式系统

```css
/* 基础变量系统 */
.infographic {
  /* 颜色 */
  --primary: #1e3a5f;
  --secondary: #64748b;
  --accent: #0891b2;
  --background: #f8fafc;
  --surface: #ffffff;
  --text: #1e293b;
  --text-muted: #64748b;
  --border: #e2e8f0;

  /* 字体 */
  --font-heading: "Inter", system-ui, sans-serif;
  --font-body: "Inter", system-ui, sans-serif;
  --font-size-h1: 32px;
  --font-size-h2: 24px;
  --font-size-h3: 18px;
  --font-size-body: 14px;
  --font-size-small: 12px;

  /* 间距 */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --spacing-xl: 32px;

  /* 圆角 */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-full: 9999px;

  /* 阴影 */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1);

  /* 尺寸 */
  width: var(--width, 1200px);
  height: var(--height, 675px);

  background: var(--background);
  font-family: var(--font-body);
  color: var(--text);
}

/* Cards 布局 */
.infographic-cards .cards-grid {
  display: grid;
  grid-template-columns: repeat(var(--columns, 3), 1fr);
  gap: var(--spacing-lg);
  padding: var(--spacing-xl);
}

.infographic-cards .card {
  background: var(--surface);
  border-radius: var(--radius-lg);
  padding: var(--spacing-lg);
  box-shadow: var(--shadow-md);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.infographic-cards .card-icon {
  width: 48px;
  height: 48px;
  background: var(--accent);
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
}

.infographic-cards .card-icon svg {
  width: 24px;
  height: 24px;
  color: white;
}

.infographic-cards .card-title {
  font-family: var(--font-heading);
  font-size: var(--font-size-h3);
  font-weight: 600;
  color: var(--primary);
  margin: 0;
}

.infographic-cards .card-bullets {
  list-style: none;
  padding: 0;
  margin: 0;
}

.infographic-cards .card-bullets li {
  position: relative;
  padding-left: var(--spacing-md);
  margin-bottom: var(--spacing-xs);
  font-size: var(--font-size-body);
  color: var(--text);
}

.infographic-cards .card-bullets li::before {
  content: "";
  position: absolute;
  left: 0;
  top: 8px;
  width: 6px;
  height: 6px;
  background: var(--accent);
  border-radius: var(--radius-full);
}

/* 响应式文字缩放 */
@media (max-width: 800px) {
  .infographic {
    --font-size-h1: 24px;
    --font-size-h2: 18px;
    --font-size-h3: 16px;
    --font-size-body: 12px;
  }
}
```

### 5.2 SVG 生成引擎

```typescript
class SVGGenerator {
  private width: number;
  private height: number;
  private elements: SVGElement[] = [];
  private defs: string[] = [];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  // 添加文本元素
  addText(text: string, x: number, y: number, style: TextStyle): string {
    const id = `text-${this.elements.length}`;
    const element: SVGTextElement = {
      id,
      type: "text",
      x,
      y,
      text,
      style,
      editable: true,
    };
    this.elements.push(element);
    return id;
  }

  // 添加图标
  addIcon(
    iconName: string,
    x: number,
    y: number,
    size: number,
    color: string,
  ): string {
    const id = `icon-${this.elements.length}`;
    const iconPath = this.getIconPath(iconName);
    const element: SVGIconElement = {
      id,
      type: "icon",
      x,
      y,
      size,
      color,
      path: iconPath,
      editable: true,
    };
    this.elements.push(element);
    return id;
  }

  // 添加形状
  addShape(
    shapeType: ShapeType,
    x: number,
    y: number,
    width: number,
    height: number,
    style: ShapeStyle,
  ): string {
    const id = `shape-${this.elements.length}`;
    const element: SVGShapeElement = {
      id,
      type: "shape",
      shapeType,
      x,
      y,
      width,
      height,
      style,
      editable: true,
    };
    this.elements.push(element);
    return id;
  }

  // 生成 SVG 字符串
  generate(): string {
    const elementsXml = this.elements
      .map((el) => this.renderElement(el))
      .join("\n");
    const defsXml =
      this.defs.length > 0 ? `<defs>${this.defs.join("\n")}</defs>` : "";

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${this.width}"
     height="${this.height}"
     viewBox="0 0 ${this.width} ${this.height}">
  ${defsXml}
  ${elementsXml}
</svg>`;
  }

  // 渲染单个元素
  private renderElement(element: SVGElement): string {
    switch (element.type) {
      case "text":
        return this.renderText(element as SVGTextElement);
      case "icon":
        return this.renderIcon(element as SVGIconElement);
      case "shape":
        return this.renderShape(element as SVGShapeElement);
      default:
        return "";
    }
  }

  private renderText(el: SVGTextElement): string {
    const { id, x, y, text, style } = el;
    const lines = text.split("\n");

    if (lines.length === 1) {
      return `<text id="${id}" x="${x}" y="${y}"
        font-family="${style.fontFamily}"
        font-size="${style.fontSize}"
        font-weight="${style.fontWeight}"
        fill="${style.color}"
        data-editable="true">${this.escapeXml(text)}</text>`;
    }

    // 多行文本
    const lineHeight = style.fontSize * (style.lineHeight || 1.4);
    const tspans = lines
      .map(
        (line, i) =>
          `<tspan x="${x}" dy="${i === 0 ? 0 : lineHeight}">${this.escapeXml(line)}</tspan>`,
      )
      .join("");

    return `<text id="${id}" x="${x}" y="${y}"
      font-family="${style.fontFamily}"
      font-size="${style.fontSize}"
      font-weight="${style.fontWeight}"
      fill="${style.color}"
      data-editable="true">${tspans}</text>`;
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }
}
```

### 5.3 Hybrid 合成引擎

```typescript
class HybridComposer {
  private sharp: typeof import("sharp");
  private puppeteer: typeof import("puppeteer");

  async compose(
    backgroundImage: Buffer,
    htmlContent: string,
    options: ComposeOptions,
  ): Promise<Buffer> {
    // 1. 渲染 HTML 为透明 PNG
    const browser = await this.puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    await page.setViewport({
      width: options.width,
      height: options.height,
      deviceScaleFactor: options.scale,
    });

    // 设置透明背景
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            html, body {
              margin: 0;
              padding: 0;
              background: transparent !important;
            }
          </style>
        </head>
        <body>${htmlContent}</body>
      </html>
    `);

    const foregroundBuffer = await page.screenshot({
      type: "png",
      omitBackground: true,
    });

    await browser.close();

    // 2. 处理背景图
    let background = this.sharp(backgroundImage).resize(
      options.width * options.scale,
      options.height * options.scale,
    );

    // 应用模糊 (提高文字可读性)
    if (options.backgroundBlur > 0) {
      background = background.blur(options.backgroundBlur);
    }

    // 调整亮度/对比度
    if (options.backgroundDarken > 0) {
      background = background.modulate({
        brightness: 1 - options.backgroundDarken,
      });
    }

    const processedBackground = await background.toBuffer();

    // 3. 合成图层
    const result = await this.sharp(processedBackground)
      .composite([
        {
          input: foregroundBuffer,
          blend: options.blendMode || "over",
        },
      ])
      .png()
      .toBuffer();

    return result;
  }
}
```

---

## 六、数据模型设计

### 6.1 Prisma Schema 扩展

```prisma
// ============================================
// GenesisPod v2.0 数据模型
// ============================================

// 生成的图像 (扩展)
model GeneratedImage {
  id String @id @default(uuid())

  // 用户关联
  userId String? @map("user_id")
  user   User?   @relation(fields: [userId], references: [id], onDelete: SetNull)

  // === 现有字段 ===
  prompt         String  @db.Text
  enhancedPrompt String? @map("enhanced_prompt") @db.Text
  style          String  @default("realistic") @db.VarChar(50)
  aspectRatio    String  @default("1:1") @map("aspect_ratio") @db.VarChar(10)
  negativePrompt String? @map("negative_prompt") @db.Text

  imageUrl String @map("image_url") @db.Text
  width    Int    @default(1024)
  height   Int    @default(1024)

  provider String @default("stability") @db.VarChar(50)

  textModelUsed   String? @map("text_model_used") @db.VarChar(100)
  imageModelUsed  String? @map("image_model_used") @db.VarChar(100)
  processingSteps Json?   @map("processing_steps")
  promptInsights  Json?   @map("prompt_insights")

  isBookmarked Boolean @default(false) @map("is_bookmarked")

  // === 新增字段 v2.0 ===

  // 渲染模式
  renderingMode String @default("ai_image") @map("rendering_mode") @db.VarChar(20)
  // html_render | hybrid | ai_image

  // 模板布局
  templateLayout String? @map("template_layout") @db.VarChar(30)

  // 输出格式
  outputFormat String @default("png") @map("output_format") @db.VarChar(10)
  // png | svg | html

  // 分辨率
  resolution String @default("1024x1024") @db.VarChar(20)
  // 1024x1024 | 2048x2048 | 4096x4096

  // 可编辑数据 (SVG/HTML 源码)
  editableSource String? @map("editable_source") @db.Text

  // 可编辑元素列表
  editableElements Json? @map("editable_elements")

  // 品牌配置
  brandKitId String?   @map("brand_kit_id")
  brandKit   BrandKit? @relation(fields: [brandKitId], references: [id])

  // 版本管理
  version         Int     @default(1)
  parentVersionId String? @map("parent_version_id")

  // 编辑历史
  editHistory Json? @map("edit_history")

  // AI 背景 URL (hybrid 模式)
  backgroundImageUrl String? @map("background_image_url") @db.Text

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([userId])
  @@index([createdAt])
  @@index([isBookmarked])
  @@index([renderingMode])
  @@index([templateLayout])
  @@map("generated_images")
}

// 品牌配置
model BrandKit {
  id     String @id @default(uuid())
  userId String @map("user_id")
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  name      String  @db.VarChar(100)
  isDefault Boolean @default(false) @map("is_default")

  // Logo
  logoUrl     String? @map("logo_url") @db.Text
  logoDarkUrl String? @map("logo_dark_url") @db.Text

  // 配色方案
  primaryColor    String @map("primary_color") @db.VarChar(9)
  secondaryColor  String @map("secondary_color") @db.VarChar(9)
  accentColor     String @map("accent_color") @db.VarChar(9)
  backgroundColor String @map("background_color") @db.VarChar(9)
  surfaceColor    String @map("surface_color") @db.VarChar(9)
  textColor       String @map("text_color") @db.VarChar(9)
  textMutedColor  String @map("text_muted_color") @db.VarChar(9)
  borderColor     String @map("border_color") @db.VarChar(9)

  // 扩展配色
  additionalColors Json? @map("additional_colors")

  // 字体
  headingFont String @map("heading_font") @db.VarChar(100)
  bodyFont    String @map("body_font") @db.VarChar(100)
  monoFont    String? @map("mono_font") @db.VarChar(100)

  // 自定义字体文件
  customFonts Json? @map("custom_fonts")

  // 设计规范
  iconStyle    String @default("outline") @map("icon_style") @db.VarChar(20)
  borderRadius String @default("medium") @map("border_radius") @db.VarChar(20)
  shadowStyle  String @default("subtle") @map("shadow_style") @db.VarChar(20)
  spacing      String @default("normal") @db.VarChar(20)

  // 品牌语调
  voiceTone       Json?   @map("voice_tone")
  voiceGuidelines String? @map("voice_guidelines") @db.Text
  avoidWords      Json?   @map("avoid_words")
  preferredPhrases Json?  @map("preferred_phrases")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  images GeneratedImage[]

  @@unique([userId, name])
  @@index([userId])
  @@index([isDefault])
  @@map("brand_kits")
}

// 模板库
model InfographicTemplate {
  id String @id @default(uuid())

  // 基本信息
  name        String @db.VarChar(100)
  description String @db.Text
  category    String @db.VarChar(50)
  // category: business, education, marketing, data, timeline, comparison

  // 模板类型
  layoutType String @map("layout_type") @db.VarChar(30)
  // cards, timeline, comparison, pyramid, radial, etc.

  // 约束条件
  constraints Json
  // { minItems, maxItems, aspectRatios, orientations }

  // 模板源码
  htmlTemplate String @map("html_template") @db.Text
  cssTemplate  String @map("css_template") @db.Text

  // 预览图
  thumbnailUrl String? @map("thumbnail_url") @db.Text

  // 标签
  tags Json? @default("[]")

  // 使用统计
  usageCount Int @default(0) @map("usage_count")

  // 状态
  isPublic  Boolean @default(true) @map("is_public")
  isBuiltIn Boolean @default(false) @map("is_built_in")

  // 创建者 (用户自定义模板)
  creatorId String? @map("creator_id")
  creator   User?   @relation(fields: [creatorId], references: [id])

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([layoutType])
  @@index([category])
  @@index([isPublic])
  @@map("infographic_templates")
}

// 图标库
model IconLibrary {
  id String @id @default(uuid())

  // 图标信息
  name     String @db.VarChar(100)
  category String @db.VarChar(50)
  tags     Json   @default("[]")

  // SVG 路径
  svgPath String @map("svg_path") @db.Text

  // 图标库来源
  library String @db.VarChar(50)
  // lucide, heroicons, custom

  // 使用统计
  usageCount Int @default(0) @map("usage_count")

  createdAt DateTime @default(now()) @map("created_at")

  @@unique([library, name])
  @@index([category])
  @@index([library])
  @@map("icon_library")
}

// 分享链接
model SharedInfographic {
  id String @id @default(uuid())

  imageId String         @map("image_id")
  image   GeneratedImage @relation(fields: [imageId], references: [id], onDelete: Cascade)

  // 分享设置
  shareCode    String    @unique @map("share_code") @db.VarChar(20)
  password     String?   @db.VarChar(100)
  expiresAt    DateTime? @map("expires_at")
  allowDownload Boolean  @default(true) @map("allow_download")
  allowEmbed   Boolean   @default(false) @map("allow_embed")

  // 访问统计
  viewCount     Int @default(0) @map("view_count")
  downloadCount Int @default(0) @map("download_count")

  createdAt DateTime @default(now()) @map("created_at")

  @@index([shareCode])
  @@index([imageId])
  @@map("shared_infographics")
}
```

### 6.2 TypeScript 类型定义

```typescript
// types/genesis-ai.ts

// ============================================
// 输入类型
// ============================================

export interface GenerateInfographicInput {
  // 内容来源 (至少提供一个)
  prompt?: string;
  content?: string;
  urls?: string[];
  files?: FileInput[];
  resourceId?: string; // Genesis 资源 ID
  referenceImage?: string; // Base64 或 URL

  // 模型选择
  textModelId?: string;
  imageModelId?: string;

  // 渲染设置
  renderingMode?: "html_render" | "hybrid" | "ai_image" | "auto";
  templateLayout?: TemplateLayoutType;

  // 输出设置
  outputFormat?: "png" | "svg" | "html";
  resolution?: "1024" | "2048" | "4096";
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3";

  // 品牌设置
  brandKitId?: string;

  // 样式覆盖
  styleOverrides?: Partial<VisualLanguage>;

  // 用户信息
  userId?: string;
}

export interface FileInput {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

// ============================================
// 输出类型
// ============================================

export interface GeneratedInfographic {
  id: string;

  // 图像 URL
  imageUrl: string;
  thumbnailUrl?: string;

  // 源码 (可编辑)
  editableSource?: string; // SVG 或 HTML 源码
  editableElements?: EditableElement[];

  // 元数据
  width: number;
  height: number;
  format: "png" | "svg" | "html";
  renderingMode: "html_render" | "hybrid" | "ai_image";
  templateLayout?: TemplateLayoutType;

  // 生成信息
  prompt: string;
  enhancedPrompt?: string;
  promptInsights?: PromptEngineeringInsights;

  // 模型信息
  textModelUsed?: string;
  imageModelUsed?: string;

  // 处理步骤
  processingSteps?: ProcessingStep[];

  // 时间戳
  createdAt: string;
}

// ============================================
// 内部类型
// ============================================

export type TemplateLayoutType =
  | "cards"
  | "center_visual"
  | "timeline"
  | "comparison"
  | "pyramid"
  | "radial"
  | "statistics"
  | "checklist"
  | "funnel"
  | "matrix"
  | "mindmap"
  | "flowchart"
  | "org_chart";

export interface PromptEngineeringInsights {
  // 渲染决策
  renderingMode: "html_render" | "hybrid" | "ai_image";
  templateLayout: TemplateLayoutType;

  // 内容分析
  contentAnalysis: {
    type: "data_heavy" | "balanced" | "visual_concept";
    structureType: string;
    language: "zh" | "en" | "mixed";
    complexity: "high" | "medium" | "low";
    reasoning: string;
  };

  // 信息架构
  informationArchitecture: {
    title: string;
    subtitle?: string;
    heroStatement?: string;
    sections: SectionData[];
    callToAction?: string;
  };

  // 视觉语言
  visualLanguage: VisualLanguage;

  // AI 图像提示词
  imagePrompt?: string;
  backgroundPrompt?: string;
  negativeKeywords?: string[];
}

export interface SectionData {
  id: string;
  title: string;
  summary?: string;
  bullets: string[];
  metrics?: MetricData[];
  iconType?: string;
  sectionType: "main" | "summary" | "callout";
}

export interface MetricData {
  label: string;
  value: string;
  unit?: string;
  trend?: "up" | "down" | "stable";
  comparison?: string;
}

export interface VisualLanguage {
  colorPalette: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
    textMuted: string;
    border: string;
  };
  typography: {
    headingFont: string;
    bodyFont: string;
    headingWeight: number;
    bodyWeight: number;
  };
  designStyle:
    | "consulting"
    | "tech"
    | "minimal"
    | "creative"
    | "dark"
    | "academic";
  iconStyle: "outline" | "filled" | "duotone";
  borderRadius: "none" | "small" | "medium" | "large";
  shadowStyle: "none" | "subtle" | "medium" | "strong";
}

export interface EditableElement {
  id: string;
  type: "text" | "icon" | "shape" | "image" | "chart" | "connector";
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
  };
  content: any;
  style: any;
  locked: boolean;
  visible: boolean;
  zIndex: number;
}

export interface ProcessingStep {
  step: string;
  status: "pending" | "processing" | "completed" | "error";
  title: string;
  content?: string;
  timestamp?: string;
  duration?: number;
}
```

---

## 七、API 接口设计

### 7.1 生成接口

```typescript
// POST /api/v1/engine/generate
interface GenerateRequest {
  // 输入
  prompt?: string;
  content?: string;
  urls?: string[];
  resourceId?: string;
  referenceImageBase64?: string;

  // 模型
  textModelId?: string;
  imageModelId?: string;

  // 渲染
  renderingMode?: "html_render" | "hybrid" | "ai_image" | "auto";
  templateLayout?: TemplateLayoutType;

  // 输出
  outputFormat?: "png" | "svg" | "html";
  resolution?: "1024" | "2048" | "4096";
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3";

  // 品牌
  brandKitId?: string;

  // 样式
  styleOverrides?: Partial<VisualLanguage>;
}

interface GenerateResponse {
  success: boolean;
  data: GeneratedInfographic;
}

// POST /api/v1/engine/generate/stream (SSE)
// 流式返回处理进度
interface StreamEvent {
  type: "step" | "preview" | "complete" | "error";
  data: ProcessingStep | GeneratedInfographic | ErrorInfo;
}
```

### 7.2 编辑接口

```typescript
// POST /api/v1/engine/:id/edit
interface EditRequest {
  // 自然语言编辑
  instruction?: string;

  // 或直接操作
  actions?: EditAction[];
}

interface EditResponse {
  success: boolean;
  data: {
    infographic: GeneratedInfographic;
    appliedActions: EditAction[];
    newVersion: number;
  };
}

// POST /api/v1/engine/:id/regenerate-background
interface RegenerateBackgroundRequest {
  prompt?: string; // 新提示词
  style?: string; // 风格
  colorHints?: string[]; // 色调提示
}

// POST /api/v1/engine/:id/change-layout
interface ChangeLayoutRequest {
  newLayout: TemplateLayoutType;
  preserveContent: boolean;
}

// POST /api/v1/engine/:id/apply-brand
interface ApplyBrandRequest {
  brandKitId: string;
}
```

### 7.3 导出接口

```typescript
// POST /api/v1/engine/:id/export
interface ExportRequest {
  format: "png" | "svg" | "pdf" | "pptx";
  options?: {
    // PNG
    scale?: 1 | 2 | 3 | 4;
    background?: "transparent" | "white" | string;

    // SVG
    embedFonts?: boolean;
    embedImages?: boolean;

    // PDF
    pageSize?: "A4" | "A3" | "Letter";
    orientation?: "portrait" | "landscape";

    // PPTX
    slideSize?: "16:9" | "4:3";
    editable?: boolean;
  };
}

interface ExportResponse {
  success: boolean;
  data: {
    downloadUrl: string;
    expiresAt: string;
    fileSize: number;
    format: string;
  };
}

// POST /api/v1/engine/:id/share
interface ShareRequest {
  expiresIn?: number; // 秒
  password?: string;
  allowDownload?: boolean;
  allowEmbed?: boolean;
}

interface ShareResponse {
  success: boolean;
  data: {
    shareUrl: string;
    shareCode: string;
    expiresAt?: string;
  };
}
```

### 7.4 品牌接口

```typescript
// GET /api/v1/brand-kits
// POST /api/v1/brand-kits
// PUT /api/v1/brand-kits/:id
// DELETE /api/v1/brand-kits/:id

interface BrandKitRequest {
  name: string;
  isDefault?: boolean;

  // Logo
  logoUrl?: string;
  logoDarkUrl?: string;

  // 颜色
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
    textMuted: string;
    border: string;
  };

  // 字体
  typography: {
    headingFont: string;
    bodyFont: string;
    monoFont?: string;
  };

  // 设计规范
  designTokens?: {
    iconStyle?: "outline" | "filled" | "duotone";
    borderRadius?: "none" | "small" | "medium" | "large";
    shadowStyle?: "none" | "subtle" | "medium" | "strong";
    spacing?: "compact" | "normal" | "spacious";
  };

  // 品牌语调
  voice?: {
    tone?: string[];
    guidelines?: string;
  };
}

// POST /api/v1/brand-kits/extract-from-logo
interface ExtractColorsRequest {
  logoUrl: string;
}

interface ExtractColorsResponse {
  success: boolean;
  data: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
  };
}
```

### 7.5 模板接口

```typescript
// GET /api/v1/templates
interface TemplatesQuery {
  category?: string;
  layoutType?: TemplateLayoutType;
  search?: string;
  page?: number;
  limit?: number;
}

// GET /api/v1/templates/:id
// GET /api/v1/templates/:id/preview
```

---

## 八、用户体验设计

### 8.1 核心使用流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                        GenesisPod 使用流程                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  STEP 1: 输入内容                                            │    │
│  │                                                              │    │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐            │    │
│  │  │ 📝 粘贴  │ │ 🔗 URL  │ │ 📄 上传  │ │ 📚 资源  │            │    │
│  │  │   文本   │ │  链接   │ │  文件   │ │   库    │            │    │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘            │    │
│  │                                                              │    │
│  │  [无需写提示词，直接粘贴内容即可]                               │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                              ↓                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  STEP 2: AI 分析 (3-5秒)                                     │    │
│  │                                                              │    │
│  │  ┌──────────────────────────────────────────────────────┐   │    │
│  │  │ ⏳ 正在分析内容结构...                                  │   │    │
│  │  │ ⏳ 提炼核心要点...                                      │   │    │
│  │  │ ⏳ 选择最佳布局: Cards                                  │   │    │
│  │  │ ⏳ 生成视觉元素...                                      │   │    │
│  │  │ ✅ 完成！                                               │   │    │
│  │  └──────────────────────────────────────────────────────┘   │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                              ↓                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  STEP 3: 预览与选择变体 (可选)                               │    │
│  │                                                              │    │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐               │    │
│  │  │        │ │        │ │        │ │        │               │    │
│  │  │ 变体 1  │ │ 变体 2  │ │ 变体 3  │ │ 变体 4  │               │    │
│  │  │  ✓选中  │ │        │ │        │ │        │               │    │
│  │  └────────┘ └────────┘ └────────┘ └────────┘               │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                              ↓                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  STEP 4: 编辑与优化                                          │    │
│  │                                                              │    │
│  │  ┌──────────────────────────────────────────────────────┐   │    │
│  │  │ 工具栏:                                               │   │    │
│  │  │ [切换布局▾] [切换样式▾] [应用品牌▾] [重新生成背景]     │   │    │
│  │  ├──────────────────────────────────────────────────────┤   │    │
│  │  │                                                      │   │    │
│  │  │              ╔═══════════════════════╗               │   │    │
│  │  │              ║                       ║               │   │    │
│  │  │              ║    生成的信息图        ║               │   │    │
│  │  │              ║   (点击元素可编辑)     ║               │   │    │
│  │  │              ║                       ║               │   │    │
│  │  │              ╚═══════════════════════╝               │   │    │
│  │  │                                                      │   │    │
│  │  ├──────────────────────────────────────────────────────┤   │    │
│  │  │ AI 编辑助手:                                          │   │    │
│  │  │ 💬 "把标题改成蓝色，背景换成科技感" [发送]              │   │    │
│  │  └──────────────────────────────────────────────────────┘   │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                              ↓                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  STEP 5: 导出与分享                                          │    │
│  │                                                              │    │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌────────┐ │    │
│  │  │ PNG 4K  │ │   SVG   │ │   PDF   │ │   PPT   │ │  分享   │ │    │
│  │  │ ⬇ 下载  │ │ ⬇ 下载  │ │ ⬇ 下载  │ │ ⬇ 下载  │ │ 🔗 链接 │ │    │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └────────┘ │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 8.2 关键交互设计

#### 8.2.1 无 Prompt 体验

```
用户行为:
  粘贴文本 → 点击 ✨ 生成按钮

系统行为:
  自动分析内容 → 自动选择布局 → 自动配色 → 生成信息图

无需用户:
  × 编写提示词
  × 选择模板
  × 配置参数
```

#### 8.2.2 实时进度反馈

```typescript
// SSE 事件示例
{ "type": "step", "data": { "step": "content_analysis", "status": "processing", "title": "分析内容结构" } }
{ "type": "step", "data": { "step": "content_analysis", "status": "completed", "content": "识别到 4 个核心要点" } }
{ "type": "step", "data": { "step": "layout_selection", "status": "processing", "title": "选择布局模板" } }
{ "type": "step", "data": { "step": "layout_selection", "status": "completed", "content": "推荐使用 Cards 布局" } }
{ "type": "preview", "data": { "thumbnailUrl": "...", "progress": 60 } }
{ "type": "step", "data": { "step": "rendering", "status": "processing", "title": "生成视觉元素" } }
{ "type": "complete", "data": { /* GeneratedInfographic */ } }
```

#### 8.2.3 自然语言编辑示例

| 用户输入                   | 系统理解     | 执行操作                |
| -------------------------- | ------------ | ----------------------- |
| "把标题改成红色"           | 修改标题颜色 | `UPDATE_COLOR`          |
| "增加一个关于安全性的要点" | 添加新内容   | `ADD_ELEMENT`           |
| "换成时间轴布局"           | 切换布局     | `CHANGE_LAYOUT`         |
| "整体风格更现代一些"       | 应用现代风格 | `UPDATE_STYLE`          |
| "使用我的品牌色"           | 应用品牌配置 | `APPLY_BRAND`           |
| "背景换成蓝色渐变"         | 重新生成背景 | `REGENERATE_BACKGROUND` |
| "把第二个卡片删掉"         | 删除元素     | `REMOVE_ELEMENT`        |
| "标题字体加粗"             | 修改字体样式 | `UPDATE_STYLE`          |

---

## 九、版本规划

### 9.1 Phase 1: 核心能力 (v2.0) - 8周

| 功能              | 优先级 | 工作量 | 依赖     | 负责人     |
| ----------------- | :----: | :----: | -------- | ---------- |
| 多Agent架构重构   |   P0   |  2周   | -        | Backend    |
| HTML/SVG 渲染引擎 |   P0   |  2周   | -        | Backend    |
| Hybrid 合成引擎   |   P0   | 1.5周  | 渲染引擎 | Backend    |
| 12种布局模板      |   P0   |  2周   | 渲染引擎 | Frontend   |
| SVG 可编辑输出    |   P0   | 1.5周  | 渲染引擎 | Backend    |
| 自然语言编辑      |   P0   | 1.5周  | 多Agent  | Backend    |
| 品牌配色系统      |   P0   |  1周   | -        | Full Stack |
| 4K 输出支持       |   P0   | 0.5周  | -        | Backend    |
| 布局一键切换      |   P0   |  1周   | 模板系统 | Frontend   |

**里程碑**:

- Week 4: 多Agent + 渲染引擎完成
- Week 6: 编辑系统 + 品牌系统完成
- Week 8: 集成测试 + 发布

### 9.2 Phase 2: 体验优化 (v2.1) - 6周

| 功能                  | 优先级 | 工作量 |
| --------------------- | :----: | :----: |
| 品牌字体上传          |   P1   |  1周   |
| 品牌模板保存          |   P1   | 1.5周  |
| 图标库扩展 (5000+)    |   P1   |  1周   |
| 局部重绘 (Inpainting) |   P1   |  2周   |
| 风格变体生成          |   P1   |  1周   |
| 思维导图/流程图模板   |   P1   |  2周   |
| PDF/PPT 导出          |   P1   | 1.5周  |
| 版本历史              |   P1   |  1周   |

**里程碑**:

- Week 3: 品牌系统增强完成
- Week 5: 新模板 + 导出完成
- Week 6: 测试 + 发布

### 9.3 Phase 3: 企业功能 (v2.2) - 6周

| 功能           | 优先级 | 工作量 |
| -------------- | :----: | :----: |
| 分享链接系统   |   P2   |  1周   |
| 嵌入代码生成   |   P2   | 0.5周  |
| 实时协作编辑   |   P2   |  3周   |
| 品牌语调 AI    |   P2   | 1.5周  |
| 多品牌管理     |   P2   |  1周   |
| 团队空间       |   P2   |  2周   |
| 使用分析仪表板 |   P2   |  1周   |

### 9.4 技术路线图

```
2024 Q4                    2025 Q1                    2025 Q2
────────────────────────────────────────────────────────────────
   v2.0                      v2.1                      v2.2
   核心能力                   体验优化                   企业功能

   • 多Agent架构              • 品牌字体                 • 实时协作
   • 3种渲染模式              • 5000+图标               • 团队空间
   • 12种布局模板             • 局部重绘                 • 分享系统
   • SVG可编辑               • PPT/PDF导出              • 多品牌
   • 自然语言编辑             • 版本历史                 • 分析仪表板
   • 品牌配色                 • 新模板
   • 4K输出
```

---

## 十、成功指标

### 10.1 核心指标 (North Star Metrics)

| 指标           | 定义                | 当前值 | v2.0 目标 | v2.2 目标 |
| -------------- | ------------------- | ------ | --------- | --------- |
| **生成成功率** | 成功生成 / 总请求   | ~85%   | ≥95%      | ≥98%      |
| **用户满意度** | 满意 / 总反馈       | -      | ≥80%      | ≥90%      |
| **导出率**     | 导出用户 / 生成用户 | ~30%   | ≥50%      | ≥70%      |

### 10.2 性能指标

| 指标           | 定义             | 当前值 | v2.0 目标 |
| -------------- | ---------------- | ------ | --------- |
| 平均生成时间   | 请求到完成       | ~8秒   | ≤5秒      |
| P95 生成时间   | 95分位           | ~15秒  | ≤10秒     |
| 布局选择准确率 | 用户不更换布局   | ~70%   | ≥85%      |
| 首次满意率     | 不需编辑直接导出 | ~20%   | ≥40%      |

### 10.3 使用指标

| 指标           | 定义                 | v2.0 目标 | v2.2 目标 |
| -------------- | -------------------- | --------- | --------- |
| 周活用户 (WAU) | 每周使用用户         | +50%      | +100%     |
| 人均生成数     | 周生成数/WAU         | 3张       | 5张       |
| 编辑使用率     | 使用编辑功能用户比例 | 40%       | 60%       |
| 品牌应用率     | 使用品牌配置用户比例 | 20%       | 40%       |
| 复访率         | 7日内再次使用        | 50%       | 65%       |

### 10.4 质量指标

| 指标       | 定义              | v2.0 目标 |
| ---------- | ----------------- | --------- |
| 文字清晰度 | 文字100%可读      | 100%      |
| 布局美观度 | 用户评分 (1-5)    | ≥4.0      |
| 内容准确性 | 要点提取完整      | ≥90%      |
| 品牌一致性 | 颜色/字体正确应用 | 100%      |

---

## 十一、风险与对策

### 11.1 技术风险

| 风险                     | 影响 | 概率 | 对策                                          |
| ------------------------ | ---- | ---- | --------------------------------------------- |
| Nano Banana Pro API 限流 | 高   | 中   | 多模型 fallback (DALL-E, SD)，请求队列，缓存  |
| SVG 复杂度导致性能问题   | 中   | 中   | 元素数量限制 (<100)，虚拟滚动，懒渲染         |
| 中文字体渲染问题         | 高   | 低   | 预置中文字体，字体子集化                      |
| 浏览器兼容性             | 中   | 低   | Polyfill，降级方案，测试覆盖                  |
| HTML 截图质量不稳定      | 中   | 中   | 多引擎方案 (Puppeteer + Playwright)，重试机制 |

### 11.2 产品风险

| 风险             | 影响 | 概率 | 对策                                 |
| ---------------- | ---- | ---- | ------------------------------------ |
| 布局选择不准确   | 高   | 高   | 强化 Layout Agent 训练，用户反馈学习 |
| 品牌色搭配不协调 | 中   | 中   | AI 配色建议，预设方案，对比度检查    |
| 用户学习成本高   | 中   | 低   | 新手引导，示例库，快捷操作           |
| 生成结果不符预期 | 高   | 中   | 多变体选择，快速迭代编辑，撤销/重做  |

### 11.3 成本风险

| 风险                | 影响 | 概率 | 对策                                     |
| ------------------- | ---- | ---- | ---------------------------------------- |
| 多 Agent 调用成本高 | 中   | 高   | 使用 GPT-4o-mini，缓存常见模式，批量处理 |
| 图像生成 API 成本   | 高   | 中   | 分辨率阶梯定价，缓存生成结果，用户配额   |
| 存储成本增长        | 中   | 中   | 图片压缩，定期清理，用户配额             |

### 11.4 风险缓解预算

| 项目              | 预算       | 用途          |
| ----------------- | ---------- | ------------- |
| 备用 API Provider | $500/月    | 多模型冗余    |
| 性能监控工具      | $200/月    | APM, 错误追踪 |
| 用户研究          | $1000/季度 | 可用性测试    |

---

## 附录

### A. 参考资料

- [Napkin AI 官网](https://www.napkin.ai/)
- [Napkin AI 多Agent架构 - VentureBeat](https://venturebeat.com/ai/napkin-vertical-ai-agents-design)
- [Canva Magic Studio](https://www.canva.com/magic/)
- [Canva Brand Kit](https://www.canva.com/pro/brand-kit/)
- [Nano Banana Pro (Gemini 3 Pro Image)](https://gemini.google/overview/image-generation/)
- [Nano Banana Pro API 文档](https://ai.google.dev/gemini-api/docs/image-generation)

### B. 术语表

| 术语         | 定义                                  |
| ------------ | ------------------------------------- |
| Agent        | 执行特定任务的 AI 模块                |
| Orchestrator | 协调多个 Agent 的编排器               |
| Hybrid 渲染  | HTML 文字层 + AI 图像背景层的混合渲染 |
| SVG          | 可缩放矢量图形，支持编辑              |
| Brand Kit    | 品牌配置，包含颜色、字体、Logo 等     |
| LQIP         | 低质量图片占位符                      |

### C. 更新历史

| 版本       | 日期       | 变更内容                                                | 作者         |
| ---------- | ---------- | ------------------------------------------------------- | ------------ |
| v2.0-draft | 2024-12-02 | 初始版本                                                | Product Team |
| v2.1       | 2024-12-02 | 统一渲染模式重构，Multi-Agent系统，品牌套件，多格式导出 | Product Team |

### D. v2.1 实现文件清单

| 文件                                                     | 说明                 |
| -------------------------------------------------------- | -------------------- |
| `backend/src/modules/ai-image/engine.types.ts`           | 统一渲染架构类型定义 |
| `backend/src/modules/ai-image/agent-executor.service.ts` | Multi-Agent 执行器   |
| `backend/src/modules/ai-image/brand-kit.service.ts`      | 品牌套件服务         |
| `backend/src/modules/ai-image/brand-kit.controller.ts`   | 品牌套件 API         |
| `backend/src/modules/ai-image/export.service.ts`         | 多格式导出服务       |
| `backend/src/modules/ai-image/export.controller.ts`      | 导出 API             |
| `backend/prisma/schema.prisma`                           | BrandKit 数据模型    |

### E. 部署说明

1. **数据库迁移**：

   ```bash
   npx prisma migrate dev --name add-brand-kit
   npx prisma generate
   ```

2. **新增 API 端点**：
   - `GET /brand-kit` - 获取用户品牌套件
   - `GET /brand-kit/presets` - 获取预设品牌套件
   - `POST /brand-kit` - 创建品牌套件
   - `PUT /brand-kit/:id` - 更新品牌套件
   - `DELETE /brand-kit/:id` - 删除品牌套件
   - `POST /ai-image/export` - 导出信息图
   - `POST /ai-image/export/png` - 导出 PNG
   - `POST /ai-image/export/svg` - 导出 SVG
   - `POST /ai-image/export/pdf` - 导出 PDF

3. **可选依赖**：
   - `pptxgenjs` - PPTX 导出支持

---

_文档结束_
