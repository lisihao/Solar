import type {
  ResearchTask,
  ResearchTopic,
  TopicDimension,
} from "@prisma/client";
import type { ResearchDepthConfig } from "../../../types/research-depth.types";

export interface TaskExecutionContext {
  task: ResearchTask;
  topic: ResearchTopic & { dimensions: TopicDimension[] };
  missionId: string;
  reportId: string;
  depthConfig?: ResearchDepthConfig;
  assignedModelId?: string;
  assignedSkills: string[];
  assignedTools: string[];
  agentName: string;
  agentRole: string;
}

export interface TaskExecutionResult {
  summary?: string;
  content?: string;
  reportId?: string;
  chapters?: unknown[];
  status?: string;
  message?: string;
  feedback?: string;
  wordCount?: number;
  sourcesFound?: number;
  reviewedTasks?: number;
  dimensionReviews?: unknown[];
  overallReview?: unknown;
  keyFindings?: Array<
    | string
    | {
        finding: string;
        title?: string;
        significance?: string;
        evidenceIds?: string[];
      }
  >;
  analysisResult?: {
    summary?: string;
    keyFindings?: Array<
      string | { finding: string; title?: string; significance?: string }
    >;
  };
  trends?: unknown;
  challenges?: unknown;
  opportunities?: unknown;
  evidenceUsed?: number;
  confidenceLevel?: string;
  detailedContent?: string;
  figureReferences?: unknown;
  generatedCharts?: unknown;
  actualModelId?: string;
  /** ★ 质量审核修订决策（由 ReviewDimensionExecutor 填充，MissionExecutionService 消费） */
  revisionTargets?: Array<{
    taskId: string;
    dimensionId: string;
    dimensionName: string;
    score: number;
    feedback: string;
  }>;
  /** ★ 当前审核轮次（1=首轮，2=修订后复审） */
  revisionRound?: number;
}

export interface ITaskExecutor {
  execute(context: TaskExecutionContext): Promise<TaskExecutionResult>;
}
