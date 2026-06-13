/**
 * Context Services Exports
 *
 * PR-X25: Shim files removed. Re-export directly from canonical facades.
 *  - ConstraintEnforcementService (service) → ai-harness/facade
 *  - Constraint types + TokenBudget* → ai-harness/facade
 */
export { ConstraintEnforcementService } from "@/modules/ai-harness/facade";
export type {
  ConstraintSeverity,
  ExtractedConstraint,
  ConstraintViolation,
  OutputValidationResult,
} from "@/modules/ai-harness/facade";
export {
  TokenBudgetCalculatorService,
  type TokenBudgetModelConfig as ModelConfig,
  type TokenBudget,
  type ContentPriority,
  type BudgetAllocation,
} from "@/modules/ai-harness/facade";
