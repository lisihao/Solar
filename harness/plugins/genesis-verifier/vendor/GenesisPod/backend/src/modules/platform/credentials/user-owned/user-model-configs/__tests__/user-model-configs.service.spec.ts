/**
 * UserModelConfigsService unit tests
 * Covers: create, update, delete, listByUser, listByUserAndProvider,
 *         findById, findByModelId, findDefaultForType, setDefault
 */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { AIModelType, Prisma } from "@prisma/client";
import { UserModelConfigsService } from "../user-model-configs.service";

// ---------------------------------------------------------------------------
// Mock Prisma client helper
// ---------------------------------------------------------------------------

function makeMockPrisma() {
  const tx = {
    userModelConfig: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  return {
    userModelConfig: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      delete: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    },
    userApiKey: {
      findFirst: jest.fn(),
    },
    aIProvider: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    $transaction: jest.fn().mockImplementation(async (cbOrArray: unknown) => {
      if (typeof cbOrArray === "function") {
        return cbOrArray(tx);
      }
      // Array transaction: resolve each promise
      return Promise.all(cbOrArray as Promise<unknown>[]);
    }),
    _tx: tx,
  };
}

type MockPrisma = ReturnType<typeof makeMockPrisma>;

// ---------------------------------------------------------------------------
// Sample model config data
// ---------------------------------------------------------------------------

const BASE_INPUT = {
  provider: "openai",
  modelId: "gpt-4o",
  displayName: "GPT-4o",
  modelType: AIModelType.CHAT,
};

