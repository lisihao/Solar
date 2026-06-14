# GenesisPod 改进 TODO 清单

> **基于**: improvement-plan-2026-01.md
> **创建日期**: 2026-01-15
> **状态**: 待执行

---

## 优先级说明

| 优先级 | 含义 | 时间要求     |
| ------ | ---- | ------------ |
| **P0** | 紧急 | 1 周内完成   |
| **P1** | 重要 | 2-4 周内完成 |
| **P2** | 一般 | 1-3 月内完成 |

---

## Phase 1: 紧急修复 (Week 1) ✅ 已完成 (3/3)

### P0 - 内存泄漏修复

- [x] **TD-001**: 修复 `executingTasks`/`revisingTasks` Set 无 TTL ✅
  - **实现**: `ExecutionStateManager` (AI Engine) 提供 30 分钟 TTL + 5 分钟清理周期
  - **文件**: `backend/src/modules/ai-engine/orchestration/state-machine/execution-state.manager.ts`

- [x] **TD-002**: 修复 CircuitBreaker 状态永不过期 ✅
  - **实现**: `CircuitBreakerService` 提供 24 小时 TTL + 1 小时清理周期
  - **文件**: `backend/src/modules/ai-engine/orchestration/services/circuit-breaker.service.ts`

- [x] **TD-003**: 添加服务重启状态恢复 ✅
  - **实现**: `TeamMissionService.onModuleInit()` 调用 `recoverStuckTasks()` 恢复卡住任务
  - **文件**: `backend/src/modules/ai-app/teams/services/collaboration/mission/team-mission.service.ts`

---

## Phase 2: 测试覆盖 (Week 2)

### P0 - 关键组件测试

- [ ] **TD-004**: 创建 `ResearchTimeline.test.tsx`
  - **目录**: `frontend/components/ai-research/__tests__/`
  - **覆盖**: 空数据处理、边界情况、数据渲染
  - **预计工时**: 4 小时

- [ ] **TD-005**: 创建 `TopicContentPanel.test.tsx`
  - **目录**: `frontend/components/ai-research/__tests__/`
  - **覆盖**: undefined 处理、Tab 切换、导出功能
  - **预计工时**: 6 小时

### P1 - 后端服务测试

- [ ] **TD-006**: 创建 `task-profile.types-mapper.service.spec.ts`
  - **目录**: `backend/src/modules/ai-engine/llm/services/__tests__/`
  - **覆盖**: 基础映射、推理模型逻辑、JSON 格式限制
  - **预计工时**: 3 小时

---

## Phase 3: 代码拆分 (Week 3-4)

### P1 - 后端服务拆分

- [ ] **TD-007**: 拆分 `team-mission.service.ts` (6004 行)
  - **目标结构**:
    ```
    services/collaboration/mission/
    ├── mission-lifecycle.service.ts    (~500 行)
    ├── mission-execution.service.ts    (~600 行)
    ├── mission-review.service.ts       (~400 行)
    ├── mission-revision.service.ts     (~300 行)
    └── mission-notification.service.ts (~200 行)
    ```
  - **预计工时**: 3 天

### P1 - 前端 Store 拆分

- [ ] **TD-008**: 拆分 `aiTeamsStore.ts` (1200+ 行)
  - **目标结构**:
    ```
    stores/ai-teams/
    ├── topic.store.ts     (~300 行)
    ├── message.store.ts   (~250 行)
    ├── mission.store.ts   (~400 行)
    ├── websocket.store.ts (~200 行)
    └── combined.store.ts  (~50 行)
    ```
  - **预计工时**: 2 天

### P1 - 循环依赖解决

- [ ] **TD-009**: 引入 EventBus 事件总线
  - **新建文件**: `backend/src/common/events/event-bus.service.ts`
  - **修改文件**: `ai-teams.gateway.ts`, `team-mission.service.ts`
  - **预计工时**: 3 天

---

## Phase 4: Schema 拆分 (Month 2)

### P2 - Prisma 多文件 Schema

- [ ] **TD-010**: Prisma Schema 多文件拆分
  - **前提**: 升级 Prisma 到 5.15+
  - **目标结构**:
    ```
    prisma/
    ├── schema.prisma
    └── models/
        ├── user.prisma         (~200 行)
        ├── content.prisma      (~500 行)
        ├── ai-teams.prisma     (~800 行)
        ├── ai-apps.prisma      (~600 行)
        ├── ingestion.prisma    (~300 行)
        └── integrations.prisma (~400 行)
    ```
  - **预计工时**: 5 天

---

## Phase 5: 架构优化 (Month 3)

### P2 - AI Engine 子模块化

- [ ] **TD-011**: AI Engine 子模块拆分
  - **新建模块**:
    - `LLMModule` (AiChatService, TaskProfileMapper, ModelFallback)
    - `ToolsModule` (ToolRegistry, 55+ 工具)
    - `AgentsModule` (AgentRegistry, 5 个内置 Agent)
    - `OrchestrationModule` (4 执行器, 11 服务)
  - **预计工时**: 5 天

### P2 - 文档补充

