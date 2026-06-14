// 结构化AI摘要组件导出

export { StructuredAISummaryBase } from './StructuredAISummaryBase';
export { PaperAISummaryComponent as PaperAISummary } from './PaperAISummary';
export { NewsAISummaryComponent as NewsAISummary } from './NewsAISummary';
export { VideoAISummaryComponent as VideoAISummary } from './VideoAISummary';
export { ProjectAISummaryComponent as ProjectAISummary } from './ProjectAISummary';
export { ReportAISummaryComponent as ReportAISummary } from './ReportAISummary';
export {
  StructuredAISummaryRouter,
  isStructuredAISummary,
  convertToStructuredSummary,
} from './StructuredAISummaryRouter';

export type { StructuredAISummaryProps } from './StructuredAISummaryRouter';
