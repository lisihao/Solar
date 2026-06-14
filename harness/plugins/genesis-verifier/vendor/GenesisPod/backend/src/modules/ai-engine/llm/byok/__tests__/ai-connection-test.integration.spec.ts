/**
 * AiConnectionTestService - Extended coverage tests
 *
 * Covers paths not hit by the base spec:
 *  - Line 36: inferIsReasoning via modelConfigService
 *  - Line 109: testImageModel via IMAGE_GENERATION / IMAGE_EDITING modelType
 *  - Lines 260-290: Imagen path (google/gemini) including generatedImages branch and catch
 *  - Lines 315-347: gemini non-imagen path (generateContent endpoint)
 *  - Lines 353-370: perplexity provider
 *  - Lines 483, 514: openai embedding - response without embedding array
 *  - Lines 522, 554: cohere embedding URL handling variations
 *  - Lines 582-603: google embedding - success + fallthrough
 *  - Lines 618-621: embedding ECONNABORTED / err.message error paths
 *  - Lines 683, 693-694: cohere rerank response + fallthrough
 *  - Lines 709-712: rerank ECONNABORTED / err.message error path
 *  - Lines 755-767: testTTSModel catch block
 *  - Lines 777-876: testImageModel (openai url/image/b64, google fallback, unsupported, catch)
 */

import { Test, TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { of, throwError } from "rxjs";
import { AxiosResponse } from "axios";
import { AiConnectionTestService } from "../ai-connection-test.service";
import { AiModelConfigService } from "../../models/config/ai-model-config.service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(data: unknown, status = 200): AxiosResponse {
  return {
    data,
    status,
    statusText: "OK",
    headers: {},
    config: {} as AxiosResponse["config"],
  };
}

function _makeAxiosError(status: number, data: unknown) {
  const err = new Error("Request failed") as Error & {
    response: unknown;
    code?: string;
  };
  err.response = { status, data };
  return throwError(() => err);
}

// ---------------------------------------------------------------------------
// Module builders
// ---------------------------------------------------------------------------

