/**
 * SkillLoader 集成测试 — 从注入的 EXTRA_SKILL_DIRS 加载 SKILL.md
 *
 * R0-A3 (2026-05-04)：harness 自身不再持有任何 SKILL.md。loader 接受 ai-app
 * 注入的目录数组（如 playground 的 skills/）作为加载源。
 */

import * as path from "path";
import { SkillLoader } from "../skill-loader";
import { BuiltinSkillCatalog } from "../skill-registry";

const PLAYGROUND_SKILLS = path.resolve(
  __dirname,
  "../../../../ai-app/playground/mission/skills",
);

describe("SkillLoader (with injected skill dirs)", () => {
  it("returns empty when no extraDirs injected", async () => {
    const registry = new BuiltinSkillCatalog();
    const loader = new SkillLoader(registry); // no extraDirs
    const skills = await loader.loadAll();
    expect(skills).toEqual([]);
  });

  it("loads SKILL.md files from injected dir", async () => {
    const registry = new BuiltinSkillCatalog();
    const loader = new SkillLoader(registry, [PLAYGROUND_SKILLS]);
    const skills = await loader.loadAll();
    const names = skills.map((s) => s.frontmatter.name).sort();
    expect(names).toContain("web-research");
    expect(names).toContain("critical-review");
  });

  it("loadById returns a known skill from injected dir", async () => {
    const registry = new BuiltinSkillCatalog();
    const loader = new SkillLoader(registry, [PLAYGROUND_SKILLS]);
    const skill = await loader.loadById("web-research");
    expect(skill).not.toBeNull();
    expect(skill?.frontmatter.name).toBe("web-research");
    expect(skill?.frontmatter.tags).toContain("research");
    expect(skill?.instructions).toContain("Discovery");
  });

  it("loadById returns null for unknown skill", async () => {
    const registry = new BuiltinSkillCatalog();
    const loader = new SkillLoader(registry, [PLAYGROUND_SKILLS]);
    const skill = await loader.loadById("non-existent-skill-xyz");
    expect(skill).toBeNull();
  });

  it("loadById returns null when no dirs injected", async () => {
    const registry = new BuiltinSkillCatalog();
    const loader = new SkillLoader(registry);
    const skill = await loader.loadById("web-research");
    expect(skill).toBeNull();
  });

  it("onModuleInit populates the registry from injected dir", async () => {
    const registry = new BuiltinSkillCatalog();
    const loader = new SkillLoader(registry, [PLAYGROUND_SKILLS]);
    await loader.onModuleInit();
    expect(registry.size()).toBeGreaterThanOrEqual(2);
    expect(registry.has("web-research")).toBe(true);
    expect(registry.has("critical-review")).toBe(true);
  });

  it("onModuleInit no-op when no dirs injected", async () => {
    const registry = new BuiltinSkillCatalog();
    const loader = new SkillLoader(registry);
    await loader.onModuleInit();
    expect(registry.size()).toBe(0);
  });
});
