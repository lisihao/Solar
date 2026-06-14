import { Test, TestingModule } from "@nestjs/testing";
import { ProxyController } from "../proxy.controller";
import { AdvancedExtractorService } from "../../../../../common/content-processing/advanced-extractor.service";
import { NewsExtractorService } from "../news-extractor.service";
import { PuppeteerFetcherService } from "../puppeteer-fetcher.service";
import { FlareSolverrService } from "../flaresolverr.service";
import { HttpException } from "@nestjs/common";
import axios from "axios";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("ProxyController - Reader Mode Fallback Chain", () => {
  let controller: ProxyController;
  let newsExtractor: jest.Mocked<NewsExtractorService>;
  let puppeteerFetcher: jest.Mocked<PuppeteerFetcherService>;

  // 测试用 HTML 内容
  const validHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Test Article - Example Site</title>
        <meta property="og:title" content="Test Article">
        <meta property="og:description" content="This is a test article description.">
        <meta property="og:site_name" content="Example Site">
      </head>
      <body>
        <article>
          <h1>Test Article</h1>
          <p>This is the main content of the article. It contains enough text to pass the validation checks.
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt
          ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco
          laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in
          voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat
          non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. Curabitur pretium
          tincidunt lacus. Nulla gravida orci a odio. Nullam varius, turpis et commodo pharetra.</p>
        </article>
      </body>
    </html>
  `;

  // Jina Reader Markdown 响应
  const jinaMarkdownResponse = `# Test Article

This is the main content of the article fetched via Jina Reader.
It contains enough text to pass the validation checks.
Lorem ipsum dolor sit amet, consectetur adipiscing elit.
Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.`;

  // Jina Reader 返回 CAPTCHA 内容
  const jinaCaptchaResponse = `Title: Checking your browser

Verify you are human

Please complete the security check to access the website.
This connection needs to review the security of your connection.`;

  beforeEach(async () => {
    // Mock AdvancedExtractorService
    const mockAdvancedExtractor = {
      extract: jest.fn().mockResolvedValue({
        title: "Test Article",
        content:
          "<article><p>This is the main content of the article. It contains enough text to pass the validation checks. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident.</p></article>",
        textContent:
          "This is the main content of the article. It contains enough text to pass the validation checks. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. Curabitur pretium tincidunt lacus.",
        excerpt: "This is a test article description.",
        siteName: "Example Site",
        length: 500,
        plan: "readability",
        confidence: 85,
        success: true,
      }),
    };

    // Mock NewsExtractorService
    const mockNewsExtractor = {
      extractNews: jest.fn().mockResolvedValue({
        title: "Test Article",
        excerpt: "This is a test article description.",
        author: null,
        publishedAt: null,
        siteName: "Example Site",
        imageUrl: null,
        source: "opengraph",
        confidence: 75,
      }),
      detectMetaRefreshRedirect: jest.fn().mockReturnValue({
        isRedirect: false,
        redirectUrl: null,
      }),
    };

    // Mock PuppeteerFetcherService
    const mockPuppeteerFetcher = {
      fetchPage: jest.fn().mockResolvedValue({
        success: true,
        html: validHtml,
        title: "Test Article",
        loadTime: 3500,
      }),
    };

    // Mock FlareSolverrService
    const mockFlareSolverr = {
      getIsAvailable: jest.fn().mockReturnValue(false),
      fetchPage: jest.fn().mockResolvedValue({
        success: false,
        error: "FlareSolverr not available in test",
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProxyController],
      providers: [
        { provide: AdvancedExtractorService, useValue: mockAdvancedExtractor },
        { provide: NewsExtractorService, useValue: mockNewsExtractor },
        { provide: PuppeteerFetcherService, useValue: mockPuppeteerFetcher },
        { provide: FlareSolverrService, useValue: mockFlareSolverr },
      ],
    }).compile();

    controller = module.get<ProxyController>(ProxyController);
    newsExtractor = module.get(NewsExtractorService);
    puppeteerFetcher = module.get(PuppeteerFetcherService);

    // Reset axios mocks
    jest.clearAllMocks();
    // Override isAxiosError for tests
    (axios as any).isAxiosError = (payload: any): boolean =>
      payload?.isAxiosError === true;
  });

  describe("Scenario 1: Direct HTTP Fetch Success", () => {
    it("should successfully fetch content directly without fallback", async () => {
      // 模拟直接 HTTP 请求成功
      mockedAxios.get.mockResolvedValueOnce({
        status: 200,
        data: validHtml,
      });

      const result = await controller.proxyHtmlReaderNews(
        "https://example.com/article",
      );

      expect(result.title).toBe("Test Article");
      expect(result.plan).toBe("readability");
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      expect(puppeteerFetcher.fetchPage).not.toHaveBeenCalled();
    });

    it("should handle multiple test URLs with direct fetch", async () => {
      const testUrls = [
        "https://www.nytimes.com/2024/01/15/technology/article.html",
        "https://www.bbc.com/news/world-12345678",
        "https://techcrunch.com/2024/01/15/startup-news/",
        "https://www.theguardian.com/technology/2024/jan/15/article",
        "https://arstechnica.com/science/2024/01/research-news/",
      ];

      for (const url of testUrls) {
        mockedAxios.get.mockResolvedValueOnce({
          status: 200,
          data: validHtml,
        });

        const result = await controller.proxyHtmlReaderNews(url);
        expect(result.title).toBeDefined();
        expect(result.content).toBeDefined();
      }

      expect(mockedAxios.get).toHaveBeenCalledTimes(testUrls.length);
    });
  });

  describe("Scenario 2: 403 Error -> Jina Reader Fallback Success", () => {
    it("should fallback to Jina Reader when direct fetch returns 403", async () => {
      // 模拟直接请求返回 403
      const error403 = {
        response: { status: 403 },
        isAxiosError: true,
      };
      mockedAxios.get.mockRejectedValueOnce(error403);

      // 模拟 Jina Reader 成功返回
      mockedAxios.get.mockResolvedValueOnce({
        status: 200,
        data: jinaMarkdownResponse,
      });

      const result = await controller.proxyHtmlReaderNews(
        "https://blog.adafruit.com/article",
      );

      expect(result.title).toBeDefined();
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
      // 验证第二次调用是 Jina Reader
      expect(mockedAxios.get).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("r.jina.ai"),
        expect.any(Object),
      );
    });
  });

  describe("Scenario 3: 403 + Jina CAPTCHA -> Puppeteer Fallback", () => {
    it("should fallback to Puppeteer when Jina Reader returns CAPTCHA", async () => {
      // 模拟直接请求返回 403
      const error403 = {
        response: { status: 403 },
        isAxiosError: true,
      };
      mockedAxios.get.mockRejectedValueOnce(error403);

      // 模拟 Jina Reader 返回 CAPTCHA 内容
      mockedAxios.get.mockResolvedValueOnce({
        status: 200,
        data: jinaCaptchaResponse,
      });

      // Puppeteer mock 已在 beforeEach 中设置

      const result = await controller.proxyHtmlReaderNews(
        "https://protected-site.com/article",
      );

      expect(result.title).toBeDefined();
      expect(puppeteerFetcher.fetchPage).toHaveBeenCalledWith(
        "https://protected-site.com/article",
        expect.objectContaining({ timeout: expect.any(Number) }),
      );
    });
  });

  describe("Scenario 4: All Methods Fail -> Graceful Degradation", () => {
    it("should return graceful degradation response when all methods fail", async () => {
      // 模拟直接请求返回 403
      const error403 = {
        response: { status: 403 },
        isAxiosError: true,
      };
      mockedAxios.get.mockRejectedValueOnce(error403);

      // 模拟 Jina Reader 返回 CAPTCHA
      mockedAxios.get.mockResolvedValueOnce({
        status: 200,
        data: jinaCaptchaResponse,
      });

      // 模拟 Puppeteer 失败
      puppeteerFetcher.fetchPage = jest.fn().mockResolvedValue({
        success: false,
        error: "Cloudflare challenge failed",
      });

      const result = await controller.proxyHtmlReaderNews(
        "https://heavily-protected.com/article",
      );

      expect(result.success).toBe(false);
      expect(result.requiresCaptcha).toBe(true);
      expect(result.message).toContain("人机验证");
    });
  });

  describe("Scenario 5: PDF URL Detection", () => {
    it("should detect PDF URLs and return appropriate response", async () => {
      const result = await controller.proxyHtmlReaderNews(
        "https://example.com/document.pdf",
      );

      expect(result.isPdf).toBe(true);
      expect(result.pdfUrl).toBe("https://example.com/document.pdf");
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });
  });

  describe("Scenario 6: Meta Refresh Redirect Handling", () => {
    it("should follow meta refresh redirects", async () => {
      const redirectHtml = `
        <!DOCTYPE HTML>
        <html>
          <head>
            <meta http-equiv="refresh" content="0; url=https://blog.google/actual-article">
          </head>
          <body></body>
        </html>
      `;

      // 第一次请求返回重定向页面
      mockedAxios.get.mockResolvedValueOnce({
        status: 200,
        data: redirectHtml,
      });

      // 第二次请求返回真实内容
      mockedAxios.get.mockResolvedValueOnce({
        status: 200,
        data: validHtml,
      });

      // 设置 mock 检测到重定向
      newsExtractor.detectMetaRefreshRedirect = jest
        .fn()
        .mockReturnValueOnce({
          isRedirect: true,
          redirectUrl: "https://blog.google/actual-article",
        })
        .mockReturnValueOnce({
          isRedirect: false,
          redirectUrl: null,
        });

      const result = await controller.proxyHtmlReaderNews(
        "https://deepmind.google/blog/redirect-page",
      );

      expect(result.title).toBeDefined();
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });
  });

  describe("Input Validation", () => {
    it("should throw error when URL is missing", async () => {
      await expect(controller.proxyHtmlReaderNews("")).rejects.toThrow(
        HttpException,
      );
    });
  });
});

/**
 * Reader Mode Coverage Test URLs
 *
 * 以下是用于手动测试和验证的 URL 列表：
 *
 * 场景 1: 直接获取成功（无 Cloudflare 保护）
 * - https://www.nytimes.com/
 * - https://www.bbc.com/news
 * - https://techcrunch.com/
 * - https://www.theguardian.com/
 * - https://arstechnica.com/
 *
 * 场景 2: 需要 Jina Reader (403/bot detection)
 * - https://medium.com/@username/article
 * - https://www.linkedin.com/pulse/article
 *
 * 场景 3: Cloudflare 保护（可能需要 Puppeteer）
 * - https://blog.adafruit.com/
 * - https://www.cloudflare.com/
 *
 * 场景 4: PDF 文件检测
 * - https://example.com/document.pdf
 * - https://arxiv.org/pdf/2301.00000.pdf
 *
 * 场景 5: Meta Refresh 重定向
 * - https://deepmind.google/blog/xxx (redirects to blog.google)
 */
