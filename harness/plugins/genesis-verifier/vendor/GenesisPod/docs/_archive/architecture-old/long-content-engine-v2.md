# LongContentEngine - AI Engine 长内容处理引擎

> 版本：2.0
> 更新日期：2025-01-04
> 作者：Claude Code
> 状态：设计稿（待实现）

---

## 一、问题定义与根因分析

### 1.1 观察到的现象

在实际运行中，AI Teams 处理长篇小说（80章）任务时出现以下问题：

| 现象                                     | 根本原因                               |
| ---------------------------------------- | -------------------------------------- |
| 用户要求分章，Leader 却分卷              | Leader Prompt 无强制粒度约束           |
| Member 返回"未完待续"，Leader 审核不通过 | 无续写协议，状态机缺少 CONTINUING 状态 |
| 最终还是上下文溢出                       | 所有历史任务结果累积进审核上下文       |
| 后期章节质量明显下降                     | 无质量趋势监控和自动干预机制           |

### 1.2 架构层面的本质问题

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           当前架构的 4 个致命缺陷                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. 【任务粒度失控】                                                          │
│     AI 自由决定任务拆分方式，无法保证符合用户期望的粒度                        │
│     → 需要：任务粒度控制器                                                   │
│                                                                             │
│  2. 【续写机制缺失】                                                          │
│     当单次调用无法完成任务时，系统无法识别并继续                              │
│     → 需要：续写协议处理器                                                   │
│                                                                             │
│  3. 【上下文无限累积】                                                        │
│     没有工作记忆 vs 长期记忆的区分，历史全量加载                              │
│     → 需要：滑动窗口上下文管理                                               │
│                                                                             │
│  4. 【无质量反馈回路】                                                        │
│     只关注单任务，不关注整体趋势，质量下降无感知                              │
│     → 需要：质量监控服务                                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 二、解决方案：LongContentEngine

### 2.1 架构定位

LongContentEngine 是 **AI Engine 核心层** 的通用服务，被所有应用层模块消费：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              应用层 (Consumers)                              │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐           │
│  │ AI Teams│  │AI Studio│  │AI Slides│  │AI Office│  │AI Coding│           │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘           │
├───────┼────────────┼────────────┼────────────┼────────────┼─────────────────┤
│       ↓            ↓            ↓            ↓            ↓                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                       LongContentEngine                              │   │
│  │                                                                     │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │   │
│  │  │ TaskGranularity │  │ Continuation    │  │ SlidingWindow   │     │   │
│  │  │ Controller      │  │ Protocol        │  │ Context         │     │   │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘     │   │
│  │                                                                     │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │   │
│  │  │ Quality         │  │ Progress        │  │ Context         │     │   │
│  │  │ Monitor         │  │ Tracker         │  │ Compression     │     │   │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘     │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              AI Engine 核心层                               │
├─────────────────────────────────────────────────────────────────────────────┤
│  AIOrchestrationService / TopicContextService / VectorStore / ...           │
│                              基础设施层                                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 核心组件设计

---

## 三、组件一：TaskGranularityController（任务粒度控制器）

### 3.1 问题场景

用户输入："写一部80章的玄幻小说，每章1500字"

当前行为：Leader 自行决定 → 分成8卷，每卷10章 → Member 无法一次产出10章 → 失败

期望行为：强制按章节粒度分解 → 80个独立任务 → 每个任务只产出1章 → 成功

### 3.2 接口设计

