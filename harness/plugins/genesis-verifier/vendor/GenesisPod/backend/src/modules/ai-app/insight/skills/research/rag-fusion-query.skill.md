---
name: rag-fusion-query
description: |
  RAG-Fusion查询变体生成技能，使用7类查询变体分类法提高检索召回率。
  适用场景：维度调研(dimension-research)、数据检索(data-retrieval)
tags: [rag-fusion, query, retrieval, search, dimension-research, data-retrieval]
---

# RAG-Fusion 查询变体生成 Skill

## 技能概述

基于 RAG-Fusion (Raudaschl, 2023) 方法，为原始查询生成多种变体，提高信息检索的全面性和召回率。

## 7 类查询变体分类法

### 1. 同义改写 (Paraphrased)

用不同的词汇和句式表达相同的搜索意图。

- 目的：覆盖不同的关键词匹配
- 权重：0.7-1.0
- 示例："AI 芯片市场" → "人工智能处理器产业"

### 2. 子问题分解 (Decomposed)

将复杂查询拆解为更具体的子问题。

- 目的：深入覆盖各子主题
- 权重：0.8-1.0
- 示例："AI 产业发展" → "AI 基础模型技术进展", "AI 商业化落地案例"

### 3. 上下文扩展 (Expanded)

添加背景信息扩展查询范围。

- 目的：引入更广泛的相关信息
- 权重：0.6-0.9
- 示例："GPT-4 能力" → "GPT-4 多模态能力及与前代模型对比"

### 4. 对比查询 (Contrastive)

构建对比或反面视角的查询。

- 目的：获取平衡的正反信息
- 权重：0.6-0.7（适中，避免喧宾夺主）
- 示例："AI 的优势" → "AI 应用的局限性和风险"

### 5. 时间限定 (Temporal)

添加时间维度限定查询。

- 目的：获取特定时间段的信息
- 权重：0.7-0.9
- 示例："AI 监管" → "2024年全球AI监管政策最新进展"

### 6. 领域术语 (Domain-Specific)

使用专业术语替换通用表达。

- 目的：提高专业文献的命中率
- 权重：0.7-0.9
- 示例："大模型训练" → "LLM pre-training scaling laws"

### 7. 方面聚焦 (Aspect-Focused)

聚焦查询的特定方面。

- 目的：深入某一具体角度
- 权重：0.7-0.9
- 示例："AI 发展" → "AI 人才供给与高校培养体系"

## 生成原则

1. **意图多样** - 每个变体覆盖不同的检索意图
2. **权重合理** - 权重范围 0.5-1.0，反映变体与原始查询的相关度
3. **对比适中** - 对比查询权重控制在 0.6-0.7，避免引入过多反面信息
4. **全面覆盖** - 变体应尽量覆盖所有 7 种类型
5. **整体说明** - 提供 `overallRationale` 解释变体设计策略

## 结果融合（Reciprocal Rank Fusion）

变体查询结果通过 RRF 公式融合：

```
RRF(d) = Σ weight(q) / (k + rank(d, q))
```

- k 默认值 60
- 多次命中有覆盖加分（2x → 1.1x，3x → 1.2x）
- 对比查询结果标记 `isContrastiveResult = true`

{{#if originalQuery}}

## 原始查询

{{{originalQuery}}}
{{/if}}

{{#if researchContext}}

## 研究上下文

{{{researchContext}}}
{{/if}}
