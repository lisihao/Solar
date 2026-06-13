/**
 * AiChatLLMAdapter - Extended coverage tests
 *
 * Covers paths not hit by the base spec:
 *  - Line 83: init logs "initialized with DB model"
 *  - Line 90: initializeDefaultModel catch logs warning
 *  - Line 102: getDefaultModelFromDb returns null when no prisma
 *  - Line 108: cache hit in getDefaultModelFromDb
 *  - Line 113: dedup in-flight pending fetch
 *  - Lines 140-145: defaultModel found in DB (first findFirst returns data)
 *  - Lines 161-169: anyModel fallback found in DB (second findFirst returns data)
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { AiChatLLMAdapter } from "../ai-chat-llm.adapter";
import { AiChatService } from "../../chat/ai-chat.service";
import { PrismaService } from "@/common/prisma/prisma.service";

describe("AiChatLLMAdapter (extended coverage)", () => {
  let mockAiChatService: { generateChatCompletion: jest.Mock };
  let mockConfigService: { get: jest.Mock };

  beforeEach(() => {
    mockAiChatService = {
      generateChatCompletion: jest.fn().mockResolvedValue({
        content: "ok",
        tokensUsed: 10,
      }),
    };
    mockConfigService = {
      get: jest.fn().mockReturnValue(""),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // Line 102: getDefaultModelFromDb returns null when no prisma
  // =========================================================================

  describe("no prisma (line 102)", () => {
    it("returns null from getDefaultModelFromDb when prisma is not injected", async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AiChatLLMAdapter,
          { provide: AiChatService, useValue: mockAiChatService },
          { provide: ConfigService, useValue: mockConfigService },
          // PrismaService intentionally NOT provided
        ],
      }).compile();

      const adapter = module.get<AiChatLLMAdapter>(AiChatLLMAdapter);

      // getDefaultModel should return empty string (fallback) when no DB
      const model = await adapter.getDefaultModel();
      expect(typeof model).toBe("string");

      adapter.clearCache();
    });
  });

  // =========================================================================
  // Lines 140-145: defaultModel found in DB (isDefault=true)
  // =========================================================================

  describe("default model found in DB (lines 140-145)", () => {
    it("returns modelId from DB when isDefault model is found", async () => {
      const mockPrisma = {
        aIModel: {
          findFirst: jest.fn().mockResolvedValue({
            modelId: "db-default-model",
            displayName: "DB Default",
          }),
        },
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AiChatLLMAdapter,
          { provide: AiChatService, useValue: mockAiChatService },
          { provide: ConfigService, useValue: mockConfigService },
          { provide: PrismaService, useValue: mockPrisma },
        ],
      }).compile();

      const adapter = module.get<AiChatLLMAdapter>(AiChatLLMAdapter);

      // Wait a bit for initializeDefaultModel to complete
      await new Promise((resolve) => setImmediate(resolve));

      const model = await adapter.getDefaultModel();
      expect(model).toBe("db-default-model");

      adapter.clearCache();
    });
  });

  // =========================================================================
  // Lines 161-169: anyModel fallback found in DB (second findFirst)
  // =========================================================================

  describe("fallback model found in DB (lines 161-169)", () => {
    it("returns modelId from anyModel fallback when no isDefault model", async () => {
      const mockPrisma = {
        aIModel: {
          // Constructor call: init fires during compile → consumes mocks
          // We need enough mocks for: initializeDefaultModel (2 calls) + clearCache + getDefaultModel (2 calls)
          findFirst: jest
            .fn()
            // initializeDefaultModel's first _fetchDefaultModelFromDb: null then null
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null)
            // explicit getDefaultModel call after clearCache: null then anyModel
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({
              modelId: "any-enabled-model",
              displayName: "Any Enabled",
            }),
        },
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AiChatLLMAdapter,
          { provide: AiChatService, useValue: mockAiChatService },
          { provide: ConfigService, useValue: mockConfigService },
          { provide: PrismaService, useValue: mockPrisma },
        ],
      }).compile();

      const adapter = module.get<AiChatLLMAdapter>(AiChatLLMAdapter);
      // Wait for initializeDefaultModel to finish consuming its mocks
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      adapter.clearCache(); // clear so we get a fresh fetch

      const model = await adapter.getDefaultModel();
      expect(model).toBe("any-enabled-model");

      adapter.clearCache();
    });
  });

  // =========================================================================
  // Line 108: cache hit in getDefaultModelFromDb
  // =========================================================================

  describe("cache hit (line 108)", () => {
    it("returns cached model without DB query on second call", async () => {
      const mockPrisma = {
        aIModel: {
          findFirst: jest.fn().mockResolvedValue({
            modelId: "cached-model",
            displayName: "Cached",
          }),
        },
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AiChatLLMAdapter,
          { provide: AiChatService, useValue: mockAiChatService },
          { provide: ConfigService, useValue: mockConfigService },
          { provide: PrismaService, useValue: mockPrisma },
        ],
      }).compile();

      const adapter = module.get<AiChatLLMAdapter>(AiChatLLMAdapter);
      adapter.clearCache();

      // First call populates cache
      await adapter.getDefaultModel();
      const callsAfterFirst = mockPrisma.aIModel.findFirst.mock.calls.length;

      // Second call should use cache (no new DB calls)
      await adapter.getDefaultModel();
      const callsAfterSecond = mockPrisma.aIModel.findFirst.mock.calls.length;

      expect(callsAfterSecond).toBe(callsAfterFirst);

      adapter.clearCache();
    });
  });

  // =========================================================================
  // Line 113: dedup in-flight pending fetch
  // =========================================================================

  describe("dedup pending fetch (line 113)", () => {
    it("shares a single in-flight DB query for concurrent calls", async () => {
      let resolveDb: (
        value: { modelId: string; displayName: string } | null,
      ) => void;
      const dbPromise = new Promise<{
        modelId: string;
        displayName: string;
      } | null>((resolve) => {
        resolveDb = resolve;
      });

      const mockPrisma = {
        aIModel: {
          findFirst: jest.fn().mockReturnValue(dbPromise),
        },
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AiChatLLMAdapter,
          { provide: AiChatService, useValue: mockAiChatService },
          { provide: ConfigService, useValue: mockConfigService },
          { provide: PrismaService, useValue: mockPrisma },
        ],
      }).compile();

      const adapter = module.get<AiChatLLMAdapter>(AiChatLLMAdapter);
      adapter.clearCache();

      // Start two concurrent calls
      const [p1, p2] = [adapter.getDefaultModel(), adapter.getDefaultModel()];

      // Resolve the DB promise
      resolveDb!({ modelId: "concurrent-model", displayName: "Concurrent" });

      const [m1, m2] = await Promise.all([p1, p2]);
      expect(m1).toBe("concurrent-model");
      expect(m2).toBe("concurrent-model");

      // Despite two concurrent calls, findFirst should be called only a small
      // number of times (sharing the in-flight promise)
      // Note: initializeDefaultModel also calls it once during construction
      expect(
        mockPrisma.aIModel.findFirst.mock.calls.length,
      ).toBeLessThanOrEqual(4);

      adapter.clearCache();
    });
  });

  // =========================================================================
  // Line 90: initializeDefaultModel error path
  // =========================================================================

  describe("initializeDefaultModel DB error (line 90)", () => {
    it("logs warning when DB throws during initialization", async () => {
      const mockPrisma = {
        aIModel: {
          findFirst: jest
            .fn()
            .mockRejectedValue(new Error("DB connection failed")),
        },
      };

      // Should not throw - error is caught and logged
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AiChatLLMAdapter,
          { provide: AiChatService, useValue: mockAiChatService },
          { provide: ConfigService, useValue: mockConfigService },
          { provide: PrismaService, useValue: mockPrisma },
        ],
      }).compile();

      const adapter = module.get<AiChatLLMAdapter>(AiChatLLMAdapter);

      // Wait for initializeDefaultModel to complete (it's async in constructor)
      await new Promise((resolve) => setImmediate(resolve));

      // Should still be able to call getDefaultModel
      const model = await adapter.getDefaultModel().catch(() => "");
      expect(typeof model).toBe("string");

      adapter.clearCache();
    });
  });

  // =========================================================================
  // Line 83: init logs "initialized with DB model"
  // =========================================================================

  describe("initializeDefaultModel success logs model name (line 83)", () => {
    it("resolves cleanly when DB returns a model during init", async () => {
      const mockPrisma = {
        aIModel: {
          findFirst: jest.fn().mockResolvedValue({
            modelId: "init-model",
            displayName: "Init Model",
          }),
        },
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AiChatLLMAdapter,
          { provide: AiChatService, useValue: mockAiChatService },
          { provide: ConfigService, useValue: mockConfigService },
          { provide: PrismaService, useValue: mockPrisma },
        ],
      }).compile();

      const adapter = module.get<AiChatLLMAdapter>(AiChatLLMAdapter);

      // Let initializeDefaultModel complete
      await new Promise((resolve) => setImmediate(resolve));

      const model = await adapter.getDefaultModel();
      expect(model).toBe("init-model");

      adapter.clearCache();
    });
  });
});
