/**
 * AI Image Infographic Templates
 */

// Services
export { InfographicTemplateService as InfographicService } from "./infographic.service";

// Types & Constants - Selective exports to avoid conflicts with core
export type {
  InfographicStyle,
  InfographicContent,
  InfographicSection,
  InfographicStyleOptions,
  StylePreset,
  TemplateLayout,
} from "./infographic.types";
export * from "./infographic.constants";
export * from "./infographic.utils";
export * from "./infographic.generator";

// Templates
export * from "./templates/template-base.helper";