```typescript
// 文件位置: backend/src/modules/ai-app/engine/services/task-granularity.service.ts

interface GranularityConstraint {
  // 粒度级别
  level: "volume" | "chapter" | "section" | "paragraph" | "item";

  // 每个任务的输出限制
  maxOutputPerTask: {
    characters?: number; // 最大字符数
    tokens?: number; // 最大 token 数
    items?: number; // 最大条目数（适用于列表类任务）
  };

  // 禁止合并
  allowMerge: boolean; // 是否允许将多个单元合并为一个任务

  // 总任务数预期
  expectedTotalTasks?: number;
}

interface TaskEstimate {
  estimatedTokensPerTask: number;
  recommendedGranularity: GranularityConstraint["level"];
  totalTasks: number;
  parallelBatches: number; // 建议并行批次数
  warnings: string[]; // 潜在问题警告
}

interface TaskGranularityController {
  // 根据用户需求估算任务规模
  estimateTaskScale(
    userRequirement: string,
    contextInfo?: { existingChapters?: number; totalWords?: number },
  ): Promise<TaskEstimate>;

  // 生成强制粒度约束的 Prompt 片段
  buildGranularityConstraintPrompt(constraint: GranularityConstraint): string;

  // 验证 Leader 的任务分解是否符合约束
  validateDecomposition(
    tasks: Array<{ title: string; description: string }>,
    constraint: GranularityConstraint,
  ): {
    valid: boolean;
    violations: string[];
    autoFixed?: Array<{ title: string; description: string }>;
  };

  // 自动重新分解（当验证失败时）
  autoRedecompose(
    originalTasks: Array<{ title: string; description: string }>,
    constraint: GranularityConstraint,
  ): Array<{ title: string; description: string }>;
}
```

### 3.3 Prompt 模板

```markdown
## 关键约束 - 必须严格遵守

### 任务粒度要求

- 粒度级别：{{granularity}}
- 每个任务最大输出：{{maxOutputPerTask}} 字
- 禁止合并：不得将多个 {{granularity}} 合并为一个任务

### 错误示例（禁止）

❌ 任务1：第1-10章（违反：合并了10章）
❌ 任务1：第一卷（违反：一卷包含多章）

### 正确示例（遵循）

✓ 任务1：第1章 - {{chapterTitle1}}
✓ 任务2：第2章 - {{chapterTitle2}}
...
✓ 任务80：第80章 - {{chapterTitle80}}

### 验证规则

系统将自动验证你的任务分解：

- 如果单个任务包含多个 {{granularity}}，将被自动拆分
- 如果总任务数与预期（{{expectedTotalTasks}}）相差超过 10%，将要求重新分解
```

### 3.4 验证与自动修正流程

```
Leader 返回任务列表
        │
        ↓
┌───────────────────────────────────────┐
│ validateDecomposition()               │
│                                       │
│ 检查项：                               │
│ - 每个任务标题是否包含多个章节？        │
│ - 任务描述预计输出是否超过限制？        │
│ - 总任务数是否接近预期？               │
└───────────────────────────────────────┘
        │
        ↓
    验证通过？
        │
   ┌────┴────┐
   ↓         ↓
  是         否
   │          │
   ↓          ↓
继续执行   autoRedecompose()
              │
              ↓
         自动拆分任务
         （程序逻辑，非 AI）
              │
              ↓
         使用修正后的任务列表
```

---

## 四、组件二：ContinuationProtocolHandler（续写协议处理器）

### 4.1 问题场景

Member 产出："...叶凡挥剑斩向敌人，却发现对方竟然——（未完待续）"

当前行为：Leader 审核 → "内容不完整，请补充" → Member 重新生成 → 可能又不完整 → 循环

期望行为：检测到续写信号 → 进入 CONTINUING 状态 → 累积结果 → 同一 Member 继续 → 直到完成

### 4.2 接口设计

