/**
 * AI App Shared - Data Export Interfaces
 *
 * Abstract contracts for importing data from Topic Insights, Research Project,
 * and Writing modules into Office/Slides.
 * Placed in ai-app/contracts/ so consumers can reference tokens without creating
 * cross-App dependencies.
 *
 * Providers are registered in each owner module and injected into Office
 * via DI tokens.
 *
 * Ownership map:
 * - TOPIC_INSIGHTS_DATA_EXPORT   → InsightModule (owns ResearchTopic model)
 * - RESEARCH_PROJECT_DATA_EXPORT → ResearchModule (owns ResearchProject model)
 * - WRITING_DATA_EXPORT          → AiWritingModule  (owns WritingProject model)
 */

// ============================================
// DI Tokens
// ============================================

export const TOPIC_INSIGHTS_DATA_EXPORT = Symbol("TOPIC_INSIGHTS_DATA_EXPORT");
export const RESEARCH_PROJECT_DATA_EXPORT = Symbol(
  "RESEARCH_PROJECT_DATA_EXPORT",
);
export const WRITING_DATA_EXPORT = Symbol("WRITING_DATA_EXPORT");

// ============================================
// Topic Insights Export Contract
// ============================================

export interface ITopicInsightsListItem {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  dimensionCount: number;
}

export interface IExportableTopicInsightsData {
  id: string;
  name: string;
  description: string | null;
  language: string | null;
  createdAt: Date;
  dimensions: Array<{
    name: string;
    description: string | null;
    sortOrder: number;
  }>;
  latestReport: {
    fullReport: string | null;
    charts: unknown;
    highlights: unknown;
    dimensionAnalyses: Array<{
      summary: string | null;
      dataPoints: unknown;
      dimension: {
        name: string;
      };
    }>;
  } | null;
}

export interface ITopicInsightsDataExport {
  getTopicForExport(
    topicId: string,
    userId: string,
  ): Promise<IExportableTopicInsightsData>;

  listTopicsForExport(
    userId: string,
    limit?: number,
  ): Promise<ITopicInsightsListItem[]>;
}

// ============================================
// Research Project Export Contract
// ============================================

export interface IResearchProjectListItem {
  id: string;
  name: string;
  description: string | null;
  researchType: string;
  createdAt: Date;
  outputCount: number;
}

export interface IExportableResearchProjectData {
  id: string;
  name: string;
  description: string | null;
  researchType: string;
  createdAt: Date;
  outputs: Array<{
    id: string;
    type: string;
    title: string;
    status: string;
    content: string | null;
  }>;
}

export interface IResearchProjectDataExport {
  getProjectForExport(
    projectId: string,
    userId: string,
  ): Promise<IExportableResearchProjectData>;

  listProjectsForExport(
    userId: string,
    limit?: number,
  ): Promise<IResearchProjectListItem[]>;
}

// ============================================
// Writing Export Contract
// ============================================

export interface IWritingListItem {
  id: string;
  name: string;
  genre: string | null;
  createdAt: Date;
  volumeCount: number;
}

export interface IExportableWritingData {
  id: string;
  name: string;
  genre: string | null;
  writingStyle: string | null;
  createdAt: Date;
  volumes: Array<{
    id: string;
    title: string;
    volumeNumber: number;
    chapters: Array<{
      id: string;
      title: string;
      chapterNumber: number;
      content: string | null;
    }>;
  }>;
}

export interface IWritingDataExport {
  getProjectForExport(
    projectId: string,
    userId: string,
  ): Promise<IExportableWritingData>;

  listProjectsForExport(
    userId: string,
    limit?: number,
  ): Promise<IWritingListItem[]>;
}
