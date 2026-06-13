import { redactUserMessages } from "../pii-guardrail-redaction.helper";
import type { ChatMessage } from "../../types";

const EMAIL = "john.doe@example.com";

describe("redactUserMessages", () => {
  it("脱敏 user message 的 content 里的 PII", () => {
    const out = redactUserMessages([
      { role: "user", content: `联系 ${EMAIL}` } as ChatMessage,
    ]);
    expect(out[0].content).not.toContain(EMAIL);
  });

  it("L1: 脱敏多模态 contentParts 的文本块（图片块原样保留）", () => {
    const msg = {
      role: "user",
      content: "",
      contentParts: [
        { type: "text", text: `我的邮箱是 ${EMAIL}` },
        { type: "image_url", image_url: { url: "https://x/img.png" } },
      ],
    } as unknown as ChatMessage;

    const out = redactUserMessages([msg]);
    const parts = out[0].contentParts as Array<Record<string, unknown>>;
    // 文本块脱敏
    expect(parts[0].text).not.toContain(EMAIL);
    // 图片块不动
    expect((parts[1].image_url as { url: string }).url).toBe(
      "https://x/img.png",
    );
  });

  it("非 user 角色不脱敏（system/assistant 原样）", () => {
    const out = redactUserMessages([
      { role: "system", content: `key ${EMAIL}` } as ChatMessage,
    ]);
    expect(out[0].content).toContain(EMAIL);
  });
});
