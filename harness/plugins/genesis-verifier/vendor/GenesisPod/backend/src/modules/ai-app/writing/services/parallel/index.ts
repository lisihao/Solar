/**
 * Parallel Writing Services - 并行写作服务
 *
 * 提供章节并行写作、依赖分析、冲突检测等功能
 */

export { ParallelOrchestratorService } from "./parallel-orchestrator.service";
export { ChapterDependencyService } from "./chapter-dependency.service";
export { WriterPoolService } from "./writer-pool.service";
export { ParallelConflictDetectorService } from "./parallel-conflict-detector.service";
export { EnhancedDependencyService } from "./enhanced-dependency.service";

// Export types
export type {
  ChapterNode,
  CircularDependency,
  ExecutionRound,
  ExecutionPlan,
  DependencyValidationResult,
} from "./enhanced-dependency.service";
