# 前端组件索引（复用 SSOT）

> **复用优先**：写任何 UI 前先在本索引找 canonical 组件。规则见
> [standards/22-frontend-ui-component-governance.md](../../.claude/standards/22-frontend-ui-component-governance.md)
> 与 CLAUDE.md「前端 UI 组件复用优先」红线。**canonical 不适配 / 缺口 → 停下问用户，不要自写。**
>
> 机器校验（pre-push 焊死，见 §6）：`npm run audit:ui-discipline`（**R1–R15 全 hard-zero**）+ `audit:ui-tokens`
>
> - 目录归属测试 `__tests__/protection-net/component-placement.spec.ts` + eslint 禁原生 `alert/confirm`。

---

## 1. 速查：要做某种 UI → 用这个

| 你要做…              | 用 canonical                           | import                                                              |
| -------------------- | -------------------------------------- | ------------------------------------------------------------------- |
| 菜单主页骨架         | `AppShell` + `PageHeaderHero`          | `@/components/layout/AppShell` · `@/components/ui/page-header-hero` |
| 列表卡片             | `AssetCard`                            | `@/components/ui/cards/asset-card`                                  |
| 卡片网格(响应式等高) | `CardGrid`                             | `@/components/ui/cards`                                             |
| 信息流横向行卡       | `FeedCard`                             | `@/components/ui/cards`                                             |
| “+新建”占位卡        | `CreateCard`                           | `@/components/ui/cards`                                             |
| 统计/指标 tile       | `StatCard`                             | `@/components/ui/cards`                                             |
| 设置/区块卡          | `SettingsSectionCard`                  | `@/components/ui/cards`                                             |
| 通用容器卡           | `ResponsiveCard`                       | `@/components/ui`                                                   |
| 空态                 | `EmptyState`                           | `@/components/ui`                                                   |
| 加载/骨架            | `LoadingState` / `LoadingSkeleton`     | `@/components/ui`                                                   |
| 错误态               | `ErrorState`                           | `@/components/ui`                                                   |
| 弹窗                 | `Modal` / `ConfirmDialog`              | `@/components/ui`                                                   |
| 抽屉/侧滑            | `SideDrawer`                           | `@/components/common/drawers`                                       |
| mission 弹层         | `MissionDialogShell`                   | `@/components/common/dialogs`                                       |
| 按钮                 | `Button`（variant/size）               | `@/components/ui`                                                   |
| 下拉/菜单            | `DropdownMenu`                         | `@/components/ui`                                                   |
| 开关                 | `Switch`                               | `@/components/ui`                                                   |
| 提示气泡             | `Tooltip`                              | `@/components/ui/Tooltip`                                           |
| 全局 toast           | `Toast` / `useToast`                   | `@/components/ui`                                                   |
| 状态徽章(enum→tone)  | `StatusBadge`                          | `@/components/ui/badges`                                            |
| 品牌/Tier 徽章       | `ModelBadge` / `TierBadge`             | `@/components/common/badges`                                        |
| 进度条               | `ProgressBar`                          | `@/components/ui/progress`                                          |
| 日期(防水合)         | `ClientDate`                           | `@/components/common/ClientDate`                                    |
| 模型选择             | `ModelSelect`                          | `@/components/common/ModelSelect`                                   |
| mission 详情骨架     | `MissionDetailFrame` + `StageStepper`  | `@/components/common/mission-detail`                                |
| mission 列表         | `MissionGalleryView`                   | `@/components/common/missions`                                      |
| Tab 页(横向)         | `Tabs`                                 | `@/components/ui/tabs`                                              |
| 表单 Input/Textarea  | `Input` / `Textarea`                   | `@/components/ui/form`                                              |
| 分页                 | `Pagination`                           | `@/components/ui/pagination`                                        |
| 数据表格(交互网格)   | `DataTable`                            | `@/components/common/tables`                                        |
| 展示表格(纯展示)     | `Table`/`THead`/`TBody`/`Tr`/`Th`/`Td` | `@/components/ui/table`                                             |

---

## 2. components/ui — 无业务 primitive

