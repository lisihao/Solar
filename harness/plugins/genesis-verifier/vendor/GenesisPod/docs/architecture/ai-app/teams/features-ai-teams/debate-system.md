# AI Teams 辩论系统

## Multi-Agent Debate System Design

**版本**: v1.0
**创建日期**: 2025-12-17

---

## 一、概述

辩论系统是 AI Teams 的特色功能，支持两个或多个 AI Agent 就特定主题进行轮流辩论。系统采用独立会话机制，确保辩论上下文与普通聊天隔离。

---

## 二、核心设计

### 2.1 独立会话机制

```
┌─────────────────────────────────────────────────────────┐
│                    Topic (普通聊天)                      │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐              │
│  │Msg 1│ │Msg 2│ │Msg 3│ │Msg 4│ │Msg 5│  ...         │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘              │
└─────────────────────────────────────────────────────────┘
                         │
                         │ 辩论触发
                         ▼
┌─────────────────────────────────────────────────────────┐
│              DebateSession (独立会话)                    │
│                                                         │
│  ┌─────────────────┐      ┌─────────────────┐         │
│  │   RED Agent     │      │   BLUE Agent    │         │
│  │ conversationHist│      │ conversationHist│         │
│  │ [独立历史记录]   │      │ [独立历史记录]   │         │
│  └─────────────────┘      └─────────────────┘         │
│                                                         │
│  ┌─────────────────────────────────────────────────┐  │
│  │          DebateMessages (辩论消息)               │  │
│  │  Round 1: RED → BLUE                            │  │
│  │  Round 2: RED → BLUE                            │  │
│  │  Round 3: RED → BLUE                            │  │
│  └─────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                         │
                         │ 同步 (可选)
                         ▼
┌─────────────────────────────────────────────────────────┐
│                    Topic (普通聊天)                      │
│  ... │Debate Msg 1│ │Debate Msg 2│ │Debate Msg 3│ ...  │
└─────────────────────────────────────────────────────────┘
```

### 2.2 为什么需要独立会话

| 问题             | 解决方案                  |
| ---------------- | ------------------------- |
| 普通聊天干扰辩论 | 独立 conversationHistory  |
| 上下文混乱       | 每个 Agent 只看到辩论消息 |
| 历史记录污染     | DebateMessage 独立存储    |
| 角色混淆         | 明确的 RED/BLUE 角色分配  |

---

## 三、数据模型

### 3.1 DebateSession

```typescript
model DebateSession {
  id              String   @id @default(cuid())
  topicId         String              // 所属 Topic
  topic           String              // 辩论主题
  status          DebateStatus        // 状态
  maxRounds       Int      @default(3) // 最大轮数
  currentRound    Int      @default(0) // 当前轮数
  roundTimeoutMs  Int?                // 单轮超时

  // Relations
  agents          DebateAgent[]       // 参与 Agent
  messages        DebateMessage[]     // 辩论消息

  // Timeline
  initiatedById   String
  createdAt       DateTime @default(now())
  completedAt     DateTime?
}
```

### 3.2 DebateAgent

```typescript
model DebateAgent {
  id              String   @id @default(cuid())
  sessionId       String              // 所属会话
  aiMemberId      String              // 对应的 TopicAIMember
  displayName     String              // 显示名称
  aiModel         String              // AI 模型

  // Role
  role            DebateRole          // RED/BLUE/JUDGE/OBSERVER
  stance          String?             // 立场描述
  stancePrompt    String?             // 立场提示词

  // Context (关键：独立历史)
  conversationHistory Json @default("[]")  // 独立对话历史

  // Stats
  messageCount    Int      @default(0)
  totalTokens     Int      @default(0)

  // Relations
  session         DebateSession @relation(...)
  messages        DebateMessage[]
}
```

### 3.3 DebateMessage

```typescript
model DebateMessage {
  id              String   @id @default(cuid())
  sessionId       String              // 所属会话
  agentId         String              // 发送者 Agent
  content         String              // 消息内容
  round           Int                 // 轮次

  // Stats
  modelUsed       String?
  tokensUsed      Int?
  latencyMs       Int?

  // Sync
  topicMessageId  String?             // 同步到 Topic 的消息 ID

  // Timeline
  createdAt       DateTime @default(now())

  // Relations
  session         DebateSession @relation(...)
  agent           DebateAgent @relation(...)
}
```

### 3.4 状态枚举

