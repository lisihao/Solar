/**
 * Unit tests for SkillPromptBuilder
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { SkillPromptBuilder } from "../skill-prompt-builder.service";
import { SkillMdDefinition } from "../../types/skill-md.types";

// ---------------------------------------------------------------------------
// 模拟 estimateTokens
// ---------------------------------------------------------------------------

jest.mock("../../loader/parsing/skill-parser", () => ({
  estimateTokens: jest.fn().mockImplementation((content: string) => {
    // 英文：1 字符 = 0.25 token（4 字符 = 1 token）
    return Math.ceil(content.length / 4);
  }),
}));

import { estimateTokens } from "../../loader/parsing/skill-parser";
const mockEstimateTokens = estimateTokens as jest.MockedFunction<
  typeof estimateTokens
>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSkillDefinition(
  id: string,
  content: string = `Content of ${id}`,
  priority: number = 5,
  enabled: boolean = true,
  tokenBudget?: number,
): SkillMdDefinition {
  return {
    metadata: {
      id,
      name: id,
      description: `Skill ${id}`,
      version: "1.0.0",
      domain: "writing",
      taskTypes: ["*"],
      priority,
      source: "local",
      tags: [],
      enabled,
      userInvocable: true,
      disableModelInvocation: false,
      tokenBudget,
    },
    content,
    loadedAt: new Date(),
    contentHash: "abc123",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SkillPromptBuilder", () => {
  let builder: SkillPromptBuilder;

  beforeEach(async () => {
    jest.clearAllMocks();

    // 默认的 estimateTokens 以字符数/4 计算
    mockEstimateTokens.mockImplementation((content: string) =>
      Math.ceil(content.length / 4),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [SkillPromptBuilder],
    })
      .setLogger(new Logger())
      .compile();

    builder = module.get<SkillPromptBuilder>(SkillPromptBuilder);
  });

  // -------------------------------------------------------------------------
  // buildSystemPrompt
  // -------------------------------------------------------------------------

  describe("buildSystemPrompt", () => {
    it("从 skill 列表构建 System Prompt", () => {
      const skills = [makeSkillDefinition("skill-1", "Skill one content")];

      const result = builder.buildSystemPrompt(skills);

      expect(result.prompt).toContain("Skill one content");
      expect(result.usedSkills).toEqual(["skill-1"]);
      expect(result.wasTrimmed).toBe(false);
      expect(result.skippedSkills).toEqual([]);
    });

    it("skill 列表为空时返回空 prompt", () => {
      const result = builder.buildSystemPrompt([]);

      expect(result.prompt).toBe("");
      expect(result.usedSkills).toHaveLength(0);
      expect(result.estimatedTokens).toBe(0);
    });

    it("多个 skill 以默认分隔符拼接", () => {
      const skills = [
        makeSkillDefinition("skill-1", "Content one"),
        makeSkillDefinition("skill-2", "Content two"),
      ];

      const result = builder.buildSystemPrompt(skills);

      expect(result.prompt).toContain("Content one");
      expect(result.prompt).toContain("Content two");
      expect(result.prompt).toContain("---");
      expect(result.usedSkills).toHaveLength(2);
    });

    it("可以使用自定义分隔符", () => {
      const skills = [
        makeSkillDefinition("skill-1", "Content one"),
        makeSkillDefinition("skill-2", "Content two"),
      ];

      const result = builder.buildSystemPrompt(skills, {
        separator: "\n===\n",
      });

      expect(result.prompt).toContain("===");
    });

    it("已禁用的 skill 被跳过", () => {
      const skills = [
        makeSkillDefinition("enabled-skill", "Enabled content", 5, true),
        makeSkillDefinition("disabled-skill", "Disabled content", 5, false),
      ];

      const result = builder.buildSystemPrompt(skills);

      expect(result.usedSkills).toEqual(["enabled-skill"]);
      expect(result.prompt).not.toContain("Disabled content");
    });

    it("超出 token 预算的 skill 被跳过", () => {
      // 将每个 skill 的 token 数设大
      mockEstimateTokens.mockReturnValue(300);

      const skills = [
        makeSkillDefinition("skill-1", "Content one"),
        makeSkillDefinition("skill-2", "Content two"),
        makeSkillDefinition("skill-3", "Content three"),
      ];

      const result = builder.buildSystemPrompt(skills, { maxTokens: 400 });

      // 1 个被包含，其余被跳过
      expect(result.usedSkills.length).toBeLessThan(3);
      expect(result.skippedSkills.length).toBeGreaterThan(0);
    });

    it("剩余 token 大于 200 时对内容进行裁剪", () => {
      // buildSystemPrompt 逻辑：
      // 1. skill-1: estimateTokens("Short content") → 100（预算内）
      // 2. currentTokens 累加: estimateTokens("Short content") → 100
      // 3. skill-2: estimateTokens("AAA...") → 500（超出）
      //    remainingTokens = 400 - 100 = 300 > 200 → 调用 trimToTokenLimit
      // 4. trimToTokenLimit 内: estimateTokens("AAA...") → 500
      // 5. 裁剪后的 estimateTokens → 300
      // 6. currentTokens 累加: estimateTokens(trimmedContent) → 300
      mockEstimateTokens
        .mockReturnValueOnce(100) // skill-1 的 token 检查 (skillTokens)
        .mockReturnValueOnce(100) // currentTokens 累加时
        .mockReturnValueOnce(500) // skill-2 的 token 检查 (skillTokens)
        .mockReturnValueOnce(500) // trimToTokenLimit 内的 currentTokens
        .mockReturnValueOnce(150) // 裁剪后内容的 estimateTokens
        .mockReturnValueOnce(150); // currentTokens 累加时

      const skills = [
        makeSkillDefinition("skill-1", "Short content"),
        makeSkillDefinition("skill-2", "A".repeat(2000)),
      ];

      const result = builder.buildSystemPrompt(skills, { maxTokens: 400 });

      expect(result.wasTrimmed).toBe(true);
    });

    it("剩余 token 小于 200 时跳过该 skill", () => {
      // skill-1 消耗 300 token，剩余 = 350-300 = 50 < 200 → 跳过 skill-2
      mockEstimateTokens
        .mockReturnValueOnce(300) // skill-1 的 skillTokens
        .mockReturnValueOnce(300) // currentTokens 累加时
        .mockReturnValueOnce(150); // skill-2 的 skillTokens（剩余 50，跳过）

      const skills = [
        makeSkillDefinition("skill-1", "Medium content"),
        makeSkillDefinition("skill-2", "Short content"),
      ];

      const result = builder.buildSystemPrompt(skills, { maxTokens: 350 });

      expect(result.skippedSkills).toContain("skill-2");
    });

    it("includeMetadata=true 时包含元数据注释", () => {
      const skills = [makeSkillDefinition("metadata-skill", "Skill content")];

      const result = builder.buildSystemPrompt(skills, {
        includeMetadata: true,
      });

      expect(result.prompt).toContain("<!-- Skill: metadata-skill -->");
      expect(result.prompt).toContain("<!-- Name: metadata-skill -->");
      expect(result.prompt).toContain("<!-- Version: 1.0.0 -->");
      expect(result.prompt).toContain("<!-- Domain: writing -->");
    });

    it("estimatedTokens 计算正确", () => {
      mockEstimateTokens.mockReturnValue(50);
      const skills = [
        makeSkillDefinition("t1", "Content A"),
        makeSkillDefinition("t2", "Content B"),
      ];

      const result = builder.buildSystemPrompt(skills);

      expect(result.estimatedTokens).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // replaceVariables (private, tested via buildSystemPrompt)
  // -------------------------------------------------------------------------

  describe("变量替换 (通过 buildSystemPrompt 间接测试)", () => {
    it("替换 ${VAR} 格式的变量", () => {
      const skill = makeSkillDefinition("var-skill", "Hello ${NAME}!");

      const result = builder.buildSystemPrompt([skill], {
        context: { NAME: "World" },
      });

      expect(result.prompt).toContain("Hello World!");
    });

    it("替换 $VAR 格式的变量", () => {
      const skill = makeSkillDefinition("var-skill", "Hello $NAME!");

      const result = builder.buildSystemPrompt([skill], {
        context: { NAME: "Claude" },
      });

      expect(result.prompt).toContain("Hello Claude!");
    });

    it("替换 $1, $2 格式的位置参数", () => {
      const skill = makeSkillDefinition("pos-skill", "Args: $1 and $2");

      const result = builder.buildSystemPrompt([skill], {
        context: { ARGUMENTS: ["first", "second"] },
      });

      expect(result.prompt).toContain("Args: first and second");
    });

    it("替换 {{variable}} 格式的 Handlebars 变量", () => {
      const skill = makeSkillDefinition("hb-skill", "Hello {{name}}!");

      const result = builder.buildSystemPrompt([skill], {
        context: { name: "Handlebars" },
      });

      expect(result.prompt).toContain("Hello Handlebars!");
    });

    it("替换 {{object.property}} 格式的嵌套变量", () => {
      const skill = makeSkillDefinition("nested-skill", "Value: {{user.name}}");

      const result = builder.buildSystemPrompt([skill], {
        context: { user: { name: "NestJS" } },
      });

      expect(result.prompt).toContain("Value: NestJS");
    });

    it("处理 {{variable | default: 'value'}} 格式的默认值", () => {
      const skill = makeSkillDefinition(
        "default-skill",
        'Hello {{name | default: "Unknown"}}!',
      );

      const result = builder.buildSystemPrompt([skill], {
        context: {},
      });

      expect(result.prompt).toContain("Hello Unknown!");
    });

    it("上下文中不存在的变量保持原样", () => {
      const skill = makeSkillDefinition(
        "missing-skill",
        "Hello ${MISSING_VAR}!",
      );

      const result = builder.buildSystemPrompt([skill], {
        context: {},
      });

      expect(result.prompt).toContain("${MISSING_VAR}");
    });

    it("小写变量名也能匹配大写环境变量", () => {
      const skill = makeSkillDefinition("case-skill", "Value: $USER_NAME");

      const result = builder.buildSystemPrompt([skill], {
        context: { user_name: "lowercase-match" },
      });

      expect(result.prompt).toContain("Value: lowercase-match");
    });

    it("对象类型的值被 JSON 序列化", () => {
      const skill = makeSkillDefinition("obj-skill", "Data: {{data}}");

      const result = builder.buildSystemPrompt([skill], {
        context: { data: { key: "value" } },
      });

      expect(result.prompt).toContain('"key"');
    });
  });

  // -------------------------------------------------------------------------
  // trimToTokenLimit
  // -------------------------------------------------------------------------

  describe("trimToTokenLimit", () => {
    it("token 数在上限内时不转换", () => {
      mockEstimateTokens.mockReturnValue(50);
      const content = "Short content";

      const result = builder.trimToTokenLimit(content, 100);

      expect(result).toBe(content);
    });

    it("token 数超出上限时进行裁剪", () => {
      const longContent = "A".repeat(4000);
      // 首次调用（currentTokens）返回较大值
      mockEstimateTokens.mockReturnValue(1000);

      const result = builder.trimToTokenLimit(longContent, 200);

      expect(result).toContain("[... content trimmed ...]");
      expect(result.length).toBeLessThan(longContent.length);
    });
  });

  // -------------------------------------------------------------------------
  // estimateTotalTokens
  // -------------------------------------------------------------------------

  describe("estimateTotalTokens", () => {
    it("返回全部 skill 的 token 总数", () => {
      mockEstimateTokens.mockReturnValue(100);
      const skills = [
        makeSkillDefinition("t1"),
        makeSkillDefinition("t2"),
        makeSkillDefinition("t3"),
      ];

      const total = builder.estimateTotalTokens(skills);

      expect(total).toBe(300);
    });

    it("设置了 tokenBudget 时使用该值", () => {
      const skills = [
        makeSkillDefinition("budgeted-skill", "Content", 5, true, 250),
      ];

      const total = builder.estimateTotalTokens(skills);

      expect(total).toBe(250);
      expect(mockEstimateTokens).not.toHaveBeenCalled();
    });

    it("列表为空时返回 0", () => {
      const total = builder.estimateTotalTokens([]);

      expect(total).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // selectSkillsForBudget
  // -------------------------------------------------------------------------

  describe("selectSkillsForBudget", () => {
    it("在预算内选择 skill", () => {
      mockEstimateTokens.mockReturnValue(200);
      const skills = [
        makeSkillDefinition("skill-1"),
        makeSkillDefinition("skill-2"),
        makeSkillDefinition("skill-3"),
      ];

      const selected = builder.selectSkillsForBudget(skills, 500);

      expect(selected).toHaveLength(2);
    });

    it("全部 skill 都在预算内时全部选择", () => {
      mockEstimateTokens.mockReturnValue(100);
      const skills = [
        makeSkillDefinition("skill-1"),
        makeSkillDefinition("skill-2"),
      ];

      const selected = builder.selectSkillsForBudget(skills, 1000);

      expect(selected).toHaveLength(2);
    });

    it("第一个 skill 就超出预算时返回空数组", () => {
      mockEstimateTokens.mockReturnValue(1000);
      const skills = [makeSkillDefinition("big-skill")];

      const selected = builder.selectSkillsForBudget(skills, 100);

      expect(selected).toHaveLength(0);
    });

    it("设置了 tokenBudget 的 skill 使用该值", () => {
      const skills = [
        makeSkillDefinition("budgeted", "Content", 5, true, 300),
        makeSkillDefinition("normal", "Content"),
      ];
      mockEstimateTokens.mockReturnValue(100); // normal skill 的 token 数

      const selected = builder.selectSkillsForBudget(skills, 350);

      expect(selected).toHaveLength(1);
      expect(selected[0].metadata.id).toBe("budgeted");
    });
  });

  // -------------------------------------------------------------------------
  // mergeSkillContents
  // -------------------------------------------------------------------------

  describe("mergeSkillContents", () => {
    it("合并 skill 的内容", () => {
      const skills = [
        makeSkillDefinition("skill-1", "Content one"),
        makeSkillDefinition("skill-2", "Content two"),
      ];

      const merged = builder.mergeSkillContents(skills);

      expect(merged).toContain("Content one");
      expect(merged).toContain("Content two");
    });

    it("重复的 skill ID 的内容只包含一次", () => {
      const skill = makeSkillDefinition("dup-skill", "Unique content");
      const skills = [skill, skill, skill];

      const merged = builder.mergeSkillContents(skills);

      const count = (merged.match(/Unique content/g) || []).length;
      expect(count).toBe(1);
    });

    it("列表为空时返回空字符串", () => {
      const merged = builder.mergeSkillContents([]);

      expect(merged).toBe("");
    });
  });
});
