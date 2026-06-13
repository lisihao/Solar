/**
 * MissionOrchestrator — unit tests
 *
 * Covers orchestrate() branches:
 * - Empty enqueueTaskIds (no enqueueMany called)
 * - Non-empty enqueueTaskIds (enqueueMany called)
 * - isFinal on first iteration → onFinalize called, returns stats
 * - No dequeued task + awaitingHuman → sleep and continue
 * - No dequeued task + not waiting (deadlock) → onFinalize, return
 * - Dequeued task not found in store → skip, continue
 * - No protocol for task type → mark FAILED, continue
 * - runner.execute success + onTaskCompleted called
 * - runner.execute throws HumanInLoopPause → log + continue
 * - runner.execute throws other error → log + continue (no rethrow)
 * - Hits maxIterations → force finalize and return
 */

import {
  MissionOrchestrator,
  type OrchestrateOptions,
} from "../task-execution-orchestrator";
import { HumanInLoopPause } from "@/modules/ai-harness/runner/env/types";
import type {
  ReActRunner,
  ReActStores,
} from "@/modules/ai-harness/runner/env/react-runner";
import type {
  TaskQueue,
  QueueStats,
} from "@/modules/ai-harness/runner/env/task-queue-interface";
import type { ProtocolRegistry } from "@/modules/ai-harness/runner/env/protocol-registry-interface";
import type { AgentTask } from "@/modules/ai-harness/runner/env/types";

// ─── Minimal fakes ────────────────────────────────────────────────────────────

type Meta = Record<string, unknown>;

function makeStats(overrides?: Partial<QueueStats>): QueueStats {
  return {
    total: 1,
    queued: 0,
    running: 0,
    completed: 1,
    failed: 0,
    cancelled: 0,
    awaitingHuman: 0,
    scheduled: 0,
    pending: 0,
    ...overrides,
  };
}

function makeTask(type = "write"): AgentTask<Meta> {
  return {
    id: "task-1",
    type,
    status: "QUEUED",
    input: { goal: "test goal" },
    metadata: {},
    dependencies: [],
    createdAt: new Date(),
  } as unknown as AgentTask<Meta>;
}

function makeRunner(impl?: Partial<ReActRunner>): jest.Mocked<ReActRunner> {
  return {
    execute: jest.fn().mockResolvedValue(undefined),
    ...impl,
  } as unknown as jest.Mocked<ReActRunner>;
}

function makeOrchestrator(
  runner?: jest.Mocked<ReActRunner>,
): MissionOrchestrator {
  return new MissionOrchestrator(runner ?? makeRunner());
}

function makeTaskQueue(impl?: Partial<TaskQueue>): jest.Mocked<TaskQueue> {
  return {
    enqueueMany: jest.fn().mockResolvedValue(undefined),
    dequeueNext: jest.fn().mockResolvedValue(null),
    getStats: jest.fn().mockResolvedValue(makeStats()),
    isFinal: jest.fn().mockReturnValue(true),
    ...impl,
  } as unknown as jest.Mocked<TaskQueue>;
}

function makeStores(
  taskOverrides?: Partial<{
    load: jest.Mock;
    updateStatus: jest.Mock;
  }>,
): ReActStores<Meta> {
  return {
    taskStore: {
      load: jest.fn().mockResolvedValue(makeTask()),
      updateStatus: jest.fn().mockResolvedValue(undefined),
      ...taskOverrides,
    },
    stepStore: {},
    workingMemory: {},
  } as unknown as ReActStores<Meta>;
}

function makeProtocols(
  hasProtocol = true,
): jest.Mocked<ProtocolRegistry<Meta>> {
  return {
    get: jest
      .fn()
      .mockReturnValue(hasProtocol ? { name: "write-protocol" } : null),
    register: jest.fn(),
  } as unknown as jest.Mocked<ProtocolRegistry<Meta>>;
}

