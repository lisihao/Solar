# AI Ask - 智能问答系统

> 多模型对话 + RAG 知识库问答 + 工具调用能力

**最后更新**: 2026-05-09
**版本**: v1.1
**状态**: 生产环境

> **扩展设计**：[Teams 模式设计方案 v0.2](./teams-mode.md)（多 AI 群聊 / 辩论 / 投票 / 评审 / handoff，集体评审通过）— [评审纪要](./teams-mode-review.md) · [ADR-004](../../../decisions/004-ai-ask-teams-mode.md)

---

## 概述

AI Ask 是 GenesisPod 的智能问答模块，提供类似 ChatGPT 的对话体验，同时支持知识库检索增强（RAG）和工具调用能力。

### 核心特性

- **多模型支持**: 无缝切换 OpenAI/Claude/Grok 等多种 LLM
- **会话管理**: 持久化对话历史，支持多会话切换
- **RAG 增强**: 基于用户上传的知识库回答问题
- **工具调用**: 支持 Web 搜索、短期记忆等工具（可选）
- **项目上下文**: 自动识别 GenesisPod 相关问题并注入项目知识
- **自动标题**: 根据首条消息自动生成会话标题

---

## 系统架构

### 核心流程

```
用户输入
    ↓
[RAG 检索] (可选)
    ↓
[项目上下文注入] (自动识别)
    ↓
[工具调用模式] or [直接对话]
    ↓
AI 响应
    ↓
保存历史 + 积分扣减
```

### 技术栈

| 层级     | 技术选型                                |
| -------- | --------------------------------------- |
| 后端     | NestJS + AIEngineFacade                 |
| 数据存储 | PostgreSQL (AskSession, AskMessage)     |
| RAG      | RAGPipelineService (Embedding + Rerank) |
| 工具调用 | FunctionCallingExecutor + ToolRegistry  |
| 积分系统 | CreditsService                          |

---

## 功能模块

### 1. 会话管理

#### 创建会话

```typescript
POST /api/v1/ai-ask/sessions
{
  "title": "可选标题",
  "modelId": "grok-2-1212" // 可选
}
```

- 默认标题: "New Chat"
- 自动根据首条消息生成标题（40字符以内）

#### 获取会话列表

```typescript
GET /api/v1/ai-ask/sessions?page=1&limit=50

Response:
{
  "sessions": [
    {
      "id": "xxx",
      "title": "如何使用 AI Ask",
      "summary": null,
      "modelId": "grok-2-1212",
      "isBookmarked": false,
      "messageCount": 5,
      "createdAt": "2026-01-15T10:00:00Z",
      "updatedAt": "2026-01-15T10:05:00Z"
    }
  ],
  "total": 123,
  "page": 1,
  "limit": 50
}
```

#### 更新会话

```typescript
PATCH /api/v1/ai-ask/sessions/:id
{
  "title": "新标题",
  "isBookmarked": true
}
```

### 2. 消息发送

#### 基础对话

```typescript
POST /api/v1/ai-ask/sessions/:id/messages
{
  "content": "你好，请介绍一下 GenesisPod",
  "modelId": "grok-2-1212" // 可选，覆盖会话默认模型
}

Response:
{
  "userMessage": { /* ... */ },
  "assistantMessage": {
    "id": "msg-xxx",
    "role": "assistant",
    "content": "GenesisPod 是一个...",
    "tokens": 120
  }
}
```

#### RAG 知识库问答

```typescript
POST /api/v1/ai-ask/sessions/:id/messages
{
  "content": "这个文档讲了什么？",
  "knowledgeBaseIds": ["kb-1", "kb-2"] // 指定知识库
}

Response:
{
  "userMessage": { /* ... */ },
  "assistantMessage": {
    "content": "根据知识库内容...\n\n---\n📚 *回答基于知识库内容*"
  },
  "ragSources": [
    {
      "documentTitle": "产品需求文档.pdf",
      "excerpt": "相关段落摘要...",
      "score": 0.89
    }
  ]
}
```

#### 工具调用模式（实验性）

