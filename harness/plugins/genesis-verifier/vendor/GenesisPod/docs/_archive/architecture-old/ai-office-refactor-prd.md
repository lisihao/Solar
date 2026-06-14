# AI Office 重构方案 - 产品需求文档 (PRD)

> **版本**: v1.1
> **日期**: 2025-12-02
> **状态**: 待评审
> **参考产品**: [Gamma.app](https://gamma.app/ai-powerpoint), Genspark AI

---

## 1. 执行摘要

### 1.1 重构目标

将现有 AI Office 升级为类 Gamma.app 的专业级 AI 文档生成平台，核心增强：

1. **Genspark 风格版本管理** - 可视化保存点系统，支持一键回溯和对比
2. **资源 @ 引用系统** - 用户主动选择关键输入资源，精准控制生成上下文
3. **文本推理 + 图形渲染双引擎** - 复用 AI Image 架构，**动态配置 AI 模型**，实现智能内容分析 → Prompt 生成 → 模板渲染
4. **所见即所得编辑 + 无损导出** - 支持实时编辑，导出 **PPTX/DOCX/XLSX/PDF** 保持格式一致
5. **AI 陪伴式交互** - 全程自然语言对话，操作界面顺滑流畅，深度感知 AI 存在

### 1.2 核心差异化优势

| 特性     | Gamma.app       | 本方案                                   |
| -------- | --------------- | ---------------------------------------- |
| 版本管理 | 基础历史记录    | **Genspark 风格保存点 + 可视化时间线**   |
| 资源引用 | 无              | **@资源系统 + 知识库集成**               |
| AI 模型  | 固定模型        | **动态配置，从 AIModel 表读取默认值**    |
| 渲染引擎 | 纯模板          | **AI 推理 + HTML/SVG 动态渲染**          |
| 编辑能力 | 在线编辑        | **TipTap 富文本 + 页面级编辑 + AI 陪伴** |
| 导出格式 | PDF/PPTX (有损) | **PPTX/DOCX/XLSX 无损 + 继续编辑**       |
| 交互体验 | 表单式          | **自然语言对话 + 实时反馈 + 流畅动效**   |

### 1.3 设计原则

#### 1.3.1 AI 模型动态配置原则 (严禁硬编码)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        AI 模型选择流程                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  用户选择模型?                                                          │
│       │                                                                 │
│       ├── 是 → 使用用户选择的模型                                       │
│       │                                                                 │
│       └── 否 → 查询 AIModel 表                                          │
│                    │                                                    │
│                    ├── 文本任务 → WHERE modelType = 'CHAT'              │
│                    │              AND isDefault = true                  │
│                    │              AND isEnabled = true                  │
│                    │                                                    │
│                    └── 图形任务 → WHERE modelType = 'IMAGE_GENERATION'  │
│                                   AND isDefault = true                  │
│                                   AND isEnabled = true                  │
│                                                                         │
│  ⚠️ 禁止: model: 'grok', model: 'gpt-4' 等硬编码                        │
│  ✅ 正确: await getDefaultModel(AIModelType.CHAT)                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 1.3.2 AI 陪伴式交互原则

- **全程对话**: 所有操作都可通过自然语言完成
- **实时反馈**: 打字机效果、进度动画、状态提示
- **智能建议**: AI 主动推荐下一步操作
- **流畅动效**: 所有状态切换带有平滑过渡动画
- **情感化设计**: 友好的提示语、适当的幽默感

---

## 2. 产品架构设计

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         AI Office 前端 (Next.js 14)                      │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │  资源池面板   │  │  AI 对话面板  │  │  文档编辑器   │  │  版本管理器  │ │
│  │  @引用选择器  │  │  Prompt输入   │  │  TipTap编辑  │  │  时间线UI    │ │
│  │  知识库浏览   │  │  实时流式输出  │  │  PPT预览    │  │  对比/回溯   │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘ │
├─────────────────────────────────────────────────────────────────────────┤
│                         API Gateway (Next.js API Routes)                │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
┌───────────────────────────────┴─────────────────────────────────────────┐
│                         AI Office 后端 (NestJS)                          │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐  │
│  │  文档服务       │  │  版本服务        │  │  资源引用服务            │  │
│  │  - CRUD        │  │  - 保存点管理    │  │  - @解析器               │  │
│  │  - 模板管理     │  │  - Diff计算     │  │  - 上下文构建            │  │
│  │  - 导出服务     │  │  - 快照存储     │  │  - 关联追踪              │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────┘  │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                    文档生成引擎 (复用 AI Image 架构)                  ││
│  │  ┌───────────┐    ┌───────────┐    ┌───────────┐    ┌───────────┐  ││
│  │  │ 意图分析器 │ → │ 大纲生成器 │ → │Prompt工程 │ → │ 渲染引擎  │  ││
│  │  │ (Grok)    │    │ (Grok)    │    │ (Grok)    │    │HTML+SVG   │  ││
│  │  └───────────┘    └───────────┘    └───────────┘    └───────────┘  ││
│  └─────────────────────────────────────────────────────────────────────┘│
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
┌───────────────────────────────┴─────────────────────────────────────────┐
│                           数据层 (PostgreSQL)                            │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │  Document    │  │DocumentVersion│  │ResourceRef   │  │   Template   │ │
│  │  文档实体     │  │  版本快照     │  │  资源引用    │  │  模板库      │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 核心模块设计

#### 2.2.1 版本管理模块 (Genspark 风格)

**UI 设计参考** (截图所示):

- 顶部下拉选择器显示当前版本（如 "保存点-14"）
- 悬浮面板展示版本列表：
  - 版本号 + 时间戳
  - 版本描述（AI 自动生成）
  - 快速预览缩略图

**数据模型**:

```prisma
model DocumentVersion {
  id            String   @id @default(uuid())
  documentId    String
  versionNumber Int      // 递增版本号
  name          String   // "保存点-14"
  description   String?  // AI生成的版本描述

  // 内容快照
  contentSnapshot Json   // 完整内容快照 (JSONB)
  markdownHash    String // 内容哈希用于快速对比

  // 触发方式
  trigger       VersionTrigger // AI_GENERATION | USER_EDIT | MANUAL_SAVE | AUTO_SAVE

  // 元数据
  slideCount    Int?
  wordCount     Int?
  thumbnail     String?  // Base64缩略图

  // AI信息
  aiModel       String?
  promptUsed    String?

  createdAt     DateTime @default(now())

  // 关联
  document      Document @relation(fields: [documentId], references: [id])

  @@index([documentId, createdAt])
}

enum VersionTrigger {
  AI_GENERATION   // AI生成新版本
  USER_EDIT       // 用户编辑触发
  MANUAL_SAVE     // 手动保存
  AUTO_SAVE       // 自动保存 (每5分钟)
}
```

**功能特性**:

1. **智能版本描述**: AI 自动分析内容变化生成描述（如 "创建第14页投资价值评估,展示投资论..."）
2. **缩略图预览**: 自动为每个版本生成首页缩略图
3. **一键回溯**: 点击任意版本立即恢复
4. **版本对比**: 并排对比任意两个版本的差异
5. **版本分支**: 从历史版本创建新分支（高级功能）

#### 2.2.2 资源 @ 引用系统

**交互设计**:

```
┌─────────────────────────────────────────────────────────────────┐
│  输入框                                                         │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 请帮我生成一份关于 @Palantir 2024年报 @McKinsey AI报告      ││
│  │ 的投资分析PPT                                               ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  已选资源:                                                      │
│  ┌──────────────┐ ┌──────────────┐                              │
│  │📄 Palantir   │ │📊 McKinsey   │                              │
│  │   2024年报   │ │   AI报告     │                              │
│  │   [x]        │ │   [x]        │                              │
│  └──────────────┘ └──────────────┘                              │
└─────────────────────────────────────────────────────────────────┘
```

**数据模型**:

```prisma
model DocumentResourceRef {
  id          String   @id @default(uuid())
  documentId  String
  resourceId  String

  // 引用类型
  refType     ResourceRefType  // PRIMARY | SUPPORTING | CITED

  // 使用位置
  usedInSlides Int[]   // [1, 3, 5] - 在哪些页面使用

  // 提取的关键信息
  extractedInfo Json?  // AI从资源中提取的关键数据点

  createdAt   DateTime @default(now())

  document    Document @relation(fields: [documentId], references: [id])
  resource    Resource @relation(fields: [resourceId], references: [id])

  @@unique([documentId, resourceId])
}

enum ResourceRefType {
  PRIMARY     // 主要参考资源
  SUPPORTING  // 辅助参考
  CITED       // 引用来源
}
```

**功能特性**:

1. **@ 触发选择器**: 输入 @ 弹出资源选择下拉菜单
2. **智能搜索**: 支持按标题、标签、类型搜索资源
3. **上下文预览**: 悬停显示资源摘要
4. **自动提取**: AI 自动从选中资源提取关键数据点
5. **引用追踪**: 生成后可查看每页内容来源于哪个资源

#### 2.2.3 文档生成引擎 (复用 AI Image 架构)

**生成流程** (Pipeline):

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         文档生成 Pipeline                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Step 0: 模型选择 (严禁硬编码!)                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │ // 正确做法: 从数据库读取默认模型                                    ││
│  │ const textModel = await getDefaultModel(AIModelType.CHAT);          ││
│  │ const imageModel = await getDefaultModel(AIModelType.IMAGE_GEN);    ││
│  │                                                                     ││
│  │ // ❌ 禁止: model: 'grok', aiModel: 'gpt-4'                         ││
│  │ // ✅ 正确: model: textModel.modelId                                ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                    ↓                                    │
│  Step 1: 意图分析                                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │ 输入: 用户Prompt + @引用资源                                        ││
│  │ 输出: 文档类型、风格、目标受众、页数建议                              ││
│  │ 模型: textModel (从 AIModel 表动态获取)                             ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                    ↓                                    │
│  Step 2: 信息架构设计                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │ 输入: 意图分析结果 + 资源内容摘要                                    ││
│  │ 输出: 大纲结构 (章节、小节、要点)                                    ││
│  │ 模型: textModel (动态配置)                                          ││
│  │ 格式:                                                               ││
│  │   {                                                                 ││
│  │     "title": "Palantir 投资价值分析",                               ││
│  │     "sections": [                                                   ││
│  │       { "title": "公司概览", "type": "cover", "keyPoints": [...] }, ││
│  │       { "title": "业务模式", "type": "content", "data": [...] },    ││
│  │       { "title": "财务分析", "type": "chart", "metrics": [...] }    ││
│  │     ]                                                               ││
│  │   }                                                                 ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                    ↓                                    │
│  Step 3: 页面级 Prompt 生成                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │ 输入: 大纲结构 + 资源详细内容                                        ││
│  │ 输出: 每页的结构化 Prompt                                           ││
│  │ 模型: textModel (动态配置)                                          ││
│  │ 格式:                                                               ││
│  │   {                                                                 ││
│  │     "pageNumber": 3,                                                ││
│  │     "layout": "statistics",                                         ││
│  │     "template": "genspark",                                         ││
│  │     "content": {                                                    ││
│  │       "title": "2024年关键财务指标",                                 ││
│  │       "metrics": [                                                  ││
│  │         { "label": "营收", "value": "$2.2B", "change": "+17%" }     ││
│  │       ]                                                             ││
│  │     }                                                               ││
│  │   }                                                                 ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                    ↓                                    │
│  Step 4: 模板渲染 (可选 AI 图形生成)                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │ 输入: 页面级 Prompt                                                 ││
│  │ 输出: HTML + CSS + SVG 页面                                         ││
│  │ 引擎: InfographicTemplateService (复用 AI Image)                    ││
│  │ 图形模型: imageModel (如需 AI 生成背景/图标，从配置获取)             ││
│  │ 模板: 9种风格 x 10种布局 = 90种组合                                  ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                    ↓                                    │
│  Step 5: 渲染 & 存储                                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │ - Puppeteer 截图生成预览图                                          ││
│  │ - 存储 HTML 源码用于编辑                                            ││
│  │ - 生成 PPTX/DOCX/XLSX 用于导出                                      ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**模型获取服务** (复用 AI Image 实现):

```typescript
// backend/src/modules/ai-office/ai-model.service.ts

@Injectable()
export class AIModelService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取默认文本模型 (用于推理、生成)
   * 优先级: 用户选择 > 系统默认 (isDefault=true) > 任意启用的模型
   */
  async getDefaultTextModel(userModelId?: string): Promise<AIModel> {
    // 1. 用户指定了模型
    if (userModelId) {
      const userModel = await this.prisma.aIModel.findUnique({
        where: { id: userModelId, isEnabled: true },
      });
      if (userModel) return userModel;
    }

    // 2. 查找系统默认文本模型
    const defaultModel = await this.prisma.aIModel.findFirst({
      where: {
        modelType: AIModelType.CHAT,
        isDefault: true,
        isEnabled: true,
      },
    });
    if (defaultModel) return defaultModel;

    // 3. Fallback: 任意启用的文本模型
    const anyModel = await this.prisma.aIModel.findFirst({
      where: {
        modelType: AIModelType.CHAT,
        isEnabled: true,
      },
    });
    if (!anyModel) throw new Error("No text model configured");
    return anyModel;
  }

  /**
   * 获取默认图形生成模型
   */
  async getDefaultImageModel(userModelId?: string): Promise<AIModel> {
    if (userModelId) {
      const userModel = await this.prisma.aIModel.findUnique({
        where: { id: userModelId, isEnabled: true },
      });
      if (userModel) return userModel;
    }

    const defaultModel = await this.prisma.aIModel.findFirst({
      where: {
        modelType: AIModelType.IMAGE_GENERATION,
        isDefault: true,
        isEnabled: true,
      },
    });
    if (defaultModel) return defaultModel;

    const anyModel = await this.prisma.aIModel.findFirst({
      where: {
        modelType: AIModelType.IMAGE_GENERATION,
        isEnabled: true,
      },
    });
    if (!anyModel) throw new Error("No image model configured");
    return anyModel;
  }
}
```

**模板系统** (复用 infographic-template.service.ts):

| 风格 (Style)    | 适用场景                    |
| --------------- | --------------------------- |
| `consulting`    | 商业咨询报告 (McKinsey/BCG) |
| `tech`          | 科技产品介绍                |
| `genspark`      | 深蓝渐变 + 玻璃态 (默认)    |
| `tech_gradient` | 紫蓝渐变科技感              |
| `minimal`       | 极简留白风格                |
| `dark`          | 暗黑模式                    |
| `academic`      | 学术报告                    |
| `business`      | 商务简约                    |
| `creative`      | 创意活泼                    |

| 布局 (Layout)   | 用途                |
| --------------- | ------------------- |
| `cards`         | 多卡片网格          |
| `center_visual` | 中心图形 + 周围要点 |
| `timeline`      | 时间线/流程         |
| `comparison`    | 左右对比            |
| `pyramid`       | 金字塔层级          |
| `radial`        | 放射状              |
| `statistics`    | 数据统计展示        |
| `checklist`     | 清单/要点           |
| `funnel`        | 漏斗图              |
| `matrix`        | 2x2 矩阵            |

#### 2.2.4 编辑与导出系统

**编辑模式**:

1. **文本编辑模式**
   - 基于 TipTap 的富文本编辑器
   - 支持 Markdown 实时预览
   - AI 辅助续写/改写/润色

2. **页面编辑模式** (PPT)
   - 选中单页进行编辑
   - 修改标题、内容、数据
   - 切换布局/风格
   - 拖拽调整元素位置 (高级)

3. **AI 编辑模式**
   - 自然语言指令: "把第3页的标题改成xxx"
   - "在第5页后面添加一页关于xxx的内容"
   - "把整体风格换成深色模式"

**导出格式** (完整 Office 套件支持):

| 格式       | 实现方案             | 可继续编辑 | 适用文档类型      |
| ---------- | -------------------- | ---------- | ----------------- |
| **PPTX**   | PptxGenJS + 模板映射 | Yes        | PPT演示文稿       |
| **DOCX**   | docx.js + 样式映射   | Yes        | 文章/报告/提案    |
| **XLSX**   | ExcelJS + 数据映射   | Yes        | 数据表格/分析报告 |
| PDF        | Puppeteer 截图合并   | No         | 所有类型          |
| HTML       | 原始 HTML 打包       | Yes (代码) | 所有类型          |
| Markdown   | 结构化 MD 导出       | Yes        | 文章/文档         |
| 图片 (PNG) | Puppeteer 单页截图   | No         | PPT单页           |

**PPTX 导出详细方案**:

```typescript
// 使用 PptxGenJS 生成真正的 PPTX
import PptxGenJS from "pptxgenjs";

async function exportToPPTX(document: PPTDocument): Promise<Buffer> {
  const pptx = new PptxGenJS();

  // 设置主题
  pptx.defineLayout({ name: "CUSTOM", width: 13.33, height: 7.5 });
  pptx.layout = "CUSTOM";

  for (const page of document.pages) {
    const slide = pptx.addSlide();

    // 根据 layout 类型映射到 PPTX 元素
    switch (page.layout) {
      case "statistics":
        slide.addText(page.title, { x: 0.5, y: 0.5, fontSize: 28 });
        page.metrics.forEach((m, i) => {
          slide.addText(m.value, { x: i * 3, y: 2, fontSize: 48 });
          slide.addText(m.label, { x: i * 3, y: 3, fontSize: 14 });
        });
        break;
      // ... 其他布局
    }
  }

  return await pptx.write({ outputType: "arraybuffer" });
}
```

**DOCX 导出详细方案**:

```typescript
// 使用 docx.js 生成 Word 文档
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
} from "docx";

async function exportToDOCX(document: ArticleDocument): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          // 标题
          new Paragraph({
            text: document.title,
            heading: HeadingLevel.TITLE,
          }),
          // 正文内容
          ...document.sections
            .map((section) => [
              new Paragraph({
                text: section.title,
                heading: HeadingLevel.HEADING_1,
              }),
              ...section.paragraphs.map(
                (p) =>
                  new Paragraph({
                    children: [new TextRun(p.text)],
                  }),
              ),
              // 如果有表格
              ...(section.tables || []).map((t) => createTable(t)),
            ])
            .flat(),
        ],
      },
    ],
  });

  return await Packer.toBuffer(doc);
}
```

**XLSX 导出详细方案**:

```typescript
// 使用 ExcelJS 生成 Excel 文档
import ExcelJS from "exceljs";

async function exportToXLSX(document: ExcelDocument): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  for (const sheet of document.sheets) {
    const worksheet = workbook.addWorksheet(sheet.name);

    // 设置列宽
    worksheet.columns = sheet.columns.map((col) => ({
      header: col.header,
      key: col.key,
      width: col.width || 15,
    }));

    // 添加数据行
    sheet.data.forEach((row) => {
      worksheet.addRow(row);
    });

    // 应用样式
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF4F81BD" },
    };
  }

  return await workbook.xlsx.writeBuffer();
}
```

---

## 3. AI 陪伴式交互设计

### 3.1 设计理念

**核心目标**: 让用户在整个文档创建过程中，深深感知到 AI 的陪伴和帮助，而非冷冰冰的工具操作。

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        AI 陪伴交互金字塔                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│                           ┌─────────┐                                   │
│                           │  情感   │  ← 友好、幽默、鼓励                │
│                          ─┴─────────┴─                                  │
│                        ┌───────────────┐                                │
│                        │   智能建议    │  ← 主动推荐、预判需求           │
│                       ─┴───────────────┴─                               │
│                     ┌─────────────────────┐                             │
│                     │    实时反馈        │  ← 打字机、进度、状态          │
│                    ─┴─────────────────────┴─                            │
│                  ┌───────────────────────────┐                          │
│                  │      自然语言交互        │  ← 对话式、无学习成本        │
│                 ─┴───────────────────────────┴─                         │
│               ┌─────────────────────────────────┐                       │
│               │        流畅动效               │  ← 丝滑过渡、即时响应     │
│              ─┴─────────────────────────────────┴─                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 交互场景设计

#### 3.2.1 开场引导 (Onboarding)

```tsx
// 首次进入 AI Office
<AIGreeting>
  <Avatar animation="wave" />
  <Message typing={true}>
    嗨！我是你的 AI 文档助手 ✨ 告诉我你想创建什么，比如： - "帮我做一份关于 AI
    行业的投资分析 PPT" - "把这份研究报告整理成 Word 文档" -
    "生成一个项目进度跟踪表格"
  </Message>
  <QuickActions>
    <Action icon="📊" label="创建 PPT" />
    <Action icon="📝" label="写文章" />
    <Action icon="📈" label="做报表" />
  </QuickActions>
</AIGreeting>
```

#### 3.2.2 生成过程中的 AI 对话

```tsx
// 生成进度实时对话
const generationMessages = [
  { stage: "analyzing", message: "正在理解你的需求，让我看看这些资料..." },
  {
    stage: "outlining",
    message: "大纲设计好了！我规划了 12 页内容，要先看看吗？",
  },
  {
    stage: "generating",
    message: "第 3 页在讲财务数据，我找到了一些关键指标 📊",
  },
  { stage: "rendering", message: "快好了！正在给你的 PPT 穿上漂亮的衣服 🎨" },
  {
    stage: "complete",
    message: "搞定！看看效果如何？有什么需要调整的随时告诉我 😊",
  },
];

// 显示效果: 打字机 + 进度条 + 预览缩略图
```

#### 3.2.3 编辑时的 AI 建议

```tsx
// 用户选中一页后，AI 主动建议
<AIAssistant floating={true} position="right">
  <Suggestion>
    💡 这页数据有点多，要不要拆成两页？
    <Button variant="soft">好的，帮我拆分</Button>
    <Button variant="ghost">不用了</Button>
  </Suggestion>
</AIAssistant>

// 用户输入时的智能补全
<Input
  value={userInput}
  onChange={setUserInput}
  aiSuggestion={aiSuggestion}  // 灰色提示文字
  onAccept={acceptSuggestion}  // Tab 键接受
/>
```

#### 3.2.4 错误处理的友好提示

```tsx
// 传统方式 ❌
<Alert type="error">
  生成失败: API_RATE_LIMIT_EXCEEDED
</Alert>

// AI 陪伴方式 ✅
<AIMessage type="apologetic">
  <Avatar emotion="sorry" />
  <Message>
    抱歉，现在用的人有点多，我需要休息一下 😅
    <br />
    你可以：
    <br />
    • 等 30 秒后重试
    <br />
    • 切换到备用 AI 模型
  </Message>
  <Actions>
    <Button countdown={30}>稍后重试</Button>
    <Button onClick={switchModel}>切换模型</Button>
  </Actions>
</AIMessage>
```

### 3.3 动效设计规范

#### 3.3.1 核心动效

| 动效           | 场景        | 时长     | Easing      |
| -------------- | ----------- | -------- | ----------- |
| **打字机**     | AI 消息输出 | 30ms/字  | linear      |
| **淡入滑动**   | 新内容出现  | 300ms    | ease-out    |
| **骨架屏闪烁** | 加载中      | 1.5s循环 | ease-in-out |
| **进度条**     | 生成进度    | 实时     | linear      |
| **弹性缩放**   | 按钮点击    | 150ms    | spring      |
| **模糊过渡**   | 面板切换    | 200ms    | ease        |

#### 3.3.2 实现示例

```css
/* 打字机光标闪烁 */
.typing-cursor {
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}

/* AI 头像呼吸动效 */
.ai-avatar {
  animation: breathe 3s ease-in-out infinite;
}

@keyframes breathe {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.05);
  }
}

/* 内容淡入滑动 */
.slide-in {
  animation: slideIn 300ms ease-out forwards;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

### 3.4 自然语言指令设计

#### 3.4.1 支持的指令类型

| 类型     | 示例                       | AI 响应      |
| -------- | -------------------------- | ------------ |
| **创建** | "帮我做一份关于xxx的PPT"   | 启动生成流程 |
| **修改** | "把第3页的标题改成xxx"     | 定位并修改   |
| **添加** | "在第5页后面加一页关于xxx" | 插入新页面   |
| **删除** | "删掉最后两页"             | 确认后删除   |
| **调整** | "换成深色主题"             | 应用样式     |
| **查询** | "这份PPT一共多少页"        | 返回统计信息 |
| **导出** | "导出成Word格式"           | 执行导出     |
| **撤销** | "撤销刚才的修改"           | 恢复上一版本 |

#### 3.4.2 指令解析流程

```typescript
// backend/src/modules/ai-office/command-parser.service.ts

interface ParsedCommand {
  intent:
    | "create"
    | "modify"
    | "add"
    | "delete"
    | "style"
    | "query"
    | "export"
    | "undo";
  target?: {
    type: "page" | "element" | "document" | "style";
    selector?: string; // "第3页", "标题", "最后两页"
  };
  action?: string;
  params?: Record<string, any>;
  confidence: number;
}

async function parseCommand(input: string): Promise<ParsedCommand> {
  // 使用 AI 模型解析自然语言指令
  const textModel = await this.aiModelService.getDefaultTextModel();

  const response = await this.aiService.chat(textModel, {
    system: COMMAND_PARSER_PROMPT,
    user: input,
  });

  return JSON.parse(response);
}
```

### 3.5 前端组件：AI 对话面板

```tsx
// frontend/components/ai-office/chat/AIChatPanel.tsx

interface AIChatPanelProps {
  documentId: string;
  onCommand: (command: ParsedCommand) => void;
}

export function AIChatPanel({ documentId, onCommand }: AIChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);

  return (
    <div className="flex flex-col h-full">
      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <ChatMessage
            key={i}
            message={msg}
            isTyping={isTyping && i === messages.length - 1}
          />
        ))}
      </div>

      {/* AI 状态指示器 */}
      <AIStatusIndicator
        status={isTyping ? "thinking" : "ready"}
        message={isTyping ? "正在思考..." : "有什么需要帮忙的？"}
      />

      {/* 输入区域 */}
      <div className="border-t p-4">
        <div className="relative">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入指令或问题..."
            className="pr-12"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                handleSend();
              }
            }}
          />
          <Button
            size="icon"
            className="absolute right-2 top-1/2 -translate-y-1/2"
            onClick={handleSend}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>

        {/* 快捷操作 */}
        <div className="flex gap-2 mt-2">
          <QuickAction icon="✨" label="优化内容" />
          <QuickAction icon="🎨" label="换风格" />
          <QuickAction icon="📤" label="导出" />
        </div>
      </div>
    </div>
  );
}
```

### 3.6 体验指标

| 指标           | 目标值  | 测量方式               |
| -------------- | ------- | ---------------------- |
| 首次响应时间   | < 500ms | 用户输入到 AI 开始回复 |
| 打字机流畅度   | 30ms/字 | 无卡顿                 |
| 动效帧率       | > 60fps | Performance Monitor    |
| 指令识别准确率 | > 95%   | A/B 测试               |
| 用户满意度     | > 4.5/5 | 内置评价               |

---

## 4. 数据库 Schema 设计

### 3.1 新增/修改的数据模型

```prisma
// ============================================================================
// AI Office 核心模型
// ============================================================================

