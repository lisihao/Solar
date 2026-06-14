# AI Writing V3 PRD - 用户优先设计

> 版本: 3.0
> 作者: PM Agent
> 创建日期: 2026-01-07
> 状态: 草稿

---

## 1. 概述

### 1.1 背景

当前 AI Writing 模块存在严重的用户体验问题：

1. **界面显示原始翻译键名** - 如 `aiWriting.title` 等未翻译的键值，完全不可用
2. **界面过于技术化** - 要求用户管理章节、卷、Story Bible 等复杂结构
3. **不够"智能"** - 缺少 AI 自动化，用户需要手动管理每个细节
4. **与 AI Teams 体验差距大** - AI Teams 的"一键启动，AI 协作完成"体验远优于当前设计

**用户核心诉求**：

- "我只想描述我要写什么，让 AI 团队帮我完成"
- "参考 AI Teams 那样的体验"
- "用户友好第一，不要让我管理复杂结构"

### 1.2 设计理念 - 颠覆性创新

**从"写作工具"到"AI 写作服务"的转变**：

| 传统写作工具     | AI Writing V3     |
| ---------------- | ----------------- |
| 用户管理章节结构 | 用户只需描述需求  |
| 用户逐段写作     | AI 团队自动完成   |
| 手动组织大纲     | AI 策划师自动构思 |
| 被动的 AI 辅助   | 主动的 AI 协作    |
| 复杂的项目设置   | 一句话启动        |

### 1.3 目标

打造一个真正"用户友好第一"的 AI 写作平台：

1. **极简输入** - 用户只需一句话描述写作需求
2. **AI 团队自动工作** - 策划师、作家、编辑自动协作
3. **可视化进度** - 参考 AI Teams 的 Canvas 和进度展示
4. **专业输出** - 高质量内容，支持预览、编辑、导出

### 1.4 非目标

- 本版本不追求用户手动管理复杂章节结构
- 不实现传统的 Markdown 编辑器为主的界面
- 不保留旧版的"项目 -> 卷 -> 章节"三层结构

---

## 2. 核心设计 - AI 写作团队

### 2.1 AI 写作团队角色

参考 AI Teams 的多 Agent 协作模式，定义写作专用的 AI 团队：

```
+------------------+
|    策划师 (Leader)  |  负责理解需求、规划大纲、分配任务、审核质量
+------------------+
         |
         v
+------------------+------------------+------------------+
|   创意作家        |   情节作家        |   文笔润色师      |
+------------------+------------------+------------------+
| 擅长创意构思      | 擅长故事推进      | 擅长文字打磨      |
| 世界观设定        | 情节安排          | 风格一致性        |
| 角色塑造          | 冲突设计          | 语言优化          |
+------------------+------------------+------------------+
```

### 2.2 AI 团队工作流程

```
用户输入需求
     |
     v
[策划师分析需求]
     |
     +---> 理解写作类型（小说/文章/报告等）
     +---> 确定篇幅和结构
     +---> 规划大纲和任务
     |
     v
[策划师分配任务]
     |
     +---> 分配给合适的 AI 作家
     +---> 设定任务优先级
     +---> 定义验收标准
     |
     v
[AI 作家执行写作]
     |
     +---> 按任务要求写作
     +---> 保持风格一致
     +---> 提交成果审核
     |
     v
[策划师审核与整合]
     |
     +---> 审核各部分质量
     +---> 需要修改则返回修订
     +---> 整合最终成果
     |
     v
[交付给用户]
     |
     +---> 展示完整作品
     +---> 支持预览、编辑、导出
```

---

## 3. 用户界面设计

### 3.1 页面结构（极简）

```
/ai-writing                     # 首页 - 历史项目 + 一键创建
/ai-writing/[projectId]         # 项目详情 - AI 团队工作可视化
```

只需 2 个页面，极简信息架构。

### 3.2 首页设计 (`/ai-writing`)

**设计目标**：一句话启动 AI 写作团队

