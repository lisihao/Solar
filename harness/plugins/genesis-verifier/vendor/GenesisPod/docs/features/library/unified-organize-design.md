# 数据源统一整理（Unified Organize）设计基线

> 目标：知识库 → 数据源 的**全部子源**（内容：书签/笔记/图片；外部连接：Notion/Google Drive/飞书）
> 共用同一个「AI 整理助手」按钮，复用同一套工具与能力。
> 承接 [ADR-006 对话整理](../../decisions/006-conversational-organize.md)（P1 仅书签）。
> 状态：设计基线（已与用户确认范围与两项关键决策），待分波实现。

## 1. 用户诉求（原话）

> 把知识库→数据源，包括我的内容和外部连接，都要使用相同的按钮，同步支持所有的工具和能力。

确认范围：**全做（含 Notion）**。

## 2. 已确认的关键决策

| 决策         | 选择                  | 含义                                                                                                                    |
| ------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 外部连接写回 | **本地覆盖，不反写**  | Notion/飞书 条目镜像进来后，打标签/移动/改状态只存本地，不调用 Notion/飞书 写 API（无需额外 OAuth scope，无双向冲突）。 |
| 工作区       | **独立 git worktree** | 与并行会话隔离，避免被抢提交/扫半成品；分波完成后由用户审阅合回 main。                                                  |

## 3. 现状（已核对代码）

- 整理工具是**集合中心**的：6 个 `organize-bookmark-tools` 全部操作 `CollectionItem`（经 `CollectionsService`，对 item 类型无关）。
- 只有进了 `CollectionItem` 的条目才被整理工具看见：
  - **书签**：Resource → CollectionItem，✅ 现成。
  - **Google Drive**：导入时**仅当指定 collectionId** 才建 CollectionItem（`google-drive-import.service.ts:188-192`），否则是游离 Resource，整理工具看不到。
  - **笔记**：独立 `Note` 表（自带 tags），不在 CollectionItem。
  - **图片**：独立 `GeneratedImage` 表（isBookmarked），不在 CollectionItem。
  - **飞书**：独立 `FeishuItem` 表，不在 CollectionItem。
  - **Notion**：缓存为 `NotionDatabase.items` JSON 数组（只读镜像），非 DB 记录。
- `OrganizeScope`(BOOKMARKS/NOTES/EXTERNAL) 目前仅是 session 标签，工具不按它分支。
- 前端：`OrganizeChatMode` 仅在 `AIOrganizePanel` 的 `activeTab === 'bookmarks'` 渲染，`scope="BOOKMARKS"` 写死。

## 4. 架构：CollectionItem 作为通用「本地整理覆盖层」（推荐 Approach B）

整理 = 在**本地覆盖层**上打标签/分集合/标状态，**不动源数据**——这正是 `CollectionItem` 已有的语义（它本就独立于 Resource 持有 `tags` + `readStatus`）。因此把 **CollectionItem 泛化为可指向任意源条目**，让现有整理工具对所有源自动通用：

```
CollectionItem（本地整理覆盖层）
  itemType: BOOKMARK | NOTE | IMAGE | FEISHU | NOTION | DRIVE   // 新增
  resourceId   String?   // 原 FK，改可空（BOOKMARK/DRIVE 用）
  noteId       String?   // NOTE
  imageId      String?   // IMAGE
  feishuItemId String?   // FEISHU
  notionItemId String?   // NOTION（见 §6 Notion 抽取）
  tags / readStatus / collectionId   // 不变，本地覆盖
```

- **整理工具零改动语义**：仍操作 CollectionItem 的 tags/status/collection；只是 `organize-list-items` 的取数与展示要带上 itemType + 源标题。
- **不反写**：本地覆盖层与源解耦，天然满足"不写回 Notion/飞书"。
- 备选 Approach A（把每种源都镜像成 Resource 再进集合）会重复存正文，弃用。

> Approach B 取舍：CollectionItem 由"必有 resourceId"变为"多态、按 itemType 取对应 FK"。需迁移 + 改 `CollectionsService` 取数/计数/搜索的 join 逻辑，但**整理工具与写操作（tag/move/status）几乎不变**。