```typescript
// 文件位置: backend/src/modules/ai-app/engine/services/continuation-protocol.service.ts

// 扩展的任务状态
enum ExtendedTaskStatus {
  PENDING = "PENDING",
  IN_PROGRESS = "IN_PROGRESS",
  CONTINUING = "CONTINUING", // 🆕 续写中
  REVIEW_PENDING = "REVIEW_PENDING", // 🆕 等待审核
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
}

interface ContinuationState {
  // 是否需要续写
  needsContinuation: boolean;

  // 续写原因
  reason:
    | "explicit_marker"
    | "incomplete_sentence"
    | "short_content"
    | "structured_incomplete";

  // 已完成比例
  completedPortion: number;

  // 最后检查点（断点位置描述）
  lastCheckpoint: string;

  // 续写次数
  continuationCount: number;
  maxContinuations: number;

  // 累积结果
  accumulatedResult: string;
}

interface ContinuationProtocolHandler {
  // 检测是否需要续写
  detectContinuation(
    content: string,
    expectedOutput: { minWords?: number; hasStructuredEnd?: boolean },
  ): ContinuationState;

  // 构建续写 Prompt
  buildContinuationPrompt(
    originalTask: { title: string; description: string },
    state: ContinuationState,
  ): string;

  // 合并续写结果
  mergeResults(
    previousResult: string,
    newResult: string,
    options?: { removeOverlap?: boolean },
  ): string;

  // 检查是否应该停止续写（达到上限或检测到完成）
  shouldStopContinuation(state: ContinuationState): {
    stop: boolean;
    reason: string;
  };
}
```

### 4.3 续写信号检测规则

```typescript
const CONTINUATION_MARKERS = [
  // 显式标记
  /未完待续/,
  /待续/,
  /\.\.\.\s*（续）/,
  /TBC/i,
  /To Be Continued/i,
  /\[CONTINUATION_NEEDED\]/,

  // 结构化标记
  /\[未完\]/,
  /【待续】/,
];

const INCOMPLETE_PATTERNS = [
  // 句子未完成（无标点结尾）
  /[^\。\！\？\.\!\?]$/,

  // 对话未完成
  /"[^"]*$/,
  /「[^」]*$/,

  // 动作描写中断
  /正要|即将|刚刚|突然[^。！？]*$/,
];

function detectContinuation(content: string, expected: ExpectedOutput): ContinuationState {
  // 1. 检查显式标记
  for (const marker of CONTINUATION_MARKERS) {
    if (marker.test(content)) {
      return { needsContinuation: true, reason: "explicit_marker", ... };
    }
  }

  // 2. 检查字数是否严重不足
  if (expected.minWords && content.length < expected.minWords * 0.7) {
    return { needsContinuation: true, reason: "short_content", ... };
  }

  // 3. 检查句子完整性
  for (const pattern of INCOMPLETE_PATTERNS) {
    if (pattern.test(content.trim())) {
      return { needsContinuation: true, reason: "incomplete_sentence", ... };
    }
  }

  // 4. 内容完整
  return { needsContinuation: false, ... };
}
```

### 4.4 续写 Prompt 模板

```markdown
## 续写任务

你正在续写之前未完成的内容。请从断点处继续，保持风格一致。

### 原始任务

{{originalTaskTitle}}: {{originalTaskDescription}}

### 已完成部分（最后 500 字作为上下文）

---

## {{lastPortionOfAccumulatedResult}}

### 断点位置

{{lastCheckpoint}}

### 续写要求

- 还需完成约 {{remainingWords}} 字
- 续写次数：{{currentCount}}/{{maxCount}}
- 直接从断点处继续，不要重复已有内容
- 保持人物设定、情节走向、写作风格一致

### 完成标记

- 如果本次产出后任务完成，在结尾标注：[COMPLETED]
- 如果仍需继续，在结尾标注：[CONTINUATION_NEEDED]
```

### 4.5 续写工作流

