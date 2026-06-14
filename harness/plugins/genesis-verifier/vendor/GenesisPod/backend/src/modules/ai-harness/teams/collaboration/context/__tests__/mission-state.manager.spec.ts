/**
 * MissionStateManager Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { MissionStateManager } from "@/modules/ai-harness/facade";
import { AgentFacade } from "@/modules/ai-harness/facade";
import { StateCategory } from "@/modules/ai-harness/facade";

const mockStats = {
  activeCounts: {
    [StateCategory.TASK]: 2,
    [StateCategory.WORKFLOW]: 1,
    [StateCategory.REVISION]: 0,
  },
  oldestAges: {
    [StateCategory.TASK]: 5000,
    [StateCategory.WORKFLOW]: 3000,
    [StateCategory.REVISION]: null,
  },
};

const mockExecStateManager = {
  startTask: jest.fn().mockReturnValue(true),
  finishTask: jest.fn(),
  isTaskExecuting: jest.fn().mockReturnValue(false),
  startWorkflow: jest.fn().mockReturnValue(true),
  finishWorkflow: jest.fn(),
  isWorkflowExecuting: jest.fn().mockReturnValue(false),
  startRevision: jest.fn().mockReturnValue(true),
  finishRevision: jest.fn(),
  isRevisionInProgress: jest.fn().mockReturnValue(false),
  getStats: jest.fn().mockReturnValue(mockStats),
  getExecutingTaskIds: jest.fn().mockReturnValue(["task-1", "task-2"]),
  getExecutingMissionIds: jest.fn().mockReturnValue(["mission-1"]),
  getRevisingTaskIds: jest.fn().mockReturnValue([]),
  forceCleanAll: jest.fn(),
  triggerCleanup: jest
    .fn()
    .mockReturnValue({ before: mockStats, after: mockStats }),
};

describe("MissionStateManager", () => {
  let service: MissionStateManager;
  let aiFacade: { execStateManager: typeof mockExecStateManager | null }; // shape matches AgentFacade.execStateManager

  beforeEach(async () => {
    aiFacade = {
      execStateManager: mockExecStateManager,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MissionStateManager,
        { provide: AgentFacade, useValue: aiFacade },
      ],
    }).compile();

    service = module.get<MissionStateManager>(MissionStateManager);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("Task execution state", () => {
    it("startTask should return true when state manager is available", () => {
      const result = service.startTask("task-1", "Write content");
      expect(result).toBe(true);
      expect(mockExecStateManager.startTask).toHaveBeenCalledWith(
        "task-1",
        "Write content",
      );
    });

    it("startTask should return false when execStateManager is null", () => {
      aiFacade.execStateManager = null;
      const result = service.startTask("task-1");
      expect(result).toBe(false);
    });

    it("finishTask should delegate to execStateManager", () => {
      service.finishTask("task-1");
      expect(mockExecStateManager.finishTask).toHaveBeenCalledWith("task-1");
    });

    it("finishTask should not throw when execStateManager is null", () => {
      aiFacade.execStateManager = null;
      expect(() => service.finishTask("task-1")).not.toThrow();
    });

    it("isTaskExecuting should return delegated value", () => {
      mockExecStateManager.isTaskExecuting.mockReturnValue(true);
      const result = service.isTaskExecuting("task-1");
      expect(result).toBe(true);
    });

    it("isTaskExecuting should return false when execStateManager is null", () => {
      aiFacade.execStateManager = null;
      const result = service.isTaskExecuting("task-1");
      expect(result).toBe(false);
    });
  });

  describe("Mission execution state", () => {
    it("startMissionExecution should delegate to startWorkflow", () => {
      const result = service.startMissionExecution(
        "mission-1",
        "Execute tasks",
      );
      expect(result).toBe(true);
      expect(mockExecStateManager.startWorkflow).toHaveBeenCalledWith(
        "mission-1",
        "Execute tasks",
      );
    });

    it("startMissionExecution should return false when execStateManager is null", () => {
      aiFacade.execStateManager = null;
      const result = service.startMissionExecution("mission-1");
      expect(result).toBe(false);
    });

    it("finishMissionExecution should delegate to finishWorkflow", () => {
      service.finishMissionExecution("mission-1");
      expect(mockExecStateManager.finishWorkflow).toHaveBeenCalledWith(
        "mission-1",
      );
    });

    it("isMissionExecuting should return delegated value", () => {
      mockExecStateManager.isWorkflowExecuting.mockReturnValue(true);
      const result = service.isMissionExecuting("mission-1");
      expect(result).toBe(true);
    });

    it("isMissionExecuting should return false when execStateManager is null", () => {
      aiFacade.execStateManager = null;
      const result = service.isMissionExecuting("mission-1");
      expect(result).toBe(false);
    });
  });

  describe("Revision state", () => {
    it("startRevision should delegate to execStateManager", () => {
      const result = service.startRevision("task-1", "Revise chapter 1");
      expect(result).toBe(true);
      expect(mockExecStateManager.startRevision).toHaveBeenCalledWith(
        "task-1",
        "Revise chapter 1",
      );
    });

    it("startRevision should return false when execStateManager is null", () => {
      aiFacade.execStateManager = null;
      const result = service.startRevision("task-1");
      expect(result).toBe(false);
    });

    it("finishRevision should delegate to execStateManager", () => {
      service.finishRevision("task-1");
      expect(mockExecStateManager.finishRevision).toHaveBeenCalledWith(
        "task-1",
      );
    });

    it("isRevisionInProgress should return delegated value", () => {
      mockExecStateManager.isRevisionInProgress.mockReturnValue(true);
      const result = service.isRevisionInProgress("task-1");
      expect(result).toBe(true);
    });

    it("isRevisionInProgress should return false when execStateManager is null", () => {
      aiFacade.execStateManager = null;
      const result = service.isRevisionInProgress("task-1");
      expect(result).toBe(false);
    });
  });

  describe("getStats", () => {
    it("should return StateStats from execStateManager", () => {
      const stats = service.getStats();

      expect(stats).toEqual({
        executingTasks: 2,
        executingMissions: 1,
        revisingTasks: 0,
        oldestTaskAge: 5000,
        oldestMissionAge: 3000,
        oldestRevisionAge: null,
      });
    });

    it("should return zeroed stats when execStateManager is null", () => {
      aiFacade.execStateManager = null;

      const stats = service.getStats();

      expect(stats).toEqual({
        executingTasks: 0,
        executingMissions: 0,
        revisingTasks: 0,
        oldestTaskAge: null,
        oldestMissionAge: null,
        oldestRevisionAge: null,
      });
    });

    it("should return zeroed stats when getStats returns null", () => {
      mockExecStateManager.getStats.mockReturnValue(null);

      const stats = service.getStats();

      expect(stats.executingTasks).toBe(0);
    });
  });

  describe("getExecutingTaskIds", () => {
    it("should return task IDs from execStateManager", () => {
      const ids = service.getExecutingTaskIds();
      expect(ids).toEqual(["task-1", "task-2"]);
    });

    it("should return empty array when execStateManager is null", () => {
      aiFacade.execStateManager = null;
      const ids = service.getExecutingTaskIds();
      expect(ids).toEqual([]);
    });
  });

  describe("getExecutingMissionIds", () => {
    it("should return mission IDs from execStateManager", () => {
      const ids = service.getExecutingMissionIds();
      expect(ids).toEqual(["mission-1"]);
    });

    it("should return empty array when execStateManager is null", () => {
      aiFacade.execStateManager = null;
      const ids = service.getExecutingMissionIds();
      expect(ids).toEqual([]);
    });
  });

  describe("getRevisingTaskIds", () => {
    it("should return revising task IDs from execStateManager", () => {
      const ids = service.getRevisingTaskIds();
      expect(ids).toEqual([]);
    });

    it("should return empty array when execStateManager is null", () => {
      aiFacade.execStateManager = null;
      const ids = service.getRevisingTaskIds();
      expect(ids).toEqual([]);
    });
  });

  describe("forceCleanAll", () => {
    it("should delegate to execStateManager", () => {
      service.forceCleanAll();
      expect(mockExecStateManager.forceCleanAll).toHaveBeenCalled();
    });

    it("should not throw when execStateManager is null", () => {
      aiFacade.execStateManager = null;
      expect(() => service.forceCleanAll()).not.toThrow();
    });
  });

  describe("triggerCleanup", () => {
    it("should return before/after stats", () => {
      const result = service.triggerCleanup();

      expect(result).toHaveProperty("before");
      expect(result).toHaveProperty("after");
      expect(result.before).toHaveProperty("executingTasks");
      expect(result.after).toHaveProperty("executingTasks");
    });

    it("should return zeroed before/after when execStateManager is null", () => {
      aiFacade.execStateManager = null;

      const result = service.triggerCleanup();

      expect(result.before.executingTasks).toBe(0);
      expect(result.after.executingTasks).toBe(0);
    });

    it("should return zeroed before/after when triggerCleanup returns null", () => {
      mockExecStateManager.triggerCleanup.mockReturnValue(null);

      const result = service.triggerCleanup();

      expect(result.before.executingTasks).toBe(0);
      expect(result.after.executingTasks).toBe(0);
    });
  });
});