model Document {
  id              String   @id @default(uuid())
  userId          String
  workspaceId     String?

  // 基础信息
  title           String
  type            DocumentType  // ARTICLE | PPT | REPORT | PROPOSAL
  status          DocumentStatus // DRAFT | GENERATING | COMPLETED | ARCHIVED

  // 内容存储
  content         Json     // 结构化内容 (每页数据)
  markdown        String?  // Markdown 源码 (可选)
  htmlSnapshots   Json?    // HTML 页面快照数组

  // 版本管理
  currentVersionId String?

  // 元数据
  metadata        Json     // { slideCount, wordCount, duration, ... }

  // AI 配置
  aiConfig        Json?    // { model, temperature, style, ... }
  generationLogs  Json?    // 生成过程日志

  // 时间戳
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  // 关联
  user            User     @relation(fields: [userId], references: [id])
  workspace       Workspace? @relation(fields: [workspaceId], references: [id])
  versions        DocumentVersion[]
  resourceRefs    DocumentResourceRef[]

  @@index([userId, createdAt])
  @@index([workspaceId])
  @@index([type, status])
}

enum DocumentType {
  ARTICLE       // 文章/博客 → 导出 DOCX
  PPT           // 演示文稿 → 导出 PPTX
  SPREADSHEET   // 数据表格 → 导出 XLSX
  REPORT        // 分析报告 → 导出 DOCX/PDF
  PROPOSAL      // 提案/计划书 → 导出 DOCX/PPTX
  RESEARCH      // 研究文档 → 导出 DOCX
}

