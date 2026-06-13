import { Test, TestingModule } from "@nestjs/testing";
import { SourceWhitelistService } from "../source-whitelist.service";
import { PrismaService } from "../../../../../../../common/prisma/prisma.service";

const mockPrisma = {
  sourceWhitelist: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
  },
};

describe("SourceWhitelistService", () => {
  let service: SourceWhitelistService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SourceWhitelistService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SourceWhitelistService>(SourceWhitelistService);
  });

  // ─── createWhitelist ─────────────────────────────────────────────────────────

  describe("createWhitelist", () => {
    it("creates a new whitelist when none exists", async () => {
      mockPrisma.sourceWhitelist.findFirst.mockResolvedValueOnce(null);
      mockPrisma.sourceWhitelist.create.mockResolvedValueOnce({
        id: "wl-1",
        resourceType: "PAPER",
        allowedDomains: ["arxiv.org"],
        isActive: true,
      });

      const result = await service.createWhitelist({
        resourceType: "PAPER" as any,
        allowedDomains: ["arxiv.org"],
        description: "Papers",
      });

      expect(mockPrisma.sourceWhitelist.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            resourceType: "PAPER",
            isActive: true,
          }),
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({ resourceType: "PAPER" }),
      );
    });

    it("updates (via updateWhitelist) when a whitelist already exists", async () => {
      mockPrisma.sourceWhitelist.findFirst.mockResolvedValueOnce({
        id: "wl-1",
        resourceType: "PAPER",
      });
      mockPrisma.sourceWhitelist.updateMany.mockResolvedValueOnce({ count: 1 });

      await service.createWhitelist({
        resourceType: "PAPER" as any,
        allowedDomains: ["arxiv.org", "ieee.org"],
      });

      expect(mockPrisma.sourceWhitelist.create).not.toHaveBeenCalled();
      expect(mockPrisma.sourceWhitelist.updateMany).toHaveBeenCalled();
    });
  });

  // ─── getWhitelist ────────────────────────────────────────────────────────────

  describe("getWhitelist", () => {
    it("returns the whitelist when found", async () => {
      const wl = { id: "wl-1", resourceType: "PAPER", isActive: true };
      mockPrisma.sourceWhitelist.findFirst.mockResolvedValueOnce(wl);

      const result = await service.getWhitelist("PAPER" as any);

      expect(result).toEqual(wl);
    });

    it("returns null when whitelist is not found", async () => {
      mockPrisma.sourceWhitelist.findFirst.mockResolvedValueOnce(null);

      const result = await service.getWhitelist("EVENT" as any);

      expect(result).toBeNull();
    });
  });

  // ─── getAllWhitelists ─────────────────────────────────────────────────────────

  describe("getAllWhitelists", () => {
    it("returns all whitelists ordered by createdAt asc", async () => {
      const wls = [
        { id: "wl-1", resourceType: "PAPER" },
        { id: "wl-2", resourceType: "NEWS" },
      ];
      mockPrisma.sourceWhitelist.findMany.mockResolvedValueOnce(wls);

      const result = await service.getAllWhitelists();

      expect(result).toHaveLength(2);
      expect(mockPrisma.sourceWhitelist.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: "asc" } }),
      );
    });

    it("propagates prisma errors", async () => {
      mockPrisma.sourceWhitelist.findMany.mockRejectedValueOnce(
        new Error("DB error"),
      );

      await expect(service.getAllWhitelists()).rejects.toThrow("DB error");
    });
  });

  // ─── updateWhitelist ─────────────────────────────────────────────────────────

  describe("updateWhitelist", () => {
    it("updates allowedDomains when provided", async () => {
      mockPrisma.sourceWhitelist.updateMany.mockResolvedValueOnce({ count: 1 });

      await service.updateWhitelist("PAPER" as any, {
        allowedDomains: ["arxiv.org"],
      });

      const dataArg =
        mockPrisma.sourceWhitelist.updateMany.mock.calls[0][0].data;
      expect(dataArg.allowedDomains).toEqual(["arxiv.org"]);
    });

    it("updates isActive when provided", async () => {
      mockPrisma.sourceWhitelist.updateMany.mockResolvedValueOnce({ count: 1 });

      await service.updateWhitelist("NEWS" as any, { isActive: false });

      const dataArg =
        mockPrisma.sourceWhitelist.updateMany.mock.calls[0][0].data;
      expect(dataArg.isActive).toBe(false);
    });

    it("does not include allowedDomains when undefined", async () => {
      mockPrisma.sourceWhitelist.updateMany.mockResolvedValueOnce({ count: 1 });

      await service.updateWhitelist("NEWS" as any, {
        description: "Updated desc",
      });

      const dataArg =
        mockPrisma.sourceWhitelist.updateMany.mock.calls[0][0].data;
      expect(dataArg.allowedDomains).toBeUndefined();
    });
  });

  // ─── deleteWhitelist ─────────────────────────────────────────────────────────

  describe("deleteWhitelist", () => {
    it("deletes the whitelist for the given resource type", async () => {
      mockPrisma.sourceWhitelist.deleteMany.mockResolvedValueOnce({ count: 1 });

      await service.deleteWhitelist("BLOG" as any);

      expect(mockPrisma.sourceWhitelist.deleteMany).toHaveBeenCalledWith({
        where: { resourceType: "BLOG" },
      });
    });

    it("propagates errors from prisma", async () => {
      mockPrisma.sourceWhitelist.deleteMany.mockRejectedValueOnce(
        new Error("FK constraint"),
      );

      await expect(service.deleteWhitelist("PAPER" as any)).rejects.toThrow(
        "FK constraint",
      );
    });
  });

  // ─── validateUrl ─────────────────────────────────────────────────────────────

  describe("validateUrl", () => {
    it("returns isValid=true for an exact domain match", async () => {
      mockPrisma.sourceWhitelist.findFirst.mockResolvedValueOnce({
        id: "wl-1",
        isActive: true,
        allowedDomains: ["arxiv.org"],
      });
      mockPrisma.sourceWhitelist.updateMany.mockResolvedValueOnce({ count: 1 });

      const result = await service.validateUrl(
        "PAPER" as any,
        "https://arxiv.org/abs/2401.00001",
      );

      expect(result.isValid).toBe(true);
      expect(result.matchedDomain).toBe("arxiv.org");
    });

    it("returns isValid=true for a wildcard domain match (*.arxiv.org)", async () => {
      mockPrisma.sourceWhitelist.findFirst.mockResolvedValueOnce({
        id: "wl-1",
        isActive: true,
        allowedDomains: ["*.arxiv.org"],
      });
      mockPrisma.sourceWhitelist.updateMany.mockResolvedValueOnce({ count: 1 });

      const result = await service.validateUrl(
        "PAPER" as any,
        "https://export.arxiv.org/abs/2401.00001",
      );

      expect(result.isValid).toBe(true);
    });

    it("returns isValid=true via implicit parent-domain match (example.com matches sub.example.com)", async () => {
      mockPrisma.sourceWhitelist.findFirst.mockResolvedValueOnce({
        id: "wl-1",
        isActive: true,
        allowedDomains: ["example.com"],
      });
      mockPrisma.sourceWhitelist.updateMany.mockResolvedValueOnce({ count: 1 });

      const result = await service.validateUrl(
        "NEWS" as any,
        "https://blog.example.com/article",
      );

      expect(result.isValid).toBe(true);
    });

    it("returns isValid=false when domain is not in whitelist", async () => {
      mockPrisma.sourceWhitelist.findFirst.mockResolvedValueOnce({
        id: "wl-1",
        isActive: true,
        allowedDomains: ["arxiv.org"],
      });
      mockPrisma.sourceWhitelist.updateMany.mockResolvedValueOnce({ count: 1 });

      const result = await service.validateUrl(
        "PAPER" as any,
        "https://evilsite.com/paper",
      );

      expect(result.isValid).toBe(false);
      expect(result.reason).toContain("not in the whitelist");
    });

    it("returns isValid=false when no whitelist exists", async () => {
      mockPrisma.sourceWhitelist.findFirst.mockResolvedValueOnce(null);

      const result = await service.validateUrl(
        "EVENT" as any,
        "https://eventbrite.com/event/1",
      );

      expect(result.isValid).toBe(false);
      expect(result.reason).toContain("No active whitelist");
    });

    it("returns isValid=false when whitelist is inactive", async () => {
      mockPrisma.sourceWhitelist.findFirst.mockResolvedValueOnce({
        id: "wl-1",
        isActive: false,
        allowedDomains: ["arxiv.org"],
      });

      const result = await service.validateUrl(
        "PAPER" as any,
        "https://arxiv.org/abs/123",
      );

      expect(result.isValid).toBe(false);
    });

    it("returns isValid=false when domain is not in any allowed pattern", async () => {
      // "not-a-url" is prepended with https://, parsed hostname = "not-a-url"
      // which does not match "arxiv.org"
      mockPrisma.sourceWhitelist.findFirst.mockResolvedValueOnce({
        id: "wl-1",
        isActive: true,
        allowedDomains: ["arxiv.org"],
      });
      mockPrisma.sourceWhitelist.updateMany.mockResolvedValueOnce({ count: 1 });

      const result = await service.validateUrl("PAPER" as any, "not-a-url");

      expect(result.isValid).toBe(false);
    });

    it("matches URL without scheme (adds https:// prefix)", async () => {
      mockPrisma.sourceWhitelist.findFirst.mockResolvedValueOnce({
        id: "wl-1",
        isActive: true,
        allowedDomains: ["arxiv.org"],
      });
      mockPrisma.sourceWhitelist.updateMany.mockResolvedValueOnce({ count: 1 });

      const result = await service.validateUrl(
        "PAPER" as any,
        "arxiv.org/abs/2401.00001",
      );

      expect(result.isValid).toBe(true);
    });
  });

  // ─── validateUrls ────────────────────────────────────────────────────────────

  describe("validateUrls", () => {
    it("returns results for each URL", async () => {
      // First call: valid
      mockPrisma.sourceWhitelist.findFirst.mockResolvedValueOnce({
        id: "wl-1",
        isActive: true,
        allowedDomains: ["arxiv.org"],
      });
      mockPrisma.sourceWhitelist.updateMany.mockResolvedValueOnce({ count: 1 });

      // Second call: valid
      mockPrisma.sourceWhitelist.findFirst.mockResolvedValueOnce({
        id: "wl-1",
        isActive: true,
        allowedDomains: ["arxiv.org"],
      });
      mockPrisma.sourceWhitelist.updateMany.mockResolvedValueOnce({ count: 1 });

      const results = await service.validateUrls("PAPER" as any, [
        "https://arxiv.org/abs/1",
        "https://arxiv.org/abs/2",
      ]);

      expect(results).toHaveLength(2);
      expect(results[0].url).toBe("https://arxiv.org/abs/1");
      expect(results[0].isValid).toBe(true);
    });
  });

  // ─── addAllowedDomain ────────────────────────────────────────────────────────

  describe("addAllowedDomain", () => {
    it("adds a new domain to the whitelist", async () => {
      // getWhitelist call
      mockPrisma.sourceWhitelist.findFirst
        .mockResolvedValueOnce({
          id: "wl-1",
          allowedDomains: ["arxiv.org"],
        })
        // findFirst inside addAllowedDomain
        .mockResolvedValueOnce({ id: "wl-1", allowedDomains: ["arxiv.org"] });
      mockPrisma.sourceWhitelist.updateMany.mockResolvedValueOnce({ count: 1 });

      await service.addAllowedDomain("PAPER" as any, "ieee.org");

      expect(mockPrisma.sourceWhitelist.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            allowedDomains: ["arxiv.org", "ieee.org"],
          }),
        }),
      );
    });

    it("does not duplicate a domain that already exists", async () => {
      mockPrisma.sourceWhitelist.findFirst.mockResolvedValueOnce({
        id: "wl-1",
        allowedDomains: ["arxiv.org"],
      });

      const result = await service.addAllowedDomain(
        "PAPER" as any,
        "arxiv.org",
      );

      expect(mockPrisma.sourceWhitelist.updateMany).not.toHaveBeenCalled();
      expect(result).toEqual({ id: "wl-1", allowedDomains: ["arxiv.org"] });
    });

    it("throws when whitelist does not exist", async () => {
      mockPrisma.sourceWhitelist.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.addAllowedDomain("PAPER" as any, "ieee.org"),
      ).rejects.toThrow("Whitelist not found");
    });
  });

  // ─── removeAllowedDomain ─────────────────────────────────────────────────────

  describe("removeAllowedDomain", () => {
    it("removes a domain from the whitelist", async () => {
      mockPrisma.sourceWhitelist.findFirst.mockResolvedValueOnce({
        id: "wl-1",
        allowedDomains: ["arxiv.org", "ieee.org"],
      });
      mockPrisma.sourceWhitelist.updateMany.mockResolvedValueOnce({ count: 1 });

      await service.removeAllowedDomain("PAPER" as any, "ieee.org");

      expect(mockPrisma.sourceWhitelist.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            allowedDomains: ["arxiv.org"],
          }),
        }),
      );
    });

    it("throws when whitelist does not exist", async () => {
      mockPrisma.sourceWhitelist.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.removeAllowedDomain("PAPER" as any, "ieee.org"),
      ).rejects.toThrow("Whitelist not found");
    });

    it("returns unchanged whitelist if domain was not in the list", async () => {
      const wl = {
        id: "wl-1",
        allowedDomains: ["arxiv.org"],
      };
      mockPrisma.sourceWhitelist.findFirst.mockResolvedValueOnce(wl);
      mockPrisma.sourceWhitelist.updateMany.mockResolvedValueOnce({ count: 1 });

      await service.removeAllowedDomain("PAPER" as any, "not-listed.org");

      const updateArg =
        mockPrisma.sourceWhitelist.updateMany.mock.calls[0][0].data;
      expect(updateArg.allowedDomains).toEqual(["arxiv.org"]);
    });
  });

  // ─── initializeDefaultWhitelists ─────────────────────────────────────────────

  describe("initializeDefaultWhitelists", () => {
    it("creates whitelists for resource types that have no existing whitelist", async () => {
      // All findFirst calls return null → all should be created
      mockPrisma.sourceWhitelist.findFirst.mockResolvedValue(null);
      // createWhitelist -> findFirst (check existing) + create
      mockPrisma.sourceWhitelist.create.mockResolvedValue({ id: "new-wl" });

      await service.initializeDefaultWhitelists();

      // Should have attempted to create whitelists (PAPER, BLOG, NEWS, etc.)
      expect(
        mockPrisma.sourceWhitelist.create.mock.calls.length,
      ).toBeGreaterThan(0);
    });

    it("skips creation when whitelist already exists for a resource type", async () => {
      // All findFirst calls return existing whitelists
      mockPrisma.sourceWhitelist.findFirst.mockResolvedValue({ id: "wl-1" });

      await service.initializeDefaultWhitelists();

      expect(mockPrisma.sourceWhitelist.create).not.toHaveBeenCalled();
    });

    it("does not throw when an error occurs during initialization", async () => {
      mockPrisma.sourceWhitelist.findFirst.mockRejectedValue(
        new Error("DB offline"),
      );

      await expect(
        service.initializeDefaultWhitelists(),
      ).resolves.not.toThrow();
    });
  });

  // ─── Domain matching (private logic exercised through validateUrl) ────────────

  describe("domain matching edge cases", () => {
    const setupWhitelist = (domains: string[]) => {
      mockPrisma.sourceWhitelist.findFirst.mockResolvedValue({
        id: "wl-1",
        isActive: true,
        allowedDomains: domains,
      });
      mockPrisma.sourceWhitelist.updateMany.mockResolvedValue({ count: 1 });
    };

    it("matches double wildcard pattern *.domain.*", async () => {
      setupWhitelist(["*.scholar.*"]);

      const result = await service.validateUrl(
        "PAPER" as any,
        "https://www.scholar.google.com/citations",
      );

      expect(result.isValid).toBe(true);
    });

    it("matches via regex pattern /^pattern$/", async () => {
      setupWhitelist(["/^arxiv\\.org$/"]);

      const result = await service.validateUrl(
        "PAPER" as any,
        "https://arxiv.org/abs/1",
      );

      expect(result.isValid).toBe(true);
    });

    it("does not match when domain contains the pattern as a substring only", async () => {
      setupWhitelist(["arxiv.org"]);

      // notarxiv.org is not a subdomain or exact match
      const result = await service.validateUrl(
        "PAPER" as any,
        "https://notarxiv.org/paper",
      );

      // notarxiv.org does not end with ".arxiv.org" and is not exact "arxiv.org"
      expect(result.isValid).toBe(false);
    });
  });
});
