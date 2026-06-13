/**
 * Workflow Orchestration Tool
 * 工作流编排工具 - 定义和执行多步骤工作流
 */

import { Injectable, Logger } from "@nestjs/common";
import { BaseTool } from "../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../abstractions/tool.interface";
// AgentId and AgentResult available from "@/modules/ai-harness/agents/abstractions/agent.types" if needed

// ============================================================================
// Types
// ============================================================================

export type WorkflowStatus =
  | "PENDING"
  | "RUNNING"
  | "PAUSED"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type StepStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "SKIPPED";

export type ExecutionMode = "SEQUENTIAL" | "PARALLEL" | "CONDITIONAL";

export interface WorkflowStep {
  /**
   * 步骤 ID
   */
  stepId: string;

  /**
   * 步骤名称
   */
  name: string;

  /**
   * 步骤类型
   */
  type: "TASK" | "DECISION" | "WAIT" | "PARALLEL_GATEWAY" | "LOOP";

  /**
   * 执行的工具/Agent
   */
  executor?: string;

  /**
   * 输入参数
   */
  input?: Record<string, unknown>;

  /**
   * 依赖的步骤 ID
   */
  dependsOn?: string[];

  /**
   * 条件表达式（DECISION 类型）
   */
  condition?: string;

  /**
   * 条件分支
   */
  branches?: {
    condition: string;
    targetStepId: string;
  }[];

  /**
   * 重试配置
   */
  retry?: {
    maxAttempts: number;
    delay: number;
    backoff?: "linear" | "exponential";
  };

  /**
   * 超时时间（毫秒）
   */
  timeout?: number;

  /**
   * 失败时是否继续
   */
  continueOnFailure?: boolean;
}

export interface Workflow {
  /**
   * 工作流 ID
   */
  workflowId: string;

  /**
   * 工作流名称
   */
  name: string;

  /**
   * 工作流描述
   */
  description?: string;

  /**
   * 步骤列表
   */
  steps: WorkflowStep[];

  /**
   * 执行模式
   */
  mode: ExecutionMode;

  /**
   * 全局上下文
   */
  context?: Record<string, unknown>;

  /**
   * 回滚配置
   */
  rollback?: {
    enabled: boolean;
    steps?: string[];
  };
}

export interface WorkflowOrchestrationInput {
  /**
   * 操作类型
   */
  operation:
    | "CREATE"
    | "START"
    | "PAUSE"
    | "RESUME"
    | "CANCEL"
    | "GET_STATUS"
    | "UPDATE_CONTEXT"
    | "ROLLBACK";

  /**
   * 工作流定义
   */
  workflow?: Workflow;

  /**
   * 工作流 ID
   */
  workflowId?: string;

  /**
   * 上下文更新
   */
  contextUpdate?: Record<string, unknown>;

  /**
   * 执行选项
   */
  options?: {
    /**
     * 从指定步骤开始
     */
    startFromStep?: string;

    /**
     * 是否启用调试模式
     */
    debug?: boolean;

    /**
     * 全局超时
     */
    timeout?: number;
  };
}

export interface WorkflowOrchestrationOutput {
  /**
   * 操作是否成功
   */
  success: boolean;

  /**
   * 操作类型
   */
  operation: string;

  /**
   * 工作流 ID
   */
  workflowId?: string;

  /**
   * 工作流状态
   */
  status?: WorkflowStatus;

  /**
   * 当前步骤
   */
  currentStep?: string;

  /**
   * 步骤状态
   */
  stepStatuses?: Record<
    string,
    {
      status: StepStatus;
      startedAt?: string;
      completedAt?: string;
      output?: unknown;
      error?: string;
      attempts?: number;
    }
  >;

  /**
   * 工作流输出
   */
  output?: Record<string, unknown>;

  /**
   * 执行时长（毫秒）
   */
  duration?: number;

