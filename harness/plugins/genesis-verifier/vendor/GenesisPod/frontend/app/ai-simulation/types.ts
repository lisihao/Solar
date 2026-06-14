export interface ScenarioRun {
  id: string;
  status: string;
  currentRound?: number;
}

export interface ScenarioCard {
  id: string;
  name: string;
  industry: string;
  region?: string;
  companies?: ScenarioFormCompany[];
  agents?: ScenarioFormAgent[];
  runs?: ScenarioRun[];
  goals?: ScenarioGoals;
  params?: ScenarioParams;
  visibility?: 'PRIVATE' | 'SHARED' | 'PUBLIC';
  createdAt: string;
  updatedAt: string;
}

export interface ScenarioFormCompany {
  name: string;
  type: string;
  market: string;
  metrics?: CompanyMetrics | Partial<CompanyMetrics>;
}

export interface Persona {
  riskTolerance?: number;
  compliance?: number;
  traits?: string;
  biases?: string;
  pressure?: string;
  timePref?: string;
  [key: string]: unknown;
}

export interface ScenarioFormAgent {
  role: string;
  team: 'BLUE' | 'RED' | 'GREEN' | 'WHITE' | 'CHAOS';
  company?: { name: string };
  companyName?: string;
  persona?: Persona | string | object; // Can be JSON string, Persona object, or generic object from backend
  memoryPublic?: string | object;
  memoryPrivate?: string | object;
}

export interface ScenarioTemplate {
  name: string;
  industry: string;
  region?: string;
  goals?: ScenarioGoals;
  constraints?: ScenarioParams;
  companies?: ScenarioFormCompany[];
  agents?: ScenarioFormAgent[];
  description?: string;
  badge?: string;
}

export interface ScenarioGoals {
  targetShare?: string;
  risk?: string;
  growth?: string;
  custom?: string;
}

export interface ScenarioParams {
  blindMove: boolean;
  cot: boolean;
  chaosProb: number;
  irrationalProb: number;
  humanBreakEvery: number;
}

export interface ExternalSnapshot {
  snapshot: Record<string, unknown>;
  evidence: Array<{
    provider: string;
    ok: boolean;
    error?: string;
    endpoint?: string;
    timestamp: string;
  }>;
}

export interface CompanyMetrics {
  cash: number; // 现金
  share: number; // 市场份额 %
  priceBand: string; // 价格带
  capacity: number; // 产能
  inventory: number; // 库存
  delivery: string; // 交付周期
  arpu: number; // ARPU
  margin: number; // 毛利率 %
  debt: number; // 负债
  patents?: number; // 专利数
  channels?: string; // 渠道
  brand?: string; // 品牌影响力
}

export interface CompanyMoat {
  patents: number; // 专利数
  channels: string; // 渠道
  brand: string; // 品牌影响力
}

export interface CompanyFull extends ScenarioFormCompany {
  metrics: CompanyMetrics;
  moat: CompanyMoat;
  riskThresholds: {
    cashMin: number;
    debtMax: number;
    complianceLevel: string;
  };
  sentimentScore: number;
}

export type TabType = 'basic' | 'companies' | 'agents' | 'params';

// Agent interface for runtime use
export interface Agent {
  id: string;
  role: string;
  team?: 'BLUE' | 'RED' | 'GREEN' | 'WHITE' | 'CHAOS' | string;
  companyId?: string;
  company?: { name: string };
  companyName?: string;
  name?: string;
  persona?: Persona | string;
  memoryPublic?: string | object;
  memoryPrivate?: string | object;
}

// Company interface for runtime use
export interface Company {
  id: string;
  name: string;
  type?: 'benchmark' | 'challenger' | 'startup' | string;
  market?: string;
  metrics?: CompanyMetrics | Partial<CompanyMetrics>;
  description?: string;
}

// Adjudication interface for turn results
export interface Adjudication {
  ruling?: string;
  summary?: string;
  blackSwanEvent?: {
    event: string;
    team?: string;
    impact?: string;
  };
  marketUpdate?: Record<string, unknown>;
  [key: string]: unknown;
}

// Submission interface for agent submissions in a turn
export interface Submission {
  agentId?: string;
  agent?: {
    role?: string;
    team?: string;
    name?: string;
  };
  response?: string;
  decision?: string;
  reasoning?: string;
  metrics?: Record<string, unknown>;
  status?: string;
  timestamp?: string;
  [key: string]: unknown;
}

// Turn interface for simulation turns
export interface Turn {
  id: string;
  round: number;
  agentId: string;
  agent?: Agent;
  action?: unknown;
  result?: unknown;
  adjudication?: Adjudication;
  submissions?: Submission[];
  createdAt?: string;
  [key: string]: unknown;
}

// World state interface for simulation state
export interface WorldState {
  marketPrice?: number;
  shortage?: number;
  totalDemand?: number;
  totalSupply?: number;
  companies?: Record<string, Partial<CompanyMetrics>>;
  [key: string]: unknown;
}

// Run summary interface
export interface RunSummary {
  keyFindings?: string[];
  biasesDetected?: {
    type: string;
    description: string;
    recommendation?: string;
    severity?: string;
  }[];
  blindspots?: {
    type: string;
    description: string;
    recommendation?: string;
    severity?: string;
  }[];
  counterfactuals?: {
    scenario: string;
    outcome: string;
    likelihood?: string;
    impact?: string;
  }[];
  blackSwanEvents?: {
    event: string;
    impact: string;
    round?: number;
  }[];
  internalReport?: string;
  publicReport?: string;
  winningTeam?: string;
  finalMetrics?: Record<string, unknown>;
  [key: string]: unknown;
}

// Run interface for simulation runs
export interface Run {
  id: string;
  scenarioId?: string;
  status: 'PENDING' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | string;
  currentRound?: number;
  rounds?: number;
  params?: Record<string, unknown>;
  worldState?: WorldState;
  evidenceTrail?: unknown[];
  turns?: Turn[];
  createdAt?: string;
  updatedAt?: string;
  summary?: RunSummary;
  error?: string;
}
