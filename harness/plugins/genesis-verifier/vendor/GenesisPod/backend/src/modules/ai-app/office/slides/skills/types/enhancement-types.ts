/**
 * Slides Enhancement Skills - Shared Type Definitions
 *
 * Input/Output interfaces for 6 enhancement skills:
 * - DesignTokenInjector (P0)
 * - SmartContentExtractor (P0)
 * - SlideVisualValidator (P1)
 * - SlideIterativeRefiner (P1)
 * - DeckConsistencyAuditor (P2)
 * - SlideSelfHealer (P2)
 */

import { PageOutline } from "../../checkpoint/checkpoint.types";

// ============================================================================
// Design Token Injector (P0)
// ============================================================================

/**
 * Compact design tokens flattened from ThemeConfig
 * (~50 lines JSON instead of full ThemeConfig)
 */
export interface CompactDesignTokens {
  themeId: string;
  themeName: string;
  background: {
    primary: string;
    secondary: string;
    gradient: string;
  };
  accent: {
    primary: string;
    secondary: string;
    tertiary?: string;
  };
  text: {
    primary: string;
    secondary: string;
    muted: string;
  };
  card: {
    background: string;
    border: string;
  };
  effects: {
    borderRadius: string;
    cardShadow: string;
  };
  fontFamily: string;
}

export interface DesignTokenInjectorInput {
  themeId: string;
}

export interface DesignTokenInjectorOutput {
  tokens: CompactDesignTokens;
  /** Prompt fragment to replace the hardcoded "Adaptive Color System" section */
  promptFragment: string;
}

// ============================================================================
// Smart Content Extractor (P0)
// ============================================================================

export interface ExtractedDataPoint {
  type: "number" | "percentage" | "trend" | "comparison";
  value: string;
  context: string;
}

export interface SmartContentExtractorInput {
  pageOutline: PageOutline;
  sourceText: string;
}

export interface SmartContentExtractorOutput {
  /** Top relevant paragraphs (5-8) */
  relevantParagraphs: string[];
  /** Extracted data points */
  dataPoints: ExtractedDataPoint[];
  /** Extracted quotes */
  quotes: string[];
  /** Prompt fragment replacing raw sourceText.substring(0, 3000) */
  promptFragment: string;
}

// ============================================================================
// Slide Visual Validator (P1)
// ============================================================================

export type ValidationIssueType =
  | "overflow"
  | "blank_area"
  | "text_density"
  | "image_broken"
  | "color_mismatch";

export interface ValidationIssue {
  type: ValidationIssueType;
  severity: "error" | "warning";
  message: string;
  details?: Record<string, unknown>;
}

export interface SlideVisualValidatorInput {
  html: string;
  themeId?: string;
}

export interface SlideVisualValidatorOutput {
  passed: boolean;
  score: number;
  issues: ValidationIssue[];
  metrics: {
    hasOverflow: boolean;
    blankRatio: number;
    textDensity: number;
    imageCount: number;
    brokenImages: number;
    accentColors: string[];
  };
}

// ============================================================================
// Slide Iterative Refiner (P1)
// ============================================================================

export interface SlideIterativeRefinerInput {
  html: string;
  validationReport: SlideVisualValidatorOutput;
  pageOutline: PageOutline;
  themeId?: string;
  slideIndex: number;
  totalSlides: number;
  maxIterations?: number;
}

export interface SlideIterativeRefinerOutput {
  html: string;
  improved: boolean;
  finalScore: number;
  iterations: number;
  fixes: string[];
}

// ============================================================================
// Deck Consistency Auditor (P2)
// ============================================================================

export interface DeckPageInput {
  html: string;
  pageNumber: number;
  templateType: string;
  title: string;
}

export interface ConsistencyIssue {
  type: "color_drift" | "font_drift" | "layout_repetition" | "narrative_flow";
  severity: "error" | "warning" | "info";
  message: string;
  pages: number[];
  suggestion?: string;
}

export interface FixSuggestion {
  pageNumber: number;
  type: string;
  description: string;
  cssProperty?: string;
  expectedValue?: string;
  actualValue?: string;
}

export interface DeckConsistencyInput {
  pages: DeckPageInput[];
  themeId?: string;
}

export interface DeckConsistencyOutput {
  passed: boolean;
  overallScore: number;
  scores: {
    colorConsistency: number;
    fontConsistency: number;
    layoutDiversity: number;
    narrativeFlow: number;
  };
  issues: ConsistencyIssue[];
  fixSuggestions: FixSuggestion[];
}

// ============================================================================
// Slide Self-Healer (P2)
// ============================================================================

export type HealErrorType =
  | "EMPTY_CONTENT"
  | "TIMEOUT"
  | "AI_REFUSAL"
  | "HTML_MALFORMED"
  | "OVERFLOW"
  | "IMAGE_BROKEN";

export type HealStrategy =
  | "wrap_partial"
  | "trim_overflow"
  | "minimal_template"
  | "replace_images"
  | "simplified_retry"
  | "fallback_template";

export interface SlideSelfHealerInput {
  failedHtml: string;
  error: string;
  pageOutline: PageOutline;
  themeId?: string;
  slideIndex: number;
  totalSlides: number;
}

export interface SlideSelfHealerOutput {
  html: string;
  healed: boolean;
  errorType: HealErrorType;
  strategy: HealStrategy;
  confidence: number;
}
