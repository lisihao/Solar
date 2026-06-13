/**
 * Skill Configuration Types
 */

export interface SkillConfig {
  id: string;
  skillId: string;
  name: string;
  displayName: string;
  description: string;
  layer: string;
  domain: string;
  enabled: boolean;
  tags: string[];
  requiredTools: string[];
  requiredSkills: string[];
  config?: Record<string, unknown>;
  // Enhanced manifest fields (optional)
  author?: string;
  version?: string;
  license?: string;
  triggers?: Array<{ type: string; condition: string; priority?: number }>;
  examples?: Array<{ title: string; input: string; output: string }>;
  permissions?: {
    network?: boolean;
    filesystem?: boolean;
    externalApis?: string[];
    dataScopes?: string[];
  };
  // Skills system upgrade fields
  promptContent?: string | null;
  frontmatter?: Record<string, unknown> | null;
  contentHash?: string | null;
  source?: string | null;
  lastUsedAt?: string | null;
  usageCount?: number;
  taskProfile?: {
    creativity?: string;
    outputLength?: string;
  };
}

export interface SkillVersion {
  id: string;
  skillId: string;
  version: string;
  promptContent: string;
  frontmatter: Record<string, unknown> | null;
  contentHash: string;
  changeNote: string | null;
  changedBy: string | null;
  createdAt: string;
}

export interface SkillContentResponse {
  id: string;
  skillId: string;
  displayName: string | null;
  description: string | null;
  enabled: boolean;
  layer: string | null;
  domain: string | null;
  tags: string[];
  version: string | null;
  source: string | null;
  promptContent: string | null;
  frontmatter: Record<string, unknown> | null;
  contentHash: string | null;
  filePath: string | null;
  taskProfileJson: Record<string, unknown> | null;
  inputSchemaJson: Record<string, unknown> | null;
  outputSchemaJson: Record<string, unknown> | null;
  lastUsedAt: string | null;
  usageCount: number;
  versions: SkillVersion[];
}

export interface MarketplaceSkill {
  id: string;
  name: string;
  displayName: string;
  description: string;
  author: string;
  authorUrl?: string;
  version: string;
  layer: string;
  domain: string;
  tags: string[];
  downloads: number;
  rating: number;
  ratingCount: number;
  createdAt: string;
  updatedAt: string;
  requiredTools: string[];
  requiredSkills: string[];
  installed?: boolean;
  installedVersion?: string;
}
