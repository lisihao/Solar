# 知识库数据源扩展 PRD

## 版本信息

- **版本**: v1.0
- **日期**: 2024-12-27
- **状态**: 待评审

---

## 1. 背景与目标

### 1.1 背景

当前知识库支持两种数据源：

- **手动上传**: 上传本地文档文件
- **Google Drive**: 从 Google Drive 同步文件

用户反馈希望能够从更多来源导入内容到知识库，以便更好地利用已有的数字资产。

### 1.2 目标

扩展知识库数据源，支持以下四种新的导入方式：

1. **URL 抓取** - 从网页 URL 抓取内容
2. **平台书签** - 从平台已保存的书签导入
3. **平台笔记** - 从平台已创建的笔记导入
4. **图片 OCR** - 从图片中提取文字内容

### 1.3 成功指标

- 用户可以从 4 种新数据源成功导入内容到知识库
- 导入成功率 > 95%
- 导入后内容可被正确向量化和检索

---

## 2. 功能详细设计

### 2.1 URL 抓取

#### 2.1.1 功能描述

用户输入一个或多个网页 URL，系统自动抓取网页内容并导入知识库。

#### 2.1.2 用户流程

1. 用户选择"URL 抓取"数据源
2. 输入界面展示：
   - 单个 URL 输入框
   - 批量导入按钮（支持粘贴多个 URL，每行一个）
3. 用户输入 URL 后点击"抓取"
4. 系统显示抓取预览（标题、摘要、预计字数）
5. 用户确认后导入到知识库

#### 2.1.3 技术要求

- 支持 HTTP/HTTPS 链接
- 自动提取正文内容（去除导航、广告等干扰内容）
- 支持动态渲染页面（SPA 网站）
- 抓取超时设置（默认 30 秒）
- 内容大小限制（单页最大 500KB 文本）

#### 2.1.4 错误处理

- URL 格式错误 → 提示修正
- 网页无法访问 → 显示具体错误原因
- 内容提取失败 → 提供原始 HTML 下载选项
- 付费墙/登录墙 → 提示用户该页面需要登录

#### 2.1.5 数据模型

```typescript
interface UrlDocument {
  sourceType: "URL";
  sourceUrl: string;
  title: string;
  content: string;
  fetchedAt: Date;
  metadata: {
    author?: string;
    publishDate?: string;
    siteName?: string;
    description?: string;
  };
}
```

---

### 2.2 平台书签

#### 2.2.1 功能描述

用户可以选择平台内已保存的书签，将书签对应的网页内容导入知识库。

#### 2.2.2 用户流程

1. 用户选择"平台书签"数据源
2. 系统展示用户的书签列表（支持搜索和筛选）
3. 用户勾选要导入的书签
4. 系统批量抓取选中书签的网页内容
5. 显示抓取结果（成功/失败数量）
6. 用户确认后导入到知识库

#### 2.2.3 界面设计

- 书签列表视图：
  - 书签名称
  - 原始 URL
  - 保存时间
  - 标签（如有）
- 批量操作：
  - 全选/取消全选
  - 按标签筛选
  - 按时间范围筛选

#### 2.2.4 技术要求

- 复用 URL 抓取模块
- 支持增量同步（仅导入新增书签）
- 记录书签与知识库文档的关联关系

#### 2.2.5 数据模型

```typescript
interface BookmarkDocument {
  sourceType: "BOOKMARK";
  bookmarkId: string; // 关联书签 ID
  sourceUrl: string;
  title: string;
  content: string;
  fetchedAt: Date;
}
```

---

### 2.3 平台笔记

#### 2.3.1 功能描述

用户可以选择平台内已创建的笔记，将笔记内容导入知识库。

#### 2.3.2 用户流程

1. 用户选择"平台笔记"数据源
2. 系统展示用户的笔记列表（支持搜索和筛选）
3. 用户勾选要导入的笔记
4. 系统直接将笔记内容导入知识库
5. 显示导入结果

#### 2.3.3 界面设计

- 笔记列表视图：
  - 笔记标题
  - 创建时间
  - 更新时间
  - 内容预览（前 100 字）
  - 关联资源（如有）
