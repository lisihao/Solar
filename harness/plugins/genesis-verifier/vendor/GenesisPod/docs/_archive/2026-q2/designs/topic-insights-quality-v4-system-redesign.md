# Topic Insights 报告质量系统性重设计方案

> **文档版本**: v1.0 (Draft for Review)
> **创建日期**: 2026-03-06
> **作者**: Claude Code
> **状态**: 待评审
> **前序文档**: `topic-insights-report-quality-v3.md`（格式层修复，聚焦 Prompt/后处理）
> **关联模块**: `backend/src/modules/ai-app/topic-insights/`

---

## 0. 文档定位

v3 方案（2026-03-05）聚焦**格式层问题**（标题坍塌、加粗过度、分割线等），属于 Prompt 和后处理修补。

本文档（v4）聚焦**架构和数据流层面的根本问题**：

- 为什么 AI 被迫编造内容？（证据贫困）
- 为什么 140+ 次 LLM 调用没有带来质量提升？（审阅循环失效）
- 为什么图表全是假数据？（图表生成架构缺陷）
- 为什么语言混杂？（语言一致性缺失）
- 为什么 Agent 之间内容矛盾？（上下文隔离）

**v3 和 v4 是互补关系**：v3 解决"呈现不专业"，v4 解决"内容不可靠"。

---

## 1. 现状基线（代码级量化）

### 1.1 模块规模

| 指标             | 数值                                                     |
| ---------------- | -------------------------------------------------------- |
| 服务文件数       | 57                                                       |
| 服务代码行数     | ~52,000                                                  |
| Prompt 文件数    | 8                                                        |
| Prompt 代码行数  | 2,525                                                    |
| 测试文件数       | 98                                                       |
| Prisma 模型数    | 12+                                                      |
| 数据源连接器数   | 5（SemanticScholar, PubMed, Finance, Weather, Registry） |
| 支持的数据源类型 | 14（Web, Academic, GitHub, HackerNews, RSS, 政府源等）   |

### 1.2 数据流关键参数（当前值）

| 参数                  | 位置                               | 当前值                | 问题                   |
| --------------------- | ---------------------------------- | --------------------- | ---------------------- |
| `enrichmentTopN`      | `dimension-mission.service.ts:255` | **5**                 | 仅 5 篇全文抓取        |
| `enrichmentMaxLength` | `dimension-mission.service.ts:256` | **3000**              | 每篇仅 3000 字符       |
| 搜索结果数            | DataSourceRouter 返回              | ~25 条/维度           | 其余 20 条仅有摘要片段 |
| 摘要片段长度          | 搜索引擎返回                       | 100-300 字符          | 信息密度极低           |
| **总有效证据量**      | 计算                               | **~19K 字符/维度**    | 5x3000 + 20x200        |
| 维度输出要求          | section-writer                     | **1500-3000 字/维度** | —                      |
| 全报告输出            | 7 维度合计                         | **8000-15000 字**     | —                      |
| **输入/输出比**       | 计算                               | **~1.3:1 至 2.4:1**   | 远低于专业报告 10:1+   |

### 1.3 LLM 调用统计（单次报告生成）

| 阶段           | 调用次数     | 说明                                |
| -------------- | ------------ | ----------------------------------- |
| Leader 规划    | 1-3          | 维度规划 + 大纲生成                 |
| 每维度搜索阶段 | ~3           | 证据摘要 + 时间上下文 + Leader 补充 |
| 每维度写作阶段 | ~5           | 分节规划 + 各节撰写                 |
| 每维度审阅循环 | 2-6          | 每轮 2 次（审阅+修改），最多 3 轮   |
| 一致性检查     | 1            | 基于 800 字摘要                     |
| 报告合成       | 1-2          | 执行摘要 + 综合分析                 |
| V5 认知循环    | 2-4          | Claim 提取 + 假设验证               |
| 质量审查       | 1            | OutputReviewerService               |
| **总计**       | **108-150+** | standard depth                      |

### 1.4 报告实际质量问题（最新导出分析）

| 问题类别         | 具体表现                              | 根因层       |
| ---------------- | ------------------------------------- | ------------ |
| **内容编造**     | AI 凭空生成数据、趋势、百分比         | 证据不足     |
| **图表假数据**   | 11 个图表全为 AI 编造，0 个真实参考图 | 架构缺陷     |
| **语言混杂**     | 中文报告大段英文段落和英文观点        | 语言控制缺失 |
| **维度矛盾**     | 不同维度对同一事实的描述不一致        | 上下文隔离   |
| **编号混乱**     | 39 处文内编号错误，109 个碎片 `<ol>`  | 后处理 bug   |
| **LaTeX 未渲染** | 37 个原始 LaTeX 公式显示为文本        | 前端缺 KaTeX |
| **格式过度**     | 313 处加粗、98 个引用块、51 条分割线  | v3 已定位    |

