/**
 * Static configuration for AI Planning team roles, skills, tools, and workflow.
 * Maps to backend planning-team.config.ts role definitions.
 */

export interface PlanningRole {
  key: string;
  nameKey: string;
  roleId: string;
  color: string;
  colorHex: string;
  gradient: string;
  descriptionKey: string;
  skills: string[];
  tools: string[];
}

/**
 * Planning team roles configuration.
 * nameKey and descriptionKey are i18n keys under aiPlanning.roles.*
 */
export const PLANNING_ROLES_CONFIG: PlanningRole[] = [
  {
    key: 'leader',
    nameKey: 'leader',
    roleId: 'research-lead',
    color: 'purple',
    colorHex: '#a855f7',
    gradient: 'from-purple-500 to-purple-600',
    descriptionKey: 'leaderDesc',
    skills: ['goal-analysis', 'synthesis'],
    tools: ['WEB_SEARCH', 'TEXT_GENERATION'],
  },
  {
    key: 'researcher',
    nameKey: 'researcher',
    roleId: 'researcher',
    color: 'blue',
    colorHex: '#3b82f6',
    gradient: 'from-blue-500 to-blue-600',
    descriptionKey: 'researcherDesc',
    skills: ['market-research'],
    tools: ['WEB_SEARCH', 'DATA_ANALYSIS'],
  },
  {
    key: 'analyst',
    nameKey: 'analyst',
    roleId: 'analyst',
    color: 'green',
    colorHex: '#22c55e',
    gradient: 'from-green-500 to-green-600',
    descriptionKey: 'analystDesc',
    skills: ['brainstorming', 'synthesis'],
    tools: ['DATA_ANALYSIS', 'STRUCTURED_OUTPUT'],
  },
  {
    key: 'copywriter',
    nameKey: 'copywriter',
    roleId: 'writer',
    color: 'orange',
    colorHex: '#f97316',
    gradient: 'from-orange-500 to-orange-600',
    descriptionKey: 'copywriterDesc',
    skills: ['document-writing'],
    tools: ['TEXT_GENERATION'],
  },
  {
    key: 'debaterPro',
    nameKey: 'debaterPro',
    roleId: 'advocate-pro',
    color: 'red',
    colorHex: '#ef4444',
    gradient: 'from-red-500 to-red-600',
    descriptionKey: 'debaterProDesc',
    skills: ['argument-construction', 'position-defense'],
    tools: ['TEXT_GENERATION'],
  },
  {
    key: 'debaterCon',
    nameKey: 'debaterCon',
    roleId: 'advocate-con',
    color: 'rose',
    colorHex: '#f43f5e',
    gradient: 'from-rose-500 to-rose-600',
    descriptionKey: 'debaterConDesc',
    skills: ['critical-thinking', 'risk-analysis'],
    tools: ['TEXT_GENERATION'],
  },
];

/** Workflow phases with responsible agent keys */
export const PLANNING_WORKFLOW_CONFIG = [
  { phase: 1, key: 'goalAnalysis', agentKeys: ['leader'], parallel: false },
  { phase: 2, key: 'research', agentKeys: ['researcher'], parallel: true },
  {
    phase: 3,
    key: 'brainstorm',
    agentKeys: ['researcher', 'analyst', 'copywriter'],
    parallel: false,
  },
  {
    phase: 4,
    key: 'debate',
    agentKeys: ['debaterPro', 'debaterCon'],
    parallel: false,
  },
  { phase: 5, key: 'synthesis', agentKeys: ['analyst'], parallel: false },
  { phase: 6, key: 'delivery', agentKeys: ['copywriter'], parallel: false },
];

/** Map agent key to PLANNING_ROLES_CONFIG index (and AI members array index) */
export const AGENT_KEY_TO_INDEX: Record<string, number> = {
  leader: 0,
  researcher: 1,
  analyst: 2,
  copywriter: 3,
  debaterPro: 4,
  debaterCon: 5,
};

/** Map phase number to active agent indices */
export function getActiveAgentIndicesForPhase(phase: number): number[] {
  const config = PLANNING_WORKFLOW_CONFIG.find((w) => w.phase === phase);
  if (!config) return [];
  return config.agentKeys
    .map((key) => AGENT_KEY_TO_INDEX[key])
    .filter((i) => i !== undefined);
}
