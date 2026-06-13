# AI Group 产品优化方案 v1.1

## 问题概述

根据实际使用测试，发现 AI Group 的 Team Mission 功能存在以下核心问题：

### 问题1: 任务执行闭环断裂

- **现象**: Leader AI (小C) 给出"需修改完善后再提交审核"的反馈后，被反馈的 AI (小F) 没有继续执行修改，任务卡住
- **影响**: 任务无法正常完成，用户需要手动干预

### 问题2: 内容理解深度不足

- **现象**: AI 对专业内容（如 BIS EAR 出口管制条款）的理解远不如竞品 Genspark
- **对比**: 我们只输出基本条款列表，Genspark 能输出完整条款文本、子条款细节、技术说明

---

## 问题1详细分析: 任务闭环断裂

### 根本原因

#### 1.1 状态转移链路断裂

**当前流程：**

```
任务完成 → Leader 审核 → 判断"需修改" → 标记 REVISION_NEEDED → 调用 executeTaskRevision()
                                                                           ↓
                                                            [流程断裂点]
                                                                           ↓
                                              executeNextTasks() 只查询 PENDING 状态，忽略修改中的任务
```

**问题代码位置**: `team-mission.service.ts` 第 349-350 行

```typescript
const pendingTasks = mission.tasks.filter(
  (t) => t.status === AgentTaskStatus.PENDING,
);
```

#### 1.2 修改完成后无法重新进入审核流程

**问题**: `executeTaskRevision()` 完成后，任务状态变为 `AWAITING_REVIEW`，但没有机制触发再次审核

#### 1.3 任务完成判断过于严格

**问题代码位置**: `team-mission.service.ts` 第 369-373 行

```typescript
const allCompleted = mission.tasks.every(
  (t) => t.status === AgentTaskStatus.COMPLETED,
);
```

只有所有任务都是 `COMPLETED` 才会结束 Mission，导致有 `REVISION_NEEDED` 的任务会永久卡住。

### 解决方案

#### 方案 A: 完善状态机设计 (推荐)

```
新增状态转移规则：

REVISION_NEEDED → (自动触发) → IN_PROGRESS (修改中)
                                    ↓
                             AWAITING_REVIEW (等待审核)
                                    ↓
                    ┌───────────────┴───────────────┐
                    ↓                               ↓
              (审核通过)                      (需要继续修改)
                    ↓                               ↓
              COMPLETED                   REVISION_NEEDED (循环)
                                                    ↓
                                          (达到最大修改次数)
                                                    ↓
                                             COMPLETED (强制)
```

#### 方案 B: 增加任务轮询机制

```typescript
// 新增定时任务，每 30 秒检查一次
async checkStuckTasks() {
  const stuckTasks = await this.prisma.agentTask.findMany({
    where: {
      status: { in: ['AWAITING_REVIEW', 'REVISION_NEEDED'] },
      updatedAt: { lt: new Date(Date.now() - 60000) } // 超过 1 分钟未更新
    }
  });

  for (const task of stuckTasks) {
    await this.resumeTask(task);
  }
}
```

#### 方案 C: 增加状态监控和告警

```typescript
// 在关键状态转移处增加日志和监控
await this.logger.log(
  `[TaskFlow] Task ${task.id} status: ${oldStatus} → ${newStatus}`,
);
await this.monitoringService.trackTaskFlow(
  mission.id,
  task.id,
  oldStatus,
  newStatus,
);
```

### 具体实现任务

| 优先级 | 任务                                        | 工作量 |
| ------ | ------------------------------------------- | ------ |
| P0     | 修复 executeNextTasks 只查询 PENDING 的问题 | 2h     |
| P0     | 修复 executeTaskRevision 完成后的审核触发   | 4h     |
| P1     | 添加任务状态转移日志                        | 2h     |
| P1     | 添加卡住任务检测和告警                      | 4h     |
| P2     | 添加任务超时处理机制                        | 4h     |
| P2     | 优化 parseReviewResult 判断逻辑             | 2h     |

---

## 问题2详细分析: 内容理解深度不足

### 根本原因

#### 2.1 URL 内容提取太浅

**当前限制**:

- 只提取 500 字摘要 (第 678 行)
- 无法识别文档结构
- 对政府/技术文档支持差

**代码位置**: `url-parser.service.ts` 第 654-680 行

```typescript
const cleanText = text.replace(/\s+/g, " ").trim().slice(0, 5000);
result.extractedContent = {
  summary: cleanText.slice(0, 500) + "...", // 只保留 500 字!
};
```

#### 2.2 上下文窗口太小

**当前限制**:

- 最多 15 条消息
- 简单规则评分，无语义理解

**代码位置**: `ai-group.service.ts` 第 1604 行

```typescript
const MAX_CONTEXT_MESSAGES = 15;
```

#### 2.3 缺乏专业知识库

**问题**: 完全依赖用户输入的 URL 内容，没有行业知识补充

#### 2.4 搜索能力有限

**当前限制**:

- 仅 5 条搜索结果
- 被动触发（用户说"搜索"才触发）
- 无多源搜索

### 解决方案

#### 方案 A: 增强内容解析深度 (推荐)

