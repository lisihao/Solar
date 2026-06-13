/**
 * Unit tests for Workflow, WorkflowStep, WorkflowBuilder
 */

import {
  Workflow,
  WorkflowStep,
  WorkflowBuilder,
  createWorkflowBuilder,
  createWorkflow,
} from "../workflow";
import {
  WorkflowStepConfig,
  WorkflowConfig,
} from "../../abstractions/workflow.interface";

// ==================== Helpers ====================

function makeStepConfig(
  overrides: Partial<WorkflowStepConfig> & Pick<WorkflowStepConfig, "id">,
): WorkflowStepConfig {
  return {
    id: overrides.id,
    name: overrides.name ?? `Step ${overrides.id}`,
    description: overrides.description ?? "",
    type: overrides.type ?? "task",
    executorRoles: overrides.executorRoles ?? ["researcher"],
    parallel: overrides.parallel ?? false,
    dependsOn: overrides.dependsOn ?? [],
    ...overrides,
  };
}

function makeWorkflowConfig(
  steps: WorkflowStepConfig[],
  overrides: Partial<WorkflowConfig> = {},
): WorkflowConfig {
  return {
    id: "wf-1",
    name: "Test Workflow",
    type: "sequential",
    steps,
    ...overrides,
  };
}

// ==================== WorkflowStep ====================

describe("WorkflowStep", () => {
  it("should construct with required fields", () => {
    const config = makeStepConfig({ id: "step-1", name: "Research" });
    const step = new WorkflowStep(config);

    expect(step.id).toBe("step-1");
    expect(step.name).toBe("Research");
    expect(step.type).toBe("task");
    expect(step.executorRoles).toEqual(["researcher"]);
    expect(step.parallel).toBe(false);
    expect(step.dependsOn).toEqual([]);
  });

  it("should default description to empty string when not provided", () => {
    const config = makeStepConfig({ id: "s1" });
    delete (config as Partial<WorkflowStepConfig>).description;
    const step = new WorkflowStep({
      ...config,
      description: undefined as unknown as string,
    });
    expect(step.description).toBe("");
  });

  it("should store optional fields correctly", () => {
    const config = makeStepConfig({
      id: "s1",
      timeout: 5000,
      retry: { maxAttempts: 3, delay: 1000 },
      metadata: { key: "val" },
    });
    const step = new WorkflowStep(config);

    expect(step.timeout).toBe(5000);
    expect(step.retry).toEqual({ maxAttempts: 3, delay: 1000 });
    expect(step.metadata).toEqual({ key: "val" });
  });

  it("should serialize to JSON correctly", () => {
    const config = makeStepConfig({
      id: "s1",
      name: "Test",
      executorRoles: ["writer"],
    });
    const step = new WorkflowStep(config);
    const json = step.toJSON();

    expect(json.id).toBe("s1");
    expect(json.name).toBe("Test");
    expect(json.executorRoles).toEqual(["writer"]);
  });
});

// ==================== Workflow Construction ====================

