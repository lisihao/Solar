/**
 * BuiltinSkillCatalog 单元测试
 */

import { BuiltinSkillCatalog } from "../skill-registry";
import type { ISkill } from "../../abstractions";

function makeSkill(
  name: string,
  tags: string[] = [],
  activateFor: string[] = [],
): ISkill {
  return {
    frontmatter: { name, description: `desc of ${name}`, tags, activateFor },
    instructions: `instructions for ${name}`,
  };
}

describe("BuiltinSkillCatalog", () => {
  it("registers and retrieves by name", () => {
    const reg = new BuiltinSkillCatalog();
    const skill = makeSkill("web-research");
    reg.register(skill);
    expect(reg.has("web-research")).toBe(true);
    expect(reg.get("web-research")).toBe(skill);
    expect(reg.size()).toBe(1);
  });

  it("overwrites on duplicate register", () => {
    const reg = new BuiltinSkillCatalog();
    reg.register(makeSkill("s1", ["v1"]));
    reg.register(makeSkill("s1", ["v2"]));
    expect(reg.size()).toBe(1);
    expect(reg.get("s1")?.frontmatter.tags).toEqual(["v2"]);
  });

  it("registerAll bulk loads", () => {
    const reg = new BuiltinSkillCatalog();
    reg.registerAll([makeSkill("a"), makeSkill("b"), makeSkill("c")]);
    expect(reg.size()).toBe(3);
    expect(reg.all().map((s) => s.frontmatter.name)).toEqual(["a", "b", "c"]);
  });

  it("listByTag filters correctly", () => {
    const reg = new BuiltinSkillCatalog();
    reg.register(makeSkill("s1", ["research", "web"]));
    reg.register(makeSkill("s2", ["review"]));
    reg.register(makeSkill("s3", ["research"]));
    const researchSkills = reg
      .listByTag("research")
      .map((s) => s.frontmatter.name);
    expect(researchSkills.sort()).toEqual(["s1", "s3"]);
  });

  it("listForRole filters by activateFor", () => {
    const reg = new BuiltinSkillCatalog();
    reg.register(makeSkill("s1", [], ["researcher", "analyst"]));
    reg.register(makeSkill("s2", [], ["critic"]));
    reg.register(makeSkill("s3", [], ["analyst"]));
    const analystSkills = reg
      .listForRole("analyst")
      .map((s) => s.frontmatter.name);
    expect(analystSkills.sort()).toEqual(["s1", "s3"]);
  });

  it("clear removes all", () => {
    const reg = new BuiltinSkillCatalog();
    reg.registerAll([makeSkill("a"), makeSkill("b")]);
    reg.clear();
    expect(reg.size()).toBe(0);
  });
});


