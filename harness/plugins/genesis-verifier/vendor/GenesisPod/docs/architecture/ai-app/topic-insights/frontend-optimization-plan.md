# Topic Insights 前端优化方案

> **版本**: 1.0
> **创建日期**: 2026-03-07
> **状态**: Approved
> **关联审计**: [`docs/audit/topic-insights-audit-2026-03-07.md`](../../../audit/topic-insights-audit-2026-03-07.md), [`docs/audit/frontend-topic-insights-audit-2026-03-07.md`](../../../audit/frontend-topic-insights-audit-2026-03-07.md)

---

## 1. 背景与诊断

### 1.1 审计结论

| 层面     | 满分    | 得分    | 等级         |
| -------- | ------- | ------- | ------------ |
| 后端架构 | 120     | 100     | A- (83%)     |
| 前端工程 | 80      | 44      | D+ (55%)     |
| **综合** | **200** | **144** | **C+ (72%)** |

**核心问题**: 后端是 A- 级的研究引擎，前端是 D+ 级的展示层，整体被短板限制在 C+ 水平。

### 1.2 前端各维度得分

| 维度     | 分数 | 关键问题                                    |
| -------- | ---- | ------------------------------------------- |
| 组件架构 | 4/10 | `TopicContentPanel.tsx` 6021 行单体组件     |
| 状态管理 | 6/10 | 死代码 store、`NodeJS.Timeout` 存入 Zustand |
| 用户体验 | 6/10 | 搜索无防抖，每次按键触发 API                |
| 实时更新 | 7/10 | events 无界增长，轮询与 WS 冗余             |
| 类型安全 | 5/10 | 核心接口 3-6 处重复定义                     |
| 代码质量 | 4/10 | 6021 行组件、emoji 违规、console.error      |
| 性能     | 5/10 | TopicCard 无 memo、polling+WS 双发          |
| 安全     | 7/10 | `ReportEditor.innerHTML` 需确认消毒         |

### 1.3 SOTA 差距

| 能力         | 当前         | SOTA (Perplexity/Gemini) | 差距     |
| ------------ | ------------ | ------------------------ | -------- |
| 流式内容输出 | 仅进度条     | 全文流式                 | 严重落后 |
| 引用交互     | 纯链接 `[1]` | 悬停预览 + 侧边栏联动    | 落后     |
| 组件可维护性 | 6021 行单体  | 200-500 行/组件          | 严重落后 |

### 1.4 TopicContentPanel.tsx 解剖数据

| 指标           | 值               |
| -------------- | ---------------- |
| 总行数         | 6021             |
| useState       | 24 个            |
| useEffect      | 13 个            |
| useCallback    | 11 个            |
| useMemo        | 11 个            |
| Tab 数量       | 7 个             |
| 内联 Icon 定义 | 14 个（~190 行） |
| 内部子组件     | 10+ 个           |

---

## 2. 优化目标

| 指标                   | 优化前             | 优化后                  | 提升  |
| ---------------------- | ------------------ | ----------------------- | ----- |
| TopicContentPanel 行数 | 6021               | ~600                    | -90%  |
| 最大文件行数           | 6021               | ~500                    | -92%  |
| 前端审计总分           | 44/80              | ~66/80                  | +50%  |
| 综合评分               | 144/200 (72%)      | ~166/200 (83%)          | +15%  |
| 类型重复               | 3-6 处             | 0                       | -100% |
| 内存泄漏风险           | 高（无界 events）  | 低（LRU 200）           | 消除  |
| API 调用冗余           | 高（轮询+WS 双发） | 低（WS 优先，轮询降级） | -70%  |

---

## 3. 方案总览

| 阶段     | 内容         | 耗时            | 风险 |
| -------- | ------------ | --------------- | ---- |
| Phase 0  | 清理死代码   | 0.5 天          | 极低 |
| Phase 1  | 组件拆分     | 3-4 天          | 中   |
| Phase 2  | 类型统一     | 1 天            | 低   |
| Phase 3  | 性能优化     | 2 天            | 低   |
| Phase 4  | UX 对标 SOTA | 2 天            | 中   |
| Phase 5  | 架构治理     | 1 天            | 低   |
| **总计** |              | **9.5-10.5 天** |      |

---

## 4. Phase 0: 清理死代码（0.5 天）

