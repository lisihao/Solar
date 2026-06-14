# Iterative Research System - 自迭代研究系统设计方案

> 借鉴 Karpathy autoresearch 的"假设→实验→评估→迭代"闭环，将 GenesisPod AI Research 从单次研究升级为自迭代研究系统。

## 1. 核心理念

### 1.1 Karpathy autoresearch 与 GenesisPod Research 的同构关系

两个系统共享相同的核心循环：**假设 → 执行 → 评估 → 迭代**。

```
Karpathy autoresearch              GenesisPod AI Research (现有)
───────────────────                ─────────────────────────
program.md (人类指导)          ←→   研究策略知识库 (Research Memory)
train.py (可执行代码)          ←→   Demo 软件 (可操作的产品原型)
修改 train.py                 ←→   根据 gaps 补充研究 + 重新生成 Demo
跑 5 分钟训练                 ←→   执行一轮研究 (搜索+讨论+报告)
val_bpb (客观评估)            ←→   Demo 评分 + gaps 识别
git commit / reset            ←→   独立 md 记录每次迭代变更
循环直到收敛                  ←→   循环直到退出条件命中
```

### 1.2 现有系统已具备的能力

| 能力          | 现有实现                                                   | 文件                                 |
| ------------- | ---------------------------------------------------------- | ------------------------------------ |
| 多 Agent 讨论 | 7 角色 (Director, 3 Researcher, Analyst, Writer, Reviewer) | `discussion-agent.service.ts`        |
| 迭代搜索      | IterativeSearchService + ToolRegistry                      | `iterative-search.service.ts`        |
| 自我反思      | SelfReflectionService (continue/pivot/complete)            | `self-reflection.service.ts`         |
| 动态重规划    | ResearchReplannerService (补充最多 3 步)                   | `research-replanner.service.ts`      |
| Demo 生成     | ResearchDemoService (HTML 产品原型)                        | `research-demo.service.ts`           |
| Idea 提取     | ResearchIdeaService (INSIGHT/CREATIVE_IDEA)                | `research-idea.service.ts`           |
| SSE 实时流    | DiscussionOrchestratorService                              | `discussion-orchestrator.service.ts` |

### 1.3 Idea 是关键中间层

现有流程中，**Idea 是研究发现的提炼，Demo 是 Idea 的具象化**：

```
Research → 提取 Idea (INSIGHT + CREATIVE_IDEA) → 从 Idea 生成 Demo
```

- **INSIGHT**: 从研究讨论中提取的分析判断（"东南亚 Z 世代更偏好本地品牌"）
- **CREATIVE_IDEA**: 从洞察衍生的创新方案（"做一个本地品牌匹配度测评工具"）

在迭代系统中，**Idea 池是累积的**——每轮迭代不只是 Demo 变好，Idea 也在变丰富：

```
Iteration 0: Research → 提取 3 Insight + 2 Creative Idea → 选最佳组合 → Demo v0
Iteration 1: 补充研究 → 新增 1 Insight + 1 Creative Idea → 合并 Idea 池 → Demo v1
Iteration 2: 补充研究 → 新增 2 Insight                   → Idea 更完整 → Demo v2
```

Demo 评估发现的 gaps 可能有两种来源：

1. **数据不足** — 需要补充搜索
2. **Idea 不足** — 数据够了但还没提炼出关键洞察，需要再次 Idea 提取

### 1.4 缺失的关键环节

```
现有流程 (单次、断裂):
  Research → Idea → Demo → 结束

目标流程 (闭环迭代):
  Research → Idea 提取 → Demo 生成 → 评估 Demo
     ↑                                   │
     │         gaps 驱动下一轮            │
     │    ┌─ 数据不足 → 补充研究 ─────────┘
     │    └─ Idea 不足 → 重新提取 Idea ───┘
     │                                   │
     └───────────────── 继续 ←───────────┘
                          or
                        退出 → 交付 Demo + 报告 + Idea 集 + 迭代历程
                          ↓
                   经验沉淀到 Research Memory
```

缺失环节：

1. **Demo 评估** — 生成完就结束，没有质量评估
2. **Idea 累积** — 每次研究独立提取，跨轮次 Idea 不合并
3. **迭代循环** — 每次研究独立，不会基于上次结果改进
4. **退出决策** — 没有"什么时候够好了"的判断
5. **经验沉淀** — 系统不会随使用变得更好

---

## 2. 系统架构

### 2.1 整体流程

```
┌────────────────────────────────────────────────────────────────────────┐
│                     Iterative Research Session                         │
│                                                                        │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐              │
│  │  Research    │────→│  Extract    │────→│  Generate   │              │
│  │  Phase      │     │  Ideas      │     │  Demo       │              │
│  │             │     │             │     │  (软件产品)  │              │
│  │ - Ideation  │     │ - INSIGHT   │     │             │              │
│  │ - Execution │     │ - CREATIVE  │     │ 基于 Idea   │              │
│  │ - Findings  │     │   _IDEA     │     │ 池的最佳组合 │              │
│  │ - Synthesis │     │             │     │ 生成可操作   │              │
│  └─────────────┘     │ 累积到      │     │ 软件        │              │
│                      │ Idea Pool   │     │             │              │
│                      └─────────────┘     └──────┬──────┘              │
│                                                  │                     │
│                                          ┌───────▼───────┐             │
│                                          │  Evaluate     │             │
│                                          │  Demo         │             │
│                                          │               │             │
│                                          │ - 自动检测    │             │
│                                          │ - LLM 评估    │             │
│                                          │ - 打分        │             │
│                                          │ - 识别 gaps   │             │
│                                          └───────┬───────┘             │
│                                                  │                     │
│                                          ┌───────▼───────┐             │
│                                          │  Exit Check   │             │
│                                          │               │             │
│                                          │ 达标? 饱和?   │             │
│                                          │ 收敛? 预算?   │             │
│                                          └───┬───────┬───┘             │
│                                              │       │                 │
│                                         退出 │  继续  │                 │
│                                              │       │                 │
│  ┌──────────────────────────────┐            │       │                 │
│  │  Write iteration-{N}.md     │←───────────┘       │                 │
│  │  (记录本次变更)              │                     │                 │
│  └──────────────────────────────┘                    │                 │
│                                                      │                 │
│                                              ┌───────▼──────┐          │
│                                              │  Diagnose    │          │
│                                              │  Gap Type    │          │
│                                              └──┬────────┬──┘          │
│                                                 │        │             │
│                                          数据不足│  Idea不足│            │
│                                                 │        │             │
│  ┌──────────────────────────────┐               │        │             │
│  │  Targeted Research           │←──────────────┘        │             │
│  │  (根据 gaps 补充搜索)         │                        │             │
│  └──────────────┬───────────────┘                        │             │
│                 │                                        │             │
│                 └──────┬─────────────────────────────────┘             │
│                        │                                               │
│                        ▼                                               │
│               Re-extract Ideas → 更新 Idea Pool → 重新生成 Demo        │
│                                                                        │
│  最终交付:                                                              │
│  ├── Demo 软件 (最佳版本)                                               │
│  ├── 研究报告 (最终版)                                                  │
│  ├── Idea 集 (所有 INSIGHT + CREATIVE_IDEA，标注来源轮次)               │
│  └── 迭代历程 (所有 md 记录)                                            │
└────────────────────────────────────────────────────────────────────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │  Research Memory    │
              │  (跨 session 经验)  │
              │  → DB 存统计数据    │
              │  → 策略文件沉淀规则  │
              └─────────────────────┘
```

