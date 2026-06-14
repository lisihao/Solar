/**
 * CustomTeamsController Unit Tests
 *
 * Tests all CRUD endpoints: listAllTeams, listCustomTeams, listAvailableRoles,
 * getTeamById (including 404 path), createCustomTeam, updateCustomTeam, deleteCustomTeam.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { CustomTeamsController } from "../custom-teams.controller";
import { AiTeamsIntegrationService } from "../../services/integration";
import { JwtAuthGuard } from "../../../../../common/guards/jwt-auth.guard";
import {
  CreateCustomTeamDto,
  UpdateCustomTeamDto,
} from "../../dto/create-custom-team.dto";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface AuthenticatedRequest {
  user: { id: string; email: string };
}

function makeReq(
  userId = "user-1",
  email = "user@example.com",
): AuthenticatedRequest {
  return { user: { id: userId, email } };
}

// ---------------------------------------------------------------------------
// Mock
// ---------------------------------------------------------------------------

const mockIntegrationService = {
  listAllTeams: jest.fn(),
  listCustomTeams: jest.fn(),
  listAvailableRoles: jest.fn(),
  getTeamById: jest.fn(),
  createCustomTeam: jest.fn(),
  updateCustomTeam: jest.fn(),
  deleteCustomTeam: jest.fn(),
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("CustomTeamsController", () => {
  let controller: CustomTeamsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CustomTeamsController],
      providers: [
        {
          provide: AiTeamsIntegrationService,
          useValue: mockIntegrationService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CustomTeamsController>(CustomTeamsController);
    jest.clearAllMocks();
  });

  // =========================================================================
  // listAllTeams
  // =========================================================================

  describe("listAllTeams", () => {
    it("returns all teams from integrationService", async () => {
      const expected = [{ id: "team-1", name: "Research Team" }];
      mockIntegrationService.listAllTeams.mockReturnValue(expected);

      const result = await controller.listAllTeams();

      expect(mockIntegrationService.listAllTeams).toHaveBeenCalledTimes(1);
      expect(result).toBe(expected);
    });

    it("returns empty array when no teams available", async () => {
      mockIntegrationService.listAllTeams.mockReturnValue([]);

      const result = await controller.listAllTeams();

      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // listCustomTeams
  // =========================================================================

  describe("listCustomTeams", () => {
    it("returns custom teams from integrationService", async () => {
      const expected = [{ id: "custom-team-1", name: "My Custom Team" }];
      mockIntegrationService.listCustomTeams.mockReturnValue(expected);

      const result = await controller.listCustomTeams();

      expect(mockIntegrationService.listCustomTeams).toHaveBeenCalledTimes(1);
      expect(result).toBe(expected);
    });
  });

  // =========================================================================
  // listAvailableRoles
  // =========================================================================

  describe("listAvailableRoles", () => {
    it("returns available roles from integrationService", async () => {
      const expected = [{ id: "researcher", name: "Researcher" }];
      mockIntegrationService.listAvailableRoles.mockReturnValue(expected);

      const result = await controller.listAvailableRoles();

      expect(mockIntegrationService.listAvailableRoles).toHaveBeenCalledTimes(
        1,
      );
      expect(result).toBe(expected);
    });
  });

  // =========================================================================
  // getTeamById
  // =========================================================================

  describe("getTeamById", () => {
    it("returns the team when it exists", async () => {
      const expected = { id: "team-1", name: "Research Team" };
      mockIntegrationService.getTeamById.mockReturnValue(expected);

      const result = await controller.getTeamById("team-1");

      expect(mockIntegrationService.getTeamById).toHaveBeenCalledWith("team-1");
      expect(result).toBe(expected);
    });

    it("throws NotFoundException when team does not exist", async () => {
      mockIntegrationService.getTeamById.mockReturnValue(null);

      await expect(controller.getTeamById("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
      await expect(controller.getTeamById("nonexistent")).rejects.toThrow(
        "Team not found: nonexistent",
      );
    });

    it("throws NotFoundException when getTeamById returns undefined", async () => {
      mockIntegrationService.getTeamById.mockReturnValue(undefined);

      await expect(controller.getTeamById("missing-id")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // =========================================================================
  // createCustomTeam
  // =========================================================================

  describe("createCustomTeam", () => {
    it("delegates to integrationService.createCustomTeam and returns result", async () => {
      const dto: CreateCustomTeamDto = {
        name: "My Team",
        leaderRoleId: "researcher",
        memberRoles: [{ roleId: "analyst", minCount: 1, maxCount: 3 }],
      };
      const expected = { id: "custom-team-1", name: "My Team" };
      mockIntegrationService.createCustomTeam.mockReturnValue(expected);

      const result = await controller.createCustomTeam(makeReq(), dto);

      expect(mockIntegrationService.createCustomTeam).toHaveBeenCalledWith(dto);
      expect(result).toBe(expected);
    });

    it("logs creation with user id and team name", async () => {
      const dto: CreateCustomTeamDto = {
        name: "Alpha Team",
        leaderRoleId: "lead-researcher",
        memberRoles: [],
      };
      mockIntegrationService.createCustomTeam.mockReturnValue({
        id: "team-alpha",
      });

      // Should not throw even with logging
      await expect(
        controller.createCustomTeam(makeReq("user-42"), dto),
      ).resolves.toBeDefined();
    });
  });

  // =========================================================================
  // updateCustomTeam
  // =========================================================================

  describe("updateCustomTeam", () => {
    it("delegates to integrationService.updateCustomTeam with teamId and dto", async () => {
      const dto: UpdateCustomTeamDto = { name: "Updated Team Name" };
      const expected = { id: "team-1", name: "Updated Team Name" };
      mockIntegrationService.updateCustomTeam.mockReturnValue(expected);

      const result = await controller.updateCustomTeam(
        makeReq(),
        "team-1",
        dto,
      );

      expect(mockIntegrationService.updateCustomTeam).toHaveBeenCalledWith(
        "team-1",
        dto,
      );
      expect(result).toBe(expected);
    });

    it("passes partial updates correctly", async () => {
      const dto: UpdateCustomTeamDto = {
        description: "Updated description",
        availableTools: ["tool-1", "tool-2"],
      };
      mockIntegrationService.updateCustomTeam.mockReturnValue({
        id: "team-1",
        ...dto,
      });

      await controller.updateCustomTeam(makeReq("user-99"), "team-1", dto);

      expect(mockIntegrationService.updateCustomTeam).toHaveBeenCalledWith(
        "team-1",
        dto,
      );
    });
  });

  // =========================================================================
  // deleteCustomTeam
  // =========================================================================

  describe("deleteCustomTeam", () => {
    it("calls integrationService.deleteCustomTeam and returns teamId", async () => {
      mockIntegrationService.deleteCustomTeam.mockReturnValue(undefined);

      const result = await controller.deleteCustomTeam(makeReq(), "team-1");

      expect(mockIntegrationService.deleteCustomTeam).toHaveBeenCalledWith(
        "team-1",
      );
      expect(result).toEqual({ teamId: "team-1" });
    });

    it("returns the correct teamId in the response", async () => {
      mockIntegrationService.deleteCustomTeam.mockReturnValue(undefined);

      const result = await controller.deleteCustomTeam(
        makeReq("user-5"),
        "custom-team-abc",
      );

      expect(result).toEqual({ teamId: "custom-team-abc" });
    });
  });
});