```typescript
POST /api/v1/ai-ask/sessions/:id/messages
{
  "content": "搜索最新的 AI 新闻",
  "enableTools": true // 启用工具调用
}

Response:
{
  "assistantMessage": {
    "content": "根据搜索结果...\n\n---\n*使用了工具: web_search*"
  },
  "toolsUsed": ["web_search"]
}
```

### 3. 项目上下文自动注入

当用户提问包含以下关键词时，自动注入 GenesisPod 项目知识：

- "genesis"
- "这个项目"
- "ai studio"
- "ai office"
- "ai teams"
- 等

示例：

```
用户: "这个项目的架构是怎样的？"
系统: 自动识别为项目相关问题，注入项目架构文档
```

### 4. 积分消耗

| 操作类型 | 预估积分 |
| -------- | -------- |
| 普通对话 | 10 积分  |
| RAG 查询 | 15 积分  |

实际扣减基于模型返回的 token 数量。

---

## API 接口

### 会话管理

| 方法   | 路径                          | 说明         |
| ------ | ----------------------------- | ------------ |
| POST   | `/api/v1/ai-ask/sessions`     | 创建会话     |
| GET    | `/api/v1/ai-ask/sessions`     | 获取会话列表 |
| GET    | `/api/v1/ai-ask/sessions/:id` | 获取会话详情 |
| PATCH  | `/api/v1/ai-ask/sessions/:id` | 更新会话     |
| DELETE | `/api/v1/ai-ask/sessions/:id` | 删除会话     |

### 消息管理

| 方法 | 路径                                     | 说明         |
| ---- | ---------------------------------------- | ------------ |
| POST | `/api/v1/ai-ask/sessions/:id/messages`   | 发送消息     |
| GET  | `/api/v1/ai-ask/sessions/:id/messages`   | 获取消息历史 |
| POST | `/api/v1/ai-ask/messages/:id/regenerate` | 重新生成回复 |

### 其他

| 方法 | 路径                                      | 说明             |
| ---- | ----------------------------------------- | ---------------- |
| GET  | `/api/v1/ai-ask/sessions/search?q=关键词` | 搜索会话         |
| GET  | `/api/v1/ai-ask/tools`                    | 获取可用工具列表 |

---

## 数据模型

### AskSession

```prisma
model AskSession {
  id           String   @id @default(cuid())
  userId       String
  title        String   @default("New Chat")
  summary      String?
  modelId      String?  // 默认使用的模型
  isBookmarked Boolean  @default(false)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  messages     AskMessage[]
}
```

### AskMessage

```prisma
model AskMessage {
  id          String   @id @default(cuid())
  sessionId   String
  role        String   // "user" | "assistant" | "system"
  content     String   @db.Text
  modelId     String?
  modelName   String?
  tokens      Int      @default(0)
  webSearch   Boolean  @default(false)
  createdAt   DateTime @default(now())

  session     AskSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
}
```

---

## 配置项

### 上下文长度限制

```typescript
// ai-ask.service.ts
private readonly DEFAULT_CONTEXT_MESSAGES = 20; // 最多保留20条历史消息
const MAX_TOTAL_CHARS = 100000; // 约25000 tokens
const MAX_MESSAGE_LENGTH = 20000; // 单条消息最大长度
```

### Base64 图片处理

为避免 token 超限，系统会自动清理消息中的 base64 图片数据：

```typescript
// 替换 data:image/... 为 [图片已省略]
// 替换 Markdown 图片 ![xxx](data:image/...) 为 [图片已省略]
```

---

## 前端集成

### Hook 使用

```typescript
import { useAskSessions, useSendMessage } from '@/hooks/domain';

function AskPage() {
  const { sessions, loading, refresh } = useAskSessions();
  const { sendMessage, sending } = useSendMessage(sessionId);

  const handleSend = async (content: string) => {
    const result = await sendMessage({
      content,
      knowledgeBaseIds: selectedKBs, // 可选
      enableTools: false, // 可选
    });
    console.log(result.assistantMessage.content);
  };

  return <div>...</div>;
}
```

### 路由结构

```
/ai-ask
  ├── /                    # 会话列表
  └── /[sessionId]         # 会话详情/聊天界面
```

