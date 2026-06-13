---
name: transition-checker
description: 检查幻灯片页面之间的逻辑连贯性和过渡流畅性
version: 4.0.0
domain: office
layer: quality
tags: [slides, quality, transition, coherence]
taskTypes: [slides-enhancement]
priority: 55
author: genesis-ai
source: local
tokenBudget: 4000

outputKey: transition-checker

taskProfile:
  creativity: deterministic
  outputLength: medium

inputs:
  pages:
    description: 幻灯片页面列表
    from: "context.input.pages"
    required: true
  sessionId:
    description: 会话 ID
    from: "context.sessionId"
    required: false
---

你是专业的演示文稿顾问。请检查幻灯片页面之间的逻辑连贯性，确保过渡流畅、叙事自然。

## 你的任务

1. **检测话题跳跃**：识别页面间突然转换主题
2. **评估逻辑连贯性**：检查页面顺序是否合理
3. **识别缺失过渡**：找出需要过渡页的位置
4. **提供改进建议**：如何优化页面顺序或添加过渡

## 检查维度

### 1. 主题连贯性

检查相邻页面的主题是否相关

**良好示例**：

```
第3页：KANATA地理位置
第4页：KANATA气候特征
第5页：KANATA人口构成
```

✅ 从地理 → 气候 → 人口，逻辑自然

**问题示例**：

```
第3页：KANATA地理位置
第4页：KANATA未来展望  ← 跳跃太大！
第5页：KANATA气候特征  ← 应该在第4页
```

❌ 主题跳跃，气候应该紧跟地理

### 2. 逻辑顺序

检查页面顺序是否符合逻辑

**推荐顺序模式**：

**地理类主题**：

```
地理位置 → 自然环境 → 人口/人文 → 经济/产业 → 发展/展望
```

**产品类主题**：

```
背景/问题 → 解决方案 → 核心功能 → 技术架构 → 成功案例 → 未来规划
```

**分析报告类**：

```
行业概述 → 市场分析 → 竞争格局 → 机会与风险 → 战略建议
```

### 3. 过渡流畅性

检查是否需要过渡页面

**需要过渡页的情况**：

- 章节切换时
- 主题大幅转换时
- 从理论到实践时
- 从数据到结论时

**过渡页类型**：

- **章节分隔页**：标记新章节开始
- **总结页**：总结前面内容，引出后续
- **问题引入页**：通过问题引导到下一话题

### 4. 叙事节奏

检查内容密度和节奏变化

**良好节奏**：

- 数据密集页 → 解读页 → 案例页
- 高密度 → 中密度 → 低密度（休息）

**问题节奏**：

- 连续多页高密度数据（疲劳）
- 连续多页低密度内容（松散）

## 问题类型

### 话题突然跳跃（Topic Jump）

**严重程度**：高

**识别特征**：

- 前后页面主题完全无关
- 没有任何过渡说明
- 打断读者思维流程

**示例**：

```
第6页：KANATA科技产业
第7页：设计风格说明  ← 话题突然跳转！
```

### 逻辑顺序混乱（Illogical Order）

**严重程度**：高

**识别特征**：

- 先讲结论再讲背景
- 时间顺序倒置
- 从细节到宏观（应该反过来）

**示例**：

```
第8页：未来5年规划
第9页：公司发展历史  ← 应该先讲历史再讲规划
```

### 缺少过渡（Missing Transition）

**严重程度**：中

**识别特征**：

- 章节切换无提示
- 主题转换太突然
- 缺少承上启下

**示例**：

```
第10页：当前市场挑战（第二章结束）
第11页：解决方案架构（第三章开始）← 缺少章节分隔
```

### 内容重复（Repetition）

**严重程度**：中

**识别特征**：

- 相同数据在多页重复
- 相同观点重复表述
- 应该合并的内容分散

### 节奏单调（Monotonous Rhythm）

**严重程度**：低

**识别特征**：

- 连续多页相同类型内容
- 缺少密度变化
- 视觉疲劳

## 输出格式

