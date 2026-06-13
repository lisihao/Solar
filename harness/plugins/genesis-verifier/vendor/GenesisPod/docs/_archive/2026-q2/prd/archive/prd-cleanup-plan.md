# PRD 文档整理计划

> **执行日期**: 2026-01-15
> **执行人**: 文档专家 Agent
> **目标**: 清理和整合 PRD 文档，建立清晰的文档组织结构

---

## 一、问题诊断

### 1.1 目录结构混乱

**问题**:

- 索引中记录的路径: `ai-studio/`, `ai-office/`, `ai-group/`
- 实际文件路径: `ai-apps/ai-studio/`, `ai-apps/ai-office/`, `ai-teams/`
- 缺少顶级分类: ai-apps, ai-teams, infra

**影响**:

- 开发者找不到对应的 PRD 文档
- 索引与实际不符，降低文档可信度

### 1.2 命名不一致

**问题**:

- 文档中称为 "AI Group"
- 代码中是 `ai-teams` 模块
- 实际功能是 "AI Teams 协作系统"

**影响**:

- 团队内部沟通术语不统一
- 新成员理解困难

### 1.3 版本管理混乱

**问题**:

- 多个版本文档并存 (v1.0, v2.0, v3.0, v3.1, v4.0)
- 无明确的"当前版本"标识
- 归档文档与有效文档混在一起

**影响**:

- 不知道该参考哪个版本
- 历史版本占用主目录空间

### 1.4 遗失模块

**发现**:

- `ai-writing` 模块有 4 个 PRD 文档，但索引中未提及
- `ai-studio` 有 3 个子文档 (noble-sleeping-flurry, user-input-interaction-design, collaboration-timeline-redesign) 未在索引中

---

## 二、整理策略

### 2.1 目录结构重组

**新结构**:

```
prd/
├── current/              # 当前有效 PRD
│   ├── ai-apps/          # AI 应用层
│   │   ├── ai-studio/
│   │   ├── ai-office/
│   │   ├── ai-slides/
│   │   ├── ai-coding/
│   │   ├── ai-ask/
│   │   └── ai-writing/   ← 新增
│   ├── ai-teams/         # AI Teams 协作系统
│   │   └── topic-research/
│   └── infra/            # 基础设施层
│       ├── core/
│       ├── knowledge-base/
│       ├── library/
│       ├── integrations/
│       └── data-collection/
├── archive/              # 历史版本归档
│   └── [同上结构]
└── readme.md             # 总索引
```

**原则**:

1. 按分层架构组织 (AI Apps, AI Teams, Infra)
2. current/ 只保留当前有效版本
3. archive/ 存放所有历史版本
4. readme.md 保持兼容性，指向 current/readme.md

### 2.2 命名统一规范

| 旧称        | 新称           | 说明                 |
| ----------- | -------------- | -------------------- |
| AI Group    | AI Teams       | 统一使用代码模块名称 |
| Insight Hub | Topic Research | 明确功能定位         |

### 2.3 版本管理规则

**当前版本 (current/)**:

- 每个模块仅保留一个主 PRD
- 主 PRD 文件名包含版本号 (如 `ai-studio-prd-v4.0.md`)
- 子文档 (plan, tasks, design) 可以有多个

**归档版本 (archive/)**:

- 所有被替代的版本
- 文件名添加 `-archived` 后缀
- 保留完整版本信息

---

## 三、执行计划

### 阶段 1: 创建新目录结构 ✅

- [x] 创建 `current/` 目录和子目录
- [x] 创建 `archive/` 目录和子目录
- [x] 创建 `current/readme.md` 索引
- [x] 创建 `archive/readme.md` 索引

### 阶段 2: 移动当前有效文档

#### AI Apps

**AI Studio**:

- [ ] 移动 `ai-apps/ai-studio/ai-studio-prd-v4.0.md` → `current/ai-apps/ai-studio/`
- [ ] 移动 `ai-apps/ai-studio/ai-studio-plan-v3.1.md` → `current/ai-apps/ai-studio/`
- [ ] 移动 `ai-apps/ai-studio/ai-studio-tasks-v3.1.md` → `current/ai-apps/ai-studio/`

**AI Office**:

- [ ] 移动 `ai-apps/ai-office/ai-office-prd-v2.0.md` → `current/ai-apps/ai-office/`
- [ ] 移动 `ai-apps/ai-office/ai-office-redesign-v5.0.md` → `current/ai-apps/ai-office/`

**AI Slides**:

- [ ] 移动 `ai-apps/ai-slides/ai-slides-v3.1-visual-upgrade.md` → `current/ai-apps/ai-slides/`
- [ ] 移动 `ai-apps/ai-slides/slides-gap-analysis.md` → `current/ai-apps/ai-slides/`
- [ ] 移动 `ai-apps/ai-slides/slides-quality-issues-v1.md` → `current/ai-apps/ai-slides/`

