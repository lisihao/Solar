# 文档清理执行摘要

> **快速参考版本** - 完整报告见 [\_cleanup_analysis.md](_cleanup_analysis.md)

---

## 🎯 一句话总结

GenesisPod 的 docs 目录包含 **267 个文档**,存在**命名混乱（49%违规）**、**重复严重（15组）**、**过期泛滥（约50个）**三大问题,建议通过**3阶段清理**减少至 **120-140 个活跃文档**,提升可维护性和查找效率 **60-80%**。

---

## 📊 关键数据

| 指标       | 当前状态 | 目标状态 | 改进     |
| ---------- | -------- | -------- | -------- |
| 文档总数   | 267      | 180-200  | ↓ 25-33% |
| 活跃文档   | 267      | 120-140  | ↓ 47-55% |
| 命名合规率 | 51%      | 100%     | ↑ 96%    |
| 过期文档   | ~50      | 0        | ↓ 100%   |
| 重复文档组 | 15组     | 0        | ↓ 100%   |
| 查找时间   | 5-10分钟 | 1-2分钟  | ↓ 60-80% |

---

## 🚨 三大核心问题

### 1. 命名规范执行不力（P0 - 紧急）

**问题**: 虽有完善规范但执行率仅 51%

- 131 个文件命名违规
- 大小写混用、中文文件名、下划线等

**影响**: 跨平台协作困难、查找混乱、专业性差

**解决**: 执行 `scripts/phase1-fix-naming.sh`（预计3小时）

### 2. 过期文档泛滥（P0 - 紧急）

**问题**: 约 50 个过期文档仍在主目录

- 2024年及更早文档未归档
- 已废弃的重构计划仍在活跃目录
- 临时任务记录未清理

**影响**: 误导新人、维护负担重、文档可信度下降

**解决**: 执行 `scripts/phase1-archive-outdated.sh`（预计2小时）

### 3. 重复文档严重（P1 - 重要）

**问题**: 15 组重复文档（约30个文件）

- AI Office 重构文档散布3个目录
- Topic Research 有4个相似设计文档
- AI Slides 优化方案3个版本共存

**影响**: 维护困难、版本混乱、浪费空间

**解决**: 合并重复文档（预计3小时）

---

## 📋 三阶段执行计划

### 阶段1: 紧急清理（本周完成 - 7小时）

**目标**: 解决 P0 问题，快速提升可用性

```bash
✅ 任务1: 归档过期文档（2小时）
   - 归档 2024年及更早文档（~10个）
   - 归档项目报告（3个）
   - 归档实施记录（4个）
   - 删除无价值文档（5个）

✅ 任务2: 修正命名违规（3小时）
   - 修正 131 个文件命名
   - 执行脚本: scripts/phase1-fix-naming.sh

✅ 任务3: 更新核心文档（2小时）
   - 更新 docs/readme.md
   - 更新 docs/prd/readme.md
   - 更新 docs/api/readme.md

验证:
  - 命名合规率达到 100%
  - 活跃文档减少到 ~222 个
  - 核心文档反映最新结构
```

### 阶段2: 结构优化（下周完成 - 6小时）

**目标**: 重组分类体系，合并重复文档

```bash
✅ 任务1: 重组 data-management（1小时）
   - 移动核心文档到 features/data-collection/
   - 归档遗留文档到 archive/data-management-legacy/

✅ 任务2: 合并重复文档（3小时）
   - 合并 15 组重复文档
   - 归档旧版本

✅ 任务3: 优化 PRD 目录（2小时）
   - 创建 prd/current/ 和 prd/archive/
   - 移动文档到对应位置

验证:
  - 重复文档组清零
  - data-management/ 目录移除
  - PRD 版本管理清晰
```

### 阶段3: 完善补充（两周内 - 9小时）

**目标**: 补充缺失文档，建立自动化验证

```bash
✅ 任务1: 创建索引文档（2小时）
   - docs/design/readme.md
   - docs/archive/readme.md
   - docs/features/*/readme.md

✅ 任务2: 验证代码一致性（4小时）
   - 逐个检查功能文档与代码
   - 更新过时说明

✅ 任务3: 建立自动化检查（3小时）
   - GitHub Actions workflow
   - 验证脚本（命名、链接、元数据）

验证:
  - 所有目录有索引
  - 文档与代码一致
  - CI 自动验证运行
```

---

## 🎯 建议的新目录结构（v3.0）

