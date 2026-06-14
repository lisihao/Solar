/**
 * figure-url-sanitizer.util.ts unit tests
 * Covers: isValidFigureUrl function
 */
import { isValidFigureUrl } from "../figure-url-sanitizer.util";

describe("isValidFigureUrl", () => {
  // Happy path - valid URLs
  it("accepts valid https URL", () => {
    expect(isValidFigureUrl("https://example.com/image.png")).toBe(true);
  });

  it("accepts valid http URL", () => {
    expect(isValidFigureUrl("http://example.com/chart.jpg")).toBe(true);
  });

  it("accepts complex valid https URL with query params", () => {
    expect(
      isValidFigureUrl(
        "https://cdn.example.com/images/chart-2024.png?w=800&h=600",
      ),
    ).toBe(true);
  });

  // Falsy inputs
  it("returns false for undefined", () => {
    expect(isValidFigureUrl(undefined)).toBe(false);
  });

  it("returns false for null", () => {
    expect(isValidFigureUrl(null)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isValidFigureUrl("")).toBe(false);
  });

  // LLM hallucination patterns
  it("returns false for [base64-image placeholder", () => {
    expect(isValidFigureUrl("[base64-image:chart]")).toBe(false);
  });

  it("returns false for base64-image prefix", () => {
    expect(isValidFigureUrl("base64-image:chart-data")).toBe(false);
  });

  // data: URL rejection
  it("returns false for data:image/png URL", () => {
    expect(isValidFigureUrl("data:image/png;base64,abc123")).toBe(false);
  });

  it("returns false for any data: URL", () => {
    expect(isValidFigureUrl("data:application/pdf;base64,abc")).toBe(false);
  });

  // Fabricated URLs
  it("returns false for URL containing xxxx", () => {
    expect(isValidFigureUrl("https://example.com/xxxx/image.png")).toBe(false);
  });

  // PDF links
  it("returns false for PDF URL", () => {
    expect(isValidFigureUrl("https://example.com/paper.pdf")).toBe(false);
  });

  it("returns false for PDF URL with query string", () => {
    expect(isValidFigureUrl("https://example.com/file.pdf?download=1")).toBe(
      false,
    );
  });

  // Substack CDN corruption
  it("returns false for URL with $s! corruption", () => {
    expect(isValidFigureUrl("https://cdn.substack.com/$s!/image.jpg")).toBe(
      false,
    );
  });

  it("returns false for URL with %24s! corruption", () => {
    expect(isValidFigureUrl("https://cdn.substack.com/%24s!/image.jpg")).toBe(
      false,
    );
  });

  // Non-HTTP protocols
  it("returns false for relative path", () => {
    expect(isValidFigureUrl("./images/chart.png")).toBe(false);
  });

  it("returns false for file:// URL", () => {
    expect(isValidFigureUrl("file:///local/image.png")).toBe(false);
  });

  it("returns false for ftp:// URL", () => {
    expect(isValidFigureUrl("ftp://example.com/image.png")).toBe(false);
  });

  it("returns false for plain filename without protocol", () => {
    expect(isValidFigureUrl("image.png")).toBe(false);
  });
});
