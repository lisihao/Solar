/**
 * AI Research shared types
 */

import type { DeepResearchReport } from '@/hooks';
import type { IterationRound } from '@/hooks/features/useIterativeResearch';

export interface IterationMeta {
  exitReason: string | null;
  finalScore: number | null;
  totalIterations: number | null;
  maxIterations: number;
}

export interface ResearchSession {
  id: string;
  query: string;
  status: string;
  mode?: 'single' | 'iterative';
  report?: DeepResearchReport;
  discussion?: Array<{
    id: string;
    agentRole: string;
    agentName: string;
    agentIcon: string;
    content: string;
    phase: string;
    messageType: string;
    metadata?: {
      searchResults?: unknown[];
      directions?: string[];
      citations?: number[];
    };
    timestamp: string | Date;
  }>;
  directions?: {
    directions?: Array<{
      title: string;
      description?: string;
      assignedTo?: string;
      searchQueries?: string[];
    }>;
    iterationSnapshots?: IterationRound[];
    iterationMeta?: IterationMeta;
    iterationRecords?: string[]; // Per-round Markdown records
  } | null;
  sourcesUsed: number;
  tokensUsed: number;
  createdAt: string;
  completedAt?: string;
  error?: string;
}
