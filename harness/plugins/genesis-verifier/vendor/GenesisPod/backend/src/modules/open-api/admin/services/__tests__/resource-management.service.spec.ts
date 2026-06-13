import { Test, TestingModule } from "@nestjs/testing";
import { Logger, NotFoundException } from "@nestjs/common";
import { ResourceManagementService } from "../resource-management.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

describe("ResourceManagementService", () => {
  let service: ResourceManagementService;
  let mockPrisma: {
    resource: {
      findUnique: jest.Mock;
      delete: jest.Mock;
      deleteMany: jest.Mock;
    };
  };

  beforeEach(async () => {
    mockPrisma = {
      resource: {
        findUnique: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResourceManagementService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ResourceManagementService>(ResourceManagementService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ==================== deleteResource ====================

  describe("deleteResource", () => {
    it("should delete an existing resource and return success", async () => {
      // Arrange
      mockPrisma.resource.findUnique.mockResolvedValue({
        id: "res-1",
        title: "My Article",
      });
      mockPrisma.resource.delete.mockResolvedValue({ id: "res-1" });

      // Act
      const result = await service.deleteResource("res-1");

      // Assert
      expect(result.success).toBe(true);
      expect(result.message).toBe("Resource deleted successfully");
      expect(mockPrisma.resource.delete).toHaveBeenCalledWith({
        where: { id: "res-1" },
      });
    });

    it("should throw NotFoundException when resource does not exist", async () => {
      // Arrange
      mockPrisma.resource.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(service.deleteResource("ghost-id")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should call findUnique before deleting to verify existence", async () => {
      // Arrange
      mockPrisma.resource.findUnique.mockResolvedValue({
        id: "res-2",
        title: "Video",
      });
      mockPrisma.resource.delete.mockResolvedValue({ id: "res-2" });

      // Act
      await service.deleteResource("res-2");

      // Assert: findUnique is called first with the correct id
      expect(mockPrisma.resource.findUnique).toHaveBeenCalledWith({
        where: { id: "res-2" },
      });
      const findOrder =
        mockPrisma.resource.findUnique.mock.invocationCallOrder[0];
      const deleteOrder =
        mockPrisma.resource.delete.mock.invocationCallOrder[0];
      expect(findOrder).toBeLessThan(deleteOrder);
    });

    it("should log a message with the resource id and title on success", async () => {
      // Arrange
      mockPrisma.resource.findUnique.mockResolvedValue({
        id: "res-99",
        title: "Important Document",
      });
      mockPrisma.resource.delete.mockResolvedValue({});
      const logSpy = jest.spyOn(Logger.prototype, "log");

      // Act
      await service.deleteResource("res-99");

      // Assert: log was called and includes the resource id
      expect(logSpy).toHaveBeenCalled();
      const logMessage = logSpy.mock.calls[0][0] as string;
      expect(logMessage).toContain("res-99");
    });

    it("should not call delete when resource is not found", async () => {
      // Arrange
      mockPrisma.resource.findUnique.mockResolvedValue(null);

      // Act
      try {
        await service.deleteResource("nonexistent");
      } catch {
        // expected
      }

      // Assert
      expect(mockPrisma.resource.delete).not.toHaveBeenCalled();
    });
  });

  // ==================== deleteResources ====================

  describe("deleteResources", () => {
    it("should delete multiple resources and return count", async () => {
      // Arrange
      mockPrisma.resource.deleteMany.mockResolvedValue({ count: 3 });

      // Act
      const result = await service.deleteResources(["id-1", "id-2", "id-3"]);

      // Assert
      expect(result.success).toBe(true);
      expect(result.count).toBe(3);
      expect(result.message).toContain("3");
    });

    it("should call deleteMany with id.in filter", async () => {
      // Arrange
      mockPrisma.resource.deleteMany.mockResolvedValue({ count: 2 });
      const ids = ["id-a", "id-b"];

      // Act
      await service.deleteResources(ids);

      // Assert
      expect(mockPrisma.resource.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ids } },
      });
    });

    it("should return count=0 when none of the ids exist", async () => {
      // Arrange
      mockPrisma.resource.deleteMany.mockResolvedValue({ count: 0 });

      // Act
      const result = await service.deleteResources(["ghost-1", "ghost-2"]);

      // Assert
      expect(result.success).toBe(true);
      expect(result.count).toBe(0);
    });

    it("should handle empty array input gracefully", async () => {
      // Arrange
      mockPrisma.resource.deleteMany.mockResolvedValue({ count: 0 });

      // Act
      const result = await service.deleteResources([]);

      // Assert
      expect(result.success).toBe(true);
      expect(result.count).toBe(0);
      expect(mockPrisma.resource.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: [] } },
      });
    });

    it("should log the count of deleted resources", async () => {
      // Arrange
      mockPrisma.resource.deleteMany.mockResolvedValue({ count: 7 });
      const logSpy = jest.spyOn(Logger.prototype, "log");

      // Act
      await service.deleteResources(["a", "b", "c", "d", "e", "f", "g"]);

      // Assert
      expect(logSpy).toHaveBeenCalled();
      const logMessage = logSpy.mock.calls[0][0] as string;
      expect(logMessage).toContain("7");
    });

    it("should not call findUnique before batch deletion", async () => {
      // Arrange
      mockPrisma.resource.deleteMany.mockResolvedValue({ count: 1 });

      // Act
      await service.deleteResources(["id-1"]);

      // Assert: batch delete skips existence check
      expect(mockPrisma.resource.findUnique).not.toHaveBeenCalled();
    });
  });
});