  /**
   * 错误信息
   */
  error?: string;
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class WorkflowOrchestrationTool extends BaseTool<
  WorkflowOrchestrationInput,
  WorkflowOrchestrationOutput
> {
  private readonly logger = new Logger(WorkflowOrchestrationTool.name);

  // 模拟工作流存储
  private workflowStore: Map<
    string,
    Workflow & {
      status: WorkflowStatus;
      stepStatuses: Record<
        string,
        {
          status: StepStatus;
          startedAt?: string;
          completedAt?: string;
          output?: unknown;
          error?: string;
          attempts: number;
        }
      >;
      currentStep?: string;
      startedAt?: string;
      completedAt?: string;
      output: Record<string, unknown>;
    }
  > = new Map();

  readonly id = "workflow-orchestration";
  readonly sideEffect = "none" as const;
  readonly category: ToolCategory = "collaboration";
  readonly tags = [
    "collaboration",
    "workflow",
    "orchestration",
    "pipeline",
    "automation",
  ];
  readonly name = "工作流编排";
  readonly description =
    "定义和执行多步骤工作流，支持顺序、并行和条件执行模式，包含重试、超时、回滚等高级特性。适用于复杂的多 Agent 协作流程。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      operation: {
        type: "string",
        description: "操作类型",
        enum: [
          "CREATE",
          "START",
          "PAUSE",
          "RESUME",
          "CANCEL",
          "GET_STATUS",
          "UPDATE_CONTEXT",
          "ROLLBACK",
        ],
      },
      workflow: {
        type: "object",
        description: "工作流定义",
        properties: {
          workflowId: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                stepId: { type: "string" },
                name: { type: "string" },
                type: {
                  type: "string",
                  enum: [
                    "TASK",
                    "DECISION",
                    "WAIT",
                    "PARALLEL_GATEWAY",
                    "LOOP",
                  ],
                },
                executor: { type: "string" },
                input: { type: "object" },
                dependsOn: { type: "array", items: { type: "string" } },
                condition: { type: "string" },
                timeout: { type: "number" },
                continueOnFailure: { type: "boolean" },
              },
            },
          },
          mode: {
            type: "string",
            enum: ["SEQUENTIAL", "PARALLEL", "CONDITIONAL"],
          },
          context: { type: "object" },
        },
      },
      workflowId: { type: "string", description: "工作流 ID" },
      contextUpdate: { type: "object", description: "上下文更新" },
      options: {
        type: "object",
        description: "执行选项",
        properties: {
          startFromStep: { type: "string" },
          debug: { type: "boolean" },
          timeout: { type: "number" },
        },
      },
    },
    required: ["operation"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      success: { type: "boolean" },
      operation: { type: "string" },
      workflowId: { type: "string" },
      status: { type: "string" },
      currentStep: { type: "string" },
      stepStatuses: { type: "object" },
      output: { type: "object" },
      duration: { type: "number" },
      error: { type: "string" },
    },
  };

  constructor() {
    super();
    // defaultTimeout set in class property // 5 分钟默认超时
  }

  validateInput(input: WorkflowOrchestrationInput) {
    if (!input.operation) return false;

    const { operation, workflow, workflowId } = input;

    switch (operation) {
      case "CREATE":
        if (
          !workflow?.name ||
          !workflow?.steps ||
          workflow.steps.length === 0
        ) {
          return false;
        }
        break;
      case "START":
      case "PAUSE":
      case "RESUME":
      case "CANCEL":
      case "GET_STATUS":
      case "UPDATE_CONTEXT":
      case "ROLLBACK":
        if (!workflowId) return false;
        break;
    }

    return true;
  }

  protected async doExecute(
    input: WorkflowOrchestrationInput,
    _context: ToolContext,
  ): Promise<WorkflowOrchestrationOutput> {
    const { operation, workflow, workflowId, contextUpdate, options } = input;

    this.logger.log(`[doExecute] Workflow operation: ${operation}`);

    try {
      switch (operation) {
        case "CREATE":
          return this.createWorkflow(workflow!);

        case "START":
          return await this.startWorkflow(workflowId!, options);

        case "PAUSE":
          return this.pauseWorkflow(workflowId!);

        case "RESUME":
          return await this.resumeWorkflow(workflowId!);

        case "CANCEL":
          return this.cancelWorkflow(workflowId!);

        case "GET_STATUS":
          return this.getWorkflowStatus(workflowId!);

        case "UPDATE_CONTEXT":
          return this.updateContext(workflowId!, contextUpdate);

        case "ROLLBACK":
          return this.rollbackWorkflow(workflowId!);

        default:
          throw new Error(`Unsupported operation: ${operation}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[doExecute] Workflow operation failed: ${errorMessage}`,
      );

      return {
        success: false,
        operation,
        error: errorMessage,
      };
    }
  }

  private createWorkflow(workflow: Workflow): WorkflowOrchestrationOutput {
    const workflowId =
      workflow.workflowId ||
      `wf_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // 初始化步骤状态
    const stepStatuses: Record<
      string,
      { status: StepStatus; attempts: number }
    > = {};
    for (const step of workflow.steps) {
      stepStatuses[step.stepId] = {
        status: "PENDING",
        attempts: 0,
      };
    }

    this.workflowStore.set(workflowId, {
      ...workflow,
      workflowId,
      mode: workflow.mode || "SEQUENTIAL",
      status: "PENDING",
      stepStatuses,
      output: {},
    });

    this.logger.log(`[createWorkflow] Workflow ${workflowId} created`);

    return {
      success: true,
      operation: "CREATE",
      workflowId,
      status: "PENDING",
      stepStatuses,
    };
  }

  private async startWorkflow(
    workflowId: string,
    options?: WorkflowOrchestrationInput["options"],
  ): Promise<WorkflowOrchestrationOutput> {
    const workflow = this.workflowStore.get(workflowId);

    if (!workflow) {
      return {
        success: false,
        operation: "START",
        workflowId,
        error: `Workflow not found (workflowId="${workflowId}", available: [${Array.from(this.workflowStore.keys()).join(", ") || "<none>"}])`,
      };
    }

    if (workflow.status !== "PENDING" && workflow.status !== "PAUSED") {
      return {
        success: false,
        operation: "START",
        workflowId,
        error: `Cannot start workflow in ${workflow.status} status`,
      };
    }

    workflow.status = "RUNNING";
    workflow.startedAt = new Date().toISOString();

    // 执行工作流步骤（模拟）
    const startTime = Date.now();
    await this.executeWorkflow(workflow, options?.startFromStep);
    const duration = Date.now() - startTime;

    return {
      success: true,
      operation: "START",
      workflowId,
      status: workflow.status,
      currentStep: workflow.currentStep,
      stepStatuses: workflow.stepStatuses,
      output: workflow.output,
      duration,
    };
  }

  private async executeWorkflow(
    workflow: NonNullable<ReturnType<typeof this.workflowStore.get>>,
    startFromStep?: string,
  ): Promise<void> {
    const steps = workflow.steps;
    let startIndex = 0;

    if (startFromStep) {
      startIndex = steps.findIndex((s) => s.stepId === startFromStep);
      if (startIndex === -1) startIndex = 0;
    }

    for (let i = startIndex; i < steps.length; i++) {
      const step = steps[i];

      // 检查工作流状态
      if (workflow.status !== "RUNNING") {
        break;
      }

      // 检查依赖
      if (step.dependsOn && step.dependsOn.length > 0) {
        const allDependenciesCompleted = step.dependsOn.every(
          (depId) => workflow.stepStatuses[depId]?.status === "COMPLETED",
        );
        if (!allDependenciesCompleted) {
          continue;
        }
      }

      workflow.currentStep = step.stepId;
      workflow.stepStatuses[step.stepId].status = "RUNNING";
      workflow.stepStatuses[step.stepId].startedAt = new Date().toISOString();
      workflow.stepStatuses[step.stepId].attempts++;

      // 模拟步骤执行
      await new Promise((resolve) =>
        setTimeout(resolve, 100 + Math.random() * 200),
      );

      // 模拟执行结果
      const success = Math.random() > 0.1; // 90% 成功率

      if (success) {
        workflow.stepStatuses[step.stepId].status = "COMPLETED";
        workflow.stepStatuses[step.stepId].completedAt =
          new Date().toISOString();
        workflow.stepStatuses[step.stepId].output = {
          message: `Step ${step.name} completed successfully`,
        };
        workflow.output[step.stepId] =
          workflow.stepStatuses[step.stepId].output;
      } else {
        if (step.continueOnFailure) {
          workflow.stepStatuses[step.stepId].status = "FAILED";
          workflow.stepStatuses[step.stepId].error = "Step execution failed";
        } else {
          workflow.stepStatuses[step.stepId].status = "FAILED";
          workflow.stepStatuses[step.stepId].error = "Step execution failed";
          workflow.status = "FAILED";
          break;
        }
      }
    }

    // 检查是否所有步骤都完成
    const allCompleted = Object.values(workflow.stepStatuses).every(
      (s) => s.status === "COMPLETED" || s.status === "SKIPPED",
    );

    if (allCompleted && workflow.status === "RUNNING") {
      workflow.status = "COMPLETED";
      workflow.completedAt = new Date().toISOString();
    }
  }

  private pauseWorkflow(workflowId: string): WorkflowOrchestrationOutput {
    const workflow = this.workflowStore.get(workflowId);

    if (!workflow) {
      return {
        success: false,
        operation: "PAUSE",
        workflowId,
        error: `Workflow not found (workflowId="${workflowId}", available: [${Array.from(this.workflowStore.keys()).join(", ") || "<none>"}])`,
      };
    }

    if (workflow.status !== "RUNNING") {
      return {
        success: false,
        operation: "PAUSE",
        workflowId,
        error: `Only running workflows can be paused (workflowId="${workflowId}", currentStatus="${workflow.status}")`,
      };
    }

    workflow.status = "PAUSED";

    return {
      success: true,
      operation: "PAUSE",
      workflowId,
      status: "PAUSED",
      currentStep: workflow.currentStep,
    };
  }

  private async resumeWorkflow(
    workflowId: string,
  ): Promise<WorkflowOrchestrationOutput> {
    const workflow = this.workflowStore.get(workflowId);

    if (!workflow) {
      return {
        success: false,
        operation: "RESUME",
        workflowId,
        error: `Workflow not found (workflowId="${workflowId}", available: [${Array.from(this.workflowStore.keys()).join(", ") || "<none>"}])`,
      };
    }

    if (workflow.status !== "PAUSED") {
      return {
        success: false,
        operation: "RESUME",
        workflowId,
        error: `Only paused workflows can be resumed (workflowId="${workflowId}", currentStatus="${workflow.status}")`,
      };
    }

    return this.startWorkflow(workflowId, {
      startFromStep: workflow.currentStep,
    });
  }

  private cancelWorkflow(workflowId: string): WorkflowOrchestrationOutput {
    const workflow = this.workflowStore.get(workflowId);

    if (!workflow) {
      return {
        success: false,
        operation: "CANCEL",
        workflowId,
        error: `Workflow not found (workflowId="${workflowId}", available: [${Array.from(this.workflowStore.keys()).join(", ") || "<none>"}])`,
      };
    }

    workflow.status = "CANCELLED";

    return {
      success: true,
      operation: "CANCEL",
      workflowId,
      status: "CANCELLED",
    };
  }

  private getWorkflowStatus(workflowId: string): WorkflowOrchestrationOutput {
    const workflow = this.workflowStore.get(workflowId);

    if (!workflow) {
      return {
        success: false,
        operation: "GET_STATUS",
        workflowId,
        error: `Workflow not found (workflowId="${workflowId}", available: [${Array.from(this.workflowStore.keys()).join(", ") || "<none>"}])`,
      };
    }

    return {
      success: true,
      operation: "GET_STATUS",
      workflowId,
      status: workflow.status,
      currentStep: workflow.currentStep,
      stepStatuses: workflow.stepStatuses,
      output: workflow.output,
    };
  }

  private updateContext(
    workflowId: string,
    contextUpdate?: Record<string, unknown>,
  ): WorkflowOrchestrationOutput {
    const workflow = this.workflowStore.get(workflowId);

    if (!workflow) {
      return {
        success: false,
        operation: "UPDATE_CONTEXT",
        workflowId,
        error: `Workflow not found (workflowId="${workflowId}", available: [${Array.from(this.workflowStore.keys()).join(", ") || "<none>"}])`,
      };
    }

    if (contextUpdate) {
      workflow.context = {
        ...workflow.context,
        ...contextUpdate,
      };
    }

    return {
      success: true,
      operation: "UPDATE_CONTEXT",
      workflowId,
      status: workflow.status,
    };
  }

  private rollbackWorkflow(workflowId: string): WorkflowOrchestrationOutput {
    const workflow = this.workflowStore.get(workflowId);

    if (!workflow) {
      return {
        success: false,
        operation: "ROLLBACK",
        workflowId,
        error: `Workflow not found (workflowId="${workflowId}", available: [${Array.from(this.workflowStore.keys()).join(", ") || "<none>"}])`,
      };
    }

    if (!workflow.rollback?.enabled) {
      return {
        success: false,
        operation: "ROLLBACK",
        workflowId,
        error: `Rollback not enabled for this workflow (workflowId="${workflowId}"; pass options.rollback.enabled=true at CREATE time to enable)`,
      };
    }

    // 模拟回滚
    this.logger.log(`[rollbackWorkflow] Rolling back workflow ${workflowId}`);

    // 重置步骤状态
    for (const stepId of Object.keys(workflow.stepStatuses)) {
      workflow.stepStatuses[stepId] = {
        status: "PENDING",
        attempts: 0,
      };
    }

    workflow.status = "PENDING";
    workflow.currentStep = undefined;
    workflow.output = {};

    return {
      success: true,
      operation: "ROLLBACK",
      workflowId,
      status: "PENDING",
      stepStatuses: workflow.stepStatuses,
    };
  }
}
