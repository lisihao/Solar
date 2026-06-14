import { Test, TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { of, throwError } from "rxjs";
import { AxiosResponse } from "axios";
import { AiChatPromptService, ChatMessage } from "../ai-chat-prompt.service";

describe("AiChatPromptService", () => {
  let service: AiChatPromptService;
  let httpService: jest.Mocked<HttpService>;

  beforeEach(async () => {
    const mockHttpService = {
      get: jest.fn(),
      post: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiChatPromptService,
        { provide: HttpService, useValue: mockHttpService },
      ],
    }).compile();

    service = module.get<AiChatPromptService>(AiChatPromptService);
    httpService = module.get(HttpService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("buildMessages", () => {
    it("should build messages with system prompt", () => {
      const messages: ChatMessage[] = [{ role: "user", content: "Hello" }];
      const systemPrompt = "You are a helpful assistant";

      const result = service.buildMessages(messages, systemPrompt);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ role: "system", content: systemPrompt });
      expect(result[1]).toEqual(messages[0]);
    });

    it("should build messages without system prompt", () => {
      const messages: ChatMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
      ];

      const result = service.buildMessages(messages);

      expect(result).toHaveLength(2);
      expect(result).toEqual(messages);
    });

    it("should handle empty messages array", () => {
      const messages: ChatMessage[] = [];
      const systemPrompt = "Test prompt";

      const result = service.buildMessages(messages, systemPrompt);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ role: "system", content: systemPrompt });
    });
  });

  describe("extractUrls", () => {
    it("should extract single URL from text", () => {
      const text = "Check this out: https://example.com";

      const result = service.extractUrls(text);

      expect(result).toEqual(["https://example.com"]);
    });

    it("should extract multiple URLs from text", () => {
      const text =
        "Visit https://example.com and http://test.org for more info";

      const result = service.extractUrls(text);

      expect(result).toHaveLength(2);
      expect(result).toContain("https://example.com");
      expect(result).toContain("http://test.org");
    });

    it("should return empty array when no URLs found", () => {
      const text = "This is just plain text without any links";

      const result = service.extractUrls(text);

      expect(result).toEqual([]);
    });

    it("should handle URLs with query parameters", () => {
      const text = "Search: https://example.com?q=test&page=1";

      const result = service.extractUrls(text);

      expect(result).toEqual(["https://example.com?q=test&page=1"]);
    });
  });

  describe("needsWebSearch", () => {
    it("should detect Chinese search keywords", () => {
      expect(service.needsWebSearch("搜索最新新闻")).toBe(true);
      expect(service.needsWebSearch("查一下天气")).toBe(true);
      expect(service.needsWebSearch("最新的技术趋势")).toBe(true);
    });

    it("should detect English search keywords", () => {
      expect(service.needsWebSearch("search for articles")).toBe(true);
      expect(service.needsWebSearch("find latest news")).toBe(true);
      expect(service.needsWebSearch("look up current events")).toBe(true);
    });

    it("should return false for non-search queries", () => {
      expect(service.needsWebSearch("Hello, how are you?")).toBe(false);
      expect(service.needsWebSearch("Tell me a joke")).toBe(false);
      expect(service.needsWebSearch("What is 2+2?")).toBe(false);
    });

    it("should be case-insensitive", () => {
      expect(service.needsWebSearch("SEARCH for something")).toBe(true);
      expect(service.needsWebSearch("Look UP information")).toBe(true);
    });
  });

  describe("extractSearchQuery", () => {
    it("should remove common prefixes", () => {
      const text = "搜索一下人工智能";

      const result = service.extractSearchQuery(text);

      expect(result).toContain("人工智能");
      expect(result).not.toContain("搜索");
    });

    it("should remove @mentions", () => {
      const text = "@bot search for AI news";

      const result = service.extractSearchQuery(text);

      expect(result).toContain("AI news");
      expect(result).not.toContain("@bot");
    });

    it("should limit query length to 100 characters", () => {
      const longText = "search " + "a".repeat(200);

      const result = service.extractSearchQuery(longText);

      expect(result.length).toBeLessThanOrEqual(100);
    });

    it("should trim whitespace", () => {
      const text = "  搜索  机器学习  ";

      const result = service.extractSearchQuery(text);

      expect(result).toBe("机器学习");
    });
  });

  describe("webSearch", () => {
    it("should perform web search and return formatted results", async () => {
      const mockHtml = `
        <a class="result__a" href="https://example.com/1">Test Article 1</a>
        <a class="result__snippet">This is a test snippet</a>
        <a class="result__a" href="https://example.com/2">Test Article 2</a>
        <a class="result__snippet">Another snippet</a>
      `;

      const mockResponse: AxiosResponse = {
        data: mockHtml,
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as any,
      };

      httpService.get.mockReturnValue(of(mockResponse));

      const result = await service.webSearch("test query");

      expect(result).toContain("网络搜索结果");
      expect(result).toContain("Test Article 1");
      expect(httpService.get).toHaveBeenCalledWith(
        expect.stringContaining("duckduckgo"),
        expect.objectContaining({
          timeout: 10000,
          headers: expect.objectContaining({
            "User-Agent": expect.any(String),
          }),
        }),
      );
    });

    it("should handle search failure gracefully", async () => {
      httpService.get.mockReturnValue(
        throwError(() => new Error("Network error")),
      );

      const result = await service.webSearch("test query");

      expect(result).toContain("搜索失败");
    });

    it("should return message when no results found", async () => {
      const mockResponse: AxiosResponse = {
        data: "<html><body>No results</body></html>",
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as any,
      };

      httpService.get.mockReturnValue(of(mockResponse));

      const result = await service.webSearch("obscure query");

      expect(result).toContain("未找到结果");
    });
  });

  describe("fetchUrlContent", () => {
    it("should fetch and extract text content from URL", async () => {
      const mockHtml = `
        <html>
          <head><title>Test Page</title></head>
          <body>
            <script>var x = 1;</script>
            <style>.test { color: red; }</style>
            <p>This is the main content</p>
          </body>
        </html>
      `;

      const mockResponse: AxiosResponse = {
        data: mockHtml,
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as any,
      };

      httpService.get.mockReturnValue(of(mockResponse));

      const result = await service.fetchUrlContent("https://example.com");

      expect(result).toContain("main content");
      expect(result).not.toContain("<script>");
      expect(result).not.toContain("<style>");
    });

    it("should truncate content longer than 8000 characters", async () => {
      const longContent = "<html><body>" + "a".repeat(10000) + "</body></html>";

      const mockResponse: AxiosResponse = {
        data: longContent,
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as any,
      };

      httpService.get.mockReturnValue(of(mockResponse));

      const result = await service.fetchUrlContent("https://example.com");

      expect(result).not.toBeNull();
      expect(result!.length).toBeLessThanOrEqual(8030); // 8000 + "... [内容已截断]"
      expect(result).toContain("已截断");
    });

    it("should return null on fetch failure", async () => {
      httpService.get.mockReturnValue(
        throwError(() => new Error("Network error")),
      );

      const result = await service.fetchUrlContent("https://example.com");

      expect(result).toBeNull();
    });
  });

  describe("augmentMessagesWithUrlContent", () => {
    it("should augment user messages with URL content", async () => {
      const messages: ChatMessage[] = [
        { role: "user", content: "Check this: https://example.com" },
      ];

      const mockResponse: AxiosResponse = {
        data: "<html><body>Test content</body></html>",
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as any,
      };

      httpService.get.mockReturnValue(of(mockResponse));

      const result = await service.augmentMessagesWithUrlContent(messages);

      expect(result).toHaveLength(1);
      expect(result[0].content).toContain("Check this: https://example.com");
      expect(result[0].content).toContain("网页内容");
      expect(result[0].content).toContain("Test content");
    });

    it("should perform web search when search keywords detected", async () => {
      const messages: ChatMessage[] = [
        { role: "user", content: "搜索人工智能新闻" },
      ];

      const mockSearchHtml = `
        <a class="result__a" href="https://ai-news.com">AI News</a>
        <a class="result__snippet">Latest AI developments</a>
      `;

      const mockResponse: AxiosResponse = {
        data: mockSearchHtml,
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as any,
      };

      httpService.get.mockReturnValue(of(mockResponse));

      const result = await service.augmentMessagesWithUrlContent(
        messages,
        true,
      );

      expect(result).toHaveLength(1);
      expect(result[0].content).toContain("网络搜索结果");
    });

    it("should skip search when enableSearch is false", async () => {
      const messages: ChatMessage[] = [
        { role: "user", content: "搜索人工智能新闻" },
      ];

      const result = await service.augmentMessagesWithUrlContent(
        messages,
        false,
      );

      expect(result).toHaveLength(1);
      expect(result[0].content).not.toContain("网络搜索结果");
      expect(httpService.get).not.toHaveBeenCalled();
    });

    it("should not modify assistant messages", async () => {
      const messages: ChatMessage[] = [
        { role: "assistant", content: "This is a response" },
      ];

      const result = await service.augmentMessagesWithUrlContent(messages);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(messages[0]);
    });

    it("should limit URL fetching to 2 URLs", async () => {
      const messages: ChatMessage[] = [
        {
          role: "user",
          content:
            "https://example1.com https://example2.com https://example3.com",
        },
      ];

      const mockResponse: AxiosResponse = {
        data: "<html><body>Content</body></html>",
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as any,
      };

      httpService.get.mockReturnValue(of(mockResponse));

      await service.augmentMessagesWithUrlContent(messages);

      expect(httpService.get).toHaveBeenCalledTimes(2);
    });
  });
});
