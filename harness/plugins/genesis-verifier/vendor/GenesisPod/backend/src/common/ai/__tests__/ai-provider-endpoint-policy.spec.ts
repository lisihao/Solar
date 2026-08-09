import { BadRequestException } from "@nestjs/common";
import { assertAllowedAiProviderEndpoint } from "../ai-provider-endpoint-policy";

describe("assertAllowedAiProviderEndpoint", () => {
  it.each([
    "http://thunderomlx.local/v1",
    "https://api.OMLX.example/v1/chat/completions",
    "http://127.0.0.1:8002/v1",
    "http://[::1]:8002/v1/models",
    "http://127.0.0.1:8003/v1",
  ])("rejects forbidden GenesisPod AI endpoint %s", (endpoint) => {
    expect(() => assertAllowedAiProviderEndpoint(endpoint)).toThrow(
      BadRequestException,
    );
  });

  it.each([
    "https://api.openai.com/v1",
    "https://api.x.ai/v1/chat/completions",
    "http://127.0.0.1:5050/v1",
    "https://example.com/path/omlx/status",
    "http://localhost:18002/v1",
  ])("allows non-forbidden endpoint %s", (endpoint) => {
    expect(() => assertAllowedAiProviderEndpoint(endpoint)).not.toThrow();
  });

  it.each(["not-a-url", "ftp://api.openai.com/v1"])(
    "fails closed for invalid provider endpoint %s",
    (endpoint) => {
      expect(() => assertAllowedAiProviderEndpoint(endpoint)).toThrow(
        BadRequestException,
      );
    },
  );

  it("allows an omitted optional endpoint", () => {
    expect(() => assertAllowedAiProviderEndpoint(undefined)).not.toThrow();
    expect(() => assertAllowedAiProviderEndpoint(null)).not.toThrow();
    expect(() => assertAllowedAiProviderEndpoint("  ")).not.toThrow();
  });
});
