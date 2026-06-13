# Genesis AI Office 系统优化方案 V2

> 基于 Banana-Slides 竞品分析和现有架构的全面优化方案
>
> 版本: 2.0 | 日期: 2024-12-19 | 状态: 设计阶段 | 作者: PM Agent

---

## 文档信息

| 项目     | 说明                                        |
| -------- | ------------------------------------------- |
| 版本     | 2.0                                         |
| 创建日期 | 2024-12-19                                  |
| 状态     | 草稿                                        |
| 优先级   | P0                                          |
| 依赖     | ai-office 现有架构, content-processing 模块 |

---

## 一、执行摘要

### 1.1 背景

Genesis AI Office 是一个智能文档生成系统,支持 PPT/Word/Excel/PDF 等多格式输出。通过对比分析 Banana-Slides 项目,我们发现当前系统存在以下核心问题:

1. **文件解析能力不足**: 无法深度解析 PDF/DOCX 中的图片、表格等结构化内容
2. **缺乏自然语言编辑**: 不支持"把第3页图表换成饼图"等口语化指令
3. **PPTX 导出样式简单**: 与预览效果差异大,缺乏高质量模板
4. **没有版本回滚机制**: 用户编辑后无法回退到之前版本

### 1.2 优化目标

| 目标维度       | 当前状态     | 目标状态                   |
| -------------- | ------------ | -------------------------- |
| 文件解析深度   | 纯文本提取   | 结构化提取(图片/表格/图表) |
| 编辑方式       | 整体重新生成 | 自然语言局部编辑           |
| PPTX 导出质量  | 基础样式     | 专业级样式,接近预览效果    |
| 版本管理       | 无           | 支持版本历史和回滚         |
| 生成时间(10页) | 2-3 分钟     | 30-60 秒                   |

### 1.3 预期收益

- **用户体验提升**: 文件上传后提取完整信息,编辑更灵活
- **生成效率提升**: 规则引擎+异步图片,速度提升 70%
- **输出质量提升**: PPTX 导出与预览一致性达 95%+
- **迭代成本降低**: 局部编辑替代整体重新生成

---

## 二、需求分析

### 2.1 核心用户场景

#### 场景1: 学术论文转演讲 PPT

**角色**: 研究生/科研人员

**当前痛点**:

- 上传 PDF 论文后,只能提取纯文本,丢失图表
- 需要手动重新绘制论文中的图表
- 想修改某一页时需要重新生成整个 PPT

**期望流程**:

```
1. 上传论文 PDF
2. 系统自动提取: 文字 + 图片 + 表格 + 图表
3. AI 基于完整内容生成 PPT
4. 用户: "把第5页的表格数据用柱状图展示"
5. 系统只更新第5页,保留其他页面不变
```

#### 场景2: 商业报告快速生成

**角色**: 产品经理/商业分析师

**当前痛点**:

- 上传 Word 报告后内容不完整
- 导出的 PPTX 样式与预览差异大
- 缺少专业商务模板

**期望流程**:

```
1. 上传 Word 商业报告
2. 选择"商务专业"模板
3. 一键生成 PPT,样式精美
4. 导出 PPTX,与预览效果一致
```

#### 场景3: 迭代式文档编辑

**角色**: 内容创作者

**当前痛点**:

- 每次修改都要重新生成
- 无法撤销之前的编辑
- 协作时版本混乱

**期望流程**:

```
1. 生成初版 PPT
2. 自然语言编辑: "第3页图片换成更现代的风格"
3. 查看版本历史,对比差异
4. 不满意? 回滚到上一版本
```

### 2.2 用户痛点汇总

| 痛点ID | 痛点描述                    | 影响程度 | 当前状态   |
| ------ | --------------------------- | -------- | ---------- |
| P-001  | PDF/Word 上传后图表丢失     | 高       | 只提取文本 |
| P-002  | 修改单页需重新生成全部      | 高       | 不支持     |
| P-003  | PPTX 导出样式与预览差异大   | 中       | 基础样式   |
| P-004  | 无法回滚到之前版本          | 中       | 不支持     |
| P-005  | 缺少行业/场景专业模板       | 中       | 5个通用    |
| P-006  | 生成时间过长(大文档超3分钟) | 低       | 串行处理   |

### 2.3 竞品能力对比

