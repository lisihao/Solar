# Topic Insights 前端架构审计报告

**审计日期**: 2026-03-07
**审计范围**: Topic Insights 前端全量（8 维度）
**审计员**: Arch Auditor Agent v2.0
**Git 状态**: Clean (main branch, HEAD: e5a60607d)

---

## 审计文件清单（实际读取）

| 文件                                                                 | 行数     | 角色                 |
| -------------------------------------------------------------------- | -------- | -------------------- |
| `frontend/app/ai-insights/topic-research/page.tsx`                   | 462      | 列表页面             |
| `frontend/app/ai-insights/topic/[topicId]/page.tsx`                  | 104      | 详情页面（直链路由） |
| `frontend/app/share/topic/[id]/page.tsx`                             | 1022     | 公开分享页面         |
| `frontend/components/ai-insights/topics/TopicDetail.tsx`             | 310      | 核心详情组件         |
| `frontend/components/ai-insights/topics/TopicResearchLayout.tsx`     | 419      | 两栏布局组件         |
| `frontend/components/ai-insights/topics/TopicContentPanel.tsx`       | **6021** | 内容面板（核心）     |
| `frontend/components/ai-insights/topics/TopicCard.tsx`               | 493      | 卡片组件             |
| `frontend/stores/topicInsightsStore.ts`                              | 1315     | 全量 Zustand store   |
| `frontend/hooks/useResearchWebSocket.ts`                             | 562      | WebSocket hook       |
| `frontend/components/ai-insights/reports/ReportEditor.tsx`           | 1357     | 报告编辑器           |
| `frontend/components/ai-insights/collaboration/ResearchTimeline.tsx` | 1736     | 研究时间线           |

---

## 总分汇总

| #        | 维度     | 满分   | 得分      | 状态 |
| -------- | -------- | ------ | --------- | ---- |
| 1        | 组件架构 | 10     | **4**     | 严重 |
| 2        | 状态管理 | 10     | **6**     | 警告 |
| 3        | 用户体验 | 10     | **6**     | 警告 |
| 4        | 实时更新 | 10     | **7**     | 良好 |
| 5        | 类型安全 | 10     | **5**     | 严重 |
| 6        | 代码质量 | 10     | **4**     | 严重 |
| 7        | 性能     | 10     | **5**     | 警告 |
| 8        | 安全     | 10     | **7**     | 良好 |
| **总分** |          | **80** | **44/80** |      |

---

## D1: 组件架构 [4/10] — 严重

### 核心问题

**TopicContentPanel.tsx 是 6021 行的单体组件。** 这是本次审计最严重的发现。

实测文件尺寸：

```
6021  TopicContentPanel.tsx
1736  ResearchTimeline.tsx
1357  ReportEditor.tsx
1247  TopicTeamPanel.tsx
1101  TodoDetailPanel.tsx
991   ChapterizedReportView.tsx
947   ResearchCollaborationPanel.tsx
```

`TopicContentPanel.tsx` 内部包含（在单个文件中）：

- 7 种 tab 的完整渲染逻辑（report / collaboration / references / credibility / research_collab / history / related_research）
- 3 种报告视图模式（continuous / chapter / quick）
- 批注系统完整逻辑（创建、更新、删除、解析）
- AI 编辑功能（useAIEdit hook 内联集成）
- WebSocket 消息转换层（将 WsEvent 转为 UIMessage 的 ~150 行 useMemo）
- 引用高亮点击导航系统
- 可见性切换逻辑
- 报告重新生成逻辑
- 全局 `citationNavigation` 模块副作用注册
- 报告内容 `data-export-content` 属性标注

**数据：** 6021 行中，内联 interface / type 定义有 10 个，内部局部组件函数约 15 个（如 `function DocumentIcon`、`function AnnotationsPanel` 等）。

### 双路由路径问题

`TopicDetail` 组件有两种入口路径：

1. `topic-research/page.tsx` → `setSelectedTopic(topic)` → 在同一页面内 inline 渲染 `<TopicDetail />`，URL 不变，无深链接，后退需靠 state 而非浏览器历史
2. `topic/[topicId]/page.tsx` → 真实路由，URL 变化，本地 state 直接调 `api.getTopic()`，绕过 store

结果：同一组件用两种不同的状态管理策略，行为不一致。从路径 1 进入时，主题已在 store 中；从路径 2 进入时，主题在本地 state 中，进入 `TopicDetail` 后再通过 `setCurrentTopic(topic)` 同步到 store。

