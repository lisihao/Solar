/**
 * Tests for SkillError
 */

import { SkillError } from "../skill.error";
import { EngineError } from "@/modules/ai-engine/facade/abstractions/engine.error";
import { SkillErrorCode } from "@/modules/ai-engine/facade/abstractions/error-codes.constants";

describe("SkillError", () => {
  describe("constructor", () => {
    it("is an instance of EngineError", () => {
      const error = new SkillError("test");
      expect(error).toBeInstanceOf(EngineError);
    });

    it("is an instance of SkillError", () => {
      const error = new SkillError("test");
      expect(error).toBeInstanceOf(SkillError);
    });

    it("defaults code to SkillErrorCode.UNKNOWN", () => {
      const error = new SkillError("test");
      expect(error.code).toBe(SkillErrorCode.UNKNOWN);
    });

    it("sets name to SkillError", () => {
      const error = new SkillError("test");
      expect(error.name).toBe("SkillError");
    });

    it("skillId is undefined by default", () => {
      const error = new SkillError("test");
      expect(error.skillId).toBeUndefined();
    });

    it("skillName is undefined by default", () => {
      const error = new SkillError("test");
      expect(error.skillName).toBeUndefined();
    });

    it("layer is undefined by default", () => {
      const error = new SkillError("test");
      expect(error.layer).toBeUndefined();
    });

    it("sets skillId from options", () => {
      const error = new SkillError("test", SkillErrorCode.UNKNOWN, {
        skillId: "skill-1",
      });
      expect(error.skillId).toBe("skill-1");
    });

    it("sets skillName from options", () => {
      const error = new SkillError("test", SkillErrorCode.UNKNOWN, {
        skillName: "MySkill",
      });
      expect(error.skillName).toBe("MySkill");
    });

    it("sets layer from options", () => {
      const error = new SkillError("test", SkillErrorCode.UNKNOWN, {
        layer: "orchestration",
      });
      expect(error.layer).toBe("orchestration");
    });

    it("includes skillId in details when provided", () => {
      const error = new SkillError("test", SkillErrorCode.UNKNOWN, {
        skillId: "skill-1",
      });
      expect(error.details?.skillId).toBe("skill-1");
    });

    it("includes layer in details when provided", () => {
      const error = new SkillError("test", SkillErrorCode.UNKNOWN, {
        skillId: "skill-1",
        layer: "app",
      });
      expect(error.details?.layer).toBe("app");
    });
  });

  describe("notFound factory", () => {
    it("creates error with skillId in message", () => {
      const error = SkillError.notFound("skill-abc");
      expect(error.message).toContain("skill-abc");
    });

    it("sets skillId", () => {
      const error = SkillError.notFound("skill-1");
      expect(error.skillId).toBe("skill-1");
    });

    it("has retryable false", () => {
      const error = SkillError.notFound("skill-1");
      expect(error.retryable).toBe(false);
    });

    it("has code NOT_FOUND", () => {
      const error = SkillError.notFound("skill-1");
      expect(error.code).toBe(SkillErrorCode.NOT_FOUND);
    });
  });

  describe("notRegistered factory", () => {
    it("sets skillId", () => {
      const error = SkillError.notRegistered("skill-2");
      expect(error.skillId).toBe("skill-2");
    });

    it("has retryable false", () => {
      const error = SkillError.notRegistered("skill-2");
      expect(error.retryable).toBe(false);
    });

    it("has code NOT_REGISTERED", () => {
      const error = SkillError.notRegistered("skill-2");
      expect(error.code).toBe(SkillErrorCode.NOT_REGISTERED);
    });
  });

  describe("preconditionFailed factory", () => {
    it("creates error with skillId and reason in message", () => {
      const error = SkillError.preconditionFailed("skill-1", "not ready");
      expect(error.message).toContain("skill-1");
      expect(error.message).toContain("not ready");
    });

    it("sets skillId", () => {
      const error = SkillError.preconditionFailed("skill-1", "reason");
      expect(error.skillId).toBe("skill-1");
    });

    it("has retryable false", () => {
      const error = SkillError.preconditionFailed("skill-1", "reason");
      expect(error.retryable).toBe(false);
    });

    it("has code PRECONDITION_FAILED", () => {
      const error = SkillError.preconditionFailed("skill-1", "reason");
      expect(error.code).toBe(SkillErrorCode.PRECONDITION_FAILED);
    });
  });

  describe("missingTool factory", () => {
    it("creates error with skillId and toolId in message", () => {
      const error = SkillError.missingTool("skill-1", "tool-x");
      expect(error.message).toContain("skill-1");
      expect(error.message).toContain("tool-x");
    });

    it("sets skillId", () => {
      const error = SkillError.missingTool("skill-1", "tool-x");
      expect(error.skillId).toBe("skill-1");
    });

    it("has retryable false", () => {
      const error = SkillError.missingTool("skill-1", "tool-x");
      expect(error.retryable).toBe(false);
    });

    it("has code MISSING_TOOL", () => {
      const error = SkillError.missingTool("skill-1", "tool-x");
      expect(error.code).toBe(SkillErrorCode.MISSING_TOOL);
    });
  });

  describe("executionFailed factory", () => {
    it("creates error with skillId and reason in message", () => {
      const error = SkillError.executionFailed("skill-1", "network error");
      expect(error.message).toContain("skill-1");
      expect(error.message).toContain("network error");
    });

    it("sets skillId", () => {
      const error = SkillError.executionFailed("skill-1", "failed");
      expect(error.skillId).toBe("skill-1");
    });

    it("has retryable false", () => {
      const error = SkillError.executionFailed("skill-1", "reason");
      expect(error.retryable).toBe(false);
    });

    it("includes cause when provided", () => {
      const cause = new Error("root cause");
      const error = SkillError.executionFailed("skill-1", "failed", cause);
      expect(error.cause).toBe(cause);
    });

    it("has code EXECUTION_FAILED", () => {
      const error = SkillError.executionFailed("skill-1", "reason");
      expect(error.code).toBe(SkillErrorCode.EXECUTION_FAILED);
    });
  });

  describe("timeout factory", () => {
    it("creates error with skillId and timeout in message", () => {
      const error = SkillError.timeout("skill-1", 5000);
      expect(error.skillId).toBe("skill-1");
      expect(error.message).toContain("5000");
    });

    it("has retryable true", () => {
      const error = SkillError.timeout("skill-1", 5000);
      expect(error.retryable).toBe(true);
    });

    it("has code TIMEOUT", () => {
      const error = SkillError.timeout("skill-1", 5000);
      expect(error.code).toBe(SkillErrorCode.TIMEOUT);
    });
  });

  describe("cancelled factory", () => {
    it("creates error with skillId", () => {
      const error = SkillError.cancelled("skill-1");
      expect(error.skillId).toBe("skill-1");
    });

    it("has retryable false", () => {
      const error = SkillError.cancelled("skill-1");
      expect(error.retryable).toBe(false);
    });

    it("has code CANCELLED", () => {
      const error = SkillError.cancelled("skill-1");
      expect(error.code).toBe(SkillErrorCode.CANCELLED);
    });
  });

  describe("llmCallFailed factory", () => {
    it("creates error with skillId in message", () => {
      const error = SkillError.llmCallFailed("skill-1");
      expect(error.message).toContain("skill-1");
    });

    it("sets skillId", () => {
      const error = SkillError.llmCallFailed("skill-1");
      expect(error.skillId).toBe("skill-1");
    });

    it("has retryable true", () => {
      const error = SkillError.llmCallFailed("skill-1");
      expect(error.retryable).toBe(true);
    });

    it("includes cause when provided", () => {
      const cause = new Error("LLM unavailable");
      const error = SkillError.llmCallFailed("skill-1", cause);
      expect(error.cause).toBe(cause);
    });

    it("has code LLM_CALL_FAILED", () => {
      const error = SkillError.llmCallFailed("skill-1");
      expect(error.code).toBe(SkillErrorCode.LLM_CALL_FAILED);
    });
  });

  describe("fromError static method", () => {
    it("returns same SkillError if passed a SkillError", () => {
      const original = SkillError.notFound("skill-1");
      const result = SkillError.fromError(original);
      expect(result).toBe(original);
    });

    it("wraps a plain Error into SkillError", () => {
      const plain = new Error("plain error");
      const result = SkillError.fromError(plain);
      expect(result).toBeInstanceOf(SkillError);
      expect(result.message).toBe("plain error");
      expect(result.cause).toBe(plain);
    });

    it("wraps string error into SkillError", () => {
      const result = SkillError.fromError("skill failed");
      expect(result).toBeInstanceOf(SkillError);
      expect(result.message).toBe("skill failed");
    });

    it("wraps unknown value with generic message", () => {
      const result = SkillError.fromError({ foo: "bar" });
      expect(result.message).toBe("Unknown skill error");
    });

    it("extracts skillId from details when provided", () => {
      const result = SkillError.fromError(
        new Error("err"),
        SkillErrorCode.UNKNOWN,
        { skillId: "skill-5" },
      );
      expect(result.skillId).toBe("skill-5");
    });

    it("accepts custom code", () => {
      const result = SkillError.fromError(
        new Error("err"),
        SkillErrorCode.EXECUTION_FAILED,
      );
      expect(result.code).toBe(SkillErrorCode.EXECUTION_FAILED);
    });
  });

  describe("fromSkillError static method", () => {
    it("returns same SkillError if passed a SkillError", () => {
      const original = SkillError.notFound("s1");
      const result = SkillError.fromSkillError(original, "s1");
      expect(result).toBe(original);
    });

    it("wraps plain Error with skillId", () => {
      const plain = new Error("fail");
      const result = SkillError.fromSkillError(plain, "skill-xyz");
      expect(result).toBeInstanceOf(SkillError);
      expect(result.skillId).toBe("skill-xyz");
    });

    it("works without skillId", () => {
      const result = SkillError.fromSkillError(new Error("err"));
      expect(result).toBeInstanceOf(SkillError);
      expect(result.skillId).toBeUndefined();
    });
  });

  describe("missingSkill factory", () => {
    it("sets skillId", () => {
      const error = SkillError.missingSkill("skill-1", "skill-dep");
      expect(error.skillId).toBe("skill-1");
    });

    it("has retryable false", () => {
      const error = SkillError.missingSkill("skill-1", "skill-dep");
      expect(error.retryable).toBe(false);
    });

    it("has code MISSING_SKILL", () => {
      const error = SkillError.missingSkill("skill-1", "skill-dep");
      expect(error.code).toBe(SkillErrorCode.MISSING_SKILL);
    });
  });
});

