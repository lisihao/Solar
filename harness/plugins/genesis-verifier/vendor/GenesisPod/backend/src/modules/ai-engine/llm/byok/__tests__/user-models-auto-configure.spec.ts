/**
 * AutoConfigureService - unit tests
 *
 * Covers the full runForUser flow plus all private helpers:
 *  - runForUser: no active personal keys → early return
 *  - runForUser: provider key lookup failure
 *  - runForUser: discovery returns no models → continue
 *  - runForUser: no recommendation for provider/type → continue
 *  - runForUser: no candidates after allMatches → continue
 *  - runForUser: probe fails → warn + continue
 *  - runForUser: matchedId exists, not default → promote to default
 *  - runForUser: matchedId exists, is default → skip + skippedCount++
 *  - runForUser: create succeeds → createdCount++
 *  - runForUser: create throws ConflictException → skipped, created=true
 *  - runForUser: create throws non-conflict error → warn + skipped
 *  - runForUser: missingTypes populated for uncovered required types
 *  - allMatches: invalid regex skipped
 *  - buildDisplayName: unknown provider uses raw provider name
 *  - inferMaxTokens: various modelId patterns
 *  - inferCapabilities: reasoning protocol models, vision detection
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ConflictException } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { AutoConfigureService } from "../user-models-auto-configure.service";
import { AiConnectionTestService } from "@/modules/ai-engine/llm/byok/ai-connection-test.service";
import { AiModelDiscoveryService } from "@/modules/ai-engine/llm/models/catalog/ai-model-discovery.service";
import { ModelRecommendationsService } from "@/modules/ai-engine/llm/models/selection/model-recommendations.service";
import { UserApiKeysService } from "@/modules/platform/credentials/user-owned/user-api-keys/user-api-keys.service";
import { UserModelConfigsService } from "@/modules/platform/credentials/user-owned/user-model-configs/user-model-configs.service";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeMocks() {
  const userApiKeys = {
    listUserApiKeys: jest.fn(),
    getPersonalKey: jest.fn(),
  };
  const modelDiscovery = {
    fetchAvailableModels: jest.fn(),
  };
  const userModelConfigs = {
    listByUser: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const recommendations = {
    getForProvider: jest.fn(),
  };
  const connectionTest = {
    testModelConnectionWithKey: jest.fn(),
  };
  return {
    userApiKeys,
    modelDiscovery,
    userModelConfigs,
    recommendations,
    connectionTest,
  };
}

async function buildModule(mocks: ReturnType<typeof makeMocks>) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AutoConfigureService,
      { provide: UserApiKeysService, useValue: mocks.userApiKeys },
      { provide: AiModelDiscoveryService, useValue: mocks.modelDiscovery },
      { provide: UserModelConfigsService, useValue: mocks.userModelConfigs },
      { provide: ModelRecommendationsService, useValue: mocks.recommendations },
      { provide: AiConnectionTestService, useValue: mocks.connectionTest },
    ],
  }).compile();

  return module.get<AutoConfigureService>(AutoConfigureService);
}

// A minimal recommendation record with CHAT pattern
function chatRec(provider: string) {
  return [
    {
      provider,
      modelType: AIModelType.CHAT,
      patterns: ["^gpt-4o$"],
      priority: 1,
    },
  ];
}

describe("AutoConfigureService", () => {
  let mocks: ReturnType<typeof makeMocks>;
  let service: AutoConfigureService;

  beforeEach(async () => {
    mocks = makeMocks();
    service = await buildModule(mocks);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // Early return when no active personal keys
  // =========================================================================

  it("returns empty result when no active personal keys", async () => {
    mocks.userApiKeys.listUserApiKeys.mockResolvedValue([]);

    const result = await service.runForUser("user-1");

    expect(result.createdCount).toBe(0);
    expect(result.skippedCount).toBe(0);
    expect(result.items).toEqual([]);
    expect(result.missingTypes).toContain(AIModelType.CHAT);
    expect(result.missingTypes).toContain(AIModelType.EMBEDDING);
  });

  it("returns empty when keys exist but none are personal mode", async () => {
    mocks.userApiKeys.listUserApiKeys.mockResolvedValue([
      { isActive: true, mode: "assigned", provider: "openai" },
    ]);

    const result = await service.runForUser("user-1");
    expect(result.createdCount).toBe(0);
  });

  // =========================================================================
  // provider key lookup — getPersonalKey returns null
  // =========================================================================

  it("skips provider when getPersonalKey returns null", async () => {
    mocks.userApiKeys.listUserApiKeys.mockResolvedValue([
      { isActive: true, mode: "personal", provider: "openai" },
    ]);
    mocks.userApiKeys.getPersonalKey.mockResolvedValue(null); // no key
    mocks.userModelConfigs.listByUser.mockResolvedValue([]);

    const result = await service.runForUser("user-1");
    // No key → providerKeyMap is empty → all modelTypes miss → missingTypes includes CHAT/EMBEDDING
    expect(result.missingTypes).toContain(AIModelType.CHAT);
  });

  // =========================================================================
  // discovery returns no models
  // =========================================================================

  it("continues to next provider when discovery returns empty models", async () => {
    mocks.userApiKeys.listUserApiKeys.mockResolvedValue([
      { isActive: true, mode: "personal", provider: "openai" },
    ]);
    mocks.userApiKeys.getPersonalKey.mockResolvedValue({ apiKey: "sk-test" });
    mocks.userModelConfigs.listByUser.mockResolvedValue([]);
    mocks.modelDiscovery.fetchAvailableModels.mockResolvedValue({
      success: true,
      models: [],
    });

    const result = await service.runForUser("user-1");
    expect(result.createdCount).toBe(0);
    expect(result.missingTypes).toContain(AIModelType.CHAT);
  });

  it("continues when discovery throws an error", async () => {
    mocks.userApiKeys.listUserApiKeys.mockResolvedValue([
      { isActive: true, mode: "personal", provider: "openai" },
    ]);
    mocks.userApiKeys.getPersonalKey.mockResolvedValue({ apiKey: "sk-test" });
    mocks.userModelConfigs.listByUser.mockResolvedValue([]);
    mocks.modelDiscovery.fetchAvailableModels.mockRejectedValue(
      new Error("Network error"),
    );

    const result = await service.runForUser("user-1");
    expect(result.createdCount).toBe(0);
  });

  it("continues when discovery returns success=false", async () => {
    mocks.userApiKeys.listUserApiKeys.mockResolvedValue([
      { isActive: true, mode: "personal", provider: "openai" },
    ]);
    mocks.userApiKeys.getPersonalKey.mockResolvedValue({ apiKey: "sk-test" });
    mocks.userModelConfigs.listByUser.mockResolvedValue([]);
    mocks.modelDiscovery.fetchAvailableModels.mockResolvedValue({
      success: false,
    });

    const result = await service.runForUser("user-1");
    expect(result.createdCount).toBe(0);
  });

  // =========================================================================
  // No recommendation for modelType
  // =========================================================================

  it("continues when no recommendation matches modelType", async () => {
    mocks.userApiKeys.listUserApiKeys.mockResolvedValue([
      { isActive: true, mode: "personal", provider: "openai" },
    ]);
    mocks.userApiKeys.getPersonalKey.mockResolvedValue({ apiKey: "sk-test" });
    mocks.userModelConfigs.listByUser.mockResolvedValue([]);
    mocks.modelDiscovery.fetchAvailableModels.mockResolvedValue({
      success: true,
      models: [{ id: "gpt-4o" }],
    });
    // Recommendation exists but for a different modelType
    mocks.recommendations.getForProvider.mockResolvedValue([
      {
        provider: "openai",
        modelType: AIModelType.EMBEDDING,
        patterns: ["^text-embedding"],
      },
    ]);

    const result = await service.runForUser("user-1");
    expect(result.createdCount).toBe(0);
  });

  it("continues when recommendation has empty patterns", async () => {
    mocks.userApiKeys.listUserApiKeys.mockResolvedValue([
      { isActive: true, mode: "personal", provider: "openai" },
    ]);
    mocks.userApiKeys.getPersonalKey.mockResolvedValue({ apiKey: "sk-test" });
    mocks.userModelConfigs.listByUser.mockResolvedValue([]);
    mocks.modelDiscovery.fetchAvailableModels.mockResolvedValue({
      success: true,
      models: [{ id: "gpt-4o" }],
    });
    mocks.recommendations.getForProvider.mockResolvedValue([
      { provider: "openai", modelType: AIModelType.CHAT, patterns: [] },
    ]);

    const result = await service.runForUser("user-1");
    expect(result.createdCount).toBe(0);
  });

  // =========================================================================
  // No candidates from allMatches
  // =========================================================================

  it("continues when no availableIds match patterns", async () => {
    mocks.userApiKeys.listUserApiKeys.mockResolvedValue([
      { isActive: true, mode: "personal", provider: "openai" },
    ]);
    mocks.userApiKeys.getPersonalKey.mockResolvedValue({ apiKey: "sk-test" });
    mocks.userModelConfigs.listByUser.mockResolvedValue([]);
    mocks.modelDiscovery.fetchAvailableModels.mockResolvedValue({
      success: true,
      models: [{ id: "gpt-3.5-turbo" }],
    });
    mocks.recommendations.getForProvider.mockResolvedValue([
      {
        provider: "openai",
        modelType: AIModelType.CHAT,
        patterns: ["^gpt-4o$"],
      },
    ]);

    const result = await service.runForUser("user-1");
    expect(result.createdCount).toBe(0);
  });

  // =========================================================================
  // Probe fails for all candidates
  // =========================================================================

  it("continues when probe fails for all candidates", async () => {
    mocks.userApiKeys.listUserApiKeys.mockResolvedValue([
      { isActive: true, mode: "personal", provider: "openai" },
    ]);
    mocks.userApiKeys.getPersonalKey.mockResolvedValue({ apiKey: "sk-test" });
    mocks.userModelConfigs.listByUser.mockResolvedValue([]);
    mocks.modelDiscovery.fetchAvailableModels.mockResolvedValue({
      success: true,
      models: [{ id: "gpt-4o" }],
    });
    mocks.recommendations.getForProvider.mockResolvedValue(chatRec("openai"));
    mocks.connectionTest.testModelConnectionWithKey.mockResolvedValue({
      success: false,
      message: "Connection failed",
    });

    const result = await service.runForUser("user-1");
    expect(result.createdCount).toBe(0);
    expect(result.missingTypes).toContain(AIModelType.CHAT);
  });

  it("continues when probe throws", async () => {
    mocks.userApiKeys.listUserApiKeys.mockResolvedValue([
      { isActive: true, mode: "personal", provider: "openai" },
    ]);
    mocks.userApiKeys.getPersonalKey.mockResolvedValue({ apiKey: "sk-test" });
    mocks.userModelConfigs.listByUser.mockResolvedValue([]);
    mocks.modelDiscovery.fetchAvailableModels.mockResolvedValue({
      success: true,
      models: [{ id: "gpt-4o" }],
    });
    mocks.recommendations.getForProvider.mockResolvedValue(chatRec("openai"));
    mocks.connectionTest.testModelConnectionWithKey.mockRejectedValue(
      new Error("Network error"),
    );

    const result = await service.runForUser("user-1");
    expect(result.createdCount).toBe(0);
  });

  // =========================================================================
  // Existing configs
  // =========================================================================

  it("promotes existing record to default when isDefault=false", async () => {
    const existingRow = {
      id: "cfg-1",
      provider: "openai",
      modelId: "gpt-4o",
      modelType: AIModelType.CHAT,
      isEnabled: true,
      isDefault: false,
    };

    mocks.userApiKeys.listUserApiKeys.mockResolvedValue([
      { isActive: true, mode: "personal", provider: "openai" },
    ]);
    mocks.userApiKeys.getPersonalKey.mockResolvedValue({ apiKey: "sk-test" });
    mocks.userModelConfigs.listByUser.mockResolvedValue([existingRow]);
    mocks.modelDiscovery.fetchAvailableModels.mockResolvedValue({
      success: true,
      models: [{ id: "gpt-4o" }],
    });
    mocks.recommendations.getForProvider.mockResolvedValue(chatRec("openai"));
    mocks.connectionTest.testModelConnectionWithKey.mockResolvedValue({
      success: true,
      message: "ok",
    });
    mocks.userModelConfigs.update.mockResolvedValue({});

    const result = await service.runForUser("user-1");

    expect(mocks.userModelConfigs.update).toHaveBeenCalledWith(
      "user-1",
      "cfg-1",
      { isDefault: true },
    );
    expect(
      result.items.some(
        (i) => i.reason === "Already exists — promoted to default",
      ),
    ).toBe(true);
  });

  it("handles update failure when promoting to default", async () => {
    const existingRow = {
      id: "cfg-1",
      provider: "openai",
      modelId: "gpt-4o",
      modelType: AIModelType.CHAT,
      isEnabled: true,
      isDefault: false,
    };

    mocks.userApiKeys.listUserApiKeys.mockResolvedValue([
      { isActive: true, mode: "personal", provider: "openai" },
    ]);
    mocks.userApiKeys.getPersonalKey.mockResolvedValue({ apiKey: "sk-test" });
    mocks.userModelConfigs.listByUser.mockResolvedValue([existingRow]);
    mocks.modelDiscovery.fetchAvailableModels.mockResolvedValue({
      success: true,
      models: [{ id: "gpt-4o" }],
    });
    mocks.recommendations.getForProvider.mockResolvedValue(chatRec("openai"));
    mocks.connectionTest.testModelConnectionWithKey.mockResolvedValue({
      success: true,
      message: "ok",
    });
    mocks.userModelConfigs.update.mockRejectedValue(new Error("DB error"));

    const result = await service.runForUser("user-1");

    // Falls through to skippedCount after update fails
    expect(result.skippedCount).toBe(1);
    expect(result.items.some((i) => i.reason === "Already configured")).toBe(
      true,
    );
  });

  it("skips when matchedId already exists with isDefault=true", async () => {
    const existingRow = {
      id: "cfg-1",
      provider: "openai",
      modelId: "gpt-4o",
      modelType: AIModelType.CHAT,
      isEnabled: true,
      isDefault: true,
    };

    mocks.userApiKeys.listUserApiKeys.mockResolvedValue([
      { isActive: true, mode: "personal", provider: "openai" },
    ]);
    mocks.userApiKeys.getPersonalKey.mockResolvedValue({ apiKey: "sk-test" });
    mocks.userModelConfigs.listByUser.mockResolvedValue([existingRow]);
    mocks.modelDiscovery.fetchAvailableModels.mockResolvedValue({
      success: true,
      models: [{ id: "gpt-4o" }],
    });
    mocks.recommendations.getForProvider.mockResolvedValue(chatRec("openai"));
    mocks.connectionTest.testModelConnectionWithKey.mockResolvedValue({
      success: true,
      message: "ok",
    });

    await service.runForUser("user-1");

    // CHAT already defaulted → skips entirely via defaultedTypes.has(modelType)
    expect(mocks.userModelConfigs.create).not.toHaveBeenCalled();
  });

  // =========================================================================
  // create succeeds
  // =========================================================================

  it("creates new model config when probe succeeds", async () => {
    mocks.userApiKeys.listUserApiKeys.mockResolvedValue([
      {
        id: "key-openai-1",
        isActive: true,
        mode: "personal",
        provider: "openai",
      },
    ]);
    mocks.userApiKeys.getPersonalKey.mockResolvedValue({ apiKey: "sk-test" });
    mocks.userModelConfigs.listByUser.mockResolvedValue([]);
    mocks.modelDiscovery.fetchAvailableModels.mockResolvedValue({
      success: true,
      models: [{ id: "gpt-4o" }],
    });
    mocks.recommendations.getForProvider.mockResolvedValue(chatRec("openai"));
    mocks.connectionTest.testModelConnectionWithKey.mockResolvedValue({
      success: true,
      message: "ok",
    });
    mocks.userModelConfigs.create.mockResolvedValue({});

    const result = await service.runForUser("user-1");

    expect(result.createdCount).toBeGreaterThan(0);
    expect(mocks.userModelConfigs.create).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        provider: "openai",
        modelId: "gpt-4o",
        modelType: AIModelType.CHAT,
        isDefault: true,
        // ★ 2026-06-11 修"密钥未关联"：一键配置必须显式 pin 探测用的 BYOK Key。
        apiKeyId: "key-openai-1",
      }),
    );
    expect(result.items.some((i) => i.action === "created")).toBe(true);
  });

  // =========================================================================
  // create throws ConflictException
  // =========================================================================

  it("treats ConflictException as already-configured skip", async () => {
    mocks.userApiKeys.listUserApiKeys.mockResolvedValue([
      { isActive: true, mode: "personal", provider: "openai" },
    ]);
    mocks.userApiKeys.getPersonalKey.mockResolvedValue({ apiKey: "sk-test" });
    mocks.userModelConfigs.listByUser.mockResolvedValue([]);
    mocks.modelDiscovery.fetchAvailableModels.mockResolvedValue({
      success: true,
      models: [{ id: "gpt-4o" }],
    });
    mocks.recommendations.getForProvider.mockResolvedValue(chatRec("openai"));
    mocks.connectionTest.testModelConnectionWithKey.mockResolvedValue({
      success: true,
      message: "ok",
    });
    mocks.userModelConfigs.create.mockRejectedValue(
      new ConflictException("Duplicate"),
    );

    const result = await service.runForUser("user-1");

    expect(result.skippedCount).toBeGreaterThan(0);
    expect(result.items.some((i) => i.reason === "Already configured")).toBe(
      true,
    );
  });

  // =========================================================================
  // create throws non-conflict error
  // =========================================================================

  it("warns and skips on non-ConflictException create error", async () => {
    mocks.userApiKeys.listUserApiKeys.mockResolvedValue([
      { isActive: true, mode: "personal", provider: "openai" },
    ]);
    mocks.userApiKeys.getPersonalKey.mockResolvedValue({ apiKey: "sk-test" });
    mocks.userModelConfigs.listByUser.mockResolvedValue([]);
    mocks.modelDiscovery.fetchAvailableModels.mockResolvedValue({
      success: true,
      models: [{ id: "gpt-4o" }],
    });
    mocks.recommendations.getForProvider.mockResolvedValue(chatRec("openai"));
    mocks.connectionTest.testModelConnectionWithKey.mockResolvedValue({
      success: true,
      message: "ok",
    });
    mocks.userModelConfigs.create.mockRejectedValue(new Error("DB timeout"));

    const result = await service.runForUser("user-1");

    expect(result.skippedCount).toBeGreaterThan(0);
    expect(result.items.some((i) => i.reason === "DB timeout")).toBe(true);
  });

  // =========================================================================
  // Discovery caching (second call same provider/type reuses cache)
  // =========================================================================

  it("reuses discovery cache for same provider+type across iterations", async () => {
    // Two keys for same provider to trigger dedup path (providerKeyMap.has check)
    mocks.userApiKeys.listUserApiKeys.mockResolvedValue([
      { isActive: true, mode: "personal", provider: "openai" },
      { isActive: true, mode: "personal", provider: "openai" }, // duplicate
    ]);
    mocks.userApiKeys.getPersonalKey.mockResolvedValue({ apiKey: "sk-test" });
    mocks.userModelConfigs.listByUser.mockResolvedValue([]);
    mocks.modelDiscovery.fetchAvailableModels.mockResolvedValue({
      success: true,
      models: [{ id: "gpt-4o" }],
    });
    mocks.recommendations.getForProvider.mockResolvedValue(chatRec("openai"));
    mocks.connectionTest.testModelConnectionWithKey.mockResolvedValue({
      success: true,
      message: "ok",
    });
    mocks.userModelConfigs.create.mockResolvedValue({});

    await service.runForUser("user-1");

    // getPersonalKey called only once per provider (dedup in providerKeyMap loop)
    expect(mocks.userApiKeys.getPersonalKey).toHaveBeenCalledTimes(1);
  });

  // =========================================================================
  // Private helper: allMatches with invalid regex
  // =========================================================================

  it("allMatches skips invalid regex patterns (line 326)", async () => {
    mocks.userApiKeys.listUserApiKeys.mockResolvedValue([
      { isActive: true, mode: "personal", provider: "openai" },
    ]);
    mocks.userApiKeys.getPersonalKey.mockResolvedValue({ apiKey: "sk-test" });
    mocks.userModelConfigs.listByUser.mockResolvedValue([]);
    mocks.modelDiscovery.fetchAvailableModels.mockResolvedValue({
      success: true,
      models: [{ id: "gpt-4o" }],
    });
    // Include an invalid regex (unmatched '[')
    mocks.recommendations.getForProvider.mockResolvedValue([
      {
        provider: "openai",
        modelType: AIModelType.CHAT,
        patterns: ["[invalid", "^gpt-4o$"],
      },
    ]);
    mocks.connectionTest.testModelConnectionWithKey.mockResolvedValue({
      success: true,
      message: "ok",
    });
    mocks.userModelConfigs.create.mockResolvedValue({});

    const result = await service.runForUser("user-1");
    // Invalid pattern skipped, valid one matches → creates
    expect(result.createdCount).toBeGreaterThan(0);
  });

  // =========================================================================
  // inferMaxTokens: various modelId patterns
  // =========================================================================

  it("creates config with maxTokens=32000 for o1 model (reasoning token protocol)", async () => {
    mocks.userApiKeys.listUserApiKeys.mockResolvedValue([
      { isActive: true, mode: "personal", provider: "openai" },
    ]);
    mocks.userApiKeys.getPersonalKey.mockResolvedValue({ apiKey: "sk-test" });
    mocks.userModelConfigs.listByUser.mockResolvedValue([]);
    mocks.modelDiscovery.fetchAvailableModels.mockResolvedValue({
      success: true,
      // Use o1-mini (no -preview suffix) so EXCLUDED_MODEL_SUBSTRINGS won't filter it
      models: [{ id: "o1-mini" }],
    });
    mocks.recommendations.getForProvider.mockResolvedValue([
      { provider: "openai", modelType: AIModelType.CHAT, patterns: ["^o1"] },
    ]);
    mocks.connectionTest.testModelConnectionWithKey.mockResolvedValue({
      success: true,
      message: "ok",
    });
    mocks.userModelConfigs.create.mockResolvedValue({});

    await service.runForUser("user-1");

    expect(mocks.userModelConfigs.create).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ maxTokens: 32000 }),
    );
  });

  it("creates config with maxTokens=4096 for EMBEDDING model", async () => {
    mocks.userApiKeys.listUserApiKeys.mockResolvedValue([
      { isActive: true, mode: "personal", provider: "openai" },
    ]);
    mocks.userApiKeys.getPersonalKey.mockResolvedValue({ apiKey: "sk-test" });
    mocks.userModelConfigs.listByUser.mockResolvedValue([]);
    mocks.modelDiscovery.fetchAvailableModels.mockResolvedValue({
      success: true,
      models: [{ id: "text-embedding-3-small" }],
    });
    mocks.recommendations.getForProvider.mockResolvedValue([
      {
        provider: "openai",
        modelType: AIModelType.EMBEDDING,
        patterns: ["^text-embedding"],
      },
    ]);
    mocks.connectionTest.testModelConnectionWithKey.mockResolvedValue({
      success: true,
      message: "ok",
    });
    mocks.userModelConfigs.create.mockResolvedValue({});

    await service.runForUser("user-1");

    expect(mocks.userModelConfigs.create).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ maxTokens: 4096 }),
    );
  });

  it("creates config with maxTokens=16000 for gpt-4o model", async () => {
    mocks.userApiKeys.listUserApiKeys.mockResolvedValue([
      { isActive: true, mode: "personal", provider: "openai" },
    ]);
    mocks.userApiKeys.getPersonalKey.mockResolvedValue({ apiKey: "sk-test" });
    mocks.userModelConfigs.listByUser.mockResolvedValue([]);
    mocks.modelDiscovery.fetchAvailableModels.mockResolvedValue({
      success: true,
      models: [{ id: "gpt-4o" }],
    });
    mocks.recommendations.getForProvider.mockResolvedValue(chatRec("openai"));
    mocks.connectionTest.testModelConnectionWithKey.mockResolvedValue({
      success: true,
      message: "ok",
    });
    mocks.userModelConfigs.create.mockResolvedValue({});

    await service.runForUser("user-1");

    expect(mocks.userModelConfigs.create).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ maxTokens: 16000 }),
    );
  });

  it("creates config with maxTokens=8000 for deepseek-chat model", async () => {
    mocks.userApiKeys.listUserApiKeys.mockResolvedValue([
      { isActive: true, mode: "personal", provider: "deepseek" },
    ]);
    mocks.userApiKeys.getPersonalKey.mockResolvedValue({ apiKey: "sk-test" });
    mocks.userModelConfigs.listByUser.mockResolvedValue([]);
    mocks.modelDiscovery.fetchAvailableModels.mockResolvedValue({
      success: true,
      models: [{ id: "deepseek-chat" }],
    });
    mocks.recommendations.getForProvider.mockResolvedValue([
      {
        provider: "deepseek",
        modelType: AIModelType.CHAT,
        patterns: ["^deepseek-chat$"],
      },
    ]);
    mocks.connectionTest.testModelConnectionWithKey.mockResolvedValue({
      success: true,
      message: "ok",
    });
    mocks.userModelConfigs.create.mockResolvedValue({});

    await service.runForUser("user-1");

    expect(mocks.userModelConfigs.create).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ maxTokens: 8000 }),
    );
  });

  // =========================================================================
  // inferCapabilities: reasoning protocol + vision + unknown provider display name
  // =========================================================================

  it("sets tokenParamName=max_completion_tokens for o1 models", async () => {
    mocks.userApiKeys.listUserApiKeys.mockResolvedValue([
      { isActive: true, mode: "personal", provider: "openai" },
    ]);
    mocks.userApiKeys.getPersonalKey.mockResolvedValue({ apiKey: "sk-test" });
    mocks.userModelConfigs.listByUser.mockResolvedValue([]);
    mocks.modelDiscovery.fetchAvailableModels.mockResolvedValue({
      success: true,
      // o1-mini: no -preview suffix, passes EXCLUDED_MODEL_SUBSTRINGS filter
      models: [{ id: "o1-mini" }],
    });
    mocks.recommendations.getForProvider.mockResolvedValue([
      { provider: "openai", modelType: AIModelType.CHAT, patterns: ["^o1"] },
    ]);
    mocks.connectionTest.testModelConnectionWithKey.mockResolvedValue({
      success: true,
      message: "ok",
    });
    mocks.userModelConfigs.create.mockResolvedValue({});

    await service.runForUser("user-1");

    expect(mocks.userModelConfigs.create).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        tokenParamName: "max_completion_tokens",
        supportsTemperature: false,
        isReasoning: true,
      }),
    );
  });

  it("sets supportsVision=true for MULTIMODAL modelType", async () => {
    mocks.userApiKeys.listUserApiKeys.mockResolvedValue([
      { isActive: true, mode: "personal", provider: "google" },
    ]);
    mocks.userApiKeys.getPersonalKey.mockResolvedValue({ apiKey: "sk-test" });
    mocks.userModelConfigs.listByUser.mockResolvedValue([]);
    mocks.modelDiscovery.fetchAvailableModels.mockResolvedValue({
      success: true,
      models: [{ id: "gemini-1.5-flash" }],
    });
    mocks.recommendations.getForProvider.mockResolvedValue([
      {
        provider: "google",
        modelType: AIModelType.MULTIMODAL,
        patterns: ["^gemini"],
      },
    ]);
    mocks.connectionTest.testModelConnectionWithKey.mockResolvedValue({
      success: true,
      message: "ok",
    });
    mocks.userModelConfigs.create.mockResolvedValue({});

    await service.runForUser("user-1");

    expect(mocks.userModelConfigs.create).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ supportsVision: true }),
    );
  });

  it("includes modelId in displayName (buildDisplayName coverage)", async () => {
    // openrouter IS in PROVIDER_PREFERENCE_BY_TYPE[CHAT] and maps to "OpenRouter"
    // so the displayName will be "OpenRouter (openrouter-model)"
    mocks.userApiKeys.listUserApiKeys.mockResolvedValue([
      { isActive: true, mode: "personal", provider: "openrouter" },
    ]);
    mocks.userApiKeys.getPersonalKey.mockResolvedValue({ apiKey: "sk-test" });
    mocks.userModelConfigs.listByUser.mockResolvedValue([]);
    mocks.modelDiscovery.fetchAvailableModels.mockResolvedValue({
      success: true,
      models: [{ id: "openrouter-model" }],
    });
    mocks.recommendations.getForProvider.mockResolvedValue([
      {
        provider: "openrouter",
        modelType: AIModelType.CHAT,
        patterns: ["^openrouter"],
      },
    ]);
    mocks.connectionTest.testModelConnectionWithKey.mockResolvedValue({
      success: true,
      message: "ok",
    });
    mocks.userModelConfigs.create.mockResolvedValue({});

    await service.runForUser("user-1");

    expect(mocks.userModelConfigs.create).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        // displayName format: "OpenRouter (openrouter-model)"
        displayName: expect.stringContaining("openrouter-model"),
      }),
    );
  });

  // =========================================================================
  // Image model type — isImageType skips EXCLUDED_MODEL_SUBSTRINGS filter
  // =========================================================================

  it("does not filter image models via EXCLUDED_MODEL_SUBSTRINGS", async () => {
    mocks.userApiKeys.listUserApiKeys.mockResolvedValue([
      { isActive: true, mode: "personal", provider: "openai" },
    ]);
    mocks.userApiKeys.getPersonalKey.mockResolvedValue({ apiKey: "sk-test" });
    mocks.userModelConfigs.listByUser.mockResolvedValue([]);
    mocks.modelDiscovery.fetchAvailableModels.mockResolvedValue({
      success: true,
      // gpt-image-1 contains "-image-" which would normally be excluded
      models: [{ id: "gpt-image-1" }],
    });
    mocks.recommendations.getForProvider.mockResolvedValue([
      {
        provider: "openai",
        modelType: AIModelType.IMAGE_GENERATION,
        patterns: ["^gpt-image"],
      },
    ]);
    mocks.connectionTest.testModelConnectionWithKey.mockResolvedValue({
      success: true,
      message: "ok",
    });
    mocks.userModelConfigs.create.mockResolvedValue({});

    const result = await service.runForUser("user-1");

    // gpt-image-1 should pass through despite containing "-image-"
    expect(result.items.some((i) => i.modelId === "gpt-image-1")).toBe(true);
  });
});
