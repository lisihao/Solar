# AI Writing V2 PRD - 全新设计

> 版本: 2.0
> 作者: PM Agent
> 创建日期: 2026-01-07
> 状态: 已确认

---

## 1. 概述

### 1.1 背景

当前 AI Writing 模块存在严重问题：

1. **界面设计糟糕**：用户体验差，界面过于复杂
2. **技术实现问题**：持续出现 502 错误，使用了有问题的 `apiClient` 方式
3. **功能堆积**：Story Bible、Characters、Volumes 等功能过于分散，用户无法聚焦

用户明确表示："连这个界面都不喜欢，全部给我删掉"。

### 1.2 目标

设计一个全新的 AI Writing 模块：

- **简洁专注**：聚焦核心写作体验，减少认知负担
- **技术可靠**：采用 AI Teams 成功的 API 调用模式
- **渐进式功能**：从简单开始，需要时再展开高级功能

### 1.3 非目标

- 本版本不追求复杂的多卷、多章节管理
- 不实现复杂的 Story Bible 编辑界面
- 不做实时协作功能

---

## 2. 核心设计理念

### 2.1 设计原则

| 原则          | 说明             | 实践                        |
| ------------- | ---------------- | --------------------------- |
| **写作优先**  | 界面以文本为核心 | 大面积写作区域，最少干扰    |
| **渐进复杂**  | 功能按需展示     | 默认简单模式，高级功能隐藏  |
| **可靠稳定**  | 技术实现健壮     | 直接 API 调用，完善错误处理 |
| **类 Notion** | 熟悉的交互模式   | 块编辑器、侧边栏导航        |

### 2.2 参考成功模式 - AI Teams

AI Teams 模块的成功因素：

1. **直接 API 调用**：使用 `NEXT_PUBLIC_API_URL` + `fetchWithAuth`，避免 apiClient 的问题
2. **清晰的信息架构**：列表页 -> 详情页的简单导航
3. **实时反馈**：WebSocket 实现任务进度和状态更新
4. **组件化设计**：动态加载非核心组件，保持主页面轻量

---

## 3. 信息架构

### 3.1 页面结构

```
/ai-writing                      # 项目列表页
/ai-writing/new                  # 新建项目（简化版）
/ai-writing/[projectId]          # 写作工作台（核心页面）
/ai-writing/[projectId]/settings # 项目设置（Story Bible 等）
```

### 3.2 简化的数据模型

```typescript
// 核心实体：写作项目
interface WritingProject {
  id: string;
  name: string;
  description?: string;

  // 简化的设置
  genre?: string;
  targetWords?: number;
  writingStyle?: string;

  // 状态
  status: "draft" | "writing" | "completed";
  currentWords: number;

  // 时间
  createdAt: string;
  updatedAt: string;
}

// 核心实体：章节内容
interface Chapter {
  id: string;
  projectId: string;
  title: string;
  content: string; // Markdown 内容
  wordCount: number;
  order: number;
  status: "draft" | "ai_generating" | "completed";
}

// AI 写作任务（简化版）
interface WritingMission {
  id: string;
  projectId: string;
  type: "outline" | "chapter" | "continue" | "rewrite";
  prompt: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: string;
  progress?: number;
}
```

---

## 4. 页面设计

### 4.1 项目列表页 (`/ai-writing`)

**设计目标**：快速概览所有写作项目，一键创建新项目

```
+----------------------------------------------------------+
|  [返回] AI Writing                        [+ 新建项目]    |
+----------------------------------------------------------+
|                                                          |
|  我的项目                                                |
|                                                          |
|  +------------------+  +------------------+               |
|  | 项目名称         |  | 项目名称         |              |
|  | 描述...          |  | 描述...          |              |
|  |                  |  |                  |              |
|  | 12,500 / 50,000  |  | 完成             |              |
|  | [====------] 25% |  | [==========] 100%|              |
|  +------------------+  +------------------+               |
|                                                          |
|  +------------------+                                     |
|  |   + 新建项目     |                                    |
|  |   开始你的写作   |                                    |
|  +------------------+                                     |
|                                                          |
+----------------------------------------------------------+
```

**交互**：

- 点击项目卡片进入写作工作台
- 右上角按钮快速创建
- 空状态引导创建第一个项目

