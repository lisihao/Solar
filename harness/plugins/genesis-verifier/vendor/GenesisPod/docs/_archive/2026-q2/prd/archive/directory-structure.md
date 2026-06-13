# PRD 文档目录结构说明

> **最后更新**: 2026-01-15

---

## 目录树 (目标结构)

```
docs/prd/
│
├── 📄 readme.md                          # 主索引（向后兼容导航）
├── 📄 prd-cleanup-plan.md                # 整理执行计划
├── 📄 prd-cleanup-report.md              # 整理完成报告
├── 📄 prd-renaming-map.md                # 重命名映射表
├── 📄 directory-structure.md             # 本文件（目录结构说明）
│
├── 📁 current/                           # 当前有效 PRD
│   ├── 📄 readme.md                      # 详细索引
│   │
│   ├── 📁 ai-apps/                       # AI 应用层
│   │   ├── 📁 ai-studio/                 # AI 研究工作台
│   │   │   ├── ai-studio-prd-v4.0.md
│   │   │   ├── ai-studio-plan-v3.1.md
│   │   │   └── ai-studio-tasks-v3.1.md
│   │   │
│   │   ├── 📁 ai-office/                 # 智能报告生成
│   │   │   ├── ai-office-prd-v2.0.md
│   │   │   └── ai-office-redesign-v5.0.md
│   │   │
│   │   ├── 📁 ai-slides/                 # 智能幻灯片
│   │   │   ├── ai-slides-v3.1-visual-upgrade.md
│   │   │   ├── slides-gap-analysis.md
│   │   │   └── slides-quality-issues-v1.md
│   │   │
│   │   ├── 📁 ai-coding/                 # AI 编程助手
│   │   │   ├── ai-coding-feature.md
│   │   │   ├── ai-coding-refactor-prd-v1.0.md
│   │   │   └── ai-coding-visualization-enhancement.md
│   │   │
│   │   ├── 📁 ai-ask/                    # 智能问答
│   │   │   └── ask-ai-session-management-v1.0.md
│   │   │
│   │   └── 📁 ai-writing/                # 智能写作
│   │       └── ai-writing-redesign.md
│   │
│   ├── 📁 ai-teams/                      # AI Teams 协作系统
│   │   ├── ai-teams-prd-v1.0.md
│   │   ├── ai-teams-spec-v2.0.md
│   │   ├── ai-teams-team-collaboration-v1.0.md
│   │   ├── ai-teams-content-parsing-v1.0.md
│   │   ├── ai-teams-optimization-v1.1.md
│   │   │
│   │   └── 📁 topic-research/            # 专题研究
│   │       ├── topic-research-prd-v1.0.md
│   │       ├── topic-research-ux-enhancement-v1.0.md
│   │       ├── ui-optimization.md
│   │       ├── report-editing.md
│   │       └── leader-interaction.md
│   │
│   └── 📁 infra/                         # 基础设施层
│       ├── 📁 core/                      # 核心系统
│       │   ├── deepdive-engine-prd-v2.0.md
│       │   ├── credits-system-prd-v1.0.md
│       │   ├── admin-storage-enhancement.md
│       │   ├── auto-feedback-resolution-v1.0.md
│       │   ├── youtube-subtitle-prd-v1.0.md
│       │   └── ai-strategic-simulation-prd.md
│       │
│       ├── 📁 knowledge-base/            # 知识库系统
│       │   ├── library-knowledge-base-system.md
│       │   ├── knowledge-base-enhancement-prd.md
│       │   ├── knowledge-base-data-sources-prd.md
│       │   └── knowledge-ux-improvements.md
│       │
│       ├── 📁 library/                   # 资源库
│       │   └── library-optimization-v2.md
│       │
│       ├── 📁 integrations/              # 第三方集成
│       │   ├── google-drive-rag-knowledge-base-v2.0.md
│       │   ├── notes-notion-integration-v1.0.md
│       │   └── google-drive-integration-v1.0.md
│       │
│       └── 📁 data-collection/           # 数据采集
│           ├── data-collection-prd-v3.0.md
│           └── data-collection-monitor-design-v1.0.md
│
└── 📁 archive/                           # 历史版本归档
    ├── 📄 readme.md                      # 归档索引
    │
    ├── 📁 ai-apps/
    │   ├── 📁 ai-studio/
    │   │   ├── ai-studio-prd-v3.0-archived.md
    │   │   ├── ai-studio-prd-v3.1-archived.md
    │   │   ├── noble-sleeping-flurry-archived.md
    │   │   ├── user-input-interaction-design-archived.md
    │   │   └── collaboration-timeline-redesign-archived.md
    │   │
    │   ├── 📁 ai-office/
    │   │   ├── ai-office-optimization-v2-archived.md
    │   │   └── ai-office-slides-upgrade-v1.0-archived.md
    │   │
    │   ├── 📁 ai-slides/
    │   │   ├── ai-slides-v3-optimization-plan-archived.md
    │   │   └── ai-slides-genspark-gap-closure-archived.md
    │   │
    │   └── 📁 ai-writing/
    │       ├── ai-writing-v2-archived.md
    │       ├── ai-writing-v3-user-first-archived.md
    │       └── chapter-review-import-archived.md
    │
    ├── 📁 ai-teams/
    │   └── ai-group-audit-v1.0-archived.md
    │
    └── 📁 infra/
        ├── 📁 core/
        │   ├── deepdive-prd-v2.0-archived.md
        │   └── resource-to-image-generation-archived.md
        │
        ├── 📁 data-collection/
        │   └── data-collection-design-v2.0-archived.md
        │
        └── 📁 integrations/
            └── google-drive-rag-knowledge-base-v1.0-archived.md
```

