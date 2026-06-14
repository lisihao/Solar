# GenesisPod 文档目录全面清理分析报告

**分析日期**: 2026-01-15
**分析范围**: `docs/` 目录完整结构
**文档总数**: 267 个 Markdown 文件
**分析人**: 文档专家 Agent
**报告版本**: v1.0

---

## 📋 执行摘要

### 核心发现

1. **文档数量庞大但组织混乱** - 267 个文档分散在 20+ 个子目录
2. **严重的重复和过时问题** - 约 30% 文档存在内容重复或已过时
3. **命名规范执行不力** - 虽有完善规范但实际执行率仅 51%
4. **分类体系过于复杂** - 过多的子目录导致查找困难
5. **文档与代码脱节** - 部分文档描述的功能与实际代码实现不一致

### 严重程度评级

🔴 **紧急**: 命名规范混乱、过期文档泛滥
🟡 **重要**: 分类体系过于复杂、重复内容多
🟢 **改进**: 缺少版本管理、文档更新不及时

### 建议优先级

1. **P0 (立即执行)**: 清理根目录、归档过期文档、修正命名违规
2. **P1 (本周完成)**: 重组分类体系、合并重复文档、更新核心文档
3. **P2 (两周内)**: 建立文档版本管理规则、补充缺失文档、验证代码一致性

---

## 🔍 第一阶段：全面调研

### 1.1 目录结构分析

```
docs/
├── readme.md                     # ✅ 核心导航文档（最后更新: 2025-12-28）
│
├── 📁 ai-trends/                 # 11 个文件 | AI 趋势研究（外部知识）
├── 📁 ai-engine/                 # 6 个文件 | AI 引擎迁移计划
├── 📁 ai-teams/                  # 3 个文件 | AI Teams 架构（最新）
├── 📁 ai-writing/                # 1 个文件 | AI Writing 模块（NEW）
├── 📁 api/                       # 2 个文件 | ✅ 核心 API 文档
├── 📁 architecture/              # 14 个文件 | 🟡 架构文档（含大量重构计划）
├── 📁 archive/                   # 58 个文件 | 📦 历史归档（已初步整理）
│   ├── 2025-q1/                 # 14 个文件（审计、报告、规划等）
│   └── 其他旧文件                # 44 个文件（散乱）
├── 📁 data-management/           # 14 个文件 | ❌ 应拆分到 features/
├── 📁 decisions/                 # 6 个文件 | ✅ 架构决策记录（ADR）
├── 📁 design/                    # 34 个文件 | 🔴 设计文档（过于庞大）
│   ├── ai-reports-optimization/ # 6 个文件
│   └── topic-research/          # 5 个文件
├── 📁 features/                  # 28 个文件 | ✅ 功能文档（结构良好）
│   ├── ai-agents/               # 5 个文件
│   ├── ai-coding/               # 3 个文件
│   ├── ai-office/               # 17 个文件
│   ├── ai-studio/               # 2 个文件
│   ├── ai-teams/                # 4 个文件
│   ├── blog-collection/         # 1 个文件
│   ├── image-generator/         # 1 个文件
│   └── workspace-reporting/     # 2 个文件
├── 📁 guides/                    # 8 个文件 | ✅ 开发指南（核心文档）
│   ├── authentication/          # 1 个文件
│   └── deployment/              # 2 个文件
├── 📁 implementation/            # 4 个文件 | 🟡 实施记录（应归档）
├── 📁 improvement/               # 1 个文件 | ❌ 可合并到其他目录
├── 📁 operations/                # 1 个文件 | 🟡 运营文档（位置不明确）
├── 📁 prd/                       # 49 个文件 | 🔴 产品需求（急需整理）
│   ├── ai-ask/                  # 1 个文件
│   ├── ai-coding/               # 3 个文件
│   ├── ai-group/                # 6 个文件
│   ├── ai-office/               # 4 个文件
│   ├── ai-slides/               # 5 个文件
│   ├── ai-studio/               # 4 个文件
│   ├── archive/                 # 5 个文件
│   ├── core/                    # 7 个文件
│   ├── data-collection/         # 2 个文件
│   ├── integrations/            # 3 个文件
│   ├── knowledge-base/          # 4 个文件
│   ├── library/                 # 1 个文件
│   ├── topic-research/          # 1 个文件
│   └── 根目录文件               # 3 个文件（应归类）
├── 📁 product-reviews/           # 1 个文件 | ❌ 应归档
├── 📁 project-reports/           # 3 个文件 | 🟡 项目报告（应归档）
├── 📁 releases/                  # 1 个文件 | ✅ 版本发布说明
├── 📁 tasks/                     # 1 个文件 | 🟡 任务记录（应归档）
├── 📁 tech-stack/                # 11 个文件 | ✅ 技术栈文档（保留）
├── 📁 testing/                   # 2 个文件 | ✅ 测试文档（保留）
└── 📁 其他根目录文件             # 0 个（已清理）
```

### 1.2 文档数量统计

