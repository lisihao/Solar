# AI Writing 章节评审修改 & 导入外部章节 功能设计

> 版本: 1.0
> 日期: 2026-01-11
> 状态: 设计中

---

## 一、背景与需求

### 1.1 用户痛点

1. **章节评审修改需求**
   - AI 生成的章节内容可能需要局部调整
   - 用户希望对特定段落提出修改意见，让 AI 重写
   - 需要保留修改历史，方便对比和回溯
   - 希望在不重新生成整章的情况下，微调内容

2. **导入外部平台章节需求**
   - 用户已在其他平台（如起点、晋江、番茄）写作了部分内容
   - 希望将已有章节导入系统，继续创作
   - 需要系统能解析导入内容，建立与 StoryBible 的关联
   - 导入后需要一致性检查，确保与现有设定不冲突

---

## 二、章节评审修改功能

### 2.1 功能概述

提供 **人工编辑** + **AI 辅助修改** 双模式：

```
┌─────────────────────────────────────────────────────────────┐
│                    章节详情页面                              │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐   │
│  │  章节内容展示区                                       │   │
│  │  - 显示原始内容                                       │   │
│  │  - 支持选中文本                                       │   │
│  │  - 显示修改批注                                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  [编辑模式] [AI辅助] [修改历史] [一致性检查]           │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  修改意见输入区                                       │   │
│  │  "请将第三段的对话改得更加紧张..."                     │   │
│  │  [应用修改]                                          │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 核心功能

#### 2.2.1 人工直接编辑

| 功能       | 描述                           |
| ---------- | ------------------------------ |
| 富文本编辑 | 直接修改章节内容，支持基础格式 |
| 段落高亮   | 选中需要修改的段落             |
| 批注标记   | 对特定内容添加批注/备注        |
| 实时保存   | 自动保存草稿，防止丢失         |
| 版本对比   | 显示与上一版本的差异           |

#### 2.2.2 AI 辅助修改

| 功能      | 描述                                |
| --------- | ----------------------------------- |
| 选中重写  | 选中段落，输入修改意见，AI 重写该段 |
| 全章润色  | 对整章进行润色（轻度/中度/重度）    |
| 风格统一  | 统一章节的叙事风格和语气            |
| 扩写/缩写 | 对选中内容进行扩展或精简            |
| 对话改写  | 专门针对对话内容的优化              |

#### 2.2.3 修改历史

| 功能     | 描述               |
| -------- | ------------------ |
| 版本列表 | 展示所有历史版本   |
| 差异对比 | 任意两个版本的对比 |
| 版本回退 | 恢复到历史版本     |
| 修改说明 | 每次修改附带说明   |

### 2.3 数据模型扩展

```prisma
// 章节修订历史
model ChapterRevision {
  id           String   @id @default(uuid())
  chapterId    String
  chapter      WritingChapter @relation(fields: [chapterId], references: [id], onDelete: Cascade)

  versionNumber Int     // 版本号
  content       String  // 该版本的完整内容
  wordCount     Int     // 字数

  changeType    RevisionChangeType // 修改类型
  changeSummary String?            // 修改说明
  changedBy     String             // 修改者: "user" | "ai_polish" | "ai_rewrite" | "ai_expand"

  // AI 修改时的元数据
  aiParams     Json?   // { operation, targetSection, userFeedback, etc. }

  createdAt    DateTime @default(now())

  @@index([chapterId, versionNumber])
}

enum RevisionChangeType {
  MANUAL_EDIT     // 人工编辑
  AI_REWRITE      // AI 重写段落
  AI_POLISH       // AI 润色
  AI_EXPAND       // AI 扩写
  AI_CONDENSE     // AI 缩写
  AI_STYLE_FIX    // AI 风格修正
  IMPORTED        // 导入内容
  ROLLBACK        // 版本回退
}

// 章节批注
model ChapterAnnotation {
  id           String   @id @default(uuid())
  chapterId    String
  chapter      WritingChapter @relation(fields: [chapterId], references: [id], onDelete: Cascade)

  startOffset  Int      // 起始位置（字符偏移）
  endOffset    Int      // 结束位置
  content      String   // 批注内容
  type         AnnotationType // 批注类型
  status       AnnotationStatus @default(OPEN)

  createdAt    DateTime @default(now())
  resolvedAt   DateTime?

  @@index([chapterId])
}

