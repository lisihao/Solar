import { Test, TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { of, throwError } from "rxjs";
import { AxiosError, AxiosResponse } from "axios";
import { AiConnectionTestService } from "../ai-connection-test.service";

describe("AiConnectionTestService", () => {
  let service: AiConnectionTestService;

  const mockHttpService = {
    post: jest.fn(),
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiConnectionTestService,
        {
          provide: HttpService,
          useValue: mockHttpService,
        },
      ],
    }).compile();

    service = module.get<AiConnectionTestService>(AiConnectionTestService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("testModelConnectionWithKey", () => {
    describe("Missing API Key", () => {
      it("should return failure when API key is not provided", async () => {
        const result = await service.testModelConnectionWithKey(
          "openai",
          "gpt-4",
          "",
          "https://api.openai.com/v1/chat/completions",
        );

        expect(result.success).toBe(false);
        expect(result.message).toBe("API key is not configured");
        expect(result.latency).toBe(0);
      });
    });

    describe("OpenAI Provider", () => {
      it("should successfully test OpenAI connection with non-reasoning model", async () => {
        const mockResponse: AxiosResponse = {
          data: {
            choices: [
              {
                message: {
                  content: "OK",
                },
              },
            ],
          },
          status: 200,
          statusText: "OK",
          headers: {},
          config: {} as any,
        };

        mockHttpService.post.mockReturnValue(of(mockResponse));

        const result = await service.testModelConnectionWithKey(
          "openai",
          "gpt-4",
          "test-api-key",
          "https://api.openai.com/v1/chat/completions",
        );

        expect(result.success).toBe(true);
        expect(result.message).toContain("Connection successful!");
        expect(result.message).toContain("OK");
        expect(result.latency).toBeGreaterThanOrEqual(0);

        expect(mockHttpService.post).toHaveBeenCalledWith(
          "https://api.openai.com/v1/chat/completions",
          expect.objectContaining({
            model: "gpt-4",
            messages: [
              {
                role: "user",
                content: "Say 'OK' to confirm you are working.",
              },
            ],
            max_tokens: 50,
            temperature: 0,
          }),
          expect.objectContaining({
            headers: {
              Authorization: "Bearer test-api-key",
              "Content-Type": "application/json",
            },
            timeout: 30000,
          }),
        );
      });

      it("cohere rerank: chat endpoint 剥到 base 再拼 /rerank（不发 /chat/rerank → 405）", async () => {
        // 一键配置/provider 常给 rerank 模型存 chat endpoint（rerank 与 chat 共用字段）。
        // 修复前直接拼成 https://api.cohere.com/v1/chat/rerank → provider 405 empty body。
        mockHttpService.post.mockReturnValue(
          of({
            data: { results: [{ index: 0, relevance_score: 0.99 }] },
            status: 200,
            statusText: "OK",
            headers: {},
            config: {} as any,
          } as AxiosResponse),
        );

        await service.testModelConnectionWithKey(
          "cohere",
          "rerank-v3.5",
          "test-api-key",
          "https://api.cohere.com/v1/chat",
          "RERANK",
        );

        const calledUrl = mockHttpService.post.mock.calls[0][0] as string;
        expect(calledUrl).toBe("https://api.cohere.com/v1/rerank");
        expect(calledUrl).not.toContain("/chat/rerank");
      });

      // ★ 根因回归：连接测试发生在「模型配置保存前」，此时 DB 还没有这条 config，
      //   modelConfigService.isReasoningModel 走缓存 + DB 兜底均 miss 返 false。
      //   修复前 inferIsReasoning 仅信 isReasoningModel → tokenParamName 走 max_tokens
      //   → OpenAI reasoning 模型（gpt-5.4）报 "Unsupported parameter: max_tokens" 假阴性。
      //   修复后 DB 判断与 model.utils 启发式取或：启发式认 gpt-5 → max_completion_tokens。
      it("uses max_completion_tokens for gpt-5.4 even when DB isReasoningModel returns false (pre-save test)", async () => {
        const modelConfigMock = {
          // 模拟测试时 DB 无该模型：缓存 + DB fallback 全 miss → 启发式也没命中（这里强制 false）
          isReasoningModel: jest.fn().mockReturnValue(false),
          getModelConfig: jest.fn().mockResolvedValue(null),
        };
        const module: TestingModule = await Test.createTestingModule({
          providers: [
            AiConnectionTestService,
            { provide: HttpService, useValue: mockHttpService },
            {
              provide: (
                await import("../../models/config/ai-model-config.service")
              ).AiModelConfigService,
              useValue: modelConfigMock,
            },
          ],
        }).compile();
        const svcWithDb = module.get<AiConnectionTestService>(
          AiConnectionTestService,
        );

        mockHttpService.post.mockReturnValue(
          of({
            data: { choices: [{ message: { content: "OK" } }] },
            status: 200,
            statusText: "OK",
            headers: {},
            config: {} as any,
          } as AxiosResponse),
        );

        await svcWithDb.testModelConnectionWithKey(
          "openai",
          "gpt-5.4",
          "test-api-key",
          "https://api.openai.com/v1/chat/completions",
        );

        // DB 返 false 但 model.utils 启发式认 gpt-5 → OR → max_completion_tokens
        expect(modelConfigMock.isReasoningModel).toHaveBeenCalledWith(
          "gpt-5.4",
        );
        const body = mockHttpService.post.mock.calls[0][1];
        // reasoning 模型给 512 预算（避免隐藏 CoT 吃光）+ 省略 temperature
        expect(body).toHaveProperty("max_completion_tokens", 512);
        expect(body).not.toHaveProperty("max_tokens");
        expect(body).not.toHaveProperty("temperature");
      });

      // ★ reasoning 模型只接受默认 temperature——显式传 0 触发 OpenAI
      //   400 "Unsupported value: 'temperature' does not support 0" 假阴性。
      //   修复：reasoning 分支完全省略 temperature，并给 512 预算（避免隐藏 CoT
      //   吃光小预算导致 finish_reason=length 空响应假阳性）。
      it("omits temperature and uses larger budget for reasoning models (o1)", async () => {
        mockHttpService.post.mockReturnValue(
          of({
            data: { choices: [{ message: { content: "OK" } }] },
            status: 200,
            statusText: "OK",
            headers: {},
            config: {} as any,
          } as AxiosResponse),
        );

        await service.testModelConnectionWithKey(
          "openai",
          "o1-preview",
          "test-api-key",
          "https://api.openai.com/v1/chat/completions",
        );

        const body = mockHttpService.post.mock.calls[0][1];
        expect(body).toHaveProperty("max_completion_tokens", 512);
        expect(body).not.toHaveProperty("temperature");
        expect(body).not.toHaveProperty("max_tokens");
      });

      it("keeps temperature:0 and 50-token budget for non-reasoning models (gpt-4)", async () => {
        mockHttpService.post.mockReturnValue(
          of({
            data: { choices: [{ message: { content: "OK" } }] },
            status: 200,
            statusText: "OK",
            headers: {},
            config: {} as any,
          } as AxiosResponse),
        );

        await service.testModelConnectionWithKey(
          "openai",
          "gpt-4",
          "test-api-key",
          "https://api.openai.com/v1/chat/completions",
        );

        const body = mockHttpService.post.mock.calls[0][1];
        expect(body).toHaveProperty("max_tokens", 50);
        expect(body).toHaveProperty("temperature", 0);
        expect(body).not.toHaveProperty("max_completion_tokens");
      });

      // ★ reasoning 模型隐藏 CoT 吃光 token → finish_reason=length 且 content 空。
      //   修复前会假阳性报 "Connection successful! Response: """；现报可诊断失败。
      it("reports failure (not fake success) when reasoning model truncates with empty content", async () => {
        mockHttpService.post.mockReturnValue(
          of({
            data: {
              choices: [{ message: { content: "" }, finish_reason: "length" }],
            },
            status: 200,
            statusText: "OK",
            headers: {},
            config: {} as any,
          } as AxiosResponse),
        );

        const result = await service.testModelConnectionWithKey(
          "openai",
          "o1-preview",
          "test-api-key",
          "https://api.openai.com/v1/chat/completions",
        );

        expect(result.success).toBe(false);
        expect(result.message).toContain("truncated");
        expect(result.message).toContain("token budget");
      });

      it("should use max_completion_tokens for deepseek-r1 reasoning model", async () => {
        const mockResponse: AxiosResponse = {
          data: {
            choices: [
              {
                message: {
                  content: "OK",
                },
              },
            ],
          },
          status: 200,
          statusText: "OK",
          headers: {},
          config: {} as any,
        };

        mockHttpService.post.mockReturnValue(of(mockResponse));

        await service.testModelConnectionWithKey(
          "openai",
          "deepseek-r1",
          "test-api-key",
          "https://api.openai.com/v1/chat/completions",
        );

        expect(mockHttpService.post).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            max_completion_tokens: 512,
          }),
          expect.any(Object),
        );
      });
    });

    describe("Anthropic Provider", () => {
      it("should successfully test Anthropic connection", async () => {
        const mockResponse: AxiosResponse = {
          data: {
            content: [
              {
                text: "OK, I'm working.",
              },
            ],
          },
          status: 200,
          statusText: "OK",
          headers: {},
          config: {} as any,
        };

        mockHttpService.post.mockReturnValue(of(mockResponse));

        const result = await service.testModelConnectionWithKey(
          "anthropic",
          "claude-3-sonnet-20240229",
          "test-api-key",
          "https://api.anthropic.com/v1/messages",
        );

        expect(result.success).toBe(true);
        expect(result.message).toContain("Connection successful!");
        expect(result.message).toContain("OK, I'm working.");
        expect(result.latency).toBeGreaterThanOrEqual(0);

        expect(mockHttpService.post).toHaveBeenCalledWith(
          "https://api.anthropic.com/v1/messages",
          expect.objectContaining({
            model: "claude-3-sonnet-20240229",
            max_tokens: 50,
            messages: [
              {
                role: "user",
                content: "Say 'OK' to confirm you are working.",
              },
            ],
          }),
          expect.objectContaining({
            headers: {
              "x-api-key": "test-api-key",
              "anthropic-version": "2023-06-01",
              "Content-Type": "application/json",
            },
            timeout: 30000,
          }),
        );
      });

      // Anthropic content[] 可能含多个 block；应拼接所有 text block。
      it("concatenates multiple Anthropic text blocks", async () => {
        mockHttpService.post.mockReturnValue(
          of({
            data: {
              content: [
                { type: "text", text: "Hello " },
                { type: "text", text: "world" },
              ],
              stop_reason: "end_turn",
            },
            status: 200,
            statusText: "OK",
            headers: {},
            config: {} as any,
          } as AxiosResponse),
        );

        const result = await service.testModelConnectionWithKey(
          "anthropic",
          "claude-3-5-sonnet-20241022",
          "test-api-key",
          "https://api.anthropic.com/v1/messages",
        );

        expect(result.success).toBe(true);
        expect(result.message).toContain("Hello world");
      });

      // Claude 截断（max_tokens）且无可见内容 → 报可诊断失败而非假阳性成功。
      it("reports failure when Claude truncates with empty content", async () => {
        mockHttpService.post.mockReturnValue(
          of({
            data: { content: [], stop_reason: "max_tokens" },
            status: 200,
            statusText: "OK",
            headers: {},
            config: {} as any,
          } as AxiosResponse),
        );

        const result = await service.testModelConnectionWithKey(
          "claude",
          "claude-3-opus-20240229",
          "test-api-key",
          "https://api.anthropic.com/v1/messages",
        );

        expect(result.success).toBe(false);
        expect(result.message).toContain("truncated");
      });

      it("should use claude alias for anthropic provider", async () => {
        const mockResponse: AxiosResponse = {
          data: {
            content: [
              {
                text: "OK",
              },
            ],
          },
          status: 200,
          statusText: "OK",
          headers: {},
          config: {} as any,
        };

        mockHttpService.post.mockReturnValue(of(mockResponse));

        await service.testModelConnectionWithKey(
          "claude",
          "claude-3-opus-20240229",
          "test-api-key",
          "https://api.anthropic.com/v1/messages",
        );

        expect(mockHttpService.post).toHaveBeenCalled();
      });
    });

    describe("Google/Gemini Provider", () => {
      it("should successfully test Gemini connection", async () => {
        const mockResponse: AxiosResponse = {
          data: {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: "OK, confirmed working.",
                    },
                  ],
                },
              },
            ],
          },
          status: 200,
          statusText: "OK",
          headers: {},
          config: {} as any,
        };

        mockHttpService.post.mockReturnValue(of(mockResponse));

        const result = await service.testModelConnectionWithKey(
          "google",
          "gemini-pro",
          "test-api-key",
          "https://generativelanguage.googleapis.com/v1beta/models",
        );

        expect(result.success).toBe(true);
        expect(result.message).toContain("Connection successful!");
        expect(result.message).toContain("OK, confirmed working.");
        expect(result.latency).toBeGreaterThanOrEqual(0);

        expect(mockHttpService.post).toHaveBeenCalledWith(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
          expect.objectContaining({
            contents: [
              {
                parts: [{ text: "Say 'OK' to confirm you are working." }],
              },
            ],
            generationConfig: {
              maxOutputTokens: 50,
              temperature: 0,
            },
          }),
          expect.objectContaining({
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": "test-api-key",
            },
            timeout: 30000,
          }),
        );
      });

      // gemini-2.5 / gemini-3 是 thinking 模型，小预算会被隐藏 thinking token 吃光。
      // 修复：thinking 模型 maxOutputTokens 用 512，普通模型保持 50。
      it("uses larger maxOutputTokens for thinking models (gemini-2.5)", async () => {
        mockHttpService.post.mockReturnValue(
          of({
            data: {
              candidates: [{ content: { parts: [{ text: "OK" }] } }],
            },
            status: 200,
            statusText: "OK",
            headers: {},
            config: {} as any,
          } as AxiosResponse),
        );

        await service.testModelConnectionWithKey(
          "google",
          "gemini-2.5-pro",
          "test-api-key",
          "https://generativelanguage.googleapis.com/v1beta/models",
        );

        const body = mockHttpService.post.mock.calls[0][1];
        expect(body.generationConfig).toMatchObject({
          maxOutputTokens: 512,
          temperature: 0,
        });
      });

      // Gemini 截断（MAX_TOKENS）且 parts 为空 → 报可诊断失败而非假阳性成功。
      it("reports failure when Gemini truncates with empty parts", async () => {
        mockHttpService.post.mockReturnValue(
          of({
            data: {
              candidates: [
                { content: { parts: [] }, finishReason: "MAX_TOKENS" },
              ],
            },
            status: 200,
            statusText: "OK",
            headers: {},
            config: {} as any,
          } as AxiosResponse),
        );

        const result = await service.testModelConnectionWithKey(
          "google",
          "gemini-2.5-pro",
          "test-api-key",
          "https://generativelanguage.googleapis.com/v1beta/models",
        );

        expect(result.success).toBe(false);
        expect(result.message).toContain("truncated");
      });

      it("should test Imagen model with different endpoint", async () => {
        const mockResponse: AxiosResponse = {
          data: {
            predictions: [
              {
                bytesBase64Encoded: "base64-image-data",
              },
            ],
          },
          status: 200,
          statusText: "OK",
          headers: {},
          config: {} as any,
        };

        mockHttpService.post.mockReturnValue(of(mockResponse));

        const result = await service.testModelConnectionWithKey(
          "google",
          "imagen-3.0-generate-001",
          "test-api-key",
          "https://generativelanguage.googleapis.com/v1beta/models",
        );

        expect(result.success).toBe(true);
        expect(result.message).toContain("Imagen connection successful!");
        expect(result.latency).toBeGreaterThanOrEqual(0);

        expect(mockHttpService.post).toHaveBeenCalledWith(
          expect.stringContaining("imagen-3.0-generate-001:predict"),
          expect.objectContaining({
            instances: [
              {
                prompt: "A simple blue circle on white background",
              },
            ],
          }),
          expect.any(Object),
        );
      });
    });

    describe("xAI/Grok Provider", () => {
      it("should successfully test xAI Grok connection", async () => {
        const mockResponse: AxiosResponse = {
          data: {
            choices: [
              {
                message: {
                  content: "4",
                },
              },
            ],
          },
          status: 200,
          statusText: "OK",
          headers: {},
          config: {} as any,
        };

        mockHttpService.post.mockReturnValue(of(mockResponse));

        const result = await service.testModelConnectionWithKey(
          "xai",
          "grok-beta",
          "test-api-key",
          "https://api.x.ai/v1/chat/completions",
        );

        expect(result.success).toBe(true);
        expect(result.message).toContain("Connection successful!");
        expect(result.latency).toBeGreaterThanOrEqual(0);

        expect(mockHttpService.post).toHaveBeenCalledWith(
          "https://api.x.ai/v1/chat/completions",
          expect.objectContaining({
            model: "grok-beta",
            messages: [
              {
                role: "user",
                content: "What is 2+2?",
              },
            ],
            max_tokens: 50,
            temperature: 0,
          }),
          expect.any(Object),
        );
      });
    });

    describe("Chinese Providers", () => {
      it("should successfully test DeepSeek connection", async () => {
        const mockResponse: AxiosResponse = {
          data: {
            choices: [
              {
                message: {
                  content: "OK",
                },
              },
            ],
          },
          status: 200,
          statusText: "OK",
          headers: {},
          config: {} as any,
        };

        mockHttpService.post.mockReturnValue(of(mockResponse));

        const result = await service.testModelConnectionWithKey(
          "deepseek",
          "deepseek-chat",
          "test-api-key",
          "https://api.deepseek.com/v1/chat/completions",
        );

        expect(result.success).toBe(true);
        expect(result.message).toContain("Connection successful!");
        expect(result.latency).toBeGreaterThanOrEqual(0);

        expect(mockHttpService.post).toHaveBeenCalledWith(
          "https://api.deepseek.com/v1/chat/completions",
          expect.objectContaining({
            model: "deepseek-chat",
            messages: [
              {
                role: "user",
                content: "Say 'OK' to confirm you are working.",
              },
            ],
            max_tokens: 50,
            temperature: 0,
          }),
          expect.any(Object),
        );
      });

      it("should successfully test Qwen connection", async () => {
        const mockResponse: AxiosResponse = {
          data: {
            choices: [
              {
                message: {
                  content: "OK",
                },
              },
            ],
          },
          status: 200,
          statusText: "OK",
          headers: {},
          config: {} as any,
        };

        mockHttpService.post.mockReturnValue(of(mockResponse));

        await service.testModelConnectionWithKey(
          "qwen",
          "qwen-turbo",
          "test-api-key",
          "https://dashscope.aliyuncs.com/api/v1/services/chat/completions",
        );

        expect(mockHttpService.post).toHaveBeenCalled();
      });

      // 2026-05-10 §2 回归：endpoint 为空时走 DB ai_providers 真源（经
      // UserApiKeysService.resolveProviderDefaults）而不是 POST 空字符串
      it("resolves OpenAI-compatible endpoint via DB when override is empty", async () => {
        const userApiKeysMock = {
          resolveProviderDefaults: jest.fn().mockResolvedValue({
            endpoint: "https://api.deepseek.com/v1",
            apiFormat: "openai",
            testModel: "deepseek-chat",
          }),
        };
        const module: TestingModule = await Test.createTestingModule({
          providers: [
            AiConnectionTestService,
            { provide: HttpService, useValue: mockHttpService },
            {
              provide: (
                await import("@/modules/platform/credentials/user-owned/user-api-keys/user-api-keys.service")
              ).UserApiKeysService,
              useValue: userApiKeysMock,
            },
          ],
        }).compile();
        const svcWithDb = module.get<AiConnectionTestService>(
          AiConnectionTestService,
        );

        mockHttpService.post.mockReturnValue(
          of({
            data: { choices: [{ message: { content: "OK" } }] },
            status: 200,
            statusText: "OK",
            headers: {},
            config: {} as any,
          } as AxiosResponse),
        );

        await svcWithDb.testModelConnectionWithKey(
          "deepseek",
          "deepseek-reasoner",
          "test-key",
          "", // override 为空 → 应走 DB 真源
        );

        expect(userApiKeysMock.resolveProviderDefaults).toHaveBeenCalledWith(
          "deepseek",
        );
        expect(mockHttpService.post).toHaveBeenCalledWith(
          "https://api.deepseek.com/v1/chat/completions",
          expect.any(Object),
          expect.any(Object),
        );
      });

      it("returns clean error when DB has no row for provider and override empty", async () => {
        const userApiKeysMock = {
          resolveProviderDefaults: jest.fn().mockResolvedValue(null),
        };
        const module: TestingModule = await Test.createTestingModule({
          providers: [
            AiConnectionTestService,
            { provide: HttpService, useValue: mockHttpService },
            {
              provide: (
                await import("@/modules/platform/credentials/user-owned/user-api-keys/user-api-keys.service")
              ).UserApiKeysService,
              useValue: userApiKeysMock,
            },
          ],
        }).compile();
        const svcWithDb = module.get<AiConnectionTestService>(
          AiConnectionTestService,
        );

        // 用 deepseek（在 OpenAI-compatible switch 列表里）让分支命中新逻辑；
        // DB resolver 返回 null → 测试服务应给清晰错误而不是 POST 空字符串
        const result = await svcWithDb.testModelConnectionWithKey(
          "deepseek",
          "deepseek-chat",
          "test-key",
          "",
        );

        expect(result.success).toBe(false);
        expect(result.message).toContain("没有可用的 chat endpoint");
        expect(mockHttpService.post).not.toHaveBeenCalled();
      });
    });

    describe("Error Handling", () => {
      it("should handle 401 unauthorized error", async () => {
        const mockError = {
          response: {
            status: 401,
            data: {
              error: {
                message: "Invalid API key",
              },
            },
          },
        } as AxiosError;

        mockHttpService.post.mockReturnValue(throwError(() => mockError));

        const result = await service.testModelConnectionWithKey(
          "openai",
          "gpt-4",
          "invalid-key",
          "https://api.openai.com/v1/chat/completions",
        );

        expect(result.success).toBe(false);
        expect(result.message).toContain("API Error (401)");
        expect(result.message).toContain("Invalid API key");
        expect(result.latency).toBeGreaterThanOrEqual(0);
      });

      it("should handle connection timeout", async () => {
        const mockError = {
          code: "ECONNABORTED",
          message: "timeout of 30000ms exceeded",
        } as AxiosError;

        mockHttpService.post.mockReturnValue(throwError(() => mockError));

        const result = await service.testModelConnectionWithKey(
          "openai",
          "gpt-4",
          "test-api-key",
          "https://api.openai.com/v1/chat/completions",
        );

        expect(result.success).toBe(false);
        expect(result.message).toContain("Connection timeout");
        expect(result.latency).toBeGreaterThanOrEqual(0);
      });

      it("should handle network error without response", async () => {
        const mockError = {
          message: "Network Error: getaddrinfo ENOTFOUND",
        } as AxiosError;

        mockHttpService.post.mockReturnValue(throwError(() => mockError));

        const result = await service.testModelConnectionWithKey(
          "openai",
          "gpt-4",
          "test-api-key",
          "https://api.openai.com/v1/chat/completions",
        );

        expect(result.success).toBe(false);
        expect(result.message).toContain("Network Error");
        expect(result.latency).toBeGreaterThanOrEqual(0);
      });

      it("should fallback to OpenAI-compat dispatch for unknown provider with endpoint", async () => {
        // 2026-05-11 P4: 未知 provider + 给了 apiEndpoint → 走 generic openai-compat
        // dispatcher，不再硬拒"Unsupported provider"。admin 在 UI 加新 provider
        // 时不必改代码。
        const mockResponse: AxiosResponse = {
          data: { choices: [{ message: { content: "OK" } }] },
          status: 200,
          statusText: "OK",
          headers: {},
          config: {} as any,
        };
        mockHttpService.post.mockReturnValue(of(mockResponse));

        const result = await service.testModelConnectionWithKey(
          "unsupported-provider",
          "some-model",
          "test-api-key",
          "https://api.example.com/v1/chat/completions",
        );

        expect(result.success).toBe(true);
        expect(result.message).toContain("Connection successful");
        expect(result.latency).toBeGreaterThanOrEqual(0);
      });

      it("should return failure for unknown provider WITHOUT endpoint", async () => {
        // 兜底真没法：DB 也没该 provider，调用方也没给 endpoint → 友好报错
        const result = await service.testModelConnectionWithKey(
          "unsupported-provider",
          "some-model",
          "test-api-key",
          "",
        );

        expect(result.success).toBe(false);
        expect(result.message).toContain("admin /admin/ai-providers");
        expect(result.latency).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe("testEmbeddingModel (EMBEDDING modelType)", () => {
    it("should successfully test OpenAI embedding model", async () => {
      const mockResponse: AxiosResponse = {
        data: {
          data: [
            {
              embedding: new Array(1536).fill(0.1),
            },
          ],
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as any,
      };

      mockHttpService.post.mockReturnValue(of(mockResponse));

      const result = await service.testModelConnectionWithKey(
        "openai",
        "text-embedding-3-small",
        "test-api-key",
        "https://api.openai.com/v1",
        "EMBEDDING",
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("Embedding model connected!");
      expect(result.message).toContain("Dimensions: 1536");
      expect(result.latency).toBeGreaterThanOrEqual(0);

      expect(mockHttpService.post).toHaveBeenCalledWith(
        "https://api.openai.com/v1/embeddings",
        expect.objectContaining({
          model: "text-embedding-3-small",
          input: "Hello, this is a test.",
        }),
        expect.any(Object),
      );
    });

    it("should successfully test Cohere embedding model", async () => {
      const mockResponse: AxiosResponse = {
        data: {
          embeddings: [new Array(1024).fill(0.2)],
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as any,
      };

      mockHttpService.post.mockReturnValue(of(mockResponse));

      const result = await service.testModelConnectionWithKey(
        "cohere",
        "embed-english-v3.0",
        "test-api-key",
        "https://api.cohere.ai/v1",
        "EMBEDDING",
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("Embedding model connected!");
      expect(result.message).toContain("Dimensions: 1024");
      expect(result.latency).toBeGreaterThanOrEqual(0);

      expect(mockHttpService.post).toHaveBeenCalledWith(
        "https://api.cohere.ai/v1/embed",
        expect.objectContaining({
          model: "embed-english-v3.0",
          texts: ["Hello, this is a test."],
          input_type: "search_document",
        }),
        expect.any(Object),
      );
    });

    it("should successfully test Google embedding model", async () => {
      const mockResponse: AxiosResponse = {
        data: {
          embedding: {
            values: new Array(768).fill(0.3),
          },
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as any,
      };

      mockHttpService.post.mockReturnValue(of(mockResponse));

      const result = await service.testModelConnectionWithKey(
        "google",
        "text-embedding-004",
        "test-api-key",
        "https://generativelanguage.googleapis.com/v1beta",
        "EMBEDDING",
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("Embedding model connected!");
      expect(result.message).toContain("Dimensions: 768");
      expect(result.latency).toBeGreaterThanOrEqual(0);

      expect(mockHttpService.post).toHaveBeenCalledWith(
        expect.stringContaining("text-embedding-004:embedContent"),
        expect.objectContaining({
          content: {
            parts: [{ text: "Hello, this is a test." }],
          },
        }),
        expect.any(Object),
      );
    });

    // ★ 2026-05-11 拉齐 BYOK：未知 provider 但有 endpoint 时按 OpenAI-compat
    //   兜底，不再硬拒。endpoint 缺失才返失败提示。
    it("should fail when unsupported embedding provider has no endpoint", async () => {
      const result = await service.testModelConnectionWithKey(
        "unsupported-provider",
        "some-embedding-model",
        "test-api-key",
        "", // no endpoint
        "EMBEDDING",
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("未声明 embedding endpoint");
    });

    it("should handle embedding API error", async () => {
      const mockError = {
        response: {
          status: 403,
          data: {
            error: {
              message: "Insufficient quota",
            },
          },
        },
      } as AxiosError;

      mockHttpService.post.mockReturnValue(throwError(() => mockError));

      const result = await service.testModelConnectionWithKey(
        "openai",
        "text-embedding-3-small",
        "test-api-key",
        "https://api.openai.com/v1",
        "EMBEDDING",
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("API Error (403)");
      expect(result.message).toContain("Insufficient quota");
    });
  });

  describe("testRerankModel (RERANK modelType)", () => {
    it("should successfully test Cohere rerank model", async () => {
      const mockResponse: AxiosResponse = {
        data: {
          results: [
            {
              index: 0,
              relevance_score: 0.9876,
            },
            {
              index: 1,
              relevance_score: 0.1234,
            },
          ],
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as any,
      };

      mockHttpService.post.mockReturnValue(of(mockResponse));

      const result = await service.testModelConnectionWithKey(
        "cohere",
        "rerank-v3.5",
        "test-api-key",
        "https://api.cohere.ai/v1/rerank",
        "RERANK",
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("Rerank model connected!");
      expect(result.message).toContain("Top relevance score: 0.9876");
      expect(result.latency).toBeGreaterThanOrEqual(0);

      expect(mockHttpService.post).toHaveBeenCalledWith(
        "https://api.cohere.ai/v1/rerank",
        expect.objectContaining({
          model: "rerank-v3.5",
          query: "What is the capital of France?",
          documents: [
            "Paris is the capital of France.",
            "London is the capital of UK.",
          ],
          top_n: 2,
        }),
        expect.any(Object),
      );
    });

    // ★ 2026-05-11 拉齐 BYOK：rerank 未知 provider 但 endpoint 显式提供时由
    //   远端 API 报真实错误；endpoint 缺失才返系统层失败提示。
    it("should fail when unsupported rerank provider has no endpoint", async () => {
      const result = await service.testModelConnectionWithKey(
        "openai",
        "some-rerank-model",
        "test-api-key",
        "", // no endpoint
        "RERANK",
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("未声明 rerank endpoint");
    });

    it("should handle rerank API error", async () => {
      const mockError = {
        response: {
          status: 400,
          data: {
            message: "Invalid request",
          },
        },
      } as AxiosError;

      mockHttpService.post.mockReturnValue(throwError(() => mockError));

      const result = await service.testModelConnectionWithKey(
        "cohere",
        "rerank-v3.5",
        "test-api-key",
        "https://api.cohere.ai/v1/rerank",
        "RERANK",
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("API Error (400)");
      expect(result.message).toContain("Invalid request");
    });
  });

  describe("testTTSModel (TTS/AUDIO modelType)", () => {
    // ★ 2026-05-13: 旧 spec 期望 "API key is set" + 不发请求；现已修为真发 HTTP
    //   测试请求（feedback_test_connection_must_verify_runtime）。新 spec 验证
    //   实际行为：OpenAI 走 /v1/audio/speech，Google 走 /v1beta/models 探测。
    it("should make real /v1/audio/speech request for OpenAI TTS", async () => {
      mockHttpService.post.mockReturnValueOnce(
        of({
          status: 200,
          data: Buffer.from("fake-audio-bytes"),
        }) as never,
      );

      const result = await service.testModelConnectionWithKey(
        "openai",
        "tts-1-hd",
        "test-api-key",
        "https://api.openai.com/v1",
        "AUDIO",
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("TTS connection OK");
      expect(result.latency).toBeGreaterThanOrEqual(0);
      expect(mockHttpService.post).toHaveBeenCalledWith(
        "https://api.openai.com/v1/audio/speech",
        expect.objectContaining({
          model: "tts-1-hd",
          input: "test",
          voice: "alloy",
        }),
        expect.any(Object),
      );
    });

    it("should probe Gemini endpoint for Google TTS", async () => {
      mockHttpService.get.mockReturnValueOnce(
        of({ status: 200, data: { models: [] } }) as never,
      );

      const result = await service.testModelConnectionWithKey(
        "google",
        "tts-1",
        "test-api-key",
        "https://generativelanguage.googleapis.com",
        "TTS",
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("Gemini TTS endpoint reachable");
      expect(mockHttpService.get).toHaveBeenCalled();
    });

    it("should return failure for OpenAI TTS HTTP error", async () => {
      mockHttpService.post.mockReturnValueOnce(
        of({
          status: 401,
          data: Buffer.from('{"error":"invalid key"}'),
        }) as never,
      );

      const result = await service.testModelConnectionWithKey(
        "openai",
        "tts-1",
        "bad-key",
        "https://api.openai.com/v1",
        "TTS",
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("HTTP 401");
    });
  });
});