### 2.2 与现有架构的关系

```
现有模块                              新增/修改
──────────                            ────────────
DiscussionOrchestratorService    →    新增外层 IterativeResearchService 包裹
SelfReflectionService            →    保持不变 (内层搜索步骤反思)
ResearchReplannerService         →    保持不变 (内层动态重规划)
ResearchDemoService              →    改造: 支持迭代生成 + 话题类型适配
ResearchIdeaService              →    保持不变
                                      新增: DemoEvaluatorService
                                      新增: ExitDecisionService
                                      新增: IterationRecordService
                                      新增: ResearchMemoryService
```

**两层迭代嵌套：**

```
外层循环: IterativeResearchService (跨轮次宏观决策)
  │       → 要不要再来一轮？
  │       → 评估的是 Demo 质量 + Idea 覆盖度
  │
  └─ 内层循环: DiscussionOrchestratorService (单轮内微观决策)
       │       → 这个搜索步骤做完了，下一步搜什么？
       │       → SelfReflection: continue / pivot / complete
       └─ ResearchReplanner: 单轮搜索结束后补充搜索
```

**每轮迭代产出三件东西：**

```
Research (搜索+报告)  →  Ideas (提取+累积)  →  Demo (生成软件)
       数据层                  认知层                产品层
```

```

---

## 3. Demo 作为"可操作软件"

### 3.1 设计原则

Demo 不是信息展示页，是用户可操作的工具。核心区别：

```

展示页 (现在): 可操作软件 (目标):
───────────── ─────────────────
静态数据 有状态，操作改变数据
展示研究发现 用户可输入、筛选、对比、模拟
看完就关 可导出、保存、分享
一种模板 根据研究类型自动选择形态

````

### 3.2 Demo 形态自动选择

根据研究内容分类，自动选择最合适的软件形态：

| 研究类型 | Demo 形态 | 关键交互 |
|---|---|---|
| 产品/设计类 | 可交互原型 | 页面流转、表单、状态变化 |
| 市场/数据类 | 数据仪表盘 | 筛选器、图表联动、时间轴 |
| 技术/架构类 | 技术地图 | 架构图导航、对比矩阵、时间线 |
| 策略/决策类 | 决策模拟器 | 参数调节、结果预测、情景对比 |
| 人群/用户类 | 画像工具 | 人群筛选、行为分析、匹配度 |
| 趋势/预测类 | 趋势探索器 | 时间线拖动、多指标叠加、预测区间 |

**载体统一为自包含 HTML** — 一个文件，无外部依赖，可直接在浏览器中运行。

### 3.3 对现有代码的改造

**后端 `ResearchDemoService.generateDemoHtml()`：**

现在的 system prompt 固定为"产品原型工程师"。改造为根据研究类型动态生成 prompt：

```typescript
// 现有 (research-demo.service.ts:146)
const systemPrompt = `你是一位专业的产品原型工程师...`;

// 改造后
const topicType = await this.classifyTopic(idea, researchReport);
const systemPrompt = this.buildDemoPrompt(topicType, researchReport);
````

`classifyTopic()` 是一次快速 LLM 调用（CHAT_FAST），基于 Idea + 报告内容判断研究类型。

`buildDemoPrompt()` 根据类型返回不同的生成指令（数据仪表盘 vs 技术地图 vs 决策模拟器等）。

**前端 `DemosPanel.tsx`：**

现有的 Demo 展示是 iframe 嵌入 HTML。改造后增加：

- 迭代版本切换（查看每次迭代的 Demo 版本）
- 评分可视化（每版 Demo 的分数变化趋势）
- gaps 列表（当前版本还缺什么）

---

## 4. Demo 评估系统

### 4.1 评估分两层

**Layer 1: 自动检测（零 LLM 开销）**

解析 HTML DOM，提取结构化指标：

```typescript
interface DemoAutoMetrics {
  structureValid: boolean; // HTML 结构完整
  noExternalDeps: boolean; // 无 CDN/外部资源
  viewCount: number; // 可切换的视图/页面数 (目标 ≥3)
  interactiveElements: number; // 按钮/表单/筛选器数量
  dataPoints: number; // 具体数据点数量 (非占位符)
  hasStateManagement: boolean; // 有 JS 状态管理 (操作产生变化)
  jsErrors: number; // JS 控制台报错数
  codeSize: number; // HTML 总大小 (过小=内容不足，过大=冗余)
}
```

实现方式：在 Node.js 中用 `cheerio` 解析 HTML 即可，不需要 Puppeteer（避免重依赖）。`jsErrors` 可选，需要 Puppeteer 或跳过。

**Layer 2: LLM 评估（一次 CHAT_FAST 调用）**

```typescript
interface DemoLLMEvaluation {
  ideaAlignment: number; // 与研究发现的契合度 (0-1)
  insightDensity: number; // 展示了多少独立洞察 (0-1)
  dataCompleteness: number; // 数据维度是否充分 (0-1)
  interactionQuality: number; // 交互是否有意义 (0-1)
  gaps: string[]; // 具体缺什么 ← 驱动下一轮迭代
  topicTypeMatch: boolean; // Demo 形态是否匹配研究类型
}
```

**综合评分：**

```typescript
interface DemoScore {
  auto: DemoAutoMetrics;
  llm: DemoLLMEvaluation;
  composite: number; // 加权总分 (0-1)
  gaps: string[]; // 来自 LLM 评估
}

// 权重分配
composite =
  0.15 * normalizedViewCount +
  0.15 * normalizedInteractiveElements +
  0.2 * llm.ideaAlignment +
  0.2 * llm.insightDensity +
  0.15 * llm.dataCompleteness +
  0.15 * llm.interactionQuality;
```

### 4.2 新增 Service

```
backend/src/modules/ai-app/research/evaluation/
├── demo-evaluator.service.ts      # Demo 评估逻辑
├── demo-auto-analyzer.ts          # HTML DOM 自动分析
├── topic-classifier.service.ts    # 研究类型分类
└── __tests__/
    ├── demo-evaluator.service.spec.ts
    └── demo-auto-analyzer.spec.ts
```

---

## 5. 退出决策系统

### 5.1 五个退出条件

按优先级排列，任一命中即退出：

```typescript
interface ExitDecision {
  exit: boolean;
  reason?:
    | "budget_exhausted"
    | "quality_met"
    | "information_saturated"
    | "converged"
    | "no_gaps";
  nextResearchFocus?: string[]; // 如果不退出，下一轮该研究什么
}
```

**条件 1: 预算硬上限（兜底）**

```typescript
const MAX_ITERATIONS: Record<string, number> = {
  quick: 2,
  standard: 4,
  thorough: 6,
};

