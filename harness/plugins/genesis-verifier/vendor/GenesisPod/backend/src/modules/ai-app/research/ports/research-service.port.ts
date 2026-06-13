/**
 * Research domain service port.
 *
 * This port belongs to the research app domain. It must not live in
 * ai-engine or ai-harness facades because it represents research-specific
 * application semantics rather than reusable engine capability.
 */
export interface IResearchService {
  createProject(
    userId: string,
    title: string,
    description?: string,
  ): Promise<{
    id: string;
    title: string;
    description?: string;
  }>;

  saveResearchOutput(
    userId: string,
    projectId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<{
    id: string;
    content: string;
  }>;

  searchProjectSources?(
    projectId: string,
    query: string,
  ): Promise<
    Array<{
      id: string;
      title: string;
      url?: string;
      snippet?: string;
    }>
  >;
}

export const RESEARCH_SERVICE_TOKEN = Symbol("RESEARCH_SERVICE");