| 目录                 | 文件数  | 占比     | 评级      | 说明                 |
| -------------------- | ------- | -------- | --------- | -------------------- |
| **prd/**             | 49      | 18.4%    | 🔴 过大   | 需要细分版本管理     |
| **archive/**         | 58      | 21.7%    | 🟡 待优化 | 需要进一步分类       |
| **design/**          | 34      | 12.7%    | 🔴 过大   | 大量重构计划，待整理 |
| **features/**        | 28      | 10.5%    | ✅ 良好   | 结构合理             |
| **architecture/**    | 14      | 5.2%     | 🟡 待整理 | 含大量重构文档       |
| **data-management/** | 14      | 5.2%     | ❌ 应拆分 | 应移至 features/     |
| **ai-trends/**       | 11      | 4.1%     | ✅ 良好   | 外部研究知识         |
| **tech-stack/**      | 11      | 4.1%     | ✅ 良好   | 技术栈文档           |
| **guides/**          | 8       | 3.0%     | ✅ 优秀   | 核心开发指南         |
| **ai-engine/**       | 6       | 2.2%     | 🟡 待整理 | 迁移计划文档         |
| **decisions/**       | 6       | 2.2%     | ✅ 优秀   | 架构决策记录         |
| **其他目录**         | 28      | 10.5%    | 🟡 分散   | 多个小目录           |
| **总计**             | **267** | **100%** | -         | -                    |

### 1.3 命名重复/相似文件识别

#### 高度重复（需要合并）

| 文件组                  | 文件列表                                                                                                                                                                | 建议操作                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| **AI Office 重构**      | `architecture/ai-office-refactor-prd.md`<br>`architecture/ai-office-agent-refactor-plan.md`<br>`features/ai-office/ai-office-3.0-refactor-plan.md`                      | 合并为一个最新版本，其余归档     |
| **AI Slides 优化**      | `prd/ai-slides/ai-slides-v3-optimization-plan.md`<br>`prd/ai-slides/ai-slides-v3.1-visual-upgrade.md`<br>`prd/ai-slides/ai-slides-genspark-gap-closure.md`              | 保留 v3.1 版本，其余归档         |
| **Topic Research 设计** | `design/topic-research-ui-redesign.md`<br>`design/topic-research-redesign-v7.md`<br>`design/topic-research-optimization-plan.md`<br>`design/topic-research-refactor.md` | 保留最新版本，其余归档           |
| **AI Writing 相关**     | `prd/ai-writing-v2.md`<br>`prd/ai-writing-v3-user-first.md`<br>`prd/ai-writing-redesign.md`                                                                             | 保留 v3，归档 v2                 |
| **数据采集文档**        | `data-management/` (14个文件)<br>`features/data-collection/` (应有但分散)                                                                                               | 合并到 features/data-collection/ |
| **实施总结**            | `archive/implementation-status.md`<br>`archive/implementation-summary.md`<br>`decisions/implementation-summary.md`                                                      | 保留一个最新版，删除重复         |

#### 命名相似（需明确区分）

| 相似组                     | 说明                                                    | 建议                              |
| -------------------------- | ------------------------------------------------------- | --------------------------------- |
| `readme.md` vs `readme.md` | 多个子目录都有 readme.md                                | ✅ 合理，作为索引文件             |
| `overview.md`              | `architecture/overview.md`<br>`ai-trends/*/overview.md` | ✅ 合理，不同主题的概览           |
| `*-prd-*.md`               | 散布在 prd/、architecture/、design/                     | 🟡 应统一放在 prd/ 目录           |
| `*-refactor-*.md`          | 散布在 architecture/、design/                           | 🟡 应统一放在 design/ 或 archive/ |

### 1.4 文档最后修改时间分析

#### 最近更新（2026年1月）

```markdown
✅ 活跃文档（7天内更新）

- testing/test-coverage-analysis.md (2026-01-14)
- architecture/ai-context.md (2026-01-14)
- design/topic-research-ui-redesign.md (2026-01-12)
- design/topic-research/prompt-templates.md (2026-01-11)
- design/ai-engine-target-architecture.md (2026-01-12)
- guides/claude-skills-guide.md (2025-01-11)
- guides/claude-skills-ecosystem.md (2025-01-11)
```

#### 2025年12月更新（较新）

```markdown
🟢 近期活跃（1个月内）

- readme.md (2025-12-28)
- guides/automated-development-loop.md (2025-12-28)
- architecture/database-migration-refactor-plan.md (2025-12-27)
- prd/knowledge-base/library-knowledge-base-system.md (2025-12-26)
- features/ai-coding/\*.md (2025-12-21)
```

#### 2025年11月更新（3个月前）

```markdown
🟡 较旧文档（需检查是否过期）

- architecture/ai-office-\*.md (2025-11-23)
- api/readme.md (2025-11-15)
- features/ai-office/\*.md (2025-11-15)
- prd/ai-studio/ai-studio-prd-v4.0.md (2025-11-29)
```

#### 2024年及更早（严重过期）

```markdown
🔴 疑似过期（需要审查或归档）

