/**
 * RB5 conformance: playground businessInput zod schema 校验
 */

import {
  playgroundBusinessInputSchema,
  PlaygroundMissionInputRebuilder,
  PLAYGROUND_SNAPSHOT_SCHEMA_VERSION,
  type PlaygroundBusinessInput,
} from "../../../runtime/playground.input-rebuilder";
import type { RunMissionInput } from "../../../api/dto/run-mission.dto";

function makeValidBusinessInput(
  over: Partial<PlaygroundBusinessInput> = {},
): PlaygroundBusinessInput {
  return {
    depth: "standard",
    budgetProfile: "medium",
    styleProfile: "executive",
    lengthProfile: "standard",
    audienceProfile: "domain-expert",
    withFigures: true,
    auditLayers: "default",
    concurrency: 3,
    viewMode: "continuous",
    searchTimeRange: "365d",
    ...over,
  };
}

function makeRunMissionInput(
  over: Partial<RunMissionInput> = {},
): RunMissionInput {
  return {
    topic: "量子计算",
    language: "zh-CN",
    depth: "standard",
    budgetProfile: "medium",
    styleProfile: "executive",
    lengthProfile: "standard",
    audienceProfile: "domain-expert",
    withFigures: true,
    auditLayers: "default",
    concurrency: 3,
    viewMode: "continuous",
    searchTimeRange: "365d",
    ...over,
  } as RunMissionInput;
}

describe("playgroundBusinessInputSchema (RB5)", () => {
  it("合法 businessInput 通过 parse", () => {
    const input = makeValidBusinessInput();
    expect(() => playgroundBusinessInputSchema.parse(input)).not.toThrow();
    const parsed = playgroundBusinessInputSchema.parse(input);
    expect(parsed.depth).toBe("standard");
    expect(parsed.withFigures).toBe(true);
    expect(parsed.concurrency).toBe(3);
  });

  it("可选字段(knowledgeBaseIds/inheritFromMissionId)缺省时通过", () => {
    const input = makeValidBusinessInput();
    const parsed = playgroundBusinessInputSchema.parse(input);
    expect(parsed.knowledgeBaseIds).toBeUndefined();
    expect(parsed.inheritFromMissionId).toBeUndefined();
  });

  it("深度字段为合法枚举值时通过", () => {
    for (const depth of ["quick", "standard", "deep"] as const) {
      expect(() =>
        playgroundBusinessInputSchema.parse(makeValidBusinessInput({ depth })),
      ).not.toThrow();
    }
  });

  it("depth 为非法值被 schema.parse 拒绝", () => {
    const bad = { ...makeValidBusinessInput(), depth: "ultra" };
    expect(() => playgroundBusinessInputSchema.parse(bad)).toThrow();
  });

  it("缺少 depth 被 schema.parse 拒绝", () => {
    const { depth: _omit, ...rest } = makeValidBusinessInput();
    expect(() => playgroundBusinessInputSchema.parse(rest)).toThrow();
  });

  it("withFigures 为字符串被 schema.parse 拒绝", () => {
    const bad = { ...makeValidBusinessInput(), withFigures: "yes" };
    expect(() => playgroundBusinessInputSchema.parse(bad)).toThrow();
  });

  it("concurrency 超出范围(0)被 schema.parse 拒绝", () => {
    const bad = makeValidBusinessInput({ concurrency: 0 });
    expect(() => playgroundBusinessInputSchema.parse(bad)).toThrow();
  });

  it("concurrency 超出范围(11)被 schema.parse 拒绝", () => {
    const bad = makeValidBusinessInput({ concurrency: 11 });
    expect(() => playgroundBusinessInputSchema.parse(bad)).toThrow();
  });

  it("searchTimeRange 为非法值被 schema.parse 拒绝", () => {
    const bad = { ...makeValidBusinessInput(), searchTimeRange: "10y" };
    expect(() => playgroundBusinessInputSchema.parse(bad)).toThrow();
  });

  it("auditLayers 为非法值被 schema.parse 拒绝", () => {
    const bad = { ...makeValidBusinessInput(), auditLayers: "extreme" };
    expect(() => playgroundBusinessInputSchema.parse(bad)).toThrow();
  });

  it("knowledgeBaseIds 非 uuid 被 schema.parse 拒绝", () => {
    const bad = makeValidBusinessInput({
      knowledgeBaseIds: ["not-a-uuid"],
    });
    expect(() => playgroundBusinessInputSchema.parse(bad)).toThrow();
  });
});

describe("PlaygroundMissionInputRebuilder buildForFreshRun RB5 冻结校验", () => {
  const rb = new PlaygroundMissionInputRebuilder();

  it("合法 input 冻结 snapshot 成功,businessInput 经 zod 校验", () => {
    const snap = rb.buildForFreshRun(makeRunMissionInput({ depth: "deep" }));
    expect(snap.schemaVersion).toBe(PLAYGROUND_SNAPSHOT_SCHEMA_VERSION);
    expect(snap.businessInput.depth).toBe("deep");
    // budget/wallTime 不进 businessInput
    expect(
      (snap.businessInput as Record<string, unknown>).maxCredits,
    ).toBeUndefined();
    expect(
      (snap.businessInput as Record<string, unknown>).wallTimeMs,
    ).toBeUndefined();
  });
});
