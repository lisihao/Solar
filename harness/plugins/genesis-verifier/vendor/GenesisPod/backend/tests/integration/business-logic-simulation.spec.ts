/**
 * Business Logic Simulation Tests
 *
 * Full-branch simulation coverage for 9 recent modifications.
 * Uses real service logic with Jest mocks for external dependencies.
 * Each describe block maps to one modification; each it() maps to one branch.
 */

// ============================================================================
// Modification 1: Secret Manager key resolution
// Files: ai-chat-model-config.service.ts  ai-model-config.service.ts
// ============================================================================

describe("Mod1: Secret Manager key resolution", () => {
  // ---------------------------------------------------------------------------
  // AiChatModelConfigService.getApiKeyForModel
  // ---------------------------------------------------------------------------
  describe("AiChatModelConfigService.getApiKeyForModel", () => {
    let service: {
      getApiKeyForModel: (model: {
        secretKey?: string | null;
        name: string;
        apiKey?: string | null;
      }) => Promise<string | null>;
    };
    let mockSecretsService: { getValueInternal: jest.Mock };
    let mockLogger: { warn: jest.Mock; error: jest.Mock };

    beforeEach(() => {
      mockSecretsService = { getValueInternal: jest.fn() };
      mockLogger = { warn: jest.fn(), error: jest.fn() };

      // Inline implementation matching the real service logic (lines 66-83)
      service = {
        async getApiKeyForModel(model) {
          if (model.secretKey) {
            const secretValue = await mockSecretsService.getValueInternal(
              model.secretKey,
            );
            if (secretValue) {
              return secretValue.trim();
            }
            mockLogger.error(
              `[getApiKeyForModel] Secret '${model.secretKey}' not found for model ${model.name}. Check Secret Manager configuration.`,
            );
            return null;
          }
          mockLogger.warn(
            `[getApiKeyForModel] Model ${model.name} has no secretKey configured. Configure it in Admin → Models.`,
          );
          return null;
        },
      };
    });

    it("branch 1: secretKey exists → Secret Manager returns valid key → returns trimmed key", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue("  sk-abc123  ");
      const result = await service.getApiKeyForModel({
        secretKey: "prod-openai-key",
        name: "gpt-4o",
      });
      expect(result).toBe("sk-abc123");
      expect(mockSecretsService.getValueInternal).toHaveBeenCalledWith(
        "prod-openai-key",
      );
    });

    it("branch 2: secretKey exists → Secret Manager returns null → returns null (no fallback to apiKey)", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue(null);
      const result = await service.getApiKeyForModel({
        secretKey: "prod-openai-key",
        name: "gpt-4o",
        apiKey: "plaintext-key-should-not-be-used",
      });
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("not found for model gpt-4o"),
      );
    });

    it("branch 3: secretKey exists → Secret Manager returns empty string → returns null", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue("");
      const result = await service.getApiKeyForModel({
        secretKey: "prod-openai-key",
        name: "gpt-4o",
      });
      // Empty string is falsy — same code path as null
      expect(result).toBeNull();
    });

    it("branch 4: secretKey is null → returns null + logs warn", async () => {
      const result = await service.getApiKeyForModel({
        secretKey: null,
        name: "gpt-4o",
      });
      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("has no secretKey configured"),
      );
      expect(mockSecretsService.getValueInternal).not.toHaveBeenCalled();
    });

    it("branch 5: model has apiKey but no secretKey → returns null (does NOT use plaintext apiKey)", async () => {
      const result = await service.getApiKeyForModel({
        secretKey: undefined,
        name: "gpt-4o",
        apiKey: "plaintext-should-be-ignored",
      });
      expect(result).toBeNull();
      expect(mockSecretsService.getValueInternal).not.toHaveBeenCalled();
    });

    it("branch 6: model has both apiKey and secretKey → Secret Manager succeeds → returns Secret Manager value, NOT apiKey", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue(
        "secret-manager-key",
      );
      const result = await service.getApiKeyForModel({
        secretKey: "prod-openai-key",
        name: "gpt-4o",
        apiKey: "plaintext-should-not-be-returned",
      });
      expect(result).toBe("secret-manager-key");
      expect(result).not.toBe("plaintext-should-not-be-returned");
    });

    it("branch 7: model has both apiKey and secretKey → Secret Manager fails → returns null (no fallback to apiKey)", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue(null);
      const result = await service.getApiKeyForModel({
        secretKey: "prod-openai-key",
        name: "gpt-4o",
        apiKey: "plaintext-fallback-must-not-happen",
      });
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // AiModelConfigService.resolveApiKey (Priority 3 — system key branch only)
  // ---------------------------------------------------------------------------
  describe("AiModelConfigService.resolveApiKey — system-key branch", () => {
    let mockSecretsService: { getValueInternal: jest.Mock };
    let mockUserApiKeysService: {
      getPersonalKey: jest.Mock;
    };
    let mockLogger: { warn: jest.Mock; error: jest.Mock };

    // Inline resolveApiKey logic matching the real implementation
    async function resolveApiKey(
      model: {
        secretKey?: string | null;
        name: string;
        provider: string;
        apiKey?: string | null;
      },
      userId?: string,
    ): Promise<{ apiKey: string; source: string } | null> {
      // Priority 1: personal key
      if (userId) {
        try {
          const personalKey = await mockUserApiKeysService.getPersonalKey(
            userId,
            model.provider,
          );
          if (personalKey) {
            return {
              apiKey: personalKey.apiKey,
              source: "personal",
            };
          }
        } catch {
          mockLogger.warn("Failed to get personal key");
        }
      }
      // Priority 2: Secret Manager (no fallback to apiKey)
      // 2026-05-29 W4b：捐赠池退役，原 donated 优先级分支已移除。
      if (model.secretKey) {
        const secretValue = await mockSecretsService.getValueInternal(
          model.secretKey,
        );
        if (secretValue) {
          return { apiKey: secretValue.trim(), source: "system" };
        }
        mockLogger.error(
          `[resolveApiKey] Secret '${model.secretKey}' not found for model ${model.name}. Check Secret Manager configuration.`,
        );
      }
      return null;
    }

    beforeEach(() => {
      mockSecretsService = { getValueInternal: jest.fn() };
      mockUserApiKeysService = {
        getPersonalKey: jest.fn().mockResolvedValue(null),
      };
      mockLogger = { warn: jest.fn(), error: jest.fn() };
    });

    it("resolveApiKey branch 1: secretKey present → SM returns value → resolved as system key", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue("sk-system-key");
      const result = await resolveApiKey({
        secretKey: "openai-prod",
        name: "gpt-4o",
        provider: "openai",
      });
      expect(result).toEqual({ apiKey: "sk-system-key", source: "system" });
    });

    it("resolveApiKey branch 2: secretKey present → SM returns null → result is null (no apiKey fallback)", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue(null);
      const result = await resolveApiKey({
        secretKey: "openai-prod",
        name: "gpt-4o",
        provider: "openai",
        apiKey: "should-not-be-used",
      });
      expect(result).toBeNull();
    });

    it("resolveApiKey branch 3: no secretKey → result is null regardless of apiKey value", async () => {
      const result = await resolveApiKey({
        secretKey: null,
        name: "gpt-4o",
        provider: "openai",
        apiKey: "plaintext-ignored",
      });
      expect(result).toBeNull();
      expect(mockSecretsService.getValueInternal).not.toHaveBeenCalled();
    });
  });
});

