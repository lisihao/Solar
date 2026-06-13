import { Test, TestingModule } from "@nestjs/testing";
import { NewsExtractorService } from "../news-extractor.service";

describe("NewsExtractorService", () => {
  let service: NewsExtractorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NewsExtractorService],
    }).compile();

    service = module.get<NewsExtractorService>(NewsExtractorService);
  });

  describe("detectMetaRefreshRedirect", () => {
    it("should detect meta refresh redirect", () => {
      const html = `
        <html>
          <head>
            <meta http-equiv="refresh" content="0; url=https://new-site.com/article">
          </head>
          <body></body>
        </html>
      `;

      const result = service.detectMetaRefreshRedirect(
        html,
        "https://old-site.com",
      );

      expect(result.isRedirect).toBe(true);
      expect(result.redirectUrl).toBe("https://new-site.com/article");
    });

    it("should detect meta refresh with delay and quoted URL", () => {
      const html = `
        <html>
          <head>
            <meta http-equiv="Refresh" content="3; url='https://destination.com/'">
          </head>
          <body></body>
        </html>
      `;

      const result = service.detectMetaRefreshRedirect(
        html,
        "https://source.com",
      );

      expect(result.isRedirect).toBe(true);
      expect(result.redirectUrl).toContain("destination.com");
    });

    it("should return no redirect when no meta refresh tag present", () => {
      const html = `
        <html>
          <head><title>Normal Page</title></head>
          <body><p>Normal content here that is long enough to exceed 200 characters. More content added here to ensure the body text length check passes properly in the test scenario.</p></body>
        </html>
      `;

      const result = service.detectMetaRefreshRedirect(
        html,
        "https://example.com",
      );

      expect(result.isRedirect).toBe(false);
      expect(result.redirectUrl).toBeNull();
    });

    it("should detect JavaScript window.location redirect", () => {
      const html = `
        <html>
          <head></head>
          <body>
            <script>
              window.location.href = "https://redirected.com/page";
            </script>
          </body>
        </html>
      `;

      const result = service.detectMetaRefreshRedirect(
        html,
        "https://source.com",
      );

      expect(result.isRedirect).toBe(true);
      expect(result.redirectUrl).toBe("https://redirected.com/page");
    });

    it("should convert relative redirect URL to absolute", () => {
      const html = `
        <html>
          <head>
            <meta http-equiv="refresh" content="0; url=/new-path">
          </head>
          <body></body>
        </html>
      `;

      const result = service.detectMetaRefreshRedirect(
        html,
        "https://example.com",
      );

      expect(result.isRedirect).toBe(true);
      expect(result.redirectUrl).toBe("https://example.com/new-path");
    });

    it("should decode HTML entities in redirect URL", () => {
      const html = `
        <html>
          <head>
            <meta http-equiv="refresh" content="0; url=https://example.com/page?a=1&amp;b=2">
          </head>
          <body></body>
        </html>
      `;

      const result = service.detectMetaRefreshRedirect(
        html,
        "https://source.com",
      );

      expect(result.isRedirect).toBe(true);
      expect(result.redirectUrl).toContain("a=1&b=2");
    });

    it("should return no redirect on error", () => {
      const result = service.detectMetaRefreshRedirect(
        "invalid html",
        "not-a-url",
      );

      // Should handle gracefully even with invalid inputs
      expect(result).toBeDefined();
      expect(typeof result.isRedirect).toBe("boolean");
    });
  });

  describe("extractNews", () => {
    it("should extract news from Schema.org JSON-LD", async () => {
      const longArticleBody =
        "This is the full and detailed content of the news article which is definitely longer than one hundred characters and should be valid for extraction purposes.";
      const html = `
        <html>
          <head>
            <script type="application/ld+json">
              {
                "@type": "NewsArticle",
                "headline": "Breaking News Title",
                "articleBody": "${longArticleBody}",
                "author": {"name": "John Doe"},
                "datePublished": "2024-01-15T10:00:00Z",
                "publisher": {"name": "Test News"}
              }
            </script>
          </head>
          <body>
            <article>Content here that spans multiple paragraphs and is long enough.</article>
          </body>
        </html>
      `;

      const result = await service.extractNews(
        html,
        "https://news.example.com/article",
      );

      expect(result.title).toBe("Breaking News Title");
      expect(result.source).toBe("schemaorg");
      expect(result.confidence).toBe(95);
      expect(result.author).toBe("John Doe");
    });

    it("should extract news from Schema.org with Article type", async () => {
      const html = `
        <html>
          <head>
            <script type="application/ld+json">
              {
                "@type": "Article",
                "headline": "Article Title",
                "articleBody": "${"x".repeat(150)}",
                "author": "Jane Smith"
              }
            </script>
          </head>
          <body></body>
        </html>
      `;

      const result = await service.extractNews(
        html,
        "https://blog.example.com/post",
      );

      expect(result.title).toBe("Article Title");
      expect(result.source).toBe("schemaorg");
    });

    it("should fallback to Open Graph when Schema.org is absent", async () => {
      const longBody = "This is the main article content. ".repeat(10);
      const html = `
        <html>
          <head>
            <meta property="og:title" content="OG Article Title">
            <meta property="og:description" content="OG description">
            <meta property="og:image" content="https://example.com/image.jpg">
            <meta property="og:site_name" content="Example Site">
            <meta property="article:published_time" content="2024-01-15T10:00:00Z">
          </head>
          <body>
            <article>${longBody}</article>
          </body>
        </html>
      `;

      const result = await service.extractNews(
        html,
        "https://example.com/article",
      );

      expect(result.title).toBe("OG Article Title");
      expect(result.source).toBe("opengraph");
      expect(result.confidence).toBe(75);
      expect(result.siteName).toBe("Example Site");
    });

    it("should fallback to Twitter Card when OG is absent", async () => {
      const longBody =
        "This is a long enough content body for validation. ".repeat(5);
      const html = `
        <html>
          <head>
            <meta name="twitter:title" content="Twitter Card Title">
            <meta name="twitter:description" content="Twitter description">
            <meta name="twitter:image" content="https://example.com/image.jpg">
          </head>
          <body>
            <main>${longBody}</main>
          </body>
        </html>
      `;

      const result = await service.extractNews(
        html,
        "https://example.com/article",
      );

      expect(result.title).toBe("Twitter Card Title");
      expect(result.source).toBe("twittercard");
      expect(result.confidence).toBe(60);
    });

    it("should use generic extraction when all structured methods fail", async () => {
      const html = `
        <html>
          <head><title>Generic Page Title</title></head>
          <body>
            <h1>Main Heading</h1>
            <p>This is the content of the page with some text.</p>
          </body>
        </html>
      `;

      const result = await service.extractNews(
        html,
        "https://example.com/page",
      );

      expect(result.title).toBeTruthy();
      expect(result.source).toBe("generic");
      expect(result.confidence).toBe(50);
    });

    it("should detect paywall indicators in content", async () => {
      const html = `
        <html>
          <head>
            <meta property="og:title" content="Paywalled Article">
            <meta property="og:description" content="Subscribe to read more">
          </head>
          <body>
            <article>
              ${"Content paragraph. ".repeat(10)}
              Please subscribe to read the full article. This is premium content.
              sign in to read the complete story.
            </article>
          </body>
        </html>
      `;

      const result = await service.extractNews(
        html,
        "https://example.com/article",
      );

      expect(result.paywalledIndicators.length).toBeGreaterThan(0);
    });

    it("should handle Schema.org @graph structure", async () => {
      const html = `
        <html>
          <head>
            <script type="application/ld+json">
              {
                "@context": "https://schema.org",
                "@graph": [
                  {
                    "@type": "WebPage",
                    "name": "Web Page"
                  },
                  {
                    "@type": "NewsArticle",
                    "headline": "Graph Article Title",
                    "articleBody": "${"Content ".repeat(20)}",
                    "author": [{"name": "Author One"}, {"name": "Author Two"}]
                  }
                ]
              }
            </script>
          </head>
          <body></body>
        </html>
      `;

      const result = await service.extractNews(
        html,
        "https://example.com/article",
      );

      expect(result.title).toBe("Graph Article Title");
      expect(result.source).toBe("schemaorg");
    });

    it("should handle author as array in Schema.org", async () => {
      const html = `
        <html>
          <head>
            <script type="application/ld+json">
              {
                "@type": "NewsArticle",
                "headline": "Multi-author Article",
                "articleBody": "${"Content ".repeat(20)}",
                "author": [{"name": "First Author"}, {"name": "Second Author"}]
              }
            </script>
          </head>
          <body></body>
        </html>
      `;

      const result = await service.extractNews(
        html,
        "https://example.com/article",
      );

      expect(result.author).toBe("First Author");
    });

    it("should extract siteName from URL hostname when not in OG", async () => {
      const longBody = "Content paragraph. ".repeat(10);
      const html = `
        <html>
          <head>
            <meta property="og:title" content="Test Article">
          </head>
          <body><article>${longBody}</article></body>
        </html>
      `;

      const result = await service.extractNews(
        html,
        "https://www.test-news.com/article",
      );

      expect(result.siteName).toBe("test-news.com");
    });

    it("should extract publish date from Open Graph article time", async () => {
      const longBody = "Content paragraph. ".repeat(10);
      const html = `
        <html>
          <head>
            <meta property="og:title" content="Dated Article">
            <meta property="article:published_time" content="2024-03-15T12:00:00Z">
          </head>
          <body><article>${longBody}</article></body>
        </html>
      `;

      const result = await service.extractNews(
        html,
        "https://example.com/article",
      );

      expect(result.publishDate).toBeInstanceOf(Date);
      expect(result.publishDate!.getFullYear()).toBe(2024);
    });

    it("should handle malformed JSON-LD gracefully", async () => {
      const html = `
        <html>
          <head>
            <script type="application/ld+json">{ invalid json }</script>
            <meta property="og:title" content="Fallback Title">
          </head>
          <body><article>${"content ".repeat(20)}</article></body>
        </html>
      `;

      const result = await service.extractNews(
        html,
        "https://example.com/article",
      );

      // Should fallback gracefully
      expect(result).toBeDefined();
      expect(result.title).toBeTruthy();
    });
  });
});