enum AnnotationType {
  COMMENT       // 普通评论
  SUGGESTION    // 修改建议
  ISSUE         // 问题标记
  REFERENCE     // 参考说明
}

enum AnnotationStatus {
  OPEN          // 待处理
  RESOLVED      // 已解决
  DISMISSED     // 已忽略
}
```

### 2.4 API 设计

#### 2.4.1 章节内容更新 (人工编辑)

```typescript
PATCH /api/v1/ai-writing/chapters/:id/content

Request:
{
  content: string              // 新内容
  changeSummary?: string       // 修改说明
}

Response:
{
  success: true
  chapter: Chapter
  revision: ChapterRevision    // 新创建的版本记录
}
```

#### 2.4.2 AI 辅助修改

```typescript
POST /api/v1/ai-writing/chapters/:id/ai-edit

Request:
{
  operation: "rewrite" | "polish" | "expand" | "condense" | "style_fix"

  // 选中重写时使用
  selection?: {
    startOffset: number
    endOffset: number
    originalText: string
  }

  // 用户修改意见
  userFeedback: string         // "让这段对话更紧张"

  // 润色参数
  polishLevel?: "light" | "moderate" | "heavy"

  // 风格参数
  targetStyle?: {
    tone?: string              // "严肃" | "轻松" | "悬疑"
    vocabulary?: string        // "现代白话" | "古风文言"
  }
}

Response:
{
  success: true
  missionId: string            // 异步任务ID
}

// 任务完成后返回
{
  success: true
  chapter: Chapter
  revision: ChapterRevision
  changes: {
    type: string
    before: string
    after: string
    description: string
  }[]
}
```

#### 2.4.3 获取修改历史

```typescript
GET /api/v1/ai-writing/chapters/:id/revisions

Response:
{
  items: ChapterRevision[]
  total: number
}
```

#### 2.4.4 版本对比

```typescript
GET /api/v1/ai-writing/chapters/:id/revisions/diff?v1=:revisionId1&v2=:revisionId2

Response:
{
  revision1: ChapterRevision
  revision2: ChapterRevision
  diff: {
    additions: string[]
    deletions: string[]
    changes: { before: string, after: string }[]
  }
}
```

#### 2.4.5 版本回退

```typescript
POST /api/v1/ai-writing/chapters/:id/revisions/:revisionId/rollback

Response:
{
  success: true
  chapter: Chapter
  newRevision: ChapterRevision  // 回退操作本身也会创建新版本
}
```

#### 2.4.6 批注管理

```typescript
// 添加批注
POST /api/v1/ai-writing/chapters/:id/annotations
{
  startOffset: number
  endOffset: number
  content: string
  type: AnnotationType
}

// 获取批注
GET /api/v1/ai-writing/chapters/:id/annotations

// 更新批注状态
PATCH /api/v1/ai-writing/chapters/:id/annotations/:annotationId
{
  status: AnnotationStatus
}

// 删除批注
DELETE /api/v1/ai-writing/chapters/:id/annotations/:annotationId
```

### 2.5 前端组件设计

#### 2.5.1 ChapterEditor 组件

```typescript
interface ChapterEditorProps {
  chapter: Chapter;
  onSave: (content: string, summary?: string) => Promise<void>;
  onAiEdit: (params: AiEditParams) => Promise<void>;
}

// 功能：
// - 富文本编辑器（使用 TipTap 或 Slate）
// - 文本选择和高亮
// - 批注显示和添加
// - 自动保存
```

#### 2.5.2 RevisionHistory 组件

```typescript
interface RevisionHistoryProps {
  chapterId: string;
  onRollback: (revisionId: string) => Promise<void>;
  onCompare: (v1: string, v2: string) => void;
}

// 功能：
// - 版本时间线展示
// - 版本信息卡片
// - 对比和回退按钮
```

#### 2.5.3 AiEditPanel 组件

```typescript
interface AiEditPanelProps {
  selectedText?: { start: number; end: number; text: string };
  onSubmit: (params: AiEditParams) => Promise<void>;
}

