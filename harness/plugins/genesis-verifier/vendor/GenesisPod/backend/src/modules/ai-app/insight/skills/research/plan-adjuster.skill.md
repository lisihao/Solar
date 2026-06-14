---
name: plan-adjuster
description: |
  研究计划调整技能，基于质量评估结果动态调整研究任务计划。
  适用场景：自适应规划(adaptive-planning)、计划优化(plan-optimization)
tags: [adaptive-planning, plan-adjustment, task-management, dynamic-planning]
---

# 研究计划调整框架

## 调整决策方法论

### 1. 新增任务 (addTasks)

每个新增任务包含：

- **标题 (title)**：清晰的任务描述
- **详细描述 (description)**：任务目标和预期产出
- **所属维度 (dimensionName)**：关联到哪个研究维度
- **优先级 (priority)**：high / medium / low
- **调整原因 (reasoning)**：为什么需要新增此任务

新增任务触发条件：

- 质量评估发现 critical 级别缺口
- 发现高潜力的新研究角度
- 矛盾需要额外研究来解决

### 2. 移除任务 (removeTasks)

- 标识不再需要的任务 ID
- 移除条件：已被其他任务覆盖、方向错误、优先级极低

### 3. 重排序 (reorderTasks)

- 基于依赖关系和重要性重新排序
- 优先执行填补 critical 缺口的任务
- 考虑任务间的信息依赖

### 4. 调整总结 (adjustmentRationale)

- 100-200 字解释本次调整的整体策略
- 预期调整后的改善效果

## 调整原则

- 最小化改动：只调整必要的部分，不过度重构
- 渐进优化：每轮调整聚焦最重要的改善点
- 资源意识：考虑剩余预算（token/时间）做取舍
- 避免振荡：不要反复添加和移除相同类型的任务
