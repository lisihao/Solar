import { SemanticToolSelector } from "../semantic-tool-selector";
import { ToolSelectorRegistry } from "../tool-selector-registry";
import type {
  ScoredRouterService,
  ToolRegistry,
  RoutableCandidate,
} from "@/modules/ai-engine/facade";
import type { IContextEnvelope } from "../../../agents/abstractions/context-envelope.interface";

const env = (tools: string[]): IContextEnvelope =>
  ({ tools }) as unknown as IContextEnvelope;

/** fake ToolRegistry：按 id 给描述；未知 id → undefined */
function fakeToolRegistry(descriptions: Record<string, string>): {
  reg: ToolRegistry;
  tryGetCalls: () => number;
} {
  let calls = 0;
  const reg = {
    tryGet: (id: string) => {
      calls++;
      return descriptions[id]
        ? { id, name: id, description: descriptions[id] }
        : undefined;
    },
  } as unknown as ToolRegistry;
  return { reg, tryGetCalls: () => calls };
}

/** mock ScoredRouter：回显前 topK 个候选为 ranked（语义已应用） */
function semanticRouter(): {
  router: ScoredRouterService;
  received: () => RoutableCandidate[];
} {
  let got: RoutableCandidate[] = [];
  const router = {
    route: jest.fn(async (cands: RoutableCandidate[], q: { topK?: number }) => {
      got = cands;
      const top = cands.slice(0, q.topK ?? cands.length);
      return {
        ranked: top.map((c) => ({
          candidate: c,
          score: {
            id: c.id,
            total: 1,
            relevance: 1,
            signalTotal: 0,
            breakdown: {},
          },
        })),
        chosen: top[0] ?? null,
        reason: "mock",
        semanticApplied: true,
      };
    }),
  } as unknown as ScoredRouterService;
  return { router, received: () => got };
}

const TEN = [
  "arxiv",
  "pubmed",
  "semantic-scholar",
  "weather-api",
  "finance-api",
  "calendar",
  "email",
  "github",
  "image-gen",
  "ocr",
];
const DESCS: Record<string, string> = Object.fromEntries(
  TEN.map((id) => [id, `${id} tool`]),
);

describe("SemanticToolSelector", () => {
  it("self-registers into the ToolSelectorRegistry as 'semantic'", () => {
    const reg = new ToolSelectorRegistry();
    const { router } = semanticRouter();
    const { reg: tr } = fakeToolRegistry(DESCS);
    const sel = new SemanticToolSelector(reg, router, tr);
    expect(reg.get("semantic")).toBe(sel);
  });

  it("below threshold (<=8 tools) → allowlist all, no embedding", async () => {
    const reg = new ToolSelectorRegistry();
    const { router } = semanticRouter();
    const { reg: tr, tryGetCalls } = fakeToolRegistry(DESCS);
    const sel = new SemanticToolSelector(reg, router, tr);

    const five = TEN.slice(0, 5);
    const res = await sel.select({ envelope: env(five), goal: "find papers" });
    expect(res.toolIds).toEqual(five);
    expect(res.rationale).toContain("allowlist");
    expect(router.route).not.toHaveBeenCalled();
    expect(tryGetCalls()).toBe(0); // 没解析描述 = 没 embed
  });

  it("empty goal → allowlist all even when many tools", async () => {
    const reg = new ToolSelectorRegistry();
    const { router } = semanticRouter();
    const { reg: tr } = fakeToolRegistry(DESCS);
    const sel = new SemanticToolSelector(reg, router, tr);

    const res = await sel.select({ envelope: env(TEN), goal: "   " });
    expect(res.toolIds).toEqual(TEN);
    expect(router.route).not.toHaveBeenCalled();
  });

  it("many tools + goal → semantic top-K subset (token reduction)", async () => {
    const reg = new ToolSelectorRegistry();
    const { router, received } = semanticRouter();
    const { reg: tr } = fakeToolRegistry(DESCS);
    const sel = new SemanticToolSelector(reg, router, tr);

    const res = await sel.select({
      envelope: env(TEN),
      goal: "academic research papers",
      hints: { topK: 3 },
    });
    // 10 → 3，子集
    expect(res.toolIds).toHaveLength(3);
    expect(res.toolIds).toEqual(["arxiv", "pubmed", "semantic-scholar"]);
    // 候选带上了描述（name. description）
    expect(received()[0]).toEqual({
      id: "arxiv",
      description: "arxiv. arxiv tool",
    });
  });

  it("degraded (embedding unavailable) → fail-open allowlist (never drop tools)", async () => {
    const reg = new ToolSelectorRegistry();
    const degraded = {
      route: jest.fn(async () => ({
        ranked: [],
        chosen: null,
        reason: "degraded",
        semanticApplied: false,
      })),
    } as unknown as ScoredRouterService;
    const { reg: tr } = fakeToolRegistry(DESCS);
    const sel = new SemanticToolSelector(reg, degraded, tr);

    const res = await sel.select({ envelope: env(TEN), goal: "papers" });
    expect(res.toolIds).toEqual(TEN); // 全保留
    expect(res.rationale).toContain("degraded");
  });

  it("tools without resolvable description are always kept", async () => {
    const reg = new ToolSelectorRegistry();
    const { router } = semanticRouter();
    // 只有前 9 个有描述，'mystery-tool' 无
    const { reg: tr } = fakeToolRegistry(DESCS);
    const sel = new SemanticToolSelector(reg, router, tr);

    const withUnknown = [...TEN.slice(0, 9), "mystery-tool"];
    const res = await sel.select({
      envelope: env(withUnknown),
      goal: "academic research papers",
      hints: { topK: 2 },
    });
    // 无描述的 mystery-tool 必须保留（追加在语义 top-2 之后）
    expect(res.toolIds).toContain("mystery-tool");
    expect(res.toolIds.slice(0, 2)).toEqual(["arxiv", "pubmed"]);
  });
});
