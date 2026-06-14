/**
 * Skills Management Components
 *
 * 3-tab architecture:
 * - Local Skills Table: table+drawer view of locally installed skills
 * - Skills Marketplace Tab: browse and install skills from SkillsMP
 * - Skills Dashboard: usage analytics / 技能统计
 */

export { LocalSkillsTable } from './LocalSkillsTable';
export { SkillsMarketplaceTab } from './SkillsMarketplaceTab';
export { EditSkillModal } from './EditSkillModal';
export { SkillVersionHistory } from './SkillVersionHistory';
export { SKILL_LAYERS } from './skill-layers';
export type { SkillLayer } from './skill-layers';
export type { SkillConfig, MarketplaceSkill, SkillVersion } from './types';