### 4.2 新建项目页 (`/ai-writing/new`)

**设计目标**：最简化的项目创建流程

```
+----------------------------------------------------------+
|  [返回] 新建写作项目                                       |
+----------------------------------------------------------+
|                                                          |
|  项目名称 *                                               |
|  +----------------------------------------------+        |
|  | 我的新小说                                    |        |
|  +----------------------------------------------+        |
|                                                          |
|  简要描述（可选）                                         |
|  +----------------------------------------------+        |
|  | 一个关于...的故事                             |        |
|  +----------------------------------------------+        |
|                                                          |
|  目标字数                                                 |
|  +----------------------------------------------+        |
|  | 50,000                                       |        |
|  +----------------------------------------------+        |
|                                                          |
|                          [取消]    [创建并开始写作]       |
|                                                          |
+----------------------------------------------------------+
```

**极简设计**：

- 只需名称即可创建
- 其他设置可在项目设置中补充
- 创建后直接进入写作工作台

### 4.3 写作工作台 (`/ai-writing/[projectId]`) - 核心页面

**设计目标**：沉浸式写作体验，AI 辅助无缝集成

```
+----------------------------------------------------------+
| [返回] 项目名称                    [设置] [导出] [AI助手] |
+----------------------------------------------------------+
|        |                                                  |
| 大纲    |  第一章：开始的一天                              |
|        |                                                  |
| > 第一章 |  这是一个阳光明媚的早晨...                       |
|   第二章 |                                                  |
| + 新章节 |  [继续写作中...]                                 |
|        |                                                  |
|        |                                                  |
|        |                                                  |
|        |                                                  |
|        |  +-----------------------------------------+     |
|        |  | AI 助手                              [x] |     |
|        |  |                                         |     |
|        |  | 请帮我继续写这个场景...                  |     |
|        |  |                                         |     |
|        |  |                        [生成] [取消]    |     |
|        |  +-----------------------------------------+     |
|        |                                                  |
+----------------------------------------------------------+
| 当前章节: 3,200 字 | 项目总计: 12,500 / 50,000 字 (25%)    |
+----------------------------------------------------------+
```

**核心交互**：

1. **左侧导航**
   - 简洁的章节列表
   - 可折叠的大纲视图
   - 拖拽调整章节顺序
   - 一键添加新章节

2. **中央编辑区**
   - 大面积 Markdown 编辑器
   - 自动保存
   - 专注模式（隐藏侧边栏）
   - 实时字数统计

3. **AI 助手面板**（右侧浮动或底部抽屉）
   - 继续写作
   - 改写选中内容
   - 生成大纲
   - 扩展段落

4. **底部状态栏**
   - 当前章节字数
   - 项目总进度
   - 保存状态

### 4.4 项目设置页 (`/ai-writing/[projectId]/settings`)

**设计目标**：集中管理项目高级设置

```
+----------------------------------------------------------+
|  [返回] 项目设置                                          |
+----------------------------------------------------------+
|                                                          |
|  基本信息                                                 |
|  +-------------------------------------------------+     |
|  | 项目名称: [                              ]      |     |
|  | 描述:     [                              ]      |     |
|  | 类型:     [Fantasy        v]                    |     |
|  | 目标字数: [50,000         ]                     |     |
|  +-------------------------------------------------+     |
|                                                          |
|  写作风格                                                 |
|  +-------------------------------------------------+     |
|  | 叙事视角: [第三人称       v]                    |     |
|  | 时态:     [过去式         v]                    |     |
|  | 风格描述: [                              ]      |     |
|  +-------------------------------------------------+     |
|                                                          |
|  故事设定（Story Bible）                                  |
|  +-------------------------------------------------+     |
|  | 世界观:   [                              ]      |     |
|  | 主要角色: [添加角色...]                         |     |
|  | 关键术语: [添加术语...]                         |     |
|  +-------------------------------------------------+     |
|                                                          |
|                                        [保存设置]         |
|                                                          |
+----------------------------------------------------------+
```

**渐进式复杂性**：

- 基本信息始终可见
- Story Bible 默认折叠
- 高级设置按需展开

---

## 5. 技术实现

### 5.1 API 调用模式（重要！）

**弃用**：当前的 `apiClient` 模式（会导致 502 错误）

**采用**：AI Teams 的成功模式

