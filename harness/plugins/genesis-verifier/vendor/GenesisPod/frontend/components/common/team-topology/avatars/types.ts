import type { TeamNodeStatus } from '../types';

/** Props shared by all cartoon avatar components */
export interface TeamAvatarProps {
  /** Total height of the character (SVG units) */
  size: number;
  /** Drives animation: working = subtle bounce */
  status?: TeamNodeStatus;
  /** Leader avatars render slightly larger */
  isLeader?: boolean;
}
