import { IsBoundedJsonObjectConstraint } from "../bounded-json.validator";

describe("IsBoundedJsonObjectConstraint", () => {
  const validator = new IsBoundedJsonObjectConstraint();

  it("accepts undefined / null (optional fields)", () => {
    expect(validator.validate(undefined)).toBe(true);
    expect(validator.validate(null)).toBe(true);
  });

  it("accepts a small plain object", () => {
    expect(
      validator.validate({
        searchTimeRange: { since: "2025-01-01" },
        sourceUrl: "https://example.com",
        knowledgeBaseIds: ["kb-1", "kb-2"],
      }),
    ).toBe(true);
  });

  it("rejects non-objects", () => {
    expect(validator.validate("string")).toBe(false);
    expect(validator.validate(42)).toBe(false);
    expect(validator.validate(true)).toBe(false);
  });

  it("rejects arrays", () => {
    expect(validator.validate([1, 2, 3])).toBe(false);
  });

  it("rejects deeply nested objects (>5 levels)", () => {
    // Build { a: { a: { a: { a: { a: { a: 1 } } } } } } — 6 levels
    let deep: Record<string, unknown> = { value: 1 };
    for (let i = 0; i < 7; i++) {
      deep = { a: deep };
    }
    expect(validator.validate(deep)).toBe(false);
  });

  it("accepts nested objects at or below 5 levels", () => {
    const fiveDeep = {
      l1: { l2: { l3: { l4: { l5: "ok" } } } },
    };
    expect(validator.validate(fiveDeep)).toBe(true);
  });

  it("rejects objects exceeding 20KB serialized", () => {
    // 21KB of padding
    const big = { payload: "x".repeat(21 * 1024) };
    expect(validator.validate(big)).toBe(false);
  });

  it("rejects circular references gracefully", () => {
    interface Node {
      self?: Node;
    }
    const node: Node = {};
    node.self = node;
    expect(validator.validate(node)).toBe(false);
  });

  it("defaultMessage includes property name", () => {
    const msg = validator.defaultMessage({
      property: "topicConfig",
      value: null,
      constraints: [],
      targetName: "CreateTopicDto",
      object: {},
    });
    expect(msg).toContain("topicConfig");
    expect(msg).toContain("20KB");
  });
});