---

## 2. 根因诊断：五个架构级缺陷

### 2.1 缺陷 A：证据贫困（最致命）

**代码证据**：

```
位置: dimension-mission.service.ts:255-257
const enrichmentTopN = (topicConfig?.enrichmentTopN as number) || 5;
const enrichmentMaxLength = (topicConfig?.enrichmentMaxLength as number) || 3000;
```

**数学证明**：

```
每维度有效证据 = 5篇 x 3000字 + 20篇 x 200字 = 19,000 字
每维度输出要求 = 1500-3000 字
7个维度总输出 = 10,500-21,000 字
全报告总证据 = 7 x 19,000 = 133,000 字（理论上限，实际有大量重叠和低质量片段）
实际高质量证据 = 7 x 15,000 = 105,000 字（5篇全文 x 7维度 = 35篇）

但实际问题更严重：
- 7 个维度各自独立搜索，但搜索结果高度重叠
- 不同维度可能抓取相同 URL
- 3000 字截断经常截断在段落中间，丢失上下文
- 搜索摘要片段 (200字) 几乎无法支撑深度分析
```

**对比专业报告**：

| 维度         | Topic Insights      | McKinsey 报告            | Gartner 报告        |
| ------------ | ------------------- | ------------------------ | ------------------- |
| 原始数据量   | ~19K 字/维度        | 100K+ 字/章节            | 50K+ 字/章节        |
| 数据来源数   | 5 篇全文 + 20 摘要  | 50-100 篇全文            | 30-50 篇全文        |
| 输入/输出比  | 1.3-2.4:1           | 10-20:1                  | 8-15:1              |
| 数据获取方式 | 搜索引擎 + 网页抓取 | 专有数据库 + 访谈 + 调查 | 专有数据库 + 分析师 |

**结论**：当前证据量无法支撑深度分析报告。AI 被迫在"编造"和"重复"之间选择。

### 2.2 缺陷 B：审阅循环失效

**代码证据**：

```
位置: leader-review.service.ts (审阅逻辑)

审阅循环: 最多 maxRevisionRounds 轮 (standard=2, thorough=3)
每轮: Leader 审阅 → 通过/拒绝 → 修改 → 再审阅
强制通过: 达到最大轮次后自动通过
```

**问题分析**：

1. **审阅者和作者用同一个 LLM**：Leader 审阅 Agent 的写作，但两者都是 LLM——LLM 审 LLM 无法发现 LLM 的系统性偏差
2. **审阅标准模糊**：Prompt 说"检查质量"，但没有量化标准
3. **证据不足无解**：审阅发现"内容浅薄"→ 要求修改 → Agent 还是只有那些证据 → 修改后换个措辞，本质不变 → 2 轮后强制通过
4. **成本极高**：每维度 2-6 次额外 LLM 调用，但质量改善无法量化

**一致性检查同样失效**：

```
位置: report-synthesis.service.ts:585-692
checkCrossDimensionConsistency()

输入: 各维度的 800 字摘要（占全文 1.5-3%）
方式: 让 LLM 找矛盾
问题: 基于摘要检查，矛盾在正文中但摘要中看不到
```

### 2.3 缺陷 C：维度间上下文完全隔离

**代码证据**：

```
位置: topic-team-orchestrator.service.ts:541-574
researchDimensionsInParallel()

每个维度独立执行:
- 独立搜索 (可能搜到相同 URL)
- 独立抓取 (可能重复抓取)
- 独立写作 (完全不知道其他维度写了什么)
- 独立审阅 (审阅者也不知道其他维度)
```

**后果**：

- 同一数据在不同维度中出现不同表述/数值
- 多个维度重复论述相同观点（后处理 `deduplicateParagraphs()` 只能去重完全相同的段落，无法处理语义重复）
- 章节间无逻辑递进，像 7 篇独立短文拼接

### 2.4 缺陷 D：图表生成架构错误

**代码证据**：

```
位置: figure-extractor.service.ts — 从网页提取真实图片
位置: section-writer.service.ts — AI 可以生成 generatedCharts
位置: ReportChartRenderer.tsx — 前端渲染 Recharts 图表
位置: html-capture.service.ts — 导出时冻结 Recharts SVG
```