if (iteration >= MAX_ITERATIONS[depth])
  return { exit: true, reason: "budget_exhausted" };
```

**条件 2: 质量达标**

```typescript
const QUALITY_THRESHOLDS: Record<string, number> = {
  quick: 0.6,
  standard: 0.75,
  thorough: 0.85,
};

if (demoScore.composite >= QUALITY_THRESHOLDS[depth])
  return { exit: true, reason: "quality_met" };
```

**条件 3: 信息饱和**

每轮研究结束后计算信息增量：

```typescript
const newUniqueSources = countNewUniqueSources(currentRound, previousRounds);
const informationGain = newUniqueSources / totalSearchedThisRound;

if (informationGain < 0.1)
  return { exit: true, reason: "information_saturated" };
```

**条件 4: 质量收敛**

连续 N 轮分数变化极小：

```typescript
if (scores.length >= 2) {
  const recentDeltas = scores
    .slice(-2)
    .map((s, i, a) => (i > 0 ? Math.abs(s - a[i - 1]) : Infinity))
    .filter((d) => d !== Infinity);

  if (recentDeltas.every((d) => d < 0.03))
    return { exit: true, reason: "converged" };
}
```

**条件 5: 无 gaps（最理想的退出）**

```typescript
if (demoScore.gaps.length === 0) return { exit: true, reason: "no_gaps" };
```

### 5.2 新增 Service

```
backend/src/modules/ai-app/research/evaluation/
├── exit-decision.service.ts       # 退出决策逻辑
```

---

## 6. 迭代记录系统 (独立 md)

### 6.1 每次迭代 = 一个独立的 md 记录

不是覆盖上一版，而是追加。每次迭代产出一个结构化的 markdown 文档：

**初始记录 (000-init.md):**

```markdown
# Research Init

## Topic

Z世代在东南亚的消费行为

## Topic Type

人群/市场分析

## Research Config

- depth: thorough
- quality_threshold: 0.85
- max_iterations: 6

## Initial Research Summary

- 搜索方向: 3 个 (消费习惯 / 品牌偏好 / 数字支付)
- 来源数: 28 个独立来源
- 搜索轮次: 6

## Ideas Extracted

### Insights (3)

1. 东南亚 Z 世代消费以移动端为主，电商渗透率 >70%
2. 本地品牌在印尼和泰国更受欢迎，国际品牌在新加坡占优
3. 社交电商 (TikTok Shop) 增长最快

### Creative Ideas (2)

1. "本地品牌匹配度测评工具" — 输入品牌定位，输出目标人群画像
2. "东南亚 Z 世代消费趋势仪表盘" — 可按国家/品类/时间筛选

## Demo Generated

- 形态: 数据仪表盘 + 用户画像
- 基于 Ideas: #C1 "消费趋势仪表盘" + #I1~#I3 作为数据支撑
- 评分: 0.58

## Gaps Identified

1. [数据不足] 缺少品类偏好的具体数据
2. [Idea不足] 用户画像只有 1 个，需要 ≥3 个细分群体
3. [数据不足] 国家筛选器没有实际数据联动

## Decision: CONTINUE (score 0.58 < threshold 0.85)
```

**迭代记录 (001-iteration.md):**

```markdown
# Iteration 001

## Trigger

- Previous score: 0.58
- Gaps to address:
  - [数据不足] 缺少品类偏好的具体数据
  - [Idea不足] 用户画像只有 1 个

## Research Actions

- 新增搜索: "Z世代 东南亚 消费品类偏好 2025-2026 statista"
- 新增搜索: "southeast asia gen-z consumer segments report"
- 来源增量: +12 独立来源 (gain: 31%)

## New Ideas Extracted

### Insights (+2)

4. Z 世代消费分三个显著群体: 潮流追随者/性价比导向/本土文化偏好
5. 美妆和快时尚是跨国家的共同热门品类

### Creative Ideas (+1)

3. "人群细分画像卡片" — 3 个典型 Z 世代消费者角色

## Idea Pool Status

- Total: 5 Insights + 3 Creative Ideas (本轮新增 2+1)
- Demo 采纳: #I1~#I5, #C1, #C3

## Demo Changes

- 新增 3 个细分用户画像 (潮流追随者/性价比导向/本土文化偏好) ← Idea #I4 + #C3
- 品类分布饼图添加，数据来自搜索结果 ← Idea #I5
- 国家筛选器绑定真实数据

## Evaluation

- Score: 0.58 → 0.73 (delta: +0.15)
- Remaining gaps:
  - [数据不足] 缺少年度趋势时间线
  - [Idea不足] 模拟功能未实现 (缺乏"用户输入→结果预测"的 Idea)

## Decision: CONTINUE (score 0.73 < threshold 0.85, delta +0.15 > 0.03)
```

**最终总结 (final-summary.md):**

```markdown
# Final Summary

## Result

- Status: QUALITY_MET
- Total iterations: 3
- Final score: 0.86
- Duration: 12m 34s
- Credits consumed: 2100

## Iteration Progression

| Iteration | Score | Delta | Insights | Creative Ideas | Gaps | Key Change            |
| --------- | ----- | ----- | -------- | -------------- | ---- | --------------------- |
| Init      | 0.58  | —     | 3        | 2              | 3    | 初始研究 + 基础仪表盘 |
| #001      | 0.73  | +0.15 | 5 (+2)   | 3 (+1)         | 2    | 3 个用户画像 + 品类图 |
| #002      | 0.81  | +0.08 | 7 (+2)   | 4 (+1)         | 1    | 趋势时间线 + 年度对比 |
| #003      | 0.86  | +0.05 | 8 (+1)   | 4 (—)          | 0    | 品牌匹配模拟器        |

## Final Idea Pool

### Insights (8)

1. 东南亚 Z 世代消费以移动端为主，电商渗透率 >70%
2. 本地品牌在印尼和泰国更受欢迎
3. TikTok Shop 增长最快
4. 三个消费群体: 潮流/性价比/本土文化
5. 美妆和快时尚是跨国家热门品类
6. 2024-2026 消费增长率呈 V 型恢复
7. 直播电商转化率是传统电商的 3.2 倍
8. 跨境品牌在越南的接受度正在上升

### Creative Ideas (4)

1. 消费趋势仪表盘
2. 本地品牌匹配度测评工具
3. 人群细分画像卡片
4. 品牌定位模拟器

## Key Learnings

- "人群类"研究需要 ≥3 个细分画像才能达到质量要求
- 英文搜索对东南亚市场数据的覆盖率显著高于中文搜索
- 趋势时间线是此类 Demo 的核心交互，不能缺少
- Creative Idea 的数量和质量直接影响 Demo 的交互丰富度

## Strategy Recommendations