### 4.1 删除弃用 Store

活跃 Store 已迁移至 `frontend/stores/ai-insights/`（模块化 Slice 架构），旧单体 Store 无消费者。

```
删除:
  frontend/stores/topicInsightsStore.ts          (1316 行)
  frontend/stores/topicInsightsStore.test.ts
  frontend/stores/__tests__/topicInsightsStore.test.ts
```

**验证**: `grep -r "from.*topicInsightsStore" frontend/` 确认零引用。

### 4.2 删除内联 Icon

`TopicContentPanel.tsx` 行 204-396 定义了 14 个 SVG Icon 组件（~190 行），违反项目规范（必须使用 Lucide React）。

```
替换映射:
  DocumentIcon   → import { FileText } from 'lucide-react'
  LinkIcon       → import { Link } from 'lucide-react'
  DownloadIcon   → import { Download } from 'lucide-react'
  ChevronDownIcon→ import { ChevronDown } from 'lucide-react'
  SpinnerIcon    → import { Loader2 } from 'lucide-react' (加 animate-spin)
  TeamIcon       → import { Users } from 'lucide-react'
  ThinkingIcon   → import { Brain } from 'lucide-react'
  CredibilityIcon→ import { ShieldCheck } from 'lucide-react'
  HistoryIcon    → import { History } from 'lucide-react'
  AnnotationIcon → import { MessageSquare } from 'lucide-react'
  ListIcon       → import { List } from 'lucide-react'
  TrashIcon      → import { Trash2 } from 'lucide-react'
  TodoIcon       → import { CheckSquare } from 'lucide-react'
  FolderOpenIcon → import { FolderOpen } from 'lucide-react'
```

**预期**: -190 行。

### 4.3 清理 Emoji 违规

搜索并替换 3 处 emoji（`⚠️ ✅ 📊 🔥`）为 Lucide Icon 组件。

---

## 5. Phase 1: 组件拆分（3-4 天）

### 5.1 目标文件结构

```
frontend/components/ai-insights/topics/
├── TopicContentPanel.tsx                ← 瘦身后 ~600 行（Tab 路由 + Context）
│
├── hooks/                               ← 新建
│   ├── useAnnotations.ts                ← ~290 行
│   ├── useReportActions.ts              ← ~120 行
│   ├── useReportView.ts                 ← ~80 行
│   └── useCitationRenderer.ts           ← ~150 行
│
├── tabs/                                ← 新建
│   ├── ReportTab.tsx                    ← ~500 行
│   ├── CollaborationMessagesTab.tsx     ← ~450 行
│   ├── CredibilityTab.tsx               ← ~400 行
│   └── ReferencesTab.tsx                ← ~250 行
│
└── shared/                              ← 新建
    ├── ReportToolbar.tsx                ← ~200 行
    ├── CitationTooltip.tsx              ← ~90 行
    └── MessageCards.tsx                 ← ~200 行
```

### 5.2 行号 → 新文件映射表

| 原始行号  | 行数 | 目标文件                                                      | 说明                               |
| --------- | ---- | ------------------------------------------------------------- | ---------------------------------- |
| 204-396   | 190  | **删除**                                                      | Phase 0 已处理：内联 Icon → Lucide |
| 438-502   | 65   | `hooks/useReportActions.ts`                                   | isRegenerating、轮询、再生成       |
| 504-569   | 65   | `hooks/useReportActions.ts`                                   | 分享链接、对话框                   |
| 578-669   | 90   | `hooks/useReportView.ts`                                      | viewMode、isMaximized、快捷键      |
| 671-695   | 25   | `hooks/useReportView.ts`                                      | 键盘快捷键 useEffect               |
| 726-1017  | 290  | `hooks/useAnnotations.ts`                                     | 批注 CRUD 全部逻辑                 |
| 1026-1083 | 57   | TopicContentPanel（保留）                                     | Tab 配置                           |
| 1085-1656 | 570  | `tabs/ReportTab.tsx` + `shared/ReportToolbar.tsx`             | 报告工具栏                         |
| 1667-1913 | 250  | `tabs/ReportTab.tsx`                                          | 报告 3 视图渲染                    |
| 1915-1993 | 78   | TopicContentPanel（保留）                                     | Tab 路由分发                       |
| 2113-2305 | 190  | `hooks/useCitationRenderer.ts` + `shared/CitationTooltip.tsx` | 引用渲染                           |
| 2349-2842 | 490  | `tabs/ReportTab.tsx`                                          | 章节解析、section 状态             |
| 3020-3250 | 230  | `shared/MessageCards.tsx`                                     | 5 种消息卡片                       |
| 3298-3737 | 440  | `tabs/CollaborationMessagesTab.tsx`                           | 消息聚合 + 过滤                    |
| 4507-4792 | 285  | `tabs/CredibilityTab.tsx`                                     | Agent 活动时间线                   |
| 5449-5625 | 175  | `tabs/ReferencesTab.tsx`                                      | 证据过滤/排序/统计                 |