**问题链**：

```
1. figure-extractor 从 Top 5 全文页面提取图片
   → 但很多页面不含 <figure>/<img> 或图片被 JS 延迟加载
   → 实际提取到的图片数 ≈ 0

2. AI 发现"没有参考图片"→ 自行生成 generatedCharts
   → 数据完全编造（因为证据中无原始数据）
   → 图表标题和数据看起来专业但全是假的

3. Recharts 异步渲染
   → 导出时 SVG 未完成 → 空白图表
   → freezeRechartsElements() 检测到空 SVG → fallback 为 sr-only 表格
   → sr-only 表格在导出中不可见
   → 最终：11 个空白占位
```

### 2.5 缺陷 E：语言一致性无控制

**代码证据**：

```
位置: dimension-research.prompt.ts
getLanguageInstruction(language) 返回语言指令
→ 但仅作为 Prompt 中的一条指令
→ AI 经常忽略（特别是引用英文文献时直接使用英文段落）
→ 无后处理强制检查
→ 无运行时语言比例验证
```

**表现**：中文报告中出现大段英文论述、英文观点表述、未翻译的英文引用内容。

---

## 3. 系统性重设计方案

### 3.1 方案总览

| 改造层               | 目标                          | 改动范围                                   | 风险                     |
| -------------------- | ----------------------------- | ------------------------------------------ | ------------------------ |
| **L1: 证据层增强**   | 输入/输出比从 2:1 提升到 8:1+ | data-enrichment, dimension-mission         | 中（增加抓取成本和时间） |
| **L2: 上下文共享**   | 消除维度间信息孤岛            | topic-team-orchestrator, dimension-mission | 低（增加参数传递）       |
| **L3: 审阅机制重构** | 用代码规则替代 LLM 审阅       | leader-review, report-synthesis            | 中（改变审阅范式）       |
| **L4: 图表策略重建** | 禁止编造，仅用真实数据/图片   | section-writer, report-synthesis, prompts  | 低（减少功能）           |
| **L5: 语言一致性**   | 目标语言内容占比 >= 95%       | prompts, report-formatting.utils           | 低（增加后处理）         |
| **L6: 质量门控管道** | 代码强制执行质量标准          | 新增 report-quality-gate.service           | 低（新增服务）           |

### 3.2 L1: 证据层增强

#### 3.2.1 提升全文抓取量

**改动文件**: `dimension-mission.service.ts:255-257`

| 参数                  | 当前 | 目标     | 理由                                                   |
| --------------------- | ---- | -------- | ------------------------------------------------------ |
| `enrichmentTopN`      | 5    | **12**   | 每维度 12 篇全文，7 维度去重后约 50-60 篇独立来源      |
| `enrichmentMaxLength` | 3000 | **6000** | 现代 LLM 上下文足够大，6000 字能覆盖大多数文章核心内容 |

**效果预测**：

```
改造前: 5 x 3000 + 20 x 200 = 19,000 字/维度
改造后: 12 x 6000 + 13 x 200 = 74,600 字/维度
提升: 3.9x
输入/输出比: 从 2:1 提升到 ~8:1
```

#### 3.2.2 跨维度证据去重与共享

**改动文件**: `topic-team-orchestrator.service.ts`

**当前问题**: 7 个维度各自独立搜索和抓取，可能重复抓取相同 URL。

**方案**:

```typescript
// 新增：全局证据池（在 orchestrator 层管理）
interface GlobalEvidencePool {
  // URL → 全文内容的映射，避免重复抓取
  fetchedUrls: Map<string, { content: string; figures: FigureReference[] }>;
  // 所有已收集的证据条目
  allEvidence: EnrichedEvidenceData[];
}

// 执行流程变更:
// 1. 所有维度的搜索阶段先并行执行，收集 URL 列表
// 2. 全局去重 URL 列表
// 3. 统一批量抓取去重后的 URL（避免重复请求）
// 4. 将全文内容分发给各维度
```

**关键改动点**:

- `topic-team-orchestrator.service.ts`: 新增 `buildGlobalEvidencePool()` 方法
- `dimension-mission.service.ts`: `executeSearchPhase()` 接受外部证据池参数
- `data-enrichment.service.ts`: 支持传入已抓取内容（跳过重复抓取）

#### 3.2.3 二轮迭代搜索

**改动文件**: `dimension-search.service.ts`

**当前**: 每个维度一轮搜索，基于预设 `searchQueries`。

