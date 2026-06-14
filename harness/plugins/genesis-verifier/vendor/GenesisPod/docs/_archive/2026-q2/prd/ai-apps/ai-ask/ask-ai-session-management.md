# ASK AI 会话管理功能设计 v1.0

## 问题概述

当前 ASK AI 页面存在以下问题：

### 核心问题

1. **无会话概念**：每次对话都是独立的，AI 无法记住上下文
2. **无消息持久化**：刷新页面后所有聊天记录丢失
3. **无历史记录**：用户无法查看之前的对话

### 用户场景

- 用户问 "我是谁"，AI 回答不知道
- 用户说 "我是 AAA"
- 用户再问 "你知道我是谁吗"
- AI 回答 "我不知道" ← **问题：AI 没有上下文记忆**

---

## 功能需求

### 1. 会话管理

#### 1.1 会话列表（侧边栏）

```
┌─────────────────────┐
│ 🔍 Search           │
├─────────────────────┤
│ Today               │
│ ├ "我是谁" 讨论     │
│ └ BIS 出口管制研究  │
├─────────────────────┤
│ Yesterday           │
│ ├ 代码审查问题      │
│ └ API 设计讨论      │
├─────────────────────┤
│ Last 7 days         │
│ ├ ...               │
└─────────────────────┘
```

#### 1.2 会话操作

- **新建会话**：点击 "+" 按钮创建新会话
- **切换会话**：点击列表中的会话切换
- **重命名会话**：双击标题或右键菜单
- **删除会话**：右键菜单或滑动删除
- **搜索会话**：按标题或内容搜索

### 2. 消息上下文

#### 2.1 上下文传递

- 每次发送消息时，将最近 N 条消息作为上下文传给 AI
- 默认保留最近 20 条消息（可配置）
- 支持摘要模式：超过阈值时自动生成摘要

#### 2.2 消息存储

- 持久化存储所有消息到数据库
- 支持消息编辑和重新生成
- 支持消息复制和分享

### 3. 数据模型

#### 3.1 新增数据表

```prisma
// 会话表
model AskSession {
  id          String   @id @default(uuid())
  userId      String   @map("user_id")
  title       String   @db.VarChar(200)
  summary     String?  @db.Text  // AI 生成的会话摘要
  modelId     String?  @map("model_id")  // 默认使用的模型

  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  messages    AskMessage[]

  @@index([userId, updatedAt])
  @@map("ask_sessions")
}

// 消息表
model AskMessage {
  id          String   @id @default(uuid())
  sessionId   String   @map("session_id")
  role        String   @db.VarChar(20)  // user, assistant, system
  content     String   @db.Text
  modelId     String?  @map("model_id")  // 使用的模型
  modelName   String?  @map("model_name") @db.VarChar(100)

  // 元数据
  tokens      Int?     // token 使用量
  webSearch   Boolean  @default(false) @map("web_search")

  createdAt   DateTime @default(now()) @map("created_at")

  session     AskSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId, createdAt])
  @@map("ask_messages")
}
```

### 4. API 设计

#### 4.1 会话 API

```typescript
// 创建会话
POST /api/v1/ask/sessions
Body: { title?: string, modelId?: string }
Response: AskSession

// 获取会话列表
GET /api/v1/ask/sessions?page=1&limit=20
Response: { sessions: AskSession[], total: number }

// 获取单个会话（含消息）
GET /api/v1/ask/sessions/:id
Response: { session: AskSession, messages: AskMessage[] }

// 更新会话
PATCH /api/v1/ask/sessions/:id
Body: { title?: string, modelId?: string }

// 删除会话
DELETE /api/v1/ask/sessions/:id
```

#### 4.2 消息 API

```typescript
// 发送消息（带上下文）
POST /api/v1/ask/sessions/:sessionId/messages
Body: {
  content: string,
  modelId?: string,
  webSearch?: boolean,
  stream?: boolean
}
Response: { userMessage: AskMessage, assistantMessage: AskMessage }

// 获取会话消息
GET /api/v1/ask/sessions/:sessionId/messages?limit=50&before=timestamp
Response: { messages: AskMessage[], hasMore: boolean }

// 重新生成消息
POST /api/v1/ask/sessions/:sessionId/messages/:messageId/regenerate
Response: AskMessage

// 编辑消息并重新生成
PUT /api/v1/ask/sessions/:sessionId/messages/:messageId
Body: { content: string }
Response: { editedMessage: AskMessage, newResponse: AskMessage }
```

### 5. 前端改造

#### 5.1 页面结构