```
┌─────────────────────────────────────────────────────────────────┐
│                      续写工作流                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Member 产出                                                     │
│      │                                                          │
│      ↓                                                          │
│  detectContinuation()                                           │
│      │                                                          │
│      ├──── needsContinuation = false ───→ 正常审核流程           │
│      │                                                          │
│      ↓ needsContinuation = true                                 │
│                                                                 │
│  更新任务状态 → CONTINUING                                       │
│      │                                                          │
│      ↓                                                          │
│  accumulatedResult += currentResult                             │
│      │                                                          │
│      ↓                                                          │
│  shouldStopContinuation()?                                      │
│      │                                                          │
│      ├──── stop = true ───→ 最终审核（使用 accumulatedResult）   │
│      │     (达到上限或检测到完成)                                 │
│      │                                                          │
│      ↓ stop = false                                             │
│                                                                 │
│  buildContinuationPrompt()                                      │
│      │                                                          │
│      ↓                                                          │
│  同一 Member 继续执行                                            │
│      │                                                          │
│      └──→ 循环                                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 五、组件三：SlidingWindowContextService（滑动窗口上下文服务）

### 5.1 问题场景

80个章节任务：任务1完成 → 上下文包含任务1结果 → 任务2完成 → 上下文包含任务1+2结果 → ... → 上下文爆炸

当前行为：所有历史结果全量加载 → 上下文溢出

期望行为：只保留"工作记忆"（最近N个摘要 + 当前完整内容 + 相关检索） → 上下文可控

### 5.2 核心概念

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                  长期记忆 (Long-term Memory)                         │   │
│  │                                                                     │   │
│  │  存储位置：PostgreSQL (task.result)                                  │   │
│  │  内容：每个任务的完整原始产出                                         │   │
│  │  特点：永不丢失，可追溯                                               │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                   ↓                                         │
│                           按需检索 + 摘要                                    │
│                                   ↓                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                  工作记忆 (Working Memory)                           │   │
│  │                                                                     │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │  1. 全局摘要 (固定)                        500 tokens       │   │   │
│  │  │     - 项目目标、整体设定、关键角色                           │   │   │
│  │  ├─────────────────────────────────────────────────────────────┤   │   │
│  │  │  2. 最近 N 个任务摘要 (滑动)               1500 tokens       │   │   │
│  │  │     - 任务42摘要：叶凡突破金丹期...                          │   │   │
│  │  │     - 任务43摘要：与魔族首战告捷...                          │   │   │
│  │  │     - 任务44摘要：发现上古遗迹...                            │   │   │
│  │  ├─────────────────────────────────────────────────────────────┤   │   │
│  │  │  3. 当前任务完整内容 (核心)                4000 tokens       │   │   │
│  │  │     - 任务45 的完整产出，用于审核                            │   │   │
│  │  ├─────────────────────────────────────────────────────────────┤   │   │
│  │  │  4. 相关历史检索 (动态)                    1500 tokens       │   │   │
│  │  │     - 与当前内容相关的历史片段（向量检索）                    │   │   │
│  │  ├─────────────────────────────────────────────────────────────┤   │   │
│  │  │  5. 预留空间 (缓冲)                         500 tokens       │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  │                                                                     │   │
│  │  总计：8000 tokens（可配置）                                         │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.3 接口设计

```typescript
// 文件位置: backend/src/modules/ai-app/engine/services/sliding-window-context.service.ts

interface WorkingMemoryContext {
  // 全局摘要
  globalSummary: string;

  // 最近任务摘要
  recentTaskSummaries: Array<{
    taskId: string;
    title: string;
    summary: string;
    completedAt: Date;
  }>;

  // 当前任务完整内容
  currentTaskContent: string;

  // 相关历史检索
  relevantHistory: Array<{
    sourceTaskId: string;
    content: string;
    relevanceScore: number;
  }>;

  // Token 统计
  tokenUsage: {
    globalSummary: number;
    recentSummaries: number;
    currentTask: number;
    relevantHistory: number;
    total: number;
    limit: number;
  };
}

interface SlidingWindowContextService {
  // 构建工作记忆上下文
  buildWorkingMemory(
    projectId: string,
    currentTaskId: string,
    options?: {
      maxTokens?: number;
      recentTaskCount?: number;
      relevantChunkCount?: number;
    },
  ): Promise<WorkingMemoryContext>;

