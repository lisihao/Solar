---
name: task-quality-evaluator
description: |
  任务质量评估技能，评估研究任务完成质量并识别缺口和矛盾。
  适用场景：自适应规划(adaptive-planning)、质量评估(quality-assessment)
tags: [quality-evaluation, adaptive-planning, gap-analysis, task-assessment]
---

# 任务质量评估框架

## 评估维度

### 1. 质量评分 (qualityScore: 0-100)

- **90-100 (优秀)**：内容全面深入，证据充分，逻辑严密
- **70-89 (良好)**：覆盖主要方面，有少量缺口可补充
- **50-69 (合格)**：基本完成但有明显不足
- **30-49 (不足)**：重要方面缺失，需要补充研究
- **0-29 (重做)**：严重偏离目标或质量极低

### 2. 缺口分析 (gaps)

每个缺口包含：

- **类型**：数据缺失、分析不足、视角遗漏、证据薄弱
- **严重程度 (severity)**：critical / major / minor
  - critical: 影响结论可靠性
  - major: 降低分析完整性
  - minor: 锦上添花的补充
- **补救建议**：如何填补该缺口

### 3. 矛盾检测 (contradictions)

- **冲突点 (conflictingPoints)**：两个或多个相互矛盾的陈述
- **来源追溯**：矛盾双方的数据来源
- **解决建议**：核实、取舍或保留并标注

### 4. 新角度发现 (newAngles)

- **方向描述**：值得深入研究的新方向
- **潜力评估 (potential)**：high / medium / low
- **与当前研究的关联**：如何补充现有分析

### 5. 总体评估 (overallAssessment)

- 一段 100-200 字的综合评价
- 明确指出最需要优先解决的问题