const baseOptions: OrchestrateOptions<Meta> = {
  scope: "mission-test",
  scopeMetadata: {},
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("MissionOrchestrator.orchestrate — empty enqueue list", () => {
  it("does not call enqueueMany when enqueueTaskIds is empty", async () => {
    const queue = makeTaskQueue();
    const orc = makeOrchestrator();

    await orc.orchestrate(
      baseOptions,
      [],
      makeStores(),
      queue,
      makeProtocols(),
      jest.fn(),
      jest.fn(),
    );

    expect(queue.enqueueMany).not.toHaveBeenCalled();
  });
});

describe("MissionOrchestrator.orchestrate — enqueue and immediate final", () => {
  it("calls enqueueMany and onFinalize when isFinal on first check", async () => {
    const queue = makeTaskQueue({
      isFinal: jest.fn().mockReturnValue(true),
    });
    const onFinalize = jest.fn().mockResolvedValue(undefined);
    const orc = makeOrchestrator();

    const stats = await orc.orchestrate(
      { ...baseOptions, onFinalize },
      ["task-a", "task-b"],
      makeStores(),
      queue,
      makeProtocols(),
      jest.fn(),
      jest.fn(),
    );

    expect(queue.enqueueMany).toHaveBeenCalledWith(["task-a", "task-b"]);
    expect(onFinalize).toHaveBeenCalledTimes(1);
    expect(stats.completed).toBe(1);
  });
});

describe("MissionOrchestrator.orchestrate — runner.execute success", () => {
  it("calls onTaskCompleted after successful runner.execute", async () => {
    let callCount = 0;
    const queue = makeTaskQueue({
      isFinal: jest.fn().mockImplementation(() => callCount++ > 0), // final after first task
      dequeueNext: jest
        .fn()
        .mockResolvedValueOnce("task-1")
        .mockResolvedValue(null),
    });

    const onTaskCompleted = jest.fn().mockResolvedValue(undefined);
    const runner = makeRunner();
    const orc = makeOrchestrator(runner);

    await orc.orchestrate(
      { ...baseOptions, onTaskCompleted },
      [],
      makeStores(),
      queue,
      makeProtocols(),
      jest.fn(),
      jest.fn(),
    );

    expect(runner.execute).toHaveBeenCalled();
    expect(onTaskCompleted).toHaveBeenCalled();
  });
});

describe("MissionOrchestrator.orchestrate — no protocol for task", () => {
  it("marks task FAILED and continues when no protocol registered", async () => {
    let callCount = 0;
    const queue = makeTaskQueue({
      isFinal: jest.fn().mockImplementation(() => callCount++ > 0),
      dequeueNext: jest
        .fn()
        .mockResolvedValueOnce("task-1")
        .mockResolvedValue(null),
    });

    const stores = makeStores();
    const orc = makeOrchestrator();

    await orc.orchestrate(
      baseOptions,
      [],
      stores,
      queue,
      makeProtocols(false), // no protocol
      jest.fn(),
      jest.fn(),
    );

    expect(stores.taskStore.updateStatus).toHaveBeenCalledWith(
      "task-1",
      "FAILED",
      expect.objectContaining({
        resultSummary: expect.stringContaining("no protocol"),
      }),
    );
  });
});

describe("MissionOrchestrator.orchestrate — task not found in store", () => {
  it("skips and continues when taskStore.load returns null", async () => {
    let callCount = 0;
    const queue = makeTaskQueue({
      isFinal: jest.fn().mockImplementation(() => callCount++ > 0),
      dequeueNext: jest
        .fn()
        .mockResolvedValueOnce("missing-task")
        .mockResolvedValue(null),
    });

    const stores = makeStores({ load: jest.fn().mockResolvedValue(null) });
    const runner = makeRunner();
    const orc = makeOrchestrator(runner);

    await orc.orchestrate(
      baseOptions,
      [],
      stores,
      queue,
      makeProtocols(),
      jest.fn(),
      jest.fn(),
    );

    // runner.execute should NOT be called since task was not found
    expect(runner.execute).not.toHaveBeenCalled();
  });
});

describe("MissionOrchestrator.orchestrate — runner throws HumanInLoopPause", () => {
  it("continues loop without rethrowing when HumanInLoopPause raised", async () => {
    let callCount = 0;
    const queue = makeTaskQueue({
      isFinal: jest.fn().mockImplementation(() => callCount++ > 1),
      dequeueNext: jest
        .fn()
        .mockResolvedValueOnce("task-1")
        .mockResolvedValue(null),
    });

    const runner = makeRunner({
      execute: jest
        .fn()
        .mockRejectedValue(new HumanInLoopPause("task-1", "Approve?")),
    });
    const orc = makeOrchestrator(runner);

    // Should not throw
    await expect(
      orc.orchestrate(
        baseOptions,
        [],
        makeStores(),
        queue,
        makeProtocols(),
        jest.fn(),
        jest.fn(),
      ),
    ).resolves.toBeDefined();
  });
});

describe("MissionOrchestrator.orchestrate — runner throws generic error", () => {
  it("logs error and continues loop without rethrowing", async () => {
    let callCount = 0;
    const queue = makeTaskQueue({
      isFinal: jest.fn().mockImplementation(() => callCount++ > 1),
      dequeueNext: jest
        .fn()
        .mockResolvedValueOnce("task-1")
        .mockResolvedValue(null),
    });

    const runner = makeRunner({
      execute: jest.fn().mockRejectedValue(new Error("unexpected crash")),
    });
    const orc = makeOrchestrator(runner);

    await expect(
      orc.orchestrate(
        baseOptions,
        [],
        makeStores(),
        queue,
        makeProtocols(),
        jest.fn(),
        jest.fn(),
      ),
    ).resolves.toBeDefined();
  });
});

describe("MissionOrchestrator.orchestrate — no dequeued task, waiting", () => {
  it("sleeps and continues when awaitingHuman > 0 (short idleWaitMs)", async () => {
    let iterCount = 0;
    const queue = makeTaskQueue({
      // iteration 0: awaitingHuman=1, dequeueNext=null
      // iteration 1: final
      isFinal: jest.fn().mockImplementation(() => iterCount++ > 0),
      dequeueNext: jest.fn().mockResolvedValue(null),
      getStats: jest
        .fn()
        .mockResolvedValueOnce(makeStats({ awaitingHuman: 1, completed: 0 }))
        .mockResolvedValue(makeStats({ completed: 1 })),
    });

    const orc = makeOrchestrator();

    await orc.orchestrate(
      { ...baseOptions, idleWaitMs: 1 }, // very short sleep
      [],
      makeStores(),
      queue,
      makeProtocols(),
      jest.fn(),
      jest.fn(),
    );

    // Should have iterated at least twice (sleep + then final)
    expect(queue.getStats).toHaveBeenCalledTimes(2);
  });
});

describe("MissionOrchestrator.orchestrate — deadlock: no task but not final", () => {
  it("calls onFinalize and returns when queue is stuck (no tasks, not final)", async () => {
    const queue = makeTaskQueue({
      isFinal: jest.fn().mockImplementation(() => {
        // Never final
        return false;
      }),
      dequeueNext: jest.fn().mockResolvedValue(null),
      getStats: jest.fn().mockResolvedValue(
        makeStats({
          completed: 0,
          awaitingHuman: 0,
          running: 0,
          scheduled: 0,
        }),
      ),
    });

    const onFinalize = jest.fn().mockResolvedValue(undefined);
    const orc = makeOrchestrator();

    await orc.orchestrate(
      { ...baseOptions, onFinalize },
      [],
      makeStores(),
      queue,
      makeProtocols(),
      jest.fn(),
      jest.fn(),
    );

    expect(onFinalize).toHaveBeenCalled();
  });
});

describe("MissionOrchestrator.orchestrate — hits maxIterations", () => {
  it("force-finalizes after maxIterations loops", async () => {
    // Always returns a task + never final → will hit max
    const queue = makeTaskQueue({
      isFinal: jest.fn().mockReturnValue(false),
      dequeueNext: jest.fn().mockResolvedValue("task-1"),
    });

    const onFinalize = jest.fn().mockResolvedValue(undefined);
    const runner = makeRunner();
    const orc = makeOrchestrator(runner);

    await orc.orchestrate(
      { ...baseOptions, maxIterations: 2, onFinalize },
      [],
      makeStores(),
      queue,
      makeProtocols(),
      jest.fn(),
      jest.fn(),
    );

    expect(onFinalize).toHaveBeenCalled();
    // runner.execute should have been called maxIterations times
    expect(runner.execute).toHaveBeenCalledTimes(2);
  });
});
