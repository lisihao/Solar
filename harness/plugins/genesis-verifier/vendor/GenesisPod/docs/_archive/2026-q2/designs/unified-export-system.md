# 统一导出与模板系统架构设计

## 1. 概述

### 1.1 背景

GenesisPod 当前存在多个独立的导出实现：

- AI Office: `export.service.ts` (763行)
- AI Agents: `export-pdf.tool.ts`, `export-docx.tool.ts` 等
- Content Reports: `reports.service.ts` 中的导出逻辑
- AI Image: `export.service.ts`
- 前端: `document-export.service.ts` (978行)

这导致：

- 代码重复，维护成本高
- API 不一致，用户体验差
- 模板分散，无法复用
- 缺少统一的队列和错误处理

### 1.2 目标

1. **统一导出入口**: 所有模块通过统一 API 导出
2. **模板中心化**: 所有模板存储在数据库，可复用
3. **格式全覆盖**: PDF, DOCX, PPTX, XLSX, Markdown, HTML
4. **可扩展架构**: 易于添加新格式和模板

## 2. 系统架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                           客户端层                                   │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                     useExport() Hook                          │  │
│  │  - exportDocument(source, format, options)                    │  │
│  │  - getTemplates(category)                                     │  │
│  │  - previewExport(source, template)                            │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           API 层                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  ExportController                                              │  │
│  │  POST /api/export              - 创建导出任务                  │  │
│  │  GET  /api/export/:jobId       - 查询任务状态                  │  │
│  │  GET  /api/export/:jobId/download - 下载导出文件              │  │
│  │                                                                │  │
│  │  TemplateController                                            │  │
│  │  GET    /api/templates         - 获取模板列表                  │  │
│  │  GET    /api/templates/:id     - 获取模板详情                  │  │
│  │  POST   /api/templates         - 创建自定义模板                │  │
│  │  PUT    /api/templates/:id     - 更新模板                      │  │
│  │  DELETE /api/templates/:id     - 删除模板                      │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          服务层                                      │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │                  ExportOrchestratorService                   │    │
│  │  - 接收导出请求                                               │    │
│  │  - 创建导出任务 (ExportJob)                                   │    │
│  │  - 调度到队列                                                 │    │
│  │  - 监控任务状态                                               │    │
│  └────────────────────────────────────────────────────────────┘    │
│                                    │                                 │
│                                    ▼                                 │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │                  ContentTransformerService                   │    │
│  │  - 从各种来源提取内容                                         │    │
│  │  - 转换为统一的 UnifiedContent 格式                           │    │
│  │  - Markdown 解析和规范化                                      │    │
│  └────────────────────────────────────────────────────────────┘    │
│                                    │                                 │
│                                    ▼                                 │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │                  TemplateManagerService                      │    │
│  │  - 加载模板配置                                               │    │
│  │  - 应用主题和布局                                             │    │
│  │  - 模板版本管理                                               │    │
│  └────────────────────────────────────────────────────────────┘    │
│                                    │                                 │
│                                    ▼                                 │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │                     渲染器层 (Renderers)                      │    │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌───────┐ │    │
│  │  │  PDF    │ │  DOCX   │ │  PPTX   │ │  XLSX   │ │MD/HTML│ │    │
│  │  │Renderer │ │Renderer │ │Renderer │ │Renderer │ │Renderer│ │    │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └───────┘ │    │
│  └────────────────────────────────────────────────────────────┘    │
│                                    │                                 │
│                                    ▼                                 │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │                     存储层 (Storage)                         │    │
│  │  - 导出文件临时存储                                           │    │
│  │  - 自动清理过期文件                                           │    │
│  └────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

## 3. 数据模型

### 3.1 导出任务 (ExportJob)