**AI Coding**:

- [ ] 移动 `ai-apps/ai-coding/ai-coding-feature.md` → `current/ai-apps/ai-coding/`
- [ ] 移动 `ai-apps/ai-coding/ai-coding-refactor-prd-v1.0.md` → `current/ai-apps/ai-coding/`
- [ ] 移动 `ai-apps/ai-coding/ai-coding-visualization-enhancement.md` → `current/ai-apps/ai-coding/`

**AI Ask**:

- [ ] 移动 `ai-apps/ai-ask/ask-ai-session-management-v1.0.md` → `current/ai-apps/ai-ask/`

**AI Writing**:

- [ ] 移动 `ai-apps/ai-writing/redesign.md` → `current/ai-apps/ai-writing/ai-writing-redesign.md`

#### AI Teams

**核心**:

- [ ] 创建 `current/ai-teams/ai-teams-prd-v1.0.md` (从 ai-group-prd-v1.0.md 重命名)
- [ ] 创建 `current/ai-teams/ai-teams-spec-v2.0.md` (从 ai-group-spec-v2.0.md 重命名)
- [ ] 创建 `current/ai-teams/ai-teams-team-collaboration-v1.0.md` (从 ai-group-team-collaboration-v1.0.md 重命名)
- [ ] 创建 `current/ai-teams/ai-teams-content-parsing-v1.0.md` (从 ai-group-content-parsing-v1.0.md 重命名)
- [ ] 创建 `current/ai-teams/ai-teams-optimization-v1.1.md` (从 ai-group-optimization-v1.1.md 重命名)

**Topic Research**:

- [ ] 移动 `ai-teams/topic-research/topic-research-prd-v1.0.md` → `current/ai-teams/topic-research/`
- [ ] 移动 `ai-teams/topic-research/topic-research-ux-enhancement-v1.0.md` → `current/ai-teams/topic-research/`
- [ ] 移动 `ai-teams/topic-research/ui-optimization.md` → `current/ai-teams/topic-research/`
- [ ] 移动 `ai-teams/topic-research/report-editing.md` → `current/ai-teams/topic-research/`
- [ ] 移动 `ai-teams/topic-research/leader-interaction.md` → `current/ai-teams/topic-research/`

#### Infra

**Core**:

- [ ] 移动 `infra/core/deepdive-engine-prd-v2.0.md` → `current/infra/core/`
- [ ] 移动 `infra/core/credits-system-prd-v1.0.md` → `current/infra/core/`
- [ ] 移动 `infra/core/admin-storage-enhancement.md` → `current/infra/core/`
- [ ] 移动 `infra/core/auto-feedback-resolution-v1.0.md` → `current/infra/core/`
- [ ] 移动 `infra/core/youtube-subtitle-prd-v1.0.md` → `current/infra/core/`
- [ ] 移动 `infra/core/ai-strategic-simulation-prd.md` → `current/infra/core/`

**Knowledge Base**:

- [ ] 移动 `infra/knowledge-base/library-knowledge-base-system.md` → `current/infra/knowledge-base/`
- [ ] 移动 `infra/knowledge-base/knowledge-base-enhancement-prd.md` → `current/infra/knowledge-base/`
- [ ] 移动 `infra/knowledge-base/knowledge-base-data-sources-prd.md` → `current/infra/knowledge-base/`
- [ ] 移动 `infra/knowledge-base/knowledge-ux-improvements.md` → `current/infra/knowledge-base/`

**Library**:

- [ ] 移动 `infra/library/library-optimization-v2.md` → `current/infra/library/`

**Integrations**:

- [ ] 移动 `infra/integrations/google-drive-rag-knowledge-base-v2.0.md` → `current/infra/integrations/`
- [ ] 移动 `infra/integrations/notes-notion-integration-v1.0.md` → `current/infra/integrations/`
- [ ] 移动 `infra/integrations/google-drive-integration-v1.0.md` → `current/infra/integrations/`

**Data Collection**:

- [ ] 移动 `infra/data-collection/data-collection-prd-v3.0.md` → `current/infra/data-collection/`
- [ ] 移动 `infra/data-collection/data-collection-monitor-design-v1.0.md` → `current/infra/data-collection/`

### 阶段 3: 归档过期文档

**需要归档的文档**:

#### AI Office

- [ ] `ai-apps/ai-office/ai-office-optimization-v2.md` → `archive/ai-apps/ai-office/ai-office-optimization-v2-archived.md`
- [ ] `ai-apps/ai-office/ai-office-slides-upgrade-v1.0.md` → `archive/ai-apps/ai-office/ai-office-slides-upgrade-v1.0-archived.md`

