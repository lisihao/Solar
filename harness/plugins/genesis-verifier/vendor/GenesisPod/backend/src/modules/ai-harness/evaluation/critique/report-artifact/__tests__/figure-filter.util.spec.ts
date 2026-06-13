import {
  isGarbageFigureUrl,
  dedupeFigureCandidates,
} from "../figure-filter.utils";

describe("isGarbageFigureUrl", () => {
  it("returns true for undefined", () => {
    expect(isGarbageFigureUrl(undefined)).toBe(true);
  });

  it("returns true for empty string", () => {
    expect(isGarbageFigureUrl("")).toBe(true);
  });

  it("returns true for whitespace-only string", () => {
    expect(isGarbageFigureUrl("   ")).toBe(true);
  });

  it("returns true for URL longer than 2048 chars (non data:)", () => {
    const longUrl = "https://example.com/img?" + "a".repeat(2050);
    expect(isGarbageFigureUrl(longUrl)).toBe(true);
  });

  it("allows data:image/ URIs regardless of length", () => {
    const dataUri = "data:image/png;base64," + "A".repeat(3000);
    expect(isGarbageFigureUrl(dataUri)).toBe(false);
  });

  it("rejects other data: URIs (non-image)", () => {
    expect(isGarbageFigureUrl("data:text/html,<h1>hello</h1>")).toBe(true);
  });

  it("returns true for invalid URL", () => {
    expect(isGarbageFigureUrl("not a url at all")).toBe(true);
  });

  it("returns true for unsplash.com URLs", () => {
    expect(isGarbageFigureUrl("https://unsplash.com/photos/abc123")).toBe(true);
  });

  it("returns true for pexels.com URLs", () => {
    expect(isGarbageFigureUrl("https://pexels.com/photo/sky-123")).toBe(true);
  });

  it("returns true for shutterstock.com URLs", () => {
    expect(
      isGarbageFigureUrl("https://shutterstock.com/image-photo/test"),
    ).toBe(true);
  });

  it("returns true for istockphoto.com URLs", () => {
    expect(isGarbageFigureUrl("https://istockphoto.com/photo/test-gm123")).toBe(
      true,
    );
  });

  it("returns true for gettyimages.com URLs", () => {
    expect(
      isGarbageFigureUrl("https://gettyimages.com/detail/photo/test"),
    ).toBe(true);
  });

  it("returns true for pixabay.com URLs", () => {
    expect(isGarbageFigureUrl("https://pixabay.com/illustrations/test")).toBe(
      true,
    );
  });

  it("returns true for depositphotos.com URLs", () => {
    expect(
      isGarbageFigureUrl("https://depositphotos.com/photo/test.html"),
    ).toBe(true);
  });

  it("returns true for alamy.com URLs", () => {
    expect(isGarbageFigureUrl("https://alamy.com/stock-photo/test")).toBe(true);
  });

  it("returns true for freepik.com URLs", () => {
    expect(isGarbageFigureUrl("https://freepik.com/free-photo/test")).toBe(
      true,
    );
  });

  it("returns true for www. prefixed garbage hosts", () => {
    expect(isGarbageFigureUrl("https://www.unsplash.com/photos/abc")).toBe(
      true,
    );
  });

  it("returns true for paths containing /qr/", () => {
    expect(isGarbageFigureUrl("https://example.com/qr/code.png")).toBe(true);
  });

  it("returns true for paths containing /favicon", () => {
    expect(isGarbageFigureUrl("https://example.com/favicon.ico")).toBe(true);
  });

  it("returns true for paths containing /icon-", () => {
    expect(isGarbageFigureUrl("https://example.com/icon-32.png")).toBe(true);
  });

  it("returns true for paths containing /logo-", () => {
    expect(isGarbageFigureUrl("https://example.com/logo-white.svg")).toBe(true);
  });

  it("returns true for paths containing /badge-", () => {
    expect(isGarbageFigureUrl("https://example.com/badge-npm.svg")).toBe(true);
  });

  it("returns true for paths containing /avatar/", () => {
    expect(isGarbageFigureUrl("https://example.com/avatar/user.png")).toBe(
      true,
    );
  });

  it("returns true for paths containing /sprite", () => {
    expect(isGarbageFigureUrl("https://example.com/sprite.png")).toBe(true);
  });

  it("returns true for paths containing /tracking-pixel", () => {
    expect(isGarbageFigureUrl("https://example.com/tracking-pixel.gif")).toBe(
      true,
    );
  });

  it("returns true for paths containing /pixel.gif", () => {
    expect(isGarbageFigureUrl("https://example.com/path/pixel.gif")).toBe(true);
  });

  it("returns true for paths containing /spacer", () => {
    expect(isGarbageFigureUrl("https://example.com/spacer.gif")).toBe(true);
  });

  it("returns true for filename favicon.ico", () => {
    expect(isGarbageFigureUrl("https://example.com/favicon.ico")).toBe(true);
  });

  it("returns true for filename favicon.png", () => {
    expect(isGarbageFigureUrl("https://example.com/assets/favicon.png")).toBe(
      true,
    );
  });

  it("returns true for filename logo.png", () => {
    expect(isGarbageFigureUrl("https://example.com/images/logo.png")).toBe(
      true,
    );
  });

  it("returns true for filename logo.svg", () => {
    expect(isGarbageFigureUrl("https://example.com/img/logo.svg")).toBe(true);
  });

  it("returns true for filename 1x1.gif", () => {
    expect(isGarbageFigureUrl("https://example.com/assets/1x1.gif")).toBe(true);
  });

  it("returns true for filename spacer.gif", () => {
    expect(isGarbageFigureUrl("https://example.com/assets/spacer.gif")).toBe(
      true,
    );
  });

  it("returns true for filename blank.gif", () => {
    expect(isGarbageFigureUrl("https://example.com/assets/blank.gif")).toBe(
      true,
    );
  });

  it("returns false for normal chart/diagram URL", () => {
    expect(
      isGarbageFigureUrl("https://example.com/charts/revenue-q1-2024.png"),
    ).toBe(false);
  });

  it("returns false for academic figure URL", () => {
    expect(isGarbageFigureUrl("https://nature.com/articles/figure1.jpg")).toBe(
      false,
    );
  });

  it("returns false for Wikipedia image", () => {
    expect(
      isGarbageFigureUrl(
        "https://upload.wikimedia.org/wikipedia/commons/thumb/abc.png",
      ),
    ).toBe(false);
  });
});