```prisma
model ExportJob {
  id          String      @id @default(cuid())

  // 来源信息
  sourceType  ExportSourceType   // DOCUMENT | RESEARCH | REPORT | RAW
  sourceId    String?            // 来源ID (如果有)
  sourceData  Json?              // 原始内容 (如果是RAW类型)

  // 导出配置
  format      ExportFormat       // PDF | DOCX | PPTX | XLSX | MARKDOWN | HTML
  templateId  String?
  options     Json               // 导出选项

  // 状态
  status      ExportJobStatus    // QUEUED | PROCESSING | COMPLETED | FAILED
  progress    Int        @default(0)  // 0-100
  error       String?

  // 结果
  fileName    String?
  fileSize    Int?
  filePath    String?            // 内部存储路径
  downloadUrl String?            // 临时下载URL
  expiresAt   DateTime?          // URL过期时间

  // 元数据
  userId      String
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
  completedAt DateTime?

  // 关联
  user        User       @relation(fields: [userId], references: [id])
  template    ExportTemplate? @relation(fields: [templateId], references: [id])

  @@index([userId, status])
  @@index([status, createdAt])
}

enum ExportSourceType {
  DOCUMENT    // AI Office 文档
  RESEARCH    // Deep Research 会话
  REPORT      // Content Report
  RAW         // 原始内容 (Markdown/JSON)
}

enum ExportFormat {
  PDF
  DOCX
  PPTX
  XLSX
  MARKDOWN
  HTML
}

enum ExportJobStatus {
  QUEUED
  PROCESSING
  COMPLETED
  FAILED
}
```

### 3.2 导出模板 (ExportTemplate)

```prisma
model ExportTemplate {
  id          String   @id @default(cuid())

  // 基本信息
  name        String
  description String?
  category    TemplateCategory

  // 配置
  themeConfig   Json     // 主题配置
  layoutConfig  Json     // 布局配置
  styleConfig   Json?    // 额外样式

  // 适用性
  supportedFormats  ExportFormat[]
  supportedSources  ExportSourceType[]

  // 状态
  isBuiltIn   Boolean  @default(false)  // 系统内置
  isDefault   Boolean  @default(false)  // 默认模板
  isPublic    Boolean  @default(false)  // 公开模板

  // 预览
  previewImage  String?

  // 版本
  version     Int      @default(1)

  // 归属
  userId      String?
  workspaceId String?

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  // 关联
  user        User?     @relation(fields: [userId], references: [id])
  workspace   Workspace? @relation(fields: [workspaceId], references: [id])
  exportJobs  ExportJob[]

  @@index([category, isBuiltIn])
  @@index([userId])
}

enum TemplateCategory {
  REPORT      // 报告类
  PPT         // 演示文稿
  DOCUMENT    // 通用文档
  ACADEMIC    // 学术论文
  BUSINESS    // 商务文档
}
```

## 4. 核心接口定义

### 4.1 统一内容格式 (UnifiedContent)

```typescript
/**
 * 统一的文档内容格式
 * 所有来源的内容都会被转换为这个格式
 */
interface UnifiedContent {
  // 元信息
  metadata: {
    title: string;
    subtitle?: string;
    author?: string;
    organization?: string;
    date?: Date;
    version?: string;
    tags?: string[];
  };

  // 封面配置
  cover?: {
    showCover: boolean;
    backgroundImage?: string;
    logo?: string;
  };

  // 目录
  tableOfContents?: {
    enabled: boolean;
    maxDepth: number;
  };

  // 主体内容
  sections: ContentSection[];

  // 参考文献
  references?: Reference[];

  // 附录
  appendices?: Appendix[];
}

interface ContentSection {
  id: string;
  type: ContentType;

  // 通用属性
  content?: string;
  level?: number; // 标题层级 1-6

  // 特定类型属性
  items?: ListItem[]; // 列表项
  rows?: TableRow[]; // 表格行
  headers?: string[]; // 表格头
  imageUrl?: string; // 图片URL
  imageAlt?: string; // 图片描述
  chartConfig?: any; // 图表配置
  codeLanguage?: string; // 代码语言
  citation?: number[]; // 引用索引

  // 子节点
  children?: ContentSection[];
}

type ContentType =
  | "heading" // 标题
  | "paragraph" // 段落
  | "list" // 列表
  | "table" // 表格
  | "image" // 图片
  | "chart" // 图表
  | "code" // 代码块
  | "quote" // 引用
  | "divider" // 分隔符
  | "callout"; // 提示框

interface Reference {
  id: number;
  title: string;
  url?: string;
  author?: string;
  publishedDate?: string;
  accessedAt?: Date;
  snippet?: string;
}
```

