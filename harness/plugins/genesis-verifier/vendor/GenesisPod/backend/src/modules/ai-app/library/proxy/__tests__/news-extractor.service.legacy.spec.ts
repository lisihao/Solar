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
    it("should detect meta refresh redirect with URL in content attribute", () => {
      const html = `
        <!DOCTYPE HTML>
        <html>
          <head>
            <meta charset="utf-8">
            <meta http-equiv="refresh" content="1; url=https://blog.google/products/gemini/gemini-3/">
            <title>Redirect Page</title>
          </head>
          <body></body>
        </html>
      `;

      const result = service.detectMetaRefreshRedirect(
        html,
        "https://deepmind.google/blog/test",
      );

      expect(result.isRedirect).toBe(true);
      expect(result.redirectUrl).toBe(
        "https://blog.google/products/gemini/gemini-3/",
      );
    });

    it("should detect meta refresh redirect with HTML entities", () => {
      const html = `
        <!DOCTYPE HTML>
        <html>
          <head>
            <meta http-equiv="refresh" content="0; url=https://blog.google/test?utm_source=deepmind&amp;utm_medium=referral">
          </head>
          <body></body>
        </html>
      `;

      const result = service.detectMetaRefreshRedirect(
        html,
        "https://deepmind.google/blog/test",
      );

      expect(result.isRedirect).toBe(true);
      expect(result.redirectUrl).toBe(
        "https://blog.google/test?utm_source=deepmind&utm_medium=referral",
      );
    });

    it("should detect JavaScript window.location redirect", () => {
      const html = `
        <!DOCTYPE HTML>
        <html>
          <head>
            <script type="text/javascript">
              window.location.href = "https://blog.google/products/gemini/gemini-3/";
            </script>
          </head>
          <body></body>
        </html>
      `;

      const result = service.detectMetaRefreshRedirect(
        html,
        "https://deepmind.google/blog/test",
      );

      expect(result.isRedirect).toBe(true);
      expect(result.redirectUrl).toBe(
        "https://blog.google/products/gemini/gemini-3/",
      );
    });

    it("should detect window.location without href", () => {
      const html = `
        <!DOCTYPE HTML>
        <html>
          <head>
            <script>
              window.location = "https://example.com/page";
            </script>
          </head>
          <body></body>
        </html>
      `;

      const result = service.detectMetaRefreshRedirect(
        html,
        "https://test.com/",
      );

      expect(result.isRedirect).toBe(true);
      expect(result.redirectUrl).toBe("https://example.com/page");
    });

    it("should return no redirect for normal content page", () => {
      const html = `
        <!DOCTYPE HTML>
        <html>
          <head>
            <title>Normal Article</title>
          </head>
          <body>
            <article>
              <h1>This is a normal article with lots of content</h1>
              <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit.
              Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
              Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.</p>
            </article>
          </body>
        </html>
      `;

      const result = service.detectMetaRefreshRedirect(
        html,
        "https://example.com/article",
      );

      expect(result.isRedirect).toBe(false);
      expect(result.redirectUrl).toBeNull();
    });

    it("should handle relative URLs in meta refresh", () => {
      const html = `
        <!DOCTYPE HTML>
        <html>
          <head>
            <meta http-equiv="refresh" content="0; url=/products/gemini/">
          </head>
          <body></body>
        </html>
      `;

      const result = service.detectMetaRefreshRedirect(
        html,
        "https://blog.google/old-path",
      );

      expect(result.isRedirect).toBe(true);
      expect(result.redirectUrl).toBe("https://blog.google/products/gemini/");
    });

    it("should handle meta refresh without space after semicolon", () => {
      const html = `
        <!DOCTYPE HTML>
        <html>
          <head>
            <meta http-equiv="refresh" content="0;url=https://target.com/page">
          </head>
          <body></body>
        </html>
      `;

      const result = service.detectMetaRefreshRedirect(html, "https://src.com");

      expect(result.isRedirect).toBe(true);
      expect(result.redirectUrl).toBe("https://target.com/page");
    });
  });

  describe("extractNews", () => {
    it("should extract news from Open Graph meta tags", async () => {
      const html = `
        <!DOCTYPE HTML>
        <html>
          <head>
            <meta property="og:title" content="Test Article Title">
            <meta property="og:description" content="This is the excerpt of the article.">
            <meta property="og:image" content="https://example.com/image.jpg">
            <meta property="og:site_name" content="Test Site">
            <meta property="article:published_time" content="2024-01-15T10:00:00Z">
            <meta property="article:author" content="John Doe">
          </head>
          <body>
            <article>
              <p>This is the main content of the article. It needs to be long enough to pass validation.
              Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt
              ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation.</p>
            </article>
          </body>
        </html>
      `;

      const result = await service.extractNews(
        html,
        "https://example.com/news",
      );

      expect(result.title).toBe("Test Article Title");
      expect(result.excerpt).toBe("This is the excerpt of the article.");
      expect(result.imageUrl).toBe("https://example.com/image.jpg");
      expect(result.siteName).toBe("Test Site");
      expect(result.source).toBe("opengraph");
    });

    it("should extract news from Schema.org JSON-LD", async () => {
      const html = `
        <!DOCTYPE HTML>
        <html>
          <head>
            <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "NewsArticle",
              "headline": "Schema.org Article Title",
              "description": "Schema.org description",
              "articleBody": "This is the full article body content that is extracted from Schema.org JSON-LD. It should be long enough to pass validation checks.",
              "datePublished": "2024-01-15T10:00:00Z",
              "author": {
                "@type": "Person",
                "name": "Jane Smith"
              },
              "publisher": {
                "@type": "Organization",
                "name": "News Publisher"
              }
            }
            </script>
          </head>
          <body></body>
        </html>
      `;

      const result = await service.extractNews(
        html,
        "https://news.com/article",
      );

      expect(result.title).toBe("Schema.org Article Title");
      expect(result.author).toBe("Jane Smith");
      expect(result.siteName).toBe("News Publisher");
      expect(result.source).toBe("schemaorg");
      expect(result.confidence).toBe(95);
    });
  });
});
