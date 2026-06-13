/**
 * SkillParser 单元测试
 */

import { parseSkillMarkdown, SkillParseError } from "../skill-parser";

describe("parseSkillMarkdown", () => {
  it("parses a minimal SKILL.md", () => {
    const raw = `---
name: test-skill
description: A test skill
---

Do the thing.`;
    const skill = parseSkillMarkdown(raw);
    expect(skill.frontmatter.name).toBe("test-skill");
    expect(skill.frontmatter.description).toBe("A test skill");
    expect(skill.instructions).toBe("Do the thing.");
  });

  it("parses full frontmatter with arrays", () => {
    const raw = `---
name: full-skill
description: desc
version: "1.2.3"
tags: [a, b]
allowedTools:
  - search
  - fetch
activateFor: [researcher]
---

# Instructions

step 1
step 2`;
    const skill = parseSkillMarkdown(raw);
    expect(skill.frontmatter.version).toBe("1.2.3");
    expect(skill.frontmatter.tags).toEqual(["a", "b"]);
    expect(skill.frontmatter.allowedTools).toEqual(["search", "fetch"]);
    expect(skill.frontmatter.activateFor).toEqual(["researcher"]);
    expect(skill.instructions).toContain("# Instructions");
    expect(skill.instructions).toContain("step 1");
  });

  it("throws when frontmatter delimiter missing", () => {
    expect(() => parseSkillMarkdown("no frontmatter here, just body")).toThrow(
      SkillParseError,
    );
  });

  it("throws when frontmatter is not closed", () => {
    expect(() =>
      parseSkillMarkdown(`---
name: x
description: y
body without close`),
    ).toThrow(/not closed/i);
  });

  it("throws when 'name' missing", () => {
    expect(() =>
      parseSkillMarkdown(`---
description: missing name
---
body`),
    ).toThrow(/missing 'name'/);
  });

  it("throws when 'description' missing", () => {
    expect(() =>
      parseSkillMarkdown(`---
name: no-desc
---
body`),
    ).toThrow(/missing 'description'/);
  });

  it("preserves body markdown including fences and nested '---'", () => {
    const raw = `---
name: x
description: d
---

# Title

Some content with a separator

---

More content`;
    const skill = parseSkillMarkdown(raw);
    expect(skill.instructions).toContain("More content");
    expect(skill.instructions).toContain("---");
  });
});