### 5.3 瘦身后的 TopicContentPanel

```tsx
// TopicContentPanel.tsx (~600 行)
// 职责: Tab 路由 + 共享 props 分发 + Toast

import {
  FileText,
  Users,
  ShieldCheck,
  History,
  Link,
  CheckSquare,
  FolderOpen,
} from "lucide-react";
import { ReportTab } from "./tabs/ReportTab";
import { CollaborationMessagesTab } from "./tabs/CollaborationMessagesTab";
import { CredibilityTab } from "./tabs/CredibilityTab";
import { ReferencesTab } from "./tabs/ReferencesTab";
import { ResearchCollaborationPanel } from "../collaboration/ResearchCollaborationPanel";
import { TopicCollaborationPanel } from "./TopicCollaborationPanel";
import { ResearchTimeline } from "../collaboration/ResearchTimeline";
import { RelatedResearchTab } from "./RelatedResearchTab";

export function TopicContentPanel(props: TopicContentPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>("research_collab");
  const [toast, setToast] = useState<Toast | null>(null);

  // Tab 配置
  const tabs = [
    { key: "research_collab", label: "TODO List", icon: CheckSquare },
    { key: "collaboration", label: "Collaboration", icon: Users },
    { key: "report", label: "Report", icon: FileText },
    { key: "history", label: "History", icon: History },
    { key: "credibility", label: "Credibility", icon: ShieldCheck },
    { key: "references", label: "References", icon: Link },
    { key: "related_research", label: "Related", icon: FolderOpen },
  ];

  return (
    <div className="flex h-full flex-col bg-white">
      <TabHeader tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      <div className="flex-1 overflow-hidden">
        {activeTab === "report" && (
          <ReportTab {...reportProps} onToast={setToast} />
        )}
        {activeTab === "research_collab" && (
          <ResearchCollaborationPanel {...collabProps} />
        )}
        {activeTab === "collaboration" && (
          <CollaborationMessagesTab {...msgProps} />
        )}
        {activeTab === "credibility" && <CredibilityTab {...credProps} />}
        {activeTab === "history" && <ResearchTimeline {...historyProps} />}
        {activeTab === "references" && <ReferencesTab {...refProps} />}
        {activeTab === "related_research" && (
          <RelatedResearchTab {...relatedProps} />
        )}
      </div>

      {toast && (
        <ToastNotification {...toast} onDismiss={() => setToast(null)} />
      )}
    </div>
  );
}
```

### 5.4 Hook 接口设计

#### `useAnnotations(topicId, reportId?)`

```typescript
interface UseAnnotationsReturn {
  annotations: ReportAnnotation[];
  isLoading: boolean;
  highlightedId: string | null;
  autoExpandEvidenceId: string | null;
  // CRUD
  add(data: AnnotationData): Promise<void>;
  update(id: string, updates: Partial<AnnotationData>): Promise<void>;
  remove(id: string): Promise<void>;
  resolve(id: string): Promise<void>;
  reply(id: string, reply: string): Promise<void>;
  submitAsFeedback(id: string): Promise<void>;
  // UI
  highlight(id: string | null): void;
  setAutoExpandEvidence(id: string | null): void;
}
```

#### `useReportView()`

```typescript
interface UseReportViewReturn {
  viewMode: "continuous" | "chapter" | "quick";
  isMaximized: boolean;
  sidePanelType: "history" | "annotations" | null;
  setViewMode(mode: ReportViewMode): void;
  toggleMaximize(): void;
  setSidePanel(type: "history" | "annotations" | null): void;
}
```