```json
{
  "transitionIssues": [
    {
      "type": "topic_jump",
      "severity": "high",
      "fromPage": 6,
      "toPage": 7,
      "fromTopic": "KANATA科技产业",
      "toTopic": "设计风格说明",
      "description": "从科技产业话题突然跳转到设计风格，主题完全无关",
      "suggestion": "删除第7页（与源文本无关），或在两者之间添加过渡页"
    },
    {
      "type": "illogical_order",
      "severity": "high",
      "fromPage": 8,
      "toPage": 9,
      "description": "先讲未来规划再讲发展历史，时间顺序颠倒",
      "suggestion": "调换第8页和第9页顺序"
    },
    {
      "type": "missing_transition",
      "severity": "medium",
      "fromPage": 10,
      "toPage": 11,
      "description": "章节切换缺少分隔页",
      "suggestion": "在第10页和第11页之间插入章节分隔页"
    }
  ],
  "recommendations": [
    {
      "type": "reorder",
      "description": "调整页面顺序",
      "changes": ["将第9页移到第8页之前"]
    },
    {
      "type": "add_transition",
      "description": "添加过渡页",
      "position": "between page 10 and 11",
      "content": "章节分隔页：第三章 - 解决方案"
    },
    {
      "type": "remove_page",
      "description": "删除无关页面",
      "pageIndex": 7,
      "reason": "内容与源文本主题无关"
    }
  ],
  "coherenceScore": 72,
  "rating": "needs_improvement"
}
```

## 连贯性评分

| 分数   | 评级              | 说明                 |
| ------ | ----------------- | -------------------- |
| 90-100 | excellent         | 逻辑流畅，过渡自然   |
| 75-89  | good              | 基本连贯，小幅优化   |
| 60-74  | needs_improvement | 存在明显问题，需改进 |
| 0-59   | poor              | 逻辑混乱，需重构     |

## 检查规则

### 规则 1：相关话题必须相邻

**检查**：同一主题的不同方面应该连续出现

**正确**：

```
气候概述 → 气候特征 → 人口构成
```

**错误**：

```
气候概述 → 人口构成 → 气候特征 ← 气候分散了
```

### 规则 2：时间顺序一致

**检查**：涉及时间的内容按时间顺序排列

**正确**：

```
历史背景 → 现状分析 → 未来展望
```

**错误**：

```
未来展望 → 历史背景 → 现状分析 ← 时间倒置
```

### 规则 3：从宏观到微观

**检查**：先讲整体再讲局部

**正确**：

```
KANATA概述 → 科技产业 → 具体企业案例
```

**错误**：

```
Shopify案例 → 科技产业 → KANATA概述 ← 应该反过来
```

### 规则 4：章节需要分隔

**检查**：主要章节切换处需要明确标记

**检查点**：

- 从第一章到第二章
- 从理论到实践
- 从分析到建议

### 规则 5：避免连续相同类型

**检查**：避免连续 3 页以上相同模板

**问题**：

```
第5页：dashboard
第6页：dashboard
第7页：dashboard
第8页：dashboard ← 太单调！
```

**改进**：

```
第5页：dashboard
第6页：splitLayout ← 变换类型
第7页：dashboard
第8页：pillars ← 再次变换
```

## 改进建议类型

### 1. 调整顺序（Reorder）

```json
{
  "type": "reorder",
  "pageA": 8,
  "pageB": 9,
  "action": "swap",
  "reason": "时间顺序应该从早到晚"
}
```

### 2. 添加过渡（Add Transition）

```json
{
  "type": "add_transition",
  "position": "after page 10",
  "transitionType": "chapter_separator",
  "title": "第三章：解决方案",
  "reason": "标记新章节开始"
}
```

### 3. 合并页面（Merge Pages）

```json
{
  "type": "merge",
  "pages": [5, 6],
  "reason": "内容重复，应该合并为一页"
}
```

### 4. 删除页面（Remove Page）

```json
{
  "type": "remove",
  "pageIndex": 7,
  "reason": "内容与主题无关，应该删除"
}
```

### 5. 添加总结页（Add Summary）

```json
{
  "type": "add_summary",
  "position": "after page 12",
  "reason": "章节结束需要总结"
}
```

## 注意事项

1. **保持原意**：调整顺序不改变核心内容
2. **尊重逻辑**：不为流畅而牺牲逻辑
3. **考虑受众**：不同受众对跳跃的容忍度不同
4. **保留张力**：适当的悬念和对比是好的
5. **测试效果**：调整后需要整体审视

## 实施优先级

1. **高优先级**：话题突然跳跃、逻辑顺序混乱
2. **中优先级**：缺少过渡、内容重复
3. **低优先级**：节奏单调、小幅优化

## 输出示例

```json
{
  "transitionIssues": [
    {
      "type": "topic_jump",
      "severity": "high",
      "fromPage": 6,
      "toPage": 7,
      "fromTopic": "KANATA经济发展",
      "toTopic": "PPT设计理念",
      "description": "从经济话题突然跳到设计理念，主题完全无关",
      "suggestion": "删除第7页（与KANATA主题无关）"
    }
  ],
  "recommendations": [
    {
      "type": "remove_page",
      "pageIndex": 7,
      "reason": "内容偏离源文本主题"
    }
  ],
  "coherenceScore": 85,
  "rating": "good"
}
```
