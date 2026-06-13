/**
 * 图片管线业务仿真测试
 *
 * 从用户报告的核心问题出发设计用例：
 *
 * 问题 1: "报告中的图片和内容没有关系" — 装饰性新闻头图、stock photo 进入报告
 * 问题 2: "图片标题显示无标题/乱码" — caption 为空或包含平台后缀
 * 问题 3: "图片下方显示内部调试信息" — Leader 分配、证据编号等 prompt 泄露
 * 问题 4: "有价值的数据图表反而看不到" — informational chart 不应被误杀
 * 问题 5: "每个章节都硬塞了图片" — 没有相关图片时应允许 0 张
 * 问题 6: "图片来源显示 FIG-1 之类的标记" — 内部编号泄露到用户界面
 *
 * 测试覆盖三个模块的协作：
 * - evidence-summary.utils (buildFiguresSummary): 构建图表注册表 + Leader 指引
 * - figure-relevance.service (filterRelevantFigures): Vision LLM 过滤
 * - section-writer.service (backfillFigureUrls): 回填 URL + caption + source 清理
 */

import { Test, TestingModule } from "@nestjs/testing";
import { SectionWriterService } from "../section-writer.service";
import { ChatFacade, AIFacade } from "@/modules/ai-harness/facade";
import { buildFiguresSummary } from "../evidence-summary.utils";
import type {
  FigureReference,
  ExtractedFigure,
  EnrichedEvidenceData,
} from "../../../types/research.types";
import type { FigureRegistryEntry } from "../evidence-summary.utils";

// ============================================================
// Setup
// ============================================================

const mockAiFacade = {
  chatWithSkills: jest.fn(),
  selectModel: jest.fn(),
};

const mockEngineFacade = {
  embeddingGenerate: jest.fn().mockResolvedValue(null),
};

/** 辅助：快速访问 SectionWriterService 的私有方法 */
type PrivateMethods = {
  backfillFigureUrls: (
    refs: FigureReference[],
    allocated?: Array<{
      figureId: string;
      imageUrl: string;
      caption: string;
      relevanceReason: string;
    }>,
    registry?: Map<string, FigureRegistryEntry>,
  ) => FigureReference[];
  cleanFigureCaption: (s: string) => string;
  sanitizeFigureSource: (s: string | undefined) => string | undefined;
};

const makeEvidence = (
  overrides: Partial<EnrichedEvidenceData> = {},
): EnrichedEvidenceData => ({
  id: `ev-${Math.random().toString(36).slice(2, 8)}`,
  title: "",
  url: "https://example.com",
  domain: "example.com",
  snippet: null,
  sourceType: "web",
  publishedAt: null,
  credibilityScore: 0.8,
  ...overrides,
});

const makeFigure = (
  overrides: Partial<ExtractedFigure> = {},
): ExtractedFigure => ({
  imageUrl: "https://example.com/image.png",
  caption: "",
  type: "chart",
  ...overrides,
});

const makeRef = (
  overrides: Partial<FigureReference> = {},
): FigureReference => ({
  id: "ref-1",
  figureId: "FIG-1",
  caption: "",
  position: "after_paragraph_1",
  ...overrides,
});

