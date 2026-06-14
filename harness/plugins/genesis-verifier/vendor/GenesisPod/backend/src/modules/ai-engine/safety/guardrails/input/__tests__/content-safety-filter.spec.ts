/**
 * Tests for ContentSafetyFilter
 */

import { ContentSafetyFilter } from "../content-safety-filter";

describe("ContentSafetyFilter", () => {
  let filter: ContentSafetyFilter;

  beforeEach(() => {
    filter = new ContentSafetyFilter();
  });

  describe("identity properties", () => {
    it("has correct id", () => {
      expect(filter.id).toBe("content-safety-filter");
    });

    it("has correct name", () => {
      expect(filter.name).toBe("Content Safety Filter");
    });

    it("is enabled by default", () => {
      expect(filter.enabled).toBe(true);
    });
  });

  describe("always passes (never blocks)", () => {
    it("always returns passed: true even when PII is detected", async () => {
      const result = await filter.check({
        content: "my email is test@example.com",
      });
      expect(result.passed).toBe(true);
    });

    it("always returns passed: true for clean input", async () => {
      const result = await filter.check({
        content: "Hello, what is the weather today?",
      });
      expect(result.passed).toBe(true);
    });
  });

  describe("email detection", () => {
    it("detects a standard email address", async () => {
      const result = await filter.check({
        content: "Contact me at user@example.com for details",
      });
      expect(result.passed).toBe(true);
      expect(result.severity).toBe("warning");
      const detections = result.metadata?.detections as Array<{
        type: string;
      }>;
      expect(detections.some((d) => d.type === "email")).toBe(true);
    });

    it("detects email with subdomain", async () => {
      const result = await filter.check({
        content: "Send to admin@mail.company.org",
      });
      expect(result.severity).toBe("warning");
    });

    it("detects multiple emails", async () => {
      const result = await filter.check({
        content: "Email alice@example.com and bob@example.org",
      });
      expect(result.severity).toBe("warning");
      const detections = result.metadata?.detections as Array<{
        type: string;
        count: number;
      }>;
      const emailDetection = detections.find((d) => d.type === "email");
      expect(emailDetection?.count).toBe(2);
    });
  });

  describe("phone number detection", () => {
    it("detects Chinese mobile number (11 digits starting with 1)", async () => {
      const result = await filter.check({
        content: "Call me at 13812345678",
      });
      expect(result.severity).toBe("warning");
      const detections = result.metadata?.detections as Array<{
        type: string;
      }>;
      expect(detections.some((d) => d.type === "phone")).toBe(true);
    });

    it("detects US phone number format", async () => {
      const result = await filter.check({
        content: "Call me at (555) 123-4567",
      });
      expect(result.severity).toBe("warning");
      const detections = result.metadata?.detections as Array<{
        type: string;
      }>;
      expect(detections.some((d) => d.type === "phone")).toBe(true);
    });
  });

  describe("credit card detection", () => {
    it("detects credit card number with spaces", async () => {
      const result = await filter.check({
        content: "Card number: 4111 1111 1111 1111",
      });
      expect(result.severity).toBe("warning");
      const detections = result.metadata?.detections as Array<{
        type: string;
      }>;
      expect(detections.some((d) => d.type === "credit_card")).toBe(true);
    });

    it("detects credit card number with dashes", async () => {
      const result = await filter.check({
        content: "Card: 5500-0000-0000-0004",
      });
      expect(result.severity).toBe("warning");
    });

    it("detects credit card number without separators", async () => {
      const result = await filter.check({
        content: "Card: 4111111111111111",
      });
      expect(result.severity).toBe("warning");
    });
  });

  describe("SSN detection", () => {
    it("detects US Social Security Number", async () => {
      const result = await filter.check({
        content: "My SSN is 123-45-6789",
      });
      expect(result.severity).toBe("warning");
      const detections = result.metadata?.detections as Array<{
        type: string;
      }>;
      expect(detections.some((d) => d.type === "ssn")).toBe(true);
    });
  });

  describe("Chinese ID card detection", () => {
    it("detects 18-digit Chinese ID card number", async () => {
      const result = await filter.check({
        content: "ID: 110101199003077515",
      });
      expect(result.severity).toBe("warning");
      const detections = result.metadata?.detections as Array<{
        type: string;
      }>;
      expect(detections.some((d) => d.type === "id_card")).toBe(true);
    });

    it("detects Chinese ID card with X suffix", async () => {
      const result = await filter.check({
        content: "ID number: 11010119900307751X",
      });
      expect(result.severity).toBe("warning");
    });
  });

  describe("IP address detection", () => {
    it("detects IPv4 address", async () => {
      const result = await filter.check({
        content: "Server IP is 192.168.1.100",
      });
      expect(result.severity).toBe("warning");
      const detections = result.metadata?.detections as Array<{
        type: string;
      }>;
      expect(detections.some((d) => d.type === "ip_address")).toBe(true);
    });

    it("detects public IP address", async () => {
      const result = await filter.check({
        content: "Connect to 203.0.113.42",
      });
      expect(result.severity).toBe("warning");
    });
  });

  describe("API key detection", () => {
    it("detects potential API key (32+ alphanumeric chars with non-alpha)", async () => {
      const result = await filter.check({
        content: "API key: sk-proj-1234567890abcdefghijklmnopqr1234",
      });
      expect(result.severity).toBe("warning");
      const detections = result.metadata?.detections as Array<{
        type: string;
      }>;
      expect(detections.some((d) => d.type === "api_key")).toBe(true);
    });

    it("does not flag short keys as API keys", async () => {
      const result = await filter.check({
        content: "key: abc123short",
      });
      const detections = result.metadata?.detections as
        | Array<{ type: string }>
        | undefined;
      if (detections) {
        expect(detections.some((d) => d.type === "api_key")).toBe(false);
      }
      // short key should not trigger api_key detection
    });

    it("does not flag all-alphabetic strings as API keys even if long", async () => {
      const result = await filter.check({
        content: "word: abcdefghijklmnopqrstuvwxyzabcdefgh",
      });
      // all-alpha strings are filtered as false positives
      const detections = result.metadata?.detections as
        | Array<{ type: string }>
        | undefined;
      if (detections) {
        expect(detections.some((d) => d.type === "api_key")).toBe(false);
      }
    });
  });

  describe("clean input", () => {
    it("returns severity: info for clean text", async () => {
      const result = await filter.check({
        content: "What is the best way to learn programming?",
      });
      expect(result.passed).toBe(true);
      expect(result.severity).toBe("info");
      expect(result.guardrailId).toBe("content-safety-filter");
    });

    it("returns severity: info for empty input", async () => {
      const result = await filter.check({ content: "" });
      expect(result.passed).toBe(true);
      expect(result.severity).toBe("info");
    });

    it("does not include metadata.detections for clean input", async () => {
      const result = await filter.check({ content: "Hello world" });
      expect(result.metadata).toBeUndefined();
    });
  });

  describe("multiple PII types", () => {
    it("detects multiple PII types in one input", async () => {
      const result = await filter.check({
        content: "Email: user@example.com, SSN: 123-45-6789, IP: 10.0.0.1",
      });
      expect(result.severity).toBe("warning");
      const detections = result.metadata?.detections as Array<{
        type: string;
      }>;
      expect(detections.length).toBeGreaterThanOrEqual(3);
    });

    it("metadata.totalCount reflects total PII instances", async () => {
      const result = await filter.check({
        content:
          "Emails: alice@example.com and bob@example.org, SSN: 987-65-4321",
      });
      expect(result.metadata?.totalCount).toBeGreaterThanOrEqual(3);
    });

    it("metadata.detections includes name and count for each type", async () => {
      const result = await filter.check({
        content: "Email alice@example.com",
      });
      const detections = result.metadata?.detections as Array<{
        type: string;
        name: string;
        count: number;
      }>;
      const emailDetection = detections?.find((d) => d.type === "email");
      expect(emailDetection?.name).toBeDefined();
      expect(emailDetection?.count).toBeGreaterThan(0);
    });
  });

  describe("result structure", () => {
    it("always includes guardrailId", async () => {
      const result = await filter.check({ content: "test content" });
      expect(result.guardrailId).toBe("content-safety-filter");
    });

    it("includes message when PII detected", async () => {
      const result = await filter.check({
        content: "test@example.com",
      });
      expect(result.message).toBeDefined();
      expect(typeof result.message).toBe("string");
    });

    it("includes message when no PII detected", async () => {
      const result = await filter.check({ content: "Hello" });
      expect(result.message).toBeDefined();
    });
  });
});
