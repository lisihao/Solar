# PRD 归档文档索引

> **说明**: 此目录存放已过期或被替代的 PRD 文档，仅供历史参考。

---

## 归档原则

- **版本升级**: 新版本 PRD 发布后，旧版本移至此处
- **功能废弃**: 已下线或不再维护的功能
- **重大重构**: 设计思路完全改变的文档
- **命名规范**: 文件名添加 `-archived` 后缀

---

## 归档文档列表

### AI Studio

| 文件                           | 原版本 | 归档日期   | 归档原因      |
| ------------------------------ | ------ | ---------- | ------------- |
| ai-studio-prd-v3.0-archived.md | v3.0   | 2026-01-15 | 已升级到 v4.0 |
| ai-studio-prd-v3.1-archived.md | v3.1   | 2026-01-15 | 已升级到 v4.0 |

### AI Office

| 文件                                      | 原版本 | 归档日期   | 归档原因                    |
| ----------------------------------------- | ------ | ---------- | --------------------------- |
| ai-office-optimization-v2-archived.md     | v2.0   | 2026-01-15 | 已整合到 v2.0 主 PRD        |
| ai-office-slides-upgrade-v1.0-archived.md | v1.0   | 2026-01-15 | 功能已合并到 AI Slides 模块 |

### AI Slides

| 文件                                       | 原版本 | 归档日期   | 归档原因             |
| ------------------------------------------ | ------ | ---------- | -------------------- |
| ai-slides-v3-optimization-plan-archived.md | v3.0   | 2026-01-15 | 已升级到 v3.1        |
| ai-slides-genspark-gap-closure-archived.md | v1.0   | 2026-01-15 | 差距分析已完成并整合 |

### AI Teams (原 AI Group)

| 文件                            | 原版本 | 归档日期   | 归档原因             |
| ------------------------------- | ------ | ---------- | -------------------- |
| ai-group-audit-v1.0-archived.md | v1.0   | 2026-01-15 | 实现审计完成，已整改 |

### AI Writing

| 文件                                 | 原版本    | 归档日期   | 归档原因                 |
| ------------------------------------ | --------- | ---------- | ------------------------ |
| ai-writing-v2-archived.md            | v2.0      | 2026-01-15 | 设计思路过时             |
| ai-writing-v3-user-first-archived.md | v3.0 草稿 | 2026-01-15 | 草稿状态，未实施         |
| chapter-review-import-archived.md    | -         | 2026-01-15 | 需求已整合到 redesign.md |

### AI Studio (项目管理相关)

| 文件                                        | 原版本 | 归档日期   | 归档原因                 |
| ------------------------------------------- | ------ | ---------- | ------------------------ |
| noble-sleeping-flurry-archived.md           | -      | 2026-01-15 | 临时分析文档，已完成整改 |
| user-input-interaction-design-archived.md   | -      | 2026-01-15 | 设计方案已整合到主 PRD   |
| collaboration-timeline-redesign-archived.md | -      | 2026-01-15 | 设计方案已整合到主 PRD   |

### Data Collection

| 文件                                    | 原版本 | 归档日期   | 归档原因      |
| --------------------------------------- | ------ | ---------- | ------------- |
| data-collection-design-v2.0-archived.md | v2.0   | 2026-01-15 | 已升级到 v3.0 |

### Integrations

| 文件                                             | 原版本 | 归档日期   | 归档原因      |
| ------------------------------------------------ | ------ | ---------- | ------------- |
| google-drive-rag-knowledge-base-v1.0-archived.md | v1.0   | 2026-01-15 | 已升级到 v2.0 |

### Core

| 文件                                     | 原版本 | 归档日期   | 归档原因               |
| ---------------------------------------- | ------ | ---------- | ---------------------- |
| deepdive-prd-v2.0-archived.md            | v2.0   | 2026-01-15 | 已拆分为各模块独立 PRD |
| resource-to-image-generation-archived.md | v1.0   | 2026-01-15 | 需求暂停，参考价值低   |

---

## 查看归档文档

归档文档按原目录结构组织：

```
archive/
├── ai-apps/
│   ├── ai-studio/
│   ├── ai-office/
│   ├── ai-slides/
│   ├── ai-coding/
│   ├── ai-ask/
│   └── ai-writing/
├── ai-teams/
│   └── topic-research/
└── infra/
    ├── core/
    ├── knowledge-base/
    ├── library/
    ├── integrations/
    └── data-collection/
```

---

## 恢复归档文档

如需恢复归档文档为当前版本：

1. 移除文件名中的 `-archived` 后缀
2. 更新版本号和状态标记
3. 移动到 `current/` 对应目录
4. 更新 `current/readme.md` 索引
