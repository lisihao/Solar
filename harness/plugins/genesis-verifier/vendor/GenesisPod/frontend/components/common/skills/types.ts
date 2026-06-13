/**
 * Domain Skills Types
 * Per-AI-App skills visibility and effectiveness tracking
 */

export interface SkillEffectiveness {
  usageCount: number;
  successCount: number;
  successRate: number;
  avgDuration: number | null;
}

export interface DomainSkill {
  skillId: string;
  displayName: string;
  description: string;
  layer: string | null;
  domain: string | null;
  enabled: boolean;
  tags: string[];
  source: string;
  effectiveness: SkillEffectiveness;
}

export interface DomainSkillsResponse {
  skills: DomainSkill[];
  stats: {
    total: number;
    enabled: number;
    byLayer: Record<string, number>;
  };
}
