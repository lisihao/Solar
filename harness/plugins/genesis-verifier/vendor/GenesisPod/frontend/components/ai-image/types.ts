// Type definitions for AI Image Generator

export interface ProcessingStep {
  step: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
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
}

export interface PromptInformationArchitecture {
  title?: string;
  subtitle?: string;
  heroStatement?: string;
  sections: PromptSection[];
  callToAction?: string;
}

export interface PromptVisualLanguage {
  colorPalette: string[];
  typography?: string;
  iconography?: string;
  chartStyle?: string;
  background?: string;
  gridSystem?: string;
}

export interface PromptInsights {
  imagePrompt: string;
  fallbackPrompt?: string;
  designJournal: PromptDesignJournalEntry[];
  informationArchitecture: PromptInformationArchitecture;
  visualLanguage: PromptVisualLanguage;
  layoutPlan: string[];
  qualityChecks: string[];
  negativeKeywords: string[];
  styleShiftReasoning: string[];
  inspiration: string[];
}

export interface GeneratedImage {
  id: string;
  prompt: string;
  enhancedPrompt?: string;
  promptInsights?: PromptInsights;
  negativePrompt?: string;
  imageUrl: string;
  createdAt: string;
  width: number;
  height: number;
  isBookmarked?: boolean;
  processingSteps?: ProcessingStep[];
  extractedContent?: string;
  textModelUsed?: string;
  imageModelUsed?: string;
}

export interface AIModel {
  id: string;
  name: string;
  provider: string;
  modelId: string;
  icon?: string;
  isDefault: boolean;
  /** W4-byok: 后端 getEnabledModelsForFrontend 给用户配过 PERSONAL key 的模型标记 */
  isUserKey?: boolean;
}

export interface ModelsResponse {
  textModels: AIModel[];
  imageModels: AIModel[];
}

export interface UploadedFile {
  file: File;
  id: string;
  preview?: string;
}

export type InputMode = 'prompt' | 'youtube' | 'url' | 'files' | 'refine';
export type InsightsTab = 'insights' | 'steps';

export type TemplateLayout =
  | 'auto'
  | 'cards'
  | 'center_visual'
  | 'timeline'
  | 'comparison'
  | 'pyramid'
  | 'radial'
  | 'statistics'
  | 'checklist'
  | 'funnel'
  | 'matrix'
  | 'ranking';

export type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3';

export interface ImageGeneratorProps {
  initialImageId?: string;
}

export interface StreamingInsights {
  textModelUsed?: string;
  imageModelUsed?: string;
  renderingMode?: string;
}
