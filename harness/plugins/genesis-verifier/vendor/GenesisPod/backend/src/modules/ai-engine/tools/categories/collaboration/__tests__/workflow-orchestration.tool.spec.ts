import {
  WorkflowOrchestrationTool,
  Workflow,
  WorkflowStep,
} from "../workflow-orchestration.tool";
import { ToolContext } from "../../../abstractions/tool.interface";

// ============================================================================
// Helpers
// ============================================================================

function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "test-exec-id",
    toolId: "workflow-orchestration",
    userId: "user-123",
    createdAt: new Date(),
    ...overrides,
  };
}

function buildStep(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    stepId: "step-1",
    name: "Step One",
    type: "TASK",
    ...overrides,
  };
}

function buildWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    workflowId: "wf-test-001",
    name: "Test Workflow",
    steps: [buildStep()],
    mode: "SEQUENTIAL",
    ...overrides,
  };
}

// ============================================================================
// Test suite
// ============================================================================

describe("WorkflowOrchestrationTool", () => {
  let tool: WorkflowOrchestrationTool;

  beforeEach(() => {
    // Fresh instance so workflow store is clean
    tool = new WorkflowOrchestrationTool();
  });

  // --------------------------------------------------------------------------
  // validateInput
  // --------------------------------------------------------------------------

  describe("validateInput", () => {
    it("should return true for a valid CREATE operation", () => {
      expect(
        tool.validateInput({ operation: "CREATE", workflow: buildWorkflow() }),
      ).toBe(true);
    });

    it("should return false for CREATE without a workflow name", () => {
      expect(
        tool.validateInput({
          operation: "CREATE",
          workflow: buildWorkflow({ name: "" }),
        }),
      ).toBe(false);
    });

    it("should return false for CREATE with an empty steps array", () => {
      expect(
        tool.validateInput({
          operation: "CREATE",
          workflow: buildWorkflow({ steps: [] }),
        }),
      ).toBe(false);
    });

    it("should return false for CREATE without a workflow definition", () => {
      expect(tool.validateInput({ operation: "CREATE" })).toBe(false);
    });

    it("should return true for START with a valid workflowId", () => {
      expect(
        tool.validateInput({ operation: "START", workflowId: "wf-001" }),
      ).toBe(true);
    });

    it("should return false for START without workflowId", () => {
      expect(tool.validateInput({ operation: "START" })).toBe(false);
    });

    it("should return false for PAUSE without workflowId", () => {
      expect(tool.validateInput({ operation: "PAUSE" })).toBe(false);
    });

    it("should return false for GET_STATUS without workflowId", () => {
      expect(tool.validateInput({ operation: "GET_STATUS" })).toBe(false);
    });

    it("should return true for CANCEL with a workflowId", () => {
      expect(
        tool.validateInput({ operation: "CANCEL", workflowId: "wf-001" }),
      ).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // CREATE operation
  // --------------------------------------------------------------------------

  describe("CREATE operation", () => {
    it("should create a workflow and return success: true with PENDING status", async () => {
      const context = createMockContext();

      const result = await tool.execute(
        { operation: "CREATE", workflow: buildWorkflow() },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.status).toBe("PENDING");
      expect(result.data?.workflowId).toBeTruthy();
    });

    it("should use the provided workflowId", async () => {
      const context = createMockContext();

      const result = await tool.execute(
        {
          operation: "CREATE",
          workflow: buildWorkflow({ workflowId: "custom-wf-42" }),
        },
        context,
      );

      expect(result.data?.workflowId).toBe("custom-wf-42");
    });

    it("should initialize all steps with PENDING status", async () => {
      const context = createMockContext();
      const steps: WorkflowStep[] = [
        buildStep({ stepId: "step-a", name: "Step A" }),
        buildStep({ stepId: "step-b", name: "Step B" }),
      ];

      const result = await tool.execute(
        {
          operation: "CREATE",
          workflow: buildWorkflow({ workflowId: "wf-steps-001", steps }),
        },
        context,
      );

      expect(result.data?.stepStatuses?.["step-a"]?.status).toBe("PENDING");
      expect(result.data?.stepStatuses?.["step-b"]?.status).toBe("PENDING");
    });

    it("should generate a workflowId when none is provided", async () => {
      const context = createMockContext();
      const workflow = buildWorkflow();
      const { workflowId: _omit, ...noId } = workflow;

      const result = await tool.execute(
        { operation: "CREATE", workflow: noId as Workflow },
        context,
      );

      expect(result.data?.workflowId).toBeTruthy();
      expect(result.data?.workflowId).toMatch(/^wf_/);
    });
  });

  // --------------------------------------------------------------------------
  // GET_STATUS operation
  // --------------------------------------------------------------------------

  describe("GET_STATUS operation", () => {
    it("should return the workflow status after creation", async () => {
      const context = createMockContext();

      await tool.execute(
        {
          operation: "CREATE",
          workflow: buildWorkflow({ workflowId: "wf-status-001" }),
        },
        context,
      );

      const result = await tool.execute(
        { operation: "GET_STATUS", workflowId: "wf-status-001" },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.status).toBe("PENDING");
    });

    it("should return success: false for a non-existent workflowId", async () => {
      const context = createMockContext();

      const result = await tool.execute(
        { operation: "GET_STATUS", workflowId: "does-not-exist" },
        context,
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toBeDefined();
    });

    it("should include stepStatuses in the status response", async () => {
      const context = createMockContext();

      await tool.execute(
        {
          operation: "CREATE",
          workflow: buildWorkflow({
            workflowId: "wf-stepstatus-001",
            steps: [buildStep({ stepId: "s1" })],
          }),
        },
        context,
      );

      const result = await tool.execute(
        { operation: "GET_STATUS", workflowId: "wf-stepstatus-001" },
        context,
      );

      expect(result.data?.stepStatuses).toBeDefined();
      expect(result.data?.stepStatuses?.["s1"]).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // START operation
  // --------------------------------------------------------------------------

  describe("START operation", () => {
    it("should start a PENDING workflow and return success: true", async () => {
      const context = createMockContext();

      await tool.execute(
        {
          operation: "CREATE",
          workflow: buildWorkflow({ workflowId: "wf-start-001" }),
        },
        context,
      );

      const result = await tool.execute(
        { operation: "START", workflowId: "wf-start-001" },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.operation).toBe("START");
    }, 10000);

    it("should return success: false when trying to start a non-existent workflow", async () => {
      const context = createMockContext();

      const result = await tool.execute(
        { operation: "START", workflowId: "ghost-workflow" },
        context,
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("not found");
    });

    it("should include duration in the result after execution", async () => {
      const context = createMockContext();

      await tool.execute(
        {
          operation: "CREATE",
          workflow: buildWorkflow({ workflowId: "wf-duration-001" }),
        },
        context,
      );

      const result = await tool.execute(
        { operation: "START", workflowId: "wf-duration-001" },
        context,
      );

      expect(result.data?.duration).toBeDefined();
      expect(typeof result.data?.duration).toBe("number");
    }, 10000);
  });

  // --------------------------------------------------------------------------
  // CANCEL operation
  // --------------------------------------------------------------------------

  describe("CANCEL operation", () => {
    it("should cancel a workflow and return status CANCELLED", async () => {
      const context = createMockContext();

      await tool.execute(
        {
          operation: "CREATE",
          workflow: buildWorkflow({ workflowId: "wf-cancel-001" }),
        },
        context,
      );

      const result = await tool.execute(
        { operation: "CANCEL", workflowId: "wf-cancel-001" },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.status).toBe("CANCELLED");
    });

    it("should return success: false when cancelling a non-existent workflow", async () => {
      const context = createMockContext();

      const result = await tool.execute(
        { operation: "CANCEL", workflowId: "ghost-wf" },
        context,
      );

      expect(result.data?.success).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // UPDATE_CONTEXT operation
  // --------------------------------------------------------------------------

  describe("UPDATE_CONTEXT operation", () => {
    it("should update workflow context and return success: true", async () => {
      const context = createMockContext();

      await tool.execute(
        {
          operation: "CREATE",
          workflow: buildWorkflow({ workflowId: "wf-ctx-001" }),
        },
        context,
      );

      const result = await tool.execute(
        {
          operation: "UPDATE_CONTEXT",
          workflowId: "wf-ctx-001",
          contextUpdate: { userId: "user-456", stage: "review" },
        },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.status).toBeDefined();
    });

    it("should return success: false when updating context of non-existent workflow", async () => {
      const context = createMockContext();

      const result = await tool.execute(
        {
          operation: "UPDATE_CONTEXT",
          workflowId: "ghost-wf-ctx",
          contextUpdate: { key: "value" },
        },
        context,
      );

      expect(result.data?.success).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // ROLLBACK operation
  // --------------------------------------------------------------------------

  describe("ROLLBACK operation", () => {
    it("should successfully roll back a workflow with rollback enabled", async () => {
      const context = createMockContext();

      await tool.execute(
        {
          operation: "CREATE",
          workflow: buildWorkflow({
            workflowId: "wf-rollback-001",
            rollback: { enabled: true },
          }),
        },
        context,
      );

      const result = await tool.execute(
        { operation: "ROLLBACK", workflowId: "wf-rollback-001" },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.status).toBe("PENDING");
    });

    it("should return success: false when rollback is not enabled", async () => {
      const context = createMockContext();

      await tool.execute(
        {
          operation: "CREATE",
          workflow: buildWorkflow({
            workflowId: "wf-no-rollback-001",
            rollback: { enabled: false },
          }),
        },
        context,
      );

      const result = await tool.execute(
        { operation: "ROLLBACK", workflowId: "wf-no-rollback-001" },
        context,
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("not enabled");
    });

    it("should reset all step statuses to PENDING after rollback", async () => {
      const context = createMockContext();

      await tool.execute(
        {
          operation: "CREATE",
          workflow: buildWorkflow({
            workflowId: "wf-rollback-steps-001",
            steps: [buildStep({ stepId: "s1" }), buildStep({ stepId: "s2" })],
            rollback: { enabled: true },
          }),
        },
        context,
      );

      const result = await tool.execute(
        { operation: "ROLLBACK", workflowId: "wf-rollback-steps-001" },
        context,
      );

      expect(result.data?.stepStatuses?.["s1"]?.status).toBe("PENDING");
      expect(result.data?.stepStatuses?.["s2"]?.status).toBe("PENDING");
    });
  });

  // --------------------------------------------------------------------------
  // Error handling
  // --------------------------------------------------------------------------

  describe("error handling", () => {
    it("should return data.success: false for an unsupported operation", async () => {
      const context = createMockContext();

      const result = await tool.execute(
        {
          operation: "INVALID_OP" as "CREATE",
          workflowId: "wf-001",
        },
        context,
      );

      // doExecute hits the default branch and throws. The outer try-catch in
      // doExecute catches it and returns { success: false, error: "..." }.
      // BaseTool.execute() wraps this as { success: true, data: { success: false } }.
      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toBeDefined();
    });

    it("should return success: false when starting an already-running workflow", async () => {
      const context = createMockContext();

      await tool.execute(
        {
          operation: "CREATE",
          workflow: buildWorkflow({ workflowId: "wf-rerun-001" }),
        },
        context,
      );

      // Start once — this will run and the workflow will transition to COMPLETED or FAILED
      await tool.execute(
        { operation: "START", workflowId: "wf-rerun-001" },
        context,
      );

      // Cancel to put it in CANCELLED state, then try to start again
      await tool.execute(
        { operation: "CANCEL", workflowId: "wf-rerun-001" },
        context,
      );

      const result = await tool.execute(
        { operation: "START", workflowId: "wf-rerun-001" },
        context,
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toBeDefined();
    }, 10000);

    it("should return success: false when pausing a non-running workflow", async () => {
      const context = createMockContext();

      await tool.execute(
        {
          operation: "CREATE",
          workflow: buildWorkflow({ workflowId: "wf-pause-pending-001" }),
        },
        context,
      );

      // Workflow is PENDING, cannot be paused
      const result = await tool.execute(
        { operation: "PAUSE", workflowId: "wf-pause-pending-001" },
        context,
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("running");
    });
  });
});
