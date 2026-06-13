import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { CollectionRuleController } from "../collection-rule.controller";
import { CollectionRuleService } from "../../services/collection-rule.service";

jest.mock("../../services/collection-rule.service");

describe("CollectionRuleController", () => {
  let controller: CollectionRuleController;
  let mockService: jest.Mocked<CollectionRuleService>;

  const mockRule = {
    id: "rule-1",
    resourceType: "PAPER",
    cronExpression: "0 0 * * *",
    maxConcurrent: 5,
    timeout: 30000,
    filters: {},
    deduplicationStrategy: "url",
    minimumQualityScore: 0.8,
    priority: 1,
    description: "Test rule",
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CollectionRuleController],
      providers: [
        {
          provide: CollectionRuleService,
          useValue: {
            getAllRules: jest.fn(),
            getActiveRules: jest.fn(),
            getRule: jest.fn(),
            createRule: jest.fn(),
            updateRule: jest.fn(),
            deleteRule: jest.fn(),
            enableRule: jest.fn(),
            disableRule: jest.fn(),
            initializeDefaultRules: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<CollectionRuleController>(CollectionRuleController);
    mockService = module.get(CollectionRuleService);
  });

  // =========================================================================
  // getAllRules
  // =========================================================================

  describe("getAllRules", () => {
    it("should return all rules with count", async () => {
      mockService.getAllRules.mockResolvedValue([mockRule] as never);

      const result = await controller.getAllRules();

      expect(result).toEqual({ data: [mockRule], total: 1 });
    });

    it("should return empty when no rules", async () => {
      mockService.getAllRules.mockResolvedValue([] as never);

      const result = await controller.getAllRules();
      expect(result).toEqual({ data: [], total: 0 });
    });

    it("should throw BadRequestException on service error", async () => {
      mockService.getAllRules.mockRejectedValue(new Error("DB error"));

      await expect(controller.getAllRules()).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // =========================================================================
  // getActiveRules
  // =========================================================================

  describe("getActiveRules", () => {
    it("should return active rules with count", async () => {
      mockService.getActiveRules.mockResolvedValue([mockRule] as never);

      const result = await controller.getActiveRules();
      expect(result).toEqual({ data: [mockRule], total: 1 });
    });

    it("should throw BadRequestException on service error", async () => {
      mockService.getActiveRules.mockRejectedValue(new Error("Service error"));

      await expect(controller.getActiveRules()).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // =========================================================================
  // getRule
  // =========================================================================

  describe("getRule", () => {
    it("should return rule when found", async () => {
      mockService.getRule.mockResolvedValue(mockRule as never);

      const result = await controller.getRule("PAPER");
      expect(result).toEqual(mockRule);
    });

    it("should throw NotFoundException when rule not found", async () => {
      mockService.getRule.mockResolvedValue(null as never);

      await expect(controller.getRule("NONEXISTENT")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should rethrow NotFoundException", async () => {
      mockService.getRule.mockRejectedValue(
        new NotFoundException("Rule not found for PAPER"),
      );

      await expect(controller.getRule("PAPER")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw BadRequestException for generic service errors", async () => {
      mockService.getRule.mockRejectedValue(new Error("DB error"));

      await expect(controller.getRule("PAPER")).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // =========================================================================
  // createRule
  // =========================================================================

  describe("createRule", () => {
    it("should create rule successfully", async () => {
      mockService.createRule.mockResolvedValue(mockRule as never);

      const result = await controller.createRule({
        resourceType: "PAPER" as never,
      });

      expect(mockService.createRule).toHaveBeenCalledWith({
        resourceType: "PAPER",
      });
      expect(result).toEqual(mockRule);
    });

    it("should throw BadRequestException when resourceType is missing", async () => {
      await expect(
        controller.createRule({ resourceType: undefined as never }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should rethrow BadRequestException from service", async () => {
      mockService.createRule.mockRejectedValue(
        new BadRequestException("Invalid resource type"),
      );

      await expect(
        controller.createRule({ resourceType: "PAPER" as never }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should wrap generic errors in BadRequestException", async () => {
      mockService.createRule.mockRejectedValue(new Error("DB error"));

      await expect(
        controller.createRule({ resourceType: "PAPER" as never }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // =========================================================================
  // updateRule
  // =========================================================================

  describe("updateRule", () => {
    it("should update rule successfully", async () => {
      const updatedRule = { ...mockRule, maxConcurrent: 10 };
      mockService.updateRule.mockResolvedValue(updatedRule as never);

      const result = await controller.updateRule("PAPER", {
        maxConcurrent: 10,
      });

      expect(mockService.updateRule).toHaveBeenCalledWith("PAPER", {
        maxConcurrent: 10,
      });
      expect(result).toEqual(updatedRule);
    });

    it("should throw BadRequestException on service error", async () => {
      mockService.updateRule.mockRejectedValue(new Error("Update failed"));

      await expect(
        controller.updateRule("PAPER", { maxConcurrent: 10 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // =========================================================================
  // deleteRule
  // =========================================================================

  describe("deleteRule", () => {
    it("should delete rule and return success message", async () => {
      mockService.deleteRule.mockResolvedValue(undefined as never);

      const result = await controller.deleteRule("PAPER");

      expect(mockService.deleteRule).toHaveBeenCalledWith("PAPER");
      expect(result).toEqual({
        message: "Rule for PAPER deleted successfully",
      });
    });

    it("should throw BadRequestException on service error", async () => {
      mockService.deleteRule.mockRejectedValue(new Error("Delete failed"));

      await expect(controller.deleteRule("PAPER")).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // =========================================================================
  // enableRule
  // =========================================================================

  describe("enableRule", () => {
    it("should enable rule and return success response", async () => {
      const enabledRule = { ...mockRule, isActive: true };
      mockService.enableRule.mockResolvedValue(enabledRule as never);

      const result = await controller.enableRule("PAPER");

      expect(result).toEqual({
        data: enabledRule,
        message: "Rule for PAPER enabled successfully",
      });
    });

    it("should throw BadRequestException on service error", async () => {
      mockService.enableRule.mockRejectedValue(new Error("Enable failed"));

      await expect(controller.enableRule("PAPER")).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // =========================================================================
  // disableRule
  // =========================================================================

  describe("disableRule", () => {
    it("should disable rule and return success response", async () => {
      const disabledRule = { ...mockRule, isActive: false };
      mockService.disableRule.mockResolvedValue(disabledRule as never);

      const result = await controller.disableRule("PAPER");

      expect(result).toEqual({
        data: disabledRule,
        message: "Rule for PAPER disabled successfully",
      });
    });

    it("should throw BadRequestException on service error", async () => {
      mockService.disableRule.mockRejectedValue(new Error("Disable failed"));

      await expect(controller.disableRule("PAPER")).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // =========================================================================
  // initializeDefaults
  // =========================================================================

  describe("initializeDefaults", () => {
    it("should initialize default rules and return success message", async () => {
      mockService.initializeDefaultRules.mockResolvedValue(undefined as never);

      const result = await controller.initializeDefaults();

      expect(mockService.initializeDefaultRules).toHaveBeenCalled();
      expect(result).toEqual({
        message: "Default collection rules initialized successfully",
      });
    });

    it("should throw BadRequestException on service error", async () => {
      mockService.initializeDefaultRules.mockRejectedValue(
        new Error("Init failed"),
      );

      await expect(controller.initializeDefaults()).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