---

## 当前状态 vs 目标结构

### 当前状态 (实际文件位置)

```
docs/prd/
├── readme.md                             ✅ 已更新
├── prd-cleanup-plan.md                   ✅ 已创建
├── prd-cleanup-report.md                 ✅ 已创建
├── prd-renaming-map.md                   ✅ 已创建
├── directory-structure.md                ✅ 本文件
│
├── current/
│   └── readme.md                         ✅ 已创建
│
├── archive/
│   └── readme.md                         ✅ 已创建
│
├── ai-apps/                              ⏳ 待迁移到 current/ai-apps/
├── ai-teams/                             ⏳ 待迁移到 current/ai-teams/
└── infra/                                ⏳ 待迁移到 current/infra/
```

### 迁移状态

| 阶段   | 任务                    | 状态      |
| ------ | ----------------------- | --------- |
| 阶段 1 | 创建目录结构和索引      | ✅ 已完成 |
| 阶段 2 | 移动当前文档到 current/ | ⏳ 待执行 |
| 阶段 3 | 归档过期文档到 archive/ | ⏳ 待执行 |
| 阶段 4 | 验证链接和索引          | ⏳ 待执行 |
| 阶段 5 | 清理空目录              | ⏳ 待执行 |

---

## 分层架构说明

### AI 应用层 (AI Apps)

**定义**: 面向最终用户的 AI 应用产品

**模块**:

- AI Studio: AI 研究工作台
- AI Office: 智能报告生成
- AI Slides: 智能幻灯片
- AI Coding: AI 编程助手
- AI Ask: 智能问答
- AI Writing: 智能写作

**特点**:

- 独立的用户界面
- 完整的用户体验
- 调用底层 AI 能力

### AI 协作系统 (AI Teams)

**定义**: 多 Agent 协作的核心机制层

**模块**:

- AI Teams 核心: 团队管理、任务分配、协作机制
- Topic Research: 基于 AI Teams 的专题研究团队

**特点**:

- 提供协作框架
- 支持预定义团队和自定义团队
- 被 AI Apps 调用

### 基础设施层 (Infra)

**定义**: 支撑整个系统的基础服务

