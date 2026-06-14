---
name: fact-verification
description: |
  事实核验技能，基于FActScore方法对断言进行证据比对验证，输出4种判定结论和对齐度评分。
  适用场景：事实核查(fact-checking)、质量审查(quality-review)
tags: [verification, factscore, evidence, fact-checking, quality-review]
---

# 事实核验 Skill

## 技能概述

基于 FActScore (Min et al., 2023) 方法论，将提取的断言与证据源逐一比对验证，评估事实准确性。

## 判定标准（4 种）

### 1. supports（支持）

证据直接支持该断言，数据吻合或逻辑一致。

- 条件：证据中有明确信息与断言内容一致
- 置信度：通常 0.7-1.0

### 2. refutes（反驳）

证据与断言矛盾，数据冲突或结论相反。

- 条件：证据中有明确信息与断言内容矛盾
- 置信度：通常 0.7-1.0

### 3. neutral（中立）

证据与断言相关但不足以判断支持或反驳。

- 条件：证据涉及相关领域但不直接回应断言
- 置信度：通常 0.3-0.6

### 4. insufficient（证据不足）

现有证据不足以做出任何判断。

- 条件：证据与断言不相关或覆盖不到
- 置信度：通常 0.1-0.3

## 核验评分

### factualAlignment 评分

评估证据与断言的事实对齐程度，取值 0.0-1.0：

- **1.0**: 完全支持，证据精确匹配
- **0.7-0.9**: 基本支持，有轻微偏差
- **0.4-0.6**: 部分相关，无法完全确认
- **0.1-0.3**: 弱相关或轻微矛盾
- **0.0**: 完全矛盾

### FActScore 综合计算

```
FActScore = supportCount / totalUsefulVerdicts
agreementRate = max(supportCount, refuteCount) / totalUsefulVerdicts
```

其中 `totalUsefulVerdicts = supports + refutes`（排除 neutral 和 insufficient）

### 综合判定逻辑

| 条件                                      | 判定               |
| ----------------------------------------- | ------------------ |
| refuteCount >= 2 且 refuteCount > support | contradicted       |
| supportCount >= 2 且 factScore >= 0.7     | verified           |
| supportCount >= 1                         | partially_verified |
| 其他                                      | unverified         |

### 可信度评分

```
credibility = verificationRate * 60 + averageFactScore * 40
```

## 核验原则

1. **证据优先** - 所有判定必须基于提供的证据，不引入外部知识
2. **精确引用** - `relevantQuote` 必须是证据原文中的直接引用
3. **逻辑推理** - `reasoning` 解释从证据到判定的推理过程
4. **保守判断** - 证据不足时选择 `insufficient` 而非强行判定

{{#if claim}}

## 待核验断言

{{{claim}}}
{{/if}}

{{#if evidence}}

## 参考证据

{{{evidence}}}
{{/if}}
