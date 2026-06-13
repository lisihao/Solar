import {
  ensureChatCompletionsPath,
  ensureMessagesPath,
  ensureCohereChatPath,
  ensureOpenAIEmbeddingsPath,
  ensureCohereEmbedPath,
  ensureOpenAIImagesGenerationsPath,
} from "../endpoint.utils";

/**
 * ★ 2026-06-02：用户把"获取模型列表"的端点（.../v1/models）误填成 API Endpoint base，
 * 下游各 ensure*Path 必须剥掉 /models 再拼正确路径，否则拼出 .../v1/models/chat/completions
 * → 404（连接测试 + 真实聊天都会挂）。
 */
describe("endpoint.utils — tolerate a mis-pasted /models base", () => {
  it("chat: strips trailing /models before appending /chat/completions", () => {
    expect(ensureChatCompletionsPath("https://api.tokenmix.ai/v1/models")).toBe(
      "https://api.tokenmix.ai/v1/chat/completions",
    );
    // base 正常 + 已是完整路径仍正确
    expect(ensureChatCompletionsPath("https://api.tokenmix.ai/v1")).toBe(
      "https://api.tokenmix.ai/v1/chat/completions",
    );
    expect(
      ensureChatCompletionsPath("https://api.tokenmix.ai/v1/chat/completions"),
    ).toBe("https://api.tokenmix.ai/v1/chat/completions");
  });

  it("anthropic messages: strips trailing /models", () => {
    expect(ensureMessagesPath("https://x.ai/v1/models")).toBe(
      "https://x.ai/v1/messages",
    );
  });

  it("cohere chat: strips trailing /models", () => {
    expect(ensureCohereChatPath("https://api.cohere.com/v2/models")).toBe(
      "https://api.cohere.com/v2/chat",
    );
  });

  it("cohere chat: H2 — normalizes legacy /v1/chat to /v2/chat", () => {
    expect(ensureCohereChatPath("https://api.cohere.com/v1/chat")).toBe(
      "https://api.cohere.com/v2/chat",
    );
  });

  it("cohere chat: H2 — normalizes bare /v1 to /v2/chat", () => {
    expect(ensureCohereChatPath("https://api.cohere.com/v1")).toBe(
      "https://api.cohere.com/v2/chat",
    );
  });

  it("openai embeddings: strips trailing /models", () => {
    expect(
      ensureOpenAIEmbeddingsPath("https://api.tokenmix.ai/v1/models"),
    ).toBe("https://api.tokenmix.ai/v1/embeddings");
  });

  it("cohere embed: strips trailing /models", () => {
    expect(ensureCohereEmbedPath("https://api.cohere.com/v1/models")).toBe(
      "https://api.cohere.com/v1/embed",
    );
  });

  it("openai images: strips trailing /models", () => {
    expect(
      ensureOpenAIImagesGenerationsPath("https://api.openai.com/v1/models"),
    ).toBe("https://api.openai.com/v1/images/generations");
  });

  it("returns null for empty input (unchanged contract)", () => {
    expect(ensureChatCompletionsPath("")).toBeNull();
    expect(ensureChatCompletionsPath(undefined)).toBeNull();
  });
});
