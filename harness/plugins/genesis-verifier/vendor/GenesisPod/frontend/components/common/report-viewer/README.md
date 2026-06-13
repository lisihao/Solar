# Report Platform Components

> 通用报告渲染体系 —— 从 Topic Insights 沉淀，跨模块复用。

## 目录全景

```
frontend/
├─ components/common/
│  ├─ markdown-viewer/        # Wave 1: ReactMarkdown + KaTeX + 自定义渲染
│  ├─ chart-viewer/           # Wave 1: Recharts + reference 图（双通道）
│  ├─ citations/              # Wave 1: [1][2] 徽章 + 跨视图导航
│  ├─ annotations/            # Wave 2: 5 色高亮 + 线程评论 + ReportAnnotations 面板
│  ├─ ai-text-edit/           # Wave 2: 选中文本 → AI 改写 → 预览闭环
│  └─ report-viewer/          # Wave 3: 三视图骨架（continuous / chapter / quick）
├─ hooks/report/              # Wave 3: useReportRevisions 版本时间线
└─ lib/markdown/              # Wave 1: preprocessLatex / stripProseBullets / countWords / ...
```

## 三波沉淀路线

### Wave 1 — 基础设施层（commit `731bad1a8`）

| 组件                                                                                                                                                            | 来自                                  | 现位置                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------ |
| `MarkdownViewer`                                                                                                                                                | 新建（包装 createMarkdownComponents） | `components/common/markdown-viewer/` |
| `ReportChartRenderer` / `FigureRenderer`                                                                                                                        | `ai-insights/charts/`                 | `components/common/chart-viewer/`    |
| `CitationBadge` / `CitationGroup`                                                                                                                               | `ai-insights/citations/`              | `components/common/citations/`       |
| `preprocessLatex` / `stripProseBullets` / `countWords` / `createMarkdownComponents` / `splitFullReportIntoChapters` / `katexOptions` / `useReportTextProcessor` | `lib/report/`                         | `lib/markdown/`                      |

### Wave 2 — 协作 / 编辑层（commit `9d036a451`）

| 组件                                                                                  | 来自                       | 现位置                            |
| ------------------------------------------------------------------------------------- | -------------------------- | --------------------------------- |
| `AnnotatedText` / `AnnotationHighlighter` / `ChangeHighlighter` / `ReportAnnotations` | `ai-insights/annotations/` | `components/common/annotations/`  |
| `AIEditInputModal` / `AIEditPreviewModal` / `AIFloatingToolbar` / `useAIEdit`         | `ai-insights/ai-edit/`     | `components/common/ai-text-edit/` |

### Wave 3 — 视图层（本次）

| 组件                                    | 来源                                                 | 现位置                             |
| --------------------------------------- | ---------------------------------------------------- | ---------------------------------- |
| `ReportViewer` / `ReportViewModeToggle` | 新建（抽自 TopicContentPanel `reportViewMode` 切换） | `components/common/report-viewer/` |
| `useReportRevisions` Hook               | 新建（抽自 TopicContentPanel `allRevisions`）        | `hooks/report/`                    |

## 跨模块接入参考

### AI Writing 章节报告

```tsx
import { MarkdownViewer } from '@/components/common/markdown-viewer';
import { ReportViewer } from '@/components/common/report-viewer';
import { ReportAnnotations } from '@/components/common/annotations';

<ReportViewer
  activeMode={mode}
  onModeChange={setMode}
  modes={[
    {
      mode: 'continuous',
      label: '连续',
      render: () => <MarkdownViewer content={novel.fullText} />,
    },
    {
      mode: 'chapter',
      label: '章节',
      render: () => <ChapterList chapters={novel.chapters} />,
    },
  ]}
/>;
```

### Agent Playground mission 报告

```tsx
import { MarkdownViewer } from '@/components/common/markdown-viewer';
import { FigureGallery } from '@/components/common/chart-viewer';

<MarkdownViewer content={mission.reportFull?.summary ?? ''} />
<FigureGallery figures={mission.charts ?? []} />
```

### 版本历史

```tsx
import { useReportRevisions } from '@/hooks/report';

const revisions = useReportRevisions({
  current: report,
  revisions: history,
  formatDescription: ({ sources, chars }) => `${sources} 来源 · ${chars} 字`, // i18n
});
```

## 设计约定

1. **平台层不假设业务字段**。`ReportViewer.modes[i].render()` 是个回调，TI 的 `dimensionAnalyses` / Writing 的 `chapters` / Research 的 `iterations` 由调用方在 render 内处理。
2. **MarkdownViewer 的 `processText` 是核心扩展点**。引用徽章、注解高亮等都通过这一槽注入，平台不耦合具体业务。
3. **`useReportRevisions` 是纯计算 Hook**，不调 API。业务侧自行 fetch 历史，把数据传进来。
4. **批注 / AI 编辑是独立模块**。它们在 `components/common/annotations` 和 `components/common/ai-text-edit`，与 `report-viewer` 无强绑定，可单独使用。

## 不在平台层做的（保留在 TI）

- **`ChapterizedReportView`**：依赖 TI 的 `dimensionAnalyses` 元数据 + chart placeholder 系统，业务耦合深。其他模块如需章节视图，应自行实现，在 `ReportViewer.modes` 注入。
- **`QuickViewReport`**：是 TI `dimensionAnalyses` 的特定结构化投影，强业务专属。
- **`ReportEditor` (TipTap)**：编辑器选型（TipTap）是产品决策，不在 viewer 平台范围。
- **维度（dimension）/ 可信度（credibility）/ 交叉关联（CrossDimensionAnalysis）/ 刷新（RefreshType）/ 模板（ResearchTemplate）**：TI 业务专属，硬抽会污染平台。

## 落地状态（2026-04-25）

- ✅ Wave 1 / 2 / 3 全部沉淀完成
- ✅ TI 现有功能 0 回归（路径迁移 + 类型检查通过）
- ⏳ 横向推广：AI Writing / AI Research / Agent Playground 接入待跟进
