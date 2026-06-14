/**
 * Unit tests for skill-parser.ts
 */

import {
  parseSkillMd,
  serializeSkillMd,
  extractTitleFromContent,
  estimateTokens,
  isValidSkillId,
  isValidSkillSource,
  parseSkillIdFromFilename,
  isValidSkillMd,
} from "../parsing/skill-parser";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_SKILL_MD = `---
id: test-skill
name: test-skill
version: 1.0.0
domain: writing
taskTypes:
  - chapter-writing
priority: 5
description: A test skill for unit testing
tags:
  - test
source: local
---

# Test Skill

This is the content of the test skill.
`;

const MINIMAL_SKILL_MD = `---
name: minimal-skill
description: A minimal skill
---

Content here.
`;

const CLAUDE_CODE_STYLE_SKILL_MD = `---
name: claude-skill
description: A Claude Code style skill
allowed-tools:
  - Read
  - Write
user-invocable: false
disable-model-invocation: true
argument-hint: "[filename]"
---

# Claude Code Skill

Instructions here.
`;

const KEBAB_CASE_ALIAS_SKILL_MD = `---
name: alias-skill
description: Skill with kebab-case alias fields
output-key: my-output
task-profile.types:
  creativity: medium
  outputLength: short
required-skills:
  - other-skill
required-tools:
  - Read
execution-mode: provider
---

Content.
`;

// ---------------------------------------------------------------------------
// parseSkillMd
// ---------------------------------------------------------------------------

