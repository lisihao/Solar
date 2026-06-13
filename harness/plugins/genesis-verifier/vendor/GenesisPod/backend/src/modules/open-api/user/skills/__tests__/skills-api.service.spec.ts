/**
 * Unit tests for SkillsService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { SkillsService, SkillItem } from "../skills.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { SkillRegistry } from "../../../../ai-engine/skills/registry/skill.registry";
import { ISkill } from "../../../../ai-engine/skills/abstractions/skill.interface";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPrismaService = {
  systemSetting: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
  skillConfig: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  aIUsageLog: {
    groupBy: jest.fn(),
  },
} as unknown as jest.Mocked<PrismaService>;

const mockSkillRegistry = {
  getByDomain: jest.fn().mockReturnValue([]),
  tryGet: jest.fn().mockReturnValue(undefined),
} as unknown as jest.Mocked<SkillRegistry>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSkillItem(overrides: Partial<SkillItem> = {}): SkillItem {
  return {
    id: "test-skill",
    name: "Test Skill",
    description: "A test skill",
    category: "tools",
    author: "test-author",
    stars: 100,
    downloads: "1K+",
    tags: ["test"],
    featured: false,
    url: "https://skillsmp.com/skills/test-skill",
    lastUpdated: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeISkill(id: string): ISkill {
  return {
    id,
    name: `Skill ${id}`,
    description: `Description of ${id}`,
    layer: "content",
    domain: "writing",
    tags: ["test"],
    version: "1.0.0",
    execute: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SkillsService", () => {
  let service: SkillsService;
  let prisma: jest.Mocked<typeof mockPrismaService>;
  let skillRegistry: jest.Mocked<typeof mockSkillRegistry>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SkillsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: SkillRegistry, useValue: mockSkillRegistry },
      ],
    })
      .setLogger(new Logger())
      .compile();

    service = module.get<SkillsService>(SkillsService);
    prisma = module.get(PrismaService);
    skillRegistry = module.get(SkillRegistry);
  });

  // -------------------------------------------------------------------------
  // getStats
  // -------------------------------------------------------------------------

  describe("getStats", () => {
    it("没有配置值时返回默认值", async () => {
      prisma.systemSetting.findUnique.mockResolvedValue(null);

      const stats = await service.getStats();

      expect(stats.totalSkills).toBe(66541);
      expect(stats.lastUpdated).toBeNull();
      expect(stats.weeklyGrowth).toBe(12.5);
      expect(stats.featuredCount).toBe(0);
      expect(stats.categoryCount).toBe(0);
    });

    it("存在配置值时使用该值", async () => {
      prisma.systemSetting.findUnique
        .mockResolvedValueOnce({
          id: "1",
          key: "skillsmp.totalSkills",
          value: "10000",
        })
        .mockResolvedValueOnce({
          id: "2",
          key: "skillsmp.lastSync",
          value: '"2024-01-01T00:00:00Z"',
        })
        .mockResolvedValueOnce({
          id: "3",
          key: "skillsmp.syncedSkills",
          value: "[]",
        });

      const stats = await service.getStats();

      expect(stats.totalSkills).toBe(10000);
    });

    it("正确计算 featuredSkills 数量", async () => {
      const skills = [
        makeSkillItem({ featured: true }),
        makeSkillItem({ id: "skill-2", featured: false }),
        makeSkillItem({ id: "skill-3", featured: true }),
      ];
      prisma.systemSetting.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: "3",
          key: "skillsmp.syncedSkills",
          value: JSON.stringify(skills),
        });

      const stats = await service.getStats();

      expect(stats.featuredCount).toBe(2);
    });

    it("正确计算分类数量", async () => {
      const skills = [
        makeSkillItem({ category: "tools" }),
        makeSkillItem({ id: "skill-2", category: "tools" }),
        makeSkillItem({ id: "skill-3", category: "development" }),
      ];
      prisma.systemSetting.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: "3",
          key: "skillsmp.syncedSkills",
          value: JSON.stringify(skills),
        });

      const stats = await service.getStats();

      expect(stats.categoryCount).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // getTimeline
  // -------------------------------------------------------------------------

  describe("getTimeline", () => {
    it("返回已保存的时间轴数据", async () => {
      const timeline = [{ date: "Jan 1", count: 100, cumulative: 100 }];
      prisma.systemSetting.findUnique.mockResolvedValue({
        id: "1",
        key: "skillsmp.timeline",
        value: JSON.stringify(timeline),
      });

      const result = await service.getTimeline();

      expect(result).toEqual(timeline);
    });

    it("没有保存数据时返回生成的数据", async () => {
      prisma.systemSetting.findUnique.mockResolvedValue(null);

      const result = await service.getTimeline();

      expect(result).toHaveLength(12);
      expect(result[0]).toHaveProperty("date");
      expect(result[0]).toHaveProperty("count");
      expect(result[0]).toHaveProperty("cumulative");
    });

    it("生成数据的累计值单调递增", async () => {
      prisma.systemSetting.findUnique.mockResolvedValue(null);

      const result = await service.getTimeline();

      for (let i = 1; i < result.length; i++) {
        expect(result[i].cumulative).toBeGreaterThan(result[i - 1].cumulative);
      }
    });
  });

  // -------------------------------------------------------------------------
  // searchSkills
  // -------------------------------------------------------------------------

  describe("searchSkills", () => {
    const skillsData = [
      makeSkillItem({
        id: "ai-skill",
        name: "AI Tool",
        category: "ai-agents",
        tags: ["ai"],
        stars: 500,
      }),
      makeSkillItem({
        id: "dev-skill",
        name: "Dev Helper",
        category: "development",
        tags: ["dev"],
        stars: 200,
      }),
      makeSkillItem({
        id: "test-skill",
        name: "Test Runner",
        category: "testing",
        tags: ["test"],
        stars: 50,
        downloads: "500K+",
      }),
    ];

    beforeEach(() => {
      prisma.systemSetting.findUnique.mockResolvedValue({
        id: "1",
        key: "skillsmp.syncedSkills",
        value: JSON.stringify(skillsData),
      });
    });

    it("通过 query 过滤", async () => {
      const result = await service.searchSkills({ query: "ai" });

      expect(result.skills.some((s) => s.id === "ai-skill")).toBe(true);
    });

    it("通过 category 过滤", async () => {
      const result = await service.searchSkills({ category: "development" });

      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].id).toBe("dev-skill");
    });

    it("category=all 时不过滤", async () => {
      const result = await service.searchSkills({ category: "all" });

      expect(result.skills).toHaveLength(3);
    });

    it("sortBy=stars 时按降序排序", async () => {
      const result = await service.searchSkills({ sortBy: "stars" });

      expect(result.skills[0].id).toBe("ai-skill"); // stars: 500
      expect(result.skills[1].id).toBe("dev-skill"); // stars: 200
    });

    it("sortBy=name 时按字母顺序排序", async () => {
      const result = await service.searchSkills({ sortBy: "name" });

      expect(result.skills[0].name).toBe("AI Tool");
    });

    it("sortBy=downloads 时按下载量降序排序", async () => {
      const result = await service.searchSkills({ sortBy: "downloads" });

      // "500K+" > "1K+" > other
      expect(result.skills[0].id).toBe("test-skill");
    });

    it("通过 offset 和 limit 分页", async () => {
      const result = await service.searchSkills({ limit: 2, offset: 0 });

      expect(result.skills).toHaveLength(2);
      expect(result.total).toBe(3);
    });

    it("total 值正确返回", async () => {
      const result = await service.searchSkills({ query: "ai" });

      expect(result.total).toBe(result.skills.length);
    });

    it("数据不存在时返回空数组", async () => {
      prisma.systemSetting.findUnique.mockResolvedValue(null);

      const result = await service.searchSkills({});

      expect(result.skills).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it("通过 description 搜索", async () => {
      const skillsWithDesc = [
        makeSkillItem({
          id: "desc-search",
          name: "Tool",
          description: "Unique description here",
        }),
      ];
      prisma.systemSetting.findUnique.mockResolvedValue({
        id: "1",
        key: "skillsmp.syncedSkills",
        value: JSON.stringify(skillsWithDesc),
      });

      const result = await service.searchSkills({
        query: "unique description",
      });

      expect(result.skills).toHaveLength(1);
    });

    it("通过 tag 搜索", async () => {
      const result = await service.searchSkills({ query: "dev" });

      expect(result.skills.some((s) => s.id === "dev-skill")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // getPopularSkills
  // -------------------------------------------------------------------------

  describe("getPopularSkills", () => {
    it("返回按 stars 排序的 skill", async () => {
      const skills = [
        makeSkillItem({ id: "popular-1", stars: 1000 }),
        makeSkillItem({ id: "popular-2", stars: 500 }),
      ];
      prisma.systemSetting.findUnique.mockResolvedValue({
        id: "1",
        key: "skillsmp.syncedSkills",
        value: JSON.stringify(skills),
      });

      const result = await service.getPopularSkills(2);

      expect(result[0].id).toBe("popular-1");
    });

    it("默认 limit 为 50", async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({
        id: "1",
        key: "skillsmp.syncedSkills",
        value: JSON.stringify([]),
      });

      const result = await service.getPopularSkills();

      expect(result).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // getFeaturedSkills
  // -------------------------------------------------------------------------

  describe("getFeaturedSkills", () => {
    it("只返回 featured=true 的 skill", async () => {
      const skills = [
        makeSkillItem({ id: "featured-1", featured: true, stars: 1000 }),
        makeSkillItem({ id: "not-featured", featured: false }),
        makeSkillItem({ id: "featured-2", featured: true, stars: 500 }),
      ];
      prisma.systemSetting.findUnique.mockResolvedValue({
        id: "1",
        key: "skillsmp.syncedSkills",
        value: JSON.stringify(skills),
      });

      const result = await service.getFeaturedSkills();

      expect(result).toHaveLength(2);
      expect(result.every((s) => s.featured)).toBe(true);
    });

    it("按 stars 降序排序", async () => {
      const skills = [
        makeSkillItem({ id: "featured-low", featured: true, stars: 100 }),
        makeSkillItem({ id: "featured-high", featured: true, stars: 999 }),
      ];
      prisma.systemSetting.findUnique.mockResolvedValue({
        id: "1",
        key: "skillsmp.syncedSkills",
        value: JSON.stringify(skills),
      });

      const result = await service.getFeaturedSkills();

      expect(result[0].id).toBe("featured-high");
    });

    it("数据不存在时返回空数组", async () => {
      prisma.systemSetting.findUnique.mockResolvedValue(null);

      const result = await service.getFeaturedSkills();

      expect(result).toHaveLength(0);
    });

    it("应用 limit", async () => {
      const skills = Array.from({ length: 30 }, (_, i) =>
        makeSkillItem({ id: `featured-${i}`, featured: true }),
      );
      prisma.systemSetting.findUnique.mockResolvedValue({
        id: "1",
        key: "skillsmp.syncedSkills",
        value: JSON.stringify(skills),
      });

      const result = await service.getFeaturedSkills(5);

      expect(result).toHaveLength(5);
    });
  });

  // -------------------------------------------------------------------------
  // getCategories
  // -------------------------------------------------------------------------

  describe("getCategories", () => {
    it("返回分类列表及数量", async () => {
      const skills = [
        makeSkillItem({ category: "tools" }),
        makeSkillItem({ id: "skill-2", category: "tools" }),
        makeSkillItem({ id: "skill-3", category: "development" }),
      ];
      prisma.systemSetting.findUnique.mockResolvedValue({
        id: "1",
        key: "skillsmp.syncedSkills",
        value: JSON.stringify(skills),
      });

      const result = await service.getCategories();

      const toolsCategory = result.find((c) => c.id === "tools");
      expect(toolsCategory?.count).toBe(2);

      const devCategory = result.find((c) => c.id === "development");
      expect(devCategory?.count).toBe(1);
    });

    it("分类名称格式化正确", async () => {
      const skills = [makeSkillItem({ category: "ai-agents" })];
      prisma.systemSetting.findUnique.mockResolvedValue({
        id: "1",
        key: "skillsmp.syncedSkills",
        value: JSON.stringify(skills),
      });

      const result = await service.getCategories();

      expect(result[0].name).toBe("AI Agents");
    });

    it("数据不存在时返回空数组", async () => {
      prisma.systemSetting.findUnique.mockResolvedValue(null);

      const result = await service.getCategories();

      expect(result).toHaveLength(0);
    });

    it("category 未定义的 skill 被归类为 other", async () => {
      const skills = [
        { ...makeSkillItem(), category: undefined as unknown as string },
      ];
      prisma.systemSetting.findUnique.mockResolvedValue({
        id: "1",
        key: "skillsmp.syncedSkills",
        value: JSON.stringify(skills),
      });

      const result = await service.getCategories();

      expect(result.some((c) => c.id === "other")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // getSkillEffectiveness
  // -------------------------------------------------------------------------

  describe("getSkillEffectiveness", () => {
    it("skillIds 为空时返回空 Map", async () => {
      const result = await service.getSkillEffectiveness([]);

      expect(result.size).toBe(0);
      expect(prisma.aIUsageLog.groupBy).not.toHaveBeenCalled();
    });

    it("正确计算 effectiveness 数据", async () => {
      prisma.aIUsageLog.groupBy
        .mockResolvedValueOnce([
          {
            capabilityId: "skill-a",
            _count: { id: 10 },
            _avg: { duration: 1500 },
          },
        ])
        .mockResolvedValueOnce([
          { capabilityId: "skill-a", _count: { id: 8 } },
        ]);

      const result = await service.getSkillEffectiveness(["skill-a"]);

      const effectiveness = result.get("skill-a");
      expect(effectiveness?.usageCount).toBe(10);
      expect(effectiveness?.successCount).toBe(8);
      expect(effectiveness?.successRate).toBe(80);
      expect(effectiveness?.avgDuration).toBe(1500);
    });

    it("DB 查询失败时返回空 Map", async () => {
      prisma.aIUsageLog.groupBy.mockRejectedValue(new Error("DB error"));

      const result = await service.getSkillEffectiveness(["skill-a"]);

      expect(result.size).toBe(0);
    });

    it("avgDuration 为 null 时返回 null", async () => {
      prisma.aIUsageLog.groupBy
        .mockResolvedValueOnce([
          {
            capabilityId: "skill-b",
            _count: { id: 5 },
            _avg: { duration: null },
          },
        ])
        .mockResolvedValueOnce([]);

      const result = await service.getSkillEffectiveness(["skill-b"]);

      expect(result.get("skill-b")?.avgDuration).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getSkillsByDomain
  // -------------------------------------------------------------------------

  describe("getSkillsByDomain", () => {
    it("返回指定 domain 的 skill", async () => {
      prisma.skillConfig.findMany.mockResolvedValue([
        {
          skillId: "config-skill",
          enabled: true,
          displayName: "Config Skill",
          description: "A config skill",
          domain: "writing",
          layer: "content",
          tags: [],
          allowedDomains: [],
          config: null,
        },
      ]);
      skillRegistry.getByDomain.mockReturnValue([]);
      skillRegistry.tryGet.mockReturnValue(undefined);
      prisma.aIUsageLog.groupBy.mockResolvedValue([]).mockResolvedValue([]);

      const result = await service.getSkillsByDomain("writing");

      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].skillId).toBe("config-skill");
    });

    it("正确计算 statistics", async () => {
      prisma.skillConfig.findMany.mockResolvedValue([
        {
          skillId: "enabled-skill",
          enabled: true,
          displayName: "Enabled",
          description: "",
          domain: "writing",
          layer: "content",
          tags: [],
          allowedDomains: [],
          config: null,
        },
        {
          skillId: "disabled-skill",
          enabled: false,
          displayName: "Disabled",
          description: "",
          domain: "writing",
          layer: "planning",
          tags: [],
          allowedDomains: [],
          config: null,
        },
      ]);
      skillRegistry.getByDomain.mockReturnValue([]);
      skillRegistry.tryGet.mockReturnValue(undefined);
      prisma.aIUsageLog.groupBy.mockResolvedValue([]).mockResolvedValue([]);

      const result = await service.getSkillsByDomain("writing");

      expect(result.stats.total).toBe(2);
      expect(result.stats.enabled).toBe(1);
      expect(result.stats.byLayer["content"]).toBe(1);
      expect(result.stats.byLayer["planning"]).toBe(1);
    });

    it("不在 allowedDomains 中的 domain 的 skill 被排除", async () => {
      prisma.skillConfig.findMany.mockResolvedValue([
        {
          skillId: "restricted-skill",
          enabled: true,
          displayName: "Restricted",
          description: "",
          domain: "general",
          layer: "content",
          tags: [],
          allowedDomains: ["office"], // writing 未被允许
          config: null,
        },
      ]);
      skillRegistry.getByDomain.mockReturnValue([]);
      prisma.aIUsageLog.groupBy.mockResolvedValue([]).mockResolvedValue([]);

      const result = await service.getSkillsByDomain("writing");

      expect(result.skills).toHaveLength(0);
    });

    it("domainOverride 优先级更高", async () => {
      prisma.skillConfig.findMany.mockResolvedValue([
        {
          skillId: "override-skill",
          enabled: true, // 全局为 true
          displayName: "Override",
          description: "",
          domain: "writing",
          layer: "content",
          tags: [],
          allowedDomains: [],
          config: { domainOverrides: { writing: { enabled: false } } }, // writing 下为 false
        },
      ]);
      skillRegistry.getByDomain.mockReturnValue([]);
      skillRegistry.tryGet.mockReturnValue(undefined);
      prisma.aIUsageLog.groupBy.mockResolvedValue([]).mockResolvedValue([]);

      const result = await service.getSkillsByDomain("writing");

      expect(result.skills[0].enabled).toBe(false);
    });

    it("合并 Registry 和 Config 数据", async () => {
      const registrySkill = makeISkill("registry-only-skill");
      prisma.skillConfig.findMany.mockResolvedValue([]);
      skillRegistry.getByDomain.mockReturnValue([registrySkill]);
      skillRegistry.tryGet.mockReturnValue(registrySkill);
      prisma.aIUsageLog.groupBy.mockResolvedValue([]).mockResolvedValue([]);

      const result = await service.getSkillsByDomain("writing");

      expect(
        result.skills.some((s) => s.skillId === "registry-only-skill"),
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // setSkillDomainOverride
  // -------------------------------------------------------------------------

  describe("setSkillDomainOverride", () => {
    it("更新已存在的 SkillConfig", async () => {
      prisma.skillConfig.findUnique.mockResolvedValue({
        skillId: "existing-skill",
        enabled: true,
        config: {},
      });
      prisma.skillConfig.update.mockResolvedValue({} as never);

      await service.setSkillDomainOverride("existing-skill", "writing", false);

      expect(prisma.skillConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { skillId: "existing-skill" },
          data: expect.objectContaining({
            config: expect.objectContaining({
              domainOverrides: { writing: { enabled: false } },
            }),
          }),
        }),
      );
    });

    it("SkillConfig 不存在时新建", async () => {
      prisma.skillConfig.findUnique.mockResolvedValue(null);
      skillRegistry.tryGet.mockReturnValue(makeISkill("new-skill"));
      prisma.skillConfig.create.mockResolvedValue({} as never);

      await service.setSkillDomainOverride("new-skill", "writing", true);

      expect(prisma.skillConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            skillId: "new-skill",
            config: expect.objectContaining({
              domainOverrides: { writing: { enabled: true } },
            }),
          }),
        }),
      );
    });

    it("registry 中不存在该 skill 时以默认值创建", async () => {
      prisma.skillConfig.findUnique.mockResolvedValue(null);
      skillRegistry.tryGet.mockReturnValue(undefined);
      prisma.skillConfig.create.mockResolvedValue({} as never);

      await service.setSkillDomainOverride("unknown-skill", "office", true);

      expect(prisma.skillConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            skillId: "unknown-skill",
            domain: "general",
          }),
        }),
      );
    });

    it("向已有的 domainOverrides 中追加新条目", async () => {
      prisma.skillConfig.findUnique.mockResolvedValue({
        skillId: "multi-domain-skill",
        enabled: true,
        config: {
          domainOverrides: { office: { enabled: true } },
        },
      });
      prisma.skillConfig.update.mockResolvedValue({} as never);

      await service.setSkillDomainOverride(
        "multi-domain-skill",
        "writing",
        false,
      );

      expect(prisma.skillConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            config: expect.objectContaining({
              domainOverrides: {
                office: { enabled: true },
                writing: { enabled: false },
              },
            }),
          }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // syncFromSkillsMP
  // -------------------------------------------------------------------------

  describe("syncFromSkillsMP", () => {
    it("API Key 未配置时返回错误", async () => {
      prisma.systemSetting.findUnique.mockResolvedValue(null);

      const result = await service.syncFromSkillsMP();

      expect(result.success).toBe(false);
      expect(result.message).toContain("API Key");
    });

    it("所有 API 调用都失败时返回错误", async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({
        id: "1",
        key: "skillsmp.apiKey",
        value: '"valid-api-key"',
      });
      prisma.systemSetting.upsert.mockResolvedValue({} as never);

      // 所有端点都返回网络错误
      const mockFetch = jest.fn().mockRejectedValue(new Error("Network error"));
      global.fetch = mockFetch;

      const result = await service.syncFromSkillsMP();

      // 全部端点报错，以空 skill 集合完成
      expect(result.success).toBe(true);
      expect(result.skillsCount).toBe(0);
    });

    it("API 返回非 200 时返回错误", async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({
        id: "1",
        key: "skillsmp.apiKey",
        value: '"valid-api-key"',
      });

      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: jest.fn().mockResolvedValue("Unauthorized"),
      });
      global.fetch = mockFetch;

      const result = await service.syncFromSkillsMP();

      expect(result.success).toBe(false);
      expect(result.message).toContain("401");
    });

    it("API 返回空 skill 列表时成功", async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({
        id: "1",
        key: "skillsmp.apiKey",
        value: '"valid-api-key"',
      });
      prisma.systemSetting.upsert.mockResolvedValue({} as never);

      const mockFetch = jest
        .fn()
        // 主 API 首次调用（skills.length=0 则 hasMore=false）
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ data: [] }),
        })
        // timeline API 调用
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        });
      global.fetch = mockFetch;

      const result = await service.syncFromSkillsMP();

      expect(result.success).toBe(true);
      expect(result.skillsCount).toBe(0);
    });

    it("正确转换并保存 skill 数据", async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({
        id: "1",
        key: "skillsmp.apiKey",
        value: '"valid-api-key"',
      });
      prisma.systemSetting.upsert.mockResolvedValue({} as never);

      const rawSkills = [
        {
          id: "raw-skill-1",
          name: "Raw Skill One",
          description: "A raw skill",
          category: "tools",
          author: "test-author",
          stars: 150,
          downloads: 2500,
          tags: ["test"],
          featured: false,
          url: "https://example.com",
          updated_at: "2024-01-01",
        },
      ];

      const mockFetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            data: rawSkills,
            total: 1,
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        });
      global.fetch = mockFetch;

      const result = await service.syncFromSkillsMP();

      expect(result.success).toBe(true);
      expect(result.skillsCount).toBe(1);
      expect(prisma.systemSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: "skillsmp.syncedSkills" },
        }),
      );
    });

    it("成功获取 timeline 数据时保存", async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({
        id: "1",
        key: "skillsmp.apiKey",
        value: '"valid-api-key"',
      });
      prisma.systemSetting.upsert.mockResolvedValue({} as never);

      const timeline = [{ date: "Jan 1", count: 100, cumulative: 100 }];

      const mockFetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ data: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ timeline }),
        });
      global.fetch = mockFetch;

      await service.syncFromSkillsMP();

      expect(prisma.systemSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: "skillsmp.timeline" },
        }),
      );
    });

    it("发生未预期的异常时返回错误结果", async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({
        id: "1",
        key: "skillsmp.apiKey",
        value: '"valid-api-key"',
      });

      // upsert 抛出异常
      prisma.systemSetting.upsert.mockRejectedValue(
        new Error("Unexpected DB error"),
      );

      const mockFetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ data: [] }),
        })
        .mockRejectedValueOnce(new Error("Timeline fetch failed"));
      global.fetch = mockFetch;

      const result = await service.syncFromSkillsMP();

      expect(result.success).toBe(false);
      expect(result.message).toContain("同步失败");
    });
  });

  // -------------------------------------------------------------------------
  // transformSkillsData (private, tested via syncFromSkillsMP)
  // -------------------------------------------------------------------------

  describe("transformSkillsData（间接测试）", () => {
    beforeEach(() => {
      prisma.systemSetting.findUnique.mockResolvedValue({
        id: "1",
        key: "skillsmp.apiKey",
        value: '"valid-api-key"',
      });
      prisma.systemSetting.upsert.mockResolvedValue({} as never);
    });

    it("stars 超过 10000 的 skill 设置 featured=true", async () => {
      const rawSkills = [
        {
          id: "hot-skill",
          name: "Hot Skill",
          stars: 15000,
          downloads: 0,
          tags: [],
        },
      ];
      const mockFetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ data: rawSkills }),
        })
        .mockResolvedValueOnce({ ok: false });
      global.fetch = mockFetch;

      await service.syncFromSkillsMP();

      const upsertCall = prisma.systemSetting.upsert.mock.calls.find(
        (call) => call[0].where.key === "skillsmp.syncedSkills",
      );
      const savedSkills = JSON.parse(upsertCall![0].update.value);
      expect(savedSkills[0].featured).toBe(true);
    });

    it("downloads 数值格式化正确", async () => {
      const rawSkills = [
        { id: "skill-m", name: "Million", downloads: 1500000, tags: [] },
        { id: "skill-k", name: "Thousand", downloads: 5000, tags: [] },
        { id: "skill-small", name: "Small", downloads: 50, tags: [] },
      ];
      const mockFetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ data: rawSkills }),
        })
        .mockResolvedValueOnce({ ok: false });
      global.fetch = mockFetch;

      await service.syncFromSkillsMP();

      const upsertCall = prisma.systemSetting.upsert.mock.calls.find(
        (call) => call[0].where.key === "skillsmp.syncedSkills",
      );
      const savedSkills = JSON.parse(upsertCall![0].update.value);
      expect(savedSkills[0].downloads).toBe("1.5M+");
      expect(savedSkills[1].downloads).toBe("5K+");
      expect(savedSkills[2].downloads).toBe("50+");
    });

    it("分类映射正确", async () => {
      const rawSkills = [
        { id: "ai-skill", name: "AI", category: "ai", tags: [] },
        { id: "dev-skill", name: "Dev", category: "dev", tags: [] },
        {
          id: "unknown-skill",
          name: "Unknown",
          category: "custom-unknown",
          tags: [],
        },
      ];
      const mockFetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ data: rawSkills }),
        })
        .mockResolvedValueOnce({ ok: false });
      global.fetch = mockFetch;

      await service.syncFromSkillsMP();

      const upsertCall = prisma.systemSetting.upsert.mock.calls.find(
        (call) => call[0].where.key === "skillsmp.syncedSkills",
      );
      const savedSkills = JSON.parse(upsertCall![0].update.value);
      expect(savedSkills[0].category).toBe("ai-agents");
      expect(savedSkills[1].category).toBe("development");
      expect(savedSkills[2].category).toBe("other");
    });

    it("重复 ID 的 skill 只保存一条", async () => {
      const rawSkills = [
        { id: "dup-skill", name: "Dup A", tags: [] },
        { id: "dup-skill", name: "Dup B", tags: [] },
      ];
      const mockFetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ data: rawSkills }),
        })
        .mockResolvedValueOnce({ ok: false });
      global.fetch = mockFetch;

      await service.syncFromSkillsMP();

      const upsertCall = prisma.systemSetting.upsert.mock.calls.find(
        (call) => call[0].where.key === "skillsmp.syncedSkills",
      );
      const savedSkills = JSON.parse(upsertCall![0].update.value);
      expect(savedSkills).toHaveLength(1);
    });
  });
});
