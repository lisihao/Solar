import { SpecAgentRegistry } from "../spec-agent-registry";

function makeAgent(id: string) {
  return { id } as never;
}

describe("SpecAgentRegistry", () => {
  it("registers and retrieves an agent", () => {
    const reg = new SpecAgentRegistry();
    reg.register(makeAgent("analyst"));
    expect(reg.has("analyst")).toBe(true);
    expect(reg.get("analyst")).toBeDefined();
  });

  it("returns undefined for unknown agent", () => {
    expect(new SpecAgentRegistry().get("unknown")).toBeUndefined();
  });

  it("skips duplicate registration (warns only)", () => {
    const reg = new SpecAgentRegistry();
    const a1 = makeAgent("dup");
    const a2 = makeAgent("dup");
    reg.register(a1);
    reg.register(a2); // should not throw, just warn
    expect(reg.get("dup")).toBe(a1); // first one kept
  });

  it("has() returns false for unregistered", () => {
    expect(new SpecAgentRegistry().has("ghost")).toBe(false);
  });

  it("getAllIds returns all registered ids", () => {
    const reg = new SpecAgentRegistry();
    reg.register(makeAgent("a"));
    reg.register(makeAgent("b"));
    const ids = reg.getAllIds();
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(ids.length).toBe(2);
  });

  it("size() returns correct count", () => {
    const reg = new SpecAgentRegistry();
    expect(reg.size()).toBe(0);
    reg.register(makeAgent("x"));
    expect(reg.size()).toBe(1);
  });

  it("clear() removes all agents", () => {
    const reg = new SpecAgentRegistry();
    reg.register(makeAgent("a"));
    reg.register(makeAgent("b"));
    reg.clear();
    expect(reg.size()).toBe(0);
    expect(reg.has("a")).toBe(false);
  });
});
