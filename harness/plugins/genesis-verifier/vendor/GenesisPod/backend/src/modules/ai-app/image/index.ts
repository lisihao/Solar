/**
 * AI Image Module - Barrel Exports
 */

// Core - Types, Constants, Utils
export * from "./core";

// Generation - Selective exports to avoid conflicts
export {
  GenerationController,
  GenerationService,
  ImageGenerationService,
  PromptEnhancementService,
} from "./generation";

// Storage
export * from "./storage";

// Export
export * from "./export";

// Brand Kit
export * from "./brand-kit";

// Infographic
export * from "./infographic";

// Analytics
export * from "./analytics";

// Module
export { AiImageModule } from "./ai-image.module";

// 向后兼容别名
export { GenerationService as AiImageService } from "./generation";
export { InfographicService as InfographicTemplateService } from "./infographic";
export { StorageService as ImageStorageService } from "./storage";
