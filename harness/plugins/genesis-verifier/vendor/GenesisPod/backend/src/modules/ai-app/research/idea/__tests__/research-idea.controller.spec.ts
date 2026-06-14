/**
 * ResearchIdeaController Unit Tests
 *
 * Tests all 6 endpoints:
 * - listIdeas (with/without type filter, with valid/invalid type values)
 * - createIdea
 * - updateIdea
 * - deleteIdea
 * - extractCreativeIdeas
 * - extractIdeas (from session)
 *
 * Each endpoint verifies the UnauthorizedException guard and correct
 * delegation to ResearchIdeaService.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { UnauthorizedException } from "@nestjs/common";
import { ResearchIdeaType } from "@prisma/client";
import { ResearchIdeaController } from "../research-idea.controller";
import { ResearchIdeaService } from "../research-idea.service";
import { JwtAuthGuard } from "../../../../../common/guards/jwt-auth.guard";
import type { RequestWithUser } from "../../../../../common/types/express-request.types";
import {
  CreateResearchIdeaDto,
  UpdateResearchIdeaDto,
  ResearchIdeaStatusDto,
} from "../research-idea.dto";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROJECT_ID = "550e8400-e29b-41d4-a716-446655440000";
const IDEA_ID = "660e8400-e29b-41d4-a716-446655440001";
const SESSION_ID = "770e8400-e29b-41d4-a716-446655440002";
const USER_ID = "user-1";

function makeReq(userId?: string): RequestWithUser {
  return { user: userId ? { id: userId } : undefined } as RequestWithUser;
}

// ---------------------------------------------------------------------------
// Mock
// ---------------------------------------------------------------------------

const mockIdeaService = {
  listByProject: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  extractCreativeIdeas: jest.fn(),
  extractFromSession: jest.fn(),
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("ResearchIdeaController", () => {
  let controller: ResearchIdeaController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ResearchIdeaController],
      providers: [{ provide: ResearchIdeaService, useValue: mockIdeaService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ResearchIdeaController>(ResearchIdeaController);
    jest.clearAllMocks();
  });

  // =========================================================================
  // listIdeas
  // =========================================================================

  describe("listIdeas", () => {
    it("delegates to ideaService.listByProject without type filter when type is omitted", async () => {
      const expected = [{ id: "idea-1" }];
      mockIdeaService.listByProject.mockResolvedValue(expected);

      const result = await controller.listIdeas(
        makeReq(USER_ID),
        PROJECT_ID,
        undefined,
      );

      expect(mockIdeaService.listByProject).toHaveBeenCalledWith(
        USER_ID,
        PROJECT_ID,
        undefined,
      );
      expect(result).toBe(expected);
    });

    it("passes a valid ResearchIdeaType to listByProject", async () => {
      const expected = [
        { id: "idea-1", type: ResearchIdeaType.RESEARCH_QUESTION },
      ];
      mockIdeaService.listByProject.mockResolvedValue(expected);

      const result = await controller.listIdeas(
        makeReq(USER_ID),
        PROJECT_ID,
        ResearchIdeaType.RESEARCH_QUESTION,
      );

      expect(mockIdeaService.listByProject).toHaveBeenCalledWith(
        USER_ID,
        PROJECT_ID,
        ResearchIdeaType.RESEARCH_QUESTION,
      );
      expect(result).toBe(expected);
    });

    it("passes undefined to listByProject when type string is not a valid ResearchIdeaType", async () => {
      mockIdeaService.listByProject.mockResolvedValue([]);

      await controller.listIdeas(makeReq(USER_ID), PROJECT_ID, "INVALID_TYPE");

      expect(mockIdeaService.listByProject).toHaveBeenCalledWith(
        USER_ID,
        PROJECT_ID,
        undefined,
      );
    });

    it("throws UnauthorizedException when user is not authenticated", async () => {
      await expect(
        controller.listIdeas(makeReq(), PROJECT_ID, undefined),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockIdeaService.listByProject).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // createIdea
  // =========================================================================

  describe("createIdea", () => {
    it("delegates to ideaService.create with userId, projectId, and dto", async () => {
      const dto: CreateResearchIdeaDto = {
        title: "New Research Angle",
        description: "Explore the impact of AI on research",
        tags: ["AI", "research"],
      };
      const expected = { id: "idea-new", ...dto };
      mockIdeaService.create.mockResolvedValue(expected);

      const result = await controller.createIdea(
        makeReq(USER_ID),
        PROJECT_ID,
        dto,
      );

      expect(mockIdeaService.create).toHaveBeenCalledWith(
        USER_ID,
        PROJECT_ID,
        dto,
      );
      expect(result).toBe(expected);
    });

    it("passes through minimal dto (only required fields)", async () => {
      const dto: CreateResearchIdeaDto = {
        title: "Minimal Idea",
        description: "Just the basics",
      };
      mockIdeaService.create.mockResolvedValue({ id: "idea-min" });

      await controller.createIdea(makeReq(USER_ID), PROJECT_ID, dto);

      expect(mockIdeaService.create).toHaveBeenCalledWith(
        USER_ID,
        PROJECT_ID,
        dto,
      );
    });

    it("throws UnauthorizedException when user is not authenticated", async () => {
      const dto: CreateResearchIdeaDto = { title: "T", description: "D" };
      await expect(
        controller.createIdea(makeReq(), PROJECT_ID, dto),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // =========================================================================
  // updateIdea
  // =========================================================================

  describe("updateIdea", () => {
    it("delegates to ideaService.update with userId, projectId, ideaId, and dto", async () => {
      const dto: UpdateResearchIdeaDto = {
        title: "Updated Title",
        status: ResearchIdeaStatusDto.STARRED,
      };
      const expected = { id: IDEA_ID, ...dto };
      mockIdeaService.update.mockResolvedValue(expected);

      const result = await controller.updateIdea(
        makeReq(USER_ID),
        PROJECT_ID,
        IDEA_ID,
        dto,
      );

      expect(mockIdeaService.update).toHaveBeenCalledWith(
        USER_ID,
        PROJECT_ID,
        IDEA_ID,
        dto,
      );
      expect(result).toBe(expected);
    });

    it("passes partial update dto correctly", async () => {
      const dto: UpdateResearchIdeaDto = { tags: ["tag-a", "tag-b"] };
      mockIdeaService.update.mockResolvedValue({ id: IDEA_ID });

      await controller.updateIdea(makeReq(USER_ID), PROJECT_ID, IDEA_ID, dto);

      expect(mockIdeaService.update).toHaveBeenCalledWith(
        USER_ID,
        PROJECT_ID,
        IDEA_ID,
        dto,
      );
    });

    it("throws UnauthorizedException when user is not authenticated", async () => {
      const dto: UpdateResearchIdeaDto = { title: "T" };
      await expect(
        controller.updateIdea(makeReq(), PROJECT_ID, IDEA_ID, dto),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // =========================================================================
  // deleteIdea
  // =========================================================================

  describe("deleteIdea", () => {
    it("delegates to ideaService.delete and returns { deleted: true }", async () => {
      mockIdeaService.delete.mockResolvedValue(undefined);

      const result = await controller.deleteIdea(
        makeReq(USER_ID),
        PROJECT_ID,
        IDEA_ID,
      );

      expect(mockIdeaService.delete).toHaveBeenCalledWith(
        USER_ID,
        PROJECT_ID,
        IDEA_ID,
      );
      expect(result).toEqual({ deleted: true });
    });

    it("throws UnauthorizedException when user is not authenticated", async () => {
      await expect(
        controller.deleteIdea(makeReq(), PROJECT_ID, IDEA_ID),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockIdeaService.delete).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // extractCreativeIdeas
  // =========================================================================

  describe("extractCreativeIdeas", () => {
    it("delegates to ideaService.extractCreativeIdeas with userId and projectId", async () => {
      const expected = [{ id: "idea-creative-1" }, { id: "idea-creative-2" }];
      mockIdeaService.extractCreativeIdeas.mockResolvedValue(expected);

      const result = await controller.extractCreativeIdeas(
        makeReq(USER_ID),
        PROJECT_ID,
      );

      expect(mockIdeaService.extractCreativeIdeas).toHaveBeenCalledWith(
        USER_ID,
        PROJECT_ID,
      );
      expect(result).toBe(expected);
    });

    it("throws UnauthorizedException when user is not authenticated", async () => {
      await expect(
        controller.extractCreativeIdeas(makeReq(), PROJECT_ID),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockIdeaService.extractCreativeIdeas).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // extractIdeas (from session)
  // =========================================================================

  describe("extractIdeas", () => {
    it("delegates to ideaService.extractFromSession with userId, projectId, and sessionId", async () => {
      const expected = [{ id: "idea-extracted-1" }];
      mockIdeaService.extractFromSession.mockResolvedValue(expected);

      const result = await controller.extractIdeas(
        makeReq(USER_ID),
        PROJECT_ID,
        SESSION_ID,
      );

      expect(mockIdeaService.extractFromSession).toHaveBeenCalledWith(
        USER_ID,
        PROJECT_ID,
        SESSION_ID,
      );
      expect(result).toBe(expected);
    });

    it("throws UnauthorizedException when user is not authenticated", async () => {
      await expect(
        controller.extractIdeas(makeReq(), PROJECT_ID, SESSION_ID),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockIdeaService.extractFromSession).not.toHaveBeenCalled();
    });
  });
});
