import {
  Layers,
  Target,
  Compass,
  Palette,
  FileCode,
  Image,
  Lightbulb,
  CheckSquare,
} from 'lucide-react';

/**
 * Skill Layer Types
 */
export type SkillLayer =
  | 'all'
  | 'understanding'
  | 'planning'
  | 'design'
  | 'content'
  | 'rendering'
  | 'optimization'
  | 'quality';

/**
 * Layer Definitions
 */
export const SKILL_LAYERS: {
  id: SkillLayer;
  labelKey: string;
  icon: typeof Layers;
  color: string;
  badge: string;
}[] = [
  {
    id: 'all',
    labelKey: 'admin.skills.layers.all',
    icon: Layers,
    color: 'bg-gray-100',
    badge: 'bg-gray-100 text-gray-700',
  },
  {
    id: 'understanding',
    labelKey: 'admin.skills.layers.understanding',
    icon: Compass,
    color: 'bg-blue-100',
    badge: 'bg-blue-100 text-blue-700',
  },
  {
    id: 'planning',
    labelKey: 'admin.skills.layers.planning',
    icon: Target,
    color: 'bg-green-100',
    badge: 'bg-green-100 text-green-700',
  },
  {
    id: 'design',
    labelKey: 'admin.skills.layers.design',
    icon: Palette,
    color: 'bg-purple-100',
    badge: 'bg-purple-100 text-purple-700',
  },
  {
    id: 'content',
    labelKey: 'admin.skills.layers.content',
    icon: FileCode,
    color: 'bg-orange-100',
    badge: 'bg-orange-100 text-orange-700',
  },
  {
    id: 'rendering',
    labelKey: 'admin.skills.layers.rendering',
    icon: Image,
    color: 'bg-pink-100',
    badge: 'bg-pink-100 text-pink-700',
  },
  {
    id: 'optimization',
    labelKey: 'admin.skills.layers.optimization',
    icon: Lightbulb,
    color: 'bg-indigo-100',
    badge: 'bg-indigo-100 text-indigo-700',
  },
  {
    id: 'quality',
    labelKey: 'admin.skills.layers.quality',
    icon: CheckSquare,
    color: 'bg-cyan-100',
    badge: 'bg-cyan-100 text-cyan-700',
  },
];
