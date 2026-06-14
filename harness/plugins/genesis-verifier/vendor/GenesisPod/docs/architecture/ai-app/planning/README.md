# AI 策划 (AI Planning) — 架构设计

## 模块定位

AI 策划是独立的 AI App 模块，通过 import AiTeamsModule 复用 Topic/Mission/Debate 基础设施，通过 AI Engine Facade + Registry 访问核心能力。

## 架构关系

```
AI 策划 (独立 AI App)         AI Teams (已有 AI App)         AI Engine (核心)
━━━━━━━━━━━━━━━━━━━         ━━━━━━━━━━━━━━━━━━━━         ━━━━━━━━━━━━━━━━
PlanningOrchestrator ──────→ AiTeamsService ──────────→ AiChatService
PlanningTemplateService       MissionExecutionService      TeamRegistry
PlanningController            DebateService                RoleRegistry
                              AiResponseService            ConstraintEngine
                              TopicService                 MissionContextPackage
```

## 模块结构

```
backend/src/modules/ai-app/planning/
├── ai-planning.module.ts           NestJS 模块定义
├── controllers/
│   ├── planning.controller.ts      REST API
│   └── index.ts
├── services/
│   ├── planning-orchestrator.service.ts  六阶段编排核心
│   ├── planning-template.service.ts      模板管理
│   └── index.ts
├── dto/
│   ├── create-plan.dto.ts          创建策划 DTO
│   └── index.ts
└── config/
    ├── planning-team.config.ts     TeamConfig + WorkflowConfig
    └── index.ts
```

```
frontend/
├── app/ai-planning/
│   ├── page.tsx                    列表页
│   └── [planId]/page.tsx           详情页
├── components/ai-planning/
│   ├── PlanPhaseBar.tsx            阶段进度条
│   ├── PlanningPanel.tsx           策划控制面板
│   ├── PhaseOutputCard.tsx         阶段产出卡片
│   ├── CreatePlanDialog.tsx        创建策划对话框
│   └── PlanExportDialog.tsx        导出对话框
├── stores/aiPlanningStore.ts       Zustand store
└── lib/api/ai-planning.ts          API 客户端
```

## AI Engine 能力复用

| AI Engine 能力        | 在策划中的用途                                                |
| --------------------- | ------------------------------------------------------------- |
| TeamRegistry          | 注册 PLANNING_TEAM_CONFIG                                     |
| RoleRegistry          | 复用 RESEARCH_LEAD / RESEARCHER / ANALYST / WRITER / ADVOCATE |
| ConstraintProfile     | `createConstraintProfile('balanced')` 控制策划深度            |
| WorkflowConfig        | 定义六阶段 sequential 工作流                                  |
| MissionContextPackage | 跨阶段传递 EstablishedFacts                                   |
| AiChatService         | 所有 LLM 调用走统一入口 + TaskProfile                         |

## 关键设计决策

### 独立模块而非 Teams 子功能

AI 策划作为 `ai-app/planning/` 独立 NestJS 模块，而非 Teams 内部子功能。原因：

1. **架构分层原则**：AI App 之间极少直接依赖
2. **职责清晰**：避免 Teams 模块膨胀
3. **独立演进**：策划可以独立迭代而不影响 Teams

通过 `imports: [AiTeamsModule]` 获取 Topic/Mission/Debate 服务。

### Topic 复用（零数据库迁移）

策划数据存储在 Topic 模型中，通过 `metadata.planningMode = true` 区分：

- Topic → 策划项目
- Topic.metadata → 策划配置 + 阶段状态
- TopicAIMember → 策划 AI 成员
- TeamMission → 各阶段任务
- TopicMessage → 讨论/产出消息

### 六阶段工作流

```
Phase 1: 目标分析 (RESEARCH_LEAD)
    ↓
Phase 2: 调研洞察 (RESEARCHER, parallel)
    ↓
Phase 3: 头脑风暴 (RESEARCHER + ANALYST + WRITER)
    ↓
Phase 4: 辩论推演 (ADVOCATE)
    ↓
Phase 5: 方案综合 (ANALYST)
    ↓
Phase 6: 输出交付 (WRITER)
```

### TeamConfig

```typescript
PLANNING_TEAM_CONFIG: TeamConfig = {
  id: "planning",
  type: "predefined",
  leaderRoleId: BUILTIN_ROLES.RESEARCH_LEAD,
  memberRoles: [
    { roleId: RESEARCHER, minCount: 1, maxCount: 2, required: true },
    { roleId: ANALYST, minCount: 1, maxCount: 1, required: true },
    { roleId: WRITER, minCount: 1, maxCount: 1, required: true },
    { roleId: ADVOCATE, minCount: 2, maxCount: 2, required: false },
  ],
  constraintProfile: createConstraintProfile("balanced", {
    quality: { depth: "comprehensive", reviewRequired: true, maxReworks: 2 },
  }),
};
```

## 模块注册

```typescript
// ai-planning.module.ts
@Module({
  imports: [PrismaModule, AiEngineModule, AiTeamsModule],
  controllers: [PlanningController],
  providers: [PlanningOrchestratorService, PlanningTemplateService],
})
export class AiPlanningModule implements OnModuleInit {
  onModuleInit() {
    this.teamRegistry.registerConfig(PLANNING_TEAM_CONFIG);
  }
}

// app.module.ts
imports: [..., AiPlanningModule]
```

## 实施优先级

### P1 — 导航 + 列表页骨架

1. i18n 词条
2. Sidebar / MobileNav / architecture.ts
3. 后端：模板 + 创建/列表 API
4. 前端：列表页 + CreatePlanDialog

### P2 — 阶段引擎 + 详情页

1. PlanningOrchestratorService 六阶段编排
2. advance / retry / export API
3. 详情页 + PlanPhaseBar + PlanningPanel

### P3 — 特殊阶段 + 导出

1. Phase 3 头脑风暴（AI 轮流讨论）
2. Phase 4 辩论推演（集成 DebateService）
3. PlanExportDialog

---

**创建日期**: 2026-02-11
**维护者**: Claude Code
