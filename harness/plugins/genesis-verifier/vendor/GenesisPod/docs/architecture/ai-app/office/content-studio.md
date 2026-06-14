# AI Office 内容创作工作室系统设计方案

> **文档类型**: 系统架构设计 v2.1
> **创建日期**: 2025-11-23
> **版本**: v2.1 (协作增强 + Gemini 3 + Imagen 3)
> **作者**: Senior Product Manager & Senior Architect
> **状态**: RFC (Request for Comments)
> **定位**: Gemini 3 驱动的 RAG 多模态协作创作平台

## 🆕 v2.1 更新内容

### 核心技术升级

1. **Gemini 3 Pro 全面集成** 🌟
   - 超长上下文窗口（最高 2M tokens）
   - 多模态理解能力（文本、图像、音视频）
   - 原生代码理解和生成
   - File Search API 托管 RAG

2. **Imagen 3 专业级图像生成** 🎨
   - 替换 DALL-E 3，更精准的提示词理解
   - 更高质量的专业配图
   - 与 Gemini 3 无缝集成

3. **实时协作系统** 👥
   - Google Docs 级别的多人同时在线编辑
   - WebSocket + CRDT (Y.js) 零冲突协作
   - 实时光标、评论、活动历史
   - 完整的权限控制和离线支持

---

## 📋 目录