### 图标定义方式

`topic-research/page.tsx` 和 `share/topic/[id]/page.tsx` 均在文件顶部内联定义 SVG 图标组件（PlusIcon、SearchIcon、LoaderIcon、FolderOpenIcon 等）。违反"禁止使用 emoji，使用 Lucide React"规范，且形成代码重复。TopicContentPanel 混用了 lucide-react（import Shield, Maximize2, X 等）和内联 SVG，两套并存。

### 扣分依据

- TopicContentPanel 6021 行单体 (-3)
- 双路由入口行为不一致 (-2)
- 大量内联图标违反 Lucide 规范 (-1)

---

## D2: 状态管理 [6/10] — 警告

### 优点

- `topicInsightsStore.ts` 结构清晰，按 Topics / Dimensions / Reports / Mission / TODOs 分区，注释完整
- 单个 store 统一管理所有 topic 相关状态，避免跨组件 prop drilling
- `isReportNotFoundError()` 辅助函数正确区分"404 是正常情况"和真正的错误，体现了业务语义
- `resetTopicData()` 设计合理，切换专题时保留 topics 列表但清除详情数据
- `patchTopic()` 允许组件自行完成 API 调用后同步 store，避免重复请求

### 问题

**问题 1: 存在两个 Store 同时维护 topic 相关状态**

`stores/ai-insights/topicSlice.ts` (236 行) 和 `stores/topicInsightsStore.ts` (1315 行) 均定义了 `topics`, `dimensions`, `schedule`, `stats`, `templates` 等相同字段。前者通过 `stores/ai-insights/index.ts` 组合但实际只有 1 个消费者（`stores/ai-insights/__tests__`），实际组件全部消费 `topicInsightsStore`。`topicSlice` 是死代码或历史遗留。

**问题 2: missionPollingInterval 存入 store 违反关注点分离**

`missionPollingInterval: NodeJS.Timeout | null` 是浏览器运行时句柄，不应存入 Zustand state。Zustand state 应是可序列化的纯数据（用于 persist 或 devtools 检查）。Timeout 句柄存入 state 意味着无法使用 `persist` 中间件，且 devtools 里会显示无意义的值。正确做法是用 `useRef` 或 module-level 变量存储。

**问题 3: polling 与 WebSocket 双重数据源**

研究进度同时通过 HTTP polling（`startMissionPolling` 每 2s）和 WebSocket（`useResearchWebSocket`）推送。两者都更新 `refreshProgress`，`isRefreshing` 等字段。`ResearchCollaborationPanel` 注释明确说"进度数据优先从 WebSocket 实时事件获取，这里只设置基础值，实际进度会在 useMemo 中通过 WebSocket 事件覆盖"，说明存在竞争和覆盖关系，但无明确的去抖动或优先级机制。

**问题 4: teamMessages / agentActivities 硬编码 limit**

`getTeamMessages(topicId, { limit: 100 })` 和 `getAgentActivities(topicId, { limit: 200 })` 在 4 处分别调用，limit 值不一致（同一函数有时传 100 有时传 200），无分页，长研究任务后数据截断。

### 扣分依据

- 双 store 导致死代码/混淆 (-1)
- `NodeJS.Timeout` 存入 Zustand state (-1)
- polling + WS 双重数据源无明确仲裁 (-1)
- 硬编码 limit 不一致 (-1)

---

## D3: 用户体验 [6/10] — 警告

### 优点

- 左侧 TeamPanel 支持折叠，节省屏幕空间
- 研究进行中有 `animate-pulse` 状态指示
- 分享页有阅读进度条 + 浮动导航菜单，体验好
- 标签页可通过 `initialView` URL param 直接跳转
- TopicCard 有明确的空状态提示和 CTA

### 问题

**问题 1: 搜索无防抖**

```tsx
// topic-research/page.tsx line 344
onChange={(e) => setSearchQuery(e.target.value)}
```

`searchQuery` 变化直接触发 `loadTopics`（通过 useEffect 依赖），每次按键都发一次 API 请求，无 debounce。

**问题 2: 删除确认使用 `window.confirm()`**

```tsx
if (!confirm(t("topicResearch.confirmDelete"))) return;
```

`window.confirm` 在现代 UI 中不可接受，阻塞主线程，样式无法定制，无法本地化对话框按钮文字，移动端体验差。同样问题在 `ResearchTodoList.tsx` 中也存在。