- data-management/data-management-quick-guide.md (2024-11-19)
- design/ai-reports-optimization/readme.md (2024-12-28)
- decisions/ai-summary-restructuring.md (2024-11-17)
```

### 1.5 抽样一致性检查

#### 检查项：AI Writing 模块

**文档描述**:

- `features/ai-writing/architecture.md` - 描述完整的 AI Writing 架构
- `prd/ai-writing-v3-user-first.md` - v3.0 产品需求

**代码实现**:

```
backend/src/modules/ai-app/writing/ai-writing.module.ts ✅ 存在
```

**一致性**: ✅ 良好 - 文档与代码模块一致

#### 检查项：Topic Research 模块

**文档描述**:

- `prd/topic-research/topic-research-prd-v1.0.md` - 完整 PRD
- `design/topic-research/*.md` - 5个设计文档
- `prd/topic-research-*.md` - 3个交互设计文档

**代码实现**:

```
backend/src/modules/ai-app/research/topic-research/topic-research.module.ts ✅ 存在
```

**一致性**: ✅ 良好 - 文档齐全，代码已实现

#### 检查项：AI Simulation 模块

**文档描述**:

- `prd/core/ai-strategic-simulation-prd.md` - PRD 文档
- `features/ai-teams/debate-system.md` - 辩论系统设计

**代码实现**:

```
backend/src/modules/ai-app/simulation/ai-simulation.module.ts ✅ 存在
```

**一致性**: ✅ 良好

#### 检查项：Data Management

**文档描述**:

- `data-management/` - 14个文件描述数据管理功能
- `prd/data-collection/` - 数据采集 PRD

**代码实现**:

```
backend/src/modules/ingestion/* ✅ 存在（但名称不同）
backend/src/modules/content/resources/* ✅ 存在
```

**一致性**: 🟡 中等 - 文档称"data-management"但代码模块名为"ingestion"和"resources"，需要统一术语

#### 检查项：AI Office 功能

**文档描述**:

- `features/ai-office/` - 17个文件
- `prd/ai-office/` - 4个 PRD 文件
- `architecture/ai-office-*.md` - 6个架构文档

**代码实现**:

```
backend/src/modules/ai-app/office/ai-office.module.ts ✅ 存在
backend/src/modules/ai-app/office/slides/ ✅ 存在
```

**一致性**: 🟡 中等 - 文档过多且版本混乱，存在大量重构计划文档但未明确标注状态

---

## 🚨 第二阶段：问题诊断

### 2.1 严重问题清单（按优先级排序）

#### P0 - 紧急问题（影响可用性）

| 问题ID   | 问题描述                                                                                                                                                                                                           | 影响范围 | 文件数           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ---------------- |
| **P0-1** | **命名规范违规严重**                                                                                                                                                                                               | 全局     | 131个文件（49%） |
|          | 问题详情：虽然项目有完善的命名规范（kebab-case），但执行不力<br>- 全大写文件名（如 `readme.md`、`data-model.md`）<br>- 混合大小写（如 `README.md`、`AI_CONTEXT.md`）<br>- 中文文件名（如 `AI Office 产品方案.md`） |          |                  |
| **P0-2** | **过期文档泛滥**                                                                                                                                                                                                   | 全局     | 约50个文件       |
|          | 问题详情：大量2024年及更早的文档仍在主目录，未归档<br>- 2024年的实施报告<br>- 已废弃的重构计划<br>- 过时的 PRD 版本                                                                                                |          |                  |
| **P0-3** | **根目录散乱（已部分解决）**                                                                                                                                                                                       | docs/    | 1个文件          |
|          | 问题详情：虽然已清理到只剩 readme.md，但历史遗留问题仍需记录                                                                                                                                                       |          |                  |

#### P1 - 重要问题（影响维护性）

| 问题ID   | 问题描述                                                                                                                                                                 | 影响范围                     | 文件数    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- | --------- |
| **P1-1** | **分类体系过于复杂**                                                                                                                                                     | 全局                         | 全部267个 |
|          | 问题详情：<br>- 20+ 个一级子目录<br>- `design/`、`prd/`、`architecture/` 职责重叠<br>- `data-management/` 应属于 `features/`                                             |                              |           |
| **P1-2** | **重复文档严重**                                                                                                                                                         | design/, prd/, architecture/ | 约30个    |
|          | 问题详情：<br>- AI Office 重构文档散布在3个目录<br>- Topic Research 有4个相似设计文档<br>- AI Slides 优化方案有3个版本                                                   |                              |           |
| **P1-3** | **缺少版本管理**                                                                                                                                                         | prd/                         | 49个      |
|          | 问题详情：<br>- PRD 版本号混乱（v1.0, v2.0, v3.1 混在一起）<br>- 没有明确的"当前版本"和"归档版本"区分<br>- 旧版本未移至 archive/                                         |                              |           |
| **P1-4** | **术语不一致**                                                                                                                                                           | 全局                         | 多处      |
|          | 问题详情：<br>- "data-management" vs "ingestion" vs "data-collection"<br>- "AI Office" vs "AI Studio" 边界模糊<br>- "Topic Research" vs "Insight Hub" vs "Deep Research" |                              |           |

#### P2 - 改进问题（影响体验）

| 问题ID   | 问题描述                                                                                       | 影响范围      | 文件数 |
| -------- | ---------------------------------------------------------------------------------------------- | ------------- | ------ |
| **P2-1** | **文档更新不及时**                                                                             | 多个核心文档  | 约20个 |
|          | 问题详情：<br>- api/readme.md 最后更新 2025-11-15（2个月未更新）<br>- 部分功能文档与代码不同步 |               |        |
| **P2-2** | **缺少文档索引**                                                                               | prd/, design/ | -      |
|          | 问题详情：<br>- prd/ 有 readme.md 但信息过时<br>- design/ 无索引文档<br>- archive/ 无归档说明  |               |        |
| **P2-3** | **交叉引用失效**                                                                               | 全局          | 未统计 |
|          | 问题详情：文档间的链接可能因重命名/移动而失效                                                  |               |        |

### 2.2 核心文档识别

#### 必须保留的核心文档（按重要性排序）

```markdown
🟢 Tier 1 - 关键文档（绝对不能删除）
├── readme.md # 总导航
├── guides/development.md # 开发指南
├── guides/deployment.md # 部署指南
├── guides/automated-development-loop.md # TDD 工作流
├── guides/ai-calling-standards.md # AI 调用规范
├── api/readme.md # API 完整参考
├── architecture/overview.md # 架构总览
├── architecture/ai-context.md # AI 架构
├── prd/readme.md # PRD 索引（需更新）
└── tech-stack/README.md # 技术栈说明

🟡 Tier 2 - 重要文档（核心功能文档）
├── prd/core/deepdive-engine-prd-v2.0.md # 核心 PRD
├── prd/ai-studio/ai-studio-prd-v4.0.md # AI Studio（最新）
├── prd/topic-research/topic-research-prd-v1.0.md# Topic Research
├── prd/ai-writing-v3-user-first.md # AI Writing v3
├── features/ai-office/product-spec.md # AI Office 产品规格
├── features/ai-office/system-design.md # AI Office 系统设计
├── features/ai-coding/ai-coding-overview.md # AI Coding 概览
├── design/topic-research/technical-design.md # Topic Research 技术设计
└── architecture/ai-engine-target-architecture.md# AI Engine 目标架构

🔵 Tier 3 - 参考文档（保留但可合并）
├── design/ai-reports-optimization/_ # AI 报告优化设计（6个）
├── testing/test-coverage-analysis.md # 测试覆盖分析
├── decisions/_ # 架构决策记录（6个）
└── ai-trends/\* # AI 趋势研究（11个）
```

### 2.3 可删除/归档文件建议

#### 建议删除（完全重复或无价值）

```markdown
❌ 建议直接删除（5个文件）
├── improvement/ai-writing-improvement-plan.md # 已合并到 prd/ai-writing-v3
├── product-reviews/knowledge-graph-design-review.md # 单一评审记录，无持续价值
├── operations/feature-announcement-workflow.md # 流程文档应在项目根目录或 .github/
└── tasks/P2-C02-character-personality-completion-summary.md # 单一任务记录

理由：这些文档要么内容已被更新版本包含，要么属于临时性文档
```

#### 建议归档到 `archive/2025-q1/`

```markdown
📦 建议归档（约40个文件）

archive/2025-q1/deprecated/ (已废弃的重构计划)
├── architecture/ai-office-refactor-prd.md # 已有新版本
├── architecture/ai-office-agent-refactor-plan.md
├── design/topic-research-refactor.md # 被 v7 版本替代
├── design/topic-research-optimization-plan.md
├── prd/ai-writing-v2.md # 已升级到 v3
└── prd/ai-slides/ai-slides-genspark-gap-closure.md # 被 v3.1 替代

archive/2025-q1/reports/ (项目报告)
├── project-reports/product-improvement-plan-2025-12.md
├── project-reports/project-comprehensive-evaluation-2025-12.md
├── project-reports/test-supplementation-plan-2025-12.md
└── testing/ai-teams-agent-tools-test-report.md

archive/2025-q1/implementations/ (实施记录)
├── implementation/google-drive-frontend-integration.md
├── implementation/google-drive-hooks-examples.md
├── implementation/google-drive-implementation-plan.md
├── implementation/ai-simulation-improvements-2025-12-06.md
└── implementation/auto-fix-github-integration.md

archive/data-management-legacy/ (数据管理遗留文档)
├── data-management/policy-category-setup.md # 已过时
├── data-management/ui-redesign-report.md # 实施完成
├── data-management/ui-redesign-summary.md
├── data-management/ui-fixes-summary.md
├── data-management/completion-summary.md
└── data-management/run-error-fix.md
```

#### 需要合并的文档组

```markdown
🔗 建议合并（15组，约30个文件）

1. AI Office 重构系列 → 保留最新版，归档其余
   - architecture/ai-office-refactor-prd.md
   - architecture/ai-office-agent-refactor-plan.md
   - features/ai-office/ai-office-3.0-refactor-plan.md
     → 建议：features/ai-office/refactor-plan-v3.0.md（归档旧版）

2. Topic Research 设计系列 → 保留 v7
   - design/topic-research-ui-redesign.md
   - design/topic-research-redesign-v7.md
   - design/topic-research-optimization-plan.md
   - design/topic-research-refactor.md
     → 建议：保留 design/topic-research-redesign-v7.md（归档其余）

3. AI Slides 优化系列 → 保留 v3.1
   - prd/ai-slides/ai-slides-v3-optimization-plan.md
   - prd/ai-slides/ai-slides-v3.1-visual-upgrade.md
   - prd/ai-slides/ai-slides-genspark-gap-closure.md
     → 建议：保留 v3.1（归档其余）

4. Data Management → 迁移到 features/data-collection/
   - data-management/\* (14个文件)
     → 建议：
     - architecture.md → features/data-collection/architecture.md
     - data-model.md → features/data-collection/data-model.md
     - data-management-quick-guide.md → features/data-collection/quick-guide.md
     - 其余归档

5. AI Engine 迁移文档 → 合并为单一路线图
   - ai-engine/migration/ai-studio-refactor-plan.md
   - ai-engine/capability-sink-plan.md
   - design/ai-engine-migration-todo.md
     → 建议：合并为 architecture/ai-engine-migration-roadmap.md
```

---

## 🎯 第三阶段：清理方案

### 3.1 建议的新目录结构（v3.0）

```
docs/
├── readme.md                          # 📍 总导航（唯一根文件）
│
├── api/                               # 🔌 API 文档
│   └── readme.md                      # API 完整参考
│
├── architecture/                      # 🏗️ 系统架构
│   ├── overview.md                    # 架构总览
│   ├── ai-context.md                  # AI 功能架构
│   ├── ai-engine-target-architecture.md # AI Engine 目标架构
│   ├── ai-teams-architecture-improvement-plan.md
│   ├── database-migration-refactor-plan.md
│   ├── migration-workflow.md
│   └── improvements-summary.md        # 架构改进总结
│
├── guides/                            # 📖 开发指南
│   ├── development.md                 # 开发指南
│   ├── deployment.md                  # 部署指南
│   ├── testing.md                     # 测试指南
│   ├── automated-development-loop.md  # TDD 工作流
│   ├── ai-calling-standards.md        # AI 调用规范
│   ├── claude-skills-guide.md         # Claude Skills 使用指南
│   ├── claude-skills-ecosystem.md     # Claude Skills 生态
│   ├── service-management.md          # 服务管理
│   ├── team-collaboration.md          # 团队协作
│   │
│   ├── authentication/                # 认证配置
│   │   └── google-oauth-setup.md
│   │
│   └── deployment/                    # 部署配置
│       ├── deployment-guide.md
│       └── railway-env-config.md
│
├── features/                          # ✨ 功能模块文档
│   ├── data-collection/               # 数据采集（合并 data-management/）
│   │   ├── readme.md                  # 功能索引
│   │   ├── architecture.md            # ← 从 data-management/
│   │   ├── data-model.md              # ← 从 data-management/
│   │   ├── quick-guide.md             # ← 从 data-management/
│   │   ├── validation.md              # ← 从 data-management/
│   │   └── blog-collection-system.md  # 博客采集
│   │
│   ├── ai-writing/                    # AI Writing（新增）
│   │   └── architecture.md
│   │
│   ├── topic-research/                # Topic Research（新增）
│   │   └── readme.md                  # 链接到 design/ 和 prd/
│   │
│   ├── ai-office/                     # AI Office（保留17个核心文档）
│   │   ├── readme.md
│   │   ├── product-spec.md
│   │   ├── system-design.md
│   │   └── ...（其他14个文档）
│   │
│   ├── ai-coding/                     # AI Coding
│   │   ├── ai-coding-overview.md
│   │   ├── kanban-feature.md
│   │   └── websocket-api.md
│   │
│   ├── ai-agents/                     # AI Agents
│   ├── ai-studio/                     # AI Studio
│   ├── ai-teams/                      # AI Teams
│   ├── image-generator/               # 图像生成
│   ├── workspace-reporting/           # 工作区报告
│   └── reports.md                     # 报告功能总览
│
├── prd/                               # 📋 产品需求文档
│   ├── readme.md                      # PRD 索引（更新版）
│   │
│   ├── current/                       # 当前版本（新建）
│   │   ├── core/                      # 核心系统
│   │   │   ├── deepdive-engine-prd-v2.0.md
│   │   │   ├── credits-system-prd-v1.0.md
│   │   │   └── ...
│   │   ├── ai-studio/
│   │   │   └── ai-studio-prd-v4.0.md  # 最新版本
│   │   ├── ai-office/
│   │   │   └── ai-office-prd-v2.0.md
│   │   ├── ai-writing/
│   │   │   └── ai-writing-v3-user-first.md # 最新版本
│   │   ├── topic-research/
│   │   │   └── topic-research-prd-v1.0.md
│   │   └── ...（其他模块最新 PRD）
│   │
│   └── archive/                       # 历史版本（扩展）
│       ├── ai-writing-v2.md           # ← 从 prd/ 根目录移入
│       ├── ai-studio-prd-v3.0-archived.md
│       ├── ai-studio-prd-v3.1-archived.md
│       └── ...
│
├── design/                            # 🎨 设计文档
│   ├── readme.md                      # 设计文档索引（新建）
│   │
│   ├── topic-research/                # Topic Research 设计
│   │   ├── README.md
│   │   ├── technical-design.md
│   │   ├── frontend-design.md
│   │   ├── api-design.md
│   │   └── prompt-templates.md
│   │
│   ├── ai-reports-optimization/       # AI 报告优化
│   │   ├── readme.md
│   │   ├── design-overview.md
│   │   ├── implementation-roadmap.md
│   │   └── ...（共6个文件）
│   │
│   ├── ai-engine-target-architecture.md # ← 从 design/ 根目录
│   ├── ai-agent-capabilities-management-design.md
│   ├── ai-coding-enhancement-design.md
│   ├── ai-writing-quality-improvement-plan.md
│   ├── unified-blog-format-design.md
│   └── ...（其他设计文档）
│
├── decisions/                         # 🧭 架构决策记录（ADR）
│   ├── ai-summary-restructuring.md
│   ├── file-naming-update.md
│   ├── implementation-summary.md
│   ├── library-page-crud-fix.md
│   ├── reorganization-complete.md
│   └── reorganization-plan.md
│
├── tech-stack/                        # 🛠️ 技术栈文档
│   ├── README.md
│   ├── ai-llm/
│   ├── backend/
│   ├── data-collection/
│   ├── database/
│   ├── frontend/
│   └── realtime/
│
├── testing/                           # 🧪 测试文档
│   └── test-coverage-analysis.md
│
├── releases/                          # 📦 版本发布
│   └── v1.1.0-release-notes.md
│
├── ai-trends/                         # 🔬 AI 趋势研究
│   ├── README.md
│   ├── agentic-ai/
│   ├── agi/
│   ├── ai-medicine/
│   └── ...（共11个文件）
│
├── ai-teams/                          # 🤖 AI Teams 架构（最新）
│   ├── README.md
│   ├── code-review-report.md
│   └── gap-analysis.md
│
└── archive/                           # 📦 历史归档
    ├── readme.md                      # 归档说明（新建）
    │
    ├── 2024-q4/                       # 2024 Q4
    │   └── weekly-reports/
    │       ├── week1-implementation.md
    │       ├── week2-implementation.md
    │       ├── week3-comments.md
    │       └── week4-integration.md
    │
    ├── 2025-q1/                       # 2025 Q1
    │   ├── planning/                  # 规划文档
    │   │   ├── optimization-plan.md
    │   │   └── ui-optimization-plan.md
    │   │
    │   ├── execution-logs/            # 执行日志
    │   │   └── hardening-execution.md
    │   │
    │   ├── summaries/                 # 总结报告
    │   │   └── hardening-summary.md
    │   │
    │   ├── issues/                    # 问题记录
    │   │   ├── backend-test-issues.md
    │   │   └── testing-issues.md
    │   │
    │   ├── audits/                    # 审计报告
    │   │   ├── ux-usability-audit.md
    │   │   ├── file-naming-audit-report.md
    │   │   └── file-naming-fix-guide.md
    │   │
    │   ├── reports/                   # 项目报告（新增）
    │   │   ├── product-improvement-plan-2025-12.md
    │   │   ├── project-comprehensive-evaluation-2025-12.md
    │   │   ├── test-supplementation-plan-2025-12.md
    │   │   ├── docs-optimization-summary.md
    │   │   └── docs-reorganization-plan.md
    │   │
    │   ├── implementations/           # 实施记录（新增）
    │   │   ├── google-drive-*.md (3个)
    │   │   ├── ai-simulation-improvements-*.md (2个)
    │   │   └── auto-fix-github-integration.md
    │   │
    │   └── deprecated/                # 已废弃文档
    │       ├── ai-office-multi-model.md
    │       ├── fixes.md
    │       ├── implementation-status.md
    │       ├── implementation-summary.md
    │       ├── quick-start-structured-summary.md
    │       ├── todo.md
    │       └── verification.md
    │
    └── data-management-legacy/        # 数据管理遗留文档
        ├── readme.md                   # 说明此目录为历史文档
        ├── policy-category-setup.md
        ├── ui-redesign-report.md
        ├── ui-redesign-summary.md
        ├── ui-fixes-summary.md
        ├── completion-summary.md
        └── run-error-fix.md
```

### 3.2 目录职责定义（更新版）

| 目录              | 职责           | 文档类型        | 活跃度    | 预计文件数 |
| ----------------- | -------------- | --------------- | --------- | ---------- |
| **api/**          | API 接口文档   | 技术参考        | 🟢 活跃   | 2-3        |
| **architecture/** | 系统架构设计   | 技术设计        | 🟢 活跃   | 8-10       |
| **guides/**       | 操作指南、教程 | 操作手册        | 🟢 活跃   | 10-12      |
| **features/**     | 功能模块文档   | 功能说明        | 🟢 活跃   | 40-50      |
| **prd/**          | 产品需求文档   | 产品规格        | 🟡 准活跃 | 60-70      |
| **design/**       | 详细设计文档   | 设计文档        | 🟡 准活跃 | 20-25      |
| **decisions/**    | 架构决策记录   | 决策记录（ADR） | 🟡 准活跃 | 6-10       |
| **tech-stack/**   | 技术栈说明     | 技术参考        | 🟢 活跃   | 11-15      |
| **testing/**      | 测试文档       | 测试指南        | 🟢 活跃   | 2-5        |
| **releases/**     | 版本发布说明   | 发布文档        | 🟡 准活跃 | 5-10       |
| **ai-trends/**    | AI 趋势研究    | 研究资料        | 🟡 准活跃 | 11         |
| **ai-teams/**     | AI Teams 文档  | 架构文档        | 🟢 活跃   | 3-5        |
| **archive/**      | 历史归档       | 所有过期类型    | 🔴 归档   | 100+       |

### 3.3 需要删除的文件列表（5个）

```bash
# 直接删除（无价值或已合并）
docs/improvement/ai-writing-improvement-plan.md              # 已合并到 prd/ai-writing-v3
docs/product-reviews/knowledge-graph-design-review.md        # 单一评审，无持续价值
docs/operations/feature-announcement-workflow.md             # 应在项目根目录
docs/tasks/P2-C02-character-personality-completion-summary.md # 单一任务记录

# 删除空目录
docs/improvement/
docs/product-reviews/
docs/operations/
docs/tasks/
```

### 3.4 需要合并的文件列表（15组）

```markdown
### 合并组 1: AI Office 重构计划

目标文件: features/ai-office/refactor-plan-v3.0.md
源文件（合并后归档）:

- architecture/ai-office-refactor-prd.md
- architecture/ai-office-agent-refactor-plan.md
- features/ai-office/ai-office-3.0-refactor-plan.md

### 合并组 2: Topic Research 设计

目标文件: design/topic-research-redesign-v7.md（保留）
归档文件:

- design/topic-research-ui-redesign.md
- design/topic-research-optimization-plan.md
- design/topic-research-refactor.md

### 合并组 3: AI Slides 优化

目标文件: prd/current/ai-slides/ai-slides-v3.1-visual-upgrade.md
归档文件:

- prd/ai-slides/ai-slides-v3-optimization-plan.md
- prd/ai-slides/ai-slides-genspark-gap-closure.md

### 合并组 4: AI Engine 迁移

目标文件: architecture/ai-engine-migration-roadmap.md（新建）
源文件（合并后归档）:

- ai-engine/migration/ai-studio-refactor-plan.md
- ai-engine/capability-sink-plan.md
- design/ai-engine-migration-todo.md

### 合并组 5: Google Drive 实施

目标文件: archive/2025-q1/implementations/google-drive-integration.md（新建）
源文件（合并）:

- implementation/google-drive-frontend-integration.md
- implementation/google-drive-hooks-examples.md
- implementation/google-drive-implementation-plan.md

（其余10组见详细执行脚本）
```

### 3.5 需要更新的文件列表（核心文档）

```markdown
### 高优先级更新（P0）

1. docs/readme.md
   - 更新文档结构说明（反映 v3.0 结构）
   - 更新所有内部链接
   - 添加新目录说明
   - 更新最后修改时间

2. docs/prd/readme.md
   - 更新为 v3.0 结构
   - 明确"当前版本"和"归档版本"
   - 添加模块状态表（更新到2026-01-15）
   - 补充缺失的模块 PRD 链接

3. docs/api/readme.md
   - 验证所有 API 端点是否与代码一致
   - 补充新增的 API（2025-11-15后）
   - 更新示例代码
   - 添加最后验证日期

4. docs/architecture/overview.md
   - 更新模块划分图（反映最新模块）
   - 补充 AI Writing、Topic Research 等新模块
   - 更新技术栈版本号
   - 更新最后修改时间

### 中优先级更新（P1）

5. docs/guides/development.md
   - 更新文档引用路径
   - 添加新功能模块的开发指南链接

6. docs/features/\*/readme.md
   - 为每个功能模块添加 readme.md
   - 统一索引格式
   - 链接到相关 PRD 和设计文档

