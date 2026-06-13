# 文档目录整改方案

**创建日期**: 2026-02-05
**状态**: 执行中
**目标**: 按架构分层整理文档，消除散乱和重复

---

## 一、当前问题

| 问题                      | 文件数 | 影响                  |
| ------------------------- | ------ | --------------------- |
| `plans/` 散落在根目录     | 24     | 与架构层脱节          |
| `tasks/` 含过时内容       | 2      | 应归档或移入对应层    |
| `product/` 单独目录       | 1      | 应合并到 prd          |
| `improvement-plans/` 独立 | 2      | 应合并到 plans        |
| `designs/` 独立           | 3      | 应合并到 architecture |
| `_archive/` 过度膨胀      | 120+   | 应精简                |
| PRD 迁移未完成            | 65     | current/archive 空置  |

---

## 二、目标结构

```
docs/
├── readme.md                    # 总导航
├── CHANGELOG.md                 # 更新日志
│
├── system/                      # 【新】系统级文档
│   ├── overview.md              # 系统架构总览
│   ├── diagnosis/               # 系统诊断报告
│   ├── decisions/               # 架构决策记录 (ADR)
│   └── roadmap.md               # 产品路线图
│
├── architecture/                # 架构设计
│   ├── system/                  # 系统层
│   ├── infra/                   # 基础设施层
│   │   ├── plans/              # 【新】基础设施改进计划
│   │   └── ...
│   ├── ai-engine/               # AI Engine 层
│   │   ├── plans/              # 【新】AI Engine 计划
│   │   └── ...
│   ├── ai-teams/                # AI Teams 层
│   │   ├── plans/              # 【新】AI Teams 计划
│   │   └── ...
│   └── ai-apps/                 # AI Apps 层
│       ├── ai-office/
│       │   ├── plans/          # 【新】Office 计划
│       │   └── ...
│       └── ...
│
├── prd/                         # 产品需求
│   ├── readme.md
│   ├── current/                 # 当前有效版本
│   │   ├── infra/
│   │   ├── ai-engine/
│   │   ├── ai-teams/
│   │   └── ai-apps/
│   └── archive/                 # 历史版本
│
├── features/                    # 功能文档
│   └── ...                      # 保持现状
│
├── guides/                      # 开发指南
│   └── ...                      # 保持现状
│
├── api/                         # API 文档
├── analysis/                    # 分析报告
│
└── _archive/                    # 历史归档（精简后）
    ├── 2025-q4/                 # 按季度
    └── 2026-q1/
```

---

## 三、文件迁移映射

### 3.1 plans/ 目录拆分

| 原位置                                       | 目标位置                                 | 理由       |
| -------------------------------------------- | ---------------------------------------- | ---------- |
| `plans/system-improvements-summary.md`       | `system/diagnosis/`                      | 系统级     |
| `plans/system-architecture-diagnosis.md`     | `system/diagnosis/`                      | 系统级     |
| `plans/backend-diagnosis-2026-01.md`         | `system/diagnosis/`                      | 系统级     |
| `plans/infra-changelog.md`                   | `architecture/infra/plans/`              | 基础设施   |
| `plans/unified-secrets-management.md`        | `architecture/infra/plans/`              | 基础设施   |
| `plans/unified-blog-format.md`               | `architecture/infra/plans/`              | 基础设施   |
| `plans/unified-export-system.md`             | `architecture/infra/plans/`              | 基础设施   |
| `plans/ai-engine-*.md` (5个)                 | `architecture/ai-engine/plans/`          | AI Engine  |
| `plans/ai-agent-capabilities-management.md`  | `architecture/ai-engine/plans/`          | AI Engine  |
| `plans/multi-agent-framework-comparison.md`  | `architecture/ai-teams/plans/`           | AI Teams   |
| `plans/ai-teams-*.md` (2个)                  | `architecture/ai-teams/plans/`           | AI Teams   |
| `plans/topic-research-*.md` (3个)            | `architecture/ai-apps/ai-studio/plans/`  | AI Studio  |
| `plans/ai-office-content-driven-refactor.md` | `architecture/ai-apps/ai-office/plans/`  | AI Office  |
| `plans/ai-writing-super-brain.md`            | `architecture/ai-apps/ai-writing/plans/` | AI Writing |
| `plans/ai-social-mcp-refactor.md`            | `architecture/ai-apps/ai-social/plans/`  | AI Social  |
| `plans/visual-engine-migration.md`           | `architecture/ai-apps/ai-image/plans/`   | AI Image   |
| `plans/report-figure-integration-plan.md`    | `architecture/ai-apps/ai-studio/plans/`  | AI Studio  |
| `plans/ai-ui-patrol-automation.md`           | `architecture/infra/plans/`              | 基础设施   |

