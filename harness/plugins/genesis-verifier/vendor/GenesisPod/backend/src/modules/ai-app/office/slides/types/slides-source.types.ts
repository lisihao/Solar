/**
 * AI Slides V5.0 - Data Source Types
 *
 * Unified data structure for importing content from various sources:
 * - AI Research reports
 * - AI Writing drafts
 * - AI Teams debates
 * - Library resources
 * - Direct text input
 */

// ============================================
// Source Type Enum
// ============================================

export type SlidesSourceType =
  | "research" // AI Research reports
  | "writing" // AI Writing drafts
  | "teams" // AI Teams debates
  | "library" // Library resources
  | "text"; // Direct text input

// ============================================
// Unified Source Data Structure
// ============================================

/**
 * Unified data structure for all imported sources
 * This is the canonical format that all import methods should return
 */
export interface SlidesSourceData {
  // Core content
  sourceText: string;
  sourceType: SlidesSourceType;
  sourceId?: string;

  // Structured content
  sections?: SourceSection[];
  outline?: OutlineNode[];

  // Data assets
  charts?: SourceChartData[];
  images?: Asset[];
  tables?: TableData[];

  // Insights (from Research/Teams)
  keyFindings?: string[];
  consensus?: string; // From Teams debates
  controversies?: string[]; // From Teams debates
  references?: Reference[];

  // Metadata
  metadata?: SourceMetadata;
}

// ============================================
// Source Section
// ============================================

/**
 * Represents a section from the source content
 * Used to preserve structure from Research reports, Writing chapters, Teams outputs
 */
export interface SourceSection {
  /** Section title */
  title: string;
  /** Section content (may be HTML or plain text) */
  content: string;
  /** Order index for sorting */
  order: number;
  /** Agent perspective (for Teams debates) */
  perspective?: string;
  /** Additional structured data */
  data?: Record<string, unknown>;
  /** Sub-sections for hierarchical content */
  subSections?: SourceSection[];
}

// ============================================
// Outline Node
// ============================================

/**
 * Hierarchical outline structure
 * Used for Writing drafts that have explicit outlines
 */
export interface OutlineNode {
  id: string;
  title: string;
  level: number; // 1 = top level, 2 = sub, etc.
  children?: OutlineNode[];
  content?: string;
}

// ============================================
// Chart Data
// ============================================

export type ChartType =
  | "line"
  | "bar"
  | "pie"
  | "donut"
  | "radar"
  | "treemap"
  | "funnel"
  | "area"
  | "scatter";

/**
 * Chart data extracted from source
 * Note: Named SourceChartData to avoid conflict with ChartData in chart-renderer.skill.ts
 */
export interface SourceChartData {
  /** Chart type */
  type: ChartType;
  /** Chart title */
  title: string;
  /** Raw data for the chart */
  data: ChartDataSet;
  /** Data source reference */
  source?: string;
  /** Additional chart configuration */
  config?: ChartConfig;
}

export interface ChartDataSet {
  /** Labels for x-axis or categories */
  labels: string[];
  /** Data series */
  series: ChartSeries[];
}

export interface ChartSeries {
  name: string;
  values: number[];
  color?: string;
}

export interface ChartConfig {
  showLegend?: boolean;
  showGrid?: boolean;
  showLabels?: boolean;
  stacked?: boolean;
  orientation?: "horizontal" | "vertical";
}

// ============================================
// Asset (Images, Documents, Videos)
// ============================================

export type AssetType = "image" | "document" | "video" | "audio";

/**
 * Generic asset from Library or other sources
 */
export interface Asset {
  id: string;
  type: AssetType;
  url: string;
  title?: string;
  description?: string;
  thumbnailUrl?: string;
  /** File size in bytes */
  size?: number;
  /** MIME type */
  mimeType?: string;
  /** Image dimensions */
  dimensions?: {
    width: number;
    height: number;
  };
  /** Asset metadata */
  metadata?: Record<string, unknown>;
}

// ============================================
// Table Data
// ============================================

/**
 * Table data extracted from source
 */
export interface TableData {
  title?: string;
  headers: string[];
  rows: TableRow[];
  source?: string;
}

export interface TableRow {
  cells: TableCell[];
}

export interface TableCell {
  value: string;
  type?: "text" | "number" | "percentage" | "currency" | "date";
  highlight?: boolean;
}

// ============================================
// Reference
// ============================================

/**
 * Reference/citation from Research reports
 */
export interface Reference {
  id: string;
  title: string;
  url?: string;
  source?: string;
  author?: string;
  date?: string;
  excerpt?: string;
}

// ============================================
// Source Metadata
// ============================================

/**
 * Metadata about the source
 */
export interface SourceMetadata {
  title?: string;
  description?: string;
  createdAt?: Date;
  updatedAt?: Date;

  // Research-specific
  model?: string;
  targetAudience?: string;

  // Writing-specific
  genre?: string;
  style?: string;
  wordCount?: number;

  // Teams-specific
  topic?: string;
  agents?: string[];
  duration?: number; // in minutes
  rounds?: number;

  // Generic
  tags?: string[];
  language?: string;
  [key: string]: unknown;
}

// ============================================
// Import Request/Response Types
// ============================================

/**
 * Request to import from a specific source
 */
export interface ImportRequest {
  sourceType: SlidesSourceType;
  sourceId?: string;
  resourceIds?: string[]; // For library imports
  text?: string; // For direct text input
}

/**
 * Response from import operation
 */
export interface ImportResponse {
  success: boolean;
  data?: SlidesSourceData;
  error?: {
    code: string;
    message: string;
  };
}

// ============================================
// Source List Item (for UI selection)
// ============================================

/**
 * Simplified source item for list display
 */
export interface SourceListItem {
  id: string;
  title: string;
  type: SlidesSourceType;
  preview?: string;
  thumbnailUrl?: string;
  createdAt: Date;
  metadata?: {
    pageCount?: number;
    wordCount?: number;
    imageCount?: number;
  };
}