```typescript
enum DebateStatus {
  PENDING     // 待开始
  ACTIVE      // 进行中
  PAUSED      // 暂停
  COMPLETED   // 已完成
  CANCELLED   // 已取消
}

enum DebateRole {
  RED         // 正方/支持方
  BLUE        // 反方/反对方
  JUDGE       // 裁判 (可选)
  OBSERVER    // 观察者 (可选)
}
```

---

## 四、辩论触发

### 4.1 检测逻辑

```typescript
// ai-teams.controller.ts
private detectDebateMode(
  content: string,
  aiMembers: Array<{ id: string; displayName: string }>
): DebateDetectionResult {
  // 条件 1: 至少 @2 个 AI
  if (aiMembers.length < 2) {
    return { isDebate: false, redAI: null, blueAI: null, topic: '' };
  }

  // 条件 2: 包含辩论关键词
  const debateKeywords = [
    '辩论', '思辨', '红蓝', '对决', 'PK', '正反方',
    'debate', '讨论', '争论', '对抗'
  ];

  const hasDebateKeyword = debateKeywords.some(
    kw => content.toLowerCase().includes(kw.toLowerCase())
  );

  if (!hasDebateKeyword) {
    return { isDebate: false, redAI: null, blueAI: null, topic: '' };
  }

  // 分配角色 (第一个 AI 为 RED，第二个为 BLUE)
  const [redAI, blueAI] = aiMembers;

  // 提取辩论主题 (去除 @mentions 和关键词)
  const topic = this.extractDebateTopic(content);

  return {
    isDebate: true,
    redAI,
    blueAI,
    topic
  };
}
```

### 4.2 Controller 处理

```typescript
// 在 sendMessage 中
if (debateInfo.isDebate && debateInfo.redAI && debateInfo.blueAI) {
  this.logger.log(
    `[Debate] Starting: Red=${debateInfo.redAI.displayName}, Blue=${debateInfo.blueAI.displayName}`,
  );

  // 异步启动辩论
  this.runDebateInBackground(
    topicId,
    req.user.id,
    debateInfo.topic,
    debateInfo.redAI.id,
    debateInfo.blueAI.id,
  );

  // 其他 AI 作为观察者
  for (const ai of aiMembersToRespond) {
    if (ai.id !== debateInfo.redAI.id && ai.id !== debateInfo.blueAI.id) {
      // 延迟 4 秒后让观察者发表意见
      setTimeout(() => {
        this.generateAIResponseInBackground(
          topicId,
          req.user.id,
          ai.id,
          0,
          null,
        );
      }, 4000);
    }
  }
}
```

---

## 五、辩论执行

### 5.1 创建会话

```typescript
// debate.service.ts
async createDebateSession(
  topicId: string,
  userId: string,
  topic: string,
  redAIMemberId: string,
  blueAIMemberId: string
): Promise<DebateSession> {
  // 获取 AI 成员信息
  const [redMember, blueMember] = await Promise.all([
    this.prisma.topicAIMember.findUnique({ where: { id: redAIMemberId } }),
    this.prisma.topicAIMember.findUnique({ where: { id: blueAIMemberId } })
  ]);

  // 创建会话
  const session = await this.prisma.debateSession.create({
    data: {
      topicId,
      topic,
      status: DebateStatus.PENDING,
      maxRounds: 3,
      initiatedById: userId,
      agents: {
        create: [
          {
            aiMemberId: redAIMemberId,
            displayName: redMember.displayName,
            aiModel: redMember.aiModel,
            role: DebateRole.RED,
            stance: '支持方',
            stancePrompt: this.buildStancePrompt(DebateRole.RED, topic),
            conversationHistory: [],  // 独立历史
          },
          {
            aiMemberId: blueAIMemberId,
            displayName: blueMember.displayName,
            aiModel: blueMember.aiModel,
            role: DebateRole.BLUE,
            stance: '反对方',
            stancePrompt: this.buildStancePrompt(DebateRole.BLUE, topic),
            conversationHistory: [],  // 独立历史
          }
        ]
      }
    },
    include: { agents: true }
  });

  return session;
}
```

### 5.2 执行辩论轮次