- [1. 愿景重新定义](#1-愿景重新定义)
- [2. 产品定位与对标](#2-产品定位与对标)
- [3. 核心能力矩阵](#3-核心能力矩阵)
- [4. 系统架构设计](#4-系统架构设计)
- [5. 工作流设计](#5-工作流设计)
- [6. 版本管理系统](#6-版本管理系统)
- [7. 多模态输出引擎](#7-多模态输出引擎)
- [8. 技术实现方案](#8-技术实现方案)
- [9. 数据模型设计](#9-数据模型设计)
- [10. 实施路线图](#10-实施路线图)

---

## 1. 愿景重新定义

### 1.1 产品愿景

**AI Office 不是一个简单的 AI 问答工具，而是：**

> **"基于个人知识库的 AI 内容创作工作室"**
>
> 让用户的收藏资源（PDF、链接、笔记）成为创作的"燃料"，
> 通过 RAG + LLM 的组合，一键生成专业级的文档、PPT、图像、音视频，
> 并支持版本化管理和持续迭代优化。

### 1.2 核心价值主张

| 传统方式     | AI Office 方式                | 价值提升                |
| ------------ | ----------------------------- | ----------------------- | ----------- |
| **信息收集** | 手动整理多个来源              | 自动聚合本地 + 在线资源 | ⬆️ 10x 效率 |
| **内容创作** | 从零开始写作                  | 基于知识库 RAG 生成草稿 | ⬆️ 5x 速度  |
| **格式转换** | 手动制作 PPT/视频             | AI 自动生成多模态内容   | ⬆️ 20x 效率 |
| **版本管理** | 文件命名：v1, v2, final_final | Git-style 版本树 + Diff | ⬆️ 专业化   |
| **持续改进** | 重新编辑整个文档              | 针对性迭代优化          | ⬆️ 精准度   |

### 1.3 使用场景

#### 场景 1: 技术分享 PPT 制作

```
输入：
  - 收藏的 50 篇技术博客（Transformer、BERT、GPT 相关）
  - 自定义主题："LLM 发展史"

工作流：
  1. AI 分析所有博客，提取关键信息
  2. 生成 PPT 大纲（15 页）
  3. 为每页生成：
     - 标题
     - 要点（3-5 个）
     - 配图（AI 生成图表/示意图）
     - 演讲稿（Audio 旁白）
  4. 用户审核 → 修改某页 → AI 重新生成
  5. 导出：PPTX + PDF + 演讲视频

版本管理：
  - v1.0: 初稿（15 页）
  - v1.1: 优化第 3、7 页（根据反馈）
  - v2.0: 增加案例研究（新增 3 页）
  - v2.1: 调整配色主题
```

#### 场景 2: 市场报告生成

```
输入：
  - 20 份行业报告 PDF
  - 30 篇竞品分析文章
  - 5 个数据可视化链接

目标：生成 30 页《AI 市场趋势报告 2025》

工作流：
  1. 自动提取关键数据和观点
  2. 生成报告结构：
     - 执行摘要（2 页）
     - 市场规模（5 页 + 图表）
     - 竞争格局（8 页 + 表格）
     - 技术趋势（10 页）
     - 投资建议（5 页）
  3. AI 生成每部分内容 + 数据可视化
  4. 用户逐节审核和修改
  5. 导出：Word + PDF + 演示 PPT

版本管理：
  - v1.0-draft: 初稿
  - v1.1-review: 领导审核版
  - v1.2-revised: 修正数据
  - v2.0-final: 最终版
  - v2.1-translation: 英文版
```

#### 场景 3: 教学视频制作

```
输入：
  - 3 篇机器学习教程
  - 个人课程笔记
  - 代码示例

目标：生成 10 分钟《神经网络入门》教学视频

工作流：
  1. AI 生成视频脚本（分镜头）
  2. 为每个场景生成：
     - 文字解说词
     - 配图/动画（AI 生成）
     - 代码演示
  3. 合成视频：
     - AI 语音旁白
     - 自动添加字幕
     - 背景音乐
  4. 用户预览 → 调整某段 → 重新生成
  5. 导出：MP4 + 字幕文件 + 演讲稿

版本管理：
  - v1.0: 初版（8 分钟）
  - v1.1: 增加代码讲解（+2 分钟）
  - v1.2: 优化语速
  - v2.0: 添加互动问答
```

---

## 2. 产品定位与对标

### 2.1 竞品分析

| 产品             | 定位             | 核心能力                 | 与我们的差异              |
| ---------------- | ---------------- | ------------------------ | ------------------------- |
| **Notion AI**    | 知识库 + AI 写作 | 文档协作、AI 辅助写作    | ❌ 无 RAG、无多模态输出   |
| **Gamma.app**    | AI PPT 生成      | 一键生成精美 PPT         | ❌ 无知识库、无版本管理   |
| **Descript**     | 视频/音频编辑    | AI 剪辑、文本转视频      | ❌ 无 RAG、无文档生成     |
| **NotebookLM**   | 研究助手         | RAG 问答、Audio Overview | ❌ 无创作输出、无版本管理 |
| **Jasper.ai**    | AI 营销文案      | 营销内容生成             | ❌ 无 RAG、无多模态       |
| **Beautiful.ai** | 智能 PPT         | 自动排版 PPT             | ❌ 无 RAG、无版本管理     |

### 2.2 我们的独特定位

```
AI Office = NotebookLM (RAG 能力)
          + Gamma.app (PPT 生成)
          + Descript (视频生成)
          + Git (版本管理)
          + GenesisPod (知识库集成)
```

**核心差异化**:

1. ✅ **知识库驱动** - 基于用户收藏的个性化内容
2. ✅ **全流程覆盖** - 从 RAG 到多模态输出
3. ✅ **版本化管理** - Git-style 版本控制
4. ✅ **持续迭代** - 支持增量优化
5. ✅ **端到端自动化** - 一键生成专业内容

---

## 3. 核心能力矩阵

### 3.1 输入能力

| 输入类型     | 支持格式                  | 来源             | RAG 支持    |
| ------------ | ------------------------- | ---------------- | ----------- |
| **本地文件** | PDF, DOCX, TXT, MD        | 上传/Collections | ✅ 完整索引 |
| **在线链接** | 网页、Google Docs、Notion | URL 输入         | ✅ 自动抓取 |
| **云存储**   | Dropbox, Google Drive     | OAuth 连接       | ✅ 实时同步 |
| **代码仓库** | GitHub, GitLab            | Git 集成         | ✅ 代码理解 |
| **多媒体**   | YouTube, 播客             | URL + 转录       | ✅ 文本索引 |
| **个人笔记** | GenesisPod Notes          | 内置系统         | ✅ 自动关联 |

### 3.2 输出能力

| 输出类型     | 格式                | 生成方式                | 可编辑性        |
| ------------ | ------------------- | ----------------------- | --------------- |
| **文档**     | DOCX, PDF, MD       | Gemini + 模板           | ✅ 富文本编辑器 |
| **演示文稿** | PPTX, PDF, 在线预览 | AI 设计 + 内容填充      | ✅ 拖拽编辑     |
| **图像**     | PNG, SVG, JPEG      | **Imagen 3** (Google)   | ⚠️ 重新生成     |
| **图表**     | 数据可视化          | D3.js / Chart.js        | ✅ 数据调整     |
| **音频**     | MP3, WAV            | Google TTS / ElevenLabs | ⚠️ 重新生成     |
| **视频**     | MP4, WebM           | 图像 + 音频合成         | ✅ 时间轴编辑   |
| **交互内容** | HTML, React 组件    | 代码生成                | ✅ 代码级编辑   |

### 3.3 版本管理能力

| 功能          | 描述               | 实现方式              |
| ------------- | ------------------ | --------------------- |
| **版本树**    | Git-style 分支管理 | 树状结构存储          |
| **Diff 对比** | 可视化差异显示     | 文本 Diff + 语义 Diff |
| **回滚**      | 恢复到任意历史版本 | 快照存储              |
| **分支合并**  | 合并不同版本的改动 | 智能合并算法          |
| **标签**      | 标记重要版本       | 元数据标注            |
| **协作**      | 多人编辑、冲突解决 | CRDT / OT 算法        |

### 3.4 实时协作能力 🆕

| 功能             | 描述                   | 实现方式         |
| ---------------- | ---------------------- | ---------------- |
| **同时在线编辑** | 多人同时编辑同一内容   | WebSocket + CRDT |
| **实时光标**     | 显示其他用户的编辑位置 | Y.js Awareness   |
| **评论与讨论**   | 针对具体内容进行讨论   | 线程化评论系统   |
| **变更广播**     | 实时同步所有用户的修改 | Redis Pub/Sub    |
| **冲突解决**     | 自动合并冲突修改       | CRDT 算法        |
| **协作感知**     | 显示在线用户、编辑状态 | Presence 系统    |
| **权限控制**     | 编辑、评论、查看权限   | RBAC 权限系统    |
| **变更历史**     | 谁在何时修改了什么     | Activity Log     |

---

## 4. 系统架构设计

### 4.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                  Frontend Layer (Next.js + Y.js)                │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  AI Office   │  │ Collaborative│  │  Version     │          │
│  │  Dashboard   │  │   Editor 🆕  │  │  Manager     │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │         (Y.js + WebSocket)         │                  │
└─────────┼──────────────────┼──────────────────┼──────────────────┘
          │                  │                  │
┌─────────┼──────────────────┼──────────────────┼──────────────────┐
│         │     Backend Layer (NestJS + WebSocket)                │
├─────────┼──────────────────┼──────────────────┼──────────────────┤
│         ↓                  ↓                  ↓                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │         Content Creation Orchestrator (Gemini 3驱动) 🌟  │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │  • RAG Engine (Gemini File Search)                       │   │
│  │  • Multi-Modal Generator (Gemini 3 + Imagen 3)          │   │
│  │  • Version Control Engine (Git-style)                    │   │
│  │  • Iteration Manager (Refinement Loop)                   │   │
│  │  • Collaboration Engine (CRDT + WebSocket) 🆕            │   │
│  └────────┬──────────────────┬──────────────┬────────────────┘   │
│           │                  │              │                    │
│           ↓                  ↓              ↓                    │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐    │
│  │  RAG Service   │  │  Output        │  │  Version DB    │    │
│  │  (Gemini 3     │  │  Generators    │  │  (Git Model)   │    │
│  │ File Search)   │  │ (Gemini 3基础) │  │  + Comments    │    │
│  └────────┬───────┘  └────────┬───────┘  └────────┬───────┘    │
│           │                   │                    │             │
└───────────┼───────────────────┼────────────────────┼─────────────┘
            │                   │                    │
┌───────────┼───────────────────┼────────────────────┼─────────────┐
│   Google AI Platform 🌟       │                    │             │
├───────────┼───────────────────┼────────────────────┼─────────────┤
│           ↓                   ↓                    ↓             │
│  ┌─────────────────┐  ┌──────────────────────────────────────┐ │
│  │ Gemini 3 Pro 🌟 │  │  Multi-Modal Generation              │ │
│  │ - File Search   │  ├──────────────────────────────────────┤ │
│  │ - Text Gen      │  │ • Document: Gemini 3 Pro             │ │
│  │ - Code Gen      │  │ • PPT: Gemini 3 + Templates          │ │
│  │ - Multi-Modal   │  │ • Image: Imagen 3 🎨                 │ │
│  └─────────────────┘  │ • Audio: Google TTS / ElevenLabs     │ │
│                       │ • Video: FFmpeg + Gemini 3           │ │
│  ┌─────────────────┐  └──────────────────────────────────────┘ │
│  │ Railway 🚂      │                                           │
│  │ - PostgreSQL    │  ┌──────────────────────────────────────┐ │
│  │ - Redis Cache   │  │ Collaboration Infrastructure 🆕      │ │
│  │ - File Volumes  │  │ • WebSocket Server (Railway)         │ │
│  └─────────────────┘  │ • Redis Pub/Sub (消息广播)           │ │
│                       │ • Y.js CRDT Server                   │ │
│                       └──────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

### 4.2 核心模块详解

#### 4.2.1 RAG Engine (知识检索引擎)

**职责**:

- 索引本地文件 + 在线链接
- 语义搜索和上下文检索
- 动态知识库更新

**技术栈**:

```typescript
class RAGEngine {
  // 索引管理
  private geminiFileSearch: GeminiFileSearchService;
  private vectorStore: VectorStoreService;

  /**
   * 索引多种来源
   */
  async indexSources(sources: ContentSource[]) {
    for (const source of sources) {
      switch (source.type) {
        case "local_file":
          await this.indexLocalFile(source);
          break;
        case "url":
          await this.indexURL(source);
          break;
        case "cloud_storage":
          await this.indexCloudFile(source);
          break;
        case "code_repo":
          await this.indexCodeRepo(source);
          break;
      }
    }
  }

  /**
   * 智能检索：根据创作意图检索相关内容
   */
  async retrieve(intent: CreationIntent): Promise<Context> {
    // 1. 理解用户意图
    const expandedQuery = await this.expandQuery(intent);

    // 2. 多路检索
    const [
      semanticResults, // 语义相似
      keywordResults, // 关键词匹配
      timelineResults, // 时间线相关
    ] = await Promise.all([
      this.semanticSearch(expandedQuery),
      this.keywordSearch(intent.keywords),
      this.timelineSearch(intent.dateRange),
    ]);

    // 3. 融合排序
    const rankedResults = this.fuseAndRank([
      semanticResults,
      keywordResults,
      timelineResults,
    ]);

    // 4. 构建上下文
    return this.buildContext(rankedResults, intent);
  }
}
```

#### 4.2.2 Multi-Modal Generator (多模态生成器)

**职责**:

- 根据 RAG 上下文生成各种格式内容
- 支持流式生成和实时预览
- 模块化设计，易于扩展

**模块结构**:

```
MultiModalGenerator/
├── DocumentGenerator       # 文档生成
│   ├── MarkdownGenerator
│   ├── WordGenerator
│   └── PDFGenerator
├── PresentationGenerator   # PPT 生成
│   ├── OutlineGenerator
│   ├── SlideDesigner
│   └── ContentFiller
├── ImageGenerator          # 图像生成
│   ├── ChartGenerator      (数据可视化)
│   ├── DiagramGenerator    (流程图、架构图)
│   └── IllustrationGenerator (配图)
├── AudioGenerator          # 音频生成
│   ├── TTSEngine           (文本转语音)
│   ├── MusicGenerator      (背景音乐)
│   └── SoundEffects        (音效)
└── VideoGenerator          # 视频生成
    ├── ScriptWriter        (脚本生成)
    ├── StoryboardCreator   (分镜)
    ├── SceneComposer       (场景合成)
    └── VideoRenderer       (渲染)
```

**核心实现**:

```typescript
class MultiModalGenerator {
  /**
   * 统一生成接口
   */
  async generate(request: GenerationRequest): Promise<GenerationResult> {
    // 1. RAG 检索上下文
    const context = await this.ragEngine.retrieve(request.intent);

    // 2. 根据输出类型选择生成器
    const generator = this.getGenerator(request.outputType);

    // 3. 生成内容（支持流式）
    const content = await generator.generate({
      context,
      parameters: request.parameters,
      template: request.template,
    });

    // 4. 保存版本
    const version = await this.versionManager.createVersion({
      content,
      metadata: {
        sources: context.sources,
        prompt: request.intent,
        timestamp: new Date(),
      },
    });

    return {
      content,
      version,
      preview: this.generatePreview(content),
    };
  }
}

/**
 * PPT 生成器示例
 */
class PresentationGenerator extends BaseGenerator {
  async generate(config: GenerationConfig): Promise<Presentation> {
    // 1. 生成大纲
    const outline = await this.generateOutline(config.context);

    // 2. 为每页生成内容
    const slides = await Promise.all(
      outline.sections.map(async (section) => {
        const slideContent = await this.generateSlideContent({
          section,
          context: config.context,
          style: config.parameters.style,
        });

        // 生成配图
        const image = await this.imageGenerator.generate({
          prompt: slideContent.imagePrompt,
          style: config.parameters.imageStyle,
        });

        return {
          title: slideContent.title,
          content: slideContent.bullets,
          image,
          speakerNotes: slideContent.notes,
        };
      }),
    );

    // 3. 应用设计模板
    const presentation = await this.applyTemplate({
      slides,
      theme: config.parameters.theme,
      layout: config.parameters.layout,
    });

    return presentation;
  }

  private async generateOutline(context: Context): Promise<Outline> {
    const prompt = `
      Based on the following content, create a presentation outline:

      ${context.documents.map((d) => d.summary).join("\n\n")}

      Requirements:
      - 10-15 slides
      - Logical flow
      - Engaging structure
      - Clear sections

      Output format: JSON with sections and key points.
    `;

    const response = await this.llm.generate(prompt);
    return JSON.parse(response.text);
  }
}
```

#### 4.2.3 Version Control Engine (版本控制引擎)

**职责**:

- Git-style 版本管理
- 内容差异对比
- 分支管理和合并

**数据模型**:

```typescript
interface ContentVersion {
  id: string;
  projectId: string;
  parentVersionId?: string; // 父版本（构成版本树）
  versionNumber: string; // v1.0, v1.1, v2.0
  tag?: string; // draft, review, final

  content: {
    type: "document" | "presentation" | "video" | "image";
    data: any; // 实际内容
    metadata: {
      wordCount?: number;
      slideCount?: number;
      duration?: number; // 视频/音频时长
      fileSize: number;
    };
  };

  generation: {
    prompt: string; // 用户输入的创作意图
    sources: string[]; // 使用的 RAG 源
    model: string; // 使用的模型
    parameters: any; // 生成参数
  };

  diff?: {
    fromVersion: string;
    changes: Change[]; // 变更列表
  };

  createdAt: Date;
  createdBy: string;
}

interface Change {
  type: "add" | "modify" | "delete";
  path: string; // 例如: slides[2].content
  oldValue?: any;
  newValue?: any;
  semantic?: {
    summary: string; // AI 生成的语义摘要
    significance: "minor" | "major" | "breaking";
  };
}

interface VersionTree {
  root: ContentVersion;
  branches: {
    [branchName: string]: ContentVersion[];
  };
  tags: {
    [tagName: string]: string; // tag -> versionId
  };
}
```

**核心功能**:

```typescript
class VersionControlEngine {
  /**
   * 创建新版本
   */
  async createVersion(
    projectId: string,
    content: any,
    metadata: VersionMetadata,
  ): Promise<ContentVersion> {
    const parentVersion = await this.getLatestVersion(projectId);

    // 计算 diff
    const diff = parentVersion
      ? await this.computeDiff(parentVersion.content, content)
      : undefined;

    // 生成版本号
    const versionNumber = this.generateVersionNumber(
      parentVersion?.versionNumber,
      diff?.changes,
    );

    const version: ContentVersion = {
      id: uuid(),
      projectId,
      parentVersionId: parentVersion?.id,
      versionNumber,
      content: {
        type: metadata.type,
        data: content,
        metadata: this.computeMetadata(content, metadata.type),
      },
      generation: metadata.generation,
      diff,
      createdAt: new Date(),
      createdBy: metadata.userId,
    };

    await this.repo.save(version);
    return version;
  }

  /**
   * 计算语义 Diff
   */
  private async computeDiff(oldContent: any, newContent: any): Promise<Diff> {
    // 1. 结构化 Diff
    const structuralChanges = this.structuralDiff(oldContent, newContent);

    // 2. 语义 Diff（使用 LLM）
    const semanticChanges = await Promise.all(
      structuralChanges.map(async (change) => {
        const summary = await this.llm.generate(`
          Summarize this change in one sentence:
          Old: ${JSON.stringify(change.oldValue)}
          New: ${JSON.stringify(change.newValue)}
        `);

        return {
          ...change,
          semantic: {
            summary: summary.text,
            significance: this.assessSignificance(change),
          },
        };
      }),
    );

    return {
      fromVersion: oldContent.versionId,
      changes: semanticChanges,
    };
  }

  /**
   * 版本回滚
   */
  async rollback(
    projectId: string,
    targetVersionId: string,
  ): Promise<ContentVersion> {
    const targetVersion = await this.getVersion(targetVersionId);

    // 创建新版本（内容是目标版本的副本）
    return this.createVersion(projectId, targetVersion.content.data, {
      ...targetVersion.generation,
      tag: "rollback",
    });
  }

  /**
   * 分支合并
   */
  async merge(
    branchVersionId: string,
    targetBranchId: string,
  ): Promise<ContentVersion> {
    const branchVersion = await this.getVersion(branchVersionId);
    const targetVersion = await this.getLatestVersion(
      branchVersion.projectId,
      targetBranchId,
    );

    // AI 辅助合并冲突
    const mergedContent = await this.aiMerge(
      branchVersion.content,
      targetVersion.content,
    );

    return this.createVersion(branchVersion.projectId, mergedContent, {
      type: branchVersion.content.type,
      generation: {
        prompt: `Merge from ${branchVersionId}`,
        sources: [branchVersionId, targetVersion.id],
        model: "merge",
        parameters: {},
      },
      tag: "merged",
      userId: branchVersion.createdBy,
    });
  }
}
```

#### 4.2.4 Iteration Manager (迭代管理器)

**职责**:

- 管理内容的持续优化流程
- 收集用户反馈
- 智能建议改进方向

**核心流程**:

```typescript
class IterationManager {
  /**
   * 创建迭代任务
   */
  async createIteration(
    versionId: string,
    feedback: UserFeedback,
  ): Promise<Iteration> {
    const currentVersion = await this.versionEngine.getVersion(versionId);

    // 分析反馈，生成改进计划
    const improvementPlan = await this.analyzeFeedback(
      currentVersion,
      feedback,
    );

    // 创建迭代任务
    const iteration: Iteration = {
      id: uuid(),
      sourceVersionId: versionId,
      feedback,
      plan: improvementPlan,
      status: "pending",
      createdAt: new Date(),
    };

    await this.repo.save(iteration);
    return iteration;
  }

  /**
   * 执行迭代
   */
  async executeIteration(iterationId: string): Promise<ContentVersion> {
    const iteration = await this.getIteration(iterationId);
    const sourceVersion = await this.versionEngine.getVersion(
      iteration.sourceVersionId,
    );

    // 根据改进计划重新生成
    const improvedContent = await this.generator.generate({
      intent: {
        original: sourceVersion.generation.prompt,
        improvements: iteration.plan.actions,
      },
      context: await this.ragEngine.retrieve({
        ...sourceVersion.generation,
        refinement: iteration.plan,
      }),
      outputType: sourceVersion.content.type,
      parameters: {
        ...sourceVersion.generation.parameters,
        ...iteration.plan.parameterAdjustments,
      },
    });

    // 创建新版本
    const newVersion = await this.versionEngine.createVersion(
      sourceVersion.projectId,
      improvedContent.content,
      {
        type: sourceVersion.content.type,
        generation: {
          prompt: iteration.plan.refinedPrompt,
          sources: improvedContent.sources,
          model: improvedContent.model,
          parameters: improvedContent.parameters,
        },
        tag: `iteration-${iteration.id}`,
        userId: iteration.feedback.userId,
      },
    );

    // 更新迭代状态
    iteration.status = "completed";
    iteration.resultVersionId = newVersion.id;
    await this.repo.save(iteration);

    return newVersion;
  }

  /**
   * AI 分析反馈，生成改进计划
   */
  private async analyzeFeedback(
    version: ContentVersion,
    feedback: UserFeedback,
  ): Promise<ImprovementPlan> {
    const prompt = `
      Analyze the following user feedback and create an improvement plan:

      Current Content Type: ${version.content.type}
      User Feedback: ${feedback.text}
      Specific Issues: ${JSON.stringify(feedback.issues)}

      Generate:
      1. Refined prompt
      2. Specific actions to take
      3. Parameter adjustments
      4. Priority ranking

      Output as JSON.
    `;

    const response = await this.llm.generate(prompt);
    return JSON.parse(response.text);
  }

  /**
   * 智能建议：基于版本历史推荐改进
   */
  async suggestImprovements(versionId: string): Promise<Suggestion[]> {
    const version = await this.versionEngine.getVersion(versionId);
    const history = await this.versionEngine.getHistory(version.projectId);

    // 分析版本演化趋势
    const trends = this.analyzeTrends(history);

    // 生成建议
    const suggestions = await this.llm.generate(`
      Based on the version history and current content,
      suggest 3-5 improvements:

      Current Version: ${version.versionNumber}
      Content Type: ${version.content.type}
      Historical Trends: ${JSON.stringify(trends)}

      Focus on:
      - Content quality
      - Structure optimization
      - Visual appeal (if applicable)
      - Engagement factors
    `);

    return JSON.parse(suggestions.text);
  }
}
```

#### 4.2.5 Real-Time Collaboration Engine (实时协作引擎) 🆕

**职责**:

- 多人同时在线编辑同一内容
- 实时同步所有用户的修改
- 冲突自动解决
- 协作感知（显示在线用户、光标位置）

**核心技术**:

```typescript
/**
 * 实时协作架构
 *
 * 技术栈:
 * - Y.js: CRDT (Conflict-free Replicated Data Type) 核心库
 * - WebSocket: 实时通信
 * - Redis Pub/Sub: 多服务器消息广播
 * - Presence: 用户在线状态管理
 */

class CollaborationEngine {
  private ydoc: Y.Doc;
  private provider: WebsocketProvider;
  private awareness: Awareness;
  private presenceManager: PresenceManager;

  /**
   * 初始化协作会话
   */
  async initSession(projectId: string, userId: string): Promise<CollabSession> {
    // 1. 创建 Y.Doc (CRDT 文档)
    this.ydoc = new Y.Doc();

    // 2. 连接 WebSocket Provider
    this.provider = new WebsocketProvider(
      "wss://api.gens.team/collab",
      `project-${projectId}`,
      this.ydoc,
    );

    // 3. 初始化 Awareness (用户状态)
    this.awareness = this.provider.awareness;
    this.awareness.setLocalState({
      user: {
        id: userId,
        name: await this.getUserName(userId),
        color: this.generateUserColor(userId),
      },
      cursor: null,
      selection: null,
    });

    // 4. 监听远程变更
    this.ydoc.on("update", (update: Uint8Array) => {
      this.broadcastUpdate(projectId, update);
    });

    // 5. 监听用户状态变化
    this.awareness.on("change", ({ added, updated, removed }) => {
      this.handlePresenceChange(added, updated, removed);
    });

    return {
      ydoc: this.ydoc,
      provider: this.provider,
      awareness: this.awareness,
    };
  }

  /**
   * 实时编辑内容
   */
  async editContent(
    projectId: string,
    versionId: string,
    path: string,
    operation: EditOperation,
  ): Promise<void> {
    // 使用 Y.js 进行 CRDT 操作，自动解决冲突
    const ytext = this.ydoc.getText(path);

    switch (operation.type) {
      case "insert":
        ytext.insert(operation.position, operation.content);
        break;
      case "delete":
        ytext.delete(operation.position, operation.length);
        break;
      case "format":
        ytext.format(
          operation.position,
          operation.length,
          operation.attributes,
        );
        break;
    }

    // 变更会自动通过 WebSocket 广播给所有在线用户
  }

  /**
   * 实时光标同步
   */
  updateCursor(position: CursorPosition): void {
    this.awareness.setLocalStateField("cursor", {
      position,
      timestamp: Date.now(),
    });
  }

  /**
   * 添加评论（协作讨论）
   */
  async addComment(
    versionId: string,
    target: CommentTarget,
    content: string,
    userId: string,
  ): Promise<Comment> {
    const comment: Comment = {
      id: uuid(),
      versionId,
      target, // { type: 'text', path: 'slides[2].content', range: [10, 20] }
      content,
      authorId: userId,
      createdAt: new Date(),
      resolved: false,
      replies: [],
    };

    // 保存到数据库
    await this.commentRepo.save(comment);

    // 实时广播给所有在线用户
    await this.broadcastComment(versionId, comment);

    return comment;
  }

  /**
   * 冲突解决（CRDT 自动处理）
   */
  private handleConflict(
    localOp: Operation,
    remoteOp: Operation,
  ): ResolvedOperation {
    // Y.js CRDT 自动解决冲突，无需手动干预
    // 所有操作都是 commutative (可交换的)
    // 例如：用户 A 插入 "hello"，用户 B 同时插入 "world"
    // Y.js 会确保所有客户端最终看到相同的结果

    return {
      operation: localOp,
      resolved: true,
      strategy: "crdt-automatic",
    };
  }

  /**
   * 用户在线状态管理
   */
  private handlePresenceChange(
    added: number[],
    updated: number[],
    removed: number[],
  ): void {
    // 新用户加入
    added.forEach((clientId) => {
      const state = this.awareness.getStates().get(clientId);
      this.notifyUserJoined(state?.user);
    });

    // 用户离开
    removed.forEach((clientId) => {
      this.notifyUserLeft(clientId);
    });

    // 更新 UI 显示在线用户
    this.updateCollaboratorsList();
  }

  /**
   * 变更广播（跨服务器）
   */
  private async broadcastUpdate(
    projectId: string,
    update: Uint8Array,
  ): Promise<void> {
    // 使用 Redis Pub/Sub 在多个服务器实例间广播
    await this.redis.publish(
      `collab:${projectId}`,
      Buffer.from(update).toString("base64"),
    );
  }
}

/**
 * Presence Manager - 管理用户在线状态
 */
class PresenceManager {
  /**
   * 获取在线用户列表
   */
  async getOnlineUsers(projectId: string): Promise<OnlineUser[]> {
    const sessions = await this.redis.smembers(`online:${projectId}`);

    return Promise.all(
      sessions.map(async (sessionId) => {
        const data = await this.redis.get(`session:${sessionId}`);
        return JSON.parse(data);
      }),
    );
  }

  /**
   * 更新用户活动状态
   */
  async updateActivity(
    projectId: string,
    userId: string,
    activity: Activity,
  ): Promise<void> {
    const activityData = {
      type: activity.type, // 'editing', 'commenting', 'viewing'
      target: activity.target,
      timestamp: Date.now(),
    };

    // 保存活动日志
    await this.activityRepo.save({
      projectId,
      userId,
      ...activityData,
    });

    // 实时广播
    await this.redis.publish(
      `activity:${projectId}`,
      JSON.stringify({ userId, activity: activityData }),
    );
  }
}
```

**协作 UI 组件**:

```typescript
/**
 * 协作编辑器 UI
 */
const CollaborativeEditor = ({ projectId, versionId }: Props) => {
  const { ydoc, awareness } = useCollaboration(projectId);
  const onlineUsers = useOnlineUsers(awareness);

  return (
    <div className="collaborative-editor">
      {/* 在线用户列表 */}
      <div className="collaborators-bar">
        {onlineUsers.map(user => (
          <UserAvatar
            key={user.id}
            user={user}
            color={user.color}
            cursor={user.cursor}
          />
        ))}
      </div>

      {/* 编辑器 */}
      <TipTapEditor
        ydoc={ydoc}
        awareness={awareness}
        extensions={[
          Collaboration.configure({ document: ydoc }),
          CollaborationCursor.configure({ provider: awareness }),
        ]}
      />

      {/* 实时光标 */}
      <CursorOverlay awareness={awareness} />

      {/* 评论侧边栏 */}
      <CommentsSidebar versionId={versionId} />
    </div>
  );
};
```

**数据库 Schema (协作相关)**:

```sql
-- 协作会话
CREATE TABLE collaboration_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id),
  version_id UUID NOT NULL REFERENCES content_versions(id),
  user_id UUID NOT NULL REFERENCES users(id),
  joined_at TIMESTAMP DEFAULT NOW(),
  last_activity TIMESTAMP DEFAULT NOW(),
  cursor_position JSONB,
  status VARCHAR(50) DEFAULT 'active' -- active, idle, disconnected
);

-- 评论
CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  version_id UUID NOT NULL REFERENCES content_versions(id),
  parent_comment_id UUID REFERENCES comments(id), -- 用于回复
  author_id UUID NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  target JSONB NOT NULL, -- { type: 'text', path: '...', range: [...] }
  resolved BOOLEAN DEFAULT FALSE,
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 活动日志
CREATE TABLE collaboration_activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id),
  version_id UUID REFERENCES content_versions(id),
  user_id UUID NOT NULL REFERENCES users(id),
  activity_type VARCHAR(50) NOT NULL, -- edit, comment, view, export
  activity_data JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_sessions_project ON collaboration_sessions(project_id);
CREATE INDEX idx_sessions_user ON collaboration_sessions(user_id);
CREATE INDEX idx_comments_version ON comments(version_id);
CREATE INDEX idx_activities_project ON collaboration_activities(project_id);
CREATE INDEX idx_activities_user ON collaboration_activities(user_id);
```

**实时协作特性**:

1. ✅ **Google Docs 级别的实时编辑** - 多人同时编辑，零冲突
2. ✅ **实时光标** - 看到其他用户正在编辑的位置
3. ✅ **在线用户列表** - 显示所有在线协作者
4. ✅ **评论与讨论** - 针对具体内容进行线程化讨论
5. ✅ **活动历史** - 完整的协作历史记录
6. ✅ **权限控制** - 编辑、评论、查看权限分离
7. ✅ **离线支持** - 离线编辑，上线后自动同步

---

## 5. 工作流设计

### 5.1 主工作流：创建内容项目

```
┌─────────────────────────────────────────────────────────────┐
│  Step 1: 定义项目                                            │
├─────────────────────────────────────────────────────────────┤
│  • 项目名称："Q4 市场报告"                                   │
│  • 输出类型：文档 + PPT                                       │
│  • 目标受众：高管团队                                         │
│  • 预期长度：30 页文档 + 15 页 PPT                            │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│  Step 2: 添加知识源                                          │
├─────────────────────────────────────────────────────────────┤
│  ☑ 本地文件：                                                │
│    - market_data_2024.pdf                                   │
│    - competitor_analysis.docx                               │
│  ☑ Collections：                                            │
│    - "市场研究" Collection (23 items)                        │
│  ☑ 在线链接：                                                │
│    - https://statista.com/ai-market-2024                    │
│    - https://gartner.com/reports/ai-trends                  │
│  ☑ 云存储：                                                  │
│    - Google Drive: /Reports/2024/                           │
│                                                             │
│  → AI 自动索引（预计 2 分钟）                                │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│  Step 3: 描述创作意图                                         │
├─────────────────────────────────────────────────────────────┤
│  💬 输入框：                                                 │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 生成一份面向高管的 AI 市场报告，包含：              │    │
│  │ 1. 市场规模和增长预测                               │    │
│  │ 2. 主要竞争对手分析                                 │    │
│  │ 3. 技术趋势（重点关注 LLM）                         │    │
│  │ 4. 投资建议                                         │    │
│  │                                                     │    │
│  │ 风格：商务专业，数据驱动                            │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  📊 高级参数（可选）：                                       │
│    • 语气：正式 / 友好 / 技术                                │
│    • 详细程度：简洁 / 中等 / 详尽                            │
│    • 引用风格：IEEE / APA / 内联                             │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│  Step 4: AI 生成初稿                                         │
├─────────────────────────────────────────────────────────────┤
│  🤖 AI 工作中...                                             │
│                                                             │
│  ✓ 分析知识源（35 个文档）                                   │
│  ✓ 提取关键数据点（127 个）                                  │
│  ✓ 生成文档大纲（5 个章节）                                  │
│  ✓ 填充内容（进度 60%）                                      │
│  ⏳ 生成图表（3/8 完成）                                     │
│  ⏳ 生成 PPT（等待文档完成）                                 │
│                                                             │
│  预计完成时间：3 分钟                                        │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│  Step 5: 审核和编辑                                          │
├─────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────┐  │
│  │  📄 文档预览                    🎨 编辑工具栏        │  │
│  ├───────────────────────────────────────────────────────┤  │
│  │  第 1 章: 执行摘要              [💬 评论] [✏️ 编辑] │  │
│  │  ───────────────────────────                        │  │
│  │  AI 市场在 2024 年达到...       [🔁 重新生成]       │  │
│  │                                                       │  │
│  │  第 2 章: 市场规模              [📊 更新图表]       │  │
│  │  ───────────────────────────                        │  │
│  │  [图表: 市场增长趋势]           ⚠️ 数据需要更新      │  │
│  │                                                       │  │
│  │  第 3 章: 竞争格局              [✅ 看起来不错]      │  │
│  │  ...                                                  │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  💡 AI 建议：                                                │
│    • 第 2 章图表数据来源不一致，建议统一                      │
│    • 第 4 章可以增加案例研究                                 │
│    • PPT 第 7 页信息过载，建议拆分                           │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│  Step 6: 迭代优化                                            │
├─────────────────────────────────────────────────────────────┤
│  用户操作：                                                  │
│  1. 修改第 2 章标题                                          │
│  2. 点击"重新生成"第 2 章图表                                │
│  3. 添加评论："需要增加竞品对比表"                            │
│                                                             │
│  → AI 自动执行：                                             │
│    ✓ 应用标题修改                                            │
│    ✓ 使用最新数据重新生成图表                                │
│    ✓ 在第 3 章插入竞品对比表                                 │
│    ✓ 创建新版本 v1.1                                         │
│                                                             │
│  版本对比：                                                  │
│  ┌─────────────────┬─────────────────┐                      │
│  │  v1.0 (初稿)    │  v1.1 (当前)    │                      │
│  ├─────────────────┼─────────────────┤                      │
│  │ 30 页           │ 32 页 (+2)      │                      │
│  │ 8 图表          │ 10 图表 (+2)    │                      │
│  │ 3 处反馈        │ 0 处待解决      │                      │
│  └─────────────────┴─────────────────┘                      │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│  Step 7: 导出和分享                                          │
├─────────────────────────────────────────────────────────────┤
│  📦 导出选项：                                               │
│                                                             │
│  文档格式：                                                  │
│  ☑ PDF (高分辨率)                                           │
│  ☑ DOCX (可编辑)                                            │
│  ☐ Markdown                                                 │
│                                                             │
│  PPT 格式：                                                  │
│  ☑ PPTX (PowerPoint)                                        │
│  ☑ PDF (打印版)                                             │
│  ☐ 在线链接（可分享）                                        │
│                                                             │
│  附加内容：                                                  │
│  ☑ 演讲稿（逐页）                                            │
│  ☑ 数据源列表                                                │
│  ☐ 版本历史                                                  │
│                                                             │
│  [💾 下载全部] [📧 发送邮件] [🔗 生成分享链接]             │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 迭代优化子流程

```
用户反馈 → AI 分析 → 生成改进计划 → 执行优化 → 新版本
    ↑                                              │
    └──────────────────────────────────────────────┘
                   (循环迭代)
```

**示例：PPT 页面优化**

```
用户: "第 5 页信息太多，不够吸引人"
  │
  ↓
AI 分析:
  - 识别问题：内容过载
  - 建议方案：
    1. 拆分为 2 页
    2. 增加视觉元素
    3. 简化文字
  │
  ↓
用户选择方案 1
  │
  ↓
AI 执行:
  - 将第 5 页拆分为 5a 和 5b
  - 5a: 核心观点 + 图表
  - 5b: 详细数据 + 引用
  - 调整后续页码
  │
  ↓
生成新版本 v1.2
  - Diff: 页数 15 → 16
  - Change: Slide 5 split into 5a, 5b
```

---

## 6. 版本管理系统

### 6.1 版本树可视化

```
Project: "Q4 Market Report"

v1.0 (初稿)
 │
 ├─ v1.1 (更新图表)
 │   │
 │   ├─ v1.2 (增加案例)
 │   │   │
 │   │   └─ v2.0 (重大改版) ← [final] tag
 │   │
 │   └─ v1.1.1-experimental (实验分支)
 │
 └─ v1.0.1-review (审核版)
     │
     └─ v1.0.2 (修正错别字)
```

### 6.2 版本对比界面

```
┌─────────────────────────────────────────────────────────────┐
│  版本对比: v1.0 vs v2.0                                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  📊 总览                                                     │
│  ┌───────────────┬──────────┬──────────┬─────────────────┐  │
│  │ 指标          │ v1.0     │ v2.0     │ 变化            │  │
│  ├───────────────┼──────────┼──────────┼─────────────────┤  │
│  │ 页数          │ 30       │ 35       │ +5 (16.7%)      │  │
│  │ 图表数        │ 8        │ 12       │ +4              │  │
│  │ 引用来源      │ 15       │ 23       │ +8              │  │
│  │ 字数          │ 8,500    │ 10,200   │ +1,700          │  │
│  └───────────────┴──────────┴──────────┴─────────────────┘  │
│                                                             │
│  📝 主要变更 (23 处)                                         │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ ✅ 新增: 第 2.3 节"新兴技术趋势"                    │    │
│  │    • 5 页新内容                                     │    │
│  │    • 3 个新图表                                     │    │
│  │    • 8 个新引用                                     │    │
│  │                                                     │    │
│  │ ✏️ 修改: 第 4 章"竞争分析"                          │    │
│  │    • 更新竞品对比表                                 │    │
│  │    • 增加市场份额饼图                               │    │
│  │                                                     │    │
│  │ 🎨 优化: 整体视觉风格                               │    │
│  │    • 统一配色方案                                   │    │
│  │    • 优化图表样式                                   │    │
│  │                                                     │    │
│  │ 🔧 修正: 3 处数据错误                               │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  💬 语义差异（AI 分析）                                      │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 整体方向：                                           │    │
│  │ v1.0 侧重历史数据和现状分析                         │    │
│  │ v2.0 增加了未来趋势预测和战略建议                   │    │
│  │                                                     │    │
│  │ 关键洞察：                                           │    │
│  │ • v2.0 对 LLM 市场的关注度提升 40%                  │    │
│  │ • 新增 5 个竞品的深度分析                           │    │
│  │ • 投资建议更加具体和可执行                         │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  [👁️ 逐页对比] [📥 导出对比报告] [🔙 回滚到 v1.0]      │
└─────────────────────────────────────────────────────────────┘
```

### 6.3 分支管理

**使用场景**:

```
主线（main）：
  v1.0 → v1.1 → v1.2 → v2.0 → v2.1

实验分支（experiment/video-version）：
  v2.0 → v2.0-video-draft → v2.0-video-final
         ↓
      生成视频版本的报告

审核分支（review/executive）：
  v2.0 → v2.0-exec-review → v2.0-exec-feedback
         ↓
      高管审核专用版本
```

---

## 7. 多模态输出引擎

### 7.1 文档生成引擎

**支持格式**: Markdown → DOCX → PDF

**核心能力**:

```typescript
interface DocumentGenerationConfig {
  structure: {
    sections: Section[]; // 章节结构
    tableOfContents: boolean;
    pageNumbers: boolean;
    headerFooter: boolean;
  };

  style: {
    template: "professional" | "academic" | "casual";
    fontFamily: string;
    fontSize: number;
    colorScheme: ColorScheme;
  };

  content: {
    citations: "inline" | "footnotes" | "endnotes";
    bibliography: boolean;
    glossary: boolean;
    index: boolean;
  };

  images: {
    autoGenerate: boolean; // 自动生成配图
    style: "illustration" | "diagram" | "chart";
    placement: "inline" | "float";
  };
}

class DocumentGenerator {
  async generate(
    context: RAGContext,
    config: DocumentGenerationConfig,
  ): Promise<Document> {
    // 1. 生成内容
    const content = await this.generateContent(context, config);

    // 2. 生成图表和配图
    const visualElements = await this.generateVisuals(content, config);

    // 3. 排版
    const formatted = await this.formatDocument({
      content,
      visuals: visualElements,
      style: config.style,
    });

    // 4. 生成多种格式
    const outputs = await Promise.all([
      this.toMarkdown(formatted),
      this.toDocx(formatted),
      this.toPDF(formatted),
    ]);

    return {
      content: formatted,
      outputs,
    };
  }

  private async generateVisuals(
    content: Content,
    config: DocumentGenerationConfig,
  ): Promise<VisualElement[]> {
    const visuals: VisualElement[] = [];

    // 识别需要可视化的内容
    const visualizationOpportunities = this.identifyVisualizationNeeds(content);

    for (const opportunity of visualizationOpportunities) {
      switch (opportunity.type) {
        case "data":
          // 数据可视化
          const chart = await this.chartGenerator.generate({
            data: opportunity.data,
            chartType: opportunity.recommendedChartType,
            style: config.style,
          });
          visuals.push(chart);
          break;

        case "concept":
          // 概念图/流程图
          const diagram = await this.diagramGenerator.generate({
            concepts: opportunity.concepts,
            relationships: opportunity.relationships,
          });
          visuals.push(diagram);
          break;

        case "illustration":
          // AI 生成配图
          const image = await this.imageGenerator.generate({
            prompt: opportunity.description,
            style: config.images.style,
          });
          visuals.push(image);
          break;
      }
    }

    return visuals;
  }
}
```

### 7.2 PPT 生成引擎

**核心流程**:

```
RAG Context → 大纲生成 → 内容填充 → 设计应用 → 导出
```

**详细实现**:

```typescript
class PresentationGenerator {
  /**
   * 生成演示文稿
   */
  async generate(
    context: RAGContext,
    config: PresentationConfig,
  ): Promise<Presentation> {
    // 1. 生成大纲
    const outline = await this.generateOutline(context, config);

    // 2. 为每页生成内容
    const slides = await this.generateSlides(outline, context);

    // 3. 应用设计主题
    const styled = await this.applyTheme(slides, config.theme);

    // 4. 生成演讲稿
    const speakerNotes = await this.generateSpeakerNotes(styled);

    // 5. 导出
    return {
      slides: styled,
      speakerNotes,
      formats: await this.export(styled),
    };
  }

  /**
   * 智能生成 PPT 大纲
   */
  private async generateOutline(
    context: RAGContext,
    config: PresentationConfig,
  ): Promise<Outline> {
    const prompt = `
      Create a presentation outline with ${config.targetSlides} slides.

      Topic: ${config.topic}
      Audience: ${config.audience}
      Duration: ${config.duration} minutes

      Content Sources:
      ${context.documents.map((d) => `- ${d.title}: ${d.summary}`).join("\n")}

      Requirements:
      - Clear narrative flow
      - Balance between depth and engagement
      - Include data visualizations where applicable
      - Leave room for Q&A

      Output format:
      {
        "title": "Presentation Title",
        "sections": [
          {
            "name": "Section Name",
            "slides": [
              {
                "title": "Slide Title",
                "type": "title | content | data | image | conclusion",
                "keyPoints": ["point1", "point2"],
                "visualType": "chart | diagram | image | none"
              }
            ]
          }
        ]
      }
    `;

    const response = await this.llm.generate(prompt);
    return JSON.parse(response.text);
  }

  /**
   * 生成单页内容
   */
  private async generateSlideContent(
    slideOutline: SlideOutline,
    context: RAGContext,
  ): Promise<Slide> {
    // 1. 生成文字内容
    const textContent = await this.generateText(slideOutline, context);

    // 2. 生成视觉元素
    let visual: VisualElement | null = null;
    if (slideOutline.visualType !== "none") {
      visual = await this.generateVisual(
        slideOutline.visualType,
        textContent,
        context,
      );
    }

    // 3. 生成演讲稿
    const speakerNotes = await this.generateNotes(textContent, visual);

    return {
      title: slideOutline.title,
      content: textContent,
      visual,
      speakerNotes,
      layout: this.selectLayout(slideOutline.type),
    };
  }

  /**
   * 生成数据可视化
   */
  private async generateVisual(
    type: VisualType,
    content: TextContent,
    context: RAGContext,
  ): Promise<VisualElement> {
    switch (type) {
      case "chart":
        // 提取数据，生成图表
        const data = await this.extractData(content, context);
        return this.chartGenerator.generate({
          data,
          chartType: this.selectChartType(data),
          theme: this.currentTheme,
        });

      case "diagram":
        // 生成流程图/架构图
        return this.diagramGenerator.generate({
          content,
          style: "professional",
        });

      case "image":
        // AI 生成配图
        return this.imageGenerator.generate({
          prompt: `Professional illustration for: ${content.summary}`,
          style: "corporate",
          aspectRatio: "16:9",
        });
    }
  }

  /**
   * 应用设计主题
   */
  private async applyTheme(
    slides: Slide[],
    theme: PresentationTheme,
  ): Promise<Slide[]> {
    return slides.map((slide) => ({
      ...slide,
      style: {
        background: theme.background,
        textColor: theme.textColor,
        accentColor: theme.accentColor,
        fontFamily: theme.fontFamily,
      },
      visual: slide.visual ? this.styleVisual(slide.visual, theme) : null,
    }));
  }
}
```

**主题系统**:

```typescript
interface PresentationTheme {
  name: string;
  background: {
    type: "solid" | "gradient" | "image";
    colors: string[];
    image?: string;
  };
  textColor: {
    primary: string;
    secondary: string;
    accent: string;
  };
  fontFamily: {
    heading: string;
    body: string;
  };
  layout: {
    margins: number;
    spacing: number;
  };
  charts: {
    colorPalette: string[];
    style: "flat" | "3d" | "minimal";
  };
}

const BUILTIN_THEMES: Record<string, PresentationTheme> = {
  professional: {
    name: "Professional",
    background: {
      type: "solid",
      colors: ["#FFFFFF"],
    },
    textColor: {
      primary: "#2C3E50",
      secondary: "#7F8C8D",
      accent: "#3498DB",
    },
    fontFamily: {
      heading: "Helvetica Neue",
      body: "Arial",
    },
    charts: {
      colorPalette: ["#3498DB", "#E74C3C", "#2ECC71", "#F39C12"],
      style: "flat",
    },
  },

  tech: {
    name: "Tech",
    background: {
      type: "gradient",
      colors: ["#1E3A8A", "#3B82F6"],
    },
    textColor: {
      primary: "#FFFFFF",
      secondary: "#E0E7FF",
      accent: "#FBBF24",
    },
    fontFamily: {
      heading: "Inter",
      body: "Roboto",
    },
    charts: {
      colorPalette: ["#60A5FA", "#34D399", "#FBBF24", "#F87171"],
      style: "minimal",
    },
  },

  creative: {
    name: "Creative",
    background: {
      type: "gradient",
      colors: ["#FFF1EB", "#ACE0F9"],
    },
    textColor: {
      primary: "#1F2937",
      secondary: "#6B7280",
      accent: "#EC4899",
    },
    fontFamily: {
      heading: "Montserrat",
      body: "Open Sans",
    },
    charts: {
      colorPalette: ["#EC4899", "#8B5CF6", "#10B981", "#F59E0B"],
      style: "3d",
    },
  },
};
```

### 7.3 视频生成引擎

**核心流程**:

```
脚本生成 → 分镜设计 → 场景合成 → 音频生成 → 视频渲染
```

**实现**:

```typescript
class VideoGenerator {
  async generate(context: RAGContext, config: VideoConfig): Promise<Video> {
    // 1. 生成视频脚本
    const script = await this.generateScript(context, config);

    // 2. 创建分镜
    const storyboard = await this.createStoryboard(script);

    // 3. 为每个场景生成视觉内容
    const scenes = await this.generateScenes(storyboard);

    // 4. 生成音频（旁白 + 音乐 + 音效）
    const audio = await this.generateAudio(script, config);

    // 5. 合成视频
    const video = await this.composeVideo({
      scenes,
      audio,
      transitions: config.transitions,
      effects: config.effects,
    });

    return video;
  }

  /**
   * 生成视频脚本
   */
  private async generateScript(
    context: RAGContext,
    config: VideoConfig,
  ): Promise<VideoScript> {
    const prompt = `
      Create a video script for a ${config.duration}-minute video.

      Topic: ${config.topic}
      Target Audience: ${config.audience}
      Style: ${config.style} // educational, promotional, documentary

      Content Sources:
      ${context.documents.map((d) => d.summary).join("\n\n")}

      Structure:
      - Hook (0-15s): Grab attention
      - Introduction (15-45s): Set context
      - Main Content (bulk): 3-5 key points
      - Conclusion (final 30s): Call to action

      For each scene, specify:
      - Timestamp
      - Narration text
      - Visual description
      - On-screen text (if any)
      - Transition type

      Output as JSON.
    `;

    const response = await this.llm.generate(prompt);
    return JSON.parse(response.text);
  }

  /**
   * 为每个场景生成视觉内容
   */
  private async generateScenes(storyboard: Storyboard): Promise<Scene[]> {
    return await Promise.all(
      storyboard.scenes.map(async (sceneDesc) => {
        // 决定视觉类型
        const visualType = this.determineVisualType(sceneDesc);

        let visual: VisualContent;
        switch (visualType) {
          case "static_image":
            visual = await this.imageGenerator.generate({
              prompt: sceneDesc.visualDescription,
              style: this.config.imageStyle,
              aspectRatio: "16:9",
            });
            break;

          case "animation":
            visual = await this.animationGenerator.generate({
              description: sceneDesc.visualDescription,
              duration: sceneDesc.duration,
            });
            break;

          case "screen_recording":
            // 代码演示等
            visual = await this.screenRecorder.record({
              script: sceneDesc.actions,
              duration: sceneDesc.duration,
            });
            break;

          case "text_overlay":
            visual = this.textOverlayGenerator.generate({
              text: sceneDesc.onScreenText,
              style: this.config.textStyle,
            });
            break;
        }

        return {
          timestamp: sceneDesc.timestamp,
          duration: sceneDesc.duration,
          visual,
          transition: sceneDesc.transition,
        };
      }),
    );
  }

  /**
   * 生成音频（旁白 + 背景音乐 + 音效）
   */
  private async generateAudio(
    script: VideoScript,
    config: VideoConfig,
  ): Promise<AudioTrack> {
    // 1. 生成旁白
    const narration = await this.ttsEngine.synthesize({
      text: script.narration,
      voice: config.voice || "professional-male",
      speed: config.narrationSpeed || 1.0,
    });

    // 2. 选择背景音乐
    const backgroundMusic = await this.musicLibrary.select({
      mood: config.musicMood || "upbeat",
      duration: script.totalDuration,
      genre: config.musicGenre,
    });

    // 3. 添加音效
    const soundEffects = await this.addSoundEffects(script.scenes);

    // 4. 混音
    return this.audioMixer.mix({
      narration,
      backgroundMusic: {
        audio: backgroundMusic,
        volume: 0.3, // 30% 音量
      },
      soundEffects,
    });
  }

  /**
   * 合成最终视频
   */
  private async composeVideo(composition: VideoComposition): Promise<Video> {
    // 使用 FFmpeg 合成
    const outputPath = `/tmp/video_${uuid()}.mp4`;

    await ffmpeg()
      .input(composition.scenes)
      .input(composition.audio)
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions(["-pix_fmt yuv420p", "-preset medium", "-crf 23"])
      .output(outputPath)
      .run();

    // 生成字幕
    const subtitles = await this.generateSubtitles(composition.audio.narration);

    return {
      videoPath: outputPath,
      subtitles,
      metadata: {
        duration: composition.totalDuration,
        resolution: "1920x1080",
        fps: 30,
        fileSize: await this.getFileSize(outputPath),
      },
    };
  }
}
```

---

## 8. 技术实现方案

### 8.1 技术栈选型

#### 后端技术栈

| 层次           | 技术选型                  | 理由                       | 部署位置        |
| -------------- | ------------------------- | -------------------------- | --------------- |
| **框架**       | NestJS                    | 模块化、TypeScript、企业级 | Railway         |
| **数据库**     | PostgreSQL                | 关系型数据 + JSONB 支持    | Railway         |
| **向量数据库** | Gemini File Search (托管) | 零运维、高性能             | Google API 调用 |
| **文件存储**   | Railway Volumes           | 大文件存储                 | Railway         |
| **队列**       | Bull (Redis)              | 异步任务处理               | Railway         |
| **缓存**       | Redis                     | 会话、查询缓存             | Railway         |
| **搜索**       | Algolia / PostgreSQL FTS  | 元数据搜索                 | API / Railway   |

#### 前端技术栈

| 层次           | 技术选型                 | 理由             |
| -------------- | ------------------------ | ---------------- |
| **框架**       | Next.js 14               | SSR、路由、性能  |
| **状态管理**   | Zustand + TanStack Query | 轻量、响应式     |
| **UI 组件**    | Tailwind + Shadcn/ui     | 快速开发、可定制 |
| **富文本编辑** | TipTap / Lexical         | 现代、可扩展     |
| **图表**       | Recharts + D3.js         | 声明式 + 灵活性  |
| **视频播放**   | Video.js                 | 跨浏览器兼容     |

#### AI 服务集成

| 服务                   | 用途                                | API          | 优势                   |
| ---------------------- | ----------------------------------- | ------------ | ---------------------- |
| **Gemini 3** 🌟        | RAG、文本生成、代码理解、多模态分析 | Gemini 3 Pro | 超长上下文、多模态能力 |
| **Imagen 3** 🆕        | 专业级图像生成、配图、可视化        | Imagen 3 API | 高质量、精准提示词理解 |
| **ElevenLabs**         | 高质量 TTS、多语言配音              | ElevenLabs   | 自然语音               |
| **FFmpeg**             | 视频处理、合成、编码                | 本地/云端    | 功能全面               |
| **Gemini File Search** | 托管 RAG 服务                       | Gemini API   | 零运维、高性能         |

### 8.2 数据库 Schema

#### 核心表结构

```sql
-- 项目表
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  output_type VARCHAR(50) NOT NULL, -- document, presentation, video, etc.
  status VARCHAR(50) DEFAULT 'draft', -- draft, in_progress, completed
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 知识源表
CREATE TABLE knowledge_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL, -- local_file, url, collection, cloud_storage
  source_uri TEXT NOT NULL,
  metadata JSONB, -- 文件元数据
  indexed_at TIMESTAMP,
  status VARCHAR(50) DEFAULT 'pending', -- pending, indexing, indexed, error
  created_at TIMESTAMP DEFAULT NOW()
);

-- Gemini File Search Store 映射
CREATE TABLE file_search_stores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  gemini_store_id VARCHAR(255) NOT NULL UNIQUE,
  file_count INTEGER DEFAULT 0,
  total_tokens BIGINT DEFAULT 0,
  status VARCHAR(50) DEFAULT 'indexing',
  indexed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 内容版本表
CREATE TABLE content_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_version_id UUID REFERENCES content_versions(id),
  version_number VARCHAR(50) NOT NULL, -- v1.0, v1.1, v2.0
  tag VARCHAR(100), -- draft, review, final

  -- 内容数据
  content_type VARCHAR(50) NOT NULL,
  content_data JSONB NOT NULL,
  content_metadata JSONB,

  -- 生成信息
  generation_prompt TEXT NOT NULL,
  generation_sources TEXT[], -- 使用的源文件 IDs
  generation_model VARCHAR(100),
  generation_parameters JSONB,

  -- 差异信息
  diff_from_version UUID REFERENCES content_versions(id),
  diff_changes JSONB,

  created_at TIMESTAMP DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

-- 版本分支
CREATE TABLE version_branches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  branch_name VARCHAR(100) NOT NULL,
  base_version_id UUID NOT NULL REFERENCES content_versions(id),
  head_version_id UUID REFERENCES content_versions(id),
  status VARCHAR(50) DEFAULT 'active', -- active, merged, closed
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(project_id, branch_name)
);

-- 迭代任务
CREATE TABLE iterations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_version_id UUID NOT NULL REFERENCES content_versions(id),
  result_version_id UUID REFERENCES content_versions(id),

  feedback TEXT NOT NULL, -- 用户反馈
  feedback_type VARCHAR(50), -- general, specific, data_error
  feedback_metadata JSONB,

  improvement_plan JSONB, -- AI 生成的改进计划

  status VARCHAR(50) DEFAULT 'pending', -- pending, executing, completed, failed

  created_at TIMESTAMP DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  completed_at TIMESTAMP
);

-- 导出历史
CREATE TABLE exports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  version_id UUID NOT NULL REFERENCES content_versions(id),
  format VARCHAR(50) NOT NULL, -- pdf, docx, pptx, mp4
  file_path TEXT NOT NULL,
  file_size BIGINT,
  export_config JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

-- 索引
CREATE INDEX idx_projects_user ON projects(user_id);
CREATE INDEX idx_versions_project ON content_versions(project_id);
CREATE INDEX idx_versions_parent ON content_versions(parent_version_id);
CREATE INDEX idx_sources_project ON knowledge_sources(project_id);
CREATE INDEX idx_iterations_project ON iterations(project_id);
CREATE INDEX idx_iterations_status ON iterations(status);
```

### 8.3 API 接口设计

#### Projects API

```typescript
// 创建项目
POST /api/v1/ai-office/projects
{
  "name": "Q4 Market Report",
  "description": "AI market analysis for executives",
  "outputType": "document+presentation",
  "config": {
    "documentPages": 30,
    "presentationSlides": 15
  }
}

// 添加知识源
POST /api/v1/ai-office/projects/:projectId/sources
{
  "sources": [
    {
      "type": "local_file",
      "fileId": "resource_123"
    },
    {
      "type": "collection",
      "collectionId": "collection_456"
    },
    {
      "type": "url",
      "url": "https://example.com/report.pdf"
    },
    {
      "type": "cloud_storage",
      "provider": "google_drive",
      "path": "/Reports/2024/"
    }
  ]
}

// 索引知识源
POST /api/v1/ai-office/projects/:projectId/index
{
  "forceReindex": false
}

// 生成内容
POST /api/v1/ai-office/projects/:projectId/generate
{
  "intent": "Create an executive summary focusing on market size and growth predictions",
  "outputType": "document",
  "parameters": {
    "template": "professional",
    "style": "formal",
    "length": "medium"
  }
}

// 获取项目详情
GET /api/v1/ai-office/projects/:projectId

// 列出所有版本
GET /api/v1/ai-office/projects/:projectId/versions

// 获取特定版本
GET /api/v1/ai-office/projects/:projectId/versions/:versionId

// 版本对比
GET /api/v1/ai-office/projects/:projectId/versions/compare?from=v1.0&to=v2.0

// 回滚版本
POST /api/v1/ai-office/projects/:projectId/versions/:versionId/rollback

// 创建迭代任务
POST /api/v1/ai-office/projects/:projectId/iterations
{
  "versionId": "version_123",
  "feedback": "第2章的数据需要更新，图表不够清晰",
  "feedbackType": "data_error"
}

// 执行迭代
POST /api/v1/ai-office/iterations/:iterationId/execute

// 导出
POST /api/v1/ai-office/versions/:versionId/export
{
  "formats": ["pdf", "docx"],
  "config": {
    "includeMetadata": true,
    "includeReferences": true
  }
}
```

---

## 9. 数据模型设计

### 9.1 领域模型

```typescript
// 项目聚合根
class Project {
  id: string;
  name: string;
  owner: User;
  outputType: OutputType;

  knowledgeSources: KnowledgeSource[];
  versions: VersionTree;
  iterations: Iteration[];

  // 领域方法
  addSource(source: KnowledgeSource): void;
  generateContent(
    intent: string,
    config: GenerationConfig,
  ): Promise<ContentVersion>;
  createIteration(feedback: Feedback): Promise<Iteration>;
  export(versionId: string, formats: ExportFormat[]): Promise<Export[]>;
}

// 知识源
class KnowledgeSource {
  id: string;
  type: SourceType; // local_file, url, collection, cloud_storage
  uri: string;
  metadata: SourceMetadata;
  indexStatus: IndexStatus;

  async index(): Promise<void>;
  async reindex(): Promise<void>;
  async remove(): Promise<void>;
}

// 版本树
class VersionTree {
  root: ContentVersion;
  branches: Map<string, ContentVersion[]>;
  tags: Map<string, ContentVersion>;

  createVersion(content: any, metadata: VersionMetadata): ContentVersion;
  getBranch(name: string): ContentVersion[];
  createBranch(name: string, baseVersion: ContentVersion): void;
  merge(sourceBranch: string, targetBranch: string): ContentVersion;
  diff(v1: ContentVersion, v2: ContentVersion): Diff;
}

// 内容版本
class ContentVersion {
  id: string;
  parent?: ContentVersion;
  versionNumber: string;

  content: Content;
  generation: GenerationMetadata;
  diff?: Diff;

  rollback(): ContentVersion;
  fork(branchName: string): ContentVersion;
}

// 迭代
class Iteration {
  id: string;
  sourceVersion: ContentVersion;
  feedback: Feedback;
  improvementPlan: ImprovementPlan;
  status: IterationStatus;

  async execute(): Promise<ContentVersion>;
  async analyze(): Promise<ImprovementPlan>;
}
```

### 9.2 值对象

```typescript
// 内容
interface Content {
  type: ContentType; // document, presentation, video, image
  data: any;
  metadata: ContentMetadata;
}

// 生成元数据
interface GenerationMetadata {
  prompt: string;
  sources: string[]; // source IDs
  model: string;
  parameters: GenerationParameters;
  timestamp: Date;
}

// 差异
interface Diff {
  fromVersion: string;
  toVersion: string;
  changes: Change[];
  semanticSummary: string; // AI 生成的语义摘要
}

interface Change {
  type: "add" | "modify" | "delete";
  path: string;
  oldValue?: any;
  newValue?: any;
  significance: "minor" | "major" | "breaking";
}

// 反馈
interface Feedback {
  type: FeedbackType;
  text: string;
  specifics?: {
    section?: string;
    page?: number;
    timestamp?: number; // for video
  };
  attachments?: Attachment[];
}

// 改进计划
interface ImprovementPlan {
  refinedPrompt: string;
  actions: Action[];
  parameterAdjustments: Record<string, any>;
  estimatedImpact: "low" | "medium" | "high";
}
```

---

## 10. 实施路线图

### Phase 1: 基础设施 (4 weeks)

**Week 1-2: 核心架构**

- [ ] NestJS 模块搭建
- [ ] 数据库 Schema 设计和迁移
- [ ] Gemini File Search 集成
- [ ] 文件上传和存储

**Week 3-4: RAG 引擎**

- [ ] 多源索引实现
- [ ] 语义检索功能
- [ ] 上下文构建器
- [ ] 基础 API 端点

**交付物**:

- ✅ 可以索引本地文件 + Collections
- ✅ 基础 RAG 问答功能

### Phase 2: 文档生成 (4 weeks)

**Week 5-6: 文档生成器**

- [ ] Markdown 生成
- [ ] DOCX 导出
- [ ] PDF 渲染
- [ ] 图表生成

**Week 7-8: 版本管理**

- [ ] Git-style 版本控制
- [ ] Diff 对比
- [ ] 分支管理
- [ ] 版本 UI

**交付物**:

- ✅ 完整的文档生成流程
- ✅ 版本管理系统

### Phase 3: PPT 生成 (4 weeks)

**Week 9-10: PPT 引擎**

- [ ] 大纲生成算法
- [ ] 内容填充
- [ ] 主题系统
- [ ] PPTX 导出

**Week 11-12: 视觉增强**

- [ ] 图表自动生成
- [ ] AI 配图
- [ ] 演讲稿生成
- [ ] 预览功能

**交付物**:

- ✅ 完整的 PPT 生成功能
- ✅ 多种设计主题

### Phase 4: 多模态扩展 (6 weeks)

**Week 13-14: 图像生成**

- [ ] DALL-E 3 集成
- [ ] 数据可视化增强
- [ ] 图表库扩展

**Week 15-16: 音频生成**

- [ ] TTS 引擎集成
- [ ] 背景音乐库
- [ ] 音频编辑工具

**Week 17-18: 视频生成 (MVP)**

- [ ] 脚本生成
- [ ] 场景合成
- [ ] 字幕生成
- [ ] FFmpeg 集成

**交付物**:

- ✅ 图像/音频/视频基础能力

### Phase 5: 迭代优化 (4 weeks)

**Week 19-20: 迭代系统**

- [ ] 反馈收集
- [ ] 改进计划生成
- [ ] 增量优化
- [ ] AB 对比

**Week 21-22: 用户体验**

- [ ] 实时预览
- [ ] 协作功能
- [ ] 分享和导出优化
- [ ] 性能优化

**交付物**:

- ✅ 完整的迭代优化循环
- ✅ 生产级性能

---

## 附录

### A. 成本估算

#### 月度运营成本（100 活跃用户）

| 项目                     | 用量          | 单价        | 月成本       |
| ------------------------ | ------------- | ----------- | ------------ |
| **Google AI Platform**   |               |             |              |
| - Gemini 3 (File Search) | 500M tokens   | $0.15/M     | $75          |
| - Gemini 3 (Generation)  | 50M tokens    | $0.30/M     | $15          |
| - Imagen 3 🆕            | 1000 images   | $0.04/image | $40          |
| **Railway 🚂**           |               |             |              |
| - Pro Plan (Backend)     | 1 service     | $20/mo      | $20          |
| - PostgreSQL             | 8GB           | $10/mo      | $10          |
| - Redis                  | 1GB           | $10/mo      | $10          |
| - Storage Volumes        | 100 GB        | $0.25/GB    | $25          |
| **其他服务**             |               |             |              |
| - ElevenLabs TTS         | 100,000 chars | $0.30/1K    | $30          |
| **总计**                 |               |             | **~$225/月** |

**每用户成本**: ~$2.25/月 ✅ (Railway 部署成本更低)

### B. 技术风险

| 风险           | 等级      | 缓解措施            |
| -------------- | --------- | ------------------- |
| **API 限流**   | 🔴 High   | 队列系统 + 指数退避 |
| **成本超支**   | 🟡 Medium | 用户配额 + 成本监控 |
| **生成质量**   | 🟡 Medium | 多轮验证 + 人工审核 |
| **版本冲突**   | 🟢 Low    | CRDT 算法           |
| **大文件处理** | 🟡 Medium | 分块上传 + 流式处理 |

---

**文档版本**: v2.1 (Gemini 3 + Imagen 3 + 实时协作)
**最后更新**: 2025-11-23
**状态**: RFC - 待评审和技术验证

**核心技术升级**:

- ✅ Gemini 3 Pro 全面集成（超长上下文、多模态能力）
- ✅ Imagen 3 专业级图像生成
- ✅ Google Docs 级别实时协作（Y.js CRDT + WebSocket）

**下一步**:

1. 团队评审会议（v2.1 新增协作特性）
2. POC 开发（2 周 - 验证 Gemini 3 + 协作）
3. 用户调研验证
4. Phase 1 启动（优先实现协作基础设施）
