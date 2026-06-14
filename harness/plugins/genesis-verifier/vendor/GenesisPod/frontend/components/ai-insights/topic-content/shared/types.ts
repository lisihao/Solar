/**
 * Shared types for Topic Content Panel components
 */

import type { MissionStatus } from '@/services/topic-insights/api';

// Message detail types
export interface MessageDetail {
  type:
    | 'dimension_content'
    | 'report_preview'
    | 'leader_plan'
    | 'agent_analysis'
    | 'text';
  data: string | Record<string, unknown>;
}

// UI Message type
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

// Research Event type
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

// Agent Thinking type
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