**问题 3: 双路由入口导致浏览器历史断裂**

从列表页进入详情时（`setSelectedTopic(topic)`），URL 不变，用户无法：

- 刷新页面保持在详情视图
- 将详情页面加入书签
- 使用浏览器后退按钮

与 `/topic/[topicId]` 直链路由形成割裂体验。

**问题 4: 错误展示全局化但不明确**

store 的 `error` 字段是单个 string，被多个 action 共同写入。当 `fetchDimensions` 和 `fetchLatestReport` 同时失败时，后者会覆盖前者的错误。UI 仅展示一个错误横幅。

**问题 5: 加载状态粒度粗**

`isLoadingReport` 覆盖整个报告区，当只有部分数据（如维度）在加载时，整个报告区域也显示 skeleton。无骨架屏（skeleton），只有 spinner。

### 与 SOTA 产品对比

| 功能         | 本产品         | Perplexity / Notion AI | Gap |
| ------------ | -------------- | ---------------------- | --- |
| 搜索防抖     | 无             | 300-500ms              | 高  |
| 删除确认     | window.confirm | 自定义 Modal           | 高  |
| 实时研究进度 | 轮询+WS        | SSE/WS 纯推送          | 中  |
| 报告导航     | 章节 Tab       | 侧边目录 + 锚点滚动    | 中  |
| 空状态引导   | 有             | 有（更丰富的动效）     | 低  |
| 移动端适配   | 基础响应式     | 专门的移动端视图       | 中  |

### 扣分依据

- 搜索无防抖 (-1)
- window.confirm 删除确认 (-1)
- 双路由入口 UX 断裂 (-1)
- 无骨架屏 (-1)

---

## D4: 实时更新 [7/10] — 良好

### 优点

- `useResearchWebSocket` 结构清晰：JWT auth handshake、自动加入/离开 topic room、完整事件类型定义（23 种事件）
- Phase 5 Sync 机制：重连后自动请求 `sync:request`，获取服务端最新状态，恢复进度
- `connectingRef` 防重复连接，cleanup 正确清除所有 listener
- Mission polling 有 401 检测，session 过期时自动停止避免刷屏
- 健康检查机制：轮询中调用 `getMissionHealth`，检测 stuck mission
- `todo:reviewing` / `todo:reviewed` 审核事件覆盖

### 问题

**问题 1: events 数组无上限，存在内存泄漏风险**

```typescript
// useResearchWebSocket.ts line 335
setEvents((prev) => [...prev, event]);
```

events 数组只追加，不裁剪。长时间研究（数小时）会积累数百个事件在 React state 中，每次 append 触发所有消费组件 re-render。应限制为最近 N 条（如 500）。

**问题 2: polling 和 WebSocket 并行**

见 D2-问题3。两者同时运行时，`missionStatus` 可能被 polling 响应覆盖掉 WS 推送的最新状态（因为 polling 是 2s 间隔，WS 是即时的）。

**问题 3: setTimeout(100ms) 硬延迟**

```typescript
// useResearchWebSocket.ts line 282
setTimeout(() => {
  if (socket.connected) {
    // sync:request
  }
}, 100);
```

使用 magic 100ms 等待 join:topic 被处理。应改为 join:topic 的 ack 回调。

**问题 4: TopicDetail useEffect 中对 WsEvent 的处理只看 `wsEvents[wsEvents.length - 1]`**

```typescript
const latestEvent = wsEvents[wsEvents.length - 1];
if (latestEvent.type === 'todo:completed') { ... }
```

如果在两次 render 间同时到达多个事件，只处理最后一个。其他事件被静默忽略。

### 扣分依据

- events 数组无界 (-1)
- setTimeout magic number (-1)
- 最新事件处理逻辑丢事件 (-1)

---

## D5: 类型安全 [5/10] — 严重

### 核心问题：严重的类型重复定义

以下接口在代码库中有 **3-6 个重复定义**：

| 接口             | 定义位置                                                                                                                              | 重复数  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `WsEvent`        | TopicContentPanel / TopicResearchLayout / TopicContentContext / ResearchCollaborationPanel / TodoDetailPanel / topic-content/types.ts | **6个** |
| `ReportRevision` | TopicContentPanel / TopicResearchLayout / ReportEditPanel / ReportRevisionHistory / topic-content/types.ts / TopicContentContext      | **6个** |
| `ResearchEvent`  | TopicContentPanel (内联) / topic-content/shared/types.ts / topic-content/types.ts / TopicContentContext / TopicCollaborationPanel     | **5个** |
| `UIMessage`      | TopicContentPanel (内联) / topic-content/shared/types.ts / topic-content/types.ts                                                     | **3个** |
| `MessageDetail`  | TopicContentPanel (内联) / topic-content/shared/types.ts / topic-content/types.ts                                                     | **3个** |
| `AgentThinking`  | TopicContentPanel (内联) / topic-content/shared/types.ts / topic-content/types.ts / TopicContentContext                               | **4个** |