### 4.2 主题配置 (ThemeConfig)

```typescript
interface ThemeConfig {
  // 颜色方案
  colors: {
    primary: string; // 主色
    secondary: string; // 辅色
    accent: string; // 强调色
    background: string; // 背景色
    text: string; // 正文色
    textLight: string; // 浅色文字
    heading: string; // 标题色
    link: string; // 链接色
    border: string; // 边框色
    success: string;
    warning: string;
    error: string;
  };

  // 字体配置
  fonts: {
    heading: FontConfig;
    body: FontConfig;
    mono: FontConfig;
  };

  // 间距配置
  spacing: {
    page: { top: number; right: number; bottom: number; left: number };
    section: number;
    paragraph: number;
    list: number;
  };

  // 装饰元素
  decorations: {
    showHeaderLine: boolean;
    showFooterLine: boolean;
    showPageNumbers: boolean;
    headerStyle: "minimal" | "standard" | "prominent";
    footerStyle: "minimal" | "standard" | "prominent";
  };
}

interface FontConfig {
  family: string;
  size: number;
  weight: number;
  lineHeight: number;
}
```

### 4.3 导出请求 (ExportRequest)

```typescript
interface ExportRequest {
  // 内容来源 (必选其一)
  source: ExportSource;

  // 导出格式
  format: ExportFormat;

  // 模板 (可选)
  templateId?: string;
  customTheme?: Partial<ThemeConfig>;

  // 导出选项
  options?: ExportOptions;
}

type ExportSource =
  | { type: "document"; documentId: string }
  | { type: "research"; sessionId: string }
  | { type: "report"; reportId: string }
  | { type: "raw"; content: string; contentType: "markdown" | "html" | "json" };

interface ExportOptions {
  // 内容选项
  includeCover?: boolean;
  includeTableOfContents?: boolean;
  includeReferences?: boolean;
  includePageNumbers?: boolean;

  // 页面设置
  pageSize?: "A4" | "A3" | "Letter" | "Legal";
  orientation?: "portrait" | "landscape";

  // 安全选项
  watermark?: string;
  password?: string;

  // 文件名
  fileName?: string;
}
```

## 5. 内置模板

### 5.1 报告类模板

| ID                    | 名称     | 适用场景           | 支持格式        |
| --------------------- | -------- | ------------------ | --------------- |
| `report-professional` | 专业报告 | 商务报告、研究报告 | PDF, DOCX       |
| `report-academic`     | 学术论文 | 学术论文、研究论文 | PDF, DOCX       |
| `report-executive`    | 执行摘要 | 高管汇报           | PDF, DOCX, PPTX |
| `report-minimal`      | 简约报告 | 快速阅读           | PDF, DOCX, MD   |

### 5.2 演示类模板

| ID              | 名称     | 适用场景 | 支持格式  |
| --------------- | -------- | -------- | --------- |
| `ppt-corporate` | 企业商务 | 商业演示 | PPTX, PDF |
| `ppt-minimal`   | 简约风格 | 清爽演示 | PPTX, PDF |
| `ppt-modern`    | 现代科技 | 技术分享 | PPTX, PDF |
| `ppt-academic`  | 学术专业 | 学术答辩 | PPTX, PDF |

### 5.3 特殊模板

| ID              | 名称     | 适用场景           | 支持格式        |
| --------------- | -------- | ------------------ | --------------- |
| `deep-research` | 深度研究 | Deep Research 导出 | PDF, DOCX, MD   |
| `comparison`    | 对比分析 | 多资源对比         | PDF, DOCX, XLSX |
| `timeline`      | 时间线   | 事件梳理           | PDF, PPTX       |

## 6. 渲染器实现规范