describe("parseSkillMd", () => {
  describe("正常情况", () => {
    it("正确解析含完整 frontmatter 的 SKILL.md", () => {
      const result = parseSkillMd(
        VALID_SKILL_MD,
        "/path/to/test-skill.skill.md",
      );

      expect(result.metadata.id).toBe("test-skill");
      expect(result.metadata.name).toBe("test-skill");
      expect(result.metadata.version).toBe("1.0.0");
      expect(result.metadata.domain).toBe("writing");
      expect(result.metadata.taskTypes).toEqual(["chapter-writing"]);
      expect(result.metadata.priority).toBe(5);
      expect(result.metadata.description).toBe("A test skill for unit testing");
      expect(result.metadata.tags).toEqual(["test"]);
      expect(result.metadata.source).toBe("local");
    });

    it("内容被正确 trim", () => {
      const result = parseSkillMd(VALID_SKILL_MD);

      expect(result.content).toBe(
        "# Test Skill\n\nThis is the content of the test skill.",
      );
    });

    it("filePath 被设置", () => {
      const filePath = "/path/to/test-skill.skill.md";
      const result = parseSkillMd(VALID_SKILL_MD, filePath);

      expect(result.filePath).toBe(filePath);
    });

    it("loadedAt 为 Date 类型", () => {
      const result = parseSkillMd(VALID_SKILL_MD);

      expect(result.loadedAt).toBeInstanceOf(Date);
    });

    it("contentHash 为 MD5 哈希", () => {
      const result = parseSkillMd(VALID_SKILL_MD);

      expect(result.contentHash).toMatch(/^[a-f0-9]{32}$/);
    });

    it("相同内容生成相同的 contentHash", () => {
      const result1 = parseSkillMd(VALID_SKILL_MD);
      const result2 = parseSkillMd(VALID_SKILL_MD);

      expect(result1.contentHash).toBe(result2.contentHash);
    });

    it("正确处理仅含最少字段的 SKILL.md", () => {
      const result = parseSkillMd(MINIMAL_SKILL_MD);

      expect(result.metadata.name).toBe("minimal-skill");
      expect(result.metadata.id).toBe("minimal-skill");
      expect(result.metadata.description).toBe("A minimal skill");
      // 验证默认值
      expect(result.metadata.version).toBe("1.0.0");
      expect(result.metadata.domain).toBe("general");
      expect(result.metadata.taskTypes).toEqual([]);
      expect(result.metadata.priority).toBe(5);
      expect(result.metadata.source).toBe("local");
      expect(result.metadata.enabled).toBe(true);
      expect(result.metadata.userInvocable).toBe(true);
      expect(result.metadata.disableModelInvocation).toBe(false);
    });

    it("正确处理 Claude Code 风格的 kebab-case 字段", () => {
      const result = parseSkillMd(CLAUDE_CODE_STYLE_SKILL_MD);

      expect(result.metadata.allowedTools).toEqual(["Read", "Write"]);
      expect(result.metadata.userInvocable).toBe(false);
      expect(result.metadata.disableModelInvocation).toBe(true);
      expect(result.metadata.argumentHint).toBe("[filename]");
    });

    it("正确处理 kebab-case 别名字段", () => {
      const result = parseSkillMd(KEBAB_CASE_ALIAS_SKILL_MD);

      expect(result.metadata.outputKey).toBe("my-output");
      expect(result.metadata.taskProfile).toEqual({
        creativity: "medium",
        outputLength: "short",
      });
      expect(result.metadata.requiredSkills).toEqual(["other-skill"]);
      expect(result.metadata.requiredTools).toEqual(["Read"]);
      expect(result.metadata.executionMode).toBe("provider");
    });

    it("allowed-tools 为字符串时按逗号分割", () => {
      const content = `---
name: tools-skill
description: Test
allowed-tools: Read, Write, Grep
---

Content.
`;
      const result = parseSkillMd(content);

      expect(result.metadata.allowedTools).toEqual(["Read", "Write", "Grep"]);
    });

    it("id 和 name 互为回退（仅 name 时）", () => {
      const content = `---
name: only-name-skill
description: Test
---

Content.
`;
      const result = parseSkillMd(content);

      expect(result.metadata.id).toBe("only-name-skill");
      expect(result.metadata.name).toBe("only-name-skill");
    });

    it("仅有 id 时 name 也使用 id 的值", () => {
      const content = `---
id: only-id-skill
description: Test
---

Content.
`;
      const result = parseSkillMd(content);

      expect(result.metadata.id).toBe("only-id-skill");
      expect(result.metadata.name).toBe("only-id-skill");
    });

    it("未指定 description 时从 Markdown 标题获取", () => {
      const content = `---
name: no-description-skill
---

# My Skill Title

Content here.
`;
      const result = parseSkillMd(content);

      expect(result.metadata.description).toBe("My Skill Title");
    });

    it("description 和标题均未指定时使用默认值", () => {
      const content = `---
name: bare-skill
---

Content without title.
`;
      const result = parseSkillMd(content);

      expect(result.metadata.description).toBe("Skill: bare-skill");
    });

    it("enabled: false 被正确处理", () => {
      const content = `---
name: disabled-skill
description: Disabled
enabled: false
---

Content.
`;
      const result = parseSkillMd(content);

      expect(result.metadata.enabled).toBe(false);
    });
  });

  describe("错误情况", () => {
    it("不存在 frontmatter 时抛出错误", () => {
      const content = "No frontmatter here, just content";

      expect(() => parseSkillMd(content)).toThrow(
        "Invalid SKILL.md format: Missing YAML frontmatter",
      );
    });

    it("无效的 YAML 时抛出错误", () => {
      const content = `---
name: broken: skill: yaml: here
  bad: indentation
---

Content.
`;
      expect(() => parseSkillMd(content)).toThrow();
    });

    it("name 和 id 均不存在时抛出错误", () => {
      const content = `---
description: No name here
version: 1.0.0
---

Content.
`;
      expect(() => parseSkillMd(content)).toThrow(
        "Missing required field: name or id",
      );
    });

    it("错误消息中包含 filePath", () => {
      const content = "No frontmatter";
      const filePath = "/path/to/skill.md";

      expect(() => parseSkillMd(content, filePath)).toThrow(filePath);
    });
  });
});

// ---------------------------------------------------------------------------
// serializeSkillMd
// ---------------------------------------------------------------------------

describe("serializeSkillMd", () => {
  it("正确序列化 SkillMdDefinition", () => {
    const definition = parseSkillMd(VALID_SKILL_MD);
    const serialized = serializeSkillMd(definition);

    expect(serialized).toMatch(/^---\n/);
    expect(serialized).toMatch(/---\n\n/);
    expect(serialized).toContain("test-skill");
  });

  it("序列化后重新解析得到相同的 metadata", () => {
    const original = parseSkillMd(VALID_SKILL_MD);
    const serialized = serializeSkillMd(original);
    const reparsed = parseSkillMd(serialized);

    expect(reparsed.metadata.id).toBe(original.metadata.id);
    expect(reparsed.metadata.name).toBe(original.metadata.name);
    expect(reparsed.metadata.domain).toBe(original.metadata.domain);
    expect(reparsed.metadata.version).toBe(original.metadata.version);
  });

  it("内容被正确包含", () => {
    const definition = parseSkillMd(VALID_SKILL_MD);
    const serialized = serializeSkillMd(definition);

    expect(serialized).toContain(definition.content);
  });
});

// ---------------------------------------------------------------------------
// extractTitleFromContent
// ---------------------------------------------------------------------------

