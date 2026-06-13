/**
 * HarnessFacade — branch coverage spec
 *
 * Uncovered branches (0/43 = 0%):
 *   b0-b14  if-blocks in execute() (output/action_executed/error/terminated events)
 *   b7-b9   resume() checkpointService missing, checkpointId vs agentId, null checkpoint
 *   b10-b11 fork() checkpointService missing, null checkpoint
 *   b12-b14 fork() preserveUserId option
 *   b15     replay() eventStore missing
 *
 * Also covers:
 *   b15  cond-expr line=32  (feature optional inject)
 */

import { HarnessFacade } from "../harness.facade";

function makeFactory(
  overrides: {
    create?: jest.Mock;
    createFromCheckpoint?: jest.Mock;
  } = {},
) {
  return {
    create:
      overrides.create ?? jest.fn().mockReturnValue({ execute: jest.fn() }),
    createFromCheckpoint:
      overrides.createFromCheckpoint ?? jest.fn().mockReturnValue({}),
    setSubagentSpawner: jest.fn(),
  } as any;
}

function makeHookRegistry() {
  return {} as any;
}

function makeLoopRegistry() {
  return { register: jest.fn() } as any;
}

async function* makeEventStream(events: any[]) {
  for (const ev of events) {
    yield ev;
  }
}