describe("Workflow - Construction", () => {
  it("should construct with a single entry step", () => {
    const steps = [makeStepConfig({ id: "s1", dependsOn: [] })];
    const wf = new Workflow(makeWorkflowConfig(steps));

    expect(wf.id).toBe("wf-1");
    expect(wf.name).toBe("Test Workflow");
    expect(wf.type).toBe("sequential");
    expect(wf.steps).toHaveLength(1);
    expect(wf.entryStepId).toBe("s1");
  });

  it("should detect entry step automatically (no dependencies)", () => {
    const steps = [
      makeStepConfig({ id: "a", dependsOn: [] }),
      makeStepConfig({ id: "b", dependsOn: ["a"] }),
    ];
    const wf = new Workflow(makeWorkflowConfig(steps));
    expect(wf.entryStepId).toBe("a");
  });

  it("should use explicitly specified entryStepId", () => {
    const steps = [
      makeStepConfig({ id: "a", dependsOn: [] }),
      makeStepConfig({ id: "b", dependsOn: [] }),
    ];
    const wf = new Workflow(makeWorkflowConfig(steps, { entryStepId: "b" }));
    expect(wf.entryStepId).toBe("b");
  });

  it("should throw if no entry step found (all have dependencies)", () => {
    const steps = [
      makeStepConfig({ id: "a", dependsOn: ["b"] }),
      makeStepConfig({ id: "b", dependsOn: ["a"] }),
    ];
    // Circular deps mean no step has empty dependsOn — throws
    expect(() => new Workflow(makeWorkflowConfig(steps))).toThrow(
      "No entry step found",
    );
  });

  it("should detect exit steps (no dependents)", () => {
    const steps = [
      makeStepConfig({ id: "a", dependsOn: [] }),
      makeStepConfig({ id: "b", dependsOn: ["a"] }),
      makeStepConfig({ id: "c", dependsOn: ["a"] }),
    ];
    const wf = new Workflow(makeWorkflowConfig(steps));
    expect(wf.exitStepIds).toContain("b");
    expect(wf.exitStepIds).toContain("c");
    expect(wf.exitStepIds).not.toContain("a");
  });

  it("should create from static factory method", () => {
    const steps = [makeStepConfig({ id: "s1" })];
    const wf = Workflow.fromConfig(makeWorkflowConfig(steps));
    expect(wf).toBeInstanceOf(Workflow);
  });
});

// ==================== Workflow - Step Queries ====================

describe("Workflow - Step Queries", () => {
  let wf: Workflow;

  beforeEach(() => {
    const steps = [
      makeStepConfig({ id: "a", dependsOn: [] }),
      makeStepConfig({ id: "b", dependsOn: ["a"] }),
      makeStepConfig({ id: "c", dependsOn: ["b"] }),
    ];
    wf = new Workflow(makeWorkflowConfig(steps));
  });

  it("getStep should return a step by id", () => {
    const step = wf.getStep("b");
    expect(step).toBeDefined();
    expect(step!.id).toBe("b");
  });

  it("getStep should return undefined for unknown id", () => {
    expect(wf.getStep("z")).toBeUndefined();
  });

  it("getEntryStep should return the entry step", () => {
    const entry = wf.getEntryStep();
    expect(entry.id).toBe("a");
  });

  it("getNextSteps should return steps that depend on given step", () => {
    const next = wf.getNextSteps("a");
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe("b");
  });

  it("getNextSteps should return empty array for exit step", () => {
    expect(wf.getNextSteps("c")).toHaveLength(0);
  });

  it("getDependencies should return dependency steps", () => {
    const deps = wf.getDependencies("b");
    expect(deps).toHaveLength(1);
    expect(deps[0].id).toBe("a");
  });

  it("getDependencies should return empty array for entry step", () => {
    expect(wf.getDependencies("a")).toHaveLength(0);
  });

  it("getDependencies should return empty array for unknown step", () => {
    expect(wf.getDependencies("unknown")).toHaveLength(0);
  });
});

// ==================== Workflow - Execution Logic ====================