```typescript
// frontend/lib/api/ai-writing-v2.ts

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

  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ message: "Request failed" }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

// API 函数
export async function getProjects(): Promise<WritingProject[]> {
  return fetchWithAuth("/api/v1/ai-writing/projects");
}

export async function getProject(id: string): Promise<WritingProject> {
  return fetchWithAuth(`/api/v1/ai-writing/projects/${id}`);
}

export async function createProject(
  dto: CreateProjectDto,
): Promise<WritingProject> {
  return fetchWithAuth("/api/v1/ai-writing/projects", {
    method: "POST",
    body: JSON.stringify(dto),
  });
}

// ... 其他 API
```

### 5.2 状态管理

采用 Zustand，参考 AI Teams 的 `aiTeamsStore`：

```typescript
// frontend/stores/aiWritingStore.ts

interface AIWritingState {
  // 项目列表
  projects: WritingProject[];
  isLoadingProjects: boolean;

  // 当前项目
  currentProject: WritingProject | null;
  chapters: Chapter[];

  // AI 任务
  activeMission: WritingMission | null;
  missionProgress: number;

  // Actions
  fetchProjects: () => Promise<void>;
  fetchProject: (id: string) => Promise<void>;
  createProject: (dto: CreateProjectDto) => Promise<WritingProject>;
  updateChapter: (id: string, content: string) => Promise<void>;
  startAIMission: (dto: StartMissionDto) => Promise<void>;
}

export const useAIWritingStore = create<AIWritingState>((set, get) => ({
  // ... 实现
}));
```

### 5.3 组件拆分

```
frontend/
├── app/ai-writing/
│   ├── page.tsx                    # 项目列表页
│   ├── new/page.tsx                # 新建项目页
│   └── [projectId]/
│       ├── page.tsx                # 写作工作台
│       └── settings/page.tsx       # 项目设置
│
├── components/ai-writing/
│   ├── ProjectCard.tsx             # 项目卡片
│   ├── ChapterList.tsx             # 章节列表
│   ├── MarkdownEditor.tsx          # Markdown 编辑器
│   ├── AIAssistantPanel.tsx        # AI 助手面板
│   ├── WritingProgress.tsx         # 进度条组件
│   └── ProjectSettings.tsx         # 设置表单
│
├── lib/api/
│   └── ai-writing-v2.ts            # 新版 API（使用 fetchWithAuth）
│
└── stores/
    └── aiWritingStore.ts           # Zustand store
```

### 5.4 后端 API 调整

保持现有后端结构，但简化前端接口：

| Endpoint                          | Method | 描述                   |
| --------------------------------- | ------ | ---------------------- |
| `/api/v1/ai-writing/projects`     | GET    | 获取项目列表           |
| `/api/v1/ai-writing/projects`     | POST   | 创建项目               |
| `/api/v1/ai-writing/projects/:id` | GET    | 获取项目详情（含章节） |
| `/api/v1/ai-writing/projects/:id` | PATCH  | 更新项目               |
| `/api/v1/ai-writing/projects/:id` | DELETE | 删除项目               |
| `/api/v1/ai-writing/chapters/:id` | PATCH  | 更新章节内容           |
| `/api/v1/ai-writing/missions`     | POST   | 启动 AI 写作任务       |
| `/api/v1/ai-writing/missions/:id` | GET    | 获取任务状态           |

---

## 6. 用户流程

### 6.1 首次使用流程

```
用户访问 /ai-writing
    ↓
显示空状态 + 引导创建
    ↓
点击"创建第一个项目"
    ↓
填写项目名称（最简表单）
    ↓
进入写作工作台
    ↓
开始写作或使用 AI 生成大纲
```

### 6.2 日常写作流程

```
进入写作工作台
    ↓
选择要编辑的章节
    ↓
在编辑器中写作
    ↓
需要 AI 帮助时打开 AI 助手面板
    ↓
输入指令（继续写/改写/扩展）
    ↓
AI 生成内容
    ↓
用户确认/编辑生成内容
    ↓
自动保存
```

### 6.3 AI 辅助写作流程

