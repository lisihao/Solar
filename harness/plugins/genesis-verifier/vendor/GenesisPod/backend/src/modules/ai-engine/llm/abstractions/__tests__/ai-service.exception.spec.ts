/**
 * ai-service.exception.ts unit tests
 * Covers: AiServiceUnavailableError, AiResponseInvalidError,
 *         AiOutputValidationError, AiTaskExecutionError
 */
import {
  AiServiceUnavailableError,
  AiResponseInvalidError,
  AiOutputValidationError,
  AiTaskExecutionError,
} from "../ai-service.exception";

describe("AiServiceUnavailableError", () => {
  it("is an instance of Error", () => {
    const err = new AiServiceUnavailableError("service down");
    expect(err).toBeInstanceOf(Error);
  });

  it("sets name to AiServiceUnavailableError", () => {
    const err = new AiServiceUnavailableError("service down");
    expect(err.name).toBe("AiServiceUnavailableError");
  });

  it("sets message correctly", () => {
    const err = new AiServiceUnavailableError("openai is down");
    expect(err.message).toBe("openai is down");
  });

  it("sets default code AI_SERVICE_UNAVAILABLE", () => {
    const err = new AiServiceUnavailableError("down");
    expect(err.code).toBe("AI_SERVICE_UNAVAILABLE");
  });

  it("accepts optional provider", () => {
    const err = new AiServiceUnavailableError("down", "openai");
    expect(err.provider).toBe("openai");
  });

  it("accepts custom code", () => {
    const err = new AiServiceUnavailableError(
      "down",
      "anthropic",
      "CUSTOM_CODE",
    );
    expect(err.code).toBe("CUSTOM_CODE");
  });

  it("provider defaults to undefined when not provided", () => {
    const err = new AiServiceUnavailableError("down");
    expect(err.provider).toBeUndefined();
  });
});

describe("AiResponseInvalidError", () => {
  it("is an instance of Error", () => {
    const err = new AiResponseInvalidError("bad response");
    expect(err).toBeInstanceOf(Error);
  });

  it("sets name to AiResponseInvalidError", () => {
    const err = new AiResponseInvalidError("bad json");
    expect(err.name).toBe("AiResponseInvalidError");
  });

  it("sets default code AI_RESPONSE_INVALID", () => {
    const err = new AiResponseInvalidError("invalid");
    expect(err.code).toBe("AI_RESPONSE_INVALID");
  });

  it("accepts custom code", () => {
    const err = new AiResponseInvalidError("invalid", "PARSE_ERROR");
    expect(err.code).toBe("PARSE_ERROR");
  });

  it("sets message correctly", () => {
    const err = new AiResponseInvalidError("unexpected format");
    expect(err.message).toBe("unexpected format");
  });
});

describe("AiOutputValidationError", () => {
  it("is an instance of Error", () => {
    const err = new AiOutputValidationError("validation failed");
    expect(err).toBeInstanceOf(Error);
  });

  it("sets name to AiOutputValidationError", () => {
    const err = new AiOutputValidationError("fail");
    expect(err.name).toBe("AiOutputValidationError");
  });

  it("sets default code AI_OUTPUT_VALIDATION_FAILED", () => {
    const err = new AiOutputValidationError("fail");
    expect(err.code).toBe("AI_OUTPUT_VALIDATION_FAILED");
  });

  it("stores validationErrors array", () => {
    const errors = ["field required", "too long"];
    const err = new AiOutputValidationError("fail", errors);
    expect(err.validationErrors).toEqual(errors);
  });

  it("validationErrors defaults to undefined", () => {
    const err = new AiOutputValidationError("fail");
    expect(err.validationErrors).toBeUndefined();
  });

  it("accepts custom code", () => {
    const err = new AiOutputValidationError("fail", [], "CUSTOM");
    expect(err.code).toBe("CUSTOM");
  });
});

describe("AiTaskExecutionError", () => {
  it("is an instance of Error", () => {
    const err = new AiTaskExecutionError("task failed");
    expect(err).toBeInstanceOf(Error);
  });

  it("sets name to AiTaskExecutionError", () => {
    const err = new AiTaskExecutionError("task failed");
    expect(err.name).toBe("AiTaskExecutionError");
  });

  it("sets default code AI_TASK_EXECUTION_FAILED", () => {
    const err = new AiTaskExecutionError("failed");
    expect(err.code).toBe("AI_TASK_EXECUTION_FAILED");
  });

  it("stores taskType", () => {
    const err = new AiTaskExecutionError("failed", "RESEARCH");
    expect(err.taskType).toBe("RESEARCH");
  });

  it("stores attempts count", () => {
    const err = new AiTaskExecutionError("failed", "RESEARCH", 3);
    expect(err.attempts).toBe(3);
  });

  it("accepts custom code", () => {
    const err = new AiTaskExecutionError("failed", "RESEARCH", 3, "CUSTOM");
    expect(err.code).toBe("CUSTOM");
  });

  it("taskType and attempts default to undefined", () => {
    const err = new AiTaskExecutionError("failed");
    expect(err.taskType).toBeUndefined();
    expect(err.attempts).toBeUndefined();
  });
});
