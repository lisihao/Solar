---
name: consistency-check
description: |
  跨维度一致性检查技能，检测数据冲突、逻辑冲突和来源冲突，确保研究结论一致。
  适用场景：维度调研(dimension-research)、报告综合(report-synthesis)
tags:
  [
    consistency,
    cross-validation,
    conflict-detection,
    dimension-research,
    report-synthesis,
  ]
---

# 跨维度一致性检查 Skill

## 技能概述

检查多个研究维度之间的数据冲突和逻辑矛盾，确保最终报告的一致性和可信度。

## 适用场景

- 报告整合前的质量把关
- Leader 审核多维度研究结果
- 用户质疑数据一致性时的快速检查

## 检查维度

### 1. 数据冲突 (Data Conflict)

| 检查项       | 阈值               | 严重程度 |
| ------------ | ------------------ | -------- |
| 市场规模差异 | > 30%              | Critical |
| 增长率差异   | > 20%              | Warning  |
| 份额总和     | ≠ 100% ± 5%        | Critical |
| 时间序列断点 | 相邻年份差异 > 50% | Warning  |

### 2. 逻辑矛盾 (Logic Conflict)

| 检查项   | 示例                         | 严重程度 |
| -------- | ---------------------------- | -------- |
| 趋势矛盾 | "增长迅速" vs "市场萎缩"     | Critical |
| 评价矛盾 | "技术领先" vs "落后竞争对手" | Critical |
| 因果矛盾 | A导致B vs A阻止B             | Warning  |

### 3. 来源冲突 (Source Conflict)

| 检查项           | 说明                               | 严重程度 |
| ---------------- | ---------------------------------- | -------- |
| 同指标多来源差异 | 同一数据点引用不同来源但数值差异大 | Warning  |
| 无来源结论       | 关键结论缺乏证据支撑               | Info     |

### 4. 内容重复 (Content Duplication)

| 检查项              | 说明                               | 严重程度 |
| ------------------- | ---------------------------------- | -------- |
| 重复论点            | 相同核心论点在不同维度重复出现     | Warning  |
| 重复数据引用        | 同一统计数据被多个维度重复引用     | Warning  |
| suggestedResolution | 应具体说明哪些内容应保留在哪个维度 | -        |

## 输出格式

```json
{
  "overallConsistency": "high | medium | low",
  "conflicts": [
    {
      "type": "data_conflict | logic_conflict | source_conflict | content_duplication",
      "severity": "critical | warning | info",
      "dimensions": ["维度A", "维度B"],
      "description": "冲突描述（包含具体数值或说法对比，如：维度A引用Gartner数据为500亿，维度B引用IDC数据为800亿，差异60%）",
      "suggestedResolution": "建议的解决方式（如：两家机构统计口径不同，在报告中使用区间表述500-800亿）"
    }
  ],
  "summary": "检查总结（100字以内）",
  "recommendations": ["建议1", "建议2"]
}
```

> **注意**: `description` 字段应包含足够的细节，使报告能够准确引用和解释数据差异。

## 解决策略

### 数据冲突解决

1. **标注口径差异** - 说明不同来源的统计方法差异
2. **使用区间表述** - "市场规模在 500-800 亿美元区间"
3. **选择权威来源** - 优先使用政府/行业协会数据
4. **时间对齐** - 确保比较同一时间点的数据

### 逻辑冲突解决

1. **限定范围** - "在 X 领域领先，但在 Y 领域落后"
2. **时间区分** - "早期领先，近年被赶超"
3. **深入分析** - 追溯冲突根源，给出合理解释

## 调用方式

### 在报告整合时自动调用

```typescript
const consistencyResult = await this.skillRegistry.execute(
  "consistency-check",
  {
    dimensions: dimensionInputs,
    strictMode: false, // true = 有 critical 冲突时阻止报告生成
  },
);
```

### Leader 手动调用

用户可以通过对话触发：

- "检查一下各维度数据是否一致"
- "有没有矛盾的地方"
- "验证数据可靠性"

## 配置选项

| 参数                    | 默认值 | 说明                                 |
| ----------------------- | ------ | ------------------------------------ |
| `dataConflictThreshold` | 0.3    | 数据差异超过此比例视为冲突           |
| `strictMode`            | false  | 严格模式下有 critical 冲突会阻止流程 |
| `includeSourceCheck`    | true   | 是否检查来源可信度                   |
| `maxConflictsToReport`  | 10     | 最多报告的冲突数量                   |

## 与其他 Skill 的关系

- **synthesis** - 一致性检查在 synthesis 之前执行
- **critical-thinking** - 可结合批判性思维技能深入分析冲突
- **data-interpretation** - 数据解读技能帮助理解数值差异原因