`topic-content/types.ts` 和 `topic-content/shared/types.ts` 都导出同名接口，内容高度相似但不完全相同（字段有差异）。组件各自选择引用哪个或直接内联，导致实际类型不统一。

### 类型安全缺失

`data: unknown` 在 WsEvent 中使用是好的，但消费侧（如 `TopicContentPanel` 的 useMemo 转换 ~150 行）使用大量类型断言访问字段，如：

```typescript
// 隐式假设 data 是特定结构
(event.data as Record<string, unknown>).agentName;
```

缺少运行时验证（zod 或 type guard）。

### `record<string, unknown>` 的不安全强转

```typescript
// TopicDetail.tsx line 153
const saved = (topic.topicConfig as Record<string, unknown> | undefined)
  ?.researchDepth as string | undefined;
```

双重 as 断言是规避类型检查的手段，`topicConfig` 的实际类型应在 `types/topic-insights.ts` 中定义结构字段。

### 扣分依据

- 核心接口 3-6 处重复定义 (-3)
- WsEvent.data 无运行时验证 (-1)
- 双重 as 断言 (-1)

---

## D6: 代码质量 [4/10] — 严重

### TopicContentPanel 6021 行问题（再次强调）

单个文件承担了过多职责，是本模块最大的架构债务。具体表现：

1. **局部组件未抽取**：文件内部定义了约 15 个局部 SVG 图标组件函数（DocumentIcon、LinkIcon、ShieldIcon 等），这些完全可以复用 `lucide-react`。
2. **内联 TabType**：`type TabType = 'report' | 'collaboration' | ...` 在第 86 行定义，与 `topic-content/types.ts` 中的定义并列，没有统一。
3. **深度嵌套逻辑**：报告视图切换、批注逻辑、AI 编辑逻辑交织在同一个 `useCallback` 和 `useMemo` 树中。

### console.log 违规

```tsx
// topic-research/page.tsx line 249
console.error("Failed to copy link:", err);
```

规范要求使用 `logger`，此处使用 `console.error`。这是代码中唯一的违规点（其他地方已正确使用 logger），但违反了规范。

### window.confirm 反模式

共 3 处使用 `window.confirm()`（topic-research/page、TopicResearchTab、ResearchTodoList），均应替换为 Modal 组件。

### Emoji 违规

```tsx
// share/topic/[id]/page.tsx line 413
parts.push(`- ⚠️ ${s}\n`);
// TopicContentPanel.tsx line 3162
<span className="text-lg">{isPassed ? '✅' : '⚠️'}</span>
// share/topic/[id]/page.tsx line 875
<span className="mb-4 text-5xl">📊</span>
```

规范明确禁止 emoji，应使用 Lucide 图标。

### 搜索无防抖（重复）

从 `onChange` 到 API 请求路径：`setSearchQuery` → useEffect deps 变化 → `loadTopics()` → `fetchTopics()` → `api.getTopics()`。无任何节流或防抖。

### 内联 SVG 路径重复

`topic-research/page.tsx` 中有 8 个内联 SVG 组件（AllIcon、MacroIcon、TechnologyIcon、CompanyIcon 等），每个都是完整的 JSX。同样的文档图标 SVG path (`d="M9 12h6m-6 4h6m2 5H7..."`) 出现在至少 4 个不同文件中。

### 扣分依据

- 6021 行单体文件 (-2)
- 类型定义大量重复 (-1)
- console.error 违规 (-1)
- emoji 使用违规 (-1)
- window.confirm 反模式 (-1)

---

## D7: 性能 [5/10] — 警告

### TopicCard 无 memo

`TopicCard` 是列表中的叶子组件，每次父组件（topic-research/page）状态变化（如 `searchQuery` 输入）都会重渲染所有卡片。`TopicCard` 未使用 `React.memo`。

### TopicContentPanel useMemo 依赖项

`revisions` useMemo 的依赖项包含 `currentReport?.id`：