→ 写入 Research Memory
```

### 6.2 数据存储

迭代记录存储在 `DeepResearchSession` 的 JSONB 字段中：

```prisma
// 现有 DeepResearchSession model 新增字段
model DeepResearchSession {
  // ... 现有字段保持不变 ...

  // 新增: 迭代研究
  iterations       Json[]    @default([])      // IterationRecord[]
  currentIteration Int       @default(0)       @map("current_iteration")
  demoVersions     Json[]    @default([])      // { round, htmlContent, score }[]
  finalScore       Float?                      @map("final_score")
  exitReason       String?                     @map("exit_reason")
}
```

每个 iteration 元素的 TypeScript 类型：

```typescript
interface IterationRecord {
  round: number; // 0 = init, 1+ = iterations
  type: "init" | "iteration" | "summary";
  markdown: string; // 完整的 md 内容

  // 三层产出快照
  research: {
    // 数据层
    queries: string[]; // 本轮执行的搜索
    newSources: number; // 新增独立来源
    totalSources: number; // 累计独立来源
    informationGain: number; // 信息增量比
  };
  ideas: {
    // 认知层
    newInsights: string[]; // 本轮新提取的 Insight
    newCreativeIdeas: string[]; // 本轮新提取的 Creative Idea
    totalInsights: number; // Idea Pool 累计 Insight 数
    totalCreativeIdeas: number; // Idea Pool 累计 Creative Idea 数
    adoptedInDemo: string[]; // 本轮 Demo 采纳了哪些 Idea
  };
  demo: {
    // 产品层
    score: number; // Demo 综合评分
    changes: string[]; // 本轮 Demo 变化描述
    topicType: string; // Demo 形态类型
  };

  // gaps 分类
  gaps: {
    dataGaps: string[]; // 数据不足类 gaps
    ideaGaps: string[]; // Idea 不足类 gaps
  };

  exitDecision: ExitDecision;
  timestamp: Date;
}
```

### 6.3 前端展示

在 `ResearchProjectLayout.tsx` 现有的 5 个 Tab 基础上，改造 Demos Tab 为**迭代维度展示**：

```
现有 Tab 结构:
  Discussion | Insights | Ideas | Demos | Report

改造后 Demos Tab → "迭代研究" Tab:
  ┌──────────────────────────────────────────────────────────────────┐
  │                                                                  │
  │  ┌─ 迭代时间线 ───────────────────────────────────────────────┐  │
  │  │                                                            │  │
  │  │  ● Init     →    ● #001      →    ● #002      →  ● #003  │  │
  │  │  score:0.58      score:0.73       score:0.81     score:0.86│  │
  │  │  3I+2C           5I+3C            7I+4C          8I+4C    │  │
  │  │  [选中]                                                    │  │
  │  └────────────────────────────────────────────────────────────┘  │
  │                                                                  │
  │  ┌─ 选中的迭代: Init ────────────────────────────────────────┐  │
  │  │                                                            │  │
  │  │  三栏并排展示:                                              │  │
  │  │                                                            │  │
  │  │  ┌── 数据层 ──┐  ┌── 认知层 ──┐  ┌── 产品层 ──┐          │  │
  │  │  │            │  │            │  │            │          │  │
  │  │  │ 搜索方向:3  │  │ Insights:3 │  │ Demo 预览   │          │  │
  │  │  │ 来源数:28   │  │ Creative:2 │  │ (iframe)   │          │  │
  │  │  │ 搜索轮次:6  │  │            │  │            │          │  │
  │  │  │            │  │ #I1 移动端  │  │ Score:0.58 │          │  │
  │  │  │ 域名分布:   │  │  为主...   │  │            │          │  │
  │  │  │  [饼图]     │  │ #I2 本地品  │  │ Gaps:      │          │  │
  │  │  │            │  │  牌受欢迎   │  │ - 品类数据  │          │  │
  │  │  │ 语言分布:   │  │ ...        │  │ - 画像不足  │          │  │
  │  │  │ 中85%      │  │            │  │ - 筛选联动  │          │  │
  │  │  │ 英15%      │  │ #C1 消费趋  │  │            │          │  │
  │  │  │            │  │  势仪表盘   │  │            │          │  │
  │  │  │            │  │ #C2 品牌匹  │  │            │          │  │
  │  │  │            │  │  配测评     │  │            │          │  │
  │  │  └────────────┘  └────────────┘  └────────────┘          │  │
  │  │                                                            │  │
  │  └────────────────────────────────────────────────────────────┘  │
  │                                                                  │
  │  ┌─ 迭代详情 (md 渲染) ──────────────────────────────────────┐  │
  │  │  # Research Init                                           │  │
  │  │  ## Topic: Z世代在东南亚的消费行为                           │  │
  │  │  ## Ideas Extracted ...                                    │  │
  │  │  ## Demo Generated ...                                     │  │
  │  │  ## Gaps Identified ...                                    │  │
  │  │  ## Decision: CONTINUE                                     │  │
  │  └────────────────────────────────────────────────────────────┘  │
  │                                                                  │
  │  ┌─ Demo 版本对比 ───────────────────────────────────────────┐  │
  │  │  [v0 Init] [v1] [v2] [v3 Final]   ← 切换查看历史版本      │  │
  │  └────────────────────────────────────────────────────────────┘  │
  └──────────────────────────────────────────────────────────────────┘
```

**核心设计：每个迭代节点点开后，展示三层产出的并排对比（数据层 / 认知层 / 产品层）。**
用户可以清楚看到每次迭代"搜了什么新数据 → 产生了什么新 Idea → Demo 怎么变好了"。

**需改造的前端文件：**

| 文件                                            | 改动                        |
| ----------------------------------------------- | --------------------------- |
| `DemosPanel.tsx` → `IterativeResearchPanel.tsx` | 重构为三层迭代展示面板      |
| `hooks/features/useIterativeResearch.ts`        | 新增: 迭代研究状态管理      |
| `hooks/features/useResearchDemos.ts`            | 改造: 版本历史、评分数据    |
| `hooks/features/useResearchIdeas.ts`            | 改造: Idea Pool 累积统计    |
| `hooks/features/useDiscussionResearch.ts`       | 改造: 支持迭代模式 SSE 事件 |

---

## 7. 迭代研究编排器

### 7.1 核心 Service

```
backend/src/modules/ai-app/research/iteration/
├── iterative-research.service.ts    # 外层迭代编排器
├── iteration-record.service.ts      # md 记录生成
├── types.ts                         # 迭代相关类型
└── __tests__/
    ├── iterative-research.service.spec.ts
    └── iteration-record.service.spec.ts