enum DocumentStatus {
  DRAFT         // 草稿
  GENERATING    // 生成中
  COMPLETED     // 已完成
  ARCHIVED      // 已归档
}

model DocumentVersion {
  id              String   @id @default(uuid())
  documentId      String
  versionNumber   Int      // 递增版本号 (1, 2, 3...)

  // 版本标识
  name            String   // "保存点-14" (自动生成)
  description     String?  // AI 生成的版本描述

  // 内容快照
  contentSnapshot Json     // 完整内容快照
  markdownSnapshot String? // Markdown 快照

  // 触发信息
  trigger         VersionTrigger
  triggerSource   String?  // 触发来源详情 (如 "用户编辑第3页标题")

  // 元数据快照
  metadataSnapshot Json    // { slideCount, wordCount, ... }

  // 缩略图
  thumbnail       String?  // Base64 or URL

  // AI 信息
  aiModel         String?
  promptUsed      String?  // 生成时使用的 Prompt

  // 时间
  createdAt       DateTime @default(now())

  // 关联
  document        Document @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([documentId, versionNumber])
  @@index([documentId, createdAt])
}

model DocumentResourceRef {
  id              String   @id @default(uuid())
  documentId      String
  resourceId      String

  // 引用类型
  refType         ResourceRefType

  // 使用追踪
  usedInPages     Int[]    // 在哪些页面使用了此资源
  extractionSummary String? // AI 从资源提取的关键信息摘要

  // 时间
  createdAt       DateTime @default(now())

  // 关联
  document        Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  resource        Resource @relation(fields: [resourceId], references: [id])

  @@unique([documentId, resourceId])
  @@index([documentId])
  @@index([resourceId])
}