  // 任务完成后滑动窗口
  slideWindow(
    projectId: string,
    completedTask: {
      id: string;
      result: string;
      summary?: string; // 如果没有提供，自动生成
    },
  ): Promise<void>;

  // 更新全局摘要（每 N 个任务自动触发）
  updateGlobalSummary(projectId: string, force?: boolean): Promise<string>;

  // 检索相关历史
  retrieveRelevantHistory(
    projectId: string,
    query: string,
    options?: { maxTokens?: number; threshold?: number },
  ): Promise<Array<{ content: string; relevanceScore: number }>>;
}
```

### 5.4 窗口滑动流程

```
任务 N 完成
      │
      ↓
┌─────────────────────────────────────────────────────────────────┐
│ slideWindow(projectId, completedTask)                          │
│                                                                 │
│  1. 生成任务摘要（如果未提供）                                    │
│     summary = await summarize(completedTask.result)            │
│                                                                 │
│  2. 存储完整结果到长期记忆                                        │
│     await saveToDatabase(completedTask.id, completedTask.result)│
│                                                                 │
│  3. 添加摘要到工作记忆                                           │
│     recentSummaries.push({                                     │
│       taskId: completedTask.id,                                │
│       summary: summary,                                        │
│       completedAt: new Date()                                  │
│     })                                                         │
│                                                                 │
│  4. 移除最旧的摘要（如果超过 N 个）                               │
│     if (recentSummaries.length > MAX_RECENT) {                 │
│       recentSummaries.shift()                                  │
│     }                                                          │
│                                                                 │
│  5. 检查是否需要更新全局摘要（每 10 个任务）                       │
│     if (completedTaskCount % 10 === 0) {                       │
│       await updateGlobalSummary(projectId)                     │
│     }                                                          │
│                                                                 │
│  6. 向量化并索引（用于后续检索）                                  │
│     await vectorize(completedTask.id, completedTask.result)    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
      │
      ↓
准备处理任务 N+1
      │
      ↓
buildWorkingMemory(projectId, taskN1.id)
      │
      ↓
┌─────────────────────────────────────────────────────────────────┐
│ 工作记忆内容：                                                   │
│                                                                 │
│ [全局摘要]                                                       │
│   本项目是一部80章玄幻小说，主角叶凡...                            │
│                                                                 │
│ [最近5个任务摘要]                                                │
│   - 第N-4章：...                                                 │
│   - 第N-3章：...                                                 │
│   - 第N-2章：...                                                 │
│   - 第N-1章：...                                                 │
│   - 第N章：...（刚完成）                                          │
│                                                                 │
│ [当前任务内容]                                                   │
│   第N+1章的完整产出（待审核）                                     │
│                                                                 │
│ [相关历史]                                                       │
│   与第N+1章内容相关的历史片段（向量检索）                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 六、组件四：QualityMonitorService（质量监控服务）

### 6.1 问题场景

80个章节任务：前20章质量优秀 → 中间30章开始下滑 → 后30章严重质量问题 → 无人察觉继续产出

当前行为：只审核单个任务，不关注整体趋势

期望行为：实时监控质量趋势 → 检测到下滑 → 自动干预或告警

### 6.2 接口设计