**方案**: 增加可选的二轮搜索：

```
第一轮: 基于 dimension.searchQueries 搜索 → 获取初步结果
      ↓
AI 提取: 从初步结果中提取关键实体、术语、人名、机构名
      ↓
第二轮: 用新术语构造精确搜索查询 → 获取补充结果
      ↓
合并去重: 第一轮 + 第二轮结果合并
```

**配置**:

- `researchDepth: 'quick'` → 不做二轮搜索
- `researchDepth: 'standard'` → 可选二轮（topicConfig 控制）
- `researchDepth: 'thorough'` → 始终做二轮搜索

**预期效果**: 搜索结果从 25 条提升到 40-50 条，覆盖更多角度。

### 3.3 L2: 维度间上下文共享

#### 3.3.1 共享大纲机制

**改动文件**: `topic-team-orchestrator.service.ts`, `dimension-mission.service.ts`

**当前**: 各维度独立写作，互不知情。

**方案**: 在所有维度搜索完成后、写作开始前，增加"全局大纲"阶段：

```
搜索阶段（并行）→ 全部完成
      ↓
全局大纲生成（1 次 LLM 调用）:
  输入: 所有维度的 evidenceSummary
  输出: {
    globalOutline: "各维度应覆盖的要点分配",
    sharedFacts: "跨维度共享的关键数据点和事实",
    avoidDuplication: "各维度应避免重复的内容"
  }
      ↓
写作阶段（并行）: 每个维度收到 globalOutline + sharedFacts 作为额外上下文
```

**成本**: 增加 1 次 LLM 调用（全局大纲），但消除维度间矛盾和重复。

#### 3.3.2 共享事实注册表

**改动文件**: `topic-team-orchestrator.service.ts`

V5 架构中已有 `ContextEvolutionService`（`ai-engine/facade` 导出），但当前仅用于 V5 认知循环的后期阶段。

**方案**: 将其前移到写作阶段：

```typescript
// 在搜索阶段提取关键事实
const sharedFacts =
  await this.contextEvolution.extractFacts(allEvidenceSummaries);

// 在写作阶段传入每个维度
await this.dimensionMission.executeDimension(dim, {
  ...options,
  sharedFacts, // 所有维度看到相同的事实基准
});
```

### 3.4 L3: 审阅机制重构

#### 3.4.1 核心理念转变

**从**: "LLM 审阅 LLM 的输出"（主观、不可靠、成本高）
**到**: "代码规则强制执行 + LLM 仅做一次整体润色"（客观、确定性、低成本）

#### 3.4.2 取消多轮 LLM 审阅循环

**改动文件**: `leader-review.service.ts`, `dimension-mission.service.ts`

**当前**: 每维度最多 3 轮审阅循环（2-6 次 LLM 调用）。
**方案**: 取消 LLM 审阅循环，改为：

```
写作阶段: AI 一次写好（不审阅）
      ↓
代码质量门控: 检查格式、语言、长度等硬性指标
      ↓
如果不通过: 带具体问题描述重新请求 AI 修改（最多 1 次）
      ↓
如果还不通过: 代码自动修复可修复的问题（编号、语言混杂等）
```

**LLM 调用减少**: 每维度从 5-11 次降至 2-3 次。全报告从 108-150 次降至 **30-50 次**。

#### 3.4.3 新增质量门控服务

**新文件**: `services/quality/report-quality-gate.service.ts`

```typescript
interface QualityCheckResult {
  passed: boolean;
  violations: QualityViolation[];
  autoFixable: QualityViolation[]; // 代码可自动修复的
  requiresRewrite: QualityViolation[]; // 需要 AI 重写的
}

interface QualityViolation {
  rule: string; // 规则名
  severity: "error" | "warning";
  message: string; // 人可读描述
  location?: string; // 在内容中的位置
  autoFix?: () => string; // 自动修复函数（如果可自动修复）
}
```

**硬性规则（代码强制执行）**：

| 规则           | 检查方式             | 通过条件                      | 可自动修复？                |
| -------------- | -------------------- | ----------------------------- | --------------------------- |
| 语言一致性     | 检测外语段落比例     | 外语内容 < 5%（专有名词除外） | 部分可（删除纯外语段落）    |
| 标题层级       | 正则检查             | 仅 ###/####                   | 是（sanitizeHeadingLevels） |
| 编号连续性     | 解析编号序列         | 编号无跳跃/重复               | 是（重新编号）              |
| 加粗密度       | 统计 `**` 数量       | 每节 <= 3 处                  | 部分可（去除多余加粗）      |
| 引用块密度     | 统计 `>` 数量        | 每维度 <= 3 个                | 部分可（转为普通段落）      |
| 分割线         | 统计 `---`/`***`     | 0 个                          | 是（删除）                  |
| 内容长度       | 字符计数             | >= minWords, <= maxWords      | 否                          |
| 图表数据真实性 | 检查 generatedCharts | generatedCharts 数量 = 0      | 是（移除假图表）            |
| 引用覆盖       | 统计 `[n]` 引用      | 每节 >= 2 个不同来源          | 否                          |