```
+------------------------------------------------------------------+
|  AI Writing                                        [历史项目 v]   |
+------------------------------------------------------------------+
|                                                                   |
|                      [钢笔图标 / AI 写作图标]                      |
|                                                                   |
|                   让 AI 团队帮你完成写作任务                        |
|                                                                   |
|  +-------------------------------------------------------------+ |
|  |                                                             | |
|  |  描述你想写的内容...                                         | |
|  |                                                             | |
|  |  例如：帮我写一个科幻小说，讲述人类首次发现外星文明的故事，      | |
|  |  大约 10000 字，要有悬疑元素和哲学思考                        | |
|  |                                                             | |
|  +-------------------------------------------------------------+ |
|                                                                   |
|  快速选项：                                                        |
|  +----------+ +----------+ +----------+ +----------+              |
|  | 短篇小说  | | 长篇小说  | | 商业文案  | | 技术文档  |             |
|  +----------+ +----------+ +----------+ +----------+              |
|  +----------+ +----------+ +----------+ +----------+              |
|  | 学术论文  | | 创意故事  | | 博客文章  | | 自定义    |             |
|  +----------+ +----------+ +----------+ +----------+              |
|                                                                   |
|                        [开始写作]                                  |
|                                                                   |
+------------------------------------------------------------------+
|                                                                   |
|  最近项目                                                          |
|  +-------------------+ +-------------------+ +-------------------+ |
|  | 科幻小说 - 星际...  | | 技术博客 - AI...  | | 商业提案 - ...    | |
|  | AI 团队已完成       | | 等待审核          | | 写作中 60%        | |
|  | 12,580 字          | | 3,200 字          | | 5,420 字          | |
|  +-------------------+ +-------------------+ +-------------------+ |
|                                                                   |
+------------------------------------------------------------------+
```

**核心交互**：

1. **一键启动**
   - 在大输入框中描述需求
   - 点击"开始写作"
   - AI 团队立即开始工作

2. **快速模板**
   - 点击快速选项自动填充描述模板
   - 帮助用户快速表达需求

3. **历史项目**
   - 展示最近的写作项目
   - 点击进入查看详情

### 3.3 项目详情页设计 (`/ai-writing/[projectId]`)

**设计目标**：AI 团队工作可视化 + 成果展示

```
+------------------------------------------------------------------+
|  [返回] 星际迷航：第一次接触              [导出 v] [编辑] [删除]   |
+------------------------------------------------------------------+
|                                                                   |
|  +------------------------+  +----------------------------------+ |
|  |                        |  |                                  | |
|  |    AI 团队工作视图       |  |    作品预览                       | |
|  |    (Canvas 可视化)      |  |                                  | |
|  |                        |  |  # 第一章：黎明前的寂静            | |
|  |      [策划师]           |  |                                  | |
|  |         |              |  |  2187年3月15日，地球时间凌晨      | |
|  |    +----+----+         |  |  三点四十七分。                    | |
|  |    |         |         |  |                                  | |
|  | [作家1]   [作家2]       |  |  张明宇站在望远镜前，揉了揉...     | |
|  |                        |  |                                  | |
|  |  任务进度: 5/8 完成     |  |  [展开全文...]                    | |
|  |  [=========>----] 62%  |  |                                  | |
|  |                        |  |                                  | |
|  +------------------------+  +----------------------------------+ |
|                                                                   |
+------------------------------------------------------------------+
|                                                                   |
|  任务详情                                                          |
|                                                                   |
|  +--------------------------------------------------------------+ |
|  | [完成] 任务 1: 构思大纲和世界观设定           策划师   2分钟  | |
|  +--------------------------------------------------------------+ |
|  | [完成] 任务 2: 撰写第一章 - 开篇场景设定      创意作家  5分钟  | |
|  +--------------------------------------------------------------+ |
|  | [进行中] 任务 3: 撰写第二章 - 发现信号        情节作家  ...    | |
|  |          正在生成内容...                                       | |
|  +--------------------------------------------------------------+ |
|  | [等待中] 任务 4: 撰写第三章 - 第一次接触      情节作家         | |
|  +--------------------------------------------------------------+ |
|  | [等待中] 任务 5: 全文润色和统一风格           润色师           | |
|  +--------------------------------------------------------------+ |
|                                                                   |
+------------------------------------------------------------------+
|                                                                   |
|  用户反馈                                                          |
|  +--------------------------------------------------------------+ |
|  | 对当前成果有什么修改意见？AI 团队会根据反馈继续优化...          | |
|  +--------------------------------------------------------------+ |
|                         [提交反馈，继续优化]                       |
|                                                                   |
+------------------------------------------------------------------+
```

