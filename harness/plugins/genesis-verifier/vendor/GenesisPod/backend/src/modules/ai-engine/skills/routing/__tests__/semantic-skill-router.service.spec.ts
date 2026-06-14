import { SemanticSkillRouter } from "../semantic-skill-router.service";
import type { SkillRegistry } from "../../registry/skill.registry";
import type { ScoredRouterService } from "../../../routing/scored-router.service";
import type { ISkill } from "../../abstractions/skill.interface";

function skill(partial: Partial<ISkill> & { id: string }): ISkill {
  return {
    name: partial.id,
    description: partial.id,
    layer: "content",
    domain: "general",
    ...partial,
  } as ISkill;
}

const OUTLINE = skill({
  id: "outline-planning",
  name: "Outline Planning",
  description: "plan document outline structure",
  layer: "planning",
  domain: "writing",
});
const IMAGE = skill({
  id: "image-gen",
  name: "Image Generation",
  description: "generate images from prompts",
  domain: "image",
});

function makeRegistry(
  all: ISkill[],
  triggerHits: ISkill[] = [],
): SkillRegistry {
  return {
    getAll: () => all,
    matchByTrigger: jest.fn(() => triggerHits),
  } as unknown as SkillRegistry;
}

describe("SemanticSkillRouter", () => {
  it("trigger hit wins (rule-first, no semantic call)", async () => {
    const registry = makeRegistry([OUTLINE, IMAGE], [OUTLINE]);
    const scored = { route: jest.fn() } as unknown as ScoredRouterService;
    const router = new SemanticSkillRouter(registry, scored);

    const res = await router.selectSkill("help me outline a doc");
    expect(res.via).toBe("trigger");
    expect(res.skill?.id).toBe("outline-planning");
    expect(scored.route).not.toHaveBeenCalled();
  });

  it("falls back to semantic when no trigger hit", async () => {
    const registry = makeRegistry([OUTLINE, IMAGE], []);
    const scored = {
      route: jest.fn(async () => ({
        ranked: [
          {
            candidate: { id: "image-gen", description: "" },
            score: { id: "image-gen", total: 50, relevance: 40, breakdown: {} },
          },
          {
            candidate: { id: "outline-planning", description: "" },
            score: {
              id: "outline-planning",
              total: 10,
              relevance: 5,
              breakdown: {},
            },
          },
        ],
        chosen: { id: "image-gen", description: "" },
        reason: "r",
        semanticApplied: true,
      })),
    } as unknown as ScoredRouterService;
    const router = new SemanticSkillRouter(registry, scored);

    const res = await router.selectSkill("draw a picture of a cat");
    expect(res.via).toBe("semantic");
    expect(res.skill?.id).toBe("image-gen");
    expect(res.ranked[0].skill.id).toBe("image-gen");
  });

  it("scope filter restricts candidates by domain", async () => {
    const registry = makeRegistry([OUTLINE, IMAGE], []);
    const captured: { ids: string[] } = { ids: [] };
    const scored = {
      route: jest.fn(async (cands: Array<{ id: string }>) => {
        captured.ids = cands.map((c) => c.id);
        return { ranked: [], chosen: null, reason: "", semanticApplied: true };
      }),
    } as unknown as ScoredRouterService;
    const router = new SemanticSkillRouter(registry, scored);

    await router.routeByTask("anything", { domain: "writing" });
    expect(captured.ids).toEqual(["outline-planning"]); // image-gen 被 domain 过滤掉
  });

  it("marks via=degraded when embedding unavailable", async () => {
    const registry = makeRegistry([OUTLINE], []);
    const scored = {
      route: jest.fn(async () => ({
        ranked: [
          {
            candidate: { id: "outline-planning", description: "" },
            score: {
              id: "outline-planning",
              total: 30,
              relevance: 0,
              breakdown: {},
            },
          },
        ],
        chosen: { id: "outline-planning", description: "" },
        reason: "degraded",
        semanticApplied: false,
      })),
    } as unknown as ScoredRouterService;
    const router = new SemanticSkillRouter(registry, scored);

    const res = await router.routeByTask("plan a doc");
    expect(res.via).toBe("degraded");
    expect(res.skill?.id).toBe("outline-planning");
  });
});