7. docs/design/readme.md（新建）
   - 创建设计文档索引
   - 按模块分类设计文档

8. docs/archive/readme.md（新建）
   - 说明归档规则
   - 按时间和类型组织说明
```

---

## 📋 第四阶段：文档管理规范建议

### 4.1 命名规范（强制执行）

**文件命名规则**:

```bash
# ✅ 正确示例
docs/readme.md
docs/architecture/overview.md
docs/api/readme.md
docs/guides/deployment-guide.md
docs/features/ai-office/product-spec.md
docs/prd/current/ai-studio/ai-studio-prd-v4.0.md

# ❌ 错误示例
docs/readme.md                    # 不使用大写
docs/Architecture/Overview.md     # 目录和文件都不应大写
docs/API/README.MD                # 扩展名也应小写
docs/guides/Deployment_Guide.md   # 不使用下划线，使用连字符
docs/features/AI Office/产品方案.md # 避免空格和中文文件名
```

**规则总结**:

- 全部小写字母
- 使用连字符 `-` 分隔单词（kebab-case）
- 禁止使用下划线 `_`、空格、中文字符
- 文件扩展名也使用小写 `.md`
- 唯一例外：项目根目录的 `README.md`, `LICENSE`, `CHANGELOG.md`

**验证脚本**:

```bash
#!/bin/bash
# 文件名: scripts/validate-docs-naming.sh