**核心模块**：

#### 3.3.1 AI 团队工作视图（左上）

参考 AI Teams 的 `TeamCanvasView` 组件：

- **可视化展示**
  - 策划师节点在顶部（Leader，带皇冠图标）
  - 作家节点在下方
  - 连线表示任务分配关系
  - 动画表示正在工作的 Agent

- **状态指示**
  - 蓝色 + 脉冲动画：正在工作
  - 绿色：已完成
  - 灰色：空闲/等待中
  - 紫色：Leader

- **任务进度条**
  - 显示总体完成进度
  - 如 "5/8 任务完成，62%"

#### 3.3.2 作品预览（右上）

- **实时预览**
  - 展示已生成的内容
  - Markdown 渲染
  - 支持展开/折叠章节

- **字数统计**
  - 当前字数 / 目标字数
  - 实时更新

#### 3.3.3 任务详情列表（中间）

参考 AI Teams 的 `MissionProgressPanel` 组件：

- **任务卡片**
  - 状态图标（完成/进行中/等待中）
  - 任务标题和描述
  - 负责的 AI Agent
  - 耗时统计

- **任务展开**
  - 点击可展开查看任务成果
  - 查看 AI 的具体输出
  - 查看 Leader 的审核反馈

#### 3.3.4 用户反馈区（底部）

- **迭代优化**
  - 用户可以输入反馈意见
  - AI 团队会根据反馈继续优化
  - 支持多轮迭代

---

## 4. 数据模型

### 4.1 写作项目（简化）

```typescript
interface WritingProject {
  id: string;
  userId: string;

  // 用户输入
  title: string; // 自动从需求中提取或生成
  userPrompt: string; // 用户的原始需求描述
  writingType: WritingType; // 写作类型

  // AI 生成的配置
  outline?: string; // AI 生成的大纲
  targetWords?: number; // 目标字数
  style?: string; // 写作风格

  // 状态
  status: ProjectStatus;
  currentWords: number;
  progress: number; // 0-100

  // AI Mission 关联
  missionId?: string; // 关联的 AI Teams Mission

  // 结果
  content?: string; // 最终生成的内容
  chapters?: ChapterContent[]; // 分章节内容（可选）

  // 时间
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

enum WritingType {
  SHORT_STORY = "SHORT_STORY", // 短篇小说
  NOVEL = "NOVEL", // 长篇小说
  BUSINESS_COPY = "BUSINESS_COPY", // 商业文案
  TECH_DOC = "TECH_DOC", // 技术文档
  ACADEMIC = "ACADEMIC", // 学术论文
  BLOG = "BLOG", // 博客文章
  CUSTOM = "CUSTOM", // 自定义
}

enum ProjectStatus {
  PENDING = "PENDING", // 等待开始
  PLANNING = "PLANNING", // AI 策划中
  WRITING = "WRITING", // AI 写作中
  REVIEWING = "REVIEWING", // AI 审核中
  COMPLETED = "COMPLETED", // 已完成
  FAILED = "FAILED", // 失败
}

interface ChapterContent {
  id: string;
  title: string;
  content: string;
  wordCount: number;
  order: number;
}
```

### 4.2 与 AI Teams 集成

核心思路：**复用 AI Teams 的 Mission 机制**

```typescript
// 创建写作项目时，自动创建对应的 AI Teams Mission
async function createWritingProject(dto: CreateWritingProjectDto) {
  // 1. 创建写作项目记录
  const project = await prisma.writingProject.create({
    data: {
      userId: dto.userId,
      userPrompt: dto.userPrompt,
      writingType: dto.writingType,
      status: "PENDING",
    },
  });

  // 2. 创建 AI Teams Mission（复用现有机制）
  const mission = await aiTeamsService.createMission({
    title: `写作任务: ${extractTitle(dto.userPrompt)}`,
    description: dto.userPrompt,
    topicId: getWritingTopicId(), // 专用的写作 Topic
    missionType: "WRITING", // 新增写作类型
    metadata: {
      writingProjectId: project.id,
      writingType: dto.writingType,
    },
  });

  // 3. 更新项目关联
  await prisma.writingProject.update({
    where: { id: project.id },
    data: { missionId: mission.id },
  });

  return project;
}
```