### 6.1 渲染器接口

```typescript
interface ExportRenderer {
  /**
   * 渲染器支持的格式
   */
  readonly format: ExportFormat;

  /**
   * 渲染文档
   * @param content 统一内容格式
   * @param theme 主题配置
   * @param options 导出选项
   * @returns 文件 Buffer
   */
  render(
    content: UnifiedContent,
    theme: ThemeConfig,
    options: ExportOptions,
  ): Promise<Buffer>;

  /**
   * 获取 MIME 类型
   */
  getMimeType(): string;

  /**
   * 获取文件扩展名
   */
  getFileExtension(): string;
}
```

### 6.2 渲染器实现

| 渲染器           | 依赖库    | 状态 | 特点                               |
| ---------------- | --------- | ---- | ---------------------------------- |
| PdfRenderer      | puppeteer | ✅   | HTML→PDF，支持复杂样式、水印、页码 |
| DocxRenderer     | docx      | ✅   | 原生 DOCX，支持样式、表格、列表    |
| PptxRenderer     | pptxgenjs | ✅   | 自动分页、母版、表格支持           |
| XlsxRenderer     | exceljs   | ✅   | 多工作表、表格数据、参考文献       |
| MarkdownRenderer | 原生      | ✅   | 快速，可编辑，目录生成             |
| HtmlRenderer     | 原生      | ✅   | 响应式、暗色模式、打印优化         |

## 7. 实施计划

### Phase 1: 核心框架 ✅

- [x] 创建 ExportModule
- [x] 实现 ExportOrchestratorService
- [x] 实现 ContentTransformerService
- [x] 实现基础渲染器 (PDF, Markdown)
- [x] 创建数据库模型 (schema.prisma)
- [ ] 运行数据库 Migration

### Phase 2: 模板系统 ✅

- [x] 实现 TemplateManagerService
- [x] 创建内置模板 (7个模板)
- [x] 实现模板 CRUD API (TemplateController)
- [x] 模板种子脚本 (seed-templates.ts)

### Phase 3: 渲染器完善 ✅

- [x] 实现 DOCX 渲染器 (docx 库)
- [x] 实现 PPTX 渲染器 (pptxgenjs 库)
- [x] 实现 XLSX 渲染器 (exceljs 库)
- [x] 实现 HTML 渲染器
- [x] 添加水印功能

### Phase 4: 模块接入 (部分完成)

- [x] 前端 useExport Hook
- [ ] AI Studio (Deep Research) 接入 UI
- [ ] AI Office 迁移
- [ ] Content Reports 迁移

### Phase 5: 优化与测试

- [ ] 性能优化
- [ ] 错误处理和重试机制
- [ ] 单元测试和集成测试
- [ ] 文档完善

## 8. 文件结构

```
backend/src/modules/export/
├── export.module.ts              ✅ 模块定义，注册所有渲染器
├── index.ts                      ✅ 公共导出
├── controllers/
│   ├── export.controller.ts      ✅ 导出任务 API
│   └── template.controller.ts    ✅ 模板 CRUD API
├── services/
│   ├── export-orchestrator.service.ts  ✅ 导出编排器
│   ├── content-transformer.service.ts  ✅ 内容转换器
│   └── template-manager.service.ts     ✅ 模板管理器
├── renderers/
│   ├── renderer.interface.ts     ✅ 渲染器接口
│   ├── pdf.renderer.ts           ✅ PDF (Puppeteer)
│   ├── docx.renderer.ts          ✅ DOCX (docx)
│   ├── pptx.renderer.ts          ✅ PPTX (pptxgenjs)
│   ├── xlsx.renderer.ts          ✅ XLSX (exceljs)
│   ├── markdown.renderer.ts      ✅ Markdown
│   └── html.renderer.ts          ✅ HTML
├── templates/
│   ├── builtin-templates.ts      ✅ 7个内置模板定义
│   └── seed-templates.ts         ✅ 模板初始化脚本
└── types/
    ├── index.ts                  ✅ 类型导出
    ├── unified-content.ts        ✅ 统一内容格式
    ├── theme-config.ts           ✅ 主题配置
    └── export-options.ts         ✅ 导出选项

frontend/hooks/
└── useExport.ts                  ✅ 前端导出 Hook

backend/prisma/
└── schema.prisma                 ✅ ExportJob + ExportTemplate 模型
```

