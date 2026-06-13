/**
 * SystemModelInventoryService 单元测试
 */
import { SystemModelInventoryService } from "../system-model-inventory.service";

describe("SystemModelInventoryService", () => {
  let service: SystemModelInventoryService;

  const mockPrisma = {
    aIModel: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    userModelConfig: {
      count: jest.fn(),
    },
    $queryRawUnsafe: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SystemModelInventoryService(mockPrisma as never);
  });

  describe("getInventory", () => {
    it("should return structured inventory data", async () => {
      // Arrange
      mockPrisma.aIModel.count
        .mockResolvedValueOnce(50) // totalModels
        .mockResolvedValueOnce(42); // enabledModels

      mockPrisma.aIModel.findMany.mockResolvedValueOnce([
        { provider: "openai" },
        { provider: "anthropic" },
        { provider: "google" },
      ]);

      mockPrisma.userModelConfig.count.mockResolvedValueOnce(120);

      // byTypeRaw
      // byProviderRaw
      // topModelsRaw
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([
          {
            model_type: "CHAT",
            total: BigInt(30),
            enabled: BigInt(25),
            providers: ["openai", "anthropic"],
          },
          {
            model_type: "EMBEDDING",
            total: BigInt(10),
            enabled: BigInt(8),
            providers: ["openai"],
          },
        ])
        .mockResolvedValueOnce([
          {
            provider: "openai",
            total: BigInt(20),
            enabled: BigInt(18),
            types: ["CHAT", "EMBEDDING"],
          },
        ])
        .mockResolvedValueOnce([
          {
            model_id: "gpt-4o",
            provider: "openai",
            model_type: "CHAT",
            user_count: BigInt(50),
          },
        ])
        .mockResolvedValueOnce([
          { model_id: "gpt-4o", calls: BigInt(1000), errors: BigInt(5) },
        ]);

      // Act
      const result = await service.getInventory();

      // Assert
      expect(result.summary.totalModels).toBe(50);
      expect(result.summary.enabledModels).toBe(42);
      expect(result.summary.distinctProviders).toBe(3);
      expect(result.summary.userConfiguredModels).toBe(120);
      expect(result.byType).toHaveLength(2);
      expect(result.byType[0].modelType).toBe("CHAT");
      expect(result.byType[0].total).toBe(30);
      expect(result.byProvider).toHaveLength(1);
      expect(result.byProvider[0].provider).toBe("openai");
      expect(result.topModels).toHaveLength(1);
      expect(result.topModels[0].modelId).toBe("gpt-4o");
      expect(result.topModels[0].callsLast24h).toBe(1000);
      expect(result.topModels[0].errorsLast24h).toBe(5);
      expect(result.generatedAt).toBeTruthy();
    });

    it("should handle model with no metrics (default 0)", async () => {
      mockPrisma.aIModel.count
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(5);
      mockPrisma.aIModel.findMany.mockResolvedValueOnce([
        { provider: "openai" },
      ]);
      mockPrisma.userModelConfig.count.mockResolvedValueOnce(0);
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            model_id: "unknown-model",
            provider: "test",
            model_type: "CHAT",
            user_count: BigInt(1),
          },
        ])
        .mockResolvedValueOnce([]); // no metrics for this model

      const result = await service.getInventory();
      expect(result.topModels[0].callsLast24h).toBe(0);
      expect(result.topModels[0].errorsLast24h).toBe(0);
    });

    it("should handle null providers in byTypeRaw", async () => {
      mockPrisma.aIModel.count
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(2);
      mockPrisma.aIModel.findMany.mockResolvedValueOnce([]);
      mockPrisma.userModelConfig.count.mockResolvedValueOnce(0);
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([
          {
            model_type: "CHAT",
            total: BigInt(2),
            enabled: BigInt(2),
            providers: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            provider: "openai",
            total: BigInt(2),
            enabled: BigInt(2),
            types: null,
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.getInventory();
      expect(result.byType[0].providers).toEqual([]);
      expect(result.byProvider[0].types).toEqual([]);
    });

    it("should include generatedAt timestamp", async () => {
      mockPrisma.aIModel.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      mockPrisma.aIModel.findMany.mockResolvedValueOnce([]);
      mockPrisma.userModelConfig.count.mockResolvedValueOnce(0);
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.getInventory();
      expect(new Date(result.generatedAt).getTime()).toBeGreaterThan(0);
    });
  });
});
