/**
 * Execution Tools
 * 代码执行工具集 - 安全执行各种代码和识别任务
 *
 * ============================================================================
 * SECURITY NOTE
 * ============================================================================
 * The following tools have been DISABLED and moved to ../deprecated/:
 * - PythonExecutorTool    (RCE risk - arbitrary Python execution)
 * - JavaScriptExecutorTool (RCE risk - arbitrary JS execution)
 * - ShellExecutorTool      (RCE risk - arbitrary shell commands)
 *
 * If you need code execution capabilities, use ContainerExecutorTool
 * which provides proper isolation via Docker containers.
 *
 * See: https://owasp.org/www-community/attacks/Command_Injection
 * ============================================================================
 */

// ============================================================================
// Tool Classes (Active)
// ============================================================================
export { SQLExecutorTool } from "./sql-executor.tool";
export { ContainerExecutorTool } from "./container-executor.tool";
export { OCRRecognitionTool } from "./ocr-recognition.tool";

// ============================================================================
// Types - SQL Executor
// ============================================================================
export type { SQLExecutorInput, SQLExecutorOutput } from "./sql-executor.tool";

// ============================================================================
// Types - Container Executor
// ============================================================================
export type {
  SupportedLanguage,
  LanguageRuntime,
  ResourceUsage,
  ContainerExecutorInput,
  ContainerExecutorOutput,
} from "./container-executor.tool";

// ============================================================================
// Types - OCR Recognition
// ============================================================================
export type {
  OCRRecognitionInput,
  OCRRecognitionOutput,
} from "./ocr-recognition.tool";
