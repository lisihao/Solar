/**
 * PII Redactor - 纯函数单元测试
 *
 * 证明 redactPII 真把 PII 替换为占位符，并保留 detections 元信息。
 */

import { redactPII } from "../input/pii-redactor";

describe("redactPII", () => {
  it("returns original text and empty detections when no PII", () => {
    const { redacted, detections } = redactPII("Hello, how are you today?");
    expect(redacted).toBe("Hello, how are you today?");
    expect(detections).toEqual([]);
  });

  it("redacts email with [EMAIL] placeholder", () => {
    const { redacted, detections } = redactPII(
      "Contact me at john.doe@example.com please",
    );
    expect(redacted).toBe("Contact me at [EMAIL] please");
    expect(redacted).not.toContain("john.doe@example.com");
    expect(detections).toContainEqual({
      type: "email",
      name: "Email Address",
      count: 1,
    });
  });

  it("redacts SSN with [SSN] placeholder", () => {
    const { redacted, detections } = redactPII("My SSN is 123-45-6789.");
    expect(redacted).toBe("My SSN is [SSN].");
    expect(redacted).not.toContain("123-45-6789");
    expect(detections).toContainEqual({
      type: "ssn",
      name: "Social Security Number",
      count: 1,
    });
  });

  it("redacts credit card with [CREDIT_CARD] placeholder", () => {
    const { redacted, detections } = redactPII("Card: 4111 1111 1111 1111");
    expect(redacted).toContain("[CREDIT_CARD]");
    expect(redacted).not.toContain("4111 1111 1111 1111");
    expect(detections.some((d) => d.type === "credit_card")).toBe(true);
  });

  it("redacts Chinese phone number with [PHONE] placeholder", () => {
    const { redacted, detections } = redactPII("打我电话 13812345678 谢谢");
    expect(redacted).toContain("[PHONE]");
    expect(redacted).not.toContain("13812345678");
    expect(detections.some((d) => d.type === "phone")).toBe(true);
  });

  it("redacts multiple PII types in one string", () => {
    const { redacted, detections } = redactPII(
      "Email a@b.com and SSN 111-22-3333",
    );
    expect(redacted).toContain("[EMAIL]");
    expect(redacted).toContain("[SSN]");
    expect(redacted).not.toContain("a@b.com");
    expect(redacted).not.toContain("111-22-3333");
    expect(detections.length).toBeGreaterThanOrEqual(2);
  });

  it("counts multiple occurrences of the same type", () => {
    const { detections } = redactPII("a@b.com and c@d.com");
    const email = detections.find((d) => d.type === "email");
    expect(email?.count).toBe(2);
  });

  it("ignores short alphabetic strings as api_key false positives", () => {
    const { redacted, detections } = redactPII("this is just plain english");
    expect(redacted).toBe("this is just plain english");
    expect(detections.some((d) => d.type === "api_key")).toBe(false);
  });

  it("redacts a long token as [API_KEY]", () => {
    const token = "sk_live_" + "a1B2c3D4".repeat(5); // length >= 32, mixed
    const { redacted, detections } = redactPII(`key=${token}`);
    expect(redacted).toContain("[API_KEY]");
    expect(redacted).not.toContain(token);
    expect(detections.some((d) => d.type === "api_key")).toBe(true);
  });

  it("is a pure function — does not mutate or carry regex state across calls", () => {
    const input = "a@b.com";
    const first = redactPII(input);
    const second = redactPII(input);
    expect(first).toEqual(second);
    expect(input).toBe("a@b.com");
  });

  it("handles empty string safely", () => {
    expect(redactPII("")).toEqual({ redacted: "", detections: [] });
  });
});
