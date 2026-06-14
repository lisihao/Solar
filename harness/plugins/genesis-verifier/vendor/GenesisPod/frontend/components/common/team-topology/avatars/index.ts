import type { ComponentType } from 'react';
import type { TeamAvatarProps } from './types';
import { LeaderAvatar } from './leader-avatar';
import { ResearcherAvatar } from './researcher-avatar';
import { AnalystAvatar } from './analyst-avatar';
import { WriterAvatar } from './writer-avatar';
import { ReviewerAvatar } from './reviewer-avatar';
import { EditorAvatar } from './editor-avatar';
import { KeeperAvatar } from './keeper-avatar';
import { CheckerAvatar } from './checker-avatar';
import { DebaterProAvatar } from './debater-pro-avatar';
import { DebaterConAvatar } from './debater-con-avatar';

export { LeaderAvatar } from './leader-avatar';
export { ResearcherAvatar } from './researcher-avatar';
export { AnalystAvatar } from './analyst-avatar';
export { WriterAvatar } from './writer-avatar';
export { ReviewerAvatar } from './reviewer-avatar';
export { EditorAvatar } from './editor-avatar';
export { KeeperAvatar } from './keeper-avatar';
export { CheckerAvatar } from './checker-avatar';
export { DebaterProAvatar } from './debater-pro-avatar';
export { DebaterConAvatar } from './debater-con-avatar';

/**
 * Maps role strings to their cartoon avatar component.
 * Used by TeamTopologyCanvas to resolve `node.avatarRole` → component.
 */
export const ROLE_AVATAR_MAP: Record<string, ComponentType<TeamAvatarProps>> = {
  // Leader variants
  leader: LeaderAvatar,
  director: LeaderAvatar,
  architect: LeaderAvatar,

  // Researcher
  researcher: ResearcherAvatar,
  dimension_researcher: ResearcherAvatar,

  // Analyst
  analyst: AnalystAvatar,

  // Writer variants
  writer: WriterAvatar,
  copywriter: WriterAvatar,
  synthesizer: WriterAvatar,
  report_writer: WriterAvatar,
  'writer-1': WriterAvatar,
  'writer-2': WriterAvatar,
  'writer-3': WriterAvatar,

  // Reviewer
  reviewer: ReviewerAvatar,
  quality_reviewer: ReviewerAvatar,

  // Editor
  editor: EditorAvatar,

  // Keeper
  keeper: KeeperAvatar,

  // Checker
  'checker-1': CheckerAvatar,
  'checker-2': CheckerAvatar,

  // Debaters
  debaterPro: DebaterProAvatar,
  debaterCon: DebaterConAvatar,
};