```typescript
// 文件位置: backend/src/modules/ai-app/engine/services/quality-monitor.service.ts

interface QualityMetrics {
  // 基础指标（必选）
  wordCount: number;
  completionRatio: number; // 0-1，相对于预期
  hasStructuredEnd: boolean;

  // 内容质量（可选，AI 评估）
  coherenceScore?: number; // 0-10，连贯性
  relevanceScore?: number; // 0-10，与任务相关性
  styleConsistency?: number; // 0-10，风格一致性

  // 复合分数
  overallScore: number; // 0-10，综合评分
}

interface QualityTrend {
  trend: "improving" | "stable" | "degrading";
  trendConfidence: number; // 0-1
  recentScores: number[]; // 最近 N 个任务的分数
  averageScore: number;
  degradationRate?: number; // 如果是 degrading，下降速率
}

interface InterventionRecommendation {
  level: 1 | 2 | 3 | 4;
  action: string;
  reason: string;
  autoApply: boolean; // 是否自动应用
}

interface QualityMonitorService {
  // 评估单个任务质量
  evaluateTask(
    content: string,
    expected: { minWords?: number; topic?: string },
  ): Promise<QualityMetrics>;

  // 更新质量趋势
  updateTrend(
    projectId: string,
    taskId: string,
    metrics: QualityMetrics,
  ): Promise<QualityTrend>;

  // 获取干预建议
  getInterventionRecommendation(
    trend: QualityTrend,
  ): InterventionRecommendation | null;

  // 应用干预
  applyIntervention(
    projectId: string,
    intervention: InterventionRecommendation,
  ): Promise<void>;

  // 获取质量仪表盘数据
  getDashboard(projectId: string): Promise<QualityDashboard>;
}
```

### 6.3 干预策略

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              干预级别矩阵                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Level 1 - 软提醒（自动应用）                                                │
│  ├── 触发条件：连续 2 个任务质量分数下降 > 10%                               │
│  ├── 动作：在下一个任务 Prompt 中注入提醒                                    │
│  └── 示例："注意：最近几个任务的内容质量有所下降，请确保..."                  │
│                                                                             │
│  Level 2 - 参数调整（自动应用）                                              │
│  ├── 触发条件：连续 3 个任务质量分数下降 > 15%                               │
│  ├── 动作：                                                                 │
│  │   - temperature: 0.7 → 0.5                                              │
│  │   - max_tokens: 增加 20%                                                │
│  │   - 切换到更强模型（如 gpt-4 → gpt-4o）                                  │
│  └── 日志：记录参数调整                                                     │
│                                                                             │
│  Level 3 - 任务拆分（需确认）                                                │
│  ├── 触发条件：连续 5 个任务质量分数 < 6                                     │
│  ├── 动作：将剩余大任务拆成更小的子任务                                      │
│  └── 通知：向用户展示拆分建议，等待确认                                      │
│                                                                             │
│  Level 4 - 暂停执行（需人工介入）                                            │
│  ├── 触发条件：质量分数连续 8 个任务 < 5，或趋势持续恶化无改善                │
│  ├── 动作：                                                                 │
│  │   - 暂停自动执行                                                        │
│  │   - 发送通知给用户                                                       │
│  │   - 生成质量报告                                                        │
│  └── 等待：用户决策（调整设定/更换 Agent/终止项目）                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.4 质量仪表盘

```typescript
interface QualityDashboard {
  projectId: string;
  projectTitle: string;

  // 进度
  progress: {
    completedTasks: number;
    totalTasks: number;
    percentage: number;
  };

  // 质量概览
  quality: {
    overallScore: number; // 0-10
    trend: QualityTrend;
    recentAverage: number; // 最近 10 个任务平均
  };

  // 字数统计
  wordStats: {
    totalWords: number;
    averagePerTask: number;
    minTask: { id: string; title: string; words: number };
    maxTask: { id: string; title: string; words: number };
  };

  // 异常任务
  anomalies: Array<{
    taskId: string;
    taskTitle: string;
    issue: string;
    severity: "warning" | "error";
  }>;

  // 干预历史
  interventions: Array<{
    timestamp: Date;
    level: number;
    action: string;
    result: "applied" | "skipped" | "pending";
  }>;
}
```

---

## 七、整合：LongContentEngine 完整流程

