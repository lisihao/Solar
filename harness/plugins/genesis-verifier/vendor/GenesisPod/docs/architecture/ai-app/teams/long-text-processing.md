# AI Teams 长文本处理完整方案

> 版本：1.0
> 更新日期：2025-01-04
> 作者：Claude Code

---

## 一、问题定义

```
┌─────────────────────────────────────────────────────────────────┐
│                        核心挑战                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. LLM 上下文窗口限制（4K-128K tokens）                         │
│     但任务数据可能是无限的（几十万字、上百条分析结果）              │
│                                                                 │
│  2. 需要解决的场景：                                             │
│     - 长篇小说创作（80+ 章节）                                   │
│     - 深度研究报告（大量数据支撑）                                │
│     - 洞察分析（多维度数据处理）                                  │
│     - 文档审核（保证质量和一致性）                                │
│                                                                 │
│  3. 核心矛盾：                                                   │
│     - 审核/分析需要理解全部内容 → 但上下文有限                    │
│     - 最终报告需要完整输出 → 不能丢失任何数据                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 二、解决方案架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         AI Teams 长文本处理架构                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    第一层：数据存储（完整保留）                        │   │
│  │                                                                     │   │
│  │   Agent 产出 → task.result（完整原文）→ PostgreSQL                  │   │
│  │                                                                     │   │
│  │   ✓ 所有原始数据永不丢失                                            │   │
│  │   ✓ 每个任务产出完整存储在数据库                                     │   │
│  │   ✓ 最终报告直接从数据库读取完整内容                                  │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              ↓                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    第二层：智能压缩（仅用于审核）                      │   │
│  │                                                                     │   │
│  │   长内容（>3000字符）                                               │   │
│  │       ↓                                                             │   │
│  │   summarizeForLeaderReview()                                        │   │
│  │       ↓                                                             │   │
│  │   ┌─────────────────────────────────────────────────────────┐       │   │
│  │   │  结构化摘要:                                             │       │   │
│  │   │  - 内容概要（200-300字）                                 │       │   │
│  │   │  - 关键要素（主题/结构/风格）                            │       │   │
│  │   │  - 亮点摘录（2-3段精彩片段）                             │       │   │
│  │   │  - 潜在问题                                              │       │   │
│  │   └─────────────────────────────────────────────────────────┘       │   │
│  │       +                                                             │   │
│  │   关键片段（开篇500字 + 结尾500字）                                  │   │
│  │       ↓                                                             │   │
│  │   Leader 审核（上下文可控，<4000字符）                               │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              ↓                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    第三层：完整报告生成                               │   │
│  │                                                                     │   │
│  │   buildFinalReportWithFullContent()                                 │   │
│  │       ↓                                                             │   │
│  │   ┌─────────────────────────────────────────────────────────┐       │   │
│  │   │  # 任务标题                                              │       │   │
│  │   │                                                          │       │   │
│  │   │  ## 第1章：任务1标题                                     │       │   │
│  │   │  > 作者：Agent A                                         │       │   │
│  │   │  > 字数：12345 字                                        │       │   │
│  │   │  [完整内容，不截断]                                       │       │   │
│  │   │                                                          │       │   │
│  │   │  ---                                                     │       │   │
│  │   │                                                          │       │   │
│  │   │  ## 第2章：任务2标题                                     │       │   │
│  │   │  [完整内容，不截断]                                       │       │   │
│  │   │                                                          │       │   │
│  │   │  ---                                                     │       │   │
│  │   │                                                          │       │   │
│  │   │  ## 执行总结（AI 生成）                                   │       │   │
│  │   │  | 指标 | 数据 |                                         │       │   │
│  │   │  | 总任务数 | 10 |                                       │       │   │
│  │   │  | 总字数 | 50000 |                                      │       │   │
│  │   └─────────────────────────────────────────────────────────┘       │   │
│  │                                                                     │   │
│  │   ✓ 完整内容按章节/卷结构展示                                       │   │
│  │   ✓ 只有"执行总结"部分由 AI 生成                                    │   │
│  │   ✓ 不丢失任何原始数据                                              │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 三、关键服务实现

### 1. ContextCompressionService（通用大上下文压缩服务）

**文件位置**: `backend/src/modules/ai-app/teams/services/ai/context-compression.service.ts`

```typescript
功能：
├── 智能分块：按语义边界切分（段落/章节/主题）
├── 并行摘要：每块独立生成摘要 + 关键点
├── 层级合并：递归合并直到目标大小
├── 向量嵌入：支持语义检索（可选）
└── 完整性校验：确保不丢失任何数据块

使用场景：
├── Leader 审核时压缩长内容
├── 数据分析时压缩大量数据
└── 任何需要处理大上下文的场景
```

#### 核心接口

```typescript
interface CompressionResult {
  // 最终压缩后的上下文
  compressedContext: string;
  // 全局摘要
  globalSummary: string;
  // 所有块的摘要（用于检索增强）
  chunkSummaries: SummaryChunk[];
  // 统计信息
  stats: {
    originalLength: number;
    compressedLength: number;
    compressionRatio: number;
    chunkCount: number;
    processingTimeMs: number;
  };
  // 完整性校验
  integrityCheck: {
    allChunksProcessed: boolean;
    coveragePercentage: number;
    missingChunks: string[];
  };
}
```

### 2. 审核流程优化

**文件位置**: `backend/src/modules/ai-app/teams/services/collaboration/team-mission.service.ts`

```typescript
leaderReviewTask() 流程：
│
├── 1. 检测内容长度
│       if (taskResult.length > 3000) → 生成摘要
│
├── 2. summarizeForLeaderReview()
│       ├── AI 生成结构化摘要
│       └── 提取开篇+结尾关键片段
│
├── 3. buildLeaderReviewPrompt()
│       └── 基于摘要构建审核提示词（上下文可控）
│
└── 4. Leader 审核
        └── 决定通过/修改
