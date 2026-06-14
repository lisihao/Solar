/**
 * ModelElectionService · 环境感知选举单元测试
 *
 * 覆盖：
 *  - 硬过滤：type 不匹配 / unhealthy / 黑名单
 *  - Tier 打分：TaskProfile 目标 tier 命中 vs 相邻 vs 远距
 *  - Role 偏好：leader → reasoning、researcher/writer → STRONG、extractor → BASIC
 *  - Cost bias：cheap / balanced / quality
 *  - Health：recentErrorRate 分档 + 硬过滤阈值
 *  - Tie-break：priority DESC → isDefault → stable lex
 *  - BYOK：providers 命中 / 空 fallback
 *  - REASONING 候选兼容 CHAT 请求
 *  - NoEligibleModelError：pool 空 / 全 type 不匹配 / 全 unhealthy
 *  - DB 全表 fallback：candidates 数组为空时
 */

import { Test, TestingModule } from "@nestjs/testing";
import { AIModelType } from "@prisma/client";
import { ModelElectionService } from "../model-election.service";
import { AiModelConfigService } from "../../config/ai-model-config.service";
import { KeyResolverService } from "@/modules/platform/credentials/resolution/key-resolver/key-resolver.service";
import {
  NoEligibleModelError,
  type ElectionCandidate,
  type ElectionRequest,
} from "../model-election.types";
import type { AIModelConfig } from "../../../services/ai-chat.service";

function makeConfig(overrides: Partial<AIModelConfig> = {}): AIModelConfig {
  return {
    id: `id-${overrides.modelId ?? "m"}`,
    name: overrides.modelId ?? "m",
    displayName: overrides.modelId ?? "m",
    provider: overrides.provider ?? "openai",
    modelId: overrides.modelId ?? "gpt-4o",
    apiEndpoint: "https://api.test/v1",
    apiKey: null,
    maxTokens: 8000,
    temperature: 0.7,
    isEnabled: true,
    isDefault: false,
    priority: 50,
    isReasoning: false,
    apiFormat: "openai",
    supportsTemperature: true,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsVision: false,
    tokenParamName: "max_tokens",
    defaultTimeoutMs: 120000,
    ...overrides,
  };
}

function cand(overrides: Partial<ElectionCandidate> = {}): ElectionCandidate {
  return {
    modelId: overrides.modelId ?? "gpt-4o",
    provider: overrides.provider ?? "openai",
    modelType: overrides.modelType ?? AIModelType.CHAT,
    healthy: overrides.healthy ?? true,
    recentErrorRate: overrides.recentErrorRate,
    costTier: overrides.costTier,
  };
}