```

### 7.2 IterativeResearchService 核心流程

```typescript
@Injectable()
export class IterativeResearchService {
  constructor(
    private readonly orchestrator: DiscussionOrchestratorService,
    private readonly ideaService: ResearchIdeaService,
    private readonly demoService: ResearchDemoService,
    private readonly evaluator: DemoEvaluatorService,
    private readonly exitDecision: ExitDecisionService,
    private readonly recorder: IterationRecordService,
    private readonly memoryService: ResearchMemoryService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 启动迭代研究 (SSE 流)
   *
   * 外层循环包裹现有 DiscussionOrchestratorService，
   * 每轮结束后评估 Demo、决定是否继续。
   */
  startIterativeResearch(
    projectId: string,
    dto: StartIterativeResearchDto,
  ): Observable<IterativeResearchSSEEvent> {
    // 伪代码，展示核心流程:
    //
    // === Phase A: 初始研究 ===
    // 1. 读取 Research Memory 中的相关策略
    // 2. 初始研究 (调用现有 DiscussionOrchestratorService)
    //    → 产出: 报告 + searchRounds + discussion messages
    // 3. 分类研究类型 (topicClassifier)
    //
    // === Phase B: 提取 Ideas ===
    // 4. 调用现有 ResearchIdeaService.extractFromSession()
    //    → 产出: INSIGHT[] + CREATIVE_IDEA[]
    //    → 构建 Idea Pool
    //
    // === Phase C: 生成 Demo ===
    // 5. 基于 Idea Pool + 报告 + topicType 生成 Demo 软件
    //
    // === Phase D: 评估 + 迭代循环 ===
    // 6. 评估 Demo → score + gaps (分为 dataGaps / ideaGaps)
    // 7. 写入 000-init.md (含 Ideas snapshot)
    // 8. 进入迭代循环:
    //    while (!shouldExit) {
    //      a. 诊断 gap 类型:
    //         - dataGaps → 生成针对性搜索 queries → 执行补充搜索
    //         - ideaGaps → 基于新数据重新提取 Ideas
    //      b. 执行补充搜索 (复用 IterativeSearchService)
    //      c. 将新来源合并到已有 searchRounds
    //      d. 重新提取 Ideas → 合并到 Idea Pool (累积，不覆盖)
    //      e. 重新生成 Demo (基于完整 Idea Pool)
    //      f. 评估 Demo → score + gaps
    //      g. 写入 {N}-iteration.md (含三层产出快照)
    //      h. 检查退出条件
    //    }
    //
    // === Phase E: 收尾 ===
    // 9. 写入 final-summary.md (含完整 Idea Pool + 迭代进程表)
    // 10. 沉淀经验到 Research Memory
    // 11. 交付: 最佳 Demo + 报告 + Idea 集 + 迭代历程
  }
}
```

### 7.3 与现有 Orchestrator 的关系

**不修改** `DiscussionOrchestratorService`。新的 `IterativeResearchService` 是外层包裹：

```
用户请求
  │
  ├─ 普通研究 → DiscussionOrchestratorService (现有流程，不变)
  │
  └─ 迭代研究 → IterativeResearchService
                  ├─ 第一轮: 调用 DiscussionOrchestratorService
                  ├─ 后续轮: 只做针对性补充搜索 (IterativeSearchService)
                  └─ 每轮: 生成/评估 Demo
```

第一轮是完整研究（Ideation → Execution → Findings → Synthesis）。后续轮次**不重新走完整流程**，只针对 gaps 执行补充搜索和 Demo 重生成，避免重复消耗。

### 7.4 SSE 事件扩展

在现有 `DeepResearchSSEEvent` 基础上新增迭代相关事件：

```typescript
// 新增事件类型
interface IterationStartEvent {
  type: "iteration.start";
  data: {
    round: number;
    targetGaps: { dataGaps: string[]; ideaGaps: string[] };
  };
}

interface IterationResearchEvent {
  type: "iteration.research";
  data: {
    round: number;
    queries: string[];
    newSources: number;
    informationGain: number;
  };
}

interface IterationIdeasEvent {
  type: "iteration.ideas";
  data: {
    round: number;
    newInsights: Array<{ title: string }>;
    newCreativeIdeas: Array<{ title: string }>;
    totalInsights: number;
    totalCreativeIdeas: number;
  };
}

interface IterationDemoEvent {
  type: "iteration.demo";
  data: { round: number; status: "generating" | "completed" };
}

interface IterationEvalEvent {
  type: "iteration.eval";
  data: {
    round: number;
    score: number;
    previousScore: number;
    gaps: { dataGaps: string[]; ideaGaps: string[] };
  };
}

interface IterationExitEvent {
  type: "iteration.exit";
  data: { reason: string; finalScore: number; totalIterations: number };
}

// 扩展现有 union type
export type IterativeResearchSSEEvent =
  | DeepResearchSSEEvent // 所有现有事件
  | IterationStartEvent
  | IterationResearchEvent
  | IterationIdeasEvent
  | IterationDemoEvent
  | IterationEvalEvent
  | IterationExitEvent;
```

---

## 8. Research Memory (研究元认知)

### 8.1 双层存储

```
短期记忆 (DB)                        长期记忆 (策略文件)
─────────────                        ──────────────────
每次 session 的统计数据               从数据中提炼的稳定规则
高频写入、结构化查询                  低频更新、人可审查
支撑实时决策                          跨 session 指导研究策略
```

**DB 层: ResearchSessionMeta**

```prisma
model ResearchSessionMeta {
  id              String   @id @default(uuid())
  sessionId       String   @unique                @map("session_id")
  userId          String                          @map("user_id")

  // 分类
  topicType       String                          @map("topic_type")
  // "product" | "market" | "technology" | "strategy" | "audience" | "trend"
  topicKeywords   String[]                        @map("topic_keywords")

  // 搜索统计
  searchStats     Json                            @map("search_stats")
  // { totalSources, uniqueDomains, languageDistribution, avgRelevanceScore }

  // 质量指标
  qualityMetrics  Json                            @map("quality_metrics")
  // { coverageRate, sourcesDiversity, informationGain, finalDemoScore }

  // 策略使用记录
  strategyUsed    Json                            @map("strategy_used")
  // 这次应用了哪些策略 [{ ruleId, description }]
  strategyEffect  Json                            @map("strategy_effect")
  // 哪条策略起了正面/负面作用 [{ ruleId, effect: "positive"|"negative"|"neutral" }]

  // 迭代统计
  iterationCount  Int      @default(1)            @map("iteration_count")
  exitReason      String?                         @map("exit_reason")

  // 提炼的经验 (LLM 从本次 session 中总结)
  lessons         Json?
  // [{ pattern, recommendation, confidence }]

  createdAt       DateTime @default(now())         @map("created_at")

  // Relations
  session         DeepResearchSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@map("research_session_meta")
}
```

**策略文件层:**

```
backend/src/modules/ai-app/research/strategies/
├── research-strategies.md          # 系统级研究策略 (类比 program.md)
├── strategy-loader.service.ts      # 启动时加载策略，注入研究流程
└── strategy-evolver.service.ts     # 定期分析 DB 数据，提炼新策略
```

`research-strategies.md` 示例：

```markdown
# Research Strategies

## Search Rules

- GLOBAL_TOPIC: 至少 30% 搜索轮次使用英文 query
- ACADEMIC_TOPIC: 优先使用 academic 类型搜索步骤
- CURRENT_EVENTS: 添加时间限定词 (近 7 天/30 天)
- MARKET_DATA: 搜索 query 中加入 "statista", "report", "data" 等关键词

## Demo Rules

- AUDIENCE_RESEARCH: Demo 必须包含 ≥3 个细分画像
- MARKET_RESEARCH: Demo 必须有可交互的时间趋势图
- TECHNOLOGY_RESEARCH: Demo 需要技术对比矩阵

## Agent Config Rules

- CONTROVERSIAL_TOPIC: Analyst creativity 提高到 high
- TECHNICAL_TOPIC: Researcher C 视角从"社会影响"换为"技术架构"
```

### 8.2 Memory 的读写时机

```
研究开始时:
  1. strategy-loader 读取 research-strategies.md
  2. 查询 DB 中同类 topicType 的历史 sessions
  3. 将策略 + 历史统计注入到研究配置中

研究结束时:
  1. 计算本次 session 的统计数据 → 写入 ResearchSessionMeta
  2. LLM 总结本次经验教训 → 写入 lessons 字段

定期 (或每 N 次研究后):
  1. strategy-evolver 分析 DB 中积累的数据
  2. 发现稳定模式 → 提炼为新策略
  3. 追加到 research-strategies.md
```

---

## 9. 前端改造方案

### 9.1 改造范围

```
frontend/
├── hooks/features/
│   ├── useDiscussionResearch.ts     # 改造: 支持迭代事件
│   ├── useResearchDemos.ts          # 改造: 版本历史、评分数据
│   ├── useResearchIdeas.ts          # 改造: Idea Pool 累积统计
│   └── useIterativeResearch.ts      # 新增: 迭代研究状态管理
├── components/ai-research/
│   ├── ResearchProjectLayout.tsx    # 改造: 迭代模式入口, Tab 调整
│   └── discussion/
│       ├── DemosPanel.tsx           # 重构 → IterativeResearchPanel.tsx
│       ├── IterationTimeline.tsx    # 新增: 迭代时间线 (横向节点)
│       ├── ResearchDataCard.tsx     # 新增: 数据层卡片 (来源统计)
│       ├── IdeaPoolCard.tsx         # 新增: 认知层卡片 (Idea 池)
│       ├── DemoPreviewCard.tsx      # 新增: 产品层卡片 (Demo 预览+评分)
│       ├── IterationDetailView.tsx  # 新增: 迭代详情 (md 渲染)
│       ├── DemoVersionSwitcher.tsx  # 新增: Demo 版本切换
│       └── DeepResearchPanel.tsx    # 改造: 增加"迭代研究"模式开关
└── types/
    └── ai-research/
        └── types.ts                 # 扩展: 迭代 + Idea Pool 类型
```

### 9.2 DeepResearchPanel 改造

现有的 `DeepResearchPanel.tsx` 是研究启动面板。增加迭代模式选项：

```typescript
// DeepResearchPanel.tsx 新增
interface ResearchMode {
  type: "single" | "iterative"; // 单次研究 vs 迭代研究
}

// 用户选择:
// ┌─────────────────────────────────┐
// │  研究模式                        │
// │  ○ 单次研究 (现有模式)           │
// │  ● 迭代研究 (自动优化)           │
// │    目标: 生成可操作的 Demo 软件   │
// │    系统会自动评估并迭代改进       │
// └─────────────────────────────────┘
```

### 9.3 DemosPanel 重构

从简单的 Demo 列表改为完整的迭代展示面板：

```typescript
// DemosPanel.tsx 核心结构 (重构为迭代研究面板)
export function IterativeResearchPanel({ projectId, sessionId }: Props) {
  const [selectedRound, setSelectedRound] = useState<number>(0);

  return (
    <div>
      {/* 迭代时间线 (顶部横向) */}
      <IterationTimeline
        iterations={iterations}
        selected={selectedRound}
        onSelect={setSelectedRound}
      />

      {/* 选中迭代的三层并排展示 */}
      <div className="grid grid-cols-3 gap-4">
        {/* 数据层 */}
        <ResearchDataCard
          sources={iterations[selectedRound].research}
        />

        {/* 认知层 */}
        <IdeaPoolCard
          insights={iterations[selectedRound].ideas.newInsights}
          creativeIdeas={iterations[selectedRound].ideas.newCreativeIdeas}
          totalInsights={iterations[selectedRound].ideas.totalInsights}
          totalCreativeIdeas={iterations[selectedRound].ideas.totalCreativeIdeas}
        />

        {/* 产品层 */}
        <DemoPreviewCard
          html={demoVersions[selectedRound]?.htmlContent}
          score={iterations[selectedRound].demo.score}
          gaps={iterations[selectedRound].gaps}
        />
      </div>

      {/* 迭代详情 (md 渲染，可折叠) */}
      <IterationDetailView
        iteration={iterations[selectedRound]}
      />

      {/* Demo 全屏查看 + 版本切换 */}
      <DemoVersionSwitcher
        versions={demoVersions}
        current={selectedRound}
        onChange={setSelectedRound}
      />
    </div>
  );
}
```

### 9.4 useIterativeResearch Hook

```typescript
// hooks/features/useIterativeResearch.ts
interface IterativeResearchState {
  // 基础状态
  phase:
    | "idle"
    | "researching"
    | "extracting_ideas"
    | "generating_demo"
    | "evaluating"
    | "iterating"
    | "completed";
  currentIteration: number;
  maxIterations: number;

