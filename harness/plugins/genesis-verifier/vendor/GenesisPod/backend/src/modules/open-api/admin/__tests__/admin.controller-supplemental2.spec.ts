/**
 * admin.controller-supplemental2.spec.ts
 *
 * Covers branches NOT tested by admin.controller.spec.ts or
 * admin.controller-supplemental.spec.ts:
 *
 *   - testSearchConnection() — tavily success, serper success
 *   - testExtractionConnection() — firecrawl success, tavily success/error, no-apiKey path
 *   - testYoutubeConnection() — supadata success, unknown provider, no-apiKey path
 *   - testTTSConnection() — google TTS with json() throwing, no-apiKey path
 *   - getSkillsmpSkills() — syncedSkills is null (fallback to preset)
 *   - installSkillFromMarketplace() — service throws (catch branch)
 *   - syncSkillsmp() — name-based deduplication ID, data.data.skills structure
 */

import { Test, TestingModule } from "@nestjs/testing";
import { AdminController } from "../admin.controller";
import { AdminService } from "../admin.service";
import { ChatFacade } from "../../../ai-harness/facade";
import { SecretsService } from "../../../platform/credentials/storage/secrets/secrets.service";
import { StorageInventoryService } from "../../../platform/storage/governance/storage-inventory.service";
import { StorageOffloadService } from "../../../platform/storage/governance/storage-offload.service";
import { SystemModelInventoryService } from "../../../ai-engine/llm/models/catalog/system-model-inventory.service";
import { CapabilityOverridesWriterService } from "../../../ai-engine/facade";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";

// ---------------------------------------------------------------------------
// Module-level mocks for heavy transitive deps
// ---------------------------------------------------------------------------

// @prisma/client is not fully generated in this worktree — mock the entire
// module using a Proxy so that any enum member access (e.g. AIModelType.CHAT_FAST,
// CreditTransactionType.AI_ASK, etc.) returns the key name as a string value,
// preventing "Cannot read properties of undefined" errors from transitive imports.
jest.mock("@prisma/client", () => {
  const enumProxy = new Proxy(
    {},
    { get: (_target, prop) => (typeof prop === "string" ? prop : undefined) },
  );
  return new Proxy(
    { PrismaClient: jest.fn().mockImplementation(() => ({})) },
    {
      get(target, prop) {
        if (prop in target)
          return (target as Record<string | symbol, unknown>)[prop];
        return enumProxy;
      },
    },
  );
});

jest.mock("../../../../common/cache/cache.module", () => ({}));
jest.mock("../../../../common/cache/cache.service", () => ({
  CacheService: jest.fn(),
}));

// Mock @nestjs/axios so testSearchConnection's dynamic `import("@nestjs/axios")`
// returns a controllable HttpService stub.
const mockHttpPost = jest.fn();
jest.mock("@nestjs/axios", () => ({
  HttpService: jest.fn().mockImplementation(() => ({
    post: mockHttpPost,
  })),
}));

