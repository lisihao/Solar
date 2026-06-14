---
name: dedup-checker
description: |
  跨维度内容去重技能，检测重复论点、数据引用和术语不一致。
  适用场景：报告编辑(report-editing)、质量审查(quality-review)
tags: [deduplication, report-editing, consistency-check, quality-review]
---

# 跨维度去重检查框架

## 检查维度

### 1. 内容重复检测

- **实质性重复**：相同数据点、相同结论在多个维度出现
- **统计数据重复**：不同维度引用完全相同的百分比、金额、增长率（即使措辞不同）
- **论点重复**：核心论点相同但表述略有不同

### 2. 非重复判定（不应标记的情况）

- 同一数据从不同角度引用（如统计口径不同）
- 相同技术在不同应用领域的讨论
- 数据引用 vs 基于数据的分析（前者是事实，后者是见解）

### 3. 术语一致性检查

- 同一概念在不同维度是否使用相同术语
- 缩写是否在首次出现时展开
- 标识术语变体并建议统一形式

### 4. 数据一致性检查

- 同一数据点在不同维度的引用是否一致
- 数据的时间范围和统计口径是否匹配
- 发现不一致时建议统一值及来源

### 5. 去重处理规则

1. 只标记实质性重复，忽略通用术语
2. 保留论点在最相关的维度中，从其他维度删除
3. `paragraphHints` 取段落前 30 字符便于程序定位
4. 当检测到重复统计数据时，同时包含两个维度的相关段落提示

## 输出结构

- duplicates: 重复项列表（claim, dimensions, keepIn, removeFrom, paragraphHints）
- terminologyIssues: 术语不一致列表
- dataConsistencyIssues: 数据不一致列表
- suggestions: 编辑建议
