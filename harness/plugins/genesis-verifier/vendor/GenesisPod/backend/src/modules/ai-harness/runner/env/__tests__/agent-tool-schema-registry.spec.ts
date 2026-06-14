import { AgentToolSchemaRegistry } from "../agent-tool-schema-registry";

function makeTool(id = "test-tool", maxCallsPerTask = 5, maxRetries = 1) {
  return {
    id,
    description: "test tool",
    argsSchema: {
      type: "object" as const,
      properties: { q: { type: "string" as const } },
    },
    rateLimit: { maxCallsPerMinute: 10, maxCallsPerTask },
    retry: { maxRetries, backoffMs: 1 },
    estimateCost: jest.fn().mockReturnValue(0),
    execute: jest
      .fn()
      .mockResolvedValue({ success: true, data: "ok", latencyMs: 5 }),
  };
}

const makeCtx = (taskId = "task-1") => ({
  taskId,
  scope: "mission-1",
  traceId: "t1",
  spanId: "s1",
  callCount: 0,
});

describe("AgentToolSchemaRegistry", () => {
  describe("register / get / mustGet", () => {
    it("registers and retrieves a tool", () => {
      const reg = new AgentToolSchemaRegistry();
      const tool = makeTool();
      reg.register(tool);
      expect(reg.get("test-tool")).toBe(tool);
    });

    it("get returns undefined for unknown tool", () => {
      expect(new AgentToolSchemaRegistry().get("unknown")).toBeUndefined();
    });

    it("mustGet throws for unknown tool", () => {
      expect(() => new AgentToolSchemaRegistry().mustGet("unknown")).toThrow(
        /not registered/,
      );
    });

    it("warns on duplicate registration", () => {
      const reg = new AgentToolSchemaRegistry();
      const t1 = makeTool();
      const t2 = makeTool();
      reg.register(t1);
      reg.register(t2); // should not throw, just warn
      expect(reg.get("test-tool")).toBe(t2);
    });
  });

  describe("getSchemas", () => {
    it("returns schemas for registered tools", () => {
      const reg = new AgentToolSchemaRegistry();
      reg.register(makeTool("search"));
      reg.register(makeTool("fetch"));
      const schemas = reg.getSchemas(["search", "unknown"]);
      expect(schemas).toHaveLength(1);
      expect(schemas[0].function.name).toBe("search");
    });

    it("filters out unregistered ids", () => {
      const reg = new AgentToolSchemaRegistry();
      const schemas = reg.getSchemas(["ghost"]);
      expect(schemas).toHaveLength(0);
    });
  });

  describe("execute", () => {
    it("executes tool successfully", async () => {
      const reg = new AgentToolSchemaRegistry();
      reg.register(makeTool());
      const result = await reg.execute("test-tool", { q: "hi" }, makeCtx());
      expect(result.success).toBe(true);
    });

    it("respects per-task rate limit", async () => {
      const reg = new AgentToolSchemaRegistry();
      reg.register(makeTool("limited", 2));
      const ctx = makeCtx();
      await reg.execute("limited", {}, ctx);
      await reg.execute("limited", {}, ctx);
      const result = await reg.execute("limited", {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/exceeded max calls/);
    });

    it("retries on failure", async () => {
      const reg = new AgentToolSchemaRegistry();
      const tool = makeTool("retry-tool", 10, 2);
      let calls = 0;
      tool.execute.mockImplementation(() => {
        calls++;
        if (calls < 3) throw new Error("transient");
        return Promise.resolve({ success: true, data: "done", latencyMs: 1 });
      });
      reg.register(tool);
      const result = await reg.execute("retry-tool", {}, makeCtx());
      expect(result.success).toBe(true);
      expect(calls).toBe(3);
    });

    it("returns error after max retries exceeded", async () => {
      const reg = new AgentToolSchemaRegistry();
      const tool = makeTool("fail-tool", 10, 1);
      tool.execute.mockRejectedValue(new Error("always fail"));
      reg.register(tool);
      const result = await reg.execute("fail-tool", {}, makeCtx());
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/failed after/);
    });

    it("throws when tool not found", async () => {
      const reg = new AgentToolSchemaRegistry();
      await expect(reg.execute("ghost", {}, makeCtx())).rejects.toThrow(
        /not registered/,
      );
    });
  });

  describe("clearTaskCallCounts", () => {
    it("clears call counts for a task", async () => {
      const reg = new AgentToolSchemaRegistry();
      reg.register(makeTool("t1", 2));
      const ctx = makeCtx("task-99");
      await reg.execute("t1", {}, ctx);
      await reg.execute("t1", {}, ctx);
      reg.clearTaskCallCounts("task-99");
      // Should succeed again after clear
      const result = await reg.execute("t1", {}, ctx);
      expect(result.success).toBe(true);
    });
  });

  describe("listIds", () => {
    it("lists registered tool ids", () => {
      const reg = new AgentToolSchemaRegistry();
      reg.register(makeTool("a"));
      reg.register(makeTool("b"));
      expect(reg.listIds()).toContain("a");
      expect(reg.listIds()).toContain("b");
    });
  });
});
