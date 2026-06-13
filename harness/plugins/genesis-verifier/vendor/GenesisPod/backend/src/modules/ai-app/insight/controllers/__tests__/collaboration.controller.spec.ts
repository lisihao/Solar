/**
 * CollaborationController Unit Tests
 *
 * Tests delegation to TopicCollaboratorService and TopicInsightsService,
 * plus the UnauthorizedException guard pattern used on every endpoint.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { UnauthorizedException } from "@nestjs/common";
import { CollaborationController } from "../collaboration.controller";
import { TopicInsightsService } from "../../topic-insights.service";
import { TopicCollaboratorService } from "../../services";
import { JwtAuthGuard } from "../../../../../common/guards/jwt-auth.guard";
import type { RequestWithUser } from "../../../../../common/types/express-request.types";
import { CollaboratorRole, TopicVisibility } from "../../dto/collaborator.dto";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(userId?: string): RequestWithUser {
  return { user: userId ? { id: userId } : undefined } as RequestWithUser;
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCollaboratorService = {
  getCollaborators: jest.fn(),
  addCollaborator: jest.fn(),
  updateCollaboratorRole: jest.fn(),
  removeCollaborator: jest.fn(),
  leaveProject: jest.fn(),
  requestToJoin: jest.fn(),
  getPendingApplications: jest.fn(),
  reviewApplication: jest.fn(),
  getMyApplicationStatus: jest.fn(),
};

const mockTopicInsightsService = {
  updateVisibility: jest.fn(),
  getSharingSettings: jest.fn(),
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("CollaborationController", () => {
  let controller: CollaborationController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CollaborationController],
      providers: [
        { provide: TopicInsightsService, useValue: mockTopicInsightsService },
        {
          provide: TopicCollaboratorService,
          useValue: mockCollaboratorService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CollaborationController>(CollaborationController);
    jest.clearAllMocks();
  });

  // =========================================================================
  // getCollaborators
  // =========================================================================

  describe("getCollaborators", () => {
    it("delegates to collaboratorService.getCollaborators with topicId and userId", async () => {
      const expected = { collaborators: [] };
      mockCollaboratorService.getCollaborators.mockResolvedValue(expected);

      const result = await controller.getCollaborators(
        makeReq("user-1"),
        "topic-1",
      );

      expect(mockCollaboratorService.getCollaborators).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
      );
      expect(result).toBe(expected);
    });

    it("throws UnauthorizedException when user is not authenticated", async () => {
      await expect(
        controller.getCollaborators(makeReq(), "topic-1"),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockCollaboratorService.getCollaborators).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // addCollaborator
  // =========================================================================

  describe("addCollaborator", () => {
    it("delegates to collaboratorService.addCollaborator with correct arguments", async () => {
      const dto = { email: "test@example.com", role: CollaboratorRole.EDITOR };
      const expected = { id: "collab-1" };
      mockCollaboratorService.addCollaborator.mockResolvedValue(expected);

      const result = await controller.addCollaborator(
        makeReq("user-1"),
        "topic-1",
        dto,
      );

      expect(mockCollaboratorService.addCollaborator).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        dto.email,
        dto.role,
      );
      expect(result).toBe(expected);
    });

    it("throws UnauthorizedException when user is missing", async () => {
      const dto = { email: "test@example.com", role: CollaboratorRole.VIEWER };
      await expect(
        controller.addCollaborator(makeReq(), "topic-1", dto),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // =========================================================================
  // updateCollaboratorRole
  // =========================================================================

  describe("updateCollaboratorRole", () => {
    it("delegates to collaboratorService.updateCollaboratorRole", async () => {
      const dto = { role: CollaboratorRole.ADMIN };
      const expected = { id: "collab-1", role: CollaboratorRole.ADMIN };
      mockCollaboratorService.updateCollaboratorRole.mockResolvedValue(
        expected,
      );

      const result = await controller.updateCollaboratorRole(
        makeReq("user-1"),
        "topic-1",
        "collab-1",
        dto,
      );

      expect(
        mockCollaboratorService.updateCollaboratorRole,
      ).toHaveBeenCalledWith("topic-1", "collab-1", "user-1", dto.role);
      expect(result).toBe(expected);
    });

    it("throws UnauthorizedException when user is missing", async () => {
      const dto = { role: CollaboratorRole.VIEWER };
      await expect(
        controller.updateCollaboratorRole(
          makeReq(),
          "topic-1",
          "collab-1",
          dto,
        ),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // =========================================================================
  // removeCollaborator
  // =========================================================================

  describe("removeCollaborator", () => {
    it("calls collaboratorService.removeCollaborator and returns undefined", async () => {
      mockCollaboratorService.removeCollaborator.mockResolvedValue(undefined);

      const result = await controller.removeCollaborator(
        makeReq("user-1"),
        "topic-1",
        "collab-1",
      );

      expect(mockCollaboratorService.removeCollaborator).toHaveBeenCalledWith(
        "topic-1",
        "collab-1",
        "user-1",
      );
      expect(result).toBeUndefined();
    });

    it("throws UnauthorizedException when user is missing", async () => {
      await expect(
        controller.removeCollaborator(makeReq(), "topic-1", "collab-1"),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // =========================================================================
  // leaveTopic
  // =========================================================================

  describe("leaveTopic", () => {
    it("calls collaboratorService.leaveProject and returns undefined", async () => {
      mockCollaboratorService.leaveProject.mockResolvedValue(undefined);

      const result = await controller.leaveTopic(makeReq("user-1"), "topic-1");

      expect(mockCollaboratorService.leaveProject).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
      );
      expect(result).toBeUndefined();
    });

    it("throws UnauthorizedException when user is missing", async () => {
      await expect(controller.leaveTopic(makeReq(), "topic-1")).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // =========================================================================
  // updateVisibility
  // =========================================================================

  describe("updateVisibility", () => {
    it("delegates to topicResearchService.updateVisibility", async () => {
      const dto = { visibility: TopicVisibility.SHARED };
      const expected = { id: "topic-1", visibility: TopicVisibility.SHARED };
      mockTopicInsightsService.updateVisibility.mockResolvedValue(expected);

      const result = await controller.updateVisibility(
        makeReq("user-1"),
        "topic-1",
        dto,
      );

      expect(mockTopicInsightsService.updateVisibility).toHaveBeenCalledWith(
        "user-1",
        "topic-1",
        dto.visibility,
      );
      expect(result).toBe(expected);
    });

    it("throws UnauthorizedException when user is missing", async () => {
      const dto = { visibility: TopicVisibility.PUBLIC };
      await expect(
        controller.updateVisibility(makeReq(), "topic-1", dto),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // =========================================================================
  // getSharingSettings
  // =========================================================================

  describe("getSharingSettings", () => {
    it("delegates to topicResearchService.getSharingSettings", async () => {
      const expected = {
        topicId: "topic-1",
        visibility: TopicVisibility.PRIVATE,
      };
      mockTopicInsightsService.getSharingSettings.mockResolvedValue(expected);

      const result = await controller.getSharingSettings(
        makeReq("user-1"),
        "topic-1",
      );

      expect(mockTopicInsightsService.getSharingSettings).toHaveBeenCalledWith(
        "user-1",
        "topic-1",
      );
      expect(result).toBe(expected);
    });

    it("throws UnauthorizedException when user is missing", async () => {
      await expect(
        controller.getSharingSettings(makeReq(), "topic-1"),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // =========================================================================
  // applyToJoin
  // =========================================================================

  describe("applyToJoin", () => {
    it("delegates to collaboratorService.requestToJoin with optional message", async () => {
      const dto = { message: "Please let me in" };
      const expected = { id: "application-1" };
      mockCollaboratorService.requestToJoin.mockResolvedValue(expected);

      const result = await controller.applyToJoin(
        makeReq("user-1"),
        "topic-1",
        dto,
      );

      expect(mockCollaboratorService.requestToJoin).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        dto.message,
      );
      expect(result).toBe(expected);
    });

    it("passes undefined message when not provided", async () => {
      const dto = {};
      mockCollaboratorService.requestToJoin.mockResolvedValue({
        id: "application-2",
      });

      await controller.applyToJoin(makeReq("user-1"), "topic-1", dto);

      expect(mockCollaboratorService.requestToJoin).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        undefined,
      );
    });

    it("throws UnauthorizedException when user is missing", async () => {
      await expect(
        controller.applyToJoin(makeReq(), "topic-1", {}),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // =========================================================================
  // getPendingApplications
  // =========================================================================

  describe("getPendingApplications", () => {
    it("delegates to collaboratorService.getPendingApplications", async () => {
      const expected = [{ id: "application-1" }];
      mockCollaboratorService.getPendingApplications.mockResolvedValue(
        expected,
      );

      const result = await controller.getPendingApplications(
        makeReq("user-1"),
        "topic-1",
      );

      expect(
        mockCollaboratorService.getPendingApplications,
      ).toHaveBeenCalledWith("topic-1", "user-1");
      expect(result).toBe(expected);
    });

    it("throws UnauthorizedException when user is missing", async () => {
      await expect(
        controller.getPendingApplications(makeReq(), "topic-1"),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // =========================================================================
  // reviewApplication
  // =========================================================================

  describe("reviewApplication", () => {
    it("delegates to collaboratorService.reviewApplication with all parameters", async () => {
      const dto = { decision: "ACCEPTED" as const, reason: undefined };
      const expected = { id: "application-1", decision: "ACCEPTED" };
      mockCollaboratorService.reviewApplication.mockResolvedValue(expected);

      const result = await controller.reviewApplication(
        makeReq("user-1"),
        "topic-1",
        "application-1",
        dto,
      );

      expect(mockCollaboratorService.reviewApplication).toHaveBeenCalledWith(
        "topic-1",
        "application-1",
        "user-1",
        dto.decision,
        dto.reason,
      );
      expect(result).toBe(expected);
    });

    it("passes rejection reason when provided", async () => {
      const dto = { decision: "REJECTED" as const, reason: "Not suitable" };
      mockCollaboratorService.reviewApplication.mockResolvedValue({});

      await controller.reviewApplication(
        makeReq("user-1"),
        "topic-1",
        "app-1",
        dto,
      );

      expect(mockCollaboratorService.reviewApplication).toHaveBeenCalledWith(
        "topic-1",
        "app-1",
        "user-1",
        "REJECTED",
        "Not suitable",
      );
    });

    it("throws UnauthorizedException when user is missing", async () => {
      const dto = { decision: "ACCEPTED" as const };
      await expect(
        controller.reviewApplication(makeReq(), "topic-1", "app-1", dto),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // =========================================================================
  // getMyApplicationStatus
  // =========================================================================

  describe("getMyApplicationStatus", () => {
    it("delegates to collaboratorService.getMyApplicationStatus", async () => {
      const expected = { status: "PENDING" };
      mockCollaboratorService.getMyApplicationStatus.mockResolvedValue(
        expected,
      );

      const result = await controller.getMyApplicationStatus(
        makeReq("user-1"),
        "topic-1",
      );

      expect(
        mockCollaboratorService.getMyApplicationStatus,
      ).toHaveBeenCalledWith("topic-1", "user-1");
      expect(result).toBe(expected);
    });

    it("returns null status when user has no application", async () => {
      const expected = { status: null };
      mockCollaboratorService.getMyApplicationStatus.mockResolvedValue(
        expected,
      );

      const result = await controller.getMyApplicationStatus(
        makeReq("user-1"),
        "topic-1",
      );

      expect(result).toEqual({ status: null });
    });

    it("throws UnauthorizedException when user is missing", async () => {
      await expect(
        controller.getMyApplicationStatus(makeReq(), "topic-1"),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
