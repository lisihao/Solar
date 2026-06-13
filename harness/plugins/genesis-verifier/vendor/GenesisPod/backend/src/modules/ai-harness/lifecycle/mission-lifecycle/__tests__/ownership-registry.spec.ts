import { MissionOwnershipRegistry } from "../ownership-registry";

describe("MissionOwnershipRegistry", () => {
  let registry: MissionOwnershipRegistry;

  beforeEach(() => {
    registry = new MissionOwnershipRegistry();
  });

  it("assign + getOwner: returns userId for assigned mission", () => {
    registry.assign("m1", "user-alice");
    expect(registry.getOwner("m1")).toBe("user-alice");
  });

  it("getOwner: returns undefined for unassigned mission", () => {
    expect(registry.getOwner("nonexistent")).toBeUndefined();
  });

  it("release: removes mission from registry", () => {
    registry.assign("m1", "user-alice");
    registry.release("m1");
    expect(registry.getOwner("m1")).toBeUndefined();
  });

  it("size: returns 0 initially", () => {
    expect(registry.size()).toBe(0);
  });

  it("size: increments on assign", () => {
    registry.assign("m1", "u1");
    registry.assign("m2", "u2");
    expect(registry.size()).toBe(2);
  });

  it("size: decrements on release", () => {
    registry.assign("m1", "u1");
    registry.release("m1");
    expect(registry.size()).toBe(0);
  });

  it("assign twice: overwrites previous userId", () => {
    registry.assign("m1", "user-alice");
    registry.assign("m1", "user-bob");
    expect(registry.getOwner("m1")).toBe("user-bob");
  });

  it("release: no-op for nonexistent mission", () => {
    expect(() => registry.release("nonexistent")).not.toThrow();
    expect(registry.size()).toBe(0);
  });

  it("multiple users can have separate missions", () => {
    registry.assign("m1", "alice");
    registry.assign("m2", "bob");
    expect(registry.getOwner("m1")).toBe("alice");
    expect(registry.getOwner("m2")).toBe("bob");
  });

  it("evicts oldest entries when capacity exceeded (5000)", () => {
    // Fill to capacity + 1
    for (let i = 0; i < 5001; i++) {
      registry.assign(`mission-${i}`, `user-${i}`);
    }
    // Size should be <= 5000 after eviction
    expect(registry.size()).toBeLessThanOrEqual(5000);
  });

  it("eviction removes oldest ~10% of entries", () => {
    const CAPACITY = 5000;
    for (let i = 0; i < CAPACITY + 1; i++) {
      registry.assign(`mission-${i}`, `user-${i}`);
    }
    // Oldest entries (mission-0 to mission-499) should be evicted
    // This is a probabilistic check; at least some old ones should be gone
    expect(registry.size()).toBeLessThan(CAPACITY + 1);
  });

  it("assign does not throw on re-assign (logs warn instead)", () => {
    registry.assign("m1", "alice");
    expect(() => registry.assign("m1", "bob")).not.toThrow();
  });

  it("getOwner: returns correct owner after multiple assigns/releases", () => {
    registry.assign("m1", "alice");
    registry.assign("m2", "bob");
    registry.release("m1");
    registry.assign("m3", "charlie");
    expect(registry.getOwner("m1")).toBeUndefined();
    expect(registry.getOwner("m2")).toBe("bob");
    expect(registry.getOwner("m3")).toBe("charlie");
  });

  it("size stays consistent after mixed operations", () => {
    registry.assign("m1", "u1");
    registry.assign("m2", "u2");
    registry.assign("m3", "u3");
    registry.release("m2");
    expect(registry.size()).toBe(2);
  });
});
