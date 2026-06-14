import { Logger } from "@nestjs/common";
import { extractJsonFromResponse } from "../extract-json.utils";

// Mock the json extraction utility
jest.mock("@/common/utils/json-extraction.utils", () => ({
  extractJsonFromAIResponse: jest.fn(),
}));

import { extractJsonFromAIResponse } from "@/common/utils/json-extraction.utils";

describe("extractJsonFromResponse", () => {
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    } as unknown as Logger;
    jest.clearAllMocks();
  });

  it("should return null for empty string", () => {
    const result = extractJsonFromResponse("", mockLogger);
    expect(result).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Empty response"),
    );
  });

  it("should return null for whitespace-only string", () => {
    const result = extractJsonFromResponse("   ", mockLogger);
    expect(result).toBeNull();
  });

  it("should return extracted data when extraction succeeds", () => {
    const mockData = { key: "value" };
    (extractJsonFromAIResponse as jest.Mock).mockReturnValue({
      success: true,
      data: mockData,
      method: "direct",
    });

    const result = extractJsonFromResponse<{ key: string }>(
      '{"key":"value"}',
      mockLogger,
    );
    expect(result).toEqual(mockData);
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("direct"),
    );
  });

  it("should return null and log error when extraction fails", () => {
    (extractJsonFromAIResponse as jest.Mock).mockReturnValue({
      success: false,
      data: null,
      error: "Parse error",
    });

    const result = extractJsonFromResponse("invalid json text", mockLogger);
    expect(result).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("Could not extract JSON"),
    );
  });

  it("should log direct parse error for invalid JSON", () => {
    (extractJsonFromAIResponse as jest.Mock).mockReturnValue({
      success: false,
      data: null,
    });

    const result = extractJsonFromResponse("not valid json at all", mockLogger);
    expect(result).toBeNull();
    // Should have attempted direct JSON.parse and logged the error
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Direct JSON.parse error"),
    );
  });

  it("should pass requiredKey to extractJsonFromAIResponse", () => {
    (extractJsonFromAIResponse as jest.Mock).mockReturnValue({
      success: true,
      data: { plan: [] },
      method: "regex",
    });

    extractJsonFromResponse<{ plan: unknown[] }>(
      '```json\n{"plan":[]}\n```',
      mockLogger,
      "plan",
    );
    expect(extractJsonFromAIResponse).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ requiredKey: "plan" }),
    );
  });

  it("should return null when success is true but data is null", () => {
    (extractJsonFromAIResponse as jest.Mock).mockReturnValue({
      success: true,
      data: null,
    });

    const result = extractJsonFromResponse("some response", mockLogger);
    expect(result).toBeNull();
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it("should not log parse error for valid JSON", () => {
    (extractJsonFromAIResponse as jest.Mock).mockReturnValue({
      success: true,
      data: { valid: true },
      method: "direct",
    });

    extractJsonFromResponse<{ valid: boolean }>('{"valid":true}', mockLogger);
    // Should NOT have called warn for direct JSON parse error
    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining("Direct JSON.parse error"),
    );
  });
});