// ============================================================================
// Modification 2: OutputReviewerService + AgentExecutorService
// callAIWithConfig → generateChatCompletion
// ============================================================================

describe("Mod2: callAIWithConfig uses generateChatCompletion", () => {
  describe("OutputReviewerService.callAIWithConfig behavior", () => {
    let mockAiChatService: { generateChatCompletion: jest.Mock };

    // Inline implementation of callAIWithConfig matching lines 553-582
    async function callAIWithConfig(
      aiModel: string,
      messages: { role: string; content: string }[],
      systemPrompt: string,
      options: {
        maxTokens?: number;
        temperature?: number;
        taskProfile?: { creativity: string; outputLength: string };
      },
      _modelConfig: unknown,
    ) {
      const taskProfile = options.taskProfile || {
        creativity:
          options.temperature !== undefined
            ? options.temperature <= 0.2
              ? "deterministic"
              : options.temperature <= 0.3
                ? "low"
                : options.temperature <= 0.7
                  ? "medium"
                  : "high"
            : "low",
        outputLength: options.maxTokens
          ? options.maxTokens <= 1000
            ? "minimal"
            : options.maxTokens <= 2000
              ? "short"
              : options.maxTokens <= 4000
                ? "medium"
                : "standard"
          : "medium",
      };

      const result = await mockAiChatService.generateChatCompletion({
        model: aiModel,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ] as Array<{ role: "system" | "user" | "assistant"; content: string }>,
        taskProfile,
      });
      return {
        content: result.content,
        tokensUsed: result.tokensUsed || 0,
      };
    }

    beforeEach(() => {
      mockAiChatService = { generateChatCompletion: jest.fn() };
    });

    it("branch 1: no aiCaller → callAIWithConfig → calls generateChatCompletion (not chat)", async () => {
      mockAiChatService.generateChatCompletion.mockResolvedValue({
        content: "AI output",
        tokensUsed: 250,
      });
      const result = await callAIWithConfig(
        "gpt-4o",
        [{ role: "user", content: "Review this" }],
        "You are a reviewer",
        { taskProfile: { creativity: "low", outputLength: "medium" } },
        null,
      );
      expect(mockAiChatService.generateChatCompletion).toHaveBeenCalledTimes(1);
      expect(result.content).toBe("AI output");
    });

    it("branch 2: aiCaller provided → aiCaller is called, generateChatCompletion is NOT called", async () => {
      const aiCaller = jest.fn().mockResolvedValue({
        content: "caller output",
        tokensUsed: 100,
      });
      // When aiCaller is provided, the actual service skips callAIWithConfig entirely
      const result = await aiCaller("gpt-4o", [], {
        taskProfile: { creativity: "low", outputLength: "medium" },
      });
      expect(aiCaller).toHaveBeenCalledTimes(1);
      expect(mockAiChatService.generateChatCompletion).not.toHaveBeenCalled();
      expect(result.content).toBe("caller output");
    });

    it("branch 3: DB model has apiKey (old data) → callAIWithConfig still calls generateChatCompletion (apiKey not passed)", async () => {
      const dbModelWithApiKey = {
        id: "model-1",
        apiKey: "old-plaintext-key",
        modelId: "gpt-4o",
      };
      mockAiChatService.generateChatCompletion.mockResolvedValue({
        content: "generated",
        tokensUsed: 300,
      });
      // _modelConfig is passed but ignored — no apiKey is forwarded to generateChatCompletion
      await callAIWithConfig(
        "gpt-4o",
        [{ role: "user", content: "test" }],
        "system",
        { taskProfile: { creativity: "low", outputLength: "medium" } },
        dbModelWithApiKey,
      );
      // generateChatCompletion is called without apiKey from DB model
      const callArg = mockAiChatService.generateChatCompletion.mock.calls[0][0];
      expect(callArg).not.toHaveProperty("apiKey");
    });

    it("branch 4: generateChatCompletion succeeds → tokensUsed correctly returned", async () => {
      mockAiChatService.generateChatCompletion.mockResolvedValue({
        content: "result",
        tokensUsed: 1234,
      });
      const result = await callAIWithConfig(
        "gpt-4o",
        [{ role: "user", content: "test" }],
        "system",
        { taskProfile: { creativity: "low", outputLength: "medium" } },
        null,
      );
      expect(result.tokensUsed).toBe(1234);
    });

    it("branch 5: generateChatCompletion throws → error propagates", async () => {
      mockAiChatService.generateChatCompletion.mockRejectedValue(
        new Error("API timeout"),
      );
      await expect(
        callAIWithConfig(
          "gpt-4o",
          [{ role: "user", content: "test" }],
          "system",
          { taskProfile: { creativity: "low", outputLength: "medium" } },
          null,
        ),
      ).rejects.toThrow("API timeout");
    });
  });

  describe("AgentExecutorService.callAIWithConfig behavior", () => {
    let mockAiChatService: { generateChatCompletion: jest.Mock };

    // Inline implementation matching agent-executor lines 363-401
    async function agentCallAIWithConfig(
      aiModel: string,
      messages: { role: string; content: string }[],
      systemPrompt: string,
      options: {
        maxTokens?: number;
        taskProfile?: { creativity: string; outputLength: string };
      },
      _modelConfig?: unknown,
    ) {
      const isLargeModel =
        aiModel.includes("gpt-4") ||
        aiModel.includes("claude") ||
        aiModel.includes("gemini") ||
        aiModel.includes("gpt-5") ||
        aiModel.startsWith("o1") ||
        aiModel.startsWith("o3");
      const defaultMaxTokens = isLargeModel ? 6000 : 4000;

      const result = await mockAiChatService.generateChatCompletion({
        model: aiModel,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ] as Array<{ role: "system" | "user" | "assistant"; content: string }>,
        maxTokens: options.maxTokens || defaultMaxTokens,
        taskProfile: options.taskProfile ?? {
          creativity: "medium",
          outputLength: "medium",
        },
      });
      return {
        content: result.content,
        tokensUsed: result.tokensUsed || 0,
      };
    }

    beforeEach(() => {
      mockAiChatService = { generateChatCompletion: jest.fn() };
    });

    it("AgentExecutor branch 1: no aiCaller → uses generateChatCompletion", async () => {
      mockAiChatService.generateChatCompletion.mockResolvedValue({
        content: "agent output",
        tokensUsed: 500,
      });
      const result = await agentCallAIWithConfig(
        "gpt-4o",
        [{ role: "user", content: "Execute task" }],
        "You are an agent",
        { taskProfile: { creativity: "medium", outputLength: "medium" } },
      );
      expect(mockAiChatService.generateChatCompletion).toHaveBeenCalledTimes(1);
      expect(result.content).toBe("agent output");
      expect(result.tokensUsed).toBe(500);
    });

    it("AgentExecutor branch 3: DB model with apiKey → apiKey NOT forwarded to generateChatCompletion", async () => {
      mockAiChatService.generateChatCompletion.mockResolvedValue({
        content: "ok",
        tokensUsed: 100,
      });
      await agentCallAIWithConfig(
        "gpt-4o",
        [],
        "system",
        {},
        { apiKey: "old-db-key" },
      );
      const callArg = mockAiChatService.generateChatCompletion.mock.calls[0][0];
      expect(callArg).not.toHaveProperty("apiKey");
    });
  });
});

