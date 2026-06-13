/**
 * AI Engine - Workflow Implementation
 * 工作流实现类
 */

import { RoleId } from "../abstractions/role.interface";
import {
  IWorkflow,
  IWorkflowStep,
  WorkflowType,
  WorkflowStepType,
  WorkflowConfig,
  WorkflowStepConfig,
  StepCondition,
  RetryConfig,
  ReviewConfig,
  LoopConfig,
  WorkflowValidationResult,
  WorkflowValidationError,
  WorkflowValidationWarning,
} from "../abstractions/workflow.interface";

/**
 * 工作流步骤实现类
 */
export class WorkflowStep implements IWorkflowStep {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly type: WorkflowStepType;
  readonly executorRoles: RoleId[];
  readonly parallel: boolean;
  readonly dependsOn: string[];
  readonly condition?: StepCondition;
  readonly timeout?: number;
  readonly retry?: RetryConfig;
  readonly reviewConfig?: ReviewConfig;
  readonly loopConfig?: LoopConfig;
  readonly metadata?: Record<string, unknown>;

  constructor(config: WorkflowStepConfig) {
    this.id = config.id;
    this.name = config.name;
    this.description = config.description || "";
    this.type = config.type;
    this.executorRoles = config.executorRoles;
    this.parallel = config.parallel || false;
    this.dependsOn = config.dependsOn || [];
    this.condition = config.condition;
    this.timeout = config.timeout;
    this.retry = config.retry;
    this.reviewConfig = config.reviewConfig;
    this.loopConfig = config.loopConfig;
    this.metadata = config.metadata;
  }

  /**
   * 转换为 JSON
   */
  toJSON(): WorkflowStepConfig {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      type: this.type,
      executorRoles: this.executorRoles,
      parallel: this.parallel,
      dependsOn: this.dependsOn,
      condition: this.condition,
      timeout: this.timeout,
      retry: this.retry,
      reviewConfig: this.reviewConfig,
      loopConfig: this.loopConfig,
      metadata: this.metadata,
    };
  }
}

/**
 * 工作流实现类
 */
export class Workflow implements IWorkflow {
  readonly id: string;
  readonly name: string;
  readonly type: WorkflowType;
  readonly steps: IWorkflowStep[];
  readonly entryStepId: string;
  readonly exitStepIds: string[];
  readonly timeout?: number;
  readonly metadata?: Record<string, unknown>;

  private readonly stepMap: Map<string, IWorkflowStep>;
  private readonly dependencyGraph: Map<string, string[]>;
  private readonly reverseDependencyGraph: Map<string, string[]>;

  /**
   * 从配置创建工作流（静态工厂方法）
   */
  static fromConfig(config: WorkflowConfig): Workflow {
    return new Workflow(config);
  }

  constructor(config: WorkflowConfig) {
    this.id = config.id;
    this.name = config.name;
    this.type = config.type;
    this.timeout = config.timeout;
    this.metadata = config.metadata;

    // 构建步骤
    this.steps = config.steps.map((s) => new WorkflowStep(s));

    // 构建步骤映射
    this.stepMap = new Map();
    for (const step of this.steps) {
      this.stepMap.set(step.id, step);
    }

    // 确定入口步骤
    this.entryStepId = config.entryStepId || this.findEntryStep();

    // 构建依赖图
    this.dependencyGraph = new Map();
    this.reverseDependencyGraph = new Map();
    for (const step of this.steps) {
      this.dependencyGraph.set(step.id, step.dependsOn);
      for (const dep of step.dependsOn) {
        const reverse = this.reverseDependencyGraph.get(dep) || [];
        reverse.push(step.id);
        this.reverseDependencyGraph.set(dep, reverse);
      }
    }

    // 确定出口步骤
    this.exitStepIds = this.findExitSteps();
  }

  /**
   * 查找入口步骤（无依赖的步骤）
   */
  private findEntryStep(): string {
    for (const step of this.steps) {
      if (step.dependsOn.length === 0) {
        return step.id;
      }
    }
    throw new Error("No entry step found: all steps have dependencies");
  }