model DocumentTemplate {
  id              String   @id @default(uuid())

  // 基础信息
  name            String   // "商业计划书模板"
  description     String?
  category        TemplateCategory

  // 模板配置
  style           String   // genspark, consulting, tech, ...
  defaultLayout   String   // cards, timeline, ...
  colorScheme     Json     // { primary, accent, background, text }

  // 结构定义
  structure       Json     // 预定义的章节结构

  // 预览
  thumbnail       String?

  // 元数据
  usageCount      Int      @default(0)
  isBuiltin       Boolean  @default(false)
  isPublic        Boolean  @default(true)

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([category])
}

enum TemplateCategory {
  BUSINESS        // 商业
  ACADEMIC        // 学术
  MARKETING       // 营销
  TECHNICAL       // 技术
  CREATIVE        // 创意
  GENERAL         // 通用
}
```

---

## 4. 前端组件设计

### 4.1 组件架构

```
frontend/components/ai-office/
├── layout/
│   └── WorkspaceLayout.tsx          # 主布局 (已有)
│
├── version/
│   ├── VersionDropdown.tsx          # [新增] Genspark 风格版本选择器
│   ├── VersionTimeline.tsx          # [新增] 版本时间线面板
│   ├── VersionCompare.tsx           # [重构] 版本对比视图
│   └── VersionThumbnail.tsx         # [新增] 版本缩略图组件
│
├── resource/
│   ├── ResourcePool.tsx             # [重构] 资源池面板
│   ├── ResourceMention.tsx          # [新增] @ 引用触发器
│   ├── ResourceSelector.tsx         # [新增] 资源选择下拉菜单
│   └── ResourcePreview.tsx          # [新增] 资源悬浮预览
│
├── editor/
│   ├── DocumentEditor.tsx           # [已有] 主编辑器
│   ├── PageEditor.tsx               # [新增] 单页编辑器 (PPT)
│   ├── AIEditPanel.tsx              # [新增] AI 编辑指令面板
│   └── ToolbarV2.tsx                # [新增] 编辑工具栏
│
├── generation/
│   ├── GenerationWizard.tsx         # [重构] 生成向导
│   ├── ProgressTimeline.tsx         # [重构] 生成进度时间线
│   ├── OutlinePreview.tsx           # [新增] 大纲预览/调整
│   └── StylePicker.tsx              # [新增] 风格/模板选择器
│
├── export/
│   ├── ExportDialog.tsx             # [新增] 导出对话框
│   ├── ExportPreview.tsx            # [新增] 导出预览
│   └── FormatSelector.tsx           # [新增] 格式选择器
│
└── preview/
    ├── SlideRenderer.tsx            # [重构] 幻灯片渲染器
    ├── SlideNavigator.tsx           # [新增] 幻灯片导航器
    └── FullscreenPreview.tsx        # [新增] 全屏预览模式
