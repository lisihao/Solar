import { Test, TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { of } from "rxjs";
import { AiApiCallerService } from "../ai-api-caller.service";
import { OpenaiCaller } from "../openai-caller";
import { AnthropicCaller } from "../anthropic-caller";
import { CohereCaller } from "../cohere-caller";
import { GoogleCaller } from "../google-caller";
import { XaiCaller } from "../xai-caller";
import { ModelCapabilityService } from "../../models/capability/model-capability.service";
import {
  safeReasoningEffort,
  isMinimalEffortSupported,
} from "../../types/task-profile.types";

// ==================== safeReasoningEffort / isMinimalEffortSupported ====================

describe("isMinimalEffortSupported", () => {
  it("returns true for gpt-5 (official API variant)", () => {
    expect(isMinimalEffortSupported("gpt-5")).toBe(true);
  });

  it("returns true for gpt-5o", () => {
    expect(isMinimalEffortSupported("gpt-5o")).toBe(true);
  });

  it("returns false for gpt-5.4-mini (BYOK variant with dot-digit suffix)", () => {
    expect(isMinimalEffortSupported("gpt-5.4-mini")).toBe(false);
  });

  it("returns true for o3-mini", () => {
    expect(isMinimalEffortSupported("o3-mini")).toBe(true);
  });

  it("returns true for o4-mini", () => {
    expect(isMinimalEffortSupported("o4-mini")).toBe(true);
  });

  it("returns true for gpt-4.1-mini", () => {
    expect(isMinimalEffortSupported("gpt-4.1-mini")).toBe(true);
  });

  it("returns true for gemini-2.5-flash-thinking", () => {
    expect(isMinimalEffortSupported("gemini-2.5-flash-thinking")).toBe(true);
  });

  it("returns false for undefined", () => {
    expect(isMinimalEffortSupported(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isMinimalEffortSupported("")).toBe(false);
  });

  it("returns false for gpt-4o (non-reasoning model)", () => {
    expect(isMinimalEffortSupported("gpt-4o")).toBe(false);
  });
});

describe("safeReasoningEffort", () => {
  it("modelId=gpt-5, depth=minimal → effort=minimal (supported)", () => {
    expect(safeReasoningEffort("minimal", "gpt-5")).toBe("minimal");
  });

  it("modelId=gpt-5.4-mini, depth=minimal → effort=low (downgrade)", () => {
    expect(safeReasoningEffort("minimal", "gpt-5.4-mini")).toBe("low");
  });

  it("modelId undefined, depth=minimal → effort=low (conservative)", () => {
    expect(safeReasoningEffort("minimal", undefined)).toBe("low");
  });

  it("depth=moderate + modelId=gpt-5.4 → effort=medium (non-minimal unaffected)", () => {
    expect(safeReasoningEffort("moderate", "gpt-5.4")).toBe("medium");
  });

  it("depth=deep + any model → effort=high (non-minimal unaffected)", () => {
    expect(safeReasoningEffort("deep", "gpt-5.4-mini")).toBe("high");
  });

  it("depth=light + any model → effort=low (non-minimal unaffected)", () => {
    expect(safeReasoningEffort("light", "gpt-5.4-mini")).toBe("low");
  });

  it("depth undefined → effort=low (default fallback)", () => {
    expect(safeReasoningEffort(undefined, "gpt-5")).toBe("low");
  });
});

describe("AiApiCallerService", () => {
  let service: AiApiCallerService;
  let mockHttpService: jest.Mocked<Pick<HttpService, "post" | "get">>;

  const makeHttpResponse = (data: unknown) => ({
    data,
    status: 200,
    statusText: "OK",
    headers: {},
    config: {} as any,
  });

  beforeEach(async () => {
    mockHttpService = {
      post: jest.fn(),
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiApiCallerService,
        OpenaiCaller,
        AnthropicCaller,
        CohereCaller,
        GoogleCaller,
        XaiCaller,
        { provide: HttpService, useValue: mockHttpService },
        // v3.1 §A review (2026-05-24)：注入真实 ModelCapabilityService，让
        // rejectsResponseFormat 走 catalog 真实判定（消除"假绿"——
        // 未注入时全部 fail-open 退回 false，测不到 deepseek-v4-pro/-reasoner
        // 等 catalog nativeMode='none' 的 gate 行为）。
        ModelCapabilityService,
      ],
    }).compile();

    service = module.get<AiApiCallerService>(AiApiCallerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== callOpenAICompatibleAPI ====================

  describe("callOpenAICompatibleAPI", () => {
    const messages = [{ role: "user" as const, content: "Hello" }];

    it("should call the API and return content", async () => {
      const apiResponse = {
        choices: [{ message: { content: "Hello back!" } }],
        usage: { total_tokens: 50 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      const result = await service.callOpenAICompatibleAPI(
        "https://api.openai.com/v1/chat/completions",
        "test-key",
        "gpt-4o",
        messages,
        4000,
        0.7,
      );

      expect(result.content).toBe("Hello back!");
      expect(result.tokensUsed).toBe(50);
      expect(result.model).toBe("gpt-4o");
    });

    it("should use default endpoint if empty", async () => {
      const apiResponse = {
        choices: [{ message: { content: "OK" } }],
        usage: { total_tokens: 10 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.callOpenAICompatibleAPI(
        "",
        "test-key",
        "gpt-4o",
        messages,
        4000,
      );

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      expect(callArgs[0]).toContain("openai.com");
    });

    it("should add reasoning_effort=minimal when isReasoning=true no depth", async () => {
      // ★ 默认 minimal 是为了避免 gpt-5 系列 reasoning 吃光 max_completion_tokens
      //   导致 visible 输出空（OpenAI gpt-5 reasoning_tokens 不严格遵守限制）。
      const apiResponse = {
        choices: [{ message: { content: "reasoning" } }],
        usage: { total_tokens: 200 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.callOpenAICompatibleAPI(
        "https://api.openai.com/v1/chat/completions",
        "test-key",
        "o1-mini",
        messages,
        25000,
        undefined,
        120000,
        "max_completion_tokens",
        undefined,
        undefined,
        undefined,
        undefined,
        true,
      );

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      expect(callArgs[1]).toHaveProperty("reasoning_effort", "low");
    });

    it("should map reasoningDepth=deep → reasoning_effort=high", async () => {
      const apiResponse = {
        choices: [{ message: { content: "reasoning" } }],
        usage: { total_tokens: 200 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.callOpenAICompatibleAPI(
        "https://api.openai.com/v1/chat/completions",
        "test-key",
        "o3-mini",
        messages,
        25000,
        undefined,
        120000,
        "max_completion_tokens",
        undefined,
        "deep", // reasoningDepth
        undefined,
        undefined,
        true, // isReasoning
      );

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      expect(callArgs[1]).toHaveProperty("reasoning_effort", "high");
    });

    it("should send reasoning_effort for ANY DB-flagged reasoning model regardless of name", async () => {
      // ★ 防回归：模型每月新增，绝不依赖模型名 startsWith
      const apiResponse = {
        choices: [{ message: { content: "ok" } }],
        usage: { total_tokens: 100 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.callOpenAICompatibleAPI(
        "https://api.openai.com/v1/chat/completions",
        "test-key",
        "gpt-5.4", // 名字不是 o1/o3/o4 开头，仍应走 reasoning 路径
        messages,
        25000,
        undefined,
        120000,
        "max_completion_tokens",
        undefined,
        undefined,
        undefined,
        undefined,
        true, // ★ isReasoning from DB config
      );

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      // 没传 reasoningDepth → 默认 low（所有 reasoning 模型都接受的最低公分母）
      expect(callArgs[1]).toHaveProperty("reasoning_effort", "low");
    });

    it("should NOT add reasoning_effort when isReasoning=false (default)", async () => {
      const apiResponse = {
        choices: [{ message: { content: "normal" } }],
        usage: { total_tokens: 100 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.callOpenAICompatibleAPI(
        "https://api.openai.com/v1/chat/completions",
        "test-key",
        "gpt-4o",
        messages,
        4000,
      );

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      expect(callArgs[1]).not.toHaveProperty("reasoning_effort");
    });

    it("should NOT add reasoning_effort for o1 model when isReasoning param missing (DB not configured)", async () => {
      // ★ 用户责任：管理员要在 DB 把推理模型 isReasoning 设为 true，
      //   不配置就不传 reasoning_effort，模型走默认行为
      const apiResponse = {
        choices: [{ message: { content: "x" } }],
        usage: { total_tokens: 50 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.callOpenAICompatibleAPI(
        "https://api.openai.com/v1/chat/completions",
        "test-key",
        "o1-mini",
        messages,
        25000,
      );

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      expect(callArgs[1]).not.toHaveProperty("reasoning_effort");
    });

    it("should add json response_format when requested", async () => {
      const apiResponse = {
        choices: [{ message: { content: '{"key":"val"}' } }],
        usage: { total_tokens: 20 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.callOpenAICompatibleAPI(
        "https://api.openai.com/v1/chat/completions",
        "test-key",
        "gpt-4o",
        messages,
        4000,
        0.7,
        120000,
        "max_tokens",
        "json",
      );

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      expect(callArgs[1]).toHaveProperty("response_format", {
        type: "json_object",
      });
    });

    it("should throw on API refusal", async () => {
      const apiResponse = {
        choices: [{ message: { refusal: "I cannot help with that" } }],
        usage: { total_tokens: 10 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await expect(
        service.callOpenAICompatibleAPI(
          "https://api.openai.com/v1/chat/completions",
          "test-key",
          "gpt-4o",
          messages,
          4000,
        ),
      ).rejects.toThrow("AI 拒绝响应");
    });

    it("should throw on empty content with finish_reason=length", async () => {
      const apiResponse = {
        choices: [{ message: { content: null }, finish_reason: "length" }],
        usage: { total_tokens: 4000, prompt_tokens: 3990 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await expect(
        service.callOpenAICompatibleAPI(
          "https://api.openai.com/v1/chat/completions",
          "test-key",
          "gpt-4o",
          messages,
          4000,
        ),
      ).rejects.toThrow("截断");
    });

    it("should throw for reasoning model token exhaustion", async () => {
      const apiResponse = {
        choices: [{ message: { content: "" }, finish_reason: "length" }],
        usage: {
          total_tokens: 1000,
          prompt_tokens: 100,
          completion_tokens: 1000,
          completion_tokens_details: { reasoning_tokens: 990 },
        },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await expect(
        service.callOpenAICompatibleAPI(
          "https://api.openai.com/v1/chat/completions",
          "test-key",
          "o1-mini",
          messages,
          1000,
        ),
      ).rejects.toThrow("推理模型");
    });

    it("should throw for unknown finish_reason with empty content", async () => {
      const apiResponse = {
        choices: [{ message: { content: "" }, finish_reason: "stop" }],
        usage: { total_tokens: 5 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await expect(
        service.callOpenAICompatibleAPI(
          "https://api.openai.com/v1/chat/completions",
          "test-key",
          "gpt-4o",
          messages,
          4000,
        ),
      ).rejects.toThrow("AI 返回空响应");
    });

    // ★ 2026-05-25: degenerate-success in-request degrade（机制级，无模型硬编码）。
    //   deepseek-v4-flash 思考模式 + 强制 json_object → 200 OK 但 content 空。
    //   应自动撤掉 response_format 重试一次（chain: json_mode→none），用户拿到结果。
    it("degenerate 200 (empty content) → drops response_format and retries once", async () => {
      const emptyResp = {
        choices: [
          {
            message: { content: "", reasoning_content: "still thinking..." },
            finish_reason: "stop",
          },
        ],
        usage: {
          total_tokens: 700,
          prompt_tokens: 60,
          completion_tokens: 641,
          completion_tokens_details: { reasoning_tokens: 641 },
        },
      };
      const goodResp = {
        choices: [
          { message: { content: "real answer" }, finish_reason: "stop" },
        ],
        usage: { total_tokens: 120 },
      };
      // requestBody is mutated in place by the degrade (delete response_format),
      // and the mock records it by reference — so snapshot response_format per call.
      const sentFormats: unknown[] = [];
      (mockHttpService.post as jest.Mock).mockImplementation(
        (_url: string, body: Record<string, unknown>) => {
          sentFormats.push(body.response_format);
          return of(
            makeHttpResponse(sentFormats.length === 1 ? emptyResp : goodResp),
          ) as any;
        },
      );

      const result = await service.callOpenAICompatibleAPI(
        "https://api.deepseek.com/v1/chat/completions",
        "test-key",
        "deepseek-v4-flash",
        messages,
        25000,
        undefined, // temperature
        120000, // timeout
        "max_tokens", // tokenParamName
        "json", // responseFormat → wantsJson
        undefined, // reasoningDepth
        undefined, // outputSchema
        undefined, // schemaStrict
        true, // isReasoning
        undefined, // structuredOutputStrategy
        undefined, // outputJsonSchema
        undefined, // schemaName
        undefined, // tools
        "deepseek", // provider → catalog json_mode → degrade chain json_mode→none
      );

      expect(result.content).toBe("real answer");
      expect(mockHttpService.post).toHaveBeenCalledTimes(2);
      // 1st call: forced json_object (catalog nativeMode=json_mode)
      expect(sentFormats[0]).toEqual({ type: "json_object" });
      // 2nd (degraded) call: response_format dropped entirely
      expect(sentFormats[1]).toBeUndefined();
    });

    // ★ 2026-06-10 日志实测：deepseek-v4-flash finish=stop 把最终 JSON 写进
    //   reasoning_content、content 留空。salvage 路径直接采用，省一轮降级长调用。
    it("salvages JSON from reasoning_content (finish=stop, content empty) — no degrade retry", async () => {
      const resp = {
        choices: [
          {
            message: {
              content: "",
              reasoning_content:
                'Let me finalize.\n{\n  "dimension": "半导体供应链",\n  "findings": [{"claim": "A16 delayed to 2027"}]\n}',
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          total_tokens: 34468,
          prompt_tokens: 31087,
          completion_tokens: 3381,
          completion_tokens_details: { reasoning_tokens: 3381 },
        },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(resp)) as any,
      );

      const result = await service.callOpenAICompatibleAPI(
        "https://api.deepseek.com/v1/chat/completions",
        "test-key",
        "deepseek-v4-flash",
        messages,
        25000,
        undefined, // temperature
        120000, // timeout
        "max_tokens", // tokenParamName
        "json", // responseFormat → wantsJson
        undefined, // reasoningDepth
        undefined, // outputSchema
        undefined, // schemaStrict
        true, // isReasoning
        undefined, // structuredOutputStrategy
        undefined, // outputJsonSchema
        undefined, // schemaName
        undefined, // tools
        "deepseek", // provider
      );

      // 单次调用即成功，不触发 in-request-degrade 重试
      expect(mockHttpService.post).toHaveBeenCalledTimes(1);
      expect(JSON.parse(result.content)).toEqual({
        dimension: "半导体供应链",
        findings: [{ claim: "A16 delayed to 2027" }],
      });
      expect(result.outputTokens).toBe(3381);
      expect(result.reasoning).toContain("Let me finalize.");
    });

    it("reasoning_content WITHOUT parseable JSON → still degrades (salvage falls through)", async () => {
      const emptyResp = {
        choices: [
          {
            message: { content: "", reasoning_content: "no json here at all" },
            finish_reason: "stop",
          },
        ],
        usage: {
          total_tokens: 700,
          prompt_tokens: 60,
          completion_tokens: 641,
          completion_tokens_details: { reasoning_tokens: 641 },
        },
      };
      const goodResp = {
        choices: [
          { message: { content: '{"ok":true}' }, finish_reason: "stop" },
        ],
        usage: { total_tokens: 120 },
      };
      let calls = 0;
      (mockHttpService.post as jest.Mock).mockImplementation(() => {
        calls += 1;
        return of(makeHttpResponse(calls === 1 ? emptyResp : goodResp)) as any;
      });

      const result = await service.callOpenAICompatibleAPI(
        "https://api.deepseek.com/v1/chat/completions",
        "test-key",
        "deepseek-v4-flash",
        messages,
        25000,
        undefined,
        120000,
        "max_tokens",
        "json",
        undefined,
        undefined,
        undefined,
        true,
        undefined,
        undefined,
        undefined,
        undefined,
        "deepseek",
      );

      expect(mockHttpService.post).toHaveBeenCalledTimes(2);
      expect(result.content).toBe('{"ok":true}');
    });

    it("degenerate 200 with NO wantsJson → no degrade, throws (unchanged)", async () => {
      const emptyResp = {
        choices: [{ message: { content: "" }, finish_reason: "stop" }],
        usage: { total_tokens: 5 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(emptyResp)) as any,
      );
      await expect(
        service.callOpenAICompatibleAPI(
          "https://api.deepseek.com/v1/chat/completions",
          "test-key",
          "deepseek-v4-flash",
          messages,
          25000,
          undefined,
          120000,
          "max_tokens",
          undefined, // responseFormat NOT json → wantsJson false
          undefined,
          undefined,
          undefined,
          true,
          undefined,
          undefined,
          undefined,
          undefined,
          "deepseek",
        ),
      ).rejects.toThrow("AI 返回空响应");
      expect(mockHttpService.post).toHaveBeenCalledTimes(1); // no degrade retry
    });

    it("should use custom tokenParamName", async () => {
      const apiResponse = {
        choices: [{ message: { content: "OK" } }],
        usage: { total_tokens: 10 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.callOpenAICompatibleAPI(
        "https://api.openai.com/v1/chat/completions",
        "test-key",
        "gpt-4o",
        messages,
        8000,
        undefined,
        120000,
        "max_completion_tokens",
      );

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      expect(callArgs[1]).toHaveProperty("max_completion_tokens", 8000);
      expect(callArgs[1]).not.toHaveProperty("max_tokens");
    });

    it("should not include temperature when undefined", async () => {
      const apiResponse = {
        choices: [{ message: { content: "OK" } }],
        usage: { total_tokens: 10 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.callOpenAICompatibleAPI(
        "https://api.openai.com/v1/chat/completions",
        "test-key",
        "gpt-4o",
        messages,
        4000,
        undefined,
      );

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      expect(callArgs[1]).not.toHaveProperty("temperature");
    });

    it("should parse message text as fallback", async () => {
      const apiResponse = {
        choices: [{ message: { text: "Text response" } }],
        usage: { total_tokens: 10 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      const result = await service.callOpenAICompatibleAPI(
        "https://api.openai.com/v1/chat/completions",
        "test-key",
        "gpt-4o",
        messages,
        4000,
      );

      expect(result.content).toBe("Text response");
    });

    // ==================== reasoningDepth tests ====================

    it("should use reasoningDepth='deep' as reasoning_effort='high' (isReasoning=true)", async () => {
      const apiResponse = {
        choices: [{ message: { content: "deep reasoning" } }],
        usage: { total_tokens: 500 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.callOpenAICompatibleAPI(
        "https://api.openai.com/v1/chat/completions",
        "test-key",
        "o3-mini",
        messages,
        32000,
        undefined,
        120000,
        "max_tokens",
        undefined,
        "deep",
        undefined,
        undefined,
        true, // isReasoning
      );

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      expect(callArgs[1]).toHaveProperty("reasoning_effort", "high");
    });

    it("should use reasoningDepth='moderate' as reasoning_effort='medium'", async () => {
      const apiResponse = {
        choices: [{ message: { content: "moderate" } }],
        usage: { total_tokens: 300 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.callOpenAICompatibleAPI(
        "https://api.openai.com/v1/chat/completions",
        "test-key",
        "o1",
        messages,
        25000,
        undefined,
        120000,
        "max_tokens",
        undefined,
        "moderate",
        undefined,
        undefined,
        true, // isReasoning
      );

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      expect(callArgs[1]).toHaveProperty("reasoning_effort", "medium");
    });

    it("should fallback to reasoning_effort=minimal when no reasoningDepth (isReasoning=true)", async () => {
      const apiResponse = {
        choices: [{ message: { content: "minimal" } }],
        usage: { total_tokens: 200 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.callOpenAICompatibleAPI(
        "https://api.openai.com/v1/chat/completions",
        "test-key",
        "o3",
        messages,
        25000,
        undefined,
        120000,
        "max_tokens",
        undefined,
        undefined,
        undefined,
        undefined,
        true,
      );

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      expect(callArgs[1]).toHaveProperty("reasoning_effort", "low");
    });

    it("should send reasoning_effort for any DB-flagged reasoning model (no model name match)", async () => {
      const apiResponse = {
        choices: [{ message: { content: "ok" } }],
        usage: { total_tokens: 100 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.callOpenAICompatibleAPI(
        "https://api.openai.com/v1/chat/completions",
        "test-key",
        "o4-mini",
        messages,
        25000,
        undefined,
        120000,
        "max_tokens",
        undefined,
        "deep",
        undefined,
        undefined,
        true, // ★ DB-driven, not model-name pattern
      );

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      expect(callArgs[1]).toHaveProperty("reasoning_effort", "high");
    });

    it("should downgrade minimal → low for unsupported model (gpt-5.4-mini)", async () => {
      // gpt-5.4-mini is a BYOK variant that does NOT support 'minimal'
      // safeReasoningEffort should downgrade it to 'low'
      const apiResponse = {
        choices: [{ message: { content: "downgraded" } }],
        usage: { total_tokens: 100 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.callOpenAICompatibleAPI(
        "https://api.openai.com/v1/chat/completions",
        "test-key",
        "gpt-5.4-mini",
        messages,
        25000,
        undefined,
        120000,
        "max_completion_tokens",
        undefined,
        "minimal", // depth=minimal → triggers downgrade for this model
        undefined,
        undefined,
        true,
      );

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      expect(callArgs[1]).toHaveProperty("reasoning_effort", "low");
    });

    it("should keep minimal for model that supports it (gpt-5)", async () => {
      const apiResponse = {
        choices: [{ message: { content: "minimal ok" } }],
        usage: { total_tokens: 100 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.callOpenAICompatibleAPI(
        "https://api.openai.com/v1/chat/completions",
        "test-key",
        "gpt-5",
        messages,
        25000,
        undefined,
        120000,
        "max_completion_tokens",
        undefined,
        "minimal",
        undefined,
        undefined,
        true,
      );

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      expect(callArgs[1]).toHaveProperty("reasoning_effort", "minimal");
    });

    // ==================== outputSchema (Strict Structured Output) tests ====================

    it("should use json_schema response_format when outputSchema is provided", async () => {
      const apiResponse = {
        choices: [{ message: { content: '{"name":"test"}' } }],
        usage: { total_tokens: 20 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      const schema = {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
        additionalProperties: false,
      };

      await service.callOpenAICompatibleAPI(
        "https://api.openai.com/v1/chat/completions",
        "test-key",
        "gpt-4o",
        messages,
        4000,
        0.7,
        120000,
        "max_tokens",
        undefined, // responseFormat
        undefined, // reasoningDepth
        { type: "json_schema", schema },
        true, // schemaStrict
      );

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      expect(callArgs[1].response_format).toEqual({
        type: "json_schema",
        json_schema: {
          name: "structured_output",
          schema,
          strict: true,
        },
      });
    });

    it("should include OpenAI-compatible tools when provided", async () => {
      mockHttpService.post.mockReturnValueOnce(
        of(
          makeHttpResponse({
            choices: [{ message: { content: "ok" } }],
            usage: { total_tokens: 1 },
          }),
        ) as never,
      );

      await service.callOpenAICompatibleAPI(
        "https://api.openai.com/v1/chat/completions",
        "test-key",
        "gpt-4o",
        [{ role: "user", content: "Q" }],
        1000,
        0.7,
        120000,
        "max_tokens",
        undefined,
        undefined,
        undefined,
        undefined,
        false,
        undefined,
        undefined,
        undefined,
        [
          {
            name: "web-search",
            description: "Search the web",
            parameters: {
              type: "object",
              properties: { query: { type: "string" } },
            },
          },
        ],
      );

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0][1];
      expect(callArgs.tools).toEqual([
        {
          type: "function",
          function: {
            name: "web-search",
            description: "Search the web",
            parameters: {
              type: "object",
              properties: { query: { type: "string" } },
            },
          },
        },
      ]);
    });

    it("should parse OpenAI-compatible tool_calls into ChatCompletionResult.toolCalls", async () => {
      mockHttpService.post.mockReturnValueOnce(
        of(
          makeHttpResponse({
            choices: [
              {
                message: {
                  content: "",
                  tool_calls: [
                    {
                      id: "call_1",
                      function: {
                        name: "web-search",
                        arguments: '{"query":"AI demand"}',
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
            usage: { total_tokens: 5, prompt_tokens: 3, completion_tokens: 2 },
          }),
        ) as never,
      );

      const result = await service.callOpenAICompatibleAPI(
        "https://api.openai.com/v1/chat/completions",
        "test-key",
        "gpt-4o",
        [{ role: "user", content: "Q" }],
        1000,
      );

      expect(result.finishReason).toBe("tool_calls");
      expect(result.toolCalls).toEqual([
        {
          id: "call_1",
          name: "web-search",
          arguments: { query: "AI demand" },
        },
      ]);
    });

    it("should prefer outputSchema over responseFormat='json'", async () => {
      const apiResponse = {
        choices: [{ message: { content: '{"k":"v"}' } }],
        usage: { total_tokens: 10 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      const schema = { type: "object", properties: {} };

      await service.callOpenAICompatibleAPI(
        "https://api.openai.com/v1/chat/completions",
        "test-key",
        "gpt-4o",
        messages,
        4000,
        0.7,
        120000,
        "max_tokens",
        "json", // responseFormat
        undefined,
        { type: "json_schema", schema }, // outputSchema takes precedence
      );

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      expect(callArgs[1].response_format.type).toBe("json_schema");
    });
  });

  // ==================== callAnthropicAPI ====================

  describe("callAnthropicAPI", () => {
    const messages = [
      { role: "system" as const, content: "You are a helper" },
      { role: "user" as const, content: "Hello" },
    ];

    it("should call Anthropic API and return content", async () => {
      const apiResponse = {
        content: [{ type: "text", text: "Hello from Claude" }],
        usage: { input_tokens: 10, output_tokens: 20 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      const result = await service.callAnthropicAPI(
        "https://api.anthropic.com/v1/messages",
        "test-key",
        "claude-3-5-sonnet-20241022",
        messages,
        4000,
        0.7,
      );

      expect(result.content).toBe("Hello from Claude");
      expect(result.tokensUsed).toBe(30);
      expect(result.model).toBe("claude-3-5-sonnet-20241022");
    });

    it("should use default anthropic endpoint if empty", async () => {
      const apiResponse = {
        content: [{ type: "text", text: "OK" }],
        usage: { input_tokens: 5, output_tokens: 5 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.callAnthropicAPI(
        "",
        "test-key",
        "claude-3-5-sonnet-20241022",
        messages,
        4000,
      );

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      expect(callArgs[0]).toContain("anthropic.com");
    });

    it("should separate system messages from conversation", async () => {
      const apiResponse = {
        content: [{ type: "text", text: "OK" }],
        usage: { input_tokens: 5, output_tokens: 5 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.callAnthropicAPI(
        "https://api.anthropic.com/v1/messages",
        "test-key",
        "claude-3-5-sonnet-20241022",
        messages,
        4000,
        0.7,
      );

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      const body = callArgs[1];
      expect(body.system).toBe("You are a helper");
      expect(body.messages).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ role: "system" })]),
      );
    });

    it("should handle json format warning gracefully", async () => {
      const apiResponse = {
        content: [{ type: "text", text: '{"result": "ok"}' }],
        usage: { input_tokens: 5, output_tokens: 10 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      const result = await service.callAnthropicAPI(
        "https://api.anthropic.com/v1/messages",
        "test-key",
        "claude-3-5-sonnet-20241022",
        [{ role: "user", content: "return json" }],
        4000,
        0.7,
        120000,
        "json",
      );

      expect(result.content).toBeDefined();
    });

    it("should not include temperature when undefined", async () => {
      const apiResponse = {
        content: [{ type: "text", text: "OK" }],
        usage: { input_tokens: 5, output_tokens: 5 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.callAnthropicAPI(
        "https://api.anthropic.com/v1/messages",
        "test-key",
        "claude-3-5-sonnet-20241022",
        [{ role: "user", content: "Hello" }],
        4000,
      );

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      expect(callArgs[1]).not.toHaveProperty("temperature");
    });

    // ==================== cachePolicy tests ====================

    it("should wrap system message with cache_control when cachePolicy is auto", async () => {
      const apiResponse = {
        content: [{ type: "text", text: "cached response" }],
        usage: { input_tokens: 5, output_tokens: 5 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.callAnthropicAPI(
        "https://api.anthropic.com/v1/messages",
        "test-key",
        "claude-sonnet-4-20250514",
        messages,
        4000,
        0.7,
        120000,
        undefined, // responseFormat
        undefined, // reasoningDepth
        "auto", // cachePolicy
      );

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      const body = callArgs[1];
      expect(Array.isArray(body.system)).toBe(true);
      expect(body.system[0]).toEqual({
        type: "text",
        text: "You are a helper",
        cache_control: { type: "ephemeral" },
      });
    });

    it("should use plain string system when cachePolicy is not set", async () => {
      const apiResponse = {
        content: [{ type: "text", text: "no cache" }],
        usage: { input_tokens: 5, output_tokens: 5 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.callAnthropicAPI(
        "https://api.anthropic.com/v1/messages",
        "test-key",
        "claude-sonnet-4-20250514",
        messages,
        4000,
        0.7,
      );

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      const body = callArgs[1];
      expect(typeof body.system).toBe("string");
      expect(body.system).toBe("You are a helper");
    });
  });

  // ==================== callGoogleAPI ====================

  describe("callGoogleAPI", () => {
    const messages = [
      { role: "system" as const, content: "You are helpful" },
      { role: "user" as const, content: "What is AI?" },
    ];

    it("should call Google API and return content", async () => {
      const apiResponse = {
        candidates: [
          {
            content: { parts: [{ text: "AI is artificial intelligence" }] },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 20,
        },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      const result = await service.callGoogleAPI(
        "https://generativelanguage.googleapis.com/v1beta",
        "test-key",
        "gemini-2.0-flash",
        messages,
        4000,
        0.7,
      );

      expect(result.content).toBe("AI is artificial intelligence");
      expect(result.tokensUsed).toBe(30);
    });

    it("should return safety message for blocked content", async () => {
      const apiResponse = {
        candidates: [
          {
            finishReason: "SAFETY",
          },
        ],
        usageMetadata: {},
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      const result = await service.callGoogleAPI(
        "https://generativelanguage.googleapis.com/v1beta",
        "test-key",
        "gemini-2.0-flash",
        messages,
        4000,
      );

      expect(result.content).toContain("cannot provide");
      expect(result.tokensUsed).toBe(0);
    });

    it("should build URL with /models prefix", async () => {
      const apiResponse = {
        candidates: [
          {
            content: { parts: [{ text: "OK" }] },
          },
        ],
        usageMetadata: {},
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.callGoogleAPI(
        "https://generativelanguage.googleapis.com/v1beta/models",
        "test-key",
        "gemini-2.0-flash",
        messages,
        4000,
      );

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      expect(callArgs[0]).toContain("gemini-2.0-flash:generateContent");
    });

    it("should add json mime type when responseFormat=json", async () => {
      const apiResponse = {
        candidates: [
          {
            content: { parts: [{ text: '{"key":"val"}' }] },
          },
        ],
        usageMetadata: {},
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.callGoogleAPI(
        "https://generativelanguage.googleapis.com/v1beta",
        "test-key",
        "gemini-2.0-flash",
        messages,
        4000,
        0.7,
        120000,
        "json",
      );

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      expect(callArgs[1].generationConfig).toHaveProperty(
        "responseMimeType",
        "application/json",
      );
    });

    it("should handle URL with :generateContent already", async () => {
      const apiResponse = {
        candidates: [
          {
            content: { parts: [{ text: "OK" }] },
          },
        ],
        usageMetadata: {},
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.callGoogleAPI(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
        "test-key",
        "gemini-pro",
        messages,
        4000,
      );

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      expect(callArgs[0]).toContain(":generateContent?key=");
    });
  });

  // ==================== callXAIAPI ====================

  describe("callXAIAPI", () => {
    const messages = [{ role: "user" as const, content: "Hello Grok" }];

    it("should call xAI API and return content", async () => {
      const apiResponse = {
        choices: [{ message: { content: "Hello from Grok" } }],
        usage: { total_tokens: 30 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      const result = await service.callXAIAPI(
        "https://api.x.ai/v1/chat/completions",
        "test-key",
        "grok-2",
        messages,
        4000,
        0.7,
      );

      expect(result.content).toBe("Hello from Grok");
      expect(result.tokensUsed).toBe(30);
    });

    it("should use default xAI endpoint if empty", async () => {
      const apiResponse = {
        choices: [{ message: { content: "OK" } }],
        usage: { total_tokens: 10 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.callXAIAPI("", "test-key", "grok-2", messages, 4000);

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      expect(callArgs[0]).toContain("api.x.ai");
    });

    it("should add json response_format", async () => {
      const apiResponse = {
        choices: [{ message: { content: '{"key":"val"}' } }],
        usage: { total_tokens: 10 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.callXAIAPI(
        "https://api.x.ai/v1/chat/completions",
        "test-key",
        "grok-2",
        messages,
        4000,
        0.7,
        120000,
        "max_tokens",
        "json",
      );

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      expect(callArgs[1]).toHaveProperty("response_format", {
        type: "json_object",
      });
    });

    it("should include xAI tools and parse tool_calls", async () => {
      mockHttpService.post.mockReturnValueOnce(
        of(
          makeHttpResponse({
            choices: [
              {
                message: {
                  content: "",
                  tool_calls: [
                    {
                      id: "call_x1",
                      function: {
                        name: "search",
                        arguments: '{"query":"HBM"}',
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
            usage: { total_tokens: 5, prompt_tokens: 3, completion_tokens: 2 },
          }),
        ) as never,
      );

      const result = await service.callXAIAPI(
        "https://api.x.ai/v1/chat/completions",
        "test-key",
        "grok-2",
        [{ role: "user", content: "Q" }],
        4000,
        0.7,
        120000,
        "max_tokens",
        undefined,
        undefined,
        undefined,
        undefined,
        false,
        undefined,
        undefined,
        undefined,
        [
          {
            name: "search",
            description: "Search",
            parameters: { type: "object", properties: {} },
          },
        ],
      );

      const body = (mockHttpService.post as jest.Mock).mock.calls[0][1];
      expect(body.tools).toEqual([
        {
          type: "function",
          function: {
            name: "search",
            description: "Search",
            parameters: { type: "object", properties: {} },
          },
        },
      ]);
      expect(result.finishReason).toBe("tool_calls");
      expect(result.toolCalls).toEqual([
        { id: "call_x1", name: "search", arguments: { query: "HBM" } },
      ]);
    });
  });

  // ==================== Embedding APIs ====================

  describe("callOpenAICompatibleEmbeddingAPI", () => {
    it("should return embeddings", async () => {
      const apiResponse = {
        data: [{ embedding: [0.1, 0.2, 0.3] }, { embedding: [0.4, 0.5, 0.6] }],
        usage: { total_tokens: 20 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      const result = await service.callOpenAICompatibleEmbeddingAPI(
        "https://api.openai.com/v1",
        "test-key",
        "text-embedding-3-large",
        ["Hello", "World"],
      );

      expect(result.embeddings).toHaveLength(2);
      expect(result.embeddings[0]).toEqual([0.1, 0.2, 0.3]);
      expect(result.totalTokens).toBe(20);
    });

    it("should append /embeddings if missing", async () => {
      const apiResponse = {
        data: [{ embedding: [0.1] }],
        usage: { total_tokens: 5 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.callOpenAICompatibleEmbeddingAPI(
        "https://api.openai.com/v1",
        "test-key",
        "text-embedding-3-large",
        ["test"],
      );

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      expect(callArgs[0]).toContain("/embeddings");
    });

    it("should not double-append /embeddings", async () => {
      const apiResponse = {
        data: [{ embedding: [0.1] }],
        usage: { total_tokens: 5 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.callOpenAICompatibleEmbeddingAPI(
        "https://api.openai.com/v1/embeddings",
        "test-key",
        "text-embedding-3-large",
        ["test"],
      );

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      expect(callArgs[0]).toBe("https://api.openai.com/v1/embeddings");
    });
  });

  describe("callGoogleEmbeddingAPI", () => {
    it("should return Google embeddings", async () => {
      const apiResponse = {
        embeddings: [{ values: [0.1, 0.2] }, { values: [0.3, 0.4] }],
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      const result = await service.callGoogleEmbeddingAPI(
        "https://generativelanguage.googleapis.com/v1beta",
        "test-key",
        "text-embedding-004",
        ["Hello", "World"],
      );

      expect(result.embeddings).toHaveLength(2);
      expect(result.totalTokens).toBe(0); // Google doesn't return token count
    });

    it("should normalize URL by stripping trailing /models", async () => {
      const apiResponse = { embeddings: [{ values: [0.1] }] };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.callGoogleEmbeddingAPI(
        "https://generativelanguage.googleapis.com/v1beta/models/",
        "test-key",
        "text-embedding-004",
        ["test"],
      );

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      expect(callArgs[0]).toContain("text-embedding-004:batchEmbedContents");
      expect(callArgs[0]).not.toContain("models/models");
    });
  });

  describe("callCohereEmbeddingAPI", () => {
    it("should return Cohere embeddings", async () => {
      const apiResponse = {
        embeddings: [
          [0.1, 0.2],
          [0.3, 0.4],
        ],
        meta: { billed_units: { input_tokens: 15 } },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      const result = await service.callCohereEmbeddingAPI(
        "https://api.cohere.com/v1",
        "test-key",
        "embed-english-v3.0",
        ["Hello", "World"],
      );

      expect(result.embeddings).toHaveLength(2);
      expect(result.totalTokens).toBe(15);
    });

    it("should append /embed if missing", async () => {
      const apiResponse = {
        embeddings: [[0.1]],
        meta: { billed_units: { input_tokens: 5 } },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.callCohereEmbeddingAPI(
        "https://api.cohere.com/v1",
        "test-key",
        "embed-english-v3.0",
        ["test"],
      );

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      expect(callArgs[0]).toContain("/embed");
    });

    it("should use custom input_type", async () => {
      const apiResponse = {
        embeddings: [[0.1]],
        meta: {},
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.callCohereEmbeddingAPI(
        "https://api.cohere.com/v1",
        "test-key",
        "embed-english-v3.0",
        ["query text"],
        "search_query",
      );

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      expect(callArgs[1]).toHaveProperty("input_type", "search_query");
    });
  });

  // ==================== Layer 4/5 native FC tool_call_id wire ====================

  describe("native FC tool_call_id wire (layer 4/5)", () => {
    it("OpenAI compatible: role:'tool' + toolCallId → wire tool_call_id 字段", async () => {
      const apiResponse = {
        choices: [{ message: { content: "ack" } }],
        usage: { total_tokens: 5 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );
      await service.callOpenAICompatibleAPI(
        "https://api.openai.com/v1/chat/completions",
        "k",
        "gpt-4o",
        [
          { role: "user", content: "Q" },
          {
            role: "assistant",
            content: '{"tool_calls":[{"id":"call_1","name":"search"}]}',
          },
          {
            role: "tool",
            content: "result-data",
            name: "search",
            toolCallId: "call_1",
          },
        ],
        4000,
        0.7,
      );
      const body = (mockHttpService.post as jest.Mock).mock.calls[0][1];
      const toolMsg = body.messages.find(
        (m: { role: string }) => m.role === "tool",
      );
      expect(toolMsg).toBeDefined();
      expect(toolMsg.tool_call_id).toBe("call_1");
      expect(toolMsg.name).toBe("search");
    });

    it("OpenAI compatible: prompt-driven tool observation without toolCallId → downgrade to user", async () => {
      const apiResponse = {
        choices: [{ message: { content: "ack" } }],
        usage: { total_tokens: 5 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );
      await service.callOpenAICompatibleAPI(
        "https://api.deepseek.com/v1/chat/completions",
        "k",
        "deepseek-v4-pro",
        [
          { role: "user", content: "Q" },
          {
            role: "tool",
            content: "result-data",
            name: "web-search",
          },
        ],
        4000,
        0.7,
      );
      const body = (mockHttpService.post as jest.Mock).mock.calls[0][1];
      expect(
        body.messages.find((m: { role: string }) => m.role === "tool"),
      ).toBeUndefined();
      const downgraded = body.messages[1];
      expect(downgraded.role).toBe("user");
      expect(downgraded.content).toContain("[tool_result:web-search]");
      expect(downgraded).not.toHaveProperty("tool_call_id");
    });

    it("Anthropic: role:'tool' + toolCallId → user + content[{type:'tool_result',tool_use_id}]", async () => {
      const apiResponse = {
        content: [{ type: "text", text: "ack" }],
        usage: { input_tokens: 5, output_tokens: 2 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );
      await service.callAnthropicAPI(
        "https://api.anthropic.com/v1/messages",
        "k",
        "claude-sonnet-4-6",
        [
          { role: "user", content: "Q" },
          { role: "assistant", content: "calling search" },
          {
            role: "tool",
            content: "result-data",
            toolCallId: "toolu_abc",
          },
        ],
        4000,
        0.7,
      );
      const body = (mockHttpService.post as jest.Mock).mock.calls[0][1];
      const last = body.messages[body.messages.length - 1];
      expect(last.role).toBe("user");
      expect(Array.isArray(last.content)).toBe(true);
      expect(last.content[0]).toEqual({
        type: "tool_result",
        tool_use_id: "toolu_abc",
        content: "result-data",
      });
    });

    it("xAI: role:'tool' + toolCallId → wire tool_call_id（OpenAI 兼容协议）", async () => {
      const apiResponse = {
        choices: [{ message: { content: "ack" } }],
        usage: { total_tokens: 5 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );
      await service.callXAIAPI(
        "https://api.x.ai/v1/chat/completions",
        "k",
        "grok-2",
        [
          { role: "user", content: "Q" },
          {
            role: "tool",
            content: "result-data",
            toolCallId: "call_xai_9",
          },
        ],
        4000,
        0.7,
      );
      const body = (mockHttpService.post as jest.Mock).mock.calls[0][1];
      const toolMsg = body.messages.find(
        (m: { role: string }) => m.role === "tool",
      );
      expect(toolMsg).toBeDefined();
      expect(toolMsg.tool_call_id).toBe("call_xai_9");
    });

    it("xAI: prompt-driven tool observation without toolCallId → downgrade to user", async () => {
      const apiResponse = {
        choices: [{ message: { content: "ack" } }],
        usage: { total_tokens: 5 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );
      await service.callXAIAPI(
        "https://api.x.ai/v1/chat/completions",
        "k",
        "grok-2",
        [
          { role: "user", content: "Q" },
          {
            role: "tool",
            content: "result-data",
            name: "search",
          },
        ],
        4000,
        0.7,
      );
      const body = (mockHttpService.post as jest.Mock).mock.calls[0][1];
      expect(
        body.messages.find((m: { role: string }) => m.role === "tool"),
      ).toBeUndefined();
      expect(body.messages[1].role).toBe("user");
      expect(body.messages[1].content).toContain("[tool_result:search]");
    });
  });
});