```typescript
// TopicDetail.tsx line 256
const revisions = useMemo(
  () => safeReports.map((r) => ({...})),
  [safeReports, currentReport?.id]
);
```

`currentReport?.id` 不影响 `revisions` 的映射逻辑（revisions 只依赖 `safeReports`），是多余的依赖项，会导致额外的 memoize miss。

### WebSocket events 无界增长导致 re-render

见 D4-问题1。每次 WebSocket 事件到来，`setEvents((prev) => [...prev, event])` 创建新数组，触发所有消费 `events` 的组件 re-render。包括 `TopicContentPanel` 的 3313 行处的 `useMemo`（~150 行的消息转换）。

### 搜索每次按键触发 API

见 D3-问题1。

### mission polling + 健康检查 = 每次 2s 最多 3 个请求

```typescript
// topicInsightsStore.ts startMissionPolling
setInterval(async () => {
  await api.getMission(topicId);          // 1 req
  if (pollCount % 3 === 0) {
    await api.getTeamMessages(...)         // 2 req
    await api.getAgentActivities(...)      // 3 req
  }
  await api.getMissionHealth(topicId);   // 4 req
}, 2000);
```

每 2 秒最多 4 次 API 请求，且全部串行（健康检查在 if isActive 块内）。在 WS 已推送实时数据的情况下，polling 完全是冗余的。

### 分享页 generateSectionContent / generateFullReportContent 在渲染时计算

`share/topic/[id]/page.tsx` 中的 `generateSectionContent(report, selectedSection)` 在 JSX render 中直接调用（未 memo），每次 render 都重新执行。对于大型报告（含多个维度分析的长文本），这是一个潜在的性能热点。

### 扣分依据

- TopicCard 无 memo (-1)
- polling + WS 双重机制冗余 (-1)
- events 数组无界导致高频 re-render (-1)
- 搜索无防抖 (-1)
- generateSectionContent 未 memo (-1)

---

## D8: 安全 [7/10] — 良好

### 优点

- `ReactMarkdown` 是安全的 Markdown 渲染方式，相比 `dangerouslySetInnerHTML` 不会执行内联 JS
- WebSocket JWT auth 在 handshake 时传递，有 `auth:error` 事件处理
- `useResearchWebSocket` 检查 `tokens?.accessToken`，无 token 时拒绝连接
- 分享页不依赖 Zustand store，独立状态，避免认证状态泄漏
- `share/topic/[id]` 调用的是 `getSharedTopic` / `getSharedTopicLatestReport` 独立 API，语义明确

### 问题

**问题 1: ReportEditor.tsx 的 innerHTML 操作**

```typescript
// ReportEditor.tsx line 83
tempDiv.innerHTML = html;
// line 129
return tempDiv.innerHTML;
```

`applyAnnotationHighlightsToHtml` 函数将 AI 生成的报告 HTML 注入 `tempDiv.innerHTML`，然后操作 DOM tree。如果 `html`（来自 `markdownToHtml` 转换）未经消毒，可能存在 XSS 风险。需要确认 `markdownToHtml` 是否使用 DOMPurify 或类似库。

**问题 2: 分享页 Emoji 注入 Markdown**

```typescript
// share/topic/[id]/page.tsx line 409
parts.push(`- 🔥 ${s}\n`);
```

`s` 来自后端 `sr.forInvestors.opportunities[]`，是 AI 生成内容。将其直接插入 Markdown 字符串然后通过 `ReactMarkdown` 渲染是安全的（ReactMarkdown 不执行 JS），但这是 AI 内容直接渲染，需要确认后端有内容过滤。

**问题 3: window.location.origin 在 SSR 时不可用**

```tsx
// topic-research/page.tsx line 244
const url = `${window.location.origin}/ai-insights/topic/${topicId}`;
```

此代码在 `handleCopyLink` 函数中（onClick handler），仅客户端执行，安全。但第 454 行：

```tsx
? `${typeof window !== 'undefined' ? window.location.origin : ''}/ai-insights/topic/${shareModalTopic.id}`
```

使用了 SSR guard，但 `window !== undefined` 的 ternary 将产生水合不一致（初始渲染空字符串，客户端渲染完整 URL）。应改用 `config.siteUrl` 或 `useEffect` 中设置。

### 扣分依据

- innerHTML 操作未确认消毒 (-2)
- window.location.origin SSR 水合风险 (-1)

---

## 架构债务优先级矩阵

