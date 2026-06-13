# 报告模板规范 (Report Template Standard)

**版本：** 1.0
**更新日期：** 2026-03-07
**规范级别：** MUST
**适用范围：** 所有 AI App 模块生成的报告（Topic Insights、Research、Writing 等）

---

## 概述

本规范定义报告中 **13 种内容类型** 的精确格式规则，作为系统级统一标准。
所有报告生成必须在 3 个层面执行本规范：

| 层           | 机制                        | 说明                 |
| ------------ | --------------------------- | -------------------- |
| L1: Prompt   | 写作标准常量注入 LLM prompt | 告诉 AI "应该怎么写" |
| L2: 后处理   | 格式化函数自动修复          | 兜底 AI 未遵守的格式 |
| L3: 前端渲染 | markdown 组件 + 专用组件    | 统一视觉呈现         |

**详细规范文档：** `.claude/skills/ai/report-template/references/report-template-spec.md`

---

## 全局规则

| 规则     | 说明                                                |
| -------- | --------------------------------------------------- |
| 文风     | 第三人称为主，第一人称为辅（每子节最多 1 次）       |
| 术语     | 首次出现标注英文原文，后续统一中文                  |
| 简体中文 | 全文简体，禁止繁体字                                |
| 公式     | KaTeX：行内 `$...$`，独立 `$$...$$`，禁止拆分       |
| 分割线   | 正文禁止 `---`（仅参考文献前允许一条）              |
| 禁止泄露 | 字数统计、Agent/Leader 角色名、内部标注             |
| 文本对齐 | 编号/列表续行必须与编号后正文对齐，不与编号本身对齐 |

---

## 13 种内容类型速查

### 类型 1: 报告标题

- 自动从 `topic.name` 生成 `# 标题` + `> 生成时间：YYYY-MM-DD`

### 类型 2: 执行摘要

- McKinsey SCR 框架，6 区块各有 `###` 子标题
- 核心论断(加粗段落) → 背景 → `### 核心发现`(编号) → `### 关键指标`(表格) → `### 风险预警`(编号) → `### 行动建议`(编号+角色加粗)
- 400-600 字，引用块禁止
- Prompt: `EXECUTIVE_SUMMARY_FORMAT` | 后处理: `enforceExecSummarySections`

### 类型 3: 目录

- 编号 + `[标题](#anchor)` 可点击链接，自动生成

### 类型 4: 章节要点 (Chapter Highlights)

- `> **本章要点**` + `> - ` 每行，3-5 条，每条 ≤30 字
- 前端渲染为样式化卡片：蓝色左竖线 + 浅蓝背景 + 圆角
- Prompt: `CHAPTER_HIGHLIGHTS` | 后处理: `bulletifyBlockquoteItems`

### 类型 5: 维度正文

- **标题**: `###`(子节) 和 `####`(子子节)，自动编号 `N.M.`，每维度最多 6-8 个
- **段落**: ≤400 字，冒号前总结语自动加粗，引用密度每千字 10-15 处
- **加粗**: 每子节最多 2 处，仅核心判断句，单处 ≤30 字
- **枚举**: `一是...二是...` 等模式自动拆分为无序列表
- Prompt: `HEADING_HIERARCHY` + `PROFESSIONAL_TONE` + `FORMATTING_LIMITS` + `CITATION_STANDARDS`
- 后处理: `sanitizeHeadingLevels` + `splitWallOfText` + `boldSummaryPrefixes` + `splitEnumerationToList` 等

### 类型 6: 列表

- 有序：一级 `1. 2. 3.`，二级 `a. b. c.`
- 无序：一级 `●`(disc)，二级 `○`(circle)
- 最多 2 层嵌套，每项 ≤100 字
- 后处理: `repairOrderedListContinuity` + `truncateLongListItems`

### 类型 7: 正文引用块

- 全文最多 8 个，每维度最多 1 个
- `> **判断句内容。**`（整句加粗），≤80 字
- 与章节要点内容不重复
- 前端渲染为默认灰色 blockquote（与类型 4 蓝色卡片区分）

### 类型 8: 图表

- 正文用 `<!-- chart:dN-id -->` 占位符嵌入
- 允许自然语言引用如"如图 2 所示"
- FigureRenderer 卡片：编号(蓝色) + 标题 + 图表 + 说明 + 来源 badge
- 每维度最多 2 个，全文最多 12-14 个
- Prompt: `CHART_STANDARDS` | 后处理: `resolveChartPlaceholders` + `stripInternalFigureNotation`

### 类型 9: 表格

- 标准 GFM markdown 表格，分隔行必须存在
- 脚注行自动提取为独立段落
- 后处理: `repairMarkdownTables` + `extractTableFootnotes`

