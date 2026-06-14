# 后端架构诊断报告 (2026-01-23 更新)

## 当前状态评分

| 维度                | 评分 | 说明                                                                 |
| ------------------- | ---- | -------------------------------------------------------------------- |
| 模块依赖关系        | 3/5  | AiEngine 子模块化已完成，但 ai-app 层仍有 51+ 文件直接依赖 ai-engine |
| God Service 问题    | 1/5  | 12 个服务超过 2000 行，最大 8073 行                                  |
| Controller 分层     | 5/5  | Controller 已无直接数据库访问                                        |
| Repository 层       | 1/5  | 仅 1 个 Repository 实现（resources.repository.ts）                   |
| forwardRef 使用     | 3/5  | 53 处 forwardRef，主要集中在模块间循环依赖                           |
| @Optional 使用      | 4/5  | AIEngineFacade 使用 @Optional 合理（特性模块可选注入）               |
| AiEngineModule 状态 | 4/5  | 已拆分 6 个子模块，但 RAG/MCP/Capabilities 仍在主模块                |
| 类型安全            | 4/5  | 3 个未使用变量警告（admin.service.ts）                               |

**综合评分: 3.1/5** - 架构基础良好，但存在明显的 God Service 和 Repository 缺失问题

---

## 已修复问题

- [x] Controller 直接访问数据库 - 已清理，所有 Controller 均通过 Service 层
- [x] AiEngineModule 单体问题 - 已拆分为 6 个子模块：
  - AiEngineLLMModule
  - AiEngineToolsModule
  - AiEngineSkillsModule
  - AiEngineOrchestrationModule
  - AiEngineMemoryModule
  - AiEngineConstraintModule
- [x] ai-engine 向 ai-app 的反向依赖 - 已清理，grep 无匹配
- [x] AIEngineFacade @Optional 设计 - 采用特性模块模式，核心仅依赖 AiChatService

---

## 待改进 TODO LIST

### P0 - 紧急（影响稳定性/可维护性）

| 问题                               | 位置                                           | 当前状态  | 建议                                                                                                  |
| ---------------------------------- | ---------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------- |
| writing-mission.service.ts 8073 行 | `ai-app/writing/services/mission/`             | 超标 4x   | 拆分为 5+ 子服务：MissionPlanner, ChapterGenerator, QualityValidator, ProgressTracker, MissionStorage |
| team-mission.service.ts 6044 行    | `ai-app/teams/services/collaboration/mission/` | 超标 3x   | 拆分为：MissionOrchestrator, TaskDispatcher, AgentCoordinator, ResultAggregator                       |
| ai-chat.service.ts 5087 行         | `ai-engine/llm/services/`                      | 超标 2.5x | 拆分为：ChatHandler, StreamProcessor, ModelRouter, ResponseParser, ErrorHandler                       |

### P1 - 高优先级（架构债务）

| 问题                              | 位置                                | 当前状态           | 建议                                                              |
| --------------------------------- | ----------------------------------- | ------------------ | ----------------------------------------------------------------- |
| admin.service.ts 3733 行          | `core/admin/`                       | God Service        | 已有 services/ 子目录，完成委托重构，移除未使用的依赖注入         |
| infographic.service.ts 3323 行    | `ai-app/image/infographic/`         | God Service        | 拆分为：LayoutEngine, DataProcessor, ChartGenerator, StyleApplier |
| topic-research.service.ts 2675 行 | `ai-app/research/topic-research/`   | God Service        | 已有多个子服务，需继续拆分主服务                                  |
| Repository 层缺失                 | 全局                                | 仅 1 个 Repository | 为 admin, teams, writing, research 等模块添加 Repository          |
| 类型检查错误                      | `core/admin/admin.service.ts:65-67` | 3 个未使用变量     | 移除或实际使用 userManagementService 等注入                       |

### P2 - 中优先级（代码质量）

| 问题                                    | 位置                                       | 当前状态 | 建议                                                    |
| --------------------------------------- | ------------------------------------------ | -------- | ------------------------------------------------------- |
| research-mission.service.ts 2446 行     | `ai-app/research/topic-research/services/` | 超标     | 拆分：MissionPlanning, ExecutionEngine, ResultSynthesis |
| historical-knowledge.service.ts 2446 行 | `ai-app/writing/services/quality/`         | 超标     | 拆分：KnowledgeStore, QueryEngine, ConsistencyChecker   |
| ai-admin.service.ts 2349 行             | `core/admin/`                              | 超标     | 拆分：ModelManagement, TeamManagement, UsageAnalytics   |
| storage.service.ts 2330 行              | `core/storage/`                            | 超标     | 拆分：FileStorage, ImageProcessor, CDNManager           |
| slides-export.service.ts 2151 行        | `ai-app/office/slides/rendering/`          | 超标     | 拆分：ExportEngine, TemplateRenderer, AssetManager      |
| research-leader.service.ts 2099 行      | `ai-app/research/topic-research/services/` | 超标     | 拆分：LeaderPlanning, TaskAssignment, ProgressMonitor   |

### P3 - 低优先级（优化项）