echo "检查文档命名规范..."

# 查找不符合规范的文件（排除归档目录）
find docs -name "*.md" \
  ! -path "docs/archive/*" \
  ! -name "readme.md" \
  | grep -E "[A-Z_]|[ ]" > /tmp/naming-violations.txt

if [ -s /tmp/naming-violations.txt ]; then
  echo "❌ 发现命名违规文件："
  cat /tmp/naming-violations.txt
  exit 1
else
  echo "✅ 所有文档命名符合规范"
  exit 0
fi
```

### 4.2 版本管理规则

#### PRD 版本管理

````markdown
规则 1: 版本号格式

- 使用语义化版本号: v[主版本].[次版本] (如 v1.0, v2.1, v4.0)
- 文件名格式: [module]-prd-v[version].md
- 示例: ai-studio-prd-v4.0.md

规则 2: 当前版本 vs 归档版本

- 当前版本: 存放在 prd/current/[module]/
- 归档版本: 存放在 prd/archive/
- 每个模块只保留一个当前版本

规则 3: 版本升级流程

1. 创建新版本文件: prd/current/[module]/[module]-prd-v[new].md
2. 移动旧版本: prd/archive/[module]-prd-v[old]-archived.md
3. 在文件头部添加归档说明:
   ```markdown
   > **⚠️ 已归档**
   > 此文档已被 [v[new]](../current/[module]/[module]-prd-v[new].md) 替代
   > 归档日期: YYYY-MM-DD
   ```
4. 更新 prd/readme.md 索引

规则 4: 次版本更新（小改动）

- 不创建新文件，直接在当前版本基础上修改
- 更新文件头部的"最后更新"日期
- 在文档末尾添加"变更历史"章节
````

#### 设计文档版本管理

```markdown
规则 1: 设计文档命名

