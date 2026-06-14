# Topic Research 重构设计

## 问题分析

### 当前架构（错误）

```
DimensionResearchService.researchDimension()
    └─> analyzeWithAI()  ← 单次 LLM 调用
        └─> 生成 6000+ 字 JSON
        └─> 超 token 限制 → 截断 → 解析失败
```

**问题：**

1. 绕过 Leader-Agent 协作机制
2. 单次 LLM 调用生成完整内容
3. JSON 格式脆弱，截断即失败
4. Leader 形同虚设，只规划维度列表

---

## 目标架构

### 核心原则

```
Leader 职责：
1. 理解用户意图 - 深入分析用户想要什么
2. 规划完整大纲 - 保证广度和覆盖度
3. 分解到 Agent - 每个章节一个 Task
4. 拉起 Agent 执行 - 协调并行执行
5. 审核 Agent 输出 - 深度质量检查
6. 整合最终结果 - 合并各章节
```

### 新的执行流程

```
用户发起维度研究
    ↓
【Leader 理解意图】
    - 分析维度名称、描述、搜索结果
    - 理解用户真正想知道什么
    - 输出：意图摘要
    ↓
【Leader 规划大纲】
    - 设计章节结构（不是固定模板）
    - 为每个章节定义：标题、要点、字数、引用要求
    - 确保覆盖度和深度
    - 输出：章节大纲（5-8 个章节）
    ↓
【创建 Mission + Tasks】
    - 1 个维度 = 1 个 Mission
    - 每个章节 = 1 个 Task
    - Task 之间可以有依赖（如"总结"依赖前面所有章节）
    ↓
【Agent 执行各章节】（可并行）
    - Agent1: 写"背景概述" (300字)
    - Agent2: 写"现状分析" (800字)
    - Agent3: 写"趋势演进" (600字)
    - ...
    ↓
【Leader 审核每个章节】
    - 检查是否完成要求
    - 检查引用是否正确
    - 检查与其他章节是否一致
    - 不通过 → Agent 修订
    ↓
【Leader 整合】
    - 合并所有章节
    - 提取关键发现 (keyFindings)
    - 生成最终 Markdown 报告
```

---

## 详细设计

### 1. Leader 理解意图

**输入：**

- 专题信息 (topic)
- 维度信息 (dimension)
- 搜索结果 (evidenceData)

**输出：**

```typescript
interface IntentUnderstanding {
  // 用户真正想知道什么
  coreQuestion: string;
  // 研究范围
  scope: {
    included: string[]; // 应该包含的方面
    excluded: string[]; // 明确排除的方面
  };
  // 期望深度
  expectedDepth: "overview" | "detailed" | "comprehensive";
  // 目标受众
  targetAudience: string;
}
```

### 2. Leader 规划大纲

**输入：**

- IntentUnderstanding
- 搜索结果摘要

**输出：**

```typescript
interface DimensionOutline {
  // 大纲章节（Leader 自主决定，不是固定模板）
  sections: SectionPlan[];
  // 执行策略
  executionPlan: {
    parallelSections: string[][]; // 可并行的章节组
    dependencies: Record<string, string[]>; // 章节依赖
  };
}

interface SectionPlan {
  id: string;
  title: string; // 章节标题
  description: string; // 章节描述
  keyPoints: string[]; // 必须覆盖的要点
  targetWords: number; // 目标字数 (300-800)
  evidenceRequirements: {
    minReferences: number; // 最少引用数
    preferredSources: string[]; // 优先来源
  };
  assignedAgent?: string; // 分配的 Agent
}
```

### 3. Task 执行

**每个 Task 的输入：**

```typescript
interface SectionTaskInput {
  sectionPlan: SectionPlan; // Leader 规划的章节
  relevantEvidence: Evidence[]; // 相关证据
  previousSections?: string[]; // 已完成的章节（用于保持一致性）
}
```

**每个 Task 的输出：**

```typescript
interface SectionTaskOutput {
  content: string; // Markdown 内容
  references: string[]; // 使用的证据 ID
  wordCount: number;
  keyTakeaways: string[]; // 关键要点
}
```

