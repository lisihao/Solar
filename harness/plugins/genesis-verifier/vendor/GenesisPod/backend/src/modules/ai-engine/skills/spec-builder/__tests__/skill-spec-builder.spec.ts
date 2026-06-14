/**
 * SkillSpecBuilder + OutputSchemaRegistry spec (v5.1 R1-A0)
 */
import { z } from "zod";
import {
  OutputSchemaRegistry,
  FREE_TEXT_OUTPUT_SCHEMA,
} from "../output-schema-registry";
import { SkillSpecBuilder } from "../skill-spec-builder.service";

function makeFakeToolRegistry(registeredIds: string[]) {
  const set = new Set(registeredIds);
  return {
    has: (id: string) => set.has(id),
  } as unknown as Parameters<typeof SkillSpecBuilder.prototype.constructor>[0];
}

describe("OutputSchemaRegistry (v5.1 R1-A0)", () => {
  it("register / get / has / size", () => {
    const r = new OutputSchemaRegistry();
    const s = z.object({ a: z.string() });
    r.register("test.schema", s);
    expect(r.has("test.schema")).toBe(true);
    expect(r.get("test.schema")).toBe(s);
    expect(r.size()).toBe(1);
  });

  it("duplicate id 抛错（不允许 silent override）", () => {
    const r = new OutputSchemaRegistry();
    r.register("dup", z.string());
    expect(() => r.register("dup", z.number())).toThrow(/collision/);
  });

  it("get 不存在时抛错（fail-fast）", () => {
    const r = new OutputSchemaRegistry();
    expect(() => r.get("missing")).toThrow(/schema not found/);
  });

  it("tryGet 返回 undefined", () => {
    const r = new OutputSchemaRegistry();
    expect(r.tryGet("missing")).toBeUndefined();
  });

  it("listIds 字典序", () => {
    const r = new OutputSchemaRegistry();
    r.register("c.s", z.unknown());
    r.register("a.s", z.unknown());
    r.register("b.s", z.unknown());
    expect(r.listIds()).toEqual(["a.s", "b.s", "c.s"]);
  });
});

describe("SkillSpecBuilder (v5.1 R1-A0)", () => {
  it("build：完整字段映射到 ISkillExecSpec", () => {
    const tools = makeFakeToolRegistry(["web-search", "rag-search"]);
    const schemas = new OutputSchemaRegistry();
    schemas.register("test.out", z.object({ ok: z.boolean() }));
    const builder = new SkillSpecBuilder(tools, schemas);

    const spec = builder.build({
      id: "playground.leader",
      instructions: "You are leader. Plan dimensions.",
      allowedTools: ["web-search", "rag-search"],
      allowedModels: ["claude-sonnet-4-6"],
      outputSchemaRef: "test.out",
      version: "1.0",
      domain: "research",
    });

    expect(spec.id).toBe("playground.leader");
    expect(spec.systemPrompt).toBe("You are leader. Plan dimensions.");
    expect(spec.allowedToolIds).toEqual(["web-search", "rag-search"]);
    expect(spec.allowedModels).toEqual(["claude-sonnet-4-6"]);
    expect(spec.outputSchema).toBe(schemas.get("test.out"));
    expect(spec.meta.skillVersion).toBe("1.0");
    expect(spec.meta.skillDomain).toBe("research");
  });

  it("allowedTools 含未注册 id → 过滤掉（warn but not fail）", () => {
    const tools = makeFakeToolRegistry(["web-search"]);
    const schemas = new OutputSchemaRegistry();
    const builder = new SkillSpecBuilder(tools, schemas);

    const spec = builder.build({
      id: "test",
      instructions: "x",
      allowedTools: ["web-search", "nonexistent-tool", "another-missing"],
    });
    expect(spec.allowedToolIds).toEqual(["web-search"]);
  });

  it("allowedTools=undefined → 空数组（runner 自行决定全开）", () => {
    const tools = makeFakeToolRegistry([]);
    const schemas = new OutputSchemaRegistry();
    const builder = new SkillSpecBuilder(tools, schemas);

    const spec = builder.build({ id: "test", instructions: "x" });
    expect(spec.allowedToolIds).toEqual([]);
  });

  it("无 outputSchemaRef → 使用 FREE_TEXT_OUTPUT_SCHEMA（z.unknown）", () => {
    const tools = makeFakeToolRegistry([]);
    const schemas = new OutputSchemaRegistry();
    const builder = new SkillSpecBuilder(tools, schemas);
    const spec = builder.build({ id: "test", instructions: "x" });
    expect(spec.outputSchema).toBe(FREE_TEXT_OUTPUT_SCHEMA);
    // 验证 zod schema 接受任意值
    expect(spec.outputSchema.safeParse(null).success).toBe(true);
    expect(spec.outputSchema.safeParse({ x: 1 }).success).toBe(true);
  });

  it("outputSchemaRef 未注册 → fail-fast 抛错", () => {
    const tools = makeFakeToolRegistry([]);
    const schemas = new OutputSchemaRegistry();
    const builder = new SkillSpecBuilder(tools, schemas);
    expect(() =>
      builder.build({
        id: "buggy-skill",
        instructions: "x",
        outputSchemaRef: "missing-ref",
      }),
    ).toThrow(/references outputSchema "missing-ref" which is not registered/);
  });

  it("ISkillExecSpec 是纯数据对象（structuredClone 友好）", () => {
    const tools = makeFakeToolRegistry(["t1"]);
    const schemas = new OutputSchemaRegistry();
    const builder = new SkillSpecBuilder(tools, schemas);
    const spec = builder.build({
      id: "x",
      instructions: "y",
      allowedTools: ["t1"],
    });
    // 仅 outputSchema 是 zod 实例（不可 structuredClone）；其他全可序列化
    const { outputSchema, ...serializable } = spec;
    void outputSchema; // mark used for lint
    expect(() => structuredClone(serializable)).not.toThrow();
  });
});
