/**
 * Unit tests for AdaptiveReplannerService
 */

import { Logger } from "@nestjs/common";
import {
  AdaptiveReplannerService,
  ReplanTrigger,
  ReplanContext,
  ReplanStep,
  ReplanResult,
  StepExecutionResult,
} from "../adaptive-replanner.service";
import { ExecutionStep, MissionExecutionPlan } from "../orchestrator.interface";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeService(): AdaptiveReplannerService {
  jest.spyOn(Logger.prototype, "log").mockImplementation();
  jest.spyOn(Logger.prototype, "warn").mockImplementation();
  jest.spyOn(Logger.prototype, "debug").mockImplementation();
  return new AdaptiveReplannerService();
}

function makeStep(
  id: string,
  status: ReplanStep["status"] = "pending",
  dependencies?: string[],
): ReplanStep {
  return {
    id,
    name: `Step ${id}`,
    description: `Description for ${id}`,
    status,
    dependencies,
  };
}

function makePlan(steps: ReplanStep[]): ReplanContext {
  const completed = steps.filter((s) => s.status === "completed").length;
  return { steps, totalSteps: steps.length, completedSteps: completed };
}

function makeTrigger(
  type: ReplanTrigger["type"],
  taskId = "step-1",
  overrides: Partial<ReplanTrigger> = {},
): ReplanTrigger {
  return { type, taskId, details: "test details", ...overrides };
}