describe("dedupeFigureCandidates", () => {
  const base = {
    sourceUrl: "https://example.com",
    caption: "some caption",
  };

  it("returns empty array for empty input", () => {
    expect(dedupeFigureCandidates([])).toEqual([]);
  });

  it("deduplicates by imageUrl, keeping higher relevance", () => {
    const figs = [
      {
        ...base,
        imageUrl: "https://img.com/a.png",
        relevanceHint: "low" as const,
      },
      {
        ...base,
        imageUrl: "https://img.com/a.png",
        relevanceHint: "high" as const,
      },
    ];
    const result = dedupeFigureCandidates(figs);
    expect(result).toHaveLength(1);
    expect(result[0].relevanceHint).toBe("high");
  });

  it("deduplicates by sourceUrl+caption when no imageUrl", () => {
    const figs = [
      {
        sourceUrl: "https://example.com",
        caption: "Chart A",
        relevanceHint: "medium" as const,
      },
      {
        sourceUrl: "https://example.com",
        caption: "Chart A",
        relevanceHint: "low" as const,
      },
    ];
    const result = dedupeFigureCandidates(figs);
    expect(result).toHaveLength(1);
    expect(result[0].relevanceHint).toBe("medium");
  });

  it("keeps distinct images with different imageUrls", () => {
    const figs = [
      {
        ...base,
        imageUrl: "https://img.com/a.png",
        relevanceHint: "high" as const,
      },
      {
        ...base,
        imageUrl: "https://img.com/b.png",
        relevanceHint: "medium" as const,
      },
    ];
    const result = dedupeFigureCandidates(figs);
    expect(result).toHaveLength(2);
  });

  it("medium relevance beats low", () => {
    const figs = [
      {
        ...base,
        imageUrl: "https://img.com/c.png",
        relevanceHint: "low" as const,
      },
      {
        ...base,
        imageUrl: "https://img.com/c.png",
        relevanceHint: "medium" as const,
      },
    ];
    const result = dedupeFigureCandidates(figs);
    expect(result[0].relevanceHint).toBe("medium");
  });

  it("does not replace existing with equal score", () => {
    const figs = [
      {
        ...base,
        imageUrl: "https://img.com/d.png",
        caption: "first",
        relevanceHint: "high" as const,
      },
      {
        ...base,
        imageUrl: "https://img.com/d.png",
        caption: "second",
        relevanceHint: "high" as const,
      },
    ];
    const result = dedupeFigureCandidates(figs);
    expect(result).toHaveLength(1);
    expect(result[0].caption).toBe("first");
  });

  it("treats undefined relevanceHint as low", () => {
    const figs = [
      { ...base, imageUrl: "https://img.com/e.png" },
      {
        ...base,
        imageUrl: "https://img.com/e.png",
        relevanceHint: "medium" as const,
      },
    ];
    const result = dedupeFigureCandidates(figs);
    expect(result[0].relevanceHint).toBe("medium");
  });
});
