/**
 * SlidesController Unit Tests
 *
 * Tests for authentication, authorization, rate limiting, and DTO validation.
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { Test, TestingModule } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";

import { SlidesController } from "../../orchestrator/slides.controller";
import { SlidesEngineService } from "../../services/slides-engine.service";
import { SlidesDataImportService } from "../../services/data-import.service";
import { AIEditService } from "../../services/ai-edit.service";
import { SlidesCheckpointService } from "../../checkpoint/checkpoint.service";
import { VoiceNarrationSkill } from "../../skills/voice-narration.skill";
import { PrismaService } from "@/common/prisma/prisma.service";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import {
  RateLimitGuard,
  RATE_LIMIT_KEY,
} from "@/common/guards/rate-limit.guard";

import {
  mockAuthenticatedRequest,
  mockSession,
  mockSessions,
  mockUserId,
} from "../fixtures/slides.fixture";

describe("SlidesController", () => {
  let controller: SlidesController;
  let checkpointService: jest.Mocked<SlidesCheckpointService>;
  let dataImportService: jest.Mocked<SlidesDataImportService>;
  let aiEditService: jest.Mocked<AIEditService>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prismaService: any;

  beforeEach(async () => {
    // Create mock services
    const mockSlidesEngine = {
      generateSlides: jest.fn(),
      rerenderPage: jest.fn(),
    };

    const mockCheckpointService = {
      getSessions: jest.fn(),
      getSession: jest.fn(),
      createSession: jest.fn(),
      updateSessionTitle: jest.fn(),
      deleteSession: jest.fn(),
      getLatestCheckpoint: jest.fn(),
      list: jest.fn(),
      create: jest.fn(),
      restore: jest.fn(),
    };

    const mockDataImportService = {
      listResearchTopics: jest.fn(),
      listWritingProjects: jest.fn(),
      listTeamsTopics: jest.fn(),
      listLibraryResources: jest.fn(),
      importFromResearch: jest.fn(),
      importFromWriting: jest.fn(),
      importFromTeams: jest.fn(),
      importFromLibrary: jest.fn(),
    };

    const mockAiEditService = {
      fixLayout: jest.fn(),
      polishContent: jest.fn(),
      factCheck: jest.fn(),
    };

    const mockVoiceNarrationSkill = {};

    const mockPrismaService = {
      slidesMission: {
        findMany: jest.fn(() => Promise.resolve([])),
        findFirst: jest.fn(() => Promise.resolve(null)),
        findUnique: jest.fn(() => Promise.resolve(null)),
        updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
        update: jest.fn(() => Promise.resolve(null)),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SlidesController],
      providers: [
        { provide: SlidesEngineService, useValue: mockSlidesEngine },
        { provide: SlidesCheckpointService, useValue: mockCheckpointService },
        { provide: SlidesDataImportService, useValue: mockDataImportService },
        { provide: AIEditService, useValue: mockAiEditService },
        { provide: VoiceNarrationSkill, useValue: mockVoiceNarrationSkill },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: Reflector, useValue: new Reflector() },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(RateLimitGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get<SlidesController>(SlidesController);
    checkpointService = module.get(SlidesCheckpointService);
    dataImportService = module.get(SlidesDataImportService);
    aiEditService = module.get(AIEditService);
    prismaService = module.get(PrismaService);
  });

  describe("Authentication", () => {
    it("should have JwtAuthGuard applied to the controller", () => {
      const guards = Reflect.getMetadata("__guards__", SlidesController);
      expect(guards).toBeDefined();
      expect(
        guards.some(
          (guard: unknown) =>
            (guard as { name?: string }) === JwtAuthGuard ||
            (guard as { name?: string }).name === "JwtAuthGuard",
        ),
      ).toBe(true);
    });

    it("should have RateLimitGuard applied to the controller", () => {
      const guards = Reflect.getMetadata("__guards__", SlidesController);
      expect(guards).toBeDefined();
      expect(
        guards.some(
          (guard: unknown) =>
            (guard as { name?: string }) === RateLimitGuard ||
            (guard as { name?: string }).name === "RateLimitGuard",
        ),
      ).toBe(true);
    });
  });

  describe("getSessions", () => {
    it("should get sessions for authenticated user", async () => {
      checkpointService.getSessions.mockResolvedValue(mockSessions as any);

      const result = await controller.getSessions(
        mockAuthenticatedRequest as any,
        undefined,
        undefined,
      );

      expect(checkpointService.getSessions).toHaveBeenCalledWith({
        userId: mockUserId,
        status: undefined,
        limit: 50,
      });
      expect((result as any).sessions).toHaveLength(mockSessions.length);
    });

    it("should filter sessions by status", async () => {
      checkpointService.getSessions.mockResolvedValue([mockSession] as any);

      await controller.getSessions(
        mockAuthenticatedRequest as any,
        "active",
        "10",
      );

      expect(checkpointService.getSessions).toHaveBeenCalledWith({
        userId: mockUserId,
        status: "active",
        limit: 10,
      });
    });

    it("should attach sourceSubscription to matching session and null for unmatched", async () => {
      const mockSub = {
        type: "topic-insights",
        sourceId: "topic-1",
        isStale: false,
      };
      checkpointService.getSessions.mockResolvedValue(mockSessions as any);
      checkpointService.getLatestCheckpoint.mockResolvedValue(null as any);
      // session-1 has a subscription; session-2 does not
      prismaService.slidesMission.findMany.mockImplementation(() =>
        Promise.resolve([
          { sessionId: "session-1", sourceSubscription: mockSub },
        ]),
      );

      const result = await controller.getSessions(
        mockAuthenticatedRequest as any,
        undefined,
        undefined,
      );

      const sessions = (result as any).sessions as Array<{
        id: string;
        sourceSubscription: unknown;
      }>;
      const s1 = sessions.find((s) => s.id === "session-1");
      const s2 = sessions.find((s) => s.id === "session-2");
      expect(s1?.sourceSubscription).toEqual(mockSub);
      expect(s2?.sourceSubscription).toBeNull();
    });

    it("should return null sourceSubscription for all sessions when no missions exist", async () => {
      checkpointService.getSessions.mockResolvedValue(mockSessions as any);
      checkpointService.getLatestCheckpoint.mockResolvedValue(null as any);
      prismaService.slidesMission.findMany.mockImplementation(() =>
        Promise.resolve([]),
      );

      const result = await controller.getSessions(
        mockAuthenticatedRequest as any,
        undefined,
        undefined,
      );

      const sessions = (result as any).sessions as Array<{
        sourceSubscription: unknown;
      }>;
      expect(sessions.every((s) => s.sourceSubscription === null)).toBe(true);
    });
  });

  describe("listResearchSources", () => {
    it("should list research sources for authenticated user", async () => {
      const mockSources = [{ id: "topic-1", title: "Research 1" }];
      dataImportService.listResearchTopics.mockResolvedValue(
        mockSources as any,
      );

      const result = await controller.listResearchSources(
        mockAuthenticatedRequest as any,
      );

      expect(dataImportService.listResearchTopics).toHaveBeenCalledWith(
        mockUserId,
      );
      expect(result).toEqual({ sources: mockSources });
    });
  });

  describe("importFromResearch", () => {
    it("should import from research with authenticated user", async () => {
      const mockData = { sourceText: "content", sections: [] };
      dataImportService.importFromResearch.mockResolvedValue(mockData as any);

      const result = await controller.importFromResearch(
        mockAuthenticatedRequest as any,
        "topic-123",
      );

      expect(dataImportService.importFromResearch).toHaveBeenCalledWith(
        "topic-123",
        mockUserId,
      );
      expect(result).toEqual({ data: mockData });
    });
  });

  describe("fixLayout", () => {
    it("should fix layout with authenticated user", async () => {
      const mockResult = {
        success: true,
        originalHtml: "<div>old</div>",
        fixedHtml: "<div>new</div>",
        issuesFound: 2,
        issuesFixed: 2,
        criticalIssues: 0,
      };
      aiEditService.fixLayout.mockResolvedValue(mockResult);

      const result = await controller.fixLayout(
        mockAuthenticatedRequest as any,
        "mission-123",
        "0",
      );

      expect(aiEditService.fixLayout).toHaveBeenCalledWith(
        "mission-123",
        0,
        mockUserId,
      );
      expect(result).toEqual({ data: mockResult });
    });
  });

  describe("polishContent", () => {
    it("should polish content with authenticated user", async () => {
      const mockResult = {
        success: true,
        pagesPolished: 5,
        totalChanges: 10,
        pages: [],
      };
      aiEditService.polishContent.mockResolvedValue(mockResult);

      const result = await controller.polishContent(
        mockAuthenticatedRequest as any,
        "mission-123",
        { targetTone: "formal" },
      );

      expect(aiEditService.polishContent).toHaveBeenCalledWith(
        "mission-123",
        { targetTone: "formal" },
        mockUserId,
      );
      expect(result).toEqual({ data: mockResult });
    });
  });

  describe("factCheck", () => {
    it("should fact check with authenticated user", async () => {
      const mockResult = {
        success: true,
        totalClaims: 10,
        verifiedCount: 8,
        disputedCount: 1,
        needsCitationCount: 1,
        overallCredibility: 0.85,
        pageResults: [],
      };
      aiEditService.factCheck.mockResolvedValue(mockResult);

      const result = await controller.factCheck(
        mockAuthenticatedRequest as any,
        "mission-123",
        "true",
      );

      expect(aiEditService.factCheck).toHaveBeenCalledWith(
        "mission-123",
        true,
        mockUserId,
      );
      expect(result).toEqual({ data: mockResult });
    });

    it("should default to non-strict mode when strictMode is undefined", async () => {
      const mockResult = {
        success: true,
        totalClaims: 10,
        verifiedCount: 8,
        disputedCount: 1,
        needsCitationCount: 1,
        overallCredibility: 0.85,
        pageResults: [],
      };
      aiEditService.factCheck.mockResolvedValue(mockResult);

      await controller.factCheck(
        mockAuthenticatedRequest as any,
        "mission-123",
        undefined,
      );

      expect(aiEditService.factCheck).toHaveBeenCalledWith(
        "mission-123",
        false,
        mockUserId,
      );
    });
  });

  describe("Rate Limiting", () => {
    it("should have rate limit metadata on generateSlidesPost", () => {
      const metadata = Reflect.getMetadata(
        RATE_LIMIT_KEY,
        SlidesController.prototype.generateSlidesPost,
      );
      expect(metadata).toBeDefined();
      expect(metadata.maxRequests).toBe(10);
      expect(metadata.windowSeconds).toBe(60);
    });

    it("should have rate limit metadata on fixLayout", () => {
      const metadata = Reflect.getMetadata(
        RATE_LIMIT_KEY,
        SlidesController.prototype.fixLayout,
      );
      expect(metadata).toBeDefined();
      expect(metadata.maxRequests).toBe(30);
      expect(metadata.windowSeconds).toBe(60);
    });

    it("should have rate limit metadata on factCheck", () => {
      const metadata = Reflect.getMetadata(
        RATE_LIMIT_KEY,
        SlidesController.prototype.factCheck,
      );
      expect(metadata).toBeDefined();
      expect(metadata.maxRequests).toBe(10);
      expect(metadata.windowSeconds).toBe(60);
    });
  });
});