## 9. API 示例

### 创建导出任务

```bash
POST /api/export
Content-Type: application/json

{
  "source": {
    "type": "research",
    "sessionId": "dr_xxxxx"
  },
  "format": "PDF",
  "templateId": "deep-research",
  "options": {
    "includeCover": true,
    "includeTableOfContents": true,
    "includeReferences": true,
    "pageSize": "A4"
  }
}

# Response
{
  "jobId": "exp_xxxxx",
  "status": "QUEUED",
  "estimatedTime": 30
}
```

### 查询任务状态

```bash
GET /api/export/exp_xxxxx

# Response
{
  "jobId": "exp_xxxxx",
  "status": "COMPLETED",
  "progress": 100,
  "downloadUrl": "https://..../download/exp_xxxxx",
  "expiresAt": "2024-12-26T00:00:00Z",
  "fileName": "Deep_Research_Report.pdf",
  "fileSize": 1234567
}
```

### 获取模板列表

```bash
GET /api/templates?category=REPORT

# Response
{
  "templates": [
    {
      "id": "report-professional",
      "name": "专业报告",
      "category": "REPORT",
      "supportedFormats": ["PDF", "DOCX"],
      "previewImage": "https://.../preview.png",
      "isBuiltIn": true
    }
  ]
}
```

## 10. 前端集成

```typescript
// hooks/useExport.ts
import { useState, useCallback } from 'react';
import { api } from '@/lib/api';

interface UseExportResult {
  exportDocument: (request: ExportRequest) => Promise<ExportResult>;
  getTemplates: (category?: TemplateCategory) => Promise<Template[]>;
  exportStatus: ExportStatus;
  isExporting: boolean;
  error: string | null;
}

export function useExport(): UseExportResult {
  const [status, setStatus] = useState<ExportStatus>({ status: 'idle' });
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportDocument = useCallback(async (request: ExportRequest) => {
    setIsExporting(true);
    setError(null);

    try {
      // 1. 创建导出任务
      const { jobId } = await api.post('/api/export', request);

      // 2. 轮询任务状态
      const result = await pollExportJob(jobId, (progress) => {
        setStatus({ status: 'processing', progress });
      });

      // 3. 返回下载链接
      setStatus({ status: 'completed', downloadUrl: result.downloadUrl });
      return result;

    } catch (err) {
      setError(err.message);
      setStatus({ status: 'failed', error: err.message });
      throw err;
    } finally {
      setIsExporting(false);
    }
  }, []);

  const getTemplates = useCallback(async (category?: TemplateCategory) => {
    const response = await api.get('/api/templates', { params: { category } });
    return response.templates;
  }, []);

  return {
    exportDocument,
    getTemplates,
    exportStatus: status,
    isExporting,
    error,
  };
}

// 使用示例
function ResearchExportButton({ sessionId }) {
  const { exportDocument, isExporting, exportStatus } = useExport();

  const handleExport = async (format: ExportFormat) => {
    const result = await exportDocument({
      source: { type: 'research', sessionId },
      format,
      templateId: 'deep-research',
      options: { includeCover: true }
    });

    // 自动下载
    window.open(result.downloadUrl, '_blank');
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Button disabled={isExporting}>
          {isExporting ? <Loader2 className="animate-spin" /> : <Download />}
          导出
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={() => handleExport('PDF')}>
          导出为 PDF
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport('DOCX')}>
          导出为 Word
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport('PPTX')}>
          导出为 PPT
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport('MARKDOWN')}>
          导出为 Markdown
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

---

_文档版本: 1.1_
_创建日期: 2024-12-25_
_更新日期: 2024-12-25_
_作者: AI Architect_
_状态: Phase 1-3 已完成，Phase 4-5 待完成_
