/**
 * Constraint Enforcement Types
 *
 * 2026-05-01 (PR-X-O): 从 interfaces.ts 拆出。
 */

import type { HardConstraint } from "../../../ai-engine/knowledge/world-building/world-building.types";

/** 约束类型 */
export type ConstraintSeverity = "MUST" | "SHOULD" | "MAY";

/** 提取的约束 */
export interface ExtractedConstraint {
  id: string;
  type: ConstraintSeverity;
  rule: string;
  source: string;
  confidence: number;
}

/** 约束违规 */
export interface ConstraintViolation {
  constraintId: string;
  rule: string;
  violatingText: string;
  position: number;
  severity: "critical" | "high" | "medium" | "low";
}

/** 输出校验结果 */
export interface OutputValidationResult {
  isValid: boolean;
  violations: ConstraintViolation[];
  checkedConstraints: number;
  passedConstraints: number;
}

/** 约束强制服务接口 */
export interface IConstraintEnforcementService {
  extractConstraints(description: string): ExtractedConstraint[];

  validateOutput(
    output: string,
    constraints: ExtractedConstraint[] | HardConstraint[],
  ): Promise<OutputValidationResult>;

  generateViolationReport(violations: ConstraintViolation[]): string;

  formatConstraintsForPrompt(
    constraints: ExtractedConstraint[] | HardConstraint[],
    type?: ConstraintSeverity,
  ): string;

  toHardConstraints(constraints: ExtractedConstraint[]): HardConstraint[];
}
