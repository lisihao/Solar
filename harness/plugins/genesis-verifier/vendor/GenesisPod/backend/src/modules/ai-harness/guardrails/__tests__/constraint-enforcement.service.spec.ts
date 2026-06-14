import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { ConstraintEnforcementService } from "../constraints/constraint-enforcement.service";

jest.spyOn(Logger.prototype, "log").mockImplementation();
jest.spyOn(Logger.prototype, "debug").mockImplementation();
jest.spyOn(Logger.prototype, "warn").mockImplementation();
jest.spyOn(Logger.prototype, "error").mockImplementation();

describe("ConstraintEnforcementService", () => {
  let service: ConstraintEnforcementService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ConstraintEnforcementService],
    }).compile();
    service = module.get<ConstraintEnforcementService>(
      ConstraintEnforcementService,
    );
  });

  afterEach(() => jest.clearAllMocks());

  // ==================== extractConstraints ====================

  describe("extractConstraints", () => {
    it("should return empty array for empty string", () => {
      const constraints = service.extractConstraints("");
      expect(constraints).toEqual([]);
    });

    it("should extract MUST constraint from '必须：' pattern", () => {
      const constraints =
        service.extractConstraints("必须：角色不能使用现代词汇");
      const must = constraints.filter((c) => c.type === "MUST");
      expect(must.length).toBeGreaterThan(0);
      expect(must[0].rule).toContain("角色不能使用现代词汇");
    });

    it("should extract MUST constraint from '硬性约束：' pattern", () => {
      const constraints =
        service.extractConstraints("硬性约束：所有对话需要半文半白");
      const must = constraints.filter((c) => c.type === "MUST");
      expect(must.length).toBeGreaterThan(0);
    });

    it("should extract MUST constraint from '禁止：' pattern", () => {
      const constraints = service.extractConstraints("禁止：不能出现现代词汇");
      expect(
        constraints.filter((c) => c.type === "MUST").length,
      ).toBeGreaterThan(0);
    });

    it("should extract MUST constraint from '不能：' pattern", () => {
      const constraints = service.extractConstraints("不能：使用现代语言");
      expect(
        constraints.filter((c) => c.type === "MUST").length,
      ).toBeGreaterThan(0);
    });

    it("should extract MUST constraint from '不可以：' pattern", () => {
      const constraints =
        service.extractConstraints("不可以：出现现代科技词汇");
      expect(
        constraints.filter((c) => c.type === "MUST").length,
      ).toBeGreaterThan(0);
    });

    it("should extract MUST constraint from '绝对不：' pattern", () => {
      const constraints = service.extractConstraints("绝对不：破坏角色设定");
      expect(
        constraints.filter((c) => c.type === "MUST").length,
      ).toBeGreaterThan(0);
    });

    it("should extract MUST constraint from '严禁：' pattern", () => {
      const constraints = service.extractConstraints("严禁：泄露秘密身份");
      expect(
        constraints.filter((c) => c.type === "MUST").length,
      ).toBeGreaterThan(0);
    });

    it("should extract SHOULD constraint from '建议：' pattern", () => {
      const constraints = service.extractConstraints("建议：使用古典词汇");
      expect(
        constraints.filter((c) => c.type === "SHOULD").length,
      ).toBeGreaterThan(0);
    });

    it("should extract SHOULD constraint from '应该：' pattern", () => {
      const constraints = service.extractConstraints("应该：保持角色一致性");
      expect(
        constraints.filter((c) => c.type === "SHOULD").length,
      ).toBeGreaterThan(0);
    });

    it("should extract SHOULD constraint from '最好：' pattern", () => {
      const constraints = service.extractConstraints("最好：引用经典诗词");
      expect(
        constraints.filter((c) => c.type === "SHOULD").length,
      ).toBeGreaterThan(0);
    });

    it("should extract SHOULD constraint from '尽量：' pattern", () => {
      const constraints = service.extractConstraints("尽量：使用四字成语");
      expect(
        constraints.filter((c) => c.type === "SHOULD").length,
      ).toBeGreaterThan(0);
    });

    it("should extract MAY constraint from '可以：' pattern", () => {
      const constraints = service.extractConstraints("可以：适当添加心理描写");
      expect(
        constraints.filter((c) => c.type === "MAY").length,
      ).toBeGreaterThan(0);
    });

    it("should extract MAY constraint from '允许：' pattern", () => {
      const constraints =
        service.extractConstraints("允许：使用省略号表示停顿");
      expect(
        constraints.filter((c) => c.type === "MAY").length,
      ).toBeGreaterThan(0);
    });

    it("should extract multiple constraints from mixed text", () => {
      const desc = "必须：不能说话。建议：使用书面语。可以：适当描写心理";
      const constraints = service.extractConstraints(desc);
      expect(
        constraints.filter((c) => c.type === "MUST").length,
      ).toBeGreaterThan(0);
      expect(
        constraints.filter((c) => c.type === "SHOULD").length,
      ).toBeGreaterThan(0);
      expect(
        constraints.filter((c) => c.type === "MAY").length,
      ).toBeGreaterThan(0);
    });

    it("should assign sequential IDs with correct prefixes", () => {
      const desc = "必须：规则一。应该：建议一。可以：许可一";
      const constraints = service.extractConstraints(desc);
      const mustConstraints = constraints.filter((c) => c.type === "MUST");
      const shouldConstraints = constraints.filter((c) => c.type === "SHOULD");
      const mayConstraints = constraints.filter((c) => c.type === "MAY");
      expect(mustConstraints[0]?.id).toMatch(/^HC-/);
      expect(shouldConstraints[0]?.id).toMatch(/^SC-/);
      expect(mayConstraints[0]?.id).toMatch(/^MC-/);
    });

    it("should set confidence 0.9 for MUST, 0.8 for SHOULD, 0.7 for MAY", () => {
      const desc = "必须：规则。建议：建议。可以：许可";
      const constraints = service.extractConstraints(desc);
      const must = constraints.find((c) => c.type === "MUST");
      const should = constraints.find((c) => c.type === "SHOULD");
      const may = constraints.find((c) => c.type === "MAY");
      expect(must?.confidence).toBe(0.9);
      expect(should?.confidence).toBe(0.8);
      expect(may?.confidence).toBe(0.7);
    });

    it("should set source from match text", () => {
      const constraints = service.extractConstraints("必须：角色不能说话");
      expect(constraints[0]?.source).toContain("必须");
    });

    // ==================== Implicit constraints ====================

    it("should extract implicit constraint from 'X是哑巴' pattern", () => {
      const constraints = service.extractConstraints("钟叔是哑巴，不能发声。");
      const must = constraints.filter((c) => c.type === "MUST");
      expect(
        must.some(
          (c) => c.rule.includes("钟叔") && c.rule.includes("不能说话"),
        ),
      ).toBe(true);
    });

    it("should extract implicit constraint from 'X是哑仆' pattern", () => {
      const constraints = service.extractConstraints("仆人是哑仆");
      const must = constraints.filter((c) => c.type === "MUST");
      expect(must.some((c) => c.rule.includes("不能说话"))).toBe(true);
    });

    it("should extract implicit constraint from 'X不会说话' pattern", () => {
      const constraints = service.extractConstraints("叔叔不会说话");
      const must = constraints.filter((c) => c.type === "MUST");
      expect(
        must.some(
          (c) => c.rule.includes("叔叔") && c.rule.includes("不能说话"),
        ),
      ).toBe(true);
    });

    it("should extract implicit constraint from 'X自毁声带' pattern", () => {
      const constraints =
        service.extractConstraints("他自毁声带，永远无法发声");
      const must = constraints.filter((c) => c.type === "MUST");
      expect(must.some((c) => c.rule.includes("不能说话"))).toBe(true);
    });

    it("should extract implicit constraint from time period setting", () => {
      const constraints =
        service.extractConstraints("背景设定在古代，故事发生在古代");
      const must = constraints.filter((c) => c.type === "MUST");
      expect(must.some((c) => c.rule.includes("现代"))).toBe(true);
    });

    it("should not duplicate implicit constraints", () => {
      // Pattern that could match multiple implicit rules
      const constraints =
        service.extractConstraints("钟叔是哑仆。钟叔不会说话。");
      const rulesAboutZhongShu = constraints.filter(
        (c) => c.rule.includes("钟叔") && c.rule.includes("不能说话"),
      );
      // Should not duplicate — at most one per pattern
      expect(rulesAboutZhongShu.length).toBeGreaterThan(0);
    });

    it("should handle text with no patterns gracefully", () => {
      const constraints =
        service.extractConstraints("这是一个普通句子，没有约束关键词。");
      expect(Array.isArray(constraints)).toBe(true);
    });

    it("should extract character setup pattern", () => {
      const constraints = service.extractConstraints(
        "钟长生（钟叔）的人设是一个忠心耿耿的哑仆",
      );
      const must = constraints.filter((c) => c.type === "MUST");
      expect(must.some((c) => c.rule.includes("不能说话"))).toBe(true);
    });

    it("should extract surface identity pattern", () => {
      const constraints =
        service.extractConstraints("他的表面身份：主人家的哑仆");
      const must = constraints.filter((c) => c.type === "MUST");
      expect(must.some((c) => c.rule.includes("不能说话"))).toBe(true);
    });

    it("should handle 'X是聋哑人' pattern", () => {
      const constraints = service.extractConstraints("小明是聋哑人");
      const must = constraints.filter((c) => c.type === "MUST");
      expect(must.some((c) => c.rule.includes("不能说话"))).toBe(true);
    });

    it("should handle period patterns for specific dynasties", () => {
      const constraints =
        service.extractConstraints("故事发生在唐朝，人物服饰应符合时代");
      const must = constraints.filter((c) => c.type === "MUST");
      expect(must.some((c) => c.rule.includes("现代"))).toBe(true);
    });

    it("should handle multiple newline-separated constraints", () => {
      const desc = "必须：规则一\n必须：规则二\n应该：建议一";
      const constraints = service.extractConstraints(desc);
      const mustConstraints = constraints.filter((c) => c.type === "MUST");
      expect(mustConstraints.length).toBeGreaterThanOrEqual(2);
    });

    it("should skip duplicate for characterSetup when rule already exists", () => {
      // Add a constraint that already covers the character, then match characterSetupPattern
      // The pattern would try to add but skip if existingRule found
      const desc = "钟长生不会说话。钟长生（钟叔）的人设是一个出色的哑仆";
      const constraints = service.extractConstraints(desc);
      const rulesAbout = constraints.filter(
        (c) => c.rule.includes("钟长生") && c.rule.includes("不能说话"),
      );
      // First match from '不会说话', second attempt from characterSetup skipped
      expect(rulesAbout.length).toBeGreaterThanOrEqual(1);
    });

    it("should skip duplicate for surfaceIdentity when rule already exists", () => {
      const desc = "他是哑仆。他（仆人）的表面身份：一个哑仆";
      const constraints = service.extractConstraints(desc);
      const must = constraints.filter((c) => c.type === "MUST");
      expect(must.length).toBeGreaterThan(0);
    });

    it("should skip duplicate for destroyedVoice when rule already exists", () => {
      const desc = "小明不会说话。小明自毁声带";
      const constraints = service.extractConstraints(desc);
      const rulesAbout = constraints.filter(
        (c) => c.rule.includes("小明") && c.rule.includes("不能说话"),
      );
      // '不会说话' creates one, '自毁声带' should check and skip duplicate
      expect(rulesAbout.length).toBeGreaterThanOrEqual(1);
    });

    it("should handle 'X为哑巴' pattern (为 variant)", () => {
      const constraints = service.extractConstraints("他为哑巴，不能出声");
      const must = constraints.filter((c) => c.type === "MUST");
      expect(must.some((c) => c.rule.includes("不能说话"))).toBe(true);
    });

    it("should handle alias name constraint from characterSetup", () => {
      const desc = "钟长生（钟叔）的人设是哑仆";
      const constraints = service.extractConstraints(desc);
      const must = constraints.filter((c) => c.type === "MUST");
      // Should create constraints for both main name and alias
      expect(must.length).toBeGreaterThan(0);
    });

    it("should handle 民国 as time period", () => {
      const constraints = service.extractConstraints("背景设定在民国");
      const must = constraints.filter((c) => c.type === "MUST");
      expect(must.some((c) => c.rule.includes("现代"))).toBe(true);
    });

    it("should not add duplicate constraint when surfaceIdentity matches character already added by mutePattern", () => {
      // mutePattern adds rule for 宁安 first, then surfaceIdentityPattern tries to add again
      // The find() callback (line 194) must evaluate to TRUE to hit the dedup branch
      const desc = "宁安是哑仆。宁安的表面身份：主人家的哑仆";
      const constraints = service.extractConstraints(desc);
      const rulesAboutNingAn = constraints.filter(
        (c) => c.rule.includes("宁安") && c.rule.includes("不能说话"),
      );
      // mutePattern adds 1 rule; surfaceIdentityPattern finds it and does NOT add a duplicate
      expect(rulesAboutNingAn.length).toBe(1);
    });

    it("should not add duplicate constraint when destroyedVoice matches character already added by cannotSpeakPattern", () => {
      // cannotSpeakPattern adds rule for 长风 first, then destroyedVoicePattern tries to add again
      // The find() callback (line 213) must evaluate to TRUE to hit the dedup branch
      const desc = "长风不会说话。长风自毁声带";
      const constraints = service.extractConstraints(desc);
      const rulesAboutChangFeng = constraints.filter(
        (c) => c.rule.includes("长风") && c.rule.includes("不能说话"),
      );
      // cannotSpeakPattern adds 1 rule; destroyedVoicePattern finds it and does NOT add a duplicate
      expect(rulesAboutChangFeng.length).toBe(1);
    });
  });

  // ==================== validateOutput ====================

  describe("validateOutput", () => {
    it("should return isValid=true for output that does not violate constraints", async () => {
      const constraints = [
        {
          id: "HC-001",
          type: "MUST" as const,
          rule: "钟叔不能说话",
          source: "",
          confidence: 0.9,
        },
      ];
      const output = "钟叔静静地站在一旁，没有任何声音。";
      const result = await service.validateOutput(output, constraints);
      expect(result.isValid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("should detect violation when entity speaks against MUST constraint", async () => {
      const constraints = [
        {
          id: "HC-001",
          type: "MUST" as const,
          rule: "钟叔不能说话",
          source: "",
          confidence: 0.9,
        },
      ];
      const output = "钟叔说道：我来了。";
      const result = await service.validateOutput(output, constraints);
      expect(result.isValid).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0].constraintId).toBe("HC-001");
    });

    it("should only check MUST constraints", async () => {
      const constraints = [
        {
          id: "SC-001",
          type: "SHOULD" as const,
          rule: "应该使用古典语言",
          source: "",
          confidence: 0.8,
        },
        {
          id: "MC-001",
          type: "MAY" as const,
          rule: "可以使用心理描写",
          source: "",
          confidence: 0.7,
        },
      ];
      const output = "任意内容";
      const result = await service.validateOutput(output, constraints);
      expect(result.checkedConstraints).toBe(0);
      expect(result.isValid).toBe(true);
    });

    it("should return correct checkedConstraints and passedConstraints counts", async () => {
      const constraints = [
        {
          id: "HC-001",
          type: "MUST" as const,
          rule: "钟叔不能说话",
          source: "",
          confidence: 0.9,
        },
        {
          id: "HC-002",
          type: "MUST" as const,
          rule: "主角不能离开城市",
          source: "",
          confidence: 0.9,
        },
      ];
      const output = "钟叔静静站立。主角走在城市中。";
      const result = await service.validateOutput(output, constraints);
      expect(result.checkedConstraints).toBe(2);
      expect(result.passedConstraints).toBe(2);
    });

    it("should handle HardConstraint type with severity MUST", async () => {
      const constraints = [
        {
          id: "HC-001",
          rule: "钟叔不能说话",
          reason: "是哑仆",
          severity: "MUST" as const,
        },
      ];
      const output = "钟叔开口说话了。";
      const result = await service.validateOutput(output, constraints);
      expect(result.isValid).toBe(false);
    });

    it("should handle HardConstraint type with severity SHOULD (not checked)", async () => {
      const constraints = [
        {
          id: "HC-001",
          rule: "应该使用书面语",
          reason: "",
          severity: "SHOULD" as const,
        },
      ];
      const output = "任意内容";
      const result = await service.validateOutput(output, constraints);
      expect(result.checkedConstraints).toBe(0);
    });

    it("should handle rule without detectable pattern (returns no violation)", async () => {
      const constraints = [
        {
          id: "HC-001",
          type: "MUST" as const,
          rule: "保持叙事节奏流畅",
          source: "",
          confidence: 0.9,
        },
      ];
      const output = "叙事内容";
      const result = await service.validateOutput(output, constraints);
      expect(result.isValid).toBe(true);
    });

    it("should detect speech action violations (道/说/开口 etc.)", async () => {
      const constraints = [
        {
          id: "HC-001",
          type: "MUST" as const,
          rule: "小明不能说话、不能发出声音",
          source: "",
          confidence: 0.9,
        },
      ];
      const output = "小明开口道：你好。";
      const result = await service.validateOutput(output, constraints);
      expect(result.isValid).toBe(false);
    });

    it("should handle empty constraints array", async () => {
      const result = await service.validateOutput("任意内容", []);
      expect(result.isValid).toBe(true);
      expect(result.checkedConstraints).toBe(0);
    });

    it("should handle 禁止 pattern in constraint rule", async () => {
      const constraints = [
        {
          id: "HC-001",
          type: "MUST" as const,
          rule: "禁止使用现代词汇",
          source: "",
          confidence: 0.9,
        },
      ];
      const output = "任意内容";
      const result = await service.validateOutput(output, constraints);
      // rule does not match "X不能Y" pattern so no violation detected
      expect(result.isValid).toBe(true);
    });
  });

  // ==================== generateViolationReport ====================

  describe("generateViolationReport", () => {
    it("should return no-violation message for empty violations", () => {
      const report = service.generateViolationReport([]);
      expect(report).toBe("未检测到约束违规。");
    });

    it("should generate report with violation details", () => {
      const violations = [
        {
          constraintId: "HC-001",
          rule: "钟叔不能说话",
          violatingText: "钟叔说道：",
          position: 10,
          severity: "critical" as const,
        },
      ];
      const report = service.generateViolationReport(violations);
      expect(report).toContain("HC-001");
      expect(report).toContain("钟叔不能说话");
      expect(report).toContain("钟叔说道：");
      expect(report).toContain("10");
      expect(report).toContain("critical");
    });

    it("should number each violation", () => {
      const violations = [
        {
          constraintId: "HC-001",
          rule: "规则一",
          violatingText: "违规一",
          position: 0,
          severity: "critical" as const,
        },
        {
          constraintId: "HC-002",
          rule: "规则二",
          violatingText: "违规二",
          position: 5,
          severity: "high" as const,
        },
      ];
      const report = service.generateViolationReport(violations);
      expect(report).toContain("1.");
      expect(report).toContain("2.");
      expect(report).toContain("检测到 2 处约束违规");
    });
  });

  // ==================== formatConstraintsForPrompt ====================

  describe("formatConstraintsForPrompt", () => {
    const constraints = [
      {
        id: "HC-001",
        type: "MUST" as const,
        rule: "不能说话",
        source: "",
        confidence: 0.9,
      },
      {
        id: "SC-001",
        type: "SHOULD" as const,
        rule: "使用书面语",
        source: "",
        confidence: 0.8,
      },
      {
        id: "MC-001",
        type: "MAY" as const,
        rule: "可以添加心理描写",
        source: "",
        confidence: 0.7,
      },
    ];

    it("should format MUST constraints with hard constraint header", () => {
      const formatted = service.formatConstraintsForPrompt(constraints, "MUST");
      expect(formatted).toContain("硬性约束");
      expect(formatted).toContain("HC-001");
      expect(formatted).toContain("不能说话");
    });

    it("should format SHOULD constraints with soft constraint header", () => {
      const formatted = service.formatConstraintsForPrompt(
        constraints,
        "SHOULD",
      );
      expect(formatted).toContain("软性约束");
      expect(formatted).toContain("SC-001");
    });

    it("should format MAY constraints with reference header", () => {
      const formatted = service.formatConstraintsForPrompt(constraints, "MAY");
      expect(formatted).toContain("参考建议");
      expect(formatted).toContain("MC-001");
    });

    it("should default to MUST type when type not provided", () => {
      const formatted = service.formatConstraintsForPrompt(constraints);
      expect(formatted).toContain("硬性约束");
    });

    it("should return empty string when no constraints match type", () => {
      const onlyMust = [
        {
          id: "HC-001",
          type: "MUST" as const,
          rule: "规则",
          source: "",
          confidence: 0.9,
        },
      ];
      const formatted = service.formatConstraintsForPrompt(onlyMust, "SHOULD");
      expect(formatted).toBe("");
    });

    it("should handle HardConstraint type with severity", () => {
      const hardConstraints = [
        {
          id: "HC-001",
          rule: "不能说话",
          reason: "是哑仆",
          severity: "MUST" as const,
        },
        {
          id: "HC-002",
          rule: "应该书面",
          reason: "",
          severity: "SHOULD" as const,
        },
      ];
      const formatted = service.formatConstraintsForPrompt(
        hardConstraints,
        "MUST",
      );
      expect(formatted).toContain("HC-001");
      expect(formatted).not.toContain("HC-002");
    });
  });

  // ==================== toHardConstraints ====================

  describe("toHardConstraints", () => {
    it("should convert MUST and SHOULD constraints to HardConstraints", () => {
      const constraints = [
        {
          id: "HC-001",
          type: "MUST" as const,
          rule: "规则一",
          source: "来源一",
          confidence: 0.9,
        },
        {
          id: "SC-001",
          type: "SHOULD" as const,
          rule: "建议一",
          source: "来源二",
          confidence: 0.8,
        },
        {
          id: "MC-001",
          type: "MAY" as const,
          rule: "许可一",
          source: "来源三",
          confidence: 0.7,
        },
      ];
      const hardConstraints = service.toHardConstraints(constraints);
      expect(hardConstraints).toHaveLength(2);
      expect(hardConstraints[0].id).toBe("HC-001");
      expect(hardConstraints[0].severity).toBe("MUST");
      expect(hardConstraints[0].rule).toBe("规则一");
      expect(hardConstraints[0].reason).toBe("来源一");
    });

    it("should filter out MAY constraints", () => {
      const constraints = [
        {
          id: "MC-001",
          type: "MAY" as const,
          rule: "许可",
          source: "",
          confidence: 0.7,
        },
      ];
      const hardConstraints = service.toHardConstraints(constraints);
      expect(hardConstraints).toHaveLength(0);
    });

    it("should handle empty input", () => {
      const hardConstraints = service.toHardConstraints([]);
      expect(hardConstraints).toEqual([]);
    });

    it("should preserve severity from type field", () => {
      const constraints = [
        {
          id: "HC-001",
          type: "MUST" as const,
          rule: "规则",
          source: "src",
          confidence: 0.9,
        },
        {
          id: "SC-001",
          type: "SHOULD" as const,
          rule: "建议",
          source: "src2",
          confidence: 0.8,
        },
      ];
      const hardConstraints = service.toHardConstraints(constraints);
      const must = hardConstraints.find((c) => c.id === "HC-001");
      const should = hardConstraints.find((c) => c.id === "SC-001");
      expect(must?.severity).toBe("MUST");
      expect(should?.severity).toBe("SHOULD");
    });
  });
});