| 能力维度      | Banana-Slides | Gamma.app | 当前 AI Office | 目标状态 |
| ------------- | ------------- | --------- | -------------- | -------- |
| 深度文件解析  | MinerU        | 基础      | pdfjs-dist     | MinerU   |
| 图片提取      | 完整          | 部分      | 不支持         | 完整     |
| 表格提取      | 完整          | 部分      | 不支持         | 完整     |
| 自然语言编辑  | 完整          | 完整      | 不支持         | 完整     |
| 版本管理      | PageVersion   | 基础      | 不支持         | 完整     |
| 图片全页渲染  | 完整          | 完整      | 不支持         | 可选     |
| 专业模板      | 丰富          | 丰富      | 5个基础        | 扩展     |
| PPTX 导出质量 | 图片组装      | 高质量    | 基础           | 高质量   |

---

## 三、功能规划

### 3.1 功能优先级矩阵

```
            高价值
              |
  P0-立即做   |   P1-计划做
  ─────────────┼─────────────
  - 深度文件解析|   - 专业模板系统
  - 自然语言编辑|   - 版本差异对比
  - PPTX导出增强|   - 协作编辑支持
              |
低成本 ────────┼──────── 高成本
              |
  P2-有空做   |   P3-暂不做
  ─────────────┼─────────────
  - 图片全页渲染|   - 实时协作
  - 模板市场    |   - AI视频生成
              |
            低价值
```

### 3.2 功能清单

#### P0 - 必须实现 (Sprint 1-2)

| 功能ID | 功能名称            | 描述                                      | 预估工时 |
| ------ | ------------------- | ----------------------------------------- | -------- |
| F-001  | MinerU 深度文件解析 | 集成 MinerU 服务,支持 PDF/DOCX 结构化解析 | 5d       |
| F-002  | 自然语言局部编辑    | 支持口语化指令编辑单页/元素               | 5d       |
| F-003  | PPTX 导出质量增强   | 提升导出样式与预览一致性                  | 3d       |
| F-004  | 版本管理基础        | 支持版本历史查看和回滚                    | 3d       |

#### P1 - 应该实现 (Sprint 3-4)

| 功能ID | 功能名称     | 描述                         | 预估工时 |
| ------ | ------------ | ---------------------------- | -------- |
| F-005  | 专业模板系统 | 扩展 10+ 行业/场景专业模板   | 4d       |
| F-006  | 版本差异对比 | 可视化对比两个版本的差异     | 2d       |
| F-007  | 图表智能转换 | 支持"换成饼图"等图表类型转换 | 3d       |
| F-008  | 批量操作     | 批量应用样式/主题到多页      | 2d       |

#### P2 - 可以实现 (后续迭代)

| 功能ID | 功能名称     | 描述                          | 预估工时 |
| ------ | ------------ | ----------------------------- | -------- |
| F-009  | 图片全页渲染 | 将幻灯片渲染为图片再组装 PPTX | 5d       |
| F-010  | 模板市场     | 用户可分享/下载模板           | 5d       |
| F-011  | 智能配色方案 | AI 推荐配色,一键应用          | 2d       |

---

## 四、详细 PRD

### 4.1 F-001: MinerU 深度文件解析

#### 4.1.1 概述

**目标**: 集成 MinerU 文件解析服务,实现 PDF/DOCX 的深度结构化解析,完整提取文字、图片、表格和图表。

**非目标**: 本期不实现自建解析引擎,直接集成 MinerU 服务。

#### 4.1.2 用户故事

| ID     | 角色       | 故事                                                             | 优先级 |
| ------ | ---------- | ---------------------------------------------------------------- | ------ |
| US-001 | 研究人员   | 作为研究人员,我希望上传论文PDF后能保留图表,以便生成完整的演讲PPT | P0     |
| US-002 | 商务人员   | 作为商务人员,我希望上传Word报告后表格数据能被正确识别            | P0     |
| US-003 | 内容创作者 | 作为内容创作者,我希望上传的图片能直接用于PPT,无需重新上传        | P1     |

#### 4.1.3 功能需求

**F-001-1: MinerU 服务集成**

描述: 部署 MinerU 服务并创建 API 集成层

前置条件:

- MinerU 服务已部署 (Docker 或本地)
- API 端点可访问

主流程:

1. 用户上传文件 (PDF/DOCX)
2. 系统检测文件类型
3. 对于 PDF/DOCX,调用 MinerU API
4. MinerU 返回解析结果 (JSON 结构)
5. 系统将结果转换为内部格式
6. 存储提取的图片到 OSS/本地存储
7. 返回结构化内容给上层服务

异常流程:

- MinerU 服务不可用: 降级到 pdfjs-dist 基础解析
- 文件过大: 分片处理或拒绝并提示
- 解析超时: 异步处理,通知用户稍后查看

数据结构:

```typescript
interface MinerUParseResult {
  metadata: {
    title?: string;
    author?: string;
    pageCount: number;
    createdAt?: string;
  };
  pages: Array<{
    pageNumber: number;
    text: string;
    elements: Array<{
      type: "paragraph" | "heading" | "table" | "image" | "chart";
      content: string | TableData | ImageData | ChartData;
      bbox: { x: number; y: number; width: number; height: number };
      confidence: number;
    }>;
  }>;
  images: Array<{
    id: string;
    pageNumber: number;
    url: string; // 提取后存储的URL
    originalSize: { width: number; height: number };
    caption?: string;
  }>;
  tables: Array<{
    id: string;
    pageNumber: number;
    headers: string[];
    rows: string[][];
    markdown: string;
  }>;
}
```

验收标准:

- [ ] PDF 文件解析成功率 > 95%
- [ ] 图片提取完整,无丢失
- [ ] 表格结构正确识别
- [ ] 解析时间 < 30秒 (20页以内)

**F-001-2: 图片提取与存储**

描述: 从解析结果中提取图片并存储

主流程:

1. 从 MinerU 结果中提取图片 base64
2. 生成唯一文件名
3. 上传到 OSS/本地存储
4. 返回可访问的 URL
5. 更新解析结果中的图片引用

验收标准:

- [ ] 支持 PNG/JPG/SVG 格式
- [ ] 图片质量无损
- [ ] URL 可在 PPT 中直接引用

**F-001-3: 表格智能识别**

描述: 识别表格并转换为结构化数据

输出格式:

```typescript
interface TableData {
  headers: string[];
  rows: string[][];
  markdown: string; // 用于AI理解
  chartRecommendation?: "bar" | "line" | "pie" | "none"; // 推荐的可视化类型
}
```

验收标准:

- [ ] 表格识别准确率 > 90%
- [ ] 支持合并单元格
- [ ] 支持嵌套表格

#### 4.1.4 技术方案

**架构设计**:

```
┌─────────────────────────────────────────────────────────────┐
│                      ContentExtractorService                │
│                      (现有,需增强)                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  extractFromFile(buffer, mimeType, filename)                │
│       │                                                     │
│       ▼                                                     │
│  ┌─────────────────┐    ┌─────────────────┐                │
│  │ 简单文件类型    │    │ 复杂文件类型    │                │
│  │ (TXT/MD/JSON)   │    │ (PDF/DOCX)      │                │
│  └────────┬────────┘    └────────┬────────┘                │
│           │                      │                          │
│           ▼                      ▼                          │
│  ┌─────────────────┐    ┌─────────────────┐                │
│  │ 直接读取        │    │ MinerUService   │ ◄── 新增      │
│  └─────────────────┘    └────────┬────────┘                │
│                                  │                          │
│                                  ▼                          │
│                         ┌─────────────────┐                │
│                         │ MinerU API      │                │
│                         │ (Docker服务)    │                │
│                         └────────┬────────┘                │
│                                  │                          │
│                                  ▼                          │
│                         ┌─────────────────┐                │
│                         │ 结果处理        │                │
│                         │ - 图片提取存储  │                │
│                         │ - 表格结构化    │                │
│                         │ - 内容组装      │                │
│                         └─────────────────┘                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**新增服务**: `MinerUService`

```typescript
// backend/src/common/content-processing/mineru.service.ts

@Injectable()
export class MinerUService {
  private readonly apiEndpoint: string;

  constructor(private configService: ConfigService) {
    this.apiEndpoint = configService.get(
      "MINERU_API_ENDPOINT",
      "http://localhost:8000",
    );
  }

  async parseDocument(
    buffer: Buffer,
    filename: string,
  ): Promise<MinerUParseResult> {
    // 1. 调用MinerU API
    // 2. 处理返回结果
    // 3. 提取并存储图片
    // 4. 返回结构化结果
  }

  async extractImages(parseResult: any): Promise<ExtractedImage[]> {
    // 从解析结果提取图片并存储
  }

