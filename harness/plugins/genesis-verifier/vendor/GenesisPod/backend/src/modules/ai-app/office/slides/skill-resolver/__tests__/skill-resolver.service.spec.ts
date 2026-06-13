import { Test, TestingModule } from "@nestjs/testing";
import { SkillResolver } from "../skill-resolver.service";
import { SkillPolicyRegistry } from "../skill-policy.registry";
import { PresetLoader } from "../preset-loader.service";
import { DEFAULT_SKILL_BY_SLOT, SlidesSlot } from "../slot-ids";
import type { Preset } from "../skill-policy.types";

/**
 * Verifies the precedence ladder: default → policy → preset → override.
 * Also covers guard branches (unknown slot, missing preset, empty skillId).
 */
describe("SkillResolver", () => {
  let resolver: SkillResolver;
  let registry: SkillPolicyRegistry;
  let presetLoader: jest.Mocked<Pick<PresetLoader, "get">>;

  beforeEach(async () => {
    presetLoader = { get: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SkillResolver,
        SkillPolicyRegistry,
        { provide: PresetLoader, useValue: presetLoader },
      ],
    }).compile();

    resolver = module.get(SkillResolver);
    registry = module.get(SkillPolicyRegistry);
  });

  // ──────────────────── Layer 4: defaults ────────────────────
  it("returns defaults when no hints, no preset, no overrides", () => {
    const result = resolver.resolve({ conditions: {} });

    expect(result.bindings[SlidesSlot.PLAN_OUTLINE]).toBe(
      DEFAULT_SKILL_BY_SLOT[SlidesSlot.PLAN_OUTLINE],
    );
    expect(result.provenance[SlidesSlot.PLAN_OUTLINE]).toBe("default");
    expect(result.presetId).toBeUndefined();
  });

  it("provenance is 'default' for every slot when nothing matches", () => {
    const result = resolver.resolve({ conditions: {} });
    for (const slot of Object.values(SlidesSlot)) {
      expect(result.provenance[slot]).toBe("default");
    }
  });

  // ──────────────────── Layer 3: policy ────────────────────
  it("applies a matching policy over default", () => {
    registry.register({
      slot: SlidesSlot.PLAN_OUTLINE,
      match: { sourceType: "topic-insights" },
      skillId: "outline-exec-brief",
      priority: 10,
    });

    const result = resolver.resolve({
      conditions: { sourceType: "topic-insights" },
    });

    expect(result.bindings[SlidesSlot.PLAN_OUTLINE]).toBe("outline-exec-brief");
    expect(result.provenance[SlidesSlot.PLAN_OUTLINE]).toBe("policy");
  });

  it("picks the highest-priority policy when multiple match", () => {
    registry.registerAll([
      {
        slot: SlidesSlot.PLAN_OUTLINE,
        match: { sourceType: "topic-insights" },
        skillId: "outline-A",
        priority: 5,
      },
      {
        slot: SlidesSlot.PLAN_OUTLINE,
        match: { sourceType: "topic-insights" },
        skillId: "outline-B",
        priority: 50,
      },
    ]);

    const result = resolver.resolve({
      conditions: { sourceType: "topic-insights" },
    });

    expect(result.bindings[SlidesSlot.PLAN_OUTLINE]).toBe("outline-B");
  });

  it("does not apply policy when conditions mismatch", () => {
    registry.register({
      slot: SlidesSlot.PLAN_OUTLINE,
      match: { sourceType: "topic-insights" },
      skillId: "outline-exec-brief",
      priority: 10,
    });

    const result = resolver.resolve({
      conditions: { sourceType: "writing" },
    });

    expect(result.bindings[SlidesSlot.PLAN_OUTLINE]).toBe(
      DEFAULT_SKILL_BY_SLOT[SlidesSlot.PLAN_OUTLINE],
    );
    expect(result.provenance[SlidesSlot.PLAN_OUTLINE]).toBe("default");
  });

  it("treats undefined rule fields as wildcards", () => {
    registry.register({
      slot: SlidesSlot.PLAN_OUTLINE,
      match: {}, // wildcard
      skillId: "outline-any",
      priority: 1,
    });

    const result = resolver.resolve({ conditions: { sourceType: "writing" } });
    expect(result.bindings[SlidesSlot.PLAN_OUTLINE]).toBe("outline-any");
  });

  // ──────────────────── Layer 2: preset ────────────────────
  it("preset overrides policy and default", () => {
    registry.register({
      slot: SlidesSlot.PLAN_OUTLINE,
      match: { sourceType: "topic-insights" },
      skillId: "outline-policy",
      priority: 10,
    });
    const preset: Preset = {
      id: "test.preset",
      bindings: { [SlidesSlot.PLAN_OUTLINE]: "outline-preset" },
    };
    presetLoader.get.mockReturnValue(preset);

    const result = resolver.resolve({
      conditions: { sourceType: "topic-insights" },
      presetId: "test.preset",
    });

    expect(result.bindings[SlidesSlot.PLAN_OUTLINE]).toBe("outline-preset");
    expect(result.provenance[SlidesSlot.PLAN_OUTLINE]).toBe("preset");
    expect(result.presetId).toBe("test.preset");
  });

  it("unknown preset id falls through (policy/default still apply)", () => {
    registry.register({
      slot: SlidesSlot.PLAN_OUTLINE,
      match: {},
      skillId: "outline-policy",
      priority: 1,
    });
    presetLoader.get.mockReturnValue(undefined);

    const result = resolver.resolve({
      conditions: {},
      presetId: "nope",
    });

    expect(result.bindings[SlidesSlot.PLAN_OUTLINE]).toBe("outline-policy");
    expect(result.presetId).toBeUndefined();
  });

  it("preset with empty skillId does not overwrite default", () => {
    presetLoader.get.mockReturnValue({
      id: "blank.preset",
      bindings: { [SlidesSlot.PLAN_OUTLINE]: "" },
    });

    const result = resolver.resolve({
      conditions: {},
      presetId: "blank.preset",
    });

    expect(result.bindings[SlidesSlot.PLAN_OUTLINE]).toBe(
      DEFAULT_SKILL_BY_SLOT[SlidesSlot.PLAN_OUTLINE],
    );
    expect(result.provenance[SlidesSlot.PLAN_OUTLINE]).toBe("default");
  });

  // ──────────────────── Layer 1: override ────────────────────
  it("override wins over preset + policy + default", () => {
    registry.register({
      slot: SlidesSlot.PLAN_OUTLINE,
      match: {},
      skillId: "outline-policy",
      priority: 1,
    });
    presetLoader.get.mockReturnValue({
      id: "p",
      bindings: { [SlidesSlot.PLAN_OUTLINE]: "outline-preset" },
    });

    const result = resolver.resolve({
      conditions: {},
      presetId: "p",
      overrides: { [SlidesSlot.PLAN_OUTLINE]: "outline-user" },
    });

    expect(result.bindings[SlidesSlot.PLAN_OUTLINE]).toBe("outline-user");
    expect(result.provenance[SlidesSlot.PLAN_OUTLINE]).toBe("override");
  });

  it("override to unknown slot is ignored (guard branch)", () => {
    const result = resolver.resolve({
      conditions: {},
      overrides: { "no.such.slot": "x" } as never,
    });

    // The built-in slots remain at defaults
    expect(result.bindings[SlidesSlot.PLAN_OUTLINE]).toBe(
      DEFAULT_SKILL_BY_SLOT[SlidesSlot.PLAN_OUTLINE],
    );
    // Unknown key not silently injected
    expect(
      (result.bindings as Record<string, string>)["no.such.slot"],
    ).toBeUndefined();
  });

  it("override with empty skillId is ignored (keeps lower layer)", () => {
    presetLoader.get.mockReturnValue({
      id: "p",
      bindings: { [SlidesSlot.PLAN_OUTLINE]: "outline-preset" },
    });

    const result = resolver.resolve({
      conditions: {},
      presetId: "p",
      overrides: { [SlidesSlot.PLAN_OUTLINE]: "" },
    });

    expect(result.bindings[SlidesSlot.PLAN_OUTLINE]).toBe("outline-preset");
    expect(result.provenance[SlidesSlot.PLAN_OUTLINE]).toBe("preset");
  });

  // ──────────────────── Guard: empty skillId on policy ────────────────────
  it("policy with empty skillId is treated as no-op (falls through)", () => {
    // Defensively ignored — prevents a bad policy from blanking the slot.
    registry.register({
      slot: SlidesSlot.PLAN_OUTLINE,
      match: {},
      skillId: "",
      priority: 100,
    });

    const result = resolver.resolve({ conditions: {} });

    expect(result.bindings[SlidesSlot.PLAN_OUTLINE]).toBe(
      DEFAULT_SKILL_BY_SLOT[SlidesSlot.PLAN_OUTLINE],
    );
    expect(result.provenance[SlidesSlot.PLAN_OUTLINE]).toBe("default");
  });

  // ──────────────────── Partial bindings don't clobber ────────────────────
  it("preset only affects slots it explicitly binds; others stay default/policy", () => {
    registry.register({
      slot: SlidesSlot.POLISH_FACT_CHECK,
      match: {},
      skillId: "fact-policy",
      priority: 1,
    });
    presetLoader.get.mockReturnValue({
      id: "p",
      bindings: { [SlidesSlot.PLAN_OUTLINE]: "only-outline" },
    });

    const result = resolver.resolve({ conditions: {}, presetId: "p" });

    expect(result.bindings[SlidesSlot.PLAN_OUTLINE]).toBe("only-outline");
    expect(result.bindings[SlidesSlot.POLISH_FACT_CHECK]).toBe("fact-policy");
    expect(result.bindings[SlidesSlot.RENDER_TEMPLATE]).toBe(
      DEFAULT_SKILL_BY_SLOT[SlidesSlot.RENDER_TEMPLATE],
    );
  });
});