---

## 5. AI 团队配置

### 5.1 预定义写作团队

在系统中预配置一个专用的"AI 写作团队"：

```typescript
const WRITING_TEAM_CONFIG = {
  name: "AI 写作团队",
  description: "专业的 AI 写作协作团队，帮你完成各类写作任务",
  avatar: "&#9997;", // 钢笔 emoji

  aiMembers: [
    {
      displayName: "策划师",
      role: "LEADER",
      aiModel: "claude-3-5-sonnet", // 策划需要强理解能力
      systemPrompt: `你是一位资深的写作策划师，负责：
1. 理解用户的写作需求
2. 规划作品的整体结构和大纲
3. 分配写作任务给团队成员
4. 审核和整合各部分内容
5. 确保最终作品的质量和一致性

在规划任务时，请考虑：
- 作品的类型和风格要求
- 目标字数和篇幅结构
- 各章节的内容分布
- 角色和情节的一致性`,
      expertiseAreas: ["策划", "审核", "整合"],
    },
    {
      displayName: "创意作家",
      role: "WORKER",
      aiModel: "gpt-4o", // 创意需要 GPT-4 的发散能力
      systemPrompt: `你是一位富有创意的作家，擅长：
1. 构思独特的故事创意
2. 创造生动的角色形象
3. 设计引人入胜的世界观
4. 撰写富有想象力的内容

写作时请注意：
- 保持创意的新颖性
- 角色形象要立体
- 情节要有吸引力
- 语言要生动有趣`,
      expertiseAreas: ["创意", "世界观", "角色"],
    },
    {
      displayName: "情节作家",
      role: "WORKER",
      aiModel: "claude-3-5-sonnet",
      systemPrompt: `你是一位擅长情节设计的作家，负责：
1. 推进故事情节发展
2. 设计精彩的冲突和转折
3. 保持情节的连贯性
4. 控制故事的节奏

写作时请注意：
- 情节要合理推进
- 冲突要有张力
- 转折要出人意料
- 节奏要松弛有度`,
      expertiseAreas: ["情节", "冲突", "节奏"],
    },
    {
      displayName: "文笔润色师",
      role: "WORKER",
      aiModel: "claude-3-5-sonnet",
      systemPrompt: `你是一位专业的文字编辑，负责：
1. 润色和优化文字表达
2. 统一全文的写作风格
3. 检查语法和用词
4. 提升文章的可读性

编辑时请注意：
- 保持原文的核心意思
- 统一人称和时态
- 优化句子结构
- 删除冗余表达`,
      expertiseAreas: ["润色", "风格", "编辑"],
    },
  ],
};
```

### 5.2 写作任务类型

针对不同写作类型，定义不同的任务分配策略：

```typescript
const WRITING_TASK_STRATEGIES = {
  SHORT_STORY: {
    // 短篇小说：策划 -> 创意作家写全篇 -> 润色
    tasks: [
      { type: "OUTLINE", assignTo: "LEADER" },
      { type: "WRITE_FULL", assignTo: "CREATIVE_WRITER" },
      { type: "POLISH", assignTo: "EDITOR" },
    ],
  },

  NOVEL: {
    // 长篇小说：策划 -> 分章节写作 -> 润色
    tasks: [
      { type: "OUTLINE", assignTo: "LEADER" },
      { type: "WRITE_CHAPTER", assignTo: "DYNAMIC", repeat: "BY_OUTLINE" },
      { type: "POLISH", assignTo: "EDITOR" },
      { type: "FINAL_REVIEW", assignTo: "LEADER" },
    ],
  },

  TECH_DOC: {
    // 技术文档：策划 -> 分模块写作 -> 审核
    tasks: [
      { type: "OUTLINE", assignTo: "LEADER" },
      { type: "WRITE_SECTION", assignTo: "DYNAMIC", repeat: "BY_OUTLINE" },
      { type: "TECHNICAL_REVIEW", assignTo: "LEADER" },
    ],
  },

  // ... 其他类型
};
```

---

## 6. 用户流程

### 6.1 首次使用流程