```typescript
async executeDebateRound(
  sessionId: string,
  agent: DebateAgent,
  opponentLastMessage?: string
): Promise<DebateMessage> {
  // 1. 获取 Agent 的独立历史
  const conversationHistory = agent.conversationHistory as any[];

  // 2. 构建提示词
  const prompt = this.buildDebatePrompt(agent, opponentLastMessage);

  // 3. 构建消息上下文 (仅包含辩论消息)
  const messages = [
    { role: 'system', content: this.getDebateSystemPrompt(agent) },
    ...conversationHistory.map(h => ({
      role: h.role,
      content: h.content
    })),
    { role: 'user', content: prompt }
  ];

  // 4. 调用 AI
  const startTime = Date.now();
  const aiResponse = await this.callAI(agent.aiModel, messages);
  const latencyMs = Date.now() - startTime;

  // 5. 创建辩论消息
  const debateMessage = await this.prisma.debateMessage.create({
    data: {
      sessionId,
      agentId: agent.id,
      content: aiResponse.content,
      round: Math.floor((conversationHistory.length + 1) / 2),
      modelUsed: agent.aiModel,
      tokensUsed: aiResponse.tokensUsed,
      latencyMs,
    }
  });

  // 6. 更新 Agent 的独立历史
  await this.prisma.debateAgent.update({
    where: { id: agent.id },
    data: {
      conversationHistory: [
        ...conversationHistory,
        { role: 'assistant', content: aiResponse.content }
      ],
      messageCount: { increment: 1 },
      totalTokens: { increment: aiResponse.tokensUsed || 0 }
    }
  });

  return debateMessage;
}
```

### 5.3 完整辩论流程

```typescript
async runDebate(sessionId: string): Promise<void> {
  const session = await this.prisma.debateSession.findUnique({
    where: { id: sessionId },
    include: { agents: true }
  });

  // 更新状态为 ACTIVE
  await this.prisma.debateSession.update({
    where: { id: sessionId },
    data: { status: DebateStatus.ACTIVE }
  });

  const redAgent = session.agents.find(a => a.role === DebateRole.RED);
  const blueAgent = session.agents.find(a => a.role === DebateRole.BLUE);

  let lastMessage: string | null = null;

  for (let round = 1; round <= session.maxRounds; round++) {
    // 更新当前轮数
    await this.prisma.debateSession.update({
      where: { id: sessionId },
      data: { currentRound: round }
    });

    // RED 发言
    const redMessage = await this.executeDebateRound(
      sessionId, redAgent, lastMessage
    );

    // 同步到 Topic
    await this.syncMessageToTopic(session.topicId, redAgent, redMessage);

    // 延迟
    await sleep(2000);

    // BLUE 发言
    const blueMessage = await this.executeDebateRound(
      sessionId, blueAgent, redMessage.content
    );

    // 同步到 Topic
    await this.syncMessageToTopic(session.topicId, blueAgent, blueMessage);

    lastMessage = blueMessage.content;

    // 延迟下一轮
    if (round < session.maxRounds) {
      await sleep(3000);
    }
  }

  // 完成辩论
  await this.completeDebate(sessionId);
}
```

---

## 六、提示词设计

### 6.1 系统提示词

```typescript
private getDebateSystemPrompt(agent: DebateAgent): string {
  const roleDescriptions = {
    [DebateRole.RED]: '正方/支持方',
    [DebateRole.BLUE]: '反方/反对方',
    [DebateRole.JUDGE]: '裁判',
    [DebateRole.OBSERVER]: '观察者',
  };

  return `你是一位专业的辩论者，担任 ${roleDescriptions[agent.role]}。

## 辩论规则
1. 保持逻辑清晰，论点有力
2. 引用事实和数据支持观点
3. 尊重对方，但坚定维护己方立场
4. 回应对方论点，不要回避关键问题
5. 每次发言控制在 200-400 字

## 你的立场
${agent.stancePrompt}

## 注意事项
- 你的角色是 ${roleDescriptions[agent.role]}
- 不要改变立场
- 不要承认对方完全正确
- 保持辩论的专业性和建设性`;
}
```

### 6.2 辩论提示词

```typescript
private buildDebatePrompt(
  agent: DebateAgent,
  opponentLastMessage?: string
): string {
  if (agent.role === DebateRole.RED && !opponentLastMessage) {
    // 开场
    return `作为正方，请就「${this.currentTopic}」发表你的开场陈述。

阐述你支持这一观点的主要理由，并提出 2-3 个核心论点。`;
  }

  if (agent.role === DebateRole.BLUE && opponentLastMessage) {
    return `对方的发言：
${opponentLastMessage}

作为反方，请回应对方的论点，并阐述你反对的理由。`;
  }

  if (agent.role === DebateRole.RED && opponentLastMessage) {
    return `对方的发言：
${opponentLastMessage}

