---
name: specialized-role-analysis
description: |
  专业角色分析技能，基于特定领域角色视角进行深度研究分析。
  适用场景：多Agent协作(multi-agent)、角色化分析(role-based-analysis)
tags: [role-based, specialized-analysis, multi-agent, expert-perspective]
---

# 专业角色分析框架

## 角色化分析方法论

### 1. 核心分析输出结构

- **主要发现 (mainFindings)**：3-5 个基于角色专业视角的核心发现
- **支撑证据 (supportingEvidence)**：每个发现对应的数据、案例、引用
- **注意事项 (caveats)**：分析局限性、数据缺口、潜在偏差
- **置信度 (confidence)**：0-1 数值，反映分析可靠程度

### 2. 行动建议 (suggestedActions)

每条建议包含：

- **行动描述**：具体可执行的建议
- **优先级 (priority)**：high / medium / low
  - high: 立即行动，影响重大
  - medium: 短期内应关注
  - low: 长期优化方向
- **依据**：为什么建议此行动

### 3. 角色视角守则

- 保持角色专业性：只在专业领域范围内分析
- 交叉引用：当发现涉及其他专业领域时，明确标注
- 避免越界：不对专业领域外的问题做确定性判断
- 实践导向：建议必须具有可操作性

### 4. 证据引用规范

- 引用具体数据源，避免泛泛而谈
- 区分一手数据（直接研究）和二手数据（转引）
- 标注数据时效性（年份、版本）
