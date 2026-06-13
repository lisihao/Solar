# AI Studio - 深度研究工作室

> Topic Research + Deep Research + Notebook Research，三种研究模式覆盖不同场景

**最后更新**: 2026-01-15
**版本**: v2.0
**状态**: 生产环境
**代码模块**: `backend/src/modules/ai-app/research/`

---

## 概述

AI Studio 是 GenesisPod 的深度研究模块，提供三种研究模式，覆盖从快速问答到深度报告的不同需求。

### 核心特性

- **Topic Research**: 多维度专题研究（分钟级）
- **Deep Research**: 深度迭代研究（小时级）
- **Notebook Research**: NotebookLM 风格文档研究
- **多模型支持**: 自适应选择最佳研究模型
- **结构化输出**: 章节化报告、引用管理
- **协作研究**: 多人协作、评论和批注

---

## 系统架构

### 三种研究模式对比

| 模式                  | 时长       | 适用场景         | 输出            |
| --------------------- | ---------- | ---------------- | --------------- |
| **Topic Research**    | 2-5 分钟   | 快速了解某个主题 | 多维度分析报告  |
| **Deep Research**     | 10-60 分钟 | 深入研究复杂问题 | 深度研究报告    |
| **Notebook Research** | 1-3 分钟   | 基于文档的研究   | 文档总结 + 问答 |

### 技术栈

| 层级              | 技术选型                 |
| ----------------- | ------------------------ |
| 后端              | NestJS + Research Module |
| Topic Research    | TopicResearchService     |
| Deep Research     | DeepResearchService      |
| Notebook Research | NotebookResearchService  |
| AI 编排           | ResearchMissionService   |

---

## 功能模块

### 1. Topic Research（专题研究）

#### 创建研究任务

```typescript
POST /api/v1/research/topics
{
  "name": "人工智能伦理",
  "description": "探讨 AI 发展的伦理边界和监管框架",
  "dimensions": [
    "技术发展",
    "伦理挑战",
    "监管政策",
    "社会影响"
  ]
}

Response:
{
  "id": "topic-xxx",
  "name": "人工智能伦理",
  "status": "RESEARCHING", // RESEARCHING | COMPLETED | FAILED
  "progress": 0
}
```

#### 研究流程

```
1. 用户输入主题
    ↓
2. AI 自动分解维度（或使用用户指定）
    ↓
3. 并行研究各维度
    ├── Web 搜索
    ├── 知识库检索
    └── AI 分析
    ↓
4. 汇总生成报告
    ├── 章节化输出
    ├── 引用管理
    └── 可视化图表（可选）
```

#### 获取研究结果

```typescript
GET /api/v1/research/topics/:id

Response:
{
  "id": "topic-xxx",
  "name": "人工智能伦理",
  "status": "COMPLETED",
  "report": {
    "title": "人工智能伦理研究报告",
    "abstract": "本报告探讨了...",
    "chapters": [
      {
        "title": "技术发展",
        "content": "AI 技术的快速发展...",
        "references": [
          {
            "title": "AI 发展报告 2025",
            "url": "https://example.com",
            "excerpt": "相关段落..."
          }
        ]
      }
    ],
    "conclusion": "综上所述...",
    "generatedAt": "2026-01-15T10:30:00Z"
  }
}
```

### 2. Deep Research（深度研究）

#### 创建深度研究

```typescript
POST /api/v1/research/deep
{
  "title": "量子计算在密码学中的应用",
  "question": "量子计算对现有密码学体系的威胁有多大？未来应如何应对？",
  "depth": "comprehensive", // quick | standard | comprehensive
  "maxIterations": 3 // 迭代轮次
}

Response:
{
  "id": "deep-xxx",
  "title": "量子计算在密码学中的应用",
  "status": "RESEARCHING",
  "currentIteration": 0,
  "maxIterations": 3
}
```

#### 迭代研究流程

```
Iteration 1:
  ├── 初步调研
  ├── 识别关键问题
  └── 生成初步报告

Iteration 2:
  ├── 深入未解决问题
  ├── 补充细节和证据
  └── 更新报告

Iteration 3:
  ├── 最终验证
  ├── 完善结论
  └── 输出最终报告
```

#### 实时进度推送

```typescript
// WebSocket
socket.on("research:progress", (event) => {
  console.log("当前迭代:", event.iteration);
  console.log("进度:", event.progress);
  console.log("当前任务:", event.task);
});
```

### 3. Notebook Research（文档研究）

#### 上传文档并研究

