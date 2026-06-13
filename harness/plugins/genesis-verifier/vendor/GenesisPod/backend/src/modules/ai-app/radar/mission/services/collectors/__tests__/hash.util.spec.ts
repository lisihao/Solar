import { computeContentHash } from "../hash.util";

describe("radar/collectors/hash.util", () => {
  it("hashes title + content deterministically", () => {
    const h1 = computeContentHash("Title", "Body content");
    const h2 = computeContentHash("Title", "Body content");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("normalizes whitespace + case", () => {
    const a = computeContentHash("  TITLE  ", "Body");
    const b = computeContentHash("title", "body");
    expect(a).toBe(b);
  });

  it("differentiates by title", () => {
    expect(computeContentHash("A", "x")).not.toBe(computeContentHash("B", "x"));
  });

  it("handles null inputs", () => {
    expect(() => computeContentHash(null, null)).not.toThrow();
    expect(computeContentHash(null, null)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("truncates content past 1000 chars (later chars don't affect hash)", () => {
    const long1 = "x".repeat(1000) + "TAIL_A";
    const long2 = "x".repeat(1000) + "TAIL_B";
    expect(computeContentHash("T", long1)).toBe(computeContentHash("T", long2));
  });
});