```

### 4.2 核心组件详细设计

#### 4.2.1 VersionDropdown (Genspark 风格)

```tsx
interface VersionDropdownProps {
  documentId: string;
  currentVersionId: string;
  onVersionSelect: (versionId: string) => void;
}

// 功能:
// 1. 显示当前版本名称 (如 "保存点-14")
// 2. 点击展开版本列表
// 3. 每个版本显示: 名称、时间、描述
// 4. 支持搜索/筛选版本
// 5. 快捷键: Ctrl+Z 撤销到上一版本
```

#### 4.2.2 ResourceMention (@ 引用)

```tsx
interface ResourceMentionProps {
  onSelect: (resource: Resource) => void;
  selectedResources: Resource[];
}

// 功能:
// 1. 监听输入框中的 @ 字符
// 2. 触发资源选择下拉菜单
// 3. 支持键盘导航 (上/下/回车)
// 4. 支持搜索过滤
// 5. 选中后插入资源标签
```

### 4.3 状态管理 (Zustand Store 扩展)

```typescript
// stores/aiOfficeStore.ts 扩展

// 版本管理 Store
interface VersionState {
  versions: Map<string, DocumentVersion[]>; // documentId -> versions
  isLoadingVersions: boolean;

  // Actions
  loadVersions: (documentId: string) => Promise<void>;
  createVersion: (
    documentId: string,
    trigger: VersionTrigger,
    description?: string,
  ) => Promise<string>;
  restoreVersion: (documentId: string, versionId: string) => Promise<void>;
  compareVersions: (versionId1: string, versionId2: string) => VersionDiff;
}

