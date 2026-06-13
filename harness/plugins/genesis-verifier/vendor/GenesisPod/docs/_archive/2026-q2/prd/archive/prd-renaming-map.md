# PRD 文档重命名映射表

> **执行日期**: 2026-01-15
> **目的**: 统一命名规范，AI Group → AI Teams

---

## 重命名原因

1. **代码实际使用 AI Teams**: 后端模块在 `backend/src/modules/ai-app/teams/`
2. **避免概念混淆**: "AI Group" 容易与"用户组"混淆
3. **术语统一**: 文档、代码、产品界面使用一致术语

---

## 文件重命名映射

### AI Teams 核心文档

| 原文件名                                       | 新文件名                                               | 操作          |
| ---------------------------------------------- | ------------------------------------------------------ | ------------- |
| `ai-teams/ai-group-prd-v1.0.md`                | `current/ai-teams/ai-teams-prd-v1.0.md`                | 重命名 + 移动 |
| `ai-teams/ai-group-spec-v2.0.md`               | `current/ai-teams/ai-teams-spec-v2.0.md`               | 重命名 + 移动 |
| `ai-teams/ai-group-team-collaboration-v1.0.md` | `current/ai-teams/ai-teams-team-collaboration-v1.0.md` | 重命名 + 移动 |
| `ai-teams/ai-group-content-parsing-v1.0.md`    | `current/ai-teams/ai-teams-content-parsing-v1.0.md`    | 重命名 + 移动 |
| `ai-teams/ai-group-optimization-v1.1.md`       | `current/ai-teams/ai-teams-optimization-v1.1.md`       | 重命名 + 移动 |
| `ai-teams/ai-group-audit-v1.0.md`              | `archive/ai-teams/ai-group-audit-v1.0-archived.md`     | 移动到归档    |

### 文档内容修改要点

在重命名文件后，还需修改文档内部的以下内容：

1. **标题**: `# AI Group` → `# AI Teams`
2. **产品定位描述**: "多人多AI协作社区" → "AI 团队协作系统"
3. **路由**: `/ai-group` → `/ai-teams`
4. **模块名**: `ai-group` → `ai-teams`
5. **变量名**: `aiGroupStore` → `aiTeamsStore`

---

## 简化方案

由于文件数量较多且需要内容修改，建议采用**符号链接 + 说明文档**的方式过渡：

### 方案 A: 创建索引重定向（推荐）

保留原文件位置不变，在新结构中创建指向说明：

```markdown
# 文档已迁移

本文档已重命名为 `ai-teams-prd-v1.0.md`

**原因**: 统一命名规范，与代码模块名称一致。

**新位置**: `docs/prd/current/ai-teams/ai-teams-prd-v1.0.md`

**注意**: 文档中的 "AI Group" 术语在代码中对应 "AI Teams"。
```

### 方案 B: 直接重命名（需要大量修改）

优点: 彻底统一
缺点: 需要修改所有引用和文档内容

---

## 最终建议

**阶段性整理策略**:

1. **第一步**: 创建清晰的目录结构 (current/ 和 archive/)
2. **第二步**: 在索引文档中明确说明术语对应关系
3. **第三步**: 新文档统一使用 "AI Teams" 术语
4. **第四步**: 逐步迁移和重命名旧文档（非紧急）

**术语对照表**:

| 文档术语         | 代码术语        | 统一使用            |
| ---------------- | --------------- | ------------------- |
| AI Group         | ai-teams        | **AI Teams**        |
| Topic            | Topic           | Topic               |
| 多人多AI协作社区 | AI 团队协作系统 | **AI 团队协作系统** |
