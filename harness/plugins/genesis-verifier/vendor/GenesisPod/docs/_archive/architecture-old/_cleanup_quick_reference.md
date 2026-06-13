# 文档清理快速参考卡

> **打印友好版本** | 一页纸总结核心要点

---

## 📊 现状快照

```
总文档数: 267 个
活跃文档: 267 个（100%）
归档文档: 0 个

问题:
🔴 命名违规: 131 个（49%）
🔴 过期文档: ~50 个
🟡 重复文档: 15 组（~30 个文件）
🟡 分类混乱: 23 个一级目录
```

## 🎯 目标状态

```
总文档数: 180-200 个
活跃文档: 120-140 个（60-70%）
归档文档: 60-80 个（30-40%）

改进:
✅ 命名合规: 100%
✅ 过期文档: 0
✅ 重复文档: 0
✅ 清晰分类: 12-14 个一级目录
```

---

## 🚀 三阶段执行

### 阶段1: 紧急清理（本周 - 7h）

```
1️⃣ 归档过期文档（2h）
   - 2024年文档 → archive/
   - 项目报告 → archive/2025-q1/reports/
   - 实施记录 → archive/2025-q1/implementations/
   - 删除无价值文档（5个）

2️⃣ 修正命名违规（3h）
   - 131 个文件重命名
   - 全部改为 kebab-case

3️⃣ 更新核心文档（2h）
   - readme.md → v3.0
   - prd/readme.md → 添加版本管理
   - api/readme.md → 验证一致性
```

### 阶段2: 结构优化（下周 - 6h）

```
1️⃣ 重组 data-management（1h）
   → features/data-collection/

2️⃣ 合并重复文档（3h）
   - 15 组重复文档合并

3️⃣ 优化 PRD 目录（2h）
   - 创建 current/ 和 archive/
   - 按版本组织
```

### 阶段3: 完善补充（两周 - 9h）

```
1️⃣ 创建索引文档（2h）
   - design/readme.md
   - archive/readme.md
   - features/*/readme.md

2️⃣ 验证代码一致性（4h）
   - 10 个核心模块验证

3️⃣ 建立自动化检查（3h）
   - GitHub Actions
   - 验证脚本
```

---

## 📁 新目录结构速览

```
docs/
├── readme.md              # 总导航
│
├── 核心文档（活跃）
│   ├── api/              # API 文档
│   ├── architecture/     # 系统架构
│   ├── guides/           # 开发指南
│   ├── features/         # 功能文档
│   ├── prd/              # 产品需求
│   │   ├── current/      # ⭐ 当前版本
│   │   └── archive/      # ⭐ 历史版本
│   ├── design/           # 设计文档
│   ├── decisions/        # ADR
│   ├── tech-stack/       # 技术栈
│   ├── testing/          # 测试文档
│   └── releases/         # 发布说明
│
├── 参考文档（准活跃）
│   ├── ai-trends/        # AI 趋势研究
│   └── ai-teams/         # AI Teams
│
└── archive/              # 历史归档
    ├── 2024-q4/
    ├── 2025-q1/
    │   ├── planning/
    │   ├── execution-logs/
    │   ├── summaries/
    │   ├── issues/
    │   ├── audits/
    │   ├── reports/          # ⭐ NEW
    │   ├── implementations/  # ⭐ NEW
    │   └── deprecated/
    └── data-management-legacy/ # ⭐ NEW
```

---

## 🛠️ 常用命令

### 检查文档数量

```bash
find docs -name "*.md" | wc -l                    # 总数
find docs -name "*.md" ! -path "docs/archive/*" | wc -l  # 活跃
```

### 验证命名规范

```bash
find docs -name "*.md" ! -path "docs/archive/*" ! -name "readme.md" \
  | grep -E "[A-Z_]|[ ]"
# 期望: 无输出
```

### 检查链接

```bash
find docs -name "*.md" ! -path "docs/archive/*" \
  -exec markdown-link-check {} \;
```

### Git 批量移动

```bash
git mv old/path/file.md new/path/new-name.md
```

### 创建目录

