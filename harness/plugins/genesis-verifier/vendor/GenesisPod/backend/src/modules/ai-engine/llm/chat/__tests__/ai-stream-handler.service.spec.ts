import { Test, TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { of } from "rxjs";
import { AiStreamHandlerService } from "../ai-stream-handler.service";

/**
 * Helper to create a mock SSE stream from lines
 */
function createMockStream(lines: string[]): AsyncIterable<Buffer> {
  const sseData = lines.join("\n") + "\n";
  return {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(sseData);
    },
  };
}

describe("AiStreamHandlerService", () => {
  let service: AiStreamHandlerService;
  let mockHttpService: jest.Mocked<Pick<HttpService, "post">>;

  beforeEach(async () => {
    mockHttpService = {
      post: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiStreamHandlerService,
        { provide: HttpService, useValue: mockHttpService },
      ],
    }).compile();

    service = module.get<AiStreamHandlerService>(AiStreamHandlerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== streamOpenAICompatible ====================

  describe("streamOpenAICompatible", () => {
    const messages = [{ role: "user" as const, content: "Hello" }];

    it("should stream content chunks", async () => {
      const mockStream = createMockStream([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}',
        'data: {"choices":[{"delta":{"content":" World"}}]}',
        "data: [DONE]",
      ]);

      mockHttpService.post.mockReturnValueOnce(
        of({ data: mockStream } as any) as any,
      );

      const chunks: string[] = [];
      const gen = service.streamOpenAICompatible(
        "https://api.openai.com/v1/chat/completions",
        "test-key",
        "gpt-4o",
        messages,
        4000,
        0.7,
      );

      for await (const chunk of gen) {
        if (chunk.content) {
          chunks.push(chunk.content);
        }
        if (chunk.done) break;
      }

      expect(chunks.join("")).toContain("Hello");
    });

    it("should yield done chunk when [DONE] received", async () => {
      const mockStream = createMockStream([
        'data: {"choices":[{"delta":{"content":"Hi"}}]}',
        "data: [DONE]",
      ]);

      mockHttpService.post.mockReturnValueOnce(
        of({ data: mockStream } as any) as any,
      );

      const chunks: Array<{ content: string; done: boolean }> = [];
      for await (const chunk of service.streamOpenAICompatible(
        "https://api.openai.com/v1/chat/completions",
        "test-key",
        "gpt-4o",
        messages,
        4000,
      )) {
        chunks.push(chunk);
      }

      expect(chunks.some((c) => c.done)).toBe(true);
    });

    it("should capture usage when included in stream", async () => {
      const mockStream = createMockStream([
        'data: {"choices":[{"delta":{"content":"Hi"}}]}',
        'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}',
      ]);

      mockHttpService.post.mockReturnValueOnce(
        of({ data: mockStream } as any) as any,
      );

      let usageChunk: any = null;
      for await (const chunk of service.streamOpenAICompatible(
        "https://api.openai.com/v1/chat/completions",
        "test-key",
        "gpt-4o",
        messages,
        4000,
      )) {
        if (chunk.usage) {
          usageChunk = chunk;
        }
      }

      expect(usageChunk).toBeDefined();
      expect(usageChunk.usage.totalTokens).toBe(15);
    });

    it("should handle errors gracefully", async () => {
      mockHttpService.post.mockReturnValueOnce(
        of({ data: null } as any) as any,
      );

      // Override to throw an error
      mockHttpService.post.mockImplementationOnce(() => {
        throw new Error("Connection failed");
      });

      const chunks: any[] = [];
      for await (const chunk of service.streamOpenAICompatible(
        "https://api.openai.com/v1/chat/completions",
        "test-key",
        "gpt-4o",
        messages,
        4000,
      )) {
        chunks.push(chunk);
      }

      const errorChunk = chunks.find((c) => c.error);
      expect(errorChunk).toBeDefined();
      expect(errorChunk.done).toBe(true);
    });

    it("should add reasoning_effort when isReasoning=true (DB-driven, not model name)", async () => {
      // ★ 防回归：reasoning_effort 由 isReasoning 参数（DB 驱动）决定，
      //   不再依赖模型名 startsWith。BYOK 接的 gpt-5/o4 等只要 DB 标 isReasoning=true 就传。
      const mockStream = createMockStream(["data: [DONE]"]);

      mockHttpService.post.mockReturnValueOnce(
        of({ data: mockStream } as any) as any,
      );

      for await (const _ of service.streamOpenAICompatible(
        "https://api.openai.com/v1/chat/completions",
        "test-key",
        "o1-mini",
        messages,
        25000,
        undefined, // temperature
        "max_completion_tokens",
        true, // ★ isReasoning
      )) {
        break;
      }

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      // 没传 reasoningDepth → 默认 low（所有 reasoning 模型都接受的最低公分母）
      expect(callArgs[1]).toHaveProperty("reasoning_effort", "low");
    });

    it("should NOT add reasoning_effort when isReasoning=false (default)", async () => {
      const mockStream = createMockStream(["data: [DONE]"]);

      mockHttpService.post.mockReturnValueOnce(
        of({ data: mockStream } as any) as any,
      );

      for await (const _ of service.streamOpenAICompatible(
        "https://api.openai.com/v1/chat/completions",
        "test-key",
        "o1-mini", // 名字像 reasoning，但 isReasoning 默认 false
        messages,
        25000,
      )) {
        break;
      }

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      expect(callArgs[1]).not.toHaveProperty("reasoning_effort");
    });

    it("should use custom tokenParamName", async () => {
      const mockStream = createMockStream(["data: [DONE]"]);

      mockHttpService.post.mockReturnValueOnce(
        of({ data: mockStream } as any) as any,
      );

      for await (const _ of service.streamOpenAICompatible(
        "https://api.openai.com/v1/chat/completions",
        "test-key",
        "gpt-4o",
        messages,
        8000,
        undefined,
        "max_completion_tokens",
      )) {
        break;
      }

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      expect(callArgs[1]).toHaveProperty("max_completion_tokens", 8000);
    });

    it("should yield done chunk when stream ends without [DONE]", async () => {
      const mockStream = createMockStream([
        'data: {"choices":[{"delta":{"content":"end"}}]}',
        // no [DONE]
      ]);

      mockHttpService.post.mockReturnValueOnce(
        of({ data: mockStream } as any) as any,
      );

      const chunks: any[] = [];
      for await (const chunk of service.streamOpenAICompatible(
        "https://api.openai.com/v1/chat/completions",
        "test-key",
        "gpt-4o",
        messages,
        4000,
      )) {
        chunks.push(chunk);
      }

      // Should always end with a done chunk
      expect(chunks[chunks.length - 1].done).toBe(true);
    });

    it("should skip malformed JSON lines", async () => {
      const mockStream = createMockStream([
        "data: not valid json",
        'data: {"choices":[{"delta":{"content":"OK"}}]}',
        "data: [DONE]",
      ]);

      mockHttpService.post.mockReturnValueOnce(
        of({ data: mockStream } as any) as any,
      );

      const chunks: string[] = [];
      for await (const chunk of service.streamOpenAICompatible(
        "https://api.openai.com/v1/chat/completions",
        "test-key",
        "gpt-4o",
        messages,
        4000,
      )) {
        if (chunk.content) chunks.push(chunk.content);
        if (chunk.done) break;
      }

      expect(chunks.some((c) => c === "OK")).toBe(true);
    });
  });

  // ==================== streamAnthropic ====================

  describe("streamAnthropic", () => {
    const messages = [
      { role: "system" as const, content: "You are helpful" },
      { role: "user" as const, content: "Hello" },
    ];

    it("should stream Anthropic content chunks", async () => {
      const mockStream = createMockStream([
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" Claude"}}',
        'data: {"type":"message_stop"}',
      ]);

      mockHttpService.post.mockReturnValueOnce(
        of({ data: mockStream } as any) as any,
      );

      const chunks: string[] = [];
      for await (const chunk of service.streamAnthropic(
        "https://api.anthropic.com/v1/messages",
        "test-key",
        "claude-3-5-sonnet-20241022",
        messages,
        4000,
        0.7,
      )) {
        if (chunk.content) chunks.push(chunk.content);
        if (chunk.done) break;
      }

      expect(chunks.join("")).toContain("Hello");
    });

    it("should yield done when message_stop received", async () => {
      const mockStream = createMockStream([
        'data: {"type":"content_block_delta","delta":{"text":"Hi"}}',
        'data: {"type":"message_stop"}',
      ]);

      mockHttpService.post.mockReturnValueOnce(
        of({ data: mockStream } as any) as any,
      );

      const chunks: any[] = [];
      for await (const chunk of service.streamAnthropic(
        "https://api.anthropic.com/v1/messages",
        "test-key",
        "claude-3-5-sonnet-20241022",
        messages,
        4000,
      )) {
        chunks.push(chunk);
      }

      expect(chunks.some((c) => c.done)).toBe(true);
    });

    it("should handle Anthropic stream errors", async () => {
      mockHttpService.post.mockImplementationOnce(() => {
        throw new Error("Anthropic API error");
      });

      const chunks: any[] = [];
      for await (const chunk of service.streamAnthropic(
        "https://api.anthropic.com/v1/messages",
        "test-key",
        "claude-3-5-sonnet-20241022",
        messages,
        4000,
      )) {
        chunks.push(chunk);
      }

      const errorChunk = chunks.find((c) => c.error);
      expect(errorChunk).toBeDefined();
      expect(errorChunk.error).toContain("Anthropic API error");
    });

    it("should separate system messages", async () => {
      const mockStream = createMockStream(['data: {"type":"message_stop"}']);

      mockHttpService.post.mockReturnValueOnce(
        of({ data: mockStream } as any) as any,
      );

      for await (const _ of service.streamAnthropic(
        "https://api.anthropic.com/v1/messages",
        "test-key",
        "claude-3-5-sonnet-20241022",
        messages,
        4000,
      )) {
        break;
      }

      const callArgs = (mockHttpService.post as jest.Mock).mock.calls[0];
      const body = callArgs[1];
      expect(body.system).toBe("You are helpful");
      expect(body.messages).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ role: "system" })]),
      );
    });

    it("should yield done at stream end without message_stop", async () => {
      const mockStream = createMockStream([
        'data: {"type":"content_block_delta","delta":{"text":"Hi"}}',
        // no message_stop
      ]);

      mockHttpService.post.mockReturnValueOnce(
        of({ data: mockStream } as any) as any,
      );

      const chunks: any[] = [];
      for await (const chunk of service.streamAnthropic(
        "https://api.anthropic.com/v1/messages",
        "test-key",
        "claude-3-5-sonnet-20241022",
        messages,
        4000,
      )) {
        chunks.push(chunk);
      }

      expect(chunks[chunks.length - 1].done).toBe(true);
    });

    it("should skip empty data lines", async () => {
      const mockStream = createMockStream([
        "data: ",
        'data: {"type":"content_block_delta","delta":{"text":"Hi"}}',
        'data: {"type":"message_stop"}',
      ]);

      mockHttpService.post.mockReturnValueOnce(
        of({ data: mockStream } as any) as any,
      );

      const chunks: string[] = [];
      for await (const chunk of service.streamAnthropic(
        "https://api.anthropic.com/v1/messages",
        "test-key",
        "claude-3-5-sonnet-20241022",
        messages,
        4000,
      )) {
        if (chunk.content) chunks.push(chunk.content);
        if (chunk.done) break;
      }

      expect(chunks.join("")).toBe("Hi");
    });
  });
});
