# Topic Research 前端设计文档

> 专题研究模块前端架构设计
> 设计参考：AI Teams + AI Studio + NotebookLM

---

## 一、路由结构

```
/topic-research
├── /                           # 专题列表页
├── /create                     # 创建专题页（向导模式）
└── /[topicId]                  # 专题工作区（核心页面）
    ├── ?tab=research           # 研究 Tab（默认）
    ├── ?tab=reports            # 报告 Tab
    ├── ?tab=evidence           # 证据 Tab
    └── ?tab=settings           # 设置 Tab
```

---

## 二、页面结构设计

### 2.1 专题列表页 (`/topic-research/page.tsx`)

#### 布局

```
┌──────────────────────────────────────────────────────────────┐
│  Header                                                       │
│  ┌──────┐                                                     │
│  │ Icon │  专题研究 Topic Research                   [新建] │
│  └──────┘  多维度深度研究平台                                │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ 🔍 搜索专题...                                        │   │
│  └──────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────┤
│  Content                                                     │
│                                                              │
│  [我的专题]  [发现]  [已归档]                                │
│                                                              │
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌─────────┐          │
│  │ Topic  │  │ Topic  │  │ Topic  │  │  新建   │          │
│  │ Card 1 │  │ Card 2 │  │ Card 3 │  │  专题   │          │
│  │        │  │        │  │        │  │   +     │          │
│  │ 5个维度│  │ 3个维度│  │ 8个维度│  │         │          │
│  │ 更新2h │  │ 更新1d │  │ 更新3d │  │         │          │
│  └────────┘  └────────┘  └────────┘  └─────────┘          │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

#### 核心组件

```tsx
<AppShell>
  <TopicResearchListPage>
    {/* Header */}
    <PageHeader
      title="专题研究"
      subtitle="多维度深度研究平台"
      icon={<ResearchIcon />}
      actions={
        <Button onClick={handleCreate}>
          <PlusIcon /> 新建专题
        </Button>
      }
    />

    {/* Tabs */}
    <TabNavigation
      tabs={["我的专题", "发现", "已归档"]}
      activeTab={activeTab}
      onChange={setActiveTab}
    />

    {/* Search */}
    <SearchBar
      placeholder="搜索专题..."
      value={searchQuery}
      onChange={setSearchQuery}
    />

    {/* Topics Grid */}
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {topics.map((topic) => (
        <TopicCard
          key={topic.id}
          topic={topic}
          onClick={() => router.push(`/topic-research/${topic.id}`)}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onArchive={handleArchive}
        />
      ))}

      {/* Create New Card */}
      <CreateTopicCard onClick={handleCreate} />
    </div>
  </TopicResearchListPage>
</AppShell>
```

---

### 2.2 创建专题向导 (`/topic-research/create/page.tsx`)

#### 多步骤向导流程

```
Step 1: 基本信息
  - 专题名称（必填）
  - 专题描述
  - 研究目标
  - 标签

Step 2: 维度配置
  - 选择研究维度（技术、市场、竞品...）
  - 自定义维度
  - 维度权重设置

Step 3: 数据源配置
  - 搜索引擎（Google, Bing, Perplexity）
  - 知识库选择
  - 关键词设置
  - 时间范围

Step 4: AI 配置
  - 选择 AI 模型
  - 选择 AI Agent（分析师、研究员、批评家...）
  - 研究深度（快速/标准/深度）
  - 自动刷新配置

Step 5: 确认创建
  - 预览配置
  - 创建并启动初始研究
```

#### 核心组件

```tsx
<CreateTopicWizard>
  <WizardStep step={1}>
    <BasicInfoForm
      name={name}
      description={description}
      objectives={objectives}
      tags={tags}
      onChange={handleBasicInfoChange}
    />
  </WizardStep>

  <WizardStep step={2}>
    <DimensionSelector
      dimensions={dimensions}
      onAddDimension={handleAddDimension}
      onRemoveDimension={handleRemoveDimension}
      onWeightChange={handleWeightChange}
    />
  </WizardStep>

  <WizardStep step={3}>
    <DataSourceConfig
      searchEngines={searchEngines}
      knowledgeBases={knowledgeBases}
      keywords={keywords}
      timeRange={timeRange}
      onChange={handleDataSourceChange}
    />
  </WizardStep>

  <WizardStep step={4}>
    <AIConfigForm
      model={model}
      agents={agents}
      depth={depth}
      autoRefresh={autoRefresh}
      onChange={handleAIConfigChange}
    />
  </WizardStep>

  <WizardStep step={5}>
    <ConfigPreview
      config={wizardData}
      onConfirm={handleCreateTopic}
      onBack={handleBack}
    />
  </WizardStep>