#### `useReportActions(topicId, report?)`

```typescript
interface UseReportActionsReturn {
  isRegenerating: boolean;
  showRegenerateDialog: boolean;
  regenerateFeedback: string;
  // Actions
  regenerate(): void;
  confirmRegenerate(feedback: string): Promise<void>;
  cancelRegenerate(): void;
  shareLink(): Promise<string>;
  deleteReport(): Promise<void>;
  setRegenerateFeedback(feedback: string): void;
}
```

#### `useCitationRenderer(evidence, reportContent?)`

```typescript
interface UseCitationRendererReturn {
  renderWithCitations(text: string): ReactNode;
  citationLocations: Map<number, { line: number; column: number }[]>;
  CitationTooltip: React.FC<{ index: number }>;
}
```

### 5.5 拆分执行顺序

```
Step 1: 创建 hooks/ 目录，逐个提取 4 个 Hook（不改变行为）
Step 2: 创建 shared/ 目录，提取 ReportToolbar、CitationTooltip、MessageCards
Step 3: 创建 tabs/ 目录，逐个提取 4 个 Tab 组件
Step 4: 瘦身 TopicContentPanel，改为 Tab 路由器
Step 5: 逐组件 git diff 验证，确保零行为变更
```

---

## 6. Phase 2: 类型统一（1 天）

### 6.1 问题：核心接口重复定义

| 接口                        | 重复位置数 | 字段差异               |
| --------------------------- | ---------- | ---------------------- |
| `UIMessage`                 | 4 处       | type 枚举值不一致      |
| `WsEvent` / `ResearchEvent` | 3 处       | data 字段类型不统一    |
| `ReportRevision`            | 3 处       | 部分缺少 `generatedAt` |
| `AgentThinking`             | 2 处       | `modelId` 可选性不同   |

### 6.2 方案：单一来源

在 `frontend/types/topic-insights.ts` 中新增统一定义，所有消费者从此文件导入。

```typescript
// frontend/types/topic-insights.ts 新增

/** 统一 WebSocket 研究事件 */
export interface ResearchWsEvent {
  id: string;
  type: ResearchEventType;
  topicId: string;
  missionId?: string;
  timestamp: string;
  data: Record<string, unknown>;
}

/** 统一 UI 消息（由 WS 事件聚合而来） */
export interface UIMessage {
  id: string;
  type: "system" | "agent" | "progress" | "leader" | "error" | "review";
  agentName?: string;
  agentRole?: string;
  content: string;
  timestamp: Date;
  progress?: number;
  status?: "success" | "error" | "in_progress";
  dimensionName?: string;
  detail?: Record<string, unknown>;
}

/** 统一 Agent 思考过程 */
export interface AgentThinking {
  agentId: string;
  agentName: string;
  agentRole: string;
  modelId?: string;
  phase: string;
  content: string;
  timestamp: string;
  dimensionName?: string;
}
```

### 6.3 涉及文件

```
需要删除内部重复定义并改为导入的文件:
  frontend/components/ai-insights/topic-content/types.ts
  frontend/components/ai-insights/topic-content/shared/types.ts
  frontend/components/ai-insights/topics/TopicContentPanel.tsx (内部定义)
  frontend/components/ai-insights/collaboration/ResearchCollaborationPanel.tsx (内部定义)
  frontend/components/ai-insights/topics/TopicResearchLayout.tsx (内部定义)
```

---

## 7. Phase 3: 性能优化（2 天）

### 7.1 wsEvents 内存控制

**问题**: `setEvents(prev => [...prev, event])` 只追加不裁剪，长时间研究导致内存和 re-render 累积。

```typescript
// 修改: 限制最多 200 条，FIFO
const MAX_EVENTS = 200;

setEvents((prev) => {
  const next = [...prev, event];
  return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
});
```

### 7.2 搜索防抖

**问题**: topic-research 列表页 `onChange` 直接触发 `fetchTopics()` API 调用，每次按键一次请求。

```typescript
// 修改: 300ms debounce
import { useDebouncedCallback } from 'use-debounce';

const debouncedSearch = useDebouncedCallback((query: string) => {
  fetchTopics({ search: query });
}, 300);

// JSX
<input onChange={(e) => debouncedSearch(e.target.value)} />
```

