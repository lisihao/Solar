/**
 * writer.service.spec.ts
 */

import { WriterService } from "../writer.service";
import type { InvocationContext } from "../agent-invoker.service";

const baseCtx: InvocationContext = {
  missionId: "m1",
  userId: "u1",
  agentId: "writer#0",
  role: "writer",
};

function makeInvoker(
  state: "completed" | "failed" | "cancelled" = "completed",
) {
  return {
    invoke: jest.fn().mockResolvedValue({
      state,
      output: state === "completed" ? { content: "written" } : undefined,
      events: [],
      iterations: 1,
      wallTimeMs: 300,
    }),
  };
}

describe("WriterService", () => {
  describe("writeSingleShot", () => {
    it("returns completed result", async () => {
      const invoker = makeInvoker();
      const svc = new WriterService(invoker as never);
      const result = await svc.writeSingleShot({ topic: "AI" }, baseCtx);
      expect(result.state).toBe("completed");
      expect(invoker.invoke).toHaveBeenCalledTimes(1);
    });

    it("returns output", async () => {
      const invoker = makeInvoker();
      const svc = new WriterService(invoker as never);
      const result = await svc.writeSingleShot<
        { topic: string },
        { content: string }
      >({ topic: "AI" }, baseCtx);
      expect(result.output?.content).toBe("written");
    });

    it("maps failed state", async () => {
      const invoker = makeInvoker("failed");
      const svc = new WriterService(invoker as never);
      const result = await svc.writeSingleShot({}, baseCtx);
      expect(result.state).toBe("failed");
    });

    it("maps cancelled state", async () => {
      const invoker = makeInvoker("cancelled");
      const svc = new WriterService(invoker as never);
      const result = await svc.writeSingleShot({}, baseCtx);
      expect(result.state).toBe("cancelled");
    });
  });

  describe("planMissionOutline", () => {
    it("calls invoker and returns result", async () => {
      const invoker = makeInvoker();
      const svc = new WriterService(invoker as never);
      const result = await svc.planMissionOutline({ topic: "test" }, baseCtx);
      expect(result.state).toBe("completed");
      expect(invoker.invoke).toHaveBeenCalledTimes(1);
    });
  });

  describe("planDimensionOutline", () => {
    it("calls invoker and returns result", async () => {
      const invoker = makeInvoker();
      const svc = new WriterService(invoker as never);
      const result = await svc.planDimensionOutline(
        { dimension: "Tech" },
        baseCtx,
      );
      expect(result.state).toBe("completed");
    });
  });

  describe("writeChapter", () => {
    it("calls invoker and returns result", async () => {
      const invoker = makeInvoker();
      const svc = new WriterService(invoker as never);
      const result = await svc.writeChapter({ chapterIndex: 1 }, baseCtx);
      expect(result.state).toBe("completed");
    });

    it("maps failed state", async () => {
      const invoker = makeInvoker("failed");
      const svc = new WriterService(invoker as never);
      const result = await svc.writeChapter({}, baseCtx);
      expect(result.state).toBe("failed");
    });
  });

  describe("reviewChapter", () => {
    it("calls invoker and returns result", async () => {
      const invoker = makeInvoker();
      const svc = new WriterService(invoker as never);
      const result = await svc.reviewChapter(
        { chapterIndex: 1, body: "text" },
        baseCtx,
      );
      expect(result.state).toBe("completed");
    });
  });

  describe("integrateDimension", () => {
    it("calls invoker and returns result", async () => {
      const invoker = makeInvoker();
      const svc = new WriterService(invoker as never);
      const result = await svc.integrateDimension(
        { dimension: "Tech" },
        baseCtx,
      );
      expect(result.state).toBe("completed");
    });
  });

  it("propagates events from invoker", async () => {
    const events = [{ type: "thinking", payload: {}, timestamp: 0 }];
    const invoker = makeInvoker();
    invoker.invoke.mockResolvedValue({
      state: "completed",
      output: {},
      events,
      iterations: 1,
      wallTimeMs: 100,
    });
    const svc = new WriterService(invoker as never);
    const result = await svc.writeChapter({}, baseCtx);
    expect(result.events).toBe(events);
  });

  it("propagates iterations and wallTimeMs", async () => {
    const invoker = makeInvoker();
    invoker.invoke.mockResolvedValue({
      state: "completed",
      output: {},
      events: [],
      iterations: 8,
      wallTimeMs: 4000,
    });
    const svc = new WriterService(invoker as never);
    const result = await svc.writeSingleShot({}, baseCtx);
    expect(result.iterations).toBe(8);
    expect(result.wallTimeMs).toBe(4000);
  });

  it("throws when invoker rejects", async () => {
    const invoker = makeInvoker();
    invoker.invoke.mockRejectedValue(new Error("writer crashed"));
    const svc = new WriterService(invoker as never);
    await expect(svc.writeSingleShot({}, baseCtx)).rejects.toThrow(
      "writer crashed",
    );
  });

  it("passes ctx to invoker for each method", async () => {
    const invoker = makeInvoker();
    const svc = new WriterService(invoker as never);
    await svc.planDimensionOutline({}, baseCtx);
    expect(invoker.invoke.mock.calls[0][2]).toBe(baseCtx);
  });

  it("maps unknown state to failed in writeChapter", async () => {
    const invoker = makeInvoker();
    invoker.invoke.mockResolvedValue({
      state: "timeout" as "failed",
      output: undefined,
      events: [],
      iterations: 1,
      wallTimeMs: 100,
    });
    const svc = new WriterService(invoker as never);
    const result = await svc.writeChapter({}, baseCtx);
    expect(result.state).toBe("failed");
  });
});