```bash
mkdir -p docs/path/to/dir
```

---

## ✅ 验收标准

### 必达指标

- [ ] 命名合规率 = 100%
- [ ] 重复文档组 = 0
- [ ] 过期文档（活跃） = 0
- [ ] 活跃文档数 < 150
- [ ] 所有核心目录有 readme.md

### 质量指标

- [ ] 查找时间 < 2 分钟
- [ ] 链接有效率 = 100%
- [ ] PRD 版本清晰（current/ vs archive/）
- [ ] 文档与代码一致（核心模块）

---

## ⚠️ 注意事项

### 执行前

1. ✅ 创建备份分支: `docs-cleanup-backup`
2. ✅ 通知团队避免同时编辑
3. ✅ 选择低峰时段执行

### 执行中

1. ⚠️ 使用 `git mv` 保留历史
2. ⚠️ 频繁提交（每批次后）
3. ⚠️ 分批执行重命名（避免冲突）

### 执行后

1. ✅ 运行所有验证脚本
2. ✅ 检查链接有效性
3. ✅ 请求团队审查 PR

---

## 🔗 相关文档

| 文档                                                            | 用途                              |
| --------------------------------------------------------------- | --------------------------------- |
| [\_cleanup_analysis.md](_cleanup_analysis.md)                   | 完整分析报告（267个文档详细诊断） |
| [\_cleanup_executive_summary.md](_cleanup_executive_summary.md) | 执行摘要（快速了解方案）          |
| [\_cleanup_checklist.md](_cleanup_checklist.md)                 | 执行检查清单（逐项勾选）          |
| [\_cleanup_quick_reference.md](_cleanup_quick_reference.md)     | 本文件（一页纸参考）              |

---

## 🆘 遇到问题？

### 命名规范疑问

→ 参考 `../.claude/standards/03-naming-conventions.md`

### 分类不明确

→ 参考完整报告 3.2 节"目录职责定义"

### Git 操作问题

→ 使用 `git checkout docs-cleanup-backup` 回滚

### 技术问题

→ 查看脚本注释或提 Issue

---

## 📞 联系方式

**执行负责人**: 文档专家 Agent
**审核负责人**: [待指定]
**紧急联系**: 项目 Issue 反馈

---

**版本**: v1.0 | **日期**: 2026-01-15 | **状态**: 待执行

---

# 快速决策树

```
遇到文档不知道放哪？
  ├─ 是 API 文档？ → api/
  ├─ 是架构设计？ → architecture/
  ├─ 是开发指南？ → guides/
  ├─ 是功能说明？ → features/[module]/
  ├─ 是产品需求？ → prd/current/[module]/ (最新) 或 prd/archive/ (旧版)
  ├─ 是详细设计？ → design/
  ├─ 是决策记录？ → decisions/
  ├─ 是测试文档？ → testing/
  ├─ 是发布说明？ → releases/
  ├─ 是 AI 趋势研究？ → ai-trends/
  └─ 是历史文档？ → archive/[year]-q[quarter]/[type]/

文档命名规范？
  ✅ 全小写: my-document.md
  ✅ 连字符: word-word-word.md
  ❌ 大写: MyDocument.md
  ❌ 下划线: my_document.md
  ❌ 空格: my document.md
  ❌ 中文: 我的文档.md

文档版本管理？
  - 当前版本: prd/current/[module]/[module]-prd-v[X.Y].md
  - 旧版本: prd/archive/[module]-prd-v[X.Y]-archived.md
  - 归档时添加标记: > ⚠️ 已归档

文档过期判断？
  - 超过 6 个月未更新（非核心文档）
  - PRD/设计文档有新版本
  - 功能已废弃/重构
  - 临时性任务/问题记录

执行顺序？
  1. 阶段1: 归档 + 重命名 + 更新核心文档（本周）
  2. 阶段2: 重组 + 合并 + 优化 PRD（下周）
  3. 阶段3: 索引 + 验证 + 自动化（两周）
```

---

**打印提示**: 此文档设计为 A4 纸 2 页打印，建议正反面打印方便随身携带
