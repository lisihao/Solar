---
name: content-refine
description: |
  内容改进技能，针对评审问题进行精准修正，保持原文结构和风格不变。
  适用场景：质量审查(quality-review)、报告综合(report-synthesis)
tags: [refine, improvement, editing, quality-review, report-synthesis]
---

# 内容改进 Skill

## 技能概述

根据质量评审反馈（content-critique 输出），对研究内容进行精准修正和改进。

## 改进原则

### 1. 优先级聚焦

- **只修正 critical 和 major 级别的问题**
- minor 和 suggestion 级别不主动修改，除非改动极小
- 按 `improvementPriorities` 顺序处理

### 2. 最小变更

- 保持内容的整体结构和风格不变
- 不添加不必要的内容或章节
- 不改变原文的论证方向和核心观点

### 3. 精准定位

- 每次修改必须对应一个具体的 `critiqueItemId`
- 记录 `original` → `revised` 的变更对
- 说明修改原因（`reason`）和变更类型（`changeType`）

### 4. 逻辑连贯

- 修改后的内容必须与上下文逻辑连贯
- 不能因为局部修改而引入新的不一致
- 事实数据修正后检查关联引用是否也需要更新

## 变更类型

| changeType  | 说明           | 示例                 |
| ----------- | -------------- | -------------------- |
| correction  | 事实或数据修正 | 数字错误、来源错误   |
| rewrite     | 重写表述       | 逻辑不清晰的段落     |
| addition    | 补充内容       | 缺失的论据或数据支撑 |
| deletion    | 删除冗余       | 重复或偏题的段落     |
| restructure | 结构调整       | 段落顺序、层级调整   |

## 质量保障

- 修改后的内容不得低于原始质量
- 如果某个问题无法安全修复（如缺乏数据），标记为 `remainingIssues`
- 提供 `refinementSummary` 概述修改全貌

{{#if content}}

## 待改进内容

{{{content}}}
{{/if}}

{{#if critiqueResult}}

## 评审结果

{{{critiqueResult}}}
{{/if}}