### 3.2 其他目录合并

| 原位置                                     | 目标位置                                |
| ------------------------------------------ | --------------------------------------- |
| `tasks/`                                   | 归档到 `_archive/2025-q4/tasks/` (过时) |
| `product/ai-research-annotation-design.md` | `prd/current/ai-apps/ai-studio/`        |
| `improvement-plans/*.md`                   | 合并到对应架构层 `plans/`               |
| `designs/*.md`                             | `architecture/ai-apps/*/` (按内容)      |

### 3.3 PRD 迁移

将 `prd/ai-apps/`、`prd/ai-teams/`、`prd/infra/` 移入 `prd/current/`。

---

## 四、执行步骤

### Phase 1: 创建目录结构

```bash
# 创建系统级目录
mkdir -p docs/system/diagnosis

# 创建各架构层 plans 目录
mkdir -p docs/architecture/infra/plans
mkdir -p docs/architecture/ai-engine/plans
mkdir -p docs/architecture/ai-teams/plans
mkdir -p docs/architecture/ai-apps/ai-office/plans
mkdir -p docs/architecture/ai-apps/ai-studio/plans
mkdir -p docs/architecture/ai-apps/ai-writing/plans
mkdir -p docs/architecture/ai-apps/ai-social/plans
mkdir -p docs/architecture/ai-apps/ai-image/plans

# 创建归档目录
mkdir -p docs/_archive/2025-q4/tasks
mkdir -p docs/_archive/2026-q1
```

### Phase 2: 移动文件

按 3.1-3.3 映射表执行 `git mv`。

### Phase 3: 更新导航

更新 `docs/readme.md` 和各层 `readme.md`。

### Phase 4: 清理

- 删除空目录
- 精简 `_archive/`

---

## 五、命名规范

| 类型     | 命名格式              | 示例                        |
| -------- | --------------------- | --------------------------- |
| 计划文档 | `{feature}-plan.md`   | `content-refactor-plan.md`  |
| PRD      | `{module}-prd.md`     | `ai-office-prd.md`          |
| 设计文档 | `{feature}-design.md` | `slides-template-design.md` |
| 归档文档 | `{name}-archived.md`  | `ai-office-v1-archived.md`  |

**原则**：

- 不再使用版本号后缀 (`-v1.0`, `-v2.0`)
- 当前文档直接更新，旧版本移入 archive 并加 `-archived` 后缀
- 所有命名使用 kebab-case

---

## 六、验收标准

- [x] `docs/plans/` 目录不存在
- [x] `docs/tasks/` 目录不存在
- [x] `docs/product/` 目录不存在
- [x] `docs/improvement-plans/` 目录不存在
- [x] `docs/designs/` 目录不存在
- [x] 每个架构层有独立的 `plans/` 子目录
- [x] `prd/current/` 包含所有活跃 PRD
- [x] `docs/system/` 包含系统级文档
- [x] `docs/_reviews/` 移入 `system/reviews/`
- [x] `docs/audits/` 归档
- [x] `docs/implementation/` 移入对应架构层
- [x] `docs/test-cases/` 移入 `guides/testing/`
- [ ] 所有导航链接有效（需后续验证）

---

**执行者**: Claude Code
**完成日期**: 2026-02-05
**状态**: 已完成