### 7.1 新建长内容项目流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           新建项目流程                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  用户输入："写一部80章的玄幻小说，每章1500字"                                   │
│      │                                                                      │
│      ↓                                                                      │
│  TaskGranularityController.estimateTaskScale()                              │
│      │                                                                      │
│      ↓                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐       │
│  │ 预估结果：                                                       │       │
│  │ - 推荐粒度：chapter                                              │       │
│  │ - 预计 token/任务：2000                                          │       │
│  │ - 总任务数：80                                                   │       │
│  │ - 建议并行批次：8 批，每批 10 章                                  │       │
│  │ - 警告：无                                                       │       │
│  └─────────────────────────────────────────────────────────────────┘       │
│      │                                                                      │
│      ↓                                                                      │
│  生成 GranularityConstraint                                                 │
│      │                                                                      │
│      ↓                                                                      │
│  Leader 分解任务（带粒度约束 Prompt）                                         │
│      │                                                                      │
│      ↓                                                                      │
│  TaskGranularityController.validateDecomposition()                          │
│      │                                                                      │
│      ├──── 验证通过 ───→ 继续                                               │
│      │                                                                      │
│      ↓ 验证失败                                                             │
│  autoRedecompose() ───→ 使用修正后的任务列表                                 │
│      │                                                                      │
│      ↓                                                                      │
│  初始化 SlidingWindowContext                                                │
│  初始化 QualityMonitor                                                      │
│      │                                                                      │
│      ↓                                                                      │
│  开始执行任务                                                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 单个任务执行流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           单任务执行流程                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  任务 N 开始执行                                                             │
│      │                                                                      │
│      ↓                                                                      │
│  SlidingWindowContext.buildWorkingMemory(projectId, taskN.id)              │
│      │                                                                      │
│      ↓                                                                      │
│  构建执行 Prompt（包含工作记忆上下文）                                        │
│      │                                                                      │
│      ↓                                                                      │
│  Member 执行任务                                                             │
│      │                                                                      │
│      ↓                                                                      │
│  ContinuationProtocol.detectContinuation(result)                           │
│      │                                                                      │
│      ├──── 需要续写 ───→ 续写循环（见续写流程）                               │
│      │                                                                      │
│      ↓ 不需要续写                                                           │
│                                                                             │
│  QualityMonitor.evaluateTask(result)                                       │
│      │                                                                      │
│      ↓                                                                      │
│  QualityMonitor.updateTrend(projectId, taskN.id, metrics)                  │
│      │                                                                      │
│      ↓                                                                      │
│  QualityMonitor.getInterventionRecommendation(trend)                       │
│      │                                                                      │
│      ├──── 有干预建议 ───→ 应用干预（Level 1-2 自动，Level 3-4 通知用户）    │
│      │                                                                      │
│      ↓ 无干预需要                                                           │
│                                                                             │
│  Leader 审核（使用工作记忆上下文，而非全量历史）                               │
│      │                                                                      │
│      ├──── 审核不通过 ───→ 修改循环                                         │
│      │                                                                      │
│      ↓ 审核通过                                                             │
│                                                                             │
│  SlidingWindowContext.slideWindow(projectId, completedTask)                │
│      │                                                                      │
│      ↓                                                                      │
│  任务 N 完成，继续任务 N+1                                                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.3 最终报告生成流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           最终报告生成                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  所有任务完成                                                                │
│      │                                                                      │
│      ↓                                                                      │
│  从长期记忆（数据库）读取所有 task.result                                     │
│      │                                                                      │
│      ↓                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐       │
│  │ 构建完整报告结构：                                                │       │
│  │                                                                 │       │
│  │ # 项目标题                                                       │       │
│  │                                                                 │       │
│  │ ## 执行总结（AI 生成）                                            │       │
│  │ - 总章节数：80                                                   │       │
│  │ - 总字数：120,000                                                │       │
│  │ - 平均质量分：8.5/10                                             │       │
│  │ - 质量趋势：稳定                                                  │       │
│  │                                                                 │       │
│  │ ---                                                              │       │
│  │                                                                 │       │
│  │ ## 第1章：开篇                                                    │       │
│  │ > 作者：Writer Agent                                             │       │
│  │ > 字数：1,523                                                    │       │
│  │                                                                 │       │
│  │ [完整内容，不截断]                                                 │       │
│  │                                                                 │       │
│  │ ---                                                              │       │
│  │                                                                 │       │
│  │ ## 第2章：...                                                     │       │
│  │ [完整内容]                                                        │       │
│  │                                                                 │       │
│  │ ... （共80章，全文展示）                                          │       │
│  │                                                                 │       │
│  └─────────────────────────────────────────────────────────────────┘       │
│      │                                                                      │
│      ↓                                                                      │
│  存储最终报告到 mission.finalResult                                          │
│      │                                                                      │
│      ↓                                                                      │
│  完成                                                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 八、文件结构