### 类型 10: 补充章节

- 跨维度关联分析 / 风险评估 / 战略建议
- 必须有 `###` 子标题组织，引用块禁止
- Prompt: `SYNTHESIS_FORMATTING`

### 类型 11: 结语

- 核心结论和关键建议用 `**...**` 加粗，2-4 处
- 前端渲染为**紫色加粗**（`text-purple-700`），与正文黑色加粗区分

### 类型 12: 参考文献

- `[N] [标题](URL). 访问日期: YYYY-MM-DD`
- 标题显示为蓝色超链接，URL 不可见
- 正文 `[N]` → `<a href="#ref-N">[N]</a>` 可点击跳转
- 后处理: `filterJunkReferences` + `deduplicateReferencesByUrl` + `linkifyCitations`

### 类型 13: 数学公式

- 行内 `$...$`，独立 `$$...$$`
- 禁止拆分写法如 `$A$ $\in$ $B$`
- 后处理: `mergeAdjacentMathBlocks`

---

## 执行层覆盖矩阵

| 类型         | L1 Prompt                                                                              | L2 后处理                                                  | L3 前端渲染              |
| ------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------ |
| 1. 标题      | -                                                                                      | -                                                          | `<h1>`                   |
| 2. 执行摘要  | `EXECUTIVE_SUMMARY_FORMAT`                                                             | `enforceExecSummarySections`                               | 标准 markdown            |
| 3. 目录      | -                                                                                      | -                                                          | 链接列表                 |
| 4. 章节要点  | `CHAPTER_HIGHLIGHTS`                                                                   | `bulletifyBlockquoteItems`                                 | 样式化卡片               |
| 5. 维度正文  | `HEADING_HIERARCHY` + `PROFESSIONAL_TONE` + `FORMATTING_LIMITS` + `CITATION_STANDARDS` | 40+ 函数                                                   | 标准 markdown + 引用链接 |
| 6. 列表      | `FORMATTING_LIMITS`                                                                    | `repairOrderedListContinuity`                              | 分层 list-style          |
| 7. 引用块    | `FORMATTING_LIMITS`                                                                    | -                                                          | 标准 blockquote          |
| 8. 图表      | `CHART_STANDARDS`                                                                      | `resolveChartPlaceholders` + `stripInternalFigureNotation` | `<FigureRenderer>`       |
| 9. 表格      | -                                                                                      | `repairMarkdownTables`                                     | `<table>`                |
| 10. 补充章节 | `SYNTHESIS_FORMATTING`                                                                 | 共享 `postProcessFinalReport`                              | 标准 markdown            |
| 11. 结语     | -                                                                                      | 去重逻辑                                                   | 紫色加粗                 |
| 12. 参考文献 | `CITATION_STANDARDS`                                                                   | 5 个清理函数                                               | 超链接 + 锚点            |
| 13. 数学公式 | `PROFESSIONAL_TONE`                                                                    | `mergeAdjacentMathBlocks`                                  | KaTeX                    |

---

## 报告管线执行阶段

本规范在报告生成的每个阶段都必须遵从：

| 阶段         | 执行者                                | 规范执行方式                                           |
| ------------ | ------------------------------------- | ------------------------------------------------------ |
| 数据采集初稿 | Agent（每个维度的研究员）             | L1 Prompt：写作标准常量注入每个 Agent 的 system prompt |
| Leader 审核  | Leader Agent（审稿人）                | L1 Prompt：审核标准包含本规范检查项，退回不合格稿件    |
| 维度后处理   | `processDimensionContent()`           | L2：单维度后处理管线                                   |
| 全文整合     | `assembleFullReport()`                | L2：`postProcessFinalReport()` 全文管线                |
| 前端渲染     | `createMarkdownComponents` + 专用组件 | L3：统一视觉呈现                                       |

---

## 新报告类型接入清单

任何新的 AI App 模块接入报告生成时，必须：

1. **复用 Prompt 常量**: 从 `ai-engine/report-template` 导入写作标准，注入 Agent/Leader prompt
2. **复用后处理管线**: 调用 `ReportTemplatePipeline.process(content)` 进行格式修复
3. **复用前端组件**: 使用 `createMarkdownComponents` 渲染，图表用 `<FigureRenderer>`
4. **不得自定义格式**: 禁止在业务模块中定义与本规范冲突的格式规则

---

**关联文档：**

- 详细规范: `.claude/skills/ai/report-template/references/report-template-spec.md`
- Skill 实现: `.claude/skills/ai/report-template/SKILL.md`
- 共享模块: `backend/src/modules/ai-app/shared/report-template/`
- Import: `import { ... } from "@/modules/ai-app/shared/report-template";`
