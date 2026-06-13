/**
 * Shared types for dependency diagram configs.
 *
 * Each AI App module can define a DiagramConfig describing its
 * relationship to AI Engine, AI Kernel, and AI Infrastructure.
 * The renderer (`DependencyDiagramRenderer`) consumes these configs
 * to produce a uniform architecture dependency view.
 */

/** A sub-directory or internal unit within a module */
export interface InternalItem {
  name: string;
  detail: string;
}

/** A single exported symbol shown in a Facade bar */
export interface FacadeExport {
  label: string;
  kind: 'service' | 'registry' | 'type' | 'util' | 'muted';
}

/** Facade bar shown at the bottom of a layer module */
export interface FacadeBar {
  title: string;
  exports: FacadeExport[];
}

/** One layer (module box) in the vertical diagram */
export interface LayerData {
  /** Architecture level (4 = App, 3 = Engine, 2 = Kernel, 1 = Infra) */
  level: number;
  /** Short tag shown in the badge, e.g. "TI", "AE" */
  tag: string;
  /** Display name */
  name: string;
  /** Filesystem path */
  path: string;
  /** Summary stats string */
  stats: string;
  /** Internal sub-directories / units */
  items: InternalItem[];
  /** onModuleInit registrations (App layer only) */
  registrations?: string[];
  /** Facade boundary */
  facade?: FacadeBar;
  /** Footer note */
  footer?: string;
}

/** A single arrow segment between two layers */
export interface ArrowSegment {
  /** Facade path, e.g. "ai-engine/facade" */
  label: string;
  /** Import count, e.g. "112+" */
  count: string;
  /** Color key: blue | teal | purple | amber */
  color: string;
}

/** Arrow connector between two adjacent layers */
export interface ArrowData {
  segments: ArrowSegment[];
}

/** One row in the dependency summary card */
export interface DepRow {
  label: string;
  count: string;
  level: 'high' | 'mid' | 'low';
}

/** A dependency summary card (e.g. "TI -> Engine") */
export interface DepCardData {
  from: string;
  fromColor: string;
  to: string;
  toColor: string;
  rows: DepRow[];
  total: string;
  note?: string;
}

/** Legend item */
export interface LegendItem {
  label: string;
  /** Tailwind bg class, e.g. "bg-blue-400" */
  color: string;
  /** If true, render as dashed border instead of solid fill */
  dashed?: boolean;
}

/** Complete diagram configuration for one AI App module */
export interface DiagramConfig {
  /** URL slug, e.g. "topic-insights" */
  slug: string;
  /** i18n key for diagram title */
  titleKey: string;
  /** i18n key for diagram subtitle */
  subtitleKey: string;
  /** Layer modules top-to-bottom */
  layers: LayerData[];
  /** Arrow connectors (length = layers.length - 1) */
  arrows: ArrowData[];
  /** Dependency summary cards */
  depCards: DepCardData[];
  /** Footer note (key invariant) */
  footerNote: string;
  /** Legend items */
  legend: LegendItem[];
}
