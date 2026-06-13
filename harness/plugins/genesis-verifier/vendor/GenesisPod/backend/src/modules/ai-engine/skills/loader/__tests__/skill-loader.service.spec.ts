/**
 * Unit tests for SkillLoaderService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import * as path from "path";
import { SkillCacheService } from "../caching/skill-cache.service";
import { SkillLoaderService } from "../loading/skill-loader.service";
import { SkillsMPClientService } from "../../marketplace/skillsmp-client.service";
import { SkillContentService } from "../../content/skill-content.service";
import { SkillMdDefinition } from "../../types/skill-md.types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock("glob", () => ({
  glob: jest.fn(),
}));

jest.mock("fs/promises", () => ({
  readFile: jest.fn(),
  realpath: jest.fn(),
  stat: jest.fn(),
}));

jest.mock("../parsing/skill-parser", () => ({
  parseSkillMd: jest.fn(),
  estimateTokens: jest.fn().mockReturnValue(100),
}));

import { glob } from "glob";
import * as fs from "fs/promises";
import { estimateTokens, parseSkillMd } from "../parsing/skill-parser";

const mockGlob = glob as jest.MockedFunction<typeof glob>;
const mockFs = fs as jest.Mocked<typeof fs>;
const mockParseSkillMd = parseSkillMd as jest.MockedFunction<
  typeof parseSkillMd
>;
const mockEstimateTokens = estimateTokens as jest.MockedFunction<
  typeof estimateTokens
>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSkillDefinition(
  id: string,
  domain: string = "writing",
  priority: number = 5,
  enabled: boolean = true,
  source: "local" | "skillsmp" | "custom-url" = "local",
): SkillMdDefinition {
  return {
    metadata: {
      id,
      name: id,
      description: `Skill ${id}`,
      version: "1.0.0",
      domain,
      taskTypes: ["chapter-writing"],
      priority,
      source,
      tags: [],
      enabled,
      userInvocable: true,
      disableModelInvocation: false,
    },
    content: `Content of ${id}`,
    loadedAt: new Date(),
    contentHash: "abc123",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SkillLoaderService", () => {
  let service: SkillLoaderService;
  let cacheService: jest.Mocked<SkillCacheService>;
  let skillsMPClient: jest.Mocked<SkillsMPClientService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    const mockCacheService: jest.Mocked<SkillCacheService> = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(true),
      clear: jest.fn().mockResolvedValue(undefined),
      has: jest.fn().mockReturnValue(false),
      getStats: jest
        .fn()
        .mockReturnValue({ size: 0, maxSize: 100, hitRate: 0, totalHits: 0 }),
      warmup: jest.fn().mockResolvedValue(0),
      configure: jest.fn(),
    } as unknown as jest.Mocked<SkillCacheService>;

    const mockSkillsMPClient: jest.Mocked<SkillsMPClientService> = {
      isEnabled: jest.fn().mockReturnValue(false),
      checkUpdates: jest.fn().mockResolvedValue([]),
      installSkill: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<SkillsMPClientService>;

    const mockSkillContentService = {
      syncFilesystemToDb: jest
        .fn()
        .mockResolvedValue({ synced: 0, skipped: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SkillLoaderService,
        { provide: SkillCacheService, useValue: mockCacheService },
        { provide: SkillsMPClientService, useValue: mockSkillsMPClient },
        { provide: SkillContentService, useValue: mockSkillContentService },
      ],
    })
      .setLogger(new Logger())
      .compile();

    service = module.get<SkillLoaderService>(SkillLoaderService);
    cacheService = module.get(SkillCacheService);
    skillsMPClient = module.get(SkillsMPClientService);

    // glob 默认行为：返回空数组
    mockGlob.mockResolvedValue([]);
    mockEstimateTokens.mockReturnValue(100);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // onModuleInit / onModuleDestroy
  // -------------------------------------------------------------------------

  describe("onModuleInit", () => {
    it("会调用本地 skill 加载、预热和更新检查", async () => {
      cacheService.warmup.mockResolvedValue(2);

      await service.onModuleInit();

      expect(cacheService.warmup).toHaveBeenCalled();
    });

    it("预热数量为 0 时也能正常完成", async () => {
      cacheService.warmup.mockResolvedValue(0);

      await expect(service.onModuleInit()).resolves.not.toThrow();
    });

    it("预热失败时不抛出错误", async () => {
      cacheService.warmup.mockRejectedValue(new Error("Warmup failed"));

      await expect(service.onModuleInit()).resolves.not.toThrow();
    });
  });

  describe("onModuleDestroy", () => {
    it("清除更新检查定时器", async () => {
      await service.onModuleInit();
      await service.onModuleDestroy();

      // 定时器已被清除（没有错误即可）
      expect(service).toBeDefined();
    });

    it("定时器不存在时也能正常退出", async () => {
      await expect(service.onModuleDestroy()).resolves.not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // loadAllLocalSkills
  // -------------------------------------------------------------------------

  describe("loadAllLocalSkills", () => {
    it("目录不存在时跳过", async () => {
      mockGlob.mockResolvedValue([]);

      await service.loadAllLocalSkills();

      expect(service.getAllLoadedSkills()).toHaveLength(0);
    });

    it("找到 SKILL.md 文件并解析", async () => {
      // R0-A5: 注入测试用 skill dir（替代原 hardcoded constructor 配置）
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).skillDirectories.push({
        path: "/path",
        domain: "writing",
        recursive: false,
      });
      const skill = makeSkillDefinition("chapter-writing");
      mockGlob.mockResolvedValue(["/path/to/chapter-writing.skill.md"]);
      mockFs.readFile.mockResolvedValue("content" as never);
      mockParseSkillMd.mockReturnValue(skill);

      await service.loadAllLocalSkills();

      expect(service.getAllLoadedSkills()).toHaveLength(1);
      expect(service.getAllLoadedSkills()[0].metadata.id).toBe(
        "chapter-writing",
      );
    });

    it("加载多个 skill 文件", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).skillDirectories.push(
        { path: "/path/a", domain: "writing", recursive: false },
        { path: "/path/b", domain: "research", recursive: false },
      );
      const skill1 = makeSkillDefinition("skill-1");
      const skill2 = makeSkillDefinition("skill-2");
      mockGlob
        .mockResolvedValueOnce(["/path/skill-1.skill.md"])
        .mockResolvedValueOnce(["/path/skill-2.skill.md"])
        .mockResolvedValue([]);
      mockFs.readFile.mockResolvedValue("content" as never);
      mockParseSkillMd.mockReturnValueOnce(skill1).mockReturnValueOnce(skill2);

      await service.loadAllLocalSkills();

      expect(service.getAllLoadedSkills()).toHaveLength(2);
    });

    it("文件解析失败时跳过并输出日志", async () => {
      mockGlob.mockResolvedValue(["/path/broken.skill.md"]);
      mockFs.readFile.mockResolvedValue("invalid" as never);
      mockParseSkillMd.mockImplementation(() => {
        throw new Error("Parse error");
      });

      await expect(service.loadAllLocalSkills()).resolves.not.toThrow();
      expect(service.getAllLoadedSkills()).toHaveLength(0);
    });

    it("ENOENT 错误时只输出 debug 日志", async () => {
      mockGlob.mockRejectedValue(
        Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
      );

      await expect(service.loadAllLocalSkills()).resolves.not.toThrow();
    });

    it("domain 不匹配时输出警告日志", async () => {
      const skill = makeSkillDefinition("wrong-domain-skill", "research"); // office 目录但 domain 为 research
      mockGlob.mockResolvedValue(["/path/office/wrong.skill.md"]);
      mockFs.readFile.mockResolvedValue("content" as never);
      mockParseSkillMd.mockReturnValue(skill);

      // 只输出警告，不报错
      await expect(service.loadAllLocalSkills()).resolves.not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // loadLocalSkills
  // -------------------------------------------------------------------------

  describe("loadLocalSkills", () => {
    it("只返回指定 domain 的 skill", async () => {
      const writingSkill = makeSkillDefinition("writing-skill", "writing");
      const officeSkill = makeSkillDefinition("office-skill", "office");

      service.registerSkill(writingSkill);
      service.registerSkill(officeSkill);

      const result = await service.loadLocalSkills("writing");

      expect(result).toHaveLength(1);
      expect(result[0].metadata.id).toBe("writing-skill");
    });

    it("不返回已禁用的 skill", async () => {
      const enabledSkill = makeSkillDefinition(
        "enabled-skill",
        "writing",
        5,
        true,
      );
      const disabledSkill = makeSkillDefinition(
        "disabled-skill",
        "writing",
        5,
        false,
      );

      service.registerSkill(enabledSkill);
      service.registerSkill(disabledSkill);

      const result = await service.loadLocalSkills("writing");

      expect(result).toHaveLength(1);
      expect(result[0].metadata.id).toBe("enabled-skill");
    });

    it("按优先级从高到低排序", async () => {
      const lowPrioritySkill = makeSkillDefinition(
        "low-priority",
        "writing",
        1,
      );
      const highPrioritySkill = makeSkillDefinition(
        "high-priority",
        "writing",
        10,
      );

      service.registerSkill(lowPrioritySkill);
      service.registerSkill(highPrioritySkill);

      const result = await service.loadLocalSkills("writing");

      expect(result[0].metadata.id).toBe("high-priority");
      expect(result[1].metadata.id).toBe("low-priority");
    });

    it("没有匹配 skill 时返回空数组", async () => {
      const result = await service.loadLocalSkills("writing");

      expect(result).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // getSkillById
  // -------------------------------------------------------------------------

  describe("getSkillById", () => {
    it("从本地缓存获取 skill", async () => {
      const skill = makeSkillDefinition("local-skill");
      service.registerSkill(skill);

      const result = await service.getSkillById("local-skill");

      expect(result).toEqual(skill);
    });

    it("本地没有时从持久化缓存获取", async () => {
      const skill = makeSkillDefinition("cached-skill");
      cacheService.get.mockResolvedValue(skill);

      const result = await service.getSkillById("cached-skill");

      expect(result).toEqual(skill);
      expect(cacheService.get).toHaveBeenCalledWith("cached-skill");
    });

    it("两者都没有时返回 null", async () => {
      cacheService.get.mockResolvedValue(null);

      const result = await service.getSkillById("nonexistent");

      expect(result).toBeNull();
    });

    it("本地缓存优先", async () => {
      const localSkill = makeSkillDefinition("priority-skill");
      const cacheSkill = makeSkillDefinition("priority-skill");
      cacheSkill.content = "different content";

      service.registerSkill(localSkill);
      cacheService.get.mockResolvedValue(cacheSkill);

      const result = await service.getSkillById("priority-skill");

      expect(result?.content).toBe("Content of priority-skill");
      expect(cacheService.get).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // getSkillsForTask
  // -------------------------------------------------------------------------

  describe("getSkillsForTask (description-based matching)", () => {
    it("query 匹配 description 中的关键词时返回 skill", async () => {
      const skill = makeSkillDefinition("writing-skill", "writing");
      service.registerSkill(skill);

      const result = await service.getSkillsForTask({
        query: "writing skill",
        domain: "writing",
      });

      expect(result).toHaveLength(1);
      expect(result[0].metadata.id).toBe("writing-skill");
    });

    it("query 不匹配任何 skill 时返回空", async () => {
      const skill = makeSkillDefinition("specific-skill", "writing");
      service.registerSkill(skill);

      const result = await service.getSkillsForTask({
        query: "zzzzunmatchable",
        domain: "writing",
      });

      expect(result).toHaveLength(0);
    });

    it("无 query 但有 domain 时返回该 domain 全部 skill (wildcard)", async () => {
      const skill = makeSkillDefinition("wildcard-skill", "writing");
      service.registerSkill(skill);

      const result = await service.getSkillsForTask({
        domain: "writing",
      });

      expect(result).toHaveLength(1);
    });

    it("超出 maxTokenBudget 的 skill 被跳过", async () => {
      mockEstimateTokens.mockReturnValue(500);
      const skill1 = makeSkillDefinition("budget-skill-1", "writing");
      const skill2 = makeSkillDefinition("budget-skill-2", "writing");
      service.registerSkill(skill1);
      service.registerSkill(skill2);

      const result = await service.getSkillsForTask({
        domain: "writing",
        maxTokenBudget: 600,
      });

      expect(result).toHaveLength(1);
    });

    it("设置了 tokenBudget 时使用该值", async () => {
      const skill = {
        ...makeSkillDefinition("budgeted-skill", "writing"),
        metadata: {
          ...makeSkillDefinition("budgeted-skill", "writing").metadata,
          tokenBudget: 100,
        },
      };
      service.registerSkill(skill);

      const result = await service.getSkillsForTask({
        domain: "writing",
        maxTokenBudget: 200,
      });

      expect(result).toHaveLength(1);
      expect(mockEstimateTokens).not.toHaveBeenCalled();
    });

    it("可以通过 additionalSkillIds 指定额外的 skill", async () => {
      const additionalSkill = makeSkillDefinition(
        "additional-skill",
        "research",
      );
      service.registerSkill(additionalSkill);

      const result = await service.getSkillsForTask({
        domain: "writing",
        additionalSkillIds: ["additional-skill"],
      });

      expect(result.some((s) => s.metadata.id === "additional-skill")).toBe(
        true,
      );
    });

    it("additionalSkillIds 中已存在的 skill 不会重复添加", async () => {
      const skill = makeSkillDefinition("dedup-skill", "writing");
      service.registerSkill(skill);

      const result = await service.getSkillsForTask({
        domain: "writing",
        additionalSkillIds: ["dedup-skill"],
      });

      const dedupCount = result.filter(
        (s) => s.metadata.id === "dedup-skill",
      ).length;
      expect(dedupCount).toBe(1);
    });

    it("不存在的 additionalSkillId 只输出警告日志", async () => {
      const result = await service.getSkillsForTask({
        domain: "writing",
        additionalSkillIds: ["nonexistent-skill"],
      });

      expect(result).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // reloadSkills
  // -------------------------------------------------------------------------

  describe("reloadSkills", () => {
    it("清除现有 skill 并重新加载", async () => {
      const skill = makeSkillDefinition("reload-skill");
      service.registerSkill(skill);

      mockGlob.mockResolvedValue([]);

      await service.reloadSkills();

      expect(service.getAllLoadedSkills()).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // getAllLoadedSkills
  // -------------------------------------------------------------------------

  describe("getAllLoadedSkills", () => {
    it("返回全部已注册的 skill", () => {
      const skill1 = makeSkillDefinition("all-skill-1");
      const skill2 = makeSkillDefinition("all-skill-2");

      service.registerSkill(skill1);
      service.registerSkill(skill2);

      expect(service.getAllLoadedSkills()).toHaveLength(2);
    });

    it("skill 数量为 0 时返回空数组", () => {
      expect(service.getAllLoadedSkills()).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // getStats
  // -------------------------------------------------------------------------

  describe("getStats", () => {
    it("返回 skill 统计信息", () => {
      const writingSkill = makeSkillDefinition("writing-skill", "writing");
      const officeSkill = makeSkillDefinition("office-skill", "office");

      service.registerSkill(writingSkill);
      service.registerSkill(officeSkill);

      const stats = service.getStats();

      expect(stats.totalSkills).toBe(2);
      expect(stats.byDomain["writing"]).toBe(1);
      expect(stats.byDomain["office"]).toBe(1);
    });

    it("skill 数量为 0 时返回空统计", () => {
      const stats = service.getStats();

      expect(stats.totalSkills).toBe(0);
      expect(stats.byDomain).toEqual({});
      expect(stats.totalTokenBudget).toBe(0);
    });

    it("设置了 tokenBudget 的 skill 合计正确", () => {
      const skill1 = {
        ...makeSkillDefinition("budget-1"),
        metadata: {
          ...makeSkillDefinition("budget-1").metadata,
          tokenBudget: 200,
        },
      };
      const skill2 = {
        ...makeSkillDefinition("budget-2"),
        metadata: {
          ...makeSkillDefinition("budget-2").metadata,
          tokenBudget: 300,
        },
      };
      service.registerSkill(skill1);
      service.registerSkill(skill2);

      const stats = service.getStats();

      expect(stats.totalTokenBudget).toBe(500);
    });
  });

  // -------------------------------------------------------------------------
  // registerSkill / unregisterSkill
  // -------------------------------------------------------------------------

  describe("registerSkill", () => {
    it("可以手动注册 skill", () => {
      const skill = makeSkillDefinition("manual-skill");
      service.registerSkill(skill);

      expect(service.getAllLoadedSkills()).toHaveLength(1);
    });
  });

  describe("unregisterSkill", () => {
    it("可以注销 skill", () => {
      const skill = makeSkillDefinition("unregister-skill");
      service.registerSkill(skill);

      const result = service.unregisterSkill("unregister-skill");

      expect(result).toBe(true);
      expect(service.getAllLoadedSkills()).toHaveLength(0);
    });

    it("注销不存在的 skill 返回 false", () => {
      const result = service.unregisterSkill("nonexistent");

      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // addSkillDirectory (security checks)
  // -------------------------------------------------------------------------

  describe("addSkillDirectory", () => {
    it("拒绝包含路径遍历模式的路径", async () => {
      await expect(
        service.addSkillDirectory({
          path: "/safe/../../../etc/passwd",
          domain: "writing",
        }),
      ).rejects.toThrow(
        "Invalid skill directory path: contains suspicious patterns",
      );
    });

    it("拒绝包含非法字符的路径", async () => {
      await expect(
        service.addSkillDirectory({
          path: "/path/with/|pipe",
          domain: "writing",
        }),
      ).rejects.toThrow("Invalid skill directory path");
    });

    it("拒绝不存在的路径", async () => {
      mockFs.realpath.mockRejectedValue(
        Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
      );

      await expect(
        service.addSkillDirectory({
          path: "/nonexistent/path",
          domain: "writing",
        }),
      ).rejects.toThrow("does not exist or is not accessible");
    });

    it("拒绝非目录路径", async () => {
      mockFs.realpath.mockResolvedValue("/some/file.txt");
      mockFs.stat.mockResolvedValue({
        isDirectory: () => false,
      } as unknown as ReturnType<typeof fs.stat> extends Promise<infer T>
        ? T
        : never);

      await expect(
        service.addSkillDirectory({
          path: "/some/file.txt",
          domain: "writing",
        }),
      ).rejects.toThrow("must be a directory");
    });

    it("stat 访问失败（非 isDirectory 错误）时抛出 Cannot access", async () => {
      mockFs.realpath.mockResolvedValue("/valid/dir");
      mockFs.stat.mockRejectedValue(new Error("Permission denied"));

      await expect(
        service.addSkillDirectory({
          path: "/valid/dir",
          domain: "writing",
        }),
      ).rejects.toThrow("Cannot access skill directory");
    });

    it("白名单外的路径应被拒绝", async () => {
      mockFs.realpath
        .mockResolvedValueOnce("/evil/path") // resolvedPath realpath
        .mockResolvedValueOnce("/app/ai-app") // baseSkillsDir
        .mockResolvedValueOnce("/app"); // projectRoot

      mockFs.stat.mockResolvedValue({
        isDirectory: () => true,
      } as unknown as ReturnType<typeof fs.stat> extends Promise<infer T>
        ? T
        : never);

      await expect(
        service.addSkillDirectory({
          path: "/evil/path",
          domain: "writing",
        }),
      ).rejects.toThrow("must be within allowed paths");
    });

    it("路径在 baseSkillsDir 下时成功添加", async () => {
      // Use path.join so the separator matches the OS (/ on Unix, \ on Windows)
      const basePath = path.join("app", "src", "modules", "ai-app");
      const childPath = path.join(basePath, "custom-skills");

      mockFs.realpath
        .mockResolvedValueOnce(childPath) // resolved path
        .mockResolvedValueOnce(basePath) // baseSkillsDir
        .mockResolvedValueOnce(path.join("app", "src")); // projectRoot

      mockFs.stat.mockResolvedValue({
        isDirectory: () => true,
      } as unknown as ReturnType<typeof fs.stat> extends Promise<infer T>
        ? T
        : never);

      await expect(
        service.addSkillDirectory({
          path: childPath,
          domain: "writing",
        }),
      ).resolves.not.toThrow();
    });

    it("路径恰好等于 baseSkillsDir 时成功添加", async () => {
      const basePath = path.join("app", "src", "modules", "ai-app");

      mockFs.realpath
        .mockResolvedValueOnce(basePath) // resolved path
        .mockResolvedValueOnce(basePath) // baseSkillsDir
        .mockResolvedValueOnce(path.join("app")); // projectRoot

      mockFs.stat.mockResolvedValue({
        isDirectory: () => true,
      } as unknown as ReturnType<typeof fs.stat> extends Promise<infer T>
        ? T
        : never);

      await expect(
        service.addSkillDirectory({
          path: basePath,
          domain: "writing",
        }),
      ).resolves.not.toThrow();
    });

    it("路径在 projectRoot 下（但不在 baseSkillsDir 下）时成功添加", async () => {
      const projectRoot = path.join("app", "src");
      const childOfRoot = path.join(projectRoot, "other-module", "skills");

      mockFs.realpath
        .mockResolvedValueOnce(childOfRoot) // resolved path
        .mockResolvedValueOnce(path.join("app", "ai-app")) // baseSkillsDir (different)
        .mockResolvedValueOnce(projectRoot); // projectRoot

      mockFs.stat.mockResolvedValue({
        isDirectory: () => true,
      } as unknown as ReturnType<typeof fs.stat> extends Promise<infer T>
        ? T
        : never);

      await expect(
        service.addSkillDirectory({
          path: childOfRoot,
          domain: "writing",
        }),
      ).resolves.not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // checkAndUpdateSkills (via timer advancement)
  // -------------------------------------------------------------------------

  describe("checkAndUpdateSkills", () => {
    it("SkillsMP 未启用时跳过更新", async () => {
      skillsMPClient.isEnabled.mockReturnValue(false);

      const mpSkill = makeSkillDefinition(
        "mp-skill",
        "writing",
        5,
        true,
        "skillsmp",
      );
      service.registerSkill(mpSkill);
      cacheService.getStats.mockReturnValue({
        size: 1,
        maxSize: 100,
        hitRate: 0,
        totalHits: 0,
      });

      await service.onModuleInit();

      jest.advanceTimersByTime(30001);
      await Promise.resolve();

      expect(skillsMPClient.checkUpdates).not.toHaveBeenCalled();
    });

    it("没有已安装 Marketplace Skills 时跳过", async () => {
      skillsMPClient.isEnabled.mockReturnValue(true);
      cacheService.getStats.mockReturnValue({
        size: 0,
        maxSize: 100,
        hitRate: 0,
        totalHits: 0,
      });

      await service.onModuleInit();

      jest.advanceTimersByTime(30001);
      await Promise.resolve();

      expect(skillsMPClient.checkUpdates).not.toHaveBeenCalled();
    });

    it("发现可更新 Skills 时执行安装", async () => {
      skillsMPClient.isEnabled.mockReturnValue(true);

      const mpSkill = makeSkillDefinition(
        "mp-v1",
        "writing",
        5,
        true,
        "skillsmp",
      );
      service.registerSkill(mpSkill);
      cacheService.getStats.mockReturnValue({
        size: 1,
        maxSize: 100,
        hitRate: 0,
        totalHits: 0,
      });

      skillsMPClient.checkUpdates.mockResolvedValue([
        {
          skillId: "mp-v1",
          currentVersion: "1.0.0",
          latestVersion: "1.1.0",
          hasUpdate: true,
        },
      ]);
      skillsMPClient.installSkill.mockResolvedValue(true);

      await service.onModuleInit();

      jest.advanceTimersByTime(30001);
      await Promise.resolve();
      await Promise.resolve();

      expect(skillsMPClient.checkUpdates).toHaveBeenCalled();
    });

    it("installSkill 返回 false 时记录失败", async () => {
      skillsMPClient.isEnabled.mockReturnValue(true);

      const mpSkill = makeSkillDefinition(
        "fail-skill",
        "writing",
        5,
        true,
        "skillsmp",
      );
      service.registerSkill(mpSkill);
      cacheService.getStats.mockReturnValue({
        size: 1,
        maxSize: 100,
        hitRate: 0,
        totalHits: 0,
      });

      skillsMPClient.checkUpdates.mockResolvedValue([
        {
          skillId: "fail-skill",
          currentVersion: "1.0.0",
          latestVersion: "2.0.0",
          hasUpdate: true,
        },
      ]);
      skillsMPClient.installSkill.mockResolvedValue(false);

      await service.onModuleInit();

      jest.advanceTimersByTime(30001);
      await Promise.resolve();
      await Promise.resolve();

      expect(skillsMPClient.installSkill).toHaveBeenCalledWith("fail-skill");
    });

    it("installSkill 抛出异常时不影响其他更新", async () => {
      skillsMPClient.isEnabled.mockReturnValue(true);

      const skill1 = makeSkillDefinition(
        "err-skill",
        "writing",
        5,
        true,
        "skillsmp",
      );
      const skill2 = makeSkillDefinition(
        "ok-skill",
        "writing",
        5,
        true,
        "skillsmp",
      );
      service.registerSkill(skill1);
      service.registerSkill(skill2);
      cacheService.getStats.mockReturnValue({
        size: 2,
        maxSize: 100,
        hitRate: 0,
        totalHits: 0,
      });

      skillsMPClient.checkUpdates.mockResolvedValue([
        {
          skillId: "err-skill",
          currentVersion: "1.0.0",
          latestVersion: "2.0.0",
          hasUpdate: true,
        },
        {
          skillId: "ok-skill",
          currentVersion: "1.0.0",
          latestVersion: "1.1.0",
          hasUpdate: true,
        },
      ]);
      skillsMPClient.installSkill
        .mockRejectedValueOnce(new Error("Network failure"))
        .mockResolvedValueOnce(true);

      await service.onModuleInit();

      jest.advanceTimersByTime(30001);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(skillsMPClient.installSkill).toHaveBeenCalledTimes(2);
    });

    it("checkUpdates 抛出异常时不影响服务", async () => {
      skillsMPClient.isEnabled.mockReturnValue(true);

      const mpSkill = makeSkillDefinition(
        "any-skill",
        "writing",
        5,
        true,
        "skillsmp",
      );
      service.registerSkill(mpSkill);
      cacheService.getStats.mockReturnValue({
        size: 1,
        maxSize: 100,
        hitRate: 0,
        totalHits: 0,
      });

      skillsMPClient.checkUpdates.mockRejectedValue(new Error("API down"));

      await service.onModuleInit();

      jest.advanceTimersByTime(30001);
      await Promise.resolve();
      await Promise.resolve();

      // Service still works
      expect(service.getAllLoadedSkills().length).toBeGreaterThanOrEqual(1);
    });

    it("没有可用更新时输出 up-to-date 日志", async () => {
      skillsMPClient.isEnabled.mockReturnValue(true);

      const mpSkill = makeSkillDefinition(
        "current-skill",
        "writing",
        5,
        true,
        "skillsmp",
      );
      service.registerSkill(mpSkill);
      cacheService.getStats.mockReturnValue({
        size: 1,
        maxSize: 100,
        hitRate: 0,
        totalHits: 0,
      });

      skillsMPClient.checkUpdates.mockResolvedValue([]); // empty = up to date

      await service.onModuleInit();

      jest.advanceTimersByTime(30001);
      await Promise.resolve();
      await Promise.resolve();

      expect(skillsMPClient.checkUpdates).toHaveBeenCalled();
      expect(skillsMPClient.installSkill).not.toHaveBeenCalled();
    });

    it("source=local 的 skill 不计入已安装的 Marketplace Skills", async () => {
      skillsMPClient.isEnabled.mockReturnValue(true);

      const localSkill = makeSkillDefinition(
        "local-only",
        "writing",
        5,
        true,
        "local",
      );
      service.registerSkill(localSkill);
      cacheService.getStats.mockReturnValue({
        size: 1,
        maxSize: 100,
        hitRate: 0,
        totalHits: 0,
      });

      skillsMPClient.checkUpdates.mockResolvedValue([]);

      await service.onModuleInit();

      jest.advanceTimersByTime(30001);
      await Promise.resolve();
      await Promise.resolve();

      // checkUpdates should not be called (no marketplace skills)
      expect(skillsMPClient.checkUpdates).not.toHaveBeenCalled();
    });

    it("定期检查定时器在 onModuleDestroy 后不再触发", async () => {
      skillsMPClient.isEnabled.mockReturnValue(false);

      await service.onModuleInit();
      await service.onModuleDestroy();

      // After destroy, advancing timer should not trigger any calls
      jest.advanceTimersByTime(6 * 60 * 60 * 1000 + 1);
      await Promise.resolve();

      expect(skillsMPClient.checkUpdates).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // getSkillsForTask — additionalSkillIds token budget
  // -------------------------------------------------------------------------

  describe("getSkillsForTask — additionalSkillIds token budget", () => {
    it("additionalSkillId 优先于 domain skill，domain skill 超出预算时被跳过", async () => {
      mockEstimateTokens.mockReturnValue(400);

      const domainSkill = makeSkillDefinition("domain-skill", "writing");
      const additionalSkill = makeSkillDefinition("extra-skill", "research");

      service.registerSkill(domainSkill);
      service.registerSkill(additionalSkill);

      // Budget 500: additionalSkill gets priority (400), domain would need 400 more → domain skipped
      const result = await service.getSkillsForTask({
        domain: "writing",
        additionalSkillIds: ["extra-skill"],
        maxTokenBudget: 500,
      });

      // additionalSkills are prioritized over auto-matched domain skills
      expect(result.some((s) => s.metadata.id === "extra-skill")).toBe(true);
      expect(result.some((s) => s.metadata.id === "domain-skill")).toBe(false);
    });

    it("additionalSkillId 在预算内时被包含", async () => {
      mockEstimateTokens.mockReturnValue(100);

      const domainSkill = makeSkillDefinition("small-domain", "writing");
      const additionalSkill = makeSkillDefinition("small-extra", "research");

      service.registerSkill(domainSkill);
      service.registerSkill(additionalSkill);

      const result = await service.getSkillsForTask({
        domain: "writing",
        additionalSkillIds: ["small-extra"],
        maxTokenBudget: 500,
      });

      expect(result.some((s) => s.metadata.id === "small-extra")).toBe(true);
    });

    it("无 maxTokenBudget 时 additionalSkillId 总是被包含", async () => {
      const domainSkill = makeSkillDefinition("domain", "writing");
      const additionalSkill = makeSkillDefinition(
        "extra-no-budget",
        "research",
      );

      service.registerSkill(domainSkill);
      service.registerSkill(additionalSkill);

      const result = await service.getSkillsForTask({
        domain: "writing",
        additionalSkillIds: ["extra-no-budget"],
      });

      expect(result.some((s) => s.metadata.id === "extra-no-budget")).toBe(
        true,
      );
    });
  });
});