```
docs/
├── readme.md                          # 总导航
│
├── 核心文档目录（活跃）
│   ├── api/                          # API 文档（2-3个）
│   ├── architecture/                 # 系统架构（8-10个）
│   ├── guides/                       # 开发指南（10-12个）
│   ├── features/                     # 功能文档（40-50个）
│   ├── prd/                          # 产品需求（60-70个）
│   │   ├── current/                  # 当前版本 ⭐ NEW
│   │   └── archive/                  # 历史版本 ⭐ NEW
│   ├── design/                       # 设计文档（20-25个）
│   ├── decisions/                    # ADR（6-10个）
│   ├── tech-stack/                   # 技术栈（11-15个）
│   ├── testing/                      # 测试文档（2-5个）
│   └── releases/                     # 发布说明（5-10个）
│
├── 参考文档目录（准活跃）
│   ├── ai-trends/                    # AI 趋势研究（11个）
│   └── ai-teams/                     # AI Teams 文档（3-5个）
│
└── archive/                          # 历史归档（100+个）
    ├── 2024-q4/
    ├── 2025-q1/
    │   ├── planning/
    │   ├── execution-logs/
    │   ├── summaries/
    │   ├── issues/
    │   ├── audits/
    │   ├── reports/                  # ⭐ NEW
    │   ├── implementations/          # ⭐ NEW
    │   └── deprecated/
    └── data-management-legacy/       # ⭐ NEW
```

---

## 📦 关键变更点

### 新增目录

1. **prd/current/** - 当前版本 PRD（按模块组织）
2. **prd/archive/** - 历史版本 PRD（集中归档）
3. **archive/2025-q1/reports/** - 项目报告归档
4. **archive/2025-q1/implementations/** - 实施记录归档
5. **archive/data-management-legacy/** - 数据管理遗留文档

### 移除/合并目录

1. ❌ **data-management/** → 合并到 features/data-collection/
2. ❌ **improvement/** → 内容已合并，删除目录
3. ❌ **product-reviews/** → 无持续价值，删除
4. ❌ **operations/** → 应在项目根目录，删除
5. ❌ **tasks/** → 临时记录，归档后删除

### 重组目录

1. **ai-engine/** → 合并到 architecture/ai-engine-migration-roadmap.md
2. **implementation/** → 全部移至 archive/2025-q1/implementations/
3. **project-reports/** → 全部移至 archive/2025-q1/reports/

---

## 🛠️ 立即执行

### 第一步：备份当前状态

```bash
# 创建备份分支
git checkout -b docs-cleanup-backup
git push origin docs-cleanup-backup

# 切换到工作分支
git checkout -b docs-cleanup-phase1
```

### 第二步：执行阶段1清理

```bash
# 1. 归档过期文档
./scripts/phase1-archive-outdated.sh

# 2. 修正命名违规
./scripts/phase1-fix-naming.sh

# 3. 验证结果
./scripts/validate-docs-naming.sh
find docs -name "*.md" ! -path "docs/archive/*" | wc -l
# 期望: ~222 个

# 4. 提交更改
git add docs/
git commit -m "docs: phase 1 cleanup - archive outdated files and fix naming"
```

### 第三步：创建 PR 并审查

```bash
git push origin docs-cleanup-phase1
# 然后在 GitHub 创建 PR，请求团队审查
```

---

## ⚠️ 风险提示

### 执行风险

1. **链接失效**: 大量文件移动可能导致交叉引用失效
   - **缓解**: 执行后运行链接检查工具
   - **工具**: `markdown-link-check`

2. **协作冲突**: 团队成员可能正在编辑相同文档
   - **缓解**: 在低峰时段执行，提前通知团队
   - **建议**: 周五下班后或周末执行

3. **历史混乱**: Git 历史可能复杂化
   - **缓解**: 使用 `git mv` 保留文件历史
   - **验证**: `git log --follow <file>` 查看移动后的历史

### 回滚方案

```bash
# 如果出现问题，可以快速回滚
git checkout main
git branch -D docs-cleanup-phase1

# 或者恢复特定文件
git checkout docs-cleanup-backup -- docs/
```

---

## 📞 需要帮助？

### 执行过程中的问题

- **命名修正疑问**: 参考 [命名规范](../.claude/standards/03-naming-conventions.md)
- **分类不明确**: 参考完整报告的 3.2 节"目录职责定义"
- **技术问题**: 查看脚本注释或提 Issue

### 审查和反馈

- **文档结构建议**: 在 PR 中评论
- **归档策略疑问**: 参考完整报告的 4.4 节"归档规则"
- **自动化工具**: 参考 4.6 节"自动化工具建议"

---

## ✅ 成功标准

完成后应达到以下标准:

- [ ] 命名合规率 100%
- [ ] 无重复文档组
- [ ] 无2024年及更早的活跃文档
- [ ] 所有目录有 readme.md 索引
- [ ] PRD 版本管理清晰（current/ vs archive/）
- [ ] CI 自动验证通过
- [ ] 文档查找时间 < 2分钟
- [ ] 团队成员反馈积极

---

## 📚 相关资源

- [完整分析报告](_cleanup_analysis.md) - 详细问题诊断和解决方案
- [项目规则 v2.1](../project-rules.md) - 命名规范详细说明
- [历史重组方案](archive/2025-q1/reports/docs-reorganization-plan.md) - 2025-11-22版本
- [命名审查报告](archive/2025-q1/reports/file-naming-audit-report.md) - 历史问题分析

---

**报告日期**: 2026-01-15
**预计完成**: 2026-02-01（3周）
**总工作量**: 约 22 小时（分3个阶段）
**下次审查**: 2026-02-15

**状态**: ✅ 分析完成，等待执行批准