</CreateTopicWizard>
```

---

### 2.3 专题工作区 (`/topic-research/[topicId]/page.tsx`)

#### 布局（NotebookLM 风格）

```
┌─────────────────────────────────────────────────────────────────┐
│  Toolbar                                                         │
│  ← 返回  |  专题名称  |  [刷新] [导出] [设置] [...]             │
├─────────────────────────────────────────────────────────────────┤
│  Tabs: [研究] [报告] [证据] [设置]                               │
├──────────────┬──────────────────────────────────────────────────┤
│              │                                                   │
│  Dimension   │  Content Area                                    │
│  Navigator   │                                                   │
│  (左侧栏)    │  ┌─────────────────────────────────────────┐    │
│              │  │  Dimension Report Viewer                 │    │
│  ○ 技术趋势  │  │                                         │    │
│  ● 市场分析  │  │  ## 市场分析报告                         │    │
│  ○ 竞品对比  │  │                                         │    │
│  ○ 用户需求  │  │  ### 市场规模                            │    │
│  ○ 商业模式  │  │  据统计 [1][2]，2024年市场规模...        │    │
│              │  │                                         │    │
│  [+ 添加维度]│  │  ### 增长趋势                            │    │
│              │  │  行业报告 [3] 显示...                    │    │
│              │  │                                         │    │
│              │  └─────────────────────────────────────────┘    │
│              │                                                   │
│              │  ┌─────────────────────────────────────────┐    │
│              │  │  Evidence Panel                          │    │
│              │  │  [1] 2024 Tech Market Report (gartner)  │    │
│              │  │  [2] Industry Analysis Q4 2024 (idc)    │    │
│              │  │  [3] Growth Forecast 2025 (forrester)   │    │
│              │  └─────────────────────────────────────────┘    │
│              │                                                   │
├──────────────┴──────────────────────────────────────────────────┤
│  Status Bar: 最后更新: 2小时前 | 5个维度 | 23条证据 | 自动刷新: 开│
└─────────────────────────────────────────────────────────────────┘
```

#### 核心组件

```tsx
<AppShell>
  <TopicWorkspace topicId={topicId}>
    {/* Toolbar */}
    <WorkspaceToolbar
      topic={currentTopic}
      onBack={() => router.push("/topic-research")}
      onRefresh={handleRefresh}
      onExport={handleExport}
      onSettings={handleSettings}
    />

    {/* Tab Navigation */}
    <WorkspaceTabs
      activeTab={activeTab}
      onChange={setActiveTab}
      tabs={[
        { id: "research", label: "研究", icon: <SearchIcon /> },
        { id: "reports", label: "报告", icon: <FileIcon /> },
        { id: "evidence", label: "证据", icon: <DatabaseIcon /> },
        { id: "settings", label: "设置", icon: <SettingsIcon /> },
      ]}
    />

    {/* Main Content */}
    <div className="flex flex-1 overflow-hidden">
      {/* Left: Dimension Navigator */}
      <DimensionNav
        dimensions={dimensions}
        activeDimension={activeDimension}
        onSelectDimension={setActiveDimension}
        onAddDimension={handleAddDimension}
        onEditDimension={handleEditDimension}
        onDeleteDimension={handleDeleteDimension}
      />

      {/* Right: Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeTab === "research" && (
          <ResearchTab
            dimension={activeDimension}
            report={activeDimensionReport}
            onRefresh={handleRefreshDimension}
          />
        )}
        {activeTab === "reports" && (
          <ReportsTab
            topic={currentTopic}
            reports={reports}
            onGenerateReport={handleGenerateReport}
          />
        )}
        {activeTab === "evidence" && (
          <EvidenceTab evidence={evidence} onFilter={handleFilterEvidence} />
        )}
        {activeTab === "settings" && (
          <SettingsTab topic={currentTopic} onUpdate={handleUpdateSettings} />
        )}
      </div>
    </div>

    {/* Status Bar */}
    <StatusBar
      lastUpdate={topic.lastRefreshAt}
      dimensionCount={dimensions.length}
      evidenceCount={evidence.length}
      autoRefresh={topic.autoRefresh}
    />
  </TopicWorkspace>
</AppShell>
```

---

## 三、核心组件设计

### 3.1 TopicCard (专题卡片)

#### Props

```typescript
interface TopicCardProps {
  topic: TopicResearchTopic;
  onClick: () => void;
  onEdit?: (topic: TopicResearchTopic) => void;
  onDelete?: (topicId: string) => void;
  onArchive?: (topicId: string) => void;
  isOwner?: boolean;
}
```

#### 设计

```tsx
function TopicCard({
  topic,
  onClick,
  onEdit,
  onDelete,
  onArchive,
  isOwner,
}: TopicCardProps) {
  return (
    <div
      onClick={onClick}
      className="group relative cursor-pointer rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:border-violet-300 hover:shadow-lg"
    >
      {/* Action Menu - 仅所有者可见 */}
      {isOwner && (
        <ActionMenu
          items={[
            {
              label: "编辑",
              icon: <EditIcon />,
              onClick: () => onEdit?.(topic),
            },
            {
              label: "归档",
              icon: <ArchiveIcon />,
              onClick: () => onArchive?.(topic.id),
            },
            {
              label: "删除",
              icon: <TrashIcon />,
              onClick: () => onDelete?.(topic.id),
              danger: true,
            },
          ]}
        />
      )}

      {/* Topic Icon */}
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600">
        <ResearchIcon className="h-6 w-6 text-white" />
      </div>

      {/* Topic Info */}
      <h3 className="line-clamp-1 font-semibold text-gray-900">{topic.name}</h3>
      {topic.description && (
        <p className="mt-1 line-clamp-2 text-sm text-gray-500">
          {topic.description}
        </p>
      )}

      {/* Stats */}
      <div className="mt-4 flex items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <LayersIcon className="h-3.5 w-3.5" />
          {topic.dimensionCount} 维度
        </span>
        <span className="flex items-center gap-1">
          <DatabaseIcon className="h-3.5 w-3.5" />
          {topic.evidenceCount} 证据
        </span>
        <span className="flex items-center gap-1">
          <ClockIcon className="h-3.5 w-3.5" />
          {formatRelativeTime(topic.lastRefreshAt)}
        </span>
      </div>

      {/* Tags */}
      {topic.tags && topic.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {topic.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-violet-50 px-2 py-0.5 text-xs text-violet-600"
            >
              {tag}
            </span>
          ))}
          {topic.tags.length > 3 && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
              +{topic.tags.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Status Indicator */}
      {topic.isRefreshing && (
        <div className="absolute right-3 top-3">
          <div className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
        </div>
      )}
    </div>
  );
}
```

---

### 3.2 CreateTopicWizard (创建向导)

#### Props

```typescript
interface CreateTopicWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (topic: TopicResearchTopic) => void;
}

