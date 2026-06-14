---
name: multi-path-reasoning
description: |
  多路径推理技能，基于Self-Consistency方法生成多条独立推理路径并聚合共识结论。
  适用场景：事实核查(fact-checking)、质量审查(quality-review)
tags:
  [
    reasoning,
    self-consistency,
    multi-path,
    consensus,
    fact-checking,
    quality-review,
  ]
---

# 多路径推理 Skill

## 技能概述

基于 Self-Consistency (Wang et al., 2022) 方法，生成多条独立推理路径，通过多数投票聚合最终结论，提高推理可靠性。

## 推理框架

### 独立推理路径生成

每条推理路径需独立分析所有证据，包含：

1. **推理过程** (reasoning): 200-500 字，展示完整的思考链
2. **结论** (conclusion): 50-100 字，明确的判断
3. **置信度** (confidence): 0.0-1.0 的数值评估
4. **关键步骤** (keySteps): 推理中的关键逻辑步骤
5. **使用的证据** (evidenceUsed): 引用的证据编号

### 多样性策略

通过不同的分析创造性生成多样化的推理路径：

| 创造性级别    | 特点                     |
| ------------- | ------------------------ |
| deterministic | 严格基于证据的保守推理   |
| low           | 偏保守，关注直接证据     |
| medium        | 平衡推理，适度推断       |
| high          | 探索性推理，关注隐含信息 |

路径间温度均匀分布，确保多样性。

## 一致性分析方法

### 聚类分析

将多条推理路径按结论相似性分组：

- 每个聚类有主题 (theme)、成员路径 (pathIndices)、是否多数 (isMajority)
- 多数聚类的代表性结论作为候选最终结论

### 一致性指标

- **agreementRate**: 最大聚类占比，反映共识程度
- **majorityConclusion**: 多数路径支持的结论
- **synthesizedConclusion**: 综合所有路径的最终结论

### 人工审核触发

当以下条件成立时标记 `needsHumanReview: true`：

- 一致性低于阈值（agreementRate < threshold）
- 存在强烈的异见路径
- 多个聚类势均力敌

### 降级策略

当一致性分析 LLM 调用失败时，使用简单多数投票：

- 选择最高置信度路径作为代表
- 设置保守的 `agreementRate = 0.6`
- 标记 `needsHumanReview: true`

## 应用原则

1. **独立性** - 每条路径必须独立推理，不受其他路径影响
2. **多样性** - 通过不同创造性级别确保推理多样性
3. **透明性** - 记录完整推理过程和证据引用
4. **保守性** - 存疑时倾向于标记需人工审核

{{#if question}}

## 推理问题

{{{question}}}
{{/if}}

{{#if evidences}}

## 参考证据

{{{evidences}}}
{{/if}}
