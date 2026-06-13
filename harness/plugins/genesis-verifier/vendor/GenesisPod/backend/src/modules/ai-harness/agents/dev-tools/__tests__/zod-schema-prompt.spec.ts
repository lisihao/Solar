import { z } from "zod";
import { describeOutputSchemaForLlm } from "../zod-schema-prompt";

describe("describeOutputSchemaForLlm", () => {
  it("returns null for undefined schema", () => {
    expect(describeOutputSchemaForLlm(undefined)).toBeNull();
  });

  it("describes a simple object schema", () => {
    const schema = z.object({ name: z.string(), count: z.number() });
    const desc = describeOutputSchemaForLlm(schema);
    expect(desc).not.toBeNull();
    expect(desc).toContain('"name"');
    expect(desc).toContain('"count"');
    expect(desc).toContain("<string");
    expect(desc).toContain("<number");
  });

  it("describes nested object schema", () => {
    const schema = z.object({
      outer: z.object({ inner: z.string() }),
    });
    const desc = describeOutputSchemaForLlm(schema);
    expect(desc).toContain('"outer"');
    expect(desc).toContain('"inner"');
  });

  it("describes array schema", () => {
    const schema = z.object({ items: z.array(z.string()) });
    const desc = describeOutputSchemaForLlm(schema);
    expect(desc).toContain('"items"');
    expect(desc).toContain("<string");
  });

  it("describes optional fields", () => {
    const schema = z.object({
      required: z.string(),
      opt: z.string().optional(),
    });
    const desc = describeOutputSchemaForLlm(schema);
    expect(desc).toContain("optional");
  });

  it("describes nullable fields", () => {
    const schema = z.object({ val: z.string().nullable() });
    const desc = describeOutputSchemaForLlm(schema);
    expect(desc).toContain("| null");
  });

  it("describes enum fields", () => {
    const schema = z.object({
      status: z.enum(["active", "inactive", "pending"]),
    });
    const desc = describeOutputSchemaForLlm(schema);
    expect(desc).toContain('"active"');
    expect(desc).toContain('"inactive"');
  });

  it("describes boolean fields", () => {
    const schema = z.object({ enabled: z.boolean() });
    const desc = describeOutputSchemaForLlm(schema);
    expect(desc).toContain("<boolean>");
  });

  it("describes number with constraints", () => {
    const schema = z.object({ score: z.number().min(0).max(100).int() });
    const desc = describeOutputSchemaForLlm(schema);
    expect(desc).toContain(">=0");
    expect(desc).toContain("<=100");
    expect(desc).toContain("integer");
  });

  it("describes string with constraints", () => {
    const schema = z.object({ name: z.string().min(2).max(50) });
    const desc = describeOutputSchemaForLlm(schema);
    expect(desc).toContain(">=2 chars");
    expect(desc).toContain("<=50 chars");
  });

  it("describes string with url constraint", () => {
    const schema = z.object({ link: z.string().url() });
    const desc = describeOutputSchemaForLlm(schema);
    expect(desc).toContain("URL");
  });

  it("describes string with email constraint", () => {
    const schema = z.object({ email: z.string().email() });
    const desc = describeOutputSchemaForLlm(schema);
    expect(desc).toContain("email");
  });

  it("describes union types", () => {
    const schema = z.object({ val: z.union([z.string(), z.number()]) });
    const desc = describeOutputSchemaForLlm(schema);
    expect(desc).toContain("|");
  });

  it("describes literal types", () => {
    const schema = z.object({ kind: z.literal("fixed") });
    const desc = describeOutputSchemaForLlm(schema);
    expect(desc).toContain('"fixed"');
  });

  it("describes ZodDefault", () => {
    const schema = z.object({ count: z.number().default(0) });
    const desc = describeOutputSchemaForLlm(schema);
    expect(desc).toContain("<number");
  });

  it("describes ZodRecord", () => {
    const schema = z.object({ meta: z.record(z.string(), z.number()) });
    const desc = describeOutputSchemaForLlm(schema);
    expect(desc).toContain("<key>");
  });

  it("describes ZodAny", () => {
    const schema = z.object({ data: z.any() });
    const desc = describeOutputSchemaForLlm(schema);
    expect(desc).toContain("<any>");
  });

  it("describes array with min/max constraints", () => {
    const schema = z.object({ items: z.array(z.string()).min(1).max(5) });
    const desc = describeOutputSchemaForLlm(schema);
    expect(desc).not.toBeNull();
  });

  it("includes required output schema header", () => {
    const schema = z.object({ name: z.string() });
    const desc = describeOutputSchemaForLlm(schema);
    expect(desc).toContain("Required output schema");
  });
});