// 资源引用 Store
interface ResourceRefState {
  selectedResources: Resource[];
  resourceRefs: Map<string, DocumentResourceRef[]>; // documentId -> refs

  // Actions
  addResourceRef: (
    documentId: string,
    resource: Resource,
    refType: ResourceRefType,
  ) => void;
  removeResourceRef: (documentId: string, resourceId: string) => void;
  getResourceContext: (documentId: string) => ResourceContext; // 用于 AI 生成
}

// 生成配置 Store
interface GenerationConfigState {
  style: InfographicStyle;
  defaultLayout: TemplateLayout;
  aiModel: "grok" | "gpt-4" | "claude";
  pageCount: number | "auto";

  // Actions
  setStyle: (style: InfographicStyle) => void;
  setLayout: (layout: TemplateLayout) => void;
  resetToDefaults: () => void;
}
```

---

## 5. API 设计

### 5.1 后端 API 端点

```typescript
// backend/src/modules/ai-office/

// ============================================================================
// 文档 API
// ============================================================================

// POST /api/v1/ai-office/documents
// 创建新文档
interface CreateDocumentDto {
  title: string;
  type: DocumentType;
  resourceIds?: string[]; // @ 引用的资源
  prompt?: string;
  aiConfig?: AIConfig;
}

// GET /api/v1/ai-office/documents/:id
// 获取文档详情 (含最新版本)

