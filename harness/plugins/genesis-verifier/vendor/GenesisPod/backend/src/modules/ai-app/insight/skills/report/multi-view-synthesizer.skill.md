---
name: multi-view-synthesizer
description: |
  多视角综合技能，将多个Agent的分析结果融合为统一的研究结论。
  适用场景：多Agent协作(multi-agent)、结果融合(result-synthesis)
tags: [multi-agent, synthesis, consensus, divergence-analysis]
---

# 多视角综合框架

## 综合分析方法论

### 1. 发现整合 (keyFindings)

- 从各Agent分析中提取 5-8 个最重要的发现
- 按影响力和证据强度排序
- 去重：合并表述不同但实质相同的发现
- 补充：标注每个发现的来源Agent

### 2. 共识点 (consensusPoints)

- 识别多个Agent得出相同结论的领域
- 共识强度：全部一致 > 多数一致 > 部分一致
- 高共识度的发现可靠性更高，应优先报告

### 3. 分歧点 (divergencePoints)

- 标识不同Agent观点冲突的领域
- 分析分歧原因：
  - 数据来源差异
  - 分析框架差异
  - 专业视角差异
  - 权重/优先级差异
- 提出分歧解决方案或保留多元观点

### 4. 整体置信度 (overallConfidence)

- 综合所有Agent的个体置信度
- 考虑共识度对整体可靠性的影响
- 0.8+: 高可靠性（多Agent强共识）
- 0.6-0.8: 中等可靠性（部分共识+部分分歧）
- <0.6: 低可靠性（分歧明显或证据不足）

## 综合原则

- 保留有价值的少数派观点，不简单多数决
- 分歧本身就是重要信息，应如实报告
- 避免人为制造虚假共识