async function buildModule(opts: {
  withModelConfigService?: boolean;
}): Promise<{
  service: AiConnectionTestService;
  mockHttp: { post: jest.Mock; get: jest.Mock };
  mockModelConfig?: { isReasoningModel: jest.Mock; getModelConfig: jest.Mock };
}> {
  const mockHttp = { post: jest.fn(), get: jest.fn() };
  const mockModelConfig = {
    isReasoningModel: jest.fn().mockReturnValue(false),
    getModelConfig: jest.fn().mockResolvedValue(null),
  };

  const providers: unknown[] = [
    AiConnectionTestService,
    { provide: HttpService, useValue: mockHttp },
  ];

  if (opts.withModelConfigService) {
    providers.push({
      provide: AiModelConfigService,
      useValue: mockModelConfig,
    });
  }

  const module: TestingModule = await Test.createTestingModule({
    providers: providers as Parameters<
      typeof Test.createTestingModule
    >[0]["providers"],
  }).compile();

  return {
    service: module.get<AiConnectionTestService>(AiConnectionTestService),
    mockHttp,
    mockModelConfig: opts.withModelConfigService ? mockModelConfig : undefined,
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe("AiConnectionTestService (extended coverage)", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // Line 36: inferIsReasoning via modelConfigService
  // =========================================================================

  describe("inferIsReasoning via modelConfigService (line 36)", () => {
    it("calls modelConfigService.isReasoningModel when injected", async () => {
      const { service, mockHttp, mockModelConfig } = await buildModule({
        withModelConfigService: true,
      });

      mockModelConfig!.isReasoningModel.mockReturnValue(true);
      mockHttp.post.mockReturnValue(
        of(makeResponse({ choices: [{ message: { content: "OK" } }] })),
      );

      await service.testModelConnectionWithKey(
        "openai",
        "o1-mini",
        "key",
        "https://api.openai.com/v1/chat/completions",
      );

      expect(mockModelConfig!.isReasoningModel).toHaveBeenCalledWith("o1-mini");
      // reasoning 模型给 512 预算（避免隐藏 CoT 吃光小预算导致空响应假阳性）
      expect(mockHttp.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ max_completion_tokens: 512 }),
        expect.any(Object),
      );
    });
  });

  // =========================================================================
  // Line 109: IMAGE_GENERATION → testImageModel
  // =========================================================================

  describe("IMAGE_GENERATION model type triggers testImageModel (line 109)", () => {
    it("routes IMAGE_GENERATION to testImageModel for openai provider", async () => {
      const { service, mockHttp } = await buildModule({});

      mockHttp.post.mockReturnValue(
        of(makeResponse({ data: [{ url: "https://example.com/img.png" }] })),
      );

      const result = await service.testModelConnectionWithKey(
        "openai",
        "dall-e-3",
        "key",
        "https://api.openai.com/v1",
        "IMAGE_GENERATION",
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("Image model connected");
      // Should call the /images/generations endpoint
      expect(mockHttp.post).toHaveBeenCalledWith(
        expect.stringContaining("images/generations"),
        expect.objectContaining({ model: "dall-e-3" }),
        expect.any(Object),
      );
    });

    it("routes IMAGE_EDITING to testImageModel for openai provider", async () => {
      const { service, mockHttp } = await buildModule({});

      mockHttp.post.mockReturnValue(
        of(makeResponse({ data: [{ b64_json: "abc123" }] })),
      );

      const result = await service.testModelConnectionWithKey(
        "openai",
        "dall-e-2",
        "key",
        "",
        "IMAGE_EDITING",
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("Image model connected");
    });

    it("returns false for unsupported provider in testImageModel", async () => {
      const { service } = await buildModule({});

      const result = await service.testModelConnectionWithKey(
        "somevendor",
        "img-model",
        "key",
        "",
        "IMAGE_GENERATION",
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("not supported for provider");
    });

    it("returns success for google provider in testImageModel (line 834)", async () => {
      const { service } = await buildModule({});

      const result = await service.testModelConnectionWithKey(
        "google",
        "imagen-2",
        "key",
        "",
        "IMAGE_GENERATION",
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("Google path");
    });

    it("handles API error in testImageModel catch block (lines 848-876)", async () => {
      const { service, mockHttp } = await buildModule({});

      const axiosErr = Object.assign(new Error("Forbidden"), {
        response: {
          status: 403,
          data: { error: { message: "Access denied" } },
        },
      });
      mockHttp.post.mockReturnValue(throwError(() => axiosErr));

      const result = await service.testModelConnectionWithKey(
        "openai",
        "dall-e-3",
        "key",
        "",
        "IMAGE_GENERATION",
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("API Error (403)");
      expect(result.message).toContain("Access denied");
    });

    it("handles ECONNABORTED in testImageModel catch (line 863)", async () => {
      const { service, mockHttp } = await buildModule({});

      const timeoutErr = Object.assign(new Error("timeout"), {
        code: "ECONNABORTED",
      });
      mockHttp.post.mockReturnValue(throwError(() => timeoutErr));

      const result = await service.testModelConnectionWithKey(
        "openai",
        "dall-e-3",
        "key",
        "",
        "IMAGE_GENERATION",
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("Connection timeout");
    });

    it("returns success when response has no image data (line 827)", async () => {
      const { service, mockHttp } = await buildModule({});

      mockHttp.post.mockReturnValue(of(makeResponse({ data: [] })));

      const result = await service.testModelConnectionWithKey(
        "openai",
        "dall-e-3",
        "key",
        "",
        "IMAGE_GENERATION",
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("no image data");
    });
  });

  // =========================================================================
  // Lines 260-290: Imagen path (google/gemini) with generatedImages + catch
  // =========================================================================

  describe("Imagen path in google/gemini (lines 260-290)", () => {
    it("returns success when response has predictions[0].bytesBase64Encoded (line 251)", async () => {
      const { service, mockHttp } = await buildModule({});

      mockHttp.post.mockReturnValue(
        of(makeResponse({ predictions: [{ bytesBase64Encoded: "abc==" }] })),
      );

      const result = await service.testModelConnectionWithKey(
        "google",
        "imagen-3",
        "key",
        "",
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("Imagen connection successful");
    });

    it("returns success when response has generatedImages[0].image.imageBytes (lines 260-266)", async () => {
      const { service, mockHttp } = await buildModule({});

      mockHttp.post.mockReturnValue(
        of(
          makeResponse({
            generatedImages: [{ image: { imageBytes: "data" } }],
          }),
        ),
      );

      const result = await service.testModelConnectionWithKey(
        "google",
        "imagen-3",
        "key",
        "",
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("Imagen connection successful");
    });

    it("returns success with response keys when no image data (lines 269-274)", async () => {
      const { service, mockHttp } = await buildModule({});

      mockHttp.post.mockReturnValue(
        of(makeResponse({ someOtherKey: "value" })),
      );

      const result = await service.testModelConnectionWithKey(
        "google",
        "imagen-3",
        "key",
        "",
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("Response keys");
    });

    it("catches Imagen API error and returns failure (lines 275-294)", async () => {
      const { service, mockHttp } = await buildModule({});

      const err = Object.assign(new Error("Quota exceeded"), {
        response: { status: 429, data: { error: { message: "quota" } } },
      });
      mockHttp.post.mockReturnValue(throwError(() => err));

      const result = await service.testModelConnectionWithKey(
        "google",
        "imagen-3",
        "key",
        "",
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("Imagen test failed");
    });
  });

  // =========================================================================
  // Lines 296-347: Gemini non-imagen path (generateContent)
  // =========================================================================

  describe("Gemini non-imagen path (lines 296-347)", () => {
    it("uses generateContent endpoint for standard gemini model", async () => {
      const { service, mockHttp } = await buildModule({});

      mockHttp.post.mockReturnValue(
        of(
          makeResponse({
            candidates: [{ content: { parts: [{ text: "Hello" }] } }],
          }),
        ),
      );

      const result = await service.testModelConnectionWithKey(
        "gemini",
        "gemini-1.5-flash",
        "key",
        "",
      );

      expect(result.success).toBe(true);
      expect(mockHttp.post).toHaveBeenCalledWith(
        expect.stringContaining("generateContent"),
        expect.objectContaining({
          contents: expect.any(Array),
        }),
        expect.any(Object),
      );
    });

    it("uses provided apiEndpoint directly if it contains :generateContent", async () => {
      const { service, mockHttp } = await buildModule({});

      const customEndpoint =
        "https://custom.api.com/v1/models/gemini-flash:generateContent";
      mockHttp.post.mockReturnValue(
        of(
          makeResponse({
            candidates: [{ content: { parts: [{ text: "OK" }] } }],
          }),
        ),
      );

      await service.testModelConnectionWithKey(
        "google",
        "gemini-1.5-flash",
        "key",
        customEndpoint,
      );

      expect(mockHttp.post).toHaveBeenCalledWith(
        customEndpoint,
        expect.any(Object),
        expect.any(Object),
      );
    });

    it("sets no generationConfig for image-capable models (line 305)", async () => {
      const { service, mockHttp } = await buildModule({});

      mockHttp.post.mockReturnValue(
        of(
          makeResponse({
            candidates: [{ content: { parts: [{ text: "ok" }] } }],
          }),
        ),
      );

      await service.testModelConnectionWithKey(
        "google",
        "gemini-2.0-flash-exp",
        "key",
        "",
      );

      // Image capable model — body should NOT include generationConfig
      expect(mockHttp.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.not.objectContaining({ generationConfig: expect.anything() }),
        expect.any(Object),
      );
    });
  });

  // =========================================================================
  // Lines 353-370: Perplexity provider
  // =========================================================================

  describe("Perplexity provider (lines 353-370)", () => {
    it("calls perplexity chat completions endpoint", async () => {
      const { service, mockHttp } = await buildModule({});

      mockHttp.post.mockReturnValue(
        of(makeResponse({ choices: [{ message: { content: "Answer" } }] })),
      );

      const result = await service.testModelConnectionWithKey(
        "perplexity",
        "llama-3-sonar-large",
        "key",
        "",
      );

      expect(result.success).toBe(true);
      expect(mockHttp.post).toHaveBeenCalledWith(
        "https://api.perplexity.ai/chat/completions",
        expect.objectContaining({ max_tokens: 50 }),
        expect.any(Object),
      );
    });
  });

  // =========================================================================
  // Embedding model paths
  // =========================================================================

  describe("testEmbeddingModel - various paths", () => {
    it("openai embedding: response without embedding data falls through (line 514)", async () => {
      const { service, mockHttp } = await buildModule({});

      // data without embedding → falls through to generic success
      mockHttp.post.mockReturnValue(of(makeResponse({ data: [] })));

      const result = await service.testModelConnectionWithKey(
        "openai",
        "text-embedding-ada-002",
        "key",
        "",
        "EMBEDDING",
      );

      expect(result.success).toBe(true);
      expect(result.message).toBe("Embedding API responded successfully");
    });

    it("openai embedding: apiEndpoint already ends with /embeddings (line 482-484)", async () => {
      const { service, mockHttp } = await buildModule({});

      mockHttp.post.mockReturnValue(
        of(makeResponse({ data: [{ embedding: [0.1, 0.2] }] })),
      );

      const result = await service.testModelConnectionWithKey(
        "openai",
        "text-embedding-ada-002",
        "key",
        "https://api.openai.com/v1/embeddings",
        "EMBEDDING",
      );

      expect(result.success).toBe(true);
      expect(mockHttp.post).toHaveBeenCalledWith(
        "https://api.openai.com/v1/embeddings",
        expect.any(Object),
        expect.any(Object),
      );
    });

    it("cohere embedding: apiEndpoint already ends with /embed (line 521-522)", async () => {
      const { service, mockHttp } = await buildModule({});

      mockHttp.post.mockReturnValue(
        of(makeResponse({ embeddings: [[0.1, 0.2, 0.3]] })),
      );

      const result = await service.testModelConnectionWithKey(
        "cohere",
        "embed-english-v3.0",
        "key",
        "https://api.cohere.ai/v1/embed",
        "EMBEDDING",
      );

      expect(result.success).toBe(true);
      expect(mockHttp.post).toHaveBeenCalledWith(
        "https://api.cohere.ai/v1/embed",
        expect.any(Object),
        expect.any(Object),
      );
    });

    it("cohere embedding: response without embeddings array falls through (line 554)", async () => {
      const { service, mockHttp } = await buildModule({});

      mockHttp.post.mockReturnValue(of(makeResponse({ embeddings: [] })));

      const result = await service.testModelConnectionWithKey(
        "cohere",
        "embed-english-v3.0",
        "key",
        "",
        "EMBEDDING",
      );

      expect(result.success).toBe(true);
      expect(result.message).toBe("Embedding API responded successfully");
    });

    it("google embedding: returns success with dimensions (line 582-589)", async () => {
      const { service, mockHttp } = await buildModule({});

      mockHttp.post.mockReturnValue(
        of(makeResponse({ embedding: { values: [0.1, 0.2, 0.3] } })),
      );

      const result = await service.testModelConnectionWithKey(
        "google",
        "text-embedding-004",
        "key",
        "",
        "EMBEDDING",
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("Dimensions: 3");
    });

    it("google embedding: response without values falls through (line 591)", async () => {
      const { service, mockHttp } = await buildModule({});

      mockHttp.post.mockReturnValue(of(makeResponse({ embedding: {} })));

      const result = await service.testModelConnectionWithKey(
        "google",
        "text-embedding-004",
        "key",
        "",
        "EMBEDDING",
      );

      expect(result.success).toBe(true);
      expect(result.message).toBe("Embedding API responded successfully");
    });

    it("embedding: unsupported provider without endpoint returns failure", async () => {
      const { service } = await buildModule({});

      const result = await service.testModelConnectionWithKey(
        "huggingface",
        "some-embedding",
        "key",
        "",
        "EMBEDDING",
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("未声明 embedding endpoint");
    });

    it("embedding: ECONNABORTED error (line 618)", async () => {
      const { service, mockHttp } = await buildModule({});

      const err = Object.assign(new Error("timeout"), { code: "ECONNABORTED" });
      mockHttp.post.mockReturnValue(throwError(() => err));

      const result = await service.testModelConnectionWithKey(
        "openai",
        "text-embedding-3-small",
        "key",
        "",
        "EMBEDDING",
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("Connection timeout");
    });

    it("embedding: err.message error path (line 620-621)", async () => {
      const { service, mockHttp } = await buildModule({});

      const err = new Error("Network unreachable");
      mockHttp.post.mockReturnValue(throwError(() => err));

      const result = await service.testModelConnectionWithKey(
        "openai",
        "text-embedding-3-small",
        "key",
        "",
        "EMBEDDING",
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("Network unreachable");
    });

    it("embedding: API error response (line 613-617)", async () => {
      const { service, mockHttp } = await buildModule({});

      const err = Object.assign(new Error("Bad request"), {
        response: {
          status: 400,
          data: { error: { message: "Invalid input" } },
        },
      });
      mockHttp.post.mockReturnValue(throwError(() => err));

      const result = await service.testModelConnectionWithKey(
        "openai",
        "text-embedding-3-small",
        "key",
        "",
        "EMBEDDING",
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("API Error (400)");
      expect(result.message).toContain("Invalid input");
    });
  });

  // =========================================================================
  // Rerank model paths (lines 683, 693-694, 709-712)
  // =========================================================================

  describe("testRerankModel - various paths", () => {
    it("cohere rerank: returns success when results present (line 673-681)", async () => {
      const { service, mockHttp } = await buildModule({});

      mockHttp.post.mockReturnValue(
        of(
          makeResponse({
            results: [{ relevance_score: 0.9873 }],
          }),
        ),
      );

      const result = await service.testModelConnectionWithKey(
        "cohere",
        "rerank-v3.5",
        "key",
        "",
        "RERANK",
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("Rerank model connected");
      expect(result.message).toContain("0.9873");
    });

    it("cohere rerank: response without results falls through (line 693-694)", async () => {
      const { service, mockHttp } = await buildModule({});

      mockHttp.post.mockReturnValue(of(makeResponse({ results: [] })));

      const result = await service.testModelConnectionWithKey(
        "cohere",
        "rerank-v3.5",
        "key",
        "",
        "RERANK",
      );

      // results is falsy (empty array is truthy but results[0] is undefined...)
      // Actually [] is truthy so it enters the if-block but score is "N/A"
      expect(result.success).toBe(true);
    });

    it("rerank: unsupported provider without endpoint returns failure", async () => {
      const { service } = await buildModule({});

      const result = await service.testModelConnectionWithKey(
        "openai",
        "rerank-model",
        "key",
        "",
        "RERANK",
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("未声明 rerank endpoint");
    });

    it("rerank: ECONNABORTED error (line 709)", async () => {
      const { service, mockHttp } = await buildModule({});

      const err = Object.assign(new Error("timeout"), { code: "ECONNABORTED" });
      mockHttp.post.mockReturnValue(throwError(() => err));

      const result = await service.testModelConnectionWithKey(
        "cohere",
        "rerank-v3.5",
        "key",
        "",
        "RERANK",
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("Connection timeout");
    });

    it("rerank: err.message error path (line 711-712)", async () => {
      const { service, mockHttp } = await buildModule({});

      const err = new Error("DNS lookup failed");
      mockHttp.post.mockReturnValue(throwError(() => err));

      const result = await service.testModelConnectionWithKey(
        "cohere",
        "rerank-v3.5",
        "key",
        "",
        "RERANK",
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("DNS lookup failed");
    });

    it("rerank: API error response (line 704-708)", async () => {
      const { service, mockHttp } = await buildModule({});

      const err = Object.assign(new Error("Forbidden"), {
        response: { status: 403, data: { message: "Not authorized" } },
      });
      mockHttp.post.mockReturnValue(throwError(() => err));

      const result = await service.testModelConnectionWithKey(
        "cohere",
        "rerank-v3.5",
        "key",
        "",
        "RERANK",
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("API Error (403)");
      expect(result.message).toContain("Not authorized");
    });

    // 回归 P3-#9 (2026-05-13): 405 + 空 body 是 admin 配错 endpoint 的典型模式。
    // 错误信息必须带 attempted URL + 引导文案，admin 才能立即诊断（之前
    // 是 `API Error (405): ""` 完全没诊断信息）。
    it("rerank: 405 includes attempted URL + endpoint diagnosis hint", async () => {
      const { service, mockHttp } = await buildModule({});

      const err = Object.assign(new Error("Method Not Allowed"), {
        response: { status: 405, data: {} },
      });
      mockHttp.post.mockReturnValue(throwError(() => err));

      const result = await service.testModelConnectionWithKey(
        "cohere",
        "rerank-v3.5",
        "key",
        "",
        "RERANK",
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("API Error (405)");
      // 应该带 attempted URL（默认 cohere endpoint 被命中）
      expect(result.message).toContain("https://api.cohere.com/v1/rerank");
      // 应该带诊断引导
      expect(result.message).toMatch(/Endpoint 拼接后|检查 admin Add Model/);
    });

    it("rerank: 405 empty data shows (empty body) instead of {}", async () => {
      const { service, mockHttp } = await buildModule({});

      const err = Object.assign(new Error("Method Not Allowed"), {
        response: { status: 405, data: undefined },
      });
      mockHttp.post.mockReturnValue(throwError(() => err));

      const result = await service.testModelConnectionWithKey(
        "cohere",
        "rerank-v3.5",
        "key",
        "",
        "RERANK",
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("(empty body)");
    });
  });

  // =========================================================================
  // TTS/Audio model (lines 735-766)
  // =========================================================================

  describe("testTTSModel", () => {
    // ★ 2026-05-13: TTS test 不再"fake success"，必须真发请求验证
    //   feedback_test_connection_must_verify_runtime；下面 4 个用例同步重写。

    it("real HTTP POST to /v1/audio/speech for OpenAI TTS modelType", async () => {
      const { service, mockHttp } = await buildModule({});
      mockHttp.post.mockReturnValueOnce(
        of({
          status: 200,
          data: Buffer.from("audio-bytes"),
        }) as never,
      );

      const result = await service.testModelConnectionWithKey(
        "openai",
        "tts-1",
        "key",
        "https://api.openai.com/v1",
        "TTS",
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("TTS connection OK");
      expect(mockHttp.post).toHaveBeenCalledWith(
        "https://api.openai.com/v1/audio/speech",
        expect.objectContaining({ model: "tts-1" }),
        expect.any(Object),
      );
    });

    it("real HTTP POST for AUDIO modelType", async () => {
      const { service, mockHttp } = await buildModule({});
      mockHttp.post.mockReturnValueOnce(
        of({
          status: 200,
          data: Buffer.from("audio-bytes"),
        }) as never,
      );

      const result = await service.testModelConnectionWithKey(
        "openai",
        "whisper-1",
        "key",
        "https://api.openai.com/v1",
        "AUDIO",
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("TTS connection OK");
    });

    it("probes Gemini /v1beta/models for google provider", async () => {
      const { service, mockHttp } = await buildModule({});
      mockHttp.get.mockReturnValueOnce(
        of({ status: 200, data: { models: [] } }) as never,
      );

      const result = await service.testModelConnectionWithKey(
        "google",
        "some-tts-model",
        "key",
        "https://generativelanguage.googleapis.com",
        "TTS",
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("Gemini TTS endpoint reachable");
      expect(mockHttp.get).toHaveBeenCalled();
    });

    it("makes real HTTP call for model with tts in modelId (no modelType)", async () => {
      const { service, mockHttp } = await buildModule({});
      mockHttp.post.mockReturnValueOnce(
        of({
          status: 200,
          data: Buffer.from("audio-bytes"),
        }) as never,
      );

      // modelId contains "tts" → routes to testTTSModel
      const result = await service.testModelConnectionWithKey(
        "openai",
        "tts-1-hd",
        "key",
        "https://api.openai.com/v1",
        // no modelType
      );

      expect(result.success).toBe(true);
      // TTS path now DOES call httpService.post (real test request)
      expect(mockHttp.post).toHaveBeenCalled();
    });
  });
});
