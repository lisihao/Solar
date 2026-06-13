# AI Slides V5.0 - 平台级整合优化方案

> 版本: 5.0
> 日期: 2026-01-26
> 状态: 待实施
> 作者: Claude Code

---

## 一、Executive Summary

### 1.1 背景

通过对 Genspark AI Slides 的深度分析，结合 GenesisPod 现有架构优势，制定本优化方案。

**核心发现**:

- Genspark 在单一产品层面体验优秀（AI Edit、Thinking Tab、Voice Slides）
- Genesis 拥有 Genspark 不可企及的**平台级整合能力**（Research/Writing/Teams/Library）
- Genesis 已实现 AI Teams 协作架构 + 15+ Skills，需进一步放大优势

### 1.2 战略定位

```
Genspark: 单一产品，独立工具
Genesis AI Slides: 平台级产品，数据中枢
```

**差异化核心**: 从"输入文本生成PPT"升级为"整合全平台数据生成专业演示"

### 1.3 目标

| 指标         | 当前       | 目标                                      | 衡量方式     |
| ------------ | ---------- | ----------------------------------------- | ------------ |
| 数据源支持   | 1种 (文本) | 5种 (Research/Writing/Teams/Library/文本) | 功能可用     |
| AI 编辑能力  | 0          | 3种 (布局修复/内容润色/标记编辑)          | 功能可用     |
| 思考透明度   | 0%         | 100% (全流程可视)                         | Thinking Tab |
| 跨模块复用率 | 0%         | 80% (Skills 复用)                         | 代码统计     |

---

## 二、竞品分析: Genspark AI Slides

### 2.1 产品截图分析

基于浏览器实际测试，Genspark AI Slides 功能如下:

#### 2.1.1 左侧面板

| 功能          | 描述                       | 我们的对应                |
| ------------- | -------------------------- | ------------------------- |
| 文件信息      | 43页, 2.1MB, .pptx         | ✅ 已有                   |
| 使用说明      | 下载/编辑/分享指引         | ❌ 缺失                   |
| AI建议操作    | 智能推荐下一步             | ❌ 缺失                   |
| AI Slides Tab | 主编辑入口                 | ✅ 已有                   |
| Team Chat Tab | 多人协作聊天               | ❌ 缺失 (可复用 AI Teams) |
| 输入框        | Professional/Creative 模式 | ✅ 已有风格选择           |

#### 2.1.2 右侧面板

| 功能          | 描述                   | 我们的对应         |
| ------------- | ---------------------- | ------------------ |
| Save Points   | 版本历史 (28+版本)     | ✅ Checkpoint 系统 |
| View & Export | 演示/导出/模板/语音    | 部分 (缺语音)      |
| Preview Tab   | 幻灯片预览             | ✅ 已有            |
| Code Tab      | HTML+TailwindCSS 代码  | ❌ 缺失            |
| Thinking Tab  | AI 推理过程展示        | ❌ 缺失            |
| Fact Check    | 内容事实核查           | ❌ 缺失            |
| AI Edit       | 布局修复/润色/标记编辑 | ❌ 缺失            |
| Advanced Edit | 高级编辑               | ❌ 缺失            |

#### 2.1.3 AI Edit 下拉菜单

| 选项           | 功能描述                            |
| -------------- | ----------------------------------- |
| Fix Layout     | 自动修复布局问题 (重叠、溢出、对齐) |
| Polish Content | 润色内容以匹配风格                  |
| Mark and Edit  | 标记位置并指导 AI 编辑              |

#### 2.1.4 View & Export 菜单

| 选项              | 功能描述                   |
| ----------------- | -------------------------- |
| Presentation View | 全屏演示模式               |
| Export            | PDF / PPTX / Google Slides |
| Save as Template  | 保存为模板复用             |
| Voice Your Slides | AI 生成播客风格旁白视频    |

### 2.2 Genspark 技术栈分析

通过 Code Tab 观察:

```html
<!-- Genspark 使用的技术 -->
- HTML5 + TailwindCSS - Google Fonts (Inter, Noto Sans SC) - Font Awesome Icons
- 内联 CSS 变量主题 - SVG 图表/装饰
```

### 2.3 Genspark Thinking Tab 示例

```
Assessing the Task Scope
I've just clearly defined the user's specific request: they want to
adjust slide 4 to have an 80px buffer between content and the footer.
This task is a piece of a larger effort to prevent footer overlap
across all slides. Now, I must think about how to best implement
this on this specific slide.

Evaluating Implementation Strategy
I'm now focusing on how best to tackle this. Given the flex column
structure and fixed header, I believe I can simply add bottom padding
to the .content-container. This should push the content upwards and
create the necessary space. I need to be sure this method works on
this specific slide.
```

---

## 三、Genesis AI Slides 现状分析

### 3.1 已实现的架构优势

#### 3.1.1 AI Teams 协作架构 (领先 Genspark)

```
┌─────────────────────────────────────────────────────────────────┐
│                    SlidesTeamOrchestrator                        │
│  5阶段执行流程:                                                   │
│  Phase 1: Leader 规划 → 分析源文本，动态分解任务                   │
│  Phase 2: 任务执行 → 成员执行任务，调用 Skills                     │
│  Phase 3: Leader 审核 → 检查任务输出，支持修订                     │
│  Phase 4: 质量审计 → 全局质量检查                                  │
│  Phase 5: Leader 综合 → 整合所有输出                              │
└─────────────────────────────────────────────────────────────────┘
```

#### 3.1.2 Skills 技能库 (15+ Skills)

| Layer     | Skills                  | 职责         |
| --------- | ----------------------- | ------------ |
| Layer 3   | TemplateMatcherSkill    | 语义模板匹配 |
| Layer 4   | TaskDecompositionSkill  | 任务分解     |
| Layer 4   | OutlinePlanningSkill    | 大纲规划     |
| Layer 4   | FourStepDesignSkill     | 四步设计     |
| Layer 4   | ContentCompressionSkill | 内容压缩     |
| Layer 4   | DataSupplementSkill     | 数据补全     |
| Layer 4   | TemplateRenderingSkill  | 模板渲染     |
| Layer 4   | ChartRendererSkill      | 图表渲染     |
| Layer 4   | ImageFetcherSkill       | 图片获取     |
| Layer 4.5 | ContentAnalyzerSkill    | 内容分析     |
| Layer 4.5 | LayoutOptimizerSkill    | 布局优化     |
| Layer 5   | TerminologyUnifierSkill | 术语统一     |
| Layer 5   | TransitionCheckerSkill  | 过渡检查     |
| Layer 6   | QualityAuditSkill       | 质量审计     |

#### 3.1.3 模板系统 (32+ Templates)

| 类别              | 模板数 | 代表模板                           |
| ----------------- | ------ | ---------------------------------- |
| Data (D-\*)       | 6      | Big Number, Dashboard, Trend Chart |
| Structural (S-\*) | 9      | TOC, Pillars, Timeline, Process    |
| Content (C-\*)    | 7      | Image Left/Right, Card Grid, Case  |
| Narrative (N-\*)  | 5      | Cover, Executive Summary, Closing  |
| Action (A-\*)     | 5      | Recommendations, Risk-Opportunity  |

### 3.2 待提升的能力

| 能力          | 当前状态       | 差距原因              |
| ------------- | -------------- | --------------------- |
| 数据源整合    | 仅支持文本输入 | 未对接其他模块        |
| AI 编辑       | 无             | 缺少交互式编辑 Skills |
| Thinking 透明 | 无             | SSE 事件未透传到前端  |
| 代码预览      | 无             | 前端未实现 Code Tab   |
| 事实核查      | 无             | 缺少 FactCheckerSkill |
| 语音旁白      | 无             | 缺少 TTS 集成         |

---

## 四、V5.0 架构设计

### 4.1 分层架构 (AI App + AI ENGINE)

