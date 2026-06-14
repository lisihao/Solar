# Docs 目录重组方案

## 📊 当前问题

### 1. 重复文件

- `api-endpoints.md` + `api-reference.md` → 可合并为完整API文档
- `implementation-status.md` + `implementation-summary.md` → 历史报告，应归档
- `workspace-ai-reporting.md` + `workspace-ai-reporting-tasks.md` → 相关但不同，保留

### 2. 分类混乱

- 根目录有架构和功能文档
- engineering目录混杂指南、API、架构、周报
- requirements目录有7个AI Office文件，包含草稿和不同版本

### 3. 命名不一致

- 大小写混用：`ACCESS_GUIDE.md` vs `deployment-guide.md`
- 中英文混杂

---

## 🎯 重组目标

### 新目录结构

```
docs/
├── readme.md                          # 📚 文档导航总览
│
├── architecture/                      # 🏗️ 架构设计
│   ├── OVERVIEW.md                   # 架构总览
│   ├── IMPROVEMENTS-SUMMARY.md       # 架构改进总结
│   └── AI-CONTEXT.md                 # AI上下文架构
│
├── api/                               # 🔌 API文档
│   └── readme.md                      # API完整参考（合并）
│
├── guides/                            # 📖 开发指南
│   ├── development.md                # 开发指南
│   ├── deployment.md                 # 部署指南
│   ├── testing.md                    # 测试指南
│   └── access.md                     # 访问指南
│
├── features/                          # ✨ 功能文档
│   ├── data-collection/              # 数据采集
│   │   ├── verification.md
│   │   └── fixes.md
│   │
│   ├── ai-office/                    # AI Office功能
│   │   ├── product-spec.md           # 产品方案（正式版）
│   │   ├── system-design.md          # 系统设计
│   │   ├── ui-design-three-column.md # UI设计-三栏
│   │   ├── ui-design-realtime.md     # UI设计-实时协作
│   │   ├── document-generation.md    # 文档生成设计
│   │   ├── ppt-template-system.md    # PPT模板系统
│   │   └── todo.md                   # 任务清单
│   │
│   ├── workspace-reporting/          # Workspace报告功能
│   │   ├── overview.md
│   │   └── tasks.md
│   │
│   └── reports.md                    # 报告功能指南
│
└── archive/                           # 📦 历史文档（归档）
    ├── weekly-reports/               # 周报
    │   ├── week1-implementation.md
    │   ├── week2-implementation.md
    │   ├── week3-comments.md
    │   └── week4-integration.md
    │
    ├── implementation-status.md      # 实现状态（旧）
    ├── implementation-summary.md     # 实现总结（旧）
    └── ai-office-multi-model.md      # AI Office多模型草稿
```

---

## 📝 文件映射表

### 新建文件

| 新文件          | 来源 | 操作                                    |
| --------------- | ---- | --------------------------------------- |
| `readme.md`     | 新建 | 创建文档导航                            |
| `api/readme.md` | 合并 | `api-endpoints.md` + `api-reference.md` |

### 移动 + 重命名

| 原文件                                                 | 新位置                                         | 操作      |
| ------------------------------------------------------ | ---------------------------------------------- | --------- |
| `AI_CONTEXT_architecture.md`                           | `architecture/AI-CONTEXT.md`                   | 移动+改名 |
| `engineering/architecture.md`                          | `architecture/OVERVIEW.md`                     | 移动+改名 |
| `engineering/ARCHITECTURE-IMPROVEMENTS-SUMMARY.md`     | `architecture/IMPROVEMENTS-SUMMARY.md`         | 移动      |
| `engineering/ACCESS_GUIDE.md`                          | `guides/access.md`                             | 移动+改名 |
| `engineering/DEVELOPMENT-GUIDE.md`                     | `guides/development.md`                        | 移动+改名 |
| `engineering/deployment-guide.md`                      | `guides/deployment.md`                         | 移动      |
| `engineering/testing-guide.md`                         | `guides/testing.md`                            | 移动      |
| `engineering/data-collection-fixes.md`                 | `features/data-collection/fixes.md`            | 移动      |
| `engineering/DATA-COLLECTION-VERIFICATION.md`          | `features/data-collection/verification.md`     | 移动+改名 |
| `engineering/REPORT-FEATURE-GUIDE.md`                  | `features/reports.md`                          | 移动+改名 |
| `engineering/workspace-ai-reporting.md`                | `features/workspace-reporting/overview.md`     | 移动+改名 |
| `engineering/workspace-ai-reporting-tasks.md`          | `features/workspace-reporting/tasks.md`        | 移动      |
| `ai-office-ppt-template-system.md`                     | `features/ai-office/ppt-template-system.md`    | 移动      |
| `requirements/AI Office 产品方案.md`                   | `features/ai-office/product-spec.md`           | 移动+改名 |
| `requirements/AI Office 系统设计与任务划分.md`         | `features/ai-office/system-design.md`          | 移动+改名 |
| `requirements/AI Office UI设计方案 - 三栏布局.md`      | `features/ai-office/ui-design-three-column.md` | 移动+改名 |
| `requirements/AI Office UI设计方案 - 实时协作式.md`    | `features/ai-office/ui-design-realtime.md`     | 移动+改名 |
| `requirements/AI-Office-Document-Generation-Design.md` | `features/ai-office/document-generation.md`    | 移动+改名 |
| `requirements/AI-Office-TODO-List.md`                  | `features/ai-office/todo.md`                   | 移动+改名 |

### 归档

| 原文件                                            | 新位置                                           | 原因     |
| ------------------------------------------------- | ------------------------------------------------ | -------- |
| `engineering/week1-implementation-summary.md`     | `archive/weekly-reports/week1-implementation.md` | 历史周报 |
| `engineering/week2-implementation-summary.md`     | `archive/weekly-reports/week2-implementation.md` | 历史周报 |
| `engineering/week3-comments-implementation.md`    | `archive/weekly-reports/week3-comments.md`       | 历史周报 |
| `engineering/week4-integration-implementation.md` | `archive/weekly-reports/week4-integration.md`    | 历史周报 |
| `engineering/implementation-status.md`            | `archive/implementation-status.md`               | 历史报告 |
| `engineering/implementation-summary.md`           | `archive/implementation-summary.md`              | 历史报告 |
| `requirements/AI Office.md`                       | `archive/ai-office-multi-model.md`               | 技术草稿 |

### 删除

| 文件                           | 原因                   |
| ------------------------------ | ---------------------- |
| `engineering/api-endpoints.md` | 合并到 `api/readme.md` |
| `engineering/api-reference.md` | 合并到 `api/readme.md` |

---

## ✅ 执行步骤

1. ✅ 创建新目录结构
2. ⏳ 移动并重命名文件
3. ⏳ 合并重复文件（API文档）
4. ⏳ 创建README导航
5. ⏳ 清理空目录
6. ⏳ 验证所有链接

---

## 📊 改进效果

### 改进前

- 28个文件，2个子目录
- 分类混乱，重复内容多
- 命名不一致

### 改进后

- ~26个有效文件（删除2个重复）
- 5个功能目录 + 1个归档目录
- 清晰的层级结构
- 统一的命名规范（小写+连字符）

---

**状态**: 待执行
**预计时间**: 15-20分钟
**风险**: 低（仅移动和重命名，不修改内容）