- 主设计文档: [module]-design.md 或 [feature]-design.md
- 迭代版本: [module]-redesign-v[number].md
- 示例: topic-research-redesign-v7.md

规则 2: 保留策略

- 只保留最新版本在 design/ 目录
- 旧版本移至 archive/designs/[year]/

规则 3: 大型设计文档分组

- 使用子目录: design/[module]/
- 包含 readme.md 作为索引
- 示例: design/topic-research/README.md
```

### 4.3 文档更新规则

#### 更新频率要求

| 文档类型     | 更新频率      | 触发条件           | 责任人     |
| ------------ | ------------- | ------------------ | ---------- |
| **API 文档** | 每次 API 变更 | 新增/修改/删除端点 | 后端开发者 |
| **架构文档** | 季度审查      | 重大架构变更       | 架构师     |
| **开发指南** | 月度审查      | 流程变更、工具更新 | 技术负责人 |
| **PRD**      | 版本发布前    | 产品需求变更       | 产品经理   |
| **功能文档** | 功能上线时    | 新功能发布         | 功能负责人 |
| **测试文档** | 季度审查      | 测试策略变更       | QA 负责人  |

#### 文档头部元信息格式

```markdown
# 文档标题

> **文档类型**: PRD | 架构设计 | 开发指南 | API 文档
> **创建日期**: YYYY-MM-DD
> **最后更新**: YYYY-MM-DD
> **当前版本**: v[版本号]
> **维护者**: [姓名/团队]
> **状态**: 草稿 | 审查中 | 已发布 | 已归档

**变更历史**:

- v1.1 (2026-01-15): 添加 XXX 功能说明
- v1.0 (2025-12-01): 初始版本

---

## 概述

[文档正文开始...]
```

### 4.4 归档规则

#### 归档触发条件

```markdown
自动归档（无需审批）:
✅ 文档超过6个月未更新（非核心文档）
✅ PRD/设计文档已有新版本
✅ 临时性任务/问题记录（如 tasks/, issues/）
✅ 周报、月报等时间性文档

人工审批归档（需团队讨论）:
⚠️ 核心架构文档
⚠️ 开发指南类文档
⚠️ API 文档
```

#### 归档目录结构

```
archive/
├── readme.md                      # 归档说明
├── [YEAR]-q[QUARTER]/             # 按季度组织
│   ├── planning/                  # 规划文档
│   ├── execution-logs/            # 执行日志
│   ├── summaries/                 # 总结报告
│   ├── issues/                    # 问题记录
│   ├── audits/                    # 审计报告
│   ├── reports/                   # 项目报告
│   ├── implementations/           # 实施记录
│   └── deprecated/                # 已废弃文档
└── [module]-legacy/               # 模块遗留文档
```

#### 归档文件处理

```markdown
步骤 1: 在原文件头部添加归档标记