  async parseTables(parseResult: any): Promise<ParsedTable[]> {
    // 结构化表格数据
  }
}
```

**配置项**:

```env
MINERU_API_ENDPOINT=http://localhost:8000
MINERU_TIMEOUT=60000
MINERU_MAX_FILE_SIZE=50MB
```

#### 4.1.5 任务拆解

| ID    | 任务                         | 类型 | 预估 | 依赖        |
| ----- | ---------------------------- | ---- | ---- | ----------- |
| T-001 | 部署 MinerU Docker 服务      | 运维 | 0.5d | -           |
| T-002 | 创建 MinerUService 基础框架  | 后端 | 0.5d | T-001       |
| T-003 | 实现 PDF 解析 API 集成       | 后端 | 1d   | T-002       |
| T-004 | 实现 DOCX 解析 API 集成      | 后端 | 1d   | T-002       |
| T-005 | 实现图片提取与 OSS 存储      | 后端 | 1d   | T-003       |
| T-006 | 实现表格结构化处理           | 后端 | 0.5d | T-003       |
| T-007 | 更新 ContentExtractorService | 后端 | 0.5d | T-003,T-004 |

---

### 4.2 F-002: 自然语言局部编辑

#### 4.2.1 概述

**目标**: 支持用户通过自然语言指令编辑 PPT 的单个页面或元素,无需重新生成整个文档。

**非目标**: 本期不支持跨页面的复杂编辑(如"交换第2页和第5页")。

#### 4.2.2 用户故事

| ID     | 角色 | 故事                                                      | 优先级 |
| ------ | ---- | --------------------------------------------------------- | ------ |
| US-004 | 用户 | 作为用户,我希望说"把第3页的标题改成xxx",系统只更新第3页   | P0     |
| US-005 | 用户 | 作为用户,我希望说"第5页图表换成饼图",系统智能转换图表类型 | P0     |
| US-006 | 用户 | 作为用户,我希望说"删除第2页",系统删除该页并重新编号       | P1     |
| US-007 | 用户 | 作为用户,我希望说"把整个PPT的配色换成蓝色系",批量更新样式 | P1     |

#### 4.2.3 功能需求

**F-002-1: 编辑意图解析**

描述: 解析用户的自然语言指令,识别编辑意图

意图类型:

```typescript
type EditIntent =
  | { type: "update_title"; slideIndex: number; newTitle: string }
  | {
      type: "update_content";
      slideIndex: number;
      contentChanges: ContentChange[];
    }
  | { type: "replace_image"; slideIndex: number; newImagePrompt: string }
  | { type: "replace_chart"; slideIndex: number; newChartType: ChartType }
  | { type: "delete_slide"; slideIndex: number }
  | { type: "add_slide"; afterIndex: number; content: SlideContent }
  | { type: "batch_style"; styleChanges: StyleChange }
  | { type: "regenerate_slide"; slideIndex: number; additionalPrompt: string };
```

解析示例:

```
输入: "把第3页的标题改成'市场分析结论'"
输出: { type: 'update_title', slideIndex: 2, newTitle: '市场分析结论' }

输入: "第5页的柱状图换成饼图"
输出: { type: 'replace_chart', slideIndex: 4, newChartType: 'pie' }

输入: "删除最后一页"
输出: { type: 'delete_slide', slideIndex: -1 }  // -1表示最后一页

输入: "整体配色换成深蓝色"
输出: { type: 'batch_style', styleChanges: { primaryColor: '#1e3a5f' } }
```

验收标准:

- [ ] 支持中英文指令
- [ ] 页码识别准确 (第X页、最后一页、第一页等)
- [ ] 意图分类准确率 > 95%

**F-002-2: 局部更新引擎**

描述: 根据解析出的意图,只更新受影响的页面

主流程:

1. 接收编辑意图
2. 获取当前文档状态
3. 定位目标页面/元素
4. 执行局部更新
5. 重新渲染受影响页面
6. 保存新版本

保留逻辑:

- 未修改的页面保持原样(包括已生成的图片)
- 只重新生成被修改页面的内容/图片
- 版本管理记录本次变更

验收标准:

- [ ] 局部更新时间 < 10秒
- [ ] 其他页面完全不变
- [ ] 版本历史正确记录

**F-002-3: 上下文感知**

描述: 编辑时理解文档上下文,保持一致性

实现要点:

- 修改标题时,自动调整相关内容
- 修改主题时,影响所有页面
- 删除页面时,调整引用关系

#### 4.2.4 技术方案

**架构设计**:

```
┌─────────────────────────────────────────────────────────────┐
│                    NaturalEditService (新增)                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐                                       │
│  │ parseEditIntent │ ◄── 用户自然语言输入                  │
│  │ (AI驱动)        │                                       │
│  └────────┬────────┘                                       │
│           │                                                 │
│           ▼                                                 │
│  ┌─────────────────┐                                       │
│  │ EditIntent      │                                       │
│  │ 结构化意图      │                                       │
│  └────────┬────────┘                                       │
│           │                                                 │
│           ▼                                                 │
│  ┌─────────────────────────────────────────────┐           │
│  │              EditExecutor                    │           │
│  ├──────────────┬──────────────┬───────────────┤           │
│  │ TitleEditor  │ ChartEditor  │ ImageEditor   │           │
│  │ ContentEditor│ StyleEditor  │ SlideManager  │           │
│  └──────────────┴──────────────┴───────────────┘           │
│           │                                                 │
│           ▼                                                 │
│  ┌─────────────────┐                                       │
│  │ VersionManager  │ ◄── 保存变更历史                      │
│  └─────────────────┘                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**意图解析 Prompt**:

```typescript
const EDIT_INTENT_PROMPT = `You are a presentation editing assistant. Parse user's natural language edit instruction into structured intent.

Current document context:
- Total slides: {totalSlides}
- Current slide titles: {slideTitles}

User instruction: "{userInput}"

Output JSON format:
{
  "type": "update_title|update_content|replace_image|replace_chart|delete_slide|add_slide|batch_style|regenerate_slide",
  "slideIndex": number (0-based, -1 for last slide),
  "parameters": { ... specific to type }
}

Examples:
- "把第3页标题改成xxx" -> {"type":"update_title","slideIndex":2,"parameters":{"newTitle":"xxx"}}
- "第5页柱状图换成饼图" -> {"type":"replace_chart","slideIndex":4,"parameters":{"newChartType":"pie"}}
- "删除最后一页" -> {"type":"delete_slide","slideIndex":-1}
`;
```

#### 4.2.5 任务拆解

| ID    | 任务                         | 类型 | 预估 | 依赖  |
| ----- | ---------------------------- | ---- | ---- | ----- |
| T-008 | 创建 NaturalEditService 框架 | 后端 | 0.5d | -     |
| T-009 | 实现意图解析器 (AI驱动)      | 后端 | 1d   | T-008 |
| T-010 | 实现 TitleEditor             | 后端 | 0.5d | T-008 |
| T-011 | 实现 ContentEditor           | 后端 | 0.5d | T-008 |
| T-012 | 实现 ChartEditor             | 后端 | 1d   | T-008 |
| T-013 | 实现 ImageEditor             | 后端 | 0.5d | T-008 |
| T-014 | 实现 SlideManager (增删页)   | 后端 | 0.5d | T-008 |
| T-015 | 集成版本管理                 | 后端 | 0.5d | T-008 |

---

### 4.3 F-003: PPTX 导出质量增强

#### 4.3.1 概述

**目标**: 提升 PPTX 导出质量,使导出文件的视觉效果与预览一致。

**非目标**: 本期不实现图片全页渲染方案(计划在 P2 实现)。

#### 4.3.2 当前问题分析

基于 `document-export.service.ts` 分析:

1. **样式单一**: 硬编码字体 "Microsoft YaHei",颜色 "1E3A5F"
2. **布局简单**: 只有标题+列表,不支持复杂布局
3. **图表支持有限**: 虽有 addChartToSlide,但数据结构不完整
4. **背景单调**: 固定白色背景,不支持渐变/图片
5. **缺少图片**: 不导出 AI 生成的图片

#### 4.3.3 功能需求

**F-003-1: 主题系统映射**

描述: 将 HTML 预览的主题样式映射到 PPTX

映射关系:

```typescript
interface ThemeToPPTXMapping {
  colors: {
    primary: string; // -> slide background accent
    secondary: string; // -> text color
    accent: string; // -> highlight color
    background: string; // -> slide background
  };
  fonts: {
    heading: string; // -> title font
    body: string; // -> body font
  };
  // pptxgenjs 配置
  pptxConfig: {
    masterSlide: MasterSlideConfig;
    titleLayout: LayoutConfig;
    contentLayout: LayoutConfig;
  };
}
```

验收标准:

- [ ] 5种主题正确映射
- [ ] 颜色一致性 > 95%

**F-003-2: 复杂布局支持**

描述: 支持预览中的所有布局类型导出

布局类型:

- title_center: 居中大标题
- text_image_left/right: 图文左右分栏
- two_columns: 双栏
- statistics_cards: 数据卡片
- timeline_horizontal: 时间线
- quote_highlight: 引用高亮

验收标准:

- [ ] 所有 20 种布局类型正确导出
- [ ] 布局比例与预览一致

**F-003-3: 图片导出**

描述: 将 AI 生成的图片正确嵌入 PPTX

实现:

1. 从 slide.images 获取图片 URL
2. 下载图片为 Buffer
3. 使用 pptxgenjs 的 addImage 嵌入

验收标准:

- [ ] 背景图片正确显示
- [ ] 内容图片位置正确
- [ ] 图片质量无损

**F-003-4: 图表完整导出**

描述: 正确导出图表数据和样式

支持类型:

- bar: 柱状图
- line: 折线图
- pie: 饼图
- doughnut: 环形图
- area: 面积图

验收标准:

- [ ] 图表数据正确
- [ ] 图表颜色与主题一致
- [ ] 图例位置正确