// 功能：
// - 操作类型选择（重写/润色/扩写等）
// - 修改意见输入
// - 参数配置（润色级别、风格等）
// - 提交按钮
```

---

## 三、导入外部平台章节功能

### 3.1 功能概述

```
┌──────────────────────────────────────────────────────────────┐
│                     导入向导                                  │
├──────────────────────────────────────────────────────────────┤
│  Step 1: 选择导入方式                                         │
│  ┌────────┐  ┌────────┐  ┌────────┐                          │
│  │ 粘贴   │  │ 文件   │  │ 网址   │                          │
│  │ 文本   │  │ 上传   │  │ 抓取   │                          │
│  └────────┘  └────────┘  └────────┘                          │
├──────────────────────────────────────────────────────────────┤
│  Step 2: 内容预览与章节识别                                   │
│  ┌───────────────────────────────────────────────────────┐   │
│  │  识别到 12 个章节:                                      │   │
│  │  □ 第一章 初入江湖 (3,500字)                           │   │
│  │  □ 第二章 意外相逢 (4,200字)                           │   │
│  │  ...                                                   │   │
│  └───────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────┤
│  Step 3: 目标位置选择                                         │
│  ┌───────────────────────────────────────────────────────┐   │
│  │  导入到: [第一卷 ▼]  起始章节号: [1]                    │   │
│  │  □ 覆盖已有章节  □ 追加到末尾                          │   │
│  └───────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────┤
│  Step 4: 一致性检查                                          │
│  ┌───────────────────────────────────────────────────────┐   │
│  │  □ 导入后自动进行一致性检查                             │   │
│  │  □ 自动提取角色和设定到 StoryBible                      │   │
│  └───────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────┤
│                    [取消]  [上一步]  [开始导入]               │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 支持的导入方式

| 方式         | 描述             | 格式支持                    |
| ------------ | ---------------- | --------------------------- |
| **粘贴文本** | 直接粘贴章节内容 | 纯文本，自动识别章节分隔    |
| **文件上传** | 上传文件导入     | .txt, .docx, .epub, .md     |
| **URL 抓取** | 输入网址自动抓取 | 起点、晋江、番茄等 (需授权) |

### 3.3 章节识别规则

```typescript
interface ChapterPattern {
  name: string;
  pattern: RegExp;
  examples: string[];
}

const CHAPTER_PATTERNS: ChapterPattern[] = [
  {
    name: "standard_chinese",
    pattern: /^第[一二三四五六七八九十百千\d]+章\s*.+/m,
    examples: ["第一章 初入江湖", "第123章 最终决战"],
  },
  {
    name: "chapter_number",
    pattern: /^Chapter\s*\d+[:.：]?\s*.*/im,
    examples: ["Chapter 1: The Beginning", "Chapter 12 回归"],
  },
  {
    name: "numbered",
    pattern: /^\d+[.、．]\s*.+/m,
    examples: ["1. 序章", "12、归来"],
  },
  {
    name: "custom_delimiter",
    pattern: /^[【\[].*[】\]]/m,
    examples: ["【第一章】", "[序]"],
  },
];
```

### 3.4 数据模型扩展

```prisma
// 导入记录
model ChapterImport {
  id           String   @id @default(uuid())
  projectId    String
  project      WritingProject @relation(fields: [projectId], references: [id], onDelete: Cascade)

  source       ImportSource   // 导入来源
  sourceUrl    String?        // 来源URL（如果是网址抓取）
  fileName     String?        // 文件名（如果是文件上传）

  totalChapters Int           // 导入章节数
  totalWords    Int           // 总字数

  status       ImportStatus   @default(PENDING)

  // 处理结果
  importedChapterIds String[] // 成功导入的章节ID
  errors       Json[]         // 错误信息

  // 后处理
  consistencyCheckId String?  // 关联的一致性检查任务
  bibleExtractionId  String?  // 关联的 StoryBible 提取任务

  createdAt    DateTime @default(now())
  completedAt  DateTime?

  @@index([projectId])
}

enum ImportSource {
  PASTE       // 粘贴文本
  FILE_TXT    // TXT 文件
  FILE_DOCX   // Word 文档
  FILE_EPUB   // EPUB 电子书
  FILE_MD     // Markdown 文件
  URL_QIDIAN  // 起点中文网
  URL_JJWXC   // 晋江文学城
  URL_FANQIE  // 番茄小说
  URL_OTHER   // 其他网址
}

enum ImportStatus {
  PENDING         // 待处理
  PARSING         // 解析中
  PREVIEWING      // 预览中（等待用户确认）
  IMPORTING       // 导入中
  POST_PROCESSING // 后处理中（一致性检查、提取）
  COMPLETED       // 完成
  FAILED          // 失败
}
```

