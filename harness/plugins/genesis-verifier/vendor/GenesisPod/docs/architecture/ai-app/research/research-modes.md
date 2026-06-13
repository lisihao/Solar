# AI Research 研究模式架构

> **版本**: 1.0
> **创建日期**: 2026-02-05
> **代码位置**: `backend/src/modules/ai-app/research/`

---

## 概述

AI Research 模块统一管理 4 种研究模式，每种模式针对不同场景和时间粒度。

```
research/
├── research.module.ts           # 统一导出
├── topic-research/              # 专题研究 (分钟级)
├── deep-research/               # 深度研究 (分钟-小时级)
├── notebook-research/           # 笔记本研究 (NotebookLM 风格)
└── fast-research/               # 快速问答研究 (秒级，待实现)
```

---

## 1. Topic Research (专题研究)

**响应时间**: 分钟级
**使用场景**: 多 Agent 协作的专题深度研究

### 架构

```
topic-research/
├── controllers/
│   ├── topic.controller.ts           # Topic CRUD
│   ├── mission.controller.ts         # Mission 管理
│   ├── report.controller.ts          # Report 输出
│   ├── collaboration.controller.ts   # 协作功能
│   ├── todo.controller.ts            # 待办事项
│   └── report-review.controller.ts   # 报告审核
├── services/
│   └── ...
├── topic-research.service.ts         # 核心服务
├── topic-research.gateway.ts         # WebSocket 实时推送
└── topic-research.module.ts
```

### 核心流程

```
1. 创建 Topic → 2. 添加资源和成员 → 3. 发起 Mission
    ↓
4. 任务分解 (TaskBreakdownService)
    ↓
5. 多 Agent 并行执行
    ↓
6. 结果整合 → 7. 生成 Report
```

### 关键服务

- `TopicResearchService` - 核心业务逻辑
- `MissionLifecycleService` - Mission 状态机管理
- `TaskBreakdownService` - 任务分解
- `TeamCollaborationService` - 团队协作
- `TopicEventEmitterService` - 事件广播

---

## 2. Deep Research (深度研究)

**响应时间**: 分钟-小时级
**使用场景**: 单 Agent 迭代式深度研究，类似 Perplexity Pro

### 架构

```
deep-research/
├── deep-research-agent.service.ts    # 主 Agent
├── research-planner.service.ts       # 研究规划
├── iterative-search.service.ts       # 迭代搜索
├── self-reflection.service.ts        # 自我反思
└── report-synthesizer.service.ts     # 报告合成
```

### 核心流程

```
1. 接收研究问题
    ↓
2. 规划研究路径 (ResearchPlanner)
    ↓
3. 迭代搜索循环
   ├── 执行搜索 (IterativeSearch)
   ├── 评估结果 (SelfReflection)
   └── 决定是否继续
    ↓
4. 合成最终报告 (ReportSynthesizer)
```

### 关键特性

- **迭代式搜索**: 基于中间结果动态调整搜索策略
- **自我反思**: 评估研究进度和质量
- **深度优先**: 单一话题深入挖掘

---

## 3. Notebook Research (笔记本研究)

**响应时间**: 实时交互
**使用场景**: NotebookLM 风格的知识库问答

### 架构

```
notebook-research/
├── ai-studio.service.ts              # 核心服务
├── ai-studio-chat.service.ts         # 对话服务
├── ai-studio-tts.service.ts          # 语音合成
└── ai-studio.controller.ts           # API 控制器
```

### 核心流程

```
1. 上传文档/添加资源 → 2. 构建知识库
    ↓
3. 用户提问 → 4. RAG 检索 → 5. 生成回答
    ↓
6. 支持 TTS 语音播放
```

### 关键特性

- **RAG 驱动**: 基于上传文档的检索增强生成
- **多轮对话**: 保持上下文连贯性
- **语音输出**: 支持 TTS 朗读

---

## 4. Fast Research (快速研究)

**响应时间**: 秒级
**使用场景**: 简单问题的快速回答

### 状态

🚧 **待实现**

### 预期架构

```
fast-research/
├── fast-research.service.ts          # 核心服务
├── quick-answer.service.ts           # 快速回答
└── fast-research.controller.ts       # API
```

### 预期特性

- 单次搜索 + 即时总结
- 无复杂规划
- 适合简单事实性问题

---

## 模式对比

| 特性           | Topic Research | Deep Research | Notebook Research | Fast Research |
| -------------- | -------------- | ------------- | ----------------- | ------------- |
| **响应时间**   | 分钟级         | 分钟-小时级   | 实时              | 秒级          |
| **Agent 数量** | 多 Agent       | 单 Agent      | 单 Agent          | 单 Agent      |
| **迭代次数**   | 多轮           | 多轮          | 单轮/多轮         | 单轮          |
| **知识来源**   | Web + 资源     | Web           | 本地文档          | Web           |
| **协作模式**   | 团队协作       | 独立研究      | 问答交互          | 快速查询      |
| **输出格式**   | 结构化报告     | 长文报告      | 对话式            | 简短回答      |
| **实现状态**   | ✅ 已实现      | ✅ 已实现     | ✅ 已实现         | 🚧 待实现     |

---

## 统一入口

所有研究模式通过 `research.module.ts` 统一导出：

```typescript
@Module({
  imports: [
    TopicResearchModule,
    DeepResearchModule,
    NotebookResearchModule,
    // FastResearchModule, // 待实现
  ],
  exports: [TopicResearchModule, DeepResearchModule, NotebookResearchModule],
})
export class ResearchModule {}
```

---

## 相关文档

- [AI Engine 架构](../../ai-engine/readme.md)
- [AI Teams 架构](../ai-teams/readme.md)
- [Topic Research PRD](../../../prd/current/ai-research/)

---

**维护者**: 技术架构团队
**最后更新**: 2026-02-05
