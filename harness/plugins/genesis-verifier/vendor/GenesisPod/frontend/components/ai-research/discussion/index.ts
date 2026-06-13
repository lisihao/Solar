/**
 * Discussion Components - 讨论驱动研究组件导出
 */

// Command Palette
export { default as CommandPalette, useCommandPalette } from './CommandPalette';
export type { CommandItem } from './CommandPalette';

// Research Plan
export {
  default as ResearchPlan,
  createDefaultResearchPlan,
} from './ResearchPlan';
export type {
  ResearchPlanData,
  ResearchStep,
  StepStatus,
} from './ResearchPlan';

// Citation Preview
export {
  default as CitationList,
  CitationPreview,
  CitationMetricsBar,
  CitationBadge,
  InlineCitation,
} from './CitationPreview';
export type { Citation, CitationMetrics } from './CitationPreview';

// Trend Report
export { default as TrendReport } from './TrendReport';
export type { TechTrend, TrendReportData } from './TrendReport';

// Comparison Matrix
export { default as ComparisonMatrix } from './ComparisonMatrix';
export type { TechScore, TechComparisonData } from './ComparisonMatrix';

// Hype Cycle Chart
export { default as HypeCycleChart } from './HypeCycleChart';
export type { HypeCyclePosition } from './HypeCycleChart';

// Knowledge Graph
export { default as KnowledgeGraph } from './KnowledgeGraph';
export type { GraphNode, GraphEdge, GraphData } from './KnowledgeGraph';

// Output Viewer
export { OutputViewer } from './outputs/OutputViewer';

// File Uploader
export { FileUploader } from './FileUploader';

// ==================== New Components ====================

// Agent Panel (SVG hexagonal team visualization)
export { AgentPanel } from './AgentPanel';

// Discussion Chat (chat area with session history)
export { DiscussionChat } from './DiscussionChat';

// Chat Message (individual message bubble)
export { ChatMessage } from './ChatMessage';

// Phase Indicator (research phase progress bar)
export { PhaseIndicator } from './PhaseIndicator';

// Phase Transition (phase change divider)
export { PhaseTransition } from './PhaseTransition';

// Ideas Panel (research ideas card grid)
export { IdeasPanel } from './IdeasPanel';

// Demos Panel (interactive demo viewer with iframe)
export { DemosPanel } from './DemosPanel';

// Report Panel (research report viewer)
export { ReportPanel } from './ReportPanel';