### 3.5 API 设计

#### 3.5.1 解析导入内容

```typescript
POST /api/v1/ai-writing/projects/:projectId/import/parse

Request (multipart/form-data):
{
  source: ImportSource

  // 粘贴文本
  content?: string

  // 文件上传
  file?: File

  // URL 抓取
  url?: string

  // 章节识别模式
  chapterPattern?: "auto" | "standard_chinese" | "chapter_number" | "numbered" | "custom"
  customPattern?: string  // 自定义正则
}

Response:
{
  success: true
  importId: string         // 导入任务ID
  preview: {
    totalChapters: number
    totalWords: number
    chapters: {
      index: number
      title: string
      wordCount: number
      preview: string      // 前200字预览
    }[]
  }
}
```

#### 3.5.2 确认导入

```typescript
POST /api/v1/ai-writing/projects/:projectId/import/:importId/confirm

Request:
{
  targetVolumeId: string     // 目标卷
  startChapterNumber: number // 起始章节号

  // 选择要导入的章节（索引数组）
  selectedChapters: number[] // [0, 1, 2, 5, 6] 不连续也可以

  // 冲突处理
  conflictStrategy: "skip" | "overwrite" | "append"

  // 后处理选项
  postProcess: {
    runConsistencyCheck: boolean
    extractToBible: boolean
  }
}

Response:
{
  success: true
  importId: string
  status: "IMPORTING"
}
```

#### 3.5.3 获取导入状态

```typescript
GET /api/v1/ai-writing/projects/:projectId/import/:importId

Response:
{
  id: string
  status: ImportStatus
  progress: {
    current: number
    total: number
    currentChapter?: string
  }
  result?: {
    importedChapters: Chapter[]
    skippedCount: number
    errors: { chapter: string, error: string }[]
  }
  postProcessStatus?: {
    consistencyCheck: "pending" | "running" | "completed"
    bibleExtraction: "pending" | "running" | "completed"
  }
}
```

#### 3.5.4 获取导入历史

```typescript
GET /api/v1/ai-writing/projects/:projectId/import/history

Response:
{
  items: ChapterImport[]
  total: number
}
```

### 3.6 导入后处理

#### 3.6.1 一致性检查

导入完成后，自动运行一致性检查：

- 检查导入章节与现有内容的冲突
- 角色名称一致性
- 时间线一致性
- 设定冲突

#### 3.6.2 StoryBible 提取

从导入内容中提取：

- 角色信息（名字、特征、关系）
- 世界设定
- 术语和专有名词
- 重要事件

```typescript
POST /api/v1/ai-writing/projects/:projectId/import/:importId/extract-bible

Request:
{
  extractTypes: ["characters", "worldSettings", "terminologies", "events"]
  mergeStrategy: "auto" | "manual" | "skip_existing"
}

Response:
{
  success: true
  missionId: string  // 提取任务ID
}

// 任务完成后
{
  extracted: {
    characters: Character[]
    worldSettings: WorldSetting[]
    terminologies: Terminology[]
    events: TimelineEvent[]
  }
  conflicts: {
    type: string
    existing: any
    imported: any
    suggestion: string
  }[]
}
```

### 3.7 前端组件设计

#### 3.7.1 ImportWizard 组件

```typescript
interface ImportWizardProps {
  projectId: string;
  onComplete: (result: ImportResult) => void;
  onCancel: () => void;
}

// 步骤组件
const IMPORT_STEPS = [
  "SelectSource", // 选择导入方式
  "ParseContent", // 解析内容
  "PreviewChapters", // 预览章节
  "SelectTarget", // 选择目标位置
  "PostProcessOptions", // 后处理选项
  "Importing", // 导入进度
];
```

#### 3.7.2 ChapterPreviewList 组件

