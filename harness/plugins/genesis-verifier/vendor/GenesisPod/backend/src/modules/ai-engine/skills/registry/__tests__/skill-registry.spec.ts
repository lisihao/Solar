/**
 * Unit tests for SkillRegistry
 */

import { Test, TestingModule } from "@nestjs/testing";
import { SkillRegistry } from "../skill.registry";
import {
  ISkill,
  SkillLayer,
  TriggerRule,
} from "../../abstractions/skill.interface";
import { SkillDefinition } from "../../abstractions/skill.interface";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSkill(
  id: string,
  layer: SkillLayer = "content",
  domain: string = "writing",
  tags?: string[],
  version?: string,
  triggers?: TriggerRule[],
): ISkill {
  return {
    id,
    name: `Skill ${id}`,
    description: `Description of ${id}`,
    layer,
    domain,
    tags,
    version,
    triggers,
    execute: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SkillRegistry", () => {
  let registry: SkillRegistry;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SkillRegistry],
    }).compile();

    registry = module.get<SkillRegistry>(SkillRegistry);
  });

  // -------------------------------------------------------------------------
  // register / unregister (BaseRegistry override)
  // -------------------------------------------------------------------------

  describe("register", () => {
    it("可以注册 skill", () => {
      const skill = makeSkill("skill-1");

      registry.register(skill);

      expect(registry.has("skill-1")).toBe(true);
      expect(registry.get("skill-1")).toBe(skill);
    });

    it("构建 layer 索引", () => {
      const skill = makeSkill("layer-skill", "planning");
      registry.register(skill);

      const layers = registry.getLayers();

      expect(layers).toContain("planning");
    });

    it("构建 domain 索引", () => {
      const skill = makeSkill("domain-skill", "content", "office");
      registry.register(skill);

      const domains = registry.getDomains();

      expect(domains).toContain("office");
    });

    it("构建 tag 索引", () => {
      const skill = makeSkill("tagged-skill", "content", "writing", [
        "ai",
        "writing",
      ]);
      registry.register(skill);

      const tags = registry.getTags();

      expect(tags).toContain("ai");
      expect(tags).toContain("writing");
    });

    it("重复注册相同 ID 的 skill 时报错", () => {
      const skill = makeSkill("dup-skill");
      registry.register(skill);

      expect(() => registry.register(skill)).toThrow("already registered");
    });

    it("tags 为 undefined 的 skill 也能正常注册", () => {
      const skill = makeSkill("no-tags-skill", "content", "writing", undefined);
      registry.register(skill);

      expect(registry.has("no-tags-skill")).toBe(true);
    });
  });

  describe("unregister", () => {
    it("可以注销 skill", () => {
      const skill = makeSkill("unregister-skill");
      registry.register(skill);

      const result = registry.unregister("unregister-skill");

      expect(result).toBe(true);
      expect(registry.has("unregister-skill")).toBe(false);
    });

    it("注销不存在的 skill 返回 false", () => {
      const result = registry.unregister("nonexistent");

      expect(result).toBe(false);
    });

    it("注销时同步更新 layer 索引", () => {
      const skill = makeSkill("layer-unregister", "rendering");
      registry.register(skill);
      registry.unregister("layer-unregister");

      const byLayer = registry.getByLayer("rendering");

      expect(byLayer).toHaveLength(0);
    });

    it("注销时同步更新 domain 索引", () => {
      const skill = makeSkill("domain-unregister", "content", "office");
      registry.register(skill);
      registry.unregister("domain-unregister");

      const byDomain = registry.getByDomain("office");

      expect(byDomain).toHaveLength(0);
    });

    it("注销时同步更新 tag 索引", () => {
      const skill = makeSkill("tag-unregister", "content", "writing", [
        "special-tag",
      ]);
      registry.register(skill);
      registry.unregister("tag-unregister");

      const byTag = registry.getByTag("special-tag");

      expect(byTag).toHaveLength(0);
    });

    it("注销时同步删除 factory", () => {
      const skill = makeSkill("factory-unregister");
      const definition: SkillDefinition = {
        id: "factory-unregister",
        name: "Factory Unregister",
        description: "Test",
        layer: "content",
        domain: "writing",
        factory: () => skill,
      };
      registry.register(skill);
      registry.registerDefinition(definition);
      registry.unregister("factory-unregister");

      expect(registry.has("factory-unregister")).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // registerDefinition
  // -------------------------------------------------------------------------

  describe("registerDefinition", () => {
    it("可以注册带 factory 的定义", () => {
      const skill = makeSkill("def-skill");
      const definition: SkillDefinition = {
        id: "def-skill",
        name: "Definition Skill",
        description: "Test definition",
        layer: "content",
        domain: "writing",
        factory: () => skill,
      };

      registry.register(skill);
      registry.registerDefinition(definition);

      expect(registry.has("def-skill")).toBe(true);
    });

    it("可以注册不带 factory 的定义", () => {
      const skill = makeSkill("no-factory-skill");
      const definition: SkillDefinition = {
        id: "no-factory-skill",
        name: "No Factory Skill",
        description: "Test",
        layer: "content",
        domain: "writing",
      };

      registry.register(skill);
      registry.registerDefinition(definition);

      expect(registry.has("no-factory-skill")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // getByLayer
  // -------------------------------------------------------------------------

  describe("getByLayer", () => {
    it("返回指定 layer 的 skill", () => {
      registry.register(makeSkill("planning-skill", "planning"));
      registry.register(makeSkill("content-skill", "content"));
      registry.register(makeSkill("another-planning", "planning"));

      const planningSkills = registry.getByLayer("planning");

      expect(planningSkills).toHaveLength(2);
      expect(planningSkills.map((s) => s.id)).toContain("planning-skill");
      expect(planningSkills.map((s) => s.id)).toContain("another-planning");
    });

    it("不存在的 layer 返回空数组", () => {
      const result = registry.getByLayer("nonexistent" as SkillLayer);

      expect(result).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // getByDomain
  // -------------------------------------------------------------------------

  describe("getByDomain", () => {
    it("返回指定 domain 的 skill", () => {
      registry.register(makeSkill("writing-skill", "content", "writing"));
      registry.register(makeSkill("office-skill", "content", "office"));

      const writingSkills = registry.getByDomain("writing");

      expect(writingSkills).toHaveLength(1);
      expect(writingSkills[0].id).toBe("writing-skill");
    });

    it("不存在的 domain 返回空数组", () => {
      const result = registry.getByDomain("nonexistent");

      expect(result).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // getByTag
  // -------------------------------------------------------------------------

  describe("getByTag", () => {
    it("返回指定 tag 的 skill", () => {
      registry.register(
        makeSkill("ai-skill", "content", "writing", ["ai", "nlp"]),
      );
      registry.register(
        makeSkill("writing-skill", "content", "writing", ["writing"]),
      );

      const aiSkills = registry.getByTag("ai");

      expect(aiSkills).toHaveLength(1);
      expect(aiSkills[0].id).toBe("ai-skill");
    });

    it("不存在的 tag 返回空数组", () => {
      const result = registry.getByTag("nonexistent-tag");

      expect(result).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // getLayers / getDomains / getTags
  // -------------------------------------------------------------------------

  describe("getLayers", () => {
    it("返回所有已注册的 layer", () => {
      registry.register(makeSkill("s1", "planning"));
      registry.register(makeSkill("s2", "rendering"));

      const layers = registry.getLayers();

      expect(layers).toContain("planning");
      expect(layers).toContain("rendering");
    });

    it("skill 数量为 0 时返回空数组", () => {
      expect(registry.getLayers()).toHaveLength(0);
    });
  });

  describe("getDomains", () => {
    it("返回所有已注册的 domain", () => {
      registry.register(makeSkill("s1", "content", "writing"));
      registry.register(makeSkill("s2", "content", "office"));

      const domains = registry.getDomains();

      expect(domains).toContain("writing");
      expect(domains).toContain("office");
    });
  });

  describe("getTags", () => {
    it("返回所有已注册的 tag", () => {
      registry.register(
        makeSkill("s1", "content", "writing", ["tag-a", "tag-b"]),
      );

      const tags = registry.getTags();

      expect(tags).toContain("tag-a");
      expect(tags).toContain("tag-b");
    });
  });

  // -------------------------------------------------------------------------
  // getStats
  // -------------------------------------------------------------------------

  describe("getStats", () => {
    it("返回正确的统计信息", () => {
      registry.register(makeSkill("stat-skill-1", "planning", "writing"));
      registry.register(makeSkill("stat-skill-2", "content", "office"));
      registry.register(makeSkill("stat-skill-3", "planning", "writing"));

      const stats = registry.getStats();

      expect(stats.total).toBe(3);
      expect(stats.byLayer["planning"]).toBe(2);
      expect(stats.byLayer["content"]).toBe(1);
      expect(stats.byDomain["writing"]).toBe(2);
      expect(stats.byDomain["office"]).toBe(1);
    });

    it("skill 数量为 0 时统计数据正确", () => {
      const stats = registry.getStats();

      expect(stats.total).toBe(0);
      expect(stats.byLayer).toEqual({});
      expect(stats.byDomain).toEqual({});
    });
  });

  // -------------------------------------------------------------------------
  // compareVersions
  // -------------------------------------------------------------------------

  describe("compareVersions", () => {
    it("较大版本比较结果正确", () => {
      expect(registry.compareVersions("2.0.0", "1.0.0")).toBe(1);
      expect(registry.compareVersions("1.1.0", "1.0.0")).toBe(1);
      expect(registry.compareVersions("1.0.1", "1.0.0")).toBe(1);
    });

    it("较小版本比较结果正确", () => {
      expect(registry.compareVersions("1.0.0", "2.0.0")).toBe(-1);
      expect(registry.compareVersions("1.0.0", "1.1.0")).toBe(-1);
    });

    it("相同版本返回 0", () => {
      expect(registry.compareVersions("1.0.0", "1.0.0")).toBe(0);
      expect(registry.compareVersions("2.3.4", "2.3.4")).toBe(0);
    });

    it("版本部分缺失时视为 0", () => {
      expect(registry.compareVersions("1.0", "1.0.0")).toBe(0);
      expect(registry.compareVersions("2", "2.0.0")).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // isVersionCompatible
  // -------------------------------------------------------------------------

  describe("isVersionCompatible", () => {
    it("相同主版本号时兼容", () => {
      registry.register(
        makeSkill("versioned-skill", "content", "writing", undefined, "2.3.4"),
      );

      expect(registry.isVersionCompatible("versioned-skill", "2.0.0")).toBe(
        true,
      );
      expect(registry.isVersionCompatible("versioned-skill", "2.9.9")).toBe(
        true,
      );
    });

    it("不同主版本号时不兼容", () => {
      registry.register(
        makeSkill("v2-skill", "content", "writing", undefined, "2.0.0"),
      );

      expect(registry.isVersionCompatible("v2-skill", "1.0.0")).toBe(false);
      expect(registry.isVersionCompatible("v2-skill", "3.0.0")).toBe(false);
    });

    it("不存在的 skill 返回 true", () => {
      expect(registry.isVersionCompatible("nonexistent", "1.0.0")).toBe(true);
    });

    it("没有版本信息的 skill 返回 true", () => {
      registry.register(makeSkill("no-version-skill"));

      expect(registry.isVersionCompatible("no-version-skill", "1.0.0")).toBe(
        true,
      );
    });
  });

  // -------------------------------------------------------------------------
  // matchByTrigger
  // -------------------------------------------------------------------------

  describe("matchByTrigger", () => {
    it("通过 keyword 触发器匹配 skill", () => {
      const skill = makeSkill(
        "keyword-skill",
        "content",
        "writing",
        undefined,
        undefined,
        [{ type: "keyword", condition: "hello", priority: 10 }],
      );
      registry.register(skill);

      const matched = registry.matchByTrigger("keyword", "hello world");

      expect(matched).toHaveLength(1);
      expect(matched[0].id).toBe("keyword-skill");
    });

    it("keyword 匹配不区分大小写", () => {
      const skill = makeSkill(
        "case-skill",
        "content",
        "writing",
        undefined,
        undefined,
        [{ type: "keyword", condition: "HELLO" }],
      );
      registry.register(skill);

      const matched = registry.matchByTrigger("keyword", "hello world");

      expect(matched).toHaveLength(1);
    });

    it("通过 intent 触发器完全匹配 skill", () => {
      const skill = makeSkill(
        "intent-skill",
        "content",
        "writing",
        undefined,
        undefined,
        [{ type: "intent", condition: "write-chapter" }],
      );
      registry.register(skill);

      const matched = registry.matchByTrigger("intent", "write-chapter");
      expect(matched).toHaveLength(1);

      const notMatched = registry.matchByTrigger(
        "intent",
        "write-chapter-partial",
      );
      expect(notMatched).toHaveLength(0);
    });

    it("通过 context 触发器正则匹配 skill", () => {
      const skill = makeSkill(
        "context-skill",
        "content",
        "writing",
        undefined,
        undefined,
        [{ type: "context", condition: "document.*editing" }],
      );
      registry.register(skill);

      const matched = registry.matchByTrigger("context", "document is editing");

      expect(matched).toHaveLength(1);
    });

    it("通过 event 触发器正则匹配 skill", () => {
      const skill = makeSkill(
        "event-skill",
        "content",
        "writing",
        undefined,
        undefined,
        [{ type: "event", condition: "file.saved" }],
      );
      registry.register(skill);

      const matched = registry.matchByTrigger("event", "file.saved");
      expect(matched).toHaveLength(1);
    });

    it("按优先级从高到低排序", () => {
      const lowSkill = makeSkill(
        "low-priority-skill",
        "content",
        "writing",
        undefined,
        undefined,
        [{ type: "keyword", condition: "test", priority: 1 }],
      );
      const highSkill = makeSkill(
        "high-priority-skill",
        "content",
        "writing",
        undefined,
        undefined,
        [{ type: "keyword", condition: "test", priority: 10 }],
      );
      registry.register(lowSkill);
      registry.register(highSkill);

      const matched = registry.matchByTrigger("keyword", "test");

      expect(matched[0].id).toBe("high-priority-skill");
      expect(matched[1].id).toBe("low-priority-skill");
    });

    it("没有触发器的 skill 不匹配", () => {
      const skill = makeSkill("no-trigger-skill");
      registry.register(skill);

      const matched = registry.matchByTrigger("keyword", "anything");

      expect(matched).toHaveLength(0);
    });

    it("触发器类型不匹配的 skill 被排除", () => {
      const skill = makeSkill(
        "intent-only-skill",
        "content",
        "writing",
        undefined,
        undefined,
        [{ type: "intent", condition: "specific-intent" }],
      );
      registry.register(skill);

      const matched = registry.matchByTrigger("keyword", "specific-intent");

      expect(matched).toHaveLength(0);
    });

    it("同一 skill 匹配多个触发器时只返回一次", () => {
      const skill = makeSkill(
        "multi-trigger-skill",
        "content",
        "writing",
        undefined,
        undefined,
        [
          { type: "keyword", condition: "hello" },
          { type: "keyword", condition: "world" },
        ],
      );
      registry.register(skill);

      const matched = registry.matchByTrigger("keyword", "hello world");

      expect(matched).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // search
  // -------------------------------------------------------------------------

  describe("search", () => {
    beforeEach(() => {
      registry.register(
        makeSkill("ai-writing-skill", "content", "writing", ["ai", "nlp"]),
      );
      registry.register(
        makeSkill("office-planning", "planning", "office", ["productivity"]),
      );
      registry.register(
        makeSkill("research-tool", "content", "research", ["ai", "search"]),
      );
    });

    it("通过关键字搜索 skill", () => {
      const results = registry.search({ keyword: "writing" });

      expect(results.some((s) => s.id === "ai-writing-skill")).toBe(true);
    });

    it("通过 layer 过滤", () => {
      const results = registry.search({ layer: "planning" });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("office-planning");
    });

    it("通过 domain 过滤", () => {
      const results = registry.search({ domain: "research" });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("research-tool");
    });

    it("通过 tag 过滤", () => {
      const results = registry.search({ tags: ["ai"] });

      expect(results).toHaveLength(2);
      expect(results.map((s) => s.id)).toContain("ai-writing-skill");
      expect(results.map((s) => s.id)).toContain("research-tool");
    });

    it("组合多个条件过滤", () => {
      const results = registry.search({ domain: "writing", tags: ["ai"] });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("ai-writing-skill");
    });

    it("没有匹配条件时返回空数组", () => {
      const results = registry.search({ keyword: "nonexistent-keyword-xyz" });

      expect(results).toHaveLength(0);
    });

    it("无过滤条件时返回全部 skill", () => {
      const results = registry.search({});

      expect(results).toHaveLength(3);
    });

    it("通过 description 关键字搜索", () => {
      // "research-tool" 的 description 为 "Description of research-tool"
      const results = registry.search({ keyword: "research-tool" });

      expect(results.some((s) => s.id === "research-tool")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // ReDoS 防护（P0-3 修复验证）
  // -------------------------------------------------------------------------

  describe("matchByTrigger ReDoS 防护", () => {
    it("危险正则 (a+)+ 模式被跳过，不抛出异常", () => {
      const skill = makeSkill(
        "redos-skill",
        "content",
        "writing",
        undefined,
        undefined,
        [{ type: "context", condition: "(a+)+b", priority: 0 }],
      );
      registry.register(skill);

      expect(() =>
        registry.matchByTrigger("context", "aaaaaaaaaaaaaaaaaac"),
      ).not.toThrow();

      // 危险正则被跳过，不匹配
      const matched = registry.matchByTrigger("context", "aaaaaaaaaaaaaaaaaac");
      expect(matched).toHaveLength(0);
    });

    it("无效正则被 try-catch 捕获，不崩溃", () => {
      const skill = makeSkill(
        "invalid-regex-skill",
        "content",
        "writing",
        undefined,
        undefined,
        [{ type: "context", condition: "[invalid", priority: 0 }],
      );
      registry.register(skill);

      expect(() =>
        registry.matchByTrigger("context", "some value"),
      ).not.toThrow();
    });

    it("合法正则仍然正常匹配", () => {
      const skill = makeSkill(
        "valid-regex-skill",
        "content",
        "writing",
        undefined,
        undefined,
        [{ type: "context", condition: "^hello\\s+world$", priority: 0 }],
      );
      registry.register(skill);

      const matched = registry.matchByTrigger("context", "hello   world");
      expect(matched).toHaveLength(1);
      expect(matched[0].id).toBe("valid-regex-skill");
    });
  });

  // -------------------------------------------------------------------------
  // BaseRegistry methods (inherited)
  // -------------------------------------------------------------------------

  describe("BaseRegistry 方法（继承）", () => {
    it("getAll 返回全部 skill", () => {
      registry.register(makeSkill("all-1"));
      registry.register(makeSkill("all-2"));

      expect(registry.getAll()).toHaveLength(2);
    });

    it("getAllIds 返回全部 ID", () => {
      registry.register(makeSkill("id-1"));
      registry.register(makeSkill("id-2"));

      const ids = registry.getAllIds();

      expect(ids).toContain("id-1");
      expect(ids).toContain("id-2");
    });

    it("hasAll 在全部 ID 存在时返回 true", () => {
      registry.register(makeSkill("has-1"));
      registry.register(makeSkill("has-2"));

      expect(registry.hasAll(["has-1", "has-2"])).toBe(true);
      expect(registry.hasAll(["has-1", "nonexistent"])).toBe(false);
    });

    it("registerMany 批量注册多个 skill", () => {
      registry.registerMany([
        makeSkill("many-1"),
        makeSkill("many-2"),
        makeSkill("many-3"),
      ]);

      expect(registry.size()).toBe(3);
    });

    it("clear 删除全部 skill", () => {
      registry.register(makeSkill("clear-1"));
      registry.register(makeSkill("clear-2"));

      registry.clear();

      expect(registry.size()).toBe(0);
    });

    it("get 对不存在的 ID 抛出错误", () => {
      expect(() => registry.get("nonexistent")).toThrow("not found");
    });

    it("tryGet 对不存在的 ID 返回 undefined", () => {
      expect(registry.tryGet("nonexistent")).toBeUndefined();
    });
  });
});

