import { DomainAdapterRegistry } from "../domain-adapter";

function makeAdapter(conceptId: string) {
  return {
    conceptId,
    fetch: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockResolvedValue(undefined),
  };
}

describe("DomainAdapterRegistry", () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it("registers and retrieves an adapter", () => {
    const reg = new DomainAdapterRegistry();
    const adapter = makeAdapter("topic");
    reg.register(adapter);
    expect(reg.has("topic")).toBe(true);
    expect(reg.get("topic")).toBe(adapter);
  });

  it("returns undefined for unknown conceptId", () => {
    const reg = new DomainAdapterRegistry();
    expect(reg.get("unknown")).toBeUndefined();
  });

  it("has() returns false for unregistered", () => {
    expect(new DomainAdapterRegistry().has("ghost")).toBe(false);
  });

  it("list() returns all registered concept ids", () => {
    const reg = new DomainAdapterRegistry();
    reg.register(makeAdapter("a"));
    reg.register(makeAdapter("b"));
    expect(reg.list()).toContain("a");
    expect(reg.list()).toContain("b");
  });

  it("throws in non-production on duplicate registration", () => {
    process.env.NODE_ENV = "test";
    const reg = new DomainAdapterRegistry();
    reg.register(makeAdapter("dup"));
    expect(() => reg.register(makeAdapter("dup"))).toThrow(
      /already registered/,
    );
  });

  it("warns and overwrites in production on duplicate registration", () => {
    process.env.NODE_ENV = "production";
    const reg = new DomainAdapterRegistry();
    const a1 = makeAdapter("dup");
    const a2 = makeAdapter("dup");
    reg.register(a1);
    expect(() => reg.register(a2)).not.toThrow();
    expect(reg.get("dup")).toBe(a2);
  });
});