```typescript
// 升级 extractMainContent
private async extractMainContent(html: string, result: ParsedUrl): Promise<void> {
  // 1. 增加摘要长度到 2000 字
  const cleanText = text.slice(0, 10000);
  result.extractedContent = {
    summary: cleanText.slice(0, 2000),  // 4倍提升
    keyPoints: this.extractKeyPoints(cleanText),  // 新增: 提取关键点
    structure: this.parseDocumentStructure(html),  // 新增: 解析文档结构
  };

  // 2. 识别特殊文档类型
  if (this.isGovernmentDocument(url)) {
    result.extractedContent.regulations = this.parseRegulations(html);
  }
}
```

#### 方案 B: 智能内容分块

```typescript
// 对于长文档，分块处理
async parseUrlWithChunking(url: string): Promise<ParsedUrl> {
  const fullContent = await this.fetchFullContent(url);

  // 分块
  const chunks = this.splitIntoChunks(fullContent, 2000);

  // 对每块生成摘要
  const summaries = await Promise.all(
    chunks.map(chunk => this.summarizeChunk(chunk))
  );

  // 合并
  return {
    ...baseInfo,
    extractedContent: {
      sections: summaries,
      keyPoints: this.extractKeyPoints(summaries),
    }
  };
}
```

#### 方案 C: 增加主动搜索能力

```typescript
// 智能判断是否需要搜索
private shouldSearch(context: string, userMessage: string): boolean {
  return (
    // 涉及专业术语
    this.containsProfessionalTerms(userMessage) ||
    // 需要最新信息
    this.needsRealtimeInfo(userMessage) ||
    // 提到了权威来源
    this.mentionsAuthoritativeSource(userMessage) ||
    // 上下文信息不足
    this.contextIsInsufficient(context, userMessage)
  );
}
```

#### 方案 D: 增加专业知识库 (长期)

```
专业知识库架构:

┌─────────────────────────────────────────┐
│           Knowledge Base Layer           │
├─────────────────────────────────────────┤
│  ┌─────────┐  ┌─────────┐  ┌─────────┐ │
│  │  法规库  │  │ 技术标准 │  │ 行业术语 │ │
│  │ BIS EAR │  │  IEEE   │  │  定义库  │ │
│  │  ECCN   │  │   ISO   │  │         │ │
│  └─────────┘  └─────────┘  └─────────┘ │
├─────────────────────────────────────────┤
│         Vector Search Engine            │
│        (Embedding + Similarity)         │
└─────────────────────────────────────────┘
```

### 具体实现任务

| 优先级 | 任务                        | 工作量 | 效果预期          |
| ------ | --------------------------- | ------ | ----------------- |
| P0     | 增加 URL 摘要长度到 2000 字 | 1h     | 内容量提升 4 倍   |
| P0     | 增加文档结构解析            | 4h     | 支持标题/章节识别 |
| P1     | 增加上下文窗口到 30 条      | 2h     | 对话深度提升 2 倍 |
| P1     | 优化搜索触发逻辑            | 4h     | 更智能的信息补充  |
| P2     | 增加政府文档解析器          | 8h     | 专业文档支持      |
| P2     | 增加多源搜索                | 8h     | 信息覆盖更全面    |
| P3     | 建设专业知识库              | 40h+   | 长期能力建设      |

---

## 实施计划

### 第一阶段: 紧急修复 (1-2天)

1. **修复任务闭环问题**
   - 修复 `executeNextTasks` 状态查询逻辑
   - 修复 `executeTaskRevision` 后的审核触发
   - 添加基本日志监控

2. **增强内容解析**
   - 增加 URL 摘要长度到 2000 字
   - 增加上下文窗口到 30 条

### 第二阶段: 能力提升 (1周)

1. **完善任务执行机制**
   - 添加任务状态监控
   - 添加超时处理
   - 优化反馈判断逻辑

2. **增强内容理解**
   - 添加文档结构解析
   - 优化搜索触发逻辑
   - 添加关键点提取

### 第三阶段: 长期建设 (1-2月)

1. **专业能力建设**
   - 建设专业知识库
   - 添加多源搜索
   - 添加领域优化

---

## 成功指标

| 指标         | 当前值 | 目标值  | 衡量方式                  |
| ------------ | ------ | ------- | ------------------------- |
| 任务完成率   | ~60%   | >95%    | 自动完成 vs 手动干预      |
| 内容理解深度 | 500字  | 2000字+ | URL 摘要长度              |
| 上下文消息数 | 15条   | 30条    | 对话历史覆盖              |
| 修改闭环率   | 0%     | 100%    | Leader 反馈后的修改完成率 |

---

## 风险评估

| 风险           | 影响 | 缓解措施                   |
| -------------- | ---- | -------------------------- |
| Token 成本增加 | 中   | 动态调整上下文长度         |
| 响应延迟增加   | 中   | 异步处理、缓存优化         |
| 任务死循环     | 高   | 最大修改次数限制、超时机制 |

---

## 总结

本次优化聚焦两个核心问题：

1. **任务闭环**: 修复状态机设计缺陷，确保 Leader 反馈后任务能正确闭环
2. **内容理解**: 增强 URL 解析深度和上下文管理，提升 AI 专业内容理解能力

通过分阶段实施，预计能在 1-2 周内解决紧急问题，1-2 月内完成能力全面提升。