- 批量操作：
  - 全选/取消全选
  - 按时间范围筛选

#### 2.3.4 技术要求

- 保留笔记的格式（Markdown）
- 支持笔记内的图片（转为 base64 或独立存储）
- 支持增量同步
- 笔记更新时自动更新知识库文档

#### 2.3.5 同步策略

- **手动同步**: 用户主动选择导入
- **自动同步**: 可选，笔记更新时自动更新知识库

#### 2.3.6 数据模型

```typescript
interface NoteDocument {
  sourceType: "NOTE";
  noteId: string; // 关联笔记 ID
  title: string;
  content: string; // Markdown 格式
  syncedAt: Date;
  autoSync: boolean;
}
```

---

### 2.4 图片 OCR

#### 2.4.1 功能描述

用户上传图片，系统使用 OCR 技术提取图片中的文字内容，导入知识库。

#### 2.4.2 用户流程

1. 用户选择"图片 OCR"数据源
2. 上传界面：
   - 拖拽上传区域
   - 点击选择文件
   - 支持多图上传
3. 系统显示 OCR 处理进度
4. 展示提取结果预览（可编辑修正）
5. 用户确认后导入到知识库

#### 2.4.3 支持的图片格式

- JPG/JPEG
- PNG
- WebP
- PDF（多页 PDF 每页单独 OCR）
- HEIC/HEIF

#### 2.4.4 技术要求

- OCR 引擎选型：
  - 方案 A: Tesseract（开源，本地部署）
  - 方案 B: Google Cloud Vision API
  - 方案 C: Azure Computer Vision
  - **推荐**: Google Cloud Vision（准确率高，支持多语言）
- 支持的语言：中文、英文、日文、韩文
- 图片预处理：自动旋转、去噪、增强对比度
- 单张图片大小限制：10MB

#### 2.4.5 界面设计

- OCR 结果预览：
  - 左侧：原图展示
  - 右侧：识别文字（可编辑）
  - 置信度标注（低置信度区域高亮）
- 批量处理状态栏

#### 2.4.6 数据模型

```typescript
interface OcrDocument {
  sourceType: "IMAGE";
  imageId: string; // 关联图片 ID
  originalFilename: string;
  imageUrl: string; // 存储的图片 URL
  content: string; // OCR 提取的文字
  confidence: number; // 整体置信度
  processedAt: Date;
  metadata: {
    width: number;
    height: number;
    format: string;
    language: string;
  };
}
```

---

## 3. 数据库设计

### 3.1 扩展 KnowledgeBaseDocument 表

```prisma
model KnowledgeBaseDocument {
  id                String   @id @default(uuid())
  knowledgeBaseId   String

  // 数据源类型扩展
  sourceType        String   // GOOGLE_DRIVE | MANUAL | URL | BOOKMARK | NOTE | IMAGE

  // 关联 ID（根据 sourceType 不同含义不同）
  sourceId          String?  // bookmarkId / noteId / imageId
  sourceUrl         String?  // URL 数据源的原始链接

  // 通用字段
  title             String
  content           String   @db.Text

  // OCR 特有字段
  imageUrl          String?
  ocrConfidence     Float?

  // 同步设置
  autoSync          Boolean  @default(false)
  lastSyncedAt      DateTime?

  // 状态
  status            String   @default("PENDING")
  processedAt       DateTime?
  lastError         String?

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  knowledgeBase     KnowledgeBase @relation(fields: [knowledgeBaseId], references: [id])
}
```

---

## 4. API 设计

### 4.1 URL 抓取

```typescript
// 预览 URL 内容
POST /api/v1/rag/knowledge-bases/:id/fetch-url
Body: { url: string }
Response: {
  title: string;
  content: string;
  wordCount: number;
  metadata: { ... };
}

// 批量导入 URL
POST /api/v1/rag/knowledge-bases/:id/import-urls
Body: { urls: string[] }
Response: {
  success: number;
  failed: { url: string; error: string }[];
}
```

### 4.2 平台书签