```typescript
POST /api/v1/research/notebook
Content-Type: multipart/form-data

Files: document1.pdf, document2.pdf, article.md

Response:
{
  "id": "notebook-xxx",
  "name": "我的研究笔记",
  "documentCount": 3,
  "status": "PROCESSING"
}
```

#### 文档问答

```typescript
POST /api/v1/research/notebook/:id/query
{
  "question": "这些文档的核心观点是什么？"
}

Response:
{
  "answer": "根据上传的文档，核心观点包括...",
  "sources": [
    {
      "documentTitle": "document1.pdf",
      "page": 5,
      "excerpt": "相关段落...",
      "score": 0.92
    }
  ]
}
```

#### 生成播客式对话（TTS）

```typescript
POST /api/v1/research/notebook/:id/tts
{
  "style": "podcast", // podcast | summary | discussion
  "duration": "medium" // short | medium | long
}

Response:
{
  "audioUrl": "https://cdn.genesis.ai/audio/xxx.mp3",
  "transcript": "主持人A: 今天我们来聊聊这几篇文档...",
  "duration": 360 // 秒
}
```

---

## API 接口

### Topic Research

| 方法 | 路径                                     | 说明         |
| ---- | ---------------------------------------- | ------------ |
| POST | `/api/v1/research/topics`                | 创建专题研究 |
| GET  | `/api/v1/research/topics`                | 获取研究列表 |
| GET  | `/api/v1/research/topics/:id`            | 获取研究详情 |
| POST | `/api/v1/research/topics/:id/regenerate` | 重新生成报告 |

### Deep Research

| 方法 | 路径                                 | 说明         |
| ---- | ------------------------------------ | ------------ |
| POST | `/api/v1/research/deep`              | 创建深度研究 |
| GET  | `/api/v1/research/deep/:id`          | 获取研究详情 |
| POST | `/api/v1/research/deep/:id/continue` | 继续迭代     |
| POST | `/api/v1/research/deep/:id/stop`     | 停止研究     |

### Notebook Research

| 方法 | 路径                                   | 说明           |
| ---- | -------------------------------------- | -------------- |
| POST | `/api/v1/research/notebook`            | 创建笔记本     |
| GET  | `/api/v1/research/notebook/:id`        | 获取笔记本详情 |
| POST | `/api/v1/research/notebook/:id/query`  | 文档问答       |
| POST | `/api/v1/research/notebook/:id/tts`    | 生成播客音频   |
| POST | `/api/v1/research/notebook/:id/upload` | 追加文档       |

---

## 数据模型

### TopicResearch

```prisma
model TopicResearch {
  id          String   @id @default(cuid())
  userId      String
  name        String
  description String?
  dimensions  String[] // 研究维度
  status      ResearchStatus @default(RESEARCHING)
  progress    Int      @default(0)
  report      Json?    // 章节化报告
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

### DeepResearch

```prisma
model DeepResearch {
  id               String   @id @default(cuid())
  userId           String
  title            String
  question         String   @db.Text
  depth            String   @default("standard")
  maxIterations    Int      @default(2)
  currentIteration Int      @default(0)
  status           ResearchStatus @default(RESEARCHING)
  reports          Json?    // 每轮迭代的报告
  finalReport      Json?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}
```

### NotebookResearch

```prisma
model NotebookResearch {
  id           String   @id @default(cuid())
  userId       String
  name         String
  status       String   @default("PROCESSING")
  summary      Json?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  documents    NotebookDocument[]
  queries      NotebookQuery[]
}

model NotebookDocument {
  id           String   @id @default(cuid())
  notebookId   String
  title        String
  content      String   @db.Text
  metadata     Json?
  createdAt    DateTime @default(now())

  notebook     NotebookResearch @relation(fields: [notebookId], references: [id], onDelete: Cascade)
}
```

---

## 核心服务说明

### TopicResearchService

专题研究服务，负责：

- 维度分解
- 并行研究
- 报告汇总
- 引用管理

### DeepResearchService

深度研究服务，负责：

- 迭代规划
- 问题识别
- 证据收集
- 报告迭代更新

### NotebookResearchService

笔记本研究服务，负责：

- 文档解析和向量化
- RAG 检索
- 文档问答
- TTS 音频生成

### ResearchMissionService

研究任务编排，负责：

- 任务分解
- 进度管理
- 检查点保存
- 错误恢复

---

## 前端集成

### Hook 使用

```typescript
import { useTopicResearch, useDeepResearch, useNotebook } from '@/hooks/domain';