### 3.5 L4: 图表策略重建

#### 3.5.1 核心原则

**禁止 AI 编造图表数据。** 图表只有两种合法来源：

1. **参考文献图片**（`figureReferences`）：从原始网页提取的真实图片
2. **证据中的真实数据**：从抓取的全文中提取的具体数据表格/数值

如果两者都没有，**该维度不放图表**。宁可没有图表也不放假图表。

#### 3.5.2 改动

**改动文件**: `section-writer.service.ts`, `dimension-research.prompt.ts`

1. **Prompt 层**: 明确禁止 AI 自行编造数据生成图表

```
禁止行为：
- 禁止编造任何数据用于图表
- 禁止生成没有证据来源的定量图表
- 如果证据中无可视化数据，不要生成图表

允许行为：
- 引用证据中提到的具体数据（标注来源）
- 引用参考文献中的图片
- 用文字描述趋势，不必强制配图
```

2. **代码层**: 质量门控中检查并移除 `generatedCharts`（如果数据无法追溯到证据）

3. **提升参考图片提取率**:
   - `enrichmentTopN` 从 5 提升到 12 → 更多页面被抓取 → 更多机会提取图片
   - `figure-extractor.service.ts`: 扩展提取逻辑，支持 `<img>` 在 `<article>` 内的图片
   - 保存图片 URL 到证据记录，前端 `FigureRenderer` 可直接展示

#### 3.5.3 导出修复

**改动文件**: `html-capture.service.ts`

对于保留的参考文献图片（`<img>` 标签），导出时已有 `inlineImages` 逻辑将其转为 data: URL，无需额外改动。

移除假图表后，Recharts SVG 冻结问题自然消失（不再有 Recharts 组件需要冻结）。

### 3.6 L5: 语言一致性

#### 3.6.1 Prompt 层

**改动文件**: `dimension-research.prompt.ts`, `report-synthesis.prompt.ts`

在 `getLanguageInstruction()` 返回的指令中强化：

```
语言要求（强制）：
- 本报告目标语言为 ${targetLanguage}
- 所有分析、观点、论述必须使用目标语言
- 引用外文文献时：翻译核心内容为目标语言，原文可在括号中保留
- 专有名词/技术术语：首次出现时标注原文，后续统一使用目标语言
- 禁止：整段外语内容、外语句子表达观点、未翻译的外语引用
```

#### 3.6.2 后处理层

**改动文件**: `utils/report-formatting.utils.ts`

新增 `enforceLanguageConsistency(content, targetLanguage)` 函数：

```typescript
/**
 * 检测并标记外语内容段落
 * 返回: 外语比例和问题位置列表
 * 不自动删除（可能误判专有名词），但提供给质量门控
 */
function detectForeignLanguageBlocks(
  content: string,
  targetLanguage: string,
): { ratio: number; blocks: { start: number; end: number; text: string }[] };
```

检测逻辑：

- 中文目标：连续 50+ 个 ASCII 字母字符（排除引用标记 `[n]`、URL、代码块、专有名词列表）
- 英文目标：连续 20+ 个非 ASCII 字符（排除引用的中文原文）
- 阈值：外语内容占比 > 5% 为 violation

### 3.7 L6: 质量门控管道（整合所有检查）

**新文件**: `services/quality/report-quality-gate.service.ts`

```
写作输出
  ↓
[ReportQualityGateService.validate(content, targetLanguage, evidence)]
  ├─ 语言一致性检查
  ├─ 标题层级检查
  ├─ 编号连续性检查
  ├─ 加粗/引用块密度检查
  ├─ 分割线检查
  ├─ 图表真实性检查
  ├─ 引用覆盖检查
  └─ 内容长度检查
  ↓
[QualityCheckResult]
  ├─ autoFixable → 自动修复 → 返回修复后内容
  ├─ requiresRewrite → 带具体问题描述请求 AI 修改（1 次机会）
  └─ warnings → 记录日志，不阻断
```