```typescript
// 获取可导入的书签列表
GET /api/v1/rag/knowledge-bases/:id/available-bookmarks
Query: { search?: string; tags?: string[]; page?: number }
Response: {
  bookmarks: Bookmark[];
  total: number;
}

// 导入书签
POST /api/v1/rag/knowledge-bases/:id/import-bookmarks
Body: { bookmarkIds: string[] }
Response: {
  success: number;
  failed: { bookmarkId: string; error: string }[];
}
```

### 4.3 平台笔记

```typescript
// 获取可导入的笔记列表
GET /api/v1/rag/knowledge-bases/:id/available-notes
Query: { search?: string; page?: number }
Response: {
  notes: Note[];
  total: number;
}

// 导入笔记
POST /api/v1/rag/knowledge-bases/:id/import-notes
Body: {
  noteIds: string[];
  autoSync?: boolean;
}
Response: {
  success: number;
  failed: { noteId: string; error: string }[];
}
```

### 4.4 图片 OCR

```typescript
// 上传图片进行 OCR
POST /api/v1/rag/knowledge-bases/:id/ocr
Body: FormData { images: File[] }
Response: {
  results: {
    filename: string;
    content: string;
    confidence: number;
    imageUrl: string;
  }[];
}

// 确认导入 OCR 结果
POST /api/v1/rag/knowledge-bases/:id/import-ocr
Body: {
  documents: {
    imageUrl: string;
    title: string;
    content: string;  // 可能是用户修正后的
  }[];
}
Response: {
  success: number;
  documentIds: string[];
}
```

---

## 5. 前端组件设计

### 5.1 数据源选择器改进

```
CreateKnowledgeBaseDialog
├── 基础信息 (名称、描述)
└── 数据源选择 (多选)
    ├── 手动上传 ✓ (已实现)
    ├── Google Drive ✓ (已实现)
    ├── URL 抓取 (新增)
    ├── 平台书签 (新增)
    ├── 平台笔记 (新增)
    └── 图片 OCR (新增)
```

### 5.2 新增组件

```
frontend/components/library/
├── UrlImportPanel.tsx        # URL 抓取面板
├── BookmarkSelectPanel.tsx   # 书签选择面板
├── NoteSelectPanel.tsx       # 笔记选择面板
├── OcrUploadPanel.tsx        # OCR 上传面板
└── OcrResultPreview.tsx      # OCR 结果预览
```

---

## 6. 实施计划

### Phase 1: URL 抓取 (优先级: P0)

- 预计工时: 3-4 天
- 依赖: 无
- 风险: 动态页面抓取可能需要 Puppeteer

### Phase 2: 平台书签 (优先级: P1)

- 预计工时: 2-3 天
- 依赖: Phase 1 (复用 URL 抓取模块)
- 风险: 低

### Phase 3: 平台笔记 (优先级: P1)

- 预计工时: 2 天
- 依赖: 无
- 风险: 低

### Phase 4: 图片 OCR (优先级: P2)

- 预计工时: 4-5 天
- 依赖: OCR 服务选型和配置
- 风险: OCR 服务成本、准确率

---

## 7. 风险与缓解

| 风险             | 影响         | 缓解措施                            |
| ---------------- | ------------ | ----------------------------------- |
| 网页抓取被反爬   | URL 导入失败 | 使用 headless browser，实现重试机制 |
| OCR 服务成本     | 运营成本增加 | 设置用户每日 OCR 配额               |
| OCR 准确率低     | 用户体验差   | 提供结果编辑功能，标注低置信度区域  |
| 大量导入影响性能 | 系统响应慢   | 使用后台队列处理，限制批量数量      |

---

## 8. 附录

### 8.1 竞品参考

- Notion: 支持网页剪藏、导入 Markdown
- Obsidian: 支持 OCR 插件
- Evernote: 支持网页剪藏、图片 OCR

### 8.2 用户调研反馈

- "希望能直接导入我收藏的文章"
- "有很多 PDF 扫描件，希望能识别里面的文字"
- "笔记记录的内容也想加入知识库进行检索"