```typescript
interface ChapterPreviewListProps {
  chapters: ChapterPreview[];
  selectedIndices: number[];
  onSelectionChange: (indices: number[]) => void;
}

// 功能：
// - 章节列表展示
// - 全选/反选
// - 单个章节预览展开
// - 字数统计
```

#### 3.7.3 ImportProgress 组件

```typescript
interface ImportProgressProps {
  importId: string;
  onComplete: () => void;
}

// 功能：
// - 实时进度展示
// - 当前导入章节
// - 错误提示
// - 后处理状态
```

---

## 四、实现计划

### 4.1 第一阶段：章节评审修改 (核心)

1. **后端**
   - [ ] 扩展 Prisma schema (ChapterRevision, ChapterAnnotation)
   - [ ] 实现 ChapterRevisionService
   - [ ] 实现 ChapterAnnotationService
   - [ ] 扩展 Editor Agent 支持选中重写
   - [ ] 添加 API 端点

2. **前端**
   - [ ] ChapterEditor 富文本编辑组件
   - [ ] RevisionHistory 版本历史组件
   - [ ] AiEditPanel AI辅助编辑面板
   - [ ] 集成到项目详情页

### 4.2 第二阶段：导入外部章节 (基础)

1. **后端**
   - [ ] 扩展 Prisma schema (ChapterImport)
   - [ ] 实现 ChapterImportService
   - [ ] 实现章节解析器 (txt, docx, epub, md)
   - [ ] 添加 API 端点

2. **前端**
   - [ ] ImportWizard 导入向导
   - [ ] ChapterPreviewList 章节预览
   - [ ] ImportProgress 进度组件

### 4.3 第三阶段：高级功能

1. **URL 抓取** (需要法律合规审核)
2. **StoryBible 自动提取**
3. **批量一致性检查**
4. **冲突自动解决**

---

## 五、技术考量

### 5.1 富文本编辑器选型

| 方案        | 优点                       | 缺点             |
| ----------- | -------------------------- | ---------------- |
| **TipTap**  | 基于 ProseMirror，灵活强大 | 学习曲线较陡     |
| **Slate**   | React 原生，可定制性强     | 文档相对较少     |
| **Lexical** | Meta 开源，性能好          | 较新，生态待完善 |

**推荐**: TipTap，因为有丰富的扩展生态，支持协同编辑。

### 5.2 文件解析

| 格式  | 库          | 备注           |
| ----- | ----------- | -------------- |
| .txt  | 原生        | UTF-8 编码检测 |
| .docx | mammoth     | 保留基础格式   |
| .epub | epub-parser | 需要解压处理   |
| .md   | marked      | Markdown 渲染  |

### 5.3 版本差异对比

使用 `diff-match-patch` 或 `jsdiff` 库实现文本差异对比。

---

## 六、安全考量

1. **文件上传**
   - 文件类型白名单
   - 文件大小限制 (建议 10MB)
   - 病毒扫描 (可选)

2. **URL 抓取**
   - 仅允许白名单域名
   - 需要用户授权
   - 遵守 robots.txt
   - 限流防止滥用

3. **内容存储**
   - 导入内容的版权声明
   - 用户数据隔离

---

## 七、指标与监控

1. **功能指标**
   - 章节编辑次数/用户
   - AI 辅助修改使用率
   - 导入成功率
   - 平均导入章节数

2. **性能指标**
   - 文件解析时间
   - 版本对比渲染时间
   - 导入处理时间

---

## 附录

### A. 竞品参考

| 平台         | 章节编辑 | 版本历史 | 导入功能    |
| ------------ | -------- | -------- | ----------- |
| Notion AI    | 有       | 有       | 有 (多格式) |
| 语雀         | 有       | 有       | 有          |
| 石墨         | 有       | 有       | 有          |
| 番茄作家助手 | 有       | 无       | 无          |

### B. 用户故事

1. **作为作者**，我想要对 AI 生成的章节进行局部修改，以便保留好的部分同时改进不满意的地方。

2. **作为作者**，我想要让 AI 根据我的意见重写某个段落，以便快速迭代内容。

3. **作为作者**，我想要导入我在其他平台写的章节，以便在这个系统中继续创作。

4. **作为作者**，我想要查看章节的修改历史，以便回溯之前的版本。

5. **作为作者**，我想要导入后自动检查一致性，以便发现与现有设定的冲突。
