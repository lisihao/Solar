/**
 * GuardrailsPipelineService - 纯 Mock 单元测试
 *
 * 与现有的 guardrails-pipeline.service.spec.ts 不同，
 * 此文件使用纯 mock guardrails 测试管道逻辑本身：
 * - processInput() 管道执行顺序
 * - processOutput() 管道执行顺序
 * - Short-circuit on 'block' severity
 * - 跳过 disabled guardrails
 * - Guardrail 执行异常容错
 * - getStatus() / getCount()
 * - 多个 guardrails 组合场景
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { GuardrailsPipelineService } from "../guardrails-pipeline.service";
import {
  IInputGuardrail,
  IOutputGuardrail,
  GuardrailResult,
} from "../guardrails.interface";

function createInputGuardrail(
  id: string,
  result: GuardrailResult,
  options: { enabled?: boolean } = {},
): IInputGuardrail {
  return {
    id,
    name: `Input Guardrail: ${id}`,
    enabled: options.enabled ?? true,
    check: jest.fn().mockResolvedValue(result),
  };
}

function createOutputGuardrail(
  id: string,
  result: GuardrailResult,
  options: { enabled?: boolean } = {},
): IOutputGuardrail {
  return {
    id,
    name: `Output Guardrail: ${id}`,
    enabled: options.enabled ?? true,
    check: jest.fn().mockResolvedValue(result),
  };
}

describe("GuardrailsPipelineService - Unit", () => {
  let service: GuardrailsPipelineService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GuardrailsPipelineService],
    }).compile();

    service = module.get<GuardrailsPipelineService>(GuardrailsPipelineService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // Registration
  // =========================================================================

  describe("registration", () => {
    it("should register input guardrails", () => {
      const g = createInputGuardrail("test", {
        passed: true,
        guardrailId: "test",
        severity: "info",
      });
      service.registerInputGuardrail(g);

      expect(service.getCount().input).toBe(1);
    });

    it("should register output guardrails", () => {
      const g = createOutputGuardrail("test", {
        passed: true,
        guardrailId: "test",
        severity: "info",
      });
      service.registerOutputGuardrail(g);

      expect(service.getCount().output).toBe(1);
    });

    it("should register multiple guardrails", () => {
      service.registerInputGuardrail(
        createInputGuardrail("g1", {
          passed: true,
          guardrailId: "g1",
          severity: "info",
        }),
      );
      service.registerInputGuardrail(
        createInputGuardrail("g2", {
          passed: true,
          guardrailId: "g2",
          severity: "info",
        }),
      );
      service.registerOutputGuardrail(
        createOutputGuardrail("g3", {
          passed: true,
          guardrailId: "g3",
          severity: "info",
        }),
      );

      expect(service.getCount()).toEqual({ input: 2, output: 1 });
    });
  });

  // =========================================================================
  // processInput - passing
  // =========================================================================

  describe("processInput - all pass", () => {
    it("should pass when no guardrails registered", async () => {
      const result = await service.processInput({ content: "Hello" });

      expect(result.passed).toBe(true);
      expect(result.results).toHaveLength(0);
      expect(result.blockedBy).toBeUndefined();
    });

    it("should pass when all guardrails pass", async () => {
      service.registerInputGuardrail(
        createInputGuardrail("g1", {
          passed: true,
          guardrailId: "g1",
          severity: "info",
        }),
      );
      service.registerInputGuardrail(
        createInputGuardrail("g2", {
          passed: true,
          guardrailId: "g2",
          severity: "info",
        }),
      );

      const result = await service.processInput({ content: "Hello" });

      expect(result.passed).toBe(true);
      expect(result.results).toHaveLength(2);
    });

    it("should pass when guardrails have warning severity", async () => {
      service.registerInputGuardrail(
        createInputGuardrail("pii-detector", {
          passed: false,
          guardrailId: "pii-detector",
          severity: "warning",
          message: "PII detected",
        }),
      );

      const result = await service.processInput({
        content: "my email is test@example.com",
      });

      expect(result.passed).toBe(true);
      // warning severity does not block
    });

    it("should pass when guardrails have info severity", async () => {
      service.registerInputGuardrail(
        createInputGuardrail("logger", {
          passed: false,
          guardrailId: "logger",
          severity: "info",
          message: "Logged",
        }),
      );

      const result = await service.processInput({ content: "Hello" });

      expect(result.passed).toBe(true);
    });
  });

  // =========================================================================
  // processInput - blocking
  // =========================================================================

  describe("processInput - blocking", () => {
    it("should block when guardrail returns block severity", async () => {
      service.registerInputGuardrail(
        createInputGuardrail("blocker", {
          passed: false,
          guardrailId: "blocker",
          severity: "block",
          message: "Blocked!",
        }),
      );

      const result = await service.processInput({ content: "malicious" });

      expect(result.passed).toBe(false);
      expect(result.blockedBy).toBe("blocker");
    });

    it("should short-circuit on block (skip subsequent guardrails)", async () => {
      const blocker = createInputGuardrail("blocker", {
        passed: false,
        guardrailId: "blocker",
        severity: "block",
      });
      const afterBlocker = createInputGuardrail("after", {
        passed: true,
        guardrailId: "after",
        severity: "info",
      });

      service.registerInputGuardrail(blocker);
      service.registerInputGuardrail(afterBlocker);

      const result = await service.processInput({ content: "test" });

      expect(result.passed).toBe(false);
      expect(result.results).toHaveLength(1); // only blocker executed
      expect(afterBlocker.check).not.toHaveBeenCalled();
    });

    it("should fail on error severity", async () => {
      service.registerInputGuardrail(
        createInputGuardrail("error-guard", {
          passed: false,
          guardrailId: "error-guard",
          severity: "error",
          message: "Error detected",
        }),
      );

      const result = await service.processInput({ content: "test" });

      expect(result.passed).toBe(false);
    });
  });

  // =========================================================================
  // processInput - disabled guardrails
  // =========================================================================

  describe("processInput - disabled guardrails", () => {
    it("should skip disabled guardrails", async () => {
      const disabled = createInputGuardrail(
        "disabled",
        { passed: false, guardrailId: "disabled", severity: "block" },
        { enabled: false },
      );

      service.registerInputGuardrail(disabled);

      const result = await service.processInput({ content: "test" });

      expect(result.passed).toBe(true);
      expect(disabled.check).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // processInput - exception handling
  // =========================================================================

  describe("processInput - exception handling", () => {
    // ★ Security (P0): 护栏抛错 → fail-closed 阻断并短路（不再 fail-open 继续放行）
    it("should fail-closed and short-circuit when a guardrail throws", async () => {
      const throwing: IInputGuardrail = {
        id: "throwing",
        name: "Throwing Guardrail",
        enabled: true,
        check: jest.fn().mockRejectedValue(new Error("Guardrail crashed")),
      };
      const passing = createInputGuardrail("passing", {
        passed: true,
        guardrailId: "passing",
        severity: "info",
      });

      service.registerInputGuardrail(throwing);
      service.registerInputGuardrail(passing);

      const result = await service.processInput({ content: "test" });

      // Throw is treated as a block: not passed, blockedBy set, short-circuits
      expect(result.passed).toBe(false);
      expect(result.blockedBy).toBe("throwing");
      expect(result.results).toHaveLength(1);
      expect(result.results[0].severity).toBe("block");
      expect(result.results[0].message).toContain("execution error");
      expect(passing.check).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // processOutput
  // =========================================================================

  describe("processOutput", () => {
    it("should pass clean output", async () => {
      service.registerOutputGuardrail(
        createOutputGuardrail("compliance", {
          passed: true,
          guardrailId: "compliance",
          severity: "info",
        }),
      );

      const result = await service.processOutput({ content: "Clean output" });

      expect(result.passed).toBe(true);
    });

    it("should block output with block severity", async () => {
      service.registerOutputGuardrail(
        createOutputGuardrail("output-blocker", {
          passed: false,
          guardrailId: "output-blocker",
          severity: "block",
          message: "Output blocked",
        }),
      );

      const result = await service.processOutput({ content: "Sensitive" });

      expect(result.passed).toBe(false);
      expect(result.blockedBy).toBe("output-blocker");
    });

    it("should short-circuit on output block", async () => {
      const blocker = createOutputGuardrail("blocker", {
        passed: false,
        guardrailId: "blocker",
        severity: "block",
      });
      const afterBlocker = createOutputGuardrail("after", {
        passed: true,
        guardrailId: "after",
        severity: "info",
      });

      service.registerOutputGuardrail(blocker);
      service.registerOutputGuardrail(afterBlocker);

      await service.processOutput({ content: "test" });

      expect(afterBlocker.check).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // getStatus
  // =========================================================================

  describe("getStatus", () => {
    it("should return status of all guardrails", () => {
      service.registerInputGuardrail(
        createInputGuardrail("g1", {
          passed: true,
          guardrailId: "g1",
          severity: "info",
        }),
      );
      service.registerOutputGuardrail(
        createOutputGuardrail("g2", {
          passed: true,
          guardrailId: "g2",
          severity: "info",
        }),
      );

      const status = service.getStatus();

      expect(status.inputGuardrails).toHaveLength(1);
      expect(status.outputGuardrails).toHaveLength(1);
      expect(status.inputGuardrails[0]).toContain("g1");
      expect(status.inputGuardrails[0]).toContain("enabled: true");
    });
  });

  // =========================================================================
  // getCount
  // =========================================================================

  describe("getCount", () => {
    it("should return zero when no guardrails", () => {
      expect(service.getCount()).toEqual({ input: 0, output: 0 });
    });
  });

  // =========================================================================
  // trusted-internal: regex 可疑只记日志，不升级 LLM moderation 不 block
  // =========================================================================

  describe("processInput - trustedInternal escalation opt-out", () => {
    function setupSuspiciousWithEscalation(escalationResult: GuardrailResult) {
      service.registerInputGuardrail(
        createInputGuardrail("regex-injection", {
          passed: false,
          guardrailId: "regex-injection",
          severity: "warning",
          message: "suspicious pattern",
        }),
      );
      const escalation = createInputGuardrail(
        "llm-moderation",
        escalationResult,
      );
      service.registerEscalationGuardrail(escalation);
      return escalation;
    }

    it("trustedInternal=true → escalation guardrail NOT invoked, input passes", async () => {
      const escalation = setupSuspiciousWithEscalation({
        passed: false,
        guardrailId: "llm-moderation",
        severity: "block",
        message: "classified harmful",
      });

      const result = await service.processInput({
        content: "scraped web corpus that trips regex",
        trustedInternal: true,
      });

      expect(escalation.check).not.toHaveBeenCalled();
      expect(result.passed).toBe(true);
      expect(result.blockedBy).toBeUndefined();
    });

    it("default (no flag) → escalation still runs and can block (unchanged)", async () => {
      const escalation = setupSuspiciousWithEscalation({
        passed: false,
        guardrailId: "llm-moderation",
        severity: "block",
        message: "classified harmful",
      });

      const result = await service.processInput({
        content: "scraped web corpus that trips regex",
      });

      expect(escalation.check).toHaveBeenCalledTimes(1);
      expect(result.passed).toBe(false);
      expect(result.blockedBy).toBe("llm-moderation");
    });

    it("trustedInternal does NOT bypass regex hard block", async () => {
      service.registerInputGuardrail(
        createInputGuardrail("regex-hard", {
          passed: false,
          guardrailId: "regex-hard",
          severity: "block",
          message: "confirmed violation",
        }),
      );

      const result = await service.processInput({
        content: "definitely blocked content",
        trustedInternal: true,
      });

      expect(result.passed).toBe(false);
      expect(result.blockedBy).toBe("regex-hard");
    });
  });
});