const NO_HISTORY: StepExecutionResult[] = [];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AdaptiveReplannerService", () => {
  let service: AdaptiveReplannerService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  // =========================================================================
  // shouldReplan()
  // =========================================================================

  describe("shouldReplan()", () => {
    // -----------------------------------------------------------------------
    // task_failed
    // -----------------------------------------------------------------------

    describe("task_failed", () => {
      it("returns true when failed step has pending dependents", () => {
        const plan = makePlan([
          makeStep("step-1", "failed"),
          makeStep("step-2", "pending", ["step-1"]),
        ]);
        const trigger = makeTrigger("task_failed", "step-1");

        expect(service.shouldReplan(trigger, plan, NO_HISTORY)).toBe(true);
      });

      it("returns false when failed step has no pending dependents", () => {
        const plan = makePlan([
          makeStep("step-1", "failed"),
          makeStep("step-2", "completed"), // not pending
        ]);
        const trigger = makeTrigger("task_failed", "step-1");

        expect(service.shouldReplan(trigger, plan, NO_HISTORY)).toBe(false);
      });

      it("returns false when failed step is not found in the plan", () => {
        const plan = makePlan([makeStep("step-2", "pending")]);
        const trigger = makeTrigger("task_failed", "nonexistent-step");

        expect(service.shouldReplan(trigger, plan, NO_HISTORY)).toBe(false);
      });
    });

    // -----------------------------------------------------------------------
    // quality_low
    // -----------------------------------------------------------------------

    describe("quality_low", () => {
      it("returns true when qualityScore < 40", () => {
        const plan = makePlan([makeStep("step-1", "completed")]);
        const trigger = makeTrigger("quality_low", "step-1", {
          qualityScore: 35,
        });

        expect(service.shouldReplan(trigger, plan, NO_HISTORY)).toBe(true);
      });

      it("returns false when qualityScore >= 40", () => {
        const plan = makePlan([makeStep("step-1", "completed")]);
        const trigger = makeTrigger("quality_low", "step-1", {
          qualityScore: 40,
        });

        expect(service.shouldReplan(trigger, plan, NO_HISTORY)).toBe(false);
      });

      it("returns false when qualityScore is undefined", () => {
        const plan = makePlan([makeStep("step-1", "completed")]);
        const trigger = makeTrigger("quality_low", "step-1");
        // qualityScore not set

        expect(service.shouldReplan(trigger, plan, NO_HISTORY)).toBe(false);
      });
    });

    // -----------------------------------------------------------------------
    // new_information
    // -----------------------------------------------------------------------

    describe("new_information", () => {
      it("always returns true", () => {
        const plan = makePlan([makeStep("step-1", "completed")]);
        const trigger = makeTrigger("new_information", "step-1");

        expect(service.shouldReplan(trigger, plan, NO_HISTORY)).toBe(true);
      });
    });

    // -----------------------------------------------------------------------
    // budget_exceeded
    // -----------------------------------------------------------------------

    describe("budget_exceeded", () => {
      it("returns true when there are multiple pending steps", () => {
        const plan = makePlan([
          makeStep("step-1", "pending"),
          makeStep("step-2", "pending"),
          makeStep("step-3", "pending"),
        ]);
        const trigger = makeTrigger("budget_exceeded", "step-1");

        expect(service.shouldReplan(trigger, plan, NO_HISTORY)).toBe(true);
      });

      it("returns false when there is only 1 pending step", () => {
        const plan = makePlan([
          makeStep("step-1", "completed"),
          makeStep("step-2", "pending"),
        ]);
        const trigger = makeTrigger("budget_exceeded", "step-1");

        expect(service.shouldReplan(trigger, plan, NO_HISTORY)).toBe(false);
      });
    });
  });

  // =========================================================================
  // replan()
  // =========================================================================

  describe("replan()", () => {
    // -----------------------------------------------------------------------
    // task_failed → retry step added, dependents in removedSteps
    // -----------------------------------------------------------------------

    describe("task_failed", () => {
      it("adds a retry step and lists dependent step IDs in removedSteps", () => {
        const plan = makePlan([
          makeStep("step-1", "failed"),
          makeStep("step-2", "pending", ["step-1"]),
          makeStep("step-3", "pending", ["step-1"]),
        ]);
        const trigger = makeTrigger("task_failed", "step-1");

        const result = service.replan(trigger, plan, NO_HISTORY);

        expect(result.replanned).toBe(true);
        expect(result.addedSteps).toHaveLength(1);
        expect(result.addedSteps[0].name).toContain("step-1");
        expect(result.removedSteps).toContain("step-2");
        expect(result.removedSteps).toContain("step-3");
      });
    });

    // -----------------------------------------------------------------------
    // quality_low → revision step added
    // -----------------------------------------------------------------------

    describe("quality_low", () => {
      it("adds a revision step with dependency on the low-quality step", () => {
        const plan = makePlan([makeStep("step-1", "completed")]);
        const trigger = makeTrigger("quality_low", "step-1", {
          qualityScore: 25,
        });

        const result = service.replan(trigger, plan, NO_HISTORY);

        expect(result.replanned).toBe(true);
        expect(result.addedSteps).toHaveLength(1);
        expect(result.addedSteps[0].dependencies).toContain("step-1");
        expect(result.removedSteps).toHaveLength(0);
        expect(result.modifiedSteps).toHaveLength(0);
      });
    });

    // -----------------------------------------------------------------------
    // budget_exceeded → keeps <= 2 pending, rest removed
    // -----------------------------------------------------------------------

    describe("budget_exceeded", () => {
      it("removes all pending steps beyond the first 2", () => {
        const plan = makePlan([
          makeStep("step-1", "pending"),
          makeStep("step-2", "pending"),
          makeStep("step-3", "pending"),
          makeStep("step-4", "pending"),
        ]);
        const trigger = makeTrigger("budget_exceeded", "step-1");

        const result = service.replan(trigger, plan, NO_HISTORY);

        expect(result.replanned).toBe(true);
        // step-3 and step-4 should be removed (indices 2 and 3)
        expect(result.removedSteps).toContain("step-3");
        expect(result.removedSteps).toContain("step-4");
        expect(result.removedSteps).not.toContain("step-1");
        expect(result.removedSteps).not.toContain("step-2");
      });

      it("returns replanned=false when there are <= 2 pending steps", () => {
        const plan = makePlan([
          makeStep("step-1", "pending"),
          makeStep("step-2", "pending"),
        ]);
        const trigger = makeTrigger("budget_exceeded", "step-1");

        const result = service.replan(trigger, plan, NO_HISTORY);

        expect(result.replanned).toBe(false);
        expect(result.removedSteps).toHaveLength(0);
      });
    });

    // -----------------------------------------------------------------------
    // new_information → pending steps in modifiedSteps
    // -----------------------------------------------------------------------

    describe("new_information", () => {
      it("marks all pending steps as modified for re-evaluation", () => {
        const plan = makePlan([
          makeStep("step-1", "completed"),
          makeStep("step-2", "pending"),
          makeStep("step-3", "pending"),
        ]);
        const trigger = makeTrigger("new_information", "step-1");

        const result = service.replan(trigger, plan, NO_HISTORY);

        expect(result.replanned).toBe(true);
        const modifiedIds = result.modifiedSteps.map((m) => m.stepId);
        expect(modifiedIds).toContain("step-2");
        expect(modifiedIds).toContain("step-3");
        expect(modifiedIds).not.toContain("step-1"); // completed, not pending
      });

      it("returns replanned=false when there are no pending steps", () => {
        const plan = makePlan([
          makeStep("step-1", "completed"),
          makeStep("step-2", "completed"),
        ]);
        const trigger = makeTrigger("new_information", "step-1");

        const result = service.replan(trigger, plan, NO_HISTORY);

        expect(result.replanned).toBe(false);
        expect(result.modifiedSteps).toHaveLength(0);
      });
    });
  });

  describe("applyToPlan() — T7", () => {
    let service: AdaptiveReplannerService;

    beforeEach(() => {
      service = makeService();
    });

    function execStep(id: string, dependencies: string[] = []): ExecutionStep {
      return {
        id,
        name: id,
        description: id,
        executor: "exec",
        type: "task",
        dependencies,
        estimatedDuration: 1000,
        estimatedCost: 1,
      };
    }
    function plan(steps: ExecutionStep[]): MissionExecutionPlan {
      return { steps } as MissionExecutionPlan;
    }
    function result(over: Partial<ReplanResult>): ReplanResult {
      return {
        replanned: true,
        addedSteps: [],
        removedSteps: [],
        modifiedSteps: [],
        reasoning: "test",
        ...over,
      };
    }
    const addStep = (id: string, dependencies: string[] = []): ReplanStep => ({
      id,
      name: id,
      description: id,
      status: "pending",
      dependencies,
    });

    it("removes pending steps but never completed or running ones", () => {
      const p = plan([execStep("a"), execStep("b"), execStep("c")]);
      const out = service.applyToPlan(
        p,
        result({ removedSteps: ["a", "b", "c"] }),
        {
          completedStepIds: new Set(["a"]),
          runningStepIds: new Set(["b"]),
        },
      );
      // a completed, b running → kept; only c removed
      expect(out.removed).toEqual(["c"]);
      expect(out.skipped).toEqual(expect.arrayContaining(["a", "b"]));
      expect(p.steps.map((s) => s.id).sort()).toEqual(["a", "b"]);
    });

    it("adds a step with resolvable deps and maps it to an ExecutionStep", () => {
      const p = plan([execStep("a")]);
      const out = service.applyToPlan(
        p,
        result({ addedSteps: [addStep("retry-a", [])] }),
        { completedStepIds: new Set(), runningStepIds: new Set() },
      );
      expect(out.added).toEqual(["retry-a"]);
      const added = p.steps.find((s) => s.id === "retry-a");
      expect(added?.type).toBe("task");
      expect(added?.executor).toBe(""); // no assignee → leader fallback downstream
      expect(added?.dependencies).toEqual([]);
    });

    it("treats a completed step as a resolvable dependency", () => {
      const p = plan([execStep("a")]);
      const out = service.applyToPlan(
        p,
        result({ addedSteps: [addStep("rev", ["done-step"])] }),
        {
          completedStepIds: new Set(["done-step"]),
          runningStepIds: new Set(),
        },
      );
      expect(out.added).toEqual(["rev"]);
    });

    it("skips an added step whose dependency cannot be resolved", () => {
      const p = plan([execStep("a")]);
      const out = service.applyToPlan(
        p,
        result({ addedSteps: [addStep("x", ["ghost"])] }),
        { completedStepIds: new Set(), runningStepIds: new Set() },
      );
      expect(out.added).toEqual([]);
      expect(out.skipped).toEqual(["x"]);
      expect(p.steps.map((s) => s.id)).toEqual(["a"]);
    });

    it("skips an added step with a duplicate id", () => {
      const p = plan([execStep("a")]);
      const out = service.applyToPlan(
        p,
        result({ addedSteps: [addStep("a", [])] }),
        { completedStepIds: new Set(), runningStepIds: new Set() },
      );
      expect(out.added).toEqual([]);
      expect(out.skipped).toEqual(["a"]);
      expect(p.steps).toHaveLength(1);
    });

    it("skips a self-referential added step (no cycle introduced)", () => {
      const p = plan([execStep("a")]);
      const out = service.applyToPlan(
        p,
        result({ addedSteps: [addStep("self", ["self"])] }),
        { completedStepIds: new Set(), runningStepIds: new Set() },
      );
      expect(out.added).toEqual([]);
      expect(p.steps.map((s) => s.id)).toEqual(["a"]);
    });
  });
});
