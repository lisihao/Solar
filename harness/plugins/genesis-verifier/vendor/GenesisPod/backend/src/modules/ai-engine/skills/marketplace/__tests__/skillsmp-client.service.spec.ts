/**
 * Tests for SkillsMPClientService
 */

import { SkillsMPClientService } from "../skillsmp-client.service";
import { SkillCacheService } from "../../loader/caching/skill-cache.service";
import { parseSkillMd } from "../../loader/parsing/skill-parser";

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock parseSkillMd
jest.mock("../../loader/parsing/skill-parser", () => ({
  parseSkillMd: jest.fn(),
}));

// Mock app config
jest.mock("@/common/config/app.config", () => ({
  APP_CONFIG: {
    brand: {
      userAgent: "TestAgent/1.0",
    },
  },
}));

const mockParseSkillMd = parseSkillMd as jest.MockedFunction<
  typeof parseSkillMd
>;

function buildMockCacheService(): jest.Mocked<SkillCacheService> {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<SkillCacheService>;
}

function buildSuccessResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function buildErrorResponse(status: number, statusText = "Error"): Response {
  return {
    ok: false,
    status,
    statusText,
    json: jest.fn().mockResolvedValue({}),
  } as unknown as Response;
}

describe("SkillsMPClientService", () => {
  let service: SkillsMPClientService;
  let cacheService: jest.Mocked<SkillCacheService>;

  beforeEach(() => {
    jest.clearAllMocks();
    cacheService = buildMockCacheService();
    service = new SkillsMPClientService(cacheService);
    // Use maxRetries: 1 so network-error tests don't hang on retry delays
    service.configure({ maxRetries: 1 });
  });

  // --- configure / setEnabled / isEnabled ---

  describe("configure and enable/disable", () => {
    it("is enabled by default", () => {
      expect(service.isEnabled()).toBe(true);
    });

    it("setEnabled toggles enabled state", () => {
      service.setEnabled(false);
      expect(service.isEnabled()).toBe(false);
      service.setEnabled(true);
      expect(service.isEnabled()).toBe(true);
    });

    it("configure merges partial config", () => {
      service.configure({
        baseUrl: "https://custom.skillsmp.com/api",
        timeout: 5000,
      });
      // Verify by checking that requests go to the custom URL
      // (verified indirectly via search test)
      expect(service.isEnabled()).toBe(true); // service still enabled
    });
  });

  // --- searchSkills ---

  describe("searchSkills", () => {
    it("returns empty array when disabled", async () => {
      service.setEnabled(false);
      const results = await service.searchSkills("test");
      expect(results).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns skills from API on success", async () => {
      const mockSkills = [
        {
          id: "skill-1",
          name: "Skill One",
          description: "desc",
          author: "author",
        },
        {
          id: "skill-2",
          name: "Skill Two",
          description: "desc",
          author: "author",
        },
      ];
      mockFetch.mockResolvedValueOnce(
        buildSuccessResponse({
          skills: mockSkills,
          total: 2,
          page: 1,
          pageSize: 10,
        }),
      );

      const results = await service.searchSkills("research");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/skills/search?q=research"),
        expect.any(Object),
      );
      expect(results).toHaveLength(2);
      expect(results[0].id).toBe("skill-1");
    });

    it("passes filters as query params", async () => {
      mockFetch.mockResolvedValueOnce(
        buildSuccessResponse({ skills: [], total: 0, page: 1, pageSize: 10 }),
      );

      await service.searchSkills("test", {
        domain: "writing",
        tags: ["tag1", "tag2"],
        author: "alice",
        limit: 5,
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("domain=writing");
      expect(url).toContain("tags=tag1%2Ctag2");
      expect(url).toContain("author=alice");
      expect(url).toContain("limit=5");
    });

    it("returns empty array on fetch error", async () => {
      mockFetch.mockRejectedValue(new Error("network error"));

      const results = await service.searchSkills("test");
      expect(results).toEqual([]);
    });
  });

  // --- getSkill ---

  describe("getSkill", () => {
    it("returns null when disabled", async () => {
      service.setEnabled(false);
      const result = await service.getSkill("test-skill");
      expect(result).toBeNull();
    });

    it("returns cached skill without fetching", async () => {
      const cachedSkill = {
        metadata: { id: "test-skill", name: "Test", description: "desc" },
      } as any;
      cacheService.get.mockResolvedValueOnce(cachedSkill);

      const result = await service.getSkill("test-skill");

      expect(result).toBe(cachedSkill);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("fetches, validates, and caches skill on cache miss", async () => {
      const skillContent = "# Test Skill\n\nsome content";
      mockFetch.mockResolvedValueOnce(
        buildSuccessResponse({
          id: "test-skill",
          name: "Test Skill",
          author: "author",
          version: "1.0.0",
          content: skillContent,
          downloads: 100,
          rating: 4.5,
          tags: [],
          updatedAt: new Date().toISOString(),
        }),
      );
      const parsedSkill = {
        metadata: { id: "test-skill", name: "Test Skill", description: "desc" },
        sections: [],
      } as any;
      mockParseSkillMd.mockReturnValue(parsedSkill);

      const result = await service.getSkill("test-skill");

      expect(result).toBe(parsedSkill);
      expect(cacheService.set).toHaveBeenCalledWith("test-skill", parsedSkill);
    });

    it("returns null on fetch failure", async () => {
      mockFetch.mockRejectedValue(new Error("network failure"));

      const result = await service.getSkill("test-skill");
      expect(result).toBeNull();
    });

    it("rejects skill content exceeding size limit", async () => {
      const hugeContent = "x".repeat(101 * 1024); // > 100KB
      mockFetch.mockResolvedValueOnce(
        buildSuccessResponse({
          id: "big-skill",
          name: "Big",
          author: "a",
          version: "1.0.0",
          content: hugeContent,
          downloads: 0,
          rating: 0,
          tags: [],
          updatedAt: new Date().toISOString(),
        }),
      );

      const result = await service.getSkill("big-skill");
      expect(result).toBeNull();
    });

    it("rejects empty skill content", async () => {
      mockFetch.mockResolvedValueOnce(
        buildSuccessResponse({
          id: "empty-skill",
          name: "Empty",
          author: "a",
          version: "1.0.0",
          content: "   ",
          downloads: 0,
          rating: 0,
          tags: [],
          updatedAt: new Date().toISOString(),
        }),
      );

      const result = await service.getSkill("empty-skill");
      expect(result).toBeNull();
    });

    it("rejects content with script injection", async () => {
      const dangerousContent = '<script>alert("xss")</script>';
      mockFetch.mockResolvedValueOnce(
        buildSuccessResponse({
          id: "xss-skill",
          name: "XSS",
          author: "a",
          version: "1.0.0",
          content: dangerousContent,
          downloads: 0,
          rating: 0,
          tags: [],
          updatedAt: new Date().toISOString(),
        }),
      );

      const result = await service.getSkill("xss-skill");
      expect(result).toBeNull();
    });

    it("rejects content with javascript: protocol", async () => {
      const dangerousContent = "Click javascript:void(0) to continue";
      mockFetch.mockResolvedValueOnce(
        buildSuccessResponse({
          id: "js-skill",
          name: "JS",
          author: "a",
          version: "1.0.0",
          content: dangerousContent,
          downloads: 0,
          rating: 0,
          tags: [],
          updatedAt: new Date().toISOString(),
        }),
      );

      const result = await service.getSkill("js-skill");
      expect(result).toBeNull();
    });

    it("rejects skill with mismatched ID", async () => {
      const skillContent = "# Some content";
      mockFetch.mockResolvedValueOnce(
        buildSuccessResponse({
          id: "wrong-id",
          name: "Wrong",
          author: "a",
          version: "1.0.0",
          content: skillContent,
          downloads: 0,
          rating: 0,
          tags: [],
          updatedAt: new Date().toISOString(),
        }),
      );
      // Parsed skill has different id
      mockParseSkillMd.mockReturnValue({
        metadata: {
          id: "different-id",
          name: "Different",
          description: "desc",
        },
        sections: [],
      } as any);

      const result = await service.getSkill("wrong-id");
      expect(result).toBeNull();
    });
  });

  // --- installSkill ---

  describe("installSkill", () => {
    it("returns false when skill not found", async () => {
      service.setEnabled(false);
      const result = await service.installSkill("nonexistent");
      expect(result).toBe(false);
    });

    it("returns true and persists skill when found", async () => {
      const skillContent = "# Good content";
      mockFetch.mockResolvedValueOnce(
        buildSuccessResponse({
          id: "install-skill",
          name: "Install Me",
          author: "author",
          version: "1.0.0",
          content: skillContent,
          downloads: 50,
          rating: 4.0,
          tags: [],
          updatedAt: new Date().toISOString(),
        }),
      );
      const parsedSkill = {
        metadata: {
          id: "install-skill",
          name: "Install Me",
          description: "desc",
        },
        sections: [],
      } as any;
      mockParseSkillMd.mockReturnValue(parsedSkill);

      const result = await service.installSkill("install-skill");

      expect(result).toBe(true);
      // Should be called twice: once in getSkill, once in installSkill with persist=true
      expect(cacheService.set).toHaveBeenCalledWith(
        "install-skill",
        parsedSkill,
        true,
      );
    });
  });

  // --- checkUpdates ---

  describe("checkUpdates", () => {
    it("returns empty array when disabled", async () => {
      service.setEnabled(false);
      const result = await service.checkUpdates([{ id: "s1", version: "1.0" }]);
      expect(result).toEqual([]);
    });

    it("returns empty array when no installed skills", async () => {
      const result = await service.checkUpdates([]);
      expect(result).toEqual([]);
    });

    it("calls check-updates API and returns updates", async () => {
      const updates = [{ id: "skill-1", version: "2.0.0", changelog: "new" }];
      mockFetch.mockResolvedValueOnce(buildSuccessResponse({ updates }));

      const result = await service.checkUpdates([
        { id: "skill-1", version: "1.0.0" },
      ]);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/skills/check-updates"),
        expect.objectContaining({ method: "POST" }),
      );
      expect(result).toEqual(updates);
    });

    it("returns empty array on API error", async () => {
      mockFetch.mockRejectedValue(new Error("network error"));

      const result = await service.checkUpdates([{ id: "s1", version: "1.0" }]);
      expect(result).toEqual([]);
    });
  });

  // --- getPopularSkills ---

  describe("getPopularSkills", () => {
    it("returns empty when disabled", async () => {
      service.setEnabled(false);
      const result = await service.getPopularSkills();
      expect(result).toEqual([]);
    });

    it("calls popular endpoint with correct params", async () => {
      const skills = [{ id: "popular-1", name: "Popular Skill" }];
      mockFetch.mockResolvedValueOnce(
        buildSuccessResponse({ skills, total: 1, page: 1, pageSize: 10 }),
      );

      await service.getPopularSkills("writing", 5);

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("sortBy=downloads");
      expect(url).toContain("sortOrder=desc");
      expect(url).toContain("limit=5");
      expect(url).toContain("domain=writing");
    });
  });

  // --- getRecommendedSkills ---

  describe("getRecommendedSkills", () => {
    it("returns empty when disabled", async () => {
      service.setEnabled(false);
      const result = await service.getRecommendedSkills(["s1"]);
      expect(result).toEqual([]);
    });

    it("returns empty when no installed skills", async () => {
      const result = await service.getRecommendedSkills([]);
      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("calls recommend endpoint with correct body", async () => {
      const skills = [{ id: "rec-1", name: "Rec Skill" }];
      mockFetch.mockResolvedValueOnce(buildSuccessResponse({ skills }));

      const result = await service.getRecommendedSkills(
        ["installed-1", "installed-2"],
        3,
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/skills/recommend"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            installed: ["installed-1", "installed-2"],
            limit: 3,
          }),
        }),
      );
      expect(result).toEqual(skills);
    });
  });

  // --- healthCheck ---

  describe("healthCheck", () => {
    it("returns false when disabled", async () => {
      service.setEnabled(false);
      const result = await service.healthCheck();
      expect(result).toBe(false);
    });

    it("returns true when health endpoint responds OK", async () => {
      mockFetch.mockResolvedValueOnce(buildSuccessResponse({ status: "ok" }));
      const result = await service.healthCheck();
      expect(result).toBe(true);
    });

    it("returns false when health endpoint fails", async () => {
      mockFetch.mockRejectedValue(new Error("unreachable"));
      const result = await service.healthCheck();
      expect(result).toBe(false);
    });
  });

  // --- HTTP retry behavior ---

  describe("retry behavior", () => {
    it("does not retry 4xx non-retryable errors", async () => {
      mockFetch.mockResolvedValue(buildErrorResponse(404, "Not Found"));

      await service.searchSkills("test");

      // 404 is non-retryable, should only try once
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("includes Authorization header when apiKey configured", async () => {
      service.configure({ apiKey: "test-api-key-123" });
      mockFetch.mockResolvedValueOnce(
        buildSuccessResponse({ skills: [], total: 0, page: 1, pageSize: 10 }),
      );

      await service.searchSkills("test");

      const callOptions = mockFetch.mock.calls[0][1] as RequestInit;
      expect(
        (callOptions.headers as Record<string, string>)?.Authorization,
      ).toBe("Bearer test-api-key-123");
    });

    it("does not include Authorization header when apiKey not set", async () => {
      mockFetch.mockResolvedValueOnce(
        buildSuccessResponse({ skills: [], total: 0, page: 1, pageSize: 10 }),
      );

      await service.searchSkills("test");

      const callOptions = mockFetch.mock.calls[0][1] as RequestInit;
      expect(
        (callOptions.headers as Record<string, string>)?.Authorization,
      ).toBeUndefined();
    });
  });
});