**调用位置**:

- 维度写作完成后（替代当前的 LLM 审阅循环）
- 报告合成完成后（替代当前的一致性检查 + 质量审查）

---

## 4. 实施计划

### Phase 0: 立即止血（1-2 天）

**不改架构，只做安全的快速修复：**

| 改动                             | 文件                           | 风险 | 效果             |
| -------------------------------- | ------------------------------ | ---- | ---------------- |
| 禁用 generatedCharts             | `report-synthesis.service.ts`  | 低   | 消除假图表       |
| TopicContentPanel 加 KaTeX       | `TopicContentPanel.tsx`        | 低   | LaTeX 公式渲染   |
| 修复编号正则 bug                 | `report-formatting.utils.ts`   | 低   | 年份不被误当编号 |
| 提升 enrichmentTopN 到 10        | `dimension-mission.service.ts` | 低   | 证据量翻倍       |
| 提升 enrichmentMaxLength 到 5000 | `dimension-mission.service.ts` | 低   | 单篇信息量提升   |

### Phase 1: 证据层增强 + 上下文共享（3-5 天）

| 改动                              | 文件                                 | 风险 |
| --------------------------------- | ------------------------------------ | ---- |
| 全局证据池（URL 去重 + 共享抓取） | `topic-team-orchestrator.service.ts` | 中   |
| 全局大纲阶段                      | `topic-team-orchestrator.service.ts` | 中   |
| 共享事实注册表                    | `topic-team-orchestrator.service.ts` | 低   |
| 二轮迭代搜索（thorough 模式）     | `dimension-search.service.ts`        | 低   |
| 证据去重优化                      | `evidence-management.service.ts`     | 低   |

### Phase 2: 审阅重构 + 质量门控（3-5 天）

| 改动                              | 文件                                                         | 风险       |
| --------------------------------- | ------------------------------------------------------------ | ---------- |
| 新增 ReportQualityGateService     | `services/quality/report-quality-gate.service.ts`            | 低（新增） |
| 语言一致性检测                    | `utils/report-formatting.utils.ts`                           | 低         |
| 质量门控替代 LLM 审阅循环         | `dimension-mission.service.ts`                               | 中         |
| 简化一致性检查（用共享事实替代）  | `report-synthesis.service.ts`                                | 中         |
| Prompt 强化（图表禁令、语言要求） | `dimension-research.prompt.ts`, `report-synthesis.prompt.ts` | 低         |

### Phase 3: 图表重建 + 导出修复（2-3 天）

| 改动                                  | 文件                             | 风险 |
| ------------------------------------- | -------------------------------- | ---- |
| 增强 figure-extractor（更多图片提取） | `figure-extractor.service.ts`    | 低   |
| 图表 Prompt 禁令                      | `dimension-research.prompt.ts`   | 低   |
| 图表质量门控                          | `report-quality-gate.service.ts` | 低   |
| 导出清理（无 Recharts 后简化）        | `html-capture.service.ts`        | 低   |

---

## 5. 评审基线

### 5.1 测试报告生成条件

为确保方案效果可量化，使用**相同主题、相同配置**生成对照报告：

| 条件     | 值                                             |
| -------- | ---------------------------------------------- |
| 主题     | "基础大模型技术发展趋势"                       |
| 维度数   | 7                                              |
| 研究深度 | standard                                       |
| 语言     | zh（中文）                                     |
| 对照基线 | 最新导出 `export (5).htm`（2026-03-06 前生成） |

### 5.2 量化验收指标

#### A. 证据质量指标

| 指标              | 基线值  | Phase 0 目标 | Phase 1 目标 | 测量方式       |
| ----------------- | ------- | ------------ | ------------ | -------------- |
| 全文抓取篇数/维度 | 5       | 10           | 12           | 代码日志       |
| 单篇全文长度上限  | 3000 字 | 5000 字      | 6000 字      | 配置值         |
| 总有效证据/维度   | ~19K 字 | ~54K 字      | ~75K 字      | 代码日志       |
| 输入/输出比       | ~2:1    | ~5:1         | ~8:1         | 计算           |
| 跨维度 URL 重复率 | 未知    | —            | < 10%        | 全局证据池统计 |

#### B. 内容质量指标

| 指标                     | 基线值  | 目标值              | 测量方式              |
| ------------------------ | ------- | ------------------- | --------------------- |
| AI 编造图表数            | 11      | **0**               | 检查 generatedCharts  |
| 参考文献真实图片数       | 0       | >= 5                | 检查 figureReferences |
| 外语内容占比（中文报告） | ~15-20% | < 5%                | 语言检测函数          |
| 维度间数据矛盾数         | 未量化  | 0（由共享事实保证） | 人工审查              |
| "我们认为"类表述次数     | 118     | <= 10               | 正则统计              |