```
选中文本或定位光标
    ↓
打开 AI 助手面板
    ↓
选择操作类型：
  - 继续写作
  - 改写选中
  - 扩展段落
  - 生成大纲
    ↓
输入额外指令（可选）
    ↓
点击生成
    ↓
显示生成进度
    ↓
生成完成，显示预览
    ↓
用户选择：
  - 插入到编辑器
  - 替换选中内容
  - 重新生成
  - 取消
```

---

## 7. 任务拆分

### Phase 1: 基础框架（2-3 天）

| Task | 类型 | 预估 | 描述                                 |
| ---- | ---- | ---- | ------------------------------------ |
| T1.1 | 前端 | 0.5d | 创建新版 API 文件 `ai-writing-v2.ts` |
| T1.2 | 前端 | 0.5d | 创建 Zustand store                   |
| T1.3 | 前端 | 1d   | 实现项目列表页                       |
| T1.4 | 前端 | 0.5d | 实现新建项目页（简化版）             |

### Phase 2: 写作工作台（3-4 天）

| Task | 类型 | 预估 | 描述                     |
| ---- | ---- | ---- | ------------------------ |
| T2.1 | 前端 | 1d   | 实现写作工作台基础布局   |
| T2.2 | 前端 | 1d   | 实现 Markdown 编辑器集成 |
| T2.3 | 前端 | 0.5d | 实现章节列表组件         |
| T2.4 | 前端 | 1d   | 实现 AI 助手面板         |

### Phase 3: AI 集成（2-3 天）

| Task | 类型 | 预估 | 描述                           |
| ---- | ---- | ---- | ------------------------------ |
| T3.1 | 后端 | 1d   | 简化后端 API 接口              |
| T3.2 | 前端 | 1d   | 实现 AI 任务状态轮询/WebSocket |
| T3.3 | 前端 | 0.5d | 实现生成结果预览和插入         |

### Phase 4: 完善（1-2 天）

| Task | 类型 | 预估 | 描述                        |
| ---- | ---- | ---- | --------------------------- |
| T4.1 | 前端 | 0.5d | 实现项目设置页              |
| T4.2 | 前端 | 0.5d | 实现自动保存                |
| T4.3 | 前端 | 0.5d | 添加错误处理和 loading 状态 |
| T4.4 | 测试 | 0.5d | 端到端测试                  |

---

## 8. 验收标准

### 8.1 功能验收

- [ ] 可以创建、查看、删除写作项目
- [ ] 可以在写作工作台编辑章节内容
- [ ] 可以使用 AI 助手生成/续写内容
- [ ] 内容自动保存
- [ ] 显示正确的字数统计和进度

### 8.2 技术验收

- [ ] 不再使用 `apiClient`，全部使用 `fetchWithAuth` 直接调用
- [ ] 无 502 错误
- [ ] 页面加载时间 < 2s
- [ ] 移动端响应式适配

### 8.3 体验验收

- [ ] 界面简洁，无视觉噪音
- [ ] 写作区域占据主要空间
- [ ] AI 功能易于发现但不干扰写作

---

## 9. 风险和缓解

| 风险                | 影响 | 缓解措施                                |
| ------------------- | ---- | --------------------------------------- |
| Markdown 编辑器选型 | 中   | 使用成熟库（如 `@uiw/react-md-editor`） |
| AI 生成时间长       | 中   | 显示进度条，支持取消                    |
| 自动保存冲突        | 低   | 使用防抖 + 版本号检查                   |
| 后端 API 不稳定     | 中   | 添加重试机制和友好错误提示              |

---

## 10. 后续规划

### V2.1 增强功能

- 多人协作编辑
- 版本历史
- 导出为 EPUB/PDF

### V2.2 AI 增强

- 智能大纲生成
- 角色一致性检查
- 情节建议

---

## 附录 A: 删除旧代码清单

需要删除或重构的文件：

```
frontend/app/ai-writing/           # 重写
frontend/lib/api/ai-writing.ts     # 弃用，创建 ai-writing-v2.ts
```

保留后端代码，仅调整 API 接口：

```
backend/src/modules/ai-app/writing/  # 保留，微调接口
```

---

## 附录 B: 设计参考

- **Notion**：块编辑器、侧边栏导航
- **AI Teams**：API 调用模式、状态管理
- **Hemingway Editor**：简洁写作界面
- **iA Writer**：专注写作体验

---

**最后更新**: 2026-01-07
**维护者**: PM Agent