```
用户访问 /ai-writing
        |
        v
展示首页 - 大输入框 + 快速选项
        |
        v
用户输入需求描述（或选择模板）
  例如："帮我写一个科幻短篇，讲述 AI 觉醒的故事，3000字左右"
        |
        v
点击"开始写作"
        |
        v
系统创建项目 + 自动创建 AI Teams Mission
        |
        v
跳转到项目详情页
        |
        v
展示 AI 团队工作可视化
  - Canvas 显示 Agent 开始工作
  - 任务列表显示规划进度
  - "策划师正在分析需求..."
        |
        v
AI 团队自动协作完成任务
  - 实时更新进度
  - 展示各 Agent 的工作状态
  - 逐步展示生成的内容
        |
        v
任务完成
  - 展示完整作品预览
  - 支持导出、编辑、继续优化
```

### 6.2 迭代优化流程

```
查看已完成的作品
        |
        v
用户有修改意见
  例如："第二章的冲突不够激烈，希望加强"
        |
        v
在反馈区输入意见
        |
        v
点击"提交反馈，继续优化"
        |
        v
系统创建新的优化任务
  - 策划师分析反馈
  - 分配修改任务
  - 执行修改
        |
        v
展示优化后的版本
        |
        v
用户满意 -> 最终导出
用户不满意 -> 继续迭代
```

---

## 7. 技术实现

### 7.1 前端架构

```
frontend/
├── app/ai-writing/
│   ├── page.tsx                    # 首页 - 需求输入
│   └── [projectId]/
│       └── page.tsx                # 项目详情 - 工作可视化
│
├── components/ai-writing-v3/       # V3 全新组件
│   ├── WritingPromptInput.tsx      # 需求输入框
│   ├── WritingTypeSelector.tsx     # 写作类型选择
│   ├── ProjectCard.tsx             # 项目卡片
│   ├── WritingCanvasView.tsx       # AI 团队可视化（复用 TeamCanvasView）
│   ├── WritingProgressPanel.tsx    # 任务进度（复用 MissionProgressPanel）
│   ├── ContentPreview.tsx          # 内容预览
│   ├── FeedbackInput.tsx           # 反馈输入
│   └── ExportDialog.tsx            # 导出对话框
│
├── lib/api/
│   └── ai-writing-v3.ts            # 新版 API
│
└── stores/
    └── aiWritingStoreV3.ts         # 新版 Store
```

### 7.2 API 调用模式

继续采用 AI Teams 验证过的直接 API 调用模式：

```typescript
// frontend/lib/api/ai-writing-v3.ts

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const tokens = getAuthTokens();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  if (tokens?.accessToken) {
    (headers as Record<string, string>)["Authorization"] =
      `Bearer ${tokens.accessToken}`;
  }

  const response = await fetch(`${API_BASE}${url}`, { ...options, headers });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ message: "Request failed" }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

// 创建写作项目（一键启动）
export async function createWritingProject(dto: {
  userPrompt: string;
  writingType: WritingType;
}): Promise<WritingProject> {
  return fetchWithAuth("/api/v1/ai-writing/projects", {
    method: "POST",
    body: JSON.stringify(dto),
  });
}

// 获取项目详情（含 Mission 状态）
export async function getWritingProject(
  projectId: string,
): Promise<WritingProjectDetail> {
  return fetchWithAuth(`/api/v1/ai-writing/projects/${projectId}`);
}

// 获取历史项目列表
export async function getWritingProjects(): Promise<WritingProject[]> {
  return fetchWithAuth("/api/v1/ai-writing/projects");
}

// 提交用户反馈
export async function submitFeedback(
  projectId: string,
  feedback: string,
): Promise<void> {
  return fetchWithAuth(`/api/v1/ai-writing/projects/${projectId}/feedback`, {
    method: "POST",
    body: JSON.stringify({ feedback }),
  });
}

// 导出项目
export async function exportProject(
  projectId: string,
  format: "md" | "pdf" | "docx",
): Promise<Blob> {
  const response = await fetch(
    `${API_BASE}/api/v1/ai-writing/projects/${projectId}/export?format=${format}`,
    {
      headers: {
        Authorization: `Bearer ${getAuthTokens()?.accessToken}`,
      },
    },
  );
  return response.blob();
}
```

### 7.3 后端架构

```
backend/src/modules/ai/ai-writing/
├── ai-writing.module.ts
├── ai-writing.controller.ts
├── ai-writing.service.ts
├── writing-mission.service.ts      # 与 AI Teams Mission 集成
├── dto/
│   ├── create-project.dto.ts
│   └── submit-feedback.dto.ts
└── entities/
    └── writing-project.entity.ts
```