```
┌─────────────────────────────────────────────────────────────────┐
│                        Presentation Layer                        │
│  frontend/components/ai-office/slides/                           │
│  - SlidesWorkspace.tsx (主工作区)                                 │
│  - DataSourceSelector.tsx (数据源选择)                            │
│  - ThinkingPanel.tsx (AI推理展示)                                 │
│  - AIEditDropdown.tsx (AI编辑菜单)                                │
│  - CodePreview.tsx (代码预览)                                     │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                    AI App Layer: AI Slides                       │
│  backend/src/modules/ai-app/office/slides/                       │
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ SlidesController│  │ DataImportSvc   │  │ AIEditService   │  │
│  │ (HTTP API)      │  │ (数据源整合)     │  │ (AI编辑能力)    │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
│           │                    │                    │            │
│  ┌────────▼────────────────────▼────────────────────▼────────┐  │
│  │              SlidesTeamOrchestrator                        │  │
│  │  - SlidesLeader (规划/审核/综合)                            │  │
│  │  - SlidesTeamMember (任务执行)                              │  │
│  │  - SlidesRepository (状态持久化)                            │  │
│  └────────────────────────────┬──────────────────────────────┘  │
└───────────────────────────────┼──────────────────────────────────┘
                                │ 调用 Skills
┌───────────────────────────────▼──────────────────────────────────┐
│                    AI ENGINE Layer: Skills                        │
│  backend/src/modules/ai-engine/skills/                           │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ Slides Skills (现有)                                          ││
│  │ - TaskDecompositionSkill    - OutlinePlanningSkill           ││
│  │ - TemplateMatcherSkill      - TemplateRenderingSkill         ││
│  │ - ChartRendererSkill        - ImageFetcherSkill              ││
│  │ - ContentCompressionSkill   - QualityAuditSkill              ││
│  └──────────────────────────────────────────────────────────────┘│
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ V5.0 新增 Skills                                              ││
│  │ - LayoutFixerSkill          - ContentPolisherSkill           ││
│  │ - SlideThinkingSkill        - FactCheckerSkill               ││
│  │ - VoiceNarrationSkill       - DataTransformSkill             ││
│  └──────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
                                │ 复用能力
┌───────────────────────────────▼──────────────────────────────────┐
│                    Cross-Module Integration                       │
│                                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│  │AI Research│  │AI Writing│  │AI Teams  │  │ Library  │         │
│  │ (报告)    │  │ (草稿)   │  │ (辩论)   │  │ (资源)   │         │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘         │
└──────────────────────────────────────────────────────────────────┘
```

### 4.2 数据流设计

```
┌─────────────────────────────────────────────────────────────────┐
│                         数据源输入                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐     │
│  │ Research │   │ Writing  │   │  Teams   │   │ Library  │     │
│  │ Topic ID │   │ Draft ID │   │Session ID│   │Resource[]│     │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘   └────┬─────┘     │
│       │              │              │              │             │
│       └──────────────┼──────────────┼──────────────┘             │
│                      ▼                                           │
│           ┌─────────────────────┐                               │
│           │ DataImportService   │                               │
│           │ - importFromResearch│                               │
│           │ - importFromWriting │                               │
│           │ - importFromTeams   │                               │
│           │ - importFromLibrary │                               │
│           └──────────┬──────────┘                               │
│                      ▼                                           │
│           ┌─────────────────────┐                               │
│           │ SlidesSourceData    │ (统一数据结构)                 │
│           │ - sourceText        │                               │
│           │ - sections[]        │                               │
│           │ - charts[]          │                               │
│           │ - images[]          │                               │
│           │ - keyFindings[]     │                               │
│           │ - metadata          │                               │
│           └──────────┬──────────┘                               │
└──────────────────────┼──────────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Mission 执行流程                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Phase 1          Phase 2         Phase 3         Phase 4       │
│  ┌────────┐      ┌────────┐      ┌────────┐      ┌────────┐    │
│  │ Leader │ ──▶  │ Member │ ──▶  │ Leader │ ──▶  │Quality │    │
│  │ 规划   │      │ 执行   │      │ 审核   │      │ 审计   │    │
│  └────────┘      └────────┘      └────────┘      └────────┘    │
│       │               │               │               │         │
│       ▼               ▼               ▼               ▼         │
│  ┌────────┐      ┌────────┐      ┌────────┐      ┌────────┐    │
│  │Thinking│      │Thinking│      │Thinking│      │Thinking│    │
│  │ Event  │      │ Event  │      │ Event  │      │ Event  │    │
│  └────┬───┘      └────┬───┘      └────┬───┘      └────┬───┘    │
│       │               │               │               │         │
│       └───────────────┴───────────────┴───────────────┘         │
│                               │                                  │
│                               ▼                                  │
│                    ┌─────────────────────┐                      │
│                    │ SSE Stream to UI    │                      │
│                    │ (Thinking Panel)    │                      │
│                    └─────────────────────┘                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 五、功能模块详细设计

### 5.1 数据源整合模块

#### 5.1.1 SlidesDataImportService

**文件位置**: `backend/src/modules/ai-app/office/slides/services/data-import.service.ts`

```typescript
@Injectable()
export class SlidesDataImportService {
  constructor(
    private readonly researchService: ResearchService,
    private readonly writingService: WritingService,
    private readonly teamsService: AiTeamsService,
    private readonly resourcesService: ResourcesService,
  ) {}

  /**
   * 从 AI Research 报告导入
   * @param topicId - Research Topic ID
   * @returns 统一数据结构
   */
  async importFromResearch(topicId: string): Promise<SlidesSourceData> {
    const topic = await this.researchService.getTopic(topicId);

    return {
      sourceText: topic.report?.content || topic.summary || "",
      sourceType: "research",
      sourceId: topicId,

      // 提取章节
      sections:
        topic.sections?.map((s) => ({
          title: s.title,
          content: s.content,
          order: s.order,
        })) || [],

      // 提取图表数据
      charts: this.extractChartsFromResearch(topic),

      // 提取关键发现
      keyFindings: topic.keyFindings || [],

      // 提取引用资源
      references: topic.references || [],

      // 元数据
      metadata: {
        title: topic.title,
        createdAt: topic.createdAt,
        model: topic.model,
        targetAudience: topic.targetAudience,
      },
    };
  }

  /**
   * 从 AI Writing 草稿导入
   */
  async importFromWriting(draftId: string): Promise<SlidesSourceData> {
    const draft = await this.writingService.getDraft(draftId);

    return {
      sourceText: draft.content,
      sourceType: "writing",
      sourceId: draftId,

      // 提取大纲结构
      outline: draft.outline,

      // 提取章节
      sections:
        draft.chapters?.map((c) => ({
          title: c.title,
          content: c.content,
          order: c.order,
        })) || [],

      // 提取图片
      images: draft.images || [],

      metadata: {
        title: draft.title,
        genre: draft.genre,
        style: draft.style,
      },
    };
  }

  /**
   * 从 AI Teams 辩论结果导入
   */
  async importFromTeams(sessionId: string): Promise<SlidesSourceData> {
    const session = await this.teamsService.getSession(sessionId);

    return {
      sourceText: session.summary || "",
      sourceType: "teams",
      sourceId: sessionId,

      // 提取各方观点
      sections:
        session.agentOutputs?.map((output, i) => ({
          title: output.agentName,
          content: output.content,
          order: i,
          perspective: output.perspective, // 观点立场
        })) || [],

      // 提取共识结论
      consensus: session.consensus,

      // 提取争议点
      controversies: session.controversies,

      metadata: {
        topic: session.topic,
        agents: session.agents,
        duration: session.duration,
      },
    };
  }

  /**
   * 从资源库导入
   */
  async importFromLibrary(resourceIds: string[]): Promise<Asset[]> {
    const resources = await this.resourcesService.getByIds(resourceIds);

    return resources.map((r) => ({
      id: r.id,
      type: r.type, // image, document, video
      url: r.url,
      title: r.title,
      description: r.description,
      thumbnailUrl: r.thumbnailUrl,
    }));
  }

  /**
   * 从 Research 提取图表数据
   */
  private extractChartsFromResearch(topic: any): ChartData[] {
    const charts: ChartData[] = [];

    // 从 sections 中提取数据表格
    topic.sections?.forEach((section) => {
      if (section.data) {
        charts.push({
          type: this.inferChartType(section.data),
          title: section.title,
          data: section.data,
          source: "research",
        });
      }
    });

    return charts;
  }
}
```

#### 5.1.2 统一数据结构

```typescript
// types/slides-source.types.ts

export interface SlidesSourceData {
  // 核心内容
  sourceText: string;
  sourceType: "research" | "writing" | "teams" | "library" | "text";
  sourceId?: string;

  // 结构化内容
  sections?: SourceSection[];
  outline?: OutlineNode[];

  // 数据资产
  charts?: ChartData[];
  images?: Asset[];
  tables?: TableData[];

  // 洞察
  keyFindings?: string[];
  consensus?: string;
  controversies?: string[];
  references?: Reference[];