  // 三层产出追踪
  research: {
    totalSources: number;
    informationGain: number;
  };
  ideaPool: {
    insights: IdeaSummary[]; // 所有累积的 Insight
    creativeIdeas: IdeaSummary[]; // 所有累积的 Creative Idea
  };
  demo: {
    scores: number[]; // 每轮评分
    currentHtml: string; // 当前最佳 Demo
    versions: DemoVersion[]; // 历史版本
  };

  // gaps
  currentGaps: {
    dataGaps: string[];
    ideaGaps: string[];
  };
  exitReason?: string;

  // 迭代记录
  iterations: IterationRecord[];

  // 操作
  startIterativeResearch: (query: string, options: ResearchOptions) => void;
  selectIteration: (round: number) => void;
  switchDemoVersion: (round: number) => void;
}

interface IdeaSummary {
  id: string;
  title: string;
  type: "INSIGHT" | "CREATIVE_IDEA";
  sourceRound: number; // 哪一轮迭代提取的
  adoptedInDemo: boolean; // 是否被 Demo 采纳
}
```

### 9.5 SSE 事件处理

在现有 `useDiscussionResearch.ts` 的 `handleSSEEvent` 中扩展：

```typescript
// useDiscussionResearch.ts 扩展
case 'iteration.start':
  setState(prev => ({
    ...prev,
    phase: 'iterating',
    currentIteration: event.data.round,
    currentGaps: event.data.targetGaps,
  }));
  break;

case 'iteration.eval':
  setState(prev => ({
    ...prev,
    phase: 'evaluating',
    scores: [...prev.scores, event.data.score],
    currentGaps: event.data.gaps,
  }));
  break;

case 'iteration.exit':
  setState(prev => ({
    ...prev,
    phase: 'completed',
    exitReason: event.data.reason,
  }));
  break;
```

---

## 10. 后端 API 设计

### 10.1 新增 API

```
POST /ai-studio/projects/{projectId}/iterative-research/stream
  → 启动迭代研究 (SSE)
  Body: StartIterativeResearchDto

GET  /ai-studio/projects/{projectId}/sessions/{sessionId}/iterations
  → 获取迭代历程

GET  /ai-studio/projects/{projectId}/sessions/{sessionId}/iterations/{round}
  → 获取单次迭代详情 (md 内容)

GET  /ai-studio/projects/{projectId}/sessions/{sessionId}/demo-versions
  → 获取 Demo 版本列表

GET  /ai-studio/projects/{projectId}/sessions/{sessionId}/demo-versions/{round}
  → 获取指定版本的 Demo HTML
```

### 10.2 DTO

```typescript
interface StartIterativeResearchDto extends StartDeepResearchDto {
  mode: "single" | "iterative"; // 单次 vs 迭代
  iterationOptions?: {
    maxIterations?: number; // 最大迭代次数 (默认按 depth)
    qualityThreshold?: number; // 质量阈值 (默认按 depth)
    autoGenerateDemo?: boolean; // 是否自动生成 Demo (默认 true)
  };
}
```

### 10.3 与现有 API 的兼容

**`mode: 'single'`** 时行为完全等同现有流程（走 `DiscussionOrchestratorService`），零 breaking change。

**`mode: 'iterative'`** 时走新的 `IterativeResearchService`。

Controller 路由建议复用现有 `DiscussionController`，或新增独立的 `IterativeResearchController`：

```typescript
// 方案 A: 在现有 controller 中加路由
@Controller('ai-studio/projects/:projectId')
export class DiscussionController {
  // 现有: 单次研究
  @Post('deep-research/stream')
  startDiscussion() { ... }