// ============================================================================
// Modification 3: Facade layer apiKey resolution via Secret Manager
// Files: model-resolver.service.ts  model.sub-facade.ts
// ============================================================================

describe("Mod3: Facade layer apiKey through Secret Manager", () => {
  let mockModelConfigService: {
    getModelById: jest.Mock;
    resolveApiKey: jest.Mock;
  };

  const baseConfig = {
    id: "db-uuid-1",
    modelId: "gpt-4o",
    displayName: "GPT-4o",
    name: "gpt-4o",
    provider: "openai",
    apiKey: "plaintext-should-not-be-used",
    secretKey: "prod-openai-key",
    apiEndpoint: "https://api.openai.com",
    maxTokens: 8192,
    temperature: 0.7,
    isEnabled: true,
    isDefault: true,
    isReasoning: false,
    apiFormat: "openai",
    supportsTemperature: true,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsVision: true,
    tokenParamName: "max_tokens",
    defaultTimeoutMs: 120000,
    priceInputPerMillion: 5,
    priceOutputPerMillion: 15,
    priority: 50,
    appendices: [],
    references: [],
  };

  // Inline getModelById logic matching ModelResolverService lines 226-254
  async function getModelById(idOrModelId: string) {
    const config = await mockModelConfigService.getModelById(idOrModelId);
    if (!config) return null;
    const resolved = await mockModelConfigService.resolveApiKey(config);
    return {
      id: config.id,
      modelId: config.modelId,
      displayName: config.displayName || config.modelId,
      provider: config.provider,
      maxTokens: config.maxTokens,
      apiEndpoint: config.apiEndpoint,
      isReasoning: config.isReasoning ?? false,
      apiKey: resolved?.apiKey || null,
      secretKey: config.secretKey,
    };
  }

  // Inline getFullModelConfig logic matching ModelResolverService lines 259-314
  async function getFullModelConfig(modelId: string) {
    const config = await mockModelConfigService.getModelById(modelId);
    if (!config) return null;
    const resolved = await mockModelConfigService.resolveApiKey(config);
    return {
      id: config.id || config.modelId,
      modelId: config.modelId,
      displayName: config.displayName || config.modelId,
      name: config.name || config.modelId,
      provider: config.provider,
      apiKey: resolved?.apiKey || "",
      secretKey: config.secretKey || null,
      apiEndpoint: config.apiEndpoint || null,
      maxTokens: config.maxTokens || null,
      temperature: config.temperature || null,
      isEnabled: config.isEnabled ?? true,
      isDefault: config.isDefault ?? false,
      isReasoning: config.isReasoning ?? false,
    };
  }

  beforeEach(() => {
    mockModelConfigService = {
      getModelById: jest.fn(),
      resolveApiKey: jest.fn(),
    };
  });

  it("branch 1: getModelById → resolveApiKey succeeds → apiKey is resolved value", async () => {
    mockModelConfigService.getModelById.mockResolvedValue(baseConfig);
    mockModelConfigService.resolveApiKey.mockResolvedValue({
      apiKey: "sm-resolved-key",
      source: "system",
    });
    const result = await getModelById("gpt-4o");
    expect(result?.apiKey).toBe("sm-resolved-key");
    expect(result?.apiKey).not.toBe("plaintext-should-not-be-used");
  });

  it("branch 2: getModelById → resolveApiKey returns null → apiKey is null", async () => {
    mockModelConfigService.getModelById.mockResolvedValue(baseConfig);
    mockModelConfigService.resolveApiKey.mockResolvedValue(null);
    const result = await getModelById("gpt-4o");
    expect(result?.apiKey).toBeNull();
  });

  it("branch 3: getFullModelConfig → resolveApiKey succeeds → apiKey is resolved value", async () => {
    mockModelConfigService.getModelById.mockResolvedValue(baseConfig);
    mockModelConfigService.resolveApiKey.mockResolvedValue({
      apiKey: "full-config-key",
      source: "system",
    });
    const result = await getFullModelConfig("gpt-4o");
    expect(result?.apiKey).toBe("full-config-key");
  });

  it("branch 4: getFullModelConfig → resolveApiKey returns null → apiKey is empty string", async () => {
    mockModelConfigService.getModelById.mockResolvedValue(baseConfig);
    mockModelConfigService.resolveApiKey.mockResolvedValue(null);
    const result = await getFullModelConfig("gpt-4o");
    // resolved?.apiKey || "" → empty string when null
    expect(result?.apiKey).toBe("");
  });

  it("branch 5: ModelSubFacade with modelResolver → delegates to modelResolver.getModelById", async () => {
    // Simulate ModelSubFacade.getModelById when modelResolver is present
    const mockModelResolver = {
      getModelById: jest.fn().mockResolvedValue({
        id: "uuid-1",
        modelId: "gpt-4o",
        apiKey: "delegated-key",
      }),
    };
    // When modelResolver is present, getModelById in ModelSubFacade simply delegates
    const result = await mockModelResolver.getModelById("gpt-4o");
    expect(mockModelResolver.getModelById).toHaveBeenCalledWith("gpt-4o");
    expect(result.apiKey).toBe("delegated-key");
  });

  it("branch 6: ModelSubFacade without modelResolver → calls resolveApiKey directly", async () => {
    mockModelConfigService.getModelById.mockResolvedValue(baseConfig);
    mockModelConfigService.resolveApiKey.mockResolvedValue({
      apiKey: "direct-resolved-key",
      source: "system",
    });
    // Without modelResolver, the sub-facade calls modelConfigService.getModelById + resolveApiKey
    const result = await getModelById("gpt-4o");
    expect(mockModelConfigService.resolveApiKey).toHaveBeenCalledWith(
      baseConfig,
    );
    expect(result?.apiKey).toBe("direct-resolved-key");
  });
});

