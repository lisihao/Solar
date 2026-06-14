import {
  detectLocale,
  extractImageUrls,
  extractYoutubeVideoId,
  parseSections,
} from "../preparse.utils";

describe("preparse.utils", () => {
  describe("extractImageUrls", () => {
    it("extracts markdown ![alt](url) images", () => {
      const md =
        "Here is ![photo](https://example.com/a.jpg) and ![](https://example.com/b.png).";
      expect(extractImageUrls({ markdown: md })).toEqual([
        "https://example.com/a.jpg",
        "https://example.com/b.png",
      ]);
    });

    it("extracts <img src='...'> HTML tags", () => {
      const md = `<img src="https://example.com/c.gif" alt="x"> and <img alt="y" src='https://example.com/d.webp'>`;
      expect(extractImageUrls({ markdown: md })).toEqual([
        "https://example.com/c.gif",
        "https://example.com/d.webp",
      ]);
    });

    it("appends YouTube thumbnail when videoId provided", () => {
      const out = extractImageUrls({
        markdown: "",
        videoId: "dQw4w9WgXcQ",
      });
      expect(out).toContain(
        "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
      );
    });

    it("appends coverImageUrl + dedups", () => {
      const out = extractImageUrls({
        markdown: "![](https://x.com/cover.jpg)",
        coverImageUrl: "https://x.com/cover.jpg", // 同 URL
      });
      expect(out).toEqual(["https://x.com/cover.jpg"]);
    });

    it("rejects non-http(s) schemes (data:, blob:, javascript:)", () => {
      const md = `![evil](javascript:alert(1)) ![ok](https://safe.com/a.jpg) ![data](data:image/png;base64,xxx)`;
      expect(extractImageUrls({ markdown: md })).toEqual([
        "https://safe.com/a.jpg",
      ]);
    });

    it("handles empty / null markdown gracefully", () => {
      expect(extractImageUrls({})).toEqual([]);
      expect(extractImageUrls({ markdown: null })).toEqual([]);
    });
  });

  describe("extractYoutubeVideoId", () => {
    it("handles youtube.com/watch?v=", () => {
      expect(
        extractYoutubeVideoId(
          "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42",
        ),
      ).toBe("dQw4w9WgXcQ");
    });

    it("handles youtu.be short links", () => {
      expect(extractYoutubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe(
        "dQw4w9WgXcQ",
      );
    });

    it("handles youtube.com/shorts/", () => {
      expect(
        extractYoutubeVideoId("https://www.youtube.com/shorts/abcdefghijk"),
      ).toBe("abcdefghijk");
    });

    it("returns null for non-YouTube URLs", () => {
      expect(extractYoutubeVideoId("https://example.com")).toBeNull();
    });
  });

  describe("detectLocale", () => {
    it("detects Chinese text", () => {
      expect(detectLocale("人工智能正在改变世界，这是一段中文文本。")).toBe(
        "zh",
      );
    });

    it("detects English text", () => {
      expect(detectLocale("The quick brown fox jumps over the lazy dog.")).toBe(
        "en",
      );
    });

    it("mixed content with majority English defaults to en", () => {
      // 100 chars english + 5 chars chinese ≈ 5% CJK → en
      const text = "x".repeat(100) + "中文";
      expect(detectLocale(text)).toBe("en");
    });

    it("empty string defaults to en", () => {
      expect(detectLocale("")).toBe("en");
    });
  });

  describe("parseSections", () => {
    it("splits markdown by H2/H3 headings", () => {
      const md = `# Title (H1 ignored)

## Section One
Content of section one.
More content.

## Section Two
Content two.

### Subsection 2.1
Sub content.`;
      const sections = parseSections(md);
      expect(sections).toHaveLength(3);
      expect(sections[0].heading).toBe("Section One");
      expect(sections[0].level).toBe(2);
      expect(sections[0].content).toContain("Content of section one");
      expect(sections[1].heading).toBe("Section Two");
      expect(sections[2].heading).toBe("Subsection 2.1");
      expect(sections[2].level).toBe(3);
    });

    it("captures inline images per section", () => {
      const md = `## Visual
![diagram](https://x.com/d.png)
Some text.`;
      const sections = parseSections(md);
      expect(sections[0].images).toEqual(["https://x.com/d.png"]);
    });

    it("returns [] for empty input", () => {
      expect(parseSections("")).toEqual([]);
    });
  });
});