describe("Workflow - Execution Logic", () => {
  it("canExecute returns true when all dependencies completed", () => {
    const steps = [
      makeStepConfig({ id: "a", dependsOn: [] }),
      makeStepConfig({ id: "b", dependsOn: ["a"] }),
    ];
    const wf = new Workflow(makeWorkflowConfig(steps));

    expect(wf.canExecute("a", [])).toBe(true);
    expect(wf.canExecute("b", [])).toBe(false);
    expect(wf.canExecute("b", ["a"])).toBe(true);
  });

  it("canExecute returns false for unknown step id", () => {
    const steps = [makeStepConfig({ id: "a" })];
    const wf = new Workflow(makeWorkflowConfig(steps));
    expect(wf.canExecute("unknown", [])).toBe(false);
  });

  it("getExecutableSteps returns only pending steps with completed dependencies", () => {
    const steps = [
      makeStepConfig({ id: "a", dependsOn: [] }),
      makeStepConfig({ id: "b", dependsOn: ["a"] }),
      makeStepConfig({ id: "c", dependsOn: ["a"] }),
    ];
    const wf = new Workflow(makeWorkflowConfig(steps));

    const executableAtStart = wf.getExecutableSteps([]);
    expect(executableAtStart.map((s) => s.id)).toEqual(["a"]);

    const executableAfterA = wf.getExecutableSteps(["a"]);
    const ids = executableAfterA.map((s) => s.id).sort();
    expect(ids).toEqual(["b", "c"]);
  });

  it("getExecutableSteps returns empty when all steps complete", () => {
    const steps = [makeStepConfig({ id: "a" })];
    const wf = new Workflow(makeWorkflowConfig(steps));
    expect(wf.getExecutableSteps(["a"])).toHaveLength(0);
  });
});

// ==================== Workflow - Validation ====================

describe("Workflow - Validation", () => {
  it("should be valid for a correctly defined workflow", () => {
    const steps = [
      makeStepConfig({ id: "a", dependsOn: [] }),
      makeStepConfig({ id: "b", dependsOn: ["a"] }),
    ];
    const wf = new Workflow(makeWorkflowConfig(steps));
    const result = wf.validate();

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should report INVALID_DEPENDENCY error for missing dep", () => {
    const steps = [
      makeStepConfig({ id: "a", dependsOn: [] }),
      makeStepConfig({ id: "b", dependsOn: ["nonexistent"] }),
    ];
    const wf = new Workflow(makeWorkflowConfig(steps));
    const result = wf.validate();

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_DEPENDENCY")).toBe(
      true,
    );
  });

  it("should warn ISOLATED_STEP for isolated non-entry steps", () => {
    const steps = [
      makeStepConfig({ id: "a", dependsOn: [] }),
      makeStepConfig({ id: "b", dependsOn: [] }), // isolated, not entry
    ];
    // b has no deps so it would be detected as entry step if entryStepId not set
    // We force entry to "a" so "b" becomes isolated
    const wf = new Workflow(makeWorkflowConfig(steps, { entryStepId: "a" }));
    const result = wf.validate();

    expect(result.warnings.some((w) => w.code === "ISOLATED_STEP")).toBe(true);
  });

  it("should warn MISSING_REVIEW_CONFIG for review step without config", () => {
    const steps = [makeStepConfig({ id: "a", dependsOn: [], type: "review" })];
    const wf = new Workflow(makeWorkflowConfig(steps));
    const result = wf.validate();

    expect(
      result.warnings.some((w) => w.code === "MISSING_REVIEW_CONFIG"),
    ).toBe(true);
  });
});

// ==================== Workflow - Topological Order ====================

describe("Workflow - getTopologicalOrder", () => {
  it("should return topological order for linear chain", () => {
    const steps = [
      makeStepConfig({ id: "a", dependsOn: [] }),
      makeStepConfig({ id: "b", dependsOn: ["a"] }),
      makeStepConfig({ id: "c", dependsOn: ["b"] }),
    ];
    const wf = new Workflow(makeWorkflowConfig(steps));
    const order = wf.getTopologicalOrder();

    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
  });

  it("should handle parallel branches", () => {
    const steps = [
      makeStepConfig({ id: "a", dependsOn: [] }),
      makeStepConfig({ id: "b", dependsOn: ["a"] }),
      makeStepConfig({ id: "c", dependsOn: ["a"] }),
      makeStepConfig({ id: "d", dependsOn: ["b", "c"] }),
    ];
    const wf = new Workflow(makeWorkflowConfig(steps));
    const order = wf.getTopologicalOrder();

    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("c"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("d"));
    expect(order.indexOf("c")).toBeLessThan(order.indexOf("d"));
  });
});