## 5. 分波（每波独立可验证、可上线）

| 波     | 范围                            | 关键改动                                                                                                                                      | 验证标准                                                                              |
| ------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **W1** | 按钮统一 + 书签                 | 前端：`OrganizeChatMode` 入口铺到数据源各 tab；非就绪源按钮置灰+提示。书签照常。                                                              | 各 tab 都见到按钮；书签整理与现状一致；非就绪 tab 点按钮有明确提示，不误整理书签      |
| **W2** | CollectionItem 多态 + 笔记/图片 | schema：CollectionItem 加 itemType + 可空 FK + 手写迁移（回填存量书签 itemType=BOOKMARK）；`CollectionsService` 取数多态化；笔记/图片可被整理 | 迁移幂等；书签整理无回归；笔记 tab 能让 AI 建集合/打标/移动（覆盖层），不改 Note 正文 |
| **W3** | 飞书                            | FeishuItem 接入多态 CollectionItem                                                                                                            | 飞书 tab 可整理；不写回飞书                                                           |
| **W4** | Notion                          | Notion 缓存 JSON 抽成 `NotionItem` 记录（只读源）+ 接入多态 CollectionItem                                                                    | Notion tab 可在**本地覆盖层**整理；不写回 Notion                                      |

## 6. 迁移与同步要点

- CollectionItem 多态：手写 SQL 迁移（本项目规范），加列 + 回填 `itemType='BOOKMARK'` + 放开 resourceId 可空；`@@unique` 约束按 itemType+对应 FK 调整。
- 各源新建/同步时，**按需**在用户首次整理该源时把条目纳入覆盖层（lazy），避免一次性灌爆 CollectionItem。
- Notion：`NotionDatabase.items` JSON → `NotionItem` 行（只读快照），供覆盖层引用。

## 7. 风险 / 开放项

- CollectionItem 多态唯一约束 + 取数 join 复杂度（W2 重点测）。
- 数据源各 tab 的列表视图当前各读各源；统一"显示本地整理覆盖（tags/集合/状态）"需各视图接覆盖层（可后置）。
- 量级：W2–W4 是多 PR 工程，逐波交付，不一次性合大 PR。

## 8. 不做（本期）

- 不反写 Notion/飞书（已确认）。
- 不把笔记/图片正文复制进 Resource（用多态覆盖层，不重复存储）。

## 9. 实现进度（worktree feat-library-unified-organize）

| 项                                                                                                   | 状态 | commit    |
| ---------------------------------------------------------------------------------------------------- | ---- | --------- |
| 设计基线                                                                                             | ✅   | 0e13594ee |
| W2a CollectionItem 多态 schema + 迁移                                                                | ✅   | cb83707f7 |
| W2b 后端：listOrganizableItems / assignItemsToCollection + 跨源工具 + scope prompt（笔记/图片/飞书） | ✅   | b919dd675 |
| W2c 前端：书签/笔记/图片统一「对话整理」入口                                                         | ✅   | d8fc2e1be |
| W4 后端：Notion 页面（NotionPage）接入 + FK 迁移                                                     | ✅   | ab1d0dfac |
| W4 前端：Notion tab 入口                                                                             | ✅   | 17fad4f6e |

| W3 Drive 全栈：listOrganizableItems DRIVE 分支 + 前端 GoogleDriveTabContent 入口 | ✅ | 9409d1f1e |

**后端覆盖全部 6 源**（书签/笔记/图片/飞书/Notion/Drive）；**前端入口覆盖 书签/笔记/图片/Notion/Drive**。

**唯一剩余（无法在本仓完成）**：

- 飞书前端入口：仓库里**没有 `FeishuTabContent` 组件**（`feishu` 在 tab 联合类型里但页面未渲染它）；后端已就绪，等飞书 tab UI 出现后比照 Notion/Drive 加一个「对话整理」按钮即可（约 5 行）。

**可后置增强**：各数据源列表视图统一展示"本地整理覆盖"（tags/集合/状态）。

**合并**：本特性全在 worktree 分支 `worktree-feat-library-unified-organize`，由用户审阅后合回 main；含 2 个手写迁移（须 `prisma migrate deploy`）。