#### AI Slides

- [ ] `ai-apps/ai-slides/ai-slides-v3-optimization-plan.md` → `archive/ai-apps/ai-slides/ai-slides-v3-optimization-plan-archived.md`
- [ ] `ai-apps/ai-slides/ai-slides-genspark-gap-closure.md` → `archive/ai-apps/ai-slides/ai-slides-genspark-gap-closure-archived.md`

#### AI Teams

- [ ] `ai-teams/ai-group-audit-v1.0.md` → `archive/ai-teams/ai-group-audit-v1.0-archived.md`

#### AI Writing

- [ ] `ai-apps/ai-writing/v2.md` → `archive/ai-apps/ai-writing/ai-writing-v2-archived.md`
- [ ] `ai-apps/ai-writing/v3-user-first.md` → `archive/ai-apps/ai-writing/ai-writing-v3-user-first-archived.md`
- [ ] `ai-apps/ai-writing/chapter-review-import.md` → `archive/ai-apps/ai-writing/chapter-review-import-archived.md`

#### AI Studio

- [ ] `ai-apps/ai-studio/noble-sleeping-flurry.md` → `archive/ai-apps/ai-studio/noble-sleeping-flurry-archived.md`
- [ ] `ai-apps/ai-studio/user-input-interaction-design.md` → `archive/ai-apps/ai-studio/user-input-interaction-design-archived.md`
- [ ] `ai-apps/ai-studio/collaboration-timeline-redesign.md` → `archive/ai-apps/ai-studio/collaboration-timeline-redesign-archived.md`

#### Core

- [ ] `infra/core/resource-to-image-generation.md` → `archive/infra/core/resource-to-image-generation-archived.md`

### 阶段 4: 更新主索引

- [ ] 更新 `readme.md` 指向 `current/readme.md`
- [ ] 添加迁移说明
- [ ] 保留向后兼容性

### 阶段 5: 验证和清理

- [ ] 检查所有链接是否正确
- [ ] 验证文件命名符合规范
- [ ] 删除空目录
- [ ] 测试索引导航

---

## 四、风险控制

### 4.1 备份策略

- 在 Git 中创建整理前的 commit
- 保留原始文件，使用复制而非移动
- 整理完成后再删除原始文件

### 4.2 兼容性保证

- 保留原 `readme.md` 文件
- 添加重定向提示
- 保留常用链接的向后兼容

### 4.3 回滚计划

如整理失败：

1. `git reset --hard HEAD` 恢复到整理前状态
2. 检查问题原因
3. 修正策略后重新执行

---

## 五、验收标准

### 5.1 结构清晰

- [ ] 目录结构符合三层架构 (AI Apps, AI Teams, Infra)
- [ ] current/ 目录只包含当前有效文档
- [ ] archive/ 目录包含所有历史版本

### 5.2 命名规范

- [ ] 所有文件名符合 kebab-case
- [ ] 版本号格式统一 (v1.0, v2.0)
- [ ] 归档文件带 `-archived` 后缀

### 5.3 索引完整

- [ ] `current/readme.md` 包含所有有效 PRD
- [ ] `archive/readme.md` 包含所有归档文档
- [ ] 主 `readme.md` 提供清晰导航

### 5.4 链接有效

- [ ] 索引中的所有链接可访问
- [ ] 文档间的交叉引用正确
- [ ] 无 404 链接

---

## 六、后续维护

### 6.1 文档更新规则

1. **新增 PRD**: 直接在 `current/` 对应目录创建
2. **小版本更新**: 直接修改现有文件，更新版本号
3. **大版本更新**:
   - 旧版本移至 `archive/` 并添加 `-archived` 后缀
   - 在 `current/` 创建新版本
   - 更新索引
4. **文档废弃**: 移至 `archive/` 并在归档索引中说明原因

### 6.2 定期审查

- **月度**: 检查文档状态是否与代码一致
- **季度**: 清理过期归档，合并重复内容
- **年度**: 全面审查文档结构，优化组织方式

---

## 七、执行时间表

| 阶段                 | 预计时间 | 状态      |
| -------------------- | -------- | --------- |
| 阶段 1: 创建目录结构 | 30 分钟  | ✅ 已完成 |
| 阶段 2: 移动当前文档 | 2 小时   | ⏳ 待执行 |
| 阶段 3: 归档过期文档 | 1 小时   | ⏳ 待执行 |
| 阶段 4: 更新主索引   | 30 分钟  | ⏳ 待执行 |
| 阶段 5: 验证和清理   | 1 小时   | ⏳ 待执行 |

**总计**: 约 5 小时

---

**执行人签名**: 文档专家 Agent
**审批人**: 待审批
