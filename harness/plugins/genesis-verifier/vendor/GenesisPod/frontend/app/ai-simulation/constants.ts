import { ScenarioTemplate, ScenarioParams } from './types';

export const SCENARIO_TEMPLATES: ScenarioTemplate[] = [
  {
    name: 'AI算力基础设施',
    industry: 'AI Compute Infrastructure',
    region: 'Global',
    goals: {
      targetShare: '守住份额并提升交付速度',
      risk: '控制合规与供应链黑天鹅',
      growth: '拉高算力利用率与现金流效率',
    },
    constraints: {
      blindMove: true,
      cot: true,
      chaosProb: 0.3,
      irrationalProb: 0.2,
      humanBreakEvery: 2,
    },
    companies: [
      { name: 'Benchmark Cloud GPU', type: 'benchmark', market: 'Global' },
      { name: 'Startup AI Infra', type: 'startup', market: 'US' },
    ],
    agents: [
      {
        role: 'CEO - 蓝军',
        team: 'BLUE',
        companyName: 'Benchmark Cloud GPU',
      },
      { role: 'CEO - 红军', team: 'RED', companyName: 'Startup AI Infra' },
      { role: '监管官员', team: 'WHITE' },
    ],
    description:
      'GPU/芯片/云算力供需、价格战、合规/出口管制与舆情对抗场景，默认盲注+Chaos+人类介入。',
    badge: '模板',
  },
];

export const DEFAULT_SCENARIO_PARAMS: ScenarioParams = {
  blindMove: true,
  cot: true,
  chaosProb: 0.3,
  irrationalProb: 0.2,
  humanBreakEvery: 2,
};

export const TEAM_COLORS: Record<string, string> = {
  BLUE: 'bg-blue-100 text-blue-700 border-blue-200',
  RED: 'bg-red-100 text-red-700 border-red-200',
  GREEN: 'bg-green-100 text-green-700 border-green-200',
  WHITE: 'bg-gray-100 text-gray-700 border-gray-200',
  CHAOS: 'bg-purple-100 text-purple-700 border-purple-200',
};
