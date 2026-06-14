/**
 * RB5 conformance: social businessInput zod schema 校验
 */

import {
  buildSocialConfigSnapshot,
  socialBusinessInputSchema,
  type SocialBusinessInput,
} from "../social-mission-config-snapshot";

function makeValidInput(
  over: Partial<SocialBusinessInput> = {},
): SocialBusinessInput {
  return {
    contentId: "content-abc-123",
    platforms: ["twitter", "linkedin"],
    connectionIds: { twitter: "conn-1", linkedin: "conn-2" },
    depth: "standard",
    budgetProfile: "medium",
    ...over,
  };
}

describe("socialBusinessInputSchema (RB5)", () => {
  it("合法 input 通过 parse", () => {
    const input = makeValidInput();
    expect(() => socialBusinessInputSchema.parse(input)).not.toThrow();
    const parsed = socialBusinessInputSchema.parse(input);
    expect(parsed.contentId).toBe("content-abc-123");
    expect(parsed.platforms).toEqual(["twitter", "linkedin"]);
    expect(parsed.depth).toBe("standard");
  });

  it("缺少 contentId 字段被 schema.parse 拒绝", () => {
    const bad = { ...makeValidInput(), contentId: undefined };
    expect(() => socialBusinessInputSchema.parse(bad)).toThrow();
  });

  it("contentId 为空字符串被 schema.parse 拒绝", () => {
    const bad = makeValidInput({ contentId: "" });
    expect(() => socialBusinessInputSchema.parse(bad)).toThrow();
  });

  it("platforms 非数组被 schema.parse 拒绝", () => {
    const bad = { ...makeValidInput(), platforms: "twitter" };
    expect(() => socialBusinessInputSchema.parse(bad)).toThrow();
  });

  it("缺少 depth 字段被 schema.parse 拒绝", () => {
    const { depth: _omit, ...rest } = makeValidInput();
    expect(() => socialBusinessInputSchema.parse(rest)).toThrow();
  });

  it("connectionIds 非 record 被 schema.parse 拒绝", () => {
    const bad = { ...makeValidInput(), connectionIds: ["x"] };
    expect(() => socialBusinessInputSchema.parse(bad)).toThrow();
  });
});

describe("buildSocialConfigSnapshot (RB5 冻结校验)", () => {
  it("合法 businessInput 冻结成功", () => {
    const snap = buildSocialConfigSnapshot({
      businessInput: makeValidInput(),
      language: "zh-CN",
      maxCredits: 1000,
      budgetMultiplier: 2,
      wallTimeCapMs: 300_000,
    });
    expect(snap.businessInput.contentId).toBe("content-abc-123");
    expect(snap.topic).toBe("content-abc-123");
    expect(snap.language).toBe("zh-CN");
    expect(snap.schemaVersion).toBe(1);
  });

  it("非法 businessInput(缺 contentId)冻结时抛错", () => {
    const bad = { ...makeValidInput(), contentId: "" } as SocialBusinessInput;
    expect(() =>
      buildSocialConfigSnapshot({
        businessInput: bad,
        language: "zh-CN",
        maxCredits: 1000,
        budgetMultiplier: 2,
        wallTimeCapMs: 300_000,
      }),
    ).toThrow();
  });

  it("非法 businessInput(platforms 不是数组)冻结时抛错", () => {
    const bad = {
      ...makeValidInput(),
      platforms: "twitter" as unknown as string[],
    } as SocialBusinessInput;
    expect(() =>
      buildSocialConfigSnapshot({
        businessInput: bad,
        language: "zh-CN",
        maxCredits: 1000,
        budgetMultiplier: 2,
        wallTimeCapMs: 300_000,
      }),
    ).toThrow();
  });
});