| 问题                   | 位置                      | 当前状态                    | 建议                                      |
| ---------------------- | ------------------------- | --------------------------- | ----------------------------------------- |
| forwardRef 过多        | 全局 53 处                | 模块循环依赖                | 重新审视模块边界，引入事件驱动解耦        |
| AiEngineModule 残留    | `ai-engine.module.ts`     | RAG/MCP/Capabilities 未拆分 | 创建 AiEngineRAGModule, AiEngineMCPModule |
| Collaboration 未模块化 | `ai-engine.module.ts:128` | TODO 注释                   | 创建 AiEngineCollaborationModule          |
| AIEngineFacade 2041 行 | `ai-engine/facade/`       | 临界值                      | 监控，考虑拆分为领域 Facade               |

---

## 详细分析

### 1. God Service 问题严重

```
超过 2000 行的服务: 12 个
超过 3000 行的服务: 5 个
超过 5000 行的服务: 3 个
最大服务: 8073 行 (writing-mission.service.ts)
```

**影响**:

- 单元测试困难
- 多人协作冲突
- 理解和维护成本高
- 违反单一职责原则

**建议拆分策略**:

```
God Service
    |
    +-- Core Logic Service (核心业务逻辑)
    +-- Data Access Service (数据访问，未来可迁移到 Repository)
    +-- Integration Service (外部集成)
    +-- Event Handler Service (事件处理)
    +-- Utility Service (工具方法)
```

### 2. Repository 层严重缺失

**现状**: 50 个服务直接使用 `this.prisma.`，但只有 1 个 Repository

**需要添加 Repository 的模块**:

| 模块         | 服务数量 | 直接 Prisma 调用 | 优先级 |
| ------------ | -------- | ---------------- | ------ |
| admin        | 3        | 高频             | P1     |
| teams        | 5+       | 中频             | P1     |
| writing      | 8+       | 高频             | P1     |
| research     | 6+       | 高频             | P1     |
| content/\*   | 10+      | 高频             | P2     |
| ingestion    | 8+       | 高频             | P2     |
| integrations | 5+       | 中频             | P3     |

### 3. forwardRef 分布分析

```
总计: 53 处 forwardRef

按模块分布:
- ai-app/office: 12 处 (slides-skills 循环依赖严重)
- ai-app/research: 6 处
- ai-engine: 4 处
- content: 5 处
- common: 5 处
- 其他: 21 处
```

**高风险循环依赖**:

1. `AiOfficeModule <-> AiImageModule` (相互 forwardRef)
2. `AiEngineOrchestrationModule <-> AiEngineToolsModule/SkillsModule`
3. `slides-skills` 内部多个 Skill 相互依赖

### 4. AiEngineModule 子模块化进度

```
已完成:
[x] AiEngineLLMModule
[x] AiEngineToolsModule
[x] AiEngineSkillsModule
[x] AiEngineOrchestrationModule
[x] AiEngineMemoryModule
[x] AiEngineConstraintModule

待完成:
[ ] AiEngineRAGModule (EmbeddingService, VectorService, DocumentChunker)
[ ] AiEngineMCPModule (MCPManager)
[ ] AiEngineCapabilitiesModule (AICapabilityResolver)
[ ] AiEngineCollaborationModule (VotingManager, HandoffCoordinator)
```

### 5. 类型检查错误

```typescript
// backend/src/modules/ai-infra/admin/admin.service.ts
// 行 65-67: 声明但未使用的属性
private userManagementService: UserManagementService,      // unused
private resourceManagementService: ResourceManagementService, // unused
private statisticsService: StatisticsService,              // unused
```

**修复方案**:

1. 如果计划使用 -> 添加委托方法
2. 如果不需要 -> 移除注入

---

## 推荐行动计划

### Sprint 1 (本周)

1. 修复 admin.service.ts 类型错误
2. 开始拆分 writing-mission.service.ts (最大 God Service)

### Sprint 2 (下周)

1. 继续拆分 team-mission.service.ts
2. 开始拆分 ai-chat.service.ts
3. 为 admin 模块添加 Repository 层

### Sprint 3-4 (两周后)

1. 完成 P1 级别所有 God Service 拆分
2. 为 teams, writing 模块添加 Repository
3. 完成 AiEngineModule 剩余子模块化

### 持续改进

1. 每个 PR 不增加新的 >500 行服务
2. 新功能必须使用 Repository 模式
3. 监控 forwardRef 数量，目标降至 30 以下

---

## 度量指标

| 指标              | 当前值 | 目标值 | 期限    |
| ----------------- | ------ | ------ | ------- |
| >2000 行服务数    | 12     | 0      | Q1 2026 |
| >1000 行服务数    | 20+    | <10    | Q2 2026 |
| Repository 覆盖率 | 2%     | 80%    | Q2 2026 |
| forwardRef 数量   | 53     | <30    | Q1 2026 |
| 类型检查错误      | 3      | 0      | 本周    |

---

**报告生成时间**: 2026-01-23
**诊断工具**: Claude Code Architect Agent
**下次复查**: 2026-02-06
