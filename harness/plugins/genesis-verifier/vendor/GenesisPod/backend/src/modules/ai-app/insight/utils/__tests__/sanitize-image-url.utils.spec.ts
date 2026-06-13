import { isValidFigureUrl } from "../sanitize-image-url.utils";

describe("isValidFigureUrl", () => {
  // ── Valid URLs ──
  it("should accept HTTP URLs", () => {
    expect(isValidFigureUrl("https://example.com/chart.png")).toBe(true);
    expect(isValidFigureUrl("http://example.com/image.jpg")).toBe(true);
  });

  // ── Invalid URLs ──
  it("should reject null/undefined/empty", () => {
    expect(isValidFigureUrl(null)).toBe(false);
    expect(isValidFigureUrl(undefined)).toBe(false);
    expect(isValidFigureUrl("")).toBe(false);
  });

  it("should reject LLM placeholder strings", () => {
    expect(isValidFigureUrl("[base64-image:chart]")).toBe(false);
    expect(isValidFigureUrl("base64-image:chart")).toBe(false);
  });

  it("should reject ALL data: URLs (v7: no base64 images)", () => {
    expect(isValidFigureUrl("data:image/png;base64,iVBORw0KGgoAAAA...")).toBe(
      false,
    );
    expect(isValidFigureUrl("data:image/jpeg;base64,/9j/4AAQSkZJ...")).toBe(
      false,
    );
    expect(isValidFigureUrl("data:text/plain;base64,abc")).toBe(false);
    expect(isValidFigureUrl("data:application/pdf;base64,abc")).toBe(false);
  });

  it("should reject fabricated URLs with xxxx", () => {
    expect(isValidFigureUrl("https://xxxx.example.com/chart.png")).toBe(false);
  });

  it("should reject PDF links", () => {
    expect(isValidFigureUrl("https://arxiv.org/paper.pdf")).toBe(false);
    expect(isValidFigureUrl("https://arxiv.org/paper.pdf?v=2")).toBe(false);
  });

  it("should reject corrupted Substack CDN URLs ($s! pattern)", () => {
    expect(
      isValidFigureUrl(
        "https://substackcdn.com/image/fetch/$s!pZed!,w_1456,c_limit/https%3A%2F%2Fexample.com",
      ),
    ).toBe(false);
    expect(
      isValidFigureUrl(
        "https://substackcdn.com/image/fetch/%24s!abc,w_1456/example.png",
      ),
    ).toBe(false);
  });

  it("should reject non-HTTP protocols", () => {
    expect(isValidFigureUrl("file:///tmp/chart.png")).toBe(false);
    expect(isValidFigureUrl("/images/chart.png")).toBe(false);
    expect(isValidFigureUrl("ftp://example.com/chart.png")).toBe(false);
  });
});