#### 4.3.4 技术方案

**增强 exportToPPTX 方法**:

```typescript
private async exportToPPTX(config: ExportConfig): Promise<ExportResult> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();

  // 1. 应用主题配置
  const theme = this.getThemeConfig(config.templateId);
  this.applyMasterSlide(pptx, theme);

  // 2. 解析完整的幻灯片数据(不仅仅是Markdown)
  const slides = this.parseSlideData(config.content);

  for (const slideData of slides) {
    const slide = pptx.addSlide();

    // 3. 应用背景(支持渐变/图片)
    await this.applyBackground(slide, slideData, theme);

    // 4. 根据布局类型渲染
    await this.renderByLayout(slide, slideData, theme);

    // 5. 添加图片
    await this.addImages(slide, slideData.images);

    // 6. 添加图表
    if (slideData.chartData) {
      await this.addChartWithTheme(slide, slideData.chartData, theme);
    }
  }

  return await this.generateBuffer(pptx, config.title);
}
```

#### 4.3.5 任务拆解

| ID    | 任务                  | 类型 | 预估 | 依赖  |
| ----- | --------------------- | ---- | ---- | ----- |
| T-016 | 创建主题配置映射表    | 后端 | 0.5d | -     |
| T-017 | 实现 applyMasterSlide | 后端 | 0.5d | T-016 |
| T-018 | 实现复杂布局渲染器    | 后端 | 1d   | T-016 |
| T-019 | 实现图片下载与嵌入    | 后端 | 0.5d | -     |
| T-020 | 实现图表主题化导出    | 后端 | 0.5d | T-016 |

---

### 4.4 F-004: 版本管理基础

#### 4.4.1 概述

**目标**: 实现文档版本历史管理,支持版本查看和回滚。

**参考**: Banana-Slides 的 PageImageVersion 模型。

#### 4.4.2 功能需求

**F-004-1: 版本自动保存**

描述: 在关键节点自动创建版本快照

触发时机:

- AI 生成完成后
- 用户编辑保存后
- 导出操作前

版本数据:

```typescript
interface DocumentVersion {
  id: string;
  documentId: string;
  versionNumber: number;
  type: "auto" | "manual" | "ai_generation";
  trigger: string; // 'initial', 'edit_title', 'regenerate_slide', etc.
  slides: GeneratedSlide[]; // 完整快照
  metadata: {
    slideCount: number;
    wordCount: number;
    createdAt: string;
  };
  description?: string;
}
```

验收标准:

- [ ] 生成后自动创建版本
- [ ] 编辑后自动创建版本
- [ ] 版本号递增

**F-004-2: 版本历史查看**

描述: 用户可以查看文档的版本历史列表

UI 展示:

- 版本列表(时间线形式)
- 每个版本显示: 版本号、时间、类型、描述
- 可预览历史版本

验收标准:

- [ ] 版本列表按时间倒序
- [ ] 可预览任意历史版本
- [ ] 显示版本类型图标

**F-004-3: 版本回滚**

描述: 用户可以将文档回滚到任意历史版本

主流程:

1. 用户选择目标版本
2. 确认回滚操作
3. 系统创建当前状态的备份版本
4. 恢复目标版本的内容
5. 重新渲染所有页面

验收标准:

- [ ] 回滚后内容完全恢复
- [ ] 回滚前自动保存当前版本
- [ ] 可以"取消回滚"(再次回滚到之前版本)

#### 4.4.3 技术方案

**数据库 Schema 更新**:

```prisma
model OfficeDocumentVersion {
  id              String   @id @default(cuid())
  documentId      String
  versionNumber   Int
  type            String   // auto | manual | ai_generation
  trigger         String
  description     String?

  // 版本数据
  contentSnapshot Json     // 完整幻灯片数据

  // 元数据
  slideCount      Int
  wordCount       Int
  createdAt       DateTime @default(now())

  document        OfficeDocument @relation(fields: [documentId], references: [id])

  @@unique([documentId, versionNumber])
  @@index([documentId])
}
```

**版本服务**:

```typescript
@Injectable()
export class VersionService {
  async createVersion(
    documentId: string,
    type: "auto" | "manual" | "ai_generation",
    trigger: string,
    description?: string,
  ): Promise<DocumentVersion>;

  async getVersionHistory(documentId: string): Promise<DocumentVersion[]>;

  async getVersion(
    documentId: string,
    versionNumber: number,
  ): Promise<DocumentVersion>;

  async rollbackToVersion(
    documentId: string,
    targetVersion: number,
  ): Promise<void>;
}
```

#### 4.4.4 任务拆解

