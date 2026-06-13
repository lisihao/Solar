/**
 * DomainConceptRegistry — extra branch coverage
 */

import { DomainConceptRegistry } from "../concept-registry";
import type { DomainConceptSpec } from "../concept.types";

function makeConcept(id: string, moduleId = "test"): DomainConceptSpec {
  return {
    id,
    moduleId,
    displayName: `Display ${id}`,
    description: `Description of ${id}`,
    fields: [
      { name: "title", type: "string", required: true },
      { name: "count", type: "number" },
    ],
  };
}

describe("DomainConceptRegistry — extra branches", () => {
  it("registerAll registers multiple concepts", () => {
    const reg = new DomainConceptRegistry();
    reg.registerAll([
      makeConcept("a.concept"),
      makeConcept("b.concept"),
      makeConcept("c.concept"),
    ]);
    expect(reg.has("a.concept")).toBe(true);
    expect(reg.has("b.concept")).toBe(true);
    expect(reg.has("c.concept")).toBe(true);
    expect(reg.list()).toHaveLength(3);
  });

  it("throws on duplicate registration in non-production", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    try {
      const reg = new DomainConceptRegistry();
      reg.register(makeConcept("dup.concept", "mod-a"));
      expect(() => reg.register(makeConcept("dup.concept", "mod-b"))).toThrow(
        /already registered/,
      );
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it("warns and overwrites in production on duplicate", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const reg = new DomainConceptRegistry();
      reg.register(makeConcept("dup.prod", "mod-a"));
      expect(() =>
        reg.register(makeConcept("dup.prod", "mod-b")),
      ).not.toThrow();
      // Last registration wins
      expect(reg.get("dup.prod")?.moduleId).toBe("mod-b");
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it("get returns undefined for unknown id", () => {
    const reg = new DomainConceptRegistry();
    expect(reg.get("nonexistent")).toBeUndefined();
  });

  it("has returns false for unregistered concept", () => {
    expect(new DomainConceptRegistry().has("ghost")).toBe(false);
  });

  it("listByModule returns correct subset", () => {
    const reg = new DomainConceptRegistry();
    reg.register(makeConcept("ti.topic", "topic-insights"));
    reg.register(makeConcept("ti.mission", "topic-insights"));
    reg.register(makeConcept("rs.query", "research"));
    const tiConcepts = reg.listByModule("topic-insights");
    expect(tiConcepts).toHaveLength(2);
    expect(tiConcepts.map((c) => c.id).sort()).toEqual([
      "ti.mission",
      "ti.topic",
    ]);
  });

  it("listByModule returns empty for unknown module", () => {
    const reg = new DomainConceptRegistry();
    reg.register(makeConcept("x.y", "mod-x"));
    expect(reg.listByModule("unknown-module")).toHaveLength(0);
  });

  it("describeForLLM returns no-concepts when ids list is empty", () => {
    const reg = new DomainConceptRegistry();
    reg.register(makeConcept("a.b"));
    const txt = reg.describeForLLM([]);
    expect(txt).toBe("(no domain concepts)");
  });

  it("describeForLLM skips unknown concept ids", () => {
    const reg = new DomainConceptRegistry();
    reg.register(makeConcept("known.id"));
    const txt = reg.describeForLLM(["known.id", "unknown.id"]);
    expect(txt).toContain("known.id");
    expect(txt).not.toContain("undefined");
  });

  it("describeForLLM marks required fields with *", () => {
    const reg = new DomainConceptRegistry();
    reg.register(makeConcept("q.dim"));
    const txt = reg.describeForLLM(["q.dim"]);
    expect(txt).toContain("title:string*");
    expect(txt).toContain("count:number");
    expect(txt).not.toContain("count:number*");
  });

  it("describeForLLM returns no-concepts when none of the ids are registered", () => {
    const reg = new DomainConceptRegistry();
    const txt = reg.describeForLLM(["totally.unknown"]);
    expect(txt).toBe("(no domain concepts)");
  });
});