#### C. 格式质量指标（v3 + v4 共同目标）

| 指标             | 基线值 | 目标值 | 测量方式     |
| ---------------- | ------ | ------ | ------------ |
| h5/h6 标签数     | 182    | 0      | 正则统计     |
| 加粗处数         | 313    | <= 80  | 正则统计     |
| 引用块数         | 98     | <= 15  | 正则统计     |
| 分割线数         | 51     | 0      | 正则统计     |
| 编号错误数       | 39     | 0      | 正则 + 人工  |
| LaTeX 原始文本数 | 37     | 0      | 前端渲染检查 |

#### D. 效率指标

| 指标              | 基线值      | 目标值     | 测量方式   |
| ----------------- | ----------- | ---------- | ---------- |
| LLM 调用次数/报告 | 108-150     | 30-50      | 代码日志   |
| 预估成本/报告     | $2-5        | $1-2       | Token 统计 |
| 生成时间          | ~10-15 分钟 | ~8-12 分钟 | 计时       |

### 5.3 人工评审清单

除量化指标外，每次测试报告需人工评审以下维度（1-10 分）：

| 维度           | 评审要点                                           | 基线评分（估） |
| -------------- | -------------------------------------------------- | -------------- |
| **信息密度**   | 每段是否有实质性信息？是否有"水分"段落？           | 3/10           |
| **数据可追溯** | 提到的数据/趋势能否追溯到具体证据？                | 2/10           |
| **逻辑连贯**   | 各维度之间是否有逻辑递进？全文是否像一篇完整报告？ | 3/10           |
| **语言一致**   | 是否全文统一使用目标语言？专有名词处理是否规范？   | 4/10           |
| **图表价值**   | 图表是否展示真实数据？是否增加了信息而非装饰？     | 1/10           |
| **引用质量**   | 引用是否精确？是否均匀分布？是否有价值？           | 3/10           |
| **可读性**     | 格式是否专业？排版是否清晰？导出是否完整？         | 3/10           |

**目标**: 每项 >= 7/10。

---

## 6. 风险与缓解

| 风险                                 | 影响     | 缓解措施                                                   |
| ------------------------------------ | -------- | ---------------------------------------------------------- |
| 证据抓取量增加导致生成时间过长       | 用户体验 | 全局证据池减少重复抓取；并行抓取数从 4 提升到 6            |
| 禁用假图表后报告"视觉单调"           | 用户感知 | 提升参考图片提取率；考虑后续支持数据表格可视化（真实数据） |
| 取消 LLM 审阅后质量下降              | 内容质量 | 代码质量门控更可靠；保留 1 次 AI 修改机会                  |
| 全局大纲增加了流程复杂度             | 维护成本 | 大纲阶段是可选的，failure 不阻断主流程                     |
| enrichmentTopN 增加导致 API 成本上升 | 运营成本 | 全局去重减少实际抓取数；可按 researchDepth 梯度配置        |
| 语言检测误判（技术文档常含英文术语） | 误报     | 排除代码块、URL、已知专有名词列表；设 5% 容忍度            |

---

## 7. 与 v3 方案的关系

| 维度         | v3 方案                | v4 方案                   | 关系             |
| ------------ | ---------------------- | ------------------------- | ---------------- |
| 标题层级     | 修复 +2 提升 bug       | 质量门控强制检查          | v4 补充强制执行  |
| 加粗/引用块  | Prompt 改造（加上限）  | 质量门控自动修复          | v4 提供 fallback |
| 分割线       | 删除硬编码 `---`       | 质量门控检查              | 互补             |
| 结论去重     | 改 Prompt 约束         | 共享事实注册表            | v4 从根源解决    |
| 图表数据     | 前端 fallback          | 禁止假图表                | v4 更彻底        |
| 导出空白     | SVG 冻结增强           | 移除 Recharts（无假图表） | v4 消除问题源    |
| 编号混乱     | numberSubHeadings 修复 | 质量门控强制重编号        | 互补             |
| 证据不足     | 未涉及                 | 核心改造                  | v4 独有          |
| 维度矛盾     | 未涉及                 | 上下文共享                | v4 独有          |
| 语言混杂     | 未涉及                 | 多层控制                  | v4 独有          |
| LLM 调用过多 | 未涉及                 | 审阅重构                  | v4 独有          |