  /**
   * 查找出口步骤（无被依赖的步骤）
   */
  private findExitSteps(): string[] {
    const exitSteps: string[] = [];
    for (const step of this.steps) {
      const dependents = this.reverseDependencyGraph.get(step.id) || [];
      if (dependents.length === 0) {
        exitSteps.push(step.id);
      }
    }
    return exitSteps;
  }

  /**
   * 获取步骤
   */
  getStep(stepId: string): IWorkflowStep | undefined {
    return this.stepMap.get(stepId);
  }

  /**
   * 获取入口步骤
   */
  getEntryStep(): IWorkflowStep {
    const step = this.stepMap.get(this.entryStepId);
    if (!step) {
      throw new Error(`Entry step ${this.entryStepId} not found`);
    }
    return step;
  }

  /**
   * 获取下一步骤
   */
  getNextSteps(currentStepId: string): IWorkflowStep[] {
    const dependents = this.reverseDependencyGraph.get(currentStepId) || [];
    return dependents
      .map((id) => this.stepMap.get(id))
      .filter((s): s is IWorkflowStep => s !== undefined);
  }

  /**
   * 获取依赖步骤
   */
  getDependencies(stepId: string): IWorkflowStep[] {
    const step = this.stepMap.get(stepId);
    if (!step) return [];
    return step.dependsOn
      .map((id) => this.stepMap.get(id))
      .filter((s): s is IWorkflowStep => s !== undefined);
  }

  /**
   * 检查是否可执行
   */
  canExecute(stepId: string, completedStepIds: string[]): boolean {
    const step = this.stepMap.get(stepId);
    if (!step) return false;

    // 检查所有依赖是否已完成
    for (const depId of step.dependsOn) {
      if (!completedStepIds.includes(depId)) {
        return false;
      }
    }

    return true;
  }

  /**
   * 获取可执行的步骤
   */
  getExecutableSteps(completedStepIds: string[]): IWorkflowStep[] {
    const pendingSteps = this.steps.filter(
      (s) => !completedStepIds.includes(s.id),
    );
    return pendingSteps.filter((s) => this.canExecute(s.id, completedStepIds));
  }

