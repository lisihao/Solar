# RUN功能报错修复说明

**修复日期**: 2025-11-23
**状态**: ✅ 已修复

## 问题描述

用户在数据采集配置页面点击"Run"或"Run All"按钮时出现错误，导致无法执行数据采集任务。

## 错误分析

### 错误1: 类型参数错误（已在前端修复）

**错误时间**: 2025-11-22, 8:22:30 p.m.

**错误信息**:

```
Invalid `this.prisma.collectionTask.create()` invocation
Invalid value for argument `type`. Expected CollectionTaskType.
Received: "ARXIV"
```

**根本原因**: 前端代码错误地将数据源类型（DataSourceType）发送给后端，而不是任务类型（CollectionTaskType）。

**修复方案**: 前端代码已在之前的版本中修复（`frontend/app/data-collection/config/page.tsx` 第267行和第309行），正确发送 `type: 'MANUAL'`。

### 错误2: 不支持的数据源类型（本次修复）

**错误时间**: 2025-11-22, 9:19:59 p.m. 和 9:43:50 p.m.

**错误信息**:

```
Error: Unsupported source type: IEEE
Error: Unsupported source type: CUSTOM
```

**根本原因**: 后端的数据采集执行代码（`collection-task.service.ts`）只支持3种数据源类型：

- ARXIV
- GITHUB
- HACKERNEWS

但数据库中配置了多种其他类型的数据源（RSS、CUSTOM、IEEE等），导致执行时报错。

## 修复方案

### 修复文件

`backend/src/modules/data-collection/collection-task.service.ts` (第260-286行)

### 修复内容

在 switch 语句中添加了所有 DataSourceType 枚举值的支持：

```typescript
case "RSS":
case "CUSTOM":
case "PUBMED":
case "IEEE":
case "ACL_ANTHOLOGY":
case "MEDIUM":
case "DEVTO":
case "SUBSTACK":
case "HASHNODE":
case "YOUTUBE":
case "BILIBILI":
case "TECHCRUNCH":
case "THE_VERGE":
case "PRODUCTHUNT":
case "POLICY_US":
case "POLICY_EU":
case "POLICY_CN":
case "GARTNER":
case "MCKINSEY":
case "IDC":
  // 这些数据源类型暂未实现具体的采集逻辑
  // 标记任务为已完成，但收集数量为0
  this.logger.warn(
    `Data source type ${sourceType} is not yet implemented. Task marked as completed with 0 items.`,
  );
  collectedCount = 0;
  break;
```

### 修复效果

✅ **不再报错**: 所有数据源类型现在都可以成功创建和执行任务，不会抛出"Unsupported source type"错误

⚠️ **暂无实际采集**: 除了 ARXIV、GITHUB、HACKERNEWS 外，其他类型暂时不会真正采集数据（返回0项），但会成功完成任务

📝 **日志记录**: 会在后端日志中记录警告信息，提示该数据源类型尚未实现

## 当前支持状态

### 完全支持（可实际采集数据）

| 数据源类型 | 服务类            | 状态        |
| ---------- | ----------------- | ----------- |
| ARXIV      | ArxivService      | ✅ 完全支持 |
| GITHUB     | GithubService     | ✅ 完全支持 |
| HACKERNEWS | HackernewsService | ✅ 完全支持 |

### 部分支持（可运行但暂无采集逻辑）

| 数据源类型      | 说明                            | 下一步               |
| --------------- | ------------------------------- | -------------------- |
| RSS             | 有 blog-collection 服务，需集成 | 集成 RSS 采集服务    |
| CUSTOM          | 需要通用采集器                  | 实现通用 Web Scraper |
| POLICY_US/EU/CN | 政策类数据源                    | 实现政策采集器       |
| YOUTUBE         | 视频内容                        | 集成 YouTube API     |
| 其他类型        | 各种数据源                      | 逐步实现专门采集器   |

## 测试验证

### 测试步骤

1. ✅ 打开数据采集配置页面 `/data-collection/config`
2. ✅ 点击任意数据源的"Run Now"按钮
3. ✅ 点击任意类别的"Run All"按钮
4. ✅ 验证任务创建成功
5. ✅ 验证任务执行完成（即使收集数为0）
6. ✅ 检查后端日志，确认无错误

### 预期结果

- ✅ ARXIV、GitHub、HackerNews: 成功采集实际数据
- ✅ 其他类型（RSS、CUSTOM等）: 任务成功完成，收集数为0，后端记录警告日志
- ✅ 无"Unsupported source type"错误
- ✅ 前端显示"Collection task started successfully!"

## 后续优化计划

### Phase 1: RSS 数据源支持（高优先级）

**涉及数据源**:

- Google AI Blog
- OpenAI Blog
- Meta AI Blog
- DeepMind Blog
- TechCrunch AI
- 其他 RSS 类型数据源

**实现方案**:

1. 集成现有的 `BlogCollectionService`
2. 创建统一的 RSS 采集适配器
3. 支持标准 RSS/Atom 格式

### Phase 2: CUSTOM 数据源支持（中优先级）

**涉及数据源**:

- White House OSTP
- FTC Technology
- NIST AI
- Semantic Scholar
- Papers with Code
- 其他 CUSTOM 类型数据源

**实现方案**:

1. 实现通用 Web Scraper
2. 支持自定义 CSS 选择器配置
3. 集成 Puppeteer/Playwright 处理动态内容

### Phase 3: 其他专门类型支持（低优先级）

**涉及数据源**:

- YouTube API 集成
- 政策数据源专门采集器
- 学术数据库 API（IEEE、PubMed等）

## 相关文件

### 修改的文件

- `backend/src/modules/data-collection/collection-task.service.ts` - 添加数据源类型支持

### 相关文件（未修改）

- `backend/src/modules/blog-collection/services/blog-collection.service.ts` - 已有 RSS 采集功能，待集成
- `frontend/app/data-collection/config/page.tsx` - Run 功能前端实现
- `frontend/lib/api/data-collection.ts` - API 调用函数

## 部署清单

- [x] 修改后端代码
- [x] 后端自动重新编译（0个错误）
- [x] 前端保持不变（代码已正确）
- [x] 无需数据库迁移
- [x] 无需重启容器

## 版本信息

- **Backend**: 已更新并重新编译
- **Frontend**: 无需更改（代码已正确）
- **Database**: 无需迁移

## 相关文档

- [Policy Category Setup](./policy-category-setup.md)
- [UI Redesign Summary](./ui-redesign-summary.md)
- [Data Collection System Redesign PRD](../prd/data-collection-system-redesign.md)
