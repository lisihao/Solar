/**
 * ToolSelector + ResultFusion 单测 (PR-P)
 */

import { ToolSelectorRegistry } from "../tool-selector-registry";
import { SimpleAllowlistSelector, type IToolSelector } from "../tool-selector";
import { SimpleConcatFusion } from "../result-fusion";
import type { IContextEnvelope } from "../../../agents/abstractions";

const fakeEnv = (tools: string[]): IContextEnvelope => ({
  id: "x",
  system: "",
  messages: [],
  reminders: [],
  tools,
  memory: { sessionId: "s" },
  budget: {
    tokensUsed: 0,
    tokensRemaining: 0,
    iterationsUsed: 0,
    iterationsRemaining: 0,
    wallTimeStartMs: 0,
  },
});

describe("ToolSelectorRegistry (PR-P)", () => {
  it("falls back to default selector when id unknown", () => {
    const reg = new ToolSelectorRegistry();
    const sel = reg.get("nonexistent");
    expect(sel).toBeInstanceOf(SimpleAllowlistSelector);
  });

  it("returns registered selector by id", () => {
    const reg = new ToolSelectorRegistry();
    const custom: IToolSelector = {
      id: "custom",
      select: () => ({ toolIds: ["a", "b"], parallel: true }),
    };
    reg.register(custom);
    expect(reg.get("custom")).toBe(custom);
  });

  it("default selector returns envelope.tools", async () => {
    const reg = new ToolSelectorRegistry();
    const sel = reg.get();
    const result = await sel.select({ envelope: fakeEnv(["t1", "t2", "t3"]) });
    expect(result.toolIds).toEqual(["t1", "t2", "t3"]);
  });
});

describe("SimpleConcatFusion (PR-P)", () => {
  it("dedupes by JSON identity", () => {
    const fusion = new SimpleConcatFusion();
    const results = new Map<string, unknown>([
      ["s1", [{ url: "a" }, { url: "b" }]],
      ["s2", [{ url: "b" }, { url: "c" }]],
    ]);
    const out = fusion.fuse({ results });
    expect(out.totalRaw).toBe(4);
    expect(out.totalDeduped).toBe(3);
    expect(out.bySource?.get("s1")).toBe(2);
    expect(out.bySource?.get("s2")).toBe(1); // 'b' 已被 s1 占用
  });

  it("handles non-array single results", () => {
    const fusion = new SimpleConcatFusion();
    const results = new Map<string, unknown>([
      ["s1", { single: 1 }],
      ["s2", { single: 2 }],
    ]);
    const out = fusion.fuse({ results });
    expect(out.merged).toHaveLength(2);
  });

  it("ignores null results", () => {
    const fusion = new SimpleConcatFusion();
    const results = new Map<string, unknown>([
      ["s1", null],
      ["s2", [{ x: 1 }]],
    ]);
    const out = fusion.fuse({ results });
    expect(out.totalDeduped).toBe(1);
  });
});
