/**
 * social.events.spec.ts
 *
 * Validates that SOCIAL_EVENTS is a non-empty array, every entry has the
 * expected `type` string prefixed with "social.", and none of the type
 * values have drifted from the canonical names.
 *
 * Anti-lying-assertion rule: we assert on the _actual string value_ of each
 * event type, not just that "something truthy exists". If a name is
 * accidentally renamed the test will fail.
 */

import { SOCIAL_EVENTS } from "../social.events";

describe("SOCIAL_EVENTS registry", () => {
  it("is a non-empty readonly array", () => {
    expect(Array.isArray(SOCIAL_EVENTS)).toBe(true);
    expect(SOCIAL_EVENTS.length).toBeGreaterThan(0);
  });

  it("every entry has a type string prefixed with 'social.'", () => {
    for (const spec of SOCIAL_EVENTS) {
      expect(typeof spec.type).toBe("string");
      expect(spec.type.startsWith("social.")).toBe(true);
    }
  });

  it("every entry has a schema object (not null/undefined)", () => {
    for (const spec of SOCIAL_EVENTS) {
      expect(spec.schema).toBeDefined();
      expect(spec.schema).not.toBeNull();
    }
  });

  // ── mission lifecycle type names ─────────────────────────────────────────

  describe("mission lifecycle events", () => {
    const missionTypes = [
      "social.mission:started",
      "social.mission:completed",
      "social.mission:failed",
      "social.mission:aborted",
      "social.mission:degraded",
      "social.mission:warning",
      "social.mission:gated",
      "social.mission:postlude:started",
      "social.mission:postlude:completed",
      "social.mission:postlude:failed",
    ];

    it.each(missionTypes)("contains event type '%s'", (expectedType) => {
      const found = SOCIAL_EVENTS.find((e) => e.type === expectedType);
      expect(found).toBeDefined();
      // Assert the value directly, not just existence (anti-lying-assertion)
      expect(found!.type).toBe(expectedType);
    });
  });

  // ── stage lifecycle type names ───────────────────────────────────────────

  describe("stage lifecycle events", () => {
    const stageTypes = [
      "social.stage:started",
      "social.stage:completed",
      "social.stage:failed",
      "social.stage:degraded",
      "social.stage:stalled",
      "social.stage:lifecycle",
    ];

    it.each(stageTypes)("contains event type '%s'", (expectedType) => {
      const found = SOCIAL_EVENTS.find((e) => e.type === expectedType);
      expect(found!.type).toBe(expectedType);
    });
  });

  // ── agent lifecycle type names ───────────────────────────────────────────

  describe("agent lifecycle events", () => {
    const agentTypes = [
      "social.agent:lifecycle",
      "social.agent:thought",
      "social.agent:action",
      "social.agent:observation",
      "social.agent:error",
      "social.agent:narrative",
    ];

    it.each(agentTypes)("contains event type '%s'", (expectedType) => {
      const found = SOCIAL_EVENTS.find((e) => e.type === expectedType);
      expect(found!.type).toBe(expectedType);
    });
  });

  // ── cost / budget type names ─────────────────────────────────────────────

  describe("cost / budget events", () => {
    const costTypes = ["social.cost:tick", "social.budget:exhausted"];

    it.each(costTypes)("contains event type '%s'", (expectedType) => {
      const found = SOCIAL_EVENTS.find((e) => e.type === expectedType);
      expect(found!.type).toBe(expectedType);
    });
  });

  // ── publish-specific type names ──────────────────────────────────────────

  describe("publish events", () => {
    const publishTypes = ["social.publish:executed", "social.publish:verified"];

    it.each(publishTypes)("contains event type '%s'", (expectedType) => {
      const found = SOCIAL_EVENTS.find((e) => e.type === expectedType);
      expect(found!.type).toBe(expectedType);
    });
  });

  // ── total count guard ────────────────────────────────────────────────────

  it("has exactly 29 registered events (contract guard)", () => {
    expect(SOCIAL_EVENTS.length).toBe(29);
  });

  it("has no duplicate type strings", () => {
    const types = SOCIAL_EVENTS.map((e) => e.type);
    const unique = new Set(types);
    expect(unique.size).toBe(types.length);
  });
});