describe("HarnessFacade", () => {
  describe("createAgent()", () => {
    it("delegates to factory.create()", () => {
      const factory = makeFactory();
      const facade = new HarnessFacade(
        factory,
        makeHookRegistry(),
        makeLoopRegistry(),
      );
      const spec = { identity: {}, loop: "react" } as any;
      facade.createAgent(spec);
      expect(factory.create).toHaveBeenCalledWith(spec);
    });
  });

  describe("execute()", () => {
    it("accumulates output from output events", async () => {
      const agent = {
        execute: jest
          .fn()
          .mockReturnValue(
            makeEventStream([
              { type: "output", payload: { output: "hello world" } },
            ]),
          ),
      };
      const factory = makeFactory({ create: jest.fn().mockReturnValue(agent) });
      const facade = new HarnessFacade(
        factory,
        makeHookRegistry(),
        makeLoopRegistry(),
      );
      const result = await facade.execute({} as any, {} as any);
      expect(result.output).toBe("hello world");
      expect(result.state).toBe("completed");
    });

    it("increments iterations on action_executed event", async () => {
      const agent = {
        execute: jest.fn().mockReturnValue(
          makeEventStream([
            { type: "action_executed", payload: {} },
            { type: "action_executed", payload: {} },
          ]),
        ),
      };
      const factory = makeFactory({ create: jest.fn().mockReturnValue(agent) });
      const facade = new HarnessFacade(
        factory,
        makeHookRegistry(),
        makeLoopRegistry(),
      );
      const result = await facade.execute({} as any, {} as any);
      expect(result.iterations).toBe(2);
    });

    it("sets state=failed on error event", async () => {
      const agent = {
        execute: jest
          .fn()
          .mockReturnValue(
            makeEventStream([{ type: "error", payload: { message: "boom" } }]),
          ),
      };
      const factory = makeFactory({ create: jest.fn().mockReturnValue(agent) });
      const facade = new HarnessFacade(
        factory,
        makeHookRegistry(),
        makeLoopRegistry(),
      );
      const result = await facade.execute({} as any, {} as any);
      expect(result.state).toBe("failed");
    });

    it("sets state=failed on terminated with reason=error", async () => {
      const agent = {
        execute: jest
          .fn()
          .mockReturnValue(
            makeEventStream([
              { type: "terminated", payload: { reason: "error" } },
            ]),
          ),
      };
      const factory = makeFactory({ create: jest.fn().mockReturnValue(agent) });
      const facade = new HarnessFacade(
        factory,
        makeHookRegistry(),
        makeLoopRegistry(),
      );
      const result = await facade.execute({} as any, {} as any);
      expect(result.state).toBe("failed");
    });

    it("sets state=cancelled on terminated with reason=cancelled", async () => {
      const agent = {
        execute: jest
          .fn()
          .mockReturnValue(
            makeEventStream([
              { type: "terminated", payload: { reason: "cancelled" } },
            ]),
          ),
      };
      const factory = makeFactory({ create: jest.fn().mockReturnValue(agent) });
      const facade = new HarnessFacade(
        factory,
        makeHookRegistry(),
        makeLoopRegistry(),
      );
      const result = await facade.execute({} as any, {} as any);
      expect(result.state).toBe("cancelled");
    });

    it("sets state=completed on terminated with reason=budget", async () => {
      const agent = {
        execute: jest
          .fn()
          .mockReturnValue(
            makeEventStream([
              { type: "terminated", payload: { reason: "budget" } },
            ]),
          ),
      };
      const factory = makeFactory({ create: jest.fn().mockReturnValue(agent) });
      const facade = new HarnessFacade(
        factory,
        makeHookRegistry(),
        makeLoopRegistry(),
      );
      const result = await facade.execute({} as any, {} as any);
      expect(result.state).toBe("completed");
    });

    it("handles terminated with unknown reason (stays completed)", async () => {
      const agent = {
        execute: jest
          .fn()
          .mockReturnValue(
            makeEventStream([
              { type: "terminated", payload: { reason: "max_iterations" } },
            ]),
          ),
      };
      const factory = makeFactory({ create: jest.fn().mockReturnValue(agent) });
      const facade = new HarnessFacade(
        factory,
        makeHookRegistry(),
        makeLoopRegistry(),
      );
      const result = await facade.execute({} as any, {} as any);
      expect(result.state).toBe("completed");
    });

    it("handles empty event stream", async () => {
      const agent = {
        execute: jest.fn().mockReturnValue(makeEventStream([])),
      };
      const factory = makeFactory({ create: jest.fn().mockReturnValue(agent) });
      const facade = new HarnessFacade(
        factory,
        makeHookRegistry(),
        makeLoopRegistry(),
      );
      const result = await facade.execute({} as any, {} as any);
      expect(result.output).toBe("");
      expect(result.state).toBe("completed");
    });

    it("aggregates real tokensUsed from action_executed events", async () => {
      const agent = {
        execute: jest.fn().mockReturnValue(
          makeEventStream([
            { type: "action_executed", payload: { tokensUsed: 200 } },
            { type: "action_executed", payload: { tokensUsed: 300 } },
            { type: "output", payload: { output: "done" } },
          ]),
        ),
      };
      const factory = makeFactory({ create: jest.fn().mockReturnValue(agent) });
      const facade = new HarnessFacade(
        factory,
        makeHookRegistry(),
        makeLoopRegistry(),
      );
      const result = await facade.execute({} as any, {} as any);
      expect(result.tokensUsed).toBe(500);
    });

    it("tokensUsed defaults to 0 when no events carry token spend", async () => {
      const agent = {
        execute: jest
          .fn()
          .mockReturnValue(
            makeEventStream([{ type: "output", payload: { output: "done" } }]),
          ),
      };
      const factory = makeFactory({ create: jest.fn().mockReturnValue(agent) });
      const facade = new HarnessFacade(
        factory,
        makeHookRegistry(),
        makeLoopRegistry(),
      );
      const result = await facade.execute({} as any, {} as any);
      expect(result.tokensUsed).toBe(0);
    });
  });

  describe("registerLoop()", () => {
    it("delegates to loopRegistry.register()", () => {
      const loopRegistry = makeLoopRegistry();
      const facade = new HarnessFacade(
        makeFactory(),
        makeHookRegistry(),
        loopRegistry,
      );
      const loop = {} as any;
      facade.registerLoop(loop);
      expect(loopRegistry.register).toHaveBeenCalledWith(loop);
    });
  });

  describe("hooks getter", () => {
    it("returns the hookRegistry", () => {
      const hookRegistry = makeHookRegistry();
      const facade = new HarnessFacade(
        makeFactory(),
        hookRegistry,
        makeLoopRegistry(),
      );
      expect(facade.hooks).toBe(hookRegistry);
    });
  });

  describe("resume()", () => {
    it("throws when checkpointService not wired", async () => {
      const facade = new HarnessFacade(
        makeFactory(),
        makeHookRegistry(),
        makeLoopRegistry(),
      );
      await expect(facade.resume({ checkpointId: "cp1" })).rejects.toThrow(
        "AgentStepCheckpointService not wired",
      );
    });

    it("loads checkpoint by checkpointId and creates agent", async () => {
      const mockCheckpoint = {
        identity: { id: "agent-1" },
        envelope: { memory: { sessionId: "s1" } },
      };
      const checkpointService = {
        load: jest.fn().mockResolvedValue(mockCheckpoint),
        latestForAgent: jest.fn(),
      };
      const factory = makeFactory();
      const facade = new HarnessFacade(
        factory,
        makeHookRegistry(),
        makeLoopRegistry(),
        checkpointService as any,
      );
      const result = await facade.resume({ checkpointId: "cp1" });
      expect(result?.checkpoint).toBe(mockCheckpoint);
      expect(checkpointService.load).toHaveBeenCalledWith("cp1");
    });

    it("loads latest checkpoint by agentId when useLatest=true", async () => {
      const mockCheckpoint = {
        identity: { id: "agent-1" },
        envelope: { memory: { sessionId: "s1" } },
      };
      const checkpointService = {
        load: jest.fn(),
        latestForAgent: jest.fn().mockResolvedValue(mockCheckpoint),
      };
      const factory = makeFactory();
      const facade = new HarnessFacade(
        factory,
        makeHookRegistry(),
        makeLoopRegistry(),
        checkpointService as any,
      );
      const result = await facade.resume({
        agentId: "agent-1",
        useLatest: true,
      });
      expect(result?.checkpoint).toBe(mockCheckpoint);
      expect(checkpointService.latestForAgent).toHaveBeenCalledWith("agent-1");
    });

    it("returns null when checkpoint not found", async () => {
      const checkpointService = { load: jest.fn().mockResolvedValue(null) };
      const facade = new HarnessFacade(
        makeFactory(),
        makeHookRegistry(),
        makeLoopRegistry(),
        checkpointService as any,
      );
      const result = await facade.resume({ checkpointId: "missing" });
      expect(result).toBeNull();
    });
  });

  describe("fork()", () => {
    it("throws when checkpointService not wired", async () => {
      const facade = new HarnessFacade(
        makeFactory(),
        makeHookRegistry(),
        makeLoopRegistry(),
      );
      await expect(facade.fork("cp1", "u1")).rejects.toThrow(
        "AgentStepCheckpointService not wired",
      );
    });

    it("returns null when checkpoint not found", async () => {
      const checkpointService = { load: jest.fn().mockResolvedValue(null) };
      const facade = new HarnessFacade(
        makeFactory(),
        makeHookRegistry(),
        makeLoopRegistry(),
        checkpointService as any,
      );
      const result = await facade.fork("missing", "u1");
      expect(result).toBeNull();
    });

    it("forks with new session, isolating userId by default", async () => {
      const mockCheckpoint = {
        identity: { id: "agent-1" },
        envelope: { memory: { sessionId: "s1", userId: "u1" } },
      };
      const checkpointService = {
        load: jest.fn().mockResolvedValue(mockCheckpoint),
      };
      const factory = makeFactory();
      const facade = new HarnessFacade(
        factory,
        makeHookRegistry(),
        makeLoopRegistry(),
        checkpointService as any,
      );
      const result = await facade.fork("cp1", "u1");
      expect(result).not.toBeNull();
      expect(factory.createFromCheckpoint).toHaveBeenCalledWith(
        expect.objectContaining({
          envelope: expect.objectContaining({
            memory: expect.objectContaining({ userId: undefined }),
          }),
        }),
      );
    });

    it("HARNESS-SEC-001: denies fork by non-owner (returns null, no agent built)", async () => {
      const mockCheckpoint = {
        identity: { id: "agent-1" },
        ownerUserId: "u1",
        envelope: { memory: { sessionId: "s1", userId: "u1" } },
      };
      const checkpointService = {
        load: jest.fn().mockResolvedValue(mockCheckpoint),
      };
      const factory = makeFactory();
      const facade = new HarnessFacade(
        factory,
        makeHookRegistry(),
        makeLoopRegistry(),
        checkpointService as any,
      );
      const result = await facade.fork("cp1", "attacker-user");
      expect(result).toBeNull();
      expect(factory.createFromCheckpoint).not.toHaveBeenCalled();
    });

    it("HARNESS-SEC-001: denies resume by non-owner (returns null)", async () => {
      const mockCheckpoint = {
        identity: { id: "agent-1" },
        ownerUserId: "u1",
        envelope: { memory: { sessionId: "s1", userId: "u1" } },
      };
      const checkpointService = {
        load: jest.fn().mockResolvedValue(mockCheckpoint),
      };
      const factory = makeFactory();
      const facade = new HarnessFacade(
        factory,
        makeHookRegistry(),
        makeLoopRegistry(),
        checkpointService as any,
      );
      const result = await facade.resume({
        checkpointId: "cp1",
        requestingUserId: "attacker-user",
      });
      expect(result).toBeNull();
      expect(factory.createFromCheckpoint).not.toHaveBeenCalled();
    });

    it("preserves userId when preserveUserId=true", async () => {
      const mockCheckpoint = {
        identity: { id: "agent-1" },
        envelope: { memory: { sessionId: "s1", userId: "u1" } },
      };
      const checkpointService = {
        load: jest.fn().mockResolvedValue(mockCheckpoint),
      };
      const factory = makeFactory();
      const facade = new HarnessFacade(
        factory,
        makeHookRegistry(),
        makeLoopRegistry(),
        checkpointService as any,
      );
      await facade.fork("cp1", "u1", { preserveUserId: true });
      expect(factory.createFromCheckpoint).toHaveBeenCalledWith(
        expect.objectContaining({
          envelope: expect.objectContaining({
            memory: expect.objectContaining({ userId: "u1" }),
          }),
        }),
      );
    });

    it("uses provided newSessionId when given", async () => {
      const mockCheckpoint = {
        identity: { id: "agent-1" },
        envelope: { memory: { sessionId: "s1", userId: "u1" } },
      };
      const checkpointService = {
        load: jest.fn().mockResolvedValue(mockCheckpoint),
      };
      const factory = makeFactory();
      const facade = new HarnessFacade(
        factory,
        makeHookRegistry(),
        makeLoopRegistry(),
        checkpointService as any,
      );
      await facade.fork("cp1", "u1", { newSessionId: "custom-session" });
      expect(factory.createFromCheckpoint).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "custom-session",
        }),
      );
    });
  });

  describe("replay()", () => {
    it("throws when eventStore not wired", async () => {
      const facade = new HarnessFacade(
        makeFactory(),
        makeHookRegistry(),
        makeLoopRegistry(),
      );
      await expect(facade.replay("agent-1")).rejects.toThrow(
        "AgentEventStore not wired",
      );
    });

    it("reads event stream from eventStore", async () => {
      const mockEvents = [{ seq: 1 }, { seq: 2 }];
      const eventStore = {
        readStream: jest.fn().mockResolvedValue(mockEvents),
      };
      const facade = new HarnessFacade(
        makeFactory(),
        makeHookRegistry(),
        makeLoopRegistry(),
        undefined,
        eventStore as any,
      );
      const result = await facade.replay("agent-1", { fromSeq: 0, limit: 10 });
      expect(result).toEqual(mockEvents);
      expect(eventStore.readStream).toHaveBeenCalledWith("agent-1", {
        fromSeq: 0,
        limit: 10,
      });
    });
  });
});
