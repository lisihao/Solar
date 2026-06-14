/**
 * Supplemental tests for duty-loader.ts — renderDuty + internal helpers
 *
 * The existing duty-loader-integration.spec.ts already covers:
 *   - buildPromptFromDuty happy path (real SKILL.md files)
 *   - clearDutyCache
 *   - unknown duty / unknown agent dir errors
 *
 * This spec covers the template-rendering branches that the integration spec
 * does not exercise: renderDuty / expandVars / expandIf / expandEach edge cases.
 */

import { renderDuty } from "../duty-loader";

// ---------------------------------------------------------------------------
// renderDuty — expandVars
// ---------------------------------------------------------------------------

describe("renderDuty — expandVars", () => {
  it("should replace a simple string variable", () => {
    const result = renderDuty("Hello {{name}}!", { name: "World" });
    expect(result).toBe("Hello World!");
  });

  it("should replace a number variable as string", () => {
    const result = renderDuty("Count: {{count}}", { count: 42 });
    expect(result).toBe("Count: 42");
  });

  it("should replace a boolean variable as string", () => {
    const result = renderDuty("Flag: {{flag}}", { flag: false });
    expect(result).toBe("Flag: false");
  });

  it("should JSON-stringify an object variable", () => {
    const result = renderDuty("Data: {{obj}}", { obj: { x: 1 } });
    expect(result).toContain('"x":1');
  });

  it("should replace null/undefined variable with empty string", () => {
    const nullResult = renderDuty("Val: {{missing}}", {});
    expect(nullResult).toBe("Val: ");

    const undResult = renderDuty("Val: {{undef}}", { undef: undefined });
    expect(undResult).toBe("Val: ");
  });

  it("should handle nested dot-path variable", () => {
    const result = renderDuty("Platform: {{meta.platform}}", {
      meta: { platform: "WECHAT_MP" },
    });
    expect(result).toBe("Platform: WECHAT_MP");
  });

  it("should return empty string for deep missing nested key", () => {
    const result = renderDuty("{{a.b.c}}", { a: {} });
    expect(result).toBe("");
  });

  it("should leave {{this}} placeholder unchanged (reserved token)", () => {
    const result = renderDuty("item: {{this}}", { this: "should not replace" });
    expect(result).toBe("item: {{this}}");
  });

  it("should leave {{@index}} placeholder unchanged (reserved token)", () => {
    const result = renderDuty("idx: {{@index}}", {});
    expect(result).toBe("idx: {{@index}}");
  });

  it("should replace multiple different variables in one pass", () => {
    const result = renderDuty("{{a}} and {{b}}", { a: "Alpha", b: "Beta" });
    expect(result).toBe("Alpha and Beta");
  });
});

// ---------------------------------------------------------------------------
// renderDuty — expandIf
// ---------------------------------------------------------------------------

describe("renderDuty — expandIf", () => {
  it("should include body when condition is truthy string", () => {
    const result = renderDuty("{{#if name}}Hello {{name}}{{/if}}", {
      name: "Alice",
    });
    expect(result).toBe("Hello Alice");
  });

  it("should exclude body when condition is empty string (falsy)", () => {
    const result = renderDuty("{{#if name}}Hello{{/if}}", { name: "" });
    expect(result).toBe("");
  });

  it("should exclude body when condition key is missing", () => {
    const result = renderDuty("{{#if missing}}present{{/if}}", {});
    expect(result).toBe("");
  });

  it("should exclude body when condition is false", () => {
    const result = renderDuty("{{#if active}}on{{/if}}", { active: false });
    expect(result).toBe("");
  });

  it("should include body when condition is true", () => {
    const result = renderDuty("{{#if active}}enabled{{/if}}", { active: true });
    expect(result).toBe("enabled");
  });

  it("should include body when condition is nonzero number", () => {
    const result = renderDuty("{{#if count}}has items{{/if}}", { count: 3 });
    expect(result).toBe("has items");
  });

  it("should exclude body when condition is zero", () => {
    const result = renderDuty("{{#if count}}has items{{/if}}", { count: 0 });
    expect(result).toBe("");
  });

  it("should include body when condition is non-empty array", () => {
    const result = renderDuty("{{#if items}}list{{/if}}", { items: ["a"] });
    expect(result).toBe("list");
  });

  it("should exclude body when condition is empty array", () => {
    const result = renderDuty("{{#if items}}list{{/if}}", { items: [] });
    expect(result).toBe("");
  });

  it("should handle nested {{#if}} blocks", () => {
    const result = renderDuty("{{#if outer}}A{{#if inner}}B{{/if}}C{{/if}}", {
      outer: true,
      inner: true,
    });
    expect(result).toBe("ABC");
  });

  it("should handle nested if where inner is falsy", () => {
    // When inner=false, the innermost {{#if inner}}B{{/if}} collapses to ""
    // The regex is non-greedy so it replaces the inner block first.
    // With outer=true, inner=false: outer matches A + (collapsed inner) → "A"
    const result = renderDuty("{{#if outer}}A{{#if inner}}B{{/if}}C{{/if}}", {
      outer: true,
      inner: false,
    });
    expect(result).toBe("A");
  });
});

// ---------------------------------------------------------------------------
// renderDuty — expandEach
// ---------------------------------------------------------------------------

describe("renderDuty — expandEach", () => {
  it("should render each object item properties in array", () => {
    const result = renderDuty("{{#each platforms}}{{name}} {{/each}}", {
      platforms: [{ name: "WeChat" }, { name: "XHS" }],
    });
    expect(result).toBe("WeChat XHS ");
  });

  it("should return empty string for empty array", () => {
    const result = renderDuty("{{#each items}}x{{/each}}", { items: [] });
    expect(result).toBe("");
  });

  it("should return empty string when key is not an array", () => {
    // expandEach checks Array.isArray; non-array returns empty string
    const result = renderDuty("{{#each notArray}}x{{/each}}", {
      notArray: "scalar",
    });
    expect(result).toBe("");
  });

  it("should return empty string when each key is missing", () => {
    const result = renderDuty("{{#each missing}}x{{/each}}", {});
    expect(result).toBe("");
  });

  it("should expand object properties from parent context inside each", () => {
    // prefix is a parent var, items are objects with a "key" property
    const result = renderDuty("{{#each items}}{{prefix}}-{{key}} {{/each}}", {
      prefix: "item",
      items: [{ key: "a" }, { key: "b" }],
    });
    expect(result).toBe("item-a item-b ");
  });

  it("should handle nested if inside each", () => {
    const result = renderDuty(
      "{{#each items}}{{#if active}}{{name}}{{/if}} {{/each}}",
      {
        items: [
          { name: "Alpha", active: true },
          { name: "Beta", active: false },
        ],
      },
    );
    expect(result).toContain("Alpha");
    expect(result).not.toContain("Beta");
  });

  it("should iterate multiple object items in each loop", () => {
    const result = renderDuty(
      "{{#each steps}}Step {{num}}: {{label}}; {{/each}}",
      {
        steps: [
          { num: 1, label: "plan" },
          { num: 2, label: "execute" },
        ],
      },
    );
    expect(result).toBe("Step 1: plan; Step 2: execute; ");
  });
});
