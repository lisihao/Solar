/**
 * Unit tests for html-post-processor utility functions
 */

import { postProcessSlideHtml } from "../html-post-processor";

const makeFullHtml = (body: string, head = "") =>
  `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`;

describe("postProcessSlideHtml", () => {
  const defaultOptions = { slideIndex: 0, totalSlides: 5 };

  it("should return processed HTML string", () => {
    const html = makeFullHtml(
      '<div class="slide-container" style="width:1280px;height:720px;">content</div>',
    );
    const result = postProcessSlideHtml(html, defaultOptions);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("should strip leading ```html marker", () => {
    const html = "```html\n" + makeFullHtml("<p>Content</p>");
    const result = postProcessSlideHtml(html, defaultOptions);
    expect(result.startsWith("```")).toBe(false);
  });

  it("should strip trailing ``` marker", () => {
    const html = makeFullHtml("<p>Content</p>") + "\n```";
    const result = postProcessSlideHtml(html, defaultOptions);
    expect(result.endsWith("```")).toBe(false);
  });

  it("should inject Google Fonts CDN when missing", () => {
    const html = makeFullHtml("<p>No fonts</p>");
    const result = postProcessSlideHtml(html, defaultOptions);
    expect(result).toContain("fonts.googleapis.com");
  });

  it("should not add duplicate Google Fonts CDN when already present", () => {
    const head =
      '<link href="https://fonts.googleapis.com/css2?family=Roboto" rel="stylesheet">';
    const html = makeFullHtml("<p>Already has fonts</p>", head);
    const result = postProcessSlideHtml(html, defaultOptions);
    const count = (result.match(/fonts\.googleapis\.com/g) || []).length;
    expect(count).toBe(1);
  });

  it("should inject Font Awesome CDN when missing", () => {
    const html = makeFullHtml("<p>No icons</p>");
    const result = postProcessSlideHtml(html, defaultOptions);
    expect(result).toMatch(/fontawesome|font-awesome/i);
  });

  it("should inject overflow protection CSS", () => {
    const html = makeFullHtml("<div>Some content</div>");
    const result = postProcessSlideHtml(html, defaultOptions);
    expect(result).toContain(
      ".slide-container { overflow: hidden !important; }",
    );
  });

  it("should wrap body content in slide-container if missing", () => {
    const html = makeFullHtml("<p>No slide container here</p>");
    const result = postProcessSlideHtml(html, defaultOptions);
    expect(result).toContain("slide-container");
  });

  it("should not add a second slide-container when one already exists", () => {
    const html = makeFullHtml(
      '<div class="slide-container" style="width:1280px;height:720px;overflow:hidden;"><p>Content</p></div>',
    );
    const result = postProcessSlideHtml(html, defaultOptions);
    const containerCount = (result.match(/class="slide-container"/g) || [])
      .length;
    expect(containerCount).toBe(1);
  });

  it("should add page number to slide", () => {
    const html = makeFullHtml(
      '<div class="slide-container" style="width:1280px;height:720px;overflow:hidden;"><p>Content</p></div>',
    );
    const result = postProcessSlideHtml(html, {
      slideIndex: 2,
      totalSlides: 10,
    });
    expect(result).toContain("3 / 10");
  });

  it("should use correct page number from slideIndex", () => {
    const html = makeFullHtml(
      '<div class="slide-container" style=""><p>content</p></div>',
    );
    const result = postProcessSlideHtml(html, {
      slideIndex: 0,
      totalSlides: 8,
    });
    expect(result).toContain("1 / 8");
  });

  it("should handle HTML without head tag gracefully", () => {
    const html = '<div class="slide-container"><p>Just a div</p></div>';
    const result = postProcessSlideHtml(html, defaultOptions);
    expect(result).toContain("overflow: hidden");
  });

  it("should handle HTML with body but no head tag", () => {
    const html =
      '<body><div class="slide-container"><p>content</p></div></body>';
    const result = postProcessSlideHtml(html, defaultOptions);
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(html.length);
  });
});