> **⚠️ 已归档**
> 此文档已移至 archive/[path]
> 归档原因: [版本升级 | 功能已废弃 | 文档过期]
> 归档日期: YYYY-MM-DD
> 替代文档: [链接]（如果有）

步骤 2: 使用 git mv 移动文件
git mv docs/[old-path] docs/archive/[year]-q[quarter]/[type]/[file]

步骤 3: 在归档目录添加 readme.md
说明归档文件的背景和查找方法

步骤 4: 更新主文档中的链接
将指向归档文件的链接更新为新文档或移除
```

### 4.5 文档质量检查清单

#### 创建新文档时

- [ ] 文件名符合 kebab-case 规范
- [ ] 放置在正确的目录中
- [ ] 包含完整的元信息头部
- [ ] 链接使用相对路径
- [ ] Markdown 语法正确
- [ ] 代码示例可执行（如适用）

#### 更新文档时

- [ ] 更新"最后更新"日期
- [ ] 在"变更历史"中记录修改
- [ ] 验证所有内部链接有效
- [ ] 检查与代码实现一致性
- [ ] 更新相关文档的交叉引用

#### 归档文档时

- [ ] 添加归档标记
- [ ] 使用 git mv 保留历史
- [ ] 更新索引文档
- [ ] 验证替代文档链接
- [ ] 清理失效的交叉引用

### 4.6 自动化工具建议

#### 文档验证 CI Pipeline

```yaml
# .github/workflows/docs-validation.yml
name: Docs Validation

on:
  pull_request:
    paths:
      - "docs/**"

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Check naming conventions
        run: ./scripts/validate-docs-naming.sh

      - name: Check broken links
        uses: gaurav-nelson/github-action-markdown-link-check@v1
        with:
          folder-path: "docs/"

      - name: Validate metadata
        run: ./scripts/validate-docs-metadata.sh

      - name: Check outdated docs
        run: ./scripts/check-outdated-docs.sh
```

#### 定期审查脚本

```bash
#!/bin/bash
# 文件名: scripts/check-outdated-docs.sh
# 功能: 检查超过6个月未更新的非核心文档

CUTOFF_DATE=$(date -d '6 months ago' +%Y-%m-%d)

find docs -name "*.md" \
  ! -path "docs/archive/*" \
  ! -path "docs/api/*" \
  ! -path "docs/architecture/*" \
  ! -path "docs/guides/*" \
  -type f -printf '%T+ %p\n' \
  | while read date file; do
      if [[ "$date" < "$CUTOFF_DATE" ]]; then
        echo "⚠️  $file (最后修改: ${date:0:10})"
      fi
    done
```

---

## 🛠️ 执行计划

### 阶段 1: 紧急清理（本周完成）

**目标**: 解决 P0 问题，快速提升文档可用性

#### 任务 1.1: 清理过期文档（2小时）

```bash
# 执行脚本: scripts/phase1-archive-outdated.sh

# 1. 归档2024年文档
git mv docs/data-management/data-management-quick-guide.md \
       docs/archive/data-management-legacy/

git mv docs/design/ai-reports-optimization/readme.md \
       docs/archive/2025-q1/deprecated/

git mv docs/decisions/ai-summary-restructuring.md \
       docs/archive/2025-q1/deprecated/

# 2. 归档项目报告
mkdir -p docs/archive/2025-q1/reports
git mv docs/project-reports/* docs/archive/2025-q1/reports/

# 3. 归档实施记录
mkdir -p docs/archive/2025-q1/implementations
git mv docs/implementation/* docs/archive/2025-q1/implementations/

# 4. 删除无价值文档
git rm docs/improvement/ai-writing-improvement-plan.md
git rm docs/product-reviews/knowledge-graph-design-review.md
git rm docs/operations/feature-announcement-workflow.md
git rm docs/tasks/P2-C02-character-personality-completion-summary.md

# 5. 删除空目录
rmdir docs/improvement docs/product-reviews docs/operations docs/tasks
```

**验证**:

```bash
# 应该减少约 45 个活跃文件
find docs -name "*.md" ! -path "docs/archive/*" | wc -l
# 期望结果: 约 222 个（267 - 45）
```

#### 任务 1.2: 修正命名违规（3小时）

```bash
# 执行脚本: scripts/phase1-fix-naming.sh
# 注意：此脚本会修改大量文件，建议分批执行

# 示例（完整列表见附录）
git mv docs/prd/ai-studio/noble-sleeping-flurry.md \
       docs/prd/ai-studio/collaboration-timeline-redesign-alternative.md
```

**验证**:

```bash
./scripts/validate-docs-naming.sh
# 期望结果: ✅ 所有文档命名符合规范
```

#### 任务 1.3: 更新核心文档（2小时）

- 更新 `docs/readme.md` - 反映最新目录结构
- 更新 `docs/prd/readme.md` - 添加模块状态
- 更新 `docs/api/readme.md` - 验证 API 一致性

### 阶段 2: 结构优化（下周完成）

**目标**: 重组分类体系，合并重复文档

#### 任务 2.1: 重组 data-management（1小时）

```bash
# 执行脚本: scripts/phase2-reorganize-data-management.sh

mkdir -p docs/features/data-collection

# 移动核心文档
git mv docs/data-management/architecture.md \
       docs/features/data-collection/architecture.md
git mv docs/data-management/data-model.md \
       docs/features/data-collection/data-model.md
git mv docs/data-management/data-management-quick-guide.md \
       docs/features/data-collection/quick-guide.md

# 归档其余文档
mkdir -p docs/archive/data-management-legacy
git mv docs/data-management/* docs/archive/data-management-legacy/
rmdir docs/data-management
```

#### 任务 2.2: 合并重复文档（3小时）

按照 3.4 节的合并组列表执行（15组）

#### 任务 2.3: 优化 PRD 目录（2小时）

```bash
# 执行脚本: scripts/phase2-optimize-prd.sh

# 创建 current/ 和 archive/ 子目录
mkdir -p docs/prd/current/{core,ai-studio,ai-office,ai-writing,topic-research}
mkdir -p docs/prd/archive

# 移动当前版本到 current/
git mv docs/prd/ai-studio/ai-studio-prd-v4.0.md \
       docs/prd/current/ai-studio/

# 移动旧版本到 archive/
git mv docs/prd/ai-writing-v2.md \
       docs/prd/archive/ai-writing-prd-v2.0-archived.md
```

### 阶段 3: 完善补充（两周内）

**目标**: 补充缺失文档，建立自动化验证

#### 任务 3.1: 创建缺失的索引文档（2小时）

- [ ] `docs/design/readme.md` - 设计文档索引
- [ ] `docs/archive/readme.md` - 归档说明
- [ ] `docs/features/*/readme.md` - 为每个模块创建索引

#### 任务 3.2: 验证代码一致性（4小时）

逐个检查功能文档与代码实现的一致性，更新过时说明

#### 任务 3.3: 建立自动化检查（3小时）

- 创建 GitHub Actions workflow
- 编写验证脚本（命名、链接、元数据）
- 配置定期审查提醒

---

## 📊 预期效果

### 清理前 vs 清理后对比

| 指标                   | 清理前     | 清理后        | 改进幅度 |
| ---------------------- | ---------- | ------------- | -------- |
| **文档总数**           | 267        | 约 180-200    | ↓ 25-33% |
| **活跃文档（非归档）** | 267        | 约 120-140    | ↓ 47-55% |
| **根目录文件数**       | 1 (已清理) | 1             | ✅ 保持  |
| **一级子目录数**       | 23         | 12-14         | ↓ 39-48% |
| **命名规范遵守率**     | 51%        | 100%          | ↑ 96%    |
| **重复文档组**         | 15组       | 0             | ↓ 100%   |
| **过期文档**           | 约50个     | 0（全部归档） | ↓ 100%   |
| **文档查找时间**       | 5-10分钟   | 1-2分钟       | ↓ 60-80% |

### 质量提升

**文档结构**:

- ✅ 清晰的三级分类：类型 → 模块 → 具体文档
- ✅ 统一的命名规范（kebab-case）
- ✅ 明确的版本管理（current/ vs archive/）

**可维护性**:

- ✅ 每个目录都有 readme.md 索引
- ✅ 文档元信息完整（日期、版本、维护者）
- ✅ 自动化验证防止回退

**可查找性**:

- ✅ 主 readme.md 提供多维度导航
- ✅ 按功能模块清晰分类
- ✅ 历史文档系统归档

---

## 🔗 附录

### A. 完整命名修正列表

（由于篇幅限制，此处仅列出部分示例，完整列表见单独文件）

```bash
# 需要重命名的文件（示例）
# 原文件名 → 新文件名