### 7.4 与 AI Teams 集成

**核心集成点**：

1. **复用 Mission 机制**
   - 写作项目创建时自动创建 AI Teams Mission
   - 复用 Mission 的任务规划、分配、执行、审核流程

2. **复用 Agent 执行**
   - 写作任务由预配置的 AI 写作团队 Agent 执行
   - 复用现有的 LLM 调用和流式输出机制

3. **复用进度展示**
   - 复用 `TeamCanvasView` 组件展示 Agent 工作状态
   - 复用 `MissionProgressPanel` 组件展示任务进度

```typescript
// backend/src/modules/ai/ai-writing/writing-mission.service.ts

@Injectable()
export class WritingMissionService {
  constructor(
    private readonly teamMissionService: TeamMissionService,
    private readonly prisma: PrismaService,
  ) {}

  async createWritingMission(project: WritingProject): Promise<TeamMission> {
    // 获取预配置的写作团队 Topic
    const writingTopicId = await this.getOrCreateWritingTopic();

    // 创建 Mission
    const mission = await this.teamMissionService.createMission({
      topicId: writingTopicId,
      title: project.title || "写作任务",
      description: this.buildMissionDescription(project),
      missionType: "WRITING",
      metadata: {
        writingProjectId: project.id,
        writingType: project.writingType,
        userPrompt: project.userPrompt,
      },
    });

    return mission;
  }

  private buildMissionDescription(project: WritingProject): string {
    return `
## 写作任务

### 用户需求
${project.userPrompt}

### 写作类型
${project.writingType}

### 任务要求
1. 首先分析用户需求，制定写作大纲
2. 根据大纲分配写作任务给团队成员
3. 确保内容质量和风格一致性
4. 最终整合成完整作品
`;
  }

  // 获取或创建写作专用 Topic
  private async getOrCreateWritingTopic(): Promise<string> {
    let topic = await this.prisma.topic.findFirst({
      where: { name: "AI 写作团队", type: "SYSTEM" },
    });

    if (!topic) {
      topic = await this.createWritingTopic();
    }

    return topic.id;
  }
}
```

---

## 8. 任务拆分

### Phase 1: 基础框架（2 天）

| Task | 类型 | 预估 | 描述                                          |
| ---- | ---- | ---- | --------------------------------------------- |
| T1.1 | 后端 | 0.5d | 创建写作项目数据模型和 Prisma schema          |
| T1.2 | 后端 | 0.5d | 实现 `WritingMissionService` 与 AI Teams 集成 |
| T1.3 | 前端 | 0.5d | 创建 `ai-writing-v3.ts` API 文件              |
| T1.4 | 前端 | 0.5d | 创建 `aiWritingStoreV3.ts` Zustand store      |

### Phase 2: 首页实现（1.5 天）

| Task | 类型 | 预估 | 描述                            |
| ---- | ---- | ---- | ------------------------------- |
| T2.1 | 前端 | 0.5d | 实现 `WritingPromptInput` 组件  |
| T2.2 | 前端 | 0.5d | 实现 `WritingTypeSelector` 组件 |
| T2.3 | 前端 | 0.5d | 实现首页布局和历史项目展示      |

### Phase 3: 项目详情页（2.5 天）

| Task | 类型 | 预估 | 描述                                                       |
| ---- | ---- | ---- | ---------------------------------------------------------- |
| T3.1 | 前端 | 0.5d | 复用/改造 `TeamCanvasView` 为 `WritingCanvasView`          |
| T3.2 | 前端 | 0.5d | 复用/改造 `MissionProgressPanel` 为 `WritingProgressPanel` |
| T3.3 | 前端 | 0.5d | 实现 `ContentPreview` 内容预览组件                         |
| T3.4 | 前端 | 0.5d | 实现 `FeedbackInput` 反馈输入组件                          |
| T3.5 | 前端 | 0.5d | 整合详情页布局                                             |

### Phase 4: 完善与优化（2 天）

