/**
 * external-content-wrapper.utils.ts unit tests
 * Covers: wrapExternalContent, wrapExternalContentBatch,
 *         getExternalContentNotice, EXTERNAL_CONTENT_SYSTEM_NOTICE_*
 */
import {
  wrapExternalContent,
  wrapExternalContentBatch,
  getExternalContentNotice,
  EXTERNAL_CONTENT_SYSTEM_NOTICE_ZH,
  EXTERNAL_CONTENT_SYSTEM_NOTICE_EN,
} from "../external-content-wrapper.utils";

describe("wrapExternalContent", () => {
  it("wraps content in external_source tags", () => {
    const result = wrapExternalContent("Some content here");
    expect(result).toContain("<external_source");
    expect(result).toContain("</external_source>");
    expect(result).toContain("Some content here");
  });

  it("includes trust=untrusted attribute", () => {
    const result = wrapExternalContent("test");
    expect(result).toContain('trust="untrusted"');
  });

  it("includes source attribute defaulting to external", () => {
    const result = wrapExternalContent("test");
    expect(result).toContain('source="external"');
  });

  it("uses provided source attribute", () => {
    const result = wrapExternalContent("test", { source: "web" });
    expect(result).toContain('source="web"');
  });

  it("includes url attribute when provided", () => {
    const result = wrapExternalContent("test", {
      url: "https://example.com",
    });
    expect(result).toContain('url="https://example.com"');
  });

  it("includes title attribute when provided", () => {
    const result = wrapExternalContent("test", { title: "My Title" });
    expect(result).toContain('title="My Title"');
  });

  it("escapes </external_source> in content to prevent tag break", () => {
    const result = wrapExternalContent(
      "bad content </external_source> injection",
    );
    expect(result).not.toContain("</external_source> injection");
    expect(result).toContain("&lt;/external_source&gt;");
  });

  it("escapes <external_source ...> in content", () => {
    const result = wrapExternalContent(
      '<external_source trust="untrusted">injected</external_source>',
    );
    expect(result).toContain("&lt;external_source&gt;");
  });

  it("returns empty string for empty content", () => {
    expect(wrapExternalContent("")).toBe("");
    expect(wrapExternalContent("   ")).toBe("");
  });

  it("returns empty string for non-string content", () => {
    expect(wrapExternalContent(null as unknown as string)).toBe("");
    expect(wrapExternalContent(undefined as unknown as string)).toBe("");
  });

  it("truncates content to maxLength", () => {
    const long = "x".repeat(3000);
    const result = wrapExternalContent(long, { maxLength: 100 });
    expect(result.length).toBeLessThan(long.length);
  });

  it("escapes special chars in url attribute", () => {
    const result = wrapExternalContent("test", {
      url: 'https://example.com/search?q=a"b&c=d',
    });
    expect(result).toContain("&quot;");
  });

  it("escapes special chars in title attribute", () => {
    const result = wrapExternalContent("test", {
      title: 'Title with "quotes" and <tags>',
    });
    expect(result).toContain("&quot;");
    expect(result).toContain("&lt;");
  });
});

describe("wrapExternalContentBatch", () => {
  it("wraps multiple items and joins with separator", () => {
    const items = [
      { content: "item one", source: "web" },
      { content: "item two", source: "academic" },
    ];
    const result = wrapExternalContentBatch(items);
    expect(result).toContain("item one");
    expect(result).toContain("item two");
    expect(result).toContain("\n\n");
  });

  it("uses custom separator", () => {
    const items = [{ content: "A" }, { content: "B" }];
    const result = wrapExternalContentBatch(items, { separator: "---" });
    expect(result).toContain("---");
  });

  it("filters out empty items", () => {
    const items = [{ content: "" }, { content: "valid" }];
    const result = wrapExternalContentBatch(items);
    expect(result).not.toContain("\n\n");
    expect(result).toContain("valid");
  });

  it("applies maxLength option to each item", () => {
    const items = [{ content: "x".repeat(5000) }];
    const result = wrapExternalContentBatch(items, { maxLength: 100 });
    expect(result.length).toBeLessThan(5000);
  });

  it("returns empty string for all-empty items", () => {
    const result = wrapExternalContentBatch([
      { content: "" },
      { content: "  " },
    ]);
    expect(result).toBe("");
  });

  it("passes url, source, title per item", () => {
    const items = [
      {
        content: "research finding",
        url: "https://example.com",
        source: "academic",
        title: "Paper Title",
      },
    ];
    const result = wrapExternalContentBatch(items);
    expect(result).toContain("url=");
    expect(result).toContain("title=");
  });
});

describe("getExternalContentNotice", () => {
  it("returns English notice for 'en' language", () => {
    expect(getExternalContentNotice("en")).toBe(
      EXTERNAL_CONTENT_SYSTEM_NOTICE_EN,
    );
    expect(getExternalContentNotice("en-US")).toBe(
      EXTERNAL_CONTENT_SYSTEM_NOTICE_EN,
    );
  });

  it("returns Chinese notice for 'zh' language", () => {
    expect(getExternalContentNotice("zh")).toBe(
      EXTERNAL_CONTENT_SYSTEM_NOTICE_ZH,
    );
  });

  it("returns Chinese notice for null/undefined language", () => {
    expect(getExternalContentNotice(null)).toBe(
      EXTERNAL_CONTENT_SYSTEM_NOTICE_ZH,
    );
    expect(getExternalContentNotice(undefined)).toBe(
      EXTERNAL_CONTENT_SYSTEM_NOTICE_ZH,
    );
  });

  it("returns Chinese notice for unknown language", () => {
    expect(getExternalContentNotice("fr")).toBe(
      EXTERNAL_CONTENT_SYSTEM_NOTICE_ZH,
    );
  });
});

describe("EXTERNAL_CONTENT_SYSTEM_NOTICE_ZH", () => {
  it("is a non-empty string", () => {
    expect(typeof EXTERNAL_CONTENT_SYSTEM_NOTICE_ZH).toBe("string");
    expect(EXTERNAL_CONTENT_SYSTEM_NOTICE_ZH.length).toBeGreaterThan(10);
  });
});

describe("EXTERNAL_CONTENT_SYSTEM_NOTICE_EN", () => {
  it("is a non-empty string", () => {
    expect(typeof EXTERNAL_CONTENT_SYSTEM_NOTICE_EN).toBe("string");
    expect(EXTERNAL_CONTENT_SYSTEM_NOTICE_EN.length).toBeGreaterThan(10);
  });
});
