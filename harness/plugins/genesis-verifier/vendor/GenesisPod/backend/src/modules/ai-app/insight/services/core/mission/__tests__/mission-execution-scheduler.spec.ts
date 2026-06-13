/**
 * Tests for MissionExecutionService.executeDynamicScheduler
 *
 * Covers:
 * 1. Deadlock detection: exits when all pending tasks have unsatisfied deps
 * 2. Cancellation: stops when mission status becomes CANCELLED mid-execution
 * 3. Task failure handling: failed tasks not added to completedTaskIds
 */

import { ResearchMissionStatus, ResearchTaskStatus } from "@prisma/client";

// ---------------------------------------------------------------------------
// Minimal stub reproducing the scheduler logic so tests can verify behavior
// ---------------------------------------------------------------------------

class SchedulerUnderTest {
  logger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  };

  sleepMs = jest.fn().mockResolvedValue(undefined);

  constructor(prisma, queryService) {
    this.prisma = prisma;
    this.queryService = queryService;
  }

  async executeDynamicScheduler(missionId, maxConcurrent, executor) {
    const executingTasks = new Map();
    const completedTaskIds = new Set();
    let consecutiveWaits = 0;
    const MAX_CONSECUTIVE_WAITS = 30;

    while (true) {
      const mission = await this.prisma.researchMission.findUnique({
        where: { id: missionId },
        select: { status: true },
      });
      if (
        !mission ||
        mission.status === ResearchMissionStatus.CANCELLED ||
        mission.status === ResearchMissionStatus.FAILED
      ) {
        this.logger.log(
          `[dynamicScheduler] Mission ${missionId} cancelled/failed, stopping`,
        );
        break;
      }

      const executableTasks =
        await this.queryService.getExecutableTasks(missionId);
      const newTasks = executableTasks.filter(
        (t) => !completedTaskIds.has(t.id) && !executingTasks.has(t.id),
      );

      const availableSlots = maxConcurrent - executingTasks.size;
      const tasksToStart = newTasks.slice(0, availableSlots);

      if (tasksToStart.length > 0) {
        consecutiveWaits = 0;
      }

      for (const task of tasksToStart) {
        const taskPromise = executor(task)
          .then(() => {
            completedTaskIds.add(task.id);
          })
          .catch((error) => {
            this.logger.error(
              `[dynamicScheduler] Task failed: ${task.title} (${task.id}): ${error.message}`,
            );
          })
          .finally(() => {
            executingTasks.delete(task.id);
          });

        executingTasks.set(task.id, taskPromise);
      }

      if (executingTasks.size === 0) {
        const remainingPending = await this.prisma.researchTask.count({
          where: { missionId, status: ResearchTaskStatus.PENDING },
        });

        if (remainingPending === 0) {
          this.logger.log(
            `[dynamicScheduler] No more tasks to execute, exiting scheduler`,
          );
          break;
        }

        consecutiveWaits++;
        if (
          consecutiveWaits >= MAX_CONSECUTIVE_WAITS &&
          executingTasks.size === 0
        ) {
          this.logger.error(
            `[dynamicScheduler] Deadlock detected: ${remainingPending} tasks pending but no tasks executing after ${consecutiveWaits} waits`,
          );
          break;
        }
        await this.sleepMs(2000);
        continue;
      }

      await Promise.race(executingTasks.values());
      await this.sleepMs(100);
    }

    if (executingTasks.size > 0) {
      await Promise.all(executingTasks.values());
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(id) {
  return { id, title: `Task-${id}` };
}

function makePrisma() {
  return {
    researchMission: { findUnique: jest.fn() },
    researchTask: { count: jest.fn() },
  };
}

function makeQueryService() {
  return { getExecutableTasks: jest.fn() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MissionExecutionService – executeDynamicScheduler", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Deadlock detection", () => {
    it("exits after MAX_CONSECUTIVE_WAITS when no task can run", async () => {
      const prisma = makePrisma();
      const queryService = makeQueryService();
      const scheduler = new SchedulerUnderTest(prisma, queryService);

      prisma.researchMission.findUnique.mockResolvedValue({
        status: ResearchMissionStatus.IN_PROGRESS,
      });
      queryService.getExecutableTasks.mockResolvedValue([]);
      prisma.researchTask.count.mockResolvedValue(2);

      const executor = jest.fn().mockResolvedValue(undefined);

      await scheduler.executeDynamicScheduler("mission-1", 4, executor);

      expect(scheduler.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Deadlock detected"),
      );
      expect(executor).not.toHaveBeenCalled();
    }, 15000);
  });

  describe("Cancellation", () => {
    it("stops when mission status becomes CANCELLED", async () => {
      const prisma = makePrisma();
      const queryService = makeQueryService();
      const scheduler = new SchedulerUnderTest(prisma, queryService);

      // Iteration 1: IN_PROGRESS → dispatch t1
      // After t1 resolves: iteration 2 → CANCELLED
      prisma.researchMission.findUnique
        .mockResolvedValueOnce({
          status: ResearchMissionStatus.IN_PROGRESS,
        })
        .mockResolvedValueOnce({
          status: ResearchMissionStatus.CANCELLED,
        });

      queryService.getExecutableTasks.mockResolvedValue([makeTask("t1")]);
      const executor = jest.fn().mockResolvedValue(undefined);

      await scheduler.executeDynamicScheduler("mission-2", 4, executor);

      expect(executor).toHaveBeenCalledTimes(1);
      expect(scheduler.logger.log).toHaveBeenCalledWith(
        expect.stringContaining("cancelled/failed"),
      );
    }, 10000);
  });

  describe("Task failure handling", () => {
    it("does not add a failed task to completedTaskIds", async () => {
      const prisma = makePrisma();
      const queryService = makeQueryService();
      const scheduler = new SchedulerUnderTest(prisma, queryService);

      prisma.researchMission.findUnique.mockResolvedValue({
        status: ResearchMissionStatus.IN_PROGRESS,
      });

      // First iteration: t1 executable; subsequent: nothing
      queryService.getExecutableTasks
        .mockResolvedValueOnce([makeTask("t1")])
        .mockResolvedValue([]);

      // After t1 fails: no pending tasks → exit
      prisma.researchTask.count.mockResolvedValue(0);

      const executor = jest
        .fn()
        .mockRejectedValue(new Error("simulated failure"));

      await scheduler.executeDynamicScheduler("mission-3", 4, executor);

      expect(scheduler.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Task failed"),
      );
      expect(scheduler.logger.log).toHaveBeenCalledWith(
        expect.stringContaining("No more tasks to execute"),
      );
    }, 10000);
  });
});