interface WizardState {
  step: number;
  data: {
    name: string;
    description: string;
    objectives: string[];
    tags: string[];
    dimensions: DimensionConfig[];
    dataSources: DataSourceConfig;
    aiConfig: AIConfig;
  };
}
```

#### 设计

```tsx
function CreateTopicWizard({
  isOpen,
  onClose,
  onCreated,
}: CreateTopicWizardProps) {
  const [state, setState] = useState<WizardState>({
    step: 1,
    data: {
      /* defaults */
    },
  });

  const steps = [
    { id: 1, title: "基本信息", component: BasicInfoStep },
    { id: 2, title: "维度配置", component: DimensionStep },
    { id: 3, title: "数据源", component: DataSourceStep },
    { id: 4, title: "AI配置", component: AIConfigStep },
    { id: 5, title: "确认创建", component: ConfirmStep },
  ];

  return (
    <Dialog isOpen={isOpen} onClose={onClose} size="xl">
      <DialogHeader>
        <h2>创建新专题</h2>
        {/* Progress Indicator */}
        <StepProgress currentStep={state.step} totalSteps={steps.length} />
      </DialogHeader>

      <DialogBody>
        {/* Render current step */}
        {steps.map(
          (step) =>
            state.step === step.id && (
              <step.component
                key={step.id}
                data={state.data}
                onChange={(data) => setState({ ...state, data })}
              />
            ),
        )}
      </DialogBody>

      <DialogFooter>
        <Button
          variant="outline"
          onClick={() => setState({ ...state, step: state.step - 1 })}
          disabled={state.step === 1}
        >
          上一步
        </Button>
        {state.step < steps.length ? (
          <Button
            variant="primary"
            onClick={() => setState({ ...state, step: state.step + 1 })}
            disabled={!isStepValid(state.step, state.data)}
          >
            下一步
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={() => handleCreateTopic(state.data)}
          >
            创建并启动
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
```

---

### 3.3 DimensionNav (维度导航)

#### Props

```typescript
interface DimensionNavProps {
  dimensions: ResearchDimension[];
  activeDimension: ResearchDimension | null;
  onSelectDimension: (dimension: ResearchDimension) => void;
  onAddDimension: () => void;
  onEditDimension: (dimension: ResearchDimension) => void;
  onDeleteDimension: (dimensionId: string) => void;
}
```

#### 设计

```tsx
function DimensionNav({
  dimensions,
  activeDimension,
  onSelectDimension,
  onAddDimension,
  onEditDimension,
  onDeleteDimension,
}: DimensionNavProps) {
  return (
    <div className="w-64 border-r border-gray-200 bg-gray-50 p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">研究维度</h3>
        <Button size="sm" variant="ghost" onClick={onAddDimension}>
          <PlusIcon className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-1">
        {dimensions.map((dimension) => (
          <DimensionNavItem
            key={dimension.id}
            dimension={dimension}
            isActive={activeDimension?.id === dimension.id}
            onClick={() => onSelectDimension(dimension)}
            onEdit={() => onEditDimension(dimension)}
            onDelete={() => onDeleteDimension(dimension.id)}
          />
        ))}
      </div>

      {/* Add Dimension Button */}
      <button
        onClick={onAddDimension}
        className="mt-4 flex w-full items-center gap-2 rounded-lg border-2 border-dashed border-gray-300 p-3 text-sm text-gray-500 hover:border-violet-400 hover:bg-violet-50 hover:text-violet-600"
      >
        <PlusIcon className="h-4 w-4" />
        添加维度
      </button>
    </div>
  );
}

function DimensionNavItem({
  dimension,
  isActive,
  onClick,
  onEdit,
  onDelete,
}: any) {
  return (
    <div
      onClick={onClick}
      className={`group relative flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer ${
        isActive
          ? "bg-violet-100 text-violet-700"
          : "text-gray-600 hover:bg-gray-100"
      }`}
    >
      {/* Dimension Icon */}
      <div
        className={`flex h-6 w-6 items-center justify-center rounded ${
          isActive ? "bg-violet-200" : "bg-gray-200"
        }`}
      >
        {dimension.icon || "📊"}
      </div>

      {/* Dimension Name */}
      <span className="flex-1 truncate text-sm font-medium">
        {dimension.name}
      </span>

      {/* Status Indicator */}
      {dimension.isRefreshing && (
        <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
      )}

      {/* Action Menu */}
      <div className="opacity-0 group-hover:opacity-100">
        <DropdownMenu
          items={[
            { label: "编辑", onClick: onEdit },
            { label: "删除", onClick: onDelete, danger: true },
          ]}
        />
      </div>
    </div>
  );
}
```

---

### 3.4 ReportViewer (报告查看器 - NotebookLM 风格)

#### Props

```typescript
interface ReportViewerProps {
  dimension: ResearchDimension;
  report: DimensionReport;
  onRefresh: () => void;
  onCitationClick: (citation: Citation) => void;
}
```

#### 设计

```tsx
function ReportViewer({
  dimension,
  report,
  onRefresh,
  onCitationClick,
}: ReportViewerProps) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Report Header */}
      <div className="border-b border-gray-200 bg-white p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              {dimension.name}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              最后更新: {formatRelativeTime(report.updatedAt)}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={onRefresh}
              disabled={dimension.isRefreshing}
            >
              {dimension.isRefreshing ? (
                <>
                  <LoaderIcon className="h-4 w-4 animate-spin" />
                  刷新中...
                </>
              ) : (
                <>
                  <RefreshIcon className="h-4 w-4" />
                  刷新
                </>
              )}
            </Button>
            <ExportMenu report={report} />
          </div>
        </div>

        {/* Report Metadata */}
        <div className="mt-4 flex items-center gap-4 text-sm text-gray-500">
          <span className="flex items-center gap-1">
            <DatabaseIcon className="h-4 w-4" />
            {report.evidenceCount} 条证据
          </span>
          <span className="flex items-center gap-1">
            <TrendingUpIcon className="h-4 w-4" />
            可信度: {Math.round(report.confidence * 100)}%
          </span>
          <span className="flex items-center gap-1">
            <ClockIcon className="h-4 w-4" />
            {report.wordCount} 字
          </span>
        </div>
      </div>

      {/* Report Content */}
      <div className="flex-1 overflow-auto bg-white">
        <div className="mx-auto max-w-4xl p-8">
          {/* Markdown Content with Citations */}
          <ReactMarkdown
            components={{
              // 自定义渲染，支持 [1] [2] 引用标记
              p: ({ children }) => (
                <p className="mb-4 text-gray-700 leading-relaxed">
                  {parseAndRenderWithCitations(children, onCitationClick)}
                </p>
              ),
              h1: ({ children }) => (
                <h1 className="mb-4 text-3xl font-bold text-gray-900">
                  {children}
                </h1>
              ),
              h2: ({ children }) => (
                <h2 className="mb-3 mt-8 text-2xl font-semibold text-gray-900">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 className="mb-2 mt-6 text-xl font-semibold text-gray-900">
                  {children}
                </h3>
              ),
              ul: ({ children }) => (
                <ul className="mb-4 list-disc pl-6 text-gray-700">
                  {children}
                </ul>
              ),
              ol: ({ children }) => (
                <ol className="mb-4 list-decimal pl-6 text-gray-700">
                  {children}
                </ol>
              ),
              // ... 其他 Markdown 元素
            }}
          >
            {report.content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

// 解析并渲染带引用的文本
function parseAndRenderWithCitations(
  children: any,
  onCitationClick: (citation: Citation) => void,
) {
  // 将文本中的 [1] [2] 等替换为可点击的引用链接
  // 实现参考 NotebookLM 的 Citation 渲染逻辑
}
```

---

### 3.5 EvidencePanel (证据面板)

#### Props

```typescript
interface EvidencePanelProps {
  evidence: Evidence[];
  activeCitationId?: string;
  onEvidenceClick: (evidence: Evidence) => void;
  onFilter: (filter: EvidenceFilter) => void;
}
```

#### 设计

```tsx
function EvidencePanel({
  evidence,
  activeCitationId,
  onEvidenceClick,
  onFilter,
}: EvidencePanelProps) {
  return (
    <div className="border-t border-gray-200 bg-gray-50 p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">
          证据来源 ({evidence.length})
        </h3>
        <EvidenceFilterMenu onFilter={onFilter} />
      </div>

      <div className="space-y-2">
        {evidence.map((item, index) => (
          <EvidenceItem
            key={item.id}
            evidence={item}
            citationNumber={index + 1}
            isActive={activeCitationId === item.citationId}
            onClick={() => onEvidenceClick(item)}
          />
        ))}
      </div>
    </div>
  );
}

function EvidenceItem({ evidence, citationNumber, isActive, onClick }: any) {
  return (
    <div
      onClick={onClick}
      className={`cursor-pointer rounded-lg border p-3 transition-all ${
        isActive
          ? "border-violet-400 bg-violet-50 shadow-md"
          : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm"
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Citation Number Badge */}
        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-semibold text-violet-700">
          {citationNumber}
        </div>

        <div className="flex-1 min-w-0">
          {/* Title */}
          <h4 className="line-clamp-1 text-sm font-medium text-gray-900">
            {evidence.title}
          </h4>

          {/* Source */}
          <p className="mt-1 line-clamp-1 text-xs text-gray-500">
            {evidence.source} · {formatDate(evidence.publishedAt)}
          </p>

          {/* Excerpt */}
          {evidence.excerpt && (
            <p className="mt-2 line-clamp-2 text-xs text-gray-600">
              "{evidence.excerpt}"
            </p>
          )}

          {/* Confidence Badge */}
          <div className="mt-2 flex items-center gap-2">
            <ConfidenceBadge level={evidence.confidence} />
            {evidence.isVerified && (
              <span className="flex items-center gap-1 text-xs text-green-600">
                <CheckCircleIcon className="h-3 w-3" />
                已验证
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

---

### 3.6 RefreshProgressPanel (刷新进度面板)

#### Props

```typescript
interface RefreshProgressPanelProps {
  dimension: ResearchDimension;
  progress: RefreshProgress;
  onCancel: () => void;
}
```

#### 设计

```tsx
function RefreshProgressPanel({
  dimension,
  progress,
  onCancel,
}: RefreshProgressPanelProps) {
  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50 p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <LoaderIcon className="h-5 w-5 animate-spin text-violet-600" />
          <div>
            <h4 className="text-sm font-semibold text-violet-900">
              正在刷新: {dimension.name}
            </h4>
            <p className="mt-0.5 text-xs text-violet-600">
              {progress.currentStage}
            </p>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          取消
        </Button>
      </div>

      {/* Progress Bar */}
      <div className="mt-3">
        <div className="h-2 rounded-full bg-violet-200">
          <div
            className="h-2 rounded-full bg-violet-600 transition-all duration-300"
            style={{ width: `${progress.percentage}%` }}
          />
        </div>
        <div className="mt-1 text-xs text-violet-600">
          {progress.percentage}% 完成
        </div>
      </div>

      {/* Stage Details */}
      <div className="mt-3 space-y-1 text-xs text-violet-700">
        <div className="flex items-center justify-between">
          <span>搜索数据源</span>
          <span>{progress.stages.search.status}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>提取内容</span>
          <span>{progress.stages.extract.status}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>AI 分析</span>
          <span>{progress.stages.analyze.status}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>生成报告</span>
          <span>{progress.stages.generate.status}</span>
        </div>
      </div>
    </div>
  );
}
```

---

## 四、Zustand Store 设计

### 4.1 topicResearchStore

```typescript
// frontend/stores/topicResearchStore.ts

import { create } from "zustand";
import { persist } from "zustand/middleware";
import * as api from "@/lib/api/topic-research";

// ==================== Types ====================

interface TopicResearchTopic {
  id: string;
  name: string;
  description: string | null;
  objectives: string[];
  tags: string[];
  status: "ACTIVE" | "ARCHIVED" | "DELETED";
  dimensionCount: number;
  evidenceCount: number;
  lastRefreshAt: string | null;
  autoRefreshEnabled: boolean;
  autoRefreshInterval: number | null; // 小时
  createdAt: string;
  updatedAt: string;
  createdById: string;
  // Relations
  dimensions?: ResearchDimension[];
  dataSources?: DataSourceConfig;
  aiConfig?: AIConfig;
}

interface ResearchDimension {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  weight: number; // 0-1
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "ERROR";
  isRefreshing: boolean;
  lastRefreshAt: string | null;
  topicId: string;
  createdAt: string;
  updatedAt: string;
  // Relations
  report?: DimensionReport;
  evidence?: Evidence[];
}

interface DimensionReport {
  id: string;
  dimensionId: string;
  content: string; // Markdown with citations
  wordCount: number;
  evidenceCount: number;
  confidence: number; // 0-1
  createdAt: string;
  updatedAt: string;
}

interface Evidence {
  id: string;
  dimensionId: string;
  citationId: string; // [1], [2], etc.
  title: string;
  source: string; // URL or source name
  excerpt: string | null;
  fullContent: string | null;
  publishedAt: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  isVerified: boolean;
  metadata: Record<string, any>;
  createdAt: string;
}

interface DataSourceConfig {
  searchEngines: {
    google: boolean;
    bing: boolean;
    perplexity: boolean;
  };
  knowledgeBases: string[]; // IDs
  keywords: string[];
  timeRange: {
    start: string | null;
    end: string | null;
  };
}

interface AIConfig {
  model: string; // AI model ID
  agents: string[]; // Agent IDs
  depth: "FAST" | "STANDARD" | "DEEP";
  temperature: number;
}

interface RefreshProgress {
  dimensionId: string;
  currentStage: string;
  percentage: number;
  stages: {
    search: { status: string; progress: number };
    extract: { status: string; progress: number };
    analyze: { status: string; progress: number };
    generate: { status: string; progress: number };
  };
}

// ==================== Store ====================

interface TopicResearchState {
  // Topics
  topics: TopicResearchTopic[];
  currentTopic: TopicResearchTopic | null;
  isLoadingTopics: boolean;

  // Dimensions
  dimensions: ResearchDimension[];
  activeDimension: ResearchDimension | null;
  isLoadingDimensions: boolean;

  // Evidence
  evidence: Evidence[];
  isLoadingEvidence: boolean;
  activeCitationId: string | null;

  // Refresh Progress
  refreshProgress: Map<string, RefreshProgress>; // dimensionId -> progress

  // UI State
  activeTab: "research" | "reports" | "evidence" | "settings";

  // ==================== Actions - Topics ====================
  fetchTopics: (options?: {
    status?: string;
    search?: string;
  }) => Promise<void>;
  fetchTopic: (topicId: string) => Promise<void>;
  createTopic: (data: CreateTopicDto) => Promise<TopicResearchTopic>;
  updateTopic: (topicId: string, data: UpdateTopicDto) => Promise<void>;
  deleteTopic: (topicId: string) => Promise<void>;
  archiveTopic: (topicId: string) => Promise<void>;
  setCurrentTopic: (topic: TopicResearchTopic | null) => void;

  // ==================== Actions - Dimensions ====================
  fetchDimensions: (topicId: string) => Promise<void>;
  createDimension: (
    topicId: string,
    data: CreateDimensionDto,
  ) => Promise<ResearchDimension>;
  updateDimension: (
    dimensionId: string,
    data: UpdateDimensionDto,
  ) => Promise<void>;
  deleteDimension: (dimensionId: string) => Promise<void>;
  setActiveDimension: (dimension: ResearchDimension | null) => void;

  // ==================== Actions - Refresh ====================
  refreshDimension: (dimensionId: string) => Promise<void>;
  refreshAllDimensions: (topicId: string) => Promise<void>;
  cancelRefresh: (dimensionId: string) => Promise<void>;

  // ==================== Actions - Evidence ====================
  fetchEvidence: (dimensionId: string) => Promise<void>;
  setActiveCitation: (citationId: string | null) => void;

  // ==================== Actions - UI ====================
  setActiveTab: (tab: "research" | "reports" | "evidence" | "settings") => void;
  resetStore: () => void;
}

export const useTopicResearchStore = create<TopicResearchState>()(
  persist(
    (set, get) => ({
      // Initial state
      topics: [],
      currentTopic: null,
      isLoadingTopics: false,
      dimensions: [],
      activeDimension: null,
      isLoadingDimensions: false,
      evidence: [],
      isLoadingEvidence: false,
      activeCitationId: null,
      refreshProgress: new Map(),
      activeTab: "research",

      // ==================== Topics ====================
      fetchTopics: async (options) => {
        set({ isLoadingTopics: true });
        try {
          const topics = await api.getTopics(options);
          set({ topics, isLoadingTopics: false });
        } catch (error) {
          console.error("Failed to fetch topics:", error);
          set({ isLoadingTopics: false });
        }
      },

      fetchTopic: async (topicId) => {
        try {
          const topic = await api.getTopicById(topicId);
          set({ currentTopic: topic });
          // Update topics list
          set((state) => ({
            topics: state.topics.map((t) => (t.id === topicId ? topic : t)),
          }));
        } catch (error) {
          console.error("Failed to fetch topic:", error);
        }
      },

      createTopic: async (data) => {
        const topic = await api.createTopic(data);
        set((state) => ({
          topics: [topic, ...state.topics],
          currentTopic: topic,
        }));
        return topic;
      },

      updateTopic: async (topicId, data) => {
        const updatedTopic = await api.updateTopic(topicId, data);
        set((state) => ({
          topics: state.topics.map((t) =>
            t.id === topicId ? updatedTopic : t,
          ),
          currentTopic:
            state.currentTopic?.id === topicId
              ? updatedTopic
              : state.currentTopic,
        }));
      },

      deleteTopic: async (topicId) => {
        await api.deleteTopic(topicId);
        set((state) => ({
          topics: state.topics.filter((t) => t.id !== topicId),
          currentTopic:
            state.currentTopic?.id === topicId ? null : state.currentTopic,
        }));
      },

      archiveTopic: async (topicId) => {
        await api.archiveTopic(topicId);
        set((state) => ({
          topics: state.topics.filter((t) => t.id !== topicId),
          currentTopic:
            state.currentTopic?.id === topicId ? null : state.currentTopic,
        }));
      },

      setCurrentTopic: (topic) => set({ currentTopic: topic }),

      // ==================== Dimensions ====================
      fetchDimensions: async (topicId) => {
        set({ isLoadingDimensions: true });
        try {
          const dimensions = await api.getDimensions(topicId);
          set({ dimensions, isLoadingDimensions: false });
        } catch (error) {
          console.error("Failed to fetch dimensions:", error);
          set({ isLoadingDimensions: false });
        }
      },

      createDimension: async (topicId, data) => {
        const dimension = await api.createDimension(topicId, data);
        set((state) => ({
          dimensions: [...state.dimensions, dimension],
        }));
        return dimension;
      },

      updateDimension: async (dimensionId, data) => {
        const updatedDimension = await api.updateDimension(dimensionId, data);
        set((state) => ({
          dimensions: state.dimensions.map((d) =>
            d.id === dimensionId ? updatedDimension : d,
          ),
          activeDimension:
            state.activeDimension?.id === dimensionId
              ? updatedDimension
              : state.activeDimension,
        }));
      },

      deleteDimension: async (dimensionId) => {
        await api.deleteDimension(dimensionId);
        set((state) => ({
          dimensions: state.dimensions.filter((d) => d.id !== dimensionId),
          activeDimension:
            state.activeDimension?.id === dimensionId
              ? null
              : state.activeDimension,
        }));
      },

      setActiveDimension: (dimension) => set({ activeDimension: dimension }),

      // ==================== Refresh ====================
      refreshDimension: async (dimensionId) => {
        // Set dimension status to refreshing
        set((state) => ({
          dimensions: state.dimensions.map((d) =>
            d.id === dimensionId
              ? { ...d, isRefreshing: true, status: "IN_PROGRESS" }
              : d,
          ),
        }));

        try {
          // Call API to start refresh
          await api.refreshDimension(dimensionId);
          // Progress will be updated via WebSocket
        } catch (error) {
          console.error("Failed to refresh dimension:", error);
          // Reset status on error
          set((state) => ({
            dimensions: state.dimensions.map((d) =>
              d.id === dimensionId
                ? { ...d, isRefreshing: false, status: "ERROR" }
                : d,
            ),
          }));
        }
      },

      refreshAllDimensions: async (topicId) => {
        const { dimensions } = get();
        const topicDimensions = dimensions.filter((d) => d.topicId === topicId);

        for (const dimension of topicDimensions) {
          await get().refreshDimension(dimension.id);
        }
      },

      cancelRefresh: async (dimensionId) => {
        await api.cancelRefresh(dimensionId);
        set((state) => ({
          dimensions: state.dimensions.map((d) =>
            d.id === dimensionId
              ? { ...d, isRefreshing: false, status: "PENDING" }
              : d,
          ),
        }));
      },

      // ==================== Evidence ====================
      fetchEvidence: async (dimensionId) => {
        set({ isLoadingEvidence: true });
        try {
          const evidence = await api.getEvidence(dimensionId);
          set({ evidence, isLoadingEvidence: false });
        } catch (error) {
          console.error("Failed to fetch evidence:", error);
          set({ isLoadingEvidence: false });
        }
      },

      setActiveCitation: (citationId) => set({ activeCitationId: citationId }),

      // ==================== UI ====================
      setActiveTab: (tab) => set({ activeTab: tab }),

      resetStore: () =>
        set({
          topics: [],
          currentTopic: null,
          dimensions: [],
          activeDimension: null,
          evidence: [],
          activeCitationId: null,
          refreshProgress: new Map(),
          activeTab: "research",
        }),
    }),
    {
      name: "topic-research-storage",
      partialize: (state) => ({
        // Only persist UI preferences
        activeTab: state.activeTab,
      }),
    },
  ),
);
```

---

## 五、API 层设计

### 5.1 topic-research.ts

```typescript
// frontend/lib/api/topic-research.ts

import { getAuthTokens } from "../utils/auth";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const tokens = getAuthTokens();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  if (tokens?.accessToken) {
    (headers as Record<string, string>)["Authorization"] =
      `Bearer ${tokens.accessToken}`;
  }

  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ message: "Request failed" }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

// ==================== Topic API ====================

export interface CreateTopicDto {
  name: string;
  description?: string;
  objectives?: string[];
  tags?: string[];
  dimensions: CreateDimensionDto[];
  dataSources: DataSourceConfig;
  aiConfig: AIConfig;
  autoRefreshEnabled?: boolean;
  autoRefreshInterval?: number;
}

export interface UpdateTopicDto {
  name?: string;
  description?: string;
  objectives?: string[];
  tags?: string[];
  dataSources?: DataSourceConfig;
  aiConfig?: AIConfig;
  autoRefreshEnabled?: boolean;
  autoRefreshInterval?: number;
}

export async function createTopic(
  dto: CreateTopicDto,
): Promise<TopicResearchTopic> {
  return fetchWithAuth("/api/v1/topic-research/topics", {
    method: "POST",
    body: JSON.stringify(dto),
  });
}

export async function getTopics(options?: {
  status?: string;
  search?: string;
}): Promise<TopicResearchTopic[]> {
  const params = new URLSearchParams();
  if (options?.status) params.set("status", options.status);
  if (options?.search) params.set("search", options.search);

  const query = params.toString();
  return fetchWithAuth(
    `/api/v1/topic-research/topics${query ? `?${query}` : ""}`,
  );
}

export async function getTopicById(
  topicId: string,
): Promise<TopicResearchTopic> {
  return fetchWithAuth(`/api/v1/topic-research/topics/${topicId}`);
}

export async function updateTopic(
  topicId: string,
  dto: UpdateTopicDto,
): Promise<TopicResearchTopic> {
  return fetchWithAuth(`/api/v1/topic-research/topics/${topicId}`, {
    method: "PATCH",
    body: JSON.stringify(dto),
  });
}

export async function deleteTopic(topicId: string): Promise<void> {
  return fetchWithAuth(`/api/v1/topic-research/topics/${topicId}`, {
    method: "DELETE",
  });
}

export async function archiveTopic(topicId: string): Promise<void> {
  return fetchWithAuth(`/api/v1/topic-research/topics/${topicId}/archive`, {
    method: "POST",
  });
}

// ==================== Dimension API ====================

export interface CreateDimensionDto {
  name: string;
  description?: string;
  icon?: string;
  weight?: number;
}

export interface UpdateDimensionDto {
  name?: string;
  description?: string;
  icon?: string;
  weight?: number;
}

export async function getDimensions(
  topicId: string,
): Promise<ResearchDimension[]> {
  return fetchWithAuth(`/api/v1/topic-research/topics/${topicId}/dimensions`);
}

export async function createDimension(
  topicId: string,
  dto: CreateDimensionDto,
): Promise<ResearchDimension> {
  return fetchWithAuth(`/api/v1/topic-research/topics/${topicId}/dimensions`, {
    method: "POST",
    body: JSON.stringify(dto),
  });
}

export async function updateDimension(
  dimensionId: string,
  dto: UpdateDimensionDto,
): Promise<ResearchDimension> {
  return fetchWithAuth(`/api/v1/topic-research/dimensions/${dimensionId}`, {
    method: "PATCH",
    body: JSON.stringify(dto),
  });
}

export async function deleteDimension(dimensionId: string): Promise<void> {
  return fetchWithAuth(`/api/v1/topic-research/dimensions/${dimensionId}`, {
    method: "DELETE",
  });
}

// ==================== Refresh API ====================

export async function refreshDimension(dimensionId: string): Promise<void> {
  return fetchWithAuth(
    `/api/v1/topic-research/dimensions/${dimensionId}/refresh`,
    {
      method: "POST",
    },
  );
}

export async function cancelRefresh(dimensionId: string): Promise<void> {
  return fetchWithAuth(
    `/api/v1/topic-research/dimensions/${dimensionId}/refresh/cancel`,
    {
      method: "POST",
    },
  );
}

// ==================== Evidence API ====================

export async function getEvidence(dimensionId: string): Promise<Evidence[]> {
  return fetchWithAuth(
    `/api/v1/topic-research/dimensions/${dimensionId}/evidence`,
  );
}

export async function getEvidenceById(evidenceId: string): Promise<Evidence> {
  return fetchWithAuth(`/api/v1/topic-research/evidence/${evidenceId}`);
}

// ==================== Report API ====================

export async function getDimensionReport(
  dimensionId: string,
): Promise<DimensionReport> {
  return fetchWithAuth(
    `/api/v1/topic-research/dimensions/${dimensionId}/report`,
  );
}

export async function generateFullReport(topicId: string): Promise<any> {
  return fetchWithAuth(
    `/api/v1/topic-research/topics/${topicId}/reports/generate`,
    {
      method: "POST",
    },
  );
}

export async function exportReport(
  topicId: string,
  format: "pdf" | "docx" | "markdown",
): Promise<Blob> {
  const response = await fetch(
    `${API_BASE}/api/v1/topic-research/topics/${topicId}/reports/export?format=${format}`,
    {
      headers: {
        Authorization: `Bearer ${getAuthTokens()?.accessToken}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error("Export failed");
  }

  return response.blob();
}
```

---

## 六、组件目录结构

```
frontend/
├── app/
│   └── topic-research/
│       ├── page.tsx                    # 专题列表页
│       ├── create/
│       │   └── page.tsx                # 创建向导页
│       └── [topicId]/
│           └── page.tsx                # 专题工作区
│
├── components/
│   └── topic-research/
│       ├── TopicCard.tsx               # 专题卡片
│       ├── CreateTopicCard.tsx         # 新建卡片
│       ├── CreateTopicWizard/          # 创建向导
│       │   ├── index.tsx
│       │   ├── BasicInfoStep.tsx
│       │   ├── DimensionStep.tsx
│       │   ├── DataSourceStep.tsx
│       │   ├── AIConfigStep.tsx
│       │   └── ConfirmStep.tsx
│       ├── DimensionNav/               # 维度导航
│       │   ├── index.tsx
│       │   └── DimensionNavItem.tsx
│       ├── ReportViewer/               # 报告查看器
│       │   ├── index.tsx
│       │   ├── ReportHeader.tsx
│       │   ├── ReportContent.tsx
│       │   └── CitationLink.tsx
│       ├── EvidencePanel/              # 证据面板
│       │   ├── index.tsx
│       │   ├── EvidenceItem.tsx
│       │   └── EvidenceFilter.tsx
│       ├── RefreshProgressPanel.tsx    # 刷新进度
│       ├── WorkspaceToolbar.tsx        # 工作区工具栏
│       ├── WorkspaceTabs.tsx           # 工作区标签页
│       └── StatusBar.tsx               # 状态栏
│
├── stores/
│   └── topicResearchStore.ts           # Zustand Store
│
└── lib/
    └── api/
        └── topic-research.ts           # API 函数
```

---

## 七、样式规范

### 7.1 配色方案

遵循现有的 AI Teams / AI Studio 风格：

```css
/* Primary Colors */
--violet-50: #f5f3ff --violet-100: #ede9fe --violet-500: #8b5cf6
  --violet-600: #7c3aed --violet-700: #6d28d9 --purple-50: #faf5ff
  --purple-500: #a855f7 --purple-600: #9333ea /* Status Colors */
  --green-500: #22c55e /* Success / Active */ --blue-500: #3b82f6 /* Info */
  --orange-500: #f97316 /* Warning */ --red-500: #ef4444 /* Error / Danger */
  /* Grays */ --gray-50: #f9fafb --gray-100: #f3f4f6 --gray-200: #e5e7eb
  --gray-500: #6b7280 --gray-700: #374151 --gray-900: #111827;
```

### 7.2 间距规范

```css
/* Card Padding */
p-5 (1.25rem)

/* Section Spacing */
gap-4 (1rem)
gap-6 (1.5rem)

/* Container Padding */
px-8 py-6
```

### 7.3 圆角规范

```css
/* Buttons & Small Elements */
rounded-lg (0.5rem)

/* Cards */
rounded-xl (0.75rem)

/* Modals */
rounded-2xl (1rem)
```

### 7.4 阴影规范

```css
/* Card Hover */
shadow-lg

/* Card Default */
shadow-sm

/* Modal */
shadow-xl
```

---

## 八、响应式设计

### 8.1 断点

```css
sm: 640px
md: 768px
lg: 1024px
xl: 1280px
2xl: 1536px
```

### 8.2 网格布局

```tsx
{
  /* 专题列表网格 */
}
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
  {/* Cards */}
</div>;
```

### 8.3 移动端适配

- 导航栏在小屏幕下收起
- 维度导航可滑动
- 证据面板移至底部 Sheet

---

## 九、交互细节

### 9.1 加载状态

```tsx
{
  isLoading && (
    <div className="flex items-center justify-center py-20">
      <LoaderIcon className="h-8 w-8 animate-spin text-violet-600" />
    </div>
  );
}
```

### 9.2 空状态

```tsx
{
  topics.length === 0 && (
    <EmptyState
      icon={<FolderOpenIcon />}
      title="还没有专题"
      description="创建第一个专题开始研究"
      action={
        <Button onClick={handleCreate}>
          <PlusIcon /> 创建专题
        </Button>
      }
    />
  );
}
```

### 9.3 错误状态

```tsx
{
  error && <ErrorState message={error} onRetry={handleRetry} />;
}
```

### 9.4 Hover 效果

- 卡片: `hover:border-violet-300 hover:shadow-lg`
- 按钮: `hover:bg-violet-700`
- 导航项: `hover:bg-gray-100`

### 9.5 动画

```tsx
{
  /* 加载动画 */
}
className = "animate-spin";

{
  /* 脉冲动画 */
}
className = "animate-pulse";

{
  /* Transition */
}
className = "transition-all duration-300";
```

---

## 十、核心流程图

### 10.1 创建专题流程

```
用户点击"新建专题"
  ↓
打开创建向导 (Step 1/5)
  ↓
填写基本信息
  ↓
配置研究维度 (可多个)
  ↓
选择数据源
  ↓
配置 AI
  ↓
预览并确认
  ↓
调用 API 创建专题
  ↓
后台启动初始研究（所有维度）
  ↓
跳转到专题工作区
  ↓
实时显示研究进度
```

### 10.2 维度刷新流程

```
用户点击"刷新"按钮
  ↓
调用 API: POST /dimensions/{id}/refresh
  ↓
后台创建刷新任务
  ↓
返回任务 ID
  ↓
前端通过 WebSocket 监听进度
  ↓
实时更新 RefreshProgressPanel
  ↓
刷新完成
  ↓
自动加载新报告和证据
  ↓
显示刷新完成通知
```

### 10.3 报告查看流程

```
用户选择维度
  ↓
加载维度报告 (DimensionReport)
  ↓
加载证据列表 (Evidence[])
  ↓
渲染 Markdown 内容
  ↓
解析引用标记 [1] [2]
  ↓
渲染为可点击的 CitationLink
  ↓
用户点击引用
  ↓
高亮对应证据 (EvidencePanel)
  ↓
显示证据详情
```

---

## 十一、性能优化

### 11.1 数据分页

```typescript
// 专题列表分页加载
const [page, setPage] = useState(1);
const [hasMore, setHasMore] = useState(true);

const loadMore = async () => {
  const newTopics = await api.getTopics({ page, limit: 20 });
  setTopics([...topics, ...newTopics]);
  setHasMore(newTopics.length === 20);
  setPage(page + 1);
};
```

### 11.2 虚拟滚动

对于大量证据列表，使用 `react-window` 实现虚拟滚动：

```tsx
import { FixedSizeList } from "react-window";

<FixedSizeList
  height={600}
  itemCount={evidence.length}
  itemSize={120}
  width="100%"
>
  {({ index, style }) => (
    <div style={style}>
      <EvidenceItem evidence={evidence[index]} />
    </div>
  )}
</FixedSizeList>;
```

### 11.3 缓存策略

```typescript
// 使用 SWR 缓存 API 请求
import useSWR from "swr";

const { data: topic, mutate } = useSWR(
  topicId ? `/api/v1/topic-research/topics/${topicId}` : null,
  fetcher,
  {
    revalidateOnFocus: false,
    dedupingInterval: 60000, // 1分钟内不重复请求
  },
);
```

### 11.4 代码分割

```typescript
// 动态导入大组件
const CreateTopicWizard = lazy(() => import('@/components/topic-research/CreateTopicWizard'));

// 使用 Suspense
<Suspense fallback={<Loading />}>
  <CreateTopicWizard />
</Suspense>
```

---

## 十二、测试策略

### 12.1 单元测试

```typescript
// 测试 TopicCard 组件
describe('TopicCard', () => {
  it('should render topic information', () => {
    render(<TopicCard topic={mockTopic} onClick={jest.fn()} />);
    expect(screen.getByText(mockTopic.name)).toBeInTheDocument();
  });

  it('should call onClick when clicked', () => {
    const handleClick = jest.fn();
    render(<TopicCard topic={mockTopic} onClick={handleClick} />);
    fireEvent.click(screen.getByText(mockTopic.name));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
```

### 12.2 集成测试

```typescript
// 测试创建专题流程
describe('Create Topic Flow', () => {
  it('should create topic successfully', async () => {
    render(<CreateTopicWizard isOpen onClose={jest.fn()} onCreated={jest.fn()} />);

    // Step 1: Fill basic info
    fireEvent.change(screen.getByPlaceholderText('专题名称'), {
      target: { value: 'Test Topic' }
    });
    fireEvent.click(screen.getByText('下一步'));

    // Step 2-4: ...

    // Step 5: Confirm
    fireEvent.click(screen.getByText('创建并启动'));

    await waitFor(() => {
      expect(api.createTopic).toHaveBeenCalled();
    });
  });
});
```

---

## 十三、无障碍访问 (A11y)

### 13.1 语义化 HTML

```tsx
<nav aria-label="研究维度导航">
  <ul>
    <li>...</li>
  </ul>
</nav>
```

### 13.2 ARIA 标签

```tsx
<button aria-label="刷新维度" aria-busy={isRefreshing} onClick={handleRefresh}>
  <RefreshIcon />
</button>
```

### 13.3 键盘导航

```tsx
// 支持 Tab / Enter / Escape
const handleKeyDown = (e: React.KeyboardEvent) => {
  if (e.key === "Enter") {
    handleSelect();
  } else if (e.key === "Escape") {
    handleClose();
  }
};
```

---

## 十四、国际化 (i18n)

### 14.1 翻译键

```typescript
// frontend/lib/i18n/locales/zh-CN.ts
export default {
  topicResearch: {
    title: "专题研究",
    subtitle: "多维度深度研究平台",
    create: "新建专题",
    dimensions: "维度",
    evidence: "证据",
    refresh: "刷新",
    export: "导出",
    // ...
  },
};
```

### 14.2 使用翻译

```tsx
import { useTranslation } from "@/lib/i18n";

function TopicCard() {
  const { t } = useTranslation();

  return <h1>{t("topicResearch.title")}</h1>;
}
```

---

## 十五、总结

本设计文档涵盖了 Topic Research 模块的完整前端架构，包括：

1. **路由结构**: 列表页 → 创建页 → 工作区
2. **页面布局**: 参考 AI Teams / AI Studio / NotebookLM
3. **核心组件**: 卡片、向导、导航、报告查看器、证据面板
4. **状态管理**: Zustand Store (topicResearchStore)
5. **API 层**: topic-research.ts
6. **样式规范**: 配色、间距、圆角、阴影
7. **响应式设计**: 移动端适配
8. **交互细节**: 加载、空状态、错误、Hover、动画
9. **性能优化**: 分页、虚拟滚动、缓存、代码分割
10. **测试策略**: 单元测试、集成测试
11. **无障碍**: 语义化 HTML、ARIA、键盘导航
12. **国际化**: i18n 支持

---

**下一步**:

1. 根据本设计文档实现前端组件
2. 与后端 API 联调
3. 编写单元测试和集成测试
4. 优化性能和用户体验
5. 部署上线

---

**维护记录**:

- 2025-01-11: 初始版本创建