```
backend/src/modules/ai-app/engine/
├── long-content-engine.module.ts          # 模块定义
├── services/
│   ├── task-granularity.service.ts        # 任务粒度控制器
│   ├── continuation-protocol.service.ts   # 续写协议处理器
│   ├── sliding-window-context.service.ts  # 滑动窗口上下文服务
│   ├── quality-monitor.service.ts         # 质量监控服务
│   └── long-content-engine.service.ts     # 整合服务（Facade）
├── interfaces/
│   ├── granularity.interface.ts
│   ├── continuation.interface.ts
│   ├── sliding-window.interface.ts
│   └── quality.interface.ts
└── constants/
    ├── continuation-markers.ts            # 续写信号标记
    └── quality-thresholds.ts              # 质量阈值配置
```

---

## 九、实施计划

### Phase 1: 核心组件实现（优先级最高）

1. **TaskGranularityController**
   - 实现任务规模预估
   - 实现粒度约束 Prompt 生成
   - 实现任务分解验证和自动修正

2. **ContinuationProtocolHandler**
   - 实现续写信号检测
   - 扩展任务状态机（添加 CONTINUING）
   - 实现续写工作流

### Phase 2: 上下文管理（优先级高）

3. **SlidingWindowContextService**
   - 实现工作记忆/长期记忆分离
   - 实现窗口滑动逻辑
   - 集成向量检索

### Phase 3: 质量保障（优先级中）

4. **QualityMonitorService**
   - 实现基础质量指标评估
   - 实现趋势追踪
   - 实现自动干预策略
   - 实现质量仪表盘

### Phase 4: 集成与优化（优先级中）

5. **整合到 AI Teams**
   - 修改 TeamMissionService 使用 LongContentEngine
   - 端到端测试

6. **扩展到其他模块**
   - AI Studio 集成
   - AI Slides 集成
   - AI Office 集成

---

## 十、风险与缓解

| 风险             | 影响                     | 缓解措施                    |
| ---------------- | ------------------------ | --------------------------- |
| 续写检测误判     | 完整内容被误判为需要续写 | 多规则组合判断 + 置信度阈值 |
| 质量评估不准     | 干预不当或遗漏           | 人工校准 + 可配置阈值       |
| 向量检索延迟     | 影响执行速度             | 异步预加载 + 缓存           |
| 摘要丢失关键信息 | 影响连贯性               | 结构化摘要 + 关键词提取     |

---

## 十一、成功指标

| 指标                  | 当前状态 | 目标状态         |
| --------------------- | -------- | ---------------- |
| 80章任务完成率        | 失败     | 100% 完成        |
| 上下文溢出次数        | 频繁     | 0 次             |
| 后期章节质量          | 明显下降 | 稳定 (±10%)      |
| Leader 审核上下文大小 | 无限增长 | 固定 8000 tokens |
| 续写识别准确率        | 0%       | >95%             |

---

_本文档由 Claude Code 自动生成_
_版本：2.0_
_最后更新：2025-01-04_