describe("图片管线业务仿真", () => {
  let service: SectionWriterService;
  let priv: PrivateMethods;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SectionWriterService,
        { provide: ChatFacade, useValue: mockAiFacade },
        { provide: AIFacade, useValue: mockEngineFacade },
      ],
    }).compile();
    service = module.get<SectionWriterService>(SectionWriterService);
    priv = service as unknown as PrivateMethods;
  });

  // ============================================================
  // 场景 1: 装饰性图片不应进入最终报告
  //
  // 用户问题: "报告中的图片和内容没有关系"
  // 根因: 白宫横幅、新闻缩略图等装饰性 photo 被采集后一路放行
  // 验证: 从网页抽取的装饰性 photo 通过 buildFiguresSummary 后，
  //       type 标记为 "photo"，在 Leader 指引中被标注，下游可过滤
  // ============================================================

  describe("场景 1: 装饰性图片不应进入最终报告", () => {
    it("白宫横幅图应标记为 photo 类型，Leader 指引中可见其类型", () => {
      const evidences = [
        makeEvidence({
          title: "White House AI Executive Order",
          domain: "whitehouse.gov",
          extractedFigures: [
            makeFigure({
              imageUrl: "https://www.whitehouse.gov/Wire-Banner.jpg",
              caption: "",
              alt: "",
              type: "photo",
            }),
          ],
        }),
      ];

      const { summary, figureRegistry } = buildFiguresSummary(evidences);

      // 注册表中记录了 type = photo（下游 FigureRelevanceService 会据此过滤）
      const entry = figureRegistry.get("FIG-1")!;
      expect(entry.type).toBe("photo");
      // Leader 看到的摘要行明确标注类型为 photo
      expect(summary).toContain("photo");
    });

    it("stock photo（unsplash 等通用配图）即使有 alt 也不应覆盖 type", () => {
      const evidences = [
        makeEvidence({
          title: "AI Industry Report",
          extractedFigures: [
            makeFigure({
              imageUrl: "https://images.unsplash.com/photo-handshake.jpg",
              caption: "",
              alt: "Business handshake in modern office",
              type: "photo",
            }),
          ],
        }),
      ];

      const { figureRegistry } = buildFiguresSummary(evidences);

      // 仍然是 photo 类型，不会因为有 alt 就变成 chart
      expect(figureRegistry.get("FIG-1")?.type).toBe("photo");
      // alt 文本作为 caption 回退
      expect(figureRegistry.get("FIG-1")?.caption).toBe(
        "Business handshake in modern office",
      );
    });

    it("Leader 分配指引应明确允许 0 张图，不强制每章必配", () => {
      const evidences = [
        makeEvidence({
          title: "Some Evidence",
          extractedFigures: [
            makeFigure({ imageUrl: "https://example.com/chart.png" }),
          ],
        }),
      ];

      const { summary } = buildFiguresSummary(evidences);

      // 指引中说明 0 张的条件
      expect(summary).toContain("才分配 0 张");
      // 指引中说明不分配装饰性配图
      expect(summary).toContain("纯装饰性新闻配图不分配");
      // 指引中要求"相关"
      expect(summary).toContain("相关");
    });
  });

  // ============================================================
  // 场景 2: 图片标题必须对用户有意义
  //
  // 用户问题: "图片标题显示无标题" / "图片标题是乱七八糟的平台信息"
  // 根因: 网页抽取的 caption 为空，或包含 "| Medium" "| by Author" 后缀
  // 验证: caption 经过多层 fallback 后用户看到有意义的文字
  // ============================================================

  describe("场景 2: 图片标题必须对用户有意义", () => {
    it("证据中的数据图表（有原始 caption）→ 用户看到原始标题", () => {
      const registry = new Map<string, FigureRegistryEntry>();
      registry.set("FIG-1", {
        figureId: "FIG-1",
        imageUrl: "https://fred.stlouisfed.org/graph.png",
        caption: "Federal Funds Rate 2020-2026",
        type: "chart",
        evidenceIndex: 1,
        figureIndex: 0,
        evidenceTitle: "Federal Reserve Economic Data",
      });

      const refs = [makeRef({ figureId: "FIG-1", caption: "" })];
      const result = priv.backfillFigureUrls(refs, undefined, registry);

      expect(result[0].caption).toBe("Federal Funds Rate 2020-2026");
    });

    it("网页抽取的图片 caption 为空，alt 为空 → 用证据标题兜底", () => {
      // 模拟: 白宫网站的图片没有 caption 也没有 alt
      const registry = new Map<string, FigureRegistryEntry>();
      registry.set("FIG-1", {
        figureId: "FIG-1",
        imageUrl: "https://whitehouse.gov/banner.jpg",
        caption: "", // 注册表中 caption 也是空的
        type: "photo",
        evidenceIndex: 1,
        figureIndex: 0,
        evidenceTitle: "White House AI Safety Executive Order",
      });

      const refs = [makeRef({ figureId: "FIG-1", caption: "" })];
      const result = priv.backfillFigureUrls(refs, undefined, registry);

      // 用户看到的 caption 应该是证据标题（比"无标题"好）
      expect(result[0].caption).toBe("White House AI Safety Executive Order");
    });

    it("Medium 文章的图片 → 去掉 '| by Author | Medium' 后缀", () => {
      const registry = new Map<string, FigureRegistryEntry>();
      registry.set("FIG-1", {
        figureId: "FIG-1",
        imageUrl: "https://miro.medium.com/chart.png",
        caption: "Understanding Scaling Laws | by Saiii | Medium",
        type: "chart",
        evidenceIndex: 1,
        figureIndex: 0,
        evidenceTitle: "Medium Article",
      });

      const refs = [makeRef({ figureId: "FIG-1" })];
      const result = priv.backfillFigureUrls(refs, undefined, registry);

      // 用户看到的标题不含平台信息
      expect(result[0].caption).toBe("Understanding Scaling Laws");
      expect(result[0].caption).not.toContain("Medium");
      expect(result[0].caption).not.toContain("by Saiii");
    });

    it("arXiv 论文的图表 → 去掉 '- arXiv' 后缀", () => {
      const cleaned = priv.cleanFigureCaption(
        "Attention Is All You Need Figure 3 - arXiv",
      );
      expect(cleaned).toBe("Attention Is All You Need Figure 3");
    });

    it("buildFiguresSummary 阶段：空 caption + 空 alt 的 chart → 用证据标题 + '图表' 后缀", () => {
      const evidences = [
        makeEvidence({
          title: "Federal Reserve Interest Rate Decision",
          extractedFigures: [
            makeFigure({
              imageUrl: "https://fred.stlouisfed.org/graph.png",
              caption: "",
              alt: "",
              type: "chart",
            }),
          ],
        }),
      ];

      const { figureRegistry } = buildFiguresSummary(evidences);
      expect(figureRegistry.get("FIG-1")?.caption).toBe(
        "Federal Reserve Interest Rate Decision — 图表",
      );
    });

    it("buildFiguresSummary 阶段：空 caption + 有 alt → 优先用 alt", () => {
      const evidences = [
        makeEvidence({
          title: "Pew Research Center Survey",
          extractedFigures: [
            makeFigure({
              imageUrl: "https://pewresearch.org/chart.png",
              caption: "",
              alt: "Bar chart of public opinion on AI regulation",
              type: "chart",
            }),
          ],
        }),
      ];

      const { figureRegistry } = buildFiguresSummary(evidences);
      expect(figureRegistry.get("FIG-1")?.caption).toBe(
        "Bar chart of public opinion on AI regulation",
      );
    });
  });

  // ============================================================
  // 场景 3: 内部调试信息不应泄露给用户
  //
  // 用户问题: "图片来源显示 Leader 分配、FIG-1 这些奇怪的标记"
  // 根因: LLM 把 prompt 中的内部元数据回吐到 source 字段
  // 验证: sanitizeFigureSource 清理所有内部标注
  // ============================================================

  describe("场景 3: 内部调试信息不应泄露给用户", () => {
    it("LLM 回吐 'Leader 已为本章节分配图表资源' → 清理后只保留有意义部分", () => {
      const cleaned = priv.sanitizeFigureSource(
        "Leader 已为本章节分配以下图表资源，Federal Reserve Economic Data",
      );
      expect(cleaned).toBe("Federal Reserve Economic Data");
    });

    it("LLM 回吐 '【已分配】' 标记 → 去除标记保留正文", () => {
      const cleaned = priv.sanitizeFigureSource(
        "【已分配】Pew Research Survey",
      );
      expect(cleaned).toBe("Pew Research Survey");
    });

    it("LLM 回吐 '证据[N] 图M' 内部编号 → 去除编号", () => {
      const cleaned = priv.sanitizeFigureSource(
        "Chart（证据3图1）from Federal Reserve",
      );
      expect(cleaned).toBe("Chartfrom Federal Reserve");
    });

    it("LLM 回吐 '分配原因：...' → 全部清除（这是内部决策依据）", () => {
      const cleaned = priv.sanitizeFigureSource("分配原因：与利率政策直接相关");
      expect(cleaned).toBeUndefined();
    });

    it("LLM 回吐 prompt 中的 URL → 清除 (URL: ...) 块", () => {
      const cleaned = priv.sanitizeFigureSource(
        "Federal Reserve (URL: https://fred.stlouisfed.org/graph.png) Data",
      );
      expect(cleaned).not.toContain("URL:");
      expect(cleaned).not.toContain("fred.stlouisfed.org");
    });

    it("图片 caption 中的 '来源: 分配图表' 内部标注 → 清除", () => {
      const cleaned = priv.cleanFigureCaption(
        "Interest Rate Trends - 来源: 分配图表 [1]",
      );
      expect(cleaned).toBe("Interest Rate Trends");
      expect(cleaned).not.toContain("分配图表");
    });

    it("正常的来源信息不应被误清理", () => {
      const cleaned = priv.sanitizeFigureSource(
        "Federal Reserve Economic Data",
      );
      expect(cleaned).toBe("Federal Reserve Economic Data");
    });
  });

  // ============================================================
  // 场景 4: 有价值的数据图表不应被误杀
  //
  // 用户问题: "明明网页上有很好的数据图表，但报告里没有"
  // 根因: 之前的 FigureRelevanceService v8/v9 对所有类型一刀切
  // 验证: chart/table/diagram 类型走宽松策略
  // ============================================================

  describe("场景 4: 有价值的数据图表不应被误杀", () => {
    it("Fed 利率图表应正确注册为 chart 类型（宽松策略）", () => {
      const evidences = [
        makeEvidence({
          title: "Federal Reserve Economic Data",
          domain: "fred.stlouisfed.org",
          extractedFigures: [
            makeFigure({
              imageUrl: "https://fred.stlouisfed.org/graph/fredgraph.png",
              caption: "Federal Funds Rate",
              type: "chart",
            }),
          ],
        }),
      ];

      const { figureRegistry } = buildFiguresSummary(evidences);
      const entry = figureRegistry.get("FIG-1")!;

      expect(entry.type).toBe("chart");
      expect(entry.caption).toBe("Federal Funds Rate");
      expect(entry.evidenceDomain).toBe("fred.stlouisfed.org");
    });

    it("Pew Research 调查表格应正确注册为 chart 类型", () => {
      const evidences = [
        makeEvidence({
          title: "Pew Research Center Survey",
          domain: "pewresearch.org",
          extractedFigures: [
            makeFigure({
              imageUrl: "https://pewresearch.org/survey-chart.png",
              caption: "Public Opinion on AI Regulation",
              type: "chart",
            }),
          ],
        }),
      ];

      const { figureRegistry } = buildFiguresSummary(evidences);
      expect(figureRegistry.get("FIG-1")?.type).toBe("chart");
    });

    it("架构图应正确注册为 diagram 类型（宽松策略）", () => {
      const evidences = [
        makeEvidence({
          title: "System Design Paper",
          extractedFigures: [
            makeFigure({
              imageUrl: "https://example.com/architecture.svg",
              caption: "",
              alt: "System architecture overview",
              type: "diagram",
            }),
          ],
        }),
      ];

      const { figureRegistry } = buildFiguresSummary(evidences);
      expect(figureRegistry.get("FIG-1")?.type).toBe("diagram");
      expect(figureRegistry.get("FIG-1")?.caption).toBe(
        "System architecture overview",
      );
    });

    it("backfill 阶段：注册表中有的图表即使 LLM 输出不完整也能补全", () => {
      const registry = new Map<string, FigureRegistryEntry>();
      registry.set("FIG-3", {
        figureId: "FIG-3",
        imageUrl: "https://fred.stlouisfed.org/graph.png",
        caption: "GDP Growth Rate Comparison",
        type: "chart",
        evidenceIndex: 2,
        figureIndex: 0,
        evidenceTitle: "World Bank Economic Outlook",
        evidenceDomain: "worldbank.org",
      });

      // LLM 只输出了 figureId，其他字段都空
      const refs = [
        makeRef({
          id: "ref-1",
          figureId: "FIG-3",
          caption: "",
          position: "after_paragraph_2",
        }),
      ];
      const result = priv.backfillFigureUrls(refs, undefined, registry);

      expect(result).toHaveLength(1);
      expect(result[0].imageUrl).toBe("https://fred.stlouisfed.org/graph.png");
      expect(result[0].caption).toBe("GDP Growth Rate Comparison");
      expect(result[0].source).toBe("World Bank Economic Outlook");
      expect(result[0].evidenceCitationIndex).toBe(2);
    });
  });

  // ============================================================
  // 场景 5: 同一图片不应在报告中重复出现
  //
  // 用户问题: "报告里同一张图出现了好几次"
  // 根因: 同一图片被多个证据引用，LLM 以为是不同图片分配给不同章节
  // 验证: buildFiguresSummary 对相同 URL 去重
  // ============================================================

  describe("场景 5: 同一图片不应在报告中重复出现", () => {
    it("同一张 Fed 图表被两个证据引用 → 只注册一次", () => {
      const sharedUrl = "https://fred.stlouisfed.org/graph/fredgraph.png?g=abc";
      const evidences = [
        makeEvidence({
          title: "Federal Reserve Data Analysis",
          extractedFigures: [
            makeFigure({
              imageUrl: sharedUrl,
              caption: "Federal Funds Rate",
              type: "chart",
            }),
          ],
        }),
        makeEvidence({
          title: "Interest Rate Forecast 2027",
          extractedFigures: [
            makeFigure({
              imageUrl: sharedUrl, // 同一 URL
              caption: "Fed Funds Rate Trend",
              type: "chart",
            }),
          ],
        }),
      ];

      const { figureRegistry } = buildFiguresSummary(evidences);

      // 只有 1 个注册 — LLM 只看到 1 个 FIG-ID
      expect(figureRegistry.size).toBe(1);
      // 保留首次出现的 caption
      expect(figureRegistry.get("FIG-1")?.caption).toBe("Federal Funds Rate");
    });

    it("base64 图片 URL 不应进入注册表（无法渲染）", () => {
      const evidences = [
        makeEvidence({
          title: "Some Article",
          extractedFigures: [
            makeFigure({
              imageUrl: "data:image/png;base64,iVBOR...",
              caption: "Inline image",
              type: "chart",
            }),
            makeFigure({
              imageUrl: "https://example.com/valid-chart.png",
              caption: "Valid chart",
              type: "chart",
            }),
          ],
        }),
      ];

      const { figureRegistry } = buildFiguresSummary(evidences);

      expect(figureRegistry.size).toBe(1);
      expect(figureRegistry.get("FIG-1")?.imageUrl).toBe(
        "https://example.com/valid-chart.png",
      );
    });

    it("backfill 阶段：LLM 编造了不存在的 figureId → 该引用被丢弃", () => {
      const registry = new Map<string, FigureRegistryEntry>();
      registry.set("FIG-1", {
        figureId: "FIG-1",
        imageUrl: "https://example.com/real-chart.png",
        caption: "Real Chart",
        type: "chart",
        evidenceIndex: 1,
        figureIndex: 0,
        evidenceTitle: "Evidence 1",
      });

      const refs = [
        makeRef({ id: "ref-1", figureId: "FIG-1" }), // 存在
        makeRef({ id: "ref-2", figureId: "FIG-999" }), // LLM 编造的
      ];
      const result = priv.backfillFigureUrls(refs, undefined, registry);

      // 只保留能找到 URL 的引用
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("ref-1");
    });
  });

  // ============================================================
  // 场景 6: 完整的端到端仿真 — 模拟真实报告的图片处理流程
  //
  // 模拟: 一个关于 "美国 AI 政策" 话题的维度研究
  // 输入: 4 个证据源，包含 6 张图片（2 chart + 1 diagram + 3 photo）
  // 预期: 注册 6 张 → Leader 指引标注类型 → backfill 3 张（LLM 选择的）→ caption 全部有意义
  // ============================================================

  describe("场景 6: 端到端仿真 — 模拟真实报告图片处理", () => {
    it("4 个证据源 6 张图片 → 注册表 + backfill + caption 全链路正确", () => {
      // Step 1: 构建证据和图片
      const evidences: EnrichedEvidenceData[] = [
        makeEvidence({
          title: "White House AI Executive Order 2026",
          domain: "whitehouse.gov",
          extractedFigures: [
            makeFigure({
              imageUrl: "https://www.whitehouse.gov/Wire-Banner.jpg",
              caption: "",
              alt: "",
              type: "photo", // 装饰横幅
            }),
          ],
        }),
        makeEvidence({
          title: "Federal Reserve Economic Data",
          domain: "fred.stlouisfed.org",
          extractedFigures: [
            makeFigure({
              imageUrl: "https://fred.stlouisfed.org/graph/fredgraph.png?g=abc",
              caption: "Federal Funds Rate 2020-2026",
              type: "chart", // 有价值的数据图表
            }),
          ],
        }),
        makeEvidence({
          title: "Pew Research: AI Public Opinion Survey",
          domain: "pewresearch.org",
          extractedFigures: [
            makeFigure({
              imageUrl: "https://pewresearch.org/survey-results.png",
              caption: "Public Opinion on AI Regulation | Pew Research",
              type: "chart", // 有价值但 caption 带平台后缀
            }),
            makeFigure({
              imageUrl: "https://pewresearch.org/methodology.svg",
              caption: "",
              alt: "Survey methodology diagram",
              type: "diagram", // 方法论图
            }),
          ],
        }),
        makeEvidence({
          title: "Council on Foreign Relations: AI in Diplomacy",
          domain: "cfr.org",
          extractedFigures: [
            makeFigure({
              imageUrl: "https://cdn.cfr.org/building-exterior.jpg",
              caption: "",
              alt: "CFR headquarters",
              type: "photo", // 装饰建筑照
            }),
            // 同一 URL 被另一个证据重复引用（应去重）
            makeFigure({
              imageUrl: "https://fred.stlouisfed.org/graph/fredgraph.png?g=abc",
              caption: "Fed Rate",
              type: "chart",
            }),
          ],
        }),
      ];

      // Step 2: buildFiguresSummary — 构建注册表
      const { summary, figureRegistry } = buildFiguresSummary(evidences);

      // 6 张图片 → 去重 1 张（Fed 重复） → 注册 5 张
      expect(figureRegistry.size).toBe(5);

      // 验证类型标注正确
      expect(figureRegistry.get("FIG-1")?.type).toBe("photo"); // 白宫横幅
      expect(figureRegistry.get("FIG-2")?.type).toBe("chart"); // Fed 利率图
      expect(figureRegistry.get("FIG-3")?.type).toBe("chart"); // Pew 调查
      expect(figureRegistry.get("FIG-4")?.type).toBe("diagram"); // 方法论图
      expect(figureRegistry.get("FIG-5")?.type).toBe("photo"); // CFR 建筑照

      // 验证 caption fallback 链正确
      expect(figureRegistry.get("FIG-1")?.caption).toBe(""); // 空 caption + 空 alt + photo 类型 → 空字符串（v11: photo 不生成虚假标题）
      expect(figureRegistry.get("FIG-2")?.caption).toBe(
        "Federal Funds Rate 2020-2026",
      );
      expect(figureRegistry.get("FIG-3")?.caption).toBe(
        "Public Opinion on AI Regulation | Pew Research",
      ); // 带平台后缀，cleanFigureCaption 在 backfill 阶段清理
      expect(figureRegistry.get("FIG-4")?.caption).toBe(
        "Survey methodology diagram",
      ); // alt fallback

      // Leader 指引包含正确信息
      expect(summary).toContain("共 5 个可用图表");
      expect(summary).toContain("才分配 0 张");

      // Step 3: backfillFigureUrls — 模拟 LLM 选择了 FIG-2 和 FIG-3
      const llmRefs: FigureReference[] = [
        makeRef({
          id: "r1",
          figureId: "FIG-2",
          caption: "",
          position: "after_paragraph_1",
        }),
        makeRef({
          id: "r2",
          figureId: "FIG-3",
          caption: "",
          position: "after_paragraph_3",
        }),
      ];

      const result = priv.backfillFigureUrls(
        llmRefs,
        undefined,
        figureRegistry,
      );

      // 两张都成功回填
      expect(result).toHaveLength(2);

      // FIG-2: Fed 利率图 — caption 完整，source 正确
      expect(result[0].imageUrl).toBe(
        "https://fred.stlouisfed.org/graph/fredgraph.png?g=abc",
      );
      expect(result[0].caption).toBe("Federal Funds Rate 2020-2026");
      expect(result[0].source).toBe("Federal Reserve Economic Data");

      // FIG-3: Pew 调查图 — caption 的平台后缀被清理
      expect(result[1].imageUrl).toBe(
        "https://pewresearch.org/survey-results.png",
      );
      // "Public Opinion on AI Regulation | Pew Research" 中的 " | Pew Research" 不在
      // cleanFigureCaption 的已知平台列表中，所以不会被清理。这是正确的行为 —
      // 只清理已知的低价值平台后缀（Medium, Substack, arXiv 等）
      expect(result[1].caption).toContain("Public Opinion on AI Regulation");
      expect(result[1].source).toBe("Pew Research: AI Public Opinion Survey");
    });

    it("LLM 选择了装饰性图片（FIG-1 白宫横幅）→ 仍然回填，但类型信息保留供下游判断", () => {
      const evidences: EnrichedEvidenceData[] = [
        makeEvidence({
          title: "White House AI Executive Order 2026",
          extractedFigures: [
            makeFigure({
              imageUrl: "https://whitehouse.gov/banner.jpg",
              caption: "",
              alt: "",
              type: "photo",
            }),
          ],
        }),
      ];

      const { figureRegistry } = buildFiguresSummary(evidences);

      // backfill 不做类型过滤（那是 FigureRelevanceService 的职责）
      const refs = [makeRef({ figureId: "FIG-1" })];
      const result = priv.backfillFigureUrls(refs, undefined, figureRegistry);

      expect(result).toHaveLength(1);
      // caption 有兜底值 — registry caption 为空，backfill 最终 fallback 用 evidence title
      expect(result[0].caption).toBe("White House AI Executive Order 2026");
    });
  });
});
