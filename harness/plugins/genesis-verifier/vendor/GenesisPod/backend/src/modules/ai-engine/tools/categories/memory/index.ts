/**
 * Memory Tools Exports
 * 记忆工具导出
 */

// ============================================================================
// Tool Classes
// ============================================================================
// ShortTermMemoryTool / LongTermMemoryTool 已迁到 ai-harness/memory/tools/
// （2026-04-30: 它们注入 ai-harness 的 Short/LongTermMemoryService，按 ESLint
// 单向依赖规则 ai-engine 不能 import ai-harness，所以包裹这两个 service 的
// tool 必须住在 harness 侧）
export { EntityMemoryTool } from "./entity-memory.tool";
export { KnowledgeBaseTool } from "./knowledge-base.tool";
export { UserPreferencesTool } from "./user-preferences.tool";

// ============================================================================
// Types - Entity Memory
// ============================================================================
export type {
  EntityType,
  RelationType,
  Entity,
  EntityRelation,
  EntityOperation,
  EntityMemoryInput,
  EntityMemoryOutput,
} from "./entity-memory.tool";

// ============================================================================
// Types - Knowledge Base
// ============================================================================
export type {
  KnowledgeEntry,
  KnowledgeOperation,
  KnowledgeBaseInput,
  KnowledgeBaseOutput,
} from "./knowledge-base.tool";

// ============================================================================
// Types - User Preferences
// ============================================================================
export type {
  PreferenceOperation,
  UserPreferencesInput,
  UserPreferencesOutput,
} from "./user-preferences.tool";
