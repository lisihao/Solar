/**
 * AI Image Service Types and Interfaces
 */

// Processing step types
export interface ProcessingStep {
  step: string;
  status: "pending" | "processing" | "completed" | "error";
  title: string;
  content?: string;
  timestamp?: string;
}

export interface PromptDesignJournalEntry {
  title: string;
  narrative: string;
}

export interface PromptMetric {
  label: string;
  value: string;
  comparison?: string;
}

export interface PromptVisualCue {
  type?: string;
  description?: string;
}

export interface PromptSection {
  title?: string;
  summary?: string;
  bullets: string[];
  metrics: PromptMetric[];
  visual?: PromptVisualCue;
  iconType?: string;
  sectionType?: "main" | "summary";
}

export interface PromptInformationArchitecture {
  title?: string;
  subtitle?: string;
  heroStatement?: string;
  centerVisualTitle?: string;
  centerVisualItems?: string[];
  sections: PromptSection[];
  callToAction?: string;
}

export interface PromptVisualLanguage {
  colorPalette: string[];
  primaryColor?: string;
  accentColor?: string;
  backgroundColor?: string;
  textColor?: string;
  typography?: string;
  iconography?: string;
  templateLayout?: string;
  chartStyle?: string;
  background?: string;
  gridSystem?: string;
  designStyle?: string;
  fontStyle?: string;
  borderRadius?: string;
  shadowStyle?: string;
}

// Rendering mode types
export type RenderingMode = "html_render" | "hybrid" | "ai_image";

// Content analysis result
export interface ContentAnalysis {
  type: "data_heavy" | "balanced" | "visual_concept";
  language: "zh" | "en" | "mixed";
  complexity: "high" | "medium" | "low";
  reasoning: string;
}

// Template layout types
export type TemplateLayoutType =
  | "cards"
  | "center_visual"
  | "timeline"
  | "comparison"
  | "pyramid"
  | "radial"
  | "statistics"
  | "checklist"
  | "funnel"
  | "matrix"
  | "ranking";

export interface PromptEngineeringInsights {
  imagePrompt: string;
  fallbackPrompt?: string;
  backgroundPrompt?: string;
  renderingMode: RenderingMode;
  templateLayout: TemplateLayoutType;
  contentAnalysis?: ContentAnalysis;
  designJournal: PromptDesignJournalEntry[];
  informationArchitecture: PromptInformationArchitecture;
  visualLanguage: PromptVisualLanguage;
  layoutPlan: string[];
  qualityChecks: string[];
  negativeKeywords: string[];
  styleShiftReasoning: string[];
  inspiration: string[];
}

export interface GeneratedImageResult {
  id: string;
  imageUrl: string;
  prompt: string;
  enhancedPrompt?: string;
  promptInsights?: PromptEngineeringInsights;
  negativePrompt?: string;
  width: number;
  height: number;
  createdAt: string;
  processingSteps?: ProcessingStep[];
  extractedContent?: string;
  textModelUsed?: string;
  imageModelUsed?: string;
  isBookmarked?: boolean;
  error?: string;
}

export interface GenerateImageOptions {
  prompt?: string;
  urls?: string[];
  content?: string;
  imageBase64?: string;
  files?: Array<{ buffer: Buffer; mimeType: string; filename: string }>;
  textModelId?: string;
  imageModelId?: string;
  style?: string;
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3";
  negativePrompt?: string;
  skipEnhancement?: boolean;
  templateLayout?: TemplateLayoutType;
  userId?: string;
}

// Default insights factory
export function createDefaultInsights(
  basePrompt: string,
): PromptEngineeringInsights {
  return {
    imagePrompt: (basePrompt || "").trim(),
    fallbackPrompt: undefined,
    backgroundPrompt: undefined,
    renderingMode: "hybrid",
    templateLayout: "cards",
    contentAnalysis: undefined,
    designJournal: [],
    informationArchitecture: {
      title: "",
      subtitle: "",
      heroStatement: "",
      sections: [],
      callToAction: "",
    },
    visualLanguage: {
      colorPalette: ["#1e3a5f", "#0891b2", "#f8fafc", "#334155"],
      primaryColor: "#1e3a5f",
      accentColor: "#0891b2",
      backgroundColor: "#f7f9fc",
      textColor: "#1a202c",
      typography: "Modern sans-serif",
      iconography: "Minimal line icons",
      chartStyle: "Clean bar/pie charts",
      background: "Subtle gradient",
      gridSystem: "12-column responsive",
    },
    layoutPlan: [],
    qualityChecks: [],
    negativeKeywords: [],
    styleShiftReasoning: [],
    inspiration: [],
  };
}
