/**
 * Unified Team Topology Constants
 *
 * Single source of truth for colors, sizes, and styles
 * used across all team topology panels.
 */

/** Node fill color by colorKey (Tailwind class) */
export const TEAM_NODE_FILL_COLORS: Record<string, string> = {
  purple: 'fill-purple-500',
  blue: 'fill-blue-500',
  green: 'fill-green-500',
  amber: 'fill-amber-500',
  orange: 'fill-orange-500',
  red: 'fill-red-500',
  rose: 'fill-rose-500',
  indigo: 'fill-indigo-500',
  emerald: 'fill-emerald-500',
  pink: 'fill-pink-500',
  yellow: 'fill-yellow-500',
  gray: 'fill-gray-400',
};

/** Background color for detail card icon circle */
export const TEAM_DETAIL_BG_COLORS: Record<string, string> = {
  purple: 'bg-purple-50',
  blue: 'bg-blue-50',
  green: 'bg-green-50',
  amber: 'bg-amber-50',
  orange: 'bg-orange-50',
  red: 'bg-red-50',
  rose: 'bg-rose-50',
  indigo: 'bg-indigo-50',
  emerald: 'bg-emerald-50',
  pink: 'bg-pink-50',
  yellow: 'bg-yellow-50',
  gray: 'bg-gray-50',
};

/** Status-based fill color overrides */
export const TEAM_STATUS_FILL: Record<string, string> = {
  working: 'fill-blue-500',
  completed: 'fill-green-500',
  error: 'fill-red-500',
  failed: 'fill-red-500',
};

/** Node radius */
export const NODE_RADIUS = {
  leader: 18,
  member: 15,
} as const;

/** Default SVG viewBox */
export const DEFAULT_VIEWBOX = {
  width: 320,
  height: 200,
} as const;

/** Default row Y positions */
export const DEFAULT_ROW_Y = [40, 100, 160] as const;

/** Avatar sizes (height in SVG units) */
export const AVATAR_SIZE = {
  leader: 50,
  member: 42,
} as const;

/** Row Y positions for avatar mode (taller canvas) */
export const AVATAR_ROW_Y = [55, 145, 235] as const;

/** Text color by colorKey (for currentColor-driven avatars) */
export const TEAM_NODE_TEXT_COLORS: Record<string, string> = {
  purple: 'text-purple-500',
  blue: 'text-blue-500',
  green: 'text-green-500',
  amber: 'text-amber-500',
  orange: 'text-orange-500',
  red: 'text-red-500',
  rose: 'text-rose-500',
  indigo: 'text-indigo-500',
  emerald: 'text-emerald-500',
  pink: 'text-pink-500',
  yellow: 'text-yellow-500',
  gray: 'text-gray-400',
};

/** Status-based text color overrides (for avatar mode) */
export const TEAM_STATUS_TEXT: Record<string, string> = {
  working: 'text-blue-500',
  completed: 'text-green-500',
  error: 'text-red-500',
  failed: 'text-red-500',
};

/** Default legend items */
export const DEFAULT_LEGEND_ITEMS = [
  { color: 'bg-purple-500', label: 'Leader', animated: false },
  { color: 'bg-blue-500', label: 'Working', animated: true },
  { color: 'bg-green-500', label: 'Completed', animated: false },
  { color: 'bg-gray-400', label: 'Idle', animated: false },
] as const;