describe("ModelElectionService", () => {
  let service: ModelElectionService;
  let modelConfigService: jest.Mocked<AiModelConfigService>;
  let keyResolver: jest.Mocked<KeyResolverService>;

  beforeEach(async () => {
    const modelConfigMock: Partial<jest.Mocked<AiModelConfigService>> = {
      getModelConfig: jest.fn(),
      getAllEnabledModelsByType: jest.fn(),
    };
    const keyResolverMock: Partial<jest.Mocked<KeyResolverService>> = {
      getAvailableProviders: jest.fn(),
      // 2026-05-12 BYOK fix: election Step 3 现在调 getHealthyProviders（叠
      //   KeyHealthStore.filterUsable，剔除 quota-exhausted/dead 的 provider）
      getHealthyProviders: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModelElectionService,
        { provide: AiModelConfigService, useValue: modelConfigMock },
        { provide: KeyResolverService, useValue: keyResolverMock },
      ],
    }).compile();

    service = module.get(ModelElectionService);
    modelConfigService = module.get(AiModelConfigService);
    keyResolver = module.get(KeyResolverService);
  });

  const baseRequest = (
    patch: Partial<ElectionRequest> = {},
  ): ElectionRequest => ({
    modelType: AIModelType.CHAT,
    candidates: [],
    ...patch,
  });

  describe("硬过滤", () => {
    it("type 不匹配的候选被过滤", async () => {
      modelConfigService.getModelConfig.mockResolvedValue(
        makeConfig({ modelId: "text-embedding-3-large" }),
      );
      await expect(
        service.elect(
          baseRequest({
            candidates: [
              cand({
                modelId: "text-embedding-3-large",
                modelType: AIModelType.EMBEDDING,
              }),
            ],
          }),
        ),
      ).rejects.toThrow(NoEligibleModelError);
    });

    it("unhealthy 候选被硬过滤（healthy=false）", async () => {
      await expect(
        service.elect(
          baseRequest({
            candidates: [cand({ modelId: "gpt-4o", healthy: false })],
          }),
        ),
      ).rejects.toThrow(NoEligibleModelError);
    });

    it("recentErrorRate >= 0.5 被硬过滤", async () => {
      await expect(
        service.elect(
          baseRequest({
            candidates: [cand({ modelId: "gpt-4o", recentErrorRate: 0.6 })],
          }),
        ),
      ).rejects.toThrow(NoEligibleModelError);
    });

    it("黑名单模型被排除", async () => {
      modelConfigService.getModelConfig.mockResolvedValue(
        makeConfig({ modelId: "claude-sonnet-4-0" }),
      );
      const res = await service.elect(
        baseRequest({
          candidates: [
            cand({ modelId: "gpt-4o" }),
            cand({ modelId: "claude-sonnet-4-0", provider: "anthropic" }),
          ],
          excludeModelIds: ["gpt-4o"],
        }),
      );
      expect(res.elected.modelId).toBe("claude-sonnet-4-0");
    });

    it("无 type 匹配候选时抛 NoEligibleModelError，包含统计细节", async () => {
      // type 不匹配 → typeMatched=0 → 无 last-resort 可退 → 仍按统计细节硬抛
      try {
        await service.elect(
          baseRequest({
            candidates: [
              cand({ modelId: "emb", modelType: AIModelType.EMBEDDING }),
            ],
          }),
        );
        fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(NoEligibleModelError);
        const e = err as NoEligibleModelError;
        expect(e.message).toContain("pool=1");
        expect(e.message).toContain("healthy=0");
      }
    });

    it("唯一候选不健康时退回 last-resort 而非硬抛（单模型保命）", async () => {
      // ★ 2026-05-22 单模型部署根因修复：唯一模型 errorRate≥0.5 / unhealthy 时
      //   不再清空抛 NoEligibleModelError 把整个 mission 判废，而是退回该候选（降级），
      //   交给上层 react-loop 退避重试。
      modelConfigService.getModelConfig.mockResolvedValue(
        makeConfig({ modelId: "grok-4-1-fast", provider: "xai" }),
      );
      const res = await service.elect(
        baseRequest({
          candidates: [
            cand({
              modelId: "grok-4-1-fast",
              provider: "xai",
              recentErrorRate: 0.9,
            }),
          ],
        }),
      );
      expect(res.elected.modelId).toBe("grok-4-1-fast");
    });

    it("有健康候选时不触发 last-resort：跳过不健康只选健康", async () => {
      modelConfigService.getModelConfig.mockImplementation((id: string) =>
        Promise.resolve(makeConfig({ modelId: id })),
      );
      const res = await service.elect(
        baseRequest({
          candidates: [
            cand({ modelId: "bad-m", recentErrorRate: 0.9 }),
            cand({ modelId: "healthy-m", recentErrorRate: 0.0 }),
          ],
        }),
      );
      expect(res.elected.modelId).toBe("healthy-m");
    });
  });

  describe("Tier 打分 (targetTier 来自 TaskProfile)", () => {
    it("creativity=high+outputLength=long → 目标 STRONG，STRONG 候选胜出", async () => {
      modelConfigService.getModelConfig.mockImplementation((id: string) => {
        if (id === "gpt-4o-mini")
          return Promise.resolve(makeConfig({ modelId: "gpt-4o-mini" }));
        if (id === "claude-opus-4-0")
          return Promise.resolve(
            makeConfig({ modelId: "claude-opus-4-0", provider: "anthropic" }),
          );
        return Promise.resolve(null);
      });

      const res = await service.elect(
        baseRequest({
          candidates: [
            cand({ modelId: "gpt-4o-mini" }),
            cand({ modelId: "claude-opus-4-0", provider: "anthropic" }),
          ],
          taskProfile: { creativity: "high", outputLength: "long" },
        }),
      );
      expect(res.elected.modelId).toBe("claude-opus-4-0");
    });

    it("creativity=deterministic+outputLength=minimal → 目标 BASIC，BASIC 候选胜出", async () => {
      modelConfigService.getModelConfig.mockImplementation((id: string) => {
        if (id === "gpt-4o-mini")
          return Promise.resolve(makeConfig({ modelId: "gpt-4o-mini" }));
        if (id === "claude-opus-4-0")
          return Promise.resolve(
            makeConfig({ modelId: "claude-opus-4-0", provider: "anthropic" }),
          );
        return Promise.resolve(null);
      });

      const res = await service.elect(
        baseRequest({
          candidates: [
            cand({ modelId: "gpt-4o-mini" }),
            cand({ modelId: "claude-opus-4-0", provider: "anthropic" }),
          ],
          taskProfile: { creativity: "deterministic", outputLength: "minimal" },
        }),
      );
      // gpt-4o-mini 是 STANDARD（不是 BASIC），但比 STRONG 离 BASIC 更近
      expect(res.elected.modelId).toBe("gpt-4o-mini");
    });
  });

  describe("Role 偏好", () => {
    it("role=leader: reasoning 模型胜出（即使 tier 非 STRONG）", async () => {
      modelConfigService.getModelConfig.mockImplementation((id: string) => {
        if (id === "gpt-4o")
          return Promise.resolve(
            makeConfig({ modelId: "gpt-4o", isReasoning: false }),
          );
        if (id === "deepseek-r1")
          return Promise.resolve(
            makeConfig({
              modelId: "deepseek-r1",
              provider: "deepseek",
              isReasoning: true,
            }),
          );
        return Promise.resolve(null);
      });

      const res = await service.elect(
        baseRequest({
          candidates: [
            cand({ modelId: "gpt-4o" }),
            cand({ modelId: "deepseek-r1", provider: "deepseek" }),
          ],
          role: "leader",
        }),
      );
      expect(res.elected.modelId).toBe("deepseek-r1");
    });

    // 2026-05-10 §3 反 multi-model 坍缩：writer 反偏 reasoning，reviewer 偏 reasoning
    it("role=writer: 同 STRONG tier 下非 reasoning 模型胜出（叙事型 STRONG 优先）", async () => {
      modelConfigService.getModelConfig.mockImplementation((id: string) => {
        if (id === "grok-3-latest")
          return Promise.resolve(
            makeConfig({
              modelId: "grok-3-latest",
              provider: "xai",
              isReasoning: false,
              priority: 50,
            }),
          );
        if (id === "deepseek-r1")
          return Promise.resolve(
            makeConfig({
              modelId: "deepseek-r1",
              provider: "deepseek",
              isReasoning: true,
              priority: 50,
            }),
          );
        return Promise.resolve(null);
      });

      const res = await service.elect(
        baseRequest({
          candidates: [
            cand({ modelId: "grok-3-latest", provider: "xai" }),
            cand({ modelId: "deepseek-r1", provider: "deepseek" }),
          ],
          role: "writer",
        }),
      );
      // writer + STRONG: 非 reasoning +18，reasoning +8 → grok 胜
      expect(res.elected.modelId).toBe("grok-3-latest");
    });

    it("role=reviewer: 同 STRONG tier 下 reasoning 模型胜出（批判性思考优先）", async () => {
      modelConfigService.getModelConfig.mockImplementation((id: string) => {
        if (id === "grok-3-latest")
          return Promise.resolve(
            makeConfig({
              modelId: "grok-3-latest",
              provider: "xai",
              isReasoning: false,
              priority: 80, // 高 priority 模拟用户复盘的 prod 场景
            }),
          );
        if (id === "deepseek-r1")
          return Promise.resolve(
            makeConfig({
              modelId: "deepseek-r1",
              provider: "deepseek",
              isReasoning: true,
              priority: 50,
            }),
          );
        return Promise.resolve(null);
      });

      const res = await service.elect(
        baseRequest({
          candidates: [
            cand({ modelId: "grok-3-latest", provider: "xai" }),
            cand({ modelId: "deepseek-r1", provider: "deepseek" }),
          ],
          role: "reviewer",
        }),
      );
      // reviewer + STRONG: reasoning +18 vs 非 reasoning +12（差 6 分），即使
      // grok 有 priority +3 优势仍敌不过 reasoning 加分 → deepseek-r1 胜
      expect(res.elected.modelId).toBe("deepseek-r1");
    });

    it("role=researcher: 同 STRONG tier 下轻微偏非 reasoning，但仍保留强模型分布空间", async () => {
      modelConfigService.getModelConfig.mockImplementation((id: string) => {
        if (id === "grok-4-1-fast-reasoning")
          return Promise.resolve(
            makeConfig({
              modelId: "grok-4-1-fast-reasoning",
              provider: "xai",
              isReasoning: false,
              priority: 50,
            }),
          );
        if (id === "deepseek-v4-pro")
          return Promise.resolve(
            makeConfig({
              modelId: "deepseek-v4-pro",
              provider: "deepseek",
              isReasoning: true,
              priority: 50,
            }),
          );
        return Promise.resolve(null);
      });

      const res = await service.elect(
        baseRequest({
          candidates: [
            cand({
              modelId: "grok-4-1-fast-reasoning",
              provider: "xai",
            }),
            cand({ modelId: "deepseek-v4-pro", provider: "deepseek" }),
          ],
          role: "researcher",
        }),
      );

      expect(res.elected.modelId).toBe("grok-4-1-fast-reasoning");
      const deepseekScore = res.scores.find(
        (score) => score.modelId === "deepseek-v4-pro",
      );
      const grokScore = res.scores.find(
        (score) => score.modelId === "grok-4-1-fast-reasoning",
      );
      expect(grokScore?.breakdown.role).toBe(16);
      expect(deepseekScore?.breakdown.role).toBe(14);
    });

    // 2026-05-10 §3 通用机制：mission-scoped diversity（无状态选举的反坍缩）
    it("previouslyElected: 同 modelId 选过 N 次 → 扣 -10 × N，让多次同 shape 选举分散", async () => {
      modelConfigService.getModelConfig.mockImplementation((id: string) => {
        if (id === "grok-3-latest")
          return Promise.resolve(
            makeConfig({
              modelId: "grok-3-latest",
              provider: "xai",
              isReasoning: false,
              priority: 80, // 模拟 admin 给 grok 高 priority 的 prod 场景
            }),
          );
        if (id === "deepseek-r1")
          return Promise.resolve(
            makeConfig({
              modelId: "deepseek-r1",
              provider: "deepseek",
              isReasoning: true,
              priority: 50,
            }),
          );
        return Promise.resolve(null);
      });

      const candidates = [
        cand({ modelId: "grok-3-latest", provider: "xai" }),
        cand({ modelId: "deepseek-r1", provider: "deepseek" }),
      ];

      // 第 1 次选举（无前序）：role=default 让 priority 主导 → grok 胜
      const r1 = await service.elect(
        baseRequest({ candidates, role: "default" }),
      );
      expect(r1.elected.modelId).toBe("grok-3-latest");

      // 第 2 次选举：把 grok-3 加入 previouslyElected → grok 扣 10 分 →
      // deepseek-r1 反超
      const r2 = await service.elect(
        baseRequest({
          candidates,
          role: "default",
          previouslyElected: ["grok-3-latest"],
        }),
      );
      expect(r2.elected.modelId).toBe("deepseek-r1");

      // 第 3 次：grok 已选 1 次 + deepseek 已选 1 次 → 各扣 10 分相互抵消，
      // 决胜回到 priority → grok 又胜
      const r3 = await service.elect(
        baseRequest({
          candidates,
          role: "default",
          previouslyElected: ["grok-3-latest", "deepseek-r1"],
        }),
      );
      expect(r3.elected.modelId).toBe("grok-3-latest");
    });

    it("previouslyElected 空数组 → diversityScore=0 → 行为退化为无 diversity", async () => {
      modelConfigService.getModelConfig.mockResolvedValue(
        makeConfig({ modelId: "gpt-4o" }),
      );
      const res = await service.elect(
        baseRequest({
          candidates: [cand({ modelId: "gpt-4o" })],
          previouslyElected: [],
        }),
      );
      const breakdown = res.scores[0].breakdown;
      expect(breakdown.diversity).toBe(0);
    });

    it("role=extractor: BASIC 候选比 STRONG 多 10 分", async () => {
      modelConfigService.getModelConfig.mockImplementation((id: string) => {
        if (id === "gpt-4o-mini")
          return Promise.resolve(makeConfig({ modelId: "gpt-4o-mini" }));
        if (id === "gpt-4o")
          return Promise.resolve(makeConfig({ modelId: "gpt-4o" }));
        return Promise.resolve(null);
      });

      const res = await service.elect(
        baseRequest({
          candidates: [
            cand({ modelId: "gpt-4o" }),
            cand({ modelId: "gpt-4o-mini" }),
          ],
          role: "extractor",
        }),
      );
      // gpt-4o-mini 是 STANDARD — role extractor 给 STANDARD +5，BASIC +10
      // 但 gpt-4o (STRONG) 与 BASIC 相邻 score=10；相对取决于 priority tie。
      // 这里 role score：STANDARD=5，STRONG=0；+ tier(STANDARD=10)/( STRONG target BASIC = 0 )
      expect(res.elected.modelId).toBe("gpt-4o-mini");
    });
  });

  describe("Cost bias", () => {
    it("costBias=cheap 下 cheap 候选赢", async () => {
      modelConfigService.getModelConfig.mockImplementation((id: string) => {
        if (id === "gpt-4o-mini")
          return Promise.resolve(makeConfig({ modelId: "gpt-4o-mini" }));
        if (id === "gpt-4o")
          return Promise.resolve(makeConfig({ modelId: "gpt-4o" }));
        return Promise.resolve(null);
      });

      const res = await service.elect(
        baseRequest({
          candidates: [
            cand({ modelId: "gpt-4o", costTier: "strong" }),
            cand({ modelId: "gpt-4o-mini", costTier: "basic" }),
          ],
          costBias: "cheap",
        }),
      );
      expect(res.elected.modelId).toBe("gpt-4o-mini");
    });

    it("costBias=quality 下 premium 候选赢", async () => {
      modelConfigService.getModelConfig.mockImplementation((id: string) => {
        if (id === "gpt-4o-mini")
          return Promise.resolve(makeConfig({ modelId: "gpt-4o-mini" }));
        if (id === "claude-opus-4-0")
          return Promise.resolve(
            makeConfig({ modelId: "claude-opus-4-0", provider: "anthropic" }),
          );
        return Promise.resolve(null);
      });

      const res = await service.elect(
        baseRequest({
          candidates: [
            cand({ modelId: "gpt-4o-mini", costTier: "basic" }),
            cand({
              modelId: "claude-opus-4-0",
              provider: "anthropic",
              costTier: "strong",
            }),
          ],
          costBias: "quality",
        }),
      );
      expect(res.elected.modelId).toBe("claude-opus-4-0");
    });
  });

  describe("Health 打分", () => {
    it("错误率 0 > 错误率 0.1 > 错误率 0.3", async () => {
      modelConfigService.getModelConfig.mockImplementation((id: string) =>
        Promise.resolve(makeConfig({ modelId: id })),
      );

      const res = await service.elect(
        baseRequest({
          candidates: [
            cand({ modelId: "a-premium", recentErrorRate: 0.3 }),
            cand({ modelId: "b-premium", recentErrorRate: 0.0 }),
            cand({ modelId: "c-premium", recentErrorRate: 0.1 }),
          ],
        }),
      );
      expect(res.elected.modelId).toBe("b-premium");
    });
  });

  describe("Tie-break", () => {
    it("同分时 priority 高者胜", async () => {
      modelConfigService.getModelConfig.mockImplementation((id: string) => {
        if (id === "low-prio")
          return Promise.resolve(
            makeConfig({ modelId: "low-prio", priority: 10 }),
          );
        if (id === "high-prio")
          return Promise.resolve(
            makeConfig({ modelId: "high-prio", priority: 90 }),
          );
        return Promise.resolve(null);
      });

      const res = await service.elect(
        baseRequest({
          candidates: [
            cand({ modelId: "low-prio" }),
            cand({ modelId: "high-prio" }),
          ],
        }),
      );
      expect(res.elected.modelId).toBe("high-prio");
    });

    it("priority 也平时 isDefault=true 胜", async () => {
      modelConfigService.getModelConfig.mockImplementation((id: string) => {
        if (id === "b-model")
          return Promise.resolve(
            makeConfig({ modelId: "b-model", isDefault: true }),
          );
        if (id === "a-model")
          return Promise.resolve(
            makeConfig({ modelId: "a-model", isDefault: false }),
          );
        return Promise.resolve(null);
      });

      const res = await service.elect(
        baseRequest({
          candidates: [
            cand({ modelId: "a-model" }),
            cand({ modelId: "b-model" }),
          ],
        }),
      );
      expect(res.elected.modelId).toBe("b-model");
    });
  });

  describe("BYOK 过滤", () => {
    it("userId 存在 + keyResolver 返回 healthy providers → 按 provider 过滤", async () => {
      keyResolver.getHealthyProviders.mockResolvedValue(["anthropic"]);
      modelConfigService.getModelConfig.mockImplementation((id: string) => {
        if (id === "gpt-4o")
          return Promise.resolve(makeConfig({ modelId: "gpt-4o" }));
        if (id === "claude-sonnet-4-0")
          return Promise.resolve(
            makeConfig({
              modelId: "claude-sonnet-4-0",
              provider: "anthropic",
            }),
          );
        return Promise.resolve(null);
      });

      const res = await service.elect(
        baseRequest({
          candidates: [
            cand({ modelId: "gpt-4o" }),
            cand({ modelId: "claude-sonnet-4-0", provider: "anthropic" }),
          ],
          userId: "user-001",
        }),
      );
      expect(res.elected.modelId).toBe("claude-sonnet-4-0");
    });

    it("BYOK 过滤后池为空 → 降级回全量（让下游抛 BYOK 错误）", async () => {
      keyResolver.getHealthyProviders.mockResolvedValue(["mistral"]);
      modelConfigService.getModelConfig.mockResolvedValue(
        makeConfig({ modelId: "gpt-4o" }),
      );

      const res = await service.elect(
        baseRequest({
          candidates: [cand({ modelId: "gpt-4o" })],
          userId: "user-001",
        }),
      );
      // 回落到全量池，所以仍然能选出来
      expect(res.elected.modelId).toBe("gpt-4o");
    });

    // 2026-05-12 BYOK fix: quota-exhausted provider 整体剔除（核心场景）
    it("quota-exhausted provider（getHealthyProviders 不返回）整条剔除 → 不选该 provider 模型", async () => {
      // 用户配了 grok 和 deepseek 两把 key，但 deepseek 已 quota exhausted
      //   → getHealthyProviders 只返回 ["xai"]（grok 那把还能用）
      //   → election 不应再选 deepseek-reasoner，避免下游 chat 调 deepseek 又炸
      keyResolver.getHealthyProviders.mockResolvedValue(["xai"]);
      modelConfigService.getModelConfig.mockImplementation((id: string) => {
        if (id === "grok-4-1-fast-reasoning")
          return Promise.resolve(
            makeConfig({
              modelId: "grok-4-1-fast-reasoning",
              provider: "xai",
              isReasoning: true,
            }),
          );
        if (id === "deepseek-reasoner")
          return Promise.resolve(
            makeConfig({
              modelId: "deepseek-reasoner",
              provider: "deepseek",
              isReasoning: true,
            }),
          );
        return Promise.resolve(null);
      });

      const res = await service.elect(
        baseRequest({
          candidates: [
            cand({
              modelId: "grok-4-1-fast-reasoning",
              provider: "xai",
              costTier: "standard",
            }),
            // deepseek-reasoner 在候选池里且 isReasoning 让 role 评分更高 + 便宜，
            // 没有 health 过滤会被打分压过 grok
            cand({
              modelId: "deepseek-reasoner",
              provider: "deepseek",
              costTier: "basic",
            }),
          ],
          userId: "user-001",
        }),
      );
      expect(res.elected.modelId).toBe("grok-4-1-fast-reasoning");
    });
  });

  describe("REASONING 候选兼容 CHAT 请求", () => {
    it("candidate.modelType=REASONING 对 modelType=CHAT 请求被接受", async () => {
      modelConfigService.getModelConfig.mockResolvedValue(
        makeConfig({
          modelId: "deepseek-r1",
          provider: "deepseek",
          isReasoning: true,
        }),
      );
      const res = await service.elect(
        baseRequest({
          candidates: [
            cand({
              modelId: "deepseek-r1",
              provider: "deepseek",
              modelType: "REASONING",
            }),
          ],
          role: "leader",
        }),
      );
      expect(res.elected.modelId).toBe("deepseek-r1");
    });
  });

  describe("DB 全表 fallback", () => {
    it("candidates 数组为空时退化到 DB 全表查询", async () => {
      modelConfigService.getAllEnabledModelsByType.mockResolvedValue([
        makeConfig({ modelId: "gpt-4o" }),
      ]);
      modelConfigService.getModelConfig.mockResolvedValue(
        makeConfig({ modelId: "gpt-4o" }),
      );

      const res = await service.elect(
        baseRequest({
          candidates: [],
        }),
      );
      expect(res.elected.modelId).toBe("gpt-4o");
      expect(modelConfigService.getAllEnabledModelsByType).toHaveBeenCalledWith(
        AIModelType.CHAT,
      );
    });
  });

  describe("Score breakdown observability", () => {
    it("返回结果包含所有候选的完整打分", async () => {
      modelConfigService.getModelConfig.mockImplementation((id: string) =>
        Promise.resolve(makeConfig({ modelId: id })),
      );

      const res = await service.elect(
        baseRequest({
          candidates: [
            cand({ modelId: "gpt-4o" }),
            cand({ modelId: "gpt-4o-mini" }),
          ],
        }),
      );
      expect(res.scores).toHaveLength(2);
      expect(res.scores[0]).toHaveProperty("breakdown.tier");
      expect(res.scores[0]).toHaveProperty("breakdown.role");
      expect(res.scores[0]).toHaveProperty("breakdown.cost");
      expect(res.scores[0]).toHaveProperty("breakdown.health");
      expect(res.scores[0]).toHaveProperty("breakdown.priority");
      expect(res.scores[0]).toHaveProperty("breakdown.isDefault");
      expect(res.reason).toContain("elected=");
    });
  });
});