// PATCH /api/v1/ai-office/documents/:id
// 更新文档 (触发自动版本保存)

// DELETE /api/v1/ai-office/documents/:id
// 删除文档

// ============================================================================
// 版本 API
// ============================================================================

// GET /api/v1/ai-office/documents/:id/versions
// 获取文档所有版本

// POST /api/v1/ai-office/documents/:id/versions
// 手动创建新版本
interface CreateVersionDto {
  description?: string;
}

// GET /api/v1/ai-office/documents/:id/versions/:versionId
// 获取特定版本详情

// POST /api/v1/ai-office/documents/:id/versions/:versionId/restore
// 恢复到特定版本

// GET /api/v1/ai-office/documents/:id/versions/compare
// 对比两个版本
interface CompareVersionsQuery {
  version1: string;
  version2: string;
}

// ============================================================================
// 资源引用 API
// ============================================================================

// POST /api/v1/ai-office/documents/:id/resources
// 添加资源引用
interface AddResourceRefDto {
  resourceId: string;
  refType: ResourceRefType;
}

// DELETE /api/v1/ai-office/documents/:id/resources/:resourceId
// 移除资源引用

// GET /api/v1/ai-office/documents/:id/resources
// 获取文档的所有资源引用

// ============================================================================
// 生成 API
// ============================================================================

// POST /api/v1/ai-office/generate
// 生成新文档
interface GenerateDocumentDto {
  prompt: string;
  type: DocumentType;
  resourceIds: string[];
  style?: InfographicStyle;
  layout?: TemplateLayout;
  pageCount?: number;
  aiModel?: string;
}

// POST /api/v1/ai-office/generate/outline
// 仅生成大纲 (用于预览)
interface GenerateOutlineDto {
  prompt: string;
  resourceIds: string[];
}

// POST /api/v1/ai-office/generate/page
// 重新生成单页
interface RegeneratePageDto {
  documentId: string;
  pageNumber: number;
  instruction?: string;
}

// ============================================================================
// 导出 API
// ============================================================================

// POST /api/v1/ai-office/documents/:id/export
// 导出文档
interface ExportDocumentDto {
  format: "pptx" | "docx" | "xlsx" | "pdf" | "html" | "markdown" | "png";
  options?: {
    includeNotes?: boolean;
    quality?: "low" | "medium" | "high";
    template?: string; // 导出模板
    preserveStyles?: boolean; // 保持样式
  };
}
```

### 5.2 AI Service API (FastAPI)

```python
# ai-service/routers/ai_office.py

@router.post("/api/v1/ai-office/analyze-intent")
async def analyze_intent(request: AnalyzeIntentRequest):
    """
    分析用户意图，返回推荐的文档类型、风格、页数
    """
    pass

@router.post("/api/v1/ai-office/generate-outline")
async def generate_outline(request: GenerateOutlineRequest):
    """
    根据 Prompt 和资源生成文档大纲
    """
    pass

@router.post("/api/v1/ai-office/generate-page")
async def generate_page(request: GeneratePageRequest):
    """
    生成单页内容和 Prompt
    """
    pass

@router.post("/api/v1/ai-office/describe-version")
async def describe_version(request: DescribeVersionRequest):
    """
    AI 生成版本描述
    """
    pass
