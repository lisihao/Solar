import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Unified Team Topology Types
 *
 * Shared type definitions for the team-topology canvas used across
 * AI Insights, Planning, Research, Discussion, and Writing modules.
 */

/** Node status determines color and animation */
export type TeamNodeStatus =
  | 'idle'
  | 'working'
  | 'completed'
  | 'error'
  | 'failed';

/** A single agent node in the topology */
export interface TeamTopologyNode {
  /** Unique identifier */
  id: string;
  /** Display name (shown below node) */
  name: string;
  /** Role identifier */
  role: string;
  /** Emoji string OR Lucide icon component */
  icon: string | LucideIcon;
  /** Current status */
  status: TeamNodeStatus;
  /** Working status label (e.g. "researching", "reviewing") */
  statusLabel?: string;
  /** Tailwind color key: 'purple' | 'blue' | 'green' | 'amber' | 'orange' | 'red' | 'rose' | 'indigo' | 'emerald' | 'pink' | 'yellow' */
  colorKey: string;
  /** true → larger node radius (18 vs 15) */
  isLeader?: boolean;
  /** When set, renders a cartoon avatar instead of circle+icon. Value maps to ROLE_AVATAR_MAP key. */
  avatarRole?: string;
  /** Task progress badge (top-right corner) */
  taskProgress?: { completed: number; total: number };
}

/** Connection between two nodes */
export interface TeamTopologyConnection {
  from: string;
  to: string;
}

/** Legend item for the bottom legend bar */
export interface TeamTopologyLegendItem {
  /** Tailwind bg class (e.g. 'bg-purple-500') */
  color: string;
  /** Display label */
  label: string;
  /** Whether to animate (pulse) */
  animated?: boolean;
}

/** Props for TeamTopologyCanvas */
export interface TeamTopologyCanvasProps {
  /** All agent nodes */
  nodes: TeamTopologyNode[];
  /** Row layout: each row is a list of node IDs */
  rows: string[][];
  /** Connection lines between nodes */
  connections: TeamTopologyConnection[];
  /** SVG canvas height CSS class (default: 'h-[200px]') */
  heightClass?: string;
  /** SVG viewBox height (default: 200) */
  viewBoxHeight?: number;
  /** Y positions for each row (default: [40, 100, 160]) */
  rowYPositions?: number[];
  /** SVG pattern ID prefix to avoid conflicts (default: 'team') */
  patternId?: string;
  /** Legend items (bottom bar) */
  legendItems?: TeamTopologyLegendItem[];
  /** Render custom detail card when a node is selected */
  renderDetail?: (node: TeamTopologyNode, onClose: () => void) => ReactNode;
  /** Render custom tooltip content */
  renderTooltip?: (node: TeamTopologyNode) => ReactNode;
}
