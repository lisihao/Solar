import { EventRegistry } from "../event-registry";

describe("EventRegistry", () => {
  function make() {
    return new EventRegistry();
  }

  it("registers and retrieves a spec", () => {
    const reg = make();
    reg.register({ type: "my-app.test:event", description: "Test event" });
    expect(reg.has("my-app.test:event")).toBe(true);
    expect(reg.get("my-app.test:event")?.type).toBe("my-app.test:event");
  });

  it("returns undefined for unknown type", () => {
    const reg = make();
    expect(reg.get("unknown")).toBeUndefined();
  });

  it("warns and overwrites on duplicate registration", () => {
    const reg = make();
    reg.register({ type: "dup:event", description: "First" });
    reg.register({ type: "dup:event", description: "Second" });
    expect(reg.get("dup:event")?.description).toBe("Second");
  });

  it("registerAll registers multiple specs", () => {
    const reg = make();
    reg.registerAll([
      { type: "a:1", description: "A1" },
      { type: "a:2", description: "A2" },
      { type: "a:3", description: "A3" },
    ]);
    expect(reg.has("a:1")).toBe(true);
    expect(reg.has("a:2")).toBe(true);
    expect(reg.has("a:3")).toBe(true);
  });

  it("list() returns all registered specs", () => {
    const reg = make();
    reg.register({ type: "b:1", description: "B1" });
    reg.register({ type: "b:2", description: "B2" });
    const list = reg.list();
    expect(list.length).toBe(2);
  });

  it("listByPrefix() filters by prefix", () => {
    const reg = make();
    reg.register({ type: "app-a:event1", description: "" });
    reg.register({ type: "app-a:event2", description: "" });
    reg.register({ type: "app-b:event1", description: "" });
    const filtered = reg.listByPrefix("app-a:");
    expect(filtered.length).toBe(2);
    filtered.forEach((s) => expect(s.type.startsWith("app-a:")).toBe(true));
  });
});