// ==================== Workflow - toJSON ====================

describe("Workflow - toJSON", () => {
  it("should serialize to config format", () => {
    const steps = [
      makeStepConfig({ id: "a" }),
      makeStepConfig({ id: "b", dependsOn: ["a"] }),
    ];
    const wf = new Workflow(
      makeWorkflowConfig(steps, { timeout: 60000, metadata: { env: "test" } }),
    );
    const json = wf.toJSON();

    expect(json.id).toBe("wf-1");
    expect(json.steps).toHaveLength(2);
    expect(json.timeout).toBe(60000);
    expect(json.metadata).toEqual({ env: "test" });
  });
});

// ==================== WorkflowBuilder ====================

describe("WorkflowBuilder", () => {
  it("should build a valid workflow with chained methods", () => {
    const wf = new WorkflowBuilder()
      .setId("wf-builder")
      .setName("Builder Workflow")
      .setType("sequential")
      .addStep(makeStepConfig({ id: "s1" }))
      .build();

    expect(wf.id).toBe("wf-builder");
    expect(wf.name).toBe("Builder Workflow");
    expect(wf.steps).toHaveLength(1);
  });

  it("addSequentialStep should auto-link to previous step", () => {
    const builder = new WorkflowBuilder()
      .setId("wf-seq")
      .setName("Seq WF")
      .addSequentialStep({
        id: "s1",
        name: "Step 1",
        type: "task",
        executorRoles: ["researcher"],
      })
      .addSequentialStep({
        id: "s2",
        name: "Step 2",
        type: "task",
        executorRoles: ["writer"],
      });

    const wf = builder.build();
    expect(wf.getStep("s2")!.dependsOn).toContain("s1");
  });

  it("addSequentialStep first step has no dependencies", () => {
    const wf = new WorkflowBuilder()
      .setId("wf-1")
      .setName("WF")
      .addSequentialStep({
        id: "first",
        name: "First",
        type: "task",
        executorRoles: ["researcher"],
      })
      .build();

    expect(wf.getStep("first")!.dependsOn).toHaveLength(0);
  });

  it("should throw if id is missing", () => {
    expect(() =>
      new WorkflowBuilder()
        .setName("No ID")
        .addStep(makeStepConfig({ id: "s1" }))
        .build(),
    ).toThrow("Workflow id is required");
  });

  it("should throw if name is missing", () => {
    expect(() =>
      new WorkflowBuilder()
        .setId("wf-1")
        .addStep(makeStepConfig({ id: "s1" }))
        .build(),
    ).toThrow("Workflow name is required");
  });

  it("should throw if no steps added", () => {
    expect(() =>
      new WorkflowBuilder().setId("wf-1").setName("WF").build(),
    ).toThrow("Workflow must have at least one step");
  });

  it("setTimeout should be applied to built workflow", () => {
    const wf = new WorkflowBuilder()
      .setId("wf-1")
      .setName("WF")
      .setTimeout(30000)
      .addStep(makeStepConfig({ id: "s1" }))
      .build();

    expect(wf.timeout).toBe(30000);
  });

  it("setEntryStep should use explicit entry step", () => {
    const wf = new WorkflowBuilder()
      .setId("wf-1")
      .setName("WF")
      .setEntryStep("s2")
      .addStep(makeStepConfig({ id: "s1" }))
      .addStep(makeStepConfig({ id: "s2" }))
      .build();

    expect(wf.entryStepId).toBe("s2");
  });

  it("createWorkflowBuilder factory should return WorkflowBuilder instance", () => {
    const builder = createWorkflowBuilder();
    expect(builder).toBeInstanceOf(WorkflowBuilder);
  });

  it("createWorkflow factory should return Workflow instance", () => {
    const steps = [makeStepConfig({ id: "s1" })];
    const wf = createWorkflow(makeWorkflowConfig(steps));
    expect(wf).toBeInstanceOf(Workflow);
  });
});