| 组件                                                                                                                                             | 路径                              | 何时用                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------ |
| `Button`                                                                                                                                         | `ui/primitives/button.tsx`        | 所有按钮（variant: default/destructive/outline/secondary/ghost/link，size: sm/md/lg/icon） |
| `Switch`                                                                                                                                         | `ui/primitives/switch.tsx`        | 开关                                                                                       |
| `DropdownMenu`                                                                                                                                   | `ui/primitives/dropdown-menu.tsx` | 下拉/上下文菜单                                                                            |
| `Modal`                                                                                                                                          | `ui/dialogs/Modal.tsx`            | 通用弹窗（header/footer/size/ESC/遮罩关闭）                                                |
| `ConfirmDialog`                                                                                                                                  | `ui/dialogs/ConfirmDialog.tsx`    | 确认/危险操作弹窗                                                                          |
| `EmptyState`                                                                                                                                     | `ui/states/EmptyState.tsx`        | 空数据（default/search/noData/error）                                                      |
| `LoadingState` `LoadingSkeleton` `LoadingInline`                                                                                                 | `ui/states/LoadingState.tsx`      | 加载/骨架/内联 spinner                                                                     |
| `ErrorState` `ErrorInline`                                                                                                                       | `ui/states/ErrorState.tsx`        | 错误展示 + 重试                                                                            |
| `Toast` `useToast`                                                                                                                               | `ui/Toast.tsx`                    | 全局通知                                                                                   |
| `Tooltip`                                                                                                                                        | `ui/Tooltip.tsx`                  | 悬浮提示                                                                                   |
| `ResponsiveCard`(+Header/Title/Content/Footer/Actions)                                                                                           | `ui/ResponsiveCard.tsx`           | 通用卡片容器                                                                               |
| **cards/**（`AssetCard`/`StatCard`/`SectionPanelCard`/`MessageCardShell`/`CardGrid`/`FeedCard`/`CreateCard`/`SettingsSectionCard`/`asset-card`） | `ui/cards/`                       | **卡片设计系统单一归属**——所有卡 canonical 只此一处（R15 焊死），勿散落 common/            |
| `PageHeaderHero`                                                                                                                                 | `ui/page-header-hero/`            | 主页/列表页头部 hero（R14 守护主页必用）                                                   |
| `DateRangePicker`                                                                                                                                | `ui/DateRangePicker.tsx`          | 日期区间选择                                                                               |
| `AIMessageRenderer`                                                                                                                              | `ui/AIMessageRenderer.tsx`        | 渲染 AI markdown/代码                                                                      |
| `MermaidDiagram`                                                                                                                                 | `ui/MermaidDiagram.tsx`           | Mermaid 图                                                                                 |
| `TableOfContents`                                                                                                                                | `ui/TableOfContents.tsx`          | 标题目录                                                                                   |
| viewers（PDF/HTML/Reader/PreviewFrame/Thumbnail）                                                                                                | `ui/viewers/`                     | 文档/网页预览                                                                              |
| collapsible（Blockquote/Message/RagSources）                                                                                                     | `ui/collapsible/`                 | 折叠块                                                                                     |
| animations（FadeIn/SlideIn/AnimatedList）                                                                                                        | `ui/animations/`                  | 过渡动画                                                                                   |

## 3. components/common — 跨 feature 业务组件

| 组件                                                                                | 路径                                                                    | 何时用                         |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------ |
| `SideDrawer`                                                                        | `common/drawers/`                                                       | 右侧抽屉                       |
| `MissionDialogShell`                                                                | `common/dialogs/`                                                       | mission 弹层外壳               |
| `ShareModal` `SharePermissionModal`                                                 | `common/dialogs/`                                                       | 分享/权限                      |
| `Import*Dialog` `UploadFileDialog` `ExportDialog`                                   | `common/dialogs/` · `common/ExportDialog.tsx`                           | 导入/导出                      |
| `MissionDetailFrame` `StageStepper` `MissionActionGroup` `ModalShell` `DrawerShell` | `common/mission-detail/`                                                | mission 详情/执行（见标准 21） |
| `MissionGalleryView`                                                                | `common/missions/`                                                      | mission 列表网格               |
| `ModelBadge` `TierBadge`                                                            | `common/badges/`                                                        | 模型/等级徽章                  |
| `ModelSelect` `ModelBadges`                                                         | `common/ModelSelect.tsx` · `ModelBadges.tsx`                            | 模型选择/展示                  |
| `ClientDate`                                                                        | `common/ClientDate.tsx`                                                 | 防水合日期                     |
| `ErrorBoundary`                                                                     | `common/ErrorBoundary.tsx`                                              | 错误边界                       |
| `FilterPanel`                                                                       | `common/FilterPanel.tsx`                                                | 侧栏筛选                       |
| `ViewToggle`                                                                        | `common/ViewToggle.tsx`                                                 | grid/list 切换                 |
| `MarkdownViewer` `MarkdownEditor` `ReportViewer`                                    | `common/markdown-viewer/` · `common/editors/` · `common/report-viewer/` | markdown/报告渲染              |
| citations / comments / annotations                                                  | `common/citations/` `common/comments/` `common/annotations/`            | 引用/评论/批注                 |
| credits（CreditBadge/CheckinModal/InsufficientCreditsModal）                        | `common/credits/`                                                       | 积分                           |
| byok（Banner/Guard/ErrorCard/GlobalErrorModal）                                     | `common/byok/` · `common/BYOKRequiredBanner.tsx`                        | BYOK                           |
| team-topology（Canvas + 角色头像）                                                  | `common/team-topology/`                                                 | agent 团队拓扑                 |
| agent-inspector / leader-chat                                                       | `common/agent-inspector/` · `common/leader-chat/`                       | agent 调试/leader 对话         |
| skills（AppSkillsPanel/SkillsModal）                                                | `common/skills/`                                                        | 技能面板                       |
| chart-viewer（FigureRenderer/ReportChartRenderer）                                  | `common/chart-viewer/`                                                  | 图表                           |

## 3.1 components/layout — 全局骨架

`AppShell`（页壳，主页必用）· `Sidebar` · `MobileNav` — `@/components/layout/`

---

## 4. canonical 状态台账

### 4.1 已建 canonical（必须直接用；剩余自写逐步迁移）

| canonical               | 路径                         | 剩余迁移                      |
| ----------------------- | ---------------------------- | ----------------------------- |
| `Tabs`                  | `@/components/ui/tabs`       | 自写 tab 待迁（R7，数见基线） |
| `Input` / `Textarea`    | `@/components/ui/form`       | 迁调用方（Checkbox 待补）     |
| `Pagination`            | `@/components/ui/pagination` | 迁调用方                      |
| `DataTable`（数据网格） | `@/components/common/tables` | 迁交互表（R8）                |
| `Table` 等（展示原语）  | `@/components/ui/table`      | 迁展示表（R8，已清零在范围）  |

> ⚠ 以上**已有 canonical**，写新 Tab/表单/分页/表格**禁止自写**，直接 import。

### 4.2 未建缺口（须先问用户再建/自写）

| Archetype                                  | 现状                                               | 计划                        |
| ------------------------------------------ | -------------------------------------------------- | --------------------------- |
| `Checkbox`                                 | 🔴 缺                                              | 补 `ui/form/Checkbox`       |
| **`Alert`/`Banner`**（P0）                 | 🔴 31 文件内联 `bg-{c}-50 + border`                | 建 `ui/Alert`               |
| **`Tag`/`Chip`/`Pill`**（P0）              | 🔴 204 文件 `rounded-full` 标签（先 scope 关键词） | 建 `ui/Tag`                 |
| `CopyButton`                               | 🟡 27 文件 `navigator.clipboard`                   | 建 `ui/CopyButton`          |
| `SearchBar`/`SectionHeader`/`FileUploader` | 🟡 各 feature 重复                                 | 上提（详见标准 22 §4.2）    |
| `Avatar`/`ExpandableText`/`StatCard`       | 🟡 高频自写                                        | 先 scope 再建（标准 22 §4） |

> 完整提升台账（含三套迷你设计系统抽取映射）见 [标准 22 §4](../../.claude/standards/22-frontend-ui-component-governance.md)。

---

## 5. 导入约定 & 已知问题

- 优先从目录路径导入（卡片：`@/components/ui/cards/asset-card`、`@/components/ui/cards`）。
- 卡片 barrel 已全：`@/components/ui/cards` 导出全部卡 + `asset-card`。`components/common/index.ts` 历史缺口仍走目录路径。
- 颜色/字号/间距走 `lib/design/tokens.ts` + globals.css 变量，禁任意值（见标准 22 §1.5）。

---

## 6. 守护机制（pre-push 焊死，绕不过）

约定不是写进文档就算数——下面每条都有机器闸门，违规 `git push` 直接被拒（每条均已造违规实例验证拦截）：

| 守护                                                      | 管什么                                                                                                                                                                                                | 入口                   |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `audit:ui-discipline` **R1–R15**（全 hard-zero）          | 强制复用 canonical：AppShell/AssetCard/EmptyState/ErrorState/LoadingState/Modal/Tabs/Table/spinner/卡基线/Citation/MessageCardShell + **R14 页头必用 PageHeaderHero** + **R15 卡片目录只在 ui/cards** | pre-push `[4/6]`       |
| `component-placement.spec.ts`                             | ui/ vs common/ 目录归属：concern 白名单 + common 根禁散落 `.tsx` + 卡/页头不得在 common 复活                                                                                                          | pre-push `[0c]`        |
| eslint `no-restricted-globals` / `-properties`            | 禁原生 `alert()` / `confirm()`（用 `toast` / 全局 `confirm`，from `@/stores`）；`prompt` 暂留                                                                                                         | pre-commit lint-staged |
| `first-level-directory-structure` / `lib-layer-structure` | 顶层七层目录 + lib 分层白名单                                                                                                                                                                         | pre-push `[0c]`        |

**新增 canonical 组件 / concern 目录的正确姿势**：先问用户放 `ui/` 还是 `common/`（标准 22 §3）→ 建 → 登记到本索引 + 对应白名单/audit 规则。**不登记 = pre-push 拒推。**

---

**维护**：新增 canonical 组件必须登记到本索引 + 标准 22。关联 [标准 21](../../.claude/standards/21-agent-teams-presentation.md) · [标准 22](../../.claude/standards/22-frontend-ui-component-governance.md)