**实施顺序建议**: v3 Phase 1-2（Prompt + 后处理）可与 v4 Phase 0 并行推进。v4 Phase 1-3 在 v3 基础上叠加。

---

## 8. 决策待确认项

| #   | 决策项                       | 选项                                   | 推荐                 | 影响                     |
| --- | ---------------------------- | -------------------------------------- | -------------------- | ------------------------ |
| D1  | enrichmentTopN 目标值        | 8 / 10 / 12 / 15                       | 12                   | 抓取成本 vs 证据质量     |
| D2  | enrichmentMaxLength 目标值   | 4000 / 5000 / 6000 / 8000              | 6000                 | Token 成本 vs 信息完整度 |
| D3  | 是否完全禁用 generatedCharts | 完全禁用 / 保留但需数据来源标注        | 完全禁用             | 报告视觉丰富度           |
| D4  | LLM 审阅循环是否完全取消     | 完全取消 / 保留 1 轮（thorough 模式）  | 保留 1 轮仅 thorough | 成本 vs 深度模式质量     |
| D5  | 二轮搜索适用范围             | 仅 thorough / standard+thorough / 全部 | standard + thorough  | 时间 vs 覆盖度           |
| D6  | 全局大纲是否为必选           | 必选 / 仅 standard+ / 可配置           | 仅 standard+         | 复杂度                   |
| D7  | 语言外语容忍度阈值           | 3% / 5% / 10%                          | 5%                   | 误报率                   |

---

## 附录 A: 关键文件清单

### 需要修改的文件

| 文件                                               | 改动类型                | Phase |
| -------------------------------------------------- | ----------------------- | ----- |
| `services/dimension/dimension-mission.service.ts`  | 参数调整 + 接受共享证据 | 0, 1  |
| `services/data/data-enrichment.service.ts`         | 支持外部证据池          | 1     |
| `services/core/topic-team-orchestrator.service.ts` | 全局证据池 + 大纲阶段   | 1     |
| `services/dimension/dimension-search.service.ts`   | 二轮搜索                | 1     |
| `services/core/leader-review.service.ts`           | 简化审阅逻辑            | 2     |
| `services/report/report-synthesis.service.ts`      | 禁用假图表 + 质量门控   | 0, 2  |
| `services/dimension/section-writer.service.ts`     | 图表禁令                | 2     |
| `services/report/figure-extractor.service.ts`      | 增强图片提取            | 3     |
| `prompts/dimension-research.prompt.ts`             | 图表禁令 + 语言强化     | 2     |
| `prompts/report-synthesis.prompt.ts`               | 语言强化                | 2     |
| `utils/report-formatting.utils.ts`                 | 语言检测 + 编号修复     | 0, 2  |
| `frontend/.../TopicContentPanel.tsx`               | 加 KaTeX                | 0     |

### 需要新增的文件

| 文件                                              | 用途         | Phase |
| ------------------------------------------------- | ------------ | ----- |
| `services/quality/report-quality-gate.service.ts` | 质量门控管道 | 2     |

### 测试文件影响

现有 98 个测试文件中，预计需要更新：

- `dimension-mission` 相关测试（参数变更）
- `report-synthesis` 相关测试（图表逻辑变更）
- `leader-review` 相关测试（审阅简化）
- 新增: `report-quality-gate` 测试

---

## 附录 B: LLM 调用对比

### 当前（standard depth, 7 维度）

```
Leader 规划:                     2 次
每维度:
  搜索阶段 LLM:                 3 次 x 7 = 21
  写作阶段 LLM:                 5 次 x 7 = 35
  审阅循环 LLM:                 4 次 x 7 = 28（平均 2 轮）
一致性检查:                      1 次
报告合成:                        2 次
V5 认知循环:                     3 次
质量审查:                        1 次
图表生成:                        ~10 次
────────────────────────────────────
总计:                            ~103 次
```

### 改造后（standard depth, 7 维度）

```
Leader 规划:                     2 次
全局大纲:                        1 次（新增）
每维度:
  搜索阶段 LLM:                 3 次 x 7 = 21
  写作阶段 LLM:                 3 次 x 7 = 21（减少分节，合并写作）
  质量门控后修改:                0.5 次 x 7 = 3.5（50% 维度需 1 次修改）
报告合成:                        2 次
────────────────────────────────────
总计:                            ~50 次（减少 ~50%）
```

**节省**: ~53 次 LLM 调用/报告，成本降低 ~50%。