const SAMPLE_CONFIG = {
  id: "cfg-1",
  userId: "user-1",
  ...BASE_INPUT,
  apiEndpoint: null,
  maxTokens: 4096,
  temperature: 0.7,
  embeddingDimensions: null,
  maxInputTokens: null,
  isReasoning: false,
  apiFormat: "openai",
  supportsTemperature: true,
  supportsStreaming: true,
  supportsFunctionCalling: true,
  supportsVision: false,
  tokenParamName: "max_tokens",
  defaultTimeoutMs: 120000,
  priority: 50,
  isEnabled: true,
  isDefault: false,
  description: null,
  priceInputPerMillion: null,
  priceOutputPerMillion: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("UserModelConfigsService", () => {
  let service: UserModelConfigsService;
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = makeMockPrisma();
    service = new UserModelConfigsService(
      prisma as unknown as Parameters<
        typeof UserModelConfigsService.prototype.constructor
      >[0],
    );
  });

  // ─── create ───────────────────────────────────────────────────────────────

  describe("create", () => {
    it("creates a model config with defaults applied", async () => {
      prisma._tx.userModelConfig.create.mockResolvedValueOnce(SAMPLE_CONFIG);
      const result = await service.create("user-1", BASE_INPUT);
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result).toEqual(SAMPLE_CONFIG);
    });

    it("throws BadRequestException when modelId is empty", async () => {
      await expect(
        service.create("user-1", { ...BASE_INPUT, modelId: "  " }),
      ).rejects.toThrow(BadRequestException);
    });

    it("defaults displayName to modelId when displayName missing", async () => {
      prisma._tx.userModelConfig.create.mockResolvedValueOnce(SAMPLE_CONFIG);
      const input = { ...BASE_INPUT, displayName: "" };
      // Should not throw — displayName defaults to modelId
      const result = await service.create("user-1", input);
      expect(result).toBeDefined();
    });

    it("throws BadRequestException for invalid provider name", async () => {
      await expect(
        service.create("user-1", {
          ...BASE_INPUT,
          provider: "INVALID PROVIDER",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException for provider name > 50 chars", async () => {
      await expect(
        service.create("user-1", {
          ...BASE_INPUT,
          provider: "a".repeat(51),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("clears other defaults before creating isDefault=true config", async () => {
      prisma._tx.userModelConfig.create.mockResolvedValueOnce({
        ...SAMPLE_CONFIG,
        isDefault: true,
      });
      await service.create("user-1", { ...BASE_INPUT, isDefault: true });
      // updateMany to clear existing defaults should have been called
      expect(prisma._tx.userModelConfig.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isDefault: true }),
          data: { isDefault: false },
        }),
      );
    });

    it("throws ConflictException on Prisma unique violation P2002", async () => {
      const p2002 = Object.assign(
        new Error("Unique constraint") as Prisma.PrismaClientKnownRequestError,
        { code: "P2002", clientVersion: "5.0.0", meta: {} },
      );
      Object.setPrototypeOf(
        p2002,
        Prisma.PrismaClientKnownRequestError.prototype,
      );
      prisma._tx.userModelConfig.create.mockRejectedValueOnce(p2002);
      await expect(service.create("user-1", BASE_INPUT)).rejects.toThrow(
        ConflictException,
      );
    });

    // ─── isReasoning 数据根因兜底（保存时 infer，让 DB 存对）─────────────────
    it("infers isReasoning=true for reasoning modelId when not explicitly set", async () => {
      prisma._tx.userModelConfig.create.mockResolvedValueOnce(SAMPLE_CONFIG);
      // gpt-5.4 是 OpenAI reasoning 模型（max_completion_tokens），用户没显式标 isReasoning
      await service.create("user-1", {
        ...BASE_INPUT,
        modelId: "gpt-5.4",
        isReasoning: undefined,
      });
      expect(prisma._tx.userModelConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isReasoning: true }),
        }),
      );
    });

    it("infers isReasoning=false for non-reasoning modelId when not set", async () => {
      prisma._tx.userModelConfig.create.mockResolvedValueOnce(SAMPLE_CONFIG);
      await service.create("user-1", {
        ...BASE_INPUT,
        modelId: "gpt-4o",
        isReasoning: undefined,
      });
      expect(prisma._tx.userModelConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isReasoning: false }),
        }),
      );
    });

    it("respects explicit isReasoning=false even for a reasoning modelId", async () => {
      prisma._tx.userModelConfig.create.mockResolvedValueOnce(SAMPLE_CONFIG);
      // 显式传 false 时尊重调用方，不被启发式覆盖
      await service.create("user-1", {
        ...BASE_INPUT,
        modelId: "gpt-5.4",
        isReasoning: false,
      });
      expect(prisma._tx.userModelConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isReasoning: false }),
        }),
      );
    });

    it("applies unknown-provider fallback to openai apiFormat", async () => {
      prisma._tx.userModelConfig.create.mockResolvedValueOnce(SAMPLE_CONFIG);
      // 'custom-llm' is not in PROVIDER_API_DEFAULTS → falls back to openai format
      const result = await service.create("user-1", {
        ...BASE_INPUT,
        provider: "custom-llm",
      });
      expect(result).toBeDefined();
    });

    // ─── apiKeyId 归属校验（IDOR 防护，2026-05-28）──────────────────────────
    it("throws BadRequest when apiKeyId is not owned by the user (IDOR)", async () => {
      prisma.userApiKey.findFirst.mockResolvedValueOnce(null); // 查不到归属当前用户的 key
      await expect(
        service.create("user-1", { ...BASE_INPUT, apiKeyId: "other-user-key" }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma._tx.userModelConfig.create).not.toHaveBeenCalled();
    });

    it("throws BadRequest when apiKeyId provider mismatches model provider", async () => {
      prisma.userApiKey.findFirst.mockResolvedValueOnce({
        provider: "anthropic",
      });
      await expect(
        service.create("user-1", {
          ...BASE_INPUT,
          provider: "openai",
          apiKeyId: "uak-anthropic",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("accepts apiKeyId owned by user with matching provider", async () => {
      prisma.userApiKey.findFirst.mockResolvedValueOnce({ provider: "openai" });
      prisma._tx.userModelConfig.create.mockResolvedValueOnce(SAMPLE_CONFIG);
      const result = await service.create("user-1", {
        ...BASE_INPUT,
        provider: "openai",
        apiKeyId: "uak-openai",
      });
      expect(result).toEqual(SAMPLE_CONFIG);
      expect(prisma.userApiKey.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "uak-openai", userId: "user-1" },
        }),
      );
    });
  });

  // ─── update ───────────────────────────────────────────────────────────────

  describe("update", () => {
    it("updates an existing config", async () => {
      prisma.userModelConfig.findUnique.mockResolvedValueOnce(SAMPLE_CONFIG);
      prisma._tx.userModelConfig.update.mockResolvedValueOnce({
        ...SAMPLE_CONFIG,
        displayName: "Updated",
      });
      const result = await service.update("user-1", "cfg-1", {
        displayName: "Updated",
      });
      expect(result.displayName).toBe("Updated");
    });

    it("throws NotFoundException when config not found", async () => {
      prisma.userModelConfig.findUnique.mockResolvedValueOnce(null);
      await expect(service.update("user-1", "bad-id", {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws NotFoundException when config belongs to another user", async () => {
      prisma.userModelConfig.findUnique.mockResolvedValueOnce({
        ...SAMPLE_CONFIG,
        userId: "other-user",
      });
      await expect(service.update("user-1", "cfg-1", {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it("clears other defaults when setting isDefault=true", async () => {
      prisma.userModelConfig.findUnique.mockResolvedValueOnce(SAMPLE_CONFIG);
      prisma._tx.userModelConfig.update.mockResolvedValueOnce({
        ...SAMPLE_CONFIG,
        isDefault: true,
      });
      await service.update("user-1", "cfg-1", { isDefault: true });
      expect(prisma._tx.userModelConfig.updateMany).toHaveBeenCalled();
    });

    it("throws ConflictException on P2002 unique violation", async () => {
      prisma.userModelConfig.findUnique.mockResolvedValueOnce(SAMPLE_CONFIG);
      const p2002 = Object.assign(
        new Error("Unique") as Prisma.PrismaClientKnownRequestError,
        { code: "P2002", clientVersion: "5.0.0", meta: {} },
      );
      Object.setPrototypeOf(
        p2002,
        Prisma.PrismaClientKnownRequestError.prototype,
      );
      prisma._tx.userModelConfig.update.mockRejectedValueOnce(p2002);
      await expect(
        service.update("user-1", "cfg-1", { modelId: "existing-model" }),
      ).rejects.toThrow(ConflictException);
    });

    it("updates various optional fields without error", async () => {
      prisma.userModelConfig.findUnique.mockResolvedValueOnce(SAMPLE_CONFIG);
      prisma._tx.userModelConfig.update.mockResolvedValueOnce(SAMPLE_CONFIG);
      await service.update("user-1", "cfg-1", {
        maxTokens: 8192,
        temperature: 0.5,
        isReasoning: true,
        apiFormat: "anthropic",
        supportsTemperature: false,
        supportsStreaming: false,
        supportsFunctionCalling: false,
        supportsVision: true,
        tokenParamName: "max_new_tokens",
        defaultTimeoutMs: 60000,
        priority: 100,
        isEnabled: false,
        description: "New desc",
        priceInputPerMillion: 1.5,
        priceOutputPerMillion: 3.0,
        embeddingDimensions: 1536,
        maxInputTokens: 8000,
        apiEndpoint: "https://api.example.com/v1",
        modelType: AIModelType.EMBEDDING,
      });
    });
  });

  // ─── delete ───────────────────────────────────────────────────────────────

  describe("delete", () => {
    it("deletes an existing config", async () => {
      prisma.userModelConfig.findUnique.mockResolvedValueOnce(SAMPLE_CONFIG);
      prisma.userModelConfig.delete.mockResolvedValueOnce({});
      const result = await service.delete("user-1", "cfg-1");
      expect(result).toEqual({ success: true });
    });

    it("throws NotFoundException when config does not exist", async () => {
      prisma.userModelConfig.findUnique.mockResolvedValueOnce(null);
      await expect(service.delete("user-1", "cfg-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws NotFoundException when userId does not match", async () => {
      prisma.userModelConfig.findUnique.mockResolvedValueOnce({
        ...SAMPLE_CONFIG,
        userId: "other",
      });
      await expect(service.delete("user-1", "cfg-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── listByUser ───────────────────────────────────────────────────────────

  describe("listByUser", () => {
    it("returns all configs for user", async () => {
      prisma.userModelConfig.findMany.mockResolvedValueOnce([SAMPLE_CONFIG]);
      const result = await service.listByUser("user-1");
      expect(result).toHaveLength(1);
      expect(prisma.userModelConfig.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: "user-1" } }),
      );
    });
  });

  // ─── listByUserAndProvider ────────────────────────────────────────────────

  describe("listByUserAndProvider", () => {
    it("filters by userId and provider (lowercased)", async () => {
      prisma.userModelConfig.findMany.mockResolvedValueOnce([SAMPLE_CONFIG]);
      await service.listByUserAndProvider("user-1", "OpenAI");
      expect(prisma.userModelConfig.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user-1", provider: "openai" },
        }),
      );
    });
  });

  // ─── findById ─────────────────────────────────────────────────────────────

  describe("findById", () => {
    it("returns config when found and userId matches", async () => {
      prisma.userModelConfig.findUnique.mockResolvedValueOnce(SAMPLE_CONFIG);
      const result = await service.findById("user-1", "cfg-1");
      expect(result).toEqual(SAMPLE_CONFIG);
    });

    it("returns null when config not found", async () => {
      prisma.userModelConfig.findUnique.mockResolvedValueOnce(null);
      expect(await service.findById("user-1", "cfg-1")).toBeNull();
    });

    it("returns null when userId mismatch", async () => {
      prisma.userModelConfig.findUnique.mockResolvedValueOnce({
        ...SAMPLE_CONFIG,
        userId: "other",
      });
      expect(await service.findById("user-1", "cfg-1")).toBeNull();
    });
  });

  // ─── findByModelId ────────────────────────────────────────────────────────

  describe("findByModelId", () => {
    it("returns matching enabled config", async () => {
      prisma.userModelConfig.findFirst.mockResolvedValueOnce(SAMPLE_CONFIG);
      const result = await service.findByModelId("user-1", "gpt-4o");
      expect(result).toEqual(SAMPLE_CONFIG);
      expect(prisma.userModelConfig.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user-1", modelId: "gpt-4o", isEnabled: true },
        }),
      );
    });

    it("returns null when not found", async () => {
      prisma.userModelConfig.findFirst.mockResolvedValueOnce(null);
      expect(await service.findByModelId("user-1", "unknown-model")).toBeNull();
    });
  });

  // ─── findDefaultForType ───────────────────────────────────────────────────

  describe("findDefaultForType", () => {
    it("returns the isDefault=true config when found", async () => {
      const defaultCfg = { ...SAMPLE_CONFIG, isDefault: true };
      prisma.userModelConfig.findFirst.mockResolvedValueOnce(defaultCfg);
      const result = await service.findDefaultForType(
        "user-1",
        AIModelType.CHAT,
      );
      expect(result).toEqual(defaultCfg);
    });

    it("falls back to highest-priority config when no isDefault", async () => {
      prisma.userModelConfig.findFirst
        .mockResolvedValueOnce(null) // no isDefault
        .mockResolvedValueOnce(SAMPLE_CONFIG); // fallback
      const result = await service.findDefaultForType(
        "user-1",
        AIModelType.CHAT,
      );
      expect(result).toEqual(SAMPLE_CONFIG);
      expect(prisma.userModelConfig.findFirst).toHaveBeenCalledTimes(2);
    });

    it("returns null when no config at all", async () => {
      prisma.userModelConfig.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      const result = await service.findDefaultForType(
        "user-1",
        AIModelType.EMBEDDING,
      );
      expect(result).toBeNull();
    });
  });

  // ─── setDefault ───────────────────────────────────────────────────────────

  describe("setDefault", () => {
    it("sets the specified config as default and enables it", async () => {
      prisma.userModelConfig.findUnique
        .mockResolvedValueOnce(SAMPLE_CONFIG) // initial findUnique
        .mockResolvedValueOnce({ ...SAMPLE_CONFIG, isDefault: true }); // after update
      const result = await service.setDefault("user-1", "cfg-1");
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result.isDefault).toBe(true);
    });

    it("throws NotFoundException when config not found", async () => {
      prisma.userModelConfig.findUnique.mockResolvedValueOnce(null);
      await expect(service.setDefault("user-1", "bad")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws NotFoundException when userId mismatch", async () => {
      prisma.userModelConfig.findUnique.mockResolvedValueOnce({
        ...SAMPLE_CONFIG,
        userId: "other-user",
      });
      await expect(service.setDefault("user-1", "cfg-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
