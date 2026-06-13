# 文档组织规范

**版本**: v1.0
**生效日期**: 2025-11-22
**适用范围**: 所有项目文档
**前置规范**: [命名规范](03-naming-conventions.md), [文档编写规范](09-documentation.md)

---

## 📋 概述

本规范定义了项目文档的组织结构、分类原则、归档策略和维护流程，确保文档系统的可维护性和可查找性。

### 核心原则

1. **单一入口** - 根目录只保留总导航文件
2. **分类清晰** - 按文档类型和功能模块组织
3. **系统归档** - 历史文档按时间和主题归档
4. **命名规范** - 严格遵守 kebab-case 命名
5. **链接有效** - 所有内部链接必须可访问

---

## 🗂️ 标准目录结构

### 根目录结构

```
docs/
├── readme.md                # 📍 总导航（唯一根文件）
│
├── api/                     # 🔌 API文档
├── architecture/            # 🏗️ 架构设计
├── guides/                  # 📖 使用指南
├── features/                # ✨ 功能文档
├── prd/                     # 📋 产品需求
├── decisions/               # 🧭 架构决策
├── analysis/                # 📊 分析报告
├── design/                  # 🎨 设计文档
└── archive/                 # 📦 历史归档
```

### 目录职责定义

#### api/ - API文档

**职责**: API接口规范、使用示例、错误码说明

**文档类型**:

- API总览（readme.md）
- 各模块API文档（按功能分文件）
- API设计规范

**命名示例**:

```
api/
├── readme.md                # API总览
├── data-collection-api.md   # 数据采集API
├── auth-api.md              # 认证API
└── user-api.md              # 用户API
```

#### architecture/ - 架构设计

**职责**: 系统架构、技术选型、设计决策

**文档类型**:

- 架构总览
- 技术架构
- 数据架构
- 部署架构
- 架构改进记录

**命名示例**:

```
architecture/
├── overview.md              # 架构总览
├── backend-architecture.md  # 后端架构
├── frontend-architecture.md # 前端架构
├── data-architecture.md     # 数据架构
└── improvements-summary.md  # 架构改进
```

#### guides/ - 使用指南

**职责**: 操作手册、配置指南、最佳实践

**文档类型**:

- 开发指南
- 部署指南
- 测试指南
- 配置指南
- 故障排查

**命名示例**:

```
guides/
├── development.md           # 开发指南
├── deployment.md            # 部署指南
├── testing.md               # 测试指南
├── troubleshooting.md       # 故障排查
│
├── authentication/          # 认证相关
│   ├── google-oauth-setup.md
│   └── jwt-configuration.md
│
└── deployment/              # 部署相关
    ├── railway-config.md
    └── docker-setup.md
```

#### features/ - 功能文档

**职责**: 各功能模块的详细文档

**文档类型**:

- 功能概述
- 技术实现
- 使用说明
- API文档
- 测试报告

**命名示例**:

```
features/
├── data-collection/         # 数据采集
│   ├── readme.md            # 功能总览
│   ├── architecture.md      # 架构设计
│   ├── data-model.md        # 数据模型
│   ├── implementation.md    # 实施说明
│   └── validation.md        # 验证报告
│
├── blog-collection/         # 博客采集
│   └── system-design.md
│
└── ai-office/               # AI Office
    ├── readme.md
    ├── product-spec.md
    └── system-design.md
```

#### prd/ - 产品需求文档

**职责**: 产品需求、功能规格、业务目标

**文档类型**:

- 产品需求文档（PRD）
- 功能规格说明（Spec）
- 业务流程图
- 用户故事

**命名示例**:

```
prd/
├── readme.md                # PRD索引
│
├── current/                 # 当前版本
│   ├── prd-v2.0.md
│   ├── data-collection-v3.0.md
│   └── ai-office-v1.0.md
│
└── archive/                 # 历史版本
    ├── prd-v1.0.md
    └── data-collection-v2.0.md
```

#### decisions/ - 架构决策记录（ADR）

**职责**: 重要技术决策的记录

**文档类型**: Architecture Decision Records (ADR)

**命名格式**: `{序号}-{标题}.md`

**示例**:

```
decisions/
├── 001-use-nestjs-framework.md
├── 002-adopt-prisma-orm.md
├── 003-choose-mongodb-for-raw-data.md
└── 004-implement-bullmq-task-queue.md
```

**ADR模板**:

```markdown
# {序号}. {决策标题}

**日期**: YYYY-MM-DD
**状态**: 已采纳 / 已弃用 / 已替代

## 背景

描述需要决策的问题和上下文

## 决策

阐述做出的决策

## 理由

说明为什么这样决策

## 影响

- 正面影响
- 负面影响
- 风险

## 替代方案

考虑过但未采纳的其他方案
```

#### analysis/ - 分析报告

**职责**: 性能分析、成本分析、竞品分析

**文档类型**:

- 性能分析报告
- 成本分析报告
- 技术调研报告
- 竞品分析报告

#### design/ - 设计文档

**职责**: UI/UX设计、风格指南、设计规范

**文档类型**:

- 设计规范
- 组件库文档
- 颜色系统
- 排版规范

#### archive/ - 历史归档

**职责**: 历史文档的系统化归档

**组织原则**:

- 按季度或年份分目录
- 按文档类型细分子目录
- 保留原始内容，不修改

**目录结构**:

```
archive/
├── readme.md                # 归档说明
│
├── 2024-q4/                 # 2024年第四季度
│   └── weekly-reports/
│
├── 2025-q1/                 # 2025年第一季度
│   ├── planning/            # 规划文档
│   ├── execution-logs/      # 执行日志
│   ├── summaries/           # 总结报告
│   ├── issues/              # 问题记录
│   ├── audits/              # 审计报告
│   └── deprecated/          # 废弃文档
│
└── data-management-legacy/  # 特定模块遗留文档
```

---

## 📝 文档分类决策树

### 如何确定文档应该放在哪里？

```
开始：我有一个新文档
    ↓
是API接口文档吗？
    ├── 是 → 放入 api/
    └── 否 ↓
是系统架构设计吗？
    ├── 是 → 放入 architecture/
    └── 否 ↓
是操作指南或教程吗？
    ├── 是 → 放入 guides/
    │        └─ 进一步分类到子目录
    └── 否 ↓
是某个功能模块的文档吗？
    ├── 是 → 放入 features/{模块名}/
    └── 否 ↓
是产品需求文档吗？
    ├── 是 → 放入 prd/current/ 或 prd/archive/
    └── 否 ↓
是重要技术决策记录吗？
    ├── 是 → 放入 decisions/
    │        └─ 使用ADR格式
    └── 否 ↓
是分析报告吗？
    ├── 是 → 放入 analysis/
    └── 否 ↓
是设计相关文档吗？
    ├── 是 → 放入 design/
    └── 否 ↓
是历史文档或已过时文档吗？
    ├── 是 → 放入 archive/{年份-季度}/{类型}/
    └── 否 → 咨询文档负责人
```

---

## 🔄 文档生命周期管理

### 1. 创建阶段

**规则**:

- 根据决策树确定文档位置
- 使用 kebab-case 命名（全小写+连字符）
- 在 readme.md 中添加索引链接
- 添加文档元信息（日期、版本、作者）

**元信息模板**:

```markdown
# 文档标题

**创建日期**: 2025-11-22
**最后更新**: 2025-11-22
**版本**: v1.0
**作者**: 团队/个人
**状态**: 草稿 / 审核中 / 已发布
```

### 2. 活跃阶段

**维护规则**:

- 每次更新修改"最后更新"日期
- 重大变更增加版本号
- 保持链接有效性
- 定期审查内容准确性

### 3. 归档阶段

**归档触发条件**:

- 文档内容已过时
- 被新文档替代
- 功能已下线
- 季度结束（周报等时效性文档）

**归档流程**:

```bash
# 1. 确定归档位置
docs/archive/{年份-季度}/{类型}/

# 2. 移动文件（保留历史）
git mv docs/{原路径} docs/archive/{归档路径}

# 3. 更新链接
# 在 readme.md 中移除或标记为"已归档"

# 4. 添加归档说明
# 在 archive/readme.md 中添加条目
```

### 4. 清理阶段

**清理原则**:

- **不删除**，只归档
- 确实无价值的文档可移至 deprecated/ 子目录
- 3年以上的归档文档可考虑压缩存储

---

## 📖 README 文件规范

### 总导航 readme.md（docs/readme.md）

**必需内容**:

1. 项目文档概述
2. 目录结构导航
3. 快速开始指引
4. 文档分类索引
5. 贡献指南链接

**模板**:

```markdown
# 项目文档中心

> 项目简介

**最后更新**: YYYY-MM-DD

## 📚 文档导航

### 核心文档

- [架构设计](architecture/overview.md)
- [API文档](api/readme.md)
- [开发指南](guides/development.md)

### 按主题浏览

- [功能文档](features/)
- [产品需求](prd/)
- [架构决策](decisions/)

## 🚀 快速开始

...
```

### 子目录 readme.md

**必需内容**:

1. 目录用途说明
2. 文档列表
3. 相关链接

**模板**:

```markdown
# {目录名称}

> 简要说明

## 文档列表

- [{文档标题}]({文件名}.md) - 简介

## 相关资源

- [相关文档链接]
```

---

## 🔗 链接管理规范

### 内部链接

**使用相对路径**:

```markdown
✅ 正确
[API文档](../api/readme.md)
[架构设计](../../architecture/overview.md)

❌ 错误
[API文档](/docs/api/readme.md) # 绝对路径
[API文档](https://xxx.com/docs/api) # HTTP链接
```

### 跨目录引用

**建议使用相对路径计算**:

```
当前文件: docs/features/data-collection/readme.md
目标文件: docs/prd/current/data-collection-v3.0.md

链接写法: [PRD](../../prd/current/data-collection-v3.0.md)
```

### 链接检查

**定期验证**:

```bash
# 使用工具检查死链
npm install -g markdown-link-check
find docs -name "*.md" -exec markdown-link-check {} \;
```

---

## 🏷️ 文档标签系统

### 状态标签

在文档开头使用状态徽章：

```markdown
**状态**: 🟢 活跃 | 🟡 准活跃 | 🔴 归档 | ⚪ 草稿
```

| 标签      | 含义       | 使用场景           |
| --------- | ---------- | ------------------ |
| 🟢 活跃   | 当前使用中 | 核心文档、当前功能 |
| 🟡 准活跃 | 偶尔更新   | 参考文档、历史记录 |
| 🔴 归档   | 已归档     | 历史文档、已废弃   |
| ⚪ 草稿   | 未完成     | 正在编写的文档     |

### 版本标签

```markdown
**版本**: v1.0 | v2.0 | v3.0-beta
```

### 优先级标签

```markdown
**优先级**: P0 - Critical | P1 - High | P2 - Medium | P3 - Low
```

---

## ✅ 文档质量检查清单

### 创建新文档时

- [ ] 文件名使用小写 + 连字符（kebab-case）
- [ ] 放置在正确的目录
- [ ] 包含完整的元信息（日期、版本、作者）
- [ ] 添加到相应的 readme.md 索引
- [ ] 内部链接使用相对路径
- [ ] 包含目录（TOC）（如文档较长）
- [ ] 代码示例有语法高亮标记

### 更新现有文档时

- [ ] 更新"最后更新"日期
- [ ] 检查所有链接有效性
- [ ] 验证代码示例可执行
- [ ] 更新版本号（如有重大变更）
- [ ] 检查格式一致性

### 归档文档时

- [ ] 移动到正确的归档目录
- [ ] 更新所有引用该文档的链接
- [ ] 在 archive/readme.md 中添加记录
- [ ] 添加归档原因说明
- [ ] 使用 git mv 保留历史

---

## 🛠️ 工具和脚本

### 文档验证脚本

**位置**: `scripts/docs-validation.sh`