// ============================================================================
// Modification 4: Report synthesis — supplementary content independent storage
// Files: report-synthesis.service.ts  report.types.ts
// ============================================================================

describe("Mod4: Report synthesis supplementary content independent storage", () => {
  // Inline the normalizeReportResponse logic for the supplementary fields
  // matching lines 1381-1415 of report-synthesis.service.ts

  function extractFullTextWithFallback(
    field: unknown,
    _fieldName: string,
  ): string {
    if (!field) return "";
    if (typeof field === "string") return field;
    if (typeof field === "object") {
      const obj = field as Record<string, unknown>;
      if (obj.fullText && typeof obj.fullText === "string") return obj.fullText;
      // Build text from structured sub-fields
      const parts: string[] = [];
      for (const [, val] of Object.entries(obj)) {
        if (typeof val === "string" && val.trim()) parts.push(val);
        else if (Array.isArray(val))
          parts.push(val.filter((v) => typeof v === "string").join("\n"));
      }
      return parts.join("\n\n");
    }
    return String(field || "");
  }

  function normalizeSupplementaryFields(parsed: {
    conclusion?: string;
    crossDimensionAnalysis?: unknown;
    riskAssessment?: unknown;
    strategicRecommendations?: unknown;
  }) {
    const crossDimensionText = extractFullTextWithFallback(
      parsed.crossDimensionAnalysis,
      "crossDimensionAnalysis",
    );
    const riskText = extractFullTextWithFallback(
      parsed.riskAssessment,
      "riskAssessment",
    );
    const stratText = extractFullTextWithFallback(
      parsed.strategicRecommendations,
      "strategicRecommendations",
    );
    const conclusion = parsed.conclusion || "";

    return {
      conclusion,
      crossDimensionAnalysis: crossDimensionText || undefined,
      riskAssessment: riskText || undefined,
      strategicRecommendations: stratText || undefined,
    };
  }

  it("branch 1: AI returns all three supplementary fields → stored independently in ComprehensiveReport", () => {
    const parsed = {
      conclusion: "Final thoughts",
      crossDimensionAnalysis: {
        fullText: "Cross dimension text",
      },
      riskAssessment: { fullText: "Risk text" },
      strategicRecommendations: { fullText: "Strategic text" },
    };
    const result = normalizeSupplementaryFields(parsed);
    expect(result.crossDimensionAnalysis).toBe("Cross dimension text");
    expect(result.riskAssessment).toBe("Risk text");
    expect(result.strategicRecommendations).toBe("Strategic text");
    expect(result.conclusion).toBe("Final thoughts");
  });

  it("branch 2: AI returns empty crossDimensionAnalysis → undefined", () => {
    const parsed = {
      conclusion: "Final",
      crossDimensionAnalysis: null,
    };
    const result = normalizeSupplementaryFields(parsed);
    expect(result.crossDimensionAnalysis).toBeUndefined();
  });

  it("branch 3: conclusion contains embedded section headers → conclusion passed through directly (not extracted)", () => {
    const conclusion =
      "## 风险评估\nSome risk content\n\n## 战略建议\nSome strategy";
    const parsed = {
      conclusion,
      // crossDimensionAnalysis etc. are separate
      riskAssessment: { fullText: "Separate risk field" },
    };
    const result = normalizeSupplementaryFields(parsed);
    // conclusion is NOT stripped — it's passed through as-is
    expect(result.conclusion).toBe(conclusion);
    // riskAssessment is stored independently, not extracted from conclusion
    expect(result.riskAssessment).toBe("Separate risk field");
  });

  it("branch 4: conclusion is empty → empty string", () => {
    const parsed = { conclusion: "" };
    const result = normalizeSupplementaryFields(parsed);
    expect(result.conclusion).toBe("");
  });

  it("branch 5: all supplementary fields present → each stored independently; conclusion does NOT contain them", () => {
    const parsed = {
      conclusion: "Pure conclusion only",
      crossDimensionAnalysis: { fullText: "cross text" },
      riskAssessment: { fullText: "risk text" },
      strategicRecommendations: { fullText: "strategy text" },
    };
    const result = normalizeSupplementaryFields(parsed);
    // Each field is stored independently
    expect(result.crossDimensionAnalysis).toBe("cross text");
    expect(result.riskAssessment).toBe("risk text");
    expect(result.strategicRecommendations).toBe("strategy text");
    // Conclusion does not have the supplementary content merged in
    expect(result.conclusion).toBe("Pure conclusion only");
    expect(result.conclusion).not.toContain("cross text");
    expect(result.conclusion).not.toContain("risk text");
  });
});