function ResearchPage() {
  const { createResearch, loading } = useTopicResearch();
  const { research, progress } = useDeepResearch(researchId);

  const handleCreateTopic = async () => {
    const result = await createResearch({
      name: "AI 伦理",
      dimensions: ["技术", "伦理", "政策"]
    });
    console.log('研究 ID:', result.id);
  };

  return <div>...</div>;
}
```

### 路由结构

```
/ai-studio
  ├── /                         # 研究列表
  ├── /new                      # 选择研究模式
  ├── /topic/:id                # Topic Research 详情
  ├── /deep/:id                 # Deep Research 详情
  └── /notebook/:id             # Notebook Research 详情
      ├── /                     # 文档列表
      ├── /query                # 问答界面
      └── /tts                  # 播客生成
```

---

## 使用指南

### 1. 快速专题研究（Topic Research）

```bash
# 创建研究任务
curl -X POST https://api.genesis.ai/api/v1/research/topics \
  -d '{
    "name": "Web3 技术趋势",
    "dimensions": ["技术架构", "应用场景", "市场趋势"]
  }'

# 2-5 分钟后获取结果
curl -X GET https://api.genesis.ai/api/v1/research/topics/TOPIC_ID
```

### 2. 深度研究（Deep Research）

```bash
# 创建深度研究
curl -X POST https://api.genesis.ai/api/v1/research/deep \
  -d '{
    "title": "AI 安全",
    "question": "如何确保大模型的安全性？",
    "depth": "comprehensive",
    "maxIterations": 3
  }'

# 监控进度（WebSocket）
# 或轮询 GET /api/v1/research/deep/DEEP_ID
```

### 3. 文档研究（Notebook）

```bash
# 上传文档
curl -X POST https://api.genesis.ai/api/v1/research/notebook \
  -F "files=@paper1.pdf" \
  -F "files=@paper2.pdf"

# 文档问答
curl -X POST https://api.genesis.ai/api/v1/research/notebook/NOTEBOOK_ID/query \
  -d '{"question": "这些论文的核心创新是什么？"}'

# 生成播客
curl -X POST https://api.genesis.ai/api/v1/research/notebook/NOTEBOOK_ID/tts \
  -d '{"style": "podcast", "duration": "medium"}'
```

---

## 最佳实践

### 1. 研究模式选择

| 需求             | 推荐模式          | 原因               |
| ---------------- | ----------------- | ------------------ |
| 快速了解某个主题 | Topic Research    | 5 分钟多维度概览   |
| 深入研究复杂问题 | Deep Research     | 迭代深化，全面分析 |
| 基于已有文档研究 | Notebook Research | RAG 检索，精准问答 |
| 学术论文总结     | Notebook Research | 支持 PDF，引用精准 |

### 2. Topic Research 维度设计

**维度示例**：

- 技术分析：`["架构设计", "核心算法", "技术栈", "性能指标"]`
- 市场分析：`["市场规模", "竞争格局", "用户需求", "发展趋势"]`
- 产品分析：`["功能特性", "用户体验", "竞品对比", "定价策略"]`

### 3. Deep Research 迭代策略

- **quick**: 1 轮迭代，适合简单问题
- **standard**: 2 轮迭代，适合一般问题
- **comprehensive**: 3+ 轮迭代，适合复杂问题

### 4. Notebook 文档准备

- **格式**: 优先 PDF，其次 Word、Markdown
- **数量**: 建议 3-20 篇文档
- **质量**: 确保文档相关性高

---

## 应用场景

### 1. 商业分析

- 竞品分析报告（Topic Research）
- 市场趋势研究（Deep Research）
- 行业白皮书解读（Notebook Research）

### 2. 学术研究

- 文献综述（Notebook Research）
- 研究方向探索（Topic Research）
- 论文深度分析（Deep Research）

### 3. 技术调研

- 技术方案对比（Topic Research）
- 架构设计研究（Deep Research）
- 技术文档学习（Notebook Research）

---

## 相关文档

- [AI Engine 研究能力](../../../architecture/ai-engine.md)
- [RAG 知识库集成](../rag/readme.md)
- [NotebookLM 对比分析](notebooklm-comparison.md)

---

## 更新日志

### v2.0 (2026-01-15)

- 新增 Deep Research 模式
- Notebook Research 支持 TTS 播客生成
- Topic Research 优化维度分解算法
- 支持协作研究和评论

### v1.0 (2025-11-01)

- 初始版本发布
- Topic Research 基础功能
- Notebook Research 文档问答
