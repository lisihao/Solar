/**
 * zod-schema-prompt — supplement branch coverage spec
 *
 * Targets uncovered branches:
 *   - ZodUnknown type → "<any>"
 *   - describeArrayConstraints: min only (no max)
 *   - describeArrayConstraints: max only (no min)
 *   - describeStringConstraints: uuid constraint
 *   - depth > MAX_DEPTH → "<...>"
 *   - describeOne catch path (exception in describeOne) → null
 *   - ZodDefault wrapper
 *   - ZodNullable wrapper
 */

import { z } from "zod";
import { describeOutputSchemaForLlm } from "../zod-schema-prompt";

describe("zod-schema-prompt supplement — ZodUnknown", () => {
  it("describes ZodUnknown type as <any>", () => {
    const schema = z.object({ data: z.unknown() });
    const desc = describeOutputSchemaForLlm(schema);
    expect(desc).not.toBeNull();
    expect(desc).toContain("<any>");
  });
});

describe("zod-schema-prompt supplement — array constraints", () => {
  it("describes array with only min constraint", () => {
    const schema = z.object({ items: z.array(z.string()).min(2) });
    const desc = describeOutputSchemaForLlm(schema);
    expect(desc).not.toBeNull();
    expect(desc).toContain(">=2 items");
    expect(desc).not.toContain("<=");
  });

  it("describes array with only max constraint", () => {
    const schema = z.object({ items: z.array(z.string()).max(10) });
    const desc = describeOutputSchemaForLlm(schema);
    expect(desc).not.toBeNull();
    expect(desc).toContain("<=10 items");
    expect(desc).not.toContain(">=");
  });

  it("describes array with both min and max constraints", () => {
    const schema = z.object({ items: z.array(z.string()).min(1).max(5) });
    const desc = describeOutputSchemaForLlm(schema);
    expect(desc).not.toBeNull();
    expect(desc).toContain("1-5 items");
  });

  it("describes array with no constraints — empty constraints string", () => {
    const schema = z.object({ items: z.array(z.string()) });
    const desc = describeOutputSchemaForLlm(schema);
    expect(desc).not.toBeNull();
    // No constraint annotations after "..."
    expect(desc).toContain("// ...");
  });
});

describe("zod-schema-prompt supplement — string constraints", () => {
  it("describes string with uuid constraint", () => {
    const schema = z.object({ id: z.string().uuid() });
    const desc = describeOutputSchemaForLlm(schema);
    expect(desc).not.toBeNull();
    expect(desc).toContain("uuid");
  });
});

describe("zod-schema-prompt supplement — deep nesting", () => {
  it("stops at MAX_DEPTH=5 and returns <...>", () => {
    // Build 7-deep nesting to exceed MAX_DEPTH
    const schema = z.object({
      l1: z.object({
        l2: z.object({
          l3: z.object({
            l4: z.object({
              l5: z.object({
                l6: z.string(), // depth=6, > MAX_DEPTH=5 → "<...>"
              }),
            }),
          }),
        }),
      }),
    });
    const desc = describeOutputSchemaForLlm(schema);
    expect(desc).not.toBeNull();
    expect(desc).toContain("<...>");
  });
});

describe("zod-schema-prompt supplement — ZodNullable wrapper", () => {
  it("describes nested nullable object schema", () => {
    const schema = z.object({
      val: z.object({ name: z.string() }).nullable(),
    });
    const desc = describeOutputSchemaForLlm(schema);
    expect(desc).not.toBeNull();
    expect(desc).toContain("| null");
    expect(desc).toContain('"name"');
  });
});

describe("zod-schema-prompt supplement — ZodDefault wrapper", () => {
  it("describes ZodDefault wrapping a string", () => {
    const schema = z.object({ lang: z.string().default("zh") });
    const desc = describeOutputSchemaForLlm(schema);
    expect(desc).not.toBeNull();
    expect(desc).toContain("<string");
  });
});

describe("zod-schema-prompt supplement — unknown typeName fallback", () => {
  it("returns <unknown-type-name> for unrecognized ZodType", () => {
    // Create a schema with an unknown typeName by using a transform
    // ZodTransform is not handled → falls through to `<${typeName}>`
    const schema = z.object({
      val: z.string().transform((s) => s.toUpperCase()),
    });
    const desc = describeOutputSchemaForLlm(schema);
    // Should not crash, should still return a description
    expect(desc).not.toBeNull();
  });

  it("returns null when describeOne throws for invalid schema", () => {
    // Create an object that looks like a schema but will throw when iterated
    const badSchema = {
      _def: { typeName: "ZodObject" },
      shape: null, // accessing entries on null will throw
    } as unknown as z.ZodTypeAny;

    const desc = describeOutputSchemaForLlm(badSchema);
    expect(desc).toBeNull();
  });
});
