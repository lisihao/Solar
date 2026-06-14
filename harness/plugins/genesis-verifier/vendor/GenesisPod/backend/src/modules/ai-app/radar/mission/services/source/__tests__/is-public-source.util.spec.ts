import { isPublicSource } from "../is-public-source.util";

describe("isPublicSource", () => {
  it("returns true for X sources (public accounts)", () => {
    expect(isPublicSource({ type: "X", identifier: "@elonmusk" })).toBe(true);
  });

  it("returns true for YOUTUBE sources (public channels)", () => {
    expect(
      isPublicSource({
        type: "YOUTUBE",
        identifier: "UCBcRF18a7Qf58cCRy5xuWwQ",
      }),
    ).toBe(true);
  });

  it("returns false for RSS with basic-auth credentials in URL", () => {
    expect(
      isPublicSource({
        type: "RSS",
        identifier: "https://user:pass@example.com/feed.xml",
      }),
    ).toBe(false);
  });

  it("returns false for RSS pointing to localhost (private network)", () => {
    expect(
      isPublicSource({
        type: "RSS",
        identifier: "http://localhost:8080/feed.xml",
      }),
    ).toBe(false);
  });

  it("returns false for RSS with Authorization header in config", () => {
    expect(
      isPublicSource({
        type: "RSS",
        identifier: "https://example.com/feed.xml",
        config: { headers: { Authorization: "Bearer secret-token" } },
      }),
    ).toBe(false);
  });

  it("returns false for RSS with apiKey in config", () => {
    expect(
      isPublicSource({
        type: "RSS",
        identifier: "https://example.com/feed.xml",
        config: { apiKey: "my-secret-key" },
      }),
    ).toBe(false);
  });

  it("returns true for a public RSS URL with no auth", () => {
    expect(
      isPublicSource({
        type: "RSS",
        identifier: "https://feeds.arstechnica.com/arstechnica/index",
      }),
    ).toBe(true);
  });
});