| ID    | 任务                          | 类型 | 预估 | 依赖  |
| ----- | ----------------------------- | ---- | ---- | ----- |
| T-021 | 更新 Prisma Schema            | 后端 | 0.5d | -     |
| T-022 | 创建 VersionService           | 后端 | 1d   | T-021 |
| T-023 | 集成到 PPTOrchestratorService | 后端 | 0.5d | T-022 |
| T-024 | 创建版本历史 API              | 后端 | 0.5d | T-022 |
| T-025 | 创建版本历史 UI 组件          | 前端 | 1d   | T-024 |

---

## 五、任务拆解汇总

### 5.1 Sprint 1: 核心能力 (2周)

| ID    | 任务                         | 类型 | 预估 | 优先级 | 依赖  |
| ----- | ---------------------------- | ---- | ---- | ------ | ----- |
| T-001 | 部署 MinerU Docker 服务      | 运维 | 0.5d | P0     | -     |
| T-002 | 创建 MinerUService 基础框架  | 后端 | 0.5d | P0     | T-001 |
| T-003 | 实现 PDF 解析 API 集成       | 后端 | 1d   | P0     | T-002 |
| T-004 | 实现 DOCX 解析 API 集成      | 后端 | 1d   | P0     | T-002 |
| T-005 | 实现图片提取与 OSS 存储      | 后端 | 1d   | P0     | T-003 |
| T-006 | 实现表格结构化处理           | 后端 | 0.5d | P0     | T-003 |
| T-007 | 更新 ContentExtractorService | 后端 | 0.5d | P0     | T-003 |
| T-008 | 创建 NaturalEditService 框架 | 后端 | 0.5d | P0     | -     |
| T-009 | 实现意图解析器               | 后端 | 1d   | P0     | T-008 |
| T-010 | 实现 TitleEditor             | 后端 | 0.5d | P0     | T-008 |

**Sprint 1 工时**: 7.5d (约 2 周)

### 5.2 Sprint 2: 编辑与导出 (2周)

| ID    | 任务                  | 类型 | 预估 | 优先级 | 依赖  |
| ----- | --------------------- | ---- | ---- | ------ | ----- |
| T-011 | 实现 ContentEditor    | 后端 | 0.5d | P0     | T-008 |
| T-012 | 实现 ChartEditor      | 后端 | 1d   | P0     | T-008 |
| T-013 | 实现 ImageEditor      | 后端 | 0.5d | P0     | T-008 |
| T-014 | 实现 SlideManager     | 后端 | 0.5d | P0     | T-008 |
| T-015 | 集成版本管理          | 后端 | 0.5d | P0     | T-008 |
| T-016 | 创建主题配置映射表    | 后端 | 0.5d | P0     | -     |
| T-017 | 实现 applyMasterSlide | 后端 | 0.5d | P0     | T-016 |
| T-018 | 实现复杂布局渲染器    | 后端 | 1d   | P0     | T-016 |
| T-019 | 实现图片下载与嵌入    | 后端 | 0.5d | P0     | -     |
| T-020 | 实现图表主题化导出    | 后端 | 0.5d | P0     | T-016 |

**Sprint 2 工时**: 6d (约 1.5 周)

### 5.3 Sprint 3: 版本管理与测试 (1周)

| ID    | 任务                          | 类型 | 预估 | 优先级 | 依赖  |
| ----- | ----------------------------- | ---- | ---- | ------ | ----- |
| T-021 | 更新 Prisma Schema            | 后端 | 0.5d | P0     | -     |
| T-022 | 创建 VersionService           | 后端 | 1d   | P0     | T-021 |
| T-023 | 集成到 PPTOrchestratorService | 后端 | 0.5d | P0     | T-022 |
| T-024 | 创建版本历史 API              | 后端 | 0.5d | P0     | T-022 |
| T-025 | 创建版本历史 UI 组件          | 前端 | 1d   | P0     | T-024 |
| T-026 | 集成测试                      | 测试 | 1d   | P0     | All   |
| T-027 | 文档更新                      | 文档 | 0.5d | P1     | All   |

**Sprint 3 工时**: 5d (约 1 周)

---

## 六、里程碑规划

### 6.1 里程碑概览

```
Week 1-2: Sprint 1 - 核心能力建设
├── M1.1: MinerU 服务部署完成
├── M1.2: PDF/DOCX 深度解析上线
└── M1.3: 自然语言编辑框架就绪

Week 3-4: Sprint 2 - 编辑与导出增强
├── M2.1: 完整编辑器实现
├── M2.2: PPTX 导出质量达标
└── M2.3: 前后端联调完成

Week 5: Sprint 3 - 版本管理与收尾
├── M3.1: 版本管理功能上线
├── M3.2: 集成测试通过
└── M3.3: 正式发布
```