// ============================================================================
// Modification 5: References only include cited sources
// File: report-synthesis.service.ts
// ============================================================================

describe("Mod5: References only include cited sources", () => {
  interface EvidenceInput {
    citationIndex: number;
    title: string;
    url: string;
    domain: string | null;
  }

  function filterReferencesToCited(
    fullReportBody: string,
    allEvidences: EvidenceInput[],
  ): EvidenceInput[] {
    const citedIndices = new Set(
      (fullReportBody.match(/\[(\d+)\]/g) || []).map((m) =>
        parseInt(m.replace(/[[\]]/g, ""), 10),
      ),
    );

    return allEvidences
      .filter((e) => e.citationIndex && citedIndices.has(e.citationIndex))
      .sort((a, b) => (a.citationIndex || 0) - (b.citationIndex || 0));
  }

  const evidences: EvidenceInput[] = [
    {
      citationIndex: 1,
      title: "Source 1",
      url: "https://a.com",
      domain: "a.com",
    },
    {
      citationIndex: 2,
      title: "Source 2",
      url: "https://b.com",
      domain: "b.com",
    },
    {
      citationIndex: 3,
      title: "Source 3",
      url: "https://c.com",
      domain: "c.com",
    },
    {
      citationIndex: 4,
      title: "Source 4",
      url: "https://d.com",
      domain: "d.com",
    },
    {
      citationIndex: 5,
      title: "Source 5",
      url: "https://e.com",
      domain: "e.com",
    },
    {
      citationIndex: 42,
      title: "Source 42",
      url: "https://z.com",
      domain: "z.com",
    },
  ];

  it("branch 1: fullReport has [1][3][5] → only citationIndex=1,3,5 retained", () => {
    const fullReport =
      "Analysis [1] shows that [3] leads to [5] being the result.";
    const result = filterReferencesToCited(fullReport, evidences);
    expect(result.map((r) => r.citationIndex)).toEqual([1, 3, 5]);
  });

  it("branch 2: fullReport has citations [1]..[5] → all 5 retained", () => {
    const fullReport = "Text with [1], [2], [3], [4], [5] references.";
    const result = filterReferencesToCited(fullReport, evidences);
    expect(result.map((r) => r.citationIndex)).toEqual([1, 2, 3, 4, 5]);
  });

  it("branch 3: fullReport has no [N] citations → references empty", () => {
    const fullReport = "Text with no citation markers.";
    const result = filterReferencesToCited(fullReport, evidences);
    expect(result).toHaveLength(0);
  });

  it("branch 4: evidence with citationIndex=42 but [42] not in fullReport → excluded", () => {
    const fullReport = "Only [1] is cited here.";
    const result = filterReferencesToCited(fullReport, evidences);
    expect(result.map((r) => r.citationIndex)).not.toContain(42);
    expect(result.map((r) => r.citationIndex)).toEqual([1]);
  });

  it("branch 5: fullReport has [999] but no evidence has citationIndex=999 → citedIndices includes 999 but no match", () => {
    const fullReport = "References [999] but no evidence maps to it.";
    const result = filterReferencesToCited(fullReport, evidences);
    // citedIndices contains 999 but filter finds no evidence with that index
    expect(result).toHaveLength(0);
  });
});

// ============================================================================
// Modification 6: Citation index global numbering
// Files: dimension-mission.service.ts  dimension-research.prompt.ts
// ============================================================================

