# 文档与代码一致性检查报告

**检查日期**: 2026-02-05
**检查范围**: docs/architecture/ 与 backend/src/modules/ 对比
**状态**: 发现不一致，需更新

---

## 一、不一致清单

### 1. AI Engine 模块

| 文档描述                | 实际代码                             | 差异     | 优先级 |
| ----------------------- | ------------------------------------ | -------- | ------ |
| 工具系统 55+ 工具       | 需验证实际数量                       | 可能过时 | P2     |
| 未提及 observability/   | 新增 `ai-engine/observability/`      | 缺失     | P1     |
| 未提及 evidence/        | 新增 `ai-engine/evidence/` (P2 能力) | 缺失     | P1     |
| 未提及 quality/         | 新增 `ai-engine/quality/` (P2 能力)  | 缺失     | P1     |
| 未提及 realtime/        | 新增 `ai-engine/realtime/` (P2 能力) | 缺失     | P1     |
| collaboration/ 描述简单 | 扩展了 voting/todo/review            | 需补充   | P2     |

### 2. AI Apps 模块

| 文档描述           | 实际代码                                  | 差异   | 优先级 |
| ------------------ | ----------------------------------------- | ------ | ------ |
| Research 模块单一  | 4 种研究模式统一                          | 需更新 | P0     |
| -                  | topic-research/ (分钟级)                  | 缺失   | P0     |
| -                  | deep-research/ (分钟-小时级)              | 缺失   | P0     |
| -                  | notebook-research/ (NotebookLM 风格)      | 缺失   | P0     |
| -                  | fast-research/ (秒级，待实现)             | 缺失   | P0     |
| Writing 基础描述   | 新增 DOME/SCORE 服务                      | 需更新 | P1     |
| -                  | hierarchical-summary.service.ts (v4-DOME) | 缺失   | P1     |
| -                  | dynamic-outline.service.ts (v4-DOME)      | 缺失   | P1     |
| -                  | shared-scratchpad.service.ts (v4-DOME)    | 缺失   | P1     |
| 未提及 ai-app/rag/ | 新增独立 RAG 模块                         | 缺失   | P1     |

### 3. Core 模块

| 文档描述                      | 实际代码                                            | 差异   | 优先级 |
| ----------------------------- | --------------------------------------------------- | ------ | ------ |
| 未提及 monitoring/            | 新增 `core/monitoring/`                             | 缺失   | P1     |
| Admin 模块基础                | 新增 cache-admin, monitoring-admin                  | 需更新 | P2     |
| 未提及 distributed-rate-limit | 新增 `common/cache/distributed-rate-limit.guard.ts` | 缺失   | P2     |

### 4. 系统架构总览

| 文档描述     | 实际代码     | 差异     | 优先级 |
| ------------ | ------------ | -------- | ------ |
| 工具数量 46+ | 实际可能更多 | 需验证   | P2     |
| 代码行数统计 | 可能已过时   | 建议更新 | P3     |

---

## 二、需要更新的文档

### 高优先级 (P0-P1)

1. **docs/architecture/ai-engine/readme.md**
   - 添加 observability、evidence、quality、realtime 模块
   - 更新模块统计

2. **docs/architecture/ai-engine/module-overview.md**
   - 补充新增的 P2 能力模块
   - 更新模块架构图

3. **新建**: docs/architecture/ai-apps/ai-research/research-modes.md
   - 描述 4 种研究模式

4. **更新**: docs/architecture/ai-apps/ai-writing/ai-writing-architecture.md
   - 补充 DOME/SCORE 架构

5. **新建**: docs/architecture/ai-infra/monitoring/monitoring-architecture.md
   - 描述监控模块架构

### 中优先级 (P2)

6. **docs/architecture/system-architecture-overview.md**
   - 更新工具数量
   - 更新模块代码分布图

---

## 三、文档与代码映射表（更新版）

| 文档路径                              | 代码路径                                   | 状态   |
| ------------------------------------- | ------------------------------------------ | ------ |
| `architecture/ai-engine/`             | `backend/src/modules/ai-engine/`           | 需更新 |
| `architecture/ai-apps/ai-office/`     | `backend/src/modules/ai-app/office/`       | OK     |
| `architecture/ai-apps/ai-studio/`     | `backend/src/modules/ai-app/research/`     | 需更新 |
| `architecture/ai-apps/ai-teams/`      | `backend/src/modules/ai-app/teams/`        | OK     |
| `architecture/ai-apps/ai-writing/`    | `backend/src/modules/ai-app/writing/`      | 需更新 |
| `architecture/ai-apps/ai-social/`     | `backend/src/modules/ai-app/social/`       | OK     |
| `architecture/ai-apps/ai-image/`      | `backend/src/modules/ai-app/image/`        | OK     |
| `architecture/ai-apps/ai-simulation/` | `backend/src/modules/ai-app/simulation/`   | OK     |
| **缺失**                              | `backend/src/modules/ai-app/rag/`          | 需创建 |
| **缺失**                              | `backend/src/modules/ai-infra/monitoring/` | 需创建 |
| `architecture/ai-infra/`              | `backend/src/modules/ingestion/`           | OK     |
| `architecture/ai-infra/`              | `backend/src/modules/integrations/`        | OK     |

---

## 四、执行计划

### Phase 1: 更新核心文档 (立即)

1. 更新 `ai-engine/readme.md` - 添加新模块描述
2. 更新 `ai-engine/module-overview.md` - 补充模块架构图

### Phase 2: 补充缺失文档 (本周)

3. 创建 `ai-apps/ai-research/research-modes.md`
4. 更新 `ai-apps/ai-writing/ai-writing-architecture.md`
5. 创建 `ai-infra/monitoring/monitoring-architecture.md`

### Phase 3: 完善细节 (下周)

6. 更新系统架构总览统计数据
7. 验证并更新工具数量

---

**检查者**: Claude Code
**下次检查**: 建议每月一次