### 7.3 轮询与 WebSocket 仲裁

**问题**: 每 2s 轮询最多 4 个 API + WebSocket 推送相同数据，无仲裁机制。

```
策略:
  WebSocket 连接正常 → 暂停 API 轮询，降至 30s 健康检查
  WebSocket 断连     → 恢复 2s API 轮询（降级方案）

修改位置: researchSlice.ts 的 startMissionPolling()
新增参数: { wsConnected: boolean }

// researchSlice.ts
startMissionPolling(options: { wsConnected: boolean }) {
  const interval = options.wsConnected ? 30_000 : 2_000;
  this.missionPollingTimer = setInterval(() => { ... }, interval);
}
```

### 7.4 TopicCard 渲染优化

```typescript
// 修改: 添加 React.memo
export const TopicCard = React.memo(function TopicCard({ topic }: Props) {
  // ...
});
```

### 7.5 大报告分段渲染

```
方案: 对 fullReport > 10000 字符的报告启用 IntersectionObserver 懒渲染
技术: 按 ## 标题分段，只渲染视口内的章节

适用组件: tabs/ReportTab.tsx 的 continuous 视图
```

---

## 8. Phase 4: UX 对标 SOTA（2 天）

### 8.1 流式内容输出（对标 Perplexity/Gemini）

**现状**: SSE 仅推送进度百分比（`progress: 45%`），不推送正在生成的内容。用户在研究过程中只能看到进度条。

**SOTA**: Perplexity 和 Gemini 在研究过程中实时展示正在生成的文本，用户可以看到内容逐步丰富。

**方案**:

#### 后端改造

```typescript
// 新增 WebSocket 事件类型
// 文件: backend/src/modules/ai-app/topic-insights/services/core/research-event-emitter.service.ts

emitContentChunk(topicId: string, data: {
  missionId: string;
  dimensionId: string;
  dimensionName: string;
  chunk: string;          // markdown 片段
  isComplete: boolean;    // 该维度是否写完
  totalLength: number;    // 当前累计长度
}) {
  this.emit(topicId, 'dimension:content_chunk', data);
}
```

```typescript
// 在维度分析生成时调用
// 文件: 维度研究执行处，AiChatService.chat() 的 streaming 回调中

for await (const chunk of stream) {
  this.eventEmitter.emitContentChunk(topicId, {
    missionId,
    dimensionId,
    dimensionName,
    chunk: chunk.content,
    isComplete: false,
    totalLength: accumulated.length,
  });
}
```

#### 前端展示

```typescript
// 在 CollaborationMessagesTab 中增加流式内容卡片
// 新增组件: shared/StreamingContentCard.tsx

interface StreamingContentCardProps {
  dimensionName: string;
  content: string; // 累积的 markdown
  isComplete: boolean;
  totalLength: number;
}

// 渲染: ReactMarkdown + 闪烁光标动画（未完成时）
```

### 8.2 引用交互增强（对标 Perplexity）

**现状**: 引用以 `[1]` 纯链接形式存在，`CitationTooltip` 仅显示标题。

**目标**:

```
悬停 [1]:
  ┌──────────────────────────────────┐
  │ [favicon] Nature.com             │  ← 域名 + favicon
  │ Title of the Source Article      │  ← 标题
  │ 2026-02-15 · Credibility: ★★★★☆ │  ← 日期 + 可信度星级
  │                                  │
  │ "The relevant snippet from the   │  ← 原文摘要
  │  source that supports this..."   │
  │                                  │
  │ [View Source →]                   │  ← 外部链接
  └──────────────────────────────────┘

点击 [1]:
  → 右侧 References Tab 自动切换并滚动到对应条目
  → 对应条目高亮 2 秒
```

**实现位置**: `shared/CitationTooltip.tsx`（Phase 1 已提取），增强 evidence 数据展示。

---

## 9. Phase 5: 架构治理（1 天）

### 9.1 Zustand 不可序列化数据

**问题**: `NodeJS.Timeout` 存入 Zustand state，不可序列化。

```typescript
// 当前
missionPollingTimer: NodeJS.Timeout | null;

// 修改方案 A: 用 useRef 在组件层管理
// TopicDetail.tsx 中
const pollingRef = useRef<NodeJS.Timeout | null>(null);

// 修改方案 B: store 只存 boolean 标志
pollingActive: boolean; // 定时器由 middleware 管理
```

