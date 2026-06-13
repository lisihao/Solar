/**
 * RB5 conformance: radar businessInput zod schema 校验
 */

import {
  buildRadarConfigSnapshot,
  radarBusinessInputSchema,
  type RadarBusinessInput,
} from "../radar-mission-config-snapshot";

function makeValidInput(
  over: Partial<RadarBusinessInput> = {},
): RadarBusinessInput {
  return {
    topicId: "topic-uuid-001",
    topicName: "AI 芯片市场",
    trigger: "manual",
    ...over,
  };
}

describe("radarBusinessInputSchema (RB5)", () => {
  it("合法 input 通过 parse", () => {
    const input = makeValidInput({
      description: "芯片产业分析",
      keywords: ["NVIDIA", "AMD"],
    });
    const parsed = radarBusinessInputSchema.parse(input);
    expect(parsed.topicId).toBe("topic-uuid-001");
    expect(parsed.topicName).toBe("AI 芯片市场");
    expect(parsed.trigger).toBe("manual");
    expect(parsed.keywords).toEqual(["NVIDIA", "AMD"]);
  });

  it("可选字段全部缺省时通过 parse", () => {
    const minimal = makeValidInput();
    expect(() => radarBusinessInputSchema.parse(minimal)).not.toThrow();
    const parsed = radarBusinessInputSchema.parse(minimal);
    expect(parsed.description).toBeUndefined();
    expect(parsed.keywords).toBeUndefined();
    expect(parsed.entityType).toBeUndefined();
    expect(parsed.refreshCron).toBeUndefined();
  });

  it("description 可以为 null", () => {
    const input = makeValidInput({ description: null });
    expect(() => radarBusinessInputSchema.parse(input)).not.toThrow();
  });

  it("缺少 topicId 被 schema.parse 拒绝", () => {
    const { topicId: _omit, ...rest } = makeValidInput();
    expect(() => radarBusinessInputSchema.parse(rest)).toThrow();
  });

  it("topicId 为空字符串被 schema.parse 拒绝", () => {
    const bad = makeValidInput({ topicId: "" });
    expect(() => radarBusinessInputSchema.parse(bad)).toThrow();
  });

  it("topicName 为空字符串被 schema.parse 拒绝", () => {
    const bad = makeValidInput({ topicName: "" });
    expect(() => radarBusinessInputSchema.parse(bad)).toThrow();
  });

  it("trigger 缺失被 schema.parse 拒绝", () => {
    const { trigger: _omit, ...rest } = makeValidInput();
    expect(() => radarBusinessInputSchema.parse(rest)).toThrow();
  });

  it("keywords 非数组被 schema.parse 拒绝", () => {
    const bad = { ...makeValidInput(), keywords: "NVIDIA" };
    expect(() => radarBusinessInputSchema.parse(bad)).toThrow();
  });
});

describe("buildRadarConfigSnapshot (RB5 冻结校验)", () => {
  it("合法 businessInput 冻结成功", () => {
    const snap = buildRadarConfigSnapshot({
      businessInput: makeValidInput(),
      language: "zh-CN",
      maxCredits: 500,
      budgetMultiplier: 1.5,
      wallTimeCapMs: 600_000,
    });
    expect(snap.businessInput.topicId).toBe("topic-uuid-001");
    expect(snap.topic).toBe("AI 芯片市场");
    expect(snap.language).toBe("zh-CN");
    expect(snap.schemaVersion).toBe(1);
  });

  it("language 缺省时 fallback 到 zh-CN", () => {
    const snap = buildRadarConfigSnapshot({
      businessInput: makeValidInput(),
      maxCredits: 500,
      budgetMultiplier: 1.5,
      wallTimeCapMs: 600_000,
    });
    expect(snap.language).toBe("zh-CN");
  });

  it("非法 businessInput(topicId 为空)冻结时抛错", () => {
    const bad = makeValidInput({ topicId: "" });
    expect(() =>
      buildRadarConfigSnapshot({
        businessInput: bad,
        maxCredits: 500,
        budgetMultiplier: 1.5,
        wallTimeCapMs: 600_000,
      }),
    ).toThrow();
  });

  it("非法 businessInput(trigger 缺失)冻结时抛错", () => {
    const { trigger: _omit, ...rest } = makeValidInput();
    const bad = rest as RadarBusinessInput;
    expect(() =>
      buildRadarConfigSnapshot({
        businessInput: bad,
        maxCredits: 500,
        budgetMultiplier: 1.5,
        wallTimeCapMs: 600_000,
      }),
    ).toThrow();
  });
});
