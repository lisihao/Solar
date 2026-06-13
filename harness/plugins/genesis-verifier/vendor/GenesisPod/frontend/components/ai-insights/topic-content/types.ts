/**
 * Type definitions for TopicContentPanel
 * Extracted from TopicContentPanel.tsx to reduce file size
 */

import type {
  TopicReport,
  TopicDimension,
  TopicEvidence,
} from '@/lib/types/topic-insights';
import type { MissionStatus } from '@/services/topic-insights/api';

export type ReportViewMode = 'continuous' | 'chapter';

export type TabType =
  | 'report'
  | 'collaboration'
  | 'references'
  | 'credibility'
  | 'research_collab'
  | 'history';

export interface ResearchEvent {
  id: string;
  timestamp: Date;
  agentType: 'leader' | 'researcher' | 'reviewer' | 'synthesizer';
  agentName: string;
  eventType: 'start' | 'progress' | 'complete' | 'error' | 'decision';
  dimensionName?: string;
  message: string;
  details?: string;
}

export interface AgentThinking {
  id: string;
  agentType: 'leader' | 'researcher' | 'reviewer' | 'synthesizer';
  agentName: string;
  timestamp: Date;
  phase: string;
  thinking: string;
  decision?: string;
  reasoning?: string;
}

export interface ReportRevision {
  id: string;
  version: number;
  createdAt: Date;
  summary?: string;
}

export interface WsEvent {
  type: string;
  data: unknown;
  timestamp: string;
}

export interface MessageDetail {
  type:
    | 'dimension_content'
    | 'report_preview'
    | 'leader_plan'
    | 'agent_analysis'
    | 'text';
  data: string | Record<string, unknown>;
}

export interface UIMessage {
  id: string;
  type: 'system' | 'agent' | 'progress' | 'leader';
  agent?: string;
  agentIcon?: string;
  agentColor?: string;
  agentBgColor?: string;
  agentType?: string;
  content: string;
  timestamp: Date;
  detail?: MessageDetail;
  progress?: number;
  status?: 'success' | 'error' | 'in_progress' | 'pending';
  dimensionName?: string;
}

export interface TopicContentPanelProps {
  report: TopicReport | null;
  dimensions: TopicDimension[];
  evidence: TopicEvidence[];
  isLoadingReport: boolean;
  isLoadingEvidence: boolean;
  onExportReport?: (format: 'pdf' | 'docx') => void;
  researchEvents?: ResearchEvent[];
  agentThinkings?: AgentThinking[];
  revisions?: ReportRevision[];
  onRollbackVersion?: (revisionId: string) => void;
  onSendLeaderInstruction?: (instruction: string) => void;
  isRefreshing?: boolean;
  wsEvents?: WsEvent[];
  wsConnected?: boolean;
  onClearWsEvents?: () => void;
  missionStatus?: MissionStatus | null;
  topicId?: string;
  onDeleteReport?: (reportId: string) => Promise<void>;
  initialView?: string | null;
  canEdit?: boolean;
}

export interface AgentDetailInfo {
  name: string;
  role: string;
  description: string;
  icon: string;
  color: string;
  bgColor: string;
}
