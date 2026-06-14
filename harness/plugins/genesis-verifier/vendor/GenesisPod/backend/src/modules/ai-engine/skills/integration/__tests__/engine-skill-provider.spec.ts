/**
 * EngineSkillProvider 单元测试 — verify ai-engine SkillRegistry → harness ISkill 转换
 */

import { EngineSkillProvider } from "../adapters/engine-skill-provider.adapter";
import { PromptSkillAdapter } from "../adapters/prompt-skill.adapter";
import { SkillRegistry } from "../../registry/skill.registry";

function makePromptAdapter(opts: {
  id: string;
  name: string;
  description?: string;
  body: string;
  tags?: string[];
  version?: string;
}): PromptSkillAdapter {
  // Bypass real constructor (which needs SkillPromptBuilder + IChatProvider)
  // by partially constructing via cast — the engine-skill-provider only reads
  // getDefinitionMetadata() / getPromptContent() / instanceof check
  const fake = Object.create(
    PromptSkillAdapter.prototype,
  ) as PromptSkillAdapter;
  Object.defineProperties(fake, {
    id: { value: opts.id },
    name: { value: opts.name },
    description: { value: opts.description ?? "" },
    layer: { value: "content" },
    domain: { value: "test" },
    tags: { value: opts.tags },
    version: { value: opts.version },
  });
  // Provide method shims
  Object.assign(fake, {
    getPromptContent: () => opts.body,
    getDefinitionMetadata: () => ({
      id: opts.id,
      name: opts.name,
      description: opts.description ?? "",
      layer: "content",
      domain: "test",
      tags: opts.tags,
      version: opts.version,
    }),
  });
  return fake;
}

describe("EngineSkillProvider", () => {
  let registry: SkillRegistry;
  let provider: EngineSkillProvider;

  beforeEach(() => {
    registry = new SkillRegistry();
    provider = new EngineSkillProvider(registry);
  });

  it("has expected provider id", () => {
    expect(provider.id).toBe("ai-engine.skill.registry");
  });

  it("returns null when name not in registry", () => {
    expect(provider.resolveByName("unknown")).toBeNull();
  });

  it("converts PromptSkillAdapter to harness ISkill shape", () => {
    const adapter = makePromptAdapter({
      id: "my-skill",
      name: "my-skill",
      description: "user-defined skill",
      body: "# My Skill\n\nDo X then Y.",
      tags: ["custom", "user"],
      version: "1.0.0",
    });
    registry.register(adapter);

    const result = provider.resolveByName("my-skill");
    expect(result).not.toBeNull();
    expect(result?.frontmatter.name).toBe("my-skill");
    expect(result?.frontmatter.description).toBe("user-defined skill");
    expect(result?.frontmatter.version).toBe("1.0.0");
    expect(result?.frontmatter.tags).toEqual(["custom", "user"]);
    expect(result?.instructions).toBe("# My Skill\n\nDo X then Y.");
  });

  it("returns null for non-PromptSkillAdapter (code-based skill)", () => {
    // 模拟一个非 PromptSkillAdapter 的 ISkill 实现（普通对象不会通过 instanceof 检查）
    const codeBased = {
      id: "code-skill",
      name: "code-skill",
      description: "",
      layer: "content" as const,
      domain: "test",
      execute: () => Promise.resolve({}),
    };
    registry.register(codeBased as never);

    expect(provider.resolveByName("code-skill")).toBeNull();
  });

  it("missing description defaults to empty string", () => {
    const adapter = makePromptAdapter({
      id: "no-desc",
      name: "no-desc",
      description: undefined,
      body: "body",
    });
    registry.register(adapter);

    const result = provider.resolveByName("no-desc");
    expect(result?.frontmatter.description).toBe("");
  });
});
