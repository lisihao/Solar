/**
 * BuiltinSkillCatalog — extra branch coverage for describeForLLM + recommend
 */

import { BuiltinSkillCatalog } from "../skill-registry";
import type { ISkill } from "../../abstractions";

function makeSkill(
  name: string,
  description = `desc ${name}`,
  tags: string[] = [],
  activateFor: string[] = [],
): ISkill {
  return {
    frontmatter: { name, description, tags, activateFor },
    instructions: `instructions for ${name}`,
  };
}

describe("BuiltinSkillCatalog — describeForLLM", () => {
  it("returns no-skills message when registry is empty", () => {
    const reg = new BuiltinSkillCatalog();
    expect(reg.describeForLLM()).toBe("(no skills available)");
  });

  it("returns no-skills when roleId filter matches nothing", () => {
    const reg = new BuiltinSkillCatalog();
    reg.register(makeSkill("s1", "desc", [], ["writer"]));
    expect(reg.describeForLLM({ roleId: "researcher" })).toBe(
      "(no skills available)",
    );
  });

  it("returns no-skills when tag filter matches nothing", () => {
    const reg = new BuiltinSkillCatalog();
    reg.register(makeSkill("s1", "desc", ["web"], []));
    expect(reg.describeForLLM({ tag: "citations" })).toBe(
      "(no skills available)",
    );
  });

  it("lists all skills with name and description when no filter", () => {
    const reg = new BuiltinSkillCatalog();
    reg.register(makeSkill("web-search", "search the web"));
    reg.register(makeSkill("summarize", "summarize text"));
    const txt = reg.describeForLLM();
    expect(txt).toContain("web-search");
    expect(txt).toContain("search the web");
    expect(txt).toContain("summarize");
  });

  it("includes tags in brackets when present", () => {
    const reg = new BuiltinSkillCatalog();
    reg.register(makeSkill("s1", "desc", ["web", "research"]));
    const txt = reg.describeForLLM();
    expect(txt).toContain("[web, research]");
  });

  it("does not include tags section when tags is empty", () => {
    const reg = new BuiltinSkillCatalog();
    reg.register(makeSkill("s1", "desc", []));
    const txt = reg.describeForLLM();
    expect(txt).not.toContain("[");
  });

  it("filters by roleId correctly", () => {
    const reg = new BuiltinSkillCatalog();
    reg.register(makeSkill("r-skill", "r desc", [], ["researcher"]));
    reg.register(makeSkill("w-skill", "w desc", [], ["writer"]));
    const txt = reg.describeForLLM({ roleId: "researcher" });
    expect(txt).toContain("r-skill");
    expect(txt).not.toContain("w-skill");
  });

  it("filters by tag correctly", () => {
    const reg = new BuiltinSkillCatalog();
    reg.register(makeSkill("s1", "d", ["citations"], []));
    reg.register(makeSkill("s2", "d", ["web"], []));
    const txt = reg.describeForLLM({ tag: "citations" });
    expect(txt).toContain("s1");
    expect(txt).not.toContain("s2");
  });

  it("applies both roleId and tag filters (AND)", () => {
    const reg = new BuiltinSkillCatalog();
    reg.register(makeSkill("match", "d", ["web"], ["researcher"]));
    reg.register(makeSkill("no-role", "d", ["web"], ["writer"]));
    reg.register(makeSkill("no-tag", "d", ["other"], ["researcher"]));
    const txt = reg.describeForLLM({ roleId: "researcher", tag: "web" });
    expect(txt).toContain("match");
    expect(txt).not.toContain("no-role");
    expect(txt).not.toContain("no-tag");
  });
});

describe("BuiltinSkillCatalog — recommend", () => {
  it("returns empty when no skills registered", () => {
    const reg = new BuiltinSkillCatalog();
    expect(reg.recommend("web search")).toHaveLength(0);
  });

  it("returns skills matching query keywords", () => {
    const reg = new BuiltinSkillCatalog();
    reg.register(makeSkill("web-search", "search the web internet", ["web"]));
    reg.register(makeSkill("text-analyze", "analyze text documents"));
    const results = reg.recommend("web internet");
    expect(results.map((s) => s.frontmatter.name)).toContain("web-search");
  });

  it("does not return skills with no keyword overlap", () => {
    const reg = new BuiltinSkillCatalog();
    reg.register(makeSkill("unrelated", "something completely different"));
    const results = reg.recommend("quantum physics");
    expect(results).toHaveLength(0);
  });

  it("returns at most k results", () => {
    const reg = new BuiltinSkillCatalog();
    for (let i = 0; i < 10; i++) {
      reg.register(makeSkill(`skill-${i}`, "research data analysis"));
    }
    const results = reg.recommend("research data analysis", 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("ignores short words (length <= 2) in query", () => {
    const reg = new BuiltinSkillCatalog();
    reg.register(makeSkill("s1", "web search"));
    // Query only has words of length <= 2 — no matches
    const results = reg.recommend("a b c");
    expect(results).toHaveLength(0);
  });

  it("sorts by relevance score descending", () => {
    const reg = new BuiltinSkillCatalog();
    reg.register(makeSkill("high", "web search research analysis overview"));
    reg.register(makeSkill("low", "web documents"));
    const results = reg.recommend("web search research analysis");
    expect(results[0].frontmatter.name).toBe("high");
  });

  it("uses default k=3", () => {
    const reg = new BuiltinSkillCatalog();
    for (let i = 0; i < 5; i++) {
      reg.register(
        makeSkill(`skill-${i}`, "research analysis web search data"),
      );
    }
    const results = reg.recommend("research analysis web");
    expect(results.length).toBeLessThanOrEqual(3);
  });
});