// ---------------------------------------------------------------------------
// Mock service factories
// ---------------------------------------------------------------------------
const mockAdminService = {
  getAllUsers: jest.fn(),
  getUserStats: jest.fn(),
  createUser: jest.fn(),
  getUserLoginHistory: jest.fn(),
  getSystemStats: jest.fn(),
  getOverviewStats: jest.fn(),
  deleteResource: jest.fn(),
  deleteResources: jest.fn(),
  updateUserRole: jest.fn(),
  toggleUserStatus: jest.fn(),
  updateUser: jest.fn(),
  deleteUser: jest.fn(),
  getUserCredits: jest.fn(),
  grantCredits: jest.fn(),
  toggleCreditFreeze: jest.fn(),
  getAllAIModels: jest.fn(),
  diagnoseAIModels: jest.fn(),
  getAIModel: jest.fn(),
  getAIModelApiKey: jest.fn(),
  createAIModel: jest.fn(),
  updateAIModel: jest.fn(),
  setDefaultAIModel: jest.fn(),
  deleteAIModel: jest.fn(),
  getSettings: jest.fn(),
  setSettings: jest.fn(),
  getSmtpSettings: jest.fn(),
  updateSmtpSettings: jest.fn(),
  testSmtpConnection: jest.fn(),
  getEmailSettingsUnified: jest.fn(),
  updateEmailSettingsUnified: jest.fn(),
  testEmailConnection: jest.fn(),
  getSiteSettings: jest.fn(),
  updateSiteSettings: jest.fn(),
  getAiSettings: jest.fn(),
  updateAiSettings: jest.fn(),
  getSecuritySettings: jest.fn(),
  updateSecuritySettings: jest.fn(),
  getStorageSettings: jest.fn(),
  updateStorageSettings: jest.fn(),
  getSearchConfig: jest.fn(),
  updateSearchConfig: jest.fn(),
  getContentExtractionConfig: jest.fn(),
  updateContentExtractionConfig: jest.fn(),
  getYoutubeConfig: jest.fn(),
  updateYoutubeConfig: jest.fn(),
  getTTSConfig: jest.fn(),
  updateTTSConfig: jest.fn(),
  getSkillsmpConfig: jest.fn(),
  updateSkillsmpConfig: jest.fn(),
  getSkillsmpApiKey: jest.fn(),
  getSetting: jest.fn(),
  setSetting: jest.fn(),
  installSkillFromMarketplace: jest.fn(),
};

const mockChatFacade = {
  fetchAvailableModels: jest.fn(),
  testModelConnectionWithKey: jest.fn(),
};

const mockSecretsService = {
  getValue: jest.fn(),
};

// ---------------------------------------------------------------------------
// Helper: mock global fetch
// ---------------------------------------------------------------------------
function mockFetch(
  ok: boolean,
  body: unknown = {},
  status = ok ? 200 : 400,
): void {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status,
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  });
}