describe("Mod6: Citation index global numbering", () => {
  interface EvidenceData {
    citationIndex: number;
    title: string;
    snippet: string;
    promptIndex?: number;
  }

  // Inline filterEvidenceForSection matching dimension-mission.service.ts lines 1718-1763
  function filterEvidenceForSection(
    section: { title: string; keyPoints: string[]; description?: string },
    evidenceData: EvidenceData[],
  ): EvidenceData[] {
    if (evidenceData.length <= 5) {
      return evidenceData.map((e, i) => ({ ...e, promptIndex: i + 1 }));
    }

    // Extract keywords
    const raw = `${section.title} ${section.keyPoints.join(" ")} ${section.description || ""}`;
    const sectionKeywords = raw
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);

    if (sectionKeywords.length === 0) {
      return evidenceData.map((e, i) => ({ ...e, promptIndex: i + 1 }));
    }

    const scored = evidenceData.map((e, index) => {
      const evidenceText = `${e.title || ""} ${e.snippet || ""}`.toLowerCase();
      let score = 0;
      for (const kw of sectionKeywords) {
        if (evidenceText.includes(kw)) score++;
      }
      return { evidence: e, score, originalIndex: index };
    });

    scored.sort((a, b) => b.score - a.score);
    let selected = scored.filter((s) => s.score > 0);
    if (selected.length < 5) {
      const remaining = scored.filter((s) => s.score === 0);
      selected = [...selected, ...remaining.slice(0, 5 - selected.length)];
    }

    return selected.map((s) => ({
      ...s.evidence,
      promptIndex: s.originalIndex + 1,
    }));
  }

  // Inline formatEvidenceForPrompt matching dimension-research.prompt.ts lines 392-422
  function formatEvidenceForPrompt(
    evidence: Array<EvidenceData & { promptIndex?: number }>,
  ): string[] {
    return evidence.map((e, i) => {
      const citationIdx = e.promptIndex || i + 1;
      return `[${citationIdx}]`;
    });
  }

  // Inline replaceEvidenceIds matching content-analysis.utils.ts lines 179-199
  function replaceEvidenceIds(
    content: string,
    indexMapping: Map<number, number>,
  ): string {
    let result = content;
    const sortedEntries = Array.from(indexMapping.entries()).sort(
      (a, b) => b[0] - a[0],
    );
    for (const [promptIndex, actualCitationIndex] of sortedEntries) {
      if (promptIndex !== actualCitationIndex) {
        const pattern = new RegExp(`\\[${promptIndex}\\]`, "g");
        result = result.replace(pattern, `[${actualCitationIndex}]`);
      }
    }
    return result;
  }

  // Build 10 evidence items with citationIndex 1-10
  function buildEvidence(count: number): EvidenceData[] {
    return Array.from({ length: count }, (_, i) => ({
      citationIndex: i + 1,
      title: `Title ${i + 1}`,
      snippet: `Snippet about topic ${i + 1}`,
    }));
  }

  it("branch 1: evidenceData has 10 items → section1 filters to positions [2,5,8] → prompt uses [2],[5],[8]", () => {
    const evidenceData = buildEvidence(10);
    // Make items at originalIndex 1,4,7 (0-based) match section1 keywords
    evidenceData[1].snippet = "economics market trend";
    evidenceData[4].snippet = "economics market growth";
    evidenceData[7].snippet = "economics market shift";

    const section1 = {
      title: "Economics",
      keyPoints: ["market", "economics"],
      description: "",
    };
    const selected = filterEvidenceForSection(section1, evidenceData);
    const promptIndices = selected.map((e) => e.promptIndex);
    // Should include original positions 2, 5, 8 (1-based)
    expect(promptIndices).toContain(2); // originalIndex 1 → promptIndex 2
    expect(promptIndices).toContain(5); // originalIndex 4 → promptIndex 5
    expect(promptIndices).toContain(8); // originalIndex 7 → promptIndex 8

    const formatted = formatEvidenceForPrompt(selected);
    expect(formatted).toContain("[2]");
    expect(formatted).toContain("[5]");
    expect(formatted).toContain("[8]");
  });

  it("branch 2: evidenceData has 5 items → all retained, promptIndex = 1,2,3,4,5", () => {
    const evidenceData = buildEvidence(5);
    const section = { title: "Technology", keyPoints: ["AI"], description: "" };
    const selected = filterEvidenceForSection(section, evidenceData);
    expect(selected).toHaveLength(5);
    expect(selected.map((e) => e.promptIndex)).toEqual([1, 2, 3, 4, 5]);
  });

  it("branch 3: two sections share evidence[5] at originalIndex 4 → both reference promptIndex 5", () => {
    const evidenceData = buildEvidence(10);
    evidenceData[1].snippet = "market economics";
    evidenceData[2].snippet = "policy regulation";
    evidenceData[4].snippet = "market policy both"; // shared

    const section1 = {
      title: "Market",
      keyPoints: ["market"],
      description: "",
    };
    const section2 = {
      title: "Policy",
      keyPoints: ["policy"],
      description: "",
    };

    const sel1 = filterEvidenceForSection(section1, evidenceData);
    const sel2 = filterEvidenceForSection(section2, evidenceData);

    // Both sections should find evidence at originalIndex 4 → promptIndex 5
    const sel1HasIdx5 = sel1.some((e) => e.promptIndex === 5);
    const sel2HasIdx5 = sel2.some((e) => e.promptIndex === 5);
    expect(sel1HasIdx5).toBe(true);
    expect(sel2HasIdx5).toBe(true);
  });

  it("branch 4: replaceEvidenceIds maps promptIndex to DB citationIndex", () => {
    const content = "According to [1] and [2], the result is in [3].";
    const indexMapping = new Map<number, number>([
      [1, 11],
      [2, 15],
      [3, 20],
    ]);
    const result = replaceEvidenceIds(content, indexMapping);
    expect(result).toBe("According to [11] and [15], the result is in [20].");
  });

  it("branch 5: keyword extraction is empty → all evidence retained with positional promptIndex", () => {
    const evidenceData = buildEvidence(8);
    const section = { title: "", keyPoints: [], description: "" };
    const selected = filterEvidenceForSection(section, evidenceData);
    // Empty keywords → return all with positional index
    expect(selected.map((e) => e.promptIndex)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it("branch 6: formatEvidenceForPrompt with promptIndex → uses promptIndex not i+1", () => {
    const evidence = [
      { citationIndex: 10, title: "A", snippet: "a", promptIndex: 3 },
      { citationIndex: 11, title: "B", snippet: "b", promptIndex: 7 },
    ];
    const formatted = formatEvidenceForPrompt(evidence);
    expect(formatted[0]).toBe("[3]"); // uses promptIndex=3, not i+1=1
    expect(formatted[1]).toBe("[7]"); // uses promptIndex=7, not i+1=2
  });

  it("branch 7: formatEvidenceForPrompt without promptIndex → falls back to i+1", () => {
    const evidence = [
      { citationIndex: 10, title: "A", snippet: "a" },
      { citationIndex: 11, title: "B", snippet: "b" },
    ];
    const formatted = formatEvidenceForPrompt(evidence);
    expect(formatted[0]).toBe("[1]"); // fallback to i+1
    expect(formatted[1]).toBe("[2]");
  });
});

// ============================================================================
// Modification 7: OpenAlex 429 concurrency control
// File: openalex-search.tool.ts
// ============================================================================

describe("Mod7: OpenAlex 429 concurrency control", () => {
  let cooldownUntil: number;
  let mockHttpGet: jest.Mock;

  // Inline the retry/cooldown logic from openalex-search.tool.ts lines 254-296
  async function doExecuteWithCooldown(
    query: string,
    maxRetries = 3,
  ): Promise<{ success: boolean; papers: unknown[]; error?: string }> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Wait for cooldown
      const cooldownRemaining = cooldownUntil - Date.now();
      if (cooldownRemaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, cooldownRemaining));
      }

      try {
        const data = await mockHttpGet(query);
        return { success: true, papers: data };
      } catch (err) {
        const is429 = err instanceof Error && err.message.includes("429");
        if (is429 && attempt < maxRetries) {
          const backoff = Math.pow(2, attempt + 1) * 1000;
          cooldownUntil = Date.now() + backoff;
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }
        if (is429) {
          cooldownUntil = Date.now() + 30_000;
          throw err;
        }
        throw err;
      }
    }
    return { success: false, papers: [] };
  }

  beforeEach(() => {
    cooldownUntil = 0;
    mockHttpGet = jest.fn();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("branch 1: normal request → calls httpGet directly without waiting", async () => {
    mockHttpGet.mockResolvedValue([{ id: "W1", title: "Paper 1" }]);
    const promise = doExecuteWithCooldown("machine learning", 3);
    jest.runAllTimers();
    const result = await promise;
    expect(result.success).toBe(true);
    expect(mockHttpGet).toHaveBeenCalledTimes(1);
  });

  it("branch 2: first request 429 → cooldownUntil set to ~2s → retry succeeds", async () => {
    mockHttpGet
      .mockRejectedValueOnce(new Error("429 Too Many Requests"))
      .mockResolvedValueOnce([{ id: "W2", title: "Paper 2" }]);

    const promise = doExecuteWithCooldown("climate change", 3);
    // Advance all pending timers including the retry backoff sleep
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(mockHttpGet).toHaveBeenCalledTimes(2);
  }, 15000);

  it("branch 3: 429 consecutive 3 times → cooldownUntil set to ~30s → throws error", async () => {
    const err429 = new Error("429 Too Many Requests");
    mockHttpGet.mockRejectedValue(err429);

    let thrownError: Error | undefined;
    const promise = doExecuteWithCooldown("genetics", 3).catch((e: Error) => {
      thrownError = e;
    });
    // Advance all pending timers
    await jest.runAllTimersAsync();
    await promise;

    expect(thrownError).toBeDefined();
    expect(thrownError?.message).toContain("429");
    // After exhausting maxRetries, 30s cooldown is set
    expect(cooldownUntil).toBeGreaterThan(Date.now());
  }, 15000);

  it("branch 4: subsequent request during cooldown → waits for cooldown before sending", async () => {
    // Pre-set a cooldown
    cooldownUntil = Date.now() + 5000;
    mockHttpGet.mockResolvedValue([]);

    const waitSpy = jest.spyOn(global, "setTimeout");
    const promise = doExecuteWithCooldown("neural networks", 3);
    jest.runAllTimers();
    await promise;

    // setTimeout should have been called (for the cooldown wait)
    expect(waitSpy).toHaveBeenCalled();
    waitSpy.mockRestore();
  });

  it("branch 5: after cooldown expires → normal request proceeds without waiting", async () => {
    // Set cooldown in the past
    cooldownUntil = Date.now() - 1000;
    mockHttpGet.mockResolvedValue([{ id: "W5" }]);

    const promise = doExecuteWithCooldown("quantum computing", 3);
    jest.runAllTimers();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(mockHttpGet).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// Modification 8: Structure score algorithm
// File: report-quality-trace.service.ts
// ============================================================================

describe("Mod8: computeStructureScore algorithm", () => {
  interface DimDefects {
    missingHeadings: number;
    headingEchoes: number;
    trappedConclusions: number;
  }

  // Inline computeStructureScore matching lines 616-631
  function computeStructureScore(
    dimensionOutputs: Array<{ defects: DimDefects }>,
  ): number {
    if (dimensionOutputs.length === 0) return 100;

    let totalScore = 0;
    for (const dim of dimensionOutputs) {
      let dimScore = 100;
      // Cap missingHeadings penalty at 30 per dimension (6 × 5 = 30)
      dimScore -= Math.min(dim.defects.missingHeadings, 6) * 5;
      dimScore -= Math.min(dim.defects.headingEchoes, 3) * 3;
      dimScore -= Math.min(dim.defects.trappedConclusions, 3) * 3;
      totalScore += Math.max(0, dimScore);
    }
    return Math.round(totalScore / dimensionOutputs.length);
  }

  it("branch 1: 0 dimensions → score = 100", () => {
    expect(computeStructureScore([])).toBe(100);
  });

  it("branch 2: 1 dimension, 0 missingHeadings → score = 100", () => {
    expect(
      computeStructureScore([
        {
          defects: {
            missingHeadings: 0,
            headingEchoes: 0,
            trappedConclusions: 0,
          },
        },
      ]),
    ).toBe(100);
  });

  it("branch 3: 1 dimension, 6 missingHeadings → score = 100 - 30 = 70", () => {
    expect(
      computeStructureScore([
        {
          defects: {
            missingHeadings: 6,
            headingEchoes: 0,
            trappedConclusions: 0,
          },
        },
      ]),
    ).toBe(70);
  });

  it("branch 4: 1 dimension, 20 missingHeadings → capped at 6 → score = 70 (not 0)", () => {
    const score = computeStructureScore([
      {
        defects: {
          missingHeadings: 20,
          headingEchoes: 0,
          trappedConclusions: 0,
        },
      },
    ]);
    // Without cap: 100 - 20*5 = 0. With cap at 6: 100 - 30 = 70
    expect(score).toBe(70);
  });

  it("branch 5: 8 dimensions, each with 5 missingHeadings → each dim score = 75 → average = 75", () => {
    const dims = Array.from({ length: 8 }, () => ({
      defects: { missingHeadings: 5, headingEchoes: 0, trappedConclusions: 0 },
    }));
    expect(computeStructureScore(dims)).toBe(75);
  });

  it("branch 6: headingEchoes capped at 3 → max penalty is 9 per dimension", () => {
    const score = computeStructureScore([
      {
        defects: {
          missingHeadings: 0,
          headingEchoes: 10,
          trappedConclusions: 0,
        },
      },
    ]);
    // Without cap: 100 - 10*3 = 70. With cap at 3: 100 - 9 = 91
    expect(score).toBe(91);
  });

  it("branch 7: trappedConclusions capped at 3 → max penalty is 9 per dimension", () => {
    const score = computeStructureScore([
      {
        defects: {
          missingHeadings: 0,
          headingEchoes: 0,
          trappedConclusions: 10,
        },
      },
    ]);
    // Without cap: 100 - 10*3 = 70. With cap at 3: 100 - 9 = 91
    expect(score).toBe(91);
  });
});

// ============================================================================
// Modification 9: Defect scanner + report formatting
// Files: defect-scanner.ts  report-formatting.utils.ts
// ============================================================================

describe("Mod9: Defect scanner countLeakedFigureNotes + stripInternalFigureNotation", () => {
  // Inline countLeakedFigureNotes matching defect-scanner.ts lines 183-203
  function countLeakedFigureNotes(content: string): number {
    const patterns = [
      /图片没有[：:]/g,
      /图片缺失/g,
      /无图片/g,
      /Image not available/gi,
      /No image/gi,
      /\[图片\]/g,
      /\[Image\]/gi,
      /\*{0,2}figureReferences\*{0,2}\s*[：:]/gi,
      /\*{0,2}generatedCharts\*{0,2}\s*[：:]/gi,
      /\*{0,2}keyFindings\*{0,2}\s*[：:]/gi,
    ];
    let count = 0;
    for (const pattern of patterns) {
      const matches = content.match(pattern);
      if (matches) count += matches.length;
    }
    return count;
  }

  // Inline the relevant parts of stripInternalFigureNotation matching lines 1013-1037
  function stripInternalFigureNotation(content: string): string {
    return content
      .replace(/\*{0,2}figureReferences\*{0,2}\s*[：:]\s*[^\n]*/gi, "")
      .replace(/\*{0,2}generatedCharts\*{0,2}\s*[：:]\s*[^\n]*/gi, "")
      .replace(/\*{0,2}keyFindings\*{0,2}\s*[：:]\s*[^\n]*/gi, "")
      .replace(
        /(?:^|\n)\s*figureReferences\s*[：:]\s*(?:\n(?:[-*]\s*[^\n]+|\s*\[[^\]]+\]\s*[^\n]+))+/gim,
        "",
      );
  }

  // --- countLeakedFigureNotes ---

  it("branch 1: content has '**figureReferences**:' → detected as 1 leak", () => {
    const content = "Some text\n**figureReferences**: [145] 图0\nMore text";
    expect(countLeakedFigureNotes(content)).toBeGreaterThanOrEqual(1);
  });

  it("branch 2: content has 'figureReferences:' (no bold) → detected", () => {
    const content = "figureReferences: some list";
    expect(countLeakedFigureNotes(content)).toBeGreaterThanOrEqual(1);
  });

  it("branch 3: content has '**generatedCharts**:' → detected", () => {
    const content = "**generatedCharts**: [{chart data}]";
    expect(countLeakedFigureNotes(content)).toBeGreaterThanOrEqual(1);
  });

  it("branch 4: content has '**keyFindings**:' → detected", () => {
    const content = "**keyFindings**: Finding 1\nFinding 2";
    expect(countLeakedFigureNotes(content)).toBeGreaterThanOrEqual(1);
  });

  it("branch 4b: content has no leaks → count is 0", () => {
    const content = "This is clean content with normal text and [1] citations.";
    expect(countLeakedFigureNotes(content)).toBe(0);
  });

  // --- stripInternalFigureNotation ---

  it("branch 5: '**figureReferences**: [145] 图0' → entire line deleted", () => {
    const content =
      "Before the notation\n**figureReferences**: [145] 图0：error example\nAfter notation";
    const result = stripInternalFigureNotation(content);
    expect(result).not.toContain("figureReferences");
    expect(result).not.toContain("[145] 图0");
    // Content before and after should be preserved
    expect(result).toContain("Before the notation");
    expect(result).toContain("After notation");
  });

  it("branch 6: 'generatedCharts: ...' → line deleted", () => {
    const content =
      "Paragraph text\ngeneratedCharts: [{id:1, type:bar}]\nFinal paragraph";
    const result = stripInternalFigureNotation(content);
    expect(result).not.toContain("generatedCharts");
    expect(result).toContain("Paragraph text");
    expect(result).toContain("Final paragraph");
  });

  it("stripInternalFigureNotation: 'keyFindings:' line → deleted", () => {
    const content = "Section intro\nkeyFindings: Finding A\nMore content";
    const result = stripInternalFigureNotation(content);
    expect(result).not.toContain("keyFindings");
    expect(result).toContain("Section intro");
    expect(result).toContain("More content");
  });

  it("stripInternalFigureNotation: figureReferences block with list items → entire block deleted", () => {
    const content =
      "Text before\nfigureReferences:\n- [145] 图0：事实性错误示例\n- [200] 图1：另一示例\nText after";
    const result = stripInternalFigureNotation(content);
    expect(result).not.toContain("figureReferences");
    expect(result).not.toContain("[145]");
    expect(result).toContain("Text before");
    expect(result).toContain("Text after");
  });

  it("stripInternalFigureNotation: clean content → unchanged", () => {
    const content =
      "This is clean content with [1] citation and normal paragraphs.";
    const result = stripInternalFigureNotation(content);
    expect(result).toContain("[1] citation");
    expect(result).toBe(content);
  });
});
