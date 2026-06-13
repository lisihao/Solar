/**
 * Dependency Diagram Registry
 *
 * Central registry mapping URL slugs to diagram configs.
 * To add a new AI App diagram:
 *   1. Create a config file (e.g. `research.ts`) exporting a `DiagramConfig`
 *   2. Import and register it in `DIAGRAM_REGISTRY` below
 *   3. Set the corresponding card's `href` in `architecture.ts` to
 *      `/admin/overview/dependencies/<slug>`
 */

export type { DiagramConfig } from './types';
export type {
  LayerData,
  ArrowData,
  DepCardData,
  LegendItem,
  FacadeExport,
  InternalItem,
  ArrowSegment,
  DepRow,
  FacadeBar,
} from './types';

import type { DiagramConfig } from './types';
import { topicInsightsDiagram } from './topic-insights';

/** slug -> DiagramConfig */
export const DIAGRAM_REGISTRY: Record<string, DiagramConfig> = {
  [topicInsightsDiagram.slug]: topicInsightsDiagram,
};

/** All registered diagrams as an array (for listing) */
export const ALL_DIAGRAMS: DiagramConfig[] = Object.values(DIAGRAM_REGISTRY);

/** Lookup a diagram by slug, returns undefined if not found */
export function getDiagramBySlug(slug: string): DiagramConfig | undefined {
  return DIAGRAM_REGISTRY[slug];
}
