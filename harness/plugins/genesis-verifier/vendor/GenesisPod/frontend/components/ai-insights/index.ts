/**
 * AI Insights Components
 *
 * 专题洞察模块组件导出
 * - Topic Insights: 专题洞察
 */

// Topic Components
export {
  TopicCard,
  TopicCollaborationPanel,
  TopicContentPanel,
  TopicCredibilityPanel,
  TopicDetail,
  TopicHistoryPanel,
  TopicReferencesPanel,
  TopicResearchLayout,
  TopicResearchTab,
  TopicTeamPanel,
} from './topics';

// Research Control Components
export {
  ResearchCommandInput,
  ResearchProgressBar,
  ResearchProgressSummary,
  ResearchSettingsModal,
  ResearchTeamPanel,
  ResearchTodoList,
  QuickCommandBar,
} from './research-control';

// Report Components
export {
  ReportEditor,
  ReportEditPanel,
  ReportOutlineNav,
  ReportRevisionHistory,
  ReportTemplateDialog,
  ChapterizedReportView,
  ChangeReviewPanel,
  ChangeSummaryPanel,
} from './reports';

// Panel Components
export {
  CredibilityPanel,
  ReferencePanel,
  TextSelectionContextMenu,
  TodoDetailPanel,
} from './panels';

// Dialog Components
export { CreateTopicDialog, TopicSharingModal } from './dialogs';

// Collaboration Components
export { ResearchCollaborationPanel } from './collaboration/ResearchCollaborationPanel';
export { AgentThinkingGraph } from './collaboration/AgentThinkingGraph';

// Annotation Components
export { ReportAnnotations } from '@/components/common/annotations/ReportAnnotations';

// AI Edit Components
export * from '@/components/common/ai-text-edit';

// Topic Content Components
export * from './topic-content';
