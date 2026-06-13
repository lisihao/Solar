/**
 * QualityRegistryService Unit Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { QualityRegistryService } from "../quality-registry.service";
import { QualityGateService } from "../quality-gate.service";
import {
  IQualityChecker,
  QualityDimension,
  QualityCheckResult,
} from "../../abstractions/quality-gate.interface";
import { CheckerMetadata } from "../quality-registry.service";

// ---------------------------------------------------------------------------
// 测试用辅助函数
// ---------------------------------------------------------------------------

function makeChecker(
  dimension: QualityDimension,
  name = `${dimension} checker`,
  description = `${dimension} desc`,
): IQualityChecker {
  return {
    dimension,
    name,
    description,
    isAvailable: jest.fn().mockReturnValue(true),
    check: jest.fn().mockResolvedValue({
      dimension,
      score: 80,
      passed: true,
      issues: [],
      suggestions: [],
      checkDuration: 5,
    } satisfies QualityCheckResult),
  };
}

// ---------------------------------------------------------------------------
// 测试主体
// ---------------------------------------------------------------------------

describe("QualityRegistryService", () => {
  let registryService: QualityRegistryService;
  let qualityGateService: QualityGateService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QualityRegistryService,
        QualityGateService,
        {
          provide: ModuleRef,
          useValue: {},
        },
      ],
    }).compile();

    registryService = module.get<QualityRegistryService>(
      QualityRegistryService,
    );
    qualityGateService = module.get<QualityGateService>(QualityGateService);

    // 静默 Logger
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // onModuleInit
  // ---------------------------------------------------------------------------

  describe("onModuleInit()", () => {
    it("无错误地完成初始化", async () => {
      await expect(registryService.onModuleInit()).resolves.toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // register()
  // ---------------------------------------------------------------------------

  describe("register()", () => {
    it("将检查器注册到 registry", () => {
      const checker = makeChecker("diversity");
      registryService.register(checker);
      expect(registryService.getMetadata("diversity")).toBeDefined();
    });

    it("调用 QualityGateService.registerChecker", () => {
      const spy = jest
        .spyOn(qualityGateService, "registerChecker")
        .mockImplementation(() => undefined);
      const checker = makeChecker("coherence");
      registryService.register(checker);
      expect(spy).toHaveBeenCalledWith(checker);
    });

    it("metadata 被正确存储", () => {
      const checker = makeChecker("factual", "Factual", "Factual desc");
      registryService.register(checker, {
        priority: 5,
        dependencies: ["diversity"],
      });
      const meta = registryService.getMetadata("factual");
      expect(meta).toMatchObject<CheckerMetadata>({
        dimension: "factual",
        name: "Factual",
        description: "Factual desc",
        priority: 5,
        dependencies: ["diversity"],
      });
    });

    it("省略 metadata 时使用默认值", () => {
      const checker = makeChecker("consistency");
      registryService.register(checker);
      const meta = registryService.getMetadata("consistency");
      expect(meta?.priority).toBe(0);
      expect(meta?.dependencies).toEqual([]);
    });

    it("相同 dimension 二次注册时覆盖原有记录", () => {
      registryService.register(makeChecker("diversity"), { priority: 1 });
      registryService.register(makeChecker("diversity"), { priority: 9 });
      const meta = registryService.getMetadata("diversity");
      expect(meta?.priority).toBe(9);
    });

    it("checker.description 为 undefined 时 metadata.description 也为 undefined", () => {
      const checker: IQualityChecker = {
        dimension: "originality",
        name: "originality checker",
        // 无 description
        isAvailable: jest.fn().mockReturnValue(true),
        check: jest.fn(),
      };
      registryService.register(checker);
      const meta = registryService.getMetadata("originality");
      expect(meta?.description).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // registerBatch()
  // ---------------------------------------------------------------------------

  describe("registerBatch()", () => {
    it("批量注册多个检查器", () => {
      registryService.registerBatch([
        { checker: makeChecker("diversity"), metadata: { priority: 3 } },
        { checker: makeChecker("coherence"), metadata: { priority: 1 } },
        { checker: makeChecker("factual") },
      ]);
      expect(registryService.size).toBe(3);
    });

    it("为每个检查器调用 QualityGateService.registerChecker", () => {
      const spy = jest
        .spyOn(qualityGateService, "registerChecker")
        .mockImplementation(() => undefined);
      const checkers = [makeChecker("diversity"), makeChecker("coherence")];
      registryService.registerBatch(checkers.map((c) => ({ checker: c })));
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it("空数组时安全处理", () => {
      expect(() => registryService.registerBatch([])).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // unregister()
  // ---------------------------------------------------------------------------

  describe("unregister()", () => {
    it("删除已注册检查器并返回 true", () => {
      registryService.register(makeChecker("diversity"));
      const result = registryService.unregister("diversity");
      expect(result).toBe(true);
      expect(registryService.getMetadata("diversity")).toBeUndefined();
    });

    it("调用 QualityGateService.unregisterChecker", () => {
      const spy = jest
        .spyOn(qualityGateService, "unregisterChecker")
        .mockReturnValue(true);
      registryService.register(makeChecker("coherence"));
      registryService.unregister("coherence");
      expect(spy).toHaveBeenCalledWith("coherence");
    });

    it("未注册的 dimension 返回 false", () => {
      const result = registryService.unregister("factual");
      expect(result).toBe(false);
    });

    it("未注册时不调用 QualityGateService.unregisterChecker", () => {
      const spy = jest
        .spyOn(qualityGateService, "unregisterChecker")
        .mockReturnValue(false);
      registryService.unregister("diversity");
      expect(spy).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // getMetadata()
  // ---------------------------------------------------------------------------

  describe("getMetadata()", () => {
    it("返回已注册的 metadata", () => {
      registryService.register(makeChecker("diversity"), { priority: 7 });
      const meta = registryService.getMetadata("diversity");
      expect(meta?.priority).toBe(7);
    });

    it("未注册时返回 undefined", () => {
      expect(registryService.getMetadata("factual")).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // getAllMetadata()
  // ---------------------------------------------------------------------------

  describe("getAllMetadata()", () => {
    it("返回所有已注册检查器的 metadata 数组", () => {
      registryService.register(makeChecker("diversity"));
      registryService.register(makeChecker("coherence"));
      const all = registryService.getAllMetadata();
      expect(all).toHaveLength(2);
    });

    it("无检查器时返回空数组", () => {
      expect(registryService.getAllMetadata()).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // getByPriority()
  // ---------------------------------------------------------------------------

  describe("getByPriority()", () => {
    it("返回按 priority 降序排列的数组", () => {
      registryService.register(makeChecker("diversity"), { priority: 1 });
      registryService.register(makeChecker("coherence"), { priority: 5 });
      registryService.register(makeChecker("factual"), { priority: 3 });
      const sorted = registryService.getByPriority();
      expect(sorted[0].dimension).toBe("coherence");
      expect(sorted[1].dimension).toBe("factual");
      expect(sorted[2].dimension).toBe("diversity");
    });

    it("priority 相同时也能安全处理", () => {
      registryService.register(makeChecker("diversity"), { priority: 2 });
      registryService.register(makeChecker("coherence"), { priority: 2 });
      const sorted = registryService.getByPriority();
      expect(sorted).toHaveLength(2);
    });

    it("无检查器时返回空数组", () => {
      expect(registryService.getByPriority()).toEqual([]);
    });

    it("priority 未设置（undefined）时视为 0", () => {
      registryService.register(makeChecker("diversity")); // priority 默认 0
      registryService.register(makeChecker("coherence"), { priority: 3 });
      const sorted = registryService.getByPriority();
      expect(sorted[0].dimension).toBe("coherence");
    });
  });

  // ---------------------------------------------------------------------------
  // getDependencies()
  // ---------------------------------------------------------------------------

  describe("getDependencies()", () => {
    it("返回已注册的 dependencies", () => {
      registryService.register(makeChecker("coherence"), {
        dependencies: ["diversity", "factual"],
      });
      const deps = registryService.getDependencies("coherence");
      expect(deps).toEqual(["diversity", "factual"]);
    });

    it("未设置 dependencies 时返回空数组", () => {
      registryService.register(makeChecker("diversity"));
      expect(registryService.getDependencies("diversity")).toEqual([]);
    });

    it("未注册的 dimension 返回空数组", () => {
      expect(registryService.getDependencies("factual")).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // checkDependencies()
  // ---------------------------------------------------------------------------

  describe("checkDependencies()", () => {
    it("所有依赖均已注册时返回 true", () => {
      registryService.register(makeChecker("diversity"));
      registryService.register(makeChecker("factual"));
      registryService.register(makeChecker("coherence"), {
        dependencies: ["diversity", "factual"],
      });
      expect(registryService.checkDependencies("coherence")).toBe(true);
    });

    it("依赖未注册时返回 false", () => {
      registryService.register(makeChecker("coherence"), {
        dependencies: ["diversity"],
      });
      // diversity 未注册
      expect(registryService.checkDependencies("coherence")).toBe(false);
    });

    it("无依赖（空数组）时返回 true", () => {
      registryService.register(makeChecker("diversity"));
      expect(registryService.checkDependencies("diversity")).toBe(true);
    });

    it("未注册的 dimension 视为无依赖并返回 true", () => {
      // registry 中不存在 → getDependencies → [] → 全满足
      expect(registryService.checkDependencies("originality")).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // size 属性
  // ---------------------------------------------------------------------------

  describe("size", () => {
    it("初始值为 0", () => {
      expect(registryService.size).toBe(0);
    });

    it("register 后计数增加", () => {
      registryService.register(makeChecker("diversity"));
      expect(registryService.size).toBe(1);
      registryService.register(makeChecker("coherence"));
      expect(registryService.size).toBe(2);
    });

    it("unregister 后计数减少", () => {
      registryService.register(makeChecker("diversity"));
      registryService.register(makeChecker("coherence"));
      registryService.unregister("diversity");
      expect(registryService.size).toBe(1);
    });

    it("相同 dimension 二次注册时大小不增加", () => {
      registryService.register(makeChecker("diversity"), { priority: 1 });
      registryService.register(makeChecker("diversity"), { priority: 2 });
      expect(registryService.size).toBe(1);
    });
  });
});