  // 元数据
  metadata?: {
    title?: string;
    createdAt?: Date;
    model?: string;
    targetAudience?: string;
    [key: string]: any;
  };
}

export interface SourceSection {
  title: string;
  content: string;
  order: number;
  perspective?: string;
  data?: any;
}

export interface ChartData {
  type: "line" | "bar" | "pie" | "radar" | "treemap";
  title: string;
  data: any;
  source?: string;
}

export interface Asset {
  id: string;
  type: "image" | "document" | "video";
  url: string;
  title?: string;
  description?: string;
  thumbnailUrl?: string;
}
```

#### 5.1.3 前端数据源选择器

```tsx
// frontend/components/ai-office/slides/DataSourceSelector.tsx

import { FileText, Edit, Users, FolderOpen, Type } from "lucide-react";

const DATA_SOURCES = [
  {
    id: "research",
    label: "AI Research 报告",
    description: "从深度研究报告导入结构化内容",
    icon: FileText,
    color: "text-blue-500",
  },
  {
    id: "writing",
    label: "AI Writing 草稿",
    description: "从写作草稿导入章节内容",
    icon: Edit,
    color: "text-green-500",
  },
  {
    id: "teams",
    label: "AI Teams 辩论",
    description: "从多Agent辩论导入多元观点",
    icon: Users,
    color: "text-purple-500",
  },
  {
    id: "library",
    label: "资源库",
    description: "从资源库选择图片和文档",
    icon: FolderOpen,
    color: "text-orange-500",
  },
  {
    id: "text",
    label: "直接输入",
    description: "手动输入文本内容",
    icon: Type,
    color: "text-gray-500",
  },
];

interface DataSourceSelectorProps {
  onSelect: (sourceType: string, sourceId?: string) => void;
}