### 6.2 详细里程碑

| 里程碑 | 日期       | 内容                  | 验收标准                  |
| ------ | ---------- | --------------------- | ------------------------- |
| M1.1   | Week 1 End | MinerU 服务部署完成   | PDF 解析 API 可调用       |
| M1.2   | Week 2 Mid | PDF/DOCX 深度解析上线 | 图片/表格提取成功率 > 90% |
| M1.3   | Week 2 End | 自然语言编辑框架就绪  | 意图解析准确率 > 90%      |
| M2.1   | Week 3 Mid | 完整编辑器实现        | 支持 6 种编辑意图         |
| M2.2   | Week 3 End | PPTX 导出质量达标     | 与预览一致性 > 90%        |
| M2.3   | Week 4 End | 前后端联调完成        | E2E 测试通过              |
| M3.1   | Week 5 Mid | 版本管理功能上线      | 可创建/查看/回滚版本      |
| M3.2   | Week 5 End | 集成测试通过          | 所有 P0 功能测试通过      |
| M3.3   | Week 5 End | 正式发布              | 生产环境部署成功          |

---

## 七、风险与依赖

### 7.1 风险识别

| 风险ID | 风险描述                  | 概率 | 影响 | 缓解措施                  |
| ------ | ------------------------- | ---- | ---- | ------------------------- |
| R-001  | MinerU 服务部署困难       | 中   | 高   | 提前测试,准备降级方案     |
| R-002  | 意图解析准确率不足        | 中   | 中   | 增加训练数据,人工干预兜底 |
| R-003  | PPTX 导出复杂布局渲染困难 | 高   | 中   | 分阶段实现,优先核心布局   |
| R-004  | 版本数据占用存储过大      | 低   | 低   | 实现差分存储(Phase 2)     |

### 7.2 依赖项

| 依赖ID | 依赖描述               | 状态   | 负责人   | 预计完成    |
| ------ | ---------------------- | ------ | -------- | ----------- |
| D-001  | MinerU Docker 镜像     | 待确认 | 运维团队 | Sprint 1 前 |
| D-002  | OSS 存储配置           | 已有   | -        | -           |
| D-003  | pptxgenjs 升级到最新版 | 待执行 | 后端团队 | Sprint 2 前 |

---

## 八、成功指标

### 8.1 功能指标

| 指标            | 目标值 | 测量方式     |
| --------------- | ------ | ------------ |
| PDF 解析成功率  | > 95%  | 自动化测试   |
| 图片提取完整率  | > 90%  | 人工抽检     |
| 意图解析准确率  | > 95%  | 测试集评估   |
| PPTX 导出一致性 | > 90%  | 视觉对比评分 |
| 版本回滚成功率  | 100%   | 自动化测试   |

### 8.2 性能指标

| 指标                | 目标值 | 测量方式 |
| ------------------- | ------ | -------- |
| PDF 解析时间(20页)  | < 30s  | 性能测试 |
| 局部编辑响应时间    | < 10s  | 性能测试 |
| PPTX 导出时间(10页) | < 15s  | 性能测试 |
| 版本创建时间        | < 2s   | 性能测试 |

### 8.3 用户体验指标

| 指标                 | 目标值  | 测量方式 |
| -------------------- | ------- | -------- |
| 文件上传后信息完整度 | > 85%   | 用户反馈 |
| 编辑满意度           | > 4.0/5 | 用户调研 |
| 导出满意度           | > 4.0/5 | 用户调研 |

---

## 九、附录

### A. 相关文档

- [现有 AI Office 架构](../features/ai-agents/ai-modules-integration-guide.md)
- [AI Office PRD v2.0](./ai-office-prd.md)
- [AI Office 5.0 重新设计方案](./ai-office-redesign.md)
- [Banana-Slides 项目分析](https://github.com/banana-slides)

### B. 术语表

| 术语         | 说明                                  |
| ------------ | ------------------------------------- |
| MinerU       | 开源文档解析库,支持深度结构化提取     |
| pptxgenjs    | JavaScript PPTX 生成库                |
| 自然语言编辑 | 通过口语化指令进行文档编辑            |
| 局部更新     | 只更新受影响的页面,不重新生成整个文档 |
| 版本快照     | 文档某一时刻的完整状态副本            |

### C. 变更记录

| 版本 | 日期       | 变更内容                  | 作者     |
| ---- | ---------- | ------------------------- | -------- |
| 1.0  | 2024-12-19 | 初始版本,包含 P0 功能 PRD | PM Agent |

---

**文档结束**
