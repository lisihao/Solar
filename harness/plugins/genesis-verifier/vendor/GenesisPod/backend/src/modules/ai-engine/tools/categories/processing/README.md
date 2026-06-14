# File Parser Tool

## 概述

文件解析工具支持解析多种文档格式，提取文本内容、文档结构和表格数据。

## 支持的文件格式

- **PDF** (`.pdf`) - 使用 `pdf-parse`
- **Word** (`.docx`) - 使用 `mammoth`
- **Excel** (`.xlsx`) - 使用 `exceljs`
- **PowerPoint** (`.pptx`) - 使用 `jszip` 和 `xml2js`

## 依赖

大部分依赖已在 `package.json` 中定义：

```json
{
  "dependencies": {
    "pdf-parse": "^2.4.5",
    "mammoth": "^1.11.0",
    "exceljs": "^4.4.0",
    "xml2js": "^0.6.2",
    "axios": "^1.13.2"
  },
  "devDependencies": {
    "@types/pdf-parse": "^1.1.5",
    "@types/xml2js": "^0.4.14"
  }
}
```

**需要额外安装的依赖（用于 PPTX 解析）：**

```bash
npm install jszip
npm install --save-dev @types/jszip
```

## 功能特性

### 1. PDF 解析

- 提取全文内容
- 识别文档元数据（作者、页数）
- 分析章节结构
- 可选：提取表格数据
- 支持限制最大页数

### 2. Word (DOCX) 解析

- 提取纯文本和 HTML 格式内容
- 识别标题层级（H1-H6）
- 提取章节结构
- 提取表格数据（包括表头和数据行）
- 保留基本格式

### 3. Excel (XLSX) 解析

- 支持多工作表
- 提取所有单元格数据
- 处理富文本单元格
- 提取每个工作表的表格数据
- 识别表头和数据行

### 4. PowerPoint (PPTX) 解析

- 提取所有幻灯片文本
- 按幻灯片组织内容
- 提取元数据（作者、幻灯片数）
- 可选：提取表格数据

## 使用示例

```typescript
import { FileParserTool } from "./tools/processing/documents/file-parser.tool";

// 创建工具实例
const fileParser = new FileParserTool();

// 解析 PDF 文件
const pdfResult = await fileParser.execute(
  {
    file: {
      buffer: pdfBuffer,
      mimeType: "application/pdf",
      filename: "document.pdf",
    },
    options: {
      extractTables: true,
      maxPages: 50,
    },
  },
  { taskId: "task-123" },
);

// 解析 Word 文件
const docxResult = await fileParser.execute(
  {
    file: {
      url: "https://example.com/document.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      filename: "document.docx",
    },
    options: {
      extractTables: true,
      preserveLayout: true,
    },
  },
  { taskId: "task-124" },
);
```

## 输入参数

```typescript
interface FileParserInput {
  file: {
    url?: string; // 远程文件 URL
    buffer?: Buffer; // 本地文件 Buffer
    mimeType: string; // MIME 类型
    filename: string; // 文件名
  };
  options?: {
    extractImages?: boolean; // 是否提取图片（默认 false）
    extractTables?: boolean; // 是否提取表格（默认 true）
    preserveLayout?: boolean; // 是否保留布局（默认 false）
    maxPages?: number; // 最大页数，仅 PDF（默认 100）
  };
}
```

## 输出结果

```typescript
interface FileParserOutput {
  content: string; // 提取的纯文本内容
  structure: {
    title?: string; // 文档标题
    sections: Array<{
      level: number; // 章节层级
      title: string; // 章节标题
      content: string; // 章节内容
    }>;
    metadata: {
      author?: string; // 作者
      pageCount?: number; // 页数/幻灯片数/工作表数
      wordCount?: number; // 字数
    };
  };
  tables?: Array<{
    // 表格数据（如果启用）
    headers: string[]; // 表头
    rows: string[][]; // 数据行
  }>;
}
```

## 错误处理

工具包含完善的错误处理机制：

- 验证文件类型和必填参数
- 处理文件下载失败
- 处理解析异常
- 90 秒超时保护

## 性能建议

1. **PDF 文件**：对于大型 PDF，使用 `maxPages` 限制解析页数
2. **Excel 文件**：大型工作簿可能需要较长处理时间
3. **远程文件**：优先使用 Buffer 而非 URL 以减少网络延迟
4. **内存使用**：大文件可能占用较多内存，建议监控

## 注意事项

1. MIME 类型必须准确，否则会选择错误的解析器
2. 某些复杂格式可能无法完美保留（如复杂表格、图表）
3. 图片提取功能目前仅作为占位，未完全实现
4. 表格提取依赖文档结构，可能不适用于所有情况

## 扩展性

如需添加新的文件格式支持：

1. 在 `ToolType` 枚举中添加对应的 MIME 类型
2. 在 `doExecute` 中添加新的 case
3. 实现对应的解析方法
4. 更新 `inputSchema` 中的 `enum` 列表