export function DataSourceSelector({ onSelect }: DataSourceSelectorProps) {
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [sourceItems, setSourceItems] = useState<any[]>([]);

  // 选择数据源类型后，加载对应列表
  useEffect(() => {
    if (selectedSource && selectedSource !== "text") {
      loadSourceItems(selectedSource);
    }
  }, [selectedSource]);

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium">选择数据来源</h3>

      {/* 数据源类型选择 */}
      <div className="grid grid-cols-5 gap-3">
        {DATA_SOURCES.map((source) => (
          <button
            key={source.id}
            onClick={() => setSelectedSource(source.id)}
            className={cn(
              "p-4 rounded-lg border-2 transition-all",
              "flex flex-col items-center gap-2",
              selectedSource === source.id
                ? "border-orange-500 bg-orange-500/10"
                : "border-gray-700 hover:border-gray-600",
            )}
          >
            <source.icon className={cn("w-6 h-6", source.color)} />
            <span className="text-sm font-medium">{source.label}</span>
          </button>
        ))}
      </div>

      {/* 具体资源选择 */}
      {selectedSource && selectedSource !== "text" && (
        <div className="mt-4">
          <SourceItemList
            sourceType={selectedSource}
            items={sourceItems}
            onSelect={(id) => onSelect(selectedSource, id)}
          />
        </div>
      )}

      {/* 直接输入 */}
      {selectedSource === "text" && (
        <div className="mt-4">
          <textarea
            className="w-full h-40 p-3 bg-gray-800 rounded-lg"
            placeholder="输入演示内容..."
            onBlur={(e) => onSelect("text", e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
```

---

### 5.2 AI 编辑模块

#### 5.2.1 新增 Skills

##### LayoutFixerSkill

```typescript
// skills/layout-fixer.skill.ts

@Injectable()
export class LayoutFixerSkill implements ISkill {
  readonly id = "layout-fixer";
  readonly name = "Layout Fixer";
  readonly description = "自动检测并修复布局问题";

  async execute(input: LayoutFixerInput): Promise<LayoutFixerResult> {
    const { html, pageIndex } = input;

    // 1. 分析当前布局问题
    const issues = this.analyzeLayoutIssues(html);

    // 2. 生成修复方案
    const fixes = await this.generateFixes(issues);

    // 3. 应用修复
    const fixedHtml = this.applyFixes(html, fixes);

    return {
      originalHtml: html,
      fixedHtml,
      issues,
      fixes,
      pageIndex,
    };
  }

  private analyzeLayoutIssues(html: string): LayoutIssue[] {
    const issues: LayoutIssue[] = [];

    // 检测内容溢出
    // 检测元素重叠
    // 检测对齐问题
    // 检测间距不一致

    return issues;
  }
}

interface LayoutIssue {
  type: "overflow" | "overlap" | "alignment" | "spacing";
  severity: "critical" | "warning" | "info";
  element: string;
  description: string;
  suggestion: string;
}
```

##### ContentPolisherSkill

```typescript
// skills/content-polisher.skill.ts

@Injectable()
export class ContentPolisherSkill implements ISkill {
  readonly id = "content-polisher";
  readonly name = "Content Polisher";
  readonly description = "润色内容以匹配整体风格";

  constructor(private readonly aiChatService: AiChatService) {}

  async execute(input: ContentPolisherInput): Promise<ContentPolisherResult> {
    const { pages, styleGuide, targetTone } = input;

    const polishedPages = await Promise.all(
      pages.map((page) => this.polishPage(page, styleGuide, targetTone)),
    );

    return {
      pages: polishedPages,
      changes: this.summarizeChanges(pages, polishedPages),
    };
  }

  private async polishPage(
    page: GeneratedSlide,
    styleGuide: StyleGuide,
    targetTone: string,
  ): Promise<GeneratedSlide> {
    const prompt = `
你是专业的演示文稿内容编辑。请润色以下幻灯片内容：

当前内容：
${page.content}

风格指南：
- 目标语气：${targetTone}
- 术语规范：${styleGuide.terminology}
- 句式风格：${styleGuide.sentenceStyle}

要求：
1. 保持核心信息不变
2. 统一术语用法
3. 调整语气以匹配目标风格
4. 精简冗余表达

输出润色后的内容。
`;

    const response = await this.aiChatService.chat({
      messages: [{ role: "user", content: prompt }],
      modelType: AIModelType.CHAT,
      taskProfile: { creativity: "low", outputLength: "medium" },
    });

    return {
      ...page,
      content: response.content,
    };
  }
}
```

##### FactCheckerSkill

```typescript
// skills/fact-checker.skill.ts

@Injectable()
export class FactCheckerSkill implements ISkill {
  readonly id = "fact-checker";
  readonly name = "Fact Checker";
  readonly description = "核查内容中的事实准确性";

  constructor(
    private readonly aiChatService: AiChatService,
    private readonly webSearchService: WebSearchService,
  ) {}

  async execute(input: FactCheckerInput): Promise<FactCheckerResult> {
    const { pages } = input;

    const results: PageFactCheckResult[] = [];

    for (const page of pages) {
      const claims = this.extractClaims(page);
      const verifications = await this.verifyClaims(claims);

      results.push({
        pageIndex: page.index,
        claims: verifications,
        overallScore: this.calculateScore(verifications),
      });
    }

    return {
      results,
      summary: this.generateSummary(results),
    };
  }

  private extractClaims(page: GeneratedSlide): Claim[] {
    // 使用 AI 提取可验证的声明
    // - 数字数据
    // - 事实陈述
    // - 引用来源
    return [];
  }

  private async verifyClaims(claims: Claim[]): Promise<ClaimVerification[]> {
    // 使用搜索验证每个声明
    return [];
  }
}

interface Claim {
  text: string;
  type: "statistic" | "fact" | "quote" | "date";
  confidence: number;
}

interface ClaimVerification {
  claim: Claim;
  status: "verified" | "unverified" | "disputed" | "outdated";
  sources: string[];
  suggestion?: string;
}
```

#### 5.2.2 AIEditService

```typescript
// services/ai-edit.service.ts

@Injectable()
export class AIEditService {
  constructor(
    private readonly layoutFixerSkill: LayoutFixerSkill,
    private readonly contentPolisherSkill: ContentPolisherSkill,
    private readonly factCheckerSkill: FactCheckerSkill,
  ) {}

  /**
   * 修复布局问题
   */
  async fixLayout(
    missionId: string,
    pageIndex: number,
  ): Promise<LayoutFixResult> {
    const page = await this.getPage(missionId, pageIndex);
    return this.layoutFixerSkill.execute({ html: page.html, pageIndex });
  }

  /**
   * 润色内容
   */
  async polishContent(
    missionId: string,
    options: PolishOptions,
  ): Promise<PolishResult> {
    const pages = await this.getPages(missionId);
    return this.contentPolisherSkill.execute({
      pages,
      styleGuide: options.styleGuide,
      targetTone: options.targetTone,
    });
  }

  /**
   * 事实核查
   */
  async factCheck(missionId: string): Promise<FactCheckResult> {
    const pages = await this.getPages(missionId);
    return this.factCheckerSkill.execute({ pages });
  }

  /**
   * 标记编辑 (Mark and Edit)
   */
  async markAndEdit(
    missionId: string,
    pageIndex: number,
    markers: EditMarker[],
  ): Promise<MarkedEditResult> {
    // 根据标记位置和编辑指令，执行精准编辑
    return this.executeMarkedEdits(missionId, pageIndex, markers);
  }
}

interface EditMarker {
  id: string;
  position: { x: number; y: number };
  instruction: string;
  type: "text" | "image" | "chart" | "layout";
}
```

#### 5.2.3 前端 AI Edit 组件

```tsx
// frontend/components/ai-office/slides/AIEditDropdown.tsx

import { Wrench, Sparkles, MousePointer, Check } from "lucide-react";

const AI_EDIT_OPTIONS = [
  {
    id: "fix-layout",
    label: "Fix Layout",
    description: "自动修复布局问题（重叠、溢出、对齐）",
    icon: Wrench,
  },
  {
    id: "polish-content",
    label: "Polish Content",
    description: "润色内容以匹配整体风格",
    icon: Sparkles,
  },
  {
    id: "mark-and-edit",
    label: "Mark and Edit",
    description: "标记位置并指导AI编辑",
    icon: MousePointer,
  },
  {
    id: "fact-check",
    label: "Fact Check",
    description: "核查内容事实准确性",
    icon: Check,
  },
];

export function AIEditDropdown({ missionId, pageIndex, onEdit }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleAction = async (actionId: string) => {
    setIsProcessing(true);
    try {
      const result = await executeAIEdit(missionId, pageIndex, actionId);
      onEdit(result);
    } finally {
      setIsProcessing(false);
      setIsOpen(false);
    }
  };

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Sparkles className="w-4 h-4 mr-2" />
          AI Edit
          <ChevronDown className="w-4 h-4 ml-2" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {AI_EDIT_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.id}
            onClick={() => handleAction(option.id)}
            disabled={isProcessing}
          >
            <option.icon className="w-4 h-4 mr-3" />
            <div>
              <div className="font-medium">{option.label}</div>
              <div className="text-xs text-gray-400">{option.description}</div>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

---

### 5.3 Thinking 透明度模块

#### 5.3.1 SlideThinkingSkill

```typescript
// skills/slide-thinking.skill.ts

@Injectable()
export class SlideThinkingSkill implements ISkill {
  readonly id = "slide-thinking";
  readonly name = "Slide Thinking";
  readonly description = "记录AI推理过程以供展示";

  /**
   * 记录思考步骤
   */
  recordThought(context: ThinkingContext, thought: ThoughtEntry): void {
    const entry: ThinkingEntry = {
      id: uuidv4(),
      timestamp: new Date(),
      phase: context.phase,
      skillId: context.skillId,
      title: thought.title,
      content: thought.content,
      reasoning: thought.reasoning,
      decision: thought.decision,
      alternatives: thought.alternatives,
    };

    // 通过事件发送到前端
    context.emitThinking(entry);
  }

  /**
   * 生成思考摘要
   */
  generateSummary(entries: ThinkingEntry[]): ThinkingSummary {
    return {
      totalSteps: entries.length,
      phases: this.groupByPhase(entries),
      keyDecisions: this.extractKeyDecisions(entries),
      timeline: this.buildTimeline(entries),
    };
  }
}

interface ThinkingEntry {
  id: string;
  timestamp: Date;
  phase: string;
  skillId: string;
  title: string;
  content: string;
  reasoning?: string;
  decision?: string;
  alternatives?: string[];
}
```

#### 5.3.2 SSE 事件扩展

```typescript
// types.ts

export type SlidesMissionEvent = {
  type:
    | "mission:created"
    | "mission:completed"
    | "mission:failed"
    | "planning:started"
    | "planning:completed"
    | "task:created"
    | "task:completed"
    | "task:failed"
    | "page:generated"
    // V5.0 新增
    | "thinking:step" // 思考步骤
    | "thinking:decision" // 决策点
    | "thinking:summary"; // 思考摘要
  missionId: string;
  timestamp: Date;
  data: Record<string, unknown>;
};
```

#### 5.3.3 前端 Thinking Panel

```tsx
// frontend/components/ai-office/slides/ThinkingPanel.tsx

interface ThinkingPanelProps {
  missionId: string;
  isVisible: boolean;
}

export function ThinkingPanel({ missionId, isVisible }: ThinkingPanelProps) {
  const [entries, setEntries] = useState<ThinkingEntry[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  // 订阅 SSE 事件
  useEffect(() => {
    if (!missionId) return;

    const eventSource = new EventSource(`/api/slides/${missionId}/stream`);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "thinking:step") {
        setEntries((prev) => [...prev, data.data]);
        setIsStreaming(true);
      }

      if (
        data.type === "thinking:summary" ||
        data.type === "mission:completed"
      ) {
        setIsStreaming(false);
      }
    };

    return () => eventSource.close();
  }, [missionId]);

  if (!isVisible) return null;

  return (
    <div className="h-full overflow-y-auto bg-gray-900 p-4">
      <div className="space-y-4">
        {entries.map((entry) => (
          <ThinkingEntry key={entry.id} entry={entry} />
        ))}

        {isStreaming && (
          <div className="flex items-center gap-2 text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>AI 正在思考...</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ThinkingEntry({ entry }: { entry: ThinkingEntry }) {
  return (
    <div className="border-l-2 border-orange-500/50 pl-4">
      <h4 className="font-medium text-white">{entry.title}</h4>
      <p className="text-sm text-gray-300 mt-1">{entry.content}</p>

      {entry.reasoning && (
        <div className="mt-2 text-xs text-gray-400 bg-gray-800 p-2 rounded">
          <span className="text-orange-400">推理: </span>
          {entry.reasoning}
        </div>
      )}

      {entry.decision && (
        <div className="mt-2 text-xs">
          <span className="text-green-400">决策: </span>
          <span className="text-gray-300">{entry.decision}</span>
        </div>
      )}
    </div>
  );
}
```

---

### 5.4 语音旁白模块 (可选)

#### 5.4.1 VoiceNarrationSkill

```typescript
// skills/voice-narration.skill.ts

@Injectable()
export class VoiceNarrationSkill implements ISkill {
  readonly id = "voice-narration";
  readonly name = "Voice Narration";
  readonly description = "为幻灯片生成语音旁白脚本";

  constructor(
    private readonly aiChatService: AiChatService,
    private readonly ttsService: TextToSpeechService,
  ) {}

  /**
   * 生成旁白脚本
   */
  async generateScript(pages: GeneratedSlide[]): Promise<NarrationScript[]> {
    const scripts: NarrationScript[] = [];

    for (const page of pages) {
      const script = await this.generatePageScript(page);
      scripts.push(script);
    }

    return scripts;
  }

  /**
   * 生成单页旁白
   */
  private async generatePageScript(
    page: GeneratedSlide,
  ): Promise<NarrationScript> {
    const prompt = `
你是专业的演示旁白撰写者。请为以下幻灯片生成播客风格的旁白脚本。

幻灯片标题: ${page.spec.title}
幻灯片内容: ${JSON.stringify(page.content)}

要求:
1. 自然流畅，适合朗读
2. 突出关键信息
3. 时长控制在 30-60 秒
4. 使用引导性语言

输出格式:
{
  "script": "旁白脚本内容",
  "duration": 估计时长(秒),
  "keyPoints": ["要点1", "要点2"]
}
`;

    const response = await this.aiChatService.chat({
      messages: [{ role: "user", content: prompt }],
      modelType: AIModelType.CHAT,
      taskProfile: { creativity: "medium", outputLength: "short" },
      responseFormat: { type: "json_object" },
    });

    return JSON.parse(response.content);
  }

  /**
   * 合成语音
   */
  async synthesizeVoice(
    scripts: NarrationScript[],
    options: VoiceOptions,
  ): Promise<AudioFile[]> {
    return Promise.all(
      scripts.map((script) =>
        this.ttsService.synthesize(script.script, {
          voice: options.voice,
          speed: options.speed,
          pitch: options.pitch,
        }),
      ),
    );
  }
}

interface NarrationScript {
  pageIndex: number;
  script: string;
  duration: number;
  keyPoints: string[];
}

interface VoiceOptions {
  voice: "male" | "female";
  speed: number;
  pitch: number;
  language: string;
}
```

---

## 六、API 设计

### 6.1 数据导入 API

```typescript
// POST /api/slides/import/research/:topicId
// POST /api/slides/import/writing/:draftId
// POST /api/slides/import/teams/:sessionId
// POST /api/slides/import/library
// Body: { resourceIds: string[] }

// Response
{
  "success": true,
  "data": SlidesSourceData
}
```

### 6.2 AI 编辑 API

```typescript
// POST /api/slides/:missionId/ai-edit/fix-layout
// Body: { pageIndex: number }

// POST /api/slides/:missionId/ai-edit/polish-content
// Body: { styleGuide?: StyleGuide, targetTone?: string }

// POST /api/slides/:missionId/ai-edit/fact-check
// Response: FactCheckResult

// POST /api/slides/:missionId/ai-edit/mark-and-edit
// Body: { pageIndex: number, markers: EditMarker[] }
```

### 6.3 Thinking Stream API

```typescript
// GET /api/slides/:missionId/stream
// Response: SSE Stream

// Event types:
// - thinking:step
// - thinking:decision
// - thinking:summary
// - page:generated
// - mission:completed
```

### 6.4 语音旁白 API

```typescript
// POST /api/slides/:missionId/voice/generate-script
// Response: NarrationScript[]

// POST /api/slides/:missionId/voice/synthesize
// Body: { scripts: NarrationScript[], options: VoiceOptions }
// Response: { audioUrls: string[] }
```

---

## 七、数据库变更

### 7.1 新增表

```prisma
// prisma/schema.prisma

model SlidesMissionSource {
  id          String   @id @default(uuid())
  missionId   String
  sourceType  String   // 'research' | 'writing' | 'teams' | 'library' | 'text'
  sourceId    String?
  sourceData  Json     // SlidesSourceData
  createdAt   DateTime @default(now())

  mission     SlidesMission @relation(fields: [missionId], references: [id])

  @@index([missionId])
}

model SlidesThinkingEntry {
  id          String   @id @default(uuid())
  missionId   String
  phase       String
  skillId     String
  title       String
  content     String
  reasoning   String?
  decision    String?
  alternatives Json?
  timestamp   DateTime @default(now())

  mission     SlidesMission @relation(fields: [missionId], references: [id])

  @@index([missionId, timestamp])
}

model SlidesFactCheck {
  id          String   @id @default(uuid())
  missionId   String
  pageIndex   Int
  claims      Json     // ClaimVerification[]
  overallScore Float
  createdAt   DateTime @default(now())

  mission     SlidesMission @relation(fields: [missionId], references: [id])

  @@index([missionId])
}

model SlidesNarration {
  id          String   @id @default(uuid())
  missionId   String
  pageIndex   Int
  script      String
  duration    Int
  audioUrl    String?
  createdAt   DateTime @default(now())

  mission     SlidesMission @relation(fields: [missionId], references: [id])

  @@index([missionId])
}
```

---

## 八、实施计划

### Phase 1: 数据源整合 (Week 1)

| 天  | 任务                         | 产出                | 验收标准     |
| --- | ---------------------------- | ------------------- | ------------ |
| D1  | SlidesDataImportService 框架 | 服务骨架 + 类型定义 | 编译通过     |
| D2  | importFromResearch 实现      | Research 导入功能   | 单元测试通过 |
| D3  | importFromWriting/Teams 实现 | Writing/Teams 导入  | 单元测试通过 |
| D4  | importFromLibrary 实现       | Library 资源导入    | 单元测试通过 |
| D5  | DataSourceSelector 前端组件  | 数据源选择 UI       | E2E 测试通过 |

### Phase 2: AI 编辑能力 (Week 2)

| 天  | 任务                    | 产出         | 验收标准     |
| --- | ----------------------- | ------------ | ------------ |
| D1  | LayoutFixerSkill        | 布局修复能力 | 单元测试通过 |
| D2  | ContentPolisherSkill    | 内容润色能力 | 单元测试通过 |
| D3  | FactCheckerSkill        | 事实核查能力 | 单元测试通过 |
| D4  | AIEditService + API     | 编辑服务层   | API 测试通过 |
| D5  | AIEditDropdown 前端组件 | AI 编辑 UI   | E2E 测试通过 |

### Phase 3: Thinking 透明度 (Week 3)

| 天  | 任务                   | 产出              | 验收标准     |
| --- | ---------------------- | ----------------- | ------------ |
| D1  | SlideThinkingSkill     | 思考记录能力      | 单元测试通过 |
| D2  | SSE 事件扩展           | thinking:\* 事件  | 事件可发送   |
| D3  | 现有 Skills 集成       | 各 Skill 思考注入 | 日志可见     |
| D4  | ThinkingPanel 前端组件 | 思考展示 UI       | 实时更新     |
| D5  | Code Tab 前端组件      | 代码预览 UI       | HTML 可查看  |

### Phase 4: 高级功能 (Week 4, 可选)

| 天  | 任务                         | 产出            | 验收标准     |
| --- | ---------------------------- | --------------- | ------------ |
| D1  | VoiceNarrationSkill 脚本生成 | 旁白脚本        | 脚本质量达标 |
| D2  | TTS 集成                     | 语音合成        | 音频可播放   |
| D3  | 前端语音播放器               | Voice Tab UI    | 播放功能正常 |
| D4  | 团队协作基础                 | 复用 AI Teams   | 基础可用     |
| D5  | 集成测试 & 文档              | E2E 测试 + 文档 | 全部通过     |

---

## 九、风险与缓解

| 风险                            | 影响         | 概率 | 缓解措施                       |
| ------------------------------- | ------------ | ---- | ------------------------------ |
| 跨模块依赖复杂                  | 开发延迟     | 中   | 定义清晰接口，Mock 测试        |
| Research/Writing 数据结构不一致 | 导入失败     | 中   | 统一 SlidesSourceData 适配层   |
| TTS 服务成本高                  | 预算超支     | 中   | 先做脚本生成，TTS 作为付费功能 |
| Thinking 事件过多影响性能       | 用户体验差   | 低   | 节流 + 按需订阅                |
| FactChecker 准确率不足          | 用户信任降低 | 中   | 标注"仅供参考"，提供来源链接   |

---

## 十、成功指标

### 10.1 功能指标

| 指标                | 目标        | 衡量方式 |
| ------------------- | ----------- | -------- |
| 数据源支持数量      | 5种         | 功能可用 |
| AI Edit 操作类型    | 4种         | 功能可用 |
| Thinking 展示覆盖率 | 100% Skills | 日志检查 |
| 单页生成速度        | < 10秒      | 性能测试 |

### 10.2 质量指标

| 指标           | 目标      | 衡量方式 |
| -------------- | --------- | -------- |
| 布局修复成功率 | > 90%     | A/B 测试 |
| 内容润色满意度 | > 4.0/5.0 | 用户评分 |
| 事实核查准确率 | > 80%     | 抽样验证 |

### 10.3 用户体验指标

| 指标            | 目标      | 衡量方式 |
| --------------- | --------- | -------- |
| 数据导入转化率  | > 60%     | 埋点统计 |
| AI Edit 使用率  | > 40%     | 埋点统计 |
| Thinking 查看率 | > 30%     | 埋点统计 |
| 整体满意度      | > 4.2/5.0 | 用户调研 |

---

## 十一、附录

### A. Genspark 功能对照表

| Genspark 功能            | Genesis V5.0 对应         | 状态    |
| ------------------------ | ------------------------- | ------- |
| Preview Tab              | SlidePreview              | ✅ 已有 |
| Code Tab                 | CodePreview               | Phase 3 |
| Thinking Tab             | ThinkingPanel             | Phase 3 |
| AI Edit → Fix Layout     | LayoutFixerSkill          | Phase 2 |
| AI Edit → Polish Content | ContentPolisherSkill      | Phase 2 |
| AI Edit → Mark and Edit  | AIEditService.markAndEdit | Phase 2 |
| Fact check content       | FactCheckerSkill          | Phase 2 |
| Save Points              | Checkpoint 系统           | ✅ 已有 |
| Presentation View        | 全屏演示                  | ✅ 已有 |
| Export (PDF/PPTX)        | SlidesExportService       | ✅ 已有 |
| Export (Google Slides)   | 待评估                    | 未计划  |
| Save as Template         | 模板保存                  | Phase 4 |
| Voice Your Slides        | VoiceNarrationSkill       | Phase 4 |
| Team Chat                | 复用 AI Teams             | Phase 4 |

### B. 文件变更清单

```
新增文件:
├── backend/src/modules/ai-app/office/slides/
│   ├── services/
│   │   ├── data-import.service.ts
│   │   └── ai-edit.service.ts
│   ├── skills/
│   │   ├── layout-fixer.skill.ts
│   │   ├── content-polisher.skill.ts
│   │   ├── fact-checker.skill.ts
│   │   ├── slide-thinking.skill.ts
│   │   └── voice-narration.skill.ts
│   └── types/
│       └── slides-source.types.ts
│
├── frontend/components/ai-office/slides/
│   ├── DataSourceSelector.tsx
│   ├── AIEditDropdown.tsx
│   ├── ThinkingPanel.tsx
│   ├── CodePreview.tsx
│   └── VoicePlayer.tsx
│
└── prisma/
    └── schema.prisma (新增 4 张表)

修改文件:
├── backend/src/modules/ai-app/office/slides/
│   ├── orchestrator/slides-team-orchestrator.ts (Thinking 集成)
│   ├── orchestrator/types.ts (新增事件类型)
│   └── skills/*.skill.ts (Thinking 注入)
│
└── frontend/components/ai-office/slides/
    └── SlidesWorkspace.tsx (集成新组件)
```

---

## 十二、UI 优化计划

### 12.1 设计原则

- **极简克制** - 只显示当前需要的内容，其余收纳
- **聚焦内容** - 预览区最大化，工具按需展开
- **渐进披露** - 高级功能通过交互逐步呈现

### 12.2 整体布局

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│   ● 洞察   美国AI系统分析报告  ✏️                    Share   ⊕   •••    │
│                                                                          │
├───────────────────────┬──────────────────────────────────────────────────┤
│                       │                                                  │
│    左侧面板 (340px)    │              右侧预览区 (flex: 1)                │
│                       │                                                  │
│  ┌─────────────────┐  │   ┌────────────────────────────────────────┐    │
│  │                 │  │   │  报告标题        Save Point ▼   Export ▼│    │
│  │   43页          │  │   └────────────────────────────────────────┘    │
│  │   2.1 MB        │  │                                                  │
│  │   PPTX          │  │   ┌────────────────────────────────────────┐    │
│  │                 │  │   │                                        │    │
│  └─────────────────┘  │   │                                        │    │
│                       │   │                                        │    │
│  ┌─────────────────┐  │   │          幻灯片预览                    │    │
│  │ 智能建议        │  │   │                                        │    │
│  │                 │  │   │                                        │    │
│  │ • 添加数据图表  │  │   │                                        │    │
│  │ • 创建精简版    │  │   │                                        │    │
│  │ • 添加趋势图    │  │   └────────────────────────────────────────┘    │
│  │                 │  │                                                  │
│  └─────────────────┘  │    Preview   Code   Thinking                    │
│                       │                                                  │
│  ───────────────────  │    Fact check    AI Edit ▼    Advanced          │
│                       │                                                  │
│  AI Slides │ Chat     │    ◀  4 / 46  ▶                                 │
│                       │                                                  │
│  ┌─────────────────┐  │                                                  │
│  │                 │  │                                                  │
│  │  输入需求...    │  │                                                  │
│  │                 │  │                                                  │
│  │  ⊕  Pro  Crea  ↵ │  │                                                  │
│  └─────────────────┘  │                                                  │
│                       │                                                  │
└───────────────────────┴──────────────────────────────────────────────────┘
```

### 12.3 核心交互：⊕ 导入弹窗

点击输入框左侧的 **⊕** 按钮，展开导入选项：

```
┌─────────────────────────────────────────────────┐
│  导入数据                                    ✕  │
├─────────────────────────────────────────────────┤
│                                                 │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐       │
│   │         │  │         │  │         │       │
│   │ Research│  │ Writing │  │  Teams  │       │
│   │   📊    │  │   ✏️    │  │   👥    │       │
│   │         │  │         │  │         │       │
│   └─────────┘  └─────────┘  └─────────┘       │
│                                                 │
│   ┌─────────┐  ┌─────────┐                    │
│   │         │  │         │                    │
│   │ Library │  │  Upload │                    │
│   │   📁    │  │   ⬆️    │                    │
│   │         │  │         │                    │
│   └─────────┘  └─────────┘                    │
│                                                 │
└─────────────────────────────────────────────────┘
```

选择 Research 后，显示报告列表：

```
┌─────────────────────────────────────────────────┐
│  ← 选择 Research 报告                        ✕  │
├─────────────────────────────────────────────────┤
│                                                 │
│  🔍 搜索报告...                                 │
│                                                 │
│  ┌───────────────────────────────────────────┐ │
│  │ 📊 2026 AI 市场趋势分析                   │ │
│  │    15页 • 3天前                           │ │
│  └───────────────────────────────────────────┘ │
│                                                 │
│  ┌───────────────────────────────────────────┐ │
│  │ 📊 量子计算产业报告                        │ │
│  │    23页 • 1周前                           │ │
│  └───────────────────────────────────────────┘ │
│                                                 │
│  ┌───────────────────────────────────────────┐ │
│  │ 📊 智能制造深度研究                        │ │
│  │    18页 • 2周前                           │ │
│  └───────────────────────────────────────────┘ │
│                                                 │
└─────────────────────────────────────────────────┘
```

### 12.4 左侧面板

```
┌─────────────────────────────┐
│                             │
│   ┌─────────────────────┐   │
│   │  📄 43页            │   │   ← 文件摘要 (收起状态)
│   │     2.1 MB  •  PPTX │   │
│   └─────────────────────┘   │
│                             │
│   ┌─────────────────────┐   │
│   │  智能建议            │   │
│   │                     │   │
│   │  ┌─────────────┐    │   │
│   │  │ 为数据页添加 │ →  │   │   ← 点击执行
│   │  │ 可视化图表   │    │   │
│   │  └─────────────┘    │   │
│   │                     │   │
│   │  ┌─────────────┐    │   │
│   │  │ 创建高管    │ →  │   │
│   │  │ 精简版      │    │   │
│   │  └─────────────┘    │   │
│   │                     │   │
│   └─────────────────────┘   │
│                             │
│   ─────────────────────     │
│                             │
│   ┌──────────┬──────────┐   │
│   │AI Slides │   Chat   │   │   ← Tab 切换
│   └──────────┴──────────┘   │
│                             │
│   ┌─────────────────────┐   │
│   │                     │   │
│   │  输入您的需求...    │   │
│   │                     │   │
│   │                     │   │
│   │ ┌───┐ ┌────┐┌────┐ │   │
│   │ │ ⊕ │ │Pro ││Crea│ ↵   │   ← ⊕ 展开导入弹窗
│   │ └───┘ └────┘└────┘ │   │
│   └─────────────────────┘   │
│                             │
└─────────────────────────────┘
```

### 12.5 右侧预览区

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  美国AI系统分析报告          Save Point ▼    Export ▼  │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                                                        │  │
│  │  ╔══════════════════════════════════════════════════╗  │  │
│  │  ║                                                  ║  │  │
│  │  ║                                                  ║  │  │
│  │  ║                                                  ║  │  │
│  │  ║            幻灯片内容渲染区                       ║  │  │
│  │  ║                                                  ║  │  │
│  │  ║                                                  ║  │  │
│  │  ║                                                  ║  │  │
│  │  ║                                                  ║  │  │
│  │  ╚══════════════════════════════════════════════════╝  │  │
│  │                                                        │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│   ┌────────┐ ┌────────┐ ┌──────────┐                        │
│   │Preview │ │  Code  │ │ Thinking │                        │
│   └────────┘ └────────┘ └──────────┘                        │
│                                                              │
│   ○ Fact check        ✨ AI Edit ▼       ∠ Advanced         │
│                                                              │
│                     ◀   4 / 46   ▶                          │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 12.6 AI Edit 菜单

```
┌──────────────────────────────┐
│  AI Edit                  ▼  │
├──────────────────────────────┤
│                              │
│  Fix Layout                  │
│  修复布局问题                │
│                              │
│  Polish Content              │
│  润色内容风格                │
│                              │
│  Mark and Edit               │
│  标记并编辑                  │
│                              │
└──────────────────────────────┘
```

### 12.7 Export 菜单

```
┌──────────────────────────────┐
│  Export                   ▼  │
├──────────────────────────────┤
│                              │
│  ▶ Presentation              │
│                              │
│  ↓ Download PPTX             │
│                              │
│  ↓ Download PDF              │
│                              │
│  ☁ Google Slides             │
│                              │
│  🎙 Voice Narration          │
│                              │
└──────────────────────────────┘
```

### 12.8 组件清单

| 组件                | 功能                       | 优先级 |
| ------------------- | -------------------------- | ------ |
| `LeftPanel`         | 左侧面板容器               | P0     |
| `FileSummary`       | 文件摘要信息               | P0     |
| `AISuggestions`     | AI 智能建议列表            | P0     |
| `InputBox`          | 输入框 + 导入按钮          | P0     |
| `ImportModal`       | ⊕ 展开的导入弹窗           | P0     |
| `SourceSelector`    | 数据源选择列表             | P0     |
| `SlidePreview`      | 幻灯片预览                 | P0     |
| `TabBar`            | Preview/Code/Thinking 切换 | P0     |
| `PageNavigator`     | 页码导航                   | P0     |
| `AIEditMenu`        | AI 编辑下拉菜单            | P1     |
| `ExportMenu`        | 导出下拉菜单               | P1     |
| `SavePointSelector` | 版本选择器                 | P1     |
| `ThinkingPanel`     | AI 推理过程                | P1     |
| `CodeViewer`        | 代码查看器                 | P1     |

### 12.9 设计规范

#### 色彩

```css
--bg-primary: #0f172a; /* 主背景 */
--bg-secondary: #1e293b; /* 卡片/面板 */
--bg-tertiary: #334155; /* 悬停态 */
--text-primary: #f8fafc; /* 主文字 */
--text-secondary: #94a3b8; /* 次级文字 */
--accent: #f97316; /* 强调色 */
--border: #334155; /* 边框 */
```

#### 间距

```css
--space-sm: 8px;
--space-md: 16px;
--space-lg: 24px;
--radius: 8px;
```

#### 响应式

```css
@media (max-width: 1024px) {
  .left-panel {
    display: none;
  } /* 收起左侧面板 */
  .menu-btn {
    display: block;
  } /* 显示汉堡菜单 */
}
```

---

## 十三、用户旅程

### 13.1 完整用户旅程图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AI Slides 用户旅程                                 │
└─────────────────────────────────────────────────────────────────────────────┘

阶段 1: 进入                     阶段 2: 选择数据源               阶段 3: 配置
┌─────────────┐                 ┌─────────────┐                 ┌─────────────┐
│  用户访问   │                 │  选择来源   │                 │  设置参数   │
│  AI Office  │ ──────────────▶ │  Research / │ ──────────────▶ │  页数/主题  │
│  Slides Tab │                 │  Writing /  │                 │  风格偏好   │
└─────────────┘                 │  Teams /    │                 └─────────────┘
      │                         │  文本输入   │                        │
      ▼                         └─────────────┘                        ▼
┌─────────────┐                        │                         ┌─────────────┐
│  查看历史   │                        ▼                         │  点击生成   │
│  Sessions   │                 ┌─────────────┐                 └─────────────┘
│  Gallery    │                 │  选择具体   │                        │
└─────────────┘                 │  资源/报告  │                        │
                                └─────────────┘                        │
                                                                       ▼
阶段 4: AI 处理 (5阶段流水线)                                          │
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐ │
│  │ Phase 1  │   │ Phase 2  │   │ Phase 3  │   │ Phase 4  │   │ Phase 5  │ │
│  │ Leader   │──▶│ 任务执行 │──▶│ Leader   │──▶│ 质量审计 │──▶│ Leader   │ │
│  │ 规划     │   │          │   │ 审核     │   │          │   │ 综合     │ │
│  └──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘ │
│       │              │              │              │              │        │
│       ▼              ▼              ▼              ▼              ▼        │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐ │
│  │Thinking  │   │Thinking  │   │Thinking  │   │Thinking  │   │Thinking  │ │
│  │ Event    │   │ Event    │   │ Event    │   │ Event    │   │ Event    │ │
│  └──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘ │
│       │              │              │              │              │        │
│       └──────────────┴──────────────┴──────────────┴──────────────┘        │
│                                    │                                        │
│                                    ▼                                        │
│                           ┌──────────────┐                                  │
│                           │ SSE Stream   │                                  │
│                           │ to Frontend  │                                  │
│                           └──────────────┘                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
阶段 5: 预览与编辑                                       阶段 6: 导出与分享
┌─────────────────────────────────────────────────────┐  ┌─────────────────────┐
│                                                     │  │                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │  │  ┌───────────────┐  │
│  │ 预览幻灯片  │  │ 查看 Code   │  │ 查看Thinking│ │  │  │  导出 PPTX    │  │
│  │             │  │             │  │             │ │  │  │  导出 PDF     │  │
│  └─────────────┘  └─────────────┘  └─────────────┘ │  │  │  在线演示     │  │
│         │                                          │  │  │  分享链接     │  │
│         ▼                                          │  │  └───────────────┘  │
│  ┌─────────────────────────────────────────────┐   │  │                     │
│  │            AI Edit 交互式编辑               │   │  └─────────────────────┘
│  │                                             │   │
│  │  • Fix Layout - 修复布局问题               │   │
│  │  • Polish Content - 润色内容风格           │   │
│  │  • Fact Check - 核查内容准确性             │   │
│  │  • @Agent 对话 - 指挥特定 Agent 修改       │   │
│  │                                             │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 13.2 场景化用户旅程

#### 场景 A: 从 AI Research 报告生成演示文稿

```
用户: 产品经理，需要向高管汇报 AI 市场研究

Step 1: 打开 AI Office → Slides Tab
        └─ 看到 Sessions Gallery（历史演示文稿）

Step 2: 点击 "新建演示文稿"
        └─ 进入数据源选择界面

Step 3: 选择 "AI Research 报告" 作为数据源
        ├─ 系统加载用户的 Research Topics 列表
        └─ 选择 "2026 AI 市场趋势分析" 报告

Step 4: 配置生成参数
        ├─ 目标页数: 15 页
        ├─ 主题风格: 商务深色
        └─ 点击 "开始生成"

Step 5: 观看 AI 处理过程
        ├─ Thinking Panel 实时展示 AI 推理
        │   ├─ "正在分析报告结构..."
        │   ├─ "识别到 5 个关键章节..."
        │   └─ "规划 15 页大纲..."
        ├─ 进度条显示: 分析中 → 规划中 → 生成中 → 审核中
        └─ 缩略图逐页出现

Step 6: 预览与调整
        ├─ 点击第 8 页，发现数据图表不清晰
        ├─ 使用 AI Edit → Fix Layout
        └─ 在对话框输入 "@writer 第8页的市场份额数据需要用饼图展示"

Step 7: 导出
        ├─ 点击 "导出" → 选择 PPTX 格式
        └─ 下载文件: "2026_AI_市场趋势分析.pptx"
```

#### 场景 B: 从 AI Teams 辩论结果生成决策演示

```
用户: 战略总监，需要展示团队辩论的决策结论

Step 1: 选择 "AI Teams 辩论" 作为数据源
        └─ 选择 "是否进入东南亚市场" 辩论会话

Step 2: 系统自动提取
        ├─ 正方观点 (市场机会)
        ├─ 反方观点 (风险挑战)
        └─ 最终共识结论

Step 3: 生成结果
        ├─ 自动创建对比类模板 (D-004 Comparison)
        ├─ 支持/反对观点并列展示
        └─ 结论页使用 A-003 Key Conclusions 模板

Step 4: AI Edit → Fact Check
        ├─ 系统检查引用的数据源
        ├─ 高亮标记需要验证的声明
        └─ 提供来源链接
```

#### 场景 C: 从文本直接生成 (传统模式)

```
用户: 销售经理，需要快速制作产品介绍 PPT

Step 1: 选择 "直接输入" 作为数据源

Step 2: 粘贴产品文档内容

Step 3: 配置
        ├─ 目标页数: 8 页
        └─ 主题: 科技蓝

Step 4: 生成 → 预览 → 导出
```

### 13.3 关键触点与情绪曲线

```
情绪
  ↑
  │                                              ✓ 看到成果
  │                                         ┌────────●
  │                                    ┌────┘
  │                               ┌────┘ 页面逐渐出现
高 │    ✓ 选择数据源         ┌────┘
  │    ┌──●──────────────────┘ AI Thinking 透明
  │   ┌┘
  │  ┌┘
  │ ┌┘ 进入页面
中 │●
  │
  │
  │                  ⚠ 等待生成 (如果无 Thinking 会焦虑)
低 │
  │
  └────────────────────────────────────────────────────────▶ 时间
      进入    选择    配置    生成中    预览    编辑    导出
```

**关键设计原则**:

1. **减少等待焦虑**: Thinking Panel 实时展示 AI 推理，用户知道"正在发生什么"
2. **渐进式反馈**: 缩略图逐页出现，而非最后一次性展示
3. **掌控感**: AI Edit 让用户随时可以干预调整
4. **数据复用**: 从其他模块导入，避免重复输入

---

## 十四、用户结果

### 14.1 最终交付物

用户完成 AI Slides 流程后，获得以下结果：

#### 14.1.1 核心产出

| 产出物       | 格式             | 描述                           |
| ------------ | ---------------- | ------------------------------ |
| **演示文稿** | PPTX / PDF / PNG | 可直接用于汇报的专业幻灯片     |
| **在线演示** | Web URL          | 可分享的在线演示链接           |
| **源代码**   | HTML + CSS       | 每页的 HTML 源码（可二次编辑） |
| **大纲文档** | JSON / Markdown  | 结构化的演示大纲               |

#### 14.1.2 元数据与洞察

| 产出物               | 描述                       |
| -------------------- | -------------------------- |
| **AI Thinking 日志** | 完整的 AI 推理过程记录     |
| **Fact Check 报告**  | 内容准确性检查结果         |
| **质量审计报告**     | 术语一致性、过渡流畅度评分 |
| **版本历史**         | Save Points，支持回滚      |

### 14.2 交付物质量标准

#### 14.2.1 视觉质量

```
┌─────────────────────────────────────────────────────────────────┐
│                    单页质量检查清单                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ☐ 布局完整 - 无元素溢出、重叠                                  │
│  ☐ 内容可读 - 字体大小 ≥ 18px，对比度 ≥ 4.5:1                  │
│  ☐ 视觉层次 - 标题 > 正文 > 说明文字                            │
│  ☐ 品牌一致 - 颜色符合主题，字体统一                            │
│  ☐ 数据可视 - 图表清晰，标签完整                                │
│  ☐ 图片适配 - 图片清晰，比例正确                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### 14.2.2 内容质量

| 指标         | 标准             | 验证方式                |
| ------------ | ---------------- | ----------------------- |
| **观点明确** | 每页标题是判断句 | QualityAuditSkill       |
| **逻辑清晰** | 结构与内容匹配   | TemplateMatcherSkill    |
| **数据准确** | 引用有出处       | FactCheckerSkill        |
| **术语统一** | 全文专业术语一致 | TerminologyUnifierSkill |
| **过渡流畅** | 页间逻辑连贯     | TransitionCheckerSkill  |

### 14.3 各数据源产出对比

| 数据源          | 独特产出                       | 适用场景           |
| --------------- | ------------------------------ | ------------------ |
| **AI Research** | 数据图表自动生成、引用来源标注 | 市场分析、行业报告 |
| **AI Writing**  | 章节结构保留、叙事连贯         | 产品介绍、培训材料 |
| **AI Teams**    | 多方观点对比、共识结论         | 决策汇报、辩论总结 |
| **Library**     | 品牌素材复用、统一视觉         | 品牌宣传、企业介绍 |
| **文本输入**    | 快速生成、灵活定制             | 临时汇报、快速原型 |

### 14.4 产出示例

#### 示例 1: 从 AI Research 生成的市场分析演示

```
┌─────────────────────────────────────────────────────────────────┐
│  封面                                                           │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                                                           │ │
│  │         2026 全球 AI 市场趋势分析                         │ │
│  │                                                           │ │
│  │              Genesis Research Team                       │ │
│  │                   2026.01.26                              │ │
│  │                                                           │ │
│  └───────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  数据页 (D-002 Dashboard)                                       │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                                                           │ │
│  │  AI 市场核心指标                                          │ │
│  │                                                           │ │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐     │ │
│  │  │ $890B   │  │  +23%   │  │  45%    │  │  1.2M   │     │ │
│  │  │市场规模 │  │ 年增长率│  │ 企业渗透│  │ AI岗位 │     │ │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘     │ │
│  │                                                           │ │
│  │  来源: Genesis Research 分析                             │ │
│  │                                                           │ │
│  └───────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  内容页 (S-003 三支柱)                                          │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                                                           │ │
│  │  AI 发展三大驱动力                                        │ │
│  │                                                           │ │
│  │  ┌─────────┐     ┌─────────┐     ┌─────────┐            │ │
│  │  │         │     │         │     │         │            │ │
│  │  │ 算力突破│     │数据积累 │     │算法创新 │            │ │
│  │  │         │     │         │     │         │            │ │
│  │  │ GPU性能 │     │ 万亿级  │     │Transformer│           │ │
│  │  │ 提升10x │     │ 训练数据│     │ 架构革命 │            │ │
│  │  │         │     │         │     │         │            │ │
│  │  └─────────┘     └─────────┘     └─────────┘            │ │
│  │                                                           │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

#### 示例 2: 从 AI Teams 生成的决策演示

```
┌─────────────────────────────────────────────────────────────────┐
│  对比页 (D-004 Comparison Dual)                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                                                           │ │
│  │  是否进入东南亚市场？                                      │ │
│  │                                                           │ │
│  │  ┌─────────────────┐     ┌─────────────────┐            │ │
│  │  │     支持        │     │     反对        │            │ │
│  │  │                 │     │                 │            │ │
│  │  │ ✓ 6亿人口市场  │     │ ✗ 本地化成本高  │            │ │
│  │  │ ✓ 数字化加速   │     │ ✗ 竞争激烈      │            │ │
│  │  │ ✓ 政策支持     │     │ ✗ 支付体系复杂  │            │ │
│  │  │                 │     │                 │            │ │
│  │  │ @analyst 观点  │     │ @reviewer 观点  │            │ │
│  │  └─────────────────┘     └─────────────────┘            │ │
│  │                                                           │ │
│  └───────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  结论页 (A-003 Key Conclusions)                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                                                           │ │
│  │  团队共识：建议分阶段进入                                 │ │
│  │                                                           │ │
│  │  1. 第一阶段：新加坡试点 (Q2 2026)                       │ │
│  │  2. 第二阶段：马来西亚扩展 (Q4 2026)                     │ │
│  │  3. 第三阶段：印尼、泰国 (2027)                          │ │
│  │                                                           │ │
│  │  关键前提：                                               │ │
│  │  • 本地团队组建完成                                       │ │
│  │  • 支付合作伙伴确定                                       │ │
│  │                                                           │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 14.5 产出物导出格式详情

#### PPTX 导出规格

```
文件格式: Microsoft PowerPoint 2016+ (.pptx)
幻灯片尺寸: 16:9 (1920x1080px) 或 4:3 (1024x768px)
字体嵌入: 是 (避免跨设备字体丢失)
图片质量: 高清 (原始分辨率)
动画: 基础入场动画 (可选)
备注: 包含 AI Thinking 摘要 (可选)
```

#### PDF 导出规格

```
文件格式: PDF/A-1b (长期存档)
页面尺寸: A4 横向 或 自定义
分辨率: 300 DPI (打印质量)
包含: 可搜索文本、超链接
```

#### 在线演示

```
URL 格式: https://app.genesis.ai/share/slides/{sessionId}
有效期: 永久 (可设置过期)
权限: 公开 / 密码保护 / 仅限指定用户
功能: 全屏演示、缩略图导航、移动端适配
```

---

## 十五、参考资料

1. Genspark AI Slides: https://www.genspark.ai/agents
2. Genesis AI Slides Architecture: `backend/src/modules/ai-app/office/slides/docs/ARCHITECTURE.md`
3. AI Teams System Design: `docs/features/ai-teams/system-design.md`
4. Skills 技能库: `backend/src/modules/ai-app/office/slides/skills/`

---

**文档版本历史**

| 版本 | 日期       | 作者        | 变更说明                                     |
| ---- | ---------- | ----------- | -------------------------------------------- |
| 1.0  | 2026-01-26 | Claude Code | 初始版本，完整方案                           |
| 1.1  | 2026-01-26 | Claude Code | 新增 UI优化计划、用户旅程、用户结果 三个章节 |