| Task | 类型 | 预估 | 描述                           |
| ---- | ---- | ---- | ------------------------------ |
| T4.1 | 后端 | 0.5d | 实现导出功能（Markdown/PDF）   |
| T4.2 | 前端 | 0.5d | 实现 `ExportDialog` 导出对话框 |
| T4.3 | 前端 | 0.5d | 实现用户反馈 -> 继续优化流程   |
| T4.4 | 全栈 | 0.5d | 错误处理和 loading 状态优化    |

### Phase 5: 测试与上线（1 天）

| Task | 类型 | 预估 | 描述                |
| ---- | ---- | ---- | ------------------- |
| T5.1 | 测试 | 0.5d | 端到端测试          |
| T5.2 | 前端 | 0.5d | 修复 bug 和优化体验 |

**总计：约 9 天**

---

## 9. 验收标准

### 9.1 功能验收

- [ ] 用户可以一句话描述需求，启动 AI 写作团队
- [ ] AI 团队自动规划大纲、分配任务、执行写作
- [ ] Canvas 可视化展示 AI Agent 工作状态
- [ ] 任务进度面板展示详细进度
- [ ] 实时预览生成的内容
- [ ] 支持用户反馈和迭代优化
- [ ] 支持导出为 Markdown/PDF

### 9.2 技术验收

- [ ] 成功复用 AI Teams 的 Mission 机制
- [ ] 使用直接 API 调用（fetchWithAuth），无 502 错误
- [ ] 页面加载时间 < 2s
- [ ] 移动端响应式适配

### 9.3 体验验收

- [ ] 首页输入简洁，一目了然
- [ ] AI 团队工作可视化清晰
- [ ] 进度展示直观
- [ ] 无翻译键名显示问题
- [ ] 整体体验接近 AI Teams 水平

---

## 10. 风险和缓解

| 风险                      | 影响 | 缓解措施                       |
| ------------------------- | ---- | ------------------------------ |
| AI Teams Mission 集成复杂 | 高   | 先 POC 验证集成可行性          |
| 长篇写作耗时太长          | 中   | 分章节展示进度，支持中途查看   |
| AI 生成质量不稳定         | 中   | 多轮审核机制，支持用户反馈优化 |
| 导出格式复杂              | 低   | 先支持 Markdown，PDF 后续迭代  |

---

## 11. 后续规划

### V3.1 增强功能

- 支持上传参考资料（PDF、图片等）
- 支持指定写作风格（模仿某作家）
- 历史作品作为上下文参考

### V3.2 高级功能

- 多人协作（共同编辑反馈）
- 版本历史和对比
- 发布到外部平台（Medium、微信公众号等）

### V3.3 商业化

- 按字数/项目收费
- 高级 AI 模型选择
- 优先队列和更快的生成速度

---

## 附录 A: 与旧版对比

| 特性     | V2（旧）            | V3（新）                 |
| -------- | ------------------- | ------------------------ |
| 入口     | 复杂的项目创建表单  | 一句话输入框             |
| 结构管理 | 用户手动管理章节/卷 | AI 自动规划              |
| AI 辅助  | 被动的"AI 助手面板" | 主动的 AI 团队协作       |
| 进度展示 | 简单的字数统计      | Canvas 可视化 + 任务列表 |
| 用户参与 | 全程参与写作        | 描述需求 + 审核结果      |
| 迭代方式 | 手动编辑            | 反馈驱动的 AI 优化       |

---

## 附录 B: 设计参考

- **AI Teams**：Canvas 可视化、Mission 机制、任务进度展示
- **Jasper AI**：一键生成内容的简洁入口
- **Copy.ai**：模板驱动的内容生成
- **ChatGPT**：对话式交互体验

---

## 附录 C: 删除/重构清单

需要重构的文件：

```
frontend/app/ai-writing/                    # 完全重写
frontend/components/ai-writing/             # 废弃，创建 ai-writing-v3/
frontend/stores/aiWritingStore.ts           # 创建 aiWritingStoreV3.ts
frontend/lib/api/ai-writing.ts              # 创建 ai-writing-v3.ts
```

需要保留并复用：

```
frontend/components/ai-teams/TeamCanvasView.tsx       # 复用或改造
frontend/components/ai-teams/MissionProgressPanel.tsx # 复用或改造
backend/src/modules/ai/ai-teams/                      # 集成复用
```

---

**最后更新**: 2026-01-07
**维护者**: PM Agent
