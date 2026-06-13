'use client';

/**
 * Topic Content Context - 共享上下文，避免 props drilling
 *
 * 提供报告、证据、用户信息等共享数据
 */

import { createContext, useContext } from 'react';
import type {
  TopicReport,
  TopicDimension,
  TopicEvidence,
} from '@/lib/types/topic-insights';
import type { MissionStatus } from '@/services/topic-insights/api';

// Annotation types
export type AnnotationColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple';
export type AnnotationStatus = 'active' | 'resolved' | 'archived';

export interface ReportAnnotation {
  id: string;
  reportId: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  selectedText: string;
  content: string;
  startOffset: number;
  endOffset: number;
  sectionId?: string;
  color: AnnotationColor;
  status: AnnotationStatus;
  selectorPrefix?: string;
  selectorSuffix?: string;
  createdAt: string;
  updatedAt: string;
  replies?: Array<{
    id: string;
    userId: string;
    userName: string;
    userAvatar?: string;
    content: string;
    createdAt: string;
  }>;
}

export interface ReportRevision {
  id: string;
  version: number;
  createdAt: Date;
  summary?: string;
}

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

interface WsEvent {
  type: string;
  data: unknown;
  timestamp: string;
}

interface TopicContentContextValue {
  // Core data
  topicId?: string;
  report: TopicReport | null;
  dimensions: TopicDimension[];
  evidence: TopicEvidence[];

  // Loading states
  isLoadingReport: boolean;
  isLoadingEvidence: boolean;
  isRefreshing: boolean;

  // Annotations
  annotations: ReportAnnotation[];
  highlightedAnnotationId: string | null;
  isLoadingAnnotations: boolean;
  setHighlightedAnnotationId: (id: string | null) => void;

  // History
  revisions: ReportRevision[];

  // Events
  researchEvents: ResearchEvent[];
  agentThinkings: AgentThinking[];
  wsEvents: WsEvent[];
  wsConnected: boolean;

  // User info
  currentUserId?: string;
  currentUserName: string;
  canEdit: boolean;

  // Mission status
  missionStatus?: MissionStatus | null;

  // Handlers - Annotations
  onAnnotationAdd: (
    annotation: Omit<
      ReportAnnotation,
      'id' | 'createdAt' | 'updatedAt' | 'replies'
    >
  ) => Promise<void>;
  onAnnotationUpdate: (annotationId: string, content: string) => Promise<void>;
  onAnnotationDelete: (annotationId: string) => Promise<void>;
  onAnnotationResolve: (annotationId: string) => Promise<void>;
  onAnnotationReply: (annotationId: string, content: string) => Promise<void>;

  // Handlers - Version control
  onRollbackVersion?: (revisionId: string) => void;

  // Handlers - Export
  onExportReport?: (format: 'pdf' | 'docx') => void;

  // Handlers - Events
  onClearWsEvents?: () => void;
  onSendLeaderInstruction?: (instruction: string) => void;

  // Handlers - Report operations
  onDeleteReport?: (reportId: string) => Promise<void>;
}

const TopicContentContext = createContext<TopicContentContextValue | null>(
  null
);

export function useTopicContent() {
  const context = useContext(TopicContentContext);
  if (!context) {
    throw new Error('useTopicContent must be used within TopicContentProvider');
  }
  return context;
}

export const TopicContentProvider = TopicContentContext.Provider;
