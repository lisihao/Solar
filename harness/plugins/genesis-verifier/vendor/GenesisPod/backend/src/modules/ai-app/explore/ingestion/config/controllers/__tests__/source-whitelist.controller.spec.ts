import { Test, TestingModule } from "@nestjs/testing";
import {
  Logger,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from "@nestjs/common";
import { SourceWhitelistController } from "../source-whitelist.controller";
import { SourceWhitelistService } from "../../services/source-whitelist.service";
import { ResourceType } from "@prisma/client";

const mockWhitelistEntry = {
  id: "wl-1",
  resourceType: "ARTICLE" as ResourceType,
  allowedDomains: ["techcrunch.com", "wired.com"],
  description: "Tech news sources",
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("SourceWhitelistController", () => {
  let controller: SourceWhitelistController;
  let whitelistService: jest.Mocked<SourceWhitelistService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SourceWhitelistController],
      providers: [
        {
          provide: SourceWhitelistService,
          useValue: {
            getAllWhitelists: jest.fn(),
            getWhitelist: jest.fn(),
            createWhitelist: jest.fn(),
            updateWhitelist: jest.fn(),
            deleteWhitelist: jest.fn(),
            validateUrl: jest.fn(),
            validateUrls: jest.fn(),
            addAllowedDomain: jest.fn(),
            removeAllowedDomain: jest.fn(),
            initializeDefaultWhitelists: jest.fn(),
          },
        },
      ],
    })
      .setLogger({
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        verbose: jest.fn(),
      } as unknown as Logger)
      .compile();

    controller = module.get(SourceWhitelistController);
    whitelistService = module.get(SourceWhitelistService);
  });

  // =========================================================
  // GET /data-management/whitelists
  // =========================================================

  describe("getAllWhitelists", () => {
    it("returns data array and total count", async () => {
      whitelistService.getAllWhitelists.mockResolvedValue([mockWhitelistEntry]);

      const result = await controller.getAllWhitelists();

      expect(result).toEqual({ data: [mockWhitelistEntry], total: 1 });
    });

    it("returns empty data when no whitelists exist", async () => {
      whitelistService.getAllWhitelists.mockResolvedValue([]);

      const result = await controller.getAllWhitelists();

      expect(result).toEqual({ data: [], total: 0 });
    });

    it("throws InternalServerErrorException on service error", async () => {
      whitelistService.getAllWhitelists.mockRejectedValue(
        new Error("DB error"),
      );

      await expect(controller.getAllWhitelists()).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // =========================================================
  // GET /data-management/whitelists/:resourceType
  // =========================================================

  describe("getWhitelist", () => {
    it("returns the whitelist for the given resource type", async () => {
      whitelistService.getWhitelist.mockResolvedValue(mockWhitelistEntry);

      const result = await controller.getWhitelist("ARTICLE");

      expect(result).toEqual(mockWhitelistEntry);
      expect(whitelistService.getWhitelist).toHaveBeenCalledWith("ARTICLE");
    });

    it("throws NotFoundException when whitelist does not exist", async () => {
      whitelistService.getWhitelist.mockResolvedValue(null);

      await expect(controller.getWhitelist("VIDEO")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("re-throws NotFoundException from service", async () => {
      whitelistService.getWhitelist.mockRejectedValue(
        new NotFoundException("not found"),
      );

      await expect(controller.getWhitelist("VIDEO")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws InternalServerErrorException on unexpected service error", async () => {
      whitelistService.getWhitelist.mockRejectedValue(
        new Error("connection lost"),
      );

      await expect(controller.getWhitelist("ARTICLE")).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // =========================================================
  // POST /data-management/whitelists
  // =========================================================

  describe("createWhitelist", () => {
    it("creates and returns a new whitelist", async () => {
      whitelistService.createWhitelist.mockResolvedValue(mockWhitelistEntry);
      const body = {
        resourceType: "ARTICLE" as ResourceType,
        allowedDomains: ["techcrunch.com"],
        description: "Tech news",
      };

      const result = await controller.createWhitelist(body);

      expect(result).toEqual(mockWhitelistEntry);
      expect(whitelistService.createWhitelist).toHaveBeenCalledWith(body);
    });

    it("throws BadRequestException when resourceType is missing", async () => {
      const body = {
        resourceType: undefined as unknown as ResourceType,
        allowedDomains: ["a.com"],
      };

      await expect(controller.createWhitelist(body)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("throws BadRequestException when allowedDomains is missing", async () => {
      const body = {
        resourceType: "ARTICLE" as ResourceType,
        allowedDomains: undefined as unknown as string[],
      };

      await expect(controller.createWhitelist(body)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("throws InternalServerErrorException on service error", async () => {
      whitelistService.createWhitelist.mockRejectedValue(
        new Error("DB write failed"),
      );
      const body = {
        resourceType: "ARTICLE" as ResourceType,
        allowedDomains: ["a.com"],
      };

      await expect(controller.createWhitelist(body)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // =========================================================
  // PUT /data-management/whitelists/:resourceType
  // =========================================================

  describe("updateWhitelist", () => {
    it("returns the updated whitelist", async () => {
      whitelistService.updateWhitelist.mockResolvedValue(mockWhitelistEntry);

      const result = await controller.updateWhitelist("ARTICLE", {
        allowedDomains: ["new.com"],
        isActive: false,
      });

      expect(result).toEqual(mockWhitelistEntry);
      expect(whitelistService.updateWhitelist).toHaveBeenCalledWith("ARTICLE", {
        allowedDomains: ["new.com"],
        isActive: false,
      });
    });

    it("throws InternalServerErrorException on service error", async () => {
      whitelistService.updateWhitelist.mockRejectedValue(
        new Error("not found"),
      );

      await expect(
        controller.updateWhitelist("ARTICLE", { isActive: true }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // =========================================================
  // DELETE /data-management/whitelists/:resourceType
  // =========================================================

  describe("deleteWhitelist", () => {
    it("returns success message after deletion", async () => {
      whitelistService.deleteWhitelist.mockResolvedValue(undefined);

      const result = await controller.deleteWhitelist("ARTICLE");

      expect(result).toEqual({
        message: "Whitelist for ARTICLE deleted successfully",
      });
    });

    it("throws InternalServerErrorException on service error", async () => {
      whitelistService.deleteWhitelist.mockRejectedValue(new Error("DB error"));

      await expect(controller.deleteWhitelist("ARTICLE")).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // =========================================================
  // GET /data-management/whitelists/:resourceType/validate
  // =========================================================

  describe("validateUrl", () => {
    it("returns validation result for an allowed URL", async () => {
      const validationResult = {
        isValid: true,
        domain: "techcrunch.com",
        url: "https://techcrunch.com/article",
      };
      whitelistService.validateUrl.mockResolvedValue(validationResult);

      const result = await controller.validateUrl(
        "ARTICLE",
        "https://techcrunch.com/article",
      );

      expect(result).toEqual(validationResult);
    });

    it("throws BadRequestException when url query param is missing", async () => {
      await expect(
        controller.validateUrl("ARTICLE", undefined as unknown as string),
      ).rejects.toThrow(BadRequestException);
    });

    it("re-throws BadRequestException from service validation", async () => {
      whitelistService.validateUrl.mockRejectedValue(
        new BadRequestException("invalid url"),
      );

      await expect(
        controller.validateUrl("ARTICLE", "not-a-url"),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws InternalServerErrorException on unexpected error", async () => {
      whitelistService.validateUrl.mockRejectedValue(new Error("DB error"));

      await expect(
        controller.validateUrl("ARTICLE", "https://example.com"),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // =========================================================
  // POST /data-management/whitelists/:resourceType/validate-batch
  // =========================================================

  describe("validateUrls", () => {
    it("returns summary with valid/invalid counts", async () => {
      const rawResults = [
        { isValid: true, url: "https://techcrunch.com/a" },
        { isValid: false, url: "https://spam.com/b" },
      ];
      whitelistService.validateUrls.mockResolvedValue(rawResults);

      const result = await controller.validateUrls("ARTICLE", {
        urls: ["https://techcrunch.com/a", "https://spam.com/b"],
      });

      expect(result).toEqual({
        data: rawResults,
        total: 2,
        validCount: 1,
        invalidCount: 1,
      });
    });

    it("throws BadRequestException when urls field is missing", async () => {
      await expect(
        controller.validateUrls("ARTICLE", {} as { urls: string[] }),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when urls is not an array", async () => {
      await expect(
        controller.validateUrls("ARTICLE", {
          urls: "bad" as unknown as string[],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws InternalServerErrorException on service error", async () => {
      whitelistService.validateUrls.mockRejectedValue(new Error("DB error"));

      await expect(
        controller.validateUrls("ARTICLE", { urls: ["https://a.com"] }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // =========================================================
  // POST /data-management/whitelists/:resourceType/domains
  // =========================================================

  describe("addAllowedDomain", () => {
    it("adds a domain and returns updated whitelist", async () => {
      whitelistService.addAllowedDomain.mockResolvedValue(mockWhitelistEntry);

      const result = await controller.addAllowedDomain("ARTICLE", {
        domain: "newsite.com",
      });

      expect(result).toEqual(mockWhitelistEntry);
      expect(whitelistService.addAllowedDomain).toHaveBeenCalledWith(
        "ARTICLE",
        "newsite.com",
      );
    });

    it("throws BadRequestException when domain is missing", async () => {
      await expect(
        controller.addAllowedDomain("ARTICLE", { domain: "" }),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws InternalServerErrorException on service error", async () => {
      whitelistService.addAllowedDomain.mockRejectedValue(
        new Error("DB error"),
      );

      await expect(
        controller.addAllowedDomain("ARTICLE", { domain: "newsite.com" }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // =========================================================
  // DELETE /data-management/whitelists/:resourceType/domains/:domain
  // =========================================================

  describe("removeAllowedDomain", () => {
    it("removes a domain and returns updated whitelist", async () => {
      whitelistService.removeAllowedDomain.mockResolvedValue(
        mockWhitelistEntry,
      );

      const result = await controller.removeAllowedDomain(
        "ARTICLE",
        "techcrunch.com",
      );

      expect(result).toEqual(mockWhitelistEntry);
      expect(whitelistService.removeAllowedDomain).toHaveBeenCalledWith(
        "ARTICLE",
        "techcrunch.com",
      );
    });

    it("throws InternalServerErrorException on service error", async () => {
      whitelistService.removeAllowedDomain.mockRejectedValue(
        new Error("DB error"),
      );

      await expect(
        controller.removeAllowedDomain("ARTICLE", "techcrunch.com"),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // =========================================================
  // POST /data-management/whitelists/init/defaults
  // =========================================================

  describe("initializeDefaults", () => {
    it("returns success message after initialization", async () => {
      whitelistService.initializeDefaultWhitelists.mockResolvedValue(undefined);

      const result = await controller.initializeDefaults();

      expect(result).toEqual({
        message: "Default whitelists initialized successfully",
      });
    });

    it("throws InternalServerErrorException on service error", async () => {
      whitelistService.initializeDefaultWhitelists.mockRejectedValue(
        new Error("init failed"),
      );

      await expect(controller.initializeDefaults()).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });
});
