/**
 * Unit tests for AIEditService
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { AIEditService } from "../ai-edit.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { LayoutFixerSkill } from "../../skills/layout-fixer.skill";
import { ContentPolisherSkill } from "../../skills/content-polisher.skill";
import { FactCheckerSkill } from "../../skills/fact-checker.skill";

describe("AIEditService", () => {
  let service: AIEditService;
  let prisma: jest.Mocked<PrismaService>;
  let aiFacade: jest.Mocked<ChatFacade>;
  let layoutFixerSkill: jest.Mocked<LayoutFixerSkill>;
  let contentPolisherSkill: jest.Mocked<ContentPolisherSkill>;
  let factCheckerSkill: jest.Mocked<FactCheckerSkill>;

  let mockMission: {
    id: string;
    sessionId: string;
    userId: string;
    pages: Array<{ index: number; title: string; html: string }>;
    createdAt: Date;
  };

  const mockChatResponse = {
    content:
      "```html\n<html><body>Updated content</body></html>\n```\n<SUMMARY>Changed the text</SUMMARY>",
    tokensUsed: 200,
  };

  beforeEach(async () => {
    // Create a fresh mockMission each test to prevent mutation pollution
    mockMission = {
      id: "mission-1",
      sessionId: "session-1",
      userId: "user-1",
      pages: [
        {
          index: 0,
          title: "Page 1",
          html: "<html><body>Original content</body></html>",
        },
        {
          index: 1,
          title: "Page 2",
          html: "<html><body>Page 2 content</body></html>",
        },
      ],
      createdAt: new Date(),
    };
    const mockPrisma = {
      slidesMission: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      slidesCheckpoint: {
        findFirst: jest.fn(),
      },
    };

    const mockFacade = {
      chat: jest.fn(),
    };

    const mockLayoutFixer = {
      execute: jest.fn(),
    };

    const mockContentPolisher = {
      execute: jest.fn(),
    };

    const mockFactChecker = {
      execute: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIEditService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ChatFacade, useValue: mockFacade },
        { provide: LayoutFixerSkill, useValue: mockLayoutFixer },
        { provide: ContentPolisherSkill, useValue: mockContentPolisher },
        { provide: FactCheckerSkill, useValue: mockFactChecker },
      ],
    }).compile();

    service = module.get<AIEditService>(AIEditService);
    prisma = module.get(PrismaService);
    aiFacade = module.get(ChatFacade);
    layoutFixerSkill = module.get(LayoutFixerSkill);
    contentPolisherSkill = module.get(ContentPolisherSkill);
    factCheckerSkill = module.get(FactCheckerSkill);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ============================================
  // chatEdit - each test sets up its own mocks
  // ============================================

  describe("chatEdit", () => {
    it("should edit a slide page and return updated HTML", async () => {
      (prisma.slidesMission.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockMission) // resolveMissionId - direct match
        .mockResolvedValueOnce(mockMission); // actual mission fetch
      (aiFacade.chat as jest.Mock).mockResolvedValueOnce(mockChatResponse);
      (prisma.slidesMission.update as jest.Mock).mockResolvedValue(mockMission);

      const result = await service.chatEdit(
        "mission-1",
        0,
        "Change the title to Hello World",
        "user-1",
      );

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.updatedHtml).toContain("Updated content");
      expect(result.reply).toBe("Changed the text");
      expect(aiFacade.chat).toHaveBeenCalled();
    });

    it("should throw InternalServerErrorException when aiFacade is not available", async () => {
      // Create service without facade
      const moduleWithoutFacade: TestingModule = await Test.createTestingModule(
        {
          providers: [
            AIEditService,
            { provide: PrismaService, useValue: prisma },
            { provide: ChatFacade, useValue: null },
            { provide: LayoutFixerSkill, useValue: null },
            { provide: ContentPolisherSkill, useValue: null },
            { provide: FactCheckerSkill, useValue: null },
          ],
        },
      ).compile();

      const serviceWithoutFacade =
        moduleWithoutFacade.get<AIEditService>(AIEditService);

      // resolveMissionId returns mission-1
      (prisma.slidesMission.findFirst as jest.Mock).mockResolvedValueOnce(
        mockMission,
      );

      await expect(
        serviceWithoutFacade.chatEdit("mission-1", 0, "Edit", "user-1"),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it("should throw NotFoundException when mission does not exist", async () => {
      (prisma.slidesMission.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockMission) // resolveMissionId step
        .mockResolvedValueOnce(null); // actual mission lookup returns null

      await expect(
        service.chatEdit("mission-1", 0, "Edit", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when missionId and sessionId both not found", async () => {
      (prisma.slidesMission.findFirst as jest.Mock)
        .mockResolvedValueOnce(null) // not a direct mission
        .mockResolvedValueOnce(null); // not a session mission either

      await expect(
        service.chatEdit("nonexistent", 0, "Edit", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException for out-of-range page index", async () => {
      (prisma.slidesMission.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockMission)
        .mockResolvedValueOnce(mockMission);
      (aiFacade.chat as jest.Mock).mockResolvedValueOnce(mockChatResponse);

      await expect(
        service.chatEdit("mission-1", 99, "Edit", "user-1"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException for negative page index", async () => {
      (prisma.slidesMission.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockMission)
        .mockResolvedValueOnce(mockMission);
      (aiFacade.chat as jest.Mock).mockResolvedValueOnce(mockChatResponse);

      await expect(
        service.chatEdit("mission-1", -1, "Edit", "user-1"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException when page has no HTML content", async () => {
      const missionWithEmptyPage = {
        ...mockMission,
        pages: [{ index: 0, title: "Empty Page", html: "" }],
      };
      (prisma.slidesMission.findFirst as jest.Mock)
        .mockResolvedValueOnce(missionWithEmptyPage) // resolveMissionId
        .mockResolvedValueOnce(missionWithEmptyPage); // actual mission fetch
      (aiFacade.chat as jest.Mock).mockResolvedValueOnce(mockChatResponse);

      await expect(
        service.chatEdit("mission-1", 0, "Edit", "user-1"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should fall back to checkpoint pages when mission.pages is empty", async () => {
      const missionEmpty = { ...mockMission, pages: [] };
      const mockCheckpoint = {
        stateJson: { pages: mockMission.pages },
        createdAt: new Date(),
      };

      (prisma.slidesMission.findFirst as jest.Mock)
        .mockResolvedValueOnce(missionEmpty) // resolveMissionId
        .mockResolvedValueOnce(missionEmpty); // actual mission lookup

      (prisma.slidesCheckpoint.findFirst as jest.Mock).mockResolvedValueOnce(
        mockCheckpoint,
      );

      (aiFacade.chat as jest.Mock).mockResolvedValueOnce(mockChatResponse);
      (prisma.slidesMission.update as jest.Mock).mockResolvedValue(mockMission);

      const result = await service.chatEdit("mission-1", 0, "Edit", "user-1");
      expect(result.success).toBe(true);
    });

    it("should use fallback reply when no SUMMARY tag in LLM response", async () => {
      (prisma.slidesMission.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockMission)
        .mockResolvedValueOnce(mockMission);
      // Use mockImplementation to override any leftover Once queue from previous tests
      (aiFacade.chat as jest.Mock).mockImplementation(() =>
        Promise.resolve({
          content: "```html\n<html>Fixed</html>\n```\n No summary here.",
          tokensUsed: 100,
        }),
      );
      (prisma.slidesMission.update as jest.Mock).mockResolvedValue(mockMission);

      const result = await service.chatEdit("mission-1", 0, "Edit", "user-1");

      expect(result.reply).toContain("修改完成");
    });

    it("should keep original HTML when LLM response has no HTML block", async () => {
      (prisma.slidesMission.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockMission)
        .mockResolvedValueOnce(mockMission);
      // Use mockImplementation to ensure this test's value takes precedence
      (aiFacade.chat as jest.Mock).mockImplementation(() =>
        Promise.resolve({
          content:
            "Some text without HTML block. <SUMMARY>Nothing changed</SUMMARY>",
          tokensUsed: 50,
        }),
      );

      const result = await service.chatEdit("mission-1", 0, "Edit", "user-1");

      // updatedHtml should be the original HTML since no ```html block was in the response
      expect(result.updatedHtml).toContain("Original content");
    });

    it("should not call update when HTML did not change", async () => {
      (prisma.slidesMission.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockMission)
        .mockResolvedValueOnce(mockMission);
      // LLM returns same HTML as the original - should NOT trigger update
      // Use mockImplementation to ensure this test's value takes precedence
      (aiFacade.chat as jest.Mock).mockImplementation(() =>
        Promise.resolve({
          content:
            "```html\n<html><body>Original content</body></html>\n```\n<SUMMARY>No change</SUMMARY>",
          tokensUsed: 50,
        }),
      );

      await service.chatEdit("mission-1", 0, "Same content", "user-1");

      expect(prisma.slidesMission.update).not.toHaveBeenCalled();
    });
  });

  describe("fixLayout", () => {
    it("should fix layout for a page using the layout fixer skill", async () => {
      (prisma.slidesMission.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockMission) // resolveMissionId for getPageHtml
        .mockResolvedValueOnce(mockMission) // actual mission fetch in getPageHtml
        .mockResolvedValueOnce(mockMission); // mission fetch in updatePageHtml

      layoutFixerSkill.execute.mockResolvedValueOnce({
        success: true,
        data: {
          originalHtml: "<html><body>Original content</body></html>",
          fixedHtml: "<html><body>Fixed content</body></html>",
          stats: {
            totalIssues: 3,
            fixedIssues: 3,
            criticalIssues: 1,
          },
        },
      } as any);

      (prisma.slidesMission.update as jest.Mock).mockResolvedValue(mockMission);

      const result = await service.fixLayout("mission-1", 0, "user-1");

      expect(result.success).toBe(true);
      expect(result.issuesFound).toBe(3);
      expect(result.issuesFixed).toBe(3);
      expect(result.criticalIssues).toBe(1);
      expect(layoutFixerSkill.execute).toHaveBeenCalled();
    });

    it("should throw InternalServerErrorException when layoutFixerSkill is unavailable", async () => {
      const moduleWithoutSkill: TestingModule = await Test.createTestingModule({
        providers: [
          AIEditService,
          { provide: PrismaService, useValue: prisma },
          { provide: ChatFacade, useValue: aiFacade },
          { provide: LayoutFixerSkill, useValue: null },
          { provide: ContentPolisherSkill, useValue: null },
          { provide: FactCheckerSkill, useValue: null },
        ],
      }).compile();

      const serviceNoSkill =
        moduleWithoutSkill.get<AIEditService>(AIEditService);

      await expect(
        serviceNoSkill.fixLayout("mission-1", 0, "user-1"),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it("should throw BadRequestException for negative page index", async () => {
      await expect(
        service.fixLayout("mission-1", -1, "user-1"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should return failure result when skill execution fails", async () => {
      (prisma.slidesMission.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockMission)
        .mockResolvedValueOnce(mockMission);

      layoutFixerSkill.execute.mockResolvedValueOnce({
        success: false,
        error: { message: "Skill failed", code: "SKILL_ERROR" },
      } as any);

      const result = await service.fixLayout("mission-1", 0, "user-1");

      expect(result.success).toBe(false);
      expect(result.issuesFound).toBe(0);
    });

    it("should not call update when fixed HTML is the same as original", async () => {
      const html = "<html><body>Original content</body></html>";
      (prisma.slidesMission.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockMission)
        .mockResolvedValueOnce(mockMission);

      layoutFixerSkill.execute.mockResolvedValueOnce({
        success: true,
        data: {
          originalHtml: html,
          fixedHtml: html, // Same HTML
          stats: { totalIssues: 0, fixedIssues: 0, criticalIssues: 0 },
        },
      } as any);

      await service.fixLayout("mission-1", 0, "user-1");

      expect(prisma.slidesMission.update).not.toHaveBeenCalled();
    });
  });

  describe("polishContent", () => {
    it("should polish all pages in a mission", async () => {
      (prisma.slidesMission.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockMission) // resolveMissionId for getPages
        .mockResolvedValueOnce(mockMission) // actual mission fetch in getPages
        .mockResolvedValueOnce(mockMission) // resolveMissionId for updatePageContent (page 0)
        .mockResolvedValueOnce(mockMission); // mission fetch in updatePageHtml for page 0

      contentPolisherSkill.execute.mockResolvedValueOnce({
        success: true,
        data: {
          pages: [
            { index: 0, title: "Page 1", content: "<html>Polished 1</html>" },
            { index: 1, title: "Page 2", content: "<html>Polished 2</html>" },
          ],
          stats: { pagesPolished: 2, totalChanges: 5 },
        },
      } as any);

      (prisma.slidesMission.update as jest.Mock).mockResolvedValue(mockMission);

      const result = await service.polishContent(
        "mission-1",
        { targetTone: "formal" },
        "user-1",
      );

      expect(result.success).toBe(true);
      expect(result.pagesPolished).toBe(2);
      expect(result.totalChanges).toBe(5);
      expect(contentPolisherSkill.execute).toHaveBeenCalled();
    });

    it("should throw InternalServerErrorException when contentPolisherSkill unavailable", async () => {
      const moduleNoSkill: TestingModule = await Test.createTestingModule({
        providers: [
          AIEditService,
          { provide: PrismaService, useValue: prisma },
          { provide: ChatFacade, useValue: aiFacade },
          { provide: LayoutFixerSkill, useValue: null },
          { provide: ContentPolisherSkill, useValue: null },
          { provide: FactCheckerSkill, useValue: null },
        ],
      }).compile();

      const serviceNoSkill = moduleNoSkill.get<AIEditService>(AIEditService);

      await expect(
        serviceNoSkill.polishContent("mission-1", {}, "user-1"),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it("should return failure result when skill execution fails", async () => {
      (prisma.slidesMission.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockMission)
        .mockResolvedValueOnce(mockMission);

      contentPolisherSkill.execute.mockResolvedValueOnce({
        success: false,
        error: { message: "Polish failed", code: "SKILL_ERROR" },
      } as any);

      const result = await service.polishContent("mission-1", {}, "user-1");

      expect(result.success).toBe(false);
      expect(result.pagesPolished).toBe(0);
    });
  });

  describe("factCheck", () => {
    it("should perform fact check on all pages", async () => {
      (prisma.slidesMission.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockMission)
        .mockResolvedValueOnce(mockMission);

      factCheckerSkill.execute.mockResolvedValueOnce({
        success: true,
        data: {
          summary: {
            totalClaims: 10,
            verifiedCount: 8,
            disputedCount: 1,
            needsCitationCount: 1,
            overallCredibility: 0.85,
          },
          results: [
            {
              pageIndex: 0,
              overallScore: 0.9,
              credibilityLevel: "high",
              claims: ["claim1", "claim2"],
            },
            {
              pageIndex: 1,
              overallScore: 0.7,
              credibilityLevel: "medium",
              claims: ["claim3"],
            },
          ],
        },
      } as any);

      const result = await service.factCheck("mission-1", false, "user-1");

      expect(result.success).toBe(true);
      expect(result.totalClaims).toBe(10);
      expect(result.verifiedCount).toBe(8);
      expect(result.overallCredibility).toBe(0.85);
      expect(result.pageResults).toHaveLength(2);
    });

    it("should throw InternalServerErrorException when factCheckerSkill unavailable", async () => {
      const moduleNoSkill: TestingModule = await Test.createTestingModule({
        providers: [
          AIEditService,
          { provide: PrismaService, useValue: prisma },
          { provide: ChatFacade, useValue: aiFacade },
          { provide: LayoutFixerSkill, useValue: null },
          { provide: ContentPolisherSkill, useValue: null },
          { provide: FactCheckerSkill, useValue: null },
        ],
      }).compile();

      const serviceNoSkill = moduleNoSkill.get<AIEditService>(AIEditService);

      await expect(
        serviceNoSkill.factCheck("mission-1", false, "user-1"),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it("should return failure result when skill execution fails", async () => {
      (prisma.slidesMission.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockMission)
        .mockResolvedValueOnce(mockMission);

      factCheckerSkill.execute.mockResolvedValueOnce({
        success: false,
        error: { message: "Fact check failed", code: "SKILL_ERROR" },
      } as any);

      const result = await service.factCheck("mission-1", false, "user-1");

      expect(result.success).toBe(false);
      expect(result.totalClaims).toBe(0);
      expect(result.pageResults).toHaveLength(0);
    });

    it("should pass strictMode to fact checker skill", async () => {
      (prisma.slidesMission.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockMission)
        .mockResolvedValueOnce(mockMission);

      factCheckerSkill.execute.mockResolvedValueOnce({
        success: true,
        data: {
          summary: {
            totalClaims: 0,
            verifiedCount: 0,
            disputedCount: 0,
            needsCitationCount: 0,
            overallCredibility: 1,
          },
          results: [],
        },
      } as any);

      await service.factCheck("mission-1", true, "user-1");

      expect(factCheckerSkill.execute).toHaveBeenCalledWith(
        expect.objectContaining({ strictMode: true }),
        expect.any(Object),
      );
    });
  });
});