推荐方案 A（改动最小）。

### 9.2 ReportEditor XSS 审计

```
检查: ReportEditor.tsx 的 innerHTML 操作
验证: 上游数据是否经过 DOMPurify.sanitize()
如未消毒:
  import DOMPurify from 'dompurify';
  element.innerHTML = DOMPurify.sanitize(content);
```

### 9.3 console.error 清理

替换 `console.error` 为项目标准 logger（如有前端 logger）或静默处理。

---

## 10. 验证计划

### 10.1 每阶段验证

| 阶段    | 验证方式                                                                     |
| ------- | ---------------------------------------------------------------------------- |
| Phase 0 | `grep -r "topicInsightsStore" frontend/` 确认零引用；`npm run type-check`    |
| Phase 1 | 逐组件 `git diff` 审查；`npm run type-check`；手动测试 7 个 Tab 功能不变     |
| Phase 2 | `grep -r "interface UIMessage" frontend/` 确认唯一定义；`npm run type-check` |
| Phase 3 | 长时间研究场景测试内存稳定；搜索输入延迟感知测试                             |
| Phase 4 | 流式内容在 3+ 维度并行时展示正确；引用 Tooltip 数据完整                      |
| Phase 5 | `npm run verify:full` 全量验证                                               |

### 10.2 回归测试重点

```
1. 报告 3 种视图（continuous/chapter/quick）渲染正确
2. 批注 CRUD 全流程
3. 再生成报告 + 轮询 + 完成回调
4. WebSocket 事件接收和消息聚合
5. 引用标记高亮和跳转
6. 报告导出 PDF/DOCX
7. 分享链接生成
8. 版本切换和回滚
```

---

## 11. 风险与缓解

| 风险                     | 概率 | 影响 | 缓解措施                                  |
| ------------------------ | ---- | ---- | ----------------------------------------- |
| Phase 1 拆分引入回归     | 中   | 高   | 逐文件 diff 审查；每提取一个模块立即验证  |
| 类型统一遗漏消费者       | 低   | 中   | `grep -r` 全量搜索；TypeScript 编译器捕获 |
| 流式输出后端改造范围扩大 | 中   | 中   | 先用 mock 数据实现前端，后端独立迭代      |
| 性能优化引入竞态         | 低   | 高   | WS/轮询仲裁用状态机管理，明确状态转换     |

---

## 12. 附录

### A. 已有外部组件（无需重写，直接复用）

| 组件                         | 路径                                           | 说明          |
| ---------------------------- | ---------------------------------------------- | ------------- |
| `ResearchCollaborationPanel` | `collaboration/ResearchCollaborationPanel.tsx` | TODO List Tab |
| `TopicCollaborationPanel`    | `topics/TopicCollaborationPanel.tsx`           | 协作者管理    |
| `ResearchTimeline`           | `collaboration/ResearchTimeline.tsx`           | 历史 Tab      |
| `RelatedResearchTab`         | `topics/RelatedResearchTab.tsx`                | 相关研究 Tab  |
| `ChapterizedReportView`      | `reports/ChapterizedReportView.tsx`            | 章节视图      |
| `QuickViewReport`            | `reports/QuickViewReport.tsx`                  | Quick 视图    |
| `AIEditInputModal`           | `ai-edit/AIEditInputModal.tsx`                 | AI 编辑输入   |
| `AIEditPreviewModal`         | `ai-edit/AIEditPreviewModal.tsx`               | AI 编辑预览   |

### B. Store 架构（当前活跃）

```
frontend/stores/ai-insights/
├── index.ts              ← 组合入口 (129 行)
├── topicSlice.ts         ← Topics + Dimensions + Schedule (237 行)
├── reportSlice.ts        ← Reports + Evidence + Logs (200+ 行)
└── researchSlice.ts      ← Refresh + Mission + Team + TODOs (200+ 行)
```

### C. API 客户端

```
frontend/lib/api/topic-insights.ts (1500+ 行)
  - 30+ API 函数
  - fetchWithAuth 自动注入认证
  - 401 自动刷新 token
  - SSE 流: createRefreshProgressStream()
  - 导出轮询: waitForExportCompletion()
```
