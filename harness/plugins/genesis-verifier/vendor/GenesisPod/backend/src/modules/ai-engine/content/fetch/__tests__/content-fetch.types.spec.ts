import { stripScrapedArtifacts } from "../content-fetch.types";

describe("stripScrapedArtifacts", () => {
  it("removes React Server Component / Next.js streaming flight markers", () => {
    // The exact shape that leaked into a rendered Explore article (Screenshot_28)
    const scraped =
      '<!--$--><!--$--><!--/$--><!--/$--><!--$--><!--/$-->' +
      '<div id="page-content"><!--$--><template id="B:0"></template><!--/$--></div>' +
      "Real article body text.";
    const out = stripScrapedArtifacts(scraped);
    expect(out).not.toContain("<!--$-->");
    expect(out).not.toContain("<!--/$-->");
    expect(out).not.toContain('<template id="B:0">');
    expect(out).toContain("Real article body text.");
  });

  it("removes <style> blocks with leaked CSS custom properties", () => {
    const scraped =
      "<style>--root { --bgprogress-color: hsl(var(--primary)); --bgprogress-height: 2px; }</style>Body.";
    const out = stripScrapedArtifacts(scraped);
    expect(out).not.toContain("--bgprogress-color");
    expect(out).toContain("Body.");
  });

  it("removes script/template/noscript blocks", () => {
    const out = stripScrapedArtifacts(
      "<script>evil()</script><noscript>x</noscript><template>y</template>Keep.",
    );
    expect(out).toBe("Keep.");
  });

  it("preserves legitimate inline markdown/HTML (no blanket tag strip)", () => {
    const md = "See [the paper](https://arxiv.org/abs/2605.21602) and **bold**.";
    expect(stripScrapedArtifacts(md)).toBe(md);
  });

  it("handles empty / nullish input", () => {
    expect(stripScrapedArtifacts("")).toBe("");
    expect(stripScrapedArtifacts(null)).toBe("");
    expect(stripScrapedArtifacts(undefined)).toBe("");
  });
});