### 4. Leader 审核

**审核维度：**

1. 完成度：是否覆盖了 keyPoints
2. 字数：是否接近 targetWords
3. 引用：是否满足 minReferences
4. 一致性：与已完成章节是否矛盾
5. 质量：内容是否有深度

**审核决策：**

```typescript
interface SectionReviewDecision {
  approved: boolean;
  score: number; // 0-100
  feedback: string;
  revisionInstructions?: string;
}
```

### 5. 整合输出

**最终输出（替代复杂 JSON）：**

```typescript
interface DimensionAnalysisResult {
  // 核心内容（Markdown）
  content: string;

  // 结构化元数据（轻量级提取）
  metadata: {
    summary: string; // 50-100字
    keyFindings: string[]; // 3-5 个要点
    confidenceLevel: "high" | "medium" | "low";
  };

  // 引用的证据
  evidenceUsed: string[];
}
```

---

## 实现计划

### Phase 1: 核心重构

1. **新建 `DimensionMissionService`**
   - 替代 `DimensionResearchService.analyzeWithAI()`
   - 创建 Mission + Tasks
   - 调用 AI Teams 的执行机制

2. **修改 `ResearchLeaderService`**
   - 新增 `understandDimensionIntent()` - 理解意图
   - 新增 `planDimensionOutline()` - 规划大纲
   - 新增 `reviewSectionOutput()` - 审核章节
   - 新增 `integrateDimensionResults()` - 整合结果

3. **创建 `DimensionAgentService`**
   - 实现 `writeSectionContent()` - 写单个章节
   - 每次调用只需生成 300-800 字

### Phase 2: 集成

4. **修改 `TopicTeamOrchestratorService`**
   - 使用新的 `DimensionMissionService`
   - 支持实时进度通知

5. **修改 `ResearchMissionService`**
   - 同上

### Phase 3: 优化

6. **并行优化**
   - 无依赖的章节并行执行
   - 进度实时推送

7. **容错增强**
   - Agent 切换机制
   - 部分失败处理

---

## Token 对比

| 方案             | 单次 Token       | 成功率         |
| ---------------- | ---------------- | -------------- |
| 当前（单次调用） | 16000+           | 低（经常截断） |
| 新方案（分章节） | 每章节 1000-2000 | 高             |

**新方案的总 Token 可能更多，但每次调用都在安全范围内，不会截断。**

---

## 实现状态

> ✅ **已完成** - 2025-01-13

### 已实现的功能

1. **核心服务**
   - `DimensionMissionService` - 维度研究任务编排器
   - `SectionWriterService` - 章节写作 Agent 服务
   - `ResearchLeaderService` 增强 - 大纲规划、Agent 配置、审核整合

2. **Leader-Agent 协作机制**
   - Leader 规划大纲，分配章节给 Agent
   - Agent 独立写作单章节（300-800 字）
   - Leader 审核、整合最终结果

3. **Agent 配置能力 (AgentSectionConfig)**
   - `tools`: 工具列表（如 `["web_search", "url_fetch"]`）
   - `skills`: 分析技能（trend_analysis, swot_analysis, competitive_analysis 等）
   - `analysisGuidance`: 分析指导
   - `outputStyle`: 输出风格
   - `preferredDataSources`: 优先数据源

4. **唯一 Agent 命名**
   - `agentId`: 如 `researcher_market_analysis`
   - `agentName`: 如 `市场分析研究员`
   - 便于日志区分和调试

5. **容错机制**
   - AI Engine CircuitBreaker 保护
   - ModelFallbackService 模型降级
   - 章节级别重试

6. **集成完成**
   - `TopicTeamOrchestratorService` - 使用新的 DimensionMissionService
   - `ResearchMissionService` - 使用新的 DimensionMissionService
   - Module 注册和导出

### 迁移说明

已完全采用新方案，旧的 `DimensionResearchService.analyzeWithAI()` 不再使用。