```bash
#!/bin/bash
# 文档验证脚本

set -e

echo "🔍 开始文档验证..."

# 1. 检查根目录只有 readme.md
root_md_count=$(ls docs/*.md 2>/dev/null | wc -l)
if [ "$root_md_count" -ne 1 ]; then
    echo "❌ 根目录应该只有 readme.md"
    ls docs/*.md
    exit 1
fi
echo "✅ 根目录检查通过"

# 2. 检查文件命名规范
uppercase_files=$(find docs -name "*.md" | grep -E "[A-Z]" | grep -v "readme.md" || true)
if [ -n "$uppercase_files" ]; then
    echo "❌ 发现大写文件名："
    echo "$uppercase_files"
    exit 1
fi
echo "✅ 文件命名检查通过"

# 3. 检查必需目录存在
required_dirs="api architecture guides features prd decisions archive"
for dir in $required_dirs; do
    if [ ! -d "docs/$dir" ]; then
        echo "❌ 缺少必需目录: $dir"
        exit 1
    fi
done
echo "✅ 目录结构检查通过"

# 4. 检查链接有效性
echo "🔗 检查链接..."
npx markdown-link-check docs/readme.md --quiet

echo "✅ 所有检查通过！"
```

### 文档统计脚本

**位置**: `scripts/docs-stats.sh`

```bash
#!/bin/bash
# 文档统计脚本

echo "📊 文档统计"
echo "==========="

echo "总文档数: $(find docs -name "*.md" | wc -l)"
echo "核心文档: $(find docs -name "*.md" -not -path "*/archive/*" | wc -l)"
echo "归档文档: $(find docs/archive -name "*.md" | wc -l)"
echo ""

echo "按目录统计:"
for dir in api architecture guides features prd decisions analysis design archive; do
    count=$(find "docs/$dir" -name "*.md" 2>/dev/null | wc -l)
    printf "  %-20s %3d 个文件\n" "$dir/" "$count"
done
```

---

## 📅 定期维护任务

### 每周任务

- [ ] 检查新增文档是否符合规范
- [ ] 验证关键文档链接有效性

### 每月任务

- [ ] 审查活跃文档的准确性
- [ ] 识别需要归档的过时文档
- [ ] 更新文档统计报告

### 每季度任务

- [ ] 清理 archive/ 目录，按季度组织
- [ ] 全面检查所有文档链接
- [ ] 更新文档组织规范（如需要）
- [ ] 生成季度文档质量报告

---

## 🔧 常见问题

### Q: 文档应该多详细？

**A**: 遵循"够用即止"原则：

- API文档：完整但简洁
- 指南文档：逐步详细，包含示例
- 架构文档：高层次概述 + 关键细节
- 代码注释：补充文档无法表达的内容

### Q: 如何处理重复内容？

**A**: 采用"单一信息源"（Single Source of Truth）:

- 核心内容只写一次
- 其他文档通过链接引用
- 避免复制粘贴

### Q: 中英文混合怎么办？

**A**:

- 文件名全部使用英文（kebab-case）
- 文档内容可以使用中文
- 技术术语保留英文
- 关键概念提供中英对照

### Q: 如何处理大型文档？

**A**:

- 超过500行考虑拆分
- 使用子目录组织相关文档
- 提供总览文档（readme.md）
- 在总览中提供导航链接

### Q: 图片和附件如何组织？

**A**:

```
docs/
├── assets/                  # 静态资源
│   ├── images/             # 图片
│   │   ├── architecture/   # 按主题分类
│   │   ├── features/
│   │   └── guides/
│   ├── diagrams/           # 图表源文件
│   └── files/              # 其他附件
```

---

## 📚 参考资源

### 业界最佳实践

- [Google 开发者文档风格指南](https://developers.google.com/style)
- [Microsoft 写作风格指南](https://docs.microsoft.com/en-us/style-guide/)
- [Write the Docs](https://www.writethedocs.org/)
- [Divio 文档系统](https://documentation.divio.com/)

### 项目内部规范

- [命名规范](03-naming-conventions.md)
- [文档编写规范](09-documentation.md)
- [Git 工作流](08-git-workflow.md)

---

## 📞 支持与反馈

### 文档负责人

- **文档专家**: Claude (Documentation Agent)
- **维护团队**: GenesisPod Team

### 改进建议

如发现本规范不适用或需要改进的地方，请：

1. 在项目中创建 Issue
2. 标记为 `documentation` 标签
3. 描述问题和建议的改进方案

---

**规范版本**: v1.0
**生效日期**: 2025-11-22
**下次审查**: 2025-12-22（1个月后）
**维护者**: 文档专家团队