请回应对方的质疑，并进一步强化你的论点。`;
  }

  return '请继续你的发言。';
}
```

---

## 七、同步到 Topic

### 7.1 实时同步

```typescript
private async syncMessageToTopic(
  topicId: string,
  agent: DebateAgent,
  debateMessage: DebateMessage
): Promise<void> {
  // 1. 创建 Topic 消息
  const topicMessage = await this.prisma.topicMessage.create({
    data: {
      topicId,
      aiMemberId: agent.aiMemberId,
      content: debateMessage.content,
      contentType: MessageContentType.TEXT,
      modelUsed: debateMessage.modelUsed,
      tokensUsed: debateMessage.tokensUsed,
    }
  });

  // 2. 更新 DebateMessage 的同步引用
  await this.prisma.debateMessage.update({
    where: { id: debateMessage.id },
    data: { topicMessageId: topicMessage.id }
  });

  // 3. WebSocket 广播
  this.aiTeamsGateway.emitToTopic(topicId, 'message:new', topicMessage);
  this.aiTeamsGateway.emitToTopic(topicId, 'ai:response', {
    aiMemberId: agent.aiMemberId,
    messageId: topicMessage.id,
  });
}
```

---

## 八、辩论完成

```typescript
async completeDebate(sessionId: string): Promise<void> {
  // 1. 更新状态
  await this.prisma.debateSession.update({
    where: { id: sessionId },
    data: {
      status: DebateStatus.COMPLETED,
      completedAt: new Date()
    }
  });

  // 2. 获取会话信息
  const session = await this.prisma.debateSession.findUnique({
    where: { id: sessionId },
    include: { agents: true, messages: true }
  });

  // 3. 发送完成消息
  await this.sendSystemMessage(
    session.topicId,
    `辩论结束！\n\n主题：${session.topic}\n轮数：${session.maxRounds}\n` +
    `RED 发言数：${session.agents.find(a => a.role === 'RED')?.messageCount}\n` +
    `BLUE 发言数：${session.agents.find(a => a.role === 'BLUE')?.messageCount}`
  );

  // 4. 广播状态
  this.aiTeamsGateway.emitToTopic(session.topicId, 'debate:completed', {
    sessionId,
    topic: session.topic,
  });
}
```

---

## 九、高级功能

### 9.1 裁判角色 (可选)

```typescript
// 辩论结束后可由 JUDGE 做总结
async generateJudgeVerdict(sessionId: string): Promise<string> {
  const session = await this.getSessionWithMessages(sessionId);
  const judge = session.agents.find(a => a.role === DebateRole.JUDGE);

  if (!judge) {
    throw new Error('No judge assigned');
  }

  const verdictPrompt = this.buildJudgePrompt(session);

  const response = await this.callAI(judge.aiModel, [
    { role: 'system', content: this.getJudgeSystemPrompt() },
    { role: 'user', content: verdictPrompt }
  ]);

  return response.content;
}
```

### 9.2 辩论暂停/恢复

```typescript
async pauseDebate(sessionId: string): Promise<void> {
  await this.prisma.debateSession.update({
    where: { id: sessionId },
    data: { status: DebateStatus.PAUSED }
  });
}

async resumeDebate(sessionId: string): Promise<void> {
  const session = await this.prisma.debateSession.findUnique({
    where: { id: sessionId }
  });

  if (session.status !== DebateStatus.PAUSED) {
    throw new Error('Can only resume paused debates');
  }

  await this.prisma.debateSession.update({
    where: { id: sessionId },
    data: { status: DebateStatus.ACTIVE }
  });

  // 继续执行剩余轮次
  this.runDebate(sessionId);
}
```

---

## 十、最佳实践

### 10.1 辩论主题建议

| 类型     | 示例                              |
| -------- | --------------------------------- |
| 技术选型 | "React vs Vue 哪个更适合企业项目" |
| 策略讨论 | "远程工作是否会成为主流"          |
| 观点争鸣 | "AI 是否会取代程序员"             |
| 方案对比 | "微服务 vs 单体架构"              |

### 10.2 角色分配原则

1. **不同模型**: 使用不同 AI 模型增加多样性
2. **专长匹配**: 根据 AI 专长分配立场
3. **公平性**: 双方发言顺序和次数平等

### 10.3 轮数设置

| 场景     | 建议轮数 |
| -------- | -------- |
| 快速讨论 | 2 轮     |
| 标准辩论 | 3 轮     |
| 深度分析 | 5 轮     |