describe("extractTitleFromContent", () => {
  it("正确提取 H1 标题", () => {
    const content = "# My Title\n\nContent here.";

    expect(extractTitleFromContent(content)).toBe("My Title");
  });

  it("不存在标题时返回 null", () => {
    const content = "No title here\n\nJust content.";

    expect(extractTitleFromContent(content)).toBeNull();
  });

  it("不提取 H2 及以下的标题", () => {
    const content = "## Not a top title\n\n### Also not\n\nContent.";

    expect(extractTitleFromContent(content)).toBeNull();
  });

  it("trim 标题前后的空白", () => {
    const content = "#   Spaced Title   \n\nContent.";

    expect(extractTitleFromContent(content)).toBe("Spaced Title");
  });
});

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

describe("estimateTokens", () => {
  it("估算英语文本的 token 数量", () => {
    const content = "Hello world this is a test"; // 26 字符
    const tokens = estimateTokens(content);

    expect(tokens).toBe(Math.ceil(26 / 4)); // 7
  });

  it("估算中文文本的 token 数量", () => {
    const content = "你好世界"; // 4 个中文字符
    const tokens = estimateTokens(content);

    expect(tokens).toBe(Math.ceil(4 * 2)); // 8
  });

  it("估算混合文本的 token 数量", () => {
    const content = "Hello你好"; // 5 个英文字符 + 2 个中文字符
    const chineseChars = 2;
    const otherChars = content.length - chineseChars; // 5
    const expected = Math.ceil(chineseChars * 2 + otherChars / 4);
    const tokens = estimateTokens(content);

    expect(tokens).toBe(expected);
  });

  it("空字符串返回 0", () => {
    expect(estimateTokens("")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isValidSkillId
// ---------------------------------------------------------------------------

describe("isValidSkillId", () => {
  it("接受有效的 kebab-case ID", () => {
    expect(isValidSkillId("chapter-writing")).toBe(true);
    expect(isValidSkillId("test")).toBe(true);
    expect(isValidSkillId("my-skill-123")).toBe(true);
  });

  it("拒绝含大写字母的 ID", () => {
    expect(isValidSkillId("Chapter-Writing")).toBe(false);
    expect(isValidSkillId("UPPERCASE")).toBe(false);
  });

  it("拒绝含下划线的 ID", () => {
    expect(isValidSkillId("my_skill")).toBe(false);
  });

  it("拒绝含空格的 ID", () => {
    expect(isValidSkillId("my skill")).toBe(false);
  });

  it("拒绝以连字符开头或结尾的 ID", () => {
    expect(isValidSkillId("-skill")).toBe(false);
    expect(isValidSkillId("skill-")).toBe(false);
  });

  it("拒绝含连续连字符的 ID", () => {
    expect(isValidSkillId("my--skill")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isValidSkillSource
// ---------------------------------------------------------------------------

describe("isValidSkillSource", () => {
  it("接受有效的来源类型", () => {
    expect(isValidSkillSource("local")).toBe(true);
    expect(isValidSkillSource("skillsmp")).toBe(true);
    expect(isValidSkillSource("custom-url")).toBe(true);
  });

  it("拒绝无效的来源类型", () => {
    expect(isValidSkillSource("unknown")).toBe(false);
    expect(isValidSkillSource("remote")).toBe(false);
    expect(isValidSkillSource("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseSkillIdFromFilename
// ---------------------------------------------------------------------------

describe("parseSkillIdFromFilename", () => {
  it("从 .skill.md 扩展名中提取 ID", () => {
    expect(parseSkillIdFromFilename("chapter-writing.skill.md")).toBe(
      "chapter-writing",
    );
    expect(parseSkillIdFromFilename("my-skill.skill.md")).toBe("my-skill");
  });

  it("其他扩展名返回 null", () => {
    expect(parseSkillIdFromFilename("SKILL.md")).toBeNull();
    expect(parseSkillIdFromFilename("skill.md")).toBeNull();
    expect(parseSkillIdFromFilename("myfile.txt")).toBeNull();
  });

  it("空字符串返回 null", () => {
    expect(parseSkillIdFromFilename("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isValidSkillMd
// ---------------------------------------------------------------------------

describe("isValidSkillMd", () => {
  it("有效的 SKILL.md 内容返回 true", () => {
    expect(isValidSkillMd(VALID_SKILL_MD)).toBe(true);
    expect(isValidSkillMd(MINIMAL_SKILL_MD)).toBe(true);
  });

  it("无效的 SKILL.md 内容返回 false", () => {
    expect(isValidSkillMd("No frontmatter")).toBe(false);
    expect(isValidSkillMd("---\ndescription: no name\n---\nContent")).toBe(
      false,
    );
  });
});