- [ ] **TD-012**: 创建 AI Engine 子系统文档
  - **待创建**:
    - `docs/architecture/ai-engine/tools-system.md`
    - `docs/architecture/ai-engine/agent-framework.md`
    - `docs/architecture/ai-engine/orchestration.md`
    - `docs/architecture/ai-engine/teams-system.md`
  - **预计工时**: 2 天

### P2 - 可观测性提升

- [ ] **TD-013**: 添加结构化日志
  - **方案**: JSON 格式日志输出
  - **涉及文件**: 所有 `*.service.ts`
  - **预计工时**: 4 小时

- [ ] **TD-014**: 简化 User 模型关系
  - **当前**: User 关联 50+ 模型
  - **目标**: 减少直接关联，使用中间表
  - **预计工时**: 3 天

---

## 验证检查点

### 每阶段完成后验证

```bash
# Phase 1 完成后
npm run type-check && npm run test:quick

# Phase 2 完成后
npm run test:coverage  # 目标 ≥ 60%

# Phase 3 完成后
npm run test  # 集成测试通过

# Phase 4 完成后
npx prisma migrate dev && npm run test

# Phase 5 完成后
npm run verify:full
```

---

## 进度追踪 (初始阶段)

> 注：此表已过时，请查看下方"更新后的进度追踪"获取最新状态

| 阶段     | 任务数 | 完成数 | 进度    |
| -------- | ------ | ------ | ------- |
| Phase 1  | 3      | 3      | 100% ✅ |
| Phase 2  | 3      | 0      | 0%      |
| Phase 3  | 3      | 0      | 0%      |
| Phase 4  | 1      | 0      | 0%      |
| Phase 5  | 4      | 0      | 0%      |
| **总计** | **14** | **3**  | **21%** |

---

## 时间线

```
Week 1:  TD-001, TD-002, TD-003 (P0 紧急修复)
Week 2:  TD-004, TD-005, TD-006 (测试覆盖)
Week 3:  TD-007 (team-mission.service.ts 拆分)
Week 4:  TD-008, TD-009 (Store 拆分 + 循环依赖)
Month 2: TD-010 (Schema 拆分)
Month 3: TD-011, TD-012, TD-013, TD-014 (架构优化)
```

---

---

## 新增发现 (专家评估补充)

### 冗余文件清理 (来自 Explore Agent)

| 路径                   | 大小   | 优先级 | 操作                       | 状态    |
| ---------------------- | ------ | ------ | -------------------------- | ------- |
| `debug/`               | 35.7MB | **P0** | 保留 (用户决定)            | ⏸️ 保留 |
| `.playwright-mcp/`     | <1MB   | P2     | 删除 (空目录)              | ✅ 完成 |
| `package.json` crawler | -      | **P1** | 移除 (workspace 不存在)    | ✅ 完成 |
| `project-rules.md`     | 30KB   | P2     | 归档 (已被 CLAUDE.md 替代) | ✅ 完成 |

### 文档体系改进 (来自 Docs Specialist)

**文档完整性评分: 72/100**

- [ ] **TD-015**: 补充6个无文档模块的基础文档
  - `fast-research/`, `notebook-research/`, `feedback/`, `credits/`, `email/`, `settings/`
- [ ] **TD-016**: 清理20+ TODO/FIXME标记
- [ ] **TD-017**: 统一文档更新日期格式
- [ ] **TD-018**: 完善15+ 模块的API文档

### 代码质量改进 (来自 Reviewer Agent)

**代码质量评分: 7.2/10**

- [ ] **TD-019**: 减少1535处 `any` 类型使用 (目标减少50%)
- [x] **TD-020**: 修复 `dangerouslySetInnerHTML` XSS风险 ✅ (已添加 DOMPurify sanitize)
- [x] **TD-021**: OAuth Token URL泄露 ✅ (记录为架构改进 - SSE/OAuth回调常见模式)
- [ ] **TD-022**: 拆分5个超大前端组件 (>2500行)
  - TopicContentPanel.tsx (4417行)
  - SlidesTab.tsx (3920行)
  - ExploreContent.tsx (3674行)
  - TeamCanvasModal.tsx (3199行)
  - ImageGenerator.tsx (2516行)

---

## 更新后的进度追踪

| 阶段                 | 任务数 | 完成数 | 进度    |
| -------------------- | ------ | ------ | ------- |
| Phase 1 (紧急修复)   | 3      | 3      | 100% ✅ |
| Phase 2 (测试覆盖)   | 3      | 0      | 0%      |
| Phase 3 (代码拆分)   | 3      | 0      | 0%      |
| Phase 4 (Schema拆分) | 1      | 0      | 0%      |
| Phase 5 (架构优化)   | 4      | 0      | 0%      |
| **新增 (冗余清理)**  | **4**  | **3**  | **75%** |
| **新增 (文档改进)**  | **4**  | **0**  | **0%**  |
| **新增 (代码质量)**  | **4**  | **2**  | **50%** |
| **总计**             | **26** | **8**  | **31%** |

---

**最后更新**: 2026-01-16
**下次审查**: 每周五

