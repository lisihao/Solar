import { assertSafeHttpUrl } from "../ssrf-util";

describe("radar/collectors/ssrf-util", () => {
  describe("rejects non-http(s)", () => {
    it("file://", () => {
      expect(() => assertSafeHttpUrl("file:///etc/passwd")).toThrow(
        /必须是 http/,
      );
    });
    it("ftp://", () => {
      expect(() => assertSafeHttpUrl("ftp://example.com")).toThrow(
        /必须是 http/,
      );
    });
  });

  describe("rejects private IPs", () => {
    it("127.0.0.1", () => {
      expect(() => assertSafeHttpUrl("http://127.0.0.1/x")).toThrow(/内网/);
    });
    it("localhost", () => {
      expect(() => assertSafeHttpUrl("http://localhost:3000/")).toThrow(/内网/);
    });
    it("10.x", () => {
      expect(() => assertSafeHttpUrl("http://10.0.0.1/")).toThrow(/内网/);
    });
    it("192.168.x", () => {
      expect(() => assertSafeHttpUrl("http://192.168.1.1/")).toThrow(/内网/);
    });
    it("169.254.x (link-local)", () => {
      expect(() => assertSafeHttpUrl("http://169.254.169.254/")).toThrow(
        /内网/,
      );
    });
    it("172.16-172.31", () => {
      expect(() => assertSafeHttpUrl("http://172.16.0.1/")).toThrow(/内网/);
      expect(() => assertSafeHttpUrl("http://172.31.255.254/")).toThrow(/内网/);
    });
  });

  describe("accepts public hosts", () => {
    it("https://www.youtube.com", () => {
      expect(() =>
        assertSafeHttpUrl(
          "https://www.youtube.com/feeds/videos.xml?channel_id=UCabc",
        ),
      ).not.toThrow();
    });
    it("http://example.com", () => {
      expect(() =>
        assertSafeHttpUrl("http://example.com/feed.rss"),
      ).not.toThrow();
    });
  });

  it("rejects malformed URL", () => {
    expect(() => assertSafeHttpUrl("not a url")).toThrow(/非法 URL/);
  });

  it("rejects 172.17 inside 172.16-31 range", () => {
    // 边界：172.17 是私有，但 172.32 不是（不在 16-31 范围内）
    expect(() => assertSafeHttpUrl("http://172.17.0.1/")).toThrow(/内网/);
    // 172.32 不在私有范围，应该 pass
    expect(() => assertSafeHttpUrl("http://172.32.0.1/")).not.toThrow();
  });
});