---

## 工具能力

### 可用工具（需启用 enableTools）

| 工具 ID             | 说明     | 状态 |
| ------------------- | -------- | ---- |
| `text_generation`   | 文本生成 | 可用 |
| `web_search`        | Web 搜索 | 可用 |
| `short_term_memory` | 短期记忆 | 可用 |

获取可用工具：

```typescript
GET /api/v1/ai-ask/tools

Response:
{
  "tools": ["text_generation", "web_search", "short_term_memory"]
}
```

---

## 使用指南

### 1. 创建会话并提问

```bash
# 1. 创建会话
curl -X POST https://api.gens.team/api/v1/ai-ask/sessions \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "测试会话"}'

# 2. 发送消息
curl -X POST https://api.gens.team/api/v1/ai-ask/sessions/SESSION_ID/messages \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "你好"}'
```

### 2. RAG 知识库问答

```bash
# 前提：已创建知识库并上传文档（通过 RAG 模块）

curl -X POST https://api.gens.team/api/v1/ai-ask/sessions/SESSION_ID/messages \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "这个文档的核心观点是什么？",
    "knowledgeBaseIds": ["kb-xxx"]
  }'
```

### 3. 查看 RAG 来源

前端渲染 `ragSources` 字段，显示引用来源：

```typescript
if (message.ragSources) {
  message.ragSources.forEach((source) => {
    console.log(`来源: ${source.documentTitle}`);
    console.log(`相关度: ${source.score}`);
    console.log(`摘要: ${source.excerpt}`);
  });
}
```

---

## 最佳实践

### 1. 合理使用知识库

- **精准指定**: 只选择相关的知识库，避免无关干扰
- **文档质量**: 上传结构清晰、内容准确的文档
- **更新维护**: 定期更新知识库内容

### 2. 控制上下文长度

- 系统会自动截断超长历史，但建议适时创建新会话
- 避免在单个会话中粘贴超大文本

### 3. 积分优化

- 普通问题使用对话模式（10 积分）
- 需要文档查询时才启用 RAG（15 积分）
- 工具调用会增加额外消耗

---

## 相关文档

- [RAG 模块文档](../rag/readme.md)
- [AI Engine 架构](../../../architecture/ai-engine.md)
- [积分系统说明](../../../guides/credits-system.md)
- [Teams 模式设计方案 v0.2](./teams-mode.md)
- [Teams 模式设计评审纪要 v1](./teams-mode-review.md)
- [Teams 模式 W1 代码评审纪要 v2](./teams-mode-review-v2.md)
- [Teams 模式 W2 PR3 代码评审纪要 v3](./teams-mode-review-v3.md)
- [Teams 模式 W3 PR4 代码评审纪要 v4](./teams-mode-review-v4.md)
- [Teams 模式 W4 PR5 代码评审纪要 v5](./teams-mode-review-v5.md)
- [Teams 模式 FE+W6 综合评审纪要 v6](./teams-mode-review-v6.md)
- [Teams 模式 v1.0 Release Notes](./teams-mode-release-notes.md)
- [Teams 模式性能基线](./teams-mode-perf-baseline.md)
- [ADR-004 AI Ask Teams 模式](../../../decisions/004-ai-ask-teams-mode.md)

---

## 更新日志

### v1.1 (2026-05-09)

- Teams 模式集成（多 AI 群聊 / 并行合并 / 辩论 / 投票 / 评审 / handoff）
- 6 种协作模式 adapter（FREECHAT / PARALLEL_MERGE / DEBATE / VOTE / REVIEW / HANDOFF）
- 房间持久化（AskRoomMember 软删 + AskRoomTurn）
- 流式 socket.io 推送（`/ai-ask-room` namespace，11 个 server event）
- 工具栏「团队」按钮入口；`/ai-ask/rooms/...` 房间页面
- 详见 [Teams 模式 v1.0 Release Notes](./teams-mode-release-notes.md)

### v1.0 (2026-01-15)

- 初始版本发布
- 多模型支持
- RAG 知识库集成
- 项目上下文自动注入
- 工具调用能力（实验性）