# prd/ 目录
prd/ai-studio/noble-sleeping-flurry.md
  → prd/ai-studio/collaboration-timeline-redesign-alternative.md

# 其他修正...
# （完整列表约 131 个文件，见 scripts/naming-fixes-list.txt）
```

### B. 合并脚本模板

```bash
#!/bin/bash
# 合并文档脚本模板

# 参数
SOURCE_FILES=("file1.md" "file2.md" "file3.md")
TARGET_FILE="merged.md"
ARCHIVE_DIR="docs/archive/2025-q1/deprecated"

# 创建目标文件
echo "# 合并文档" > "$TARGET_FILE"
echo "" >> "$TARGET_FILE"
echo "> 此文档合并自以下文件：" >> "$TARGET_FILE"

for file in "${SOURCE_FILES[@]}"; do
  echo "> - $file" >> "$TARGET_FILE"
done

echo "" >> "$TARGET_FILE"
echo "---" >> "$TARGET_FILE"
echo "" >> "$TARGET_FILE"

# 合并内容
for file in "${SOURCE_FILES[@]}"; do
  echo "## 来源: $file" >> "$TARGET_FILE"
  echo "" >> "$TARGET_FILE"
  tail -n +3 "$file" >> "$TARGET_FILE"  # 跳过原文件的前2行（标题）
  echo "" >> "$TARGET_FILE"
  echo "---" >> "$TARGET_FILE"
  echo "" >> "$TARGET_FILE"
done

# 归档原文件
mkdir -p "$ARCHIVE_DIR"
for file in "${SOURCE_FILES[@]}"; do
  git mv "$file" "$ARCHIVE_DIR/"
done

echo "✅ 合并完成: $TARGET_FILE"
```

### C. 文档类型检查脚本

```bash
#!/bin/bash
# 检查文档是否包含必需的元信息

find docs -name "*.md" ! -path "docs/archive/*" | while read file; do
  if ! grep -q "最后更新" "$file"; then
    echo "⚠️  缺少更新日期: $file"
  fi

  if ! grep -q "^# " "$file"; then
    echo "⚠️  缺少标题: $file"
  fi
done
```

### D. 相关资源

- [项目规则 v2.1](../project-rules.md) - 命名规范详细说明
- [文档命名审查报告](archive/2025-q1/reports/file-naming-audit-report.md) - 历史命名问题分析
- [文档重组方案 2025-11-22](archive/2025-q1/reports/docs-reorganization-plan.md) - 之前的重组计划

---

## ✅ 总结与建议

### 核心建议（优先级排序）

1. **立即执行**（P0）:
   - 归档所有2024年及更早的文档
   - 删除5个无价值文档
   - 修正所有命名违规（131个文件）
   - 更新3个核心文档（readme.md, prd/readme.md, api/readme.md）

2. **本周完成**（P1）:
   - 合并15组重复文档
   - 重组 data-management 目录
   - 优化 PRD 版本管理
   - 建立文档管理规范

3. **两周内**（P2）:
   - 补充缺失的索引文档
   - 验证代码一致性
   - 建立自动化检查
   - 配置 CI 验证流程

### 长期维护建议

- **每月审查**: 检查过期文档，及时归档
- **季度整理**: 审查文档结构，优化分类
- **版本发布时**: 更新相关 PRD 和功能文档
- **代码变更时**: 同步更新 API 和架构文档

### 风险提示

⚠️ **执行风险**:

- 大量文件移动可能导致 Git 历史复杂化（使用 `git mv` 可缓解）
- 文档链接失效风险（需要全面验证）
- 团队协作冲突（建议分支操作，合并前审查）

⚠️ **回滚方案**:

```bash
# 如果清理出现问题，可以回滚到清理前状态
git log --oneline -10  # 查看提交历史
git reset --hard <commit-before-cleanup>  # 回滚到清理前
```

---

**报告编写**: 文档专家 Agent
**报告日期**: 2026-01-15
**下次审查建议**: 2026-02-15（一个月后）
**联系方式**: 通过项目 Issue 反馈

---

**附件**:

- [ ] `scripts/phase1-archive-outdated.sh` - 阶段1归档脚本
- [ ] `scripts/phase1-fix-naming.sh` - 阶段1命名修正脚本
- [ ] `scripts/phase2-reorganize-data-management.sh` - 阶段2重组脚本
- [ ] `scripts/validate-docs-naming.sh` - 命名验证脚本
- [ ] `scripts/check-outdated-docs.sh` - 过期文档检查脚本
- [ ] `naming-fixes-list.txt` - 完整命名修正列表（131个文件）

**状态**: ✅ 分析完成，等待审批执行