  // 新增: 迭代研究
  @Post('iterative-research/stream')
  startIterativeResearch() { ... }
}
```

---

## 11. 数据库变更

### 11.1 Schema 变更

```prisma
// 在 DeepResearchSession 中新增字段
model DeepResearchSession {
  // ... 现有字段全部保留 ...

  // 新增: 迭代研究支持
  researchMode     String    @default("single")  @map("research_mode")
  // "single" | "iterative"
  iterations       Json[]    @default([])
  // IterationRecord[]
  currentIteration Int       @default(0)          @map("current_iteration")
  demoVersions     Json[]    @default([])          @map("demo_versions")
  // { round: number, htmlContent: string, score: number }[]
  finalScore       Float?                          @map("final_score")
  exitReason       String?                         @map("exit_reason")
  topicType        String?                         @map("topic_type")
}

// 新增: 研究元认知
model ResearchSessionMeta {
  id              String   @id @default(uuid())
  sessionId       String   @unique                @map("session_id")
  userId          String                          @map("user_id")
  topicType       String                          @map("topic_type")
  topicKeywords   String[]                        @map("topic_keywords")
  searchStats     Json                            @map("search_stats")
  qualityMetrics  Json                            @map("quality_metrics")
  strategyUsed    Json     @default("[]")         @map("strategy_used")
  strategyEffect  Json     @default("[]")         @map("strategy_effect")
  iterationCount  Int      @default(1)            @map("iteration_count")
  exitReason      String?                         @map("exit_reason")
  lessons         Json?
  createdAt       DateTime @default(now())         @map("created_at")

  session         DeepResearchSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@map("research_session_meta")
}
```

### 11.2 迁移 SQL

```sql
-- 迭代研究字段
ALTER TABLE "deep_research_sessions"
  ADD COLUMN IF NOT EXISTS "research_mode" VARCHAR(20) DEFAULT 'single',
  ADD COLUMN IF NOT EXISTS "iterations" JSONB[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "current_iteration" INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "demo_versions" JSONB[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "final_score" FLOAT,
  ADD COLUMN IF NOT EXISTS "exit_reason" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "topic_type" VARCHAR(50);

-- 研究元认知表
CREATE TABLE IF NOT EXISTS "research_session_meta" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id" UUID NOT NULL UNIQUE REFERENCES "deep_research_sessions"("id") ON DELETE CASCADE,
  "user_id" UUID NOT NULL,
  "topic_type" VARCHAR(50) NOT NULL,
  "topic_keywords" TEXT[] DEFAULT '{}',
  "search_stats" JSONB NOT NULL DEFAULT '{}',
  "quality_metrics" JSONB NOT NULL DEFAULT '{}',
  "strategy_used" JSONB NOT NULL DEFAULT '[]',
  "strategy_effect" JSONB NOT NULL DEFAULT '[]',
  "iteration_count" INT NOT NULL DEFAULT 1,
  "exit_reason" VARCHAR(50),
  "lessons" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "idx_rsm_user_topic" ON "research_session_meta" ("user_id", "topic_type");
CREATE INDEX "idx_rsm_created" ON "research_session_meta" ("created_at" DESC);
```

---

## 12. Credits 消耗估算

| 阶段                  | 消耗     | 说明                           |
| --------------------- | -------- | ------------------------------ |
| 初始研究 (完整流程)   | 300-1500 | 按 depth 现有定价              |
| 话题分类              | ~10      | 1 次 CHAT_FAST                 |
| Idea 提取 (每次)      | ~50      | 1 次 CHAT (extractFromSession) |
| Demo 生成 (每次)      | ~100     | 1 次 CHAT 长输出               |
| Demo 评估 (每次)      | ~30      | 1 次 CHAT_FAST                 |
| 针对性补充搜索 (每次) | ~100     | 2-3 个搜索步骤                 |

**每次迭代 ≈ 280 credits**（补充搜索 + Idea 提取 + Demo 生成 + 评估）

**总计估算：**

| Depth    | 初始研究 | 平均迭代次数 | 迭代成本 | 总计       |
| -------- | -------- | ------------ | -------- | ---------- |
| quick    | 300      | 1            | 280      | ~580       |
| standard | 700      | 2-3          | 560-840  | ~1260-1540 |
| thorough | 1500     | 3-5          | 840-1400 | ~2340-2900 |

---

## 13. 新增文件清单

### 后端

```
backend/src/modules/ai-app/research/
├── iteration/                                    # 新增目录
│   ├── iterative-research.service.ts             # 外层迭代编排器
│   ├── iterative-research.controller.ts          # API 路由 (或合并到现有 controller)
│   ├── iterative-research.dto.ts                 # 请求 DTO
│   ├── iteration-record.service.ts               # md 记录生成
│   ├── types.ts                                  # 迭代相关类型
│   └── __tests__/
│       ├── iterative-research.service.spec.ts
│       └── iteration-record.service.spec.ts
│
├── evaluation/                                   # 新增目录
│   ├── demo-evaluator.service.ts                 # Demo 评估
│   ├── demo-auto-analyzer.ts                     # HTML DOM 自动分析
│   ├── exit-decision.service.ts                  # 退出决策
│   ├── topic-classifier.service.ts               # 研究类型分类
│   └── __tests__/
│       ├── demo-evaluator.service.spec.ts
│       ├── demo-auto-analyzer.spec.ts
│       └── exit-decision.service.spec.ts
│
├── memory/                                       # 新增目录
│   ├── research-memory.service.ts                # 元认知读写
│   ├── strategy-loader.service.ts                # 策略加载
│   ├── strategy-evolver.service.ts               # 策略进化
│   └── __tests__/
│       └── research-memory.service.spec.ts
│
├── strategies/                                   # 新增目录
│   └── research-strategies.md                    # 系统级策略文件
│
├── demo/
│   └── research-demo.service.ts                  # 改造: 支持类型适配 + 迭代生成
│
└── research.module.ts                            # 改造: 注册新 services
```

### 前端

```
frontend/
├── hooks/features/
│   ├── useIterativeResearch.ts                   # 新增: 迭代状态管理
│   ├── useDiscussionResearch.ts                  # 改造: 扩展迭代事件
│   ├── useResearchDemos.ts                       # 改造: 版本历史
│   └── useResearchIdeas.ts                       # 改造: Idea Pool 累积
│
├── components/ai-research/discussion/
│   ├── DemosPanel.tsx → IterativeResearchPanel.tsx # 重构: 三层迭代展示
│   ├── IterationTimeline.tsx                     # 新增: 迭代时间线
│   ├── ResearchDataCard.tsx                      # 新增: 数据层卡片
│   ├── IdeaPoolCard.tsx                          # 新增: 认知层卡片
│   ├── DemoPreviewCard.tsx                       # 新增: 产品层卡片
│   ├── IterationDetailView.tsx                   # 新增: 迭代详情 (md 渲染)
│   ├── DemoVersionSwitcher.tsx                   # 新增: 版本切换
│   └── DeepResearchPanel.tsx                     # 改造: 迭代模式开关
│
└── types/ai-research/
    └── types.ts                                  # 扩展: 迭代 + Idea Pool 类型
```

### 数据库

```
backend/prisma/
├── schema/models.prisma                          # 改造: 新增字段 + 新 model
└── migrations/YYYYMMDD_iterative-research/
    └── migration.sql                             # 手写迁移
```

---

## 14. 实施路径

### Phase 1: 评估闭环 (MVP)

**目标：Research → Idea → Demo → 评估 → 打分，但不迭代**

- [ ] `topic-classifier.service.ts` — 研究类型分类
- [ ] 改造 `research-demo.service.ts` — 根据类型选择 Demo 形态 + 接收 Idea Pool 作为输入
- [ ] `demo-auto-analyzer.ts` — HTML DOM 分析
- [ ] `demo-evaluator.service.ts` — 自动 + LLM 双层评估，输出 dataGaps / ideaGaps
- [ ] 前端 `DemoPreviewCard.tsx` — 展示评分 + gaps

**验证方式：** 现有流程: Research → extractIdeas → generateDemo → evaluateDemo 能跑通，输出分数 + 分类 gaps。

### Phase 2: 迭代循环

**目标：完整的 Research → Idea → Demo → 评估 → 补充 → 迭代 循环**

- [ ] `exit-decision.service.ts` — 退出决策 (五条件)
- [ ] `iterative-research.service.ts` — 外层编排器 (含 Idea Pool 累积逻辑)
- [ ] `iteration-record.service.ts` — md 记录 (三层产出快照)
- [ ] 数据库迁移 — DeepResearchSession 新字段 + ResearchSessionMeta 新表
- [ ] SSE 事件扩展 — iteration.start / .research / .ideas / .demo / .eval / .exit
- [ ] 前端 `IterativeResearchPanel.tsx` (含 IterationTimeline + 三栏展示)

**验证方式：** 一个研究主题跑完整迭代循环，产出 Demo + 报告 + Idea 集 + md 历程。每轮 Idea Pool 递增。

### Phase 3: Research Memory

**目标：跨 session 的经验积累**

- [ ] `research-memory.service.ts` — 元认知读写
- [ ] `strategy-loader.service.ts` — 启动时加载策略
- [ ] `research-strategies.md` — 初始策略文件
- [ ] 研究开始时注入历史经验
- [ ] 研究结束时沉淀新经验

**验证方式：** 第 N 次研究比第 1 次在同类话题上表现更好（分数更高、迭代次数更少）。

### Phase 4: 策略自进化

**目标：系统自动从数据中提炼新策略**

- [ ] `strategy-evolver.service.ts` — 分析历史数据，提炼规则
- [ ] 定时任务或触发机制 (每 N 次研究后)
- [ ] 策略效果追踪和反馈

**验证方式：** `research-strategies.md` 中出现系统自动提炼的规则，且新规则对后续研究有正面影响。

---

## 15. 风险与应对

| 风险                  | 影响                  | 应对                                                        |
| --------------------- | --------------------- | ----------------------------------------------------------- |
| Demo 生成质量不稳定   | 迭代无法收敛          | 预算硬上限兜底；Demo 生成失败时保留上一版                   |
| LLM 评估不准确        | 误判导致过早/过晚退出 | 自动指标权重 > LLM 指标；多条件投票决策                     |
| 迭代成本过高          | 用户 credits 消耗过快 | 前端明确展示预估成本；迭代过程中实时展示消耗                |
| 补充搜索找不到新信息  | 迭代无进展            | 信息饱和检测自动退出；换搜索引擎/语言                       |
| demoVersions 占用空间 | 数据库膨胀            | 只存有实质变更的版本；超过 N 版后只保留 init + best + final |

---

## 附录 A: 与 Karpathy autoresearch 的完整对照

| 维度         | autoresearch             | GenesisPod Iterative Research                |
| ------------ | ------------------------ | -------------------------------------------- |
| 指导文件     | `program.md` (人写)      | `research-strategies.md` (人写 + 自动进化)   |
| 可执行产物   | `train.py` (模型代码)    | Demo HTML (可操作软件)                       |
| 中间认知层   | 无 (直接改代码)          | **Idea Pool** (INSIGHT + CREATIVE_IDEA 累积) |
| 不可变基础   | `prepare.py` (数据/评估) | 评估系统 + 退出逻辑                          |
| 实验预算     | 5 分钟/次                | credits 配额 + 迭代上限                      |
| 评估指标     | val_bpb (单一数字)       | composite score (加权多指标)                 |
| 改进方向识别 | Agent 自主决定           | gaps 列表驱动 (dataGaps + ideaGaps)          |
| 版本控制     | git commit/reset         | 独立 md + demoVersions                       |
| 成功保留     | `git commit`             | 更新 bestDemo + 写入 md                      |
| 失败丢弃     | `git reset`              | 保留记录但标记 delta 为负                    |
| 退出条件     | 固定时间 or 收敛         | 达标/饱和/收敛/预算/无gaps 五条件            |
| 经验积累     | git history              | ResearchSessionMeta + 策略文件               |
| 交付物       | 改进后的 train.py        | Demo 软件 + 报告 + Idea 集 + 迭代历程        |
| 呈现方式     | git log / 终端输出       | 三层并排 (数据层/认知层/产品层) 按迭代维度   |
| 分布式协作   | AgentHub (规划中)        | 多用户共享 Research Memory (未来)            |

---

_最后更新: 2026-03-10_
_作者: Claude Code + 用户共同讨论_
_状态: 方案设计完成，待评审_
