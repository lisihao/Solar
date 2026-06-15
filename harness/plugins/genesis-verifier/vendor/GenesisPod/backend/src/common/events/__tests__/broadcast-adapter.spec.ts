import { LoggerBroadcastAdapter } from "../broadcast-adapter";

describe("LoggerBroadcastAdapter", () => {
  it("has id=logger", () => {
    const adapter = new LoggerBroadcastAdapter();
    expect(adapter.id).toBe("logger");
  });

  it("accepts all events", () => {
    const adapter = new LoggerBroadcastAdapter();
    const event = { type: "any.event", scope: {}, payload: {} };
    expect(adapter.accepts(event as never)).toBe(true);
  });

  it("broadcasts without throwing", async () => {
    const adapter = new LoggerBroadcastAdapter();
    const event = {
      type: "test.event",
      scope: { userId: "u1" },
      payload: { data: 1 },
      agentId: "a1",
    };
    await expect(adapter.broadcast(event as never)).resolves.toBeUndefined();
  });

  it("broadcasts events without agentId", async () => {
    const adapter = new LoggerBroadcastAdapter();
    const event = { type: "test.event", scope: {}, payload: {} };
    await expect(adapter.broadcast(event as never)).resolves.toBeUndefined();
  });
});