| 优先级 | 问题                                             | 维度  | 影响                 | 修复成本 |
| ------ | ------------------------------------------------ | ----- | -------------------- | -------- |
| **P0** | TopicContentPanel 6021 行，必须拆分              | D1/D6 | 高（可维护性崩溃）   | 高       |
| **P0** | 搜索无防抖，每次按键触发 API                     | D3/D7 | 中（后端压力）       | 低       |
| **P0** | `window.confirm` 删除确认                        | D3/D6 | 中（UX 极差）        | 低       |
| **P1** | `WsEvent` / `ReportRevision` 等接口 6 处重复定义 | D5    | 高（类型不一致）     | 中       |
| **P1** | events 数组无界增长                              | D4/D7 | 中（内存 + 性能）    | 低       |
| **P1** | Polling + WS 双数据源冗余，应停用 polling        | D4/D7 | 中（资源浪费）       | 中       |
| **P1** | emoji 违规（⚠️ ✅ 📊 🔥）                        | D6    | 低（规范违反）       | 低       |
| **P1** | `console.error` 违规                             | D6    | 低（规范违反）       | 低       |
| **P2** | `missionPollingInterval` 存入 Zustand state      | D2    | 中（架构不纯净）     | 低       |
| **P2** | 双 store（topicSlice 死代码）                    | D2    | 低（混淆）           | 低       |
| **P2** | TopicCard 无 `React.memo`                        | D7    | 低（列表卡片重渲染） | 低       |
| **P2** | ReportEditor innerHTML 需确认 DOMPurify 覆盖     | D8    | 高（潜在 XSS）       | 中       |
| **P2** | setTimeout(100ms) magic number 改为 ack 回调     | D4    | 低（偶发 race）      | 低       |
| **P3** | 双路由入口 UX 不一致（inline vs route）          | D1/D3 | 中（体验）           | 高       |
| **P3** | 无骨架屏（只有 spinner）                         | D3    | 低（体验）           | 中       |
| **P3** | generateSectionContent 未 memo                   | D7    | 低（分享页）         | 低       |

---

## 必须处理（P0 — 本迭代）

- [ ] **为搜索添加 debounce**：在 `searchQuery` 变化到 `loadTopics()` 调用之间加 300ms debounce（可用 `useCallback` + setTimeout，或引入 `use-debounce`）
- [ ] **将 window.confirm 替换为 Modal**：`topic-research/page.tsx:235`、`TopicResearchTab.tsx:164`、`ResearchTodoList.tsx:402` 三处均需替换为系统设计已有的 Dialog/Modal 组件
- [ ] **启动 TopicContentPanel 拆分计划**：将 7 个 tab 的渲染逻辑各自提取为独立组件文件（ReportTab.tsx、CollaborationTab.tsx 等），目标拆分后每文件 <500 行

## 计划处理（P1 — 下次迭代）

- [ ] **统一 WsEvent / ReportRevision 等接口**：清理 `topic-content/types.ts` 和 `topic-content/shared/types.ts` 的重复，保留一处，其他 import。消除 `TopicContentPanel` 等文件中的内联重复定义
- [ ] **为 events 数组添加上限**：`useResearchWebSocket` 中 `setEvents((prev) => [...prev.slice(-500), event])`
- [ ] **停用 mission polling，改为纯 WS 驱动**：WS 已覆盖所有进度事件，polling 是备用方案。应将 polling 降级为 WS 断连时的 fallback，而非默认并行
- [ ] **修复 emoji 违规**：替换为 Lucide 图标（AlertTriangle、CheckCircle、BarChart2）
- [ ] **修复 console.error**：`topic-research/page.tsx:249` 改为 `logger.error`

## 长期改进（P2/P3）

- [ ] 清理 `stores/ai-insights/topicSlice.ts` 死代码（确认无消费者后删除）
- [ ] 将 `missionPollingInterval` 从 Zustand state 移出，改用 module-level ref 或 useRef 管理
- [ ] 统一双路由入口：`topic-research/page.tsx` 中点击卡片改为 `router.push('/ai-insights/topic/' + topic.id)` 实现真实路由跳转
- [ ] 为 TopicCard 添加 `React.memo`
- [ ] 确认 `markdownToHtml` 是否对 HTML 进行 DOMPurify 消毒，若无，在 `applyAnnotationHighlightsToHtml` 中加入

---

_评分模型: 自定义 8 维度（前端专项）_
_下次建议审计: 2026-04-07_
_报告工具: Arch Auditor Agent v2.0_
