/**
 * AI Apps 类目配置（admin overview L3 层 4 卡 → 类目页）。
 *
 * 每个类目下挂一组 ai-app 模块，每个模块绑定 docs/architecture/ai-app/<module>/
 * 下的 canonical 文档（README.md 或 architecture.md，按存在情况降级）。
 *
 * 类目顶部带一张 Mermaid 概览图，归纳本类下各模块的位置/数据流。
 */

export type AiAppCategoryId = 'insights' | 'planning' | 'content' | 'labs';

export interface AiAppCategoryModule {
  /** 模块短码（与 docs/architecture/ai-app/<id>/ 一致） */
  id: string;
  /** Tab 显示名 */
  label: string;
  /** 一句话说明 */
  blurb: string;
  /**
   * 文档相对路径数组（相对 repo root: docs/architecture/ai-app/<id>/）。
   * 按顺序读取，找到第一个存在的就用作首屏内容。
   */
  docCandidates: string[];
}

export interface AiAppCategoryConfig {
  id: AiAppCategoryId;
  titleKey: string;
  descriptionKey: string;
  /** 顶部概览 Mermaid 源文本（graph TD/LR） */
  overviewDiagram: string;
  modules: AiAppCategoryModule[];
}

export const AI_APP_CATEGORIES: Record<AiAppCategoryId, AiAppCategoryConfig> = {
  insights: {
    id: 'insights',
    titleKey: 'admin.architecture.cards.aiAppsInsights',
    descriptionKey: 'admin.architecture.cards.aiAppsInsightsDesc',
    overviewDiagram: `flowchart LR
  Ask[AI 问答<br/>ask] -->|短问短答| User((用户))
  Insights[话题洞察<br/>topic-insights] -->|主题追踪| User
  Research[深度研究<br/>research] -->|长篇报告| User
  Radar[雷达简报<br/>radar] -->|每日简报| User
  Insights -.派生.-> Research
  Research -.溯源.-> Insights
  Radar -.触发.-> Insights
  classDef app fill:#fff7ed,stroke:#f59e0b,color:#92400e;
  class Ask,Insights,Research,Radar app;`,
    modules: [
      {
        id: 'ask',
        label: 'AI 问答',
        blurb: '智能问答，多模型切换 + Teams 模式',
        docCandidates: ['ask/README.md', 'ask/teams-mode.md'],
      },
      {
        id: 'topic-insights',
        label: '话题洞察',
        blurb: 'Research 衍生：主题追踪、事件聚合、图表流水线',
        docCandidates: [
          'topic-insights/event-insights-design.md',
          'topic-insights/frontend-optimization-plan.md',
          'topic-insights/figure-pipeline-plan.md',
        ],
      },
      {
        id: 'research',
        label: '深度研究',
        blurb: '多步骤规划 + 迭代检索 + 长篇报告生成',
        docCandidates: [
          'research/iterative-research-system.md',
          'research/research-modes.md',
          'research/ui-restructure.md',
        ],
      },
      {
        id: 'radar',
        label: '雷达简报',
        blurb: '主题雷达：定时监控 + 每日简报聚合',
        docCandidates: ['radar/daily-briefing-redesign-2026-05-18.md'],
      },
    ],
  },

  planning: {
    id: 'planning',
    titleKey: 'admin.architecture.cards.aiAppsPlanning',
    descriptionKey: 'admin.architecture.cards.aiAppsPlanningDesc',
    overviewDiagram: `flowchart TB
  Teams[多 Agent 团队<br/>teams] -->|辩论 / 评审 / 投票| Decision((决策))
  Planning[规划编排<br/>planning] -->|任务分解 / DAG| Decision
  Simulation[推演模拟<br/>simulation] -->|场景演化| Decision
  Teams -.提案.-> Planning
  Planning -.验证.-> Simulation
  classDef app fill:#eef2ff,stroke:#6366f1,color:#3730a3;
  class Teams,Planning,Simulation app;`,
    modules: [
      {
        id: 'teams',
        label: 'AI 团队',
        blurb: '多 Agent 协作：辩论 / 评审 / 投票',
        docCandidates: [
          'teams/architecture.md',
          'teams/core-concepts.md',
          'teams/capability-integration.md',
        ],
      },
      {
        id: 'planning',
        label: '规划编排',
        blurb: '任务分解、DAG、Mission 模板',
        docCandidates: ['planning/README.md'],
      },
      {
        id: 'simulation',
        label: '推演模拟',
        blurb: '多角色场景推演与辩论',
        docCandidates: ['simulation/architecture.md', 'simulation/README.md'],
      },
    ],
  },

  content: {
    id: 'content',
    titleKey: 'admin.architecture.cards.aiAppsContent',
    descriptionKey: 'admin.architecture.cards.aiAppsContentDesc',
    overviewDiagram: `flowchart LR
  Writing[长文写作<br/>writing]
  Office[Office 文档<br/>office]
  Social[社交内容<br/>social]
  Image[图像生成<br/>image]
  Writing -->|引用| Library[(知识资源)]
  Office -->|文档资产| Library
  Social --> Output((发布产物))
  Image --> Output
  Writing --> Output
  Office --> Output
  classDef app fill:#ecfdf5,stroke:#10b981,color:#065f46;
  class Writing,Office,Social,Image app;`,
    modules: [
      {
        id: 'writing',
        label: 'AI 写作',
        blurb: '长文本创作：Super Brain 风格写作管线',
        docCandidates: ['writing/architecture.md', 'writing/super-brain.md'],
      },
      {
        id: 'office',
        label: 'AI Office',
        blurb: '文档 / PPT / 设计生成，多文件分析',
        docCandidates: [
          'office/content-studio.md',
          'office/content-driven-refactor.md',
          'office/multi-file-analysis.md',
        ],
      },
      {
        id: 'social',
        label: 'AI 社交',
        blurb: '社交内容生成 + 多 MCP 接入',
        docCandidates: [
          'social/architecture.md',
          'social/create-redesign.md',
          'social/mcp-refactor.md',
        ],
      },
      {
        id: 'image',
        label: 'AI 图像',
        blurb: '视觉引擎：图像生成 + 编辑',
        docCandidates: [
          'image/architecture.md',
          'image/README.md',
          'image/visual-engine-migration.md',
        ],
      },
      {
        id: 'library',
        label: '知识资源',
        blurb: '资源库：RAG 知识库 + Wiki + 集合/笔记',
        docCandidates: [
          'library/features-rag/readme.md',
          'library/wiki/llm-wiki.md',
        ],
      },
    ],
  },

  labs: {
    id: 'labs',
    titleKey: 'admin.architecture.cards.aiAppsLabs',
    descriptionKey: 'admin.architecture.cards.aiAppsLabsDesc',
    overviewDiagram: `flowchart TB
  Playground[Agent Playground<br/>agent-playground] -->|canonical 实现| Templates[Benchmark Templates]
  Templates -->|拷贝起点| NewTeam[新 Agent Team]
  Playground -.边界审计.-> Invariants[R6/R7/R8 不变式]
  classDef app fill:#fef3c7,stroke:#f59e0b,color:#92400e;
  class Playground app;`,
    modules: [
      {
        id: 'agent-playground',
        label: 'Agent Playground',
        blurb: 'Canonical Agent Team 实现 + Anthropic SDK 演进基准',
        docCandidates: [
          'agent-playground/anthropic-sdk-revamp-plan-v5.1.md',
          'agent-playground/agent-team-boundary-audit-2026-05-08.md',
          'agent-playground/anthropic-sdk-revamp-review-v5-arch-auditor.md',
        ],
      },
      {
        id: 'benchmark',
        label: 'Benchmark 模板',
        blurb: '新 Agent Team 拷贝起点 + 不变式守门',
        docCandidates: [
          'benchmark-agent-team-template.md',
          'benchmark-agent-team-invariants.md',
        ],
      },
    ],
  },
};