// ---------------------------------------------------------------------------
// Helper: build a mock observable/rxjs firstValueFrom-compatible response
// ---------------------------------------------------------------------------
function makeHttpResponse(data: unknown): { data: unknown } {
  return { data };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe("AdminController (supplemental2)", () => {
  let controller: AdminController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: AdminService, useValue: mockAdminService },
        { provide: ChatFacade, useValue: mockChatFacade },
        { provide: SecretsService, useValue: mockSecretsService },
        {
          provide: StorageInventoryService,
          useValue: { getInventory: jest.fn() },
        },
        { provide: StorageOffloadService, useValue: { runOnce: jest.fn() } },
        {
          provide: SystemModelInventoryService,
          useValue: { getInventory: jest.fn() },
        },
        {
          provide: CapabilityOverridesWriterService,
          useValue: { applyOverrideTransactional: jest.fn() },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AdminController>(AdminController);
  });

  // ====================== testSearchConnection() — provider branches ======================

  describe("testSearchConnection() — tavily and serper provider success", () => {
    /**
     * testSearchConnection uses `new HttpService()` from @nestjs/axios (dynamic import)
     * and then calls `firstValueFrom(httpService.post(...))`.
     * We mock @nestjs/axios at module level so `HttpService.post` is `mockHttpPost`.
     * `firstValueFrom` in rxjs resolves the first emitted value from an Observable.
     * We return a plain resolved Promise via an RXJS-compatible wrapper.
     */
    it("should return success with resultsCount for tavily provider", async () => {
      const responseData = {
        results: [{ title: "AI news" }, { title: "Tech" }],
      };
      // firstValueFrom expects an Observable-like or Promise-like.
      // We create a minimal Observable that immediately emits the response.
      const { of } = await import("rxjs");
      mockHttpPost.mockReturnValue(of(makeHttpResponse(responseData)));

      const result = await controller.testSearchConnection({
        provider: "tavily",
        apiKey: "tvly-key",
      });

      expect(result).toMatchObject({
        success: true,
        message: expect.stringContaining("Tavily"),
        resultsCount: 2,
      });
    });

    it("should return resultsCount of 0 when tavily results array is missing", async () => {
      const { of } = await import("rxjs");
      mockHttpPost.mockReturnValue(
        of(makeHttpResponse({ results: undefined })),
      );

      const result = await controller.testSearchConnection({
        provider: "tavily",
        apiKey: "tvly-key",
      });

      expect(result).toMatchObject({
        success: true,
        resultsCount: 0,
      });
    });

    it("should return success with resultsCount for serper provider", async () => {
      const responseData = {
        organic: [
          { title: "Result 1" },
          { title: "Result 2" },
          { title: "Result 3" },
        ],
      };
      const { of } = await import("rxjs");
      mockHttpPost.mockReturnValue(of(makeHttpResponse(responseData)));

      const result = await controller.testSearchConnection({
        provider: "serper",
        apiKey: "serper-key",
      });

      expect(result).toMatchObject({
        success: true,
        message: expect.stringContaining("Serper"),
        resultsCount: 3,
      });
    });

    it("should return resultsCount of 0 when serper organic array is missing", async () => {
      const { of } = await import("rxjs");
      mockHttpPost.mockReturnValue(
        of(makeHttpResponse({ organic: undefined })),
      );

      const result = await controller.testSearchConnection({
        provider: "serper",
        apiKey: "serper-key",
      });

      expect(result).toMatchObject({
        success: true,
        resultsCount: 0,
      });
    });

    it("should return failure when no apiKey and no secretKey for search", async () => {
      const result = await controller.testSearchConnection({
        provider: "tavily",
      });

      expect(result).toMatchObject({
        success: false,
        message: expect.stringContaining("No API key"),
      });
    });

    it("should return failure when HttpService.post throws for tavily", async () => {
      const { throwError } = await import("rxjs");
      mockHttpPost.mockReturnValue(
        throwError(() => new Error("tavily timeout")),
      );

      const result = await controller.testSearchConnection({
        provider: "tavily",
        apiKey: "tvly-key",
      });

      expect(result).toMatchObject({
        success: false,
        message: expect.stringContaining("tavily timeout"),
      });
    });
  });

  // ====================== testExtractionConnection() — additional branches ======================

  describe("testExtractionConnection() — firecrawl success, tavily success/error, no-apiKey", () => {
    it("should return success for firecrawl provider when response is ok", async () => {
      mockFetch(true, {});

      const result = await controller.testExtractionConnection({
        provider: "firecrawl",
        apiKey: "fc-key",
      });

      expect(result).toMatchObject({
        success: true,
        message: expect.stringContaining("Firecrawl"),
      });
    });

    it("should return success for tavily extraction provider when response is ok", async () => {
      mockFetch(true, {});

      const result = await controller.testExtractionConnection({
        provider: "tavily",
        apiKey: "tvly-extract-key",
      });

      expect(result).toMatchObject({
        success: true,
        message: expect.stringContaining("Tavily"),
      });
    });

    it("should return failure for tavily extraction provider with HTTP error", async () => {
      mockFetch(false, {}, 403);

      const result = await controller.testExtractionConnection({
        provider: "tavily",
        apiKey: "tvly-extract-key",
      });

      expect(result).toMatchObject({
        success: false,
        message: expect.stringContaining("403"),
      });
    });

    it("should return failure when no apiKey and no secretKey for extraction", async () => {
      const result = await controller.testExtractionConnection({
        provider: "jina",
      });

      expect(result).toMatchObject({
        success: false,
        message: expect.stringContaining("No API key"),
      });
    });
  });

  // ====================== testYoutubeConnection() — additional branches ======================

  describe("testYoutubeConnection() — supadata success, unknown provider, no-apiKey", () => {
    it("should return success for supadata with content field present", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          content: "Never gonna give you up...",
        }),
      });

      const result = await controller.testYoutubeConnection({
        provider: "supadata",
        apiKey: "sup-key",
      });

      expect(result).toMatchObject({
        success: true,
        message: expect.stringContaining("连接成功"),
        hasContent: true,
      });
    });

    it("should return success for supadata with transcript field present", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ transcript: [{ text: "line 1" }] }),
      });

      const result = await controller.testYoutubeConnection({
        provider: "supadata",
        apiKey: "sup-key",
      });

      expect(result).toMatchObject({
        success: true,
        hasContent: true,
      });
    });

    it("should return hasContent=false when both content and transcript are absent", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({}),
      });

      const result = await controller.testYoutubeConnection({
        provider: "supadata",
        apiKey: "sup-key",
      });

      expect(result).toMatchObject({
        success: true,
        hasContent: false,
      });
    });

    it("should return failure for unknown youtube provider", async () => {
      const result = await controller.testYoutubeConnection({
        provider: "unknown-yt-provider",
        apiKey: "some-key",
      });

      expect(result).toMatchObject({
        success: false,
        message: expect.stringContaining("未知的 provider"),
      });
    });

    it("should return failure when no apiKey and no secretKey for youtube", async () => {
      const result = await controller.testYoutubeConnection({
        provider: "supadata",
      });

      expect(result).toMatchObject({
        success: false,
        message: expect.stringContaining("No API key"),
      });
    });
  });

  // ====================== testTTSConnection() — additional branches ======================

  describe("testTTSConnection() — google TTS json catch, no-apiKey", () => {
    it("should use fallback when google TTS error response json() throws", async () => {
      // Simulate response.json() throwing (the code does `.catch(() => ({}))`)
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: jest.fn().mockRejectedValue(new Error("Malformed JSON")),
      });

      const result = await controller.testTTSConnection({
        provider: "google",
        apiKey: "gcp-key",
      });

      expect(result).toMatchObject({
        success: false,
        // Falls back to `HTTP ${response.status}` because errorData.error is absent
        message: expect.stringContaining("500"),
      });
    });

    it("should return failure when no apiKey and no secretKey for TTS", async () => {
      const result = await controller.testTTSConnection({
        provider: "elevenlabs",
      });

      expect(result).toMatchObject({
        success: false,
        message: expect.stringContaining("No API key"),
      });
    });
  });

  // ====================== getSkillsmpSkills() — null syncedSkills ======================

  describe("getSkillsmpSkills() — null syncedSkills falls back to preset", () => {
    it("should fall back to preset skills when syncedSkills setting is null", async () => {
      // Null syncedSkills → `?? []` → empty array → length 0 → preset
      mockAdminService.getSetting.mockImplementation((key: string) => {
        if (key === "skillsmp.syncedSkills") return Promise.resolve(null);
        if (key === "skillsmp.totalSkills") return Promise.resolve(50000);
        if (key === "skillsmp.lastSync") return Promise.resolve(null);
        return Promise.resolve(null);
      });

      const result = await controller.getSkillsmpSkills();

      expect(Array.isArray(result.skills)).toBe(true);
      expect(result.skills.length).toBeGreaterThan(0);
      // Preset skills contain known items
      const skillIds = result.skills.map((s: { id: string }) => s.id);
      expect(skillIds).toContain("skill-deep-research");
      expect(result.totalSkills).toBe(50000);
      expect(result.lastSync).toBeNull();
    });

    it("should fall back to preset skills when syncedSkills is undefined", async () => {
      mockAdminService.getSetting.mockImplementation((key: string) => {
        if (key === "skillsmp.syncedSkills") return Promise.resolve(undefined);
        if (key === "skillsmp.totalSkills") return Promise.resolve(null);
        if (key === "skillsmp.lastSync") return Promise.resolve(null);
        return Promise.resolve(null);
      });

      const result = await controller.getSkillsmpSkills();

      // undefined → `?? []` → length 0 → use preset
      expect(Array.isArray(result.skills)).toBe(true);
      expect(result.skills.length).toBeGreaterThan(0);
      // Default totalSkills fallback
      expect(result.totalSkills).toBe(66541);
    });
  });

  // ====================== installSkillFromMarketplace() — service throws ======================

  describe("installSkillFromMarketplace() — service throws", () => {
    it("should return failure when adminService.installSkillFromMarketplace throws", async () => {
      // Skill exists in preset list but service throws during install
      mockAdminService.getSetting.mockResolvedValue([]);
      mockAdminService.installSkillFromMarketplace.mockRejectedValue(
        new Error("DB connection lost"),
      );

      const result = await controller.installSkillFromMarketplace(
        "skill-deep-research",
      );

      expect(result).toMatchObject({
        success: false,
        message: "DB connection lost",
      });
    });

    it("should find skill by name (not just id) and install it", async () => {
      // Synced skills list contains a skill whose id matches the skillId param
      const syncedSkill = {
        id: "custom-skill-id",
        name: "custom-skill",
        displayName: "Custom Skill",
        description: "A custom skill",
        layer: "application",
        domain: "general",
        tags: ["custom"],
      };
      mockAdminService.getSetting.mockResolvedValue([syncedSkill]);
      mockAdminService.installSkillFromMarketplace.mockResolvedValue({
        id: "custom-skill-id",
      });

      // Install by name (not id)
      const result =
        await controller.installSkillFromMarketplace("custom-skill");

      expect(mockAdminService.installSkillFromMarketplace).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "custom-skill-id",
          name: "custom-skill",
        }),
      );
      expect(result).toMatchObject({ success: true });
    });
  });

  // ====================== syncSkillsmp() — edge case branches ======================

  describe("syncSkillsmp() — additional data structure and deduplication branches", () => {
    it("should parse skills from data.data.skills nested structure", async () => {
      mockAdminService.getSkillsmpApiKey.mockResolvedValue("valid-key");
      mockAdminService.setSetting.mockResolvedValue(undefined);

      const nestedSkill = { id: "nested-skill-1", name: "nested-skill" };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: { skills: [nestedSkill] } }),
      });

      const result = await controller.syncSkillsmp();

      expect(result).toMatchObject({ success: true });

      // Verify setSetting was called with at least one skill
      const skillsCall = mockAdminService.setSetting.mock.calls.find(
        (call) => call[0] === "skillsmp.syncedSkills",
      );
      expect(skillsCall).toBeDefined();
      const storedSkills = skillsCall?.[1] as Array<{ id: string }>;
      expect(storedSkills.length).toBeGreaterThan(0);
    });

    it("should deduplicate skills whose id is derived from name (no id field)", async () => {
      mockAdminService.getSkillsmpApiKey.mockResolvedValue("valid-key");
      mockAdminService.setSetting.mockResolvedValue(undefined);

      // Skill has no id but has name — id derived as name.toLowerCase().replace(/\s+/g, '-')
      const skillWithoutId = { name: "My Skill" };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [skillWithoutId] }),
      });

      const result = await controller.syncSkillsmp();

      expect(result).toMatchObject({ success: true });

      const skillsCall = mockAdminService.setSetting.mock.calls.find(
        (call) => call[0] === "skillsmp.syncedSkills",
      );
      expect(skillsCall).toBeDefined();
      // Same skill returned 5 times (once per search term) but deduplicated to 1
      const storedSkills = skillsCall?.[1] as unknown[];
      expect(storedSkills).toHaveLength(1);
    });

    it("should parse skills from data.data.items nested structure", async () => {
      mockAdminService.getSkillsmpApiKey.mockResolvedValue("valid-key");
      mockAdminService.setSetting.mockResolvedValue(undefined);

      const itemSkill = { id: "item-skill-1", name: "item-skill" };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: { items: [itemSkill] } }),
      });

      const result = await controller.syncSkillsmp();

      expect(result).toMatchObject({ success: true });

      const skillsCall = mockAdminService.setSetting.mock.calls.find(
        (call) => call[0] === "skillsmp.syncedSkills",
      );
      const storedSkills = skillsCall?.[1] as Array<{ id: string }>;
      expect(storedSkills.length).toBeGreaterThan(0);
    });

    it("should tolerate a single search term fetch throwing (inner catch) and continue", async () => {
      mockAdminService.getSkillsmpApiKey.mockResolvedValue("valid-key");
      mockAdminService.setSetting.mockResolvedValue(undefined);

      let callCount = 0;
      global.fetch = jest.fn().mockImplementation(() => {
        callCount++;
        // First term throws; remaining terms return empty results
        if (callCount === 1) {
          return Promise.reject(new Error("First term failed"));
        }
        return Promise.resolve({
          ok: true,
          json: jest.fn().mockResolvedValue({ data: [] }),
        });
      });

      const result = await controller.syncSkillsmp();

      // Overall sync should still succeed despite one failed term
      expect(result).toMatchObject({ success: true });
    });
  });
});
