/**
 * facade.providers.ts — branch coverage spec
 *
 * Tests all useFactory functions in feature providers.
 * Each factory has 2 main branches: returns undefined when required deps absent,
 * returns object when deps present.
 */

import {
  memoryFeatureProvider,
  toolFeatureProvider,
  orchestrationFeatureProvider,
  skillFeatureProvider,
  realtimeFeatureProvider,
  constraintFeatureProvider,
  teamsFeatureProvider,
  contentFeatureProvider,
  knowledgeFeatureProvider,
  intelligenceFeatureProvider,
  collaborationFeatureProvider,
  observabilityFeatureProvider,
  registryFeatureProvider,
} from "../facade.providers";

type FactoryFn = (...args: unknown[]) => unknown;

function getFactory(provider: { useFactory?: FactoryFn }): FactoryFn {
  return provider.useFactory as FactoryFn;
}

const stub = () => ({}) as unknown;

describe("facade.providers — factory functions", () => {
  describe("memoryFeatureProvider", () => {
    const factory = getFactory(
      memoryFeatureProvider as { useFactory?: FactoryFn },
    );

    it("returns undefined when shortTerm missing", () => {
      expect(factory(undefined, stub())).toBeUndefined();
    });

    it("returns undefined when longTerm missing", () => {
      expect(factory(stub(), undefined)).toBeUndefined();
    });

    it("returns MemoryFeature when both present", () => {
      const st = stub();
      const lt = stub();
      const result = factory(st, lt) as {
        shortTerm: unknown;
        longTerm: unknown;
      };
      expect(result.shortTerm).toBe(st);
      expect(result.longTerm).toBe(lt);
    });
  });

  describe("toolFeatureProvider", () => {
    const factory = getFactory(
      toolFeatureProvider as { useFactory?: FactoryFn },
    );

    it("returns undefined when registry missing", () => {
      expect(factory(undefined, stub(), stub(), stub())).toBeUndefined();
    });

    it("returns ToolFeature when registry present", () => {
      const reg = stub();
      const result = factory(reg, stub(), stub(), stub()) as {
        registry: unknown;
      };
      expect(result.registry).toBe(reg);
    });

    it("returns ToolFeature with all optional deps", () => {
      const reg = stub();
      const exec = stub();
      const llm = stub();
      const cap = stub();
      const result = factory(reg, exec, llm, cap) as {
        registry: unknown;
        executor: unknown;
        llmAdapter: unknown;
        capabilityResolver: unknown;
      };
      expect(result.executor).toBe(exec);
      expect(result.llmAdapter).toBe(llm);
      expect(result.capabilityResolver).toBe(cap);
    });
  });

  describe("orchestrationFeatureProvider", () => {
    const factory = getFactory(
      orchestrationFeatureProvider as { useFactory?: FactoryFn },
    );

    it("returns undefined when circuitBreaker missing", () => {
      expect(factory(undefined, stub())).toBeUndefined();
    });

    it("returns undefined when agentExecutor missing", () => {
      expect(factory(stub(), undefined)).toBeUndefined();
    });

    it("returns OrchestrationFeature when required deps present", () => {
      const cb = stub();
      const ae = stub();
      const result = factory(
        cb,
        ae,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ) as {
        circuitBreaker: unknown;
        agentExecutor: unknown;
      };
      expect(result.circuitBreaker).toBe(cb);
      expect(result.agentExecutor).toBe(ae);
    });

    it("includes all optional deps when provided", () => {
      const cb = stub();
      const ae = stub();
      const id = stub();
      const esm = stub();
      const or = stub();
      const ce = stub();
      const ql = stub();
      const tt = stub();
      // taskDecomposer 已删 (2026-04-30)
      const result = factory(cb, ae, id, esm, or, ce, ql, tt) as {
        queryLoop: unknown;
      };
      expect(result.queryLoop).toBe(ql);
    });
  });

  describe("skillFeatureProvider", () => {
    const factory = getFactory(
      skillFeatureProvider as { useFactory?: FactoryFn },
    );

    it("returns undefined when loader missing", () => {
      expect(factory(undefined, stub())).toBeUndefined();
    });

    it("returns undefined when promptBuilder missing", () => {
      expect(factory(stub(), undefined)).toBeUndefined();
    });

    it("returns SkillFeature without prisma (no logUsage)", () => {
      const loader = stub();
      const pb = stub();
      const result = factory(
        loader,
        pb,
        undefined,
        undefined,
        undefined,
        undefined,
      ) as {
        loader: unknown;
        logUsage: undefined;
      };
      expect(result.loader).toBe(loader);
      expect(result.logUsage).toBeUndefined();
    });

    it("returns SkillFeature with prisma (logUsage function exists)", () => {
      const loader = stub();
      const pb = stub();
      const prisma = {
        aIUsageLog: {
          create: jest.fn().mockResolvedValue({}),
        },
      };
      const result = factory(
        loader,
        pb,
        undefined,
        undefined,
        prisma,
        undefined,
      ) as {
        logUsage?: (...args: unknown[]) => void;
      };
      expect(typeof result.logUsage).toBe("function");
    });

    it("logUsage no-ops when skillIds empty", () => {
      const loader = stub();
      const pb = stub();
      const prisma = {
        aIUsageLog: {
          create: jest.fn().mockResolvedValue({}),
        },
      };
      const result = factory(
        loader,
        pb,
        undefined,
        undefined,
        prisma,
        undefined,
      ) as {
        logUsage?: (params: unknown) => void;
      };
      result.logUsage!({ skillIds: [], success: true, duration: 100 });
      expect(prisma.aIUsageLog.create).not.toHaveBeenCalled();
    });

    it("logUsage fires create for each skill", () => {
      const loader = stub();
      const pb = stub();
      const prisma = {
        aIUsageLog: {
          create: jest.fn().mockResolvedValue({}),
        },
      };
      const result = factory(
        loader,
        pb,
        undefined,
        undefined,
        prisma,
        undefined,
      ) as {
        logUsage?: (params: {
          skillIds: string[];
          success: boolean;
          duration: number;
          tokensUsed?: number;
          model?: string;
          domain?: string;
          userId?: string;
        }) => void;
      };
      result.logUsage!({
        skillIds: ["skill-1", "skill-2"],
        success: true,
        duration: 200,
        tokensUsed: 100,
        model: "gpt-4",
        domain: "research",
        userId: "u1",
      });
      expect(prisma.aIUsageLog.create).toHaveBeenCalledTimes(2);
    });

    it("logUsage calls skillContentService.recordUsage when present", () => {
      const loader = stub();
      const pb = stub();
      const prisma = {
        aIUsageLog: {
          create: jest.fn().mockResolvedValue({}),
        },
      };
      const skillContentService = {
        recordUsage: jest.fn(),
      };
      const result = factory(
        loader,
        pb,
        undefined,
        undefined,
        prisma,
        skillContentService,
      ) as {
        logUsage?: (params: {
          skillIds: string[];
          success: boolean;
          duration: number;
        }) => void;
      };
      result.logUsage!({ skillIds: ["skill-1"], success: true, duration: 100 });
      expect(skillContentService.recordUsage).toHaveBeenCalledWith("skill-1");
    });

    it("logUsage handles create rejection gracefully", async () => {
      const loader = stub();
      const pb = stub();
      const create = jest.fn().mockRejectedValue(new Error("db error"));
      const prisma = {
        aIUsageLog: { create },
      };
      const result = factory(
        loader,
        pb,
        undefined,
        undefined,
        prisma,
        undefined,
      ) as {
        logUsage?: (params: {
          skillIds: string[];
          success: boolean;
          duration: number;
        }) => void;
      };
      result.logUsage!({ skillIds: ["skill-1"], success: false, duration: 50 });
      // Give promise microtask a chance to resolve
      await new Promise((r) => setTimeout(r, 10));
      expect(create).toHaveBeenCalled();
    });
  });

  describe("realtimeFeatureProvider", () => {
    const factory = getFactory(
      realtimeFeatureProvider as { useFactory?: FactoryFn },
    );

    it("returns undefined when eventEmitter missing", () => {
      expect(factory(undefined, stub())).toBeUndefined();
    });

    it("returns undefined when progressTracker missing", () => {
      expect(factory(stub(), undefined)).toBeUndefined();
    });

    it("returns RealtimeFeature when both present", () => {
      const ee = stub();
      const pt = stub();
      const result = factory(ee, pt) as {
        eventEmitter: unknown;
        progressTracker: unknown;
      };
      expect(result.eventEmitter).toBe(ee);
      expect(result.progressTracker).toBe(pt);
    });
  });

  describe("constraintFeatureProvider", () => {
    const factory = getFactory(
      constraintFeatureProvider as { useFactory?: FactoryFn },
    );

    it("returns undefined when rateLimiter missing", () => {
      expect(factory(undefined, stub())).toBeUndefined();
    });

    it("returns undefined when costController missing", () => {
      expect(factory(stub(), undefined)).toBeUndefined();
    });

    it("returns ConstraintFeature when both present", () => {
      const rl = stub();
      const cc = stub();
      const result = factory(rl, cc) as {
        rateLimiter: unknown;
        costController: unknown;
      };
      expect(result.rateLimiter).toBe(rl);
      expect(result.costController).toBe(cc);
    });
  });

  describe("teamsFeatureProvider", () => {
    const factory = getFactory(
      teamsFeatureProvider as { useFactory?: FactoryFn },
    );

    it("returns undefined when teamsService missing", () => {
      expect(factory(undefined, stub(), stub(), stub())).toBeUndefined();
    });

    it("returns TeamsFeature when teamsService present", () => {
      const ts = stub();
      const result = factory(ts, stub(), stub(), stub()) as {
        teamsService: unknown;
      };
      expect(result.teamsService).toBe(ts);
    });
  });

  describe("contentFeatureProvider", () => {
    const factory = getFactory(
      contentFeatureProvider as { useFactory?: FactoryFn },
    );

    it("returns undefined when all content deps missing", () => {
      expect(factory(undefined, undefined, undefined)).toBeUndefined();
    });

    it("returns ContentFeature when longContentEngine present", () => {
      const lce = stub();
      const result = factory(lce, undefined, undefined) as {
        longContentEngine: unknown;
      };
      expect(result.longContentEngine).toBe(lce);
    });

    it("returns ContentFeature when only contentFetch present", () => {
      const cf = stub();
      const result = factory(undefined, undefined, cf) as {
        contentFetch: unknown;
      };
      expect(result.contentFetch).toBe(cf);
    });
  });

  describe("knowledgeFeatureProvider", () => {
    const factory = getFactory(
      knowledgeFeatureProvider as { useFactory?: FactoryFn },
    );

    it("returns undefined when both missing", () => {
      expect(factory(undefined, undefined)).toBeUndefined();
    });

    it("returns KnowledgeFeature when embedding present", () => {
      const emb = stub();
      const result = factory(emb, undefined) as { embedding: unknown };
      expect(result.embedding).toBe(emb);
    });

    it("returns KnowledgeFeature when vector present", () => {
      const vec = stub();
      const result = factory(undefined, vec) as { vector: unknown };
      expect(result.vector).toBe(vec);
    });
  });

  describe("intelligenceFeatureProvider", () => {
    const factory = getFactory(
      intelligenceFeatureProvider as { useFactory?: FactoryFn },
    );

    it("returns undefined when all missing", () => {
      expect(factory(undefined, undefined, undefined)).toBeUndefined();
    });

    it("returns IntelligenceFeature when synthesisEngine present", () => {
      const se = stub();
      const result = factory(undefined, undefined, se) as {
        synthesisEngine: unknown;
      };
      expect(result.synthesisEngine).toBe(se);
    });
  });

  describe("collaborationFeatureProvider", () => {
    const factory = getFactory(
      collaborationFeatureProvider as { useFactory?: FactoryFn },
    );

    it("returns undefined when all missing", () => {
      expect(factory(undefined, undefined, undefined)).toBeUndefined();
    });

    it("returns CollaborationFeature when evidenceManager present", () => {
      const em = stub();
      const result = factory(em, undefined, undefined) as {
        evidenceManager: unknown;
      };
      expect(result.evidenceManager).toBe(em);
    });

    it("returns CollaborationFeature when a2aBus present", () => {
      const bus = stub();
      const result = factory(undefined, undefined, bus) as { a2aBus: unknown };
      expect(result.a2aBus).toBe(bus);
    });
  });

  describe("observabilityFeatureProvider", () => {
    const factory = getFactory(
      observabilityFeatureProvider as { useFactory?: FactoryFn },
    );

    it("returns undefined when both missing", () => {
      expect(factory(undefined, undefined)).toBeUndefined();
    });

    it("returns ObservabilityFeature when traceCollector present", () => {
      const tc = stub();
      const result = factory(tc, undefined) as { traceCollector: unknown };
      expect(result.traceCollector).toBe(tc);
    });

    it("returns ObservabilityFeature when memoryCoordinator present", () => {
      const mc = stub();
      const result = factory(undefined, mc) as { memoryCoordinator: unknown };
      expect(result.memoryCoordinator).toBe(mc);
    });
  });

  describe("registryFeatureProvider", () => {
    const factory = getFactory(
      registryFeatureProvider as { useFactory?: FactoryFn },
    );

    it("returns undefined when all missing", () => {
      expect(
        factory(undefined, undefined, undefined, undefined),
      ).toBeUndefined();
    });

    it("returns RegistryFeature when agent present", () => {
      const ar = stub();
      const result = factory(ar, undefined, undefined, undefined) as {
        agent: unknown;
      };
      expect(result.agent).toBe(ar);
    });

    it("returns RegistryFeature when skill present", () => {
      const sk = stub();
      const result = factory(undefined, undefined, undefined, sk) as {
        skill: unknown;
      };
      expect(result.skill).toBe(sk);
    });
  });
});
