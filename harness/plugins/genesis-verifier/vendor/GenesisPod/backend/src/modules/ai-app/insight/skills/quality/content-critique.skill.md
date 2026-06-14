---
name: content-critique
description: |
  内容质量评审技能，基于Reflexion框架进行多维度批评，覆盖8类评审维度和4级严重度评估。
  适用场景：质量审查(quality-review)、报告综合(report-synthesis)
tags: [critique, quality, review, reflexion, quality-review, report-synthesis]
---

# 内容质量评审 Skill

## 技能概述

基于 Reflexion (Shinn et al., 2023) 框架，对研究内容进行系统性多维度质量批评，识别问题并提供改进建议。

## 评审维度体系（8 类）

### 1. 事实准确性 (Factual Accuracy)

- 数据和统计是否正确
- 引用来源是否可靠
- 时间和地点信息是否准确

### 2. 逻辑严密性 (Logical Rigor)

- 论证结构是否完整
- 因果关系是否成立
- 是否存在逻辑谬误

### 3. 覆盖完整性 (Coverage Completeness)

- 是否涵盖了关键子主题
- 是否遗漏了重要视角
- 是否有信息盲区

### 4. 表达清晰度 (Clarity)

- 语言是否清晰易懂
- 术语使用是否准确
- 结构是否便于阅读

### 5. 风格一致性 (Style Consistency)

- 语气和表达风格是否统一
- 格式是否规范
- 术语使用是否一致

### 6. 分析深度 (Analytical Depth)

- 是否有独立分析（因果推理、对比分析）
- 是否超越了表面信息
- 是否提供了独到见解

### 7. 相关性 (Relevance)

- 内容是否紧扣主题
- 是否有离题或冗余部分
- 细节程度是否恰当

### 8. 引用规范 (Citation Quality)

- 数据来源是否标注
- 引用是否充分支持论点
- 引用格式是否规范

## 严重度分级

| 级别       | 含义               | 处理策略           |
| ---------- | ------------------ | ------------------ |
| critical   | 必须修正的严重问题 | 立即修正，阻止发布 |
| major      | 应该修正的重要问题 | 优先修正           |
| minor      | 建议修正的小问题   | 可选修正           |
| suggestion | 可选的改进建议     | 记录备选，不强制   |

## 评审原则

1. **具体可操作** - 每个问题必须指出具体位置和修改建议
2. **严重度对齐** - 严格按照影响程度分级，不过度或不足
3. **建设性导向** - 提供 `exampleFix` 示范修改方式
4. **量化评分** - `overallScore` 和 `categoryScores` 使用 0-100 分制
5. **改进路径** - `improvementPriorities` 按影响力排序

## 收敛检测

迭代式评审-修正循环（Reflexion 模式）的终止条件：

- 达到目标分数
- 无 critical 级别问题
- 连续 3 次迭代分数波动 < 0.05（收敛）
- 无实质性改进

{{#if content}}

## 待评审内容

{{{content}}}
{{/if}}

{{#if researchContext}}

## 研究背景

{{{researchContext}}}
{{/if}}