```
┌──────────────────────────────────────────────────────────────┐
│ Sidebar │                    Main Area                        │
│ (sessions)│                                                   │
├──────────────────────────────────────────────────────────────┤
│ [+] New  │  ┌─────────────────────────────────────────────┐  │
│          │  │ Messages                                     │  │
│ Today    │  │                                              │  │
│ • Chat1  │  │ User: 我是谁                                 │  │
│ • Chat2  │  │                                              │  │
│          │  │ GPT: 这是一个哲学问题...                     │  │
│ Yesterday│  │                                              │  │
│ • Chat3  │  │ User: 我是AAA                                │  │
│          │  │                                              │  │
│          │  │ GPT: 你好AAA，很高兴认识你                   │  │
│          │  │                                              │  │
│          │  │ User: 你知道我是谁吗                         │  │
│          │  │                                              │  │
│          │  │ GPT: 是的，你刚才告诉我你是AAA ✓            │  │
│          │  └─────────────────────────────────────────────┘  │
│          │  ┌─────────────────────────────────────────────┐  │
│          │  │ Input area                                   │  │
│          │  └─────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

#### 5.2 组件拆分

```
/app/ask/
├── page.tsx              # 主页面（路由组件）
├── layout.tsx            # 布局（包含侧边栏）
└── [sessionId]/
    └── page.tsx          # 会话详情页

/components/ask/
├── SessionSidebar.tsx    # 会话列表侧边栏
├── SessionList.tsx       # 会话列表
├── SessionItem.tsx       # 单个会话项
├── MessageList.tsx       # 消息列表
├── MessageItem.tsx       # 单条消息
├── ChatInput.tsx         # 输入框组件
└── ModelSelector.tsx     # 模型选择器
```

---

## 实现计划

### 第一阶段：基础会话功能（P0）

| 任务                             | 工作量 |
| -------------------------------- | ------ |
| 创建数据库迁移                   | 1h     |
| 实现后端 Session CRUD            | 4h     |
| 实现后端 Message API（带上下文） | 4h     |
| 改造前端页面结构                 | 4h     |
| 实现会话列表侧边栏               | 3h     |
| 实现消息列表和输入               | 3h     |

### 第二阶段：增强功能（P1）

| 任务                        | 工作量 |
| --------------------------- | ------ |
| 消息重新生成                | 2h     |
| 消息编辑                    | 2h     |
| 会话搜索                    | 2h     |
| 会话自动命名（AI 生成标题） | 2h     |
| 流式响应优化                | 3h     |

### 第三阶段：高级功能（P2）

| 任务                 | 工作量 |
| -------------------- | ------ |
| 会话摘要（超长对话） | 4h     |
| 消息分享/导出        | 3h     |
| 会话分支（Fork）     | 4h     |
| 多模型对比模式       | 4h     |

---

## 技术要点

### 1. 上下文管理策略

```typescript
async function buildContext(
  sessionId: string,
  maxMessages = 20,
): Promise<Message[]> {
  // 1. 获取最近的消息
  const messages = await getRecentMessages(sessionId, maxMessages);

  // 2. 计算 token 总量
  const totalTokens = messages.reduce(
    (sum, m) => sum + estimateTokens(m.content),
    0,
  );

  // 3. 如果超过阈值，进行截断或摘要
  if (totalTokens > MAX_CONTEXT_TOKENS) {
    // 策略1: 简单截断
    // 策略2: 保留首尾 + 中间摘要
    // 策略3: 基于重要性排序
  }

  return messages;
}
```

### 2. 自动命名策略

```typescript
// 第一条消息发送后，AI 自动生成标题
async function generateSessionTitle(firstMessage: string): Promise<string> {
  const response = await ai.chat({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: "请为以下对话生成一个简短的标题（不超过20个字）：",
      },
      { role: "user", content: firstMessage },
    ],
    maxTokens: 30,
  });
  return response.content.trim();
}
```

### 3. 流式响应处理

```typescript
// 使用 Server-Sent Events 实现流式响应
app.post('/ask/sessions/:id/messages', async (req, res) => {
  if (req.body.stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');

    const stream = await ai.chatStream({...});
    for await (const chunk of stream) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
    res.end();
  } else {
    // 非流式响应
  }
});
```

---

## 成功指标

| 指标         | 当前值 | 目标值           |
| ------------ | ------ | ---------------- |
| 上下文保持率 | 0%     | 100%（同会话内） |
| 消息持久化   | 0%     | 100%             |
| 会话恢复     | 不支持 | 支持             |
| 用户满意度   | -      | >80%             |

---

## 风险与缓解

| 风险           | 影响 | 缓解措施                 |
| -------------- | ---- | ------------------------ |
| Token 成本增加 | 高   | 上下文截断策略、摘要压缩 |
| 存储成本       | 中   | 定期清理旧会话、压缩存储 |
| 响应延迟       | 中   | 流式响应、并行加载       |
| 数据迁移       | 低   | 新旧 API 兼容期          |

---

## 总结

ASK AI 会话管理功能是提升用户体验的关键改进。通过引入会话概念和消息持久化，用户可以：

1. **连续对话**：AI 记住上下文，对话更自然
2. **历史回顾**：随时查看之前的对话记录
3. **会话管理**：组织和搜索多个对话主题

建议按优先级分阶段实施，第一阶段聚焦核心的会话和上下文功能。