```

---

## 6. 实现计划

### 6.1 阶段划分

#### Phase 1: 版本管理系统 (Week 1-2)

**目标**: 实现 Genspark 风格的版本管理 UI 和后端支持

**任务**:

1. 数据库 Schema 迁移 (DocumentVersion)
2. 后端版本 CRUD API
3. 前端 VersionDropdown 组件
4. 前端 VersionTimeline 组件
5. 版本对比功能优化
6. AI 版本描述生成

**交付物**:

- 可视化版本选择器
- 版本列表面板
- 一键恢复功能
- 版本对比视图

#### Phase 2: 资源 @ 引用系统 (Week 2-3)

**目标**: 实现资源引用和上下文构建

**任务**:

1. 数据库 Schema 迁移 (DocumentResourceRef)
2. 后端资源引用 API
3. 前端 ResourceMention 组件
4. 前端 ResourceSelector 组件
5. 资源上下文提取逻辑
6. 引用追踪展示

**交付物**:

- @ 触发资源选择
- 资源预览悬浮卡片
- 引用标签展示
- 内容-资源溯源功能

#### Phase 3: 文档生成引擎重构 (Week 3-5)

**目标**: 复用 AI Image 架构实现文档生成 Pipeline

**任务**:

1. 意图分析器开发
2. 大纲生成器开发
3. 页面 Prompt 生成器开发
4. 复用 InfographicTemplateService
5. 生成进度 UI 优化
6. 大纲预览/调整功能

**交付物**:

- 4 步生成 Pipeline
- 90 种模板 x 布局组合
- 实时生成进度展示
- 大纲预览和手动调整

#### Phase 4: 编辑与导出系统 (Week 5-6)

**目标**: 实现可编辑 PPT 和无损导出

**任务**:

1. PageEditor 组件开发
2. AI 编辑指令解析
3. PptxGenJS 导出集成
4. PDF 导出优化
5. 导出预览功能

**交付物**:

- 单页编辑模式
- AI 自然语言编辑
- PPTX 无损导出
- 多格式导出支持

### 6.2 里程碑

| 里程碑      | 日期    | 交付内容            |
| ----------- | ------- | ------------------- |
| M1          | Week 2  | 版本管理 MVP        |
| M2          | Week 3  | 资源引用 MVP        |
| M3          | Week 5  | 生成引擎重构完成    |
| M4          | Week 6  | 编辑导出系统完成    |
| **Release** | Week 6+ | AI Office v2.0 发布 |

---

## 7. 技术风险与缓解

| 风险              | 影响 | 缓解措施                              |
| ----------------- | ---- | ------------------------------------- |
| PPTX 导出格式问题 | 高   | 使用 PptxGenJS + 充分测试各布局类型   |
| 大文档性能问题    | 中   | 分页加载 + 虚拟滚动 + 懒渲染          |
| AI 生成质量不稳定 | 高   | Prompt 工程优化 + 多轮校验 + 人工介入 |
| 版本存储空间膨胀  | 中   | 增量存储 + 定期清理旧版本             |
| 资源上下文过长    | 中   | 智能摘要 + Token 限制 + 分块处理      |

---

## 8. 成功指标

### 8.1 功能指标

- [ ] 版本管理: 支持无限版本回溯，响应时间 < 500ms
- [ ] 资源引用: 支持 @ 选择 10+ 资源，上下文提取准确率 > 90%
- [ ] 文档生成: 15 页 PPT 生成时间 < 60s
- [ ] 导出: PPTX 导出格式保真度 > 95%

### 8.2 用户体验指标

- [ ] 版本切换: 1 次点击完成
- [ ] 资源引用: @ 输入到选中 < 3s
- [ ] 生成预览: 大纲生成 < 5s
- [ ] 编辑保存: 自动保存延迟 < 2s

---

## 9. 附录

### 9.1 现有代码复用清单

| 模块       | 文件                              | 复用程度 |
| ---------- | --------------------------------- | -------- |
| 模板渲染   | `infographic-template.service.ts` | 完全复用 |
| 版本管理   | `VersionHistory.tsx`              | 重构升级 |
| 幻灯片渲染 | `EnhancedSlideRenderer.tsx`       | 部分复用 |
| 状态管理   | `aiOfficeStore.ts`                | 扩展     |
| 快速生成   | `quick-generate.service.ts`       | 替换     |

### 9.2 参考资源

- [Gamma.app](https://gamma.app/ai-powerpoint)
- [PptxGenJS 文档](https://gitbrent.github.io/PptxGenJS/)
- [TipTap 编辑器](https://tiptap.dev/)
- Genspark 版本管理 UI (截图参考)

---

---

## 10. 核心设计原则检查清单

### 10.1 AI 模型配置检查

- [ ] **文本模型**: 所有文本生成调用都使用 `getDefaultTextModel()` 而非硬编码
- [ ] **图形模型**: 所有图像生成调用都使用 `getDefaultImageModel()` 而非硬编码
- [ ] **用户选择优先**: 如用户指定模型，优先使用用户选择
- [ ] **配置持久化**: 用户的模型偏好保存在 User.preferences 中

### 10.2 导出格式检查

- [ ] **PPTX**: PptxGenJS 生成，支持在 PowerPoint 中继续编辑
- [ ] **DOCX**: docx.js 生成，支持在 Word 中继续编辑
- [ ] **XLSX**: ExcelJS 生成，支持在 Excel 中继续编辑
- [ ] **PDF**: Puppeteer 截图合并，高保真输出
- [ ] **格式映射**: 每种 DocumentType 对应正确的默认导出格式

### 10.3 AI 陪伴交互检查

- [ ] **打字机效果**: 所有 AI 输出都有打字机动效
- [ ] **进度反馈**: 生成过程有实时进度和阶段提示
- [ ] **智能建议**: AI 主动提供操作建议
- [ ] **友好错误**: 错误信息人性化，提供解决方案
- [ ] **自然语言**: 支持自然语言指令编辑文档
- [ ] **流畅动效**: 所有状态切换有平滑过渡 (60fps+)

---

**文档版本历史**:
| 版本 | 日期 | 作者 | 变更说明 |
|-----|------|-----|---------|
| 1.0 | 2025-12-02 | AI Assistant | 初始版本 |
| 1.1 | 2025-12-02 | AI Assistant | 增加: AI模型动态配置、DOCX/XLSX导出、AI陪伴式交互设计 |