  /**
   * 验证工作流定义
   */
  validate(): WorkflowValidationResult {
    const errors: WorkflowValidationError[] = [];
    const warnings: WorkflowValidationWarning[] = [];

    // 检查是否有步骤
    if (this.steps.length === 0) {
      errors.push({
        code: "NO_STEPS",
        message: "Workflow has no steps",
      });
    }

    // 检查入口步骤是否存在
    if (!this.stepMap.has(this.entryStepId)) {
      errors.push({
        code: "INVALID_ENTRY",
        message: `Entry step ${this.entryStepId} not found`,
      });
    }

    // 检查依赖是否存在
    for (const step of this.steps) {
      for (const depId of step.dependsOn) {
        if (!this.stepMap.has(depId)) {
          errors.push({
            code: "INVALID_DEPENDENCY",
            message: `Step ${step.id} depends on non-existent step ${depId}`,
            stepId: step.id,
          });
        }
      }
    }

    // 检查循环依赖
    const cycleCheck = this.detectCycle();
    if (cycleCheck) {
      errors.push({
        code: "CIRCULAR_DEPENDENCY",
        message: `Circular dependency detected: ${cycleCheck.join(" -> ")}`,
      });
    }

    // 检查孤立步骤
    for (const step of this.steps) {
      if (step.id !== this.entryStepId && step.dependsOn.length === 0) {
        warnings.push({
          code: "ISOLATED_STEP",
          message: `Step ${step.id} has no dependencies but is not the entry step`,
          stepId: step.id,
        });
      }
    }

    // 检查审核步骤配置
    for (const step of this.steps) {
      if (step.type === "review" && !step.reviewConfig) {
        warnings.push({
          code: "MISSING_REVIEW_CONFIG",
          message: `Review step ${step.id} has no review configuration`,
          stepId: step.id,
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 检测循环依赖
   */
  private detectCycle(): string[] | null {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    const dfs = (stepId: string): boolean => {
      visited.add(stepId);
      recursionStack.add(stepId);
      path.push(stepId);

      const dependents = this.reverseDependencyGraph.get(stepId) || [];
      for (const dependent of dependents) {
        if (!visited.has(dependent)) {
          if (dfs(dependent)) return true;
        } else if (recursionStack.has(dependent)) {
          path.push(dependent);
          return true;
        }
      }

      recursionStack.delete(stepId);
      path.pop();
      return false;
    };

    for (const step of this.steps) {
      if (!visited.has(step.id)) {
        if (dfs(step.id)) {
          return path;
        }
      }
    }

    return null;
  }

  /**
   * 获取拓扑排序
   */
  getTopologicalOrder(): string[] {
    const result: string[] = [];
    const visited = new Set<string>();

    const visit = (stepId: string) => {
      if (visited.has(stepId)) return;
      visited.add(stepId);

      const step = this.stepMap.get(stepId);
      if (step) {
        for (const depId of step.dependsOn) {
          visit(depId);
        }
      }

      result.push(stepId);
    };

    for (const step of this.steps) {
      visit(step.id);
    }

    return result;
  }

  /**
   * 转换为 JSON
   */
  toJSON(): WorkflowConfig {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      steps: this.steps.map((s) => (s as WorkflowStep).toJSON()),
      entryStepId: this.entryStepId,
      timeout: this.timeout,
      metadata: this.metadata,
    };
  }
}

/**
 * 工作流构建器
 */
export class WorkflowBuilder {
  private config: Partial<WorkflowConfig>;
  private steps: WorkflowStepConfig[] = [];

  constructor() {
    this.config = {
      type: "sequential",
    };
  }

  /**
   * 设置 ID
   */
  setId(id: string): this {
    this.config.id = id;
    return this;
  }

  /**
   * 设置名称
   */
  setName(name: string): this {
    this.config.name = name;
    return this;
  }

  /**
   * 设置类型
   */
  setType(type: WorkflowType): this {
    this.config.type = type;
    return this;
  }

  /**
   * 设置超时
   */
  setTimeout(timeout: number): this {
    this.config.timeout = timeout;
    return this;
  }

  /**
   * 添加步骤
   */
  addStep(step: WorkflowStepConfig): this {
    this.steps.push(step);
    return this;
  }

  /**
   * 添加顺序步骤（自动设置依赖）
   */
  addSequentialStep(step: Omit<WorkflowStepConfig, "dependsOn">): this {
    const lastStep = this.steps[this.steps.length - 1];
    this.steps.push({
      ...step,
      dependsOn: lastStep ? [lastStep.id] : [],
    });
    return this;
  }

  /**
   * 设置入口步骤
   */
  setEntryStep(stepId: string): this {
    this.config.entryStepId = stepId;
    return this;
  }

  /**
   * 构建工作流
   */
  build(): Workflow {
    if (!this.config.id) {
      throw new Error("Workflow id is required");
    }
    if (!this.config.name) {
      throw new Error("Workflow name is required");
    }
    if (this.steps.length === 0) {
      throw new Error("Workflow must have at least one step");
    }

    const fullConfig: WorkflowConfig = {
      id: this.config.id,
      name: this.config.name,
      type: this.config.type || "sequential",
      steps: this.steps,
      entryStepId: this.config.entryStepId,
      timeout: this.config.timeout,
      metadata: this.config.metadata,
    };

    return new Workflow(fullConfig);
  }
}

/**
 * 创建工作流构建器
 */
export function createWorkflowBuilder(): WorkflowBuilder {
  return new WorkflowBuilder();
}

/**
 * 从配置创建工作流
 */
export function createWorkflow(config: WorkflowConfig): Workflow {
  return new Workflow(config);
}