**模块**:

- Core: 核心系统（积分、反馈、模拟等）
- Knowledge Base: 知识库系统
- Library: 资源库
- Integrations: 第三方集成
- Data Collection: 数据采集

**特点**:

- 领域无关的通用能力
- 被所有上层模块调用
- 独立部署和维护

---

## 命名规范速查

### 文件命名格式

```
[模块]-[类型]-v[版本].md
```

**示例**:

- ✅ `ai-teams-prd-v1.0.md`
- ✅ `data-collection-monitor-design-v1.0.md`
- ✅ `topic-research-ux-enhancement-v1.0.md`

**禁止**:

- ❌ `AI-Teams-PRD-v1.0.md` (大写)
- ❌ `ai_teams_prd_v1.0.md` (下划线)
- ❌ `ai-teams-prd.md` (缺少版本号)
- ❌ `专题研究.md` (中文)

### 归档文件命名

```
[原文件名]-archived.md
```

**示例**:

- ✅ `ai-studio-prd-v3.0-archived.md`
- ✅ `ai-group-audit-v1.0-archived.md`

---

## 使用指南

### 查找当前 PRD

**方式 1: 通过主索引**

1. 访问 `docs/prd/readme.md`
2. 根据模块名称找到对应链接
3. 点击链接访问 PRD

**方式 2: 通过详细索引**

1. 访问 `docs/prd/current/readme.md`
2. 按分层架构浏览
3. 查看模块的主 PRD 和子文档

**方式 3: 直接访问**

```
docs/prd/current/[分类]/[模块]/[文件名].md
```

### 查找归档 PRD

1. 访问 `docs/prd/archive/readme.md`
2. 查看归档列表
3. 了解归档原因和日期
4. 访问归档文件

### 添加新 PRD

1. 确定模块归属 (AI Apps / AI Teams / Infra)
2. 在 `current/[分类]/[模块]/` 创建文件
3. 遵循命名规范
4. 更新 `current/readme.md` 索引
5. 提交 Git

### 归档旧 PRD

1. 移动到 `archive/[分类]/[模块]/`
2. 添加 `-archived` 后缀
3. 更新 `archive/readme.md` 索引
4. 在主索引中移除链接

---

## 常见问题 (FAQ)

### Q1: 为什么要分 current/ 和 archive/？

**A**: 分离当前有效版本和历史版本，避免：

- 版本混淆（不知道参考哪个版本）
- 目录混乱（历史文件占用主目录空间）
- 查找困难（过期文档干扰）

### Q2: AI Group 和 AI Teams 是什么关系？

**A**:

- **AI Group** 是早期文档中的称呼
- **AI Teams** 是代码中的实际模块名
- 已统一使用 **AI Teams** 术语
- 旧文件名保留，在索引中注明对应关系

### Q3: 为什么不直接重命名所有文件？

**A**:

- **风险高**: 一次性修改大量文件容易出错
- **影响大**: 破坏现有引用和链接
- **非紧急**: 当前通过索引即可解决问题
- **建议**: 分阶段逐步重命名

### Q4: 如何判断文档该放在哪个分类？

**A**:

- **AI Apps**: 面向用户的完整应用（有独立界面）
- **AI Teams**: 多 Agent 协作机制（框架层）
- **Infra**: 基础服务（被其他模块调用）

### Q5: 文档更新后是否需要重新归档？

**A**:

- **小更新**: 直接修改，递增版本号（如 v1.0 → v1.1）
- **大更新**: 移动旧版本到 archive/，创建新版本

---

## 相关链接

- [主索引](./readme.md)
- [当前 PRD 索引](./current/readme.md)
- [归档文档索引](./archive/readme.md)
- [整理计划](./prd-cleanup-plan.md)
- [整理报告](./prd-cleanup-report.md)
- [重命名映射](./prd-renaming-map.md)

---

**最后更新**: 2026-01-15
**维护者**: 文档专家 Agent
