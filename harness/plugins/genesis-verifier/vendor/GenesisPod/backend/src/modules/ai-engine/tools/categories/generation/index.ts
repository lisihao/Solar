/**
 * Generation Tools
 * 内容生成工具集合
 */

// ============================================================================
// Tool Classes
// ============================================================================
export { AudioGenerationTool } from "./audio-generation.tool";
export { StructuredOutputTool } from "./structured-output.tool";
export { VideoGenerationTool } from "./video-generation.tool";
export { TextGenerationTool } from "./text-generation.tool";
export { ImageGenerationTool } from "./image-generation.tool";
export { CodeGenerationTool } from "./code-generation.tool";

// ============================================================================
// Types - Audio Generation
// ============================================================================
export type {
  AudioGenerationInput,
  AudioGenerationOutput,
} from "./audio-generation.tool";

// ============================================================================
// Types - Structured Output
// ============================================================================
export type {
  StructuredOutputInput,
  StructuredOutputOutput,
} from "./structured-output.tool";

// ============================================================================
// Types - Video Generation
// ============================================================================
export type {
  VideoSourceType,
  VideoResolution,
  VideoStyle,
  VideoEditOperation,
  VideoGenerationInput,
  VideoGenerationOutput,
} from "./video-generation.tool";

// ============================================================================
// Types - Text Generation
// ============================================================================
export type {
  TextGenerationInput,
  TextGenerationOutput,
} from "./text-generation.tool";

// ============================================================================
// Types - Image Generation
// ============================================================================
export type {
  ImageGenerationInput,
  ImageGenerationOutput,
} from "./image-generation.tool";

// ============================================================================
// Types - Code Generation
// ============================================================================
export type {
  CodeGenerationInput,
  CodeGenerationOutput,
} from "./code-generation.tool";