```

#### summarizeForLeaderReview 方法

```typescript
private async summarizeForLeaderReview(
  content: string,
  taskTitle: string,
  leaderModel: string,
): Promise<{ summary: string; keyExcerpts: string }> {
  // 超过3000字符才需要摘要
  const SUMMARY_THRESHOLD = 3000;

  if (content.length <= SUMMARY_THRESHOLD) {
    return { summary: content, keyExcerpts: "" };
  }

  // AI 生成结构化摘要
  const prompt = `请为以下创作内容生成审核摘要...`;

  // 提取开头和结尾的关键片段
  const headExcerpt = content.substring(0, 500);
  const tailExcerpt = content.substring(content.length - 500);

  return { summary, keyExcerpts };
}
```

### 3. 最终报告生成

```typescript
completeMission() 流程：
│
├── 1. buildFinalReportWithFullContent()
│       ├── 读取所有 task.result（完整内容）
│       ├── 按章节结构组织
│       └── 返回 { fullContent, summaryPrompt }
│
├── 2. AI 生成执行总结（仅总结，不处理完整内容）
│       └── 基于元数据（任务数、字数、作者）生成
│
└── 3. 最终报告 = 完整内容 + 执行总结
        └── 存储到 mission.finalResult
```

#### buildFinalReportWithFullContent 方法

```typescript
private buildFinalReportWithFullContent(mission: any): {
  fullContent: string;
  summaryPrompt: string;
} {
  const completedTasks = mission.tasks.filter(t => t.status === "COMPLETED");

  // 构建完整的分章节内容
  const chapters = completedTasks.map((t, index) => {
    return `## 第${index + 1}章：${t.title}
> 作者/负责人：${t.assignedTo.displayName}
> 字数：${t.result.length} 字

${t.result}`;  // 完整内容，不截断
  });

  const fullContent = `# ${mission.title}\n\n${chapters.join("\n\n---\n\n")}`;

  // AI 只需要生成执行总结
  const summaryPrompt = `请根据以下元数据生成执行总结...`;

  return { fullContent, summaryPrompt };
}
```

## 四、数据完整性保证

```
┌─────────────────────────────────────────────────────────────────┐
│                      完整性保证机制                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 存储层                                                       │
│     ├── task.result = 完整 AI 产出（不截断）                     │
│     ├── mission.finalResult = 完整最终报告（不截断）             │
│     └── 数据库字段类型 = TEXT（无长度限制）                       │
│                                                                 │
│  2. 压缩层（仅用于中间处理）                                      │
│     ├── 压缩只用于 Leader 审核，不影响存储                        │
│     ├── 摘要记录来源块 ID，可追溯                                 │
│     └── 完整性校验：coveragePercentage = 100%                    │
│                                                                 │
│  3. 输出层                                                       │
│     ├── 最终报告直接拼接所有 task.result                         │
│     ├── 分章节展示，每章完整                                      │
│     └── AI 只生成执行总结，不综合内容                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 五、对比：修改前 vs 修改后

| 场景                  | 修改前                           | 修改后                           |
| --------------------- | -------------------------------- | -------------------------------- |
| **Leader 审核长内容** | 简单截断6000字符，丢失中间和结尾 | AI 摘要 + 首尾片段，全面理解     |
| **最终报告生成**      | AI 综合截断后的内容              | 直接拼接完整内容 + AI 仅生成总结 |
| **上下文溢出**        | 报错"AI 响应被完全截断"          | 压缩后上下文可控，不溢出         |
| **数据完整性**        | 可能丢失部分内容                 | 100% 完整保留                    |

## 六、文件变更清单

```
新增文件：
├── backend/src/modules/ai-app/teams/services/ai/context-compression.service.ts
│   └── 通用大上下文压缩服务（500+ 行）

修改文件：
├── backend/src/modules/ai-app/teams/services/collaboration/team-mission.service.ts
│   ├── + summarizeForLeaderReview() - AI 摘要生成
│   ├── + buildFinalReportWithFullContent() - 完整报告构建
│   ├── ~ leaderReviewTask() - 集成摘要流程
│   ├── ~ completeMission() - 使用新的报告生成方法
│   ├── ~ buildLeaderReviewPrompt() - 优化截断策略（首尾保留）
│   └── ~ buildTaskRevisionPrompt() - 优化截断策略（首尾保留）
```

## 七、核心原则

> **压缩只用于过程，存储和输出保持完整**

1. **原始数据永不丢失**：所有 Agent 产出完整存储在 `task.result`
2. **压缩只用于审核**：Leader 审核时使用摘要，但不影响存储
3. **最终报告完整输出**：直接拼接完整内容，按章节结构展示
4. **AI 只负责总结**：最终报告的内容来自数据库，AI 只生成执行总结

## 八、未来扩展

1. **向量检索增强**：集成 `TopicContextRetrievalService`，支持跨章节语义检索
2. **一致性检测**：添加专门的一致性检测 Agent，检测角色/设定矛盾
3. **分卷管理**：对于超长内容（100+章节），支持分卷管理和目录生成
4. **导出优化**：支持 Word/PDF 导出，保持完整格式

---

_本文档由 Claude Code 自动生成_
