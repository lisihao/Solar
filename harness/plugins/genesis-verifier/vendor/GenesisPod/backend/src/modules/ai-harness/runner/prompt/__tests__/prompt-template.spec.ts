/**
 * PromptTemplate + RuntimePromptRouter 单测 (PR-O)
 */

import { z } from "zod";
import { PromptTemplate } from "../prompt-template";
import { RuntimePromptRouter } from "../runtime-prompt-router";

describe("PromptTemplate (PR-O)", () => {
  it("renders variables", () => {
    const t = new PromptTemplate({
      id: "greet",
      version: "1.0.0",
      template: "Hello {{name}}, you have {{count}} messages",
      variables: [
        { name: "name", type: "string", required: true },
        { name: "count", type: "number", required: true },
      ],
    });
    expect(t.render({ name: "Alice", count: 3 })).toBe(
      "Hello Alice, you have 3 messages",
    );
  });

  it("supports nested path lookup", () => {
    const t = new PromptTemplate({
      id: "user-profile",
      version: "1.0.0",
      template: "User: {{user.name}} ({{user.email}})",
      variables: [{ name: "user", type: "object", required: true }],
    });
    expect(t.render({ user: { name: "A", email: "a@b.com" } })).toBe(
      "User: A (a@b.com)",
    );
  });

  it("rejects invalid variables via auto-built schema", () => {
    const t = new PromptTemplate({
      id: "x",
      version: "1.0.0",
      template: "{{n}}",
      variables: [{ name: "n", type: "number", required: true }],
    });
    expect(() => t.render({ n: "not a number" })).toThrow();
  });

  it("uses custom schema if provided", () => {
    const t = new PromptTemplate({
      id: "x",
      version: "1.0.0",
      template: "{{x}}",
      variables: [{ name: "x", type: "string" }],
      schema: z.object({ x: z.string().email() }).passthrough(),
    });
    expect(() => t.render({ x: "not-email" })).toThrow();
    expect(t.render({ x: "a@b.com" })).toBe("a@b.com");
  });

  it("checksum is stable for same inputs", () => {
    const a = new PromptTemplate({
      id: "x",
      version: "1.0.0",
      template: "abc",
      variables: [],
    });
    const b = new PromptTemplate({
      id: "x",
      version: "1.0.0",
      template: "abc",
      variables: [],
    });
    expect(a.checksum).toBe(b.checksum);
  });
});

describe("RuntimePromptRouter (PR-O)", () => {
  function tpl(
    id: string,
    version: string,
    template = "x",
    variant?: string,
    weight?: number,
  ) {
    return new PromptTemplate({
      id,
      version,
      template,
      variables: [],
      variant,
      weight,
    });
  }

  it("resolve returns active version", () => {
    const reg = new RuntimePromptRouter();
    reg.register(tpl("p", "1.0.0"));
    reg.register(tpl("p", "2.0.0"));
    expect(reg.resolve("p")?.version).toBe("2.0.0");
  });

  it("rollback removes newer versions and resets active", () => {
    const reg = new RuntimePromptRouter();
    reg.register(tpl("p", "1.0.0", "v1"));
    reg.register(tpl("p", "2.0.0", "v2"));
    reg.rollback("p", "1.0.0");
    expect(reg.resolve("p")?.template).toBe("v1");
    expect(reg.history("p").length).toBe(1);
  });

  it("A/B routes deterministically (same userId always same variant)", () => {
    const reg = new RuntimePromptRouter();
    reg.register(tpl("p", "1.0.0", "tA", "A", 50));
    reg.register(tpl("p", "1.0.0", "tB", "B", 50));
    // 同一 userId 多次 resolve 必返回同一 variant —— 这是核心契约
    for (const u of ["u1", "u2", "ux", "uy", "uz"]) {
      const a = reg.resolve("p", { userId: u });
      const b = reg.resolve("p", { userId: u });
      const c = reg.resolve("p", { userId: u });
      expect(a?.template).toBe(b?.template);
      expect(b?.template).toBe(c?.template);
    }
  });

  it("A/B routes split traffic across variants over enough samples", () => {
    const reg = new RuntimePromptRouter();
    reg.register(tpl("p", "1.0.0", "tA", "A", 50));
    reg.register(tpl("p", "1.0.0", "tB", "B", 50));
    const counts: Record<string, number> = { A: 0, B: 0 };
    for (let i = 0; i < 200; i += 1) {
      const t = reg.resolve("p", { userId: `user-${i}` });
      counts[t!.variant!] += 1;
    }
    // 50/50 分流，200 样本下两边都应至少 50 次（极宽松，避免随机失败）
    expect(counts.A).toBeGreaterThan(50);
    expect(counts.B).toBeGreaterThan(50);
  });

  it("forceVariant overrides hash-based routing", () => {
    const reg = new RuntimePromptRouter();
    reg.register(tpl("p", "1.0.0", "tA", "A"));
    reg.register(tpl("p", "1.0.0", "tB", "B"));
    expect(
      reg.resolve("p", { userId: "any", forceVariant: "B" })?.variant,
    ).toBe("B");
  });

  it("rollback uses semver numeric comparison (handles 10.0.0 > 9.0.0)", () => {
    const reg = new RuntimePromptRouter();
    reg.register(tpl("p", "1.0.0", "v1"));
    reg.register(tpl("p", "9.0.0", "v9"));
    reg.register(tpl("p", "10.0.0", "v10"));
    // 字典序里 "10" < "9"，但 semver 数值比较 10 > 9 → v10 应被删除
    reg.rollback("p", "9.0.0");
    expect(reg.history("p").length).toBe(2); // v1 + v9 残留
    expect(reg.resolve("p")?.template).toBe("v9");
  });

  it("rejects variable name containing '.' (path syntax conflict)", () => {
    expect(
      () =>
        new PromptTemplate({
          id: "bad",
          version: "1.0.0",
          template: "x",
          variables: [{ name: "user.email", type: "string" }],
        }),
    ).toThrow(/contains '\.'/);
  });
});
